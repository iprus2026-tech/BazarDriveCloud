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
