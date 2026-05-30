import { register, start, go, setPendingAction } from './router.js';
import { user } from './state.js';
import { initSwUpdate } from './sw-update.js';
import { initFavoriteRoutes } from './favorite_routes.js';

import welcome    from './screens/welcome.js';
import feed       from './screens/feed.js';
import map        from './screens/map.js';
import locationPermission from './screens/location_permission.js';
import routePicker from './screens/route_picker.js';
import routePreview from './screens/route_preview.js';
import orderMapDraft from './screens/order_map_draft_handoff.js';
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

export function requireOnboarding(after) {
  if (user.get().onboarded) {
    after?.();
    return;
  }
  setPendingAction(after ?? null);
  go('/onboarding');
}

function getMapEntryRoute() {
  const profile = user.get();
  return profile.role === 'driver' ? '/driver-map' : '/map';
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
  requireOnboarding(() => go('/new'));
});

start();
initSwUpdate();
initFavoriteRoutes();
