// /server/test/driver-shift-authority.test.mjs — DB-gated coverage for
// BD-DRIVER-SHIFT-AUTHORITY-01B (migration 0006 + repositories/driver_shifts.js +
// repositories/vehicles.js + repositories/rides.js's findActiveRideForDriver +
// services/driver-shift-authority/index.js) against the frozen
// docs/driver-shift-authority-contract.md. SKIPPED without DATABASE_URL; runs in server-ci.
//
// Two isolation strategies, chosen per test the same way
// vehicle-driver-assignment-authority.test.mjs does:
//  - Most tests use beginTxn(t): one raw connection, BEGIN'd, ROLLED BACK in t.after. Its `db`
//    shim's `.tx(fn)` runs fn against the SAME ambient connection/transaction (not a nested
//    BEGIN) — this lets a single test call the real service functions (which internally call
//    db.tx(...)) while the whole scenario still rolls back cleanly as one unit, with zero
//    residue and no manual cleanup bookkeeping.
//  - The three genuine-concurrency tests need TWO REAL, independently-committing PostgreSQL
//    transactions racing each other — a single ambient transaction cannot exercise real
//    cross-transaction row locking, so those use either a real app.db (buildApp(), a real Pool
//    + the production db.tx) or two raw pg.Client connections with manual BEGIN/COMMIT
//    (mirroring the sibling file's own lockDriverAuthority concurrency test), with explicit
//    bottom-up cleanup in t.after (driver_shift -> driver_active_vehicle ->
//    vehicle_driver_assignments -> vehicles -> users — RESTRICT on every FK here means a
//    parent can't be deleted before its children).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

import { buildApp } from '../src/server.js';
import {
  createAssignment, lockAssignmentForEntitlementCheck, endAssignment, revokeAssignment,
} from '../src/repositories/vehicle_driver_assignments.js';
import {
  lockDriverAuthority, readSelection, setSelection, clearSelection,
} from '../src/repositories/driver_active_vehicle.js';
import { lockVehicleById } from '../src/repositories/vehicles.js';
import {
  findOpenShiftForDriver, findOpenShiftForVehicle, lockOpenShiftForDriver,
  insertOpenShift, closeShift, findShiftById, lockOpenShiftById,
} from '../src/repositories/driver_shifts.js';
import { findActiveRideForDriver } from '../src/repositories/rides.js';
import {
  openDriverShift, closeDriverShift, getOpenDriverShift, reconcileAssignmentUnusableShift,
  defaultResolveVehicleBlockState,
} from '../src/services/driver-shift-authority/index.js';

const DATABASE_URL = process.env.DATABASE_URL || '';
const SKIP = DATABASE_URL ? false : 'DATABASE_URL not set';

const HOUR = 3_600_000;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const APP_CONFIG = {
  nodeEnv: 'test', isProd: false, port: 0, host: '127.0.0.1', logLevel: 'silent',
  databaseUrl: DATABASE_URL, allowedOrigin: '', sessionSecret: '',
  otp: { ttlSeconds: 300, length: 4, maxAttempts: 5, devMode: true },
  session: { ttlSeconds: 0 },
  redisUrl: '', s3: { endpoint: '', bucket: '', accessKeyId: '', secretAccessKey: '' },
};

// Open a fresh connection, BEGIN, and register ROLLBACK + close on test completion. The `db`
// shim's `.tx(fn)` runs fn against the SAME ambient connection (a pass-through, not a nested
// BEGIN) — see file header.
async function beginTxn(t) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  await client.query('BEGIN');
  t.after(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  });
  const db = { query: (text, params) => client.query(text, params) };
  db.tx = (fn) => fn(db);
  return db;
}

async function insertUser(db) {
  const { rows } = await db.query(`INSERT INTO users DEFAULT VALUES RETURNING id`);
  return rows[0].id;
}

async function insertVehicle(db, ownerId, { model = 'Test Car', archived = false } = {}) {
  const { rows } = await db.query(
    `INSERT INTO vehicles (owner_user_id, model, archived) VALUES ($1, $2, $3) RETURNING id`,
    [ownerId, model, archived],
  );
  return rows[0].id;
}

// Terminal statuses carry their own NOT-NULL stamp CHECKs (rides_terminal_cancel_stamp /
// rides_completed_stamp, migration 0001) — stamped here so a raw minimal insert of a terminal
// ride satisfies them.
async function insertRide(db, { driverId, status, tripId = `trip_${randomUUID()}` }) {
  const completedAt = status === 'COMPLETED' ? 'now()' : 'NULL';
  const canceledAt = (status === 'CANCELED' || status === 'NO_SHOW') ? 'now()' : 'NULL';
  const { rows } = await db.query(
    `INSERT INTO rides (trip_id, status, driver_user_id, completed_at, canceled_at)
     VALUES ($1, $2, $3, ${completedAt}, ${canceledAt}) RETURNING *`,
    [tripId, status, driverId],
  );
  return rows[0];
}

function assertRejectsWithPgCode(promise, code, messageMatch) {
  return assert.rejects(promise, (err) => {
    assert.equal(err.code, code, `expected pg error code ${code}, got ${err.code}: ${err.message}`);
    if (messageMatch) assert.match(err.message, messageMatch);
    return true;
  });
}

// A full, ready-to-open scenario: owner + driver + vehicle + an ACTIVE, already-entitled
// assignment + a matching driver_active_vehicle selection. Every openDriverShift test starts
// from this baseline and mutates one thing.
async function seedUsableScenario(db, { archived = false } = {}) {
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner, { archived });
  const assignment = await createAssignment(db, {
    vehicleId, driverId: driver, assignedByUserId: owner,
    assignmentType: 'OWNER', startsAt: new Date(Date.now() - HOUR),
  });
  await setSelection(db, { driverId: driver, assignmentId: assignment.id });
  return { owner, driver, vehicleId, assignment };
}

const usable = { resolveVehicleBlockState: async () => 'UNBLOCKED' };

// ── 1. schema: additive composite key coexists with the existing 0005 key ──────────────────
test('0006: the new 3-column UNIQUE coexists with 0005\'s existing 2-column UNIQUE', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { rows } = await db.query(
    `SELECT conname, contype FROM pg_constraint pc JOIN pg_class c ON c.oid = pc.conrelid
      WHERE c.relname = 'vehicle_driver_assignments'
        AND conname IN ('vehicle_driver_assignments_id_driver_uq', 'vehicle_driver_assignments_id_driver_vehicle_uq')
      ORDER BY conname`,
  );
  assert.deepEqual(rows, [
    { conname: 'vehicle_driver_assignments_id_driver_uq', contype: 'u' },
    { conname: 'vehicle_driver_assignments_id_driver_vehicle_uq', contype: 'u' },
  ]);
});

// ── 2. composite FK: a 3-column tuple mismatch is unrepresentable ───────────────────────────
test('composite FK: a pinned tuple whose vehicle does not match the real assignment is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, assignment } = await seedUsableScenario(db);
  const wrongVehicle = await insertVehicle(db, driver, { model: 'Wrong Car' });
  assert.notEqual(wrongVehicle, vehicleId);
  await assertRejectsWithPgCode(
    db.query(
      `INSERT INTO driver_shift (driver_id, vehicle_id, assignment_id) VALUES ($1, $2, $3)`,
      [driver, wrongVehicle, assignment.id],
    ),
    '23503',
  );
});

