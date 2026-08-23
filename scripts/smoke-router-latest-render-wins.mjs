// BD-ROUTER-LIFECYCLE-01A (#917) — LATEST_ROUTE_RENDER_WINS regression guard.
//
// router.js's render() clears #app, awaits the route's loader, then appends
// the result — with no navigation generation/ownership check. At least one
// real screen loader (post_detail.js) awaits its data before returning its
// root, so a genuine race exists: a slow route A can resolve AFTER a faster
// route B has already mounted, and A's stale view lands in #app alongside
// (or instead of) B's. The fix stamps every render() call with a
// monotonically increasing generation and discards a stale continuation's
// mount (and tab-active/chrome sync) once a newer render has started.
//
// This is a REAL RUNTIME smoke, not a static source scan: it imports the
// actual public/src/router.js, drives it through a minimal hand-rolled DOM
// shim (getElementById/querySelectorAll/classList stubs — no jsdom), and
// controls loader timing with hand-resolved deferred Promises. No browser,
// no network, no timers (setTimeout/setInterval) anywhere in this file —
// ordering is deterministic via explicit microtask-queue flushes only.
//
// Globals (document/window/location/localStorage/sessionStorage) must exist
// BEFORE router.js is imported, since render()/start() reference them as
// bare identifiers resolved at call time against the global scope — matches
// how a real page provides them.
//
// BD-ROUTER-LIFECYCLE-01A P2 follow-up (ABA fix, PR #918 review): render()
// now also hands every loader a frozen renderContext ({ isCurrent }) bound
// to the generation it was minted for, so a loader can guard its own
// pre-return side effects against staleness. Section 3d below proves this
// is immune to an A→B→A round trip back to the same hash — the scenario a
// naive hash-equality staleness check gets wrong.

import fs from 'node:fs';

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── in-memory Web Storage shim (same minimal Map-backed pattern used by
// tests/ride_state.test.mjs) ────────────────────────────────────────────────
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

// ── minimal DOM shim — only the surface render()/syncTabActive() touch ─────
function makeClassList() {
  const set = new Set();
  return {
    toggle(cls, force) { if (force) set.add(cls); else set.delete(cls); },
    has(cls) { return set.has(cls); },
  };
}
function makeElement(id) {
  return {
    id,
    hidden: false,
    classList: makeClassList(),
    children: [],
    replaceChildren() { this.children = []; },
    appendChild(node) { this.children.push(node); },
  };
}
const elements = {
  app: makeElement('app'),
  tabbar: makeElement('tabbar'),
  fab: makeElement('fab'),
  shell: makeElement('shell'),
};
// Fake tabbar buttons for /a, /b and /map so syncTabActive's active-class
// toggling is genuinely exercised (BD-ROUTER-LIFECYCLE-01A acceptance: "a
// stale render never overwrites the newer tab-active/chrome result"). /map
// is syncTabActive's special-cased tab for the /driver-map redirect target
// (driver-map counts as the "Карта" tab).
const tabButtons = [
  { dataset: { route: '/a' }, classList: makeClassList() },
  { dataset: { route: '/b' }, classList: makeClassList() },
  { dataset: { route: '/map' }, classList: makeClassList() },
];
globalThis.document = {
  getElementById: (id) => elements[id] || null,
  querySelectorAll: (sel) => (sel === '#tabbar [data-route]' ? tabButtons : []),
};

let currentHash = '#/init';
let hashChangeHandler = null;
let queueHashChange = false;
const queuedHashChanges = [];
globalThis.window = {
  addEventListener(type, handler) {
    if (type === 'hashchange') hashChangeHandler = handler;
  },
};
globalThis.location = {
  get hash() { return currentHash; },
  // Most scenarios keep synchronous dispatch for compact deterministic
  // setup. Section 1b switches to an explicit queue to model the real
  // browser gap between changing location.hash and the later hashchange
  // task; dispatch remains fire-and-forget in both modes.
  set hash(value) {
    const next = value.startsWith('#') ? value : `#${value}`;
    if (next === currentHash) return;
    currentHash = next;
    if (!hashChangeHandler) return;
    if (queueHashChange) queuedHashChanges.push(hashChangeHandler);
    else hashChangeHandler();
  },
};

function dispatchNextHashChange() {
  const handler = queuedHashChanges.shift();
  if (handler) handler();
}

const { register, go, start } = await import('../public/src/router.js');
const { user } = await import('../public/src/state.js');

// welcomeSeen must be true (and role must not trigger the driver/passenger-
// order redirect) for our synthetic routes to render normally; the guard-
// redirect behavior itself is exercised separately below.
user.set({ welcomeSeen: true, role: 'passenger' });

function makeDeferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}
async function flush(times = 4) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

