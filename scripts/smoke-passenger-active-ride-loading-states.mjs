// BD-CLOUD-DESIGN-LOADING-02D (#872) — Passenger Active Ride read-state guard.
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const passenger = read('../public/src/screens/active_ride_passenger.js');
const activeRide = read('../public/src/screens/active_ride.js');
const mockApi = read('../public/src/mock_api.js');
const css = read('../public/styles/cloud.css');
const sw = read('../public/sw.js');
const issues = [];

function expect(label, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label);
  if (!cond) issues.push(label);
}

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) return '';
  const open = source.indexOf('{', start);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return '';
}

for (const state of ['loading', 'loaded', 'empty', 'error']) {
  expect(`four-state model contains ${state}`, passenger.includes(`'${state}'`));
}
expect('fixture parser uses the canonical fixture query',
  /URLSearchParams[\s\S]{0,220}get\('fixture'\)/.test(passenger));
expect('outer passenger fixture gate skips persisted handoff lookup',
  activeRide.includes("const passengerFixture = query.get('fixture') || '';")
    && activeRide.includes("new Set(['loading', 'loaded', 'empty', 'error']).has(passengerFixture)")
    && activeRide.includes('|| (passengerFixtureMode ? null : findLatestHandedOffOrderTripId())'));
expect('fixture mode is selected before persisted passenger hydration',
  passenger.indexOf('createPassengerFixtureRide(tripId)') < passenger.indexOf('loadPassengerRideView(tripId, statusQuery)'));

const fixtureBody = functionBody(passenger, 'createPassengerFixtureRide');
expect('fixture helper resolved', fixtureBody.length > 0);
for (const forbidden of [
  'localStorage',
  'loadCanonicalActiveRide',
  'upgradeStoredActiveRideForOrder',
  'loadDriverHandoffSnapshot',
  'loadRideHistory',
  'saveRideHistoryEntry',
  'getRideFromBackend',
  'pollRide',
  'patchRideStatus',
]) {
  expect(`fixture helper does not use ${forbidden}`, !fixtureBody.includes(forbidden));
}
expect('backend read is explicitly gated out of fixture mode',
  /const\s+backendRead\s*=\s*!fixture\s*&&\s*isBackendEnabled\(\)/.test(passenger));
const usableSource = functionBody(passenger, 'hasUsablePassengerRideSource');
expect('persisted local fallback recognizes canonical and handoff sources',
  usableSource.includes('loadCanonicalActiveRide')
    && usableSource.includes('loadDriverHandoffSnapshot'));
expect('built-in demo is renderable fallback but remains UNCONFIRMED before backend settlement',
  passenger.includes('const hasPersistedLocalRide = !fixture && hasUsablePassengerRideSource(tripId)')
    && passenger.includes('const isBuiltInDemoRide = !fixture && tripId === DEMO_ACTIVE_RIDE_ID')
    && passenger.includes('const hasUsableLocalRide = hasPersistedLocalRide || isBuiltInDemoRide')
    && passenger.includes("UNCONFIRMED: 'unconfirmed'")
    && passenger.includes('let backendWriteCandidate = false'));
expect('fixture is exposed only as a render marker',
  /if\s*\(fixture\)\s*root\.dataset\.fixture\s*=\s*fixture/.test(passenger));
expect('aria-busy is scoped to replaceable ride-data panels',
  !passenger.includes("root.setAttribute('aria-busy'")
    && passenger.includes("topCard.setAttribute('aria-busy', busy)")
    && passenger.includes("sheet.setAttribute('aria-busy', busy)"));
const loadingSheet = functionBody(passenger, 'passengerRideLoadingSheetHtml');
const readStateSetter = functionBody(passenger, 'setReadState');
expect('loading announcement stays in the stable non-busy notice outside replaceable panels',
  passenger.includes("notice.setAttribute('role', 'status')")
    && !loadingSheet.includes('role="status"')
    && readStateSetter.includes("notice.dataset.readStatus = 'loading'")
    && readStateSetter.includes("notice.textContent = 'Загружаем поездку…'")
    && readStateSetter.includes('notice.hidden = false')
    && passenger.includes('active-ride-passenger__read-sheet-skeleton" aria-hidden="true"'));
expect('empty and error have accessible headings',
  passenger.includes('id="arp-read-empty-title"')
    && passenger.includes('id="arp-read-error-title"'));
expect('error retry is a real named button',
  passenger.includes('id="arp-read-retry"')
    && passenger.includes('aria-label="Повторить загрузку поездки"'));

