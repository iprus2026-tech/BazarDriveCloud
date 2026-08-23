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
//
// BD-ROUTER-LIFECYCLE-01A P2 follow-up (ABA fix, PR #918 review): the first
// fix captured `window.location.hash` at render start and compared it after
// the load settled. That is wrong for an A→B→A navigation — the hash
// matches again once the user returns to /respond, even though a whole new
// render (a new router generation, a brand new renderRespond closure) has
// run in between; a stale continuation from the FIRST /respond visit would
// wrongly read itself as still current. router.js now hands every loader a
// frozen renderContext ({ isCurrent }) bound to the generation it was
// minted for; respond.js takes that as an optional argument and derives
// isCurrent from it instead of from the hash (falling back to an
// always-current stub for a direct/test caller that passes none). The
// "ABA" sections below drive this directly: they supersede a fake
// renderContext WITHOUT ever touching location.hash, which is exactly the
// case a hash-equality check gets wrong and a renderContext-bound check
// gets right.
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

// A controllable stand-in for the renderContext router.js hands every
// loader. supersede() flips isCurrent() to false — the same effect a newer
// render() call has in the real router — without ever touching location.hash.
function makeRenderContext() {
  let current = true;
  return {
    context: { isCurrent: () => current },
    supersede() { current = false; },
  };
}

// ── 1. Non-stale (renderContext supplied, never superseded): go('/chat?...')
// still fires for a driver-trip post — baseline compatibility ─────────────
{
  const { context } = makeRenderContext();
  location.hash = '#/respond?postId=trip-1';
  await respond(context);
  await flush();

  expect('non-stale respond(renderContext) render: go(\'/chat?...\') still fires for a driver-trip post',
    location.hash === '#/chat?tripId=trip-1');
}

// ── 2. Non-stale, NO renderContext at all (undefined) — the optional-
// argument fallback for a direct/test caller must still behave normally ───
{
  location.hash = '#/respond?postId=trip-1';
  await respond(); // no argument — respond.js must fall back to an always-current stub
  await flush();

  expect('non-stale respond() render with no renderContext argument: go(\'/chat?...\') still fires (optional-argument fallback)',
    location.hash === '#/chat?tripId=trip-1');
}

// ── 3. ABA: renderContext superseded WITHOUT any hash change — the exact
// case a hash-equality staleness check gets wrong (hash still matches, so
// it would wrongly read "current") but a renderContext-bound check gets
// right ────────────────────────────────────────────────────────────────────
{
  const { context, supersede } = makeRenderContext();
  location.hash = '#/respond?postId=trip-1';
  const pending = respond(context); // synchronously captures isCurrent from context, starts the load
  // Do NOT touch location.hash — simulate an A→B→A round trip that has
  // landed back on the exact same URL as far as respond.js can tell from
  // the outside; only the router's renderContext reflects that a newer
  // generation has since taken over.
  supersede();
  await pending;
  await flush();

  expect('ABA: go(\'/chat?...\') never fires once renderContext is superseded, even though location.hash never changed',
    location.hash === '#/respond?postId=trip-1',
    'GUARD DISCRIMINATOR — a hash-equality isCurrent (location.hash === startHash) would wrongly read true here and fire go()');
}

// ── 4 & 5. A rejected load must not raise the global overlay once stale,
// but must still raise it normally when not stale ──────────────────────────
// Flips the backend on (api_config.js's own test-only escape hatch) and
// stubs fetch to reject synchronously, so listFeedPosts() -> apiFetch()
// rejects deterministically — no real network call.
globalThis.__BD_API_BASE__ = 'https://example.invalid';
globalThis.fetch = () => Promise.reject(new Error('network down (test stub)'));

{
  overlayCalls.length = 0;
  const { context } = makeRenderContext();
  location.hash = '#/respond?postId=trip-1';
  await respond(context);
  await flush();

  expect('non-stale respond(renderContext) render: a rejected load still raises the global error overlay normally',
    overlayCalls.length === 1 && overlayCalls[0][0] === 'server_error');
}

// ── ABA: renderContext superseded WITHOUT any hash change — a rejected
// load must not raise the overlay ──────────────────────────────────────────
{
  overlayCalls.length = 0;
  const { context, supersede } = makeRenderContext();
  location.hash = '#/respond?postId=trip-1';
  const pending = respond(context);
  supersede(); // no hash change — same ABA shape as section 3
  await pending;
  await flush();

  expect('ABA: a rejected load never raises the global error overlay once renderContext is superseded, even though location.hash never changed',
    overlayCalls.length === 0,
    'GUARD DISCRIMINATOR — a hash-equality isActive would wrongly stay true here (hash unchanged) and let reportAppShellError(\'server_error\', ...) fire');
}

globalThis.__BD_API_BASE__ = '';
delete globalThis.fetch;

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
