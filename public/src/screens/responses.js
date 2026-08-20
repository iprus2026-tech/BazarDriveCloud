import { go } from '../router.js';
import { trapFocus } from '../overlay.js';
import { escapeHtml } from '../util.js';
import { acceptOrder, getOrderById, listOrderOffers, selectOfferOnBackend } from '../mock_api.js';
import { isBackendEnabled } from '../api_config.js';
import { createDemoActiveRide, findActiveRide, saveActiveRide, RIDE_STATUS } from '../ride_state.js';

// BD-RESPOND-ORDER-LINK-02 — read-side store. /respond writes a
// passenger_response into this keyed map; this screen reads it back to surface
// real driver responses on the board. Read-only here: never written from
// /responses (respond.js / chat.js own writes + the user-scoped clear).
const RESPONSES_KEY = 'bazardrive.responses.v1';

const MOCK_REQUEST = {
  id:          'post_1001',
  orderId:     'order_1001',
  passengerId: 'user_1001',
  status:      'PUBLISHED',
  pickupLabel: 'ТЦ Мега',
  dropoffLabel:'Аэропорт, терминал B',
  price:       '950 ₽',
  numericPrice: 950,
  note:        'Маленький чемодан',
};

const MOCK_DRIVERS = [
  {
    id:            'driver_1',
    responseId:    'response_1',
    name:          'Рустам К.',
    initials:      'РК',
    avatarTone:    'mint',
    rating:        '4,92',
    car:           'Toyota Camry · серый',
    carModel:      'Toyota Camry',
    carColor:      'серый',
    plate:         'A 124 BB 77',
    trips:         '1248 поездок',
    priceDelta:    'как у вас',
    priceTone:     'same',
    eta:           '4 мин',
    etaBars:       3,
    etaTone:       'good',
    note:          'Подъеду к подъезду №3, позвоню.',
    isBest:        true,
  },
  {
    id:            'driver_2',
    responseId:    'response_2',
    name:          'Сергей Л.',
    initials:      'СЛ',
    avatarTone:    'amber',
    rating:        '4,78',
    car:           'Hyundai Solaris · белый',
    carModel:      'Hyundai Solaris',
    carColor:      'белый',
    plate:         'B 902 AO 77',
    trips:         '612 поездок',
    priceDelta:    '+150 ₽',
    priceTone:     'up',
    eta:           '7 мин',
    etaBars:       2,
    etaTone:       'mid',
    note:          '',
    isBest:        false,
  },
  {
    id:            'driver_3',
    responseId:    'response_3',
    name:          'Нурлан',
    initials:      'Н',
    avatarTone:    'violet',
    rating:        '4,88',
    car:           'Kia Rio · чёрный',
    carModel:      'Kia Rio',
    carColor:      'чёрный',
    plate:         'K 581 XK 77',
    trips:         '304 поездок',
    priceDelta:    '-50 ₽',
    priceTone:     'down',
    eta:           '12 мин',
    etaBars:       1,
    etaTone:       'low',
    note:          '',
    isBest:        false,
  },
];

const BACK_SVG = `
  <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="11 4 6 9 11 14"/>
  </svg>`;

const SHIELD_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="18" height="18">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>`;

const PENCIL_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="14" height="14">
    <path d="M12 20h9"/>
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>
  </svg>`;

const CAR_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="28" height="28">
    <path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1l2-4h10l2 4h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/>
    <circle cx="7.5" cy="17.5" r="2.5"/>
    <circle cx="16.5" cy="17.5" r="2.5"/>
  </svg>`;

const SPARK_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="16" height="16">
    <path d="M12 2v4"/>
    <path d="M12 18v4"/>
    <path d="M4.93 4.93l2.83 2.83"/>
    <path d="M16.24 16.24l2.83 2.83"/>
    <path d="M2 12h4"/>
    <path d="M18 12h4"/>
    <path d="M4.93 19.07l2.83-2.83"/>
    <path d="M16.24 7.76l2.83-2.83"/>
  </svg>`;

const INFO_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="16" height="16">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="8" x2="12" y2="12"/>
    <line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>`;

const STAR_SVG = `
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
       width="14" height="14">
    <path d="M12 17.27l-5.18 3.04 1.4-5.95-4.55-3.94 6-.5L12 4l2.33 5.92 6 .5-4.55 3.94 1.4 5.95z"/>
  </svg>`;

const CHECK_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="16" height="16">
    <polyline points="5 12 10 17 19 7"/>
  </svg>`;

const PHONE_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="18" height="18">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.56 2.81.69A2 2 0 0 1 22 16.92z"/>
  </svg>`;

const CHAT_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="18" height="18">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
  </svg>`;

const CLOSE_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="18" height="18">
    <line x1="6" y1="6" x2="18" y2="18"/>
    <line x1="6" y1="18" x2="18" y2="6"/>
  </svg>`;

const QUOTE_SVG = `
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
       width="14" height="14">
    <path d="M9 7H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2v1a3 3 0 0 1-3 3v2a5 5 0 0 0 5-5V9a2 2 0 0 0 0-2zm12 0h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2v1a3 3 0 0 1-3 3v2a5 5 0 0 0 5-5V9a2 2 0 0 0 0-2z"/>
  </svg>`;

function getRouteParam(name) {
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  if (qi === -1) return null;
  return new URLSearchParams(hash.slice(qi + 1)).get(name);
}

// BD-CLOUD-DESIGN-LOADING-02A — request-state previews live beside the
// existing domain `state` query instead of overloading it. Unknown values are
// deliberately ignored so a misspelled fixture follows normal runtime.
const RESPONSE_FIXTURES = new Set(['loading', 'loaded', 'empty', 'error']);

function getResponsesFixture() {
  const value = getRouteParam('fixture') || '';
  return RESPONSE_FIXTURES.has(value) ? value : '';
}

function requestFromFixture(explicitOrderId = '') {
  const orderId = String(explicitOrderId || 'order_demo').trim() || 'order_demo';
  return {
    ...MOCK_REQUEST,
    id: orderId,
    orderId,
    legacyPostId: '',
    time: 'Сейчас',
    isFallback: false,
    isLegacyMock: false,
    isFixture: true,
  };
}

function markFeedTabActive() {
  const tabbar = document.getElementById('tabbar');
  if (!tabbar) return;
  for (const btn of tabbar.querySelectorAll('[data-route]')) {
    btn.classList.toggle('active', btn.dataset.route === '/feed');
  }
}

function responsesWord(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'отклик';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'отклика';
  return 'откликов';
}

function pointLabel(point, fallback) {
  if (point && typeof point === 'object' && typeof point.label === 'string' && point.label.trim()) {
    return point.label.trim();
  }
  return fallback;
}

function formatRub(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${Math.round(n).toLocaleString('ru-RU')} ₽`;
}

function moneyLabelFromOrder(order) {
  const savedLabel = typeof order?.estimatedPriceLabel === 'string' ? order.estimatedPriceLabel.trim() : '';
  if (savedLabel) return /₽\s*$/.test(savedLabel) ? savedLabel : `${savedLabel} ₽`;
  return formatRub(order?.estimatedPrice);
}

function resolveCanonicalOrder() {
  const explicitOrderId = getRouteParam('orderId');
  if (!explicitOrderId) return null;
  return getOrderById(explicitOrderId);
}

function formatOrderTime(order) {
  const label = typeof order?.scheduledLabel === 'string' ? order.scheduledLabel.trim() : '';
  if (label) return label;
  if (order?.scheduledMode === 'later' && order?.scheduledAt) {
    const date = new Date(order.scheduledAt);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
  }
  return 'Сейчас';
}

function requestFromLegacyPost(postId = '') {
  const legacyPostId = String(postId || '').trim();
  return {
    ...MOCK_REQUEST,
    id: legacyPostId || MOCK_REQUEST.id,
    orderId: '',
    legacyPostId,
    time: 'Сейчас',
    isFallback: false,
    isLegacyMock: true,
  };
}

export function requestFromOrder(order, explicitOrderId = '') {
  if (!order) {
    const orderId = String(explicitOrderId || '').trim();
    const hasOrderId = !!orderId;
    return {
      ...MOCK_REQUEST,
      id: orderId || 'responses-fallback',
      orderId,
      pickupLabel: hasOrderId ? 'Заказ не найден' : 'Заказ пока не выбран',
      dropoffLabel: hasOrderId ? 'Откройте опубликованный заказ с карты' : 'Опубликуйте заказ или вернитесь на карту',
      price: '—',
      numericPrice: 0,
      note: hasOrderId
        ? 'Детали заказа недоступны. Можно безопасно проверить отклики или вернуться на карту.'
        : 'Когда заказ будет опубликован, здесь появятся маршрут, бюджет, время и комментарий.',
      time: '—',
      isFallback: true,
    };
  }
  const price = moneyLabelFromOrder(order) || MOCK_REQUEST.price;
  const numericPrice = Number(order.estimatedPrice) || MOCK_REQUEST.numericPrice;
  const note = String(order.comment || order.passenger?.comment || '').trim();
  return {
    id: String(order.id || MOCK_REQUEST.id),
    orderId: String(order.id || MOCK_REQUEST.orderId),
    passengerId: String(order.passenger?.authorId || MOCK_REQUEST.passengerId),
    status: 'PUBLISHED',
    pickupLabel: pointLabel(order.pickup, 'Точка подачи'),
    dropoffLabel: pointLabel(order.dropoff, 'Точка назначения'),
    price,
    numericPrice,
    note: note || 'Комментарий не указан',
    time: formatOrderTime(order),
    isFallback: false,
  };
}

function driverPrice(base, offset) {
  if (!Number.isFinite(base) || base <= 0) return null;
  return Math.max(0, Math.round(base + offset));
}

function buildDrivers(request) {
  const base = Number(request.numericPrice);
  const offsets = [0, 150, -50];
  return MOCK_DRIVERS.map((driver, index) => {
    const value = driverPrice(base, offsets[index]);
    const fallbackPrice = request.isFallback ? 'По договорённости' : (index === 0 ? request.price : MOCK_REQUEST.price);
    return {
      ...driver,
      price: value ? formatRub(value) : fallbackPrice,
    };
  });
}

// BD-RESPOND-ORDER-LINK-02 — read-side canonical response integration.
// /respond stores a passenger_response in bazardrive.responses.v1 keyed by
// resp_<post.id>; for a canonical ride-order post it additively pins
// orderId + canonical:'ride_order' (BD-RESPOND-ORDER-LINK-01 / #368). Here we
// read those real responses back for the current canonical order and surface
// them on the driver board, falling back to MOCK_DRIVERS when none match.
//
// Strictly read-only: it parses the keyed store and never writes it. The
// accept → active-ride handoff (buildPassengerActiveRide) is untouched and
// still keys on the canonical order, so a real or mock card seed the same trip.
function loadResponsesForOrder(orderId) {
  const id = String(orderId || '').trim();
  if (!id) return [];
  try {
    const raw = localStorage.getItem(RESPONSES_KEY);
    if (!raw) return [];
    const map = JSON.parse(raw);
    if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
    return Object.values(map).filter((r) =>
      r && typeof r === 'object'
      && r.kind === 'passenger_response'
      && String(r.orderId || '') === id);
  } catch {
    return [];
  }
}

