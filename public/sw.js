// v249 (R06 of #784): the precached ./src/ride_state.js changed (additive STATUS_TIMESTAMP_FIELD
// export), so installed clients must refresh it (Codex #792). R06 merges before R13's reserved tail,
// so it takes the next monotonic version; R14/R15/R16 re-sequence to v250/v251/v252.
// v253 (CUT-4 of #784): precached respond.js / responses.js / mock_api.js changed (offer→select seam).
// v254 (CUT-5 of #784): precached active_ride.js / active_ride_passenger.js / mock_api.js changed
// (ride-state READ + status WRITE + realtime POLL seam).
// v255 (CUT-6 of #784): precached mock_api.js / trip_receipt.js / profile.js changed
// (receipt/history READ + receipt WRITE seam, R08).
// v256 (driver handoff of #784): precached respond.js / mock_api.js changed (driver offer→accepted
// active-ride handoff — the /respond success overlay polls trip_<orderId> and hands off to active-ride).
// v257 (BD-OPS R2): precached ./src/ops/templates/audit_recipe_template.js changed (added the #784
// backend-seam / dark-cutover audit dimension) — bump so /ops/screens refreshes it (Codex #806).
// v258 (BD-OPS R1+R5): precached ops_registry.js + audit_recipe_template.js changed (per-screen
// backend-cutover map: backendState/backendContract, woven data-driven into the audit dimension).
// v259 (BD-MAP-FOUND-01 #805): precached mapbox_config.js + mapbox_loader.js changed (real dark Mapbox
// token surface + lazy vendored-SDK loader; inert until a token is set). The vendored lib is NOT precached.
// v260 (BD-MAP-RENDER-MAP #805): precached map.js changed (DEFAULT state hydrates a real Mapbox map over
// the placeholder when a token is set; dark/no-token path unchanged).
// v261 (BD-MAP-ACTIVATE #805): precached index.html changed — committed the URL-restricted bd-mapbox-token
// meta, flipping the Mapbox seam ON in prod (/map renders a real map). Installed clients must refresh.
// v262 (BD-CLOUD-DESIGN-LOADING-02A #866): precached responses.js + cloud.css changed (persistent
// Responses shell, four guarded read states, deterministic fixtures, and structural skeleton).
// v263 (BD-CLOUD-DESIGN-LOADING-02B #868): precached driver_map.js + cloud.css changed (stable
// Driver Map shell, four guarded nearby-order read states, fixtures, and structural skeleton).
// v264 (BD-CLOUD-DESIGN-LOADING-02B repair #869): precached driver_map.js changed (effective-role
// settlement/accept guard and bounded nearby-order read timeout).
// v265 (BD-CLOUD-DESIGN-LOADING-02B cancellation repair #869): precached driver_map.js +
// mock_api.js changed (operation-scoped abort, teardown/epoch/retry cleanup, signal propagation).
// v266 (BD-CLOUD-DESIGN-LOADING-02C #870): precached chat.js + cloud.css changed (honest
// message read states, deterministic fixtures, bounded cancellation, and bubble skeleton).
// v267 (BD-CLOUD-DESIGN-LOADING-02D #872): precached active_ride_passenger.js,
// mock_api.js + cloud.css changed (passenger ride read states, fixture isolation and cancellable poll).
// v268 (BD-CLOUD-DESIGN-LOADING-02D review repair #873): precached active_ride.js +
// active_ride_passenger.js changed (outer fixture gate, local fallback, empty/safety fixture isolation).
// v269 (BD-CLOUD-DESIGN-LOADING-02D second review repair #873): precached active_ride_passenger.js
// changed (non-blocking local refresh, recovery loop, unavailable-map isolation, fixture retry, scoped busy state).
// v270 (BD-CLOUD-DESIGN-LOADING-02D third review repair #873): precached active_ride_passenger.js
// changed (bounded poll, honest 404 empty, retryable recovery filter, stable loading announcement).
// v271 (BD-CLOUD-DESIGN-LOADING-02D fourth review repair #873): precached active_ride_passenger.js
// changed (retryable read/write intent separation and built-in demo 404 fallback).
// v272 (BD-CLOUD-DESIGN-LOADING-02D fifth review repair #873): precached active_ride_passenger.js
// changed (auth mutation gate and focus-safe background recovery settlement).
// v273 (BD-CLOUD-DESIGN-LOADING-02D sixth review repair #873): precached active_ride_passenger.js
// changed (deferred forward-status replay and permanent read-failure mutation gate).
// v274 (BD-CLOUD-DESIGN-LOADING-02D seventh review repair #873): precached active_ride_passenger.js
// changed (ownership settlement gate and focus-safe in-place recovery field refresh).
// v275 (BD-CLOUD-DESIGN-LOADING-02D eighth review repair #873): precached active_ride_passenger.js
// changed (recovery settlement refreshes the existing map from authoritative ride/route data).
const VERSION    = 'v275';
const CACHE_NAME = `bazardrive-${VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/cloud.css',
  './styles/map_shell_foundation.css',
  './styles/driver_sheets.css',
  './styles/route_picker.css',
  './styles/route_picker_layout_fix.css',
  './styles/route_preview.css',
  './styles/order_map_draft.css',
  './styles/daily_communication.css',
  './src/app.js',
  './src/app_error_overlay.js',
  './src/app_connection_status.js',
  './src/app_error_triggers.js',
  './src/data_layer.js',
  './src/router.js',
  './src/state.js',
  './src/smoke_role.js',
  './src/util.js',
  './src/overlay.js',
  './src/storage_boundary.js',
  './src/mock_auth.js',
  './src/api_config.js',
  './src/api_client.js',
  './src/auth_token.js',
  './src/mock_api.js',
  './src/sw-update.js',
  './src/daily_communication_store.js',
  './src/screens/welcome.js',
  './src/screens/feed.js',
  './src/screens/map.js',
  './src/screens/location_permission.js',
  './src/screens/driver_map.js',
  './src/screens/route_picker.js',
  './src/screens/route_preview.js',
  './src/screens/order_map_draft.js',
  './src/screens/rules.js',
  './src/screens/profile.js',
  './src/screens/onboarding.js',
  './src/screens/composer.js',
  './src/screens/respond.js',
  './src/screens/chat.js',
  './src/screens/active_ride.js',
  './src/screens/active_ride_driver_sheets.js',
  './src/screens/active_ride_driver_noshow.js',
  './src/screens/active_ride_passenger.js',
  './src/screens/active_ride_passenger_sheets.js',
  './src/screens/responses.js',
  './src/screens/trip_confirmation.js',
  './src/screens/trip_confirmation_handoff.js',
  './src/screens/driver_handoff_snapshot.js',
  './src/screens/post_detail.js',
  './src/screens/inbox.js',
  './src/screens/daily_communication.js',
  './src/screens/trip_receipt.js',
  './src/screens/order_detail.js',
  './src/screens/settings.js',
  './src/screens/ops_screens.js',
  './src/ops/ops_registry.js',
  './src/ops/ops_mel_store.js',
  './src/ops/blast_radius.js',
  './src/ops/templates/cloud_design_prompt_template.js',
  './src/ops/templates/github_issue_template.js',
  './src/ops/templates/claude_code_prompt_template.js',
  './src/ops/templates/screen_mel_card_template.js',
  './src/ops/templates/audit_recipe_template.js',
  './src/ops/templates/port_plan_template.js',
  './src/ops/templates/mel_export_template.js',
  './src/ops/templates/variant_focus.js',
  './src/ops/connectors/repo_connector.js',
  './src/ops/connectors/screen_contracts_connector.js',
  './src/ops/connectors/cloud_design_connector.js',
  './src/ops/connectors/github_issue_connector.js',
  './src/ops/connectors/claude_code_connector.js',
  './src/ops/connectors/checks_connector.js',
  './src/ops/connectors/audit_recipe_connector.js',
  './src/ops/connectors/port_plan_connector.js',
  './src/ops/connectors/mel_export_connector.js',
  './src/ride_state.js',
  './src/driver_offer_store.js',
  './src/ride_actions.js',
  './src/garage.js',
  './src/ride_history.js',
  './src/repeat_route.js',
  './src/favorite_routes.js',
  './src/mapbox/map_shell.js',
  './src/mapbox/foundation_utils.js',
  './src/mapbox/mapbox_config.js',
  './src/mapbox/mapbox_loader.js',
  './src/mapbox/mapbox_state.js',
  './src/mapbox/geolocation_service.js',
  './src/mapbox/route_service.js',
  './src/mapbox/price_estimator.js',
  './src/mapbox/driver_markers.js',
  './src/mapbox/trip_status_layer.js',
  './icons/icon.svg',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // BD-API-SEAM-01 (R13 of #784) — never cache backend API reads. If the seam is enabled
  // with a same-origin base, an /api GET must hit the network every time, not be served
  // stale from the bazardrive-vNNN cache (which would hide cross-device order/ride changes).
  // Cross-origin API calls already pass through via the origin check above; this covers the
  // same-origin case (the only origin the page CSP allows today).
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.includes('/prototypes/')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((res) => {
          if (!res || res.status !== 200 || res.type !== 'basic') return res;
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
