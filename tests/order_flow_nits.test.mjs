// #1185 — node:test coverage for two order-flow rules: the pickup and the dropoff must differ, and
// a «Позже» time must be ahead of now. Both helpers are pure.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isSamePoint } from '../public/src/screens/route_picker.js';
import { isPastSchedule } from '../public/src/screens/order_map_draft.js';

test('the same place for pickup and dropoff is recognised by label + address', () => {
  const work = { label: 'Работа', address: 'Пресненская наб., 12' };
  assert.equal(isSamePoint(work, { ...work }), true);
  assert.equal(isSamePoint(work, { label: ' работа ', address: 'Пресненская  наб., 12' }), true, 'case and spacing do not matter');
  assert.equal(isSamePoint(work, { label: 'Дом', address: 'Тверская улица, 1' }), false);
  assert.equal(isSamePoint(work, { label: 'Работа', address: 'Другой адрес' }), false, 'one label, two addresses');
});

test('missing or empty points are never "the same"', () => {
  assert.equal(isSamePoint(null, null), false);
  assert.equal(isSamePoint({ label: 'Дом' }, null), false);
  assert.equal(isSamePoint({}, {}), false);
  assert.equal(isSamePoint({ label: '', address: '' }, { label: '', address: '' }), false);
});

test('a «Позже» time before now is past; one ahead of now is not', () => {
  const now = new Date(2026, 10, 20, 12, 0, 0);
  assert.equal(isPastSchedule('2026-11-19', '18:00', now), true);
  assert.equal(isPastSchedule('2026-11-20', '11:59', now), true);
  assert.equal(isPastSchedule('2026-11-20', '12:01', now), false);
  assert.equal(isPastSchedule('2026-11-21', '08:00', now), false);
});

test('a malformed date or time is left to the empty-field rule', () => {
  const now = new Date(2026, 10, 20, 12, 0, 0);
  assert.equal(isPastSchedule('', '', now), false);
  assert.equal(isPastSchedule('не дата', '10:00', now), false);
});
