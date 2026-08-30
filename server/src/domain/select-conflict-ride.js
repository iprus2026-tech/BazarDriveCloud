// /server/src/domain/select-conflict-ride.js — BD-RIDE-SELECT-CONFLICT-RIDE-INVARIANT-01A,
// timestamp precision hardened by BD-RIDE-SELECT-CONFLICT-RIDE-PG-PRECISION-01B.
//
// Pure validator for the ON CONFLICT (trip_id) DO NOTHING path in POST
// /api/v1/matching/select (services/matching/index.js). When bootstrapRide() finds a
// pre-existing `trip_id`, the caller re-reads that row under `SELECT ... FOR UPDATE`
// (rides.lockConflictRideForSelection, held until the select transaction's
// COMMIT/ROLLBACK) and must prove the row is byte-for-byte the SAME logical Ride the
// current selection would have minted — a coherent ACK requires exact identity, not
// merely "a Ride exists at this tripId". No I/O here: this module only compares an
// already-locked row against the already-computed seed, so it is unit-testable without a
// database.
//
// Field taxonomy (every listed column is checked; nothing is inferred from silence):
//   - linkage/seed fields — must equal what buildRideSeed(order, acceptedOffer) would have
//     inserted. UUID columns compare canonically lowercased (Postgres uuid equality and
//     this route's validation are case-insensitive; the serializers always emit lowercase,
//     so a legacy/imported mixed-case UUID must not be treated as a mismatch).
//   - serializer-only stale columns — fields bootstrapRide() never sets (no seed value
//     exists for them). A fresh bootstrap always leaves them NULL; anything else on the
//     conflict row means some other process already touched a dimension this selection
//     knows nothing about, so the row cannot be blindly reused as this ACK's Ride.
//   - fresh-lifecycle columns — a DRIVER_EN_ROUTE ride must not yet have advanced; any of
//     these being stamped means the row is not a freshly-bootstrapped match.
//   - core timestamp facts — presence, `created_at <= accepted_at`, `accepted_at <=
//     updated_at`, and `accepted_at` matching the EXACT instant this same select
//     transaction's markOrderAccepted() produced are each computed by PostgreSQL itself,
//     inside the SAME locked, joined query (rides.lockConflictRideForSelection), at full
//     native `timestamptz` precision. This validator only requires each of those four
//     facts to be the strict boolean `true` — it never re-derives equality or chronology
//     from a JS `Date`. node-postgres's default `timestamptz` type parser truncates to
//     millisecond resolution, so re-deriving these facts in JS could silently equate two
//     genuinely distinct PostgreSQL instants within the same millisecond, or miss a
//     microsecond-only chronology violation; deriving them in SQL instead closes that gap.
//     (Postgres now() is constant per-transaction, so a genuine conflict — necessarily
//     committed by an earlier, different transaction — practically never satisfies the
//     equality fact. That practical near-certainty is not a reason to skip the other
//     checks: a conflict row could theoretically carry correct linkage/status/snapshot
//     values from a previous, legitimate bootstrap of the exact same order, so every field
//     is still verified independently.)
//
// Any single failure is reported by the FIRST reason encountered (table-driven tests pin
// one mismatch at a time to a distinct reason string) so the caller can throw a specific,
// loggable — but never client-facing — diagnostic before forcing ROLLBACK.

// snake_case DB column -> camelCase buildRideSeed() key. `status` is included even though
// the seed always hardcodes 'DRIVER_EN_ROUTE': comparing it here, uniformly with every
// other linkage field, both encodes "must be DRIVER_EN_ROUTE" and keeps one code path.
const SEED_FIELD_MAP = Object.freeze({
  trip_id: 'tripId',
  order_id: 'orderId',
  status: 'status',
  role: 'role',
  driver_user_id: 'driverUserId',
  passenger_user_id: 'passengerUserId',
  passenger_name: 'passengerName',
  passenger_initials: 'passengerInitials',
  passenger_phone_masked: 'passengerPhoneMasked',
  passenger_note: 'passengerNote',
  driver_name: 'driverName',
  driver_car: 'driverCar',
  driver_rating: 'driverRating',
  route_pickup_label: 'routePickupLabel',
  route_dropoff_label: 'routeDropoffLabel',
  order_offer_price: 'orderOfferPrice',
  ride_price: 'ridePrice',
});

