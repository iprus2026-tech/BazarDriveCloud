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
const css                = read('../public/styles/cloud.css');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) return '';
  const openParen = source.indexOf('(', start);
  const open = source.indexOf('{', openParen === -1 ? start : openParen);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return '';
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
  /function\s+createMsgEl\s*\(\s*msg\s*,\s*viewerRole\s*,\s*counterpartName\s*\)/.test(chat) &&
  /directionForMessage\(\s*msg\s*,\s*viewerRole\s*\)/.test(chat));

expect("chat.js call sites pass viewerRole + counterpart name into createMsgEl",
  (chat.match(/createMsgEl\(\s*(?:msg|message)\s*,\s*viewerRole\s*,\s*counterpart\.name\s*\)/g) || []).length >= 2);

// ── F4. chat.js — BD-CHAT-01 sender attribution (Cloud Design port, #5) ──
// The in/out side was conveyed by alignment + colour only — invisible to a screen
// reader. createMsgEl now names the sender: role=group + an aria-label, plus a
// visible (aria-hidden, so it isn't read twice) author label on incoming bubbles.
expect("createMsgEl sets role=group + an aria-label naming the sender",
  /setAttribute\(\s*'role'\s*,\s*'group'\s*\)/.test(chat)
  && /setAttribute\(\s*'aria-label'\s*,\s*author\s*\)/.test(chat));
expect("createMsgEl renders a visible (aria-hidden) author label on incoming bubbles",
  /className\s*=\s*'chat__author'/.test(chat)
  && /dir\s*===\s*'in'[\s\S]{0,200}chat__author/.test(chat));
