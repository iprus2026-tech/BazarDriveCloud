// /server/test/auth-telegram.test.mjs — BD-AUTH-TELEGRAM-01 M4 (#1127, ADR BD-DOCS-052): sign-in
// with Telegram Mini App initData and the bot's contact intake, through the REAL Fastify app and
// REAL Postgres. A fake bot token; initData is signed by the test. No network, no real bot.
//
// Each test uses its own per-process Telegram ids, phones and source addresses (app.inject
// remoteAddress), since other test files share the CI database. Rows are deleted in t.after().
// DB-gated tests are SKIPPED when DATABASE_URL is unset; server-ci runs them after `npm run migrate`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';

import { buildApp } from '../src/server.js';
import dbPlugin from '../src/infra/db.js';
import errorHandler from '../src/plugins/error-handler.js';
import authPlugin from '../src/plugins/auth.js';
import authService from '../src/services/auth/index.js';
import { loggerOptions } from '../src/infra/logger.js';
import {
  linkTelegramContact, CONSENT_VERSION, CONFLICT_TEXT, IP_ATTEMPTS_PER_HOUR, ID_ATTEMPTS_PER_HOUR,
} from '../src/services/auth/telegram.js';
import { signedInitData, FAKE_BOT_TOKEN, OTHER_BOT_TOKEN } from './telegram-fixtures.mjs';

const DATABASE_URL = process.env.DATABASE_URL || '';
const SKIP = DATABASE_URL ? false : 'DATABASE_URL not set';

const TELEGRAM = { botToken: FAKE_BOT_TOKEN, initDataMaxAgeSeconds: 600, sessionTtlSeconds: 604800 };
const baseConfig = {
  nodeEnv: 'test', isProd: false, port: 0, host: '127.0.0.1', logLevel: 'silent',
  databaseUrl: DATABASE_URL, allowedOrigin: '', sessionSecret: '',
  otp: { ttlSeconds: 300, length: 6, maxAttempts: 5, devMode: true },
  session: { ttlSeconds: 0 },
  telegram: TELEGRAM,
  redisUrl: '', s3: { endpoint: '', bucket: '', accessKeyId: '', secretAccessKey: '' },
};

const run = randomUUID().slice(0, 4);
const tag = String(process.pid).padStart(7, '0');
let seq = 0;
// Telegram ids unique to this process and run (well inside Number.MAX_SAFE_INTEGER).
const tgBase = 5_000_000_000 + (process.pid % 100_000) * 10_000 + Number.parseInt(run, 16) % 1000 * 10;
const nextTgId = () => tgBase + (seq += 1);
const phone = (i) => `+183${tag}${String(seq).padStart(2, '0')}${i}`;
const address = (i = 0) => `2001:db8:${process.pid.toString(16)}:${run}::${(seq * 16) + i + 1}`;

const initDataFor = (telegramUserId, extra = {}) => signedInitData({
  auth_date: String(Math.floor(Date.now() / 1000) - 5),
  query_id: `AAE${randomUUID().slice(0, 8)}`,
  user: JSON.stringify({ id: telegramUserId, first_name: 'Телеграм', username: 'tg_user' }),
  ...extra,
});
const signIn = (app, initData, { from = address(), bearer } = {}) => app.inject({
  method: 'POST', url: '/api/v1/auth/telegram', payload: { initData }, remoteAddress: from,
  headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
});
const contact = (telegramUserId, phoneNumber, overrides = {}) => ({
  fromId: telegramUserId, chatType: 'private',
  contact: { user_id: telegramUserId, phone_number: phoneNumber.replace('+', '') }, ...overrides,
});

