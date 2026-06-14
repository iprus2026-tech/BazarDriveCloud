// BD-NOTIF-01 — static regression smoke for the passenger profile
// notification bell entry point.
//
// The passenger profile renders a notification bell (#pfp-notif-btn) in the
// topbar. It shipped inert (no click listener). BD-NOTIF-01 wires it to the
// existing /inbox hub instead of splitting a new /notifications route. This
// pins that entry point: a refactor that drops the listener or re-points the
// bell elsewhere would leave /inbox orphaned again and `node scripts/check.mjs`
// would still pass without this guard.
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

// ── A. the bell still renders a stable target id ─────────────
expect('topbar renders the notification bell #pfp-notif-btn',
  /id="pfp-notif-btn"/.test(profile));

// ── B. the bell has a click handler that opens /inbox ────────
const handler = profile.match(/#pfp-notif-btn'\)\?\.addEventListener\(\s*'click'\s*,\s*\(\)\s*=>\s*go\(\s*['"`]\/inbox['"`]\s*\)\s*\)/);
expect('#pfp-notif-btn has a click handler that calls go(\'/inbox\')', !!handler);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
