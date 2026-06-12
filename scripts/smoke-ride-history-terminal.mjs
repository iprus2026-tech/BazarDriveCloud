// BD-RIDE-HISTORY-TERM-01 — terminal ride history / receipt propagation
// smoke.
//
// BD-ACTIVE-RIDE-TERM-01 locked the post-handoff terminal contract on the
// active-ride store. This smoke locks the downstream surfaces:
//
//   • ride_history.js — completed-only history; builders never leak demo
//     identities; passenger and driver entries persist independently via
//     the `${role}:${tripId}` internal key.
//   • mock_api.js — receipt sanitizer rejects malformed input; getReceipt
//     resolves the canonical demo fixture; demo seed (48-321) is the
//     intentional render-gate fallback.
//   • trip_receipt.js — strictly read-only; only `getReceipt` imported;
//     no fetch / Mapbox / ride_state / active_ride imports; missing
//     receipt renders the «Чек не найден» fallback without any
//     «Завершено и рассчитано» / «Ваш доход за поездку» settled copy.
//   • active_ride.js / active_ride_passenger.js — the only callers of
//     saveDriverReceipt / saveRideHistoryEntry are the COMPLETED-gated
//     `renderCompleted` and `persistHistory` paths. Cancel / no-show
//     paths never write receipts or history.
//
// Pins ride_history.js / mock_api.js / trip_receipt.js source isolation
// + behavioral round-trip + caller-site gates, so a future refactor of
// the cancel paths can't accidentally land a settled receipt for a
// canceled / no-show ride or leak demo identity strings into a real
// completed entry.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// In-memory localStorage shim so the modules under test can round-trip
// the history + receipt stores without a browser.
const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => _store.has(k) ? _store.get(k) : null,
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { _store.delete(k); },
  clear: () => { _store.clear(); },
};

const RIDE_HISTORY_KEY      = 'bazardrive.ride_history.v1';
const DRIVER_RECEIPTS_KEY   = 'bazardrive.driver_receipts.v1';

const rideHistory  = await import(new URL('../public/src/ride_history.js', import.meta.url).href);
const mockApi      = await import(new URL('../public/src/mock_api.js', import.meta.url).href);

// Source files for the static / render-branch pins.
const historySrc       = read('../public/src/ride_history.js');
const receiptScreenSrc = read('../public/src/screens/trip_receipt.js');
const mockApiSrc       = read('../public/src/mock_api.js');
const driverActiveSrc  = read('../public/src/screens/active_ride.js');
const passengerActiveSrc = read('../public/src/screens/active_ride_passenger.js');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// Build a synthetic "completed ride" object whose driver / passenger /
// vehicle / route fields are unique strings so we can prove the
// history builders preserve them verbatim (not the demo seed).
function mkCompletedRide(overrides = {}) {
  return {
    tripId: 'trip-history-test',
    status: 'COMPLETED',
    passenger: {
      name:        'Уникальный Пассажир',
      initials:    'УП',
      rating:      '4,55',
      phoneMasked: '+7 ... 00-11',
      luggage:     'тестовый багаж',
    },
    driver: {
      name:     'Уникальный Водитель',
      initials: 'УВ',
      rating:   '4,66',
    },
    vehicle: {
      model: 'Уникальный · модель',
      color: 'белый',
      plate: 'А777АА777',
    },
    order: {
      offerPrice:           '999 ₽',
      destinationDistance: '12,3 км',
      destinationEta:      '25 мин',
    },
    ride: {
      price:    '999 ₽',
      duration: '24 мин',
      distance: '12,3 км',
    },
    route: {
      pickupLabel:  'Уникальный pickup',
      dropoffLabel: 'Уникальный dropoff',
    },
    payment: {
      amount: '999 ₽',
    },
    timestamps: {
      createdAt:   '2026-06-01T10:00:00.000Z',
      completedAt: '2026-06-01T10:30:00.000Z',
    },
    ...overrides,
  };
}

// ── A. ride_history.js module surface ───────────────────────────────
expect('A — ride_history.js exports buildPassengerHistoryEntry',
  typeof rideHistory.buildPassengerHistoryEntry === 'function');
