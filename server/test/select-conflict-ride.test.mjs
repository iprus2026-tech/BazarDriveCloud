// /server/test/select-conflict-ride.test.mjs — BD-RIDE-SELECT-CONFLICT-RIDE-INVARIANT-01A,
// timestamp precision hardened by BD-RIDE-SELECT-CONFLICT-RIDE-PG-PRECISION-01B.
// Pure, table-driven unit coverage for domain/select-conflict-ride.js. No database: every
// case is a synthetic plain-object "locked row" against a synthetic seed, so this runs
// everywhere (no DATABASE_URL gate). The four pg_* fields mirror what
// rides.lockConflictRideForSelection computes inside PostgreSQL (see that function's header
// comment) — this file never re-derives equality/chronology from a JS Date; it only proves
// the validator obeys those pre-computed flags, strictly. The DB/concurrency coverage that
// actually exercises bootstrapRide()'s ON CONFLICT path (and the real Postgres precision
// behavior of the four flags themselves) lives in select-flow.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateConflictRideInvariant } from '../src/domain/select-conflict-ride.js';

const BASE_NOW = new Date('2026-08-30T12:00:00.000Z');

function makeSeed(overrides = {}) {
  return {
    tripId: 'trip_order-1',
    orderId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    status: 'DRIVER_EN_ROUTE',
    role: 'passenger',
    driverUserId: '11111111-2222-4333-8444-555555555555',
    passengerUserId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
    passengerName: 'Иван',
    passengerInitials: 'И',
    passengerPhoneMasked: '+7 *** *** 12 34',
    passengerNote: 'у подъезда',
    driverName: 'Пётр',
    driverCar: 'Toyota Camry',
    driverRating: '4,9',
    routePickupLabel: 'Дом',
    routeDropoffLabel: 'Центр',
    orderOfferPrice: '800 ₽',
    ridePrice: '800 ₽',
    ...overrides,
  };
}

// A row matching `seed` exactly, plus every serializer-only/lifecycle column at its fresh
// (null) value, internally-chronological raw core timestamps all pinned to BASE_NOW (present
// on a real `SELECT r.*` row, but no longer authoritative for equality/chronology — see
// below), and all four PostgreSQL-derived timestamp facts pinned `true` — mirroring what
// rides.lockConflictRideForSelection would return for a genuinely fresh, matching bootstrap.
function makeCoherentRow(seed, overrides = {}) {
  return {
    trip_id: seed.tripId,
    order_id: seed.orderId,
    status: seed.status,
    role: seed.role,
    driver_user_id: seed.driverUserId,
    passenger_user_id: seed.passengerUserId,
    passenger_name: seed.passengerName,
    passenger_initials: seed.passengerInitials,
    passenger_phone_masked: seed.passengerPhoneMasked,
    passenger_note: seed.passengerNote,
    driver_name: seed.driverName,
    driver_car: seed.driverCar,
    driver_rating: seed.driverRating,
    route_pickup_label: seed.routePickupLabel,
    route_dropoff_label: seed.routeDropoffLabel,
    order_offer_price: seed.orderOfferPrice,
    ride_price: seed.ridePrice,
    // serializer-only stale columns — bootstrapRide() never sets these.
    passenger_rating: null,
    driver_initials: null,
    route_eta_to_pickup: null,
    route_eta_to_destination: null,
    cancel_by: null,
    cancel_reason: null,
    // fresh lifecycle — a DRIVER_EN_ROUTE ride has not advanced.
    approaching_at: null,
    arrived_at: null,
    started_at: null,
    completed_at: null,
    canceled_at: null,
    // raw core timestamps — present on the row, but NOT read by the validator for
    // equality/chronology (see PG_TIMESTAMP_FACTS below); kept here only for fixture realism.
    created_at: BASE_NOW,
    accepted_at: BASE_NOW,
    updated_at: BASE_NOW,
    // PostgreSQL-derived authoritative boolean facts (lockConflictRideForSelection).
    pg_has_core_timestamps: true,
    pg_created_le_accepted: true,
    pg_accepted_le_updated: true,
    pg_accepted_at_matches_order: true,
    ...overrides,
  };
}

function check(ride, seed) {
  return validateConflictRideInvariant({ ride, seed });
}

// field -> failure reason, mirroring domain/select-conflict-ride.js's own mapping exactly.
const PG_TIMESTAMP_FACTS = [
  ['pg_has_core_timestamps', 'missing_core_timestamps'],
  ['pg_created_le_accepted', 'created_at<=accepted_at'],
  ['pg_accepted_le_updated', 'accepted_at<=updated_at'],
  ['pg_accepted_at_matches_order', 'accepted_at_matches_order'],
];

