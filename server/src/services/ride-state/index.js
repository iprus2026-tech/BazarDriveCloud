// /server/src/services/ride-state/index.js — #5 Ride State Machine (BD-DOCS-023), LIVE in R06 of
// #784. The single terminal-freeze write path. Routes (mounted at /api/v1/ride-state):
//   GET   /rides/:tripId        -> { ride }   PARTICIPANT-ONLY snapshot of the ride state.
//   PATCH /rides/:tripId/status -> { ride }   PARTICIPANT-ONLY status transition.
//
// RIDE_STATUS is domain/ride-status.js (parity-pinned to the client). WHO may make WHICH move is
// domain/ride-transition-authority.js (BD-RIDE-AUTHORITY-01B-B): per-role, forward-only along
// NEXT_STATUS, plus the terminal freeze (backstopped by the trg_rides_freeze_terminal trigger). The
// PATCH locks the ride row, stamps the status-keyed timestamp, and appends an append-only
// status_change event — all in one tx. `rides` rows are minted by R10 (assignment->ride bootstrap); until then only seeded
// rows + tests exercise this, and the client read cutover is R15.
import { RIDE_STATUS, isValidRideStatus, TERMINAL_RIDE_STATUSES, STATUS_TIMESTAMP_FIELD } from '../../domain/ride-status.js';
import { authorizeForwardTransition, authorizeCancel } from '../../domain/ride-transition-authority.js';
import { serializeRide, serializeRecoveredRide } from '../../serialize.js';
import {
  findRideByTripId, lockRideByTripId, patchRideStatus, patchRideCanceled,
  patchRideNoShow, findRecoveryBundleByTripId,
} from '../../repositories/rides.js';
import { insertStatusChangeEvent } from '../../repositories/ride_events.js';
import { insertRideStatusNotificationOutbox } from '../../repositories/notification_outbox.js';
import { validateRecoveryLinkage, validateStandaloneCandidate } from '../../domain/select-recovery-linkage.js';
import {
  expectedOrderStatus, ORDER_FROM_STATUSES, assignmentCancelActor, OrderLifecycleMismatchError,
} from '../../domain/order-lifecycle.js';
import { advanceOrderStatus } from '../../repositories/orders.js';
import { cancelAssignment } from '../../repositories/assignment.js';

const problem = (reply, status, code, error, retryable = false) =>
  reply.code(status).send({ error, code, retryable });

// client timestamp key (STATUS_TIMESTAMP_FIELD) -> rides DB column.
const TS_KEY_TO_COLUMN = {
  acceptedAt: 'accepted_at',
  approachingAt: 'approaching_at',
  arrivedAt: 'arrived_at',
  startedAt: 'started_at',
  completedAt: 'completed_at',
  canceledAt: 'canceled_at',
};

const DRIVER_CANCEL_REASONS = new Set([
  'passenger_no_show', 'wrong_pickup', 'car_problem',
  'unsafe_situation', 'cannot_reach_passenger', 'other',
]);
const PASSENGER_CANCEL_REASONS = new Set([
  'driver_far', 'changed_mind', 'route_error', 'cannot_leave', 'other',
]);

// Which side the authenticated viewer is on for this ride (the actor of a transition), or null
// when the viewer is neither participant. Demo/SIM rides with null participant FKs => null.
function participantRole(ride, viewerId) {
  if (!viewerId) return null;
  if (ride.driver_user_id && String(ride.driver_user_id) === String(viewerId)) return 'driver';
  if (ride.passenger_user_id && String(ride.passenger_user_id) === String(viewerId)) return 'passenger';
  return null;
}

