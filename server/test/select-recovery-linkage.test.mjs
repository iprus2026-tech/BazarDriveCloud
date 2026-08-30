// /server/test/select-recovery-linkage.test.mjs — BD-RIDE-SELECT-RECOVERY-LINKAGE-INVARIANT-01A.
// Pure, table-driven unit coverage for domain/select-recovery-linkage.js. No database: every
// case is a synthetic plain-object bundle, so this runs everywhere (no DATABASE_URL gate).
// The DB/candidate-count/reprojection coverage that actually exercises the bundle queries and
// the two reinforced GET handlers lives in select-recovery-linkage-flow.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateRecoveryLinkage } from '../src/domain/select-recovery-linkage.js';

const ORDER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const DRIVER_ID = '11111111-2222-4333-8444-555555555555';
const PASSENGER_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const OTHER_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const T = '2026-08-30T12:00:00.000Z';

function makeOrder(overrides = {}) {
  return { id: ORDER_ID, legacy_id: 'order-1', passenger_id: PASSENGER_ID, status: 'ACCEPTED', ...overrides };
}
function makeOffer(overrides = {}) {
  return { order_id: ORDER_ID, driver_id: DRIVER_ID, status: 'accepted', ...overrides };
}
function makeAssignment(overrides = {}) {
  return { order_id: ORDER_ID, status: 'ACCEPTED', selected_driver_id: DRIVER_ID, ...overrides };
}
function makeRide(overrides = {}) {
  return {
    trip_id: 'trip_order-1',
    order_id: ORDER_ID,
    role: 'passenger',
    driver_user_id: DRIVER_ID,
    passenger_user_id: PASSENGER_ID,
    status: 'ACCEPTED',
    passenger_rating: null,
    driver_initials: null,
    route_eta_to_pickup: null,
    route_eta_to_destination: null,
    cancel_by: null,
    cancel_reason: null,
    accepted_at: T,
    approaching_at: null, arrived_at: null, started_at: null, completed_at: null, canceled_at: null,
    ...overrides,
  };
}
const OK_FACTS = Object.freeze({ pg_has_core_timestamps: true, pg_accepted_at_matches_order: true, pg_chronology_ok: true });

function check(overrides = {}) {
  return validateRecoveryLinkage({
    ride: 'ride' in overrides ? overrides.ride : makeRide(),
    order: 'order' in overrides ? overrides.order : makeOrder(),
    assignment: 'assignment' in overrides ? overrides.assignment : makeAssignment(),
    offers: 'offers' in overrides ? overrides.offers : [makeOffer()],
    facts: 'facts' in overrides ? overrides.facts : OK_FACTS,
  });
}

// Builds a ride with the exact non-null timestamp prefix a given status requires.
function rideForStatus(status, overrides = {}) {
  const base = makeRide({ status });
  switch (status) {
    case 'ACCEPTED':
    case 'DRIVER_EN_ROUTE':
      return { ...base, ...overrides };
    case 'DRIVER_APPROACHING_PICKUP':
      return { ...base, approaching_at: T, ...overrides };
    case 'WAITING_PASSENGER':
      return { ...base, approaching_at: T, arrived_at: T, ...overrides };
    case 'IN_PROGRESS':
      return { ...base, approaching_at: T, arrived_at: T, started_at: T, ...overrides };
    case 'COMPLETED':
      return { ...base, approaching_at: T, arrived_at: T, started_at: T, completed_at: T, ...overrides };
    case 'NO_SHOW':
      return {
        ...base, approaching_at: T, arrived_at: T,
        cancel_by: 'driver', cancel_reason: 'passenger_no_show', canceled_at: T, ...overrides,
      };
    default:
      throw new Error(`rideForStatus: unhandled status ${status}`);
  }
}

// ── coherent bundle — PASS, acceptedOffer returned ──────────────────────────
test('coherent bundle passes and returns the accepted offer', () => {
  const offer = makeOffer();
  const verdict = check({ offers: [offer] });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.reason, null);
  assert.equal(verdict.acceptedOffer, offer);
});

// ── UUID case canonicalization — PASS ───────────────────────────────────────
test('UUID case canonicalization: uppercase ids across ride/order/offer/assignment still pass', () => {
  const verdict = check({
    ride: makeRide({ order_id: ORDER_ID.toUpperCase(), driver_user_id: DRIVER_ID.toUpperCase(), passenger_user_id: PASSENGER_ID.toUpperCase() }),
    offers: [makeOffer({ order_id: ORDER_ID.toUpperCase(), driver_id: DRIVER_ID.toUpperCase() })],
    assignment: makeAssignment({ order_id: ORDER_ID.toUpperCase(), selected_driver_id: DRIVER_ID.toUpperCase() }),
  });
  assert.equal(verdict.ok, true);
});

