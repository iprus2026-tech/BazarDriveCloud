// BD-DATA-STATIC-01 (#636) — backend-readiness gate: lock the static-data surface.
//
// Why: the Phase-1 data-layer migration (#584, ADR BD-DOCS-030/031) must replace
// every per-client localStorage store with the backend as the single source of
// truth. To do that module-by-module with a green/red signal — and so a new
// untracked store can never be added silently (the gap that once let
// `bazardrive.order_overlay.v1` live OUTSIDE `storage_boundary.js`) — this check
// locks the surface against a curated manifest AND verifies the clear-on-boundary
// contract behaviourally.
//
// Axis note: the manifest classifies keys by whether `clearUserScopedStorage()`
// wipes them — what this gate verifies. Two of the not-cleared keys (`user.v1`,
// `smoke_role.v1`) ARE still reset at logout, but by the auth flow
// (`resetLocalSession()` → `user.reset()` / `clearSmokeRole()`), not by this
// function. The orthogonal **migration** axis (server-owned -> backend vs
// client-only -> stays) is owned by BD-DOCS-031; this gate does not assert it.
//
// Mostly static (reads source, asserts). The clear-on-boundary check imports
// `storage_boundary.js` under a localStorage shim and runs it — no DOM, no
// network, no real behaviour change.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const SRC = path.join(root, 'public', 'src');
const BOUNDARY = path.join(SRC, 'storage_boundary.js');
const BOUNDARY_REL = path.relative(root, BOUNDARY);

const issues = [];
function expect(label, cond, detail) {
  const d = detail ? ' (' + detail + ')' : '';
  if (!cond) issues.push(label + d);
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + d);
}

// ── Canonical manifest ────────────────────────────────────────────────────────
// CLEARED — removed by clearUserScopedStorage() at the auth boundary.
const CLEARED = [
  'bazardrive.ride_history.v1', 'bazardrive.favorite_routes.v1',
  'bazardrive.favorite_route_notice.v1', 'bazardrive.active_ride.v1',
  'bazardrive.chat.v1', 'bazardrive.responses.v1', 'bazardrive.respond.v1',
  'bazardrive.trip_confirmation.v1', 'bazardrive.driver_handoff_snapshot.v1',
  'bazardrive.draft.v2', 'bazardrive.repeat_route.v1', 'bazardrive.route_draft.v1',
  'bazardrive.order_form.v1', 'bazardrive.ride_orders.v1',
  'bazardrive.driver_receipts.v1', 'bazardrive.driver_offers.v1',
  'bazardrive.order_overlay.v1', 'bazardrive.myposts.v1', 'profileTripDemo',
];
// NOT_CLEARED — untouched by clearUserScopedStorage(). `documented:true` means the
// key must appear in storage_boundary.js's audit; ops.mel is deliberately outside it.
const NOT_CLEARED = [
  { key: 'bazardrive.user.v1', documented: true },      // reset by auth flow (user.reset)
  { key: 'bazardrive.smoke_role.v1', documented: true }, // reset by auth flow (clearSmokeRole)
  { key: 'bazardrive.posts.v1', documented: true },      // global cache, survives
  { key: 'bazardrive.map_prefs.v1', documented: true },  // device pref, survives
  { key: 'bazardrive.debug.publish', documented: true }, // dev flag, survives
  { key: 'bazardrive.ops.mel.v1', documented: false },   // dev tooling, out of boundary
];
const NOT_CLEARED_KEYS = NOT_CLEARED.map((e) => e.key);
const DOCUMENTED = [...CLEARED, ...NOT_CLEARED.filter((e) => e.documented).map((e) => e.key)];
const ALL = [...CLEARED, ...NOT_CLEARED_KEYS];
const MANIFEST = new Set(ALL);

// ── 0. Disjoint classification ────────────────────────────────────────────────
const dupes = ALL.filter((k, i) => ALL.indexOf(k) !== i);
expect('manifest classes are disjoint — no key classified twice', dupes.length === 0,
  dupes.length ? 'duplicated: ' + [...new Set(dupes)].join(', ') : '');

