// /server/test/vehicle-driver-assignment-authority.test.mjs — DB-gated coverage for
// BD-DRIVER-VEHICLE-ASSIGNMENT-AUTHORITY-01B (migration 0005 + repositories/
// vehicle_driver_assignments.js + repositories/driver_active_vehicle.js) against the frozen
// docs/driver-vehicle-assignment-authority-contract.md. SKIPPED without DATABASE_URL; runs in
// server-ci.
//
// Every schema/constraint/lifecycle/repository-primitive test runs inside its OWN
// transaction, ROLLED BACK in `t.after` (the auth-repositories.test.mjs pattern) — zero
// residue, safe to re-run, and each expected constraint VIOLATION gets its own transaction so
// one failing statement never poisons an unrelated assertion. The two concurrency tests
// (items 19-20) instead use TWO independent connections each holding their own transaction —
// a single shared/rolled-back transaction cannot exercise real cross-transaction row locking
// (the select-flow.test.mjs pattern, adapted to call repositories directly since 01B
// registers no HTTP route).
//
// No driver_shift table exists yet (a later slice) — these tests deliberately do not build
// or assume one; the per-driver authority lock is proven directly against `users`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

import {
  createAssignment, findAssignmentById, lockAssignmentById,
  lockAssignmentForEntitlementCheck, listAssignmentsForDriver,
  endAssignment, revokeAssignment,
} from '../src/repositories/vehicle_driver_assignments.js';
import {
  lockDriverAuthority, readSelection, setSelection, clearSelection,
} from '../src/repositories/driver_active_vehicle.js';
import { assignmentEntitledAt } from '../src/domain/vehicle-assignment.js';

const DATABASE_URL = process.env.DATABASE_URL || '';
const SKIP = DATABASE_URL ? false : 'DATABASE_URL not set';

const HOUR = 3_600_000;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Open a fresh connection, BEGIN, and register ROLLBACK + close on test completion. Returns
// a `db` shim with the same `.query(text, params)` shape every repository function expects.
async function beginTxn(t) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  await client.query('BEGIN');
  t.after(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  });
  return { query: (text, params) => client.query(text, params) };
}

async function insertUser(db) {
  const { rows } = await db.query(`INSERT INTO users DEFAULT VALUES RETURNING id`);
  return rows[0].id;
}

async function insertVehicle(db, ownerId, model = 'Test Car') {
  const { rows } = await db.query(
    `INSERT INTO vehicles (owner_user_id, model) VALUES ($1, $2) RETURNING id`,
    [ownerId, model],
  );
  return rows[0].id;
}

function assertRejectsWithPgCode(promise, code, messageMatch) {
  return assert.rejects(promise, (err) => {
    assert.equal(err.code, code, `expected pg error code ${code}, got ${err.code}: ${err.message}`);
    if (messageMatch) assert.match(err.message, messageMatch);
    return true;
  });
}

// ── 1. valid OWNER / RENTAL / FLEET rows ────────────────────────────────────
for (const assignmentType of ['OWNER', 'RENTAL', 'FLEET']) {
  test(`valid ${assignmentType} row inserts cleanly`, { skip: SKIP }, async (t) => {
    const db = await beginTxn(t);
    const owner = await insertUser(db);
    const driver = await insertUser(db);
    const vehicleId = await insertVehicle(db, owner);
    const row = await createAssignment(db, {
      vehicleId, driverId: driver, assignedByUserId: owner,
      assignmentType, startsAt: new Date(Date.now() - HOUR),
    });
    assert.equal(row.assignment_type, assignmentType);
    assert.equal(row.status, 'ACTIVE');
    assert.equal(row.terminated_at, null);
  });
}

// ── 2/3. FK integrity ────────────────────────────────────────────────────────
test('driver FK: a non-existent driver_id is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  await assertRejectsWithPgCode(
    createAssignment(db, {
      vehicleId, driverId: randomUUID(), assignedByUserId: owner,
      assignmentType: 'RENTAL', startsAt: new Date(),
    }),
    '23503',
  );
});

test('vehicle FK: a non-existent vehicle_id is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  await assertRejectsWithPgCode(
    createAssignment(db, {
      vehicleId: randomUUID(), driverId: driver, assignedByUserId: owner,
      assignmentType: 'RENTAL', startsAt: new Date(),
    }),
    '23503',
  );
});

