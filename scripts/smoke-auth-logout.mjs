// B2-A: injected transport, real ownership/removal boundary and disposed UI.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAuthLogout, createLogoutControl } from '../public/src/auth_logout.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
function storage() {
  const map = new Map();
  return { getItem: k => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) };
}

function fixture(options = {}) {
  let auth = { token: 'A', userId: 'user-A', ownerVersion: 'version-A' };
  let generation = 0;
  let anonymous = false;
  let caches = 'account-A';
  let navigated = false;
  let signal = null;
  const events = [];
  let request = deferred();
  const coordinator = createAuthLogout({
    captureAuth: () => ({ ...auth }),
    authCurrent: lease => JSON.stringify(lease) === JSON.stringify(auth),
    backendEnabled: () => true,
    beginLogout: () => {
      const own = ++generation;
      events.push('fence');
      return { isCurrent: () => own === generation };
    },
    requestLogout: options => { signal = options.signal; events.push('server'); return request.promise; },
    localLogout: ({ navigate = () => true } = {}) => {
      events.push('local');
      auth = { token: null, userId: null, ownerVersion: null };
      caches = null;
      anonymous = true;
      events.push('anonymous');
      navigated = navigate();
      if (navigated) events.push('welcome');
      return true;
    },
    ...options,
  });
  return { coordinator, get request() { return request; }, events,
    nextRequest: () => { request = deferred(); },
    getAuth: () => auth, caches: () => caches, anonymous: () => anonymous,
    navigated: () => navigated,
    signal: () => signal,
    replace: next => { auth = next; },
    newLogin: () => { generation++; },
  };
}