test('composite FK: an assignment belonging to a DIFFERENT driver is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { vehicleId, assignment } = await seedUsableScenario(db);
  const otherDriver = await insertUser(db);
  await assertRejectsWithPgCode(
    db.query(
      `INSERT INTO driver_shift (driver_id, vehicle_id, assignment_id) VALUES ($1, $2, $3)`,
      [otherDriver, vehicleId, assignment.id],
    ),
    '23503',
  );
});

// ── 3. lifecycle CHECK shapes ────────────────────────────────────────────────────────────────
test('lifecycle CHECK: OPEN with a non-null closed_at is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, assignment } = await seedUsableScenario(db);
  await assertRejectsWithPgCode(
    db.query(
      `INSERT INTO driver_shift (driver_id, vehicle_id, assignment_id, status, closed_at) VALUES ($1, $2, $3, 'OPEN', now())`,
      [driver, vehicleId, assignment.id],
    ),
    '23514', /driver_shift_lifecycle_check/,
  );
});

test('lifecycle CHECK: OPEN with a non-null close_reason is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, assignment } = await seedUsableScenario(db);
  await assertRejectsWithPgCode(
    db.query(
      `INSERT INTO driver_shift (driver_id, vehicle_id, assignment_id, status, close_reason) VALUES ($1, $2, $3, 'OPEN', 'DRIVER_REQUESTED')`,
      [driver, vehicleId, assignment.id],
    ),
    '23514', /driver_shift_lifecycle_check/,
  );
});

test('lifecycle CHECK: CLOSED without a close_reason is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, assignment } = await seedUsableScenario(db);
  await assertRejectsWithPgCode(
    db.query(
      `INSERT INTO driver_shift (driver_id, vehicle_id, assignment_id, status, closed_at) VALUES ($1, $2, $3, 'CLOSED', now())`,
      [driver, vehicleId, assignment.id],
    ),
    '23514', /driver_shift_lifecycle_check/,
  );
});

test('lifecycle CHECK: closed_at before opened_at is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, assignment } = await seedUsableScenario(db);
  await assertRejectsWithPgCode(
    db.query(
      `INSERT INTO driver_shift (driver_id, vehicle_id, assignment_id, status, opened_at, closed_at, close_reason)
       VALUES ($1, $2, $3, 'CLOSED', now(), now() - interval '1 hour', 'DRIVER_REQUESTED')`,
      [driver, vehicleId, assignment.id],
    ),
    '23514', /driver_shift_lifecycle_check/,
  );
});

test('lifecycle: a zero-duration CLOSED shift (closed_at = opened_at) is accepted', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, assignment } = await seedUsableScenario(db);
  const { rows } = await db.query(
    `INSERT INTO driver_shift (driver_id, vehicle_id, assignment_id, status, opened_at, closed_at, close_reason)
     VALUES ($1, $2, $3, 'CLOSED', now(), now(), 'DRIVER_REQUESTED') RETURNING *`,
    [driver, vehicleId, assignment.id],
  );
  assert.equal(rows[0].status, 'CLOSED');
});

// ── 4. close_reason vocabulary is exactly {DRIVER_REQUESTED, ASSIGNMENT_UNUSABLE} ──────────
test('close_reason CHECK: a reason outside the frozen vocabulary is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, assignment } = await seedUsableScenario(db);
  await assertRejectsWithPgCode(
    db.query(
      `INSERT INTO driver_shift (driver_id, vehicle_id, assignment_id, status, closed_at, close_reason)
       VALUES ($1, $2, $3, 'CLOSED', now(), 'OPS_FORCED')`,
      [driver, vehicleId, assignment.id],
    ),
    '23514', /driver_shift_close_reason_check/,
  );
});

for (const reason of ['DRIVER_REQUESTED', 'ASSIGNMENT_UNUSABLE']) {
  test(`close_reason CHECK: '${reason}' is accepted`, { skip: SKIP }, async (t) => {
    const db = await beginTxn(t);
    const { driver, vehicleId, assignment } = await seedUsableScenario(db);
    const { rows } = await db.query(
      `INSERT INTO driver_shift (driver_id, vehicle_id, assignment_id, status, closed_at, close_reason)
       VALUES ($1, $2, $3, 'CLOSED', now(), $4) RETURNING close_reason`,
      [driver, vehicleId, assignment.id, reason],
    );
    assert.equal(rows[0].close_reason, reason);
  });
}

// ── 5. exclusivity: one OPEN shift per driver / per vehicle (raw INSERT, DB-only proof) ────
test('exclusivity: a second OPEN shift for the SAME driver is rejected at the DB layer', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, assignment } = await seedUsableScenario(db);
  await db.query(
    `INSERT INTO driver_shift (driver_id, vehicle_id, assignment_id) VALUES ($1, $2, $3)`,
    [driver, vehicleId, assignment.id],
  );
  const otherVehicle = await insertVehicle(db, driver, { model: 'Second Car' });
  const otherAssignment = await createAssignment(db, {
    vehicleId: otherVehicle, driverId: driver, assignedByUserId: driver,
    assignmentType: 'OWNER', startsAt: new Date(Date.now() - HOUR),
  });
  await assertRejectsWithPgCode(
    db.query(
      `INSERT INTO driver_shift (driver_id, vehicle_id, assignment_id) VALUES ($1, $2, $3)`,
      [driver, otherVehicle, otherAssignment.id],
    ),
    '23505', /driver_shift_one_open_per_driver_uq/,
  );
});

test('exclusivity: a second OPEN shift for the SAME vehicle (different driver) is rejected at the DB layer', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { owner, vehicleId, assignment, driver: driverA } = await seedUsableScenario(db);
  await db.query(
    `INSERT INTO driver_shift (driver_id, vehicle_id, assignment_id) VALUES ($1, $2, $3)`,
    [driverA, vehicleId, assignment.id],
  );
  const driverB = await insertUser(db);
  const assignB = await createAssignment(db, {
    vehicleId, driverId: driverB, assignedByUserId: owner,
    assignmentType: 'RENTAL', startsAt: new Date(Date.now() - HOUR),
  });
  await assertRejectsWithPgCode(
    db.query(
      `INSERT INTO driver_shift (driver_id, vehicle_id, assignment_id) VALUES ($1, $2, $3)`,
      [driverB, vehicleId, assignB.id],
    ),
    '23505', /driver_shift_one_open_per_vehicle_uq/,
  );
});

// ── 6. history RESTRICT: a driver/vehicle referenced by driver_shift cannot be deleted ─────
test('history RESTRICT: deleting a driver referenced by a driver_shift row is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, assignment } = await seedUsableScenario(db);
  await db.query(
    `INSERT INTO driver_shift (driver_id, vehicle_id, assignment_id) VALUES ($1, $2, $3)`,
    [driver, vehicleId, assignment.id],
  );
  await assertRejectsWithPgCode(db.query(`DELETE FROM users WHERE id = $1`, [driver]), '23503');
});

test('history RESTRICT: deleting a vehicle referenced by a driver_shift row is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, assignment } = await seedUsableScenario(db);
  await db.query(
    `INSERT INTO driver_shift (driver_id, vehicle_id, assignment_id) VALUES ($1, $2, $3)`,
    [driver, vehicleId, assignment.id],
  );
  await assertRejectsWithPgCode(db.query(`DELETE FROM vehicles WHERE id = $1`, [vehicleId]), '23503');
});