async function fixture(t, { config = baseConfig, logs = null } = {}) {
  let app;
  if (logs) {
    app = Fastify({
      logger: { ...loggerOptions({ logLevel: 'info' }), stream: { write: (line) => logs.push(line) } },
      ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
    });
    app.decorate('config', config);
    await app.register(dbPlugin, { databaseUrl: DATABASE_URL });
    await app.register(errorHandler);
    await app.register(authPlugin);
    await app.register(authService, { prefix: '/api/v1/auth' });
  } else {
    app = await buildApp({ config });
  }
  await app.ready();
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const ids = new Set();
  const phones = new Set();
  t.after(async () => {
    for (const id of ids) {
      await db.query('DELETE FROM telegram_identities WHERE telegram_user_id = $1', [id]).catch(() => {});
      await db.query('DELETE FROM auth_telegram_attempts WHERE telegram_user_id = $1', [id]).catch(() => {});
    }
    for (const p of phones) {
      await db.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await db.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await db.query('DELETE FROM auth_telegram_attempts WHERE ip LIKE $1', [`2001:db8:${process.pid.toString(16)}:${run}::%`]).catch(() => {});
    await db.end();
    await app.close();
  });
  const track = { id: (id) => { ids.add(id); return id; }, phone: (p) => { phones.add(p); return p; } };
  return { app, db, track };
}

const otpSignIn = async (app, p, bearer) => {
  const { devCode } = (await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone: p } })).json();
  const res = await app.inject({
    method: 'POST', url: '/api/v1/auth/otp/verify', payload: { phone: p, code: devCode },
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
};
const sessionRow = async (db, token) => (await db.query(
  `SELECT s.auth_method, s.expires_at, s.revoked_at, s.user_id FROM auth_session s
    WHERE s.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`, [token],
)).rows[0];
const currentUser = async (app, token) => (await app.inject({
  method: 'GET', url: '/api/v1/auth/session', headers: { authorization: `Bearer ${token}` },
})).json().user;

test('migration 0015: idempotent, ASCII, one transaction', () => {
  const sql = fs.readFileSync(new URL('../migrations/0015_auth_telegram.sql', import.meta.url), 'utf8');
  assert.match(sql, /^BEGIN;$/m);
  assert.match(sql, /^COMMIT;$/m);
  assert.equal(/[^\x00-\x7F]/.test(sql), false, 'ASCII only');
  for (const stmt of sql.match(/^(CREATE TABLE|CREATE (UNIQUE )?INDEX|ALTER TABLE \S+ ADD COLUMN)[^\n]*/gm)) {
    assert.match(stmt, /IF NOT EXISTS/, stmt);
  }
});

test('telegram: no bot token -> 503 TELEGRAM_DISABLED; the body schema is strict', { skip: SKIP }, async (t) => {
  const { app: off } = await fixture(t, { config: { ...baseConfig, telegram: { ...TELEGRAM, botToken: '' } } });
  const res = await signIn(off, initDataFor(nextTgId()));
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().code, 'TELEGRAM_DISABLED');

  const { app } = await fixture(t);
  for (const payload of [{}, { initData: '' }, { initData: 'x'.repeat(4097) }, { initData: 'a=b', extra: 1 }, { initData: 5 }]) {
    const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/telegram', payload, remoteAddress: address() });
    assert.equal(bad.statusCode, 400, JSON.stringify(payload).slice(0, 40));
  }
});

test('telegram: no linked identity -> 403 PHONE_REQUIRED, no account; the initData is then spent (409)', { skip: SKIP }, async (t) => {
  const { app, db, track } = await fixture(t);
  const id = track.id(nextTgId());
  const initData = initDataFor(id);
  const first = await signIn(app, initData);
  assert.equal(first.statusCode, 403, first.body);
  assert.equal(first.json().code, 'PHONE_REQUIRED');
  assert.equal((await db.query('SELECT 1 FROM telegram_identities WHERE telegram_user_id = $1', [id])).rowCount, 0);
  const again = await signIn(app, initData);
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().code, 'TELEGRAM_REPLAYED');
  const outcomes = (await db.query(
    'SELECT outcome, init_data_hash IS NOT NULL AS consumed FROM auth_telegram_attempts WHERE telegram_user_id = $1 ORDER BY created_at', [id],
  )).rows;
  assert.deepEqual(outcomes, [{ outcome: 'phone_required', consumed: true }, { outcome: 'replayed', consumed: false }]);
  const stored = JSON.stringify((await db.query('SELECT * FROM auth_telegram_attempts WHERE telegram_user_id = $1', [id])).rows);
  assert.equal(stored.includes('query_id'), false, 'the raw initData is never stored');
});

