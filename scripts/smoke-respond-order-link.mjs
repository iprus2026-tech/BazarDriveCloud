// BD-RESPOND-ORDER-LINK-GUARD-01 — static regression guard for the respond →
// canonical ride order write-side bridge (issue #367, BD-RESPOND-ORDER-LINK-01).
//
// PR1 is intentionally tiny and one-sided. It protects exactly this contract on
// public/src/screens/respond.js (and nothing else):
//
//   link:    a canonical ride-order Feed post (post.canonical==='ride_order'
//            with an orderId) makes /respond additively pin
//            orderId + canonical:'ride_order' on the stored passenger_response.
//   legacy:  posts without an orderId (legacy/seed feed posts) get NO new
//            canonical fields — the link is gated behind a ternary whose
//            non-canonical branch is {}, so the stored record is unchanged.
//   keep:    the prior contract fields (tripId, requestId) are preserved, so
//            /chat + /trip-confirmation keep resolving the handoff by tripId.
//   store:   the response is still persisted via saveResponseToMap into the
//            keyed bazardrive.responses.v1 store.
//   no-mut:  /respond never mutates the canonical ride-order store — it must
//            not call createRideOrder / acceptOrder / acceptNearbyOrder /
//            updateTripStatus.
//   no-link-creep: the respond → chat link stays responseId-only (no orderId).
//
// Intentionally STATIC: reads source and asserts the contract — no DOM, no
// browser, no network, no public/* runtime changes. Mirrors the helpers of
// scripts/smoke-ride-order-unify.mjs so the two guards read the same way.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const respond = read('../public/src/screens/respond.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// BD-RESPOND-ORDER-LINK-WRITESIDE-COMMENT-S — strip JS comments so the
// forbidden-runtime negative scans below cannot be false-failed by an
// explanatory comment that names a forbidden call ("// do not call
// createRideOrder()" / "// never call updateTripStatus()") or a forbidden
// URL pattern ("// /chat?orderId=… is reserved for /responses"). Preserves
// URL-shaped `://` so e.g. `'https://…'` string literals in code survive
// untouched. Smoke-local, no dependency, no parser. Mirrors the helper
// added to the sibling read-side smoke in #486.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const respondCode = stripComments(respond);

// Extract a function body by name via brace matching (same approach as the
// unify guard) so an assertion scoped to one function can't read another.
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

// Passenger-response object literal only (id: responseId, … };). The marketplace
// branch builds its object with an inline `id: `resp_${post.id}`` instead, so
// anchoring on `id: responseId` isolates the ride-response we are guarding and
// excludes the canonicalLink declaration that sits above it.
const passengerResponseBlock = (respond.match(/\{\s*id:\s*responseId,[\s\S]*?\};/) || [''])[0];

// ── Invariant 1 — the canonical link is GATED on a canonical ride-order post ──
// The additive orderId + marker must live behind the
// (post.canonical==='ride_order' && post.orderId) gate, with an empty-object
// fallback so non-canonical (legacy/seed) posts get nothing extra.
expect('respond gates the canonical link on post.canonical===ride_order && post.orderId',
  /\(\s*post\.canonical\s*===\s*'ride_order'\s*&&\s*post\.orderId\s*\)\s*\?/.test(respond));
expect('respond canonical branch pins orderId:String(post.orderId) + canonical:ride_order',
  /\?\s*\{\s*orderId:\s*String\(\s*post\.orderId\s*\)\s*,\s*canonical:\s*'ride_order'\s*\}/.test(respond));
expect('respond legacy/seed branch adds NO canonical fields (empty-object fallback)',
  /canonical:\s*'ride_order'\s*\}\s*:\s*\{\s*\}/.test(respond));

// ── Invariant 2 — the link is APPLIED to the passenger_response via spread ──
// Applied only by spreading the gated object; never as an unconditional
// property of the response literal (so legacy posts can't pick it up).
expect('respond builds a passenger_response object', passengerResponseBlock.length > 0);
expect('passenger_response is kind passenger_response',
  /kind:\s*'passenger_response'/.test(passengerResponseBlock));
expect('passenger_response spreads the gated canonical link (...canonicalLink)',
  /\.\.\.canonicalLink/.test(passengerResponseBlock));
expect('passenger_response does NOT set orderId/canonical unconditionally (only via spread)',
  !/\borderId\s*:/.test(passengerResponseBlock) && !/\bcanonical\s*:/.test(passengerResponseBlock));

// ── Invariant 3 — prior contract fields preserved (chat/trip-confirmation) ──
expect('passenger_response preserves tripId', /(^|\n)\s*tripId,/.test(passengerResponseBlock));
expect('passenger_response preserves requestId: post.id', /requestId:\s*post\.id/.test(passengerResponseBlock));

// ── Invariant 4 — persisted via saveResponseToMap into bazardrive.responses.v1 ──
expect('respond keeps the keyed responses store key bazardrive.responses.v1',
  /RESPONSES_KEY\s*=\s*'bazardrive\.responses\.v1'/.test(respond));
const saveMapBody = functionBody(respond, 'saveResponseToMap') || '';
// Reserved comment-stripped slice for future negative checks scoped to
// saveResponseToMap. The current positive write pin stays on raw body.
// eslint-disable-next-line no-unused-vars
const saveMapCode = stripComments(saveMapBody);
expect('saveResponseToMap writes into RESPONSES_KEY',
  saveMapBody.length > 0 && /setItem\(\s*RESPONSES_KEY/.test(saveMapBody));
expect('respond persists the response via saveResponseToMap(response)',
  /saveResponseToMap\(\s*response\s*\)/.test(respond));

// ── Invariant 5 — respond NEVER mutates the canonical ride-order store ──
// Comment-stripped scan target so a "// do not call createRideOrder()" /
// "// never call updateTripStatus()" disclaimer in the runtime source
// cannot false-fail this contract pin (BD-RESPOND-ORDER-LINK-WRITESIDE-
// COMMENT-S).
for (const fn of ['createRideOrder', 'acceptOrder', 'acceptNearbyOrder', 'updateTripStatus']) {
  expect(`respond does NOT call ${fn}() (no canonical mutation)`,
    !new RegExp(`\\b${fn}\\s*\\(`).test(respondCode));
}

// ── Invariant 6 — respond → chat link carries responseId (+ role=driver
// per BD-CHAT-02), never orderId. The role=driver suffix lets /chat render
// the bubble on the right side of the thread for the responding driver; the
// link still must NOT leak the canonical orderId (that is /responses' job).
// Negative scan uses respondCode so a docstring noting
// "// /chat?orderId=… is reserved for /responses" can't false-fail.
expect('respond keeps the responseId-only chat link (with BD-CHAT-02 role=driver)',
  /chatHref\s*=\s*`\/chat\?responseId=\$\{encodeURIComponent\(responseId\)\}&role=driver`/.test(respond));
expect('respond chat links never carry orderId',
  !/\/chat\?[^`'"\n]*orderId/.test(respondCode));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
