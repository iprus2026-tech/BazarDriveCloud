import { go } from '../router.js';
import { escapeHtml } from '../util.js';
import {
  findActiveRide,
  resolveRideStatusTone,
  resolveRideStatusLabel,
  isTerminalRideStatus,
  RIDE_STATUS,
} from '../ride_state.js';

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
// of kind='passenger_response' backs this chat AND the viewer is the
// passenger. A driver thread (/chat?responseId=…&role=driver, opened by
// respond.js) stores that SAME passenger_response, so the kind check
// alone would wrongly show the passenger CTA to a driver.
function resolveRideContext({ responseId, viewerRole }) {
  const response = loadResponse(responseId);
  if (viewerRole !== 'driver' && response && response.kind === 'passenger_response' && response.tripId) {
    return { isRide: true, tripId: String(response.tripId) };
  }
  return { isRide: false, tripId: null };
}

// BD-CHAT-02 — Hydrate header + trip bar from the canonical ride when the
// caller supplies tripId, fall back to the stored response payload when only
// responseId is present, and otherwise show the demo card. The ride store
// owns `passenger`/`driver`/`route`/`ride.price`/`status`; the response store
// owns `driverPrice` and the originating `requestId`. We never throw — every
// lookup degrades gracefully so a stale/unknown id renders the demo instead
// of a blank screen.
function resolveChatHydration({ tripId, responseId, viewerRole }) {
  if (tripId) {
    const ride = findActiveRide(tripId);
    if (ride) {
      const counterpart = viewerRole === 'driver'
        ? (ride.passenger || {})
        : (ride.driver || {});
      const trip = {
        from:   ride.route && ride.route.pickupLabel  ? ride.route.pickupLabel  : MOCK_TRIP.from,
        to:     ride.route && ride.route.dropoffLabel ? ride.route.dropoffLabel : MOCK_TRIP.to,
        price:  (ride.ride && ride.ride.price) || (ride.order && ride.order.offerPrice) || MOCK_TRIP.price,
        when:   MOCK_TRIP.when,
        seats:  MOCK_TRIP.seats,
        status: ride.status || 'Принят',
      };
      return { counterpart, trip, response: null };
    }
  }
  if (responseId) {
    const response = loadResponse(responseId);
    if (response) {
      const trip = {
        from:   MOCK_TRIP.from,
        to:     MOCK_TRIP.to,
        price:  response.driverPrice ? `${response.driverPrice} ₽` : MOCK_TRIP.price,
        when:   MOCK_TRIP.when,
        seats:  MOCK_TRIP.seats,
        status: 'Принят',
      };
      return { counterpart: MOCK_DRIVER, trip, response };
    }
  }
  return {
    counterpart: MOCK_DRIVER,
    trip: { ...MOCK_TRIP, status: 'Принят' },
    response: null,
  };
}

// BD-CHAT-02 — Back link respects the entry point. When the user arrives
// from /active-ride (tripId + explicit role), return there. For respond/
// responses entries the order of precedence is:
//   1. responseId + orderId → /responses?orderId=<orderId>
//      (driver opened the chat from the responses board; back must return
//      to that same board so the canonical-order context is preserved).
//   2. responseId + response.requestId → /respond?postId=<requestId>
//      (chat was opened straight from /respond's success CTA, no orderId).
// Otherwise fall back to /feed, which matches the historical default for
// demo and legacy chat URLs. The `hasExplicitRole` gate keeps bare
// /chat?tripId= links (feed, post-detail, mock inbox) on the legacy /feed
// back path.
function resolveBackHref({ tripId, responseId, orderId, viewerRole, hasExplicitRole, response }) {
  if (tripId && hasExplicitRole) {
    return `/active-ride?role=${viewerRole}&tripId=${encodeURIComponent(tripId)}`;
  }
  if (responseId && orderId) {
    return `/responses?orderId=${encodeURIComponent(orderId)}`;
  }
  if (responseId && response && response.requestId) {
    return `/respond?postId=${encodeURIComponent(response.requestId)}`;
  }
  return '/feed';
}

