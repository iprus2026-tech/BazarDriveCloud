// /server/test/ride-transition-authority.test.mjs — hermetic unit tests for the per-role ride
// status authority (BD-RIDE-AUTHORITY-01B-B; docs/ride-state-receipt-authority-contract.md §1).
// The expected outcomes are written out from the contract's transition table, independently of
// the module's own sets, and checked for EVERY (role, from, to) combination.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RIDE_STATUS, TERMINAL_RIDE_STATUSES } from '../src/domain/ride-status.js';
import { authorizeForwardTransition, authorizeCancel } from '../src/domain/ride-transition-authority.js';

const S = RIDE_STATUS;
const ALL = Object.values(S);
// Branch statuses keep their own rules in the route; this module decides every other target.
const FORWARD = ALL.filter((s) => s !== S.CANCELED && s !== S.NO_SHOW);

// Contract table: the single allowed forward step per role.
const ALLOWED_STEP = {
  driver: {
    [S.ACCEPTED]: S.DRIVER_EN_ROUTE,
    [S.DRIVER_EN_ROUTE]: S.DRIVER_APPROACHING_PICKUP,
    [S.DRIVER_APPROACHING_PICKUP]: S.WAITING_PASSENGER,
    [S.WAITING_PASSENGER]: S.IN_PROGRESS,
    [S.IN_PROGRESS]: S.COMPLETED,
  },
  passenger: {
    [S.WAITING_PASSENGER]: S.IN_PROGRESS,
  },
};
const OWNED = {
  driver: new Set([S.DRIVER_EN_ROUTE, S.DRIVER_APPROACHING_PICKUP, S.WAITING_PASSENGER, S.IN_PROGRESS, S.COMPLETED]),
  passenger: new Set([S.IN_PROGRESS]),
};
const OWNED_BY_ANYONE = new Set([...OWNED.driver, ...OWNED.passenger]);

function expected(role, from, to) {
  if (!OWNED_BY_ANYONE.has(to)) return { status: 409, code: 'RIDE_TRANSITION_NOT_ALLOWED' };
  if (!OWNED[role]?.has(to)) return { status: 403, code: 'RIDE_ROLE_FORBIDDEN' };
  if (to === from) return { ok: true, noop: true };
  if (TERMINAL_RIDE_STATUSES.has(from)) return { status: 409, code: 'RIDE_TERMINAL' };
  if (ALLOWED_STEP[role][from] !== to) return { status: 409, code: 'RIDE_TRANSITION_NOT_ALLOWED' };
  return { ok: true, noop: false };
}

test('authorizeForwardTransition matches the contract table for every (role, from, to)', () => {
  let checked = 0;
  for (const role of ['driver', 'passenger']) {
    for (const from of ALL) {
      for (const to of FORWARD) {
        const want = expected(role, from, to);
        const got = authorizeForwardTransition({ role, from, to });
        if (want.ok) {
          assert.deepEqual(got, { ok: true, noop: want.noop }, `${role}: ${from} -> ${to}`);
        } else {
          assert.equal(got.ok, false, `${role}: ${from} -> ${to} must be refused`);
          assert.equal(got.status, want.status, `${role}: ${from} -> ${to} status`);
          assert.equal(got.code, want.code, `${role}: ${from} -> ${to} code`);
          assert.equal(typeof got.error, 'string');
        }
        checked += 1;
      }
    }
  }
  assert.equal(checked, 2 * ALL.length * FORWARD.length);
});

test('allowed moves: the full driver chain and passenger boarding only', () => {
  const driverChain = [S.ACCEPTED, S.DRIVER_EN_ROUTE, S.DRIVER_APPROACHING_PICKUP, S.WAITING_PASSENGER, S.IN_PROGRESS, S.COMPLETED];
  for (let i = 0; i + 1 < driverChain.length; i += 1) {
    assert.deepEqual(authorizeForwardTransition({ role: 'driver', from: driverChain[i], to: driverChain[i + 1] }),
      { ok: true, noop: false }, `driver ${driverChain[i]} -> ${driverChain[i + 1]}`);
  }
  assert.deepEqual(authorizeForwardTransition({ role: 'passenger', from: S.WAITING_PASSENGER, to: S.IN_PROGRESS }),
    { ok: true, noop: false });
});