// ── every recovery-eligible status, with its exact required timestamp prefix — PASS ─
for (const status of ['ACCEPTED', 'DRIVER_EN_ROUTE', 'DRIVER_APPROACHING_PICKUP', 'WAITING_PASSENGER', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW']) {
  test(`recovery-eligible status with correct lifecycle shape passes: ${status}`, () => {
    const verdict = check({ ride: rideForStatus(status) });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.reason, null);
  });
}

// ── CANCELED: any continuous pre-cancel prefix (1-4), never 5 — PASS for each length ─
const CANCELED_PREFIXES = [
  {},
  { approaching_at: T },
  { approaching_at: T, arrived_at: T },
  { approaching_at: T, arrived_at: T, started_at: T },
];
CANCELED_PREFIXES.forEach((prefix, i) => {
  test(`CANCELED with pre-cancel prefix length ${i + 1} passes`, () => {
    const ride = makeRide({ status: 'CANCELED', canceled_at: T, ...prefix });
    assert.equal(check({ ride }).ok, true);
  });
});

// ── mandatory linkage — every check individually broken, one at a time — FAIL ──────
test('order missing fails', () => {
  assert.deepEqual(check({ order: null }), { ok: false, reason: 'order_missing' });
});
for (const status of ['CREATED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED']) {
  test(`order.status !== literal 'ACCEPTED' fails: ${status}`, () => {
    assert.deepEqual(check({ order: makeOrder({ status }) }), { ok: false, reason: 'order_not_accepted' });
  });
}
test('ride missing fails', () => {
  assert.deepEqual(check({ ride: null }), { ok: false, reason: 'ride_missing' });
});
test('ride.order_id null despite a resolved order fails (the applicability-bypass fix)', () => {
  assert.deepEqual(check({ ride: makeRide({ order_id: null }) }), { ok: false, reason: 'ride_order_id_mismatch' });
});
test('ride.order_id pointing at a different order fails', () => {
  assert.deepEqual(check({ ride: makeRide({ order_id: OTHER_ID }) }), { ok: false, reason: 'ride_order_id_mismatch' });
});
test('noncanonical trip_id fails even when ride.order_id correctly matches', () => {
  assert.deepEqual(check({ ride: makeRide({ trip_id: 'trip-noncanonical-xyz' }) }), { ok: false, reason: 'trip_linkage_mismatch' });
});
test('role other than passenger fails', () => {
  assert.deepEqual(check({ ride: makeRide({ role: 'driver' }) }), { ok: false, reason: 'role_mismatch' });
});
test('zero accepted offers fails', () => {
  assert.deepEqual(check({ offers: [makeOffer({ status: 'sent' })] }), { ok: false, reason: 'accepted_offer_count' });
});
test('two accepted offers fails', () => {
  assert.deepEqual(check({ offers: [makeOffer(), makeOffer({ driver_id: OTHER_ID })] }), { ok: false, reason: 'accepted_offer_count' });
});
test('accepted offer scoped to a different order fails', () => {
  assert.deepEqual(check({ offers: [makeOffer({ order_id: OTHER_ID })] }), { ok: false, reason: 'offer_order_mismatch' });
});
test('assignment missing fails', () => {
  assert.deepEqual(check({ assignment: null }), { ok: false, reason: 'assignment_missing' });
});
test('assignment not ACCEPTED fails', () => {
  assert.deepEqual(check({ assignment: makeAssignment({ status: 'CANCELED' }) }), { ok: false, reason: 'assignment_not_accepted' });
});
test('assignment scoped to a different order fails', () => {
  assert.deepEqual(check({ assignment: makeAssignment({ order_id: OTHER_ID }) }), { ok: false, reason: 'assignment_order_mismatch' });
});
test('assignment driver mismatched against the accepted offer fails', () => {
  assert.deepEqual(check({ assignment: makeAssignment({ selected_driver_id: OTHER_ID }) }), { ok: false, reason: 'assignment_driver_mismatch' });
});
test('ride.driver_user_id null fails (mandatory, never skipped)', () => {
  assert.deepEqual(check({ ride: makeRide({ driver_user_id: null }) }), { ok: false, reason: 'ride_driver_missing' });
});
test('ride.driver_user_id mismatched against the accepted offer fails', () => {
  assert.deepEqual(check({ ride: makeRide({ driver_user_id: OTHER_ID }) }), { ok: false, reason: 'ride_driver_mismatch' });
});
test('ride.passenger_user_id null fails (mandatory, never skipped)', () => {
  assert.deepEqual(check({ ride: makeRide({ passenger_user_id: null }) }), { ok: false, reason: 'ride_passenger_missing' });
});
test('ride.passenger_user_id mismatched against order.passenger_id fails', () => {
  assert.deepEqual(check({ ride: makeRide({ passenger_user_id: OTHER_ID }) }), { ok: false, reason: 'ride_passenger_mismatch' });
});

