// BD-RIDE-UTIL-01 — Shared ride action helpers.
// Extracted from feed.js and post_detail.js so Feed and Post Details
// agree on driver-readiness, ride construction from a feed post, and
// the accept-order side effect. No UI here, no router, no DOM.

import {
  createDemoActiveRide,
  saveActiveRide,
  RIDE_STATUS,
} from './ride_state.js';
import { acceptNearbyOrder } from './mock_api.js';

function initial(name) {
  return name ? String(name).trim().charAt(0).toUpperCase() : '?';
}

export function isDriverLineReady(u) {
  if (!u) return false;
  return !!(u.phone
    && u.vehicleMake && u.vehicleModel && u.vehiclePlate
    && u.documentsReady === true
    && u.waybillOpen === true
    && u.medicalCheckPassed === true);
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
  if (!u || !post) return false;
  if (u.role !== 'driver') return false;
  if (!isDriverLineReady(u)) return false;
  return post.type === 'trip' && post.passenger === true;
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

export function seedActiveRideFromAcceptedOrder(order) {
  const snapshot = buildRouteSnapshotFromOrder(order);
  if (!snapshot) return null;
  const ride = createDemoActiveRide({
    tripId: snapshot.tripId,
    role: 'driver',
    status: RIDE_STATUS.DRIVER_EN_ROUTE,
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
    timestamps: {
      acceptedAt: snapshot.acceptedAt,
    },
  });
  saveActiveRide(ride);
  return { tripId: snapshot.tripId, ride };
}

// BD-RIDE-ORDER-UNIFY-01 PR3 — Canonical ride-order accept path used by
// Feed (and reused by DriverMap). Flips CREATED → ACCEPTED in the shared
// store and seeds an active ride with a stable trip id. Returns null if
// the order id is stale / already accepted so callers can fail safely.
export function acceptCanonicalRideOrder(orderId) {
  const accepted = acceptNearbyOrder(orderId);
  if (!accepted) return null;
  const seeded = seedActiveRideFromAcceptedOrder(accepted);
  if (!seeded) return null;
  return { tripId: seeded.tripId, order: accepted, ride: seeded.ride };
}
