import { user } from './state.js';
import { isDriverMode } from './ride_actions.js';
import { applySmokeRole, bootstrapSmokeRoleFromQuery } from './smoke_role.js';

const routes = new Map();
let pendingAction = null;

// BD-ROUTER-LIFECYCLE-01A (#917) — LATEST_ROUTE_RENDER_WINS. render() is
// async (screen loaders may await their own data — post_detail.js does),
// so two overlapping navigations can resolve out of order: a slow route A
// started first can still settle AFTER a faster route B has already
// mounted, and A's stale view would otherwise land in #app alongside (or
// instead of) B's. Every render() call stamps itself with the current
// generation before awaiting its loader; if a newer render has started by
// the time the loader settles, the stale result is discarded — no mount,
// no tab-active/chrome sync. Existing hash routing, guards and the
// loader contract (return a DOM view; sync or async) are unchanged.
//
// BD-ROUTER-LIFECYCLE-01A P2 (PR #918 review, ABA fix) — the loader is also
// handed a frozen renderContext ({ isCurrent }) bound to the generation this
// render() call stamped itself with, so a loader can detect its OWN
// staleness for side effects it fires before returning (router.js has no
// visibility into those). A hash-equality staleness check inside a loader
// (respond.js's earlier `location.hash === startHash`) is wrong for an
// A→B→A navigation: the hash matches again once the user returns to A,
// even though a whole new render()/generation has happened in between — a
// stale continuation from the FIRST A visit would wrongly read itself as
// still current. isCurrent() derived from the generation counter instead
// is immune to this: it is only ever true for the exact render() call it
// was minted for. Loaders that ignore the extra argument (every existing
// loader except respond.js) are unaffected.
//
// A different-hash go() also advances the generation BEFORE assigning the
// hash. Browsers deliver hashchange asynchronously, so waiting for render()
// to advance it would leave a window where an old loader can settle under
// the new URL while still reading isCurrent() === true. The following
// hashchange render advances it again and mints the new route's context.
let renderGeneration = 0;

// BD-SCREEN-LIFECYCLE-01A (#919) — SCREEN_DISPOSER_EXACTLY_ONCE. A loader may
// optionally return { view, dispose } instead of a bare DOM node. `dispose`
// is router-owned: it runs exactly once, for whichever screen is actually
// mounted-and-current, at the very start of the NEXT render() call — before
// any guard check, because the welcome/driver guards below can redirect and
// `return` before ever reaching root.replaceChildren() (a guard-redirected
// screen would otherwise never get disposed). The slot is cleared BEFORE its
// disposer runs, so a disposer that re-entrantly triggers navigation can
// never cause itself to be invoked a second time. A STALE loader result
// (superseded before or as it resolves) is never mounted (#918) and never
// becomes the current disposer — but if it carries its own `dispose`, that
// is invoked immediately, exactly once, at the point staleness is detected,
// so its resources don't leak; it is discarded afterward, never stored, and
// never touches the (possibly newer) current disposer. A disposer that
// throws is contained locally (logged, never rethrown) and never blocks the
// render() call it runs inside from continuing to mount its own screen.
let currentDisposer = null;

function disposeSafely(dispose) {
  if (typeof dispose !== 'function') return;
  try {
    dispose();
  } catch (err) {
    console.error('[router] screen disposer threw', err);
  }
}

// Detach + invoke whatever disposer is currently owned. Clearing the slot
// BEFORE invoking it (rather than after) is what keeps this exactly-once
// even against a disposer that re-enters navigation from inside itself.
function drainCurrentDisposer() {
  const dispose = currentDisposer;
  currentDisposer = null;
  disposeSafely(dispose);
}

// A loader's result is a lifecycle object (not a bare DOM node) iff it
// carries a `view` property — a real DOM element never has one, in either a
// real browser or this app's minimal test shims, so this needs no reference
// to a global `Node` constructor (which the shims don't define).
function isLifecycleResult(result) {
  return Boolean(result) && typeof result === 'object' && 'view' in result;
}

const HIDE_CHROME = new Set(['/welcome', '/onboarding', '/active-ride', '/trip-confirmation']);
const SHOW_FAB    = new Set(['/feed']);
const PASSENGER_ORDER_ROUTES = new Set(['/route-picker', '/route-preview', '/order-map-draft']);
// BD-OPS-03/09 — dev/docs routes open from a clean profile and hide product
// chrome. Product routes keep the welcome guard and chrome policy unchanged.
const DEV_DOCS_ROUTES = new Set(['/ops/screens']);

