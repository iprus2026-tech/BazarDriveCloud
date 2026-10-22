// Slice 4a (#1070 items 1–3, #1061 shift stats): with the backend ON the driver's money surfaces show
// server data or an honest empty state; backend OFF keeps its demo values.
//   - «сегодня» is the DEVICE's local calendar day (a ride at 00:10 local belongs to today even when
//     the server's UTC date is still yesterday);
//   - the shift stats come from the server history; no balance, shift time or own rating source;
//   - the payouts list is the server's receipts plus the pending local ones, never the demo 48-321;
//   - the receipt preview never borrows the demo receipt.
// Runs the shipped functions in `vm` or through the real module with a fake transport and storage.

// The local day under test is Helsinki's; set before any Date is created.
process.env.TZ = 'Europe/Helsinki';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { FakeElement, escapeHtml } from './lib/fake-dom.mjs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const driverSource = read('../public/src/screens/active_ride.js');
const sheetsSource = read('../public/src/screens/active_ride_driver_sheets.js');
const profileSource = read('../public/src/screens/profile.js');
const receiptSource = read('../public/src/screens/trip_receipt.js');
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
  const result = source.slice(start.index, end.index + end[0].length).replace(/^( *)export\s+/, '$1');
  new vm.Script(`${result}\n;void ${name};`);
  return result;
}

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
const mockApi = await import('../public/src/mock_api.js');
const RECEIPTS_KEY = 'bazardrive.driver_receipts.v1';

// ── A. «сегодня» = the device's local day ─────────────────────────────────────
await check('the local day decides: 00:10 local counts today though its UTC date is yesterday', () => {
  assert.equal(new Date('2026-10-21T21:30:00Z').getHours(), 0, 'TZ under test is UTC+3 here');
  const now = new Date('2026-10-21T21:30:00Z'); // 2026-10-22 00:30 in Helsinki
  const entries = [
    { role: 'driver', tripId: 'after-midnight', completedAt: '2026-10-21T21:10:00Z', receipt: { net: 700 } }, // 00:10 local, today
    { role: 'driver', tripId: 'before-midnight', completedAt: '2026-10-21T20:50:00Z', receipt: { net: 500 } }, // 23:50 local, yesterday
  ];
  const today = mockApi.summarizeDriverToday(entries, now);
  assert.deepEqual([today.trips, today.earnings, today.tripIds], [1, 700, ['after-midnight']],
    'a UTC-day count would take both rides (both are 2026-10-21 in UTC)');
});

await check('the same rides seen at 23:59 local the evening before', () => {
  const now = new Date('2026-10-21T20:59:00Z'); // 2026-10-21 23:59 local
  const entries = [
    { role: 'driver', tripId: 'evening', completedAt: '2026-10-21T20:50:00Z', receipt: { net: 500 } },
    { role: 'driver', tripId: 'next-day', completedAt: '2026-10-21T21:10:00Z', receipt: { net: 700 } },
  ];
  assert.deepEqual(mockApi.summarizeDriverToday(entries, now).tripIds, ['evening']);
});

await check('only the driver\'s own completed rows count; a trip without a receipt adds no money', () => {
  const now = new Date('2026-10-22T09:00:00Z');
  const entries = [
    { role: 'driver', tripId: 'a', completedAt: '2026-10-22T07:00:00Z', receipt: { net: 1200 } },
    { role: 'driver', tripId: 'b', completedAt: '2026-10-22T08:00:00Z', receipt: null },
    { role: 'passenger', tripId: 'c', completedAt: '2026-10-22T08:30:00Z', receipt: { net: 999 } },
    { role: 'driver', tripId: 'd', completedAt: 'not a date', receipt: { net: 5 } },
    { role: 'driver', tripId: 'e', completedAt: null, receipt: { net: 5 } },
    null,
  ];
  assert.deepEqual(mockApi.summarizeDriverToday(entries, now), { trips: 2, earnings: 1200, tripIds: ['a', 'b'] });
  assert.deepEqual(mockApi.summarizeDriverToday(null, now), { trips: 0, earnings: 0, tripIds: [] });
});

