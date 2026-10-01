// /server/src/repositories/sessions.js — the ONLY module that runs SQL against
// auth_session (migration 0002). Repositories are the single SQL seam (ADR BD-DOCS-041).
// Phase-1 surface: resolve a presented token hash to its LIVE session — not revoked, not
// expired (mirrors the idx_auth_session_live partial index). Listing / revoke land with
// the profile "active sessions" surface.
export async function resolveLiveSessionByTokenHash(db, tokenHash) {
  const { rows } = await db.query(
    `SELECT id, user_id, active_role, phone_verified, issued_at, expires_at, revoked_at
       FROM auth_session
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
      LIMIT 1`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

// Mint a verified session row (the OTP-verify cutover, R02). Stores only the token HASH
// (hashToken of the plaintext returned to the client). expires_at NULL = no expiry modeled
// (config.session.ttlSeconds === 0; lifetime/refresh policy deferred per BD-DOCS-032). The
// active_role/grant membership is re-validated at the API layer, not here.
export async function insertSession(db, {
  userId,
  tokenHash,
  activeRole = null,
  phoneVerified = false,
  otpId = null,
  expiresAt = null,
  deviceLabel = null,
  userAgent = null,
}) {
  const { rows } = await db.query(
    `INSERT INTO auth_session
       (user_id, token_hash, active_role, phone_verified, otp_id, expires_at, device_label, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, user_id, active_role, phone_verified, otp_id, issued_at, expires_at`,
    [userId, tokenHash, activeRole, phoneVerified, otpId, expiresAt, deviceLabel, userAgent],
  );
  return rows[0];
}

// Dark Telegram authority uses these only INSIDE its transaction. FOR SHARE also
// blocks a concurrent non-key revoke/expiry change until the operation finishes.
// Session snapshots are not role grants; the caller must lock/read users separately.
export async function lockLiveSessionByTokenHash(db, tokenHash) {
  const { rows } = await db.query(
    `SELECT *, issued_at >= clock_timestamp() - interval '15 minutes' AS recent
       FROM auth_session WHERE token_hash = $1 AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > clock_timestamp()) FOR SHARE`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function lockLiveSessionById(db, sessionId) {
  const { rows } = await db.query(
    `SELECT * FROM auth_session WHERE id = $1 AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > clock_timestamp()) FOR SHARE`,
    [sessionId],
  );
  return rows[0] ?? null;
}

// Read after all authorization row locks have been acquired: a lock wait may
// cross an expiry boundary, and transaction-start now() would then be stale.
export async function readAuthorizationClock(db) {
  const { rows } = await db.query('SELECT clock_timestamp() AS current_time');
  return rows[0].current_time;
}