expect('A — ride_history.js exports buildDriverHistoryEntry',
  typeof rideHistory.buildDriverHistoryEntry === 'function');
expect('A — ride_history.js exports saveRideHistoryEntry',
  typeof rideHistory.saveRideHistoryEntry === 'function');
expect('A — ride_history.js exports readRideHistoryStatus',
  typeof rideHistory.readRideHistoryStatus === 'function');
expect('A — ride_history.js exports clearRideHistory',
  typeof rideHistory.clearRideHistory === 'function');

// ── A1. buildPassengerHistoryEntry preserves the real driver/vehicle/route ─
{
  _store.clear();
  const ride = mkCompletedRide();
  const entry = rideHistory.buildPassengerHistoryEntry(ride, {
    rating: 5,
    tags: ['safe', 'clean'],
    comment: 'Отличная поездка',
  });
  expect('A1 — entry is created with role=passenger',
    entry?.role === 'passenger');
  expect('A1 — entry.tripId preserved',
    entry?.tripId === 'trip-history-test');
  expect('A1 — entry.completedAt preserved from timestamps',
    entry?.completedAt === '2026-06-01T10:30:00.000Z');
  expect('A1 — entry.driver.name preserved verbatim (no demo «Рустам К.» leak)',
    entry?.driver?.name === 'Уникальный Водитель');
  expect('A1 — entry.driver.initials preserved',
    entry?.driver?.initials === 'УВ');
  expect('A1 — entry.driver.rating preserved',
    entry?.driver?.rating === '4,66');
  expect('A1 — entry.vehicle.model preserved verbatim',
    entry?.vehicle?.model === 'Уникальный · модель');
  expect('A1 — entry.vehicle.color preserved',
    entry?.vehicle?.color === 'белый');
  expect('A1 — entry.vehicle.plate preserved',
    entry?.vehicle?.plate === 'А777АА777');
  expect('A1 — entry.route.pickupLabel preserved verbatim',
    entry?.route?.pickupLabel === 'Уникальный pickup');
  expect('A1 — entry.route.dropoffLabel preserved verbatim',
    entry?.route?.dropoffLabel === 'Уникальный dropoff');
  expect('A1 — entry.fare preserved from payment.amount',
    entry?.fare === '999 ₽');
  expect('A1 — entry.distance preserved from ride.distance',
    entry?.distance === '12,3 км');
  expect('A1 — entry.duration preserved from ride.duration',
    entry?.duration === '24 мин');
  expect('A1 — rating payload preserved (rating + tags + comment)',
    entry?.rating === 5
    && Array.isArray(entry?.tags) && entry.tags.length === 2
    && entry?.comment === 'Отличная поездка');
}

// ── A2. buildPassengerHistoryEntry NEVER leaks the demo passenger identity ─
// When ride.driver.name / vehicle.model are missing, the builder must
// fall back to `null`, NOT to the buildDemoRide seed «Рустам К.» /
// «Toyota Camry» strings. The render-time fallback is a separate
// concern in profile.js.
{
  const sparseRide = {
    tripId: 'trip-history-sparse-A2',
    status: 'COMPLETED',
    timestamps: { completedAt: '2026-06-01T10:30:00.000Z' },
  };
  const entry = rideHistory.buildPassengerHistoryEntry(sparseRide);
  expect('A2 — sparse passenger entry: driver.name is null (no demo leak)',
    entry?.driver?.name === null);
  expect('A2 — sparse passenger entry: vehicle.model is null',
    entry?.vehicle?.model === null);
  expect('A2 — sparse passenger entry: route.pickupLabel is null',
    entry?.route?.pickupLabel === null);
  expect('A2 — sparse passenger entry: fare is null (no demo «1 480 ₽»)',
    entry?.fare === null);
  const historySrcNoComments = stripComments(historySrc);
  expect('A2 — buildPassengerHistoryEntry source uses `|| null` fallback for driver.name',
    /buildPassengerHistoryEntry[\s\S]{0,2000}driver\.name\s*\|\|\s*null/.test(historySrcNoComments));
  expect('A2 — buildPassengerHistoryEntry source uses `|| null` fallback for vehicle.model',
    /buildPassengerHistoryEntry[\s\S]{0,2000}vehicle\.model\s*\|\|\s*null/.test(historySrcNoComments));
  // Reject demo seed string leaks via source scan.
  expect('A2 — buildPassengerHistoryEntry does NOT carry demo «Рустам К.» fallback',
    !/buildPassengerHistoryEntry[\s\S]{0,2000}Рустам/.test(historySrc));
  expect('A2 — buildPassengerHistoryEntry does NOT carry demo «Анна М.» fallback',
    !/buildPassengerHistoryEntry[\s\S]{0,2000}Анна/.test(historySrc));
}

