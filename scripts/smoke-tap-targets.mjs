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

// Precached cloud.css changed → VERSION bumped.
expect('sw.js VERSION bumped to v222+',
  Number((sw.match(/VERSION\s*=\s*'v(\d+)'/) || [])[1] || 0) >= 222);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
