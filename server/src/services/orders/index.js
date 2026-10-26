// /server/src/services/orders/index.js — #1 Order Dispatcher (BD-DOCS-023), LIVE in R03 of
// #784. Routes (mounted at /api/v1/orders):
//   GET  /  -> { items: [order] }   REQUIRES a session (BD-ORDERS-PUBLIC-PROJECTION-01 #1125: 401
//                                   without one) — the feed / nearby read (CREATED only, newest first).
//                                   The owner sees an order in full; everyone else gets the public
//                                   projection (street without the house, no coordinates, no comment;
//                                   serialize.js). The PWA feed seam (R13) calls this.
//   POST /  -> 201 { order }        REQUIRES a session with a granted, active passenger role and a
//                                   verified phone (BD-AUTH-POLICY-01B-C; 403 PASSENGER_ROLE_REQUIRED).
//                                   At most 5 open (CREATED) orders per passenger (#1125 R6); a sixth
//                                   -> 409 ORDER_LIMIT.
//   POST /:orderId/cancel -> 200 { order }   the owner cancels an order that has no driver yet
//                                   (CREATED -> CANCELED; open offers rejected). Repeat -> 200.
//                                   An order with a driver (ACCEPTED or later, or CANCELED through
//                                   its ride) -> 409 ORDER_NOT_CANCELABLE (cancel the ride).
//
// Geo "nearby" is #4 (deferred): today the list is newest CREATED. Identity is recomputed per
// request (never trusts a client-sent authorId / isCurrentUser). The PWA write cutover is R18;
// until then only this server + tests exercise POST.
import { newOrderId } from '../../infra/ids.js';
import { serializeOrder } from '../../serialize.js';
import {
  insertOrder, listCreatedOrders, lockOrderByLegacyId, cancelCreatedOrder,
  lockPassengerOrders, countOpenOrdersByPassenger,
} from '../../repositories/orders.js';
import { rejectOpenOffersOnOrderCancel } from '../../repositories/offers.js';
import { findAssignmentByOrderId } from '../../repositories/assignment.js';
import { resolveActorAuthority, requirePassengerActor, roleAuthorityProblem } from '../auth/authority.js';

// A route point — strict since BD-ORDERS-PUBLIC-PROJECTION-01 (#1125, owner's decision R5). The
// shipped client sends { id, label } plus, when it has them, the flat geo fields of
// passenger_order_utils.enrichOrderPointWithCoords (lng, lat, provenance, capturedAt,
// accuracyMeters); older paths may still carry { hint, source, coords }. Exactly those fields are
// allowed (additionalProperties:false — the reason Codex #789 kept it open is covered by listing
// every field the client sends), each bounded; `coords` is only an object of the same geo fields.
const PROVENANCE = {
  type: 'string',
  enum: ['device_fix', 'user_pin', 'geocode_point', 'provider_routable_point', 'mock_hash', 'simulation', 'unknown'],
};
const GEO_FIELDS = {
  lng: { type: 'number', minimum: -180, maximum: 180 },
  lat: { type: 'number', minimum: -90, maximum: 90 },
  provenance: PROVENANCE,
  // Epoch milliseconds (geo_point.js isEpochMilliseconds).
  capturedAt: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
  accuracyMeters: { type: 'number', minimum: 0, maximum: 100000 },
};
const POINT = {
  type: 'object',
  required: ['label'],
  additionalProperties: false,
  properties: {
    label: { type: 'string', minLength: 1, maxLength: 200 },
    id: { type: ['string', 'null'], maxLength: 200 },
    hint: { type: 'string', maxLength: 500 },
    source: { type: 'string', maxLength: 50 },
    coords: { type: ['object', 'null'], additionalProperties: false, properties: GEO_FIELDS },
    ...GEO_FIELDS,
  },
};
// #1125 R6 — open (CREATED) orders a passenger may have at once.
const OPEN_ORDER_LIMIT = 5;

