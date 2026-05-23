// BD-HANDOFF-04 — Seed /active-ride from a confirmed
// /trip-confirmation handoff. Pure data + storage helpers; no DOM, no
// router, no Mapbox. Owns the bridge between the
// `bazardrive.trip_confirmation.v1` freshness signal written by /chat
// and the `bazardrive.active_ride.v1` snapshot read by /active-ride.
//
// The handoff record itself only carries metadata (tripId, role, state,
// createdAt, expiresAt). The visual identity that /trip-confirmation
// shows lives in the MOCK_* literals re-exported below; the seed
// builder mirrors those literals into the active-ride contract so that
// passenger and driver active-ride entries render the same passenger,
// driver, vehicle, route, fare and ETA the user just confirmed.

import { RIDE_STATUS, findActiveRide, saveActiveRide } from '../ride_state.js';

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

// Read the confirmed handoff for (tripId, role), build the seed and
// persist it to `bazardrive.active_ride.v1`. Returns the saved ride or
// null when there is nothing to seed (missing/expired/role-mismatched
// handoff, or malformed storage). Safe to call from any render path —
// all storage errors are swallowed by the underlying helpers.
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
  const seed = buildActiveRideSeed({ tripId, role, handoff });
  if (!seed) return null;
  return saveActiveRide(seed);
}
