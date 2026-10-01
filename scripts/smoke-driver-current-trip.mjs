// Driver resume invariants. Real read adapter, synthetic storage/API only.
import assert from 'node:assert/strict';
import { serializeRide, serializeRecoveredRide } from '../server/src/serialize.js';
const store = new Map(), session = new Map();
let writes = 0;
globalThis.localStorage = {
  getItem: key => store.get(key) ?? null,
  setItem: (key, value) => { writes++; store.set(key, String(value)); },
  removeItem: key => { writes++; store.delete(key); },
};
globalThis.sessionStorage = {
  getItem: key => session.get(key) ?? null,
  setItem: (key, value) => session.set(key, String(value)),
  removeItem: key => session.delete(key),
};
const { user } = await import('../public/src/state.js');
const { setAuth, clearAuth } = await import('../public/src/auth_token.js');
const { setSmokeRole, clearSmokeRole } = await import('../public/src/smoke_role.js');
const { driverTripScope, driverTripCandidates, loadDriverTrip, driverTripRoute } =
  await import('../public/src/driver_current_trip.js');
const key = 'bazardrive.active_ride.v1';
const id = 'trip_order-fixture';
const ride = (overrides = {}) => ({
  tripId: id, orderId: 'order-fixture', role: 'passenger', status: 'WAITING_PASSENGER',
  route: { pickupLabel: 'Место подачи', dropoffLabel: 'Место назначения' },
  passenger: { name: 'Тестовый пассажир' },
  timestamps: { acceptedAt: '2026-10-01T12:00:00Z', arrivedAt: '2026-10-01T12:03:00Z' },
  ...overrides,
});
const seed = (...rides) => store.set(key, JSON.stringify(Object.fromEntries(rides.map(r => [r.tripId, r]))));
const response = (payload, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(payload) });
// Match the actual API projections, including passenger-select's stored role.
// Participant IDs and local order/accept markers are intentionally not on wire.
function serverViews(status = 'IN_PROGRESS') {
  const row = { trip_id: id, role: 'passenger', status,
    driver_user_id: 'driver-fixture', passenger_user_id: 'passenger-fixture',
    route_pickup_label: 'Серверная подача', route_dropoff_label: 'Серверное назначение',
    accepted_at: new Date('2026-10-01T12:00:00Z'), arrived_at: new Date('2026-10-01T12:03:00Z') };
  return [serializeRide(row), serializeRecoveredRide(row, {
    order: { pickup: { label: row.route_pickup_label }, dropoff: { label: row.route_dropoff_label },
      passenger_snapshot: { name: 'Пассажир API' } },
    acceptedOffer: { driver_id: 'driver-fixture', driver_name: 'Водитель API', price: 900 },
  })];
}
let checks = 0;
async function check(name, run) { await run(); checks++; console.log('PASS — ' + name); }
user.set({ onboarded: true, role: 'driver', phone: '+70000000000' });
globalThis.__BD_API_BASE__ = '';

