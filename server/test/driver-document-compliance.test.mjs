// /server/test/driver-document-compliance.test.mjs — DB-gated coverage for
// BD-DRIVER-DOCUMENT-COMPLIANCE-01B (rebuild): migration 0007
// (driver_document_lineages + driver_documents) + repositories/driver_document_compliance.js,
// against the frozen docs/driver-document-compliance-contract.md, built on top of the now-real
// docs/driver-shift-authority-contract.md (migration 0006). SKIPPED without DATABASE_URL; runs
// in server-ci.
//
// One isolation strategy throughout — beginTxn(t): one raw connection, BEGIN'd, ROLLED BACK
// in t.after. Its `db` shim's `.tx(fn)` runs fn against the SAME ambient connection (a
// pass-through, not a nested BEGIN) — this lets a test call the real
// services/driver-shift-authority functions (which internally call db.tx(...)) to seed a
// genuine OPEN driver_shift, while the whole scenario still rolls back cleanly as one unit,
// mirroring driver-shift-authority.test.mjs's own convention exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

import { createAssignment } from '../src/repositories/vehicle_driver_assignments.js';
import { setSelection } from '../src/repositories/driver_active_vehicle.js';
import { openDriverShift, closeDriverShift } from '../src/services/driver-shift-authority/index.js';
import {
  insertLineage, findLineageBySubject, lockLineageBySubject, findLineageById, lockLineageById,
  listLineagesForDriver, listLineagesForVehicle, listLineagesForShift,
  insertSubmission, findOpenSubmissionForLineage, lockOpenSubmissionForLineage,
  findLatestSubmissionForLineage, listSubmissionsForLineage, findSubmissionById, lockSubmissionById,
} from '../src/repositories/driver_document_compliance.js';

const DATABASE_URL = process.env.DATABASE_URL || '';
const SKIP = DATABASE_URL ? false : 'DATABASE_URL not set';

const HOUR = 3_600_000;
const usable = { resolveVehicleBlockState: async () => 'UNBLOCKED' };

// Open a fresh connection, BEGIN, and register ROLLBACK + close on test completion. The `db`
// shim's `.tx(fn)` runs fn against the SAME ambient connection — see file header.
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

// A full, ready-to-use scenario: owner + driver + vehicle + an ACTIVE, entitled assignment +
// a matching selection + a REAL OPEN driver_shift (via the actual openDriverShift service),
// giving every WAYBILL/MEDICAL_CHECK test a genuine, DB-backed shift_id to bind against —
// never a fabricated UUID.
async function seedOpenShift(db, { vehicleModel = 'Test Car' } = {}) {
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner, { model: vehicleModel });
  const assignment = await createAssignment(db, {
    vehicleId, driverId: driver, assignedByUserId: owner,
    assignmentType: 'OWNER', startsAt: new Date(Date.now() - HOUR),
  });
  await setSelection(db, { driverId: driver, assignmentId: assignment.id });
  const opened = await openDriverShift(db, driver, usable);
  assert.equal(opened.ok, true, 'seed shift must open cleanly');
  return { owner, driver, vehicleId, assignment, shift: opened.shift };
}

function assertRejectsWithPgCode(promise, code, messageMatch) {
  return assert.rejects(promise, (err) => {
    assert.equal(err.code, code, `expected pg error code ${code}, got ${err.code}: ${err.message}`);
    if (messageMatch) assert.match(err.message, messageMatch);
    return true;
  });
}

// ── 1. schema: additive composite keys on driver_shift coexist with 0006's own key ─────────
test('0007: additive composite keys on driver_shift coexist with 0006\'s own composite FK target', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { rows } = await db.query(
    `SELECT conname, contype FROM pg_constraint pc JOIN pg_class c ON c.oid = pc.conrelid
      WHERE c.relname = 'driver_shift'
        AND conname IN ('driver_shift_assignment_driver_vehicle_fkey', 'driver_shift_id_driver_uq', 'driver_shift_id_driver_vehicle_uq')
      ORDER BY conname`,
  );
  assert.deepEqual(rows, [
    { conname: 'driver_shift_assignment_driver_vehicle_fkey', contype: 'f' },
    { conname: 'driver_shift_id_driver_uq', contype: 'u' },
    { conname: 'driver_shift_id_driver_vehicle_uq', contype: 'u' },
  ]);
});