// ── every excluded pre-acceptance status — FAIL ─────────────────────────────
for (const status of ['NEW_ORDER', 'CONFIRMATION_PENDING', 'CONFIRMED', 'CHAT_STARTED']) {
  test(`pre-acceptance status is not recovery-eligible: ${status}`, () => {
    assert.deepEqual(check({ ride: makeRide({ status }) }), { ok: false, reason: 'ride_status_not_recovery_eligible' });
  });
}

// ── PostgreSQL-native facts — strict === true, never Date-derived — FAIL on anything else ──
const PG_FACT_REASONS = [
  ['pg_has_core_timestamps', 'missing_core_timestamps'],
  ['pg_accepted_at_matches_order', 'accepted_at_matches_order'],
  ['pg_chronology_ok', 'lifecycle_chronology_violation'],
];
for (const [fact, reason] of PG_FACT_REASONS) {
  for (const badValue of [false, null, undefined, 'true']) {
    test(`pg fact ${fact} = ${JSON.stringify(badValue)} fails: ${reason}`, () => {
      assert.deepEqual(check({ facts: { ...OK_FACTS, [fact]: badValue } }), { ok: false, reason });
    });
  }
}

// ── lifecycle timestamp SHAPE — gaps, wrong prefix length, incompatible terminals — FAIL ──
test('lifecycle: a gap (arrived_at set while approaching_at is null) fails', () => {
  const ride = makeRide({ status: 'WAITING_PASSENGER', approaching_at: null, arrived_at: T });
  assert.deepEqual(check({ ride }), { ok: false, reason: 'lifecycle_timestamp_incoherent' });
});
test('lifecycle: ACCEPTED with an extra approaching_at (prefix too long) fails', () => {
  const ride = makeRide({ status: 'ACCEPTED', approaching_at: T });
  assert.deepEqual(check({ ride }), { ok: false, reason: 'lifecycle_timestamp_incoherent' });
});
test('lifecycle: IN_PROGRESS missing started_at (prefix too short) fails', () => {
  const ride = rideForStatus('IN_PROGRESS', { started_at: null });
  assert.deepEqual(check({ ride }), { ok: false, reason: 'lifecycle_timestamp_incoherent' });
});
test('lifecycle: COMPLETED with canceled_at also set fails', () => {
  const ride = rideForStatus('COMPLETED', { canceled_at: T });
  assert.deepEqual(check({ ride }), { ok: false, reason: 'lifecycle_timestamp_incoherent' });
});
test('lifecycle: NO_SHOW with wrong prefix (only accepted_at, never reached arrived) fails', () => {
  const ride = makeRide({ status: 'NO_SHOW', cancel_by: 'driver', cancel_reason: 'passenger_no_show', canceled_at: T });
  assert.deepEqual(check({ ride }), { ok: false, reason: 'lifecycle_timestamp_incoherent' });
});
test('lifecycle: CANCELED with the full prefix through completed_at fails (a completed ride cannot be canceled)', () => {
  const ride = makeRide({ status: 'CANCELED', approaching_at: T, arrived_at: T, started_at: T, completed_at: T, canceled_at: T });
  assert.deepEqual(check({ ride }), { ok: false, reason: 'lifecycle_timestamp_incoherent' });
});
test('lifecycle: CANCELED without canceled_at fails', () => {
  const ride = makeRide({ status: 'CANCELED', canceled_at: null });
  assert.deepEqual(check({ ride }), { ok: false, reason: 'lifecycle_timestamp_incoherent' });
});

// ── cancel field coherence — FAIL ────────────────────────────────────────────
test('NO_SHOW with wrong cancel_by/reason fails', () => {
  const ride = rideForStatus('NO_SHOW', { cancel_by: 'passenger', cancel_reason: 'other' });
  assert.deepEqual(check({ ride }), { ok: false, reason: 'cancel_fields_incoherent' });
});
test('a non-NO_SHOW status with cancel_by populated fails', () => {
  const ride = rideForStatus('IN_PROGRESS', { cancel_by: 'driver' });
  assert.deepEqual(check({ ride }), { ok: false, reason: 'cancel_fields_incoherent' });
});

// ── always-null columns — each individually populated — FAIL ───────────────
for (const col of ['passenger_rating', 'driver_initials', 'route_eta_to_pickup', 'route_eta_to_destination']) {
  test(`always-null column populated fails: ${col}`, () => {
    assert.deepEqual(check({ ride: makeRide({ [col]: 'stale-value' }) }), { ok: false, reason: 'stale_column_populated' });
  });
}
