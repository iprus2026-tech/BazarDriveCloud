// /server/src/services/driver-shift-authority/index.js — BD-DRIVER-SHIFT-AUTHORITY-01B dark
// seam.
//
// Deliberately NOT a Fastify plugin, and deliberately NOT listed in services/index.js
// SERVICES: importing this file registers no route and adds no HTTP surface. Mirrors
// services/driver-vehicle-assignment-authority/index.js's own "one level darker than a
// registered 501 stub" positioning (docs/driver-shift-authority-contract.md, "01B boundary
// preview": "01B ships ... a dark transactional seam that is not yet a live route").
//
// Unlike that thinner re-export seam (which deferred ALL orchestration to a later slice
// because driver_shift did not exist yet), THIS file IS that later slice: driver_shift now
// exists (migration 0006), so this module owns the actual transaction orchestration the
// frozen contract specifies — the exact lock order, the tri-state usability decision, the
// idempotency rules, and the active-ride boundary. It is still dark: no route calls any of
// this yet.
//
// Every exported operation runs its own db.tx(...) — nothing here accepts a caller-supplied
// transaction client, so it always begins/commits/rolls back atomically as one unit. Never
// trusts: request-cached selection, client assignment_id, client vehicle_id, localStorage,
// driverGarage.activeVehicleId, or vehicles.is_active (legacy/derived only, per
// docs/driver-vehicle-assignment-authority-contract.md). Pinned identity comes only from the
// post-lock server read inside this transaction.

import { lockDriverAuthority, readSelection, clearSelection } from '../../repositories/driver_active_vehicle.js';
import { lockAssignmentForEntitlementCheck } from '../../repositories/vehicle_driver_assignments.js';
import { lockVehicleById } from '../../repositories/vehicles.js';
import {
  findOpenShiftForDriver, findOpenShiftForVehicle, lockOpenShiftForDriver,
  insertOpenShift, closeShift, findShiftById, lockOpenShiftById,
} from '../../repositories/driver_shifts.js';
import { findActiveRideForDriver } from '../../repositories/rides.js';
// Critical usability seam (docs/driver-shift-authority-contract.md, "Critical usability
// seam"): the tri-state `confirmed UNUSABLE > UNKNOWN > USABLE` decision and its default
// injected block-state resolver. Both moved to domain/assignment-usability.js in
// BD-DRIVER-SHIFT-AUTHORITY-01C-A so the driver-initiated selection-mutation service
// (services/driver-vehicle-assignment-authority/index.js) composes the SAME decision from ONE
// copy — behaviour reached from here is byte-for-byte unchanged.
import { decideAssignmentUsability, defaultResolveVehicleBlockState } from '../../domain/assignment-usability.js';

// Re-exported unchanged so existing importers (test/driver-shift-authority.test.mjs) keep
// their import path.
export { defaultResolveVehicleBlockState };

// -----------------------------------------------------------------------------------------
// openDriverShift — the full opening sequence, exact lock order from the frozen contract:
//   db.tx -> lockDriverAuthority(driverId) -> re-read driver_active_vehicle
//         -> lock selected assignment -> derive vehicle_id from that locked assignment
//         -> lock vehicle row -> evaluate assignment usability
//         -> check OPEN shift for driver -> check OPEN shift for vehicle
//         -> check non-terminal ride -> INSERT OPEN driver_shift
//
// Every early-return path below performs ZERO writes (all reads), so committing the
// surrounding transaction on a rejection is harmless — nothing durable changes.
// -----------------------------------------------------------------------------------------
export async function openDriverShift(db, driverId, opts = {}) {
  const { resolveVehicleBlockState = defaultResolveVehicleBlockState } = opts;
  return db.tx(async (client) => {
    const lockedDriverId = await lockDriverAuthority(client, driverId);
    if (!lockedDriverId) return { ok: false, code: 'DRIVER_NOT_FOUND' };

    const selection = await readSelection(client, driverId);
    if (!selection) return { ok: false, code: 'NO_ACTIVE_VEHICLE_SELECTION' };

    const assignment = await lockAssignmentForEntitlementCheck(client, selection.assignment_id);
    if (!assignment) return { ok: false, code: 'ASSIGNMENT_NOT_FOUND' }; // defensive: composite FK should make this unreachable.
    if (assignment.driver_id !== driverId) return { ok: false, code: 'ASSIGNMENT_DRIVER_MISMATCH' }; // defensive: same guarantee.

    const vehicleId = assignment.vehicle_id; // derived from the LOCKED assignment, never from selection or client input.
    const vehicle = await lockVehicleById(client, vehicleId);
    if (!vehicle) return { ok: false, code: 'VEHICLE_NOT_FOUND' }; // defensive: FK should make this unreachable.

    const usability = await decideAssignmentUsability(client, { assignment, vehicle, resolveVehicleBlockState });
    if (usability.decision === 'UNKNOWN') {
      return { ok: false, code: 'ASSIGNMENT_STATE_UNKNOWN' };
    }
    if (usability.decision === 'UNUSABLE') {
      return { ok: false, code: 'ASSIGNMENT_UNUSABLE', reason: usability.reason };
    }

    const existingDriverShift = await findOpenShiftForDriver(client, driverId);
    if (existingDriverShift) {
      // Idempotent open: calling open again for the SAME already-OPEN pinned tuple returns
      // the existing shift rather than erroring (docs/driver-shift-authority-contract.md,
      // "Operations contract" idempotency). Any OTHER open shift for this driver is a genuine
      // conflict.
      if (existingDriverShift.vehicle_id === vehicleId && existingDriverShift.assignment_id === assignment.id) {
        return { ok: true, code: 'ALREADY_OPEN', shift: existingDriverShift, idempotent: true };
      }
      return { ok: false, code: 'DRIVER_SHIFT_ALREADY_OPEN' };
    }

    const existingVehicleShift = await findOpenShiftForVehicle(client, vehicleId);
    if (existingVehicleShift) {
      return { ok: false, code: 'VEHICLE_SHIFT_ALREADY_OPEN' };
    }

    const activeRide = await findActiveRideForDriver(client, driverId);
    if (activeRide) {
      return { ok: false, code: 'ACTIVE_RIDE_PRESENT' };
    }

    try {
      const shift = await insertOpenShift(client, { driverId, vehicleId, assignmentId: assignment.id });
      return { ok: true, code: 'OPENED', shift };
    } catch (err) {
      // Last-resort translation of a genuine race that slipped past the checks above (e.g. a
      // concurrent transaction committing between this transaction's read and its own commit,
      // under a lock-order this code never actually leaves un-serialized in practice, but the
      // DB backstop is still the final arbiter) — a raw 23505 must never surface as an
      // accidental 500-shaped result.
      if (err.code === '23505') {
        if (err.constraint === 'driver_shift_one_open_per_driver_uq') return { ok: false, code: 'DRIVER_SHIFT_ALREADY_OPEN' };
        if (err.constraint === 'driver_shift_one_open_per_vehicle_uq') return { ok: false, code: 'VEHICLE_SHIFT_ALREADY_OPEN' };
      }
      throw err;
    }
  });
}

