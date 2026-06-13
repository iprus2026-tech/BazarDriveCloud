import { go } from '../router.js';
import { escapeHtml } from '../util.js';
import { acceptOrder, getOrderById } from '../mock_api.js';
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

const CHEVRON_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="14" height="14">
    <polyline points="6 9 12 15 18 9"/>
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

function requestFromOrder(order, explicitOrderId = '') {
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

// Map a real passenger_response into the exact card shape renderDriverCard /
// renderOffer consume. Real fields: price (driverPrice), note (message) and a
// real responseId (so /chat?responseId resolves the same handoff). The stored
// response does not capture driver identity, so name/rating/car/plate use
// neutral, CSS-valid placeholders. EVERY field is filled — escapeHtml turns
// undefined into the literal "undefined", and each tone must map to a real
// class (avatar mint/amber/violet, delta same/up/down, eta good/mid/low).
function mapResponseToDriverCard(response, request, index) {
  const responseId = String(response.id || `response_${index + 1}`);
  const value = Number(response.driverPrice);
  const price = Number.isFinite(value) && value > 0
    ? formatRub(value)
    : (request.isFallback ? 'По договорённости' : (request.price || MOCK_REQUEST.price));
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
    note,
    isBest:     index === 0,
  };
}

// Driver board source of truth. Real canonical responses win when the resolved
// order has any; otherwise the MOCK_DRIVERS board is preserved unchanged for
// every fallback path: no orderId, no real response, legacy postId flow, and
// the fallback/QA request (request.isFallback).
function buildDriversForOrder(request) {
  const real = (request && request.orderId && !request.isFallback)
    ? loadResponsesForOrder(request.orderId)
    : [];
  if (real.length) {
    return real.map((response, index) => mapResponseToDriverCard(response, request, index));
  }
  return buildDrivers(request);
}

function renderEtaBars(active) {
  let html = '';
  for (let i = 1; i <= 3; i++) {
    const filled = i <= active ? ' is-on' : '';
    html += `<span class="responses__eta-bar${filled}"></span>`;
  }
  return html;
}

