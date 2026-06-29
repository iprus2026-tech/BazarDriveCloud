// BD-RIDE-ORDER-02 — Passenger/driver order lifecycle runtime smoke.
//
// First executable guard that walks the whole passenger→driver→active-ride
// mock chain through the real modules and asserts the cross-role invariants
// closed by BD-RIDE-ORDER-01 (#416) and BD-ROLE-05 (#417). The bug class to
// lock down is "passenger and driver become one person in different jackets":
// any code path that lets the order's passenger snapshot bleed into the
// response's driverSnapshot (or vice versa), or that collapses a role-tagged
// history into a single conflated record.
//
// Dependency-free: no jsdom, no Mapbox, no backend, no UI rendering. The
// smoke imports the real mock_api / state / smoke_role / ride_history modules
// behind Map-backed localStorage + sessionStorage stubs and a minimal window /
// location stub. loadResponsesForOrder and mapResponseToDriverCard are
// module-private in screens/responses.js; the smoke inlines the load logic
// and asserts the persisted driverSnapshot shape directly (the contract
// mapResponseToDriverCard's pickStr type-guard depends on).

// ── localStorage stub ────────────────────────────────────────────────────────
const local = new Map();
globalThis.localStorage = {
  getItem: (k) => (local.has(k) ? local.get(k) : null),
  setItem: (k, v) => local.set(k, String(v)),
  removeItem: (k) => local.delete(k),
  clear: () => local.clear(),
};

// ── sessionStorage stub (smoke_role.js per-tab override lives here) ──────────
const session = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (session.has(k) ? session.get(k) : null),
  setItem: (k, v) => session.set(k, String(v)),
  removeItem: (k) => session.delete(k),
  clear: () => session.clear(),
};

// ── window / location (some imported modules touch these at module load) ────
let currentHash = '';
const locationStub = {};
Object.defineProperty(locationStub, 'hash', {
  configurable: true,
  get: () => currentHash,
  set: (v) => {
    currentHash = typeof v === 'string' && v.startsWith('#') ? v : '#' + String(v);
  },
});
globalThis.window = { location: locationStub, addEventListener() {}, removeEventListener() {} };
globalThis.location = locationStub;
globalThis.document = { addEventListener() {}, removeEventListener() {} };

// ── Imports (after stubs are in place) ───────────────────────────────────────
const { user } = await import('../public/src/state.js');
const {
  LOCAL_USER_ID,
  createRideOrder,
  listNearbyOrders,
  getOrderById,
  acceptOrder,
  clearRideOrdersStore,
} = await import('../public/src/mock_api.js');
const {
  SMOKE_ROLE_KEY,
  getSmokeRole,
  setSmokeRole,
  clearSmokeRole,
} = await import('../public/src/smoke_role.js');
const {
  buildPassengerHistoryEntry,
  buildDriverHistoryEntry,
  saveRideHistoryEntry,
  loadRideHistory,
  readRideHistoryStatus,
  clearRideHistory,
} = await import('../public/src/ride_history.js');
const {
  saveActiveRide,
  findActiveRide,
  RIDE_STATUS,
} = await import('../public/src/ride_state.js');
const {
  resolveLatestDriverSnapshotForOrder,
  resolveDriverSnapshotForRide,
  upgradeRideFromDriverSnapshot,
  upgradeStoredActiveRideForOrder,
} = await import('../public/src/screens/responses.js');
const {
  acceptCanonicalRideOrder,
} = await import('../public/src/ride_actions.js');

const RESPONSES_KEY = 'bazardrive.responses.v1';
const USER_KEY = 'bazardrive.user.v1';

// ── inlineLoadResponsesForOrder — mirrors responses.js:326-340 ───────────────
// loadResponsesForOrder is module-private (no `export` keyword on the
// function), so we duplicate its 10-line read here. This is the chosen
// mitigation per the BD-RIDE-ORDER-02 plan: duplicating the logic in the
// guard smoke makes any drift in storage shape or filter key fail loudly.
function inlineLoadResponsesForOrder(orderId) {
  const id = String(orderId || '').trim();
  if (!id) return [];
  try {
    const raw = localStorage.getItem(RESPONSES_KEY);
    if (!raw) return [];
    const map = JSON.parse(raw);
    if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
    return Object.values(map).filter((r) =>
      r && typeof r === 'object'
      && r.kind === 'passenger_response'
      && String(r.orderId || '') === id);
  } catch {
    return [];
  }
}

// ── Test helpers ─────────────────────────────────────────────────────────────
const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

function reset() {
  local.clear();
  session.clear();
  user.reset();
  currentHash = '';
}

function persistedRole() {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw).role; } catch { return null; }
}

function buildResponseFor(order, driverFields) {
  return {
    id: `resp_${order.id}`,
    kind: 'passenger_response',
    tripId: `trip_${order.id}`,
    requestId: order.id,
    orderId: order.id,
    canonical: 'ride_order',
    driverPrice: 1750,
    pickupTiming: 'at_time',
    message: 'Готов забрать',
    vehicleId: 'veh-1',
    driverSnapshot: {
      name:     driverFields.name,
      rating:   driverFields.rating ?? 4.8,
      car:      'Camry · белый',
      carModel: 'Camry',
      carColor: 'белый',
      plate:    'А ••• АА 77',
    },
    status: 'SENT',
    createdAt: new Date().toISOString(),
  };
}

function writeResponseToStore(response) {
  localStorage.setItem(RESPONSES_KEY, JSON.stringify({ [response.id]: response }));
}

// ── Scenario 1 — Passenger creates an order ──────────────────────────────────
reset();
user.set({
  role: 'passenger',
  firstName: 'Алия', lastName: 'К.',
  phone: '+77001112233', phoneVerified: true,
  onboarded: true,
});
const s1Order = await createRideOrder({
  type: 'ride_order',
  pickup:  { id: 'p1', label: 'ТЦ Мега' },
  dropoff: { id: 'p2', label: 'Аэропорт' },
  distanceKm: 12, durationMin: 22,
  estimatedPrice: 1700, estimatedPriceLabel: '1700 ₸',
  scheduledMode: 'now', comment: 'к 18:00',
  passenger: {
    name: 'Алия К.',
    initials: 'АК',
    phoneMasked: '+7•••',
    authorId: LOCAL_USER_ID,
    isCurrentUser: true,
  },
});
{
  expect('S1: createRideOrder returns string id',
    typeof s1Order.id === 'string' && s1Order.id.length > 0, String(s1Order.id));
  expect('S1: order.status === "CREATED"',
    s1Order.status === 'CREATED', String(s1Order.status));
  expect('S1: order.passenger.name reflects passenger user',
    s1Order.passenger?.name === 'Алия К.', String(s1Order.passenger?.name));
  expect('S1: order.passenger.isCurrentUser true',
    s1Order.passenger?.isCurrentUser === true, String(s1Order.passenger?.isCurrentUser));
  expect('S1: order.passenger.authorId pinned to LOCAL_USER_ID',
    s1Order.passenger?.authorId === LOCAL_USER_ID, String(s1Order.passenger?.authorId));
  expect('S1: order appears in (await listNearbyOrders())',
    (await listNearbyOrders()).some((o) => o.id === s1Order.id));
}

// ── Scenario 2 — Driver sees the available order ─────────────────────────────
// Same local user account, "different jacket". Flipping user.role does not
// touch the persisted ride_orders store, so the passenger's order must remain
// listable with its original passenger snapshot intact.
user.set({ role: 'driver', firstName: 'Рустам', lastName: 'К.' });
{
  const nearby = (await listNearbyOrders());
  const found = nearby.find((o) => o.id === s1Order.id);
  expect('S2: driver lists the passenger\'s order',
    !!found, found ? found.id : 'not found');
  expect('S2: order.status still CREATED for driver view',
    found?.status === 'CREATED', String(found?.status));
  expect('S2: passenger snapshot unchanged after local role flip',
    found?.passenger?.name === 'Алия К.', String(found?.passenger?.name));
  expect('S2: order has no driver / driverSnapshot field yet',
    found?.driver === undefined && found?.driverSnapshot === undefined,
    JSON.stringify({ driver: found?.driver, driverSnapshot: found?.driverSnapshot }));
}

// ── Scenario 3 — Driver responds; snapshot lands on response (NOT order) ─────
const s3Response = buildResponseFor(s1Order, { name: 'Рустам К.', rating: 4.8 });
writeResponseToStore(s3Response);
{
  const list = inlineLoadResponsesForOrder(s1Order.id);
  expect('S3: inlineLoadResponsesForOrder returns one response',
    list.length === 1, String(list.length));
  expect('S3: response.kind === "passenger_response"',
    list[0]?.kind === 'passenger_response', String(list[0]?.kind));
  expect('S3: response.orderId matches order',
    list[0]?.orderId === s1Order.id, String(list[0]?.orderId));
  expect('S3: driverSnapshot.name reflects driver user',
    list[0]?.driverSnapshot?.name === 'Рустам К.', String(list[0]?.driverSnapshot?.name));
  expect('S3: driverSnapshot.name !== order.passenger.name (anti-conflation)',
    list[0]?.driverSnapshot?.name !== getOrderById(s1Order.id)?.passenger?.name);
  const snap = list[0]?.driverSnapshot;
  const allStrings = snap
    && typeof snap.name     === 'string'
    && typeof snap.car      === 'string'
    && typeof snap.carModel === 'string'
    && typeof snap.carColor === 'string'
    && typeof snap.plate    === 'string';
  expect('S3: driverSnapshot fields are strings (mapResponseToDriverCard pickStr contract)',
    allStrings, snap ? JSON.stringify(Object.keys(snap)) : 'no snap');
}

