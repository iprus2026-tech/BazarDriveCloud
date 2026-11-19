// BD-FEED-01 — static regression smoke for the Feed inert-control stubs.
//
// The per-post kebab («Меню поста») and the like / comment buttons have no backend
// or target screen yet (search and share became real — pinned below as wired). Rather than leave them as
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
// BD-FEED-SEARCH-01 — search is a real client-side filter now, not a stub.
expect('search topbar button is wired (not data-noop) and toggles the search field',
  /<button class="bd-iconbtn"[^>]*id="feed-search-toggle"[^>]*aria-label="Поиск"/.test(feed)
  && !/<button class="bd-iconbtn"[^>]*\bdata-noop\b[^>]*aria-label="Поиск"/.test(feed)
  && /searchToggle\.addEventListener\('click'/.test(feed));
expect('search filters the loaded posts and has a no-results reset',
  /postMatchesQuery\(p, q\)/.test(feed) && /data-feed-search-reset/.test(feed));
expect('per-post kebab («Меню поста») is data-noop',
  /<button class="feed-card-menu"[^>]*\bdata-noop\b/.test(feed));
const actionNoop = (feed.match(/<button class="feed-post-actions__btn[^"]*"[^>]*\bdata-noop\b/g) || []).length;
expect('like / comment buttons are data-noop', actionNoop >= 2, `count=${actionNoop}`);
// BD-FEED-SHARE-01 — share is real: system share sheet, clipboard fallback, honest toast.
expect('share button is wired (data-action="share", not data-noop)',
  /<button class="feed-post-actions__btn feed-post-actions__share"[^>]*data-action="share"/.test(feed)
  && !/feed-post-actions__share"[^>]*\bdata-noop\b/.test(feed));
expect('share uses navigator.share with a clipboard fallback and ignores a dismissed sheet',
  /navigator\.share\(/.test(feed) && /clipboard\.writeText\(url\)/.test(feed) && /AbortError/.test(feed));

// ── B. a delegated handler swallows data-noop clicks (explicit no-op) ──
expect('a delegated [data-noop] handler intercepts the click and preventDefaults',
  /closest\('\[data-noop\]'\)[\s\S]{0,40}preventDefault\(\)/.test(feed));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
