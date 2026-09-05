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
  lockDriverAuthority, setSelection, clearSelection,
} from '../../repositories/driver_active_vehicle.js';
import { lockAssignmentForEntitlementCheck } from '../../repositories/vehicle_driver_assignments.js';
import { lockVehicleById } from '../../repositories/vehicles.js';
import { findOpenShiftForDriver } from '../../repositories/driver_shifts.js';
import { findActiveRideForDriver } from '../../repositories/rides.js';
import { decideAssignmentUsability, defaultResolveVehicleBlockState } from '../../domain/assignment-usability.js';

export * as vehicleDriverAssignments from '../../repositories/vehicle_driver_assignments.js';
export * as driverActiveVehicle from '../../repositories/driver_active_vehicle.js';

// -----------------------------------------------------------------------------------------
// guardSelectionMutation — the shared pre-write gate every DRIVER-INITIATED selection
// mutation (select / switch / clear) runs first, INSIDE the caller's db.tx, against a
// transaction client. Steps, in the frozen global lock order:
//
//   1. lockDriverAuthority(driverId)  — SELECT ... FROM users WHERE id = $1 FOR UPDATE. The
//      stable per-driver authority lock (Assignment Authority Invariant 6): it exists even
//      in the NONE selection state (no driver_active_vehicle row to lock), and it is the
//      SAME lock openDriverShift / closeDriverShift take FIRST — so a selection mutation and
//      a shift open/close for one driver can never interleave.
//   2. re-read the driver's OPEN driver_shift UNDER that lock — findOpenShiftForDriver, the
//      shift-authority repo's existing plain read. Deliberately the plain read, not
//      lockOpenShiftForDriver: the per-driver lock already serialized this against any
//      concurrent open/close for the SAME driver (the repo primitive's own header says so),
//      and openDriverShift itself checks "OPEN shift for this driver" the exact same way. It
//      is NEVER a value cached before the lock or supplied by the client (Shift Authority
//      Invariant 3).
//   3. an OPEN shift exists -> { ok: false, code: 'DRIVER_SHIFT_OPEN' }. The caller performs
//      ZERO writes; the existing selection is left exactly as it was. The shift's pinned
//      tuple is the working identity now — changing the car mid-shift is closing the shift
//      and opening a new one, not a selection change.
//   4. a non-terminal ride exists -> { ok: false, code: 'ACTIVE_RIDE_PRESENT' }. Frozen
//      Assignment Authority Invariant 8 / Shift Authority Invariant 6: select / switch /
//      clear are rejected during an active ride exactly as during an OPEN shift.
//      findActiveRideForDriver derives "active ride" from rides.status alone (past ACCEPTED,
//      not terminal) — no second ride-state machine.
//
// Returns { ok: true } to proceed, or a terminal { ok: false, code } the caller returns
// as-is. Every step is a lock or a read — a caller that returns one of these codes has
// written nothing, so committing the surrounding db.tx on that rejection is harmless
// (identical posture to openDriverShift's early-return paths).
// -----------------------------------------------------------------------------------------
async function guardSelectionMutation(client, driverId) {
  const lockedDriverId = await lockDriverAuthority(client, driverId);
  if (!lockedDriverId) return { ok: false, code: 'DRIVER_NOT_FOUND' };

  const openShift = await findOpenShiftForDriver(client, driverId);
  if (openShift) return { ok: false, code: 'DRIVER_SHIFT_OPEN' };

  const activeRide = await findActiveRideForDriver(client, driverId);
  if (activeRide) return { ok: false, code: 'ACTIVE_RIDE_PRESENT' };

  return { ok: true };
}

// -----------------------------------------------------------------------------------------
// setDriverSelection — NONE -> SELECTED(A) (select) and SELECTED(A) -> SELECTED(B) (switch).
// Mechanically ONE operation: the composite-FK-safe upsert in setSelection(). "select" and
// "switch" differ only by prior state, exactly as the frozen state machine
// (docs/driver-vehicle-assignment-authority-contract.md, "Active vehicle selection") lays it
// out; a SELECTED(A) -> SELECTED(A) request that changes nothing is still a normal success
// (setSelection re-stamps selected_at, matching the contract's "a switch is a new
// selection").
//
// After the shared guard, in the frozen lock order: lock the target
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
// Result: { ok: true, code: 'SELECTED', selection } on success; otherwise a terminal
// { ok: false, code[, reason] } — DRIVER_SHIFT_OPEN (the frozen freeze this slice adds),
// ACTIVE_RIDE_PRESENT, ASSIGNMENT_NOT_FOUND, ASSIGNMENT_DRIVER_MISMATCH, VEHICLE_NOT_FOUND,
// ASSIGNMENT_STATE_UNKNOWN, or ASSIGNMENT_UNUSABLE(reason). The codes match openDriverShift's
// own vocabulary for the shared usability decision — not a parallel one.
// -----------------------------------------------------------------------------------------
export async function setDriverSelection(db, driverId, { assignmentId }, opts = {}) {
  const { resolveVehicleBlockState = defaultResolveVehicleBlockState } = opts;
  return db.tx(async (client) => {
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
// driver was already in the NONE state); otherwise the same terminal { ok: false, code } set
// as the guard (DRIVER_NOT_FOUND / DRIVER_SHIFT_OPEN / ACTIVE_RIDE_PRESENT).
// -----------------------------------------------------------------------------------------
export async function clearDriverSelection(db, driverId) {
  return db.tx(async (client) => {
    const guard = await guardSelectionMutation(client, driverId);
    if (!guard.ok) return guard;

    const cleared = await clearSelection(client, driverId);
    return { ok: true, code: 'CLEARED', cleared };
  });
}
