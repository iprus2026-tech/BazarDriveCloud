// BD-RIDE-AUTHORITY-01D — response_store.js + ride_context.js contract guard.
//
// trip_confirmation_handoff.js no longer imports anything from
// responses.js: response resolution moved to response_store.js (exact-key
// lookup only) and request/driver context shaping moved to ride_context.js
// (pure, screen-import-free). responses.js's own requestFromOrder /
// mapResponseToDriverCard become thin wrappers over the same shared core.
//
// This smoke combines behavioural round-trips (response_store, ride_context,
// the confirmation flow) with static structural pins (purity, zero
// screen-to-screen import) and a responses.js regression check proving the
// wrapper refactor did not change /responses' own observable output.

import fs from 'node:fs';

const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { _store.delete(k); },
  clear: () => { _store.clear(); },
};

const root = new URL('../public/src/', import.meta.url);
const responseStore = await import(new URL('response_store.js', root).href);
const rideContext   = await import(new URL('ride_context.js', root).href);
const rideState     = await import(new URL('ride_state.js', root).href);
const mockApi       = await import(new URL('mock_api.js', root).href);
const responses     = await import(new URL('screens/responses.js', root).href);
const handoffMod    = await import(new URL('screens/trip_confirmation_handoff.js', root).href);

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const responseStoreSrc = read('../public/src/response_store.js');
const rideContextSrc   = read('../public/src/ride_context.js');
const handoffSrc       = read('../public/src/screens/trip_confirmation_handoff.js');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const rideContextCode = stripComments(rideContextSrc);

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
function setResponse(response) {
  const map = JSON.parse(localStorage.getItem(RESPONSES_KEY) || '{}');
  map[response.id] = response;
  localStorage.setItem(RESPONSES_KEY, JSON.stringify(map));
}

// ═══════════════════════════════════════════════════════════════════════
// A. response_store — exact-key lookup only, no fallback
// ═══════════════════════════════════════════════════════════════════════
resetStorage();
const REAL_RESPONSE = {
  id: 'resp_01d_exact_1',
  kind: 'passenger_response',
  orderId: 'order-01d-1',
  driverPrice: 1600,
  pickupTiming: 'earlier',
  message: 'точное совпадение по id',
  driverSnapshot: { name: 'Точный Водитель', rating: 4.5, car: 'Kia Rio', carModel: 'Kia Rio', carColor: 'красный', plate: 'Т 001 ТТ 77' },
  status: 'SENT',
  createdAt: new Date().toISOString(),
};
setResponse(REAL_RESPONSE);
// A different, similarly-shaped response — proves lookup does not fall
// back to "closest" or "latest" when the exact id doesn't match.
setResponse({ ...REAL_RESPONSE, id: 'resp_01d_other_1', message: 'другой отклик' });

expect('exact id -> exact passenger_response',
  responseStore.resolveResponseById('resp_01d_exact_1')?.message === 'точное совпадение по id');
expect('missing id -> null',
  responseStore.resolveResponseById('resp_does_not_exist_01d') === null);
expect('empty/non-string id -> null',
  responseStore.resolveResponseById('') === null && responseStore.resolveResponseById(undefined) === null);
{
  const wrongKind = { ...REAL_RESPONSE, id: 'resp_01d_wrong_kind', kind: 'something_else' };
  setResponse(wrongKind);
  expect('wrong kind -> null', responseStore.resolveResponseById('resp_01d_wrong_kind') === null);
}
{
  localStorage.setItem(RESPONSES_KEY, '{not valid json');
  expect('malformed storage -> null (does not throw)', responseStore.resolveResponseById('resp_01d_exact_1') === null);
}
{
  localStorage.removeItem(RESPONSES_KEY);
  expect('no storage at all -> null', responseStore.resolveResponseById('resp_01d_exact_1') === null);
}
// No fallback lookup: a near-miss id (prefix/suffix of a real one) must
// not resolve to the real entry.
resetStorage();
setResponse(REAL_RESPONSE);
expect('near-miss id (prefix of a real id) does not fall back to it',
  responseStore.resolveResponseById('resp_01d_exact') === null);
expect('RESPONSES_KEY exported and matches the canonical literal',
  responseStore.RESPONSES_KEY === 'bazardrive.responses.v1');

