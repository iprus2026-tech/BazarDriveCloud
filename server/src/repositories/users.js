// /server/src/repositories/users.js — the ONLY module that runs SQL against the `users`
// identity row (migrations 0001 + 0002). Repositories are the single SQL seam (ADR
// BD-DOCS-041). Phone is the identity key (BD-DOCS-032 decision 2): an account is keyed by
// phone, enforced by the partial unique index uq_users_phone (phone IS NOT NULL).
//
// Phase-1 surface used by the OTP-verify cutover (R02): findUserByPhone (resolve),
// upsertUserByPhone (find-or-create an account by phone — created UNVERIFIED), and
// markPhoneVerified (stamp phone_verified once an OTP is consumed). Profile/role mutation
// lands with the profile surface. Wired LIVE by R02 (services/auth/index.js).

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

// The login row of an account by id — what a session is minted from (Telegram sign-in, ADR
// BD-DOCS-052): the same columns findUserByPhone returns.
export async function findLoginUserById(db, userId) {
  const { rows } = await db.query(
    `SELECT id, role, active_role, roles, phone, phone_verified
       FROM users
      WHERE id = $1
      LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function findUserAuthorityById(db, userId) {
  const { rows } = await db.query(
    `SELECT id, roles, phone_verified
       FROM users
      WHERE id = $1
      LIMIT 1`,
    [userId],
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

// Only called after OTP consumption, on the SAME transaction client as session creation.
// INSERT is the first-user decision. A conflicting identity keeps its grants, with one exception
// (BD-AUTH-POLICY-01B-C): a legacy account with NO grants gets the passenger grant every new OTP
// account has (#1017), and an empty active role becomes passenger only when passenger is granted.
export async function resolveVerifiedLoginUser(db, { phone }) {
  if (!phone) throw new Error('resolveVerifiedLoginUser requires a non-empty phone');
  const { rows } = await db.query(
    `INSERT INTO users (phone, phone_verified, roles, active_role)
       VALUES ($1, TRUE, ARRAY['passenger']::text[], 'passenger')
       ON CONFLICT (phone) WHERE phone IS NOT NULL
       DO UPDATE SET phone_verified = TRUE,
         roles = CASE WHEN cardinality(users.roles) = 0
                      THEN ARRAY['passenger']::text[] ELSE users.roles END,
         active_role = CASE WHEN users.active_role IS NULL
                             AND (cardinality(users.roles) = 0 OR 'passenger' = ANY(users.roles))
                            THEN 'passenger' ELSE users.active_role END,
         updated_at = now()
     RETURNING id, role, active_role, roles, phone, phone_verified`,
    [phone],
  );
  return rows[0];
}

// BD-AUTH-TELEGRAM-01 R2 (ADR BD-DOCS-052): the first name from Telegram initData fills
// users.first_name only when it is empty — it never overwrites what the account already has.
export async function fillUserFirstName(db, userId, firstName) {
  if (!firstName) return;
  await db.query(
    `UPDATE users SET first_name = $2
      WHERE id = $1 AND (first_name IS NULL OR btrim(first_name) = '')`,
    [userId, firstName],
  );
}

// --- Role grants (BD-AUTH-POLICY-01B-A, docs/driver-role-grant-contract.md §1) ---
// Called only by services/driver-enrollment/decisions.js, on the transaction client of the
// enrollment decision, so the application row and users.roles change together.

// The selected driver's current grants inside the /matching/select transaction (BD-AUTH-POLICY-
// 01B-C). FOR SHARE: a concurrent grant decision (lockUserForGrant, FOR UPDATE) waits for the
// selection, or the selection reads the decision it waited for.
export async function lockUserGrantsForShare(db, userId) {
  const { rows } = await db.query(
    `SELECT id, roles
       FROM users
      WHERE id = $1
      FOR SHARE`,
    [userId],
  );
  return rows[0] ?? null;
}

// Row-lock the account before a grant decision (serializes concurrent applications/decisions).
export async function lockUserForGrant(db, userId) {
  const { rows } = await db.query(
    `SELECT id, roles, active_role, phone, phone_verified
       FROM users
      WHERE id = $1
      FOR UPDATE`,
    [userId],
  );
  return rows[0] ?? null;
}

// Add a role to users.roles (no-op when already granted). Never changes active_role.
export async function addRoleGrant(db, userId, role) {
  const { rows } = await db.query(
    `UPDATE users
        SET roles = CASE WHEN $2 = ANY(roles) THEN roles ELSE array_append(roles, $2) END
      WHERE id = $1
     RETURNING id, roles, active_role`,
    [userId, role],
  );
  return rows[0] ?? null;
}

// Remove a role from users.roles. When it was the account's active_role, active_role falls
// back to `fallbackActiveRole` (a remaining grant, or NULL).
export async function removeRoleGrant(db, userId, role, fallbackActiveRole) {
  const { rows } = await db.query(
    `UPDATE users
        SET roles = array_remove(roles, $2),
            active_role = CASE WHEN active_role = $2 THEN $3 ELSE active_role END
      WHERE id = $1
     RETURNING id, roles, active_role`,
    [userId, role, fallbackActiveRole],
  );
  return rows[0] ?? null;
}

// The active-role switch (BD-AUTH-POLICY-01B-B): users.active_role seeds the next login's
// session role. The caller has already checked that `role` is a current grant.
export async function setUserActiveRole(db, userId, role) {
  const { rows } = await db.query(
    `UPDATE users SET active_role = $2 WHERE id = $1 RETURNING id, roles, active_role`,
    [userId, role],
  );
  return rows[0] ?? null;
}