test('telegram: invalid, foreign-bot, expired and user-less initData are refused and counted', { skip: SKIP }, async (t) => {
  const { app, db, track } = await fixture(t);
  const id = track.id(nextTgId());
  const from = address(3);
  const tampered = new URLSearchParams(initDataFor(id));
  tampered.set('auth_date', String(Math.floor(Date.now() / 1000)));
  const cases = [
    [tampered.toString(), 401, 'TELEGRAM_INVALID'],
    [signedInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id }) },
      OTHER_BOT_TOKEN), 401, 'TELEGRAM_INVALID'],
    [initDataFor(id, { auth_date: String(Math.floor(Date.now() / 1000) - 601) }), 401, 'TELEGRAM_EXPIRED'],
    [initDataFor(id, { auth_date: String(Math.floor(Date.now() / 1000) + 120) }), 401, 'TELEGRAM_INVALID'],
    [signedInitData({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAE' }), 400, 'TELEGRAM_NO_USER'],
  ];
  for (const [initData, status, code] of cases) {
    const res = await signIn(app, initData, { from });
    assert.equal(res.statusCode, status, `${code}: ${res.body}`);
    assert.equal(res.json().code, code);
  }
  const rows = (await db.query(
    'SELECT outcome, telegram_user_id FROM auth_telegram_attempts WHERE ip = $1 ORDER BY created_at', [from],
  )).rows;
  assert.deepEqual(rows.map((r) => r.outcome), ['invalid', 'invalid', 'expired', 'invalid', 'no_user']);
  assert.deepEqual(rows.map((r) => r.telegram_user_id === null), [true, true, false, true, true],
    'an untrusted signature never records a Telegram id');
});

test('telegram: a contact links a NEW account; sign-in then mints a 7-day telegram session', { skip: SKIP }, async (t) => {
  const { app, db, track } = await fixture(t);
  const id = track.id(nextTgId());
  const p = track.phone(phone(1));
  const linked = await linkTelegramContact(app.db, contact(id, p));
  assert.equal(linked.ok, true);
  assert.equal(linked.linked, true);
  const identity = (await db.query('SELECT * FROM telegram_identities WHERE telegram_user_id = $1', [id])).rows[0];
  assert.equal(identity.consent_version, CONSENT_VERSION);
  assert.ok(identity.consented_at instanceof Date);
  const user = (await db.query('SELECT phone, phone_verified, roles, active_role FROM users WHERE id = $1', [linked.userId])).rows[0];
  assert.deepEqual(user, { phone: p, phone_verified: true, roles: ['passenger'], active_role: 'passenger' });
  // The same contact again is idempotent.
  assert.deepEqual(await linkTelegramContact(app.db, contact(id, p)), { ok: true, userId: linked.userId, linked: false });

  const res = await signIn(app, initDataFor(id));
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.deepEqual(body.user, { userId: linked.userId, activeRole: 'passenger', phoneVerified: true, roles: ['passenger'] });
  const row = await sessionRow(db, body.token);
  assert.equal(row.auth_method, 'telegram');
  const ttlMs = row.expires_at.getTime() - Date.now();
  assert.ok(ttlMs > 604800_000 - 60_000 && ttlMs <= 604800_000, `7-day TTL, got ${ttlMs}`);
  assert.equal((await currentUser(app, body.token)).userId, linked.userId);
  assert.equal((await db.query('SELECT first_name FROM users WHERE id = $1', [linked.userId])).rows[0].first_name, 'Телеграм');
});