// ── Scenario 4 — acceptOrder + cross-role invariants ─────────────────────────
const s4Accepted = acceptOrder(s1Order.id);
const s4Reread = getOrderById(s1Order.id);
{
  expect('S4: acceptOrder returns ACCEPTED status',
    s4Accepted?.status === 'ACCEPTED', String(s4Accepted?.status));
  expect('S4: accepted.acceptedAt is a string',
    typeof s4Accepted?.acceptedAt === 'string' && s4Accepted.acceptedAt.length > 0,
    String(s4Accepted?.acceptedAt));
  expect('S4: order.passenger.name UNCHANGED after accept',
    s4Reread?.passenger?.name === 'Алия К.', String(s4Reread?.passenger?.name));
  expect('S4: no driver field leaked onto order after accept',
    s4Reread?.driver === undefined && s4Reread?.driverSnapshot === undefined,
    JSON.stringify({ driver: s4Reread?.driver, driverSnapshot: s4Reread?.driverSnapshot }));
  expect('S4: responses survive acceptOrder',
    inlineLoadResponsesForOrder(s1Order.id).length === 1);
  expect('S4: ACCEPTED order drops from listNearbyOrders (CREATED filter)',
    !(await listNearbyOrders()).some((o) => o.id === s1Order.id));
}

// ── Scenario 5 — effectiveRole priority matrix (mirrors active_ride.js:322) ──
// const role = query.get('role') || (resolveRole(user.get()) === 'driver'
//                                      ? 'driver' : 'passenger');
// Priority: URL > smoke override > persisted user.role > fallback passenger.
reset();
user.set({ role: 'driver', firstName: 'Рустам', onboarded: true });
const effective = (queryRole) => queryRole || (getSmokeRole() || user.get()?.role || 'passenger');
{
  expect('S5: URL ?role=passenger wins over persisted driver',
    effective('passenger') === 'passenger', String(effective('passenger')));
  expect('S5: URL ?role=driver wins regardless',
    effective('driver') === 'driver', String(effective('driver')));
  expect('S5: persisted driver wins when no URL / no smoke',
    effective(null) === 'driver', String(effective(null)));
  setSmokeRole('passenger');
  expect('S5: smoke=passenger beats persisted driver',
    effective(null) === 'passenger', String(effective(null)));
  expect('S5: smoke=passenger does NOT mutate persisted user.role',
    persistedRole() === 'driver', String(persistedRole()));
  clearSmokeRole();
  expect('S5: after clearSmokeRole effective falls back to persisted driver',
    effective(null) === 'driver', String(effective(null)));
  expect('S5: sessionStorage smoke key removed by clearSmokeRole',
    session.get(SMOKE_ROLE_KEY) === undefined, String(session.get(SMOKE_ROLE_KEY)));
}

// ── Scenario 6 — History role isolation: same user, both roles ───────────────
// One ride, two role-tagged history entries. Asserts:
//   • two records persisted under one tripId,
//   • passenger entry has rating/tags/comment but NO receipt,
//   • driver entry has receipt but NO rating/tags/comment,
//   • smoke-role filter (BD-RIDE-ORDER-01 fix in ride_history.js:20-26)
//     picks the right subset per tab.
reset();
user.set({ role: 'driver', firstName: 'Рустам', onboarded: true });
clearRideHistory();
const s6Ride = {
  tripId: 'trip_test',
  driver:    { name: 'Рустам К.', initials: 'РК', rating: 4.8 },
  passenger: { name: 'Алия К.', initials: 'АК', rating: 5 },
  vehicle:   { model: 'Camry', color: 'белый', plate: 'А 123 АА 77' },
  route:     { pickupLabel: 'A', dropoffLabel: 'Б' },
  payment:   { amount: '1700 ₸' },
  timestamps:{ completedAt: '2026-06-07T10:00:00Z' },
};
saveRideHistoryEntry(buildPassengerHistoryEntry(s6Ride, { rating: 5, tags: ['ontime'], comment: 'ok' }));
saveRideHistoryEntry(buildDriverHistoryEntry(s6Ride, {
  receipt: { fare: 1700, commission: 170, tip: 0, net: 1530, paymentMode: 'cash' },
}));
{
  const all = loadRideHistory();
  expect('S6: two history entries persisted under one tripId',
    all.length === 2, String(all.length));
  expect('S6: both entries share tripId',
    all.every((e) => e.tripId === 'trip_test'));
  const pax = all.find((e) => e.role === 'passenger');
  const drv = all.find((e) => e.role === 'driver');
  expect('S6: roles split (passenger + driver both present)',
    !!pax && !!drv);
  expect('S6: passenger entry has NO driver-only `receipt` field',
    pax?.receipt === undefined, JSON.stringify(Object.keys(pax || {})));
  expect('S6: driver entry has NO passenger-only `rating`/`tags`/`comment`',
    drv?.rating === undefined && drv?.tags === undefined && drv?.comment === undefined,
    JSON.stringify({ rating: drv?.rating, tags: drv?.tags, comment: drv?.comment }));

  // BD-RIDE-ORDER-01 contract: getSmokeRole() wins over persisted user.role
  // in currentHistoryRole().
  setSmokeRole('passenger');
  const paxView = readRideHistoryStatus();
  expect('S6: smoke=passenger filters history to passenger entry only',
    paxView.entries.length === 1 && paxView.entries[0].role === 'passenger',
    JSON.stringify({ n: paxView.entries.length, role: paxView.entries[0]?.role }));
  setSmokeRole('driver');
  const drvView = readRideHistoryStatus();
  expect('S6: smoke=driver filters history to driver entry only',
    drvView.entries.length === 1 && drvView.entries[0].role === 'driver',
    JSON.stringify({ n: drvView.entries.length, role: drvView.entries[0]?.role }));
  clearSmokeRole();
}

// ── Scenario 7 — Single user, two jackets (final guardrail) ──────────────────
// One local user account drives both sides of the chain. Even with the same
// LOCAL_USER_ID under the hood, the passenger snapshot and the driver
// snapshot must remain identifiably distinct — the bug class this whole
// audit pair (BD-RIDE-ORDER-01 + BD-ROLE-05 + this smoke) is locking down.
reset();
clearRideOrdersStore();
user.set({ role: 'passenger', firstName: 'Алия', lastName: 'К.', onboarded: true });
const s7Order = await createRideOrder({
  type: 'ride_order',
  pickup:  { id: 'p1', label: 'A' },
  dropoff: { id: 'p2', label: 'Б' },
  passenger: {
    name: 'Алия К.', initials: 'АК',
    authorId: LOCAL_USER_ID, isCurrentUser: true,
  },
});
user.set({ role: 'driver', firstName: 'Рустам', lastName: 'К.' });
writeResponseToStore(buildResponseFor(s7Order, { name: 'Рустам К.', rating: 4.8 }));
{
  const reread = getOrderById(s7Order.id);
  const responses = inlineLoadResponsesForOrder(s7Order.id);
  expect('S7: order.passenger.name !== response.driverSnapshot.name (identity does not collapse)',
    reread?.passenger?.name !== responses[0]?.driverSnapshot?.name,
    JSON.stringify({ pax: reread?.passenger?.name, drv: responses[0]?.driverSnapshot?.name }));
  expect('S7: order.passenger.authorId still pinned to LOCAL_USER_ID',
    reread?.passenger?.authorId === LOCAL_USER_ID, String(reread?.passenger?.authorId));
  expect('S7: response.kind tags it as driver→passenger response (no role conflation)',
    responses[0]?.kind === 'passenger_response', String(responses[0]?.kind));
}

