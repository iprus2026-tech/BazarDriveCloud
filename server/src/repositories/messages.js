// /server/src/repositories/messages.js — the ONLY module that runs SQL against `messages`
// (migration 0001). Single SQL seam (ADR BD-DOCS-041). #784 R07 chat: one shared thread per
// chat_id ('trip-<tripId>' / 'response-<responseId>' / 'demo'), GET/POST, clientMsgId idempotency.
// R07 keys purely by chat_id; the denormalized ride_id/response_id/response_uuid FKs stay null (they
// are a future join enrichment — the epic's minimal slice needs neither a rides row nor auth).

// The shared thread, oldest-first by created_at (id is a stable, deterministic tiebreaker for the
// rare same-instant rows — not itself chronological). Served by idx_messages_chat.
export async function listMessagesByChat(db, chatId, { limit = 200 } = {}) {
  const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 500 ? limit : 200;
  const { rows } = await db.query(
    `SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC, id ASC LIMIT $2`,
    [chatId, safeLimit],
  );
  return rows;
}

// Append a message. When client_msg_id is provided, the partial UNIQUE index uq_messages_client_id
// (chat_id, COALESCE(sender_role, legacy_dir, '~'), client_msg_id) WHERE client_msg_id IS NOT NULL
// makes a re-send idempotent: ON CONFLICT DO NOTHING returns empty and the caller re-reads the
// existing row. A message with no client_msg_id is outside the partial index, so it always inserts.
export async function insertMessage(db, m) {
  const { rows } = await db.query(
    `INSERT INTO messages (chat_id, sender_role, client_msg_id, body, display_time)
       VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (chat_id, COALESCE(sender_role, legacy_dir, '~'), client_msg_id) WHERE client_msg_id IS NOT NULL
     DO NOTHING
     RETURNING *`,
    [m.chatId, m.senderRole, m.clientMsgId, m.body, m.displayTime],
  );
  return rows[0] ?? null; // null on dedup conflict — caller re-reads via findMessageByDedup
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
