// BD-DATA-STATIC-01 (#636) — backend-readiness gate: lock the static-data surface.
//
// Why: the Phase-1 data-layer migration (#584, ADR BD-DOCS-030/031) must replace
// every per-client storage store with the backend as the single source of truth.
// To do that module-by-module with a green/red signal — and so a new untracked
// store can never be added silently (the gap that once let
// `bazardrive.order_overlay.v1` live OUTSIDE `storage_boundary.js`) — this check
// discovers every storage key actually used and locks it against a curated
// manifest, then verifies the clear-on-boundary contract behaviourally.
//
// Discovery resolves the KEY ARGUMENT of every localStorage/sessionStorage access
// (`.getItem/.setItem/.removeItem(...)` and `[...]`), following same-file
// `const NAME = 'literal'` so constant-stored and non-`bazardrive` keys (e.g.
// `bd-reloading`) are caught — not just inline `bazardrive.*` literals. A dynamic
// key argument that cannot be resolved to a literal FAILS (it must be classified).
//
// Axis note: keys are classified by whether `clearUserScopedStorage()` wipes them.
// `user.v1` / `smoke_role.v1` are still reset at logout, but by the auth flow
// (`resetLocalSession()`), not this function. The migration axis (server vs
// client) is owned by BD-DOCS-031; this gate does not assert it.

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
// NOT_CLEARED — untouched by clearUserScopedStorage().
//   documented:true  → must appear in storage_boundary.js's audit comment.
//   documented:false → must NOT appear in storage_boundary.js at all.
//   session:true     → lives in sessionStorage (seeded there for the clear test).
const NOT_CLEARED = [
  { key: 'bazardrive.user.v1', documented: true },            // reset by auth flow (user.reset)
  { key: 'bazardrive.smoke_role.v1', documented: true, session: true }, // reset by auth flow (clearSmokeRole)
  { key: 'bazardrive.posts.v1', documented: true },           // global cache, survives
  { key: 'bazardrive.map_prefs.v1', documented: true },       // device pref, survives
  { key: 'bazardrive.debug.publish', documented: true },      // dev flag, survives
  { key: 'bazardrive.ops.mel.v1', documented: false },        // dev tooling, out of boundary
  { key: 'bd-reloading', documented: false, session: true },  // transient SW reload flag (sw-update.js)
];
const NC_KEYS = NOT_CLEARED.map((e) => e.key);
const ALL = [...CLEARED, ...NC_KEYS];
const MANIFEST = new Set(ALL);

// Storage-availability probes: written + immediately removed to test whether
// localStorage works (driver_offer_store.js). Not real stores — exempt from the
// orphan inventory.
const ALLOWLIST = new Set(['__bd_driver_offer_probe__']);

// ── 0. Disjoint classification ────────────────────────────────────────────────
const dupes = ALL.filter((k, i) => ALL.indexOf(k) !== i);
expect('manifest classes are disjoint — no key classified twice', dupes.length === 0,
  dupes.length ? 'duplicated: ' + [...new Set(dupes)].join(', ') : '');

