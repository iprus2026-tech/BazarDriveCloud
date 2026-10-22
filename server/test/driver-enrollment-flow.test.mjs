// /server/test/driver-enrollment-flow.test.mjs — DB-gated acceptance for BD-AUTH-POLICY-01B-A
// (docs/driver-role-grant-contract.md §1): a driver application through
// POST/GET /api/v1/drivers/enrollment, operator decisions through decideDriverEnrollment and
// the `ops:driver` CLI adapter, the stand-only auto-approve switch, and the one-open index.
// SKIPPED without DATABASE_URL; runs in server-ci's app job.
//
// CLEANUP: orders (cascades offers), then users (cascades auth_session and driver_enrollments).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

import { buildApp } from '../src/server.js';
import { grantDriverRole } from '../test-support/driver-grant.mjs';
import {
  submitDriverEnrollment, decideDriverEnrollment,
} from '../src/services/driver-enrollment/decisions.js';
import { run as opsDriver, maskPhone } from '../scripts/ops-driver.mjs';

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

const post = (app, url, payload, headers) => app.inject({ method: 'POST', url, payload, headers });
const get = (app, url, headers) => app.inject({ method: 'GET', url, headers });
const bearer = (s) => ({ authorization: `Bearer ${s.token}` });
const ENROLL = '/api/v1/drivers/enrollment';
const OP = 'test:operator';

async function mintSession(app, phone) {
  const code = (await post(app, '/api/v1/auth/otp/request', { phone })).json().devCode;
  return (await post(app, '/api/v1/auth/otp/verify', { phone, code })).json();
}

