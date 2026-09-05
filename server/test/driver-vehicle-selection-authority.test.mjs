// /server/test/driver-vehicle-selection-authority.test.mjs — DB-gated coverage for
// BD-DRIVER-SHIFT-AUTHORITY-01C-A: the authoritative DRIVER-INITIATED selection-mutation
// service (services/driver-vehicle-assignment-authority/index.js —
// setDriverSelection / clearDriverSelection) and, specifically, the frozen "no driver-
// initiated selection change while an OPEN driver_shift exists" guard
// (docs/driver-shift-authority-contract.md Invariant 5 / docs/driver-vehicle-assignment-
// authority-contract.md Invariant 7). SKIPPED without DATABASE_URL; runs in server-ci.
//
// Isolation strategy mirrors driver-shift-authority.test.mjs exactly:
//  - beginTxn(t): one raw connection, BEGIN'd, ROLLED BACK in t.after; its `db` shim's
//    `.tx(fn)` runs fn against the SAME ambient connection (pass-through, not a nested BEGIN)
//    so a single test can call the real service (which itself calls db.tx(...)) and still
//    roll back cleanly as one unit.
//  - The genuine-concurrency tests use a real app.db (buildApp() -> real Pool + production
//    db.tx) and/or raw pg.Client connections with manual BEGIN/COMMIT, with explicit
//    bottom-up cleanup (driver_shift -> driver_active_vehicle -> vehicle_driver_assignments
//    -> vehicles -> users — RESTRICT on every FK means a parent can't be deleted before its
//    children).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

import { buildApp } from '../src/server.js';
import {
  createAssignment, revokeAssignment, endAssignment,
} from '../src/repositories/vehicle_driver_assignments.js';
import {
  lockDriverAuthority, readSelection, setSelection,
} from '../src/repositories/driver_active_vehicle.js';
import { insertOpenShift, findOpenShiftForDriver } from '../src/repositories/driver_shifts.js';
import {
  openDriverShift, closeDriverShift, reconcileAssignmentUnusableShift,
} from '../src/services/driver-shift-authority/index.js';
import {
  setDriverSelection, clearDriverSelection,
} from '../src/services/driver-vehicle-assignment-authority/index.js';

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

// The injected resolver every "should succeed under existing rules" path needs — with no
// authoritative block-state source wired in, the default resolver answers UNKNOWN and every
// select/switch fails closed to ASSIGNMENT_STATE_UNKNOWN (identical to openDriverShift). Tests
// that want a genuine USABLE verdict inject UNBLOCKED, exactly as driver-shift-authority
// .test.mjs's own `usable` constant does.
const usable = { resolveVehicleBlockState: async () => 'UNBLOCKED' };

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

// owner + driver + vehicle + one ACTIVE, already-entitled assignment. NO selection is set —
// the driver is in the NONE state (a real "select" starts here). Add a matching selection via
// withSelection() when a "switch"/"clear"/OPEN-shift scenario needs one.
async function seedSelectable(db, { archived = false, model = 'Test Car' } = {}) {
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner, { archived, model });
  const assignment = await createAssignment(db, {
    vehicleId, driverId: driver, assignedByUserId: owner,
    assignmentType: 'OWNER', startsAt: new Date(Date.now() - HOUR),
  });
  return { owner, driver, vehicleId, assignment };
}

// A SECOND usable assignment on a DIFFERENT vehicle for the same driver (the "switch" target).
// A different vehicle => a different (vehicle_id, driver_id) pair => the 0005 non-overlap
// EXCLUDE never applies.
async function addSecondAssignment(db, { owner, driver }) {
  const vehicleId = await insertVehicle(db, owner, { model: 'Second Car' });
  const assignment = await createAssignment(db, {
    vehicleId, driverId: driver, assignedByUserId: owner,
    assignmentType: 'RENTAL', startsAt: new Date(Date.now() - HOUR),
  });
  return { vehicleId, assignment };
}

