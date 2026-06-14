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
// Two guards keep a deferred/navigable load (e.g. /receipt, whose read fires off
// a timer and can settle after the user navigated away) from disturbing whatever
// screen is now current on the singleton overlay:
//   - isActive (optional): gates the SHOW — a stale load never raises a
//     'retrying'/'server_error' sheet over another screen. The report happens
//     inside this catch (before any caller-side post-await check could run), so
//     the guard belongs here. When omitted (in-place loads) the load is always
//     active.
//   - token (per-call): gates the DISMISS — only the load that raised the
//     overlay state may clear it, so a stale dismiss cannot clobber a newer
//     load's 'retrying' that has since replaced it (onlyIfState alone can't tell
//     two same-kind loads apart).
import { reportAppShellError, dismissAppShellError } from './app_error_triggers.js';

export async function loadResource(fn, { onRetry, isRetry, fallback = [], isActive } = {}) {
  const active = () => (typeof isActive !== 'function' || isActive());
  const token = {};
  if (isRetry && active()) reportAppShellError('retrying', { token });
  try {
    const value = await fn();
    if (isRetry) dismissAppShellError({ onlyIfState: 'retrying', token });
    return value;
  } catch (err) {
    if (active()) reportAppShellError('server_error', onRetry ? { onRetry, token } : { token });
    else dismissAppShellError({ onlyIfState: 'retrying', token });
    return fallback;
  }
}