// ── 7. immutability guard: pinned identity cannot mutate; CLOSED cannot reopen ─────────────
test('immutability guard: rewriting the pinned vehicle_id is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, assignment } = await seedUsableScenario(db);
  const { rows: [shift] } = await db.query(
    `INSERT INTO driver_shift (driver_id, vehicle_id, assignment_id) VALUES ($1, $2, $3) RETURNING *`,
    [driver, vehicleId, assignment.id],
  );
  const otherVehicle = await insertVehicle(db, driver, { model: 'Other' });
  await assertRejectsWithPgCode(
    db.query(`UPDATE driver_shift SET vehicle_id = $2 WHERE id = $1`, [shift.id, otherVehicle]),
    '23514', /pinned identity/,
  );
});

test('immutability guard: rewriting opened_at is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, assignment } = await seedUsableScenario(db);
  const { rows: [shift] } = await db.query(
    `INSERT INTO driver_shift (driver_id, vehicle_id, assignment_id) VALUES ($1, $2, $3) RETURNING *`,
    [driver, vehicleId, assignment.id],
  );
  await assertRejectsWithPgCode(
    db.query(`UPDATE driver_shift SET opened_at = now() - interval '1 hour' WHERE id = $1`, [shift.id]),
    '23514', /pinned identity/,
  );
});

test('CLOSED is terminal: reopening a CLOSED shift is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, assignment } = await seedUsableScenario(db);
  const shift = await insertOpenShift(db, { driverId: driver, vehicleId, assignmentId: assignment.id });
  const closed = await closeShift(db, shift.id, { closeReason: 'DRIVER_REQUESTED' });
  assert.equal(closed.status, 'CLOSED');
  await assertRejectsWithPgCode(
    db.query(`UPDATE driver_shift SET status = 'OPEN', closed_at = NULL, close_reason = NULL WHERE id = $1`, [shift.id]),
    '23514', /terminal/,
  );
});

test('idempotent re-save: rewriting a CLOSED row with the SAME values is accepted (no genuine change)', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, assignment } = await seedUsableScenario(db);
  const shift = await insertOpenShift(db, { driverId: driver, vehicleId, assignmentId: assignment.id });
  const closed = await closeShift(db, shift.id, { closeReason: 'DRIVER_REQUESTED' });
  const { rows } = await db.query(
    `UPDATE driver_shift SET status = 'CLOSED', close_reason = 'DRIVER_REQUESTED' WHERE id = $1 RETURNING *`,
    [shift.id],
  );
  assert.equal(rows[0].id, closed.id, 'no-op re-save of unchanged values passes the guard');
});

// ── 8. repository primitives round-trip ─────────────────────────────────────────────────────
test('driver_shifts.js primitives: find/lock/insert/close round-trip', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, assignment } = await seedUsableScenario(db);
  assert.equal(await findOpenShiftForDriver(db, driver), null);
  assert.equal(await findOpenShiftForVehicle(db, vehicleId), null);
  assert.equal(await lockOpenShiftForDriver(db, driver), null);

  const shift = await insertOpenShift(db, { driverId: driver, vehicleId, assignmentId: assignment.id });
  assert.equal(shift.status, 'OPEN');
  assert.equal(shift.close_reason, null);

  assert.equal((await findOpenShiftForDriver(db, driver)).id, shift.id);
  assert.equal((await findOpenShiftForVehicle(db, vehicleId)).id, shift.id);
  assert.equal((await lockOpenShiftForDriver(db, driver)).id, shift.id);

  const closed = await closeShift(db, shift.id, { closeReason: 'DRIVER_REQUESTED' });
  assert.equal(closed.status, 'CLOSED');
  assert.equal(closed.close_reason, 'DRIVER_REQUESTED');
  assert.ok(closed.closed_at);

  // a repeated close is a no-op (WHERE status='OPEN' guard), not an error.
  assert.equal(await closeShift(db, shift.id, { closeReason: 'DRIVER_REQUESTED' }), null);
  assert.equal(await findOpenShiftForDriver(db, driver), null, 'no longer OPEN');
});

// P2-1 review-fix primitives: an UNLOCKED seed read by exact id (findShiftById) and a
// lock-by-exact-id (lockOpenShiftById, filtered by id AND status='OPEN' — never by driver_id).
test('driver_shifts.js primitives: findShiftById (unlocked) and lockOpenShiftById (exact id, OPEN only)', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, assignment } = await seedUsableScenario(db);
  assert.equal(await findShiftById(db, randomUUID()), null, 'no such id at all');
  assert.equal(await lockOpenShiftById(db, randomUUID()), null, 'no such id at all');

  const shift = await insertOpenShift(db, { driverId: driver, vehicleId, assignmentId: assignment.id });
  const seed = await findShiftById(db, shift.id);
  assert.equal(seed.id, shift.id);
  assert.equal(seed.status, 'OPEN');
  assert.equal((await lockOpenShiftById(db, shift.id)).id, shift.id);

  await closeShift(db, shift.id, { closeReason: 'DRIVER_REQUESTED' });
  assert.equal((await findShiftById(db, shift.id)).status, 'CLOSED', 'findShiftById sees a CLOSED row too (unlocked, no status filter)');
  assert.equal(await lockOpenShiftById(db, shift.id), null, 'lockOpenShiftById never matches a CLOSED row, even by its exact id');
});

test('vehicles.js: lockVehicleById returns the row including its archived flag', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner, { archived: true });
  const locked = await lockVehicleById(db, vehicleId);
  assert.equal(locked.id, vehicleId);
  assert.equal(locked.archived, true);
  assert.equal(await lockVehicleById(db, randomUUID()), null);
});

test('rides.js: findActiveRideForDriver blocks past-ACCEPTED/non-terminal only', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const driver = await insertUser(db);
  assert.equal(await findActiveRideForDriver(db, driver), null, 'no ride at all: not blocked');

  const preAccept = await insertRide(db, { driverId: driver, status: 'CONFIRMED' });
  assert.equal(await findActiveRideForDriver(db, driver), null, 'pre-accept status does not block');
  await db.query(`DELETE FROM rides WHERE id = $1`, [preAccept.id]);

  const active = await insertRide(db, { driverId: driver, status: 'DRIVER_EN_ROUTE' });
  const found = await findActiveRideForDriver(db, driver);
  assert.equal(found.id, active.id, 'past-ACCEPTED, non-terminal status blocks');
  await db.query(`DELETE FROM rides WHERE id = $1`, [active.id]);

  const terminal = await insertRide(db, { driverId: driver, status: 'COMPLETED' });
  assert.equal(await findActiveRideForDriver(db, driver), null, 'terminal status does not block');
  await db.query(`DELETE FROM rides WHERE id = $1`, [terminal.id]);
});

// ── 9. openDriverShift — error taxonomy (each: zero writes) ────────────────────────────────
test('openDriverShift: NO_ACTIVE_VEHICLE_SELECTION when the driver has no selection', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const driver = await insertUser(db);
  const result = await openDriverShift(db, driver, usable);
  assert.deepEqual(result, { ok: false, code: 'NO_ACTIVE_VEHICLE_SELECTION' });
});

test('openDriverShift: ASSIGNMENT_STATE_UNKNOWN with the default resolver (no block-state authority wired in) — zero writes', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver } = await seedUsableScenario(db);
  const result = await openDriverShift(db, driver); // no opts -> defaultResolveVehicleBlockState
  assert.deepEqual(result, { ok: false, code: 'ASSIGNMENT_STATE_UNKNOWN' });
  assert.equal((await db.query(`SELECT count(*) FROM driver_shift WHERE driver_id = $1`, [driver])).rows[0].count, '0');
});

