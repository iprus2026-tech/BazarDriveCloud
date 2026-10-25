// /server/src/repositories/otps.js — the ONLY module that runs SQL against auth_otp
// (migration 0002). Repositories are the single SQL seam (ADR BD-DOCS-041). Stores a code
// HASH only (never the plaintext code; see services/auth/tokens.hashOtpCode).
//
// Phase-1 surface used by the OTP request/verify cutover (R02): insert a code, find the
// freshest live code for a phone, bump the attempt counter, and consume on success. Wired
// LIVE by R02 (services/auth/index.js); the DB-gated round-trip still pins the contracts.

// created_at is the time of this statement (statement_timestamp()), not the column default now()
// — the START of the transaction. Under the limit locks (BD-AUTH-HARDEN-01 #824) a request may
// wait for a lock while a later-started one writes first; with now() the waiter's row would sort
// before the one written ahead of it, and its "seconds since the latest code" would come out
// negative. Statements after the lock see the time after the lock.
export async function insertOtp(db, { phone, codeHash, expiresAt, requestedIp = null }) {
  const { rows } = await db.query(
    `INSERT INTO auth_otp (phone, code_hash, expires_at, requested_ip, created_at)
       VALUES ($1, $2, $3, $4, statement_timestamp())
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

// One-time use, supersede-safe: stamp consumed_at when a code is accepted. Guarded by
// consumed_at IS NULL (double-consume is a no-op), expires_at > now() (atomic expiry recheck,
// Codex #787 P2), AND that no STRICTLY-NEWER code exists for the SAME phone — so if the caller's
// live read went stale because a replacement OTP was requested mid-verify, this consume returns
// null instead of authenticating a just-superseded code (Codex #788). The supersession recheck
// keys off the target row's OWN phone (self-contained) and runs in the same atomic UPDATE as the
// consume, closing the read→consume TOCTOU. Returns the row only if THIS call consumed the
// still-latest, still-valid code, else null.
export async function markOtpConsumed(db, id) {
  const { rows } = await db.query(
    `UPDATE auth_otp SET consumed_at = now()
      WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()
        AND NOT EXISTS (
          SELECT 1 FROM auth_otp newer
           WHERE newer.phone = auth_otp.phone AND newer.created_at > auth_otp.created_at
        )
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

// BD-AUTH-HARDEN-01 (#824) — the limits are counted from auth_otp itself (migration 0014 indexes
// the source address and the age), so they hold across restarts and instances without a new
// store. The lock and the two usage reads run inside the caller's transaction.

// Serialize the limit check and the write per source address and per phone until the transaction
// ends, so two concurrent requests cannot both pass the same count. The address is always locked
// first and the phone last, so no two transactions wait on each other in a cycle. A hash
// collision only serializes two unrelated keys; it never skips a lock.
export async function lockOtpKeys(db, { phone, ip = null }) {
  if (ip) await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`auth_otp:ip:${ip}`]);
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`auth_otp:phone:${phone}`]);
}

const REQUEST_KEY_COLUMNS = { phone: 'phone', ip: 'requested_ip' };

// The usage reads below measure "now" with statement_timestamp() (this statement, after the lock),
// not now() (the transaction start, before a possible wait for the lock) — see insertOtp.

// Code requests for one phone or one source address within the last `windowSeconds`, on the DB
// clock: `count` (capped at `max` — only the newest `max` rows matter), `secondsSinceLatest`
// (null when there is none) and `retryAfterSeconds` — when the oldest of those `max` rows leaves
// the window, so the count drops below `max` (null while under it).
export async function otpRequestUsage(db, { by, value, windowSeconds, max }) {
  const column = REQUEST_KEY_COLUMNS[by];
  if (!column) throw new Error(`otpRequestUsage: unknown key ${by}`);
  const { rows } = await db.query(
    `WITH recent AS (
         SELECT created_at FROM auth_otp
          WHERE ${column} = $1 AND created_at > statement_timestamp() - make_interval(secs => $2)
          ORDER BY created_at DESC
          LIMIT $3
       )
     SELECT count(*)::int AS count,
            EXTRACT(EPOCH FROM statement_timestamp() - max(created_at))::float8 AS since_latest,
            CASE WHEN count(*) >= $3 THEN
              GREATEST(1, CEIL(EXTRACT(EPOCH FROM min(created_at) + make_interval(secs => $2) - statement_timestamp())))::int
            END AS retry_after
       FROM recent`,
    [value, windowSeconds, max],
  );
  const row = rows[0];
  return {
    count: row.count,
    secondsSinceLatest: row.since_latest === null ? null : Number(row.since_latest),
    retryAfterSeconds: row.retry_after ?? null,
  };
}

// Failed checks for one phone within the last `windowSeconds`, across all of its codes. A code's
// attempts count every check (verify counts before comparing); a consumed code's one successful
// check is not a failure. `retryAfterSeconds`: when enough of them leave the window that the total
// drops below `max` (null while under it). Walking from the newest code, the first code at which
// the running total reaches `max` is the one whose departure brings it back under.
export async function otpFailedVerifyUsage(db, { phone, windowSeconds, max }) {
  const { rows } = await db.query(
    `WITH recent AS (
         SELECT created_at, GREATEST(attempts - (consumed_at IS NOT NULL)::int, 0) AS failed
           FROM auth_otp
          WHERE phone = $1 AND created_at > statement_timestamp() - make_interval(secs => $2)
       ), running AS (
         SELECT created_at, SUM(failed) OVER (ORDER BY created_at DESC ROWS UNBOUNDED PRECEDING) AS total
           FROM recent
       )
     SELECT (SELECT COALESCE(SUM(failed), 0)::int FROM recent) AS failed,
            (SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM created_at + make_interval(secs => $2) - statement_timestamp())))::int
               FROM running WHERE total >= $3 ORDER BY created_at DESC LIMIT 1) AS retry_after`,
    [phone, windowSeconds, max],
  );
  return { failed: rows[0].failed, retryAfterSeconds: rows[0].retry_after ?? null };
}

// Retention: delete up to `batch` codes older than `retentionSeconds`, oldest first. A session
// minted from a deleted code keeps working: auth_session.otp_id is ON DELETE SET NULL and is
// never read. Returns how many rows went.
export async function deleteOldOtps(db, { retentionSeconds, batch }) {
  const { rowCount } = await db.query(
    `DELETE FROM auth_otp
      WHERE id IN (
        SELECT id FROM auth_otp
         WHERE created_at < now() - make_interval(secs => $1)
         ORDER BY created_at
         LIMIT $2
      )`,
    [retentionSeconds, batch],
  );
  return rowCount;
}