// ── B. seams: loadDriverTodayStats / listDriverReceiptsResolved ───────────────
const historyItems = [
  { tripId: 'trip_order-a', role: 'driver', completedAt: '2026-10-22T07:00:00.000Z', counterparty: {}, vehicle: {}, route: {},
    receipt: { fare: 900, net: 792, commission: -108, tip: 0, paymentMode: 'cash' } },
  { tripId: 'trip_order-b', role: 'driver', completedAt: '2026-10-21T07:00:00.000Z', counterparty: {}, vehicle: {}, route: {}, receipt: null },
  { tripId: 'trip_order-p', role: 'passenger', completedAt: '2026-10-22T06:00:00.000Z', counterparty: {}, vehicle: {}, route: {} },
];
function backendOn(items = historyItems) {
  globalThis.__BD_API_BASE__ = 'https://api.fixture.invalid';
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/api\/v1\/history$/);
    return { ok: true, status: 200, text: async () => JSON.stringify({ items }) };
  };
}
function backendOff() {
  delete globalThis.__BD_API_BASE__;
  globalThis.fetch = () => { throw new Error('no request while OFF'); };
}

await check('loadDriverTodayStats: ON reads the server history; OFF makes no request', async () => {
  backendOn();
  const today = await mockApi.loadDriverTodayStats({ now: new Date('2026-10-22T09:00:00Z') });
  assert.deepEqual(today, { trips: 1, earnings: 792, tripIds: ['trip_order-a'] });
  backendOff();
  assert.equal(await mockApi.loadDriverTodayStats(), null);
});

await check('payouts ON: server receipts + a pending local one, server wins by trip, never the demo', async () => {
  storage.clear();
  storage.set(RECEIPTS_KEY, JSON.stringify([
    { tripId: 'trip_order-a', completedAt: '2026-10-22T07:00:00.000Z', fare: 1, commission: 0, tip: 0, net: 1, paymentMode: 'cash' },
    { tripId: 'trip_order-pending', completedAt: '2026-10-22T08:00:00.000Z', fare: 650, commission: -78, tip: 0, net: 572, paymentMode: 'noncash' },
  ]));
  backendOn();
  const list = await mockApi.listDriverReceiptsResolved();
  assert.deepEqual(list.map((r) => [r.tripId, r.net]), [['trip_order-pending', 572], ['trip_order-a', 792]]);
  assert.ok(!list.some((r) => r.tripId === mockApi.DEMO_DRIVER_RECEIPT.tripId));
  backendOff();
  const offList = await mockApi.listDriverReceiptsResolved();
  assert.ok(offList.some((r) => r.tripId === mockApi.DEMO_DRIVER_RECEIPT.tripId), 'OFF keeps the demo seed');
});

await check('payouts ON: a failed history read rejects (the pane reports it), it does not fall back to the demo', async () => {
  globalThis.__BD_API_BASE__ = 'https://api.fixture.invalid';
  globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => JSON.stringify({ code: 'DOWN' }) });
  await assert.rejects(() => mockApi.listDriverReceiptsResolved());
  backendOff();
});

