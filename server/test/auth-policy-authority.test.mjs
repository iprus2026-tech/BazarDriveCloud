import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveActorAuthority, requirePassengerActor, requireDriverActor,
} from '../src/services/auth/authority.js';

const session = (overrides = {}) => ({
  userId: 'account-1', sessionId: 'session-1',
  activeRole: 'passenger', phoneVerified: true, ...overrides,
});
const account = (overrides = {}) => ({
  id: 'account-1', roles: ['passenger'], phone_verified: true, ...overrides,
});
const failure = (reason, retryable = false) => ({ ok: false, reason, retryable });
const dbFor = (row) => ({ query: async () => ({ rows: row == null ? [] : [row] }) });
const noQuery = { query: () => { throw new Error('must not query'); } };

for (const actor of [null, undefined]) {
  test(`missing actor ${actor} is unauthenticated without DB I/O`, async () => {
    assert.deepEqual(await resolveActorAuthority(noQuery, actor), failure('UNAUTHENTICATED'));
  });
}

for (const bad of [{}, false, 'client-role', session({ userId: '' }),
  session({ sessionId: null }), session({ userId: ' ' }), session({ sessionId: 1 })]) {
  test(`invalid session identity fails closed: ${JSON.stringify(bad)}`, async () => {
    assert.deepEqual(await resolveActorAuthority(noQuery, bad), failure('INVALID_SESSION_ACTOR'));
  });
}

for (const [roles, activeRole] of [
  [['passenger'], 'passenger'], [['driver'], 'driver'],
  [['passenger', 'driver'], 'passenger'], [['passenger', 'driver'], 'driver'],
]) {
  test(`current grants ${roles} with session choice ${activeRole} resolve verified authority`, async () => {
    const actor = session({ activeRole });
    const resolved = await resolveActorAuthority(dbFor(account({ roles })), actor);
    assert.deepEqual(resolved, { ok: true, actor: { ...actor, roles } });
    const accept = activeRole === 'passenger' ? requirePassengerActor : requireDriverActor;
    const reject = activeRole === 'passenger' ? requireDriverActor : requirePassengerActor;
    assert.deepEqual(accept(resolved), resolved);
    assert.deepEqual(reject(resolved), failure('WRONG_ACTIVE_ROLE'));
  });
}

for (const [roles, activeRole] of [
  [['passenger'], 'driver'], [['driver'], 'passenger'], [[], 'passenger'], [[], 'driver'],
]) {
  test(`session choice ${activeRole} is not inferred into current grants ${JSON.stringify(roles)}`, async () => {
    const result = await resolveActorAuthority(dbFor(account({ roles })), session({ activeRole }));
    assert.deepEqual(result, failure('ACTIVE_ROLE_NOT_GRANTED'));
    assert.deepEqual(requirePassengerActor(result), result);
    assert.deepEqual(requireDriverActor(result), result);
  });
}

test('revoked driver grant is re-read on each call, not cached in the session', async () => {
  const row = account({ roles: ['passenger', 'driver'] });
  const actor = Object.freeze(session({ activeRole: 'driver', roles: ['driver'] }));
  const db = dbFor(row);
  assert.equal((await resolveActorAuthority(db, actor)).ok, true);
  row.roles = ['passenger'];
  assert.deepEqual(await resolveActorAuthority(db, actor), failure('ACTIVE_ROLE_NOT_GRANTED'));
  assert.equal(actor.activeRole, 'driver', 'no auto-switch to passenger');
});

for (const activeRole of [null, undefined]) {
  test(`missing activeRole ${activeRole} has no account active_role or legacy role fallback`, async () => {
    const row = account({ role: 'passenger', active_role: 'passenger' });
    assert.deepEqual(await resolveActorAuthority(dbFor(row), session({ activeRole })),
      failure('ACTIVE_ROLE_MISSING'));
  });
}

for (const activeRole of ['', 'guest', 'admin', 'DRIVER', 1, true, ['driver']]) {
  test(`invalid session activeRole fails closed: ${JSON.stringify(activeRole)}`, async () => {
    assert.deepEqual(await resolveActorAuthority(dbFor(account()), session({ activeRole })),
      failure('INVALID_ACTIVE_ROLE'));
  });
}

for (const roles of [undefined, null, 'passenger', {}, ['guest'], ['admin'],
  ['passenger', null], ['driver', 1], ['passenger', ['driver']], new Array(1)]) {
  test(`malformed or unsupported grants fail closed: ${JSON.stringify(roles)}`, async () => {
    assert.deepEqual(await resolveActorAuthority(dbFor(account({ roles })), session()),
      failure('INVALID_ROLE_GRANTS'));
  });
}

test('legacy account and client/session role fields never create a missing grant', async () => {
  const row = account({ roles: [], role: 'driver', active_role: 'driver' });
  const actor = session({ activeRole: 'driver', role: 'driver', roles: ['driver'] });
  assert.deepEqual(await resolveActorAuthority(dbFor(row), actor), failure('ACTIVE_ROLE_NOT_GRANTED'));
});

