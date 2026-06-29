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
import { serializeOffer, serializeOrder, serializeAssignment, serializeRide } from '../../serialize.js';
import { findOrderByLegacyId, lockOrderByLegacyId, markOrderAccepted } from '../../repositories/orders.js';
import { upsertOffer, findOfferByOrderDriver, listOffersByOrder, acceptOffer, rejectPeerOffers } from '../../repositories/offers.js';
import { insertAssignment } from '../../repositories/assignment.js';
import { bootstrapRide, findRideByTripId } from '../../repositories/rides.js';

// Format a NUMERIC rub amount as the client's display label ('800 ₽', '1 480 ₽'), matching the
// client's `${n.toLocaleString('ru-RU')} ₽`. Returns null for a non-finite value.
function formatRub(numeric) {
  const n = Number(numeric);
  return Number.isFinite(n) ? `${n.toLocaleString('ru-RU')} ₽` : null;
}

// Project the accepted order + offer into the ride seed (R10). This is the PASSENGER-select path, so
// it mirrors the client's buildPassengerActiveRide (responses.js): the agreed fare comes from the
// ACCEPTED driver's bid (offer.price), falling back to the order's estimate only when the offer
// carried no price — `driver.price || request.price`. tripId = trip_<orderId>; route labels off the
// order points; the passenger from the order's stored snapshot (neutral 'Пассажир' when absent); the
// driver name/car/rating from the accepted offer. Status DRIVER_EN_ROUTE = the select handoff status.
function buildRideSeed(order, offer) {
  const snap = (order.passenger_snapshot && typeof order.passenger_snapshot === 'object') ? order.passenger_snapshot : {};
  const name = typeof snap.name === 'string' && snap.name.trim() ? snap.name.trim() : 'Пассажир';
  const initials = typeof snap.initials === 'string' && snap.initials.trim() ? snap.initials.trim() : name.charAt(0).toUpperCase();
  const label = (point, fallback) => (point && typeof point.label === 'string' && point.label.trim() ? point.label.trim() : fallback);
  // Agreed fare: the accepted offer's bid wins over the passenger's original estimate (Codex/#784 R10).
  const price = offer.price != null ? formatRub(offer.price) : (order.estimated_price_label || null);
  return {
    tripId: `trip_${order.legacy_id}`,
    orderId: order.id,
    status: 'DRIVER_EN_ROUTE',
    role: 'passenger',
    driverUserId: offer.driver_id,
    passengerUserId: order.passenger_id,
    passengerName: name,
    passengerInitials: initials,
    passengerPhoneMasked: typeof snap.phoneMasked === 'string' ? snap.phoneMasked : null,
    passengerNote: typeof snap.comment === 'string' ? snap.comment : (order.comment ?? null),
    driverName: offer.driver_name ?? null,
    driverCar: offer.car ?? null,
    driverRating: offer.rating ?? null,
    routePickupLabel: label(order.pickup, 'Точка подачи'),
    routeDropoffLabel: label(order.dropoff, 'Точка назначения'),
    // Both order.offerPrice and ride.price carry the agreed bid (mirrors buildPassengerActiveRide),
    // so the history fare COALESCE(payment_amount, ride_price, order_offer_price) reads it correctly.
    orderOfferPrice: price,
    ridePrice: price,
  };
}

const OFFER_TTL_MIN = 15; // mirrors the client DEFAULT_OFFER_TTL_MIN

const problem = (reply, status, code, error, retryable = false) =>
  reply.code(status).send({ error, code, retryable });

