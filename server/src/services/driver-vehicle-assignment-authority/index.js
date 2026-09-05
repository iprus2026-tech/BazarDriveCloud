// /server/src/services/driver-vehicle-assignment-authority/index.js — the authoritative
// DRIVER-INITIATED selection-mutation service. Started life as the BD-DRIVER-VEHICLE-
// ASSIGNMENT-AUTHORITY-01B dark re-export seam; hardened by BD-DRIVER-SHIFT-AUTHORITY-01C-A
// into the seam that owns the select / switch / clear transaction.
//
// Still deliberately NOT a Fastify plugin and NOT listed in services/index.js SERVICES:
// importing this file registers no route and adds no HTTP surface — grep services/index.js
// and there is no reference to this directory. It is one level darker than a registered 501
// stub — not reachable over HTTP at all yet. The live authenticated route is a SEPARATE
// slice (BD-DRIVER-SHIFT-AUTHORITY-01C-B for the Shift API; the driver selection endpoint is
// BD-DRIVER-VEHICLE-ASSIGNMENT-AUTHORITY-01C) — this file adds NO route and maps nothing to
// HTTP.
//
// Two roles:
//   1. ONE stable import path for the 0005 repository primitives (the re-exports below), for
//      a future route layer, instead of reaching into server/src/repositories/* directly.
//   2. The authoritative selection-mutation transaction — setDriverSelection (select /
//      switch) and clearDriverSelection (clear) — owning: the db.tx boundary, the stable
//      per-driver authority lock (lockDriverAuthority, the SAME primitive shift-open takes),
//      the frozen "no driver-initiated selection change while an OPEN driver_shift exists"
//      guard (docs/driver-shift-authority-contract.md Invariant 5 / docs/driver-vehicle-
//      assignment-authority-contract.md Invariant 7), the frozen "no selection change during
//      a non-terminal ride" guard (Assignment Authority Invariant 8 / Shift Authority
//      Invariant 6), the existing tri-state assignmentUsabilityDecision, and the
//      composite-FK-safe write. The low-level setSelection() / clearSelection() primitives
//      stay pure SQL — policy lives HERE, never pushed down into them.
//
// The SELECTED(A) -> SELECTED(A) no-op (frozen: "a SELECTED(A) -> SELECTED(A) request that
// changes no state is a no-op") is NOT a mutation: setDriverSelection short-circuits it right
// after the per-driver lock + a re-read of the current selection UNDER that lock, BEFORE the
// OPEN-shift guard, the non-terminal-ride guard, and any entitlement/usability check. It
// succeeds (idempotently) even with an OPEN driver_shift or a non-terminal ride, and writes
// nothing — no setSelection call, no selected_at / updated_at re-stamp.
//
// Global lock order, unchanged (Assignment Authority Invariant 6 / Shift Authority Invariant
// 2): per-driver authority lock -> assignment -> vehicle/dependent -> mutation. The
// OPEN-shift guard is checked immediately AFTER the per-driver lock and BEFORE any
// assignment/vehicle lock, so the one global order is preserved and no reverse lock order is
// introduced — shift-open and select/switch/clear serialize on the identical
// lockDriverAuthority(driverId) lock, so exactly one coherent decision wins.
//
// Never trusts: a request-cached selection, a client-supplied vehicle_id, an owner identity,
// a driver_active_vehicle value read before the lock, vehicles.is_active, driverGarage
// .activeVehicleId, or any localStorage mirror. The OPEN-shift fact comes ONLY from the
// post-lock server read inside this transaction (Shift Authority Invariant 3).

import {
  lockDriverAuthority, readSelection, setSelection, clearSelection,
} from '../../repositories/driver_active_vehicle.js';
import { lockAssignmentForEntitlementCheck } from '../../repositories/vehicle_driver_assignments.js';
import { lockVehicleById } from '../../repositories/vehicles.js';
import { findOpenShiftForDriver } from '../../repositories/driver_shifts.js';
import { findActiveRideForDriver } from '../../repositories/rides.js';
import { decideAssignmentUsability, defaultResolveVehicleBlockState } from '../../domain/assignment-usability.js';

export * as vehicleDriverAssignments from '../../repositories/vehicle_driver_assignments.js';
export * as driverActiveVehicle from '../../repositories/driver_active_vehicle.js';

