// /server/test/auth-otp-flow.test.mjs — DB-gated end-to-end HTTP round-trip for the R02 OTP
// cutover (request -> verify -> session) through the REAL Fastify app + REAL Postgres.
// server-ci's `app` job sets DATABASE_URL + runs `npm run migrate` before `npm test`, so this
// runs in CI; it is SKIPPED when DATABASE_URL is unset (hermetic local default). app.inject
// drives the pool (not one rollback-able tx), so each test uses a unique per-process phone and
// DELETEs its rows in a t.after() — leaving zero residue and staying re-runnable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import fp from 'fastify-plugin';

import { buildApp } from '../src/server.js';
import { hashToken } from '../src/services/auth/tokens.js';
import authService from '../src/services/auth/index.js';
import authPlugin from '../src/plugins/auth.js';
import errorHandler from '../src/plugins/error-handler.js';
import { loggerOptions } from '../src/infra/logger.js';

const DATABASE_URL = process.env.DATABASE_URL || '';
const SKIP = DATABASE_URL ? false : 'DATABASE_URL not set';

const baseConfig = {
  nodeEnv: 'test', isProd: false, port: 0, host: '127.0.0.1', logLevel: 'silent',
  databaseUrl: DATABASE_URL, allowedOrigin: '', sessionSecret: '',
  otp: { ttlSeconds: 300, length: 4, maxAttempts: 3, devMode: true },
  session: { ttlSeconds: 0 },
  redisUrl: '', s3: { endpoint: '', bucket: '', accessKeyId: '', secretAccessKey: '' },
};

// Delete every row this test wrote for `phone` (sessions cascade off users; otps key on phone).
async function cleanupPhone(client, phone) {
  await client.query('DELETE FROM users WHERE phone = $1', [phone]).catch(() => {});
  await client.query('DELETE FROM auth_otp WHERE phone = $1', [phone]).catch(() => {});
}

const post = (app, url, payload) => app.inject({ method: 'POST', url, payload });

const logoutUrl = '/api/v1/auth/logout';
const bearer = token => ({ authorization: `Bearer ${token}` });
const logout = (app, token) => app.inject({ method: 'POST', url: logoutUrl, headers: bearer(token) });
const readSession = (app, token) => app.inject({
  method: 'GET', url: '/api/v1/auth/session', headers: bearer(token),
});
function assertLogoutSuccess(response) {
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true });
}

// Exercise real routes/resolver/repository SQL without connecting a database.
async function logoutFixture(t, { logged = false } = {}) {
  const token = 'logout-plaintext-token-canary';
  const row = {
    id: randomUUID(), user_id: randomUUID(), active_role: null,
    phone_verified: false, token_hash: hashToken(token), revoked_at: null, expires_at: null,
  };
  const state = { lookupFails: false, writeFails: false, missing: false };
  const calls = [];
  const logs = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (/^\s*SELECT\b/.test(sql) && sql.includes('FROM auth_session')) {
      assert.deepEqual(params, [hashToken(token)]);
      assert.ok(sql.includes('revoked_at IS NULL'));
      assert.ok(sql.includes('expires_at > now()'));
      if (state.lookupFails) throw new Error('diagnostic lookup failure');
      return { rows: row.revoked_at || row.expires_at ? [] : [{ ...row }] };
    }
    assert.match(sql, /^\s*UPDATE auth_session\b/);
    assert.match(sql, /WHERE id = \$1/);
    assert.deepEqual(params, [row.id]);
    if (state.writeFails) {
      throw new Error(`SQL detail must not leak: ${token} ${row.token_hash} ${row.id} ${row.user_id}`);
    }
    if (state.missing) return { rows: [] };
    row.revoked_at ??= new Date();
    return { rows: [{ ...row }] };
  };
  let app;
  if (logged) {
    app = Fastify({
      logger: { ...loggerOptions({ logLevel: 'info' }), stream: { write: line => logs.push(line) } },
      ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
    });
    app.decorate('config', baseConfig);
    await app.register(fp(async instance => {
      instance.decorate('db', { query });
    }, { name: 'db' }));
    await app.register(errorHandler);
    await app.register(authPlugin);
    await app.register(authService, { prefix: '/api/v1/auth' });
  } else {
    app = await buildApp({ config: { ...baseConfig, databaseUrl: '' } });
    app.db.query = query;
    app.db.ready = async () => true;
  }
  t.after(() => app.close());
  await app.ready();
  return { app, row, token, state, calls, logs };
}

