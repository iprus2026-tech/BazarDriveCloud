// BD-RIDE-D-ERROR-01B — static regression smoke for the driver status-sync guard.
//
// active_ride.js wraps the driver status-change mutation boundary
// (persistDriverRideStatus → saveActiveRide / updateActiveRideStatus /
// syncCanonicalOrderStatus → updateTripStatus) in a try/catch. On failure it
// routes a global server_error sheet with a guarded retry that repeats the SAME
// status change; on success it clears its own error sheet. Both the report and
// the dismiss are scoped by a per-screen token so a status-sync error can never
// clobber another screen's server_error on the singleton overlay.
//
// Defensive/dormant: the persist + canonical-order sync are sync localStorage
// today and do not reject — but a future ride-events backend could, and then the
// driver would get an in-flow retry instead of a silently-stuck status. Scope:
// only the mutation boundary is wrapped — driver renderers, the passenger flow,
// and ride_state statuses are unchanged.
//
// This script is intentionally STATIC: it reads source and asserts the contract.
// No browser, no DOM, no network.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const ride = read('../public/src/screens/active_ride.js');
const app  = read('../public/src/app.js');
const sw   = read('../public/sw.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── A. adapter import ────────────────────────────────────────
expect('active_ride.js imports reportAppShellError + dismissAppShellError from ../app_error_triggers.js',
  /import\s*\{[\s\S]*?reportAppShellError[\s\S]*?dismissAppShellError[\s\S]*?\}\s*from\s*'\.\.\/app_error_triggers\.js'/.test(ride));

// ── B. per-screen token + guarded helper for the DIRECT actions only ──
expect('mints a per-screen statusSyncToken',
  /const\s+statusSyncToken\s*=\s*\{\s*\}/.test(ride));
expect('guardedDriverStatusChange(nextStatus, patch) wraps the persist in a try',
  /function\s+guardedDriverStatusChange\(\s*nextStatus\s*,\s*patch\s*=\s*\{\s*\}\s*\)\s*\{[\s\S]{0,80}try\s*\{[\s\S]{0,160}persistDriverRideStatus\(/.test(ride));
expect('the 6 direct lifecycle actions route through guardedDriverStatusChange',
  (ride.match(/=\s*guardedDriverStatusChange\(RIDE_STATUS\./g) || []).length === 6,
  'accept / start-pickup / approaching / arrived / start / finish');

// ── B2. the cancel/no-show sheet path is NOT routed through the guard ──
expect('the overlay guard lives in ONE place — reportAppShellError appears once',
  (ride.match(/reportAppShellError\(/g) || []).length === 1,
  'only guardedDriverStatusChange reports; persistDriverRideStatus stays unguarded');
expect('persistDriverRideStatus itself does not report (cancel/no-show keeps its own sheet flow)',
  !/function\s+persistDriverRideStatus\([\s\S]*?reportAppShellError\(/.test(
    ride.slice(ride.indexOf('function persistDriverRideStatus'), ride.indexOf('function guardedDriverStatusChange'))),
  'no reportAppShellError between persistDriverRideStatus and guardedDriverStatusChange');
expect('the cancel/no-show path goes through persistDriverCancel (unguarded by design)',
  /persistDriverCancel\(/.test(ride) && /persistDriverCancel\([\s\S]{0,80}return\s+persistDriverRideStatus\(/.test(ride.slice(ride.indexOf('function persistDriverCancel'))));

// ── C. failure → server_error with a guarded retry repeating THE SAME change ──
expect('on failure reports server_error to the global overlay',
  /catch\s*\(\s*err\s*\)\s*\{[\s\S]*?reportAppShellError\(\s*'server_error'\s*,/.test(ride));
expect('the retry repeats the SAME status change (guardedDriverStatusChange(nextStatus, patch)) then re-renders',
  /onRetry:\s*\(\)\s*=>\s*\{\s*ride\s*=\s*guardedDriverStatusChange\(\s*nextStatus\s*,\s*patch\s*\)\s*;\s*renderSheet\(\)/.test(ride));
expect('the server_error report is tagged with the per-screen token',
  /reportAppShellError\(\s*'server_error'\s*,\s*\{[\s\S]*?token:\s*statusSyncToken/.test(ride));
expect('the catch keeps the current ride (status change does not apply on failure)',
  /reportAppShellError\(\s*'server_error'[\s\S]*?\}\s*\)\s*;\s*return\s+ride\s*;/.test(ride));

// ── D. success → clears OUR error sheet only (onlyIfState + token) ──
expect('a successful sync dismisses our own server_error, guarded by onlyIfState + token',
  /dismissAppShellError\(\s*\{\s*onlyIfState:\s*'server_error'\s*,\s*token:\s*statusSyncToken\s*\}\s*\)/.test(ride));

// ── E. scope guard — driver lifecycle untouched, no /error route ──
expect('the driver lifecycle renderer renderSheet still exists (renderers unchanged)',
  /function\s+renderSheet\s*\(/.test(ride));
expect('active_ride.js does not re-route to a global error route on failure',
  !/go\(\s*['"`]\/error/.test(ride));
expect('app.js does NOT register an /error route (any quote style)',
  !/register\(\s*['"`]\/error/.test(app));

// ── F. sw precache + version bump ────────────────────────────
expect('sw.js still precaches ./src/screens/active_ride.js',
  /['"]\.\/src\/screens\/active_ride\.js['"]/.test(sw));
expect('sw.js still precaches the adapter ./src/app_error_triggers.js',
  /['"]\.\/src\/app_error_triggers\.js['"]/.test(sw));
expect('sw.js VERSION bumped to v139+',
  Number(sw.match(/VERSION\s*=\s*'v(\d+)'/)?.[1] || 0) >= 139);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
