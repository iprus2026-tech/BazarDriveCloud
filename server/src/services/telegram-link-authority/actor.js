// Internal transport proof. Never reconstruct this capability from JSON, a user id,
// username, phone, initDataUnsafe, or a caller-supplied `verified: true` flag.
import { timingSafeEqual } from 'node:crypto';

const issued = new WeakMap();
export function canonicalTelegramId(value) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value);
  return /^[1-9][0-9]{0,15}$/.test(s) && BigInt(s) <= 4503599627370495n ? s : null;
}

export function validateNamespace({ botId, environment } = {}) {
  const id = canonicalTelegramId(botId);
  if (!id || typeof environment !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(environment)) {
    throw new TypeError('Invalid Telegram namespace');
  }
  return Object.freeze({ botId: id, environment });
}

export function createPrivateActorVerifier({ botId, environment, webhookSecret } = {}) {
  const scope = validateNamespace({ botId, environment });
  if (typeof webhookSecret !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(webhookSecret)) {
    throw new TypeError('A configured webhook secret is required');
  }
  const expected = Buffer.from(webhookSecret);
  return function verify(secretHeader, update) {
    if (typeof secretHeader !== 'string' || secretHeader.length !== webhookSecret.length) return null;
    const actual = Buffer.from(secretHeader);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    if (!update || !Number.isSafeInteger(update.update_id) || update.update_id < 0) return null;
    // Ambiguous envelopes and every non-private / business / inline flow fail closed.
    const kinds = Object.keys(update).filter(k => k !== 'update_id');
    if (kinds.length !== 1 || !['message', 'callback_query'].includes(kinds[0])) return null;
    const callback = update.callback_query;
    const msg = callback ? callback.message : update.message;
    if (callback?.inline_message_id != null || msg?.business_connection_id != null || msg?.guest_query_id != null) return null;
    const from = callback ? callback.from : msg?.from;
    const userId = canonicalTelegramId(from?.id);
    const chatId = canonicalTelegramId(msg?.chat?.id);
    if (!userId || from?.is_bot !== false || msg?.chat?.type !== 'private' || chatId !== userId) return null;
    const actor = Object.freeze({ ...scope, telegramUserId: userId, privateChatId: chatId });
    issued.set(actor, Date.now());
    return actor;
  };
}

export function isPrivateActor(actor, scope) {
  const time = actor && issued.get(actor);
  return time !== undefined && Date.now() >= time && Date.now() - time < 60_000
    && actor.botId === scope.botId && actor.environment === scope.environment;
}
