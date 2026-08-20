// BD-RIDE-AUTHORITY-01B — real end-to-end flow guard: canonical order ->
// respond (canonical response) -> chat confirm (handoff) -> active-ride seed.
//
// smoke-confirm-handoff-active-ride.mjs already proves
// trip_confirmation_handoff.js resolves real data given a well-formed
// confirmed handoff, but its fixtures build that handoff directly — they
// don't prove the handoff's OWN shape (tripId in particular) is what
// respond.js and chat.js actually produce. This smoke closes that gap: it
// mirrors respond.js's and chat.js's real write expressions (each pinned
// statically against their source below) to construct the order/response/
// handoff chain, then drives it through the real, unmodified
// trip_confirmation_handoff.js / mock_api.js functions — no invented
// handoff object.
//
// Intentionally headless: mock_api.js + ride_state.js +
// trip_confirmation_handoff.js are plain data/storage modules (no DOM), so
// this stays a behavioural smoke, not a DOM/browser test. respond.js and
// chat.js themselves are DOM-driven screens and are only read as source
// for the static mirror pins.

import fs from 'node:fs';

const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { _store.delete(k); },
  clear: () => { _store.clear(); },
};

const root = new URL('../public/src/', import.meta.url);
const mockApi = await import(new URL('mock_api.js', root).href);
const rideState = await import(new URL('ride_state.js', root).href);
const handoffMod = await import(new URL('screens/trip_confirmation_handoff.js', root).href);

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const respondSrc = read('../public/src/screens/respond.js');
const chatSrc    = read('../public/src/screens/chat.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

const RESPONSES_KEY    = 'bazardrive.responses.v1';
const TRIP_CONFIRM_KEY = 'bazardrive.trip_confirmation.v1';

function resetStorage() {
  localStorage.clear();
}

// ── A. Static mirror pins — the fixture below must match real source ──
// A1. respond.js's canonical tripId derivation (BD-RIDE-AUTHORITY-01B fix):
// trip_<canonicalLink.orderId> for a canonical ride-order response, the
// legacy String(post.id) shape otherwise.
expect('respond.js derives tripId as trip_<canonicalLink.orderId> for a canonical response, else String(post.id)',
  /const\s+tripId\s*=\s*canonicalLink\.orderId\s*\?\s*`trip_\$\{canonicalLink\.orderId\}`\s*:\s*String\(post\.id\)/.test(respondSrc));
// A2. respond.js's canonicalLink gate (unchanged contract from BD-RESPOND-ORDER-LINK-01).
expect('respond.js gates canonicalLink on post.canonical === ride_order && post.orderId',
  /\(\s*post\.canonical\s*===\s*'ride_order'\s*&&\s*post\.orderId\s*\)\s*\?\s*\{\s*orderId:\s*String\(\s*post\.orderId\s*\)\s*,\s*canonical:\s*'ride_order'\s*\}/.test(respondSrc));
// A3. chat.js's resolveRideContext sources tripId from the stored response's own tripId.
expect('chat.js resolveRideContext derives tripId from response.tripId (passenger_response only)',
  /viewerRole\s*!==\s*'driver'\s*&&\s*response\s*&&\s*response\.kind\s*===\s*'passenger_response'\s*&&\s*response\.tripId/.test(chatSrc)
  && /return\s*\{\s*isRide:\s*true,\s*tripId:\s*String\(response\.tripId\)\s*\}/.test(chatSrc));
// A4. chat.js's #chat-confirm writes the handoff keyed on rideContext.tripId, not a route param.
expect('chat.js #chat-confirm writes saveTripConfirmation({ tripId: rideContext.tripId, responseId, role: passenger, state: CONFIRMED })',
  /saveTripConfirmation\(\s*\{\s*tripId:\s*rideContext\.tripId,\s*responseId:\s*responseId\s*\|\|\s*null,\s*role:\s*'passenger',\s*state:\s*'CONFIRMED'/.test(chatSrc));

// ── B. Fixture builders — mirror the pinned expressions above, do not invent shape ──
function buildCanonicalResponse({ post, driverPrice, pickupTiming, message, vehicleId, driverSnapshot }) {
  const responseId = `resp_${post.id}`;
  // Mirrors respond.js exactly (pinned in A2/A1 above).
  const canonicalLink = (post.canonical === 'ride_order' && post.orderId)
    ? { orderId: String(post.orderId), canonical: 'ride_order' }
    : {};
  const tripId = canonicalLink.orderId ? `trip_${canonicalLink.orderId}` : String(post.id);
  return {
    id: responseId,
    kind: 'passenger_response',
    tripId,
    requestId: post.id,
    ...canonicalLink,
    driverPrice,
    pickupTiming,
    message,
    vehicleId,
    driverSnapshot,
    status: 'SENT',
    createdAt: new Date().toISOString(),
  };
}

function saveResponse(response) {
  const map = JSON.parse(localStorage.getItem(RESPONSES_KEY) || '{}');
  map[response.id] = response;
  localStorage.setItem(RESPONSES_KEY, JSON.stringify(map));
}

// Mirrors chat.js's resolveRideContext (A3) + #chat-confirm handoff write (A4):
// tripId comes from the RESPONSE's own tripId, not a hand-picked value.
function confirmViaChat(response) {
  const rideContext = (response && response.kind === 'passenger_response' && response.tripId)
    ? { isRide: true, tripId: String(response.tripId) }
    : { isRide: false, tripId: null };
  if (!rideContext.isRide) return null;
  const now = Date.now();
  const record = {
    tripId: rideContext.tripId,
    responseId: response.id || null,
    role: 'passenger',
    state: 'CONFIRMED',
    createdAt: now,
    expiresAt: now + 5 * 60_000,
  };
  const map = JSON.parse(localStorage.getItem(TRIP_CONFIRM_KEY) || '{}');
  map[record.tripId] = record;
  localStorage.setItem(TRIP_CONFIRM_KEY, JSON.stringify(map));
  return record;
}

const DRIVER_SNAPSHOT = {
  name: 'Настоящий Шофёр',
  rating: 4.65,
  car: 'Skoda Octavia · белый',
  carModel: 'Skoda Octavia',
  carColor: 'белый',
  plate: 'Н 222 НН 77',
};

const MOCK_STRINGS = [
  handoffMod.MOCK_PASSENGER.name, handoffMod.MOCK_PASSENGER.initials,
  handoffMod.MOCK_DRIVER.name, handoffMod.MOCK_DRIVER.initials,
  handoffMod.MOCK_VEHICLE.model, handoffMod.MOCK_VEHICLE.plate,
  handoffMod.MOCK_ROUTE.from, handoffMod.MOCK_ROUTE.to, handoffMod.MOCK_ROUTE.priceRub,
];
function assertNoMockStrings(label, ride) {
  const json = JSON.stringify(ride);
  for (const s of MOCK_STRINGS) {
    expect(`${label}: no MOCK_* literal "${s}" leaked into the ride`, !json.includes(s));
  }
}

// ── C. Happy path — canonical order -> respond -> chat confirm -> active ride ──
resetStorage();
const order = await mockApi.createRideOrder({
  pickup: { label: 'Метро Юго-Западная' },
  dropoff: { label: 'ТЦ Реутов Парк' },
  distanceKm: 12.4,
  durationMin: 31,
  estimatedPrice: 1830,
  comment: 'настоящий заказ',
  passenger: {
    name: 'Настоящий Седок',
    initials: 'НС',
    phoneMasked: '+7 ... 20-01',
    comment: 'настоящий заказ',
    authorId: 'user_e2e_1',
    isCurrentUser: true,
  },
});
expect('createRideOrder persisted a real order with status CREATED', order && order.status === 'CREATED');

const post = mockApi.rideOrderToFeedPost(order);
expect('rideOrderToFeedPost projects a canonical ride-order post (post.id === order.id === post.orderId)',
  !!post && post.canonical === 'ride_order' && post.id === order.id && post.orderId === order.id);

const response = buildCanonicalResponse({
  post,
  driverPrice: 1900,
  pickupTiming: 'at_time',
  message: 'настоящее сообщение водителя',
  vehicleId: 'veh_real_e2e_1',
  driverSnapshot: DRIVER_SNAPSHOT,
});
const expectedTripId = `trip_${order.id}`;
expect('canonical response resolves tripId to trip_<orderId> (mirrors the A1 pin)',
  response.tripId === expectedTripId);
expect('canonical response carries the orderId link', response.orderId === order.id);
saveResponse(response);

const handoffRecord = confirmViaChat(response);
expect('chat confirm writes a handoff whose tripId is trip_<orderId>',
  !!handoffRecord && handoffRecord.tripId === expectedTripId);
expect('handoff.responseId pins the real response id', handoffRecord.responseId === response.id);

const activeRide = handoffMod.loadCanonicalActiveRide({ tripId: handoffRecord.tripId, role: 'passenger' });
expect('activeRide.tripId === trip_<orderId>', activeRide?.tripId === expectedTripId);
expect('activeRide.orderId === orderId', activeRide?.orderId === order.id);
expect('activeRide.selectedDriver.responseId === responseId', activeRide?.selectedDriver?.responseId === response.id);
expect('activeRide passenger identity is the REAL order.passenger', activeRide?.passenger?.name === 'Настоящий Седок');
expect('activeRide driver identity is the REAL response.driverSnapshot', activeRide?.driver?.name === 'Настоящий Шофёр');
expect('activeRide vehicle is the REAL response.driverSnapshot', activeRide?.vehicle?.model === 'Skoda Octavia');
expect('activeRide route is the REAL order pickup/dropoff', activeRide?.route?.pickupLabel === 'Метро Юго-Западная'
  && activeRide?.route?.dropoffLabel === 'ТЦ Реутов Парк');
expect('activeRide price is REAL (driverPrice-derived, not a MOCK_ROUTE literal)',
  typeof activeRide?.order?.offerPrice === 'string' && activeRide.order.offerPrice !== handoffMod.MOCK_ROUTE.priceRub);
assertNoMockStrings('happy path', activeRide);

// ── D. Negative case — real canonical linkage, but the order is gone by confirm time ──
// (e.g. cleared/expired between the driver's offer and the passenger's confirm tap).
// A well-formed real response + handoff must still refuse to seed a MOCK ride.
resetStorage();
const order2 = await mockApi.createRideOrder({
  pickup: { label: 'ул. Пропавшая, 1' },
  dropoff: { label: 'ул. Исчезнувшая, 2' },
  estimatedPrice: 1200,
  passenger: { name: 'Другой Седок', authorId: 'user_e2e_2', isCurrentUser: true },
});
const post2 = mockApi.rideOrderToFeedPost(order2);
const response2 = buildCanonicalResponse({
  post: post2,
  driverPrice: 1300,
  pickupTiming: 'earlier',
  message: 'сообщение',
  vehicleId: 'veh_real_e2e_2',
  driverSnapshot: DRIVER_SNAPSHOT,
});
saveResponse(response2);
const handoffRecord2 = confirmViaChat(response2);
expect('D: chat confirm wrote a well-formed real handoff before the linkage broke', !!handoffRecord2);
// Simulate the order disappearing (cleared/expired) after the handoff was written.
localStorage.setItem('bazardrive.ride_orders.v1', JSON.stringify([]));
expect('D: order no longer resolves (broken linkage)', mockApi.getOrderById(order2.id) === null);

const brokenRide = handoffMod.loadCanonicalActiveRide({ tripId: handoffRecord2.tripId, role: 'passenger' });
expect('D: real handoff + broken linkage returns null, not a ride', brokenRide === null);
expect('D: nothing was persisted under this tripId', rideState.findActiveRide(handoffRecord2.tripId) === null);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
