// /server/src/services/matching/index.js — #3 Matching (BD-DOCS-023), partially LIVE in R04 of
// #784. Routes (mounted at /api/v1/matching):
//   POST /offers  -> 201 { offer }   a DRIVER (verified session) offers on an open order;
//                                     idempotent per (order, driver); re-sends a withdrawn offer.
//   GET  /offers?orderId=<legacyId> -> { items:[offer] }   OWNER-ONLY (the order's passenger).
//   POST /select  -> 501             transactional accept lands in R05.
//
// Identity is recomputed per request; ownership is re-validated server-side (BD-DOCS-032 dec. 4).
// Role-gating (only a granted driver may offer) is deferred — any verified session may offer today
// (no role grants flow until R17); R04 requires authentication, not a specific role. The PWA write
// cutover is R18; until then only this server + tests exercise these routes.
import { newOfferId } from '../../infra/ids.js';
import { serializeOffer } from '../../serialize.js';
import { findOrderByLegacyId } from '../../repositories/orders.js';
import { upsertOffer, findOfferByOrderDriver, listOffersByOrder } from '../../repositories/offers.js';

const OFFER_TTL_MIN = 15; // mirrors the client DEFAULT_OFFER_TTL_MIN

const problem = (reply, status, code, error, retryable = false) =>
  reply.code(status).send({ error, code, retryable });

export default async function matchingService(app) {
  // POST /api/v1/matching/offers — a driver offers on an open order.
  app.post('/offers', {
    schema: {
      body: {
        type: 'object',
        required: ['orderId'],
        additionalProperties: false,
        properties: {
          orderId: { type: 'string', minLength: 1, maxLength: 200 },
          driverName: { type: 'string', maxLength: 120 },
          car: { type: 'string', maxLength: 120 },
          rating: { type: 'string', maxLength: 8 },
          etaMin: { type: 'integer', minimum: 1, maximum: 1440 },
          price: { type: 'number', minimum: 0, maximum: 9999999999.99 },
          message: { type: 'string', maxLength: 1000 },
        },
      },
    },
  }, async (req, reply) => {
    const viewer = await req.resolveUser();
    if (req.authError) return problem(reply, 503, 'SESSION_LOOKUP_FAILED', 'session lookup failed', true);
    if (!viewer) return problem(reply, 401, 'UNAUTHENTICATED', 'authentication required');

    const b = req.body;
    const order = await findOrderByLegacyId(app.db, b.orderId);
    if (!order) return problem(reply, 404, 'ORDER_NOT_FOUND', 'order not found');
    if (order.status !== 'CREATED') return problem(reply, 409, 'ORDER_NOT_OPEN', 'order is not open for offers');
    // A passenger cannot offer on their OWN order — reject at create so no self-candidate ever
    // enters the owner-only list or sets up a self-assignment at /select (Codex #790).
    if (String(order.passenger_id) === String(viewer.userId)) {
      return problem(reply, 403, 'CANNOT_OFFER_OWN_ORDER', 'cannot offer on your own order');
    }

    // Idempotent: upsert creates a fresh 'sent' offer or re-sends a withdrawn one; a no-op conflict
    // (already 'sent' or terminal) returns no row, so read the existing one back.
    let row = await upsertOffer(app.db, {
      legacyId: newOfferId(order.legacy_id, viewer.userId),
      orderId: order.id,
      driverId: viewer.userId,
      driverName: b.driverName ?? null,
      car: b.car ?? null,
      rating: b.rating ?? null,
      etaMin: b.etaMin ?? null,
      price: b.price ?? null,
      message: b.message ?? null,
      ttlMin: OFFER_TTL_MIN,
    });
    if (!row) row = await findOfferByOrderDriver(app.db, order.id, viewer.userId);
    return reply.code(201).send({ offer: serializeOffer(row, { orderLegacyId: order.legacy_id }) });
  });

  // GET /api/v1/matching/offers?orderId=… — OWNER-ONLY list (the passenger choosing a driver).
  app.get('/offers', {
    schema: {
      querystring: {
        type: 'object',
        required: ['orderId'],
        properties: { orderId: { type: 'string', minLength: 1, maxLength: 200 } },
      },
    },
  }, async (req, reply) => {
    const viewer = await req.resolveUser();
    if (req.authError) return problem(reply, 503, 'SESSION_LOOKUP_FAILED', 'session lookup failed', true);
    if (!viewer) return problem(reply, 401, 'UNAUTHENTICATED', 'authentication required');

    const order = await findOrderByLegacyId(app.db, req.query.orderId);
    if (!order) return problem(reply, 404, 'ORDER_NOT_FOUND', 'order not found');
    if (String(order.passenger_id) !== String(viewer.userId)) {
      return problem(reply, 403, 'FORBIDDEN', 'only the order owner can list its offers');
    }
    const rows = await listOffersByOrder(app.db, order.id);
    return { items: rows.map((r) => serializeOffer(r, { orderLegacyId: order.legacy_id })) };
  });

  // POST /api/v1/matching/select — transactional accept (target→accepted, peers→rejected, write
  // assignment, order→ACCEPTED). Lands in R05 (#784); dark until then.
  app.post('/select', async (req, reply) =>
    problem(reply, 501, 'NOT_IMPLEMENTED', 'matching select is not implemented yet'));
}
