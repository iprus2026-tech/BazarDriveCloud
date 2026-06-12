// BD-ROUTE-TEMPLATE-TERM-01 — repeat / favorite route terminal source
// audit smoke.
//
// BD-RIDE-HISTORY-TERM-01 locked the downstream ride-history + driver
// receipt surfaces: CANCELED / NO_SHOW rides never produce a settled
// receipt; COMPLETED entries flow through the existing builders /
// sanitizer untouched. This smoke locks the SIBLING bridge: the
// "Повторить маршрут" (repeat_route.js) and "В избранные" /
// favorite-repeat (favorite_routes.js) actions are route-template
// bridges ONLY — they must never resurrect a stale order's identity /
// payment / receipt / earnings / cancel actor / chat / vehicle data
// into a fresh composer draft.
//
// Forbidden fields the sanitizer must drop on EVERY surface
// (build + write + read on repeat_route; build + sanitize + load +
// notice on favorite_routes):
//
//   • driver, passenger, vehicle, phone, rating
//   • chat, messages, comment
//   • payment, receipt, earnings
//   • status, canceledBy, cancel, cancelReason
//   • completedAt, canceledAt, noShowAt
//   • active ride state (tripId is NOT in repeat draft; sourceRideId
//     IS preserved on favorite for traceability — that's intentional)
//
// Allowed on the repeat-route bridge:
//   { role, pickup, dropoff, suggestedFare? }
//
// Allowed on the favorite-route bridge:
//   { id, source, sourceRideId, role, label, customLabel,
//     pickup, dropoff, suggestedFare?, distanceKm?, durationMin?,
//     savedAt, lastUsedAt? }
//
// Allowed on the favorite notice payload:
//   { source: 'favorite', label: string }

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// In-memory localStorage shim so the modules under test can round-trip
// the repeat-route + favorite-routes + notice stores without a browser.
const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => _store.has(k) ? _store.get(k) : null,
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { _store.delete(k); },
  clear: () => { _store.clear(); },
};

// Storage keys — pinned via constants so the assertions can compare
// exactly against the source-of-truth strings.
const REPEAT_ROUTE_KEY      = 'bazardrive.repeat_route.v1';
const FAVORITE_ROUTES_KEY   = 'bazardrive.favorite_routes.v1';
const FAVORITE_NOTICE_KEY   = 'bazardrive.favorite_route_notice.v1';

const repeat   = await import(new URL('../public/src/repeat_route.js', import.meta.url).href);
const favorite = await import(new URL('../public/src/favorite_routes.js', import.meta.url).href);

const repeatSrc   = read('../public/src/repeat_route.js');
const favoriteSrc = read('../public/src/favorite_routes.js');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// Forbidden fields that must never survive a sanitizer pass on either
// the repeat-route draft or the favorite-route record. Centralised so
// every section reuses the same vocabulary.
const FORBIDDEN_TERMINAL_FIELDS = [
  'driver', 'passenger', 'vehicle', 'phone', 'rating',
  'chat', 'messages', 'comment',
  'payment', 'receipt', 'earnings',
  'status', 'canceledBy', 'cancel', 'cancelReason',
  'completedAt', 'canceledAt', 'noShowAt',
];

// A "poisoned" ride-history entry that carries every forbidden field
// (driver/passenger/vehicle/payment/receipt/earnings/cancel actor) plus
// a valid route. Used by sections A / C / E to prove the sanitizers
// strip the noise.
function poisonedRideEntry(overrides = {}) {
  return {
    tripId:    'trip-poisoned-1',
    role:      'passenger',
    status:    'COMPLETED',
    route:     { pickupLabel: 'Pickup ✓', dropoffLabel: 'Dropoff ✓' },
    fare:      '1 480 ₽',
    distance:  '12,3 км',
    duration:  '24 мин',
    completedAt: '2026-06-01T10:30:00.000Z',
    canceledAt:  '2026-06-01T10:00:00.000Z',
    // The forbidden noise — every field BD-ROUTE-TEMPLATE-TERM-01
    // requires to be dropped:
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
    status_history: ['ACCEPTED', 'IN_PROGRESS', 'COMPLETED'],
    cancel:    { by: 'driver', reason: 'car_problem' },
    canceledBy: 'driver',
    noShowAt:  '2026-06-01T09:00:00.000Z',
    ...overrides,
  };
}

// ── A. buildRepeatRouteDraft — route-only sanitizer + fare parser ───
expect('A — repeat_route exports buildRepeatRouteDraft + writeRepeatRouteDraft + peekRepeatRouteDraft + consumeRepeatRouteDraft + clearRepeatRouteDraft',
  typeof repeat.buildRepeatRouteDraft     === 'function'
  && typeof repeat.writeRepeatRouteDraft  === 'function'
  && typeof repeat.peekRepeatRouteDraft   === 'function'
  && typeof repeat.consumeRepeatRouteDraft === 'function'
  && typeof repeat.clearRepeatRouteDraft  === 'function');

// ── A1. Builder returns null on malformed input ─────────────────────
expect('A1 — buildRepeatRouteDraft(null) === null',
  repeat.buildRepeatRouteDraft(null) === null);
expect('A1 — buildRepeatRouteDraft(undefined) === null',
  repeat.buildRepeatRouteDraft() === null);
expect('A1 — buildRepeatRouteDraft on non-object returns null',
  repeat.buildRepeatRouteDraft('not-a-ride') === null
  && repeat.buildRepeatRouteDraft(42) === null
  && repeat.buildRepeatRouteDraft([1, 2, 3]) === null);