// ── A3. buildDriverHistoryEntry preserves real passenger + accepts receipt ─
{
  const ride = mkCompletedRide({ tripId: 'trip-driver-A3' });
  const fakeReceipt = {
    tripId: 'trip-driver-A3', fare: 999, commission: -120, tip: 50, net: 929,
    paymentMode: 'noncash', status: 'completed',
    completedAt: '2026-06-01T10:30:00.000Z',
  };
  const fakeEarnings = { gross: 999, commissionAmount: 120, net: 929 };
  const entry = rideHistory.buildDriverHistoryEntry(ride, {
    receipt: fakeReceipt,
    earnings: fakeEarnings,
  });
  expect('A3 — driver entry has role=driver',
    entry?.role === 'driver');
  expect('A3 — entry.passenger.name preserved verbatim (no demo «Анна М.» leak)',
    entry?.passenger?.name === 'Уникальный Пассажир');
  expect('A3 — entry.passenger.initials preserved',
    entry?.passenger?.initials === 'УП');
  expect('A3 — entry.passenger.rating preserved',
    entry?.passenger?.rating === '4,55');
  expect('A3 — entry.route.pickupLabel preserved',
    entry?.route?.pickupLabel === 'Уникальный pickup');
  expect('A3 — entry.fare preserved',
    entry?.fare === '999 ₽');
  expect('A3 — entry.receipt is the supplied receipt object (read-only copy)',
    entry?.receipt?.tripId === 'trip-driver-A3'
    && entry?.receipt?.net === 929
    && entry?.receipt?.paymentMode === 'noncash');
  expect('A3 — entry.earnings preserved verbatim',
    entry?.earnings?.gross === 999 && entry?.earnings?.net === 929);
}

// ── A4. buildDriverHistoryEntry sparse fallback returns null fields ─
{
  const sparseRide = {
    tripId: 'trip-driver-A4',
    status: 'COMPLETED',
    timestamps: { completedAt: '2026-06-01T10:30:00.000Z' },
  };
  const entry = rideHistory.buildDriverHistoryEntry(sparseRide);
  expect('A4 — sparse driver entry: passenger.name is null',
    entry?.passenger?.name === null);
  expect('A4 — sparse driver entry: receipt is null (no caller-supplied)',
    entry?.receipt === null);
  expect('A4 — sparse driver entry: earnings is null',
    entry?.earnings === null);
  expect('A4 — buildDriverHistoryEntry does NOT carry demo «Анна» fallback',
    !/buildDriverHistoryEntry[\s\S]{0,2000}Анна/.test(historySrc));
}

// ── A5. Builders reject malformed input ─────────────────────────────
expect('A5 — buildPassengerHistoryEntry returns null on missing tripId',
  rideHistory.buildPassengerHistoryEntry({ status: 'COMPLETED' }) === null
  && rideHistory.buildPassengerHistoryEntry({ tripId: '', status: 'COMPLETED' }) === null);
expect('A5 — buildPassengerHistoryEntry returns null on non-object',
  rideHistory.buildPassengerHistoryEntry(null) === null
  && rideHistory.buildPassengerHistoryEntry('not-a-ride') === null
  && rideHistory.buildPassengerHistoryEntry(42) === null);
expect('A5 — buildDriverHistoryEntry returns null on missing tripId',
  rideHistory.buildDriverHistoryEntry({ status: 'COMPLETED' }) === null);
expect('A5 — buildDriverHistoryEntry returns null on non-object',
  rideHistory.buildDriverHistoryEntry(null) === null);

