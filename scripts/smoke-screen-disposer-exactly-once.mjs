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
// Scope note: sections 1-15, 15b and 17 exercise the router-owned disposer
// contract in isolation with plain fake loaders. Section 16 (independent
// review fix, P2-2) additionally imports the REAL public/src/screens/map.js
// and drives it through the REAL router, with a deterministic Mapbox SDK
// shim (a fake window.mapboxgl.Map, a captured <script>.onload, a
// deterministic requestAnimationFrame/setInterval queue) — no network, no
// real timers, no real Mapbox SDK execution. mapbox_config.js and
// mapbox_loader.js are exercised for real (not reimplemented or copied), via
// mapbox_config.js's own documented globalThis.__BD_MAPBOX_TOKEN__ test/dev
// override. Section 15b (independent review fix, P2-3) covers render()'s
// own top-of-function drain reentrancy — distinct from section 14/15's
// go()-level (P2-1) reentrancy — and runs BEFORE section 16 deliberately,
// since section 16 permanently swaps globalThis.document/window and never
// restores them.

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
// navigation from inside itself. Since P2-1 (below), different-hash go()
// drains synchronously, so this now exercises reentrancy AT THE go() LEVEL
// (a disposer calling go() from inside go()'s own synchronous drain step) —
// previously this only ever happened inside render(). ──────────────────────
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
  expect('competing/re-entrant disposal: the re-entrant navigation (B) is not lost — it is chronologically the latest claim on location.hash, so it wins and mounts; the original outer call (C) correctly backs off instead of clobbering it',
    elements.app.children.length === 1 && elements.app.children[0].id === 'view-reentrant-b',
    'proves go()\'s post-drain generation re-check (P2-1) does not just avoid a crash — it correctly defers ownership to whichever navigation actually ends up latest');
}

// ── 15. P2-1 (independent review fix, Issue #919) — a different-hash go()
// drains the current disposer SYNCHRONOUSLY, right there in go() itself —
// not merely by the time the eventual hashchange-triggered render() call
// happens. This is the discriminating case scenario 13 (above) did not
// cover: that scenario's stale disposer belonged to a loader that was
// still IN FLIGHT when superseded; this one belongs to a screen that was
// already fully MOUNTED AND IDLE before the different-hash go() call. ─────
{
  let disposeACount = 0;
  register('/lc-sync-drain-a', () => ({ view: { id: 'view-sync-drain-a' }, dispose: () => { disposeACount += 1; } }));
  register('/lc-sync-drain-b', () => ({ id: 'view-sync-drain-b' }));

  go('/init');
  await flush();
  go('/lc-sync-drain-a');
  await flush();
  expect('setup: A mounted with a lifecycle disposer', elements.app.children[0].id === 'view-sync-drain-a');
  expect('setup: A.dispose not called while A is still current', disposeACount === 0);

  queueHashChange = true;
  go('/lc-sync-drain-b'); // different-hash — must drain A's disposer synchronously, right here, before B's hashchange ever dispatches

  expect('P2-1: A.dispose is called exactly once SYNCHRONOUSLY inside go(), before B\'s hashchange event has been delivered',
    disposeACount === 1,
    'GUARD DISCRIMINATOR — fails if go() does not synchronously drain the current disposer: this would still read 0 here, only becoming 1 once the queued hashchange is later dispatched');
  expect('P2-1: B has not mounted yet — only A\'s disposer fired early, A\'s view stays mounted until B\'s queued render actually runs',
    elements.app.children.length === 1 && elements.app.children[0].id === 'view-sync-drain-a');

  dispatchNextHashChange();
  await flush();

  expect('P2-1: B mounts once its hashchange event is delivered', elements.app.children[0].id === 'view-sync-drain-b');
  expect('P2-1: A.dispose is NOT invoked a second time when B\'s later render() runs its own (now-redundant) drain',
    disposeACount === 1);
  queueHashChange = false;
}

