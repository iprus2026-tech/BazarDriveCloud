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