// BD-RIDE-AUTHORITY-01B — Direct by-id lookup into the same keyed store
// loadResponsesForOrder reads, for callers (trip_confirmation_handoff.js)
// that only have a responseId (e.g. from a confirmed /trip-confirmation
// handoff) and not yet an orderId to scope the search by. Read-only,
// mirrors chat.js's private loadResponse().
export function resolveResponseById(responseId) {
  const id = typeof responseId === 'string' ? responseId.trim() : '';
  if (!id) return null;
  try {
    const raw = localStorage.getItem(RESPONSES_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw);
    if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
    const r = map[id];
    return (r && typeof r === 'object' && r.kind === 'passenger_response') ? r : null;
  } catch {
    return null;
  }
}

// BD-LIFE-05 — Build a flat, type-guarded driverSnapshot view of one stored
// passenger_response. Returns null when the response is missing, malformed,
// or carries no usable `name`. localStorage is treated as untrusted at this
// boundary so any drift in stored shape fails closed instead of rendering
// "undefined" strings into the UI.
function buildDriverSnapshotFromResponse(response) {
  if (!response || typeof response !== 'object') return null;
  const snap = response.driverSnapshot;
  if (!snap || typeof snap !== 'object') return null;
  const pickStr = (v) => (typeof v === 'string' ? v.trim() : '');
  const name = pickStr(snap.name);
  if (!name) return null;
  return {
    name,
    rating:   (typeof snap.rating === 'number' && Number.isFinite(snap.rating)) ? snap.rating : null,
    car:      pickStr(snap.car),
    carModel: pickStr(snap.carModel),
    carColor: pickStr(snap.carColor),
    plate:    pickStr(snap.plate),
    responseId: typeof response.id === 'string' ? response.id : null,
  };
}

// BD-LIFE-05 — Latest passenger_response by createdAt for an order. Type-
// guarded, returns null when no usable record exists.
//
// SAFETY NOTE (Codex P1): this helper is intentionally NOT called from the
// live accepted-ride upgrade path anymore. Live rides that lack an explicit
// responseId pinning could have been accepted via a path that does not pin
// the response (DriverMap accept, ride_actions, future canonical accept) —
// in that case the "latest" record may belong to a different driver, and
// using it would silently rewrite the accepted driver's identity. The
// resolveDriverSnapshotForRide chain below therefore returns null for
// unpinned rides instead of guessing. This export is preserved as a helper
// for unit tests and legacy/diagnostic surfaces only.
export function resolveLatestDriverSnapshotForOrder(orderId) {
  const responses = loadResponsesForOrder(orderId);
  if (!Array.isArray(responses) || responses.length === 0) return null;
  let latest = null;
  let latestTs = -Infinity;
  for (const r of responses) {
    const snap = buildDriverSnapshotFromResponse(r);
    if (!snap) continue;
    const ts = Date.parse(typeof r.createdAt === 'string' ? r.createdAt : '');
    const ord = Number.isFinite(ts) ? ts : 0;
    if (ord <= latestTs) continue;
    latestTs = ord;
    latest = snap;
  }
  return latest;
}

// BD-LIFE-05 (Codex P2 + P1) — Resolve the snapshot that matches the driver
// actually accepted on this ride. The only safe source of "this is the
// accepted driver" is an explicit pinning written at the accept seam:
// `ride.selectedDriver.responseId` (set today by buildPassengerActiveRide
// when the passenger picks a driver from /responses). When that link is
// present we look up THAT specific passenger_response and return its
// snapshot.
//
// SAFETY > RECOVERY (Codex P1): when the ride has NO `selectedDriver.responseId`
// — typical of DriverMap accept, acceptCanonicalRideOrder, or any other
// path that produces an active ride without going through /responses — we
// return null and the orchestrator above is a no-op. Falling back to "the
// latest passenger_response for this order" would silently rewrite the
// accepted driver to whichever responder happened to write the newest
// record. The right fix for those accept paths is to set the responseId at
// the accept seam, not to guess at the render seam.
//
// When pinnedId IS set but the matching response is missing/malformed in
// localStorage we also return null (do not fall back to latest) for the
// same reason: a corrupted record must never let an unrelated responder
// take the accepted driver's slot.
export function resolveDriverSnapshotForRide(ride, orderId) {
  const pinnedId = typeof ride?.selectedDriver?.responseId === 'string'
    ? ride.selectedDriver.responseId.trim() : '';
  if (!pinnedId) return null;
  const responses = loadResponsesForOrder(orderId);
  const pinnedResponse = Array.isArray(responses)
    ? responses.find((r) => r && r.id === pinnedId)
    : null;
  return buildDriverSnapshotFromResponse(pinnedResponse);
}

// BD-LIFE-05 (Codex P2) — Single-call orchestrator that loads the stored
// active ride for an order, resolves the right driverSnapshot for it
// (pinned-by-responseId first, latest fallback), upgrades the ride, and
// persists the upgrade when one applied. Returns:
//   • null            — no order id, or no ride at trip_<orderId>;
//   • the stored ride — when no usable snapshot exists or no upgrade is
//                       needed (terminal status, idempotent fast-path);
//   • the new ride    — when an upgrade applied AND was persisted.
// Used by both /responses (handoff render + buildPassengerActiveRide reuse)
// and active_ride_passenger.js (direct-entry load) so the same data fix
// fires regardless of how the passenger arrives at the ride.
export function upgradeStoredActiveRideForOrder(orderId) {
  const id = String(orderId || '').trim();
  if (!id) return null;
  const tripId = `trip_${id}`;
  const ride = findActiveRide(tripId);
  if (!ride) return null;
  const snap = resolveDriverSnapshotForRide(ride, id);
  if (!snap) return ride;
  const upgraded = upgradeRideFromDriverSnapshot(ride, snap);
  if (upgraded !== ride) saveActiveRide(upgraded);
  return upgraded;
}

// BD-LIFE-05 — Upgrade a stored active ride from the latest real
// driverSnapshot so a passenger handoff card and /active-ride render the
// actual driver, not the "Рустам К." demo seed. Returns a NEW ride object
// when an upgrade applies; returns the input ride unchanged when the
// snapshot is missing/invalid, the ride is terminal, or the ride already
// reflects the snapshot identity. The caller is responsible for persisting
// the returned ride via saveActiveRide() when it differs by reference from
// the input.
const TERMINAL_RIDE_STATUSES = new Set([
  RIDE_STATUS.COMPLETED, RIDE_STATUS.CANCELED, RIDE_STATUS.NO_SHOW,
]);

export function upgradeRideFromDriverSnapshot(ride, snapshot) {
  if (!ride || typeof ride !== 'object') return ride;
  if (!snapshot || typeof snapshot !== 'object') return ride;
  const name = typeof snapshot.name === 'string' ? snapshot.name.trim() : '';
  if (!name) return ride;
  if (TERMINAL_RIDE_STATUSES.has(ride.status)) return ride;
  const incomingPlate = typeof snapshot.plate === 'string' ? snapshot.plate : '';
  const currentName  = typeof ride.driver?.name   === 'string' ? ride.driver.name  : '';
  const currentPlate = typeof ride.vehicle?.plate === 'string' ? ride.vehicle.plate : '';
  // Idempotent fast-path: identity already matches → no upgrade needed.
  if (currentName === name && currentPlate === incomingPlate) return ride;
  const driver = { ...(ride.driver || {}), name, initials: name.charAt(0).toUpperCase() };
  if (snapshot.rating !== null && snapshot.rating !== undefined) driver.rating = snapshot.rating;
  const vehicle = { ...(ride.vehicle || {}) };
  if (snapshot.carModel)       vehicle.model = snapshot.carModel;
  else if (snapshot.car)       vehicle.model = snapshot.car;
  if (snapshot.carColor)       vehicle.color = snapshot.carColor;
  if (snapshot.plate)          vehicle.plate = snapshot.plate;
  const selectedBase = (ride.selectedDriver && typeof ride.selectedDriver === 'object') ? ride.selectedDriver : {};
  const selectedDriver = { ...selectedBase, name };
  if (snapshot.responseId)               selectedDriver.responseId = snapshot.responseId;
  if (snapshot.rating !== null && snapshot.rating !== undefined) selectedDriver.rating = snapshot.rating;
  if (snapshot.car)                      selectedDriver.car   = snapshot.car;
  if (snapshot.plate)                    selectedDriver.plate = snapshot.plate;
  return { ...ride, driver, vehicle, selectedDriver };
}

// pickupTiming on the stored response is a coarse enum; map it to the short
// "Подача" label the card already renders. Unknown / missing → em-dash.
const PICKUP_TIMING_LABELS = {
  at_time:   'К времени',
  earlier:   'Можно раньше',
  negotiate: 'Договоримся',
};
function timingLabel(timing) {
  return PICKUP_TIMING_LABELS[timing] || '—';
}
// Fastest → slowest pickup intent, used as the «Быстрее» tiebreak for real
// responses (which all share etaBars and carry a non-numeric label, so
// etaMinutes cannot separate them). Lower rank = sooner.
const PICKUP_TIMING_RANK = { earlier: 0, at_time: 1, negotiate: 2 };

// Map a real passenger_response into the exact card shape renderDriverCard /
// renderOffer consume. Real fields: price (driverPrice), note (message) and a
// real responseId (so /chat?responseId resolves the same handoff). The stored
// response does not capture driver identity, so name/rating/car/plate use
// neutral, CSS-valid placeholders. EVERY field is filled — escapeHtml turns
// undefined into the literal "undefined", and each tone must map to a real
// class (avatar mint/amber/violet, delta same/up/down, eta good/mid/low).
export function mapResponseToDriverCard(response, request, index) {
  const responseId = String(response.id || `response_${index + 1}`);
  const value = Number(response.driverPrice);
  // BD-RIDE-AUTHORITY-01B — request.price already carries requestFromOrder's
  // own MOCK_REQUEST.price fallback baked in (for its unrelated MOCK_DRIVERS
  // board use), so it cannot be trusted here to distinguish a real
  // order-derived price from a demo placeholder. A canonical real order +
  // real response with an invalid driverPrice must show a controlled
  // missing value, never a fabricated mock number.
  const price = Number.isFinite(value) && value > 0
    ? formatRub(value)
    : (request.isFallback ? 'По договорённости' : '—');
  const note = typeof response.message === 'string' ? response.message.trim() : '';
  // BD-RIDE-ORDER-01 — when respond.js attached a flat driverSnapshot to the
  // stored response, render the driver card from it. Legacy responses (and
  // any future write paths that omit the snapshot) keep the original neutral
  // placeholders unchanged — every key in the returned object stays defined
  // so escapeHtml never sees `undefined` (see comment above).
  //
  // localStorage is treated as untrusted: stale QA data, partially malformed
  // payloads or schema drift may leave non-string values on the snapshot.
  // Type-check each field before .trim() so one bad record cannot abort the
  // whole responses render path.
  const snap = (response && typeof response.driverSnapshot === 'object' && response.driverSnapshot !== null)
    ? response.driverSnapshot
    : null;
  const pickStr = (v) => (typeof v === 'string' ? v.trim() : '');
  const snapName = pickStr(snap?.name);
  const initials = snapName ? snapName.slice(0, 1).toUpperCase() : 'В';
  return {
    id:         responseId,
    responseId,
    name:       snapName || 'Водитель',
    initials,
    avatarTone: 'mint',
    rating:     (snap && typeof snap.rating === 'number') ? snap.rating.toFixed(1) : '—',
    car:        pickStr(snap?.car),
    carModel:   pickStr(snap?.carModel),
    carColor:   pickStr(snap?.carColor),
    plate:      pickStr(snap?.plate),
    trips:      '',
    price,
    priceDelta: '',
    priceTone:  'same',
    eta:        timingLabel(response.pickupTiming),
    etaTone:    'mid',
    etaBars:    2,
    // Sort signal for «Быстрее»: real cards share a non-numeric eta label, so
    // the pickup-timing rank is what orders them (earlier < at_time < negotiate).
    etaRank:    Number.isInteger(PICKUP_TIMING_RANK[response.pickupTiming])
                  ? PICKUP_TIMING_RANK[response.pickupTiming] : 1,
    note,
    isBest:     index === 0,
  };
}