// -----------------------------------------------------------------------------------------
// guardSelectionMutation — the OPEN-shift + non-terminal-ride blockers shared by every REAL
// selection mutation (a genuine state transition: NONE -> SELECTED(A), SELECTED(A) ->
// SELECTED(B), SELECTED(A) -> NONE). Runs INSIDE the caller's db.tx, against a transaction
// client that ALREADY holds lockDriverAuthority(driverId) — this function takes no lock; it
// runs only the two authoritative reads under that per-driver lock, in the frozen order:
//
//   1. re-read the driver's OPEN driver_shift UNDER the per-driver lock — findOpenShiftForDriver,
//      the shift-authority repo's existing plain read. Deliberately the plain read, not
//      lockOpenShiftForDriver: the per-driver lock already serialized this against any
//      concurrent open/close for the SAME driver (the repo primitive's own header says so),
//      and openDriverShift itself checks "OPEN shift for this driver" the exact same way. It
//      is NEVER a value cached before the lock or supplied by the client (Shift Authority
//      Invariant 3). An OPEN shift -> { ok: false, code: 'DRIVER_SHIFT_OPEN' }: zero writes,
//      the existing selection left exactly as it was — the shift's pinned tuple is the
//      working identity now, and changing the car mid-shift is closing the shift and opening
//      a new one, not a selection change.
//   2. a non-terminal ride -> { ok: false, code: 'ACTIVE_RIDE_PRESENT' }. Frozen Assignment
//      Authority Invariant 8 / Shift Authority Invariant 6: select / switch / clear are
//      rejected during an active ride exactly as during an OPEN shift. findActiveRideForDriver
//      derives "active ride" from rides.status alone (past ACCEPTED, not terminal) — no
//      second ride-state machine.
//
// A SELECTED(A) -> SELECTED(A) no-op re-select is NOT a mutation (frozen: "a SELECTED(A) ->
// SELECTED(A) request that changes no state is a no-op") — setDriverSelection short-circuits
// it BEFORE this guard, so it never reaches here and none of these blockers apply to it.
//
// Returns { ok: true } to proceed, or a terminal { ok: false, code } the caller returns
// as-is. Every step is a read — a caller that returns one of these codes has written nothing,
// so committing the surrounding db.tx on that rejection is harmless (identical posture to
// openDriverShift's early-return paths).
// -----------------------------------------------------------------------------------------
async function guardSelectionMutation(client, driverId) {
  const openShift = await findOpenShiftForDriver(client, driverId);
  if (openShift) return { ok: false, code: 'DRIVER_SHIFT_OPEN' };

  const activeRide = await findActiveRideForDriver(client, driverId);
  if (activeRide) return { ok: false, code: 'ACTIVE_RIDE_PRESENT' };

  return { ok: true };
}

