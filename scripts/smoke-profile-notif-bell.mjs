// BD-NOTIF-01 — static regression smoke for the profile notification entry
// points.
//
// The profile screen exposes two shipped notification entry points:
//   • passenger bell      #pfp-notif-btn   (topbar icon)
//   • driver quick-action #pf2-act-notif   (the «Уведомления» row, chevron)
// Both shipped without navigation — the bell was inert and the driver row only
// toggled `notificationsEnabled`. BD-NOTIF-01 wires BOTH to the existing /inbox
// hub instead of splitting a new /notifications route. This pins those entry
// points: a refactor that drops a listener, re-points it elsewhere, or restores
// the driver toggle would leave /inbox orphaned again and
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

// ── A. passenger bell — renders + opens /inbox ───────────────
expect('topbar renders the passenger notification bell #pfp-notif-btn',
  /id="pfp-notif-btn"/.test(profile));
const bell = profile.match(/#pfp-notif-btn'\)\?\.addEventListener\(\s*'click'\s*,\s*\(\)\s*=>\s*go\(\s*['"`]\/inbox['"`]\s*\)\s*\)/);
expect('#pfp-notif-btn has a click handler that calls go(\'/inbox\')', !!bell);

// ── B. driver quick-action row — renders + opens /inbox ──────
expect('quick actions render the driver notification row #pf2-act-notif',
  /id="pf2-act-notif"/.test(profile));
const driverRow = profile.match(/#pf2-act-notif'\)[\s\S]{0,120}?notifBtn\?\.addEventListener\(\s*'click'\s*,\s*\(\)\s*=>\s*go\(\s*['"`]\/inbox['"`]\s*\)\s*\)/);
expect('#pf2-act-notif has a click handler that calls go(\'/inbox\')', !!driverRow);

// ── C. the driver row no longer flips notificationsEnabled ───
// The prior stub toggled the flag instead of navigating. The wired handler is a
// short brace-less arrow, so a bounded window right after the querySelector
// must not mention notificationsEnabled (it would mean the toggle came back).
const driverWindow = profile.match(/querySelector\('#pf2-act-notif'\)[\s\S]{0,160}/);
expect('#pf2-act-notif handler does NOT toggle notificationsEnabled (the replaced stub)',
  !!driverRow && !(driverWindow && /notificationsEnabled/.test(driverWindow[0])));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