test('defaultResolveVehicleBlockState always answers UNKNOWN (no authoritative block-state storage exists yet)', { skip: SKIP }, async () => {
  assert.equal(await defaultResolveVehicleBlockState(randomUUID(), null), 'UNKNOWN');
});

test('openDriverShift: a throwing resolver fails closed to ASSIGNMENT_STATE_UNKNOWN — zero writes', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver } = await seedUsableScenario(db);
  const result = await openDriverShift(db, driver, { resolveVehicleBlockState: async () => { throw new Error('boom'); } });
  assert.deepEqual(result, { ok: false, code: 'ASSIGNMENT_STATE_UNKNOWN' });
  assert.equal((await db.query(`SELECT count(*) FROM driver_shift WHERE driver_id = $1`, [driver])).rows[0].count, '0');
});

test('openDriverShift: ASSIGNMENT_UNUSABLE(ENDED) — zero writes', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, assignment } = await seedUsableScenario(db);
  await endAssignment(db, assignment.id);
  const result = await openDriverShift(db, driver, usable);
  assert.deepEqual(result, { ok: false, code: 'ASSIGNMENT_UNUSABLE', reason: 'ENDED' });
  assert.equal((await db.query(`SELECT count(*) FROM driver_shift WHERE driver_id = $1`, [driver])).rows[0].count, '0');
});

test('openDriverShift: ASSIGNMENT_UNUSABLE(REVOKED) — zero writes', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, assignment } = await seedUsableScenario(db);
  await revokeAssignment(db, assignment.id);
  const result = await openDriverShift(db, driver, usable);
  assert.deepEqual(result, { ok: false, code: 'ASSIGNMENT_UNUSABLE', reason: 'REVOKED' });
  assert.equal((await db.query(`SELECT count(*) FROM driver_shift WHERE driver_id = $1`, [driver])).rows[0].count, '0');
});

test('openDriverShift: ASSIGNMENT_UNUSABLE(BEFORE_START) — zero writes', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  const assignment = await createAssignment(db, {
    vehicleId, driverId: driver, assignedByUserId: owner,
    assignmentType: 'OWNER', startsAt: new Date(Date.now() + 10 * HOUR),
  });
  await setSelection(db, { driverId: driver, assignmentId: assignment.id });
  const result = await openDriverShift(db, driver, usable);
  assert.deepEqual(result, { ok: false, code: 'ASSIGNMENT_UNUSABLE', reason: 'BEFORE_START' });
  assert.equal((await db.query(`SELECT count(*) FROM driver_shift WHERE driver_id = $1`, [driver])).rows[0].count, '0');
});

test('openDriverShift: ASSIGNMENT_UNUSABLE(ELAPSED) — zero writes', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  const assignment = await createAssignment(db, {
    vehicleId, driverId: driver, assignedByUserId: owner,
    assignmentType: 'OWNER',
    startsAt: new Date(Date.now() - 10 * HOUR), endsAt: new Date(Date.now() - HOUR),
  });
  await setSelection(db, { driverId: driver, assignmentId: assignment.id });
  const result = await openDriverShift(db, driver, usable);
  assert.deepEqual(result, { ok: false, code: 'ASSIGNMENT_UNUSABLE', reason: 'ELAPSED' });
  assert.equal((await db.query(`SELECT count(*) FROM driver_shift WHERE driver_id = $1`, [driver])).rows[0].count, '0');
});

test('openDriverShift: ASSIGNMENT_UNUSABLE(ARCHIVED) — zero writes', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver } = await seedUsableScenario(db, { archived: true });
  const result = await openDriverShift(db, driver, usable);
  assert.deepEqual(result, { ok: false, code: 'ASSIGNMENT_UNUSABLE', reason: 'ARCHIVED' });
  assert.equal((await db.query(`SELECT count(*) FROM driver_shift WHERE driver_id = $1`, [driver])).rows[0].count, '0');
});

test('openDriverShift: ASSIGNMENT_UNUSABLE(BLOCKED) via the injected resolver — zero writes', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver } = await seedUsableScenario(db);
  const result = await openDriverShift(db, driver, { resolveVehicleBlockState: async () => 'BLOCKED' });
  assert.deepEqual(result, { ok: false, code: 'ASSIGNMENT_UNUSABLE', reason: 'BLOCKED' });
  assert.equal((await db.query(`SELECT count(*) FROM driver_shift WHERE driver_id = $1`, [driver])).rows[0].count, '0');
});

test('openDriverShift: ACTIVE_RIDE_PRESENT — zero writes, no shift created', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver } = await seedUsableScenario(db);
  await insertRide(db, { driverId: driver, status: 'IN_PROGRESS' });
  const result = await openDriverShift(db, driver, usable);
  assert.deepEqual(result, { ok: false, code: 'ACTIVE_RIDE_PRESENT' });
  assert.equal((await db.query(`SELECT count(*) FROM driver_shift WHERE driver_id = $1`, [driver])).rows[0].count, '0');
});

test('openDriverShift: DRIVER_SHIFT_ALREADY_OPEN when a DIFFERENT shift is already open for this driver', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, owner, vehicleId, assignment } = await seedUsableScenario(db);
  await insertOpenShift(db, { driverId: driver, vehicleId, assignmentId: assignment.id });
  // Switch the driver's selection to a SECOND, also-usable vehicle/assignment.
  const otherVehicle = await insertVehicle(db, owner, { model: 'Second Car' });
  const otherAssignment = await createAssignment(db, {
    vehicleId: otherVehicle, driverId: driver, assignedByUserId: owner,
    assignmentType: 'RENTAL', startsAt: new Date(Date.now() - HOUR),
  });
  await setSelection(db, { driverId: driver, assignmentId: otherAssignment.id });
  const result = await openDriverShift(db, driver, usable);
  assert.deepEqual(result, { ok: false, code: 'DRIVER_SHIFT_ALREADY_OPEN' });
});

test('openDriverShift: VEHICLE_SHIFT_ALREADY_OPEN when a DIFFERENT driver already has the vehicle open', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { owner, vehicleId, assignment, driver: driverA } = await seedUsableScenario(db);
  await insertOpenShift(db, { driverId: driverA, vehicleId, assignmentId: assignment.id });
  const driverB = await insertUser(db);
  const assignB = await createAssignment(db, {
    vehicleId, driverId: driverB, assignedByUserId: owner,
    assignmentType: 'RENTAL', startsAt: new Date(Date.now() - HOUR),
  });
  await setSelection(db, { driverId: driverB, assignmentId: assignB.id });
  const result = await openDriverShift(db, driverB, usable);
  assert.deepEqual(result, { ok: false, code: 'VEHICLE_SHIFT_ALREADY_OPEN' });
  assert.ok(await readSelection(db, driverB), 'the loser\'s selection is untouched');
});

test('openDriverShift: idempotent re-open of the SAME already-open pinned tuple returns the existing shift', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, assignment } = await seedUsableScenario(db);
  const first = await openDriverShift(db, driver, usable);
  assert.equal(first.ok, true);
  assert.equal(first.code, 'OPENED');
  const second = await openDriverShift(db, driver, usable);
  assert.equal(second.ok, true);
  assert.equal(second.code, 'ALREADY_OPEN');
  assert.equal(second.idempotent, true);
  assert.equal(second.shift.id, first.shift.id);
  const { rows } = await db.query(`SELECT count(*) FROM driver_shift WHERE driver_id = $1`, [driver]);
  assert.equal(rows[0].count, '1', 'no duplicate row from the idempotent re-open');
  void vehicleId; void assignment;
});