// ── C. driver screen: stats, overrides, merge ────────────────────────────────
function driverHarness({ backendRead = true, backendRide = false, ride, load } = {}) {
  const root = new FakeElement('section');
  root._attached = true;
  root.innerHTML = '<div class="active-ride__stats"><div data-driver-stat="today">x</div><div data-driver-stat="trips">x</div><div>★ <span data-driver-stat="rating">x</span></div></div>'
    + '<div class="de-statgrid"><div class="de-stat__val" data-driver-stat="today">x</div></div>';
  const calls = { loads: 0 };
  const context = vm.createContext({
    console, root, backendRead, backendRide, driverFixtureMode: false, pendingStatus: null,
    ride: ride || {
      tripId: 't', ride: { todayEarnings: '4 720 ₽', tripsToday: 7, rating: '4,92' },
      driver: { name: 'Рустам К.', rating: '4,92', shiftDuration: '5ч 12м', onlineLabel: 'На линии' },
      passenger: { initials: 'АМ' }, timestamps: {}, waiting: {},
    },
    driverToday: null, driverTodayRunId: 0, usable: true,
    currentViewIsUsable: () => context.usable,
    loadDriverTodayStats: () => { calls.loads += 1; return load ? load() : Promise.resolve(null); },
  });
  vm.runInContext([
    sourceFunction(driverSource, 'formatRub'),
    sourceFunction(driverSource, 'mergeServerWaiting'),
    sourceFunction(driverSource, 'mergeServerRide'),
    sourceFunction(driverSource, 'driverStatsView'),
    sourceFunction(driverSource, 'applyDriverTodayStats'),
    sourceFunction(driverSource, 'refreshDriverToday'),
    sourceFunction(driverSource, 'driverEarningsOverrides'),
    `globalThis.api = { view: driverStatsView, refresh: refreshDriverToday, overrides: driverEarningsOverrides,
      merge: mergeServerRide, setRide: (r) => { ride = r; }, setBackendRide: (v) => { backendRide = v; } };`,
  ].join('\n'), context, { filename: 'actual_driver_money.js' });
  // formatRub groups thousands with a no-break space; compare with plain spaces.
  const text = (key) => root.querySelectorAll(`[data-driver-stat="${key}"]`).map((el) => el.textContent.replace(/\s/g, ' '));
  return { api: context.api, context, root, text, calls };
}

await check('backend OFF: the demo shift stats are unchanged', () => {
  const h = driverHarness({ backendRead: false });
  assert.deepEqual(JSON.parse(JSON.stringify(h.api.view())), { today: '4 720 ₽', trips: '7', rating: '4,92' });
});

await check('backend ON: «—» until the server history arrives, then its numbers in every stat cell', async () => {
  let resolve;
  const h = driverHarness({ load: () => new Promise((yes) => { resolve = yes; }) });
  assert.deepEqual(JSON.parse(JSON.stringify(h.api.view())), { today: '—', trips: '—', rating: '—' },
    'the seed\'s demo 4 720 ₽ / 7 / 4,92 never show');
  h.api.refresh();
  resolve({ trips: 3, earnings: 2376, tripIds: ['a', 'b', 'c'] });
  await flush();
  assert.deepEqual(h.text('today'), ['2 376 ₽', '2 376 ₽'], 'top bar and the open earnings sheet');
  assert.deepEqual(h.text('trips'), ['3']);
  assert.deepEqual(h.text('rating'), ['—']);
});

await check('backend ON: a stale or failed history read changes nothing', async () => {
  const pending = [];
  const h = driverHarness({ load: () => new Promise((yes, no) => pending.push({ yes, no })) });
  h.api.refresh();
  h.api.refresh();
  pending[0].yes({ trips: 9, earnings: 9999, tripIds: [] });
  await flush();
  assert.deepEqual(h.text('trips'), ['x'], 'the superseded first read is dropped');
  pending[1].no(new Error('history down'));
  await flush();
  assert.deepEqual(h.text('trips'), ['x']);
  h.context.usable = false;
  h.api.refresh();
  pending[2].yes({ trips: 1, earnings: 1, tripIds: [] });
  await flush();
  assert.deepEqual(h.text('trips'), ['x'], 'a screen that lost ownership is not painted');
});

await check('backend ON: the earnings sheet gets no balance, an honest hint and keyed server stats', async () => {
  const h = driverHarness({ load: () => Promise.resolve({ trips: 2, earnings: 1500, tripIds: [] }) });
  h.api.refresh();
  await flush();
  const o = JSON.parse(JSON.stringify(h.api.overrides()).replace(/ | /g, ' '));
  assert.equal(o.balanceLabel, '—');
  assert.match(o.balanceHint, /Сервис выплат не подключён/);
  assert.deepEqual(o.stats, [
    { key: 'today', val: '1 500 ₽', lbl: 'Сегодня' },
    { key: 'trips', val: '2', lbl: 'Поездок' },
    { key: 'rating', val: '—', lbl: 'Рейтинг' },
  ]);
  assert.equal(o.passengerInitials, 'АМ', 'the real initials stay');
});

