// /server/src/repositories/orders.js — the ONLY module that runs SQL against `orders`
// (migrations 0001/0002). Single SQL seam (ADR BD-DOCS-041). R03 surface (#1 Order Dispatcher):
// insert a passenger order, and list the freshest CREATED orders — the feed / nearby read,
// served by idx_orders_created_status. Geo "nearby" is #4 (deferred), so today "nearby" is
// "newest CREATED". JSONB columns (pickup/dropoff/passenger_snapshot) are passed as JS objects;
// node-pg JSON-encodes them for the jsonb cast.

export async function insertOrder(db, o) {
  const { rows } = await db.query(
    `INSERT INTO orders
       (legacy_id, passenger_id, type, source, pickup, dropoff, distance_km, duration_min,
        estimated_price, estimated_price_label, scheduled_mode, scheduled_at, scheduled_label,
        comment, passenger_snapshot, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'CREATED')
     RETURNING *`,
    [
      o.legacyId, o.passengerId, o.type, o.source, o.pickup, o.dropoff, o.distanceKm,
      o.durationMin, o.estimatedPrice, o.estimatedPriceLabel, o.scheduledMode, o.scheduledAt,
      o.scheduledLabel, o.comment, o.passengerSnapshot,
    ],
  );
  return rows[0];
}

// Resolve an order by its client-facing legacy id ('order-…') to the row the matching/ride paths
// need (the UUID PK for FKs, the owner passenger_id, and the lifecycle status). Returns null when
// no such order exists.
export async function findOrderByLegacyId(db, legacyId) {
  const { rows } = await db.query(
    `SELECT id, legacy_id, passenger_id, status FROM orders WHERE legacy_id = $1 LIMIT 1`,
    [legacyId],
  );
  return rows[0] ?? null;
}

// Resolve + ROW-LOCK an order by legacy id inside a transaction (SELECT … FOR UPDATE). The
// transactional accept (/select, R05) locks the order first so concurrent selects serialize: the
// loser waits, then re-reads the now-ACCEPTED row and is rejected. Returns null if no such order.
export async function lockOrderByLegacyId(db, legacyId) {
  const { rows } = await db.query(
    `SELECT id, legacy_id, passenger_id, status FROM orders WHERE legacy_id = $1 FOR UPDATE`,
    [legacyId],
  );
  return rows[0] ?? null;
}

// Flip an order CREATED -> ACCEPTED (stamping accepted_at). Guarded by status='CREATED' so it is a
// no-op (returns null) on an already-accepted/canceled order — a belt-and-braces check on top of
// the FOR UPDATE lock the caller already holds.
export async function markOrderAccepted(db, id) {
  const { rows } = await db.query(
    `UPDATE orders SET status = 'ACCEPTED', accepted_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'CREATED'
      RETURNING *`,
    [id],
  );
  return rows[0] ?? null;
}

// The feed / nearby read: newest CREATED orders (the only status the client renders as a feed
// card; rideOrderToFeedPost drops anything else). Bounded by `limit` so the response is paged
// even before real cursor pagination lands.
export async function listCreatedOrders(db, { limit = 50 } = {}) {
  const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 200 ? limit : 50;
  const { rows } = await db.query(
    `SELECT * FROM orders
      WHERE status = 'CREATED'
      ORDER BY created_at DESC
      LIMIT $1`,
    [safeLimit],
  );
  return rows;
}
