// BD-RIDE-COMPLETE-01 — Post-ride history storage.
// Mock-only persistence for completed rides. No backend, no auth, no
// network. Each entry is keyed by `${role}:${tripId}` so the passenger
// and driver views of the same ride live as two independent records.

const HISTORY_KEY = 'bazardrive.ride_history.v1';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
// silently coalesces to [] so call sites that only care about the entries do
// not have to think about the distinction.
//   status === 'empty'     → no key in localStorage
//   status === 'ok'        → valid array (entries already filtered to plain
//                            objects; may still be empty)
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
    return { status: 'ok', entries: parsed.filter(isPlainObject) };
  } catch {
    return { status: 'malformed', entries: [] };
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

function pickFare(ride) {
  const pay = (ride && ride.payment) || {};
  const r = (ride && ride.ride) || {};
  const order = (ride && ride.order) || {};
  return pay.amount || r.price || order.offerPrice || null;
}

function pickDistance(ride) {
  const r = (ride && ride.ride) || {};
  const order = (ride && ride.order) || {};
  return r.distance || order.destinationDistance || null;
}

function pickDuration(ride) {
  const r = (ride && ride.ride) || {};
  const order = (ride && ride.order) || {};
  return r.duration || order.destinationEta || null;
}

function pickRoute(ride) {
  const route = (ride && ride.route) || {};
  return {
    pickupLabel: route.pickupLabel || null,
    dropoffLabel: route.dropoffLabel || null,
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
    earnings: isPlainObject(extras.earnings) ? { ...extras.earnings } : null,
  };
}
