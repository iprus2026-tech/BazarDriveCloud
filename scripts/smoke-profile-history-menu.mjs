// BD-HISTORY-P-01 — static regression smoke for the passenger profile history
// menu row.
//
// The passenger profile renders its trip-history section inline
// (historySectionHtml → <section id="profile-history-section">). The «История
// поездок» menu row (#pfp-menu-history) must open THAT section (scrollIntoView),
// not navigate to /feed — a shipped entry-point bug this pins shut. A refactor
// could re-point the handler back at go('/feed') or drop the section id and
// `node scripts/check.mjs` would still pass without this guard.
//
// This script is intentionally STATIC: it reads source and asserts the contract.
// No browser, no DOM, no network.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const profile = read('../public/src/screens/profile.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── A. the history section renders a stable scroll target ────
expect('historySectionHtml renders the <section id="profile-history-section"> target',
  /id="profile-history-section"/.test(profile));

// ── B. the menu row opens that section, not /feed ────────────
const handler = profile.match(/#pfp-menu-history'\)\?\.addEventListener\(\s*'click'\s*,\s*\(\)\s*=>\s*\{[\s\S]*?\}\s*\)/);
expect('#pfp-menu-history has a click handler', !!handler);
expect('#pfp-menu-history scrolls the history section into view',
  !!handler && /querySelector\('#profile-history-section'\)\?\.scrollIntoView\(/.test(handler[0]));
expect('#pfp-menu-history does NOT navigate to /feed (the fixed bug)',
  !!handler && !/go\(\s*['"`]\/feed/.test(handler[0]));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
