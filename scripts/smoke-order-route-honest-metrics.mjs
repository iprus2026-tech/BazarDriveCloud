// Slice 4d-2 (#1057, #1058): with the backend ON the passenger's order carries only what is
// real. The route picker, the route preview and the order draft show no invented distance /
// time / «от N ₽» (route-price is still 501); the order draft asks for the price in an empty
// field, ±50 moves the typed value, and a publish without a price is refused; the order's
// points drop the label-hash coordinates. The price field is never natively invalid in either
// mode (#1058: step="any", no min/max — the native stepMismatch itself is checked in the live
// probe). Backend OFF keeps the local estimate. The picker owns the one estimate rule
// (routeEstimateFor) that the preview and the order draft follow, so both agree with the current
// mode whatever an earlier session saved (#1112 review). Runs the shipped screen sources in `vm`
// with their imports replaced and a small DOM fake; passenger_order_utils.js runs for real.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { FakeElement, escapeHtml } from './lib/fake-dom.mjs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const sources = {
  picker: read('../public/src/screens/route_picker.js'),
  preview: read('../public/src/screens/route_preview.js'),
  draft: read('../public/src/screens/order_map_draft.js'),
};
const utils = await import('../public/src/passenger_order_utils.js');
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
function setBackend(on) { globalThis.__BD_API_BASE__ = on ? 'http://127.0.0.1:3000/api/v1' : ''; }

// The screens mount through fragments and replaceChildren.
class Dom extends FakeElement {
  appendChild(child) {
    if (child && child.tagName === '#FRAGMENT') {
      for (const c of [...child.children]) super.appendChild(c);
      return child;
    }
    return super.appendChild(child);
  }
  replaceChildren(...nodes) {
    this.children = [];
    this._text = '';
    this._html = '';
    for (const node of nodes) this.appendChild(node);
  }
  insertAdjacentHTML(_position, html) {
    const tmp = new FakeElement('div');
    tmp.innerHTML = html;
    for (const c of [...tmp.children]) this.appendChild(c);
  }
}
FakeElement.prototype.setSelectionRange = function setSelectionRange() {};

