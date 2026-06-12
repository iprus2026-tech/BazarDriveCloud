// Headless Node smoke for the passenger->driver lifecycle.
// Exercises mock_api.js + ride_state.js + ride_actions.js + trip_confirmation_handoff.js
// against an in-memory localStorage shim. Used by the BD-ORDER-P-08 audit
// to repro the lifecycle without a browser.

const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => _store.has(k) ? _store.get(k) : null,
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { _store.delete(k); },
  clear: () => { _store.clear(); },
};

const root = new URL('../public/src/', import.meta.url);
const rideState   = await import(new URL('ride_state.js', root).href);
const mockApi     = await import(new URL('mock_api.js', root).href);
const rideActions = await import(new URL('ride_actions.js', root).href);
const handoff     = await import(new URL('screens/trip_confirmation_handoff.js', root).href);

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// Mirror of active_ride.js syncCanonicalOrderStatus.
function syncCanonical(ride, activeStatus) {
  const MAP = {
    [rideState.RIDE_STATUS.IN_PROGRESS]: rideState.RIDE_STATUS.IN_PROGRESS,
    [rideState.RIDE_STATUS.COMPLETED]:   rideState.RIDE_STATUS.COMPLETED,
    [rideState.RIDE_STATUS.CANCELED]:    rideState.RIDE_STATUS.CANCELED,
    [rideState.RIDE_STATUS.NO_SHOW]:     rideState.RIDE_STATUS.CANCELED,
  };
  const orderStatus = MAP[activeStatus];
  if (!orderStatus) return;
  const orderId = ride.orderId
    || (typeof ride.tripId === 'string' && ride.tripId.startsWith('trip_order-')
        ? ride.tripId.slice('trip_'.length) : null);
  if (!orderId) return;
  if (mockApi.updateTripStatus(orderId, orderStatus)) return;
  if (orderStatus === rideState.RIDE_STATUS.IN_PROGRESS) {
    mockApi.updateTripStatus(orderId, rideState.RIDE_STATUS.ACCEPTED);
    mockApi.updateTripStatus(orderId, rideState.RIDE_STATUS.IN_PROGRESS);
    return;
  }
  if (orderStatus === rideState.RIDE_STATUS.COMPLETED) {
    mockApi.updateTripStatus(orderId, rideState.RIDE_STATUS.ACCEPTED);
    mockApi.updateTripStatus(orderId, rideState.RIDE_STATUS.IN_PROGRESS);
    mockApi.updateTripStatus(orderId, rideState.RIDE_STATUS.COMPLETED);
  }
}

// ── COMPLETED happy path ───────────────────────────────────────
const order = mockApi.createRideOrder({
  type: 'passenger_request', source: 'feed',
  pickup: { id: null, label: 'Аэропорт Внуково' },
  dropoff: { id: null, label: 'м. Парк Победы' },
  estimatedPrice: 1500, estimatedPriceLabel: '1 500',
  scheduledMode: 'later', scheduledAt: 'Завтра, 07:00', scheduledLabel: 'Завтра, 07:00',
  comment: '1 чемодан',
  passenger: { name: 'Ольга', initials: 'О', authorId: 'local-user', isCurrentUser: true, phoneMasked: '+7 ... 12-34', comment: '1 чемодан' },
});
expect('createRideOrder returns CREATED', order.status === 'CREATED');
expect('listNearbyOrders includes fresh CREATED', mockApi.listNearbyOrders().some(o => o.id === order.id));
expect('Feed projection includes fresh CREATED',
  mockApi.listRideOrdersAsFeedPosts().some(p => p.orderId === order.id && p.canonical === 'ride_order'));

const accepted = rideActions.acceptCanonicalRideOrder(order.id);
expect('acceptCanonicalRideOrder returns tripId trip_<id>', accepted?.tripId === `trip_${order.id}`);
expect('Accepted order flipped to ACCEPTED', accepted?.order?.status === 'ACCEPTED');
expect('Active ride seeded with orderId', accepted?.ride?.orderId === order.id);
expect('Active ride seeded with ACCEPTED status', accepted?.ride?.status === rideState.RIDE_STATUS.ACCEPTED);
expect('Passenger snapshot preserved (no demo "Анна М." leak)',
  accepted?.ride?.passenger?.name === 'Ольга',
  'passenger=' + JSON.stringify(accepted?.ride?.passenger?.name));