test('openDriverShift: happy path — pinned identity matches the locked assignment exactly', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, assignment } = await seedUsableScenario(db);
  const result = await openDriverShift(db, driver, usable);
  assert.equal(result.ok, true);
  assert.equal(result.code, 'OPENED');
  assert.equal(result.shift.driver_id, driver);
  assert.equal(result.shift.vehicle_id, vehicleId);
  assert.equal(result.shift.assignment_id, assignment.id);
  assert.equal(result.shift.status, 'OPEN');
  assert.ok(result.shift.opened_at);
  assert.equal(result.shift.closed_at, null);
  assert.equal(result.shift.close_reason, null);
});

// ── 10. closeDriverShift ─────────────────────────────────────────────────────────────────────
test('closeDriverShift: NO_OPEN_SHIFT when the driver has no OPEN shift', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const driver = await insertUser(db);
  const result = await closeDriverShift(db, driver);
  assert.deepEqual(result, { ok: false, code: 'NO_OPEN_SHIFT' });
});

test('closeDriverShift: ACTIVE_RIDE_PRESENT — zero writes, shift remains OPEN, selection untouched', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver } = await seedUsableScenario(db);
  const opened = await openDriverShift(db, driver, usable);
  await insertRide(db, { driverId: driver, status: 'WAITING_PASSENGER' });
  const result = await closeDriverShift(db, driver);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ACTIVE_RIDE_PRESENT');
  const stillOpen = await findOpenShiftForDriver(db, driver);
  assert.equal(stillOpen.id, opened.shift.id);
  assert.ok(await readSelection(db, driver));
});

test('closeDriverShift: normal close -> CLOSED/DRIVER_REQUESTED, selection preserved', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver } = await seedUsableScenario(db);
  const opened = await openDriverShift(db, driver, usable);
  const result = await closeDriverShift(db, driver);
  assert.equal(result.ok, true);
  assert.equal(result.code, 'CLOSED');
  assert.equal(result.shift.id, opened.shift.id);
  assert.equal(result.shift.status, 'CLOSED');
  assert.equal(result.shift.close_reason, 'DRIVER_REQUESTED');
  assert.ok(result.shift.closed_at);
  assert.ok(await readSelection(db, driver), 'a normal close MUST NOT clear the driver\'s selection');
});

// ── 11. getOpenDriverShift ───────────────────────────────────────────────────────────────────
test('getOpenDriverShift: null in NONE state, the row once OPEN', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver } = await seedUsableScenario(db);
  assert.equal(await getOpenDriverShift(db, driver), null);
  const opened = await openDriverShift(db, driver, usable);
  assert.equal((await getOpenDriverShift(db, driver)).id, opened.shift.id);
});

// ── 12. reconcileAssignmentUnusableShift (server-forced cleanup) ───────────────────────────
test('reconcileAssignmentUnusableShift: NOT_CONFIRMED_UNUSABLE refuses to act on a still-usable assignment', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver } = await seedUsableScenario(db);
  const opened = await openDriverShift(db, driver, usable);
  const result = await reconcileAssignmentUnusableShift(db, opened.shift.id, usable);
  assert.deepEqual(result, { ok: false, code: 'NOT_CONFIRMED_UNUSABLE' });
  assert.equal((await findOpenShiftForDriver(db, driver)).id, opened.shift.id, 'untouched');
});

test('reconcileAssignmentUnusableShift: DEFERRED_ACTIVE_RIDE_PRESENT — zero writes, shift remains OPEN', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, assignment } = await seedUsableScenario(db);
  const opened = await openDriverShift(db, driver, usable);
  await revokeAssignment(db, assignment.id); // now confirmed UNUSABLE
  await insertRide(db, { driverId: driver, status: 'ACCEPTED' });
  const result = await reconcileAssignmentUnusableShift(db, opened.shift.id, usable);
  assert.equal(result.ok, true);
  assert.equal(result.code, 'DEFERRED_ACTIVE_RIDE_PRESENT');
  const stillOpen = await findOpenShiftForDriver(db, driver);
  assert.equal(stillOpen.id, opened.shift.id, 'no PENDING_CLOSE marker — the shift itself just stays OPEN');
  assert.ok(await readSelection(db, driver), 'selection untouched while deferred');
});

test('reconcileAssignmentUnusableShift: CLOSED_AND_CLEANED closes the shift and clears the matching stale selection', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, assignment } = await seedUsableScenario(db);
  const opened = await openDriverShift(db, driver, usable);
  await revokeAssignment(db, assignment.id);
  const result = await reconcileAssignmentUnusableShift(db, opened.shift.id, usable);
  assert.equal(result.ok, true);
  assert.equal(result.code, 'CLOSED_AND_CLEANED');
  assert.equal(result.shift.status, 'CLOSED');
  assert.equal(result.shift.close_reason, 'ASSIGNMENT_UNUSABLE');
  assert.equal(await readSelection(db, driver), null, 'the now-stale selection is cleared');
});

test('reconcileAssignmentUnusableShift: does not clear a selection the driver already switched away from', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, owner, assignment } = await seedUsableScenario(db);
  const opened = await openDriverShift(db, driver, usable);
  await revokeAssignment(db, assignment.id);
  // The driver switches to a new, unrelated USABLE assignment BEFORE reconciliation runs.
  const newVehicle = await insertVehicle(db, owner, { model: 'New Car' });
  const newAssignment = await createAssignment(db, {
    vehicleId: newVehicle, driverId: driver, assignedByUserId: owner,
    assignmentType: 'RENTAL', startsAt: new Date(Date.now() - HOUR),
  });
  await setSelection(db, { driverId: driver, assignmentId: newAssignment.id });

  const result = await reconcileAssignmentUnusableShift(db, opened.shift.id, usable);
  assert.equal(result.code, 'CLOSED_AND_CLEANED');
  const selection = await readSelection(db, driver);
  assert.ok(selection, 'the NEWER selection must survive reconciliation of the OLDER shift');
  assert.equal(selection.assignment_id, newAssignment.id);
});

test('reconcileAssignmentUnusableShift: ALREADY_CLOSED_OR_NOT_FOUND is idempotent', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, assignment } = await seedUsableScenario(db);
  const opened = await openDriverShift(db, driver, usable);
  await revokeAssignment(db, assignment.id);
  const first = await reconcileAssignmentUnusableShift(db, opened.shift.id, usable);
  assert.equal(first.code, 'CLOSED_AND_CLEANED');
  const second = await reconcileAssignmentUnusableShift(db, opened.shift.id, usable);
  assert.deepEqual(second, { ok: true, code: 'ALREADY_CLOSED_OR_NOT_FOUND', idempotent: true });
  const bogus = await reconcileAssignmentUnusableShift(db, randomUUID(), usable);
  assert.deepEqual(bogus, { ok: true, code: 'ALREADY_CLOSED_OR_NOT_FOUND', idempotent: true });
});