async function cleanupScenario(client, { shiftIds = [], driverIds = [], assignmentIds = [], vehicleIds = [], userIds = [] }) {
  for (const id of shiftIds) await client.query(`DELETE FROM driver_shift WHERE id = $1`, [id]).catch(() => {});
  for (const id of driverIds) await client.query(`DELETE FROM driver_active_vehicle WHERE driver_id = $1`, [id]).catch(() => {});
  for (const id of assignmentIds) await client.query(`DELETE FROM vehicle_driver_assignments WHERE id = $1`, [id]).catch(() => {});
  for (const id of vehicleIds) await client.query(`DELETE FROM vehicles WHERE id = $1`, [id]).catch(() => {});
  for (const id of userIds) await client.query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// PROOF 1-3 — select / switch / clear with NO OPEN shift succeed under the existing rules.
// ─────────────────────────────────────────────────────────────────────────────────────────
test('PROOF 1 — select, no OPEN shift: NONE -> SELECTED(A) succeeds', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, assignment } = await seedSelectable(db);
  assert.equal(await readSelection(db, driver), null, 'precondition: NONE state');

  const result = await setDriverSelection(db, driver, { assignmentId: assignment.id }, usable);
  assert.equal(result.ok, true);
  assert.equal(result.code, 'SELECTED');
  assert.equal(result.selection.assignment_id, assignment.id);
  assert.equal((await readSelection(db, driver)).assignment_id, assignment.id);
});

test('PROOF 2 — switch, no OPEN shift: SELECTED(A) -> SELECTED(B) succeeds', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { owner, driver, assignment: assignA } = await seedSelectable(db);
  const { assignment: assignB } = await addSecondAssignment(db, { owner, driver });
  await setSelection(db, { driverId: driver, assignmentId: assignA.id });

  const result = await setDriverSelection(db, driver, { assignmentId: assignB.id }, usable);
  assert.equal(result.ok, true);
  assert.equal(result.code, 'SELECTED');
  assert.equal((await readSelection(db, driver)).assignment_id, assignB.id, 'the switch is current');
});

test('PROOF 3 — clear, no OPEN shift: SELECTED(A) -> NONE succeeds', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, assignment } = await seedSelectable(db);
  await setSelection(db, { driverId: driver, assignmentId: assignment.id });

  const result = await clearDriverSelection(db, driver);
  assert.equal(result.ok, true);
  assert.equal(result.code, 'CLEARED');
  assert.equal(result.cleared.assignment_id, assignment.id, 'the deleted row is returned');
  assert.equal(await readSelection(db, driver), null, 'selection is gone');
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// PROOF 4-6 — select / switch / clear while an OPEN shift exists: DRIVER_SHIFT_OPEN, ZERO
// writes, original selection unchanged.
// ─────────────────────────────────────────────────────────────────────────────────────────
test('PROOF 4 — select while OPEN shift: DRIVER_SHIFT_OPEN, zero writes (selected_at untouched)', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, assignment } = await seedSelectable(db);
  await setSelection(db, { driverId: driver, assignmentId: assignment.id });
  await insertOpenShift(db, { driverId: driver, vehicleId, assignmentId: assignment.id });
  const before = await readSelection(db, driver);

  // Even a no-op re-select of the SAME assignment is frozen while the shift is OPEN.
  const result = await setDriverSelection(db, driver, { assignmentId: assignment.id }, usable);
  assert.deepEqual(result, { ok: false, code: 'DRIVER_SHIFT_OPEN' });

  const after = await readSelection(db, driver);
  assert.equal(after.assignment_id, assignment.id);
  assert.equal(after.selected_at.getTime(), before.selected_at.getTime(), 'selected_at not re-stamped — zero writes');
  assert.equal((await db.query(`SELECT count(*) FROM driver_active_vehicle WHERE driver_id = $1`, [driver])).rows[0].count, '1');
});

test('PROOF 5 — switch while OPEN shift: DRIVER_SHIFT_OPEN, original selection unchanged', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { owner, driver, vehicleId, assignment: assignA } = await seedSelectable(db);
  const { assignment: assignB } = await addSecondAssignment(db, { owner, driver });
  await setSelection(db, { driverId: driver, assignmentId: assignA.id });
  await insertOpenShift(db, { driverId: driver, vehicleId, assignmentId: assignA.id });

  const result = await setDriverSelection(db, driver, { assignmentId: assignB.id }, usable);
  assert.deepEqual(result, { ok: false, code: 'DRIVER_SHIFT_OPEN' });
  assert.equal((await readSelection(db, driver)).assignment_id, assignA.id, 'still A — the switch wrote nothing');
});

