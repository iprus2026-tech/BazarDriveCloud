// /server/src/services/ride-state/index.js — #5 Ride State Machine (BD-DOCS-023), LIVE in R06 of
// #784. The single terminal-freeze write path. Routes (mounted at /api/v1/ride-state):
//   GET   /rides/:tripId        -> { ride }   PARTICIPANT-ONLY snapshot of the ride state.
//   PATCH /rides/:tripId/status -> { ride }   PARTICIPANT-ONLY status transition.
//
// RIDE_STATUS authority is domain/ride-status.js (parity-pinned to the client). A transition is
// refused only by the terminal-freeze rule (mirrors the client + the trg_rides_freeze_terminal
// trigger that backstops it); a non-terminal ride may move to any valid status. The PATCH locks the
// ride row, stamps the status-keyed timestamp, and appends an append-only status_change event — all
// in one tx. `rides` rows are minted by R10 (assignment->ride bootstrap); until then only seeded
// rows + tests exercise this, and the client read cutover is R15.
import { RIDE_STATUS, isValidRideStatus, TERMINAL_RIDE_STATUSES, STATUS_TIMESTAMP_FIELD } from '../../domain/ride-status.js';
import { serializeRide, serializeRecoveredRide } from '../../serialize.js';
import { findRideByTripId, lockRideByTripId, patchRideStatus, patchRideNoShow, findRecoveryBundleByTripId } from '../../repositories/rides.js';
import { insertStatusChangeEvent } from '../../repositories/ride_events.js';
import { validateRecoveryLinkage, validateStandaloneCandidate } from '../../domain/select-recovery-linkage.js';

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

// Which side the authenticated viewer is on for this ride (the actor of a transition), or null
// when the viewer is neither participant. Demo/SIM rides with null participant FKs => null.
function participantRole(ride, viewerId) {
  if (!viewerId) return null;
  if (ride.driver_user_id && String(ride.driver_user_id) === String(viewerId)) return 'driver';
  if (ride.passenger_user_id && String(ride.passenger_user_id) === String(viewerId)) return 'passenger';
  return null;
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
        properties: { status: { type: 'string', minLength: 1, maxLength: 40 } },
      },
    },
  }, async (req, reply) => {
    const viewer = await req.resolveUser();
    if (req.authError) return problem(reply, 503, 'SESSION_LOOKUP_FAILED', 'session lookup failed', true);
    if (!viewer) return problem(reply, 401, 'UNAUTHENTICATED', 'authentication required');
    const { status } = req.body;
    if (!isValidRideStatus(status)) return problem(reply, 400, 'INVALID_STATUS', 'unknown ride status');

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
        await insertStatusChangeEvent(client, {
          rideId: ride.id,
          tripId: ride.trip_id,
          role,
          fromStatus: ride.status,
          toStatus: RIDE_STATUS.NO_SHOW,
        });
        return { ok: { ride: updated } };
      }

      // IDEMPOTENT: a PATCH to the status the ride is ALREADY in is a no-op — no re-stamp, no event.
      // So a normal network retry of an already-succeeded transition can't corrupt the original
      // lifecycle timestamp (e.g. re-stamping started_at) or append a from==to event (Codex #792).
      // Covers terminal AND non-terminal alike.
      if (status === ride.status) return { ok: { ride } };
      // Terminal-freeze (mirrors the client + trg_rides_freeze_terminal): a terminal ride can't move
      // OUT to a different status. A non-terminal ride may move to any other valid status.
      if (TERMINAL_RIDE_STATUSES.has(ride.status)) {
        return { err: [409, 'RIDE_TERMINAL', `ride is terminal (${ride.status})`] };
      }
      const tsKey = STATUS_TIMESTAMP_FIELD[status];
      const timestampColumn = tsKey ? TS_KEY_TO_COLUMN[tsKey] : null;
      const updated = await patchRideStatus(client, {
        id: ride.id,
        status,
        timestampColumn,
        firstStampOnly: timestampColumn === 'accepted_at',
      });
      await insertStatusChangeEvent(client, {
        rideId: ride.id,
        tripId: ride.trip_id,
        role,
        fromStatus: ride.status,
        toStatus: status,
      });
      return { ok: { ride: updated } };
    });

    if (result.err) return problem(reply, result.err[0], result.err[1], result.err[2]);
    return { ride: serializeRide(result.ok.ride) };
  });
}