// One fixture per test: unique phones, an owner passenger with an open order, cleanup.
async function fixture(t, { config = baseConfig } = {}) {
  const app = await buildApp({ config });
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  await cleanup.connect();
  const tag = `${String(process.pid).padStart(5, '0')}${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}`;
  let n = 0;
  const phones = [];
  const orderIds = [];
  const phone = () => { const p = `+1631${tag}${n++}`; phones.push(p); return p; };
  t.after(async () => {
    if (orderIds.length) await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    for (const p of phones) {
      await cleanup.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await cleanup.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });
  const owner = await mintSession(app, phone());
  const order = (await post(app, '/api/v1/orders', { pickup: { label: 'A' }, dropoff: { label: 'B' } }, bearer(owner))).json().order;
  orderIds.push(order.id);
  const offer = (s) => post(app, '/api/v1/matching/offers', { vehiclePlate: 'А 123 ВС 77', orderId: order.id, driverName: 'Т' }, bearer(s));
  const rows = async (userId) => (await cleanup.query(
    'SELECT status, decided_by, decided_at, decision_reason FROM driver_enrollments WHERE user_id = $1 ORDER BY requested_at',
    [userId],
  )).rows;
  const account = async (userId) => (await cleanup.query('SELECT roles, active_role FROM users WHERE id = $1', [userId])).rows[0];
  return { app, cleanup, phone, offer, rows, account };
}

test('enrollment: apply (idempotent), operator approve grants the driver role', { skip: SKIP }, async (t) => {
  const { app, cleanup, phone, offer, rows, account } = await fixture(t);
  const phoneA = phone();
  const a = await mintSession(app, phoneA);
  assert.deepEqual(a.user.roles, ['passenger']);

  const first = await post(app, ENROLL, undefined, bearer(a));
  assert.equal(first.statusCode, 201);
  assert.equal(first.json().enrollment.status, 'PENDING');
  assert.equal(first.json().enrollment.decidedAt, null);
  assert.deepEqual(first.json().roles, ['passenger']);
  assert.equal(Object.hasOwn(first.json().enrollment, 'decidedBy'), false, 'the applicant never sees the decision actor');
  const again = await post(app, ENROLL, {}, bearer(a));
  assert.equal(again.statusCode, 200, 'a pending application is idempotent');
  assert.equal(again.json().enrollment.requestedAt, first.json().enrollment.requestedAt);
  assert.equal((await get(app, ENROLL, bearer(a))).json().enrollment.status, 'PENDING');
  assert.equal((await rows(a.user.userId)).length, 1);

  const refused = await offer(a);
  assert.equal(refused.statusCode, 403, 'a pending applicant still cannot offer');
  assert.equal(refused.json().code, 'DRIVER_ROLE_REQUIRED');

  const approved = await decideDriverEnrollment(app.db, { target: { phone: phoneA }, decision: 'approve', decidedBy: OP, reason: 'docs checked' });
  assert.equal(approved.ok, true);
  assert.equal(approved.code, 'APPROVED');
  assert.deepEqual([...approved.roles].sort(), ['driver', 'passenger']);
  const [row] = await rows(a.user.userId);
  assert.equal(row.status, 'APPROVED');
  assert.equal(row.decided_by, OP);
  assert.equal(row.decision_reason, 'docs checked');
  assert.ok(row.decided_at instanceof Date);
  assert.equal((await account(a.user.userId)).active_role, 'passenger', 'approval never changes the active role');

  const after = await get(app, ENROLL, bearer(a));
  assert.equal(after.json().enrollment.status, 'APPROVED');
  assert.ok(after.json().enrollment.decidedAt);
  assert.equal((await post(app, ENROLL, undefined, bearer(a))).statusCode, 200, 'a granted account does not re-apply');
  assert.equal((await decideDriverEnrollment(app.db, { target: { phone: phoneA }, decision: 'approve', decidedBy: OP })).code, 'ALREADY_APPROVED');

  // The grant is real: a fresh login lists it; once the active role is driver (01B-B adds the
  // switch — here the account's active_role seeds the next session) the offer gate passes.
  const relogin = await mintSession(app, phoneA);
  assert.deepEqual([...relogin.user.roles].sort(), ['driver', 'passenger']);
  assert.equal(relogin.user.activeRole, 'passenger');
  assert.equal((await offer(relogin)).statusCode, 403);
  await cleanup.query("UPDATE users SET active_role = 'driver' WHERE id = $1", [a.user.userId]);
  const asDriver = await mintSession(app, phoneA);
  assert.equal(asDriver.user.activeRole, 'driver');
  assert.equal((await offer(asDriver)).statusCode, 201, 'an approved, active driver can offer');
});

test('enrollment: reject, refused decisions write nothing, a new application after reject', { skip: SKIP }, async (t) => {
  const { app, phone, rows, account } = await fixture(t);
  const phoneB = phone();
  const b = await mintSession(app, phoneB);
  assert.equal((await post(app, ENROLL, undefined, bearer(b))).statusCode, 201);

  const rejected = await decideDriverEnrollment(app.db, { target: { userId: b.user.userId }, decision: 'reject', decidedBy: OP, reason: 'no licence' });
  assert.equal(rejected.code, 'REJECTED');
  assert.deepEqual(rejected.roles, ['passenger']);
  assert.equal((await get(app, ENROLL, bearer(b))).json().enrollment.status, 'REJECTED');
  assert.equal((await decideDriverEnrollment(app.db, { target: { userId: b.user.userId }, decision: 'reject', decidedBy: OP })).code, 'ALREADY_REJECTED');

  const before = JSON.stringify(await rows(b.user.userId));
  const noPending = await decideDriverEnrollment(app.db, { target: { userId: b.user.userId }, decision: 'approve', decidedBy: OP });
  assert.deepEqual([noPending.ok, noPending.code], [false, 'NO_PENDING_APPLICATION']);
  const notApproved = await decideDriverEnrollment(app.db, { target: { userId: b.user.userId }, decision: 'revoke', decidedBy: OP });
  assert.deepEqual([notApproved.ok, notApproved.code], [false, 'NOT_APPROVED']);
  assert.equal(JSON.stringify(await rows(b.user.userId)), before, 'refused decisions write nothing');
  assert.deepEqual((await account(b.user.userId)).roles, ['passenger']);

  const reapply = await post(app, ENROLL, undefined, bearer(b));
  assert.equal(reapply.statusCode, 201, 'a new application is allowed after REJECTED');
  assert.deepEqual((await rows(b.user.userId)).map((r) => r.status), ['REJECTED', 'PENDING']);
});

test('enrollment: revoke removes the grant and resets driver-mode sessions', { skip: SKIP }, async (t) => {
  const { app, cleanup, phone, offer, rows, account } = await fixture(t);
  const phoneC = phone();
  const c = await mintSession(app, phoneC);
  await post(app, ENROLL, undefined, bearer(c));
  await decideDriverEnrollment(app.db, { target: { phone: phoneC }, decision: 'approve', decidedBy: OP });
  await cleanup.query("UPDATE users SET active_role = 'driver' WHERE id = $1", [c.user.userId]);
  const driverSession = await mintSession(app, phoneC);
  assert.equal(driverSession.user.activeRole, 'driver');
  assert.equal((await offer(driverSession)).statusCode, 201);

  const revoked = await decideDriverEnrollment(app.db, { target: { phone: phoneC }, decision: 'revoke', decidedBy: OP, reason: 'expired licence' });
  assert.equal(revoked.code, 'REVOKED');
  assert.deepEqual(revoked.roles, ['passenger']);
  assert.deepEqual(await account(c.user.userId), { roles: ['passenger'], active_role: 'passenger' });
  const { rows: sessions } = await cleanup.query(
    'SELECT DISTINCT active_role FROM auth_session WHERE user_id = $1 AND revoked_at IS NULL', [c.user.userId],
  );
  assert.deepEqual(sessions.map((s) => s.active_role), ['passenger'], 'no live session stays in driver mode');
  const blocked = await offer(driverSession);
  assert.equal(blocked.statusCode, 403, 'the older driver session is denied on its next offer');
  assert.deepEqual((await rows(c.user.userId)).map((r) => r.status), ['REVOKED']);
  assert.equal((await decideDriverEnrollment(app.db, { target: { phone: phoneC }, decision: 'revoke', decidedBy: OP })).code, 'ALREADY_REVOKED');
  assert.equal((await post(app, ENROLL, undefined, bearer(driverSession))).statusCode, 201, 'a new application after REVOKED');
});

test('enrollment: a grant made before 01B-A (SQL) is reported and can be revoked', { skip: SKIP }, async (t) => {
  const { app, cleanup, phone, rows, account } = await fixture(t);
  const phoneD = phone();
  const d = await grantDriverRole(cleanup, await mintSession(app, phoneD), { roles: ['driver'], activeRole: 'driver' });
  const res = await post(app, ENROLL, undefined, bearer(d));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { enrollment: null, roles: ['driver'] });
  assert.equal((await rows(d.user.userId)).length, 0, 'no row is invented for an old grant');

  const revoked = await decideDriverEnrollment(app.db, { target: { userId: d.user.userId }, decision: 'revoke', decidedBy: OP });
  assert.equal(revoked.code, 'REVOKED');
  assert.deepEqual(await account(d.user.userId), { roles: [], active_role: null }, 'no remaining grant -> no active role');
  assert.deepEqual((await rows(d.user.userId)).map((r) => [r.status, r.decided_by]), [['REVOKED', OP]]);
});