test('PROOF 6 — clear while OPEN shift: DRIVER_SHIFT_OPEN, original selection unchanged', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, assignment } = await seedSelectable(db);
  await setSelection(db, { driverId: driver, assignmentId: assignment.id });
  await insertOpenShift(db, { driverId: driver, vehicleId, assignmentId: assignment.id });

  const result = await clearDriverSelection(db, driver);
  assert.deepEqual(result, { ok: false, code: 'DRIVER_SHIFT_OPEN' });
  assert.equal((await readSelection(db, driver)).assignment_id, assignment.id, 'selection still present');
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// PROOF 7 — once the shift is CLOSED, selection mutation is allowed again.
// ─────────────────────────────────────────────────────────────────────────────────────────
test('PROOF 7 — after the shift is CLOSED, switch and clear are allowed again', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { owner, driver, assignment: assignA } = await seedSelectable(db);
  const { assignment: assignB } = await addSecondAssignment(db, { owner, driver });
  await setSelection(db, { driverId: driver, assignmentId: assignA.id });

  const opened = await openDriverShift(db, driver, usable);
  assert.equal(opened.ok, true);
  const blocked = await setDriverSelection(db, driver, { assignmentId: assignB.id }, usable);
  assert.equal(blocked.code, 'DRIVER_SHIFT_OPEN', 'frozen while OPEN');

  const closed = await closeDriverShift(db, driver);
  assert.equal(closed.ok, true);
  assert.equal(closed.code, 'CLOSED');

  const switched = await setDriverSelection(db, driver, { assignmentId: assignB.id }, usable);
  assert.equal(switched.ok, true);
  assert.equal(switched.code, 'SELECTED');
  assert.equal((await readSelection(db, driver)).assignment_id, assignB.id);

  const cleared = await clearDriverSelection(db, driver);
  assert.equal(cleared.ok, true);
  assert.equal(cleared.code, 'CLEARED');
  assert.equal(await readSelection(db, driver), null);
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// PROOF 8 — concurrent openDriverShift vs selection SWITCH: both take the SAME
// lockDriverAuthority(driverId) lock first, so they serialize; the outcome is always one of
// the coherent serial results, and the OPEN shift's pinned assignment can NEVER disagree with
// the committed selection (no torn authority state).
// ─────────────────────────────────────────────────────────────────────────────────────────
test('PROOF 8 — concurrent openDriverShift vs switch serialize on the driver lock; no torn authority state', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: APP_CONFIG });
  const seed = new pg.Client({ connectionString: DATABASE_URL });
  await seed.connect();
  const seedDb = { query: (text, params) => seed.query(text, params) };

  const created = { shiftIds: [], driverIds: [], assignmentIds: [], vehicleIds: [], userIds: [] };
  t.after(async () => {
    await cleanupScenario(seed, created);
    await seed.end();
    await app.close();
  });

  const TRIALS = 10;
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const { owner, driver, vehicleId: vehA, assignment: assignA } = await seedSelectable(seedDb);
    const { vehicleId: vehB, assignment: assignB } = await addSecondAssignment(seedDb, { owner, driver });
    await setSelection(seedDb, { driverId: driver, assignmentId: assignA.id });
    created.driverIds.push(driver);
    created.assignmentIds.push(assignA.id, assignB.id);
    created.vehicleIds.push(vehA, vehB);
    created.userIds.push(owner, driver);

    const [openSettled, switchSettled] = await Promise.allSettled([
      openDriverShift(app.db, driver, usable),
      setDriverSelection(app.db, driver, { assignmentId: assignB.id }, usable),
    ]);
    for (const s of [openSettled, switchSettled]) {
      assert.equal(s.status, 'fulfilled', `trial ${trial}: neither call may throw (got ${s.reason})`);
      if (s.status === 'rejected') assert.notEqual(s.reason && s.reason.code, '40P01', `trial ${trial}: no raw deadlock`);
    }
    const openRes = openSettled.value;
    const switchRes = switchSettled.value;

    const shift = await findOpenShiftForDriver(seedDb, driver);
    assert.ok(shift, `trial ${trial}: a shift is always opened (open never loses to a mere selection change)`);
    created.shiftIds.push(shift.id);
    const { rows: openRows } = await seed.query(`SELECT id FROM driver_shift WHERE driver_id = $1 AND status = 'OPEN'`, [driver]);
    assert.equal(openRows.length, 1, `trial ${trial}: never two OPEN shifts`);
    const selection = await readSelection(seedDb, driver);

    // The torn-state detector: the pinned assignment ALWAYS equals the committed selection.
    assert.equal(shift.assignment_id, selection.assignment_id, `trial ${trial}: pinned assignment agrees with the selection`);

    assert.equal(openRes.code, 'OPENED', `trial ${trial}: open result`);
    if (switchRes.code === 'SELECTED') {
      // The switch committed first; shift-open then re-read B under the lock and pinned B.
      assert.equal(shift.assignment_id, assignB.id, `trial ${trial}: switch won -> shift pinned the NEW assignment`);
      assert.equal(selection.assignment_id, assignB.id);
    } else {
      // Open committed first; the switch, serialized behind the same lock, saw the OPEN shift.
      assert.deepEqual(switchRes, { ok: false, code: 'DRIVER_SHIFT_OPEN' }, `trial ${trial}: open won -> switch blocked`);
      assert.equal(shift.assignment_id, assignA.id, `trial ${trial}: shift pinned the ORIGINAL assignment`);
      assert.equal(selection.assignment_id, assignA.id, `trial ${trial}: selection unchanged`);
    }
    assert.ok(
      !(shift.assignment_id === assignA.id && switchRes.code === 'SELECTED'),
      `trial ${trial}: never shift-pinned-A while the switch reported success`,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// PROOF 9 — concurrent openDriverShift vs CLEAR: serializes on the same driver lock.
// ─────────────────────────────────────────────────────────────────────────────────────────
test('PROOF 9 — concurrent openDriverShift vs clear serialize on the driver lock; coherent, deterministic', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: APP_CONFIG });
  const seed = new pg.Client({ connectionString: DATABASE_URL });
  await seed.connect();
  const seedDb = { query: (text, params) => seed.query(text, params) };

  const created = { shiftIds: [], driverIds: [], assignmentIds: [], vehicleIds: [], userIds: [] };
  t.after(async () => {
    await cleanupScenario(seed, created);
    await seed.end();
    await app.close();
  });

  const TRIALS = 10;
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const { owner, driver, vehicleId, assignment } = await seedSelectable(seedDb);
    await setSelection(seedDb, { driverId: driver, assignmentId: assignment.id });
    created.driverIds.push(driver);
    created.assignmentIds.push(assignment.id);
    created.vehicleIds.push(vehicleId);
    created.userIds.push(owner, driver);

    const [openSettled, clearSettled] = await Promise.allSettled([
      openDriverShift(app.db, driver, usable),
      clearDriverSelection(app.db, driver),
    ]);
    for (const s of [openSettled, clearSettled]) {
      assert.equal(s.status, 'fulfilled', `trial ${trial}: neither call may throw (got ${s.reason})`);
    }
    const openRes = openSettled.value;
    const clearRes = clearSettled.value;

    const shift = await findOpenShiftForDriver(seedDb, driver);
    const selection = await readSelection(seedDb, driver);
    if (shift) created.shiftIds.push(shift.id);

    // The coherence invariant: an OPEN shift can NEVER coexist with a NONE selection — if the
    // shift opened, the clear (serialized behind the same lock) must have been blocked.
    assert.ok(!(shift && !selection), `trial ${trial}: never an OPEN shift with a cleared selection`);

    if (openRes.code === 'OPENED') {
      assert.ok(shift, `trial ${trial}: shift present`);
      assert.equal(shift.assignment_id, assignment.id);
      assert.deepEqual(clearRes, { ok: false, code: 'DRIVER_SHIFT_OPEN' }, `trial ${trial}: open won -> clear blocked`);
      assert.ok(selection, `trial ${trial}: selection intact`);
      assert.equal(selection.assignment_id, assignment.id);
    } else {
      // The clear committed first -> shift-open re-read NONE under the lock and refused.
      assert.equal(openRes.code, 'NO_ACTIVE_VEHICLE_SELECTION', `trial ${trial}: open saw the cleared selection`);
      assert.equal(shift, null, `trial ${trial}: no shift`);
      assert.equal(clearRes.ok, true);
      assert.equal(clearRes.code, 'CLEARED');
      assert.ok(clearRes.cleared, `trial ${trial}: clear actually removed the row`);
      assert.equal(selection, null);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// PROOF 10 — lock-order regression: no NEW reverse lock order / deadlock path is introduced.
// (a) source-order assertion; (b) deterministic probe proving nothing below the per-driver
// lock is acquired before it; (c) many-trial openDriverShift/closeDriverShift vs selection
// mutation — never a 40P01.
// ─────────────────────────────────────────────────────────────────────────────────────────
test('PROOF 10a — source order: guard takes per-driver lock -> OPEN-shift read -> ride read; setDriverSelection then assignment -> vehicle -> write', { skip: SKIP }, () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'services', 'driver-vehicle-assignment-authority', 'index.js'),
    'utf8',
  );
  const guardBody = src.slice(src.indexOf('async function guardSelectionMutation'), src.indexOf('async function guardSelectionMutation') + 800);
  const guardOrder = ['lockDriverAuthority', 'findOpenShiftForDriver', 'findActiveRideForDriver'];
  const guardIdx = guardOrder.map((name) => guardBody.indexOf(name));
  for (const i of guardIdx) assert.notEqual(i, -1, 'every guard identifier appears in guardSelectionMutation');
  for (let i = 1; i < guardIdx.length; i += 1) {
    assert.ok(guardIdx[i - 1] < guardIdx[i], `${guardOrder[i - 1]} must precede ${guardOrder[i]} in guardSelectionMutation`);
  }

  const setBody = src.slice(src.indexOf('export async function setDriverSelection'), src.indexOf('export async function clearDriverSelection'));
  const setOrder = ['guardSelectionMutation', 'lockAssignmentForEntitlementCheck', 'lockVehicleById', 'decideAssignmentUsability', 'setSelection'];
  const setIdx = setOrder.map((name) => setBody.indexOf(name));
  for (const i of setIdx) assert.notEqual(i, -1, 'every setDriverSelection identifier is present');
  for (let i = 1; i < setIdx.length; i += 1) {
    assert.ok(setIdx[i - 1] < setIdx[i], `${setOrder[i - 1]} must precede ${setOrder[i]} in setDriverSelection`);
  }
});