// ── 1. Core race: slow route A followed by faster route B ──────────────────
// (acceptance: "slow A then faster B leaves exactly B mounted"; "a stale
// loader result never appends a node after a newer render owns the route";
// "a stale render never overwrites the newer tab-active/chrome result")
{
  const viewInit = { id: 'view-init' };
  register('/init', () => viewInit);
  register('/a', () => deferredA.promise);
  register('/b', () => deferredB.promise);

  // Settle the initial start()-triggered render before the real scenario so
  // renderGeneration begins the race from a known, quiescent state.
  start();
  await flush();
  expect('setup: initial /init route mounted before the race begins',
    elements.app.children.length === 1 && elements.app.children[0] === viewInit);

  const viewA = { id: 'view-a' };
  const viewB = { id: 'view-b' };
  const deferredA = makeDeferred();
  const deferredB = makeDeferred();

  go('/a');   // generation N — slow, suspends on deferredA
  await flush();
  go('/b');   // generation N+1 — suspends on deferredB, strictly newer than /a's

  deferredB.resolve(viewB);
  await flush();
  expect('faster route B mounts as soon as its loader resolves',
    elements.app.children.length === 1 && elements.app.children[0] === viewB);
  expect('tab-active class reflects B immediately after B mounts',
    tabButtons[1].classList.has('active') && !tabButtons[0].classList.has('active'));

  deferredA.resolve(viewA); // the slow, now-stale route A finally settles
  await flush();
  expect('stale route A never appends its view after B already owns #app (POSITIVE: exactly B, still)',
    elements.app.children.length === 1 && elements.app.children[0] === viewB,
    'this assertion fails if the generation guard is removed — A would additionally append');
  expect('stale route A does not resurrect its own tab-active state over B\'s',
    tabButtons[1].classList.has('active') && !tabButtons[0].classList.has('active'));
}

// ── 1b. Different-hash go() invalidates ownership synchronously ────────────
// Browsers assign location.hash immediately but queue hashchange as a later
// task. A pending loader that settles in that gap must already be stale; it
// cannot wait for the next render() call to advance renderGeneration.
{
  const deferredQueuedA = makeDeferred();
  const viewQueuedA = { id: 'view-queued-a' };
  const viewQueuedB = { id: 'view-queued-b' };
  let queuedAContext = null;

  register('/queued-a', (ctx) => {
    queuedAContext = ctx;
    return deferredQueuedA.promise;
  });
  register('/queued-b', () => viewQueuedB);

  go('/init');
  await flush();
  go('/queued-a'); // pending loader A owns the current generation
  await flush();
  expect('setup: queued-hashchange race captured loader A\'s current renderContext',
    queuedAContext?.isCurrent() === true);

  queueHashChange = true;
  go('/queued-b'); // URL changes now; B's hashchange render is deliberately held back

  expect('queued hashchange setup: URL changed to B while its render event is still pending',
    location.hash === '#/queued-b' && queuedHashChanges.length === 1);
  expect('different-hash go(): loader A is invalidated before hashchange dispatch',
    queuedAContext.isCurrent() === false,
    'GUARD DISCRIMINATOR — fails if go() waits for hashchange/render() to advance the generation');

  deferredQueuedA.resolve(viewQueuedA); // A settles before B's queued hashchange fires
  await flush();
  expect('queued hashchange gap: stale loader A cannot mount under B\'s already-updated URL',
    elements.app.children.length === 0,
    'GUARD DISCRIMINATOR — without synchronous invalidation, A mounts before B renders');

  dispatchNextHashChange();
  await flush();
  expect('queued hashchange delivery: route B mounts normally after its event is dispatched',
    queuedHashChanges.length === 0
      && elements.app.children.length === 1
      && elements.app.children[0] === viewQueuedB);
  queueHashChange = false;
}

// ── 2. Same-hash go(path) re-render follows the same latest-generation rule ─
// (acceptance: "Same-hash go(path) re-rendering follows the same latest-
// generation rule" — exercises go()'s `location.hash === target` branch,
// which calls render() directly rather than through a hash mutation.)
{
  const deferredsC = [];
  register('/c', () => {
    const d = makeDeferred();
    deferredsC.push(d);
    return d.promise;
  });

  go('/c');              // hash differs → sets location.hash → generation M
  await flush();
  go('/c');               // hash already === '#/c' → render() called directly → generation M+1
  await flush();
  expect('setup: same-hash go(/c) queued a second render (two independent loader calls)',
    deferredsC.length === 2);

  const viewC1 = { id: 'view-c1' };
  const viewC2 = { id: 'view-c2' };

  deferredsC[1].resolve(viewC2); // the second (latest) call settles first
  await flush();
  expect('same-hash re-render: the second (latest) call mounts',
    elements.app.children.length === 1 && elements.app.children[0] === viewC2);

  deferredsC[0].resolve(viewC1); // the first (now-stale) call settles last
  await flush();
  expect('same-hash re-render: the first (now-stale) call never mounts over the latest one',
    elements.app.children.length === 1 && elements.app.children[0] === viewC2);
}

