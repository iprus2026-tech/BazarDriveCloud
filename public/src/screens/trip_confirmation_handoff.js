// BD-HANDOFF-04 — Seed /active-ride from a confirmed
// /trip-confirmation handoff. Pure data + storage helpers; no DOM, no
// router, no Mapbox. Owns the bridge between the
// `bazardrive.trip_confirmation.v1` freshness signal written by /chat
// and the `bazardrive.active_ride.v1` snapshot read by /active-ride.
//
// The handoff record itself only carries metadata (tripId, role, state,
// createdAt, expiresAt, responseId). BD-RIDE-AUTHORITY-01B: a confirmed
// handoff for a REAL order/response must seed REAL passenger/driver/
// vehicle/route/price data. BD-RIDE-AUTHORITY-01D: response resolution
// comes from response_store.js (the exact-key responses.v1 lookup leaf)
// and request/driver context shaping from ride_context.js (the pure,
// screen-import-free adapter) — this module no longer imports anything
// from ./responses.js. Zero screen-to-screen dependency remains.
//
// BD-RIDE-ACCEPT-RESPONSE-01 — this module still owns the real handoff
// resolution chain end to end (responseId -> response -> orderId/tripId
// match -> order -> driver snapshot presence), exactly as before. Once
// order/request/driver are resolved, the accept-if-CREATED decision,
// Ride construction (buildPassengerRideSeed, ride_seed.js), tripId
// verification, and persistence are delegated to the shared
// acceptDriverResponse command (ride_actions.js) — the same tail
// responses.js's own buildPassengerActiveRide delegates to, so both real
// entry points share one accept/build/save implementation instead of
// duplicating it. The canonical chat-confirm chain (respond.js ->
// chat.js -> trip_confirmation.js) itself never touches order status, so
// a confirmed handoff genuinely can (and typically does) reach here with
// order.status still 'CREATED' — acceptDriverResponse's accept-if-CREATED
// step is what keeps the order and ride status in sync (never a
// persisted DRIVER_EN_ROUTE ride sitting on a CREATED order).
//
// The MOCK_* literals below stay reserved for the explicit demo seed
// (buildActiveRideSeed) — a real handoff whose data cannot be recovered
// returns null instead of silently falling back to them.

import { RIDE_STATUS, findActiveRide } from '../ride_state.js';
import { getOrderById } from '../mock_api.js';
import { acceptDriverResponse } from '../ride_actions.js';
import { resolveResponseById } from '../response_store.js';
import { buildRideRequestContext, buildRideDriverContext } from '../ride_context.js';

const TRIP_CONFIRM_KEY = 'bazardrive.trip_confirmation.v1';

// Source of truth for the static mock identity shown on
// /trip-confirmation. Both /trip-confirmation and the seed builder
// import from here so the two screens cannot drift.
export const MOCK_PASSENGER = {
  name: 'Анна М.',
  handle: '@anna_m',
  initials: 'АМ',
  rating: '4,86',
  meta: '87 поездок · оплата картой · 4417',
  comment: 'Маленький чемодан',
};

export const MOCK_DRIVER = {
  name: 'Рустам К.',
  initials: 'РК',
  rating: '4,92',
  car: 'Toyota Camry · серый · A 124 ВВ',
  meta: '1 248 поездок · 4 года на платформе',
};

export const MOCK_VEHICLE = {
  model: 'Toyota Camry',
  color: 'серый',
  plate: 'A 124 ВВ',
};

export const MOCK_ROUTE = {
  from: 'ул. Малая Бронная, 28',
  to:   'Аэропорт Шереметьево, терминал B',
  etaMin: 42,
  pickupMin: 4,
  distanceKm: 38,
  priceRub: '1 540 ₽',
  sentAt: '14:04',
  expiredAt: '14:21',
  expiredAgo: '7 мин назад',
};

const VALID_ROLES = new Set(['passenger', 'driver']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Defensive read keyed by tripId. Returns the raw handoff entry or null
// for: missing storage, malformed JSON, missing tripId, empty map,
// non-object entry. Does NOT check expiry — callers gate on that
// explicitly so they can distinguish "no record" from "stale record".
export function loadHandoffRecord(tripId) {
  if (!tripId || typeof tripId !== 'string') return null;
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(TRIP_CONFIRM_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw);
    if (!isPlainObject(map)) return null;
    const entry = map[tripId];
    return isPlainObject(entry) ? entry : null;
  } catch {
    return null;
  }
}

export function isHandoffExpired(handoff) {
  if (!isPlainObject(handoff)) return false;
  const exp = Number(handoff.expiresAt);
  if (!Number.isFinite(exp)) return false;
  return Date.now() > exp;
}