// ── 13. real PostgreSQL concurrency ─────────────────────────────────────────────────────────
async function cleanupScenario(client, { shiftIds = [], driverIds = [], assignmentIds = [], vehicleIds = [], userIds = [] }) {
  for (const id of shiftIds) await client.query(`DELETE FROM driver_shift WHERE id = $1`, [id]).catch(() => {});
  for (const id of driverIds) await client.query(`DELETE FROM driver_active_vehicle WHERE driver_id = $1`, [id]).catch(() => {});
  for (const id of assignmentIds) await client.query(`DELETE FROM vehicle_driver_assignments WHERE id = $1`, [id]).catch(() => {});
  for (const id of vehicleIds) await client.query(`DELETE FROM vehicles WHERE id = $1`, [id]).catch(() => {});
  for (const id of userIds) await client.query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
}

test('same-driver concurrency: two concurrent opens for ONE driver serialize via the per-driver authority lock — no duplicate OPEN shift', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: APP_CONFIG });
  const seed = new pg.Client({ connectionString: DATABASE_URL });
  await seed.connect();
  const seedDb = { query: (text, params) => seed.query(text, params) };
  const { owner, driver, vehicleId, assignment } = await seedUsableScenario(seedDb);

  // A single consolidated t.after, deleting bottom-up (driver_shift first — every FK here is
  // RESTRICT, so a parent row can't be deleted while a shift still references it). shiftIds is
  // populated LATER in the test body; the closure reads its current contents when t.after
  // actually RUNS (at test end), not when it was registered.
  const shiftIds = [];
  t.after(async () => {
    await cleanupScenario(seed, {
      shiftIds, driverIds: [driver], assignmentIds: [assignment.id], vehicleIds: [vehicleId], userIds: [owner, driver],
    });
    await seed.end();
    await app.close();
  });

  const [resA, resB] = await Promise.all([
    openDriverShift(app.db, driver, usable),
    openDriverShift(app.db, driver, usable),
  ]);
  const results = [resA, resB];
  const opened = results.filter((r) => r.ok && r.code === 'OPENED');
  const idempotent = results.filter((r) => r.ok && r.code === 'ALREADY_OPEN');
  assert.equal(opened.length, 1, 'exactly one call actually opened the shift');
  assert.equal(idempotent.length, 1, 'the other, once serialized behind the lock, saw it already open and returned idempotently');
  assert.equal(opened[0].shift.id, idempotent[0].shift.id, 'both calls resolve to the SAME row');

  const { rows } = await seed.query(`SELECT id FROM driver_shift WHERE driver_id = $1 AND status = 'OPEN'`, [driver]);
  assert.equal(rows.length, 1, 'no duplicate OPEN row for this driver');
  shiftIds.push(...rows.map((r) => r.id));
});

test('same-vehicle concurrency: two different drivers racing for the SAME vehicle — exactly one wins', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: APP_CONFIG });
  const seed = new pg.Client({ connectionString: DATABASE_URL });
  await seed.connect();
  const seedDb = { query: (text, params) => seed.query(text, params) };

  const owner = await insertUser(seedDb);
  const driverA = await insertUser(seedDb);
  const driverB = await insertUser(seedDb);
  const vehicleId = await insertVehicle(seedDb, owner);
  const assignA = await createAssignment(seedDb, {
    vehicleId, driverId: driverA, assignedByUserId: owner, assignmentType: 'OWNER', startsAt: new Date(Date.now() - HOUR),
  });
  const assignB = await createAssignment(seedDb, {
    vehicleId, driverId: driverB, assignedByUserId: owner, assignmentType: 'RENTAL', startsAt: new Date(Date.now() - HOUR),
  });
  await setSelection(seedDb, { driverId: driverA, assignmentId: assignA.id });
  await setSelection(seedDb, { driverId: driverB, assignmentId: assignB.id });

  // Single consolidated t.after (see the same-driver test above for why) — shiftIds is
  // populated later, once the race resolves.
  const shiftIds = [];
  t.after(async () => {
    await cleanupScenario(seed, {
      shiftIds, driverIds: [driverA, driverB], assignmentIds: [assignA.id, assignB.id],
      vehicleIds: [vehicleId], userIds: [owner, driverA, driverB],
    });
    await seed.end();
    await app.close();
  });

  const [resA, resB] = await Promise.all([
    openDriverShift(app.db, driverA, usable),
    openDriverShift(app.db, driverB, usable),
  ]);
  const results = [{ driverId: driverA, r: resA }, { driverId: driverB, r: resB }];
  const winners = results.filter((x) => x.r.ok && x.r.code === 'OPENED');
  const losers = results.filter((x) => !x.r.ok && x.r.code === 'VEHICLE_SHIFT_ALREADY_OPEN');
  assert.equal(winners.length, 1, 'exactly one driver opens the vehicle');
  assert.equal(losers.length, 1, 'the other gets VEHICLE_SHIFT_ALREADY_OPEN, never a duplicate OPEN row');

  const { rows } = await seed.query(`SELECT id FROM driver_shift WHERE vehicle_id = $1 AND status = 'OPEN'`, [vehicleId]);
  assert.equal(rows.length, 1, 'never two durable OPEN shifts for one vehicle');
  shiftIds.push(...rows.map((r) => r.id));

  const loserDriverId = losers[0].driverId;
  assert.ok(await readSelection(seedDb, loserDriverId), 'the loser\'s selection is intact');

  // Independently: the partial unique index itself rejects a raw conflicting INSERT.
  const loserAssignmentId = loserDriverId === driverA ? assignA.id : assignB.id;
  await assertRejectsWithPgCode(
    seed.query(
      `INSERT INTO driver_shift (driver_id, vehicle_id, assignment_id) VALUES ($1, $2, $3)`,
      [loserDriverId, vehicleId, loserAssignmentId],
    ),
    '23505', /driver_shift_one_open_per_vehicle_uq/,
  );
});

test('assignment-revoke race: the locked entitlement row blocks a concurrent REVOKE until the shift decision commits', { skip: SKIP }, async (t) => {
  const seed = new pg.Client({ connectionString: DATABASE_URL });
  await seed.connect();
  const seedDb = { query: (text, params) => seed.query(text, params) };
  const { owner, driver, vehicleId, assignment } = await seedUsableScenario(seedDb);

  const clientA = new pg.Client({ connectionString: DATABASE_URL });
  const clientB = new pg.Client({ connectionString: DATABASE_URL });
  await clientA.connect();
  await clientB.connect();
  const dbA = { query: (text, params) => clientA.query(text, params) };
  const dbB = { query: (text, params) => clientB.query(text, params) };

  let shiftId;
  t.after(async () => {
    await clientA.query('COMMIT').catch(() => {});
    await clientB.query('COMMIT').catch(() => {});
    await clientA.end();
    await clientB.end();
    await cleanupScenario(seed, {
      shiftIds: shiftId ? [shiftId] : [], driverIds: [driver],
      assignmentIds: [assignment.id], vehicleIds: [vehicleId], userIds: [owner, driver],
    });
    await seed.end();
  });

  await clientA.query('BEGIN');
  const lockedAssignment = await lockAssignmentForEntitlementCheck(dbA, assignment.id); // A holds the row lock.
  assert.equal(lockedAssignment.entitled_now, true, 'still entitled at the moment A decides');

  await clientB.query('BEGIN');
  let bResolved = false;
  const bPromise = revokeAssignment(dbB, assignment.id).then((r) => { bResolved = true; return r; });

  await delay(300);
  assert.equal(bResolved, false, 'B (revoke) is blocked while A holds the assignment row lock');

  // A proceeds using the fact it captured under the still-held lock — genuinely valid, since B
  // could not have revoked yet.
  const vehicle = await lockVehicleById(dbA, lockedAssignment.vehicle_id);
  assert.equal(vehicle.archived, false);
  const shift = await insertOpenShift(dbA, {
    driverId: driver, vehicleId: lockedAssignment.vehicle_id, assignmentId: assignment.id,
  });
  shiftId = shift.id;
  await clientA.query('COMMIT'); // releases the assignment row lock.

  const revoked = await bPromise;
  assert.equal(bResolved, true, 'B unblocks once A commits');
  assert.equal(revoked.status, 'REVOKED');
  await clientB.query('COMMIT');

  const { rows } = await seed.query(`SELECT status FROM driver_shift WHERE id = $1`, [shift.id]);
  assert.equal(rows[0].status, 'OPEN', 'the shift A opened under a genuinely-valid lock is not retroactively invalidated');
});

