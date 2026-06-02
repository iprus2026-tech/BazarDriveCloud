import { go } from '../router.js';
import { escapeHtml } from '../util.js';

const CHAT_KEY          = 'bazardrive.chat.v1';
const RESPONSES_KEY     = 'bazardrive.responses.v1';
const TRIP_CONFIRM_KEY  = 'bazardrive.trip_confirmation.v1';

// Handoff TTL: a confirmation handed off from chat to /trip-confirmation
// is considered "fresh" for this window. Past it, /trip-confirmation will
// render the EXPIRED variant instead of pretending the link is still live.
const HANDOFF_TTL_MS = 30 * 60 * 1000;

const MOCK_DRIVER = {
  initials: 'РК',
  name:     'Рустам К.',
  status:   'в сети',
  rating:   '4.92',
};

const MOCK_TRIP = {
  from:  'Москва',
  to:    'Тула',
  when:  'Сегодня, 18:30',
  seats: 3,
  price: '2 800 ₽',
};

const MOCK_MESSAGES = [
  { id: 1, dir: 'in',  text: 'Здравствуйте! Да, место есть.',                                                           time: '14:21' },
  { id: 2, dir: 'out', text: 'Подскажите, можно с собакой среднего размера? В переноске.',                               time: '14:22' },
  { id: 3, dir: 'in',  text: 'Можно, если в переноске — без проблем. Заберу с Юго-Запада, как договаривались.',         time: '14:23' },
];

const QUICK_REPLIES = [
  'Где вы сейчас?',
  'Можно ли заехать?',
  'Подтверждаю поездку',
  'Сколько мест свободно?',
];

function getRouteParam(name) {
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  if (qi === -1) return null;
  return new URLSearchParams(hash.slice(qi + 1)).get(name);
}

