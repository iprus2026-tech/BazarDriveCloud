// /server/src/domain/telegram-init-data.js — BD-AUTH-TELEGRAM-01 M4 (#1127, ADR BD-DOCS-052).
// Verifies Telegram Mini App initData: the HMAC signature with the bot token, the auth_date window
// and the `user` field. Pure: no I/O, no logging, and nothing here ever returns or throws the raw
// initData or the token (R10).
//
// Signature (Telegram «Validating data received via the Mini App»):
//   data_check_string = every field except `hash`, sorted by key, as `key=value`, joined by "\n";
//   secret            = HMAC_SHA256(key = "WebAppData", message = bot_token);
//   expected          = hex(HMAC_SHA256(key = secret, message = data_check_string)).
// `expected` is compared with `hash` in constant time. A duplicate key makes the string invalid,
// so two readers of the same initData can never disagree on a value.
import crypto from 'node:crypto';

const HASH_RE = /^[0-9a-f]{64}$/;
// R6 — tolerated clock skew for an auth_date in the future.
export const FUTURE_SKEW_SECONDS = 60;

function parse(initData) {
  const fields = new Map();
  for (const [key, value] of new URLSearchParams(initData)) {
    if (fields.has(key)) return null;
    fields.set(key, value);
  }
  return fields;
}

export function secretKey(botToken) {
  return crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
}

export function signInitData(fields, botToken) {
  const dataCheckString = [...fields.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  return crypto.createHmac('sha256', secretKey(botToken)).update(dataCheckString).digest('hex');
}

// -> { ok: true, telegramUserId, firstName, authDate, hash }
//  | { ok: false, code: 'TELEGRAM_INVALID' | 'TELEGRAM_EXPIRED' | 'TELEGRAM_NO_USER', telegramUserId? }
// `nowSeconds` is the server clock in epoch seconds; `maxAgeSeconds` is the R6 window.
export function verifyInitData(initData, { botToken, nowSeconds, maxAgeSeconds }) {
  if (typeof initData !== 'string' || !initData || !botToken) return { ok: false, code: 'TELEGRAM_INVALID' };
  const fields = parse(initData);
  const hash = fields?.get('hash');
  if (!fields || !hash || !HASH_RE.test(hash)) return { ok: false, code: 'TELEGRAM_INVALID' };
  const expected = Buffer.from(signInitData(fields, botToken), 'hex');
  if (!crypto.timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return { ok: false, code: 'TELEGRAM_INVALID' };

  // From here on the fields are Telegram's own.
  const authDate = Number(fields.get('auth_date'));
  if (!Number.isInteger(authDate) || authDate <= 0) return { ok: false, code: 'TELEGRAM_INVALID' };
  if (authDate > nowSeconds + FUTURE_SKEW_SECONDS) return { ok: false, code: 'TELEGRAM_INVALID' };

  let user = null;
  try { user = JSON.parse(fields.get('user') ?? 'null'); } catch { user = null; }
  const telegramUserId = Number.isSafeInteger(user?.id) && user.id > 0 ? user.id : null;
  if (nowSeconds - authDate > maxAgeSeconds) return { ok: false, code: 'TELEGRAM_EXPIRED', telegramUserId };
  if (telegramUserId === null) return { ok: false, code: 'TELEGRAM_NO_USER' };

  const firstName = typeof user.first_name === 'string' ? user.first_name.trim().slice(0, 64) : '';
  return { ok: true, telegramUserId, firstName, authDate, hash };
}
