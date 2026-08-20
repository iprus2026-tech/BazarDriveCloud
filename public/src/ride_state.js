// BD-RIDE-F-01 — Active ride contracts and storage.
// Foundation layer only. No UI, no route, no Mapbox, no backend.

const STORAGE_KEY = 'bazardrive.active_ride.v1';

export const RIDE_STATUS = {
  NEW_ORDER: 'NEW_ORDER',
  CONFIRMATION_PENDING: 'CONFIRMATION_PENDING',
  CONFIRMED: 'CONFIRMED',
  CHAT_STARTED: 'CHAT_STARTED',
  ACCEPTED: 'ACCEPTED',
  DRIVER_EN_ROUTE: 'DRIVER_EN_ROUTE',
  DRIVER_APPROACHING_PICKUP: 'DRIVER_APPROACHING_PICKUP',
  WAITING_PASSENGER: 'WAITING_PASSENGER',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELED: 'CANCELED',
  NO_SHOW: 'NO_SHOW',
};

// BD-CHAT-03 — Status pill color and label vocabulary, single source of truth
// for any screen that renders a ride-status chip. Tones map to the existing
// .inbox-item__status--* palette in public/styles/cloud.css (no new classes).
// Unknown / non-enum statuses degrade to muted + raw-string passthrough so
// legacy callers that store a human label (e.g. MOCK_TRIP 'Принят') keep
// rendering without throwing.
export const RIDE_STATUS_TONE = {
  NEW_ORDER: 'warning',
  CONFIRMATION_PENDING: 'warning',
  CONFIRMED: 'warning',
  CHAT_STARTED: 'warning',
  ACCEPTED: 'info',
  DRIVER_EN_ROUTE: 'info',
  DRIVER_APPROACHING_PICKUP: 'info',
  WAITING_PASSENGER: 'warning',
  IN_PROGRESS: 'success',
  COMPLETED: 'success',
  CANCELED: 'danger',
  NO_SHOW: 'danger',
};

export const RIDE_STATUS_LABEL = {
  NEW_ORDER: 'Новый заказ',
  CONFIRMATION_PENDING: 'Ожидает подтверждения',
  CONFIRMED: 'Подтверждён',
  CHAT_STARTED: 'Чат начат',
  ACCEPTED: 'Принят',
  DRIVER_EN_ROUTE: 'Водитель едет',
  DRIVER_APPROACHING_PICKUP: 'Подъезжает',
  WAITING_PASSENGER: 'Ждёт пассажира',
  IN_PROGRESS: 'В пути',
  COMPLETED: 'Завершено',
  CANCELED: 'Отменено',
  NO_SHOW: 'Не пришёл',
};

export function resolveRideStatusTone(status) {
  return RIDE_STATUS_TONE[status] || 'muted';
}

export function resolveRideStatusLabel(status) {
  if (RIDE_STATUS_LABEL[status]) return RIDE_STATUS_LABEL[status];
  if (typeof status === 'string' && status.trim()) return status;
  return '';
}

export const DEMO_ACTIVE_RIDE_ID = 'trip_moscow_sheremetyevo_demo';

// BD-RIDE-SIM-01 — Audit scenario for issue #101 / PR #102. Used by
// both the driver and passenger active-ride entries when an audit URL
// has to materialize an in-memory demo ride, so the two sides agree on
// the passenger identity, route, price and note.
export const SIM_AUDIT_RIDE_OVERRIDES = {
  passenger: {
    name: 'Алексей',
    initials: 'А',
    rating: '4,9',
    phoneMasked: '+7 ... 12-34',
    luggage: 'маленький чемодан',
    note: 'Я с маленьким чемоданом. Позвоните, когда подъедете.',
  },
  order: {
    offerPrice: '950 ₽',
    rate: '12 ₽ / км',
    commission: '8%',
    pickupEta: '4 мин',
    pickupDistance: '1,4 км',
    destinationEta: '28 мин',
    destinationDistance: '22 км',
    destinationNote: 'до терминала B',
    tags: ['★ 4,9', 'маленький чемодан', 'просит позвонить'],
  },
  route: {
    pickupLabel: 'Подъезд №3, ТЦ Мега',
    dropoffLabel: 'Аэропорт, терминал B',
    currentInstruction: 'Через 250 м направо',
    currentStreet: 'на выезд из ТЦ',
    etaToDestination: '28 мин',
  },
  ride: {
    price: '950 ₽',
  },
};