// UUID-typed columns among the linkage/seed set (migrations/0001: order_id, driver_user_id,
// passenger_user_id are UUID; every other SEED_FIELD_MAP column is TEXT). trip_id is the
// TEXT business key, not a UUID, and is compared verbatim.
const UUID_COLUMNS = Object.freeze(new Set(['order_id', 'driver_user_id', 'passenger_user_id']));

// Columns bootstrapRide() never sets (no INSERT column, no seed key). A genuinely fresh
// bootstrap always leaves these NULL; a non-null value here means the conflict row has
// drifted since it was minted.
const STALE_ONLY_NULL_COLUMNS = Object.freeze([
  'passenger_rating',
  'driver_initials',
  'route_eta_to_pickup',
  'route_eta_to_destination',
  'cancel_by',
  'cancel_reason',
]);

// Post-DRIVER_EN_ROUTE lifecycle timestamps — must all still be unset on a fresh ride.
const LIFECYCLE_TIMESTAMP_COLUMNS = Object.freeze([
  'approaching_at',
  'arrived_at',
  'started_at',
  'completed_at',
  'canceled_at',
]);

function normalizeUuid(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

// Canonical TEXT/nullable comparison: `undefined` (a seed key that was never set) is
// treated as `null`, matching what an absent/omitted INSERT column would have persisted.
// None of the SEED_FIELD_MAP columns are NUMERIC in the schema today (order_offer_price /
// ride_price are formatted display TEXT), so no numeric coercion is needed; if a future
// migration changes that, this is the single seam to extend.
function normalizeCanonical(value) {
  return value === undefined ? null : value;
}

function fieldsEqual(column, rideValue, seedValue) {
  if (UUID_COLUMNS.has(column)) return normalizeUuid(rideValue) === normalizeUuid(seedValue);
  return normalizeCanonical(rideValue) === normalizeCanonical(seedValue);
}

function fail(reason) {
  return { ok: false, reason };
}

// The four PostgreSQL-derived boolean facts rides.lockConflictRideForSelection computes
// inside its locked, joined query, each mapped to the reason reported on failure. Every
// value is required to be the strict boolean `true`: `false`, `null` (a missing timestamp
// makes the underlying SQL comparison NULL, not false — see the header note), `undefined`
// (an absent/malformed field), or any other non-boolean value all fail closed identically.
// This is intentionally the ONLY place these four facts are consulted — no raw
// created_at/accepted_at/updated_at value on `ride` is ever read for equality or
// chronology here, so a JS Date can never override what PostgreSQL already decided.
const PG_TIMESTAMP_FACTS = Object.freeze([
  ['pg_has_core_timestamps', 'missing_core_timestamps'],
  ['pg_created_le_accepted', 'created_at<=accepted_at'],
  ['pg_accepted_le_updated', 'accepted_at<=updated_at'],
  ['pg_accepted_at_matches_order', 'accepted_at_matches_order'],
]);

// validateConflictRideInvariant({ ride, seed }) — pure, synchronous.
//   ride — the locked conflict row (`rides.lockConflictRideForSelection` result), or null.
//   seed — buildRideSeed(order, acceptedOffer)'s return value for THIS select.
// Returns { ok: true, reason: null } or { ok: false, reason: '<first failing field>' }.
export function validateConflictRideInvariant({ ride, seed }) {
  if (!ride) return fail('missing');

  for (const [column, seedKey] of Object.entries(SEED_FIELD_MAP)) {
    if (!fieldsEqual(column, ride[column], seed[seedKey])) return fail(column);
  }

  for (const column of STALE_ONLY_NULL_COLUMNS) {
    if (ride[column] !== null && ride[column] !== undefined) return fail(column);
  }

  for (const column of LIFECYCLE_TIMESTAMP_COLUMNS) {
    if (ride[column] !== null && ride[column] !== undefined) return fail(column);
  }

  for (const [field, reason] of PG_TIMESTAMP_FACTS) {
    if (ride[field] !== true) return fail(reason);
  }

  return { ok: true, reason: null };
}

// Thrown by the orchestration (services/matching/index.js) on any invariant failure. A
// plain Error subtype with no `.statusCode`, so Fastify's existing global error handler
// (error-handler.js) falls through to its generic 500 INTERNAL branch unmodified — the
// reason/tripId are for server logs only and are never serialized to the client.
export class SelectConflictRideInvariantError extends Error {
  constructor(tripId, reason) {
    super(`select conflict Ride invariant failed for ${tripId}: ${reason}`);
    this.name = 'SelectConflictRideInvariantError';
    this.tripId = tripId;
    this.reason = reason;
  }
}
