// BD-RIDE-AUTHORITY-01C — pure Ride construction guard.
//
// ride_seed.js::buildPassengerRideSeed is the extracted construction step
// factored out of responses.js::buildPassengerActiveRide. It must stay a
// leaf: no storage, no order/response resolution, no acceptOrder, no
// persistence, no backend, no UI. This smoke pins that boundary
// structurally, proves the function is deterministic and side-effect-free
// behaviourally, and proves the two real entry points that now share it
// (responses.js's /responses select flow and trip_confirmation_handoff.js's
// confirmed-chat-handoff flow) build field-identical canonical Ride data
// for the same underlying real order + response — the acceptance
// criterion this whole 01B/01C effort was chartered around.
//
// BD-RIDE-ACCEPT-RESPONSE-01 — both real entry points now delegate their
// accept-if-CREATED + build + persist tail to one shared command,
// acceptDriverResponse (ride_actions.js), instead of each duplicating it.
// Section G below pins: both call sites delegate to it; the command
// itself performs the local accept/build/verify/save; it never mutates
// the response store; and responses.js's backend-authoritative branch
// calls the backend select before building the local active-ride bridge.

import fs from 'node:fs';

const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { _store.delete(k); },
  clear: () => { _store.clear(); },
};

const root = new URL('../public/src/', import.meta.url);
const rideSeed  = await import(new URL('ride_seed.js', root).href);
const rideState = await import(new URL('ride_state.js', root).href);
const rideWaitingPolicy = await import(new URL('ride_waiting_policy.js', root).href);
const rideActions = await import(new URL('ride_actions.js', root).href);
const mockApi   = await import(new URL('mock_api.js', root).href);
const responses = await import(new URL('screens/responses.js', root).href);
const handoffMod = await import(new URL('screens/trip_confirmation_handoff.js', root).href);

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const rideSeedSrc = read('../public/src/ride_seed.js');
const rideWaitingPolicySrc = read('../public/src/ride_waiting_policy.js');
const rideActionsSrc = read('../public/src/ride_actions.js');
const responsesSrc = read('../public/src/screens/responses.js');
const handoffSrc = read('../public/src/screens/trip_confirmation_handoff.js');
// Strip comments before scanning for forbidden tokens so the module's own
// doc comment (which names the forbidden operations for a human reader)
// cannot false-fail this guard. Preserves URL-shaped `://`.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const rideSeedCode = stripComments(rideSeedSrc);

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

const RESPONSES_KEY = 'bazardrive.responses.v1';
const TRIP_CONFIRM_KEY = 'bazardrive.trip_confirmation.v1';
const ACTIVE_RIDE_KEY = 'bazardrive.active_ride.v1';

function resetStorage() {
  localStorage.clear();
}

// ── A. Structural: ride_seed.js is a true leaf module ─────────────────
// BD-RIDE-WAITING-POLICY-01A (#912) — ride_seed.js now also imports the
// shared waiting-policy constants module. The forbidden-token scan below
// still only inspects ride_seed.js's own source (rideSeedCode) — it says
// nothing about ride_waiting_policy.js's purity on its own. That module's
// only independently-verified property here is the "zero imports" check
// immediately below (real, not just asserted in this comment); its other
// purity properties (no storage/backend/UI/timers) are not scanned by this
// file and are covered by direct code review instead, not this smoke.
expect('ride_seed.js imports only from ./ride_state.js and ./ride_waiting_policy.js (no screen imports)',
  /^import\s*\{[^}]*\}\s*from\s*'\.\/ride_state\.js';\s*$/m.test(rideSeedSrc)
  && /^import\s*\{[^}]*\}\s*from\s*'\.\/ride_waiting_policy\.js';\s*$/m.test(rideSeedSrc)
  && (rideSeedSrc.match(/^import\s/gm) || []).length === 2);
expect('ride_waiting_policy.js itself has zero imports (a true leaf, not just claimed to be one)',
  !/^import\s/m.test(rideWaitingPolicySrc));