// Driver board source of truth. Real canonical responses win when the resolved
// order has any; otherwise the MOCK_DRIVERS board is preserved unchanged for
// every fallback path: no orderId, no real response, legacy postId flow, and
// the fallback/QA request (request.isFallback).
function buildDriversForOrder(request, serverOffers, backendAuthoritative) {
  // #784 CUT-4: when the backend is AUTHORITATIVE (on + a real, non-fallback order), the owner's
  // board IS the SERVER offers — an EMPTY array is authoritative too (an honest empty board, NEVER
  // the local MOCK_DRIVERS, which carry no driverId and would mint a phantom server-less ride on
  // select). OFF / not-authoritative, the call is byte-identical to the prior local/mock behaviour.
  if (backendAuthoritative) {
    // #784 CUT-4: GET /offers returns ALL rows, but POST /select only accepts a 'sent', non-expired
    // offer (else 404). Show only LIVE+selectable cards so the passenger can't tap an offer that
    // would fail on select. All filtered out -> empty array -> the honest empty state handles it.
    return Array.isArray(serverOffers)
      ? serverOffers
          .filter((o) => o && o.status === 'sent' && (!o.expiresAt || Date.parse(o.expiresAt) > Date.now()))
          .map((offer, index) => mapServerOfferToDriverCard(offer, request, index))
      : [];
  }
  const real = (request && request.orderId && !request.isFallback)
    ? loadResponsesForOrder(request.orderId)
    : [];
  if (real.length) {
    return real.map((response, index) => mapResponseToDriverCard(response, request, index));
  }
  return buildDrivers(request);
}

// #784 CUT-4 — map a SERVER offer (serializeOffer: {id, orderId, driverId,
// driverName, car, price}) into the exact card shape renderDriverCard/renderOffer
// consume, mirroring mapResponseToDriverCard. The extra `driverId` field carries
// the server identity POST /matching/select needs; `responseId` is a stable id so
// the select-seam pin (buildPassengerActiveRide → selectedDriver.responseId) and
// the /chat?responseId handoff keep working. Every field stays defined so
// escapeHtml never renders the literal "undefined".
function mapServerOfferToDriverCard(offer, request, index) {
  const pickStr = (v) => (typeof v === 'string' ? v.trim() : '');
  const driverId = pickStr(offer && offer.driverId);
  const responseId = `resp_${driverId || `offer_${index + 1}`}`;
  const name = pickStr(offer && offer.driverName) || 'Водитель';
  const value = Number(offer && offer.price);
  const price = Number.isFinite(value) && value > 0
    ? formatRub(value)
    : (request.isFallback ? 'По договорённости' : (request.price || MOCK_REQUEST.price));
  return {
    id:         responseId,
    responseId,
    driverId,
    name,
    initials:   name.slice(0, 1).toUpperCase(),
    avatarTone: 'mint',
    rating:     '—',
    car:        pickStr(offer && offer.car),
    carModel:   pickStr(offer && offer.car),
    carColor:   '',
    plate:      '',
    trips:      '',
    price,
    priceDelta: '',
    priceTone:  'same',
    eta:        '—',
    etaTone:    'mid',
    etaBars:    2,
    etaRank:    1,
    note:       pickStr(offer && offer.message),
    isBest:     index === 0,
  };
}

function renderEtaBars(active) {
  let html = '';
  for (let i = 1; i <= 3; i++) {
    const filled = i <= active ? ' is-on' : '';
    html += `<span class="responses__eta-bar${filled}"></span>`;
  }
  return html;
}

// BD-RESPONSES-01 — inline segmented sort. Modes reorder the driver board in
// place (no route, no backend). Sorting is a derived VIEW: it never mutates the
// `drivers` array built by buildDriversForOrder, so the read-side board source
// of truth is preserved.
const SORT_MODES = [
  { key: 'best',   label: 'Лучшие'  },
  { key: 'eta',    label: 'Быстрее' },
  { key: 'price',  label: 'Дешевле' },
  { key: 'rating', label: 'Рейтинг' },
];

// Parse a rating string into a comparable number. Mock cards use a comma
// decimal ("4,92"); response-derived cards use a dot ("4.8") or "—" when the
// snapshot had no numeric rating. Non-numeric ratings sort to the bottom.
function ratingValue(driver) {
  const n = parseFloat(String(driver && driver.rating).replace(',', '.'));
  return Number.isFinite(n) ? n : -Infinity;
}

// Lower ETA = faster. `etaBars` (3 = fastest … 1 = slowest) is the reliable
// numeric signal on both card shapes; parse the "N мин" string as a tiebreak.
function etaMinutes(driver) {
  const m = String(driver && driver.eta).match(/\d+/);
  return m ? Number(m[0]) : Infinity;
}

// Pickup-timing rank tiebreak for «Быстрее». Mock cards have a numeric eta so
// etaMinutes already separates them (etaRank stays the neutral 1); real cards
// share etaMinutes=Infinity, so this rank is what orders them.
function etaRank(driver) {
  return Number.isInteger(driver && driver.etaRank) ? driver.etaRank : 1;
}

// Cheaper first. The reliable signal is the formatted absolute price on every
// card ("1 200 ₽", real or mock) — parse its digits. Real passenger_response
// cards all carry priceTone:'same', so priceTone alone cannot order them; the
// numeric price is the primary key and priceTone is only a tiebreak. A card
// with no numeric price ("По договорённости") sorts last.
function priceValue(driver) {
  const digits = String(driver && driver.price).replace(/[^\d]/g, '');
  return digits ? Number(digits) : Infinity;
}
const PRICE_RANK = { down: 0, same: 1, up: 2 };
function priceRank(driver) {
  const r = PRICE_RANK[driver && driver.priceTone];
  return Number.isInteger(r) ? r : 1;
}

// Stable derived sort. Every comparator falls back to the original index so the
// board order is deterministic and ties never reshuffle on re-render.
function sortDrivers(drivers, mode) {
  const indexed = drivers.map((driver, index) => ({ driver, index }));
  const byIndex = (a, b) => a.index - b.index;
  let cmp;
  if (mode === 'eta') {
    cmp = (a, b) => (etaMinutes(a.driver) - etaMinutes(b.driver))
      || (etaRank(a.driver) - etaRank(b.driver))
      || (b.driver.etaBars - a.driver.etaBars) || byIndex(a, b);
  } else if (mode === 'price') {
    cmp = (a, b) => (priceValue(a.driver) - priceValue(b.driver))
      || (priceRank(a.driver) - priceRank(b.driver)) || byIndex(a, b);
  } else if (mode === 'rating') {
    cmp = (a, b) => (ratingValue(b.driver) - ratingValue(a.driver)) || byIndex(a, b);
  } else {
    // 'best' (default): recommended cards first, otherwise original order.
    cmp = (a, b) => (Number(!!b.driver.isBest) - Number(!!a.driver.isBest)) || byIndex(a, b);
  }
  return indexed.sort(cmp).map((entry) => entry.driver);
}

function renderDriverCard(driver, selectedDriverId, declinedFlag) {
  const isDeclined = !!declinedFlag;
  const isSelected = !isDeclined && selectedDriverId && driver.id === selectedDriverId;
  const isDimmed   = !isDeclined && selectedDriverId && !isSelected;

  // A declined card swaps the best ribbon for an «Отклонено» badge so the
  // muted state is legible at a glance (BD-RESPONSES-01).
  const topBadge = isDeclined
    ? `<div class="responses__declined-badge">Отклонено</div>`
    : (driver.isBest
        ? `<div class="responses__driver-best">
             ${SPARK_SVG}
             <span>Лучший вариант</span>
           </div>`
        : '');

  const noteBlock = driver.note
    ? `<div class="responses__driver-note">
         <span class="responses__driver-note-icon" aria-hidden="true">${QUOTE_SVG}</span>
         <span class="responses__driver-note-text">${escapeHtml(driver.note)}</span>
       </div>`
    : '';

  let actionsBlock;
  if (isDeclined) {
    actionsBlock = `
      <div class="responses__declined-row">
        <span class="responses__declined-icon" aria-hidden="true">${CLOSE_SVG}</span>
        <span class="responses__declined-text">Вы отклонили этого водителя</span>
        <button type="button" class="responses__declined-restore" data-action="restore">Вернуть</button>
      </div>`;
  } else if (isSelected) {
    actionsBlock = `
      <div class="responses__selected-panel" role="status" aria-live="polite">
        <span class="responses__selected-icon" aria-hidden="true">${CHECK_SVG}</span>
        <span class="responses__selected-text">Водитель выбран · маршрут готов к открытию</span>
        <button type="button" class="responses__selected-open" data-action="continue">К поездке</button>
        <button type="button" class="responses__selected-cancel" data-action="cancel">Отменить</button>
      </div>`;
  } else {
    actionsBlock = `
      <div class="responses__driver-actions">
        <button type="button" class="bd-btn primary responses__driver-select" data-action="select">
          ${CHECK_SVG}
          <span>Выбрать водителя</span>
        </button>
        <button type="button" class="responses__driver-side" data-action="chat" aria-label="Чат с водителем">
          ${CHAT_SVG}
        </button>
        <button type="button" class="responses__driver-side" data-action="decline" aria-label="Отклонить">
          ${CLOSE_SVG}
        </button>
      </div>`;
  }

  const dismissBtn = isDeclined
    ? ''
    : `<button type="button" class="responses__driver-dismiss" data-action="decline" aria-label="Скрыть отклик">
         ${CLOSE_SVG}
       </button>`;

  const classes = [
    'responses__driver',
    driver.isBest ? 'responses__driver--best' : '',
    isSelected ? 'responses__driver--selected' : '',
    isDimmed ? 'responses__driver--dimmed' : '',
    isDeclined ? 'responses__driver--declined' : '',
  ].filter(Boolean).join(' ');

  return `
    <article class="${classes}"
             data-driver-id="${escapeHtml(driver.id)}"
             data-response-id="${escapeHtml(driver.responseId)}">
      ${topBadge}
      <div class="responses__driver-head">
        <div class="responses__avatar responses__avatar--${escapeHtml(driver.avatarTone)}" aria-hidden="true">${escapeHtml(driver.initials)}</div>
        <div class="responses__driver-info">
          <div class="responses__driver-line">
            <span class="responses__driver-name">${escapeHtml(driver.name)}</span>
            <span class="responses__driver-rating">${STAR_SVG}<span>${escapeHtml(driver.rating)}</span></span>
          </div>
          <div class="responses__driver-car">${escapeHtml(driver.car)}</div>
          <div class="responses__driver-meta">
            <span>${escapeHtml(driver.plate)}</span>
            <span class="responses__driver-dot" aria-hidden="true">·</span>
            <span>${escapeHtml(driver.trips)}</span>
          </div>
        </div>
        ${dismissBtn}
      </div>
      <div class="responses__driver-stats">
        <div class="responses__stat">
          <div class="responses__stat-label">Цена</div>
          <div class="responses__stat-row">
            <span class="responses__stat-value">${escapeHtml(driver.price)}</span>
            <span class="responses__delta responses__delta--${escapeHtml(driver.priceTone)}">${escapeHtml(driver.priceDelta)}</span>
          </div>
        </div>
        <div class="responses__stat">
          <div class="responses__stat-label">Подача</div>
          <div class="responses__stat-row">
            <span class="responses__stat-value">${escapeHtml(driver.eta)}</span>
            <span class="responses__eta responses__eta--${escapeHtml(driver.etaTone)}" aria-hidden="true">
              ${renderEtaBars(driver.etaBars)}
            </span>
          </div>
        </div>
      </div>
      ${noteBlock}
      ${actionsBlock}
    </article>
  `;
}

