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
//   bazardrive.auth.v1              → auth_token.js (clearAuth() — the bearer-token session, R17)
//   bazardrive.ride_history.v1      → ride_history.js
//   bazardrive.favorite_routes.v1   → favorite_routes.js (clearFavoriteRoutes()
//                                     also clears
//                                     bazardrive.favorite_route_notice.v1)
//   bazardrive.active_ride.v1       → ride_state.js
//   bazardrive.chat.v1              → screens/chat.js (also written by
//                                     screens/active_ride.js) and
//                                     daily_communication_store.js under
//                                     __daily_communication_threads__
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
//   bazardrive.route_draft.v1       → screens/route_picker.js (passenger
//                                     pickup/dropoff draft for /route-picker)
//   bazardrive.order_form.v1        → screens/order_map_draft.js (BD-MAP-05
//                                     pending OrderMapDraft form: mode,
//                                     date, time, price, comment, fingerprint)
//   bazardrive.ride_orders.v1       → mock_api.js (BD-MAP-05 locally
//                                     published mock passenger orders)
//   bazardrive.driver_receipts.v1   → mock_api.js (BD-RIDE-HISTORY-D-01
//                                     canonical driver completed-ride
//                                     receipts read by history / payouts /
//                                     the /receipt screen)
//   bazardrive.driver_offers.v1     → driver_offer_store.js
//                                     (BD-ORDER-DETAIL-01D-1 local
//                                     DriverOffer store: status 'sent' or
//                                     'withdrawn', keyed by orderId +
//                                     driverId). clearDriverOfferStore() also
//                                     clears bazardrive.order_overlay.v1 (the
//                                     Order Detail 01D-2A passenger-selection
//                                     overlay).
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
//
// Intentionally NOT cleared (dev/test artefacts, not user data):
//   bazardrive.debug.publish — dev-only publish debug-trail toggle
//                              (screens/order_map_draft.js), opt-in via
//                              localStorage; never carries user data.
//   bazardrive.smoke_role.v1 — per-tab role test override in sessionStorage
//                              (smoke_role.js); ephemeral, not localStorage.

import { clearRideHistory } from './ride_history.js';
import { clearFavoriteRoutes } from './favorite_routes.js';
import { clearActiveRideStore } from './ride_state.js';
import {
  clearChatStore,
  clearChatResponses,
  clearTripConfirmationMap,
} from './screens/chat.js';
import { clearDailyCommunicationStore } from './daily_communication_store.js';
import { clearRespondStore } from './screens/respond.js';
import { clearDriverHandoffSnapshotStore } from './screens/driver_handoff_snapshot.js';
import { clearComposerDraft } from './screens/composer.js';
import { clearRepeatRouteDraft } from './repeat_route.js';
import { clearRouteDraftStore } from './screens/route_picker.js';
import { clearOrderFormDraftStore } from './screens/order_map_draft.js';
import {
  clearMyPostsStore,
  clearRideOrdersStore,
  clearDriverReceiptsStore,
} from './mock_api.js';
import { clearDriverOfferStore } from './driver_offer_store.js';
import { clearAuth } from './auth_token.js';

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
  clearDailyCommunicationStore();
  clearChatResponses();
  clearTripConfirmationMap();
  clearRespondStore();
  clearDriverHandoffSnapshotStore();
  clearComposerDraft();
  clearRepeatRouteDraft();
  clearRouteDraftStore();
  clearOrderFormDraftStore();
  clearRideOrdersStore();
  clearDriverReceiptsStore();
  clearMyPostsStore();
  clearDriverOfferStore();
  clearAuth();
  clearTripDemoMode();
}
