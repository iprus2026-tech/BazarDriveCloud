#!/usr/bin/env node
// scripts/check-project-board.mjs — Project #1 «BazarDrive — Mini-Yonder Growth Path» vs
// BD-DOCS-042 (docs-site/docs/processes/backend-spine-inspector.md), the governed current-state
// matrix. Read-only; NOT part of check.mjs. Run by .github/workflows/project-board.yml after
// `gh project item-list` has been exported, or by hand:
//
//   gh project item-list 1 --owner iprus2026-tech --format json --limit 500 > board.json
//   node scripts/check-project-board.mjs board.json
//
// Rule (CLAUDE.md «Project tracking»): a backend phase is `Shipped` only when its server
// implementation is live. So for every phase item whose Design State is `Shipped`, every matrix
// row of that phase's /api/v1/<service> prefix must be LIVE (not DARK). A violation exits 1.
// A phase item with an empty Design State is a warning (exit 0) — the board is a reference view.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSPECTOR = path.join(repoRoot, 'docs-site/docs/processes/backend-spine-inspector.md');

// Phase issue -> the /api/v1 route prefixes the phase owns in BD-DOCS-042. Phases with no server
// routes of their own (data layer #584, client anchors #592/#593) are not checked here.
const PHASE_ROUTES = {
  585: ['auth'],            // Auth & Identity
  586: ['availability'],    // Presence & Heartbeat
  587: ['matching'],        // Dispatch & Matching
  588: ['route-price'],     // Route & Price
  589: ['notifications'],   // Notification Service
  590: ['safety'],          // Safety & Compliance
  591: ['/metrics'],        // Monitoring & Audit (the bare /metrics row)
};

function fail(msg) { console.error(`FAIL project-board: ${msg}`); process.exit(1); }

const file = process.argv[2];
if (!file) fail('usage: node scripts/check-project-board.mjs <board.json>');

let board;
try { board = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { fail(`cannot read ${file}: ${e.message}`); }
const items = Array.isArray(board) ? board : (board.items || []);
if (!items.length) fail('board export has no items');

// gh prints custom fields as camelCased keys ("designState"); be tolerant about the exact spelling.
const designKey = (item) => Object.keys(item).find((k) => /^design\s*state$/i.test(k)) || 'designState';

// Route matrix: "| `GET /api/v1/x/...` | STATE | ..." and the bare "| `GET /metrics` | DARK |".
const rows = [];
for (const line of readFileSync(INSPECTOR, 'utf8').split('\n')) {
  const m = line.match(/^\|\s*`(?:ALL|GET|POST|PUT|PATCH|DELETE)\s+([^`]+)`(?:,\s*`[^`]+`)?\s*\|\s*([^|]+?)\s*\|/);
  if (m) rows.push({ route: m[1].trim(), state: m[2].trim() });
}
if (!rows.length) fail('no route rows parsed from BD-DOCS-042');

const rowsFor = (prefix) => rows.filter((r) => (prefix.startsWith('/')
  ? r.route === prefix
  : r.route.startsWith(`/api/v1/${prefix}`)));

let violations = 0;
let warnings = 0;
for (const [issue, prefixes] of Object.entries(PHASE_ROUTES)) {
  const item = items.find((i) => i.content && i.content.number === Number(issue));
  if (!item) { console.warn(`WARN  #${issue} is not on the board`); warnings += 1; continue; }
  const state = item[designKey(item)] || '';
  const label = `#${issue} ${item.title || item.content.title || ''}`.trim();
  if (!state) { console.warn(`WARN  ${label}: Design State is empty`); warnings += 1; continue; }
  const matrix = prefixes.flatMap(rowsFor);
  const dark = matrix.filter((r) => /DARK/.test(r.state));
  if (state === 'Shipped' && dark.length) {
    console.error(`FAIL  ${label}: Design State is "Shipped" but BD-DOCS-042 has DARK rows: ${dark.map((r) => r.route).join(', ')}`);
    violations += 1;
  } else {
    console.log(`ok    ${label}: ${state} (${matrix.length} matrix row(s), ${dark.length} DARK)`);
  }
}

console.log(`\nproject-board: ${items.length} items, ${Object.keys(PHASE_ROUTES).length} phases checked, ${violations} violation(s), ${warnings} warning(s)`);
if (violations) process.exit(1);
