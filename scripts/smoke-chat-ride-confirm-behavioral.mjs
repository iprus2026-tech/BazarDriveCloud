// BD-CHAT-FALLBACK-02 — behavioral (not just source-pattern) smoke for the
// #891 Codex P2 Finding 2 repair: a chat opened for a tripId that missed the
// local active-ride store must never assert the ride was accepted until a
// real server ride confirms it. This imports and EXECUTES the real
// resolveChatHydration / hydrateFromRealRide functions from chat.js (both
// are pure — no DOM/network side effects of their own) with constructed
// inputs, and pipes the result through the real ride_state.js label/tone
// resolvers, so the assertions prove what Chat would actually render for a
// given server ride — not merely that the string "getRideFromBackend"
// appears in the source.
//
// In-memory localStorage shim, same pattern as smoke-active-ride-cancel-terminal.mjs
// / smoke-order-detail-contract.mjs — no browser, no jsdom.
const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { _store.delete(k); },
  clear: () => { _store.clear(); },
};

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

const chatMod = await import(new URL('../public/src/screens/chat.js', import.meta.url).href);
const rideState = await import(new URL('../public/src/ride_state.js', import.meta.url).href);
const { resolveChatHydration, hydrateFromRealRide } = chatMod;
const { RIDE_STATUS, resolveRideStatusLabel, resolveRideStatusTone, saveActiveRideStore, isTerminalRideStatus } = rideState;

// ── A. hydrateFromRealRide + the REAL label/tone resolvers, given a mocked
//      server ride with status: IN_PROGRESS ─────────────────────────────
const mockServerRide = {
  tripId: 'trip_behavioral_inprogress',
  status: RIDE_STATUS.IN_PROGRESS,
  route: { pickupLabel: 'Москва', dropoffLabel: 'Тула' },
  driver: { name: 'Иван И.', initials: 'ИИ', rating: '4.80', onlineLabel: 'в сети' },
  passenger: { name: 'Анна А.', initials: 'АА' },
  ride: { price: 1500 },
};
const hydratedForPassenger = hydrateFromRealRide(mockServerRide, 'passenger');
expect('hydrateFromRealRide passes a real server ride\'s status straight through unchanged (IN_PROGRESS, not a fallback)',
  hydratedForPassenger.trip.status === RIDE_STATUS.IN_PROGRESS);
expect('hydrateFromRealRide renders the passenger viewer\'s counterpart as the DRIVER (real name/initials, not MOCK_DRIVER)',
  hydratedForPassenger.counterpart.name === 'Иван И.' && hydratedForPassenger.counterpart.initials === 'ИИ');
expect('hydrateFromRealRide carries the real route through (not MOCK_TRIP\'s Москва → Тула placeholder pair coincidentally matching)',
  hydratedForPassenger.trip.from === 'Москва' && hydratedForPassenger.trip.to === 'Тула'
  && hydratedForPassenger.trip.price === 1500);

const realLabel = resolveRideStatusLabel(hydratedForPassenger.trip.status);
const realTone  = resolveRideStatusTone(hydratedForPassenger.trip.status);
expect('the REAL ride_state.js resolver gives IN_PROGRESS its true canonical label ("В пути"), not the neutral/accepted fallback',
  realLabel === 'В пути' && realLabel !== 'Принят' && realLabel !== 'Не подтверждено');
expect('the REAL ride_state.js resolver gives IN_PROGRESS its true tone ("success"), not the pending-confirm "muted" tone',
  realTone === 'success' && realTone !== 'muted');

// ── B. resolveChatHydration's server-backed local-miss branch (Finding 2) —
//      behavioral proof across the authorized matrix, using the sanctioned
//      globalThis.__BD_API_BASE__ test hook (api_config.js) to flip
//      isBackendEnabled() without touching CSP/build config ──────────────
function withBackend(base, fn) {
  const prior = globalThis.__BD_API_BASE__;
  globalThis.__BD_API_BASE__ = base;
  try { return fn(); } finally { globalThis.__BD_API_BASE__ = prior; }
}

const missingTripId = 'trip_behavioral_no_such_ride';

const offExplicitRole = withBackend('', () => resolveChatHydration({
  tripId: missingTripId, responseId: null, orderId: null, viewerRole: 'passenger', hasExplicitRole: true,
}));
expect('backend OFF + local miss + explicit role -> confirmed:false, no pendingBackendConfirm (nothing to ask)',
  offExplicitRole.confirmed === false && !offExplicitRole.pendingBackendConfirm);

const onExplicitRole = withBackend('https://fake.test', () => resolveChatHydration({
  tripId: missingTripId, responseId: null, orderId: null, viewerRole: 'passenger', hasExplicitRole: true,
}));
expect('backend ON + local miss + explicit role -> confirmed:false + pendingBackendConfirm:true, neutral status (never affirmative before the async read)',
  onExplicitRole.confirmed === false
  && onExplicitRole.pendingBackendConfirm === true
  && onExplicitRole.trip.status === 'Не подтверждено');

