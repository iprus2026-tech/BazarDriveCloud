// BD-RIDE-COMPLETE-01 — Post-ride history storage.
// Mock-only persistence for completed rides. No backend, no auth, no
// network. Each entry is keyed by `${role}:${tripId}` so the passenger
// and driver views of the same ride live as two independent records.

import { user } from './state.js';
import {
  getActiveRideRouteSnapshot,
  ROUTE_SNAPSHOT_DEFAULTS,
} from './ride_state.js';

const HISTORY_KEY = 'bazardrive.ride_history.v1';
const ROLE_SCOPED_HISTORY = new Set(['passenger', 'driver']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function currentHistoryRole() {
  try {
    const role = user.get()?.role;
    return ROLE_SCOPED_HISTORY.has(role) ? role : null;
  } catch {
    return null;
  }
}

function scopeEntriesToCurrentRole(entries) {
  const role = currentHistoryRole();
  if (!role) return entries;
  return entries.filter((entry) => entry?.role === role);
}

function readStore() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPlainObject) : [];
  } catch {
    return [];
  }
}

// BD-RIDE-HISTORY-03 — Status-aware reader used by surfaces that need to tell
// "empty history" (clean state) apart from "history present but unreadable"
// (malformed JSON, non-array payload). The plain loadRideHistory() still
// returns the full local history so writes cannot accidentally drop the other
// role's records.
//   status === 'empty'     → no key in localStorage
//   status === 'ok'        → valid array (entries already filtered to plain
//                            objects and the current profile role; may still
//                            be empty)
//   status === 'malformed' → raw value exists but is not valid JSON or not an
//                            array — surface should offer a friendly recovery.
export function readRideHistoryStatus() {
  try {
    if (typeof localStorage === 'undefined') {
      return { status: 'empty', entries: [] };
    }
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw == null) return { status: 'empty', entries: [] };
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: 'malformed', entries: [] };
    }
    if (!Array.isArray(parsed)) return { status: 'malformed', entries: [] };
    const entries = scopeEntriesToCurrentRole(parsed.filter(isPlainObject));
    return { status: 'ok', entries };
  } catch {
    // Reaching this outer catch means localStorage access itself threw
    // (privacy mode, restricted storage, etc.) rather than the stored
    // payload being corrupt — JSON parse errors are caught above. Treat
    // this as "no history available" instead of "malformed", because the
    // recovery action (clearRideHistory) cannot fix storage access and
    // would leave the user stuck on a permanent error card.
    return { status: 'empty', entries: [] };
  }
}

function writeStore(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    return true;
  } catch {
    // storage unavailable — fail soft.
    return false;
  }
}

export function loadRideHistory() {
  return readStore();
}

export function saveRideHistoryEntry(entry) {
  if (!isPlainObject(entry) || !entry.tripId || !entry.role) return null;
  const list = readStore();
  const key = `${entry.role}:${entry.tripId}`;
  const idx = list.findIndex((e) => `${e.role}:${e.tripId}` === key);
  // Preserve the original savedAt on upsert so re-rendering a completed
  // ride doesn't bump it to the top of future history lists. A caller
  // that explicitly passes savedAt still wins.
  const previous = idx >= 0 ? list[idx] : null;
  const savedAt = entry.savedAt
    || (previous && previous.savedAt)
    || new Date().toISOString();
  const stamped = { ...entry, savedAt };
  if (idx >= 0) list[idx] = { ...previous, ...stamped };
  else list.unshift(stamped);
  if (!writeStore(list)) return null;
  return stamped;
}

export function clearRideHistory() {
  try { localStorage.removeItem(HISTORY_KEY); } catch {}
}

// BD-MAPBOX-DATA-02 — History snapshot derivation. All four pickers go
// through `getActiveRideRouteSnapshot` so a missing `ride.route`, a
// non-string label, or a null fare cannot crash history serialization.
// `null` is preserved as the "no value" sentinel — em-dash placeholders
// from the snapshot defaults are filtered out so completed entries
// don't list "—" as the saved label.
function nullIfPlaceholder(value, placeholder) {
  if (typeof value !== 'string' || !value) return null;
  if (value === placeholder) return null;
  return value;
}

