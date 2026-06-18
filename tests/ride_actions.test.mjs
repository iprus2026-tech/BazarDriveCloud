// BD-TEST-06 — node:test coverage for the accept → active-ride handoff (ride_actions.js).
//
// The seam that closes the spine: a CREATED ride order is accepted and seeded
// into an active ride at the canonical `trip_${order.id}` id (Phase 3 dispatch
// hands off into the ride state machine here). Pure gating predicates plus the
// storage-backed accept/seed paths; an in-memory localStorage mock drives the
// stores (ride orders + active ride + user).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  isPassengerMode,
  isDriverMode,
  canManageOwnOrder,
  canAcceptOrder,
  buildRouteSnapshotFromOrder,
  seedActiveRideFromAcceptedOrder,
  acceptCanonicalRideOrder,
} from '../public/src/ride_actions.js';
import { RIDE_STATUS, findActiveRide } from '../public/src/ride_state.js';
import { createRideOrder, listNearbyOrders, LOCAL_USER_ID } from '../public/src/mock_api.js';

function makeLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
  };
}
globalThis.localStorage = makeLocalStorage();
beforeEach(() => { globalThis.localStorage.clear(); });

// A driver that passes isDriverLineReady (role + profile + docs + waybill + medical).
const READY_DRIVER = {
  role: 'driver',
  phone: '+7 900 000-00-00',
  vehicleMake: 'Kia', vehicleModel: 'Rio', vehiclePlate: 'A123BC',
  documentsReady: true, waybillOpen: true, medicalCheckPassed: true,
};

// ── role predicates ───────────────────────────────────────────────────────────

test('isPassengerMode / isDriverMode: role-based, false on null', () => {
  assert.equal(isPassengerMode({ role: 'passenger' }), true);
  assert.equal(isPassengerMode({ role: 'driver' }), false);
  assert.equal(isDriverMode({ role: 'driver' }), true);
  assert.equal(isDriverMode({ role: 'passenger' }), false);
  assert.equal(isPassengerMode(null), false);
  assert.equal(isDriverMode(undefined), false);
});

// ── canManageOwnOrder ─────────────────────────────────────────────────────────

test('canManageOwnOrder: true for any own-order marker, false otherwise', () => {
  assert.equal(canManageOwnOrder({ createdByCurrentUser: true }), true);
  assert.equal(canManageOwnOrder({ isCurrentUser: true }), true);
  assert.equal(canManageOwnOrder({ authorId: LOCAL_USER_ID }), true);
  assert.equal(canManageOwnOrder({ passenger: { isCurrentUser: true } }), true);
  assert.equal(canManageOwnOrder({ passenger: { authorId: LOCAL_USER_ID } }), true);
  assert.equal(canManageOwnOrder({ authorId: 'someone-else' }), false);
  assert.equal(canManageOwnOrder(null), false);
});

// ── canAcceptOrder ────────────────────────────────────────────────────────────

test('canAcceptOrder: ready driver can accept a foreign trip / passenger request', () => {
  assert.equal(canAcceptOrder({ type: 'trip', passenger: true }, READY_DRIVER), true);
  assert.equal(canAcceptOrder({ canonical: 'ride_order', orderId: 'x', type: 'trip', passenger: true }, READY_DRIVER), true);
  assert.equal(canAcceptOrder({ type: 'passenger_request' }, READY_DRIVER), true);
});

test('canAcceptOrder: refused for passenger mode, not-line-ready, or own order', () => {
  const post = { type: 'trip', passenger: true };
  assert.equal(canAcceptOrder(post, { ...READY_DRIVER, role: 'passenger' }), false);
  assert.equal(canAcceptOrder(post, { ...READY_DRIVER, waybillOpen: false }), false);
  assert.equal(canAcceptOrder({ ...post, createdByCurrentUser: true }, READY_DRIVER), false);
  assert.equal(canAcceptOrder(null, READY_DRIVER), false);
  // a non-passenger "trip" post is not acceptable.
  assert.equal(canAcceptOrder({ type: 'trip', passenger: false }, READY_DRIVER), false);
});

// ── buildRouteSnapshotFromOrder (pure) ────────────────────────────────────────

test('buildRouteSnapshotFromOrder: canonical trip id + labels; null without id', () => {
  const snap = buildRouteSnapshotFromOrder({
    id: 'o1', pickup: { label: 'P' }, dropoff: { label: 'D' },
    distanceKm: 10, durationMin: 20, estimatedPrice: 500,
  });
  assert.equal(snap.tripId, 'trip_o1');
  assert.equal(snap.pickupLabel, 'P');
  assert.equal(snap.dropoffLabel, 'D');
  assert.equal(snap.distanceLabel, '10 км');
  assert.equal(snap.etaLabel, '20 мин');
  assert.ok(snap.priceLabel.includes('500'));
  // fallbacks + null guards
  const fb = buildRouteSnapshotFromOrder({ id: 'o2' });
  assert.equal(fb.pickupLabel, 'Точка подачи');
  assert.equal(fb.distanceLabel, '—');
  assert.equal(buildRouteSnapshotFromOrder({}), null);
  assert.equal(buildRouteSnapshotFromOrder(null), null);
});

// ── seedActiveRideFromAcceptedOrder (storage) ─────────────────────────────────

test('seedActiveRideFromAcceptedOrder: persists an ACCEPTED ride at trip_<id>', () => {
  const out = seedActiveRideFromAcceptedOrder({
    id: 'o1', pickup: { label: 'P' }, dropoff: { label: 'D' }, estimatedPrice: 500,
  });
  assert.equal(out.tripId, 'trip_o1');
  assert.equal(out.ride.status, RIDE_STATUS.ACCEPTED);
  assert.equal(out.ride.orderId, 'o1');
  // persisted into the active-ride store
  const stored = findActiveRide('trip_o1');
  assert.equal(stored.status, RIDE_STATUS.ACCEPTED);
  assert.equal(stored.route.pickupLabel, 'P');
  // null for an order with no id (no orphan record lands in the store)
  assert.equal(seedActiveRideFromAcceptedOrder({}), null);
});

// ── acceptCanonicalRideOrder (full handoff) ───────────────────────────────────

test('acceptCanonicalRideOrder: CREATED order → ACCEPTED + seeded active ride', () => {
  const order = createRideOrder({ pickup: { label: 'A' }, dropoff: { label: 'B' }, estimatedPrice: 700 });
  const result = acceptCanonicalRideOrder(order.id);
  assert.equal(result.tripId, `trip_${order.id}`);
  assert.equal(result.order.status, 'ACCEPTED');
  assert.equal(result.ride.status, RIDE_STATUS.ACCEPTED);
  // the order drops out of the nearby (CREATED) list
  assert.equal(listNearbyOrders().length, 0);
  // active ride persisted under the canonical trip id
  assert.equal(findActiveRide(`trip_${order.id}`).status, RIDE_STATUS.ACCEPTED);
});

test('acceptCanonicalRideOrder: null for stale / unknown / already-accepted ids', () => {
  assert.equal(acceptCanonicalRideOrder('order-ghost'), null);
  const order = createRideOrder({ pickup: { label: 'A' }, dropoff: { label: 'B' } });
  assert.ok(acceptCanonicalRideOrder(order.id));        // first accept works
  assert.equal(acceptCanonicalRideOrder(order.id), null); // second is stale → null
});
