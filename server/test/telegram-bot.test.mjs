// /server/test/telegram-bot.test.mjs — BD-TG-BOT-01 (#1128): the @BazarDriveBot webhook,
// POST /api/v1/webhooks/telegram, through the REAL Fastify app. A fake bot token and a fake Bot API
// that records what the bot would send: no network, no real bot.
//
// The hermetic tests point the app at an unreachable database, so any path that touched it would
// fail with a 5xx. The DB-gated tests use REAL Postgres (SKIPPED when DATABASE_URL is unset;
// server-ci runs them after `npm run migrate`) with per-process Telegram ids and phones, deleted in
// t.after(), since other test files share the CI database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

import { buildApp } from '../src/server.js';
import {
  botEnabled, createTelegramBot, createUpdateMemory, createConsentMemory,
} from '../src/services/telegram-bot/index.js';
import { createBotApi, BotApiError, BOT_API_ORIGIN } from '../src/services/telegram-bot/bot-api.js';
import * as T from '../src/services/telegram-bot/texts.js';
import { CONSENT_VERSION } from '../src/services/auth/telegram.js';
import { FAKE_BOT_TOKEN } from './telegram-fixtures.mjs';

const DATABASE_URL = process.env.DATABASE_URL || '';
const SKIP = DATABASE_URL ? false : 'DATABASE_URL not set';
const NO_DB = 'postgres://postgres@127.0.0.1:1/none';

const SECRET = 'synthetic_webhook_secret_for_tests_0123456789';
const MINIAPP = 'https://example.test/BazarDriveCloud/';
const RULES = 'https://example.test/BazarDriveCloud/#/rules';
const SUPPORT = '@bazar_help';

const telegramConfig = (over = {}) => ({
  botToken: FAKE_BOT_TOKEN, initDataMaxAgeSeconds: 600, sessionTtlSeconds: 604800,
  webhookSecret: SECRET, miniAppUrl: MINIAPP, supportContact: '', ...over,
});
const configFor = (telegram, databaseUrl) => ({
  nodeEnv: 'test', isProd: false, port: 0, host: '127.0.0.1', logLevel: 'silent',
  databaseUrl, allowedOrigin: '', sessionSecret: '',
  otp: { ttlSeconds: 300, length: 6, maxAttempts: 5, devMode: true },
  session: { ttlSeconds: 0 },
  telegram,
  redisUrl: '', s3: { endpoint: '', bucket: '', accessKeyId: '', secretAccessKey: '' },
});

// The fake Bot API: records every sendMessage; `fail` makes each call throw like Telegram's 403.
function fakeApi({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    async sendMessage(chatId, text, markup) {
      sent.push({ chatId, text, markup });
      if (fail) throw new BotApiError('sendMessage', { status: 403, description: 'Forbidden: bot was blocked by the user' });
      return {};
    },
  };
}

const run = randomUUID().slice(0, 4);
const tag = String(process.pid).padStart(7, '0');
let seq = 0;
const tgBase = 6_000_000_000 + (process.pid % 100_000) * 10_000 + Number.parseInt(run, 16) % 1000 * 10;
const nextTgId = () => tgBase + (seq += 1);
const phone = (i = 0) => `+184${tag}${String(seq).padStart(2, '0')}${i}`;
let updateSeq = (process.pid % 10_000) * 100_000;
const nextUpdateId = () => (updateSeq += 1);

const privateMessage = (tgId, fields) => ({
  update_id: nextUpdateId(),
  message: {
    message_id: 1, date: Math.floor(Date.now() / 1000),
    from: { id: tgId, is_bot: false, first_name: 'Тест' },
    chat: { id: tgId, type: 'private', first_name: 'Тест' },
    ...fields,
  },
});
const startUpdate = (tgId) => privateMessage(tgId, { text: '/start' });
const contactUpdate = (tgId, phoneNumber, userId = tgId) => privateMessage(tgId, {
  contact: { user_id: userId, phone_number: phoneNumber.replace('+', ''), first_name: 'Тест' },
});
const post = (app, update, secret = SECRET) => app.inject({
  method: 'POST', url: '/api/v1/webhooks/telegram', payload: update,
  headers: secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret },
});

async function hermetic(t, { telegram = telegramConfig(), api = fakeApi() } = {}) {
  const app = await buildApp({ config: configFor(telegram, NO_DB), telegramBotApi: api });
  await app.ready();
  t.after(() => app.close());
  return { app, api };
}

const isContactKeyboard = (markup) => markup?.keyboard?.[0]?.[0]?.request_contact === true
  && markup.keyboard[0][0].text === T.BUTTON_SHARE_PHONE;
