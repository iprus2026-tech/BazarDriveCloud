// /server/src/repositories/merchant_locations.js — SQL seam for persistent merchant pickup
// locations. Recipient addresses belong to the future Delivery Order domain and never land here.
// These are low-level SQL primitives, not merchant-admin authorization operations.

export async function findDefaultMerchantLocation(db, merchantId) {
  const { rows } = await db.query(
    `SELECT * FROM merchant_locations
      WHERE merchant_id = $1 AND status = 'ACTIVE' AND is_default_pickup = TRUE
      LIMIT 1`,
    [merchantId],
  );
  return rows[0] ?? null;
}

export async function listActiveMerchantLocations(db, merchantId) {
  const { rows } = await db.query(
    `SELECT * FROM merchant_locations
      WHERE merchant_id = $1 AND status = 'ACTIVE'
      ORDER BY is_default_pickup DESC, created_at, id`,
    [merchantId],
  );
  return rows;
}

export async function lockMerchantLocationById(db, locationId) {
  const { rows } = await db.query(
    `SELECT * FROM merchant_locations WHERE id = $1 FOR UPDATE`,
    [locationId],
  );
  return rows[0] ?? null;
}

export async function createMerchantLocation(db, {
  merchantId,
  label,
  addressText,
  lat = null,
  lng = null,
  pickupInstructions = null,
  isDefaultPickup = false,
}) {
  const { rows } = await db.query(
    `INSERT INTO merchant_locations
       (merchant_id, label, address_text, lat, lng, pickup_instructions,
        is_default_pickup, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', now(), now())
     RETURNING *`,
    [merchantId, label, addressText, lat, lng, pickupInstructions, isDefaultPickup],
  );
  return rows[0];
}

// Caller must serialize a default switch on the merchant row (lockMerchantById) in the same tx.
export async function clearActiveDefaultMerchantLocation(db, merchantId) {
  const { rows } = await db.query(
    `UPDATE merchant_locations
        SET is_default_pickup = FALSE
      WHERE merchant_id = $1 AND status = 'ACTIVE' AND is_default_pickup = TRUE
      RETURNING *`,
    [merchantId],
  );
  return rows;
}

export async function setMerchantLocationDefault(db, { merchantId, locationId }) {
  const { rows } = await db.query(
    `UPDATE merchant_locations
        SET is_default_pickup = TRUE
      WHERE id = $2 AND merchant_id = $1 AND status = 'ACTIVE'
      RETURNING *`,
    [merchantId, locationId],
  );
  return rows[0] ?? null;
}

export async function archiveMerchantLocation(db, locationId) {
  const { rows } = await db.query(
    `UPDATE merchant_locations
        SET status = 'ARCHIVED', is_default_pickup = FALSE
      WHERE id = $1 AND status = 'ACTIVE'
      RETURNING *`,
    [locationId],
  );
  return rows[0] ?? null;
}
