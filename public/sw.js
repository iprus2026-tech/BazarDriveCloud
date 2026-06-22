const VERSION    = 'v184';
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
  './src/app.js',
  './src/app_error_overlay.js',
  './src/app_connection_status.js',
  './src/app_error_triggers.js',
  './src/data_layer.js',
  './src/router.js',
  './src/state.js',
  './src/smoke_role.js',
  './src/util.js',
  './src/storage_boundary.js',
  './src/mock_auth.js',
  './src/mock_api.js',
  './src/sw-update.js',
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
  './src/ops/connectors/repo_connector.js',
  './src/ops/connectors/screen_contracts_connector.js',
  './src/ops/connectors/cloud_design_connector.js',
  './src/ops/connectors/github_issue_connector.js',
  './src/ops/connectors/claude_code_connector.js',
  './src/ops/connectors/checks_connector.js',
  './src/ops/connectors/audit_recipe_connector.js',
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