await check('empty, malformed and demo-only stores never manufacture an active order', async () => {
  for (const raw of [null, 'bad json', '[]', 'null', '{}']) {
    if (raw === null) store.delete(key); else store.set(key, raw);
    assert.equal((await loadDriverTrip()).state, 'empty');
  }
  seed(ride({ tripId: 'trip_moscow_sheremetyevo_demo' }), ride({ localProvenance: 'sim_audit' }));
  assert.equal((await loadDriverTrip()).state, 'empty');
});
await check('only accepted and moving/waiting orders can be resumed, with no status override', async () => {
  for (const status of ['ACCEPTED', 'DRIVER_EN_ROUTE', 'DRIVER_APPROACHING_PICKUP', 'WAITING_PASSENGER', 'IN_PROGRESS']) {
    seed(ride({ status })); const before = store.get(key), count = writes;
    const value = await loadDriverTrip();
    assert.equal(value.trip.status, status);
    assert.equal(driverTripRoute(value), '/active-ride?role=driver&tripId=' + id);
    assert.equal(value.trip.from, 'Место подачи');
    assert.equal(store.get(key), before, 'reads preserve status and timer timestamps');
    assert.equal(writes, count, 'resume adapter must never write storage');
  }
  for (const status of ['NEW_ORDER', 'CONFIRMATION_PENDING', 'CONFIRMED', 'CHAT_STARTED', 'COMPLETED', 'CANCELED', 'NO_SHOW', 'UNKNOWN']) {
    seed(ride({ status })); assert.equal(driverTripRoute(await loadDriverTrip()), null);
  }
});
await check('canonical passenger handoff and legacy driver feed acceptance are discoverable', () => {
  seed(ride()); assert.equal(driverTripCandidates()[0].tripId, id);
  seed(ride({ tripId: 'feed-fixture', orderId: null, role: 'driver' }));
  assert.equal(driverTripCandidates()[0].tripId, 'feed-fixture');
  seed(ride({ tripId: 'arbitrary', orderId: null, role: 'passenger' }));
  assert.deepEqual(driverTripCandidates(), []);
});
await check('newer terminal records cannot hide an older active order; click pins the shown identity', async () => {
  const second = ride({ tripId: 'trip_newer', timestamps: { acceptedAt: '2026-10-01T13:00:00Z' } });
  seed(ride(), { ...second, status: 'COMPLETED' });
  assert.equal((await loadDriverTrip()).trip.id, id);
  seed(ride(), second);
  assert.equal((await loadDriverTrip()).trip.id, second.tripId);
  assert.equal((await loadDriverTrip({ tripId: id })).trip.id, id);
  seed(ride({ status: 'CANCELED' }), second);
  assert.equal((await loadDriverTrip({ tripId: id })).state, 'empty', 'never substitute a different order under a stale card');
});
await check('passenger, Guest and incomplete profiles cannot see driver return', async () => {
  seed(ride());
  for (const role of ['passenger', 'guest', null]) {
    user.set({ role }); assert.equal(driverTripScope(), null);
  }
  user.set({ role: 'guest' }); setSmokeRole('driver');
  assert.equal(driverTripScope(), null); clearSmokeRole();
  user.set({ role: 'driver', onboarded: false }); assert.equal(driverTripScope(), null);
  user.set({ onboarded: true }); setSmokeRole('passenger');
  assert.equal(driverTripScope(), null); clearSmokeRole();
  assert.equal((await loadDriverTrip()).state, 'ready');
});
await check('backend reads use the authenticated participant snapshot, not the local status', async () => {
  globalThis.__BD_API_BASE__ = 'https://fixture.invalid';
  assert.equal(driverTripScope(), null);
  setAuth({ token: 'fixture-token', userId: 'driver-fixture' });
  const before = writes;
  for (const serverRide of serverViews()) {
    assert.equal(serverRide.role, 'passenger', 'wire role is a stored projection, not the requesting actor');
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://fixture.invalid/api/v1/ride-state/rides/' + id);
      assert.equal(options.method, 'GET'); assert.equal(options.headers.Authorization, 'Bearer fixture-token');
      return response({ ride: serverRide });
    };
    const value = await loadDriverTrip();
    assert.equal(value.state, 'ready');
    assert.equal(value.trip.status, 'IN_PROGRESS'); assert.equal(value.trip.from, 'Серверная подача');
  }
  assert.equal(writes, before);
});
await check('server-hydrated records without local markers remain backend discovery hints', async () => {
  for (const serverRide of serverViews()) {
    assert.equal(serverRide.orderId, undefined); assert.equal(serverRide.acceptedSource, undefined);
    // active_ride keeps its driver-view role when merging a server fallback.
    const persisted = { ...serverRide, role: 'driver' };
    seed(persisted); const before = store.get(key), count = writes;
    let calls = 0;
    globalThis.fetch = async () => { calls++; return response({ ride: serverRide }); };
    const value = await loadDriverTrip();
    assert.equal(value.state, 'ready'); assert.equal(calls, 1, 'hint must receive participant-gated validation');
    assert.equal(driverTripRoute(value), '/active-ride?role=driver&tripId=' + id);
    assert.equal(store.get(key), before); assert.equal(writes, count);
    globalThis.__BD_API_BASE__ = '';
    assert.equal((await loadDriverTrip()).state, 'empty', 'unmarked hints do not widen local-demo discovery');
    globalThis.__BD_API_BASE__ = 'https://fixture.invalid';
    for (const excluded of [
      { ...persisted, localProvenance: 'sim_audit' },
      { ...persisted, tripId: 'trip_moscow_sheremetyevo_demo' },
      { ...persisted, status: 'COMPLETED' },
    ]) {
      seed(excluded); assert.equal((await loadDriverTrip()).state, 'empty');
      assert.equal(calls, 1, 'demo/simulation/terminal hints never trigger a server lookup');
    }
  }
  seed({ ...serverViews()[0], role: 'driver' });
});
await check('forbidden, missing, terminal or mismatched server rides never fall back to local success', async () => {
  for (const status of [401, 403, 404]) {
    globalThis.fetch = async () => response({ code: 'FIXTURE' }, status);
    assert.equal((await loadDriverTrip()).state, 'empty');
  }
  for (const value of [{ ...serverViews()[0], tripId: 'wrong' },
    ...['COMPLETED', 'CANCELED', 'NO_SHOW'].map(status => serverViews(status)[0])]) {
    globalThis.fetch = async () => response({ ride: value });
    assert.equal((await loadDriverTrip()).state, 'empty');
  }
  globalThis.fetch = async () => { throw new Error('offline fixture'); };
  assert.equal((await loadDriverTrip()).state, 'error');
});
await check('passenger and Guest sessions cannot use a backend discovery hint', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response({ ride: serverViews()[0] }); };
  for (const role of ['passenger', 'guest']) {
    user.set({ role }); setSmokeRole('driver');
    assert.equal((await loadDriverTrip()).state, 'empty'); clearSmokeRole();
  }
  user.set({ role: 'driver' }); setSmokeRole('passenger');
  assert.equal((await loadDriverTrip()).state, 'empty'); clearSmokeRole();
  assert.equal(calls, 0);
});
await check('late backend responses cannot survive a role/token change or abort', async () => {
  for (const change of ['role', 'token', 'abort']) {
    user.set({ role: 'driver' }); setAuth({ token: 'fixture-token', userId: 'driver-fixture' });
    let finish;
    globalThis.fetch = () => new Promise(resolve => { finish = resolve; });
    const controller = new AbortController();
    const pending = loadDriverTrip({ signal: controller.signal });
    if (change === 'role') setSmokeRole('passenger');
    if (change === 'token') setAuth({ token: 'different-token' });
    if (change === 'abort') controller.abort();
    finish(response({ ride: serverViews()[0] }));
    assert.equal((await pending).state, 'empty'); clearSmokeRole();
  }
  clearAuth(); assert.equal(driverTripScope(), null);
});
console.log(`${checks} driver resume behavioral checks passed.`);
