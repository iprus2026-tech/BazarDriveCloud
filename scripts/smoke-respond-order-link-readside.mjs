// BD-RESPOND-ORDER-LINK-READSIDE-GUARD-01 — static regression guard for the
// /responses read-side canonical response integration (issue #369,
// BD-RESPOND-ORDER-LINK-02). The read-side mirror of
// scripts/smoke-respond-order-link.mjs (the write-side guard, #367/#368).
//
// PR2 makes public/src/screens/responses.js surface the real passenger_response
// records that /respond stores in bazardrive.responses.v1, keyed by the
// canonical orderId pinned in PR1 (#368), while preserving the in-file
// MOCK_DRIVERS fallback. This guard pins exactly that contract on responses.js
// (and nothing else):
//
//   read:      /responses reads the keyed bazardrive.responses.v1 store.
//   filter:    only kind==='passenger_response' rows whose orderId matches the
//              current canonical order are surfaced.
//   map:       a real response maps into the existing responses__driver card
//              shape, carrying a REAL responseId (so /chat?responseId resolves
//              the handoff), price from driverPrice and note from message.
//   fallback:  MOCK_DRIVERS stays the board for every fallback path — no
//              orderId, no real response, legacy postId, fallback/QA request.
//   read-only: /responses never writes responses.v1, and the read-side helpers
//              never mutate the canonical ride-order store (no createRideOrder /
//              acceptNearbyOrder / updateTripStatus).
//   keep-accept: the canonical order read (getOrderById) and the accept →
//              active-ride handoff (buildPassengerActiveRide) are still present.
//
// Intentionally STATIC: reads source and asserts the contract — no DOM, no
// browser, no network, no public/* runtime changes. Mirrors the helpers of
// scripts/smoke-respond-order-link.mjs so the two guards read the same way.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const responses = read('../public/src/screens/responses.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// Extract a function body by name via brace matching (same approach as the
// write-side guard) so an assertion scoped to one function can't read another.
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) return null;
  const paren = source.indexOf('(', start);
  if (paren === -1) return null;
  let pdepth = 0;
  let afterParams = -1;
  for (let i = paren; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') pdepth++;
    else if (ch === ')') { pdepth--; if (pdepth === 0) { afterParams = i + 1; break; } }
  }
  if (afterParams === -1) return null;
  const open = source.indexOf('{', afterParams);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return source.slice(open, i + 1); }
  }
  return null;
}

// ── Invariant 1 — the keyed responses store key is read here ──
expect('responses keeps the keyed responses store key bazardrive.responses.v1',
  /RESPONSES_KEY\s*=\s*'bazardrive\.responses\.v1'/.test(responses));

// ── Invariant 2 — reader filters passenger_response by canonical orderId ──
const loaderBody = functionBody(responses, 'loadResponsesForOrder') || '';
expect('responses defines loadResponsesForOrder', loaderBody.length > 0);
expect('loadResponsesForOrder reads RESPONSES_KEY via getItem',
  /getItem\(\s*RESPONSES_KEY/.test(loaderBody));
expect('loadResponsesForOrder filters kind === passenger_response',
  /kind\s*===\s*'passenger_response'/.test(loaderBody));
expect('loadResponsesForOrder matches on the canonical orderId',
  /r\.orderId/.test(loaderBody));
expect('loadResponsesForOrder is read-only (no setItem on the responses store)',
  !/setItem\(\s*RESPONSES_KEY/.test(loaderBody));

// ── Invariant 3 — map a real response into the existing card shape ──
const mapperBody = functionBody(responses, 'mapResponseToDriverCard') || '';
expect('responses defines mapResponseToDriverCard', mapperBody.length > 0);
expect('mapped card carries a real responseId (so /chat resolves the handoff)',
  /responseId\s*=\s*String\(\s*response\.id/.test(mapperBody));
expect('mapped card price derives from driverPrice',
  /driverPrice/.test(mapperBody));
expect('mapped card note derives from the response message',
  /response\.message/.test(mapperBody));
expect('mapped card pickup label derives from pickupTiming via timingLabel',
  /eta:\s*timingLabel\(\s*response\.pickupTiming/.test(mapperBody));
expect('mapped card fills a CSS-valid avatarTone (no undefined tone class)',
  /avatarTone:\s*'(mint|amber|violet)'/.test(mapperBody));

// ── Invariant 4 — MOCK_DRIVERS fallback preserved via buildDriversForOrder ──
const selectorBody = functionBody(responses, 'buildDriversForOrder') || '';
expect('responses defines buildDriversForOrder', selectorBody.length > 0);
expect('buildDriversForOrder sources real responses via loadResponsesForOrder',
  /loadResponsesForOrder\(/.test(selectorBody));
expect('buildDriversForOrder falls back to the MOCK_DRIVERS board (buildDrivers)',
  /return\s+buildDrivers\(/.test(selectorBody));
expect('responses still defines the MOCK_DRIVERS fallback board',
  /const\s+MOCK_DRIVERS\s*=/.test(responses));

// ── Invariant 5 — the board call-site uses the selector, not bare buildDrivers ──
expect('responses() builds the board via buildDriversForOrder(request)',
  /const\s+drivers\s*=\s*buildDriversForOrder\(\s*request\s*\)/.test(responses));

// ── Invariant 6 — read-only: never writes responses.v1, never mutates canon ──
expect('responses never writes the responses store (no setItem on RESPONSES_KEY)',
  !/setItem\(\s*RESPONSES_KEY/.test(responses));
for (const [fn, body] of [
  ['loadResponsesForOrder', loaderBody],
  ['mapResponseToDriverCard', mapperBody],
  ['buildDriversForOrder', selectorBody],
]) {
  for (const mut of ['createRideOrder', 'acceptNearbyOrder', 'updateTripStatus']) {
    expect(`${fn} does NOT call ${mut}() (read-side, no canonical mutation)`,
      !new RegExp(`\\b${mut}\\s*\\(`).test(body));
  }
}

// ── Invariant 7 — accept → active-ride handoff left intact ──
expect('responses still reads the canonical order via getOrderById',
  /getOrderById\(/.test(responses));
expect('responses still seeds the accept → active-ride handoff (buildPassengerActiveRide)',
  /function\s+buildPassengerActiveRide\(/.test(responses)
    && /buildPassengerActiveRide\(\s*canonicalOrder/.test(responses));

// ── Invariant 8 — read-side stays self-contained (no cross-screen chat import) ──
expect('responses does not import from chat.js',
  !/from\s*'\.\/chat\.js'/.test(responses));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
