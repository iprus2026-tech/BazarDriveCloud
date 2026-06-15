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

// Extract a function body by name via brace matching. Works for both
// top-level `function NAME(...)` and nested `function NAME(...)` declared
// inside another function — the driver dispatcher's renderers all live
// inside the activeRide() default export but `source.indexOf` still finds
// them by exact name match.
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
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

// Extract the args-string of a call like `foo(...)`. `startIdx` must point
// at the opening `(`. Returns everything between that `(` and its matching
// `)` (parens-balanced; ignores parens inside the args' nested calls).
function callArgsAt(source, startIdx) {
  if (source[startIdx] !== '(') return null;
  let depth = 0;
  for (let i = startIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return source.slice(startIdx + 1, i);
    }
  }
  return null;
}

// Extract the body of an `addEventListener('click', () => …)` registered on
// a specific selector token (e.g. "ar-issue"). Returns the part after the
// `() =>` arrow inside the listener args — which is either an expression
// (e.g. `openDriverProblemSheet(root, { ... })`) or a `{ … }` block, both
// captured fully via parens-balance, so semicolons inside the body are NOT
// truncation points.
function clickHandlerBody(source, selectorToken) {
  const anchor = source.indexOf(`${selectorToken}'`);
  if (anchor === -1) return null;
  const listener = source.indexOf('.addEventListener', anchor);
  if (listener === -1) return null;
  const callOpen = source.indexOf('(', listener);
  if (callOpen === -1) return null;
  const args = callArgsAt(source, callOpen);
  if (args == null) return null;
  // args looks like `'click', () => <body>`; lock onto the arrow.
  const arrow = args.indexOf('=>');
  if (arrow === -1) return null;
  return args.slice(arrow + 2).trim();
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
expect('DRIVER_PROBLEM_TYPES has exactly 5 types (BD-RIDE-D-08 redesign)', problemCount === 5, 'count=' + problemCount);
for (const code of ['passenger_no_show', 'unsafe_situation', 'route_problem', 'payment_problem', 'other']) {
  expect(`DRIVER_PROBLEM_TYPES includes '${code}'`,
    new RegExp(`'${code}'`).test(problemTypes || ''));
}
expect("unsafe_situation carries the danger/safety flag (true)",
  /\['unsafe_situation'[^\]]*,\s*true\s*\]/.test(problemTypes || ''));

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

// ── D2. Cancel sheet redesign (BD-RIDE-D-07) — icon box + SOS + JS hooks ──
// The reason rows gained a leading icon box and an always-on «SOS» tag on the
// unsafe reason. The JS hooks (.driver-cancel-sheet__option / --selected /
// data-value) and the bindCancelEvents state machine are unchanged, so the
// section-D stage/copy pins above still hold.
expect('cancel reason rows render a leading icon box backed by the per-reason icon set',
  sheets.includes('driver-cancel-sheet__icon') && /CANCEL_REASON_ICON\s*=/.test(sheets));
expect('cancel icon set covers all 6 reason codes',
  ['passenger_no_show', 'wrong_pickup', 'car_problem', 'unsafe_situation', 'cannot_reach_passenger', 'other']
    .every((code) => new RegExp(`${code}:\\s*cancelIcon\\(`).test(sheets)));
expect('unsafe reason carries the always-on «SOS» tag (danger visual, cancel-only)',
  sheets.includes('driver-cancel-sheet__safety-tag') && /value === 'unsafe_situation'/.test(sheets));
expect('cancel option keeps the JS hook class + data-value (state machine intact)',
  sheets.includes('driver-cancel-sheet__option--selected')
  && /data-value="\$\{escapeHtml\(value\)\}"/.test(sheets));

// ── E. Problem state machine (redesigned BD-RIDE-D-08) + safety + copy ──
for (const stage of ['type_selected', 'validation_error']) {
  expect(`problem sheet knows the '${stage}' stage`,
    new RegExp(`'${stage}'`).test(sheets));
}
expect('problem sheet uses the redesign title / eyebrow / subtitle',
  sheets.includes('Проблема в поездке') && sheets.includes('Активная поездка')
  && sheets.includes('Выберите, что произошло. Это пока демо-режим: поездка не изменится.'));
