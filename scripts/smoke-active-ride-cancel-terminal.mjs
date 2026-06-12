// BD-ACTIVE-RIDE-TERM-01 — actor-aware active-ride cancel + terminal
// visibility smoke.
//
// Order Detail 01D-2A/B/C/D landed the pre-handoff lifecycle (passenger
// select / open-trip / cancel / reject / offer sync; driver D3 cancel)
// and intentionally does NOT mutate `bazardrive.active_ride.v1`. This
// smoke pins the **post-handoff** terminal contract on the active-ride
// store itself:
//
//   1. ride_state writes the terminal cancel record with the right
//      actor / reason / timestamp shape;
//   2. cancelActiveRide refuses unknown tripIds (no demo materialised);
//   3. terminal-regression guard prevents stale clicks from rewinding a
//      CANCELED / NO_SHOW / COMPLETED ride to a non-terminal status;
//   4. existing terminal cancel snapshot is preserved verbatim (no
//      identity / route / passenger demo fallback overlay);
//   5. driver + passenger render branches differentiate `cancel.by` and
//      hide every active CTA — caught at source level since this script
//      runs without a DOM.
//
// Behavioral assertions use the same `globalThis.localStorage` in-memory
// shim pattern smoke-order-detail-contract.mjs uses.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// In-memory localStorage shim so the module-under-test can round-trip
// the active-ride store without a browser.
const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => _store.has(k) ? _store.get(k) : null,
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { _store.delete(k); },
  clear: () => { _store.clear(); },
};

const rideState = await import(new URL('../public/src/ride_state.js', import.meta.url).href);

const ACTIVE_RIDE_STORE_KEY = 'bazardrive.active_ride.v1';

// Source files for the static / render-branch pins.
const rideStateSrc          = read('../public/src/ride_state.js');
const driverScreenSrc       = read('../public/src/screens/active_ride.js');
const passengerScreenSrc    = read('../public/src/screens/active_ride_passenger.js');
const driverSheetsSrc       = read('../public/src/screens/active_ride_driver_sheets.js');
const passengerSheetsSrc    = read('../public/src/screens/active_ride_passenger_sheets.js');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// ── Module surface ──────────────────────────────────────────────────
expect('ride_state.js exports cancelActiveRide',
  typeof rideState.cancelActiveRide === 'function');
expect('ride_state.js exports RIDE_STATUS with the terminal trio',
  rideState.RIDE_STATUS
  && rideState.RIDE_STATUS.CANCELED === 'CANCELED'
  && rideState.RIDE_STATUS.NO_SHOW === 'NO_SHOW'
  && rideState.RIDE_STATUS.COMPLETED === 'COMPLETED');

// Test scaffolding: seed a unique ride snapshot so we can assert
// snapshot preservation across the cancel write.
function seedRide(tripId, overrides = {}) {
  _store.clear();
  const seed = rideState.createDemoActiveRide({
    tripId,
    status: rideState.RIDE_STATUS.DRIVER_EN_ROUTE,
    passenger: {
      name: 'Иван Тестов',
      initials: 'ИТ',
      rating: '4,77',
      phoneMasked: '+7 ... 99-99',
      luggage: 'тестовый багаж',
    },
    driver: {
      name: 'Тестовый Водитель',
      initials: 'ТВ',
      rating: '4,88',
    },
    route: {
      pickupLabel:  'ул. Тестовая, 1',
      dropoffLabel: 'Аэропорт Тест',
    },
    order: {
      offerPrice: '1 234 ₽',
    },
    ride: {
      price: '1 234 ₽',
    },
    ...overrides,
  });
  rideState.saveActiveRide(seed);
  return seed;
}

// ── T1 — ride_state.cancelActiveRide writes terminal record (driver actor) ─
{
  seedRide('trip-t1');
  const result = rideState.cancelActiveRide({
    tripId: 'trip-t1',
    canceledBy: 'driver',
    reason: 'no_show',
  });
  expect('T1 — cancelActiveRide returns the canceled ride',
    !!result && result.status === rideState.RIDE_STATUS.CANCELED);
  expect('T1 — cancel.by === "driver"',
    result?.cancel?.by === 'driver');
  expect('T1 — cancel.reason preserved verbatim',
    result?.cancel?.reason === 'no_show');
  expect('T1 — timestamps.canceledAt is a non-empty ISO string',
    typeof result?.timestamps?.canceledAt === 'string'
    && result.timestamps.canceledAt.length > 0);
  // Unique snapshot data preserved across the cancel write.
  expect('T1 — passenger snapshot preserved (no demo fallback identity leaked)',
    result?.passenger?.name === 'Иван Тестов'
    && result?.passenger?.phoneMasked === '+7 ... 99-99');
  expect('T1 — route snapshot preserved',
    result?.route?.pickupLabel === 'ул. Тестовая, 1'
    && result?.route?.dropoffLabel === 'Аэропорт Тест');
  expect('T1 — driver snapshot preserved',
    result?.driver?.name === 'Тестовый Водитель');
  expect('T1 — order.offerPrice preserved',
    result?.order?.offerPrice === '1 234 ₽');
  // Store carries the canceled record after the call.
  expect('T1 — store round-trip carries the canceled record',
    rideState.findActiveRide('trip-t1')?.status === rideState.RIDE_STATUS.CANCELED);
}