for (const forbidden of [
  'localStorage', 'getOrderById', 'resolveResponseById', 'acceptOrder',
  'saveActiveRide', 'findActiveRide', 'apiFetch', 'fetch(', 'document.',
  'window.', "go(", 'toast(', 'alert(', 'MOCK_',
]) {
  expect(`ride_seed.js never references "${forbidden}" (pure construction only)`,
    !rideSeedCode.includes(forbidden));
}
expect('ride_seed.js exports buildPassengerRideSeed',
  typeof rideSeed.buildPassengerRideSeed === 'function');

// ── B. Determinism + zero persistence side effects ─────────────────────
const FIXED_ORDER = {
  id: 'pure-builder-order-1',
  status: 'ACCEPTED',
  acceptedAt: '2026-01-01T00:00:00.000Z',
  pickup: { label: 'ул. Чистая, 1' },
  dropoff: { label: 'пр. Функциональный, 2' },
  passenger: {
    name: 'Чистый Пассажир',
    initials: 'ЧП',
    phoneMasked: '+7 ... 00-00',
    comment: 'без побочных эффектов',
    authorId: 'user_pure_1',
    isCurrentUser: true,
  },
  comment: 'без побочных эффектов',
  durationMin: 20,
  distanceKm: 8,
};
const FIXED_REQUEST = {
  pickupLabel: 'ул. Чистая, 1',
  dropoffLabel: 'пр. Функциональный, 2',
  price: '1 700 ₽',
  note: 'без побочных эффектов',
};
const FIXED_DRIVER = {
  id: 'drv_pure_1',
  responseId: 'resp_pure_1',
  name: 'Чистый Водитель',
  initials: 'ЧВ',
  rating: '4,80',
  car: 'Lada Vesta · белый',
  carModel: 'Lada Vesta',
  carColor: 'белый',
  plate: 'Ч 000 ЧЧ 00',
  eta: '5 мин',
  price: '1 750 ₽',
  note: 'еду',
};

resetStorage();
expect('storage starts empty (no active_ride key)', localStorage.getItem(ACTIVE_RIDE_KEY) === null);
const seedOnce = rideSeed.buildPassengerRideSeed(FIXED_ORDER, FIXED_REQUEST, FIXED_DRIVER);
expect('buildPassengerRideSeed returns a Ride for valid input', !!seedOnce && seedOnce.tripId === 'trip_pure-builder-order-1');
// BD-RIDE-WAITING-POLICY-01A (#912) — compare against the shared module's
// own exports, not a re-typed literal, so a consumer regressing to its own
// local literal (or a drift between the constant and this call site) is
// caught even though the two currently hold the same value.
expect('buildPassengerRideSeed sets waiting.freeLimit from the shared DEFAULT_FREE_WAIT_LIMIT constant',
  seedOnce.waiting.freeLimit === rideWaitingPolicy.DEFAULT_FREE_WAIT_LIMIT);
expect('buildPassengerRideSeed sets waiting.paidRate from the shared DEFAULT_PAID_RATE_LABEL constant',
  seedOnce.waiting.paidRate === rideWaitingPolicy.DEFAULT_PAID_RATE_LABEL);
expect('buildPassengerRideSeed writes NOTHING to storage (no active_ride key materialized)',
  localStorage.getItem(ACTIVE_RIDE_KEY) === null);
expect('buildPassengerRideSeed writes NOTHING to any other known key either',
  localStorage.getItem(RESPONSES_KEY) === null && localStorage.getItem(TRIP_CONFIRM_KEY) === null);

const seedTwice = rideSeed.buildPassengerRideSeed(FIXED_ORDER, FIXED_REQUEST, FIXED_DRIVER);
function stripVolatile(ride) {
  const copy = JSON.parse(JSON.stringify(ride));
  if (copy.timestamps) delete copy.timestamps.createdAt; // createDemoActiveRide stamps `now` per call
  return copy;
}
expect('same input -> identical Ride (deterministic, excluding the per-call createdAt stamp)',
  JSON.stringify(stripVolatile(seedOnce)) === JSON.stringify(stripVolatile(seedTwice)));
expect('timestamps.acceptedAt is deterministic too (sourced from order.acceptedAt, not "now")',
  seedOnce.timestamps.acceptedAt === '2026-01-01T00:00:00.000Z'
  && seedTwice.timestamps.acceptedAt === '2026-01-01T00:00:00.000Z');
