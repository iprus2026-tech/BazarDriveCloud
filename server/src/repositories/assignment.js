// /server/src/repositories/assignment.js — the ONLY module that runs SQL against `assignment`
// (migration 0001). Single SQL seam (ADR BD-DOCS-041). One overlay row per order (PK = order_id).
// R05 surface (#3 Matching /select): write the ACCEPTED overlay when a passenger selects a driver.
// The cancel transitions (status='CANCELED' + canceled_by/at) are a later slice. Always called
// inside the /select transaction, under the order's FOR UPDATE lock, so the order is freshly
// CREATED (no prior overlay) — a plain INSERT is safe; ON CONFLICT defends against a re-accept of a
// previously-canceled order (which the order-status guard already blocks) by re-pinning ACCEPTED.
export async function insertAssignment(db, { orderId, selectedDriverId }) {
  const { rows } = await db.query(
    `INSERT INTO assignment (order_id, status, selected_driver_id)
       VALUES ($1, 'ACCEPTED', $2)
     ON CONFLICT (order_id) DO UPDATE
       SET status = 'ACCEPTED', selected_driver_id = $2,
           canceled_by = NULL, canceled_at = NULL, updated_at = now()
     RETURNING *`,
    [orderId, selectedDriverId],
  );
  return rows[0];
}