// ── 2. subject-shape CHECK: exactly the right columns per document_type ────────────────────
test('subject-shape CHECK: DRIVER_LICENSE with a vehicle_id is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  await assertRejectsWithPgCode(
    insertLineage(db, { documentType: 'DRIVER_LICENSE', driverId: driver, vehicleId }),
    '23514', /driver_document_lineages_subject_shape_check/,
  );
});

test('subject-shape CHECK: DRIVER_LICENSE with no driver_id is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  await assertRejectsWithPgCode(
    insertLineage(db, { documentType: 'DRIVER_LICENSE' }),
    '23514', /driver_document_lineages_subject_shape_check/,
  );
});

test('subject-shape CHECK: TAXI_OSAGO with a driver_id is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  await assertRejectsWithPgCode(
    insertLineage(db, { documentType: 'TAXI_OSAGO', driverId: driver, vehicleId }),
    '23514', /driver_document_lineages_subject_shape_check/,
  );
});

test('subject-shape CHECK: TAXI_REGISTRY with no vehicle_id is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  await assertRejectsWithPgCode(
    insertLineage(db, { documentType: 'TAXI_REGISTRY' }),
    '23514', /driver_document_lineages_subject_shape_check/,
  );
});

test('subject-shape CHECK: WAYBILL missing shift_id is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const driver = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  await assertRejectsWithPgCode(
    insertLineage(db, { documentType: 'WAYBILL', driverId: driver, vehicleId }),
    '23514', /driver_document_lineages_subject_shape_check/,
  );
});

test('subject-shape CHECK: MEDICAL_CHECK with a vehicle_id is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, shift } = await seedOpenShift(db);
  await assertRejectsWithPgCode(
    insertLineage(db, { documentType: 'MEDICAL_CHECK', driverId: driver, vehicleId, shiftId: shift.id }),
    '23514', /driver_document_lineages_subject_shape_check/,
  );
});

test('subject-shape CHECK: an unknown document_type is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const driver = await insertUser(db);
  await assertRejectsWithPgCode(
    insertLineage(db, { documentType: 'BOGUS_TYPE', driverId: driver }),
    '23514', /driver_document_lineages_document_type_check/,
  );
});

// ── 3. composite FK: pinned-identity proof against a REAL driver_shift row ─────────────────
test('composite FK: WAYBILL cannot be linked to a shift belonging to a DIFFERENT driver', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { vehicleId, shift } = await seedOpenShift(db);
  const otherDriver = await insertUser(db);
  await assertRejectsWithPgCode(
    insertLineage(db, { documentType: 'WAYBILL', driverId: otherDriver, vehicleId, shiftId: shift.id }),
    '23503', /driver_document_lineages_shift_driver_fkey/,
  );
});

test('composite FK: WAYBILL cannot be linked to a vehicle other than the shift\'s own pinned vehicle', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, owner, shift } = await seedOpenShift(db);
  const wrongVehicle = await insertVehicle(db, owner, { model: 'Wrong Car' });
  await assertRejectsWithPgCode(
    insertLineage(db, { documentType: 'WAYBILL', driverId: driver, vehicleId: wrongVehicle, shiftId: shift.id }),
    '23503', /driver_document_lineages_shift_driver_vehicle_fkey/,
  );
});

test('composite FK: MEDICAL_CHECK cannot be linked to a shift belonging to a DIFFERENT driver', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { shift } = await seedOpenShift(db);
  const otherDriver = await insertUser(db);
  await assertRejectsWithPgCode(
    insertLineage(db, { documentType: 'MEDICAL_CHECK', driverId: otherDriver, shiftId: shift.id }),
    '23503', /driver_document_lineages_shift_driver_fkey/,
  );
});