// ── B2. Finding 3 (Codex P2 follow-up) — trip_confirmation.js's passenger
//      chat handoff (chatHref, #732/#743) threads tripId + responseId +
//      role=passenger together on purpose: responseId hydrates the thread
//      from the stored driver offer BEFORE the active ride is seeded. The
//      server-backed local-miss branch must reuse that response-backed
//      hydration (the real offered price) instead of generic MOCK_TRIP data
//      while the backend confirm is pending ─────────────────────────────
const seededResponseId = 'resp_behavioral_pending';
_store.set('bazardrive.responses.v1', JSON.stringify({
  [seededResponseId]: { driverPrice: 3300, requestId: 'req_behavioral_pending' },
}));
const onWithResponse = withBackend('https://fake.test', () => resolveChatHydration({
  tripId: missingTripId, responseId: seededResponseId, orderId: null, viewerRole: 'passenger', hasExplicitRole: true,
}));
expect('backend ON + local miss + explicit role + a stored response (trip_confirmation.js\'s tripId+responseId+role handoff) -> confirmed:false + pendingBackendConfirm:true, but hydrated from the REAL stored offer price (3300 ₽), not MOCK_TRIP\'s placeholder',
  onWithResponse.confirmed === false
  && onWithResponse.pendingBackendConfirm === true
  && onWithResponse.trip.price === '3300 ₽'
  && onWithResponse.response && onWithResponse.response.driverPrice === 3300);
_store.delete('bazardrive.responses.v1');

const onBareFeedLink = withBackend('https://fake.test', () => resolveChatHydration({
  tripId: missingTripId, responseId: null, orderId: null, viewerRole: 'passenger', hasExplicitRole: false,
}));
expect('backend ON + local miss + NO explicit role (bare /chat?tripId=<feed-post-id> — the original #891 bug shape) -> confirmed:false, no pendingBackendConfirm; the original #891 fix is not regressed by a live backend',
  onBareFeedLink.confirmed === false && !onBareFeedLink.pendingBackendConfirm);

// ── C. resolveChatHydration's synchronous real-ride branch, seeded via the
//      SAME localStorage shim (proves the local-hit path end to end, not
//      just via regex on the source) ─────────────────────────────────────
const seededTripId = 'trip_behavioral_local_hit';
saveActiveRideStore({
  [seededTripId]: {
    tripId: seededTripId,
    status: RIDE_STATUS.WAITING_PASSENGER,
    route: { pickupLabel: 'Казань', dropoffLabel: 'Самара' },
    driver: { name: 'Пётр П.', initials: 'ПП' },
    passenger: {},
    ride: { price: 900 },
  },
});
const localHit = resolveChatHydration({
  tripId: seededTripId, responseId: null, orderId: null, viewerRole: 'passenger', hasExplicitRole: true,
});
expect('a genuine local active-ride hit resolves confirmed:true with the REAL seeded status (WAITING_PASSENGER), synchronously, no backend involved',
  localHit.confirmed === true && localHit.trip.status === RIDE_STATUS.WAITING_PASSENGER
  && localHit.trip.from === 'Казань' && localHit.trip.to === 'Самара');
_store.clear();

// ── D. Finding 4/5 (Codex P2 follow-up on fb0ae01) — the exact decision
//      inputs applyConfirmedRide uses to decide a late terminal lock and to
//      refresh the counterpart. applyConfirmedRide itself is a private,
//      DOM-mutating closure inside chat() (no DOM in smokes, repo-wide
//      rule), so this drives its INPUT through the same two real functions
//      it actually calls — hydrateFromRealRide, then the REAL
//      isTerminalRideStatus from ride_state.js (not a reimplementation) —
//      proving the decision chat.js's `if (!isTerminal &&
//      isTerminalRideStatus(trip.status)) { isTerminal = true; stopPolling();
//      applyTerminalLock(); syncComposerAvailability(); }` makes for each
//      status. That exact wiring (the DOM/state side) is pinned statically
//      in smoke-chat-bridge.mjs and mutation-tested there ──────────────────
const mockInProgressRide = {
  status: RIDE_STATUS.IN_PROGRESS,
  route: { pickupLabel: 'Уфа', dropoffLabel: 'Стерлитамак' },
  driver: { name: 'Олег О.', initials: 'ОО', rating: '4.70' },
  passenger: {},
  ride: { price: 700 },
};
const hydratedInProgress = hydrateFromRealRide(mockInProgressRide, 'passenger');
expect('IN_PROGRESS server ride -> the REAL isTerminalRideStatus(trip.status) is false: applyConfirmedRide\'s late-lock guard stays closed, the thread remains writable (poll keeps running, send/quick-replies stay enabled)',
  isTerminalRideStatus(hydratedInProgress.trip.status) === false);
expect('IN_PROGRESS server ride -> hydrateFromRealRide carries the REAL counterpart identity, which Object.assign(counterpart, real.counterpart) copies onto the live object every future renderMessage() reads',
  hydratedInProgress.counterpart.name === 'Олег О.' && hydratedInProgress.counterpart.initials === 'ОО');