expect('A1 — buildRepeatRouteDraft on missing pickup returns null',
  repeat.buildRepeatRouteDraft({
    role: 'passenger',
    route: { dropoffLabel: 'D' },
  }) === null);
expect('A1 — buildRepeatRouteDraft on missing dropoff returns null',
  repeat.buildRepeatRouteDraft({
    role: 'passenger',
    route: { pickupLabel: 'P' },
  }) === null);
expect('A1 — buildRepeatRouteDraft on empty / whitespace-only labels returns null',
  repeat.buildRepeatRouteDraft({ role: 'passenger', route: { pickupLabel: '', dropoffLabel: 'D' } }) === null
  && repeat.buildRepeatRouteDraft({ role: 'passenger', route: { pickupLabel: '   ', dropoffLabel: 'D' } }) === null);
expect('A1 — buildRepeatRouteDraft on non-string labels returns null',
  repeat.buildRepeatRouteDraft({ role: 'passenger', route: { pickupLabel: 42, dropoffLabel: 'D' } }) === null
  && repeat.buildRepeatRouteDraft({ role: 'passenger', route: { pickupLabel: { v: 'X' }, dropoffLabel: 'D' } }) === null);

// ── A2. Builder returns a strict whitelist shape on valid input ─────
{
  const entry = poisonedRideEntry();
  const draft = repeat.buildRepeatRouteDraft(entry);
  expect('A2 — buildRepeatRouteDraft on a poisoned entry returns a non-null draft',
    !!draft);
  expect('A2 — draft.role is "passenger"',
    draft?.role === 'passenger');
  expect('A2 — draft.pickup preserved',
    draft?.pickup === 'Pickup ✓');
  expect('A2 — draft.dropoff preserved',
    draft?.dropoff === 'Dropoff ✓');
  expect('A2 — draft.suggestedFare parsed from "1 480 ₽" → 1480',
    draft?.suggestedFare === 1480);
  // Exact field whitelist — the draft must carry NO other keys.
  const draftKeys = Object.keys(draft).sort();
  expect('A2 — draft contains EXACTLY {role, pickup, dropoff, suggestedFare}',
    JSON.stringify(draftKeys) === JSON.stringify(['dropoff', 'pickup', 'role', 'suggestedFare']));
}

// ── A3. Builder strips every forbidden terminal/identity field ──────
{
  const entry = poisonedRideEntry();
  const draft = repeat.buildRepeatRouteDraft(entry);
  for (const forbidden of FORBIDDEN_TERMINAL_FIELDS) {
    expect(`A3 — draft does NOT carry forbidden field "${forbidden}"`,
      draft && !Object.prototype.hasOwnProperty.call(draft, forbidden));
  }
  // Defense-in-depth on the serialized form too — a JSON.stringify scan
  // catches any nested leakage (e.g. a sub-object carrying actor info).
  // Probes are restricted to substrings that appear ONLY in smuggled
  // content; bare "driver" / "passenger" are excluded because they are
  // also legitimate `role` values that the whitelist allows through.
  const serialized = JSON.stringify(draft);
  for (const leakProbe of [
    'Stale Driver', 'Stale Passenger', 'Stale Model', 'X000XX000',
    'car_problem', 'noncash',
    '"cancel"', '"receipt"', '"earnings"', '"payment"', '"vehicle"',
    '"chat"', '"messages"', '"comment"', '"status"', '"canceledBy"',
    '"completedAt"', '"canceledAt"', '"noShowAt"',
  ]) {
    expect(`A3 — serialized draft does NOT leak the substring ${JSON.stringify(leakProbe)}`,
      !serialized.includes(leakProbe));
  }
}

// ── A4. cleanNumber fare parsing — strings, formats, malformed ──────
{
  // Format variants — finite non-negative numbers only.
  const cases = [
    [{ fare: '1 480 ₽' },  1480, 'spaced ruble label'],
    [{ fare: '350 ₽' },     350, 'simple ruble label'],
    [{ fare: '1 480' },    1480, 'spaced no symbol'],
    [{ fare: 1480 },       1480, 'numeric finite'],
    [{ fare: 0 },             0, 'zero'],
    [{ fare: '999,50 ₽' }, 999.5, 'comma decimal'],
    [{ fare: '999.50' },   999.5, 'dot decimal'],
  ];
  for (const [extra, expected, kind] of cases) {
    const draft = repeat.buildRepeatRouteDraft({ ...poisonedRideEntry(), ...extra });
    expect(`A4 — fare parsing (${kind}) → ${expected}`,
      draft?.suggestedFare === expected);
  }
  // Dropped: negative / non-numeric / NaN / Infinity / weird text.
  const dropped = [
    ['-100',          'negative string'],
    [-100,            'negative number'],
    ['abc ₽',         'non-numeric text'],
    ['',              'empty string'],
    [NaN,             'NaN'],
    [Infinity,        'Infinity'],
    [{ amount: 999 }, 'nested object'],
    [null,            'null'],
  ];
  for (const [fare, kind] of dropped) {
    const draft = repeat.buildRepeatRouteDraft({ ...poisonedRideEntry(), fare });
    expect(`A4 — malformed fare (${kind}) is dropped from draft`,
      draft && !Object.prototype.hasOwnProperty.call(draft, 'suggestedFare'));
  }
}