expect('After accept — nearby excludes order', !mockApi.listNearbyOrders().some(o => o.id === order.id));
expect('After accept — feed projection excludes order',
  !mockApi.listRideOrdersAsFeedPosts().some(p => p.orderId === order.id));
expect('findLatestHandedOffOrderTripId resolves', mockApi.findLatestHandedOffOrderTripId() === accepted.tripId);

let ride = rideState.updateActiveRideStatus(accepted.tripId, rideState.RIDE_STATUS.DRIVER_EN_ROUTE);
expect('DRIVER_EN_ROUTE persisted', ride.status === rideState.RIDE_STATUS.DRIVER_EN_ROUTE);
ride = rideState.updateActiveRideStatus(accepted.tripId, rideState.RIDE_STATUS.WAITING_PASSENGER);
expect('WAITING_PASSENGER persisted', ride.status === rideState.RIDE_STATUS.WAITING_PASSENGER);
ride = rideState.updateActiveRideStatus(accepted.tripId, rideState.RIDE_STATUS.IN_PROGRESS); syncCanonical(ride, rideState.RIDE_STATUS.IN_PROGRESS);
expect('IN_PROGRESS active ride persisted', ride.status === rideState.RIDE_STATUS.IN_PROGRESS);
expect('IN_PROGRESS canonical order synced', mockApi.getOrderById(order.id)?.status === 'IN_PROGRESS');
ride = rideState.updateActiveRideStatus(accepted.tripId, rideState.RIDE_STATUS.COMPLETED); syncCanonical(ride, rideState.RIDE_STATUS.COMPLETED);
expect('COMPLETED active ride persisted', ride.status === rideState.RIDE_STATUS.COMPLETED);
expect('COMPLETED canonical order synced', mockApi.getOrderById(order.id)?.status === 'COMPLETED');
expect('Terminal — findLatestHandedOffOrderTripId returns null', mockApi.findLatestHandedOffOrderTripId() === null);
expect('Terminal — order excluded from listNearbyOrders', !mockApi.listNearbyOrders().some(o => o.id === order.id));
expect('Terminal — order excluded from feed projection', !mockApi.listRideOrdersAsFeedPosts().some(p => p.orderId === order.id));

// ── CANCELED path ─────────────────────────────────────────────
// Scenarios are conceptually independent. `createRideOrder` derives
// `order.id` from `Date.now()` (1 ms resolution), so two consecutive
// `createRideOrder` calls on a fast CI runner can collide on the same
// id → the same `trip_${order.id}` tripId. Pre-BD-ACTIVE-RIDE-TERM-01
// this was masked because `updateActiveRideStatus` overwrote the
// previous record unconditionally; with the terminal-regression guard
// now in place, a collision would leave the prior scenario's terminal
// record in the store and cause the next scenario's terminal write to
// be refused. Reset the active-ride store at every scenario boundary
// so the scenarios stay independent regardless of clock granularity.
rideState.clearActiveRideStore();
const order2 = mockApi.createRideOrder({
  type: 'passenger_request', source: 'feed',
  pickup: { id: null, label: 'A' }, dropoff: { id: null, label: 'B' },
  estimatedPrice: 800, estimatedPriceLabel: '800', scheduledMode: 'now', comment: '',
  passenger: { name: 'Тест', initials: 'Т', authorId: 'local-user', isCurrentUser: true },
});
const accepted2 = rideActions.acceptCanonicalRideOrder(order2.id);
let ride2 = rideState.updateActiveRideStatus(accepted2.tripId, rideState.RIDE_STATUS.DRIVER_EN_ROUTE);
// BD-RIDE-D-10 — driver cancel persists cancel:{by,reason} metadata the same
// way passenger cancel does. The patch is informational; terminal status is
// still the source of truth for ride_state and the canonical order.
ride2 = rideState.updateActiveRideStatus(accepted2.tripId, rideState.RIDE_STATUS.CANCELED, {
  cancel: { by: 'driver', reason: 'car_problem' },
});
syncCanonical(ride2, rideState.RIDE_STATUS.CANCELED);
expect('CANCEL — active ride canceled', ride2.status === rideState.RIDE_STATUS.CANCELED);
expect('CANCEL — driver cancel metadata persisted',
  ride2.cancel?.by === 'driver' && ride2.cancel?.reason === 'car_problem',
  'cancel=' + JSON.stringify(ride2.cancel));
