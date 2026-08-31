// /server/src/repositories/rides.js — the ONLY module that runs SQL against `rides`
// (migration 0001). Single SQL seam (ADR BD-DOCS-041). R06 surface (#5 Ride State chokepoint):
// read a ride snapshot by its tripId, lock it for the PATCH transaction, and patch its status +
// the status-keyed timestamp. The DB trg_rides_freeze_terminal trigger is the last-line backstop
// for the terminal-freeze invariant; the service enforces it first via the domain.

export async function findRideByTripId(db, tripId) {
  const { rows } = await db.query(`SELECT * FROM rides WHERE trip_id = $1 LIMIT 1`, [tripId]);
  return rows[0] ?? null;
}

// Mint the `rides` row when an order is accepted (R10 — the assignment->ride bootstrap). Called
// INSIDE the /select transaction, so accept + assignment + order->ACCEPTED + ride creation are one
// atomic unit (the epic's "select tx mints the rides row"; no missed-bootstrap window). The ride
// starts at DRIVER_EN_ROUTE (the client's select->active-ride handoff status) with accepted_at
// stamped (its STATUS_TIMESTAMP_FIELD). ON CONFLICT (trip_id) DO NOTHING is a safety net — the
// /select CREATED-guard already means this runs once per order; the caller re-reads on the rare
// conflict. Returns the new ride, or null when a ride for that trip already existed.
export async function bootstrapRide(db, s) {
  const { rows } = await db.query(
    `INSERT INTO rides
       (trip_id, order_id, status, role, driver_user_id, passenger_user_id,
        passenger_name, passenger_initials, passenger_phone_masked, passenger_note,
        driver_name, driver_car, driver_rating, route_pickup_label, route_dropoff_label,
        order_offer_price, ride_price, accepted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now())
     ON CONFLICT (trip_id) DO NOTHING
     RETURNING *`,
    [
      s.tripId, s.orderId, s.status, s.role, s.driverUserId, s.passengerUserId,
      s.passengerName, s.passengerInitials, s.passengerPhoneMasked, s.passengerNote,
      s.driverName, s.driverCar, s.driverRating, s.routePickupLabel, s.routeDropoffLabel,
      s.orderOfferPrice, s.ridePrice,
    ],
  );
  return rows[0] ?? null;
}

// Lock the ride row inside the PATCH transaction (SELECT … FOR UPDATE) so concurrent status
// transitions serialize on the row — read-check-write can't race (and the loser re-reads the
// committed status). Returns null if no such ride.
export async function lockRideByTripId(db, tripId) {
  const { rows } = await db.query(`SELECT * FROM rides WHERE trip_id = $1 FOR UPDATE`, [tripId]);
  return rows[0] ?? null;
}

// BD-RIDE-SELECT-CONFLICT-RIDE-PG-PRECISION-01B — selection-specific locked conflict-Ride
// reread. Deliberately SEPARATE from lockRideByTripId above (which stays the Ride State PATCH
// chokepoint's own primitive, unmodified): the /select conflict path additionally needs the
// current Order's `accepted_at` in the SAME statement, so the equality/chronology facts below
// are derived by PostgreSQL itself, at full native `timestamptz` precision (microseconds),
// never round-tripped through a JS `Date` first (node-postgres's default type parser truncates
// `timestamptz` -> `Date` to millisecond resolution, which is the exact precision loss this
// slice closes). `orders` is read via a plain JOIN, not re-locked: the caller has already
// locked that row earlier in the SAME transaction (orders.lockOrderByLegacyId), and a
// transaction always sees its own uncommitted writes, so no second lock is needed here.
// `=`/`<=` against a NULL timestamp evaluate to SQL NULL (not `false`) — a missing timestamp on
// either side therefore fails every derived flag below closed, exactly like an explicit
// mismatch, with no special-casing required by the caller.
// FOR UPDATE OF r locks only the `rides` row (matches lockRideByTripId's lock target exactly,
// so the two seams still serialize against each other on the same physical row). The extra
// pg_* boolean columns are internal-only: they are not columns serializeRide() reads, so they
// never reach the API response.
export async function lockConflictRideForSelection(db, { tripId, orderId }) {
  const { rows } = await db.query(
    `SELECT r.*,
            (r.created_at IS NOT NULL AND r.accepted_at IS NOT NULL AND r.updated_at IS NOT NULL)
              AS pg_has_core_timestamps,
            (r.accepted_at = o.accepted_at) AS pg_accepted_at_matches_order,
            (r.created_at <= r.accepted_at) AS pg_created_le_accepted,
            (r.accepted_at <= r.updated_at) AS pg_accepted_le_updated
       FROM rides r
       JOIN orders o ON o.id = $2
      WHERE r.trip_id = $1
      FOR UPDATE OF r`,
    [tripId, orderId],
  );
  return rows[0] ?? null;
}

