// BD-TEST-04 — node:test coverage for the ride-order spine (mock_api.js).
//
// The passenger-order store + its projection into the Feed (BD-RIDE-ORDER-UNIFY-01),
// the read-side that Phase 3 dispatch (BD-DOCS-034) and Phase 4 (BD-DOCS-035) build
// on. The ride-order store reads/writes localStorage with a `typeof undefined`
// guard (no in-memory fallback), so an in-memory mock is installed; the pure
// projection/merge helpers need no storage.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Install before importing — the module reads localStorage only inside functions,
// but install up front so every storage path sees the mock.
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

const {
  createRideOrder,
  listNearbyOrders,
  acceptNearbyOrder,
  clearRideOrdersStore,
  rideOrderToFeedPost,
  listRideOrdersAsFeedPosts,
  mergeFeedAndRideOrderPosts,
} = await import('../public/src/mock_api.js');

const RIDE_ORDERS_KEY = 'bazardrive.ride_orders.v1';
function seedOrders(orders) {
  globalThis.localStorage.setItem(RIDE_ORDERS_KEY, JSON.stringify(orders));
}

beforeEach(() => { globalThis.localStorage.clear(); });

// ── createRideOrder / listNearbyOrders / acceptNearbyOrder ────────────────────

test('createRideOrder: produces a CREATED order and lists it as nearby', () => {
  const order = createRideOrder({ pickup: { label: 'A' }, dropoff: { label: 'B' } });
  assert.equal(order.status, 'CREATED');
  assert.ok(order.id.startsWith('order-'));
  const nearby = listNearbyOrders();
  assert.equal(nearby.length, 1);
  assert.equal(nearby[0].id, order.id);
});

test('createRideOrder: normalizes type/source and coerces numeric fields', () => {
  const o = createRideOrder({
    type: 'weird', source: 'weird',
    distanceKm: 'abc', durationMin: '12', estimatedPrice: '500',
  });
  assert.equal(o.type, 'passenger_request');   // default
  assert.equal(o.source, 'map');               // default
  assert.equal(o.distanceKm, 0);               // unparseable → 0
  assert.equal(o.durationMin, 12);
  assert.equal(o.estimatedPrice, 500);
  assert.equal(o.comment, '');

  const ride = createRideOrder({ type: 'ride_order', source: 'feed' });
  assert.equal(ride.type, 'ride_order');
  assert.equal(ride.source, 'feed');
});

test('acceptNearbyOrder: CREATED → ACCEPTED, drops from nearby, idempotent/null guards', () => {
  const order = createRideOrder({ pickup: { label: 'A' }, dropoff: { label: 'B' } });
  const accepted = acceptNearbyOrder(order.id);
  assert.equal(accepted.status, 'ACCEPTED');
  assert.equal(typeof accepted.acceptedAt, 'string');
  assert.equal(listNearbyOrders().length, 0, 'accepted order drops out of nearby');
  // already non-CREATED → null; unknown / non-string → null.
  assert.equal(acceptNearbyOrder(order.id), null);
  assert.equal(acceptNearbyOrder('order-ghost'), null);
  assert.equal(acceptNearbyOrder(123), null);
  assert.equal(acceptNearbyOrder(''), null);
});

test('listNearbyOrders: only CREATED orders, capped at 20', () => {
  const many = [];
  for (let i = 0; i < 25; i++) many.push({ id: `order-${i}`, status: 'CREATED' });
  many.push({ id: 'order-acc', status: 'ACCEPTED' });
  seedOrders(many);
  const nearby = listNearbyOrders();
  assert.equal(nearby.length, 20, 'capped at 20');
  assert.ok(nearby.every((o) => o.status === 'CREATED'));
});

// ── rideOrderToFeedPost (pure projection) ─────────────────────────────────────

test('rideOrderToFeedPost: projects a CREATED order into a canonical feed post', () => {
  const post = rideOrderToFeedPost({
    id: 'order-x', status: 'CREATED', source: 'feed',
    pickup: { label: 'Home' }, dropoff: { label: 'Work' },
    comment: '  hi  ', createdAt: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(post.id, 'order-x');
  assert.equal(post.orderId, 'order-x');
  assert.equal(post.canonical, 'ride_order');
  assert.equal(post.type, 'trip');
  assert.equal(post.passenger, true);
  assert.equal(post.source, 'feed');
  assert.equal(post.rideOrderStatus, 'CREATED');
  assert.equal(post.createdByCurrentUser, true);
  assert.equal(post.body, 'hi');               // comment trimmed
  assert.equal(typeof post.from, 'string');
  assert.equal(typeof post.to, 'string');
});

test('rideOrderToFeedPost: returns null for non-CREATED / malformed / id-less orders', () => {
  assert.equal(rideOrderToFeedPost({ id: 'o', status: 'ACCEPTED' }), null);
  assert.equal(rideOrderToFeedPost({ status: 'CREATED' }), null); // no id
  assert.equal(rideOrderToFeedPost(null), null);
  assert.equal(rideOrderToFeedPost('nope'), null);
});

test('listRideOrdersAsFeedPosts: projects only CREATED, newest-first by createdAt', () => {
  seedOrders([
    { id: 'order-A', status: 'CREATED', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'order-B', status: 'ACCEPTED', createdAt: '2026-01-03T00:00:00.000Z' },
    { id: 'order-C', status: 'CREATED', createdAt: '2026-01-02T00:00:00.000Z' },
  ]);
  const posts = listRideOrdersAsFeedPosts();
  assert.deepEqual(posts.map((p) => p.id), ['order-C', 'order-A']);
  assert.ok(posts.every((p) => p.canonical === 'ride_order'));
});

// ── mergeFeedAndRideOrderPosts (pure) ─────────────────────────────────────────

test('mergeFeedAndRideOrderPosts: dedupes rides, prepends them, drops colliding feed', () => {
  const rides = [{ id: 'r1' }, { id: 'r1' }, { id: 'r2' }];
  const feed = [{ id: 'f1' }, { id: 'r1' }, { orderId: 'r2' }];
  const merged = mergeFeedAndRideOrderPosts(feed, rides);
  // r1 deduped; ride posts come first; feed items colliding by id (r1) or
  // orderId (r2) removed; only f1 survives from the feed.
  assert.deepEqual(merged.map((p) => p.id ?? p.orderId), ['r1', 'r2', 'f1']);
});

test('mergeFeedAndRideOrderPosts: empty rides returns a feed copy; non-arrays tolerated', () => {
  const feed = [{ id: 'f1' }];
  const copy = mergeFeedAndRideOrderPosts(feed, []);
  assert.deepEqual(copy, feed);
  assert.notEqual(copy, feed, 'returns a copy, not the same reference');
  assert.deepEqual(mergeFeedAndRideOrderPosts(null, null), []);
  assert.deepEqual(mergeFeedAndRideOrderPosts('x', undefined), []);
});