// ═══════════════════════════════════════════════════════════════════════
// B. ride_context.js — structural purity
// ═══════════════════════════════════════════════════════════════════════
for (const forbidden of [
  'localStorage', 'apiFetch', 'fetch(', 'document.', 'window.',
  "from './responses.js'", "from '../screens/", 'go(', 'toast(', 'alert(',
  'MOCK_REQUEST', 'MOCK_DRIVER', 'MOCK_PASSENGER', 'MOCK_ROUTE', 'MOCK_VEHICLE',
  'acceptOrder', 'saveActiveRide', 'getOrderById', 'resolveResponseById',
]) {
  expect(`ride_context.js never references "${forbidden}" (pure, no screen/storage/backend/UI)`,
    !rideContextCode.includes(forbidden));
}
expect('ride_context.js has zero import statements (true leaf, no dependencies at all)',
  !/^import\s/m.test(rideContextSrc));
expect('ride_context.js exports buildRideRequestContext', typeof rideContext.buildRideRequestContext === 'function');
expect('ride_context.js exports buildRideDriverContext', typeof rideContext.buildRideDriverContext === 'function');

// response_store.js — same purity bar minus storage (it IS the storage owner).
const responseStoreCode = stripComments(responseStoreSrc);
for (const forbidden of ["from './", "from '../screens/", 'apiFetch', 'fetch(', 'document.', 'window.', 'go(', 'toast(']) {
  expect(`response_store.js never references "${forbidden}" (leaf, no screen/UI/backend imports)`,
    !responseStoreCode.includes(forbidden));
}

// ═══════════════════════════════════════════════════════════════════════
// C. Canonical context — exact expected values for a real order + response
// ═══════════════════════════════════════════════════════════════════════
const CTX_ORDER = {
  id: 'order-01d-ctx-1',
  status: 'ACCEPTED',
  pickup: { label: 'ул. Контекстная, 5' },
  dropoff: { label: 'пр. Канонический, 9' },
  comment: 'контекстный комментарий',
  estimatedPrice: 2100,
};
const CTX_RESPONSE = {
  id: 'resp_01d_ctx_1',
  kind: 'passenger_response',
  orderId: CTX_ORDER.id,
  driverPrice: 2200,
  pickupTiming: 'negotiate',
  message: 'контекстное сообщение',
  driverSnapshot: {
    name: 'Контекстный Водитель',
    rating: 4.65,
    car: 'Skoda Rapid · зелёный',
    carModel: 'Skoda Rapid',
    carColor: 'зелёный',
    plate: 'К 555 КК 77',
  },
  status: 'SENT',
  createdAt: new Date().toISOString(),
};

const requestContext = rideContext.buildRideRequestContext(CTX_ORDER);
expect('buildRideRequestContext.pickupLabel exact match', requestContext.pickupLabel === 'ул. Контекстная, 5');
expect('buildRideRequestContext.dropoffLabel exact match', requestContext.dropoffLabel === 'пр. Канонический, 9');
expect('buildRideRequestContext.price exact match', requestContext.price === `${(2100).toLocaleString('ru-RU')} ₽`);
expect('buildRideRequestContext.note exact match', requestContext.note === 'контекстный комментарий');
expect('buildRideRequestContext has exactly the 4 canonical fields (no UI/screen extras)',
  JSON.stringify(Object.keys(requestContext).sort()) === JSON.stringify(['dropoffLabel', 'note', 'pickupLabel', 'price'].sort()));

const driverContext = rideContext.buildRideDriverContext(CTX_RESPONSE, requestContext);
expect('buildRideDriverContext.responseId exact match', driverContext.responseId === 'resp_01d_ctx_1');
expect('buildRideDriverContext.id exact match', driverContext.id === 'resp_01d_ctx_1');
expect('buildRideDriverContext.name exact match', driverContext.name === 'Контекстный Водитель');
expect('buildRideDriverContext.initials exact match', driverContext.initials === 'К');
expect('buildRideDriverContext.rating exact match', driverContext.rating === (4.65).toFixed(1));
expect('buildRideDriverContext.car exact match', driverContext.car === 'Skoda Rapid · зелёный');
expect('buildRideDriverContext.carModel exact match', driverContext.carModel === 'Skoda Rapid');
expect('buildRideDriverContext.carColor exact match', driverContext.carColor === 'зелёный');
expect('buildRideDriverContext.plate exact match', driverContext.plate === 'К 555 КК 77');
expect('buildRideDriverContext.price exact match (formatted driverPrice, not \'—\'/placeholder)',
  driverContext.price === `${(2200).toLocaleString('ru-RU')} ₽`);
