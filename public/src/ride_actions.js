// BD-RIDE-UTIL-01 — Shared ride action helpers.
// Extracted from feed.js and post_detail.js so Feed and Post Details
// agree on driver-readiness, ride construction from a feed post, and
// the accept-order side effect. No UI here, no router, no DOM.

import {
  createDemoActiveRide,
  saveActiveRide,
  RIDE_STATUS,
} from './ride_state.js';
import { acceptNearbyOrder, LOCAL_USER_ID } from './mock_api.js';
import { isDriverLineReady, user } from './state.js';
import { resolveActiveGarageVehicle } from './garage.js';

function initial(name) {
  return name ? String(name).trim().charAt(0).toUpperCase() : '?';
}

export function isPassengerMode(u) {
  return !!u && u.role === 'passenger';
}

export function isDriverMode(u) {
  return !!u && u.role === 'driver';
}

// BD-DRIVER-02 — line-readiness is the single source of truth in state.js.
// Re-exported here so Feed / Post Detail accept gating (canAcceptOrder) shares
// the exact same rule as Profile and the /driver-map readiness gate, and the
// three surfaces cannot drift.
export { isDriverLineReady };

export function canManageOwnOrder(order, _user) {
  if (!order || typeof order !== 'object') return false;
  if (order.createdByCurrentUser === true) return true;
  if (order.isCurrentUser === true) return true;
  if (order.authorId === LOCAL_USER_ID) return true;

  const passenger = order.passenger;
  if (passenger && typeof passenger === 'object') {
    if (passenger.isCurrentUser === true) return true;
    if (passenger.authorId === LOCAL_USER_ID) return true;
  }

  return false;
}

export function canAcceptOrder(order, u) {
  if (!order || !isDriverMode(u)) return false;
  if (!isDriverLineReady(u)) return false;
  if (canManageOwnOrder(order, u)) return false;

  if (order.canonical === 'ride_order' && order.orderId) {
    return order.type === 'trip' && order.passenger === true;
  }

  if (order.type === 'trip') {
    return order.passenger === true;
  }

  return order.type === 'ride_order' || order.type === 'passenger_request';
}

export function buildRideFromPost(post) {
  const p = post || {};
  const tripId = `feed-${p.id || Date.now()}`;
  const passengerName = p.passenger ? (p.author || 'Пассажир') : 'Пассажир';
  return createDemoActiveRide({
    tripId,
    status: RIDE_STATUS.NEW_ORDER,
    passenger: {
      name: passengerName,
      initials: initial(passengerName),
    },
    order: {
      offerPrice: p.price || '—',
    },
    route: {
      pickupLabel: p.from || '',
      dropoffLabel: p.to || '',
    },
  });
}

export function canAcceptPassengerRequest(u, post) {
  return canAcceptOrder(post, u);
}

export function acceptPassengerRequestFromPost(post) {
  const ride = buildRideFromPost(post);
  saveActiveRide(ride);
  return ride;
}

// BD-RIDE-ORDER-UNIFY-01 PR3 — Shared seed for accepted canonical ride
// orders. Mirrors the helper that used to live in driver_map.js so Feed
// and DriverMap accept paths land on the same active-ride record.
function pointLabel(point, fallback) {
  if (point && typeof point === 'object'
      && typeof point.label === 'string'
      && point.label.trim()) {
    return point.label.trim();
  }
  return fallback;
}

// BD-MAPBOX-DATA-02 — Canonical projection from a CREATED→ACCEPTED ride
// order into the route snapshot contract carried on the active ride.
// Pure: no storage, no DOM, no router. Returns null for orders that
// lack an `id` so the seeder can short-circuit safely (and orphan
// records cannot land in `bazardrive.active_ride.v1`).
export function buildRouteSnapshotFromOrder(order) {
  if (!order || typeof order !== 'object' || !order.id) return null;
  const tripId       = `trip_${order.id}`;
  const pickupLabel  = pointLabel(order.pickup,  'Точка подачи');
  const dropoffLabel = pointLabel(order.dropoff, 'Точка назначения');
  const distanceKm   = Number(order.distanceKm)  || 0;
  const durationMin  = Number(order.durationMin) || 0;
  const priceRub     = Number(order.estimatedPrice) || 0;
  const priceLabel   = `${priceRub.toLocaleString('ru-RU')} ₽`;
  const distanceLabel = distanceKm > 0 ? `${distanceKm} км` : '—';
  const etaLabel      = durationMin > 0 ? `${durationMin} мин` : '—';
  const acceptedAt    = typeof order.acceptedAt === 'string'
    ? order.acceptedAt
    : new Date().toISOString();
  return {
    tripId,
    pickupLabel,
    dropoffLabel,
    priceLabel,
    distanceLabel,
    etaLabel,
    acceptedAt,
  };
}