test('PROOF 10b — while setDriverSelection is blocked on the per-driver lock, the assignment + vehicle rows are still immediately lockable (nothing acquired below the driver lock first)', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: APP_CONFIG });
  const seed = new pg.Client({ connectionString: DATABASE_URL });
  await seed.connect();
  const seedDb = { query: (text, params) => seed.query(text, params) };
  const { owner, driver, vehicleId, assignment } = await seedSelectable(seedDb);

  const holder = new pg.Client({ connectionString: DATABASE_URL }); // holds the per-driver lock
  const probe = new pg.Client({ connectionString: DATABASE_URL }); // probes assignment + vehicle
  await holder.connect();
  await probe.connect();

  t.after(async () => {
    await holder.query('ROLLBACK').catch(() => {});
    await probe.query('ROLLBACK').catch(() => {});
    await holder.end();
    await probe.end();
    await cleanupScenario(seed, {
      driverIds: [driver], assignmentIds: [assignment.id], vehicleIds: [vehicleId], userIds: [owner, driver],
    });
    await seed.end();
    await app.close();
  });

  await holder.query('BEGIN');
  await holder.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [driver]); // the per-driver authority lock

  let selectionResolved = false;
  const selectionPromise = setDriverSelection(app.db, driver, { assignmentId: assignment.id }, usable)
    .then((r) => { selectionResolved = true; return r; });

  await delay(300);
  assert.equal(selectionResolved, false, 'setDriverSelection is genuinely blocked on the per-driver lock');

  await probe.query('BEGIN');
  const t0 = Date.now();
  await probe.query(`SELECT * FROM vehicle_driver_assignments WHERE id = $1 FOR UPDATE`, [assignment.id]);
  await probe.query(`SELECT * FROM vehicles WHERE id = $1 FOR UPDATE`, [vehicleId]);
  const probeElapsed = Date.now() - t0;
  assert.ok(probeElapsed < 500, `assignment + vehicle must be immediately lockable (took ${probeElapsed}ms) — setDriverSelection acquired nothing below the per-driver lock`);
  await probe.query('COMMIT');

  await holder.query('COMMIT'); // release the per-driver lock
  const result = await selectionPromise;
  assert.equal(selectionResolved, true, 'setDriverSelection completes once the per-driver lock is free');
  assert.deepEqual(result, { ok: true, code: 'SELECTED', selection: result.selection });
  assert.equal(result.selection.assignment_id, assignment.id);
});

