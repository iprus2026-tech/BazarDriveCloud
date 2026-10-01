// BD-MAP-DUAL-EXPERIENCE-01B — source-only route/order data.
// Execute the shipped seeds and both screen hydration functions; isolated storage.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
};
const { createDemoActiveRide, createActiveRideSeed, SIM_AUDIT_RIDE_OVERRIDES, RIDE_STATUS, saveActiveRide, findActiveRide, updateActiveRideStatus } = await import('../public/src/ride_state.js');
const { seedActiveRideFromAcceptedOrder, buildRideFromPost } = await import('../public/src/ride_actions.js');
const { buildPassengerRideSeed } = await import('../public/src/ride_seed.js');
const { applyDriverHandoffSnapshotToRide } = await import('../public/src/screens/driver_handoff_snapshot.js');

let passed = 0;
const failures = [];
function test(name, check) {
  try { check(); passed++; console.log(`PASS — ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL — ${name}: ${error.message}`); }
}
const clone = (value) => structuredClone(value);
const order = {
  id: 'route-source-order',
  pickup: { label: 'Марфино', lat: 56.08549, lng: 37.54584, provenance: 'user_pin', entrance: '2' },
  dropoff: { label: 'Лобня', lat: 56.012, lng: 37.475, provenance: 'mock_hash' },
  estimatedPrice: 500,
  durationMin: 24,
  distanceKm: 11,
  acceptedAt: '2026-09-30T10:00:00Z',
};
const request = { pickupLabel: order.pickup.label, dropoffLabel: order.dropoff.label, price: '500 ₽', note: '' };
const driver = { id: 'route-source-driver', name: 'Тест', price: '500 ₽', eta: '6 мин' };
function sourceRides(source = order) {
  return [seedActiveRideFromAcceptedOrder(source).ride, buildPassengerRideSeed(source, request, driver)];
}
function noDemoRoute(ride) {
  for (const key of ['currentInstruction', 'currentStreet', 'distanceToPickup']) {
    assert.ok(ride.route[key] == null, `unexpected route.${key}: ${ride.route[key]}`);
  }
  for (const key of ['rate', 'commission', 'tags', 'pickupDistance', 'destinationNote']) {
    assert.ok(ride.order[key] == null, `unexpected order.${key}: ${ride.order[key]}`);
  }
}

test('driver and passenger preserve the exact same canonical points and provenance', () => {
  const before = clone(order);
  for (const ride of sourceRides()) {
    assert.deepEqual(ride.route.pickup, order.pickup);
    assert.deepEqual(ride.route.dropoff, order.dropoff);
    assert.equal(ride.route.pickupLabel, order.pickup.label);
    assert.equal(ride.route.dropoffLabel, order.dropoff.label);
    noDemoRoute(ride);
  }
  assert.deepEqual(order, before);
});
test('known estimates survive without invented pickup ETA', () => {
  const [accepted, passenger] = sourceRides();
  for (const ride of [accepted, passenger]) {
    assert.equal(ride.route.etaToDestination, '24 мин');
    assert.equal(ride.order.destinationDistance, '11 км');
  }
  assert.ok(accepted.route.etaToPickup == null);
  assert.ok(accepted.order.pickupEta == null);
  assert.equal(passenger.route.etaToPickup, driver.eta);
  assert.equal(passenger.order.pickupEta, driver.eta);
});
test('label-only points never acquire coordinates from the demo', () => {
  const source = { ...order, pickup: { label: 'Только адрес' }, dropoff: { label: 'Без координат' } };
  for (const ride of sourceRides(source)) {
    assert.deepEqual(ride.route.pickup, source.pickup);
    assert.deepEqual(ride.route.dropoff, source.dropoff);
  }
});
test('missing points remain absent and unknown duration never becomes a demo ETA', () => {
  const source = { ...order, pickup: null, dropoff: null, durationMin: 0, distanceKm: 0 };
  for (const ride of sourceRides(source)) {
    assert.equal(ride.route.pickup, null);
    assert.equal(ride.route.dropoff, null);
    assert.ok(ride.route.etaToDestination == null || ride.route.etaToDestination === '—');
    assert.ok(ride.order.destinationEta == null || ride.order.destinationEta === '—');
    noDemoRoute(ride);
  }
});
test('plain-post acceptance carries only source route/order data', () => {
  const post = { id: 'route-source-post', from: 'Марфино', to: 'Лобня', price: '500 ₽', pickup: order.pickup, dropoff: order.dropoff };
  const before = clone(post);
  const ride = buildRideFromPost(post);
  assert.equal(ride.route.pickupLabel, post.from);
  assert.equal(ride.route.dropoffLabel, post.to);
  assert.deepEqual(ride.route.pickup, post.pickup);
  assert.deepEqual(ride.route.dropoff, post.dropoff);
  assert.equal(ride.order.offerPrice, post.price);
  noDemoRoute(ride);
  const empty = buildRideFromPost({ id: 'label-only', from: 'Адрес' });
  assert.equal(empty.route.pickup, null);
  assert.equal(empty.route.dropoff, null);
  assert.ok(empty.route.etaToPickup == null);
  assert.ok(empty.route.etaToDestination == null);
  assert.deepEqual(post, before);
});
test('seed change preserves trip identity, lifecycle and accepted timestamp', () => {
  const [accepted, passenger] = sourceRides();
  assert.equal(accepted.tripId, `trip_${order.id}`);
  assert.equal(passenger.tripId, accepted.tripId);
  assert.equal(accepted.status, RIDE_STATUS.ACCEPTED);
  assert.equal(passenger.status, RIDE_STATUS.DRIVER_EN_ROUTE);
  for (const ride of [accepted, passenger]) {
    assert.equal(ride.timestamps.acceptedAt, order.acceptedAt);
    assert.equal(ride.waiting.remaining, null);
    assert.equal(ride.waiting.paidStartsAt, null);
  }
});

