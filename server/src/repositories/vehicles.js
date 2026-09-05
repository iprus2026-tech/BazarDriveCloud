// /server/src/repositories/vehicles.js — the ONLY module that runs SQL against `vehicles`
// (migration 0001). Single SQL seam (ADR BD-DOCS-041). BD-DRIVER-SHIFT-AUTHORITY-01B.
//
// Deliberately minimal: this is a lock/identity anchor for the shift-open transaction's
// vehicle-row lock (docs/driver-shift-authority-contract.md, "Exclusivity" — the shared
// serialization point for two different drivers racing to open the same vehicle), not a
// vehicle CRUD/runtime seam. `vehicles.is_active` is legacy/derived only (frozen by
// docs/driver-vehicle-assignment-authority-contract.md, "vehicles.is_active — legacy /
// derived only") — nothing here reads it as authority, and this module adds no garage or
// vehicle-runtime primitives beyond the one lock needed for shift concurrency.

// Lock the vehicle row (SELECT ... FOR UPDATE) inside a transaction — the shift-open
// sequence's shared cross-driver serialization point (per-driver lock -> assignment lock ->
// THIS vehicle lock -> OPEN-shift check -> INSERT). Two different drivers racing to open the
// same vehicle hold different per-driver locks (their own `users` rows), so this vehicle-row
// lock is what actually orders them: whoever locks it first proceeds to a deterministic
// domain conflict for the loser (VEHICLE_SHIFT_ALREADY_OPEN), rather than relying solely on
// the partial-unique-index backstop surfacing a raw constraint violation. Returns the row's
// `archived` flag (needed for the entitlement/usability decision) plus every other column;
// callers must not read `is_active` off the result as authority.
export async function lockVehicleById(db, vehicleId) {
  const { rows } = await db.query(
    `SELECT * FROM vehicles WHERE id = $1 FOR UPDATE`,
    [vehicleId],
  );
  return rows[0] ?? null;
}