expect('CANCEL — order canceled', mockApi.getOrderById(order2.id)?.status === 'CANCELED');
expect('CANCEL — findLatest excludes terminal', mockApi.findLatestHandedOffOrderTripId() === null);
expect('CANCEL — order excluded from listNearbyOrders',
  !mockApi.listNearbyOrders().some(o => o.id === order2.id));
expect('CANCEL — order excluded from Feed projection',
  !mockApi.listRideOrdersAsFeedPosts().some(p => p.orderId === order2.id));

// ── NO_SHOW path ─────────────────────────────────────────────
// Reset active-ride store so an `order.id` clock-collision with the
// preceding CANCEL scenario can't carry the CANCELED record into this
// scenario's tripId.
rideState.clearActiveRideStore();
const order3 = mockApi.createRideOrder({
  type: 'passenger_request', source: 'feed',
  pickup: { id: null, label: 'A' }, dropoff: { id: null, label: 'B' },
  estimatedPrice: 800, estimatedPriceLabel: '800', scheduledMode: 'now', comment: '',
  passenger: { name: 'Тест3', initials: 'Т', authorId: 'local-user', isCurrentUser: true },
});
const accepted3 = rideActions.acceptCanonicalRideOrder(order3.id);
rideState.updateActiveRideStatus(accepted3.tripId, rideState.RIDE_STATUS.DRIVER_EN_ROUTE);
rideState.updateActiveRideStatus(accepted3.tripId, rideState.RIDE_STATUS.WAITING_PASSENGER);
let ride3 = rideState.updateActiveRideStatus(accepted3.tripId, rideState.RIDE_STATUS.NO_SHOW, {
  cancel: { by: 'driver', reason: 'passenger_no_show' },
});
syncCanonical(ride3, rideState.RIDE_STATUS.NO_SHOW);
expect('NO_SHOW — active ride NO_SHOW', ride3.status === rideState.RIDE_STATUS.NO_SHOW);
expect('NO_SHOW — cancel metadata persisted',
  ride3.cancel?.by === 'driver' && ride3.cancel?.reason === 'passenger_no_show',
  'cancel=' + JSON.stringify(ride3.cancel));
expect('NO_SHOW — order canonically CANCELED', mockApi.getOrderById(order3.id)?.status === 'CANCELED');
expect('NO_SHOW — findLatest excludes terminal', mockApi.findLatestHandedOffOrderTripId() === null);
expect('NO_SHOW — order excluded from listNearbyOrders',
  !mockApi.listNearbyOrders().some(o => o.id === order3.id));
expect('NO_SHOW — order excluded from Feed projection',
  !mockApi.listRideOrdersAsFeedPosts().some(p => p.orderId === order3.id));

// ── Refresh persistence (same tripId still resolves after re-import) ──
// Reset active-ride store so a clock-collision between order3 (NO_SHOW
// terminal) and this scenario's id can't leave a terminal record in
// the store — `acceptCanonicalRideOrder` materializes the new ride via
// `saveActiveRide`, which BD-ACTIVE-RIDE-TERM-01 now freezes on an
// existing terminal record. Without this reset a colliding id would
// leave the prior scenario's identity ('Тест3') in place instead of
// the Refresh passenger snapshot.
rideState.clearActiveRideStore();
const order4 = mockApi.createRideOrder({
  type: 'passenger_request', source: 'feed',
  pickup: { id: null, label: 'X' }, dropoff: { id: null, label: 'Y' },
  estimatedPrice: 1200, estimatedPriceLabel: '1200', scheduledMode: 'now', comment: 'note',
  passenger: { name: 'Refresh', initials: 'R', authorId: 'local-user', isCurrentUser: true },
});
const accepted4 = rideActions.acceptCanonicalRideOrder(order4.id);
const refreshedDriver = handoff.loadCanonicalActiveRide({ tripId: accepted4.tripId, role: 'driver' });
expect('Refresh — driver loadCanonical resolves same trip', refreshedDriver?.tripId === accepted4.tripId);
const refreshedPassenger = handoff.loadCanonicalActiveRide({ tripId: accepted4.tripId, role: 'passenger' });
expect('Refresh — passenger loadCanonical resolves same trip', refreshedPassenger?.tripId === accepted4.tripId);
expect('Refresh — passenger sees same passenger identity',
  refreshedPassenger?.passenger?.name === 'Refresh',
  'got=' + refreshedPassenger?.passenger?.name);