function renderOrderMeta(request) {
  return `
    <div class="responses__request-meta" aria-label="Детали заказа">
      <div class="responses__request-meta-item">
        <span class="responses__request-meta-label">Время</span>
        <span class="responses__request-meta-value">${escapeHtml(request.time || 'Сейчас')}</span>
      </div>
      <div class="responses__request-meta-item">
        <span class="responses__request-meta-label">Бюджет</span>
        <span class="responses__request-meta-value">${escapeHtml(request.price)}</span>
      </div>
    </div>`;
}

// BD-ORDER-P-02A — context-aware empty state. When the order resolved
// (isFallback=false), assert it is published. When the orderId is unknown,
// avoid "Заказ опубликован" — the order context was not resolvable. When
// no orderId was supplied, guide the passenger back to the map.
function renderEmptyState(request, opts = {}) {
  const isFallback = !!(request && request.isFallback);
  const hasOrderId = !!(request && request.orderId);

  let title = 'Ищем водителей';
  let body;
  let hint1;
  let hint2;

  if (opts.error) {
    // #784 CUT-4: the live offers read failed — honest retry copy (the «Проверить отклики» footer
    // re-runs the screen and re-fetches GET /matching/offers), never fabricated drivers.
    title = 'Не удалось загрузить отклики';
    body = 'Проверьте соединение и нажмите «Проверить отклики», чтобы повторить.';
    hint1 = 'Нажмите «Проверить отклики», чтобы повторить';
    hint2 = 'Маршрут уже виден водителям рядом';
  } else if (isFallback && hasOrderId) {
    body = 'Не удалось открыть детали заказа. Вернитесь на карту или откройте опубликованный заказ ещё раз.';
    hint1 = 'Откройте заказ с карты или из ленты';
    hint2 = 'После публикации маршрут будет виден водителям рядом';
  } else if (isFallback) {
    body = 'Опубликуйте заказ с карты — водители рядом увидят маршрут и смогут откликнуться.';
    hint1 = 'Вернитесь на карту и опубликуйте маршрут';
    hint2 = 'Отклики появятся здесь после публикации';
  } else {
    body = 'Заказ опубликован. Водители увидят маршрут и смогут откликнуться. Обычно первый отклик приходит за 1–3 минуты.';
    hint1 = 'Проверьте отклики через минуту или подождите уведомление';
    hint2 = 'Маршрут и комментарий уже видны водителям рядом';
  }

  return `
    <div class="responses__empty">
      <div class="responses__empty-icon" aria-hidden="true">
        <span class="responses__empty-glow"></span>
        <span class="responses__empty-icon-inner">${CAR_SVG}</span>
      </div>
      <h2 class="responses__empty-title">${title}</h2>
      <p class="responses__empty-body">${body}</p>
    </div>
    <div class="responses__hints">
      <div class="responses__hint">
        <span class="responses__hint-icon" aria-hidden="true">${SPARK_SVG}</span>
        <span class="responses__hint-text">${hint1}</span>
      </div>
      <div class="responses__hint">
        <span class="responses__hint-icon responses__hint-icon--info" aria-hidden="true">${INFO_SVG}</span>
        <span class="responses__hint-text">${hint2}</span>
      </div>
    </div>
  `;
}

// BD-CLOUD-DESIGN-LOADING-02A — only the replaceable offers footprint is
// skeletonized. The announcement is a sibling of the aria-hidden decorative
// geometry, so assistive technology receives one concise status message and no
// fabricated driver/card content.
function renderOffersLoading() {
  const card = `
    <article class="responses__skeleton-card">
      <div class="responses__skeleton-head">
        <span class="responses__skeleton-bone responses__skeleton-avatar"></span>
        <span class="responses__skeleton-lines">
          <span class="responses__skeleton-bone responses__skeleton-line responses__skeleton-line--name"></span>
          <span class="responses__skeleton-bone responses__skeleton-line responses__skeleton-line--car"></span>
          <span class="responses__skeleton-bone responses__skeleton-line responses__skeleton-line--meta"></span>
        </span>
      </div>
      <div class="responses__skeleton-stats">
        <span class="responses__skeleton-bone responses__skeleton-stat"></span>
        <span class="responses__skeleton-bone responses__skeleton-stat"></span>
      </div>
      <span class="responses__skeleton-bone responses__skeleton-note"></span>
      <span class="responses__skeleton-bone responses__skeleton-action"></span>
    </article>`;

  return `
    <div class="responses__loading">
      <p class="responses__loading-status" role="status">Загружаем отклики…</p>
      <div class="responses__skeleton" aria-hidden="true">
        <div class="responses__skeleton-toolbar">
          <span class="responses__skeleton-bone responses__skeleton-count"></span>
          <span class="responses__skeleton-bone responses__skeleton-filter"></span>
        </div>
        ${card}
        ${card}
      </div>
    </div>`;
}

function renderResponsesFooter({ retry = false } = {}) {
  const primary = retry
    ? `<button type="button" class="bd-btn primary responses__cta" data-action="retry-offers">
         <span>Проверить отклики</span>
       </button>`
    : `<button type="button" class="bd-btn primary responses__cta" id="responses-check">
         <span>Проверить отклики</span>
       </button>`;

  return `
    <div class="responses__footer responses__footer--in-scroll">
      ${primary}
      <button type="button" class="bd-btn responses__cta responses__cta--secondary" id="responses-map">
        ${PENCIL_SVG}
        <span>Изменить заказ</span>
      </button>
    </div>`;
}

// BD-DRIVER-MAP-X-15 — accepted-driver handoff card. Rendered in place of the
// empty search once the linked order has an active trip. Reads the driver-seeded
// (or passenger-selected) active ride record, falling back to the request when a
// field is absent, and routes into the passenger active ride. Classes only — no
// inline style (check.mjs forbids style= / .style writes in public/src).
function renderAcceptedDriver(ride, request) {
  const driver    = ride && typeof ride.driver  === 'object' && ride.driver  ? ride.driver  : {};
  const vehicle   = ride && typeof ride.vehicle === 'object' && ride.vehicle ? ride.vehicle : {};
  const rideRoute = ride && typeof ride.route   === 'object' && ride.route   ? ride.route   : {};
  const rideOrder = ride && typeof ride.order   === 'object' && ride.order   ? ride.order   : {};
  const rideStats = ride && typeof ride.ride    === 'object' && ride.ride    ? ride.ride    : {};

  const name = String(driver.name || 'Водитель').trim() || 'Водитель';
  const initials = String(driver.initials || name.charAt(0).toUpperCase() || 'В').trim();
  const tone = String(driver.avatarTone || 'mint').trim() || 'mint';
  const rating = String(driver.rating || '').trim();
  const carLine = [vehicle.model, vehicle.color, vehicle.plate]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .join(' · ');
  const eta = String(rideOrder.pickupEta || rideRoute.etaToPickup || '').trim();
  const price = String(rideStats.price || rideOrder.offerPrice || request.price || '').trim();

  const ratingBlock = rating
    ? `<span class="responses__driver-rating">${STAR_SVG}<span>${escapeHtml(rating)}</span></span>`
    : '';
  const carBlock = carLine
    ? `<div class="responses__driver-car">${escapeHtml(carLine)}</div>`
    : '';
  const metaParts = [];
  if (eta) metaParts.push(`<span>Подача ${escapeHtml(eta)}</span>`);
  if (price) metaParts.push(`<span>${escapeHtml(price)}</span>`);
  const metaBlock = metaParts.length
    ? `<div class="responses__driver-meta">${metaParts.join('<span class="responses__driver-dot" aria-hidden="true">·</span>')}</div>`
    : '';

  return `
    <div class="responses__empty">
      <div class="responses__empty-icon" aria-hidden="true">
        <span class="responses__empty-glow"></span>
        <span class="responses__empty-icon-inner">${CHECK_SVG}</span>
      </div>
      <h2 class="responses__empty-title">Водитель найден</h2>
      <p class="responses__empty-body">
        Водитель принял ваш заказ и готов выехать. Откройте поездку, чтобы видеть статус и маршрут.
      </p>
    </div>
    <div class="responses__drivers responses__drivers--single">
      <article class="responses__driver responses__driver--best">
        <div class="responses__driver-head">
          <div class="responses__avatar responses__avatar--${escapeHtml(tone)}" aria-hidden="true">${escapeHtml(initials)}</div>
          <div class="responses__driver-info">
            <div class="responses__driver-line">
              <span class="responses__driver-name">${escapeHtml(name)}</span>
              ${ratingBlock}
            </div>
            ${carBlock}
            ${metaBlock}
          </div>
        </div>
        <div class="responses__selected-panel" role="status" aria-live="polite">
          <span class="responses__selected-icon" aria-hidden="true">${CHECK_SVG}</span>
          <span class="responses__selected-text">Водитель принял заказ · маршрут готов</span>
          <button type="button" class="responses__selected-open" data-action="open-active-ride">Открыть поездку</button>
        </div>
      </article>
    </div>
  `;
}