// ── 4. actor XOR ─────────────────────────────────────────────────────────────
test('actor XOR: a server-owned procedure (assignedByServiceId only) is accepted', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  const row = await createAssignment(db, {
    vehicleId, driverId: driver, assignedByServiceId: 'ownership-onboarding',
    assignmentType: 'OWNER', startsAt: new Date(),
  });
  assert.equal(row.assigned_by_user_id, null);
  assert.equal(row.assigned_by_service_id, 'ownership-onboarding');
});

test('actor XOR: neither actor set is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  await assertRejectsWithPgCode(
    createAssignment(db, {
      vehicleId, driverId: driver, assignmentType: 'RENTAL', startsAt: new Date(),
    }),
    '23514', /actor_xor/,
  );
});

test('actor XOR: both actors set is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  await assertRejectsWithPgCode(
    createAssignment(db, {
      vehicleId, driverId: driver, assignedByUserId: owner, assignedByServiceId: 'svc',
      assignmentType: 'RENTAL', startsAt: new Date(),
    }),
    '23514', /actor_xor/,
  );
});

// ── 5. invalid temporal range ────────────────────────────────────────────────
test('window CHECK: ends_at equal to starts_at is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  const startsAt = new Date();
  await assertRejectsWithPgCode(
    createAssignment(db, {
      vehicleId, driverId: driver, assignedByUserId: owner,
      assignmentType: 'RENTAL', startsAt, endsAt: startsAt,
    }),
    '23514', /window_check/,
  );
});

// ends_at STRICTLY before starts_at is caught earlier than the CHECK constraint: the
// entitlement_window GENERATED column computes tstzrange(starts_at, ends_at, '[)') as part of
// the row's value construction, and PostgreSQL's own range constructor refuses a lower bound
// greater than the upper bound — a 22000 data exception, not our named 23514 CHECK. (The
// EQUAL case above does NOT hit this: tstzrange(x, x, '[)') is a valid, merely empty range, so
// construction succeeds and our window_check CHECK is what rejects it, with 23514.) Either
// way the row is rejected — this test pins the actually-observed code so a future PostgreSQL
// change to that behavior is caught, not silently masked by a loose assertion.
test('window CHECK: ends_at before starts_at is rejected (range construction fails first, 22000)', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  const startsAt = new Date();
  await assertRejectsWithPgCode(
    createAssignment(db, {
      vehicleId, driverId: driver, assignedByUserId: owner,
      assignmentType: 'RENTAL', startsAt, endsAt: new Date(startsAt.getTime() - HOUR),
    }),
    '22000',
  );
});

// ── 6. ACTIVE <=> terminated_at IS NULL lifecycle consistency ──────────────
// Exercised via a raw INSERT (not through createAssignment, which never lets the caller set
// status/terminated_at directly) — this proves the DB CHECK itself, independent of the repo.
test('lifecycle CHECK: ACTIVE with a non-null terminated_at is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  await assertRejectsWithPgCode(
    db.query(
      `INSERT INTO vehicle_driver_assignments
         (vehicle_id, driver_id, assigned_by_user_id, assignment_type, status, starts_at, terminated_at)
       VALUES ($1, $2, $3, 'RENTAL', 'ACTIVE', now(), now())`,
      [vehicleId, driver, owner],
    ),
    '23514', /active_iff_not_terminated/,
  );
});

test('lifecycle CHECK: a terminal status with a null terminated_at is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  await assertRejectsWithPgCode(
    db.query(
      `INSERT INTO vehicle_driver_assignments
         (vehicle_id, driver_id, assigned_by_user_id, assignment_type, status, starts_at, terminated_at)
       VALUES ($1, $2, $3, 'RENTAL', 'ENDED', now(), NULL)`,
      [vehicleId, driver, owner],
    ),
    '23514', /active_iff_not_terminated/,
  );
});

// ── 7/8. future starts_at / scheduled ends_at ───────────────────────────────
test('a future starts_at inserts fine but is not entitled yet (entitled_now = false)', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  const row = await createAssignment(db, {
    vehicleId, driverId: driver, assignedByUserId: owner,
    assignmentType: 'RENTAL', startsAt: new Date(Date.now() + 10 * HOUR),
  });
  const locked = await lockAssignmentForEntitlementCheck(db, row.id);
  assert.equal(locked.entitled_now, false);
});