// The status-change timeline row is the authoritative notification source. Both writes are
// awaited inside the caller's existing Ride transaction: an outbox failure therefore rolls
// back the Ride mutation and its timeline event together. Same-status/rejected paths never call
// this helper, so they emit neither source row nor outbox row.
async function appendStatusChangeSource(
  client,
  { ride, actorUserId, actorRole, toStatus },
) {
  const event = await insertStatusChangeEvent(client, {
    rideId: ride.id,
    tripId: ride.trip_id,
    role: actorRole,
    fromStatus: ride.status,
    toStatus,
  });
  await insertRideStatusNotificationOutbox(client, {
    sourceEventId: event.id,
    actorUserId,
    actorRole,
  });
}

// Order-lifecycle contract (#1051): the order — and on a cancel / no-show its assignment — follows
// the ride in the SAME transaction as the ride transition. `ride` is the UPDATED row. A ride with
// no order (a standalone demo ride) is left alone. An order (or assignment) that is not in a
// from-state of this step fails the whole transition (OrderLifecycleMismatchError rolls the ride
// back too), so the pair never splits; replays never get here (they return before the patch).
async function syncOrderWithRide(client, ride) {
  if (!ride?.order_id) return;
  const toStatus = expectedOrderStatus(ride.status);
  if (!toStatus || toStatus === 'ACCEPTED') return;
  const order = await advanceOrderStatus(client, ride.order_id, toStatus, ORDER_FROM_STATUSES[toStatus]);
  if (!order) throw new OrderLifecycleMismatchError(ride.trip_id, 'order_status_mismatch');
  if (toStatus === 'CANCELED') {
    // Only the PATCH writes rides and it always records passenger | driver (NO_SHOW -> driver).
    const canceledBy = assignmentCancelActor(ride);
    const assignment = canceledBy
      ? await cancelAssignment(client, ride.order_id, { canceledBy, canceledAt: ride.canceled_at ?? null })
      : null;
    if (!assignment) throw new OrderLifecycleMismatchError(ride.trip_id, 'assignment_not_accepted');
  }
}

