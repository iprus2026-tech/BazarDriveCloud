// BD-DRIVER-02 — static regression smoke for the DriverMap readiness gate.
//
// /driver-map must gate the working accept surface behind isDriverLineReady():
// a role=driver who is not line-ready sees a readiness banner + read-only
// checklist + LOCKED order cards and is routed to /profile — never an accept
// button. This script is intentionally STATIC: it reads the source and asserts
// the gate contract still holds, so a future refactor cannot silently drop the
// gate (or let isDriverLineReady drift back into a screen-local copy) without
// tripping `node scripts/check.mjs`. No browser, no DOM, no behaviour change.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const driverMap = read('../public/src/screens/driver_map.js');
const state     = read('../public/src/state.js');
const profile   = read('../public/src/screens/profile.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// 1) The readiness rule is the single source of truth in state.js …
expect('state.js exports isDriverLineReady',
  /export\s+function\s+isDriverLineReady\s*\(/.test(state));
expect('state.js exports canShowReadyStatus',
  /export\s+function\s+canShowReadyStatus\s*\(/.test(state));

// 2) … and profile.js no longer defines its own copy (no drift).
expect('profile.js does not redefine isDriverLineReady locally',
  !/function\s+isDriverLineReady\s*\(/.test(profile));
expect('profile.js imports isDriverLineReady from state.js',
  /import\s*\{[^}]*isDriverLineReady[^}]*\}\s*from\s*'\.\.\/state\.js'/s.test(profile));

// 3) driver_map.js imports and enforces the gate.
expect('driver_map.js imports isDriverLineReady from state.js',
  /import\s*\{[^}]*isDriverLineReady[^}]*\}\s*from\s*'\.\.\/state\.js'/s.test(driverMap));
expect('driver_map.js branches on !isDriverLineReady(...)',
  /if\s*\(\s*!\s*isDriverLineReady\s*\(/.test(driverMap));

// 4) Gate copy is present.
expect('gate banner copy "профиль не готов" present',
  driverMap.includes('профиль не готов'));
expect('gate CTA copy "Завершить готовность" present',
  driverMap.includes('Завершить готовность'));
expect('locked order copy "Доступно после готовности" present',
  driverMap.includes('Доступно после готовности'));

// 5) The "Завершить готовность" CTA routes to /profile.
expect('complete-readiness action present',
  /data-action="complete-readiness"/.test(driverMap));
expect("complete-readiness routes to '/profile'",
  /complete-readiness'\s*\)\s*\{\s*\n?\s*go\('\/profile'\)/.test(driverMap)
    || /action === 'complete-readiness'[\s\S]{0,80}go\('\/profile'\)/.test(driverMap));

// 6) Locked rows expose NO accept action — the gate can't accept an order.
//    The locked builder branch must render the locked zone, not the button.
expect('buildOrderRow supports a locked variant',
  /buildOrderRow\s*\(\s*order\s*,\s*index\s*,\s*\{\s*locked/.test(driverMap));
expect('locked variant renders the locked zone (no accept button)',
  /locked\s*\n?\s*\?\s*`<div class="driver-map__order-locked"/.test(driverMap));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
