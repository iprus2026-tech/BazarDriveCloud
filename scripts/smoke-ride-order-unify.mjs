// BD-RIDE-ORDER-UNIFY-GUARD-01 — static regression guard for the unified
// ride order model closed by #238 (BD-RIDE-ORDER-UNIFY-01, PRs #239/#240/#241).
//
// The unification spans several surfaces:
//
//   create:   /order-map-draft + Composer Попутчик → createRideOrder()
//             → bazardrive.ride_orders.v1 (single canonical store)
//   display:  /feed projects CREATED ride orders as passenger ride cards
//             (read-side, no duplication into FEED_POSTS_V2 / myposts)
//   driver:   /driver-map lists the same orders via listNearbyOrders()
//   accept:   Feed + DriverMap accept through the shared
//             acceptCanonicalRideOrder() in ride_actions.js
//   sync:     /active-ride writes the lifecycle back into the canonical
//             order via updateTripStatus(orderId, …)
//
// This guard is intentionally STATIC: it reads source and asserts the
// cross-surface contract still holds, so a future refactor cannot silently
// re-fork the order model (a second order contour, a duplicated feed object,
// a non-canonical accept path, or a broken status mapping). No browser, no
// DOM, no Mapbox, no backend, no public/* runtime changes.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const mockApi     = read('../public/src/mock_api.js');
const composer    = read('../public/src/screens/composer.js');
const feed        = read('../public/src/screens/feed.js');
const driverMap   = read('../public/src/screens/driver_map.js');
const rideActions = read('../public/src/ride_actions.js');
const activeRide  = read('../public/src/screens/active_ride.js');

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
// both found and a name that is a prefix of another cannot capture the wrong
// function.
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

// ── Invariant 1 — createRideOrder writes ONLY to the canonical store ──
// The canonical store key must stay bazardrive.ride_orders.v1, and the
// creator must persist through persistRideOrders() WITHOUT also writing into
// the feed seed array (FEED_POSTS_V2) or the "my posts" store — otherwise a
// ride order would be duplicated as a parallel feed object.
expect('mock_api keeps the canonical ride-order store key bazardrive.ride_orders.v1',
  /RIDE_ORDERS_KEY\s*=\s*'bazardrive\.ride_orders\.v1'/.test(mockApi));
