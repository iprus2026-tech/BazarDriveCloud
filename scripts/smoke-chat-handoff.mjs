// BD-CHAT-HANDOFF-01 — static regression smoke for the chat → trip-confirmation
// → active-ride → driver-handoff chain.
//
// The passenger flow must walk a strict path and must NOT shortcut
// /chat → /active-ride:
//
//   /chat?responseId=…                       (passenger_response only)
//     → "Подтвердить поездку" (#chat-confirm)
//     → write handoff to bazardrive.trip_confirmation.v1
//     → go('/trip-confirmation?…&state=CONFIRMED')
//     → trip-confirmation trusts only a FRESH, role-matching handoff
//     → passenger CTA seeds bazardrive.active_ride.v1 + go('/active-ride?role=passenger…')
//     → driver CTA saves a driver handoff snapshot + go('/active-ride?role=driver…')
//
// All of that lives only in source — no executable guard pinned it, so a
// refactor could silently re-open the /chat → /active-ride shortcut, drop the
// handoff write, weaken the fresh/role-matching check, or shrink the driver
// snapshot, and `node scripts/check.mjs` would still pass.
//
// This script is intentionally STATIC: it reads the five source files and
// asserts the contract still holds in source. No browser, no DOM, no jsdom,
// no Playwright, no real localStorage/timers/network — only file reads and
// source assertions.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const app          = read('../public/src/app.js');
const chat         = read('../public/src/screens/chat.js');
const tripConfirm  = read('../public/src/screens/trip_confirmation.js');
const handoff      = read('../public/src/screens/trip_confirmation_handoff.js');
const activeRide   = read('../public/src/screens/active_ride.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// Extract a function body by name via brace matching, so an assertion
// scoped to one function doesn't accidentally inspect another. Skips the
// parameter list first so an object-default param is not mistaken for the
// body's opening brace.
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) return null;
  const paren = source.indexOf('(', start);
  if (paren === -1) return null;
  let pdepth = 0;
  let afterParams = -1;
  for (let i = paren; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') pdepth++;
    else if (ch === ')') {
      pdepth--;
      if (pdepth === 0) { afterParams = i + 1; break; }
    }
  }
  if (afterParams === -1) return null;
  const open = source.indexOf('{', afterParams);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

// Capture the first object-literal `{ ... }` argument passed to `name(`.
// The call sites guarded here pass a flat object (no nested braces), so a
// non-greedy match to the first `})` is exact.
function callObjectArg(source, name) {
  const m = source.match(new RegExp(`${name}\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`));
  return m ? m[1] : null;
}

// ── A. app.js wiring ─────────────────────────────────────────
expect('app.js imports chat from ./screens/chat.js',
  /import\s+chat\s+from\s+'\.\/screens\/chat\.js'/.test(app));
expect('app.js imports tripConfirmation from ./screens/trip_confirmation.js',
  /import\s+tripConfirmation\s+from\s+'\.\/screens\/trip_confirmation\.js'/.test(app));
expect('app.js imports activeRide from ./screens/active_ride.js',
  /import\s+activeRide\s+from\s+'\.\/screens\/active_ride\.js'/.test(app));
expect("app.js registers register('/chat', chat)",
  /register\(\s*'\/chat'\s*,\s*chat\s*\)/.test(app));
expect("app.js registers register('/trip-confirmation', tripConfirmation)",
  /register\(\s*'\/trip-confirmation'\s*,\s*tripConfirmation\s*\)/.test(app));
expect("app.js registers register('/active-ride', activeRide)",
  /register\(\s*'\/active-ride'\s*,\s*activeRide\s*\)/.test(app));

// ── B. chat.js — keys + passenger-only CTA + handoff write ───
expect('chat.js declares CHAT_KEY', /const\s+CHAT_KEY\s*=/.test(chat));
expect('chat.js declares RESPONSES_KEY', /const\s+RESPONSES_KEY\s*=/.test(chat));
expect("chat.js TRIP_CONFIRM_KEY === 'bazardrive.trip_confirmation.v1'",
  /const\s+TRIP_CONFIRM_KEY\s*=\s*'bazardrive\.trip_confirmation\.v1'/.test(chat));
expect('chat.js declares HANDOFF_TTL_MS', /const\s+HANDOFF_TTL_MS\s*=/.test(chat));

const rideCtxBody = functionBody(chat, 'resolveRideContext');
expect('chat.js resolveRideContext() resolved', !!rideCtxBody);
expect("resolveRideContext gates CTA on kind === 'passenger_response'",
  /kind\s*===\s*'passenger_response'/.test(rideCtxBody || ''));
