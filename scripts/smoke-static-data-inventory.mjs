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
// Axis note: the manifest classifies keys on the **storage-boundary** axis
// (cleared-on-logout / kept / dev-tooling) — what this gate verifies. The
// orthogonal **migration** axis (server-owned -> backend vs client-only -> stays)
// is owned by the Data Layer Contract (BD-DOCS-031); this gate does NOT assert
// backend-ownership (a cleared key may be client-only; a kept key like `posts.v1`
// may be server-owned).
//
// Mostly static (reads source, asserts). The clear-on-boundary check imports
// `storage_boundary.js` under a localStorage shim and runs it — no DOM, no
// network, no real behaviour change to the app.

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

// ── Canonical manifest (storage-boundary axis) ────────────────────────────────
// CLEARED — user-scoped stores wiped on the auth boundary by clearUserScopedStorage().
const CLEARED = [
  'bazardrive.ride_history.v1',
  'bazardrive.favorite_routes.v1',
  'bazardrive.favorite_route_notice.v1',
  'bazardrive.active_ride.v1',
  'bazardrive.chat.v1',
  'bazardrive.responses.v1',
  'bazardrive.respond.v1',
  'bazardrive.trip_confirmation.v1',
  'bazardrive.driver_handoff_snapshot.v1',
  'bazardrive.draft.v2',
  'bazardrive.repeat_route.v1',
  'bazardrive.route_draft.v1',
  'bazardrive.order_form.v1',
  'bazardrive.ride_orders.v1',
  'bazardrive.driver_receipts.v1',
  'bazardrive.driver_offers.v1',
  'bazardrive.order_overlay.v1',
  'bazardrive.myposts.v1',
  'profileTripDemo',
];
// KEPT — user/device data intentionally NOT cleared, documented in storage_boundary.js.
const KEPT = [
  'bazardrive.user.v1',
  'bazardrive.posts.v1',
  'bazardrive.map_prefs.v1',
];
// DEV — dev/test artefacts, never cleared, not product data (storage_boundary.js
// documents debug.publish + smoke_role as dev/test; ops.mel is out of the boundary).
const DEV = [
  'bazardrive.debug.publish',
  'bazardrive.smoke_role.v1',
  'bazardrive.ops.mel.v1',
];

const ALL = [...CLEARED, ...KEPT, ...DEV];
const MANIFEST = new Set(ALL);

// ── 0. Disjoint classification — a key must live in exactly one class ──────────
const dupes = ALL.filter((k, i) => ALL.indexOf(k) !== i);
expect(
  'manifest classes are disjoint — no key classified twice',
  dupes.length === 0,
  dupes.length ? 'duplicated: ' + [...new Set(dupes)].join(', ') : '',
);

// ── Discover storage-key literals in public/src/** (comments stripped) ─────────
// Comments are stripped first so a key mentioned only in an audit/note comment is
// NOT treated as a live reference (which would defeat the stale check) and a doc
// placeholder like `bazardrive.<userId>.ride_history.v1` is not counted. The
// matcher captures the full quoted value after `bazardrive.` so hyphenated AND
// dynamic (`${...}`) keys are caught — dynamic storage keys must be classified or
// fail, not be silently dropped.
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')        // block comments
    .replace(/(^|[^:])\/\/.*$/gm, '$1');      // line comments (keep `://` URLs)
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
const keyRe = /['"`](bazardrive\.[^'"`]+|profileTripDemo)['"`]/g;
function discoverIn(files) {
  const set = new Set();
  for (const f of files) {
    const txt = stripComments(fs.readFileSync(f, 'utf8'));
    let m;
    while ((m = keyRe.exec(txt))) set.add(m[1]);
  }
  return set;
}
const allFiles = listJs(SRC);
const discovered = discoverIn(allFiles);
// Stale pass excludes storage_boundary.js: its audit comment names every key, which
// (even after comment-stripping, via its TRIP_DEMO_KEY const etc.) would mask a
// removal in an owner module.
const inOwners = discoverIn(allFiles.filter((f) => path.relative(root, f) !== BOUNDARY_REL));

// ── 1. No orphan: every discovered key is classified in the manifest ──────────
const orphans = [...discovered].filter((k) => !MANIFEST.has(k));
expect(
  'no orphan storage key in public/src — every key (incl. dynamic) is classified',
  orphans.length === 0,
  orphans.length ? 'orphans: ' + orphans.join(', ') : '',
);

// ── 2. No stale: every manifest key is still referenced by an owner module ────
const stale = ALL.filter((k) => !inOwners.has(k));
expect(
  'no stale manifest entry — every key is still referenced (in code) by an owner module',
  stale.length === 0,
  stale.length ? 'stale: ' + stale.join(', ') : '',
);

// ── 3. storage_boundary.js documents every user-data key (CLEARED + KEPT) ──────
const boundary = fs.readFileSync(BOUNDARY, 'utf8');
const undocumented = [...CLEARED, ...KEPT].filter((k) => !boundary.includes(k));
expect(
  'storage_boundary.js documents every user-data key (cleared + kept)',
  undocumented.length === 0,
  undocumented.length ? 'undocumented: ' + undocumented.join(', ') : '',
);

// ── 4. Behavioural clear-on-boundary contract ─────────────────────────────────
// Seed every key, run the real clearUserScopedStorage() under a localStorage shim,
// then assert CLEARED keys' data is gone and KEPT/DEV keys are preserved verbatim.
// This is the gate's teeth: it verifies keys are ACTUALLY cleared (not merely named
// in the audit), and that non-user-scoped keys are never wiped.
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
  addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [],
  getElementById: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, appendChild() {} }),
};
globalThis.location = globalThis.location || { hash: '', href: 'http://localhost/', search: '', pathname: '/' };

let cleared = null;
try {
  const mod = await import(pathToFileURL(BOUNDARY).href);
  for (const k of ALL) localStorage.setItem(k, SENTINEL);
  mod.clearUserScopedStorage();
  cleared = (v) => v === null || v === '' || v === '{}' || v === '[]';
  const leaked = CLEARED.filter((k) => !cleared(localStorage.getItem(k)));
  expect(
    'clearUserScopedStorage() actually clears every cleared key (no logout data leak)',
    leaked.length === 0,
    leaked.length ? 'NOT cleared: ' + leaked.join(', ') : '',
  );
  const wiped = [...KEPT, ...DEV].filter((k) => localStorage.getItem(k) !== SENTINEL);
  expect(
    'clearUserScopedStorage() preserves every kept/dev key (never over-clears)',
    wiped.length === 0,
    wiped.length ? 'wrongly cleared: ' + wiped.join(', ') : '',
  );
} catch (e) {
  expect('storage_boundary.js imports + runs clearUserScopedStorage() under a shim', false, e.message.slice(0, 200));
}

// ── Ledger summary ────────────────────────────────────────────────────────────
console.log(
  '\nStatic-data surface: ' + discovered.size + ' keys · '
  + CLEARED.length + ' cleared (user-scoped) · '
  + KEPT.length + ' kept (user/device) · '
  + DEV.length + ' dev/test. '
  + 'Migration ownership (server vs client) is per BD-DOCS-031.',
);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
