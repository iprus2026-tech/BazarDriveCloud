// /server/test/auth-active-role-flow.test.mjs — DB-gated acceptance for BD-AUTH-POLICY-01B-B
// (docs/driver-role-grant-contract.md §2):
//   - PUT /api/v1/auth/session/active-role switches THIS session to a current grant;
//   - GET /api/v1/auth/session carries the account's current roles;
//   - OTP verify revokes a presented live session of the SAME account in the transaction that
//     mints the new one (CWE-613), leaves another account's session alone, and fails 503 with
//     nothing minted and no OTP consumed when that revocation cannot happen.
// SKIPPED without DATABASE_URL; runs in server-ci's app job.
//
// CLEANUP: orders (cascades offers), then users (cascades auth_session and driver_enrollments).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

import { buildApp } from '../src/server.js';
import { submitDriverEnrollment, decideDriverEnrollment } from '../src/services/driver-enrollment/decisions.js';

const DATABASE_URL = process.env.DATABASE_URL || '';
const SKIP = DATABASE_URL ? false : 'DATABASE_URL not set';

const baseConfig = {
  nodeEnv: 'test', isProd: false, port: 0, host: '127.0.0.1', logLevel: 'silent',
  databaseUrl: DATABASE_URL, allowedOrigin: '', sessionSecret: '',
  otp: { ttlSeconds: 300, length: 4, maxAttempts: 5, devMode: true },
  session: { ttlSeconds: 0 },
  receipts: { commissionPercent: 12 },
  drivers: { enrollmentAutoApprove: false },
  redisUrl: '', s3: { endpoint: '', bucket: '', accessKeyId: '', secretAccessKey: '' },
};

const SWITCH = '/api/v1/auth/session/active-role';
const bearer = (token) => ({ authorization: `Bearer ${token}` });

