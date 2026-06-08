// BD-PROFILE-D-05E — Driver snapshot reads from active garage vehicle.
//
// 05D made `profile.driverGarage.activeVehicleId` the persisted record
// of the driver's chosen garage vehicle. 05E lets the two production
// driver-snapshot call sites consume that selection through the same
// resolver — without crossing into lifecycle, history, or receipt state:
//
//   1. `respond.js getUserVehicle(u)` — builds the vehicle card on
//      /respond and feeds the submit-time `driverSnapshot` written to
//      `bazardrive.responses.v1`.
//   2. `ride_actions.js buildAcceptedDriverSnapshot(u)` — builds the
//      driver/vehicle snapshot used by the accept-on-/driver-map
//      handoff (`seedActiveRideFromAcceptedOrder`).
//
// Both wrap `resolveActiveGarageVehicle(u)` from `public/src/garage.js`.
// In production the resolver builds with no render-gate options, so a
// persisted `activeVehicleId === 'demo-2'` (which only exists when
// `?garage=multi` is on in /profile) is silently demoted to the legacy
// fallback — the demo car never reaches a real response or handoff.
//
// This smoke pins the contract that:
//   • Both call sites READ the resolved active vehicle (not the raw
//     legacy user.* fields directly).
//   • Neither call site mutates storage — no driverGarage write, no
//     responses/active_ride/ride_history/driver_receipts/respond write.
//   • Driver identity (name / rating) still flows from legacy profile
//     fields (the resolver is vehicle-scoped only).
//   • The existing null-bail semantics are preserved (partially-
//     onboarded profiles still fall through to the demo path).

// ── localStorage stub ────────────────────────────────────────────────────────
const local = new Map();
globalThis.localStorage = {
  getItem: (k) => (local.has(k) ? local.get(k) : null),
  setItem: (k, v) => local.set(k, String(v)),
  removeItem: (k) => local.delete(k),
  clear: () => local.clear(),
};

// ── sessionStorage stub ──────────────────────────────────────────────────────
const session = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (session.has(k) ? session.get(k) : null),
  setItem: (k, v) => session.set(k, String(v)),
  removeItem: (k) => session.delete(k),
  clear: () => session.clear(),
};

// respond.js touches `window.location.hash` on module load via its
// import graph (router.js). Provide a minimal hash-only location stub
// — no DOM nodes are needed for the pure function tests below.
let currentHash = '';
const locationStub = {};
Object.defineProperty(locationStub, 'hash', {
  configurable: true,
  get: () => currentHash,
  set: (v) => {
    currentHash = typeof v === 'string' && v.startsWith('#') ? v : '#' + String(v);
  },
});
globalThis.window   = { location: locationStub, addEventListener() {}, removeEventListener() {} };
globalThis.location = locationStub;
globalThis.document = {
  createElement: () => ({ addEventListener() {}, removeEventListener() {} }),
  addEventListener() {}, removeEventListener() {},
  querySelector: () => null,
};

// ── Imports (after stubs) ────────────────────────────────────────────────────
const { user } = await import('../public/src/state.js');
const { getUserVehicle } = await import('../public/src/screens/respond.js');
const { buildAcceptedDriverSnapshot } = await import('../public/src/ride_actions.js');
const { resolveActiveGarageVehicle, buildGarageVehicles } = await import('../public/src/garage.js');

// ── Test helpers ─────────────────────────────────────────────────────────────
const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

function reset() {
  local.clear();
  session.clear();
  user.reset();
  currentHash = '';
}

function snapshotLocalStorage() {
  const entries = [];
  for (const [k, v] of local.entries()) entries.push([k, String(v)]);
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify(entries);
}

function snapshotByKey() {
  const out = {};
  for (const [k, v] of local.entries()) out[k] = String(v);
  return out;
}

const FORBIDDEN_KEYS = [
  'bazardrive.responses.v1',
  'bazardrive.active_ride.v1',
  'bazardrive.ride_history.v1',
  'bazardrive.driver_receipts.v1',
  'bazardrive.respond.v1',
];