// ── 15b. P2-3 (independent review fix, Issue #919) — render()'s OWN
// top-of-function drain reentrancy. Distinct from scenario 14 (go()-level
// P2-1 reentrancy: a disposer re-entrantly calling go() from inside go()'s
// own synchronous drain) and scenario 15 above (P2-1's synchronous-drain
// timing): this drives reentrancy from inside render()'s OWN
// drainCurrentDisposer() call instead — reached via a SAME-hash go(), which
// calls render() directly (go() itself is never involved in this path at
// all). Before this fix, render() had no post-drain generation recheck
// (unlike go()'s P2-1 guard), so a disposer that re-entrantly triggers a
// DIFFERENT-hash navigation from inside render()'s drain would leave the
// outer, now-stale render() free to keep running: it would read the
// already-mutated location.hash, pass every guard, and invoke the NEW
// route's loader before the real (queued) hashchange for that route ever
// fired. Placed here, before section 16, deliberately: section 16
// permanently swaps globalThis.document/window for its own richer DOM shim
// and never restores them, so this scenario (which needs the plain
// elements/hashChangeHandler shim from the top of this file) must run
// before that swap happens. ─────────────────────────────────────────────
{
  let renderReentrantDisposeACount = 0;
  let renderReentrantCLoaderCalls = 0;
  register('/lc-render-reentrant-a', () => ({
    view: { id: 'view-render-reentrant-a' },
    dispose: () => {
      renderReentrantDisposeACount += 1;
      go('/lc-render-reentrant-c'); // re-entrant, DIFFERENT hash, triggered from render()'s OWN drain (not go()'s)
    },
  }));
  register('/lc-render-reentrant-c', () => {
    renderReentrantCLoaderCalls += 1;
    return { id: 'view-render-reentrant-c' };
  });

  go('/init');
  await flush();
  go('/lc-render-reentrant-a');
  await flush();
  expect('render()-drain reentrancy setup: A mounted', elements.app.children[0].id === 'view-render-reentrant-a');
  expect('render()-drain reentrancy setup: disposeACount is 0 before any re-render', renderReentrantDisposeACount === 0);

  queueHashChange = true;
  go('/lc-render-reentrant-a'); // SAME hash: go() calls render() directly, not the P2-1 go()-level path at all

  expect('render()-drain reentrancy: A.dispose() was invoked exactly once by render()\'s own top-of-function drain',
    renderReentrantDisposeACount === 1);
  expect('render()-drain reentrancy: CRITICAL — C\'s loader has NOT been invoked yet (correct ownership stops the stale outer render() immediately after losing generation ownership during its own drain)',
    renderReentrantCLoaderCalls === 0,
    'GUARD DISCRIMINATOR — fails if render() lacks a post-drain generation recheck: the stale outer render() would proceed to invoke C\'s loader before the real hashchange for C is ever dispatched');
  expect('render()-drain reentrancy: C not mounted yet (still queued)',
    elements.app.children[0]?.id !== 'view-render-reentrant-c');
  expect('render()-drain reentrancy: exactly one hashchange is queued (for C)', queuedHashChanges.length === 1);

  dispatchNextHashChange();
  await flush();

  expect('render()-drain reentrancy: C\'s loader is called exactly once total, by the real hashchange-triggered render()',
    renderReentrantCLoaderCalls === 1);
  expect('render()-drain reentrancy: C is mounted exactly once',
    elements.app.children.length === 1 && elements.app.children[0].id === 'view-render-reentrant-c');
  queueHashChange = false;
}

