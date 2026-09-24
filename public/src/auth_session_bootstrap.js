// BD-FIRST-LOGIN-01B-A: boot identity only. No grants, readiness, persistent
// projection, credential cleanup, or logout/Guest/account-boundary integration.
import { isBackendEnabled } from './api_config.js';
import { getAuthToken } from './auth_token.js';
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
  requestSession = getSession,
  timeoutMs = 10000,
} = {}) {
  let sequence = 0;
  let active = null;
  const listeners = new Set();
  let snapshot = makeSnapshot('BOOT');

  function makeSnapshot(state, user = null, error = null) {
    return Object.freeze({ state, user, grants: 'UNKNOWN', readiness: 'UNKNOWN',
      error: error ? Object.freeze(error) : null });
  }

  function publish(state, user = null, error = null) {
    snapshot = makeSnapshot(state, user, error);
    for (const listener of listeners) listener(snapshot);
  }

  async function reconcile() {
    const ownSequence = ++sequence;
    // Settle even a transport that ignores AbortSignal. Ownership, not abort
    // timing, decides whether a result can be applied.
    active?.cancel();
    active = null;
    if (!backendEnabled()) {
      publish('LOCAL_DEMO_BOOT');
      return snapshot;
    }
    if (!readToken()) {
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

      if (result.kind === 'response') {
        if (result.payload?.user === null) publish('ANONYMOUS');
        else {
          const user = confirmedUser(result.payload);
          if (user) publish('AUTHENTICATED', user);
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
    reconcile,
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