test('PROOF 10c — many-trial openDriverShift / closeDriverShift vs setDriverSelection / clearDriverSelection: never a 40P01, always one coherent outcome', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: APP_CONFIG });
  const seed = new pg.Client({ connectionString: DATABASE_URL });
  await seed.connect();
  const seedDb = { query: (text, params) => seed.query(text, params) };

  const created = { shiftIds: [], driverIds: [], assignmentIds: [], vehicleIds: [], userIds: [] };
  t.after(async () => {
    await cleanupScenario(seed, created);
    await seed.end();
    await app.close();
  });

  const TRIALS = 8;
  for (let trial = 0; trial < TRIALS; trial += 1) {
    // Race A: openDriverShift vs setDriverSelection(switch), from the NONE-shift state.
    {
      const { owner, driver, vehicleId: vehA, assignment: assignA } = await seedSelectable(seedDb);
      const { vehicleId: vehB, assignment: assignB } = await addSecondAssignment(seedDb, { owner, driver });
      await setSelection(seedDb, { driverId: driver, assignmentId: assignA.id });
      created.driverIds.push(driver);
      created.assignmentIds.push(assignA.id, assignB.id);
      created.vehicleIds.push(vehA, vehB);
      created.userIds.push(owner, driver);

      const settled = await Promise.allSettled([
        openDriverShift(app.db, driver, usable),
        setDriverSelection(app.db, driver, { assignmentId: assignB.id }, usable),
      ]);
      for (const s of settled) {
        assert.notEqual(s.status === 'rejected' && s.reason && s.reason.code, '40P01', `trial ${trial} raceA: no deadlock`);
        assert.equal(s.status, 'fulfilled', `trial ${trial} raceA: no thrown error (${s.reason})`);
      }
      const shift = await findOpenShiftForDriver(seedDb, driver);
      if (shift) created.shiftIds.push(shift.id);
      const selection = await readSelection(seedDb, driver);
      assert.ok(shift && selection && shift.assignment_id === selection.assignment_id, `trial ${trial} raceA: coherent pin`);
    }

    // Race B: closeDriverShift vs setDriverSelection / clearDriverSelection, from an OPEN shift.
    {
      const { owner, driver, vehicleId: vehA, assignment: assignA } = await seedSelectable(seedDb);
      const { vehicleId: vehB, assignment: assignB } = await addSecondAssignment(seedDb, { owner, driver });
      await setSelection(seedDb, { driverId: driver, assignmentId: assignA.id });
      const opened = await openDriverShift(app.db, driver, usable);
      assert.equal(opened.ok, true);
      created.driverIds.push(driver);
      created.shiftIds.push(opened.shift.id);
      created.assignmentIds.push(assignA.id, assignB.id);
      created.vehicleIds.push(vehA, vehB);
      created.userIds.push(owner, driver);

      const mutate = trial % 2 === 0
        ? setDriverSelection(app.db, driver, { assignmentId: assignB.id }, usable)
        : clearDriverSelection(app.db, driver);
      const settled = await Promise.allSettled([closeDriverShift(app.db, driver), mutate]);
      for (const s of settled) {
        assert.notEqual(s.status === 'rejected' && s.reason && s.reason.code, '40P01', `trial ${trial} raceB: no deadlock`);
        assert.equal(s.status, 'fulfilled', `trial ${trial} raceB: no thrown error (${s.reason})`);
      }
      const [closeRes, mutateRes] = settled.map((s) => s.value);
      assert.equal(closeRes.ok, true, `trial ${trial} raceB: close always succeeds (no active ride)`);
      assert.equal(closeRes.code, 'CLOSED');
      // Either the mutation serialized BEFORE the close (saw the OPEN shift -> DRIVER_SHIFT_OPEN)
      // or AFTER it (shift already CLOSED -> the mutation proceeded).
      assert.ok(
        mutateRes.code === 'DRIVER_SHIFT_OPEN' || mutateRes.code === 'SELECTED' || mutateRes.code === 'CLEARED',
        `trial ${trial} raceB: mutation outcome is one of the coherent serial results (${JSON.stringify(mutateRes)})`,
      );
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// SERVER-FORCED PATH — reconcileAssignmentUnusableShift's post-close clearSelection is NOT
// routed through the driver-initiated guard and must stay unblocked.
// ─────────────────────────────────────────────────────────────────────────────────────────
test('server-forced clearSelection still works: a driver-initiated clear is DRIVER_SHIFT_OPEN, but reconcile CLOSED_AND_CLEANED clears the same selection', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, assignment } = await seedSelectable(db);
  await setSelection(db, { driverId: driver, assignmentId: assignment.id });
  const opened = await openDriverShift(db, driver, usable);
  assert.equal(opened.ok, true);
  await revokeAssignment(db, assignment.id); // pinned assignment is now confirmed UNUSABLE

  // Same state, opposite outcomes: the DRIVER is frozen out...
  const driverClear = await clearDriverSelection(db, driver);
  assert.deepEqual(driverClear, { ok: false, code: 'DRIVER_SHIFT_OPEN' });
  assert.ok(await readSelection(db, driver), 'selection still present after the blocked driver clear');

  // ...but the SERVER's own post-close cleanup clears it.
  const reconciled = await reconcileAssignmentUnusableShift(db, opened.shift.id, usable);
  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.code, 'CLOSED_AND_CLEANED');
  assert.equal(await readSelection(db, driver), null, 'server-forced cleanup cleared the stale selection');
});

