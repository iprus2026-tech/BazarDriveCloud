// BD-ERROR-02A — unified data-load adapter.
//
// One guarded-retry wrapper shared by every screen that loads data through the
// global app-shell overlay, replacing the per-screen BD-ERROR-01C copies
// (loadFeedPosts / loadInboxItems / loadDetailPosts / loadRespondPosts /
// loadNearbyOrders) so the contract lives in ONE place and cannot drift.
//
// Contract: load `fn()` and route a failure through the global overlay.
//   - isRetry → show a non-blocking 'retrying' progress state first;
//   - on success during a retry, dismiss ONLY if the overlay is still that
//     'retrying' state (onlyIfState) so a newer state — e.g. an offline banner
//     the connection watcher raises mid-retry — is not clobbered;
//   - on failure, report 'server_error' with a guarded retry (onRetry powers the
//     overlay's «Повторить» button) and fall back to `fallback` (default []),
//     so the screen's own empty/missing state is preserved (the overlay is
//     additive, never a replacement).
//
// `await fn()` is forward-compatible: it holds whether the source is synchronous
// (today's mock/localStorage) or a real async, rejectable backend later. This
// module owns the load orchestration; the overlay protocol itself stays in the
// non-mutating app_error_triggers.js adapter, which this imports.
//
// isActive (optional) gates the OVERLAY for a deferred/navigable load: a stale
// load — one whose screen was navigated away from before it settles — must not
// pop a 'retrying'/'server_error' sheet over whichever screen is now current.
// The report itself happens inside this catch (before any caller-side post-await
// check could run), so the guard belongs here. When omitted (in-place loads) the
// resource is always active. On a stale failure we clear any 'retrying' we raised
// (guarded by onlyIfState) instead of surfacing a new error.
import { reportAppShellError, dismissAppShellError } from './app_error_triggers.js';

export async function loadResource(fn, { onRetry, isRetry, fallback = [], isActive } = {}) {
  const active = () => (typeof isActive !== 'function' || isActive());
  if (isRetry && active()) reportAppShellError('retrying');
  try {
    const value = await fn();
    if (isRetry) dismissAppShellError({ onlyIfState: 'retrying' });
    return value;
  } catch (err) {
    if (active()) reportAppShellError('server_error', onRetry ? { onRetry } : {});
    else dismissAppShellError({ onlyIfState: 'retrying' });
    return fallback;
  }
}