// ── Discover storage keys actually accessed in public/src/** ──────────────────
function listJs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJs(p));
    else if (e.isFile() && e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
// Returns { keys:Set, dynamic:[] } — resolved storage keys + unresolved dynamic args.
function resolveStorageKeys(text) {
  const consts = new Map();
  const cre = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*['"`]([^'"`]+)['"`]/g;
  let cm;
  while ((cm = cre.exec(text))) if (!consts.has(cm[1])) consts.set(cm[1], cm[2]);
  const keys = new Set();
  const dynamic = [];
  // `.getItem/.setItem/.removeItem(ARG` or `[ARG`
  const are = /(?:local|session)Storage\s*(?:\.\s*(?:get|set|remove)Item\s*\(|\[)\s*([^,)\]]+)/g;
  let am;
  while ((am = are.exec(text))) {
    const arg = am[1].trim();
    const lit = arg.match(/^['"`]([^'"`]+)['"`]$/);
    if (lit) keys.add(lit[1]);
    else if (/^[A-Za-z_$][\w$]*$/.test(arg) && consts.has(arg)) keys.add(consts.get(arg));
    else dynamic.push(arg);
  }
  return { keys, dynamic };
}
const prefixRe = /['"`](bazardrive\.[^'"`]+|profileTripDemo)['"`]/g;
function discoverIn(files, { withPrefixLiterals } = {}) {
  const keys = new Set();
  const dynamic = [];
  for (const f of files) {
    const txt = stripComments(fs.readFileSync(f, 'utf8'));
    const r = resolveStorageKeys(txt);
    r.keys.forEach((k) => keys.add(k));
    dynamic.push(...r.dynamic);
    if (withPrefixLiterals) { let m; while ((m = prefixRe.exec(txt))) keys.add(m[1]); }
  }
  return { keys, dynamic };
}
const allFiles = listJs(SRC);
const ownerFiles = allFiles.filter((f) => path.relative(root, f) !== BOUNDARY_REL);
// Orphan: every key accessed anywhere (plus any bazardrive.* literal, belt-and-suspenders).
const all = discoverIn(allFiles, { withPrefixLiterals: true });
// Stale: a key counts as live if accessed via a storage API OR present as a
// `bazardrive.*` literal (its const definition) in an owner module — boundary
// excluded so its audit comment cannot mask a removal.
const owners = discoverIn(ownerFiles, { withPrefixLiterals: true });

// ── 1. No orphan (incl. unresolved dynamic keys) ──────────────────────────────
const orphans = [...all.keys].filter((k) => !MANIFEST.has(k) && !ALLOWLIST.has(k));
expect('no orphan storage key in public/src — every accessed key is classified',
  orphans.length === 0, orphans.length ? 'orphans: ' + orphans.join(', ') : '');
expect('no unresolved dynamic storage key — every storage access resolves to a literal',
  all.dynamic.length === 0, all.dynamic.length ? 'dynamic: ' + [...new Set(all.dynamic)].join(', ') : '');

// ── 2. No stale: every manifest key is still accessed by an owner module ──────
const stale = ALL.filter((k) => !owners.keys.has(k));
expect('no stale manifest entry — every key is still accessed (via a storage API) by an owner module',
  stale.length === 0, stale.length ? 'stale: ' + stale.join(', ') : '');

// ── 3. Documentation in storage_boundary.js's AUDIT COMMENT (not just code) ────
const boundary = fs.readFileSync(BOUNDARY, 'utf8');
const auditComment = boundary.slice(0, boundary.search(/\nimport\s/));
const docTrue = [...CLEARED, ...NOT_CLEARED.filter((e) => e.documented).map((e) => e.key)];
const undocumented = docTrue.filter((k) => !auditComment.includes(k));
expect('every boundary key is documented in the storage_boundary.js audit comment',
  undocumented.length === 0, undocumented.length ? 'undocumented: ' + undocumented.join(', ') : '');
// Excluded keys must stay OUT of the boundary entirely.
const excluded = NOT_CLEARED.filter((e) => !e.documented).map((e) => e.key);
const leakedIntoBoundary = excluded.filter((k) => boundary.includes(k));
expect('excluded dev keys stay OUT of storage_boundary.js',
  leakedIntoBoundary.length === 0, leakedIntoBoundary.length ? 'present: ' + leakedIntoBoundary.join(', ') : '');

// ── 4. Behavioural clear-on-boundary contract ─────────────────────────────────
const ls = new Map();
const ss = new Map();
const SENTINEL = 'SMOKE_SENTINEL_v1';
const shim = (m) => ({
  getItem: (k) => (m.has(k) ? m.get(k) : null),
  setItem: (k, v) => m.set(k, String(v)),
  removeItem: (k) => m.delete(k),
  clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null,
  get length() { return m.size; },
});
globalThis.localStorage = shim(ls);
globalThis.sessionStorage = shim(ss);
globalThis.window = globalThis;
globalThis.document = {
  addEventListener() {}, removeEventListener() {}, querySelector: () => null,
  querySelectorAll: () => [], getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, appendChild() {} }),
};
globalThis.location = globalThis.location || { hash: '', href: 'http://localhost/', search: '', pathname: '/' };

try {
  const mod = await import(pathToFileURL(BOUNDARY).href);
  for (const k of CLEARED) ls.set(k, SENTINEL);
  for (const e of NOT_CLEARED) (e.session ? ss : ls).set(e.key, SENTINEL);
  mod.clearUserScopedStorage();
  const isCleared = (v) => v === null || v === '' || v === '{}' || v === '[]';
  const leaked = CLEARED.filter((k) => !isCleared(ls.get(k) ?? null));
  expect('clearUserScopedStorage() actually clears every cleared key (no logout data leak)',
    leaked.length === 0, leaked.length ? 'NOT cleared: ' + leaked.join(', ') : '');
  const wiped = NOT_CLEARED.filter((e) => (e.session ? ss : ls).get(e.key) !== SENTINEL).map((e) => e.key);
  expect('clearUserScopedStorage() preserves every not-cleared key (never over-clears)',
    wiped.length === 0, wiped.length ? 'wrongly cleared: ' + wiped.join(', ') : '');
} catch (e) {
  expect('storage_boundary.js imports + runs clearUserScopedStorage() under a shim', false, e.message.slice(0, 200));
}

// ── Ledger summary ────────────────────────────────────────────────────────────
console.log('\nStatic-data surface: ' + all.keys.size + ' keys accessed · '
  + CLEARED.length + ' cleared by clearUserScopedStorage() · '
  + NC_KEYS.length + ' not-cleared (auth-reset / device / dev / transient). '
  + 'Migration ownership (server vs client) is per BD-DOCS-031.');

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
