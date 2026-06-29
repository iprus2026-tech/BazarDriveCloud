// /server/src/repositories/history.js — read model over the ride_history VIEW (migration 0001).
// Single SQL seam (ADR BD-DOCS-041). #8 History (R08): the view UNIONs the passenger + driver
// projections of completed rides (each row keyed by viewer_user_id), folding in the receipt for
// driver rows. The read is inherently viewer-scoped — return only the authenticated viewer's rows.
export async function listHistoryForViewer(db, viewerId, { limit = 100 } = {}) {
  const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 200 ? limit : 100;
  const { rows } = await db.query(
    `SELECT * FROM ride_history WHERE viewer_user_id = $1 ORDER BY completed_at DESC NULLS LAST LIMIT $2`,
    [viewerId, safeLimit],
  );
  return rows;
}
