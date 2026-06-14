// BD-ERROR-01A — static regression smoke for the Global Error / Offline
// runtime overlay.
//
// The overlay (public/src/app_error_overlay.js) is an app-shell singleton
// driven via window.BD.GlobalError, wired in public/src/app.js, styled by the
// .bd-error-* namespace in public/styles/cloud.css and precached by
// public/sw.js. None of that is otherwise pinned, so a refactor could drop a
// state, leak a mutating import, register a stray /error route, or break the
// singleton/auto-dismiss contract and `node scripts/check.mjs` would still pass.
//
// This script is intentionally STATIC: it reads source files and asserts the
// contract holds in source. No browser, no DOM, no jsdom, no network, and it
// does NOT wait on the recovered auto-dismiss timer — it pins the behaviour by
// source wording only.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const overlay = read('../public/src/app_error_overlay.js');
const app     = read('../public/src/app.js');
const css     = read('../public/styles/cloud.css');
const sw      = read('../public/sw.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── A. module exists + exports ───────────────────────────────
expect('app_error_overlay.js is non-empty', overlay.length > 0);
for (const fn of ['initGlobalErrorOverlay', 'showGlobalErrorOverlay', 'hideGlobalErrorOverlay']) {
  expect(`exports ${fn}`, new RegExp(`export\\s+function\\s+${fn}\\b`).test(overlay));
}

// ── B. all five states present in source ─────────────────────
for (const state of ['offline', 'server_error', 'timeout', 'retrying', 'recovered']) {
  expect(`state '${state}' present in source`, new RegExp(`'${state}'`).test(overlay));
}
// whitelist array exists and gates show()
expect('STATES whitelist defined', /const\s+STATES\s*=\s*\[/.test(overlay));
expect('show() gates on the whitelist (unknown state guarded)',
  /STATES\.includes\(state\)/.test(overlay));
expect('unknown state is a safe no-op (no random UI — hide + return)',
  /if\s*\(!STATES\.includes\(state\)\)[\s\S]{0,160}hideGlobalErrorOverlay\(\)[\s\S]{0,40}return/.test(overlay));

// ── C. window API ────────────────────────────────────────────
expect('exposes window.BD.GlobalError', /w\.BD\.GlobalError\s*=/.test(overlay)
  || /window\.BD\.GlobalError\s*=/.test(overlay));
expect('window.BD.GlobalError.show is wired', /show:\s*\(state[\s\S]{0,80}showGlobalErrorOverlay/.test(overlay));
expect('window.BD.GlobalError.hide is wired', /hide:\s*\(\)\s*=>\s*hideGlobalErrorOverlay/.test(overlay));

// ── D. singleton + safety contract ───────────────────────────
expect('init reuses an existing overlay element (no duplicate DOM)',
  /getElementById\(OVERLAY_ID\)/.test(overlay) && /if\s*\(el\)\s*\{/.test(overlay));
expect('hide() is safe when overlay was never shown (null guard)',
  /const\s+el\s*=\s*document\.getElementById\(OVERLAY_ID\)[\s\S]{0,40}if\s*\(!el\)\s*return/.test(overlay));

// ── E. recovered auto-dismiss, pinned by source (no real wait) ─
expect('recovered uses a setTimeout auto-dismiss', /recoveredTimer\s*=\s*setTimeout\(/.test(overlay));
expect('auto-dismiss delay constant defined', /RECOVERED_DISMISS_MS\s*=\s*\d+/.test(overlay));
expect('timer cleared on hide() and on new show() via clearRecoveredTimer',
  /function\s+clearRecoveredTimer\(\)[\s\S]{0,160}clearTimeout\(recoveredTimer\)/.test(overlay));
expect('show() clears the recovered timer before rendering',
  /export\s+function\s+showGlobalErrorOverlay[\s\S]{0,120}clearRecoveredTimer\(\)/.test(overlay));
expect('hide() clears the recovered timer', /export\s+function\s+hideGlobalErrorOverlay[\s\S]{0,80}clearRecoveredTimer\(\)/.test(overlay));

// ── F. retry callback is a demo-only callback ────────────────
expect('retry invokes options.onRetry (no real network retry)',
  /currentOptions\.onRetry\s*===\s*'function'|typeof\s+currentOptions\.onRetry\s*===\s*'function'/.test(overlay));

// ── G. accessibility minimum ─────────────────────────────────
expect('banner/toast use aria-live="polite"', /aria-live="polite"/.test(overlay));
expect('blocking sheet uses role="alertdialog"', /role="alertdialog"/.test(overlay));
expect('actions are real <button> elements', /<button[^>]*type="button"[^>]*data-bd-error-action/.test(overlay));

// ── H. non-mutating contract — no forbidden imports ──────────
const FORBIDDEN_IMPORT = ['ride_state', 'driver_offer_store', 'mock_api', 'mapbox', 'order_detail', 'active_ride'];
for (const mod of FORBIDDEN_IMPORT) {
  expect(`does NOT import ${mod}`, !new RegExp(`from\\s+'[^']*${mod}`).test(overlay), 'forbidden import');
}
// no order/ride mutation vocabulary, no storage, no backend, no real retry
const FORBIDDEN_VOCAB = [
  'updateTripStatus', 'updateActiveRideStatus', 'acceptOrder', 'saveActiveRide',
  'persistDriver', 'RIDE_STATUS', 'setRideStatus', 'localStorage', 'sessionStorage',
  'fetch(', 'XMLHttpRequest',
];
for (const tok of FORBIDDEN_VOCAB) {
  expect(`source contains no '${tok}' (non-mutating / no backend)`,
    !overlay.includes(tok));
}
expect('module documents its non-mutating contract', /non-mutating contract/i.test(overlay));

// ── I. app.js wiring, no /error route ────────────────────────
expect('app.js imports initGlobalErrorOverlay from ./app_error_overlay.js',
  /import\s*\{\s*initGlobalErrorOverlay\s*\}\s*from\s*'\.\/app_error_overlay\.js'/.test(app));
expect('app.js initializes the overlay singleton', /initGlobalErrorOverlay\(\)/.test(app));
expect("app.js does NOT register an /error route",
  !/register\(\s*'\/error'/.test(app));

// ── J. cloud.css namespace ───────────────────────────────────
for (const cls of ['.bd-error-overlay', '.bd-error-banner', '.bd-error-sheet', '.bd-error-toast', '.bd-error-scrim']) {
  expect(`cloud.css defines ${cls}`, css.includes(cls));
}

// ── K. sw.js precache ────────────────────────────────────────
expect('sw.js precaches ./src/app_error_overlay.js',
  /['"]\.\/src\/app_error_overlay\.js['"]/.test(sw));
const precacheMatch = sw.match(/PRECACHE\s*=\s*\[([\s\S]*?)\]/);
expect('sw.js precache does NOT contain the prototype render gate',
  !!precacheMatch && !/prototypes\//.test(precacheMatch[1]));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
