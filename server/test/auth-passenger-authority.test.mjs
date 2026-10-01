// Hermetic HTTP/service/repository contract tests. No pg client, sockets or live DB.
// The transactional double tests orchestration, NOT PostgreSQL isolation semantics.
import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import fp from 'fastify-plugin';
import authPlugin from '../src/plugins/auth.js';
import authRoutes from '../src/services/auth/index.js';
import { hashOtpCode } from '../src/services/auth/tokens.js';
import { resolveVerifiedLoginUser } from '../src/repositories/users.js';

async function fixture(t, existing = null, { failSession = false } = {}) {
  let state = { user: existing && structuredClone(existing), sessions: [], consumed: false, attempts: 0 };
  let transactions = 0, rollbacks = 0;
  const query = async (sql, args) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (q.startsWith('SELECT latest.')) return { rows: state.consumed ? [] : [
      { id: 'otp-1', code_hash: hashOtpCode('1234') }] };
    if (q.startsWith('UPDATE auth_otp SET attempts')) {
      return { rows: [{ attempts: ++state.attempts }] };
    }
    if (q.startsWith('UPDATE auth_otp SET consumed_at')) {
      assert.equal(transactions, 1, 'consumption must share session transaction');
      if (state.consumed) return { rows: [] };
      state.consumed = true;
      return { rows: [{ id: 'otp-1' }] };
    }
    if (q.startsWith('INSERT INTO users')) {
      assert.equal(transactions, 1);
      assert.match(q, /VALUES \(\$1, TRUE, ARRAY\['passenger'\]::text\[\], 'passenger'\)/);
      const conflict = q.split('DO UPDATE SET ')[1].split(' RETURNING')[0];
      assert.equal(conflict, 'phone_verified = TRUE, updated_at = now()',
        'conflict cannot assign roles or active_role');
      if (!state.user) state.user = { id: 'new-user', phone: args[0],
        role: null, roles: ['passenger'], active_role: 'passenger', phone_verified: true };
      else state.user.phone_verified = true;
      return { rows: [structuredClone(state.user)] };
    }
    if (q.startsWith('INSERT INTO auth_session')) {
      assert.equal(transactions, 1);
      if (failSession) throw new Error('injected session failure');
      const row = { id: 'session-' + (state.sessions.length + 1), user_id: args[0],
        token_hash: args[1], active_role: args[2], phone_verified: args[3] };
      state.sessions.push(row);
      return { rows: [row] };
    }
    if (q.includes('FROM auth_session')) {
      return { rows: state.sessions.filter(s => s.token_hash === args[0]) };
    }
    throw new Error('Unexpected diagnostic SQL in hermetic fixture');
  };
  const db = { query, async tx(fn) {
    const before = structuredClone(state);
    transactions++;
    try { return await fn({ query }); }
    catch (error) { state = before; rollbacks++; throw error; }
    finally { transactions--; }
  } };
  const app = Fastify({ logger: false });
  app.decorate('config', {
    isProd: false, otp: { devMode: true, length: 4, ttlSeconds: 300, maxAttempts: 5 },
    session: { ttlSeconds: 0 },
  });
  await app.register(fp(async a => a.decorate('db', db), { name: 'db' }));
  await app.register(authPlugin);
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  t.after(() => app.close());
  const verify = () => app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify',
    payload: { phone: '+15550000001', code: '1234' } });
  return { app, verify, state: () => state, rollbacks: () => rollbacks,
    newOtp() { state.consumed = false; state.attempts = 0; } };
}

test('new verified user is passenger; session confirms it; replay cannot mint; repeat has one grant', async t => {
  const f = await fixture(t);
  const first = await f.verify();
  assert.equal(first.statusCode, 200, first.statusCode === 200 ? '' : first.body);
  const body = first.json();
  assert.deepEqual(body.user, { userId: 'new-user', activeRole: 'passenger',
    phoneVerified: true, roles: ['passenger'] });
  const session = await f.app.inject({ method: 'GET', url: '/api/v1/auth/session',
    headers: { authorization: 'Bearer ' + body.token } });
  assert.equal(session.statusCode, 200);
  assert.equal(session.json().user.activeRole, 'passenger');
  assert.equal(session.json().user.userId, body.user.userId);
  assert.equal((await f.verify()).statusCode, 401);
  assert.equal(f.state().sessions.length, 1);
  f.newOtp();
  const repeated = (await f.verify()).json();
  assert.equal(repeated.user.userId, body.user.userId);
  assert.deepEqual(repeated.user.roles, ['passenger']);
  assert.notEqual(repeated.token, body.token);
});

for (const [label, roles, activeRole, expected] of [
  ['passenger', ['passenger'], 'passenger', 'passenger'],
  ['driver-only', ['driver'], 'driver', 'driver'],
  ['dual driver selected', ['passenger', 'driver'], 'driver', 'driver'],
  ['dual passenger selected', ['driver', 'passenger'], 'passenger', 'passenger'],
  ['roleless', [], null, null],
  ['passenger without selection', ['passenger'], null, null],
  ['passenger without grant', [], 'passenger', null],
  ['driver without grant', ['passenger'], 'driver', null],
]) {
  test('existing ' + label + ' preserves grants and selection; validates session snapshot', async t => {
    const existing = { id: 'existing-user', role: 'driver', roles, active_role: activeRole,
      phone_verified: false };
    const f = await fixture(t, existing);
    const res = await f.verify();
    assert.equal(res.statusCode, 200);
    assert.deepEqual(f.state().user.roles, roles);
    assert.equal(f.state().user.active_role, activeRole);
    assert.equal(f.state().user.role, 'driver');
    assert.equal(res.json().user.activeRole, expected);
    assert.equal(f.state().sessions[0].active_role, expected);
  });
}

for (const existing of [null, { id: 'old-driver', roles: ['driver'], active_role: 'driver',
  phone_verified: false }]) {
  test('session failure rolls back identity/grant/consume in service transaction: ' + !!existing, async t => {
    const f = await fixture(t, existing, { failSession: true });
    assert.equal((await f.verify()).statusCode, 500);
    assert.deepEqual(f.state().user, existing);
    assert.equal(f.state().consumed, false);
    assert.equal(f.state().sessions.length, 0);
    assert.equal(f.state().attempts, 1);
    assert.equal(f.rollbacks(), 1);
  });
}

test('verified repository rejects empty identity without DB access', async () => {
  await assert.rejects(() => resolveVerifiedLoginUser({
    query() { assert.fail('must not query'); },
  }, { phone: '' }), /non-empty phone/);
});