// ── Scenario 1 — Default driver: getUserVehicle reads from resolver
// (which falls back to legacy when no saved id). The returned shape
// must match the existing contract (id, name, plate, color, seats,
// features). ───────────────────────────────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const u = user.get();
  const v = getUserVehicle(u);
  expect('S1: getUserVehicle returns a vehicle object',
    v && typeof v === 'object');
  expect('S1: vehicle.id is "user_vehicle" (legacy contract preserved)',
    v?.id === 'user_vehicle', String(v?.id));
  expect('S1: vehicle.name is the resolved active vehicle model ("Hyundai Solaris")',
    v?.name === 'Hyundai Solaris', String(v?.name));
  expect('S1: vehicle.plate is the resolved active vehicle plate',
    v?.plate === 'А 482 МР 77', String(v?.plate));
  expect('S1: vehicle.color is the resolved active vehicle color',
    v?.color === 'белый', String(v?.color));
  expect('S1: vehicle.seats is 4 (legacy default)', v?.seats === 4);
  expect('S1: vehicle.features is "кондиционер" (legacy default)',
    v?.features === 'кондиционер', String(v?.features));
  // Cross-check: resolver returns the same vehicle the snapshot derives from.
  const active = resolveActiveGarageVehicle(u);
  expect('S1: resolver returns legacy-1 by default fallback',
    active?.id === 'legacy-1', String(active?.id));
  expect('S1: resolver vehicle.model === getUserVehicle vehicle.name',
    active?.model === v?.name);
}

// ── Scenario 2 — Persisted active id "demo-2" (multi-view-only) safely
// falls back to legacy in production. respond.js does not pass
// `?garage=multi`, so the resolver builds without the demo card, the
// saved id becomes stale, and the legacy vehicle re-becomes active.
// The driver-response snapshot therefore never carries the demo car. ────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  // Simulate the 05D make-active click that persists demo-2.
  const cur = user.get().driverGarage || {};
  user.set({ driverGarage: { ...cur, activeVehicleId: 'demo-2' } });
  const u = user.get();
  const v = getUserVehicle(u);
  expect('S2: getUserVehicle still returns the legacy car when demo-2 is stale (no preview gate)',
    v?.name === 'Hyundai Solaris', String(v?.name));
  expect('S2: getUserVehicle plate is legacy plate (demo-2 never leaks)',
    v?.plate === 'А 482 МР 77', String(v?.plate));
  expect('S2: stale demo-2 selection is PRESERVED (resolver is read-only)',
    user.get().driverGarage?.activeVehicleId === 'demo-2');
}

// ── Scenario 3 — Partially-onboarded driver (no model/plate) — null-bail
// path is preserved. /respond keeps using the demo vehicle fallback. ───────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  // intentionally no vehicleMake / vehicleModel / vehiclePlate
});
{
  expect('S3: getUserVehicle returns null when legacy fields are missing',
    getUserVehicle(user.get()) === null);
}

// ── Scenario 4 — Plate missing (legacy guard preserved) → null-bail. ───────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый',
  // intentionally no vehiclePlate
});
{
  expect('S4: getUserVehicle returns null when plate is missing (legacy guard)',
    getUserVehicle(user.get()) === null);
}

// ── Scenario 5 — buildAcceptedDriverSnapshot reads vehicle subfield via
// resolver. Driver identity (name, rating) is NOT changed. ──────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
  rating: 4.87,
});
{
  const snap = buildAcceptedDriverSnapshot(user.get());
  expect('S5: snapshot built', snap && typeof snap === 'object');
  // Driver identity from legacy profile fields (unchanged).
  expect('S5: snapshot.driver.name from displayName (legacy)',
    snap?.driver?.name === 'Иван Драйвер', String(snap?.driver?.name));
  expect('S5: snapshot.driver.rating formatted from legacy u.rating',
    typeof snap?.driver?.rating === 'string' && snap.driver.rating.includes('4'),
    String(snap?.driver?.rating));
  // Vehicle subfield from resolver.
  expect('S5: snapshot.vehicle.model from resolved active vehicle',
    snap?.vehicle?.model === 'Hyundai Solaris', String(snap?.vehicle?.model));
  expect('S5: snapshot.vehicle.color from resolved active vehicle',
    snap?.vehicle?.color === 'белый', String(snap?.vehicle?.color));
  // Plate is masked by the existing maskDriverPlate utility — middle
  // digits replaced with bullets ("•"). Model + plate prefix must survive.
  expect('S5: snapshot.vehicle.plate is masked (middle segment hidden)',
    /•/.test(snap?.vehicle?.plate || ''), String(snap?.vehicle?.plate));
  expect('S5: masked plate still starts with the original letter prefix "А"',
    (snap?.vehicle?.plate || '').startsWith('А'),
    String(snap?.vehicle?.plate));
}

