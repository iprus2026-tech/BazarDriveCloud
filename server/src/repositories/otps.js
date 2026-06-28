// /server/src/repositories/otps.js — the ONLY module that runs SQL against auth_otp
// (migration 0002). Repositories are the single SQL seam (ADR BD-DOCS-041). Stores a code
// HASH only (never the plaintext code; see services/auth/tokens.hashOtpCode).
//
// Phase-1 surface used by the OTP request/verify cutover (R02): insert a code, find the
// freshest live code for a phone, bump the attempt counter, and consume on success. DARK
// until R02 wires the endpoints — only tests import this today.

export async function insertOtp(db, { phone, codeHash, expiresAt, requestedIp = null }) {
  const { rows } = await db.query(
    `INSERT INTO auth_otp (phone, code_hash, expires_at, requested_ip)
       VALUES ($1, $2, $3, $4)
     RETURNING id, phone, expires_at, attempts, consumed_at, created_at`,
    [phone, codeHash, expiresAt, requestedIp],
  );
  return rows[0];
}

// The freshest still-usable code for a phone: not consumed, not expired (verify hot path,
// served by idx_auth_otp_phone_created). Returns the row incl. code_hash for comparison.
export async function findLatestLiveOtpByPhone(db, phone) {
  const { rows } = await db.query(
    `SELECT id, phone, code_hash, expires_at, consumed_at, attempts, created_at
       FROM auth_otp
      WHERE phone = $1
        AND consumed_at IS NULL
        AND expires_at > now()
      ORDER BY created_at DESC
      LIMIT 1`,
    [phone],
  );
  return rows[0] ?? null;
}

// One-time use: stamp consumed_at when a code is accepted. Guarded by consumed_at IS NULL so
// a double-consume is a no-op (returns the row only if THIS call consumed it).
export async function markOtpConsumed(db, id) {
  const { rows } = await db.query(
    `UPDATE auth_otp SET consumed_at = now()
      WHERE id = $1 AND consumed_at IS NULL
      RETURNING id, consumed_at`,
    [id],
  );
  return rows[0] ?? null;
}

// Coarse brute-force guard: bump the failed-check counter. The lock-out THRESHOLD
// (config.otp.maxAttempts) is applied by the verify endpoint (R02) — the schema bakes no
// policy. Returns the new attempt count.
export async function incrementOtpAttempts(db, id) {
  const { rows } = await db.query(
    `UPDATE auth_otp SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`,
    [id],
  );
  return rows[0]?.attempts ?? null;
}