function pickFare(ride) {
  const pay = (ride && ride.payment) || {};
  if (typeof pay.amount === 'string' && pay.amount.trim()) return pay.amount.trim();
  const snapshot = getActiveRideRouteSnapshot(ride);
  return nullIfPlaceholder(snapshot.priceLabel, ROUTE_SNAPSHOT_DEFAULTS.priceLabel);
}

function pickDistance(ride) {
  const snapshot = getActiveRideRouteSnapshot(ride);
  return nullIfPlaceholder(snapshot.distanceLabel, ROUTE_SNAPSHOT_DEFAULTS.distanceLabel);
}

function pickDuration(ride) {
  // History stores the *elapsed* trip duration, not the "remaining ETA
  // to destination" that the live screen shows mid-trip. Keep the
  // original precedence (`ride.duration` first, then the order's
  // destination ETA) so completed entries don't downgrade to a live
  // countdown value.
  const r = (ride && ride.ride) || {};
  const order = (ride && ride.order) || {};
  if (typeof r.duration === 'string' && r.duration.trim()) return r.duration.trim();
  if (typeof order.destinationEta === 'string' && order.destinationEta.trim()) {
    return order.destinationEta.trim();
  }
  return null;
}

function pickRoute(ride) {
  const snapshot = getActiveRideRouteSnapshot(ride);
  return {
    pickupLabel: nullIfPlaceholder(snapshot.pickupLabel, ROUTE_SNAPSHOT_DEFAULTS.pickupLabel),
    dropoffLabel: nullIfPlaceholder(snapshot.dropoffLabel, ROUTE_SNAPSHOT_DEFAULTS.dropoffLabel),
  };
}

function pickCompletedAt(ride) {
  const ts = ride && ride.timestamps && ride.timestamps.completedAt;
  return ts || new Date().toISOString();
}

export function buildPassengerHistoryEntry(ride, rating = {}) {
  if (!isPlainObject(ride) || !ride.tripId) return null;
  const driver = (ride && ride.driver) || {};
  const vehicle = (ride && ride.vehicle) || {};
  return {
    role: 'passenger',
    tripId: ride.tripId,
    completedAt: pickCompletedAt(ride),
    driver: {
      name: driver.name || null,
      initials: driver.initials || null,
      rating: driver.rating || null,
    },
    vehicle: {
      model: vehicle.model || null,
      color: vehicle.color || null,
      plate: vehicle.plate || null,
    },
    route: pickRoute(ride),
    fare: pickFare(ride),
    distance: pickDistance(ride),
    duration: pickDuration(ride),
    rating: typeof rating.rating === 'number' ? rating.rating : 0,
    tags: Array.isArray(rating.tags) ? rating.tags.slice() : [],
    comment: typeof rating.comment === 'string' ? rating.comment : '',
  };
}

export function buildDriverHistoryEntry(ride, extras = {}) {
  if (!isPlainObject(ride) || !ride.tripId) return null;
  const passenger = (ride && ride.passenger) || {};
  return {
    role: 'driver',
    tripId: ride.tripId,
    completedAt: pickCompletedAt(ride),
    passenger: {
      name: passenger.name || null,
      initials: passenger.initials || null,
      rating: passenger.rating || null,
    },
    route: pickRoute(ride),
    fare: pickFare(ride),
    distance: pickDistance(ride),
    duration: pickDuration(ride),
    // BD-RIDE-HISTORY-D-01 — canonical receipt persisted by the completed
    // driver earnings flow. History rows READ this object (fare / commission /
    // tip / net / paymentMode) and only format it; they never recalculate.
    receipt: isPlainObject(extras.receipt) ? { ...extras.receipt } : null,
    earnings: isPlainObject(extras.earnings) ? { ...extras.earnings } : null,
  };
}