async function realCase(name) {
  globalThis.localStorage = storage();
  globalThis.sessionStorage = storage();
  let hash = '#/profile';
  globalThis.location = { get hash() { return hash; },
    set hash(v) { hash = v.startsWith('#') ? v : '#' + v; } };
  globalThis.window = { location };
  const auth = await import('../public/src/auth_token.js');
  const { user } = await import('../public/src/state.js');
  const { performLocalLogout, setLocalLogoutObserver } = await import('../public/src/mock_auth.js');
  const { createAuthSessionBootstrap } = await import('../public/src/auth_session_bootstrap.js');
  assert.equal(auth.setAuth({ token: 'A', userId: 'user-A' }), true);
  assert.equal(auth.commitAuthCandidate(auth.getAuthOwnerVersion()), true);
  user.set({ role: 'passenger', onboarded: true, firstName: 'A' });
  localStorage.setItem('bazardrive.ride_history.v1', '[{"secret":"A"}]');
  const controller = createAuthSessionBootstrap({
    backendEnabled: () => true,
    requestSession: async () => ({ user: { userId: 'user-A', sessionId: 'session-A',
      activeRole: 'passenger', phoneVerified: true } }),
  });
  await controller.reconcile();
  setLocalLogoutObserver(() => controller.adoptAnonymousAfterExternalLogout());
  const request = deferred();
  let posts = 0;
  const coordinator = createAuthLogout({
    backendEnabled: () => true,
    beginLogout: () => controller.beginExplicitLogout(),
    onLocalFailure: lease => controller.failExplicitLogout(lease),
    requestLogout: () => {
      posts++;
      assert.equal(auth.getAuthToken(), 'A', 'request must capture owned A, never B');
      return request.promise;
    },
    localLogout: performLocalLogout,
  });
  const ownedAuth = { token: auth.getAuthToken(), userId: auth.getAuthUserId(),
    ownerVersion: auth.getAuthOwnerVersion() };
  const pending = coordinator.logout();
  await flush();
  assert.equal(posts, 1);
  assert.equal(auth.getAuthToken(), 'A');
  assert.equal(controller.getSnapshot().state, 'AUTHENTICATED');
  if (name === 'same-tab') {
    controller.beginLogin();
    assert.equal(auth.setAuth({ token: 'B', userId: 'user-B' }), true);
    auth.commitAuthCandidate(auth.getAuthOwnerVersion());
  } else if (name === 'foreign' || name === 'foreign-same-user') {
    localStorage.setItem(auth.AUTH_STORAGE_KEY, JSON.stringify({ token: 'B',
      userId: name === 'foreign' ? 'user-B' : 'user-A', ownerVersion: crypto.randomUUID() }));
  }
  const remove = localStorage.removeItem;
  const read = localStorage.getItem;
  const ambiguous = name.startsWith('storage-remove-success-read-throws');
  let verificationReads = 0;
  let authRemovals = 0;
  if (name === 'absent-without-blocked-cleanup') remove(auth.AUTH_STORAGE_KEY);
  if (ambiguous) {
    localStorage.removeItem = key => {
      remove(key);
      if (key === auth.AUTH_STORAGE_KEY) {
        authRemovals++;
        verificationReads++;
      }
    };
    localStorage.getItem = key => {
      if (key === auth.AUTH_STORAGE_KEY && verificationReads) {
        verificationReads--;
        throw new Error('verification read denied after successful removal');
      }
      return read(key);
    };
  }
  if (name === 'storage-denied' || name === 'storage-noop') {
    localStorage.removeItem = key => {
      if (key === auth.AUTH_STORAGE_KEY) {
        if (name === 'storage-denied') throw new Error('storage denied');
        return;
      }
      remove(key);
    };
  }
  request.resolve({ ok: true });
  const result = await pending;
  if (ambiguous) {
    assert.equal(authRemovals, 1);
    assert.equal(verificationReads, 0, 'only the immediate removal verification throws');
    assert.equal(read(auth.AUTH_STORAGE_KEY), null, 'A was physically removed');
    assert.equal(result.code, 'AUTH_STORAGE_FAILED',
      'successful removal with unreadable verification must retain A cleanup ownership');
    assert.equal(coordinator.getSnapshot().phase, 'local-error');
    assert.equal(posts, 1);
    assert.equal(auth.getAuthToken(), null, 'cleanup ownership grants no bearer authority');
    assert.equal(localStorage.getItem('bazardrive.ride_history.v1'), '[{"secret":"A"}]');
    assert.equal(user.get().firstName, 'A');
    assert.equal(controller.getSnapshot().state, 'SESSION_UNKNOWN');
    assert.equal((await controller.reconcile()).state, 'SESSION_UNKNOWN');
    assert.equal(hash, '#/profile');
    localStorage.getItem = read;
    localStorage.removeItem = remove;
    assert.equal(auth.isLogoutAuthCurrent({ ...ownedAuth, ownerVersion: crypto.randomUUID() }), false,
      'blocked cleanup still requires the exact ownerVersion');
    if (name.endsWith('-unreadable-retry')) {
      localStorage.getItem = key => {
        if (key === auth.AUTH_STORAGE_KEY) throw new Error('auth storage still unreadable');
        return read(key);
      };
      assert.equal(auth.isLogoutAuthCurrent(ownedAuth), true, 'unreadable storage is not a new actor');
      assert.equal(auth.getAuthToken(), null);
      assert.equal((await coordinator.logout()).code, 'AUTH_STORAGE_FAILED');
      assert.equal(posts, 1);
      assert.equal(controller.getSnapshot().state, 'SESSION_UNKNOWN');
      assert.equal(localStorage.getItem('bazardrive.ride_history.v1'), '[{"secret":"A"}]');
      assert.equal(hash, '#/profile');
      localStorage.getItem = read;
    }
    if (name.endsWith('-marker-mismatch')) {
      sessionStorage.setItem('bazardrive.auth.rejected_projection.v1', 'bound:' + crypto.randomUUID());
      assert.equal(auth.isLogoutAuthCurrent(ownedAuth), false);
      assert.equal((await coordinator.logout()).code, 'AUTH_STALE');
      assert.equal(posts, 1);
      assert.equal(localStorage.getItem('bazardrive.ride_history.v1'), '[{"secret":"A"}]');
      assert.equal(user.get().firstName, 'A');
      assert.equal(controller.getSnapshot().state, 'SESSION_UNKNOWN');
      assert.equal(hash, '#/profile');
      return;
    }
    if (name.endsWith('-foreign') || name.endsWith('-foreign-same-user') || name.endsWith('-same-tab')) {
      const sameTab = name.endsWith('-same-tab');
      if (sameTab) {
        controller.beginLogin();
        assert.equal(auth.setAuth({ token: 'B', userId: 'user-B' }), true);
        assert.equal(auth.commitAuthCandidate(auth.getAuthOwnerVersion()), true);
      } else {
        localStorage.setItem(auth.AUTH_STORAGE_KEY, JSON.stringify({ token: 'B',
          userId: name.endsWith('-foreign-same-user') ? 'user-A' : 'user-B',
          ownerVersion: crypto.randomUUID() }));
      }
      localStorage.setItem('bazardrive.ride_history.v1', '[{"secret":"B"}]');
      user.set({ firstName: 'B' });
      const replacement = read(auth.AUTH_STORAGE_KEY);
      assert.equal((await coordinator.logout()).code, 'AUTH_STALE');
      assert.equal(read(auth.AUTH_STORAGE_KEY), replacement, 'A retry must not erase B');
      assert.equal(localStorage.getItem('bazardrive.ride_history.v1'), '[{"secret":"B"}]');
      assert.equal(user.get().firstName, 'B');
      assert.notEqual(controller.getSnapshot().state, 'ANONYMOUS');
      assert.equal(hash, '#/profile');
    } else {
      assert.equal((await coordinator.logout()).ok, true);
      assert.equal(read(auth.AUTH_STORAGE_KEY), null);
      assert.equal(localStorage.getItem('bazardrive.ride_history.v1'), null);
      assert.equal(user.get().firstName || null, null);
      assert.equal(controller.getSnapshot().state, 'ANONYMOUS');
      assert.equal(hash, '#/welcome');
    }
    assert.equal(posts, 1, 'repair must never repeat the committed server revoke');
  } else if (name === 'absent-without-blocked-cleanup') {
    assert.equal(result.code, 'AUTH_STALE');
    assert.equal(auth.isLogoutAuthCurrent(ownedAuth), false);
    assert.equal(auth.clearAuth({ expected: ownedAuth }), false,
      'empty storage plus a bound marker is not enough without a prior blocked cleanup');
    assert.equal(localStorage.getItem('bazardrive.ride_history.v1'), '[{"secret":"A"}]');
    assert.equal(hash, '#/profile');
    assert.equal(posts, 1);
  } else if (name.startsWith('foreign') || name === 'same-tab') {
    assert.equal(result.code, 'AUTH_STALE');
    assert.equal(JSON.parse(localStorage.getItem(auth.AUTH_STORAGE_KEY)).token, 'B');
    assert.equal(localStorage.getItem('bazardrive.ride_history.v1'), '[{"secret":"A"}]');
    assert.equal(hash, '#/profile');
  } else if (name.startsWith('storage-')) {
    assert.equal(result.code, 'AUTH_STORAGE_FAILED');
    assert.equal(JSON.parse(localStorage.getItem(auth.AUTH_STORAGE_KEY)).token, 'A');
    assert.equal(auth.getAuthToken(), null, 'failed removal blocks authority');
    assert.equal(controller.getSnapshot().state, 'SESSION_UNKNOWN');
    assert.equal((await controller.reconcile()).state, 'SESSION_UNKNOWN',
      'blocked getter is not durable anonymous proof');
    assert.equal(hash, '#/profile');
    localStorage.removeItem = remove;
    assert.equal((await coordinator.logout()).ok, true);
    assert.equal(posts, 1, 'known successful revoke retries local detach only');
    assert.equal(localStorage.getItem(auth.AUTH_STORAGE_KEY), null);
    assert.equal(controller.getSnapshot().state, 'ANONYMOUS');
    assert.equal(hash, '#/welcome');
  } else {
    assert.equal(result.ok, true);
    assert.equal(localStorage.getItem(auth.AUTH_STORAGE_KEY), null);
    assert.equal(controller.getSnapshot().state, 'ANONYMOUS');
    assert.equal(localStorage.getItem('bazardrive.ride_history.v1'), null);
    assert.equal(hash, '#/welcome');
  }
}