// BD-RIDE-SELECT-RECOVERY-LINKAGE-INVARIANT-01A — the recovery-read bundle. Reinforces
// GET /ride-state/rides/:tripId and GET /matching/offers?orderId= (never a new endpoint):
// both entry points resolve their counterpart row and hand the FULL bundle to
// domain/select-recovery-linkage.js. Two-tier resolution matches BOTH the canonical
// trip_<legacy_id> naming convention AND the direct FK, via a UNION+count() candidate set —
// never a bare scalar subquery, which would throw "more than one row returned by a subquery
// used as an expression" (a real cardinality 500) the instant two rows disagree. The caller
// MUST check candidate_*_count itself: 0 means no counterpart resolves at all (the row is
// genuinely standalone — the gate does not apply, today's plain read stands); 1 means a
// single, unambiguous candidate exists (proceed to the validator); >=1... actually >1 means
// ambiguous (fail closed, 409, never guess which one is "right").
//
// Each entity is nested via row_to_json() under its own key (ride/order/assignment/offers) —
// NEVER a flat `SELECT o.*, r.*, a.*`, which would collide on identically-named columns both
// `orders` and `rides` share (id, status, created_at, updated_at). node-pg's jsonb/json type
// parser turns each nested value into a plain JS object automatically, but critically their
// TIMESTAMP fields arrive as PostgreSQL's own JSON timestamp text (full microsecond
// precision, `+00:00` offset) — NOT JS Date objects, since they never pass through node-pg's
// per-column timestamptz type parser once wrapped in row_to_json(). This is fine for the
// pg_* facts below (computed directly against the raw typed columns in the SAME statement,
// never routed through the JSON nesting) but means any caller serializing these nested
// timestamps for display MUST re-normalize them locally (see serialize.js's
// serializeRecoveredRide / toIsoFromBundle) rather than trust them to already match the
// existing public ISO format — this file does not change that format itself.
//
// pg_has_core_timestamps / pg_accepted_at_matches_order / pg_chronology_ok are computed
// entirely in SQL, at full native `timestamptz` precision — mirroring
// BD-RIDE-SELECT-CONFLICT-RIDE-PG-PRECISION-01B's lockConflictRideForSelection exactly, so
// the same microsecond-truncation defect that fix closed cannot reappear here via a JS
// Date.getTime() comparison.
//
// pg_chronology_ok (BD-RIDE-SELECT-RECOVERY-LINKAGE-INVARIANT-01A, #938 Codex finding #4):
// bounds EACH populated lifecycle timestamp independently to [created_at, updated_at] — it
// does NOT compare stage timestamps against each other in positional order. An earlier design
// chained each stage against its nearest populated predecessor (approaching_at <= arrived_at
// <= started_at <= ...), assuming column POSITION corresponds to chronological order. That
// assumption is false under the authoritative write-path contract (services/ride-state/
// index.js, itself a verbatim mirror of public/src/ride_state.js's updateActiveRideStatus):
// only accepted_at is write-once; every other stage column is unconditionally overwritten on
// every re-entry into that status, and NEITHER the client NOR the server restricts backward
// transitions or forward skips (only the terminal-freeze rule applies) — confirmed live via a
// temporary-mutation reproduction (a legitimate DRIVER_EN_ROUTE -> WAITING_PASSENGER ->
// DRIVER_EN_ROUTE -> DRIVER_APPROACHING_PICKUP sequence re-stamps approaching_at LATER than
// the still-populated arrived_at, which the old positional chain wrongly rejected). The bound
// below is what the write path DOES structurally guarantee regardless of transition order:
// every timestamp it ever stamps is `now()` at write time, which by definition falls between
// the row's created_at and its own updated_at (refreshed to `now()` by trg_rides_updated_at on
// that SAME statement) — so this still rejects genuine corruption (a timestamp predating the
// row, or exceeding its own last-write instant) without asserting an inter-stage ordering
// nothing in the contract promises.
//
// Lower bound for the 5 post-accept columns is accepted_at, NOT created_at (#938 Codex finding
// E): every live write path bootstraps accepted_at FIRST (bootstrapRide, inside the /select
// tx), before any status PATCH can stamp approaching/arrived/started/completed/canceled — so a
// legitimate stage timestamp can never precede acceptance. The old created_at-based bound let a
// row with created_at < approaching_at < accepted_at <= updated_at (a stage stamped BEFORE the
// ride was ever accepted — physically impossible under the real write path) pass as coherent.
// Verified this bound still holds true for every real, API-committed sequence the finding #4
// fix protects (forward skips, backward transitions, revisited stages) — accepted_at is always
// the FIRST timestamp stamped in real execution, so every later stage write is later by
// construction, never earlier. accepted_at's OWN bound (against created_at/updated_at) is
// unchanged.
const CHRONOLOGY_SQL = (r) => `(
    ${r}.created_at <= ${r}.accepted_at
    AND ${r}.accepted_at <= ${r}.updated_at
    AND (${r}.approaching_at IS NULL OR (${r}.accepted_at <= ${r}.approaching_at AND ${r}.approaching_at <= ${r}.updated_at))
    AND (${r}.arrived_at     IS NULL OR (${r}.accepted_at <= ${r}.arrived_at     AND ${r}.arrived_at     <= ${r}.updated_at))
    AND (${r}.started_at     IS NULL OR (${r}.accepted_at <= ${r}.started_at     AND ${r}.started_at     <= ${r}.updated_at))
    AND (${r}.completed_at   IS NULL OR (${r}.accepted_at <= ${r}.completed_at   AND ${r}.completed_at   <= ${r}.updated_at))
    AND (${r}.canceled_at    IS NULL OR (${r}.accepted_at <= ${r}.canceled_at    AND ${r}.canceled_at    <= ${r}.updated_at))
  )`;

