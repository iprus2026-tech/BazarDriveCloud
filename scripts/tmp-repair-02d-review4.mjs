import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const write = (path, text) => fs.writeFileSync(path, text);

function replaceOnce(text, from, to, label) {
  const first = text.indexOf(from);
  if (first === -1) throw new Error(`missing replacement anchor: ${label}`);
  if (text.indexOf(from, first + from.length) !== -1) throw new Error(`ambiguous replacement anchor: ${label}`);
  return text.slice(0, first) + to + text.slice(first + from.length);
}

const passengerPath = 'public/src/screens/active_ride_passenger.js';
let passenger = read(passengerPath);

passenger = replaceOnce(passenger,
`  const fixture = getPassengerRideFixture();
  const hasUsableLocalRide = !fixture && hasUsablePassengerRideSource(tripId);

  // Fixture isolation happens before every persisted ride / response / handoff
`,
`  const fixture = getPassengerRideFixture();
  const hasPersistedLocalRide = !fixture && hasUsablePassengerRideSource(tripId);
  const isBuiltInDemoRide = !fixture && tripId === DEMO_ACTIVE_RIDE_ID;
  const hasUsableLocalRide = hasPersistedLocalRide || isBuiltInDemoRide;

  // Fixture isolation happens before every persisted ride / response / handoff
`,
'local/demo source split');

passenger = replaceOnce(passenger,
`  // #784 CUT-5 (B2) — set only after the initial participant-gated GET has
  // positively identified a server ride. Passenger status writers stay unchanged.
  let backendRide = false;
`,
`  // 02D retryable-read/write contract (review4):
  // - existing stores and Ride State Machine statuses are unchanged; no recovery flag is persisted;
  // - GET + realtime poll remain readers, PATCH remains the server status writer;
  // - backendRide means a participant-gated GET positively identified the ride and gates polling only;
  // - backendWriteCandidate is in-memory write intent. A persisted local/handoff ride under backend ON
  //   remains a candidate across retryable read failures, so cancel/boarded still attempt the existing PATCH;
  // - authoritative missing/permanent read outcomes clear write intent; the built-in demo is renderable
  //   fallback only and is never a write candidate unless a GET actually identifies it on the server.
  let backendRide = false;
  let backendWriteCandidate = backendRead && hasPersistedLocalRide;
`,
'read/write recovery contract');

passenger = replaceOnce(passenger,
`          // #784 CUT-5 (B2) — mirror the passenger cancel to the server so the driver (polling) sees
          // it cross-device (the PATCH is participant-gated). Fire-and-forget: the local terminal stub
          // is the user-facing truth; a server-sync failure leaves the local cancel standing (the
          // driver-side poll reconciles). OFF / local-only ride: backendRide is false, no PATCH.
          if (backendRide && canceledRide && canceledRide.status === RIDE_STATUS.CANCELED) {
`,
`          // #784 CUT-5 (B2) — mirror the passenger cancel to the server so the driver (polling) sees
          // it cross-device (the PATCH is participant-gated). Fire-and-forget: the local terminal stub
          // is the user-facing truth; a server-sync failure leaves the local cancel standing (the
          // driver-side poll reconciles). OFF / authoritative local-only ride: no server write candidate.
          if (backendWriteCandidate && canceledRide && canceledRide.status === RIDE_STATUS.CANCELED) {
`,
'cancel writer intent');

passenger = replaceOnce(passenger,
`          if (backendRide) {
            try { await patchRideStatus(ride.tripId, RIDE_STATUS.IN_PROGRESS); }
`,
`          if (backendWriteCandidate) {
            try { await patchRideStatus(ride.tripId, RIDE_STATUS.IN_PROGRESS); }
`,
'boarded writer intent');

passenger = replaceOnce(passenger,
`  function schedulePassengerRideRecovery() {
    if (passengerRecoveryId || fixture || destroyed || !hasUsableLocalRide) return;
`,
`  function schedulePassengerRideRecovery() {
    if (passengerRecoveryId || fixture || destroyed || !hasPersistedLocalRide) return;
`,
'recovery persisted source guard');

passenger = replaceOnce(passenger,
`      if (!srv) {
        backendRide = false;
        stopPassengerRideRecovery();
`,
`      if (!srv) {
        backendRide = false;
        backendWriteCandidate = false;
        stopPassengerRideRecovery();
`,
'null server result clears write intent');