if (process.argv[2] === '--storage-case') {
  await realCase(process.argv[3]);
} else {
  let count = 0;
  async function check(name, test) {
    await test();
    count++;
    console.log('PASS ' + name);
  }
  await check('backend OFF uses existing local Profile boundary without server or fence', async () => {
    const f = fixture({ backendEnabled: () => false });
    assert.equal((await f.coordinator.logout()).ok, true);
    assert.deepEqual(f.events, ['local', 'anonymous', 'welcome']);
  });
  await check('server-first, pending auth/caches retained, anonymous and welcome after detach', async () => {
    const f = fixture();
    const pending = f.coordinator.logout();
    await flush();
    assert.deepEqual(f.events, ['fence', 'server']);
    assert.equal(f.getAuth().token, 'A');
    assert.equal(f.caches(), 'account-A');
    assert.equal(f.anonymous(), false);
    assert.equal(f.navigated(), false);
    f.request.resolve({ ok: true });
    assert.equal((await pending).ok, true);
    assert.deepEqual(f.events, ['fence', 'server', 'local', 'anonymous', 'welcome']);
  });
  for (const code of ['SESSION_LOOKUP_FAILED', 'SESSION_REVOKE_FAILED', 'NETWORK', 'ABORTED']) {
    await check(code + ' preserves owned credential, caches and screen; retry succeeds', async () => {
      const f = fixture();
      const pending = f.coordinator.logout();
      await flush();
      f.request.reject({ code });
      const result = await pending;
      assert.equal(result.code, code);
      assert.equal(result.retryable, true);
      assert.equal(f.getAuth().token, 'A');
      assert.equal(f.caches(), 'account-A');
      assert.equal(f.anonymous(), false);
      assert.equal(f.navigated(), false);
      f.nextRequest();
      const retry = f.coordinator.logout();
      f.request.resolve({ ok: true });
      assert.equal((await retry).ok, true);
    });
  }
  await check('timeout settles abort-ignoring request and ignores late success', async () => {
    const f = fixture({ timeoutMs: 5 });
    assert.equal((await f.coordinator.logout()).code, 'LOGOUT_TIMEOUT');
    assert.equal(f.signal().aborted, true);
    f.request.resolve({ ok: true });
    await flush();
    assert.equal(f.getAuth().token, 'A');
    assert.equal(f.caches(), 'account-A');
    assert.equal(f.anonymous(), false);
    assert.equal(f.navigated(), false);
  });
  for (const payload of [null, [], 'ok', {}, { ok: false }]) {
    await check('invalid success ' + JSON.stringify(payload) + ' preserves actor', async () => {
      const f = fixture();
      const pending = f.coordinator.logout();
      f.request.resolve(payload);
      assert.equal((await pending).code, 'SESSION_PROTOCOL');
      assert.equal(f.getAuth().token, 'A');
      assert.equal(f.caches(), 'account-A');
      assert.equal(f.navigated(), false);
    });
  }
  await check('duplicate logout coalesces the same in-flight promise', async () => {
    const f = fixture();
    const a = f.coordinator.logout();
    const b = f.coordinator.logout();
    assert.equal(a, b);
    await flush();
    assert.equal(f.events.filter(e => e === 'server').length, 1);
    f.request.resolve({ ok: true });
    await a;
  });
  for (const kind of ['new-login', 'replacement', 'same-user-rotation']) {
    await check('stale completion cannot erase ' + kind, async () => {
      const f = fixture();
      const pending = f.coordinator.logout();
      await flush();
      if (kind === 'new-login') f.newLogin();
      else f.replace({ token: 'B', userId: kind === 'replacement' ? 'user-B' : 'user-A',
        ownerVersion: 'version-B' });
      f.request.resolve({ ok: true });
      assert.equal((await pending).code, 'AUTH_STALE');
      assert.equal(f.events.includes('local'), false);
      assert.equal(f.navigated(), false);
    });
  }
  await check('replacement before request creation is never sent', async () => {
    const f = fixture();
    const pending = f.coordinator.logout();
    f.replace({ token: 'B', userId: 'user-B', ownerVersion: 'version-B' });
    assert.equal((await pending).code, 'AUTH_STALE');
    assert.equal(f.events.includes('server'), false);
  });
  await check('no owned bearer has no server dependency', async () => {
    const f = fixture();
    f.replace({ token: null, userId: null, ownerVersion: null });
    assert.equal((await f.coordinator.logout()).ok, true);
    assert.equal(f.events.includes('server'), false);
  });
  await check('disposed screen gets no late feedback and no forced navigation', async () => {
    let mounted = true;
    const states = [];
    const f = fixture();
    const control = createLogoutControl({ logout: f.coordinator.logout,
      isCurrent: () => mounted, onState: s => states.push(s.phase) });
    await control.submit();
    const pending = control.submit();
    await control.submit();
    await flush();
    assert.deepEqual(states, ['confirmed', 'pending']);
    mounted = false;
    f.request.resolve({ ok: true });
    await pending;
    assert.deepEqual(states, ['confirmed', 'pending']);
    assert.equal(f.anonymous(), true);
    assert.equal(f.navigated(), false);
  });
  await check('UI failure supports retry without duplicate submit', async () => {
    const states = [];
    let calls = 0;
    const control = createLogoutControl({ logout: async () => (++calls === 1
      ? { ok: false, code: 'NETWORK' } : { ok: true }),
    onState: s => states.push(s.phase) });
    await control.submit();
    await control.submit();
    await control.submit();
    assert.deepEqual(states, ['confirmed', 'pending', 'error', 'pending', 'success']);
  });
  for (const name of ['success', 'same-tab', 'foreign', 'foreign-same-user', 'storage-denied', 'storage-noop',
    'storage-remove-success-read-throws', 'storage-remove-success-read-throws-foreign',
    'storage-remove-success-read-throws-foreign-same-user', 'storage-remove-success-read-throws-same-tab',
    'storage-remove-success-read-throws-unreadable-retry', 'storage-remove-success-read-throws-marker-mismatch',
    'absent-without-blocked-cleanup']) {
    await check('real auth/controller/local boundary: ' + name, () => {
      execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--storage-case', name],
        { stdio: 'pipe' });
    });
  }
  await check('B2-B1 injected Guest commit is server-first and carries fixed intent', async () => {
    let guest = false;
    const f = fixture({ retainFailures: true,
      localLogout: ({ expectedAuth, isCurrent, navigate, intent }) => {
        assert.equal(expectedAuth.token, 'A'); assert.equal(isCurrent(), true);
        assert.equal(intent, 'guest'); assert.equal(navigate(), true);
        guest = true; return true;
      } });
    const pending = f.coordinator.logout({ intent: 'guest' });
    assert.equal(pending, f.coordinator.logout({ intent: 'guest' }));
    await flush(); assert.equal(guest, false); assert.equal(f.getAuth().token, 'A');
    f.request.resolve({ ok: true }); assert.equal((await pending).ok, true);
    assert.equal(guest, true); assert.equal(f.events.filter(e => e === 'server').length, 1);
    assert.equal(f.events.includes('welcome'), false);
  });
  for (const code of ['SESSION_LOOKUP_FAILED', 'SESSION_REVOKE_FAILED', 'NETWORK', 'ABORTED']) {
    await check('B2-B1 immutable retry lease after ' + code, async () => {
      const f = fixture({ retainFailures: true });
      const pending = f.coordinator.logout({ intent: 'guest' });
      await flush(); f.request.reject({ code });
      assert.equal((await pending).code, code);
      assert.equal(f.getAuth().token, 'A'); assert.equal(f.caches(), 'account-A');
      assert.equal(f.anonymous(), false); assert.equal(f.navigated(), false);
      assert.equal((await f.coordinator.logout({ intent: 'abandon' })).code, 'AUTH_DETACH_PENDING');
      f.nextRequest();
      const retry = f.coordinator.logout({ intent: 'guest' });
      await flush(); f.request.resolve({ ok: true }); assert.equal((await retry).ok, true);
      assert.equal(f.events.filter(e => e === 'fence').length, 1, 'do not recapture actor on retry');
    });
  }
  for (const kind of ['replacement', 'same-user-rotation', 'new-login']) {
    await check('B2-B1 failed request retry cannot capture ' + kind, async () => {
      const f = fixture({ retainFailures: true });
      const pending = f.coordinator.logout({ intent: 'guest' });
      await flush(); f.request.reject({ code: 'NETWORK' }); await pending;
      if (kind === 'new-login') f.newLogin();
      else f.replace({ token: 'B', userId: kind === 'replacement' ? 'user-B' : 'user-A',
        ownerVersion: 'version-B' });
      assert.equal((await f.coordinator.logout({ intent: 'guest' })).code, 'AUTH_STALE');
      assert.equal(f.events.filter(e => e === 'server').length, 1);
      assert.equal(f.events.includes('local'), false);
    });
  }
  await check('B2-B1 local repair retains Guest intent without repeating server revoke', async () => {
    let commits = 0;
    const f = fixture({ retainFailures: true, localLogout: ({ intent }) => {
      assert.equal(intent, 'guest'); return ++commits > 1;
    } });
    const pending = f.coordinator.logout({ intent: 'guest' });
    f.request.resolve({ ok: true });
    assert.equal((await pending).code, 'AUTH_STORAGE_FAILED');
    assert.equal((await f.coordinator.logout({ intent: 'guest' })).ok, true);
    assert.equal(commits, 2); assert.equal(f.events.filter(e => e === 'server').length, 1);
  });
  await check('B2-B1 disposed Guest intent permits cleanup but not projection/navigation', async () => {
    let mounted = true, cleaned = false, guest = false;
    const f = fixture({ retainFailures: true, localLogout: ({ navigate }) => {
      cleaned = true; if (navigate()) guest = true; return true;
    } });
    const pending = f.coordinator.logout({ intent: 'guest', isCurrent: () => mounted });
    await flush(); mounted = false; f.request.resolve({ ok: true }); await pending;
    assert.equal(cleaned, true); assert.equal(guest, false);
  });
  await check('B2-B1 timeout retains intent and does not accept late success', async () => {
    const f = fixture({ retainFailures: true, timeoutMs: 5 });
    assert.equal((await f.coordinator.logout({ intent: 'guest' })).code, 'LOGOUT_TIMEOUT');
    f.request.resolve({ ok: true }); await flush();
    assert.equal(f.anonymous(), false); assert.equal(f.getAuth().token, 'A');
    f.nextRequest(); const retry = f.coordinator.logout({ intent: 'guest' });
    f.request.resolve({ ok: true }); assert.equal((await retry).ok, true);
    assert.equal(f.events.filter(e => e === 'fence').length, 1);
  });
  console.log('auth-logout: ' + count + ' behavioral checks PASS');
}
