// /server/src/domain/vehicle-assignment.js — pure JS mirror of the frozen contract's
// assignmentEntitledAt(t) predicate (docs/driver-vehicle-assignment-authority-contract.md,
// "Assignment usability"). BD-DRIVER-VEHICLE-ASSIGNMENT-AUTHORITY-01B.
//
// This covers the ENTITLEMENT half only — status / starts_at / ends_at. The OPERATIONAL half
// (vehicle.archived + vehicleBlockState(t)) is explicitly out of scope for 01B: the contract
// leaves the block state's physical storage as "a future runtime / DB decision" (01A,
// "Assignment usability"), and 01B's migration (0005) adds no such column. Composing the
// full tri-state assignmentUsabilityDecision(t) therefore belongs to a later slice, once a
// block-state source exists — this file must not be read as already implementing it.
//
// Callers needing the entitlement fact against the ACTUAL server clock should prefer the
// PostgreSQL-computed boolean in repositories/vehicle_driver_assignments.js
// (lockAssignmentForEntitlementCheck) — that is evaluated strictly inside the database using
// the server's own now(), avoiding any app/DB clock skew. This pure function exists for
// hermetic unit tests (test/vehicle-assignment-domain.test.mjs) and for application code
// that already holds an explicit `t` and an assignment snapshot.
//
// terminated_at is deliberately NOT read here: the contract's terminal-status rule already
// reduces to `status !== 'ACTIVE'` for entitlement purposes, and terminated_at's own
// consistency (`ACTIVE <=> terminated_at IS NULL`) is enforced by a DB CHECK
// (vehicle_driver_assignments_active_iff_not_terminated, migration 0005) — not re-verified
// here.

// assignmentEntitledAt(t):
//   assignment.status == ACTIVE
//   AND assignment.starts_at <= t
//   AND (assignment.ends_at IS NULL OR t < assignment.ends_at)
//
// `assignment` is a plain object with `status` (string) / `startsAt` (Date) / `endsAt`
// (Date | null | undefined). `t` is a Date. Any malformed input (missing assignment, a
// non-Date `t`, an invalid Date) fails closed to `false` — this mirrors the contract's
// "fail-closed" posture: an unevaluable fact is never treated as a positive entitlement.
export function assignmentEntitledAt(assignment, t) {
  if (!assignment) return false;
  if (!isValidDate(t)) return false;
  const { status, startsAt, endsAt } = assignment;
  if (status !== 'ACTIVE') return false;
  if (!isValidDate(startsAt)) return false;
  if (startsAt.getTime() > t.getTime()) return false;
  if (endsAt != null) {
    if (!isValidDate(endsAt)) return false;
    if (t.getTime() >= endsAt.getTime()) return false;
  }
  return true;
}

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}
