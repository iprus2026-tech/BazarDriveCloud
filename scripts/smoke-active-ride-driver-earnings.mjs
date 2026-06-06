// BD-RIDE-D-09 — static regression smoke for the driver earnings /
// completion polish sheet (issue #376).
//
// The DriverEarningsSheet is the terminal completion UI for the driver
// completed flow. It lives in active_ride_driver_sheets.js (alongside the
// cancel + problem sheets) and is mounted by renderCompleted() in
// active_ride.js over the completed map shell. A future refactor could
// silently drop a state, regress the cash confirm gate, the optimistic
// close timer, the data-free isolation, or re-introduce the old inline
// completion card without tripping `node scripts/check.mjs`.
//
// This script is intentionally STATIC: it reads the sheets module, the
// driver screen, the stylesheet and the design registry and asserts the
// contract still holds in source. No browser, no DOM, no behaviour change.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const sheets = read('../public/src/screens/active_ride_driver_sheets.js');
const screen = read('../public/src/screens/active_ride.js');
const css = read('../public/styles/driver_sheets.css');
const registry = read('../docs/design-registry.json');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── A. Module API + dispatcher wiring ────────────────────────
for (const fn of ['renderDriverEarningsSheet', 'openDriverEarningsSheet']) {
  expect(`sheets module exports ${fn}`,
    new RegExp(`export\\s+function\\s+${fn}\\s*\\(`).test(sheets));
}
expect('bindDriverSheetEvents routes the earnings kind',
  /kind === 'earnings'\)\s*bindEarningsEvents/.test(sheets));
expect('prototype-parity window.BD.DriverEarningsSheet alias is exposed',
  /window\.BD\.DriverEarningsSheet\s*=/.test(sheets));

// ── B. The seven states ──────────────────────────────────────
for (const state of ['summary', 'cash', 'noncash', 'shift', 'loading', 'closed', 'empty']) {
  expect(`earnings sheet knows the '${state}' state`,
    new RegExp(`'${state}'`).test(sheets));
}
expect('earnings sheet enumerates exactly the seven states',
  /EARNINGS_STATES\s*=\s*new Set\(\[\s*'summary',\s*'cash',\s*'noncash',\s*'shift',\s*'loading',\s*'closed',\s*'empty'\s*\]\)/.test(sheets));

// ── C. Earnings hero + breakdown + de-* markup ───────────────
for (const cls of ['de-earn', 'de-earn__hero', 'de-earn__total', 'de-pay-badge', 'de-confirm', 'de-balance', 'de-statgrid', 'de-stat']) {
  expect(`markup uses .${cls}`, sheets.includes(cls));
}
expect('cash variant renders the yellow cash pay badge', /de-pay-badge cash/.test(sheets));
expect('noncash variant renders the blue noncash pay badge', /de-pay-badge noncash/.test(sheets));