test('composite FK: WAYBILL cannot be linked to a shift_id that does not exist at all', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId } = await seedOpenShift(db);
  // Both composite FKs (the 2-column shift_driver_fkey and the 3-column
  // shift_driver_vehicle_fkey) are violated by a wholly nonexistent shift_id — which one
  // PostgreSQL reports first is an implementation-defined constraint-check-order detail, not
  // a contract this test should pin. Either name is a correct rejection.
  await assertRejectsWithPgCode(
    insertLineage(db, { documentType: 'WAYBILL', driverId: driver, vehicleId, shiftId: randomUUID() }),
    '23503', /driver_document_lineages_shift_driver(_vehicle)?_fkey/,
  );
});

test('composite FK: happy path — WAYBILL correctly pinned to the real OPEN shift is accepted', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, shift } = await seedOpenShift(db);
  const lineage = await insertLineage(db, { documentType: 'WAYBILL', driverId: driver, vehicleId, shiftId: shift.id });
  assert.equal(lineage.driver_id, driver);
  assert.equal(lineage.vehicle_id, vehicleId);
  assert.equal(lineage.shift_id, shift.id);
});

test('composite FK: happy path — MEDICAL_CHECK correctly pinned to the real OPEN shift is accepted', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, shift } = await seedOpenShift(db);
  const lineage = await insertLineage(db, { documentType: 'MEDICAL_CHECK', driverId: driver, shiftId: shift.id });
  assert.equal(lineage.driver_id, driver);
  assert.equal(lineage.vehicle_id, null);
  assert.equal(lineage.shift_id, shift.id);
});

// ── 4. no false cross-shift collision: two different shift instances, same driver ─────────
test('two DIFFERENT driver_shift.id values for the SAME driver each carry independent WAYBILL/MEDICAL_CHECK lineages', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, owner, vehicleId: vehicleA, shift: shiftA } = await seedOpenShift(db, { vehicleModel: 'Car A' });
  const waybillA = await insertLineage(db, { documentType: 'WAYBILL', driverId: driver, vehicleId: vehicleA, shiftId: shiftA.id });
  const medA = await insertLineage(db, { documentType: 'MEDICAL_CHECK', driverId: driver, shiftId: shiftA.id });

  // Exclusivity (0006): only one OPEN shift per driver at a time — close A before B can open.
  const closedA = await closeDriverShift(db, driver);
  assert.equal(closedA.ok, true);

  const vehicleB = await insertVehicle(db, owner, { model: 'Car B' });
  const assignmentB = await createAssignment(db, {
    vehicleId: vehicleB, driverId: driver, assignedByUserId: owner,
    assignmentType: 'RENTAL', startsAt: new Date(Date.now() - HOUR),
  });
  await setSelection(db, { driverId: driver, assignmentId: assignmentB.id });
  const openedB = await openDriverShift(db, driver, usable);
  assert.equal(openedB.ok, true);
  const shiftB = openedB.shift;
  assert.notEqual(shiftB.id, shiftA.id);

  const waybillB = await insertLineage(db, { documentType: 'WAYBILL', driverId: driver, vehicleId: vehicleB, shiftId: shiftB.id });
  const medB = await insertLineage(db, { documentType: 'MEDICAL_CHECK', driverId: driver, shiftId: shiftB.id });

  assert.notEqual(waybillA.id, waybillB.id, 'independent WAYBILL lineage per shift instance');
  assert.notEqual(medA.id, medB.id, 'independent MEDICAL_CHECK lineage per shift instance');
  assert.equal(waybillA.shift_id, shiftA.id);
  assert.equal(waybillB.shift_id, shiftB.id);
});

// ── 5. uniqueness: at most one lineage per subject tuple per type ──────────────────────────
test('uniqueness: a second DRIVER_LICENSE lineage for the SAME driver is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const driver = await insertUser(db);
  await insertLineage(db, { documentType: 'DRIVER_LICENSE', driverId: driver });
  await assertRejectsWithPgCode(
    insertLineage(db, { documentType: 'DRIVER_LICENSE', driverId: driver }),
    '23505', /driver_document_lineages_driver_license_uq/,
  );
});

