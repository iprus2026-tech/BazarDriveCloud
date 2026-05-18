import { register, start, go, setPendingAction } from './router.js';
import { user } from './state.js';
import { initSwUpdate } from './sw-update.js';

import welcome    from './screens/welcome.js';
import feed       from './screens/feed.js';
import rules      from './screens/rules.js';
import profile    from './screens/profile.js';
import onboarding from './screens/onboarding.js';
import composer   from './screens/composer.js';
import respond    from './screens/respond.js';
import chat       from './screens/chat.js';
import activeRide from './screens/active_ride.js';
import responses  from './screens/responses.js';
import tripConfirmation from './screens/trip_confirmation.js';

register('/welcome',     welcome);
register('/feed',        feed);
register('/rules',       rules);
register('/profile',     profile);
register('/onboarding',  onboarding);
register('/new',         composer);
register('/respond',     respond);
register('/chat',        chat);
register('/active-ride', activeRide);
register('/responses',   responses);
register('/trip-confirmation', tripConfirmation);

export function requireOnboarding(after) {
  if (user.get().onboarded) {
    after?.();
    return;
  }
  setPendingAction(after ?? null);
  go('/onboarding');
}

document.getElementById('tabbar').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-route]');
  if (btn?.dataset.route) go(btn.dataset.route);
});

document.getElementById('fab').addEventListener('click', () => {
  requireOnboarding(() => go('/new'));
});

start();
initSwUpdate();
