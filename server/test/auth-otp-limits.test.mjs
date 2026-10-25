// /server/test/auth-otp-limits.test.mjs — BD-AUTH-HARDEN-01 (#824): the OTP request/verify limits
// through the REAL Fastify app + REAL Postgres, and the 0014 migration contract.
//
// The limits are counted from auth_otp rows: a resend pause and an hourly cap per phone, an hourly
// cap per source address, and an hourly cap on failed checks per phone across all of its codes.
// Each test uses its own per-process phones and its own source addresses (app.inject
// remoteAddress), because other test files hit /otp/request from 127.0.0.1 in the same CI
// database at the same time. Rows are DELETEd in t.after(). DB-gated tests are SKIPPED when
// DATABASE_URL is unset (hermetic local default); server-ci runs them after `npm run migrate`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

import { buildApp } from '../src/server.js';
import { loadConfig } from '../src/config.js';

const DATABASE_URL = process.env.DATABASE_URL || '';
const SKIP = DATABASE_URL ? false : 'DATABASE_URL not set';

const baseConfig = {
  nodeEnv: 'test', isProd: false, port: 0, host: '127.0.0.1', logLevel: 'silent',
  databaseUrl: DATABASE_URL, allowedOrigin: '', sessionSecret: '',
  otp: { ttlSeconds: 300, length: 6, maxAttempts: 5, devMode: true },
  session: { ttlSeconds: 0 },
  redisUrl: '', s3: { endpoint: '', bucket: '', accessKeyId: '', secretAccessKey: '' },
};
// Generous limits; each test tightens only the one it exercises.
const OPEN = { resendSeconds: 0, phoneRequestsPerHour: 1000, ipRequestsPerHour: 100_000, phoneFailedVerifiesPerHour: 1000 };
const withLimits = (limits, otp = {}) => ({
  ...baseConfig, otp: { ...baseConfig.otp, ...otp, limits: { ...OPEN, ...limits } },
});

const tag = String(process.pid).padStart(7, '0');
const phone = (group, i = 0) => `+182${group}${tag}${i}`;
// A source address unique to this process and run, so no other test file's requests count.
const run = randomUUID().slice(0, 4);
const address = (i = 0) => `2001:db8:${process.pid.toString(16)}:${run}::${i + 1}`;

const requestCode = (app, p, from = address()) => app.inject({
  method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone: p }, remoteAddress: from,
});
const verifyCode = (app, p, code, from = address()) => app.inject({
  method: 'POST', url: '/api/v1/auth/otp/verify', payload: { phone: p, code }, remoteAddress: from,
});

// A limit refusal: 429, not retryable, the wait in the body and in Retry-After, nothing echoed.
function assertLimited(res, code, [min, max]) {
  assert.equal(res.statusCode, 429, res.body);
  const body = res.json();
  assert.equal(body.code, code);
  assert.equal(body.retryable, false);
  assert.ok(Number.isInteger(body.retryAfterSeconds), `integer wait: ${body.retryAfterSeconds}`);
  assert.ok(body.retryAfterSeconds >= min && body.retryAfterSeconds <= max,
    `wait ${body.retryAfterSeconds} within ${min}..${max}`);
  assert.equal(res.headers['retry-after'], String(body.retryAfterSeconds));
  assert.equal(body.devCode, undefined, 'a refusal never carries a code');
}

