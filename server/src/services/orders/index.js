// /server/src/services/orders/index.js — #1 Order Dispatcher (BD-DOCS-023), LIVE in R03 of
// #784. Routes (mounted at /api/v1/orders):
//   GET  /  -> { items: [order] }   PUBLIC — the feed / nearby read (CREATED only, newest first,
//                                   per-viewer isCurrentUser). The PWA feed seam (R13) calls this.
//   POST /  -> 201 { order }        REQUIRES a verified session — the passenger creating the order.
//
// Geo "nearby" is #4 (deferred): today the list is newest CREATED. Identity is recomputed per
// request (never trusts a client-sent authorId / isCurrentUser). The PWA write cutover is R18;
// until then only this server + tests exercise POST.
import { newOrderId } from '../../infra/ids.js';
import { serializeOrder } from '../../serialize.js';
import { insertOrder, listCreatedOrders } from '../../repositories/orders.js';

// A route point. The SHIPPED client stores { id, label } today (order_map_draft.js / composer.js)
// and the route-picker adds { hint, source, coords }; typed lng/lat geo is #4 (deferred, coords is
// null today). The EXACT point shape is frozen at the R18 write cutover, so this accepts the
// current client fields and tolerates forward-compatible additions — NO additionalProperties:false,
// which would 400 every real createRideOrder payload over its extra `id`/`hint`/`source`/`coords`
// (Codex #789). The value is stored as opaque JSONB and only `.label` is read by the feed today,
// so `label` is the one required, bounded field; the rest are length/range-bounded.
const POINT = {
  type: 'object',
  required: ['label'],
  properties: {
    label: { type: 'string', minLength: 1, maxLength: 200 },
    id: { type: ['string', 'null'], maxLength: 200 },
    hint: { type: 'string', maxLength: 500 },
    source: { type: 'string', maxLength: 50 },
    coords: { type: ['object', 'array', 'null'] },
    lng: { type: 'number', minimum: -180, maximum: 180 },
    lat: { type: 'number', minimum: -90, maximum: 90 },
  },
};

export default async function ordersService(app) {
  // GET /api/v1/orders — public feed/nearby read. Resolving the viewer is OPTIONAL (anonymous
  // browse is allowed); it only drives the per-viewer isCurrentUser recompute in serializeOrder.
  app.get('/', async (req, reply) => {
    const viewer = await req.resolveUser();
    // A token WAS presented but its lookup failed (DB outage) — surface it as retryable, never a
    // misleading anonymous feed where the owner's own orders read as not-theirs (Codex #789).
    // Mirrors the /auth/session and POST contracts (plugins/auth.js).
    if (req.authError) {
      return reply.code(503).send({ error: 'session lookup failed', code: 'SESSION_LOOKUP_FAILED', retryable: true });
    }
    const rows = await listCreatedOrders(app.db, { limit: 50 });
    return { items: rows.map((row) => serializeOrder(row, { viewerId: viewer?.userId ?? null })) };
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
    const row = await insertOrder(app.db, {
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
    return reply.code(201).send({ order: serializeOrder(row, { viewerId: viewer.userId }) });
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