expect('problem sheet drives a safety visual state via data-safety',
  /dataset\.safety\s*=/.test(sheets) && sheets.includes('driver-problem-sheet__safety-note'));
expect('problem sheet shows the status-neutral helper note',
  sheets.includes('Сообщение останется внутри текущей сессии и не изменит статус поездки.'));
expect('empty submit flags validation_error + shows "Выберите причину обращения"',
  /dataset\.stage\s*=\s*'validation_error'/.test(sheets) && sheets.includes('Выберите причину обращения'));
expect('submit surfaces the demo toast via onAction + dismisses the sheet',
  sheets.includes('Обращение сохранено в демо-режиме')
  && /onAction\(DRIVER_PROBLEM_TOAST\)/.test(sheets)
  && /overlay\.__closeSheet/.test(sheets));
expect('problem sheet drops the loading/sent stages + in-sheet done card',
  !/dataset\.stage\s*=\s*'sent'/.test(sheets)
  && !sheets.includes('driver-problem-sheet__done')
  && !sheets.includes('Сигнал отправлен'));

// ── E2. Driver safety sheet (BD-RIDE-D-SAFETY-01) ──
expect('module exports openDriverSafetySheet + renderDriverSafetySheet',
  /export\s+function\s+openDriverSafetySheet\s*\(/.test(sheets)
  && /export\s+function\s+renderDriverSafetySheet\s*\(/.test(sheets));
expect("bindDriverSheetEvents registers kind === 'safety'",
  /kind === 'safety'\)\s*bindSafetyEvents/.test(sheets));
expect('#ar-shield opens the safety sheet (no longer the showNotice stub)',
  /#ar-shield'\)[\s\S]{0,200}openDriverSafetySheet\s*\(/.test(screen)
  && !screen.includes('Безопасность будет добавлена позже'));
expect('#ar-shield passes onAction: showNotice (toast-only)',
  /#ar-shield'\)[\s\S]{0,200}openDriverSafetySheet\(\s*root\s*,\s*\{[\s\S]{0,80}onAction:\s*showNotice/.test(screen));
expect('safety sheet has exactly the 3 actions (share / emergency / support)',
  /\['share'[\s\S]{0,80}'Поделиться поездкой'/.test(sheets)
  && /\['emergency'[\s\S]{0,90}'Экстренная помощь · 112'[\s\S]{0,60},\s*true\s*\]/.test(sheets)
  && /\['support'[\s\S]{0,90}'Связаться с поддержкой'/.test(sheets));
expect('safety sheet title / eyebrow / subtitle use the spec copy',
  sheets.includes('Безопасность') && sheets.includes('Активная поездка')
  && sheets.includes('Быстрые действия на случай проблемы. Это демо-режим.'));
expect('emergency view: 112 demo confirm + disclaimer + 112-call button',
  /dataset\.stage\s*=\s*'emergency'/.test(sheets)
  && sheets.includes('Это демо-режим, реальный вызов не выполняется.')
  && sheets.includes('Позвонить 112 (демо)')
  && /driver-safety-call/.test(sheets));
expect('every safety action is a demo session toast (onAction) + dismiss',
  sheets.includes('Ссылка на поездку скопирована (демо)')
  && sheets.includes('Демо: экстренный вызов не выполняется')
  && /options\.onAction\(/.test(sheets));
// Boundary: distinct from the problem sheet, the passenger sheet, and reality.
expect('safety sheet does NOT host the problem-report radio rows (stays distinct from #ar-issue)',
  !/driver-problem-sheet__action/.test(
    (sheets.match(/function renderDriverSafetySheet\(\)[\s\S]*?return sheetShell\('safety'[^;]*;/) || [''])[0]));
expect('safety sheet never reuses the passenger sheet + no real telephony/share/backend',
  !/passenger-safety/.test(sheets) && !/\btel:/.test(sheets)
  && !/navigator\.share/.test(sheets) && !/fetch\s*\(/.test(sheets));

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

// ── H. Problem reason selection (redesigned BD-RIDE-D-08) ──
// The redesign has no in-flight (loading/sent) stage — submit emits one demo
// toast and dismisses — so the old "freeze while sending" guard no longer
// applies. Pin the selection behaviour instead: choosing a reason sets
// aria-checked, updates the stage (clearing any validation error), and toggles
// the data-safety visual.
const problemTypeHandler = sheets.match(
  /typeBtns\.forEach\(\(btn\) => btn\.addEventListener\('click', \(\) => \{([\s\S]*?)\}\)\);/);
expect('problem-type click handler is resolved', !!problemTypeHandler);
expect('selecting a reason sets aria-checked + updates the stage',
  !!problemTypeHandler
  && /setAttribute\('aria-checked'/.test(problemTypeHandler[1])
  && /dataset\.stage\s*=\s*selectedType \? 'type_selected' : 'default'/.test(problemTypeHandler[1]));
expect('selecting a reason toggles the data-safety visual',
  !!problemTypeHandler && /dataset\.safety\s*=/.test(problemTypeHandler[1]));

// ── J. Terminal renderers never expose cancel / problem triggers (BD-RIDE-D-SHEETS-02) ──
// renderCanceledStub() handles both CANCELED and NO_SHOW, and renderCompleted()
// mounts only the earnings sheet — neither must re-expose the cancel/no-show/
// problem entry points, otherwise a finished or closed ride could reopen the
// cancel sheet and trip a second persistDriverCancel() call.
const dispatchBody = functionBody(screen, 'renderSheet') || '';
expect('renderSheet() body resolved', dispatchBody.length > 0);
// Exact branch assertions — keep the regex inside the SAME `else if (...)`
// condition (no `)` until the branch closing paren) before requiring
// renderCanceledStub() as that branch's action. This prevents a passing
// signal when CANCELED / NO_SHOW lives in an unrelated branch and
// renderCanceledStub() just happens to appear nearby in the source.
expect('CANCELED branch routes to renderCanceledStub() (exact branch)',
  /ride\.status\s*===\s*RIDE_STATUS\.CANCELED[^)]*\)\s*renderCanceledStub\(\)/.test(dispatchBody));
expect('NO_SHOW branch routes to renderCanceledStub() (exact branch)',
  /ride\.status\s*===\s*RIDE_STATUS\.NO_SHOW[^)]*\)\s*renderCanceledStub\(\)/.test(dispatchBody));
const canceledStub = functionBody(screen, 'renderCanceledStub') || '';
expect('renderCanceledStub() body resolved', canceledStub.length > 0);
expect('terminal stub never mounts the cancel button (#ar-cancel*)',
  !/['"]#?ar-cancel(?:-accepted)?['"]/.test(canceledStub)
  && !/\bar-cancel(?:-accepted)?\b/.test(canceledStub.replace(/ar-cancel-route\b/g, '')));
expect('terminal stub never mounts the no-show button (#ar-no-show)',
  !/ar-no-show\b/.test(canceledStub));
expect('terminal stub never mounts the problem button (#ar-issue)',
  !/ar-issue\b/.test(canceledStub));
expect('terminal stub never reopens openDriverCancelSheet',
  !/openDriverCancelSheet\s*\(/.test(canceledStub));
expect('terminal stub never reopens openDriverProblemSheet',
  !/openDriverProblemSheet\s*\(/.test(canceledStub));
const completedRenderer = functionBody(screen, 'renderCompleted') || '';
expect('renderCompleted() body resolved', completedRenderer.length > 0);
expect('completed renderer never mounts the cancel button',
  !/ar-cancel(?:-accepted)?\b/.test(completedRenderer));
expect('completed renderer never mounts the no-show / problem buttons',
  !/ar-no-show\b/.test(completedRenderer) && !/ar-issue\b/.test(completedRenderer));
expect('completed renderer never reopens the cancel/problem sheets',
  !/openDriverCancelSheet\s*\(/.test(completedRenderer)
  && !/openDriverProblemSheet\s*\(/.test(completedRenderer));

// renderCompleted() delegates to openDriverEarningsSheet() (defined in the
// sheets module, which itself calls renderDriverEarningsSheet for markup).
// Both must be free of any cancel / no-show / problem entry point and must
// never persist CANCELED / NO_SHOW from the completed terminal — a refactor
// that mounted a "report problem" or "cancel ride" CTA into the earnings
// terminal would otherwise pass section J unnoticed.
const earningsSheetOpener = functionBody(sheets, 'openDriverEarningsSheet') || '';
expect('openDriverEarningsSheet() body resolved', earningsSheetOpener.length > 0);
const earningsSheetRenderer = functionBody(sheets, 'renderDriverEarningsSheet') || '';
expect('renderDriverEarningsSheet() body resolved', earningsSheetRenderer.length > 0);
const earningsTerminal = earningsSheetOpener + '\n' + earningsSheetRenderer;
for (const token of ['ar-cancel-accepted', 'ar-cancel', 'ar-no-show', 'ar-issue']) {
  expect(`earnings terminal never mounts #${token}`,
    !new RegExp(`\\b${token.replace(/-/g, '\\-')}\\b`).test(earningsTerminal));
}
expect('earnings terminal never reopens openDriverCancelSheet',
  !/openDriverCancelSheet\s*\(/.test(earningsTerminal));
expect('earnings terminal never reopens openDriverProblemSheet',
  !/openDriverProblemSheet\s*\(/.test(earningsTerminal));
expect('earnings terminal never persists CANCELED / NO_SHOW from the completed sheet',
  !/persistDriver(?:RideStatus|Cancel)\s*\([^)]*RIDE_STATUS\.(?:CANCELED|NO_SHOW)/.test(earningsTerminal));

// ── K. Per-stage cancel / problem affordance reach (BD-RIDE-D-SHEETS-02) ──
// Cancel sheet is reachable from ACCEPTED, DRIVER_EN_ROUTE, DRIVER_APPROACHING_PICKUP
// and WAITING_PASSENGER (no-show preset). Problem sheet is reachable from
// IN_PROGRESS only — and goes through `onAction: showNotice` so the issue
// path stays a UI-only toast that never persists ride state.
const accepted = functionBody(screen, 'renderAccepted') || '';
expect('renderAccepted() body resolved', accepted.length > 0);
expect('ACCEPTED stage opens the cancel sheet via #ar-cancel-accepted',
  /ar-cancel-accepted['"]\)[\s\S]{0,300}openDriverCancelSheet\s*\(/.test(accepted));
const enRoute = functionBody(screen, 'renderEnRoute') || '';
expect('renderEnRoute() body resolved', enRoute.length > 0);
expect('DRIVER_EN_ROUTE stage opens the cancel sheet via #ar-cancel',
  /ar-cancel['"]\)[\s\S]{0,300}openDriverCancelSheet\s*\(/.test(enRoute));
const approaching = functionBody(screen, 'renderApproaching') || '';
expect('renderApproaching() body resolved', approaching.length > 0);
expect('DRIVER_APPROACHING_PICKUP stage opens the cancel sheet via #ar-cancel',
  /ar-cancel['"]\)[\s\S]{0,300}openDriverCancelSheet\s*\(/.test(approaching));
const waiting = functionBody(screen, 'renderWaiting') || '';
expect('renderWaiting() body resolved', waiting.length > 0);
// BD-RIDE-D-NOSHOW-01 — #ar-no-show now opens the dedicated no-show sub-flow
// (active_ride_driver_noshow.js), replacing the cancel-sheet passenger_no_show
// preset. The NO_SHOW persist pin below still holds (fired via onConfirmNoShow).
expect('WAITING_PASSENGER #ar-no-show opens the no-show flow (openDriverNoShowFlow)',
  /ar-no-show['"]\)[\s\S]{0,400}openDriverNoShowFlow\s*\(\s*sheet/.test(waiting));
expect('WAITING_PASSENGER no-show persists RIDE_STATUS.NO_SHOW',
  /ar-no-show[\s\S]{0,800}RIDE_STATUS\.NO_SHOW/.test(waiting));
const inProgress = functionBody(screen, 'renderInProgress') || '';
expect('renderInProgress() body resolved', inProgress.length > 0);
expect('IN_PROGRESS stage opens the problem sheet via #ar-issue',
  /ar-issue['"]\)[\s\S]{0,300}openDriverProblemSheet\s*\(/.test(inProgress));
// Scope every #ar-issue assertion to the click handler body extracted via
// parens balance — semicolons inside the handler (e.g. a future `{ a; b; }`
// block form) don't truncate the capture the way a `[^;]+;` regex would,
// and the `#ar-finish` persistDriverRideStatus call above the issue
// listener can't bleed into the check.
const issueHandler = clickHandlerBody(inProgress, 'ar-issue');
expect('IN_PROGRESS #ar-issue click handler body resolved', !!issueHandler);
expect('IN_PROGRESS #ar-issue handler calls openDriverProblemSheet(...)',
  !!issueHandler && /openDriverProblemSheet\s*\(/.test(issueHandler));
expect('IN_PROGRESS #ar-issue handler passes onAction: showNotice (toast-only)',
  !!issueHandler && /onAction:\s*showNotice\b/.test(issueHandler));
expect('IN_PROGRESS #ar-issue handler never persists ride state',
  !!issueHandler && !/persistDriver(?:RideStatus|Cancel)\b/.test(issueHandler));
expect('IN_PROGRESS #ar-issue handler never passes onConfirm',
  !!issueHandler && !/\bonConfirm\b/.test(issueHandler));

// ── I. Service worker precaches the driver sheets module ──
// active_ride.js statically imports active_ride_driver_sheets.js; if the SW
// PRECACHE omits it, an offline PWA session serves index.html for the module
// request and the driver active-ride screen fails to boot.
const sw = read('../public/sw.js');
const precache = (sw.match(/PRECACHE\s*=\s*\[([\s\S]*?)\]/) || [])[1] || '';
expect('public/sw.js PRECACHE includes active_ride_driver_sheets.js',
  /active_ride_driver_sheets\.js/.test(precache));

// ── L. BD-RIDE-D-09 polish — earnings terminal payment alias + history exit ──
// The driver COMPLETED dispatch reads either ?state= (the internal entry
// stage) or ?payment=cash|noncash (the documented manual URL). Both routes
// must land on the same cash/noncash variant, and the secondary nav row
// must expose the "В историю поездок" exit to /profile so the driver
// terminal mirrors the passenger handoff from BD-RIDE-P-08.
expect('dispatcher reads the ?payment= query alongside ?state=',
  /query\.get\('payment'\)/.test(screen));
expect('dispatcher maps payment=cash to the cash entry stage',
  /paymentQuery\s*===\s*'cash'[\s\S]{0,80}paymentQuery/.test(screen)
  || /paymentQuery\s*===\s*'cash'\s*\|\|\s*paymentQuery\s*===\s*'noncash'\s*\?\s*paymentQuery/.test(screen));
expect('dispatcher only maps cash / noncash (other payment values are ignored)',
  !/paymentQuery\s*===\s*'(auto|paid|pending)'/.test(screen));
expect('renderCompleted wires onHistory into the earnings sheet via /profile?section=history',
  /onHistory:\s*\(\s*\)\s*=>\s*go\('\/profile\?section=history'\)/.test(completedRenderer));

// Profile screen recognises the deep-link and scrolls the history section
// into view. The driver overview tab and the passenger main view both
// render the same #profile-history-section anchor, so no per-role branch
// is needed.
const profile = read('../public/src/screens/profile.js');
expect('profile.js reads ?section= off the hash query',
  /q\.get\(\s*'section'\s*\)/.test(profile));
expect('profile.js handles section=history',
  /sectionParam\s*===\s*'history'/.test(profile));
expect('profile.js scrolls #profile-history-section into view for section=history',
  /sectionParam\s*===\s*'history'[\s\S]{0,800}#profile-history-section[\s\S]{0,400}scrollIntoView\s*\(/.test(profile));
expect('profile.js still renders the history anchor in both views',
  (profile.match(/id="profile-history-section"/g) || []).length >= 1);

// Earnings sheet shows the "В историю поездок" button id wired by the
// sheets module's bind helper, and the click handler hits onHistory /
// /profile (the safe fallback when no callback is wired). The button HTML
// is composed inside earningsSecondaryHtml() — a separate helper called
// from renderDriverEarningsSheet — so scope these checks to the whole
// sheets module (the renderer body itself only contains the loading /
// closed / empty templates around an `${earnBlock}` placeholder).
const earningsSecondaryBody = functionBody(sheets, 'earningsSecondaryHtml') || '';
expect('earningsSecondaryHtml() body resolved', earningsSecondaryBody.length > 0);
expect('earnings secondary row includes #driver-earnings-history',
  /id="driver-earnings-history"/.test(earningsSecondaryBody));
expect('earnings secondary row labels the new button "В историю поездок"',
  earningsSecondaryBody.includes('В историю поездок'));
const bindEarningsBody = functionBody(sheets, 'bindEarningsEvents') || '';
expect('bindEarningsEvents() body resolved', bindEarningsBody.length > 0);
const historyHandler = clickHandlerBody(bindEarningsBody, 'driver-earnings-history');
expect('#driver-earnings-history click handler resolved', !!historyHandler);
expect('history handler calls options.onHistory or falls back to /profile?section=history',
  !!historyHandler
  && /options\.onHistory/.test(historyHandler)
  && /go\('\/profile\?section=history'\)/.test(historyHandler));
expect('history handler never persists ride state',
  !!historyHandler && !/persistDriver(?:RideStatus|Cancel)\b/.test(historyHandler));

// Cash / noncash variants stay fully wired in the sheets module (badge
// helper, cash gate in bindEarningsEvents, balance preview helper). Empty
// fallback stays calm. These templates live in helper functions, not in
// renderDriverEarningsSheet itself — scope each check to the helper or
// the module.
const earningsBadgeBody = functionBody(sheets, 'earningsBadgeHtml') || '';
expect('earningsBadgeHtml() body resolved', earningsBadgeBody.length > 0);
expect('earnings sheet exposes the cash badge',
  /de-pay-badge cash/.test(earningsBadgeBody) && earningsBadgeBody.includes('Оплата наличными'));
expect('earnings sheet exposes the noncash badge',
  /de-pay-badge noncash/.test(earningsBadgeBody) && earningsBadgeBody.includes('Безналичный расчёт'));
expect('cash variant gates the primary close button with the confirm row',
  /id="driver-earnings-confirm"/.test(sheets)
  && /primary\.disabled\s*=\s*!cashConfirmed/.test(bindEarningsBody));
expect('noncash variant renders the demo balance preview',
  /earningsBalanceHtml\(/.test(sheets)
  && /de-balance__value/.test(sheets));
expect('earnings sheet keeps a calm empty fallback for missing payload',
  /de-empty__title/.test(sheets) && /Нет данных о доходе/.test(sheets));
const resolveStateBody = functionBody(sheets, 'resolveEarningsState') || '';
expect('resolveEarningsState resolves to empty when the payload is missing',
  /normalizeEarningsPayload\(\s*payload\s*\)\)\s*return\s*'empty'/.test(resolveStateBody));
expect('earnings sheet keeps a calm closed state for the optimistic finish',
  /de-closed__title/.test(sheets) && /Вы снова на линии/.test(sheets));

// Lifecycle isolation: the earnings sheet must never persist a terminal
// status from a confirm/close handler. CANCELED / NO_SHOW transitions
// stay owned by the cancel sheet via the screen's persistDriverCancel().
expect('earnings sheet module never persists CANCELED / NO_SHOW',
  !/RIDE_STATUS\.(?:CANCELED|NO_SHOW)/.test(sheets)
  && !/persistDriver/.test(sheets));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