test('uniqueness: a DIFFERENT driver can still create their own DRIVER_LICENSE lineage', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const driverA = await insertUser(db);
  const driverB = await insertUser(db);
  const a = await insertLineage(db, { documentType: 'DRIVER_LICENSE', driverId: driverA });
  const b = await insertLineage(db, { documentType: 'DRIVER_LICENSE', driverId: driverB });
  assert.notEqual(a.id, b.id);
});

test('uniqueness: a second TAXI_OSAGO lineage for the SAME vehicle is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  await insertLineage(db, { documentType: 'TAXI_OSAGO', vehicleId });
  await assertRejectsWithPgCode(
    insertLineage(db, { documentType: 'TAXI_OSAGO', vehicleId }),
    '23505', /driver_document_lineages_taxi_osago_uq/,
  );
});

test('uniqueness: a second TAXI_REGISTRY lineage for the SAME vehicle is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  await insertLineage(db, { documentType: 'TAXI_REGISTRY', vehicleId });
  await assertRejectsWithPgCode(
    insertLineage(db, { documentType: 'TAXI_REGISTRY', vehicleId }),
    '23505', /driver_document_lineages_taxi_registry_uq/,
  );
});

test('uniqueness: TAXI_OSAGO and TAXI_REGISTRY for the SAME vehicle do not collide with each other', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  const osago = await insertLineage(db, { documentType: 'TAXI_OSAGO', vehicleId });
  const registry = await insertLineage(db, { documentType: 'TAXI_REGISTRY', vehicleId });
  assert.notEqual(osago.id, registry.id);
});

test('uniqueness: a second WAYBILL lineage for the SAME (driver, vehicle, shift) tuple is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, shift } = await seedOpenShift(db);
  await insertLineage(db, { documentType: 'WAYBILL', driverId: driver, vehicleId, shiftId: shift.id });
  await assertRejectsWithPgCode(
    insertLineage(db, { documentType: 'WAYBILL', driverId: driver, vehicleId, shiftId: shift.id }),
    '23505', /driver_document_lineages_waybill_uq/,
  );
});

test('uniqueness: a second MEDICAL_CHECK lineage for the SAME (driver, shift) tuple is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, shift } = await seedOpenShift(db);
  await insertLineage(db, { documentType: 'MEDICAL_CHECK', driverId: driver, shiftId: shift.id });
  await assertRejectsWithPgCode(
    insertLineage(db, { documentType: 'MEDICAL_CHECK', driverId: driver, shiftId: shift.id }),
    '23505', /driver_document_lineages_medical_check_uq/,
  );
});

// ── 6. uniqueness: at most one OPEN submission per lineage ─────────────────────────────────
test('uniqueness: a lineage cannot have two simultaneous OPEN submissions', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const driver = await insertUser(db);
  const lineage = await insertLineage(db, { documentType: 'DRIVER_LICENSE', driverId: driver });
  await insertSubmission(db, { lineageId: lineage.id, status: 'UPLOADED' });
  await assertRejectsWithPgCode(
    insertSubmission(db, { lineageId: lineage.id, status: 'VERIFYING' }),
    '23505', /driver_documents_one_open_per_lineage_uq/,
  );
});

for (const openStatus of ['UPLOADED', 'VERIFYING', 'APPROVED']) {
  test(`uniqueness: '${openStatus}' counts as OPEN and blocks a second open submission`, { skip: SKIP }, async (t) => {
    const db = await beginTxn(t);
    const driver = await insertUser(db);
    const lineage = await insertLineage(db, { documentType: 'DRIVER_LICENSE', driverId: driver });
    await insertSubmission(db, { lineageId: lineage.id, status: openStatus });
    await assertRejectsWithPgCode(
      insertSubmission(db, { lineageId: lineage.id, status: 'UPLOADED' }),
      '23505', /driver_documents_one_open_per_lineage_uq/,
    );
  });
}

for (const closedStatus of ['VALID', 'EXPIRING', 'REJECTED', 'EXPIRED', 'SUPERSEDED', 'REVOKED']) {
  test(`a '${closedStatus}' submission does NOT count as open — a new attempt is accepted`, { skip: SKIP }, async (t) => {
    const db = await beginTxn(t);
    const driver = await insertUser(db);
    const lineage = await insertLineage(db, { documentType: 'DRIVER_LICENSE', driverId: driver });
    await insertSubmission(db, { lineageId: lineage.id, status: closedStatus });
    const second = await insertSubmission(db, { lineageId: lineage.id, status: 'UPLOADED' });
    assert.equal(second.status, 'UPLOADED');
  });
}