const isRemove = (markup) => markup?.remove_keyboard === true;
const isOpenApp = (markup) => markup?.inline_keyboard?.[0]?.[0]?.web_app?.url === MINIAPP
  && markup.inline_keyboard[0][0].text === T.BUTTON_OPEN_APP;

// ── configuration and authority ────────────────────────────────────────────

test('webhook: 503 TELEGRAM_BOT_DISABLED until the token, the secret and the Mini App URL are all set', async (t) => {
  for (const over of [{ botToken: '' }, { webhookSecret: '' }, { miniAppUrl: '' }]) {
    const { app, api } = await hermetic(t, { telegram: telegramConfig(over) });
    const res = await post(app, startUpdate(nextTgId()));
    assert.equal(res.statusCode, 503, JSON.stringify(over));
    assert.equal(res.json().code, 'TELEGRAM_BOT_DISABLED');
    assert.equal(api.sent.length, 0);
  }
  assert.equal(botEnabled(telegramConfig()), true);
  assert.equal(botEnabled(undefined), false);
});

test('webhook: a forged, missing or wrong-length secret is 401 and nothing runs', async (t) => {
  const { app, api } = await hermetic(t);
  for (const secret of [null, '', 'x'.repeat(SECRET.length), `${SECRET}x`, SECRET.slice(1), SECRET.toUpperCase()]) {
    const res = await post(app, startUpdate(nextTgId()), secret);
    assert.equal(res.statusCode, 401, String(secret));
    assert.equal(res.json().code, 'WEBHOOK_UNAUTHORIZED');
  }
  assert.equal(api.sent.length, 0);
});

test('webhook: non-private chats, bots, edited messages and callbacks are 200 and get no reply', async (t) => {
  const { app, api } = await hermetic(t);
  const id = nextTgId();
  const group = startUpdate(id); group.message.chat = { id: -100123, type: 'group', title: 'g' };
  const supergroup = startUpdate(id); supergroup.message.chat = { id: -100124, type: 'supergroup', title: 'g' };
  const fromBot = startUpdate(id); fromBot.message.from.is_bot = true;
  const otherChat = startUpdate(id); otherChat.message.chat.id = id + 1;
  const edited = { update_id: nextUpdateId(), edited_message: startUpdate(id).message };
  const channel = { update_id: nextUpdateId(), channel_post: { chat: { id: -100125, type: 'channel' }, text: '/start' } };
  const callback = { update_id: nextUpdateId(), callback_query: {
    id: 'cb', from: { id, is_bot: false }, data: 'x',
    message: { message_id: 2, from: { id: 1234567890, is_bot: true }, chat: { id, type: 'private' } },
  } };
  for (const update of [group, supergroup, fromBot, otherChat, edited, channel, callback, {}, []]) {
    const res = await post(app, update);
    assert.equal(res.statusCode, 200, JSON.stringify(update).slice(0, 80));
  }
  assert.equal(api.sent.length, 0);
});

// ── hermetic replies (no database is touched on these paths) ────────────────

test('webhook: any other private message gets «Чтобы войти, отправьте /start.»; a replayed update is ignored', async (t) => {
  const { app, api } = await hermetic(t);
  const id = nextTgId();
  const update = privateMessage(id, { text: 'привет' });
  assert.equal((await post(app, update)).statusCode, 200);
  assert.deepEqual(api.sent, [{ chatId: id, text: T.TEXT.other, markup: undefined }]);
  // Telegram redelivers the same update_id: 200, and no second reply.
  assert.equal((await post(app, update)).statusCode, 200);
  assert.equal(api.sent.length, 1);
  // A sticker or a photo is «any other message» too.
  assert.equal((await post(app, privateMessage(id, { sticker: { file_id: 'x' } }))).statusCode, 200);
  assert.equal(api.sent.at(-1).text, T.TEXT.other);
});

test('webhook: a foreign contact is refused with the contact keyboard and stores nothing', async (t) => {
  const { app, api } = await hermetic(t);
  const id = nextTgId();
  const res = await post(app, contactUpdate(id, phone(), id + 7));
  assert.equal(res.statusCode, 200); // the unreachable database was never touched
  assert.equal(api.sent.length, 1);
  assert.equal(api.sent[0].text, T.TEXT.foreignContact);
  assert.ok(isContactKeyboard(api.sent[0].markup));
});

test('webhook: a contact before the consent text was shown gets «Нажмите /start ещё раз.», not the intake', async (t) => {
  const { app, api } = await hermetic(t);
  const id = nextTgId();
  const res = await post(app, contactUpdate(id, phone()));
  assert.equal(res.statusCode, 200); // the unreachable database was never touched
  assert.deepEqual(api.sent, [{ chatId: id, text: 'Нажмите /start ещё раз.', markup: { remove_keyboard: true } }]);
});

