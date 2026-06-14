// BD-ERROR-01B — App-shell connection trigger wiring.
//
// Wires ONLY the browser online/offline events to the existing BD-ERROR-01A
// app-shell overlay (window.BD.GlobalError). It is transport-presentation glue:
//
//   navigator.onLine === false / window 'offline'  ->  show('offline')
//   window 'online'                                ->  show('retrying')
//                                  short delay      ->  show('recovered')
//                                  (overlay then auto-dismisses)
//
// Strictly out of scope: fetch-failure handling, backend retries, ride/order
// errors, map/GPS errors, and any ride/order mutation. This module performs no
// network calls, no backend access, and no storage writes — it only listens to
// browser connectivity events and forwards a state to the overlay.

// Delay between the "retrying" hint and the "recovered" toast on reconnection.
const RETRYING_TO_RECOVERED_MS = 1200;

let initialized = false;
let onlineTransitionTimer = null;

// Resolve the overlay API lazily so this module never hard-depends on the
// overlay module — it only needs window.BD.GlobalError to exist at call time.
function overlayApi() {
  const bd = (typeof window !== 'undefined' && window.BD) ? window.BD.GlobalError : null;
  return bd && typeof bd.show === 'function' ? bd : null;
}

function clearOnlineTransitionTimer() {
  if (onlineTransitionTimer !== null) {
    clearTimeout(onlineTransitionTimer);
    onlineTransitionTimer = null;
  }
}

function handleOffline() {
  // Dropping offline cancels any in-flight reconnection sequence.
  clearOnlineTransitionTimer();
  const api = overlayApi();
  if (api) api.show('offline');
}

function handleOnline() {
  const api = overlayApi();
  if (!api) return;
  clearOnlineTransitionTimer();
  api.show('retrying');
  onlineTransitionTimer = setTimeout(() => {
    onlineTransitionTimer = null;
    const next = overlayApi();
    // recovered auto-dismisses inside app_error_overlay.js.
    if (next) next.show('recovered');
  }, RETRYING_TO_RECOVERED_MS);
}

// Idempotent: repeated calls never attach duplicate listeners. Must be called
// after initGlobalErrorOverlay() so window.BD.GlobalError already exists.
export function initAppConnectionStatus() {
  if (initialized) return;
  initialized = true;
  window.addEventListener('offline', handleOffline);
  window.addEventListener('online', handleOnline);
  // Reflect the initial state — if the app boots already offline, surface it.
  if (navigator.onLine === false) {
    handleOffline();
  }
}