// Entry point for GET /ride-state/rides/:tripId. Anchored on the (unique) rides.trip_id, so
// the outer query always returns exactly 0 or 1 row regardless of order-side ambiguity —
// ambiguity lives entirely inside candidate_order_count, computed via UNION (never a naked
// scalar subquery). Returns null when no such ride exists at all (today's 404 case,
// unrelated to recovery).
//
// The canonical-derivation branch (#938 Codex finding #5) requires the LITERAL `trip_` prefix
// (`r.trip_id ~ '^trip_'`) before ever joining on the stripped remainder. Without this guard,
// `regexp_replace(r.trip_id, '^trip_', '')` returns a noncanonical trip_id UNCHANGED (no match,
// no substitution) — if that unchanged string happened to equal an UNRELATED order's
// legacy_id, the join would report a false "1 candidate" for a genuinely standalone ride,
// turning the intended zero-candidate bypass into an incorrect 409. The order_id FK branch is
// unaffected and untouched — it remains the sole resolution path for a linked-but-noncanonical
// Ride (confirmed still correctly recovers via that branch).
export async function findRecoveryBundleByTripId(db, tripId) {
  const { rows } = await db.query(
    `WITH candidate_orders AS (
       SELECT o.id FROM rides r
         JOIN orders o ON r.trip_id ~ '^trip_' AND o.legacy_id = regexp_replace(r.trip_id, '^trip_', '')
        WHERE r.trip_id = $1
       UNION
       SELECT o.id FROM rides r
         JOIN orders o ON o.id = r.order_id
        WHERE r.trip_id = $1
     ),
     counted AS (
       SELECT count(*)::int AS candidate_order_count, min(id::text)::uuid AS sole_order_id FROM candidate_orders
     )
     SELECT
       row_to_json(r)  AS ride,
       CASE WHEN c.candidate_order_count = 1 THEN row_to_json(o) END AS "order",
       CASE WHEN c.candidate_order_count = 1 THEN row_to_json(a) END AS assignment,
       CASE WHEN c.candidate_order_count = 1
            THEN (SELECT json_agg(row_to_json(f)) FROM offers f WHERE f.order_id = o.id)
       END AS offers,
       c.candidate_order_count,
       CASE WHEN c.candidate_order_count = 1
            THEN (r.created_at IS NOT NULL AND r.accepted_at IS NOT NULL AND r.updated_at IS NOT NULL)
       END AS pg_has_core_timestamps,
       CASE WHEN c.candidate_order_count = 1 THEN (r.accepted_at = o.accepted_at) END AS pg_accepted_at_matches_order,
       CASE WHEN c.candidate_order_count = 1 THEN ${CHRONOLOGY_SQL('r')} END AS pg_chronology_ok
     FROM rides r
     CROSS JOIN counted c
     LEFT JOIN orders o ON c.candidate_order_count = 1 AND o.id = c.sole_order_id
     LEFT JOIN assignment a ON a.order_id = o.id
     WHERE r.trip_id = $1`,
    [tripId],
  );
  return rows[0] ?? null;
}

