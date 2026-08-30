// /server/src/domain/select-recovery-linkage.js — BD-RIDE-SELECT-RECOVERY-LINKAGE-INVARIANT-01A.
//
// Pure validator for the recovery-read gate reinforcing GET /api/v1/ride-state/rides/:tripId
// and GET /api/v1/matching/offers?orderId=... (services/ride-state, services/matching). A
// client recovering after a 409, a transport 5xx, or a reopened /responses screen must never
// be handed a Ride/offer combination this validator has not proven coherent — including for
// legacy or partially-imported rows. No I/O here: this module only judges an already-fetched
// bundle (rides.findRecoveryBundleByTripId / findRecoveryBundleByOrderId), so it is
// unit-testable without a database.
//
// Fail-closed contract: ANY non-ok verdict must be translated by the caller into
// 409 RIDE_RECOVERY_UNVERIFIED, retryable:false — the Ride/offers body is never serialized on
// failure. Candidate-count ambiguity (0-vs-1-vs-many order/Ride resolutions) is decided by the
// caller BEFORE this function is invoked (see the repository functions' candidate_*_count
// field) — this validator assumes it has already been handed exactly one unambiguous
// candidate of each kind.
//
// Field taxonomy:
//   - mandatory linkage — every identity fact (order/ride/offer/assignment ids, driver,
//     passenger, canonical trip) is required and NEVER conditionally skipped. A recovery
//     read proves authority or it proves nothing; "if present" checks would let a
//     partially-imported row (e.g. rides.order_id left null) silently pass.
//   - PostgreSQL-native timestamp facts — presence, `ride.accepted_at = order.accepted_at`,
//     and full lifecycle chronology are all computed by PostgreSQL itself inside the SAME
//     locked-free, single-statement bundle query, at full native `timestamptz` precision.
//     This validator only requires each fact to be the strict boolean `true` — it never
//     re-derives equality or chronology via JS `Date.getTime()` (BD-RIDE-SELECT-CONFLICT-
//     RIDE-PG-PRECISION-01B's exact precision-loss defect would otherwise repeat here).
//   - current-status timestamp presence — the PATCH /ride-state/rides/:tripId/status
//     chokepoint permits ANY non-terminal status to move directly to any other valid status
//     in one step (no sequential-progression gate exists server- or DB-side — see
//     services/ride-state/index.js), stamping ONLY that target status's own
//     STATUS_TIMESTAMP_FIELD column. A ride can therefore legitimately skip stages forward
//     (DRIVER_EN_ROUTE -> IN_PROGRESS, leaving approaching_at/arrived_at null) or move
//     backward (WAITING_PASSENGER -> DRIVER_EN_ROUTE, leaving arrived_at/approaching_at still
//     populated from the earlier forward progression) while remaining a perfectly valid,
//     API-committed state (confirmed live against #938's Codex finding #1). A prefix/shape
//     requirement therefore cannot distinguish a legitimate skip/backward transition from
//     corruption by row content alone — the only shape fact that holds for every reachable
//     status is that its OWN status-keyed timestamp is stamped. Every OTHER stage timestamp
//     is deliberately left unconstrained here (neither required nor forbidden).
//   - cancel field coherence — NO_SHOW is exclusively server-derived (patchRideNoShow always
//     writes the same two literals) and keeps its exact contract. CANCELED is reachable both
//     via the generic PATCH (which never touches cancel_by/reason, leaving them null) and via
//     legacy/imported rows that may carry any schema-valid actor: rides.cancel_by CHECK
//     (migrations/0001) permits 'driver' | 'passenger' | 'system' UNCONDITIONALLY, not scoped
//     to NO_SHOW, and cancel_reason has no CHECK constraint and no actor<->reason linkage in
//     the schema at all — confirmed live against #938's Codex finding #3. Every other status
//     keeps requiring both fields null.
//   - always-null columns — verified empirically: no write path (bootstrapRide,
//     patchRideStatus, patchRideNoShow) ever populates passenger_rating, driver_initials, or
//     either route ETA column, on ANY Ride, ever. A non-null value here is corruption.

import { STATUS_TIMESTAMP_FIELD } from './ride-status.js';

// Recovery-eligible Ride statuses — deliberately NARROWER than isValidRideStatus(): the four
// pre-acceptance statuses (NEW_ORDER, CONFIRMATION_PENDING, CONFIRMED, CHAT_STARTED) cannot
// legitimately coexist with an ACCEPTED order/offer/assignment chain.
const RECOVERY_ALLOWED_STATUSES = Object.freeze(new Set([
  'ACCEPTED', 'DRIVER_EN_ROUTE', 'DRIVER_APPROACHING_PICKUP', 'WAITING_PASSENGER',
  'IN_PROGRESS', 'COMPLETED', 'CANCELED', 'NO_SHOW',
]));

