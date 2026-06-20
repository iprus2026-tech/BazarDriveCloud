// BD-DATA-STATIC-01 (#636) — backend-readiness gate: lock the static-data surface.
//
// Why: the Phase-1 data-layer migration (#584, ADR BD-DOCS-030/031) must replace
// every per-client localStorage store with the backend as the single source of
// truth. To do that module-by-module with a green/red signal — and to make sure a
// new untracked store can never be added silently (the class of gap that once let
// `bazardrive.order_overlay.v1` live OUTSIDE `storage_boundary.js`) — this check
// locks the static-data surface against a curated manifest.
//
// Source of truth this enforces: the manifest below, cross-checked against
// `public/src/storage_boundary.js` (the documented user-data audit). Static only:
// reads source, asserts, no DOM, no network, no behaviour change.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const SRC = path.join(root, 'public', 'src');

const issues = [];
function expect(label, cond, detail) {
  const d = detail ? ' (' + detail + ')' : '';
  if (!cond) issues.push(label + d);
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + d);
}

// ── Canonical static-data manifest (the contract this check enforces) ──────────
// Class A — user-scoped product stores. MUST migrate to the backend in Phase 1
//           AND MUST be documented in storage_boundary.js (cleared on the auth
//           boundary). These are the "→ backend" removal targets.
const CLASS_A = [
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
// Class B — user/device data intentionally NOT cleared on the boundary, but still
//           documented in storage_boundary.js (e.g. user.v1 is reset elsewhere;
//           device prefs / dev flags are identity-agnostic).
const CLASS_B = [
  'bazardrive.user.v1',
  'bazardrive.posts.v1',
  'bazardrive.map_prefs.v1',
  'bazardrive.debug.publish',
  'bazardrive.smoke_role.v1',
];
// Class C — dev-tooling / out-of-user-boundary stores. Stay client-side (NOT a
//           backend migration target) and must NOT be pulled into the user-data
//           boundary.
const CLASS_C = [
  'bazardrive.ops.mel.v1',
];
const MANIFEST = new Set([...CLASS_A, ...CLASS_B, ...CLASS_C]);

// ── Discover every storage-key literal actually used in public/src/** ──────────
function listJs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJs(p));
    else if (e.isFile() && e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const keyRe = /['"`](bazardrive\.[a-z0-9_.]+|profileTripDemo)['"`]/gi;
const discovered = new Set();
for (const f of listJs(SRC)) {
  const txt = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = keyRe.exec(txt))) discovered.add(m[1]);
}

// ── 1. No orphan: every discovered key is classified in the manifest ───────────
const orphans = [...discovered].filter((k) => !MANIFEST.has(k));
expect(
  'no orphan storage key in public/src — every key is classified A/B/C in the manifest',
  orphans.length === 0,
  orphans.length ? 'orphans: ' + orphans.join(', ') : '',
);

// ── 2. No stale manifest: every manifest key is still referenced in the code ───
const stale = [...MANIFEST].filter((k) => !discovered.has(k));
expect(
  'no stale manifest entry — every A/B/C key is still referenced in public/src',
  stale.length === 0,
  stale.length ? 'stale: ' + stale.join(', ') : '',
);

// ── 3. storage_boundary.js documents every user-data key (class A + class B) ───
const boundary = fs.readFileSync(path.join(SRC, 'storage_boundary.js'), 'utf8');
const undocumented = [...CLASS_A, ...CLASS_B].filter((k) => !boundary.includes(k));
expect(
  'storage_boundary.js documents every user-data key (class A cleared + class B not-cleared)',
  undocumented.length === 0,
  undocumented.length ? 'undocumented: ' + undocumented.join(', ') : '',
);

// ── 4. Dev-tooling keys (class C) stay OUT of the user-data boundary ───────────
const leaked = CLASS_C.filter((k) => boundary.includes(k));
expect(
  'dev-tooling keys (class C) stay OUT of storage_boundary.js (never cleared as user data)',
  leaked.length === 0,
  leaked.length ? 'leaked into boundary: ' + leaked.join(', ') : '',
);

// ── Ledger summary (lets removal be tracked as the backend lands) ──────────────
console.log(
  '\nStatic-data surface: ' + discovered.size + ' keys · '
  + CLASS_A.length + ' class A (→ backend, Phase 1) · '
  + CLASS_B.length + ' class B (user/device, stays) · '
  + CLASS_C.length + ' class C (dev tooling, stays).',
);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