expect('storage still empty after the second call', localStorage.getItem(ACTIVE_RIDE_KEY) === null);

expect('buildPassengerRideSeed returns null for an order with no id',
  rideSeed.buildPassengerRideSeed({}, FIXED_REQUEST, FIXED_DRIVER) === null);
expect('buildPassengerRideSeed returns null for a missing order',
  rideSeed.buildPassengerRideSeed(null, FIXED_REQUEST, FIXED_DRIVER) === null);

// ── C. Equivalence: responses.js select vs trip_confirmation_handoff.js confirm ──
// Same real order + real response through the two independent real entry
// points must build field-identical canonical Ride data (tripId, orderId,
// passenger, driver, vehicle, route, price, selectedDriver.responseId).
resetStorage();
const order = await mockApi.createRideOrder({
  pickup: { label: 'Метро Юго-Западная' },
  dropoff: { label: 'ТЦ Реутов Парк' },
  distanceKm: 12.4,
  durationMin: 31,
  estimatedPrice: 1830,
  comment: 'сквозной заказ',
  passenger: {
    name: 'Сквозной Пассажир',
    initials: 'СП',
    phoneMasked: '+7 ... 30-01',
    comment: 'сквозной заказ',
    authorId: 'user_equiv_1',
    isCurrentUser: true,
  },
});
// Realistic precondition for a chat-confirm handoff: the order is already
// ACCEPTED by the time a passenger confirms via chat. Forcing this up
// front means neither path calls acceptOrder mid-test, so any divergence
// in the comparison below is a genuine construction-shape bug, not an
// artifact of one path accepting the order and the other not.
const acceptedOrder = mockApi.acceptOrder(order.id);
expect('equivalence fixture: order accepted before either construction path runs',
  !!acceptedOrder && acceptedOrder.status === 'ACCEPTED');

const EQUIV_RESPONSE = {
  id: 'resp_equiv_1',
  kind: 'passenger_response',
  tripId: `trip_${order.id}`,
  requestId: order.id,
  orderId: order.id,
  canonical: 'ride_order',
  driverPrice: 1900,
  pickupTiming: 'at_time',
  message: 'сквозное сообщение водителя',
  vehicleId: 'veh_equiv_1',
  driverSnapshot: {
    name: 'Сквозной Водитель',
    rating: 4.7,
    car: 'Hyundai Solaris · чёрный',
    carModel: 'Hyundai Solaris',
    carColor: 'чёрный',
    plate: 'С 777 СС 77',
  },
  status: 'SENT',
  createdAt: new Date().toISOString(),
};
{
  const map = JSON.parse(localStorage.getItem(RESPONSES_KEY) || '{}');
  map[EQUIV_RESPONSE.id] = EQUIV_RESPONSE;
  localStorage.setItem(RESPONSES_KEY, JSON.stringify(map));
}

// Path 1 — responses.js's own select-driver construction.
const request1 = responses.requestFromOrder(mockApi.getOrderById(order.id));
const driver1 = responses.mapResponseToDriverCard(EQUIV_RESPONSE, request1, 0);
const built1 = responses.buildPassengerActiveRide(mockApi.getOrderById(order.id), request1, driver1);
expect('path 1 (responses.js) builds a ride', !!built1 && !!built1.ride);
const rideA = built1 && built1.ride;

// Clear the persisted active ride so path 2 genuinely re-constructs
// instead of hitting the "existing ride" short-circuit and trivially
// returning path 1's own record back.
localStorage.removeItem(ACTIVE_RIDE_KEY);
expect('active_ride store cleared between path 1 and path 2', localStorage.getItem(ACTIVE_RIDE_KEY) === null);

// Path 2 — trip_confirmation_handoff.js's confirmed-chat-handoff construction.
const tripId = `trip_${order.id}`;
{
  const map = JSON.parse(localStorage.getItem(TRIP_CONFIRM_KEY) || '{}');
  map[tripId] = {
    tripId,
    role: 'passenger',
    state: 'CONFIRMED',
    responseId: EQUIV_RESPONSE.id,
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 5 * 60_000,
  };
  localStorage.setItem(TRIP_CONFIRM_KEY, JSON.stringify(map));
}
const rideB = handoffMod.loadCanonicalActiveRide({ tripId, role: 'passenger' });
expect('path 2 (trip_confirmation_handoff.js) builds a ride', !!rideB);

