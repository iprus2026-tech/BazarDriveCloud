// BD-FEED-01 / #1186 — static regression smoke: the Feed carries no inert control.
//
// The per-post kebab («Меню поста») and the like / comment buttons had no backend or
// target screen. They were first marked `data-noop` (explicit stubs, a delegated handler
// swallowed their click) and this smoke pinned that marking. By the owner's decision
// (#1186) they are no longer rendered at all until the features exist: a control that
// looks tappable and does nothing is not shipped. Search and share became real earlier and
// stay pinned as wired.
//
// This smoke now pins the opposite invariant of its first version, on purpose: no
// `data-noop` control in the feed, no kebab / like / comment markup, and the share
// action still wired — so a refactor can't silently ship a dead control again.
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

// ── A. the feed's controls: real ones wired, inert ones absent ──
// BD-FEED-SEARCH-01 — search is a real client-side filter now, not a stub.
expect('search topbar button is wired (not data-noop) and toggles the search field',
  /<button class="bd-iconbtn"[^>]*id="feed-search-toggle"[^>]*aria-label="Поиск"/.test(feed)
  && !/<button class="bd-iconbtn"[^>]*\bdata-noop\b[^>]*aria-label="Поиск"/.test(feed)
  && /searchToggle\.addEventListener\('click'/.test(feed));
expect('search filters the loaded posts and has a no-results reset',
  /postMatchesQuery\(p, q\)/.test(feed) && /data-feed-search-reset/.test(feed));
// #1186 — the three inert controls are gone, not merely marked.
expect('the feed renders no data-noop control', !/\bdata-noop\b/.test(feed));
expect('per-post kebab («Меню поста») is not rendered',
  !/feed-card-menu/.test(feed) && !/Меню поста/.test(feed));
expect('like / comment buttons are not rendered (no count-only action, no likes / comments read)',
  !/aria-label="Нравится/.test(feed) && !/aria-label="Комментарии/.test(feed)
  && !/p\.likes/.test(feed) && !/p\.comments/.test(feed));
const actionButtons = (feed.match(/<button class="feed-post-actions__btn[^"]*"/g) || []).length;
expect('share is the only post action', actionButtons === 1, `count=${actionButtons}`);
// BD-FEED-SHARE-01 — share is real: system share sheet, clipboard fallback, honest toast.
expect('share button is wired (data-action="share", not data-noop)',
  /<button class="feed-post-actions__btn feed-post-actions__share"[^>]*data-action="share"/.test(feed)
  && !/feed-post-actions__share"[^>]*\bdata-noop\b/.test(feed));
expect('share uses navigator.share with a clipboard fallback and ignores a dismissed sheet',
  /navigator\.share\(/.test(feed) && /clipboard\.writeText\(url\)/.test(feed) && /AbortError/.test(feed));

// ── B. nothing is left to swallow: no delegated no-op handler either ──
expect('no delegated [data-noop] click swallower remains',
  !/closest\('\[data-noop\]'\)/.test(feed));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
