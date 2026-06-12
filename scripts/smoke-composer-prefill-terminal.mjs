// BD-COMPOSER-PREFILL-TERM-01 — composer prefill consumer audit smoke.
//
// BD-ROUTE-TEMPLATE-TERM-01 locked the WRITER side of the route-template
// bridge: `repeat_route.js` + `favorite_routes.js` only ever persist a
// route-only `{role, pickup, dropoff, suggestedFare?}` draft and a
// `{source, label}` notice. This smoke locks the CONSUMER side — the
// composer (`screens/composer.js`) reads the draft via
// `consumeRepeatRouteDraft()` and must never re-introduce terminal
// actor / identity / payment / receipt / earnings / chat / vehicle
// metadata into either:
//   • the composer draft (`bazardrive.draft.v2`), or
//   • the published payload that lands in `bazardrive.ride_orders.v1`
//     via `mock_api.createRideOrder` / `createFeedPost`.
//
// Architecture (verified in source — no runtime changes required):
//
//   1. `applyRepeatRoute(draft, repeat)` whitelists the apply path —
//      writes ONLY `type`, `from`, `to`, and (suggestedFare → `price` for
//      driver, → `budget` for passenger).
//   2. Draft-collision rule: prefill applies only when the existing draft
//      is empty (`Object.entries(draft).some(([k,v]) => k !== 'type' && v)` is false).
//      If the user has unsaved work, the consumed draft is discarded and
//      the existing draft is preserved.
//   3. `buildRideOrderFromComposerDraft(d, u)` reads ONLY `d` (collected
//      from form fields) and `u` (current user via `state.js::user.get()`).
//      It never reads from history / receipts / active-ride / DriverOffer
//      stores.
//   4. `createRideOrder()` (mock_api.js) hardcodes `status: 'CREATED'`
//      and never carries `cancel.by` / `canceledAt` / `payment.method` /
//      `receipt` / `earnings` / `chat` / `messages` / `noShowAt` fields.
//   5. Favorite-notice flow (`enhanceComposerNotice` in favorite_routes.js)
//      ONLY mutates DOM text — never touches the draft state object.
//      Composer.js itself never imports `favorite_routes.js`.
//
// IMPORTANT NUANCE: the legitimate current-user passenger snapshot built
// by `buildPassengerSnapshotFromUser(u, commentText)` from `state.js::user.get()`
// IS expected on a passenger-request order and is NOT a terminal-template
// leak. The forbidden thing is stale identity / payment / receipt / cancel
// metadata from a PRIOR ride flowing through the repeat-route bridge.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// In-memory localStorage shim — same pattern as smoke-route-template-terminal.mjs.
const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => _store.has(k) ? _store.get(k) : null,
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { _store.delete(k); },
  clear: () => { _store.clear(); },
};

// Canonical storage keys — pinned via constants so assertions can compare
// directly against the source-of-truth strings.
const COMPOSER_DRAFT_KEY = 'bazardrive.draft.v2';
const REPEAT_ROUTE_KEY   = 'bazardrive.repeat_route.v1';
const FAVORITE_NOTICE_KEY = 'bazardrive.favorite_route_notice.v1';
const RIDE_ORDERS_KEY    = 'bazardrive.ride_orders.v1';
const RIDE_HISTORY_KEY   = 'bazardrive.ride_history.v1';
const DRIVER_RECEIPTS_KEY = 'bazardrive.driver_receipts.v1';
const ACTIVE_RIDE_KEY    = 'bazardrive.active_ride.v1';
const DRIVER_OFFERS_KEY  = 'bazardrive.driver_offers.v1';

const repeat  = await import(new URL('../public/src/repeat_route.js', import.meta.url).href);
const favorite = await import(new URL('../public/src/favorite_routes.js', import.meta.url).href);
const mockApi  = await import(new URL('../public/src/mock_api.js', import.meta.url).href);

// Source files for static / source-pin assertions.
const composerSrc = read('../public/src/screens/composer.js');
const favoriteSrc = read('../public/src/favorite_routes.js');
const mockApiSrc  = read('../public/src/mock_api.js');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const composerNoComments = stripComments(composerSrc);