// ── A5. Role normalization ──────────────────────────────────────────
{
  expect('A5 — role="driver" preserved',
    repeat.buildRepeatRouteDraft({ ...poisonedRideEntry(), role: 'driver' })?.role === 'driver');
  expect('A5 — role="passenger" preserved',
    repeat.buildRepeatRouteDraft({ ...poisonedRideEntry(), role: 'passenger' })?.role === 'passenger');
  // Any non-driver value normalises to 'passenger' — defends against a
  // poisoned entry trying to smuggle an unknown role string.
  for (const weird of ['system', 'admin', '', undefined, null, 42]) {
    expect(`A5 — role=${JSON.stringify(weird)} normalises to "passenger"`,
      repeat.buildRepeatRouteDraft({ ...poisonedRideEntry(), role: weird })?.role === 'passenger');
  }
}

// ── B. repeat_route storage round-trip ──────────────────────────────

// ── B1. writeRepeatRouteDraft writes ONLY the sanitized draft ───────
{
  _store.clear();
  const poisoned = poisonedRideEntry();
  const ok = repeat.writeRepeatRouteDraft(poisoned);
  expect('B1 — writeRepeatRouteDraft returns true on a valid entry',
    ok === true);
  expect('B1 — repeat-route key is the canonical bazardrive.repeat_route.v1',
    _store.has(REPEAT_ROUTE_KEY));
  const raw = _store.get(REPEAT_ROUTE_KEY) || '';
  const parsed = JSON.parse(raw);
  const persistedKeys = Object.keys(parsed).sort();
  expect('B1 — persisted draft contains EXACTLY {role, pickup, dropoff, suggestedFare}',
    JSON.stringify(persistedKeys) === JSON.stringify(['dropoff', 'pickup', 'role', 'suggestedFare']));
  for (const forbidden of FORBIDDEN_TERMINAL_FIELDS) {
    expect(`B1 — persisted draft does NOT carry "${forbidden}"`,
      !Object.prototype.hasOwnProperty.call(parsed, forbidden));
  }
  for (const probe of ['Stale', 'car_problem', 'noncash', 'X000XX000']) {
    expect(`B1 — persisted JSON does NOT leak substring "${probe}"`,
      !raw.includes(probe));
  }
}

// ── B2. peekRepeatRouteDraft returns sanitized draft without consuming ─
{
  _store.clear();
  repeat.writeRepeatRouteDraft(poisonedRideEntry());
  const peeked = repeat.peekRepeatRouteDraft();
  expect('B2 — peek returns a non-null draft',
    !!peeked);
  expect('B2 — peeked draft has the whitelist shape',
    peeked && Object.keys(peeked).sort().join(',') === 'dropoff,pickup,role,suggestedFare');
  expect('B2 — peek does NOT remove the key',
    _store.has(REPEAT_ROUTE_KEY));
  // Second peek returns the same shape.
  const peekedAgain = repeat.peekRepeatRouteDraft();
  expect('B2 — second peek returns the same sanitized draft',
    !!peekedAgain && peekedAgain.pickup === peeked.pickup);
}

// ── B3. consumeRepeatRouteDraft returns sanitized draft and removes key ─
{
  _store.clear();
  repeat.writeRepeatRouteDraft(poisonedRideEntry());
  const consumed = repeat.consumeRepeatRouteDraft();
  expect('B3 — consume returns a non-null draft',
    !!consumed);
  expect('B3 — consumed draft has the whitelist shape',
    consumed && Object.keys(consumed).sort().join(',') === 'dropoff,pickup,role,suggestedFare');
  expect('B3 — consume removes the storage key',
    !_store.has(REPEAT_ROUTE_KEY));
  expect('B3 — peek after consume returns null',
    repeat.peekRepeatRouteDraft() === null);
  expect('B3 — second consume returns null (key was removed)',
    repeat.consumeRepeatRouteDraft() === null);
}

// ── B4. Malformed stored payload is removed on consume; returns null ─
{
  _store.clear();
  // Inject a malformed payload directly (bypassing the writer).
  _store.set(REPEAT_ROUTE_KEY, '{ this is not valid JSON');
  expect('B4 — consume on malformed JSON returns null',
    repeat.consumeRepeatRouteDraft() === null);
  expect('B4 — consume removes the malformed payload (no wedge on next visit)',
    !_store.has(REPEAT_ROUTE_KEY));
  // Same for an array / non-plain-object payload.
  _store.set(REPEAT_ROUTE_KEY, JSON.stringify([1, 2, 3]));
  expect('B4 — consume on array payload returns null',
    repeat.consumeRepeatRouteDraft() === null);
  _store.set(REPEAT_ROUTE_KEY, JSON.stringify({ role: 'passenger' /* no pickup/dropoff */ }));
  expect('B4 — consume on partial payload (no pickup/dropoff) returns null',
    repeat.consumeRepeatRouteDraft() === null);
  expect('B4 — partial payload key removed too',
    !_store.has(REPEAT_ROUTE_KEY));
}

