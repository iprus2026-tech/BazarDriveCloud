// BD-DATA-STATIC-01 (#636) — backend-readiness gate: lock the static-data surface.
//
// Why: the Phase-1 data-layer migration (#584, ADR BD-DOCS-030/031) must replace
// every per-client localStorage store with the backend as the single source of
// truth. To do that module-by-module with a green/red signal — and so a new
// untracked store can never be added silently (the gap that once let
// `bazardrive.order_overlay.v1` live OUTSIDE `storage_boundary.js`) — this check
// locks the surface against a curated manifest.
//
// Axis note: the manifest classifies keys on the **storage-boundary** axis
// (cleared-on-logout / kept / dev-tooling) — which is what this gate can verify
// statically. The orthogonal **migration** axis (server-owned -> backend vs
// client-only -> stays) is owned by the Data Layer Contract (BD-DOCS-031); this
// gate deliberately does NOT assert backend-ownership (e.g. a cleared key may
// still be client-only, and a kept key like `posts.v1` may be server-owned).
//
// Static only: reads source, asserts, no DOM, no network, no behaviour change.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const SRC = path.join(root, 'public', 'src');
const BOUNDARY_REL = path.join('public', 'src', 'storage_boundary.js');

const issues = [];
function expect(label, cond, detail) {
  const d = detail ? ' (' + detail + ')' : '';
  if (!cond) issues.push(label + d);
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + d);
}

// ── Canonical manifest (storage-boundary axis) ────────────────────────────────
// CLEARED — user-scoped stores wiped on the auth boundary. Each declares the
// remover that MUST be invoked from clearUserScopedStorage() (some share one;
// favorite_route_notice and order_overlay are cleared as side-effects).
const CLEARED = [
  { key: 'bazardrive.ride_history.v1', remover: 'clearRideHistory' },
  { key: 'bazardrive.favorite_routes.v1', remover: 'clearFavoriteRoutes' },
  { key: 'bazardrive.favorite_route_notice.v1', remover: 'clearFavoriteRoutes' },
  { key: 'bazardrive.active_ride.v1', remover: 'clearActiveRideStore' },
  { key: 'bazardrive.chat.v1', remover: 'clearChatStore' },
  { key: 'bazardrive.responses.v1', remover: 'clearChatResponses' },
  { key: 'bazardrive.respond.v1', remover: 'clearRespondStore' },
  { key: 'bazardrive.trip_confirmation.v1', remover: 'clearTripConfirmationMap' },
  { key: 'bazardrive.driver_handoff_snapshot.v1', remover: 'clearDriverHandoffSnapshotStore' },
  { key: 'bazardrive.draft.v2', remover: 'clearComposerDraft' },
  { key: 'bazardrive.repeat_route.v1', remover: 'clearRepeatRouteDraft' },
  { key: 'bazardrive.route_draft.v1', remover: 'clearRouteDraftStore' },
  { key: 'bazardrive.order_form.v1', remover: 'clearOrderFormDraftStore' },
  { key: 'bazardrive.ride_orders.v1', remover: 'clearRideOrdersStore' },
  { key: 'bazardrive.driver_receipts.v1', remover: 'clearDriverReceiptsStore' },
  { key: 'bazardrive.driver_offers.v1', remover: 'clearDriverOfferStore' },
  { key: 'bazardrive.order_overlay.v1', remover: 'clearDriverOfferStore' },
  { key: 'bazardrive.myposts.v1', remover: 'clearMyPostsStore' },
  { key: 'profileTripDemo', remover: 'clearTripDemoMode' },
];
// KEPT — user/device keys intentionally NOT cleared, but documented in
// storage_boundary.js (identity reset elsewhere, or device-/dev-level).
const KEPT = [
  'bazardrive.user.v1',
  'bazardrive.posts.v1',
  'bazardrive.map_prefs.v1',
  'bazardrive.debug.publish',
  'bazardrive.smoke_role.v1',
];
// DEV — dev-tooling store, out of the user-data boundary (must NOT be cleared).
const DEV = [
  'bazardrive.ops.mel.v1',
];

const CLEARED_KEYS = CLEARED.map((e) => e.key);
const ALL = [...CLEARED_KEYS, ...KEPT, ...DEV];
const MANIFEST = new Set(ALL);