// Entry point for GET /matching/offers?orderId=. Anchored on orders.id (a direct PK lookup,
// never ambiguous on the order side), so ride-side ambiguity lives entirely in
// candidate_ride_count. A count of 0 is NOT automatically an error here — an order that
// never advanced past CREATED has no ride yet, which is the normal (non-recovery) offers-GET
// case; the caller decides applicability using candidate_ride_count together with the
// order's own status/offers/assignment footprint.
//
// `offers` carries an explicit `ORDER BY f.created_at DESC` INSIDE the json_agg() call (#938
// Codex Finding A follow-up) — this field is served DIRECTLY to the client by the matching
// service's CREATED/no-footprint offers-GET bypass (services/matching/index.js), which must
// match repositories/offers.js's listOffersByOrder() ordering exactly (its own explicit
// `ORDER BY created_at DESC`), the ordering the validated (non-bypass) path still uses. A bare
// json_agg(row_to_json(f)) with no ORDER BY has NO guaranteed row order at all — confirmed
// empirically to return plain physical/insertion order instead, which can silently change
// after an UPDATE (e.g. a withdrawn offer being re-sent) or a different query plan. This is
// PURELY a response-ordering concern: findRecoveryBundleByTripId's own (unordered) offers
// subquery is intentionally left AS-IS, since ride-state-GET never serves that field to a
// client — it is only ever filtered (never positionally indexed) by validateRecoveryLinkage().
export async function findRecoveryBundleByOrderId(db, orderId) {
  const { rows } = await db.query(
    `WITH candidate_rides AS (
       SELECT r.id FROM orders o
         JOIN rides r ON r.trip_id = 'trip_' || o.legacy_id
        WHERE o.id = $1
       UNION
       SELECT r.id FROM orders o
         JOIN rides r ON r.order_id = o.id
        WHERE o.id = $1
     ),
     counted AS (
       SELECT count(*)::int AS candidate_ride_count, min(id::text)::uuid AS sole_ride_id FROM candidate_rides
     )
     SELECT
       row_to_json(o) AS "order",
       CASE WHEN c.candidate_ride_count = 1 THEN row_to_json(r) END AS ride,
       row_to_json(a) AS assignment,
       (SELECT json_agg(row_to_json(f) ORDER BY f.created_at DESC) FROM offers f WHERE f.order_id = o.id) AS offers,
       c.candidate_ride_count,
       CASE WHEN c.candidate_ride_count = 1
            THEN (r.created_at IS NOT NULL AND r.accepted_at IS NOT NULL AND r.updated_at IS NOT NULL)
       END AS pg_has_core_timestamps,
       CASE WHEN c.candidate_ride_count = 1 THEN (r.accepted_at = o.accepted_at) END AS pg_accepted_at_matches_order,
       CASE WHEN c.candidate_ride_count = 1 THEN ${CHRONOLOGY_SQL('r')} END AS pg_chronology_ok
     FROM orders o
     CROSS JOIN counted c
     LEFT JOIN rides r ON c.candidate_ride_count = 1 AND r.id = c.sole_ride_id
     LEFT JOIN assignment a ON a.order_id = o.id
     WHERE o.id = $1`,
    [orderId],
  );
  return rows[0] ?? null;
}

// The status-keyed timestamp columns the chokepoint may stamp. A server-controlled allowlist
// (the column never comes from client input — it is derived from domain STATUS_TIMESTAMP_FIELD),
// guarded here too so the dynamic SET clause can never interpolate anything else.
const TIMESTAMP_COLUMNS = new Set([
  'accepted_at', 'approaching_at', 'arrived_at', 'started_at', 'completed_at', 'canceled_at',
]);

// Patch a ride's status and (when the status maps to one) stamp its timestamp column. acceptedAt
// is first-stamp-wins (COALESCE) to mirror the client; the others overwrite with now(). The
// terminal-freeze trigger + the status CHECK + the terminal-stamp CHECKs all backstop this write.
export async function patchRideStatus(db, { id, status, timestampColumn = null, firstStampOnly = false }) {
  let setTs = '';
  if (timestampColumn) {
    if (!TIMESTAMP_COLUMNS.has(timestampColumn)) throw new Error(`unknown ride timestamp column: ${timestampColumn}`);
    setTs = firstStampOnly
      ? `, ${timestampColumn} = COALESCE(${timestampColumn}, now())`
      : `, ${timestampColumn} = now()`;
  }
  const { rows } = await db.query(
    `UPDATE rides SET status = $2${setTs} WHERE id = $1 RETURNING *`,
    [id, status],
  );
  return rows[0] ?? null;
}

// V2-04C1 — server-owned Driver No-Show write. The service calls this only after
// locking the ride and validating driver authority + WAITING_PASSENGER source state.
// Actor/reason are intentionally NOT request parameters: the backend derives them.
export async function patchRideNoShow(db, { id }) {
  const { rows } = await db.query(
    `UPDATE rides
        SET status = 'NO_SHOW',
            cancel_by = 'driver',
            cancel_reason = 'passenger_no_show',
            canceled_at = now()
      WHERE id = $1
      RETURNING *`,
    [id],
  );
  return rows[0] ?? null;
}
