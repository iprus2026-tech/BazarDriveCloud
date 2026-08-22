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
// Fake tabbar buttons for /a and /b so syncTabActive's active-class toggling
// is genuinely exercised (BD-ROUTER-LIFECYCLE-01A acceptance: "a stale
// render never overwrites the newer tab-active/chrome result").
const tabButtons = [
  { dataset: { route: '/a' }, classList: makeClassList() },
  { dataset: { route: '/b' }, classList: makeClassList() },
];
globalThis.document = {
  getElementById: (id) => elements[id] || null,
  querySelectorAll: (sel) => (sel === '#tabbar [data-route]' ? tabButtons : []),
};

let currentHash = '#/init';
let hashChangeHandler = null;
globalThis.window = {
  addEventListener(type, handler) {
    if (type === 'hashchange') hashChangeHandler = handler;
  },
};
globalThis.location = {
  get hash() { return currentHash; },
  // Real browsers fire hashchange asynchronously; this shim dispatches
  // synchronously (matching how `window.addEventListener('hashchange', render)`
  // is fire-and-forget either way — nothing here awaits the handler's
  // returned Promise, exactly like a real event dispatch wouldn't).
  set hash(value) {
    const next = value.startsWith('#') ? value : `#${value}`;
    if (next === currentHash) return;
    currentHash = next;
    if (hashChangeHandler) hashChangeHandler();
  },
};

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

// ── 3. Redirect guards cannot let a discarded render mount later ───────────
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
expect('public/sw.js VERSION bumped to v308+ (router.js is precached)',
  Number((sw.match(/VERSION\s*=\s*'v(\d+)'/) || [])[1] || 0) >= 308);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
