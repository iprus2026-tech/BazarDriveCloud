// BD-ERROR-01C-F / BD-ERROR-02A-e — static regression smoke for the driver-map flow trigger.
//
// driver_map.js routes its nearby-orders data load through the global app-shell
// overlay via the shared data_layer.loadResource adapter (the per-screen
// loadNearbyOrders wrapper was consolidated into data_layer.js in 02A). This
// smoke asserts the DELEGATION — BOTH reads (the working-surface renderList and
// the readiness gate) go through loadResource(listNearbyOrders, …) each with its
// own retry callback, driver_map never reads listNearbyOrders() directly, and the
// screen's own empty state (buildEmptyCard) is preserved. The guarded-retry
// CONTRACT (retrying / onlyIfState dismiss / server_error / [] fallback) is pinned
// once in scripts/smoke-data-layer.mjs.
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

// ── A. delegation to the shared adapter ──────────────────────
expect('driver_map.js imports loadResource from ../data_layer.js',
  /import\s*\{\s*loadResource\s*\}\s*from\s*'\.\.\/data_layer\.js'/.test(driverMap));
expect('driver_map.js no longer defines its own loadNearbyOrders wrapper (consolidated in 02A)',
  !functionBody(driverMap, 'loadNearbyOrders'));
expect('driver_map.js no longer imports the overlay adapter directly (it goes through data_layer)',
  !/from\s*'\.\.\/app_error_triggers\.js'/.test(driverMap));

// ── B. both retry closures re-run their render, neither pre-dismisses ──
expect('onDriverMapRetry re-runs the working list as a retry (renderList(true))',
  /onDriverMapRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?renderList\(\s*true\s*\)/.test(driverMap));
expect('onReadinessRetry re-runs the readiness gate as a retry (renderReadinessGate(true))',
  /onReadinessRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?renderReadinessGate\(\s*true\s*\)/.test(driverMap));
expect('neither retry closure pre-emptively dismisses before the reload result is known',
  !/on(?:DriverMap|Readiness)Retry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?dismissAppShellError\(\)/.test(driverMap));

// ── C. BOTH load sites go through loadResource(listNearbyOrders, …) WITH a retry callback ──
expect('initial working surface renders via renderList(false)',
  /await\s+renderList\(\s*false\s*\)/.test(driverMap));
expect('renderList(isRetry) loads via loadResource(listNearbyOrders, { onRetry: onDriverMapRetry, isRetry })',
  /async\s+function\s+renderList\(\s*isRetry\s*\)[\s\S]{0,160}await\s+loadResource\(\s*listNearbyOrders\s*,\s*\{\s*onRetry:\s*onDriverMapRetry\s*,\s*isRetry\s*\}\s*\)/.test(driverMap));
expect('renderReadinessGate(isRetry) loads via loadResource(listNearbyOrders, { onRetry: onReadinessRetry, isRetry })',
  /async\s+function\s+renderReadinessGate\(\s*isRetry\s*\)[\s\S]{0,360}await\s+loadResource\(\s*listNearbyOrders\s*,\s*\{\s*onRetry:\s*onReadinessRetry\s*,\s*isRetry\s*\}\s*\)/.test(driverMap));
expect('both readiness-gate sites render via renderReadinessGate(false) (not-ready branch + accept-recheck)',
  (driverMap.match(/await\s+renderReadinessGate\(\s*false\s*\)/g) || []).length === 2,
  'expected 2 gate render sites');
expect('both reads route through loadResource(listNearbyOrders, …) (appears 2x: renderList + renderReadinessGate)',
  (driverMap.match(/loadResource\(\s*listNearbyOrders\s*,/g) || []).length === 2,
  'expected 2 adapter call sites');
expect('driver_map.js reads only through the adapter (no direct listNearbyOrders() call)',
  (driverMap.match(/await\s+listNearbyOrders\(\)/g) || []).length === 0,
  'listNearbyOrders is passed by reference to loadResource, never called directly in driver_map.js');

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
expect('sw.js precaches the shared adapter ./src/data_layer.js',
  /['"]\.\/src\/data_layer\.js['"]/.test(sw));
expect('sw.js VERSION bumped to v137+',
  Number(sw.match(/VERSION\s*=\s*'v(\d+)'/)?.[1] || 0) >= 137);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