function canonicalFields(ride) {
  if (!ride) return null;
  return {
    tripId: ride.tripId,
    orderId: ride.orderId,
    status: ride.status,
    passenger: ride.passenger,
    driver: ride.driver,
    vehicle: ride.vehicle,
    route: ride.route,
    order: ride.order,
    ridePrice: ride.ride && ride.ride.price,
    selectedDriver: ride.selectedDriver,
  };
}
const fieldsA = canonicalFields(rideA);
const fieldsB = canonicalFields(rideB);
expect('path 1 and path 2 build field-identical canonical Ride data (tripId/orderId/status/passenger/driver/vehicle/route/order/price/selectedDriver)',
  JSON.stringify(fieldsA) === JSON.stringify(fieldsB),
  JSON.stringify({ fieldsA, fieldsB }));

// ── C2. Independent ground-truth checks (not just A-vs-B cross-equality) ──
// The comparison above would still pass if BOTH paths shared the same
// construction bug (e.g. both silently reading the wrong field). Assert
// each side against the literal fixture values directly, so a shared
// regression is caught even when A and B still agree with each other.
const expectedTripId = `trip_${order.id}`;
for (const [label, ride] of [['path 1', rideA], ['path 2', rideB]]) {
  expect(`${label}: tripId literally equals trip_<orderId>`, ride?.tripId === expectedTripId);
  expect(`${label}: orderId literally equals the real order id`, ride?.orderId === order.id);
  expect(`${label}: status is literally RIDE_STATUS.DRIVER_EN_ROUTE`,
    ride?.status === rideState.RIDE_STATUS.DRIVER_EN_ROUTE);
  expect(`${label}: passenger.name literally equals the real order.passenger.name`,
    ride?.passenger?.name === 'Сквозной Пассажир');
  expect(`${label}: driver.name literally equals the real response.driverSnapshot.name`,
    ride?.driver?.name === EQUIV_RESPONSE.driverSnapshot.name);
  expect(`${label}: vehicle.model/plate literally equal the real response.driverSnapshot fields`,
    ride?.vehicle?.model === EQUIV_RESPONSE.driverSnapshot.carModel
    && ride?.vehicle?.plate === EQUIV_RESPONSE.driverSnapshot.plate);
  expect(`${label}: route.pickupLabel/dropoffLabel literally equal the real order.pickup/dropoff labels`,
    ride?.route?.pickupLabel === 'Метро Юго-Западная' && ride?.route?.dropoffLabel === 'ТЦ Реутов Парк');
  expect(`${label}: price reflects the real driverPrice (1900), not a MOCK_ROUTE literal`,
    /900/.test(ride?.order?.offerPrice || '') && ride?.order?.offerPrice !== handoffMod.MOCK_ROUTE.priceRub);
}

// ── D. selectedDriver.responseId stays pinned on both paths ───────────
expect('path 1 selectedDriver.responseId pins the real response id',
  rideA?.selectedDriver?.responseId === EQUIV_RESPONSE.id);
expect('path 2 selectedDriver.responseId pins the real response id',
  rideB?.selectedDriver?.responseId === EQUIV_RESPONSE.id);

// ── E. CREATED-order canonical confirmation path (BD-RIDE-AUTHORITY-01C closure) ──
// The canonical chat-confirm chain (respond.js -> chat.js ->
// trip_confirmation.js) never accepts the order itself — proven by source
// audit, not assumed here. This drives a genuinely CREATED order through
// the real confirmation orchestration and asserts the forbidden state
// (order CREATED + a persisted DRIVER_EN_ROUTE ride) never results: the
// orchestration must accept the order before persisting the ride.
resetStorage();
const createdOrder = await mockApi.createRideOrder({
  pickup: { label: 'ул. Начальная, 1' },
  dropoff: { label: 'ул. Конечная, 2' },
  estimatedPrice: 1400,
  passenger: { name: 'Ожидающий Пассажир', authorId: 'user_created_1', isCurrentUser: true },
});
expect('fixture order starts CREATED (not pre-accepted)',
  mockApi.getOrderById(createdOrder.id)?.status === 'CREATED');