const manager = functionBody(passenger, 'createPassengerRideReadManager');
expect('read manager owns AbortController', manager.includes('new AbortController()'));
expect('read manager aborts underlying read', manager.includes('controller.abort()'));
expect('read manager forwards AbortSignal', manager.includes('{ signal: controller.signal }'));
expect('initial ride timeout is 12 seconds',
  /PASSENGER_RIDE_READ_TIMEOUT_MS\s*=\s*12_000/.test(passenger));

const retry = functionBody(passenger, 'retryInitialRead');
expect('retry helper resolved', retry.length > 0);
expect('retry repeats only the initial read',
  retry.includes('runInitialRead()') && retry.includes('stopPassengerRidePoll()'));
for (const writer of [
  'patchRideStatus',
  'updateActiveRideStatus',
  'saveActiveRide',
  'updateTripStatus',
  'saveRideHistoryEntry',
]) {
  expect(`retry does not call writer ${writer}`, !retry.includes(writer));
}
expect('retry preserves focus on stable chrome before content replacement',
  retry.includes("top.querySelector('#arp-collapse')") && retry.includes('.focus()'));
expect('error fixture retry cycles through loading and back to error without backend reads',
  retry.includes('fixture !== PASSENGER_RIDE_READ_STATE.ERROR')
    && retry.includes('PASSENGER_RIDE_READ_STATE.LOADING')
    && retry.includes('PASSENGER_RIDE_READ_STATE.ERROR')
    && retry.includes('PASSENGER_RIDE_FIXTURE_RETRY_MS'));

const initialRead = functionBody(passenger, 'runInitialRead');
const ownershipSetter = functionBody(passenger, 'setPassengerRideOwnership');
const mutationGate = functionBody(passenger, 'syncPassengerMutationGate');
const mutationBlocked = functionBody(passenger, 'passengerMutationIsBlocked');
expect('ownership begins UNCONFIRMED under backend and settles only to SERVER_BACKED or LOCAL_ONLY',
  passenger.includes("UNCONFIRMED: 'unconfirmed'")
    && passenger.includes("SERVER_BACKED: 'server-backed'")
    && passenger.includes("LOCAL_ONLY: 'local-only'")
    && passenger.includes('let passengerRideOwnership = backendRead')
    && passenger.includes('let backendWriteCandidate = false')
    && ownershipSetter.includes('backendWriteCandidate = nextOwnership === PASSENGER_RIDE_OWNERSHIP.SERVER_BACKED')
    && initialRead.includes('setPassengerRideOwnership(PASSENGER_RIDE_OWNERSHIP.SERVER_BACKED)')
    && initialRead.includes('setPassengerRideOwnership(PASSENGER_RIDE_OWNERSHIP.LOCAL_ONLY)'));
expect('404/RIDE_NOT_FOUND settles local ownership while unknown IDs still render empty',
  initialRead.includes('err.status === 404')
    && initialRead.includes("err.code === 'RIDE_NOT_FOUND'")
    && initialRead.includes('setPassengerRideOwnership(PASSENGER_RIDE_OWNERSHIP.LOCAL_ONLY)')
    && initialRead.includes('setPassengerMutationBlocked(false)')
    && initialRead.includes('if (hasUsableLocalRide) renderLoadedRide(recovery)')
    && passenger.includes('const hasUsableLocalRide = hasPersistedLocalRide || isBuiltInDemoRide')
    && initialRead.includes('PASSENGER_RIDE_READ_STATE.EMPTY'));
const loadedRenderer = functionBody(passenger, 'renderLoadedRide');
const inPlaceRefresh = functionBody(passenger, 'refreshPassengerRideFieldsInPlace');
expect('usable local ride stays loaded while backend refresh starts without replacing its DOM',
  /backendRead\s*&&\s*!hasUsableLocalRide[\s\S]{0,120}PASSENGER_RIDE_READ_STATE\.LOADING/.test(passenger)
    && initialRead.includes("root.dataset.refreshState = 'loading'")
    && initialRead.includes('renderLoadedRide(true)')
    && loadedRenderer.includes('preserveDom && readState === PASSENGER_RIDE_READ_STATE.LOADED')
    && loadedRenderer.includes('refreshPassengerRideFieldsInPlace()')
    && loadedRenderer.includes('syncPassengerMutationGate()'));