// Returns the handoff iff it exists, is well-formed, has state
// 'CONFIRMED', has not expired, and (when `role` is supplied) the
// stored role matches. Used by the active-ride seeder so a role
// mismatch never leaks the wrong side's snapshot.
export function loadConfirmedHandoff(tripId, role) {
  const handoff = loadHandoffRecord(tripId);
  if (!handoff) return null;
  if (handoff.state !== 'CONFIRMED') return null;
  if (isHandoffExpired(handoff)) return null;
  if (role && handoff.role !== role) return null;
  return handoff;
}

// Builds an active-ride snapshot from the MOCK_* literals that match
// the /trip-confirmation render. The shape is the same one
// `createDemoActiveRide` produces in ride_state.js, so `findActiveRide`
// callers can consume the result without any field coercion.
//
// BD-RIDE-AUTHORITY-01B: this is the explicit demo/fixture seed builder.
// seedActiveRideFromConfirmedHandoff no longer calls it automatically —
// a real confirmed handoff always resolves through
// seedRealActiveRideFromHandoff instead, so a real trip never renders
// this mock identity. Kept exported for an explicit demo/preview caller.
export function buildActiveRideSeed({ tripId, role, handoff }) {
  if (!tripId || !VALID_ROLES.has(role)) return null;
  const now = new Date().toISOString();
  const seed = {
    tripId,
    role,
    status: RIDE_STATUS.DRIVER_EN_ROUTE,
    passenger: {
      name: MOCK_PASSENGER.name,
      initials: MOCK_PASSENGER.initials,
      rating: MOCK_PASSENGER.rating,
      phoneMasked: '+7 ... 44-17',
      luggage: MOCK_PASSENGER.comment,
      note: MOCK_PASSENGER.comment,
    },
    driver: {
      name: MOCK_DRIVER.name,
      initials: MOCK_DRIVER.initials,
      rating: MOCK_DRIVER.rating,
      car: MOCK_DRIVER.car,
      onlineLabel: 'На линии',
      shiftDuration: '5ч 12м',
    },
    vehicle: { ...MOCK_VEHICLE },
    order: {
      offerPrice: MOCK_ROUTE.priceRub,
      rate: '12 ₽ / км',
      commission: '8%',
      acceptTimerSec: 14,
      pickupEta: `${MOCK_ROUTE.pickupMin} мин`,
      pickupDistance: '1,2 км',
      destinationEta: `${MOCK_ROUTE.etaMin} мин`,
      destinationDistance: `${MOCK_ROUTE.distanceKm} км`,
      destinationNote: 'до терминала B',
      tags: [`★ ${MOCK_PASSENGER.rating}`, MOCK_PASSENGER.comment],
    },
    route: {
      pickupLabel: MOCK_ROUTE.from,
      dropoffLabel: MOCK_ROUTE.to,
      currentInstruction: 'Через 350 м направо',
      currentStreet: 'на Тверской бульвар',
      distanceToPickup: '1,2 км',
      etaToPickup: `${MOCK_ROUTE.pickupMin} мин`,
      etaToDestination: `${MOCK_ROUTE.etaMin} мин`,
    },
    ride: {
      price: MOCK_ROUTE.priceRub,
      todayEarnings: '4 720 ₽',
      tripsToday: 7,
      rating: MOCK_DRIVER.rating,
    },
    payment: {
      last4: '4417',
      method: 'Тинькофф',
      note: 'Оплата автоматически после поездки',
      amount: MOCK_ROUTE.priceRub,
    },
    chat: { unread: 0 },
    timestamps: {
      createdAt: now,
      acceptedAt: null,
      arrivedAt: null,
      startedAt: null,
      completedAt: null,
      canceledAt: null,
    },
    seededFrom: 'trip_confirmation_handoff',
  };
  if (isPlainObject(handoff)) {
    seed.handoff = {
      role: handoff.role || null,
      state: handoff.state || null,
      responseId: handoff.responseId || null,
      createdAt: handoff.createdAt || null,
      expiresAt: handoff.expiresAt || null,
    };
  }
  return seed;
}

