// /server/test/vehicle-assignment-domain.test.mjs — hermetic (no DATABASE_URL gate),
// table-driven unit coverage for domain/vehicle-assignment.js's assignmentEntitledAt(t) —
// the ENTITLEMENT half of the frozen contract's assignmentUsableAt predicate
// (docs/driver-vehicle-assignment-authority-contract.md, "Assignment usability").
// BD-DRIVER-VEHICLE-ASSIGNMENT-AUTHORITY-01B. Runs everywhere; the PostgreSQL-computed
// counterpart (lockAssignmentForEntitlementCheck's `entitled_now`) is proven to agree with
// this pure function in test/vehicle-driver-assignment-authority.test.mjs (DB-gated).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assignmentEntitledAt } from '../src/domain/vehicle-assignment.js';

const T0 = new Date('2026-06-01T12:00:00.000Z');
const PAST = new Date('2026-05-01T00:00:00.000Z');
const FUTURE = new Date('2026-07-01T00:00:00.000Z');

function makeAssignment(overrides = {}) {
  return { status: 'ACTIVE', startsAt: PAST, endsAt: null, ...overrides };
}

// ── the positive case ───────────────────────────────────────────────────────
test('ACTIVE, started in the past, open-ended: entitled', () => {
  assert.equal(assignmentEntitledAt(makeAssignment(), T0), true);
});

test('ACTIVE, started in the past, ends in the future: entitled', () => {
  assert.equal(assignmentEntitledAt(makeAssignment({ endsAt: FUTURE }), T0), true);
});

// ── half-open window boundaries — [starts_at, ends_at) ──────────────────────
test('t exactly equal to starts_at is entitled (inclusive lower bound)', () => {
  assert.equal(assignmentEntitledAt(makeAssignment({ startsAt: T0 }), T0), true);
});

test('t one millisecond before starts_at is NOT entitled', () => {
  const startsAt = new Date(T0.getTime() + 1);
  assert.equal(assignmentEntitledAt(makeAssignment({ startsAt }), T0), false);
});

test('t exactly equal to ends_at is NOT entitled (exclusive upper bound)', () => {
  assert.equal(assignmentEntitledAt(makeAssignment({ endsAt: T0 }), T0), false);
});

test('t one millisecond before ends_at is entitled', () => {
  const endsAt = new Date(T0.getTime() + 1);
  assert.equal(assignmentEntitledAt(makeAssignment({ endsAt }), T0), true);
});

test('t past an elapsed ends_at is NOT entitled — fails closed immediately, no background job needed', () => {
  assert.equal(assignmentEntitledAt(makeAssignment({ endsAt: PAST }), T0), false);
});

test('a future starts_at is NOT entitled yet (scheduled grant, window not reached)', () => {
  assert.equal(assignmentEntitledAt(makeAssignment({ startsAt: FUTURE }), T0), false);
});

// ── terminal status always wins, regardless of an otherwise-valid window ───
for (const status of ['ENDED', 'REVOKED']) {
  test(`terminal status ${status} is NOT entitled even with an otherwise-valid open window`, () => {
    assert.equal(assignmentEntitledAt(makeAssignment({ status, endsAt: FUTURE }), T0), false);
  });
}

test('an unrecognized status string is NOT entitled (fails closed, not "anything but ENDED/REVOKED")', () => {
  assert.equal(assignmentEntitledAt(makeAssignment({ status: 'PENDING' }), T0), false);
});

// ── endsAt undefined and endsAt null are equivalent (both = open-ended) ────
test('endsAt undefined behaves identically to endsAt null (open-ended)', () => {
  const { endsAt, ...rest } = makeAssignment();
  assert.equal(assignmentEntitledAt(rest, T0), true);
});

// ── fail-closed on malformed input ──────────────────────────────────────────
test('a missing assignment (null/undefined) is NOT entitled', () => {
  assert.equal(assignmentEntitledAt(null, T0), false);
  assert.equal(assignmentEntitledAt(undefined, T0), false);
});

test('a non-Date / invalid t is NOT entitled', () => {
  assert.equal(assignmentEntitledAt(makeAssignment(), null), false);
  assert.equal(assignmentEntitledAt(makeAssignment(), undefined), false);
  assert.equal(assignmentEntitledAt(makeAssignment(), '2026-06-01T12:00:00.000Z'), false);
  assert.equal(assignmentEntitledAt(makeAssignment(), new Date(Number.NaN)), false);
});

test('a non-Date / invalid startsAt is NOT entitled', () => {
  assert.equal(assignmentEntitledAt(makeAssignment({ startsAt: '2026-05-01T00:00:00.000Z' }), T0), false);
  assert.equal(assignmentEntitledAt(makeAssignment({ startsAt: new Date(Number.NaN) }), T0), false);
  assert.equal(assignmentEntitledAt(makeAssignment({ startsAt: null }), T0), false);
});

test('a non-Date / invalid endsAt (when not null/undefined) is NOT entitled', () => {
  assert.equal(assignmentEntitledAt(makeAssignment({ endsAt: '2026-07-01T00:00:00.000Z' }), T0), false);
  assert.equal(assignmentEntitledAt(makeAssignment({ endsAt: new Date(Number.NaN) }), T0), false);
});
