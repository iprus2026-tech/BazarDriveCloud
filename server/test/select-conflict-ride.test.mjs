// /server/test/select-conflict-ride.test.mjs — BD-RIDE-SELECT-CONFLICT-RIDE-INVARIANT-01A.
// Pure, table-driven unit coverage for domain/select-conflict-ride.js. No database: every
// case is a synthetic plain-object "locked row" against a synthetic seed, so this runs
// everywhere (no DATABASE_URL gate). The DB/concurrency coverage that actually exercises
// bootstrapRide()'s ON CONFLICT path lives in select-flow.test.mjs.
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
// (null) value and internally-chronological core timestamps all pinned to BASE_NOW —
// mirroring what a single bootstrapRide() INSERT statement would have persisted (Postgres
// now() is constant within one statement/transaction).
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
    // core timestamps.
    created_at: BASE_NOW,
    accepted_at: BASE_NOW,
    updated_at: BASE_NOW,
    ...overrides,
  };
}

function check(ride, seed, expectedAcceptedAt = BASE_NOW) {
  return validateConflictRideInvariant({ ride, seed, expectedAcceptedAt });
}

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

// ── missing/invalid core timestamps — FAIL ─────────────────────────────────
for (const column of ['created_at', 'accepted_at', 'updated_at']) {
  test(`missing core timestamp fails: ${column}`, () => {
    const seed = makeSeed();
    const ride = makeCoherentRow(seed, { [column]: null });
    assert.deepEqual(check(ride, seed), { ok: false, reason: column });
  });
  test(`invalid (unparsable) core timestamp fails: ${column}`, () => {
    const seed = makeSeed();
    const ride = makeCoherentRow(seed, { [column]: 'not-a-date' });
    assert.deepEqual(check(ride, seed), { ok: false, reason: column });
  });
}

// ── both non-chronological boundaries — FAIL ───────────────────────────────
test('non-chronological: created_at after accepted_at fails', () => {
  const seed = makeSeed();
  const later = new Date(BASE_NOW.getTime() + 1000);
  const ride = makeCoherentRow(seed, { created_at: later, accepted_at: BASE_NOW, updated_at: later });
  assert.deepEqual(check(ride, seed, BASE_NOW), { ok: false, reason: 'created_at<=accepted_at' });
});

test('non-chronological: accepted_at after updated_at fails', () => {
  const seed = makeSeed();
  const later = new Date(BASE_NOW.getTime() + 1000);
  const ride = makeCoherentRow(seed, { accepted_at: later, updated_at: BASE_NOW });
  assert.deepEqual(check(ride, seed, later), { ok: false, reason: 'accepted_at<=updated_at' });
});

// ── internally chronological, but accepted_at != current updatedOrder.accepted_at — FAIL ──
test('internally chronological but stale accepted_at (does not match the current select) fails', () => {
  const seed = makeSeed();
  const ride = makeCoherentRow(seed); // fully chronological: created_at = accepted_at = updated_at = BASE_NOW
  const currentTxInstant = new Date(BASE_NOW.getTime() + 5000); // a later, DIFFERENT transaction's now()
  assert.deepEqual(check(ride, seed, currentTxInstant), { ok: false, reason: 'accepted_at_matches_order' });
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

// ── ISO-string timestamps (a live pg row can return either a Date or, depending on
// type-parsing config, a string) must be accepted identically to Date objects. ──
test('ISO-string core timestamps are accepted the same as Date instances', () => {
  const seed = makeSeed();
  const ride = makeCoherentRow(seed, {
    created_at: BASE_NOW.toISOString(),
    accepted_at: BASE_NOW.toISOString(),
    updated_at: BASE_NOW.toISOString(),
  });
  assert.deepEqual(check(ride, seed, BASE_NOW.toISOString()), { ok: true, reason: null });
});
