// Shared server-first detach. Late/unaccepted OTP and account switch are deferred.
import { isBackendEnabled } from './api_config.js';
import { logoutSession } from './api_client.js';
import { getAuthToken, getAuthUserId, getAuthOwnerVersion,
  isLogoutAuthCurrent } from './auth_token.js';
import { performLocalLogout } from './mock_auth.js';

export function createAuthLogout({
  backendEnabled = isBackendEnabled,
  captureAuth = () => Object.freeze({ token: getAuthToken(),
    userId: getAuthUserId(), ownerVersion: getAuthOwnerVersion() }),
  authCurrent = isLogoutAuthCurrent,
  beginLogout = () => ({ isCurrent: () => true }),
  requestLogout = logoutSession,
  localLogout = performLocalLogout,
  onLocalFailure = () => {},
  timeoutMs = 10000,
  retainFailures = false,
} = {}) {
  let active = null;
  let epoch = 0;
  let repair = null;
  let snapshot = Object.freeze({ phase: 'idle', error: null });

  function failure(code, phase = 'error') {
    const error = Object.freeze({ code, retryable: true });
    snapshot = Object.freeze({ phase, error });
    return Object.freeze({ ok: false, ...error });
  }

  function current(run) {
    return run.epoch === epoch && run.controller.isCurrent() && authCurrent(run.auth);
  }

  function failRun(run, code) {
    if (retainFailures && current(run)) repair = run;
    return failure(code);
  }

  async function settle(run, isCurrent) {
    if (!current(run)) return failure('AUTH_STALE');
    if (run.auth.token && !run.revoked) {
      const abort = new AbortController();
      let timer;
      try {
        const timeout = new Promise(resolve => {
          timer = setTimeout(() => {
            resolve({ code: 'LOGOUT_TIMEOUT' });
            abort.abort();
          }, timeoutMs);
        });
        // No await between ownership verification and normal API bearer capture.
        const request = Promise.resolve(requestLogout({ signal: abort.signal }))
          .then(payload => ({ payload }), error => ({ code: error?.code || 'NETWORK' }));
        const result = await Promise.race([request, timeout]);
        if (!current(run)) return failure('AUTH_STALE');
        if (result.code) return failRun(run, result.code);
        const p = result.payload;
        if (!p || typeof p !== 'object' || Array.isArray(p) || p.ok !== true) {
          return failRun(run, 'SESSION_PROTOCOL');
        }
        run.revoked = true;
      } catch (error) {
        return failRun(run, current(run) ? error?.code || 'NETWORK' : 'AUTH_STALE');
      } finally {
        clearTimeout(timer);
      }
    }
    if (!current(run)) return failure('AUTH_STALE');
    let completed = false;
    try {
      completed = localLogout({ expectedAuth: run.auth,
        isCurrent: () => current(run), navigate: isCurrent,
        controller: run.controller, intent: run.intent });
    } catch {}
    if (completed !== true) {
      if (!run.controller.isCurrent() || !authCurrent(run.auth)) return failure('AUTH_STALE');
      // A committed revoke is not rolled back. Retry only the captured detach;
      // never capture another actor through getters blocked by removal failure.
      repair = run;
      const result = failure('AUTH_STORAGE_FAILED', 'local-error');
      onLocalFailure(run.controller);
      return result;
    }
    repair = null;
    snapshot = Object.freeze({ phase: 'success', error: null });
    return Object.freeze({ ok: true });
  }

  function logout({ isCurrent = () => true, intent = null } = {}) {
    if (active) return active;
    if (!backendEnabled()) {
      const ok = localLogout() === true;
      return Promise.resolve(ok ? { ok: true } : failure('AUTH_STORAGE_FAILED'));
    }
    let run = repair;
    if (run && !current(run)) {
      repair = null;
      return Promise.resolve(failure('AUTH_STALE'));
    }
    if (run && intent !== null && run.intent !== intent) {
      return Promise.resolve({ ok: false, code: 'AUTH_DETACH_PENDING', retryable: true });
    }
    if (!run) {
      const auth = captureAuth();
      run = { auth, controller: beginLogout(auth), epoch: ++epoch, revoked: false, intent };
    }
    snapshot = Object.freeze({ phase: 'pending', error: null });
    active = Promise.resolve().then(() => settle(run, isCurrent))
      .finally(() => { active = null; });
    return active;
  }

  return Object.freeze({ logout, getSnapshot: () => snapshot });
}

// Screen adapter owns feedback only; the injected coordinator owns lifecycle.
export function createLogoutControl({ logout, isCurrent = () => true, onState = () => {} }) {
  let pending = false;
  let confirmed = false;
  async function submit() {
    if (pending || !isCurrent()) return;
    if (!confirmed) {
      confirmed = true;
      onState({ phase: 'confirmed' });
      return;
    }
    pending = true;
    onState({ phase: 'pending' });
    let result;
    try { result = await logout({ isCurrent }); }
    catch { result = { ok: false, code: 'NETWORK' }; }
    if (!isCurrent()) return;
    pending = false;
    onState(result?.ok === true || result === true
      ? { phase: 'success' } : { phase: 'error', code: result?.code });
    return result;
  }
  return Object.freeze({ submit });
}
