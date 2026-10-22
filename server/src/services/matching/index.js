// /server/src/services/matching/index.js — #3 Matching (BD-DOCS-023), partially LIVE in R04 of
// #784. Routes (mounted at /api/v1/matching):
//   POST /offers  -> 201 { offer }   a granted, active driver offers on an open order;
//                                     idempotent per (order, driver); re-sends a withdrawn offer.
//   GET  /offers?orderId=<legacyId> -> { items:[offer] }   OWNER-ONLY (the order's passenger).
//   POST /select  -> 200 { order, offer, assignment, ride }  OWNER-ONLY transactional accept [LIVE].
//
// Identity is recomputed per request; ownership is re-validated server-side (BD-DOCS-032 dec. 4).
// BD-RIDE-AUTHORITY-01B-A (docs/ride-state-receipt-authority-contract.md §2): POST /offers requires a
// granted, active driver role — current grants are read from users.roles inside the offer tx, BEFORE
// the order lookup, so a non-driver learns nothing about order existence. BD-AUTH-POLICY-01B-C
// (docs/driver-role-grant-contract.md §4): GET /offers and /select require a granted, active passenger
// role, checked the same way before any order lookup; their owner checks are unchanged. /select also
// re-checks that the selected driver still holds the driver grant (409 DRIVER_NOT_ELIGIBLE).
import { newOfferId } from '../../infra/ids.js';
import { resolveActorAuthority, requireDriverActor, requirePassengerActor, roleAuthorityProblem } from '../auth/authority.js';
import { lockUserGrantsForShare } from '../../repositories/users.js';
import { serializeOffer, serializeOrder, serializeAssignment, serializeRide, serializeRecoveredOffer } from '../../serialize.js';
import { findOrderByLegacyId, lockOrderByLegacyId, markOrderAccepted } from '../../repositories/orders.js';
import { upsertOffer, findOfferByOrderDriver, findLiveOfferByOrderDriver, listOffersByOrder, acceptOffer, rejectPeerOffers } from '../../repositories/offers.js';
import { insertAssignment } from '../../repositories/assignment.js';
import { bootstrapRide, lockConflictRideForSelection, findRecoveryBundleByOrderId } from '../../repositories/rides.js';
import { validateConflictRideInvariant, SelectConflictRideInvariantError } from '../../domain/select-conflict-ride.js';
import { validateRecoveryLinkage } from '../../domain/select-recovery-linkage.js';
import { rideOrderComment } from '../../domain/ride-order-comment.js';
import { normalizeVehiclePlate, normalizeVehicleText, VEHICLE_PLATE_MAX_LENGTH } from '../../domain/vehicle-plate.js';

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
// The passenger note is the order comment the driver reads (#1052; domain/ride-order-comment.js).
// The car (model / colour / full plate) is the accepted offer's, for the passenger's pickup check (#1113).
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
    passengerNote: rideOrderComment(order),
    driverName: offer.driver_name ?? null,
    driverCar: offer.car ?? null,
    driverRating: offer.rating ?? null,
    vehicleModel: offer.vehicle_model ?? null,
    vehicleColor: offer.vehicle_color ?? null,
    vehiclePlate: offer.vehicle_plate ?? null,
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
          // #1113 — the car as separate fields; the plate is required (the passenger's pickup check).
          vehicleModel: { type: 'string', maxLength: 120 },
          vehicleColor: { type: 'string', maxLength: 60 },
          vehiclePlate: { type: 'string', maxLength: 40 },
        },
      },
    },
  }, async (req, reply) => {
    const viewer = await req.resolveUser();
    if (req.authError) return problem(reply, 503, 'SESSION_LOOKUP_FAILED', 'session lookup failed', true);
    if (!viewer) return problem(reply, 401, 'UNAUTHENTICATED', 'authentication required');

    const b = req.body;
    const vehiclePlate = normalizeVehiclePlate(b.vehiclePlate);
    // Serialize offer creation WITH /select: lock the order row (the same FOR UPDATE the accept
    // takes) and re-check status UNDER the lock, so a concurrent select can't accept the order
    // between an unlocked status read and the insert — which would otherwise leave a live 'sent'
    // offer on an already-ACCEPTED order, after rejectPeerOffers has run (Codex #791). The
    // idempotent upsert runs in the same tx.
    const result = await app.db.tx(async (client) => {
      // Driver authority first (contract §2), on the same tx client as the offer write.
      const authority = requireDriverActor(await resolveActorAuthority(client, viewer));
      if (!authority.ok) return { err: roleAuthorityProblem(authority, 'driver') };
      // #1113 — no offer without the car's plate (after the driver authority, before the order).
      if (!vehiclePlate) return { err: [422, 'VEHICLE_PLATE_REQUIRED', 'the car plate is required'] };
      if (vehiclePlate.length > VEHICLE_PLATE_MAX_LENGTH) return { err: [422, 'VEHICLE_PLATE_INVALID', 'the car plate is too long'] };
      const order = await lockOrderByLegacyId(client, b.orderId);
      if (!order) return { err: [404, 'ORDER_NOT_FOUND', 'order not found'] };
      // A driver cannot offer on their OWN order — no self-candidate (Codex #790).
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
        vehicleModel: normalizeVehicleText(b.vehicleModel),
        vehicleColor: normalizeVehicleText(b.vehicleColor),
        vehiclePlate,
      });
      if (!row) row = await findOfferByOrderDriver(client, order.id, viewer.userId);
      return { ok: row, orderLegacyId: order.legacy_id };
    });
    if (result.err) return problem(reply, ...result.err);
    // The driver's own offer: the full plate they sent.
    return reply.code(201).send({ offer: serializeOffer(result.ok, { orderLegacyId: result.orderLegacyId, plate: 'full' }) });
  });

  // GET /api/v1/matching/offers?orderId=… — OWNER-ONLY list (the passenger choosing a
  // driver), reinforced by the BD-RIDE-SELECT-RECOVERY-LINKAGE-INVARIANT-01A recovery gate.
  // The existing owner-only check is unchanged and runs FIRST — it is exactly the
  // authenticated-owner proof the ride-state GET composes with (see ride-state/index.js).
  // Bypassed only in the genuinely "nothing to recover" case: the order is still CREATED AND
  // no accepted-offer/assignment/Ride footprint exists yet. Any footprint at all, or any
  // other order status, forces the gate — an ambiguous or unresolved recovery state can
  // never be read back as a plain offers list. On bypass, the response is served from the SAME
  // bundle statement that decided to bypass — never a second, later read (#938 Codex Finding A).
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

    // Passenger authority first (contract §4), before the order lookup: a driver-mode session
    // learns nothing about order existence.
    const authority = requirePassengerActor(await resolveActorAuthority(app.db, viewer));
    if (!authority.ok) return problem(reply, ...roleAuthorityProblem(authority, 'passenger'));

    const order = await findOrderByLegacyId(app.db, req.query.orderId);
    if (!order) return problem(reply, 404, 'ORDER_NOT_FOUND', 'order not found');
    if (String(order.passenger_id) !== String(viewer.userId)) {
      return problem(reply, 403, 'FORBIDDEN', 'only the order owner can list its offers');
    }

    const bundle = await findRecoveryBundleByOrderId(app.db, order.id);
    const hasFootprint = bundle.candidate_ride_count >= 1
      || bundle.assignment != null
      || (bundle.offers ?? []).some((o) => o.status === 'accepted');
    // Order-lifecycle contract: an order canceled before selection (#1049) has nothing to recover
    // either — its (rejected) offers are served the same way.
    if ((order.status === 'CREATED' || order.status === 'CANCELED') && !hasFootprint) {
      // #938 Codex Finding A — serve straight from bundle.offers, the SAME statement that just
      // computed hasFootprint above. A second, later listOffersByOrder() read here would be a
      // separate, non-atomic statement: a concurrent /select could commit between the two reads,
      // and this bypass would then serve a freshly-accepted offer without validateRecoveryLinkage()
      // ever running (a genuine TOCTOU, reproduced deterministically in the flow test). Serving the
      // bundle's own (possibly by-now-stale) snapshot instead is correct: a request whose bundle
      // predates a concurrent /select is entitled to that pre-select view; the NEXT request re-reads
      // a fresh bundle and goes through full invariant validation.
      // #1113 — the offers list is the pre-selection view: the plate is masked (the default).
      return { items: (bundle.offers ?? []).map((r) => serializeRecoveredOffer(r, { orderLegacyId: order.legacy_id })) };
    }
    if (bundle.candidate_ride_count >= 2) {
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
    // serializeOffer() has no derived/fallback fields (unlike the Ride snapshot) — the raw
    // columns ARE already authoritative, so the response is served from a fresh, plain read
    // (proper Date objects), never from the JSON-nested bundle used only for the gate above.
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
      // Passenger authority first (contract §4), on the select tx client, before the order lock.
      const authority = requirePassengerActor(await resolveActorAuthority(client, viewer));
      if (!authority.ok) return { err: roleAuthorityProblem(authority, 'passenger') };
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
      // A live offer from that driver first (acceptOffer's own predicate): without one the answer
      // is 404 whatever the account is, so the grant check below reveals nothing about accounts
      // that never offered on this order.
      if (!(await findLiveOfferByOrderDriver(client, order.id, driverId))) {
        return { err: [404, 'OFFER_NOT_FOUND', 'no live offer from that driver'] };
      }
      // The selected driver must still hold the driver grant (contract §4), before anything is
      // written. FOR SHARE serializes with a concurrent revoke, which locks the same users row FOR
      // UPDATE: the revoke either committed before this read, or waits for this selection.
      const driverGrants = await lockUserGrantsForShare(client, driverId);
      if (!driverGrants || !Array.isArray(driverGrants.roles) || !driverGrants.roles.includes('driver')) {
        return { err: [409, 'DRIVER_NOT_ELIGIBLE', 'the selected driver can no longer take this order'] };
      }

      const accepted = await acceptOffer(client, order.id, driverId);
      if (!accepted) return { err: [404, 'OFFER_NOT_FOUND', 'no live offer from that driver'] };
      await rejectPeerOffers(client, order.id, driverId);
      const assignment = await insertAssignment(client, { orderId: order.id, selectedDriverId: driverId });
      const updatedOrder = await markOrderAccepted(client, order.id);
      // R10 — assignment->ride bootstrap: mint the rides row in the SAME tx so accept and ride
      // creation are atomic (no order is ACCEPTED without its ride). The ride is what /ride-state
      // (R06), chat-by-trip (R07) and history (R08) key off.
      const seed = buildRideSeed(order, accepted);
      let ride = await bootstrapRide(client, seed);
      if (!ride) {
        // BD-RIDE-SELECT-CONFLICT-RIDE-INVARIANT-01A — a pre-existing trip_id means
        // ON CONFLICT DO NOTHING fired: some other process already wrote this row. Re-read
        // it under an exclusive row lock (rides.lockConflictRideForSelection — a
        // selection-specific seam, distinct from the Ride State PATCH chokepoint's
        // lockRideByTripId, held until this transaction's COMMIT/ROLLBACK and serializing
        // against any concurrent participant status transition on the same row) and
        // require the full direct conflict-Ride invariant before ever treating it as this
        // selection's coherent ACK. That seam also derives the accepted_at
        // equality/chronology facts inside PostgreSQL itself, joined against THIS
        // transaction's just-updated `orders` row, at full native timestamp precision
        // (BD-RIDE-SELECT-CONFLICT-RIDE-PG-PRECISION-01B) — no separate expected-instant
        // parameter is needed here. A missing/mismatched/non-DRIVER_EN_ROUTE conflict Ride
        // is a transactional invariant failure: throw (never return { err: ... }, which
        // would COMMIT) so app.db.tx()'s catch forces ROLLBACK of the accepted offer,
        // rejected peers, assignment, and order ACCEPTED transition. This slice does not
        // overwrite, clean up, or neutralize the conflicting row — rejection + full
        // rollback is the whole policy.
        const conflictRide = await lockConflictRideForSelection(client, { tripId: seed.tripId, orderId: order.id });
        const verdict = validateConflictRideInvariant({ ride: conflictRide, seed });
        if (!verdict.ok) throw new SelectConflictRideInvariantError(seed.tripId, verdict.reason);
        ride = conflictRide;
      }
      return { ok: { order: updatedOrder, accepted, assignment, ride } };
    });

    if (result.err) return problem(reply, ...result.err);
    return reply.code(200).send({
      order: serializeOrder(result.ok.order, { viewerId: viewer.userId }),
      // The passenger has just chosen this driver: the full plate, as on the ride (#1113).
      offer: serializeOffer(result.ok.accepted, { orderLegacyId: orderId, plate: 'full' }),
      assignment: serializeAssignment(result.ok.assignment, { orderLegacyId: orderId }),
      ride: serializeRide(result.ok.ride),
    });
  });
}
