import { go } from '../router.js';
import { escapeHtml } from '../util.js';
import {
  findActiveRide,
  resolveRideStatusTone,
  resolveRideStatusLabel,
  isTerminalRideStatus,
  RIDE_STATUS,
} from '../ride_state.js';
import { isBackendEnabled } from '../api_config.js';
import { apiFetch } from '../api_client.js';
import { getRideFromBackend } from '../mock_api.js';

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

const MOCK_PASSENGER = {
  initials: 'АП',
  name:     'Анна П.',
  status:   'в сети',
  rating:   '4.91',
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

const CHAT_READ_STATE = Object.freeze({
  LOADING: 'loading',
  LOADED:  'loaded',
  EMPTY:   'empty',
  ERROR:   'error',
});
const CHAT_FIXTURES = new Set(Object.values(CHAT_READ_STATE));
const CHAT_READ_TIMEOUT_MS = 12_000;
const CHAT_POLL_MS = 2_500;
const CHAT_FIXTURE_MESSAGES = Object.freeze([
  Object.freeze({ id: 'fixture_chat_passenger_1', senderRole: 'passenger', text: 'Здравствуйте! Я у главного входа.', time: '14:21' }),
  Object.freeze({ id: 'fixture_chat_driver_1', senderRole: 'driver', text: 'Вижу вас, подъеду через пару минут.', time: '14:22' }),
  Object.freeze({ id: 'fixture_chat_passenger_2', senderRole: 'passenger', text: 'Хорошо, ожидаю здесь.', time: '14:23' }),
]);

function getRouteParam(name) {
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  if (qi === -1) return null;
  return new URLSearchParams(hash.slice(qi + 1)).get(name);
}

function getChatFixture() {
  const value = getRouteParam('fixture') || '';
  return CHAT_FIXTURES.has(value) ? value : '';
}

function createReadAbortError(message) {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

// One operation owner for the initial GET and later poll GETs. Superseding
// reads reject immediately, abort the underlying fetch and clear their timer;
// background polls can opt out of supersession so intervals never overlap.
// The scheduler arguments keep the lifecycle deterministic in the focused
// smoke without introducing a shared runtime abstraction.
function createChatReadManager(fetchMessages, timeoutMs, schedule = setTimeout, unschedule = clearTimeout) {
  let activeRead = null;

  function cancel(message = 'chat messages read canceled') {
    const operation = activeRead;
    if (!operation) return;
    activeRead = null;
    unschedule(operation.timeoutId);
    operation.controller.abort();
    operation.reject(createReadAbortError(message));
  }

  function run(chatId, epoch, { supersede = true } = {}) {
    if (activeRead) {
      if (!supersede) return null;
      cancel('chat messages read superseded');
    }

    let operation;
    const result = new Promise((resolve, reject) => {
      const controller = new AbortController();
      operation = { controller, epoch, reject, timeoutId: null };
      activeRead = operation;
      operation.timeoutId = schedule(() => {
        if (activeRead !== operation) return;
        unschedule(operation.timeoutId);
        activeRead = null;
        controller.abort();
        const error = new Error('chat messages read timed out');
        error.name = 'TimeoutError';
        reject(error);
      }, timeoutMs);

      Promise.resolve()
        .then(() => {
          if (activeRead !== operation || controller.signal.aborted) {
            throw createReadAbortError('chat messages read canceled before start');
          }
          return fetchMessages(chatId, controller.signal);
        })
        .then(resolve, reject);
    });

    return result.finally(() => {
      if (activeRead !== operation) return;
      unschedule(operation.timeoutId);
      activeRead = null;
    });
  }

  return {
    cancel,
    run,
    isActive: () => activeRead !== null,
  };
}

function loadChatStore() {
  try {
    const raw = localStorage.getItem(CHAT_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    // migrate old storage shape: { chatId, messages }
    if (data?.chatId && Array.isArray(data.messages)) {
      const { chatId, messages, ...rest } = data;
      return { ...rest, [chatId]: messages };
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

function saveMessages(chatId, messages, store = loadChatStore()) {
  try {
    const next = { ...store };
    next[chatId] = messages;
    localStorage.setItem(CHAT_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

// Append one outgoing message to its thread. Re-reads the store immediately
// before writing and pushes only the new record (BD-CHAT-01 #7), so a concurrent
// write from another tab to the SAME thread is preserved instead of being
// clobbered by a stale full-array overwrite. Returns false when the write itself
// fails (quota / private mode) so the caller can surface it (BD-CHAT-01 #6)
// rather than silently dropping the message.
function appendMessage(chatId, msg) {
  try {
    const store = loadChatStore();
    const arr = Array.isArray(store[chatId]) ? store[chatId].slice() : [];
    arr.push(msg);
    return saveMessages(chatId, arr, store);
  } catch {
    return false;
  }
}

// BD-CHAT-01 (#18) — order-preserving persist for a RETRY of a failed send. A plain append would
// push the older retried message after a newer one the user has since sent, so a reload would
// flip the thread order (Codex #750). Insert by msg.id (the send timestamp) instead. Returns
// false on a storage failure, like appendMessage, so the retry can stay flagged.
function persistMessageInOrder(chatId, msg) {
  try {
    const store = loadChatStore();
    const arr = Array.isArray(store[chatId]) ? store[chatId].slice() : [];
    let i = arr.length;
    while (i > 0 && Number(arr[i - 1].id) > Number(msg.id)) i--;
    arr.splice(i, 0, msg);
    return saveMessages(chatId, arr, store);
  } catch {
    return false;
  }
}

// ── #784 chat cutover — when the backend is ON, a real thread's messages come from the shared
// server thread (GET/POST /api/v1/chat/messages, keyed by chatId) instead of local storage; the
// local path below is unchanged when the backend is OFF. Messages are auth-free (sender_role in the
// body) per the epic. ───────────────────────────────────────────────────────────────────────────
function isoToHm(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function mapServerMsg(m) {
  // server shape -> chat.js shape; readers compute in/out from senderRole (dir is a legacy fallback).
  return {
    id: m.clientMsgId != null ? m.clientMsgId : m.id,
    senderRole: m.senderRole || null,
    // legacy `dir` is only consulted when senderRole is null — default to the SAFE other-side 'in'
    // so an un-roled server message never renders as the viewer's own outgoing bubble.
    dir: m.senderRole === 'passenger' ? 'out' : 'in',
    text: m.body,
    time: m.displayTime || isoToHm(m.createdAt),
  };
}
async function fetchServerMessages(chatId, signal) {
  const r = await apiFetch(`/chat/messages?chatId=${encodeURIComponent(chatId)}`, { signal });
  if (!r || !Array.isArray(r.items)) {
    throw new TypeError('chat messages response is unusable');
  }
  const items = r.items.map(mapServerMsg);
  if (!items.every((item) => item && item.id != null && typeof item.text === 'string')) {
    throw new TypeError('chat messages response contains an unusable item');
  }
  return items;
}
function postServerMessage(chatId, msg) {
  return apiFetch('/chat/messages', {
    method: 'POST',
    body: { chatId, body: msg.text, senderRole: msg.senderRole, clientMsgId: msg.id, displayTime: msg.time },
  });
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

// Fixture previews are fully synthetic. Even when the URL carries tripId or
// responseId values that exist in persisted stores, the preview must not read
// or expose production-like ride/response data in its header, trip bar or CTA.
function resolveFixtureHydration(viewerRole) {
  const counterpartRole = viewerRole === 'driver' ? 'passenger' : 'driver';
  const counterpart = counterpartRole === 'passenger' ? MOCK_PASSENGER : MOCK_DRIVER;
  return {
    counterpart,
    trip: { ...MOCK_TRIP, status: 'Принят' },
    response: null,
    counterpartRole,
    confirmed: true,
  };
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

// BD-CHAT-FALLBACK-02 — shared real-ride hydration shape, used by both the
// tripId branch (findActiveRide hit) and the orderId-derived responseId
// branch (#891 Codex P2 Finding 1) so the two real-ride paths render
// identically instead of drifting apart. Behaviorally-unchanged contract:
// same counterpart/trip/counterpartRole shape as before extraction.
function hydrateFromRealRide(ride, viewerRole) {
  const counterpart = viewerRole === 'driver'
    ? (ride.passenger || {})
    : (ride.driver || {});
  // The avatar colour must match the counterpart actually rendered here:
  // viewer=driver renders the passenger, viewer=passenger renders the driver.
  const counterpartRole = viewerRole === 'driver' ? 'passenger' : 'driver';
  const trip = {
    from:   ride.route && ride.route.pickupLabel  ? ride.route.pickupLabel  : MOCK_TRIP.from,
    to:     ride.route && ride.route.dropoffLabel ? ride.route.dropoffLabel : MOCK_TRIP.to,
    price:  (ride.ride && ride.ride.price) || (ride.order && ride.order.offerPrice) || MOCK_TRIP.price,
    when:   MOCK_TRIP.when,
    seats:  MOCK_TRIP.seats,
    status: ride.status || 'Принят',
  };
  return { counterpart, trip, counterpartRole };
}

// BD-CHAT-02 — Hydrate header + trip bar from the canonical ride when the
// caller supplies tripId, fall back to the stored response payload when only
// responseId is present, and otherwise show the demo card. The ride store
// owns `passenger`/`driver`/`route`/`ride.price`/`status`; the response store
// owns `driverPrice` and the originating `requestId`. We never throw — every
// lookup degrades gracefully so a stale/unknown id renders the demo instead
// of a blank screen.
function resolveChatHydration({ tripId, responseId, orderId, viewerRole, hasExplicitRole }) {
  if (tripId) {
    const ride = findActiveRide(tripId);
    if (ride) {
      return { ...hydrateFromRealRide(ride, viewerRole), response: null, confirmed: true };
    }
    // BD-CHAT-FALLBACK-02 — a local-store miss on tripId is not proof no ride
    // exists: active-ride/trip-confirmation chat buttons always append &role=,
    // and on a live backend the authoritative ride can be cross-device /
    // in-memory-only (merged from the server without a local write — see
    // active_ride.js mergeServerRide / loadCanonicalActiveRide) (#891 Codex P2
    // Finding 2). Require BOTH signals together: an internal-navigation
    // provenance marker (hasExplicitRole) AND a live backend (isBackendEnabled())
    // — role= alone can be hand-typed into a URL and proves nothing by itself;
    // with the backend OFF every real local ride is always synchronously
    // persisted, so a miss there is genuine absence, not a caching gap.
    // Neither signal alone is proof the ride is REAL and ACCEPTED, only that
    // it's worth *asking the backend*: stay confirmed:false (never render
    // 'Принят') and let chat() await getRideFromBackend(tripId) before
    // upgrading — pendingBackendConfirm is that request, not the answer.
    if (hasExplicitRole && isBackendEnabled()) {
      // BD-CHAT-FALLBACK-03 — trip_confirmation.js's passenger chat handoff
      // (chatHref, #732/#743) threads tripId + responseId + role=passenger
      // together on purpose: responseId hydrates the thread from the stored
      // driver offer BEFORE the active ride is seeded, since tripId only
      // resolves once findActiveRide(tripId) actually finds it. Don't
      // clobber that already-known offer (e.g. the driver's price) with
      // generic MOCK_TRIP data while a backend confirm is pending — reuse
      // the same response-backed hydration the responseId branch below
      // would produce, still tagged pendingBackendConfirm so a successful
      // read still upgrades to the real ride via hydrateFromRealRide, and a
      // 404/403/failed read leaves the response hydration in place instead
      // of a fabricated 'Принят' (#891 Codex P2 follow-up).
      const pendingResponse = responseId ? loadResponse(responseId) : null;
      if (pendingResponse) {
        const trip = {
          from:   MOCK_TRIP.from,
          to:     MOCK_TRIP.to,
          price:  pendingResponse.driverPrice ? `${pendingResponse.driverPrice} ₽` : MOCK_TRIP.price,
          when:   MOCK_TRIP.when,
          seats:  MOCK_TRIP.seats,
          status: 'Не подтверждено',
        };
        return {
          counterpart: MOCK_DRIVER,
          trip,
          response: pendingResponse,
          counterpartRole: 'driver',
          confirmed: false,
          pendingBackendConfirm: true,
        };
      }
      const counterpartRole = viewerRole === 'driver' ? 'passenger' : 'driver';
      const counterpart = counterpartRole === 'passenger' ? MOCK_PASSENGER : MOCK_DRIVER;
      return {
        counterpart,
        trip: { ...MOCK_TRIP, status: 'Не подтверждено' },
        response: null,
        counterpartRole,
        confirmed: false,
        pendingBackendConfirm: true,
      };
    }
  }
  if (responseId) {
    if (orderId) {
      // BD-CHAT-FALLBACK-02 — a passenger who already selected a driver has a
      // real active ride at trip_${orderId} (buildPassengerActiveRide,
      // responses.js) with ride.selectedDriver.responseId pinned to that
      // choice. Reopening /chat?responseId=...&orderId=... for THAT driver
      // must reflect the real ride, not the generic unconfirmed state (#891
      // Codex P2 Finding 1). A responseId for a driver who was NOT selected
      // (or no ride yet) still falls through unconfirmed below.
      const existingRide = findActiveRide(`trip_${orderId}`);
      if (existingRide && existingRide.selectedDriver
          && existingRide.selectedDriver.responseId === responseId) {
        return { ...hydrateFromRealRide(existingRide, viewerRole), response: null, confirmed: true };
      }
    }
    const response = loadResponse(responseId);
    if (response) {
      // BD-CHAT-FALLBACK-01 — a stored response is a driver OFFER, not an
      // accepted ride: no `ride` record exists yet (the `if (tripId)` branch
      // above only returns when findActiveRide finds one). Do not claim
      // 'Принят' here — see confirmed:false below (#891).
      const trip = {
        from:   MOCK_TRIP.from,
        to:     MOCK_TRIP.to,
        price:  response.driverPrice ? `${response.driverPrice} ₽` : MOCK_TRIP.price,
        when:   MOCK_TRIP.when,
        seats:  MOCK_TRIP.seats,
        status: 'Не подтверждено',
      };
      // This path always renders MOCK_DRIVER (a driver) as the counterpart,
      // regardless of viewer role — so the avatar shows the driver identity colour.
      return { counterpart: MOCK_DRIVER, trip, response, counterpartRole: 'driver', confirmed: false };
    }
  }
  // BD-CHAT-FALLBACK-01 — no real ride and no stored response back this
  // thread (e.g. /chat?tripId=<feed-post-id> for a post that was never
  // ordered/accepted). confirmed:false keeps the header status and the
  // empty-thread system pill from falsely declaring the ride accepted (#891).
  return {
    counterpart: MOCK_DRIVER,
    trip: { ...MOCK_TRIP, status: 'Не подтверждено' },
    response: null,
    counterpartRole: 'driver',
    confirmed: false,
  };
}

// Named exports (in addition to the default screen export below) — both
// functions are pure (no DOM/localStorage side effects of their own), so a
// static smoke can import and execute them directly with a constructed mock
// ride to prove the real hydration/label pipeline behaviorally, not just
// pattern-match the source text (#891 Codex P2 repair).
export { resolveChatHydration, hydrateFromRealRide };

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
// BD-CHAT-FALLBACK-01 — `confirmed` mirrors resolveChatHydration's flag: only a
// genuine backing ride (or the fixture preview) may claim the order was
// accepted; an unresolved tripId/responseId gets a neutral pill instead (#891).
function renderEmptyThread(viewerRole, confirmed) {
  const wrap = document.createElement('div');
  wrap.className = 'chat__empty';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-labelledby', 'chat-empty-title');

  const pill = document.createElement('div');
  pill.className = 'chat__sys-pill';
  pill.textContent = confirmed ? 'Заказ принят' : 'Не подтверждено';

  const ic = document.createElement('div');
  ic.className = 'chat__empty-ic';
  ic.setAttribute('aria-hidden', 'true');
  ic.innerHTML = CHAT_EMPTY_SVG;

  const title = document.createElement('h2');
  title.className = 'chat__empty-title';
  title.id = 'chat-empty-title';
  title.textContent = 'Сообщений пока нет';

  const text = document.createElement('p');
  text.className = 'chat__empty-text';
  text.textContent = viewerRole === 'driver'
    ? 'Напишите пассажиру, чтобы согласовать детали посадки.'
    : 'Напишите водителю — он уже в курсе вашей поездки.';

  wrap.append(pill, ic, title, text);
  return wrap;
}

function renderChatLoading() {
  const wrap = document.createElement('div');
  wrap.className = 'chat__loading';

  const status = document.createElement('p');
  status.className = 'chat__loading-status';
  status.setAttribute('role', 'status');
  status.textContent = 'Загружаем сообщения…';

  const skeleton = document.createElement('div');
  skeleton.className = 'chat__skeleton';
  skeleton.setAttribute('aria-hidden', 'true');
  skeleton.innerHTML = `
    <div class="chat__skeleton-message chat__skeleton-message--in">
      <span class="chat__skeleton-author chat__skeleton-bone"></span>
      <span class="chat__skeleton-bubble chat__skeleton-bubble--wide chat__skeleton-bone"></span>
      <span class="chat__skeleton-time chat__skeleton-bone"></span>
    </div>
    <div class="chat__skeleton-message chat__skeleton-message--out">
      <span class="chat__skeleton-bubble chat__skeleton-bubble--medium chat__skeleton-bone"></span>
      <span class="chat__skeleton-time chat__skeleton-bone"></span>
    </div>
    <div class="chat__skeleton-message chat__skeleton-message--in">
      <span class="chat__skeleton-author chat__skeleton-bone"></span>
      <span class="chat__skeleton-bubble chat__skeleton-bubble--short chat__skeleton-bone"></span>
      <span class="chat__skeleton-time chat__skeleton-bone"></span>
    </div>
  `;

  wrap.append(status, skeleton);
  return wrap;
}

function renderChatReadError() {
  const wrap = document.createElement('div');
  wrap.className = 'chat__read-error';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-labelledby', 'chat-read-error-title');

  const title = document.createElement('h2');
  title.className = 'chat__read-error-title';
  title.id = 'chat-read-error-title';
  title.textContent = 'Не удалось загрузить сообщения';

  const text = document.createElement('p');
  text.className = 'chat__read-error-text';
  text.textContent = 'Проверьте соединение и повторите загрузку истории чата.';

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'bd-btn primary chat__read-retry';
  retry.dataset.action = 'retry-chat-read';
  retry.textContent = 'Повторить';
  retry.setAttribute('aria-label', 'Повторить загрузку сообщений');

  wrap.append(title, text, retry);
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
  const fixture    = getChatFixture();
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

  // Canonical fixtures are fully synthetic inputs. They bypass local message
  // reads as well as persisted ride/response hydration, guarded GET and polling.
  const stored  = fixture ? null : loadMessages(chatId);
  // BD-CHAT-01 (Cloud Design port) — a REAL thread (trip/response) with no stored
  // messages shows the designed empty / first-message state, not a fabricated mock
  // conversation. The demo thread (chatId === 'demo') keeps MOCK_MESSAGES as a showcase.
  const isRealThread = chatId !== 'demo';
  // #784 cutover: on a live backend a real thread reads the SHARED SERVER thread (the source of
  // truth), so local pre-cutover stored messages are ignored to avoid mixing the two histories.
  const backendRead = !fixture && isBackendEnabled() && isRealThread;
  let messages = fixture === CHAT_READ_STATE.LOADED
    ? CHAT_FIXTURE_MESSAGES.map((message) => ({ ...message }))
    : fixture || backendRead
      ? []
      : (stored ? [...stored] : (isRealThread ? [] : MOCK_MESSAGES.map((message) => ({ ...message }))));

  const rideContext = resolveRideContext({
    responseId: fixture ? null : responseId,
    viewerRole,
  });
  // BD-CHAT-02 — header + trip-bar hydration source. `counterpart` is the
  // person on the other end of the thread (driver for passenger viewers,
  // passenger for driver viewers); `trip` carries route + price + status.
  const hydration = fixture
    ? resolveFixtureHydration(viewerRole)
    : resolveChatHydration({ tripId, responseId, orderId, viewerRole, hasExplicitRole });
  const counterpart = hydration.counterpart;
  const trip        = hydration.trip;
  // BD-CHAT-FALLBACK-02 — `let`, not `const`: a pending server-backed ride
  // (hydration.pendingBackendConfirm) starts confirmed:false and may flip to
  // true once getRideFromBackend resolves (see confirmRideFromBackend below).
  let confirmed      = hydration.confirmed !== false;
  // BD-CHAT-01 (Cloud Design parity) — the header avatar carries the COUNTERPART's
  // identity colour (driver = green, passenger = purple), matching the
  // .cf-avatar--driver/--passenger convention. The role comes from the hydrated
  // counterpart that is actually rendered (resolveChatHydration), NOT from
  // viewerRole: the responseId / demo paths render MOCK_DRIVER regardless of the
  // viewer, so the colour must follow the data on screen — otherwise a driver
  // counterpart would show in passenger-purple (Codex #710 P2).
  const counterpartRole = hydration.counterpartRole;

  const root = document.createElement('section');
  root.className = 'screen screen--chat';
  if (fixture) root.dataset.fixture = fixture;

  root.innerHTML = `
    <div class="chat__header">
      <button type="button" class="bd-iconbtn chat__back" id="chat-back" aria-label="Назад">
        ${BACK_SVG}
      </button>
      <div class="chat__avatar chat__avatar--${counterpartRole}" aria-hidden="true">${escapeHtml(counterpart.initials || '')}</div>
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
          <span class="chat__trip-route-text">${escapeHtml(trip.from)} → ${escapeHtml(trip.to)}</span>
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

    <div class="chat__messages" id="chat-messages" tabindex="-1"
         role="log" aria-live="polite" aria-label="Сообщения чата"
         aria-busy="${backendRead || fixture === CHAT_READ_STATE.LOADING ? 'true' : 'false'}"></div>

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

  // ── Initial message-list state + incremental backend refresh ─────
  // `rendered` tracks message ids already in the DOM so background refreshes
  // append incrementally. Optimistic / failed-send bubbles and scrollback stay
  // intact after the honest initial read has settled.
  const rendered = new Set();
  let threadShellReady = false;
  let readState = fixture || (backendRead
    ? CHAT_READ_STATE.LOADING
    : messages.length ? CHAT_READ_STATE.LOADED : CHAT_READ_STATE.EMPTY);

  function ensureThreadShell() {
    messagesEl.replaceChildren();
    rendered.clear();
    const sep = document.createElement('div');
    sep.className = 'chat__date-sep';
    sep.textContent = 'Сегодня';
    messagesEl.appendChild(sep);
    threadShellReady = true;
  }

  // Dedupe key = senderRole + id. The server treats the same clientMsgId from DIFFERENT senderRoles
  // as distinct messages (its unique index is chat_id + sender_role + client_msg_id), so keying by id
  // alone would drop one side's message if both devices mint the same Date.now() id in a thread. The
  // role discriminator still matches the local optimistic echo (same sender, same id) for dedup.
  const keyOf = (message) => `${message.senderRole || '~'}:${message.id}`;
  function renderMessage(message) {
    if (rendered.has(keyOf(message))) return null;
    rendered.add(keyOf(message));
    const element = createMsgEl(message, viewerRole, counterpart.name);
    messagesEl.appendChild(element);
    return element;
  }

  function scrollBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderReadState(nextState, list = []) {
    const ownedFocus = messagesEl.contains(document.activeElement)
      && document.activeElement !== messagesEl;
    if (ownedFocus && typeof messagesEl.focus === 'function') {
      messagesEl.focus({ preventScroll: true });
    }

    readState = nextState;
    messagesEl.dataset.readState = nextState;
    messagesEl.setAttribute('aria-busy', nextState === CHAT_READ_STATE.LOADING ? 'true' : 'false');
    threadShellReady = false;
    rendered.clear();

    if (nextState === CHAT_READ_STATE.LOADING) {
      messages = [];
      messagesEl.replaceChildren(renderChatLoading());
    } else if (nextState === CHAT_READ_STATE.ERROR) {
      messages = [];
      messagesEl.replaceChildren(renderChatReadError());
    } else if (nextState === CHAT_READ_STATE.EMPTY) {
      messages = [];
      messagesEl.replaceChildren(renderEmptyThread(viewerRole, confirmed));
    } else {
      messages = [...list];
      ensureThreadShell();
      for (const message of list) renderMessage(message);
    }
    syncComposerAvailability();
  }

  if (readState === CHAT_READ_STATE.LOADED) {
    renderReadState(CHAT_READ_STATE.LOADED, messages);
  } else {
    renderReadState(readState);
  }

  // ── #784 cutover — guarded initial GET, then non-overlapping poll ──
  // Backend activation remains unchanged. A terminal thread reads once; a
  // non-terminal thread begins the existing 2.5 s poll only after success.
  const backendChat = backendRead && !isTerminal;
  let initialFetchDone = !backendRead;
  let readEpoch = 0;
  let pollId = null;
  let rootWasConnected = false;
  let mountCheckPassed = false;
  // BD-CHAT-FALLBACK-02 — one-shot backend ride confirmation (#891 Codex P2
  // Finding 2), independent of the message readManager below: this asks
  // getRideFromBackend(tripId) once for a tripId that missed locally but
  // came with an explicit &role= on a live backend. No retry/poll loop —
  // 404/403/network failure/abort all leave confirmed:false untouched.
  let rideConfirmController = null;
  const readManager = createChatReadManager(fetchServerMessages, CHAT_READ_TIMEOUT_MS);
  setTimeout(() => { mountCheckPassed = true; }, 0);
  const isCurrentRead = (epoch) => epoch === readEpoch
    && (!mountCheckPassed || root.isConnected);
  const nearBottom = () => (messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight) < 80;

  function stopPolling() {
    if (pollId !== null) clearInterval(pollId);
    pollId = null;
  }

  function teardownReads() {
    readEpoch += 1;
    stopPolling();
    readManager.cancel('chat screen torn down');
    if (rideConfirmController) {
      rideConfirmController.abort();
      rideConfirmController = null;
    }
  }

  // BD-CHAT-FALLBACK-02 — apply a successfully-confirmed server ride to the
  // already-rendered header + trip-bar (+ the empty-thread pill, if still
  // showing) in place, via the SAME hydrateFromRealRide shape the tripId and
  // orderId real-ride branches already use — so a late confirmation renders
  // identically to one that was available synchronously (#891 Codex P2).
  function applyConfirmedRide(srv) {
    const real = hydrateFromRealRide(srv, viewerRole);
    confirmed = true;
    trip.from   = real.trip.from;
    trip.to     = real.trip.to;
    trip.price  = real.trip.price;
    trip.when   = real.trip.when;
    trip.seats  = real.trip.seats;
    trip.status = real.trip.status;

    const avatarEl = root.querySelector('.chat__avatar');
    if (avatarEl) {
      avatarEl.className = `chat__avatar chat__avatar--${real.counterpartRole}`;
      avatarEl.textContent = real.counterpart.initials || '';
    }
    const nameEl = root.querySelector('.chat__driver-name');
    if (nameEl) nameEl.textContent = real.counterpart.name || '';
    const metaEl = root.querySelector('.chat__driver-meta');
    if (metaEl) {
      metaEl.innerHTML = `<span class="chat__online-dot" aria-hidden="true"></span>`
        + `${escapeHtml(real.counterpart.onlineLabel || real.counterpart.status || 'в сети')} · ★ ${escapeHtml(real.counterpart.rating || '')}`;
    }
    const routeTextEl = root.querySelector('.chat__trip-route-text');
    if (routeTextEl) routeTextEl.textContent = `${trip.from} → ${trip.to}`;
    const statusEl = root.querySelector('.chat__trip-status');
    if (statusEl) {
      const tone  = resolveRideStatusTone(trip.status);
      const label = resolveRideStatusLabel(trip.status) || 'Принят';
      statusEl.className = `inbox-item__status inbox-item__status--${tone} chat__trip-status`;
      statusEl.textContent = label;
      statusEl.setAttribute('aria-label', `Статус поездки: ${label}`);
    }
    const priceEl = root.querySelector('.chat__trip-price');
    if (priceEl) priceEl.textContent = String(trip.price || '');
    const metaTripEl = root.querySelector('.chat__trip-meta');
    if (metaTripEl) metaTripEl.textContent = `${trip.when || ''} · ${trip.seats || ''} места`;
    if (readState === CHAT_READ_STATE.EMPTY) {
      messagesEl.replaceChildren(renderEmptyThread(viewerRole, confirmed));
    }
  }

  async function confirmRideFromBackend() {
    const controller = new AbortController();
    rideConfirmController = controller;
    let srv = null;
    try {
      srv = await getRideFromBackend(tripId, { signal: controller.signal });
    } catch {
      // 404 (no such ride) / 403 (not a participant) / network failure /
      // abort — all leave confirmed:false untouched. Never fabricate 'Принят'
      // from a failed or incomplete read.
      srv = null;
    }
    if (rideConfirmController !== controller || !root.isConnected) return;
    rideConfirmController = null;
    if (srv) applyConfirmedRide(srv);
  }

  const teardownObserver = new MutationObserver(() => {
    if (root.isConnected) {
      rootWasConnected = true;
    } else if (rootWasConnected) {
      teardownReads();
      teardownObserver.disconnect();
    }
  });
  teardownObserver.observe(document.body, { childList: true, subtree: true });

  function appendRefreshMessages(list) {
    if (!list.length) return;
    const wasNear = nearBottom();
    if (!threadShellReady) ensureThreadShell();
    let grew = false;
    for (const message of list) {
      if (renderMessage(message)) {
        grew = true;
        if (!messages.some((current) => keyOf(current) === keyOf(message))) messages.push(message);
      }
    }
    if (grew) {
      readState = CHAT_READ_STATE.LOADED;
      messagesEl.dataset.readState = CHAT_READ_STATE.LOADED;
      messagesEl.setAttribute('aria-busy', 'false');
    }
    if (grew && wasNear) scrollBottom();
  }

  async function refreshServerMessages(epoch) {
    if (!isCurrentRead(epoch) || readManager.isActive()) return;
    const pending = readManager.run(chatId, epoch, { supersede: false });
    if (!pending) return;
    let list;
    try {
      list = await pending;
    } catch {
      // A refresh failure is non-destructive: existing usable content,
      // optimistic bubbles, focus and scrollback remain untouched.
      return;
    }
    if (!isCurrentRead(epoch)) return;
    appendRefreshMessages(list);
  }

  function startPolling(epoch) {
    stopPolling();
    if (isTerminal || fixture) return;
    pollId = setInterval(() => {
      if (!isCurrentRead(epoch)) {
        stopPolling();
        readManager.cancel('chat poll epoch ended');
        return;
      }
      void refreshServerMessages(epoch);
    }, CHAT_POLL_MS);
  }

  async function loadInitialServerMessages() {
    const epoch = ++readEpoch;
    readManager.cancel('chat initial read superseded');
    stopPolling();
    initialFetchDone = false;
    renderReadState(CHAT_READ_STATE.LOADING);

    let list;
    try {
      list = await readManager.run(chatId, epoch, { supersede: true });
    } catch {
      if (!isCurrentRead(epoch)) return;
      renderReadState(CHAT_READ_STATE.ERROR);
      return;
    }
    if (!isCurrentRead(epoch)) return;

    initialFetchDone = true;
    renderReadState(list.length ? CHAT_READ_STATE.LOADED : CHAT_READ_STATE.EMPTY, list);
    startPolling(epoch);
    requestAnimationFrame(scrollBottom);
  }

  requestAnimationFrame(scrollBottom);

  // ── Quick replies ───────────────────────────────────────────────
  function syncComposerAvailability() {
    const readLocked = backendRead
      && (readState === CHAT_READ_STATE.LOADING || readState === CHAT_READ_STATE.ERROR);
    const writeLocked = isTerminal || Boolean(fixture) || readLocked;
    const composerEl = root.querySelector('.chat__composer');

    if (!isTerminal) {
      inputEl.disabled = writeLocked;
      inputEl.placeholder = fixture
        ? 'Режим предпросмотра'
        : readState === CHAT_READ_STATE.LOADING
          ? 'История загружается…'
          : readState === CHAT_READ_STATE.ERROR
            ? 'Сначала повторите загрузку'
            : 'Сообщение…';
    }
    if (composerEl) {
      composerEl.classList.toggle('chat__composer--read-locked', !isTerminal && writeLocked);
    }
    qrEl.setAttribute('aria-disabled', writeLocked ? 'true' : 'false');
    for (const chip of qrEl.querySelectorAll('[data-reply]')) chip.disabled = writeLocked;
    updateSend();
  }

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
    if (!chip || chip.disabled || inputEl.disabled || fixture) return;
    // #732 — append the quick reply to whatever the user already typed (separated by a space)
    // instead of overwriting it, so a chip tap never silently discards a half-written message.
    const existing = inputEl.value;
    const sep = existing && !/\s$/.test(existing) ? ' ' : '';
    // #749 — a programmatic inputEl.value bypasses the maxlength the browser enforces on typing,
    // so clamp the appended result to the composer's own limit.
    const maxLen = Number(inputEl.getAttribute('maxlength')) || 0;
    const appended = existing + sep + chip.dataset.reply;
    inputEl.value = maxLen > 0 ? appended.slice(0, maxLen) : appended;
    updateSend();
    inputEl.focus();
    // Keep the caret at the end so typing continues after the inserted reply.
    if (typeof inputEl.setSelectionRange === 'function') {
      const end = inputEl.value.length;
      inputEl.setSelectionRange(end, end);
    }
  });

  // ── Send button state ───────────────────────────────────────────
  function updateSend() {
    const has = inputEl.value.trim().length > 0;
    const enabled = has && !inputEl.disabled && !isTerminal && !fixture;
    sendBtn.disabled = !enabled;
    sendBtn.classList.toggle('chat__send--active', enabled);
  }

  inputEl.addEventListener('input', updateSend);
  syncComposerAvailability();

  const confirmBtn = root.querySelector('#chat-confirm');
  if (fixture && confirmBtn) confirmBtn.disabled = true;

  messagesEl.addEventListener('click', (event) => {
    const retry = event.target.closest('[data-action="retry-chat-read"]');
    if (!retry) return;
    if (fixture) {
      renderReadState(CHAT_READ_STATE.ERROR);
      return;
    }
    if (backendRead) void loadInitialServerMessages();
  });

  if (backendRead) void loadInitialServerMessages();
  // BD-CHAT-FALLBACK-02 — independent of the message read above: a one-shot
  // attempt to confirm a server-backed ride that missed the local store.
  if (hydration.pendingBackendConfirm) void confirmRideFromBackend();

  // ── Send ────────────────────────────────────────────────────────
  // BD-CHAT-01 (#18) — flag a bubble whose persist failed: a visual + AT failed state with an
  // explicit retry that re-persists and (on success) clears the failed state. The in-memory
  // `messages` array already holds the message; only the storage write failed.
  function markSendFailed(msgEl, msg) {
    if (!msgEl) return;
    msgEl.classList.add('chat__msg--failed');
    msgEl.setAttribute('aria-label', 'Вы · не отправлено');
    if (msgEl.querySelector('.chat__msg-failed')) return; // never stack a second retry row
    const foot = document.createElement('div');
    foot.className = 'chat__msg-failed';
    const note = document.createElement('span');
    note.className = 'chat__msg-failed-note';
    note.textContent = 'Не отправлено';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'chat__msg-retry';
    retry.textContent = 'Повторить';
    retry.setAttribute('aria-label', 'Повторить отправку');
    retry.addEventListener('click', () => {
      const ok = () => { clearSendFailed(msgEl); showNotice('Сообщение отправлено'); inputEl.focus(); };
      if (backendChat) {
        postServerMessage(chatId, msg).then(ok).catch(() => showNotice('Не удалось отправить сообщение — проверьте соединение.'));
      } else if (persistMessageInOrder(chatId, msg)) {
        ok();
      } else {
        showNotice('Не удалось сохранить сообщение — освободите место в хранилище.');
      }
    });
    foot.appendChild(note);
    foot.appendChild(retry);
    msgEl.appendChild(foot);
  }
  function clearSendFailed(msgEl) {
    if (!msgEl) return;
    msgEl.classList.remove('chat__msg--failed');
    msgEl.setAttribute('aria-label', 'Вы');
    const foot = msgEl.querySelector('.chat__msg-failed');
    if (foot) foot.remove();
  }

  function doSend() {
    if (fixture || isTerminal || inputEl.disabled) return;
    const text = inputEl.value.trim();
    if (!text) return;
    // On a live backend, wait for the first server fetch so the optimistic bubble can't land ahead of
    // older history (Codex #798). initialFetchDone is true immediately for off / terminal threads.
    if (backendChat && !initialFetchDone) { showNotice('Загрузка чата, подождите…'); return; }

    const now  = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // BD-CHAT-02 — `senderRole` is the canonical authorship field; readers
    // (driver and passenger viewers alike) compute incoming/outgoing from it.
    // `dir: 'out'` is retained as the legacy fallback for stores written
    // before senderRole existed and is correct here because this is the
    // local outgoing send.
    const msg = { id: Date.now(), senderRole: viewerRole, dir: 'out', text, time };
    messages = [...messages, msg];

    const msgEl = createMsgEl(msg, viewerRole, counterpart.name);
    // On a live backend, ensure the thread shell exists, append the optimistic bubble, and register
    // its id so the incremental poll dedups the server echo and never wipes the bubble (or its
    // failed-state retry) on the next tick.
    if (backendChat && !threadShellReady) ensureThreadShell();
    messagesEl.appendChild(msgEl);
    if (backendChat) {
      rendered.add(keyOf(msg));
      readState = CHAT_READ_STATE.LOADED;
      messagesEl.dataset.readState = CHAT_READ_STATE.LOADED;
      messagesEl.setAttribute('aria-busy', 'false');
    }
    scrollBottom();

    inputEl.value = '';
    updateSend();
    // BD-CHAT-01 (#4, a11y) — a click-send disables the (now-focused) send
    // button, which would otherwise drop focus to <body>; return focus to the
    // input so keyboard / screen-reader users keep their place and can keep
    // typing. (Mirrors the pinned active-ride pattern: focus moves off a
    // trigger that the action hides/disables.)
    inputEl.focus();
    // BD-CHAT-01 (#6 + #18) — a failed persist (quota / private mode) is both surfaced via a
    // notice AND flagged on the bubble itself, with an explicit retry, so an unsaved message is
    // never shown as an ordinary delivered one (screen-contracts state 7).
    // BD-CHAT-01 (#6 + #18) + #784 — persist the outgoing message: to the shared backend thread
    // when the backend is ON, else to local storage. A failed write flags the bubble (with retry)
    // and a notice, so an unsaved message is never shown as an ordinary delivered one.
    if (backendChat) {
      postServerMessage(chatId, msg).catch(() => {
        markSendFailed(msgEl, msg);
        showNotice('Не удалось отправить сообщение — проверьте соединение.');
      });
    } else if (!appendMessage(chatId, msg)) {
      markSendFailed(msgEl, msg);
      showNotice('Не удалось сохранить сообщение — освободите место в хранилище.');
    }
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
      if (fixture || confirming || confirmBtn.disabled) return;
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
