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
// BD-RIDE-P-06 polish — canonical 5 reasons from the fresh Cloud Design
// audit. The old "Ошибка в адресе" / "Нашёл другой способ" pair was
// replaced by "Ошибка в маршруте" / "Не могу выйти" — drop the old IDs
// and verify the new ones (label + id).
for (const id of ['driver_far', 'changed_mind', 'route_error', 'cannot_leave', 'other']) {
  expect(`CANCEL_REASONS includes id '${id}'`,
    new RegExp(`id:\\s*'${id}'`).test(cancelReasons || ''));
}
for (const id of ['address_error', 'other_way']) {
  expect(`CANCEL_REASONS drops legacy id '${id}'`,
    !new RegExp(`id:\\s*'${id}'`).test(cancelReasons || ''));
}
for (const label of ['Водитель далеко', 'Передумал', 'Ошибка в маршруте', 'Не могу выйти', 'Другая причина']) {
  expect(`CANCEL_REASONS exposes canonical label "${label}"`,
    (cancelReasons || '').includes(label));
}
for (const oldLabel of ['Ошибка в адресе', 'Нашёл другой способ']) {
  expect(`CANCEL_REASONS drops legacy label "${oldLabel}"`,
    !(cancelReasons || '').includes(oldLabel));
}
// BD-RIDE-P-06 polish — new state machine: default → reason_selected
// → validation_error → confirm → loading → canceled. The first red tap
// after a reason lands in confirm, NOT loading; only "Да, отменить
// поездку" commits.
for (const stage of ['default', 'reason_selected', 'validation_error', 'confirm', 'loading', 'canceled']) {
  expect(`cancel sheet knows the '${stage}' stage`,
    new RegExp(`'${stage}'`).test(sheets));
}
expect('cancel sheet actually transitions into loading then the canceled state',
  /dataset\.stage\s*=\s*'loading'/.test(sheets) && /dataset\.stage\s*=\s*'canceled'/.test(sheets));
expect('cancel sheet transitions into the confirm stage before loading',
  /dataset\.stage\s*=\s*'confirm'/.test(sheets));
expect('cancel sheet shows the "водитель в пути" rating warning',
  sheets.includes('Отмена может повлиять на рейтинг'));
expect('cancel sheet shows the validation copy',
  sheets.includes('Выберите причину отмены, чтобы продолжить'));
expect('cancel sheet shows the loading copy "Отменяем…"',
  sheets.includes('Отменяем…'));
expect('cancel sheet shows the canceled-state title "Поездка отменена"',
  sheets.includes('Поездка отменена'));
// Confirm gate copy + buttons.
expect('cancel confirm gate shows "Точно отменить?" title',
  sheets.includes('Точно отменить?'));
expect('cancel confirm gate shows "Водитель уже в пути" subcopy',
  sheets.includes('Водитель уже в пути. Частые отмены могут влиять на рейтинг.'));
// BD-RIDE-P-06 stage-honest copy — the sheet copy is status-dependent:
// WAITING_PASSENGER (driver arrived) must say the driver is already here,
// never «уже в пути», and the «ещё далеко» free-cancel note is en-route-only.
expect('cancel sheet has the WAITING_PASSENGER arrived-stage warning',
  sheets.includes('Водитель уже на месте и ждёт вас. Отмена может повлиять на рейтинг.'));
expect('cancel confirm gate has the WAITING_PASSENGER arrived-stage subcopy',
  sheets.includes('Водитель уже на месте и ждёт вас. Частые отмены могут влиять на рейтинг.'));
expect('«ещё далеко» free-cancel note is suppressed once the driver is waiting',
  /isDriverWaiting\s*\?\s*''/.test(sheets)
  && sheets.includes('Если водитель ещё далеко, отмена бесплатна и не влияет на рейтинг.'));
expect('cancel confirm gate shows "Не отменять" button',
  sheets.includes('Не отменять'));
expect('cancel confirm gate shows "Да, отменить поездку" button',
  sheets.includes('Да, отменить поездку'));
// First red tap (#arp-cancel-confirm) advances to 'confirm', not 'loading'.
expect('first confirm tap routes to the confirm stage, never to loading',
  /confirmBtn\.addEventListener[\s\S]*?dataset\.stage\s*=\s*'confirm'/.test(sheets));