// ── Passenger cancel after accept (BD-RIDE-P-10) — canonical mirrored to CANCELED ──
const order5 = mockApi.createRideOrder({
  type: 'passenger_request', source: 'feed',
  pickup: { id: null, label: 'P' }, dropoff: { id: null, label: 'Q' },
  estimatedPrice: 700, estimatedPriceLabel: '700', scheduledMode: 'now', comment: '',
  passenger: { name: 'PCancel', initials: 'P', authorId: 'local-user', isCurrentUser: true },
});
const accepted5 = rideActions.acceptCanonicalRideOrder(order5.id);
rideState.updateActiveRideStatus(accepted5.tripId, rideState.RIDE_STATUS.DRIVER_EN_ROUTE);
// Mirror what active_ride_passenger.js now does on confirmed cancel:
// 1) flip active_ride.v1 → CANCELED, 2) mirror canonical ride_orders.v1 → CANCELED.
const ride5 = rideState.updateActiveRideStatus(accepted5.tripId, rideState.RIDE_STATUS.CANCELED, {
  cancel: { by: 'passenger', reason: 'plans_changed' },
});
syncCanonical(ride5, rideState.RIDE_STATUS.CANCELED);
expect('PassengerCancel — active ride status CANCELED', ride5.status === rideState.RIDE_STATUS.CANCELED);
expect('PassengerCancel — canonical ride_orders.v1 mirrored to CANCELED',
  mockApi.getOrderById(order5.id)?.status === 'CANCELED');
expect('PassengerCancel — canceled order NOT in listNearbyOrders()',
  !mockApi.listNearbyOrders().some(o => o.id === order5.id));
expect('PassengerCancel — canceled order NOT in Feed projection',
  !mockApi.listRideOrdersAsFeedPosts().some(p => p.orderId === order5.id));
// findLatestHandedOffOrderTripId() walks newest-first; order5 must be
// excluded because its canonical status is now CANCELED (not ACCEPTED/IN_PROGRESS)
// AND its active ride is terminal. Earlier non-terminal orders may still be
// reachable — that is correct, not a leak.
const latestAfterPassengerCancel = mockApi.findLatestHandedOffOrderTripId();
expect('PassengerCancel — findLatest excludes the canceled trip',
  latestAfterPassengerCancel !== `trip_${order5.id}`,
  'got=' + latestAfterPassengerCancel);

// ── Bare /active-ride?role=driver must not revive a terminal trip ──
// active_ride.js driver branch resolves an empty `/active-ride?role=driver`
// via findLatestHandedOffOrderTripId() → returns null when every live order
// has been passenger-canceled. Without the BD-RIDE-P-10 canonical sync the
// canceled order would stay ACCEPTED in ride_orders.v1 and findLatest would
// hand the driver a stale terminal trip.
mockApi.clearRideOrdersStore();
rideState.clearActiveRideStore();
const order6 = mockApi.createRideOrder({
  type: 'passenger_request', source: 'feed',
  pickup: { id: null, label: 'S' }, dropoff: { id: null, label: 'T' },
  estimatedPrice: 600, estimatedPriceLabel: '600', scheduledMode: 'now', comment: '',
  passenger: { name: 'BareDriver', initials: 'B', authorId: 'local-user', isCurrentUser: true },
});
const accepted6 = rideActions.acceptCanonicalRideOrder(order6.id);
const ride6 = rideState.updateActiveRideStatus(accepted6.tripId, rideState.RIDE_STATUS.CANCELED, {
  cancel: { by: 'passenger', reason: 'plans_changed' },
});
syncCanonical(ride6, rideState.RIDE_STATUS.CANCELED);
expect('BareDriver — canonical ride_orders.v1 is CANCELED',
  mockApi.getOrderById(order6.id)?.status === 'CANCELED');
expect('BareDriver — findLatestHandedOffOrderTripId returns null after passenger cancel',
  mockApi.findLatestHandedOffOrderTripId() === null);