// ── B5. Poisoned localStorage payload cannot leak identity/payment fields ─
// A hostile actor (another tab, a corrupted upgrade) writes a payload
// that LOOKS like a draft but carries terminal-state noise. Both peek
// and consume must re-sanitize and emit ONLY the whitelist shape.
{
  _store.clear();
  _store.set(REPEAT_ROUTE_KEY, JSON.stringify({
    role: 'driver',
    pickup: 'Pickup ✓',
    dropoff: 'Dropoff ✓',
    suggestedFare: '777 ₽',
    // Forbidden noise smuggled into the stored payload:
    driver:    { name: 'Smuggled Driver' },
    passenger: { name: 'Smuggled Passenger' },
    vehicle:   { plate: 'XYZ' },
    payment:   { method: 'cash', amount: 9999 },
    receipt:   { net: 9999 },
    earnings:  { net: 9999 },
    rating:    5,
    cancel:    { by: 'driver', reason: 'smuggled' },
    status:    'COMPLETED',
    canceledBy: 'driver',
    completedAt: '2026-06-01T10:30:00.000Z',
    chat:      { unread: 9 },
    messages:  [{ id: 'm1' }],
    comment:   'smuggled',
  }));

  // peek — sanitized re-read.
  const peeked = repeat.peekRepeatRouteDraft();
  expect('B5 — peek of poisoned payload returns a sanitized draft',
    !!peeked
    && peeked.role === 'driver'
    && peeked.pickup === 'Pickup ✓'
    && peeked.dropoff === 'Dropoff ✓'
    && peeked.suggestedFare === 777);
  const peekedKeys = Object.keys(peeked).sort();
  expect('B5 — peeked draft contains EXACTLY {role, pickup, dropoff, suggestedFare}',
    JSON.stringify(peekedKeys) === JSON.stringify(['dropoff', 'pickup', 'role', 'suggestedFare']));
  for (const forbidden of FORBIDDEN_TERMINAL_FIELDS) {
    expect(`B5 — peeked draft does NOT carry "${forbidden}"`,
      !Object.prototype.hasOwnProperty.call(peeked, forbidden));
  }

  // consume — same sanitizer, key removed.
  const consumed = repeat.consumeRepeatRouteDraft();
  expect('B5 — consume of poisoned payload returns a sanitized draft',
    !!consumed);
  const consumedKeys = Object.keys(consumed).sort();
  expect('B5 — consumed draft contains EXACTLY {role, pickup, dropoff, suggestedFare}',
    JSON.stringify(consumedKeys) === JSON.stringify(['dropoff', 'pickup', 'role', 'suggestedFare']));
  expect('B5 — consume of poisoned payload removes the storage key',
    !_store.has(REPEAT_ROUTE_KEY));
}

// ── B6. clearRepeatRouteDraft drops the key ─────────────────────────
{
  _store.clear();
  repeat.writeRepeatRouteDraft(poisonedRideEntry());
  expect('B6 — key present after write',
    _store.has(REPEAT_ROUTE_KEY));
  repeat.clearRepeatRouteDraft();
  expect('B6 — key removed after clearRepeatRouteDraft',
    !_store.has(REPEAT_ROUTE_KEY));
}

// ── C. favorite_routes builder + storage ────────────────────────────
expect('C — favorite_routes exports saveFavoriteRouteFromHistory + loadFavoriteRoutes + clearFavoriteRoutes + removeFavoriteRoute + peekFavoriteNotice + clearFavoriteNotice',
  typeof favorite.saveFavoriteRouteFromHistory === 'function'
  && typeof favorite.loadFavoriteRoutes        === 'function'
  && typeof favorite.clearFavoriteRoutes       === 'function'
  && typeof favorite.removeFavoriteRoute       === 'function'
  && typeof favorite.peekFavoriteNotice        === 'function'
  && typeof favorite.clearFavoriteNotice       === 'function');

// Allowed fields on a sanitized favorite record. Optional numeric
// fields are declared separately so the comparator below tolerates
// their absence when the source entry doesn't provide them.
const FAVORITE_ALLOWED_REQUIRED = [
  'id', 'source', 'sourceRideId', 'role', 'label', 'customLabel',
  'pickup', 'dropoff', 'savedAt', 'lastUsedAt',
];
const FAVORITE_ALLOWED_OPTIONAL = ['suggestedFare', 'distanceKm', 'durationMin'];

function isAllowedFavoriteShape(fav) {
  if (!fav || typeof fav !== 'object') return false;
  const keys = Object.keys(fav);
  for (const k of keys) {
    if (!FAVORITE_ALLOWED_REQUIRED.includes(k)
        && !FAVORITE_ALLOWED_OPTIONAL.includes(k)) {
      return false;
    }
  }
  return FAVORITE_ALLOWED_REQUIRED.every((k) => Object.prototype.hasOwnProperty.call(fav, k));
}

// ── C1. saveFavoriteRouteFromHistory stores a route-only favorite ───
{
  _store.clear();
  const saved = favorite.saveFavoriteRouteFromHistory(poisonedRideEntry());
  expect('C1 — saveFavoriteRouteFromHistory returns a non-null record',
    !!saved);
  expect('C1 — saved record has only allowed favorite-route fields',
    isAllowedFavoriteShape(saved));
  for (const forbidden of FORBIDDEN_TERMINAL_FIELDS) {
    expect(`C1 — saved favorite does NOT carry "${forbidden}"`,
      saved && !Object.prototype.hasOwnProperty.call(saved, forbidden));
  }
  expect('C1 — saved.role preserved (passenger)',
    saved?.role === 'passenger');
  expect('C1 — saved.pickup preserved',
    saved?.pickup === 'Pickup ✓');
  expect('C1 — saved.dropoff preserved',
    saved?.dropoff === 'Dropoff ✓');
  expect('C1 — saved.sourceRideId preserved (favorite traceability)',
    saved?.sourceRideId === 'trip-poisoned-1');
  expect('C1 — saved.source === "ride_history"',
    saved?.source === 'ride_history');
  expect('C1 — saved.suggestedFare parsed from "1 480 ₽" → 1480',
    saved?.suggestedFare === 1480);
}

