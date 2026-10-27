// /server/src/routes/webhooks/telegram.js — POST /api/v1/webhooks/telegram (BD-TG-BOT-01 #1128).
//
// Telegram calls it with no BazarDrive session. The only authority is the secret Telegram echoes
// in X-Telegram-Bot-Api-Secret-Token (set by `npm run ops:telegram -- set`), compared in constant
// time: a wrong or missing secret is 401 and nothing runs. With the right secret every update is
// answered 200, even an ignored or replayed one, so Telegram does not redeliver it; only an
// unexpected error is a 5xx, which Telegram retries. Without TELEGRAM_BOT_TOKEN,
// TELEGRAM_WEBHOOK_SECRET and TELEGRAM_MINIAPP_URL the route is 503 TELEGRAM_BOT_DISABLED.
// The body is never logged: it carries the phone of a shared contact.
import { hashToken, hashesEqual } from '../../services/auth/tokens.js';
import { botEnabled, createTelegramBot } from '../../services/telegram-bot/index.js';
import { createBotApi } from '../../services/telegram-bot/bot-api.js';

export const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

export default async function telegramWebhookRoutes(app, opts = {}) {
  const telegram = app.config.telegram || {};
  const bot = botEnabled(telegram)
    ? createTelegramBot({
      db: app.db,
      telegram,
      api: opts.botApi || createBotApi({ token: telegram.botToken }),
      log: app.log,
      nodeEnv: app.config.nodeEnv,
    })
    : null;
  const expected = bot ? hashToken(telegram.webhookSecret) : '';

  app.post('/telegram', async (req, reply) => {
    if (!bot) {
      return reply.code(503).send({
        error: 'Telegram bot is not configured', code: 'TELEGRAM_BOT_DISABLED', retryable: false,
      });
    }
    const header = req.headers[SECRET_HEADER];
    if (typeof header !== 'string' || !hashesEqual(hashToken(header), expected)) {
      return reply.code(401).send({ error: 'webhook secret mismatch', code: 'WEBHOOK_UNAUTHORIZED', retryable: false });
    }
    await bot.handleUpdate(header, req.body);
    return reply.code(200).send({ ok: true });
  });
}