function loadChatStore() {
  try {
    const raw = localStorage.getItem(CHAT_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    // migrate old storage shape: { chatId, messages }
    if (data?.chatId && Array.isArray(data.messages)) {
      return { [data.chatId]: data.messages };
    }
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function loadMessages(chatId) {
  const store = loadChatStore();
  return Array.isArray(store[chatId]) ? store[chatId] : null;
}

function saveMessages(chatId, messages) {
  try {
    const store = loadChatStore();
    store[chatId] = messages;
    localStorage.setItem(CHAT_KEY, JSON.stringify(store));
  } catch {}
}

// BD-AUTH-BOUNDARY-01 — chat messages are scoped to the local identity
// (driver/passenger thread for a specific trip). Wiped on logout / local
// reset by storage_boundary.clearUserScopedStorage().
export function clearChatStore() {
  try { localStorage.removeItem(CHAT_KEY); } catch {}
}

// Same key is referenced from active_ride.js; we still want to clear the
// per-id response map and the trip-confirmation handoff that this screen
// writes, since both are user-trip-specific.
export function clearChatResponses() {
  try { localStorage.removeItem(RESPONSES_KEY); } catch {}
}

export function clearTripConfirmationMap() {
  try { localStorage.removeItem(TRIP_CONFIRM_KEY); } catch {}
}

function loadResponse(responseId) {
  if (!responseId) return null;
  try {
    const raw = localStorage.getItem(RESPONSES_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw);
    if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
    const r = map[responseId];
    return r && typeof r === 'object' ? r : null;
  } catch {
    return null;
  }
}

function saveTripConfirmation(handoff) {
  if (!handoff || !handoff.tripId) return;
  try {
    const raw = localStorage.getItem(TRIP_CONFIRM_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const map = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    map[handoff.tripId] = handoff;
    localStorage.setItem(TRIP_CONFIRM_KEY, JSON.stringify(map));
  } catch {}
}

// Decide whether this chat surface belongs to a passenger-side ride
// response. The CTA stamps role='passenger' on the handoff, so we must
// not show it on driver-facing threads. Bare ?tripId=... URLs are also
// used by driver inbox and active-ride entry points, so they don't
// qualify on their own — we only unlock the CTA when a stored response
// of kind='passenger_response' backs this chat.
function resolveRideContext({ responseId }) {
  const response = loadResponse(responseId);
  if (response && response.kind === 'passenger_response' && response.tripId) {
    return { isRide: true, tripId: String(response.tripId) };
  }
  return { isRide: false, tripId: null };
}

// Driver auto-notices that predate the senderRole field. Such legacy
// messages were stored as `dir: 'out'`, so without a migration they would
// keep rendering as the passenger's own outgoing bubble.
const LEGACY_DRIVER_AUTO_TEXTS = new Set([
  'Подъезжаю к точке подачи',
]);

// This chat surface is passenger-facing (the header is the driver), so an
// incoming bubble is one authored by the driver. Messages appended from the
// driver flow (e.g. the "Подъезжаю к точке подачи" auto-notice) carry an
// explicit senderRole; prefer it over the legacy `dir` so a driver-authored
// message is never mistaken for the passenger's own outgoing bubble.
function directionForMessage(msg) {
  if (msg.senderRole === 'driver') return 'in';
  if (msg.senderRole === 'passenger') return 'out';
  // Defensive migration: a senderRole-less driver auto-notice is incoming.
  if (!msg.senderRole && LEGACY_DRIVER_AUTO_TEXTS.has(msg.text)) return 'in';
  return msg.dir === 'in' ? 'in' : 'out';
}

function createMsgEl(msg) {
  const dir  = directionForMessage(msg);
  const wrap = document.createElement('div');
  wrap.className = `chat__msg chat__msg--${dir}`;

  const bubble = document.createElement('div');
  bubble.className = 'chat__bubble';
  bubble.textContent = msg.text;

  const ts = document.createElement('div');
  ts.className = 'chat__ts';
  ts.textContent = msg.time;

  wrap.appendChild(bubble);
  wrap.appendChild(ts);
  return wrap;
}

const BACK_SVG = `<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <polyline points="11 4 6 9 11 14"/>
</svg>`;

const PHONE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.72 12 19.79 19.79 0 0 1 1.64 3.35 2 2 0 0 1 3.62 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.69a16 16 0 0 0 6.07 6.07l1.06-1.06a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
</svg>`;

const PLUS_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
  <line x1="12" y1="5" x2="12" y2="19"/>
  <line x1="5" y1="12" x2="19" y2="12"/>
</svg>`;

const SEND_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <line x1="22" y1="2" x2="11" y2="13"/>
  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
</svg>`;

export default function chat() {
  const tripId     = getRouteParam('tripId');
  const responseId = getRouteParam('responseId');
  const chatId     = tripId
    ? `trip-${tripId}`
    : responseId
      ? `response-${responseId}`
      : 'demo';

  const stored  = loadMessages(chatId);
  let messages  = stored ? [...stored] : MOCK_MESSAGES.map((m) => ({ ...m }));

  const rideContext = resolveRideContext({ responseId });

  const root = document.createElement('section');
  root.className = 'screen screen--chat';

  root.innerHTML = `
    <div class="chat__header">
      <button type="button" class="bd-iconbtn chat__back" id="chat-back" aria-label="Назад">
        ${BACK_SVG}
      </button>
      <div class="chat__avatar" aria-hidden="true">${escapeHtml(MOCK_DRIVER.initials)}</div>
      <div class="chat__driver-info">
        <div class="chat__driver-name">${escapeHtml(MOCK_DRIVER.name)}</div>
        <div class="chat__driver-meta">
          <span class="chat__online-dot" aria-hidden="true"></span>
          ${escapeHtml(MOCK_DRIVER.status)} · ★ ${escapeHtml(MOCK_DRIVER.rating)}
        </div>
      </div>
      <button type="button" class="bd-iconbtn chat__call" id="chat-call" aria-label="Позвонить">
        ${PHONE_SVG}
      </button>
    </div>

    <div class="chat__trip-bar">
      <div class="chat__trip-left">
        <div class="chat__trip-route">
          <span class="chat__trip-emoji" aria-hidden="true">🚕</span>
          <span>${escapeHtml(MOCK_TRIP.from)} → ${escapeHtml(MOCK_TRIP.to)}</span>
          <span class="inbox-item__status inbox-item__status--success chat__trip-status"
                aria-label="Статус поездки">Принят</span>
        </div>
        <div class="chat__trip-meta">${escapeHtml(MOCK_TRIP.when)} · ${MOCK_TRIP.seats} места</div>
      </div>
      <div class="chat__trip-price">${escapeHtml(MOCK_TRIP.price)}</div>
    </div>

    <div class="chat__confirm-bar" id="chat-confirm-bar"${rideContext.isRide ? '' : ' hidden'}>
      <button type="button" class="bd-btn primary chat__confirm-btn" id="chat-confirm">
        Подтвердить поездку
      </button>
      <p class="chat__confirm-hint">
        После подтверждения откроется активная поездка.
      </p>
    </div>

    <div class="chat__messages" id="chat-messages"
         role="log" aria-live="polite" aria-label="Сообщения чата"></div>

    <div class="chat__quick-replies" id="chat-qr"
         role="group" aria-label="Быстрые ответы"></div>

    <div class="chat__composer">
      <button type="button" class="bd-iconbtn chat__composer-plus"
              aria-label="Вложение" disabled>
        ${PLUS_SVG}
      </button>
      <div class="chat__input-wrap">
        <input type="text" class="chat__input" id="chat-input"
               placeholder="Сообщение…" aria-label="Введите сообщение"
               autocomplete="off" maxlength="1000">
      </div>
      <button type="button" class="chat__send" id="chat-send"
              aria-label="Отправить" disabled>
        ${SEND_SVG}
      </button>
    </div>

    <div class="chat__notice" id="chat-notice" hidden
         role="status" aria-live="polite"></div>
  `;

  // ── DOM refs ────────────────────────────────────────────────────
  const messagesEl = root.querySelector('#chat-messages');
  const qrEl       = root.querySelector('#chat-qr');
  const inputEl    = root.querySelector('#chat-input');
  const sendBtn    = root.querySelector('#chat-send');
  const noticeEl   = root.querySelector('#chat-notice');

  // ── Date separator ──────────────────────────────────────────────
  const sep = document.createElement('div');
  sep.className = 'chat__date-sep';
  sep.textContent = 'Сегодня';
  messagesEl.appendChild(sep);

  // ── Render initial messages ─────────────────────────────────────
  for (const msg of messages) {
    messagesEl.appendChild(createMsgEl(msg));
  }

  function scrollBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  requestAnimationFrame(scrollBottom);

  // ── Quick replies ───────────────────────────────────────────────
  for (const reply of QUICK_REPLIES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat__qr-chip';
    btn.textContent = reply;
    btn.dataset.reply = reply;
    qrEl.appendChild(btn);
  }

  qrEl.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-reply]');
    if (!chip) return;
    inputEl.value = chip.dataset.reply;
    updateSend();
    inputEl.focus();
  });

  // ── Send button state ───────────────────────────────────────────
  function updateSend() {
    const has = inputEl.value.trim().length > 0;
    sendBtn.disabled = !has;
    sendBtn.classList.toggle('chat__send--active', has);
  }

  inputEl.addEventListener('input', updateSend);

  // ── Send ────────────────────────────────────────────────────────
  function doSend() {
    const text = inputEl.value.trim();
    if (!text) return;

    const now  = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const msg = { id: Date.now(), dir: 'out', text, time };
    messages = [...messages, msg];
    saveMessages(chatId, messages);

    messagesEl.appendChild(createMsgEl(msg));
    scrollBottom();

    inputEl.value = '';
    updateSend();
  }

  sendBtn.addEventListener('click', doSend);

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });

  // ── Call stub notice ────────────────────────────────────────────
  let noticeTimer = null;

  function showNotice(msg) {
    noticeEl.textContent = msg;
    noticeEl.hidden = false;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { noticeEl.hidden = true; }, 3500);
  }

  root.querySelector('#chat-call').addEventListener('click', () => {
    showNotice('Звонок будет доступен после подтверждения поездки');
  });

  // ── Back ────────────────────────────────────────────────────────
  root.querySelector('#chat-back').addEventListener('click', () => go('/feed'));

  // ── Trip confirmation CTA (ride context only) ───────────────────
  if (rideContext.isRide && rideContext.tripId) {
    const confirmBtn = root.querySelector('#chat-confirm');
    // Single-shot guard: a synchronous disabled flip plus a JS-side
    // latch keep an impatient double-click from writing the handoff
    // entry twice or stacking two navigations onto the router.
    let confirming = false;
    confirmBtn.addEventListener('click', () => {
      if (confirming || confirmBtn.disabled) return;
      confirming = true;
      confirmBtn.disabled = true;

      const now = Date.now();
      saveTripConfirmation({
        tripId:     rideContext.tripId,
        responseId: responseId || null,
        role:       'passenger',
        state:      'CONFIRMED',
        createdAt:  now,
        expiresAt:  now + HANDOFF_TTL_MS,
      });
      const params = new URLSearchParams({
        tripId: rideContext.tripId,
        role:   'passenger',
        state:  'CONFIRMED',
      });
      go(`/trip-confirmation?${params.toString()}`);
    });
  }

  return root;
}
