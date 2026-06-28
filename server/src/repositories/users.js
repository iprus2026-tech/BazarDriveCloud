// /server/src/repositories/users.js — the ONLY module that runs SQL against the `users`
// identity row (migrations 0001 + 0002). Repositories are the single SQL seam (ADR
// BD-DOCS-041). Phone is the identity key (BD-DOCS-032 decision 2): an account is keyed by
// phone, enforced by the partial unique index uq_users_phone (phone IS NOT NULL).
//
// Phase-1 surface used by the OTP-verify cutover (R02): findUserByPhone (resolve),
// upsertUserByPhone (find-or-create an account by phone — created UNVERIFIED), and
// markPhoneVerified (stamp phone_verified once an OTP is consumed). Profile/role mutation
// lands with the profile surface. DARK until R02 wires verify — only tests import this today.

export async function findUserByPhone(db, phone) {
  const { rows } = await db.query(
    `SELECT id, role, active_role, roles, phone, phone_verified
       FROM users
      WHERE phone = $1
      LIMIT 1`,
    [phone],
  );
  return rows[0] ?? null;
}

// Find-or-create the account for a phone, atomically. The uq_users_phone partial unique
// index is the arbiter, so a repeat phone returns the SAME row id — two devices verifying
// the same number resolve to ONE account (this is what replaces the identical hardcoded
// pseudo-ids; BD-DOCS-032 decision 2). The DO UPDATE is a no-op touch so the existing row
// is RETURNED on conflict. Caller supplies only the phone; role/roles are granted later.
export async function upsertUserByPhone(db, { phone }) {
  // phone is the conflict arbiter (uq_users_phone is partial on phone IS NOT NULL); a
  // null/empty phone never conflicts and would INSERT a fresh anonymous row every call,
  // silently breaking one-identity-per-phone — so require a real phone here.
  if (!phone) throw new Error('upsertUserByPhone requires a non-empty phone');
  const { rows } = await db.query(
    `INSERT INTO users (phone)
       VALUES ($1)
       ON CONFLICT (phone) WHERE phone IS NOT NULL
       DO UPDATE SET updated_at = now()
     RETURNING id, role, active_role, roles, phone, phone_verified`,
    [phone],
  );
  return rows[0];
}

// Stamp a user's phone as server-verified (BD-DOCS-032 decision 2: phone_verified is a
// SERVER fact, set only when an OTP is consumed and a verified session is issued). Used by
// the verify cutover (R02). Returns the updated identity snapshot.
export async function markPhoneVerified(db, userId) {
  const { rows } = await db.query(
    `UPDATE users SET phone_verified = TRUE, updated_at = now()
      WHERE id = $1
      RETURNING id, role, active_role, roles, phone, phone_verified`,
    [userId],
  );
  return rows[0] ?? null;
}
