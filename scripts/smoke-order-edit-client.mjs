// Order edit, client side (#1188): the owner changes the price, the time or the comment of an open
// order. Runs the shipped seam (mock_api updateOwnOrderTerms), the form's pure rules
// (order_map_draft editFormFromOrder / orderEditTerms) and the /responses markup against a
// controlled storage and transport. No browser, PostgreSQL or network. The server side
// (PATCH /api/v1/orders/:orderId) is pinned by server/test/order-edit-flow.test.mjs.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { escapeHtml } from './lib/fake-dom.mjs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const responsesSource = read('../public/src/screens/responses.js');
const formSource = read('../public/src/screens/order_map_draft.js');
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

function sourceFunction(source, name) {
  const start = new RegExp(`^( *)(?:export )?(?:default )?(?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(start, `runtime function ${name} must exist`);
  const ending = new RegExp(`^${start[1]}\\}\\s*$`, 'gm');
  ending.lastIndex = start.index + start[0].length;
  const end = ending.exec(source);
  assert.ok(end, `runtime function ${name} must have its own closing line`);
  return source.slice(start.index, end.index + end[0].length).replace(/^( *)export\s+(?:default\s+)?/, '$1');
}

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
const mockApi = await import('../public/src/mock_api.js');
const { editFormFromOrder, orderEditTerms } = await import('../public/src/screens/order_map_draft.js');
const ORDERS_KEY = 'bazardrive.ride_orders.v1';
const OWN = { name: 'Анна', isCurrentUser: true, authorId: 'me', comment: '' };

function put(order) {
  storage.clear();
  storage.set(ORDERS_KEY, JSON.stringify([{
    id: 'order-x', status: 'CREATED', pickup: { label: 'Ленина, 1' }, dropoff: { label: 'Аэропорт' },
    estimatedPrice: 500, estimatedPriceLabel: '500 ₽', scheduledMode: 'now', scheduledAt: '2026-11-20T09:00:00.000Z',
    scheduledLabel: '', comment: 'Подъезд 2', passenger: { ...OWN, comment: 'Подъезд 2' }, ...order,
  }]));
}
const stored = () => mockApi.getOrderById('order-x');
const off = () => {
  delete globalThis.__BD_API_BASE__;
  globalThis.fetch = () => { throw new Error('fetch must not run while the backend is OFF'); };
};
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

// ── A. the form's rules ───────────────────────────────────────────────────────
await check('the edit form opens with the order\'s terms (the comment as the ride reads it)', () => {
  assert.deepEqual(editFormFromOrder({ estimatedPrice: 500, scheduledMode: 'now', comment: 'Подъезд 2' }),
    { mode: 'now', date: '', time: '', price: 500, comment: 'Подъезд 2' });
  assert.deepEqual(editFormFromOrder({ estimatedPrice: '1480.00', scheduledMode: 'later', scheduledAt: '2026-12-01T10:30:00', comment: '', passenger: { comment: 'Позвоните' } }),
    { mode: 'later', date: '2026-12-01', time: '10:30', price: 1480, comment: 'Позвоните' });
  // No budget opens with no price; a free-text «later» time opens with empty fields to set.
  assert.deepEqual(editFormFromOrder({ estimatedPrice: 0, scheduledMode: 'later', scheduledAt: 'завтра утром' }),
    { mode: 'later', date: '', time: '', price: null, comment: '' });
});

await check('an edit sends only what changed; an untouched form sends nothing', () => {
  const order = { estimatedPrice: 500, scheduledMode: 'now', scheduledAt: '2026-11-20T09:00:00.000Z', comment: 'Подъезд 2' };
  const same = editFormFromOrder(order);
  assert.deepEqual(orderEditTerms(order, same), {});
  // A comment edit on a «now» order does not move its time.
  assert.deepEqual(orderEditTerms(order, { ...same, comment: '  Подъезд 3  ' }), { comment: 'Подъезд 3' });
  assert.deepEqual(orderEditTerms(order, { ...same, price: 800 }), { estimatedPrice: 800 });
  const now = new Date('2026-11-20T12:00:00.000Z');
  assert.deepEqual(orderEditTerms(order, { ...same, mode: 'later', date: '2026-12-02', time: '12:00' }, now),
    { scheduledMode: 'later', scheduledAt: '2026-12-02T12:00:00' });
  const later = { ...order, scheduledMode: 'later', scheduledAt: '2026-12-01T10:00:00' };
  const laterForm = editFormFromOrder(later);
  assert.deepEqual(orderEditTerms(later, laterForm), {});
  assert.deepEqual(orderEditTerms(later, { ...laterForm, time: '11:00' }), { scheduledAt: '2026-12-01T11:00:00' });
  assert.deepEqual(orderEditTerms(later, { ...laterForm, mode: 'now' }, now),
    { scheduledMode: 'now', scheduledAt: now.toISOString() });
  // Clearing a comment that lives only in the snapshot is a change.
  assert.deepEqual(orderEditTerms({ ...order, comment: '', passenger: { comment: 'Позвоните' } },
    { ...same, comment: '' }), { comment: '' });
  // Labels are never sent: the record keeper owns them.
  assert.doesNotMatch(sourceFunction(formSource, 'orderEditTerms'), /Label/);
});

await check('a value the form normalized to show it is not sent back unless that field is edited (Codex P2)', () => {
  const long = 'Подъезд 3, '.repeat(30).trim();
  const order = { estimatedPrice: 150000.5, scheduledMode: 'now', comment: long };
  const opened = editFormFromOrder(order);
  assert.equal(opened.price, 100000, 'the form shows the price in its own range');
  assert.equal(opened.comment.length, 200, 'and the comment within its own limit');
  // Only the time changes: neither the clamped price nor the cut comment goes back.
  const now = new Date('2026-11-20T12:00:00.000Z');
  assert.deepEqual(orderEditTerms(order, { ...opened, mode: 'later', date: '2026-12-02', time: '12:00' }, now),
    { scheduledMode: 'later', scheduledAt: '2026-12-02T12:00:00' });
  assert.deepEqual(orderEditTerms(order, opened), {});
  // Editing that very field sends what the passenger typed.
  assert.deepEqual(orderEditTerms(order, { ...opened, price: 90000 }), { estimatedPrice: 90000 });
  assert.deepEqual(orderEditTerms(order, { ...opened, comment: 'Подъезд 3' }), { comment: 'Подъезд 3' });
});

// ── B. the seam, backend OFF ──────────────────────────────────────────────────
await check('backend OFF: the owner\'s open order is edited in the local store by the server\'s rules', async () => {
  off();
  put({ scheduledMode: 'later', scheduledAt: '2026-12-01T10:00:00', scheduledLabel: '1 дек, 10:00' });
  const next = await mockApi.updateOwnOrderTerms('order-x', {
    estimatedPrice: 800, scheduledAt: '2026-12-02T12:00:00', comment: '', estimatedPriceLabel: 'ignored', pickup: { label: 'ignored' },
  });
  assert.equal(next.estimatedPrice, 800);
  assert.equal(next.estimatedPriceLabel, `${(800).toLocaleString('ru-RU')} ₽`, 'a new price gets its own label');
  assert.equal(next.scheduledAt, '2026-12-02T12:00:00');
  assert.equal(next.scheduledLabel, '', 'a stale time label is dropped');
  assert.deepEqual([next.comment, next.passenger.comment, next.passenger.name], ['', '', 'Анна'], 'both comment copies');
  assert.equal(next.pickup.label, 'Ленина, 1', 'the route is not editable');
  assert.ok(next.termsChangedAt && next.priceChangedAt);
  assert.deepEqual(stored(), next, 'persisted');
});

await check('backend OFF: a time or comment edit stamps the terms, not the price; nothing changed writes nothing', async () => {
  off();
  put({});
  const commented = await mockApi.updateOwnOrderTerms('order-x', { comment: 'Подъезд 3' });
  assert.ok(commented.termsChangedAt);
  assert.equal(commented.priceChangedAt, undefined);
  assert.equal(commented.estimatedPriceLabel, '500 ₽');
  put({});
  const before = storage.get(ORDERS_KEY);
  assert.equal((await mockApi.updateOwnOrderTerms('order-x', {})).id, 'order-x');
  assert.equal(storage.get(ORDERS_KEY), before);
});

await check('backend OFF: an order that is not the caller\'s open order is refused with ORDER_NOT_EDITABLE', async () => {
  off();
  for (const [label, order] of [
    ['someone else\'s order', { passenger: { name: 'Б', isCurrentUser: false } }],
    ['no passenger snapshot', { passenger: null }],
    ['a demo fixture', { demo: true }],
    ['a driver-surface test order', { createdByRole: 'driver' }],
    ['an order with a driver', { status: 'ACCEPTED' }],
    ['a canceled order', { status: 'CANCELED' }],
  ]) {
    put(order);
    const before = storage.get(ORDERS_KEY);
    await assert.rejects(mockApi.updateOwnOrderTerms('order-x', { estimatedPrice: 900 }),
      (err) => err.code === mockApi.ORDER_NOT_EDITABLE, label);
    assert.equal(storage.get(ORDERS_KEY), before, `${label}: untouched`);
  }
  await assert.rejects(mockApi.updateOwnOrderTerms('missing', { estimatedPrice: 900 }), (err) => err.code === mockApi.ORDER_NOT_EDITABLE);
});

const RESPONSES_KEY = 'bazardrive.responses.v1';
function putResponses(entries) {
  storage.set(RESPONSES_KEY, JSON.stringify(Object.fromEntries(entries.map((r) => [r.id, r]))));
}
const responses = () => JSON.parse(storage.get(RESPONSES_KEY) || '{}');
const offer = (id, extra = {}) => ({ id, kind: 'passenger_response', orderId: 'order-x', status: 'SENT', driverPrice: 600, ...extra });

await check('backend OFF: a new price rejects the open local offers on the order; others are untouched (Codex P2)', async () => {
  off();
  put({});
  putResponses([offer('resp_a'), offer('resp_b', { status: 'WITHDRAWN' }), offer('resp_c', { orderId: 'order-y' }), { ...offer('resp_d'), kind: 'other' }]);
  await mockApi.updateOwnOrderTerms('order-x', { estimatedPrice: 800 });
  const r = responses();
  assert.deepEqual([r.resp_a.status, r.resp_a.rejectedBy, r.resp_a.rejectedReason, Boolean(r.resp_a.rejectedAt)],
    ['REJECTED', 'passenger_edit', 'order_price_changed', true]);
  assert.equal(r.resp_b.status, 'WITHDRAWN');
  assert.equal(r.resp_c.status, 'SENT', 'another order\'s offer');
  assert.equal(r.resp_d.status, 'SENT', 'not a passenger response');
});

await check('backend OFF: a time or comment edit keeps the open local offers, marked; no change marks nothing', async () => {
  off();
  put({});
  putResponses([offer('resp_a')]);
  await mockApi.updateOwnOrderTerms('order-x', { estimatedPrice: 500, comment: 'Подъезд 2' });
  assert.equal(responses().resp_a.previousTermsAt, undefined, 'the same terms mark nothing');
  await mockApi.updateOwnOrderTerms('order-x', { comment: 'Подъезд 3' });
  const r = responses().resp_a;
  assert.deepEqual([r.status, Boolean(r.previousTermsAt), r.rejectedBy], ['SENT', true, undefined]);
  // A refused edit touches no offer.
  put({ status: 'ACCEPTED' });
  putResponses([offer('resp_a')]);
  await assert.rejects(mockApi.updateOwnOrderTerms('order-x', { estimatedPrice: 900 }));
  assert.equal(responses().resp_a.status, 'SENT');
});

await check('/responses (backend OFF): a rejected local offer is not listed; a marked one says so', () => {
  assert.match(sourceFunction(responsesSource, 'loadResponsesForOrder'), /&& r\.rejectedBy !== 'passenger_edit'\);/);
  assert.match(sourceFunction(responsesSource, 'mapResponseToDriverCard'), /previousTerms: Boolean\(response && response\.previousTermsAt\)/);
});

// ── C. the seam, backend ON ───────────────────────────────────────────────────
await check('backend ON: PATCH /orders/:id with only the editable terms; the server copy replaces the local one', async () => {
  put({ statusUpdatedAt: 'local-only' });
  globalThis.__BD_API_BASE__ = 'https://api.fixture.invalid';
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), method: init.method, body: JSON.parse(init.body) });
    return response(200, { order: { id: 'order-x', status: 'CREATED', estimatedPrice: 800, estimatedPriceLabel: '800 ₽', comment: 'Подъезд 2', termsChangedAt: 't1', priceChangedAt: 't1' } });
  };
  const next = await mockApi.updateOwnOrderTerms('order-x', { estimatedPrice: 800, estimatedPriceLabel: 'x', scheduledLabel: 'y', pickup: {} });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/orders\/order-x$/);
  assert.equal(requests[0].method, 'PATCH');
  assert.deepEqual(requests[0].body, { estimatedPrice: 800 });
  assert.deepEqual([next.estimatedPriceLabel, next.priceChangedAt, next.statusUpdatedAt], ['800 ₽', 't1', 'local-only']);
  assert.deepEqual(stored(), next);
  delete globalThis.__BD_API_BASE__;
});

await check('backend ON: nothing changed sends no request; a refusal or a malformed answer leaves the local copy', async () => {
  put({});
  globalThis.__BD_API_BASE__ = 'https://api.fixture.invalid';
  globalThis.fetch = () => { throw new Error('an empty edit must not reach the server'); };
  assert.equal((await mockApi.updateOwnOrderTerms('order-x', {})).id, 'order-x');
  const before = storage.get(ORDERS_KEY);
  globalThis.fetch = async () => response(409, { error: 'not editable', code: 'ORDER_NOT_EDITABLE', retryable: false });
  await assert.rejects(mockApi.updateOwnOrderTerms('order-x', { comment: 'x' }), (err) => err.code === mockApi.ORDER_NOT_EDITABLE);
  globalThis.fetch = async () => response(200, { order: { id: 'other' } });
  await assert.rejects(mockApi.updateOwnOrderTerms('order-x', { comment: 'x' }), (err) => err.code === 'BAD_RESPONSE');
  assert.equal(storage.get(ORDERS_KEY), before);
  delete globalThis.__BD_API_BASE__;
});

// ── D. /responses: the entry point and the previous-terms mark ────────────────
await check('/responses: the owner\'s idle order actions are «Изменить заказ» and «Отменить заказ»', () => {
  const ctx = vm.createContext({ escapeHtml, PROFILE_CTA_LABEL: 'Перейти в профиль' });
  vm.runInContext(`const ORDER_CANCEL_QUESTION = '';\n${sourceFunction(responsesSource, 'renderOrderCancelHtml')}\nthis.html = renderOrderCancelHtml;`, ctx);
  const idle = ctx.html('idle');
  assert.match(idle, /data-order-action="edit-order"[^>]*>Изменить заказ</);
  assert.match(idle, /data-order-action="ask-cancel"[^>]*>Отменить заказ</);
  assert.doesNotMatch(ctx.html('confirm'), /edit-order/, 'the cancel confirm stays a two-button question');
  // The tap opens the edit form for this order, and only while the order is still cancelable
  // (own, CREATED, no driver) — the same gate as the cancel.
  const wiring = responsesSource.slice(responsesSource.indexOf("orderCancelEl.addEventListener('click'"));
  assert.match(wiring, /action === 'edit-order'\)\s*\{\s*if \(request\.orderId && orderCancelable\(\)\) go\(`\/order-map-draft\?orderId=\$\{encodeURIComponent\(request\.orderId\)\}`\)/);
});

await check('/responses: an offer made for the previous terms says so; the others do not', () => {
  const mapper = sourceFunction(responsesSource, 'mapServerOfferToDriverCard');
  assert.match(mapper, /previousTerms: Boolean\(offer && offer\.previousTermsAt\)/);
  for (const name of ['renderDriverCard', 'renderOffer']) {
    const body = sourceFunction(responsesSource, name);
    assert.match(body, /driver\.previousTerms \? '<p class="responses__driver-previous-terms">Отклик на прежние условия/, name);
  }
});

// ── E. the form: edit mode wiring ─────────────────────────────────────────────
await check('the form: ?orderId= opens the edit mode; the route and the new-order draft stay out of it', () => {
  const mount = sourceFunction(formSource, 'orderMapDraftScreen');
  assert.match(mount, /const editId = hashParam\('orderId'\);/);
  assert.match(mount, /if \(!editableOrder\(order\)\)/);
  // The edited order's terms are loaded into the form; the reset back to defaults is for the next
  // NEW-order entry only (it once ran right after the load and opened the edit form empty).
  assert.match(mount, /Object\.assign\(form, editFormFromOrder\(order\)\);/);
  assert.match(mount, /if \(!editing && formHeldEdit\) \{/);
  assert.ok(mount.indexOf('Object.assign(form, editFormFromOrder(order));') < mount.indexOf('if (!editing && formHeldEdit) {'));
  assert.match(sourceFunction(formSource, 'persistForm'), /if \(editing\) return;/);
  assert.match(sourceFunction(formSource, 'editableOrder'), /isOwnLocalOrder\(order\) && order\.status === 'CREATED'/);
  const save = sourceFunction(formSource, 'handleSaveEdit');
  assert.match(save, /if \(!Object\.keys\(terms\)\.length\) \{\s*go\(back\);/);
  assert.match(save, /await updateOwnOrderTerms\(order\.id, terms\)/);
  assert.match(save, /err\.code === ORDER_NOT_EDITABLE/);
  assert.match(save, /ROLE_GATE_TEXT\.orderEdit/);
  assert.match(sourceFunction(formSource, 'handlePublish'), /^\s*if \(editing\) \{\s*handleSaveEdit\(root, draft\);/m);
  // A late answer does not navigate a screen the passenger already left (Codex P2): both
  // continuations check that this form is still the mounted one before acting.
  assert.equal((save.match(/if \(editing !== order \|\| !document\.body\.contains\(root\)\) return;/g) || []).length, 2);
  assert.ok(save.lastIndexOf('!document.body.contains(root)) return;') < save.lastIndexOf('go(back);'));
});

if (failures.length) {
  console.error(`FAIL ${failures.length} expectation(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`${passed} passed; 0 failed`);