passenger = replaceOnce(passenger,
`      backendRide = true;
      stopPassengerRideRecovery();
`,
`      backendRide = true;
      backendWriteCandidate = true;
      stopPassengerRideRecovery();
`,
'success establishes write intent');

passenger = replaceOnce(passenger,
`      if (err && (err.status === 404 || err.code === 'RIDE_NOT_FOUND')) {
        backendRide = false;
        stopPassengerRideRecovery();
`,
`      if (err && (err.status === 404 || err.code === 'RIDE_NOT_FOUND')) {
        backendRide = false;
        backendWriteCandidate = false;
        stopPassengerRideRecovery();
`,
'404 clears write intent');

passenger = replaceOnce(passenger,
`      backendRide = false;
      if (hasUsableLocalRide) {
        root.dataset.refreshState = 'error';
        setReadState(PASSENGER_RIDE_READ_STATE.LOADED);
        if (!recovery) toast('Не удалось обновить поездку. Показаны сохранённые данные.');
        if (isPassengerRideRecoveryRetryable(err)) schedulePassengerRideRecovery();
        else stopPassengerRideRecovery();
        return;
      }
`,
`      const retryable = isPassengerRideRecoveryRetryable(err);
      backendRide = false;
      if (!retryable) backendWriteCandidate = false;
      if (hasUsableLocalRide) {
        root.dataset.refreshState = 'error';
        setReadState(PASSENGER_RIDE_READ_STATE.LOADED);
        if (!recovery) toast('Не удалось обновить поездку. Показаны сохранённые данные.');
        if (retryable && hasPersistedLocalRide) schedulePassengerRideRecovery();
        else stopPassengerRideRecovery();
        return;
      }
`,
'retryable write intent preservation');

write(passengerPath, passenger);

const smokePath = 'scripts/smoke-passenger-active-ride-loading-states.mjs';
let smoke = read(smokePath);
smoke = replaceOnce(smoke,
`const usableSource = functionBody(passenger, 'hasUsablePassengerRideSource');
expect('usable local fallback recognizes canonical and handoff sources',
  usableSource.includes('loadCanonicalActiveRide')
    && usableSource.includes('loadDriverHandoffSnapshot'));
`,
`const usableSource = functionBody(passenger, 'hasUsablePassengerRideSource');
expect('persisted local fallback recognizes canonical and handoff sources',
  usableSource.includes('loadCanonicalActiveRide')
    && usableSource.includes('loadDriverHandoffSnapshot'));
expect('built-in demo is renderable fallback but not an initial server-write candidate',
  passenger.includes('const hasPersistedLocalRide = !fixture && hasUsablePassengerRideSource(tripId)')
    && passenger.includes('const isBuiltInDemoRide = !fixture && tripId === DEMO_ACTIVE_RIDE_ID')
    && passenger.includes('const hasUsableLocalRide = hasPersistedLocalRide || isBuiltInDemoRide')
    && passenger.includes('let backendWriteCandidate = backendRead && hasPersistedLocalRide'));
`,
'smoke local/demo contract');

smoke = replaceOnce(smoke,
`expect('404/RIDE_NOT_FOUND preserves local rides but renders empty without one',
  initialRead.includes('err.status === 404')
    && initialRead.includes("err.code === 'RIDE_NOT_FOUND'")
    && initialRead.includes('setReadState(hasUsableLocalRide')
    && initialRead.includes('PASSENGER_RIDE_READ_STATE.LOADED')
    && initialRead.includes('PASSENGER_RIDE_READ_STATE.EMPTY'));
`,
`expect('404/RIDE_NOT_FOUND preserves persisted or built-in demo fallback but unknown IDs render empty',
  initialRead.includes('err.status === 404')
    && initialRead.includes("err.code === 'RIDE_NOT_FOUND'")
    && initialRead.includes('backendWriteCandidate = false')
    && initialRead.includes('setReadState(hasUsableLocalRide')
    && passenger.includes('const hasUsableLocalRide = hasPersistedLocalRide || isBuiltInDemoRide')
    && initialRead.includes('PASSENGER_RIDE_READ_STATE.LOADED')
    && initialRead.includes('PASSENGER_RIDE_READ_STATE.EMPTY'));
`,
'smoke honest 404 demo contract');

