// /server/src/plugins/realtime.js — the realtime read SEAM (ADR BD-DOCS-041), LIVE in R09 of #784.
// Phase-1 transport is POLLING (chosen over WS/SSE per the epic: SSE can't carry a Bearer and a
// multi-instance push needs Redis, both deferred). This mounts a single read-only, DB-cursor poll
// endpoint in the ONE known place against the ride timeline; the WS/SSE push bridge over fastify.bus
// stays a Phase-2 concern. Registered AFTER db + auth in server.js, so app.db and req.resolveUser are
// available here.
//
//   GET /api/v1/realtime/poll?tripId=<tripId>&since=<isoCursor?>  -> { tripId, status, events, cursor }
//
// PARTICIPANT-ONLY. `events` are the ride_events appended since `since` (oldest-first); `cursor` is
// the latest event's `at` to echo back on the next poll (unchanged when nothing new). The client
// fetches the full ride snapshot via GET /ride-state/rides/:tripId (R06) when a change is seen.
import fp from 'fastify-plugin';

import { findRideByTripId } from '../repositories/rides.js';
import { listEventsByTripSince } from '../repositories/ride_events.js';
import { serializeRideEvent } from '../serialize.js';

const problem = (reply, status, code, error, retryable = false) =>
  reply.code(status).send({ error, code, retryable });

function participantRole(ride, viewerId) {
  if (!viewerId) return null;
  if (ride.driver_user_id && String(ride.driver_user_id) === String(viewerId)) return 'driver';
  if (ride.passenger_user_id && String(ride.passenger_user_id) === String(viewerId)) return 'passenger';
  return null;
}

async function realtimePlugin(app) {
  app.decorate('realtimeEnabled', false); // push (WS/SSE) transport is still Phase-2; this is the poll seam

  app.get('/api/v1/realtime/poll', {
    schema: {
      querystring: {
        type: 'object',
        required: ['tripId'],
        properties: {
          tripId: { type: 'string', minLength: 1, maxLength: 200 },
          // a malformed cursor must be a clean 400, never a timestamptz cast 500 (R05/R08 lesson).
          since: { type: 'string', format: 'date-time' },
        },
      },
    },
  }, async (req, reply) => {
    const viewer = await req.resolveUser();
    if (req.authError) return problem(reply, 503, 'SESSION_LOOKUP_FAILED', 'session lookup failed', true);
    if (!viewer) return problem(reply, 401, 'UNAUTHENTICATED', 'authentication required');

    const ride = await findRideByTripId(app.db, req.query.tripId);
    if (!ride) return problem(reply, 404, 'RIDE_NOT_FOUND', 'ride not found');
    if (!participantRole(ride, viewer.userId)) return problem(reply, 403, 'FORBIDDEN', 'not a participant of this ride');

    const since = req.query.since ?? null;
    let rows;
    try {
      rows = await listEventsByTripSince(app.db, ride.trip_id, since, { limit: 100 });
    } catch (err) {
      // format:date-time accepts a few values ::timestamptz rejects (e.g. Feb 30) — map that cast
      // error to a clean 400, never a 500 (the R05/R08 lesson, belt-and-braces over the schema).
      if (err && (err.code === '22007' || err.code === '22008')) {
        return problem(reply, 400, 'VALIDATION', 'invalid since cursor');
      }
      throw err;
    }
    // next cursor = the newest event's FULL-PRECISION at (rows are oldest-first; at_cursor is µs text,
    // not a ms-truncated JS Date, so it round-trips exactly); unchanged when nothing new.
    const cursor = rows.length ? rows[rows.length - 1].at_cursor : since;
    return { tripId: ride.trip_id, status: ride.status, events: rows.map(serializeRideEvent), cursor };
  });
}

export default fp(realtimePlugin, { name: 'realtime' });