test('enrollment: DRIVER_ENROLLMENT_AUTO_APPROVE (stand) approves in the same transaction', { skip: SKIP }, async (t) => {
  const { app, phone, rows, account } = await fixture(t, { config: { ...baseConfig, drivers: { enrollmentAutoApprove: true } } });
  const e = await mintSession(app, phone());
  const res = await post(app, ENROLL, undefined, bearer(e));
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().enrollment.status, 'APPROVED');
  assert.deepEqual([...res.json().roles].sort(), ['driver', 'passenger']);
  assert.deepEqual((await rows(e.user.userId)).map((r) => [r.status, r.decided_by]), [['APPROVED', 'auto-approve']]);
  assert.equal((await account(e.user.userId)).active_role, 'passenger');
});

test('enrollment: concurrent applications serialize to one row; the one-open index holds', { skip: SKIP }, async (t) => {
  const { app, cleanup, phone, rows } = await fixture(t);
  const f = await mintSession(app, phone());
  const results = await Promise.all([post(app, ENROLL, undefined, bearer(f)), post(app, ENROLL, undefined, bearer(f))]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 201]);
  assert.equal((await rows(f.user.userId)).length, 1);
  await assert.rejects(
    cleanup.query("INSERT INTO driver_enrollments (user_id) VALUES ($1)", [f.user.userId]),
    (err) => err.code === '23505',
    'a second open application violates driver_enrollments_one_open_per_user_uq',
  );
  await assert.rejects(
    cleanup.query("INSERT INTO driver_enrollments (user_id, status) VALUES ($1, 'REJECTED')", [f.user.userId]),
    (err) => err.code === '23514',
    'a decided status without decided_at / decided_by violates driver_enrollments_decision_check',
  );
});

