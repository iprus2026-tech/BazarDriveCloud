// BD-HANDOFF-05 — Driver-side confirmed handoff snapshot.
// Thin per-trip record persisted just before /trip-confirmation hands
// off to /active-ride?role=driver. Captures the visible fields the
// driver just confirmed (passenger, route, price, ETA) so the driver
// active-ride screen can hydrate from them instead of falling back to
// the generic SIM/demo strings when no full active-ride record has
// been seeded for this tripId yet.
//
// Storage-only helpers — no DOM, no router, no Mapbox, no backend. The
// handoff record this module writes is independent of the
// trip_confirmation_handoff record: that one is role='passenger' on the
// chat→confirmation hop, while this one is role='driver' on the
// confirmation→active-ride hop and only carries the seven fields the
// task requires.

const STORAGE_KEY = 'bazardrive.driver_handoff_snapshot.v1';

export const DRIVER_HANDOFF_SNAPSHOT_FALLBACK = Object.freeze({
  passengerName: 'Пассажир',
  pickupLabel:   'Точка подачи',
  dropoffLabel:  'Точка назначения',
  agreedPrice:   '—',
  etaText:       '—',
  status:        'DRIVER_EN_ROUTE',
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeText(value, fallback) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function loadStore() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(isPlainObject(store) ? store : {}));
  } catch {
    // storage unavailable — fail soft.
  }
}

// Persist the snapshot keyed by tripId. Accepts loose input (missing
// fields, arrivalEstimate alias for etaText, orderId fallback to
// tripId) and coerces everything through safeText so the stored record
// is always renderable. Returns the normalized record or null when no
// valid tripId is available.
export function saveDriverHandoffSnapshot(input) {
  if (!isPlainObject(input)) return null;
  const tripId = safeText(input.tripId || input.orderId, '');
  if (!tripId) return null;
  const record = {
    tripId,
    orderId:       safeText(input.orderId || input.tripId, tripId),
    passengerName: safeText(input.passengerName, DRIVER_HANDOFF_SNAPSHOT_FALLBACK.passengerName),
    pickupLabel:   safeText(input.pickupLabel,   DRIVER_HANDOFF_SNAPSHOT_FALLBACK.pickupLabel),
    dropoffLabel:  safeText(input.dropoffLabel,  DRIVER_HANDOFF_SNAPSHOT_FALLBACK.dropoffLabel),
    agreedPrice:   safeText(input.agreedPrice,   DRIVER_HANDOFF_SNAPSHOT_FALLBACK.agreedPrice),
    etaText:       safeText(input.etaText || input.arrivalEstimate, DRIVER_HANDOFF_SNAPSHOT_FALLBACK.etaText),
    status:        safeText(input.status,        DRIVER_HANDOFF_SNAPSHOT_FALLBACK.status),
    savedAt:       Date.now(),
  };
  const store = loadStore();
  store[tripId] = record;
  writeStore(store);
  return record;
}

export function loadDriverHandoffSnapshot(tripId) {
  const key = safeText(tripId, '');
  if (!key) return null;
  const store = loadStore();
  const entry = store[key];
  if (!isPlainObject(entry)) return null;
  return {
    tripId:        safeText(entry.tripId, key),
    orderId:       safeText(entry.orderId || entry.tripId, key),
    passengerName: safeText(entry.passengerName, DRIVER_HANDOFF_SNAPSHOT_FALLBACK.passengerName),
    pickupLabel:   safeText(entry.pickupLabel,   DRIVER_HANDOFF_SNAPSHOT_FALLBACK.pickupLabel),
    dropoffLabel:  safeText(entry.dropoffLabel,  DRIVER_HANDOFF_SNAPSHOT_FALLBACK.dropoffLabel),
    agreedPrice:   safeText(entry.agreedPrice,   DRIVER_HANDOFF_SNAPSHOT_FALLBACK.agreedPrice),
    etaText:       safeText(entry.etaText,       DRIVER_HANDOFF_SNAPSHOT_FALLBACK.etaText),
    status:        safeText(entry.status,        DRIVER_HANDOFF_SNAPSHOT_FALLBACK.status),
    savedAt:       Number.isFinite(entry.savedAt) ? entry.savedAt : null,
  };
}

export function clearDriverHandoffSnapshotStore() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  } catch {
    // fail soft.
  }
}

// Overlay snapshot fields onto a ride object (typically the demo/SIM
// fallback). Pure: returns a new object, never mutates the input. The
// mapping mirrors how active_ride.js reads each field — passenger.name
// for the passenger row, route.pickup/dropoffLabel for the route rows,
// order.offerPrice + ride.price for the displayed fare, and the ETA
// fields used by the en-route / in-progress / completion sheets.
export function applyDriverHandoffSnapshotToRide(ride, snapshot) {
  if (!isPlainObject(ride) || !isPlainObject(snapshot)) return ride;
  const passengerName = safeText(snapshot.passengerName, DRIVER_HANDOFF_SNAPSHOT_FALLBACK.passengerName);
  const pickupLabel   = safeText(snapshot.pickupLabel,   DRIVER_HANDOFF_SNAPSHOT_FALLBACK.pickupLabel);
  const dropoffLabel  = safeText(snapshot.dropoffLabel,  DRIVER_HANDOFF_SNAPSHOT_FALLBACK.dropoffLabel);
  const agreedPrice   = safeText(snapshot.agreedPrice,   DRIVER_HANDOFF_SNAPSHOT_FALLBACK.agreedPrice);
  const etaText       = safeText(snapshot.etaText,       DRIVER_HANDOFF_SNAPSHOT_FALLBACK.etaText);
  return {
    ...ride,
    passenger: { ...(ride.passenger || {}), name: passengerName },
    order: {
      ...(ride.order || {}),
      offerPrice:     agreedPrice,
      destinationEta: etaText,
    },
    route: {
      ...(ride.route || {}),
      pickupLabel,
      dropoffLabel,
      etaToDestination: etaText,
    },
    ride: { ...(ride.ride || {}), price: agreedPrice },
    handoffSnapshot: {
      tripId:        safeText(snapshot.tripId, ride.tripId || ''),
      orderId:       safeText(snapshot.orderId || snapshot.tripId, ride.tripId || ''),
      passengerName,
      pickupLabel,
      dropoffLabel,
      agreedPrice,
      etaText,
      status:        safeText(snapshot.status, ride.status || DRIVER_HANDOFF_SNAPSHOT_FALLBACK.status),
    },
  };
}
