// BD-FEED-01 — static regression smoke for the Feed loading skeleton.
//
// The feed returns its shell synchronously and loads in the background, so it
// must paint a loading skeleton (with aria-busy) instead of leaving #app blank
// while the first load resolves (the router clears #app before awaiting the
// loader). This smoke pins: renderLoading() sets aria-busy + skeleton cards, the
// initial load is kicked via refreshList(false), renderList() clears aria-busy,
// and the shimmer atom (reduced-motion aware) lives in cloud.css.
//
// STATIC: reads source and asserts the contract holds. No browser, no DOM.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const feed = read('../public/src/screens/feed.js');
const css = read('../public/styles/cloud.css');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── A. a loading state is rendered before the first load resolves ──
expect('renderLoading() sets aria-busy=true and paints skeleton cards',
  /function renderLoading\(\)[\s\S]*?setAttribute\('aria-busy',\s*'true'\)[\s\S]*?feed-card--skeleton/.test(feed));
expect('the skeleton shows only on the first load (refreshList: if (!isRetry) renderLoading())',
  /if\s*\(\s*!isRetry\s*\)\s*renderLoading\(\)/.test(feed));
expect('the initial render kicks the background load via refreshList(false)',
  /refreshList\(\s*false\s*\)/.test(feed));
expect('renderList() clears aria-busy when content / empty state is shown',
  /function renderList\(\)\s*\{[\s\S]{0,80}setAttribute\('aria-busy',\s*'false'\)/.test(feed));

// ── B. the shimmer atom lives in cloud.css and respects reduced motion ──
expect('cloud.css defines the .feed-skeleton shimmer animation',
  /\.feed-skeleton__line[\s\S]*?animation:\s*feed-skeleton-shimmer/.test(css)
  && /@keyframes feed-skeleton-shimmer/.test(css));
expect('the shimmer is disabled under prefers-reduced-motion',
  /prefers-reduced-motion: reduce[\s\S]*?feed-skeleton__line[\s\S]*?animation:\s*none/.test(css));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