async function fixture(t) {
  const app = await buildApp({ config: baseConfig });
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  await cleanup.connect();
  const tag = `${String(process.pid).padStart(5, '0')}${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}`;
  let n = 0;
  const phones = [];
  const orderIds = [];
  t.after(async () => {
    if (orderIds.length) await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    for (const p of phones) {
      await cleanup.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await cleanup.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });
  const phone = () => { const p = `+1641${tag}${n++}`; phones.push(p); return p; };
  const inject = (method, url, { payload, headers } = {}) => app.inject({ method, url, payload, headers });
  const requestCode = async (p) => (await inject('POST', '/api/v1/auth/otp/request', { payload: { phone: p } })).json().devCode;
  const verify = (p, code, headers) => inject('POST', '/api/v1/auth/otp/verify', { payload: { phone: p, code }, headers });
  const login = async (p, headers) => (await verify(p, await requestCode(p), headers)).json();
  const dualRole = async (p) => {
    const s = await login(p);
    await submitDriverEnrollment(app.db, { userId: s.user.userId });
    const decided = await decideDriverEnrollment(app.db, { target: { userId: s.user.userId }, decision: 'approve', decidedBy: 'test:op' });
    assert.equal(decided.code, 'APPROVED');
    return s;
  };
  const owner = await login(phone());
  const order = (await inject('POST', '/api/v1/orders', { payload: { pickup: { label: 'A' }, dropoff: { label: 'B' } }, headers: bearer(owner.token) })).json().order;
  orderIds.push(order.id);
  const offer = (token) => inject('POST', '/api/v1/matching/offers', { payload: { orderId: order.id, driverName: 'T' }, headers: bearer(token) });
  const sessionRow = async (token) => (await inject('GET', '/api/v1/auth/session', { headers: bearer(token) })).json().user;
  const db = async (sql, params) => (await cleanup.query(sql, params)).rows;
  return { app, phone, inject, requestCode, verify, login, dualRole, offer, sessionRow, db, orderIds };
}

test('active role: a dual-role account switches its session; the offer gate follows it', { skip: SKIP }, async (t) => {
  const f = await fixture(t);
  const a = await f.dualRole(f.phone());
  assert.deepEqual(await f.sessionRow(a.token), {
    userId: a.user.userId, sessionId: (await f.sessionRow(a.token)).sessionId,
    activeRole: 'passenger', phoneVerified: true, roles: ['passenger', 'driver'],
  }, 'GET /auth/session carries the current grants');
  assert.equal((await f.offer(a.token)).statusCode, 403);

  const toDriver = await f.inject('PUT', SWITCH, { payload: { activeRole: 'driver' }, headers: bearer(a.token) });
  assert.equal(toDriver.statusCode, 200);
  assert.equal(toDriver.json().user.activeRole, 'driver');
  assert.deepEqual(toDriver.json().user.roles, ['passenger', 'driver']);
  const [userRow] = await f.db('SELECT active_role FROM users WHERE id = $1', [a.user.userId]);
  assert.equal(userRow.active_role, 'driver', 'users.active_role seeds the next login');
  assert.equal((await f.sessionRow(a.token)).activeRole, 'driver');
  assert.equal((await f.offer(a.token)).statusCode, 201, 'a switched driver session can offer');

  const toPassenger = await f.inject('PUT', SWITCH, { payload: { activeRole: 'passenger' }, headers: bearer(a.token) });
  assert.equal(toPassenger.statusCode, 200);
  assert.equal((await f.offer(a.token)).statusCode, 403, 'back in passenger mode, the offer gate refuses');
  const order = await f.inject('POST', '/api/v1/orders', { payload: { pickup: { label: 'C' }, dropoff: { label: 'D' } }, headers: bearer(a.token) });
  assert.equal(order.statusCode, 201, 'the passenger session creates an order');
  f.orderIds.push(order.json().order.id);

  const relogin = await f.login((await f.db('SELECT phone FROM users WHERE id = $1', [a.user.userId]))[0].phone);
  assert.equal(relogin.user.activeRole, 'passenger', 'the next login starts in the last switched role');
});

test('active role: same role is a no-op; other sessions keep their own role', { skip: SKIP }, async (t) => {
  const f = await fixture(t);
  const p = f.phone();
  const first = await f.dualRole(p);
  const second = await f.login(p);
  const statements = [];
  const originalTx = f.app.db.tx;
  f.app.db.tx = (fn) => originalTx((client) => fn({ query: (sql, params) => { statements.push(sql); return client.query(sql, params); } }));
  try {
    const same = await f.inject('PUT', SWITCH, { payload: { activeRole: 'passenger' }, headers: bearer(first.token) });
    assert.equal(same.statusCode, 200);
    assert.equal(statements.some((sql) => /^\s*UPDATE\b/.test(sql)), false, 'the same role writes nothing');
  } finally {
    f.app.db.tx = originalTx;
  }
  assert.equal((await f.inject('PUT', SWITCH, { payload: { activeRole: 'driver' }, headers: bearer(first.token) })).statusCode, 200);
  assert.equal((await f.sessionRow(first.token)).activeRole, 'driver');
  assert.equal((await f.sessionRow(second.token)).activeRole, 'passenger', 'another session of the account is unchanged');
});

test('active role: the switch decides on the locked session row, not the request snapshot', { skip: SKIP }, async (t) => {
  const f = await fixture(t);
  const a = await f.dualRole(f.phone());
  const { sessionId } = await f.sessionRow(a.token);
  const originalTx = f.app.db.tx;
  // Run `before` after resolveUser() has taken its snapshot but before the switch transaction.
  const between = async (before, request) => {
    f.app.db.tx = async (fn) => { f.app.db.tx = originalTx; await before(); return originalTx(fn); };
    try { return await request(); } finally { f.app.db.tx = originalTx; }
  };
  const sessionRole = async () => (await f.db('SELECT active_role FROM auth_session WHERE id = $1', [sessionId]))[0].active_role;

  // A concurrent switch moved the session to driver; the snapshot still says passenger.
  const stale = await between(
    () => f.db("UPDATE auth_session SET active_role = 'driver' WHERE id = $1", [sessionId]),
    () => f.inject('PUT', SWITCH, { payload: { activeRole: 'passenger' }, headers: bearer(a.token) }),
  );
  assert.equal(stale.statusCode, 200);
  assert.equal(stale.json().user.activeRole, 'passenger');
  assert.equal(await sessionRole(), 'passenger', 'the response matches the stored session role');

  // A logout revoked the session after the snapshot: a same-role request must not succeed.
  const revoked = await between(
    () => f.db('UPDATE auth_session SET revoked_at = now() WHERE id = $1', [sessionId]),
    () => f.inject('PUT', SWITCH, { payload: { activeRole: 'passenger' }, headers: bearer(a.token) }),
  );
  assert.equal(revoked.statusCode, 401, 'a session revoked meanwhile cannot switch, even to its current role');
});

test('active role: ungranted, unverified, malformed and unauthenticated requests are refused', { skip: SKIP }, async (t) => {
  const f = await fixture(t);
  const passenger = await f.login(f.phone());
  const refused = await f.inject('PUT', SWITCH, { payload: { activeRole: 'driver' }, headers: bearer(passenger.token) });
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.json().code, 'ROLE_NOT_GRANTED');
  assert.equal((await f.sessionRow(passenger.token)).activeRole, 'passenger', 'nothing changed');
  for (const payload of [{ activeRole: 'guest' }, { activeRole: 'driver', roles: ['driver'] }, {}]) {
    const bad = await f.inject('PUT', SWITCH, { payload, headers: bearer(passenger.token) });
    assert.equal(bad.statusCode, 400, JSON.stringify(payload));
    assert.equal(bad.json().code, 'VALIDATION');
  }
  assert.equal((await f.inject('PUT', SWITCH, { payload: { activeRole: 'passenger' } })).statusCode, 401);
  await f.inject('POST', '/api/v1/auth/logout', { headers: bearer(passenger.token) });
  assert.equal((await f.inject('PUT', SWITCH, { payload: { activeRole: 'passenger' }, headers: bearer(passenger.token) })).statusCode, 401,
    'a revoked session cannot switch');

  const dual = await f.dualRole(f.phone());
  await f.db('UPDATE users SET phone_verified = FALSE WHERE id = $1', [dual.user.userId]);
  const unverified = await f.inject('PUT', SWITCH, { payload: { activeRole: 'driver' }, headers: bearer(dual.token) });
  assert.equal(unverified.statusCode, 403);
  assert.equal(unverified.json().code, 'PHONE_NOT_VERIFIED');
});