test('logout: live server-resolved session only, hash-only lookup, generic reply and repeat', async t => {
  const { app, token, row, calls } = await logoutFixture(t);
  assertLogoutSuccess(await logout(app, token));
  assert.ok(row.revoked_at);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.params), [[hashToken(token)], [row.id]]);
  assert.ok(!JSON.stringify(calls).includes(token));
  const firstRevokedAt = row.revoked_at;
  const session = await readSession(app, token);
  assert.equal(session.statusCode, 200);
  assert.deepEqual(session.json(), { user: null });
  assertLogoutSuccess(await logout(app, token));
  assert.equal(row.revoked_at, firstRevokedAt);
  assert.equal(calls.filter(call => /UPDATE auth_session/.test(call.sql)).length, 1);
});

test('logout: every supplied JSON body or query is rejected before auth lookup', async t => {
  const { app, token, calls } = await logoutFixture(t);
  for (const payload of [{}, { sessionId: randomUUID() }, { userId: randomUUID() }, { token }, null, [], '', false, 0]) {
    const response = await app.inject({
      method: 'POST', url: logoutUrl,
      headers: { ...bearer(token), 'content-type': 'application/json' },
      payload: JSON.stringify(payload),
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'VALIDATION');
    assert.equal(response.json().retryable, false);
    assert.equal(calls.length, 0);
  }
  for (const query of ['sessionId=foreign', 'userId=foreign', 'token=foreign', 'anything=', 'sessionId=a&sessionId=b']) {
    for (const headers of [bearer(token), { ...bearer(token), 'content-type': 'application/json' }]) {
      const response = await app.inject({ method: 'POST', url: `${logoutUrl}?${query}`, headers });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().code, 'VALIDATION');
      assert.equal(calls.length, 0);
    }
  }
});

test('logout: zero-byte JSON framing revokes a live session just like ordinary bodyless logout', async t => {
  const { app, token, row, calls } = await logoutFixture(t);
  const live = await readSession(app, token);
  assert.equal(live.statusCode, 200);
  assert.equal(live.json().user.sessionId, row.id);
  assertLogoutSuccess(await app.inject({
    method: 'POST', url: logoutUrl,
    headers: { ...bearer(token), 'content-type': 'application/json' },
  }));
  assert.ok(row.revoked_at);
  assert.deepEqual((await readSession(app, token)).json(), { user: null });
  assert.equal(calls.filter(call => /UPDATE auth_session/.test(call.sql)).length, 1);
  for (const headers of [
    { ...bearer(token), 'content-type': 'application/json; charset=utf-8', 'content-length': '0' },
    { 'content-type': 'application/json' },
  ]) {
    assertLogoutSuccess(await app.inject({ method: 'POST', url: logoutUrl, headers }));
  }
});