test('a scheduled future ends_at inserts fine and is entitled now (window not yet elapsed)', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  const row = await createAssignment(db, {
    vehicleId, driverId: driver, assignedByUserId: owner,
    assignmentType: 'RENTAL', startsAt: new Date(Date.now() - HOUR), endsAt: new Date(Date.now() + 10 * HOUR),
  });
  const locked = await lockAssignmentForEntitlementCheck(db, row.id);
  assert.equal(locked.entitled_now, true);
});

// ── 9/10. early ENDED / early REVOKED before a future starts_at never inverts the window ──
for (const [label, terminate] of [['ENDED', endAssignment], ['REVOKED', revokeAssignment]]) {
  test(`early ${label}: terminating before a future starts_at is reached never inverts [starts_at, ends_at)`, { skip: SKIP }, async (t) => {
    const db = await beginTxn(t);
    const owner = await insertUser(db);
    const driver = await insertUser(db);
    const vehicleId = await insertVehicle(db, owner);
    const startsAt = new Date(Date.now() + 10 * HOUR);
    const endsAt = new Date(Date.now() + 20 * HOUR);
    const row = await createAssignment(db, {
      vehicleId, driverId: driver, assignedByUserId: owner,
      assignmentType: 'RENTAL', startsAt, endsAt,
    });
    const terminated = await terminate(db, row.id);
    assert.equal(terminated.status, label);
    assert.ok(terminated.terminated_at, 'terminated_at stamped');
    // ends_at keeps its ORIGINAL planned value — never rewritten to the termination instant.
    assert.equal(new Date(terminated.ends_at).getTime(), endsAt.getTime());
    assert.equal(new Date(terminated.starts_at).getTime(), startsAt.getTime());
    // and the row is not entitled (status is terminal — assignmentEntitledAt agrees).
    assert.equal(assignmentEntitledAt(
      { status: terminated.status, startsAt: new Date(terminated.starts_at), endsAt: new Date(terminated.ends_at) },
      new Date(),
    ), false);
    // double-terminate is a no-op (terminal is terminal; no ENDED/REVOKED -> ACTIVE).
    assert.equal(await terminate(db, row.id), null);
  });
}

// ── 11/12/13/14. non-overlap EXCLUDE constraint ─────────────────────────────
test('overlapping ACTIVE windows for the SAME (vehicle, driver) pair are rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  await createAssignment(db, {
    vehicleId, driverId: driver, assignedByUserId: owner,
    assignmentType: 'RENTAL', startsAt: new Date(Date.now() - HOUR), endsAt: new Date(Date.now() + 10 * HOUR),
  });
  await assertRejectsWithPgCode(
    createAssignment(db, {
      vehicleId, driverId: driver, assignedByUserId: owner,
      assignmentType: 'RENTAL', startsAt: new Date(Date.now() + 5 * HOUR), endsAt: new Date(Date.now() + 15 * HOUR),
    }),
    '23P01',
  );
});

test('non-overlapping (sequential) windows for the same pair are both accepted', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  await createAssignment(db, {
    vehicleId, driverId: driver, assignedByUserId: owner,
    assignmentType: 'RENTAL', startsAt: new Date(Date.now() - 10 * HOUR), endsAt: new Date(Date.now() + HOUR),
  });
  const second = await createAssignment(db, {
    vehicleId, driverId: driver, assignedByUserId: owner,
    assignmentType: 'RENTAL', startsAt: new Date(Date.now() + HOUR), endsAt: new Date(Date.now() + 5 * HOUR),
  });
  assert.ok(second.id, 'the second, disjoint-window grant is accepted');
});

test('a terminal (ENDED) historical row does not block a new overlapping grant for the same pair', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  const startsAt = new Date(Date.now() - HOUR);
  const endsAt = new Date(Date.now() + 10 * HOUR);
  const first = await createAssignment(db, {
    vehicleId, driverId: driver, assignedByUserId: owner,
    assignmentType: 'RENTAL', startsAt, endsAt,
  });
  await endAssignment(db, first.id);
  const second = await createAssignment(db, {
    vehicleId, driverId: driver, assignedByUserId: owner,
    assignmentType: 'RENTAL', startsAt, endsAt, // identical, fully overlapping window
  });
  assert.ok(second.id, 'a new grant over the same window succeeds once the old row is terminal');
});

