// BD-RIDE-D-SHEETS-01 — static regression smoke for the driver active-ride sheets.
//
// The driver cancel + problem bottom sheets live in their own module
// (active_ride_driver_sheets.js, the driver counterpart of
// active_ride_passenger_sheets.js) and are imported into active_ride.js.
// A future refactor could silently drop the reason/type sets, the in-sheet
// state machines (loading → canceled / sent), the custom-reason textarea,
// the safety visual state, or leak ride-state persistence into the
// placeholder problem sheet without tripping `node scripts/check.mjs`.
//
// This script is intentionally STATIC: it reads the sheets module and the
// driver screen and asserts the contract still holds in source. No browser,
// no DOM, no behaviour change — just source assertions.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const sheets = read('../public/src/screens/active_ride_driver_sheets.js');
const screen = read('../public/src/screens/active_ride.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// Extract a `[ ... ]` literal body assigned to `(export )?const NAME = [`.
function arrayBody(source, name) {
  const m = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  return m ? m[1] : null;
}

// ── A. Module exports (the API active_ride.js + this guard rely on) ──
for (const fn of [
  'openDriverCancelSheet',
  'openDriverProblemSheet',
  'renderDriverCancelSheet',
  'renderDriverProblemSheet',
  'bindDriverSheetEvents',
]) {
  expect(`module exports ${fn}`,
    new RegExp(`export\\s+function\\s+${fn}\\s*\\(`).test(sheets));
}
expect('module exports DRIVER_CANCEL_REASON_LABEL_BY_CODE',
  /export\s+const\s+DRIVER_CANCEL_REASON_LABEL_BY_CODE\s*=/.test(sheets));

// ── B. Cancel reasons — the 6 fixed codes (issue #265 contract) ──
const cancelReasons = arrayBody(sheets, 'DRIVER_CANCEL_REASONS');
expect('DRIVER_CANCEL_REASONS array resolved', !!cancelReasons);
const cancelCount = cancelReasons ? (cancelReasons.match(/\n\s*\[/g) || []).length : 0;
expect('DRIVER_CANCEL_REASONS has exactly 6 reasons', cancelCount === 6, 'count=' + cancelCount);
for (const code of ['passenger_no_show', 'wrong_pickup', 'car_problem', 'unsafe_situation', 'cannot_reach_passenger', 'other']) {
  expect(`DRIVER_CANCEL_REASONS includes '${code}'`,
    new RegExp(`'${code}'`).test(cancelReasons || ''));
}

// ── C. Problem types — incl. the safety-class type ──
const problemTypes = arrayBody(sheets, 'DRIVER_PROBLEM_TYPES');
expect('DRIVER_PROBLEM_TYPES array resolved', !!problemTypes);
const problemCount = problemTypes ? (problemTypes.match(/\n\s*\[/g) || []).length : 0;
expect('DRIVER_PROBLEM_TYPES has exactly 6 types', problemCount === 6, 'count=' + problemCount);
for (const code of ['passenger_no_show', 'cannot_reach', 'wrong_pickup', 'car_problem', 'safety', 'contact_support']) {
  expect(`DRIVER_PROBLEM_TYPES includes '${code}'`,
    new RegExp(`'${code}'`).test(problemTypes || ''));
}

// ── D. Cancel state machine + copy ──
// default → reason_selected → validation_error → loading → canceled.
for (const stage of ['default', 'reason_selected', 'validation_error', 'loading', 'canceled']) {
  expect(`cancel/shared sheet knows the '${stage}' stage`,
    new RegExp(`'${stage}'`).test(sheets));
}
expect('cancel sheet transitions into loading then the canceled state',
  /dataset\.stage\s*=\s*'loading'/.test(sheets) && /dataset\.stage\s*=\s*'canceled'/.test(sheets));
expect('cancel sheet flags the validation_error stage',
  /dataset\.stage\s*=\s*'validation_error'/.test(sheets));
expect('cancel sheet reveals the custom-reason textarea via data-custom',
  /dataset\.custom\s*=/.test(sheets) && sheets.includes('driver-cancel-sheet__textarea'));
expect('cancel sheet shows the validation copy',
  sheets.includes('Выберите причину отмены, чтобы продолжить'));
expect('cancel sheet shows the loading copy "Отменяем…"',
  sheets.includes('Отменяем…'));
expect('cancel sheet shows the canceled-state title "Поездка отменена"',
  sheets.includes('Поездка отменена'));
expect('cancel sheet canceled card returns to the feed ("Вернуться в ленту")',
  sheets.includes('Вернуться в ленту'));

// ── E. Problem state machine + safety visual state + copy ──
for (const stage of ['type_selected', 'loading', 'sent']) {
  expect(`problem sheet knows the '${stage}' stage`,
    new RegExp(`'${stage}'`).test(sheets));
}
expect('problem sheet transitions into loading then the sent state',
  /dataset\.stage\s*=\s*'loading'/.test(sheets) && /dataset\.stage\s*=\s*'sent'/.test(sheets));
expect('problem sheet drives a safety visual state via data-safety',
  /dataset\.safety\s*=/.test(sheets) && sheets.includes('driver-problem-sheet__safety-note'));
expect('problem sheet has an optional comment field',
  sheets.includes('driver-problem-sheet__comment'));
expect('problem sheet shows the submit loading copy "Отправляем…"',
  sheets.includes('Отправляем…'));
expect('problem sheet shows the sent-state title "Сигнал отправлен"',
  sheets.includes('Сигнал отправлен'));

// ── F. The problem sheet is a pure UI placeholder ──
// It must never persist ride state or import the data layer; persistence
// (CANCELED / NO_SHOW) is owned by the driver screen's onConfirm callback.
expect('sheets module never persists driver ride status',
  !/persistDriver/.test(sheets));
expect('sheets module never calls updateActiveRideStatus',
  !/updateActiveRideStatus/.test(sheets));
expect('sheets module does not import ride_state.js',
  !/from\s*'[^']*ride_state/.test(sheets));

// ── G. Driver screen wiring + isolation ──
expect('active_ride.js imports the sheets from active_ride_driver_sheets.js',
  /import\s*\{[\s\S]*?openDriverCancelSheet[\s\S]*?openDriverProblemSheet[\s\S]*?\}\s*from\s*'\.\/active_ride_driver_sheets\.js'/.test(screen));
expect('active_ride.js imports the reason-label lookup for the canceled stub',
  /DRIVER_CANCEL_REASON_LABEL_BY_CODE/.test(screen));
expect('active_ride.js does not redefine the sheets inline',
  !/function\s+openDriverCancelSheet\s*\(/.test(screen)
  && !/function\s+openDriverProblemSheet\s*\(/.test(screen)
  && !/function\s+createDriverActionSheet\s*\(/.test(screen));
// Reachability: a user action wires each opener.
expect('cancel button wires openDriverCancelSheet with onConfirm',
  /openDriverCancelSheet\(\s*root\s*,\s*\{[\s\S]*?onConfirm/.test(screen));
expect('problem button (#ar-issue) wires openDriverProblemSheet',
  /#ar-issue'\)[\s\S]{0,200}openDriverProblemSheet\s*\(/.test(screen));
// Persistence stays in the screen — cancel + no-show go through ride_state.
expect('driver screen still persists CANCELED via persistDriverCancel',
  /persistDriverCancel\(\s*RIDE_STATUS\.CANCELED/.test(screen));
expect('driver screen still routes the no-show path to NO_SHOW',
  /RIDE_STATUS\.NO_SHOW/.test(screen) && screen.includes('passenger_no_show'));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