test('logout: non-empty malformed JSON never becomes bodyless success or performs auth I/O', async t => {
  const { app, token, calls } = await logoutFixture(t);
  for (const payload of ['{', 'null trailing', '   ', '{"__proto__":{"sessionId":"foreign"}}']) {
    const response = await app.inject({
      method: 'POST', url: logoutUrl,
      headers: { ...bearer(token), 'content-type': 'application/json' }, payload,
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'FST_ERR_CTP_INVALID_JSON_BODY');
    assert.equal(calls.length, 0);
  }
});

test('logout parser is isolated: OTP and orders retain the default JSON boundary', async t => {
  const { app, token, calls } = await logoutFixture(t);
  for (const url of ['/api/v1/auth/otp/request', '/api/v1/auth/otp/verify', '/api/v1/orders']) {
    const response = await app.inject({
      method: 'POST', url, headers: { ...bearer(token), 'content-type': 'application/json' },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'FST_ERR_CTP_EMPTY_JSON_BODY');
  }
  for (const url of ['/api/v1/auth/otp/request', '/api/v1/auth/otp/verify']) {
    for (const [payload, code] of [['{', 'FST_ERR_CTP_INVALID_JSON_BODY'], ['{}', 'VALIDATION']]) {
      const response = await app.inject({
        method: 'POST', url, headers: { 'content-type': 'application/json' }, payload,
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().code, code);
    }
    const payload = url.endsWith('/verify') ? { phone: 'invalid', code: '1234' } : { phone: 'invalid' };
    const response = await post(app, url, payload);
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'INVALID_PHONE', 'valid JSON still reaches the OTP handler');
  }
  assert.equal(calls.length, 0);
});

test('logout: absent and non-parsing Authorization stay anonymous with zero DB calls', async t => {
  const { app, calls } = await logoutFixture(t);
  for (const authorization of [undefined, 'Basic credentials', 'Bearer', 'Bearer   ', '']) {
    assertLogoutSuccess(await app.inject({
      method: 'POST', url: logoutUrl, headers: authorization === undefined ? {} : { authorization },
    }));
  }
  assert.equal(calls.length, 0);
});

test('logout: unknown bearer returns the same success with no write', async t => {
  const { app, token, calls } = await logoutFixture(t);
  app.db.query = async (sql, params) => {
    calls.push({ sql, params });
    assert.deepEqual(params, [hashToken(token)]);
    assert.match(sql, /^\s*SELECT\b/);
    return { rows: [] };
  };
  assertLogoutSuccess(await logout(app, token));
  assert.equal(calls.length, 1);
});

test('logout: expired and revoked lookup outcomes never issue a write', async t => {
  const { app, token, row, calls } = await logoutFixture(t);
  row.expires_at = new Date(0);
  assertLogoutSuccess(await logout(app, token));
  row.expires_at = null;
  row.revoked_at = new Date(0);
  assertLogoutSuccess(await logout(app, token));
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => /^\s*SELECT\b/.test(call.sql)));
});

test('logout: lookup outage stays retryable 503, including token content accepted by parser', async t => {
  const { app, token, state, calls } = await logoutFixture(t);
  state.lookupFails = true;
  const response = await logout(app, token);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), {
    error: 'session lookup failed', code: 'SESSION_LOOKUP_FAILED', retryable: true,
  });
  assert.equal(calls.length, 1);
  app.db.query = async () => { throw new Error('lookup unavailable'); };
  const malformedContent = await logout(app, 'invalid token with spaces');
  assert.equal(malformedContent.statusCode, 503);
  assert.deepEqual(malformedContent.json(), response.json());
});

test('logout: write outage stays retryable 503, no response/log secrets, retry recovers', async t => {
  const { app, token, row, state, logs } = await logoutFixture(t, { logged: true });
  state.writeFails = true;
  const response = await logout(app, token);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), {
    error: 'session revoke failed', code: 'SESSION_REVOKE_FAILED', retryable: true,
  });
  assert.equal(row.revoked_at, null);
  state.writeFails = false;
  assertLogoutSuccess(await logout(app, token));
  assert.ok(logs.some(line => line.includes('auth session revoke failed')));
  for (const secret of [token, row.token_hash, row.id, row.user_id, 'SQL detail']) {
    assert.ok(!logs.join('').includes(secret), `no ${secret} in logs`);
    assert.ok(!response.body.includes(secret));
  }
});

test('logout: row deleted after successful lookup is idempotent success', async t => {
  const { app, token, state, calls } = await logoutFixture(t);
  state.missing = true;
  assertLogoutSuccess(await logout(app, token));
  assert.equal(calls.length, 2);
});