expect('successful recovery refreshes mutable driver, route, fare and ETA fields in place',
  inPlaceRefresh.includes('.active-ride-passenger__driver-sub')
    && inPlaceRefresh.includes('.active-ride-passenger__route-main')
    && inPlaceRefresh.includes('.active-ride-passenger__payment-amount')
    && inPlaceRefresh.includes('.active-ride-passenger__top-card-eta-value')
    && inPlaceRefresh.includes('.active-ride-passenger__waiting-card-value')
    && !inPlaceRefresh.includes('innerHTML')
    && !inPlaceRefresh.includes('renderTopCard()')
    && !inPlaceRefresh.includes('renderSheet()'));
const mergeServer = functionBody(passenger, 'mergeServerRide');
expect('recovery merge preserves a locally-ahead lifecycle status while accepting display fields',
  passenger.includes('function mergeServerRide(srv, preserveLocallyAheadStatus = false)')
    && mergeServer.includes('const localRank = STATUS_RANK[ride.status] ?? 0')
    && mergeServer.includes('const serverRank = STATUS_RANK[serverStatus] ?? 0')
    && mergeServer.includes('preserveLocallyAheadStatus && localRank > serverRank')
    && mergeServer.includes('? ride.status')
    && initialRead.includes('ride = mergeServerRide(srv, recovery)'));
expect('server merge accepts all display sub-objects without clobbering local fallbacks',
  mergeServer.includes('vehicle: keep(ride.vehicle, srv.vehicle)')
    && mergeServer.includes('order: keep(ride.order, srv.order)')
    && mergeServer.includes('payment: keep(ride.payment, srv.payment)')
    && mergeServer.includes('waiting: keep(ride.waiting, srv.waiting)')
    && mergeServer.includes('ride: keep(ride.ride, srv.ride)')
    && mergeServer.includes('chat: keep(ride.chat, srv.chat)'));
expect('non-404 initial/recovery failure keeps usable local content non-destructively',
  initialRead.includes('if (hasUsableLocalRide)')
    && initialRead.includes("root.dataset.refreshState = 'error'")
    && initialRead.includes('isPassengerRideRecoveryRetryable(err)')
    && initialRead.includes('schedulePassengerRideRecovery()')
    && initialRead.includes('renderLoadedRide(recovery)')
    && initialRead.includes('PASSENGER_RIDE_READ_STATE.ERROR'));
expect('UNCONFIRMED blocks mutations until the first ownership settlement',
  mutationBlocked.includes('passengerRideOwnership === PASSENGER_RIDE_OWNERSHIP.UNCONFIRMED')
    && mutationBlocked.includes('ownershipPending || backendMutationBlocked')
    && mutationGate.includes("root.dataset.mutationState = ownershipPending ? 'ownership-unconfirmed' : 'server-blocked'")
    && mutationGate.includes("['#arp-cancel', '#arp-boarded']")
    && mutationGate.includes('button.disabled = blocked'));
expect('retryable failures preserve confirmed server ownership while permanent non-404 failures block mutations',
  initialRead.includes('const retryable = isPassengerRideRecoveryRetryable(err)')
    && initialRead.includes('const permanentFailure = !retryable')
    && initialRead.includes('if (permanentFailure && hasUsableLocalRide) setPassengerMutationBlocked(true)')
    && initialRead.includes('if (retryable && hasPersistedLocalRide) schedulePassengerRideRecovery()')
    && !initialRead.includes('if (permanentFailure) backendWriteCandidate = false'));
expect('successful/null/404 server settlement clears the permanent mutation block',
  initialRead.match(/setPassengerMutationBlocked\(false\)/g)?.length >= 3);
const remount = functionBody(passenger, 'maybeReMount');
const deferredFlush = functionBody(passenger, 'flushDeferredPassengerStatus');
expect('forward server status stays pending outside ride until an open overlay closes',
  passenger.includes('let deferredPassengerServerStatus = null')
    && remount.includes('deferredPassengerServerStatus = srvStatus')
    && remount.includes('PASSENGER_REMOUNT_RESULT.DEFERRED')
    && deferredFlush.includes('const pendingStatus = deferredPassengerServerStatus')
    && deferredFlush.includes('maybeReMount(pendingStatus)')
    && passenger.includes('flushDeferredPassengerStatus();'));