// ── 3a. Redirect guards cannot let a discarded render mount later
// (settled-state case: no in-flight loader racing the redirect) ────────────
// (acceptance: "Redirects from welcome/driver guards cannot allow the
// discarded render to mount later")
{
  const viewWelcome = { id: 'view-welcome' };
  register('/welcome', () => viewWelcome);

  let gatedLoaderCalled = false;
  register('/gated', () => { gatedLoaderCalled = true; return { id: 'view-gated' }; });

  user.set({ welcomeSeen: false });
  go('/init'); // land somewhere else first so the next go() takes the hash-differs branch
  await flush();
  go('/gated'); // welcomeSeen=false → render() redirects to /welcome and returns immediately
  await flush();

  expect('welcome guard redirect: the gated route\'s loader is never invoked',
    !gatedLoaderCalled);
  expect('welcome guard redirect: only /welcome mounts, never the discarded target route',
    elements.app.children.length === 1 && elements.app.children[0] === viewWelcome);

  user.set({ welcomeSeen: true }); // restore for the remaining cases
}

// ── 3b. Redirect RACE — welcome guard: a genuinely in-flight, unrelated
// slow loader must not mount after a mid-flight welcome-guard redirect has
// already taken ownership of #app ───────────────────────────────────────────
// (Codex P2 follow-up on the 01A smoke — 3a only proved the redirect target
// mounts correctly from a settled, idle router; it never raced the guard
// against an already-suspended loader, so it could not tell the generation
// guard apart from a hypothetical unguarded implementation. This section
// closes that gap: the #app/tab-active assertions below are guard
// discriminators (verified by the negative sweep in scripts/dispatcher.mjs-
// adjacent tooling — see the repo's own guardless-variant check performed
// before this file was committed); the chrome-visibility assertions are
// included because the acceptance text names chrome, but they hold
// regardless of the guard — tabbar/fab/shell mutations are synchronous and
// run once per render() call, before any await, so a stale post-await
// continuation can never reach them either way.)
{
  const viewWelcome2 = { id: 'view-welcome-race' };
  register('/welcome', () => viewWelcome2); // re-register: same path, still a synchronous loader

  const deferredSlowW = makeDeferred();
  register('/slow-before-welcome-guard', () => deferredSlowW.promise);

  user.set({ welcomeSeen: true });
  go('/init');
  await flush();
  go('/slow-before-welcome-guard'); // generation P — suspends in flight, chrome set for this (non-hidden) path
  await flush();

  user.set({ welcomeSeen: false });
  go('/anywhere-else'); // generation P+1 — guard fires immediately, redirects to /welcome (generation P+2), returns before touching chrome/loader

  await flush();
  const viewSlowW = { id: 'view-slow-welcome-race' };
  deferredSlowW.resolve(viewSlowW); // the in-flight loader settles only AFTER the redirect already won ownership
  await flush();

  expect('welcome-guard RACE: the stale in-flight loader never mounts once the redirect owns #app',
    elements.app.children.length === 1 && elements.app.children[0] === viewWelcome2,
    'GUARD DISCRIMINATOR — fails if the generation guard is removed: the stale loader would additionally append');
  expect('welcome-guard RACE: chrome reflects /welcome (tabbar+fab hidden; shell has no-chrome, not has-tabbar/has-fab)',
    elements.tabbar.hidden === true && elements.fab.hidden === true
      && elements.shell.classList.has('no-chrome')
      && !elements.shell.classList.has('has-tabbar')
      && !elements.shell.classList.has('has-fab'),
    'holds regardless of the guard — chrome mutations are synchronous/pre-await, never reached by a stale continuation');

  user.set({ welcomeSeen: true }); // restore
}

