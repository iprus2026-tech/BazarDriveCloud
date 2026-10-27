#!/usr/bin/env node
// /server/scripts/ops-telegram.mjs — the owner's command for the @BazarDriveBot webhook
// (BD-TG-BOT-01 #1128).
//
//   npm run ops:telegram -- info                 getWebhookInfo: URL, pending updates, last error
//   npm run ops:telegram -- set <https base URL> setWebhook to <base>/api/v1/webhooks/telegram
//                                                with TELEGRAM_WEBHOOK_SECRET, message updates only
//   npm run ops:telegram -- delete               deleteWebhook (pending updates are kept)
//
// The owner runs it, and `set` only once the public tunnel is up. A token has exactly one update
// receiver, so run `info` first. TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET come from
// server/.env and are never printed. No database is used.
// Exit codes: 0 ok, 2 usage error, 3 configuration or Telegram error.
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.js';
import { createBotApi } from '../src/services/telegram-bot/bot-api.js';

export const WEBHOOK_PATH = '/api/v1/webhooks/telegram';
export const ALLOWED_UPDATES = Object.freeze(['message']);
export const USAGE = 'usage: npm run ops:telegram -- info | set <https://public-base-url> | delete';

// <base>/api/v1/webhooks/telegram, or null when the base is not a plain https URL.
export function webhookUrl(base) {
  let url;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}${WEBHOOK_PATH}`;
}

function describe(e) {
  const status = e?.status ? ` (HTTP ${e.status})` : '';
  const description = e?.description ? `: ${e.description}` : '';
  const cause = e?.causeCode ? ` [${e.causeCode}]` : '';
  return `ops:telegram failed: ${e?.message ?? e}${status}${description}${cause}`;
}

export async function runOpsTelegram(argv, {
  env = process.env, fetchImpl = globalThis.fetch, out = console.log, err = console.error,
} = {}) {
  const [command, arg, ...rest] = argv;
  if (!['info', 'set', 'delete'].includes(command) || rest.length > 0
      || (command === 'set') !== (arg !== undefined)) {
    err(USAGE);
    return 2;
  }
  let telegram;
  try {
    // The script needs no database; the placeholder only satisfies loadConfig's required key.
    telegram = loadConfig({ DATABASE_URL: 'postgres://unused/ops-telegram', ...env }).telegram;
  } catch (e) {
    err(e.message);
    return 3;
  }
  if (!telegram.botToken) {
    err('TELEGRAM_BOT_TOKEN is not set in server/.env');
    return 3;
  }
  const api = createBotApi({ token: telegram.botToken, fetchImpl });
  try {
    if (command === 'info') {
      const info = await api.getWebhookInfo();
      out(`url: ${info?.url || '(none)'}`);
      out(`pending updates: ${info?.pending_update_count ?? 0}`);
      out(`allowed updates: ${(info?.allowed_updates || []).join(', ') || '(all)'}`);
      if (info?.last_error_date) {
        out(`last error: ${new Date(info.last_error_date * 1000).toISOString()} ${info.last_error_message || ''}`.trim());
      }
      return 0;
    }
    if (command === 'set') {
      const url = webhookUrl(arg);
      if (!url) {
        err('the base must be an https:// URL without credentials, query or fragment');
        return 2;
      }
      if (!telegram.webhookSecret || !telegram.miniAppUrl) {
        err('TELEGRAM_WEBHOOK_SECRET and TELEGRAM_MINIAPP_URL must be set in server/.env first');
        return 3;
      }
      await api.setWebhook({
        url, secret_token: telegram.webhookSecret, allowed_updates: ALLOWED_UPDATES, drop_pending_updates: false,
      });
      out(`webhook set: ${url}`);
      out('check: npm run ops:telegram -- info');
      return 0;
    }
    await api.deleteWebhook({ drop_pending_updates: false });
    out('webhook deleted');
    return 0;
  } catch (e) {
    err(describe(e));
    return 3;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runOpsTelegram(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