test('telegram: a contact links an EXISTING OTP account by phone; its name is kept', { skip: SKIP }, async (t) => {
  const { app, db, track } = await fixture(t);
  const id = track.id(nextTgId());
  const p = track.phone(phone(2));
  const otp = await otpSignIn(app, p);
  await db.query("UPDATE users SET first_name = 'Руслан' WHERE id = $1", [otp.user.userId]);
  const linked = await linkTelegramContact(app.db, contact(id, `+${p.slice(1)}`));
  assert.deepEqual(linked, { ok: true, userId: otp.user.userId, linked: true });
  const res = await signIn(app, initDataFor(id));
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().user.userId, otp.user.userId);
  assert.equal((await db.query('SELECT first_name FROM users WHERE id = $1', [otp.user.userId])).rows[0].first_name, 'Руслан');
});

test('telegram: contact refusals store nothing', { skip: SKIP }, async (t) => {
  const { app, db, track } = await fixture(t);
  const id = track.id(nextTgId());
  const p = track.phone(phone(3));
  const refusals = [
    [contact(id, p, { chatType: 'group' }), 'NOT_PRIVATE'],
    [contact(id, p, { fromId: '123' }), 'INVALID_SENDER'],
    [contact(id, p, { contact: { user_id: id + 1, phone_number: p } }), 'FOREIGN_CONTACT'],
    [contact(id, p, { contact: { phone_number: p } }), 'FOREIGN_CONTACT'],
    [contact(id, '12'), 'INVALID_PHONE'],
  ];
  for (const [input, code] of refusals) {
    assert.deepEqual(await linkTelegramContact(app.db, input), { ok: false, code });
  }
  assert.equal((await db.query('SELECT 1 FROM telegram_identities WHERE telegram_user_id = $1', [id])).rowCount, 0);
  assert.equal((await db.query('SELECT 1 FROM users WHERE phone = $1', [p])).rowCount, 0);
});

test('telegram: after PHONE_REQUIRED and linking, the same initData is spent; a new launch signs in', { skip: SKIP }, async (t) => {
  const { app, track } = await fixture(t);
  const id = track.id(nextTgId());
  const p = track.phone(phone(9));
  const first = initDataFor(id);
  assert.equal((await signIn(app, first)).json().code, 'PHONE_REQUIRED');
  assert.equal((await linkTelegramContact(app.db, contact(id, p))).ok, true);
  const again = await signIn(app, first);
  assert.equal(again.statusCode, 409, 'the replay record from the PHONE_REQUIRED attempt stays');
  assert.equal(again.json().code, 'TELEGRAM_REPLAYED');
  const relaunch = await signIn(app, initDataFor(id));
  assert.equal(relaunch.statusCode, 200, relaunch.body);
});

