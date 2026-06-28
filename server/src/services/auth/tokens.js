// /server/src/services/auth/tokens.js — opaque token hashing for auth_session.token_hash
// (BD-DOCS-032: store a HASH, never the plaintext token). Token FORMAT is deferred, so
// this is just a stable one-way hash. BOTH sides use it: the resolution seam
// (plugins/auth.js) hashes the presented token to look a session up, and the OTP-verify
// endpoint (R02) hashes the minted token before INSERT — so they must always match.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

// Constant-time equality for two sha256 hex digests — the OTP-verify check compares the
// stored auth_otp.code_hash against hashOtpCode(submittedCode), and a plain === leaks, via
// timing, how many leading chars match. Both operands are fixed 64-char hex (equal length),
// so timingSafeEqual never throws; the length guard just returns false (instead of throwing)
// for a malformed/short input. The real brute-force defense is still R02's attempt cap +
// expiry — this just removes a free side channel on a security-sensitive path.
export function hashesEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// Mint a high-entropy opaque bearer token. Only hashToken(...) of this is ever stored
// (auth_session.token_hash); the plaintext is returned to the client exactly once, by the
// OTP-verify endpoint (R02). base64url => URL/header-safe, no padding.
export function generateToken() {
  return randomBytes(32).toString('base64url');
}

// Mint a numeric OTP code of `length` digits, uniformly (crypto.randomInt), zero-padded so
// every code is exactly `length` chars (incl. leading zeros).
export function generateOtpCode(length = 4) {
  const n = Math.max(1, Math.trunc(length) || 1);
  return String(randomInt(0, 10 ** n)).padStart(n, '0');
}

// Hash an OTP code for auth_otp.code_hash — NEVER store the plaintext code. sha256 to match
// hashToken; the code is intentionally low-entropy, so the real brute-force defense is the
// per-OTP attempt cap + expiry (enforced at verify, R02). Stronger/salted hashing lands
// with the real OTP provider (BD-DOCS-032 open question), behind this stable seam.
export function hashOtpCode(code) {
  return createHash('sha256').update(String(code)).digest('hex');
}