test('server-forced path does not import the driver-initiated guard', { skip: SKIP }, () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'services', 'driver-shift-authority', 'index.js'),
    'utf8',
  );
  assert.ok(!src.includes('guardSelectionMutation'), 'shift-authority never references the selection guard');
  assert.ok(!src.includes('setDriverSelection') && !src.includes('clearDriverSelection'),
    'shift-authority never calls the driver-initiated selection-mutation service');
  assert.ok(!/from\s+['"][^'"]*driver-vehicle-assignment-authority/.test(src),
    'shift-authority does not import the selection-mutation service module');
  assert.ok(src.includes('clearSelection('), 'reconcile still calls the pure clearSelection primitive directly');
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Guard / usability code coverage — zero writes on every non-guard rejection too.
// ─────────────────────────────────────────────────────────────────────────────────────────
test('setDriverSelection: DRIVER_NOT_FOUND for an unknown driver id — zero writes', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { assignment } = await seedSelectable(db);
  const result = await setDriverSelection(db, randomUUID(), { assignmentId: assignment.id }, usable);
  assert.deepEqual(result, { ok: false, code: 'DRIVER_NOT_FOUND' });
});

test('setDriverSelection: ACTIVE_RIDE_PRESENT freezes selection during a non-terminal ride — zero writes', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, assignment } = await seedSelectable(db);
  await insertRide(db, { driverId: driver, status: 'IN_PROGRESS' });
  const result = await setDriverSelection(db, driver, { assignmentId: assignment.id }, usable);
  assert.deepEqual(result, { ok: false, code: 'ACTIVE_RIDE_PRESENT' });
  assert.equal(await readSelection(db, driver), null, 'no selection written');
});