test('logout: operational routes keep lazy auth and independent readiness', async t => {
  const { app, token, calls } = await logoutFixture(t);
  for (const [url, status] of [['/api/v1/health', 200], ['/api/v1/readyz', 200], ['/metrics', 501]]) {
    const response = await app.inject({ method: 'GET', url, headers: bearer(token) });
    assert.equal(response.statusCode, status);
  }
  assert.equal(calls.length, 0);
});

async function mintSession(app, phone) {
  const request = await post(app, '/api/v1/auth/otp/request', { phone });
  assert.equal(request.statusCode, 200);
  const verified = await post(app, '/api/v1/auth/otp/verify', { phone, code: request.json().devCode });
  assert.equal(verified.statusCode, 200);
  return verified.json();
}

test('logout Postgres: zero-byte JSON-framed request revokes its live bearer', { skip: SKIP }, async t => {
  const app = await buildApp({ config: baseConfig });
  const phone = `+1559${String(process.pid).padStart(7, '0')}4`;
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  t.after(async () => { await cleanupPhone(db, phone); await db.end(); await app.close(); });
  const actor = await mintSession(app, phone);
  const live = await readSession(app, actor.token);
  assert.equal(live.statusCode, 200);
  assert.equal(live.json().user.userId, actor.user.userId);
  const sessionId = live.json().user.sessionId;
  assertLogoutSuccess(await app.inject({
    method: 'POST', url: logoutUrl,
    headers: { ...bearer(actor.token), 'content-type': 'application/json' },
  }));
  const stored = (await db.query('SELECT revoked_at FROM auth_session WHERE id = $1', [sessionId])).rows[0];
  assert.ok(stored.revoked_at);
  const anonymous = await readSession(app, actor.token);
  assert.equal(anonymous.statusCode, 200);
  assert.deepEqual(anonymous.json(), { user: null });
});

test('logout Postgres: OTP round-trip, sibling/foreign isolation, retry and hash at rest', { skip: SKIP }, async t => {
  const app = await buildApp({ config: baseConfig });
  const phones = [0, 1].map(i => `+1559${String(process.pid).padStart(7, '0')}${i}`);
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  t.after(async () => {
    for (const phone of phones) await cleanupPhone(db, phone);
    await db.end(); await app.close();
  });
  const a = await mintSession(app, phones[0]);
  const sibling = await mintSession(app, phones[0]);
  const foreign = await mintSession(app, phones[1]);
  assert.equal(a.user.userId, sibling.user.userId);
  assert.notEqual(a.user.userId, foreign.user.userId);
  const live = await readSession(app, a.token);
  assert.equal(live.statusCode, 200);
  const sessionId = live.json().user.sessionId;
  assert.equal(live.json().user.userId, a.user.userId);
  const snapshot = () => db.query(
    'SELECT * FROM auth_session WHERE user_id = ANY($1::uuid[]) ORDER BY id',
    [[a.user.userId, foreign.user.userId]],
  );
  const before = (await snapshot()).rows;
  assert.equal(before.length, 3);
  assert.ok(before.every(row => row.revoked_at === null));
  for (const actor of [a, sibling, foreign]) {
    const stored = before.find(row => row.token_hash === hashToken(actor.token));
    assert.ok(stored, 'only token hash is persisted');
    assert.ok(!JSON.stringify(before).includes(actor.token));
  }
  assertLogoutSuccess(await logout(app, a.token));
  assert.deepEqual((await readSession(app, a.token)).json(), { user: null });
  for (const actor of [sibling, foreign]) {
    const response = await readSession(app, actor.token);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().user.userId, actor.user.userId);
  }
  const after = (await snapshot()).rows;
  const target = after.find(row => row.id === sessionId);
  assert.ok(target.revoked_at);
  for (const row of after.filter(row => row.id !== sessionId)) {
    assert.deepEqual(row, before.find(old => old.id === row.id), 'non-target row remains unchanged');
  }
  assertLogoutSuccess(await logout(app, a.token));
  assert.deepEqual((await snapshot()).rows, after, 'retry preserves first timestamp and all rows');
});