// ── C2. Reloaded favorite carries no smuggled identity/payment ──────
{
  _store.clear();
  favorite.saveFavoriteRouteFromHistory(poisonedRideEntry());
  // Inject smuggled fields into the raw stored array — sanitizer must
  // strip them on load (defense-in-depth, mirrors B5 on the repeat-
  // route side).
  const raw = JSON.parse(_store.get(FAVORITE_ROUTES_KEY) || '[]');
  raw[0] = {
    ...raw[0],
    driver: { name: 'Smuggled' },
    payment: { method: 'cash' },
    receipt: { net: 9999 },
    earnings: { net: 9999 },
    cancel: { by: 'driver' },
    status: 'CANCELED',
    chat: { unread: 5 },
    messages: [{}],
    comment: 'smuggled',
    canceledBy: 'driver',
    canceledAt: '2026-06-01T10:00:00.000Z',
  };
  _store.set(FAVORITE_ROUTES_KEY, JSON.stringify(raw));
  const reloaded = favorite.loadFavoriteRoutes();
  expect('C2 — reload returns a 1-entry list after the poisoned write-back',
    reloaded.length === 1);
  expect('C2 — reloaded favorite has only allowed favorite-route fields',
    isAllowedFavoriteShape(reloaded[0]));
  for (const forbidden of FORBIDDEN_TERMINAL_FIELDS) {
    expect(`C2 — reloaded favorite does NOT carry "${forbidden}"`,
      !Object.prototype.hasOwnProperty.call(reloaded[0], forbidden));
  }
}

// ── C3. Duplicate route updates existing favorite by pickup/dropoff ─
{
  _store.clear();
  const first = favorite.saveFavoriteRouteFromHistory(poisonedRideEntry({
    tripId: 'trip-dup-1',
  }));
  // Same pickup/dropoff, different tripId → must update, not duplicate.
  const second = favorite.saveFavoriteRouteFromHistory(poisonedRideEntry({
    tripId: 'trip-dup-2',
  }));
  const list = favorite.loadFavoriteRoutes();
  expect('C3 — duplicate-route save does NOT create a second favorite',
    list.length === 1);
  // The original id and savedAt are preserved on update.
  expect('C3 — original favorite id is preserved on update',
    list[0].id === first.id);
  expect('C3 — original savedAt is preserved on update',
    list[0].savedAt === first.savedAt);
  expect('C3 — second save returns the existing-updated record (same id)',
    second?.id === first.id);
}

// ── C4. customLabel preservation on update ──────────────────────────
{
  _store.clear();
  const first = favorite.saveFavoriteRouteFromHistory(poisonedRideEntry({
    tripId: 'trip-custom-1',
  }));
  // Simulate the user renaming the favorite — write a customLabel
  // directly into the persisted record (the runtime path goes through
  // saveFavoriteRouteLabel, which is not exported; the on-disk shape
  // is the same).
  const raw = JSON.parse(_store.get(FAVORITE_ROUTES_KEY) || '[]');
  raw[0] = { ...raw[0], customLabel: 'Дом → Работа' };
  _store.set(FAVORITE_ROUTES_KEY, JSON.stringify(raw));
  // Re-save from history with a fresh entry on the same pickup/dropoff.
  favorite.saveFavoriteRouteFromHistory(poisonedRideEntry({
    tripId: 'trip-custom-2',
  }));
  const after = favorite.loadFavoriteRoutes();
  expect('C4 — duplicate-save still resolves to one favorite',
    after.length === 1);
  expect('C4 — customLabel preserved across duplicate save',
    after[0].customLabel === 'Дом → Работа');
  expect('C4 — id preserved across customLabel + duplicate-save',
    after[0].id === first.id);
}

// ── C5. removeFavoriteRoute removes only the targeted id ────────────
{
  _store.clear();
  favorite.saveFavoriteRouteFromHistory(poisonedRideEntry({
    tripId: 'trip-rm-1',
    route: { pickupLabel: 'A', dropoffLabel: 'B' },
  }));
  favorite.saveFavoriteRouteFromHistory(poisonedRideEntry({
    tripId: 'trip-rm-2',
    route: { pickupLabel: 'C', dropoffLabel: 'D' },
  }));
  const before = favorite.loadFavoriteRoutes();
  expect('C5 baseline — two distinct favorites persist',
    before.length === 2);
  const targetId = before[0].id;
  favorite.removeFavoriteRoute(targetId);
  const after = favorite.loadFavoriteRoutes();
  expect('C5 — removeFavoriteRoute leaves one favorite',
    after.length === 1);
  expect('C5 — the removed favorite is the targeted one',
    !after.some((f) => f.id === targetId));
  // Removing a non-existent id is a no-op (does not throw).
  favorite.removeFavoriteRoute('not-a-real-id');
  expect('C5 — removing a non-existent id is a no-op',
    favorite.loadFavoriteRoutes().length === 1);
}