// ── Scenario 8 — Unpinned live ride is NOT upgraded (Codex P1 safety) ───────
// SAFETY > RECOVERY: a live active ride that lacks `selectedDriver.responseId`
// could have been accepted via any seam (DriverMap accept,
// acceptCanonicalRideOrder, ride_actions, future canonical accept) that
// does NOT pin a response id. Meanwhile bazardrive.responses.v1 may carry
// passenger_response records from completely different drivers who never
// became the accepted driver. Picking the "latest" of those would silently
// rewrite the accepted identity on the next /responses or /active-ride
// render. The fix runs at the accept seam (set responseId at the time of
// acceptance), not at the render seam. Until then the render seam refuses
// to guess: stale stays stale.
reset();
clearRideOrdersStore();
user.set({ role: 'passenger', firstName: 'Алия', lastName: 'К.', onboarded: true });
const s8Order = await createRideOrder({
  type: 'ride_order',
  pickup:  { id: 'p1', label: 'A' },
  dropoff: { id: 'p2', label: 'Б' },
  passenger: { name: 'Алия К.', authorId: LOCAL_USER_ID, isCurrentUser: true },
});
const s8TripId = `trip_${s8Order.id}`;
const s8StaleRide = {
  tripId: s8TripId,
  status: RIDE_STATUS.DRIVER_EN_ROUTE,
  driver:  { name: 'Рустам К.', initials: 'РК', rating: '4,92' },
  vehicle: { model: 'Toyota Camry', color: 'белый', plate: 'А 123 БВ 77' },
  selectedDriver: { id: 'mock_d1', name: 'Рустам К.' },  // no responseId pin
};
saveActiveRide(s8StaleRide);
{
  // No responses yet: resolver returns null, upgrade is a no-op.
  expect('S8 pre: resolveDriverSnapshotForRide returns null with no responses',
    resolveDriverSnapshotForRide(s8StaleRide, s8Order.id) === null);
  const orchestratorEmpty = upgradeStoredActiveRideForOrder(s8Order.id);
  expect('S8 pre: orchestrator no-op when no responses → returns stale ride',
    orchestratorEmpty?.driver?.name === 'Рустам К.',
    String(orchestratorEmpty?.driver?.name));
}
// A real driver sends a response. This is the P1 hazard: before the fix,
// resolveDriverSnapshotForRide would have fallen back to latest and the
// orchestrator would have rewritten the stale ride to this responder's
// identity. After the fix the unpinned ride is left alone.
writeResponseToStore(buildResponseFor(s8Order, { name: 'Алексей Тест', rating: 4.95 }));
{
  // The helper still works for diagnostic / legacy access — it's only the
  // live upgrade path that stopped using it.
  const latestHelper = resolveLatestDriverSnapshotForOrder(s8Order.id);
  expect('S8: resolveLatestDriverSnapshotForOrder still surfaces Алексей (helper)',
    latestHelper?.name === 'Алексей Тест', String(latestHelper?.name));
  // The smart resolver refuses to guess for an unpinned ride.
  expect('S8: resolveDriverSnapshotForRide returns null for unpinned ride',
    resolveDriverSnapshotForRide(s8StaleRide, s8Order.id) === null);
  // Orchestrator therefore returns the stale ride unchanged.
  const result = upgradeStoredActiveRideForOrder(s8Order.id);
  expect('S8: orchestrator does NOT upgrade unpinned ride',
    result?.driver?.name === 'Рустам К.', String(result?.driver?.name));
  expect('S8: persisted ride still shows stale "Рустам К." after orchestrator',
    findActiveRide(s8TripId)?.driver?.name === 'Рустам К.',
    String(findActiveRide(s8TripId)?.driver?.name));
}
// A second responder enters. Pre-fix, "latest" would have flipped the ride
// to this newest record — post-fix, still no change.
const s8SecondResponder = {
  ...buildResponseFor(s8Order, { name: 'Сергей Петров', rating: 4.5 }),
  id: `resp_second_${s8Order.id}`,
  createdAt: '2030-01-01T00:00:00Z',  // ensure it's the newest
};
// Preserve both responses in the keyed map; writeResponseToStore would
// replace the whole map.
{
  const existing = JSON.parse(localStorage.getItem(RESPONSES_KEY) || '{}');
  existing[s8SecondResponder.id] = s8SecondResponder;
  localStorage.setItem(RESPONSES_KEY, JSON.stringify(existing));
}
{
  const latestHelper = resolveLatestDriverSnapshotForOrder(s8Order.id);
  expect('S8: helper now returns "Сергей Петров" as latest (sanity)',
    latestHelper?.name === 'Сергей Петров', String(latestHelper?.name));
  const result = upgradeStoredActiveRideForOrder(s8Order.id);
  expect('S8: orchestrator STILL refuses to upgrade unpinned ride',
    result?.driver?.name === 'Рустам К.', String(result?.driver?.name));
  expect('S8: persisted ride byte-stable, "Сергей Петров" did not leak in',
    findActiveRide(s8TripId)?.driver?.name === 'Рустам К.',
    String(findActiveRide(s8TripId)?.driver?.name));

  // upgradeRideFromDriverSnapshot itself stays an identity for null snap —
  // the same guard the orchestrator relies on.
  expect('S8: upgradeRideFromDriverSnapshot(ride, null) is a no-op',
    upgradeRideFromDriverSnapshot(s8StaleRide, null) === s8StaleRide);
}

// ── Scenario 9 — Terminal ride is NEVER upgraded (BD-LIFE-05 guardrail) ──────
// COMPLETED / CANCELED / NO_SHOW rides are over; their final driver identity
// must stay locked — upgrading them after the fact would rewrite history.
reset();
clearRideOrdersStore();
user.set({ role: 'passenger', firstName: 'Алия', lastName: 'К.', onboarded: true });
const s9Order = await createRideOrder({
  type: 'ride_order',
  pickup: { id:'p1', label:'A' }, dropoff: { id:'p2', label:'Б' },
  passenger: { name: 'Алия К.', authorId: LOCAL_USER_ID, isCurrentUser: true },
});
writeResponseToStore(buildResponseFor(s9Order, { name: 'Алексей Тест', rating: 4.95 }));
const s9Snap = resolveLatestDriverSnapshotForOrder(s9Order.id);
for (const terminalStatus of [RIDE_STATUS.COMPLETED, RIDE_STATUS.CANCELED, RIDE_STATUS.NO_SHOW]) {
  const terminalRide = {
    tripId: `trip_${s9Order.id}`,
    status: terminalStatus,
    driver:  { name: 'Рустам К.', initials: 'РК', rating: '4,92' },
    vehicle: { model: 'Toyota Camry', color: 'белый', plate: 'А 123 БВ 77' },
  };
  const result = upgradeRideFromDriverSnapshot(terminalRide, s9Snap);
  expect(`S9: ${terminalStatus} ride is NOT upgraded (same reference returned)`,
    result === terminalRide);
  expect(`S9: ${terminalStatus} ride.driver.name preserved as "Рустам К."`,
    result.driver?.name === 'Рустам К.', String(result.driver?.name));
}

// ── Scenario 10 — Pinned responseId resolver (BD-LIFE-05 / Codex P2) ─────────
// Two drivers respond to the same order. The passenger accepts driver A
// first, so buildPassengerActiveRide pins selectedDriver.responseId to A's
// response.id. Later, driver B sends a (newer) response. The upgrade path
// must keep A — not let the latest-by-createdAt response rewrite the
// accepted identity.
reset();
clearRideOrdersStore();
user.set({ role: 'passenger', firstName: 'Алия', lastName: 'К.', onboarded: true });
const s10Order = await createRideOrder({
  type: 'ride_order',
  pickup: { id:'p1', label:'A' }, dropoff: { id:'p2', label:'Б' },
  passenger: { name: 'Алия К.', authorId: LOCAL_USER_ID, isCurrentUser: true },
});
{
  // Two real responses, A older, B newer.
  const respA = {
    ...buildResponseFor(s10Order, { name: 'Driver A', rating: 4.7 }),
    id: `resp_a_${s10Order.id}`,
    createdAt: '2026-06-01T10:00:00Z',
  };
  respA.driverSnapshot.plate = 'А 100 АА 77';
  const respB = {
    ...buildResponseFor(s10Order, { name: 'Driver B', rating: 4.9 }),
    id: `resp_b_${s10Order.id}`,
    createdAt: '2026-06-02T10:00:00Z',
  };
  respB.driverSnapshot.plate = 'В 200 ВВ 77';
  localStorage.setItem(RESPONSES_KEY, JSON.stringify({
    [respA.id]: respA,
    [respB.id]: respB,
  }));

  // Sanity: latest-by-createdAt resolver returns B (the buggy behaviour).
  const latest = resolveLatestDriverSnapshotForOrder(s10Order.id);
  expect('S10 pre: resolveLatestDriverSnapshotForOrder returns latest (B)',
    latest?.name === 'Driver B', String(latest?.name));

  // Save an active ride pinning the passenger's accepted driver = A.
  const s10TripId = `trip_${s10Order.id}`;
  const acceptedRide = {
    tripId: s10TripId,
    status: RIDE_STATUS.DRIVER_EN_ROUTE,
    driver:  { name: 'Driver A', initials: 'D', rating: 4.7 },
    vehicle: { model: 'Camry', color: 'белый', plate: 'А 100 АА 77' },
    selectedDriver: { id: respA.id, responseId: respA.id, name: 'Driver A' },
  };
  saveActiveRide(acceptedRide);

  // The smart resolver MUST return A's snapshot, not B's.
  const pinned = resolveDriverSnapshotForRide(acceptedRide, s10Order.id);
  expect('S10: resolveDriverSnapshotForRide picks pinned A, not latest B',
    pinned?.name === 'Driver A', String(pinned?.name));
  expect('S10: pinned snapshot carries A.plate',
    pinned?.plate === 'А 100 АА 77', String(pinned?.plate));

  // The full orchestrator must leave the accepted ride pointing at A.
  const upgradedFor = upgradeStoredActiveRideForOrder(s10Order.id);
  expect('S10: upgradeStoredActiveRideForOrder keeps driver.name = "Driver A"',
    upgradedFor?.driver?.name === 'Driver A', String(upgradedFor?.driver?.name));
  expect('S10: upgrade did NOT overwrite to later driver B',
    !String(upgradedFor?.driver?.name || '').includes('Driver B'));
  expect('S10: persisted ride after orchestrator still shows A',
    findActiveRide(s10TripId)?.driver?.name === 'Driver A',
    String(findActiveRide(s10TripId)?.driver?.name));

  // Pinned id pointing at a missing/malformed response → resolver returns
  // null. SAFETY > RECOVERY (Codex P1): we do NOT fall back to latest here
  // either, because the "latest" record may belong to an unrelated driver
  // and would silently rewrite the accepted identity. The ride stays stale
  // until either (a) the pinned response reappears, or (b) the accept seam
  // is fixed to set a valid responseId. Stale render is preferable to wrong
  // identity render.
  const orphanRide = {
    tripId: `trip_orphan_${s10Order.id}`,
    status: RIDE_STATUS.DRIVER_EN_ROUTE,
    driver:  { name: 'Рустам К.', initials: 'РК' },
    vehicle: { model: 'demo', color: '', plate: 'А 999 АА 77' },
    selectedDriver: { id: 'resp_missing', responseId: 'resp_missing', name: 'Stale' },
  };
  const orphanSnap = resolveDriverSnapshotForRide(orphanRide, s10Order.id);
  expect('S10: pinned-but-missing response returns null (no latest-guess)',
    orphanSnap === null, String(orphanSnap?.name));
}

