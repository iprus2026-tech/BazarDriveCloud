// /server/src/services/chat/index.js — #784 R07 chat, mounted at /api/v1/chat. NOT one of the 9
// Mini-Yonder services (registered separately in server.js, outside the SERVICES loop).
//
//   GET  /api/v1/chat/messages?chatId=         -> { items: [message] }  the shared thread, chronological
//   POST /api/v1/chat/messages                 -> 201 { message }       append; clientMsgId = idempotent re-send
//
// BD-CHAT-AUTH-01 (#825, owner's decisions R1–R7, 2026-10-25) — chat is authorized by ride
// participation:
//   - only the thread of a real ride is served: chatId 'trip-<tripId>' with a `rides` row for that
//     trip. 'response-…', 'demo' and anything else are 404 (R1);
//   - only the ride's passenger and driver read and write. The sender role comes from the session's
//     place in the ride; the body's `senderRole` is accepted for compatibility and ignored (R2);
//   - no session -> 401; an unknown thread and someone else's thread -> the SAME 404 CHAT_NOT_FOUND,
//     so the reply never tells whether a ride exists (R3); a failed session read -> 503;
//   - reading is always allowed; writing only while the ride is not terminal, else 409 CHAT_CLOSED
//     (R4; a left item after a ride will be its own request and thread, not this chat);
//   - at most 30 messages a minute per sender in a thread, counted from `messages` under a per-
//     thread-and-sender lock; else 429 CHAT_RATE_LIMITED with Retry-After (R5). An idempotent re-send
//     of an existing clientMsgId returns the original and never counts against the limit.
import { serializeMessage } from '../../serialize.js';
import {
  listMessagesByChat, insertMessage, findMessageByDedup, lockChatSender, chatSendRetryAfter,
} from '../../repositories/messages.js';
import { findRideByTripId, lockRideStatusForShare } from '../../repositories/rides.js';
import { TERMINAL_RIDE_STATUSES } from '../../domain/ride-status.js';

const TRIP_CHAT_PREFIX = 'trip-';
const SEND_WINDOW_SECONDS = 60;
const SEND_LIMIT = 30;

const problem = (reply, status, code, error, retryable = false) =>
  reply.code(status).send({ error, code, retryable });

// The viewer's side of the ride, or null (the same rule as the realtime poll's participant check).
function participantRole(ride, userId) {
  if (ride.driver_user_id && String(ride.driver_user_id) === String(userId)) return 'driver';
  if (ride.passenger_user_id && String(ride.passenger_user_id) === String(userId)) return 'passenger';
  return null;
}

// Resolve the session and the thread: { ride, role }, or { refused } after sending the refusal.
async function authorizeThread(app, req, reply, chatId) {
  const viewer = await req.resolveUser();
  if (req.authError) return { refused: problem(reply, 503, 'SESSION_LOOKUP_FAILED', 'session lookup failed', true) };
  if (!viewer) return { refused: problem(reply, 401, 'UNAUTHENTICATED', 'authentication required') };
  const tripId = chatId.startsWith(TRIP_CHAT_PREFIX) ? chatId.slice(TRIP_CHAT_PREFIX.length) : '';
  const ride = tripId ? await findRideByTripId(app.db, tripId) : null;
  const role = ride ? participantRole(ride, viewer.userId) : null;
  if (!role) return { refused: problem(reply, 404, 'CHAT_NOT_FOUND', 'chat not found') };
  return { ride, role };
}

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
  }, async (req, reply) => {
    const thread = await authorizeThread(app, req, reply, req.query.chatId);
    if (thread.refused) return thread.refused;
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
          // Accepted for compatibility with existing clients; the server decides the role (R2).
          senderRole: { type: 'string', enum: ['driver', 'passenger'] },
          // client_msg_id is BIGINT; bound to MAX_SAFE_INTEGER so the JS round-trip is lossless.
          clientMsgId: { type: 'integer', minimum: 0, maximum: 9007199254740991 },
          displayTime: { type: 'string', minLength: 1, maxLength: 16 },
        },
      },
    },
  }, async (req, reply) => {
    const b = req.body;
    const thread = await authorizeThread(app, req, reply, b.chatId);
    if (thread.refused) return thread.refused;
    if (TERMINAL_RIDE_STATUSES.has(thread.ride.status)) {
      return problem(reply, 409, 'CHAT_CLOSED', 'the ride is over — the chat is read-only');
    }
    const seed = {
      chatId: b.chatId,
      rideId: thread.ride.id,
      senderRole: thread.role,
      clientMsgId: b.clientMsgId ?? null,
      body: b.body,
      displayTime: b.displayTime ?? null,
    };
    // Idempotent re-send (same chat_id + sender_role + clientMsgId): the original row, uncounted.
    if (seed.clientMsgId != null) {
      const existing = await findMessageByDedup(app.db, seed.chatId, seed.senderRole, seed.clientMsgId);
      if (existing) return reply.code(201).send({ message: serializeMessage(existing) });
    }
    const outcome = await app.db.tx(async (client) => {
      // Re-check under a share lock on the ride (CodeRabbit #1151): a cancel or completion that
      // committed after the check above, but before this insert, must still close the chat.
      const status = await lockRideStatusForShare(client, seed.rideId);
      if (!status || TERMINAL_RIDE_STATUSES.has(status)) return { closed: true };
      await lockChatSender(client, seed.chatId, seed.senderRole);
      // Re-check the re-send under the lock (CodeRabbit #1151): a concurrent copy of this message
      // may have been written while we waited, and it must win over the rate limit.
      if (seed.clientMsgId != null) {
        const existing = await findMessageByDedup(client, seed.chatId, seed.senderRole, seed.clientMsgId);
        if (existing) return { message: existing };
      }
      const wait = await chatSendRetryAfter(client, {
        chatId: seed.chatId, senderRole: seed.senderRole, windowSeconds: SEND_WINDOW_SECONDS, max: SEND_LIMIT,
      });
      if (wait) return { wait };
      return { message: await insertMessage(client, seed) };
    });
    if (outcome.closed) return problem(reply, 409, 'CHAT_CLOSED', 'the ride is over — the chat is read-only');
    if (outcome.wait) {
      return reply.code(429).header('retry-after', String(outcome.wait)).send({
        error: 'too many messages — try again later', code: 'CHAT_RATE_LIMITED', retryable: false,
        retryAfterSeconds: outcome.wait,
      });
    }
    let message = outcome.message;
    // A concurrent re-send of the same clientMsgId won the insert: return that row.
    if (!message && seed.clientMsgId != null) {
      message = await findMessageByDedup(app.db, seed.chatId, seed.senderRole, seed.clientMsgId);
    }
    if (!message) return problem(reply, 500, 'INTERNAL', 'message not persisted', true);
    return reply.code(201).send({ message: serializeMessage(message) });
  });
}