// ── 14. P2-1 review-fix: lock-order-inversion deadlock between closeDriverShift and
// reconcileAssignmentUnusableShift, and its regression coverage ─────────────────────────────

// STEP 6 — a lightweight structural/source-order assertion: reconcileAssignmentUnusableShift's
// own source text must reference these identifiers in exactly this order, protecting the fixed
// lock sequence against a future silent reordering. Deliberately NOT a DB test — a pure string
// check against Function.prototype.toString() of the exported function (works because it is a
// plain, non-native async function; V8 preserves the original source text).
test('lock-order structural assertion: reconcileAssignmentUnusableShift references locks in the frozen global order', { skip: SKIP }, () => {
  const src = reconcileAssignmentUnusableShift.toString();
  const order = ['findShiftById', 'lockDriverAuthority', 'lockAssignmentForEntitlementCheck', 'lockVehicleById', 'lockOpenShiftById'];
  const indices = order.map((name) => src.indexOf(name));
  for (const idx of indices) assert.notEqual(idx, -1, 'every expected identifier must appear in the source');
  for (let i = 1; i < indices.length; i += 1) {
    assert.ok(indices[i - 1] < indices[i], `${order[i - 1]} must appear before ${order[i]} in source order`);
  }
});

// STEP 4 — deterministic regression proving the OLD shift-row-first inversion cannot return.
// While reconcileAssignmentUnusableShift is blocked waiting for the driver lock (held by an
// independent connection), an independent THIRD connection must be able to lock the SAME shift
// row immediately — proving reconciliation has NOT locked it yet. Under the old (pre-fix)
// ordering, reconciliation would have locked the shift row FIRST, and this exact probe would
// have blocked too.
test('P2-1 regression: reconciliation does not hold the shift-row lock while still waiting for the driver lock', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: APP_CONFIG });
  const seed = new pg.Client({ connectionString: DATABASE_URL });
  await seed.connect();
  const seedDb = { query: (text, params) => seed.query(text, params) };
  const { owner, driver, vehicleId, assignment } = await seedUsableScenario(seedDb);
  const opened = await openDriverShift(app.db, driver, usable);
  assert.equal(opened.ok, true);
  const shiftId = opened.shift.id;

  const holder = new pg.Client({ connectionString: DATABASE_URL }); // holds the driver lock.
  const probe = new pg.Client({ connectionString: DATABASE_URL }); // probes the shift-row lock.
  await holder.connect();
  await probe.connect();

  t.after(async () => {
    await holder.query('ROLLBACK').catch(() => {});
    await probe.query('ROLLBACK').catch(() => {});
    await holder.end();
    await probe.end();
    await cleanupScenario(seed, {
      shiftIds: [shiftId], driverIds: [driver], assignmentIds: [assignment.id],
      vehicleIds: [vehicleId], userIds: [owner, driver],
    });
    await seed.end();
    await app.close();
  });

  await holder.query('BEGIN');
  await holder.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [driver]); // holds the per-driver lock.

  let reconcileResolved = false;
  const reconcilePromise = reconcileAssignmentUnusableShift(app.db, shiftId, usable)
    .then((r) => { reconcileResolved = true; return r; });

  await delay(300);
  assert.equal(reconcileResolved, false, 'reconciliation is genuinely blocked waiting for the driver lock');

  // The critical probe: an INDEPENDENT third connection must be able to lock the shift row
  // RIGHT NOW, with no contention — proving reconciliation has not touched it yet.
  await probe.query('BEGIN');
  const probeStart = Date.now();
  await probe.query(`SELECT * FROM driver_shift WHERE id = $1 FOR UPDATE`, [shiftId]);
  const probeElapsed = Date.now() - probeStart;
  assert.ok(probeElapsed < 500, `the shift row must be immediately lockable (took ${probeElapsed}ms) — reconciliation must not have locked it before the driver lock`);
  await probe.query('COMMIT');

  await holder.query('COMMIT'); // release the driver lock — reconciliation can now proceed.
  const result = await reconcilePromise;
  assert.equal(reconcileResolved, true, 'reconciliation completes cleanly once the driver lock is released');
  // The assignment was never revoked/ended and the resolver says UNBLOCKED, so usability is
  // USABLE, not a confirmed UNUSABLE — reconciliation correctly refuses to act. The point of
  // this test is the LOCK-ORDER probe above, not this outcome, but asserting it confirms
  // reconciliation genuinely ran through to completion rather than throwing.
  assert.deepEqual(result, { ok: false, code: 'NOT_CONFIRMED_UNUSABLE' });
});

