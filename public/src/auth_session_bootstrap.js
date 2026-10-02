// Boot identity and verified-login handoff. No logout/revoke or driver enrollment.
import { isBackendEnabled } from './api_config.js';
import { getAuthToken, getAuthUserId, setAuth, clearAuth, pinAuthTabUser } from './auth_token.js';
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
  pinTabUser = pinAuthTabUser,
  timeoutMs = 10000,
} = {}) {
  let sequence = 0;
  let active = null;
  const listeners = new Set();
  let snapshot = makeSnapshot('BOOT');
  let loginSequence = 0;
  let loginAttemptSequence = 0;
  let handoff = null;
  let handoffRemovalPending = false;

  function makeSnapshot(state, user = null, error = null) {
    return Object.freeze({ state, user, grants: 'UNKNOWN', readiness: 'UNKNOWN',
      error: error ? Object.freeze(error) : null });
  }

  function publish(state, user = null, error = null) {
    if (state === 'AUTHENTICATED' && user?.userId) pinTabUser(user.userId);
    snapshot = makeSnapshot(state, user, error);
    for (const listener of listeners) listener(snapshot);
  }

  function fail(code) {
    publish('SESSION_UNKNOWN', null, { code, retryable: true });
    return snapshot;
  }

  // Router ownership + generation defeat A->B->A and competing login responses.
  function beginLogin({ isCurrent = () => true, resetAccount = () => {}, expectedRole = 'passenger' } = {}) {
    const authorityRole = ['passenger', 'driver'].includes(expectedRole) ? expectedRole : null;
    const attemptGeneration = ++loginAttemptSequence;
    ++sequence;
    active?.cancel();
    active = null;
    // Keep the currently committed handoff until this replacement OTP has
    // actually been accepted and persisted. A failed request must not orphan
    // the bearer that an eventual Back/Guest boundary still owns.
    const priorToken = readToken();
    const priorUserId = readUserId();
    const owns = () => attemptGeneration === loginAttemptSequence && isCurrent();
    return async (payload, phone) => {
      if (!owns() || readToken() !== priorToken || readUserId() !== priorUserId) {
        return { ok: false, code: 'AUTH_STALE', handoffInstalled: false };
      }
      const u = payload?.user;
      if (!authorityRole) {
        fail('SESSION_PROTOCOL');
        return { ok: false, code: 'SESSION_PROTOCOL', handoffInstalled: false };
      }
      if (!payload || typeof payload.token !== 'string' || !payload.token.trim()
          || !u || typeof u.userId !== 'string' || !u.userId.trim()
          || ![null, 'passenger', 'driver'].includes(u.activeRole)
          || typeof u.phoneVerified !== 'boolean' || !Array.isArray(u.roles)
          || u.roles.some(role => typeof role !== 'string')) {
        fail('SESSION_PROTOCOL');
        return { ok: false, code: 'SESSION_PROTOCOL', handoffInstalled: false };
      }
      const verifiedAuthority = u.phoneVerified === true && u.activeRole === authorityRole
        && u.roles.includes(authorityRole);
      // A structurally valid OTP response is not enough to replace the current actor.
      // Validate the selected authority BEFORE clearing the old credential/profile.
      if (!verifiedAuthority) return { ok: false, code: 'ROLE_AUTHORITY_REQUIRED', handoffInstalled: false };
      // Crossing an identity boundary must clear the previous account cache
      // before B can ever be persisted. Same-account replacement still has to
      // prove the old bearer was actually removed.
      if (!priorUserId || priorUserId !== u.userId) {
        const resetOk = resetAccount({
          accountSwitch: Boolean(priorUserId && priorUserId !== u.userId),
          priorUserId,
          nextUserId: u.userId,
        });
        if (resetOk === false) {
          fail('AUTH_STORAGE_FAILED');
          return { ok: false, code: 'AUTH_STORAGE_FAILED', handoffInstalled: false };
        }
      } else if (dropAuth() === false) {
        fail('AUTH_STORAGE_FAILED');
        return { ok: false, code: 'AUTH_STORAGE_FAILED', handoffInstalled: false };
      }
      if (!owns()) return { ok: false, code: 'AUTH_STALE', handoffInstalled: false };
      if (!writeAuth({ token: payload.token, userId: u.userId, phone })
          || readToken() !== payload.token || readUserId() !== u.userId) {
        dropAuth();
        fail('AUTH_STORAGE_FAILED');
        return { ok: false, code: 'AUTH_STORAGE_FAILED', handoffInstalled: false };
      }
      const generation = ++loginSequence;
      handoff = { token: payload.token, userId: u.userId, phone: phone || null,
        generation, ownsUI: owns, expectedRole: authorityRole, authority: true };
      handoffRemovalPending = false;
      const resumed = await resumeLogin();
      return { ...resumed, handoffInstalled: true };
    };
  }

  async function resumeLogin() {
    const expected = handoff;
    if (!expected || !expected.ownsUI()) return { ok: false, code: 'AUTH_STALE' };
    const result = await reconcile({ uiContinuation: true });
    if (handoff !== expected || !expected.ownsUI()) return { ok: false, code: 'AUTH_STALE' };
    const ok = authorityConfirmed(expected, { requireUI: true });
    return { ok, user: ok ? result.user : null,
      code: ok ? null : result.error?.code || 'ROLE_AUTHORITY_REQUIRED' };
  }

  function authorityConfirmed(expected, { requireUI = true } = {}) {
    return !!expected && expected === handoff && (!requireUI || expected.ownsUI())
      && expected.authority && readToken() === expected.token && readUserId() === expected.userId
      && snapshot.state === 'AUTHENTICATED' && snapshot.user?.userId === expected.userId
      && snapshot.user.activeRole === expected.expectedRole && snapshot.user.phoneVerified === true;
  }

  function roleConfirmed(role) {
    return !!handoff && handoff.expectedRole === role
      && authorityConfirmed(handoff, { requireUI: true });
  }

  function passengerConfirmed() {
    return roleConfirmed('passenger');
  }

  function finishLogin() {
    if (!handoff || !authorityConfirmed(handoff, { requireUI: true })) return false;
    handoff = null;
    handoffRemovalPending = false;
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

  function recoveryConfirmed() {
    return !!handoff && !handoff.ownsUI()
      && authorityConfirmed(handoff, { requireUI: false });
  }

  function recoveryProjection() {
    if (!recoveryConfirmed()) return null;
    return Object.freeze({
      user: snapshot.user,
      phone: handoff.phone || null,
      expectedRole: handoff.expectedRole,
    });
  }

  function finishRecovery(commit) {
    const projection = recoveryProjection();
    if (!projection) return false;
    if (typeof commit === 'function') commit(projection);
    handoff = null;
    handoffRemovalPending = false;
    return true;
  }

  // A mounted onboarding screen can discover that its saved credential no longer
  // matches the confirmed handoff (for example another tab replaced localStorage).
  // Keep the handoff pin so app-level retry cannot adopt that unrelated actor;
  // the next explicit OTP beginLogin() supersedes it.
  function markLoginStale() {
    if (!handoff) return snapshot;
    active?.cancel();
    active = null;
    return fail('AUTH_IDENTITY_MISMATCH');
  }

  function finishAbandonAsAnonymous() {
    ++loginAttemptSequence;
    ++loginSequence;
    ++sequence;
    active?.cancel();
    active = null;
    handoff = null;
    handoffRemovalPending = false;
    publish('ANONYMOUS');
    return true;
  }

  function abandonLogin() {
    // A failed removal keeps the handoff pinned so Back can safely retry.
    const expected = handoff;
    if (!expected) return false;

    if (handoffRemovalPending) {
      if (dropAuth() === false) {
        fail('AUTH_STORAGE_FAILED');
        return false;
      }
      return finishAbandonAsAnonymous();
    }

    const currentToken = readToken();
    const currentUserId = readUserId();
    const credentialOwned = expected.generation === loginSequence
      && currentToken === expected.token && currentUserId === expected.userId;
    const credentialMissing = currentToken === null && currentUserId === null;

    if (credentialMissing) return finishAbandonAsAnonymous();

    if (!credentialOwned) {
      ++loginAttemptSequence;
      ++loginSequence;
      ++sequence;
      active?.cancel();
      active = null;
      handoff = null;
      handoffRemovalPending = false;
      fail('AUTH_IDENTITY_MISMATCH');
      return false;
    }
    if (dropAuth() === false) {
      handoffRemovalPending = true;
      fail('AUTH_STORAGE_FAILED');
      return false;
    }
    return finishAbandonAsAnonymous();
  }

  function enterGuest() {
    // Explicit Guest selection is an actor-detach boundary, not merely a
    // handoff cancellation. Do not discard handoff ownership until removal
    // is confirmed, so a failed storage operation stays retryable.
    if (dropAuth() === false) {
      handoffRemovalPending = handoff !== null;
      fail('AUTH_STORAGE_FAILED');
      return false;
    }
    ++loginAttemptSequence;
    ++loginSequence;
    ++sequence;
    active?.cancel();
    active = null;
    handoff = null;
    handoffRemovalPending = false;
    publish('ANONYMOUS');
    return true;
  }

  function adoptAnonymousAfterExternalLogout() {
    if (readToken() !== null || readUserId() !== null) {
      fail('AUTH_STORAGE_FAILED');
      return false;
    }
    ++loginAttemptSequence;
    ++loginSequence;
    ++sequence;
    active?.cancel();
    active = null;
    handoff = null;
    handoffRemovalPending = false;
    publish('ANONYMOUS');
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
    const persistedUserId = readUserId();
    if (persistedUserId) pinTabUser(persistedUserId);
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
          if (expected && dropAuth() === false) {
            handoffRemovalPending = true;
            fail('AUTH_STORAGE_FAILED');
          } else {
            publish('ANONYMOUS');
          }
        }
        else {
          const user = confirmedUser(result.payload);
          if (user && expected && user.userId !== expected.userId) {
            if (dropAuth() === false) {
              handoffRemovalPending = true;
              fail('AUTH_STORAGE_FAILED');
            } else {
              fail('AUTH_IDENTITY_MISMATCH');
            }
          } else if (user && expected
              && (!expected.authority || user.activeRole !== expected.expectedRole
                || user.phoneVerified !== true)) {
            if (dropAuth() === false) {
              handoffRemovalPending = true;
              fail('AUTH_STORAGE_FAILED');
            } else {
              fail('ROLE_AUTHORITY_REQUIRED');
            }
          } else if (user) publish('AUTHENTICATED', user);
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
    reconcile, beginLogin, resumeLogin, roleConfirmed, passengerConfirmed, finishLogin,
    isLoginDetached, recoveryConfirmed, recoveryProjection, finishRecovery,
    markLoginStale, abandonLogin, enterGuest, adoptAnonymousAfterExternalLogout,
    hasUncommittedLogin: () => handoff !== null,
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