// ── Scenario 6 — buildAcceptedDriverSnapshot under a stale persisted id
// behaves identically to scenario 5 (demo-2 falls back to legacy). ─────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const cur = user.get().driverGarage || {};
  user.set({ driverGarage: { ...cur, activeVehicleId: 'demo-2' } });
  const snap = buildAcceptedDriverSnapshot(user.get());
  expect('S6: stale demo-2 selection does NOT leak the demo car into the handoff snapshot',
    snap?.vehicle?.model === 'Hyundai Solaris', String(snap?.vehicle?.model));
  expect('S6: stale demo-2 selection does NOT leak demo plate into the handoff snapshot',
    !String(snap?.vehicle?.plate || '').includes('125'),
    String(snap?.vehicle?.plate));
}

// ── Scenario 7 — Empty profile → buildAcceptedDriverSnapshot returns null
// (existing null-bail preserved, so the demo-fallback path stays reachable). ─
reset();
user.set({ onboarded: true, role: 'driver' });
{
  expect('S7: buildAcceptedDriverSnapshot returns null when profile is empty',
    buildAcceptedDriverSnapshot(user.get()) === null);
}

// ── Scenario 8 — Neither call writes localStorage. The resolver is
// strictly read-only; calling either snapshot helper N times must leave
// every storage key byte-equal, including the user record itself. ─────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const before = snapshotLocalStorage();
  for (let i = 0; i < 5; i++) {
    getUserVehicle(user.get());
    buildAcceptedDriverSnapshot(user.get());
    resolveActiveGarageVehicle(user.get());
    buildGarageVehicles(user.get());
  }
  const after = snapshotLocalStorage();
  expect('S8: localStorage byte-equal after 5x driver-snapshot reads',
    before === after, `before=${before.length}b after=${after.length}b`);
  // Belt-and-braces: cross-surface keys never appear as a side effect of
  // a snapshot read.
  const afterByKey = snapshotByKey();
  for (const k of FORBIDDEN_KEYS) {
    expect(`S8: ${k} not written by snapshot reads`,
      !(k in afterByKey));
  }
}

