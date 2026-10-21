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

// #1049 — the order-cancel route refuses an order that has (or had) a driver: the selection overlay
// is the record of that, and it outlives a ride cancel (status CANCELED), so it tells a cancel
// before selection from a cancel through the ride.
export async function findAssignmentByOrderId(db, orderId) {
  const { rows } = await db.query('SELECT * FROM assignment WHERE order_id = $1', [orderId]);
  return rows[0] ?? null;
}

// Order-lifecycle contract (#1051): a canceled or no-show ride cancels its assignment in the same
// transaction. canceledBy is 'passenger' | 'driver' (assignment_cancel_stamp); only an ACCEPTED
// assignment moves, so a replay is a no-op.
export async function cancelAssignment(db, orderId, { canceledBy, canceledAt = null }) {
  const { rows } = await db.query(
    `UPDATE assignment
        SET status = 'CANCELED', canceled_by = $2, canceled_at = coalesce($3, now()), updated_at = now()
      WHERE order_id = $1 AND status = 'ACCEPTED'
      RETURNING *`,
    [orderId, canceledBy, canceledAt],
  );
  return rows[0] ?? null;
}
