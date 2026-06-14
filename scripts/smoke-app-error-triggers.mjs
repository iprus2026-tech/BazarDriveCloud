// BD-ERROR-01C-A — static regression smoke for the fetch-failure trigger
// adapter contract.
//
// app_error_triggers.js exposes reportAppShellError(kind, options) — a
// non-mutating adapter that maps a flow's error kind to the BD-ERROR-01A
// overlay (window.BD.GlobalError), coercing any valid kind to 'offline' while
// the device is offline. A refactor could drop the unknown-kind guard, lose the
// offline override, hard-import the overlay module, or leak a
// fetch/storage/ride-order coupling — and `node scripts/check.mjs` would still
// pass.
//
// This script is intentionally STATIC: it reads source and asserts the
// contract holds. No browser, no DOM, no network, no timers.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const triggers = read('../public/src/app_error_triggers.js');
const app = read('../public/src/app.js');
const sw  = read('../public/sw.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── A. module exists + export ────────────────────────────────
expect('app_error_triggers.js is non-empty', triggers.length > 0);
expect('exports reportAppShellError',
  /export\s+function\s+reportAppShellError\b/.test(triggers));
expect('exports dismissAppShellError',
  /export\s+function\s+dismissAppShellError\b/.test(triggers));
expect('dismissAppShellError lazily resolves window.BD.GlobalError and calls hide()',
  /export\s+function\s+dismissAppShellError[\s\S]*?window\.BD[\s\S]*?\.hide\(\)/.test(triggers));
expect('dismissAppShellError honours options.onlyIfState (no clobbering a newer state)',
  /options\.onlyIfState/.test(triggers) && /bd\.current\(\)/.test(triggers) && /current\s*!==\s*options\.onlyIfState[\s\S]{0,20}return/.test(triggers));

// ── B. kinds whitelist + unknown-kind no-op (validated FIRST) ─
expect('KINDS whitelist defined', /const\s+KINDS\s*=\s*\[/.test(triggers));
for (const kind of ['offline', 'timeout', 'server_error', 'retrying', 'recovered']) {
  expect(`KINDS contains '${kind}'`, new RegExp(`'${kind}'`).test(triggers));
}
const kindCount = (triggers.match(/const\s+KINDS\s*=\s*\[([\s\S]*?)\]/)?.[1].match(/'/g) || []).length / 2;
expect('KINDS has exactly 5 kinds', kindCount === 5, 'count=' + kindCount);
expect('unknown kind is a safe no-op (early return on !KINDS.includes)',
  /if\s*\(!KINDS\.includes\(kind\)\)\s*return/.test(triggers));
// the unknown-kind guard must come before the offline override / show() call.
// Anchor on the override EXPRESSION (not bare navigator.onLine, which also
// appears in the doc comment above the function).
const guardIdx = triggers.search(/if\s*\(!KINDS\.includes\(kind\)\)\s*return/);
const overrideIdx = triggers.search(/navigator\.onLine\s*===\s*false\s*\)\s*\?\s*'offline'/);
const showIdx = triggers.indexOf('api.show(');
expect('unknown-kind guard runs before the offline override',
  guardIdx !== -1 && overrideIdx !== -1 && guardIdx < overrideIdx);
expect('unknown-kind guard runs before any show()',
  guardIdx !== -1 && showIdx !== -1 && guardIdx < showIdx);

// ── C. offline override (uniform coercion) ───────────────────
expect('coerces to offline while navigator.onLine === false',
  /navigator\.onLine\s*===\s*false\s*\)\s*\?\s*'offline'/.test(triggers));

// ── D. drives overlay via window.BD.GlobalError, lazily ───────
expect('reads window.BD.GlobalError', /window\.BD\b[\s\S]{0,40}GlobalError/.test(triggers));
expect('forwards options to overlay.show(...)', /api\.show\(\s*resolved\s*,\s*options\s*\)/.test(triggers));

// ── E. does NOT import the overlay module directly ───────────
expect('does NOT import app_error_overlay directly (lazy window API only)',
  !/import[\s\S]*?from\s*'[^']*app_error_overlay/.test(triggers));

// ── F. strict out-of-scope: no coupling, no mutation ─────────
const FORBIDDEN_IMPORT = ['ride_state', 'driver_offer_store', 'mock_api', 'mapbox', 'order_detail', 'active_ride', 'app_error_overlay', 'app_connection_status'];
for (const mod of FORBIDDEN_IMPORT) {
  expect(`does NOT import ${mod}`, !new RegExp(`from\\s+'[^']*${mod}`).test(triggers), 'forbidden import');
}
const FORBIDDEN_VOCAB = [
  'fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage',
  'updateTripStatus', 'acceptOrder', 'saveActiveRide', 'RIDE_STATUS', 'persistDriver',
];
for (const tok of FORBIDDEN_VOCAB) {
  expect(`source contains no '${tok}' (no fetch / storage / ride-order mutation)`,
    !triggers.includes(tok));
}

// ── G. app.js untouched by this slice (no wiring, no /error) ──
expect('app.js does NOT import app_error_triggers (no boot wiring in 01C-A)',
  !/app_error_triggers/.test(app));
expect('app.js does NOT register an /error route (any quote style)',
  !/register\(\s*['"`]\/error/.test(app));

// ── H. sw.js precache ────────────────────────────────────────
expect('sw.js precaches ./src/app_error_triggers.js',
  /['"]\.\/src\/app_error_triggers\.js['"]/.test(sw));
const precacheMatch = sw.match(/PRECACHE\s*=\s*\[([\s\S]*?)\]/);
expect('sw.js precache does NOT contain the prototype render gate',
  !!precacheMatch && !/prototypes\//.test(precacheMatch[1]));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
