// Boot identity and verified-login handoff. No logout/revoke or driver enrollment.
import { isBackendEnabled } from './api_config.js';
import { getAuthToken, getAuthUserId, setAuth, clearAuth } from './auth_token.js';
import { getSession } from './api_client.js';

function confirmedUser(payload) {
  const u = payload?.user;
  if (!u || typeof u !== 'object' || Array.isArray(u)
      || typeof u.userId !== 'string' || !u.userId.trim()
      || typeof u.sessionId !== 'string' || !u.sessionId.trim()
      || ![null, 'passenger', 'driver'].includes(u.activeRole)
      || typeof u.phoneVerified !== 'boolean') return null;
  // Copy only the current wire DTO; extra properties cannot grant authority.
  return Object.freeze({ userId: u.userId, sessionId: u.sessionId,
    activeRole: u.activeRole, phoneVerified: u.phoneVerified });
}

export function createAuthSessionBootstrap({
  backendEnabled = isBackendEnabled,
  readToken = getAuthToken,
  readUserId = getAuthUserId,
  writeAuth = setAuth,
  dropAuth = clearAuth,
  requestSession = getSession,
  timeoutMs = 10000,
} = {}) {
  let sequence = 0;
  let active = null;
  const listeners = new Set();
  let snapshot = makeSnapshot('BOOT');
  let loginSequence = 0;
  let handoff = null;

  function makeSnapshot(state, user = null, error = null) {
    return Object.freeze({ state, user, grants: 'UNKNOWN', readiness: 'UNKNOWN',
      error: error ? Object.freeze(error) : null });
  }

  function publish(state, user = null, error = null) {
    snapshot = makeSnapshot(state, user, error);
    for (const listener of listeners) listener(snapshot);
  }

  function fail(code) {
    publish('SESSION_UNKNOWN', null, { code, retryable: true });
    return snapshot;
  }

  // Router ownership + generation defeat A->B->A and competing login responses.
  function beginLogin({ isCurrent = () => true, resetAccount = () => {} } = {}) {
    const generation = ++loginSequence;
    ++sequence;
    active?.cancel();
    active = null;
    handoff = null;
    const priorToken = readToken();
    const priorUserId = readUserId();
    const owns = () => generation === loginSequence && isCurrent();
    return async (payload, phone) => {
      if (!owns() || readToken() !== priorToken || readUserId() !== priorUserId) {
        return { ok: false, code: 'AUTH_STALE' };
      }
      const u = payload?.user;
      if (!payload || typeof payload.token !== 'string' || !payload.token.trim()
          || !u || typeof u.userId !== 'string' || !u.userId.trim()
          || ![null, 'passenger', 'driver'].includes(u.activeRole)
          || typeof u.phoneVerified !== 'boolean' || !Array.isArray(u.roles)
          || u.roles.some(role => typeof role !== 'string')) {
        fail('SESSION_PROTOCOL');
        return { ok: false, code: 'SESSION_PROTOCOL' };
      }
      // Never restore the old bearer if replacement fails.
      dropAuth();
      if (!priorUserId || priorUserId !== u.userId) resetAccount();
      if (!owns()) return { ok: false, code: 'AUTH_STALE' };
      if (!writeAuth({ token: payload.token, userId: u.userId, phone })
          || readToken() !== payload.token || readUserId() !== u.userId) {
        dropAuth();
        fail('AUTH_STORAGE_FAILED');
        return { ok: false, code: 'AUTH_STORAGE_FAILED' };
      }
      handoff = { token: payload.token, userId: u.userId, generation, ownsUI: owns,
        passenger: u.phoneVerified === true && u.activeRole === 'passenger'
          && u.roles.includes('passenger') };
      return resumeLogin();
    };
  }

  async function resumeLogin() {
    const expected = handoff;
    if (!expected || !expected.ownsUI()) return { ok: false, code: 'AUTH_STALE' };
    const result = await reconcile({ uiContinuation: true });
    if (handoff !== expected || !expected.ownsUI()) return { ok: false, code: 'AUTH_STALE' };
    const ok = result.state === 'AUTHENTICATED' && result.user?.userId === expected.userId
      && result.user.activeRole === 'passenger' && result.user.phoneVerified === true
      && expected.passenger && readToken() === expected.token && readUserId() === expected.userId;
    return { ok, user: ok ? result.user : null,
      code: ok ? null : result.error?.code || 'PASSENGER_AUTHORITY_REQUIRED' };
  }

  function passengerConfirmed() {
    return !!handoff && handoff.ownsUI() && handoff.passenger
      && readToken() === handoff.token && readUserId() === handoff.userId
      && snapshot.state === 'AUTHENTICATED' && snapshot.user?.userId === handoff.userId
      && snapshot.user.activeRole === 'passenger' && snapshot.user.phoneVerified === true;
  }

  function finishLogin() {
    if (!passengerConfirmed()) return false;
    handoff = null;
    return true;
  }

  // Credential ownership survives disposal of the OTP screen; its continuation does not.
  function ownsCredential(expected) {
    return expected === handoff && expected.generation === loginSequence
      && readToken() === expected.token && readUserId() === expected.userId;
  }

  function isLoginDetached() {
    return !!handoff && !handoff.ownsUI();
  }

  function finishRecovery() {
    if (!handoff || !ownsCredential(handoff) || snapshot.state !== 'AUTHENTICATED'
        || snapshot.user?.userId !== handoff.userId) return false;
    handoff = null;
    return true;
  }

  async function reconcile({ uiContinuation = false } = {}) {
    const ownSequence = ++sequence;
    // Settle even a transport that ignores AbortSignal. Ownership, not abort
    // timing, decides whether a result can be applied.
    active?.cancel();
    active = null;
    if (!backendEnabled()) {
      publish('LOCAL_DEMO_BOOT');
      return snapshot;
    }
    const expected = handoff;
    const token = readToken();
    if (expected && !ownsCredential(expected)) {
      return fail('AUTH_IDENTITY_MISMATCH');
    }
    if (!token) {
      publish('ANONYMOUS');
      return snapshot;
    }

    const abort = new AbortController();
    let cancel;
    let timer;
    const cancelled = new Promise((resolve) => {
      cancel = () => { abort.abort(); resolve({ kind: 'cancelled' }); };
    });
    const run = { cancel };
    active = run;
    publish('SESSION_RECONCILING');

    try {
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => {
          resolve({ kind: 'timeout' });
          abort.abort();
        }, timeoutMs);
      });
      const request = Promise.resolve().then(() => {
        if (ownSequence !== sequence) return { kind: 'cancelled' };
        return Promise.resolve(requestSession({ signal: abort.signal }))
          .then((payload) => ({ kind: 'response', payload }));
      }).catch((error) => ({ kind: 'error', error }));
      const result = await Promise.race([request, cancelled, timeout]);
      if (ownSequence !== sequence || result.kind === 'cancelled') return snapshot;
      if (token !== readToken() || (expected && !ownsCredential(expected))) return fail('AUTH_IDENTITY_MISMATCH');
      if (uiContinuation && expected && !expected.ownsUI()) return fail('AUTH_UI_STALE');

      if (result.kind === 'response') {
        if (result.payload?.user === null) {
          if (expected) dropAuth();
          publish('ANONYMOUS');
        }
        else {
          const user = confirmedUser(result.payload);
          if (user && expected && user.userId !== expected.userId) fail('AUTH_IDENTITY_MISMATCH');
          else if (user) publish('AUTHENTICATED', user);
          else publish('SESSION_UNKNOWN', null, { code: 'SESSION_PROTOCOL', retryable: true });
        }
      } else {
        const code = result.kind === 'timeout' ? 'SESSION_TIMEOUT'
          : result.error?.code || 'NETWORK';
        // HTTP/protocol errors are not anonymous verdicts. Manual retry remains
        // available and the credential is retained.
        publish('SESSION_UNKNOWN', null, { code, retryable: true });
      }
      return snapshot;
    } finally {
      clearTimeout(timer);
      if (active === run) active = null;
    }
  }

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    reconcile, beginLogin, resumeLogin, passengerConfirmed, finishLogin,
    isLoginDetached, finishRecovery,
  });
}

export function sessionRouteAdmission(snapshot, path, { guestPublic = false } = {}) {
  if (snapshot.state === 'LOCAL_DEMO_BOOT' || snapshot.state === 'AUTHENTICATED') return true;
  if (snapshot.state !== 'ANONYMOUS') return false;
  // Classification comes from router. This admits only a read-only Guest view,
  // never a confirmed identity, grants, readiness, or pending/unknown fallback.
  if (guestPublic) return { guestReadOnly: true, skipWelcome: true };
  if (path === '/welcome') return true;
  // Keep auth entry reachable with contradictory legacy flags; otherwise
  // Welcome's onboarded auto-skip and the welcomeSeen guard can loop.
  if (path === '/onboarding') return { skipWelcome: true };
  return '/onboarding';
}