smoke = replaceOnce(smoke,
`expect('non-404 initial failure keeps usable local content non-destructively',
  initialRead.includes('if (hasUsableLocalRide)')
    && initialRead.includes("root.dataset.refreshState = 'error'")
    && initialRead.includes('isPassengerRideRecoveryRetryable(err)')
    && initialRead.includes('schedulePassengerRideRecovery()')
    && initialRead.includes('PASSENGER_RIDE_READ_STATE.LOADED')
    && initialRead.includes('PASSENGER_RIDE_READ_STATE.ERROR'));
`,
`expect('non-404 initial failure keeps usable local content non-destructively',
  initialRead.includes('if (hasUsableLocalRide)')
    && initialRead.includes("root.dataset.refreshState = 'error'")
    && initialRead.includes('isPassengerRideRecoveryRetryable(err)')
    && initialRead.includes('schedulePassengerRideRecovery()')
    && initialRead.includes('PASSENGER_RIDE_READ_STATE.LOADED')
    && initialRead.includes('PASSENGER_RIDE_READ_STATE.ERROR'));
expect('retryable read failure preserves persisted server-write intent while permanent outcomes clear it',
  initialRead.includes('const retryable = isPassengerRideRecoveryRetryable(err)')
    && initialRead.includes('if (!retryable) backendWriteCandidate = false')
    && initialRead.includes('if (retryable && hasPersistedLocalRide) schedulePassengerRideRecovery()')
    && initialRead.includes('backendWriteCandidate = true'));
const cancelBinder = functionBody(passenger, 'bindCancelAffordance');
const sheetRenderer = functionBody(passenger, 'renderSheet');
expect('cancel and boarded PATCH writers use server-write intent instead of read-confirmed polling state',
  cancelBinder.includes('if (backendWriteCandidate && canceledRide')
    && cancelBinder.includes('patchRideStatus(ride.tripId, RIDE_STATUS.CANCELED)')
    && sheetRenderer.includes('if (backendWriteCandidate)')
    && sheetRenderer.includes('patchRideStatus(ride.tripId, RIDE_STATUS.IN_PROGRESS)'));
`,
'smoke write intent contract');

smoke = replaceOnce(smoke,
`expect('local fallback recovery retries the participant-gated GET without overlapping poll semantics',
  recovery.includes('setTimeout')
    && recovery.includes('runInitialRead(true)')
    && recovery.includes('PASSENGER_RIDE_POLL_MS'));
`,
`expect('local fallback recovery retries only persisted participant-gated rides without overlapping poll semantics',
  recovery.includes('!hasPersistedLocalRide')
    && recovery.includes('setTimeout')
    && recovery.includes('runInitialRead(true)')
    && recovery.includes('PASSENGER_RIDE_POLL_MS'));
`,
'smoke persisted recovery guard');

smoke = replaceOnce(smoke,
`expect('poll starts only after a successful server ride is identified',
  initialRead.indexOf('backendRide = true') < initialRead.indexOf('startPassengerRidePoll()'));
`,
`expect('poll starts only after a successful server ride is identified',
  initialRead.indexOf('backendRide = true') < initialRead.indexOf('startPassengerRidePoll()'));
expect('read-confirmed backendRide remains poll-only and distinct from writer intent',
  passenger.includes('let backendRide = false;')
    && passenger.includes('let backendWriteCandidate = backendRead && hasPersistedLocalRide')
    && !cancelBinder.includes('if (backendRide')
    && !sheetRenderer.includes('if (backendRide)'));
`,
'smoke poll/write separation');

smoke = replaceOnce(smoke,
`expect('service worker moves monotonically to v270',
  /const VERSION\\s*=\\s*'v270'/.test(sw));
`,
`expect('service worker moves monotonically to v271',
  /const VERSION\\s*=\\s*'v271'/.test(sw));
`,
'smoke sw v271');
write(smokePath, smoke);

const swPath = 'public/sw.js';
let sw = read(swPath);
sw = replaceOnce(sw,
`// v270 (BD-CLOUD-DESIGN-LOADING-02D third review repair #873): precached active_ride_passenger.js
// changed (bounded poll, honest 404 empty, retryable recovery filter, stable loading announcement).
const VERSION    = 'v270';
`,
`// v270 (BD-CLOUD-DESIGN-LOADING-02D third review repair #873): precached active_ride_passenger.js
// changed (bounded poll, honest 404 empty, retryable recovery filter, stable loading announcement).
// v271 (BD-CLOUD-DESIGN-LOADING-02D fourth review repair #873): precached active_ride_passenger.js
// changed (retryable read/write intent separation and built-in demo 404 fallback).
const VERSION    = 'v271';
`,
'sw v271');
write(swPath, sw);

console.log('Applied fourth 02D review repair with read/write recovery contract.');