// BD-ACTIVE-07 — Build the active-ride passenger row strictly from the
// snapshot pinned on the accepted order. We replace (not merge) the
// passenger object so demo defaults from buildDemoRide() ("Анна М.",
// rating 4,86, "+7 ... 23-45", "1 чемодан") cannot leak into a fresh
// order. Orders created before this contract was added fall through to
// a neutral "Пассажир" placeholder instead of the demo identity.
function buildAcceptedOrderPassenger(order) {
  const snap = order && typeof order.passenger === 'object' && order.passenger
    ? order.passenger
    : null;
  if (snap && typeof snap.name === 'string' && snap.name.trim()) {
    const name = snap.name.trim();
    return {
      name,
      initials: typeof snap.initials === 'string' && snap.initials.trim()
        ? snap.initials.trim()
        : name.charAt(0).toUpperCase(),
      phoneMasked: typeof snap.phoneMasked === 'string' ? snap.phoneMasked : '',
      note: typeof snap.comment === 'string' ? snap.comment : '',
      rating: '',
      luggage: '',
      authorId: typeof snap.authorId === 'string' ? snap.authorId : null,
      isCurrentUser: snap.isCurrentUser === true,
    };
  }
  return {
    name: 'Пассажир',
    initials: 'П',
    phoneMasked: '',
    note: typeof order?.comment === 'string' ? order.comment : '',
    rating: '',
    luggage: '',
    authorId: null,
    isCurrentUser: false,
  };
}

// BD-LIFE-06 — Capture the accepting driver's current profile so the
// shared accept seeder below (driven by Feed / Post Detail / DriverMap
// canonical accept paths) does not fall back to the "Рустам К." demo
// driver baked into buildDemoRide (ride_state.js:157-163).
//
// Mirrors the snapshot shape that respond.js writes onto
// passenger_response.driverSnapshot (BD-RIDE-ORDER-01) so passenger
// surfaces (renderAcceptedDriver, active_ride_passenger topDriverCard)
// see the same identity whether the driver came in via /responses
// pinning or via direct canonical accept.
//
// Returns null when the user has no driver-readiness data at all so the
// caller can fall through to createDemoActiveRide demo defaults (legacy
// path). In practice canAcceptOrder gates this behind isDriverLineReady
// (state.js), which already requires phone + vehicleMake + vehicleModel
// + vehiclePlate, so the null branch is unreachable for real accepts.
function pickStr(v) { return typeof v === 'string' ? v.trim() : ''; }

function maskDriverPlate(raw) {
  const s = pickStr(raw);
  if (!s) return '';
  const parts = s.split(/\s+/);
  if (parts.length >= 3) {
    parts[1] = '•'.repeat(Math.max(parts[1].length, 3));
    return parts.join(' ');
  }
  if (s.length > 3) return s.slice(0, 1) + '•'.repeat(Math.max(s.length - 3, 1)) + s.slice(-2);
  return s;
}