const mockCompletedRide = {
  status: RIDE_STATUS.COMPLETED,
  route: { pickupLabel: 'Уфа', dropoffLabel: 'Стерлитамак' },
  driver: { name: 'Олег О.', initials: 'ОО', rating: '4.70' },
  passenger: {},
  ride: { price: 700 },
};
const hydratedCompleted = hydrateFromRealRide(mockCompletedRide, 'passenger');
expect('COMPLETED server ride -> the REAL isTerminalRideStatus(trip.status) is true: applyConfirmedRide\'s late-lock guard opens (isTerminal flips, stopPolling() stops the message poll, applyTerminalLock() disables send + hides quick-replies + shows the terminal note)',
  isTerminalRideStatus(hydratedCompleted.trip.status) === true);
expect('CANCELED and NO_SHOW server rides are ALSO terminal via the same real resolver (not just COMPLETED) — the late-lock guard covers all three, matching isTerminalRideStatus\'s own contract',
  isTerminalRideStatus(RIDE_STATUS.CANCELED) === true && isTerminalRideStatus(RIDE_STATUS.NO_SHOW) === true);

// ── E. Finding 6 (Codex P2 follow-up on f04fcfe) — hydrateFromRealRide
//      derives initials from the real name when the server omitted them
//      (bootstrapRide never writes driver_initials), and never returns
//      ride.driver/ride.passenger by reference ─────────────────────────
const mockRideNoInitials = {
  status: RIDE_STATUS.ACCEPTED,
  route: { pickupLabel: 'Тверь', dropoffLabel: 'Клин' },
  driver: { name: 'Сергей Волков', initials: null, rating: '4.60' },
  passenger: {},
  ride: { price: 550 },
};
const hydratedNoInitials = hydrateFromRealRide(mockRideNoInitials, 'passenger');
expect('a server ride with initials:null (the real bootstrapRide gap — driver_initials is never written) derives two letters from the real name instead of showing a blank avatar',
  hydratedNoInitials.counterpart.initials === 'СВ');
expect('hydrateFromRealRide never returns ride.driver by reference — mutating the returned counterpart does NOT mutate the caller\'s original ride object (applyConfirmedRide + a future Object.assign must not be able to corrupt the raw server payload)',
  (() => {
    const before = mockRideNoInitials.driver.name;
    hydratedNoInitials.counterpart.name = 'MUTATED';
    const unaffected = mockRideNoInitials.driver.name === before;
    hydratedNoInitials.counterpart.name = before; // restore, this object is otherwise reused below
    return unaffected;
  })());
const mockRideEmptyName = { status: RIDE_STATUS.ACCEPTED, route: {}, driver: {}, passenger: {}, ride: {} };
expect('a server ride with no name AND no initials degrades to an empty string (never null/undefined/"undefined"), matching the existing counterpart.initials || \'\' template fallback',
  hydrateFromRealRide(mockRideEmptyName, 'passenger').counterpart.initials === '');

// Proves the shared-mock hazard is REAL, not hypothetical: two independent
// pending-branch calls that both fall through to the module-level MOCK_DRIVER
// share the exact same object — mutating one is observable through the
// other. This is why chat() MUST clone hydration.counterpart before
// applyConfirmedRide's Object.assign ever touches it (pinned + mutation-
// tested separately in smoke-chat-bridge.mjs, since that clone lives inside
// chat()'s private, DOM-bound closure and can't be exercised here).
const missingTripIdForMockCheck = 'trip_behavioral_mock_shared_ref_check';
const pendingA = withBackend('https://fake.test', () => resolveChatHydration({
  tripId: missingTripIdForMockCheck, responseId: null, orderId: null, viewerRole: 'driver', hasExplicitRole: false,
}));
const pendingB = withBackend('https://fake.test', () => resolveChatHydration({
  tripId: 'trip_behavioral_mock_shared_ref_check_2', responseId: null, orderId: null, viewerRole: 'driver', hasExplicitRole: false,
}));
expect('two unrelated resolveChatHydration calls that both fall through to the generic no-real-ride fallback share the SAME counterpart object reference (confirms the hazard applyConfirmedRide\'s Object.assign would otherwise trigger)',
  pendingA.counterpart === pendingB.counterpart);
const originalName = pendingA.counterpart.name;
pendingA.counterpart.name = 'LEAKED';
const leaked = pendingB.counterpart.name === 'LEAKED';
pendingA.counterpart.name = originalName; // restore the shared mock for any later smoke run in this process
expect('mutating one call\'s counterpart is observable through the other unrelated call\'s counterpart (the exact cross-screen leak Codex flagged) — proves chat()\'s defensive clone is necessary, not defensive-for-nothing',
  leaked === true);

const fails = issues.length;
console.log(`\n=== smoke-chat-ride-confirm-behavioral: ${fails ? 'FAIL' : 'PASS'} (${fails} issue(s)) ===`);
if (fails) {
  console.log('\nFAIL ' + fails + ' expectation(s):');
  for (const i of issues) console.log('  - ' + i);
  process.exitCode = 1;
}
