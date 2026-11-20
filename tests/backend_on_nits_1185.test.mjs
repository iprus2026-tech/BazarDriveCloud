// #1185 — three backend-ON items:
//   · the driver profile read «0 поездок» after a completed ride (the count was local-only);
//   · «Создать тестовый заказ» was offered to a driver on a real backend;
//   · logout was labelled «Завершить локальную сессию» although it revokes the server session.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const { countDriverHistoryTrips } = await import('../public/src/mock_api.js');

const NOW = Date.parse('2026-11-20T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();
const entry = (role, tripId, completedAt) => ({ role, tripId, completedAt });

test('the driver trip counts are the rides the viewer drove, from the server history', () => {
  const history = [
    entry('driver', 't1', daysAgo(0)),
    entry('driver', 't2', daysAgo(6)),
    entry('driver', 't3', daysAgo(8)),
    entry('driver', 't4', daysAgo(40)),
    entry('passenger', 't5', daysAgo(1)),
  ];
  assert.deepEqual(countDriverHistoryTrips(history, NOW), { total: 4, thisWeek: 2 });
});

test('a ride taken as a passenger is not a driven trip', () => {
  assert.deepEqual(countDriverHistoryTrips([entry('passenger', 't1', daysAgo(0))], NOW), { total: 0, thisWeek: 0 });
});

test('a row with no completion time counts in the total but not in the week', () => {
  assert.deepEqual(countDriverHistoryTrips([entry('driver', 't1', null), entry('driver', 't2', 'not a date')], NOW),
    { total: 2, thisWeek: 0 });
});

test('an empty or malformed history is zero, never a throw', () => {
  for (const bad of [[], null, undefined, 'x', [null, undefined, 7]]) {
    assert.deepEqual(countDriverHistoryTrips(bad, NOW), { total: 0, thisWeek: 0 });
  }
});

test('the profile applies the server counts when the history read lands', () => {
  const src = read('../public/src/screens/profile.js');
  assert.match(src, /applyDriverTripCounts\(root, countDriverHistoryTrips\(all\)\);/);
  const fn = src.slice(src.indexOf('function applyDriverTripCounts('), src.indexOf('function statusCardHtml('));
  assert.match(fn, /\.pf2-hero__trips/);
  assert.match(fn, /\.pf2-stat-card\[data-stat="week-trips"\] \.pf2-stat-val/);
  assert.match(src, /<div class="pf2-stat-card" data-stat="week-trips">/);
});

test('the test order is not offered on a real backend', () => {
  const src = read('../public/src/screens/driver_map.js');
  const fn = src.slice(src.indexOf('function buildEmptyCard()'), src.indexOf('return card;', src.indexOf('function buildEmptyCard()')));
  assert.match(fn, /const testOrderCta = isBackendEnabled\(\) \? '' : `<button[^`]*data-action="create-order"[^`]*Создать тестовый заказ/);
  assert.equal(fn.match(/data-action="create-order"/g).length, 1, 'the button exists only behind the backend check');
});

test('the passenger logout row names what it does in each mode', () => {
  const src = read('../public/src/screens/profile.js');
  assert.match(src, /model\.backend \? 'Выйти из аккаунта на этом устройстве' : 'Завершить локальную сессию'/);
});