test('different drivers may hold overlapping ACTIVE entitlements on the same vehicle', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driverA = await insertUser(db);
  const driverB = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  const startsAt = new Date(Date.now() - HOUR);
  const endsAt = new Date(Date.now() + 10 * HOUR);
  const a = await createAssignment(db, {
    vehicleId, driverId: driverA, assignedByUserId: owner, assignmentType: 'OWNER', startsAt, endsAt,
  });
  const b = await createAssignment(db, {
    vehicleId, driverId: driverB, assignedByUserId: owner, assignmentType: 'RENTAL', startsAt, endsAt,
  });
  assert.ok(a.id && b.id, 'the owner grant and a rental grant on the same vehicle coexist');
});

// ── 15. composite (assignment_id, driver_id) FK protects selection integrity ──
test('composite FK: selecting an assignment that belongs to a DIFFERENT driver is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driverA = await insertUser(db);
  const driverB = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  const assignment = await createAssignment(db, {
    vehicleId, driverId: driverA, assignedByUserId: owner,
    assignmentType: 'OWNER', startsAt: new Date(Date.now() - HOUR),
  });
  // driverB tries to select an assignment that is actually driverA's.
  await assertRejectsWithPgCode(
    setSelection(db, { driverId: driverB, assignmentId: assignment.id }),
    '23503',
  );
});

// ── 16. at most one selection per driver (switch overwrites, not duplicates) ──
test('at most one driver_active_vehicle row per driver: a switch overwrites, never duplicates', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  const vehicleA = await insertVehicle(db, owner, 'Car A');
  const vehicleB = await insertVehicle(db, owner, 'Car B');
  const assignA = await createAssignment(db, {
    vehicleId: vehicleA, driverId: driver, assignedByUserId: owner,
    assignmentType: 'OWNER', startsAt: new Date(Date.now() - HOUR),
  });
  const assignB = await createAssignment(db, {
    vehicleId: vehicleB, driverId: driver, assignedByUserId: owner,
    assignmentType: 'RENTAL', startsAt: new Date(Date.now() - HOUR),
  });
  await setSelection(db, { driverId: driver, assignmentId: assignA.id });
  await setSelection(db, { driverId: driver, assignmentId: assignB.id }); // switch
  const { rows } = await db.query(
    `SELECT assignment_id FROM driver_active_vehicle WHERE driver_id = $1`,
    [driver],
  );
  assert.equal(rows.length, 1, 'exactly one selection row survives the switch');
  assert.equal(rows[0].assignment_id, assignB.id, 'the switch, not the original pick, is current');
});

// ── 17. several drivers may select the same vehicle simultaneously ─────────
test('several entitled drivers may each select the same vehicle at the same time', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driverA = await insertUser(db);
  const driverB = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  const assignA = await createAssignment(db, {
    vehicleId, driverId: driverA, assignedByUserId: owner, assignmentType: 'OWNER', startsAt: new Date(Date.now() - HOUR),
  });
  const assignB = await createAssignment(db, {
    vehicleId, driverId: driverB, assignedByUserId: owner, assignmentType: 'RENTAL', startsAt: new Date(Date.now() - HOUR),
  });
  await setSelection(db, { driverId: driverA, assignmentId: assignA.id });
  await setSelection(db, { driverId: driverB, assignmentId: assignB.id });
  assert.equal((await readSelection(db, driverA)).assignment_id, assignA.id);
  assert.equal((await readSelection(db, driverB)).assignment_id, assignB.id);
});

// ── 18. the selected vehicle is DERIVED via the assignment, never stored directly ──
test('the selected vehicle is derived through assignment_id — driver_active_vehicle stores no vehicle_id', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  const assignment = await createAssignment(db, {
    vehicleId, driverId: driver, assignedByUserId: owner, assignmentType: 'OWNER', startsAt: new Date(Date.now() - HOUR),
  });
  await setSelection(db, { driverId: driver, assignmentId: assignment.id });
  const selection = await readSelection(db, driver);
  assert.ok(!('vehicle_id' in selection), 'no vehicle_id column on driver_active_vehicle');
  const { rows } = await db.query(
    `SELECT vda.vehicle_id
       FROM driver_active_vehicle dav
       JOIN vehicle_driver_assignments vda ON vda.id = dav.assignment_id
      WHERE dav.driver_id = $1`,
    [driver],
  );
  assert.equal(rows[0].vehicle_id, vehicleId, 'the derived vehicle resolves to the assignment\'s vehicle');

  // clearSelection is the NONE-state transition.
  const cleared = await clearSelection(db, driver);
  assert.equal(cleared.driver_id, driver);
  assert.equal(await readSelection(db, driver), null, 'selection is gone after clear');
});

