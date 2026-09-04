// /server/src/repositories/vehicle_driver_assignments.js — the ONLY module that runs SQL
// against `vehicle_driver_assignments` (migration 0005). Single SQL seam (ADR BD-DOCS-041).
// BD-DRIVER-VEHICLE-ASSIGNMENT-AUTHORITY-01B, per the frozen
// docs/driver-vehicle-assignment-authority-contract.md. No HTTP assumptions — every function
// takes a plain `db` (or a transaction client with the same `.query` shape) and returns raw
// rows; a future 01C route layer maps these to its own request/response shapes.
//
// Actor XOR, the temporal window CHECK, the ACTIVE<=>terminated_at CHECK, and the
// non-overlapping-entitlement-window EXCLUDE constraint are all enforced by migration 0005 —
// this module does not re-validate them in JS; a violating INSERT/UPDATE throws a pg error
// (23505 unique_violation for the composite UNIQUE, 23P01 exclusion_violation for the
// EXCLUDE, 23514 check_violation for the CHECKs) and the caller decides how to surface it.

// Create a new entitlement grant. Exactly one of assignedByUserId / assignedByServiceId must
// be supplied — the DB's actor-XOR CHECK is the final arbiter (contract: the client sets
// neither field directly; the SERVER resolves the actor before calling this). endsAt may be
// omitted (open-ended) or a Date strictly after startsAt (DB window CHECK).
//
// This is a low-level repository primitive only. It performs NO
// OWNER / RENTAL / FLEET authorization check; the calling server service
// must resolve and authorize the actor before invoking this function.
export async function createAssignment(db, {
  vehicleId, driverId, assignedByUserId = null, assignedByServiceId = null,
  assignmentType, startsAt, endsAt = null,
}) {
  const { rows } = await db.query(
    `INSERT INTO vehicle_driver_assignments
       (vehicle_id, driver_id, assigned_by_user_id, assigned_by_service_id,
        assignment_type, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [vehicleId, driverId, assignedByUserId, assignedByServiceId, assignmentType, startsAt, endsAt],
  );
  return rows[0];
}

// Plain read by id — no lock. Use lockAssignmentById / lockAssignmentForEntitlementCheck
// inside a transaction that is about to act on the row (select / switch / a future
// shift-open).
export async function findAssignmentById(db, id) {
  const { rows } = await db.query(
    `SELECT * FROM vehicle_driver_assignments WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

// Lock the assignment row (SELECT ... FOR UPDATE) inside a transaction — the contract's
// selection-mutation and shift-open sequences both lock the selected assignment before
// asserting usability (docs/driver-vehicle-assignment-authority-contract.md
// "Selection-mutation sequence" step 4, "Opening a shift"). Callers must already hold the
// per-driver authority lock (driver_active_vehicle.lockDriverAuthority) FIRST — Invariant 6's
// lock order is per-driver lock -> assignment -> vehicle.
export async function lockAssignmentById(db, id) {
  const { rows } = await db.query(
    `SELECT * FROM vehicle_driver_assignments WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0] ?? null;
}

// Lock the assignment row AND compute assignmentEntitledAt(now()) authoritatively inside
// PostgreSQL — the boolean is derived from the DATABASE's own now(), never a JS Date, so
// there is no app/DB clock-skew window between "read" and "decide" (mirrors the rides.js
// pg_* computed-flag convention, e.g. lockConflictRideForSelection). This is the ENTITLEMENT
// half only (status / starts_at / ends_at) — the operational half (vehicle.archived +
// vehicleBlockState(t)) has no storage yet in 01B (see domain/vehicle-assignment.js header);
// a caller composing the full tri-state usability decision must still separately check
// vehicle.archived and consult whatever future block-state source 01C wires in.
export async function lockAssignmentForEntitlementCheck(db, id) {
  const { rows } = await db.query(
    `SELECT *,
            (status = 'ACTIVE' AND starts_at <= now()
              AND (ends_at IS NULL OR now() < ends_at)) AS entitled_now
       FROM vehicle_driver_assignments
      WHERE id = $1
      FOR UPDATE`,
    [id],
  );
  return rows[0] ?? null;
}

// List a driver's assignments, optionally filtered to one lifecycle status
// ('ACTIVE' | 'ENDED' | 'REVOKED'). Newest-created first.
export async function listAssignmentsForDriver(db, driverId, { status } = {}) {
  if (status != null) {
    const { rows } = await db.query(
      `SELECT * FROM vehicle_driver_assignments
        WHERE driver_id = $1 AND status = $2
        ORDER BY created_at DESC`,
      [driverId, status],
    );
    return rows;
  }
  const { rows } = await db.query(
    `SELECT * FROM vehicle_driver_assignments
      WHERE driver_id = $1
      ORDER BY created_at DESC`,
    [driverId],
  );
  return rows;
}

// Terminal lifecycle transition, ACTIVE -> ENDED | REVOKED. Guarded by status = 'ACTIVE' in
// the WHERE clause (belt-and-braces on top of any row lock the caller already holds) so a
// double-terminate is a no-op returning null — matches the repo convention in
// orders.markOrderAccepted / otps.markOtpConsumed. There is no ENDED/REVOKED -> ACTIVE
// transition (contract "Assignment lifecycle": terminal is terminal; a renewed entitlement
// is a NEW row), so this function only ever writes the terminal status once per row.
async function terminateAssignment(db, id, status) {
  const { rows } = await db.query(
    `UPDATE vehicle_driver_assignments
        SET status = $2, terminated_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'ACTIVE'
      RETURNING *`,
    [id, status],
  );
  return rows[0] ?? null;
}

// Window closed normally (rental term over, driver left the fleet).
export function endAssignment(db, id) {
  return terminateAssignment(db, id, 'ENDED');
}

// Terminated out-of-band (dispute, fraud, safety) — takes effect immediately, same base
// policy as endAssignment; REVOKED additionally permits a higher-severity safety signal to
// Driver Availability at the runtime layer (contract "An assignment becomes unusable during
// an OPEN shift"), which is out of scope for this repository module.
export function revokeAssignment(db, id) {
  return terminateAssignment(db, id, 'REVOKED');
}
