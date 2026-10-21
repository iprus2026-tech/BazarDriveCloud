// Slice 4c client (#1052, #1070 п.4): the driver sees the passenger exactly as the server knows them
// (the order comment as the note; no demo note, rating or luggage), and a passenger ride the server
// has not confirmed never shows the mock «1 540 ₽» with the backend ON. Runs the shipped functions
// in `vm` against controlled inputs; no browser, network or storage.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { escapeHtml } from './lib/fake-dom.mjs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const driverSource = read('../public/src/screens/active_ride.js');
const passengerSource = read('../public/src/screens/active_ride_passenger.js');
const { SIM_AUDIT_RIDE_OVERRIDES } = await import('../public/src/ride_state.js');
const failures = [];
let passed = 0;

function check(label, run) {
  try {
    run();
    passed += 1;
    console.log(`PASS — ${label}`);
  } catch (error) {
    failures.push(label);
    console.error(`FAIL — ${label}: ${error?.stack || error}`);
  }
}

function sourceFunction(source, name) {
  const start = new RegExp(`^( *)(?:export )?(?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(start, `runtime function ${name} must exist`);
  const ending = new RegExp(`^${start[1]}\\}\\s*$`, 'gm');
  ending.lastIndex = start.index + start[0].length;
  const end = ending.exec(source);
  assert.ok(end, `runtime function ${name} must have its own closing line`);
  const result = source.slice(start.index, end.index + end[0].length).replace(/^( *)export\s+/, '$1');
  new vm.Script(`${result}\n;void ${name};`);
  return result;
}

// ── Driver: mergeServerRide + passengerRowHtml ─────────────────────────────────
function driverHarness(localRide, stored = new Map()) {
  const context = vm.createContext({
    console, escapeHtml, arIcon: () => '', ride: localRide, pendingStatus: null,
    findActiveRide: (tripId) => (stored.has(tripId) ? structuredClone(stored.get(tripId)) : null),
    saveActiveRide: (value) => { stored.set(value.tripId, structuredClone(value)); return value; },
  });
  vm.runInContext([
    sourceFunction(driverSource, 'mergeServerWaiting'),
    sourceFunction(driverSource, 'mergeServerRide'),
    sourceFunction(driverSource, 'passengerRowHtml'),
    sourceFunction(driverSource, 'persistServerConfirmedWaitingProjection'),
    `globalThis.api = {
      merge: mergeServerRide, row: passengerRowHtml,
      adopt: (srv) => { ride = mergeServerRide(srv); persistServerConfirmedWaitingProjection(); return ride; },
    };`,
  ].join('\n'), context, { filename: 'actual_driver_passenger.js' });
  return context.api;
}

// The pre-read seed a selected driver's screen builds today (confirmed handoff + SIM_AUDIT).
const simSeed = () => ({
  tripId: 'trip_order-4c', status: 'DRIVER_EN_ROUTE',
  passenger: { ...SIM_AUDIT_RIDE_OVERRIDES.passenger },
  order: { ...SIM_AUDIT_RIDE_OVERRIDES.order },
  route: {}, timestamps: {}, waiting: {},
});
const serverRide = (comment) => ({
  tripId: 'trip_order-4c', status: 'DRIVER_EN_ROUTE',
  passenger: { name: 'Пётр Пассажиров', initials: 'П', rating: null, phoneMasked: null },
  driver: { name: 'Водитель', initials: null, rating: null, car: 'Kia Rio' },
  route: { pickupLabel: 'Дом', dropoffLabel: 'Центр', etaToPickup: null, etaToDestination: null },
  order: { offerPrice: '650 ₽', comment },
  cancel: { by: null, reason: null }, timestamps: {},
});

check('a server ride replaces the seed passenger: the order comment is the note; no demo note, rating or luggage', () => {
  const api = driverHarness(simSeed());
  const merged = api.merge(serverRide('E2E-1: основной цикл'));
  assert.deepEqual(JSON.parse(JSON.stringify(merged.passenger)), {
    name: 'Пётр Пассажиров', initials: 'П', rating: null, phoneMasked: null, note: 'E2E-1: основной цикл',
  });
  assert.equal(merged.order.tags, undefined, 'the demo order tags are gone');
  const html = api.row(merged.passenger);
  assert.match(html, /E2E-1: основной цикл/);
  assert.doesNotMatch(html, /★/, 'no rating, no star');
  assert.doesNotMatch(html, /чемодан|4,9|Позвоните, когда подъедете/);
});

check('a stored seed ride gets the server passenger too, so a later status write cannot bring the demo back', () => {
  const stored = new Map([['trip_order-4c', { ...simSeed(), localProvenance: 'sim_audit' }]]);
  const api = driverHarness(simSeed(), stored);
  api.adopt(serverRide('E2E-1: основной цикл'));
  const saved = stored.get('trip_order-4c');
  assert.deepEqual(saved.passenger, {
    name: 'Пётр Пассажиров', initials: 'П', rating: null, phoneMasked: null, note: 'E2E-1: основной цикл',
  });
  assert.equal(saved.localProvenance, undefined);
  assert.doesNotMatch(api.row(saved.passenger), /чемодан|★/);
});

check('no order comment: no note at all', () => {
  const api = driverHarness(simSeed());
  for (const comment of [null, undefined]) {
    const merged = api.merge(serverRide(comment));
    assert.equal(merged.passenger.note, null);
    assert.doesNotMatch(api.row(merged.passenger), /active-ride__passenger-note/);
  }
});

check('a real rating from the server is shown with its star', () => {
  const api = driverHarness(simSeed());
  const srv = serverRide(null);
  srv.passenger.rating = '4,7';
  assert.match(api.row(api.merge(srv).passenger), /★ 4,7/);
});

check('backend OFF / a local ride keeps its own passenger row (demo unchanged)', () => {
  const api = driverHarness(simSeed());
  const html = api.row(SIM_AUDIT_RIDE_OVERRIDES.passenger);
  assert.match(html, /★ 4,9/);
  assert.match(html, /маленький чемодан/);
  assert.match(html, /Я с маленьким чемоданом/);
});

// ── Passenger: arrivingDropoffAmount fallback (#1070 п.4) ─────────────────────
function fareHarness(backendOn) {
  const context = vm.createContext({ console, isBackendEnabled: () => backendOn });
  vm.runInContext(`${sourceFunction(passengerSource, 'arrivingDropoffAmount')}\nglobalThis.fare = arrivingDropoffAmount;`, context,
    { filename: 'actual_arriving_dropoff_amount.js' });
  return context.fare;
}

check('backend ON: an unconfirmed ride shows «—», never a seeded or mock price', () => {
  const fare = fareHarness(true);
  assert.equal(fare({ order: {} }), '—');
  assert.equal(fare({}), '—');
  // The demo ride's own seeded price and any local value are not server-confirmed (#1104 review).
  assert.equal(fare({ ride: { price: '1 540 ₽' }, order: { offerPrice: '750 ₽' } }), '—');
  assert.equal(fare({ payment: { dropoffAmount: '990 ₽' } }), '—');
  assert.equal(fare({ authoritative: true, order: { offerPrice: '650 ₽' } }), '650 ₽', 'the server price stays');
  assert.equal(fare({ authoritative: true, order: {} }), '—');
});

check('backend OFF: the mock 1 540 ₽ fallback and the priority chain are unchanged', () => {
  const fare = fareHarness(false);
  assert.equal(fare({ order: {} }), '1 540 ₽');
  assert.equal(fare({ payment: { dropoffAmount: '990 ₽' }, order: { offerPrice: '750 ₽' } }), '990 ₽');
  assert.equal(fare({ order: { offerPrice: '750 ₽' } }), '750 ₽');
});

console.log(`\n${passed} passed; ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