// ── 19. the stable per-driver authority lock exists even in the NONE selection state ──
test('lockDriverAuthority succeeds for a driver with NO driver_active_vehicle row (the NONE state)', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const driver = await insertUser(db);
  assert.equal(await readSelection(db, driver), null, 'precondition: NONE state, no row');
  const lockedId = await lockDriverAuthority(db, driver);
  assert.equal(lockedId, driver, 'the lock is taken on users(id), which always exists');
});

// ── 20. concurrency regression: the per-driver authority lock genuinely serializes ──
test('two concurrent lockDriverAuthority calls for the SAME driver serialize (the second blocks until the first releases)', { skip: SKIP }, async (t) => {
  const clientA = new pg.Client({ connectionString: DATABASE_URL });
  const clientB = new pg.Client({ connectionString: DATABASE_URL });
  await clientA.connect();
  await clientB.connect();
  const dbA = { query: (text, params) => clientA.query(text, params) };
  const dbB = { query: (text, params) => clientB.query(text, params) };

  // seed the driver OUTSIDE either transaction so both sides see it.
  const seed = new pg.Client({ connectionString: DATABASE_URL });
  await seed.connect();
  const { rows } = await seed.query(`INSERT INTO users DEFAULT VALUES RETURNING id`);
  const driver = rows[0].id;

  t.after(async () => {
    await clientA.query('ROLLBACK').catch(() => {});
    await clientB.query('ROLLBACK').catch(() => {});
    await seed.query('DELETE FROM users WHERE id = $1', [driver]).catch(() => {});
    await clientA.end();
    await clientB.end();
    await seed.end();
  });

  await clientA.query('BEGIN');
  await lockDriverAuthority(dbA, driver); // A holds the lock.

  await clientB.query('BEGIN');
  let bResolved = false;
  const bPromise = lockDriverAuthority(dbB, driver).then((id) => { bResolved = true; return id; });

  await delay(300);
  assert.equal(bResolved, false, 'B must still be blocked while A holds the per-driver lock');

  await clientA.query('COMMIT'); // releases the lock.
  const bId = await bPromise;
  assert.equal(bResolved, true, 'B unblocks once A releases the lock');
  assert.equal(bId, driver);
  await clientB.query('COMMIT');
});

// ── extra: listAssignmentsForDriver + findAssignmentById / lockAssignmentById round-trip ──
test('listAssignmentsForDriver returns newest-first and honors an optional status filter', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  const vehicleA = await insertVehicle(db, owner, 'Car A');
  const vehicleB = await insertVehicle(db, owner, 'Car B');
  const older = await createAssignment(db, {
    vehicleId: vehicleA, driverId: driver, assignedByUserId: owner,
    assignmentType: 'OWNER', startsAt: new Date(Date.now() - 2 * HOUR),
  });
  await db.query(`UPDATE vehicle_driver_assignments SET created_at = now() - interval '1 hour' WHERE id = $1`, [older.id]);
  const newer = await createAssignment(db, {
    vehicleId: vehicleB, driverId: driver, assignedByUserId: owner,
    assignmentType: 'RENTAL', startsAt: new Date(Date.now() - HOUR),
  });
  await endAssignment(db, older.id);

  const all = await listAssignmentsForDriver(db, driver);
  assert.deepEqual(all.map((r) => r.id), [newer.id, older.id], 'newest created_at first');

  const activeOnly = await listAssignmentsForDriver(db, driver, { status: 'ACTIVE' });
  assert.deepEqual(activeOnly.map((r) => r.id), [newer.id]);

  const found = await findAssignmentById(db, newer.id);
  assert.equal(found.id, newer.id);
  const locked = await lockAssignmentById(db, newer.id);
  assert.equal(locked.id, newer.id);
});