// ── Discover storage keys in public/src/** (comments stripped) ────────────────
// Two passes, unioned: (a) any `bazardrive.*` / `profileTripDemo` literal (keys
// stored via a constant), and (b) ANY string literal passed to a localStorage /
// sessionStorage get/set/removeItem call (catches a new store that does NOT use
// the bazardrive prefix). Comments are stripped first so a key named only in a
// comment is not treated as a live reference, and dynamic `${...}` keys are kept
// (they must be classified or fail, not silently dropped).
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function listJs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJs(p));
    else if (e.isFile() && e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const prefixRe = /['"`](bazardrive\.[^'"`]+|profileTripDemo)['"`]/g;
const apiRe = /(?:local|session)Storage\.(?:get|set|remove)Item\(\s*['"`]([^'"`]+)['"`]/g;
function discoverIn(files) {
  const set = new Set();
  for (const f of files) {
    const txt = stripComments(fs.readFileSync(f, 'utf8'));
    let m;
    while ((m = prefixRe.exec(txt))) set.add(m[1]);
    while ((m = apiRe.exec(txt))) set.add(m[1]);
  }
  return set;
}
const allFiles = listJs(SRC);
const discovered = discoverIn(allFiles);
const inOwners = discoverIn(allFiles.filter((f) => path.relative(root, f) !== BOUNDARY_REL));

// ── 1. No orphan ──────────────────────────────────────────────────────────────
const orphans = [...discovered].filter((k) => !MANIFEST.has(k));
expect('no orphan storage key in public/src — every key (any prefix, incl. dynamic) is classified',
  orphans.length === 0, orphans.length ? 'orphans: ' + orphans.join(', ') : '');

// ── 2. No stale ───────────────────────────────────────────────────────────────
const stale = ALL.filter((k) => !inOwners.has(k));
expect('no stale manifest entry — every key is still referenced (in code) by an owner module',
  stale.length === 0, stale.length ? 'stale: ' + stale.join(', ') : '');

// ── 3. storage_boundary.js documents every boundary key ───────────────────────
const boundary = fs.readFileSync(BOUNDARY, 'utf8');
const undocumented = DOCUMENTED.filter((k) => !boundary.includes(k));
expect('storage_boundary.js documents every boundary key (cleared + documented not-cleared)',
  undocumented.length === 0, undocumented.length ? 'undocumented: ' + undocumented.join(', ') : '');

// ── 4. Behavioural clear-on-boundary contract ─────────────────────────────────
// Seed every key, run the real clearUserScopedStorage() under a localStorage shim,
// assert CLEARED keys' data is gone and NOT_CLEARED keys are preserved verbatim.
const store = new Map();
const SENTINEL = 'SMOKE_SENTINEL_v1';
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };
globalThis.window = globalThis;
globalThis.document = {
  addEventListener() {}, removeEventListener() {}, querySelector: () => null,
  querySelectorAll: () => [], getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, appendChild() {} }),
};
globalThis.location = globalThis.location || { hash: '', href: 'http://localhost/', search: '', pathname: '/' };

try {
  const mod = await import(pathToFileURL(BOUNDARY).href);
  for (const k of ALL) localStorage.setItem(k, SENTINEL);
  mod.clearUserScopedStorage();
  const isCleared = (v) => v === null || v === '' || v === '{}' || v === '[]';
  const leaked = CLEARED.filter((k) => !isCleared(localStorage.getItem(k)));
  expect('clearUserScopedStorage() actually clears every cleared key (no logout data leak)',
    leaked.length === 0, leaked.length ? 'NOT cleared: ' + leaked.join(', ') : '');
  const wiped = NOT_CLEARED_KEYS.filter((k) => localStorage.getItem(k) !== SENTINEL);
  expect('clearUserScopedStorage() preserves every not-cleared key (never over-clears)',
    wiped.length === 0, wiped.length ? 'wrongly cleared: ' + wiped.join(', ') : '');
} catch (e) {
  expect('storage_boundary.js imports + runs clearUserScopedStorage() under a shim', false, e.message.slice(0, 200));
}

// ── Ledger summary ────────────────────────────────────────────────────────────
console.log('\nStatic-data surface: ' + discovered.size + ' keys · '
  + CLEARED.length + ' cleared by clearUserScopedStorage() · '
  + NOT_CLEARED_KEYS.length + ' not-cleared (auth-reset / device / dev). '
  + 'Migration ownership (server vs client) is per BD-DOCS-031.');

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
