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
const order2 = mockApi.createRideOrder({
  type: 'passenger_request', source: 'feed',
  pickup: { id: null, label: 'A' }, dropoff: { id: null, label: 'B' },
  estimatedPrice: 800, estimatedPriceLabel: '800', scheduledMode: 'now', comment: '',
  passenger: { name: 'Тест', initials: 'Т', authorId: 'local-user', isCurrentUser: true },
});
const accepted2 = rideActions.acceptCanonicalRideOrder(order2.id);
let ride2 = rideState.updateActiveRideStatus(accepted2.tripId, rideState.RIDE_STATUS.DRIVER_EN_ROUTE);
ride2 = rideState.updateActiveRideStatus(accepted2.tripId, rideState.RIDE_STATUS.CANCELED); syncCanonical(ride2, rideState.RIDE_STATUS.CANCELED);
expect('CANCEL — active ride canceled', ride2.status === rideState.RIDE_STATUS.CANCELED);
expect('CANCEL — order canceled', mockApi.getOrderById(order2.id)?.status === 'CANCELED');
expect('CANCEL — findLatest excludes terminal', mockApi.findLatestHandedOffOrderTripId() === null);

// ── NO_SHOW path ─────────────────────────────────────────────
const order3 = mockApi.createRideOrder({
  type: 'passenger_request', source: 'feed',
  pickup: { id: null, label: 'A' }, dropoff: { id: null, label: 'B' },
  estimatedPrice: 800, estimatedPriceLabel: '800', scheduledMode: 'now', comment: '',
  passenger: { name: 'Тест3', initials: 'Т', authorId: 'local-user', isCurrentUser: true },
});
const accepted3 = rideActions.acceptCanonicalRideOrder(order3.id);
rideState.updateActiveRideStatus(accepted3.tripId, rideState.RIDE_STATUS.DRIVER_EN_ROUTE);
rideState.updateActiveRideStatus(accepted3.tripId, rideState.RIDE_STATUS.WAITING_PASSENGER);
let ride3 = rideState.updateActiveRideStatus(accepted3.tripId, rideState.RIDE_STATUS.NO_SHOW); syncCanonical(ride3, rideState.RIDE_STATUS.NO_SHOW);
expect('NO_SHOW — active ride NO_SHOW', ride3.status === rideState.RIDE_STATUS.NO_SHOW);
expect('NO_SHOW — order canonically CANCELED', mockApi.getOrderById(order3.id)?.status === 'CANCELED');
expect('NO_SHOW — findLatest excludes terminal', mockApi.findLatestHandedOffOrderTripId() === null);

// ── Refresh persistence (same tripId still resolves after re-import) ──
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

// ── Passenger cancel after accept (BD-RIDE-SIM-01) — order stays CANCELED ──
const order5 = mockApi.createRideOrder({
  type: 'passenger_request', source: 'feed',
  pickup: { id: null, label: 'P' }, dropoff: { id: null, label: 'Q' },
  estimatedPrice: 700, estimatedPriceLabel: '700', scheduledMode: 'now', comment: '',
  passenger: { name: 'PCancel', initials: 'P', authorId: 'local-user', isCurrentUser: true },
});
const accepted5 = rideActions.acceptCanonicalRideOrder(order5.id);
rideState.updateActiveRideStatus(accepted5.tripId, rideState.RIDE_STATUS.DRIVER_EN_ROUTE);
// Passenger flips it to CANCELED. Passenger renderer does NOT call syncCanonical
// (active_ride_passenger.js uses updateActiveRideStatus directly), so the
// canonical ride_orders.v1 record may not be advanced here. Verify what happens.
const ride5 = rideState.updateActiveRideStatus(accepted5.tripId, rideState.RIDE_STATUS.CANCELED, {
  cancel: { by: 'passenger', reason: 'plans_changed' },
});
expect('PassengerCancel — active ride canceled', ride5.status === rideState.RIDE_STATUS.CANCELED);
const order5After = mockApi.getOrderById(order5.id)?.status;
console.log('NOTE: passenger-cancel does NOT sync canonical order. After passenger CANCEL, order.status=' + order5After);
// findLatestHandedOffOrderTripId() walks newest-first; order5 (newer) is skipped because its active ride is terminal.
// Earlier non-terminal orders (e.g. order4) remain reachable — that is correct, not a leak.
const latestAfterPassengerCancel = mockApi.findLatestHandedOffOrderTripId();
expect('PassengerCancel — findLatest skips order5 even when canonical still ACCEPTED',
  latestAfterPassengerCancel !== `trip_${order5.id}`,
  'got=' + latestAfterPassengerCancel);
expect('PassengerCancel — order5 NOT in listNearbyOrders (status!=CREATED)',
  !mockApi.listNearbyOrders().some(o => o.id === order5.id));
expect('PassengerCancel — order5 NOT in feed projection (status!=CREATED)',
  !mockApi.listRideOrdersAsFeedPosts().some(p => p.orderId === order5.id));

console.log('\n' + (issues.length ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ') : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