// Exported (additive) so the server's #5 Ride-State chokepoint mirrors the exact status->timestamp
// map for its PATCH stamps; pinned against the server by ride-status-parity.test.mjs (BD-DOCS-041).
export const STATUS_TIMESTAMP_FIELD = {
  [RIDE_STATUS.ACCEPTED]: 'acceptedAt',
  [RIDE_STATUS.DRIVER_EN_ROUTE]: 'acceptedAt',
  [RIDE_STATUS.DRIVER_APPROACHING_PICKUP]: 'approachingAt',
  [RIDE_STATUS.WAITING_PASSENGER]: 'arrivedAt',
  [RIDE_STATUS.IN_PROGRESS]: 'startedAt',
  [RIDE_STATUS.COMPLETED]: 'completedAt',
  [RIDE_STATUS.CANCELED]: 'canceledAt',
  [RIDE_STATUS.NO_SHOW]: 'canceledAt',
};

const NEXT_DRIVER_STATUS = {
  [RIDE_STATUS.NEW_ORDER]: RIDE_STATUS.ACCEPTED,
  [RIDE_STATUS.ACCEPTED]: RIDE_STATUS.DRIVER_EN_ROUTE,
  [RIDE_STATUS.DRIVER_EN_ROUTE]: RIDE_STATUS.DRIVER_APPROACHING_PICKUP,
  [RIDE_STATUS.DRIVER_APPROACHING_PICKUP]: RIDE_STATUS.WAITING_PASSENGER,
  [RIDE_STATUS.WAITING_PASSENGER]: RIDE_STATUS.IN_PROGRESS,
  [RIDE_STATUS.IN_PROGRESS]: RIDE_STATUS.COMPLETED,
  [RIDE_STATUS.COMPLETED]: RIDE_STATUS.COMPLETED,
  [RIDE_STATUS.CANCELED]: RIDE_STATUS.CANCELED,
  [RIDE_STATUS.NO_SHOW]: RIDE_STATUS.NO_SHOW,
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return base;
  const out = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function buildDemoRide() {
  return {
    tripId: DEMO_ACTIVE_RIDE_ID,
    role: 'driver',
    status: RIDE_STATUS.NEW_ORDER,
    passenger: {
      name: 'Анна М.',
      initials: 'АМ',
      rating: '4,86',
      phoneMasked: '+7 ... 23-45',
      luggage: '1 чемодан',
    },
    driver: {
      name: 'Рустам К.',
      initials: 'РК',
      rating: '4,92',
      onlineLabel: 'На линии',
      shiftDuration: '5ч 12м',
    },
    order: {
      offerPrice: '1 480 ₽',
      rate: '12 ₽ / км',
      commission: '8%',
      acceptTimerSec: 14,
      pickupEta: '3 мин',
      pickupDistance: '1,2 км',
      destinationEta: '42 мин',
      destinationDistance: '38 км',
      destinationNote: 'до МКАД и далее',
      tags: ['★ 4,86', '1 чемодан', 'есть детское'],
    },
    route: {
      pickupLabel: 'ул. Малая Бронная, 28',
      dropoffLabel: 'Шереметьево, терминал В',
      currentInstruction: 'Через 350 м направо',
      currentStreet: 'на Тверской бульвар',
      distanceToPickup: '1,2 км',
      etaToPickup: '3 мин',
      etaToDestination: '17 мин',
      pickup: { lng: 37.6173, lat: 55.7558 },
      dropoff: { lng: 37.4146, lat: 55.9726 },
    },
    ride: {
      price: '1 540 ₽',
      todayEarnings: '4 720 ₽',
      tripsToday: 7,
      rating: '4,92',
    },
    waiting: {
      freeLimit: '3:00',
      remaining: '2:30',
      paidStartsAt: '14:18',
      paidRate: '8 ₽ за каждую минуту',
    },
    timestamps: {
      createdAt: new Date().toISOString(),
      acceptedAt: null,
      approachingAt: null,
      arrivedAt: null,
      startedAt: null,
      completedAt: null,
      canceledAt: null,
    },
  };
}

export function loadActiveRideStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveActiveRideStore(store) {
  try {
    const safe = isPlainObject(store) ? store : {};
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  } catch {
    // storage unavailable (private mode, quota) — fail soft.
  }
}

export function createDemoActiveRide(overrides = {}) {
  const base = buildDemoRide();
  const merged = deepMerge(base, overrides);
  if (!merged.status) merged.status = RIDE_STATUS.NEW_ORDER;
  if (!merged.timestamps || !merged.timestamps.createdAt) {
    merged.timestamps = {
      ...base.timestamps,
      ...(merged.timestamps || {}),
      createdAt: new Date().toISOString(),
    };
  }
  return merged;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// BD-RIDE-WAITING-01E final repair — shared store-level boundary for the
// legacy pre-v296 demo-waiting leak (waiting.remaining/paidStartsAt frozen
// at buildDemoRide()'s literal '2:30'/'14:18' snapshot on any real Ride
// seeded before the ride_seed.js/ride_actions.js waiting override shipped).
// Screen-level patches (a normalizer in trip_confirmation_handoff.js, a
// hydration re-read in active_ride_passenger.js) kept missing sibling read
// paths — updateActiveRideStatus's own raw findActiveRide, responses.js's
// upgradeStoredActiveRideForOrder, order_detail.js's idempotency check —
// because none of them shared one boundary. findActiveRide/getActiveRide
// (read) and saveActiveRide (write) are the true common ancestor every one
// of those paths passes through, so the fix belongs here.
//
// Real-ride discriminator: deliberately conservative, existing-data only —
// no new provenance field. The primary signal is one of the two markers
// every real-seed path now sets: a non-empty orderId (ride_seed.js,
// ride_actions.js::seedActiveRideFromAcceptedOrder, order_detail.js) or a
// non-empty acceptedSource (ride_actions.js::seedActiveRideFromAcceptedOrder,
// acceptPassengerRequestFromPost). tripId SHAPE is NOT a general-purpose
// discriminator — a tripId prefix is not proof of provenance on its own
// (an arbitrary sim/audit tripId can take any shape).
//
// legacyFeedAccept is a narrow, one-time compatibility exception, not a
// second universal marker: acceptPassengerRequestFromPost/buildRideFromPost
// used the reserved feed-<postId> tripId namespace for real marketplace
// accepts before this repair series added the acceptedSource marker, so an
// unmarked pre-existing feed-* record in a user's localStorage has no other
// signal to recover through. New feed accepts are already covered by the
// primary acceptedSource='feed_post_accept' marker and do not depend on
// this exception; it exists solely so historical real records are not
// stranded with the stale demo snapshot forever.
//
// Only normalizes when BOTH waiting.remaining and waiting.paidStartsAt
// still equal the exact demo literals — nothing else in the codebase ever
// writes any other value into these two fields after seed time, so this
// match can only ever be stale demo residue on a real-candidate ride,
// never a coincidentally-real value. Pure: never mutates the input,
// returns a shallow copy when normalizing.
function normalizeLegacyWaitingLeak(ride) {
  if (!isPlainObject(ride)) return ride;
  const explicitRealCandidate = nonEmptyString(ride.orderId) || nonEmptyString(ride.acceptedSource);
  const legacyFeedAccept = typeof ride.tripId === 'string' && ride.tripId.startsWith('feed-');
  const isRealCandidate = explicitRealCandidate || legacyFeedAccept;
  if (!isRealCandidate) return ride;
  const waiting = ride.waiting;
  if (!isPlainObject(waiting) || waiting.remaining !== '2:30' || waiting.paidStartsAt !== '14:18') return ride;
  return {
    ...ride,
    waiting: { ...waiting, remaining: null, paidStartsAt: null },
  };
}

export function findActiveRide(tripId = DEMO_ACTIVE_RIDE_ID) {
  const store = loadActiveRideStore();
  const existing = store[tripId];
  return existing && isPlainObject(existing) ? normalizeLegacyWaitingLeak(existing) : null;
}

export function getActiveRide(tripId = DEMO_ACTIVE_RIDE_ID) {
  const existing = findActiveRide(tripId);
  if (existing) return existing;
  const store = loadActiveRideStore();
  const demo = createDemoActiveRide({ tripId });
  store[tripId] = demo;
  saveActiveRideStore(store);
  return demo;
}

// BD-ACTIVE-RIDE-TERM-01 — terminal-status frozen set. Any update or
// pre-save that would transition an existing CANCELED / NO_SHOW /
// COMPLETED ride to a different status is refused at the store level:
// the screen-side renders never bind non-terminal-action buttons on a
// terminal ride, but a stale tab — where the click event fires after
// another tab persisted the terminal transition — could otherwise
// land a regression. Declared above the writers (`saveActiveRide`,
// `updateActiveRideStatus`, `cancelActiveRide`) so the
// temporal-dead-zone never matters.
const TERMINAL_RIDE_STATUSES = new Set([
  RIDE_STATUS.CANCELED,
  RIDE_STATUS.NO_SHOW,
  RIDE_STATUS.COMPLETED,
]);

// BD-CHAT-01 (Cloud Design port) — exported terminal check so the chat screen can
// lock its composer to read-only on a completed/canceled/no-show trip without
// re-deriving (and drifting from) the canonical terminal set above.
export function isTerminalRideStatus(status) {
  return TERMINAL_RIDE_STATUSES.has(status);
}

export function saveActiveRide(ride) {
  if (!isPlainObject(ride) || !ride.tripId) return ride;
  const store = loadActiveRideStore();
  // BD-ACTIVE-RIDE-TERM-01 P2 — terminal-record freeze on the pre-save
  // path. Without this guard, a stale tab calling
  // `saveActiveRide(staleNonTerminalRide)` (the passenger cancel
  // handler does exactly this as a pre-save before
  // `updateActiveRideStatus`) would thaw an existing terminal record
  // back to a non-terminal status, losing `cancel.by`, `cancel.reason`,
  // and `timestamps.canceledAt`. The store-level freeze refuses any
  // incoming write that would change a terminal `existing.status` to
  // a different status. Idempotent re-save of the same terminal status
  // passes through so a legitimate field patch on a terminal record
  // (without changing the status) still lands.
  const existing = store[ride.tripId];
  if (existing && isPlainObject(existing)
      && TERMINAL_RIDE_STATUSES.has(existing.status)
      && ride.status !== existing.status) {
    return normalizeLegacyWaitingLeak(existing);
  }
  // BD-RIDE-WAITING-01E final repair — write-boundary half of the shared
  // normalizer (see normalizeLegacyWaitingLeak above). Whatever is about
  // to be persisted is normalized first, so the stored record — and the
  // returned value, which must reflect what was actually saved — never
  // carry a real-candidate ride's stale demo waiting snapshot forward.
  // This is what makes updateActiveRideStatus's own raw findActiveRide ->
  // deepMerge -> saveActiveRide chain self-healing: once findActiveRide
  // starts returning a normalized ride, deepMerge has nothing stale left
  // to carry into the next save, and this second pass is a no-op.
  const normalized = normalizeLegacyWaitingLeak(ride);
  store[ride.tripId] = normalized;
  saveActiveRideStore(store);
  return normalized;
}

export function isValidRideStatus(status) {
  return typeof status === 'string'
    && Object.prototype.hasOwnProperty.call(RIDE_STATUS, status);
}

export function getNextDriverStatus(status) {
  return NEXT_DRIVER_STATUS[status] || status;
}

export function updateActiveRideStatus(tripId, status, patch = {}) {
  if (!isValidRideStatus(status)) return findActiveRide(tripId);
  // BD-ACTIVE-RIDE-TERM-01 — terminal-regression guard. Read through
  // findActiveRide (NOT getActiveRide) so we don't auto-create a demo
  // ride just to refuse the transition; the caller's stale tripId
  // returns whatever's actually persisted (null when the trip never
  // existed). When the ride is already in a terminal status, return
  // it verbatim — no status overwrite, no timestamp rewrite, no patch
  // merge.
  const existing = findActiveRide(tripId);
  if (existing && TERMINAL_RIDE_STATUSES.has(existing.status)) {
    return existing;
  }
  // BD-ACTIVE-RIDE-TERM-01 P2 — terminal writes require an existing
  // active ride. Without this guard, a stale / forged
  // `updateActiveRideStatus('unknown-trip', 'CANCELED')` would call
  // `getActiveRide` below, materialise a demo identity, and stamp it
  // CANCELED. Non-terminal writes keep the legacy auto-create
  // behaviour because various screen flows rely on it (the driver
  // accept handler still expects `updateActiveRideStatus` to
  // materialise a demo ride from a deep-link tripId).
  if (TERMINAL_RIDE_STATUSES.has(status) && !existing) {
    return null;
  }
  const ride = existing || getActiveRide(tripId);
  const timestampField = STATUS_TIMESTAMP_FIELD[status];
  const timestamps = { ...(ride.timestamps || {}) };
  if (timestampField) {
    if (timestampField === 'acceptedAt') {
      if (!timestamps.acceptedAt) timestamps.acceptedAt = new Date().toISOString();
    } else {
      timestamps[timestampField] = new Date().toISOString();
    }
  }
  const next = deepMerge(ride, patch);
  next.status = status;
  next.timestamps = timestamps;
  return saveActiveRide(next);
}

// BD-ACTIVE-RIDE-TERM-01 — actor-aware active-ride cancel.
//
// Closes the post-handoff terminal-visibility gap: the Order Detail
// 01D-2A/B/C/D slices intentionally do NOT mutate
// `bazardrive.active_ride.v1`, so once an active ride is created via
// the open-trip handoff, only this helper (and the equivalent
// `updateActiveRideStatus` patch path the active-ride screens already
// use) can write the terminal cancel record onto it.
//
// Eligibility:
//   • `tripId` MUST be a non-empty string AND already exist in the
//     active-ride store. Calls on an unknown tripId return null —
//     unlike `getActiveRide`, this helper NEVER auto-creates a demo
//     ride. A stale or forged call therefore cannot pin a CANCELED
//     status onto a freshly-materialized demo identity.
//   • Already-terminal rides (CANCELED / NO_SHOW / COMPLETED) are
//     returned verbatim — idempotent on any prior cancel actor /
//     terminal status. The caller checks `result.cancel?.by` to
//     differentiate the success path from the stale outcome.
//
// Stamps:
//   • status                = 'CANCELED'
//   • timestamps.canceledAt = monotonic ISO stamp
//   • cancel.by             = `canceledBy` (preserved verbatim;
//                             'driver' / 'passenger' / 'system' /
//                             any other non-empty string passes;
//                             missing / non-string becomes null so
//                             the render branches degrade gracefully)
//   • cancel.reason         = `reason` (preserved verbatim when a
//                             non-empty string; otherwise omitted)
//   • cancel.comment        = `comment` (preserved verbatim when a
//                             non-empty string; otherwise omitted)
//
// Preserved verbatim from the existing ride snapshot:
//   • every ride-shape field outside `status` / `timestamps.canceledAt`
//     / `cancel` (passenger / driver / order / route / ride / waiting
//     etc.) — the cancel must not erase the snapshot data the terminal
//     copy renders against.
//
// Does NOT touch:
//   • the Order Detail overlay store
//     (`bazardrive.order_overlay.v1`) — that surface is owned by the
//     Order Detail 01D slices;
//   • the DriverOffer store (`bazardrive.driver_offers.v1`).
export function cancelActiveRide({ tripId, canceledBy, reason, comment } = {}) {
  if (typeof tripId !== 'string' || !tripId) return null;
  const existing = findActiveRide(tripId);
  if (!existing) return null;
  if (TERMINAL_RIDE_STATUSES.has(existing.status)) return existing;
  const by = typeof canceledBy === 'string' && canceledBy ? canceledBy : null;
  const cancel = { ...(isPlainObject(existing.cancel) ? existing.cancel : {}) };
  cancel.by = by;
  if (typeof reason === 'string' && reason) cancel.reason = reason;
  if (typeof comment === 'string' && comment) cancel.comment = comment;
  const next = {
    ...existing,
    status: RIDE_STATUS.CANCELED,
    cancel,
    timestamps: {
      ...(isPlainObject(existing.timestamps) ? existing.timestamps : {}),
      canceledAt: new Date().toISOString(),
    },
  };
  return saveActiveRide(next);
}

export function resetActiveRide(tripId = DEMO_ACTIVE_RIDE_ID) {
  const store = loadActiveRideStore();
  if (Object.prototype.hasOwnProperty.call(store, tripId)) {
    delete store[tripId];
    saveActiveRideStore(store);
  }
  return store;
}

export function clearActiveRideStore() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // fail soft.
  }
}

