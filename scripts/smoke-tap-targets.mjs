// BD-A11Y-TAP-01 — static guard for the #732 touch-target batch.
//
// Four interactive controls shipped below the 44px minimum touch target:
//   Map «Ввести адрес вручную» (.map-home__cta--ghost, 42px)
//   Order Map Draft route-edit (.omd-route__edit, 38px via .bd-iconbtn)
//   Order Map Draft phone-edit «Изменить» (.omd-phone__edit, unstyled ~32px)
//   Driver Map «Принять» (.driver-map__order-foot .bd-btn, 36px via .bd-btn.sm)
//
// Each is expanded to a >=44px HIT AREA via a centered, transparent ::after overlay — the
// visual box is unchanged (zero layout shift). This pins that the expansion stays wired for
// every control and keeps the 44px floor, so a refactor can't silently drop it.
//
// Static source analysis only — no DOM, no browser, no computed layout.

import fs from 'node:fs';

const css = fs.readFileSync(new URL('../public/styles/cloud.css', import.meta.url), 'utf8');
const dcCss = fs.readFileSync(new URL('../public/styles/daily_communication.css', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

const issues = [];
const expect = (label, cond, detail = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
};

const SELECTORS = [
  '.map-home__cta--ghost',
  '.omd-route__edit',
  '.omd-phone__edit',
  '.driver-map__order-foot .bd-btn',
  // trip-confirmation back / shield / party-chat (36px) + chat send (38px) and chat back / call
  // (38px, the shared .bd-iconbtn atom — scoped by id so it is never resized globally).
  '.cf-back',
  '.cf-shield',
  '.cf-party-chat',
  '.chat__send',
  '#chat-back',
  '#chat-call',
  // OD-MEL-3 of #779 — Order Detail back (.od-back, ~22px bare glyph button), the only
  // chrome nav on /order, rendered on every state; expanded to the >=44px floor.
  '.od-back',
];

// Every control gets the hit-area overlay…
for (const sel of SELECTORS) {
  expect(`${sel} gets a >=44px hit-area overlay (::after)`, css.includes(sel + '::after'));
}
// …anchored by position: relative (the controls share the grouped position rule).
expect('each control anchors the overlay with position: relative',
  SELECTORS.every((sel) => css.includes(sel + ',') || css.includes(sel + ' {')));
// …and the overlay enforces the 44px floor.
expect('the hit-area overlay enforces the 44px floor (min-width + min-height 44px)',
  /::after\s*\{[\s\S]{0,260}min-width:\s*44px;[\s\S]{0,60}min-height:\s*44px;/.test(css));
// …transparently — a content overlay, no background paint (no visual change).
expect('the overlay is transparent (content: "" with no background) — no visual regression',
  /::after\s*\{[\s\S]{0,120}content:\s*""/.test(css)
  && !/touch-target a11y[\s\S]{0,400}background/.test(css));

// ── #777 — Daily Communication touch-target a11y (daily_communication.css) ──
// .dc-back (38px .bd-iconbtn) + the detail action buttons (.bd-btn.sm, 36px) get
// the same >=44px transparent ::after hit-area overlay as the #732 batch.
const DC_SELECTORS = [
  '.dc-back',
  '.dc-detail__actions .bd-btn',
  '.dc-detail__links .bd-btn',
];
for (const sel of DC_SELECTORS) {
  expect(`${sel} gets a >=44px hit-area overlay (::after)`, dcCss.includes(sel + '::after'));
}
expect('dc controls anchor the overlay with position: relative',
  DC_SELECTORS.every((sel) => dcCss.includes(sel + ',') || dcCss.includes(sel + ' {')));
expect('the dc hit-area overlay enforces the 44px floor (min-width + min-height 44px)',
  /::after\s*\{[\s\S]{0,260}min-width:\s*44px;[\s\S]{0,60}min-height:\s*44px;/.test(dcCss));
expect('the dc overlay is transparent (content: "" with no background) — no visual regression',
  /::after\s*\{[\s\S]{0,120}content:\s*""/.test(dcCss));

// Precached cloud.css / daily_communication.css changed → VERSION bumped.
expect('sw.js VERSION bumped to v222+',
  Number((sw.match(/VERSION\s*=\s*'v(\d+)'/) || [])[1] || 0) >= 222);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
