// /server/src/services/chat/index.js — #784 R07 chat, mounted at /api/v1/chat. NOT one of the 9
// Mini-Yonder services (registered separately in server.js, outside the SERVICES loop).
//
//   GET  /api/v1/chat/messages?chatId=         -> { items: [message] }  the shared thread, chronological
//   POST /api/v1/chat/messages                 -> 201 { message }       append; clientMsgId = idempotent re-send
//
// AUTH (epic #784): this is the MINIMAL cross-device proof and is INTENTIONALLY NOT 401-gated —
// sender_role travels in the body, ride_id is nullable, so a message typed on device A appears on
// device B through one Postgres thread (keyed by chat_id) without the auth-token cutover (R17) or a
// rides row (R10). It is dark (no client consumer until R18) and inputs are bounded; real auth/
// participant gating arrives when chat integrates with R17. The full thread freezes at R18.
import { serializeMessage } from '../../serialize.js';
import { listMessagesByChat, insertMessage, findMessageByDedup } from '../../repositories/messages.js';

const problem = (reply, status, code, error, retryable = false) =>
  reply.code(status).send({ error, code, retryable });

export default async function chatService(app) {
  app.get('/messages', {
    schema: {
      querystring: {
        type: 'object',
        required: ['chatId'],
        properties: {
          chatId: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
    },
  }, async (req) => {
    // The thread is bounded server-side (the repo clamps to 200). A client-facing page size is
    // omitted deliberately: the app-wide ajv coerceTypes:false would 400 an integer querystring, and
    // Phase-1 threads are small (the realtime poll, R09, carries incremental updates).
    const items = await listMessagesByChat(app.db, req.query.chatId);
    return { items: items.map(serializeMessage) };
  });

  app.post('/messages', {
    schema: {
      body: {
        type: 'object',
        required: ['chatId', 'body'],
        additionalProperties: false,
        properties: {
          chatId: { type: 'string', minLength: 1, maxLength: 200 },
          body: { type: 'string', minLength: 1, maxLength: 4000 },
          senderRole: { type: 'string', enum: ['driver', 'passenger'] },
          // client_msg_id is BIGINT; bound to MAX_SAFE_INTEGER so the JS round-trip is lossless.
          clientMsgId: { type: 'integer', minimum: 0, maximum: 9007199254740991 },
          displayTime: { type: 'string', minLength: 1, maxLength: 16 },
        },
      },
    },
  }, async (req, reply) => {
    const b = req.body;
    const seed = {
      chatId: b.chatId,
      senderRole: b.senderRole ?? null,
      clientMsgId: b.clientMsgId ?? null,
      body: b.body,
      displayTime: b.displayTime ?? null,
    };
    // Idempotent re-send: a dedup conflict (same chat_id + sender_role + clientMsgId) returns the
    // original row rather than a duplicate.
    let message = await insertMessage(app.db, seed);
    if (!message && seed.clientMsgId != null) {
      message = await findMessageByDedup(app.db, seed.chatId, seed.senderRole, seed.clientMsgId);
    }
    if (!message) return problem(reply, 500, 'INTERNAL', 'message not persisted', true);
    return reply.code(201).send({ message: serializeMessage(message) });
  });
}