test('telegram: conflicts change nothing and log only ids and the type', { skip: SKIP }, async (t) => {
  const { app, db, track } = await fixture(t);
  const a = track.id(nextTgId());
  const b = track.id(nextTgId());
  const p = track.phone(phone(4));
  const p2 = track.phone(phone(5));
  const logged = [];
  const log = { warn: (obj, msg) => logged.push(JSON.stringify({ obj, msg })) };
  const linked = await linkTelegramContact(app.db, contact(a, p));
  assert.equal(linked.ok, true);
  // A state the OTP resolver would change (verify the phone, grant passenger): it must survive a
  // conflict, proving the conflicts are checked before any account write (ADR R4 step 1).
  await db.query("UPDATE users SET phone_verified = FALSE, roles = ARRAY['driver'], active_role = 'driver' WHERE id = $1", [linked.userId]);
  const accountState = async () => (await db.query(
    'SELECT phone_verified, roles, active_role, updated_at FROM users WHERE id = $1', [linked.userId])).rows[0];
  const before = await accountState();

  // (a) The number's account is already linked to another Telegram id.
  assert.deepEqual(await linkTelegramContact(app.db, { ...contact(b, p), log }),
    { ok: false, code: 'TELEGRAM_CONFLICT', conflict: 'phone_linked_elsewhere' });
  assert.deepEqual(await accountState(), before, 'a conflict writes nothing to the account');
  // (b) A linked Telegram id shares a different number.
  assert.deepEqual(await linkTelegramContact(app.db, { ...contact(a, p2), log }),
    { ok: false, code: 'TELEGRAM_CONFLICT', conflict: 'phone_changed' });

  assert.equal((await db.query('SELECT 1 FROM telegram_identities WHERE telegram_user_id = $1', [b])).rowCount, 0);
  assert.equal((await db.query('SELECT 1 FROM users WHERE phone = $1', [p2])).rowCount, 0, 'no account for the new number');
  assert.equal((await db.query('SELECT user_id FROM telegram_identities WHERE telegram_user_id = $1', [a])).rows[0].user_id, linked.userId);
  assert.equal(logged.length, 2);
  for (const line of logged) {
    const { obj } = JSON.parse(line);
    assert.deepEqual(Object.keys(obj).sort(), ['conflict', 'telegramUserId', 'userId']);
    assert.equal(line.includes(p.slice(1)) || line.includes(p2.slice(1)), false, 'no phone in the log');
  }
  assert.equal(CONFLICT_TEXT, 'Этот номер уже связан с другим Telegram. Напишите в поддержку.');
});

test('telegram: a revoked identity cannot sign in or relink', { skip: SKIP }, async (t) => {
  const { app, db, track } = await fixture(t);
  const id = track.id(nextTgId());
  const p = track.phone(phone(6));
  assert.equal((await linkTelegramContact(app.db, contact(id, p))).ok, true);
  await db.query('UPDATE telegram_identities SET revoked_at = now() WHERE telegram_user_id = $1', [id]);
  const res = await signIn(app, initDataFor(id));
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().code, 'TELEGRAM_REVOKED');
  assert.deepEqual(await linkTelegramContact(app.db, contact(id, p)), { ok: false, code: 'TELEGRAM_REVOKED' });
  // The link itself is immutable.
  await assert.rejects(db.query('UPDATE telegram_identities SET user_id = gen_random_uuid() WHERE telegram_user_id = $1', [id]));
});

test('telegram: replacement is same-account AND same-method (R7)', { skip: SKIP }, async (t) => {
  const { app, db, track } = await fixture(t);
  const id = track.id(nextTgId());
  const p = track.phone(phone(7));
  const otp = await otpSignIn(app, p);
  assert.equal((await linkTelegramContact(app.db, contact(id, p))).ok, true);

  // A Telegram sign-in presenting the browser's OTP bearer leaves it live.
  const tg1 = (await signIn(app, initDataFor(id), { bearer: otp.token })).json();
  assert.equal((await sessionRow(db, otp.token)).revoked_at, null, 'the OTP session survives');
  // A second Telegram sign-in presenting the first Telegram bearer replaces it.
  const tg2 = (await signIn(app, initDataFor(id), { bearer: tg1.token })).json();
  assert.ok((await sessionRow(db, tg1.token)).revoked_at, 'the old Telegram session is revoked');
  assert.equal((await sessionRow(db, tg2.token)).revoked_at, null);
  // An OTP sign-in presenting the Telegram bearer leaves it live; an OTP bearer is replaced.
  const otp2 = await otpSignIn(app, p, tg2.token);
  assert.equal((await sessionRow(db, tg2.token)).revoked_at, null, 'the Telegram session survives OTP');
  assert.equal((await sessionRow(db, otp2.token)).auth_method, 'otp');
  await otpSignIn(app, p, otp2.token);
  assert.ok((await sessionRow(db, otp2.token)).revoked_at, 'OTP still replaces OTP');
});

