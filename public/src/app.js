import { register, start, go, setPendingAction } from './router.js';
import { user } from './state.js';
import { initSwUpdate } from './sw-update.js';
import { initFavoriteRoutes } from './favorite_routes.js';
import { getSmokeRole, resolveRole } from './smoke_role.js';

import welcome    from './screens/welcome.js';
import feed       from './screens/feed.js';
import map        from './screens/map.js';
import locationPermission from './screens/location_permission.js';
import routePicker from './screens/route_picker.js';
import routePreview from './screens/route_preview.js';
import orderMapDraft from './screens/order_map_draft.js';
import rules      from './screens/rules.js';
import profile    from './screens/profile.js';
import onboarding from './screens/onboarding.js';
import composer   from './screens/composer.js';
import respond    from './screens/respond.js';
import chat       from './screens/chat.js';
import activeRide from './screens/active_ride.js';
import responses  from './screens/responses.js';
import tripConfirmation from './screens/trip_confirmation.js';
import postDetail from './screens/post_detail.js';
import inbox      from './screens/inbox.js';
import driverMap  from './screens/driver_map.js';
import tripReceipt from './screens/trip_receipt.js';

register('/welcome',     welcome);
register('/feed',        feed);
register('/map',         map);
register('/location-permission', locationPermission);
register('/driver-map',  driverMap);
register('/route-picker', routePicker);
register('/route-preview', routePreview);
register('/order-map-draft', orderMapDraft);
register('/rules',       rules);
register('/profile',     profile);
register('/onboarding',  onboarding);
register('/new',         composer);
register('/respond',     respond);
register('/chat',        chat);
register('/active-ride', activeRide);
register('/responses',   responses);
register('/trip-confirmation', tripConfirmation);
register('/post',        postDetail);
register('/inbox',       inbox);
register('/receipt',     tripReceipt);

export function requireOnboarding(after) {
  if (user.get().onboarded) {
    after?.();
    return;
  }
  setPendingAction(after ?? null);
  go('/onboarding');
}

function getMapEntryRoute() {
  // BD-SMOKE-ROLE-01 — honour the per-tab role override so a passenger tab's
  // Карта tab opens /map, not the driver surface, even when the shared user
  // is a driver.
  return resolveRole(user.get()) === 'driver' ? '/driver-map' : '/map';
}

function getCreateEntryRoute() {
  const role = resolveRole(user.get());
  if (role === 'driver') return '/driver-map';
  // BD-SMOKE-ROLE-01 — a passenger smoke tab's persisted role may be driver,
  // so the composer can't infer passenger intent from user.get(). Carry the
  // intent in the route. Real passengers keep '/new' so an in-progress draft
  // type is not overridden by the ?type= intent.
  if (getSmokeRole() === 'passenger') return '/new?type=passenger_request';
  return '/new';
}

document.getElementById('tabbar').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-route]');
  if (!btn?.dataset.route) return;
  if (btn.dataset.route === '/map') {
    go(getMapEntryRoute());
    return;
  }
  go(btn.dataset.route);
});

document.getElementById('fab').addEventListener('click', () => {
  requireOnboarding(() => go(getCreateEntryRoute()));
});

start();
initSwUpdate();
initFavoriteRoutes();
