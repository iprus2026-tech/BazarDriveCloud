// /server/src/services/history/index.js — #8 History & Receipt (BD-DOCS-023), LIVE in R08 of #784.
// Routes (mounted at /api/v1/history):
//   GET  /          -> { items: [entry] }   the AUTHENTICATED viewer's own ride history (the
//                                            ride_history view, scoped to viewer_user_id).
//   POST /receipts  -> 201 { receipt }       WRITE-ONCE receipt for a ride — the driver's earnings
//                                            document. Amounts are SERVER-DERIVED from an interim
//                                            fare basis (BD-RIDE-AUTHORITY-01B-C); client amounts
//                                            are ignored; a second write returns the stored row.
//
// History rows exist once a ride is COMPLETED (R06 chokepoint) on a real ride (R10 bootstrap). The
// client read cutover is R15.
import { serializeHistoryEntry, serializeReceipt } from '../../serialize.js';
import { listHistoryForViewer } from '../../repositories/history.js';
import { insertReceipt, findReceiptByRideId } from '../../repositories/receipts.js';
import { findRideByTripId } from '../../repositories/rides.js';
import { findOfferByOrderDriver } from '../../repositories/offers.js';
import { findOrderEstimateById } from '../../repositories/orders.js';
import { computeReceiptAmounts } from '../../domain/receipt-amounts.js';
import { DEFAULT_RECEIPT_COMMISSION_PERCENT } from '../../config.js';

const problem = (reply, status, code, error, retryable = false) =>
  reply.code(status).send({ error, code, retryable });

const AMOUNT_FIELDS = ['fare', 'commission', 'tip', 'net'];

// Contract §3: client-supplied amounts are accepted for backward compatibility and never used.
// When any provided one differs from the receipt being returned, log ONE warn line so legacy
// clients stay visible until #1059 — trip id and amounts only (no user ids, phones, names, tokens
// or addresses).
function logIgnoredClientAmounts(log, tripId, body, receipt) {
  const client = {};
  const mismatched = [];
  for (const field of AMOUNT_FIELDS) {
    if (body[field] === undefined) continue;
    client[field] = body[field];
    if (body[field] !== receipt[field]) mismatched.push(field);
  }
  if (mismatched.length === 0) return;
  log.warn({
    event: 'receipt_client_amounts_ignored',
    tripId,
    mismatched,
    client,
    server: { fare: receipt.fare, commission: receipt.commission, tip: receipt.tip, net: receipt.net },
  }, 'client receipt amounts ignored');
}

// The interim fare basis (contract §3): the ride's order's ACCEPTED offer by the ride's driver,
// else the order estimate. Null order -> no basis.
async function deriveReceiptAmounts(db, ride, commissionPercent) {
  if (!ride.order_id) return { ok: false, code: 'RECEIPT_FARE_UNKNOWN' };
  const order = await findOrderEstimateById(db, ride.order_id);
  if (!order) return { ok: false, code: 'RECEIPT_FARE_UNKNOWN' };
  const offer = await findOfferByOrderDriver(db, ride.order_id, ride.driver_user_id);
  const offerPrice = offer && offer.status === 'accepted' ? offer.price : null;
  return computeReceiptAmounts({ offerPrice, orderEstimate: order.estimated_price, commissionPercent });
}

export default async function historyService(app) {
  const commissionPercent = app.config?.receipts?.commissionPercent ?? DEFAULT_RECEIPT_COMMISSION_PERCENT;

  // GET /api/v1/history — the viewer's own history (inherently scoped to viewer_user_id).
  app.get('/', async (req, reply) => {
    const viewer = await req.resolveUser();
    if (req.authError) return problem(reply, 503, 'SESSION_LOOKUP_FAILED', 'session lookup failed', true);
    if (!viewer) return problem(reply, 401, 'UNAUTHENTICATED', 'authentication required');
    const rows = await listHistoryForViewer(app.db, viewer.userId, { limit: 100 });
    return { items: rows.map(serializeHistoryEntry) };
  });

  // POST /api/v1/history/receipts — write-once receipt for a ride (driver-only). fare / commission /
  // tip / net are OPTIONAL and ignored (kept in the schema, with the column bounds, only so older
  // clients don't 400); the stored amounts are derived server-side (contract §3).
  app.post('/receipts', {
    schema: {
      body: {
        type: 'object',
        required: ['tripId'],
        additionalProperties: false,
        properties: {
          tripId: { type: 'string', minLength: 1, maxLength: 200 },
          fare: { type: 'integer', minimum: 0, maximum: 2147483647 },
          commission: { type: 'integer', minimum: -2147483648, maximum: 0 },
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

    // Write-once: an existing receipt is returned exactly as stored — never recomputed.
    let receipt = await findReceiptByRideId(app.db, ride.id);
    if (!receipt) {
      const derived = await deriveReceiptAmounts(app.db, ride, commissionPercent);
      if (!derived.ok) {
        return problem(reply, 409, 'RECEIPT_FARE_UNKNOWN', 'no server fare basis for this ride');
      }
      receipt = await insertReceipt(app.db, {
        rideId: ride.id,
        completedAt: ride.completed_at,
        ...derived.amounts,
        paymentMode: b.paymentMode ?? 'noncash',
      });
      // A concurrent first write won the ON CONFLICT race: return the receipt it stored.
      if (!receipt) receipt = await findReceiptByRideId(app.db, ride.id);
    }
    logIgnoredClientAmounts(req.log, b.tripId, b, receipt);
    return reply.code(201).send({ receipt: serializeReceipt(receipt, { tripId: b.tripId }) });
  });
}
