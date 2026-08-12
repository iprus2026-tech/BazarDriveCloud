// BD-CLOUD-DESIGN-LOADING-02E (#876) — Driver Active Ride read-state guard.
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const activeRide = read('../public/src/screens/active_ride.js');
const mockApi = read('../public/src/mock_api.js');
const css = read('../public/styles/cloud.css');
const sw = read('../public/sw.js');
const issues = [];

function expect(label, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label);
  if (!cond) issues.push(label);
}

function between(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  if (start === -1) return '';
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return end === -1 ? source.slice(start) : source.slice(start, end);
}

for (const state of ['loading', 'loaded', 'empty', 'error']) {
  expect(`driver four-state model contains ${state}`, activeRide.includes(`'${state}'`));
}
expect('driver fixture is parsed from canonical fixture query',
  activeRide.includes("const fixtureValue = (query.get('fixture') || '').toLowerCase()")
    && activeRide.includes('DRIVER_RIDE_FIXTURES.has(fixtureValue)'));
expect('recognized fixture seeds trip identity before persisted driver handoff lookup',
  activeRide.includes('const rawTripId = rawTripIdParam || (driverFixtureMode ? DEMO_ACTIVE_RIDE_ID : null)')
    && activeRide.indexOf('const rawTripId = rawTripIdParam')
      < activeRide.indexOf('const latestHandedOffTripId = rawTripId ? null : findLatestHandedOffOrderTripId()'));
expect('fixture ride is selected before canonical driver hydration',
  activeRide.indexOf('? createDriverFixtureRide(tripId)') < activeRide.indexOf(": loadCanonicalActiveRide({ tripId, role: 'driver' })"));

const fixtureHelper = between(activeRide, 'function createDriverFixtureRide', 'function isExpectedDriverLocalRideMiss');
expect('fixture helper resolved', fixtureHelper.length > 0);
for (const forbidden of [
  'localStorage', 'loadCanonicalActiveRide', 'loadDriverHandoffSnapshot', 'findLatestHandedOffOrderTripId',
  'getRideFromBackend', 'pollRide', 'patchRideStatus', 'saveDriverReceipt', 'saveRideHistoryEntry',
]) {
  expect(`fixture helper does not use ${forbidden}`, !fixtureHelper.includes(forbidden));
}
expect('backend read is explicitly gated out of driver fixture mode',
  activeRide.includes('const backendRead = !driverFixtureMode && isBackendEnabled()'));
expect('fixture mode is exposed only as a render marker after synthetic hydration',
  activeRide.includes('if (driverFixtureMode) root.dataset.fixture = driverFixture'));

expect('driver request state uses dedicated ownership distinct from earnings state',
  activeRide.includes('let driverReadState = driverFixture')
    && activeRide.includes("const earningsState = query.get('state')")
    && activeRide.includes("const fixtureValue = (query.get('fixture') || '').toLowerCase()"));
expect('aria-busy is scoped to the replaceable driver ride sheet only',
  !activeRide.includes("root.setAttribute('aria-busy'")
    && activeRide.includes("sheet.setAttribute('aria-busy', driverReadState === DRIVER_RIDE_READ_STATE.LOADING ? 'true' : 'false')")
    && activeRide.includes("sheet.setAttribute('aria-busy', nextState === DRIVER_RIDE_READ_STATE.LOADING ? 'true' : 'false')"));

const loadingView = between(activeRide, 'function renderDriverReadLoading', 'function renderDriverReadEmpty');
expect('loading skeleton is decorative and has one polite announcement outside it',
  loadingView.includes('aria-hidden="true"')
    && loadingView.includes('role="status" aria-live="polite"')
    && loadingView.includes('Загружаем данные поездки…'));
for (const forbidden of ['Анна П.', 'Тверская', '1 240 ₽', 'ar-start', 'ar-finish', 'ar-cancel', 'ar-no-show']) {
  expect(`loading view contains no pseudo-data/action ${forbidden}`, !loadingView.includes(forbidden));
}
expect('loading hides route-specific map data without rebuilding the map shell',
  activeRide.includes('function setDriverMapReadVisibility')
    && loadingView.includes('setDriverMapReadVisibility(false)')
    && activeRide.includes('const mapShell = createMapShell')
    && !loadingView.includes('createMapShell('));

const errorView = between(activeRide, 'function renderDriverReadError', 'function setDriverReadState');
const emptyView = between(activeRide, 'function renderDriverReadEmpty', 'function renderDriverReadError');
expect('empty/error also preserve the existing map shell instance',
  emptyView.includes('setDriverMapReadVisibility(false)')
    && errorView.includes('setDriverMapReadVisibility(false)')
    && !emptyView.includes('createMapShell(')
    && !errorView.includes('createMapShell('));
expect('error has accessible heading and unambiguous neutral retry',
  errorView.includes('id="ar-driver-read-error-title"')
    && errorView.includes('class="bd-btn ghost" id="ar-driver-read-retry"')
    && errorView.includes('aria-label="Повторить загрузку поездки"'));
expect('empty has accessible heading and one safe next action',
  activeRide.includes('id="ar-driver-read-empty-title"')
    && activeRide.includes('id="ar-driver-read-empty-action"'));

const manager = between(activeRide, 'function createDriverRideReadManager', 'export function parseMoney');
expect('initial read manager owns AbortController and aborts stale work',
  manager.includes('new AbortController()') && manager.includes('controller.abort()'));
expect('initial read manager has bounded 12s timeout',
  activeRide.includes('const DRIVER_RIDE_READ_TIMEOUT_MS = 12_000')
    && manager.includes('DRIVER_RIDE_READ_TIMEOUT_MS'));
