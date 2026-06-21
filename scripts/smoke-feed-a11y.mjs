// BD-FEED-01 — static regression smoke for Feed tab + post-action a11y.
//
// Two assistive-tech gaps from the BD-FEED-01 audit:
//  - the category tabs expose role="tab" but never conveyed the active tab to AT
//    (no aria-selected);
//  - the like / comment buttons' aria-label hid the visible count from AT.
// The fix declares aria-selected on the tabs and keeps it in sync on click, and
// folds the like/comment counts into each button's accessible name. This smoke
// pins both so a refactor cannot silently regress them.
//
// STATIC: reads source and asserts the contract holds. No browser, no DOM, no
// network, no behaviour change.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const feed = read('../public/src/screens/feed.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── A. tabs convey the active state to AT ──
expect('category tab markup declares aria-selected (true for the active tab)',
  /role="tab"[\s\S]{0,80}aria-selected="\$\{i === 0 \? 'true' : 'false'\}"/.test(feed));
expect('the tab click handler keeps aria-selected in sync with the active tab',
  /setAttribute\('aria-selected',\s*selected \? 'true' : 'false'\)/.test(feed));

// ── B. like / comment counts are in the accessible name ──
expect('like button aria-label includes the like count',
  /aria-label="Нравится: \$\{escapeHtml\(String\(p\.likes \|\| 0\)\)\}"/.test(feed));
expect('comment button aria-label includes the comment count',
  /aria-label="Комментарии: \$\{escapeHtml\(String\(p\.comments \|\| 0\)\)\}"/.test(feed));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
