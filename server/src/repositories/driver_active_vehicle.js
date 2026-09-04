// /server/src/repositories/driver_active_vehicle.js — the ONLY module that runs SQL against
// `driver_active_vehicle` (migration 0005), PLUS the stable per-driver authority lock
// primitive (Invariant 6 of docs/driver-vehicle-assignment-authority-contract.md). Single SQL
// seam (ADR BD-DOCS-041). BD-DRIVER-VEHICLE-ASSIGNMENT-AUTHORITY-01B. No HTTP assumptions.
//
// The composite FK (assignment_id, driver_id) -> vehicle_driver_assignments (id, driver_id)
// is the DB's own guarantee that a selection's assignment always belongs to the selecting
// driver; this module does not re-check that in JS before writing.

// lockDriverAuthority — Invariant 6's stable per-driver authority lock. Every
// driver_active_vehicle mutation (select/switch/clear) AND every future driver_shift open
// must take this SAME lock FIRST, in one transaction, before touching
// vehicle_driver_assignments or vehicles (single global lock order: per-driver lock ->
// assignment -> vehicle/dependent rows).
//
// CRITICAL (contract Invariant 6): this locks the `users` row, NOT `driver_active_vehicle` —
// a `FOR UPDATE` on driver_active_vehicle alone is insufficient, because the row does not
// exist in the NONE selection state (no row to lock), which would let a concurrent select
// and a shift-open both proceed unserialized. `users(id)` always has a row for an
// authenticated driver, so the lock exists in every selection state, NONE included.
//
// Returns the locked user id, or null if no such user (caller decides how to treat that —
// this primitive does not assume the caller has already resolved the driver's existence).
export async function lockDriverAuthority(db, driverId) {
  const { rows } = await db.query(
    `SELECT id FROM users WHERE id = $1 FOR UPDATE`,
    [driverId],
  );
  return rows[0]?.id ?? null;
}

// Read the driver's current selection (or null for the NONE state). Plain SELECT — after
// lockDriverAuthority has taken the per-driver lock in the SAME transaction, this read is
// already serialized against any concurrent selection/shift-open for this driver (the
// contract's "re-read driver_active_vehicle UNDER the lock" — the per-driver lock is what
// makes the re-read authoritative, not a row-level lock on driver_active_vehicle itself).
export async function readSelection(db, driverId) {
  const { rows } = await db.query(
    `SELECT * FROM driver_active_vehicle WHERE driver_id = $1`,
    [driverId],
  );
  return rows[0] ?? null;
}

// select / switch: upsert the driver's selection to `assignmentId`. Callers must already
// hold the per-driver authority lock (lockDriverAuthority) in the SAME transaction, and must
// have separately asserted the target assignment is USABLE and belongs to this driver
// (contract Invariant 9) — this primitive performs the WRITE only; it does not itself
// evaluate assignmentUsabilityDecision (that composition needs the vehicle-operational half,
// which has no storage yet in 01B — see domain/vehicle-assignment.js). The composite FK on
// driver_active_vehicle enforces that assignmentId truly belongs to driverId regardless.
// selected_at is stamped fresh on every select AND every switch (contract: "selected_at —
// When this selection was made") — a switch is a new selection, not a continuation of the
// old one.
export async function setSelection(db, { driverId, assignmentId }) {
  const { rows } = await db.query(
    `INSERT INTO driver_active_vehicle (driver_id, assignment_id, selected_at, updated_at)
       VALUES ($1, $2, now(), now())
     ON CONFLICT (driver_id) DO UPDATE
       SET assignment_id = $2, selected_at = now(), updated_at = now()
     RETURNING *`,
    [driverId, assignmentId],
  );
  return rows[0];
}

// clear: NONE <- SELECTED(A). Returns the deleted row, or null if the driver already had no
// selection (a no-op, not an error — mirrors the contract's "SELECTED(A) -> NONE" being a
// mutation like any other, safely idempotent when there is nothing to clear).
//
// Callers must already hold lockDriverAuthority(driverId) in the SAME
// db.tx before calling this mutation, following the global lock order:
// per-driver authority lock -> assignment -> vehicle/dependent rows -> mutation.
export async function clearSelection(db, driverId) {
  const { rows } = await db.query(
    `DELETE FROM driver_active_vehicle WHERE driver_id = $1 RETURNING *`,
    [driverId],
  );
  return rows[0] ?? null;
}