// ── 16. P2-2 (independent review fix, Issue #919) — map.js pilot late-
// hydration behavioral coverage, against the REAL map.js through the REAL
// router. Closes MAP_LATE_HYDRATION_TEST_GAP. ───────────────────────────────
{
  // A richer, generic fake DOM element. Sections 1-15 above use a flat,
  // minimal shim (plain {id} objects as "views") that is enough for a
  // generic lifecycle loader, but map.js's actual render path (via
  // map_shell.js) touches innerHTML, insertAdjacentHTML, dataset,
  // setAttribute/getAttribute/removeAttribute, and a real recursive
  // document.body.contains() containment check — none of which the
  // simpler shim models. This element factory is scoped to this section
  // only (installed via a temporary globalThis.document/window swap).
  function makeRichElement(tag) {
    const kids = [];
    const attrs = {};
    return {
      tagName: tag,
      className: '',
      textContent: '',
      innerHTML: '',
      dataset: {},
      style: {},
      src: '', href: '', rel: '', async: false,
      onload: null, onerror: null,
      children: kids,
      setAttribute(name, value) { attrs[name] = String(value); },
      getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
      removeAttribute(name) { delete attrs[name]; },
      appendChild(child) { kids.push(child); return child; },
      insertAdjacentHTML() { /* content not queried by these scenarios */ },
      replaceChildren(...nodes) { kids.length = 0; kids.push(...nodes); },
      addEventListener() {},
      removeEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      classList: { toggle() {}, add() {}, remove() {}, has() { return false; } },
    };
  }
  function richContains(root, target) {
    if (root === target) return true;
    for (const child of root.children || []) {
      if (richContains(child, target)) return true;
    }
    return false;
  }

  const richApp    = makeRichElement('div');
  const richTabbar = { hidden: false, classList: { toggle() {}, has() { return false; } } };
  const richFab    = { hidden: false, classList: { toggle() {}, has() { return false; } } };
  const richShell  = { classList: { toggle() {}, has() { return false; } } };
  const richHead   = makeRichElement('head');
  const richBody   = { children: [richApp], contains(node) { return richContains(richBody, node); } };

  globalThis.document = {
    createElement: (tag) => makeRichElement(tag),
    getElementById: (id) => ({ app: richApp, tabbar: richTabbar, fab: richFab, shell: richShell }[id] || null),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: richBody,
    head: richHead,
  };
  globalThis.window = { addEventListener() {}, location };

  // Deterministic requestAnimationFrame: queued, never auto-flushed.
  const rafQueue = [];
  globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
  function flushRaf() { const queued = rafQueue.splice(0); for (const cb of queued) cb(); }

  // Deterministic setInterval/clearInterval: captures the backstop's
  // callback instead of scheduling a real 2s timer; the test invokes it
  // explicitly (MAP-D) rather than waiting.
  let capturedIntervalCallback = null;
  let intervalWasCleared = false;
  globalThis.setInterval = (cb) => { capturedIntervalCallback = cb; intervalWasCleared = false; return 1; };
  globalThis.clearInterval = () => { intervalWasCleared = true; };

  // Deterministic Mapbox SDK: the REAL loadMapboxSdk() (unmodified) injects
  // a <link> and a <script> via document.head.appendChild — capture the
  // script's onload so the test controls exactly when the "SDK finished
  // loading" moment happens, instead of a real network fetch.
  let capturedScriptOnload = null;
  const realHeadAppendChild = richHead.appendChild.bind(richHead);
  richHead.appendChild = (node) => {
    if (node && node.tagName === 'script') capturedScriptOnload = node.onload;
    return realHeadAppendChild(node);
  };

  let fakeMapCtorCalls = 0;
  const fakeMapInstances = [];
  class FakeMapboxMap {
    constructor(opts) {
      fakeMapCtorCalls += 1;
      this.opts = opts;
      this.removeCallCount = 0;
      fakeMapInstances.push(this);
    }
    remove() { this.removeCallCount += 1; }
  }
  function resolveFakeSdkLoad() {
    // Mirrors what the real vendored UMD script does as a side effect of
    // executing, before the browser fires the <script>'s load event.
    globalThis.window.mapboxgl = { Map: FakeMapboxMap, accessToken: null };
    if (capturedScriptOnload) capturedScriptOnload();
  }

  globalThis.__BD_MAPBOX_TOKEN__ = 'test-token-bd-screen-lifecycle-01a'; // mapbox_config.js's own documented test/dev override

  const { default: mapScreen } = await import('../public/src/screens/map.js');
  const { unloadMapboxSdk } = await import('../public/src/mapbox/mapbox_loader.js');
  unloadMapboxSdk(); // start this section with a clean (unmemoized) SDK-load state

  register('/lc-map-a', mapScreen);
  register('/lc-map-b', mapScreen);
  register('/lc-map-c', mapScreen);
  register('/lc-map-away-1', () => ({ id: 'view-map-away-1' }));
  register('/lc-map-away-2', () => ({ id: 'view-map-away-2' }));
  register('/lc-map-away-3', () => ({ id: 'view-map-away-3' }));

  go('/init');
  await flush();

  // MAP-A — dispose before the SDK Promise resolves. The "away" navigation
  // uses queued hashchange delivery so the DOM stays attached THROUGHOUT
  // this scenario — document.body.contains(container) would otherwise
  // independently ALSO catch a de-mounted screen, which would make this
  // scenario fail to actually isolate lifecycle.disposed as the guard
  // under test. Queuing (and never dispatching until afterward) keeps
  // document.body.contains(container) reading true the whole time, so
  // lifecycle.disposed is the ONLY thing that can prevent late hydration.
  go('/lc-map-a?state=default'); // ?state=default forces MAP_STATE.DEFAULT deterministically (bypasses prefs/geo-permission resolution)
  await flush();
  expect('MAP-A setup: /map mounted in the live DEFAULT state (hydrateRealMap was invoked; the SDK promise is still pending)',
    richApp.children.length === 1 && fakeMapCtorCalls === 0);

  queueHashChange = true;
  go('/lc-map-away-1'); // P2-1 disposes A synchronously; the away route's own render (and DOM replaceChildren) stays queued/undelivered
  expect('MAP-A setup: the DOM is still attached at this point (replaceChildren has not run yet) — document.body.contains(container) would still read true',
    richApp.children.length === 1);
  queueHashChange = false; // only the queued away-1 hashchange itself stays pending in queuedHashChanges[]

  resolveFakeSdkLoad(); // the SDK "finishes loading" only now, after the screen was already disposed (but while still DOM-attached)
  await flush();
  flushRaf();
  await flush();

  expect('MAP-A: a disposed screen does not resurrect a Mapbox GL resource once its pending SDK load finally resolves, even though it is still DOM-attached',
    fakeMapCtorCalls === 0,
    'GUARD DISCRIMINATOR — fails if hydrateRealMap does not check lifecycle.disposed before constructing the map (document.body.contains alone would NOT catch this — the DOM is still attached)');

  dispatchNextHashChange(); // deliver the queued away-1 hashchange now, cleanly settling this scenario before MAP-B begins
  await flush();

  // MAP-B — dispose after the SDK resolves but before the queued RAF runs.
  // Same queued-hashchange isolation as MAP-A, for the same reason.
  go('/lc-map-b?state=default');
  await flush(); // the (already-resolved, memoized) SDK promise settles -> requestAnimationFrame(cb) is queued, NOT yet run
  expect('MAP-B setup: the hydration RAF callback is queued but not yet executed', rafQueue.length === 1);

  queueHashChange = true;
  go('/lc-map-away-2'); // dispose in the gap between SDK-resolve and RAF execution; DOM detach stays queued/undelivered too
  expect('MAP-B setup: the DOM is still attached at this point', richApp.children.length === 1);
  queueHashChange = false;

  flushRaf(); // now let the queued RAF callback run, against the already-disposed (but still DOM-attached) screen
  await flush();

  expect('MAP-B: a disposed screen does not construct a Mapbox GL resource when its queued RAF callback finally runs, even though it is still DOM-attached',
    fakeMapCtorCalls === 0,
    'GUARD DISCRIMINATOR — fails if the RAF callback does not check lifecycle.disposed before constructing the map (document.body.contains alone would NOT catch this either)');

  dispatchNextHashChange();
  await flush();

  // MAP-C — the map is actually constructed, then router-owned disposal
  // must free it IMMEDIATELY (not wait for the 2s backstop poll).
  go('/lc-map-c?state=default');
  await flush();  // SDK resolves -> RAF queued
  flushRaf();     // RAF runs -> mapboxgl.Map constructed this time
  await flush();
  expect('MAP-C setup: the Mapbox GL map is actually constructed exactly once', fakeMapCtorCalls === 1 && fakeMapInstances.length === 1);
  const mapInstance = fakeMapInstances[0];
  expect('MAP-C setup: the constructed instance has not been removed yet', mapInstance.removeCallCount === 0);

  go('/lc-map-away-3'); // P2-1 makes this drain (and dispose the map) SYNCHRONOUSLY, inside go() itself — no flush needed
  expect('MAP-C: router-owned disposal frees the Mapbox GL resource IMMEDIATELY on navigation, synchronously, not after waiting up to 2s for the defensive poll',
    mapInstance.removeCallCount === 1,
    'GUARD DISCRIMINATOR — fails if dispose() does not call mapInstance.remove(), or if disposal is not synchronous with go()');
  expect('MAP-C: navigating away did not itself construct a new map', fakeMapCtorCalls === 1);

  // MAP-D — the defensive 2s backstop poll firing AFTER router-owned
  // disposal already ran must be a safe no-op (no double teardown).
  expect('MAP-D setup: the backstop interval callback was captured during MAP-C\'s hydration', typeof capturedIntervalCallback === 'function');
  capturedIntervalCallback(); // simulate the backstop's poll tick firing late, after disposal already happened
  expect('MAP-D: the backstop firing after router-owned disposal is a safe no-op — its own disposed-guard returns before touching map.remove() again',
    mapInstance.removeCallCount === 1,
    'GUARD DISCRIMINATOR — fails (removeCallCount would become 2) if the backstop does not check lifecycle.disposed before calling map.remove() again');
  expect('MAP-D: the backstop clears its own interval when it observes disposal', intervalWasCleared === true);
}

// ── 17. SW cache-revision parity — router.js and map.js are both precached ─
const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
expect('public/sw.js VERSION bumped to v312+ (router.js and map.js are both precached)',
  Number((sw.match(/VERSION\s*=\s*'v(\d+)'/) || [])[1] || 0) >= 312);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