expect('buildRideDriverContext.eta exact match ("Договоримся" for negotiate)', driverContext.eta === 'Договоримся');
expect('buildRideDriverContext.note exact match', driverContext.note === 'контекстное сообщение');
expect('buildRideDriverContext has exactly the 12 canonical fields (no UI extras like avatarTone/isBest)',
  JSON.stringify(Object.keys(driverContext).sort())
  === JSON.stringify(['id', 'responseId', 'name', 'initials', 'rating', 'car', 'carModel', 'carColor', 'plate', 'price', 'eta', 'note'].sort()));

// ═══════════════════════════════════════════════════════════════════════
// D. responses.js regression — full observable output stays equivalent
// ═══════════════════════════════════════════════════════════════════════
// Real-order branch: every field requestFromOrder/mapResponseToDriverCard
// produced before the extraction, checked against literal expected values
// (not just "still calls X()") — a shared bug in both the wrapper and the
// core could otherwise still pass a same-file-only comparison.
const fullRequest = responses.requestFromOrder(CTX_ORDER);
expect('requestFromOrder (real order): id/orderId/passengerId/status/time/numericPrice screen fields still present',
  fullRequest.id === CTX_ORDER.id
  && fullRequest.orderId === CTX_ORDER.id
  && fullRequest.status === 'PUBLISHED'
  && typeof fullRequest.time === 'string'
  && fullRequest.numericPrice === 2100
  && fullRequest.isFallback === false);
expect('requestFromOrder (real order): pickupLabel/dropoffLabel/note match the shared core exactly',
  fullRequest.pickupLabel === requestContext.pickupLabel
  && fullRequest.dropoffLabel === requestContext.dropoffLabel
  && fullRequest.note === requestContext.note);
expect('requestFromOrder (real order): price falls through core.price (no MOCK_REQUEST.price leak for a valid price)',
  fullRequest.price === requestContext.price && !fullRequest.price.includes('950'));

const fullDriver = responses.mapResponseToDriverCard(CTX_RESPONSE, fullRequest, 0);
expect('mapResponseToDriverCard (real response): UI-only fields present and correctly valued',
  fullDriver.avatarTone === 'mint'
  && fullDriver.priceDelta === ''
  && fullDriver.priceTone === 'same'
  && fullDriver.etaTone === 'mid'
  && fullDriver.etaBars === 2
  && fullDriver.etaRank === 2 // negotiate
  && fullDriver.trips === ''
  && fullDriver.isBest === true);
expect('mapResponseToDriverCard (real response): identity/price/eta/note match the shared core exactly',
  fullDriver.responseId === driverContext.responseId
  && fullDriver.name === driverContext.name
  && fullDriver.price === driverContext.price
  && fullDriver.eta === driverContext.eta
  && fullDriver.note === driverContext.note);

// !order fallback branch — fully screen-owned, untouched by the extraction.
const fallbackRequest = responses.requestFromOrder(null, 'some-order-id');
expect('requestFromOrder(!order) fallback branch unchanged (MOCK-style empty state)',
  fallbackRequest.isFallback === true
  && fallbackRequest.pickupLabel === 'Заказ не найден'
  && fallbackRequest.price === '—');
const fallbackRequestNoId = responses.requestFromOrder(null, '');
expect('requestFromOrder(!order, no explicit id) fallback branch unchanged',
  fallbackRequestNoId.pickupLabel === 'Заказ пока не выбран');