test('logout Postgres: unknown, expired and pre-revoked bearer share success without resurrection', { skip: SKIP }, async t => {
  const app = await buildApp({ config: baseConfig });
  const phone = `+1559${String(process.pid).padStart(7, '0')}2`;
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  t.after(async () => { await cleanupPhone(db, phone); await db.end(); await app.close(); });
  const expired = await mintSession(app, phone);
  const revoked = await mintSession(app, phone);
  await db.query("UPDATE auth_session SET expires_at = now() - interval '1 hour' WHERE token_hash = $1", [hashToken(expired.token)]);
  await db.query("UPDATE auth_session SET revoked_at = now() - interval '1 hour' WHERE token_hash = $1", [hashToken(revoked.token)]);
  const before = (await db.query('SELECT * FROM auth_session WHERE user_id = $1 ORDER BY id', [expired.user.userId])).rows;
  for (const token of [randomUUID(), expired.token, revoked.token]) {
    assertLogoutSuccess(await logout(app, token));
    const response = await readSession(app, token);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { user: null });
  }
  const after = (await db.query('SELECT * FROM auth_session WHERE user_id = $1 ORDER BY id', [expired.user.userId])).rows;
  assert.deepEqual(after, before, 'non-live sessions are neither rewritten nor resurrected');
});

test('logout Postgres: concurrent resolved requests preserve first revocation', { skip: SKIP }, async t => {
  const app = await buildApp({ config: baseConfig });
  const phone = `+1559${String(process.pid).padStart(7, '0')}3`;
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  t.after(async () => { await cleanupPhone(db, phone); await db.end(); await app.close(); });
  const actor = await mintSession(app, phone);
  const originalQuery = app.db.query;
  let resolveCount = 0;
  let release;
  const bothResolved = new Promise(resolve => { release = resolve; });
  const stamps = [];
  app.db.query = async (sql, params) => {
    const result = await originalQuery(sql, params);
    if (/^\s*SELECT\b/.test(sql) && sql.includes('FROM auth_session')) {
      assert.equal(result.rows.length, 1);
      resolveCount += 1;
      if (resolveCount === 2) release();
      await bothResolved;
    }
    if (/^\s*UPDATE auth_session\b/.test(sql)) stamps.push(result.rows[0].revoked_at.getTime());
    return result;
  };
  try {
    const responses = await Promise.all([logout(app, actor.token), logout(app, actor.token)]);
    responses.forEach(assertLogoutSuccess);
    assert.equal(resolveCount, 2);
    assert.equal(stamps.length, 2);
    assert.equal(stamps[0], stamps[1]);
  } finally {
    app.db.query = originalQuery;
  }
  assert.deepEqual((await readSession(app, actor.token)).json(), { user: null });
});

test('session transaction failure rolls back new passenger and OTP consumption in Postgres',
  { skip: SKIP }, async (t) => {
    const app = await buildApp({ config: baseConfig });
    const phone = '+1556' + String(process.pid).padStart(7, '0');
    const diagnostic = new pg.Client({ connectionString: DATABASE_URL });
    await diagnostic.connect();
    t.after(async () => { await cleanupPhone(diagnostic, phone); await diagnostic.end(); await app.close(); });
    const request = await post(app, '/api/v1/auth/otp/request', { phone });
    assert.equal(request.statusCode, 200);
    const originalTx = app.db.tx;
    // Inject failure AFTER the real repository statements but BEFORE real COMMIT.
    app.db.tx = fn => originalTx(async client => {
      await fn(client);
      throw new Error('test-only transaction failure');
    });
    const failed = await post(app, '/api/v1/auth/otp/verify',
      { phone, code: request.json().devCode });
    assert.equal(failed.statusCode, 500);
    const identity = await diagnostic.query('SELECT id FROM users WHERE phone = $1', [phone]);
    assert.equal(identity.rows.length, 0, 'no user or grant survives rollback');
    const otp = await diagnostic.query('SELECT consumed_at, attempts FROM auth_otp WHERE phone = $1', [phone]);
    assert.equal(otp.rows[0].consumed_at, null);
    assert.equal(otp.rows[0].attempts, 1, 'attempt counter remains outside successful-login transaction');
    app.db.tx = originalTx;
    const retry = await post(app, '/api/v1/auth/otp/verify',
      { phone, code: request.json().devCode });
    assert.equal(retry.statusCode, 200);
    assert.deepEqual(retry.json().user.roles, ['passenger']);
  });