// ── T2 — cancelActiveRide refuses unknown tripId (no demo materialised) ─
{
  _store.clear();
  const result = rideState.cancelActiveRide({
    tripId: 'totally-unknown-trip',
    canceledBy: 'driver',
  });
  expect('T2 — cancelActiveRide on an unknown tripId returns null',
    result === null);
  expect('T2 — no record was materialised in the store for the unknown trip',
    rideState.findActiveRide('totally-unknown-trip') === null);
  expect('T2 — bazardrive.active_ride.v1 was NOT written',
    !_store.has(ACTIVE_RIDE_STORE_KEY));
  // Safe-arg refusals.
  expect('T2 — missing tripId refused',
    rideState.cancelActiveRide({ canceledBy: 'driver' }) === null);
  expect('T2 — non-string tripId refused',
    rideState.cancelActiveRide({ tripId: 42, canceledBy: 'driver' }) === null
    && rideState.cancelActiveRide({ tripId: null, canceledBy: 'driver' }) === null
    && rideState.cancelActiveRide({ tripId: '', canceledBy: 'driver' }) === null);
  expect('T2 — missing args object refused',
    rideState.cancelActiveRide() === null);
}

// ── T3 — passenger render after driver cancel (source-level branches) ──
{
  // Behavioral baseline: write a driver-canceled record + assert the
  // active-ride passenger screen carries the matching render branch.
  seedRide('trip-t3');
  rideState.cancelActiveRide({
    tripId: 'trip-t3',
    canceledBy: 'driver',
    reason: 'driver_changed_mind',
  });
  const ride = rideState.findActiveRide('trip-t3');
  expect('T3 baseline — ride is CANCELED with cancel.by="driver"',
    ride?.status === 'CANCELED' && ride?.cancel?.by === 'driver');
  // Source-level: the passenger screen differentiates `cancel.by === 'driver'`
  // and routes a CANCELED ride into renderPassengerCanceledFallback.
  expect('T3 — passenger screen renders cancel.by === "driver" with driver copy',
    /cancel\.by\s*===\s*['"]driver['"][\s\S]{0,800}Водитель\s+отменил\s+эту\s+поездку/.test(passengerScreenSrc));
  expect('T3 — passenger CANCELED ride routes into renderPassengerCanceledFallback',
    /ride\.status\s*===\s*RIDE_STATUS\.CANCELED[\s\S]{0,200}renderPassengerCanceledFallback/.test(passengerScreenSrc));
  expect('T3 — passenger fallback hides «Отменить» / «Чат» / map sheet actions',
    /function\s+renderPassengerCanceledFallback[\s\S]*?return\s+root;/.test(passengerScreenSrc));
  // The fallback markup must not bind any active-ride action button.
  const passengerNoComments = stripComments(passengerScreenSrc);
  const fallbackMatch = passengerNoComments.match(/function\s+renderPassengerCanceledFallback[\s\S]*?return\s+root;/);
  const fallbackBody = fallbackMatch ? fallbackMatch[0] : '';
  expect('T3 — passenger cancel fallback body resolved',
    fallbackBody.length > 0);
  for (const forbidden of [
    'data-action="cancel-ride"',
    'data-action="confirm-arrival"',
    'data-action="start-trip"',
    'data-action="finish-trip"',
    'updateActiveRideStatus(',
  ]) {
    expect(`T3 — passenger cancel fallback does NOT include ${forbidden}`,
      !fallbackBody.includes(forbidden));
  }
}

// ── T4 — driver render after passenger cancel (source-level branches) ──
{
  seedRide('trip-t4');
  rideState.cancelActiveRide({
    tripId: 'trip-t4',
    canceledBy: 'passenger',
    reason: 'passenger_changed_mind',
  });
  const ride = rideState.findActiveRide('trip-t4');
  expect('T4 baseline — ride is CANCELED with cancel.by="passenger"',
    ride?.status === 'CANCELED' && ride?.cancel?.by === 'passenger');
  // Source-level: the driver screen's renderCanceledStub differentiates
  // `cancel.by === 'passenger'` and routes CANCELED into the stub.
  expect('T4 — driver renderCanceledStub differentiates byPassenger',
    /renderCanceledStub[\s\S]{0,2000}byPassenger\s*=\s*cancel\.by\s*===\s*['"]passenger['"]/.test(driverScreenSrc));
  expect('T4 — driver renderCanceledStub uses passenger-cancel copy',
    /byPassenger[\s\S]{0,800}Пассажир\s+отменил\s+заказ/.test(driverScreenSrc));
  expect('T4 — driver renderSheet routes terminal statuses into renderCanceledStub',
    /ride\.status\s*===\s*RIDE_STATUS\.CANCELED[\s\S]{0,200}renderCanceledStub/.test(driverScreenSrc));
  // Driver canceled stub must not bind any active CTA.
  const driverNoComments = stripComments(driverScreenSrc);
  const stubMatch = driverNoComments.match(/function\s+renderCanceledStub[\s\S]*?\n\s*\}/);
  const stubBody = stubMatch ? stubMatch[0] : '';
  expect('T4 — driver renderCanceledStub body resolved', stubBody.length > 0);
  for (const forbidden of [
    'data-action="cancel"',
    'driver-start-pickup',
    'persistDriverCancel',
    'persistDriverRideStatus',
    'updateActiveRideStatus(',
  ]) {
    expect(`T4 — driver renderCanceledStub does NOT include ${forbidden}`,
      !stubBody.includes(forbidden));
  }
}

// ── T5 — NO_SHOW guard: terminal copy + no cancel sheet reopen ─────
{
  seedRide('trip-t5', { status: rideState.RIDE_STATUS.WAITING_PASSENGER });
  // Write a NO_SHOW directly via updateActiveRideStatus (the driver
  // no-show path inside the screen passes the same patch shape).
  const noShow = rideState.updateActiveRideStatus('trip-t5',
    rideState.RIDE_STATUS.NO_SHOW,
    { cancel: { by: 'driver', reason: 'passenger_no_show' } });
  expect('T5 — NO_SHOW write lands the terminal status',
    noShow?.status === 'NO_SHOW');
  expect('T5 — NO_SHOW writes timestamps.canceledAt (shared field)',
    typeof noShow?.timestamps?.canceledAt === 'string'
    && noShow.timestamps.canceledAt.length > 0);
  // cancelActiveRide is idempotent on NO_SHOW — returns the existing
  // record verbatim instead of overwriting it with a CANCELED status.
  const sameRide = rideState.cancelActiveRide({
    tripId: 'trip-t5',
    canceledBy: 'passenger',
  });
  expect('T5 — cancelActiveRide on a NO_SHOW ride returns the NO_SHOW record verbatim',
    sameRide?.status === 'NO_SHOW'
    && sameRide?.cancel?.by === 'driver'
    && sameRide?.cancel?.reason === 'passenger_no_show');
  // Passenger-side NO_SHOW falls into the cancel fallback with the
  // 'no_show' variant.
  expect('T5 — passenger screen routes NO_SHOW into renderPassengerCanceledFallback("no_show")',
    /ride\.status\s*===\s*RIDE_STATUS\.NO_SHOW[\s\S]{0,200}renderPassengerCanceledFallback\([\s\S]{0,80}['"]no_show['"]\)/.test(passengerScreenSrc));
  // Driver-side NO_SHOW shares the same renderCanceledStub branch.
  expect('T5 — driver renderSheet routes NO_SHOW into renderCanceledStub',
    /ride\.status\s*===\s*RIDE_STATUS\.NO_SHOW[\s\S]{0,200}renderCanceledStub/.test(driverScreenSrc));
  // Sheets stay UI-only: cancel / problem sheets never write a status.
  const driverSheetsNoComments = stripComments(driverSheetsSrc);
  expect('T5 — driver cancel sheet never calls updateActiveRideStatus / saveActiveRide / cancelActiveRide',
    !/updateActiveRideStatus\s*\(/.test(driverSheetsNoComments)
    && !/saveActiveRide\s*\(/.test(driverSheetsNoComments)
    && !/cancelActiveRide\s*\(/.test(driverSheetsNoComments));
  const passengerSheetsNoComments = stripComments(passengerSheetsSrc);
  expect('T5 — passenger cancel sheet never calls updateActiveRideStatus / saveActiveRide / cancelActiveRide',
    !/updateActiveRideStatus\s*\(/.test(passengerSheetsNoComments)
    && !/saveActiveRide\s*\(/.test(passengerSheetsNoComments)
    && !/cancelActiveRide\s*\(/.test(passengerSheetsNoComments));
}

// ── T6 — terminal-regression guard: CANCELED cannot rewind to IN_PROGRESS ─
{
  seedRide('trip-t6');
  const canceled = rideState.cancelActiveRide({
    tripId: 'trip-t6',
    canceledBy: 'driver',
    reason: 'other',
  });
  const canceledAt = canceled.timestamps.canceledAt;
  // Stale "Завершить" click after the cancel landed.
  const rewindAttempt = rideState.updateActiveRideStatus('trip-t6',
    rideState.RIDE_STATUS.IN_PROGRESS, {});
  expect('T6 — updateActiveRideStatus refuses CANCELED → IN_PROGRESS regression',
    rewindAttempt?.status === 'CANCELED');
  expect('T6 — terminal timestamp NOT overwritten by the stale click',
    rideState.findActiveRide('trip-t6')?.timestamps?.canceledAt === canceledAt);
  expect('T6 — cancel.by NOT overwritten',
    rideState.findActiveRide('trip-t6')?.cancel?.by === 'driver');
  // COMPLETED also guards.
  seedRide('trip-t6b');
  rideState.updateActiveRideStatus('trip-t6b', rideState.RIDE_STATUS.COMPLETED, {});
  const rewindCompleted = rideState.updateActiveRideStatus('trip-t6b',
    rideState.RIDE_STATUS.DRIVER_EN_ROUTE, {});
  expect('T6 — COMPLETED ride cannot rewind to DRIVER_EN_ROUTE',
    rewindCompleted?.status === 'COMPLETED');
  // NO_SHOW also guards.
  seedRide('trip-t6c', { status: rideState.RIDE_STATUS.WAITING_PASSENGER });
  rideState.updateActiveRideStatus('trip-t6c', rideState.RIDE_STATUS.NO_SHOW, {});
  const rewindNoShow = rideState.updateActiveRideStatus('trip-t6c',
    rideState.RIDE_STATUS.IN_PROGRESS, {});
  expect('T6 — NO_SHOW ride cannot rewind to IN_PROGRESS',
    rewindNoShow?.status === 'NO_SHOW');
}

// ── T7 — unknown / non-passenger / non-driver canceledBy preserved safely ─
{
  seedRide('trip-t7');
  const systemCancel = rideState.cancelActiveRide({
    tripId: 'trip-t7',
    canceledBy: 'system',
    reason: 'ttl_expired',
  });
  expect('T7 — system canceledBy preserved verbatim',
    systemCancel?.cancel?.by === 'system'
    && systemCancel?.cancel?.reason === 'ttl_expired'
    && systemCancel?.status === 'CANCELED');
  // Unknown future actor passes through (no enum lock).
  seedRide('trip-t7b');
  const futureActor = rideState.cancelActiveRide({
    tripId: 'trip-t7b',
    canceledBy: 'dispatcher_bot',
  });
  expect('T7 — unknown actor ("dispatcher_bot") preserved verbatim',
    futureActor?.cancel?.by === 'dispatcher_bot');
  // Missing / non-string canceledBy becomes null (render branches
  // already fall through to the neutral "Мы закрыли эту поездку" copy
  // on the passenger side when cancel.by is null/undefined).
  seedRide('trip-t7c');
  const nullActor = rideState.cancelActiveRide({ tripId: 'trip-t7c' });
  expect('T7 — missing canceledBy degrades to null (render falls through)',
    nullActor?.cancel?.by === null);
  expect('T7 — passenger fallback has a neutral default copy for cancel.by absent',
    /Мы\s+закрыли\s+эту\s+поездку/.test(passengerScreenSrc));
}

// ── T8 — snapshot preservation: cancel does not overwrite ride identity ─
{
  seedRide('trip-t8');
  const before = rideState.findActiveRide('trip-t8');
  const canceled = rideState.cancelActiveRide({
    tripId: 'trip-t8',
    canceledBy: 'passenger',
    reason: 'changed_mind',
    comment: 'передумал ехать',
  });
  // Identity fields preserved.
  for (const [path, get] of [
    ['tripId',                (r) => r.tripId],
    ['passenger.name',        (r) => r.passenger?.name],
    ['passenger.phoneMasked', (r) => r.passenger?.phoneMasked],
    ['driver.name',           (r) => r.driver?.name],
    ['route.pickupLabel',     (r) => r.route?.pickupLabel],
    ['route.dropoffLabel',    (r) => r.route?.dropoffLabel],
    ['order.offerPrice',      (r) => r.order?.offerPrice],
    ['ride.price',            (r) => r.ride?.price],
    ['timestamps.createdAt',  (r) => r.timestamps?.createdAt],
  ]) {
    expect(`T8 — ${path} preserved across cancel`,
      get(before) === get(canceled));
  }
  expect('T8 — cancel.comment preserved verbatim',
    canceled?.cancel?.comment === 'передумал ехать');
}

// ── T9 — cancelActiveRide and saveActiveRide are the only writers to active_ride.v1 ─
//          and neither touches the Order Detail overlay store.
{
  _store.clear();
  seedRide('trip-t9');
  const overlayKey = 'bazardrive.order_overlay.v1';
  const driverOffersKey = 'bazardrive.driver_offers.v1';
  expect('T9 baseline — no Order overlay / DriverOffer store entries',
    !_store.has(overlayKey) && !_store.has(driverOffersKey));
  rideState.cancelActiveRide({
    tripId: 'trip-t9',
    canceledBy: 'driver',
    reason: 'other',
  });
  expect('T9 — cancelActiveRide does NOT write the Order overlay store',
    !_store.has(overlayKey));
  expect('T9 — cancelActiveRide does NOT write the DriverOffer store',
    !_store.has(driverOffersKey));
  // The only store that got written is the active-ride one.
  expect('T9 — only bazardrive.active_ride.v1 was written',
    _store.size === 1 && _store.has(ACTIVE_RIDE_STORE_KEY));
}

// ── T10 — source guards: active-ride code does not call Order Detail helpers ─
{
  const rideStateNoComments = stripComments(rideStateSrc);
  expect('T10 — ride_state.js never calls fetch(',
    !/\bfetch\s*\(/.test(rideStateNoComments));
  expect('T10 — ride_state.js never references mapbox',
    !/mapbox/i.test(rideStateNoComments));
  expect('T10 — ride_state.js never imports from Order Detail helpers',
    !/from\s*['"][^'"]*driver_offer_store/.test(rideStateNoComments));
  expect('T10 — ride_state.js never writes bazardrive.order_overlay.v1',
    !/bazardrive\.order_overlay\.v1/.test(rideStateNoComments));
  expect('T10 — ride_state.js never writes bazardrive.driver_offers.v1',
    !/bazardrive\.driver_offers\.v1/.test(rideStateNoComments));

  const passengerNoComments = stripComments(passengerScreenSrc);
  expect('T10 — passenger active-ride screen does not import driver_offer_store',
    !/from\s*['"][^'"]*driver_offer_store/.test(passengerNoComments));
  expect('T10 — passenger active-ride screen does not write the Order overlay store',
    !/bazardrive\.order_overlay\.v1/.test(passengerNoComments));

  const driverNoComments = stripComments(driverScreenSrc);
  expect('T10 — driver active-ride screen does not import driver_offer_store',
    !/from\s*['"][^'"]*driver_offer_store/.test(driverNoComments));
  expect('T10 — driver active-ride screen does not write the Order overlay store',
    !/bazardrive\.order_overlay\.v1/.test(driverNoComments));

  // The screens' cancel persisters still flow through ride_state — not
  // Order Detail. Confirm the existing pattern via source.
  // The driver screen funnels cancel through persistDriverCancel →
  // persistDriverRideStatus → updateActiveRideStatus. Pin both legs of
  // the chain so neither can be replaced by a foreign helper.
  expect('T10 — driver screen has persistDriverCancel calling persistDriverRideStatus',
    /persistDriverCancel[\s\S]{0,400}persistDriverRideStatus\s*\(/.test(driverScreenSrc));
  // Window widened (was 400) — T14 added a pre-save guard block
  // before the updateActiveRideStatus call.
  expect('T10 — driver screen has persistDriverRideStatus calling updateActiveRideStatus',
    /persistDriverRideStatus[\s\S]{0,2000}updateActiveRideStatus\s*\(/.test(driverScreenSrc));
  expect('T10 — passenger cancel handler persists via updateActiveRideStatus (not Order Detail)',
    /updateActiveRideStatus\s*\([\s\S]{0,400}RIDE_STATUS\.CANCELED/.test(passengerScreenSrc));
}

// ── T11 — driver canonical sync only fires on actual status transition ─
// Regression pin for the P2 review: persistDriverRideStatus must NOT
// call syncCanonicalOrderStatus when updateActiveRideStatus refused
// the transition (returns the existing terminal record verbatim
// instead of writing `nextStatus`). Without this guard the canonical
// order would be synced to the stale requested status (e.g. CANCELED
// → IN_PROGRESS or CANCELED → COMPLETED) even though the active ride
// didn't move.
{
  seedRide('trip-t11');
  rideState.cancelActiveRide({
    tripId: 'trip-t11',
    canceledBy: 'driver',
    reason: 'other',
  });
  // Simulate the stale "Завершить" / "Старт" click: caller requests
  // IN_PROGRESS, the store refuses, returns the CANCELED record.
  const refused = rideState.updateActiveRideStatus('trip-t11',
    rideState.RIDE_STATUS.IN_PROGRESS, {});
  expect('T11 — refused transition returns the existing terminal record',
    refused?.status === 'CANCELED');
  expect('T11 — refused result.status !== requested status (caller-visible signal)',
    refused?.status !== rideState.RIDE_STATUS.IN_PROGRESS);
  // Source pin: persistDriverRideStatus now gates the sync on
  // `nextRide.status === nextStatus`. Without this, the canonical
  // order would be written to the requested-but-not-applied status.
  // Window widened (was 800) — T14 added the pre-save block above
  // the gate.
  expect('T11 — persistDriverRideStatus gates syncCanonicalOrderStatus on actual transition',
    /persistDriverRideStatus[\s\S]{0,2400}nextRide\.status\s*===\s*nextStatus[\s\S]{0,300}syncCanonicalOrderStatus/.test(driverScreenSrc));
  // Also pin that the old unconditional `if (nextRide) syncCanonicalOrderStatus(...)`
  // is gone — a future revert would re-introduce the leak.
  expect('T11 — old unconditional sync pattern is gone',
    !/if\s*\(\s*nextRide\s*\)\s*syncCanonicalOrderStatus/.test(driverScreenSrc));
}

// ── T12 — terminal write on unknown tripId returns null + no demo creation ─
// Regression pin for the P2 review: updateActiveRideStatus must NOT
// auto-create a demo identity for an unknown tripId when the
// requested status is terminal (CANCELED / NO_SHOW / COMPLETED).
// Non-terminal writes still auto-create (the driver-accept handler
// relies on it).
{
  _store.clear();
  for (const terminalStatus of [
    rideState.RIDE_STATUS.CANCELED,
    rideState.RIDE_STATUS.NO_SHOW,
    rideState.RIDE_STATUS.COMPLETED,
  ]) {
    const result = rideState.updateActiveRideStatus('unknown-trip-' + terminalStatus,
      terminalStatus, { cancel: { by: 'forged-actor' } });
    expect(`T12 — updateActiveRideStatus('unknown', ${terminalStatus}) returns null`,
      result === null);
    expect(`T12 — no record materialised for the unknown ${terminalStatus} write`,
      rideState.findActiveRide('unknown-trip-' + terminalStatus) === null);
  }
  expect('T12 — bazardrive.active_ride.v1 stays empty across all unknown terminal writes',
    !_store.has(ACTIVE_RIDE_STORE_KEY)
    || JSON.parse(_store.get(ACTIVE_RIDE_STORE_KEY) || '{}').constructor === Object
       && Object.keys(JSON.parse(_store.get(ACTIVE_RIDE_STORE_KEY) || '{}')).length === 0);
  // Non-terminal write on an unknown tripId still materialises (legacy
  // behaviour — the driver-accept deep-link path relies on this).
  _store.clear();
  const nonTerminal = rideState.updateActiveRideStatus('unknown-non-terminal',
    rideState.RIDE_STATUS.DRIVER_EN_ROUTE, {});
  expect('T12 — non-terminal write on unknown tripId still materialises (legacy)',
    nonTerminal?.status === 'DRIVER_EN_ROUTE');
}

// ── T13 — saveActiveRide protects terminal records from stale pre-saves ─
// Regression pin for the P2 review: the passenger cancel handler does
// a pre-save (`saveActiveRide(ride)`) with a stale in-memory snapshot
// before `updateActiveRideStatus`. If the stored ride was already
// terminal (driver cancel landed first in another tab), the stale
// pre-save must NOT thaw the terminal record back to a non-terminal
// status.
{
  seedRide('trip-t13');
  const canceled = rideState.cancelActiveRide({
    tripId: 'trip-t13',
    canceledBy: 'driver',
    reason: 'driver_emergency',
  });
  const beforeCanceledAt = canceled.timestamps.canceledAt;
  // Stale pre-save: snapshot taken before the cancel landed; status
  // is still DRIVER_EN_ROUTE in this stale snapshot.
  const stale = {
    tripId: 'trip-t13',
    status: rideState.RIDE_STATUS.DRIVER_EN_ROUTE,
    passenger: { name: 'STALE Passenger' },
    driver:    { name: 'STALE Driver' },
    timestamps: { createdAt: '2026-01-01T00:00:00.000Z' },
  };
  const saveResult = rideState.saveActiveRide(stale);
  expect('T13 — saveActiveRide returns the existing terminal record verbatim',
    saveResult?.status === 'CANCELED'
    && saveResult?.cancel?.by === 'driver');
  const after = rideState.findActiveRide('trip-t13');
  expect('T13 — stored ride remains CANCELED after the stale pre-save',
    after?.status === 'CANCELED');
  expect('T13 — cancel.by stays "driver" (stale passenger snapshot did NOT overwrite)',
    after?.cancel?.by === 'driver');
  expect('T13 — timestamps.canceledAt unchanged',
    after?.timestamps?.canceledAt === beforeCanceledAt);
  expect('T13 — passenger identity preserved (stale snapshot did NOT leak)',
    after?.passenger?.name === 'Иван Тестов');
  expect('T13 — driver identity preserved (stale snapshot did NOT leak)',
    after?.driver?.name === 'Тестовый Водитель');

  // End-to-end: the realistic passenger-cancel sequence (pre-save +
  // updateActiveRideStatus) must not overwrite the driver actor.
  const passengerStale = {
    tripId: 'trip-t13',
    status: rideState.RIDE_STATUS.IN_PROGRESS,
    passenger: { name: 'STALE Passenger' },
    timestamps: { createdAt: '2026-01-01T00:00:00.000Z' },
  };
  rideState.saveActiveRide(passengerStale);
  const passengerCancelAttempt = rideState.updateActiveRideStatus('trip-t13',
    rideState.RIDE_STATUS.CANCELED,
    { cancel: { by: 'passenger', reason: 'passenger_changed_mind' } });
  expect('T13 — end-to-end: passenger cancel sequence cannot overwrite driver actor',
    passengerCancelAttempt?.cancel?.by === 'driver'
    && passengerCancelAttempt?.cancel?.reason === 'driver_emergency'
    && passengerCancelAttempt?.timestamps?.canceledAt === beforeCanceledAt);

  // Idempotent re-save of the same terminal record still passes through:
  // a legitimate caller can update peer fields on a terminal ride
  // without changing the status.
  const sameStatusRide = {
    ...after,
    ride: { ...(after.ride || {}), todayEarnings: '999 ₽' },
  };
  const idempotent = rideState.saveActiveRide(sameStatusRide);
  expect('T13 — idempotent re-save of same terminal status passes through',
    idempotent?.status === 'CANCELED'
    && idempotent?.ride?.todayEarnings === '999 ₽');

  // Cross-terminal save (CANCELED → NO_SHOW) is also refused — both
  // are terminal but differ, so the freeze applies.
  seedRide('trip-t13b');
  rideState.cancelActiveRide({ tripId: 'trip-t13b', canceledBy: 'driver' });
  const crossTerminal = rideState.saveActiveRide({
    tripId: 'trip-t13b',
    status: rideState.RIDE_STATUS.NO_SHOW,
  });
  expect('T13 — cross-terminal save (CANCELED → NO_SHOW) is also refused',
    crossTerminal?.status === 'CANCELED');
}

// ── T14 — driver simulated-ride terminal action persists via pre-save ─
// Regression pin for the second-round P2 review: the terminal-write
// existing-ride requirement (T12) initially broke status-simulated
// rides — `loadCanonicalActiveRide` returns null for an unknown
// tripId, the screen builds an in-memory ride via `createDemoActiveRide`
// (NOT persisted), and a Finish / No-show / Cancel click would
// silently no-op because `updateActiveRideStatus(unknown-tripId,
// CANCELED|NO_SHOW|COMPLETED)` returns null. Fix: `persistDriverRideStatus`
// pre-saves the in-memory ride via `findActiveRide`/`saveActiveRide`
// when the store has no entry yet, so the terminal write has an
// existing record to mutate.
{
  // Behavioral: pre-save then terminal write end-to-end. The store
  // starts empty, the caller pre-saves a non-terminal in-memory ride,
  // then writes a terminal status; the terminal write succeeds.
  _store.clear();
  const simulatedRide = rideState.createDemoActiveRide({
    tripId: 'sim-trip-14',
    status: rideState.RIDE_STATUS.IN_PROGRESS,
    passenger: { name: 'Sim Passenger' },
  });
  // Caller sequence: pre-save (matches persistDriverRideStatus).
  rideState.saveActiveRide(simulatedRide);
  const completed = rideState.updateActiveRideStatus('sim-trip-14',
    rideState.RIDE_STATUS.COMPLETED, {});
  expect('T14 — terminal write succeeds after pre-save on simulated ride',
    completed?.status === 'COMPLETED');
  expect('T14 — simulated passenger identity preserved across terminal write',
    completed?.passenger?.name === 'Sim Passenger');
  // Without the pre-save: direct terminal write on an unknown tripId
  // returns null (T12 behaviour, regressed by the second-round review).
  _store.clear();
  const directTerminal = rideState.updateActiveRideStatus('sim-trip-14b',
    rideState.RIDE_STATUS.COMPLETED, {});
  expect('T14 — without pre-save, terminal write on unknown tripId is still refused',
    directTerminal === null);
  // Source pins: persistDriverRideStatus imports findActiveRide +
  // saveActiveRide and uses them as the pre-save gate.
  expect('T14 — active_ride.js imports findActiveRide from ride_state.js',
    /import\s*\{[\s\S]*?findActiveRide[\s\S]*?\}\s*from\s*['"]\.\.\/ride_state\.js['"]/.test(driverScreenSrc));
  expect('T14 — active_ride.js imports saveActiveRide from ride_state.js',
    /import\s*\{[\s\S]*?saveActiveRide[\s\S]*?\}\s*from\s*['"]\.\.\/ride_state\.js['"]/.test(driverScreenSrc));
  expect('T14 — persistDriverRideStatus pre-saves when no canonical store record',
    /persistDriverRideStatus[\s\S]{0,1500}!\s*findActiveRide\(\s*ride\.tripId\s*\)[\s\S]{0,200}saveActiveRide\(\s*ride\s*\)/.test(driverScreenSrc));
}

// ── T15 — passenger canonical sync gated on canceledRide.status === CANCELED ─
// Regression pin for the second-round P2 review: when the active-ride
// store already carries a non-CANCELED terminal record (driver-
// completed in another tab), the stale passenger tab still calls
// `updateTripStatus(canonicalOrderId, CANCELED)` unconditionally. Fix:
// gate the canonical sync on `canceledRide.status === CANCELED` —
// mirrors the driver-side `nextRide.status === nextStatus` gate (T11).
{
  // Source pin: passenger cancel handler now gates the canonical
  // sync on the actual outcome.
  expect('T15 — passenger cancel handler gates updateTripStatus on canceledRide.status === CANCELED',
    /canonicalOrderId[\s\S]{0,400}canceledRide[\s\S]{0,200}status\s*===\s*RIDE_STATUS\.CANCELED[\s\S]{0,200}updateTripStatus/.test(passengerScreenSrc));
  // Forbid the old unconditional pattern: a future revert would
  // re-introduce the leak.
  expect('T15 — old unconditional `if (canonicalOrderId) updateTripStatus` pattern is gone',
    !/if\s*\(\s*canonicalOrderId\s*\)\s*updateTripStatus\s*\(\s*canonicalOrderId\s*,\s*RIDE_STATUS\.CANCELED\s*\)/.test(passengerScreenSrc));
  // Behavioral: when a driver completes the ride and a stale
  // passenger tab fires updateActiveRideStatus, the helper returns
  // the COMPLETED record (NOT CANCELED). The source-level gate
  // means the caller knows not to fire updateTripStatus.
  seedRide('trip-t15');
  rideState.updateActiveRideStatus('trip-t15', rideState.RIDE_STATUS.COMPLETED, {});
  const stalePassengerResult = rideState.updateActiveRideStatus('trip-t15',
    rideState.RIDE_STATUS.CANCELED,
    { cancel: { by: 'passenger', reason: 'changed_mind' } });
  expect('T15 — stale passenger CANCELED on COMPLETED ride returns COMPLETED record',
    stalePassengerResult?.status === 'COMPLETED');
  expect('T15 — caller-visible signal: returned status !== CANCELED',
    stalePassengerResult?.status !== 'CANCELED');
  // Same for a driver-canceled ride: passenger retry returns driver
  // record verbatim, the gate prevents the canonical sync.
  seedRide('trip-t15b');
  rideState.cancelActiveRide({ tripId: 'trip-t15b', canceledBy: 'driver' });
  const stalePassengerOnDriverCancel = rideState.updateActiveRideStatus('trip-t15b',
    rideState.RIDE_STATUS.CANCELED,
    { cancel: { by: 'passenger', reason: 'changed_mind' } });
  expect('T15 — driver-canceled actor preserved across stale passenger retry',
    stalePassengerOnDriverCancel?.cancel?.by === 'driver');
  expect('T15 — returned status IS CANCELED (same terminal) — caller still gates on actor',
    stalePassengerOnDriverCancel?.status === 'CANCELED');
}

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));

if (issues.length) process.exit(1);