// Only the inner "Да, отменить поездку" commits — the commit must happen
// inside the yes-button click handler, not the outer red button. The
// outer confirmBtn handler scope ends at the next `});` after its
// addEventListener — assert no commitCancel() appears in that window.
expect('the inner #arp-cancel-confirm-yes button commits the cancel',
  /confirmYesBtn[\s\S]{0,400}commitCancel\(/.test(sheets));
const outerConfirmMatch = sheets.match(/confirmBtn\.addEventListener\(\s*'click'\s*,\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\n\s*\}\s*\)\s*;/);
expect('outer red "Отменить поездку" button does NOT commit cancel directly',
  outerConfirmMatch && !/commitCancel\s*\(/.test(outerConfirmMatch[1] || ''),
  outerConfirmMatch ? 'matched outer handler' : 'outer handler not located');
expect('outer red "Отменить поездку" button only routes to the confirm stage',
  outerConfirmMatch && /dataset\.stage\s*=\s*'confirm'/.test(outerConfirmMatch[1] || ''));
// Loading must lock the close-X (it cannot fire close() while loading).
expect('cancel close-X is locked while loading',
  /closeBtn[\s\S]{0,200}isDismissalLocked\(\)/.test(sheets)
  || /isDismissalLocked\(\)[\s\S]{0,200}close\(\)/.test(sheets));
expect('cancel loading also disables the close button',
  /closeBtn\.disabled\s*=\s*true/.test(sheets));
// Canceled terminal CTA — fresh Cloud Design copy: "Вернуться на главную".
expect('cancel sheet canceled terminal shows "Вернуться на главную"',
  sheets.includes('Вернуться на главную'));

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
// BD-RIDE-P-07 polish — reordered action group + top-level support row
// adds a 6th entry ('support') with the 8 800 subcopy. The order is
// chat → call → share → support → report → sos and must be exact:
// support's "top-level" promotion is only meaningful with the other 5
// in their new positions around it.
expect('SAFETY_ACTIONS has exactly 6 actions', safetyActionCount === 6, 'count=' + safetyActionCount);
for (const id of ['chat', 'call', 'share', 'support', 'report', 'sos']) {
  expect(`SAFETY_ACTIONS includes action '${id}'`,
    new RegExp(`id:\\s*'${id}'`).test(safetyActions || ''));
}
const safetyIdOrder = (safetyActions || '').match(/id:\s*'([a-z_]+)'/g) || [];
const safetyIds = safetyIdOrder.map((s) => s.replace(/.*'([a-z_]+)'.*/, '$1'));
expect('SAFETY_ACTIONS order is chat → call → share → support → report → sos',
  JSON.stringify(safetyIds) === JSON.stringify(['chat', 'call', 'share', 'support', 'report', 'sos']),
  'got=' + JSON.stringify(safetyIds));
// Top-level support row — title + 8 800 subcopy + UI-заглушка marker.
expect('SAFETY_ACTIONS support row carries "Связаться с поддержкой" label',
  /id:\s*'support'[\s\S]*?label:\s*'Связаться с поддержкой'/.test(safetyActions || ''));
expect('SAFETY_ACTIONS support row carries the 8 800 subcopy',
  /id:\s*'support'[\s\S]*?subcopy:\s*'8 800 · круглосуточно · UI-заглушка'/.test(safetyActions || ''));
expect('SAFETY_ACTIONS support row is flagged top-level',
  /id:\s*'support'[\s\S]*?topLevel:\s*true/.test(safetyActions || ''));
expect('safety sheet has top-level «Связаться с поддержкой»',
  (safetyActions || '').includes('Связаться с поддержкой')
  && sheets.includes('Связаться с поддержкой'));
// Labels for the reordered five must read in the canonical fresh-design
// copy (not the legacy short labels).
for (const label of [
  'Написать водителю',
  'Позвонить водителю',
  'Поделиться поездкой',
  'Сообщить о проблеме',
  'Экстренная помощь',
]) {
  expect(`SAFETY_ACTIONS exposes label "${label}"`,
    (safetyActions || '').includes(label));
}
// Legacy short labels must be retired.
for (const oldLabel of ['Написать в чат', 'Пожаловаться']) {
  expect(`SAFETY_ACTIONS drops legacy label "${oldLabel}"`,
    !(safetyActions || '').includes(oldLabel));
}
// "SOS" as a bare row label is the legacy copy — the new entry is
// "Экстренная помощь". The string "SOS" still appears inside the
// emergency view (tile + a11y labels), so scope the check to the
// SAFETY_ACTIONS literal only.
expect('SAFETY_ACTIONS does not expose the legacy bare "SOS" row label',
  !/label:\s*'SOS'/.test(safetyActions || ''));
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

// ── E2. Cancel affordance gating (BD-RIDE-P-06 polish) ────────────
// Cancel button must be REACHABLE on WAITING_PASSENGER (new) and the
// en-route family (ACCEPTED / DRIVER_EN_ROUTE / DRIVER_APPROACHING_PICKUP)
// — and ABSENT from the terminal states (COMPLETED / CANCELED / NO_SHOW).
// The bind goes through a shared helper so both renderers stay wired up.
expect('passenger screen has a shared bindCancelAffordance helper',
  /function\s+bindCancelAffordance\s*\(/.test(passenger));
expect('bindCancelAffordance opens the cancel sheet via openPassengerCancelSheet',
  /function\s+bindCancelAffordance[\s\S]{0,1200}openPassengerCancelSheet\s*\(/.test(passenger));
const waitingBody = functionBody(passenger, 'renderWaitingSheet') || '';
expect('renderWaitingSheet body resolved', waitingBody.length > 0);
expect('WAITING_PASSENGER sheet exposes the cancel button (#arp-cancel)',
  waitingBody.includes('arp-cancel'));
const enRouteBody = functionBody(passenger, 'renderEnRouteSheet') || '';
expect('renderEnRouteSheet body resolved', enRouteBody.length > 0);
expect('en-route sheet exposes the cancel button (#arp-cancel)',
  enRouteBody.includes('arp-cancel'));
const renderSheetBody = functionBody(passenger, 'renderSheet') || '';
expect('renderSheet WAITING_PASSENGER branch binds the cancel affordance',
  /WAITING_PASSENGER[\s\S]{0,600}bindCancelAffordance\(\)/.test(renderSheetBody));
expect('renderSheet en-route branch binds the cancel affordance',
  /renderEnRouteSheet\([\s\S]{0,200}bindCancelAffordance\(\)/.test(renderSheetBody));
// Terminal renderers must NOT mount the cancel button.
const canceledFallbackBody = functionBody(passenger, 'renderPassengerCanceledFallback') || '';
expect('renderPassengerCanceledFallback body resolved', canceledFallbackBody.length > 0);
expect('CANCELED / NO_SHOW fallback never mounts #arp-cancel',
  !/arp-cancel\b/.test(canceledFallbackBody));
const completeBody = functionBody(passenger, 'renderPassengerRideComplete') || '';
expect('renderPassengerRideComplete body resolved', completeBody.length > 0);
expect('COMPLETED screen does not expose the active-ride cancel button',
  !/['"]#?arp-cancel['"]/.test(completeBody)
  && !/\barp-cancel\b/.test(completeBody.replace(/arp-cancel-[a-z-]+/g, '')));
// In-progress renderers don't get a cancel either — keep them off.
const inProgressBody = functionBody(passenger, 'renderInProgressSheet') || '';
expect('renderInProgressSheet body resolved', inProgressBody.length > 0);
expect('IN_PROGRESS sheet does not expose the cancel button',
  !/['"]#?arp-cancel['"]/.test(inProgressBody)
  && !/\barp-cancel\b/.test(inProgressBody.replace(/arp-cancel-[a-z-]+/g, '')));

// ── E3. NO_SHOW terminal — fresh Cloud Design copy ────────────────
// Badge: NO_SHOW (literal tech label, "neutral copy"), title:
// "Поездка закрыта", body: "Водитель отметил, что не дождался вас.",
// single CTA: "Вернуться на главную".
expect('NO_SHOW terminal badge uses the canonical label (resolveRideStatusLabel)',
  /isNoShow\s*\?\s*resolveRideStatusLabel\(RIDE_STATUS\.NO_SHOW\)/.test(canceledFallbackBody));
expect('NO_SHOW terminal title reads "Поездка закрыта"',
  /isNoShow\s*\?\s*'Поездка закрыта'/.test(canceledFallbackBody));
expect('NO_SHOW terminal body reads "Водитель отметил, что не дождался вас."',
  canceledFallbackBody.includes('Водитель отметил, что не дождался вас.'));
expect('NO_SHOW terminal CTA reads "Вернуться на главную"',
  canceledFallbackBody.includes('Вернуться на главную'));
expect('NO_SHOW terminal drops the "Создать новую поездку" primary CTA',
  /isNoShow\s*\n?\s*\?\s*''\s*\n?\s*:/.test(canceledFallbackBody));
// CANCELED terminal keeps the dual CTA but the secondary now reads
// "Вернуться на главную" (not "Вернуться в ленту").
expect('CANCELED terminal exposes "Вернуться на главную" CTA',
  canceledFallbackBody.includes('Вернуться на главную'));
expect('CANCELED terminal drops legacy "Вернуться в ленту" CTA from the fallback',
  !canceledFallbackBody.includes('Вернуться в ленту'));

// ── E4. Safety sheet must not mutate ride status ────────────────
// Open / close / every action handler in the sheets module is a UI-only
// affordance. Persistence (CANCELED, IN_PROGRESS, COMPLETED) is owned by
// the passenger screen; the sheets module must never touch the ride
// state store directly.
expect('safety/cancel sheets module does not import the ride state store',
  !/from\s+['"]\.\.\/ride_state\.js['"]/.test(sheets));
expect('safety/cancel sheets module does not call updateActiveRideStatus',
  !/updateActiveRideStatus\s*\(/.test(sheets));
expect('safety/cancel sheets module does not call saveActiveRide',
  !/saveActiveRide\s*\(/.test(sheets));
expect('safety/cancel sheets module does not call updateTripStatus',
  !/updateTripStatus\s*\(/.test(sheets));
// "Safety must not mutate ride status" — pin no fetch / Mapbox / notify /
// tel: dialer leak from the sheets module.
expect('sheets module does not call fetch / XHR',
  !/\bfetch\s*\(/.test(sheets) && !/XMLHttpRequest/.test(sheets));
expect('sheets module does not pull in Mapbox',
  !/mapbox/i.test(sheets));
expect('sheets module does not use the Notification API',
  !/new\s+Notification\s*\(/.test(sheets));
expect('sheets module does not dial tel: links',
  !/href\s*=\s*["']tel:/.test(sheets) && !/window\.location[\s\S]{0,40}tel:/.test(sheets));
// Driver files must stay untouched (the sheets module talks only to the
// passenger screen + util + router).
expect('sheets module does not import any driver-side module',
  !/from\s+['"][^'"]*driver[^'"]*['"]/i.test(sheets.replace(/loadDriverHandoffSnapshot|applyDriverHandoffSnapshotToRide/g, '')));

// ── E5. COMPLETED payment terminal (BD-RIDE-P-08 polish) ──────────
// ?payment= drives a presentation-only axis on the COMPLETED screen:
// auto | pending | paid, with anything else collapsing to the safe
// 'auto' default instead of throwing or leaking an unknown value into
// the data-payment attribute.
const payStatesMatch = passenger.match(/PAYMENT_STATES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
expect('PAYMENT_STATES set resolved', !!payStatesMatch);
const payStates = payStatesMatch
  ? (payStatesMatch[1].match(/'(\w+)'/g) || []).map((t) => t.replace(/'/g, ''))
  : [];
expect('PAYMENT_STATES equals exactly {auto, pending, paid}',
  JSON.stringify([...payStates].sort()) === JSON.stringify(['auto', 'paid', 'pending']),
  'got=' + JSON.stringify(payStates));
const normalizePaymentBody = functionBody(passenger, 'normalizePayment') || '';
expect('normalizePayment body resolved', normalizePaymentBody.length > 0);
expect('normalizePayment guards non-string input with the auto default',
  /typeof\s+value\s*!==\s*'string'\s*\)\s*return\s*'auto'/.test(normalizePaymentBody));
expect('normalizePayment collapses unknown values to the auto default',
  /PAYMENT_STATES\.has\(\s*v\s*\)\s*\?\s*v\s*:\s*'auto'/.test(normalizePaymentBody));
expect('normalizePayment trims + lowercases before matching',
  /\.trim\(\)\.toLowerCase\(\)/.test(normalizePaymentBody));
// Query → renderer wiring: /active-ride reads ?payment=, the passenger
// dispatch forwards it as paymentStatus, and the COMPLETED renderer
// normalizes it into the data-payment presentation axis.
expect('active_ride.js dispatcher forwards ?payment= as paymentQuery',
  /paymentQuery:\s*query\.get\('payment'\)/.test(dispatcher));
expect('activeRidePassenger forwards paymentQuery into renderPassengerRideComplete',
  /renderPassengerRideComplete\(\s*ride\s*,\s*\{[\s\S]{0,200}paymentStatus:\s*paymentQuery/.test(dispatchBody));
expect('COMPLETED renderer normalizes the payment query',
  /initialPayment\s*=\s*normalizePayment\(\s*paymentStatus\s*\)/.test(completeBody));
expect('COMPLETED renderer writes data-payment from the normalized value',
  /dataset\.payment\s*=\s*initialPayment/.test(completeBody));

// Terminal copy + per-variant payment presentation. All three variants
// live in the same markup and CSS toggles them via data-pay-show, so a
// static check that each variant's copy is present is equivalent to
// "payment=auto/pending/paid render".
expect('COMPLETED hero title reads "Поездка завершена"',
  completeBody.includes('Поездка завершена'));
expect('COMPLETED fare total comes from the mock payment info (pay.total)',
  /completedPaymentInfo\(\s*ride\s*\)/.test(completeBody)
  && /\$\{escapeHtml\(pay\.total\)\}/.test(completeBody));
expect('auto variant shows the Авто-оплата badge',
  completeBody.includes('data-pay-show="auto"') && completeBody.includes('Авто-оплата'));
expect('pending variant shows the in-flight charge badge',
  completeBody.includes('data-pay-show="pending"') && /Списание/.test(completeBody));
expect('pending variant carries the confirmation soft warning',
  /passenger-complete__pay-warning"\s+data-pay-show="pending"/.test(completeBody)
  && completeBody.includes('Ожидается подтверждение оплаты'));
expect('paid variant shows the Оплачено badge',
  completeBody.includes('data-pay-show="paid"') && completeBody.includes('Оплачено'));

// Receipt CTA — "Посмотреть чек" is UI-only (no passenger receipt
// screen exists; /receipt is the DRIVER financial document). Paid gets
// the live stub button, auto/pending get a disabled mock + note.
expect('paid variant exposes the "Посмотреть чек" CTA (#arp-receipt-view)',
  /id="arp-receipt-view"\s+data-action="view-receipt"/.test(completeBody)
  && completeBody.includes('Посмотреть чек'));
expect('auto/pending variants show a disabled "Посмотреть чек" mock',
  /data-action="view-receipt"\s+disabled/.test(completeBody)
  && completeBody.includes('Чек будет доступен после оплаты'));
expect('receipt CTA stays a toast stub (no navigation, no fetch)',
  !/receiptViewBtn[\s\S]{0,300}navigate\(/.test(completeBody)
  && !/receiptViewBtn[\s\S]{0,300}fetch\(/.test(completeBody));
expect('legacy "Скачать" receipt button is gone',
  !/arp-receipt-download/.test(passenger) && !completeBody.includes('Скачать чек'));

// Handoff CTAs are existing-route navigations only.
expect('COMPLETED exposes the "В историю поездок" CTA',
  completeBody.includes('В историю поездок') && completeBody.includes('arp-to-history'));
expect('"В историю поездок" navigates to the existing /profile route',
  /arp-to-history[\s\S]{0,400}navigate\('\/profile'\)/.test(completeBody));
expect('"На главную" navigates to the existing /feed route',
  /arp-to-home[\s\S]{0,300}navigate\('\/feed'\)/.test(completeBody));
expect('rating CTA stays reachable on COMPLETED (#arp-submit-rating)',
  completeBody.includes('arp-submit-rating'));
expect('COMPLETED never opens the cancel sheet',
  !/openPassengerCancelSheet/.test(completeBody));

// CSS side of the variant toggle: data-payment drives data-pay-show
// visibility for all three states, and the pending warning is styled.
const css = read('../public/styles/cloud.css');
for (const state of ['auto', 'pending', 'paid']) {
  expect(`cloud.css toggles [data-pay-show] for data-payment="${state}"`,
    new RegExp(`\\[data-payment="${state}"\\]`).test(css));
}
expect('cloud.css styles the pending pay warning',
  /\.passenger-complete__pay-warning\s*\{/.test(css));
expect('cloud.css styles the disabled receipt action',
  /\.passenger-complete__receipt-action:disabled/.test(css));

// Driver COMPLETED route untouched: the dispatcher still gates by role,
// keeps its own renderCompleted and persists COMPLETED via the finish CTA.
expect('dispatcher still routes non-driver roles to renderPassenger()',
  /if\s*\(role\s*!==\s*'driver'\)\s*return\s+renderPassenger\(\)/.test(dispatcher));
expect('driver branch still defines renderCompleted()',
  /function\s+renderCompleted\s*\(/.test(dispatcher));
expect('driver branch still dispatches COMPLETED to renderCompleted()',
  /RIDE_STATUS\.COMPLETED\)\s*renderCompleted\(\)/.test(dispatcher));
expect('driver finish CTA still persists COMPLETED',
  /persistDriverRideStatus\(RIDE_STATUS\.COMPLETED\)/.test(dispatcher));

// ── F. Cross-check vs ride_state.js ──────────────────────────
// Guard against the RIDE_STATUS enum drifting from what the passenger
// screen pins above. Every status the contract names must still be a
// `KEY: 'KEY'` member of the enum.
for (const s of ['ACCEPTED', 'DRIVER_EN_ROUTE', 'DRIVER_APPROACHING_PICKUP', 'WAITING_PASSENGER', 'IN_PROGRESS', 'COMPLETED', 'CANCELED', 'NO_SHOW']) {
  expect(`ride_state.js RIDE_STATUS defines ${s}: '${s}'`,
    new RegExp(`${s}:\\s*'${s}'`).test(rideState));
}

// ── G. COMPLETED report sheet: real submit→confirmation moderation flow (BD-MOD) ──
// Was a dead-end (pick a reason → toast only; a forward chevron promised a
// non-existent drill-in). Now mirrors the in-ride safety sheet / order_detail
// BD-MOD-01: radiogroup reasons → «Отправить жалобу» → «Жалоба отправлена»
// confirmation, all IN-SCREEN (the BD-RIDE-P-07 safety sheet is NOT rerouted).
expect('report reasons are a radiogroup (role=radio + aria-checked)',
  /report-list"[^>]*role="radiogroup"/.test(passenger)
  && /passenger-complete__report-reason"[^>]*role="radio"[^>]*aria-checked="false"/.test(passenger));
expect('report sheet has an «Отправить жалобу» submit button (#arp-report-submit)',
  /id="arp-report-submit"/.test(passenger) && /Отправить жалобу/.test(passenger));
expect('report sheet has a submitted confirmation (role=status aria-live, «Жалоба отправлена»)',
  /passenger-complete__report-done"[^>]*role="status"[^>]*aria-live="polite"/.test(passenger)
  && /Жалоба отправлена/.test(passenger));
expect('selecting a reason checks it and enables submit',
  /reportReason\s*=\s*btn\.getAttribute\('data-reason'\)/.test(passenger)
  && /reportSubmit\.disabled\s*=\s*false/.test(passenger));
expect('submit advances the sheet to the submitted stage',
  /reportSubmit\.addEventListener\('click'[\s\S]{0,200}reportStage\s*=\s*'submitted'/.test(passenger));
expect('submit moves focus to the return CTA (not left on the now-hidden submit button)',
  /reportStage\s*=\s*'submitted'[\s\S]{0,300}reportReturn\.focus\(\)/.test(passenger));
expect('the report flow stays in-screen — no /report reroute (BD-RIDE-P-07 preserved)',
  !/(?:navigate|go)\(\s*['"]\/report/.test(passenger));
expect('the old dead-end is gone (no «Причина выбрана» toast, no forward chevron in a reason)',
  !/Причина выбрана/.test(passenger) && !/report-chev/.test(passenger));
expect('cloud.css gates the report stages + styles the submitted confirmation',
  /\[data-report-stage="submitted"\]\s+\[data-report-stage-select\]/.test(css)
  && /\.passenger-complete__report-done\s*\{/.test(css));
expect('sw.js VERSION bumped to v175+ (precached active_ride_passenger.js + cloud.css changed)',
  Number((read('../public/sw.js').match(/VERSION\s*=\s*'v(\d+)'/) || [])[1] || 0) >= 175);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
