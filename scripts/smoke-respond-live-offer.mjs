// Slice 4b (#1061): the /respond form for a LIVE offer (backend ON, a canonical ride order) shows only
// real values — price chips from the order price (the exact price, then +10 % / +20 % rounded to
// 10 ₽), the pickup-timing block only for a scheduled order (its choice leads the message; the offer
// has no timing field yet, #1106), the car's own fields, no prefilled message. Backend OFF and legacy
// posts keep the demo form. Runs the shipped respond.js source in `vm` with its imports replaced.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { FakeElement, escapeHtml } from './lib/fake-dom.mjs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const respondSource = read('../public/src/screens/respond.js');
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

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
const mockApi = await import('../public/src/mock_api.js');

function respondHarness({ backend = true, vehicle = { model: 'Kia Rio', color: 'Серый', plate: 'А 108 ОР 77' } } = {}) {
  const offers = [];
  const navigation = [];
  const driver = { role: 'driver', firstName: 'Иван', vehicleMake: 'Kia', vehicleModel: 'Rio', vehiclePlate: 'А 108 ОР 77' };
  const context = vm.createContext({
    console, escapeHtml, localStorage: globalThis.localStorage,
    user: { get: () => driver },
    go: (path) => navigation.push(path),
    listFeedPosts: async () => [],
    submitOfferToBackend: async (offer) => { offers.push(offer); return { id: 'offer-1' }; },
    pollOfferOutcome: async () => ({ state: 'pending' }),
    isBackendEnabled: () => backend,
    roleGateCode: () => null, ROLE_GATE_TEXT: {}, PROFILE_CTA_LABEL: 'Перейти в профиль', DRIVER_ROLE_REQUIRED: 'DRIVER_ROLE_REQUIRED',
    loadResource: (fn) => fn(),
    resolveActiveGarageVehicle: () => (vehicle ? { ...vehicle } : null),
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    window: { location: { hash: '#/respond' } },
    document: { body: { contains: () => true }, createElement: (tag) => new FakeElement(tag) },
  });
  const source = respondSource.replace(/^import[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+default\s+/m, '').replace(/^export\s+(?=(?:async\s+)?(?:function|const)\s)/gm, '');
  // Tolerant of a source without the live helpers, so the OFF controls stay meaningful on `main`.
  vm.runInContext(`${source}\nglobalThis.api = { renderPassengerRide,
    livePriceChips: typeof livePriceChips === 'function' ? livePriceChips : null,
    liveOfferMessage: typeof liveOfferMessage === 'function' ? liveOfferMessage : null };`, context,
    { filename: 'actual_respond.js' });
  return { api: context.api, offers, navigation };
}

function render(h, post) {
  const root = new FakeElement('section');
  root._attached = true;
  h.api.renderPassengerRide(root, post);
  const $ = (sel) => root.querySelector(sel);
  return {
    root, $,
    chips: () => root.querySelectorAll('[data-price]').map((c) => c.textContent.trim()),
    timings: () => root.querySelectorAll('[data-timing]').map((c) => c.textContent.trim()),
    async submit({ price, message = '', timing } = {}) {
      if (timing) await $(`[data-timing="${timing}"]`).fire();
      $('#respond-price').value = price ?? $('#respond-price').getAttribute('value');
      $('#respond-message').value = message;
      await $('#respond-form').fire('submit');
      await flush();
    },
  };
}

const livePost = (extra = {}) => ({
  id: 'order-x', orderId: 'order-x', canonical: 'ride_order', type: 'trip', passenger: true,
  author: 'Пассажир', from: 'Дом', to: 'Центр', when: 'Сейчас', price: '763 ₽', scheduledMode: 'now', ...extra,
});

// ── A. the two rules ──────────────────────────────────────────────────────────
await check('price chips: the exact order price first, then +10 % / +20 % rounded to 10 ₽', () => {
  const { api } = respondHarness();
  assert.deepEqual([...api.livePriceChips(763)], [763, 840, 920]);
  assert.deepEqual([...api.livePriceChips(1000)], [1000, 1100, 1200]);
  assert.deepEqual([...api.livePriceChips(30)], [30, 40], 'a rounded chip equal to the price is dropped');
  for (const none of [null, 0, -5, NaN, undefined]) assert.deepEqual([...api.livePriceChips(none)], []);
});

await check('the message: a scheduled order\'s timing line first; nothing invented otherwise', () => {
  const { api } = respondHarness();
  assert.equal(api.liveOfferMessage('earlier', '  Есть детское кресло ', true),
    'Могу подать машину раньше указанного времени.\nЕсть детское кресло');
  assert.equal(api.liveOfferMessage('at_time', '', true), 'Подам машину к указанному времени.');
  assert.equal(api.liveOfferMessage('negotiate', '', true), 'Время подачи обсудим.');
  assert.equal(api.liveOfferMessage('earlier', 'Еду', false), 'Еду', 'a «Сейчас» order carries no timing line');
  assert.equal(api.liveOfferMessage('at_time', '', false), '');
});

// ── B. the live form ──────────────────────────────────────────────────────────
await check('live «Сейчас» order: chips from the price, no timing block, the car\'s own colour, no message', () => {
  const h = respondHarness();
  const f = render(h, livePost());
  assert.deepEqual(f.chips(), ['763', '840', '920']);
  assert.equal(f.$('[data-price="763"]').classList.contains('active'), true);
  assert.equal(f.$('#respond-price').getAttribute('value'), '763');
  assert.equal(f.$('#timing-chips'), null, 'no pickup-timing choice for «Сейчас»');
  assert.equal(f.$('#respond-message').textContent.trim(), '', 'no prefilled message');
  assert.equal(f.$('.respond__vehicle-meta').textContent.trim(), 'Серый');
  assert.doesNotMatch(f.root.innerHTML, /1300|1500|1800|06:30|чемодан|кондиционер|4 места/);
});

await check('live scheduled order: the three timing options, no invented hour', () => {
  const f = render(respondHarness(), livePost({ scheduledMode: 'later', when: '23.10, 07:00' }));
  assert.deepEqual(f.timings(), ['К указанному времени', 'Могу раньше', 'Договоримся']);
});

await check('live order with a decimal price: the numeric price, not the label parse (763.5 ≠ 7635)', async () => {
  const h = respondHarness();
  const f = render(h, livePost({ price: '763.5 ₽', priceValue: 763.5 }));
  assert.deepEqual(f.chips(), ['763.5', '840', '920']);
  assert.equal(f.$('#respond-price').getAttribute('value'), '763.5');
  await f.submit();
  assert.equal(h.offers[0].price, 763.5, 'an unchanged submission sends the order price');
});

await check('live order without a price: no chips and an empty price field', () => {
  const f = render(respondHarness(), livePost({ price: null }));
  assert.equal(f.$('#price-chips'), null);
  assert.equal(f.$('#respond-price').getAttribute('value'), '');
});

await check('live car without a colour: no meta line at all (no «Цвет не указан»)', () => {
  const f = render(respondHarness({ vehicle: { model: 'Kia Rio', color: '', plate: 'А 108 ОР 77' } }), livePost());
  assert.equal(f.$('.respond__vehicle-meta'), null);
});

await check('live submit: the timing line leads the message, the car is real, an empty message is allowed', async () => {
  const h = respondHarness();
  const f = render(h, livePost({ scheduledMode: 'later' }));
  await f.submit({ price: '840', timing: 'earlier', message: 'Есть кресло' });
  assert.equal(h.offers.length, 1);
  assert.deepEqual({ ...h.offers[0] }, {
    orderId: 'order-x', driverName: 'Иван', car: 'Kia Rio · Серый', price: 840,
    message: 'Могу подать машину раньше указанного времени.\nЕсть кресло',
  });
  const now = respondHarness({ vehicle: { model: 'Kia Rio', color: '', plate: 'А 108 ОР 77' } });
  const g = render(now, livePost());
  await g.submit({ price: '763', message: '' });
  assert.equal(now.offers.length, 1, 'no «Напишите сообщение пассажиру» block for a live offer');
  assert.equal(now.offers[0].message, '');
  assert.equal(now.offers[0].car, 'Kia Rio', 'no placeholder colour reaches the server');
});

// ── C. backend OFF / legacy posts keep the demo form ─────────────────────────
await check('backend OFF: the demo chips, timing, prefilled message and car meta are unchanged', async () => {
  const h = respondHarness({ backend: false });
  const f = render(h, livePost());
  assert.deepEqual(f.chips(), ['1300', '1500', '1800']);
  assert.deepEqual(f.timings(), ['К указанному времени', 'Могу раньше · 06:30', 'Договоримся']);
  assert.match(f.$('#respond-message').textContent, /есть место для чемодана/);
  assert.match(f.$('.respond__vehicle-meta').textContent, /Серый · 4 места · кондиционер/);
  await f.submit({ price: '1500', message: '' });
  assert.match(f.$('#respond-error-text').textContent, /Напишите сообщение пассажиру/, 'OFF still requires a message');
  assert.equal(h.offers.length, 0);
});

await check('backend ON but a legacy post (no canonical order): the demo form', () => {
  const f = render(respondHarness(), livePost({ canonical: undefined, orderId: undefined }));
  assert.deepEqual(f.chips(), ['1300', '1500', '1800']);
});

// ── D. the feed post carries the order schedule ──────────────────────────────
await check('rideOrderToFeedPost carries scheduledMode / scheduledAt', () => {
  const later = mockApi.rideOrderToFeedPost({ id: 'o1', status: 'CREATED', scheduledMode: 'later', scheduledAt: '2026-10-23T04:00:00.000Z' });
  assert.equal(later.scheduledMode, 'later');
  assert.equal(later.scheduledAt, '2026-10-23T04:00:00.000Z');
  const now = mockApi.rideOrderToFeedPost({ id: 'o2', status: 'CREATED' });
  assert.equal(now.scheduledMode, 'now');
  assert.equal(now.scheduledAt, null);
  assert.equal(now.priceValue, null);
  assert.equal(mockApi.rideOrderToFeedPost({ id: 'o3', status: 'CREATED', estimatedPrice: 763.5 }).priceValue, 763.5);
});

console.log(`\n${passed} passed; ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