test('skips, backward moves and the other role are refused with the contract codes', () => {
  const cases = [
    ['passenger', S.DRIVER_EN_ROUTE, S.IN_PROGRESS, 409, 'RIDE_TRANSITION_NOT_ALLOWED'],
    ['passenger', S.DRIVER_EN_ROUTE, S.DRIVER_APPROACHING_PICKUP, 403, 'RIDE_ROLE_FORBIDDEN'],
    ['passenger', S.IN_PROGRESS, S.COMPLETED, 403, 'RIDE_ROLE_FORBIDDEN'],
    ['driver', S.DRIVER_EN_ROUTE, S.WAITING_PASSENGER, 409, 'RIDE_TRANSITION_NOT_ALLOWED'],
    ['driver', S.DRIVER_EN_ROUTE, S.COMPLETED, 409, 'RIDE_TRANSITION_NOT_ALLOWED'],
    ['driver', S.WAITING_PASSENGER, S.DRIVER_EN_ROUTE, 409, 'RIDE_TRANSITION_NOT_ALLOWED'],
    ['driver', S.IN_PROGRESS, S.WAITING_PASSENGER, 409, 'RIDE_TRANSITION_NOT_ALLOWED'],
    ['driver', S.DRIVER_EN_ROUTE, S.ACCEPTED, 409, 'RIDE_TRANSITION_NOT_ALLOWED'],
    ['driver', S.COMPLETED, S.IN_PROGRESS, 409, 'RIDE_TERMINAL'],
    ['passenger', S.NO_SHOW, S.IN_PROGRESS, 409, 'RIDE_TERMINAL'],
    [null, S.DRIVER_EN_ROUTE, S.DRIVER_APPROACHING_PICKUP, 403, 'RIDE_ROLE_FORBIDDEN'],
  ];
  for (const [role, from, to, status, code] of cases) {
    const got = authorizeForwardTransition({ role, from, to });
    assert.equal(got.ok, false, `${role}: ${from} -> ${to}`);
    assert.equal(got.status, status, `${role}: ${from} -> ${to}`);
    assert.equal(got.code, code, `${role}: ${from} -> ${to}`);
  }
});

test('same-status retries are no-ops for the owner only', () => {
  assert.deepEqual(authorizeForwardTransition({ role: 'driver', from: S.IN_PROGRESS, to: S.IN_PROGRESS }), { ok: true, noop: true });
  assert.deepEqual(authorizeForwardTransition({ role: 'passenger', from: S.IN_PROGRESS, to: S.IN_PROGRESS }), { ok: true, noop: true });
  assert.deepEqual(authorizeForwardTransition({ role: 'driver', from: S.COMPLETED, to: S.COMPLETED }), { ok: true, noop: true });
  const nonOwner = authorizeForwardTransition({ role: 'passenger', from: S.DRIVER_EN_ROUTE, to: S.DRIVER_EN_ROUTE });
  assert.equal(nonOwner.status, 403);
  assert.equal(nonOwner.code, 'RIDE_ROLE_FORBIDDEN');
});

test('authorizeCancel: a passenger cannot cancel IN_PROGRESS; everything else is left to the route', () => {
  const refused = authorizeCancel({ role: 'passenger', from: S.IN_PROGRESS });
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 409);
  assert.equal(refused.code, 'RIDE_TRANSITION_NOT_ALLOWED');
  for (const from of [S.ACCEPTED, S.DRIVER_EN_ROUTE, S.DRIVER_APPROACHING_PICKUP, S.WAITING_PASSENGER]) {
    assert.deepEqual(authorizeCancel({ role: 'passenger', from }), { ok: true }, `passenger cancel from ${from}`);
  }
  for (const from of [S.ACCEPTED, S.DRIVER_EN_ROUTE, S.DRIVER_APPROACHING_PICKUP, S.WAITING_PASSENGER, S.IN_PROGRESS]) {
    assert.deepEqual(authorizeCancel({ role: 'driver', from }), { ok: true }, `driver cancel from ${from}`);
  }
});