test('driver_documents status CHECK: an unknown status is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const driver = await insertUser(db);
  const lineage = await insertLineage(db, { documentType: 'DRIVER_LICENSE', driverId: driver });
  await assertRejectsWithPgCode(
    insertSubmission(db, { lineageId: lineage.id, status: 'MISSING' }),
    '23514', /driver_documents_status_check/,
  );
});

// ── 7. uniqueness: supersedes_id may be claimed by at most one successor ──────────────────
test('uniqueness: a supersedes_id value cannot be reused by a second document', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const driver = await insertUser(db);
  const lineage = await insertLineage(db, { documentType: 'DRIVER_LICENSE', driverId: driver });
  const original = await insertSubmission(db, { lineageId: lineage.id, status: 'SUPERSEDED' });
  await insertSubmission(db, { lineageId: lineage.id, status: 'VALID', supersedesId: original.id });
  await assertRejectsWithPgCode(
    insertSubmission(db, { lineageId: lineage.id, status: 'REJECTED', supersedesId: original.id }),
    '23505', /driver_documents_supersedes_id_key/,
  );
});

test('multiple documents with a NULL supersedes_id do not collide (NULL is not reuse)', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const driver = await insertUser(db);
  const lineage = await insertLineage(db, { documentType: 'DRIVER_LICENSE', driverId: driver });
  const a = await insertSubmission(db, { lineageId: lineage.id, status: 'REJECTED' });
  const b = await insertSubmission(db, { lineageId: lineage.id, status: 'UPLOADED' });
  assert.equal(a.supersedes_id, null);
  assert.equal(b.supersedes_id, null);
});

// ── 8. history RESTRICT: no cascade can erase compliance history ──────────────────────────
test('history RESTRICT: deleting a lineage referenced by a driver_documents row is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const driver = await insertUser(db);
  const lineage = await insertLineage(db, { documentType: 'DRIVER_LICENSE', driverId: driver });
  await insertSubmission(db, { lineageId: lineage.id });
  await assertRejectsWithPgCode(db.query(`DELETE FROM driver_document_lineages WHERE id = $1`, [lineage.id]), '23503');
});

test('history RESTRICT: deleting a driver referenced by a lineage is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const driver = await insertUser(db);
  await insertLineage(db, { documentType: 'DRIVER_LICENSE', driverId: driver });
  await assertRejectsWithPgCode(db.query(`DELETE FROM users WHERE id = $1`, [driver]), '23503');
});

test('history RESTRICT: deleting a vehicle referenced by a lineage is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const owner = await insertUser(db);
  const vehicleId = await insertVehicle(db, owner);
  await insertLineage(db, { documentType: 'TAXI_OSAGO', vehicleId });
  await assertRejectsWithPgCode(db.query(`DELETE FROM vehicles WHERE id = $1`, [vehicleId]), '23503');
});

test('history RESTRICT: deleting a driver_shift row referenced by a WAYBILL lineage is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, shift } = await seedOpenShift(db);
  await insertLineage(db, { documentType: 'WAYBILL', driverId: driver, vehicleId, shiftId: shift.id });
  await assertRejectsWithPgCode(db.query(`DELETE FROM driver_shift WHERE id = $1`, [shift.id]), '23503');
});

test('history RESTRICT: deleting a driver_shift row referenced by a MEDICAL_CHECK lineage is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, shift } = await seedOpenShift(db);
  await insertLineage(db, { documentType: 'MEDICAL_CHECK', driverId: driver, shiftId: shift.id });
  await assertRejectsWithPgCode(db.query(`DELETE FROM driver_shift WHERE id = $1`, [shift.id]), '23503');
});