export default async function rideStateService(app) {
  // GET /api/v1/ride-state/rides/:tripId — participant-only snapshot, reinforced by the
  // BD-RIDE-SELECT-RECOVERY-LINKAGE-INVARIANT-01A recovery gate. The existing participant
  // gate (driver OR passenger) is unchanged and runs FIRST — it does not by itself prove
  // "authenticated caller is the order's owner"; that proof composes from the owner-only
  // GET /matching/offers instead (see matching/index.js). Applicability is decided by
  // candidate_order_count, resolved via BOTH the canonical trip_<legacy_id> convention and
  // the direct rides.order_id FK, so a Ride linked via either path can never remain
  // standalone: 0 candidates AND a noncanonical trip_id = genuinely standalone (today's plain
  // read, unaffected); 0 candidates but a CANONICAL trip_id = a canonical orphan (the order was
  // deleted — rides.order_id is ON DELETE SET NULL — while the trip_id still claims order
  // derivation), fail-closed rather than serving the Ride's raw, unvalidated cache (#938 Codex
  // finding C, validateStandaloneCandidate); 1 candidate = gate runs; 2+ = ambiguous,
  // fail-closed without ever guessing which order is "right".
  app.get('/rides/:tripId', async (req, reply) => {
    const viewer = await req.resolveUser();
    if (req.authError) return problem(reply, 503, 'SESSION_LOOKUP_FAILED', 'session lookup failed', true);
    if (!viewer) return problem(reply, 401, 'UNAUTHENTICATED', 'authentication required');
    const ride = await findRideByTripId(app.db, req.params.tripId);
    if (!ride) return problem(reply, 404, 'RIDE_NOT_FOUND', 'ride not found');
    if (!participantRole(ride, viewer.userId)) return problem(reply, 403, 'FORBIDDEN', 'not a participant of this ride');

    const bundle = await findRecoveryBundleByTripId(app.db, req.params.tripId);
    if (bundle.candidate_order_count === 0) {
      const standaloneVerdict = validateStandaloneCandidate(ride.trip_id);
      if (!standaloneVerdict.ok) return problem(reply, 409, 'RIDE_RECOVERY_UNVERIFIED', 'ride acceptance is unverified', false);
      return { ride: serializeRide(ride) };
    }
    if (bundle.candidate_order_count >= 2) {
      return problem(reply, 409, 'RIDE_RECOVERY_UNVERIFIED', 'ride acceptance is unverified', false);
    }
    const verdict = validateRecoveryLinkage({
      ride: bundle.ride,
      order: bundle.order,
      assignment: bundle.assignment,
      offers: bundle.offers ?? [],
      facts: {
        pg_has_core_timestamps: bundle.pg_has_core_timestamps,
        pg_accepted_at_matches_order: bundle.pg_accepted_at_matches_order,
        pg_chronology_ok: bundle.pg_chronology_ok,
      },
    });
    if (!verdict.ok) return problem(reply, 409, 'RIDE_RECOVERY_UNVERIFIED', 'ride acceptance is unverified', false);
    return { ride: serializeRecoveredRide(bundle.ride, { order: bundle.order, acceptedOffer: verdict.acceptedOffer }) };
  });

  // PATCH /api/v1/ride-state/rides/:tripId/status — the single terminal-freeze write path.
  app.patch('/rides/:tripId/status', {
    schema: {
      body: {
        type: 'object',
        required: ['status'],
        additionalProperties: false,
        properties: {
          status: { type: 'string', minLength: 1, maxLength: 40 },
          cancel: {
            type: 'object',
            additionalProperties: false,
            properties: {
              reason: { type: 'string', minLength: 1, maxLength: 80 },
              comment: { type: 'string', maxLength: 500 },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const viewer = await req.resolveUser();
    if (req.authError) return problem(reply, 503, 'SESSION_LOOKUP_FAILED', 'session lookup failed', true);
    if (!viewer) return problem(reply, 401, 'UNAUTHENTICATED', 'authentication required');
    const { status } = req.body;
    if (!isValidRideStatus(status)) return problem(reply, 400, 'INVALID_STATUS', 'unknown ride status');
    if (req.body.cancel && status !== RIDE_STATUS.CANCELED) {
      return problem(reply, 400, 'INVALID_CANCEL_METADATA', 'cancel metadata is only valid for CANCELED');
    }

    const result = await app.db.tx(async (client) => {
      const ride = await lockRideByTripId(client, req.params.tripId);
      if (!ride) return { err: [404, 'RIDE_NOT_FOUND', 'ride not found'] };
      const role = participantRole(ride, viewer.userId);
      if (!role) return { err: [403, 'FORBIDDEN', 'not a participant of this ride'] };
      // V2-04C1 — NO_SHOW is a narrow authority slice inside the existing PATCH chokepoint.
      // It does not broaden #830 into a full transition-policy rewrite: all other non-terminal
      // transitions keep their current participant semantics in this PR.
      if (status === RIDE_STATUS.NO_SHOW) {
        if (role !== 'driver') {
          return { err: [403, 'FORBIDDEN', 'only the assigned driver can mark passenger no-show'] };
        }
        // Driver retry after an acknowledged NO_SHOW is a true no-op: no timestamp re-stamp/event.
        if (ride.status === RIDE_STATUS.NO_SHOW) return { ok: { ride } };
        // A different terminal state keeps the existing terminal-freeze machine code.
        if (TERMINAL_RIDE_STATUSES.has(ride.status)) {
          return { err: [409, 'RIDE_TERMINAL', `ride is terminal (${ride.status})`] };
        }
        if (ride.status !== RIDE_STATUS.WAITING_PASSENGER) {
          return {
            err: [409, 'RIDE_TRANSITION_NOT_ALLOWED', 'NO_SHOW requires WAITING_PASSENGER'],
          };
        }
        const updated = await patchRideNoShow(client, { id: ride.id });
        await appendStatusChangeSource(client, {
          ride,
          actorUserId: viewer.userId,
          actorRole: role,
          toStatus: RIDE_STATUS.NO_SHOW,
        });
        await syncOrderWithRide(client, updated);
        return { ok: { ride: updated } };
      }

      if (status === RIDE_STATUS.CANCELED) {
        if (ride.status === RIDE_STATUS.CANCELED) return { ok: { ride } };
        if (TERMINAL_RIDE_STATUSES.has(ride.status)) {
          return { err: [409, 'RIDE_TERMINAL', `ride is terminal (${ride.status})`] };
        }
        // Contract §1: a passenger may cancel only before the trip starts (before reason checks).
        const cancelAuthority = authorizeCancel({ role, from: ride.status });
        if (!cancelAuthority.ok) {
          return { err: [cancelAuthority.status, cancelAuthority.code, cancelAuthority.error] };
        }

        const rawReason = typeof req.body.cancel?.reason === 'string' ? req.body.cancel.reason.trim() : '';
        const allowedReasons = role === 'driver' ? DRIVER_CANCEL_REASONS : PASSENGER_CANCEL_REASONS;
        if (role === 'driver' && !rawReason) {
          return { err: [400, 'CANCEL_REASON_REQUIRED', 'driver cancellation reason is required'] };
        }
        if (rawReason && !allowedReasons.has(rawReason)) {
          return { err: [400, 'INVALID_CANCEL_REASON', 'unknown cancellation reason'] };
        }
        const rawComment = typeof req.body.cancel?.comment === 'string' ? req.body.cancel.comment.trim() : '';
        const comment = rawReason === 'other' && rawComment ? rawComment : null;
        const updated = await patchRideCanceled(client, {
          id: ride.id,
          actorRole: role,
          reason: rawReason || null,
          comment,
        });
        await appendStatusChangeSource(client, {
          ride,
          actorUserId: viewer.userId,
          actorRole: role,
          toStatus: RIDE_STATUS.CANCELED,
        });
        await syncOrderWithRide(client, updated);
        return { ok: { ride: updated } };
      }

      // Per-role, forward-only authority (contract §1, domain/ride-transition-authority.js), in order:
      // target owned by nobody -> 409; owned by the other role -> 403 RIDE_ROLE_FORBIDDEN;
      // IDEMPOTENT same-status retry by the owner -> no-op (no re-stamp, no event — a network retry
      // can't corrupt the original lifecycle timestamp or append a from==to event, Codex #792);
      // terminal ride -> 409 RIDE_TERMINAL (mirrors the client + trg_rides_freeze_terminal);
      // anything but the single NEXT_STATUS step (a skip or a backward move) -> 409.
      const transition = authorizeForwardTransition({ role, from: ride.status, to: status });
      if (!transition.ok) return { err: [transition.status, transition.code, transition.error] };
      if (transition.noop) return { ok: { ride } };
      const tsKey = STATUS_TIMESTAMP_FIELD[status];
      const timestampColumn = tsKey ? TS_KEY_TO_COLUMN[tsKey] : null;
      const updated = await patchRideStatus(client, {
        id: ride.id,
        status,
        timestampColumn,
        firstStampOnly: timestampColumn === 'accepted_at',
      });
      await appendStatusChangeSource(client, {
        ride,
        actorUserId: viewer.userId,
        actorRole: role,
        toStatus: status,
      });
      await syncOrderWithRide(client, updated);
      return { ok: { ride: updated } };
    }).catch((err) => {
      if (!(err instanceof OrderLifecycleMismatchError)) throw err;
      req.log.warn({ tripId: err.tripId, reason: err.reason }, 'ride transition refused: order lifecycle mismatch');
      return { err: [409, 'ORDER_LIFECYCLE_MISMATCH', 'the ride and its order are out of step'] };
    });

    if (result.err) return problem(reply, result.err[0], result.err[1], result.err[2]);
    return { ride: serializeRide(result.ok.ride) };
  });
}
