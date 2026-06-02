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
// scoped to one renderer doesn't accidentally inspect another. Skips the
// parameter list first so an object-default param (e.g. `(options = {})`)
// is not mistaken for the function body's opening brace.
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) return null;
  const paren = source.indexOf('(', start);
  if (paren === -1) return null;
  let pdepth = 0;
  let afterParams = -1;
  for (let i = paren; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') pdepth++;
    else if (ch === ')') {
      pdepth--;
      if (pdepth === 0) { afterParams = i + 1; break; }
    }
  }
  if (afterParams === -1) return null;
  const open = source.indexOf('{', afterParams);
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

// ── A. Supported-status coverage (exact set) ─────────────────
// PASSENGER_SUPPORTED_STATUSES must equal EXACTLY the six live passenger
// stages. Presence-only checks would let a refactor add a pre-ride state
// (NEW_ORDER / CONFIRMATION_PENDING / CONFIRMED / CHAT_STARTED) into the
// set, dropping its renderPassengerStub fall-through and pushing it into
// the active-ride render pipeline — so compare the whole set, failing on
// any MISSING or EXTRA status.
const ALLOWED_SUPPORTED = [
  'ACCEPTED',
  'DRIVER_EN_ROUTE',
  'DRIVER_APPROACHING_PICKUP',
  'WAITING_PASSENGER',
  'IN_PROGRESS',
  'COMPLETED',
];
const supportedMatch = passenger.match(/PASSENGER_SUPPORTED_STATUSES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
expect('PASSENGER_SUPPORTED_STATUSES set resolved', !!supportedMatch);
const supportedStatuses = supportedMatch
  ? (supportedMatch[1].match(/RIDE_STATUS\.(\w+)/g) || []).map((t) => t.replace('RIDE_STATUS.', ''))
  : [];
const missing = ALLOWED_SUPPORTED.filter((s) => !supportedStatuses.includes(s));
const extra = supportedStatuses.filter((s) => !ALLOWED_SUPPORTED.includes(s));
expect('PASSENGER_SUPPORTED_STATUSES has no missing status',
  missing.length === 0, 'missing=' + JSON.stringify(missing));
expect('PASSENGER_SUPPORTED_STATUSES has no extra status',
  extra.length === 0, 'extra=' + JSON.stringify(extra));
expect('PASSENGER_SUPPORTED_STATUSES equals the exact allowed set',
  JSON.stringify([...supportedStatuses].sort()) === JSON.stringify([...ALLOWED_SUPPORTED].sort()),
  'got=' + JSON.stringify(supportedStatuses));

// ── B. CANCELED / NO_SHOW → canceled fallback (scoped + ordered) ──
// Scope to the activeRidePassenger() dispatch body and assert the
// terminal CANCELED / NO_SHOW branches run BEFORE the
// `!PASSENGER_SUPPORTED_STATUSES.has(...)` fallback. If a refactor hoists
// the unsupported-status branch above them, terminal rides would render
// the generic stub instead of renderPassengerCanceledFallback.
expect('renderPassengerCanceledFallback is defined',
  /function\s+renderPassengerCanceledFallback\s*\(/.test(passenger));
const dispatchBody = functionBody(passenger, 'activeRidePassenger') || '';
expect('activeRidePassenger() body resolved', dispatchBody.length > 0);
expect('activeRidePassenger CANCELED routes to renderPassengerCanceledFallback(ride, \'canceled\')',
  /ride\.status\s*===\s*RIDE_STATUS\.CANCELED\s*\)\s*\{?\s*return\s+renderPassengerCanceledFallback\(\s*ride\s*,\s*'canceled'\s*\)/.test(dispatchBody));
expect('activeRidePassenger NO_SHOW routes to renderPassengerCanceledFallback(ride, \'no_show\')',
  /ride\.status\s*===\s*RIDE_STATUS\.NO_SHOW\s*\)\s*\{?\s*return\s+renderPassengerCanceledFallback\(\s*ride\s*,\s*'no_show'\s*\)/.test(dispatchBody));
const idxCanceled = dispatchBody.search(/ride\.status\s*===\s*RIDE_STATUS\.CANCELED/);
const idxNoShow = dispatchBody.search(/ride\.status\s*===\s*RIDE_STATUS\.NO_SHOW/);
const idxUnsupported = dispatchBody.search(/!\s*PASSENGER_SUPPORTED_STATUSES\.has\s*\(/);
expect('activeRidePassenger has the unsupported-status fallback branch', idxUnsupported !== -1);
expect('CANCELED branch precedes the unsupported-status fallback',
  idxCanceled !== -1 && idxUnsupported !== -1 && idxCanceled < idxUnsupported,
  `canceled@${idxCanceled} unsupported@${idxUnsupported}`);
expect('NO_SHOW branch precedes the unsupported-status fallback',
  idxNoShow !== -1 && idxUnsupported !== -1 && idxNoShow < idxUnsupported,
  `noShow@${idxNoShow} unsupported@${idxUnsupported}`);

// ── C. Cancel sheet ──────────────────────────────────────────
expect('openPassengerCancelSheet is defined',
  /function\s+openPassengerCancelSheet\s*\(/.test(passenger));
// Reachability: the active-ride render path must wire a user action to
// openPassengerCancelSheet(...), not just leave a dead helper behind. A
// future change that removes the cancel button/listener should trip this.
const cancelCallSites = (passenger.match(/openPassengerCancelSheet\s*\(/g) || []).length;
expect('openPassengerCancelSheet has a call site beyond its definition',
  cancelCallSites >= 2, 'occurrences=' + cancelCallSites);
expect('cancel button (#arp-cancel) click wires to openPassengerCancelSheet(...)',
  /#arp-cancel'\)[\s\S]{0,600}addEventListener\(\s*'click'[\s\S]{0,400}openPassengerCancelSheet\s*\(/.test(passenger));
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

// ── E. Role isolation / dispatch contract ────────────────────
// Current, intentional contract: active_ride.js derives the role from the
// ?role= query override first, then the persisted user role. role ===
// 'driver' renders the driver flow; any other role renders the passenger
// flow. The URL ?role= override is intentional for manual/mock testing,
// so this guard pins the CURRENT contract — it does NOT assert the
// override is impossible.
expect('dispatcher imports activeRidePassenger',
  /import\s+activeRidePassenger\s+from\s+'\.\/active_ride_passenger\.js'/.test(dispatcher));
expect('dispatcher derives role from ?role= override then persisted role',
  /const\s+role\s*=\s*query\.get\('role'\)\s*\|\|/.test(dispatcher));
expect('dispatcher renders passenger flow for any non-driver role (driver flow only when role === "driver")',
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
