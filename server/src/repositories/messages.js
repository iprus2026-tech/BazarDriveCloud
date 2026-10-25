// /server/src/repositories/messages.js — the ONLY module that runs SQL against `messages`
// (migration 0001). Single SQL seam (ADR BD-DOCS-041). #784 R07 chat: one shared thread per
// chat_id, GET/POST, clientMsgId idempotency. Since BD-CHAT-AUTH-01 (#825) the service serves only
// 'trip-<tripId>' threads of a real ride to its two participants; a new message also records its
// ride_id. response_id / response_uuid stay null.

// The shared thread, presented oldest-first. When a thread exceeds the cap we keep the most RECENT
// window, not the first N ever written (else a busy thread would stop showing new messages — Codex
// #796 P2): take the latest `safeLimit` rows DESC, then re-order chronologically for display. id is a
// stable tiebreaker for same-instant rows (not itself chronological). Served by idx_messages_chat.
export async function listMessagesByChat(db, chatId, { limit = 200 } = {}) {
  const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 500 ? limit : 200;
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2
     ) recent
     ORDER BY created_at ASC, id ASC`,
    [chatId, safeLimit],
  );
  return rows;
}

// Append a message. When client_msg_id is provided, the partial UNIQUE index uq_messages_client_id
// (chat_id, COALESCE(sender_role, legacy_dir, '~'), client_msg_id) WHERE client_msg_id IS NOT NULL
// makes a re-send idempotent: ON CONFLICT DO NOTHING returns empty and the caller re-reads the
// existing row. A message with no client_msg_id is outside the partial index, so it always inserts.
// created_at is this statement's time (statement_timestamp()), not the column default now() — the
// transaction start: the send limit (#825) writes under a lock a request may have waited for, and
// its window must count the rows in the order they were written (the BD-AUTH-HARDEN-01 lesson).
export async function insertMessage(db, m) {
  const { rows } = await db.query(
    `INSERT INTO messages (chat_id, ride_id, sender_role, client_msg_id, body, display_time, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, statement_timestamp())
     ON CONFLICT (chat_id, COALESCE(sender_role, legacy_dir, '~'), client_msg_id) WHERE client_msg_id IS NOT NULL
     DO NOTHING
     RETURNING *`,
    [m.chatId, m.rideId ?? null, m.senderRole, m.clientMsgId, m.body, m.displayTime],
  );
  return rows[0] ?? null; // null on dedup conflict — caller re-reads via findMessageByDedup
}

// BD-CHAT-AUTH-01 (#825) — the send limit, counted from `messages` (served by idx_messages_chat).
// Serialize sends per thread and sender until the transaction ends, so concurrent sends cannot pass
// the same count. A hash collision only serializes two unrelated keys.
export async function lockChatSender(db, chatId, senderRole) {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`messages:${senderRole}:${chatId}`]);
}

// Seconds until this sender may send again in this thread — when the oldest of its newest `max`
// messages within the last `windowSeconds` leaves the window — or null while under `max`.
export async function chatSendRetryAfter(db, { chatId, senderRole, windowSeconds, max }) {
  const { rows } = await db.query(
    `WITH recent AS (
         SELECT created_at FROM messages
          WHERE chat_id = $1 AND sender_role = $2
            AND created_at > statement_timestamp() - make_interval(secs => $3)
          ORDER BY created_at DESC
          LIMIT $4
       )
     SELECT CASE WHEN count(*) >= $4 THEN
              GREATEST(1, CEIL(EXTRACT(EPOCH FROM min(created_at) + make_interval(secs => $3) - statement_timestamp())))::int
            END AS retry_after
       FROM recent`,
    [chatId, senderRole, windowSeconds, max],
  );
  return rows[0].retry_after ?? null;
}

// Re-read the existing row after a dedup conflict, matching the index discriminator. R07 sends never
// set legacy_dir, so COALESCE(sender_role, legacy_dir, '~') reduces to COALESCE(sender_role, '~').
export async function findMessageByDedup(db, chatId, senderRole, clientMsgId) {
  const { rows } = await db.query(
    `SELECT * FROM messages
      WHERE chat_id = $1 AND client_msg_id = $2
        AND COALESCE(sender_role, legacy_dir, '~') = COALESCE($3::text, '~')
      LIMIT 1`,
    [chatId, clientMsgId, senderRole],
  );
  return rows[0] ?? null;
}