// BD-MAPBOX-DATA-02 — Accepted route snapshot contract.
// Canonical, role-agnostic view of the route data that survives from
// `seedActiveRideFromAcceptedOrder` through the driver / passenger
// ActiveRide screens into completed ride history. Driver and passenger
// screens read these same fields off the ride object directly today;
// this helper centralizes the fallback chain so:
//   • broken / missing route fields never throw (every value is
//     resolved through `pickString` and falls back to an em-dash);
//   • completed ride history can serialize the snapshot without
//     re-implementing the field precedence in two places;
//   • future Mapbox-derived ride records (with richer route data) can
//     be projected onto the same surface without changing call sites.
export const ROUTE_SNAPSHOT_DEFAULTS = Object.freeze({
  tripId:        null,
  pickupLabel:   '—',
  dropoffLabel:  '—',
  priceLabel:    '—',
  distanceLabel: '—',
  etaLabel:      '—',
  acceptedAt:    null,
});

function pickString(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function getActiveRideRouteSnapshot(ride) {
  const safe = isPlainObject(ride) ? ride : {};
  const route = isPlainObject(safe.route) ? safe.route : {};
  const order = isPlainObject(safe.order) ? safe.order : {};
  const rideStats = isPlainObject(safe.ride) ? safe.ride : {};
  const timestamps = isPlainObject(safe.timestamps) ? safe.timestamps : {};
  const tripId = pickString(safe.tripId);
  const pickupLabel = pickString(route.pickupLabel);
  const dropoffLabel = pickString(route.dropoffLabel);
  const priceLabel = pickString(rideStats.price) || pickString(order.offerPrice);
  const distanceLabel = pickString(rideStats.distance) || pickString(order.destinationDistance);
  const etaLabel = pickString(route.etaToDestination)
    || pickString(rideStats.duration)
    || pickString(order.destinationEta);
  const acceptedAt = pickString(timestamps.acceptedAt);
  return {
    tripId:        tripId || ROUTE_SNAPSHOT_DEFAULTS.tripId,
    pickupLabel:   pickupLabel   || ROUTE_SNAPSHOT_DEFAULTS.pickupLabel,
    dropoffLabel:  dropoffLabel  || ROUTE_SNAPSHOT_DEFAULTS.dropoffLabel,
    priceLabel:    priceLabel    || ROUTE_SNAPSHOT_DEFAULTS.priceLabel,
    distanceLabel: distanceLabel || ROUTE_SNAPSHOT_DEFAULTS.distanceLabel,
    etaLabel:      etaLabel      || ROUTE_SNAPSHOT_DEFAULTS.etaLabel,
    acceptedAt:    acceptedAt    || ROUTE_SNAPSHOT_DEFAULTS.acceptedAt,
  };
}
