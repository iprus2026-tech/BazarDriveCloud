// /server/src/services/auth/tokens.js — opaque token hashing for auth_session.token_hash
// (BD-DOCS-032: store a HASH, never the plaintext token). Token FORMAT is deferred, so
// this is just a stable one-way hash. BOTH sides use it: the resolution seam
// (plugins/auth.js) hashes the presented token to look a session up, and the OTP-verify
// endpoint (next PR) hashes the minted token before INSERT — so they must always match.
import { createHash } from 'node:crypto';

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}
