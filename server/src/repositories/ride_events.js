// /server/src/repositories/ride_events.js — the ONLY module that runs SQL against the append-only
// `ride_events` timeline (migrations 0001 + 0003). Single SQL seam (ADR BD-DOCS-041). R06 surface:
// append a 'status_change' event per accepted transition (the type was widened in 0003). The table
// is append-only (trg_ride_events_no_mutation rejects UPDATE/DELETE), so there is only an insert.
// The realtime read seam (R09): the ride's append-only timeline since a cursor, oldest-first,
// bounded. `since` is null on the first poll (returns the oldest tail). Served by
// idx_ride_events_trip_type (trip_id, type, at).
//
// CURSOR PRECISION: `at` is TIMESTAMPTZ(µs), but node-pg parses it into a JS Date (millisecond-only),
// so a JS-Date-derived cursor would FLOOR to ms and `at > $cursor` would re-deliver the newest event
// on ~every poll. We therefore project `at_cursor` as full-microsecond UTC text (to_char) and the
// route returns THAT as the cursor, so `at > $2::timestamptz` round-trips losslessly.
// CURSOR MONOTONICITY: status-change events are stamped with clock_timestamp() AFTER the ride row
// lock (see insertStatusChangeEvent), so same-ride `at` follows COMMIT order and the cursor is
// skip-free for the live path. A keyset (at, id) cursor is the future hardening if a denser,
// non-lock-serialized stream (e.g. chat) later joins this seam.
export async function listEventsByTripSince(db, tripId, since = null, { limit = 100 } = {}) {
  const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 500 ? limit : 100;
  const { rows } = await db.query(
    `SELECT *, to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at_cursor
       FROM ride_events
      WHERE trip_id = $1 AND ($2::timestamptz IS NULL OR at > $2::timestamptz)
      ORDER BY at ASC
      LIMIT $3`,
    [tripId, since, safeLimit],
  );
  return rows;
}

export async function insertStatusChangeEvent(db, { rideId, tripId, role = null, fromStatus, toStatus }) {
  // Stamp `at` with clock_timestamp() (ACTUAL insert time), NOT the column default now()
  // (transaction-START time). The ride-state PATCH inserts this only AFTER locking the ride
  // (lockRideByTripId, FOR UPDATE), so same-ride transitions serialize and their clock_timestamp()
  // values follow COMMIT order — keeping the R09 `at > since` poll cursor monotonic and skip-free.
  // (now() could give a later-committed transition an earlier transaction-start `at`, which the
  // cursor would then permanently skip — Codex #795 P2.)
  const { rows } = await db.query(
    `INSERT INTO ride_events (ride_id, trip_id, type, role, payload, at)
       VALUES ($1, $2, 'status_change', $3, $4, clock_timestamp())
     RETURNING id, at`,
    [rideId, tripId, role, { from: fromStatus, to: toStatus }],
  );
  return rows[0];
}