test('setDriverSelection: default resolver -> ASSIGNMENT_STATE_UNKNOWN (fail-closed) — zero writes', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, assignment } = await seedSelectable(db);
  const result = await setDriverSelection(db, driver, { assignmentId: assignment.id }); // no opts
  assert.deepEqual(result, { ok: false, code: 'ASSIGNMENT_STATE_UNKNOWN' });
  assert.equal(await readSelection(db, driver), null);
});

test('setDriverSelection: ASSIGNMENT_UNUSABLE(REVOKED) — zero writes', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, assignment } = await seedSelectable(db);
  await revokeAssignment(db, assignment.id);
  const result = await setDriverSelection(db, driver, { assignmentId: assignment.id }, usable);
  assert.deepEqual(result, { ok: false, code: 'ASSIGNMENT_UNUSABLE', reason: 'REVOKED' });
  assert.equal(await readSelection(db, driver), null);
});

test('setDriverSelection: ASSIGNMENT_UNUSABLE(ENDED) — zero writes', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, assignment } = await seedSelectable(db);
  await endAssignment(db, assignment.id);
  const result = await setDriverSelection(db, driver, { assignmentId: assignment.id }, usable);
  assert.deepEqual(result, { ok: false, code: 'ASSIGNMENT_UNUSABLE', reason: 'ENDED' });
});

