// BD-CONFIRM-01 — confirm/chat → active-ride handoff guard.
// BD-RIDE-AUTHORITY-01B — real order/response resolution, no silent MOCK_*
// fallback for a real (but unresolvable) handoff.
//
// The /trip-confirmation screen writes a CONFIRMED handoff record keyed by
// tripId, and /active-ride reads it back via the canonical loader to seed a
// new active ride. A confirmed handoff for a REAL ride order + selected
// response must seed REAL passenger/driver/vehicle/route/price data
// (resolved via responses.js's own mapping) — the MOCK_PASSENGER /
// MOCK_DRIVER / MOCK_VEHICLE / MOCK_ROUTE literals defined inside
// trip_confirmation_handoff.js are reserved for the explicit demo seed
// builder (buildActiveRideSeed) and must never leak into a real trip when
// its order/response data fails to resolve — that must return null
// instead, so a refactor that quietly reintroduces the old "always mock"
// fallback is caught here.
//
// This smoke combines a BEHAVIOURAL round-trip (real order + real response
// fixtures -> confirmed handoff -> loadCanonicalActiveRide, both the happy
// path and every "cannot recover" path) with a STATIC contract pin
// (active_ride.js still gates by role, the handoff module's exported
// surface stays intact, seedActiveRideFromConfirmedHandoff no longer wires
// to the mock builder, no inline demo strings leak outside the canonical
// MOCK_* literals).

import fs from 'node:fs';

// ── In-memory storage shim used by the behavioural section ─────────
const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { _store.delete(k); },
  clear: () => { _store.clear(); },
};

