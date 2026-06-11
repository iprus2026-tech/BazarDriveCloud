// BD-ORDER-DETAIL-01D-2B-F — Audit: passenger active-ride seed consumption.
//
// 01D-2B opens the seed pinhole:
//   Order Detail P3 «Открыть поездку»
//     → buildPassengerActiveRideSeed(order)
//     → saveActiveRide(seed)
//     → go('/active-ride?role=passenger&tripId=…')
//
// The /active-ride dispatcher then reads the seed via
// `loadCanonicalActiveRide({ tripId, role: 'passenger' })`, which
// preferentially returns the persisted record. The passenger renderer
// in `active_ride_passenger.js` reads from that record's keys
// (`ride.driver.name`, `ride.driver.initials`, `ride.vehicle` via
// `carLine(ride)`, `ride.route.pickupLabel`, `ride.route.dropoffLabel`,
// etc.) using `(ride.X && ride.X.Y) || '<demo fallback>'` chains.
//
// The audit invariant: when the seed carries UNIQUE non-empty
// values, every demo `|| 'fallback'` chain is short-circuited by the
// non-empty seed value, so the rendered HTML cannot leak demo data.
// This smoke verifies the data-side of that invariant end-to-end:
//
//   • buildPassengerActiveRideSeed produces a seed whose keys carry
//     the unique offer/order values verbatim (no demo coercion).
//   • saveActiveRide → findActiveRide round-trip preserves them.
//   • loadCanonicalActiveRide (the loader the dispatcher uses)
//     returns the same intact record.
//   • The renderer reads from the exact keys the seed populates
//     (verified by source scan).
//   • The banned demo strings («Рустам К.», «РК», «Toyota Camry»)
//     only ever appear in live renderer code as POSITIONAL `||`
//     fallbacks — never as unconditional template insertions or
//     hard-coded literals in markup.
//   • The legacy demo strings «4,92», «серый», «5ч 12м» do NOT
//     appear in live renderer code at all (BD-LIFE-07 cleanup).
//
// No DOM is shimmed: the contract is fully observable via the
// seed-key + renderer-source pairing.
//
// Scope reminder (issue #467):
//   • 01D-2C mutations (passenger cancel / reject single offer /
//     driver D3 cancel) are NOT touched.
//   • Driver active-ride flow is NOT touched.
//   • Passenger select commit is NOT touched.
//   • No Mapbox / backend / payment / auth.

import fs from 'node:fs';

const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { _store.delete(k); },
  clear: () => { _store.clear(); },
};

