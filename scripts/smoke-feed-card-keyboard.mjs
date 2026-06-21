// BD-FEED-01 — static regression smoke for the Feed card keyboard affordance.
//
// The Feed contract's primary card action ("card tap → /post?id=...") must be
// reachable by keyboard / screen-reader users, not just by pointer. The fix
// makes each clickable card a focusable <article> (role preserved, NOT
// overridden to "button") with a distinctive label, and adds an Enter/Space key
// path to the same go('/post?id=...') the click handler uses, plus a
// :focus-visible ring. This smoke pins that contract so a
// refactor cannot silently drop the keyboard path or ship a new card type
// without the affordance.
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

// ── A. focusable card affordance that PRESERVES the <article> role ──
const helper = (feed.match(/function cardOpenAttrs[\s\S]*?\n\}/) || [''])[0];
const labeler = (feed.match(/function cardLabel[\s\S]*?\n\}/) || [''])[0];
expect('cardOpenAttrs makes the card focusable (tabindex="0") with an aria-label',
  /tabindex="0"/.test(helper) && /aria-label=/.test(helper));
expect('card affordance preserves the article role (no role="button" override)',
  !/role="button"/.test(helper));
expect('aria-label is distinctive — cardLabel builds from route/title, not author alone',
  /p\.from|p\.to|p\.title/.test(labeler));

// ── B. every clickable card applies the affordance; none omit it ──
const withAffordance = (feed.match(/data-post-card="\$\{[^}]*\}"\s+\$\{cardOpenAttrs\(p\)\}/g) || []).length;
expect('clickable cards apply cardOpenAttrs', withAffordance >= 1, `count=${withAffordance}`);
const bareArticles = (feed.match(/data-post-card="\$\{[^}]*\}">/g) || []).length;
expect('no data-post-card card omits the keyboard affordance', bareArticles === 0, `bare=${bareArticles}`);

// ── C. Enter/Space key path → same /post?id= navigation, with the inner-control guard ──
const kd = (feed.match(/feedList\.addEventListener\('keydown'[\s\S]*?\}\);/) || [''])[0];
expect('feed wires a keydown handler on the list', kd.length > 0);
expect("keydown activates on Enter or Space", /e\.key !== 'Enter' && e\.key !== ' '/.test(kd));
expect('keydown reuses the inner-control guard (button, a, [data-action])',
  /e\.target\.closest\('button, a, \[data-action\]'\)/.test(kd));
expect('keydown preventDefault so Space does not scroll', /e\.preventDefault\(\)/.test(kd));
expect('keydown navigates to /post?id= via go() (same as the click path)',
  /go\(`\/post\?id=\$\{encodeURIComponent\(postId\)\}`\)/.test(kd));

// ── D. visible focus ring atom (mirrors .inbox-item:focus-visible) ──
expect('cloud.css defines .feed-list [data-post-card]:focus-visible outline',
  /\.feed-list \[data-post-card\]:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--accent\)/.test(css));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
