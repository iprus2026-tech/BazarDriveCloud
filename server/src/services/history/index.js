// /server/src/services/history/index.js — #8 History & Receipt (BD-DOCS-023), LIVE in R08 of #784.
// Routes (mounted at /api/v1/history):
//   GET  /          -> { items: [entry] }   the AUTHENTICATED viewer's own ride history (the
//                                            ride_history view, scoped to viewer_user_id).
//   POST /receipts  -> 201 { receipt }       WRITE-ONCE receipt for a ride — the driver's earnings
//                                            document; the supplied amounts are stored VERBATIM (no
//                                            recompute), and a second write returns the existing row.
//
// History rows exist once a ride is COMPLETED (R06 chokepoint) on a real ride (R10 bootstrap). The
// client read cutover is R15.
import { serializeHistoryEntry, serializeReceipt } from '../../serialize.js';
import { listHistoryForViewer } from '../../repositories/history.js';
import { insertReceipt, findReceiptByRideId } from '../../repositories/receipts.js';
import { findRideByTripId } from '../../repositories/rides.js';

const problem = (reply, status, code, error, retryable = false) =>
  reply.code(status).send({ error, code, retryable });

export default async function historyService(app) {
  // GET /api/v1/history — the viewer's own history (inherently scoped to viewer_user_id).
  app.get('/', async (req, reply) => {
    const viewer = await req.resolveUser();
    if (req.authError) return problem(reply, 503, 'SESSION_LOOKUP_FAILED', 'session lookup failed', true);
    if (!viewer) return problem(reply, 401, 'UNAUTHENTICATED', 'authentication required');
    const rows = await listHistoryForViewer(app.db, viewer.userId, { limit: 100 });
    return { items: rows.map(serializeHistoryEntry) };
  });

  // POST /api/v1/history/receipts — write-once receipt for a ride (driver-only). The amounts are
  // already-computed by the completion flow and stored verbatim; integer bounds match the columns
  // (and the commission<=0 / tip>=0 sign invariants) so bad input is a 400, not a pg overflow 500.
  app.post('/receipts', {
    schema: {
      body: {
        type: 'object',
        required: ['tripId', 'fare', 'commission', 'tip', 'net'],
        additionalProperties: false,
        properties: {
          tripId: { type: 'string', minLength: 1, maxLength: 200 },
          fare: { type: 'integer', minimum: 0, maximum: 2147483647 },
          commission: { type: 'integer', minimum: -2147483648, maximum: 0 }, // already signed (negative)
          tip: { type: 'integer', minimum: 0, maximum: 2147483647 },
          net: { type: 'integer', minimum: -2147483648, maximum: 2147483647 },
          paymentMode: { type: 'string', enum: ['cash', 'noncash'] },
        },
      },
    },
  }, async (req, reply) => {
    const viewer = await req.resolveUser();
    if (req.authError) return problem(reply, 503, 'SESSION_LOOKUP_FAILED', 'session lookup failed', true);
    if (!viewer) return problem(reply, 401, 'UNAUTHENTICATED', 'authentication required');

    const b = req.body;
    const ride = await findRideByTripId(app.db, b.tripId);
    if (!ride) return problem(reply, 404, 'RIDE_NOT_FOUND', 'ride not found');
    // The receipt is the DRIVER's earnings document.
    if (!ride.driver_user_id || String(ride.driver_user_id) !== String(viewer.userId)) {
      return problem(reply, 403, 'FORBIDDEN', 'only the ride driver can write its receipt');
    }
    // A receipt is a POST-COMPLETION document and write-once, so only a COMPLETED ride may have one —
    // else a premature, frozen, wrong receipt could be minted for an in-flight (or later-canceled)
    // ride. Its completed_at is the ride's AUTHORITATIVE completion stamp (the rides_completed_stamp
    // CHECK guarantees it is non-null here), NOT a client-supplied string — which also sidesteps a
    // malformed-timestamp TIMESTAMPTZ cast 500 (the R05 22P02 lesson).
    if (ride.status !== 'COMPLETED') {
      return problem(reply, 409, 'RIDE_NOT_COMPLETED', 'receipt can only be written for a completed ride');
    }
    // Write-once + no recompute: store the supplied amounts verbatim; a second write is a no-op that
    // returns the existing receipt (never overwrites a financial document).
    let receipt = await insertReceipt(app.db, {
      rideId: ride.id,
      completedAt: ride.completed_at,
      fare: b.fare,
      commission: b.commission,
      tip: b.tip,
      net: b.net,
      paymentMode: b.paymentMode ?? 'noncash',
    });
    if (!receipt) receipt = await findReceiptByRideId(app.db, ride.id);
    return reply.code(201).send({ receipt: serializeReceipt(receipt, { tripId: b.tripId }) });
  });
}
