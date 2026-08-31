// BD-CLOUD-DESIGN-LOADING-02D (#872) — Passenger Active Ride read-state guard.
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const passenger = read('../public/src/screens/active_ride_passenger.js');
const passengerSheets = read('../public/src/screens/active_ride_passenger_sheets.js');
const activeRide = read('../public/src/screens/active_ride.js');
const app = read('../public/src/app.js');
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
// #938-01B-A — setReadState's own syncPassengerMutationGate() call only runs
// on its LOADED branch, and the initial readState is now LOADING whenever
// backendRead is true (requirement #1) even with a usable local ride, so an
// explicit call right after the initial setReadState keeps
// root.dataset.ownershipState observable from the very first synchronous
// mount instead of leaving it unset until the first read settles.
expect('the initial mount explicitly syncs the mutation gate right after setReadState (before runInitialRead), so ownershipState is never left unset during the first LOADING paint',
  /setReadState\(readState\);\s*\n(?:\s*\/\/[^\n]*\n)*\s*syncPassengerMutationGate\(\);\s*\n\s*if \(!fixture && backendRead\) runInitialRead\(\);/.test(passenger));
expect('404/RIDE_NOT_FOUND settles local ownership while unknown IDs still render empty',
  initialRead.includes('err.status === 404')
    && initialRead.includes("err.code === 'RIDE_NOT_FOUND'")
    && initialRead.includes('setPassengerRideOwnership(PASSENGER_RIDE_OWNERSHIP.LOCAL_ONLY)')
    && initialRead.includes('setPassengerMutationBlocked(false)')
    && initialRead.includes('if (hasUsableLocalRide) {')
    && initialRead.includes('renderLoadedRide(recovery)')
    && passenger.includes('const hasUsableLocalRide = hasPersistedLocalRide || isBuiltInDemoRide')
    && initialRead.includes('PASSENGER_RIDE_READ_STATE.EMPTY'));
// #938-01B-A — a genuinely missing server Ride (404) confirms the trip is
// local-only, so an already-terminal local/demo ride (e.g. a stale
// COMPLETED/CANCELED snapshot) still swaps to its own terminal renderer
// here exactly like the pre-01B-A backend-off path — never gated behind a
// participant GET that can never resolve to anything for a purely local trip.
expect('404/RIDE_NOT_FOUND local-only path still swaps to the terminal renderer for an already-terminal local ride',
  initialRead.includes('if (needsSeparatePassengerRenderer(ride.status)) {')
    && initialRead.includes('swapToTerminalPassengerScreen(ride);'));
const loadedRenderer = functionBody(passenger, 'renderLoadedRide');
const inPlaceRefresh = functionBody(passenger, 'refreshPassengerRideFieldsInPlace');
// #938-01B-A — the FIRST paint no longer special-cases an already-usable
// local ride: `backendRead` alone (regardless of hasUsableLocalRide) forces
// the initial LOADING state, so no local/demo Ride — terminal or not — is
// shown before a settled participant GET (requirement #1). The prior
// `backendRead && !hasUsableLocalRide` gate is asserted GONE, not just
// replaced, so a future regression that reintroduces it fails loudly here.
expect('no local ride, usable or not, is shown before the first backend read settles',
  passenger.includes('let readState = fixture || (backendRead')
    && passenger.includes('? PASSENGER_RIDE_READ_STATE.LOADING')
    && passenger.includes(': PASSENGER_RIDE_READ_STATE.LOADED);')
    && !passenger.includes('backendRead && !hasUsableLocalRide'));