// -----------------------------------------------------------------------------------------
// setDriverSelection — NONE -> SELECTED(A) (select) and SELECTED(A) -> SELECTED(B) (switch).
// A real transition is mechanically ONE operation: the composite-FK-safe upsert in
// setSelection(). "select" and "switch" differ only by prior state, exactly as the frozen
// state machine (docs/driver-vehicle-assignment-authority-contract.md, "Active vehicle
// selection") lays it out.
//
// SELECTED(A) -> SELECTED(A) — a request for the assignment the driver's driver_active_vehicle
// row ALREADY points at — "changes no state" and the frozen contract classifies it as a
// no-op, NOT a mutation. It is short-circuited here, immediately after the per-driver lock and
// a re-read of the current selection UNDER that lock (so the determination is authoritative,
// never a stale/client value), and BEFORE the OPEN-shift guard, the non-terminal-ride guard,
// and the assignment/vehicle locks + assignmentUsabilityDecision. It returns an idempotent
// success ({ ok: true, code: 'ALREADY_SELECTED', selection, idempotent: true } — the
// openDriverShift ALREADY_OPEN convention) EVEN when an OPEN driver_shift or a non-terminal
// ride is present, and performs ZERO writes: no setSelection call, no selected_at / updated_at
// re-stamp, no entitlement/usability re-check.
//
// For a real transition, after the shared guard, in the frozen lock order: lock the target
// vehicle_driver_assignments row (lockAssignmentForEntitlementCheck — computes entitled_now
// against PostgreSQL's own clock), assert it belongs to this driver, lock its vehicle, and
// require assignmentUsabilityDecision(serverTime) == USABLE — UNUSABLE and UNKNOWN both
// reject (frozen Invariant 9). Only then the write. Every early return is a lock/read only,
// so ZERO selection writes on any rejection.
//
// opts.resolveVehicleBlockState — the injected internal block-state resolver (see
// domain/assignment-usability.js). Omitted -> defaultResolveVehicleBlockState, which always
// answers UNKNOWN today -> this returns ASSIGNMENT_STATE_UNKNOWN, fail-closed, exactly like
// openDriverShift with no resolver wired in.
//
// Result: { ok: true, code: 'SELECTED', selection } on a real transition;
// { ok: true, code: 'ALREADY_SELECTED', selection, idempotent: true } on the no-op; otherwise
// a terminal { ok: false, code[, reason] } — DRIVER_NOT_FOUND, DRIVER_SHIFT_OPEN (the frozen
// freeze this slice adds), ACTIVE_RIDE_PRESENT, ASSIGNMENT_NOT_FOUND, ASSIGNMENT_DRIVER_MISMATCH,
// VEHICLE_NOT_FOUND, ASSIGNMENT_STATE_UNKNOWN, or ASSIGNMENT_UNUSABLE(reason). The codes match
// openDriverShift's own vocabulary for the shared usability decision — not a parallel one.
// -----------------------------------------------------------------------------------------
export async function setDriverSelection(db, driverId, { assignmentId }, opts = {}) {
  const { resolveVehicleBlockState = defaultResolveVehicleBlockState } = opts;
  return db.tx(async (client) => {
    const lockedDriverId = await lockDriverAuthority(client, driverId);
    if (!lockedDriverId) return { ok: false, code: 'DRIVER_NOT_FOUND' };

    // SELECTED(A) -> SELECTED(A): re-read the current selection UNDER the per-driver lock; if
    // it already points at the requested assignment, this request transitions nothing. Return
    // the idempotent no-op success before any mutation guard or usability check runs.
    const current = await readSelection(client, driverId);
    if (current && current.assignment_id === assignmentId) {
      return { ok: true, code: 'ALREADY_SELECTED', selection: current, idempotent: true };
    }

    const guard = await guardSelectionMutation(client, driverId);
    if (!guard.ok) return guard;

    const assignment = await lockAssignmentForEntitlementCheck(client, assignmentId);
    if (!assignment) return { ok: false, code: 'ASSIGNMENT_NOT_FOUND' };
    if (assignment.driver_id !== driverId) return { ok: false, code: 'ASSIGNMENT_DRIVER_MISMATCH' };

    const vehicle = await lockVehicleById(client, assignment.vehicle_id); // derived from the LOCKED assignment, never client input.
    if (!vehicle) return { ok: false, code: 'VEHICLE_NOT_FOUND' }; // defensive: the FK should make this unreachable.

    const usability = await decideAssignmentUsability(client, { assignment, vehicle, resolveVehicleBlockState });
    if (usability.decision === 'UNKNOWN') return { ok: false, code: 'ASSIGNMENT_STATE_UNKNOWN' };
    if (usability.decision === 'UNUSABLE') return { ok: false, code: 'ASSIGNMENT_UNUSABLE', reason: usability.reason };

    const selection = await setSelection(client, { driverId, assignmentId });
    return { ok: true, code: 'SELECTED', selection };
  });
}

// -----------------------------------------------------------------------------------------
// clearDriverSelection — SELECTED(A) -> NONE. A mutation with the SAME guards as select /
// switch (frozen: "SELECTED(A) -> NONE ... a mutation — same guards as a switch"). There is
// no target assignment, so no usability check; clearing when already NONE is an idempotent
// success (clearSelection returns null).
//
// This is NOT the server-forced stale-selection cleanup. reconcileAssignmentUnusableShift
// (services/driver-shift-authority/index.js) also calls the clearSelection() primitive, but
// AFTER it has already closed the shift, and it is deliberately NOT routed through this
// guard: the "no selection change while OPEN shift" rule is about DRIVER-initiated mutations
// only — "The only actor that may move the selection while a shift is open is the server,
// inside the ... shift-close / cleanup transaction" (Assignment Authority, "Active vehicle
// selection"). That path must stay unblocked; this one must stay blocked.
//
// Result: { ok: true, code: 'CLEARED', cleared } (cleared = the deleted row, or null if the
// driver was already in the NONE state — a DELETE that matches no row writes nothing); otherwise
// a terminal { ok: false, code } — DRIVER_NOT_FOUND / DRIVER_SHIFT_OPEN / ACTIVE_RIDE_PRESENT.
// -----------------------------------------------------------------------------------------
export async function clearDriverSelection(db, driverId) {
  return db.tx(async (client) => {
    const lockedDriverId = await lockDriverAuthority(client, driverId);
    if (!lockedDriverId) return { ok: false, code: 'DRIVER_NOT_FOUND' };

    const guard = await guardSelectionMutation(client, driverId);
    if (!guard.ok) return guard;

    const cleared = await clearSelection(client, driverId);
    return { ok: true, code: 'CLEARED', cleared };
  });
}