const srcRoot = new URL('../public/src/', import.meta.url);
const orderDetail = await import(new URL('screens/order_detail.js', srcRoot).href);
const rideState   = await import(new URL('ride_state.js', srcRoot).href);
const handoff     = await import(new URL('screens/trip_confirmation_handoff.js', srcRoot).href);

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const passengerSrc = read('../public/src/screens/active_ride_passenger.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── A. Build an Order Detail order with deliberately UNIQUE driver /
//        vehicle / route / price values so a demo fallback would be
//        immediately visible as the wrong string. ─────────────────────
const UNIQUE_ORDER = {
  id: 'audit-order-2b',
  status: 'ACCEPTED',
  selectedDriverId: 'audit-drv',
  passengerName: 'Аудит Пассажир',
  pickup: 'ул. Аудитная, 1',
  dropoff: 'ст. Аудитная',
  time: 'Завтра, 00:00',
  budget: 9876,
  comment: 'audit comment',
  offers: [{
    id: 'audit_offer_1',
    orderId: 'audit-order-2b',
    driverId: 'audit-drv',
    driverName: 'Аудит Иванов',
    car: 'Lada Vesta · красный',
    rating: '4,88',
    etaMin: 7,
    price: 9000,
    message: 'audit',
    status: 'accepted',
    createdAt: '2026-06-12T00:00:00.000Z',
    updatedAt: '2026-06-12T00:00:00.000Z',
    expiresAt: '2026-06-12T00:15:00.000Z',
  }],
};

const seed = orderDetail.buildPassengerActiveRideSeed(UNIQUE_ORDER);
expect('buildPassengerActiveRideSeed returns a seed for the unique order',
  !!seed);
expect('seed.tripId is derived from the unique orderId',
  !!seed && seed.tripId === 'trip_audit-order-2b');
expect('seed.role === "passenger"', !!seed && seed.role === 'passenger');
expect('seed.seededFrom marks the Order Detail handoff',
  !!seed && seed.seededFrom === 'order_detail_passenger_handoff');

// Seed carries the unique values verbatim — no demo coercion at write.
expect('seed.driver.name === "Аудит Иванов"',
  !!seed && seed.driver.name === 'Аудит Иванов');
expect('seed.driver.initials computed from the unique name (non-empty)',
  !!seed && typeof seed.driver.initials === 'string' && seed.driver.initials.length > 0);
expect('seed.driver.car === "Lada Vesta · красный"',
  !!seed && seed.driver.car === 'Lada Vesta · красный');
expect('seed.driver.rating === "4,88"',
  !!seed && seed.driver.rating === '4,88');
expect('seed.vehicle.model === "Lada Vesta · красный"',
  !!seed && seed.vehicle.model === 'Lada Vesta · красный');
expect('seed.route.pickupLabel === "ул. Аудитная, 1"',
  !!seed && seed.route.pickupLabel === 'ул. Аудитная, 1');
expect('seed.route.dropoffLabel === "ст. Аудитная"',
  !!seed && seed.route.dropoffLabel === 'ст. Аудитная');
expect('seed.passenger.name === "Аудит Пассажир"',
  !!seed && seed.passenger.name === 'Аудит Пассажир');
expect('seed.order.offerPrice is a non-empty formatted RUB string',
  !!seed && typeof seed.order.offerPrice === 'string' && /[0-9]/.test(seed.order.offerPrice));
expect('seed.payment.amount is a non-empty formatted RUB string',
  !!seed && typeof seed.payment.amount === 'string' && /[0-9]/.test(seed.payment.amount));

// Seed values must NEVER coincide with the banned demo fallback strings
// for this unique input. This is a sanity tripwire — if the seed
// builder ever shadowed real input with a demo literal, the round-trip
// below would not catch it; this loop will.
const BANNED_FALLBACKS = ['Рустам К.', 'РК', 'Toyota Camry', 'серый', '5ч 12м', '4,92'];
for (const banned of BANNED_FALLBACKS) {
  expect(`seed.driver.name !== "${banned}" (unique input)`,
    !!seed && seed.driver.name !== banned);
  expect(`seed.driver.initials !== "${banned}" (unique input)`,
    !!seed && seed.driver.initials !== banned);
  expect(`seed.driver.car !== "${banned}" (unique input)`,
    !!seed && seed.driver.car !== banned);
  expect(`seed.driver.rating !== "${banned}" (unique input)`,
    !!seed && seed.driver.rating !== banned);
  expect(`seed.vehicle.model !== "${banned}" (unique input)`,
    !!seed && seed.vehicle.model !== banned);
}

// ── B. Round-trip via the canonical loaders that /active-ride uses ──
rideState.saveActiveRide(seed);

const persisted = rideState.findActiveRide(seed.tripId);
expect('findActiveRide round-trip resolves the same tripId',
  !!persisted && persisted.tripId === seed.tripId);
expect('findActiveRide preserves driver.name',
  persisted && persisted.driver && persisted.driver.name === 'Аудит Иванов');
expect('findActiveRide preserves driver.initials',
  persisted && persisted.driver && persisted.driver.initials === seed.driver.initials);
expect('findActiveRide preserves driver.car',
  persisted && persisted.driver && persisted.driver.car === 'Lada Vesta · красный');
expect('findActiveRide preserves driver.rating',
  persisted && persisted.driver && persisted.driver.rating === '4,88');
expect('findActiveRide preserves vehicle.model',
  persisted && persisted.vehicle && persisted.vehicle.model === 'Lada Vesta · красный');
expect('findActiveRide preserves route.pickupLabel',
  persisted && persisted.route && persisted.route.pickupLabel === 'ул. Аудитная, 1');
expect('findActiveRide preserves route.dropoffLabel',
  persisted && persisted.route && persisted.route.dropoffLabel === 'ст. Аудитная');

const canonical = handoff.loadCanonicalActiveRide({
  tripId: seed.tripId,
  role: 'passenger',
});
expect('loadCanonicalActiveRide resolves the persisted seed (no handoff fallback)',
  !!canonical && canonical.tripId === seed.tripId);
expect('loadCanonicalActiveRide preserves driver.name',
  canonical && canonical.driver && canonical.driver.name === 'Аудит Иванов');
expect('loadCanonicalActiveRide preserves driver.initials',
  canonical && canonical.driver && canonical.driver.initials === seed.driver.initials);
expect('loadCanonicalActiveRide preserves driver.car',
  canonical && canonical.driver && canonical.driver.car === 'Lada Vesta · красный');
expect('loadCanonicalActiveRide preserves driver.rating',
  canonical && canonical.driver && canonical.driver.rating === '4,88');
expect('loadCanonicalActiveRide preserves vehicle.model',
  canonical && canonical.vehicle && canonical.vehicle.model === 'Lada Vesta · красный');
expect('loadCanonicalActiveRide preserves route.pickupLabel',
  canonical && canonical.route && canonical.route.pickupLabel === 'ул. Аудитная, 1');
expect('loadCanonicalActiveRide preserves seededFrom marker',
  canonical && canonical.seededFrom === 'order_detail_passenger_handoff');

// Sanity: the persisted record must not contain ANY banned demo
// fallback for the unique input — direct value identity check.
for (const banned of BANNED_FALLBACKS) {
  expect(`persisted record's driver.name !== "${banned}"`,
    persisted.driver.name !== banned);
  expect(`persisted record's driver.initials !== "${banned}"`,
    persisted.driver.initials !== banned);
  expect(`persisted record's vehicle.model !== "${banned}"`,
    persisted.vehicle.model !== banned);
}

// ── C. Renderer source: reads from the exact seed keys ──────────────
// If the renderer reads from `ride.X.Y` and the seed writes `seed.X.Y`,
// then with non-empty seed values the renderer's `|| 'demo'` chain
// short-circuits to the seed value. Verified together with section D.
expect('renderer reads `(ride.driver && ride.driver.name)`',
  /\(ride\.driver\s*&&\s*ride\.driver\.name\)/.test(passengerSrc));
expect('renderer reads `(ride.driver && ride.driver.initials)`',
  /\(ride\.driver\s*&&\s*ride\.driver\.initials\)/.test(passengerSrc));
expect('renderer reads `(ride.driver && ride.driver.rating)`',
  /\(ride\.driver\s*&&\s*ride\.driver\.rating\)/.test(passengerSrc));
expect('renderer reads `ride.vehicle` via the carLine helper',
  /carLine\(ride\)/.test(passengerSrc) && /ride\s*&&\s*ride\.vehicle/.test(passengerSrc));
expect('renderer reads `ride.route.pickupLabel`',
  /ride\.route\s*&&\s*ride\.route\.pickupLabel/.test(passengerSrc));
expect('renderer reads `ride.route.dropoffLabel`',
  /ride\.route\s*&&\s*ride\.route\.dropoffLabel/.test(passengerSrc));

// ── D. Banned demo strings are POSITIONAL `||` fallbacks only ───────
// Live code (no comments) is the scan target. Three banned strings —
// «Рустам К.», «РК», «Toyota Camry» — are allowed only as positional
// `||` fallbacks because their presence is the legacy mock-only path
// and `||` short-circuits on the 01D-2B seed's non-empty values.
//
// «4,92», «серый», «5ч 12м» were removed by BD-LIFE-07 cleanup and
// must NOT reappear in live code at all.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const passengerCode = stripComments(passengerSrc);

const BANNED_NEVER_IN_LIVE_CODE = ['4,92', 'серый', '5ч 12м'];
for (const banned of BANNED_NEVER_IN_LIVE_CODE) {
  expect(`active_ride_passenger.js carries no "${banned}" in live code (BD-LIFE-07 cleanup)`,
    !passengerCode.includes(banned),
    `index=${passengerCode.indexOf(banned)}`);
}

const BANNED_ONLY_AS_FALLBACK = ['Рустам К.', 'РК', 'Toyota Camry'];
for (const banned of BANNED_ONLY_AS_FALLBACK) {
  const escaped = banned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const totalRe = new RegExp(escaped, 'g');
  const totalCount = (passengerCode.match(totalRe) || []).length;
  if (totalCount === 0) {
    expect(`active_ride_passenger.js carries no "${banned}" in live code`, true);
    continue;
  }
  // Positional `||` fallback: preceded by `||` + optional whitespace +
  // an opening quote, followed by the banned literal, then a closing
  // quote. Allows single, double, or backtick quotes.
  const fallbackRe = new RegExp(
    `\\|\\|\\s*['"\`]\\s*${escaped}\\s*['"\`]`, 'g');
  const fallbackCount = (passengerCode.match(fallbackRe) || []).length;
  expect(`every "${banned}" occurrence in live code is a positional || fallback`,
    totalCount === fallbackCount,
    `total=${totalCount} fallback=${fallbackCount}`);
}

// ── E. Persisted seed cannot trigger any banned fallback ────────────
// With a non-empty seed value, the `||` short-circuits to the seed.
// Verify by direct value identity: every renderer-read field on the
// persisted record is non-empty AND not equal to any banned string.
const READ_FIELDS = [
  ['driver.name',       persisted.driver.name],
  ['driver.initials',   persisted.driver.initials],
  ['driver.car',        persisted.driver.car],
  ['driver.rating',     persisted.driver.rating],
  ['vehicle.model',     persisted.vehicle.model],
  ['route.pickupLabel', persisted.route.pickupLabel],
  ['route.dropoffLabel',persisted.route.dropoffLabel],
];
for (const [path, value] of READ_FIELDS) {
  expect(`persisted.${path} is a non-empty string`,
    typeof value === 'string' && value.length > 0);
  for (const banned of BANNED_FALLBACKS) {
    expect(`persisted.${path} !== "${banned}"`,
      value !== banned);
  }
}

// ── F. Missing-seed fallback path is preserved (empty-state behaviour) ─
// The audit's negative invariant: when there is NO seed for a tripId,
// `findActiveRide` returns null and the dispatcher's fallback path
// applies. We do NOT change that behaviour. The pin: `findActiveRide`
// for an unknown tripId returns null (not a fabricated demo record).
expect('findActiveRide(unknown-tripId) returns null',
  rideState.findActiveRide('definitely-not-a-real-trip') === null);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
