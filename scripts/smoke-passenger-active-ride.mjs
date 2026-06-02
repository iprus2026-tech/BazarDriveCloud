// BD-RIDE-P-12 — static regression smoke for the passenger active ride contract.
//
// BD-RIDE-P-11 audited the passenger Active Ride screen and returned PASS
// (no runtime drift), but flagged that — unlike the driver branch, which is
// pinned in scripts/check.mjs — the passenger side had no executable guard.
// A future refactor of public/src/screens/active_ride_passenger.js could
// silently drop the supported-status set, the cancel/safety sheets, the
// CANCELED/NO_SHOW fallback routing, or leak driver renderers into the
// passenger file without tripping `node scripts/check.mjs`.
//
// This script is intentionally STATIC: it reads the passenger screen, the
// dispatcher and ride_state.js and asserts the contract still holds in
// source. No browser, no DOM, no behaviour change — just source assertions.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const passenger  = read('../public/src/screens/active_ride_passenger.js');
const dispatcher = read('../public/src/screens/active_ride.js');
const rideState  = read('../public/src/ride_state.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// Extract a function body by name via brace matching, so an assertion
// scoped to one renderer doesn't accidentally inspect another.
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

// Extract a `[ ... ]` literal body assigned to `const NAME = [`.
function arrayBody(source, name) {
  const m = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  return m ? m[1] : null;
}

// ── A. Supported-status coverage ─────────────────────────────
// The live passenger stages live in PASSENGER_SUPPORTED_STATUSES; the
// terminal CANCELED / NO_SHOW states are deliberately NOT in the set —
// they route through renderPassengerCanceledFallback (see B).
const supportedMatch = passenger.match(/PASSENGER_SUPPORTED_STATUSES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
const supported = supportedMatch ? supportedMatch[1] : '';
expect('PASSENGER_SUPPORTED_STATUSES set resolved', !!supportedMatch);
for (const s of ['ACCEPTED', 'DRIVER_EN_ROUTE', 'DRIVER_APPROACHING_PICKUP', 'WAITING_PASSENGER', 'IN_PROGRESS', 'COMPLETED']) {
  expect(`supported set includes RIDE_STATUS.${s}`,
    new RegExp(`RIDE_STATUS\\.${s}\\b`).test(supported));
}
expect('supported set excludes RIDE_STATUS.CANCELED (served by fallback)',
  !/RIDE_STATUS\.CANCELED\b/.test(supported));
expect('supported set excludes RIDE_STATUS.NO_SHOW (served by fallback)',
  !/RIDE_STATUS\.NO_SHOW\b/.test(supported));

// ── B. CANCELED / NO_SHOW → canceled fallback routing ────────
expect('renderPassengerCanceledFallback is defined',
  /function\s+renderPassengerCanceledFallback\s*\(/.test(passenger));
expect('CANCELED routes to renderPassengerCanceledFallback(ride, \'canceled\')',
  /ride\.status\s*===\s*RIDE_STATUS\.CANCELED\s*\)\s*\{?\s*return\s+renderPassengerCanceledFallback\(\s*ride\s*,\s*'canceled'\s*\)/.test(passenger));
expect('NO_SHOW routes to renderPassengerCanceledFallback(ride, \'no_show\')',
  /ride\.status\s*===\s*RIDE_STATUS\.NO_SHOW\s*\)\s*\{?\s*return\s+renderPassengerCanceledFallback\(\s*ride\s*,\s*'no_show'\s*\)/.test(passenger));

// ── C. Cancel sheet ──────────────────────────────────────────
expect('openPassengerCancelSheet is defined',
  /function\s+openPassengerCancelSheet\s*\(/.test(passenger));
const cancelReasons = arrayBody(passenger, 'CANCEL_REASONS');
expect('CANCEL_REASONS array resolved', !!cancelReasons);
const reasonCount = cancelReasons ? (cancelReasons.match(/\bid:/g) || []).length : 0;
expect('CANCEL_REASONS has exactly 6 reasons', reasonCount === 6, 'count=' + reasonCount);
for (const id of ['driver_slow', 'plans_changed', 'other_transport', 'address_error', 'no_contact', 'other']) {
  expect(`CANCEL_REASONS includes id '${id}'`,
    new RegExp(`id:\\s*'${id}'`).test(cancelReasons || ''));
}
// Two-stage confirm: reason select (stage A/B) then "Точно отменить?" (stage C).
expect('cancel sheet has select stage',
  /dataset\.stage\s*=\s*'select'/.test(passenger));
expect('cancel sheet has confirm stage',
  /dataset\.stage\s*=\s*'confirm'/.test(passenger));
expect('cancel sheet confirm copy "Точно отменить?" present',
  passenger.includes('Точно отменить?'));

// ── D. Safety sheet ──────────────────────────────────────────
expect('openPassengerSafetySheet is defined',
  /function\s+openPassengerSafetySheet\s*\(/.test(passenger));
expect('safety sheet exposes SOS button (#arp-safety-sos)',
  passenger.includes('arp-safety-sos'));
expect('safety sheet has SOS label', passenger.includes('SOS'));
const safetyActions = arrayBody(passenger, 'SAFETY_ACTIONS');
expect('SAFETY_ACTIONS array resolved', !!safetyActions);
for (const id of ['share', 'trusted', 'support', 'help']) {
  expect(`SAFETY_ACTIONS includes row '${id}'`,
    new RegExp(`id:\\s*'${id}'`).test(safetyActions || ''));
}

// ── E. Role isolation ────────────────────────────────────────
// Dispatch: active_ride.js routes a non-driver role to the passenger
// renderer and never lets the passenger reach driver-only branches.
expect('dispatcher imports activeRidePassenger',
  /import\s+activeRidePassenger\s+from\s+'\.\/active_ride_passenger\.js'/.test(dispatcher));
expect('dispatcher routes non-driver role to renderPassenger()',
  /if\s*\(\s*role\s*!==\s*'driver'\s*\)\s*return\s+renderPassenger\(\)/.test(dispatcher));
expect('renderPassenger() returns activeRidePassenger(...)',
  /return\s+activeRidePassenger\(/.test(dispatcher));
// No driver renderers/handlers duplicated into the passenger file. These
// are specific driver-only identifiers — NOT a broad /Driver/ match, since
// the passenger file legitimately imports the data-only
// loadDriverHandoffSnapshot helpers and mentions syncCanonicalOrderStatus
// in a comment.
for (const id of ['persistDriverRideStatus', 'persistDriverCancel', 'ensureDriverSheetsCss', 'renderDriverEmpty', 'openDriverCancelSheet']) {
  expect(`passenger file does not define driver handler ${id}`,
    !new RegExp(id).test(passenger));
}

// ── F. Cross-check vs ride_state.js ──────────────────────────
// Guard against the RIDE_STATUS enum drifting from what the passenger
// screen pins above. Every status the contract names must still be a
// `KEY: 'KEY'` member of the enum.
for (const s of ['ACCEPTED', 'DRIVER_EN_ROUTE', 'DRIVER_APPROACHING_PICKUP', 'WAITING_PASSENGER', 'IN_PROGRESS', 'COMPLETED', 'CANCELED', 'NO_SHOW']) {
  expect(`ride_state.js RIDE_STATUS defines ${s}: '${s}'`,
    new RegExp(`${s}:\\s*'${s}'`).test(rideState));
}

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