// ═══════════════════════════════════════════════════════════════════════
// E. Confirmation — real order + response -> canonical Ride
// ═══════════════════════════════════════════════════════════════════════
resetStorage();
const order = await mockApi.createRideOrder({
  pickup: { label: 'ул. Подтверждённая, 1' },
  dropoff: { label: 'пр. Заключительный, 2' },
  estimatedPrice: 1750,
  passenger: { name: 'Финальный Пассажир', authorId: 'user_01d_final', isCurrentUser: true },
});
const accepted = mockApi.acceptOrder(order.id);
expect('E fixture: order accepted before confirmation runs', accepted?.status === 'ACCEPTED');
const E_RESPONSE = {
  id: 'resp_01d_final_1',
  kind: 'passenger_response',
  orderId: order.id,
  driverPrice: 1800,
  pickupTiming: 'at_time',
  message: 'финальное сообщение',
  driverSnapshot: { name: 'Финальный Водитель', rating: 4.9, car: 'Toyota Corolla · синий', carModel: 'Toyota Corolla', carColor: 'синий', plate: 'Ф 999 ФФ 77' },
  status: 'SENT',
  createdAt: new Date().toISOString(),
};
setResponse(E_RESPONSE);
const eTripId = `trip_${order.id}`;
{
  const map = JSON.parse(localStorage.getItem(TRIP_CONFIRM_KEY) || '{}');
  map[eTripId] = { tripId: eTripId, role: 'passenger', state: 'CONFIRMED', responseId: E_RESPONSE.id, createdAt: Date.now() - 1000, expiresAt: Date.now() + 5 * 60_000 };
  localStorage.setItem(TRIP_CONFIRM_KEY, JSON.stringify(map));
}
const finalRide = handoffMod.loadCanonicalActiveRide({ tripId: eTripId, role: 'passenger' });
expect('E: confirmation builds a ride', !!finalRide);
expect('E: tripId === trip_<orderId>', finalRide?.tripId === eTripId);
expect('E: orderId === order.id', finalRide?.orderId === order.id);
expect('E: status === DRIVER_EN_ROUTE', finalRide?.status === rideState.RIDE_STATUS.DRIVER_EN_ROUTE);
expect('E: passenger.name === real order.passenger.name', finalRide?.passenger?.name === 'Финальный Пассажир');
expect('E: driver.name === real response.driverSnapshot.name', finalRide?.driver?.name === 'Финальный Водитель');
expect('E: vehicle.model/plate === real response.driverSnapshot fields', finalRide?.vehicle?.model === 'Toyota Corolla' && finalRide?.vehicle?.plate === 'Ф 999 ФФ 77');
expect('E: route.pickupLabel/dropoffLabel === real order labels', finalRide?.route?.pickupLabel === 'ул. Подтверждённая, 1' && finalRide?.route?.dropoffLabel === 'пр. Заключительный, 2');
expect('E: price exact match (real driverPrice 1800, formatted)',
  finalRide?.order?.offerPrice === `${(1800).toLocaleString('ru-RU')} ₽`);
expect('E: selectedDriver.responseId pinned to the real response id', finalRide?.selectedDriver?.responseId === E_RESPONSE.id);

// ═══════════════════════════════════════════════════════════════════════
// F. Broken linkage — no MOCK fallback
// ═══════════════════════════════════════════════════════════════════════
resetStorage();
const brokenTripId = 'trip_broken-01d-1';
{
  const map = JSON.parse(localStorage.getItem(TRIP_CONFIRM_KEY) || '{}');
  map[brokenTripId] = { tripId: brokenTripId, role: 'passenger', state: 'CONFIRMED', responseId: 'resp_never_written', createdAt: Date.now() - 1000, expiresAt: Date.now() + 5 * 60_000 };
  localStorage.setItem(TRIP_CONFIRM_KEY, JSON.stringify(map));
}
const brokenRide = handoffMod.loadCanonicalActiveRide({ tripId: brokenTripId, role: 'passenger' });
expect('F: broken linkage returns null, not a ride', brokenRide === null);
expect('F: nothing persisted under this tripId', rideState.findActiveRide(brokenTripId) === null);

// ═══════════════════════════════════════════════════════════════════════
// G. Structural invariant — zero screen-to-screen import
// ═══════════════════════════════════════════════════════════════════════
expect("G: trip_confirmation_handoff.js source contains no import from './responses.js'",
  !/from\s*'\.\/responses\.js'/.test(handoffSrc));
// Comment-stripped: doc comments are allowed to mention responses.js by
// name for historical context (e.g. "no longer imports X from
// ./responses.js") — only an actual import/require statement is forbidden.
const handoffCode = stripComments(handoffSrc);
expect('G: trip_confirmation_handoff.js CODE (comments stripped) contains no import/require of responses.js',
  !/(?:import[\s\S]{0,200}from\s*'\.\/responses\.js'|require\(\s*'\.\/responses\.js'\s*\))/.test(handoffCode));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