expect('resolveRideContext gates CTA on response.tripId',
  /response\.tripId/.test(rideCtxBody || ''));
// BD-CHAT-01 fix — the passenger-only «Подтвердить поездку» CTA must NOT render on a
// driver thread (/chat?responseId=…&role=driver stores the same passenger_response),
// so resolveRideContext also gates on viewerRole, threaded from the call site.
expect("resolveRideContext also gates the CTA on viewerRole !== 'driver'",
  /viewerRole\s*!==\s*'driver'/.test(rideCtxBody || ''));
// Pin the actual CALL SITE (the `const rideContext = …` assignment), not the
// declaration — `resolveRideContext({ … viewerRole … })` alone also matches the
// function signature, so a call that regressed to `resolveRideContext({ responseId })`
// (viewerRole undefined → gate passes for everyone, driver CTA bug returns) would
// otherwise keep this green. Codex #697.
expect('chat.js threads viewerRole into the resolveRideContext CALL site',
  /const\s+rideContext\s*=\s*resolveRideContext\(\s*\{[^}]*viewerRole[^}]*\}\s*\)/.test(chat));

const confirmArg = callObjectArg(chat, 'saveTripConfirmation');
expect('chat.js #chat-confirm calls saveTripConfirmation({…})', !!confirmArg);
expect("handoff write includes tripId", /\btripId\s*:/.test(confirmArg || ''));
expect("handoff write includes responseId", /\bresponseId\s*:/.test(confirmArg || ''));
expect("handoff write sets role: 'passenger'", /\brole\s*:\s*'passenger'/.test(confirmArg || ''));
expect("handoff write sets state: 'CONFIRMED'", /\bstate\s*:\s*'CONFIRMED'/.test(confirmArg || ''));
expect("handoff write includes createdAt", /\bcreatedAt\s*:/.test(confirmArg || ''));
expect("handoff write includes expiresAt", /\bexpiresAt\s*:/.test(confirmArg || ''));
expect('chat.js #chat-confirm hook present', /#chat-confirm/.test(chat));
expect('chat.js navigates to /trip-confirmation after confirm',
  /go\(\s*`\/trip-confirmation\?/.test(chat));
expect('chat.js NEVER navigates directly to /active-ride',
  !/go\([^)]*\/active-ride/.test(chat));

// ── C. trip_confirmation.js — fresh handoff + role-split CTAs ─
expect('trip_confirmation.js imports seedActiveRideFromConfirmedHandoff',
  /import\s*\{[\s\S]*?seedActiveRideFromConfirmedHandoff[\s\S]*?\}\s*from\s*'\.\/trip_confirmation_handoff\.js'/.test(tripConfirm));
expect('trip_confirmation.js imports saveDriverHandoffSnapshot',
  /import\s*\{\s*saveDriverHandoffSnapshot\s*\}\s*from\s*'\.\/driver_handoff_snapshot\.js'/.test(tripConfirm));

const resolveStateBody = functionBody(tripConfirm, 'resolveState');
expect('trip_confirmation.js resolveState() resolved', !!resolveStateBody);
expect("resolveState CONFIRMED branch requires handoff.state === 'CONFIRMED'",
  /handoff\.state\s*===\s*'CONFIRMED'/.test(resolveStateBody || ''));
expect('resolveState CONFIRMED branch requires handoff.role === role',
  /handoff\.role\s*===\s*role/.test(resolveStateBody || ''));

const goPassBody = functionBody(tripConfirm, 'goActiveRidePassenger');
expect('trip_confirmation.js goActiveRidePassenger() resolved', !!goPassBody);
expect("goActiveRidePassenger seeds via seedActiveRideFromConfirmedHandoff({ tripId, role: 'passenger' })",
  /seedActiveRideFromConfirmedHandoff\(\s*\{\s*tripId\s*,\s*role\s*:\s*'passenger'\s*\}\s*\)/.test(goPassBody || ''));
expect('goActiveRidePassenger navigates to /active-ride?role=passenger…DRIVER_EN_ROUTE',
  /go\(\s*`\/active-ride\?role=passenger[\s\S]*?DRIVER_EN_ROUTE/.test(goPassBody || ''));

const goDriverBody = functionBody(tripConfirm, 'goActiveRideDriver');
expect('trip_confirmation.js goActiveRideDriver() resolved', !!goDriverBody);
expect("goActiveRideDriver seeds via seedActiveRideFromConfirmedHandoff({ tripId, role: 'driver' })",
  /seedActiveRideFromConfirmedHandoff\(\s*\{\s*tripId\s*,\s*role\s*:\s*'driver'\s*\}\s*\)/.test(goDriverBody || ''));
expect('goActiveRideDriver calls saveDriverHandoffSnapshot(…)',
  /saveDriverHandoffSnapshot\(/.test(goDriverBody || ''));
expect('goActiveRideDriver navigates to /active-ride?role=driver…DRIVER_EN_ROUTE',
  /go\(\s*`\/active-ride\?role=driver[\s\S]*?DRIVER_EN_ROUTE/.test(goDriverBody || ''));
// tripId is written as a shorthand property (`tripId,`); the rest use
// `key: value`. Accept either form so the check tracks the real snapshot.
for (const key of ['tripId', 'orderId', 'passengerName', 'pickupLabel', 'dropoffLabel', 'agreedPrice', 'etaText']) {
  expect(`driver snapshot includes ${key}`,
    new RegExp(`\\b${key}\\s*[:,]`).test(goDriverBody || ''));
}
expect("driver snapshot sets status: 'DRIVER_EN_ROUTE'",
  /\bstatus\s*:\s*'DRIVER_EN_ROUTE'/.test(goDriverBody || ''));

// ── D. trip_confirmation_handoff.js — load/seed/canonical contract ──
expect('handoff imports RIDE_STATUS, findActiveRide from ../ride_state.js',
  /import\s*\{[\s\S]*?RIDE_STATUS[\s\S]*?findActiveRide[\s\S]*?\}\s*from\s*'\.\.\/ride_state\.js'/.test(handoff));
// BD-RIDE-AUTHORITY-01B — a real handoff resolves through responses.js's
// own mapping (never re-derived here).
// BD-RIDE-AUTHORITY-01C — construction moved to the pure
// buildPassengerRideSeed (ride_seed.js); this module still borrows
// resolveResponseById/requestFromOrder/mapResponseToDriverCard from
// responses.js (a known, deferred screen-to-screen dependency) but no
// longer imports the side-effecting buildPassengerActiveRide.
expect('handoff imports the real-resolution primitives from ./responses.js (no buildPassengerActiveRide)',
  /import\s*\{[\s\S]*?resolveResponseById[\s\S]*?requestFromOrder[\s\S]*?mapResponseToDriverCard[\s\S]*?\}\s*from\s*'\.\/responses\.js'/.test(handoff)
  && !/buildPassengerActiveRide\(/.test(handoff));
expect('handoff imports the pure buildPassengerRideSeed from ../ride_seed.js',
  /import\s*\{\s*buildPassengerRideSeed\s*\}\s*from\s*'\.\.\/ride_seed\.js'/.test(handoff));

const loadConfBody = functionBody(handoff, 'loadConfirmedHandoff');
expect('handoff loadConfirmedHandoff() resolved', !!loadConfBody);
expect("loadConfirmedHandoff rejects state !== 'CONFIRMED'",
  /state\s*!==\s*'CONFIRMED'/.test(loadConfBody || ''));
expect('loadConfirmedHandoff rejects expired (isHandoffExpired)',
  /isHandoffExpired\(/.test(loadConfBody || ''));
expect('loadConfirmedHandoff rejects role mismatch when role passed',
  /role\s*&&\s*handoff\.role\s*!==\s*role/.test(loadConfBody || ''));

const buildSeedBody = functionBody(handoff, 'buildActiveRideSeed');
expect('handoff buildActiveRideSeed() resolved', !!buildSeedBody);
expect('buildActiveRideSeed status is RIDE_STATUS.DRIVER_EN_ROUTE',
  /status\s*:\s*RIDE_STATUS\.DRIVER_EN_ROUTE/.test(buildSeedBody || ''));

const seedBody = functionBody(handoff, 'seedActiveRideFromConfirmedHandoff');
expect('handoff seedActiveRideFromConfirmedHandoff() resolved', !!seedBody);
expect('seedActiveRideFromConfirmedHandoff does NOT overwrite existing active ride',
  /findActiveRide\(/.test(seedBody || '') && /if\s*\(\s*existing\s*\)\s*return\s+existing/.test(seedBody || ''));
// BD-RIDE-AUTHORITY-01B — a real handoff resolves via the
// seedRealActiveRideFromHandoff delegate; no MOCK_* fallback in between.
// BD-RIDE-AUTHORITY-01C — construction goes through the pure
// buildPassengerRideSeed; this module persists the result itself
// (saveActiveRide) instead of relying on buildPassengerActiveRide's
// internal save. It DOES call acceptOrder (conditionally, if-CREATED,
// restored by the 01C closure) — the canonical chat-confirm chain
// (respond.js/chat.js/trip_confirmation.js) never accepts the order
// itself, so this is the only place left that can before persisting a
// DRIVER_EN_ROUTE ride.
expect('seedActiveRideFromConfirmedHandoff delegates real resolution to seedRealActiveRideFromHandoff(…)',
  /seedRealActiveRideFromHandoff\(/.test(seedBody || ''));
expect('seedActiveRideFromConfirmedHandoff never calls buildActiveRideSeed (no silent MOCK_* fallback)',
  !/buildActiveRideSeed\(/.test(seedBody || ''));
const seedRealBody = functionBody(handoff, 'seedRealActiveRideFromHandoff');
expect('handoff seedRealActiveRideFromHandoff() resolved', !!seedRealBody);
expect('seedRealActiveRideFromHandoff builds via the pure buildPassengerRideSeed(…)',
  /buildPassengerRideSeed\(/.test(seedRealBody || ''));
expect('seedRealActiveRideFromHandoff persists via saveActiveRide(…) itself',
  /saveActiveRide\(/.test(seedRealBody || ''));
expect('seedRealActiveRideFromHandoff accepts the order if still CREATED, before building the ride',
  /order\.status\s*===\s*'CREATED'\s*\?\s*acceptOrder\(/.test(seedRealBody || ''));
expect('seedRealActiveRideFromHandoff never calls the side-effecting buildPassengerActiveRide(…)',
  !/buildPassengerActiveRide\(/.test(seedRealBody || ''));

const canonBody = functionBody(handoff, 'loadCanonicalActiveRide');
expect('handoff loadCanonicalActiveRide() resolved', !!canonBody);
expect('loadCanonicalActiveRide reads existing active ride first (findActiveRide)',
  /findActiveRide\(/.test(canonBody || ''));
expect('loadCanonicalActiveRide then seeds current role ({ tripId, role })',
  /seedActiveRideFromConfirmedHandoff\(\s*\{\s*tripId\s*,\s*role\s*\}\s*\)/.test(canonBody || ''));
expect('loadCanonicalActiveRide then cross-role seeds ({ tripId, role: otherRole })',
  /seedActiveRideFromConfirmedHandoff\(\s*\{\s*tripId\s*,\s*role\s*:\s*otherRole\s*\}\s*\)/.test(canonBody || ''));
{
  const b = canonBody || '';
  const iExisting = b.indexOf('findActiveRide(');
  const iSelf = b.search(/seedActiveRideFromConfirmedHandoff\(\s*\{\s*tripId\s*,\s*role\s*\}/);
  const iCross = b.search(/seedActiveRideFromConfirmedHandoff\(\s*\{\s*tripId\s*,\s*role\s*:\s*otherRole/);
  expect('loadCanonicalActiveRide order: existing → current-role → cross-role',
    iExisting !== -1 && iSelf !== -1 && iCross !== -1 && iExisting < iSelf && iSelf < iCross,
    `existing=${iExisting} self=${iSelf} cross=${iCross}`);
}

// ── E. active_ride.js — consumes the handoff, role-split renderers ──
expect('active_ride.js imports loadCanonicalActiveRide',
  /import\s*\{\s*loadCanonicalActiveRide\s*\}\s*from\s*'\.\/trip_confirmation_handoff\.js'/.test(activeRide));
expect('active_ride.js imports loadDriverHandoffSnapshot + applyDriverHandoffSnapshotToRide',
  /import\s*\{[\s\S]*?loadDriverHandoffSnapshot[\s\S]*?applyDriverHandoffSnapshotToRide[\s\S]*?\}\s*from\s*'\.\/driver_handoff_snapshot\.js'/.test(activeRide));
expect('active_ride.js imports activeRidePassenger',
  /import\s+activeRidePassenger\s+from\s+'\.\/active_ride_passenger\.js'/.test(activeRide));
expect('active_ride.js passenger branch is a separate renderer (renderPassenger → activeRidePassenger)',
  /function\s+renderPassenger\s*\(/.test(activeRide) && /return\s+activeRidePassenger\(/.test(activeRide));
expect('active_ride.js driver branch reads the driver handoff snapshot',
  /loadDriverHandoffSnapshot\(\s*tripId\s*\)/.test(activeRide) && /applyDriverHandoffSnapshotToRide\(/.test(activeRide));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
