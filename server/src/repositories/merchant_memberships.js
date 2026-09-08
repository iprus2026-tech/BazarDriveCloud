// /server/src/repositories/merchant_memberships.js — SQL seam for merchant-scoped user
// authorization rows. These writes are NOT self-authorizing; the service/Ops caller must prove
// the actor before calling them. This 01B slice does not wire these mutations into a business
// service/route because durable actor/procedure audit provenance is intentionally deferred.
// The DB itself still enforces terminal rows and the last-ACTIVE-ADMIN invariant.

export async function findActiveMerchantMembership(db, { merchantId, userId }) {
  const { rows } = await db.query(
    `SELECT * FROM merchant_memberships
      WHERE merchant_id = $1 AND user_id = $2 AND status = 'ACTIVE'
      LIMIT 1`,
    [merchantId, userId],
  );
  return rows[0] ?? null;
}

export async function lockActiveMerchantMembership(db, { merchantId, userId }) {
  const { rows } = await db.query(
    `SELECT * FROM merchant_memberships
      WHERE merchant_id = $1 AND user_id = $2 AND status = 'ACTIVE'
      FOR UPDATE`,
    [merchantId, userId],
  );
  return rows[0] ?? null;
}

export async function listActiveMerchantAdmins(db, merchantId) {
  const { rows } = await db.query(
    `SELECT * FROM merchant_memberships
      WHERE merchant_id = $1 AND status = 'ACTIVE' AND membership_role = 'ADMIN'
      ORDER BY granted_at, id`,
    [merchantId],
  );
  return rows;
}

export async function createMerchantMembership(db, { merchantId, userId, membershipRole }) {
  const { rows } = await db.query(
    `INSERT INTO merchant_memberships
       (merchant_id, user_id, membership_role, status, granted_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'ACTIVE', now(), now(), now())
     RETURNING *`,
    [merchantId, userId, membershipRole],
  );
  return rows[0];
}

export async function revokeMerchantMembership(db, membershipId) {
  const { rows } = await db.query(
    `UPDATE merchant_memberships
        SET status = 'REVOKED', revoked_at = now()
      WHERE id = $1 AND status = 'ACTIVE'
      RETURNING *`,
    [membershipId],
  );
  return rows[0] ?? null;
}