// BD-RIDE-AUTHORITY-01B / BD-RIDE-ACCEPT-RESPONSE-01 — Resolve a confirmed
// handoff's REAL order + selected response, then delegate the accept/
// build/save tail to the shared acceptDriverResponse command
// (ride_actions.js). Returns the saved ride, or null when real data
// cannot be safely recovered:
//   • no responseId on the handoff, or the response no longer resolves
//   • the response carries no canonical orderId link (e.g. a legacy
//     marketplace response with no backing ride order)
//   • the order no longer resolves, or the response has no driver
//     identity snapshot
//   • trip_<orderId> does not match the requested tripId — the active-
//     ride store is keyed by tripId, and acceptDriverResponse always
//     verifies its built Ride against trip_<orderId>; seeding under a
//     different key than the one the caller will read back is worse than
//     seeding nothing
// A null return is a deliberate "cannot recover" signal, not an error —
// callers must NOT fall back to the MOCK_* demo seed for it (that would
// silently misrepresent a real trip as the canonical demo identity).
//
// request/driver are built from the pre-accept `order` (buildRideRequestContext
// / buildRideDriverContext read neither order.status nor order.acceptedAt),
// so acceptDriverResponse's own accept-if-CREATED step — which decides
// whether to read the order pre- or post-acceptOrder() for the Ride's
// timestamps.acceptedAt — is the only place order.status is consulted.
// This keeps the persisted ride's DRIVER_EN_ROUTE status from ever
// standing on a CREATED order (see header comment), with the accept
// decision, construction, verification, and persistence now owned by one
// shared implementation instead of duplicated here.
function seedRealActiveRideFromHandoff({ tripId, handoff }) {
  const responseId = typeof handoff?.responseId === 'string' ? handoff.responseId.trim() : '';
  if (!responseId) return null;
  const response = resolveResponseById(responseId);
  if (!response) return null;
  const orderId = typeof response.orderId === 'string' ? response.orderId.trim() : '';
  if (!orderId || `trip_${orderId}` !== tripId) return null;
  const order = getOrderById(orderId);
  if (!order) return null;
  const snapName = typeof response.driverSnapshot?.name === 'string' ? response.driverSnapshot.name.trim() : '';
  if (!snapName) return null;
  const request = buildRideRequestContext(order);
  const driver = buildRideDriverContext(response, request);
  return acceptDriverResponse(order, request, driver);
}

// Read the confirmed handoff for (tripId, role) and resolve it to a
// saved active ride. Returns the saved ride or null when there is
// nothing to seed: missing/expired/role-mismatched handoff, malformed
// storage, or (BD-RIDE-AUTHORITY-01B) a real handoff whose order/
// response data cannot be recovered — never a MOCK_* fallback for that
// last case; the caller's existing "no ride" empty state takes over.
//
// Idempotent: if an active ride is already persisted for `tripId`, the
// existing record is returned unchanged. The seeder never clobbers
// lifecycle state — a re-tap of the /trip-confirmation CTA after the
// driver has accepted (acceptedAt) or arrived (arrivedAt) cannot reset
// timestamps or rewind status.
export function seedActiveRideFromConfirmedHandoff({ tripId, role }) {
  const existing = findActiveRide(tripId);
  if (existing) return existing;
  const handoff = loadConfirmedHandoff(tripId, role);
  if (!handoff) return null;
  return seedRealActiveRideFromHandoff({ tripId, handoff });
}

// BD-RIDE-D-10 — Cross-role canonical active-ride loader.
// Both /active-ride?role=driver and /active-ride?role=passenger should
// read the same canonical record for a given tripId. This helper
// centralizes the lookup so the two screens cannot diverge:
//   1. Persisted record under bazardrive.active_ride.v1 wins — once one
//      role materializes the trip, the other sees the same data.
//   2. Otherwise seed from a confirmed handoff for the requested role.
//   3. Otherwise seed from the other role's confirmed handoff: both
//      resolve through the same seedActiveRideFromConfirmedHandoff (real
//      order/response data when it recovers, otherwise null), so a
//      handoff written by one side still describes the same trip for
//      the other side. The seeder persists, so subsequent reads
//      converge on a single canonical record regardless of which role
//      opened first.
// Returns the canonical ride or null when nothing can be derived for
// this tripId.
const OTHER_ROLE = { driver: 'passenger', passenger: 'driver' };

// BD-RIDE-WAITING-01E final repair — the legacy demo-waiting leak
// (waiting.remaining/paidStartsAt frozen at buildDemoRide()'s '2:30'/
// '14:18' snapshot on a real Ride seeded before v296) is now normalized
// at the shared store boundary in ride_state.js (findActiveRide/
// getActiveRide on read, saveActiveRide on write) — the true common
// ancestor every caller of loadCanonicalActiveRide, updateActiveRideStatus,
// upgradeStoredActiveRideForOrder, etc. passes through. A screen-local
// normalizer here only covered this one entry point and missed every
// sibling raw-read path, so it has been removed in favor of the single
// shared boundary; findActiveRide's return value is already normalized.
export function loadCanonicalActiveRide({ tripId, role } = {}) {
  if (!tripId || typeof tripId !== 'string') return null;
  const existing = findActiveRide(tripId);
  if (existing) return existing;
  if (role && VALID_ROLES.has(role)) {
    const seeded = seedActiveRideFromConfirmedHandoff({ tripId, role });
    if (seeded) return seeded;
  }
  const otherRole = role && OTHER_ROLE[role];
  if (otherRole) {
    const crossSeeded = seedActiveRideFromConfirmedHandoff({ tripId, role: otherRole });
    if (crossSeeded) return crossSeeded;
  }
  return null;
}