// STEP 5 — real closeDriverShift vs reconcileAssignmentUnusableShift concurrency, several
// trials, using the ACTUAL functions (no manual lock staging). No fixed winner is asserted —
// only that the outcome is always one of the allowed coherent serial results, with no raw
// PostgreSQL error (specifically no 40P01) ever escaping either call.
test('P2-1 regression: closeDriverShift vs reconcileAssignmentUnusableShift never deadlocks, never corrupts, always one coherent terminal state', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: APP_CONFIG });
  const seed = new pg.Client({ connectionString: DATABASE_URL });
  await seed.connect();
  const seedDb = { query: (text, params) => seed.query(text, params) };
  t.after(async () => { await seed.end(); await app.close(); });

  const TRIALS = 8;
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const owner = await insertUser(seedDb);
    const driver = await insertUser(seedDb);
    const vehicleId = await insertVehicle(seedDb, owner);
    const assignment = await createAssignment(seedDb, {
      vehicleId, driverId: driver, assignedByUserId: owner, assignmentType: 'OWNER', startsAt: new Date(Date.now() - HOUR),
    });
    await setSelection(seedDb, { driverId: driver, assignmentId: assignment.id });
    const opened = await openDriverShift(app.db, driver, usable);
    assert.equal(opened.ok, true);
    await revokeAssignment(seedDb, assignment.id); // makes the pinned assignment confirmed UNUSABLE.

    const settled = await Promise.allSettled([
      closeDriverShift(app.db, driver),
      reconcileAssignmentUnusableShift(app.db, opened.shift.id, usable),
    ]);

    for (const s of settled) {
      if (s.status === 'rejected') {
        assert.notEqual(s.reason && s.reason.code, '40P01', `trial ${trial}: no raw deadlock may ever escape either call: ${s.reason}`);
        // Any OTHER rejection is itself unexpected — surface it plainly.
        assert.fail(`trial ${trial}: unexpected rejection: ${s.reason}`);
      }
    }
    const [closeRes, reconcileRes] = settled.map((s) => s.value);

    const { rows: finalRows } = await seedDb.query(`SELECT status, close_reason FROM driver_shift WHERE id = $1`, [opened.shift.id]);
    assert.equal(finalRows[0].status, 'CLOSED', `trial ${trial}: the shift always ends CLOSED`);
    assert.ok(
      finalRows[0].close_reason === 'DRIVER_REQUESTED' || finalRows[0].close_reason === 'ASSIGNMENT_UNUSABLE',
      `trial ${trial}: close_reason must be one of the two frozen values, got ${finalRows[0].close_reason}`,
    );
    // Exactly one side actually performed the close mutation (ok + a CLOSED/CLOSED_AND_CLEANED
    // code); the other observed NO_OPEN_SHIFT or ALREADY_CLOSED_OR_NOT_FOUND — never both
    // "succeeding" at closing, never both failing.
    const closers = [closeRes, reconcileRes].filter((r) => r.ok && (r.code === 'CLOSED' || r.code === 'CLOSED_AND_CLEANED'));
    assert.equal(closers.length, 1, `trial ${trial}: exactly one side performs the close mutation: close=${JSON.stringify(closeRes)} reconcile=${JSON.stringify(reconcileRes)}`);

    // Selection behavior corresponds to the winning path: if reconcile's close won, the
    // selection is cleared (it still pointed at the revoked assignment); if the driver-requested
    // close won first (before reconcile's usability check), reconcile then finds the shift
    // already closed and reports its own idempotent/refusal outcome, and the selection is left
    // untouched by the DRIVER_REQUESTED close (matching normal-close semantics).
    const selection = await readSelection(seedDb, driver);
    if (finalRows[0].close_reason === 'ASSIGNMENT_UNUSABLE') {
      assert.equal(selection, null, `trial ${trial}: ASSIGNMENT_UNUSABLE close must have cleared the stale selection`);
    } else {
      assert.ok(selection, `trial ${trial}: DRIVER_REQUESTED close must leave the selection untouched`);
    }
  }
});

// STEP 2 critical case — a stale seed must never let reconciliation act on a DIFFERENT, newer
// OPEN shift for the same driver. Deterministically forced: hold the driver lock, close shift A
// and open shift B for the SAME driver from that SAME holding connection/transaction (so
// reconciliation, blocked on the driver lock the whole time, cannot observe either write until
// the holder commits), then release and confirm reconciliation reports A as
// ALREADY_CLOSED_OR_NOT_FOUND and never touches B.
test('P2-1 regression: a stale seed never lets reconciliation act on a newer, different OPEN shift for the same driver', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: APP_CONFIG });
  const seed = new pg.Client({ connectionString: DATABASE_URL });
  await seed.connect();
  const seedDb = { query: (text, params) => seed.query(text, params) };
  const { owner, driver, vehicleId, assignment } = await seedUsableScenario(seedDb);
  const openedA = await openDriverShift(app.db, driver, usable);
  assert.equal(openedA.ok, true);
  const shiftIdA = openedA.shift.id;

  const holder = new pg.Client({ connectionString: DATABASE_URL });
  await holder.connect();
  const holderDb = { query: (text, params) => holder.query(text, params) };

  let shiftIdB;
  t.after(async () => {
    await holder.query('ROLLBACK').catch(() => {});
    await holder.end();
    await cleanupScenario(seed, {
      shiftIds: [shiftIdA, shiftIdB].filter(Boolean), driverIds: [driver],
      assignmentIds: [assignment.id], vehicleIds: [vehicleId], userIds: [owner, driver],
    });
    await seed.end();
    await app.close();
  });

  await holder.query('BEGIN');
  await holder.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [driver]); // A's driver lock.

  // Reconciliation seed-reads shift A (unlocked) and then blocks on the driver lock.
  let reconcileResolved = false;
  const reconcilePromise = reconcileAssignmentUnusableShift(app.db, shiftIdA, usable)
    .then((r) => { reconcileResolved = true; return r; });
  await delay(300);
  assert.equal(reconcileResolved, false, 'reconciliation for A is blocked on the driver lock');

  // While still holding the driver lock, close A and open a NEW shift B for the SAME driver —
  // all via the SAME connection/transaction (a transaction never blocks on its own locks).
  await closeShift(holderDb, shiftIdA, { closeReason: 'DRIVER_REQUESTED' });
  const shiftB = await insertOpenShift(holderDb, { driverId: driver, vehicleId, assignmentId: assignment.id });
  shiftIdB = shiftB.id;
  await holder.query('COMMIT'); // releases the driver lock; A is CLOSED, B is OPEN, durably.

  const result = await reconcilePromise;
  assert.equal(reconcileResolved, true);
  assert.deepEqual(result, { ok: true, code: 'ALREADY_CLOSED_OR_NOT_FOUND', idempotent: true }, 'reconciliation for A reports stale/idempotent, never substituting B');

  const { rows: bRows } = await seed.query(`SELECT status FROM driver_shift WHERE id = $1`, [shiftIdB]);
  assert.equal(bRows[0].status, 'OPEN', 'shift B was never touched');
  const selectionAfter = await readSelection(seedDb, driver);
  assert.ok(selectionAfter, 'shift B\'s selection was never cleared');
});

// Assignment-revoke vs reconciliation — confirms the FIXED lock order still correctly
// serializes reconciliation against a concurrent REVOKE on the exact assignment row (the same
// guarantee already proven for openDriverShift vs revoke, above, now re-verified for
// reconcileAssignmentUnusableShift specifically, since its lock sequence changed).
test('P2-1 regression: reconcileAssignmentUnusableShift still serializes correctly against a concurrent assignment REVOKE', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: APP_CONFIG });
  const seed = new pg.Client({ connectionString: DATABASE_URL });
  await seed.connect();
  const seedDb = { query: (text, params) => seed.query(text, params) };
  const { owner, driver, vehicleId, assignment } = await seedUsableScenario(seedDb);
  const opened = await openDriverShift(app.db, driver, usable);
  assert.equal(opened.ok, true);

  const clientA = new pg.Client({ connectionString: DATABASE_URL }); // holds the assignment lock.
  await clientA.connect();
  const dbA = { query: (text, params) => clientA.query(text, params) };

  t.after(async () => {
    await clientA.query('ROLLBACK').catch(() => {});
    await clientA.end();
    await cleanupScenario(seed, {
      shiftIds: [opened.shift.id], driverIds: [driver], assignmentIds: [assignment.id],
      vehicleIds: [vehicleId], userIds: [owner, driver],
    });
    await seed.end();
    await app.close();
  });

  await clientA.query('BEGIN');
  await lockAssignmentForEntitlementCheck(dbA, assignment.id); // A holds the assignment row lock.

  let reconcileResolved = false;
  const reconcilePromise = reconcileAssignmentUnusableShift(app.db, opened.shift.id, usable)
    .then((r) => { reconcileResolved = true; return r; });
  await delay(300);
  assert.equal(reconcileResolved, false, 'reconciliation is blocked on the held assignment row lock');

  await clientA.query('COMMIT'); // releases the assignment lock without revoking (A only read it).
  const result = await reconcilePromise;
  assert.equal(reconcileResolved, true);
  // The assignment is still USABLE (A never revoked it) -> reconciliation correctly refuses.
  assert.deepEqual(result, { ok: false, code: 'NOT_CONFIRMED_UNUSABLE' });
});