expect('BareDriver — canceled order NOT in listNearbyOrders()',
  !mockApi.listNearbyOrders().some(o => o.id === order6.id));
expect('BareDriver — canceled order NOT in Feed projection',
  !mockApi.listRideOrdersAsFeedPosts().some(p => p.orderId === order6.id));

// ── BD-RIDE-D-10 — Bare /active-ride?role=driver after driver-initiated cancel/no-show ──
// Mirrors the BareDriver (passenger-cancel) section but for the driver-initiated
// terminal transitions polished by the cancel/problem sheets. The bare driver
// URL resolves via findLatestHandedOffOrderTripId() — it must return null once
// every live order has been driver-canceled or marked no-show, otherwise the
// driver would revive a terminal trip on refresh.
mockApi.clearRideOrdersStore();
rideState.clearActiveRideStore();
const order7 = mockApi.createRideOrder({
  type: 'passenger_request', source: 'feed',
  pickup: { id: null, label: 'U' }, dropoff: { id: null, label: 'V' },
  estimatedPrice: 500, estimatedPriceLabel: '500', scheduledMode: 'now', comment: '',
  passenger: { name: 'BareDC', initials: 'B', authorId: 'local-user', isCurrentUser: true },
});
const accepted7 = rideActions.acceptCanonicalRideOrder(order7.id);
rideState.updateActiveRideStatus(accepted7.tripId, rideState.RIDE_STATUS.DRIVER_EN_ROUTE);
const ride7 = rideState.updateActiveRideStatus(accepted7.tripId, rideState.RIDE_STATUS.CANCELED, {
  cancel: { by: 'driver', reason: 'car_problem' },
});
syncCanonical(ride7, rideState.RIDE_STATUS.CANCELED);
expect('BareDriverCancel — canonical ride_orders.v1 is CANCELED',
  mockApi.getOrderById(order7.id)?.status === 'CANCELED');
expect('BareDriverCancel — findLatestHandedOffOrderTripId returns null after driver cancel',
  mockApi.findLatestHandedOffOrderTripId() === null);
expect('BareDriverCancel — canceled order NOT in listNearbyOrders()',
  !mockApi.listNearbyOrders().some(o => o.id === order7.id));
expect('BareDriverCancel — canceled order NOT in Feed projection',
  !mockApi.listRideOrdersAsFeedPosts().some(p => p.orderId === order7.id));

// Reset active-ride store so a clock-collision between order7 (CANCEL)
// and order8 (NO_SHOW) ids can't carry CANCEL state into this scenario.
rideState.clearActiveRideStore();
const order8 = mockApi.createRideOrder({
  type: 'passenger_request', source: 'feed',
  pickup: { id: null, label: 'W' }, dropoff: { id: null, label: 'X' },
  estimatedPrice: 500, estimatedPriceLabel: '500', scheduledMode: 'now', comment: '',
  passenger: { name: 'BareNS', initials: 'B', authorId: 'local-user', isCurrentUser: true },
});
const accepted8 = rideActions.acceptCanonicalRideOrder(order8.id);
rideState.updateActiveRideStatus(accepted8.tripId, rideState.RIDE_STATUS.DRIVER_EN_ROUTE);
rideState.updateActiveRideStatus(accepted8.tripId, rideState.RIDE_STATUS.WAITING_PASSENGER);
const ride8 = rideState.updateActiveRideStatus(accepted8.tripId, rideState.RIDE_STATUS.NO_SHOW, {
  cancel: { by: 'driver', reason: 'passenger_no_show' },
});
syncCanonical(ride8, rideState.RIDE_STATUS.NO_SHOW);
expect('BareDriverNoShow — canonical ride_orders.v1 is CANCELED',
  mockApi.getOrderById(order8.id)?.status === 'CANCELED');
expect('BareDriverNoShow — findLatestHandedOffOrderTripId returns null after no-show',
  mockApi.findLatestHandedOffOrderTripId() === null);
expect('BareDriverNoShow — no-show order NOT in listNearbyOrders()',
  !mockApi.listNearbyOrders().some(o => o.id === order8.id));
expect('BareDriverNoShow — no-show order NOT in Feed projection',
  !mockApi.listRideOrdersAsFeedPosts().some(p => p.orderId === order8.id));

console.log('\n' + (issues.length ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ') : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
