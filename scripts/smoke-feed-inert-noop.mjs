// BD-FEED-01 — static regression smoke for the Feed inert-control stubs.
//
// The search button, the per-post kebab («Меню поста»), and the like / comment /
// share buttons have no backend or target screen yet. Rather than leave them as
// silent dead controls, they are marked `data-noop` and a delegated handler
// swallows their click — the same explicit-stub convention as rules.js. This
// smoke pins that every inert control carries data-noop and the handler exists,
// so a refactor can't silently ship a dead control again.
//
// STATIC: reads source and asserts the contract holds. No browser, no DOM.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const feed = read('../public/src/screens/feed.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── A. every inert control is marked data-noop ──
expect('search topbar button is data-noop',
  /<button class="bd-iconbtn"[^>]*\bdata-noop\b[^>]*aria-label="Поиск"/.test(feed));
expect('per-post kebab («Меню поста») is data-noop',
  /<button class="feed-card-menu"[^>]*\bdata-noop\b/.test(feed));
const actionNoop = (feed.match(/<button class="feed-post-actions__btn[^"]*"[^>]*\bdata-noop\b/g) || []).length;
expect('like / comment / share buttons are data-noop', actionNoop >= 3, `count=${actionNoop}`);

// ── B. a delegated handler swallows data-noop clicks (explicit no-op) ──
expect('a delegated [data-noop] handler intercepts the click and preventDefaults',
  /closest\('\[data-noop\]'\)[\s\S]{0,40}preventDefault\(\)/.test(feed));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
