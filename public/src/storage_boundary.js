// BD-AUTH-BOUNDARY-01 — Local storage boundary for user-scoped data.
//
// There is no real backend / auth in this prototype. Multiple "users"
// (guest, passenger, driver, future authenticated identity) all share the
// same browser localStorage. Without a boundary, completed rides, active
// trip state, in-flight chat threads and user-authored posts would leak
// across identities when a profile is reset or a local logout happens.
//
// This module owns the authoritative audit of user-scoped keys and the
// single clear-on-boundary entry point. Once real authentication is in
// place we can revisit this and switch to per-identity scoped storage
// (e.g. `bazardrive.<userId>.ride_history.v1`) instead of wiping on
// boundary crossings — until then, the safer default is to drop the
// state.
//
// Audited keys (writers live in their owning module; only `clearXxx`
// helpers are imported here so this file does not have to know each
// storage layout):
//
//   bazardrive.ride_history.v1      → ride_history.js
//   bazardrive.favorite_routes.v1   → favorite_routes.js
//   bazardrive.active_ride.v1       → ride_state.js
//   bazardrive.chat.v1              → screens/chat.js (also written by
//                                     screens/active_ride.js)
//   bazardrive.responses.v1         → screens/respond.js, screens/chat.js
//   bazardrive.respond.v1           → screens/respond.js
//   bazardrive.trip_confirmation.v1 → screens/trip_confirmation.js,
//                                     screens/chat.js
//   bazardrive.driver_handoff_snapshot.v1
//                                   → screens/driver_handoff_snapshot.js
//                                     (driver-side confirmed handoff
//                                     pin written by trip_confirmation
//                                     before /active-ride?role=driver)
//   bazardrive.draft.v2             → screens/composer.js (may contain
//                                     trip post draft: from/to/when/price)
//   bazardrive.repeat_route.v1      → repeat_route.js (one-time prefill of a
//                                     prior ride's route into the composer)
//   bazardrive.myposts.v1           → mock_api.js
//   profileTripDemo                 → passenger Profile demo override
//
// Intentionally NOT cleared (not user-scoped):
//   bazardrive.user.v1     — owned by state.js; handled by user.reset()
//                            from the calling auth flow.
//   bazardrive.posts.v1    — global mock feed cache shared by all local
//                            identities; clearing it would also drop
//                            seeded sample posts.
//   bazardrive.map_prefs.v1 — device-level map preferences, identity
//                             agnostic.

import { clearRideHistory } from './ride_history.js';
import { clearFavoriteRoutes } from './favorite_routes.js';
import { clearActiveRideStore } from './ride_state.js';
import {
  clearChatStore,
  clearChatResponses,
  clearTripConfirmationMap,
} from './screens/chat.js';
import { clearRespondStore } from './screens/respond.js';
import { clearDriverHandoffSnapshotStore } from './screens/driver_handoff_snapshot.js';
import { clearComposerDraft } from './screens/composer.js';
import { clearRepeatRouteDraft } from './repeat_route.js';
import { clearMyPostsStore } from './mock_api.js';

const TRIP_DEMO_KEY = 'profileTripDemo';

function clearTripDemoMode() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(TRIP_DEMO_KEY);
  } catch {
    // storage unavailable — fail soft.
  }
}

// Clears every user-scoped local storage artefact in one call. Each
// underlying clearXxx() helper is independently fail-soft (try/catch on
// localStorage access) so partial storage failures cannot leave the
// boundary half-applied.
export function clearUserScopedStorage() {
  clearRideHistory();
  clearFavoriteRoutes();
  clearActiveRideStore();
  clearChatStore();
  clearChatResponses();
  clearTripConfirmationMap();
  clearRespondStore();
  clearDriverHandoffSnapshotStore();
  clearComposerDraft();
  clearRepeatRouteDraft();
  clearMyPostsStore();
  clearTripDemoMode();
}