// Driver auto-notices that predate the senderRole field. Such legacy
// messages were stored as `dir: 'out'`, so without a migration they would
// keep rendering as the passenger's own outgoing bubble.
const LEGACY_DRIVER_AUTO_TEXTS = new Set([
  'Подъезжаю к точке подачи',
]);

// A message is driver-authored when it carries senderRole==='driver' or,
// for legacy records stored before that field existed, when its text matches
// a known driver auto-notice. Values are trimmed/stringified so stray
// whitespace or non-string fields can't slip past the match.
function isDriverAuthoredMessage(msg) {
  const senderRole = String(msg.senderRole || '').trim();
  const normalizedText = String(msg.text || '').trim();
  return senderRole === 'driver'
    || LEGACY_DRIVER_AUTO_TEXTS.has(normalizedText);
}

// BD-CHAT-02 / BD-CHAT-04 — Bubble direction is computed relative to the
// viewer's role. Resolver precedence:
//   1. Explicit `senderRole` (`'driver'` / `'passenger'`) wins when present.
//   2. Else `authorRole` is accepted as a forward-compatible alias, also
//      gated on `'driver'` / `'passenger'`. New writes always stamp
//      `senderRole` (BD-CHAT-02), so `authorRole` only matters for records
//      written by future producers that adopt the alias.
//   3. Else, for legacy records written before either role field shipped:
//      (a) the driver auto-notice text set — outgoing on the driver side
//      and incoming on the passenger side — and (b) the raw `dir` field,
//      taken literally relative to the current viewer (`dir: 'out'` =
//      viewer's own bubble, `dir: 'in'` = counterpart's). The legacy
//      branch never re-anchors `dir` by viewer role, so passenger and
//      driver renderers stay symmetric on the same record. Anything that
//      is not exactly `'out'` (including undefined / unknown / null)
//      defaults to `'in'` — a safe "other-side" fallback that never
//      falsely attributes a message to the viewer and never throws on a
//      malformed record.
function directionForMessage(msg, viewerRole) {
  const senderRole = String(msg.senderRole || '').trim();
  const authorRole = String(msg.authorRole || '').trim();
  const explicitRole =
    (senderRole === 'driver' || senderRole === 'passenger') ? senderRole
    : (authorRole === 'driver' || authorRole === 'passenger') ? authorRole
    : '';
  if (explicitRole) {
    return explicitRole === viewerRole ? 'out' : 'in';
  }
  if (isDriverAuthoredMessage(msg)) {
    return viewerRole === 'driver' ? 'out' : 'in';
  }
  return msg.dir === 'out' ? 'out' : 'in';
}