test('account active_role cannot replace a different valid session choice', async () => {
  const row = account({ roles: ['passenger', 'driver'], role: 'driver', active_role: 'driver' });
  const result = await resolveActorAuthority(dbFor(row), session());
  assert.equal(result.ok, true);
  assert.equal(result.actor.activeRole, 'passenger');
});

test('account active_role cannot repair a stale session choice', async () => {
  const row = account({ roles: ['passenger'], active_role: 'passenger', role: 'driver' });
  assert.deepEqual(await resolveActorAuthority(dbFor(row), session({ activeRole: 'driver' })),
    failure('ACTIVE_ROLE_NOT_GRANTED'));
});

test('missing current account is distinct from anonymous', async () => {
  assert.deepEqual(await resolveActorAuthority(dbFor(null), session()), failure('ACCOUNT_NOT_FOUND'));
});

test('lookup throw is retryable and remains distinct from anonymous in both guards', async () => {
  const db = { query: async () => { throw new Error('database unavailable'); } };
  const result = await resolveActorAuthority(db, session());
  assert.deepEqual(result, failure('AUTHORITY_LOOKUP_FAILED', true));
  assert.deepEqual(requirePassengerActor(result), result);
  assert.deepEqual(requireDriverActor(result), result);
});

for (const [snapshot, current] of [
  [false, true], [true, false], [false, false], [undefined, true], [true, undefined],
  [null, true], [true, null], [1, true], [true, 1], ['true', true], [true, 'true'],
]) {
  test(`phone verification requires two literal true facts: session=${snapshot}, account=${current}`, async () => {
    assert.deepEqual(await resolveActorAuthority(dbFor(account({ phone_verified: current })),
      session({ phoneVerified: snapshot })), failure('PHONE_NOT_VERIFIED'));
  });
}

test('resolver uses the session user id, preserves identity, and does not mutate or alias inputs', async () => {
  const roles = Object.freeze(['passenger', 'driver']);
  const row = Object.freeze(account({ roles }));
  const actor = Object.freeze(session());
  let calls = 0;
  const db = { query: async (sql, params) => {
    calls += 1;
    assert.deepEqual(params, [actor.userId]);
    assert.match(sql.trim(), /^SELECT\b/);
    return { rows: [row] };
  } };
  const result = await resolveActorAuthority(db, actor);
  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: true, actor: { ...actor, roles: [...roles] } });
  assert.notEqual(result.actor, actor);
  assert.notEqual(result.actor.roles, roles);
  result.actor.roles.pop();
  assert.deepEqual(row.roles, ['passenger', 'driver']);
  assert.deepEqual(actor, session());
});

for (const [name, guard, role] of [
  ['passenger', requirePassengerActor, 'passenger'], ['driver', requireDriverActor, 'driver'],
]) {
  test(`${name} guard accepts its resolved actor without mutation or I/O`, () => {
    const actor = Object.freeze({ ...session({ activeRole: role }), roles: Object.freeze([role]) });
    const result = Object.freeze({ ok: true, actor });
    assert.deepEqual(guard(result), result);
    assert.deepEqual(actor.roles, [role]);
  });
  test(`${name} guard rejects opposite active role even with both grants`, () => {
    const opposite = role === 'driver' ? 'passenger' : 'driver';
    assert.deepEqual(guard({ ok: true, actor: {
      ...session({ activeRole: opposite }), roles: ['passenger', 'driver'],
    } }), failure('WRONG_ACTIVE_ROLE'));
  });
  test(`${name} guard requires its grant and verified phone, not just the active role`, () => {
    const opposite = role === 'driver' ? 'passenger' : 'driver';
    assert.deepEqual(guard({ ok: true, actor: {
      ...session({ activeRole: role }), roles: [opposite],
    } }), failure('ACTIVE_ROLE_NOT_GRANTED'));
    assert.deepEqual(guard({ ok: true, actor: {
      ...session({ activeRole: role, phoneVerified: false }), roles: [role],
    } }), failure('PHONE_NOT_VERIFIED'));
  });
  test(`${name} guard fails closed for malformed authority`, () => {
    assert.deepEqual(guard(null), failure('UNAUTHENTICATED'));
    for (const result of [{}, { ok: 'true' }, { ok: true }, { ok: true, actor: {} }]) {
      assert.deepEqual(guard(result), failure('INVALID_ACTOR_AUTHORITY'));
    }
    for (const [overrides, reason] of [
      [{ roles: 'driver' }, 'INVALID_ROLE_GRANTS'],
      [{ roles: ['driver', 'guest'] }, 'INVALID_ROLE_GRANTS'],
      [{ activeRole: null }, 'ACTIVE_ROLE_MISSING'],
      [{ activeRole: 'guest' }, 'INVALID_ACTIVE_ROLE'],
    ]) {
      assert.deepEqual(guard({ ok: true, actor: {
        ...session({ activeRole: role }), roles: [role], ...overrides,
      } }), failure(reason));
    }
  });
}
