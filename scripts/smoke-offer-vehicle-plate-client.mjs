// #1113 (client half): with the backend ON the driver's offer carries the car as separate fields
// (model / colour / the FULL plate — the server masks it for the passenger before selection); the
// live offer form says «Госномер пассажир увидит после выбора» and explains a refused plate
// (422 VEHICLE_PLATE_REQUIRED / VEHICLE_PLATE_INVALID); the passenger's offer card shows the server's
// masked plate; the active ride shows the server's car with the full plate (serverVehicle), a ride
// from before the slice keeps its car line. Backend OFF is unchanged. Runs the shipped sources in
// `vm` with their imports replaced; mock_api.js runs for real against a captured fetch.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { FakeElement, escapeHtml } from './lib/fake-dom.mjs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const respondSource = read('../public/src/screens/respond.js');
const responsesSource = read('../public/src/screens/responses.js');
const passengerSource = read('../public/src/screens/active_ride_passenger.js');
const failures = [];
let passed = 0;

async function check(label, run) {
  try {
    await run();
    passed += 1;
    console.log(`PASS — ${label}`);
  } catch (error) {
    failures.push(label);
    console.error(`FAIL — ${label}: ${error?.stack || error}`);
  }
}
async function flush() { for (let i = 0; i < 24; i += 1) await Promise.resolve(); }