// BD-PROFILE-D-05E — Read the vehicle subfield via the shared garage
// resolver so the accept-handoff snapshot reflects the driver's
// selected active garage vehicle. Strictly read-only: the driver
// identity (name / rating) still flows from legacy profile fields, and
// no localStorage / driverGarage / active-ride / history / receipt
// mutation happens here. The null-bail (rawName / model / plate / color
// all empty) is preserved so partially-onboarded drivers still fall
// through to the demo fallback path.
export function buildAcceptedDriverSnapshot(u) {
  if (!u || typeof u !== 'object') return null;
  const composedName = [pickStr(u.firstName), pickStr(u.lastName)].filter(Boolean).join(' ');
  const rawName = pickStr(u.displayName) || composedName || pickStr(u.name);
  const activeVehicle = resolveActiveGarageVehicle(u);
  const make  = pickStr(u.vehicleMake);
  const model = pickStr(u.vehicleModel);
  const legacyVehicleModel = (make && model) ? `${make} ${model}` : (make || model);
  // BD-PROFILE-GARAGE-ARCHIVE-I2 Codex P2 — legacy-fallback suppression.
  // When the user has a real persisted garage collection
  // (`driverGarage.vehicles` non-empty), the legacy `vehicleMake /
  // Model / Color / Plate` fields are intentionally PRESERVED on the
  // user record even after archive. If the resolver returns null in
  // that state, falling back to legacy here would publish the just-
  // archived car in the accept handoff snapshot even though /respond
  // and the garage resolver agree there is no active vehicle. Suppress
  // legacy fallback when a garage collection record exists; an
  // empty / never-touched garage still uses the legacy fallback (the
  // partially-onboarded driver path).
  //
  // BD-PROFILE-GARAGE-ARCHIVE-I2 Codex P2 follow-up (#493) — when the
  // garage record exists but no active vehicle is selected, emit
  // NON-FALSY neutral placeholders instead of empty strings. The
  // passenger surfaces' `vehicle.model || 'Toyota Camry'` /
  // `vehicle.plate || …` fallback chains would otherwise replace
  // empty strings with demo-car copy, leaking demo data into a real
  // accepted ride snapshot.
  const garageHasCollection = Array.isArray(u.driverGarage && u.driverGarage.vehicles)
    && u.driverGarage.vehicles.length > 0;
  const useLegacy = !activeVehicle && !garageHasCollection;
  const noActiveWithGarage = !activeVehicle && garageHasCollection;
  const NEUTRAL_VEHICLE_MODEL = 'Авто не выбрано';
  const NEUTRAL_VEHICLE_PLATE = 'номер не выбран';
  const vehicleModel    = pickStr(activeVehicle?.model)
    || (useLegacy ? legacyVehicleModel
      : (noActiveWithGarage ? NEUTRAL_VEHICLE_MODEL : ''));
  const rawVehicleColor = pickStr(activeVehicle?.color)
    || (useLegacy ? pickStr(u.vehicleColor) : '');
  const vehiclePlate    = activeVehicle
    ? maskDriverPlate(activeVehicle.plate)
    : (useLegacy ? maskDriverPlate(u.vehiclePlate)
      : (noActiveWithGarage ? NEUTRAL_VEHICLE_PLATE : ''));
  // Nothing usable on the profile → let the caller keep the demo fallback.
  // Use the RAW vehicleColor (pre-fallback) so an entirely empty profile
  // still returns null and does not synthesise a "цвет не указан"-only ride.
  if (!rawName && !vehicleModel && !vehiclePlate && !rawVehicleColor) return null;
  const name = rawName || 'Водитель';
  // Codex P2 — Persist non-falsy neutral placeholders for the two
  // optional profile fields so the passenger surfaces' `|| '4,92'` /
  // `|| 'серый'` fallback chains cannot replace a real driver's missing
  // value with the demo rating / colour. Numeric rating still formats in
  // the ru-RU locale ("4,95"); a provided colour ("белый") passes
  // through unchanged.
  const rating = (typeof u.rating === 'number' && Number.isFinite(u.rating))
    ? u.rating.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';
  const vehicleColor = rawVehicleColor || 'цвет не указан';
  return {
    // Codex P2 (initial review) — Only the fields the profile actually
    // owns are written here. shiftDuration is INTENTIONALLY absent:
    // profiles do not track shift duration, and including a placeholder
    // would either show "0ч" (wrong) or trigger active_ride.js's
    // "5ч 12м" fallback regardless. Replace-not-merge in
    // seedActiveRideFromAcceptedOrder ensures the buildDemoRide()
    // "5ч 12м" demo seed cannot leak through deepMerge.
    driver: {
      name,
      initials: name.charAt(0).toUpperCase(),
      rating,
    },
    vehicle: {
      model: vehicleModel,
      color: vehicleColor,
      plate: vehiclePlate,
    },
  };
}