// ── coherent synthetic row — PASS ───────────────────────────────────────────
test('coherent synthetic conflict row passes', () => {
  const seed = makeSeed();
  const verdict = check(makeCoherentRow(seed), seed);
  assert.deepEqual(verdict, { ok: true, reason: null });
});

test('missing conflict row fails', () => {
  const seed = makeSeed();
  assert.deepEqual(check(null, seed), { ok: false, reason: 'missing' });
  assert.deepEqual(check(undefined, seed), { ok: false, reason: 'missing' });
});

// ── every linkage/seed mismatch, one at a time — FAIL ───────────────────────
const LINKAGE_MISMATCHES = [
  ['trip_id', 'trip_order-OTHER'],
  ['order_id', 'ffffffff-ffff-4fff-8fff-ffffffffffff'],
  ['status', 'ACCEPTED'],
  ['role', 'driver'],
  ['driver_user_id', 'ffffffff-ffff-4fff-8fff-ffffffffffff'],
  ['passenger_user_id', 'ffffffff-ffff-4fff-8fff-ffffffffffff'],
  ['passenger_name', 'Другой'],
  ['passenger_initials', 'Д'],
  ['passenger_phone_masked', '+7 000'],
  ['passenger_note', 'другое'],
  ['driver_name', 'Другой водитель'],
  ['driver_car', 'Lada'],
  ['driver_rating', '3,0'],
  ['route_pickup_label', 'Другое'],
  ['route_dropoff_label', 'Другое'],
  ['order_offer_price', '999 ₽'],
  ['ride_price', '999 ₽'],
];
for (const [column, badValue] of LINKAGE_MISMATCHES) {
  test(`linkage/seed mismatch fails: ${column}`, () => {
    const seed = makeSeed();
    const ride = makeCoherentRow(seed, { [column]: badValue });
    assert.deepEqual(check(ride, seed), { ok: false, reason: column });
  });
}

// A seed value the conflict row lacks entirely (nullable fields legitimately null on the
// seed side too) must still be an exact match, not a free pass.
test('nullable seed field mismatch fails: passenger_phone_masked null on row vs seed value', () => {
  const seed = makeSeed();
  const ride = makeCoherentRow(seed, { passenger_phone_masked: null });
  assert.deepEqual(check(ride, seed), { ok: false, reason: 'passenger_phone_masked' });
});

// ── UUID case canonicalization — PASS ───────────────────────────────────────
test('UUID case canonicalization: uppercase conflict-row UUIDs still pass', () => {
  const seed = makeSeed();
  const ride = makeCoherentRow(seed, {
    order_id: seed.orderId.toUpperCase(),
    driver_user_id: seed.driverUserId.toUpperCase(),
    passenger_user_id: seed.passengerUserId.toUpperCase(),
  });
  assert.deepEqual(check(ride, seed), { ok: true, reason: null });
});

test('UUID case canonicalization does not mask a genuine UUID mismatch', () => {
  const seed = makeSeed();
  const ride = makeCoherentRow(seed, { driver_user_id: 'FFFFFFFF-FFFF-4FFF-8FFF-FFFFFFFFFFFF' });
  assert.deepEqual(check(ride, seed), { ok: false, reason: 'driver_user_id' });
});

// ── each of the six serializer-only stale columns, one at a time — FAIL ────
const STALE_ONLY_COLUMNS = [
  'passenger_rating',
  'driver_initials',
  'route_eta_to_pickup',
  'route_eta_to_destination',
  'cancel_by',
  'cancel_reason',
];
for (const column of STALE_ONLY_COLUMNS) {
  test(`serializer-only stale column present fails: ${column}`, () => {
    const seed = makeSeed();
    const ride = makeCoherentRow(seed, { [column]: 'stale-value' });
    assert.deepEqual(check(ride, seed), { ok: false, reason: column });
  });
}

// ── each post-accept lifecycle timestamp, one at a time — FAIL ─────────────
const LIFECYCLE_COLUMNS = ['approaching_at', 'arrived_at', 'started_at', 'completed_at', 'canceled_at'];
for (const column of LIFECYCLE_COLUMNS) {
  test(`post-accept lifecycle timestamp present fails: ${column}`, () => {
    const seed = makeSeed();
    const ride = makeCoherentRow(seed, { [column]: BASE_NOW });
    assert.deepEqual(check(ride, seed), { ok: false, reason: column });
  });
}

