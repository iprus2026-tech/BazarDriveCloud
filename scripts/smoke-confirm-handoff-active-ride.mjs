// BD-CONFIRM-01 — confirm/chat → active-ride handoff guard.
//
// The /trip-confirmation screen writes a CONFIRMED handoff record keyed by
// tripId, and /active-ride reads it back via the canonical loader to seed a
// new active ride. The handoff carries no real backend state — both sides
// agree on a frozen MOCK_PASSENGER / MOCK_DRIVER / MOCK_VEHICLE / MOCK_ROUTE
// identity defined inside trip_confirmation_handoff.js — so a refactor that
// drifts the seed shape, breaks the role gating, or reintroduces a stale
// demo string would silently mismatch what /trip-confirmation rendered.
//
// This smoke combines a small BEHAVIOURAL round-trip (write a confirmed
// handoff, load it back, drive both role views off the same record) with a
// STATIC contract pin (active_ride.js still gates by role, the handoff
// module's exported surface stays intact, no inline demo strings leak
// outside the canonical MOCK_* literals).

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

// ── C. Behavioural: confirmed handoff round-trip (same-role) ─────────
resetStorage();
const tripA = 'trip_confirm_smoke_a';
setConfirmedHandoff(tripA, 'passenger');

const ridePassenger = handoff.loadCanonicalActiveRide({ tripId: tripA, role: 'passenger' });
expect('loadCanonicalActiveRide(role=passenger) materializes a ride from a passenger handoff',
  !!ridePassenger && ridePassenger.tripId === tripA);
expect('seeded ride.role mirrors the requested role',
  ridePassenger?.role === 'passenger');
expect('seeded ride.status starts at DRIVER_EN_ROUTE',
  ridePassenger?.status === rideState.RIDE_STATUS.DRIVER_EN_ROUTE);
expect('seeded driver identity comes from MOCK_DRIVER',
  ridePassenger?.driver?.name === handoff.MOCK_DRIVER.name
  && ridePassenger?.driver?.initials === handoff.MOCK_DRIVER.initials
  && ridePassenger?.driver?.rating === handoff.MOCK_DRIVER.rating);
expect('seeded passenger identity comes from MOCK_PASSENGER',
  ridePassenger?.passenger?.name === handoff.MOCK_PASSENGER.name
  && ridePassenger?.passenger?.initials === handoff.MOCK_PASSENGER.initials);
expect('seeded vehicle identity comes from MOCK_VEHICLE',
  ridePassenger?.vehicle?.model === handoff.MOCK_VEHICLE.model
  && ridePassenger?.vehicle?.plate === handoff.MOCK_VEHICLE.plate);
expect('seeded ride records the seededFrom marker',
  ridePassenger?.seededFrom === 'trip_confirmation_handoff');
expect('seeded ride carries the handoff descriptor (state + role)',
  ridePassenger?.handoff?.state === 'CONFIRMED'
  && ridePassenger?.handoff?.role === 'passenger');

// Second load is idempotent — the canonical record is read from
// bazardrive.active_ride.v1 instead of being re-seeded.
const rideAgain = handoff.loadCanonicalActiveRide({ tripId: tripA, role: 'passenger' });
expect('second loadCanonicalActiveRide returns the existing persisted ride',
  rideAgain?.tripId === tripA
  && rideAgain?.timestamps?.createdAt === ridePassenger.timestamps.createdAt);

// ── D. Cross-role: a passenger handoff seeds the driver view too ──────
// Per BD-RIDE-D-10: both /active-ride?role=driver and ?role=passenger
// should converge on the same canonical record because the visible
// identity comes from the same MOCK_* literals.
resetStorage();
const tripB = 'trip_confirm_smoke_b';
setConfirmedHandoff(tripB, 'passenger');
const rideDriverFromPaxHandoff = handoff.loadCanonicalActiveRide({ tripId: tripB, role: 'driver' });
expect('driver view materializes from a passenger-side handoff (cross-role)',
  !!rideDriverFromPaxHandoff && rideDriverFromPaxHandoff.tripId === tripB);
expect('cross-role seed keeps MOCK_DRIVER identity intact for the driver view',
  rideDriverFromPaxHandoff?.driver?.name === handoff.MOCK_DRIVER.name);
expect('cross-role seed keeps MOCK_PASSENGER identity intact for the driver view',
  rideDriverFromPaxHandoff?.passenger?.name === handoff.MOCK_PASSENGER.name);
// After the cross-role seed persists, the passenger view reads the same
// canonical record — no double-seeding, no identity flip.
const ridePaxAfterCross = handoff.loadCanonicalActiveRide({ tripId: tripB, role: 'passenger' });
expect('passenger view converges on the cross-role seeded record',
  ridePaxAfterCross?.tripId === tripB
  && ridePaxAfterCross?.passenger?.name === handoff.MOCK_PASSENGER.name
  && ridePaxAfterCross?.driver?.name === handoff.MOCK_DRIVER.name);

// ── E. Reject paths: missing, expired, wrong state, role mismatch ────
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

resetStorage();
setConfirmedHandoff(tripC, 'driver');
expect('loadConfirmedHandoff rejects an explicit role mismatch',
  handoff.loadConfirmedHandoff(tripC, 'passenger') === null);
// loadCanonicalActiveRide must still resolve via the cross-role fallback
// (passenger requests a tripId only known as a driver handoff).
const crossFromDriver = handoff.loadCanonicalActiveRide({ tripId: tripC, role: 'passenger' });
expect('loadCanonicalActiveRide cross-role seeds when the other side\'s handoff exists',
  !!crossFromDriver && crossFromDriver.tripId === tripC);

// ── F. Demo-fallback leak guard (active_ride.js / driver_handoff_snapshot.js) ─
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

// ── G. Service worker precaches the handoff modules ──────────────────
// /active-ride statically imports both handoff modules — if the SW
// PRECACHE forgets either, an offline PWA session can't seed a fresh
// active ride from a /trip-confirmation handoff.
const sw = read('../public/sw.js');
expect('public/sw.js PRECACHE includes trip_confirmation_handoff.js',
  /trip_confirmation_handoff\.js/.test(sw));
expect('public/sw.js PRECACHE includes driver_handoff_snapshot.js',
  /driver_handoff_snapshot\.js/.test(sw));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
