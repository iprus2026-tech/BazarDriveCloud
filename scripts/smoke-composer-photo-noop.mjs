// BD-COMPOSER-01 — static regression smoke for the Composer photo affordance.
//
// `#c-photo-btn` ("Добавить фото") has no upload backend yet. Per the project
// "No silent no-op controls" policy (CLAUDE.md) it must ship an honest disabled
// "Скоро" state — NOT a clickable empty-closure stub (the #774 repair, matching
// the #763 Rules «Скоро» precedent). This smoke pins:
//   A. the photo button is rendered `disabled` + `aria-disabled="true"` with a
//      «Скоро» pill,
//   B. composer.js binds NO empty-closure click handler (the banned no-op shape).
//
// STATIC: reads source and asserts the contract holds. No browser, no DOM.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const composer = read('../public/src/screens/composer.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── A. the photo control ships an honest disabled "Скоро" state ──
const photoBtn = composer.match(/<button[^>]*id="c-photo-btn"[^>]*>/);
expect('#c-photo-btn markup is present', !!photoBtn);
const btnTag = photoBtn ? photoBtn[0] : '';
expect('#c-photo-btn is disabled', /\bdisabled\b/.test(btnTag));
expect('#c-photo-btn is aria-disabled="true"', /aria-disabled="true"/.test(btnTag));
expect('a «Скоро» pill is rendered for the photo control',
  /composer-photo-soon[^>]*>\s*Скоро/.test(composer));

// ── B. no banned empty-closure no-op handler anywhere in composer.js ──
expect('composer.js binds no empty-closure click handler',
  !/addEventListener\(\s*['"]click['"]\s*,\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(composer));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
