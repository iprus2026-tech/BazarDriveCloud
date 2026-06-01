// BD-DRIVER-01 — static regression smoke for the driver-map role guard.
//
// The manual smoke loads  /public/#/driver-map?role=driver  as a
// passenger/guest and confirms it renders the guard ("Это экран водителя")
// and exposes no driver-only accept actions. The leak this guards against
// is a URL ?role= override letting a passenger reach the working surface.
//
// This script is intentionally STATIC: it reads driver_map.js and asserts
// the guard contract still holds in source, so a future refactor cannot
// silently re-open the override without tripping `node scripts/check.mjs`.
// No browser, no DOM, no behaviour change — just source assertions.

import fs from 'node:fs';

const driverMapUrl = new URL('../public/src/screens/driver_map.js', import.meta.url);
const src = fs.readFileSync(driverMapUrl, 'utf8');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// Extract a function body by name via brace matching, so guard-only
// assertions don't accidentally inspect the driver-side list builders.
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

// 1) resolveEffectiveRole exists and reads the persisted user state.
expect('resolveEffectiveRole is defined',
  /function\s+resolveEffectiveRole\s*\(/.test(src));
const resolveBody = functionBody(src, 'resolveEffectiveRole');
expect('resolveEffectiveRole reads role from user.get()',
  !!resolveBody && /user\.get\(\)/.test(resolveBody),
  'body=' + JSON.stringify(resolveBody));

// 2) The render gate bails to the guard for any non-driver role.
expect('guard branch: if (role !== "driver") return renderPassengerGuard()',
  /if\s*\(\s*role\s*!==\s*'driver'\s*\)\s*\{?\s*return\s+renderPassengerGuard\(\)/.test(src));

// 3) Guard copy is present.
expect('guard copy "Это экран водителя" present',
  src.includes('Это экран водителя'));

// 4) Role must NOT be derivable from the URL — no ?role= override.
expect('driver_map.js does not use URLSearchParams for role override',
  !/URLSearchParams/.test(src));
expect('driver_map.js does not read location.hash for role override',
  !/location\.hash/.test(src));
expect('driver_map.js does not read location.search for role override',
  !/location\.search/.test(src));

// 5) The guard render path must expose no driver-only accept action.
const guardSources = [
  functionBody(src, 'renderPassengerGuard'),
  functionBody(src, 'buildPassengerGuardCard'),
  functionBody(src, 'buildPassengerGuardTopbar'),
].filter(Boolean);
expect('guard render functions resolved', guardSources.length === 3,
  'resolved=' + guardSources.length);
const guardCombined = guardSources.join('\n');
expect('guard template contains no data-action="accept"',
  !/data-action="accept"/.test(guardCombined));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
