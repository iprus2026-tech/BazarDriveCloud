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
const sheets     = read('../public/src/screens/active_ride_passenger_sheets.js');
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

// ── C. Cancel sheet (BD-RIDE-P-06 — fresh Cloud Design contract) ──
// PassengerCancelRideSheet now lives in active_ride_passenger_sheets.js;
// the passenger screen only wires it in. Reasons, the in-sheet state
// machine and the new copy are pinned here so a refactor can't silently
// drop them back to the old two-stage "Точно отменить?" flow.
expect('openPassengerCancelSheet is defined in the sheets module',
  /function\s+openPassengerCancelSheet\s*\(/.test(sheets));
// Reachability: the active-ride render path must wire a user action to
// openPassengerCancelSheet(...), not just leave a dead helper behind.
expect('cancel button (#arp-cancel) click wires to openPassengerCancelSheet(...)',
  /#arp-cancel'\)[\s\S]{0,600}addEventListener\(\s*'click'[\s\S]{0,400}openPassengerCancelSheet\s*\(/.test(passenger));
const cancelReasons = arrayBody(sheets, 'CANCEL_REASONS');
expect('CANCEL_REASONS array resolved', !!cancelReasons);
const cancelReasonCount = cancelReasons ? (cancelReasons.match(/\bid:/g) || []).length : 0;
expect('CANCEL_REASONS has exactly 5 reasons', cancelReasonCount === 5, 'count=' + cancelReasonCount);
for (const id of ['changed_mind', 'driver_far', 'address_error', 'other_way', 'other']) {
  expect(`CANCEL_REASONS includes id '${id}'`,
    new RegExp(`id:\\s*'${id}'`).test(cancelReasons || ''));
}
// State machine: default → reason_selected → validation_error → loading → canceled.
for (const stage of ['default', 'reason_selected', 'validation_error', 'loading', 'canceled']) {
  expect(`cancel sheet knows the '${stage}' stage`,
    new RegExp(`'${stage}'`).test(sheets));
}
expect('cancel sheet actually transitions into loading then the canceled state',
  /dataset\.stage\s*=\s*'loading'/.test(sheets) && /dataset\.stage\s*=\s*'canceled'/.test(sheets));
expect('cancel sheet shows the "водитель в пути" rating warning',
  sheets.includes('Отмена может повлиять на рейтинг'));
expect('cancel sheet shows the validation copy',
  sheets.includes('Выберите причину отмены, чтобы продолжить'));
expect('cancel sheet shows the loading copy "Отменяем…"',
  sheets.includes('Отменяем…'));
expect('cancel sheet shows the canceled-state title "Поездка отменена"',
  sheets.includes('Поездка отменена'));

// ── D. Safety sheet (BD-RIDE-P-07 — fresh Cloud Design contract) ──
// PassengerSafetySheet now lives in the sheets module with a default /
// report / emergency view machine. Pin the new action set, the report
// flow (selected → submitted №RPT-4821) and the demo-only emergency view.
expect('openPassengerSafetySheet is defined in the sheets module',
  /function\s+openPassengerSafetySheet\s*\(/.test(sheets));
expect('safety sheet exposes the SOS hold tile (#arp-safety-sos)',
  sheets.includes('arp-safety-sos'));
expect('safety sheet has the SOS label', /\bSOS\b/.test(sheets));
const safetyActions = arrayBody(sheets, 'SAFETY_ACTIONS');
expect('SAFETY_ACTIONS array resolved', !!safetyActions);
const safetyActionCount = safetyActions ? (safetyActions.match(/\bid:/g) || []).length : 0;
expect('SAFETY_ACTIONS has exactly 5 actions', safetyActionCount === 5, 'count=' + safetyActionCount);
for (const id of ['call', 'chat', 'report', 'sos', 'share']) {
  expect(`SAFETY_ACTIONS includes action '${id}'`,
    new RegExp(`id:\\s*'${id}'`).test(safetyActions || ''));
}
const safetyReportReasons = arrayBody(sheets, 'SAFETY_REPORT_REASONS');
expect('SAFETY_REPORT_REASONS array resolved', !!safetyReportReasons);
const safetyReasonCount = safetyReportReasons ? (safetyReportReasons.match(/\bid:/g) || []).length : 0;
expect('SAFETY_REPORT_REASONS has exactly 5 reasons', safetyReasonCount === 5, 'count=' + safetyReasonCount);
for (const id of ['route_deviation', 'rude', 'car_mismatch', 'unsafe_driving', 'other']) {
  expect(`SAFETY_REPORT_REASONS includes id '${id}'`,
    new RegExp(`id:\\s*'${id}'`).test(safetyReportReasons || ''));
}
// View machine: default / report / emergency, with a report sub-state.
for (const view of ['default', 'report', 'emergency']) {
  expect(`safety sheet knows the '${view}' view`,
    new RegExp(`dataset\\.view\\s*=\\s*'${view}'`).test(sheets) || new RegExp(`view--${view}`).test(sheets));
}
expect('safety report has a selected sub-state',
  /dataset\.report\s*=\s*'selected'/.test(sheets));
expect('safety report has a submitted sub-state',
  /dataset\.report\s*=\s*'submitted'/.test(sheets));
expect('safety report shows the submitted ticket id RPT-4821',
  sheets.includes('RPT-4821'));
expect('safety emergency shows "Позвонить 112"',
  sheets.includes('Позвонить 112'));
expect('safety emergency notifies contacts', sheets.includes('Уведомить контакты'));
expect('safety emergency is demo-only (no real dispatch)', /demo/i.test(sheets));

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
// BD-RIDE-SHEETS-01 — the sheets live in their own module and are
// imported into the passenger screen, not redefined inline. This keeps
// the screen lean and is the seam sections C/D assert against.
expect('passenger screen imports the sheets from active_ride_passenger_sheets.js',
  /import\s*\{[^}]*openPassengerSafetySheet[^}]*openPassengerCancelSheet[^}]*\}\s*from\s*'\.\/active_ride_passenger_sheets\.js'/.test(passenger));
expect('passenger screen does not redefine the sheets inline',
  !/function\s+openPassengerSafetySheet\s*\(/.test(passenger)
  && !/function\s+openPassengerCancelSheet\s*\(/.test(passenger));
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