// ── B. Receipt API (mock_api) round-trip + sanitizer rejections ─────
expect('B — mock_api exports saveDriverReceipt + getReceipt + listDriverReceipts',
  typeof mockApi.saveDriverReceipt === 'function'
  && typeof mockApi.getReceipt === 'function'
  && typeof mockApi.listDriverReceipts === 'function');
expect('B — mock_api exports sanitizeDriverReceipt + DEMO_DRIVER_RECEIPT + clearDriverReceiptsStore',
  typeof mockApi.sanitizeDriverReceipt === 'function'
  && typeof mockApi.clearDriverReceiptsStore === 'function'
  && mockApi.DEMO_DRIVER_RECEIPT
  && mockApi.DEMO_DRIVER_RECEIPT.tripId === '48-321');

// ── B1. Round-trip: save + get returns canonical sanitized shape ────
{
  mockApi.clearDriverReceiptsStore();
  const saved = mockApi.saveDriverReceipt({
    tripId:      'trip-B1',
    completedAt: '2026-06-01T10:30:00.000Z',
    fare:        1000,
    commission:  -120,
    tip:         50,
    net:         930,
    paymentMode: 'noncash',
  });
  expect('B1 — saveDriverReceipt returns the canonical sanitized receipt',
    saved?.tripId === 'trip-B1'
    && saved?.fare === 1000
    && saved?.commission === -120
    && saved?.tip === 50
    && saved?.net === 930
    && saved?.paymentMode === 'noncash'
    && saved?.status === 'completed');
  const fetched = mockApi.getReceipt('trip-B1');
  expect('B1 — getReceipt round-trip returns the saved receipt',
    fetched?.tripId === 'trip-B1'
    && fetched?.fare === 1000
    && fetched?.net === 930);
  // Storage key invariant.
  expect('B1 — receipt is persisted under bazardrive.driver_receipts.v1',
    _store.has(DRIVER_RECEIPTS_KEY));
}

// ── B2. sanitizeDriverReceipt rejects malformed input ───────────────
{
  expect('B2 — sanitize rejects null / non-object / arrays',
    mockApi.sanitizeDriverReceipt(null) === null
    && mockApi.sanitizeDriverReceipt('not-a-receipt') === null
    && mockApi.sanitizeDriverReceipt([1, 2, 3]) === null);
  expect('B2 — sanitize rejects missing tripId',
    mockApi.sanitizeDriverReceipt({ fare: 100, commission: -10, tip: 0, net: 90 }) === null);
  expect('B2 — sanitize rejects missing money fields',
    mockApi.sanitizeDriverReceipt({ tripId: 'x', fare: 100 }) === null
    && mockApi.sanitizeDriverReceipt({ tripId: 'x', fare: 100, commission: -10 }) === null
    && mockApi.sanitizeDriverReceipt({ tripId: 'x', fare: 100, commission: -10, tip: 0 }) === null);
  expect('B2 — sanitize rejects non-finite money fields',
    mockApi.sanitizeDriverReceipt({
      tripId: 'x', fare: NaN, commission: -10, tip: 0, net: 90,
    }) === null
    && mockApi.sanitizeDriverReceipt({
      tripId: 'x', fare: 100, commission: 'bad', tip: 0, net: 90,
    }) === null);
  expect('B2 — sanitize always stamps status="completed"',
    mockApi.sanitizeDriverReceipt({
      tripId: 'x', fare: 100, commission: -10, tip: 0, net: 90,
    })?.status === 'completed');
  expect('B2 — sanitize defaults paymentMode to "noncash" for invalid value',
    mockApi.sanitizeDriverReceipt({
      tripId: 'x', fare: 100, commission: -10, tip: 0, net: 90,
      paymentMode: 'crypto',
    })?.paymentMode === 'noncash');
}

