// #1183 — node:test coverage for the backend-ON role-parameter rule (role_gate.js).
//
// With a real session `?role=` on the ride, confirmation and profile screens must agree with the
// account's active role. roleCorrectedRoute is pure: (route, accountRole) -> corrected route | null.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { roleCorrectedRoute, ROLE_PARAM_ROUTES } from '../public/src/role_gate.js';

test('a link that asks for the other role is corrected to the account role', () => {
  assert.equal(roleCorrectedRoute('/active-ride?role=driver&tripId=trip_order-1', 'passenger'),
    '/active-ride?role=passenger&tripId=trip_order-1');
  assert.equal(roleCorrectedRoute('/active-ride?role=passenger&tripId=trip_order-1', 'driver'),
    '/active-ride?role=driver&tripId=trip_order-1');
  assert.equal(roleCorrectedRoute('/profile?role=driver&pane=payouts', 'passenger'), '/profile?role=passenger&pane=payouts');
  assert.equal(roleCorrectedRoute('/profile?role=passenger', 'driver'), '/profile?role=driver');
  assert.equal(roleCorrectedRoute('/trip-confirmation?tripId=t1&role=passenger&state=CONFIRMED', 'driver'),
    '/trip-confirmation?tripId=t1&role=driver&state=CONFIRMED');
});

test('the status hint belongs to the other role\'s flow and is dropped on a correction only', () => {
  assert.equal(roleCorrectedRoute('/active-ride?role=driver&tripId=t1&status=ACCEPTED', 'passenger'),
    '/active-ride?role=passenger&tripId=t1');
  assert.equal(roleCorrectedRoute('/active-ride?role=passenger&tripId=t1&status=DRIVER_EN_ROUTE', 'passenger'), null,
    'a matching link keeps everything');
});

test('a link that already agrees with the account is left alone (no redirect loop)', () => {
  for (const role of ['passenger', 'driver']) {
    for (const path of ROLE_PARAM_ROUTES) {
      const route = `${path}?role=${role}&tripId=t1`;
      assert.equal(roleCorrectedRoute(route, role), null, route);
      const other = role === 'driver' ? 'passenger' : 'driver';
      const corrected = roleCorrectedRoute(`${path}?role=${other}&tripId=t1`, role);
      assert.equal(roleCorrectedRoute(corrected, role), null, `the corrected route is stable: ${corrected}`);
    }
  }
});

test('an absent role is corrected only where the screen would default to the wrong variant', () => {
  // The ride screen and the profile already default from the account.
  for (const role of ['passenger', 'driver']) {
    assert.equal(roleCorrectedRoute('/active-ride', role), null);
    assert.equal(roleCorrectedRoute('/active-ride?tripId=t1', role), null);
    assert.equal(roleCorrectedRoute('/profile', role), null);
    assert.equal(roleCorrectedRoute('/profile?pane=payouts', role), null);
  }
  // The confirmation screen defaults to the passenger variant.
  assert.equal(roleCorrectedRoute('/trip-confirmation?tripId=t1', 'driver'), '/trip-confirmation?tripId=t1&role=driver');
  assert.equal(roleCorrectedRoute('/trip-confirmation', 'driver'), '/trip-confirmation?role=driver');
  assert.equal(roleCorrectedRoute('/trip-confirmation?tripId=t1', 'passenger'), null);
});

test('other routes, other roles and odd input are never touched', () => {
  for (const route of ['/feed', '/chat?tripId=t1&role=driver', '/receipt?tripId=t1&role=passenger',
    '/settings?role=driver', '/driver-map', '/responses?orderId=o1', '/active-ride-x?role=driver', '']) {
    assert.equal(roleCorrectedRoute(route, 'passenger'), null, route);
    assert.equal(roleCorrectedRoute(route, 'driver'), null, route);
  }
  for (const role of [null, undefined, '', 'guest', 'admin', 42]) {
    assert.equal(roleCorrectedRoute('/active-ride?role=driver&tripId=t1', role), null, String(role));
  }
  assert.equal(roleCorrectedRoute('/active-ride?role=admin', 'passenger'), null, 'an unknown role value is the screen\'s default');
  for (const route of [null, undefined, 42, {}]) assert.equal(roleCorrectedRoute(route, 'driver'), null);
});

test('/trip-confirmation: the other side\'s explicit state is dropped, with or without a role fix', () => {
  assert.equal(roleCorrectedRoute('/trip-confirmation?tripId=t1&role=driver&state=DRIVER_CONFIRMED', 'passenger'),
    '/trip-confirmation?tripId=t1&role=passenger');
  assert.equal(roleCorrectedRoute('/trip-confirmation?tripId=t1&role=passenger&state=DRIVER_CONFIRMED', 'passenger'),
    '/trip-confirmation?tripId=t1&role=passenger', 'a matching role does not excuse a foreign state');
  assert.equal(roleCorrectedRoute('/trip-confirmation?tripId=t1&state=DRIVER_WAITING', 'passenger'),
    '/trip-confirmation?tripId=t1');
  assert.equal(roleCorrectedRoute('/trip-confirmation?state=DRIVER_WAITING', 'passenger'), '/trip-confirmation');
  assert.equal(roleCorrectedRoute('/trip-confirmation?tripId=t1&role=driver&state=PASSENGER_CONFIRMED', 'driver'),
    '/trip-confirmation?tripId=t1&role=driver');
  assert.equal(roleCorrectedRoute('/trip-confirmation?tripId=t1&state=PASSENGER_PENDING', 'driver'),
    '/trip-confirmation?tripId=t1&role=driver');
  // Own-side and role-neutral states stay; the corrected route is stable (no loop).
  assert.equal(roleCorrectedRoute('/trip-confirmation?tripId=t1&role=passenger&state=PASSENGER_CONFIRMED', 'passenger'), null);
  assert.equal(roleCorrectedRoute('/trip-confirmation?tripId=t1&role=driver&state=EXPIRED', 'driver'), null);
  assert.equal(roleCorrectedRoute('/trip-confirmation?tripId=t1&role=driver&state=EXPIRED', 'passenger'),
    '/trip-confirmation?tripId=t1&role=passenger&state=EXPIRED');
  assert.equal(roleCorrectedRoute('/active-ride?role=passenger&state=DRIVER_CONFIRMED', 'passenger'), null,
    'state= means nothing on other routes');
});
