// BD-TG-MINIAPP-01 M2 (#1126) — the router's read-only rendered-route seam (getRenderedRoute /
// onRouteRendered) used by the Telegram bridge. Real public/src/router.js, with the same minimal
// DOM shim pattern as smoke-router-latest-render-wins.mjs. It pins:
// - the seam reports the route that actually RENDERED: the /order/<id> prefix rule, and the /feed
//   fallback for an unknown hash, which keeps its text;
// - observers run once per mount, after the view is mounted;
// - a stale render never publishes, and a throwing observer changes nothing;
// - routing itself is unchanged.

import fs from 'node:fs';

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

function makeClassList() {
  const set = new Set();
  return { toggle(cls, force) { if (force) set.add(cls); else set.delete(cls); }, has: (cls) => set.has(cls) };
}
function makeElement(id) {
  return {
    id, hidden: false, classList: makeClassList(), children: [],
    replaceChildren() { this.children = []; },
    appendChild(node) { this.children.push(node); },
  };
}
const elements = { app: makeElement('app'), tabbar: makeElement('tabbar'), fab: makeElement('fab'), shell: makeElement('shell') };
globalThis.document = { getElementById: (id) => elements[id] || null, querySelectorAll: () => [] };

let currentHash = '#/init';
let hashChangeHandler = null;
globalThis.window = { addEventListener(type, handler) { if (type === 'hashchange') hashChangeHandler = handler; } };
globalThis.location = {
  get hash() { return currentHash; },
  set hash(value) {
    const next = value.startsWith('#') ? value : `#${value}`;
    if (next === currentHash) return;
    currentHash = next;
    if (hashChangeHandler) hashChangeHandler();
  },
};

const router = await import('../public/src/router.js');
const { register, go, start, getRenderedRoute, onRouteRendered } = router;
const { user } = await import('../public/src/state.js');
user.set({ welcomeSeen: true, role: 'passenger' });

async function flush(times = 6) { for (let i = 0; i < times; i++) await Promise.resolve(); }
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }

expect('the seam exists: getRenderedRoute + onRouteRendered are exported functions',
  typeof getRenderedRoute === 'function' && typeof onRouteRendered === 'function');
expect('before start(): nothing has rendered (null)', getRenderedRoute() === null);

const views = {
  init: { id: 'view-init' }, feed: { id: 'view-feed' }, a: { id: 'view-a' }, order: { id: 'view-order' }, b: { id: 'view-b' },
};
register('/init', () => views.init);
register('/feed', () => views.feed);
register('/a', () => views.a);
register('/order', () => views.order);
let slowA = null;
register('/slow', () => slowA.promise);
register('/b', () => views.b);

const seen = [];
const mountedAtCall = [];
const unsubscribe = onRouteRendered((route) => {
  seen.push(route);
  mountedAtCall.push(elements.app.children[0]?.id ?? null);
});

start();
await flush();
expect('start(): the first mount publishes its route', getRenderedRoute() === '/init' && seen.join(',') === '/init', seen.join(','));
expect('observers run AFTER the view is mounted', mountedAtCall[0] === 'view-init', String(mountedAtCall[0]));

go('/a');
await flush();
expect('a registered route publishes itself, once per mount', getRenderedRoute() === '/a' && seen.slice(1).join(',') === '/a', seen.join(','));

go('/bogus');
await flush();
expect('an unknown hash renders the /feed fallback, keeps its text, and the seam reports /feed',
  elements.app.children[0] === views.feed && location.hash === '#/bogus' && getRenderedRoute() === '/feed', `${location.hash} ${getRenderedRoute()}`);

go('/order/ord_1');
await flush();
expect('/order/<id> renders the /order loader and the seam reports /order',
  elements.app.children[0] === views.order && getRenderedRoute() === '/order', String(getRenderedRoute()));

// A throwing observer must not change the mount or starve the other observers.
const stopThrower = onRouteRendered(() => { throw new Error('observer failure'); });
let threw = false;
try {
  go('/a');
  await flush();
} catch {
  threw = true;
}
expect('a throwing observer changes nothing: no exception, the route mounts, the others still run',
  !threw && elements.app.children[0] === views.a && seen[seen.length - 1] === '/a', seen.join(','));
stopThrower();

// A stale render (slow /slow overtaken by /b) never publishes.
slowA = deferred();
const before = seen.length;
go('/slow');
await flush();
go('/b');
await flush();
slowA.resolve({ id: 'view-slow' });
await flush();
expect('a stale render never publishes: only the newer route is reported',
  getRenderedRoute() === '/b' && seen.slice(before).join(',') === '/b' && elements.app.children[0] === views.b, seen.slice(before).join(','));

unsubscribe();
const afterUnsub = seen.length;
go('/a');
await flush();
expect('unsubscribe stops notifications (the seam still tracks the route)', seen.length === afterUnsub && getRenderedRoute() === '/a');
expect('a non-function observer is ignored', typeof onRouteRendered(null) === 'function');

// ── Routing unchanged (static) ─────────────────────────────────────────────────
const src = fs.readFileSync(new URL('../public/src/router.js', import.meta.url), 'utf8');
expect('routing lines are intact: /order prefix rule, /feed fallback loader, welcome guard',
  src.includes("if (!routes.has(lookupPath) && lookupPath.startsWith('/order/')) {")
  && src.includes("const loader = routes.get(lookupPath) ?? routes.get('/feed');")
  && src.includes("if (!admission?.skipWelcome && !u.welcomeSeen && path !== '/welcome' && !isDevDocsRoute) {"));
const renderBody = src.slice(src.indexOf('async function render()'), src.indexOf('// BD-TG-MINIAPP-01 M2'));
expect('render() publishes exactly once, as its last statement, right after syncTabActive(path)',
  (renderBody.match(/publishRenderedRoute\(/g) || []).length === 1
  && /syncTabActive\(path\);\n {2}publishRenderedRoute\(routes\.has\(lookupPath\) \? lookupPath : '\/feed'\);\n\}/.test(renderBody));
const seam = src.slice(src.indexOf('// BD-TG-MINIAPP-01 M2'), src.indexOf('function syncTabActive('));
expect('the seam only reads: no navigation, no re-render, no hash/history/DOM writes',
  seam.length > 0 && !/\bgo\(|\brender\(|location|history|replaceChildren|appendChild|innerHTML/.test(seam.replace(/^\s*\/\/.*$/gm, '')));

console.log('\n' + (issues.length ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ') : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
