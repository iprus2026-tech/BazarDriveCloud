// #1185 — the demo feed mixed two markets: ruble fares around Москва next to a marketplace
// listing priced in ₸ with an Astana pickup. The demo feed is one city and one currency.

import { test } from 'node:test';
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

const { FEED_POSTS_V2 } = await import('../public/src/mock_api.js');

const textOf = (post) => [post.title, post.body, post.price, post.from, post.to, ...(post.tags || [])]
  .filter((v) => typeof v === 'string').join(' ');

test('every demo feed price is in rubles', () => {
  const priced = FEED_POSTS_V2.filter((p) => typeof p.price === 'string' && p.price.trim());
  assert.ok(priced.length >= 3, 'the seed has priced posts');
  for (const post of priced) {
    assert.match(post.price, /^\d[\d\s]*₽$/, `${post.id}: ${post.price}`);
  }
});

test('no demo feed post mentions another currency or a city of another market', () => {
  for (const post of FEED_POSTS_V2) {
    const text = textOf(post);
    assert.doesNotMatch(text, /₸|тенге|\$|€/i, `${post.id}: currency`);
    assert.doesNotMatch(text, /астан|алмат|шымкент|караганд|бишкек/i, `${post.id}: city`);
  }
});

test('the marketplace listing is still a complete demo card', () => {
  const listing = FEED_POSTS_V2.find((p) => p.id === 'mkt-1');
  assert.ok(listing);
  assert.equal(listing.type, 'marketplace');
  assert.ok(listing.title && listing.body && listing.author);
  assert.deepEqual(listing.tags, ['запчасти', 'москва']);
});