test('history RESTRICT: deleting a document referenced as a supersedes_id target is rejected', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const driver = await insertUser(db);
  const lineage = await insertLineage(db, { documentType: 'DRIVER_LICENSE', driverId: driver });
  const original = await insertSubmission(db, { lineageId: lineage.id, status: 'SUPERSEDED' });
  await insertSubmission(db, { lineageId: lineage.id, status: 'VALID', supersedesId: original.id });
  await assertRejectsWithPgCode(db.query(`DELETE FROM driver_documents WHERE id = $1`, [original.id]), '23503');
});

// ── 9. THE critical adversarial proof: closing a shift never touches compliance history ────
test('closing a shift does not delete or orphan any document_lineages/documents row', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, shift } = await seedOpenShift(db);
  const waybillLineage = await insertLineage(db, { documentType: 'WAYBILL', driverId: driver, vehicleId, shiftId: shift.id });
  const waybillDoc = await insertSubmission(db, {
    lineageId: waybillLineage.id, status: 'UPLOADED', objectKey: 'waybill.png',
  });
  const medLineage = await insertLineage(db, { documentType: 'MEDICAL_CHECK', driverId: driver, shiftId: shift.id });
  const medDoc = await insertSubmission(db, { lineageId: medLineage.id, status: 'VALID' });

  const before = {
    lineages: (await db.query(`SELECT * FROM driver_document_lineages WHERE shift_id = $1 ORDER BY id`, [shift.id])).rows,
    docs: (await db.query(
      `SELECT d.* FROM driver_documents d JOIN driver_document_lineages l ON l.id = d.lineage_id WHERE l.shift_id = $1 ORDER BY d.id`,
      [shift.id],
    )).rows,
  };
  assert.equal(before.lineages.length, 2, 'both lineages exist before close');
  assert.equal(before.docs.length, 2, 'both documents exist before close');

  const closed = await closeDriverShift(db, driver);
  assert.equal(closed.ok, true);
  assert.equal(closed.code, 'CLOSED');
  assert.equal(closed.shift.status, 'CLOSED');

  const after = {
    lineages: (await db.query(`SELECT * FROM driver_document_lineages WHERE shift_id = $1 ORDER BY id`, [shift.id])).rows,
    docs: (await db.query(
      `SELECT d.* FROM driver_documents d JOIN driver_document_lineages l ON l.id = d.lineage_id WHERE l.shift_id = $1 ORDER BY d.id`,
      [shift.id],
    )).rows,
  };

  assert.deepEqual(after.lineages, before.lineages, 'lineage rows byte-for-byte untouched by shift close');
  assert.deepEqual(after.docs, before.docs, 'document rows byte-for-byte untouched by shift close');
  assert.equal(after.lineages.length, 2, 'no lineage row was deleted or orphaned');
  assert.equal(after.docs.length, 2, 'no document row was deleted or orphaned');
  assert.equal(waybillDoc.lineage_id, waybillLineage.id);
  assert.equal(medDoc.lineage_id, medLineage.id);
});

// ── 10. repository primitives round-trip ────────────────────────────────────────────────────
test('driver_document_compliance.js primitives: lineage find/lock/list round-trip', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const driver = await insertUser(db);
  assert.equal(await findLineageBySubject(db, { documentType: 'DRIVER_LICENSE', driverId: driver }), null);
  assert.equal(await lockLineageBySubject(db, { documentType: 'DRIVER_LICENSE', driverId: driver }), null);
  assert.equal(await findLineageById(db, randomUUID()), null);

  const lineage = await insertLineage(db, { documentType: 'DRIVER_LICENSE', driverId: driver });
  assert.equal((await findLineageBySubject(db, { documentType: 'DRIVER_LICENSE', driverId: driver })).id, lineage.id);
  assert.equal((await lockLineageBySubject(db, { documentType: 'DRIVER_LICENSE', driverId: driver })).id, lineage.id);
  assert.equal((await findLineageById(db, lineage.id)).id, lineage.id);
  assert.equal((await lockLineageById(db, lineage.id)).id, lineage.id);

  const forDriver = await listLineagesForDriver(db, driver);
  assert.equal(forDriver.length, 1);
  assert.equal(forDriver[0].id, lineage.id);
});