test('OTP request -> verify -> session round-trip; one-time code; one identity per phone', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: baseConfig });
  const phone = `+1555${String(process.pid).padStart(7, '0')}`;
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  await cleanup.connect();
  t.after(async () => { await cleanupPhone(cleanup, phone); await cleanup.end(); await app.close(); });

  // request: dev-mode echoes a 4-digit code; never leaks the hash.
  const reqRes = await post(app, '/api/v1/auth/otp/request', { phone });
  assert.equal(reqRes.statusCode, 200);
  const reqBody = reqRes.json();
  assert.equal(reqBody.ok, true);
  assert.equal(reqBody.expiresInSeconds, 300);
  assert.match(reqBody.devCode, /^\d{4}$/, 'dev-mode echoes a 4-digit code');

  // wrong code: 401 OTP_INVALID, and it does NOT consume the code (we verify the right one next).
  const wrong = await post(app, '/api/v1/auth/otp/verify', { phone, code: '000000' });
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.json().code, 'OTP_INVALID');

  // correct code: 200 + opaque bearer + verified identity.
  const ok = await post(app, '/api/v1/auth/otp/verify', { phone, code: reqBody.devCode });
  assert.equal(ok.statusCode, 200);
  const okBody = ok.json();
  assert.match(okBody.token, /^[A-Za-z0-9_-]+$/, 'mints a URL-safe opaque bearer');
  assert.ok(okBody.user.userId, 'returns a distinct identity id');
  assert.equal(okBody.user.phoneVerified, true);
  assert.deepEqual(okBody.user.roles, ['passenger']);
  assert.equal(okBody.user.activeRole, 'passenger');

  // the bearer resolves a live session (proves only the HASH was stored, yet the token works).
  const sess = await app.inject({
    method: 'GET', url: '/api/v1/auth/session',
    headers: { authorization: `Bearer ${okBody.token}` },
  });
  assert.equal(sess.statusCode, 200);
  assert.equal(sess.json().user.userId, okBody.user.userId);
  assert.equal(sess.json().user.phoneVerified, true);
  assert.equal(sess.json().user.activeRole, 'passenger');

  // one-time: replaying the now-consumed code fails.
  const replay = await post(app, '/api/v1/auth/otp/verify', { phone, code: reqBody.devCode });
  assert.equal(replay.statusCode, 401, 'a consumed code cannot verify again');

  // distinct identity per phone: a second full cycle for the SAME phone returns the SAME id
  // (this is what replaces the old identical hardcoded pseudo-ids).
  const code2 = (await post(app, '/api/v1/auth/otp/request', { phone })).json().devCode;
  const ok2 = await post(app, '/api/v1/auth/otp/verify', { phone, code: code2 });
  assert.equal(ok2.statusCode, 200);
  assert.equal(ok2.json().user.userId, okBody.user.userId, 'same phone => same account id');
  assert.deepEqual(ok2.json().user.roles, ['passenger'], 'repeat login cannot duplicate grant');
  assert.notEqual(ok2.json().token, okBody.token, 'each verify mints a fresh token');
});