// ── C2. BD-RIDE-D-11 reference copy parity ───────────────────
// The merged BD-RIDE-D-11 render-gate (PR #402, closes #401) renames the
// hero label, the tips row and the total row, and lifts the sheet title.
// Old D-09 copy must be gone so the live and reference can't drift again.
for (const present of ['Заработок за поездку', 'Чаевые / бонус', 'Итого водителю', 'Поездка завершена']) {
  expect(`reference copy present: ${present}`, sheets.includes(present));
}
for (const absent of ['Ваш доход за поездку', 'Чаевые и бонусы', 'Итого вам']) {
  expect(`legacy copy gone: ${absent}`, !sheets.includes(absent));
}
expect('legacy "Ваш доход" sheet title is gone',
  !/['"]Ваш доход['"]/.test(sheets));

// ── C3. BD-RIDE-D-11 header status pill (replaces close X) ───
expect('earningsPillHtml renders a per-variant status pill',
  /function\s+earningsPillHtml\s*\(/.test(sheets));
expect('earnings sheetShell passes the pill into the head-right slot',
  /sheetShell\(\s*['"]earnings['"][\s\S]{0,200}earningsPillHtml\(/.test(sheets));
expect('sheetShell exposes a headRight slot with a CLOSE_X_HTML default',
  /CLOSE_X_HTML\b/.test(sheets) && /headRight\s*=\s*CLOSE_X_HTML/.test(sheets));
for (const pill of ['de-pill--ok', 'de-pill--cash', 'de-pill--noncash']) {
  expect(`pill modifier .${pill} present in source`, sheets.includes(pill));
  expect(`pill modifier .${pill} defined in css`, css.includes(pill));
}

// ── C4. BD-RIDE-D-11 passenger context row ───────────────────
expect('earningsPassengerHtml renders the compact passenger row',
  /function\s+earningsPassengerHtml\s*\(/.test(sheets));
expect('earningsContentHtml gates the passenger row to summary/cash/noncash',
  /showPassenger\s*=\s*variant\s*===\s*'summary'[\s\S]{0,80}variant\s*===\s*'cash'[\s\S]{0,80}variant\s*===\s*'noncash'/.test(sheets));
expect('css defines the .de-passenger* row',
  css.includes('.de-passenger') && css.includes('.de-passenger__avatar') && css.includes('.de-passenger__metrics'));

// ── C5. BD-RIDE-D-11 secondary nav row ───────────────────────
expect('earningsSecondaryHtml renders the secondary nav row',
  /function\s+earningsSecondaryHtml\s*\(/.test(sheets));
for (const id of ['driver-earnings-orders', 'driver-earnings-feed']) {
  expect(`secondary nav button #${id} present`, sheets.includes(id));
}
for (const label of ['Открыть заказы', 'В ленту']) {
  expect(`secondary nav label "${label}" present`, sheets.includes(label));
}
expect('css defines .de-earn__secondary', css.includes('.de-earn__secondary'));

// ── D. Cash confirm gate ─────────────────────────────────────
// Primary is disabled in the cash variant until the confirm row toggles it.
expect('cash variant renders the primary disabled by default',
  /variant === 'cash'[\s\S]{0,80}\bdisabled\b/.test(sheets));
expect('cash confirm row copy "Оплату получил"', sheets.includes('Оплату получил'));
expect('confirm toggle flips the primary disabled state',
  /primary\.disabled\s*=\s*!cashConfirmed/.test(sheets));

// ── E. Optimistic close (loading 1.4s → closed) ──────────────
expect('loading transitions into the closed stage',
  /dataset\.stage\s*=\s*'loading'/.test(sheets) && /dataset\.stage\s*=\s*'closed'/.test(sheets));
expect('loading uses the mock 1.4s timeout', /setTimeout\([^,]+,\s*1400\s*\)/.test(sheets));
expect('closed-state copy "Вы снова на линии"', sheets.includes('Вы снова на линии'));
expect('empty-state fallback copy present', sheets.includes('Нет данных о доходе'));

// ── F. Data-free isolation (no ride_state, no payments) ──────
expect('sheets module never imports ride_state.js',
  !/from\s*'[^']*ride_state/.test(sheets));
expect('sheets module performs no real payment/balance write',
  !/fetch\(/.test(sheets) && !/updateActiveRideStatus/.test(sheets));

// ── G. Driver screen integration (replaces the inline card) ──
expect('active_ride.js imports openDriverEarningsSheet from the sheets module',
  /import\s*\{[\s\S]*?openDriverEarningsSheet[\s\S]*?\}\s*from\s*'\.\/active_ride_driver_sheets\.js'/.test(screen));
expect('active_ride.js reads the ?state= entry stage',
  /query\.get\('state'\)/.test(screen));
expect('active_ride.js builds a mock earnings payload',
  /function\s+buildDriverEarningsPayload\s*\(/.test(screen));
expect('active_ride.js uses a fixed 12% commission + mock tip',
  /commissionRate\s*=\s*0\.12/.test(screen) && /tip\s*=\s*120/.test(screen));
expect('renderCompleted mounts the sheet with state + payload',
  /openDriverEarningsSheet\(\s*root\s*,\s*\{[\s\S]*?state:\s*earningsState[\s\S]*?payload[\s\S]*?\}\s*\)/.test(screen));
expect('the old inline completion card is gone',
  !screen.includes('active-ride__completion-card'));
expect('active_ride.js no longer defines the inline sheet helpers',
  !/function\s+createDriverSheet\s*\(/.test(screen)
  && !/function\s+openDriverEarningsSheet\s*\(/.test(screen));
expect('ride history is still persisted in renderCompleted',
  /saveRideHistoryEntry\(/.test(screen) && /buildDriverHistoryEntry\(/.test(screen));

// ── G2. Follow-up regressions (Codex review after #378) ──────
// 1) Dismissing the earnings sheet must leave an exit, not a blank map.
expect('renderCompleted wires an onClose exit to /driver-map',
  /onClose:\s*\(\)\s*=>\s*go\('\/driver-map'\)/.test(screen));
// BD-RIDE-D-11 (#403) — secondary nav row routes
expect('renderCompleted wires onOrders to /driver-map',
  /onOrders:\s*\(\)\s*=>\s*go\('\/driver-map'\)/.test(screen));
expect('renderCompleted wires onFeed to /feed',
  /onFeed:\s*\(\)\s*=>\s*go\('\/feed'\)/.test(screen));
// BD-RIDE-D-11 (#403) — payload exposes the passenger + trip context
for (const key of ['passengerName', 'passengerInitials', 'pickupLabel', 'distanceLabel', 'durationLabel', 'tripNumberLabel']) {
  expect(`buildDriverEarningsPayload exposes ${key}`,
    new RegExp(`${key}\\s*:`).test(screen));
}
// 2) Completing via the normal flow re-syncs the map shell data-status so the
//    COMPLETED polish applies without a reload.
expect('renderSheet re-syncs the map shell data-status without reload',
  /mapShell\.dataset\.status\s*=\s*ride\.status/.test(screen));
// 3) History persists the same earnings the sheet displays — sourced from the
//    payload, with the divergent (8%, no-tip) calc removed entirely.
expect('history earnings are sourced from the sheet payload (net parity)',
  /net:\s*payload\.net/.test(screen) && /buildDriverEarningsPayload\(ride\)/.test(screen));
expect('the divergent calcEarnings helper is gone',
  !/function\s+calcEarnings\s*\(/.test(screen));

// ── H. Passenger flow untouched ──────────────────────────────
expect('driver guard still hands non-driver roles to renderPassenger',
  /if\s*\(\s*role\s*!==\s*'driver'\s*\)\s*return\s+renderPassenger\(\)/.test(screen));

// ── I. Stylesheet + render-gate registration ─────────────────
for (const sel of ['.de-earn', '.de-pay-badge.cash', '.de-pay-badge.noncash', '.de-confirm', '.de-balance', '.de-statgrid', '.de-stat']) {
  expect(`driver_sheets.css defines ${sel}`, css.includes(sel));
}
expect('completed map polish hides the car marker behind the dim',
  /data-status="COMPLETED"\]\s*\.bd-map-shell__marker--car/.test(css));
expect('design-registry.json registers the BD-RIDE-D-09 render gate',
  /"id":\s*"BD-RIDE-D-09"/.test(registry) && /role=driver&status=COMPLETED/.test(registry));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