expect('ride GET receives the operation signal',
  activeRide.includes('(signal) => getRideFromBackend(ride.tripId, { signal })'));
expect('existing ride GET adapter accepts optional AbortSignal',
  /getRideFromBackend\(tripId,\s*\{\s*signal\s*\}\s*=\s*\{\}\)/.test(mockApi));

const initialRead = between(activeRide, 'async function runInitialDriverRead', 'function retryInitialDriverRead');
expect('initial read renders loading before requesting authority',
  initialRead.indexOf('DRIVER_RIDE_READ_STATE.LOADING') < initialRead.indexOf('initialReadManager.run()'));
expect('server success settles loaded and only then starts poll',
  initialRead.includes('backendRide = true')
    && initialRead.includes('ride = mergeServerRide(result.value)')
    && initialRead.includes('setDriverReadState(DRIVER_RIDE_READ_STATE.LOADED)')
    && initialRead.indexOf('setDriverReadState(DRIVER_RIDE_READ_STATE.LOADED)') < initialRead.indexOf('startRidePoll()'));
expect('404/RIDE_NOT_FOUND preserves current local-only fallback without poll',
  activeRide.includes("err.status === 404 || err.code === 'RIDE_NOT_FOUND'")
    && initialRead.includes('backendRide = false')
    && initialRead.includes('ride = safeApplyStatusFromQuery(ride, effectiveStatusQuery)')
    && initialRead.includes('DRIVER_RIDE_READ_STATE.LOADED'));
expect('non-404 failure settles honest recoverable error',
  initialRead.includes('setDriverReadState(DRIVER_RIDE_READ_STATE.ERROR)'));

const retry = between(
  activeRide,
  'function retryInitialDriverRead',
  "\n\n  if (driverFixtureMode) {\n    setDriverReadState(driverFixture);",
);
expect('retry moves focus to stable chrome before replacing the error button',
  retry.includes("top.querySelector('#ar-gear')") && retry.includes('stableFocus.focus({ preventScroll: true })'));
expect('fixture retry is deterministic and network-free',
  retry.includes('DRIVER_RIDE_READ_STATE.LOADING')
    && retry.includes('DRIVER_RIDE_READ_STATE.ERROR')
    && retry.includes('DRIVER_RIDE_FIXTURE_RETRY_MS'));
for (const writer of ['patchRideStatus', 'updateActiveRideStatus', 'saveActiveRide', 'saveDriverReceipt', 'saveRideHistoryEntry']) {
  expect(`retry does not call writer ${writer}`, !retry.includes(writer));
}

const pollOnce = between(activeRide, 'async function pollRideOnce', 'function startRidePoll');
const startPoll = between(activeRide, 'function startRidePoll', 'function persistDriverRideStatus');
expect('background poll has explicit single in-flight guard',
  pollOnce.includes('if (ridePollInFlight') && pollOnce.includes('ridePollInFlight = true'));
expect('background poll forwards AbortSignal and uses bounded timeout',
  pollOnce.includes('pollRide(ride.tripId, rideCursor, { signal: controller.signal })')
    && pollOnce.includes('DRIVER_RIDE_POLL_TIMEOUT_MS'));
expect('poll refresh keeps loaded content and never returns to initial skeleton',
  pollOnce.includes('renderSheet(true)')
    && !pollOnce.includes('DRIVER_RIDE_READ_STATE.LOADING'));
expect('poll cadence remains 2.5 seconds and fixture mode cannot start it',
  activeRide.includes('const DRIVER_RIDE_POLL_MS = 2_500')
    && startPoll.includes('driverFixtureMode')
    && startPoll.includes('setInterval'));
expect('teardown clears interval and aborts in-flight poll/refetch/read',
  activeRide.includes('function stopRidePoll()')
    && activeRide.includes('ridePollController.abort()')
    && activeRide.includes('initialReadManager.cancel()')
    && activeRide.includes('clearRideRefetch()'));

const lockFixture = between(activeRide, 'function lockFixtureActions', 'function renderSheet');
expect('loaded fixture makes every ride-sheet action inert',
  lockFixture.includes("sheet.querySelectorAll('button')")
    && lockFixture.includes('button.disabled = true')
    && lockFixture.includes("button.setAttribute('aria-disabled', 'true')"));
expect('waiting/no-show/completion renderers are reachable only through loaded domain render',
  activeRide.includes("else if (ride.status === RIDE_STATUS.WAITING_PASSENGER) renderWaiting()")
    && activeRide.includes("else if (ride.status === RIDE_STATUS.COMPLETED) renderCompleted()")
    && !loadingView.includes('renderWaiting')
    && !errorView.includes('renderCompleted'));

expect('02D reduced-motion skeleton visual primitive remains available for driver reuse',
  css.includes('@media (prefers-reduced-motion: no-preference)')
    && css.includes('.active-ride-passenger__read-bone::after'));
expect('service worker bumps monotonically for precached active_ride.js',
  /const VERSION\s*=\s*'v279'/.test(sw)
    && sw.includes('BD-CLOUD-DESIGN-LOADING-02E'));
expect('realtime poll adapter already accepts optional AbortSignal',
  /pollRide\(tripId,\s*since,\s*\{\s*signal\s*\}\s*=\s*\{\}\)/.test(mockApi));

if (issues.length) {
  console.error(`\n${issues.length} Driver Active Ride loading-state smoke assertion(s) failed.`);
  for (const issue of issues) console.error(`  - ${issue}`);
  process.exit(1);
}
console.log('\nDriver Active Ride loading-state smoke PASS.');