test('driver_document_compliance.js primitives: lineage list-by-vehicle / list-by-shift', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { driver, vehicleId, shift } = await seedOpenShift(db);
  const waybill = await insertLineage(db, { documentType: 'WAYBILL', driverId: driver, vehicleId, shiftId: shift.id });
  const osago = await insertLineage(db, { documentType: 'TAXI_OSAGO', vehicleId });

  const forVehicle = await listLineagesForVehicle(db, vehicleId);
  assert.equal(forVehicle.length, 2);
  assert.deepEqual(new Set(forVehicle.map((l) => l.id)), new Set([waybill.id, osago.id]));

  const forShift = await listLineagesForShift(db, shift.id);
  assert.equal(forShift.length, 1);
  assert.equal(forShift[0].id, waybill.id);

  assert.deepEqual(await listLineagesForShift(db, randomUUID()), []);
});

test('driver_document_compliance.js primitives: submission find/lock/list round-trip', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const driver = await insertUser(db);
  const lineage = await insertLineage(db, { documentType: 'DRIVER_LICENSE', driverId: driver });

  assert.equal(await findOpenSubmissionForLineage(db, lineage.id), null);
  assert.equal(await lockOpenSubmissionForLineage(db, lineage.id), null);
  assert.equal(await findLatestSubmissionForLineage(db, lineage.id), null, 'null, not a synthetic MISSING row');
  assert.deepEqual(await listSubmissionsForLineage(db, lineage.id), []);

  const first = await insertSubmission(db, { lineageId: lineage.id });
  assert.equal(first.status, 'UPLOADED', 'default status');
  assert.equal((await findOpenSubmissionForLineage(db, lineage.id)).id, first.id);
  assert.equal((await lockOpenSubmissionForLineage(db, lineage.id)).id, first.id);
  assert.equal((await findLatestSubmissionForLineage(db, lineage.id)).id, first.id);
  assert.equal((await findSubmissionById(db, first.id)).id, first.id);
  assert.equal((await lockSubmissionById(db, first.id)).id, first.id);
  assert.equal(await findSubmissionById(db, randomUUID()), null);

  // Move the first attempt out of the open set so a second attempt is accepted.
  await db.query(`UPDATE driver_documents SET status = 'REJECTED' WHERE id = $1`, [first.id]);
  const second = await insertSubmission(db, { lineageId: lineage.id, status: 'UPLOADED' });
  // now() is transaction-scoped (stable for the whole ambient BEGIN this test runs in), so
  // `first` and `second` can share an identical created_at — push `first`'s created_at
  // genuinely earlier so "latest by (created_at, id)" is exercised deterministically by real
  // chronological order, not tie-broken by an effectively random UUID comparison.
  await db.query(`UPDATE driver_documents SET created_at = created_at - interval '1 hour' WHERE id = $1`, [first.id]);

  assert.equal((await findOpenSubmissionForLineage(db, lineage.id)).id, second.id, 'only the newer attempt is open');
  assert.equal((await findLatestSubmissionForLineage(db, lineage.id)).id, second.id, 'latest by (created_at, id), not by status');

  const all = await listSubmissionsForLineage(db, lineage.id);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((r) => r.id), [first.id, second.id], 'full history, oldest first, rejected attempt included');
});

test('driver_document_compliance.js primitives: insertSubmission carries every lifecycle field through', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const driver = await insertUser(db);
  const lineage = await insertLineage(db, { documentType: 'DRIVER_LICENSE', driverId: driver });
  const validFrom = new Date(Date.now() - HOUR);
  const validUntil = new Date(Date.now() + 1000 * HOUR);
  const doc = await insertSubmission(db, {
    lineageId: lineage.id,
    status: 'VALID',
    objectKey: 'license.png',
    issuedAt: validFrom,
    validFrom,
    validUntil,
    verifiedAt: new Date(),
    verificationSource: 'MANUAL_OPS',
    verificationReason: null,
  });
  assert.equal(doc.object_key, 'license.png');
  assert.equal(doc.verification_source, 'MANUAL_OPS');
  assert.ok(doc.valid_from);
  assert.ok(doc.valid_until);
  assert.ok(doc.verified_at);
  assert.ok(doc.created_at);
  assert.ok(doc.updated_at);
});