function renderAllDeclinedNotice() {
  return `
    <div class="responses__notice responses__notice--danger" role="status">
      <span class="responses__notice-icon" aria-hidden="true">${CLOSE_SVG}</span>
      <div class="responses__notice-body">
        <div class="responses__notice-title">Все отклики отклонены</div>
        <div class="responses__notice-text">Можно вернуть водителя или дождаться новых предложений.</div>
        <button type="button" class="responses__notice-action" data-action="restore-all">Вернуть все</button>
      </div>
    </div>
  `;
}

// BD-RESPONSES-SAFETY-01 — pre-ride safety sheet markup. A standalone modal
// layer over /responses, intentionally distinct from the in-ride BD-RIDE-P-07
// PassengerSafetySheet: NO driver card, NO share-trip, NO SOS, NO in-ride call.
// Four in-memory views toggled by the overlay's [data-view] (default → report →
// submitted; default → help). Controls carry a distinct `data-rsafe` attribute
// so they never collide with the board's [data-action]/[data-sort] delegation.
const SAFETY_TIPS = [
  'Проверяйте рейтинг и данные водителя',
  'Не переводите деньги заранее',
  'Согласуйте маршрут и цену в чате',
  'Не сообщайте коды и личные данные',
];
const SAFETY_REPORT_REASONS = [
  'Подозрительный профиль',
  'Просит оплату заранее',
  'Давит или торопит',
  'Другое',
];
function responsesSafetySheetHtml() {
  const tips = SAFETY_TIPS.map((t) => `
    <div class="rsafe-tip">
      <span class="rsafe-tip-ic" aria-hidden="true">${CHECK_SVG}</span>
      <span>${escapeHtml(t)}</span>
    </div>`).join('');
  const reasons = SAFETY_REPORT_REASONS.map((r, i) => `
    <button type="button" class="responses-safety-reason" data-rsafe-reason="${i}" role="radio" aria-checked="false" tabindex="${i === 0 ? '0' : '-1'}">
      <span class="responses-safety-reason__text">${escapeHtml(r)}</span>
      <span class="responses-safety-reason__radio" aria-hidden="true"></span>
    </button>`).join('');
  return `
  <div class="responses-safety-overlay" data-view="default" role="dialog" aria-modal="true" aria-labelledby="rsafe-title">
    <div class="responses-safety-overlay__backdrop" data-rsafe="dismiss" aria-hidden="true"></div>
    <div class="responses-safety-sheet" role="document">
      <div class="responses-safety-sheet__handle" aria-hidden="true"></div>

      <!-- DEFAULT — safety tips -->
      <div class="responses-safety-view responses-safety-view--default">
        <div class="rsafe-head">
          <span class="rsafe-head-ic" aria-hidden="true">${SHIELD_SVG}</span>
          <div class="rsafe-head-text">
            <div class="responses-safety-eyebrow">Безопасность</div>
            <div class="responses-safety-title" id="rsafe-title">Перед выбором водителя</div>
          </div>
          <button type="button" class="responses-safety-close" data-rsafe="dismiss" aria-label="Закрыть">${CLOSE_SVG}</button>
        </div>
        <div class="rsafe-tips">${tips}</div>
        <div class="responses-safety-actions responses-safety-actions--stack">
          <button type="button" class="bd-btn responses-safety-act responses-safety-act--report" data-rsafe="to-report">Сообщить о подозрительном отклике</button>
          <button type="button" class="bd-btn responses-safety-act" data-rsafe="to-help">Открыть правила безопасности</button>
          <button type="button" class="responses-safety-act responses-safety-act--ghost" data-rsafe="dismiss">Закрыть</button>
        </div>
      </div>

      <!-- REPORT — reason -->
      <div class="responses-safety-view responses-safety-view--report">
        <div class="responses-safety-sheet__header">
          <button type="button" class="responses-safety-back" data-rsafe="to-default" aria-label="Назад">${BACK_SVG}</button>
          <div class="responses-safety-title">Сообщить об отклике</div>
          <button type="button" class="responses-safety-close" data-rsafe="dismiss" aria-label="Закрыть">${CLOSE_SVG}</button>
        </div>
        <div class="responses-safety-reasons" role="radiogroup" aria-label="Причина сигнала">${reasons}</div>
        <div class="responses-safety-actions">
          <button type="button" class="bd-btn primary responses-safety-act" data-rsafe="submit">Отправить сигнал</button>
        </div>
      </div>

      <!-- SUBMITTED — UI stub (no backend) -->
      <div class="responses-safety-view responses-safety-view--submitted">
        <div class="rsafe-done-ic" aria-hidden="true">${CHECK_SVG}</div>
        <div class="responses-safety-title responses-safety-title--center">Спасибо, сигнал принят</div>
        <div class="responses-safety-sub responses-safety-sub--center">Мы сохраним это в модерации после подключения backend.</div>
        <div class="responses-safety-actions">
          <button type="button" class="bd-btn responses-safety-act" data-rsafe="dismiss">Закрыть</button>
        </div>
      </div>

      <!-- HELP — правила безопасности (справка) -->
      <div class="responses-safety-view responses-safety-view--help">
        <div class="responses-safety-sheet__header">
          <button type="button" class="responses-safety-back" data-rsafe="to-default" aria-label="Назад">${BACK_SVG}</button>
          <div class="responses-safety-title">Правила безопасности</div>
          <button type="button" class="responses-safety-close" data-rsafe="dismiss" aria-label="Закрыть">${CLOSE_SVG}</button>
        </div>
        <div class="rsafe-help-note">
          ${INFO_SVG}
          <span>Это справка перед поездкой — выберите водителя осознанно. Дополнительные инструменты безопасности доступны во время поездки.</span>
        </div>
        <div class="responses-safety-refs">
          <div class="responses-safety-ref">
            <span class="responses-safety-ref__ic" aria-hidden="true">${STAR_SVG}</span>
            <span class="responses-safety-ref__body">
              <span class="responses-safety-ref__title">Выбор водителя</span>
              <span class="responses-safety-ref__sub">Сравните рейтинг, цену и время подачи</span>
            </span>
          </div>
          <div class="responses-safety-ref">
            <span class="responses-safety-ref__ic" aria-hidden="true">${INFO_SVG}</span>
            <span class="responses-safety-ref__body">
              <span class="responses-safety-ref__title">Оплата</span>
              <span class="responses-safety-ref__sub">Платите в поездке — не переводите деньги заранее</span>
            </span>
          </div>
          <div class="responses-safety-ref">
            <span class="responses-safety-ref__ic" aria-hidden="true">${PHONE_SVG}</span>
            <span class="responses-safety-ref__body">
              <span class="responses-safety-ref__title">Поддержка</span>
              <span class="responses-safety-ref__sub">8 800 — круглосуточно</span>
            </span>
          </div>
        </div>
      </div>

    </div>
  </div>`;
}

// Renders the inner board: count toolbar, segmented sort chips, the optional
// all-declined notice, and the (sorted) driver cards. Declined state is
// per-driver and read from the in-memory `declined` Set, which is the source of
// truth after first render (see responses() factory). Returned as inner markup
// for the stable #responses-board shell so refreshBoard() can re-render it
// without rebinding the delegated listener.
function renderList(drivers, selectedDriverId, declined, sortMode) {
  const sorted = sortDrivers(drivers, sortMode);
  const allDeclined = drivers.length > 0 && declined.size === drivers.length;
  const chips = SORT_MODES.map((m) => {
    const active = m.key === sortMode;
    return `<button type="button" class="responses__chip${active ? ' is-active' : ''}"
              data-sort="${m.key}" aria-pressed="${active ? 'true' : 'false'}">${escapeHtml(m.label)}</button>`;
  }).join('');
  return `
    <div class="responses__toolbar">
      <div class="responses__count">
        <span class="responses__count-badge">${escapeHtml(String(drivers.length))}</span>
        <span class="responses__count-label">${escapeHtml(responsesWord(drivers.length))}</span>
      </div>
      <div class="responses__status">
        <span class="responses__status-dot" aria-hidden="true"></span>
        <span>Принимаем отклики</span>
      </div>
    </div>
    <div class="responses__sortbar" role="group" aria-label="Сортировка откликов">
      ${chips}
    </div>
    ${allDeclined ? renderAllDeclinedNotice() : ''}
    <div class="responses__drivers">
      ${sorted.map((d) => renderDriverCard(d, selectedDriverId, declined.has(d.id))).join('')}
    </div>
  `;
}


function renderOffer(driver) {
  return `
    <div class="responses__offer-intro">
      <span class="responses__offer-chip">Отклик водителя</span>
      <h2 class="responses__offer-title">Водитель готов поехать</h2>
      <p class="responses__offer-copy">Сравните цену, подачу и автомобиль. После выбора откроется маршрут поездки.</p>
    </div>
    <div class="responses__drivers responses__drivers--single">
      <article class="responses__driver responses__driver--best responses__driver--offer"
               data-driver-id="${escapeHtml(driver.id)}"
               data-response-id="${escapeHtml(driver.responseId)}">
        <div class="responses__driver-head">
          <div class="responses__avatar responses__avatar--${escapeHtml(driver.avatarTone)}" aria-hidden="true">${escapeHtml(driver.initials)}</div>
          <div class="responses__driver-info">
            <div class="responses__driver-line">
              <span class="responses__driver-name">${escapeHtml(driver.name)}</span>
              <span class="responses__driver-rating">${STAR_SVG}<span>${escapeHtml(driver.rating)}</span></span>
            </div>
            <div class="responses__driver-car">${escapeHtml(driver.car)}</div>
            <div class="responses__driver-meta">
              <span>${escapeHtml(driver.plate)}</span>
              <span class="responses__driver-dot" aria-hidden="true">·</span>
              <span>${escapeHtml(driver.trips)}</span>
            </div>
          </div>
        </div>
        <div class="responses__driver-stats">
          <div class="responses__stat">
            <div class="responses__stat-label">Предложение</div>
            <div class="responses__stat-row">
              <span class="responses__stat-value">${escapeHtml(driver.price)}</span>
              <span class="responses__delta responses__delta--${escapeHtml(driver.priceTone)}">${escapeHtml(driver.priceDelta)}</span>
            </div>
          </div>
          <div class="responses__stat">
            <div class="responses__stat-label">Подача</div>
            <div class="responses__stat-row">
              <span class="responses__stat-value">${escapeHtml(driver.eta)}</span>
              <span class="responses__eta responses__eta--${escapeHtml(driver.etaTone)}" aria-hidden="true">
                ${renderEtaBars(driver.etaBars)}
              </span>
            </div>
          </div>
        </div>
        <div class="responses__driver-note">
          <span class="responses__driver-note-icon" aria-hidden="true">${QUOTE_SVG}</span>
          <span class="responses__driver-note-text">${escapeHtml(driver.note || 'Готов подъехать к точке подачи.')}</span>
        </div>
        <div class="responses__offer-actions">
          <button type="button" class="bd-btn primary responses__offer-select" data-action="select">
            ${CHECK_SVG}
            <span>Выбрать водителя</span>
          </button>
          <button type="button" class="bd-btn responses__offer-secondary" data-action="chat">
            ${CHAT_SVG}
            <span>Написать</span>
          </button>
          <button type="button" class="bd-btn responses__offer-secondary" data-action="call">
            ${PHONE_SVG}
            <span>Позвонить</span>
          </button>
        </div>
      </article>
    </div>
  `;
}