// -----------------------------------------------------------------------------------------
// closeDriverShift — driver-requested close. Lock order: db.tx -> lockDriverAuthority(driverId)
// -> lock OPEN driver_shift for driver -> inspect non-terminal ride.
//
// If an active ride exists: ACTIVE_RIDE_PRESENT, zero writes, the shift remains OPEN, the
// selection is untouched. Otherwise: OPEN -> CLOSED, close_reason = DRIVER_REQUESTED,
// closed_at = DB now(). driver_active_vehicle is NEVER touched here — a normal close leaves
// the driver's selection as their valid next-shift preference.
// -----------------------------------------------------------------------------------------
export async function closeDriverShift(db, driverId) {
  return db.tx(async (client) => {
    const lockedDriverId = await lockDriverAuthority(client, driverId);
    if (!lockedDriverId) return { ok: false, code: 'DRIVER_NOT_FOUND' };

    const shift = await lockOpenShiftForDriver(client, driverId);
    if (!shift) return { ok: false, code: 'NO_OPEN_SHIFT' };

    const activeRide = await findActiveRideForDriver(client, driverId);
    if (activeRide) {
      return { ok: false, code: 'ACTIVE_RIDE_PRESENT', shift };
    }

    const closed = await closeShift(client, shift.id, { closeReason: 'DRIVER_REQUESTED' });
    return { ok: true, code: 'CLOSED', shift: closed };
  });
}

// Plain read-only lookup — no transaction needed (findOpenShiftForDriver is already a
// single-statement read).
export function getOpenDriverShift(db, driverId) {
  return findOpenShiftForDriver(db, driverId);
}