// ── Scenario 11 — Direct /active-ride entry orchestrator (Codex P2 + P1) ─────
// Mirrors what active_ride_passenger.js does after BD-LIFE-05:
// loadCanonicalActiveRide → upgradeStoredActiveRideForOrder. Two cases:
//   A. PINNED ride (selectedDriver.responseId set) with a stale or partial
//      driver display → orchestrator upgrades from the pinned response,
//      not from "latest". This is the path /responses sets up when the
//      passenger picks a driver — reload of /active-ride must converge.
//   B. UNPINNED ride (no selectedDriver.responseId; DriverMap-style accept)
//      → orchestrator is a no-op even when responses exist for the order,
//      because picking the latest would risk renaming the accepted driver
//      (Codex P1). Stale display stays as-is.
reset();
clearRideOrdersStore();
user.set({ role: 'passenger', firstName: 'Алия', lastName: 'К.', onboarded: true });
const s11Order = await createRideOrder({
  type: 'ride_order',
  pickup: { id:'p1', label:'A' }, dropoff: { id:'p2', label:'Б' },
  passenger: { name: 'Алия К.', authorId: LOCAL_USER_ID, isCurrentUser: true },
});
const s11TripId = `trip_${s11Order.id}`;
const s11PinnedResponseId = `resp_pinned_${s11Order.id}`;
const s11LatestResponderId = `resp_late_${s11Order.id}`;

// CASE A — PINNED ride with stale display name. /responses created it
// pointing at a specific response; the passenger reloads at /active-ride
// before the in-memory upgrade fired, so the persisted record still has the
// placeholder display name. Orchestrator must sync from the pinned
// response.
{
  const pinnedResponse = {
    ...buildResponseFor(s11Order, { name: 'Алексей Тест', rating: 4.95 }),
    id: s11PinnedResponseId,
    createdAt: '2026-06-01T10:00:00Z',
  };
  // Another responder enters later. Pre-fix, latest would have leaked into
  // even pinned upgrades because the pinned lookup also had a latest
  // fallback. After the fix, only the pinned record is consulted.
  const lateResponder = {
    ...buildResponseFor(s11Order, { name: 'Late Driver', rating: 4.3 }),
    id: s11LatestResponderId,
    createdAt: '2030-01-01T00:00:00Z',
  };
  localStorage.setItem(RESPONSES_KEY, JSON.stringify({
    [pinnedResponse.id]: pinnedResponse,
    [lateResponder.id]: lateResponder,
  }));
  const pinnedStale = {
    tripId: s11TripId,
    status: RIDE_STATUS.DRIVER_EN_ROUTE,
    driver:  { name: 'Водитель', initials: 'В' },
    vehicle: { model: '', color: '', plate: '' },
    selectedDriver: { id: pinnedResponse.id, responseId: pinnedResponse.id, name: 'Водитель' },
  };
  saveActiveRide(pinnedStale);

  expect('S11A pre: pinned stale ride loads with placeholder "Водитель"',
    findActiveRide(s11TripId)?.driver?.name === 'Водитель',
    String(findActiveRide(s11TripId)?.driver?.name));
  const upgraded = upgradeStoredActiveRideForOrder(s11Order.id);
  expect('S11A: direct-entry orchestrator upgrades pinned ride to "Алексей Тест"',
    upgraded?.driver?.name === 'Алексей Тест', String(upgraded?.driver?.name));
  expect('S11A: pinned upgrade is NOT contaminated by the later responder',
    upgraded?.driver?.name !== 'Late Driver', String(upgraded?.driver?.name));
  expect('S11A: persisted ride re-read carries the pinned driver',
    findActiveRide(s11TripId)?.driver?.name === 'Алексей Тест',
    String(findActiveRide(s11TripId)?.driver?.name));
  const second = upgradeStoredActiveRideForOrder(s11Order.id);
  expect('S11A: stable second pass — driver still "Алексей Тест"',
    second?.driver?.name === 'Алексей Тест', String(second?.driver?.name));
}

// CASE B — UNPINNED ride (DriverMap-style accept that did not write a
// selectedDriver.responseId). Even though responses exist for this order
// AND the late responder is "latest", the orchestrator MUST leave the
// stale display alone (Codex P1).
reset();
clearRideOrdersStore();
user.set({ role: 'passenger', firstName: 'Алия', lastName: 'К.', onboarded: true });
const s11bOrder = await createRideOrder({
  type: 'ride_order',
  pickup: { id:'p1', label:'A' }, dropoff: { id:'p2', label:'Б' },
  passenger: { name: 'Алия К.', authorId: LOCAL_USER_ID, isCurrentUser: true },
});
const s11bTripId = `trip_${s11bOrder.id}`;
const s11bStale = {
  tripId: s11bTripId,
  status: RIDE_STATUS.DRIVER_EN_ROUTE,
  driver:  { name: 'Рустам К.', initials: 'РК', rating: '4,92' },
  vehicle: { model: 'Toyota Camry', color: 'белый', plate: 'А 123 БВ 77' },
  // selectedDriver intentionally omitted — DriverMap accept path doesn't
  // set it.
};
saveActiveRide(s11bStale);
writeResponseToStore(buildResponseFor(s11bOrder, { name: 'Wrong Driver', rating: 4.5 }));
{
  expect('S11B pre: unpinned stale ride loads as "Рустам К."',
    findActiveRide(s11bTripId)?.driver?.name === 'Рустам К.',
    String(findActiveRide(s11bTripId)?.driver?.name));
  const result = upgradeStoredActiveRideForOrder(s11bOrder.id);
  expect('S11B: orchestrator no-op on unpinned ride — driver stays "Рустам К."',
    result?.driver?.name === 'Рустам К.', String(result?.driver?.name));
  expect('S11B: unrelated responder "Wrong Driver" did NOT leak into the ride',
    result?.driver?.name !== 'Wrong Driver', String(result?.driver?.name));
  expect('S11B: persisted ride byte-stable after orchestrator on unpinned',
    findActiveRide(s11bTripId)?.driver?.name === 'Рустам К.',
    String(findActiveRide(s11bTripId)?.driver?.name));
}

// Orchestrator no-op edge cases: empty/missing orderId, and no ride at tripId.
{
  expect('S11: orchestrator with empty orderId returns null',
    upgradeStoredActiveRideForOrder('') === null);
  expect('S11: orchestrator with unknown orderId returns null',
    upgradeStoredActiveRideForOrder('does-not-exist') === null);
}

