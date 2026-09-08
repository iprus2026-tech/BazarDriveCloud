// /server/src/repositories/merchant_contact_bindings.js — explicit external-contact -> merchant
// context bindings. A binding is descriptive context and never authorizes money/dispatch/admin.
// Create/revoke primitives remain low-level only in 01B; live business mutation wiring is deferred
// until durable actor/procedure audit provenance exists.

export async function findActiveMerchantContactBinding(db, { merchantId, externalContactIdentityId }) {
  const { rows } = await db.query(
    `SELECT * FROM merchant_contact_bindings
      WHERE merchant_id = $1 AND external_contact_identity_id = $2 AND status = 'ACTIVE'
      LIMIT 1`,
    [merchantId, externalContactIdentityId],
  );
  return rows[0] ?? null;
}

export async function listActiveBindingsForExternalIdentity(db, externalContactIdentityId) {
  const { rows } = await db.query(
    `SELECT b.*, m.display_name AS merchant_display_name, m.status AS merchant_status
       FROM merchant_contact_bindings b
       JOIN merchants m ON m.id = b.merchant_id
      WHERE b.external_contact_identity_id = $1 AND b.status = 'ACTIVE'
      ORDER BY b.bound_at, b.id`,
    [externalContactIdentityId],
  );
  return rows;
}

export async function createMerchantContactBinding(db, {
  merchantId,
  externalContactIdentityId,
  relationship = 'CONTACT',
  provenance,
}) {
  const { rows } = await db.query(
    `INSERT INTO merchant_contact_bindings
       (merchant_id, external_contact_identity_id, relationship, status,
        bound_at, provenance, created_at, updated_at)
     VALUES ($1, $2, $3, 'ACTIVE', now(), $4, now(), now())
     RETURNING *`,
    [merchantId, externalContactIdentityId, relationship, provenance],
  );
  return rows[0];
}

export async function revokeMerchantContactBinding(db, bindingId) {
  const { rows } = await db.query(
    `UPDATE merchant_contact_bindings
        SET status = 'REVOKED', revoked_at = now()
      WHERE id = $1 AND status = 'ACTIVE'
      RETURNING *`,
    [bindingId],
  );
  return rows[0] ?? null;
}
