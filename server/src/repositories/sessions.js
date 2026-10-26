// /server/src/repositories/sessions.js — the ONLY module that runs SQL against
// auth_session (migration 0002). Repositories are the single SQL seam (ADR BD-DOCS-041).
// Phase-1 surface: resolve a presented token hash to its LIVE session — not revoked, not
// expired (mirrors the idx_auth_session_live partial index). Revocation by server-known
// id is wired to current-session HTTP logout. Session listing, logout-all and device
// management remain deferred.
export async function resolveLiveSessionByTokenHash(db, tokenHash) {
  const { rows } = await db.query(
    `SELECT id, user_id, active_role, phone_verified, auth_method, issued_at, expires_at, revoked_at
       FROM auth_session
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
      LIMIT 1`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

// Preserve the first revocation stamp, including on retries and expired sessions.
export async function revokeSessionById(db, sessionId) {
  const { rows } = await db.query(
    `UPDATE auth_session
        SET revoked_at = COALESCE(revoked_at, now())
      WHERE id = $1
      RETURNING id, user_id, active_role, phone_verified, auth_method, issued_at, expires_at, revoked_at`,
    [sessionId],
  );
  return rows[0] ?? null;
}

// A revoked role grant (BD-AUTH-POLICY-01B-A): every LIVE session of the account that is in
// the revoked role falls back to `toRole` (a remaining grant, or NULL). Runs on the decision's
// transaction client. The authority core already denies such sessions on current grants; this
// keeps the session rows truthful too.
export async function resetLiveSessionsActiveRole(db, userId, fromRole, toRole) {
  const { rowCount } = await db.query(
    `UPDATE auth_session
        SET active_role = $3
      WHERE user_id = $1
        AND active_role = $2
        AND revoked_at IS NULL`,
    [userId, fromRole, toRole],
  );
  return rowCount;
}

// The active-role switch (BD-AUTH-POLICY-01B-B): row-lock ONE session if it is still live, on
// the switch's transaction client. null when it was revoked or expired in the meantime.
export async function lockLiveSessionById(db, sessionId) {
  const { rows } = await db.query(
    `SELECT id, user_id, active_role, phone_verified
       FROM auth_session
      WHERE id = $1
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
      FOR UPDATE`,
    [sessionId],
  );
  return rows[0] ?? null;
}

// The active-role switch (BD-AUTH-POLICY-01B-B): set the active role of ONE live session.
// Returns the updated row, or null when the session is no longer live (revoked/expired).
export async function setSessionActiveRole(db, sessionId, role) {
  const { rows } = await db.query(
    `UPDATE auth_session
        SET active_role = $2
      WHERE id = $1
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
      RETURNING id, user_id, active_role, phone_verified`,
    [sessionId, role],
  );
  return rows[0] ?? null;
}

// Mint a verified session row (the OTP-verify cutover, R02). Stores only the token HASH
// (hashToken of the plaintext returned to the client). expires_at NULL = no expiry modeled
// (config.session.ttlSeconds === 0; lifetime/refresh policy deferred per BD-DOCS-032). The
// active_role/grant membership is re-validated at the API layer, not here. auth_method (0015,
// ADR BD-DOCS-052 R7) records what minted it: 'otp' or 'telegram'.
export async function insertSession(db, {
  userId,
  tokenHash,
  activeRole = null,
  phoneVerified = false,
  otpId = null,
  authMethod = 'otp',
  expiresAt = null,
  deviceLabel = null,
  userAgent = null,
}) {
  const { rows } = await db.query(
    `INSERT INTO auth_session
       (user_id, token_hash, active_role, phone_verified, otp_id, auth_method, expires_at, device_label, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, user_id, active_role, phone_verified, otp_id, auth_method, issued_at, expires_at`,
    [userId, tokenHash, activeRole, phoneVerified, otpId, authMethod, expiresAt, deviceLabel, userAgent],
  );
  return rows[0];
}