// ── Scenario 12 — DriverMap accept seeds current driver profile (BD-LIFE-06) ─
// acceptCanonicalRideOrder is the shared accept seam for Feed, Post Detail,
// and DriverMap direct-accept. Before BD-LIFE-06 it created the active ride
// via createDemoActiveRide(...) without any driver/vehicle overrides, so
// passengers landing on /responses?state=accepted or /active-ride saw the
// "Рустам К." demo seed baked into ride_state.js:157-163 even when a real
// driver had accepted. Fix: replace ride.driver / ride.vehicle entirely
// (mirroring buildAcceptedOrderPassenger's BD-ACTIVE-07 replace pattern) so
// no demo fields can leak through deepMerge.
reset();
clearRideOrdersStore();
user.set({
  role: 'driver',
  onboarded: true,
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '+77001234567', phoneVerified: true,
  vehicleMake: 'Toyota', vehicleModel: 'Camry',
  vehicleColor: 'белый', vehiclePlate: 'А 123 БВ 77',
  rating: 4.95,  // exercise the ru-RU rating formatter
});
const s12Order = await createRideOrder({
  type: 'ride_order',
  pickup: { id:'p1', label:'A' }, dropoff: { id:'p2', label:'Б' },
  estimatedPrice: 1700, distanceKm: 12, durationMin: 22,
  passenger: { name: 'Алия К.', authorId: LOCAL_USER_ID, isCurrentUser: true },
});
const s12TripId = `trip_${s12Order.id}`;
// Explicit acceptedSource: 'driver_map' to simulate the DriverMap surface.
const s12Accepted = acceptCanonicalRideOrder(s12Order.id, { acceptedSource: 'driver_map' });
{
  expect('S12: acceptCanonicalRideOrder returns a ride bound to the order',
    s12Accepted?.tripId === s12TripId && s12Accepted?.order?.id === s12Order.id,
    JSON.stringify({ tripId: s12Accepted?.tripId, orderId: s12Accepted?.order?.id }));
  const ride = s12Accepted?.ride;
  expect('S12: seeded ride.driver.name === current driver profile name',
    ride?.driver?.name === 'Иван Драйвер', String(ride?.driver?.name));
  expect('S12: seeded ride.driver.name does NOT contain "Рустам"',
    !String(ride?.driver?.name || '').includes('Рустам'));
  expect('S12: seeded ride.driver.initials recomputed from real name',
    ride?.driver?.initials === 'И', String(ride?.driver?.initials));
  // Codex P3 — rating must format in ru-RU locale ("4,95"), not en-US ("4.95"),
  // and not leak the demo string "4,92" from buildDemoRide.driver.rating.
  expect('S12: seeded ride.driver.rating formatted in ru-RU locale',
    ride?.driver?.rating === '4,95', String(ride?.driver?.rating));
  // Codex P2 #1 (the core review finding) — buildDemoRide().driver carries
  // shiftDuration: '5ч 12м'; if seeding still used deepMerge that field
  // would leak onto every real-driver ride and active_ride.js:405 would
  // render it into the driver status pill.
  expect('S12: ride.driver.shiftDuration is undefined (no demo leak)',
    ride?.driver?.shiftDuration === undefined, String(ride?.driver?.shiftDuration));
  expect('S12: ride.driver.onlineLabel is undefined (no demo leak)',
    ride?.driver?.onlineLabel === undefined, String(ride?.driver?.onlineLabel));
  expect('S12: seeded ride.vehicle.model reflects current profile vehicle',
    ride?.vehicle?.model === 'Toyota Camry', String(ride?.vehicle?.model));
  expect('S12: seeded ride.vehicle.color reflects current profile vehicle',
    ride?.vehicle?.color === 'белый', String(ride?.vehicle?.color));
  expect('S12: seeded ride.vehicle.plate is masked (Russian-format middle)',
    ride?.vehicle?.plate === 'А ••• БВ 77', String(ride?.vehicle?.plate));
  // Passenger snapshot must survive the new replace-driver flow (the
  // existing BD-ACTIVE-07 contract should not regress).
  expect('S12: ride.passenger.name pinned from the order snapshot',
    ride?.passenger?.name === 'Алия К.', String(ride?.passenger?.name));
  expect('S12: ride.passenger.luggage absent (no demo "1 чемодан" leak)',
    ride?.passenger?.luggage === '' || ride?.passenger?.luggage === undefined,
    String(ride?.passenger?.luggage));
  expect('S12: ride.acceptedSource === "driver_map" (caller-provided)',
    ride?.acceptedSource === 'driver_map', String(ride?.acceptedSource));
  expect('S12: ride has NO selectedDriver.responseId (DriverMap accept is unpinned)',
    !ride?.selectedDriver?.responseId, String(ride?.selectedDriver?.responseId));
  expect('S12: order status flipped to ACCEPTED',
    getOrderById(s12Order.id)?.status === 'ACCEPTED',
    String(getOrderById(s12Order.id)?.status));
  expect('S12: ride.status === ACCEPTED',
    ride?.status === RIDE_STATUS.ACCEPTED, String(ride?.status));
  // Passenger surfaces read from this same persisted record — verify the
  // re-read survives JSON round-trip.
  const reread = findActiveRide(s12TripId);
  expect('S12: persisted ride re-read carries the real driver',
    reread?.driver?.name === 'Иван Драйвер', String(reread?.driver?.name));
  expect('S12: persisted ride re-read carries the real vehicle plate',
    reread?.vehicle?.plate === 'А ••• БВ 77', String(reread?.vehicle?.plate));
  expect('S12: persisted ride re-read shows NO shiftDuration leak',
    reread?.driver?.shiftDuration === undefined,
    String(reread?.driver?.shiftDuration));
}

// ── Scenario 13 — BD-LIFE-05 safety still applies to DriverMap-accepted rides
// An unrelated passenger_response from a different driver arrives AFTER the
// DriverMap accept. The orchestrator (resolveDriverSnapshotForRide) refuses
// to upgrade because the ride has no selectedDriver.responseId pinning —
// the DriverMap-accepted driver's identity stays intact.
{
  // Write an unrelated response from "Анна Чужая".
  writeResponseToStore(buildResponseFor(s12Order, { name: 'Анна Чужая', rating: 4.5 }));
  expect('S13 pre: an unrelated response exists for the order',
    inlineLoadResponsesForOrder(s12Order.id).length === 1);
  expect('S13 pre: resolveLatestDriverSnapshotForOrder surfaces "Анна Чужая"',
    resolveLatestDriverSnapshotForOrder(s12Order.id)?.name === 'Анна Чужая',
    String(resolveLatestDriverSnapshotForOrder(s12Order.id)?.name));

  // The smart resolver returns null because the ride has no responseId pin.
  const rideBefore = findActiveRide(s12TripId);
  expect('S13: resolveDriverSnapshotForRide returns null for DriverMap-accepted ride',
    resolveDriverSnapshotForRide(rideBefore, s12Order.id) === null);

  // Therefore the orchestrator does NOT overwrite the DriverMap driver.
  const orchestrated = upgradeStoredActiveRideForOrder(s12Order.id);
  expect('S13: orchestrator preserves DriverMap-accepted driver name',
    orchestrated?.driver?.name === 'Иван Драйвер', String(orchestrated?.driver?.name));
  expect('S13: unrelated responder "Анна Чужая" did NOT leak in',
    orchestrated?.driver?.name !== 'Анна Чужая', String(orchestrated?.driver?.name));
  expect('S13: persisted ride byte-stable after orchestrator',
    findActiveRide(s12TripId)?.driver?.name === 'Иван Драйвер',
    String(findActiveRide(s12TripId)?.driver?.name));
  expect('S13: ride.acceptedSource still === "driver_map" after orchestrator',
    findActiveRide(s12TripId)?.acceptedSource === 'driver_map',
    String(findActiveRide(s12TripId)?.acceptedSource));
}

// ── Scenario 12B — acceptedSource label is accurate per caller (Codex P2 #2) ─
// seedActiveRideFromAcceptedOrder is the shared seeder; before the fix it
// hardcoded 'driver_map' regardless of which surface accepted, so Feed and
// Post Detail accepts mislabelled their acceptedSource. The fix
// parameterises acceptedSource through acceptCanonicalRideOrder.
//
// Each sub-case runs its own reset + createRideOrder + accept so the three
// orders cannot collide on `order-${Date.now()}` (createRideOrder uses
// millisecond-resolution ids; three back-to-back calls in the same ms
// would produce the same id and a single accept would flip all of them
// to ACCEPTED, masking the per-caller label assertion).
function seedDriverProfile() {
  user.set({
    role: 'driver', onboarded: true, displayName: 'Иван Драйвер',
    phone: '+77001234567', phoneVerified: true,
    vehicleMake: 'Toyota', vehicleModel: 'Camry',
    vehiclePlate: 'А 100 АА 77', vehicleColor: 'белый',
  });
}
async function freshOrder() {
  return await createRideOrder({
    type: 'ride_order', pickup:{id:'p1',label:'A'}, dropoff:{id:'p2',label:'Б'},
    passenger: { name: 'Алия К.', authorId: LOCAL_USER_ID, isCurrentUser: true },
  });
}

// Feed accept → 'feed'
reset(); clearRideOrdersStore(); seedDriverProfile();
const acceptedFromFeed = acceptCanonicalRideOrder((await freshOrder()).id, { acceptedSource: 'feed' });
expect('S12B: Feed accept tags ride.acceptedSource === "feed"',
  acceptedFromFeed?.ride?.acceptedSource === 'feed',
  String(acceptedFromFeed?.ride?.acceptedSource));
expect('S12B: Feed accept does NOT mislabel as "driver_map"',
  acceptedFromFeed?.ride?.acceptedSource !== 'driver_map');

// Post Detail accept → 'post_detail'
reset(); clearRideOrdersStore(); seedDriverProfile();
const acceptedFromPost = acceptCanonicalRideOrder((await freshOrder()).id, { acceptedSource: 'post_detail' });
expect('S12B: Post Detail accept tags ride.acceptedSource === "post_detail"',
  acceptedFromPost?.ride?.acceptedSource === 'post_detail',
  String(acceptedFromPost?.ride?.acceptedSource));
expect('S12B: Post Detail accept does NOT mislabel as "driver_map"',
  acceptedFromPost?.ride?.acceptedSource !== 'driver_map');

// Default (no caller option) → neutral 'canonical_accept'
reset(); clearRideOrdersStore(); seedDriverProfile();
const acceptedFromDefault = acceptCanonicalRideOrder((await freshOrder()).id);
expect('S12B: default (no caller option) tags neutral "canonical_accept"',
  acceptedFromDefault?.ride?.acceptedSource === 'canonical_accept',
  String(acceptedFromDefault?.ride?.acceptedSource));