async function withDb(t, app, phones) {
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  t.after(async () => {
    for (const p of phones) {
      await db.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await db.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await db.end();
    await app.close();
  });
  return db;
}

const otpRows = async (db, p) => (await db.query(
  'SELECT id, attempts, consumed_at, created_at FROM auth_otp WHERE phone = $1 ORDER BY created_at', [p],
)).rows;

test('migration 0014: three indexes, schema-only, re-applicable, ASCII', () => {
  const dir = new URL('../migrations/', import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual(files.filter((f) => f.startsWith('0014_')), ['0014_auth_otp_limits.sql'], 'one 0014 migration');
  const sql = fs.readFileSync(new URL('0014_auth_otp_limits.sql', dir), 'utf8');
  assert.doesNotMatch(sql, /[^\x00-\x7F]/, 'ASCII only');
  const code = sql.replace(/--[^\n]*/g, '');
  assert.match(code, /CREATE INDEX IF NOT EXISTS idx_auth_otp_ip_created\s+ON auth_otp\(requested_ip, created_at DESC\) WHERE requested_ip IS NOT NULL;/);
  assert.match(code, /CREATE INDEX IF NOT EXISTS idx_auth_otp_created\s+ON auth_otp\(created_at\);/);
  assert.match(code, /CREATE INDEX IF NOT EXISTS idx_auth_session_otp\s+ON auth_session\(otp_id\) WHERE otp_id IS NOT NULL;/);
  assert.doesNotMatch(code, /\b(UPDATE|DELETE|INSERT|DROP|ALTER)\b/i, 'no data or table change');
  assert.match(code, /^BEGIN;$/m);
  assert.match(code, /^COMMIT;$/m);
});

test('0014 indexes exist after the migrations', { skip: SKIP }, async () => {
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
         AND indexname IN ('idx_auth_otp_ip_created', 'idx_auth_otp_created', 'idx_auth_session_otp')
       ORDER BY indexname`,
    );
    assert.deepEqual(rows.map((r) => r.indexname), ['idx_auth_otp_created', 'idx_auth_otp_ip_created', 'idx_auth_session_otp']);
  } finally {
    await db.end();
  }
});

test('loadConfig defaults are enforced: a 6-digit code with codeLength, then a 60 s resend pause', { skip: SKIP }, async (t) => {
  const config = loadConfig({ DATABASE_URL, NODE_ENV: 'test', LOG_LEVEL: 'silent' });
  const app = await buildApp({ config });
  const p = phone(0);
  const db = await withDb(t, app, [p]);

  const first = await requestCode(app, p);
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().codeLength, 6);
  assert.match(first.json().devCode, /^\d{6}$/);

  assertLimited(await requestCode(app, p), 'OTP_RATE_LIMITED', [55, 60]);
  assert.equal((await otpRows(db, p)).length, 1, 'a refused request writes no code');
  // The first code still verifies: the refusal did not supersede it.
  assert.equal((await verifyCode(app, p, first.json().devCode)).statusCode, 200);
});

test('a hand-built config without otp.limits applies none (the other DB-gated tests rely on it)', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: baseConfig });
  const p = phone(1);
  await withDb(t, app, [p]);
  for (let i = 0; i < 3; i += 1) {
    const res = await requestCode(app, p);
    assert.equal(res.statusCode, 200, `request ${i}`);
    assert.equal(res.json().codeLength, 6);
  }
});

test('per phone: the hourly cap, a Retry-After from the window, and the window moving on', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: withLimits({ phoneRequestsPerHour: 3 }) });
  const p = phone(2);
  const db = await withDb(t, app, [p]);

  for (let i = 0; i < 3; i += 1) assert.equal((await requestCode(app, p, address(i))).statusCode, 200, `request ${i}`);
  // From any address: the cap is the phone's.
  assertLimited(await requestCode(app, p, address(7)), 'OTP_RATE_LIMITED', [3590, 3600]);
  assert.equal((await otpRows(db, p)).length, 3);

  // Ages 3500 s, 100 s, 50 s: the oldest of the three leaves the hour in ~100 s.
  const ids = (await otpRows(db, p)).map((r) => r.id);
  for (const [id, age] of [[ids[0], 3500], [ids[1], 100], [ids[2], 50]]) {
    await db.query('UPDATE auth_otp SET created_at = now() - make_interval(secs => $2) WHERE id = $1', [id, age]);
  }
  assertLimited(await requestCode(app, p), 'OTP_RATE_LIMITED', [95, 101]);

  // Once it is older than an hour, the phone may request again.
  await db.query('UPDATE auth_otp SET created_at = now() - make_interval(secs => 3601) WHERE id = $1', [ids[0]]);
  assert.equal((await requestCode(app, p)).statusCode, 200);
});

test('per address: the hourly cap counts every phone from that address, and only that address', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: withLimits({ ipRequestsPerHour: 2 }) });
  const phones = [phone(3, 0), phone(3, 1), phone(3, 2)];
  const db = await withDb(t, app, phones);

  assert.equal((await requestCode(app, phones[0], address(0))).statusCode, 200);
  assert.equal((await requestCode(app, phones[1], address(0))).statusCode, 200);
  assertLimited(await requestCode(app, phones[2], address(0)), 'OTP_RATE_LIMITED', [3590, 3600]);
  assert.equal((await otpRows(db, phones[2])).length, 0, 'a refused request writes no code');
  // Another address is not affected.
  assert.equal((await requestCode(app, phones[2], address(1))).statusCode, 200);
  const stored = await db.query('SELECT requested_ip FROM auth_otp WHERE phone = $1', [phones[2]]);
  assert.deepEqual(stored.rows.map((r) => r.requested_ip), [address(1)], 'the source address is recorded');
});

test('concurrent requests cannot pass the same count (per phone and per address)', { skip: SKIP }, async (t) => {
  const BURST = 8; // < pool max (10), so all run at once
  const byPhone = await buildApp({ config: withLimits({ phoneRequestsPerHour: 3 }) });
  const byAddress = await buildApp({ config: withLimits({ ipRequestsPerHour: 3 }) });
  const p = phone(4);
  const spread = Array.from({ length: BURST }, (_, i) => phone(5, i));
  const db = await withDb(t, byPhone, [p, ...spread]);
  t.after(() => byAddress.close());

  const samePhone = await Promise.all(
    Array.from({ length: BURST }, (_, i) => requestCode(byPhone, p, address(10 + i))),
  );
  assert.equal(samePhone.filter((r) => r.statusCode === 200).length, 3, 'exactly the cap is issued');
  assert.equal(samePhone.filter((r) => r.statusCode === 429).length, BURST - 3);
  assert.equal((await otpRows(db, p)).length, 3);

  const sameAddress = await Promise.all(spread.map((sp) => requestCode(byAddress, sp, address(20))));
  assert.equal(sameAddress.filter((r) => r.statusCode === 200).length, 3, 'exactly the cap is issued');
  const issued = await db.query('SELECT count(*)::int AS n FROM auth_otp WHERE requested_ip = $1', [address(20)]);
  assert.equal(issued.rows[0].n, 3);
});

test('a request that waited for the phone lock measures time after the wait, not from its transaction start', { skip: SKIP }, async (t) => {
  // Found under full-suite load: with now() (the transaction start) a request that began, then
  // waited for the lock while another writer added a code, saw "seconds since the latest code" < 0
  // and was refused even with no resend pause. Reproduced deterministically: hold the phone lock,
  // start a request (it waits), write a code meanwhile, release.
  const app = await buildApp({ config: withLimits({ resendSeconds: 0 }) });
  const p = phone(9, 5);
  const db = await withDb(t, app, [p]);
  const holder = new pg.Client({ connectionString: DATABASE_URL });
  await holder.connect();
  t.after(() => holder.end());

  const key = `auth_otp:phone:${p}`;
  // Warm the app's pool, so the request below opens its transaction at once.
  assert.equal((await requestCode(app, phone(9, 6), address(31))).statusCode, 200);
  t.after(() => db.query('DELETE FROM auth_otp WHERE phone = $1', [phone(9, 6)]).catch(() => {}));

  await holder.query('BEGIN');
  await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
  const pending = requestCode(app, p, address(30));
  // Wait until the request's transaction is blocked on THIS lock (its now() is already fixed).
  for (let i = 0; ; i += 1) {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted
          AND ((classid::bigint << 32) | objid::bigint) = hashtextextended($1, 0)`, [key],
    );
    if (rows[0].n > 0) break;
    assert.ok(i < 100, 'the request never waited for the phone lock');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await new Promise((resolve) => setTimeout(resolve, 50)); // let the clock move past its start
  await holder.query(
    `INSERT INTO auth_otp (phone, code_hash, expires_at, created_at)
       VALUES ($1, 'x', now() + interval '5 minutes', clock_timestamp())`, [p],
  );
  await holder.query('COMMIT');

  const res = await pending;
  assert.equal(res.statusCode, 200, res.body);
  const rows = await otpRows(db, p);
  assert.equal(rows.length, 2);
  // The waiter's code is the newer one, so it is the live code and verifies.
  assert.equal((await verifyCode(app, p, res.json().devCode, address(30))).statusCode, 200);
});

test('failed checks are capped per phone across codes; a new code does not reset them', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: withLimits({ phoneFailedVerifiesPerHour: 4 }, { maxAttempts: 3 }) });
  const p = phone(6);
  const db = await withDb(t, app, [p]);

  await requestCode(app, p);
  for (let i = 0; i < 3; i += 1) assert.equal((await verifyCode(app, p, '000000')).statusCode, 401, `code 1, wrong ${i}`);
  const second = (await requestCode(app, p)).json().devCode;
  assert.equal((await verifyCode(app, p, '000000')).statusCode, 401, 'code 2, wrong');
  // 4 failures in the hour: even the right code is refused now, with the wait.
  assertLimited(await verifyCode(app, p, second), 'OTP_LOCKED', [3590, 3600]);
  const rows = await otpRows(db, p);
  assert.equal(rows[1].attempts, 1, 'a refused check is not counted');
  assert.equal(rows[1].consumed_at, null);

  // Once those failures are older than an hour, the live code verifies.
  await db.query("UPDATE auth_otp SET created_at = created_at - interval '3601 seconds' WHERE phone = $1", [p]);
  assert.equal((await verifyCode(app, p, second)).statusCode, 200);
});