const CREATED_CASE_RESPONSE = {
  id: 'resp_created_case_1',
  kind: 'passenger_response',
  tripId: `trip_${createdOrder.id}`,
  requestId: createdOrder.id,
  orderId: createdOrder.id,
  canonical: 'ride_order',
  driverPrice: 1500,
  pickupTiming: 'at_time',
  message: 'ожидаю подтверждения',
  vehicleId: 'veh_created_1',
  driverSnapshot: {
    name: 'Ожидающий Водитель',
    rating: 4.6,
    car: 'Renault Logan · серебристый',
    carModel: 'Renault Logan',
    carColor: 'серебристый',
    plate: 'О 555 ОО 77',
  },
  status: 'SENT',
  createdAt: new Date().toISOString(),
};
{
  const map = JSON.parse(localStorage.getItem(RESPONSES_KEY) || '{}');
  map[CREATED_CASE_RESPONSE.id] = CREATED_CASE_RESPONSE;
  localStorage.setItem(RESPONSES_KEY, JSON.stringify(map));
}
const createdCaseTripId = `trip_${createdOrder.id}`;
{
  const map = JSON.parse(localStorage.getItem(TRIP_CONFIRM_KEY) || '{}');
  map[createdCaseTripId] = {
    tripId: createdCaseTripId,
    role: 'passenger',
    state: 'CONFIRMED',
    responseId: CREATED_CASE_RESPONSE.id,
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 5 * 60_000,
  };
  localStorage.setItem(TRIP_CONFIRM_KEY, JSON.stringify(map));
}

const createdCaseRide = handoffMod.loadCanonicalActiveRide({ tripId: createdCaseTripId, role: 'passenger' });
expect('confirmation orchestration builds a ride from a CREATED order', !!createdCaseRide);
expect('resulting ride.status is DRIVER_EN_ROUTE',
  createdCaseRide?.status === rideState.RIDE_STATUS.DRIVER_EN_ROUTE);
const orderAfterConfirm = mockApi.getOrderById(createdOrder.id);
expect('order.status is ACCEPTED after confirmation orchestration (never left CREATED)',
  orderAfterConfirm?.status === 'ACCEPTED');
expect('order.acceptedAt was stamped by the accept step',
  typeof orderAfterConfirm?.acceptedAt === 'string' && orderAfterConfirm.acceptedAt.length > 0);
// The forbidden combination, checked directly: a persisted DRIVER_EN_ROUTE
// ride must never coexist with a CREATED order.
expect('forbidden state does not occur: order CREATED + persisted DRIVER_EN_ROUTE ride',
  !(orderAfterConfirm?.status === 'CREATED'
    && rideState.findActiveRide(createdCaseTripId)?.status === rideState.RIDE_STATUS.DRIVER_EN_ROUTE));

// ── F. Broken linkage still refuses a MOCK fallback (this file's own minimal case) ──
// Full 5-case coverage (missing response, no orderId link, order gone, no
// driver snapshot, tripId mismatch) already lives in
// smoke-confirm-handoff-active-ride.mjs; this is a single, self-contained
// case here so this file's own checklist doesn't depend on a sibling file.
resetStorage();
const brokenTripId = 'trip_broken-linkage-order-1';
{
  const map = JSON.parse(localStorage.getItem(TRIP_CONFIRM_KEY) || '{}');
  map[brokenTripId] = {
    tripId: brokenTripId,
    role: 'passenger',
    state: 'CONFIRMED',
    responseId: 'resp_does_not_exist_anywhere',
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 5 * 60_000,
  };
  localStorage.setItem(TRIP_CONFIRM_KEY, JSON.stringify(map));
}
const brokenRide = handoffMod.loadCanonicalActiveRide({ tripId: brokenTripId, role: 'passenger' });
expect('broken linkage (unresolvable responseId) returns null, not a ride', brokenRide === null);
expect('broken linkage persists nothing under this tripId',
  rideState.findActiveRide(brokenTripId) === null);