test('webhook: a database failure on /start is a 5xx and the same update is handled again on redelivery', async (t) => {
  const { app, api } = await hermetic(t);
  const update = startUpdate(nextTgId());
  assert.equal((await post(app, update)).statusCode, 500);
  // Not swallowed as «replayed»: the update_id was released for Telegram's retry.
  assert.equal((await post(app, update)).statusCode, 500);
  assert.equal(api.sent.length, 0);
});

test('webhook: a failed Bot API call is logged without the token, the secret or the text; the update is still 200', async () => {
  const logs = [];
  const log = { warn: (obj, msg) => logs.push(JSON.stringify(obj) + msg), error: (obj, msg) => logs.push(JSON.stringify(obj) + msg) };
  const api = fakeApi({ fail: true });
  const bot = createTelegramBot({ db: null, telegram: telegramConfig(), api, log, nodeEnv: 'test' });
  assert.equal(await bot.handleUpdate(SECRET, privateMessage(nextTgId(), { text: 'hi' })), 'handled');
  assert.equal(logs.length, 1);
  assert.match(logs[0], /telegram send failed/);
  assert.match(logs[0], /"status":403/);
  for (const secret of [FAKE_BOT_TOKEN, FAKE_BOT_TOKEN.split(':')[1], SECRET, T.TEXT.other]) {
    assert.equal(logs[0].includes(secret), false);
  }
});

test('bot: a contact intake failure answers «Не получилось сохранить номер…» and logs only the SQLSTATE', async () => {
  const logs = [];
  const log = { warn: (obj, msg) => logs.push(JSON.stringify(obj) + msg), error: (obj, msg) => logs.push(JSON.stringify(obj) + msg) };
  const failure = Object.assign(new Error('duplicate key value (phone)=(+18400000000)'), { code: '23505' });
  const db = { query: async () => ({ rows: [] }), tx: async () => { throw failure; } };
  const api = fakeApi();
  const bot = createTelegramBot({ db, telegram: telegramConfig(), api, log, nodeEnv: 'test' });
  const id = nextTgId();
  await bot.handleUpdate(SECRET, startUpdate(id)); // shows the consent text
  await bot.handleUpdate(SECRET, contactUpdate(id, phone()));
  assert.equal(api.sent.at(-1).text, T.TEXT.saveFailed);
  assert.ok(isContactKeyboard(api.sent.at(-1).markup));
  assert.equal(logs.length, 1);
  assert.match(logs[0], /"code":"23505"/);
  assert.equal(logs[0].includes('+184'), false);
});

// ── stores, texts and the Bot API client ────────────────────────────────────

test('update memory: bounded, oldest evicted, a released id can be claimed again', () => {
  const m = createUpdateMemory(3);
  for (const id of [1, 2, 3]) assert.equal(m.claim(id), true);
  assert.equal(m.claim(2), false);
  assert.equal(m.claim(4), true); // evicts 1
  assert.equal(m.claim(1), true);
  m.release(4);
  assert.equal(m.claim(4), true);
});

test('consent memory: expires after its TTL and stays bounded', () => {
  let now = 1_000;
  const m = createConsentMemory({ capacity: 2, ttlMs: 100, now: () => now });
  m.mark(1); m.mark(2);
  assert.equal(m.has(1), true);
  now += 99;
  assert.equal(m.has(2), true);
  now += 1;
  assert.equal(m.has(1), false);
  m.mark(3); m.mark(4); m.mark(5); // capacity 2: 3 is evicted
  assert.equal(m.has(3), false);
  assert.equal(m.has(5), true);
});

test('texts: the owner-approved wording, the R9 consent line with the rules link, no emoji', () => {
  const start = T.startText(MINIAPP);
  assert.ok(start.startsWith('BazarDrive — поездки и объявления для своих. Чтобы войти, подтвердите номер телефона: нажмите «Поделиться номером».'));
  assert.ok(start.includes('Отправляя номер, вы соглашаетесь на обработку Telegram ID, имени и номера телефона для работы сервиса.'));
  assert.ok(start.endsWith(`Правила: ${RULES}`));
  assert.equal(start.includes('/delete'), false); // shown only after #1154
  assert.equal(T.rulesUrl('https://example.test/app/?x=1#/feed'), 'https://example.test/app/#/rules');
  assert.equal(T.supportLine(SUPPORT), 'Напишите в поддержку: @bazar_help.');
  assert.equal(T.supportLine(''), 'Напишите тому, кто пригласил вас в BazarDrive.');
  const all = [start, ...Object.values(T.TEXT), T.supportLine(SUPPORT), T.supportLine(''), T.BUTTON_SHARE_PHONE, T.BUTTON_OPEN_APP];
  for (const text of all) assert.equal(/\p{Extended_Pictographic}/u.test(text), false, text);
});