// -----------------------------------------------------------------------------------------
// reconcileAssignmentUnusableShift — the internal server-forced cleanup primitive
// (docs/driver-shift-authority-contract.md, "Server-forced ASSIGNMENT_UNUSABLE cleanup").
// Takes a shiftId (identifying WHICH open shift to reconcile — e.g. from a future scan for
// OPEN shifts whose pinned assignment has since gone ENDED/REVOKED/elapsed/archived/blocked),
// never trusts the caller's claim that the assignment is unusable, and re-derives that fact
// itself under lock before acting.
//
// LOCK ORDER (independent review finding P2-1, fixed here): the frozen contract's Invariant 2
// fixes ONE global lock order for every driver_shift operation — per-driver -> assignment ->
// vehicle/dependent authority -> shift row -> mutation. closeDriverShift already follows this
// (driver lock, then the shift row). The previous version of this function inverted it (shift
// row FIRST, then the driver lock), which is exactly the opposite order closeDriverShift uses
// for the SAME two resources — a classic lock-order-inversion deadlock setup, confirmed by
// adversarial testing: closeDriverShift holding the driver lock while waiting on the shift row,
// racing this function holding the shift row while waiting on the driver lock, reproducibly
// aborts one side with a raw, untranslated 40P01 deadlock_detected.
//
// The fix: an UNLOCKED seed read (findShiftById) discovers the pinned driver_id/assignment_id/
// vehicle_id WITHOUT taking any lock, so the per-driver lock can be acquired FIRST, exactly
// like every other driver_shift operation. The shift row itself is locked LAST (lockOpenShiftById),
// after the driver/assignment/vehicle locks — restoring the one true global order everywhere.
// Since the seed read is unlocked, it can go stale between steps 1 and 6; because pinned
// identity is DB-immutable (trg_driver_shift_guard_immutability), a staleness re-check of the
// PINNED fields themselves is a structurally-unreachable defensive assertion, not a live
// business rule — but the exact shiftId given still narrows lockOpenShiftById to the SAME row
// this call was asked to reconcile, never a different (e.g. newer) OPEN shift for the same
// driver: if shift A closed between the seed read and the driver lock, and the driver has since
// opened a brand-new shift B, lockOpenShiftById(A) correctly returns null (A is not OPEN,
// regardless of B's existence) and this call reports ALREADY_CLOSED_OR_NOT_FOUND for A — it
// never substitutes B.
//
// No PENDING_CLOSE field/state is introduced anywhere in this flow. A deferred outcome
// (active ride present) performs zero writes and leaves the shift OPEN and the selection
// untouched — the pinned tuple + durable facts are enough for a later re-invocation (once the
// ride has gone terminal) to complete the close + selection cleanup, with no new persisted
// marker required in between.
// -----------------------------------------------------------------------------------------
export async function reconcileAssignmentUnusableShift(db, shiftId, opts = {}) {
  const { resolveVehicleBlockState = defaultResolveVehicleBlockState } = opts;
  return db.tx(async (client) => {
    // 1. Unlocked seed read — discovers the pinned identity only, never an authority decision.
    const seed = await findShiftById(client, shiftId);
    // 2. Absent, or not currently OPEN (already closed by anyone, for any reason): idempotent,
    //    zero writes. (No CLOSED shift can ever reopen under this exact id — the state machine
    //    forbids it — so "not OPEN now" is as final an answer as re-checking later would give.)
    if (!seed || seed.status !== 'OPEN') {
      return { ok: true, code: 'ALREADY_CLOSED_OR_NOT_FOUND', idempotent: true };
    }

    // 3-5. The frozen global order: per-driver -> assignment -> vehicle, using the SEED's
    // pinned values (safe: driver_id/assignment_id/vehicle_id can never change for this row).
    await lockDriverAuthority(client, seed.driver_id);
    const assignment = await lockAssignmentForEntitlementCheck(client, seed.assignment_id);
    const vehicle = await lockVehicleById(client, seed.vehicle_id);

    // 6. The shift row itself, LOCKED, LAST, by its exact id (never by driver_id — this call
    //    reconciles the exact shift it was asked to, never a different one for the same driver).
    const shift = await lockOpenShiftById(client, shiftId);
    if (!shift) {
      // Closed by a concurrent operation (e.g. the driver's own closeDriverShift) in the window
      // between the seed read and this lock — same idempotent, zero-write outcome as step 2.
      return { ok: true, code: 'ALREADY_CLOSED_OR_NOT_FOUND', idempotent: true };
    }
    // 7. Defensive re-verification against the seed snapshot. Structurally unreachable given
    //    pinned-identity immutability (the DB trigger guarantees these fields never change for
    //    a given id) — but fail closed rather than silently trust a stale seed if this ever
    //    somehow disagrees.
    if (shift.driver_id !== seed.driver_id || shift.assignment_id !== seed.assignment_id || shift.vehicle_id !== seed.vehicle_id) {
      return { ok: false, code: 'SHIFT_IDENTITY_MISMATCH' };
    }

    // 8. Only now evaluate usability, under all the relevant locks.
    const usability = await decideAssignmentUsability(client, { assignment, vehicle, resolveVehicleBlockState });
    if (usability.decision !== 'UNUSABLE') {
      // Refuse to act on anything less than a CONFIRMED unusable assignment — UNKNOWN alone
      // must never perform this cleanup, and a re-check finding the assignment USABLE again
      // means whatever triggered this call is stale.
      return { ok: false, code: 'NOT_CONFIRMED_UNUSABLE' };
    }

    const activeRide = await findActiveRideForDriver(client, shift.driver_id);
    if (activeRide) {
      return { ok: true, code: 'DEFERRED_ACTIVE_RIDE_PRESENT', shift };
    }

    // 9. Mutation last.
    const closed = await closeShift(client, shift.id, { closeReason: 'ASSIGNMENT_UNUSABLE' });
    // Clear the now-stale selection only if it still points at this exact pinned assignment —
    // a driver may have already switched to a different (usable) assignment in the meantime,
    // and that newer selection must not be wiped out by a reconciliation of an OLDER shift.
    const selection = await readSelection(client, shift.driver_id);
    if (selection && selection.assignment_id === shift.assignment_id) {
      await clearSelection(client, shift.driver_id);
    }
    return { ok: true, code: 'CLOSED_AND_CLEANED', shift: closed };
  });
}
