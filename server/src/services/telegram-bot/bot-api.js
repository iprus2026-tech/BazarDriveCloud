// /server/src/services/telegram-bot/bot-api.js — the minimal Telegram Bot API client the bot
// (BD-TG-BOT-01 #1128) and `npm run ops:telegram` need. The token is part of the request URL
// only: no error, log line or return value of this module carries it (ADR BD-DOCS-052 R10).
// `fetchImpl` is injectable so the tests never reach the network.

export const BOT_API_ORIGIN = 'https://api.telegram.org';
export const BOT_API_TIMEOUT_MS = 5_000;
const DESCRIPTION_MAX = 200;

// A sanitized failure: the method, an HTTP status and Telegram's own description, never the URL.
export class BotApiError extends Error {
  constructor(method, { status = null, description = null, cause = null } = {}) {
    super(`Telegram ${method} failed`);
    this.name = 'BotApiError';
    this.code = 'TELEGRAM_API_ERROR';
    this.method = method;
    this.status = status;
    this.description = description;
    this.causeCode = cause;
  }
}

export function createBotApi({ token, fetchImpl = globalThis.fetch, timeoutMs = BOT_API_TIMEOUT_MS } = {}) {
  if (typeof token !== 'string' || !/^\d{5,20}:[A-Za-z0-9_-]{30,64}$/.test(token)) {
    throw new TypeError('A well-formed bot token is required');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');

  async function call(method, params = {}) {
    let res;
    try {
      res = await fetchImpl(`${BOT_API_ORIGIN}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // A network or timeout error: keep only a code, the message may echo the URL.
      throw new BotApiError(method, { cause: err?.cause?.code || err?.name || 'FETCH_FAILED' });
    }
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (!body || body.ok !== true) {
      const description = typeof body?.description === 'string'
        ? body.description.slice(0, DESCRIPTION_MAX) : null;
      throw new BotApiError(method, { status: res.status, description });
    }
    return body.result;
  }

  return Object.freeze({
    sendMessage: (chatId, text, replyMarkup) => call('sendMessage', {
      chat_id: chatId, text, link_preview_options: { is_disabled: true },
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
    setWebhook: (params) => call('setWebhook', params),
    getWebhookInfo: () => call('getWebhookInfo'),
    deleteWebhook: (params = {}) => call('deleteWebhook', params),
  });
}

// The bot id is the token's public prefix; it names the actor namespace (actor.js).
export function botIdFromToken(token) {
  return typeof token === 'string' ? token.split(':', 1)[0] : '';
}
