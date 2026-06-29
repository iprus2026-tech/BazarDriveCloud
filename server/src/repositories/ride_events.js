// /server/src/repositories/ride_events.js — the ONLY module that runs SQL against the append-only
// `ride_events` timeline (migrations 0001 + 0003). Single SQL seam (ADR BD-DOCS-041). R06 surface:
// append a 'status_change' event per accepted transition (the type was widened in 0003). The table
// is append-only (trg_ride_events_no_mutation rejects UPDATE/DELETE), so there is only an insert.
export async function insertStatusChangeEvent(db, { rideId, tripId, role = null, fromStatus, toStatus }) {
  const { rows } = await db.query(
    `INSERT INTO ride_events (ride_id, trip_id, type, role, payload)
       VALUES ($1, $2, 'status_change', $3, $4)
     RETURNING id, at`,
    [rideId, tripId, role, { from: fromStatus, to: toStatus }],
  );
  return rows[0];
}
