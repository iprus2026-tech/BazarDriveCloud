// Boot identity, verified-login handoff and detach leases. Transport stays external.
import { isBackendEnabled } from './api_config.js';
import { getAuthToken, getAuthUserId, setAuth, clearAuth, pinAuthTabUser,
  detachRejectedAuth, isAuthTabRejected, getAuthOwnerVersion, isAuthCandidate, commitAuthCandidate,
  AUTH_CLEAR_FOREIGN } from './auth_token.js';
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
  detachAuth = detachRejectedAuth,
  tabRejected = isAuthTabRejected,
  readOwnerVersion = getAuthOwnerVersion,
  authCandidate = isAuthCandidate,
  commitCandidate = commitAuthCandidate,
  requestSession = getSession,
  pinTabUser = pinAuthTabUser,
  onRejectedSession = () => {},
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
  let rejectedDetachPending = false;
  let bootActorPinned = false;
  let logoutStoragePending = false;
  let logoutContinuationsBlocked = false;

  function makeSnapshot(state, user = null, error = null) {
    return Object.freeze({ state, user, grants: 'UNKNOWN', readiness: 'UNKNOWN',
      error: error ? Object.freeze(error) : null });
  }

  function publish(state, user = null, error = null) {
    if (state === 'AUTHENTICATED' && user?.userId && pinTabUser(user.userId) === false) {
      state = 'SESSION_UNKNOWN';
      user = null;
      error = { code: 'AUTH_IDENTITY_MISMATCH', retryable: true };
    }
    snapshot = makeSnapshot(state, user, error);
    for (const listener of listeners) listener(snapshot);
  }

  function fail(code) {
    publish('SESSION_UNKNOWN', null, { code, retryable: true });
    return snapshot;
  }

  function detachRejectedSession() {
    if (detachAuth() !== true) {
      rejectedDetachPending = true;
      return fail('AUTH_STORAGE_FAILED');
    }
    rejectedDetachPending = false;
    handoffRemovalPending = false;
    bootActorPinned = true;
    // Durable tab detachment precedes projection invalidation and admission.
    onRejectedSession();
    publish('ANONYMOUS');
    return snapshot;
  }

  function retainRemovalOwnership({ token, userId, phone, ownsUI, expectedRole }) {
    const generation = ++loginSequence;
    handoff = {
      token,
      userId,
      phone: phone || null,
      generation,
      ownsUI,
      expectedRole,
      // Cleanup-only ownership never grants route/profile authority.
      authority: false,
    };
    handoffRemovalPending = true;
  }

  // Router ownership + generation defeat A->B->A and competing login responses.
  function beginLogin({ isCurrent = () => true, resetAccount = () => {}, expectedRole = 'passenger' } = {}) {
    logoutStoragePending = false;
    logoutContinuationsBlocked = false;
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
      const verifiedIdentity = u.phoneVerified === true;
      const verifiedAuthority = verifiedIdentity && u.activeRole === authorityRole
        && u.roles.includes(authorityRole);
      // A roleless legacy OTP row still represents a successfully verified identity.
      // Grant acquisition remains #830 policy; this slice must not invent a role,
      // but it also must not discard the authenticated identity and force another OTP.
      if (!verifiedIdentity) {
        return { ok: false, code: 'ROLE_AUTHORITY_REQUIRED', handoffInstalled: false };
      }
      // Crossing an identity boundary must clear the previous account cache
      // before B can ever be persisted. Same-account refresh replaces the
      // record without deleting first, which would emit a transient
      // logout into other tabs and discard their same-account profiles.
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
      }
      if (!owns()) return { ok: false, code: 'AUTH_STALE', handoffInstalled: false };
      if (!writeAuth({ token: payload.token, userId: u.userId, phone })
          || readToken() !== payload.token || readUserId() !== u.userId) {
        const rollback = dropAuth();
        if (rollback === false) {
          retainRemovalOwnership({
            token: payload.token,
            userId: u.userId,
            phone,
            ownsUI: owns,
            expectedRole: authorityRole,
          });
        }
        if (rollback === AUTH_CLEAR_FOREIGN) {
          fail('AUTH_IDENTITY_MISMATCH');
          return { ok: false, code: 'AUTH_STALE', handoffInstalled: false };
        }
        fail('AUTH_STORAGE_FAILED');
        return { ok: false, code: 'AUTH_STORAGE_FAILED', handoffInstalled: false };
      }
      const generation = ++loginSequence;
      handoff = { token: payload.token, userId: u.userId, phone: phone || null,
        ownerVersion: readOwnerVersion(),
        generation, ownsUI: owns, expectedRole: authorityRole, authority: verifiedAuthority };
      handoffRemovalPending = false;
      rejectedDetachPending = false;
      const resumed = await resumeLogin();
      return { ...resumed, handoffInstalled: true };
    };
  }

  async function resumeLogin() {
    const expected = handoff;
    if (logoutContinuationsBlocked || !expected || !expected.ownsUI()) return { ok: false, code: 'AUTH_STALE' };
    const result = await reconcile({ uiContinuation: true });
    if (handoff !== expected || !expected.ownsUI()) return { ok: false, code: 'AUTH_STALE' };
    const ok = authorityConfirmed(expected, { requireUI: true });
    return { ok, user: ok ? result.user : null,
      code: ok ? null : result.error?.code || 'ROLE_AUTHORITY_REQUIRED' };
  }

  function authorityConfirmed(expected, { requireUI = true } = {}) {
    return !logoutContinuationsBlocked && !!expected && expected === handoff && (!requireUI || expected.ownsUI())
      && expected.authority && readToken() === expected.token && readUserId() === expected.userId
      && (expected.ownerVersion || null) === readOwnerVersion()
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
      && readToken() === expected.token && readUserId() === expected.userId
      && (expected.ownerVersion || null) === readOwnerVersion();
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

  function rebindRecoveryOwner(isCurrent) {
    const projection = recoveryProjection();
    if (!projection || typeof isCurrent !== 'function') return null;
    // Explicit Continue transfers only UI ownership. Credential/user/role
    // authority remains the same confirmed handoff.
    handoff.ownsUI = isCurrent;
    return projection;
  }

  function retainAuthenticatedCleanupOwner(isCurrent) {
    if (handoff || typeof isCurrent !== 'function') return false;
    if (snapshot.state !== 'AUTHENTICATED' || !snapshot.user?.userId) return false;
    const token = readToken();
    const userId = readUserId();
    if (!token || userId !== snapshot.user.userId) return false;
    const generation = ++loginSequence;
    handoff = {
      token,
      userId,
      phone: null,
      ownerVersion: readOwnerVersion(),
      generation,
      ownsUI: isCurrent,
      expectedRole: snapshot.user.activeRole,
      // Reload reconstruction exists only so Back/Guest can clean the bearer.
      authority: false,
    };
    handoffRemovalPending = false;
    return true;
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
    rejectedDetachPending = false;
    publish('ANONYMOUS');
    return true;
  }

  function abandonLogin() {
    if (rejectedDetachPending && detachRejectedSession().state !== 'ANONYMOUS') return false;
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

    if (credentialMissing) {
      if (expected.ownerVersion && dropAuth() === false) {
        fail('AUTH_STORAGE_FAILED');
        return false;
      }
      return finishAbandonAsAnonymous();
    }

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
    if (rejectedDetachPending && detachRejectedSession().state !== 'ANONYMOUS') return false;
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
    rejectedDetachPending = false;
    publish('ANONYMOUS');
    return true;
  }

  function adoptAnonymousAfterExternalLogout() {
    if (rejectedDetachPending && detachRejectedSession().state !== 'ANONYMOUS') return false;
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
    rejectedDetachPending = false;
    logoutStoragePending = false;
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
    if (logoutStoragePending) return fail('AUTH_STORAGE_FAILED');
    // Missing getters are not proof that durable tab detachment succeeded.
    if (rejectedDetachPending || (!bootActorPinned && tabRejected())) return detachRejectedSession();
    if (!bootActorPinned) {
      const persistedUserId = readUserId();
      // Pin authenticated OR anonymous boot identity exactly once. A retry
      // cannot downgrade/replace that initial actor after another tab changes storage.
      pinTabUser(persistedUserId || null);
      bootActorPinned = true;
    }
    const expected = handoff;
    const token = readToken();
    const userId = readUserId();
    const ownerVersion = readOwnerVersion();
    const candidate = authCandidate();
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
      // This response rejects the captured request, even if shared auth changed
      // while it was in flight. Detach this tab without touching that record.
      if (result.kind === 'response' && result.payload?.user === null) return detachRejectedSession();
      if (token !== readToken() || userId !== readUserId()
          || ownerVersion !== readOwnerVersion()
          || (expected && !ownsCredential(expected))) return fail('AUTH_IDENTITY_MISMATCH');
      if (uiContinuation && expected && !expected.ownsUI()) return fail('AUTH_UI_STALE');

      if (result.kind === 'response') {
        const user = confirmedUser(result.payload);
        if (user && expected && user.userId !== expected.userId) {
          if (dropAuth() === false) {
            handoffRemovalPending = true;
            fail('AUTH_STORAGE_FAILED');
          } else {
            fail('AUTH_IDENTITY_MISMATCH');
          }
        } else if (user && expected && expected.authority
            && (user.activeRole !== expected.expectedRole
              || user.phoneVerified !== true)) {
          if (dropAuth() === false) {
            handoffRemovalPending = true;
            fail('AUTH_STORAGE_FAILED');
          } else {
            fail('ROLE_AUTHORITY_REQUIRED');
          }
        } else if (user && expected && !expected.authority && user.phoneVerified !== true) {
          if (dropAuth() === false) {
            handoffRemovalPending = true;
            fail('AUTH_STORAGE_FAILED');
          } else {
            fail('ROLE_AUTHORITY_REQUIRED');
          }
        } else if (user) {
          if (ownerVersion && (user.userId !== userId || (candidate && user.phoneVerified !== true)
              || !commitCandidate(ownerVersion) || readOwnerVersion() !== ownerVersion
              || token !== readToken() || userId !== readUserId())) {
            return fail('AUTH_IDENTITY_MISMATCH');
          }
          publish('AUTHENTICATED', user);
        } else publish('SESSION_UNKNOWN', null, { code: 'SESSION_PROTOCOL', retryable: true });
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

  function beginExplicitLogout() {
    logoutContinuationsBlocked = true;
    const generation = ++loginAttemptSequence;
    ++sequence;
    active?.cancel();
    active = null;
    return Object.freeze({ isCurrent: () => generation === loginAttemptSequence });
  }

  function failExplicitLogout(lease) {
    if (!lease.isCurrent()) return false;
    logoutStoragePending = true;
    fail('AUTH_STORAGE_FAILED');
    return true;
  }

  function beginOnboardingDetach(auth) {
    const expected = handoff;
    const generation = loginSequence;
    const valid = !auth.token || !expected || (auth.token === expected.token
      && auth.userId === expected.userId
      && auth.ownerVersion === (expected.ownerVersion || null));
    const lease = beginExplicitLogout();
    return Object.freeze({ isCurrent: () => valid && lease.isCurrent()
      && handoff === expected && loginSequence === generation });
  }

  function commitOnboardingDetach(lease) {
    if (!lease.isCurrent()) return false;
    return adoptAnonymousAfterExternalLogout();
  }

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    reconcile, beginLogin, resumeLogin, roleConfirmed, passengerConfirmed, finishLogin,
    isLoginDetached, recoveryConfirmed, recoveryProjection, rebindRecoveryOwner,
    retainAuthenticatedCleanupOwner, finishRecovery,
    markLoginStale, abandonLogin, enterGuest, adoptAnonymousAfterExternalLogout,
    beginExplicitLogout, failExplicitLogout,
    beginOnboardingDetach, commitOnboardingDetach,
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
