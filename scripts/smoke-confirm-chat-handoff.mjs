// BD-CONFIRM-CHAT-01 — /trip-confirmation chat-handoff param guard (#732).
//
// The confirm screen's chat affordances (open-chat / back-to-chat / the «Назад» button) used to
// navigate to a BARE /chat — dropping the tripId + viewer role. chat.js then fell into its demo /
// legacy-`/feed` fallback (resolveChatHydration needs a tripId to findActiveRide; resolveBackHref
// needs an explicit role to return to the ride context) instead of hydrating the ride thread.
// They now thread the known tripId + role via a chatHref() helper.
//
// This pins the param contract so a refactor can't silently regress to a bare /chat.
// Static source analysis only — no DOM, no network.

import fs from 'node:fs';

const screen = fs.readFileSync(new URL('../public/src/screens/trip_confirmation.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

const issues = [];
const expect = (label, cond, detail = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
};

expect('no chat affordance navigates to a bare /chat (params dropped)',
  !/go\(\s*['"`]\/chat['"`]\s*\)/.test(screen));
expect('a chatHref() helper threads the known tripId + viewer role into /chat',
  screen.includes('/chat?tripId=${encodeURIComponent(tripId)}&role=${role}'));
expect('the handoff also threads responseId (passenger) so chat hydrates BEFORE the ride is seeded',
  screen.includes('responseId=${encodeURIComponent(chatResponseId)}')
  && /chatResponseId = role === 'passenger'/.test(screen)
  && /handoff && handoff\.responseId/.test(screen));
expect('open-chat + back-to-chat route through chatHref()',
  /'back-to-chat':\s*\(\) => go\(chatHref\(\)\)/.test(screen)
  && /'open-chat':\s*\(\) => go\(chatHref\(\)\)/.test(screen));
expect('the #cf-back button also threads the params via chatHref (no bare /chat)',
  /#cf-back'\)[\s\S]{0,220}go\(chatHref\(\)\)/.test(screen));
expect('tripId + role are URL-derived, not hard-coded',
  /role = query\.get\('role'\)/.test(screen) && /const tripId = rawTripId \|\|/.test(screen));

// Precached trip_confirmation.js changed → VERSION bumped.
expect('sw.js VERSION bumped to v223+',
  Number((sw.match(/VERSION\s*=\s*'v(\d+)'/) || [])[1] || 0) >= 223);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