export default async function ordersService(app) {
  // GET /api/v1/orders — the feed/nearby read, for signed-in viewers only (#1125 R1). The viewer
  // decides the projection per order in serializeOrder (owner: exact; everyone else: public).
  app.get('/', async (req, reply) => {
    const viewer = await req.resolveUser();
    // A token WAS presented but its lookup failed (DB outage) — surface it as retryable (Codex
    // #789). Mirrors the /auth/session and POST contracts (plugins/auth.js).
    if (req.authError) {
      return reply.code(503).send({ error: 'session lookup failed', code: 'SESSION_LOOKUP_FAILED', retryable: true });
    }
    if (!viewer) {
      return reply.code(401).send({ error: 'authentication required', code: 'UNAUTHENTICATED', retryable: false });
    }
    const rows = await listCreatedOrders(app.db, { limit: 50 });
    return { items: rows.map((row) => serializeOrder(row, { viewerId: viewer.userId })) };
  });

  // POST /api/v1/orders — create an order owned by the authenticated passenger.
  app.post('/', {
    schema: {
      body: {
        type: 'object',
        // A usable ride order needs both route ends — reject empty/null-route bodies up front
        // (Codex #789) so an authenticated {} can't publish an unusable CREATED order to the feed.
        required: ['pickup', 'dropoff'],
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['ride_order', 'passenger_request'] },
          source: { type: 'string', enum: ['feed', 'map'] },
          pickup: POINT,
          dropoff: POINT,
          // maxima match the column domains (NUMERIC(10,3) / INTEGER / NUMERIC(12,2)) so an
          // over-range value is a 400 VALIDATION here, not a pg overflow surfaced as a retryable
          // 500 INTERNAL (which the client's «Повторить» would loop on).
          distanceKm: { type: 'number', minimum: 0, maximum: 9999999.999 },
          durationMin: { type: 'integer', minimum: 0, maximum: 2147483647 },
          estimatedPrice: { type: 'number', minimum: 0, maximum: 9999999999.99 },
          estimatedPriceLabel: { type: 'string', maxLength: 64 },
          scheduledMode: { type: 'string', enum: ['now', 'later'] },
          scheduledAt: { type: 'string', maxLength: 64 },
          scheduledLabel: { type: 'string', maxLength: 64 },
          comment: { type: 'string', maxLength: 1000 },
          passenger: { type: ['object', 'null'] },
        },
      },
    },
  }, async (req, reply) => {
    const viewer = await req.resolveUser();
    // A presented-but-unresolvable token (DB outage) is retryable, never a silent anonymous
    // create — mirror the /auth/session contract (plugins/auth.js).
    if (req.authError) {
      return reply.code(503).send({ error: 'session lookup failed', code: 'SESSION_LOOKUP_FAILED', retryable: true });
    }
    if (!viewer) {
      return reply.code(401).send({ error: 'authentication required', code: 'UNAUTHENTICATED', retryable: false });
    }

    const b = req.body;
    const result = await app.db.tx(async (client) => {
      // Passenger authority first (contract §4), on the same tx client as the insert.
      const authority = requirePassengerActor(await resolveActorAuthority(client, viewer));
      if (!authority.ok) return { err: roleAuthorityProblem(authority, 'passenger') };
      // #1125 R6: count this passenger's open orders under a per-passenger lock, so two concurrent
      // creates cannot both pass the same count.
      await lockPassengerOrders(client, viewer.userId);
      if (await countOpenOrdersByPassenger(client, viewer.userId) >= OPEN_ORDER_LIMIT) {
        return { err: [409, 'ORDER_LIMIT', `at most ${OPEN_ORDER_LIMIT} open orders at a time`, false] };
      }
      const row = await insertOrder(client, {
        legacyId: newOrderId(),
        passengerId: viewer.userId,
        type: b.type ?? 'passenger_request',
        source: b.source ?? 'map',
        pickup: b.pickup ?? null,
        dropoff: b.dropoff ?? null,
        distanceKm: b.distanceKm ?? 0,
        durationMin: b.durationMin ?? 0,
        estimatedPrice: b.estimatedPrice ?? 0,
        estimatedPriceLabel: b.estimatedPriceLabel ?? '',
        scheduledMode: b.scheduledMode ?? 'now',
        scheduledAt: b.scheduledAt ?? '',
        scheduledLabel: b.scheduledLabel ?? '',
        comment: b.comment ?? '',
        passengerSnapshot: sanitizeSnapshot(b.passenger, viewer.userId),
      });
      return { row };
    });
    if (result.err) {
      const [status, code, error, retryable] = result.err;
      return reply.code(status).send({ error, code, retryable });
    }
    return reply.code(201).send({ order: serializeOrder(result.row, { viewerId: viewer.userId }) });
  });

  // POST /api/v1/orders/:orderId/cancel — #1049: the owner withdraws an order before any driver is
  // selected. Passenger authority first (contract §4), then the order lock; the order and its open
  // offers change in one transaction. An order that already has a driver is canceled through its
  // ride (PATCH /ride-state/…/status), which moves the order too (#1051).
  app.post('/:orderId/cancel', {
    schema: {
      params: {
        type: 'object',
        required: ['orderId'],
        properties: { orderId: { type: 'string', minLength: 1, maxLength: 200 } },
      },
    },
  }, async (req, reply) => {
    const viewer = await req.resolveUser();
    if (req.authError) {
      return reply.code(503).send({ error: 'session lookup failed', code: 'SESSION_LOOKUP_FAILED', retryable: true });
    }
    if (!viewer) {
      return reply.code(401).send({ error: 'authentication required', code: 'UNAUTHENTICATED', retryable: false });
    }
    const result = await app.db.tx(async (client) => {
      const authority = requirePassengerActor(await resolveActorAuthority(client, viewer));
      if (!authority.ok) return { err: roleAuthorityProblem(authority, 'passenger') };
      const order = await lockOrderByLegacyId(client, req.params.orderId);
      if (!order) return { err: [404, 'ORDER_NOT_FOUND', 'order not found', false] };
      if (String(order.passenger_id) !== String(viewer.userId)) {
        return { err: [403, 'FORBIDDEN', 'only the order owner can cancel it', false] };
      }
      // An order with a driver (an assignment exists, even after its ride was canceled) is
      // canceled through the ride; only this route's own cancel repeats idempotently.
      const notCancelable = [409, 'ORDER_NOT_CANCELABLE', 'the order already has a driver; cancel the ride instead', false];
      if (await findAssignmentByOrderId(client, order.id)) return { err: notCancelable };
      if (order.status === 'CANCELED') return { row: order };
      if (order.status !== 'CREATED') return { err: notCancelable };
      const canceled = await cancelCreatedOrder(client, order.id);
      await rejectOpenOffersOnOrderCancel(client, order.id);
      return { row: canceled };
    });
    if (result.err) {
      const [status, code, error, retryable] = result.err;
      return reply.code(status).send({ error, code, retryable });
    }
    return reply.code(200).send({ order: serializeOrder(result.row, { viewerId: viewer.userId }) });
  });
}

// Store a passenger snapshot whose authorId is the AUTHENTICATED owner (never a client-sent one),
// and WITHOUT isCurrentUser (that is per-viewer, recomputed on every read by serializeOrder).
function sanitizeSnapshot(input, ownerId) {
  const s = (input && typeof input === 'object') ? input : {};
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
  return {
    name: str(s.name, 120),
    initials: str(s.initials, 8),
    phoneMasked: str(s.phoneMasked, 32),
    comment: str(s.comment, 1000),
    authorId: ownerId,
  };
}