// ── Scenario 9 — Static source guard: both call sites consume the resolver
// from `garage.js` and neither contains the storage-mutation or
// cross-surface-store literals. ───────────────────────────────────────────
{
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const respondSrc  = readFileSync(join(projectRoot, 'public/src/screens/respond.js'), 'utf8');
  const rideSrc     = readFileSync(join(projectRoot, 'public/src/ride_actions.js'), 'utf8');

  const sliceFn = (src, marker) => {
    const start = src.indexOf(marker);
    if (start < 0) return '';
    const closeIdx = src.indexOf('\n}\n', start);
    if (closeIdx < 0) return '';
    return src.slice(start, closeIdx + 3);
  };

  const getUserVehicleBody = sliceFn(respondSrc, 'export function getUserVehicle(');
  expect('S9: getUserVehicle body extracted',
    getUserVehicleBody.length > 0, String(getUserVehicleBody.length));

  const buildAcceptedSnapBody = sliceFn(rideSrc, 'export function buildAcceptedDriverSnapshot(');
  expect('S9: buildAcceptedDriverSnapshot body extracted',
    buildAcceptedSnapBody.length > 0, String(buildAcceptedSnapBody.length));

  // Positive: both must call the shared resolver.
  expect('S9: getUserVehicle calls resolveActiveGarageVehicle',
    /\bresolveActiveGarageVehicle\s*\(/.test(getUserVehicleBody));
  expect('S9: buildAcceptedDriverSnapshot calls resolveActiveGarageVehicle',
    /\bresolveActiveGarageVehicle\s*\(/.test(buildAcceptedSnapBody));

  // The imports must thread `resolveActiveGarageVehicle` from `garage.js`
  // (not from a UI module, not from state.js — the resolver lives in a
  // dedicated derive module).
  expect('S9: respond.js imports resolveActiveGarageVehicle from "../garage.js"',
    /import\s*\{[^}]*\bresolveActiveGarageVehicle\b[^}]*\}\s*from\s*['"]\.\.\/garage\.js['"]/.test(respondSrc));
  expect('S9: ride_actions.js imports resolveActiveGarageVehicle from "./garage.js"',
    /import\s*\{[^}]*\bresolveActiveGarageVehicle\b[^}]*\}\s*from\s*['"]\.\/garage\.js['"]/.test(rideSrc));

  // Forbidden: neither snapshot reader may write storage or trigger a
  // lifecycle transition.
  const FORBIDDEN_RUNTIME = [
    { name: 'user.set', regex: /\buser\.set\s*\(/ },
    { name: 'user.reset', regex: /\buser\.reset\s*\(/ },
    { name: 'localStorage.setItem', regex: /\blocalStorage\.setItem\s*\(/ },
    { name: 'sessionStorage.setItem', regex: /\bsessionStorage\.setItem\s*\(/ },
    { name: 'saveActiveRide', regex: /\bsaveActiveRide\s*\(/ },
    { name: 'updateActiveRideStatus', regex: /\bupdateActiveRideStatus\s*\(/ },
    { name: 'updateTripStatus', regex: /\bupdateTripStatus\s*\(/ },
    { name: 'saveRideHistoryEntry', regex: /\bsaveRideHistoryEntry\s*\(/ },
    { name: 'createRideOrder', regex: /\bcreateRideOrder\s*\(/ },
    { name: 'acceptCanonicalRideOrder', regex: /\bacceptCanonicalRideOrder\s*\(/ },
    { name: 'acceptNearbyOrder', regex: /\bacceptNearbyOrder\s*\(/ },
    { name: 'saveActiveVehicle', regex: /\bsaveActiveVehicle\s*\(/ },
    { name: 'activeVehicleId', regex: /\bactiveVehicleId\b/ },
    { name: 'driverGarage', regex: /\bdriverGarage\b/ },
    { name: '"bazardrive.responses.v1"', regex: /bazardrive\.responses\.v1/ },
    { name: '"bazardrive.active_ride.v1"', regex: /bazardrive\.active_ride\.v1/ },
    { name: '"bazardrive.ride_history.v1"', regex: /bazardrive\.ride_history\.v1/ },
    { name: '"bazardrive.driver_receipts.v1"', regex: /bazardrive\.driver_receipts\.v1/ },
    { name: '"bazardrive.respond.v1"', regex: /bazardrive\.respond\.v1/ },
  ];
  for (const { name, regex } of FORBIDDEN_RUNTIME) {
    expect(`S9: getUserVehicle does NOT call/reference ${name}`,
      !regex.test(getUserVehicleBody));
    expect(`S9: buildAcceptedDriverSnapshot does NOT call/reference ${name}`,
      !regex.test(buildAcceptedSnapBody));
  }
}

// ── Scenario 10 — BD-PROFILE-D-05F: persisted real-2 vehicle surfaces
// in /respond getUserVehicle. Legacy fields point at one car ("Hyundai
// Solaris"); the persisted collection contains a DIFFERENT car
// ("Toyota Prius"). With activeVehicleId='real-2', the response snapshot
// must reflect the persisted real-2, NOT the legacy fields. ───────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  // Legacy fields still set — but they are no longer the source of truth
  // once a persisted collection exists.
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
  driverGarage: {
    activeVehicleId: 'real-2',
    vehicles: [
      { id: 'real-2', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
    ],
  },
});
{
  const u = user.get();
  const v = getUserVehicle(u);
  expect('S10: getUserVehicle returns the persisted vehicle, not the legacy one',
    v?.name === 'Toyota Prius', String(v?.name));
  expect('S10: getUserVehicle plate is the persisted plate (legacy plate suppressed)',
    v?.plate === 'А 123 ВС 77', String(v?.plate));
  expect('S10: getUserVehicle color is the persisted color',
    v?.color === 'серебристый', String(v?.color));
  // Legacy car must NOT leak into the snapshot.
  expect('S10: getUserVehicle vehicle name is NOT the legacy "Hyundai Solaris"',
    v?.name !== 'Hyundai Solaris');
}

// ── Scenario 11 — BD-PROFILE-D-05F: persisted real-2 vehicle surfaces in
// ride_actions buildAcceptedDriverSnapshot. Same setup as S10 — the
// handoff snapshot must read the persisted real-2 vehicle, and the
// masked plate must be derived from the persisted plate. ──────────────────
{
  const snap = buildAcceptedDriverSnapshot(user.get());
  expect('S11: handoff snapshot.vehicle.model is the persisted "Toyota Prius"',
    snap?.vehicle?.model === 'Toyota Prius', String(snap?.vehicle?.model));
  expect('S11: handoff snapshot.vehicle.color is the persisted color',
    snap?.vehicle?.color === 'серебристый', String(snap?.vehicle?.color));
  // Plate must be masked + derived from the persisted plate ("А 123 ВС 77"),
  // not from the legacy plate ("А 482 МР 77"). The middle segment is
  // replaced with bullets, so the plate must NOT contain "123" anymore.
  expect('S11: handoff snapshot.vehicle.plate is masked',
    /•/.test(snap?.vehicle?.plate || ''), String(snap?.vehicle?.plate));
  expect('S11: masked plate prefix matches the PERSISTED plate (not the legacy one)',
    (snap?.vehicle?.plate || '').startsWith('А') &&
    !String(snap?.vehicle?.plate || '').includes('482'),
    String(snap?.vehicle?.plate));
}

// ── Scenario 12 — BD-PROFILE-D-05F: empty persisted collection falls back
// to the legacy-derived vehicle. The defaults shape includes
// `vehicles: []`, so this is the common-case path right now. The
// snapshot helpers must still return the legacy car so the existing
// production flow keeps working unchanged. ─────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const u = user.get();
  // Sanity: default driverGarage shape is what state.js normalises to.
  expect('S12: default driverGarage.vehicles is an empty array',
    Array.isArray(u.driverGarage?.vehicles) && u.driverGarage.vehicles.length === 0);
  expect('S12: getUserVehicle falls back to legacy when persisted collection is empty',
    getUserVehicle(u)?.name === 'Hyundai Solaris',
    String(getUserVehicle(u)?.name));
  expect('S12: handoff snapshot falls back to legacy when persisted collection is empty',
    buildAcceptedDriverSnapshot(u)?.vehicle?.model === 'Hyundai Solaris',
    String(buildAcceptedDriverSnapshot(u)?.vehicle?.model));
}

// ── Scenario 13 — BD-PROFILE-D-05F: snapshot reads do NOT mutate the
// persisted collection. Calling either consumer with a persisted real-2
// vehicle must leave `driverGarage.vehicles` byte-equal. The resolver
// promised "strictly read-only" — this scenario locks that contract
// against the new source. ─────────────────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
  driverGarage: {
    activeVehicleId: 'real-2',
    vehicles: [
      { id: 'real-2', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
    ],
  },
});
{
  const beforeRaw = JSON.stringify(user.get().driverGarage);
  for (let i = 0; i < 5; i++) {
    getUserVehicle(user.get());
    buildAcceptedDriverSnapshot(user.get());
    resolveActiveGarageVehicle(user.get());
    buildGarageVehicles(user.get());
  }
  const afterRaw = JSON.stringify(user.get().driverGarage);
  expect('S13: driverGarage byte-equal after 5x snapshot reads against the persisted collection',
    beforeRaw === afterRaw, `before=${beforeRaw.length}b after=${afterRaw.length}b`);
}

// ── Scenario 14 — BD-PROFILE-D-05F: stale `activeVehicleId` against the
// persisted collection falls back to the first persisted vehicle (NOT to
// the legacy car). The saved id stays intact so the previous selection
// re-activates when the matching vehicle reappears. ──────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
  driverGarage: {
    activeVehicleId: 'ghost-99',
    vehicles: [
      { id: 'real-2', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      { id: 'real-3', model: 'Skoda Octavia', color: 'чёрный',     plate: 'В 456 ВС 77', source: 'persisted' },
    ],
  },
});
{
  const u = user.get();
  const v = getUserVehicle(u);
  // Fallback: first valid persisted vehicle (real-2), NOT the legacy car.
  expect('S14: stale activeVehicleId falls back to the FIRST persisted vehicle',
    v?.name === 'Toyota Prius', String(v?.name));
  expect('S14: stale activeVehicleId does NOT fall back to the legacy car',
    v?.name !== 'Hyundai Solaris');
  expect('S14: stale activeVehicleId is PRESERVED (resolver is read-only)',
    user.get().driverGarage?.activeVehicleId === 'ghost-99');
}

// ── Result ───────────────────────────────────────────────────────────────────
if (issues.length) {
  console.error('\nSMOKE FAILED:');
  for (const i of issues) console.error('  - ' + i);
  process.exit(1);
}
console.log('\nAll driver-snapshot active-garage smoke checks passed.');