// camelCase STATUS_TIMESTAMP_FIELD value -> rides DB column. Mirrors services/ride-state/
// index.js's own (unexported) TS_KEY_TO_COLUMN exactly — duplicated rather than imported to
// avoid a domain->service dependency inversion.
const TS_KEY_TO_COLUMN = Object.freeze({
  acceptedAt: 'accepted_at',
  approachingAt: 'approaching_at',
  arrivedAt: 'arrived_at',
  startedAt: 'started_at',
  completedAt: 'completed_at',
  canceledAt: 'canceled_at',
});

// Actors the schema itself permits for CANCELED (rides.cancel_by CHECK). NO_SHOW is handled
// separately below with its own exact, server-derived contract.
const CANCELED_ALLOWED_ACTORS = Object.freeze(new Set(['driver', 'passenger', 'system']));

// Columns no write path (bootstrapRide / patchRideStatus / patchRideNoShow) ever populates —
// verified against repositories/rides.js directly, not assumed.
const ALWAYS_NULL_COLUMNS = Object.freeze([
  'passenger_rating', 'driver_initials', 'route_eta_to_pickup', 'route_eta_to_destination',
]);

function normalizeUuid(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}
function uuidEq(a, b) {
  return a != null && b != null && normalizeUuid(a) === normalizeUuid(b);
}
function fail(reason) {
  return { ok: false, reason };
}

function currentStatusTimestampOk(ride) {
  const tsKey = STATUS_TIMESTAMP_FIELD[ride.status];
  const column = tsKey ? TS_KEY_TO_COLUMN[tsKey] : null;
  return column != null && ride[column] != null;
}

function cancelFieldsOk(ride) {
  if (ride.status === 'NO_SHOW') return ride.cancel_by === 'driver' && ride.cancel_reason === 'passenger_no_show';
  if (ride.status === 'CANCELED') return ride.cancel_by == null || CANCELED_ALLOWED_ACTORS.has(ride.cancel_by);
  return ride.cancel_by == null && ride.cancel_reason == null;
}

// validateRecoveryLinkage({ ride, order, assignment, offers, facts }) — pure, synchronous.
//   ride       — the resolved Ride row, or null.
//   order      — the resolved Order row, or null.
//   assignment — the resolved assignment row, or null.
//   offers     — array of the order's offer rows (never null; empty array if none).
//   facts      — { pg_has_core_timestamps, pg_accepted_at_matches_order, pg_chronology_ok },
//                the PostgreSQL-native booleans from the bundle query.
// Returns { ok: true, reason: null, acceptedOffer } or { ok: false, reason: '<first failing check>' }.
export function validateRecoveryLinkage({ ride, order, assignment, offers, facts }) {
  if (!order) return fail('order_missing');
  if (order.status !== 'ACCEPTED') return fail('order_not_accepted');
  if (!ride) return fail('ride_missing');
  if (!uuidEq(ride.order_id, order.id)) return fail('ride_order_id_mismatch');
  if (ride.trip_id !== `trip_${order.legacy_id}`) return fail('trip_linkage_mismatch');
  if (ride.role !== 'passenger') return fail('role_mismatch');

  const accepted = (offers ?? []).filter((o) => o.status === 'accepted');
  if (accepted.length !== 1) return fail('accepted_offer_count');
  const [acceptedOffer] = accepted;
  if (!uuidEq(acceptedOffer.order_id, order.id)) return fail('offer_order_mismatch');

  if (!assignment) return fail('assignment_missing');
  if (assignment.status !== 'ACCEPTED') return fail('assignment_not_accepted');
  if (!uuidEq(assignment.order_id, order.id)) return fail('assignment_order_mismatch');
  if (!uuidEq(assignment.selected_driver_id, acceptedOffer.driver_id)) return fail('assignment_driver_mismatch');

  if (ride.driver_user_id == null) return fail('ride_driver_missing');
  if (!uuidEq(ride.driver_user_id, acceptedOffer.driver_id)) return fail('ride_driver_mismatch');
  if (ride.passenger_user_id == null) return fail('ride_passenger_missing');
  if (!uuidEq(ride.passenger_user_id, order.passenger_id)) return fail('ride_passenger_mismatch');

  if (!RECOVERY_ALLOWED_STATUSES.has(ride.status)) return fail('ride_status_not_recovery_eligible');

  if (facts?.pg_has_core_timestamps !== true) return fail('missing_core_timestamps');
  if (facts?.pg_accepted_at_matches_order !== true) return fail('accepted_at_matches_order');
  if (facts?.pg_chronology_ok !== true) return fail('lifecycle_chronology_violation');

  if (!currentStatusTimestampOk(ride)) return fail('current_status_timestamp_missing');
  if (!cancelFieldsOk(ride)) return fail('cancel_fields_incoherent');

  for (const col of ALWAYS_NULL_COLUMNS) {
    if (ride[col] != null) return fail('stale_column_populated');
  }

  return { ok: true, reason: null, acceptedOffer };
}