// Run actual nested merger bodies with their dependencies, not copied logic.
// Browser QA additionally mounts both screens and checks visible presentation.
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unclosed ${name}`);
}
const statusRank = { ACCEPTED: 1, DRIVER_EN_ROUTE: 2, DRIVER_APPROACHING_PICKUP: 3, WAITING_PASSENGER: 4, IN_PROGRESS: 5, COMPLETED: 6 };
for (const [role, file] of [['driver', 'active_ride.js'], ['passenger', 'active_ride_passenger.js']]) {
  const source = fs.readFileSync(new URL(`../public/src/screens/${file}`, import.meta.url), 'utf8');
  test(`${role} confirmed handoff without a canonical record starts from source-only route data`, () => {
    assert.ok(source.includes("?.provenance === 'confirmed_handoff'\n      ? createActiveRideSeed({ tripId, ...overrides, route: {}, order: {} })"));
    const ride = applyDriverHandoffSnapshotToRide(
      createActiveRideSeed({ tripId: 'handoff_real', ...SIM_AUDIT_RIDE_OVERRIDES, route: {}, order: {} }),
      { tripId: 'handoff_real', provenance: 'confirmed_handoff', pickupLabel: 'Марфино', dropoffLabel: 'Лобня' },
    );
    assert.equal(ride.acceptedSource, 'driver_handoff');
    assert.equal(ride.route.pickupLabel, 'Марфино');
    assert.ok(ride.route.pickup == null);
    assert.ok(ride.route.dropoff == null);
    noDemoRoute(ride);
  });
  const waiting = Function(`return ${extractFunction(source, 'mergeServerWaiting')}`)();
  const merge = (local, srv, preserve = false, pending = null) => Function(
    'ride', 'pendingStatus', 'STATUS_RANK', 'initialsFromName', 'mergeServerWaiting',
    `return ${extractFunction(source, 'mergeServerRide')}`,
  )(local, pending, statusRank, (name) => name ? name.charAt(0) : '', waiting)(srv, preserve);
  const server = {
    tripId: `trip_server_${role}`,
    status: RIDE_STATUS.DRIVER_EN_ROUTE,
    route: { pickupLabel: 'Серверная подача', dropoffLabel: 'Серверное назначение', etaToPickup: '8 мин', etaToDestination: null },
    order: { offerPrice: '850 ₽' },
  };
  test(`${role} direct entry: authoritative hydration clears every omitted demo field`, () => {
    storage.clear();
    const local = createDemoActiveRide({ tripId: server.tripId, localProvenance: 'sim_audit' });
    const before = clone(local);
    const hydrated = merge(local, server);
    assert.equal(storage.size, 0, 'hydration must remain a pure projection');
    assert.equal(hydrated.tripId, server.tripId);
    assert.equal(hydrated.status, server.status);
    assert.equal(hydrated.route.pickupLabel, server.route.pickupLabel);
    assert.equal(hydrated.route.dropoffLabel, server.route.dropoffLabel);
    assert.equal(hydrated.route.etaToPickup, '8 мин');
    assert.equal(hydrated.route.etaToDestination, null);
    assert.equal(hydrated.order.offerPrice, '850 ₽');
    assert.ok(hydrated.route.pickup == null);
    assert.ok(hydrated.route.dropoff == null);
    assert.equal(hydrated.localProvenance, undefined);
    noDemoRoute(hydrated);
    assert.deepEqual(local, before);
  });
  test(`${role} null/missing server route/order never falls back to a stored source or demo`, () => {
    for (const shape of [{}, { route: null, order: null }, { route: {}, order: {} }]) {
      const local = sourceRides()[0];
      const hydrated = merge(local, { tripId: local.tripId, status: local.status, ...shape });
      assert.ok(Object.values(hydrated.route).every((value) => value == null));
      assert.ok(Object.values(hydrated.order).every((value) => value == null));
    }
  });
  test(`${role} actual server points/guidance/tags survive, then disappear on a later omission`, () => {
    const sourceRoute = { ...server.route, pickup: order.pickup, dropoff: order.dropoff, currentInstruction: 'Подтверждённый манёвр', currentStreet: 'Улица из ответа', distanceToPickup: '5 км' };
    const sourceOrder = { ...server.order, pickupDistance: '5 км', tags: ['Подтверждённый тег'] };
    const first = merge(createDemoActiveRide(), { ...server, route: sourceRoute, order: sourceOrder });
    for (const [key, value] of Object.entries(sourceRoute)) assert.deepEqual(first.route[key], value);
    for (const [key, value] of Object.entries(sourceOrder)) assert.deepEqual(first.order[key], value);
    const next = merge(first, server);
    assert.ok(next.route.pickup == null);
    assert.ok(next.route.dropoff == null);
    noDemoRoute(next);
  });
  test(`${role} authoritative storage repair prevents stale route resurrection on status update`, () => {
    storage.clear();
    const stale = createDemoActiveRide({ tripId: server.tripId, orderId: order.id, status: RIDE_STATUS.DRIVER_EN_ROUTE });
    saveActiveRide(stale);
    const clean = merge(stale, server);
    const repairName = role === 'driver' ? 'persistServerConfirmedWaitingProjection' : 'persistPassengerServerConfirmedWaitingProjection';
    const repair = Function('ride', 'findActiveRide', 'saveActiveRide', `return ${extractFunction(source, repairName)}`)(clean, findActiveRide, saveActiveRide);
    repair(clean.waiting, server);
    const repaired = findActiveRide(server.tripId);
    assert.equal(repaired.status, stale.status);
    assert.equal(repaired.orderId, stale.orderId);
    assert.deepEqual(repaired.timestamps, stale.timestamps);
    const transitioned = updateActiveRideStatus(server.tripId, RIDE_STATUS.DRIVER_APPROACHING_PICKUP);
    assert.equal(transitioned.status, RIDE_STATUS.DRIVER_APPROACHING_PICKUP);
    assert.equal(transitioned.route.pickupLabel, server.route.pickupLabel);
    noDemoRoute(transitioned);
    assert.ok(transitioned.route.pickup == null);
    saveActiveRide({ ...transitioned, status: RIDE_STATUS.COMPLETED });
    repair(clean.waiting, server);
    assert.equal(findActiveRide(server.tripId).status, RIDE_STATUS.COMPLETED, 'repair cannot thaw a terminal ride');
  });
  test(`${role} hydration preserves existing status reconciliation semantics`, () => {
    const local = createDemoActiveRide({ status: RIDE_STATUS.IN_PROGRESS });
    const hydrated = merge(local, server, role === 'passenger', role === 'driver' ? RIDE_STATUS.IN_PROGRESS : null);
    assert.equal(hydrated.status, RIDE_STATUS.IN_PROGRESS);
  });
}
const passengerSource = fs.readFileSync(new URL('../public/src/screens/active_ride_passenger.js', import.meta.url), 'utf8');
const presentation = Function(`${['hasRealRouteContext', 'passengerRouteText', 'passengerRouteLabels', 'etaText', 'inProgressInfo', 'arrivingDropoffInfo'].map((name) => extractFunction(passengerSource, name)).join('\n')}; return {passengerRouteLabels, etaText, inProgressInfo, arrivingDropoffInfo};`)();
test('real passenger presentation hides unknown data in all three provenance contexts', () => {
  for (const marker of [{ orderId: 'real' }, { acceptedSource: 'feed_post_accept' }, { authoritative: true }]) {
    assert.deepEqual(presentation.passengerRouteLabels(marker), { pickup: '', dropoff: '' });
    assert.equal(presentation.etaText(marker), '');
    assert.deepEqual(presentation.inProgressInfo(marker), { arrivalTime: '', eta: '' });
    assert.deepEqual(presentation.arrivingDropoffInfo(marker), { eta: '' });
    assert.equal(presentation.etaText({ ...marker, route: { etaToPickup: '8 мин' } }), '8 мин');
  }
});
test('explicit demo presentation keeps its established visual values', () => {
  assert.equal(presentation.etaText({}), '4 мин');
  assert.equal(presentation.arrivingDropoffInfo({}).eta, '1 мин');
  assert.equal(presentation.inProgressInfo({}).eta, '17 мин');
  assert.equal(presentation.passengerRouteLabels({}).pickup, 'ул. Малая Бронная, 28');
});
console.log(`\nRoute source smoke: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