function stripModule(source) {
  return source.replace(/^import[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+default\s+/m, '').replace(/^export\s+(?=(?:async\s+)?(?:function|const)\s)/gm, '');
}

function baseContext({ backend, storage, navigation, extra = {} }) {
  setBackend(backend);
  return vm.createContext({
    console, escapeHtml,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    location: { hash: '#/', search: '' },
    document: {
      createElement: (tag) => new Dom(tag),
      createDocumentFragment: () => new Dom('#fragment'),
      activeElement: null,
    },
    go: (path) => navigation.push(path),
    createMapShell: () => new Dom('div'),
    isBackendEnabled: () => backend,
    ...extra,
  });
}

function mountRoot(root) {
  root._attached = true;
  return {
    root,
    text: () => root.textContent.replace(/\s+/g, ' '),
    $: (sel) => root.querySelector(sel),
    $$: (sel) => root.querySelectorAll(sel),
  };
}

const point = (label, extra = {}) => ({ id: `manual-${label}`, label, hint: 'Введено вручную', source: 'manual', ...extra });
const hashed = (label) => ({ ...point(label), coords: utils.deriveMockCoordsFromLabel(label) });
const routeDraft = (route) => JSON.stringify({ pickup: hashed('Лесная, 7'), dropoff: hashed('Озеро Сенеж'), route });
const METRIC_TEXT = /\d\s*км|\d\s*мин|от\s*\d|ОЦЕНКА|Ориентир/;

// ── A. order points: no label-hash coordinates ON ────────────────────────────
await check('order point ON: the label-hash and an unknown origin leave a text-only point; a real one stays', () => {
  setBackend(true);
  const hashedPoint = utils.enrichOrderPointWithCoords(hashed('Лесная, 7'));
  assert.deepEqual({ ...hashedPoint }, { id: 'manual-Лесная, 7', label: 'Лесная, 7' });
  assert.deepEqual({ ...utils.enrichOrderPointWithCoords({ label: 'Без координат' }) }, { id: null, label: 'Без координат' });
  const legacy = utils.enrichOrderPointWithCoords({ label: 'Старый', coords: { lat: 55.7, lng: 37.6 } });
  assert.equal(legacy.lat, undefined, 'an unknown origin is not sent');
  const pin = utils.enrichOrderPointWithCoords({ label: 'Пирс', coords: { lat: 56.2, lng: 37.1, provenance: 'user_pin' } });
  assert.deepEqual([pin.lat, pin.lng, pin.provenance], [56.2, 37.1, 'user_pin']);
});

await check('order point OFF: the label-hash coordinates are kept', () => {
  setBackend(false);
  const p = utils.enrichOrderPointWithCoords({ label: 'Лесная, 7' });
  assert.equal(p.provenance, 'mock_hash');
  assert.ok(Number.isFinite(p.lat) && Number.isFinite(p.lng));
});

// ── B. route picker — owns the one estimate rule ─────────────────────────────
function pickerHarness({ backend, draft = null }) {
  const storage = new Map();
  if (draft) storage.set('bazardrive.route_draft.v1', JSON.stringify(draft));
  const navigation = [];
  const context = baseContext({ backend, storage, navigation, extra: {
    peekRepeatRouteDraft: () => null, clearRepeatRouteDraft: () => {},
    peekFavoriteNotice: () => null, clearFavoriteNotice: () => {},
    loadFavoriteRoutes: () => [],
    findLatestHandedOffOrderTripId: () => null,
    listHistoryFromBackend: () => Promise.resolve([]),
    deriveMockCoordsFromLabel: utils.deriveMockCoordsFromLabel,
    resolvePointCoords: utils.resolvePointCoords,
    isPlaceId: utils.isPlaceId,
    // #1160 — no catalog in this harness.
    listPublicPlaces: () => Promise.resolve([]),
    publicPlacePoint: () => null,
  } });
  vm.runInContext(`${stripModule(sources.picker)}
    globalThis.api = {
      mount: routePickerScreen,
      estimate: typeof routeEstimateFor === 'function' ? routeEstimateFor : null,
      localEstimate: estimateRoute,
    };`,
  context, { filename: 'actual_route_picker.js' });
  return { api: context.api, storage, navigation };
}
// The picker's estimate rule for a mode; on the old code (no shared rule) a stand-in that keeps the
// downstream screens mountable, so their own assertions decide.
function estimateRule(backend) {
  return pickerHarness({ backend }).api.estimate || (() => null);
}
// What a backend-OFF picker saves for these two points (its local estimate; same on the old code).
const OFF_ROUTE = pickerHarness({ backend: false }).api.localEstimate(point('Лесная, 7'), point('Озеро Сенеж'));

await check('picker: the estimate rule gives nothing ON and the local estimate OFF', () => {
  assert.equal(estimateRule(true)(point('Лесная, 7'), point('Озеро Сенеж')), null);
  assert.deepEqual({ ...estimateRule(false)(point('Лесная, 7'), point('Озеро Сенеж')) }, { ...OFF_ROUTE });
});

await check('picker ON: a ready route shows no estimate and saves no route metrics', async () => {
  const h = pickerHarness({ backend: true, draft: { pickup: point('Лесная, 7'), dropoff: point('Озеро Сенеж'), route: OFF_ROUTE } });
  const f = mountRoot(h.api.mount());
  await flush();
  assert.equal(f.$('.rp-estimate'), null);
  assert.doesNotMatch(f.text(), /Ориентир|\d\s*км/);
  await f.$('[data-action="continue"]').fire();
  assert.deepEqual([...h.navigation], ['/route-preview']);
  assert.equal(JSON.parse(h.storage.get('bazardrive.route_draft.v1')).route, null);
});

await check('picker OFF: the local estimate is unchanged', async () => {
  const h = pickerHarness({ backend: false, draft: { pickup: point('Лесная, 7'), dropoff: point('Озеро Сенеж') } });
  const f = mountRoot(h.api.mount());
  assert.ok(f.$('.rp-estimate'));
  assert.match(f.text(), /км/);
  await f.$('[data-action="continue"]').fire();
  const route = JSON.parse(h.storage.get('bazardrive.route_draft.v1')).route;
  assert.ok(route && route.distanceKm > 0 && route.estimatedPrice > 0);
});

// ── C. route preview — the picker's rule for the current mode, not the saved route ──
function previewHarness({ backend, route, draft = null }) {
  const routeEstimateFor = estimateRule(backend);
  const storage = new Map([['bazardrive.route_draft.v1', draft ? JSON.stringify(draft) : routeDraft(route)]]);
  const navigation = [];
  const context = baseContext({ backend, storage, navigation, extra: { routeEstimateFor } });
  vm.runInContext(`${stripModule(sources.preview)}
    globalThis.api = { mount: routePreviewScreen };`, context, { filename: 'actual_route_preview.js' });
  return { root: mountRoot(context.api.mount()), navigation };
}

await check('preview ON: two points are a valid route with no km / min / «от N ₽», even over an older estimate', async () => {
  const h = previewHarness({ backend: true, route: null });
  assert.equal(h.root.root.dataset.state, 'valid');
  assert.equal(h.root.$('.rpv-metrics'), null);
  assert.doesNotMatch(h.root.text(), METRIC_TEXT);
  await h.root.$('[data-action="create-order"]').fire();
  assert.deepEqual([...h.navigation], ['/order-map-draft']);
  const stale = previewHarness({ backend: true, route: OFF_ROUTE });
  assert.equal(stale.root.root.dataset.state, 'valid');
  assert.equal(stale.root.$('.rpv-metrics'), null, 'an estimate saved by a backend-OFF session is not shown (#1112 review)');
});

await check('preview OFF: the saved local estimate is shown; a missing point is malformed', () => {
  const h = previewHarness({ backend: false, route: OFF_ROUTE });
  assert.equal(h.root.root.dataset.state, 'valid');
  assert.ok(h.root.$('.rpv-metrics'));
  assert.match(h.root.text(), new RegExp(`от ${OFF_ROUTE.estimatedPrice}`));
  const half = previewHarness({ backend: false, draft: { pickup: hashed('Лесная, 7'), dropoff: null, route: null } });
  assert.equal(half.root.root.dataset.state, 'malformed');
  assert.match(half.root.text(), /Не указано место назначения/);
});

await check('preview OFF: a draft saved with no estimate shows the local estimate, as the order draft does (#1112 review)', () => {
  const h = previewHarness({ backend: false, route: null });
  assert.equal(h.root.root.dataset.state, 'valid');
  assert.match(h.root.text(), new RegExp(`от ${OFF_ROUTE.estimatedPrice}`));
});

// ── D. order draft ────────────────────────────────────────────────────────────
function draftHarness({ backend, route, form = null }) {
  const routeEstimateFor = estimateRule(backend);
  const storage = new Map([['bazardrive.route_draft.v1', routeDraft(route)]]);
  if (form) storage.set('bazardrive.order_form.v1', JSON.stringify(form));
  const navigation = [];
  const created = [];
  const timers = [];
  const context = baseContext({ backend, storage, navigation, extra: {
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    user: { get: () => ({ name: 'Пассажир', phone: '+79000001005' }) },
    createRideOrder: async (input) => { created.push(input); return { id: 'order-1', ...input }; },
    LOCAL_USER_ID: 'u_local',
    roleGateCode: () => null, ROLE_GATE_TEXT: {}, PROFILE_CTA_LABEL: '', PASSENGER_ROLE_REQUIRED: 'PASSENGER_ROLE_REQUIRED',
    enrichOrderPointWithCoords: utils.enrichOrderPointWithCoords,
    maskPassengerPhone: utils.maskPassengerPhone,
    shortRideNumber: utils.shortRideNumber, // #1118 — the success card's short number
    routeEstimateFor,
  } });
  vm.runInContext(`${stripModule(sources.draft)}
    globalThis.api = { mount: orderMapDraftScreen };`, context, { filename: 'actual_order_map_draft.js' });
  const f = mountRoot(context.api.mount());
  const price = () => f.$('[data-input="price"]');
  async function typePrice(value, commit = false) {
    const input = price();
    input.value = value;
    await input.fire('input');
    if (commit) await input.fire('change');
    return input;
  }
  async function publish() {
    setBackend(backend);
    await f.$('[data-action="publish"]').fire();
    while (timers.length) await timers.shift()();
    await flush();
  }
  return { f, price, typePrice, publish, created, storage };
}

await check('#1058: the price field carries no step grid and no native min / max, in both modes', () => {
  for (const backend of [true, false]) {
    const input = draftHarness({ backend, route: OFF_ROUTE }).price();
    assert.equal(input.getAttribute('step'), 'any', `step (backend ${backend})`);
    assert.equal(input.getAttribute('min'), null, `min (backend ${backend})`);
    assert.equal(input.getAttribute('max'), null, `max (backend ${backend})`);
  }
});

await check('draft ON: no metrics, no estimate; the price field starts empty and is required', async () => {
  const h = draftHarness({ backend: true, route: null });
  assert.equal(h.f.$('.omd-metrics'), null);
  assert.equal(h.f.$('.omd-price__hint'), null);
  assert.doesNotMatch(h.f.text(), METRIC_TEXT);
  assert.equal(h.price().getAttribute('value'), '');
  await h.publish();
  assert.equal(h.created.length, 0, 'no order without a price');
  assert.match(h.f.text(), /Укажите цену поездки/);
  const stale = draftHarness({ backend: true, route: OFF_ROUTE });
  assert.equal(stale.f.$('.omd-metrics'), null, 'an estimate saved by a backend-OFF session is not shown');
  assert.equal(stale.price().getAttribute('value'), '', 'an older estimate does not become the price');
  assert.doesNotMatch(stale.f.text(), new RegExp(String(OFF_ROUTE.estimatedPrice)));
});

await check('draft ON: ±50 moves the typed value; «−» on an empty field does nothing', async () => {
  const h = draftHarness({ backend: true, route: null });
  await h.f.$('[data-action="price-down"]').fire();
  assert.equal(h.price().getAttribute('value'), '');
  await h.typePrice('763');
  await h.f.$('[data-action="price-up"]').fire();
  assert.equal(h.price().getAttribute('value'), '813');
  await h.f.$('[data-action="price-down"]').fire();
  await h.f.$('[data-action="price-down"]').fire();
  assert.equal(h.price().getAttribute('value'), '713');
  const fresh = draftHarness({ backend: true, route: null });
  await fresh.f.$('[data-action="price-up"]').fire();
  assert.equal(fresh.price().getAttribute('value'), '50');
});

await check('draft ON: a committed price shows the stored whole value; an emptied field is «no price»', async () => {
  const h = draftHarness({ backend: true, route: null });
  assert.equal((await h.typePrice('763.6', true)).value, '764');
  assert.equal((await h.typePrice('250000', true)).value, '100000');
  assert.equal((await h.typePrice('', true)).value, '');
  const left = await h.typePrice('512.4');
  await left.fire('focusout');
  assert.equal(left.value, '512', 'leaving the field without a change event shows the stored value too');
  await h.typePrice('', true);
  await h.publish();
  assert.equal(h.created.length, 0);
  assert.match(h.f.text(), /Укажите цену поездки/);
});

await check('draft ON: the order carries the typed price, 0 km / 0 min and text-only points', async () => {
  const h = draftHarness({ backend: true, route: OFF_ROUTE });
  await h.typePrice('763');
  await h.publish();
  assert.equal(h.created.length, 1);
  const order = h.created[0];
  assert.deepEqual([order.estimatedPrice, order.distanceKm, order.durationMin], [763, 0, 0]);
  assert.deepEqual({ ...order.pickup }, { id: 'manual-Лесная, 7', label: 'Лесная, 7' });
  assert.deepEqual({ ...order.dropoff }, { id: 'manual-Озеро Сенеж', label: 'Озеро Сенеж' });
  assert.match(h.f.text(), /Заказ опубликован/);
});

await check('draft OFF: the estimate, the metrics and the hashed points are unchanged', async () => {
  const { distanceKm, durationMin, estimatedPrice } = OFF_ROUTE;
  const h = draftHarness({ backend: false, route: OFF_ROUTE });
  assert.ok(h.f.$('.omd-metrics'));
  assert.match(h.f.text(), new RegExp(`ОЦЕНКА ОТ ${estimatedPrice}`));
  assert.equal(h.price().getAttribute('value'), String(estimatedPrice));
  await h.f.$('[data-action="price-up"]').fire();
  assert.equal(h.price().getAttribute('value'), String(estimatedPrice + 50));
  await h.publish();
  const order = h.created[0];
  assert.deepEqual([order.estimatedPrice, order.distanceKm, order.durationMin], [estimatedPrice + 50, distanceKm, durationMin]);
  assert.equal(order.pickup.provenance, 'mock_hash');
});

await check('draft OFF: a draft saved with no estimate shows the local estimate, as the preview does (#1112 review)', () => {
  const none = draftHarness({ backend: false, route: null });
  assert.equal(none.f.root.dataset.state, 'valid');
  assert.ok(none.f.$('.omd-metrics'));
  assert.equal(none.price().getAttribute('value'), String(OFF_ROUTE.estimatedPrice));
});

setBackend(false);
console.log(`\n${passed} passed; ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