// ── each PostgreSQL-derived timestamp fact, individually `false` — FAIL ────────────────────
for (const [field, reason] of PG_TIMESTAMP_FACTS) {
  test(`PostgreSQL-derived timestamp fact false fails: ${field}`, () => {
    const seed = makeSeed();
    const ride = makeCoherentRow(seed, { [field]: false });
    assert.deepEqual(check(ride, seed), { ok: false, reason });
  });
}

// ── each PostgreSQL-derived timestamp fact, individually `null` — FAIL ─────────────────────
// A SQL `=`/`<=` comparison against a NULL timestamp yields NULL, not false — node-postgres
// surfaces that as JS `null`. The validator must fail this exactly like an explicit `false`.
for (const [field, reason] of PG_TIMESTAMP_FACTS) {
  test(`PostgreSQL-derived timestamp fact null fails: ${field}`, () => {
    const seed = makeSeed();
    const ride = makeCoherentRow(seed, { [field]: null });
    assert.deepEqual(check(ride, seed), { ok: false, reason });
  });
}

// ── each PostgreSQL-derived timestamp fact, entirely missing from the row — FAIL ───────────
for (const [field, reason] of PG_TIMESTAMP_FACTS) {
  test(`PostgreSQL-derived timestamp fact missing fails: ${field}`, () => {
    const seed = makeSeed();
    const ride = makeCoherentRow(seed);
    delete ride[field];
    assert.deepEqual(check(ride, seed), { ok: false, reason });
  });
}

// ── each PostgreSQL-derived timestamp fact, malformed (truthy but not exactly `true`) — FAIL
// Proves the check is strict `=== true`, not loose truthiness — a stringly-typed or numeric
// "true" from a malformed/legacy row must not slip through.
for (const [field, reason] of PG_TIMESTAMP_FACTS) {
  test(`PostgreSQL-derived timestamp fact malformed (non-boolean truthy) fails: ${field}`, () => {
    const seed = makeSeed();
    const ride = makeCoherentRow(seed, { [field]: 'true' });
    assert.deepEqual(check(ride, seed), { ok: false, reason });
  });
}

// ── identical millisecond-level JS Date values cannot override a PostgreSQL flag `false` ──
// The raw created_at/accepted_at/updated_at below are all pinned to the SAME BASE_NOW Date
// instance — by the OLD (pre-01B) JS Date.getTime()-based logic this would read as perfectly
// coherent and matching. The validator must still FAIL here, because it never looks at those
// raw fields for equality/chronology any more — only the PostgreSQL-derived flag governs.
for (const [field, reason] of PG_TIMESTAMP_FACTS) {
  test(`identical millisecond-level JS Date values cannot override a PostgreSQL flag false: ${field}`, () => {
    const seed = makeSeed();
    const ride = makeCoherentRow(seed, {
      created_at: BASE_NOW,
      accepted_at: BASE_NOW,
      updated_at: BASE_NOW,
      [field]: false,
    });
    assert.deepEqual(check(ride, seed), { ok: false, reason });
  });
}

// ── raw timestamp representation is irrelevant now — only the pg_* flags decide — PASS ─────
// A live pg row's raw created_at/accepted_at/updated_at could be a Date or (depending on
// type-parsing config) a string; since the validator no longer reads them for equality or
// chronology, either representation must PASS identically as long as the flags are true.
test('raw core timestamp representation (Date vs ISO string) does not affect the verdict', () => {
  const seed = makeSeed();
  const ride = makeCoherentRow(seed, {
    created_at: BASE_NOW.toISOString(),
    accepted_at: BASE_NOW.toISOString(),
    updated_at: BASE_NOW.toISOString(),
  });
  assert.deepEqual(check(ride, seed), { ok: true, reason: null });
});

// ── every non-DRIVER_EN_ROUTE status, including terminal — FAIL ────────────
const NON_DRIVER_EN_ROUTE_STATUSES = [
  'NEW_ORDER', 'CONFIRMATION_PENDING', 'CONFIRMED', 'CHAT_STARTED', 'ACCEPTED',
  'DRIVER_APPROACHING_PICKUP', 'WAITING_PASSENGER', 'IN_PROGRESS',
  'COMPLETED', 'CANCELED', 'NO_SHOW',
];
for (const status of NON_DRIVER_EN_ROUTE_STATUSES) {
  test(`non-DRIVER_EN_ROUTE status fails (including terminal): ${status}`, () => {
    const seed = makeSeed();
    const ride = makeCoherentRow(seed, { status });
    assert.deepEqual(check(ride, seed), { ok: false, reason: 'status' });
  });
}