// Brace-counting function-body extractor — same shape as the helper from
// smoke-ride-history-terminal.mjs. Tolerates nested if/else inside the
// extracted function, which the source pins below rely on.
function extractFunctionBody(source, functionName) {
  const start = source.indexOf(`function ${functionName}`);
  if (start === -1) return null;
  const paren = source.indexOf('(', start);
  if (paren === -1) return null;
  let pdepth = 0;
  let afterParams = -1;
  for (let i = paren; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') pdepth++;
    else if (ch === ')') {
      pdepth--;
      if (pdepth === 0) { afterParams = i + 1; break; }
    }
  }
  if (afterParams === -1) return null;
  const open = source.indexOf('{', afterParams);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

// Forbidden terminal / identity fields that must not leak from a
// prior-ride history snapshot into the route-template bridge or its
// consumers. Two surface-specific subsets keep legitimate fields out
// of the negative-pin sweep:
//
//   • FORBIDDEN_ON_DRAFT excludes `phone` — the composer's own `phone`
//     field is a user-fillable trip-post field; the bridge contract is
//     that `phone` MUST NOT be prefilled FROM a repeat draft, not that
//     the field itself can't exist on the draft. Section G verifies
//     `draft.phone === ''` (empty, unprefilled) instead of using
//     hasOwnProperty against the master list.
//
//   • FORBIDDEN_ON_ORDER excludes `status` — `createRideOrder` legitimately
//     stamps `status: 'CREATED'` on every new order. The contract is
//     that `status` MUST NOT be a TERMINAL value (CANCELED / NO_SHOW /
//     COMPLETED) inherited from the prior ride; a separate pin asserts
//     `order.status === 'CREATED'`.
const FORBIDDEN_TERMINAL_FIELDS = [
  'driver', 'vehicle', 'phone', 'rating',
  'chat', 'messages',
  'payment', 'receipt', 'earnings',
  'status', 'canceledBy', 'cancel', 'cancelReason',
  'completedAt', 'canceledAt', 'noShowAt',
];
const FORBIDDEN_ON_DRAFT = FORBIDDEN_TERMINAL_FIELDS.filter((f) => f !== 'phone');
const FORBIDDEN_ON_ORDER = FORBIDDEN_TERMINAL_FIELDS.filter((f) => f !== 'status');

// Build a poisoned ride-history entry — same fixture-shape used by
// smoke-route-template-terminal.mjs section E. Sections C and G push
// this through the repeat-route bridge into the composer-equivalent
// path and assert no smuggled content survives.
function poisonedRideEntry(overrides = {}) {
  return {
    tripId:    'trip-prefill-poisoned-1',
    role:      'passenger',
    status:    'COMPLETED',
    route:     { pickupLabel: 'Prefill pickup ✓', dropoffLabel: 'Prefill dropoff ✓' },
    fare:      '1 480 ₽',
    distance:  '12,3 км',
    duration:  '24 мин',
    completedAt: '2026-06-01T10:30:00.000Z',
    canceledAt:  '2026-06-01T10:00:00.000Z',
    driver:    { name: 'Stale Driver',    initials: 'SD', rating: '4,99', phoneMasked: '+7 ... 99-99' },
    passenger: { name: 'Stale Passenger', initials: 'SP', rating: '4,88', phoneMasked: '+7 ... 88-88' },
    vehicle:   { model: 'Stale Model · grey', color: 'grey', plate: 'X000XX000' },
    payment:   { method: 'cash', amount: '1 480 ₽', last4: '1234' },
    receipt:   { fare: 1480, commission: -180, tip: 100, net: 1400, paymentMode: 'noncash', status: 'completed' },
    earnings:  { gross: 1480, commissionAmount: 180, net: 1400 },
    rating:    5,
    comment:   'Stale comment from the prior ride',
    chat:      { unread: 3, lastMessage: 'stale chat' },
    messages:  [{ id: 'm1', text: 'stale' }],
    cancel:    { by: 'driver', reason: 'car_problem' },
    canceledBy: 'driver',
    noShowAt:  '2026-06-01T09:00:00.000Z',
    ...overrides,
  };
}

// Reconstruct the composer's `applyRepeatRoute` logic for behavioral
// sections. Lifted verbatim from screens/composer.js:102-112; section A
// pins this against the source via a structural regex so any future
// change to the apply path surfaces immediately.
function applyRepeatRouteEquivalent(draft, repeatDraft) {
  const isDriver = repeatDraft.role === 'driver';
  draft.type = isDriver ? 'trip' : 'passenger';
  draft.from = repeatDraft.pickup;
  draft.to   = repeatDraft.dropoff;
  if (repeatDraft.suggestedFare != null) {
    const fare = String(repeatDraft.suggestedFare);
    if (isDriver) draft.price = fare;
    else draft.budget = fare;
  }
  return draft;
}

// ── A. composer imports + applyRepeatRoute mapping (source pins) ────

expect('A — composer.js imports consumeRepeatRouteDraft from repeat_route.js',
  /import\s*\{[\s\S]*?consumeRepeatRouteDraft[\s\S]*?\}\s*from\s*['"]\.\.\/repeat_route\.js['"]/.test(composerSrc));
expect('A — composer.js imports createRideOrder + createFeedPost + LOCAL_USER_ID from mock_api.js',
  /import\s*\{[\s\S]*?createRideOrder[\s\S]*?\}\s*from\s*['"]\.\.\/mock_api\.js['"]/.test(composerSrc)
  && /createFeedPost/.test(composerSrc)
  && /LOCAL_USER_ID/.test(composerSrc));
expect('A — composer.js exports clearComposerDraft + default screen factory',
  /export\s+function\s+clearComposerDraft\s*\(/.test(composerSrc)
  && /export\s+default\s+function\s+composer\s*\(/.test(composerSrc));

// ── A1. applyRepeatRoute writes ONLY {type, from, to, price|budget} ─
{
  const body = extractFunctionBody(composerNoComments, 'applyRepeatRoute');
  expect('A1 — applyRepeatRoute body resolved (brace-counted)',
    !!body && body.length > 0);
  // Whitelist of fields the apply path is allowed to touch.
  expect('A1 — applyRepeatRoute writes draft.type',
    /draft\.type\s*=/.test(body || ''));
  expect('A1 — applyRepeatRoute writes draft.from',
    /draft\.from\s*=\s*repeat\.pickup/.test(body || ''));
  expect('A1 — applyRepeatRoute writes draft.to',
    /draft\.to\s*=\s*repeat\.dropoff/.test(body || ''));
  expect('A1 — applyRepeatRoute writes draft.price for driver branch',
    /isDriver[\s\S]{0,200}draft\.price\s*=/.test(body || ''));
  expect('A1 — applyRepeatRoute writes draft.budget for passenger branch',
    /else\s*draft\.budget\s*=/.test(body || ''));
  // Forbidden — applyRepeatRoute must never assign these fields.
  for (const forbidden of [
    'driver', 'passenger',  // identity objects (note: type='passenger' is a string literal value, not a draft field assignment)
    'vehicle', 'phone', 'rating',
    'chat', 'messages', 'comment',
    'payment', 'receipt', 'earnings',
    'status', 'cancel', 'canceledBy', 'cancelReason',
    'completedAt', 'canceledAt', 'noShowAt',
    'tripId',
  ]) {
    expect(`A1 — applyRepeatRoute does NOT assign draft.${forbidden}`,
      !new RegExp(`draft\\.${forbidden}\\s*=`).test(body || ''));
  }
}

// ── A2. applyRepeatRouteEquivalent matches the source contract ──────
// Behavioral assertion using the local equivalent — drives confidence
// the source pin and the live behaviour stay in lockstep.
{
  const draftDriver = {};
  applyRepeatRouteEquivalent(draftDriver, {
    role: 'driver', pickup: 'A', dropoff: 'B', suggestedFare: 1480,
  });
  expect('A2 — driver: type=trip, from=A, to=B, price="1480"',
    draftDriver.type === 'trip'
    && draftDriver.from === 'A'
    && draftDriver.to === 'B'
    && draftDriver.price === '1480'
    && draftDriver.budget === undefined);
  const draftPassenger = {};
  applyRepeatRouteEquivalent(draftPassenger, {
    role: 'passenger', pickup: 'A', dropoff: 'B', suggestedFare: 999,
  });
  expect('A2 — passenger: type=passenger, from=A, to=B, budget="999"',
    draftPassenger.type === 'passenger'
    && draftPassenger.from === 'A'
    && draftPassenger.to === 'B'
    && draftPassenger.budget === '999'
    && draftPassenger.price === undefined);
  // No fare → no price / budget assignment.
  const draftNoFare = {};
  applyRepeatRouteEquivalent(draftNoFare, {
    role: 'passenger', pickup: 'A', dropoff: 'B',
  });
  expect('A2 — missing suggestedFare → no price/budget assignment',
    draftNoFare.price === undefined && draftNoFare.budget === undefined);
}

// ── B. Draft-collision logic — source pins ──────────────────────────
{
  // The composer screen factory contains the collision logic inline
  // (lines 338-349 in screens/composer.js). Pin the structural shape:
  //   1. consumeRepeatRouteDraft() is the read-and-remove call;
  //   2. an existing-data check against the loaded draft uses
  //      `Object.entries(draft).some(([k, v]) => k !== 'type' && v)`;
  //   3. the 'kept' branch sets repeatNotice but does NOT call applyRepeatRoute;
  //   4. the 'applied' branch calls applyRepeatRoute + saveDraft.

  expect('B — composer calls consumeRepeatRouteDraft()',
    /const\s+repeat\s*=\s*consumeRepeatRouteDraft\s*\(\s*\)/.test(composerSrc));
  expect('B — composer initializes repeatNotice = null',
    /let\s+repeatNotice\s*=\s*null/.test(composerSrc));
  expect('B — composer guards the apply branch behind `if (repeat)`',
    /if\s*\(\s*repeat\s*\)\s*\{[\s\S]{0,400}existingHasData/.test(composerSrc));
  expect('B — composer uses Object.entries existing-has-data check (ignores `type`)',
    /Object\.entries\(\s*draft\s*\)\.some\(\s*\(\[\s*k\s*,\s*v\s*\]\)\s*=>\s*k\s*!==\s*['"]type['"]\s*&&\s*v\s*\)/.test(composerSrc));
  expect('B — composer kept-branch sets repeatNotice = "kept" with NO applyRepeatRoute call',
    /existingHasData\s*\)\s*\{[\s\S]{0,400}repeatNotice\s*=\s*['"]kept['"][\s\S]{0,200}\}\s*else/.test(composerSrc));
  // Bound-extract the kept-branch and pin no applyRepeatRoute call.
  const keptMatch = composerSrc.match(
    /existingHasData\s*\)\s*\{([\s\S]*?)\}\s*else/);
  const keptBody = keptMatch ? keptMatch[1] : '';
  expect('B — kept-branch body resolved', keptBody.length > 0);
  expect('B — kept-branch does NOT call applyRepeatRoute (existing draft preserved)',
    !/applyRepeatRoute\s*\(/.test(keptBody));
  expect('B — kept-branch does NOT call saveDraft (existing draft preserved)',
    !/saveDraft\s*\(/.test(keptBody));
  // Applied branch.
  expect('B — applied-branch calls applyRepeatRoute + saveDraft + sets repeatNotice="applied"',
    /\}\s*else\s*\{[\s\S]{0,400}applyRepeatRoute\s*\([\s\S]{0,200}saveDraft\s*\([\s\S]{0,200}repeatNotice\s*=\s*['"]applied['"]/.test(composerSrc));
}

// ── C. Behavioral: consume removes draft on malformed / valid alike ─
// Section B pinned the source-level behaviour; here we exercise the
// underlying repeat_route helpers (which composer calls) to prove the
// no-wedge invariant — a malformed payload is consumed and removed so
// the next composer visit cannot get stuck on a stale poisoned blob.
{
  // C1 — malformed payload → consume returns null AND removes the key.
  _store.clear();
  _store.set(REPEAT_ROUTE_KEY, '{ not valid JSON');
  const consumed1 = repeat.consumeRepeatRouteDraft();
  expect('C1 — malformed repeat draft → consume returns null',
    consumed1 === null);
  expect('C1 — malformed repeat draft → key removed (no wedge on next composer visit)',
    !_store.has(REPEAT_ROUTE_KEY));

  // C2 — valid payload → consume returns sanitized draft and removes key.
  _store.clear();
  repeat.writeRepeatRouteDraft({
    role: 'passenger',
    route: { pickupLabel: 'P', dropoffLabel: 'D' },
    fare: '350 ₽',
  });
  const consumed2 = repeat.consumeRepeatRouteDraft();
  expect('C2 — valid repeat draft → consume returns sanitized whitelist',
    !!consumed2
    && Object.keys(consumed2).sort().join(',') === 'dropoff,pickup,role,suggestedFare'
    && consumed2.role === 'passenger'
    && consumed2.suggestedFare === 350);
  expect('C2 — valid repeat draft → key removed after consume (one-time)',
    !_store.has(REPEAT_ROUTE_KEY));

  // C3 — poisoned payload masquerading as a draft → sanitized on consume.
  _store.clear();
  _store.set(REPEAT_ROUTE_KEY, JSON.stringify({
    role: 'driver', pickup: 'P', dropoff: 'D', suggestedFare: 777,
    // Smuggled forbidden fields:
    driver: { name: 'Smuggled' },
    payment: { method: 'cash' },
    receipt: { net: 999 },
    cancel: { by: 'driver' },
    status: 'COMPLETED',
    chat: { unread: 1 },
  }));
  const consumed3 = repeat.consumeRepeatRouteDraft();
  expect('C3 — poisoned repeat payload → consume returns whitelist-only draft',
    !!consumed3
    && Object.keys(consumed3).sort().join(',') === 'dropoff,pickup,role,suggestedFare');
  for (const forbidden of FORBIDDEN_TERMINAL_FIELDS) {
    expect(`C3 — consumed sanitized draft does NOT carry "${forbidden}"`,
      !Object.prototype.hasOwnProperty.call(consumed3, forbidden));
  }
}

// ── D. Publish payload — buildRideOrderFromComposerDraft + createRideOrder ─

// ── D1. buildRideOrderFromComposerDraft source whitelist ────────────
{
  const body = extractFunctionBody(composerNoComments, 'buildRideOrderFromComposerDraft');
  expect('D1 — buildRideOrderFromComposerDraft body resolved',
    !!body && body.length > 0);
  // Allowed fields the publish builder writes onto the returned object.
  for (const allowed of [
    "type:\\s*'passenger_request'",
    'pickup:',
    'dropoff:',
    'distanceKm:',
    'durationMin:',
    'estimatedPrice:',
    'estimatedPriceLabel:',
    'scheduledMode:',
    'scheduledAt:',
    'scheduledLabel:',
    'comment:',
    'passenger:',
  ]) {
    expect(`D1 — publish-builder emits "${allowed}"`,
      new RegExp(allowed).test(body || ''));
  }
  // Forbidden — the publish builder must NOT carry these field names
  // from the composer draft into the order payload.
  for (const forbidden of [
    'driver:', 'vehicle:', 'rating:',
    'chat:', 'messages:',
    'payment:', 'receipt:', 'earnings:',
    'status:', 'canceledBy:', 'cancel:', 'cancelReason:',
    'completedAt:', 'canceledAt:', 'noShowAt:',
    'tripId:',
  ]) {
    expect(`D1 — buildRideOrderFromComposerDraft does NOT write "${forbidden}"`,
      !new RegExp(forbidden).test(body || ''));
  }
  // Pin the source-of-truth: passenger snapshot comes from
  // `buildPassengerSnapshotFromUser(u, commentText)` — current user, NOT
  // from the consumed repeat draft.
  expect('D1 — passenger snapshot comes from buildPassengerSnapshotFromUser(u, …)',
    /passenger:\s*u\s*\?\s*buildPassengerSnapshotFromUser\s*\(\s*u\s*,/.test(body || ''));
  // Defensive: builder reads from `d` (collected draft) and `u` (user)
  // only — pin no foreign-store reads inside the body.
  for (const foreignRead of [
    'localStorage', 'findActiveRide', 'getReceipt', 'getActiveRide',
    'loadRideHistory', 'consumeRepeatRouteDraft', 'peekRepeatRouteDraft',
  ]) {
    expect(`D1 — publish builder does NOT call ${foreignRead}`,
      !new RegExp('\\b' + foreignRead + '\\s*\\(').test(body || ''));
  }
}

// ── D2. mock_api.createRideOrder hardcodes status='CREATED' ─────────
// + never reads from history / receipts / active-ride stores during
// the create path.
{
  const mockApiNoComments = stripComments(mockApiSrc);
  const createOrderBody = extractFunctionBody(mockApiNoComments, 'createRideOrder');
  expect('D2 — createRideOrder body resolved',
    !!createOrderBody && createOrderBody.length > 0);
  expect('D2 — createRideOrder always stamps status="CREATED"',
    /status:\s*['"]CREATED['"]/.test(createOrderBody || ''));
  expect('D2 — createRideOrder does NOT read from history / receipts / active-ride',
    !/loadRideHistory\s*\(/.test(createOrderBody || '')
    && !/getReceipt\s*\(/.test(createOrderBody || '')
    && !/findActiveRide\s*\(/.test(createOrderBody || '')
    && !/getActiveRide\s*\(/.test(createOrderBody || ''));
  for (const forbidden of [
    'cancel:', 'canceledBy:', 'canceledAt:', 'noShowAt:',
    'payment:', 'receipt:', 'earnings:',
    'chat:', 'messages:',
  ]) {
    expect(`D2 — createRideOrder does NOT stamp "${forbidden}"`,
      !new RegExp(forbidden).test(createOrderBody || ''));
  }
}

// ── D3. Behavioral round-trip: createRideOrder persists a clean shape ─
{
  _store.clear();
  // Simulate what the composer submit handler does after applying a
  // repeat-route prefill from a poisoned ride history entry: build the
  // payload via the SAME path the screen uses (passenger snapshot from
  // current user; route fields from the composer draft).
  const poisoned = poisonedRideEntry();
  repeat.writeRepeatRouteDraft(poisoned);
  const repeatDraft = repeat.consumeRepeatRouteDraft();
  const composerDraft = {
    type: '',
    from: '', to: '', when: '', price: '', seats: '',
    phone: '', comment: '', budget: '',
  };
  applyRepeatRouteEquivalent(composerDraft, repeatDraft);
  // Mirror what buildRideOrderFromComposerDraft constructs — but only
  // the safe edits the composer would persist (user types `when` /
  // `comment` etc. on the form).
  composerDraft.when = 'Завтра, 10:00';
  composerDraft.comment = 'Я с маленьким чемоданом';
  const currentUser = {
    firstName: 'Иван',
    lastName: 'Тестов',
    displayName: 'Иван Тестов',
    phone: '+71234567890',
  };
  const payload = {
    type: 'passenger_request',
    source: 'feed',
    pickup: { id: null, label: composerDraft.from },
    dropoff: { id: null, label: composerDraft.to },
    distanceKm: 0,
    durationMin: 0,
    estimatedPrice: Number(composerDraft.budget) || 0,
    estimatedPriceLabel: composerDraft.budget,
    scheduledMode: 'later',
    scheduledAt: composerDraft.when,
    scheduledLabel: composerDraft.when,
    comment: composerDraft.comment,
    passenger: {
      name: `${currentUser.firstName} ${currentUser.lastName}`,
      initials: 'ИТ',
      phoneMasked: '+7 ... 67-89',
      comment: composerDraft.comment,
      authorId: 'local-user',
      isCurrentUser: true,
    },
  };
  const order = mockApi.createRideOrder(payload);
  expect('D3 — createRideOrder returns the persisted order',
    !!order && order.type === 'passenger_request' && order.status === 'CREATED');
  expect('D3 — order pickup.label preserves applied repeat route pickup',
    order.pickup?.label === 'Prefill pickup ✓');
  expect('D3 — order dropoff.label preserves applied repeat route dropoff',
    order.dropoff?.label === 'Prefill dropoff ✓');
  expect('D3 — order.passenger.isCurrentUser === true (current user, NOT poisoned stale)',
    order.passenger?.isCurrentUser === true);
  expect('D3 — order.passenger.name comes from current user, NOT stale "Stale Passenger"',
    order.passenger?.name !== 'Stale Passenger');
  expect('D3 — order.status === "CREATED" (no terminal leak)',
    order.status === 'CREATED');
  expect('D3 — order.status is NOT a terminal status (CANCELED / NO_SHOW / COMPLETED)',
    !['CANCELED', 'NO_SHOW', 'COMPLETED'].includes(order.status));
  // Persisted order JSON has NONE of the forbidden field names. `status`
  // is excluded because it's a legitimate lifecycle field stamped at
  // creation — the assertion above already pins it to `'CREATED'`.
  const serialized = JSON.stringify(order);
  for (const forbidden of FORBIDDEN_ON_ORDER) {
    expect(`D3 — persisted order does NOT carry top-level "${forbidden}"`,
      !Object.prototype.hasOwnProperty.call(order, forbidden));
  }
  for (const probe of [
    'Stale Driver', 'Stale Model', 'X000XX000',
    'car_problem', 'noncash',
    '"cancel"', '"receipt"', '"earnings"', '"payment"', '"vehicle"',
    '"chat"', '"messages"', '"canceledBy"',
    '"completedAt"', '"canceledAt"', '"noShowAt"',
  ]) {
    expect(`D3 — persisted order JSON does NOT contain ${JSON.stringify(probe)}`,
      !serialized.includes(probe));
  }
  // The persisted order lands in `bazardrive.ride_orders.v1` ONLY.
  expect('D3 — order persisted to bazardrive.ride_orders.v1',
    _store.has(RIDE_ORDERS_KEY));
  expect('D3 — order does NOT land in receipt / active-ride / history stores',
    !_store.has(DRIVER_RECEIPTS_KEY)
    && !_store.has(ACTIVE_RIDE_KEY)
    && !_store.has(RIDE_HISTORY_KEY)
    && !_store.has(DRIVER_OFFERS_KEY));
}

// ── E. Source guards on composer.js ─────────────────────────────────

// ── E1. composer.js does NOT import terminal-state writers ──────────
expect('E1 — composer.js does NOT import ride_state.js',
  !/from\s*['"][^'"]*ride_state['"]/.test(composerNoComments));
expect('E1 — composer.js does NOT import active_ride',
  !/from\s*['"][^'"]*active_ride[^'"]*['"]/.test(composerNoComments));
expect('E1 — composer.js does NOT import driver_offer_store',
  !/from\s*['"][^'"]*driver_offer_store['"]/.test(composerNoComments));
expect('E1 — composer.js does NOT import trip_receipt',
  !/from\s*['"][^'"]*trip_receipt['"]/.test(composerNoComments));
expect('E1 — composer.js does NOT import ride_history',
  !/from\s*['"][^'"]*ride_history['"]/.test(composerNoComments));
expect('E1 — composer.js does NOT import favorite_routes',
  !/from\s*['"][^'"]*favorite_routes['"]/.test(composerNoComments));

// ── E2. composer.js never calls forbidden writers ───────────────────
for (const forbiddenCall of [
  'saveDriverReceipt', 'saveRideHistoryEntry',
  'updateActiveRideStatus', 'saveActiveRide', 'cancelActiveRide',
  'commitPassengerSelection', 'cancelOrderByPassenger',
  'cancelOrderByDriver', 'rejectDriverOfferByPassenger',
  'rejectSentOffersForPassengerCanceledOrder',
  'sendDriverOffer', 'withdrawDriverOffer',
  'writeRepeatRouteDraft', 'saveFavoriteRouteFromHistory',
]) {
  expect(`E2 — composer.js does NOT call ${forbiddenCall}(...)`,
    !new RegExp('\\b' + forbiddenCall + '\\s*\\(').test(composerNoComments));
}

// ── E3. composer.js never calls fetch / mapbox ──────────────────────
expect('E3 — composer.js never calls fetch(',
  !/\bfetch\s*\(/.test(composerNoComments));
expect('E3 — composer.js never references mapbox',
  !/mapbox/i.test(composerNoComments));

// ── E4. Composer storage key allow-list ─────────────────────────────
{
  // The only `bazardrive.*` storage key the composer source touches
  // is the draft key. The repeat-route key lives in repeat_route.js;
  // composer reaches it ONLY via the imported `consumeRepeatRouteDraft`.
  const allKeys = composerSrc.match(/bazardrive\.[a-z_]+\.v\d+/g) || [];
  const uniqueKeys = [...new Set(allKeys)];
  expect('E4 — composer.js storage keys are EXACTLY the composer-draft key',
    uniqueKeys.length === 1 && uniqueKeys[0] === COMPOSER_DRAFT_KEY);
  // Defensive: composer.js never writes any of the foreign stores
  // directly even via a string literal.
  for (const foreign of [
    'bazardrive.ride_history.v1',
    'bazardrive.driver_receipts.v1',
    'bazardrive.active_ride.v1',
    'bazardrive.driver_offers.v1',
    'bazardrive.order_overlay.v1',
    'bazardrive.favorite_routes.v1',
    'bazardrive.favorite_route_notice.v1',
    'bazardrive.repeat_route.v1',
  ]) {
    expect(`E4 — composer.js does NOT reference the "${foreign}" key`,
      !composerSrc.includes(foreign));
  }
  // setItem usage check — the composer source must only call
  // localStorage.setItem with the DRAFT_KEY constant.
  const setItemCalls = composerNoComments.match(/localStorage\.setItem\s*\([^)]*\)/g) || [];
  expect('E4 — every localStorage.setItem call uses DRAFT_KEY (constant binding)',
    setItemCalls.length > 0
    && setItemCalls.every((s) => /DRAFT_KEY/.test(s)));
}

// ── F. Favorite notice flow stays UI-only ───────────────────────────
const favoriteNoComments = stripComments(favoriteSrc);

// ── F1. enhanceComposerNotice mutates DOM text ONLY ─────────────────
{
  const body = extractFunctionBody(favoriteNoComments, 'enhanceComposerNotice');
  expect('F1 — enhanceComposerNotice body resolved',
    !!body && body.length > 0);
  // It must consume the notice and modify text.textContent — and do
  // nothing else (no saveDraft, no writeRepeatRouteDraft, no foreign
  // store writes, no fetch).
  expect('F1 — enhanceComposerNotice consumes the notice once',
    /consumeFavoriteNotice\s*\(\s*\)/.test(body || ''));
  expect('F1 — enhanceComposerNotice mutates text.textContent (UI label)',
    /text\.textContent\s*=/.test(body || ''));
  for (const forbidden of [
    'saveDraft', 'writeRepeatRouteDraft', 'createRideOrder',
    'createFeedPost', 'localStorage.setItem', 'fetch(',
  ]) {
    expect(`F1 — enhanceComposerNotice does NOT call ${forbidden}`,
      !new RegExp(forbidden.replace(/[.()]/g, (m) => '\\' + m)).test(body || ''));
  }
}

// ── F2. peekFavoriteNotice + consumeFavoriteNotice whitelist ────────
{
  _store.clear();
  _store.set(FAVORITE_NOTICE_KEY, JSON.stringify({
    source: 'favorite',
    label:  'Home → Office',
    // Smuggled noise — must not survive a sanitizer pass on either path.
    driver:    { name: 'Smuggled' },
    payment:   { method: 'cash' },
    receipt:   { net: 999 },
    cancel:    { by: 'driver' },
    chat:      { unread: 1 },
    canceledBy: 'driver',
  }));
  const peeked = favorite.peekFavoriteNotice();
  expect('F2 — peekFavoriteNotice returns whitelist-only {source, label}',
    !!peeked
    && Object.keys(peeked).sort().join(',') === 'label,source'
    && peeked.source === 'favorite'
    && peeked.label === 'Home → Office');
  for (const forbidden of FORBIDDEN_TERMINAL_FIELDS) {
    expect(`F2 — peeked notice does NOT carry "${forbidden}"`,
      !Object.prototype.hasOwnProperty.call(peeked, forbidden));
  }
}

// ── F3. consumeFavoriteNotice stays internal (defense-in-depth) ─────
// Composer only learns about the favorite path through DOM mutation —
// the favorite-routes module bolts the enhanced text on from its side
// via `enhanceComposerNotice`. Verify both contracts hold:
expect('F3 — consumeFavoriteNotice is NOT a public export from favorite_routes.js',
  !/export\s+function\s+consumeFavoriteNotice/.test(favoriteSrc));
expect('F3 — composer.js does NOT call peekFavoriteNotice / consumeFavoriteNotice',
  !/peekFavoriteNotice\s*\(/.test(composerNoComments)
  && !/consumeFavoriteNotice\s*\(/.test(composerNoComments));

// ── G. End-to-end: poisoned history → repeat → composer draft → publish ─
// The full chain a real user exercises: tap «Повторить маршрут» on a
// poisoned (cancel-actor / payment / receipt / earnings / chat fields
// in the history snapshot) ride entry → /new opens → user fills the
// remaining fields → submit. The persisted order must carry no smuggled
// content.
{
  _store.clear();
  const poisoned = poisonedRideEntry({
    tripId: 'trip-G-1',
    role:   'passenger',
    route:  { pickupLabel: 'G-pickup', dropoffLabel: 'G-dropoff' },
    fare:   '777 ₽',
    // Even a CANCELED entry can be a valid template — the route is
    // the bridge data, the cancel metadata must NOT cross.
    status: 'CANCELED',
    cancel: { by: 'driver', reason: 'car_problem' },
    canceledBy: 'driver',
    canceledAt: '2026-06-01T10:00:00.000Z',
    noShowAt:   '2026-06-01T09:00:00.000Z',
  });

  // 1) Write repeat draft (mirror profile.js receipt button).
  const ok = repeat.writeRepeatRouteDraft(poisoned);
  expect('G — writeRepeatRouteDraft on a CANCELED-with-noise entry succeeds',
    ok === true);

  // 2) Composer opens, draft is empty → consume + apply.
  const repeatDraft = repeat.consumeRepeatRouteDraft();
  expect('G — composer consumes a whitelist-only repeat draft',
    !!repeatDraft
    && Object.keys(repeatDraft).sort().join(',') === 'dropoff,pickup,role,suggestedFare');
  const composerDraft = {
    type: 'passenger',  // initial value — applyRepeatRoute overwrites
    from: '', to: '', when: '', price: '', seats: '',
    phone: '', comment: '', budget: '',
  };
  applyRepeatRouteEquivalent(composerDraft, repeatDraft);

  // Composer-draft state matches the route-template whitelist.
  expect('G — composer draft.type === "passenger" (role mapping)',
    composerDraft.type === 'passenger');
  expect('G — composer draft.from === "G-pickup"',
    composerDraft.from === 'G-pickup');
  expect('G — composer draft.to === "G-dropoff"',
    composerDraft.to === 'G-dropoff');
  expect('G — composer draft.budget === "777" (suggestedFare → budget for passenger)',
    composerDraft.budget === '777');
  expect('G — composer draft does NOT have draft.price (passenger role)',
    composerDraft.price === '');
  // Composer's own `phone` field is a legitimate user-fillable composer
  // input (driver trip posts include a phone). The bridge contract is
  // that it MUST NOT be PREFILLED FROM the repeat draft — i.e. it stays
  // at its initial value ('') after applyRepeatRoute.
  expect('G — composer draft.phone is NOT prefilled from the repeat draft (stays "")',
    composerDraft.phone === '');
  // Every other forbidden field MUST be entirely absent from the
  // composer draft (no key, no value).
  for (const forbidden of FORBIDDEN_ON_DRAFT) {
    expect(`G — composer draft does NOT carry "${forbidden}"`,
      !Object.prototype.hasOwnProperty.call(composerDraft, forbidden));
  }

  // 3) User fills the remaining required fields and submits.
  composerDraft.when = 'Завтра, 10:00';
  composerDraft.comment = '1 чемодан';

  // 4) Submit → buildRideOrderFromComposerDraft + createRideOrder.
  // Use the EXACT shape the composer's screen factory constructs (we
  // pinned it via D1's source check).
  const payload = {
    type: 'passenger_request',
    source: 'feed',
    pickup:  { id: null, label: composerDraft.from },
    dropoff: { id: null, label: composerDraft.to },
    distanceKm: 0,
    durationMin: 0,
    estimatedPrice: Number(composerDraft.budget) || 0,
    estimatedPriceLabel: composerDraft.budget,
    scheduledMode: 'later',
    scheduledAt: composerDraft.when,
    scheduledLabel: composerDraft.when,
    comment: composerDraft.comment,
    passenger: {
      name: 'Иван Тестов',
      initials: 'ИТ',
      phoneMasked: '+7 ... 67-89',
      comment: composerDraft.comment,
      authorId: 'local-user',
      isCurrentUser: true,
    },
  };
  const order = mockApi.createRideOrder(payload);

  // 5) Final order is route-template-only — no smuggled fields.
  expect('G — final order.status === "CREATED" (no terminal leak)',
    order?.status === 'CREATED');
  expect('G — final order.passenger.isCurrentUser === true (current user, NOT stale)',
    order?.passenger?.isCurrentUser === true);
  expect('G — final order.passenger.name comes from CURRENT user, NOT "Stale Passenger"',
    order?.passenger?.name !== 'Stale Passenger');
  expect('G — final order.passenger.phoneMasked is the CURRENT user mask, NOT "+7 ... 88-88"',
    order?.passenger?.phoneMasked !== '+7 ... 88-88');
  expect('G — final order.estimatedPriceLabel === "777" (suggested fare preserved as editable)',
    order?.estimatedPriceLabel === '777');
  expect('G — final order.pickup.label preserves applied route',
    order?.pickup?.label === 'G-pickup');
  expect('G — final order.dropoff.label preserves applied route',
    order?.dropoff?.label === 'G-dropoff');

  // Forbidden field-presence checks on the persisted order — `status`
  // excluded (legitimately stamped to `'CREATED'`).
  expect('G — final order.status is NOT a terminal status',
    !['CANCELED', 'NO_SHOW', 'COMPLETED'].includes(order?.status));
  for (const forbidden of FORBIDDEN_ON_ORDER) {
    expect(`G — final order does NOT carry top-level "${forbidden}"`,
      !Object.prototype.hasOwnProperty.call(order, forbidden));
  }

  // Serialized-content scan — catches nested leakage.
  const serialized = JSON.stringify(order);
  for (const probe of [
    'Stale Driver', 'Stale Passenger', 'Stale Model', 'X000XX000',
    'car_problem', 'passenger_no_show', 'noncash',
    '"cancel"', '"receipt"', '"earnings"', '"payment"', '"vehicle"',
    '"chat"', '"messages"', '"rating"', '"canceledBy"',
    '"completedAt"', '"canceledAt"', '"noShowAt"',
  ]) {
    expect(`G — persisted order JSON does NOT contain ${JSON.stringify(probe)}`,
      !serialized.includes(probe));
  }
}

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));

if (issues.length) process.exit(1);
