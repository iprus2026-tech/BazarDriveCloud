// BD-FEED-01 — static regression smoke for the Feed card open affordance.
//
// The Feed contract's primary card action ("card tap → /post?id=...") must be
// reachable by mouse AND keyboard / screen-reader users, WITHOUT overriding the
// <article> role inside the role="feed" list. The fix renders a dedicated
// stretched open-link (.feed-card__open) per card — a native <a> that opens
// Post Detail (mouse + Enter), exposed to AT with a distinctive label — while
// the card stays an <article> and the inner controls are raised above the link.
// This smoke pins that contract so a refactor can't drop the keyboard path,
// re-introduce a role="button" override, or ship a card without the open-link.
//
// STATIC: reads source and asserts the contract holds. No browser, no DOM, no
// network, no behaviour change.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const feed = read('../public/src/screens/feed.js');
const css = read('../public/styles/cloud.css');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── A. dedicated open-link that PRESERVES the <article> role ──
const linkFn = (feed.match(/function cardOpenLink[\s\S]*?\n\}/) || [''])[0];
const labeler = (feed.match(/function cardLabel[\s\S]*?\n\}/) || [''])[0];
expect('cardOpenLink renders <a class="feed-card__open"> linking to /post?id= with an aria-label',
  /<a class="feed-card__open"/.test(linkFn) && /href="#\/post\?id=/.test(linkFn) && /aria-label=/.test(linkFn));
expect('aria-label is distinctive — cardLabel builds from route/title, not author alone',
  /p\.from|p\.to|p\.title/.test(labeler));
expect('the card keeps its <article> role — no role="button" override anywhere in feed.js',
  !/role="button"/.test(feed));

// ── B. every card renders the open-link ──
const linkUses = (feed.match(/\$\{cardOpenLink\(p\)\}/g) || []).length;
expect('every feed card renders cardOpenLink', linkUses >= 4, `count=${linkUses}`);

// ── C. native <a> replaces the custom key handler ──
expect('no custom card keydown handler remains (native <a> handles Enter)',
  !/addEventListener\('keydown'/.test(feed));

// ── D. CSS: stretched overlay link + focus ring + inner controls raised above it ──
expect('cloud.css stretches .feed-card__open over the card (absolute + inset:0)',
  /\.feed-card__open\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;/.test(css));
expect('cloud.css gives .feed-card__open a :focus-visible ring',
  /\.feed-card__open:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--accent\)/.test(css));
expect('cloud.css raises the inner controls above the open-link (z-index)',
  /\.feed-list \[data-post-card\] \.feed-card-cta[\s\S]*?z-index:\s*2/.test(css));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
