// /server/src/repositories/offers.js — the ONLY module that runs SQL against `offers`
// (migration 0001). Single SQL seam (ADR BD-DOCS-041). R04 surface (#3 Matching): idempotent
// offer create/resend keyed on (order_id, driver_id), find one offer, and list an order's offers
// for its owner. The accepted/rejected transitions are R05 (/select); the TTL→expired sweep is a
// future job. NUMERIC `price` is passed as a JS number (or null).

// Idempotent create: insert a fresh 'sent' offer; on the (order_id, driver_id) conflict, RE-SEND
// only a previously 'withdrawn' offer (flip to 'sent', bump updated_at) — preserving its details
// and original expires_at, mirroring the client sendDriverOffer. When the existing offer is
// already 'sent' or terminal (accepted/rejected/expired) the conflict is a NO-OP and RETURNING is
// empty (the caller reads the existing row back). Returns the upserted row, or undefined on a
// no-op conflict.
export async function upsertOffer(db, o) {
  const { rows } = await db.query(
    `INSERT INTO offers
       (legacy_id, order_id, driver_id, status, driver_name, car, rating, eta_min, price, message, expires_at)
     VALUES ($1, $2, $3, 'sent', $4, $5, $6, $7, $8, $9, now() + make_interval(mins => $10::int))
     ON CONFLICT (order_id, driver_id) DO UPDATE
       SET status = 'sent', updated_at = now()
       WHERE offers.status = 'withdrawn'
     RETURNING *`,
    [o.legacyId, o.orderId, o.driverId, o.driverName, o.car, o.rating, o.etaMin, o.price, o.message, o.ttlMin],
  );
  return rows[0];
}

export async function findOfferByOrderDriver(db, orderId, driverId) {
  const { rows } = await db.query(
    `SELECT * FROM offers WHERE order_id = $1 AND driver_id = $2 LIMIT 1`,
    [orderId, driverId],
  );
  return rows[0] ?? null;
}

// All offers for an order (the owner's read), newest first. Served by idx_offers_order_status.
export async function listOffersByOrder(db, orderId) {
  const { rows } = await db.query(
    `SELECT * FROM offers WHERE order_id = $1 ORDER BY created_at DESC`,
    [orderId],
  );
  return rows;
}