// ── B3. getReceipt — unknown tripId returns null; demo seed resolves ─
{
  mockApi.clearDriverReceiptsStore();
  expect('B3 — getReceipt(unknown) returns null',
    mockApi.getReceipt('totally-unknown-trip') === null);
  expect('B3 — getReceipt(empty / non-string) returns null',
    mockApi.getReceipt('') === null
    && mockApi.getReceipt(null) === null
    && mockApi.getReceipt(undefined) === null);
  // The canonical demo receipt (48-321) is the intentional render-gate
  // fallback so the manual URL always resolves a settled document.
  const demo = mockApi.getReceipt('48-321');
  expect('B3 — getReceipt("48-321") resolves the canonical demo receipt',
    demo?.tripId === '48-321'
    && demo?.net === 1475
    && demo?.paymentMode === 'cash'
    && demo?.status === 'completed');
}

// ── C. Terminal canceled / no-show guard ────────────────────────────
//
// The active-ride store and the receipt store are two independent
// surfaces. The expected invariant is:
//   • a CANCELED / NO_SHOW ride MUST NOT have a settled receipt for
//     its tripId in `bazardrive.driver_receipts.v1`;
//   • `getReceipt(canceledTripId)` returns null → the receipt screen
//     renders the «Чек не найден» fallback;
//   • no settled-copy strings («Завершено и рассчитано», «Ваш доход
//     за поездку», «Завершено») leak into the missing-receipt fallback.
//
// We exercise the boundary by writing a real receipt for a "completed"
// trip and verifying that other (canceled / no-show / unknown) tripIds
// resolve null — proving the store is keyed by tripId only and never
// fans out a settled record to a canceled sibling.

// ── C1. canceled tripId → no settled receipt ────────────────────────
{
  mockApi.clearDriverReceiptsStore();
  mockApi.saveDriverReceipt({
    tripId:      'trip-C1-completed',
    completedAt: '2026-06-01T10:30:00.000Z',
    fare:        500, commission: -60, tip: 0, net: 440,
    paymentMode: 'noncash',
  });
  expect('C1 — completed tripId has a settled receipt',
    mockApi.getReceipt('trip-C1-completed')?.status === 'completed');
  // A canceled tripId, even one that shares prefix with the completed
  // sibling, must NOT resolve to a settled receipt.
  expect('C1 — canceled tripId has no settled receipt',
    mockApi.getReceipt('trip-C1-canceled') === null);
  expect('C1 — no-show tripId has no settled receipt',
    mockApi.getReceipt('trip-C1-no-show') === null);
  // The completed receipt store does NOT carry an entry for the
  // canceled tripId.
  const all = mockApi.listDriverReceipts();
  expect('C1 — listDriverReceipts does NOT include the canceled tripId',
    !all.some((r) => r.tripId === 'trip-C1-canceled'));
}

// ── C2. ride_history.js store is empty when no COMPLETED happens ────
{
  _store.delete(RIDE_HISTORY_KEY);
  const statusAfterClear = rideHistory.readRideHistoryStatus();
  expect('C2 — readRideHistoryStatus() === "empty" with no key',
    statusAfterClear.status === 'empty'
    && Array.isArray(statusAfterClear.entries)
    && statusAfterClear.entries.length === 0);
}

