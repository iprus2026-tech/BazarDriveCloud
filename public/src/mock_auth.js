// BD-AUTH-BOUNDARY-01 — Centralized mock logout / local-reset boundary.
//
// There is no real auth or backend in this prototype: a "logout" just resets
// the local mock user and clears any locally persisted artefacts that would
// otherwise leak between users on the same browser/device (ride history,
// passenger trip-demo mode, etc.).
//
// All callsites that previously invoked `user.reset()` directly as part of a
// logout / profile-reset / account-switch flow must go through one of the
// helpers in this module, so a single place owns "what does logging out
// actually clear?". Adding a new local artefact that should be wiped on
// logout means editing this file, not every screen that has a logout button.

import { user } from './state.js';
import { clearRideHistory } from './ride_history.js';
import { go } from './router.js';

const TRIP_DEMO_KEY = 'profileTripDemo';

// Drops the passenger profile trip-demo override. Safe to call even when
// no override is set (acts as a no-op). Included in the logout boundary so
// a stale demo value cannot bleed into the next user's profile screen.
function clearTripDemoMode() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(TRIP_DEMO_KEY);
  } catch {
    // storage unavailable — fail soft.
  }
}

// Clears all locally persisted user-scoped state without navigating. Use this
// for non-logout local resets (account switch staging, profile wipe) that
// still need the same cleanup guarantees.
export function resetLocalSession() {
  clearTripDemoMode();
  clearRideHistory();
  user.reset();
}

// Full mock logout: clears local user-scoped state and navigates to the
// welcome screen. This is the single boundary that passenger and driver
// logout handlers should call.
export function performLocalLogout() {
  resetLocalSession();
  go('/welcome');
}
