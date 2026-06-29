// /server/src/repositories/rides.js — the ONLY module that runs SQL against `rides`
// (migration 0001). Single SQL seam (ADR BD-DOCS-041). R06 surface (#5 Ride State chokepoint):
// read a ride snapshot by its tripId, lock it for the PATCH transaction, and patch its status +
// the status-keyed timestamp. The DB trg_rides_freeze_terminal trigger is the last-line backstop
// for the terminal-freeze invariant; the service enforces it first via the domain.

export async function findRideByTripId(db, tripId) {
  const { rows } = await db.query(`SELECT * FROM rides WHERE trip_id = $1 LIMIT 1`, [tripId]);
  return rows[0] ?? null;
}

// Lock the ride row inside the PATCH transaction (SELECT … FOR UPDATE) so concurrent status
// transitions serialize on the row — read-check-write can't race (and the loser re-reads the
// committed status). Returns null if no such ride.
export async function lockRideByTripId(db, tripId) {
  const { rows } = await db.query(`SELECT * FROM rides WHERE trip_id = $1 FOR UPDATE`, [tripId]);
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
