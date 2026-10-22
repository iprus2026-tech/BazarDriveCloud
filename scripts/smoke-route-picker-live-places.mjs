// Slice 4d-1 (#1057): with the backend ON the route picker offers only the passenger's own places —
// favorite routes (favorite_routes.v1) and up to five recent addresses from their completed rides
// (GET /history); no demo «Дом / Работа», no demo «Недавние», no mock search suggestions and no
// «Моё место». Backend OFF keeps the demo picker. Runs the shipped route_picker.js source in `vm`
// with its imports replaced and a small DOM fake.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { FakeElement, escapeHtml } from './lib/fake-dom.mjs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const pickerSource = read('../public/src/screens/route_picker.js');
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

// The picker mounts through fragments, replaceChildren and insertAdjacentHTML.
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
// Inputs rendered through innerHTML are plain fakes; the picker moves the caret after a re-render.
FakeElement.prototype.setSelectionRange = function setSelectionRange() {};

const DEMO = /Малая Бронная|Лесная Плаза|Мега Химки|Парк Победы|Шереметьево|Внуково|Моё место/;

function pickerHarness({ backend = true, favorites = [], history = () => Promise.resolve([]), draft = null } = {}) {
  const storage = new Map();
  if (draft) storage.set('bazardrive.route_draft.v1', JSON.stringify(draft));
  const navigation = [];
  const context = vm.createContext({
    console, escapeHtml,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    location: { hash: '#/route-picker' },
    document: {
      createElement: (tag) => new Dom(tag),
      createDocumentFragment: () => new Dom('#fragment'),
      activeElement: null,
    },
    go: (path) => navigation.push(path),
    createMapShell: () => new Dom('div'),
    peekRepeatRouteDraft: () => null, clearRepeatRouteDraft: () => {},
    peekFavoriteNotice: () => null, clearFavoriteNotice: () => {},
    loadFavoriteRoutes: () => favorites.map((f) => ({ ...f })),
    findLatestHandedOffOrderTripId: () => null,
    listHistoryFromBackend: () => history(),
    isBackendEnabled: () => backend,
    deriveMockCoordsFromLabel: () => null,
    resolvePointCoords: () => null,
  });
  const source = pickerSource.replace(/^import[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+default\s+/m, '').replace(/^export\s+(?=(?:async\s+)?(?:function|const)\s)/gm, '');
  vm.runInContext(`${source}
    globalThis.api = {
      mount: routePickerScreen,
      recents: typeof recentAddressesFromHistory === 'function' ? recentAddressesFromHistory : null,
      draft: () => routeDraft,
    };`, context, { filename: 'actual_route_picker.js' });
  return { api: context.api, storage, navigation };
}

function mount(h) {
  const root = h.api.mount();
  root._attached = true;
  const text = () => root.textContent.replace(/\s+/g, ' ');
  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => root.querySelectorAll(sel);
  async function type(kind, value) {
    const input = $(`[data-input="${kind}"]`);
    input.value = value;
    await input.fire('input');
  }
  return { root, text, $, $$, type };
}

const favorite = (extra = {}) => ({
  id: 'fav_1', role: 'passenger', label: 'Дача → Вокзал', customLabel: 'На дачу', pickup: 'Садовая, 5', dropoff: 'Вокзал', ...extra,
});
const ride = (completedAt, pickup, dropoff, role = 'passenger') => ({ role, completedAt, route: { pickupLabel: pickup, dropoffLabel: dropoff } });

// ── A. «Недавние» from the history ───────────────────────────────────────────
await check('recent addresses: own passenger rides, newest first, pickup then dropoff, unique, at most five', () => {
  const { api } = pickerHarness();
  const out = api.recents([
    ride('2026-10-20T10:00:00Z', 'Старый адрес', 'Ещё старее'),
    ride('2026-10-22T10:00:00Z', 'Дом', 'Работа'),
    ride('2026-10-21T10:00:00Z', ' работа ', 'Аптека'),
    ride('2026-10-22T11:00:00Z', 'Чужой', 'Как водитель', 'driver'),
    ride('2026-10-19T10:00:00Z', '', null),
    ride('2026-10-18T10:00:00Z', 'Шестой', 'Седьмой'),
  ]).map((r) => r.label);
  assert.deepEqual([...out], ['Дом', 'Работа', 'Аптека', 'Старый адрес', 'Ещё старее']);
  assert.equal(api.recents(null).length, 0);
});

// ── B. backend ON ─────────────────────────────────────────────────────────────
await check('ON: no demo places, no mock suggestions, no «Моё место»; favorites and a loading note', () => {
  const h = pickerHarness({ favorites: [favorite(), favorite({ id: 'fav_d', role: 'driver', customLabel: 'Водительский' })],
    history: () => new Promise(() => {}) });
  const f = mount(h);
  assert.doesNotMatch(f.text(), DEMO);
  assert.equal(f.$('[data-action="current-location"]'), null);
  assert.equal(f.$$('[data-place]').length, 0);
  assert.equal(f.$$('[data-favorite]').length, 1, 'only the passenger\'s favorite routes');
  assert.match(f.text(), /На дачу/);
  assert.match(f.text(), /Садовая, 5 → Вокзал/);
  assert.match(f.text(), /Загружаем недавние адреса/);
  assert.ok(f.$('[data-action="manual-open"]'), 'manual entry stays');
});

await check('ON: recent addresses arrive from the history and fill the focused point', async () => {
  const h = pickerHarness({ history: () => Promise.resolve([ride('2026-10-22T10:00:00Z', 'Дом', 'Работа')]) });
  const f = mount(h);
  await flush();
  const rows = f.$$('[data-recent]');
  assert.deepEqual(rows.map((r) => r.getAttribute('aria-label')), ['Дом', 'Работа']);
  await rows[1].fire();
  assert.equal(h.api.draft().pickup.label, 'Работа');
  assert.equal(h.api.draft().pickup.hint, 'Из ваших поездок');
});

await check('ON: a favorite route fills both points with its provenance', async () => {
  const h = pickerHarness({ favorites: [favorite()] });
  const f = mount(h);
  await f.$('[data-favorite="fav_1"]').fire();
  const d = h.api.draft();
  assert.deepEqual([d.pickup.label, d.dropoff.label], ['Садовая, 5', 'Вокзал']);
  assert.equal(d.prefillSource, 'favorite');
  assert.equal(d.prefillLabel, 'На дачу');
});

await check('ON: search runs over the passenger\'s own places only', async () => {
  const h = pickerHarness({ favorites: [favorite()], history: () => Promise.resolve([ride('2026-10-22T10:00:00Z', 'Вокзал, вход 2', 'Дом')]) });
  const f = mount(h);
  await flush();
  await f.type('pickup', 'вокзал');
  assert.deepEqual(f.$$('[data-suggestion]').map((r) => r.getAttribute('aria-label')), ['Вокзал, вход 2', 'Вокзал']);
  await f.type('pickup', 'внуково');
  assert.equal(f.$$('[data-suggestion]').length, 0, 'no mock airport rows');
  assert.match(f.text(), /ввести вручную/);
});

await check('ON: an empty history and a failed read are said plainly', async () => {
  const empty = mount(pickerHarness({ history: () => Promise.resolve([]) }));
  await flush();
  assert.match(empty.text(), /Здесь появятся адреса ваших завершённых поездок/);
  assert.match(empty.text(), /Избранных маршрутов пока нет/);
  const guest = mount(pickerHarness({ history: () => Promise.reject(Object.assign(new Error('401'), { status: 401 })) }));
  await flush();
  assert.match(guest.text(), /Здесь появятся адреса/, 'a guest has no rides, not an error');
  const failed = mount(pickerHarness({ history: () => Promise.reject(Object.assign(new Error('down'), { status: 503 })) }));
  await flush();
  assert.match(failed.text(), /Не удалось загрузить недавние адреса/);
});

await check('ON: a draft saved by the demo picker loses its demo points; a typed point stays (#1110 review)', () => {
  const draft = {
    pickup: { id: 'saved-home', label: 'ул. Малая Бронная, 28', hint: 'Дом', source: 'search' },
    dropoff: { id: 'manual-1', label: 'Мой адрес', hint: 'Введено вручную', source: 'manual' },
    focus: 'pickup',
  };
  const h = pickerHarness({ draft });
  mount(h);
  assert.equal(h.api.draft().pickup, null);
  assert.equal(h.api.draft().dropoff.label, 'Мой адрес');
  assert.equal(h.api.draft().focus, 'pickup');
  assert.doesNotMatch(h.storage.get('bazardrive.route_draft.v1'), /Малая Бронная/);
  const off = pickerHarness({ backend: false, draft });
  mount(off);
  assert.equal(off.api.draft().pickup.label, 'ул. Малая Бронная, 28', 'OFF keeps its own demo draft');
});

await check('ON: history arriving while the manual form is open keeps what is typed (#1110 review)', async () => {
  let resolve;
  const h = pickerHarness({ history: () => new Promise((yes) => { resolve = yes; }) });
  const f = mount(h);
  await f.$('[data-action="manual-open"]').fire();
  const street = f.$('[data-manual="street"]');
  assert.ok(street, 'the manual form is open');
  street.value = 'Лесная, 7';
  resolve([ride('2026-10-22T10:00:00Z', 'Дом', 'Работа')]);
  await flush();
  assert.equal(f.$('[data-manual="street"]'), street, 'the form was not re-rendered');
  assert.equal(street.value, 'Лесная, 7');
});

// ── C. backend OFF keeps the demo picker ─────────────────────────────────────
await check('OFF: the demo saved / recent rows, «Моё место» and mock search are unchanged', async () => {
  const h = pickerHarness({ backend: false, history: () => { throw new Error('no read OFF'); } });
  const f = mount(h);
  assert.match(f.text(), /Малая Бронная/);
  assert.match(f.text(), /Мега Химки/);
  assert.ok(f.$('[data-action="current-location"]'));
  assert.equal(f.$$('[data-favorite]').length, 0);
  await f.type('pickup', 'Внуково');
  assert.ok(f.$$('[data-suggestion]').length >= 3);
});

console.log(`\n${passed} passed; ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