const createRideOrderBody = functionBody(mockApi, 'createRideOrder') || '';
expect('mock_api defines createRideOrder', createRideOrderBody.length > 0);
expect('createRideOrder persists via persistRideOrders() (canonical store)',
  /persistRideOrders\s*\(/.test(createRideOrderBody));
expect('createRideOrder does NOT duplicate into FEED_POSTS_V2',
  !/FEED_POSTS_V2/.test(createRideOrderBody));
expect('createRideOrder does NOT duplicate into the my-posts store',
  !/persistMyPosts|MY_POSTS_KEY/.test(createRideOrderBody));
expect('createRideOrder seeds new orders as CREATED',
  /status:\s*'CREATED'/.test(createRideOrderBody));

// ── Invariant 2 — a map-created order surfaces via the Feed projection ──
// listFeedPosts must merge the seed feed with the read-side projection of
// ride orders; the projection adapter must tag canonical cards so downstream
// surfaces can route them back to the same order id.
const listFeedBody = functionBody(mockApi, 'listFeedPosts') || '';
expect('mock_api defines listFeedPosts', listFeedBody.length > 0);
expect('listFeedPosts merges seed feed with the ride-order projection',
  /mergeFeedAndRideOrderPosts\s*\(/.test(listFeedBody)
    && /listRideOrdersAsFeedPosts\s*\(/.test(listFeedBody));
const projectionBody = functionBody(mockApi, 'rideOrderToFeedPost') || '';
expect('mock_api defines rideOrderToFeedPost', projectionBody.length > 0);
expect('projection tags cards as canonical ride_order with an orderId',
  /canonical:\s*'ride_order'/.test(projectionBody) && /orderId:/.test(projectionBody));

// ── Invariant 3 — Composer passenger_request writes a canonical ride order ──
// /new → Попутчик must call createRideOrder() (not createFeedPost), and the
// builder must shape a passenger_request ride order. Driver offers / market /
// service / announcement stay on createFeedPost (feed-only, by design).
expect('composer imports createRideOrder from mock_api',
  /import\s*\{[^}]*createRideOrder[^}]*\}\s*from\s*'\.\.\/mock_api\.js'/s.test(composer));
expect('composer passenger branch writes a canonical ride order',
  /d\.type\s*===\s*'passenger'[\s\S]{0,120}createRideOrder\(\s*buildRideOrderFromComposerDraft\(/.test(composer));
expect('composer non-passenger branch stays on createFeedPost (feed-only contour)',
  /else\s*\{[\s\S]{0,80}createFeedPost\(/.test(composer));
const composerBuilderBody = functionBody(composer, 'buildRideOrderFromComposerDraft') || '';
expect('composer builder shapes a passenger_request ride order',
  /type:\s*'passenger_request'/.test(composerBuilderBody));

// ── Invariant 4 — listNearbyOrders shows only actionable CREATED orders ──
const listNearbyBody = functionBody(mockApi, 'listNearbyOrders') || '';
expect('mock_api defines listNearbyOrders', listNearbyBody.length > 0);
expect('listNearbyOrders only offers CREATED orders',
  /status\s*===\s*'CREATED'/.test(listNearbyBody));

// ── Invariant 5 — accept goes through the shared acceptCanonicalRideOrder ──
// Both Feed and DriverMap must reach the same canonical accept helper, so the
// underlying order flips CREATED→ACCEPTED once and seeds one active ride.
expect('feed imports acceptCanonicalRideOrder from ride_actions',
  /import\s*\{[^}]*acceptCanonicalRideOrder[^}]*\}\s*from\s*'\.\.\/ride_actions\.js'/s.test(feed));
expect('feed canonical accept branch calls acceptCanonicalRideOrder(post.orderId)',
  /post\.canonical\s*===\s*'ride_order'\s*&&\s*post\.orderId[\s\S]{0,160}acceptCanonicalRideOrder\(\s*post\.orderId\s*\)/.test(feed));
expect('driver_map imports acceptCanonicalRideOrder from ride_actions',
  /import\s*\{[^}]*acceptCanonicalRideOrder[^}]*\}\s*from\s*'\.\.\/ride_actions\.js'/s.test(driverMap));
expect('driver_map accept branch calls acceptCanonicalRideOrder()',
  /acceptCanonicalRideOrder\s*\(/.test(driverMap));
const acceptCanonicalBody = functionBody(rideActions, 'acceptCanonicalRideOrder') || '';
expect('acceptCanonicalRideOrder flips the order then seeds one active ride',
  /acceptNearbyOrder\s*\(/.test(acceptCanonicalBody)
    && /seedActiveRideFromAcceptedOrder\s*\(/.test(acceptCanonicalBody));

// ── Invariant 6 — accepted/terminal orders drop out of both surfaces ──
// Feed projection drops anything that is not CREATED, and DriverMap nearby
// (asserted in #4) does the same, so an accepted/terminal order can never
// reappear as fresh on either surface.
expect('rideOrderToFeedPost returns null for non-CREATED orders (feed drop-out)',
  /order\.status\s*!==\s*'CREATED'[\s\S]{0,40}return\s+null/.test(projectionBody));

// ── Invariant 7 — active-ride status sync respects the order status mapping ──
// active_ride syncs through updateTripStatus(); the canonical transition table
// must gate forward moves and keep terminal statuses terminal, and the
// NO_SHOW active-ride status must map down to a CANCELED canonical order.
expect('active_ride syncs canonical status via syncCanonicalOrderStatus + updateTripStatus',
  /function\s+syncCanonicalOrderStatus/.test(activeRide) && /updateTripStatus\s*\(/.test(activeRide));
expect('active_ride maps NO_SHOW active rides to CANCELED canonical orders',
  /\[RIDE_STATUS\.NO_SHOW\]:\s*RIDE_STATUS\.CANCELED/.test(activeRide));
const updateTripBody = functionBody(mockApi, 'updateTripStatus') || '';
expect('updateTripStatus gates moves through RIDE_ORDER_TRANSITIONS',
  /RIDE_ORDER_TRANSITIONS\[/.test(updateTripBody));
expect('canonical transitions keep COMPLETED and CANCELED terminal',
  /COMPLETED:\s*new Set\(\[\]\)/.test(mockApi) && /CANCELED:\s*new Set\(\[\]\)/.test(mockApi));
expect('updateTripStatus refuses to (re)create CREATED orders',
  /status\s*===\s*'CREATED'[\s\S]{0,40}return\s+null/.test(updateTripBody));

// ── Invariant 8 — legacy seed feed posts stay a separate demo contour ──
// Posts without a canonical orderId must keep using the legacy
// acceptPassengerRequestFromPost path, which builds a feed-* trip id and does
// NOT mutate the canonical ride-order store. This keeps the demo seed posts
// from corrupting (or being corrupted by) the canonical model.
expect('feed falls back to acceptPassengerRequestFromPost for non-canonical posts',
  /acceptPassengerRequestFromPost\s*\(\s*post\s*\)/.test(feed));
const buildRideFromPostBody = functionBody(rideActions, 'buildRideFromPost') || '';
expect('legacy ride uses a separate feed-* trip id namespace',
  /feed-\$\{p\.id/.test(buildRideFromPostBody));
const legacyAcceptBody = functionBody(rideActions, 'acceptPassengerRequestFromPost') || '';
expect('legacy accept does NOT touch the canonical ride-order store',
  legacyAcceptBody.length > 0
    && !/acceptNearbyOrder\s*\(/.test(legacyAcceptBody)
    && !/updateTripStatus\s*\(/.test(legacyAcceptBody));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
