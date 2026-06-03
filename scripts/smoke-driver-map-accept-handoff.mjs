// BD-DRIVER-MAP-X-15 — static regression smoke for the DriverMap accept order
// handoff:
//
//   CREATED order → DriverMap "Принять" → one active trip → driver active ride
//   → passenger accepted-driver handoff (no empty search after acceptance)
//
// Intentionally STATIC: it reads source and asserts the handoff contract still
// holds, so a future refactor cannot silently (a) create a duplicate active
// trip on a repeat accept, (b) re-offer an accepted order as a fresh nearby
// order, or (c) let the passenger responses screen fall back to the empty
// "Ищем водителей" search after a driver has already taken the order. No
// browser, no DOM, no Mapbox, no backend.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const driverMap   = read('../public/src/screens/driver_map.js');
const rideActions = read('../public/src/ride_actions.js');
const mockApi     = read('../public/src/mock_api.js');
const responses   = read('../public/src/screens/responses.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// Extract a function body by name via brace matching, so an assertion scoped
// to one function doesn't accidentally inspect another. Skips the parameter
// list first so an object-default param (e.g. `(input = {})`) is not mistaken
// for the function body's opening brace. Matches `function NAME(` (with the
// open paren) so `export function NAME` / `export default function NAME` are
// both found and a name that is a prefix of another (`responses` vs
// `responsesWord`) cannot capture the wrong function.
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

// ── Criterion 1 — accept creates/links exactly ONE active trip per orderId ──
// acceptCanonicalRideOrder is the single canonical path: flip CREATED→ACCEPTED
// once, then seed exactly one active ride at a stable trip id linked back to
// the order.
const acceptCanonicalBody = functionBody(rideActions, 'acceptCanonicalRideOrder') || '';
expect('ride_actions defines acceptCanonicalRideOrder', acceptCanonicalBody.length > 0);
expect('acceptCanonicalRideOrder flips the order via acceptNearbyOrder()',
  /acceptNearbyOrder\s*\(/.test(acceptCanonicalBody));
expect('acceptCanonicalRideOrder seeds via seedActiveRideFromAcceptedOrder()',
  /seedActiveRideFromAcceptedOrder\s*\(/.test(acceptCanonicalBody));

const seedBody = functionBody(rideActions, 'seedActiveRideFromAcceptedOrder') || '';
expect('ride_actions defines seedActiveRideFromAcceptedOrder', seedBody.length > 0);
expect('seed links the trip back to the order (ride.orderId = …)',
  /ride\.orderId\s*=/.test(seedBody));
expect('seed persists exactly one ride via saveActiveRide()',
  /saveActiveRide\s*\(/.test(seedBody));
expect('trip id is derived deterministically from the order id (trip_${order.id})',
  /trip_\$\{order\.id\}/.test(rideActions));

// Idempotency: acceptNearbyOrder only flips a CREATED order and returns null
// otherwise, so a repeat "Принять" cannot create a second active trip.
const acceptNearbyBody = functionBody(mockApi, 'acceptNearbyOrder') || '';
expect('mock_api defines acceptNearbyOrder', acceptNearbyBody.length > 0);
expect('acceptNearbyOrder gates the flip on status === CREATED',
  /o\.status\s*===\s*'CREATED'/.test(acceptNearbyBody));
expect('acceptNearbyOrder returns null when not CREATED (repeat accept = no dup trip)',
  /return\s+null/.test(acceptNearbyBody));

// ── Criterion 2 — driver navigates to the active ride ──
expect('driver_map imports acceptCanonicalRideOrder from ride_actions',
  /import\s*\{[^}]*acceptCanonicalRideOrder[^}]*\}\s*from\s*'\.\.\/ride_actions\.js'/s.test(driverMap));
expect('driver_map accept branch accepts then renders the accepted card',
  /action === 'accept'[\s\S]*?acceptCanonicalRideOrder\([\s\S]*?renderAccepted\(\s*result\.order\s*,\s*result\.tripId\s*\)/.test(driverMap));
expect('accepted card exposes the active-ride action carrying the trip id',
  /data-action="active-ride"\s+data-trip-id="\$\{safeTripId\}"/.test(driverMap));
expect('active-ride action routes to /active-ride?role=driver with status ACCEPTED',
  /go\(`\/active-ride\?role=driver&\$\{query\}`\)/.test(driverMap)
    && /tripId=\$\{encodeURIComponent\(tripId\)\}&status=ACCEPTED/.test(driverMap));

// ── Criterion 4 — accepted order is no longer a fresh nearby order ──
const listNearbyBody = functionBody(mockApi, 'listNearbyOrders') || '';
expect('mock_api defines listNearbyOrders', listNearbyBody.length > 0);
expect('listNearbyOrders only offers CREATED orders (accepted order drops out)',
  /status\s*===\s*'CREATED'/.test(listNearbyBody));

// ── Criterion 3 — passenger accepted-driver handoff (no empty search) ──
const responsesBody = functionBody(responses, 'responses') || '';
expect('responses default export body resolved', responsesBody.length > 0);
expect('RESPONSE_STATUS has an accepted entry "Водитель найден"',
  /accepted:\s*\{[^}]*Водитель найден/.test(responses));
expect('responses defines renderAcceptedDriver()',
  /function\s+renderAcceptedDriver\s*\(/.test(responses));
expect('responses computes the handoff trip id from the order id (trip_${request.orderId})',
  /trip_\$\{request\.orderId\}/.test(responsesBody));
expect('responses detects a live active trip via findActiveRide()',
  /findActiveRide\s*\(/.test(responsesBody));
expect('handoff detection covers ACCEPTED and IN_PROGRESS order status',
  /'ACCEPTED'/.test(responsesBody) && /'IN_PROGRESS'/.test(responsesBody));
// A linked terminal ride (COMPLETED / CANCELED / NO_SHOW) must suppress the
// handoff even when the order status still reads ACCEPTED / IN_PROGRESS, so a
// finished/canceled trip never re-renders the accepted-driver card.
expect('detection flags a linked terminal ride (COMPLETED, CANCELED, NO_SHOW)',
  /rideTerminal[\s\S]*?RIDE_STATUS\.COMPLETED[\s\S]*?RIDE_STATUS\.CANCELED[\s\S]*?RIDE_STATUS\.NO_SHOW/.test(responsesBody));
expect('a linked terminal ride forces isAccepted false (order-status fallback gated by !rideTerminal)',
  /isAccepted\s*=\s*!!canonicalOrder\s*&&\s*!rideTerminal\s*&&/.test(responsesBody));
expect('isAccepted overrides the URL state on the offer/list derivations',
  /!isAccepted\s*&&/.test(responsesBody));
expect('accepted state renders renderAcceptedDriver instead of the empty search',
  /isAccepted[\s\S]*?renderAcceptedDriver\(/.test(responsesBody));
expect('footer is hidden in the accepted state',
  /\(isList\s*\|\|\s*isOffer\s*\|\|\s*isAccepted\)/.test(responsesBody));
expect('accepted CTA exposes the open-active-ride action',
  /data-action="open-active-ride"/.test(responses));
expect('open-active-ride CTA opens the passenger active ride (go(activeRideUrl(...)))',
  /open-active-ride"\][\s\S]{0,200}go\(activeRideUrl\(/.test(responsesBody));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