test('a successful check is not a failure', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: withLimits({ phoneFailedVerifiesPerHour: 2 }) });
  const p = phone(7);
  await withDb(t, app, [p]);

  for (let i = 0; i < 3; i += 1) {
    const code = (await requestCode(app, p)).json().devCode;
    assert.equal((await verifyCode(app, p, code)).statusCode, 200, `login ${i}`);
  }
  const code = (await requestCode(app, p)).json().devCode;
  assert.equal((await verifyCode(app, p, '000000')).statusCode, 401);
  assert.equal((await verifyCode(app, p, '000000')).statusCode, 401);
  assertLimited(await verifyCode(app, p, code), 'OTP_LOCKED', [3590, 3600]);
});

test('concurrent wrong checks cannot pass the same failure total', { skip: SKIP }, async (t) => {
  const BURST = 8;
  const app = await buildApp({ config: withLimits({ phoneFailedVerifiesPerHour: 3 }, { maxAttempts: 100 }) });
  const p = phone(8);
  const db = await withDb(t, app, [p]);

  await requestCode(app, p);
  const results = await Promise.all(Array.from({ length: BURST }, () => verifyCode(app, p, '000000')));
  assert.equal(results.filter((r) => r.statusCode === 401).length, 3, 'exactly the cap reaches the compare');
  assert.equal(results.filter((r) => r.statusCode === 429).length, BURST - 3);
  assert.equal((await otpRows(db, p))[0].attempts, 3);
});