const terminalStatus = functionBody(passenger, 'isPassengerTerminalStatus');
const deferredTerminalGate = functionBody(passenger, 'syncDeferredTerminalCancelGate');
const review9CancelBinder = functionBody(passenger, 'bindCancelAffordance');
expect('deferred terminal status immediately blocks stale cancel confirmation before local writes',
  terminalStatus.includes('RIDE_STATUS.COMPLETED')
    && terminalStatus.includes('RIDE_STATUS.CANCELED')
    && terminalStatus.includes('RIDE_STATUS.NO_SHOW')
    && remount.includes('syncDeferredTerminalCancelGate()')
    && deferredTerminalGate.includes("['#arp-cancel-confirm', '#arp-cancel-confirm-yes']")
    && deferredTerminalGate.includes('button.disabled = true')
    && review9CancelBinder.includes('deferredTerminalPassengerStatusBlocksCancel()')
    && review9CancelBinder.indexOf('deferredTerminalPassengerStatusBlocksCancel()') < review9CancelBinder.indexOf('saveActiveRide(ride)'));
expect('deferred forward status keeps the highest pending lifecycle rank while overlays stay open',
  remount.includes('const pendingRank = STATUS_RANK[deferredPassengerServerStatus] ?? -1')
    && remount.includes('const nextRank = STATUS_RANK[srvStatus] ?? 0')
    && remount.includes('nextRank > pendingRank'));
expect('deferred recovery returns before merging server status into the current ride',
  initialRead.includes('remountResult === PASSENGER_REMOUNT_RESULT.DEFERRED')
    && initialRead.indexOf('remountResult === PASSENGER_REMOUNT_RESULT.DEFERRED') < initialRead.indexOf('ride = mergeServerRide(srv, recovery)')
    && initialRead.includes('startPassengerRidePoll()'));
expect('background recovery settlement preserves controls/focus and refreshes the map in place',
  initialRead.includes('renderLoadedRide(recovery)')
    && loadedRenderer.includes('refreshPassengerRideFieldsInPlace()')
    && loadedRenderer.includes('renderMapForReadState(PASSENGER_RIDE_READ_STATE.LOADED)')
    && loadedRenderer.indexOf('refreshPassengerRideFieldsInPlace()') < loadedRenderer.indexOf('renderMapForReadState(PASSENGER_RIDE_READ_STATE.LOADED)')
    && !loadedRenderer.includes('innerHTML')
    && !loadedRenderer.includes('renderTopCard()')
    && !loadedRenderer.includes('renderSheet()')
    && loadedRenderer.includes('setReadState(PASSENGER_RIDE_READ_STATE.LOADED)'));
const cancelBinder = functionBody(passenger, 'bindCancelAffordance');
const sheetRenderer = functionBody(passenger, 'renderSheet');
expect('cancel and boarded PATCH writers run only for confirmed SERVER_BACKED ownership',
  cancelBinder.includes('if (backendWriteCandidate && canceledRide')
    && cancelBinder.includes('patchRideStatus(ride.tripId, RIDE_STATUS.CANCELED)')
    && sheetRenderer.includes('if (backendWriteCandidate)')
    && sheetRenderer.includes('patchRideStatus(ride.tripId, RIDE_STATUS.IN_PROGRESS)')
    && ownershipSetter.includes('PASSENGER_RIDE_OWNERSHIP.SERVER_BACKED'));
expect('unconfirmed/permanent mutation guards return before any local status mutation',
  cancelBinder.indexOf('if (passengerMutationIsBlocked())') < cancelBinder.indexOf('saveActiveRide(ride)')
    && sheetRenderer.indexOf('if (passengerMutationIsBlocked())') < sheetRenderer.indexOf('updateActiveRideStatus(ride.tripId, RIDE_STATUS.IN_PROGRESS)'));
const retryability = functionBody(passenger, 'isPassengerRideRecoveryRetryable');
expect('automatic recovery excludes permanent authorization failures',
  retryability.includes('status === 401 || status === 403')
    && retryability.includes('return false')
    && retryability.includes("err.name === 'TimeoutError'")
    && retryability.includes('status === 408 || status === 429 || status >= 500'));
const recovery = functionBody(passenger, 'schedulePassengerRideRecovery');
expect('local fallback recovery retries only persisted participant-gated rides without overlapping poll semantics',
  recovery.includes('!hasPersistedLocalRide')
    && recovery.includes('setTimeout')
    && recovery.includes('runInitialRead(true)')
    && recovery.includes('PASSENGER_RIDE_POLL_MS'));
expect('poll starts only after a successful server ride is identified',
  initialRead.indexOf('backendRide = true') < initialRead.indexOf('startPassengerRidePoll()'));
expect('read-confirmed backendRide remains poll-only and distinct from ownership/write intent',
  passenger.includes('let backendRide = false;')
    && passenger.includes('let backendWriteCandidate = false;')
    && !cancelBinder.includes('if (backendRide')
    && !sheetRenderer.includes('if (backendRide)'));