test('Bot API client: the token is only in the request URL, never in an error', async () => {
  const calls = [];
  const ok = createBotApi({ token: FAKE_BOT_TOKEN, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return { status: 200, json: async () => ({ ok: true, result: { message_id: 5 } }) };
  } });
  assert.deepEqual(await ok.sendMessage(42, 'текст', T.removeKeyboard()), { message_id: 5 });
  assert.equal(calls[0].url, `${BOT_API_ORIGIN}/bot${FAKE_BOT_TOKEN}/sendMessage`);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    chat_id: 42, text: 'текст', link_preview_options: { is_disabled: true }, reply_markup: { remove_keyboard: true },
  });

  const refused = createBotApi({ token: FAKE_BOT_TOKEN, fetchImpl: async () => ({
    status: 400, json: async () => ({ ok: false, description: 'Bad Request: chat not found' }),
  }) });
  const down = createBotApi({ token: FAKE_BOT_TOKEN, fetchImpl: async (url) => {
    throw Object.assign(new TypeError(`fetch failed ${url}`), { cause: { code: 'ECONNREFUSED' } });
  } });
  for (const [api, expect] of [[refused, { status: 400, description: 'Bad Request: chat not found' }], [down, { causeCode: 'ECONNREFUSED' }]]) {
    const err = await api.sendMessage(1, 'x').then(() => null, (e) => e);
    assert.ok(err instanceof BotApiError);
    for (const [k, v] of Object.entries(expect)) assert.equal(err[k], v);
    const dump = `${err.message} ${err.stack} ${JSON.stringify(err)}`;
    assert.equal(dump.includes(FAKE_BOT_TOKEN.split(':')[1]), false);
  }
  assert.throws(() => createBotApi({ token: 'nope' }), TypeError);
});

// ── through the real database ───────────────────────────────────────────────

async function withDb(t, { supportContact = '' } = {}) {
  const api = fakeApi();
  const app = await buildApp({ config: configFor(telegramConfig({ supportContact }), DATABASE_URL), telegramBotApi: api });
  await app.ready();
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const ids = new Set();
  const phones = new Set();
  t.after(async () => {
    for (const id of ids) await db.query('DELETE FROM telegram_identities WHERE telegram_user_id = $1', [id]).catch(() => {});
    for (const p of phones) await db.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
    await db.end();
    await app.close();
  });
  const track = { id: (id) => { ids.add(id); return id; }, phone: (p) => { phones.add(p); return p; } };
  return { app, api, db, track };
}
const identityRow = async (db, id) => (await db.query(
  'SELECT user_id, consent_version, consented_at, revoked_at FROM telegram_identities WHERE telegram_user_id = $1', [id],
)).rows[0] ?? null;

test('DB: /start without a number sends ONE message: the consent text with the contact keyboard', { skip: SKIP }, async (t) => {
  const { app, api, track } = await withDb(t);
  const id = track.id(nextTgId());
  assert.equal((await post(app, startUpdate(id))).statusCode, 200);
  assert.equal(api.sent.length, 1);
  assert.equal(api.sent[0].chatId, id);
  assert.equal(api.sent[0].text, T.startText(MINIAPP));
  assert.ok(isContactKeyboard(api.sent[0].markup));
  assert.equal(api.sent.some((m) => isOpenApp(m.markup)), false); // no Mini App button before the number
});