// ── C3. Caller-site guards: cancel paths never write history/receipt ─
{
  const driverNoComments = stripComments(driverActiveSrc);
  const passengerNoComments = stripComments(passengerActiveSrc);

  // Extract renderCanceledStub body (driver side).
  const driverStubMatch = driverNoComments.match(/function\s+renderCanceledStub\s*\([\s\S]*?\n\s*\}/);
  const driverStubBody = driverStubMatch ? driverStubMatch[0] : '';
  expect('C3 — driver renderCanceledStub body resolved', driverStubBody.length > 0);
  expect('C3 — driver renderCanceledStub never calls saveDriverReceipt',
    !/saveDriverReceipt\s*\(/.test(driverStubBody));
  expect('C3 — driver renderCanceledStub never calls saveRideHistoryEntry',
    !/saveRideHistoryEntry\s*\(/.test(driverStubBody));
  expect('C3 — driver renderCanceledStub never calls buildDriverHistoryEntry',
    !/buildDriverHistoryEntry\s*\(/.test(driverStubBody));

  // Extract renderPassengerCanceledFallback body (passenger side).
  const passengerFallbackMatch = passengerNoComments.match(
    /function\s+renderPassengerCanceledFallback[\s\S]*?return\s+root;/);
  const passengerFallbackBody = passengerFallbackMatch ? passengerFallbackMatch[0] : '';
  expect('C3 — passenger renderPassengerCanceledFallback body resolved',
    passengerFallbackBody.length > 0);
  expect('C3 — passenger cancel fallback never calls saveRideHistoryEntry',
    !/saveRideHistoryEntry\s*\(/.test(passengerFallbackBody));
  expect('C3 — passenger cancel fallback never calls buildPassengerHistoryEntry',
    !/buildPassengerHistoryEntry\s*\(/.test(passengerFallbackBody));
  expect('C3 — passenger cancel fallback never calls saveDriverReceipt',
    !/saveDriverReceipt\s*\(/.test(passengerFallbackBody));

  // The passenger cancel handler's onConfirm closure (the sheet's
  // cancel path) must not write a history entry either.
  expect('C3 — passenger onConfirm cancel closure never calls saveRideHistoryEntry',
    !/openPassengerCancelSheet[\s\S]{0,3500}onConfirm[\s\S]{0,2500}saveRideHistoryEntry\s*\(/.test(passengerActiveSrc));
}

// ── C4. Caller-site COMPLETED gates: history writes only in COMPLETED ─
{
  // active_ride.js — saveDriverReceipt + saveRideHistoryEntry are
  // called inside `renderCompleted`, which is reached only when
  // `ride.status === RIDE_STATUS.COMPLETED` (renderSheet branch).
  expect('C4 — driver renderCompleted calls saveDriverReceipt',
    /renderCompleted[\s\S]{0,3000}saveDriverReceipt\s*\(/.test(driverActiveSrc));
  expect('C4 — driver renderCompleted calls saveRideHistoryEntry',
    /renderCompleted[\s\S]{0,3000}saveRideHistoryEntry\s*\(/.test(driverActiveSrc));
  expect('C4 — driver renderSheet routes to renderCompleted only on RIDE_STATUS.COMPLETED',
    /ride\.status\s*===\s*RIDE_STATUS\.COMPLETED[\s\S]{0,200}renderCompleted/.test(driverActiveSrc));
  // active_ride_passenger.js — `persistHistory` lives inside
  // `renderPassengerRideComplete` and `renderPassengerRideComplete` is
  // the only function called from the `ride.status === COMPLETED`
  // branch. The COMPLETED gate is therefore one level above
  // persistHistory, not inline with the call.
  expect('C4 — passenger renderPassengerRideComplete is entered only from ride.status === COMPLETED',
    /ride\.status\s*===\s*RIDE_STATUS\.COMPLETED[\s\S]{0,200}renderPassengerRideComplete\s*\(/.test(passengerActiveSrc));
  expect('C4 — passenger persistHistory lives inside renderPassengerRideComplete',
    /function\s+renderPassengerRideComplete[\s\S]*?function\s+persistHistory[\s\S]*?saveRideHistoryEntry\s*\(/.test(passengerActiveSrc));
}

// ── D. Storage isolation: passenger and driver entries persist independently ─
{
  rideHistory.clearRideHistory();
  const ride = mkCompletedRide({ tripId: 'shared-trip-D' });
  const pEntry = rideHistory.buildPassengerHistoryEntry(ride, {});
  const dEntry = rideHistory.buildDriverHistoryEntry(ride, {});
  rideHistory.saveRideHistoryEntry(pEntry);
  rideHistory.saveRideHistoryEntry(dEntry);
  const raw = JSON.parse(_store.get(RIDE_HISTORY_KEY) || '[]');
  expect('D — both passenger and driver entries persist for the same tripId',
    raw.length === 2
    && raw.some((e) => e.role === 'passenger' && e.tripId === 'shared-trip-D')
    && raw.some((e) => e.role === 'driver'    && e.tripId === 'shared-trip-D'));
  // Saving the driver entry must not overwrite the passenger entry.
  const pSaved = raw.find((e) => e.role === 'passenger');
  expect('D — passenger entry preserved after driver write',
    pSaved?.driver?.name === 'Уникальный Водитель');
  const dSaved = raw.find((e) => e.role === 'driver');
  expect('D — driver entry preserved after passenger write',
    dSaved?.passenger?.name === 'Уникальный Пассажир');
  // Source pin: the internal key is `${role}:${tripId}`.
  expect('D — saveRideHistoryEntry keys entries by `${role}:${tripId}`',
    /\$\{[a-zA-Z_$][\w$]*\.role\}:\$\{[a-zA-Z_$][\w$]*\.tripId\}/.test(historySrc));
}

// ── E. trip_receipt.js source isolation ─────────────────────────────
const receiptScreenNoComments = stripComments(receiptScreenSrc);
expect('E — trip_receipt.js imports getReceipt from mock_api',
  /import\s*\{[\s\S]*?getReceipt[\s\S]*?\}\s*from\s*['"]\.\.\/mock_api\.js['"]/.test(receiptScreenSrc));
expect('E — trip_receipt.js does NOT import ride_state.js',
  !/from\s*['"][^'"]*ride_state(\.js)?['"]/.test(receiptScreenSrc));
expect('E — trip_receipt.js does NOT import active_ride',
  !/from\s*['"][^'"]*active_ride[^'"]*['"]/.test(receiptScreenSrc));
expect('E — trip_receipt.js does NOT import ride_history',
  !/from\s*['"][^'"]*ride_history(\.js)?['"]/.test(receiptScreenSrc));
expect('E — trip_receipt.js never calls fetch(',
  !/\bfetch\s*\(/.test(receiptScreenNoComments));
expect('E — trip_receipt.js never references mapbox',
  !/mapbox/i.test(receiptScreenNoComments));
expect('E — trip_receipt.js never calls saveDriverReceipt',
  !/saveDriverReceipt\s*\(/.test(receiptScreenNoComments));
expect('E — trip_receipt.js never calls saveRideHistoryEntry',
  !/saveRideHistoryEntry\s*\(/.test(receiptScreenNoComments));
expect('E — trip_receipt.js never calls updateActiveRideStatus',
  !/updateActiveRideStatus\s*\(/.test(receiptScreenNoComments));
expect('E — trip_receipt.js never calls saveActiveRide',
  !/saveActiveRide\s*\(/.test(receiptScreenNoComments));
// The screen reads only — never persists. No writeStore / localStorage.setItem.
expect('E — trip_receipt.js never directly writes localStorage',
  !/localStorage\.setItem\s*\(/.test(receiptScreenNoComments));
// Receipt is rendered by formatting stored values — no money arithmetic
// (net is computed once in active_ride.js earnings flow).
expect('E — trip_receipt.js never recomputes net (no math across receipt.fare/commission/tip/net)',
  !/receipt\.fare[\s\S]{0,100}[\+\-][\s\S]{0,100}receipt\.commission/.test(receiptScreenNoComments));

// ── E1. Settled-receipt copy invariants ─────────────────────────────
expect('E1 — settled receipt carries «Завершено» badge',
  /Завершено</.test(receiptScreenSrc));
expect('E1 — settled receipt carries «Завершено и рассчитано» status',
  /Завершено и рассчитано/.test(receiptScreenSrc));
expect('E1 — settled receipt carries «Ваш доход за поездку» hero label',
  /Ваш доход за поездку/.test(receiptScreenSrc));
expect('E1 — payment labels are «Оплата наличными» / «Безналичный расчёт»',
  /Оплата наличными/.test(receiptScreenSrc)
  && /Безналичный расчёт/.test(receiptScreenSrc));

// ── E2. Missing-receipt fallback does NOT leak settled copy ─────────
{
  // Extract the receiptMissingHtml body so the copy assertions don't
  // accidentally match strings inside the settled receiptDocHtml.
  const missingMatch = receiptScreenNoComments.match(
    /function\s+receiptMissingHtml\s*\([\s\S]*?\n\s*\}/);
  const missingBody = missingMatch ? missingMatch[0] : '';
  expect('E2 — receiptMissingHtml body resolved', missingBody.length > 0);
  expect('E2 — missing-receipt fallback shows «Чек не найден»',
    /Чек не найден/.test(missingBody));
  expect('E2 — missing-receipt fallback does NOT show «Завершено и рассчитано»',
    !/Завершено и рассчитано/.test(missingBody));
  expect('E2 — missing-receipt fallback does NOT show «Ваш доход за поездку»',
    !/Ваш доход за поездку/.test(missingBody));
  expect('E2 — missing-receipt fallback does NOT show «Завершено» status badge',
    !/Завершено</.test(missingBody));
  expect('E2 — missing-receipt fallback does NOT show payment labels',
    !/Оплата наличными/.test(missingBody)
    && !/Безналичный расчёт/.test(missingBody));
}

// ── F. ride_history.js source isolation ─────────────────────────────
const historyNoComments = stripComments(historySrc);
expect('F — ride_history.js never calls fetch(',
  !/\bfetch\s*\(/.test(historyNoComments));
expect('F — ride_history.js never references mapbox',
  !/mapbox/i.test(historyNoComments));
expect('F — ride_history.js does NOT import mock_api (no receipt write)',
  !/from\s*['"][^'"]*mock_api['"]/.test(historyNoComments));
expect('F — ride_history.js does NOT import active_ride',
  !/from\s*['"][^'"]*active_ride[^'"]*['"]/.test(historyNoComments));
expect('F — ride_history.js does NOT import driver_offer_store',
  !/from\s*['"][^'"]*driver_offer_store/.test(historyNoComments));
expect('F — ride_history.js never calls saveDriverReceipt (history and receipt are independent surfaces)',
  !/saveDriverReceipt\s*\(/.test(historyNoComments));
expect('F — ride_history.js uses canonical storage key bazardrive.ride_history.v1',
  /['"`]bazardrive\.ride_history\.v1['"`]/.test(historySrc));

// ── G. mock_api receipt store stays scoped ──────────────────────────
const mockApiNoComments = stripComments(mockApiSrc);
expect('G — mock_api uses canonical receipt storage key bazardrive.driver_receipts.v1',
  /['"`]bazardrive\.driver_receipts\.v1['"`]/.test(mockApiSrc));
// Receipt write site stays in mock_api — sanitizer always stamps
// status='completed'. A future caller can't accidentally persist a
// CANCELED / NO_SHOW status string into the receipt record.
expect('G — sanitizeDriverReceipt always stamps status="completed"',
  /sanitizeDriverReceipt[\s\S]{0,2000}status:\s*['"]completed['"]/.test(mockApiNoComments));
expect('G — DEMO_DRIVER_RECEIPT carries status="completed"',
  mockApi.DEMO_DRIVER_RECEIPT.status === 'completed');

// ── H. End-to-end terminal-propagation invariants ───────────────────
//
// Realistic flow:
//   1. A passenger / driver active ride is canceled (cancelActiveRide
//      lands on the ride_state store). No history / receipt write
//      occurs from the cancel path (C3).
//   2. trip_receipt screen looks up the canceled tripId via getReceipt.
//   3. getReceipt returns null → render the «Чек не найден» fallback.
//
// We can't open the DOM, but we can pin the boundary: a canceled tripId
// has no receipt; the receipt screen would route to missing.
{
  mockApi.clearDriverReceiptsStore();
  rideHistory.clearRideHistory();
  // Pretend a driver-canceled trip ran end-to-end with no completion.
  expect('H — getReceipt(canceled tripId) is null → screen renders missing fallback',
    mockApi.getReceipt('trip-H-driver-canceled') === null);
  expect('H — getReceipt(no-show tripId) is null → screen renders missing fallback',
    mockApi.getReceipt('trip-H-no-show') === null);
  // No history entries exist either.
  const historyAfter = rideHistory.readRideHistoryStatus();
  expect('H — ride_history store is empty after canceled-only flow',
    historyAfter.status === 'empty' && historyAfter.entries.length === 0);
  // The receipts list still seeds the demo so payouts isn't empty —
  // but no canceled tripId leaks in.
  const list = mockApi.listDriverReceipts();
  expect('H — listDriverReceipts has no canceled / no-show entries (only demo seed survives)',
    !list.some((r) => r.tripId.includes('canceled') || r.tripId.includes('no-show'))
    && list.some((r) => r.tripId === '48-321'));
}

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));

if (issues.length) process.exit(1);
