// BD-ERROR-01C-A — Fetch failure trigger adapter contract.
//
// A tiny, non-mutating adapter that future flow sites call to surface a global
// error through the existing BD-ERROR-01A overlay (window.BD.GlobalError),
// without each site re-implementing the overlay protocol or the
// offline-vs-error decision:
//
//   reportAppShellError('timeout')        ->  show('timeout')
//   reportAppShellError('server_error')   ->  show('server_error')
//   reportAppShellError(<anything>)  while the device is offline  ->  show('offline')
//
// This is a CONTRACT only — it is not wired into any real flow in this slice,
// it does not wrap the app's network layer, and it changes no service-worker
// fetch behaviour. It performs no network calls and no browser-storage writes,
// imports no ride/order/map/mock modules, and never mutates ride or order
// state. The overlay API is resolved lazily, so this module never hard-depends
// on the overlay module.

// Allowed error kinds. Anything else is a safe no-op.
const KINDS = ['offline', 'timeout', 'server_error', 'retrying', 'recovered'];

// Resolve the overlay API lazily — depends only on window.BD.GlobalError
// existing at call time, never on a direct import of the overlay module.
function overlayApi() {
  const bd = (typeof window !== 'undefined' && window.BD) ? window.BD.GlobalError : null;
  return bd && typeof bd.show === 'function' ? bd : null;
}

// Map a flow's error kind to the app-shell overlay.
//
// - Unknown kind is validated first and is a safe no-op (never renders UI).
// - Browser-offline is the top-level signal: while navigator.onLine === false,
//   ANY valid kind (including timeout / server_error / retrying / recovered) is
//   coerced to 'offline', because showing recovered/retrying/server_error on an
//   offline device is contradictory. retrying/recovered must come only from the
//   connection watcher (BD-ERROR-01B) after an 'online' event.
// - options are forwarded to the overlay (e.g. a demo onRetry for the
//   server_error / timeout sheets).
export function reportAppShellError(kind, options = {}) {
  if (!KINDS.includes(kind)) return;
  const api = overlayApi();
  if (!api) return;
  const resolved = (navigator.onLine === false) ? 'offline' : kind;
  api.show(resolved, options);
}

// Dismiss the app-shell overlay — e.g. from a retry callback after a flow has
// recovered. Lazy + safe (no-op if the overlay is not mounted). Keeps callers
// on the adapter boundary instead of reaching into window.BD directly.
//
// options.onlyIfState: dismiss ONLY when the overlay is still showing that
// state. This prevents a flow from clobbering a newer state raised by another
// source mid-recovery — e.g. an offline banner the connection watcher put up
// while a feed retry was in flight.
export function dismissAppShellError(options = {}) {
  const bd = (typeof window !== 'undefined' && window.BD) ? window.BD.GlobalError : null;
  if (!bd || typeof bd.hide !== 'function') return;
  if (options.onlyIfState) {
    const current = (typeof bd.current === 'function') ? bd.current() : null;
    if (current !== options.onlyIfState) return;
  }
  // options.token: dismiss ONLY when the overlay's current state was raised by
  // this same token. A stale/deferred load (e.g. a receipt read that resolves
  // after the user navigated away) must not clear a newer load's state that has
  // since replaced it — onlyIfState alone cannot tell two same-kind loads apart.
  if ('token' in options && typeof bd.token === 'function') {
    if (bd.token() !== options.token) return;
  }
  bd.hide();
}