const poll = functionBody(passenger, 'startPassengerRidePoll');
expect('poll cadence remains exactly 2.5 seconds',
  /PASSENGER_RIDE_POLL_MS\s*=\s*2_500/.test(passenger)
    && poll.includes('PASSENGER_RIDE_POLL_MS'));
expect('poll has a no-overlap busy guard',
  poll.includes('if (passengerPollBusy) return')
    && poll.includes('passengerPollBusy = true'));
expect('poll only stops for a navigated forward status and keeps deferred overlays recoverable',
  poll.includes('const remountResult = maybeReMount(res.status)')
    && poll.includes('remountResult === PASSENGER_REMOUNT_RESULT.NAVIGATED')
    && poll.includes('stopPassengerRidePoll()'));
expect('poll owns a cancellable AbortController',
  poll.includes('new AbortController()')
    && poll.includes('{ signal: controller.signal }'));
expect('each realtime poll has a bounded abort deadline and always releases the busy guard',
  /PASSENGER_RIDE_POLL_TIMEOUT_MS\s*=\s*12_000/.test(passenger)
    && poll.includes('setTimeout(() => controller.abort(), PASSENGER_RIDE_POLL_TIMEOUT_MS)')
    && poll.includes('clearTimeout(timeoutId)')
    && poll.includes('passengerPollBusy = false'));
expect('teardown aborts read, poll, recovery and fixture retry work',
  /readManager\.cancel\('passenger ride screen teardown'\)/.test(passenger)
    && /passengerPollController\) passengerPollController\.abort\(\)/.test(passenger)
    && passenger.includes('stopPassengerRideRecovery()')
    && passenger.includes('if (fixtureRetryId) clearTimeout(fixtureRetryId)'));
expect('route replacement + detached root are teardown signals',
  passenger.includes("window.addEventListener('hashchange', onHashChange)")
    && passenger.includes('new MutationObserver'));

expect('fixture cancel action is disabled/inert',
  /if\s*\(fixture\)\s*\{\s*cancelBtn\.disabled\s*=\s*true/.test(passenger));
expect('fixture boarded action is disabled/inert',
  /if\s*\(boardedBtn\s*&&\s*fixture\)\s*\{\s*boardedBtn\.disabled\s*=\s*true/.test(passenger));
const commonBindings = functionBody(passenger, 'bindCommonSheetHandlers');
expect('fixture bottom-sheet safety path is disabled before safety/chat handoff',
  commonBindings.includes('if (sosBtn && fixture)')
    && commonBindings.includes('sosBtn.disabled = true'));
const mapRender = functionBody(passenger, 'renderMapForReadState');
expect('loading, empty and error states keep the map shell but remove synthetic ride data',
  mapRender.includes('const hasRideData = nextState === PASSENGER_RIDE_READ_STATE.LOADED')
    && mapRender.includes('showRoute: hasRideData')
    && mapRender.includes('showCar: hasRideData')
    && mapRender.includes('showPickup: hasRideData')
    && mapRender.includes('showDropoff: hasRideData')
    && mapRender.includes('showLabels: hasRideData'));

expect('ride GET accepts and forwards an optional signal',
  /getRideFromBackend\(tripId,\s*\{\s*signal\s*\}\s*=\s*\{\}\)/.test(mockApi)
    && /ride-state\/rides\/\$\{encodeURIComponent\(tripId\)\}`\,\s*\{\s*signal\s*\}/.test(mockApi));
expect('realtime poll accepts and forwards an optional signal',
  /pollRide\(tripId,\s*since,\s*\{\s*signal\s*\}\s*=\s*\{\}\)/.test(mockApi)
    && /apiFetch\(`\/realtime\/poll\$\{qs\}`\,\s*\{\s*signal\s*\}\)/.test(mockApi));

expect('skeleton shimmer is reduced-motion safe',
  css.includes('@media (prefers-reduced-motion: no-preference)')
    && css.includes('.active-ride-passenger__read-bone::after'));
expect('Passenger Active Ride map shell code is untouched by request helper vocabulary',
  !fixtureBody.includes('createMapShell') && !manager.includes('createMapShell'));

expect('service worker moves monotonically to v276',
  /const VERSION\s*=\s*'v276'/.test(sw));

if (issues.length) {
  console.error(`\n${issues.length} 02D regression(s) failed.`);
  process.exit(1);
}
console.log('\nPassenger Active Ride loading-state smoke passed.');