test('DB: /start, then the own contact, links the number; the reply removes the keyboard, then shows the Mini App button', { skip: SKIP }, async (t) => {
  const { app, api, db, track } = await withDb(t);
  const id = track.id(nextTgId());
  const p = track.phone(phone());
  await post(app, startUpdate(id));
  api.sent.length = 0;
  assert.equal((await post(app, contactUpdate(id, p))).statusCode, 200);
  assert.deepEqual(api.sent.map((m) => m.text), [T.TEXT.linked, T.TEXT.linkedOpenApp]);
  assert.ok(isRemove(api.sent[0].markup));
  assert.ok(isOpenApp(api.sent[1].markup));
  const row = await identityRow(db, id);
  assert.equal(row.consent_version, CONSENT_VERSION);
  const user = (await db.query('SELECT id, phone_verified FROM users WHERE phone = $1', [p])).rows[0];
  assert.equal(user.id, row.user_id);
  assert.equal(user.phone_verified, true);

  // The same contact again: no new row, «Этот номер уже подтверждён.».
  api.sent.length = 0;
  await post(app, contactUpdate(id, p));
  assert.deepEqual(api.sent.map((m) => m.text), [T.TEXT.alreadyLinked, T.TEXT.openApp]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM telegram_identities WHERE user_id = $1', [user.id])).rows[0].n, 1);
});

test('DB: /start, a server restart, then the contact: «Нажмите /start ещё раз.», nothing stored; /start again links', { skip: SKIP }, async (t) => {
  const { app: before, track } = await withDb(t);
  const id = track.id(nextTgId());
  const p = track.phone(phone());
  await post(before, startUpdate(id));
  await before.close(); // the restart: the in-memory consent marks are gone

  const { app, api, db } = await withDb(t);
  const res = await post(app, contactUpdate(id, p));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(api.sent, [{ chatId: id, text: T.TEXT.startAgain, markup: { remove_keyboard: true } }]);
  assert.equal(await identityRow(db, id), null);

  await post(app, startUpdate(id));
  assert.equal(api.sent.at(-1).text, T.startText(MINIAPP));
  await post(app, contactUpdate(id, p));
  assert.deepEqual(api.sent.slice(-2).map((m) => m.text), [T.TEXT.linked, T.TEXT.linkedOpenApp]);
  assert.equal((await identityRow(db, id)).consent_version, CONSENT_VERSION);
});

test('DB: /start with a confirmed number sends remove_keyboard: true BEFORE the Mini App button', { skip: SKIP }, async (t) => {
  const { app, api, track } = await withDb(t);
  const id = track.id(nextTgId());
  await post(app, startUpdate(id));
  await post(app, contactUpdate(id, track.phone(phone())));
  api.sent.length = 0;
  assert.equal((await post(app, startUpdate(id))).statusCode, 200);
  assert.equal(api.sent.length, 2);
  assert.deepEqual(api.sent[0], { chatId: id, text: T.TEXT.confirmed, markup: { remove_keyboard: true } });
  assert.equal(api.sent[1].text, T.TEXT.openApp);
  assert.ok(isOpenApp(api.sent[1].markup));
});

test('DB: an unparseable number is refused with the contact keyboard and stores nothing', { skip: SKIP }, async (t) => {
  const { app, api, db, track } = await withDb(t);
  const id = track.id(nextTgId());
  await post(app, startUpdate(id));
  await post(app, contactUpdate(id, '12'));
  assert.equal(api.sent.at(-1).text, T.TEXT.invalidPhone);
  assert.ok(isContactKeyboard(api.sent.at(-1).markup));
  assert.equal(await identityRow(db, id), null);
});

test('DB: a number linked to another Telegram is a conflict with the support line; nothing is written', { skip: SKIP }, async (t) => {
  for (const [supportContact, line] of [[SUPPORT, 'Напишите в поддержку: @bazar_help.'], ['', 'Напишите тому, кто пригласил вас в BazarDrive.']]) {
    const { app, api, db, track } = await withDb(t, { supportContact });
    const first = track.id(nextTgId());
    const second = track.id(nextTgId());
    const p = track.phone(phone());
    await post(app, startUpdate(first));
    await post(app, contactUpdate(first, p));
    await post(app, startUpdate(second));
    api.sent.length = 0;
    await post(app, contactUpdate(second, p));
    assert.deepEqual(api.sent, [{ chatId: second, text: `${T.TEXT.conflict} ${line}`, markup: { remove_keyboard: true } }]);
    assert.equal(await identityRow(db, second), null);
  }
});

test('DB: a revoked Telegram gets the refusal with the support line on /start and on a contact', { skip: SKIP }, async (t) => {
  const { app, api, db, track } = await withDb(t, { supportContact: SUPPORT });
  const id = track.id(nextTgId());
  const p = track.phone(phone());
  await post(app, startUpdate(id));
  await post(app, contactUpdate(id, p));
  await db.query('UPDATE telegram_identities SET revoked_at = now() WHERE telegram_user_id = $1', [id]);
  const refusal = `${T.TEXT.revoked} Напишите в поддержку: @bazar_help.`;
  api.sent.length = 0;
  await post(app, startUpdate(id));
  assert.deepEqual(api.sent, [{ chatId: id, text: refusal, markup: { remove_keyboard: true } }]);
  // The consent text was shown earlier in this chat, so the contact reaches the intake: revoked.
  api.sent.length = 0;
  await post(app, contactUpdate(id, p));
  assert.deepEqual(api.sent, [{ chatId: id, text: refusal, markup: { remove_keyboard: true } }]);
});
