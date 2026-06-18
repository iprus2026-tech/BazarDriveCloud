// BD-TEST-05 — node:test pins for the driver no-show cross-role contract (#595).
//
// The driver marks NO_SHOW from WAITING_PASSENGER; the passenger active-ride
// screen reads the same persisted tripId and renders a terminal card whose badge
// uses the canonical NO_SHOW label. These pins guard the two invariants that
// feature depends on: (1) the canonical label the passenger badge derives from,
// and (2) the NO_SHOW record surviving a cross-role read with its cancel
// metadata, frozen against any later non-terminal write.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  RIDE_STATUS,
  resolveRideStatusLabel,
  resolveRideStatusTone,
  saveActiveRide,
  findActiveRide,
  updateActiveRideStatus,
} from '../public/src/ride_state.js';

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

test('passenger NO_SHOW badge contract: canonical label is "Не пришёл", tone danger', () => {
  // active_ride_passenger.js renders the badge from resolveRideStatusLabel; if
  // this label changes, the passenger-facing badge text changes with it.
  assert.equal(resolveRideStatusLabel(RIDE_STATUS.NO_SHOW), 'Не пришёл');
  assert.equal(resolveRideStatusTone(RIDE_STATUS.NO_SHOW), 'danger');
});

test('NO_SHOW survives a cross-role read with cancel metadata, and stays frozen', () => {
  // Driver side: arrived → waiting → marks no-show with the canonical patch.
  saveActiveRide({ tripId: 't1', status: RIDE_STATUS.WAITING_PASSENGER });
  const marked = updateActiveRideStatus('t1', RIDE_STATUS.NO_SHOW, {
    cancel: { by: 'driver', reason: 'passenger_no_show' },
  });
  assert.equal(marked.status, RIDE_STATUS.NO_SHOW);
  assert.equal(marked.cancel.by, 'driver');
  assert.equal(marked.cancel.reason, 'passenger_no_show');
  assert.equal(typeof marked.timestamps.canceledAt, 'string');

  // Passenger side: opens the same tripId and reads the persisted terminal
  // record verbatim — the data the no-show terminal card renders against.
  const passengerView = findActiveRide('t1');
  assert.equal(passengerView.status, RIDE_STATUS.NO_SHOW);
  assert.equal(passengerView.cancel.by, 'driver');
  assert.equal(passengerView.cancel.reason, 'passenger_no_show');

  // Frozen: a stale tab cannot revert the no-show to a live status.
  const after = updateActiveRideStatus('t1', RIDE_STATUS.IN_PROGRESS);
  assert.equal(after.status, RIDE_STATUS.NO_SHOW);
});