export function seedActiveRideFromAcceptedOrder(order, options = {}) {
  const snapshot = buildRouteSnapshotFromOrder(order);
  if (!snapshot) return null;
  const acceptedSource = pickStr(options.acceptedSource) || 'canonical_accept';
  const ride = createDemoActiveRide({
    tripId: snapshot.tripId,
    role: 'driver',
    status: RIDE_STATUS.ACCEPTED,
    order: {
      offerPrice: snapshot.priceLabel,
      destinationDistance: snapshot.distanceLabel,
      destinationEta: snapshot.etaLabel,
    },
    route: {
      pickupLabel: snapshot.pickupLabel,
      dropoffLabel: snapshot.dropoffLabel,
      etaToDestination: snapshot.etaLabel,
    },
    ride: {
      price: snapshot.priceLabel,
    },
    // BD-RIDE-WAITING-01E — same explicit override as
    // ride_seed.js::buildPassengerRideSeed: a real (driver-accepted) Ride
    // must not inherit buildDemoRide()'s demo waiting snapshot.
    // remaining/paidStartsAt cannot be known this early (the ride hasn't
    // even reached WAITING_PASSENGER yet) — the real anchor is
    // ride.timestamps.arrivedAt, stamped later at that transition.
    waiting: {
      freeLimit: '3:00',
      remaining: null,
      paidStartsAt: null,
      paidRate: '8 ₽ за каждую минуту',
    },
    timestamps: {
      acceptedAt: snapshot.acceptedAt,
    },
  });
  // BD-ACTIVE-07 — Replace the demo passenger entirely. deepMerge in
  // createDemoActiveRide would otherwise keep stray demo fields
  // (rating, luggage, phoneMasked) from buildDemoRide().
  ride.passenger = buildAcceptedOrderPassenger(order);
  // BD-LIFE-06 (Codex P2 #1) — Same replace-not-merge pattern for the
  // driver+vehicle blocks so leftover demo fields (driver.shiftDuration,
  // driver.onlineLabel, …) baked into buildDemoRide() cannot leak through
  // deepMerge into a real driver's accepted ride. When no profile snapshot
  // is available the caller stays on the demo seed (unreachable in
  // practice — canAcceptOrder gates this behind isDriverLineReady).
  const driverSnap = buildAcceptedDriverSnapshot(user.get());
  if (driverSnap) {
    ride.driver  = driverSnap.driver;
    ride.vehicle = driverSnap.vehicle;
  }
  ride.orderId = order && typeof order.id === 'string' ? order.id : null;
  // BD-LIFE-06 (Codex P2 #2) — Source-of-accept marker. The caller passes
  // its own label so the marker stays accurate across the three call
  // sites of acceptCanonicalRideOrder: driver_map.js → 'driver_map',
  // feed.js → 'feed', post_detail.js → 'post_detail'. Defaults to a
  // neutral 'canonical_accept' if the caller did not specify. The
  // BD-LIFE-05 orchestrator does not consume this — it already returns
  // null for any ride with no responseId — but it makes the data path
  // legible for future analytics / debug filters.
  ride.acceptedSource = acceptedSource;
  saveActiveRide(ride);
  return { tripId: snapshot.tripId, ride };
}

// BD-RIDE-ORDER-UNIFY-01 PR3 — Canonical ride-order accept path used by
// Feed (and reused by DriverMap). Flips CREATED → ACCEPTED in the shared
// store and seeds an active ride with a stable trip id. Returns null if
// the order id is stale / already accepted so callers can fail safely.
//
// BD-LIFE-06 (Codex P2 #2) — `options.acceptedSource` threads the caller's
// surface name ('driver_map' / 'feed' / 'post_detail') onto the seeded
// active ride. Optional; falls back to 'canonical_accept' so callers that
// haven't been updated do not silently mislabel their accept path.
export function acceptCanonicalRideOrder(orderId, options = {}) {
  const accepted = acceptNearbyOrder(orderId);
  if (!accepted) return null;
  const seeded = seedActiveRideFromAcceptedOrder(accepted, options);
  if (!seeded) return null;
  return { tripId: seeded.tripId, order: accepted, ride: seeded.ride };
}
