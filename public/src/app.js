import { register, start, go, setPendingAction } from './router.js';
import { user } from './state.js';

import welcome from './screens/welcome.js';
import feed from './screens/feed.js';
import rules from './screens/rules.js';
import profile from './screens/profile.js';
import onboarding from './screens/onboarding.js';
import composer from './screens/composer.js';

register('/welcome', welcome);
register('/feed', feed);
register('/rules', rules);
register('/profile', profile);
register('/onboarding', onboarding);
register('/new', composer);

export function requireOnboarding(after) {
  if (user.get().onboarded) {
    after?.();
    return;
  }
  setPendingAction(after ?? null);
  go('/onboarding');
}

const tabbar = document.getElementById('tabbar');
tabbar.addEventListener('click', (event) => {
  const btn = event.target.closest('button.tab');
  if (!btn) return;

  if (btn.dataset.action === 'create-post') {
    requireOnboarding(() => go('/new'));
    return;
  }
  if (btn.dataset.route) {
    go(btn.dataset.route);
  }
});

start();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
