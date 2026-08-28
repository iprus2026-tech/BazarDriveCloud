// BD-RIDE-SELECTED-RESPONSE-IDENTITY-01B — /responses select-click identity
// gate guard.
//
// responses.js's click handler used to resolve the clicked driver via
// `drivers.find((d) => d.id === driverId) || selectedDriver || drivers[0]` —
// a silent fallback that could substitute a completely different driver when
// the in-memory `drivers` array had been reassigned (loadServerOffers(),
// refreshBoard()) since the clicked card was rendered. buildPassengerActiveRide
// also reused any existing active ride for an order unconditionally, without
// checking it was pinned to the driver actually being selected right now, and
// the click handler's backend branch fell through to an unconditional
// trip_<orderId> navigation even when the local bridge failed — including a
// TOCTOU window where local state could change while `await
// selectOfferOnBackend` was in flight. The MOCK_DRIVERS fallback in
// buildDriversForOrder also could not distinguish the canonical Inbox
// demo-order (which legitimately uses MOCK_DRIVERS) from an ordinary real
// order that simply has zero responses yet.
//
// The full identity-gate + accept/build/navigate decision now lives in ONE
// exported orchestration, runSelectDriverOrchestration, which the real click
// handler calls directly — so this smoke drives the exact same code the
// handler runs (side effects injected as spies), not a parallel test-only
// reimplementation, per this review round's explicit requirement. The
// smaller pure helpers it composes (resolveClickedDriver,
// isValidLocalResponseForOrder, isExistingRideCompatibleWithSelection,
// isCanonicalDemoOrder, isRequestBackendAuthoritative, buildDriversForOrder,
// buildPassengerActiveRide) are still exported and independently tested too.
// No DOM, no jsdom, matching this codebase's established behavioral-smoke
// convention (see smoke-chat-ride-confirm-behavioral.mjs).
// Positive cases P1-P4 and negative cases N1-N11 map to the correction
// audit; orchestration spy cases A-H map to this round's TOCTOU follow-up.

const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { _store.delete(k); },
  clear: () => { _store.clear(); },
};

const root = new URL('../public/src/', import.meta.url);
const responses = await import(new URL('screens/responses.js', root).href);
const mockApi = await import(new URL('mock_api.js', root).href);
const rideState = await import(new URL('ride_state.js', root).href);

import fs from 'node:fs';
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const responsesSrc = read('../public/src/screens/responses.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

const RESPONSES_KEY = 'bazardrive.responses.v1';
const ACTIVE_RIDE_KEY = 'bazardrive.active_ride.v1';
const RIDE_ORDERS_KEY = 'bazardrive.ride_orders.v1';

function resetStorage() { localStorage.clear(); }

function writeResponse(response) {
  const map = JSON.parse(localStorage.getItem(RESPONSES_KEY) || '{}');
  map[response.id] = response;
  localStorage.setItem(RESPONSES_KEY, JSON.stringify(map));
}

// Spy factories: record every call's arguments and expose a `.count`.
// `makeSpy` for synchronous deps (navigate, buildPassengerActiveRide);
// `makeAsyncSpy` for the awaited selectOfferOnBackend.
function makeSpy(impl) {
  const calls = [];
  const fn = (...args) => { calls.push(args); return impl ? impl(...args) : undefined; };
  fn.calls = calls;
  Object.defineProperty(fn, 'count', { get: () => calls.length });
  return fn;
}
function makeAsyncSpy(impl) {
  const calls = [];
  const fn = async (...args) => { calls.push(args); return impl ? await impl(...args) : undefined; };
  fn.calls = calls;
  Object.defineProperty(fn, 'count', { get: () => calls.length });
  return fn;
}

// Extract a function body by name via brace matching (same pattern as the
// other responses.js/ride_actions.js smokes in this repo). Correctly skips
// a multi-line, nested-default-value parameter list (paren-depth counted,
// independent of the brace depth used for the body itself).
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) return null;
  const paren = source.indexOf('(', start);
  if (paren === -1) return null;
  let pdepth = 0;
  let afterParams = -1;
  for (let i = paren; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') pdepth++;
    else if (ch === ')') { pdepth--; if (pdepth === 0) { afterParams = i + 1; break; } }
  }
  if (afterParams === -1) return null;
  const open = source.indexOf('{', afterParams);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return source.slice(open, i + 1); }
  }
  return null;
}
function blockAfter(source, marker) {
  const idx = source.indexOf(marker);
  if (idx === -1) return null;
  const open = source.indexOf('{', idx);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return source.slice(open, i + 1); }
  }
  return null;
}
// Strip comments before scanning for forbidden tokens so this file's own
// explanatory comments (which name the forbidden patterns for a human
// reader) cannot false-fail a guard. Positive/ordering checks use the raw
// body (comments don't affect substring/index checks on real code tokens).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// ── A. Structural: the pure helpers exist and are exported ─────────────
expect('responses.js exports resolveClickedDriver', typeof responses.resolveClickedDriver === 'function');
expect('responses.js exports isValidLocalResponseForOrder', typeof responses.isValidLocalResponseForOrder === 'function');
expect('responses.js exports isCanonicalDemoOrder', typeof responses.isCanonicalDemoOrder === 'function');
expect('responses.js exports buildDriversForOrder', typeof responses.buildDriversForOrder === 'function');
expect('responses.js exports isExistingRideCompatibleWithSelection', typeof responses.isExistingRideCompatibleWithSelection === 'function');
expect('responses.js exports isRequestBackendAuthoritative', typeof responses.isRequestBackendAuthoritative === 'function');
expect('responses.js exports runSelectDriverOrchestration', typeof responses.runSelectDriverOrchestration === 'function');

const resolveClickedDriverBody = functionBody(responsesSrc, 'resolveClickedDriver') || '';
expect('resolveClickedDriver() body resolved', resolveClickedDriverBody.length > 0);
expect('resolveClickedDriver never references selectedDriver (N7: no silent selected-driver substitution)',
  !/selectedDriver/.test(resolveClickedDriverBody));
expect('resolveClickedDriver never indexes drivers[0] (N8: no first-card substitution)',
  !/\bdrivers\[0\]/.test(resolveClickedDriverBody));

// ── B. Structural regression guards: unchanged invariants ──────────────
expect('click handler still ignores a second click while selecting is in flight (in-flight latch preserved)',
  /if\s*\(\s*selecting\s*\)\s*return;/.test(responsesSrc));