// ── 0. Disjoint classification — a key must live in exactly one class ──────────
const dupes = ALL.filter((k, i) => ALL.indexOf(k) !== i);
expect(
  'manifest classes are disjoint — no key classified twice',
  dupes.length === 0,
  dupes.length ? 'duplicated: ' + [...new Set(dupes)].join(', ') : '',
);

// ── Discover storage-key literals in public/src/** ────────────────────────────
// Capture the whole quoted value after `bazardrive.` (so hyphenated keys like
// `bazardrive.order-overlay.v1` are caught), then drop placeholder/dynamic forms
// (`<userId>` doc examples, `${...}` template literals).
function listJs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJs(p));
    else if (e.isFile() && e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const isRealKey = (k) => !/[<>{}$]/.test(k);
const keyRe = /['"`](bazardrive\.[^'"`]+|profileTripDemo)['"`]/g;
function discoverIn(files) {
  const set = new Set();
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = keyRe.exec(txt))) if (isRealKey(m[1])) set.add(m[1]);
  }
  return set;
}
const allFiles = listJs(SRC);
const discovered = discoverIn(allFiles);
// For the stale check, exclude storage_boundary.js: it documents every CLEARED/KEPT
// key in its audit comment, which would otherwise keep a removed store "referenced"
// forever and defeat the stale invariant.
const ownerFiles = allFiles.filter((f) => path.relative(root, f) !== BOUNDARY_REL);
const inOwners = discoverIn(ownerFiles);

// ── 1. No orphan: every discovered key is classified in the manifest ──────────
const orphans = [...discovered].filter((k) => !MANIFEST.has(k));
expect(
  'no orphan storage key in public/src — every key is classified in the manifest',
  orphans.length === 0,
  orphans.length ? 'orphans: ' + orphans.join(', ') : '',
);

// ── 2. No stale: every manifest key is still referenced by an owner module ────
//     (storage_boundary.js excluded so its audit comment cannot mask a removal).
const stale = ALL.filter((k) => !inOwners.has(k));
expect(
  'no stale manifest entry — every key is still referenced by an owner module',
  stale.length === 0,
  stale.length ? 'stale: ' + stale.join(', ') : '',
);

// ── 3. storage_boundary.js documents every user-data key (CLEARED + KEPT) ──────
const boundary = fs.readFileSync(path.join(SRC, 'storage_boundary.js'), 'utf8');
const undocumented = [...CLEARED_KEYS, ...KEPT].filter((k) => !boundary.includes(k));
expect(
  'storage_boundary.js documents every user-data key (cleared + kept)',
  undocumented.length === 0,
  undocumented.length ? 'undocumented: ' + undocumented.join(', ') : '',
);

// ── 4. Every CLEARED key is wired to a remover invoked by clearUserScopedStorage ─
//     Documenting a key in the comment is not enough — it must actually be wiped,
//     or same-browser logout leaks user data.
const fnMatch = boundary.match(/export function clearUserScopedStorage\(\)\s*\{([\s\S]*?)\n\}/);
const fnBody = fnMatch ? fnMatch[1] : '';
expect('clearUserScopedStorage() is present in storage_boundary.js', !!fnMatch);
const unwired = [...new Set(CLEARED.map((e) => e.remover))].filter(
  (r) => !fnBody.includes(r + '('),
);
expect(
  'every cleared key is wired to a remover called by clearUserScopedStorage()',
  unwired.length === 0,
  unwired.length ? 'not called: ' + unwired.join(', ') : '',
);

// ── 5. Dev-tooling keys (DEV) stay OUT of the user-data boundary ──────────────
const leaked = DEV.filter((k) => boundary.includes(k));
expect(
  'dev-tooling keys stay OUT of storage_boundary.js (never cleared as user data)',
  leaked.length === 0,
  leaked.length ? 'leaked into boundary: ' + leaked.join(', ') : '',
);

// ── Ledger summary ────────────────────────────────────────────────────────────
console.log(
  '\nStatic-data surface: ' + discovered.size + ' keys · '
  + CLEARED.length + ' cleared (user-scoped) · '
  + KEPT.length + ' kept (user/device) · '
  + DEV.length + ' dev tooling. '
  + 'Migration ownership (server vs client) is per BD-DOCS-031.',
);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