expect('S12B: default does NOT mislabel as "driver_map"',
  acceptedFromDefault?.ride?.acceptedSource !== 'driver_map');

// ── Scenario 12C — Missing optional profile fields fall back to non-demo  ────
// Codex P2 — A line-ready driver profile may lack a numeric `rating` and/or a
// `vehicleColor`. Storing '' for either field lets passenger surfaces apply
// their hardcoded `|| '4,92'` / `|| 'серый'` fallbacks, surfacing demo data
// for a real accepted ride. The snapshot now persists non-falsy neutrals:
// '—' for rating and 'цвет не указан' for color.

// Case A — rating missing on profile (no `user.rating` field set).
reset(); clearRideOrdersStore();
user.set({
  role: 'driver', onboarded: true, displayName: 'Иван Драйвер',
  phone: '+77001234567', phoneVerified: true,
  vehicleMake: 'Toyota', vehicleModel: 'Camry',
  vehicleColor: 'белый', vehiclePlate: 'А 123 БВ 77',
  // intentionally no `rating`
});
const acceptedNoRating = acceptCanonicalRideOrder((await freshOrder()).id, { acceptedSource: 'driver_map' });
{
  const ride = acceptedNoRating?.ride;
  expect('S12C: missing rating stored as non-falsy neutral "—"',
    ride?.driver?.rating === '—', String(ride?.driver?.rating));
  expect('S12C: missing rating is NOT empty string (would trigger demo fallback)',
    ride?.driver?.rating !== '');
  expect('S12C: missing rating is NOT the demo "4,92"',
    ride?.driver?.rating !== '4,92', String(ride?.driver?.rating));
  // Belt-and-braces against any surface that does `rating || fallback`:
  // truthy neutral defeats the chain.
  expect('S12C: rating neutral is truthy (defeats `|| "4,92"` chains)',
    Boolean(ride?.driver?.rating));
  // Color was specified on this profile → passes through unchanged.
  expect('S12C: provided vehicle color passes through unchanged',
    ride?.vehicle?.color === 'белый', String(ride?.vehicle?.color));
}

// Case B — vehicleColor missing on profile (line-ready requires only
// make/model/plate, color is optional).
reset(); clearRideOrdersStore();
user.set({
  role: 'driver', onboarded: true, displayName: 'Иван Драйвер',
  phone: '+77001234567', phoneVerified: true,
  vehicleMake: 'Toyota', vehicleModel: 'Camry',
  vehiclePlate: 'А 123 БВ 77',
  // intentionally no `vehicleColor`
  rating: 4.95,
});
const acceptedNoColor = acceptCanonicalRideOrder((await freshOrder()).id, { acceptedSource: 'driver_map' });
{
  const ride = acceptedNoColor?.ride;
  expect('S12C: missing color stored as non-falsy neutral "цвет не указан"',
    ride?.vehicle?.color === 'цвет не указан', String(ride?.vehicle?.color));
  expect('S12C: missing color is NOT empty string (would trigger "серый" fallback)',
    ride?.vehicle?.color !== '');
  expect('S12C: missing color is NOT the demo "серый"',
    ride?.vehicle?.color !== 'серый', String(ride?.vehicle?.color));
  expect('S12C: color neutral is truthy (defeats `|| "серый"` chains)',
    Boolean(ride?.vehicle?.color));
  // Numeric rating still formats in ru-RU locale.
  expect('S12C: numeric rating still formats in ru-RU ("4,95")',
    ride?.driver?.rating === '4,95', String(ride?.driver?.rating));
}

// Case C — both missing simultaneously, both fall back correctly.
reset(); clearRideOrdersStore();
user.set({
  role: 'driver', onboarded: true, displayName: 'Иван Драйвер',
  phone: '+77001234567', phoneVerified: true,
  vehicleMake: 'Toyota', vehicleModel: 'Camry', vehiclePlate: 'А 123 БВ 77',
  // no rating, no vehicleColor
});
const acceptedBothMissing = acceptCanonicalRideOrder((await freshOrder()).id, { acceptedSource: 'driver_map' });
{
  const ride = acceptedBothMissing?.ride;
  expect('S12C: both-missing case — rating === "—"',
    ride?.driver?.rating === '—', String(ride?.driver?.rating));
  expect('S12C: both-missing case — color === "цвет не указан"',
    ride?.vehicle?.color === 'цвет не указан', String(ride?.vehicle?.color));
  // Driver name + vehicle model + plate are still populated normally.
  expect('S12C: both-missing case — driver.name still populated',
    ride?.driver?.name === 'Иван Драйвер', String(ride?.driver?.name));
  expect('S12C: both-missing case — vehicle.model still populated',
    ride?.vehicle?.model === 'Toyota Camry', String(ride?.vehicle?.model));
  expect('S12C: both-missing case — vehicle.plate still masked',
    ride?.vehicle?.plate === 'А ••• БВ 77', String(ride?.vehicle?.plate));
}