// ── G. BD-RIDE-ACCEPT-RESPONSE-01 — shared acceptDriverResponse command ──
// Extract a function body by name via brace matching (same pattern used in
// smoke-chat-handoff.mjs), so an assertion scoped to one function does not
// accidentally inspect a sibling with a similar name.
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

expect('ride_actions.js exports acceptDriverResponse',
  typeof rideActions.acceptDriverResponse === 'function');
const acceptDriverResponseBody = functionBody(rideActionsSrc, 'acceptDriverResponse') || '';
expect('acceptDriverResponse() body resolved', acceptDriverResponseBody.length > 0);
expect('acceptDriverResponse computes only the canonical trip_<orderId> (no caller-supplied tripId parameter)',
  !/function\s+acceptDriverResponse\s*\([^)]*tripId/.test(rideActionsSrc)
  && /const\s+tripId\s*=\s*`trip_\$\{orderId\}`/.test(acceptDriverResponseBody));
expect('acceptDriverResponse accepts the order only if still CREATED',
  /order\.status\s*===\s*'CREATED'\s*\?\s*acceptOrder\(/.test(acceptDriverResponseBody));
expect('acceptDriverResponse builds via the pure buildPassengerRideSeed(…)',
  /buildPassengerRideSeed\(/.test(acceptDriverResponseBody));
expect('acceptDriverResponse verifies the built Ride against the canonical tripId before persisting',
  /ride\.tripId\s*!==\s*tripId/.test(acceptDriverResponseBody));
expect('acceptDriverResponse persists via saveActiveRide(…) and returns its result',
  /return\s+saveActiveRide\(\s*ride\s*\)/.test(acceptDriverResponseBody));
expect('acceptDriverResponse never looks up a response (no response-store read)',
  !/resolveResponseById\(|loadAllResponses\(/.test(acceptDriverResponseBody));
expect('acceptDriverResponse never calls the backend, navigates, or touches the DOM',
  !/selectOfferOnBackend\(|apiFetch\(|fetch\(|\bgo\(|document\.|window\./.test(acceptDriverResponseBody));

expect('responses.js imports acceptDriverResponse from ../ride_actions.js',
  /import\s*\{\s*acceptDriverResponse\s*\}\s*from\s*'\.\.\/ride_actions\.js'/.test(responsesSrc));
const buildPassengerActiveRideBody = functionBody(responsesSrc, 'buildPassengerActiveRide') || '';
expect('buildPassengerActiveRide() body resolved', buildPassengerActiveRideBody.length > 0);
expect('responses.js call site 1: buildPassengerActiveRide delegates the accept/build/save tail to acceptDriverResponse(order, request, driver)',
  /acceptDriverResponse\(\s*order\s*,\s*request\s*,\s*driver\s*\)/.test(buildPassengerActiveRideBody));
expect('buildPassengerActiveRide keeps its own existing-ride idempotency short-circuit (identity/idempotency stay with the caller)',
  /findActiveRide\(/.test(buildPassengerActiveRideBody) && /reused:\s*true/.test(buildPassengerActiveRideBody));

expect('trip_confirmation_handoff.js imports acceptDriverResponse from ../ride_actions.js',
  /import\s*\{\s*acceptDriverResponse\s*\}\s*from\s*'\.\.\/ride_actions\.js'/.test(handoffSrc));
const seedRealActiveRideFromHandoffBody = functionBody(handoffSrc, 'seedRealActiveRideFromHandoff') || '';
expect('seedRealActiveRideFromHandoff() body resolved', seedRealActiveRideFromHandoffBody.length > 0);
expect('responses.js call site 2: seedRealActiveRideFromHandoff delegates the accept/build/save tail to acceptDriverResponse(order, request, driver)',
  /acceptDriverResponse\(\s*order\s*,\s*request\s*,\s*driver\s*\)/.test(seedRealActiveRideFromHandoffBody));
expect('seedRealActiveRideFromHandoff keeps its own responseId/order/tripId/driver-snapshot identity resolution (identity stays with the caller)',
  /resolveResponseById\(/.test(seedRealActiveRideFromHandoffBody)
  && /getOrderById\(/.test(seedRealActiveRideFromHandoffBody)
  && /`trip_\$\{orderId\}`\s*!==\s*tripId/.test(seedRealActiveRideFromHandoffBody));

// Backend-select-before-local-bridge ordering: find the unique
// `await selectOfferOnBackend(` call site and walk back to its enclosing
// `if (backendAuthoritative) {` block (the file has an unrelated
// `if (backendAuthoritative)` branch in buildDriversForOrder() earlier in
// the file, so anchoring off the unique backend-select call site — not a
// bare first-match on the branch text — is what keeps this pin scoped to
// the actual select handler).
{
  const selectCallMatches = responsesSrc.match(/await\s+selectOfferOnBackend\s*\(/g) || [];
  expect('responses.js calls await selectOfferOnBackend(…) exactly once',
    selectCallMatches.length === 1,
    `count=${selectCallMatches.length}`);
  const selectIdx = responsesSrc.indexOf('await selectOfferOnBackend(');
  const branchStart = responsesSrc.lastIndexOf('if (backendAuthoritative) {', selectIdx);
  expect('backend-select call site sits inside an if (backendAuthoritative) branch', branchStart !== -1);
  const open = responsesSrc.indexOf('{', branchStart);
  let depth = 0;
  let branchEnd = -1;
  for (let i = open; i < responsesSrc.length; i++) {
    const ch = responsesSrc[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { branchEnd = i + 1; break; }
    }
  }
  const branchBody = branchEnd !== -1 ? responsesSrc.slice(open, branchEnd) : '';
  expect('backendAuthoritative select branch resolved', branchBody.length > 0);
  const iSelect = branchBody.indexOf('await selectOfferOnBackend(');
  const iBridge = branchBody.indexOf('buildPassengerActiveRide(');
  expect('responses.js: backend select (await selectOfferOnBackend) happens before the local active-ride bridge (buildPassengerActiveRide)',
    iSelect !== -1 && iBridge !== -1 && iSelect < iBridge,
    `iSelect=${iSelect} iBridge=${iBridge}`);
}

// Behavioural: acceptDriverResponse itself performs local accept/build/save
// and never mutates the response store.
resetStorage();
const gOrder = await mockApi.createRideOrder({
  pickup: { label: 'ул. Командная, 1' },
  dropoff: { label: 'ул. Общая, 2' },
  estimatedPrice: 1600,
  passenger: { name: 'Командный Пассажир', authorId: 'user_cmd_1', isCurrentUser: true },
});
expect('behavioural fixture order starts CREATED', mockApi.getOrderById(gOrder.id)?.status === 'CREATED');
const gRequest = responses.requestFromOrder(mockApi.getOrderById(gOrder.id));
const gDriver = { id: 'drv_cmd_1', responseId: 'resp_cmd_1', name: 'Командный Водитель', rating: '4,90', car: 'Kia Rio · синий', carModel: 'Kia Rio', carColor: 'синий', plate: 'К 001 КК 01', eta: '4 мин', price: '1 650 ₽', note: 'принято' };
expect('response store starts empty', localStorage.getItem(RESPONSES_KEY) === null);
const gRide = rideActions.acceptDriverResponse(gOrder, gRequest, gDriver);
expect('acceptDriverResponse returns a saved Ride', !!gRide && gRide.tripId === `trip_${gOrder.id}`);
expect('acceptDriverResponse persisted the Ride under the canonical tripId',
  !!rideState.findActiveRide(`trip_${gOrder.id}`));
expect('acceptDriverResponse accepted the CREATED order as a side effect',
  mockApi.getOrderById(gOrder.id)?.status === 'ACCEPTED');
expect('acceptDriverResponse never mutated the response store (still empty)',
  localStorage.getItem(RESPONSES_KEY) === null);
expect('acceptDriverResponse returns null for an order with no id', rideActions.acceptDriverResponse({}, gRequest, gDriver) === null);
expect('acceptDriverResponse returns null for a missing order', rideActions.acceptDriverResponse(null, gRequest, gDriver) === null);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
