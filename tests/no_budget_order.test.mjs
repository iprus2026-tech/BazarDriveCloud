// #1185 — a «Попутчик» request published with no budget. It is a ride order, not a feed post:
// /responses must not show the demo request's 950 ₽ for it, and «Мои публикации» must list it.
// Runs the real modules over an in-memory localStorage.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

const api = await import('../public/src/mock_api.js');
const { requestFromOrder } = await import('../public/src/screens/responses.js');

const ME = { name: 'Тест', authorId: api.LOCAL_USER_ID, isCurrentUser: true };
// A local order id is `order-<ms timestamp>`: publish at most one order per millisecond.
const tick = () => new Promise((resolve) => setTimeout(resolve, 3));
const publish = async (extra = {}) => { await tick(); return api.createRideOrder({
  type: 'passenger_request',
  source: 'feed',
  pickup: { id: null, label: 'Ленина 1' },
  dropoff: { id: null, label: 'Аэропорт' },
  scheduledMode: 'later',
  scheduledLabel: 'Сегодня 18:00',
  passenger: ME,
  ...extra,
}); };

beforeEach(() => { store.clear(); });

test('an order with no budget shows «По договорённости» on /responses, never the demo 950 ₽', async () => {
  const order = await publish({ estimatedPrice: 0, estimatedPriceLabel: '' });
  const request = requestFromOrder(order, order.id);
  assert.equal(request.price, 'По договорённости');
  assert.equal(request.numericPrice, 0);
  assert.equal(request.isFallback, false);
  assert.equal(request.pickupLabel, 'Ленина 1');
  assert.ok(!JSON.stringify(request).includes('950'), 'no demo price anywhere in the request');
});

test('an order with a budget keeps its own price', async () => {
  const order = await publish({ estimatedPrice: 1500, estimatedPriceLabel: '1 500' });
  const request = requestFromOrder(order, order.id);
  assert.equal(request.price, '1 500 ₽');
  assert.equal(request.numericPrice, 1500);
});

test('«Мои публикации» lists the own open order, with or without a budget', async () => {
  assert.deepEqual(api.listMyPublicationsSync().filter((p) => p.canonical === 'ride_order'), []);
  const bare = await publish({ estimatedPrice: 0, estimatedPriceLabel: '' });
  const priced = await publish({ estimatedPrice: 1500, estimatedPriceLabel: '1 500' });
  const mine = api.listMyPublicationsSync().filter((p) => p.canonical === 'ride_order');
  assert.deepEqual(mine.map((p) => p.id).sort(), [bare.id, priced.id].sort());
  const byId = new Map(mine.map((p) => [p.id, p]));
  assert.equal(byId.get(bare.id).price, null, 'no price line for the order without a budget');
  assert.equal(byId.get(priced.id).price, '1 500 ₽');
  assert.equal(byId.get(bare.id).type, 'trip');
  assert.equal(byId.get(bare.id).passenger, true, 'labelled «Попутчик» by the profile card');
});

test('«Мои публикации» leaves out other people\'s orders, a driver test order and a closed order', async () => {
  await publish({ passenger: { name: 'Анна', authorId: 'user_other', isCurrentUser: false } });
  await publish({ local: true, createdByRole: 'driver', passenger: { name: 'Тестовый пассажир' } });
  const own = await publish();
  const before = api.listMyPublicationsSync().filter((p) => p.canonical === 'ride_order');
  assert.deepEqual(before.map((p) => p.id), [own.id]);
  api.acceptOrder(own.id);
  const after = api.listMyPublicationsSync().filter((p) => p.canonical === 'ride_order');
  assert.deepEqual(after, [], 'an accepted order is no longer an open publication');
});

test('the feed posts stay in the list and an id is never listed twice', async () => {
  const own = await publish();
  const all = api.listMyPublicationsSync();
  assert.equal(new Set(all.map((p) => p.id)).size, all.length);
  for (const post of api.listMyPostsSync()) {
    assert.ok(all.some((p) => p.id === post.id), `feed post ${post.id} is kept`);
  }
  assert.ok(all.some((p) => p.id === own.id));
});
