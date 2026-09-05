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
  insertOpenShift, closeShift,
} from '../../repositories/driver_shifts.js';
import { findActiveRideForDriver } from '../../repositories/rides.js';

// -----------------------------------------------------------------------------------------
// Critical usability seam (docs/driver-shift-authority-contract.md, "Critical usability
// seam"). The merged Assignment Authority (migration 0005) only stores the ENTITLEMENT half
// authoritatively (status/starts_at/ends_at -> entitled_now); full vehicle
// operational/block authority has NO physical storage anywhere in this repository yet. This
// seam must therefore preserve `confirmed UNUSABLE > UNKNOWN > USABLE` without inventing new
// persistence and without defaulting an unresolved operational state to USABLE.
//
// resolveVehicleBlockState is an INJECTED, internal server dependency — never client input.
// The default implementation always returns 'UNKNOWN' (there is no authoritative block-state
// resolver wired in yet); tests may supply a deterministic resolver to exercise the
// UNBLOCKED / BLOCKED / UNKNOWN paths. Its absence/error must yield ASSIGNMENT_STATE_UNKNOWN
// with zero shift writes — callers below never let a thrown/rejected resolver escape as an
// uncaught error into a partially-decided state.
// -----------------------------------------------------------------------------------------
export async function defaultResolveVehicleBlockState(_vehicleId, _client) {
  return 'UNKNOWN';
}

// Classify WHICH confirmed-negative reason applies when a locked assignment's entitled_now is
// false. status ENDED/REVOKED are unambiguous from the row alone. status ACTIVE but not
// entitled_now means either the window hasn't opened yet (BEFORE_START) or it has closed
// (ELAPSED) — distinguishing those needs a time reference, fetched here via a bare
// `SELECT now()` (no table touched, so this does not violate vehicle_driver_assignments.js's
// single-SQL-seam ownership of that table) so the comparison is anchored to PostgreSQL's own
// clock, never the JS host clock — no app/DB clock-skew window.
async function classifyEntitlementUnusableReason(client, assignment) {
  if (assignment.status === 'ENDED') return 'ENDED';
  if (assignment.status === 'REVOKED') return 'REVOKED';
  const { rows: [{ server_now: serverNow }] } = await client.query('SELECT now() AS server_now');
  if (assignment.starts_at != null && new Date(assignment.starts_at) > serverNow) return 'BEFORE_START';
  return 'ELAPSED';
}

// The tri-state usability decision, in the frozen short-circuit order: confirmed
// entitlement-negative first (real DB data, already locked) -> archived vehicle (real DB
// data, already locked) -> injected block-state resolver (UNBLOCKED/BLOCKED/UNKNOWN) only
// once the first two are clear. Returns { decision: 'USABLE' | 'UNKNOWN' | 'UNUSABLE', reason }
// — reason is null unless decision === 'UNUSABLE'.
async function decideAssignmentUsability(client, { assignment, vehicle, resolveVehicleBlockState }) {
  if (!assignment.entitled_now) {
    const reason = await classifyEntitlementUnusableReason(client, assignment);
    return { decision: 'UNUSABLE', reason };
  }
  if (vehicle.archived) {
    return { decision: 'UNUSABLE', reason: 'ARCHIVED' };
  }
  let blockState;
  try {
    blockState = await resolveVehicleBlockState(vehicle.id, client);
  } catch {
    blockState = 'UNKNOWN'; // resolver failure fails closed to UNKNOWN, never to USABLE.
  }
  if (blockState === 'BLOCKED') return { decision: 'UNUSABLE', reason: 'BLOCKED' };
  if (blockState !== 'UNBLOCKED') return { decision: 'UNKNOWN', reason: null }; // covers 'UNKNOWN' and any unrecognized value — fail closed.
  return { decision: 'USABLE', reason: null };
}

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
// No PENDING_CLOSE field/state is introduced anywhere in this flow. A deferred outcome
// (active ride present) performs zero writes and leaves the shift OPEN and the selection
// untouched — the pinned tuple + durable facts are enough for a later re-invocation (once the
// ride has gone terminal) to complete the close + selection cleanup, with no new persisted
// marker required in between.
// -----------------------------------------------------------------------------------------
export async function reconcileAssignmentUnusableShift(db, shiftId, opts = {}) {
  const { resolveVehicleBlockState = defaultResolveVehicleBlockState } = opts;
  return db.tx(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM driver_shift WHERE id = $1 AND status = 'OPEN' FOR UPDATE`,
      [shiftId],
    );
    const shift = rows[0];
    if (!shift) return { ok: true, code: 'ALREADY_CLOSED_OR_NOT_FOUND', idempotent: true };

    await lockDriverAuthority(client, shift.driver_id);
    const assignment = await lockAssignmentForEntitlementCheck(client, shift.assignment_id);
    const vehicle = await lockVehicleById(client, shift.vehicle_id);
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
