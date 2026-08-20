// BD-RIDE-AUTHORITY-01D — Pure Ride Context adapters.
// Foundation layer only. No storage, no API/fetch, no DOM, no window, no
// navigation, no MOCK_* literals, no acceptOrder, no saveActiveRide, no
// screen imports.
//
// Shapes an already-resolved order/response pair into exactly the fields
// buildPassengerRideSeed (ride_seed.js) reads — the canonical request
// context (pickupLabel, dropoffLabel, price, note) and the canonical
// driver context (id, responseId, name, initials, rating, car, carModel,
// carColor, plate, price, eta, note). Nothing more.
//
// UI-only decoration (avatarTone, priceDelta, priceTone, etaTone,
// etaBars, etaRank, isBest, trips) and screen-only fallback copy
// (responses.js's MOCK_REQUEST "no order" empty-state text, its
// 'Комментарий не указан' placeholder) are NOT produced here — they stay
// screen-owned in responses.js, which wraps these functions to add them
// back on top without duplicating this file's derivation logic.

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

// pickupTiming on the stored response is a coarse enum; map it to the
// short "Подача" label the /responses card renders. Unknown/missing —>
// em-dash.
const PICKUP_TIMING_LABELS = {
  at_time:   'К времени',
  earlier:   'Можно раньше',
  negotiate: 'Договоримся',
};
function timingLabel(timing) {
  return PICKUP_TIMING_LABELS[timing] || '—';
}

// Canonical request context: only the fields buildPassengerRideSeed
// reads. No MOCK_REQUEST fallback branch — a missing/invalid order field
// resolves to its own neutral value (an empty string for price/note, the
// pointLabel default for pickup/dropoff), never screen copy. Callers that
// need a "no order at all" empty-state stay responsible for that branch
// themselves; this function is only ever meant to be called with a real,
// resolved order.
export function buildRideRequestContext(order) {
  return {
    pickupLabel: pointLabel(order?.pickup, 'Точка подачи'),
    dropoffLabel: pointLabel(order?.dropoff, 'Точка назначения'),
    price: moneyLabelFromOrder(order),
    note: String(order?.comment || order?.passenger?.comment || '').trim(),
  };
}

// Canonical driver context: only the fields buildPassengerRideSeed reads.
// `requestContext` is consulted only for `.isFallback` (present when the
// caller is responses.js's own wrapper working from a request built for
// the "no canonical order" board state; absent/undefined for a real
// order, which resolves the same as isFallback=false) — no other field of
// requestContext is read here. price/rating use '—' as the single
// canonical "no data" sentinel; the isFallback-aware 'По договорённости'
// alternative is intentionally the only screen-facing copy this function
// still produces, because it depends on requestContext, not because it is
// duplicated elsewhere.
export function buildRideDriverContext(response, requestContext) {
  const value = Number(response?.driverPrice);
  const price = Number.isFinite(value) && value > 0
    ? formatRub(value)
    : (requestContext?.isFallback ? 'По договорённости' : '—');
  const note = typeof response?.message === 'string' ? response.message.trim() : '';
  const snap = (response && typeof response.driverSnapshot === 'object' && response.driverSnapshot !== null)
    ? response.driverSnapshot
    : null;
  const pickStr = (v) => (typeof v === 'string' ? v.trim() : '');
  const snapName = pickStr(snap?.name);
  const responseId = (response && response.id) ? String(response.id) : null;
  return {
    id: responseId,
    responseId,
    name: snapName || 'Водитель',
    initials: snapName ? snapName.slice(0, 1).toUpperCase() : 'В',
    rating: (snap && typeof snap.rating === 'number') ? snap.rating.toFixed(1) : '—',
    car: pickStr(snap?.car),
    carModel: pickStr(snap?.carModel),
    carColor: pickStr(snap?.carColor),
    plate: pickStr(snap?.plate),
    price,
    eta: timingLabel(response?.pickupTiming),
    note,
  };
}