await check('server merge: no demo shift time or rating survives; a server rating is shown', () => {
  const h = driverHarness({});
  const srv = { tripId: 't', status: 'DRIVER_EN_ROUTE', passenger: {}, driver: { name: 'Иван', rating: null, car: 'Kia' },
    route: {}, order: {}, cancel: { by: null }, timestamps: {} };
  const merged = h.api.merge(srv);
  assert.equal(merged.driver.shiftDuration, null);
  assert.equal(merged.driver.rating, null);
  assert.equal(merged.driver.onlineLabel, 'На линии', 'the local UI label stays');
  h.api.setRide({ ...merged, driver: { ...merged.driver, rating: '4,8' } });
  assert.equal(h.api.view().rating, '—', 'not before the ride is server-confirmed');
  h.api.setBackendRide(true);
  assert.equal(h.api.view().rating, '4,8');
});

await check('source: the top bar never paints the seed\'s shift time with the backend ON; reads at mount and on earnings', () => {
  assert.match(driverSource, /const shiftDuration = backendRead \? '' : \(ride\.driver\?\.shiftDuration \|\| ''\);/);
  assert.match(driverSource, /void runInitialDriverRead\(\);\n\s*refreshDriverToday\(\);/);
  const opener = sourceFunction(driverSource, 'openDriverEarnings');
  assert.match(opener, /if \(backendRead\) \{\s*Object\.assign\(payload, driverEarningsOverrides\(\)\);\s*refreshDriverToday\(\);/);
});

// ── D. earnings sheet markup ──────────────────────────────────────────────────
await check('earnings sheet: keyed stat cells and the payload\'s balance hint (default kept for OFF)', () => {
  const context = vm.createContext({ escapeHtml });
  vm.runInContext(`${sourceFunction(sheetsSource, 'earningsBalanceHtml')}\n${sourceFunction(sheetsSource, 'earningsStatgridHtml')}
    globalThis.api = { balance: earningsBalanceHtml, grid: earningsStatgridHtml };`, context);
  assert.match(context.api.grid({ stats: [{ key: 'today', val: '1 ₽', lbl: 'Сегодня' }] }), /data-driver-stat="today">1 ₽</);
  assert.doesNotMatch(context.api.grid({ stats: [{ val: '4 720 ₽', lbl: 'Сегодня' }] }), /data-driver-stat/);
  assert.match(context.api.balance({ balanceLabel: '—', balanceHint: 'Сервис выплат не подключён.' }), /Сервис выплат не подключён\./);
  assert.match(context.api.balance({ balanceLabel: '19 195 ₽' }), /Деньги за поездку зачислятся на ваш баланс\./);
});

// ── E. profile payouts fill ───────────────────────────────────────────────────
function payoutsHarness({ backend, resolved }) {
  const mount = new FakeElement('div');
  mount._attached = true;
  const calls = { off: 0, list: [], errors: [] };
  const context = vm.createContext({
    console, onReceiptsRetry: () => {},
    root: { querySelector: (sel) => (sel === '#pf2-po-trips-mount' ? mount : null) },
    isBackendEnabled: () => backend,
    driverReceiptPayoutSectionHtml: () => { calls.off += 1; return '<p>off</p>'; },
    listDriverReceiptsResolved: () => resolved(),
    driverReceiptListHtml: (receipts, title) => { calls.list.push([receipts, title]); return `<p>${title}</p>`; },
    reportAppShellError: (...args) => calls.errors.push(args),
    receiptsFillRunId: 0,
  });
  vm.runInContext(`${sourceFunction(profileSource, 'fillReceipts')}\nglobalThis.fill = fillReceipts;`, context);
  return { fill: context.fill, mount, calls };
}

await check('payouts pane: OFF keeps the sync demo list; ON shows the server list under an honest title', async () => {
  const off = payoutsHarness({ backend: false, resolved: () => { throw new Error('no read OFF'); } });
  off.fill();
  assert.equal(off.calls.off, 1);
  const receipts = [{ tripId: 'trip_order-a', net: 792 }];
  const on = payoutsHarness({ backend: true, resolved: () => Promise.resolve(receipts) });
  on.fill();
  assert.match(on.mount.innerHTML, /Загружаем чеки/);
  await flush();
  assert.equal(on.calls.off, 0, 'the demo list is not built with the backend ON');
  assert.deepEqual(on.calls.list, [[receipts, 'Чеки поездок']]);
});

await check('payouts pane ON: a failure reports server_error with the retry; a superseded fill is dropped', async () => {
  const failing = payoutsHarness({ backend: true, resolved: () => Promise.reject(new Error('down')) });
  failing.fill();
  await flush();
  assert.equal(failing.mount.innerHTML, '');
  assert.equal(failing.calls.errors.length, 1);
  assert.equal(failing.calls.errors[0][0], 'server_error');
  assert.equal(typeof failing.calls.errors[0][1].onRetry, 'function');
  const answers = [];
  const racing = payoutsHarness({ backend: true, resolved: () => new Promise((yes) => answers.push(yes)) });
  racing.fill();
  racing.fill();
  answers[1]([{ tripId: 'new' }]);
  await flush();
  answers[0]([{ tripId: 'old' }]);
  await flush();
  assert.deepEqual(racing.calls.list.map(([r]) => r[0].tripId), ['new']);
});

await check('payouts pane copy: ON never claims demo receipts', () => {
  assert.match(profileSource, /isBackendEnabled\(\)\n\s*\? 'Здесь чеки завершённых поездок\./);
});

// ── F. receipt preview ────────────────────────────────────────────────────────
function previewHarness({ backend, resolved }) {
  const content = new FakeElement('div');
  content._attached = true;
  const calls = { local: [] };
  const demo = { tripId: '48-321', fare: 1540, commission: -185, tip: 120, net: 1475, paymentMode: 'noncash' };
  const context = vm.createContext({
    console, content, DEMO_RECEIPT_TRIP_ID: '48-321',
    isBackendEnabled: () => backend,
    getReceipt: (id) => { calls.local.push(id); return id === '48-321' ? { ...demo } : null; },
    getReceiptResolved: () => resolved(),
    loadResource: (fn) => fn(),
    receiptDocHtml: (r) => `doc:${r.tripId}:${r.paymentMode}`,
    receiptMissingHtml: (id) => `missing:${id}`,
  });
  vm.runInContext(`${sourceFunction(receiptSource, 'renderResolved')}\nglobalThis.render = renderResolved;`, context);
  return { render: (tripId, forced) => context.render(content, tripId, forced, () => {}, false), content, calls };
}

await check('receipt preview ON: the trip\'s own receipt in the forced mode, never the demo', async () => {
  const known = previewHarness({ backend: true, resolved: () => Promise.resolve({ tripId: 'trip_order-a', paymentMode: 'noncash' }) });
  await known.render('trip_order-a', 'cash');
  assert.equal(known.content.innerHTML, 'doc:trip_order-a:cash');
  const unknown = previewHarness({ backend: true, resolved: () => Promise.resolve(null) });
  await unknown.render('trip_order-zzz', 'noncash');
  assert.equal(unknown.content.innerHTML, 'missing:trip_order-zzz');
  assert.deepEqual(unknown.calls.local, [], 'the demo receipt is not even read');
});

await check('receipt preview OFF: the demo fallback for an unknown trip is unchanged', async () => {
  const off = previewHarness({ backend: false, resolved: () => { throw new Error('no read OFF'); } });
  await off.render('unknown', 'cash');
  assert.equal(off.content.innerHTML, 'doc:48-321:cash');
});

console.log(`\n${passed} passed; ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
