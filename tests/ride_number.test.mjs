// #1185 — one short ride number on every screen. shortRideNumber (#1118) is the single rule; this
// pins its numeric-id case and that no screen prints a raw trip id after «№» any more.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { shortRideNumber } from '../public/src/passenger_order_utils.js';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

test('an order id and its trip id give the same short number', () => {
  const orderId = 'order-927ae4b4-ba8c-460e-b463-79a0c52a9008';
  assert.equal(shortRideNumber(orderId), '2a9008');
  assert.equal(shortRideNumber(`trip_${orderId}`), '2a9008');
  assert.equal(shortRideNumber('trip_order-1729591234567'), '234567');
});

test('an id that is already a human number is shown whole', () => {
  assert.equal(shortRideNumber('48-321'), '48-321');
  assert.equal(shortRideNumber('trip_48-321'), '48-321');
  assert.equal(shortRideNumber('1729591234567'), '234567', 'a bare long number is still shortened');
  assert.equal(shortRideNumber('order-x'), 'x', 'a prefixed id is not a human number');
});

test('empty input gives no number', () => {
  assert.equal(shortRideNumber(''), '');
  assert.equal(shortRideNumber(null), '');
  assert.equal(shortRideNumber(undefined), '');
});

test('no screen prints a raw trip id after «№»', () => {
  const screens = {
    'active_ride_passenger.js': read('../public/src/screens/active_ride_passenger.js'),
    'trip_receipt.js': read('../public/src/screens/trip_receipt.js'),
    'trip_confirmation.js': read('../public/src/screens/trip_confirmation.js'),
    'profile.js': read('../public/src/screens/profile.js'),
  };
  for (const [name, src] of Object.entries(screens)) {
    assert.match(src, /shortRideNumber\(/, `${name} uses the shared rule`);
    assert.doesNotMatch(src, /№\s?\$\{escapeHtml\((?:String\()?(?:receipt\.)?tripId\)?\)\}/, `${name}: raw trip id after «№»`);
  }
  assert.match(screens['active_ride_passenger.js'], /const short = shortRideNumber\(tripId\);\s*return short \? `№ \$\{short\}` : TRIP_NUMBER_FALLBACK;/);
});