expect('a LATER recovery/retry read of an already-confirmed ride still keeps its DOM in place while refreshing',
  initialRead.includes('hasUsableLocalRide && epoch > 1')
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
// #938-01B-A — vehicle/payment/chat have no server source at all today (the
// focused serializer never emits srv.vehicle/srv.payment/srv.chat), so the
// OLD keep(local, server) merge for these three left any pre-existing
// local/demo value untouched forever on a real, server-confirmed ride.
// order/route/ride/waiting/timestamps ARE properly server-sourced already
// and correctly keep their unchanged keep()-based merge.
expect('server merge keeps route/ride/waiting/timestamps via keep(), neutralizes vehicle/payment/chat to authoritative-or-null, and computes order.offerPrice straight from srv (never keep()-preserved)',
  mergeServer.includes('vehicle: { model: (srv.driver && srv.driver.car) || null, color: null, plate: null }')
    && mergeServer.includes('order: { ...keep(ride.order, srv.order), offerPrice: (srv.order && srv.order.offerPrice) || null }')
    && mergeServer.includes('route: keep(ride.route, srv.route)')
    && mergeServer.includes('payment: null')
    && mergeServer.includes('waiting: mergeServerWaiting(ride.waiting, srv.waiting)')
    && mergeServer.includes('ride: keep(ride.ride, srv.ride)')
    && mergeServer.includes('timestamps: keep(ride.timestamps, srv.timestamps)')
    && mergeServer.includes('chat: null'));
expect('mergeServerRide never carries a stale vehicle/payment/chat forward via keep() (the banned pattern is fully gone, not just supplemented), and order.offerPrice specifically is never a bare keep()-preserved property either (only wrapped, with offerPrice separately overwritten)',
  !mergeServer.includes('vehicle: keep(ride.vehicle, srv.vehicle)')
    && !mergeServer.includes('payment: keep(ride.payment, srv.payment)')
    && !mergeServer.includes('chat: keep(ride.chat, srv.chat)')
    && !/order:\s*keep\(ride\.order, srv\.order\),/.test(mergeServer));
const markAuthoritative = functionBody(passenger, 'markPassengerRideAuthoritative');
expect('markPassengerRideAuthoritative is defined and marks a NON-enumerable, in-memory-only property',
  markAuthoritative.length > 0
    && markAuthoritative.includes("value: true")
    && markAuthoritative.includes('enumerable: false')
    && markAuthoritative.includes('Object.defineProperty(mergedRide, \'authoritative\''));
expect('every mergeServerRide() call site inside runInitialRead immediately marks the result authoritative',
  (initialRead.match(/ride = mergeServerRide\(srv, recovery\);\s*\n\s*markPassengerRideAuthoritative\(ride\);/g) || []).length === 2);

// ── #938-01B-A — display helpers suppress demo fallbacks only for a
// server-confirmed (authoritative) ride; a genuinely local/demo ride keeps
// the exact prior fallback strings, so the backend-off prototype is
// unchanged (requirement #6). No server source exists for
// vehicle.color/plate, any payment field, or chat.unread today, so an
// authoritative ride with none of these gets a neutral/omitted value, never
// a fabricated one (requirement #5) — never demo-vs-authoritative differ
// only inside the render call, both must be visible in the pure helper.
const carLineBody = functionBody(passenger, 'carLine');
expect('carLine omits model/plate for an authoritative ride with no real vehicle data, but keeps the demo fallback for a non-authoritative one',
  carLineBody.includes('const authoritative = !!(ride && ride.authoritative)')
    && carLineBody.includes("authoritative ? (v.model || null) : (v.model || 'Toyota Camry')")
    && carLineBody.includes("v.plate || (authoritative ? null : 'А 124 ВВ 77')"));
const paymentInfoBody = functionBody(passenger, 'paymentInfo');
expect('paymentInfo returns last4/method/note = null for an authoritative ride with no real payment data (amount still resolves from ride.order.offerPrice)',
  paymentInfoBody.includes('if (ride && ride.authoritative)')
    && /last4:\s*pay\.last4 \|\| null/.test(paymentInfoBody)
    && /method:\s*pay\.method \|\| null/.test(paymentInfoBody)
    && /note:\s*pay\.note \|\| null/.test(paymentInfoBody)
    && paymentInfoBody.includes("amount: pay.amount || (ride.order && ride.order.offerPrice) || null"));
// functionBody() above stops at the FIRST '{' after the name, which for
// `paymentBlockHtml(ride, options = {})` is the param default's own empty
// object literal, not the real body — so this checks the whole file instead
// of a functionBody()-scoped slice. The matched string is specific enough
// (the full authoritative+last4+method condition) to stay uniquely scoped
// to this one guard without a real function-body extraction.
expect('paymentBlockHtml hides the whole card for an authoritative ride with no real last4/method, instead of rendering a "•• null · null" fragment',
  passenger.includes('if (ride && ride.authoritative && pay.last4 == null && pay.method == null) return \'\';'));
const chatLabelForBody = functionBody(passenger, 'chatLabelFor');
expect('chatLabelFor defaults unread to 0 (not the demo "2 unread") for an authoritative ride with no real chat data',
  chatLabelForBody.includes('const authoritative = !!(ride && ride.authoritative)')
    && chatLabelForBody.includes('hasRawUnread ? Number(rawUnread) : (authoritative ? 0 : 2)'));
// #938-01B-A review-fix (MEDIUM finding) — arrivingDropoffAmount() feeds
// BOTH authoritative surfaces: renderPassengerRideComplete's "Итого к
// оплате" (via completedPaymentInfo) and the IN_PROGRESS+ARRIVING_DROPOFF
// amount (renderArrivingDropoffSheet / refreshPassengerRideFieldsInPlace).
// The real-value priority chain (dropoffAmount -> amount -> ride.price ->
// order.offerPrice) is required to stay intact and checked BEFORE the
// authoritative branch — only the LAST-RESORT literal is gated, exactly
// mirroring carLine/paymentInfo/chatLabelFor's authoritative-or-demo policy.
const arrivingDropoffAmountBody = functionBody(passenger, 'arrivingDropoffAmount');
// #938-01B-A review-fix #2 — an authoritative ride takes a COMPLETELY
// SEPARATE branch that consults ONLY ride.order.offerPrice, never
// pay/r.price at all (r.price can legitimately still carry a stale
// local/demo value when the server omits the `ride` sub-object — see
// mergeServerRide's order field comment). The local/backend-off branch
// keeps the exact prior real-value priority chain and '1 540 ₽' fallback
// unbroken, checked only in that branch.
expect('arrivingDropoffAmount: an authoritative ride takes a separate branch consulting ONLY order.offerPrice (never pay/r.price), neutral "—" when absent',
  arrivingDropoffAmountBody.includes('if (ride && ride.authoritative) {')
    && arrivingDropoffAmountBody.includes('const order = ride.order || {};')
    && arrivingDropoffAmountBody.includes("return order.offerPrice || '—';"));
expect('arrivingDropoffAmount: the local/backend-off branch preserves the exact prior real-value priority chain and "1 540 ₽" fallback, unbroken',
  arrivingDropoffAmountBody.includes('const pay = (ride && ride.payment) || {};')
    && arrivingDropoffAmountBody.includes('const r = (ride && ride.ride) || {};')
    && arrivingDropoffAmountBody.includes('const order = (ride && ride.order) || {};')
    && arrivingDropoffAmountBody.includes("return pay.dropoffAmount || pay.amount || r.price || order.offerPrice || '1 540 ₽';"));
expect('arrivingDropoffAmount: the authoritative branch is structurally first, so it can never fall through into the pay/r.price chain',
  arrivingDropoffAmountBody.indexOf('if (ride && ride.authoritative) {') < arrivingDropoffAmountBody.indexOf('const pay = (ride && ride.payment) || {};'));
expect('arrivingDropoffAmount is exported for direct deterministic testing (its authoritative branch is otherwise unobservable through the live DOM — see smoke-passenger-active-ride-local-sync-runtime.mjs)',
  /export function arrivingDropoffAmount\(/.test(passenger));
// #938-01B-A review-fix #2 — order.offerPrice is the authoritative fare
// source, so it must be overwritten unconditionally from srv, never
// keep()-preserved: a missing/null srv.order.offerPrice normalizes straight
// to null here, at merge time — never left as whatever the pre-merge
// local/demo ride.order.offerPrice happened to be.
expect('mergeServerRide computes order.offerPrice unconditionally from srv (never keep()-preserved from local), normalizing a missing/null/empty server value straight to null',
  mergeServer.includes('offerPrice: (srv.order && srv.order.offerPrice) || null'));
expect('refreshPassengerRideFieldsInPlace mirrors paymentBlockHtml\'s null handling (no raw string-concat "null" leak into the in-place payment title)',
  inPlaceRefresh.includes("(pay.last4 != null || pay.method != null) ? ('•• ' + pay.last4 + ' · ' + pay.method) : null"));
const rideCompleteBody = functionBody(passenger, 'renderPassengerRideComplete');
expect('renderPassengerRideComplete shows a truthful neutral payment line instead of a raw "•• null · null" fragment when no real payment method is known',
  rideCompleteBody.includes('const payMethodLine = (pay.last4 != null || pay.method != null)')
    && rideCompleteBody.includes("'Способ оплаты не указан'")
    && rideCompleteBody.includes('${payMethodLine}')
    && !rideCompleteBody.includes('${escapeHtml(payMethodLine)}'));
const swapToTerminal = functionBody(passenger, 'swapToTerminalPassengerScreen');
const renderTerminal = functionBody(passenger, 'renderTerminalPassengerScreen');
expect('swapToTerminalPassengerScreen tears down the mount\'s own read/poll/recovery/listeners before an in-place DOM swap (never a go()-based re-navigation, which would re-fetch and could loop)',
  swapToTerminal.includes('teardownPassengerReads()')
    && swapToTerminal.includes("window.removeEventListener('hashchange', onHashChange)")
    && swapToTerminal.includes('teardownObserver.disconnect()')
    && swapToTerminal.includes('root.replaceWith(renderTerminalPassengerScreen(terminalRide))')
    && !swapToTerminal.includes('go('));
expect('renderTerminalPassengerScreen reuses the exact same unmodified terminal renderers as the backend-off synchronous path (CANCELED/NO_SHOW/unsupported/COMPLETED)',
  renderTerminal.includes("renderPassengerCanceledFallback(terminalRide, 'canceled')")
    && renderTerminal.includes("renderPassengerCanceledFallback(terminalRide, 'no_show')")
    && renderTerminal.includes('renderPassengerStub(PASSENGER_STUB_BY_STATUS[terminalRide.status])')
    && renderTerminal.includes('renderPassengerRideComplete(terminalRide,'));

// ── BD-RIDE-WAITING-01E Codex follow-up — backend-confirmed waiting cleanup ──
// A transient createDemoActiveRide() placeholder (no local canonical record
// yet) can still carry the raw demo waiting.remaining/paidStartsAt when
// mergeServerRide first runs. serializeRide() sends no `waiting` field at
// all today, so the plain keep(local, server) merge used for every other
// sub-object would leave those two fields completely untouched even after
// the server has proven this trip is real. mergeServerWaiting explicitly
// clears them once the server has responded, while keeping the same
// keep()-style precedence (a future non-null server value still wins) for
// freeLimit/paidRate/anything else.
const mergeServerWaiting = functionBody(passenger, 'mergeServerWaiting');
expect('mergeServerWaiting helper is defined',
  mergeServerWaiting.length > 0);
expect('mergeServerWaiting starts from the same keep(local, server) merge behavior (local base, non-null server keys overlay)',
  mergeServerWaiting.includes('const out = { ...(localWaiting || {}) }')
    && mergeServerWaiting.includes('for (const k in (serverWaiting || {}))')
    && mergeServerWaiting.includes('if (serverWaiting[k] != null) out[k] = serverWaiting[k]'));
expect('mergeServerWaiting explicitly clears remaining to null when the server has no non-null remaining',
  mergeServerWaiting.includes('if (!serverWaiting || serverWaiting.remaining == null) out.remaining = null'));
expect('mergeServerWaiting explicitly clears paidStartsAt to null when the server has no non-null paidStartsAt',
  mergeServerWaiting.includes('if (!serverWaiting || serverWaiting.paidStartsAt == null) out.paidStartsAt = null'));
expect('mergeServerWaiting lets a non-null server remaining/paidStartsAt win (the overlay loop runs before the explicit-null clears, and only nulls when the server key itself is null)',
  mergeServerWaiting.indexOf('for (const k in (serverWaiting || {}))') < mergeServerWaiting.indexOf('if (!serverWaiting || serverWaiting.remaining == null)'));
expect('mergeServerRide uses mergeServerWaiting(...) for the waiting sub-object',
  mergeServer.includes('waiting: mergeServerWaiting(ride.waiting, srv.waiting)'));
expect('mergeServerWaiting/mergeServerRide never call saveActiveRide, updateActiveRideStatus, or persist the transient projection',
  !mergeServerWaiting.includes('saveActiveRide(')
    && !mergeServerWaiting.includes('updateActiveRideStatus(')
    && !mergeServer.includes('saveActiveRide(')
    && !mergeServer.includes('updateActiveRideStatus('));
expect('runInitialRead only merges the server ride after a successful read (srv truthy) — the !srv branch returns before mergeServerRide ever runs',
  initialRead.includes('const srv = await readManager.run(ride.tripId)')
    && initialRead.indexOf('if (!srv) {') < initialRead.indexOf('ride = mergeServerRide(srv, recovery)')
    && /if\s*\(!srv\)\s*\{[\s\S]*?return;[\s\S]*?\}/.test(initialRead));

// ── BD-RIDE-WAITING-01E Codex follow-up — explicit local simulation
// provenance (localProvenance = 'sim_audit') ────────────────────────────
// loadPassengerRideView's own transient createDemoActiveRide fallback (no
// real driver-handoff snapshot backing it) can carry localProvenance =
// 'sim_audit', mirroring the driver-side stamp in active_ride.js. A
// successful server read is proof the trip is real, so mergeServerRide
// must delete that marker from its returned projection; null/404/error
// never reach mergeServerRide at all (confirmed by the existing !srv-early-
// return assertion above), so they can never run this cleanup.
const loadPassengerRideView = functionBody(passenger, 'loadPassengerRideView');
expect('loadPassengerRideView can stamp localProvenance = \'sim_audit\' on its own simulation fallback (no real snapshot backing it)',
  loadPassengerRideView.includes("ride.localProvenance = 'sim_audit'"));
expect('mergeServerRide deletes localProvenance from the merged server-backed projection once the server has confirmed the trip is real',
  mergeServer.includes('delete merged.localProvenance;'));
expect('the localProvenance cleanup lives inside mergeServerRide itself, so it is structurally unreachable from the !srv / 404 / error branches (which return before ever calling mergeServerRide)',
  initialRead.indexOf('if (!srv) {') < initialRead.indexOf('ride = mergeServerRide(srv, recovery)')
    && !initialRead.includes("delete ride.localProvenance"));

// ── Codex follow-up — persist server-confirmed passenger waiting into an
// EXISTING stored Ride, and seed the real Ride before boarding ──────────
// Mirrors active_ride.js's persistServerConfirmedWaitingProjection. Unlike
// the driver side, runInitialRead has early maybeReMount branches that can
// navigate/defer BEFORE `ride = mergeServerRide(...)` ever runs, so the
// repair must be computed and invoked right after srv is known non-null —
// not only after the eventual mergeServerRide call.
const passengerRepair = functionBody(passenger, 'persistPassengerServerConfirmedWaitingProjection');
expect('persistPassengerServerConfirmedWaitingProjection helper is defined',
  passengerRepair.length > 0);
expect('the repair helper reads the existing stored ride via findActiveRide(ride.tripId)',
  /const\s+storedRide\s*=\s*findActiveRide\(ride\.tripId\)/.test(passengerRepair));
expect('the repair helper returns without saving when nothing is stored yet (no eager materialization)',
  /if\s*\(!storedRide\)\s*return;/.test(passengerRepair));
expect('the repaired object is based on storedRide — status, timestamps, tripId, orderId, acceptedSource, passenger, driver, vehicle, route, payment, ride, chat, cancel all survive from storage untouched',
  /\{\s*\.\.\.storedRide\s*,/.test(passengerRepair));
expect('only the cleaned waiting projection crosses into the repaired stored copy',
  /waiting:\s*\{\s*\.\.\.\(cleanedWaiting\s*\|\|\s*\{\}\)\s*\}/.test(passengerRepair));
expect('the repair helper deletes localProvenance from the repaired copy',
  /delete\s+repaired\.localProvenance;/.test(passengerRepair));
expect('the repair helper persists through the existing saveActiveRide (so the terminal-freeze guard there still applies unchanged)',
  /saveActiveRide\(repaired\)/.test(passengerRepair));
expect('runInitialRead computes the cleaned waiting and invokes the repair right after srv is known non-null, BEFORE maybeReMount can navigate/defer away',
  (() => {
    const callIdx = initialRead.indexOf(
      'persistPassengerServerConfirmedWaitingProjection(mergeServerWaiting(ride.waiting, srv.waiting));');
    const remountIdx = initialRead.indexOf('maybeReMount(srv.status)');
    return callIdx !== -1 && remountIdx !== -1 && callIdx < remountIdx;
  })());
expect('the repair call sits after the !srv early return (srv is proven non-null before it can run)',
  initialRead.indexOf('if (!srv) {') <
    initialRead.indexOf('persistPassengerServerConfirmedWaitingProjection(mergeServerWaiting(ride.waiting, srv.waiting));'));
expect('the !srv branch does not invoke the server-confirmed repair (no server proof, no repair)',
  (() => {
    const notSrvBlock = initialRead.slice(initialRead.indexOf('if (!srv) {'), initialRead.indexOf('backendRide = true;'));
    return !notSrvBlock.includes('persistPassengerServerConfirmedWaitingProjection(');
  })());
expect('the 404/RIDE_NOT_FOUND catch branch does not invoke the server-confirmed repair',
  (() => {
    const catchBody = initialRead.slice(initialRead.indexOf('} catch (err) {'));
    const notFoundBlock = catchBody.slice(
      catchBody.indexOf("err.status === 404"),
      catchBody.indexOf('const retryable ='));
    return !notFoundBlock.includes('persistPassengerServerConfirmedWaitingProjection(');
  })());
expect('the generic failure/auth/retryable catch tail does not invoke the server-confirmed repair',
  (() => {
    const catchBody = initialRead.slice(initialRead.indexOf('} catch (err) {'));
    const tail = catchBody.slice(catchBody.indexOf('const retryable ='));
    return !tail.includes('persistPassengerServerConfirmedWaitingProjection(');
  })());

const boardedHandlerOuter = functionBody(passenger, 'renderSheet');
expect('the passenger boarded handler calls saveActiveRide(ride) before updateActiveRideStatus(...IN_PROGRESS)',
  (() => {
    const saveIdx = boardedHandlerOuter.indexOf('saveActiveRide(ride);');
    const updateIdx = boardedHandlerOuter.indexOf('updateActiveRideStatus(ride.tripId, RIDE_STATUS.IN_PROGRESS);');
    return saveIdx !== -1 && updateIdx !== -1 && saveIdx < updateIdx;
  })());
expect('the boarded handler still PATCHes the server first (when backendWriteCandidate) before the local save/update pair',
  (() => {
    const patchIdx = boardedHandlerOuter.indexOf("await patchRideStatus(ride.tripId, RIDE_STATUS.IN_PROGRESS)");
    const saveIdx = boardedHandlerOuter.indexOf('saveActiveRide(ride);');
    return patchIdx !== -1 && saveIdx !== -1 && patchIdx < saveIdx;
  })());
expect('a boarding PATCH failure returns before any local save/update (catch block returns before saveActiveRide(ride))',
  (() => {
    const catchIdx = boardedHandlerOuter.indexOf("catch (err) {\n              localToast");
    const saveIdx = boardedHandlerOuter.indexOf('saveActiveRide(ride);');
    const catchBlock = boardedHandlerOuter.slice(catchIdx, saveIdx);
    return catchIdx !== -1 && saveIdx !== -1 && /return;/.test(catchBlock);
  })());
expect('boarding did not gain a second/extra patchRideStatus call',
  (boardedHandlerOuter.match(/patchRideStatus\(/g) || []).length === 1);

// #938-01B-A — requirement #7: a 401/403/5xx/malformed/transport failure on
// the very FIRST-EVER read (epoch === 1) must land in ERROR, never fall back
// to a stale local/demo Ride as if it were confirmed — only a LATER
// recovery/retry read (epoch > 1) of an ALREADY-confirmed ride keeps the
// pre-existing graceful stale-with-banner UX. The gate is scoped by `&&
// epoch > 1`, not `hasUsableLocalRide` alone, so this exact condition is
// pinned to guard against a future "simplification" silently regressing #7.
// Both runInitialRead call sites (the success/refresh path AND the
// generic-failure catch tail) share this exact token, so a plain .includes()
// can't tell them apart — a mutation that strips `&& epoch > 1` from just
// the catch tail still leaves the OTHER, untouched occurrence for .includes()
// to find. Require the exact count (2) instead, and anchor the LAST
// occurrence's position — the catch tail's own — between the failure
// classification and the final ERROR fallback.
expect('the generic-failure catch tail gates its stale-local fallback on epoch > 1, not on hasUsableLocalRide alone — a first-ever-read failure always reaches ERROR',
  (initialRead.match(/if \(hasUsableLocalRide && epoch > 1\) \{/g) || []).length === 2
    && initialRead.indexOf('const retryable = isPassengerRideRecoveryRetryable(err)') < initialRead.lastIndexOf('if (hasUsableLocalRide && epoch > 1) {')
    && initialRead.lastIndexOf('if (hasUsableLocalRide && epoch > 1) {') < initialRead.lastIndexOf('setReadState(PASSENGER_RIDE_READ_STATE.ERROR)'));
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
// #938-01B-A review-fix — this exact token also appears in the OTHER
// (epoch>1 graceful-banner) branch above, so a plain .includes() above
// cannot tell whether THIS occurrence — the one requirement #7 actually
// added, preserving background self-healing for a first-ever-read (epoch===1)
// retryable failure — is present, missing, or misplaced. Anchor on the
// literal adjacency to the final setReadState(ERROR) call (only the
// epoch===1 fallthrough's occurrence is immediately followed by it — the
// epoch>1 branch's occurrence is followed by `else stopPassengerRideRecovery()`
// instead) and require the exact count of two, so neither occurrence can be
// silently dropped or duplicated.
expect('the first-ever-read (epoch===1) failure path also schedules background recovery for a retryable failure, positioned immediately before the final ERROR fallback — distinct from the epoch>1 graceful-banner branch\'s own occurrence',
  /if \(retryable && hasPersistedLocalRide\) schedulePassengerRideRecovery\(\);\s*\n\s*setReadState\(PASSENGER_RIDE_READ_STATE\.ERROR\);/.test(initialRead)
    && (initialRead.match(/if \(retryable && hasPersistedLocalRide\) schedulePassengerRideRecovery\(\);/g) || []).length === 2);
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
const cancelSheetCommit = functionBody(passengerSheets, 'commitCancel');
expect('terminal cancel abort closes the stale sheet before false canceled UI and exposes reconciliation intent',
  review9CancelBinder.includes('aborted: true')
    && review9CancelBinder.includes("reconcile: 'deferred-terminal'")
    && cancelSheetCommit.includes('if (meta.aborted === true)')
    && cancelSheetCommit.includes('close()')
    && cancelSheetCommit.indexOf('if (meta.aborted === true)') < cancelSheetCommit.indexOf('cancelTimer = setTimeout')
    && cancelSheetCommit.indexOf('close()') < cancelSheetCommit.indexOf("overlay.dataset.stage = 'canceled'"));
expect('deferred forward status keeps the highest pending lifecycle rank while overlays stay open',
  remount.includes('const pendingRank = STATUS_RANK[deferredPassengerServerStatus] ?? -1')
    && remount.includes('const nextRank = STATUS_RANK[srvStatus] ?? 0')
    && remount.includes('nextRank > pendingRank'));
// #938-01B-A — runInitialRead now calls mergeServerRide(srv, recovery)
// TWICE: once early, only for a status that needsSeparatePassengerRenderer
// (an unconditional check that must see the terminal renderer's own merge
// regardless of maybeReMount, and returns before ever reaching the
// DEFERRED-handling code below it), and once after the maybeReMount check,
// which is the merge this invariant is actually about. lastIndexOf targets
// that second, post-remount call specifically — indexOf would wrongly
// compare against the earlier, unrelated terminal-swap merge instead.
expect('deferred recovery returns before merging server status into the current ride',
  initialRead.includes('remountResult === PASSENGER_REMOUNT_RESULT.DEFERRED')
    && initialRead.indexOf('remountResult === PASSENGER_REMOUNT_RESULT.DEFERRED') < initialRead.lastIndexOf('ride = mergeServerRide(srv, recovery)')
    && (initialRead.match(/ride = mergeServerRide\(srv, recovery\)/g) || []).length === 2
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
expect('HTTP 408/429/5xx stay transient even when retryable metadata is false or absent',
  retryability.includes('if (Number.isFinite(status))')
    && retryability.includes('if (status === 408 || status === 429 || status >= 500) return true')
    && retryability.indexOf('status === 408 || status === 429 || status >= 500') < retryability.indexOf('err.retryable === false')
    && retryability.includes('if (err.retryable === false) return false'));
const recovery = functionBody(passenger, 'schedulePassengerRideRecovery');
expect('local fallback recovery retries only persisted participant-gated rides without overlapping poll semantics',
  recovery.includes('!hasPersistedLocalRide')
    && recovery.includes('setTimeout')
    && recovery.includes('runInitialRead(true)')
    && recovery.includes('PASSENGER_RIDE_POLL_MS'));
// BD-RIDE-PASSENGER-WAIT-COUNTDOWN-01A (#911) final code-review fix — the
// previous version of this pin searched for the first startPassengerRidePoll()
// at or after backendRide = true, which actually matches the earlier
// DEFERRED-branch call (line ~2785, reached before `ride = mergeServerRide`
// ever runs), not the normal success-path call after the merge/render. That
// let the pin stay green even if the real normal-success poll-start call
// were deleted, as long as the DEFERRED call survived. Pin the exact normal
// sequence by name instead: mergeServerRide -> renderLoadedRide(recovery) ->
// startPassengerRidePoll(), each searched strictly after the previous one.
const successMergeIndex = initialRead.indexOf('ride = mergeServerRide(srv, recovery);');
const successRenderIndex = initialRead.indexOf('renderLoadedRide(recovery);', successMergeIndex);
const successStartPollIndex = initialRead.indexOf('startPassengerRidePoll();', successRenderIndex);
expect('the normal server-success sequence starts the poll: ride = mergeServerRide(...) -> renderLoadedRide(recovery) -> startPassengerRidePoll()',
  successMergeIndex !== -1 && successRenderIndex !== -1 && successStartPollIndex !== -1
    && successMergeIndex < successRenderIndex && successRenderIndex < successStartPollIndex);
expect('the normal server-success startPassengerRidePoll() call still comes after backendRide = true is set',
  initialRead.indexOf('backendRide = true') !== -1
    && initialRead.indexOf('backendRide = true') < successStartPollIndex);
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

// #887 — LOCAL_ONLY cross-tab store reconciliation (repair of #886). The former
// standalone passenger_local_ride_sync.js re-derived trip identity independently
// on every reconciliation (explicit tripId → findLatestHandedOffOrderTripId() →
// demo) and duplicated the SERVER_BACKED forward/deferred-terminal/queued-click
// pipeline. The repair deletes that controller and folds LOCAL_ONLY observation
// into active_ride_passenger.js itself, reusing the mounted `ride.tripId`, the
// existing STATUS_RANK table, maybeReMount and the deferred-terminal cancel gate.
const reconcileLocalOnly = functionBody(passenger, 'reconcileLocalOnlyRide');
const onActiveRideStorage = functionBody(passenger, 'onActiveRideStorage');
const teardownReads = functionBody(passenger, 'teardownPassengerReads');
expect('#887 standalone passenger_local_ride_sync.js controller is removed',
  !app.includes('passenger_local_ride_sync')
    && !app.includes('initPassengerLocalRideSync')
    && !sw.includes("'./src/passenger_local_ride_sync.js'"));
expect('#887 observes only the canonical active-ride storage key and removes the listener on teardown',
  passenger.includes("const ACTIVE_RIDE_LOCAL_STORAGE_KEY = 'bazardrive.active_ride.v1'")
    && onActiveRideStorage.includes('event.key !== ACTIVE_RIDE_LOCAL_STORAGE_KEY')
    && passenger.includes("if (!fixture) window.addEventListener('storage', onActiveRideStorage)")
    && teardownReads.includes("window.removeEventListener('storage', onActiveRideStorage)"));
expect('#887 reconciliation re-reads by the tripId this screen mounted with, never re-derives it',
  reconcileLocalOnly.includes('findActiveRide(ride.tripId)')
    && !reconcileLocalOnly.includes('findLatestHandedOffOrderTripId')
    && !onActiveRideStorage.includes('findLatestHandedOffOrderTripId'));
expect('#887 subscription is gated to LOCAL_ONLY ownership and skips fixture/destroyed screens',
  reconcileLocalOnly.includes('if (destroyed || fixture) return PASSENGER_REMOUNT_RESULT.NONE')
    && reconcileLocalOnly.includes('passengerRideOwnership !== PASSENGER_RIDE_OWNERSHIP.LOCAL_ONLY'));
expect('#887 LOCAL_ONLY forward reconciliation delegates to the existing maybeReMount pipeline (no duplicate rank table)',
  reconcileLocalOnly.includes('return maybeReMount(nextRide.status)')
    && !/LOCAL_STATUS_RANK|isForwardPassengerLocalStatus/.test(passenger));
expect('#887 ownership settlement re-checks the store for a transition missed before subscription',
  initialRead.includes('setPassengerRideOwnership(PASSENGER_RIDE_OWNERSHIP.LOCAL_ONLY)')
    && (initialRead.match(/reconcileLocalOnlyRide\(\) === PASSENGER_REMOUNT_RESULT\.NAVIGATED/g)?.length ?? 0) >= 2);
expect('#887 local observer is read-only and cannot become a status writer',
  !/\bupdateActiveRideStatus\(|\bsaveActiveRide\(|\bpatchRideStatus\(|\bupdateTripStatus\(/.test(reconcileLocalOnly + onActiveRideStorage));
expect('#887 SERVER_BACKED ownership does not react to a local storage write (guard precedes the read)',
  reconcileLocalOnly.indexOf('passengerRideOwnership !== PASSENGER_RIDE_OWNERSHIP.LOCAL_ONLY')
    < reconcileLocalOnly.indexOf('findActiveRide(ride.tripId)'));

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

expect('#887 service worker moves monotonically to v286+ and no longer precaches the deleted controller',
  Number(sw.match(/const VERSION\s*=\s*'v(\d+)'/)?.[1] || 0) >= 286
    && !sw.includes("'./src/passenger_local_ride_sync.js'"));

if (issues.length) {
  console.error(`\n${issues.length} 02D regression(s) failed.`);
  process.exit(1);
}
console.log('\nPassenger Active Ride loading-state smoke passed.');