test('telegram: the per-IP limit counts every attempt; a refusal does not extend it', { skip: SKIP }, async (t) => {
  const { app } = await fixture(t);
  const from = address(7);
  for (let i = 0; i < IP_ATTEMPTS_PER_HOUR; i += 1) {
    assert.equal((await signIn(app, 'hash=00', { from })).statusCode, 401);
  }
  for (let i = 0; i < 2; i += 1) {
    const res = await signIn(app, 'hash=00', { from });
    assert.equal(res.statusCode, 429, res.body);
    const body = res.json();
    assert.equal(body.code, 'TELEGRAM_RATE_LIMITED');
    assert.ok(body.retryAfterSeconds > 3500 && body.retryAfterSeconds <= 3600, `wait ${body.retryAfterSeconds}`);
    assert.equal(res.headers['retry-after'], String(body.retryAfterSeconds));
  }
});

test('telegram: the per-id limit counts only valid signatures', { skip: SKIP }, async (t) => {
  const { app, track } = await fixture(t);
  const id = track.id(nextTgId());
  // Forged initData naming this id: counted per IP only.
  for (let i = 0; i < ID_ATTEMPTS_PER_HOUR + 2; i += 1) {
    const forged = signedInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id }) },
      OTHER_BOT_TOKEN);
    assert.equal((await signIn(app, forged, { from: address(8) })).statusCode, 401);
  }
  for (let i = 0; i < ID_ATTEMPTS_PER_HOUR; i += 1) {
    assert.equal((await signIn(app, initDataFor(id), { from: address(9 + (i % 3)) })).statusCode, 403);
  }
  const res = await signIn(app, initDataFor(id), { from: address(12) });
  assert.equal(res.statusCode, 429, res.body);
  assert.equal(res.json().code, 'TELEGRAM_RATE_LIMITED');
});

test('telegram: attempts older than max age + 1 hour are swept', { skip: SKIP }, async (t) => {
  const { app, db, track } = await fixture(t);
  const oldId = track.id(nextTgId());
  const freshId = track.id(nextTgId());
  await db.query(
    `INSERT INTO auth_telegram_attempts (telegram_user_id, outcome, created_at)
     VALUES ($1, 'ok', now() - make_interval(secs => $3)), ($2, 'ok', now() - make_interval(secs => $4))`,
    [oldId, freshId, 600 + 3600 + 60, 600 + 3600 - 60],
  );
  await signIn(app, 'hash=00', { from: address(13) });
  assert.equal((await db.query('SELECT 1 FROM auth_telegram_attempts WHERE telegram_user_id = $1', [oldId])).rowCount, 0);
  assert.equal((await db.query('SELECT 1 FROM auth_telegram_attempts WHERE telegram_user_id = $1', [freshId])).rowCount, 1);
});

test('telegram: logs never carry the initData, the token or the phone', { skip: SKIP }, async (t) => {
  const logs = [];
  const { app, track } = await fixture(t, { logs });
  const id = track.id(nextTgId());
  const p = track.phone(phone(8));
  const conflictId = track.id(nextTgId());
  const initDatas = [initDataFor(id), initDataFor(id)];
  await signIn(app, initDatas[0]); // PHONE_REQUIRED
  await signIn(app, `${initDatas[1]}0`); // invalid
  await linkTelegramContact(app.db, { ...contact(id, p), log: app.log });
  await linkTelegramContact(app.db, { ...contact(conflictId, p), log: app.log }); // conflict
  const ok = (await signIn(app, initDatas[1])).json();
  assert.ok(ok.token);
  const text = logs.join('\n');
  assert.ok(text.includes('telegram contact conflict'), 'the conflict is logged');
  for (const secret of [FAKE_BOT_TOKEN, ok.token, p.slice(1), 'query_id', 'tg_user',
    new URLSearchParams(initDatas[1]).get('hash')]) {
    assert.equal(text.includes(secret), false, `log leaks ${secret.slice(0, 12)}…`);
  }
});