function sourceFunction(source, name) {
  const start = new RegExp(`^( *)(?:export )?(?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(start, `runtime function ${name} must exist`);
  const ending = new RegExp(`^${start[1]}\\}\\s*$`, 'gm');
  ending.lastIndex = start.index + start[0].length;
  const end = ending.exec(source);
  assert.ok(end, `runtime function ${name} must have its own closing line`);
  return source.slice(start.index, end.index + end[0].length).replace(/^( *)export\s+/, '$1');
}

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
const requests = [];
const SERVER_HISTORY = [
  { tripId: 'trip_new', role: 'passenger', completedAt: '2026-10-22T16:57:00.000Z', counterparty: { name: 'Иван', rating: null },
    vehicle: { model: 'Kia Rio', color: 'Серый', plate: 'А 108 ОР 77' }, route: { pickupLabel: 'Новая от', dropoffLabel: 'Новая до' }, fare: '650 ₽' },
  { tripId: 'trip_old', role: 'passenger', completedAt: '2026-10-22T10:33:00.000Z', counterparty: { name: 'Иван', rating: null },
    vehicle: { model: null, color: null, plate: null }, route: { pickupLabel: 'Старая от', dropoffLabel: 'Старая до' }, fare: '763 ₽' },
];
globalThis.fetch = async (url, init = {}) => {
  requests.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : null });
  if (/\/history$/.test(String(url))) {
    return new Response(JSON.stringify({ items: SERVER_HISTORY }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ offer: { id: 'offer-1' } }), { status: 201, headers: { 'content-type': 'application/json' } });
};
const mockApi = await import('../public/src/mock_api.js');

// ── A. the request ────────────────────────────────────────────────────────────
await check('ON: the offer request carries the car fields (trimmed; an empty colour is left out)', async () => {
  globalThis.__BD_API_BASE__ = 'http://127.0.0.1:3000';
  requests.length = 0;
  await mockApi.submitOfferToBackend({
    orderId: 'order-x', driverName: 'Иван', car: 'Kia Rio', price: 763, message: '',
    vehicleModel: ' Kia Rio ', vehicleColor: '  ', vehiclePlate: ' А 108 ОР 77 ',
  });
  globalThis.__BD_API_BASE__ = '';
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/api\/v1\/matching\/offers$/);
  assert.deepEqual(requests[0].body, {
    orderId: 'order-x', driverName: 'Иван', car: 'Kia Rio', price: 763, message: '',
    vehicleModel: 'Kia Rio', vehiclePlate: 'А 108 ОР 77',
  });
});

// ── B. the live offer form ────────────────────────────────────────────────────
function respondHarness({ backend = true, submit } = {}) {
  const offers = [];
  const driver = { role: 'driver', firstName: 'Иван', vehicleMake: 'Kia', vehicleModel: 'Rio', vehiclePlate: 'А 108 ОР 77' };
  const context = vm.createContext({
    console, escapeHtml, localStorage: globalThis.localStorage,
    user: { get: () => driver },
    go: () => {},
    listFeedPosts: async () => [],
    submitOfferToBackend: async (offer) => { offers.push(offer); if (submit) return submit(offer); return { id: 'offer-1' }; },
    pollOfferOutcome: async () => ({ state: 'pending' }),
    isBackendEnabled: () => backend,
    roleGateCode: () => null, ROLE_GATE_TEXT: {}, PROFILE_CTA_LABEL: 'Перейти в профиль', DRIVER_ROLE_REQUIRED: 'DRIVER_ROLE_REQUIRED',
    loadResource: (fn) => fn(),
    resolveActiveGarageVehicle: () => ({ model: 'Kia Rio', color: 'Серый', plate: 'А 108 ОР 77' }),
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    window: { location: { hash: '#/respond' } },
    document: { body: { contains: () => true }, createElement: (tag) => new FakeElement(tag) },
  });
  const source = respondSource.replace(/^import[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+default\s+/m, '').replace(/^export\s+(?=(?:async\s+)?(?:function|const)\s)/gm, '');
  vm.runInContext(`${source}\nglobalThis.api = { renderPassengerRide };`, context, { filename: 'actual_respond.js' });
  return { api: context.api, offers };
}
function renderForm(h, post) {
  const root = new FakeElement('section');
  root._attached = true;
  h.api.renderPassengerRide(root, post);
  const $ = (sel) => root.querySelector(sel);
  return {
    root, $,
    async submit() {
      $('#respond-price').value = $('#respond-price').getAttribute('value') || '700';
      $('#respond-message').value = '';
      await $('#respond-form').fire('submit');
      await flush();
    },
  };
}
const livePost = (extra = {}) => ({
  id: 'order-x', orderId: 'order-x', canonical: 'ride_order', type: 'trip', passenger: true,
  author: 'Пассажир', from: 'Дом', to: 'Центр', when: 'Сейчас', price: '763 ₽', priceValue: 763, scheduledMode: 'now', ...extra,
});
const NOTE = 'Госномер пассажир увидит после выбора';

await check('ON live form: the plate note under the car; the offer sends model, colour and the full plate', async () => {
  const h = respondHarness();
  const f = renderForm(h, livePost());
  assert.equal(f.$('.respond__vehicle-plate-note')?.textContent.trim(), NOTE);
  await f.submit();
  assert.equal(h.offers.length, 1);
  const o = h.offers[0];
  assert.deepEqual([o.vehicleModel, o.vehicleColor, o.vehiclePlate], ['Kia Rio', 'Серый', 'А 108 ОР 77']);
  assert.doesNotMatch(o.vehiclePlate, /•/, 'the full plate, not the local masked snapshot');
});

await check('ON live form: a refused plate is explained, with the way to the profile', async () => {
  const cases = [
    ['VEHICLE_PLATE_REQUIRED', /Без госномера отклик не отправить\. Укажите номер авто в профиле водителя\./],
    ['VEHICLE_PLATE_INVALID', /Госномер слишком длинный\. Проверьте номер авто в профиле водителя\./],
  ];
  for (const [code, text] of cases) {
    const h = respondHarness({ submit: () => { throw Object.assign(new Error(code), { status: 422, code }); } });
    const f = renderForm(h, livePost());
    await f.submit();
    assert.match(f.$('#respond-error-text').textContent, text, code);
    assert.equal(f.$('#respond-error').hidden, false, `${code}: the error is shown`);
    assert.equal(f.$('#respond-error-profile').hidden, false, `${code}: «Перейти в профиль» is offered`);
  }
});

await check('OFF form: no plate note and no backend call', async () => {
  const h = respondHarness({ backend: false });
  const f = renderForm(h, livePost());
  assert.equal(f.$('.respond__vehicle-plate-note'), null);
  assert.doesNotMatch(f.root.innerHTML, new RegExp(NOTE));
  await f.submit();
  assert.equal(h.offers.length, 0);
});

// ── C. the passenger's offer card ─────────────────────────────────────────────
// No localStorage / sessionStorage / indexedDB in this context: any storage access while the
// passenger's board is built would throw. The stored-responses reader is a spy.
function cardsHarness() {
  const reads = [];
  const context = vm.createContext({
    console, escapeHtml,
    formatRub: (n) => `${n} ₽`,
    MOCK_REQUEST: { price: '— ₽' },
    loadResponsesForOrder: (id) => { reads.push(id); return []; },
    mapResponseToDriverCard: () => null,
    buildDrivers: () => [],
    // Every icon constant of the screen renders as an empty string here.
    ...Object.fromEntries([...responsesSource.matchAll(/^const ([A-Z][A-Z0-9_]*_SVG) =/gm)].map((m) => [m[1], ''])),
  });
  const renderers = ['renderEtaBars', 'renderDriverCard', 'renderOffer'].filter((name) => new RegExp(`^function ${name}\\(`, 'm').test(responsesSource));
  vm.runInContext(`${sourceFunction(responsesSource, 'buildDriversForOrder')}
    ${sourceFunction(responsesSource, 'mapServerOfferToDriverCard')}
    ${renderers.map((name) => sourceFunction(responsesSource, name)).join('\n')}
    globalThis.api = { buildDriversForOrder, ${renderers.join(', ')} };`, context, { filename: 'actual_responses.js' });
  context.api.reads = reads;
  return context.api;
}
const serverOffer = (extra = {}) => ({
  id: 'offer_order-x_d1', driverId: 'd1', status: 'sent', driverName: 'Иван', car: 'Kia Rio · Серый', price: 763,
  message: 'еду', expiresAt: new Date(Date.now() + 600000).toISOString(), ...extra,
});

await check('passenger card: the server car as fields and the server\'s masked plate', () => {
  const [card] = cardsHarness().buildDriversForOrder({ orderId: 'order-x' }, [serverOffer({
    vehicle: { model: 'Kia Rio', color: 'Серый', plate: 'А ••• ОР 77' },
  })], true);
  assert.deepEqual([card.car, card.carModel, card.carColor, card.plate], ['Kia Rio · Серый', 'Kia Rio', 'Серый', 'А ••• ОР 77']);
  // The visible line follows the server's fields, not a missing or stale display string (#1117 review).
  for (const car of [undefined, '', 'Lada Granta · Белый']) {
    const [c] = cardsHarness().buildDriversForOrder({ orderId: 'order-x' }, [serverOffer({
      car, vehicle: { model: 'Kia Rio', color: 'Серый', plate: 'А ••• ОР 77' },
    })], true);
    assert.equal(c.car, 'Kia Rio · Серый', `offer.car ${JSON.stringify(car)}`);
  }
  const [noColor] = cardsHarness().buildDriversForOrder({ orderId: 'order-x' }, [serverOffer({
    vehicle: { model: 'Kia Rio', color: null, plate: 'А ••• ОР 77' },
  })], true);
  assert.equal(noColor.car, 'Kia Rio', 'no dangling separator without a colour');
});

await check('before selection the full plate is nowhere on the passenger side: card object, card markup, storage', () => {
  const api = cardsHarness();
  const [card] = api.buildDriversForOrder({ orderId: 'order-x' }, [serverOffer({
    vehicle: { model: 'Kia Rio', color: 'Серый', plate: 'А ••• ОР 77' },
  })], true);
  assert.equal(api.reads.length, 0, 'the server board reads no stored responses');
  const json = JSON.stringify(card);
  assert.match(json, /А ••• ОР 77/, 'the mask is what the card carries');
  const html = api.renderDriverCard(card, null, false) + api.renderOffer(card);
  assert.match(html, /А ••• ОР 77/, 'the mask is what the card shows');
  for (const leak of ['108', 'А 108 ОР 77', 'А108ОР77']) {
    assert.ok(!json.includes(leak), `card object: ${leak}`);
    assert.ok(!html.includes(leak), `card markup: ${leak}`);
  }
});

await check('passenger card: an offer from before the slice keeps its car line and shows no plate', () => {
  const [card] = cardsHarness().buildDriversForOrder({ orderId: 'order-x' }, [serverOffer()], true);
  assert.deepEqual([card.carModel, card.carColor, card.plate], ['Kia Rio · Серый', '', '']);
});

await check('passenger card markup: the meta dot only between a plate and a trip count', () => {
  const dots = responsesSource.match(/\$\{driver\.plate && driver\.trips \? '<span class="responses__driver-dot" aria-hidden="true">·<\/span>' : ''\}/g) || [];
  assert.equal(dots.length, 2, 'both driver card renders');
  assert.doesNotMatch(responsesSource, /\n\s*<span class="responses__driver-dot" aria-hidden="true">·<\/span>\n\s*<span>\$\{escapeHtml\(driver\.trips\)\}/);
});

// ── D. the passenger's active ride ────────────────────────────────────────────
function rideHarness() {
  const context = vm.createContext({ console });
  vm.runInContext(`${sourceFunction(passengerSource, 'serverVehicle')}
    ${sourceFunction(passengerSource, 'carLine')}
    globalThis.api = { serverVehicle, carLine };`, context, { filename: 'actual_active_ride_passenger.js' });
  return context.api;
}

await check('active ride: the server car with the full plate; a ride from before the slice keeps its line', () => {
  const { serverVehicle, carLine } = rideHarness();
  const now = serverVehicle({ driver: { car: 'Kia Rio · Серый' }, vehicle: { model: 'Kia Rio', color: 'Серый', plate: 'А 108 ОР 77' } });
  assert.deepEqual({ ...now }, { model: 'Kia Rio', color: 'Серый', plate: 'А 108 ОР 77' });
  assert.equal(carLine({ authoritative: true, vehicle: now }), 'Kia Rio · Серый · А 108 ОР 77');
  const before = serverVehicle({ driver: { car: 'Kia Rio · Серый' } });
  assert.deepEqual({ ...before }, { model: 'Kia Rio · Серый', color: null, plate: null });
  assert.equal(carLine({ authoritative: true, vehicle: before }), 'Kia Rio · Серый');
  const blank = serverVehicle({ driver: { car: '' }, vehicle: { model: ' ', color: '', plate: '' } });
  assert.deepEqual({ ...blank }, { model: null, color: null, plate: null });
  assert.equal(carLine({ authoritative: true, vehicle: blank }), '', 'nothing invented on a confirmed ride');
});

await check('active ride: both server projections use serverVehicle; the local demo line is unchanged', () => {
  assert.match(passengerSource, /vehicle: serverVehicle\(srv\),/);
  assert.match(passengerSource, /vehicle: serverVehicle\(\{ vehicle: srv && srv\.vehicle, driver: serverDriver \}\),/);
  assert.doesNotMatch(passengerSource, /model: serverDriver\.car \|\| null,\s*color: null,\s*plate: null/);
  const { carLine } = rideHarness();
  assert.equal(carLine({ vehicle: {} }), 'Toyota Camry · А 124 ВВ 77', 'a local / demo ride keeps the OFF fallback');
});

// ── E. the passenger's profile history ────────────────────────────────────────
const profileSource = read('../public/src/screens/profile.js');
function historyHarness() {
  const context = vm.createContext({
    console, escapeHtml,
    formatHistoryFare: (fare) => (fare ? String(fare) : ''),
    formatHistoryDate: () => '', formatHistoryDistance: () => '', formatHistoryDuration: () => '',
    historyEntryTimestamp: () => null, historyRoleBadgeHtml: () => '', SVG_STAR: '',
  });
  vm.runInContext(`${['historyVehicleText', 'detailRowHtml', 'passengerHistoryEntryHtml', 'passengerDetailRowsHtml']
    .map((name) => sourceFunction(profileSource, name)).join('\n')}
    globalThis.api = { passengerHistoryEntryHtml, passengerDetailRowsHtml };`, context, { filename: 'actual_profile.js' });
  return context.api;
}

await check('profile history: the new ride shows the car with its plate; an old ride shows no car row and no placeholder', async () => {
  globalThis.__BD_API_BASE__ = 'http://127.0.0.1:3000';
  const entries = await mockApi.listHistoryFromBackend();
  globalThis.__BD_API_BASE__ = '';
  const fresh = entries.find((e) => e.tripId === 'trip_new');
  const old = entries.find((e) => e.tripId === 'trip_old');
  const { passengerHistoryEntryHtml, passengerDetailRowsHtml } = historyHarness();
  const text = (html) => { const el = new FakeElement('div'); el.innerHTML = html; return el.textContent.replace(/\s+/g, ' ').trim(); };
  for (const html of [passengerHistoryEntryHtml(fresh, 0), passengerDetailRowsHtml(fresh)]) {
    assert.match(text(html), /Автомобиль Kia Rio · Серый · А 108 ОР 77/);
  }
  for (const html of [passengerHistoryEntryHtml(old, 1), passengerDetailRowsHtml(old)]) {
    assert.doesNotMatch(text(html), /Автомобиль/, 'no car row for a ride without a car');
    assert.doesNotMatch(text(html), /не указан|нет данных/i, 'no placeholder');
  }
});

console.log(`\n${passed} passed; ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