function redirectDriverPassengerOrderFlow(path, u) {
  return isDriverMode(u) && PASSENGER_ORDER_ROUTES.has(path);
}

export function register(path, loader) {
  routes.set(path, loader);
}

export function go(path) {
  const target = `#${path}`;
  if (location.hash === target) render();
  else {
    ++renderGeneration; // invalidate the current owner before async hashchange delivery
    location.hash = path;
  }
}

export function setPendingAction(fn) {
  pendingAction = typeof fn === 'function' ? fn : null;
}

export function consumePendingAction() {
  const fn = pendingAction;
  pendingAction = null;
  return fn;
}

async function render() {
  const generation = ++renderGeneration;
  const renderContext = Object.freeze({ isCurrent: () => generation === renderGeneration });
  // BD-SCREEN-LIFECYCLE-01A — dispose the previously mounted screen as early
  // as possible, before any guard check (see the comment on currentDisposer).
  drainCurrentDisposer();
  const fullPath = (location.hash || '#/welcome').slice(1);
  const path = fullPath.split('?')[0];
  // BD-SMOKE-ROLE-01 — capture ?smokeRole= from the hash query (hash-routed,
  // so location.search is empty) into the per-tab sessionStorage override,
  // then read the user with that override layered on. The override only
  // affects role context; the persisted bazardrive.user.v1 is never written.
  const qi = fullPath.indexOf('?');
  bootstrapSmokeRoleFromQuery(qi === -1 ? '' : fullPath.slice(qi + 1));
  const u = applySmokeRole(user.get());
  const isDevDocsRoute = DEV_DOCS_ROUTES.has(path);

  if (!u.welcomeSeen && path !== '/welcome' && !isDevDocsRoute) {
    go('/welcome');
    return;
  }

  if (redirectDriverPassengerOrderFlow(path, u)) {
    go('/driver-map');
    return;
  }

  // BD-ORDER-DETAIL-01C — minimal dynamic-route support for /order/<id>.
  // The exact-match registry stays the source of truth; only paths that
  // start with the dynamic prefix below and have no exact registration
  // fall through to the registered prefix loader (`/order`). All other
  // unknown paths still fall back to /feed unchanged, so the router's
  // existing fallback semantics are preserved end-to-end. The Order
  // Detail screen reads its id off `location.hash` itself.
  let lookupPath = path;
  if (!routes.has(lookupPath) && lookupPath.startsWith('/order/')) {
    lookupPath = '/order';
  }
  const loader = routes.get(lookupPath) ?? routes.get('/feed');

  const root    = document.getElementById('app');
  const tabbar  = document.getElementById('tabbar');
  const fab     = document.getElementById('fab');
  const shell   = document.getElementById('shell');

  const noChrome = !u.welcomeSeen || HIDE_CHROME.has(path) || isDevDocsRoute;
  const hasFab   = !noChrome && SHOW_FAB.has(path);

  tabbar.hidden = noChrome;
  fab.hidden    = !hasFab;

  shell.classList.toggle('no-chrome',  noChrome);
  shell.classList.toggle('has-tabbar', !noChrome);
  shell.classList.toggle('has-fab',    hasFab);

  root.replaceChildren();
  const result = await loader(renderContext);
  const lifecycle = isLifecycleResult(result);
  const view = lifecycle ? result.view : result;
  const dispose = lifecycle && typeof result.dispose === 'function' ? result.dispose : null;
  // A newer navigation started while this loader was in flight — this
  // render is stale and must not mount, must not touch tab-active state,
  // and must not become the current disposer. Its own resources (if any)
  // are disposed right now instead, exactly once (BD-SCREEN-LIFECYCLE-01A
  // STALE LIFECYCLE RESULT POLICY, #919) — never stored, never touching
  // whatever the (possibly newer) current disposer is.
  if (!renderContext.isCurrent()) {
    disposeSafely(dispose);
    return;
  }
  currentDisposer = dispose;
  root.appendChild(view);

  syncTabActive(path);
}

function syncTabActive(path) {
  // /driver-map is the driver entry behind the Карта tab (which carries
  // data-route="/map"), so treat both paths as the same tab for activation.
  const tabPath = path === '/driver-map' ? '/map' : path;
  for (const btn of document.querySelectorAll('#tabbar [data-route]')) {
    btn.classList.toggle('active', btn.dataset.route === tabPath);
  }
}

export function start() {
  window.addEventListener('hashchange', render);
  render();
}
