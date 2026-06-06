// BD-CHAT-02 — static regression smoke for the passenger/driver chat
// bridge. /chat must read `role`, hydrate header + trip bar from the
// canonical ride store when tripId is present (or the response store when
// only responseId is), deep-link back to the originating /active-ride or
// /respond entry point, and stamp outgoing messages with senderRole so the
// driver-side and passenger-side renderers agree on authorship.
//
// All active-ride chat deep-links (driver and passenger sides, including
// the passenger safety sheet) must append &role= so the chat screen can
// pick the right counterpart and back target. This script is intentionally
// STATIC: it reads source files and asserts the contract still holds in
// source — no browser, no DOM, no jsdom, no live storage.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const chat               = read('../public/src/screens/chat.js');
const activeRide         = read('../public/src/screens/active_ride.js');
const activeRidePassenger= read('../public/src/screens/active_ride_passenger.js');
const passengerSheets    = read('../public/src/screens/active_ride_passenger_sheets.js');
const sw                 = read('../public/sw.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── A. chat.js — bridge wiring ───────────────────────────────────
expect("chat.js imports findActiveRide from '../ride_state.js'",
  /import\s*\{\s*findActiveRide\s*\}\s*from\s*'\.\.\/ride_state\.js'/.test(chat));

expect("chat.js reads `role` query param via getRouteParam",
  /getRouteParam\(\s*'role'\s*\)/.test(chat));

expect("chat.js derives viewerRole defaulting to 'passenger'",
  /viewerRole\s*=\s*[^;]*'driver'[\s\S]{0,80}'passenger'/.test(chat));

expect("chat.js tracks hasExplicitRole so legacy ?tripId= URLs keep /feed back-link",
  /hasExplicitRole\s*=/.test(chat));

// ── B. chat.js — hydration: ride store + response fallback + demo ──
expect("chat.js defines resolveChatHydration helper",
  /function\s+resolveChatHydration\s*\(/.test(chat));

expect("resolveChatHydration calls findActiveRide(tripId)",
  /findActiveRide\(\s*tripId\s*\)/.test(chat));

expect("chat.js header binds to counterpart.name (not MOCK_DRIVER.name)",
  /\$\{escapeHtml\(counterpart\.name/.test(chat));

expect("chat.js trip bar binds to trip.from / trip.to / trip.price",
  /\$\{escapeHtml\(trip\.from\)/.test(chat) &&
  /\$\{escapeHtml\(trip\.to\)/.test(chat) &&
  /\$\{escapeHtml\(String\(trip\.price/.test(chat));

expect("chat.js trip bar binds status to trip.status",
  /\$\{escapeHtml\(trip\.status/.test(chat));

expect("resolveChatHydration prefers ride.passenger when viewerRole === 'driver'",
  /viewerRole\s*===\s*'driver'[\s\S]{0,80}ride\.passenger/.test(chat));

// ── C. chat.js — back deep-link respects entry point ──────────────
expect("chat.js defines resolveBackHref helper",
  /function\s+resolveBackHref\s*\(/.test(chat));

expect("resolveBackHref returns /active-ride?role= when tripId + hasExplicitRole",
  /return\s+`\/active-ride\?role=\$\{viewerRole\}&tripId=/.test(chat));

expect("resolveBackHref returns /respond?postId= when response.requestId is known",
  /return\s+`\/respond\?postId=\$\{encodeURIComponent\(response\.requestId\)/.test(chat));

expect("resolveBackHref falls back to '/feed' for demo / legacy URLs",
  /return\s+'\/feed'/.test(chat));

expect("chat.js back button dispatches via resolveBackHref",
  /#chat-back[\s\S]{0,400}resolveBackHref\(/.test(chat));

// ── D. chat.js — outgoing message stamps senderRole ───────────────
expect("chat.js doSend writes senderRole: viewerRole on outgoing messages",
  /senderRole:\s*viewerRole/.test(chat));

expect("chat.js doSend still writes dir: 'out' (legacy fallback)",
  /\{\s*id:[^}]*senderRole:\s*viewerRole[^}]*dir:\s*'out'/.test(chat));

// ── E. chat.js — preserve BD-CHAT-01 confirmation handoff ─────────
expect("chat.js still navigates to /trip-confirmation after confirm (BD-CHAT-01 preserved)",
  /go\(\s*`\/trip-confirmation\?/.test(chat));

expect("chat.js still writes bazardrive.trip_confirmation.v1 (BD-CHAT-01 preserved)",
  /saveTripConfirmation\(/.test(chat));

expect("chat.js still defines resolveRideContext (BD-CHAT-01 CTA gate preserved)",
  /function\s+resolveRideContext\s*\(/.test(chat));

// ── F. chat.js — message authorship reader unchanged ──────────────
expect("chat.js still defines directionForMessage with senderRole-first precedence",
  /function\s+directionForMessage\s*\(/.test(chat) &&
  /isDriverAuthoredMessage\(msg\)/.test(chat));

expect("chat.js still falls back to legacy msg.dir for pre-senderRole records",
  /msg\.dir\s*===\s*'in'/.test(chat));

// ── G. active_ride.js — driver chat CTAs append &role=driver ──────
const driverChatCtas = activeRide.match(/\/chat\?tripId=\$\{encodeURIComponent\(ride\.tripId\)\}[^`]*`/g) || [];
expect("active_ride.js has 4 chat CTAs (msgBtn + accepted + enroute + approaching)",
  driverChatCtas.length === 4, `found ${driverChatCtas.length}`);
for (let i = 0; i < driverChatCtas.length; i++) {
  expect(`active_ride.js chat CTA #${i + 1} appends &role=driver`,
    /&role=driver/.test(driverChatCtas[i]), driverChatCtas[i]);
}

// ── H. active_ride_passenger.js — passenger CTAs append &role=passenger ──
const passengerChatCtas = activeRidePassenger.match(/\/chat\?tripId=\$\{encodeURIComponent\(ride\.tripId\)\}[^`]*`/g) || [];
expect("active_ride_passenger.js has 2 chat deep-links (driver-card + top-card)",
  passengerChatCtas.length === 2, `found ${passengerChatCtas.length}`);
for (let i = 0; i < passengerChatCtas.length; i++) {
  expect(`active_ride_passenger.js chat link #${i + 1} appends &role=passenger`,
    /&role=passenger/.test(passengerChatCtas[i]), passengerChatCtas[i]);
}

// ── I. active_ride_passenger_sheets.js — safety chat appends &role=passenger ──
expect("active_ride_passenger_sheets.js safety-chat link appends &role=passenger",
  /\/chat\?tripId=\$\{encodeURIComponent\(tripId\)\}&role=passenger/.test(passengerSheets));

// ── J. sw.js — VERSION bumped because precached runtime files changed ──
expect("public/sw.js VERSION is bumped to v93",
  /const\s+VERSION\s*=\s*'v93'/.test(sw));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
