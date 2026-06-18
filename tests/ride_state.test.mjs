// BD-TEST-01 — node:test coverage for the ride state machine.
//
// First behavioural (node:test) coverage in the repo, complementing the static
// smoke pins in scripts/check.mjs. Imports the real module
// (public/src/ride_state.js) and exercises its pure status contract plus the
// localStorage-backed terminal-status freeze (BD-ACTIVE-RIDE-TERM-01).
//
// ride_state.js touches `localStorage` only inside function bodies (never at
// module top level), so a minimal in-memory mock installed on globalThis is
// enough to drive the storage paths under Node — no browser, no DOM, no network.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  RIDE_STATUS,
  RIDE_STATUS_LABEL,
  RIDE_STATUS_TONE,
  resolveRideStatusLabel,
  resolveRideStatusTone,
  isValidRideStatus,
  getNextDriverStatus,
  saveActiveRide,
  findActiveRide,
  getActiveRide,
  updateActiveRideStatus,
  cancelActiveRide,
} from '../public/src/ride_state.js';

// ── in-memory localStorage mock ───────────────────────────────────────────────
function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
  };
}
globalThis.localStorage = makeLocalStorage();
beforeEach(() => { globalThis.localStorage.clear(); });

const ALL_STATUSES = Object.keys(RIDE_STATUS);
const TERMINAL = ['COMPLETED', 'CANCELED', 'NO_SHOW'];

// ── pure status contract (no storage) ─────────────────────────────────────────

test('RIDE_STATUS enum: each key maps to its own name string', () => {
  for (const key of ALL_STATUSES) {
    assert.equal(RIDE_STATUS[key], key, `RIDE_STATUS.${key} should equal "${key}"`);
  }
  // The lifecycle + terminal statuses the rest of the app depends on.
  for (const expected of [
    'NEW_ORDER', 'ACCEPTED', 'DRIVER_EN_ROUTE', 'DRIVER_APPROACHING_PICKUP',
    'WAITING_PASSENGER', 'IN_PROGRESS', 'COMPLETED', 'CANCELED', 'NO_SHOW',
  ]) {
    assert.ok(ALL_STATUSES.includes(expected), `RIDE_STATUS missing ${expected}`);
  }
});

test('every status has a label and a tone, and resolvers return non-empty strings', () => {
  for (const key of ALL_STATUSES) {
    assert.equal(typeof RIDE_STATUS_LABEL[key], 'string', `no label for ${key}`);
    assert.ok(RIDE_STATUS_LABEL[key].length > 0, `empty label for ${key}`);
    assert.equal(typeof RIDE_STATUS_TONE[key], 'string', `no tone for ${key}`);
    assert.equal(typeof resolveRideStatusLabel(key), 'string');
    assert.ok(resolveRideStatusLabel(key).length > 0);
    assert.equal(typeof resolveRideStatusTone(key), 'string');
  }
});

test('resolvers do not throw on unknown / non-string input', () => {
  for (const bad of ['NOPE', '', null, undefined, 123, {}]) {
    assert.equal(typeof resolveRideStatusLabel(bad), 'string');
    assert.equal(typeof resolveRideStatusTone(bad), 'string');
  }
});

test('isValidRideStatus: true for real statuses, false for garbage and prototype keys', () => {
  for (const key of ALL_STATUSES) {
    assert.equal(isValidRideStatus(key), true, `${key} should be valid`);
  }
  for (const bad of [
    '', 'NOPE', 'completed', null, undefined, 123, {}, [],
    // prototype-pollution safety: isValidRideStatus uses hasOwnProperty.
    '__proto__', 'hasOwnProperty', 'toString', 'constructor',
  ]) {
    assert.equal(isValidRideStatus(bad), false, `${String(bad)} should be invalid`);
  }
});

test('getNextDriverStatus: advances the lifecycle and self-loops terminals', () => {
  assert.equal(getNextDriverStatus(RIDE_STATUS.NEW_ORDER), RIDE_STATUS.ACCEPTED);
  assert.equal(getNextDriverStatus(RIDE_STATUS.ACCEPTED), RIDE_STATUS.DRIVER_EN_ROUTE);
  assert.equal(getNextDriverStatus(RIDE_STATUS.DRIVER_EN_ROUTE), RIDE_STATUS.DRIVER_APPROACHING_PICKUP);
  assert.equal(getNextDriverStatus(RIDE_STATUS.DRIVER_APPROACHING_PICKUP), RIDE_STATUS.WAITING_PASSENGER);
  assert.equal(getNextDriverStatus(RIDE_STATUS.WAITING_PASSENGER), RIDE_STATUS.IN_PROGRESS);
  assert.equal(getNextDriverStatus(RIDE_STATUS.IN_PROGRESS), RIDE_STATUS.COMPLETED);
  // terminals point at themselves; unknown input falls back to itself.
  for (const t of TERMINAL) {
    assert.equal(getNextDriverStatus(RIDE_STATUS[t]), RIDE_STATUS[t]);
  }
  assert.equal(getNextDriverStatus('GARBAGE'), 'GARBAGE');
});

