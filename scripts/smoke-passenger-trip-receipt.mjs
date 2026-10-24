// #1115 — the passenger's «Квитанция о поездке» (/receipt?tripId=…&role=passenger). Not a cash receipt
// (no fiscal details; the app takes no payment): the passenger's own completed ride — fare, route,
// driver, car — from the passenger's history entry (GET /history ON, the local history OFF), never
// the driver's financial receipt. The passenger screen never uses «чек» as a title and never shows
// the driver's commission / net / balance / payouts. The profile's ride details open it. Runs the
// shipped trip_receipt.js and profile.js sources in `vm`; mock_api.js runs for real.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { FakeElement, escapeHtml } from './lib/fake-dom.mjs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const receiptSource = read('../public/src/screens/trip_receipt.js');
const profileSource = read('../public/src/screens/profile.js');
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

const LEGAL = 'Не является кассовым чеком. Оплата производится напрямую водителю.';
const DRIVER_MONEY = /Комиссия|Чаевые|Ваш доход|Итого к зачислению|Итого наличными|зачисл|баланс|Открыть выплаты|К выплатам|Безналичный расчёт|Оплата наличными/i;

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
let historyItems = [];
let fetches = 0;
globalThis.fetch = async (url) => {
  fetches += 1;
  if (/\/history$/.test(String(url))) {
    return new Response(JSON.stringify({ items: historyItems }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
};
const mockApi = await import('../public/src/mock_api.js');

const TRIP = 'trip_order-dbe0bf07-9bf9-43e3-b0e6-feb8f77e9d8e';
const serverRow = (role, extra = {}) => ({
  tripId: TRIP, role, completedAt: '2026-10-22T10:33:15.000Z',
  counterparty: { name: role === 'passenger' ? 'Иван' : 'Анна', rating: null },
  vehicle: { model: 'Kia Rio', color: 'Серый', plate: 'А 108 ОР 77' },
  route: { pickupLabel: 'Лесная, 7', dropoffLabel: 'Озеро Сенеж' }, fare: '763 ₽',
  ...(role === 'driver' ? { receipt: { fare: 763, net: 671, commission: -92, tip: 0, paymentMode: 'noncash' } } : {}),
  ...extra,
});

// ── A. the read-only reader ───────────────────────────────────────────────────
await check('getPassengerTripResolved ON: the passenger row of the trip from GET /history, never local', async () => {
  storage.set('bazardrive.ride_history.v1', JSON.stringify([{ role: 'passenger', tripId: TRIP, fare: '1 ₽ (local)' }]));
  historyItems = [serverRow('driver'), serverRow('passenger'), serverRow('passenger', { tripId: 'trip_other' })];
  globalThis.__BD_API_BASE__ = 'http://127.0.0.1:3000';
  const trip = await mockApi.getPassengerTripResolved(TRIP);
  const none = await mockApi.getPassengerTripResolved('trip_missing');
  const blank = await mockApi.getPassengerTripResolved('  ');
  globalThis.__BD_API_BASE__ = '';
  assert.equal(trip.role, 'passenger');
  assert.equal(trip.fare, '763 ₽', 'the server row, not the local one');
  assert.equal(trip.driver.name, 'Иван');
  assert.equal(trip.vehicle.plate, 'А 108 ОР 77');
  assert.equal(trip.receipt, undefined, 'a passenger row carries no driver money');
  assert.equal(none, null);
  assert.equal(blank, null);
});

await check('getPassengerTripResolved OFF: the local passenger history, no network', async () => {
  storage.set('bazardrive.ride_history.v1', JSON.stringify([
    { role: 'driver', tripId: TRIP, fare: '9 ₽' },
    { role: 'passenger', tripId: TRIP, fare: '650 ₽', route: { pickupLabel: 'А', dropoffLabel: 'Б' } },
  ]));
  const before = fetches;
  const trip = await mockApi.getPassengerTripResolved(TRIP);
  assert.equal(fetches, before, 'no fetch with the backend OFF');
  assert.deepEqual([trip.role, trip.fare], ['passenger', '650 ₽']);
});

// ── B. the screen ─────────────────────────────────────────────────────────────
class Dom extends FakeElement {
  appendChild(child) { return super.appendChild(child); }
}
function receiptHarness({ hash, trip = null, backend = true }) {
  const calls = { passenger: [], driver: [] };
  const navigation = [];
  const timers = [];
  const context = vm.createContext({
    console, escapeHtml, Element: FakeElement, URLSearchParams,
    window: { location: { hash } },
    document: { createElement: (tag) => new Dom(tag) },
    go: (path) => navigation.push(path),
    getReceipt: (id) => { calls.driver.push(['getReceipt', id]); return null; },
    getReceiptResolved: async (id) => { calls.driver.push(['getReceiptResolved', id]); return null; },
    getPassengerTripResolved: async (id) => { calls.passenger.push(id); return trip; },
    loadResource: async (fn, opts = {}) => { try { return await fn(); } catch { return opts.fallback ?? null; } },
    isBackendEnabled: () => backend,
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
  });
  const source = receiptSource.replace(/^import[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+default\s+/m, '').replace(/^export\s+(?=(?:async\s+)?(?:function|const)\s)/gm, '');
  vm.runInContext(`${source}\nglobalThis.api = { tripReceipt };`, context, { filename: 'actual_trip_receipt.js' });
  return {
    calls, navigation,
    async mount() {
      const root = context.api.tripReceipt();
      root._attached = true;
      while (timers.length) await timers.shift()();
      await flush();
      return root;
    },
  };
}
const textOf = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const passengerTrip = () => ({
  role: 'passenger', tripId: TRIP, completedAt: '2026-10-22T10:33:15.000Z', fare: '763 ₽',
  route: { pickupLabel: 'Лесная, 7', dropoffLabel: 'Озеро Сенеж' },
  driver: { name: 'Иван' }, vehicle: { model: 'Kia Rio', color: 'Серый', plate: 'А 108 ОР 77' },
});
function assertNoReceiptWordInTitles(root) {
  const titles = [
    ...root.querySelectorAll('.trip-receipt__doc-kicker'), ...root.querySelectorAll('.trip-receipt__hero-label'),
    ...root.querySelectorAll('.trip-receipt__missing-title'), ...root.querySelectorAll('dt'), ...root.querySelectorAll('button'),
  ].map(textOf);
  for (const title of titles) assert.doesNotMatch(title, /чек/i, `title «${title}»`);
  const withoutLegal = textOf(root).replace(LEGAL, '');
  assert.doesNotMatch(withoutLegal, /чек/i, 'the word appears only in the «не является кассовым чеком» line');
  assert.doesNotMatch(textOf(root), DRIVER_MONEY, 'no driver money / payouts');
}

await check('passenger screen: «Квитанция о поездке» with the fare, route, driver, car and the legal line', async () => {
  const h = receiptHarness({ hash: `#/receipt?tripId=${TRIP}&role=passenger`, trip: passengerTrip() });
  const root = await h.mount();
  assert.equal(textOf(root.querySelector('.trip-receipt__doc-kicker')), 'Квитанция о поездке');
  const doc = root.querySelector('.trip-receipt__doc--passenger');
  assert.ok(doc, 'the passenger document');
  const text = textOf(doc);
  assert.match(text, /Стоимость поездки\s*763 ₽/);
  assert.match(text, /Поездка № 7e9d8e/);
  for (const [label, value] of [['Откуда', 'Лесная, 7'], ['Куда', 'Озеро Сенеж'], ['Водитель', 'Иван'], ['Автомобиль', 'Kia Rio · Серый · А 108 ОР 77']]) {
    assert.match(text, new RegExp(`${label}\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), label);
  }
  assert.equal(textOf(root.querySelector('.trip-receipt__legal')), LEGAL);
  assertNoReceiptWordInTitles(root);
  assert.deepEqual(h.calls.driver, [], 'the driver receipt is never read for the passenger');
  assert.deepEqual([...h.calls.passenger], [TRIP]);
});

await check('passenger screen: «В историю поездок» and «Назад» lead to the ride history', async () => {
  const h = receiptHarness({ hash: `#/receipt?tripId=${TRIP}&role=passenger`, trip: passengerTrip() });
  const root = await h.mount();
  await root.querySelector('[data-receipt-action="history"]').fire('click');
  await root.querySelector('[data-receipt-action="back"]').fire('click');
  assert.deepEqual([...h.navigation], ['/profile?section=history', '/profile?section=history']);
});

await check('passenger screen without the ride: an honest «Квитанция пока недоступна», no driver actions', async () => {
  const h = receiptHarness({ hash: `#/receipt?tripId=${TRIP}&role=passenger`, trip: null });
  const root = await h.mount();
  assert.equal(textOf(root.querySelector('.trip-receipt__missing-title')), 'Квитанция пока недоступна');
  assert.ok(!root.querySelector('[data-receipt-action="payouts"]'), 'no «Открыть выплаты»');
  assertNoReceiptWordInTitles(root);
});

await check('driver screen (no role) is unchanged: «Чек поездки» from the driver receipt reader', async () => {
  const h = receiptHarness({ hash: `#/receipt?tripId=${TRIP}`, trip: passengerTrip() });
  const root = await h.mount();
  assert.equal(textOf(root.querySelector('.trip-receipt__doc-kicker')), 'Чек поездки');
  assert.deepEqual(h.calls.passenger, [], 'the passenger reader is not used for the driver');
  assert.ok(h.calls.driver.some(([name]) => name === 'getReceiptResolved'));
});

// ── C. the profile's ride details ─────────────────────────────────────────────
function detailHarness() {
  const context = vm.createContext({
    console, escapeHtml,
    buildRepeatRouteDraft: () => null, historyRoleBadgeHtml: () => '', driverDetailRowsHtml: () => '',
    formatHistoryFare: (fare) => (fare ? String(fare) : ''), formatHistoryDate: () => '', formatHistoryDistance: () => '',
    formatHistoryDuration: () => '', historyEntryTimestamp: () => null, SVG_STAR: '',
  });
  vm.runInContext(`${['historyVehicleText', 'detailRowHtml', 'passengerDetailRowsHtml', 'historyDetailHtml']
    .map((name) => sourceFunction(profileSource, name)).join('\n')}
    globalThis.api = { historyDetailHtml };`, context, { filename: 'actual_profile.js' });
  return context.api;
}

await check('profile ride details: «Детали поездки» with a «Квитанция о поездке» button that opens it', () => {
  const { historyDetailHtml } = detailHarness();
  const el = new FakeElement('div');
  el.innerHTML = historyDetailHtml(passengerTrip());
  assert.equal(textOf(el.querySelector('.profile-history-detail__title')), 'Детали поездки');
  const button = el.querySelector('[data-detail-action="receipt"]');
  assert.equal(textOf(button), 'Квитанция о поездке');
  assert.doesNotMatch(textOf(el), /чек/i, 'no «чек» on the passenger ride details');
  const noTrip = new FakeElement('div');
  noTrip.innerHTML = historyDetailHtml({ ...passengerTrip(), tripId: '' });
  assert.equal(noTrip.querySelector('[data-detail-action="receipt"]'), null, 'no button without a trip id');
  assert.match(profileSource, /action === 'receipt'\) go\(`\/receipt\?tripId=\$\{encodeURIComponent\(entry\.tripId\)\}&role=passenger`\)/);
});

delete globalThis.__BD_API_BASE__;
console.log(`\n${passed} passed; ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