function renderDriverCard(driver, selectedDriverId, allDeclined) {
  const isDeclined = !!allDeclined;
  const isSelected = !isDeclined && selectedDriverId && driver.id === selectedDriverId;
  const isDimmed   = !isDeclined && selectedDriverId && !isSelected;

  const bestBadge = driver.isBest
    ? `<div class="responses__driver-best">
         ${SPARK_SVG}
         <span>Лучший вариант</span>
       </div>`
    : '';

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
      ${bestBadge}
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
function renderEmptyState(request) {
  const isFallback = !!(request && request.isFallback);
  const hasOrderId = !!(request && request.orderId);

  let body;
  let hint1;
  let hint2;

  if (isFallback && hasOrderId) {
    body = 'Отклики водителей появятся здесь. Убедитесь, что заказ опубликован, и проверьте снова через минуту.';
    hint1 = 'Откройте опубликованный заказ с карты или ленты';
    hint2 = 'Заказ остаётся доступным для водителей рядом';
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
      <h2 class="responses__empty-title">Ищем водителей</h2>
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
        <div class="responses__notice-text">Поднимите цену или дождитесь новых откликов — заказ остаётся опубликованным.</div>
      </div>
    </div>
  `;
}

function renderList(drivers, selectedDriverId, allDeclined) {
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
      <button type="button" class="responses__sort" id="responses-sort">
        ${SPARK_SVG}
        <span>Лучшие</span>
        ${CHEVRON_SVG}
      </button>
    </div>
    ${allDeclined ? renderAllDeclinedNotice() : ''}
    <div class="responses__drivers">
      ${drivers.map((d) => renderDriverCard(d, selectedDriverId, allDeclined)).join('')}
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

function renderStatusChip(status) {
  return `
    <div class="responses__status-chip responses__status-chip--${escapeHtml(status.tone)}" role="status">
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

function buildPassengerActiveRide(order, request, driver) {
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
  const explicitOrderId = getRouteParam('orderId') || '';
  const legacyPostId = explicitOrderId ? '' : (getRouteParam('postId') || '');
  const canonicalOrder = resolveCanonicalOrder();
  const request = canonicalOrder
    ? requestFromOrder(canonicalOrder, explicitOrderId)
    : (legacyPostId ? requestFromLegacyPost(legacyPostId) : requestFromOrder(null, explicitOrderId));
  const postId = request.legacyPostId || request.orderId || request.id;
  const state = getRouteParam('state') || 'empty';
  const drivers = buildDriversForOrder(request);

  // BD-DRIVER-MAP-X-15 — handoff detection. The URL `state` is only a UI hint;
  // once the linked order is actually accepted (a driver took it on DriverMap,
  // or the passenger selected one) there is a live active trip at
  // `trip_${orderId}` and the screen must never show the empty search. Detect
  // it from the seeded active ride (strongest proof) OR the canonical order
  // status. A linked terminal ride (COMPLETED / CANCELED / NO_SHOW) is the
  // authoritative signal that the trip is over, so it suppresses the handoff
  // even when the order status still reads ACCEPTED / IN_PROGRESS — the order
  // status fallback only applies when there is no linked terminal ride.
  const handoffTripId = request.orderId ? `trip_${request.orderId}` : '';
  let handoffRide = handoffTripId ? findActiveRide(handoffTripId) : null;
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
  if (handoffRide && !rideTerminal && request.orderId) {
    const upgraded = upgradeStoredActiveRideForOrder(request.orderId);
    if (upgraded && upgraded !== handoffRide) handoffRide = upgraded;
  }
  const isAccepted = !!canonicalOrder && !rideTerminal && (rideLive || orderHandedOff);
  const effectiveState = isAccepted ? 'accepted' : state;

  const isAllDeclined = !isAccepted && state === 'all-declined';
  const isOffer = !isAccepted && state === 'offer';
  const isList = !isAccepted && (state === 'list' || state === 'selected' || isAllDeclined);
  const routeDriverId = state === 'selected' ? getRouteParam('driverId') : null;
  const selectedDriver = routeDriverId ? drivers.find((d) => d.id === routeDriverId) : null;
  const selectedDriverId = selectedDriver ? selectedDriver.id : null;

  const root = document.createElement('section');
  root.className = 'screen screen--responses';
  root.dataset.postId = postId;
  root.dataset.orderId = request.orderId;
  root.dataset.state = effectiveState;
  root.dataset.source = canonicalOrder ? 'ride-order' : (request.isLegacyMock ? 'legacy-post' : 'mock');

  const status = responseStatus(effectiveState);
  const subTitle = status.subtitle;
  const footer = (isList || isOffer || isAccepted) ? '' : `
    <div class="responses__footer responses__footer--in-scroll">
      <button type="button" class="bd-btn primary responses__cta" id="responses-check">
        <span>Проверить отклики</span>
      </button>
      <button type="button" class="bd-btn responses__cta responses__cta--secondary" id="responses-map">
        ${PENCIL_SVG}
        <span>Изменить заказ</span>
      </button>
    </div>`;

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
        ${renderStatusChip(status)}
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
      ${isAccepted
        ? renderAcceptedDriver(handoffRide, request)
        : (isOffer ? renderOffer(drivers[0]) : (isList ? renderList(drivers, selectedDriverId, isAllDeclined) : renderEmptyState(request)))}
      ${footer}
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

  root.querySelector('#responses-shield').addEventListener('click', () => {
    toast('Безопасность будет добавлена позже');
  });

  root.querySelector('#responses-edit').addEventListener('click', () => {
    go('/order-map-draft');
  });

  const checkBtn = root.querySelector('#responses-check');
  if (checkBtn) {
    checkBtn.addEventListener('click', () => {
      go(responseUrl(request, 'list'));
    });
  }

  const mapBtn = root.querySelector('#responses-map');
  if (mapBtn) {
    mapBtn.addEventListener('click', () => {
      go('/order-map-draft');
    });
  }

  const sortBtn = root.querySelector('#responses-sort');
  if (sortBtn) {
    sortBtn.addEventListener('click', () => {
      toast('Сортировка откликов будет добавлена позже');
    });
  }

  const driversWrap = root.querySelector('.responses__drivers');
  if (driversWrap) {
    driversWrap.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-action]');
      if (!btn) return;
      const card = btn.closest('.responses__driver');
      if (!card) return;
      const driverId = card.dataset.driverId;
      const responseId = card.dataset.responseId;
      const action = btn.dataset.action;

      if (action === 'select' || action === 'continue') {
        if (!canonicalOrder) {
          toast('Сначала откройте опубликованный заказ');
          return;
        }
        const driver = drivers.find((d) => d.id === driverId) || selectedDriver || drivers[0];
        const handoff = buildPassengerActiveRide(canonicalOrder, request, driver);
        if (!handoff) {
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
      if (action === 'restore') {
        go(responseUrl(request, 'list'));
        return;
      }
      if (action === 'chat') {
        go(`/chat?responseId=${encodeURIComponent(responseId)}&orderId=${encodeURIComponent(request.orderId)}`);
        return;
      }
      if (action === 'call') {
        toast('Звонок будет доступен после подтверждения поездки');
        return;
      }
      if (action === 'decline') {
        toast('Отклонение отклика будет добавлено позже');
      }
    });
  }

  // BD-DRIVER-MAP-X-15 — accepted-driver handoff CTA. The driversWrap listener
  // above only binds inside `.responses__drivers` driver cards; the accepted
  // state needs its own handler to open the linked passenger active ride.
  const openActiveRideBtn = root.querySelector('[data-action="open-active-ride"]');
  if (openActiveRideBtn && handoffTripId) {
    openActiveRideBtn.addEventListener('click', () => go(activeRideUrl(handoffTripId)));
  }

  if (state === 'selected' && !selectedDriver) {
    queueMicrotask(() => toast('Этап подтверждения водителя будет добавлен позже'));
  }

  queueMicrotask(markFeedTabActive);

  return root;
}
