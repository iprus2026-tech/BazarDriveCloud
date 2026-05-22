// BD-RIDE-HISTORY-05 — One-time "repeat route" prefill bridge.
//
// Depends on BD-RIDE-HISTORY-04 (the ride-history detail receipt in
// screens/profile.js) for its only writer: the receipt's "Повторить
// маршрут" action sanitizes a completed ride into a route-only draft here,
// and the composer (/new) consumes it once on load.
//
// Only safe routing fields cross the boundary — pickup, dropoff and the
// previous fare as a *suggested* price/budget. Everything identity- or
// settlement-shaped (driver/passenger identity, payment, earnings, rating,
// comment, chat, ride status, completedAt) is intentionally dropped so a
// repeated route can never resurrect a stale order or another party's data.
//
// Backed by localStorage so the value survives the in-app navigation from
// /profile to /new, and consumed (read-and-removed) on first read so a
// stale prefill can never silently reappear on a later visit to the
// composer. The key is user-scoped trip data, so it joins the
// clear-on-boundary set in storage_boundary.js.

const REPEAT_ROUTE_KEY = 'bazardrive.repeat_route.v1';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// History fares/distances/durations are stored as either finite numbers or
// pre-formatted strings (see ride_history.js). For the suggested price we
// only carry a clean numeric value; anything else is dropped rather than
// guessed at, so we never inject "350 ₽" into a numeric price input.
function cleanNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function normalizeRole(value) {
  return value === 'driver' ? 'driver' : 'passenger';
}

// Build a safe repeat-route draft from a ride-history entry. Returns null
// when the entry lacks a usable pickup+dropoff pair so callers can decline
// to offer (or act on) the repeat action for malformed / partial history.
export function buildRepeatRouteDraft(entry) {
  if (!isPlainObject(entry)) return null;
  const route = isPlainObject(entry.route) ? entry.route : {};
  const pickup = cleanString(route.pickupLabel);
  const dropoff = cleanString(route.dropoffLabel);
  if (!pickup || !dropoff) return null;
  const draft = { role: normalizeRole(entry.role), pickup, dropoff };
  const fare = cleanNumber(entry.fare);
  if (fare != null) draft.suggestedFare = fare;
  return draft;
}

// Persist a one-time prefill from a ride-history entry. Returns false (and
// writes nothing) when the entry has no usable route, or when storage is
// unavailable.
export function writeRepeatRouteDraft(entry) {
  const draft = buildRepeatRouteDraft(entry);
  if (!draft) return false;
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(REPEAT_ROUTE_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

// Read-and-remove. Returns a sanitized draft or null. The key is removed
// even when its payload is malformed, guaranteeing one-time consumption so
// a corrupt value can never wedge /new on every visit.
export function consumeRepeatRouteDraft() {
  let raw = null;
  try {
    if (typeof localStorage === 'undefined') return null;
    raw = localStorage.getItem(REPEAT_ROUTE_KEY);
    localStorage.removeItem(REPEAT_ROUTE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  const pickup = cleanString(parsed.pickup);
  const dropoff = cleanString(parsed.dropoff);
  if (!pickup || !dropoff) return null;
  const draft = { role: normalizeRole(parsed.role), pickup, dropoff };
  const suggestedFare = cleanNumber(parsed.suggestedFare);
  if (suggestedFare != null) draft.suggestedFare = suggestedFare;
  return draft;
}

export function clearRepeatRouteDraft() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(REPEAT_ROUTE_KEY);
  } catch {
    // storage unavailable — fail soft.
  }
}