// ── C6. clearFavoriteRoutes removes BOTH the list and the notice ────
{
  _store.clear();
  favorite.saveFavoriteRouteFromHistory(poisonedRideEntry());
  _store.set(FAVORITE_NOTICE_KEY, JSON.stringify({ source: 'favorite', label: 'X' }));
  favorite.clearFavoriteRoutes();
  expect('C6 — clearFavoriteRoutes removes the favorite-routes key',
    !_store.has(FAVORITE_ROUTES_KEY));
  expect('C6 — clearFavoriteRoutes also removes the notice key',
    !_store.has(FAVORITE_NOTICE_KEY));
}

// ── D. favorite repeat handoff (notice payload + repeat draft) ──────

// ── D1. Source pin: writeFavoriteNotice payload is {source, label} only ─
{
  const favSrc = stripComments(favoriteSrc);
  // The runtime writer constructs the payload inline — pin both keys
  // and the absence of any other key against the surrounding `payload`
  // assignment.
  expect('D1 — writeFavoriteNotice constructs payload.source === "favorite"',
    /writeFavoriteNotice[\s\S]{0,400}payload\s*=\s*\{[\s\S]{0,200}source:\s*['"]favorite['"]/.test(favSrc));
  expect('D1 — writeFavoriteNotice constructs payload.label from routeDisplayLabel',
    /writeFavoriteNotice[\s\S]{0,400}payload\s*=\s*\{[\s\S]{0,200}label:\s*routeDisplayLabel/.test(favSrc));
  // No other identity / payment / receipt / actor field name appears in
  // the writeFavoriteNotice block.
  const match = favSrc.match(/function\s+writeFavoriteNotice\s*\([\s\S]*?\n\s*\}/);
  const block = match ? match[0] : '';
  expect('D1 — writeFavoriteNotice block resolved', block.length > 0);
  for (const probe of [
    'driver', 'passenger', 'vehicle', 'payment', 'receipt',
    'earnings', 'rating', 'cancel', 'status', 'completedAt',
    'canceledAt', 'comment', 'chat', 'messages',
  ]) {
    expect(`D1 — writeFavoriteNotice does NOT reference "${probe}"`,
      !new RegExp('\\b' + probe + '\\b').test(block));
  }
}

// ── D2. peekFavoriteNotice returns {source, label} only ─────────────
{
  _store.clear();
  // Hand-write a poisoned notice — the public peek MUST sanitize it.
  _store.set(FAVORITE_NOTICE_KEY, JSON.stringify({
    source: 'favorite',
    label:  'Home → Office',
    // Smuggled fields:
    driver:    { name: 'Smuggled' },
    payment:   { method: 'cash' },
    receipt:   { net: 9999 },
    cancel:    { by: 'driver' },
    status:    'COMPLETED',
    completedAt: '2026-06-01T10:30:00.000Z',
    rating:    5,
  }));
  const peeked = favorite.peekFavoriteNotice();
  expect('D2 — peekFavoriteNotice returns a non-null record',
    !!peeked);
  const noticeKeys = Object.keys(peeked).sort();
  expect('D2 — notice payload contains EXACTLY {source, label}',
    JSON.stringify(noticeKeys) === JSON.stringify(['label', 'source']));
  expect('D2 — notice.source === "favorite"',
    peeked.source === 'favorite');
  expect('D2 — notice.label preserved verbatim',
    peeked.label === 'Home → Office');
  for (const forbidden of FORBIDDEN_TERMINAL_FIELDS) {
    expect(`D2 — peeked notice does NOT carry "${forbidden}"`,
      !Object.prototype.hasOwnProperty.call(peeked, forbidden));
  }
  // peek is non-destructive — the malformed payload stays for the next
  // consume cycle.
  expect('D2 — peek does NOT remove the notice key',
    _store.has(FAVORITE_NOTICE_KEY));
}

// ── D3. peekFavoriteNotice rejects malformed payloads ───────────────
{
  _store.clear();
  _store.set(FAVORITE_NOTICE_KEY, '{ broken JSON');
  expect('D3 — peek on malformed JSON returns null',
    favorite.peekFavoriteNotice() === null);
  _store.set(FAVORITE_NOTICE_KEY, JSON.stringify([1, 2, 3]));
  expect('D3 — peek on array payload returns null',
    favorite.peekFavoriteNotice() === null);
  _store.set(FAVORITE_NOTICE_KEY, JSON.stringify({ source: 'NOT-favorite', label: 'X' }));
  const wrongSource = favorite.peekFavoriteNotice();
  expect('D3 — peek on non-"favorite" source emits source: ""',
    wrongSource?.source === '');
}

// ── D4. Source pin: favorite repeat handoff writes through writeRepeatRouteDraft ─
{
  // The favorite-side "Повторить" action funnels through
  // writeRepeatRouteDraft (imported from repeat_route.js) so the
  // sanitizer applies — there's no separate favorite-only draft writer.
  expect('D4 — favorite_routes imports writeRepeatRouteDraft from repeat_route.js',
    /import\s*\{[\s\S]*?writeRepeatRouteDraft[\s\S]*?\}\s*from\s*['"]\.\/repeat_route\.js['"]/.test(favoriteSrc));
  expect('D4 — favorite_routes imports buildRepeatRouteDraft from repeat_route.js',
    /import\s*\{[\s\S]*?buildRepeatRouteDraft[\s\S]*?\}\s*from\s*['"]\.\/repeat_route\.js['"]/.test(favoriteSrc));
  expect('D4 — favorite repeat path calls writeRepeatRouteDraft',
    /writeFavoriteRepeatDraft[\s\S]{0,800}writeRepeatRouteDraft\s*\(/.test(favoriteSrc));
}

// ── E. Terminal negative pins (CANCELED / NO_SHOW poisoned entries) ─

// ── E1. CANCELED entry with poisoned fields → route-only repeat draft ─
{
  const canceledEntry = poisonedRideEntry({
    tripId: 'trip-canceled-1',
    status: 'CANCELED',
    canceledBy: 'driver',
    cancel: { by: 'driver', reason: 'car_problem', comment: 'stale' },
    canceledAt: '2026-06-01T10:00:00.000Z',
  });
  const draft = repeat.buildRepeatRouteDraft(canceledEntry);
  expect('E1 — CANCELED entry still yields a route-only draft (route is the bridge data)',
    !!draft
    && Object.keys(draft).sort().join(',') === 'dropoff,pickup,role,suggestedFare');
  for (const forbidden of FORBIDDEN_TERMINAL_FIELDS) {
    expect(`E1 — CANCELED draft does NOT carry "${forbidden}"`,
      !Object.prototype.hasOwnProperty.call(draft, forbidden));
  }
  expect('E1 — CANCELED draft serialization does NOT leak cancel actor / reason',
    !JSON.stringify(draft).includes('car_problem')
    && !JSON.stringify(draft).includes('canceledBy'));
}

// ── E2. NO_SHOW entry with poisoned fields → route-only repeat draft ─
{
  const noShowEntry = poisonedRideEntry({
    tripId: 'trip-noshow-1',
    status: 'NO_SHOW',
    canceledBy: 'driver',
    cancel: { by: 'driver', reason: 'passenger_no_show' },
    noShowAt: '2026-06-01T10:00:00.000Z',
  });
  const draft = repeat.buildRepeatRouteDraft(noShowEntry);
  expect('E2 — NO_SHOW entry still yields a route-only draft',
    !!draft
    && Object.keys(draft).sort().join(',') === 'dropoff,pickup,role,suggestedFare');
  for (const forbidden of FORBIDDEN_TERMINAL_FIELDS) {
    expect(`E2 — NO_SHOW draft does NOT carry "${forbidden}"`,
      !Object.prototype.hasOwnProperty.call(draft, forbidden));
  }
  expect('E2 — NO_SHOW draft serialization does NOT leak "passenger_no_show" / "noShowAt"',
    !JSON.stringify(draft).includes('passenger_no_show')
    && !JSON.stringify(draft).includes('noShowAt'));
}

// ── E3. CANCELED entry → favorite is route-only too ─────────────────
{
  _store.clear();
  const canceledEntry = poisonedRideEntry({
    tripId: 'trip-canceled-fav',
    status: 'CANCELED',
    canceledBy: 'driver',
    cancel: { by: 'driver', reason: 'car_problem' },
  });
  const saved = favorite.saveFavoriteRouteFromHistory(canceledEntry);
  expect('E3 — CANCELED entry can still be saved as a favorite (route-only)',
    !!saved && isAllowedFavoriteShape(saved));
  for (const forbidden of FORBIDDEN_TERMINAL_FIELDS) {
    expect(`E3 — CANCELED favorite does NOT carry "${forbidden}"`,
      !Object.prototype.hasOwnProperty.call(saved, forbidden));
  }
  const raw = _store.get(FAVORITE_ROUTES_KEY) || '';
  expect('E3 — persisted favorite JSON does NOT leak "car_problem" / "canceledBy"',
    !raw.includes('car_problem') && !raw.includes('canceledBy'));
}

// ── E4. NO_SHOW entry → favorite is route-only too ──────────────────
{
  _store.clear();
  const noShowEntry = poisonedRideEntry({
    tripId: 'trip-noshow-fav',
    status: 'NO_SHOW',
    cancel: { by: 'driver', reason: 'passenger_no_show' },
  });
  const saved = favorite.saveFavoriteRouteFromHistory(noShowEntry);
  expect('E4 — NO_SHOW entry can still be saved as a favorite (route-only)',
    !!saved && isAllowedFavoriteShape(saved));
  for (const forbidden of FORBIDDEN_TERMINAL_FIELDS) {
    expect(`E4 — NO_SHOW favorite does NOT carry "${forbidden}"`,
      !Object.prototype.hasOwnProperty.call(saved, forbidden));
  }
}

// ── F. Source guards — repeat_route + favorite_routes isolation ─────
const repeatNoComments   = stripComments(repeatSrc);
const favoriteNoComments = stripComments(favoriteSrc);

// ── F1. repeat_route.js source isolation ────────────────────────────
expect('F1 — repeat_route.js never calls fetch(',
  !/\bfetch\s*\(/.test(repeatNoComments));
expect('F1 — repeat_route.js never references mapbox',
  !/mapbox/i.test(repeatNoComments));
expect('F1 — repeat_route.js does NOT import ride_state',
  !/from\s*['"][^'"]*ride_state['"]/.test(repeatNoComments));
expect('F1 — repeat_route.js does NOT import mock_api',
  !/from\s*['"][^'"]*mock_api['"]/.test(repeatNoComments));
expect('F1 — repeat_route.js does NOT import active_ride',
  !/from\s*['"][^'"]*active_ride[^'"]*['"]/.test(repeatNoComments));
expect('F1 — repeat_route.js does NOT import driver_offer_store',
  !/from\s*['"][^'"]*driver_offer_store['"]/.test(repeatNoComments));
expect('F1 — repeat_route.js does NOT import ride_history',
  !/from\s*['"][^'"]*ride_history['"]/.test(repeatNoComments));
expect('F1 — repeat_route.js never writes the payment / receipt / earnings stores',
  !/bazardrive\.driver_receipts\.v1/.test(repeatNoComments)
  && !/bazardrive\.ride_history\.v1/.test(repeatNoComments)
  && !/bazardrive\.active_ride\.v1/.test(repeatNoComments)
  && !/bazardrive\.order_overlay\.v1/.test(repeatNoComments)
  && !/bazardrive\.driver_offers\.v1/.test(repeatNoComments));
// Storage key whitelist: bazardrive.repeat_route.v1 ONLY.
{
  const allKeys = repeatSrc.match(/bazardrive\.[a-z_]+\.v\d+/g) || [];
  const uniqueKeys = [...new Set(allKeys)];
  expect('F1 — repeat_route.js only uses storage key bazardrive.repeat_route.v1',
    uniqueKeys.length === 1 && uniqueKeys[0] === REPEAT_ROUTE_KEY);
}

// ── F2. favorite_routes.js source isolation ─────────────────────────
expect('F2 — favorite_routes.js never calls fetch(',
  !/\bfetch\s*\(/.test(favoriteNoComments));
expect('F2 — favorite_routes.js never references mapbox',
  !/mapbox/i.test(favoriteNoComments));
expect('F2 — favorite_routes.js does NOT import mock_api',
  !/from\s*['"][^'"]*mock_api['"]/.test(favoriteNoComments));
expect('F2 — favorite_routes.js does NOT import ride_state',
  !/from\s*['"][^'"]*ride_state['"]/.test(favoriteNoComments));
expect('F2 — favorite_routes.js does NOT import active_ride',
  !/from\s*['"][^'"]*active_ride[^'"]*['"]/.test(favoriteNoComments));
expect('F2 — favorite_routes.js does NOT import driver_offer_store',
  !/from\s*['"][^'"]*driver_offer_store['"]/.test(favoriteNoComments));
expect('F2 — favorite_routes.js never writes payment / receipt / earnings stores',
  !/bazardrive\.driver_receipts\.v1/.test(favoriteNoComments)
  && !/bazardrive\.active_ride\.v1/.test(favoriteNoComments)
  && !/bazardrive\.order_overlay\.v1/.test(favoriteNoComments)
  && !/bazardrive\.driver_offers\.v1/.test(favoriteNoComments));
// Storage key whitelist on favorite_routes.js source: the two
// route-template keys it OWNS. The handoff to bazardrive.repeat_route.v1
// flows through repeat_route.js (which has its own F1 whitelist), so
// the constant must NOT appear directly inside favorite_routes.js —
// any future direct write would slip past repeat_route's sanitizer.
{
  const allKeys = favoriteSrc.match(/bazardrive\.[a-z_]+\.v\d+/g) || [];
  const uniqueKeys = [...new Set(allKeys)].sort();
  expect('F2 — favorite_routes.js storage keys are EXACTLY the route-template pair (favorites + notice)',
    JSON.stringify(uniqueKeys)
      === JSON.stringify([FAVORITE_ROUTES_KEY, FAVORITE_NOTICE_KEY].sort()));
  expect('F2 — favorite_routes.js does NOT write the repeat_route key directly (must funnel through repeat_route.js)',
    !uniqueKeys.includes(REPEAT_ROUTE_KEY));
}

// ── F3. Round-trip end-to-end via writeFavoriteRepeatDraft ──────────
// Behavioral pin: a favorite-route → repeat draft handoff writes a
// route-only draft to the repeat_route store. Forbidden fields never
// reach the persisted repeat-draft payload.
{
  _store.clear();
  favorite.saveFavoriteRouteFromHistory(poisonedRideEntry({
    tripId: 'trip-handoff-1',
    route: { pickupLabel: 'Handoff pickup', dropoffLabel: 'Handoff dropoff' },
  }));
  // Simulate the favorite-side "Повторить" click: write the same shape
  // the runtime path emits (writeRepeatRouteDraft is what runs after
  // the click; we exercise it directly with a favorite-derived entry).
  const fav = favorite.loadFavoriteRoutes()[0];
  const ok = repeat.writeRepeatRouteDraft({
    role:   fav.role,
    tripId: fav.sourceRideId || fav.id,
    route:  { pickupLabel: fav.pickup, dropoffLabel: fav.dropoff },
    fare:   fav.suggestedFare,
  });
  expect('F3 — favorite-repeat handoff writes a non-null repeat draft',
    ok === true);
  // Persisted shape is route-only.
  const raw = _store.get(REPEAT_ROUTE_KEY) || '';
  const parsed = JSON.parse(raw);
  const keys = Object.keys(parsed).sort();
  expect('F3 — handoff persisted draft is EXACTLY {role, pickup, dropoff, suggestedFare}',
    JSON.stringify(keys) === JSON.stringify(['dropoff', 'pickup', 'role', 'suggestedFare']));
  expect('F3 — handoff persisted draft pickup/dropoff match the favorite',
    parsed.pickup === 'Handoff pickup' && parsed.dropoff === 'Handoff dropoff');
  for (const forbidden of FORBIDDEN_TERMINAL_FIELDS) {
    expect(`F3 — handoff persisted draft does NOT carry "${forbidden}"`,
      !Object.prototype.hasOwnProperty.call(parsed, forbidden));
  }
}

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));

if (issues.length) process.exit(1);
