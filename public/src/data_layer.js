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
import { reportAppShellError, dismissAppShellError } from './app_error_triggers.js';

export async function loadResource(fn, { onRetry, isRetry, fallback = [] } = {}) {
  if (isRetry) reportAppShellError('retrying');
  try {
    const value = await fn();
    if (isRetry) dismissAppShellError({ onlyIfState: 'retrying' });
    return value;
  } catch (err) {
    reportAppShellError('server_error', onRetry ? { onRetry } : {});
    return fallback;
  }
}