test('active role: a revoked grant blocks at once and resets the switched session', { skip: SKIP }, async (t) => {
  const f = await fixture(t);
  const a = await f.dualRole(f.phone());
  assert.equal((await f.inject('PUT', SWITCH, { payload: { activeRole: 'driver' }, headers: bearer(a.token) })).statusCode, 200);
  assert.equal((await f.offer(a.token)).statusCode, 201);
  const revoked = await decideDriverEnrollment(f.app.db, { target: { userId: a.user.userId }, decision: 'revoke', decidedBy: 'test:op' });
  assert.equal(revoked.code, 'REVOKED');
  assert.equal((await f.offer(a.token)).statusCode, 403);
  const row = await f.sessionRow(a.token);
  assert.deepEqual([row.activeRole, row.roles], ['passenger', ['passenger']]);
  assert.equal((await f.inject('PUT', SWITCH, { payload: { activeRole: 'driver' }, headers: bearer(a.token) })).json().code, 'ROLE_NOT_GRANTED');
});

test('verify: a presented same-account bearer is revoked with the new session (CWE-613)', { skip: SKIP }, async (t) => {
  const f = await fixture(t);
  const p = f.phone();
  const first = await f.login(p);
  const second = await f.login(p, bearer(first.token));
  assert.ok(second.token && second.token !== first.token);
  assert.equal(await f.sessionRow(first.token), null, 'the replaced bearer is no longer a session');
  assert.equal((await f.inject('POST', '/api/v1/drivers/enrollment', { headers: bearer(first.token) })).statusCode, 401);
  assert.equal((await f.sessionRow(second.token)).userId, first.user.userId, 'the new bearer is live');
  const sessions = await f.db(
    'SELECT revoked_at IS NOT NULL AS revoked FROM auth_session WHERE user_id = $1 ORDER BY issued_at', [first.user.userId],
  );
  assert.deepEqual(sessions.map((s) => s.revoked), [true, false]);

  // A login without a presented bearer revokes nothing (siblings stay live).
  const sibling = await f.login(p);
  assert.ok(await f.sessionRow(second.token), 'no bearer presented -> the other session stays live');
  assert.ok(await f.sessionRow(sibling.token));
});