expect('fixture cards are still fully blocked before any identity/side-effect logic (P4, unchanged)',
  /if\s*\(fixture\s*&&\s*\(action\s*===\s*'select'/.test(responsesSrc));

// ── B1. Structural: the real click handler calls the real orchestration ──
//        (not a copy). This is the seam that lets everything below drive
//        the SAME code the handler runs, with spy-able side effects.
const selectActionBody = blockAfter(responsesSrc, "if (action === 'select' || action === 'continue') {") || '';
expect('select/continue click-handler body resolved', selectActionBody.length > 0);
expect('the click handler calls runSelectDriverOrchestration(…) — the real orchestration is wired in, not reimplemented inline',
  /runSelectDriverOrchestration\(/.test(selectActionBody));
expect('the click handler passes showToast: toast (the closure-local render fn) into the orchestration',
  /showToast\s*:\s*toast/.test(selectActionBody));

// ── B2. Structural: runSelectDriverOrchestration's OWN body wires the
//        identity gate, the PRE-API preflight, the POST-API TOCTOU recheck,
//        and the null-handoff fail-closed path — read from the real source,
//        not asserted only as pure-function behavior. A pure-function-only
//        test cannot catch a regression that removes a call from this
//        function, or reorders it around the API call; this section can. ──
const orchestrationBody = functionBody(responsesSrc, 'runSelectDriverOrchestration') || '';
const orchestrationCode = stripComments(orchestrationBody);
expect('runSelectDriverOrchestration() body resolved', orchestrationBody.length > 0);
expect('the orchestration calls resolveClickedDriverFn(drivers, driverId, responseId)',
  /resolveClickedDriverFn\(\s*drivers\s*,\s*driverId\s*,\s*responseId\s*\)/.test(orchestrationBody));
expect('the orchestration never references selectedDriver as a fallback (regression guard)',
  !/selectedDriver/.test(orchestrationCode));
expect('the orchestration never indexes drivers[0] as a fallback (regression guard)',
  !/drivers\[0\]/.test(orchestrationCode));
expect('the orchestration calls isValidLocalResponseForOrderFn(responseId, request.orderId)',
  /isValidLocalResponseForOrderFn\(\s*responseId\s*,\s*request\.orderId\s*\)/.test(orchestrationBody));

{
  const iLocalValidator = orchestrationBody.indexOf('isValidLocalResponseForOrderFn(');
  const iSelectCall = orchestrationBody.indexOf('await selectOfferOnBackend(');
  const iFirstBuild = orchestrationBody.indexOf('buildPassengerActiveRide(');
  expect('the local validator runs before selectOfferOnBackend (ordering)',
    iLocalValidator !== -1 && iSelectCall !== -1 && iLocalValidator < iSelectCall);
  expect('the local validator runs before buildPassengerActiveRide is ever called (ordering)',
    iLocalValidator !== -1 && iFirstBuild !== -1 && iLocalValidator < iFirstBuild);
}

// PRE-API preflight: exactly one occurrence of isExistingRideCompatibleWithSelectionFn(
// before the API call — the POST-API recheck (checked next) is the second occurrence.
expect('the orchestration calls isExistingRideCompatibleWithSelectionFn at least twice (PRE-API preflight + POST-API TOCTOU recheck)',
  (orchestrationBody.match(/isExistingRideCompatibleWithSelectionFn\(/g) || []).length >= 2);
{
  const iPreflight = orchestrationBody.indexOf('isExistingRideCompatibleWithSelectionFn(');
  const iSelectCall = orchestrationBody.indexOf('await selectOfferOnBackend(');
  const iFirstBuild = orchestrationBody.indexOf('buildPassengerActiveRide(');
  expect('the PRE-API preflight (first occurrence) runs before await selectOfferOnBackend',
    iPreflight !== -1 && iSelectCall !== -1 && iPreflight < iSelectCall,
    `iPreflight=${iPreflight} iSelectCall=${iSelectCall}`);
  expect('the PRE-API preflight (first occurrence) runs before buildPassengerActiveRide is ever called',
    iPreflight !== -1 && iFirstBuild !== -1 && iPreflight < iFirstBuild,
    `iPreflight=${iPreflight} iFirstBuild=${iFirstBuild}`);

  // POST-API TOCTOU recheck: the SECOND occurrence of the compatibility
  // check must sit strictly between the API call and the first build call —
  // proving state is re-verified after the await settles, not only before it.
  const iSelectEnd = iSelectCall === -1 ? -1 : iSelectCall + 'await selectOfferOnBackend('.length;
  const iPostRecheck = iSelectEnd === -1 ? -1 : orchestrationBody.indexOf('isExistingRideCompatibleWithSelectionFn(', iSelectEnd);
  expect('a SECOND existing-ride recheck runs strictly after await selectOfferOnBackend settles (TOCTOU close)',
    iPostRecheck !== -1 && iSelectCall !== -1 && iPostRecheck > iSelectCall,
    `iPostRecheck=${iPostRecheck} iSelectCall=${iSelectCall}`);
  expect('the POST-API recheck runs before buildPassengerActiveRide is called for the same-device bridge',
    iPostRecheck !== -1 && iFirstBuild !== -1 && iPostRecheck < iFirstBuild,
    `iPostRecheck=${iPostRecheck} iFirstBuild=${iFirstBuild}`);
}

// Null-handoff fail-closed: the canonicalOrder sub-block must explicitly
// handle a null handoff (fail closed) rather than only handling the
// truthy case and falling through to the deterministic trip_<orderId>
// navigate call below it.
{
  const canonicalBlock = blockAfter(orchestrationBody, 'if (canonicalOrder) {') || '';
  expect('the canonicalOrder sub-block explicitly checks for a null/falsy handoff', /if\s*\(\s*!handoff\s*\)\s*\{/.test(canonicalBlock));
  const iNullCheck = canonicalBlock.indexOf('if (!handoff)');
  const iNavigateInBlock = canonicalBlock.indexOf('navigate(handoff.tripId)');
  expect('the null-handoff branch is reachable before the success navigate call (ordering, not just presence)',
    iNullCheck !== -1 && iNavigateInBlock !== -1 && iNullCheck < iNavigateInBlock);
  // The old bug: `if (handoff) { go(...); return; }` with NO else/fail-closed
  // branch, so control fell through past the closing brace to an
  // unconditional navigate() below. Guard: the canonicalOrder sub-block
  // itself must contain a `return` for BOTH the null and the success path
  // (two `return` statements: fail-closed's and navigate's), not just one.
  const returnCount = (canonicalBlock.match(/\breturn\b/g) || []).length;
  expect('the canonicalOrder sub-block returns on BOTH the null-handoff path and the success path (no shared fallthrough)',
    returnCount >= 2, `returnCount=${returnCount}`);
}

// ── B2b. Behavioral: initial LOCAL readState/effectiveState reconciliation
//        (P2 review follow-up). The P1 fix made buildDriversForOrder return a
//        genuinely empty board for a resolved, non-demo real order with zero
//        local responses — but the FIRST synchronous render used to leave
//        readState='loaded' and effectiveState=requestedState untouched, so
//        state=list rendered an empty board under a header that still said
//        "Есть отклики," and state=selected fired the unrelated
//        missing-selection announcement. Extracted and EXECUTED as real code
//        (new Function), not asserted only via regex, so a regression that
//        drops or reorders this reconciliation is actually caught, not just
//        pattern-matched. ──
function sliceRange(source, startMarker, endMarker) {
  const from = source.indexOf(startMarker);
  if (from === -1) return '';
  const to = source.indexOf(endMarker, from);
  return to > from ? source.slice(from, to) : '';
}
const initialReconcileSrc = sliceRange(
  responsesSrc,
  "if (readState === 'loaded' && !isAccepted && !fixture && !backendAuthoritative) {",
  'function headerStatus()',
);
expect('initial LOCAL readState/effectiveState reconciliation block resolved', initialReconcileSrc.length > 0);

function makeInitialStateHarness() {
  const loadedDomainStateBody = functionBody(responsesSrc, 'loadedDomainState') || '';
  const reconcileDriverStateBody = functionBody(responsesSrc, 'reconcileDriverState') || '';
  return new Function('isAccepted', 'fixture', 'backendAuthoritative', 'requestedState', 'drivers', 'isAllDeclined', 'getRouteParam', `
    let readState = isAccepted ? 'loaded' : (fixture || (backendAuthoritative ? 'loading' : 'loaded'));
    let effectiveState = isAccepted ? 'accepted' : requestedState;
    let selectedDriver = null;
    let selectedDriverId = null;
    const declined = new Set();
    let declinedSeeded = false;
    function loadedDomainState() ${loadedDomainStateBody}
    function reconcileDriverState() ${reconcileDriverStateBody}
    ${initialReconcileSrc}
    return { readState, effectiveState, selectedDriver, selectedDriverId };
  `);
}

{
  const runInitialState = makeInitialStateHarness();
  const noRouteParam = () => null;

  // state=list, zero drivers — the exact route Codex flagged:
  // /responses?orderId=…&state=list
  const listEmpty = runInitialState(false, '', false, 'list', [], false, noRouteParam);
  expect('P2 fix: state=list with zero local drivers reconciles readState to empty',
    listEmpty.readState === 'empty', `readState=${listEmpty.readState}`);
  expect('P2 fix: state=list with zero local drivers reconciles effectiveState to empty (header/board agree)',
    listEmpty.effectiveState === 'empty', `effectiveState=${listEmpty.effectiveState}`);

  // state=selected, zero drivers — must NOT stay 'loaded', which would fire
  // the missing-selection announcement over a board that can never resolve it
  const selectedEmpty = runInitialState(false, '', false, 'selected', [], false, noRouteParam);
  expect('P2 fix: state=selected with zero local drivers reconciles readState to empty',
    selectedEmpty.readState === 'empty', `readState=${selectedEmpty.readState}`);
  expect('P2 fix: state=selected with zero local drivers reconciles effectiveState to empty',
    selectedEmpty.effectiveState === 'empty', `effectiveState=${selectedEmpty.effectiveState}`);
  expect('P2 fix: readState=empty means the missing-selection announcement guard (readState === "loaded") cannot fire',
    selectedEmpty.readState !== 'loaded');

  // Regression safety: the SAME two states with a real driver present are
  // completely unaffected — readState stays loaded, effectiveState mirrors
  // the requested state exactly as before this fix.
  const oneDriver = [{ id: 'resp_a', responseId: 'resp_a' }];
  const listNonEmpty = runInitialState(false, '', false, 'list', oneDriver, false, noRouteParam);
  expect('regression safety: state=list with a real driver still resolves readState=loaded',
    listNonEmpty.readState === 'loaded', `readState=${listNonEmpty.readState}`);
  expect('regression safety: state=list with a real driver keeps effectiveState=list unchanged',
    listNonEmpty.effectiveState === 'list', `effectiveState=${listNonEmpty.effectiveState}`);

  const selectedNonEmpty = runInitialState(false, '', false, 'selected', oneDriver, false, noRouteParam);
  expect('regression safety: state=selected with a real driver still resolves readState=loaded',
    selectedNonEmpty.readState === 'loaded', `readState=${selectedNonEmpty.readState}`);
  expect('regression safety: state=selected with a real driver keeps effectiveState=selected unchanged',
    selectedNonEmpty.effectiveState === 'selected', `effectiveState=${selectedNonEmpty.effectiveState}`);

  // Regression safety: the fixture and backend-authoritative-loading paths
  // are untouched by this reconciliation.
  const fixtureLoaded = runInitialState(false, 'loaded', false, 'list', [], false, noRouteParam);
  expect('regression safety: fixture="loaded" path is untouched by the local-mode reconciliation',
    fixtureLoaded.readState === 'loaded', `readState=${fixtureLoaded.readState}`);
  const backendLoading = runInitialState(false, '', true, 'list', [], false, noRouteParam);
  expect('regression safety: backend-authoritative path still starts at loading (async loader owns its own reconciliation)',
    backendLoading.readState === 'loading', `readState=${backendLoading.readState}`);
}

// ── B3. Behavioral: canonical Inbox demo-order is never backend-authoritative,
//        even when the backend is globally enabled (P1 fix) ────────────────
function withBackend(base, fn) {
  const prior = globalThis.__BD_API_BASE__;
  globalThis.__BD_API_BASE__ = base;
  try { return fn(); } finally { globalThis.__BD_API_BASE__ = prior; }
}
{
  resetStorage();
  const demoOrderForBackendCheck = mockApi.ensureDemoResponseOrder();
  const demoReq = responses.requestFromOrder(demoOrderForBackendCheck);
  expect('demo request fixture carries isDemoOrder:true', demoReq.isDemoOrder === true);
  const demoAuthOn = withBackend('https://fake.test', () => responses.isRequestBackendAuthoritative(demoReq, ''));
  expect('P1 fix: canonical Inbox demo-order is NEVER backend-authoritative, even with the backend globally enabled',
    demoAuthOn === false);

  const realOrderForBackendCheck = await mockApi.createRideOrder({
    pickup: { label: 'ул. Настоящая, 1' },
    dropoff: { label: 'ул. Серверная, 2' },
    estimatedPrice: 1100,
    passenger: { name: 'Серверный Пассажир', authorId: 'user_backend_1', isCurrentUser: true },
  });
  const realReq = responses.requestFromOrder(mockApi.getOrderById(realOrderForBackendCheck.id));
  expect('real (non-demo) request fixture carries isDemoOrder:false', realReq.isDemoOrder === false);
  const realAuthOn = withBackend('https://fake.test', () => responses.isRequestBackendAuthoritative(realReq, ''));
  expect('a real local/cross-device order keeps the exact prior backend-authoritative rule (true when backend is on)',
    realAuthOn === true);
  const realAuthOff = withBackend('', () => responses.isRequestBackendAuthoritative(realReq, ''));
  expect('the same real order is not backend-authoritative when the backend is off (unchanged rule)',
    realAuthOff === false);

  const fixtureAuthOn = withBackend('https://fake.test', () => responses.isRequestBackendAuthoritative(realReq, 'loaded'));
  expect('a fixture preview is never backend-authoritative regardless of the backend flag (P4, unchanged)',
    fixtureAuthOn === false);
}

// ── B4. Behavioral: the existing-ride identity PREFLIGHT itself (pure fn).
expect('responses.js exports isExistingRideCompatibleWithSelection', typeof responses.isExistingRideCompatibleWithSelection === 'function');
{
  resetStorage();
  const pfOrder = await mockApi.createRideOrder({
    pickup: { label: 'ул. Префлайт, 1' },
    dropoff: { label: 'ул. Готовность, 2' },
    estimatedPrice: 1400,
    passenger: { name: 'Префлайт Пассажир', authorId: 'user_preflight_1', isCurrentUser: true },
  });
  expect('positive: no existing trip_<orderId> ride at all -> allowed',
    responses.isExistingRideCompatibleWithSelection(pfOrder.id, 'resp_pf_anything') === true);
  expect('preflight is read-only: checking a non-existent ride writes nothing to the active_ride store',
    rideState.findActiveRide(`trip_${pfOrder.id}`) === null);

  const pfRequest = responses.requestFromOrder(mockApi.getOrderById(pfOrder.id));
  const pfDriverA = { id: 'resp_pf_A', responseId: 'resp_pf_A', name: 'Преф А', rating: '4,60', car: 'Kia Rio', carModel: 'Kia Rio', carColor: 'белый', plate: 'П 001 ПП 01', eta: '3 мин', price: '1 300 ₽', note: '' };
  const pfBuilt = responses.buildPassengerActiveRide(mockApi.getOrderById(pfOrder.id), pfRequest, pfDriverA);
  expect('preflight fixture: ride pinned to A via the real accept path', !!pfBuilt && !!pfBuilt.ride);

  expect('N9 (pure fn): existing ride pinned to A, checking A -> allowed (idempotent re-select)',
    responses.isExistingRideCompatibleWithSelection(pfOrder.id, 'resp_pf_A') === true);
  expect('N9 (pure fn): existing ride pinned to A, checking B -> fails closed',
    responses.isExistingRideCompatibleWithSelection(pfOrder.id, 'resp_pf_B') === false);
  const beforeMismatchCheckJson = JSON.stringify(rideState.findActiveRide(`trip_${pfOrder.id}`));
  responses.isExistingRideCompatibleWithSelection(pfOrder.id, 'resp_pf_B');
  expect('preflight is read-only: a failing check does not mutate the existing ride',
    JSON.stringify(rideState.findActiveRide(`trip_${pfOrder.id}`)) === beforeMismatchCheckJson);

  resetStorage();
  const noPinPfOrder = await mockApi.createRideOrder({
    pickup: { label: 'ул. Без Пина, 1' },
    dropoff: { label: 'ул. Куда-То, 2' },
    estimatedPrice: 1200,
    passenger: { name: 'Безымянный Преф Пассажир', authorId: 'user_preflight_2', isCurrentUser: true },
  });
  rideState.saveActiveRide({ tripId: `trip_${noPinPfOrder.id}`, role: 'passenger', status: rideState.RIDE_STATUS.DRIVER_EN_ROUTE, selectedDriver: {} });
  expect('N10 (pure fn): existing ride with NO pin at all -> fails closed regardless of the checked responseId',
    responses.isExistingRideCompatibleWithSelection(noPinPfOrder.id, 'resp_pf_anything') === false);

  expect('no orderId at all -> preflight itself is a pass-through (unrelated fallback guards own that path)',
    responses.isExistingRideCompatibleWithSelection('', 'resp_pf_anything') === true);
}

// ── C. Behavioral: local real-response mode (P1, N2/N3, N4, N5, N6) ────
resetStorage();
const order = await mockApi.createRideOrder({
  pickup: { label: 'ул. Идентичная, 1' },
  dropoff: { label: 'ул. Точная, 2' },
  estimatedPrice: 1500,
  passenger: { name: 'Точный Пассажир', authorId: 'user_identity_1', isCurrentUser: true },
});
const request = responses.requestFromOrder(mockApi.getOrderById(order.id));
const RESPONSE_A = {
  id: 'resp_A', kind: 'passenger_response', tripId: `trip_${order.id}`, requestId: order.id,
  orderId: order.id, canonical: 'ride_order', driverPrice: 1500, pickupTiming: 'at_time',
  message: 'еду', vehicleId: 'veh_A', driverSnapshot: { name: 'Водитель А', rating: 4.8, car: 'Kia Rio', plate: 'А 001 АА 01' },
  status: 'SENT', createdAt: new Date().toISOString(),
};
const RESPONSE_B = {
  ...RESPONSE_A, id: 'resp_B', vehicleId: 'veh_B',
  driverSnapshot: { name: 'Водитель Б', rating: 4.5, car: 'Lada Vesta', plate: 'Б 002 ББ 02' },
};
writeResponse(RESPONSE_A);
writeResponse(RESPONSE_B);
const driverA = responses.mapResponseToDriverCard(RESPONSE_A, request, 0);
const driverB = responses.mapResponseToDriverCard(RESPONSE_B, request, 1);
const localDrivers = [driverA, driverB];

expect('P1 (local): resolveClickedDriver resolves the exact clicked card',
  responses.resolveClickedDriver(localDrivers, driverA.id, driverA.responseId) === driverA);
expect('P1 (local): isValidLocalResponseForOrder confirms the real response for this order',
  responses.isValidLocalResponseForOrder(driverA.responseId, order.id) === true);

const reassignedDrivers = [driverB];
expect('N3 (local): stale card no longer in the reassigned drivers array -> null (zero side effects)',
  responses.resolveClickedDriver(reassignedDrivers, driverA.id, driverA.responseId) === null);

expect('N4: mismatched driverId+responseId pair resolves to null (fail closed)',
  responses.resolveClickedDriver(localDrivers, driverA.id, driverB.responseId) === null);

const duplicateDriverA = { ...driverA };
const ambiguousDrivers = [driverA, duplicateDriverA, driverB];
expect('N5: two candidates matching the same driverId+responseId pair resolve to null (ambiguous, not first-match)',
  responses.resolveClickedDriver(ambiguousDrivers, driverA.id, driverA.responseId) === null);

// N6: local responseId resolves, but for a DIFFERENT order. A deterministic,
// guaranteed-different orderId — NOT a second createRideOrder() call.
// createRideOrder's id is `order-${Date.now()}` with millisecond resolution
// and no randomness (mock_api.js:523); two calls made close together in a
// tight test run can land in the same millisecond and collide, which would
// make this specific assertion flaky (otherOrder.id could equal order.id).
// isValidLocalResponseForOrder only ever compares response.orderId against
// whatever string is passed — it does not require the "other" order to
// exist in the ride_orders store — so a derived, provably-different string
// is sufficient and needs no second order record at all.
const guaranteedForeignOrderId = `${order.id}-foreign`;
expect('N6: local response resolves but response.orderId !== a guaranteed-different orderId -> invalid',
  responses.isValidLocalResponseForOrder(driverA.responseId, guaranteedForeignOrderId) === false);

expect('N8: empty drivers array never falls through to drivers[0] (returns null)',
  responses.resolveClickedDriver([], driverA.id, driverA.responseId) === null);

const built1 = responses.buildPassengerActiveRide(mockApi.getOrderById(order.id), request, driverA);
expect('P1 (local): buildPassengerActiveRide succeeds for a well-formed resolved driver', !!built1 && !!built1.ride);
expect('P1 (local): order accepted as a side effect', mockApi.getOrderById(order.id)?.status === 'ACCEPTED');
expect('P1 (local): active ride persisted and pinned to the selected response',
  rideState.findActiveRide(`trip_${order.id}`)?.selectedDriver?.responseId === driverA.responseId);

const built1Again = responses.buildPassengerActiveRide(mockApi.getOrderById(order.id), request, driverA);
expect('P3: re-selecting the same already-pinned driver reuses the existing ride',
  !!built1Again && built1Again.reused === true && built1Again.tripId === built1.tripId);

const beforeRideJson = JSON.stringify(rideState.findActiveRide(`trip_${order.id}`));
const beforeOrderStatus = mockApi.getOrderById(order.id)?.status;
const conflictResult = responses.buildPassengerActiveRide(mockApi.getOrderById(order.id), request, driverB);
expect('N9: clicking a different driver than the one already pinned fails closed (returns null)',
  conflictResult === null);
expect('N9: the existing ride (pinned to A) is left byte-identical, not overwritten for B',
  JSON.stringify(rideState.findActiveRide(`trip_${order.id}`)) === beforeRideJson);
expect('N9: order status is unaffected by the rejected re-selection attempt',
  mockApi.getOrderById(order.id)?.status === beforeOrderStatus);

resetStorage();
const noPinOrder = await mockApi.createRideOrder({
  pickup: { label: 'ул. Без Пина, 1' },
  dropoff: { label: 'ул. Куда-То, 2' },
  estimatedPrice: 1300,
  passenger: { name: 'Безымянный Пассажир', authorId: 'user_identity_3', isCurrentUser: true },
});
const noPinRequest = responses.requestFromOrder(mockApi.getOrderById(noPinOrder.id));
const noPinResponse = { ...RESPONSE_A, id: 'resp_nopin', orderId: noPinOrder.id, tripId: `trip_${noPinOrder.id}` };
writeResponse(noPinResponse);
const noPinDriver = responses.mapResponseToDriverCard(noPinResponse, noPinRequest, 0);
{
  const seeded = { tripId: `trip_${noPinOrder.id}`, role: 'passenger', status: rideState.RIDE_STATUS.DRIVER_EN_ROUTE, selectedDriver: {} };
  rideState.saveActiveRide(seeded);
}
const beforeNoPinRideJson = JSON.stringify(rideState.findActiveRide(`trip_${noPinOrder.id}`));
const noPinResult = responses.buildPassengerActiveRide(mockApi.getOrderById(noPinOrder.id), noPinRequest, noPinDriver);
expect('N10: an existing ride with NO pin at all also fails closed (no auto-match)', noPinResult === null);
expect('N10: the unpinned existing ride is left unchanged',
  JSON.stringify(rideState.findActiveRide(`trip_${noPinOrder.id}`)) === beforeNoPinRideJson);

// ── D. Behavioral: real (non-demo) canonical order with zero responses (N1) ──
resetStorage();
const emptyOrder = await mockApi.createRideOrder({
  pickup: { label: 'ул. Пустая, 1' },
  dropoff: { label: 'ул. Никого, 2' },
  estimatedPrice: 1000,
  passenger: { name: 'Одинокий Пассажир', authorId: 'user_identity_4', isCurrentUser: true },
});
const emptyRequest = responses.requestFromOrder(mockApi.getOrderById(emptyOrder.id));
const emptyBoardNonDemo = responses.buildDriversForOrder(emptyRequest, null, false);
expect('N1: a real, non-demo canonical order with zero real responses returns an EMPTY board (no MOCK_DRIVERS), regardless of requested state',
  Array.isArray(emptyBoardNonDemo) && emptyBoardNonDemo.length === 0);

// ── E. Behavioral: canonical Inbox demo-order still gets MOCK_DRIVERS (P2) ──
resetStorage();
const demoOrder = mockApi.ensureDemoResponseOrder();
expect('demo fixture: ensureDemoResponseOrder marks the order demo:true with the canonical demoKind',
  demoOrder.demo === true && demoOrder.demoKind === mockApi.DEMO_RESPONSE_KIND);
expect('isCanonicalDemoOrder recognizes the canonical Inbox demo-order', responses.isCanonicalDemoOrder(demoOrder) === true);
expect('isCanonicalDemoOrder rejects an ordinary real order', responses.isCanonicalDemoOrder(mockApi.getOrderById(order.id)) === false);
expect('isCanonicalDemoOrder rejects a missing/null order', responses.isCanonicalDemoOrder(null) === false);

const demoRequest = responses.requestFromOrder(demoOrder);
expect('demoRequest carries isDemoOrder:true (threaded via requestFromOrder)', demoRequest.isDemoOrder === true);
const demoBoard = responses.buildDriversForOrder(demoRequest, null, false);
expect('P2: the canonical Inbox demo-order still gets a non-empty MOCK_DRIVERS board', Array.isArray(demoBoard) && demoBoard.length > 0);

const demoIds = demoBoard.map((d) => d.id);
expect('N11: demo MOCK_DRIVERS board has no duplicate/colliding ids', new Set(demoIds).size === demoIds.length);

const demoCard = demoBoard[0];
expect('P2: resolveClickedDriver resolves a well-formed demo card',
  responses.resolveClickedDriver(demoBoard, demoCard.id, demoCard.responseId) === demoCard);
const demoBuilt = responses.buildPassengerActiveRide(mockApi.getOrderById(demoOrder.id), demoRequest, demoCard);
expect('P2: demo select -> active-ride still succeeds end to end', !!demoBuilt && !!demoBuilt.ride);
expect('P2: demo order accepted as a side effect', mockApi.getOrderById(demoOrder.id)?.status === 'ACCEPTED');

// ── F. Legacy/no-order/fallback QA board: MOCK_DRIVERS renders, but cannot mint a real ride ──
const fallbackRequest = responses.requestFromOrder(null, '');
expect('fallback fixture: no canonical order -> request.isFallback is true', fallbackRequest.isFallback === true);
const fallbackBoard = responses.buildDriversForOrder(fallbackRequest, null, false);
expect('legacy/no-order fallback QA board still renders MOCK_DRIVERS (unchanged)', Array.isArray(fallbackBoard) && fallbackBoard.length > 0);
expect('legacy/no-order fallback board cannot mint a real ride (no canonical order to accept)',
  responses.buildPassengerActiveRide(null, fallbackRequest, fallbackBoard[0]) === null);

// ═════════════════════════════════════════════════════════════════════════
// ── G. Real side-effect-spy coverage: runSelectDriverOrchestration itself,
//        driving the SAME code the click handler calls, with every
//        side-effecting dependency replaced by a counting spy. ────────────
// ═════════════════════════════════════════════════════════════════════════
function backendDriverFixture(overrides = {}) {
  return {
    id: 'resp_spy_B', responseId: 'resp_spy_B', driverId: 'drv_spy_B',
    name: 'Спай Б', rating: '—', car: 'Renault Logan', carModel: 'Renault Logan',
    carColor: 'серый', plate: 'С 002 СС 02', eta: '2 мин', price: '1 100 ₽', note: '',
    ...overrides,
  };
}

async function makeSpyOrder(label, authorId) {
  return mockApi.createRideOrder({
    pickup: { label: `ул. ${label}, 1` },
    dropoff: { label: `ул. ${label}-2, 2` },
    estimatedPrice: 1100,
    passenger: { name: `${label} Пассажир`, authorId, isCurrentUser: true },
  });
}

// Case A — backend, existing ride pinned to A, click B: the PRE-API preflight
// must catch this before any side effect runs at all.
{
  resetStorage();
  const gOrder = await makeSpyOrder('Спай-А', 'user_spy_a');
  const gRequest = responses.requestFromOrder(mockApi.getOrderById(gOrder.id));
  const driverAFixture = { id: 'resp_spy_A', responseId: 'resp_spy_A', driverId: 'drv_spy_A', name: 'Спай А', rating: '—', car: 'Kia Rio', carModel: 'Kia Rio', carColor: 'белый', plate: 'С 001 СС 01', eta: '1 мин', price: '1 000 ₽', note: '' };
  responses.buildPassengerActiveRide(mockApi.getOrderById(gOrder.id), gRequest, driverAFixture);
  expect('Case A fixture: existing ride pinned to A', rideState.findActiveRide(`trip_${gOrder.id}`)?.selectedDriver?.responseId === 'resp_spy_A');

  const driverBFixture = backendDriverFixture();
  const selectSpy = makeAsyncSpy(async () => ({ ok: true }));
  const buildSpy = makeSpy((...args) => responses.buildPassengerActiveRide(...args));
  const navSpy = makeSpy();
  const outcome = await responses.runSelectDriverOrchestration(
    { drivers: [driverBFixture], driverId: driverBFixture.id, responseId: driverBFixture.responseId,
      request: gRequest, canonicalOrder: mockApi.getOrderById(gOrder.id), backendAuthoritative: true, isDemoOrder: false },
    { selectOfferOnBackend: selectSpy, buildPassengerActiveRide: buildSpy, navigate: navSpy, showToast: () => {} },
  );
  expect('Case A: outcome fails closed', outcome.ok === false);
  expect('Case A: selectOfferOnBackend spy count = 0', selectSpy.count === 0, `count=${selectSpy.count}`);
  expect('Case A: build/accept/save spy count = 0', buildSpy.count === 0, `count=${buildSpy.count}`);
  expect('Case A: navigation spy count = 0', navSpy.count === 0, `count=${navSpy.count}`);
}

// Case B — backend, existing ride with NO pin at all: same zero counts.
{
  resetStorage();
  const gOrder = await makeSpyOrder('Спай-Б', 'user_spy_b');
  const gRequest = responses.requestFromOrder(mockApi.getOrderById(gOrder.id));
  rideState.saveActiveRide({ tripId: `trip_${gOrder.id}`, role: 'passenger', status: rideState.RIDE_STATUS.DRIVER_EN_ROUTE, selectedDriver: {} });

  const driverBFixture = backendDriverFixture();
  const selectSpy = makeAsyncSpy(async () => ({ ok: true }));
  const buildSpy = makeSpy((...args) => responses.buildPassengerActiveRide(...args));
  const navSpy = makeSpy();
  const outcome = await responses.runSelectDriverOrchestration(
    { drivers: [driverBFixture], driverId: driverBFixture.id, responseId: driverBFixture.responseId,
      request: gRequest, canonicalOrder: mockApi.getOrderById(gOrder.id), backendAuthoritative: true, isDemoOrder: false },
    { selectOfferOnBackend: selectSpy, buildPassengerActiveRide: buildSpy, navigate: navSpy, showToast: () => {} },
  );
  expect('Case B: outcome fails closed', outcome.ok === false);
  expect('Case B: selectOfferOnBackend spy count = 0', selectSpy.count === 0, `count=${selectSpy.count}`);
  expect('Case B: build/accept/save spy count = 0', buildSpy.count === 0, `count=${buildSpy.count}`);
  expect('Case B: navigation spy count = 0', navSpy.count === 0, `count=${navSpy.count}`);
}

// Case C — LOCAL equivalents of A and B (backendAuthoritative: false).
{
  resetStorage();
  const gOrder = await makeSpyOrder('Спай-Ц1', 'user_spy_c1');
  const gRequest = responses.requestFromOrder(mockApi.getOrderById(gOrder.id));
  const respA = { id: 'resp_spy_c_A', kind: 'passenger_response', tripId: `trip_${gOrder.id}`, requestId: gOrder.id, orderId: gOrder.id, canonical: 'ride_order', driverPrice: 1100, pickupTiming: 'at_time', message: '', vehicleId: 'veh_c_A', driverSnapshot: { name: 'Ц А', rating: 4.5, car: 'Kia Rio', plate: 'Ц 001 ЦЦ 01' }, status: 'SENT', createdAt: new Date().toISOString() };
  const respB = { ...respA, id: 'resp_spy_c_B', vehicleId: 'veh_c_B', driverSnapshot: { name: 'Ц Б', rating: 4.2, car: 'Lada Vesta', plate: 'Ц 002 ЦЦ 02' } };
  writeResponse(respA); writeResponse(respB);
  const cDriverA = responses.mapResponseToDriverCard(respA, gRequest, 0);
  const cDriverB = responses.mapResponseToDriverCard(respB, gRequest, 1);
  responses.buildPassengerActiveRide(mockApi.getOrderById(gOrder.id), gRequest, cDriverA);

  const buildSpy = makeSpy((...args) => responses.buildPassengerActiveRide(...args));
  const navSpy = makeSpy();
  const outcome = await responses.runSelectDriverOrchestration(
    { drivers: [cDriverA, cDriverB], driverId: cDriverB.id, responseId: cDriverB.responseId,
      request: gRequest, canonicalOrder: mockApi.getOrderById(gOrder.id), backendAuthoritative: false, isDemoOrder: false },
    { buildPassengerActiveRide: buildSpy, navigate: navSpy, showToast: () => {} },
  );
  expect('Case C (pinned-A, click B, local): outcome fails closed', outcome.ok === false);
  expect('Case C (pinned-A, click B, local): build/accept/save spy count = 0', buildSpy.count === 0, `count=${buildSpy.count}`);
  expect('Case C (pinned-A, click B, local): navigation spy count = 0', navSpy.count === 0, `count=${navSpy.count}`);

  resetStorage();
  const gOrder2 = await makeSpyOrder('Спай-Ц2', 'user_spy_c2');
  const gRequest2 = responses.requestFromOrder(mockApi.getOrderById(gOrder2.id));
  rideState.saveActiveRide({ tripId: `trip_${gOrder2.id}`, role: 'passenger', status: rideState.RIDE_STATUS.DRIVER_EN_ROUTE, selectedDriver: {} });
  const respC = { ...respA, id: 'resp_spy_c2', tripId: `trip_${gOrder2.id}`, orderId: gOrder2.id, requestId: gOrder2.id };
  writeResponse(respC);
  const cDriverC = responses.mapResponseToDriverCard(respC, gRequest2, 0);
  const buildSpy2 = makeSpy((...args) => responses.buildPassengerActiveRide(...args));
  const navSpy2 = makeSpy();
  const outcome2 = await responses.runSelectDriverOrchestration(
    { drivers: [cDriverC], driverId: cDriverC.id, responseId: cDriverC.responseId,
      request: gRequest2, canonicalOrder: mockApi.getOrderById(gOrder2.id), backendAuthoritative: false, isDemoOrder: false },
    { buildPassengerActiveRide: buildSpy2, navigate: navSpy2, showToast: () => {} },
  );
  expect('Case C (no pin, local): outcome fails closed', outcome2.ok === false);
  expect('Case C (no pin, local): build/accept/save spy count = 0', buildSpy2.count === 0, `count=${buildSpy2.count}`);
  expect('Case C (no pin, local): navigation spy count = 0', navSpy2.count === 0, `count=${navSpy2.count}`);
}

// Case D — AWAIT RACE: the pre-API preflight sees no ride at all (passes);
// the mocked selectOfferOnBackend itself creates/pins a REAL local ride to
// driver A (via the real buildPassengerActiveRide, simulating a genuinely
// concurrent accept completing during the await) BEFORE resolving; the
// requested driver is B. The API call must still have happened exactly
// once (the race is discovered only AFTER it settles), but the subsequent
// build/navigate must never run, and the conflicting ride (pinned to A)
// must remain exactly as the race left it.
{
  resetStorage();
  const gOrder = await makeSpyOrder('Спай-Гонка', 'user_spy_race');
  const gRequest = responses.requestFromOrder(mockApi.getOrderById(gOrder.id));
  expect('Case D fixture: no existing ride before the call', rideState.findActiveRide(`trip_${gOrder.id}`) === null);

  const driverAFixture = { id: 'resp_race_A', responseId: 'resp_race_A', driverId: 'drv_race_A', name: 'Гонка А', rating: '—', car: 'Kia Rio', carModel: 'Kia Rio', carColor: 'белый', plate: 'Г 001 ГГ 01', eta: '1 мин', price: '1 000 ₽', note: '' };
  const driverBFixture = { id: 'resp_race_B', responseId: 'resp_race_B', driverId: 'drv_race_B', name: 'Гонка Б', rating: '—', car: 'Renault Logan', carModel: 'Renault Logan', carColor: 'серый', plate: 'Г 002 ГГ 02', eta: '2 мин', price: '1 050 ₽', note: '' };

  const raceSelectSpy = makeAsyncSpy(async () => {
    // Simulate another tab/device completing a real accept for A WHILE this
    // await is in flight, using the exact same real orchestration primitive.
    responses.buildPassengerActiveRide(mockApi.getOrderById(gOrder.id), gRequest, driverAFixture);
    return { ok: true };
  });
  const buildSpy = makeSpy((...args) => responses.buildPassengerActiveRide(...args));
  const navSpy = makeSpy();
  const outcome = await responses.runSelectDriverOrchestration(
    { drivers: [driverBFixture], driverId: driverBFixture.id, responseId: driverBFixture.responseId,
      request: gRequest, canonicalOrder: mockApi.getOrderById(gOrder.id), backendAuthoritative: true, isDemoOrder: false },
    { selectOfferOnBackend: raceSelectSpy, buildPassengerActiveRide: buildSpy, navigate: navSpy, showToast: () => {} },
  );
  expect('Case D: outcome fails closed', outcome.ok === false && outcome.reason === 'existing-ride-conflict-post-api');
  expect('Case D: selectOfferOnBackend spy count = 1 (the race is only discoverable after it settles)', raceSelectSpy.count === 1, `count=${raceSelectSpy.count}`);
  expect('Case D: subsequent build/accept/save spy count = 0', buildSpy.count === 0, `count=${buildSpy.count}`);
  expect('Case D: navigation spy count = 0', navSpy.count === 0, `count=${navSpy.count}`);
  expect('Case D: the conflicting ride created during the await remains pinned to A, unchanged',
    rideState.findActiveRide(`trip_${gOrder.id}`)?.selectedDriver?.responseId === 'resp_race_A');
}

// Case E — happy paths and the same-pin idempotent path remain green.
{
  // (i) backend, same-device, well-formed: select=1, build=1, navigate=1.
  resetStorage();
  const gOrder = await makeSpyOrder('Спай-Хеппи', 'user_spy_happy');
  const gRequest = responses.requestFromOrder(mockApi.getOrderById(gOrder.id));
  const driverFixture = backendDriverFixture();
  const selectSpy = makeAsyncSpy(async () => ({ ok: true }));
  const buildSpy = makeSpy((...args) => responses.buildPassengerActiveRide(...args));
  const navSpy = makeSpy();
  const outcome = await responses.runSelectDriverOrchestration(
    { drivers: [driverFixture], driverId: driverFixture.id, responseId: driverFixture.responseId,
      request: gRequest, canonicalOrder: mockApi.getOrderById(gOrder.id), backendAuthoritative: true, isDemoOrder: false },
    { selectOfferOnBackend: selectSpy, buildPassengerActiveRide: buildSpy, navigate: navSpy, showToast: () => {} },
  );
  expect('Case E(i) backend happy path: outcome succeeds', outcome.ok === true && outcome.tripId === `trip_${gOrder.id}`);
  expect('Case E(i): selectOfferOnBackend spy count = 1', selectSpy.count === 1, `count=${selectSpy.count}`);
  expect('Case E(i): build/accept/save spy count = 1', buildSpy.count === 1, `count=${buildSpy.count}`);
  expect('Case E(i): navigation spy count = 1, called with the correct tripId', navSpy.count === 1 && navSpy.calls[0][0] === `trip_${gOrder.id}`, `count=${navSpy.count} arg=${navSpy.calls[0]?.[0]}`);

  // (ii) same-pin idempotent re-select (backend), same order/driver as (i),
  // BEFORE any resetStorage() below — must run while gOrder's ride from (i)
  // is still live, or canonicalOrder would resolve null and this would
  // silently exercise the cross-device branch instead of the reuse path.
  const buildSpy3 = makeSpy((...args) => responses.buildPassengerActiveRide(...args));
  const navSpy3 = makeSpy();
  const selectSpy3 = makeAsyncSpy(async () => ({ ok: true }));
  const outcome3 = await responses.runSelectDriverOrchestration(
    { drivers: [driverFixture], driverId: driverFixture.id, responseId: driverFixture.responseId,
      request: gRequest, canonicalOrder: mockApi.getOrderById(gOrder.id), backendAuthoritative: true, isDemoOrder: false },
    { selectOfferOnBackend: selectSpy3, buildPassengerActiveRide: buildSpy3, navigate: navSpy3, showToast: () => {} },
  );
  expect('Case E(ii) same-pin idempotent re-select: outcome succeeds (reuse)', outcome3.ok === true);
  expect('Case E(ii): build/accept/save spy count = 1 (reuse path still calls through once)', buildSpy3.count === 1, `count=${buildSpy3.count}`);
  expect('Case E(ii): navigation spy count = 1', navSpy3.count === 1, `count=${navSpy3.count}`);

  // (iii) local, well-formed: build=1, navigate=1.
  resetStorage();
  const gOrder2 = await makeSpyOrder('Спай-Хеппи2', 'user_spy_happy2');
  const gRequest2 = responses.requestFromOrder(mockApi.getOrderById(gOrder2.id));
  const respLocal = { id: 'resp_happy_local', kind: 'passenger_response', tripId: `trip_${gOrder2.id}`, requestId: gOrder2.id, orderId: gOrder2.id, canonical: 'ride_order', driverPrice: 1100, pickupTiming: 'at_time', message: '', vehicleId: 'veh_happy', driverSnapshot: { name: 'Хеппи Локал', rating: 4.7, car: 'Kia Rio', plate: 'Х 001 ХХ 01' }, status: 'SENT', createdAt: new Date().toISOString() };
  writeResponse(respLocal);
  const localDriverFixture = responses.mapResponseToDriverCard(respLocal, gRequest2, 0);
  const buildSpy2 = makeSpy((...args) => responses.buildPassengerActiveRide(...args));
  const navSpy2 = makeSpy();
  const outcome2 = await responses.runSelectDriverOrchestration(
    { drivers: [localDriverFixture], driverId: localDriverFixture.id, responseId: localDriverFixture.responseId,
      request: gRequest2, canonicalOrder: mockApi.getOrderById(gOrder2.id), backendAuthoritative: false, isDemoOrder: false },
    { buildPassengerActiveRide: buildSpy2, navigate: navSpy2, showToast: () => {} },
  );
  expect('Case E(iii) local happy path: outcome succeeds', outcome2.ok === true && outcome2.tripId === `trip_${gOrder2.id}`);
  expect('Case E(iii): build/accept/save spy count = 1', buildSpy2.count === 1, `count=${buildSpy2.count}`);
  expect('Case E(iii): navigation spy count = 1', navSpy2.count === 1, `count=${navSpy2.count}`);
}

// Case F — explicit null handoff from buildPassengerActiveRide (any
// internal reason), canonicalOrder truthy: navigation must never run.
{
  resetStorage();
  const gOrder = await makeSpyOrder('Спай-Нуль', 'user_spy_null');
  const gRequest = responses.requestFromOrder(mockApi.getOrderById(gOrder.id));
  const driverFixture = backendDriverFixture();
  const selectSpy = makeAsyncSpy(async () => ({ ok: true }));
  const buildSpyNull = makeSpy(() => null);
  const navSpy = makeSpy();
  const outcome = await responses.runSelectDriverOrchestration(
    { drivers: [driverFixture], driverId: driverFixture.id, responseId: driverFixture.responseId,
      request: gRequest, canonicalOrder: mockApi.getOrderById(gOrder.id), backendAuthoritative: true, isDemoOrder: false },
    { selectOfferOnBackend: selectSpy, buildPassengerActiveRide: buildSpyNull, navigate: navSpy, showToast: () => {} },
  );
  expect('Case F: outcome fails closed on a null handoff', outcome.ok === false && outcome.reason === 'local-bridge-failed');
  expect('Case F: navigation spy count = 0 (never falls through to unconditional trip_<orderId> navigation)', navSpy.count === 0, `count=${navSpy.count}`);
}

// Case G — cross-device happy path: canonicalOrder is null (no local
// mirror), backend succeeds, no conflict discovered post-API. The
// deterministic trip_<orderId> navigation is exactly the one case this
// orchestration is allowed to take without ever calling
// buildPassengerActiveRide — and only after the post-API check passes.
{
  resetStorage();
  const gOrderId = 'order-cross-device-happy-1';
  const gRequest = { ...responses.requestFromOrder(null, gOrderId), orderId: gOrderId, isDemoOrder: false };
  const driverFixture = backendDriverFixture();
  const selectSpy = makeAsyncSpy(async () => ({ ok: true }));
  const buildSpy = makeSpy();
  const navSpy = makeSpy();
  const outcome = await responses.runSelectDriverOrchestration(
    { drivers: [driverFixture], driverId: driverFixture.id, responseId: driverFixture.responseId,
      request: gRequest, canonicalOrder: null, backendAuthoritative: true, isDemoOrder: false },
    { selectOfferOnBackend: selectSpy, buildPassengerActiveRide: buildSpy, navigate: navSpy, showToast: () => {} },
  );
  expect('Case G: cross-device happy path succeeds', outcome.ok === true && outcome.tripId === `trip_${gOrderId}`);
  expect('Case G: selectOfferOnBackend spy count = 1', selectSpy.count === 1, `count=${selectSpy.count}`);
  expect('Case G: build/accept/save spy count = 0 (no local order to bridge — this is the ONE legitimate skip)', buildSpy.count === 0, `count=${buildSpy.count}`);
  expect('Case G: navigation spy count = 1, deterministic trip_<orderId>', navSpy.count === 1 && navSpy.calls[0][0] === `trip_${gOrderId}`);
}

// Case H — cross-device AWAIT RACE: canonicalOrder null, no existing ride at
// pre-API time (so the pre-API preflight passes and the API call happens),
// but a conflicting ride is written — keyed only by tripId, independent of
// any local order mirror — by the mocked selectOfferOnBackend's own side
// effect WHILE the await is in flight, exactly mirroring Case D's race but
// for the cross-device path. The deterministic trip_<orderId> navigation
// must NOT fire here either — it is gated by the same post-API
// compatibility check as the same-device path, not unconditional.
{
  resetStorage();
  const gOrderId = 'order-cross-device-conflict-1';
  const gRequest = { ...responses.requestFromOrder(null, gOrderId), orderId: gOrderId, isDemoOrder: false };
  expect('Case H fixture: no existing ride before the call', rideState.findActiveRide(`trip_${gOrderId}`) === null);
  const driverFixture = backendDriverFixture();
  const raceSelectSpy = makeAsyncSpy(async () => {
    // Simulate a concurrent write racing in during the await, keyed only by
    // tripId (no local order mirror involved — the cross-device case).
    rideState.saveActiveRide({ tripId: `trip_${gOrderId}`, role: 'passenger', status: rideState.RIDE_STATUS.DRIVER_EN_ROUTE, selectedDriver: { responseId: 'resp_cross_other' } });
    return { ok: true };
  });
  const buildSpy = makeSpy();
  const navSpy = makeSpy();
  const outcome = await responses.runSelectDriverOrchestration(
    { drivers: [driverFixture], driverId: driverFixture.id, responseId: driverFixture.responseId,
      request: gRequest, canonicalOrder: null, backendAuthoritative: true, isDemoOrder: false },
    { selectOfferOnBackend: raceSelectSpy, buildPassengerActiveRide: buildSpy, navigate: navSpy, showToast: () => {} },
  );
  expect('Case H: cross-device race discovered post-API fails closed', outcome.ok === false && outcome.reason === 'existing-ride-conflict-post-api');
  expect('Case H: selectOfferOnBackend spy count = 1 (the race is only discoverable after it settles)', raceSelectSpy.count === 1, `count=${raceSelectSpy.count}`);
  expect('Case H: build/accept/save spy count = 0', buildSpy.count === 0, `count=${buildSpy.count}`);
  expect('Case H: navigation spy count = 0 (deterministic trip navigation is not unconditional)', navSpy.count === 0, `count=${navSpy.count}`);
}

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
