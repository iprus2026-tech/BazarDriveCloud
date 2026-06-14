// BD-ERROR-01C-F — static regression smoke for the driver-map flow trigger.
//
// driver_map.js routes its nearby-orders data load through the global app-shell
// overlay via the BD-ERROR-01C-A adapter (reportAppShellError), mirroring feed
// (01C-B), inbox (01C-C), post-detail (01C-D) and respond (01C-E). The load is
// awaited inside loadNearbyOrders() so the same wrapper holds when
// listNearbyOrders() becomes a real (async, rejectable) backend call — today it
// resolves from the mock store and does not reject, so the catch is dormant.
// The screen's own empty state (buildEmptyCard) must be preserved (the global
// overlay is additive, not a replacement). A refactor could drop the try/catch,
// swallow the error without reporting, replace the empty state, re-route the
// global error, or re-introduce a raw unwrapped read — and
// `node scripts/check.mjs` would still pass without this pin.
//
// This script is intentionally STATIC: it reads source and asserts the
// contract holds. No browser, no DOM, no network.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const driverMap = read('../public/src/screens/driver_map.js');
const app       = read('../public/src/app.js');
const sw        = read('../public/sw.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// Extract a function body by name via brace matching.
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) return null;
  const open = source.indexOf('{', start);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

// ── A. adapter import (report + dismiss) ─────────────────────
expect('driver_map.js imports reportAppShellError + dismissAppShellError from ../app_error_triggers.js',
  /import\s*\{[\s\S]*?reportAppShellError[\s\S]*?dismissAppShellError[\s\S]*?\}\s*from\s*'\.\.\/app_error_triggers\.js'/.test(driverMap));

// ── B. the data load is wrapped in try/catch that reports ────
const loadBody = functionBody(driverMap, 'loadNearbyOrders');
expect('driver_map.js has a loadNearbyOrders() wrapper', !!loadBody);
expect('loadNearbyOrders() awaits listNearbyOrders() inside a try',
  !!loadBody && /try\s*\{[\s\S]*?await\s+listNearbyOrders\(\)/.test(loadBody));
expect('loadNearbyOrders() catch reports server_error to the global overlay',
  !!loadBody && /catch[\s\S]*?reportAppShellError\(\s*'server_error'\s*,/.test(loadBody));
expect('loadNearbyOrders() passes an onRetry option to the overlay',
  !!loadBody && /reportAppShellError\(\s*'server_error'\s*,\s*onRetry\s*\?\s*\{\s*onRetry\s*\}/.test(loadBody));
expect('loadNearbyOrders() falls back to [] (preserves the empty state)',
  !!loadBody && /catch[\s\S]*?return\s*\[\s*\]/.test(loadBody));

// ── B2. retry shows progress and dismisses only on success ───
expect('loadNearbyOrders() shows a non-blocking retrying state while retrying',
  !!loadBody && /if\s*\(isRetry\)\s*reportAppShellError\(\s*'retrying'\s*\)/.test(loadBody));
expect('loadNearbyOrders() dismisses the overlay only AFTER a successful reload, guarded by onlyIfState',
  !!loadBody && /await\s+listNearbyOrders\(\)[\s\S]*?if\s*\(isRetry\)\s*dismissAppShellError\(\s*\{\s*onlyIfState:\s*'retrying'\s*\}\s*\)/.test(loadBody));
expect('onDriverMapRetry re-runs the load as a retry (renderList(true))',
  /onDriverMapRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?renderList\(\s*true\s*\)/.test(driverMap));
expect('onDriverMapRetry does NOT pre-emptively dismiss before the reload result is known',
  !/onDriverMapRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?dismissAppShellError\(\)/.test(driverMap));

// ── C. all load sites go through the wrapper ─────────────────
expect('initial working surface renders via renderList(false)',
  /await\s+renderList\(\s*false\s*\)/.test(driverMap));
expect('renderList(isRetry) loads via loadNearbyOrders(onDriverMapRetry, isRetry)',
  /async\s+function\s+renderList\(\s*isRetry\s*\)[\s\S]{0,140}await\s+loadNearbyOrders\(\s*onDriverMapRetry\s*,\s*isRetry\s*\)/.test(driverMap));
expect('all three nearby-orders reads route through loadNearbyOrders (await loadNearbyOrders( appears 3x)',
  (driverMap.match(/await\s+loadNearbyOrders\(/g) || []).length === 3,
  'expected 3 call sites: not-ready gate, renderList, accept-recheck gate');
expect('driver_map.js calls listNearbyOrders() only inside the wrapper (await listNearbyOrders() appears once)',
  (driverMap.match(/await\s+listNearbyOrders\(\)/g) || []).length === 1,
  'direct awaited call count should be 1 (only inside loadNearbyOrders)');

// ── D. per-screen empty state preserved (additive, not replaced) ─
expect("driver_map.js still renders its own empty state (buildEmptyCard)",
  /buildEmptyCard\(\)/.test(driverMap));

// ── E. additive only — no global error replaces the screen, no /error route ─
expect('driver_map.js does not re-route to a global error route on failure',
  !/go\(\s*['"`]\/error/.test(driverMap));
expect('app.js does NOT register an /error route (any quote style)',
  !/register\(\s*['"`]\/error/.test(app));

// ── F. sw precache + version bump ────────────────────────────
expect('sw.js still precaches ./src/screens/driver_map.js',
  /['"]\.\/src\/screens\/driver_map\.js['"]/.test(sw));
expect('sw.js still precaches the adapter ./src/app_error_triggers.js',
  /['"]\.\/src\/app_error_triggers\.js['"]/.test(sw));
expect('sw.js VERSION bumped to v131+',
  Number(sw.match(/VERSION\s*=\s*'v(\d+)'/)?.[1] || 0) >= 131);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
