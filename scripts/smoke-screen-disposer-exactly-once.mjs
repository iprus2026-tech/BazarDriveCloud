// BD-SCREEN-LIFECYCLE-01A (#919) — SCREEN_DISPOSER_EXACTLY_ONCE regression guard.
//
// router.js's LATEST_ROUTE_RENDER_WINS generation guard (#917/#918) only ever
// decided whether a loader's RETURNED VIEW gets mounted — it had no hook for
// tearing down a screen's own background resources (timers, listeners,
// observers, controllers) once the router replaces it. This smoke proves the
// new optional loader result `{ view, dispose }`: the router owns invoking
// `dispose` exactly once, for whichever screen is actually mounted-and-
// current, at the very start of the NEXT render() call — before any guard
// check (a guard redirect can `return` before ever reaching
// root.replaceChildren()) — and that a STALE loader result (superseded
// before/while resolving) has its own `dispose` invoked immediately, exactly
// once, without ever becoming the current disposer.
//
// This is a REAL RUNTIME smoke, not a static source scan: it imports the
// actual public/src/router.js against a minimal hand-rolled DOM/location
// shim (same pattern as scripts/smoke-router-latest-render-wins.mjs), and
// drives it with hand-resolved deferred loaders. No browser, no network, no
// timers anywhere in this file — ordering is deterministic via explicit
// microtask-queue flushes only.
//
// Scope note: this file exercises the router-owned disposer contract in
// isolation. It does NOT import public/src/screens/map.js — doing so would
// pull in the real Mapbox SDK loader / geolocation / config module graph,
// which is out of the authorized file scope for this smoke and would not be
// dependency-free. The map.js pilot's own late-hydration disposed-guard is
// covered by direct code review instead (see the implementation report),
// not by a runtime assertion in this file. LIMITATION, recorded as required.

import fs from 'node:fs';

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// Scenario 11 (loader rejection) deliberately exercises a rejecting loader.
// router.js's render() does not (and, per #919's scope, is not required to)
// await/catch a rejecting loader's promise — a real browser wouldn't crash
// an event handler over it either. Swallow it here so THIS process doesn't
// terminate on Node's default fatal unhandledRejection behavior; the actual
// assertions for that scenario check the disposer-slot side effects instead.
process.on('unhandledRejection', () => {});

