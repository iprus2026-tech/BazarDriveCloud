// /server/test/auth-otp-flow.test.mjs — DB-gated end-to-end HTTP round-trip for the R02 OTP
// cutover (request -> verify -> session) through the REAL Fastify app + REAL Postgres.
// server-ci's `app` job sets DATABASE_URL + runs `npm run migrate` before `npm test`, so this
// runs in CI; it is SKIPPED when DATABASE_URL is unset (hermetic local default). app.inject
// drives the pool (not one rollback-able tx), so each test uses a unique per-process phone and
// DELETEs its rows in a t.after() — leaving zero residue and staying re-runnable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

import { buildApp } from '../src/server.js';

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

  // the bearer resolves a live session (proves only the HASH was stored, yet the token works).
  const sess = await app.inject({
    method: 'GET', url: '/api/v1/auth/session',
    headers: { authorization: `Bearer ${okBody.token}` },
  });
  assert.equal(sess.statusCode, 200);
  assert.equal(sess.json().user.userId, okBody.user.userId);
  assert.equal(sess.json().user.phoneVerified, true);

  // one-time: replaying the now-consumed code fails.
  const replay = await post(app, '/api/v1/auth/otp/verify', { phone, code: reqBody.devCode });
  assert.equal(replay.statusCode, 401, 'a consumed code cannot verify again');

  // distinct identity per phone: a second full cycle for the SAME phone returns the SAME id
  // (this is what replaces the old identical hardcoded pseudo-ids).
  const code2 = (await post(app, '/api/v1/auth/otp/request', { phone })).json().devCode;
  const ok2 = await post(app, '/api/v1/auth/otp/verify', { phone, code: code2 });
  assert.equal(ok2.statusCode, 200);
  assert.equal(ok2.json().user.userId, okBody.user.userId, 'same phone => same account id');
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