// driverId is compared against a uuid column (offers.driver_id); a non-uuid string makes Postgres
// raise 22P02 at bind time (surfacing as a retryable 500). Guard the shape so a malformed driver id
// is a clean 404 (no such offer), never a 500.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    // Serialize offer creation WITH /select: lock the order row (the same FOR UPDATE the accept
    // takes) and re-check status UNDER the lock, so a concurrent select can't accept the order
    // between an unlocked status read and the insert — which would otherwise leave a live 'sent'
    // offer on an already-ACCEPTED order, after rejectPeerOffers has run (Codex #791). The
    // idempotent upsert runs in the same tx.
    const result = await app.db.tx(async (client) => {
      const order = await lockOrderByLegacyId(client, b.orderId);
      if (!order) return { err: [404, 'ORDER_NOT_FOUND', 'order not found'] };
      // A passenger cannot offer on their OWN order — no self-candidate (Codex #790).
      if (String(order.passenger_id) === String(viewer.userId)) {
        return { err: [403, 'CANNOT_OFFER_OWN_ORDER', 'cannot offer on your own order'] };
      }
      if (order.status !== 'CREATED') return { err: [409, 'ORDER_NOT_OPEN', 'order is not open for offers'] };
      // Idempotent: upsert creates a fresh 'sent' offer or re-sends a withdrawn one; a no-op
      // conflict (already 'sent' or terminal) returns no row, so read the existing one back.
      let row = await upsertOffer(client, {
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
      if (!row) row = await findOfferByOrderDriver(client, order.id, viewer.userId);
      return { ok: row, orderLegacyId: order.legacy_id };
    });
    if (result.err) return problem(reply, result.err[0], result.err[1], result.err[2]);
    return reply.code(201).send({ offer: serializeOffer(result.ok, { orderLegacyId: result.orderLegacyId }) });
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

  // POST /api/v1/matching/select — the OWNER (passenger) accepts a driver's offer. ONE transaction:
  // lock the order, accept the target offer, reject the peers, write the ACCEPTED assignment, and
  // flip the order CREATED -> ACCEPTED. The FOR UPDATE lock serializes concurrent selects so exactly
  // one wins (the rest see a non-CREATED order and 409). LIVE in R05 (#784).
  app.post('/select', {
    schema: {
      body: {
        type: 'object',
        required: ['orderId', 'driverId'],
        additionalProperties: false,
        properties: {
          orderId: { type: 'string', minLength: 1, maxLength: 200 },
          driverId: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
    },
  }, async (req, reply) => {
    const viewer = await req.resolveUser();
    if (req.authError) return problem(reply, 503, 'SESSION_LOOKUP_FAILED', 'session lookup failed', true);
    if (!viewer) return problem(reply, 401, 'UNAUTHENTICATED', 'authentication required');

    const { orderId, driverId } = req.body;
    const result = await app.db.tx(async (client) => {
      const order = await lockOrderByLegacyId(client, orderId);
      if (!order) return { err: [404, 'ORDER_NOT_FOUND', 'order not found'] };
      if (String(order.passenger_id) !== String(viewer.userId)) {
        return { err: [403, 'FORBIDDEN', 'only the order owner can select a driver'] };
      }
      // (Self-select can't normally arise — R04 blocks self-offers — but reject it explicitly too.
      // Compare case-INSENSITIVELY: Postgres uuid equality in acceptOffer is case-insensitive, so a
      // mixed-case driverId must not slip past this JS guard onto a legacy/imported self-offer (Codex #791).
      if (String(driverId).toLowerCase() === String(viewer.userId).toLowerCase()) {
        return { err: [400, 'CANNOT_SELECT_SELF', 'cannot select yourself as the driver'] };
      }
      // Re-checked UNDER the lock: a concurrent select that already accepted flips this to ACCEPTED.
      if (order.status !== 'CREATED') return { err: [409, 'ORDER_NOT_OPEN', 'order is not open for selection'] };
      // A malformed (non-uuid) driverId can have no offer — return 404 rather than letting it hit
      // the uuid column and raise a pg cast error (500).
      if (!UUID_RE.test(driverId)) return { err: [404, 'OFFER_NOT_FOUND', 'no live offer from that driver'] };

      const accepted = await acceptOffer(client, order.id, driverId);
      if (!accepted) return { err: [404, 'OFFER_NOT_FOUND', 'no live offer from that driver'] };
      await rejectPeerOffers(client, order.id, driverId);
      const assignment = await insertAssignment(client, { orderId: order.id, selectedDriverId: driverId });
      const updatedOrder = await markOrderAccepted(client, order.id);
      // R10 — assignment->ride bootstrap: mint the rides row in the SAME tx so accept and ride
      // creation are atomic (no order is ACCEPTED without its ride). The ride is what /ride-state
      // (R06), chat-by-trip (R07) and history (R08) key off.
      let ride = await bootstrapRide(client, buildRideSeed(order, accepted));
      if (!ride) ride = await findRideByTripId(client, `trip_${order.legacy_id}`);
      return { ok: { order: updatedOrder, accepted, assignment, ride } };
    });

    if (result.err) return problem(reply, result.err[0], result.err[1], result.err[2]);
    return reply.code(200).send({
      order: serializeOrder(result.ok.order, { viewerId: viewer.userId }),
      offer: serializeOffer(result.ok.accepted, { orderLegacyId: orderId }),
      assignment: serializeAssignment(result.ok.assignment, { orderLegacyId: orderId }),
      ride: serializeRide(result.ok.ride),
    });
  });
}
