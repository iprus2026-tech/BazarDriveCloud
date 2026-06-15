// BD-RIDE-D-NOSHOW-01 — static regression smoke for the driver no-show sub-flow.
//
// The flow (active_ride_driver_noshow.js) is a 5-state in-layout sheet sequence
// (action → confirm → result → compensation → done) opened from the
// WAITING_PASSENGER «Не приехал» (#ar-no-show) action. A refactor could drop a
// state, leak ride-state persistence into the flow module (the ONLY persist is
// the screen's onConfirmNoShow callback at confirm), or re-route #ar-no-show.
// STATIC source assertions only — no browser, no DOM.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const flow = read('../public/src/screens/active_ride_driver_noshow.js');
const screen = read('../public/src/screens/active_ride.js');
const sw = read('../public/sw.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── A. Module surface + 5 states ──
expect('module exports openDriverNoShowFlow', /export\s+function\s+openDriverNoShowFlow\s*\(/.test(flow));
for (const fn of ['renderAction', 'renderConfirm', 'renderResult', 'renderCompensation', 'renderDone']) {
  expect(`flow has the '${fn}' state`, new RegExp(`function\\s+${fn}\\s*\\(`).test(flow));
}

// ── B. Copy (one per state) ──
for (const copy of [
  'Пассажир не вышел?',
  'Подтвердить, что пассажир не вышел?',
  'Да, пассажир не вышел',
  'Отмечено: пассажир не вышел',
  'Компенсация за ожидание',
  'Вы снова на линии',
]) {
  expect(`flow carries copy «${copy}»`, flow.includes(copy));
}

// ── C. Persistence isolation — the ONLY mutation is the onConfirmNoShow hook ──
expect('flow module never imports ride_state', !/from\s+'[^']*ride_state/.test(flow));
expect('flow module never persists ride state directly',
  !/persistDriver/.test(flow) && !/updateActiveRideStatus/.test(flow) && !/saveActiveRide/.test(flow));
expect('confirm step fires onConfirmNoShow then advances to the result',
  /confirmNoShow\(\);\s*renderResult\(\)/.test(flow));

// ── D. UI-only boundary ──
expect('flow imports only escapeHtml (no data/backend layer)',
  /import\s+\{\s*escapeHtml\s*\}\s+from\s+'\.\.\/util\.js'/.test(flow)
  && !/mock_api/.test(flow) && !/data_layer/.test(flow));
expect('flow performs no fetch / localStorage / native API',
  !/\bfetch\s*\(/.test(flow) && !/localStorage/.test(flow) && !/Notification\b/.test(flow));

// ── E. Screen wiring — #ar-no-show opens the flow + persists NO_SHOW ──
expect('active_ride.js imports openDriverNoShowFlow',
  /import\s+\{\s*openDriverNoShowFlow\s*\}\s+from\s+'\.\/active_ride_driver_noshow\.js'/.test(screen));
expect('#ar-no-show opens the no-show flow (no longer the cancel-sheet preset)',
  /ar-no-show'\)[\s\S]{0,320}openDriverNoShowFlow\s*\(\s*sheet/.test(screen));
expect('#ar-no-show flow persists NO_SHOW via onConfirmNoShow',
  /ar-no-show'\)[\s\S]{0,400}onConfirmNoShow:[\s\S]{0,160}persistDriverCancel\(RIDE_STATUS\.NO_SHOW,\s*'passenger_no_show'\)/.test(screen));
expect('#ar-no-show no longer opens the cancel sheet with the passenger_no_show preset',
  !/ar-no-show'\)[\s\S]{0,320}openDriverCancelSheet\s*\(/.test(screen));

// ── F. Service worker precache ──
expect('sw.js precaches active_ride_driver_noshow.js',
  /\.\/src\/screens\/active_ride_driver_noshow\.js/.test(sw));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
