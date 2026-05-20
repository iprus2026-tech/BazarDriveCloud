// BD-RIDE-UTIL-01 — Shared ride action helpers.
// Extracted from feed.js and post_detail.js so Feed and Post Details
// agree on driver-readiness, ride construction from a feed post, and
// the accept-order side effect. No UI here, no router, no DOM.

import {
  createDemoActiveRide,
  saveActiveRide,
  RIDE_STATUS,
} from './ride_state.js';

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
