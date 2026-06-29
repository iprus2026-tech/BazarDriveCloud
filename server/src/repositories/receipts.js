// /server/src/repositories/receipts.js — the ONLY module that runs SQL against `receipts`
// (migration 0001). Single SQL seam (ADR BD-DOCS-041). #8 Receipt (R08): a receipt is a write-once
// financial document, 1:1 with a ride (receipts_ride_uniq). The client never recomputes fare/
// commission/tip/net — the server stores the supplied, already-computed values VERBATIM. The DB
// CHECKs (commission <= 0, tip >= 0, status = 'completed') backstop the schema validation.
export async function insertReceipt(db, r) {
  const { rows } = await db.query(
    `INSERT INTO receipts (ride_id, completed_at, fare, commission, tip, net, payment_mode, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed')
     ON CONFLICT (ride_id) DO NOTHING
     RETURNING *`,
    [r.rideId, r.completedAt, r.fare, r.commission, r.tip, r.net, r.paymentMode],
  );
  return rows[0] ?? null; // null when a receipt already exists (write-once) — caller re-reads
}

export async function findReceiptByRideId(db, rideId) {
  const { rows } = await db.query(`SELECT * FROM receipts WHERE ride_id = $1 LIMIT 1`, [rideId]);
  return rows[0] ?? null;
}