// ── 3c. Redirect RACE — driver/passenger-order guard: same shape as 3b,
// covering redirectDriverPassengerOrderFlow (3a/3b only ever exercised the
// welcome guard) ────────────────────────────────────────────────────────────
{
  const viewDriverMap = { id: 'view-driver-map' };
  register('/driver-map', () => viewDriverMap);

  const deferredSlowD = makeDeferred();
  register('/slow-before-driver-guard', () => deferredSlowD.promise);

  user.set({ welcomeSeen: true, role: 'passenger' });
  go('/init');
  await flush();
  go('/slow-before-driver-guard'); // generation Q — suspends in flight, chrome set for this (non-hidden) path
  await flush();

  user.set({ role: 'driver' });
  go('/route-picker'); // generation Q+1 — a PASSENGER_ORDER_ROUTES path in driver mode: guard fires, redirects to /driver-map (generation Q+2)

  await flush();
  const viewSlowD = { id: 'view-slow-driver-race' };
  deferredSlowD.resolve(viewSlowD); // the in-flight loader settles only AFTER the redirect already won ownership
  await flush();

  expect('driver-guard RACE: the stale in-flight loader never mounts once the redirect owns #app',
    elements.app.children.length === 1 && elements.app.children[0] === viewDriverMap,
    'GUARD DISCRIMINATOR — fails if the generation guard is removed: the stale loader would additionally append');
  expect('driver-guard RACE: the /map tab (driver-map\'s special-cased tab) is active, not the stale route\'s',
    tabButtons[2].classList.has('active'),
    'GUARD DISCRIMINATOR — an unguarded stale syncTabActive(\'/slow-before-driver-guard\') would deactivate every known tab');
  expect('driver-guard RACE: chrome reflects /driver-map (tabbar visible, FAB hidden; shell has has-tabbar, not no-chrome/has-fab)',
    elements.tabbar.hidden === false && elements.fab.hidden === true
      && elements.shell.classList.has('has-tabbar')
      && !elements.shell.classList.has('no-chrome')
      && !elements.shell.classList.has('has-fab'),
    'holds regardless of the guard — chrome mutations are synchronous/pre-await, never reached by a stale continuation');

  user.set({ role: 'passenger' }); // restore
}

// ── 3d. renderContext generation binding — A→B→A: a stale render's
// isCurrent must stay false even after the hash cycles back to its own
// path (guards against a hash-equality staleness check, which a loader
// could wrongly treat as "still current" once the hash matches again)
// (BD-ROUTER-LIFECYCLE-01A P2 follow-up, ABA fix) ───────────────────────────
{
  const deferredAba1 = makeDeferred();
  let abaCallCount = 0;
  const capturedContexts = [];
  register('/aba', (ctx) => {
    abaCallCount += 1;
    capturedContexts.push(ctx);
    // First /aba visit: slow, stays in flight while the user navigates
    // away and back. Second visit: synchronous, mounts immediately.
    return abaCallCount === 1 ? deferredAba1.promise : { id: `view-aba-${abaCallCount}` };
  });
  register('/other-aba', () => ({ id: 'view-other-aba' }));

  go('/init');
  await flush();
  go('/aba');       // generation S — first /aba visit, suspends on deferredAba1
  await flush();
  go('/other-aba'); // generation S+1 — supersedes /aba while it is still in flight
  await flush();
  go('/aba');       // generation S+2 — second /aba visit: same hash as the stale one, fresh generation
  await flush();

  expect('setup: /aba was visited twice, each call received its own renderContext',
    capturedContexts.length === 2 && capturedContexts[0] !== capturedContexts[1]);
  expect('ABA: the second (latest) /aba visit already mounted before the first one\'s deferred settles',
    elements.app.children.length === 1 && elements.app.children[0].id === 'view-aba-2');

  const viewAba1Late = { id: 'view-aba-1-late' };
  deferredAba1.resolve(viewAba1Late); // the FIRST /aba visit's loader finally settles — long after the second visit already mounted, and after the hash has cycled back to #/aba
  await flush();

  expect('ABA RACE: the FIRST (stale, superseded) /aba render never mounts, even after the hash has cycled back to /aba',
    elements.app.children.length === 1 && elements.app.children[0].id === 'view-aba-2',
    'GUARD DISCRIMINATOR — fails if the generation guard is removed: the stale loader would additionally append');
  expect('ABA: the FIRST renderContext\'s isCurrent() reads false once resolved late — even though location.hash is back to #/aba',
    capturedContexts[0].isCurrent() === false,
    'GUARD DISCRIMINATOR — a hash-equality isCurrent (location.hash === startHash) would wrongly read true here, since the hash matches again');
  expect('ABA: the SECOND (latest) renderContext\'s isCurrent() reads true',
    capturedContexts[1].isCurrent() === true);
  expect('renderContext is frozen (a loader cannot mutate router-owned staleness state)',
    Object.isFrozen(capturedContexts[0]) && Object.isFrozen(capturedContexts[1]));
}

// ── 4. Existing synchronous screen loaders remain compatible ───────────────
// (acceptance: "Existing synchronous screen loaders remain compatible")
{
  const viewSync = { id: 'view-sync' };
  register('/sync', () => viewSync); // returns a plain object, not a Promise
  go('/init');
  await flush();
  go('/sync');
  await flush();
  expect('a synchronous (non-Promise-returning) loader still mounts correctly',
    elements.app.children.length === 1 && elements.app.children[0] === viewSync);
}

// ── 5. SW cache-revision parity — router.js is precached ───────────────────
const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
expect('public/sw.js VERSION bumped to v311+ (router.js is precached)',
  Number((sw.match(/VERSION\s*=\s*'v(\d+)'/) || [])[1] || 0) >= 311);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
