// /server/test/ops-telegram-cli.test.mjs — `npm run ops:telegram` (BD-TG-BOT-01 #1128): the
// owner's webhook command. A fake fetch: no network, no real bot. Neither the token nor the
// webhook secret may ever be printed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runOpsTelegram, webhookUrl, ALLOWED_UPDATES, USAGE } from '../scripts/ops-telegram.mjs';
import { FAKE_BOT_TOKEN } from './telegram-fixtures.mjs';

const SECRET = 'synthetic_webhook_secret_for_tests_0123456789';
const env = {
  TELEGRAM_BOT_TOKEN: FAKE_BOT_TOKEN,
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  TELEGRAM_MINIAPP_URL: 'https://example.test/BazarDriveCloud/',
};

function harness(result = true) {
  const calls = [];
  const lines = [];
  const fetchImpl = async (url, init) => {
    calls.push({ method: url.split('/').pop(), body: JSON.parse(init.body) });
    return { status: 200, json: async () => ({ ok: true, result }) };
  };
  const io = { out: (l) => lines.push(`out ${l}`), err: (l) => lines.push(`err ${l}`) };
  return { calls, lines, fetchImpl, io };
}
const noSecrets = (lines) => {
  const text = lines.join('\n');
  for (const s of [FAKE_BOT_TOKEN, FAKE_BOT_TOKEN.split(':')[1], SECRET]) assert.equal(text.includes(s), false);
};

test('webhookUrl: an https base, with or without a path or a trailing slash', () => {
  assert.equal(webhookUrl('https://bd.example.test'), 'https://bd.example.test/api/v1/webhooks/telegram');
  assert.equal(webhookUrl('https://bd.example.test/'), 'https://bd.example.test/api/v1/webhooks/telegram');
  assert.equal(webhookUrl('https://bd.example.test/stand//'), 'https://bd.example.test/stand/api/v1/webhooks/telegram');
  for (const bad of ['http://bd.example.test', 'https://u:p@bd.example.test', 'https://bd.example.test/?a=1',
    'https://bd.example.test/#x', 'bd.example.test', '']) {
    assert.equal(webhookUrl(bad), null, bad);
  }
});

test('ops:telegram set: the webhook URL, the secret and message updates only; nothing secret is printed', async () => {
  const h = harness();
  assert.equal(await runOpsTelegram(['set', 'https://bd.example.test'], { env, fetchImpl: h.fetchImpl, ...h.io }), 0);
  assert.deepEqual(h.calls, [{ method: 'setWebhook', body: {
    url: 'https://bd.example.test/api/v1/webhooks/telegram', secret_token: SECRET,
    allowed_updates: [...ALLOWED_UPDATES], drop_pending_updates: false,
  } }]);
  assert.deepEqual(ALLOWED_UPDATES, ['message']);
  assert.ok(h.lines.includes('out webhook set: https://bd.example.test/api/v1/webhooks/telegram'));
  noSecrets(h.lines);
});

test('ops:telegram info and delete', async () => {
  const info = harness({ url: 'https://bd.example.test/api/v1/webhooks/telegram', pending_update_count: 2,
    allowed_updates: ['message'], last_error_date: 1_700_000_000, last_error_message: 'Connection refused' });
  assert.equal(await runOpsTelegram(['info'], { env, fetchImpl: info.fetchImpl, ...info.io }), 0);
  assert.equal(info.calls[0].method, 'getWebhookInfo');
  assert.deepEqual(info.lines, [
    'out url: https://bd.example.test/api/v1/webhooks/telegram',
    'out pending updates: 2',
    'out allowed updates: message',
    'out last error: 2023-11-14T22:13:20.000Z Connection refused',
  ]);
  const del = harness();
  assert.equal(await runOpsTelegram(['delete'], { env, fetchImpl: del.fetchImpl, ...del.io }), 0);
  assert.deepEqual(del.calls, [{ method: 'deleteWebhook', body: { drop_pending_updates: false } }]);
});

test('ops:telegram: usage errors are exit 2; missing configuration and Telegram errors are exit 3', async () => {
  for (const argv of [[], ['set'], ['info', 'x'], ['delete', 'x'], ['purge'], ['set', 'http://bd.example.test']]) {
    const h = harness();
    assert.equal(await runOpsTelegram(argv, { env, fetchImpl: h.fetchImpl, ...h.io }), 2, argv.join(' '));
    assert.equal(h.calls.length, 0);
  }
  const usage = harness();
  await runOpsTelegram([], { env, fetchImpl: usage.fetchImpl, ...usage.io });
  assert.deepEqual(usage.lines, [`err ${USAGE}`]);

  for (const [over, argv] of [
    [{ TELEGRAM_BOT_TOKEN: '' }, ['info']],
    [{ TELEGRAM_WEBHOOK_SECRET: '' }, ['set', 'https://bd.example.test']],
    [{ TELEGRAM_MINIAPP_URL: '' }, ['set', 'https://bd.example.test']],
    [{ TELEGRAM_WEBHOOK_SECRET: 'short' }, ['info']],
  ]) {
    const h = harness();
    assert.equal(await runOpsTelegram(argv, { env: { ...env, ...over }, fetchImpl: h.fetchImpl, ...h.io }), 3, JSON.stringify(over));
    assert.equal(h.calls.length, 0);
    noSecrets(h.lines);
  }

  const lines = [];
  const refused = async () => ({ status: 401, json: async () => ({ ok: false, description: 'Unauthorized' }) });
  assert.equal(await runOpsTelegram(['info'], {
    env, fetchImpl: refused, out: (l) => lines.push(l), err: (l) => lines.push(l),
  }), 3);
  assert.deepEqual(lines, ['ops:telegram failed: Telegram getWebhookInfo failed (HTTP 401): Unauthorized']);
});