// ── storage-backed invariants (with localStorage mock) ────────────────────────

test('saveActiveRide + find/getActiveRide round-trips by tripId', () => {
  const ride = { tripId: 't1', role: 'driver', status: RIDE_STATUS.ACCEPTED };
  saveActiveRide(ride);
  assert.equal(findActiveRide('t1').status, RIDE_STATUS.ACCEPTED);
  assert.equal(getActiveRide('t1').status, RIDE_STATUS.ACCEPTED);
  assert.equal(findActiveRide('missing'), null);
});

test('saveActiveRide rejects non-objects and rides without a tripId', () => {
  assert.equal(findActiveRide('t1'), null);
  saveActiveRide(null);
  saveActiveRide({ status: RIDE_STATUS.ACCEPTED }); // no tripId
  assert.equal(findActiveRide('t1'), null);
});

test('getActiveRide auto-creates a NEW_ORDER demo for an unknown tripId', () => {
  const ride = getActiveRide('fresh-trip');
  assert.equal(ride.tripId, 'fresh-trip');
  assert.equal(ride.status, RIDE_STATUS.NEW_ORDER);
});

test('terminal freeze: updateActiveRideStatus will not move a terminal ride', () => {
  for (const t of TERMINAL) {
    globalThis.localStorage.clear();
    saveActiveRide({ tripId: 't1', status: RIDE_STATUS[t] });
    const out = updateActiveRideStatus('t1', RIDE_STATUS.IN_PROGRESS, { patched: true });
    assert.equal(out.status, RIDE_STATUS[t], `${t} must stay frozen`);
    assert.equal(findActiveRide('t1').status, RIDE_STATUS[t]);
    assert.equal(out.patched, undefined, 'no patch merge onto a terminal ride');
  }
});

test('terminal freeze: saveActiveRide will not thaw a terminal record to a new status', () => {
  saveActiveRide({ tripId: 't1', status: RIDE_STATUS.COMPLETED });
  const out = saveActiveRide({ tripId: 't1', status: RIDE_STATUS.IN_PROGRESS });
  assert.equal(out.status, RIDE_STATUS.COMPLETED);
  assert.equal(findActiveRide('t1').status, RIDE_STATUS.COMPLETED);
});

test('updateActiveRideStatus: invalid status is a no-op', () => {
  saveActiveRide({ tripId: 't1', status: RIDE_STATUS.ACCEPTED });
  const out = updateActiveRideStatus('t1', 'GARBAGE');
  assert.equal(out.status, RIDE_STATUS.ACCEPTED);
});

test('updateActiveRideStatus: a terminal write on an unknown trip returns null (no auto-create)', () => {
  assert.equal(updateActiveRideStatus('ghost', RIDE_STATUS.CANCELED), null);
  assert.equal(findActiveRide('ghost'), null);
});

test('updateActiveRideStatus: advances a live non-terminal ride and stamps a timestamp', () => {
  saveActiveRide({ tripId: 't1', status: RIDE_STATUS.WAITING_PASSENGER });
  const out = updateActiveRideStatus('t1', RIDE_STATUS.IN_PROGRESS);
  assert.equal(out.status, RIDE_STATUS.IN_PROGRESS);
  assert.equal(typeof out.timestamps.startedAt, 'string');
});

test('cancelActiveRide: stamps CANCELED with the actor, is null on unknown, idempotent on terminal', () => {
  // unknown trip → null, never auto-creates.
  assert.equal(cancelActiveRide({ tripId: 'ghost', canceledBy: 'driver' }), null);
  // live ride → CANCELED with actor + reason.
  saveActiveRide({ tripId: 't1', status: RIDE_STATUS.IN_PROGRESS });
  const cancelled = cancelActiveRide({ tripId: 't1', canceledBy: 'passenger', reason: 'changed_mind' });
  assert.equal(cancelled.status, RIDE_STATUS.CANCELED);
  assert.equal(cancelled.cancel.by, 'passenger');
  assert.equal(cancelled.cancel.reason, 'changed_mind');
  assert.equal(typeof cancelled.timestamps.canceledAt, 'string');
  // idempotent: a second cancel returns the existing terminal record unchanged.
  const again = cancelActiveRide({ tripId: 't1', canceledBy: 'driver' });
  assert.equal(again.cancel.by, 'passenger');
  assert.equal(again.timestamps.canceledAt, cancelled.timestamps.canceledAt);
});

test('cancelActiveRide: missing / non-string tripId returns null', () => {
  for (const bad of [undefined, '', null, 123, {}]) {
    assert.equal(cancelActiveRide({ tripId: bad, canceledBy: 'driver' }), null);
  }
});