// ── in-memory Web Storage shim ──────────────────────────────────────────────
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
globalThis.document = {
  getElementById: (id) => elements[id] || null,
  querySelectorAll: () => [],
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

user.set({ welcomeSeen: true, role: 'passenger' });

function makeDeferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}
async function flush(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

register('/init', () => ({ id: 'view-init' }));
register('/welcome', () => ({ id: 'view-welcome' }));
start();
await flush();

// ── 1 & 2. mounted A → B, then A → B → C: A.dispose fires exactly once and
// is never re-invoked on the following navigation ───────────────────────────
{
  let disposeACount = 0;
  register('/lc-a', () => ({ view: { id: 'view-lc-a' }, dispose: () => { disposeACount += 1; } }));
  register('/lc-b', () => ({ id: 'view-lc-b' }));
  register('/lc-c', () => ({ id: 'view-lc-c' }));

  go('/lc-a');
  await flush();
  expect('setup: A mounted with a lifecycle result', elements.app.children[0].id === 'view-lc-a');
  expect('setup: A.dispose not called while A is still current', disposeACount === 0);

  go('/lc-b');
  await flush();
  expect('mounted A -> B: A.dispose called exactly once', disposeACount === 1);
  expect('mounted A -> B: B mounted', elements.app.children[0].id === 'view-lc-b');

  go('/lc-c');
  await flush();
  expect('A -> B -> C: A.dispose is NOT re-invoked (still exactly 1)', disposeACount === 1);
  expect('A -> B -> C: C mounted', elements.app.children[0].id === 'view-lc-c');
}

// ── 3. same-hash re-render: the old instance is disposed exactly once ──────
{
  let disposeCount = 0;
  let instanceCounter = 0;
  register('/lc-same-hash', () => {
    instanceCounter += 1;
    return { view: { id: `view-same-hash-${instanceCounter}` }, dispose: () => { disposeCount += 1; } };
  });

  go('/init');
  await flush();
  go('/lc-same-hash');
  await flush();
  expect('setup: first same-hash instance mounted', elements.app.children[0].id === 'view-same-hash-1');

  go('/lc-same-hash'); // same-hash: router.js calls render() directly, a genuinely new generation (#918 semantics)
  await flush();

  expect('same-hash re-render: old instance disposed exactly once', disposeCount === 1);
  expect('same-hash re-render: second instance mounted', elements.app.children[0].id === 'view-same-hash-2');
}

// ── 4. bare-node loader: fully backward compatible ──────────────────────────
{
  register('/lc-bare', () => ({ id: 'view-lc-bare' }));
  register('/lc-after-bare', () => ({ id: 'view-lc-after-bare' }));

  go('/init');
  await flush();
  go('/lc-bare');
  await flush();
  expect('bare-node loader: mounts normally', elements.app.children[0].id === 'view-lc-bare');

  go('/lc-after-bare'); // drains the (absent) disposer for the bare-node screen — must not throw
  await flush();
  expect('bare-node loader: navigating away is a safe no-op (no disposer to call) and the next route mounts',
    elements.app.children[0].id === 'view-lc-after-bare');
}

// ── 5, 6 & 7. stale async lifecycle result: never mounts, its own dispose
// fires exactly once immediately, and it never becomes the current disposer
// (proven by the CURRENT screen's own disposer still working correctly
// afterward, unaffected) ────────────────────────────────────────────────────
{
  const deferredStale = makeDeferred();
  let staleDisposeCount = 0;
  let currentCDisposeCount = 0;
  register('/lc-stale-b', () => deferredStale.promise);
  register('/lc-stale-c', () => ({ view: { id: 'view-stale-c' }, dispose: () => { currentCDisposeCount += 1; } }));
  register('/lc-after-stale', () => ({ id: 'view-lc-after-stale' }));

  go('/init');
  await flush();
  go('/lc-stale-b'); // B starts, suspends on the deferred
  await flush();
  go('/lc-stale-c'); // C supersedes B while B is still in flight
  await flush();
  expect('setup: C mounted while B is still pending', elements.app.children[0].id === 'view-stale-c');

  deferredStale.resolve({ view: { id: 'view-stale-b-late' }, dispose: () => { staleDisposeCount += 1; } });
  await flush();

  expect('stale async lifecycle result: stale view never mounts',
    elements.app.children.length === 1 && elements.app.children[0].id === 'view-stale-c',
    'GUARD DISCRIMINATOR — fails if the #918 generation guard is removed: stale B would additionally append');
  expect('stale async lifecycle result: stale dispose called exactly once', staleDisposeCount === 1);

  go('/lc-after-stale');
  await flush();
  expect('stale dispose never becomes current disposer: C\'s OWN disposer still fires exactly once on its own replacement, unaffected by the stale B disposal',
    currentCDisposeCount === 1);
}

// ── 8. stale A -> B -> A (ABA): the FIRST A's late disposer cannot dispose
// the SECOND (currently mounted) A's resources ──────────────────────────────
{
  const deferredAba1 = makeDeferred();
  let abaCallCount = 0;
  let firstADisposeCount = 0;
  let secondADisposeCount = 0;
  register('/lc-aba', () => {
    abaCallCount += 1;
    if (abaCallCount === 1) return deferredAba1.promise;
    return { view: { id: `view-lc-aba-${abaCallCount}` }, dispose: () => { secondADisposeCount += 1; } };
  });
  register('/lc-other-aba', () => ({ id: 'view-lc-other-aba' }));
  register('/lc-after-aba', () => ({ id: 'view-lc-after-aba' }));

  go('/init');
  await flush();
  go('/lc-aba');       // first visit, suspends
  await flush();
  go('/lc-other-aba'); // supersedes the first /lc-aba while it is still in flight
  await flush();
  go('/lc-aba');        // second visit: same hash as the stale one, fresh generation, synchronous lifecycle result
  await flush();

  expect('ABA: the second (latest) A visit is mounted', elements.app.children[0].id === 'view-lc-aba-2');

  deferredAba1.resolve({ view: { id: 'view-lc-aba-1-late' }, dispose: () => { firstADisposeCount += 1; } });
  await flush();

  expect('ABA: the FIRST A\'s stale dispose is called exactly once', firstADisposeCount === 1);
  expect('ABA: the first A\'s disposer never touches the SECOND (currently mounted) A — it stays mounted, untouched',
    elements.app.children.length === 1 && elements.app.children[0].id === 'view-lc-aba-2',
    'GUARD DISCRIMINATOR — fails if a stale dispose is allowed to overwrite/clear the current disposer slot');

  go('/lc-after-aba');
  await flush();
  expect('ABA: the second A\'s own disposer still fires exactly once on its own replacement (old A\'s dispose never interfered)',
    secondADisposeCount === 1);
}

// ── 9. guarded redirect: the previously mounted screen's disposer still
// fires exactly once, even though the welcome guard `return`s before ever
// reaching root.replaceChildren() ───────────────────────────────────────────
{
  let disposePrevCount = 0;
  let gatedLoaderCalled = false;
  register('/lc-guarded-prev', () => ({ view: { id: 'view-guarded-prev' }, dispose: () => { disposePrevCount += 1; } }));
  register('/lc-gated', () => { gatedLoaderCalled = true; return { id: 'view-gated' }; });

  user.set({ welcomeSeen: true });
  go('/init');
  await flush();
  go('/lc-guarded-prev');
  await flush();
  expect('setup: guarded-prev mounted with a lifecycle disposer', elements.app.children[0].id === 'view-guarded-prev');

  user.set({ welcomeSeen: false });
  go('/lc-gated'); // welcome guard fires, redirects to /welcome, returns before root.replaceChildren()
  await flush();

  expect('guarded redirect: previous mounted disposer is called exactly once, despite the guard returning before replaceChildren()',
    disposePrevCount === 1,
    'GUARD DISCRIMINATOR — fails if disposal is placed next to replaceChildren() instead of at the top of render()');
  expect('guarded redirect: the gated route\'s loader is never invoked', !gatedLoaderCalled);
  expect('guarded redirect: /welcome mounts', elements.app.children[0].id === 'view-welcome');

  user.set({ welcomeSeen: true }); // restore
}

// ── 10. synchronous lifecycle loader (no await gap at all) ─────────────────
{
  let syncDisposeCount = 0;
  register('/lc-sync', () => ({ view: { id: 'view-lc-sync' }, dispose: () => { syncDisposeCount += 1; } }));
  register('/lc-after-sync', () => ({ id: 'view-lc-after-sync' }));

  go('/init');
  await flush();
  go('/lc-sync');
  await flush();
  expect('synchronous lifecycle loader: mounts correctly', elements.app.children[0].id === 'view-lc-sync');

  go('/lc-after-sync');
  await flush();
  expect('synchronous lifecycle loader: disposer still fires exactly once on replacement', syncDisposeCount === 1);
}

// ── 11. loader rejection: does not create a wrong current disposer ─────────
{
  let disposeRejectPrevCount = 0;
  let disposeAfterRejectCount = 0;
  register('/lc-reject-prev', () => ({ view: { id: 'view-reject-prev' }, dispose: () => { disposeRejectPrevCount += 1; } }));
  register('/lc-rejects', () => Promise.reject(new Error('loader rejects (test)')));
  register('/lc-after-reject', () => ({ view: { id: 'view-after-reject' }, dispose: () => { disposeAfterRejectCount += 1; } }));
  register('/lc-after-reject-2', () => ({ id: 'view-after-reject-2' }));

  go('/init');
  await flush();
  go('/lc-reject-prev');
  await flush();
  expect('setup: reject-prev mounted with a lifecycle disposer', elements.app.children[0].id === 'view-reject-prev');

  go('/lc-rejects'); // drains + disposes reject-prev BEFORE the loader runs and rejects
  await flush();
  expect('loader rejection: the previously mounted screen was still disposed exactly once', disposeRejectPrevCount === 1);
  expect('loader rejection: nothing new mounted (root was cleared, loader never resolved)', elements.app.children.length === 0);

  go('/lc-after-reject'); // a fresh navigation after the rejection
  await flush();
  expect('loader rejection: does not corrupt the disposer slot — the next screen mounts and installs its own disposer normally',
    elements.app.children[0].id === 'view-after-reject' && disposeAfterRejectCount === 0);

  go('/lc-after-reject-2');
  await flush();
  expect('loader rejection: the screen mounted AFTER the rejection is still disposed exactly once on its own replacement',
    disposeAfterRejectCount === 1);
}

// ── 12. disposer throws: the next route mounts anyway ───────────────────────
{
  register('/lc-throws', () => ({ view: { id: 'view-lc-throws' }, dispose: () => { throw new Error('disposer throws (test)'); } }));
  register('/lc-after-throw', () => ({ id: 'view-lc-after-throw' }));

  go('/init');
  await flush();
  go('/lc-throws');
  await flush();
  expect('setup: throwing-disposer screen mounted', elements.app.children[0].id === 'view-lc-throws');

  go('/lc-after-throw'); // drains + invokes the throwing disposer
  await flush();

  expect('disposer throws: contained locally — the next route mounts anyway',
    elements.app.children[0].id === 'view-lc-after-throw');
}

// ── 13. different-hash queued hashchange gap: unchanged #918 ownership
// semantics, PLUS the stale disposer fires correctly inside that same gap ──
{
  const deferredQueuedA = makeDeferred();
  let queuedAContext = null;
  let queuedADisposeCount = 0;
  register('/lc-queued-a', (ctx) => { queuedAContext = ctx; return deferredQueuedA.promise; });
  register('/lc-queued-b', () => ({ id: 'view-lc-queued-b' }));

  go('/init');
  await flush();
  go('/lc-queued-a');
  await flush();

  queueHashChange = true;
  go('/lc-queued-b'); // URL changes now; B's hashchange render is deliberately held back

  expect('queued hashchange: different-hash go() invalidates A\'s ownership before hashchange dispatch (unchanged #918 semantics)',
    queuedAContext.isCurrent() === false);

  deferredQueuedA.resolve({ view: { id: 'view-lc-queued-a-late' }, dispose: () => { queuedADisposeCount += 1; } });
  await flush();

  expect('queued hashchange: stale A never mounts under B\'s already-updated URL', elements.app.children.length === 0);
  expect('queued hashchange: stale A\'s dispose is called exactly once even though B\'s hashchange has not dispatched yet',
    queuedADisposeCount === 1);

  dispatchNextHashChange();
  await flush();
  expect('queued hashchange: B mounts normally once its event is dispatched',
    queuedHashChanges.length === 0 && elements.app.children.length === 1 && elements.app.children[0].id === 'view-lc-queued-b');
  queueHashChange = false;
}

// ── 14. competing/re-entrant disposal: the cleared slot prevents a disposer
// from being invoked a second time even when it re-entrantly triggers
// navigation from inside itself ─────────────────────────────────────────────
{
  let reentrantDisposeCount = 0;
  register('/lc-reentrant-a', () => ({
    view: { id: 'view-reentrant-a' },
    dispose: () => {
      reentrantDisposeCount += 1;
      go('/lc-reentrant-b'); // re-entrant: triggered from inside the disposer that is currently running
    },
  }));
  register('/lc-reentrant-b', () => ({ id: 'view-reentrant-b' }));
  register('/lc-reentrant-c', () => ({ id: 'view-reentrant-c' }));

  go('/init');
  await flush();
  go('/lc-reentrant-a');
  await flush();
  expect('setup: reentrant-a mounted', elements.app.children[0].id === 'view-reentrant-a');

  go('/lc-reentrant-c'); // drains A's disposer, which re-entrantly calls go('/lc-reentrant-b') from inside itself
  await flush();

  expect('competing/re-entrant disposal: A\'s disposer is invoked exactly once despite a re-entrant navigation triggered from inside it',
    reentrantDisposeCount === 1,
    'GUARD DISCRIMINATOR — fails if the slot is cleared AFTER invoking the disposer instead of before: the re-entrant render() would still see the old disposer in the slot and invoke it again');
}

// ── 15. SW cache-revision parity — router.js and map.js are both precached ─
const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
expect('public/sw.js VERSION bumped to v312+ (router.js and map.js are both precached)',
  Number((sw.match(/VERSION\s*=\s*'v(\d+)'/) || [])[1] || 0) >= 312);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
