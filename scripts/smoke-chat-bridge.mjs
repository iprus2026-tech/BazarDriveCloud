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
const respond            = read('../public/src/screens/respond.js');
const activeRide         = read('../public/src/screens/active_ride.js');
const activeRidePassenger= read('../public/src/screens/active_ride_passenger.js');
const passengerSheets    = read('../public/src/screens/active_ride_passenger_sheets.js');
const sw                 = read('../public/sw.js');
const rideState          = read('../public/src/ride_state.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── A. chat.js — bridge wiring ───────────────────────────────────
expect("chat.js imports findActiveRide from '../ride_state.js'",
  /import\s*\{[^}]*\bfindActiveRide\b[^}]*\}\s*from\s*'\.\.\/ride_state\.js'/.test(chat));

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

expect("chat.js trip bar still reads trip.status (via resolver-friendly raw extraction)",
  /trip\.status\s*\|\|\s*''/.test(chat));

expect("resolveChatHydration prefers ride.passenger when viewerRole === 'driver'",
  /viewerRole\s*===\s*'driver'[\s\S]{0,80}ride\.passenger/.test(chat));

// ── C. chat.js — back deep-link respects entry point ──────────────
expect("chat.js defines resolveBackHref helper",
  /function\s+resolveBackHref\s*\(/.test(chat));

expect("resolveBackHref returns /active-ride?role= when tripId + hasExplicitRole",
  /return\s+`\/active-ride\?role=\$\{viewerRole\}&tripId=/.test(chat));

expect("chat.js reads `orderId` query param via getRouteParam",
  /getRouteParam\(\s*'orderId'\s*\)/.test(chat));

expect("resolveBackHref returns /responses?orderId= when responseId + orderId are present",
  /return\s+`\/responses\?orderId=\$\{encodeURIComponent\(orderId\)/.test(chat));

expect("resolveBackHref returns /respond?postId= when only response.requestId is known",
  /return\s+`\/respond\?postId=\$\{encodeURIComponent\(response\.requestId\)/.test(chat));

expect("resolveBackHref falls back to '/feed' for demo / legacy URLs",
  /return\s+'\/feed'/.test(chat));

expect("chat.js back button dispatches via resolveBackHref",
  /#chat-back[\s\S]{0,400}resolveBackHref\(/.test(chat));

expect("chat.js back button passes orderId into resolveBackHref",
  /resolveBackHref\(\{[\s\S]{0,200}orderId/.test(chat));

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

// ── F. chat.js — message authorship reader (role-aware) ───────────
expect("chat.js still defines directionForMessage with senderRole-first precedence",
  /function\s+directionForMessage\s*\(/.test(chat) &&
  /isDriverAuthoredMessage\(msg\)/.test(chat));

expect("directionForMessage takes viewerRole and compares the resolved explicit role to viewerRole",
  /function\s+directionForMessage\s*\(\s*msg\s*,\s*viewerRole\s*\)/.test(chat) &&
  /(senderRole|explicitRole)\s*===\s*viewerRole/.test(chat));

expect("createMsgEl threads viewerRole through to directionForMessage",
  /function\s+createMsgEl\s*\(\s*msg\s*,\s*viewerRole\s*\)/.test(chat) &&
  /directionForMessage\(\s*msg\s*,\s*viewerRole\s*\)/.test(chat));

expect("chat.js call sites pass viewerRole into createMsgEl",
  (chat.match(/createMsgEl\(\s*msg\s*,\s*viewerRole\s*\)/g) || []).length >= 2);

expect("chat.js still falls back to legacy msg.dir for pre-senderRole records",
  /msg\.dir\s*===\s*'out'/.test(chat));

// ── F2. chat.js — BD-CHAT-04 legacy dir-only fallback asymmetry guard ──
// Legacy records carry only `dir` (no senderRole / authorRole). The resolver
// must treat dir literally relative to the current viewer (dir='out' = own,
// dir='in' = other), must default unknown/missing dir to the safe 'in' side
// (never falsely attribute a message to the viewer), must not crash on
// missing fields, and must not re-anchor the dir branch by viewer role —
// passenger and driver renderers stay symmetric on the same record.
expect("directionForMessage legacy branch returns 'out' only for explicit dir==='out'",
  /msg\.dir\s*===\s*'out'\s*\?\s*'out'\s*:\s*'in'/.test(chat));

expect("directionForMessage legacy branch defaults unknown/missing dir to safe 'in' (other)",
  /msg\.dir\s*===\s*'out'\s*\?\s*'out'\s*:\s*'in'/.test(chat));

expect("directionForMessage coerces senderRole via String(msg.senderRole || '') so missing fields can't throw",
  /const\s+senderRole\s*=\s*String\(\s*msg\.senderRole\s*\|\|\s*''\s*\)\.trim\(\)/.test(chat));

expect("directionForMessage legacy dir branch does not re-anchor by viewerRole (passenger/driver stay symmetric)",
  (() => {
    const m = chat.match(/function\s+directionForMessage\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
    if (!m) return false;
    const body = m[1];
    const dirLine = body.match(/return\s+msg\.dir\s*===\s*'out'[^\n;]*;/);
    return Boolean(dirLine) && !/viewerRole/.test(dirLine[0]);
  })());

expect("chat.js documents the legacy dir-only fallback rule above directionForMessage",
  /BD-CHAT-04[\s\S]{0,1500}function\s+directionForMessage/.test(chat));

// ── F3. chat.js — BD-CHAT-04 authorRole forward-compatible alias guard ──
// `authorRole` is accepted as a forward-compatible alias for `senderRole`.
// `senderRole` must keep precedence; both fields are gated on
// 'driver'/'passenger' (anything else falls through to the legacy paths);
// the explicit-role branch must run before the driver-auto-notice branch
// and the legacy `dir` fallback.
expect("directionForMessage reads msg.authorRole as a forward-compatible alias",
  /String\(\s*msg\.authorRole\s*\|\|\s*''\s*\)\.trim\(\)/.test(chat));

expect("directionForMessage authorRole branch only accepts 'driver' or 'passenger'",
  /authorRole\s*===\s*'driver'\s*\|\|\s*authorRole\s*===\s*'passenger'/.test(chat)
  || /authorRole\s*===\s*'passenger'\s*\|\|\s*authorRole\s*===\s*'driver'/.test(chat));

expect("directionForMessage gives senderRole precedence over authorRole",
  (() => {
    const m = chat.match(/function\s+directionForMessage\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
    if (!m) return false;
    const body = m[1];
    const senderIdx = body.indexOf('senderRole');
    const authorIdx = body.indexOf('authorRole');
    return senderIdx >= 0 && authorIdx > senderIdx;
  })());

expect("directionForMessage explicit-role branch runs before driver-auto-notice and legacy dir fallback",
  (() => {
    const m = chat.match(/function\s+directionForMessage\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
    if (!m) return false;
    const body = m[1];
    const authorIdx = body.indexOf('authorRole');
    const explicitIdx = body.indexOf('explicitRole');
    const driverAuthoredIdx = body.indexOf('isDriverAuthoredMessage');
    const dirIdx = body.indexOf('msg.dir');
    return authorIdx >= 0
      && explicitIdx > authorIdx
      && driverAuthoredIdx > explicitIdx
      && dirIdx > driverAuthoredIdx;
  })());

expect("directionForMessage routes resolved explicit role through a single viewer comparison",
  /explicitRole\s*===\s*viewerRole\s*\?\s*'out'\s*:\s*'in'/.test(chat));

// ── G0. respond.js — success chat CTA carries role=driver ────────
expect("respond.js success chat CTA opens /chat?responseId=...&role=driver",
  /\/chat\?responseId=\$\{encodeURIComponent\(responseId\)\}&role=driver/.test(respond));

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

// ── J. sw.js — VERSION shape + CACHE_NAME linkage ──
// BD-SW-01 — Pin the SHAPE of the cache contract, not the literal number.
// Every BD-LIFE-XX / BD-CHAT-XX PR that touches a precached file has to
// bump `VERSION` so GitHub Pages picks the new runtime up, and we used to
// pin the exact number here (v95, then v96, …). That made every bump cost
// an extra smoke fix-up and tied a chat-domain smoke to an SW-domain
// version string. Instead, lock the two invariants that actually matter:
//
//   1. VERSION literal matches /^v\d+$/   (`'v123'` shape — the only
//      thing GitHub Pages / sw activate() needs to differ across builds).
//   2. CACHE_NAME derives from VERSION via the `bazardrive-${VERSION}`
//      template literal so the cache name auto-tracks any bump.
//
// Capture the raw VERSION value once and re-use it in the CACHE_NAME
// assertion so the two are checked as a pair, not in isolation.
const swVersionMatch = sw.match(/const\s+VERSION\s*=\s*'(v\d+)'/);
const swVersionValue = swVersionMatch ? swVersionMatch[1] : '';
expect("public/sw.js VERSION has v-number format",
  /^v\d+$/.test(swVersionValue));
expect("public/sw.js CACHE_NAME derives from VERSION",
  /const\s+CACHE_NAME\s*=\s*`bazardrive-\$\{VERSION\}`/.test(sw));

// ── M. ride_state.js — status tone + label exports (BD-CHAT-03) ──
expect("ride_state.js exports RIDE_STATUS_TONE",
  /export\s+const\s+RIDE_STATUS_TONE\s*=/.test(rideState));
expect("ride_state.js exports RIDE_STATUS_LABEL",
  /export\s+const\s+RIDE_STATUS_LABEL\s*=/.test(rideState));
expect("ride_state.js exports resolveRideStatusTone",
  /export\s+function\s+resolveRideStatusTone\s*\(/.test(rideState));
expect("ride_state.js exports resolveRideStatusLabel",
  /export\s+function\s+resolveRideStatusLabel\s*\(/.test(rideState));

// Spot checks: CANCELED/NO_SHOW must NOT map to success.
expect("RIDE_STATUS_TONE.CANCELED === 'danger'",
  /CANCELED:\s*'danger'/.test(rideState));
expect("RIDE_STATUS_TONE.NO_SHOW === 'danger'",
  /NO_SHOW:\s*'danger'/.test(rideState));
expect("RIDE_STATUS_TONE.IN_PROGRESS === 'success'",
  /IN_PROGRESS:\s*'success'/.test(rideState));
expect("RIDE_STATUS_TONE.COMPLETED === 'success'",
  /COMPLETED:\s*'success'/.test(rideState));
expect("RIDE_STATUS_TONE.NEW_ORDER === 'warning'",
  /NEW_ORDER:\s*'warning'/.test(rideState));

// resolveRideStatusTone falls back to 'muted' for non-enum strings (legacy MOCK 'Принят')
expect("resolveRideStatusTone falls back to 'muted'",
  /return\s+RIDE_STATUS_TONE\[status\]\s*\|\|\s*'muted'/.test(rideState));

// ── N. chat.js — dynamic tone, no longer hardcodes --success (BD-CHAT-03) ──
expect("chat.js imports resolveRideStatusTone from ride_state.js",
  /resolveRideStatusTone/.test(chat));
expect("chat.js imports resolveRideStatusLabel from ride_state.js",
  /resolveRideStatusLabel/.test(chat));
expect("chat.js no longer hardcodes inbox-item__status--success on chat__trip-status",
  !/inbox-item__status--success\s+chat__trip-status/.test(chat));
expect("chat.js renders dynamic tone class for chat__trip-status",
  /inbox-item__status--\$\{tone\}\s+chat__trip-status/.test(chat));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
