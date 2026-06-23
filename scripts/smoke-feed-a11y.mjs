// BD-FEED-01 — static regression smoke for Feed tab + post-action a11y.
//
// Two assistive-tech gaps from the BD-FEED-01 audit:
//  - the category chips conveyed the active state but as an INCOMPLETE tab pattern
//    (role="tab"/aria-selected with no tabpanel/aria-controls/roving). #732 demoted
//    them to a filter group — role="group" + aria-pressed — because they filter ONE
//    role="feed" region, not switchable panels (the same change lands on /inbox);
//  - the like / comment buttons' aria-label hid the visible count from AT.
// The fix declares aria-pressed on the chips and keeps it in sync on click, and
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

// ── A. category chips are a filter GROUP that conveys the active state to AT (#732) ──
expect('the chip row is a role="group" filter set (not a fake tablist)',
  /class="feed-chip-row" role="group"/.test(feed) && !/role="tablist"/.test(feed));
expect('category chip markup declares aria-pressed (true for the active chip), not role="tab"',
  /aria-pressed="\$\{i === 0 \? 'true' : 'false'\}"/.test(feed) && !/\brole="tab"/.test(feed));
expect('the chip click handler keeps aria-pressed in sync with the active chip',
  /setAttribute\('aria-pressed',\s*selected \? 'true' : 'false'\)/.test(feed));

// ── B. like / comment counts are in the accessible name ──
expect('like button aria-label includes the like count',
  /aria-label="Нравится: \$\{escapeHtml\(String\(p\.likes \|\| 0\)\)\}"/.test(feed));
expect('comment button aria-label includes the comment count',
  /aria-label="Комментарии: \$\{escapeHtml\(String\(p\.comments \|\| 0\)\)\}"/.test(feed));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
