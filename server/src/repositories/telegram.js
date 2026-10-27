// /server/src/repositories/telegram.js — the ONLY module that runs SQL against telegram_identities
// and auth_telegram_attempts (migration 0015, ADR BD-DOCS-052). Repositories are the single SQL
// seam (ADR BD-DOCS-041). Nothing here sees the raw initData, the bot token or a phone: an attempt
// keeps only the SHA-256 of initData `hash` (R6), and the phone stays in users (R2).

// Per-key serialization of the limit checks and the identity writes, as auth_otp does (#824).
export async function lockTelegramKey(db, key) {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`auth_telegram:${key}`]);
}

export async function findTelegramIdentity(db, telegramUserId) {
  const { rows } = await db.query(
    `SELECT telegram_user_id, user_id, revoked_at
       FROM telegram_identities
      WHERE telegram_user_id = $1`,
    [telegramUserId],
  );
  return rows[0] ?? null;
}

export async function findTelegramIdentityByUser(db, userId) {
  const { rows } = await db.query(
    `SELECT telegram_user_id, user_id, revoked_at
       FROM telegram_identities
      WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function insertTelegramIdentity(db, { telegramUserId, userId, consentVersion }) {
  const { rows } = await db.query(
    `INSERT INTO telegram_identities (telegram_user_id, user_id, consented_at, consent_version)
     VALUES ($1, $2, statement_timestamp(), $3)
     RETURNING telegram_user_id, user_id, linked_at, consented_at, consent_version`,
    [telegramUserId, userId, consentVersion],
  );
  return rows[0];
}

// One attempt row. `initDataHash` is set only on the attempt that consumes the initData: the
// partial UNIQUE index makes a second consumer fail, and then this returns null (a replay).
export async function insertTelegramAttempt(db, { ip = null, telegramUserId = null, initDataHash = null, outcome }) {
  const { rows } = await db.query(
    `INSERT INTO auth_telegram_attempts (ip, telegram_user_id, init_data_hash, outcome)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (init_data_hash) WHERE init_data_hash IS NOT NULL DO NOTHING
     RETURNING id`,
    [ip, telegramUserId, initDataHash, outcome],
  );
  return rows[0]?.id ?? null;
}

export async function setTelegramAttemptOutcome(db, id, outcome) {
  await db.query('UPDATE auth_telegram_attempts SET outcome = $2 WHERE id = $1', [id, outcome]);
}

const USAGE_KEY_COLUMNS = { ip: 'ip', telegramUserId: 'telegram_user_id' };

// Attempts by one IP or one Telegram id within the last `windowSeconds`, on the DB clock. A
// refusal (`rate_limited`) does not count, so it does not extend itself. `retryAfterSeconds`:
// when the oldest of the newest `max` rows leaves the window (null while under `max`).
export async function telegramAttemptUsage(db, { by, value, windowSeconds, max }) {
  const column = USAGE_KEY_COLUMNS[by];
  if (!column) throw new Error(`telegramAttemptUsage: unknown key ${by}`);
  const { rows } = await db.query(
    `WITH recent AS (
         SELECT created_at FROM auth_telegram_attempts
          WHERE ${column} = $1 AND outcome <> 'rate_limited'
            AND created_at > statement_timestamp() - make_interval(secs => $2)
          ORDER BY created_at DESC
          LIMIT $3
       )
     SELECT CASE WHEN count(*) >= $3 THEN
              GREATEST(1, CEIL(EXTRACT(EPOCH FROM min(created_at) + make_interval(secs => $2) - statement_timestamp())))::int
            END AS retry_after
       FROM recent`,
    [value, windowSeconds, max],
  );
  return { retryAfterSeconds: rows[0].retry_after ?? null };
}

// Retention (R6): delete up to `batch` attempts older than `retentionSeconds`, oldest first.
export async function deleteOldTelegramAttempts(db, { retentionSeconds, batch }) {
  const { rowCount } = await db.query(
    `DELETE FROM auth_telegram_attempts
      WHERE id IN (
        SELECT id FROM auth_telegram_attempts
         WHERE created_at < now() - make_interval(secs => $1)
         ORDER BY created_at
         LIMIT $2
      )`,
    [retentionSeconds, batch],
  );
  return rowCount;
}
