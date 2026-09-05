// /server/src/repositories/driver_shifts.js — the ONLY module that runs SQL against
// `driver_shift` (migration 0006). Single SQL seam (ADR BD-DOCS-041).
// BD-DRIVER-SHIFT-AUTHORITY-01B, per the frozen docs/driver-shift-authority-contract.md.
//
// Low-level primitives only — NOT public authorization operations. Every function takes a
// plain `db` (or a transaction client with the same `.query` shape), returns raw rows or
// null, and performs no orchestration (lock order, usability decisions, ride-occupancy
// checks) — that composition lives in services/driver-shift-authority/index.js, mirroring
// the vehicle_driver_assignments.js / driver-vehicle-assignment-authority split exactly.
// Never trusts client timestamps or client vehicle identity: opened_at/closed_at/updated_at
// are always DB-stamped (now()), and vehicle_id here is whatever the caller passes in — the
// caller (the dark service) is responsible for deriving it from the LOCKED assignment row,
// never from client input or driver_active_vehicle directly.
//
// status = 'OPEN' guards in the WHERE clauses below are belt-and-braces on top of whatever
// row lock the caller already holds (matches vehicle_driver_assignments.terminateAssignment's
// own convention) — they make a stale/double call a clean no-op (returns null) rather than a
// silent incorrect mutation, without weakening the DB's own partial-unique-index/trigger
// backstops.

// Plain read: the driver's current OPEN shift, or null (NONE/CLOSED state). No lock — used
// for a fast existence check inside an already-locked transaction (the caller's per-driver
// authority lock already serializes this read against a concurrent open/close for the SAME
// driver) and for the dark seam's read-only getOpenDriverShift().
export async function findOpenShiftForDriver(db, driverId) {
  const { rows } = await db.query(
    `SELECT * FROM driver_shift WHERE driver_id = $1 AND status = 'OPEN' LIMIT 1`,
    [driverId],
  );
  return rows[0] ?? null;
}

// Plain read: the OPEN shift currently occupying a vehicle, or null. No lock — the shift-open
// sequence's vehicle-occupancy check runs AFTER the caller has already locked the vehicle row
// itself (repositories/vehicles.js lockVehicleById), which is the actual cross-driver
// serialization point; this read is then authoritative under that lock.
export async function findOpenShiftForVehicle(db, vehicleId) {
  const { rows } = await db.query(
    `SELECT * FROM driver_shift WHERE vehicle_id = $1 AND status = 'OPEN' LIMIT 1`,
    [vehicleId],
  );
  return rows[0] ?? null;
}

// Lock the driver's OPEN shift row (SELECT ... FOR UPDATE) inside a transaction — the
// close-sequence's own row lock, taken AFTER the per-driver authority lock
// (driver_active_vehicle.lockDriverAuthority) per the global lock order. Returns null if the
// driver has no OPEN shift (NONE or already CLOSED) — the caller reports NO_OPEN_SHIFT.
export async function lockOpenShiftForDriver(db, driverId) {
  const { rows } = await db.query(
    `SELECT * FROM driver_shift WHERE driver_id = $1 AND status = 'OPEN' FOR UPDATE`,
    [driverId],
  );
  return rows[0] ?? null;
}

// Insert a new OPEN shift. Callers must already hold: the per-driver authority lock, the
// locked assignment row (entitlement re-confirmed), and the locked vehicle row — and must
// have already checked no OPEN shift exists for either the driver or the vehicle. This
// primitive performs the WRITE only; it does not re-run those checks (the composite FK and
// the two partial unique indexes are the DB's own final backstop if it ever did race past
// them — see services/driver-shift-authority/index.js for the 23505 -> domain-code
// translation). opened_at/updated_at are DB-stamped (now()), never caller-supplied.
export async function insertOpenShift(db, { driverId, vehicleId, assignmentId }) {
  const { rows } = await db.query(
    `INSERT INTO driver_shift (driver_id, vehicle_id, assignment_id, status, opened_at, updated_at)
       VALUES ($1, $2, $3, 'OPEN', now(), now())
     RETURNING *`,
    [driverId, vehicleId, assignmentId],
  );
  return rows[0];
}

// Close an OPEN shift: OPEN -> CLOSED, close_reason set, closed_at stamped by the DB. Guarded
// by status = 'OPEN' in the WHERE clause (double-close is a no-op returning null, matching
// vehicle_driver_assignments.terminateAssignment's own convention) — on top of the DB's own
// driver_shift_guard_immutability trigger, which would reject a CLOSED -> CLOSED rewrite
// attempt outright rather than silently no-op it, so this WHERE guard is what keeps a
// redundant close call from ever reaching the trigger in the first place.
export async function closeShift(db, id, { closeReason }) {
  const { rows } = await db.query(
    `UPDATE driver_shift
        SET status = 'CLOSED', closed_at = now(), close_reason = $2
      WHERE id = $1 AND status = 'OPEN'
      RETURNING *`,
    [id, closeReason],
  );
  return rows[0] ?? null;
}
