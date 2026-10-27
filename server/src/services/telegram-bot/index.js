// /server/src/services/telegram-bot/index.js — @BazarDriveBot over a webhook (BD-TG-BOT-01 #1128,
// ADR BD-DOCS-052 R3/R4/R9). The bot does two things:
//   /start   — a confirmed number: remove the legacy reply keyboard, then the Mini App button;
//              no number yet: the consent text with the «Поделиться номером» contact keyboard
//              (it replaces the legacy keyboard); a revoked Telegram: a refusal.
//   contact  — the sender's own contact, after the consent text was shown, goes to the M4 intake
//              linkTelegramContact(); the reply follows its result.
// Anything else in the private chat gets «Чтобы войти, отправьте /start.». Updates that are not a
// private-chat message from a person are ignored without a reply (actor.js).
//
// Two bounded in-memory stores, no table (owner decision, #1128): the update_ids already handled
// (Telegram redelivers after a timeout), and the chats that were shown the consent text. After a
// restart a contact gets «Нажмите /start ещё раз.» and is not stored; /start shows the consent
// text again.
// Nothing here logs a phone, the token, the webhook secret or an update body (R10).
import { createPrivateActorVerifier, isPrivateActor } from './actor.js';
import { botIdFromToken } from './bot-api.js';
import * as T from './texts.js';
import { linkTelegramContact } from '../auth/telegram.js';
import { findTelegramIdentity } from '../../repositories/telegram.js';

export const UPDATE_MEMORY = 1_000;
export const CONSENT_MEMORY = 10_000;
export const CONSENT_TTL_MS = 24 * 60 * 60 * 1000;
const START = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/;

// The bot answers only when all three are configured; otherwise the webhook is 503.
export function botEnabled(telegram) {
  return Boolean(telegram?.botToken && telegram.webhookSecret && telegram.miniAppUrl);
}

export function createUpdateMemory(capacity = UPDATE_MEMORY) {
  const seen = new Set();
  return {
    claim(id) {
      if (seen.has(id)) return false;
      seen.add(id);
      if (seen.size > capacity) seen.delete(seen.values().next().value);
      return true;
    },
    release(id) { seen.delete(id); },
  };
}

export function createConsentMemory({ capacity = CONSENT_MEMORY, ttlMs = CONSENT_TTL_MS, now = Date.now } = {}) {
  const shown = new Map();
  return {
    mark(chatId) {
      shown.delete(chatId);
      shown.set(chatId, now());
      if (shown.size > capacity) shown.delete(shown.keys().next().value);
    },
    has(chatId) {
      const at = shown.get(chatId);
      if (at === undefined) return false;
      if (now() - at >= ttlMs) { shown.delete(chatId); return false; }
      return true;
    },
  };
}

const namespaceEnv = (nodeEnv) => (/^[a-z][a-z0-9_-]{0,31}$/.test(nodeEnv || '') ? nodeEnv : 'server');

export function createTelegramBot({ db, telegram, api, log = null, nodeEnv = 'development' }) {
  const scope = Object.freeze({ botId: botIdFromToken(telegram.botToken), environment: namespaceEnv(nodeEnv) });
  const verify = createPrivateActorVerifier({ ...scope, webhookSecret: telegram.webhookSecret });
  const updates = createUpdateMemory();
  const consent = createConsentMemory();
  const { miniAppUrl, supportContact } = telegram;

  async function send(chatId, text, markup) {
    try {
      await api.sendMessage(chatId, text, markup);
      return true;
    } catch (err) {
      log?.warn({ method: err?.method, status: err?.status, causeCode: err?.causeCode }, 'telegram send failed');
      return false;
    }
  }
  const askForContact = async (chatId) => {
    if (await send(chatId, T.startText(miniAppUrl), T.contactKeyboard())) consent.mark(chatId);
  };
  // One reply_markup per message: the removal first, then the Mini App button.
  const openApp = async (chatId, first, second) => {
    await send(chatId, first, T.removeKeyboard());
    await send(chatId, second, T.openAppButton(miniAppUrl));
  };
  const refuse = (chatId, text) => send(chatId, `${text} ${T.supportLine(supportContact)}`, T.removeKeyboard());

  async function onStart(chatId, fromId) {
    const identity = await findTelegramIdentity(db, fromId);
    if (identity?.revoked_at) return refuse(chatId, T.TEXT.revoked);
    if (identity) return openApp(chatId, T.TEXT.confirmed, T.TEXT.openApp);
    return askForContact(chatId);
  }

  async function onContact(chatId, fromId, contact) {
    // R4: the sender's own contact, and only after the consent text (R9) was shown in this chat.
    if (contact?.user_id !== fromId) return send(chatId, T.TEXT.foreignContact, T.contactKeyboard());
    // No consent mark (a restart since /start): ask for /start again and drop the stale button.
    if (!consent.has(chatId)) return send(chatId, T.TEXT.startAgain, T.removeKeyboard());
    let result;
    try {
      result = await linkTelegramContact(db, { fromId, chatType: 'private', contact, log });
    } catch (err) {
      // Only the SQLSTATE: a driver message may quote values.
      log?.error({ code: err?.code }, 'telegram contact intake failed');
      return send(chatId, T.TEXT.saveFailed, T.contactKeyboard());
    }
    if (result.ok) {
      return result.linked
        ? openApp(chatId, T.TEXT.linked, T.TEXT.linkedOpenApp)
        : openApp(chatId, T.TEXT.alreadyLinked, T.TEXT.openApp);
    }
    switch (result.code) {
      case 'FOREIGN_CONTACT': return send(chatId, T.TEXT.foreignContact, T.contactKeyboard());
      case 'INVALID_PHONE': return send(chatId, T.TEXT.invalidPhone, T.contactKeyboard());
      case 'TELEGRAM_CONFLICT': return refuse(chatId, T.TEXT.conflict);
      case 'TELEGRAM_REVOKED': return refuse(chatId, T.TEXT.revoked);
      default: return null; // NOT_PRIVATE / INVALID_SENDER cannot pass the verifier.
    }
  }

  // -> 'ignored' | 'replayed' | 'handled'. A thrown error (the database on /start) releases the
  // update_id, so Telegram's redelivery is handled.
  async function handleUpdate(secretHeader, update) {
    const actor = verify(secretHeader, update);
    if (!actor || !isPrivateActor(actor, scope)) return 'ignored';
    if (!update.message) return 'ignored'; // callback_query: the bot sends no callback buttons.
    if (!updates.claim(update.update_id)) return 'replayed';
    const chatId = Number(actor.privateChatId);
    const fromId = Number(actor.telegramUserId);
    const { message } = update;
    try {
      if (message.contact) await onContact(chatId, fromId, message.contact);
      else if (typeof message.text === 'string' && START.test(message.text)) await onStart(chatId, fromId);
      else await send(chatId, T.TEXT.other);
    } catch (err) {
      updates.release(update.update_id);
      throw err;
    }
    return 'handled';
  }

  return Object.freeze({ handleUpdate, scope });
}