test('verify: another account\'s bearer and dead bearers are left alone', { skip: SKIP }, async (t) => {
  const f = await fixture(t);
  const a = await f.login(f.phone());
  const b = await f.login(f.phone(), bearer(a.token));
  assert.ok(b.token);
  assert.equal((await f.sessionRow(a.token)).userId, a.user.userId, 'a different account keeps its session (B2-C, #829)');

  const p = f.phone();
  const dead = await f.login(p);
  await f.inject('POST', '/api/v1/auth/logout', { headers: bearer(dead.token) });
  const afterDead = await f.verify(p, await f.requestCode(p), bearer(dead.token));
  assert.equal(afterDead.statusCode, 200, 'a revoked presented bearer is ignored');
  const garbage = await f.verify(p, await f.requestCode(p), bearer('not-a-real-token'));
  assert.equal(garbage.statusCode, 200, 'an unknown presented bearer is ignored');
});

test('verify: a failed replacement fails the login with 503 — nothing minted, OTP not consumed', { skip: SKIP }, async (t) => {
  const f = await fixture(t);
  const p = f.phone();
  const first = await f.login(p);
  const originalTx = f.app.db.tx;
  const sessionCount = async () => (await f.db('SELECT count(*)::int AS n FROM auth_session WHERE user_id = $1', [first.user.userId]))[0].n;
  for (const failOn of [/UPDATE auth_session\s+SET revoked_at/, /FROM auth_session\s+WHERE token_hash/]) {
    const before = await sessionCount();
    const code = await f.requestCode(p);
    f.app.db.tx = (fn) => originalTx((client) => fn({
      query: (sql, params) => (failOn.test(sql) ? Promise.reject(new Error('injected replacement failure')) : client.query(sql, params)),
    }));
    let failed;
    try {
      failed = await f.verify(p, code, bearer(first.token));
    } finally {
      f.app.db.tx = originalTx;
    }
    assert.equal(failed.statusCode, 503, String(failOn));
    assert.deepEqual(failed.json(), { error: 'session replacement failed', code: 'SESSION_REPLACEMENT_FAILED', retryable: true });
    assert.equal(await sessionCount(), before, 'no session was minted');
    assert.ok(await f.sessionRow(first.token), 'the presented session is still live after the rollback');
    const [otp] = await f.db('SELECT consumed_at FROM auth_otp WHERE phone = $1 ORDER BY created_at DESC LIMIT 1', [p]);
    assert.equal(otp.consumed_at, null, 'the OTP was not consumed');
    // The same code still works once the failure is gone, and then replaces the session.
    const retry = await f.verify(p, code, bearer(first.token));
    assert.equal(retry.statusCode, 200);
    assert.equal(await f.sessionRow(first.token), null);
    first.token = retry.json().token;
  }
});
