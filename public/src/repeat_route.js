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

// History fares can be stored as finite numbers or pre-formatted strings
// such as "350 ₽" / "1 480 ₽". For the suggested price we carry only a
// parsed finite non-negative number; free-form text is dropped rather than
// injected into a numeric composer input.
function cleanNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed.includes('-')) return null;

    const numeric = trimmed.replace(/\s+/g, '').replace(/[^\d.,]/g, '');
    if (!numeric || !/\d/.test(numeric)) return null;

    const commaIndex = numeric.lastIndexOf(',');
    const dotIndex = numeric.lastIndexOf('.');
    const separatorIndex = Math.max(commaIndex, dotIndex);
    const fractionLength = separatorIndex >= 0 ? numeric.length - separatorIndex - 1 : 0;
    let normalized;

    if (separatorIndex >= 0 && fractionLength > 0 && fractionLength <= 2) {
      const integerPart = numeric.slice(0, separatorIndex).replace(/\D/g, '');
      const fractionPart = numeric.slice(separatorIndex + 1).replace(/\D/g, '');
      normalized = `${integerPart || '0'}.${fractionPart}`;
    } else {
      normalized = numeric.replace(/\D/g, '');
    }

    if (!normalized) return null;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }

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

// Non-destructive peek used by callers that want to *detect* a pending
// repeat-route prefill (e.g. /route-picker showing a "Маршрут заполнен из
// истории" helper banner) without stealing the one-time prefill from the
// composer. Malformed payloads return null and are left in place — the
// next consumeRepeatRouteDraft() will remove them.
export function peekRepeatRouteDraft() {
  let raw = null;
  try {
    if (typeof localStorage === 'undefined') return null;
    raw = localStorage.getItem(REPEAT_ROUTE_KEY);
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
