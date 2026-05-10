import { register, start, go, setPendingAction } from './router.js';
import { user } from './state.js';

import welcome    from './screens/welcome.js';
import feed       from './screens/feed.js';
import rules      from './screens/rules.js';
import profile    from './screens/profile.js';
import onboarding from './screens/onboarding.js';
import composer   from './screens/composer.js';

register('/welcome',    welcome);
register('/feed',       feed);
register('/rules',      rules);
register('/profile',    profile);
register('/onboarding', onboarding);
register('/new',        composer);

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

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const hadController = Boolean(navigator.serviceWorker.controller);

    navigator.serviceWorker.register('./sw.js').then((reg) => {
      const showBanner = () => {
        if (!hadController) return;
        const banner = document.getElementById('pwa-update-banner');
        if (banner) banner.hidden = false;
      };

      if (reg.waiting) {
        showBanner();
      }

      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && reg.active) showBanner();
        });
      });

      document.getElementById('pwa-update-btn')?.addEventListener('click', () => {
        const sw = reg.waiting;
        if (sw) sw.postMessage({ type: 'SKIP_WAITING' });
      });

      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!reloading) {
          reloading = true;
          window.location.reload();
        }
      });
    }).catch(() => {});
  });
}