// ── Scenario 14 — Render layer no longer falls back to demo strings (BD-LIFE-07)
// BD-LIFE-06 stopped writing demo values onto the ride data (shiftDuration
// removed from the snapshot; missing rating → '—'; missing color → 'цвет
// не указан'). But the render layer in active_ride.js and
// active_ride_passenger.js still had `value || '5ч 12м'` / `|| '4,92'` /
// `|| 'серый'` fallbacks that would resurrect the demo strings whenever
// the data was undefined or empty. BD-LIFE-07 drops those render fallbacks
// so the demo seed stays confined to legacy demo-only ride paths.
//
// Two layers of assertion:
//   • Static source guard — the literal `… || 'demo'` patterns are gone
//     from the in-scope renderers. Catches regressions if anyone re-adds
//     them, without needing to mount the full Mapbox-aware render stack
//     here.
//   • Data-flow guard — re-verifies the BD-LIFE-06 contract that real
//     accepted rides carry truthy neutrals so the now-absent demo
//     fallbacks would never have fired for real rides anyway. Belt and
//     braces against a future regression that re-introduces empty-string
//     neutrals on the data side.
{
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const activeRideSrc = readFileSync(join(projectRoot, 'public/src/screens/active_ride.js'), 'utf8');
  const passengerSrc  = readFileSync(join(projectRoot, 'public/src/screens/active_ride_passenger.js'), 'utf8');

  // Static source guards: each demo-string fallback pattern must be gone.
  expect('S14: active_ride.js no longer chains `shiftDuration || "5ч 12м"`',
    !/shiftDuration\s*\|\|\s*['"`]5ч 12м['"`]/.test(activeRideSrc));
  expect('S14: active_ride_passenger.js no longer chains `rating || "4,92"`',
    !/rating\s*\|\|\s*['"`]4,92['"`]/.test(passengerSrc));
  expect('S14: active_ride_passenger.js no longer chains `color || "серый"`',
    !/\.color\s*\|\|\s*['"`]серый['"`]/.test(passengerSrc));

  // Belt-and-braces data-flow guard: re-create a real accepted ride and
  // confirm the data that the render layer would read carries truthy
  // BD-LIFE-06 neutrals — so even an accidentally-restored demo fallback
  // could not fire on a real accepted ride.
  reset(); clearRideOrdersStore();
  user.set({
    role: 'driver', onboarded: true, displayName: 'Иван Драйвер',
    phone: '+77001234567', phoneVerified: true,
    vehicleMake: 'Toyota', vehicleModel: 'Camry', vehiclePlate: 'А 100 АА 77',
    // intentionally no `rating`, no `vehicleColor`
  });
  const s14Order = await createRideOrder({
    type: 'ride_order', pickup:{id:'p1',label:'A'}, dropoff:{id:'p2',label:'Б'},
    passenger: { name: 'Алия К.', authorId: LOCAL_USER_ID, isCurrentUser: true },
  });
  const s14Accepted = acceptCanonicalRideOrder(s14Order.id, { acceptedSource: 'driver_map' });
  const s14Ride = s14Accepted?.ride;
  // The render layer for the driver status pill reads ride.driver?.shiftDuration.
  // BD-LIFE-06 omits the field entirely; the conditional sep+time block
  // in active_ride.js renders nothing for it. The negative assertion
  // confirms the demo string cannot reach the render path via data.
  expect('S14: real accepted ride.driver.shiftDuration is undefined',
    s14Ride?.driver?.shiftDuration === undefined,
    String(s14Ride?.driver?.shiftDuration));
  expect('S14: ride.driver.shiftDuration is NOT the demo "5ч 12м"',
    s14Ride?.driver?.shiftDuration !== '5ч 12м');
  // The render layer for the passenger top card reads ride.driver.rating.
  // BD-LIFE-06 stores '—' (truthy) so the dropped `|| '4,92'` chain has
  // nothing to substitute for.
  expect('S14: real accepted ride.driver.rating === "—" (neutral, not "4,92")',
    s14Ride?.driver?.rating === '—', String(s14Ride?.driver?.rating));
  expect('S14: ride.driver.rating is NOT the demo "4,92"',
    s14Ride?.driver?.rating !== '4,92');
  // The render layer for the carLine reads ride.vehicle.color. BD-LIFE-06
  // stores 'цвет не указан' (truthy) so the dropped `|| 'серый'` chain
  // has nothing to substitute for.
  expect('S14: real accepted ride.vehicle.color === "цвет не указан" (neutral, not "серый")',
    s14Ride?.vehicle?.color === 'цвет не указан', String(s14Ride?.vehicle?.color));
  expect('S14: ride.vehicle.color is NOT the demo "серый"',
    s14Ride?.vehicle?.color !== 'серый');
}

// ── Scenario 15 — History / receipt downstream demo fallback audit (BD-LIFE-08)
// BD-LIFE-06 cleaned the snapshot at accept time; BD-LIFE-07 dropped the
// demo render fallbacks from active_ride / active_ride_passenger. BD-LIFE-08
// extends the same guarantee downstream onto the completed-ride surfaces a
// passenger reaches after the trip is over:
//
//   active ride → completed → ride history → trip receipt → repeat / favorite
//
// Audit outcome (codified below):
//   • ride_history.js — pure data layer, zero demo string literals.
//   • trip_receipt.js — pure financial document (fare/commission/tip/net);
//     never reads driver.name, .initials, .rating, vehicle.color/plate/model.
//   • profile.js history renderers — fall back to neutral 'Водитель' /
//     'Пассажир' and `filter(Boolean)` car-line; no demo identity injection.
//   • repeat_route.js / favorite_routes.js / inbox.js — route-only / no
//     identity strings.
//
// Two-layer guard:
//   (a) Static source guards — catch the regression if anyone re-adds a
//       `|| 'Рустам К.'` / `|| '4,92'` / `|| 'серый'` / `|| 'Toyota Camry'` /
//       `|| 'А 124 ВВ 77'` fallback to the downstream renderers.
//   (b) Data-flow guards — drive a real BD-LIFE-06 accepted ride through
//       buildPassengerHistoryEntry and assert the persisted entry carries
//       the BD-LIFE-06/07 neutrals end-to-end, not the demo seed values.
{
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const profileSrc      = readFileSync(join(projectRoot, 'public/src/screens/profile.js'),     'utf8');
  const tripReceiptSrc  = readFileSync(join(projectRoot, 'public/src/screens/trip_receipt.js'), 'utf8');
  const rideHistorySrc  = readFileSync(join(projectRoot, 'public/src/ride_history.js'),         'utf8');
  const repeatRouteSrc  = readFileSync(join(projectRoot, 'public/src/repeat_route.js'),         'utf8');
  const favoriteRoutesSrc = readFileSync(join(projectRoot, 'public/src/favorite_routes.js'),    'utf8');
  const inboxSrc        = readFileSync(join(projectRoot, 'public/src/screens/inbox.js'),        'utf8');

  // ── (a) Static source guards on profile.js history renderers ──────────────
  // profile.js as a whole legitimately carries demo identity strings inside
  // MOCK_ACTIVE_TRIP (explicit demo-only fixture for the active-trip preview
  // card), so a file-wide grep would false-positive. Instead, extract the
  // slice that owns the completed-ride history renderers and assert demo
  // identity literals are absent THERE in any quoted form.
  //
  // Slice boundaries are the function-declaration markers for the renderer
  // family — historyVehicleText (start) through historyDetailHtml's close
  // (end) — so any quoted demo literal landing in `||`, `??`, ternary, or
  // direct return position inside any of these functions fails the guard.
  const historyRendererStart = profileSrc.indexOf('function historyVehicleText(');
  const historyRendererEnd   = profileSrc.indexOf('function closeHistoryDetail(');
  const historyRendererSlice = (historyRendererStart >= 0 && historyRendererEnd > historyRendererStart)
    ? profileSrc.slice(historyRendererStart, historyRendererEnd)
    : '';
  expect('S15: profile.js history renderer slice extracted (historyVehicleText → closeHistoryDetail)',
    historyRendererSlice.length > 0, String(historyRendererSlice.length));
  // Catch ALL forms of demo-string injection (||, ??, ternary, direct
  // string return) by checking the quoted literals themselves anywhere
  // inside the renderer slice.
  const DEMO_QUOTED_LITERALS = [
    { name: '"Рустам К."',     regex: /['"`]Рустам\s*К\.['"`]/    },
    { name: '"РК"',            regex: /['"`]РК['"`]/              },
    { name: '"4,92"',          regex: /['"`]4,92['"`]/            },
    { name: '"5ч 12м"',        regex: /['"`]5ч 12м['"`]/          },
    { name: '"серый"',         regex: /['"`]серый['"`]/           },
    { name: '"Toyota Camry"',  regex: /['"`]Toyota Camry['"`]/    },
    { name: '"А 124 ВВ 77"',   regex: /['"`]А 124 ВВ 77['"`]/     },
  ];
  for (const { name, regex } of DEMO_QUOTED_LITERALS) {
    expect(`S15: profile.js history renderer slice has no demo literal ${name}`,
      !regex.test(historyRendererSlice));
  }
  // Keep the positive contracts that the slice DOES use the right neutral
  // fallback ('Водитель') and the filter(Boolean) car-line.
  expect('S15: profile.js passenger history row uses neutral `|| "Водитель"`',
    /entry\?\.driver\?\.name\s*\|\|\s*['"`]Водитель['"`]/.test(historyRendererSlice));
  expect('S15: profile.js historyVehicleText uses filter(Boolean) (drops empties)',
    /function\s+historyVehicleText[\s\S]{0,200}\.filter\(Boolean\)/.test(historyRendererSlice));

  // ── (a2) Codex P2 #1 — Demo-fixture identifier guard on the renderer slice
  // Beyond rejecting quoted demo literals, the slice must not wire itself to
  // any explicit demo fixture (MOCK_ACTIVE_TRIP and friends) or any
  // identifier whose name advertises it as mock/demo data. If a refactor
  // ever points the production history renderer at a demo fixture for
  // "convenience", this fails before a real user sees demo identity on a
  // completed-ride card.
  expect('S15: profile.js history renderer slice does NOT reference MOCK_ACTIVE_TRIP',
    !/\bMOCK_ACTIVE_TRIP\b/.test(historyRendererSlice));
  expect('S15: profile.js history renderer slice does NOT reference any MOCK_* identifier',
    !/\bMOCK_[A-Z_][A-Z0-9_]*/.test(historyRendererSlice));
  expect('S15: profile.js history renderer slice does NOT reference any DEMO_* identifier',
    !/\bDEMO_[A-Z_][A-Z0-9_]*/.test(historyRendererSlice));

  // ── (a3) Shared demo-identity field-chain regex used by the inbox / route
  // surface guards below. Matches any `(driver|vehicle)(?.)?.{field}` chain —
  // covers direct (`driver.name`), optional (`driver?.name`), nested
  // (`entry?.driver?.name`, `ride?.vehicle?.plate`) and plateMasked
  // synonyms. Fields: name, initials, rating, shiftDuration, model, color,
  // plate, plateMasked.
  const IDENTITY_FIELDS = '(?:name|initials|rating|shiftDuration|model|color|plate|plateMasked)';
  const IDENTITY_CHAIN_RE = new RegExp(`\\b(?:driver|vehicle)\\??\\.${IDENTITY_FIELDS}\\b`);

  // ── (a) Static guards on the supporting data + receipt modules ────────────
  // Codex P2 #2 — ride_history.js is pure data; apply the FULL
  // DEMO_QUOTED_LITERALS loop (including 'Toyota Camry' and 'А 124 ВВ 77')
  // so the contract is "data layer carries zero demo identity strings of
  // any kind", not the previous selective subset.
  for (const { name, regex } of DEMO_QUOTED_LITERALS) {
    expect(`S15: ride_history.js carries no demo literal ${name}`,
      !regex.test(rideHistorySrc));
  }
  // Codex P2 #4 — trip_receipt.js is financial-only; reject every shape an
  // identity read could take, not just the direct `receipt.driver` /
  // `receipt.vehicle` access:
  //   • direct + optional-chain receipt.driver / receipt?.driver (kept)
  //   • destructuring  const { driver, vehicle } = receipt
  //   • flattened identity columns that some future schema might add to
  //     the receipt object: receipt.driverName, receipt.vehiclePlate, etc.
  expect('S15: trip_receipt.js does not read receipt.driver / receipt?.driver',
    !/receipt\??\.driver\b/.test(tripReceiptSrc));
  expect('S15: trip_receipt.js does not read receipt.vehicle / receipt?.vehicle',
    !/receipt\??\.vehicle\b/.test(tripReceiptSrc));
  expect('S15: trip_receipt.js does not destructure {driver|vehicle} from receipt',
    !/const\s*\{[^}]*\b(?:driver|vehicle)\b[^}]*\}\s*=\s*receipt/.test(tripReceiptSrc));
  expect('S15: trip_receipt.js does not read flattened identity fields on receipt',
    !/receipt\??\.(?:driverName|driverInitials|driverRating|driverShiftDuration|vehicleModel|vehicleColor|vehiclePlate|vehiclePlateMasked|plateMasked)\b/.test(tripReceiptSrc));

  // Repeat/favorite route surfaces are route-only — confirm they didn't
  // gain a driver/vehicle identity read path of any shape (covers
  // optional chains and nested chains).
  expect('S15: repeat_route.js stays clean of driver/vehicle identity reads (incl. ?. chains)',
    !IDENTITY_CHAIN_RE.test(repeatRouteSrc));
  expect('S15: favorite_routes.js stays clean of driver/vehicle identity reads (incl. ?. chains)',
    !IDENTITY_CHAIN_RE.test(favoriteRoutesSrc));
  // Codex P2 #3 — inbox.js identity-read guard now catches every chain
  // shape (driver?.name, vehicle?.color, entry?.driver?.name,
  // ride?.vehicle?.plate, plateMasked, …) across the full field set.
  for (const { name, regex } of DEMO_QUOTED_LITERALS) {
    expect(`S15: inbox.js carries no demo identity literal ${name}`,
      !regex.test(inboxSrc));
  }
  expect('S15: inbox.js does not read any driver/vehicle identity field (incl. ?. chains)',
    !IDENTITY_CHAIN_RE.test(inboxSrc));

  // ── (b) Data-flow guard: real ride → history entry carries the BD-LIFE-06/07
  // neutrals end-to-end. If anyone breaks the seed contract upstream the
  // entry would start surfacing demo values to the renderer; this catches it.
  //
  // The seed uses a DELIBERATELY non-demo vehicle ("Honda Shuttle"): the
  // demo seed in ride_state.js / active-ride hardcoded fallbacks were the
  // "Toyota Camry" / "А 124 ВВ 77" pair, so choosing a different real model
  // proves a genuine profile value survives end-to-end (rather than tests
  // becoming circular by re-asserting the demo string as the expected real
  // value).
  reset(); clearRideOrdersStore();
  user.set({
    role: 'driver', onboarded: true, displayName: 'Иван Драйвер',
    phone: '+77001234567', phoneVerified: true,
    vehicleMake: 'Honda', vehicleModel: 'Shuttle', vehiclePlate: 'А 123 БВ 77',
    // intentionally no rating / no vehicleColor — exercise the BD-LIFE-06
    // neutrals (rating '—', color 'цвет не указан')
  });
  const s15Order = await createRideOrder({
    type: 'ride_order', pickup:{id:'p1',label:'Пушкина 5'}, dropoff:{id:'p2',label:'Аэропорт'},
    estimatedPrice: 1700, distanceKm: 12, durationMin: 22,
    passenger: { name: 'Алия К.', authorId: LOCAL_USER_ID, isCurrentUser: true },
  });
  const s15Accepted = acceptCanonicalRideOrder(s15Order.id, { acceptedSource: 'driver_map' });
  const s15Ride = s15Accepted?.ride;
  // Simulate completion: BD-LIFE-08 only covers the history/receipt content,
  // not the lifecycle-status transition, so just decorate the ride with the
  // fields buildPassengerHistoryEntry needs and feed it through directly.
  const s15CompletedRide = {
    ...s15Ride,
    timestamps: { ...(s15Ride?.timestamps || {}), completedAt: '2026-06-08T11:00:00Z' },
    fare: 1700, distance: 12, duration: 22,
  };
  const s15Entry = buildPassengerHistoryEntry(s15CompletedRide, { rating: 5, tags: [], comment: '' });
  expect('S15 history-entry: entry.driver.name reflects real driver from BD-LIFE-06 seed',
    s15Entry?.driver?.name === 'Иван Драйвер', String(s15Entry?.driver?.name));
  expect('S15 history-entry: entry.driver.name does NOT contain "Рустам"',
    !String(s15Entry?.driver?.name || '').includes('Рустам'));
  expect('S15 history-entry: entry.driver.initials reflects real initial "И"',
    s15Entry?.driver?.initials === 'И', String(s15Entry?.driver?.initials));
  expect('S15 history-entry: entry.driver.initials !== demo "РК"',
    s15Entry?.driver?.initials !== 'РК', String(s15Entry?.driver?.initials));
  expect('S15 history-entry: entry.driver.rating carries BD-LIFE-06 neutral "—"',
    s15Entry?.driver?.rating === '—', String(s15Entry?.driver?.rating));
  expect('S15 history-entry: entry.driver.rating !== demo "4,92"',
    s15Entry?.driver?.rating !== '4,92', String(s15Entry?.driver?.rating));
  expect('S15 history-entry: entry.vehicle.model reflects real profile vehicle "Honda Shuttle"',
    s15Entry?.vehicle?.model === 'Honda Shuttle', String(s15Entry?.vehicle?.model));
  expect('S15 history-entry: entry.vehicle.model !== demo "Toyota Camry"',
    s15Entry?.vehicle?.model !== 'Toyota Camry', String(s15Entry?.vehicle?.model));
  expect('S15 history-entry: entry.vehicle.color carries BD-LIFE-06 neutral "цвет не указан"',
    s15Entry?.vehicle?.color === 'цвет не указан', String(s15Entry?.vehicle?.color));
  expect('S15 history-entry: entry.vehicle.color !== demo "серый"',
    s15Entry?.vehicle?.color !== 'серый', String(s15Entry?.vehicle?.color));
  expect('S15 history-entry: entry.vehicle.plate carries BD-LIFE-06 masked plate',
    s15Entry?.vehicle?.plate === 'А ••• БВ 77', String(s15Entry?.vehicle?.plate));
  expect('S15 history-entry: entry.vehicle.plate !== demo "А 124 ВВ 77"',
    s15Entry?.vehicle?.plate !== 'А 124 ВВ 77', String(s15Entry?.vehicle?.plate));

  // ── Rendered car-line: emulate historyVehicleText against the entry's
  // vehicle block and assert the produced string for the real completed ride
  // contains the BD-LIFE-06 neutrals — not the demo strings the active-ride
  // renderer also stopped falling back to in BD-LIFE-07. With the non-demo
  // seed above, the rendered line also explicitly proves the demo
  // "Toyota Camry" never substitutes for the real "Honda Shuttle".
  const renderedVehicleLine = [
    s15Entry?.vehicle?.model,
    s15Entry?.vehicle?.color,
    s15Entry?.vehicle?.plate,
  ].filter(Boolean).map((v) => String(v).trim()).filter(Boolean).join(' · ');
  expect('S15 rendered: history car-line shows non-demo model · neutral color · masked plate',
    renderedVehicleLine === 'Honda Shuttle · цвет не указан · А ••• БВ 77',
    renderedVehicleLine);
  expect('S15 rendered: history car-line does NOT contain demo "Toyota Camry"',
    !renderedVehicleLine.includes('Toyota Camry'), renderedVehicleLine);
  expect('S15 rendered: history car-line does NOT contain demo "серый"',
    !renderedVehicleLine.includes('серый'), renderedVehicleLine);
  expect('S15 rendered: history car-line does NOT contain demo plate "А 124 ВВ 77"',
    !renderedVehicleLine.includes('А 124 ВВ 77'), renderedVehicleLine);

  // ── BD-LIFE-05 safety still applies to the completed-ride history row:
  // an unrelated passenger_response in the store must NOT rewrite the
  // entry's pinned driver identity. To actually catch a regression here we
  // must drive the same orchestrator path that runtime uses on /responses
  // and /active-ride direct entry (upgradeStoredActiveRideForOrder) BEFORE
  // building the history entry. The current orchestrator (post BD-LIFE-05
  // Codex P1) refuses to rewrite an unpinned ride; if a future regression
  // restores latest-response fallback, the upgrade would persist "Анна
  // Чужая" onto the ride, findActiveRide() would return it, and the
  // history-entry assertion would fail — exactly the catch we want.
  writeResponseToStore(buildResponseFor(s15Order, { name: 'Анна Чужая', rating: 4.5 }));
  const s15PostUpgrade = upgradeStoredActiveRideForOrder(s15Order.id);
  expect('S15: orchestrator path exercised — DriverMap-accepted ride still has the real driver',
    s15PostUpgrade?.driver?.name === 'Иван Драйвер',
    String(s15PostUpgrade?.driver?.name));
  expect('S15: orchestrator did NOT rewrite to the unrelated responder',
    s15PostUpgrade?.driver?.name !== 'Анна Чужая');
  const s15PostResponseRide = findActiveRide(`trip_${s15Order.id}`);
  const s15PostResponseEntry = buildPassengerHistoryEntry(
    { ...s15PostResponseRide, timestamps: { completedAt: '2026-06-08T11:00:00Z' }, fare: 1700, distance: 12, duration: 22 },
    { rating: 5, tags: [], comment: '' },
  );
  expect('S15: BD-LIFE-05 still holds end-to-end — history entry driver remains real',
    s15PostResponseEntry?.driver?.name === 'Иван Драйвер',
    String(s15PostResponseEntry?.driver?.name));
  expect('S15: history entry driver did NOT become the unrelated responder "Анна Чужая"',
    s15PostResponseEntry?.driver?.name !== 'Анна Чужая');
}

// ── Result ───────────────────────────────────────────────────────────────────
if (issues.length) {
  console.error('\nSMOKE FAILED:');
  for (const i of issues) console.error('  - ' + i);
  process.exit(1);
}
console.log('\nAll ride-order-02 lifecycle smoke checks passed.');