const root = new URL('../public/src/', import.meta.url);
const handoff   = await import(new URL('screens/trip_confirmation_handoff.js', root).href);
const rideState = await import(new URL('ride_state.js', root).href);

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const activeRide      = read('../public/src/screens/active_ride.js');
const handoffSrc      = read('../public/src/screens/trip_confirmation_handoff.js');
const driverSnapshot  = read('../public/src/screens/driver_handoff_snapshot.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

const TRIP_CONFIRM_KEY = 'bazardrive.trip_confirmation.v1';
const ACTIVE_RIDE_KEY  = 'bazardrive.active_ride.v1';
const RIDE_ORDERS_KEY  = 'bazardrive.ride_orders.v1';
const RESPONSES_KEY    = 'bazardrive.responses.v1';

function setConfirmedHandoff(tripId, role, overrides = {}) {
  const map = JSON.parse(localStorage.getItem(TRIP_CONFIRM_KEY) || '{}');
  map[tripId] = {
    tripId,
    role,
    state: 'CONFIRMED',
    responseId: 'mock_resp_1',
    createdAt: Date.now() - 60_000,
    expiresAt: Date.now() + 5 * 60_000,
    ...overrides,
  };
  localStorage.setItem(TRIP_CONFIRM_KEY, JSON.stringify(map));
}

// BD-RIDE-AUTHORITY-01B — deliberately UNIQUE order + response values (no
// overlap with any MOCK_* literal) so a real->mock regression is visible
// as the wrong string, not a coincidental match.
const REAL_ORDER = {
  id: 'confirm-audit-order-1',
  status: 'ACCEPTED',
  pickup: { label: 'ул. Реальная, 5' },
  dropoff: { label: 'пр. Настоящий, 9' },
  passenger: {
    name: 'Реальный Пассажир',
    initials: 'РП',
    phoneMasked: '+7 ... 00-01',
    comment: 'реальный комментарий',
    authorId: 'user_real_1',
    isCurrentUser: true,
  },
  comment: 'реальный комментарий',
  estimatedPrice: 2222,
  createdAt: new Date().toISOString(),
};
const REAL_TRIP_ID = `trip_${REAL_ORDER.id}`;
const REAL_RESPONSE = {
  id: 'resp_confirm_audit_1',
  kind: 'passenger_response',
  tripId: REAL_TRIP_ID,
  requestId: REAL_ORDER.id,
  orderId: REAL_ORDER.id,
  canonical: 'ride_order',
  driverPrice: 2400,
  pickupTiming: 'earlier',
  message: 'реальное сообщение водителя',
  vehicleId: 'veh_real_1',
  driverSnapshot: {
    name: 'Реальный Водитель',
    rating: 4.77,
    car: 'Kia Rio · синий',
    carModel: 'Kia Rio',
    carColor: 'синий',
    plate: 'Р 111 РР 77',
  },
  status: 'SENT',
  createdAt: new Date().toISOString(),
};

function setRealOrder(order) {
  const list = JSON.parse(localStorage.getItem(RIDE_ORDERS_KEY) || '[]');
  list.push(order);
  localStorage.setItem(RIDE_ORDERS_KEY, JSON.stringify(list));
}

function setRealResponse(response) {
  const map = JSON.parse(localStorage.getItem(RESPONSES_KEY) || '{}');
  map[response.id] = response;
  localStorage.setItem(RESPONSES_KEY, JSON.stringify(map));
}

function resetStorage() {
  localStorage.clear();
}

// ── A. Exported surface (the API /active-ride + this guard rely on) ───
for (const name of [
  'loadHandoffRecord',
  'isHandoffExpired',
  'loadConfirmedHandoff',
  'buildActiveRideSeed',
  'seedActiveRideFromConfirmedHandoff',
  'loadCanonicalActiveRide',
]) {
  expect(`trip_confirmation_handoff.js exports ${name}`,
    typeof handoff[name] === 'function');
}
for (const name of ['MOCK_PASSENGER', 'MOCK_DRIVER', 'MOCK_VEHICLE', 'MOCK_ROUTE']) {
  expect(`trip_confirmation_handoff.js exports ${name}`,
    handoff[name] && typeof handoff[name] === 'object');
}
expect('MOCK_DRIVER carries the canonical "Рустам К." identity used by /trip-confirmation',
  handoff.MOCK_DRIVER.name === 'Рустам К.' && handoff.MOCK_DRIVER.initials === 'РК');
expect('MOCK_PASSENGER carries the canonical "Анна М." identity used by /trip-confirmation',
  handoff.MOCK_PASSENGER.name === 'Анна М.' && handoff.MOCK_PASSENGER.initials === 'АМ');

// ── B. Static contract: dispatcher role gate + handoff wiring ─────────
expect('active_ride.js imports loadCanonicalActiveRide',
  /import\s*\{\s*loadCanonicalActiveRide\s*\}\s*from\s*'\.\/trip_confirmation_handoff\.js'/.test(activeRide));
expect('active_ride.js imports loadDriverHandoffSnapshot + applyDriverHandoffSnapshotToRide',
  /loadDriverHandoffSnapshot/.test(activeRide) && /applyDriverHandoffSnapshotToRide/.test(activeRide));
expect('active_ride.js dispatcher gates non-driver roles into renderPassenger()',
  /if\s*\(\s*role\s*!==\s*'driver'\s*\)\s*return\s+renderPassenger\(\)/.test(activeRide));
expect('active_ride.js dispatcher resolves role from ?role= first, falling back to user',
  /role\s*=\s*query\.get\('role'\)\s*\|\|\s*\(resolveRole\(/.test(activeRide));
expect('active_ride.js calls loadCanonicalActiveRide({ tripId, role: "driver" })',
  /loadCanonicalActiveRide\(\s*\{\s*tripId\s*,\s*role:\s*'driver'\s*\}\s*\)/.test(activeRide));

// Handoff seed must not inline any string that drifts from the MOCK_*
// literals. Pinning the seed builder body proves the contract is read
// from the literals and not duplicated inline (a duplicated 'Рустам К.'
// inside buildActiveRideSeed would silently mask MOCK_DRIVER refactors).
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
const seedBody = functionBody(handoffSrc, 'buildActiveRideSeed') || '';
expect('buildActiveRideSeed() body resolved', seedBody.length > 0);
for (const literal of ['MOCK_PASSENGER', 'MOCK_DRIVER', 'MOCK_VEHICLE', 'MOCK_ROUTE']) {
  expect(`buildActiveRideSeed reads ${literal} (no inline drift)`,
    seedBody.includes(literal));
}
expect('buildActiveRideSeed never inlines a driver name (must come from MOCK_DRIVER)',
  !/['"`]Рустам К\.['"`]/.test(seedBody));
expect('buildActiveRideSeed never inlines a passenger name (must come from MOCK_PASSENGER)',
  !/['"`]Анна М\.['"`]/.test(seedBody));
expect('buildActiveRideSeed never inlines a vehicle model (must come from MOCK_VEHICLE)',
  !/['"`]Toyota Camry['"`]/.test(seedBody));

// ── C. Behavioural: REAL order + response round-trip (BD-RIDE-AUTHORITY-01B) ──
// A confirmed handoff whose responseId resolves to a real, canonical
// (orderId-linked) passenger_response must seed REAL data — never the
// MOCK_* literals, even though they're the same identity /trip-confirmation
// itself still renders as a static preview.
resetStorage();
setRealOrder(REAL_ORDER);
setRealResponse(REAL_RESPONSE);
setConfirmedHandoff(REAL_TRIP_ID, 'passenger', { responseId: REAL_RESPONSE.id });

const realRide = handoff.loadCanonicalActiveRide({ tripId: REAL_TRIP_ID, role: 'passenger' });
expect('REAL confirmed handoff materializes a ride from real order + response data',
  !!realRide && realRide.tripId === REAL_TRIP_ID);
expect('seeded ride.status starts at DRIVER_EN_ROUTE',
  realRide?.status === rideState.RIDE_STATUS.DRIVER_EN_ROUTE);
expect('real ride driver identity comes from the REAL response.driverSnapshot, not MOCK_DRIVER',
  realRide?.driver?.name === REAL_RESPONSE.driverSnapshot.name
  && realRide?.driver?.name !== handoff.MOCK_DRIVER.name);
expect('real ride passenger identity comes from the REAL order.passenger, not MOCK_PASSENGER',
  realRide?.passenger?.name === REAL_ORDER.passenger.name
  && realRide?.passenger?.name !== handoff.MOCK_PASSENGER.name);
expect('real ride vehicle comes from the REAL response.driverSnapshot, not MOCK_VEHICLE',
  realRide?.vehicle?.model === REAL_RESPONSE.driverSnapshot.carModel
  && realRide?.vehicle?.plate !== handoff.MOCK_VEHICLE.plate);
expect('real ride route comes from the REAL order pickup/dropoff, not MOCK_ROUTE',
  realRide?.route?.pickupLabel === REAL_ORDER.pickup.label
  && realRide?.route?.dropoffLabel === REAL_ORDER.dropoff.label);
expect('real ride price reflects the REAL driverPrice, not the MOCK_ROUTE price string',
  realRide?.order?.offerPrice !== handoff.MOCK_ROUTE.priceRub);
expect('real ride pins selectedDriver.responseId to the real response id',
  realRide?.selectedDriver?.responseId === REAL_RESPONSE.id);
expect('real ride records the resolved orderId',
  realRide?.orderId === REAL_ORDER.id);
expect('real ride does NOT carry the seededFrom=trip_confirmation_handoff mock marker',
  realRide?.seededFrom !== 'trip_confirmation_handoff');

// Second load is idempotent — the canonical record is read from
// bazardrive.active_ride.v1 instead of being re-seeded / re-resolved.
const realRideAgain = handoff.loadCanonicalActiveRide({ tripId: REAL_TRIP_ID, role: 'passenger' });
expect('second loadCanonicalActiveRide returns the existing persisted real ride',
  realRideAgain?.tripId === REAL_TRIP_ID
  && realRideAgain?.driver?.name === REAL_RESPONSE.driverSnapshot.name);

// Cross-role: once the real ride is persisted, a driver-role request for
// the same tripId converges on the same real record (no re-seed, no
// identity flip back to MOCK_*) — same findActiveRide-first guarantee
// BD-RIDE-D-10 relies on, just proven with real data.
const realRideDriverView = handoff.loadCanonicalActiveRide({ tripId: REAL_TRIP_ID, role: 'driver' });
expect('driver-role view of the same tripId converges on the same real persisted ride',
  realRideDriverView?.tripId === REAL_TRIP_ID
  && realRideDriverView?.driver?.name === REAL_RESPONSE.driverSnapshot.name
  && realRideDriverView?.passenger?.name === REAL_ORDER.passenger.name);

// ── D. Resolution-failure guards — the core BD-RIDE-AUTHORITY-01B regression ──
// A confirmed handoff that LOOKS real (a well-formed CONFIRMED record) but
// whose order/response data cannot be recovered must return null — NEVER
// fall back to seeding a MOCK_* ride. Each sub-case breaks exactly one link
// in the resolution chain.
resetStorage();

function expectNoMockFallback(label, tripId) {
  const ride = handoff.loadCanonicalActiveRide({ tripId, role: 'passenger' });
  expect(`${label}: loadCanonicalActiveRide returns null (no ride at all)`, ride === null);
  // Even if some future regression returns a truthy value here, it must
  // never carry the MOCK_DRIVER/MOCK_PASSENGER identity — belt + suspenders
  // against a partial/silent fallback.
  expect(`${label}: no ride was persisted under this tripId either`,
    rideState.findActiveRide(tripId) === null);
}

// D1. responseId does not resolve to any stored response (stale/missing).
{
  const tripId = 'trip_confirm-audit-order-1-d1';
  setRealOrder({ ...REAL_ORDER, id: 'confirm-audit-order-1-d1' });
  setConfirmedHandoff(tripId, 'passenger', { responseId: 'resp_does_not_exist' });
  expectNoMockFallback('D1 missing response', tripId);
}

// D2. response resolves but carries no canonical orderId link (legacy
//     marketplace response — respond.js only sets canonicalLink when the
//     answered post is a real ride order).
{
  const tripId = 'trip_confirm-audit-order-1-d2';
  const legacyResponse = { ...REAL_RESPONSE, id: 'resp_legacy_d2' };
  delete legacyResponse.orderId;
  setRealResponse(legacyResponse);
  setConfirmedHandoff(tripId, 'passenger', { responseId: legacyResponse.id });
  expectNoMockFallback('D2 no canonical orderId link', tripId);
}

// D3. response + orderId resolve, but the order itself is gone (e.g.
//     cleared/expired) — getOrderById finds nothing.
{
  const ghostResponse = { ...REAL_RESPONSE, id: 'resp_ghost_d3', orderId: 'order-does-not-exist-d3' };
  setRealResponse(ghostResponse);
  const tripId = 'trip_order-does-not-exist-d3';
  setConfirmedHandoff(tripId, 'passenger', { responseId: ghostResponse.id });
  expectNoMockFallback('D3 order not found', tripId);
}

// D4. response + order resolve, but the response has no driver identity
//     snapshot at all (malformed / pre-snapshot legacy write).
{
  const orderId = 'confirm-audit-order-1-d4';
  setRealOrder({ ...REAL_ORDER, id: orderId });
  const noSnapResponse = { ...REAL_RESPONSE, id: 'resp_no_snap_d4', orderId, driverSnapshot: null };
  setRealResponse(noSnapResponse);
  const tripId = `trip_${orderId}`;
  setConfirmedHandoff(tripId, 'passenger', { responseId: noSnapResponse.id });
  expectNoMockFallback('D4 no driver snapshot', tripId);
}

// D5. Every link resolves, but the REQUESTED tripId does not match
//     trip_<orderId> — buildPassengerRideSeed always derives trip_<orderId>,
//     so seeding under a different key than the one the caller will read
//     back must be refused rather than silently mis-keyed (or worse, mocked).
{
  const orderId = 'confirm-audit-order-1-d5';
  setRealOrder({ ...REAL_ORDER, id: orderId });
  const mismatchResponse = { ...REAL_RESPONSE, id: 'resp_mismatch_d5', orderId };
  setRealResponse(mismatchResponse);
  // NOT prefixed with trip_. respond.js's canonical branch always produces
  // trip_<orderId> now (BD-RIDE-AUTHORITY-01B fix, see
  // smoke-ride-authority-01b-real-flow.mjs), so this exact shape is no
  // longer reachable via the real flow for a canonical response — this is
  // now a defense-in-depth pin on the mismatch guard itself (any future
  // caller or malformed record with a mismatched key must still refuse).
  const bareTripId = orderId;
  setConfirmedHandoff(bareTripId, 'passenger', { responseId: mismatchResponse.id });
  expectNoMockFallback('D5 tripId does not match trip_<orderId>', bareTripId);
}

// ── E. Explicit demo/fixture seed builder stays intact and available ──
// buildActiveRideSeed is no longer wired automatically into the real
// handoff path, but it must still exist and still produce the exact
// MOCK_* identity for an explicit demo/preview caller.
{
  const demoHandoff = { role: 'passenger', state: 'CONFIRMED', responseId: 'demo_resp_1', createdAt: Date.now(), expiresAt: Date.now() + 60_000 };
  const demoSeed = handoff.buildActiveRideSeed({ tripId: 'trip_demo_preview', role: 'passenger', handoff: demoHandoff });
  expect('buildActiveRideSeed still produces a seed for an explicit demo caller', !!demoSeed);
  expect('explicit demo seed still carries the MOCK_DRIVER identity',
    demoSeed?.driver?.name === handoff.MOCK_DRIVER.name);
  expect('explicit demo seed still carries the MOCK_PASSENGER identity',
    demoSeed?.passenger?.name === handoff.MOCK_PASSENGER.name);
  expect('explicit demo seed still carries the MOCK_VEHICLE identity',
    demoSeed?.vehicle?.model === handoff.MOCK_VEHICLE.model);
}

// ── F. Structural pin: the real handoff path no longer wires to the mock builder ──
const seedFnBody = functionBody(handoffSrc, 'seedActiveRideFromConfirmedHandoff') || '';
expect('seedActiveRideFromConfirmedHandoff() body resolved', seedFnBody.length > 0);
expect('seedActiveRideFromConfirmedHandoff no longer calls buildActiveRideSeed (no silent MOCK_* fallback for a real handoff)',
  !/buildActiveRideSeed\(/.test(seedFnBody));
expect('seedActiveRideFromConfirmedHandoff delegates to the real-resolution helper',
  /seedRealActiveRideFromHandoff\(/.test(seedFnBody));

// ── G. Reject paths: missing, expired, wrong state, role mismatch ────
resetStorage();
const tripC = 'trip_confirm_smoke_c';
expect('loadCanonicalActiveRide returns null when no handoff exists',
  handoff.loadCanonicalActiveRide({ tripId: tripC, role: 'passenger' }) === null);

resetStorage();
setConfirmedHandoff(tripC, 'passenger', { state: 'PENDING' });
expect('loadConfirmedHandoff rejects a non-CONFIRMED state',
  handoff.loadConfirmedHandoff(tripC, 'passenger') === null);
expect('loadCanonicalActiveRide returns null when handoff state !== CONFIRMED',
  handoff.loadCanonicalActiveRide({ tripId: tripC, role: 'passenger' }) === null);

resetStorage();
setConfirmedHandoff(tripC, 'passenger', { expiresAt: Date.now() - 60_000 });
expect('loadConfirmedHandoff rejects an expired record',
  handoff.loadConfirmedHandoff(tripC, 'passenger') === null);
expect('loadCanonicalActiveRide returns null when the handoff has expired',
  handoff.loadCanonicalActiveRide({ tripId: tripC, role: 'passenger' }) === null);

// Cross-role fallback mechanism (BD-RIDE-D-10): a role that has no handoff
// of its own must still resolve via the OTHER role's confirmed handoff —
// proven here with a real, resolvable order+response so the mechanism is
// tested independently of the D-section resolution-failure guards above.
resetStorage();
setRealOrder(REAL_ORDER);
const crossResponse = { ...REAL_RESPONSE, id: 'resp_cross_role_g' };
setRealResponse(crossResponse);
setConfirmedHandoff(REAL_TRIP_ID, 'driver', { responseId: crossResponse.id });
expect('loadConfirmedHandoff rejects an explicit role mismatch',
  handoff.loadConfirmedHandoff(REAL_TRIP_ID, 'passenger') === null);
// loadCanonicalActiveRide must still resolve via the cross-role fallback
// (passenger requests a tripId only known as a driver handoff).
const crossFromDriver = handoff.loadCanonicalActiveRide({ tripId: REAL_TRIP_ID, role: 'passenger' });
expect('loadCanonicalActiveRide cross-role seeds real data when the other side\'s handoff exists',
  !!crossFromDriver && crossFromDriver.tripId === REAL_TRIP_ID
  && crossFromDriver.driver?.name === REAL_RESPONSE.driverSnapshot.name);

// ── H. Demo-fallback leak guard (active_ride.js / driver_handoff_snapshot.js) ─
// Demo identity strings ("5ч 12м", "4,92") were stripped from active_ride.js
// in BD-LIFE-07 so live snapshots don't surface the seed values when a
// field is missing. Pin the cleanup: no bare `|| '<demo>'` fallback chain
// should reappear in the driver shell. The BD-LIFE-07 comment itself
// references the old strings as historical context, so strip line + block
// comments before scanning the source for the forbidden fallback form.
const activeRideNoComments = activeRide
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
expect('active_ride.js does not reintroduce the "5ч 12м" shift-duration fallback',
  !/\|\|\s*['"]5ч 12м['"]/.test(activeRideNoComments));
expect('active_ride.js does not reintroduce the "4,92" rating fallback',
  !/\|\|\s*['"]4,92['"]/.test(activeRideNoComments));
expect('driver_handoff_snapshot.js never persists ride state via ride_state.js',
  !/from\s*'\.\.\/ride_state\.js'/.test(driverSnapshot));

// ── I. Service worker precaches the handoff modules ──────────────────
// /active-ride statically imports both handoff modules — if the SW
// PRECACHE forgets either, an offline PWA session can't seed a fresh
// active ride from a /trip-confirmation handoff.
const sw = read('../public/sw.js');
expect('public/sw.js PRECACHE includes trip_confirmation_handoff.js',
  /trip_confirmation_handoff\.js/.test(sw));
expect('public/sw.js PRECACHE includes driver_handoff_snapshot.js',
  /driver_handoff_snapshot\.js/.test(sw));
// BD-RIDE-ACCEPT-RESPONSE-01 — trip_confirmation_handoff.js statically
// imports ride_actions.js, whose shared command imports the pure ride_seed.js
// builder; an offline session needs both modules precached.
expect('public/sw.js PRECACHE includes ride_actions.js',
  /['"]\.\/src\/ride_actions\.js['"]/.test(sw));
expect('public/sw.js PRECACHE includes ride_seed.js',
  /['"]\.\/src\/ride_seed\.js['"]/.test(sw));
// BD-RIDE-AUTHORITY-01D — trip_confirmation_handoff.js now statically
// imports response_store.js and ride_context.js instead of responses.js;
// both need to be precached for the same offline reason.
expect('public/sw.js PRECACHE includes response_store.js',
  /['"]\.\/src\/response_store\.js['"]/.test(sw));
expect('public/sw.js PRECACHE includes ride_context.js',
  /['"]\.\/src\/ride_context\.js['"]/.test(sw));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