test('OTP verify locks after maxAttempts wrong codes (even a correct code is then refused)', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: { ...baseConfig, otp: { ...baseConfig.otp, maxAttempts: 2 } } });
  const phone = `+1556${String(process.pid).padStart(7, '0')}`;
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  await cleanup.connect();
  t.after(async () => { await cleanupPhone(cleanup, phone); await cleanup.end(); await app.close(); });

  const code = (await post(app, '/api/v1/auth/otp/request', { phone })).json().devCode;
  // maxAttempts=2: two wrong tries bump attempts 0->1->2, both 401.
  for (let i = 0; i < 2; i += 1) {
    const r = await post(app, '/api/v1/auth/otp/verify', { phone, code: '000000' });
    assert.equal(r.statusCode, 401, `wrong try ${i} => 401`);
  }
  // now attempts == cap: the CORRECT code is locked out (429), proving the cap blocks brute force.
  const locked = await post(app, '/api/v1/auth/otp/verify', { phone, code });
  assert.equal(locked.statusCode, 429);
  assert.equal(locked.json().code, 'OTP_LOCKED');
});

test('concurrent wrong-code verifies never exceed maxAttempts compares (atomic cap, no TOCTOU)', { skip: SKIP }, async (t) => {
  // Regression guard for the attempt-cap TOCTOU: the cap is counted atomically (one UPDATE ...
  // attempts + 1 RETURNING) BEFORE the compare, so a concurrent burst can't all read a stale
  // pre-increment count and slip past. Fire BURST simultaneous wrong-code verifies for one
  // phone and assert EXACTLY maxAttempts of them reach the compare (401) and the rest are locked
  // (429) — i.e. the number of guesses is bounded by the cap regardless of concurrency.
  const maxAttempts = 3;
  const BURST = 8; // >> maxAttempts, and < pool max (10) so all run truly concurrently
  const app = await buildApp({ config: { ...baseConfig, otp: { ...baseConfig.otp, maxAttempts } } });
  const phone = `+1557${String(process.pid).padStart(7, '0')}`;
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  await cleanup.connect();
  t.after(async () => { await cleanupPhone(cleanup, phone); await cleanup.end(); await app.close(); });

  await post(app, '/api/v1/auth/otp/request', { phone }); // mint a live code (attempts=0)

  const results = await Promise.all(
    Array.from({ length: BURST }, () => post(app, '/api/v1/auth/otp/verify', { phone, code: '000000' })),
  );
  const codes = results.map((r) => r.statusCode);
  const allowed = codes.filter((c) => c === 401).length; // reached the compare (wrong => 401)
  const lockedOut = codes.filter((c) => c === 429).length; // cap rejected before the compare

  assert.ok(codes.every((c) => c === 401 || c === 429), `every response is 401/429, got ${codes}`);
  assert.equal(allowed, maxAttempts, `exactly maxAttempts compares under a ${BURST}-way burst`);
  assert.equal(lockedOut, BURST - maxAttempts, 'the rest are locked out (429)');
  // every attempt counted atomically (no lost updates), so the column equals the burst size.
  const { rows } = await cleanup.query('SELECT attempts FROM auth_otp WHERE phone = $1', [phone]);
  assert.equal(rows[0].attempts, BURST, 'all burst attempts counted (atomic +1, no lost update)');
});

test('dev-mode OFF: /otp/request succeeds but NEVER echoes the code (prod no-leak guard)', { skip: SKIP }, async (t) => {
  // Pins R02's most security-critical invariant: the plaintext code is echoed ONLY in dev-mode.
  // A regression that unconditionally set out.devCode would leak codes in prod — this catches it.
  const app = await buildApp({ config: { ...baseConfig, otp: { ...baseConfig.otp, devMode: false } } });
  const phone = `+1558${String(process.pid).padStart(7, '0')}`;
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  await cleanup.connect();
  t.after(async () => { await cleanupPhone(cleanup, phone); await cleanup.end(); await app.close(); });

  const res = await post(app, '/api/v1/auth/otp/request', { phone });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.expiresInSeconds, 300);
  assert.equal(body.devCode, undefined, 'plaintext code is NEVER echoed when devMode is off');
  // a code WAS minted server-side (just not returned) — proves request still works, silently.
  const { rows } = await cleanup.query('SELECT count(*)::int AS n FROM auth_otp WHERE phone = $1', [phone]);
  assert.equal(rows[0].n, 1, 'a hashed code was stored even though none was echoed');
});
