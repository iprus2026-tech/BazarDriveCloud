// #1176 — node:test coverage for the driver's own-offer lookup (response_store.js).
//
// findOwnOfferForPost / ownOfferLabel answer "did I respond to this post from this device?" for
// the feed card, the post screen and the respond form. They read the keyed responses store by
// the exact resp_<postId> key and accept only an open, priced, matching offer.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)); },
  removeItem: (key) => { store.delete(key); },
};

const { findOwnOfferForPost, ownOfferLabel, RESPONSES_KEY } = await import('../public/src/response_store.js');

const seed = (map) => store.set(RESPONSES_KEY, JSON.stringify(map));
const offer = (overrides = {}) => ({ id: 'resp_trip-2', kind: 'passenger_response', requestId: 'trip-2',
  status: 'SENT', driverPrice: 1800, message: 'Буду вовремя', ...overrides });

test('own offer: the exact resp_<postId> entry, open and priced', () => {
  seed({ 'resp_trip-2': offer() });
  assert.equal(findOwnOfferForPost('trip-2').driverPrice, 1800);
  assert.equal(ownOfferLabel('trip-2'), 'Вы откликнулись · 1\u00a0800 ₽');
  assert.equal(findOwnOfferForPost('trip-3'), null, 'another post has no offer');
  assert.equal(ownOfferLabel('trip-3'), '');
});

test('own offer: nothing for an empty, malformed or foreign store', () => {
  for (const raw of [null, 'not json', '[]', 'null', '{}']) {
    if (raw === null) store.delete(RESPONSES_KEY); else store.set(RESPONSES_KEY, raw);
    assert.equal(findOwnOfferForPost('trip-2'), null);
  }
  for (const id of [undefined, null, '', '   ', {}]) assert.equal(findOwnOfferForPost(id), null);
});

test('own offer: a closed, unpriced, mismatched or wrong-kind entry is not an offer', () => {
  for (const bad of [
    offer({ status: 'WITHDRAWN' }),
    offer({ status: undefined }),
    offer({ driverPrice: 0 }),
    offer({ driverPrice: 'abc' }),
    offer({ driverPrice: null }),
    offer({ requestId: 'trip-9' }),
    offer({ kind: 'marketplace_message' }),
  ]) {
    seed({ 'resp_trip-2': bad });
    assert.equal(findOwnOfferForPost('trip-2'), null, JSON.stringify(bad));
    assert.equal(ownOfferLabel('trip-2'), '');
  }
});

test('own offer: a decimal price keeps its fraction in the label', () => {
  seed({ 'resp_order-x': offer({ id: 'resp_order-x', requestId: 'order-x', driverPrice: 763.5 }) });
  assert.match(ownOfferLabel('order-x'), /^Вы откликнулись · 763,5 ₽$/);
});
