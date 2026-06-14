// BD-ERROR-01B — static regression smoke for the app-shell connection
// trigger wiring.
//
// app_connection_status.js wires ONLY the browser online/offline events to the
// existing BD-ERROR-01A overlay (window.BD.GlobalError). A refactor could drop
// a listener, stop reflecting the initial offline state, attach duplicate
// listeners, leak a fetch/storage/ride-coupling, or get initialized before the
// overlay exists — and `node scripts/check.mjs` would still pass.
//
// This script is intentionally STATIC: it reads source and asserts the
// contract holds. No browser, no DOM, no network, no timers waited on.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const conn = read('../public/src/app_connection_status.js');
const app  = read('../public/src/app.js');
const sw   = read('../public/sw.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── A. module exists + export ────────────────────────────────
expect('app_connection_status.js is non-empty', conn.length > 0);
expect('exports initAppConnectionStatus',
  /export\s+function\s+initAppConnectionStatus\b/.test(conn));

// ── B. listens to browser online/offline ─────────────────────
expect("adds a window 'offline' listener",
  /addEventListener\(\s*'offline'\s*,/.test(conn));
expect("adds a window 'online' listener",
  /addEventListener\(\s*'online'\s*,/.test(conn));

// ── C. drives the overlay through window.BD.GlobalError ───────
expect('reads window.BD.GlobalError', /window\.BD\b[\s\S]{0,40}GlobalError/.test(conn));
for (const state of ['offline', 'retrying', 'recovered']) {
  expect(`forwards show('${state}')`, new RegExp(`show\\(\\s*'${state}'\\s*\\)`).test(conn));
}

// ── D. initial-state reflection + idempotent init ────────────
expect('reflects initial state via navigator.onLine === false',
  /navigator\.onLine\s*===\s*false/.test(conn));
expect('guards against duplicate listeners (initialized flag)',
  /let\s+initialized\s*=\s*false/.test(conn) && /if\s*\(initialized\)\s*return/.test(conn));

// ── E. reconnection timer is cleared, never leaked ───────────
expect('uses a setTimeout for the retrying → recovered transition',
  /setTimeout\(/.test(conn));
expect('clears the transition timer (clearTimeout helper)',
  /function\s+clearOnlineTransitionTimer\(\)[\s\S]{0,160}clearTimeout\(/.test(conn));
expect('offline handler clears any pending online/recovered timer',
  /function\s+handleOffline\(\)[\s\S]{0,120}clearOnlineTransitionTimer\(\)/.test(conn));
expect('online handler clears the timer before re-arming',
  /function\s+handleOnline\(\)[\s\S]{0,160}clearOnlineTransitionTimer\(\)/.test(conn));

// ── F. strict out-of-scope: no coupling, no mutation ─────────
const FORBIDDEN_IMPORT = ['ride_state', 'driver_offer_store', 'mock_api', 'mapbox', 'order_detail', 'active_ride'];
for (const mod of FORBIDDEN_IMPORT) {
  expect(`does NOT import ${mod}`, !new RegExp(`from\\s+'[^']*${mod}`).test(conn), 'forbidden import');
}
const FORBIDDEN_VOCAB = [
  'fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage',
  'updateTripStatus', 'acceptOrder', 'saveActiveRide', 'RIDE_STATUS', 'persistDriver',
];
for (const tok of FORBIDDEN_VOCAB) {
  expect(`source contains no '${tok}' (no fetch / storage / ride-order mutation)`,
    !conn.includes(tok));
}

// ── G. app.js wiring, ordered after the overlay init ─────────
expect('app.js imports initAppConnectionStatus from ./app_connection_status.js',
  /import\s*\{\s*initAppConnectionStatus\s*\}\s*from\s*'\.\/app_connection_status\.js'/.test(app));
expect('app.js calls initAppConnectionStatus()', /initAppConnectionStatus\(\)/.test(app));
const overlayIdx = app.indexOf('initGlobalErrorOverlay()');
const connIdx = app.indexOf('initAppConnectionStatus()');
expect('initAppConnectionStatus() runs AFTER initGlobalErrorOverlay()',
  overlayIdx !== -1 && connIdx !== -1 && connIdx > overlayIdx,
  `overlay@${overlayIdx} conn@${connIdx}`);
expect('app.js does NOT register an /error route (any quote style)',
  !/register\(\s*['"`]\/error/.test(app));

// ── H. sw.js precache ────────────────────────────────────────
expect('sw.js precaches ./src/app_connection_status.js',
  /['"]\.\/src\/app_connection_status\.js['"]/.test(sw));
const precacheMatch = sw.match(/PRECACHE\s*=\s*\[([\s\S]*?)\]/);
expect('sw.js precache does NOT contain the prototype render gate',
  !!precacheMatch && !/prototypes\//.test(precacheMatch[1]));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