expect("cloud.css defines the .chat__author label atom (Cloud Design port)",
  /\.chat__author\s*\{/.test(css));

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

// ── I2. chat quick-reply chip appends, never overwrites (#732) ──
// Tapping a quick-reply chip must APPEND to whatever the user already typed (separated by a
// space), so it never silently discards a half-written message (BD-CHAT-01 #12).
expect('quick-reply chip appends to the input (does not overwrite typed text)',
  /const appended = existing \+ sep \+ chip\.dataset\.reply/.test(chat)
  && !/inputEl\.value = chip\.dataset\.reply\b/.test(chat));
expect('quick-reply keeps a separating space only when the input is non-empty',
  /const sep = existing && !\/\\s\$\/\.test\(existing\) \? ' ' : ''/.test(chat));
expect('the appended quick reply is clamped to the composer maxlength (programmatic value bypasses it)',
  /Number\(inputEl\.getAttribute\('maxlength'\)\)[\s\S]{0,120}appended\.slice\(0, maxLen\)/.test(chat));

// ── I3. failed-send bubble + retry (#732 BD-CHAT-01 #18) ──
// A failed persist must flag the bubble (visual + AT) with an explicit retry — never render an
// unsaved message as an ordinary delivered one. Notice-only (#6) was the floor, this is the ceiling.
expect('doSend flags the bubble as failed on a failed persist (not notice-only)',
  /else if \(!appendMessage\(chatId, msg\)\) \{[\s\S]{0,140}markSendFailed\(msgEl, msg\)[\s\S]{0,140}showNotice/.test(chat));
expect('markSendFailed adds the failed class + an AT «не отправлено» label + a retry button',
  /classList\.add\('chat__msg--failed'\)/.test(chat)
  && /setAttribute\('aria-label', 'Вы · не отправлено'\)/.test(chat)
  && /className = 'chat__msg-retry'/.test(chat));
expect('the retry re-persists (order-preserving) and clears the failed state on success',
  /retry\.addEventListener\('click'[\s\S]{0,420}persistMessageInOrder\(chatId, msg\)/.test(chat)
  && /retry\.addEventListener\('click'[\s\S]{0,140}clearSendFailed\(msgEl\)/.test(chat));
expect('the retry insert is ordered by id (a retried older message keeps thread order on reload)',
  /function persistMessageInOrder[\s\S]{0,220}Number\(arr\[i - 1\]\.id\) > Number\(msg\.id\)[\s\S]{0,40}splice\(i, 0, msg\)/.test(chat));
expect('cloud.css styles the failed bubble + the retry control',
  /\.chat__msg--failed \.chat__bubble\s*\{/.test(css) && /\.chat__msg-retry\s*\{/.test(css));

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

// ── O. chat.js — BD-CHAT-01 empty / first-message thread (Cloud Design port) ──
// A real thread (trip/response) with no stored messages must render the designed
// empty state, NOT the fabricated MOCK_MESSAGES conversation; the demo thread
// (chatId === 'demo') keeps the mock as a showcase.
expect("chat.js gates MOCK_MESSAGES on the demo thread (real empty threads get [])",
  /const\s+isRealThread\s*=\s*chatId\s*!==\s*'demo'/.test(chat)
  && /isRealThread\s*\?\s*\[\]\s*:\s*MOCK_MESSAGES/.test(chat));
expect("chat.js defines renderEmptyThread and renders it for a real empty thread",
  /function\s+renderEmptyThread\s*\(/.test(chat)
  && /nextState === CHAT_READ_STATE\.EMPTY[\s\S]{0,120}renderEmptyThread\(viewerRole,\s*confirmed\)/.test(chat));
expect("chat.js empty state carries role-specific copy (no fabricated history)",
  /Сообщений пока нет/.test(chat) && /chat__empty-title/.test(chat));
expect("cloud.css defines the .chat__empty atoms (Cloud Design port)",
  /\.chat__empty\s*\{/.test(css) && /\.chat__empty-title\s*\{/.test(css) && /\.chat__empty-ic\s*\{/.test(css));

// ── P. chat.js — BD-CHAT-FALLBACK-01/02 no false "Принят" without a real ride (#891, Codex P2 repair) ──
// A chat opened for a tripId/responseId that resolves to no real ride and no
// stored response (e.g. /chat?tripId=<feed-post-id> for a post that was never
// ordered/accepted) must not claim the order was accepted — neither in the
// header status pill nor in the empty-thread system pill. A genuine backing
// ride keeps its historical 'Принят' + confirmed:true via two SYNCHRONOUS
// routes: (a) findActiveRide(tripId) hit, (b) trip_${orderId} with a
// matching selectedDriver.responseId (Finding 1). A third, server-backed
// route (c) — tripId + explicit &role= + a live backend, local-store miss
// (Finding 2) — never asserts confirmed:true synchronously: it starts
// confirmed:false + pendingBackendConfirm:true, and chat() only upgrades to
// confirmed:true + the real ride's own status after getRideFromBackend(tripId)
// resolves successfully (404/403/network failure/abort all leave it
// confirmed:false — see the behavioral block below).
// functionBody() mis-scopes resolveChatHydration: its destructured parameter
// `({ tripId, responseId, ... })` opens a `{` before the real body does, so
// the brace-matcher stops at the parameter's own closing `}`. Slice to the
// next top-level function declaration instead.
const resolveChatHydrationStart = chat.indexOf('function resolveChatHydration(');
const resolveChatHydrationBody = chat.slice(
  resolveChatHydrationStart,
  chat.indexOf('function resolveBackHref(', resolveChatHydrationStart));
const resolveFixtureHydrationBody = functionBody(chat, 'resolveFixtureHydration');
const hydrateFromRealRideBody = functionBody(chat, 'hydrateFromRealRide');
expect("hydrateFromRealRide is the single shared real-ride hydration shape (status: ride.status || 'Принят')",
  /status:\s*ride\.status\s*\|\|\s*'Принят'/.test(hydrateFromRealRideBody)
  && /return\s*\{\s*counterpart,\s*trip,\s*counterpartRole\s*\}/.test(hydrateFromRealRideBody));
expect("resolveChatHydration's tripId real-ride branch delegates to hydrateFromRealRide with confirmed:true (behaviorally unchanged contract)",
  /if\s*\(ride\)\s*\{\s*return\s*\{\s*\.\.\.hydrateFromRealRide\(ride,\s*viewerRole\),\s*response:\s*null,\s*confirmed:\s*true\s*\}/.test(resolveChatHydrationBody));
expect("resolveChatHydration's server-backed local-miss branch requires BOTH hasExplicitRole AND isBackendEnabled() — neither alone is sufficient (Finding 2)",
  /if\s*\(hasExplicitRole\s*&&\s*isBackendEnabled\(\)\)/.test(resolveChatHydrationBody)
  && !/hasExplicitRole\s*\|\|\s*isBackendEnabled\(\)/.test(resolveChatHydrationBody));
expect("resolveChatHydration's server-backed local-miss branch does NOT assert confirmed:true or 'Принят' synchronously — it returns confirmed:false + pendingBackendConfirm:true and a neutral status, deferring to chat()'s async backend read",
  /if\s*\(tripId\)\s*\{[\s\S]*?if\s*\(hasExplicitRole\s*&&\s*isBackendEnabled\(\)\)\s*\{[\s\S]{0,300}status:\s*'Не подтверждено'[\s\S]{0,60}\}[\s\S]{0,60}confirmed:\s*false[\s\S]{0,60}pendingBackendConfirm:\s*true/.test(resolveChatHydrationBody));
expect("resolveChatHydration's responseId+orderId branch looks up trip_${orderId} and confirms ONLY on an exact selectedDriver.responseId match (Finding 1)",
  /findActiveRide\(`trip_\$\{orderId\}`\)/.test(resolveChatHydrationBody)
  && /existingRide\.selectedDriver\s*&&\s*existingRide\.selectedDriver\.responseId\s*===\s*responseId/.test(resolveChatHydrationBody)
  && /return\s*\{\s*\.\.\.hydrateFromRealRide\(existingRide,\s*viewerRole\),\s*response:\s*null,\s*confirmed:\s*true\s*\}/.test(resolveChatHydrationBody));
expect("hydrateFromRealRide is reused (not duplicated) by exactly the two SYNCHRONOUS real-ride call sites in resolveChatHydration (the async server-confirm path reuses it separately, inside chat()'s applyConfirmedRide)",
  (resolveChatHydrationBody.match(/hydrateFromRealRide\(/g) || []).length === 2);
expect("resolveChatHydration marks confirmed:false with a neutral status in all three non-affirming paths (pending server-confirm, responseId-only mismatch, generic fallback)",
  (resolveChatHydrationBody.match(/confirmed: false/g) || []).length === 3
  && (resolveChatHydrationBody.match(/status:\s*'Не подтверждено'/g) || []).length === 3);
expect("resolveFixtureHydration (canonical preview) keeps its historical 'Принят' + confirmed:true unchanged",
  /status:\s*'Принят'/.test(resolveFixtureHydrationBody)
  && /confirmed:\s*true/.test(resolveFixtureHydrationBody));
expect("renderEmptyThread's system pill reflects confirmed (no unconditional 'Заказ принят')",
  /pill\.textContent\s*=\s*confirmed\s*\?\s*'Заказ принят'\s*:\s*'Не подтверждено'/.test(chat));
expect("chat() extracts orderId and hasExplicitRole and forwards both into resolveChatHydration",
  /const\s+orderId\s*=\s*getRouteParam\('orderId'\)/.test(chat)
  && /const\s+hasExplicitRole\s*=\s*rawRole\s*===\s*'driver'\s*\|\|\s*rawRole\s*===\s*'passenger'/.test(chat)
  && /const hydration = fixture\s*\? resolveFixtureHydration\(viewerRole\)\s*: resolveChatHydration\(\{ tripId, responseId, orderId, viewerRole, hasExplicitRole \}\)/.test(chat));
expect("chat() derives confirmed from hydration (let, not const — applyConfirmedRide may flip it after an async backend confirm) and forwards it to renderEmptyThread",
  /let\s+confirmed\s*=\s*hydration\.confirmed\s*!==\s*false/.test(chat));

// ── Q. chat.js — BD-CHAT-FALLBACK-02 async backend ride-confirm wiring (#891 Codex P2 Finding 2) ──
// resolveChatHydration only DECIDES a server ride is worth asking about
// (pendingBackendConfirm); this section pins that chat() actually performs
// that one-shot ask via the existing, already-tested getRideFromBackend
// (no new endpoint), never upgrades confirmed on a failed/aborted read, and
// tears the in-flight request down on unmount.
expect("chat.js imports the existing getRideFromBackend from mock_api.js (no new backend endpoint)",
  /import\s*\{\s*getRideFromBackend\s*\}\s*from\s*'\.\.\/mock_api\.js'/.test(chat));
expect("confirmRideFromBackend calls getRideFromBackend(tripId, ...) inside try/catch and sets srv=null on ANY failure (404/403/network/abort) — never fabricates a confirmed ride on error",
  /async function confirmRideFromBackend\(\)/.test(chat)
  && /srv = await getRideFromBackend\(tripId, \{ signal: controller\.signal \}\)/.test(chat)
  && /\} catch \{[\s\S]{0,220}srv = null;/.test(chat));
expect("confirmRideFromBackend only calls applyConfirmedRide when the read actually returned a server ride (if (srv) applyConfirmedRide(srv);) — no unconditional upgrade",
  /if \(srv\) applyConfirmedRide\(srv\);/.test(chat));
expect("applyConfirmedRide reuses hydrateFromRealRide (the same shape as the two synchronous real-ride branches) and only then sets confirmed = true",
  /function applyConfirmedRide\(srv\) \{\s*const real = hydrateFromRealRide\(srv, viewerRole\);\s*confirmed = true;/.test(chat));
expect("applyConfirmedRide updates the SAME DOM hooks the initial template renders with (avatar/name/meta/route-text/status-pill/price/meta), not a parallel markup shape",
  /root\.querySelector\('\.chat__avatar'\)/.test(chat)
  && /root\.querySelector\('\.chat__driver-name'\)/.test(chat)
  && /root\.querySelector\('\.chat__driver-meta'\)/.test(chat)
  && /root\.querySelector\('\.chat__trip-route-text'\)/.test(chat)
  && /root\.querySelector\('\.chat__trip-status'\)/.test(chat)
  && /root\.querySelector\('\.chat__trip-price'\)/.test(chat)
  && /root\.querySelector\('\.chat__trip-meta'\)/.test(chat)
  && /<span class="chat__trip-route-text">/.test(chat));
expect("applyConfirmedRide re-renders the empty-thread pill (via the same renderEmptyThread + confirmed contract) when the thread is still showing it",
  /if \(readState === CHAT_READ_STATE\.EMPTY\) \{\s*messagesEl\.replaceChildren\(renderEmptyThread\(viewerRole, confirmed\)\);/.test(chat));
expect("chat() kicks off confirmRideFromBackend exactly once, gated on hydration.pendingBackendConfirm",
  (chat.match(/void confirmRideFromBackend\(\);/g) || []).length === 1
  && /if \(hydration\.pendingBackendConfirm\) void confirmRideFromBackend\(\);/.test(chat));
expect("teardownReads aborts an in-flight rideConfirmController (no orphaned fetch after the screen unmounts)",
  /function teardownReads\(\) \{[\s\S]{0,220}if \(rideConfirmController\) \{\s*rideConfirmController\.abort\(\);\s*rideConfirmController = null;/.test(chat));
expect("chat.js exports resolveChatHydration and hydrateFromRealRide as named exports for behavioral testing (smoke-chat-ride-confirm-behavioral.mjs)",
  /export \{ resolveChatHydration, hydrateFromRealRide \};/.test(chat));

// ── G. chat.js — BD-CHAT-01 terminal read-only state (Cloud Design port, #2) ──
// A completed / canceled / no-show trip must lock the composer to read-only:
// disable the input + send, drop the quick replies, and show a "trip ended" note.
expect("ride_state.js exports isTerminalRideStatus (canonical terminal check)",
  /export\s+function\s+isTerminalRideStatus\s*\(/.test(rideState));
expect("chat.js imports isTerminalRideStatus from ride_state.js",
  /import\s*\{[\s\S]*?\bisTerminalRideStatus\b[\s\S]*?\}\s*from\s*'\.\.\/ride_state\.js'/.test(chat));
expect("chat.js computes isTerminal from trip.status via isTerminalRideStatus",
  /const\s+isTerminal\s*=\s*isTerminalRideStatus\(\s*trip\.status\s*\)/.test(chat));
expect("chat.js locks the composer read-only on a terminal trip (disable input/send + note)",
  /if\s*\(\s*isTerminal\s*\)[\s\S]{0,400}inputEl\.disabled\s*=\s*true[\s\S]{0,220}chat__readonly-note/.test(chat));
expect("chat.js drops the quick replies on a terminal trip",
  /for\s*\(\s*const\s+reply\s+of\s*\(\s*isTerminal\s*\?\s*\[\]\s*:\s*QUICK_REPLIES\s*\)\s*\)/.test(chat));
expect("cloud.css defines .chat__readonly-note + .chat__composer--locked (Cloud Design port)",
  /\.chat__readonly-note\s*\{/.test(css) && /\.chat__composer--locked\s*\{/.test(css));

// ── H. chat.js — send returns focus to the input (#4, a11y) ──────────
// A click-send disables the (focused) send button, which would otherwise drop
// focus to <body>; doSend must end by returning focus to the input so keyboard /
// screen-reader users keep their place. (Same pattern smoke-passenger-active-ride
// pins for the in-ride safety report submit.)
expect("chat.js doSend returns focus to the input after sending (no focus drop to body)",
  /function\s+doSend[\s\S]*?updateSend\(\)[\s\S]{0,400}inputEl\.focus\(\)/.test(chat));

// ── I. chat.js — message-write robustness (#6 silent-swallow + #7 clobber) ──
// #7: the send path appends to a FRESH read of the store (not a stale full-array
// overwrite), so a concurrent same-thread write from another tab is preserved.
// #6: a failed write returns false and is surfaced to the user, not swallowed.
expect("chat.js appendMessage re-reads the store and pushes a single record (no stale full-array clobber, #7)",
  /function\s+appendMessage\s*\(\s*chatId\s*,\s*msg\s*\)[\s\S]*?loadChatStore\(\)[\s\S]{0,220}\.push\(\s*msg\s*\)/.test(chat));
const appendMessageBody = functionBody(chat, 'appendMessage') || '';
const saveMessagesBody = functionBody(chat, 'saveMessages') || '';
expect("chat.js appendMessage returns true on write, false on failure (no silent swallow, #6)",
  /return\s+true[\s\S]{0,80}catch[\s\S]{0,40}return\s+false/.test(appendMessageBody)
  || (
    /const\s+store\s*=\s*loadChatStore\(\)/.test(appendMessageBody)
    && /const\s+arr\s*=\s*Array\.isArray\(store\[chatId\]\)\s*\?\s*store\[chatId\]\.slice\(\)\s*:\s*\[\]/.test(appendMessageBody)
    && /arr\.push\(\s*msg\s*\)/.test(appendMessageBody)
    && /return\s+saveMessages\(\s*chatId\s*,\s*arr\s*,\s*store\s*\)/.test(appendMessageBody)
    && saveMessagesBody.length > 0
    && /const\s+next\s*=\s*\{\s*\.\.\.store\s*\}/.test(saveMessagesBody)
    && /next\[chatId\]\s*=\s*messages/.test(saveMessagesBody)
    && /localStorage\.setItem\(\s*CHAT_KEY\s*,\s*JSON\.stringify\(next\)\s*\)/.test(saveMessagesBody)
    && /return\s+true/.test(saveMessagesBody)
    && /catch\s*\{[\s\S]*?return\s+false/.test(saveMessagesBody)
  ));
expect("chat.js doSend surfaces a failed message write to the user via showNotice (#6)",
  /else if \(!appendMessage\(chatId, msg\)\) \{[\s\S]{0,160}showNotice\(/.test(chat));

// ── I4. #784 chat cutover — a real thread on a live backend reads/sends the shared server
// thread via apiFetch (behind isBackendEnabled), while the local-storage path stays the fallback. ──
expect('chat.js routes the chat thread through apiFetch when the backend is enabled (#784 cutover)',
  /const backendRead = !fixture && isBackendEnabled\(\) && isRealThread/.test(chat)
  && /apiFetch\(`\/chat\/messages\?chatId=/.test(chat)
  && /postServerMessage\(chatId, msg\)/.test(chat));
expect('chat.js poll appends incrementally (no wholesale repaint) — preserves optimistic/failed bubbles',
  /const rendered = new Set\(\)/.test(chat)
  && /if \(rendered\.has\(keyOf\(message\)\)\) return null/.test(chat)
  && /if \(grew && wasNear\) scrollBottom\(\)/.test(chat));
expect('chat.js dedupe key includes senderRole (server distinguishes same clientMsgId across roles)',
  /const keyOf = \(message\) => `\$\{message\.senderRole/.test(chat));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