// BD-MAP-05 — passenger-facing status copy keyed off the UI-only response
// state. Watching replies is view-only; choosing a driver performs the
// same local handoff into active ride that the passenger can safely review.
// Each entry feeds both the topbar subtitle and the compact status chip.
const RESPONSE_STATUS = {
  empty: {
    subtitle: 'Ищем водителей',
    chip: 'Ищем водителей',
    tone: 'searching',
  },
  offer: {
    subtitle: 'Отклик водителя',
    chip: 'Отклик водителя',
    tone: 'active',
  },
  list: {
    subtitle: 'Есть отклики',
    chip: 'Есть отклики',
    tone: 'active',
  },
  selected: {
    subtitle: 'Водитель выбран',
    chip: 'Водитель выбран',
    tone: 'selected',
  },
  // BD-DRIVER-MAP-X-15 — once the linked order is accepted (driver took it
  // via DriverMap, or the passenger selected a driver) the screen must show
  // the accepted-driver handoff instead of the empty "Ищем водителей" search.
  accepted: {
    subtitle: 'Водитель найден',
    chip: 'Водитель найден',
    tone: 'active',
  },
  'all-declined': {
    subtitle: 'Отклики отклонены',
    chip: 'Отклики отклонены',
    tone: 'declined',
  },
};

function responseStatus(state) {
  return RESPONSE_STATUS[state] || RESPONSE_STATUS.empty;
}

function renderStatusChip(status, { announce = true } = {}) {
  const statusRole = announce ? ' role="status"' : '';
  return `
    <div class="responses__status-chip responses__status-chip--${escapeHtml(status.tone)}"${statusRole}>
      <span class="responses__status-chip-dot" aria-hidden="true"></span>
      <span class="responses__status-chip-text">${escapeHtml(status.chip)}</span>
    </div>
  `;
}

function activeRideUrl(tripId) {
  const params = new URLSearchParams();
  params.set('role', 'passenger');
  params.set('tripId', tripId);
  params.set('status', RIDE_STATUS.DRIVER_EN_ROUTE);
  return `/active-ride?${params.toString()}`;
}

function driverInitials(driver) {
  return driver.initials || String(driver.name || 'В').trim().charAt(0).toUpperCase() || 'В';
}

function passengerSnapshot(order) {
  const snap = order && typeof order.passenger === 'object' && order.passenger ? order.passenger : null;
  if (snap && typeof snap.name === 'string' && snap.name.trim()) {
    return { ...snap, name: snap.name.trim() };
  }
  return {
    name: 'Вы',
    initials: 'В',
    phoneMasked: '',
    note: typeof order?.comment === 'string' ? order.comment : '',
    isCurrentUser: true,
  };
}

export function buildPassengerActiveRide(order, request, driver) {
  if (!order || !order.id) return null;
  const orderId = String(order.id);
  const tripId = `trip_${orderId}`;
  const existingRide = findActiveRide(tripId);
  if (existingRide) {
    // BD-LIFE-05 — when a stale ride exists, apply the matching real
    // driverSnapshot before reusing it so a previously-seeded "Рустам К."
    // demo handoff cannot mask the actual driver. The orchestrator picks
    // the pinned response when ride.selectedDriver.responseId is set
    // (e.g. passenger already chose driver A) and only falls back to the
    // latest response for truly unlinked handoffs. Terminal rides are
    // preserved as-is by upgradeRideFromDriverSnapshot itself.
    const upgraded = upgradeStoredActiveRideForOrder(orderId) || existingRide;
    return { tripId, ride: upgraded, reused: true };
  }

  const accepted = order && order.status === 'CREATED' ? acceptOrder(order.id) : order;
  const sourceOrder = accepted || order;
  const now = new Date().toISOString();
  const ride = createDemoActiveRide({
    tripId,
    role: 'passenger',
    status: RIDE_STATUS.DRIVER_EN_ROUTE,
    driver: {
      id: driver.id,
      name: driver.name,
      initials: driverInitials(driver),
      rating: driver.rating,
      phoneMasked: '+7 ... 45-67',
    },
    vehicle: {
      model: driver.carModel || driver.car,
      color: driver.carColor || '',
      plate: driver.plate,
    },
    passenger: passengerSnapshot(sourceOrder),
    order: {
      offerPrice: driver.price || request.price,
      pickupEta: driver.eta,
      destinationEta: sourceOrder?.durationMin ? `${sourceOrder.durationMin} мин` : '28 мин',
      destinationDistance: sourceOrder?.distanceKm ? `${sourceOrder.distanceKm} км` : '—',
      passengerComment: request.note,
    },
    route: {
      pickupLabel: request.pickupLabel,
      dropoffLabel: request.dropoffLabel,
      etaToPickup: driver.eta,
      etaToDestination: sourceOrder?.durationMin ? `${sourceOrder.durationMin} мин` : '28 мин',
      pickup: sourceOrder?.pickup || null,
      dropoff: sourceOrder?.dropoff || null,
    },
    ride: {
      price: driver.price || request.price,
    },
    timestamps: {
      acceptedAt: sourceOrder?.acceptedAt || now,
    },
  });
  // Replace the demo passenger entirely so the active ride preserves the
  // order passenger snapshot without inherited seed fields.
  ride.passenger = passengerSnapshot(sourceOrder);
  ride.orderId = orderId;
  ride.selectedDriver = {
    id: driver.id,
    responseId: driver.responseId,
    name: driver.name,
    rating: driver.rating,
    car: driver.car,
    plate: driver.plate,
    eta: driver.eta,
    price: driver.price,
    note: driver.note,
  };
  saveActiveRide(ride);
  return { tripId, ride };
}

function responseUrl(request, state, driverId = '') {
  const params = new URLSearchParams();
  if (request.orderId) params.set('orderId', request.orderId);
  else if (request.legacyPostId) params.set('postId', request.legacyPostId);
  params.set('state', state);
  if (driverId) params.set('driverId', driverId);
  return `/responses?${params.toString()}`;
}

