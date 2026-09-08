// /server/src/repositories/merchants.js — the ONLY module that runs SQL against `merchants`.
// BD-MERCHANT-IDENTITY-CONTACT-AUTHORITY-01B. Low-level SQL primitives only: callers own
// bootstrap/admin authorization. No public route is introduced by this module.
// Merchant business-write wiring is deliberately deferred until a later slice lands durable
// actor/procedure provenance. A raw merchant row starts SUSPENDED, never operationally ACTIVE.

export async function findMerchantById(db, merchantId) {
  const { rows } = await db.query(`SELECT * FROM merchants WHERE id = $1`, [merchantId]);
  return rows[0] ?? null;
}

export async function lockMerchantById(db, merchantId) {
  const { rows } = await db.query(`SELECT * FROM merchants WHERE id = $1 FOR UPDATE`, [merchantId]);
  return rows[0] ?? null;
}

export async function createMerchant(db, { displayName }) {
  const { rows } = await db.query(
    `INSERT INTO merchants (display_name, status, created_at, updated_at)
     VALUES ($1, 'SUSPENDED', now(), now()) RETURNING *`,
    [displayName],
  );
  return rows[0];
}

export async function setMerchantStatus(db, merchantId, status) {
  const { rows } = await db.query(
    `UPDATE merchants SET status = $2 WHERE id = $1 RETURNING *`,
    [merchantId, status],
  );
  return rows[0] ?? null;
}
