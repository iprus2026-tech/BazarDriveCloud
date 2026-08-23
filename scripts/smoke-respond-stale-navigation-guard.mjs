// BD-ROUTER-LIFECYCLE-01A P2 (PR #918 review) — stale loader navigation guard.
//
// router.js's LATEST_ROUTE_RENDER_WINS generation guard (#917) only gates
// whether a loader's RETURNED VIEW gets mounted; it has no visibility into
// side effects a loader fires before returning. The review thread named TWO
// such side effects in respond.js's renderRespond:
//   1. go('/chat?tripId=...') fired directly, mid-load, for a driver-trip
//      post — a stale, still-in-flight load (initial or retry) that resumes
//      AFTER the user has navigated elsewhere would fire it unconditionally,
//      yanking the user away from wherever they actually are.
//   2. the global server_error/retrying overlay, raised INSIDE
//      data_layer.loadResource's own catch block via reportAppShellError —
//      BEFORE loadResource returns, so a check placed only after the
//      `await loadResource(...)` line is too late to stop it.
// The fix captures the hash respond() started under (isCurrent()), threads
// it into loadResource's isActive option (gates the overlay at the point it
// would be raised) and re-checks it once the load settles (gates go() and
// everything after it) — the same idiom already used by driver_map.js's
// epoch check and trip_receipt.js's content.isConnected check.
//
// This is a REAL RUNTIME smoke: it imports the actual public/src/screens/
// respond.js (and, transitively, the real router.js go() and data_layer.js
// loadResource) against a minimal hand-rolled shim (document.createElement
// stub, a mutable location/hash, a window.BD.GlobalError stub — no jsdom).
// No browser, no real network, no timers. `listFeedPosts()` (the real
// public/src/mock_api.js export) already ships a stable fixture — post
// 'trip-1' (type: 'trip', no passenger flag) — that exercises the exact
// go('/chat?...') branch under test, so no mock data needs seeding. For the
// overlay scenarios, the backend is flipped on via the test-only
// globalThis.__BD_API_BASE__ override (api_config.js's own documented
// escape hatch) with a stubbed globalThis.fetch that rejects synchronously
// — deterministic, no real network call.

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

function makeStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
  };
}
globalThis.localStorage = makeStorage();
globalThis.sessionStorage = makeStorage();

// A single shared location object: router.js's go() reads/writes the bare
// `location` global; respond.js's own getRouteParam() reads `window.location`
// — both must observe the same mutable hash. go() assigns the bare path with
// no leading '#' (`location.hash = path`), relying on a real browser's
// location.hash setter to auto-prefix it — this getter/setter pair replicates
// that (same pattern as scripts/smoke-router-latest-render-wins.mjs's shim).
let currentHash = '';
const location = {
  get hash() { return currentHash; },
  set hash(value) { currentHash = value.startsWith('#') ? value : `#${value}`; },
};
globalThis.location = location;
// Node >=21 exposes a global `navigator` (a getter-only binding — replacing
// the object outright throws, hence setting the property instead), but CI's
// pinned Node 20 (see .github/workflows/ci.yml) has no global navigator at
// all, so a bare `navigator.onLine = …` throws ReferenceError there. Create
// the object only if missing, so this works on both.
if (!globalThis.navigator) globalThis.navigator = {};
globalThis.navigator.onLine = true;
// window.BD.GlobalError — the lazily-resolved overlay API app_error_triggers.js
// looks for. Recording every show()/hide() call is the only signal we need to
// prove whether reportAppShellError actually raised (or correctly suppressed)
// the overlay.
const overlayCalls = [];
globalThis.window = {
  location,
  addEventListener() {},
  BD: {
    GlobalError: {
      show(...args) { overlayCalls.push(args); },
      hide() {},
      current() { return null; },
      token() { return null; },
    },
  },
};
// A generic fake node returned by querySelector — just enough surface
// (a no-op addEventListener) for a render path like renderMissing that
// queries its own freshly-set innerHTML and wires click handlers. The test
// scenarios below never assert on rendered content, only on go()/overlay
// side effects, so a real DOM/HTML parser is not needed.
function fakeNode() {
  return { addEventListener() {}, classList: { toggle() {}, add() {}, remove() {}, has() { return false; } } };
}
globalThis.document = {
  createElement: () => ({
    className: '',
    innerHTML: '',
    appendChild() {},
    querySelector() { return fakeNode(); },
    querySelectorAll() { return []; },
  }),
};

const { default: respond } = await import('../public/src/screens/respond.js');

async function flush(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

// ── 1. Stale render: the user navigates away before the load resolves —
// go('/chat?...') must never fire ──────────────────────────────────────────
{
  location.hash = '#/respond?postId=trip-1';
  const pending = respond(); // synchronously runs up to its first await, capturing startHash
  location.hash = '#/feed';  // the user navigates away while the load is still in flight
  await pending;
  await flush();

  expect('stale respond() render: go(\'/chat?...\') never fires once the user has navigated away',
    location.hash === '#/feed',
    'GUARD DISCRIMINATOR — fails if the stale-navigation guard is removed: hash would be overwritten to #/chat?tripId=trip-1');
}

// ── 2. Non-stale render: unchanged compatibility — go('/chat?...') still
// fires normally when nothing raced it ──────────────────────────────────────
{
  location.hash = '#/respond?postId=trip-1';
  await respond();
  await flush();

  expect('non-stale respond() render: go(\'/chat?...\') still fires for a driver-trip post',
    location.hash === '#/chat?tripId=trip-1');
}

// ── 3 & 4. A rejected load must not raise the global overlay once stale,
// but must still raise it normally when not stale ──────────────────────────
// Flips the backend on (api_config.js's own test-only escape hatch) and
// stubs fetch to reject synchronously, so listFeedPosts() -> apiFetch()
// rejects deterministically — no real network call.
globalThis.__BD_API_BASE__ = 'https://example.invalid';
globalThis.fetch = () => Promise.reject(new Error('network down (test stub)'));

{
  overlayCalls.length = 0;
  location.hash = '#/respond?postId=trip-1';
  const pending = respond();       // synchronously captures startHash, starts the (rejecting) load
  location.hash = '#/feed';        // the user navigates away while the load is still in flight
  await pending;
  await flush();

  expect('stale respond() render: a rejected load never raises the global error overlay',
    overlayCalls.length === 0,
    'GUARD DISCRIMINATOR — fails if isActive is not wired into loadResource: reportAppShellError(\'server_error\', ...) would fire despite the user having navigated away');
}

{
  overlayCalls.length = 0;
  location.hash = '#/respond?postId=trip-1';
  await respond();
  await flush();

  expect('non-stale respond() render: a rejected load still raises the global error overlay normally',
    overlayCalls.length === 1 && overlayCalls[0][0] === 'server_error');
}

globalThis.__BD_API_BASE__ = '';
delete globalThis.fetch;

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