export default function responses() {
  const fixture = getResponsesFixture();
  const explicitOrderId = getRouteParam('orderId') || '';
  const legacyPostId = explicitOrderId ? '' : (getRouteParam('postId') || '');
  // Known fixtures are synthetic and bypass both production/local stores and
  // the guarded backend. Unknown values already collapsed to normal runtime.
  let canonicalOrder = fixture ? null : resolveCanonicalOrder();
  const request = fixture
    ? requestFromFixture(explicitOrderId)
    : (canonicalOrder
        ? requestFromOrder(canonicalOrder, explicitOrderId)
        : (legacyPostId ? requestFromLegacyPost(legacyPostId) : requestFromOrder(null, explicitOrderId)));
  const postId = request.legacyPostId || request.orderId || request.id;
  const requestedState = getRouteParam('state') || 'empty';
  // #784 CUT-4: on a live backend the owner's offers come from GET /matching/offers, and the server
  // is AUTHORITATIVE for the board (empty => honest empty state, NEVER the local/mock drivers). A
  // fetch error now settles the persistent board region to an explicit retryable
  // `error` state. OFF remains byte-identical to the prior local/mock path.
  const backendAuthoritative = !fixture && isBackendEnabled() && !!request.orderId;

  // BD-DRIVER-MAP-X-15 — handoff detection. The URL `state` is only a UI hint;
  // once the linked order is actually accepted (a driver took it on DriverMap,
  // or the passenger selected one) there is a live active trip at
  // `trip_${orderId}` and the screen must never show the empty search. Detect
  // it from the seeded active ride (strongest proof) OR the canonical order
  // status. A linked terminal ride (COMPLETED / CANCELED / NO_SHOW) is the
  // authoritative signal that the trip is over, so it suppresses the handoff
  // even when the order status still reads ACCEPTED / IN_PROGRESS — the order
  // status fallback only applies when there is no linked terminal ride.
  const handoffTripId = !fixture && request.orderId ? `trip_${request.orderId}` : '';
  let handoffRide = null;
  let isAccepted = false;
  let isAllDeclined = false;

  function refreshHandoffState({ upgradeSnapshot = false } = {}) {
    if (!handoffTripId) {
      handoffRide = null;
      isAccepted = false;
      isAllDeclined = requestedState === 'all-declined';
      return isAccepted;
    }

    // The offers read can settle after another tab/device changes the linked
    // order or ride. Re-read both sources at settlement time so accepted and
    // terminal precedence never relies on the pre-request snapshot.
    canonicalOrder = resolveCanonicalOrder();
    handoffRide = findActiveRide(handoffTripId);
    const orderStatus = canonicalOrder && typeof canonicalOrder.status === 'string' ? canonicalOrder.status : '';
    const orderHandedOff = orderStatus === 'ACCEPTED' || orderStatus === 'IN_PROGRESS';
    const rideTerminal = !!handoffRide
      && (handoffRide.status === RIDE_STATUS.COMPLETED
        || handoffRide.status === RIDE_STATUS.CANCELED
        || handoffRide.status === RIDE_STATUS.NO_SHOW);
    const rideLive = !!handoffRide && !rideTerminal;

    // BD-LIFE-05 — if a stale handoff ride is sitting in localStorage with the
    // demo "Рустам К." seed (legacy DriverMap accept or createDemoActiveRide
    // fallback), upgrade it from the matching passenger_response driverSnapshot
    // so renderAcceptedDriver below sees the actual driver. The orchestrator
    // gates pinned-by-responseId first, latest fallback for unlinked handoffs,
    // and skips terminal rides (COMPLETED / CANCELED / NO_SHOW) on its own
    // through upgradeRideFromDriverSnapshot — the outer `!rideTerminal` check
    // is kept as a perf gate so we do not even read the responses store on a
    // ride that is already over.
    if (upgradeSnapshot && handoffRide && !rideTerminal && request.orderId) {
      const upgraded = upgradeStoredActiveRideForOrder(request.orderId);
      if (upgraded && upgraded !== handoffRide) handoffRide = upgraded;
    }
    isAccepted = !!canonicalOrder && !rideTerminal && (rideLive || orderHandedOff);
    isAllDeclined = !isAccepted && requestedState === 'all-declined';
    return isAccepted;
  }

  refreshHandoffState({ upgradeSnapshot: true });
  let effectiveState = isAccepted ? 'accepted' : requestedState;

  // Local/mock data still resolves synchronously. A live backend starts with no
  // fabricated drivers and hydrates after mount; fixtures use the synthetic card
  // seed only and never touch localStorage/backend data.
  let drivers = fixture === 'loaded'
    ? buildDrivers(request)
    : (fixture || backendAuthoritative
        ? []
        : buildDriversForOrder(request, null, false));
  let readState = isAccepted ? 'loaded' : (fixture || (backendAuthoritative ? 'loading' : 'loaded'));
  let selectedDriver = null;
  let selectedDriverId = null;

  // BD-RESPONSES-01 — in-memory sort + decline state. Session-only: never
  // persisted to localStorage, so a reload returns every card to normal. The
  // `?state=all-declined` deep-link is an initial SEED only — it fills the set
  // once on first render; thereafter the Set is the sole source of truth.
  let sortMode = 'best';
  let selecting = false; // #784 CUT-4: double-submit latch for the async backend select
  const declined = new Set();
  let declinedSeeded = false;

  function loadedDomainState() {
    if (isAccepted) return 'accepted';
    if (!drivers.length) return 'empty';
    if (requestedState === 'offer'
        || requestedState === 'list'
        || requestedState === 'selected'
        || requestedState === 'all-declined') return requestedState;
    // A successful authoritative/fixture read with usable offers exposes those
    // cards. The backend-OFF legacy `state=empty` presentation stays unchanged.
    return (backendAuthoritative || fixture === 'loaded') ? 'list' : requestedState;
  }

  function reconcileDriverState() {
    const routeDriverId = requestedState === 'selected' ? getRouteParam('driverId') : null;
    selectedDriver = routeDriverId ? drivers.find((driver) => driver.id === routeDriverId) : null;
    selectedDriverId = selectedDriver ? selectedDriver.id : null;
    if (isAllDeclined && !declinedSeeded) {
      drivers.forEach((driver) => declined.add(driver.id));
      declinedSeeded = true;
    }
  }

  if (readState === 'loaded') {
    if (fixture === 'loaded') effectiveState = loadedDomainState();
    reconcileDriverState();
  }

  function headerStatus() {
    if (readState === 'loading') {
      return { subtitle: 'Загружаем отклики', chip: 'Загружаем отклики', tone: 'searching' };
    }
    if (readState === 'error') {
      return { subtitle: 'Отклики недоступны', chip: 'Ошибка загрузки', tone: 'declined' };
    }
    return responseStatus(effectiveState);
  }

  const root = document.createElement('section');
  root.className = 'screen screen--responses';
  root.dataset.postId = postId;
  root.dataset.orderId = request.orderId;
  root.dataset.state = effectiveState;
  root.dataset.readState = readState;
  if (fixture) root.dataset.fixture = fixture;
  root.dataset.source = canonicalOrder ? 'ride-order' : (request.isLegacyMock ? 'legacy-post' : 'mock');

  const status = headerStatus();
  const subTitle = status.subtitle;

  root.innerHTML = `
    <div class="responses__topbar">
      <button type="button" class="responses__icon-btn" id="responses-back" aria-label="Назад">${BACK_SVG}</button>
      <div class="responses__titles">
        <div class="responses__title">Отклики водителей</div>
        <div class="responses__sub">${escapeHtml(subTitle)}</div>
      </div>
      <button type="button" class="responses__icon-btn" id="responses-shield" aria-label="Безопасность">${SHIELD_SVG}</button>
    </div>

    <div class="bd-scroll responses__scroll">
      <div class="bd-card responses__request" aria-label="Ваш опубликованный заказ">
        ${renderStatusChip(status, { announce: readState !== 'loading' })}
        <div class="responses__request-main">
          <div class="responses__route">
            <div class="responses__stop">
              <span class="responses__marker responses__marker--pickup" aria-hidden="true"></span>
              <span class="responses__stop-label">${escapeHtml(request.pickupLabel)}</span>
            </div>
            <span class="responses__route-line" aria-hidden="true"></span>
            <div class="responses__stop">
              <span class="responses__marker responses__marker--dropoff" aria-hidden="true"></span>
              <span class="responses__stop-label">${escapeHtml(request.dropoffLabel)}</span>
            </div>
          </div>
          <div class="responses__price">
            <div class="responses__price-label">Ваша цена</div>
            <div class="responses__price-value">${escapeHtml(request.price)}</div>
          </div>
        </div>
        ${renderOrderMeta(request)}
        <div class="responses__request-foot">
          <div class="responses__note">
            ${INFO_SVG}
            <span>${escapeHtml(request.note)}</span>
          </div>
          <button type="button" class="responses__edit" id="responses-edit">
            ${PENCIL_SVG}
            <span>На карту</span>
          </button>
        </div>
      </div>
      <div class="responses__read-region" id="responses-read-region"
           data-read-state="${escapeHtml(readState)}"
           tabindex="-1"
           aria-busy="${readState === 'loading' ? 'true' : 'false'}"></div>
    </div>

    <div class="responses__toast" id="responses-toast" role="status" aria-live="polite" hidden></div>
  `;

  const toastEl = root.querySelector('#responses-toast');
  let toastTimer = null;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2800);
  }

  root.querySelector('#responses-back').addEventListener('click', () => go('/feed'));

  // BD-RESPONSES-SAFETY-01 — open the pre-ride safety sheet as a modal layer
  // over /responses (no route change, no /report reroute). This is a NEW,
  // standalone sheet — it deliberately does not import or reuse the in-ride
  // BD-RIDE-P-07 safety sheet (no driver card, no share-trip, no SOS, no
  // call-during-trip). It needs no selected driver — pre-ride context only.
  let safetyOverlayEl = null;
  // The overlay mounts inside #app; the bottom #tabbar is a SIBLING of #app, so
  // an inset:0 backdrop confined to #app cannot cover it. Hide the tabbar while
  // the modal is open so it actually blocks background navigation, and restore
  // its prior state on close. (The router also resets tabbar.hidden on the next
  // navigation, so this never leaks even if the screen is torn down while open.)
  let safetyTabbar = null;
  let safetyTabbarPrevHidden = false;
  let releaseSafetyTrap = () => {};
  function closeSafetySheet() {
    releaseSafetyTrap();
    if (safetyOverlayEl) { safetyOverlayEl.remove(); safetyOverlayEl = null; }
    if (safetyTabbar) { safetyTabbar.hidden = safetyTabbarPrevHidden; safetyTabbar = null; }
  }
  function setSafetyView(view) {
    if (!safetyOverlayEl) return;
    safetyOverlayEl.dataset.view = view;
    // #732 — move focus into the now-visible view so it doesn't strand on the (now hidden)
    // control that triggered the transition; the focus trap then cycles within the new view.
    const next = safetyOverlayEl.querySelector(`.responses-safety-view--${view} button:not([disabled])`);
    if (next) next.focus();
  }
  function openSafetySheet() {
    if (safetyOverlayEl) return;
    safetyTabbar = document.getElementById('tabbar');
    if (safetyTabbar) { safetyTabbarPrevHidden = safetyTabbar.hidden; safetyTabbar.hidden = true; }
    // Appended to `root` (a sibling of .responses__scroll), so the board's
    // delegated listener never sees the sheet, and the sheet's own controls use
    // a distinct data-rsafe attribute — fully isolated from the board.
    root.insertAdjacentHTML('beforeend', responsesSafetySheetHtml());
    safetyOverlayEl = root.querySelector('.responses-safety-overlay');
    // #732 — the report reasons are a single-select ARIA radiogroup: selecting one checks it and
    // moves the roving tabindex (so Tab reaches only the active radio); Arrow/Home/End navigate.
    const selectReason = (btn) => {
      safetyOverlayEl.querySelectorAll('[data-rsafe-reason]').forEach((r) => {
        const on = r === btn;
        r.setAttribute('aria-checked', on ? 'true' : 'false');
        r.classList.toggle('is-selected', on);
        r.tabIndex = on ? 0 : -1;
      });
      if (btn && typeof btn.focus === 'function') btn.focus();
    };
    safetyOverlayEl.addEventListener('click', (event) => {
      const reasonBtn = event.target.closest('[data-rsafe-reason]');
      if (reasonBtn) { selectReason(reasonBtn); return; }
      const ctl = event.target.closest('[data-rsafe]');
      if (!ctl) return;
      const a = ctl.dataset.rsafe;
      if (a === 'dismiss')    { closeSafetySheet(); return; }
      if (a === 'to-report')  { setSafetyView('report'); return; }
      if (a === 'to-help')    { setSafetyView('help'); return; }
      if (a === 'to-default') { setSafetyView('default'); return; }
      // Report submit is a UI stub — no backend, no localStorage. The
      // "после подключения backend" copy on the submitted view makes the mock
      // explicit; wire to the moderation queue later.
      if (a === 'submit')     { setSafetyView('submitted'); return; }
    });
    // #732 — radiogroup keyboard: Arrow keys (and Home/End) move selection + focus between rows.
    safetyOverlayEl.addEventListener('keydown', (event) => {
      if (!event.target.closest('[role="radiogroup"]')) return;
      const radios = Array.from(safetyOverlayEl.querySelectorAll('[data-rsafe-reason]'));
      if (!radios.length) return;
      let idx = radios.indexOf(event.target.closest('[data-rsafe-reason]'));
      if (idx < 0) idx = radios.findIndex((r) => r.getAttribute('aria-checked') === 'true');
      if (idx < 0) idx = 0;
      let next = null;
      switch (event.key) {
        case 'ArrowDown': case 'ArrowRight': next = radios[(idx + 1) % radios.length]; break;
        case 'ArrowUp':   case 'ArrowLeft':  next = radios[(idx - 1 + radios.length) % radios.length]; break;
        case 'Home': next = radios[0]; break;
        case 'End':  next = radios[radios.length - 1]; break;
        default: return;
      }
      event.preventDefault();
      selectReason(next);
    });
    // #732 — modal a11y: capture focus, trap Tab, restore to #responses-shield on close. The
    // sheet had no Escape, so the helper owns it with step-back (sub-view → default → close).
    releaseSafetyTrap = trapFocus(safetyOverlayEl, {
      onEscape: () => {
        if (safetyOverlayEl && safetyOverlayEl.dataset.view !== 'default') { setSafetyView('default'); return; }
        closeSafetySheet();
      },
    });
  }
  root.querySelector('#responses-shield').addEventListener('click', openSafetySheet);

  root.querySelector('#responses-edit').addEventListener('click', () => {
    go('/order-map-draft');
  });

  const readRegion = root.querySelector('#responses-read-region');
  let boardEl = null;
  let offersReadRunId = 0;
  let missingSelectedAnnounced = false;
  let missingSelectedAnnouncementPending = false;

  // BD-RESPONSES-01 — sort + decline are re-rendered in place on the
  // #responses-board shell (list/declined state only). The request-state owner
  // around it is persistent across loading → settled transitions.
  function syncHeader({ reconcileBoard = false } = {}) {
    if (reconcileBoard && boardEl && readState === 'loaded') {
      const allDeclinedNow = drivers.length > 0 && declined.size === drivers.length;
      effectiveState = allDeclinedNow ? 'all-declined' : (selectedDriverId ? 'selected' : 'list');
    }
    root.dataset.state = effectiveState;
    root.dataset.readState = readState;
    const liveStatus = headerStatus();
    const subEl = root.querySelector('.responses__sub');
    if (subEl) subEl.textContent = liveStatus.subtitle;
    const chipEl = root.querySelector('.responses__status-chip');
    if (chipEl) chipEl.outerHTML = renderStatusChip(liveStatus, { announce: readState !== 'loading' });
  }

  function announceMissingSelectedAfterMount() {
    if (missingSelectedAnnounced || missingSelectedAnnouncementPending) return;
    missingSelectedAnnouncementPending = true;
    // `responses()` returns synchronously, but router.render() resumes from its
    // `await loader()` in a later microtask. A macrotask therefore observes the
    // real mounted shell; only then may the one-shot flag suppress later renders.
    setTimeout(() => {
      missingSelectedAnnouncementPending = false;
      if (missingSelectedAnnounced || !document.body.contains(root)) return;
      missingSelectedAnnounced = true;
      toast('Этап подтверждения водителя будет добавлен позже');
    }, 0);
  }

  function renderReadRegion() {
    if (!readRegion) return;
    const focusedDescendant = document.activeElement
      && document.activeElement !== readRegion
      && readRegion.contains(document.activeElement);
    let content;
    if (readState === 'loading') {
      content = renderOffersLoading();
    } else if (isAccepted) {
      content = renderAcceptedDriver(handoffRide, request);
    } else if (readState === 'error') {
      content = `${renderEmptyState(request, { error: true })}${renderResponsesFooter({ retry: true })}`;
    } else if (readState === 'empty') {
      content = `${renderEmptyState(request)}${renderResponsesFooter({ retry: backendAuthoritative || !!fixture })}`;
    } else {
      const isOffer = effectiveState === 'offer';
      const isList = effectiveState === 'list'
        || effectiveState === 'selected'
        || effectiveState === 'all-declined';
      content = isOffer && drivers.length
        ? renderOffer(drivers[0])
        : (isList
            ? `<div class="responses__board" id="responses-board">${renderList(drivers, selectedDriverId, declined, sortMode)}</div>`
            : `${renderEmptyState(request)}${renderResponsesFooter()}`);
    }

    readRegion.dataset.readState = readState;
    readRegion.setAttribute('aria-busy', readState === 'loading' ? 'true' : 'false');
    // A successful retry or a domain-precedence change can replace the focused
    // command. Move focus to the stable owner before removal so it never falls
    // to body.
    if (focusedDescendant && typeof readRegion.focus === 'function') {
      readRegion.focus({ preventScroll: true });
    }
    readRegion.innerHTML = content;
    boardEl = readRegion.querySelector('#responses-board');
    const openActiveRideBtn = readRegion.querySelector('[data-action="open-active-ride"]');
    if (openActiveRideBtn && handoffTripId) {
      openActiveRideBtn.addEventListener('click', () => go(activeRideUrl(handoffTripId)));
    }
    syncHeader();

    if (readState === 'loaded'
        && requestedState === 'selected'
        && !selectedDriver
        && !missingSelectedAnnounced) {
      announceMissingSelectedAfterMount();
    }
  }

  function setRetryBusy(busy) {
    const retryBtn = readRegion && readRegion.querySelector('[data-action="retry-offers"]');
    if (!retryBtn) return;
    retryBtn.disabled = busy;
    retryBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
    const label = retryBtn.querySelector('span');
    if (label) label.textContent = busy ? 'Проверяем отклики…' : 'Проверить отклики';
  }

  function settleLatestHandoff() {
    const wasAccepted = isAccepted;
    refreshHandoffState();
    if (!isAccepted) return false;
    if (!wasAccepted) {
      readState = 'loaded';
      effectiveState = 'accepted';
      selectedDriver = null;
      selectedDriverId = null;
      renderReadRegion();
    }
    return true;
  }

  async function loadServerOffers({ isRetry = false } = {}) {
    if (!backendAuthoritative || fixture || !document.body.contains(root)) return;
    const runId = ++offersReadRunId;
    if (isRetry) setRetryBusy(true);

    try {
      const serverOffers = await listOrderOffers(request.orderId);
      if (runId !== offersReadRunId || !document.body.contains(root)) return;
      // Re-resolve domain precedence after the pending interval. An accepted
      // handoff wins; a newly terminal ride suppresses the stale accepted card
      // and lets this successful offers result settle normally.
      if (settleLatestHandoff()) return;
      drivers = buildDriversForOrder(request, serverOffers, true);
      readState = drivers.length ? 'loaded' : 'empty';
      effectiveState = readState === 'loaded' ? loadedDomainState() : 'empty';
      selectedDriver = null;
      selectedDriverId = null;
      reconcileDriverState();
      renderReadRegion();
    } catch {
      if (runId !== offersReadRunId || !document.body.contains(root)) return;
      if (settleLatestHandoff()) return;
      // A failed retry from the already-rendered error state keeps the same
      // button node/focus and only clears its local command progress.
      if (isRetry && readState === 'error') {
        setRetryBusy(false);
        return;
      }
      drivers = [];
      selectedDriver = null;
      selectedDriverId = null;
      effectiveState = 'empty';
      readState = 'error';
      renderReadRegion();
    }
  }

  function refreshBoard() {
    if (boardEl) boardEl.innerHTML = renderList(drivers, selectedDriverId, declined, sortMode);
    syncHeader({ reconcileBoard: true });
  }

  renderReadRegion();

  // One delegated listener on the stable scroll container — present in EVERY
  // card state — so the offer card (renderOffer, rendered outside
  // #responses-board) keeps its select/chat/call handlers. The chip / decline /
  // restore branches self-guard: those controls only exist on the list board.
  const scrollEl = root.querySelector('.responses__scroll');
  if (scrollEl) {
    scrollEl.addEventListener('click', async (event) => {
      if (event.target.closest('#responses-check')) {
        go(responseUrl(request, 'list'));
        return;
      }

      if (event.target.closest('#responses-map')) {
        go('/order-map-draft');
        return;
      }

      if (event.target.closest('[data-action="retry-offers"]')) {
        if (fixture) {
          toast('Предпросмотр не выполняет сетевые запросы');
          return;
        }
        await loadServerOffers({ isRetry: true });
        return;
      }

      const chip = event.target.closest('[data-sort]');
      if (chip) {
        const mode = chip.dataset.sort;
        if (mode && mode !== sortMode && SORT_MODES.some((m) => m.key === mode)) {
          sortMode = mode;
          refreshBoard();
        }
        return;
      }

      if (event.target.closest('[data-action="restore-all"]')) {
        declined.clear();
        refreshBoard();
        return;
      }

      const btn = event.target.closest('[data-action]');
      if (!btn) return;
      const card = btn.closest('.responses__driver');
      if (!card) return;
      const driverId = card.dataset.driverId;
      const responseId = card.dataset.responseId;
      const action = btn.dataset.action;

      // Fixture cards are representative design/smoke content. Their data
      // actions never call backend helpers or write order/ride/local state.
      if (fixture && (action === 'select'
          || action === 'continue'
          || action === 'chat'
          || action === 'call')) {
        toast('Действие недоступно в режиме предпросмотра');
        return;
      }

      if (action === 'select' || action === 'continue') {
        if (selecting) return; // #784 CUT-4: ignore a second click while a select is in flight
        const driver = drivers.find((d) => d.id === driverId) || selectedDriver || drivers[0];

        // #784 CUT-4 (offer→select): on a live backend the server is AUTHORITATIVE — the owner accepts
        // the chosen offer server-side (POST /matching/select bootstraps the ride in one tx) and we
        // NEVER mint a local-only ride the server didn't accept.
        if (backendAuthoritative) {
          // A malformed offer (missing driverId, e.g. a serializer regression) must never fall
          // through to a local ride — keep it non-selectable.
          if (!driver || !driver.driverId) {
            toast('Некорректное предложение, обновите список');
            return;
          }
          selecting = true;
          try {
            await selectOfferOnBackend({ orderId: request.orderId, driverId: driver.driverId });
          } catch (err) {
            selecting = false;
            toast(err && err.status === 409
              ? 'Этот заказ уже принят другим водителем'
              : 'Не удалось выбрать водителя. Попробуйте ещё раз.');
            return;
          }
          // Server accepted. Same-device creator: build the LOCAL active-ride bridge, which pins
          // selectedDriver.responseId (SAFETY>RECOVERY — driver never left unpinned). Cross-device /
          // server-fed (no local order to bridge): go straight to the real server ride; tripId =
          // trip_<orderId> from the /select tx, and active-ride's own read cuts over in CUT-5.
          if (canonicalOrder) {
            const handoff = buildPassengerActiveRide(canonicalOrder, request, driver);
            if (handoff) { go(activeRideUrl(handoff.tripId)); return; }
          }
          go(activeRideUrl(`trip_${request.orderId}`));
          return;
        }

        // OFF / not-authoritative: prior local behaviour, byte-identical.
        if (!canonicalOrder) {
          toast('Сначала откройте опубликованный заказ');
          return;
        }
        selecting = true;
        const handoff = buildPassengerActiveRide(canonicalOrder, request, driver);
        if (!handoff) {
          selecting = false;
          toast('Сначала откройте опубликованный заказ');
          return;
        }
        go(activeRideUrl(handoff.tripId));
        return;
      }
      if (action === 'cancel') {
        go(responseUrl(request, 'list'));
        return;
      }
      if (action === 'decline') {
        declined.add(driverId);
        // Declining the selected driver drops the selection so the board
        // clears the dimming on the rest and the header stops saying "выбран".
        if (driverId === selectedDriverId) selectedDriverId = null;
        refreshBoard();
        return;
      }
      if (action === 'restore') {
        declined.delete(driverId);
        refreshBoard();
        return;
      }
      if (action === 'chat') {
        // #784 CUT-4: pre-select chat for a SERVER offer isn't wired — the shared thread is keyed by
        // the ride, which only exists after select; the per-card responseId (resp_<driverId>) has no
        // local response to resolve. Chat opens post-select via active-ride; avoid a dead thread here.
        if (backendAuthoritative) {
          toast('Чат с водителем откроется после выбора');
          return;
        }
        go(`/chat?responseId=${encodeURIComponent(responseId)}&orderId=${encodeURIComponent(request.orderId)}`);
        return;
      }
      if (action === 'call') {
        toast('Звонок будет доступен после подтверждения поездки');
      }
    });
  }

  if (backendAuthoritative) {
    // The router awaits the loader and appends its return value afterwards. A
    // macrotask starts the one guarded read only once the stable shell is in the
    // document, guaranteeing a visible pending owner and a valid teardown guard.
    setTimeout(() => {
      if (!document.body.contains(root)) return;
      void loadServerOffers();
    }, 0);
  }

  queueMicrotask(markFeedTabActive);

  return root;
}
