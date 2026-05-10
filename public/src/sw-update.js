const RELOAD_FLAG = 'bd-reloading';

export function initSwUpdate() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => {
        // A worker is already waiting from a previous visit (e.g., multiple tabs open).
        if (reg.waiting && navigator.serviceWorker.controller) {
          showUpdateBanner(reg.waiting);
          return;
        }
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state !== 'installed') return;
            // No controller means first install — skip notification.
            if (!navigator.serviceWorker.controller) return;
            showUpdateBanner(sw);
          });
        });
      })
      .catch(() => {});
  });
}

function showUpdateBanner(waitingWorker) {
  const banner = document.getElementById('sw-update-banner');
  if (!banner || !banner.hidden) return;
  banner.hidden = false;

  document.getElementById('sw-update-btn').addEventListener('click', () => {
    // Guard against double-clicks and post-reload re-triggers.
    if (sessionStorage.getItem(RELOAD_FLAG)) return;
    sessionStorage.setItem(RELOAD_FLAG, '1');
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      sessionStorage.removeItem(RELOAD_FLAG);
      window.location.reload();
    }, { once: true });
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  }, { once: true });
}