test('enrollment: the module refuses bad input, unknown and unverified accounts', { skip: SKIP }, async (t) => {
  const { app, cleanup, phone } = await fixture(t);
  const unverifiedPhone = phone();
  const { rows: [u] } = await cleanup.query(
    "INSERT INTO users (phone, phone_verified, roles, active_role) VALUES ($1, FALSE, ARRAY['passenger'], 'passenger') RETURNING id",
    [unverifiedPhone],
  );
  assert.equal((await submitDriverEnrollment(app.db, { userId: u.id })).code, 'PHONE_NOT_VERIFIED');
  assert.equal((await submitDriverEnrollment(app.db, { userId: randomUUID() })).code, 'ACCOUNT_NOT_FOUND');
  const decide = (input) => decideDriverEnrollment(app.db, { target: { userId: u.id }, decision: 'approve', decidedBy: OP, ...input });
  assert.equal((await decide({ decision: 'grant' })).code, 'INVALID_DECISION');
  assert.equal((await decide({ decidedBy: '  ' })).code, 'INVALID_DECIDED_BY');
  assert.equal((await decide({ reason: 'x'.repeat(501) })).code, 'INVALID_REASON');
  assert.equal((await decide({ target: { userId: randomUUID() } })).code, 'ACCOUNT_NOT_FOUND');
  assert.equal((await decide({ target: { phone: 'not-a-phone' } })).code, 'ACCOUNT_NOT_FOUND');
});

test('ops:driver CLI: list / approve / refusals, exit codes, masked phone, no token', { skip: SKIP }, async (t) => {
  const { app, cleanup, phone } = await fixture(t);
  const phoneG = phone();
  const g = await mintSession(app, phoneG);
  await post(app, ENROLL, undefined, bearer(g));
  const lines = [];
  const capture = { env: { DATABASE_URL }, out: (s) => lines.push(s), err: (s) => lines.push(s) };
  const cli = async (args) => { lines.length = 0; const code = await opsDriver(args, capture); return { code, text: lines.join('\n') }; };

  const list = await cli(['list']);
  assert.equal(list.code, 0);
  assert.match(list.text, new RegExp(g.user.userId));
  assert.ok(list.text.includes(maskPhone(phoneG)));
  const approve = await cli(['approve', phoneG, '--by', 'tester', '--reason', 'ok']);
  assert.equal(approve.code, 0, approve.text);
  assert.match(approve.text, /approve: APPROVED/);
  assert.match(approve.text, /roles \[.*driver.*\]/);
  const { rows: [row] } = await cleanup.query('SELECT decided_by FROM driver_enrollments WHERE user_id = $1', [g.user.userId]);
  assert.equal(row.decided_by, 'ops-cli:tester');
  assert.equal((await cli(['approve', g.user.userId])).code, 0, 'a repeat is an idempotent success');
  const refused = await cli(['reject', phoneG]);
  assert.equal(refused.code, 1);
  assert.match(refused.text, /NO_PENDING_APPLICATION \(nothing written\)/);
  assert.equal((await cli(['grant', phoneG])).code, 2);
  assert.equal((await cli(['approve'])).code, 2);
  for (const text of [list.text, approve.text, refused.text]) {
    assert.equal(text.includes(phoneG), false, 'the raw phone is never printed');
    assert.equal(text.includes(g.token), false, 'no token is printed');
  }

  // The npm script entry point wires exit codes through process.exitCode.
  const script = fileURLToPath(new URL('../scripts/ops-driver.mjs', import.meta.url));
  const proc = spawnSync(process.execPath, [script, 'list'], { env: { ...process.env, DATABASE_URL }, encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  assert.match(proc.stdout, /pending driver applications: \d+/);
  const usage = spawnSync(process.execPath, [script, 'nope'], { env: { ...process.env, DATABASE_URL }, encoding: 'utf8' });
  assert.equal(usage.status, 2);
});