function createMsgEl(msg, viewerRole, counterpartName) {
  const dir  = directionForMessage(msg, viewerRole);
  const wrap = document.createElement('div');
  wrap.className = `chat__msg chat__msg--${dir}`;

  // BD-CHAT-01 (Cloud Design port, #5) — sender attribution. The in/out side is
  // otherwise conveyed by alignment + colour only, invisible to a screen reader.
  // role=group + an aria-label name the author for AT; incoming bubbles also carry
  // a VISIBLE author label (aria-hidden, so the group label isn't read twice).
  const author = dir === 'out' ? 'Вы' : (counterpartName || 'Собеседник');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', author);
  if (dir === 'in') {
    const authorEl = document.createElement('div');
    authorEl.className = 'chat__author';
    authorEl.setAttribute('aria-hidden', 'true');
    authorEl.textContent = author;
    wrap.appendChild(authorEl);
  }

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

const CHAT_EMPTY_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="26" height="26">
  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
</svg>`;

// BD-CHAT-01 (Cloud Design port) — the designed thread-empty / first-message state:
// a «Заказ принят» system pill + a warm, role-specific prompt to start the
// conversation. No fabricated history (the route / trip bar above stays in place).
function renderEmptyThread(viewerRole) {
  const wrap = document.createElement('div');
  wrap.className = 'chat__empty';

  const pill = document.createElement('div');
  pill.className = 'chat__sys-pill';
  pill.textContent = 'Заказ принят';

  const ic = document.createElement('div');
  ic.className = 'chat__empty-ic';
  ic.setAttribute('aria-hidden', 'true');
  ic.innerHTML = CHAT_EMPTY_SVG;

  const title = document.createElement('p');
  title.className = 'chat__empty-title';
  title.textContent = 'Сообщений пока нет';

  const text = document.createElement('p');
  text.className = 'chat__empty-text';
  text.textContent = viewerRole === 'driver'
    ? 'Напишите пассажиру, чтобы согласовать детали посадки.'
    : 'Напишите водителю — он уже в курсе вашей поездки.';

  wrap.append(pill, ic, title, text);
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
  // BD-CHAT-02 — `orderId` is the canonical ride-order id when the chat
  // was opened from /responses (the driver-side board) — back must return
  // to /responses?orderId= so the board's context is preserved. /respond
  // → chat does not carry orderId; that path falls back to /respond.
  const orderId    = getRouteParam('orderId');
  // BD-CHAT-02 — `role` is the viewer's identity inside this chat. It picks
  // which side of the counterpart to show (driver-view → passenger, and
  // vice-versa) and stamps outgoing messages with the canonical authorship
  // field. Defaults to 'passenger' so legacy URLs without ?role= keep the
  // historical passenger-facing render.
  const rawRole         = getRouteParam('role');
  const hasExplicitRole = rawRole === 'driver' || rawRole === 'passenger';
  const viewerRole      = rawRole === 'driver' ? 'driver' : 'passenger';
  const chatId     = tripId
    ? `trip-${tripId}`
    : responseId
      ? `response-${responseId}`
      : 'demo';

  const stored  = loadMessages(chatId);
  // BD-CHAT-01 (Cloud Design port) — a REAL thread (trip/response) with no stored
  // messages shows the designed empty / first-message state, not a fabricated mock
  // conversation. The demo thread (chatId === 'demo') keeps MOCK_MESSAGES as a showcase.
  const isRealThread = chatId !== 'demo';
  let messages  = stored ? [...stored] : (isRealThread ? [] : MOCK_MESSAGES.map((m) => ({ ...m })));

  const rideContext = resolveRideContext({ responseId, viewerRole });
  // BD-CHAT-02 — header + trip-bar hydration source. `counterpart` is the
  // person on the other end of the thread (driver for passenger viewers,
  // passenger for driver viewers); `trip` carries route + price + status.
  const hydration   = resolveChatHydration({ tripId, responseId, viewerRole });
  const counterpart = hydration.counterpart;
  const trip        = hydration.trip;

  const root = document.createElement('section');
  root.className = 'screen screen--chat';

  root.innerHTML = `
    <div class="chat__header">
      <button type="button" class="bd-iconbtn chat__back" id="chat-back" aria-label="Назад">
        ${BACK_SVG}
      </button>
      <div class="chat__avatar" aria-hidden="true">${escapeHtml(counterpart.initials || '')}</div>
      <div class="chat__driver-info">
        <div class="chat__driver-name">${escapeHtml(counterpart.name || '')}</div>
        <div class="chat__driver-meta">
          <span class="chat__online-dot" aria-hidden="true"></span>
          ${escapeHtml(counterpart.onlineLabel || counterpart.status || 'в сети')} · ★ ${escapeHtml(counterpart.rating || '')}
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
          <span>${escapeHtml(trip.from)} → ${escapeHtml(trip.to)}</span>
          ${(() => {
            const raw   = trip.status || '';
            const tone  = resolveRideStatusTone(raw);
            const label = resolveRideStatusLabel(raw) || 'Принят';
            return `<span class="inbox-item__status inbox-item__status--${tone} chat__trip-status"
                aria-label="Статус поездки: ${escapeHtml(label)}">${escapeHtml(label)}</span>`;
          })()}
        </div>
        <div class="chat__trip-meta">${escapeHtml(trip.when || '')} · ${trip.seats || ''} места</div>
      </div>
      <div class="chat__trip-price">${escapeHtml(String(trip.price || ''))}</div>
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

  // ── Terminal (read-only) lock — ScreenOps audit #2, Cloud Design port ──
  // A completed / canceled / no-show trip is read-only: lock the composer,
  // drop the quick replies, and show a "trip ended" note. The composer stays
  // in the DOM (disabled) so the message log + confirm bar are unaffected, and
  // the send/keydown listeners below are inert against a disabled input.
  const isTerminal = isTerminalRideStatus(trip.status);
  if (isTerminal) {
    const composerEl = root.querySelector('.chat__composer');
    if (composerEl) composerEl.classList.add('chat__composer--locked');
    inputEl.disabled = true;
    inputEl.placeholder = 'Чат закрыт';
    sendBtn.disabled = true;
    qrEl.hidden = true;
    const note = document.createElement('div');
    note.className = 'chat__readonly-note';
    note.setAttribute('role', 'note');
    note.textContent =
      trip.status === RIDE_STATUS.COMPLETED ? 'Поездка завершена. Чат доступен только для просмотра.'
      : trip.status === RIDE_STATUS.NO_SHOW ? 'Пассажир не пришёл. Чат закрыт.'
      : 'Поездка отменена. Чат закрыт.';
    if (composerEl) composerEl.parentNode.insertBefore(note, composerEl);
  }

  // ── Empty thread, or date separator + messages ──────────────────
  if (isRealThread && messages.length === 0) {
    messagesEl.appendChild(renderEmptyThread(viewerRole));
  } else {
    const sep = document.createElement('div');
    sep.className = 'chat__date-sep';
    sep.textContent = 'Сегодня';
    messagesEl.appendChild(sep);
    for (const msg of messages) {
      messagesEl.appendChild(createMsgEl(msg, viewerRole, counterpart.name));
    }
  }

  function scrollBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  requestAnimationFrame(scrollBottom);

  // ── Quick replies ───────────────────────────────────────────────
  for (const reply of (isTerminal ? [] : QUICK_REPLIES)) {
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

    // BD-CHAT-02 — `senderRole` is the canonical authorship field; readers
    // (driver and passenger viewers alike) compute incoming/outgoing from it.
    // `dir: 'out'` is retained as the legacy fallback for stores written
    // before senderRole existed and is correct here because this is the
    // local outgoing send.
    const msg = { id: Date.now(), senderRole: viewerRole, dir: 'out', text, time };
    messages = [...messages, msg];
    saveMessages(chatId, messages);

    messagesEl.appendChild(createMsgEl(msg, viewerRole, counterpart.name));
    scrollBottom();

    inputEl.value = '';
    updateSend();
    // BD-CHAT-01 (#4, a11y) — a click-send disables the (now-focused) send
    // button, which would otherwise drop focus to <body>; return focus to the
    // input so keyboard / screen-reader users keep their place and can keep
    // typing. (Mirrors the pinned active-ride pattern: focus moves off a
    // trigger that the action hides/disables.)
    inputEl.focus();
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
  // BD-CHAT-02 — Round-trip to the entry point. `resolveBackHref` keeps the
  // confirmation CTA's forward path (handled separately below) unchanged
  // and only governs the back arrow.
  root.querySelector('#chat-back').addEventListener('click', () => {
    go(resolveBackHref({
      tripId,
      responseId,
      orderId,
      viewerRole,
      hasExplicitRole,
      response: hydration.response,
    }));
  });

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
