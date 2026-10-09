// BD-AUTH-BOUNDARY-01 — Centralized mock logout / local-reset boundary.
//
// This boundary stays local; auth_logout.js settles explicit backend revoke
// before calling it. Local cleanup resets the user and persisted artefacts that would
// otherwise leak between users on the same browser/device (ride history,
// active ride / session state, trip-response drafts, demo overrides, …).
//
// All callsites that previously invoked `user.reset()` directly as part of a
// logout / profile-reset / account-switch flow must go through one of the
// helpers in this module. The audit of what gets cleared lives in
// storage_boundary.js — adding a new user-scoped key means editing the
// boundary module's `clearUserScopedStorage()` and exposing a clearXxx()
// from the owning module, not every screen that has a logout button.
//
// Local account caches remain intentionally "clear-on-boundary":
// per-identity scoped history can be re-introduced once we have a stable
// user id to scope keys under.

import { user } from './state.js';
import { clearUserScopedStorage, clearUserScopedCachesPreservingAuth,
  AUTH_CLEAR_FOREIGN } from './storage_boundary.js';
export { AUTH_CLEAR_FOREIGN };
import { clearSmokeRole } from './smoke_role.js';
import { go } from './router.js';

let localLogoutObserver = null;

export function setLocalLogoutObserver(observer) {
  localLogoutObserver = typeof observer === 'function' ? observer : null;
}

// Clears all locally persisted user-scoped state without navigating. Use this
// for non-logout local resets (account switch staging, profile wipe) that
// still need the same cleanup guarantees.
// BD-ROLE-05 — also clear the per-tab role override so a stale getSmokeRole()
// value cannot outlive the user that set it.
export function resetLocalSession({ allowForeignDetach = false,
  clearAccountStateOnForeignDetach = false, expectedAuth } = {}) {
  const cleared = clearUserScopedStorage({ expectedAuth });
  if (cleared === false) return false;
  clearSmokeRole();
  if (cleared === AUTH_CLEAR_FOREIGN) {
    if (!allowForeignDetach) return false;
    if (clearAccountStateOnForeignDetach) {
      clearUserScopedCachesPreservingAuth();
      user.reset();
    } else user.resetCacheOnly();
    return AUTH_CLEAR_FOREIGN;
  }
  user.reset();
  return true;
}

// Full mock logout: clears local user-scoped state and navigates to the
// welcome screen. This is the single boundary that passenger and driver
// logout handlers should call.
export function performLocalLogout({ expectedAuth, isCurrent = () => true,
  navigate = () => true } = {}) {
  if (!isCurrent()) return false;
  if (!resetLocalSession({ allowForeignDetach: true, expectedAuth })) return false;
  const shouldNavigate = navigate();
  if (localLogoutObserver && localLogoutObserver() === false) return false;
  if (shouldNavigate) go('/welcome');
  return true;
}
