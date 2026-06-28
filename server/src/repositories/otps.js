// /server/src/repositories/otps.js — the ONLY module that runs SQL against auth_otp
// (migration 0002). Repositories are the single SQL seam (ADR BD-DOCS-041). Stores a code
// HASH only (never the plaintext code; see services/auth/tokens.hashOtpCode).
//
// Phase-1 surface used by the OTP request/verify cutover (R02): insert a code, find the
// freshest live code for a phone, bump the attempt counter, and consume on success. Wired
// LIVE by R02 (services/auth/index.js); the DB-gated round-trip still pins the contracts.

export async function insertOtp(db, { phone, codeHash, expiresAt, requestedIp = null }) {
  const { rows } = await db.query(
    `INSERT INTO auth_otp (phone, code_hash, expires_at, requested_ip)
       VALUES ($1, $2, $3, $4)
     RETURNING id, phone, expires_at, attempts, consumed_at, created_at`,
    [phone, codeHash, expiresAt, requestedIp],
  );
  return rows[0];
}

// The phone's most-recent OTP request, returned ONLY if it is still usable (not consumed,
// not expired). Critically it considers ONLY the newest row (inner LIMIT 1) and THEN filters
// usability — so a newer request supersedes older codes: once a newer OTP is issued/consumed,
// an older still-unexpired code can never fall through and re-verify (Codex #787 P1). Expiry
// is checked on the DB clock. Verify hot path (served by idx_auth_otp_phone_created).
export async function findLatestLiveOtpByPhone(db, phone) {
  const { rows } = await db.query(
    `SELECT latest.* FROM (
         SELECT id, phone, code_hash, expires_at, consumed_at, attempts, created_at
           FROM auth_otp
          WHERE phone = $1
          ORDER BY created_at DESC
          LIMIT 1
       ) latest
      WHERE latest.consumed_at IS NULL
        AND latest.expires_at > now()`,
    [phone],
  );
  return rows[0] ?? null;
}

// One-time use: stamp consumed_at when a code is accepted. Guarded by consumed_at IS NULL
// (double-consume is a no-op) AND expires_at > now() — so a code that lapsed between the
// live read and the consume can never be consumed-and-minted-from (atomic expiry recheck,
// Codex #787 P2). Returns the row only if THIS call consumed a still-valid code, else null.
export async function markOtpConsumed(db, id) {
  const { rows } = await db.query(
    `UPDATE auth_otp SET consumed_at = now()
      WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()
      RETURNING id, consumed_at`,
    [id],
  );
  return rows[0] ?? null;
}

// Coarse brute-force guard: atomically bump the failed-check counter and RETURN the new
// count. The lock-out THRESHOLD (config.otp.maxAttempts) is applied by the verify endpoint
// (R02) — the schema bakes no policy. The single `attempts = attempts + 1 RETURNING attempts`
// is ALSO the cap's serialization point: verify counts BEFORE comparing and gates on the
// returned value, so concurrent guesses for one code each get a distinct count and can't slip
// past the cap. Keep it one atomic statement — do NOT split it into a read + a separate write.
export async function incrementOtpAttempts(db, id) {
  const { rows } = await db.query(
    `UPDATE auth_otp SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`,
    [id],
  );
  return rows[0]?.attempts ?? null;
}