test('setDriverSelection: ASSIGNMENT_UNUSABLE(ARCHIVED) via the vehicle — zero writes', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, assignment } = await seedSelectable(db, { archived: true });
  const result = await setDriverSelection(db, driver, { assignmentId: assignment.id }, usable);
  assert.deepEqual(result, { ok: false, code: 'ASSIGNMENT_UNUSABLE', reason: 'ARCHIVED' });
});

test('setDriverSelection: ASSIGNMENT_DRIVER_MISMATCH when the assignment belongs to another driver', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { assignment } = await seedSelectable(db);
  const stranger = await insertUser(db);
  const result = await setDriverSelection(db, stranger, { assignmentId: assignment.id }, usable);
  assert.deepEqual(result, { ok: false, code: 'ASSIGNMENT_DRIVER_MISMATCH' });
});

test('setDriverSelection: ASSIGNMENT_NOT_FOUND for a non-existent assignment id', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver } = await seedSelectable(db);
  const result = await setDriverSelection(db, driver, { assignmentId: randomUUID() }, usable);
  assert.deepEqual(result, { ok: false, code: 'ASSIGNMENT_NOT_FOUND' });
});

test('clearDriverSelection: idempotent CLEARED when the driver is already in the NONE state', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver } = await seedSelectable(db);
  const result = await clearDriverSelection(db, driver);
  assert.equal(result.ok, true);
  assert.equal(result.code, 'CLEARED');
  assert.equal(result.cleared, null, 'nothing to delete — idempotent');
});

test('clearDriverSelection: DRIVER_NOT_FOUND for an unknown driver id', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const result = await clearDriverSelection(db, randomUUID());
  assert.deepEqual(result, { ok: false, code: 'DRIVER_NOT_FOUND' });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Shared lock proof — select/switch/clear take the SAME lockDriverAuthority(driverId) lock a
// shift open/close takes (Assignment Authority Invariant 6 / Shift Authority Invariant 2).
// ─────────────────────────────────────────────────────────────────────────────────────────
test('shared lock: a held per-driver authority lock blocks setDriverSelection until released', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: APP_CONFIG });
  const seed = new pg.Client({ connectionString: DATABASE_URL });
  await seed.connect();
  const seedDb = { query: (text, params) => seed.query(text, params) };
  const { owner, driver, vehicleId, assignment } = await seedSelectable(seedDb);

  const holder = new pg.Client({ connectionString: DATABASE_URL });
  await holder.connect();
  const holderDb = { query: (text, params) => holder.query(text, params) };

  t.after(async () => {
    await holder.query('ROLLBACK').catch(() => {});
    await holder.end();
    await cleanupScenario(seed, {
      driverIds: [driver], assignmentIds: [assignment.id], vehicleIds: [vehicleId], userIds: [owner, driver],
    });
    await seed.end();
    await app.close();
  });

  await holder.query('BEGIN');
  const lockedId = await lockDriverAuthority(holderDb, driver);
  assert.equal(lockedId, driver);

  let resolved = false;
  const p = setDriverSelection(app.db, driver, { assignmentId: assignment.id }, usable).then((r) => { resolved = true; return r; });
  await delay(300);
  assert.equal(resolved, false, 'setDriverSelection blocks on the same per-driver lock a shift open/close uses');

  await holder.query('COMMIT');
  const result = await p;
  assert.equal(resolved, true);
  assert.equal(result.code, 'SELECTED');
});