test('retention: an issued code sweeps codes older than a day; their sessions keep working', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: withLimits({}) });
  const old = phone(9, 0);
  const fresh = phone(9, 1);
  const db = await withDb(t, app, [old, fresh]);

  const code = (await requestCode(app, old)).json().devCode;
  const login = (await verifyCode(app, old, code)).json();
  const sessionBefore = await db.query(
    'SELECT s.otp_id FROM auth_session s JOIN users u ON u.id = s.user_id WHERE u.phone = $1', [old],
  );
  assert.ok(sessionBefore.rows[0].otp_id, 'the session records its code');
  await db.query("UPDATE auth_otp SET created_at = now() - interval '25 hours' WHERE phone = $1", [old]);

  assert.equal((await requestCode(app, fresh)).statusCode, 200);
  assert.equal((await otpRows(db, old)).length, 0, 'the day-old code is gone');
  assert.equal((await otpRows(db, fresh)).length, 1, 'the new code stays');
  const sessionAfter = await db.query(
    'SELECT s.otp_id FROM auth_session s JOIN users u ON u.id = s.user_id WHERE u.phone = $1', [old],
  );
  assert.equal(sessionAfter.rows[0].otp_id, null, 'ON DELETE SET NULL');
  const session = await app.inject({
    method: 'GET', url: '/api/v1/auth/session', headers: { authorization: `Bearer ${login.token}` },
  });
  assert.equal(session.statusCode, 200);
  assert.equal(session.json().user.userId, login.user.userId);
});
