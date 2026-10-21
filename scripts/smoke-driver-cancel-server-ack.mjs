// Ordinary driver cancellation: execute the shipped screen command and sheet
// handlers against controlled transport, storage, owner and DOM boundaries.
// No browser, PostgreSQL, network, external packages, or real-time sleeps.
// The VM runs source read from the runtime files; it does not reimplement the
// cancel/reconciliation decision tree. Existing terminal/no-show smokes remain
// responsible for their independent flows.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const screenSource = read('../public/src/screens/active_ride.js');
const sheetsSource = read('../public/src/screens/active_ride_driver_sheets.js');
const apiSource = read('../public/src/mock_api.js');
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const observe = (promise) => Promise.resolve(promise).then(
  (value) => ({ value, error: null }),
  (error) => ({ value: null, error }),
);
const problem = (code, status = 0) => Object.assign(new Error(code), { code, status });
async function flush() { for (let i = 0; i < 24; i += 1) await Promise.resolve(); }
const clone = (value) => JSON.parse(JSON.stringify(value));

function makeClock() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map();
  return {
    setTimeout(fn, delay = 0) {
      const id = nextId++;
      tasks.set(id, { fn, at: now + Number(delay) });
      return id;
    },
    clearTimeout(id) { tasks.delete(id); },
    tick(ms) {
      const until = now + ms;
      for (;;) {
        const next = [...tasks].filter(([, task]) => task.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        tasks.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = until;
    },
    get pending() { return tasks.size; },
  };
}

function sourceFunction(source, name) {
  const start = new RegExp(`^( *)(?:export )?(?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(start, `runtime function ${name} must exist`);
  const ending = new RegExp(`^${start[1]}\\}\\s*$`, 'gm');
  ending.lastIndex = start.index + start[0].length;
  const end = ending.exec(source);
  assert.ok(end, `runtime function ${name} must have its own closing line`);
  const result = source.slice(start.index, end.index + end[0].length).replace(/^( *)export\s+/, '$1');
  // Fail visibly if the extraction boundaries ever stop being a function.
  new vm.Script(`${result}\n;void ${name};`);
  return result;
}

// Minimal tree and event boundary for the actual driver-sheet binder. Parsing
// the real render output keeps selectors and controls tied to shipped markup.
const decode = (value) => String(value).replace(/&(amp|lt|gt|quot|#39|apos);/g,
  (_, key) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" })[key]);
const dataKey = (name) => name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.parentElement = null;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this.style = {};
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this._text = '';
    this._attached = false;
    this.focusCount = 0;
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(' '); },
      toggle: (name, force) => {
        const on = force ?? !this.classList.contains(name);
        if (on) this.classList.add(name); else this.classList.remove(name);
        return on;
      },
    };
  }
  get className() { return this.attributes.get('class') || ''; }
  set className(value) { this.attributes.set('class', String(value)); }
  get id() { return this.attributes.get('id') || ''; }
  get isConnected() { return this.parentElement ? this.parentElement.isConnected : this._attached; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get innerHTML() { return this._html || ''; }
  set innerHTML(value) {
    this._html = String(value);
    this._text = '';
    this.children = [];
    const stack = [this];
    for (const token of this._html.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) || []) {
      if (token.startsWith('<!--')) continue;
      if (token.startsWith('</')) {
        const tag = token.match(/^<\/([^\s>]+)/)?.[1]?.toUpperCase();
        while (stack.length > 1) { if (stack.pop().tagName === tag) break; }
      } else if (token.startsWith('<')) {
        const tag = token.match(/^<([^\s/>]+)/)?.[1];
        if (!tag) continue;
        const node = new FakeElement(tag);
        const attrs = token.slice(tag.length + 1).replace(/\/?\s*>$/, '');
        for (const attr of attrs.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
          node.setAttribute(attr[1], decode(attr[2] ?? attr[3] ?? attr[4] ?? ''));
        }
        stack.at(-1).appendChild(node);
        if (!/\/>$/.test(token) && !/^(input|br|hr|img|meta|link)$/i.test(tag)) stack.push(node);
      } else {
        const node = new FakeElement('#text');
        node._text = decode(token);
        stack.at(-1).appendChild(node);
      }
    }
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith('data-')) this.dataset[dataKey(name)] = String(value);
    if (name === 'disabled') this.disabled = true;
    if (name === 'hidden') this.hidden = true;
  }
  getAttribute(name) { return name.startsWith('data-') ? this.dataset[dataKey(name)] ?? null : this.attributes.get(name) ?? null; }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name.startsWith('data-')) delete this.dataset[dataKey(name)];
    if (name === 'disabled') this.disabled = false;
    if (name === 'hidden') this.hidden = false;
  }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
    this._attached = false;
  }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  matches(selector) {
    return selector.split(',').some((part) => {
      const item = part.trim();
      if (!item) return false;
      const tag = item.match(/^[a-z][\w-]*/i)?.[0];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      const id = item.match(/#([\w-]+)/)?.[1];
      if (id && this.id !== id) return false;
      if ([...item.matchAll(/\.([\w-]+)/g)].some((match) => !this.classList.contains(match[1]))) return false;
      for (const match of item.matchAll(/\[([^\s=\]]+)(?:=["']?([^"'\]]*)["']?)?\]/g)) {
        const actual = this.getAttribute(match[1]);
        if (actual == null || (match[2] != null && actual !== match[2])) return false;
      }
      return !!(tag || id || item.startsWith('.') || item.startsWith('['));
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) {
    const out = [];
    const visit = (node) => { for (const child of node.children) { if (child.matches(selector)) out.push(child); visit(child); } };
    visit(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  focus() { this.focusCount += 1; }
  scrollIntoView() {}
  fire(type = 'click') {
    const event = { target: this, preventDefault() {}, stopPropagation() { this.stopped = true; } };
    const pending = [];
    for (let node = this; node; node = event.stopped ? null : node.parentElement) {
      for (const callback of node.listeners.get(type) || []) pending.push(callback(event));
    }
    return Promise.all(pending);
  }
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g,
  (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function sheetHarness(options = {}) {
  const clock = makeClock();
  const navigation = [];
  const state = { current: true, closeCount: 0, releaseCount: 0, trap: null };
  const context = vm.createContext({
    console, Element: FakeElement, escapeHtml, go: (path) => navigation.push(path),
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    trapFocus: (_overlay, config) => { state.trap = config; return () => { state.releaseCount += 1; }; },
  });
  const source = sheetsSource.replace(/^import[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+(?=(?:function|const)\s)/gm, '');
  vm.runInContext(`${source}\nglobalThis.sheetApi = { renderDriverCancelSheet, bindDriverSheetEvents };`, context,
    { filename: 'actual_active_ride_driver_sheets.js' });
  const overlay = new FakeElement('div');
  overlay._attached = true;
  overlay.className = 'active-ride-driver-sheet active-ride-driver-sheet--cancel';
  overlay.dataset.kind = 'cancel';
  overlay.dataset.stage = 'default';
  overlay.innerHTML = context.sheetApi.renderDriverCancelSheet(options.reason || 'other');
  context.sheetApi.bindDriverSheetEvents(overlay, {
    reason: 'other', onClose: () => { state.closeCount += 1; },
    isCurrent: () => state.current, ...options,
  });
  const $ = (selector) => {
    const node = overlay.querySelector(selector);
    assert.ok(node, `actual sheet must expose ${selector}`);
    return node;
  };
  return { overlay, $, clock, state, navigation };
}

const confirmed = (status = 'CANCELED') => ({ tripId: 'trip_cancel_test', status });

async function sheetChecks() {
  await check('sheet waits for confirmation, blocks duplicate and hidden exits, keeps submitted reason', async () => {
    const ack = deferred();
    const calls = [];
    const h = sheetHarness({ onConfirm: (...args) => { calls.push(args); return ack.promise; } });
    h.$('#driver-cancel-custom').value = 'Engine stopped';
    const first = h.$('#driver-cancel-confirm').fire();
    await flush();
    assert.equal(h.overlay.dataset.stage, 'loading');
    assert.equal(h.$('#driver-cancel-confirm').disabled, true);
    await h.$('#driver-cancel-confirm').fire();
    await h.$('.driver-cancel-sheet__option[data-value="wrong_pickup"]').fire();
    for (const close of h.overlay.querySelectorAll('[data-driver-sheet-close="true"]')) await close.fire();
    h.state.trap.onEscape({ preventDefault() {} });
    await h.$('#driver-cancel-back-feed').fire();
    await h.$('#driver-cancel-close-done').fire();
    h.clock.tick(60_000);
    assert.equal(h.overlay.dataset.stage, 'loading', 'a visual timer cannot prove cancellation');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'other');
    assert.equal(calls[0][1], 'Engine stopped');
    assert.equal(h.$('.driver-cancel-sheet__option[data-value="other"]').getAttribute('aria-checked'), 'true');
    assert.equal(h.state.closeCount, 0);
    assert.deepEqual(h.navigation, []);
    ack.resolve(confirmed());
    await first;
    assert.equal(h.overlay.dataset.stage, 'canceled');
    assert.equal(h.$('#driver-cancel-done-title').textContent, 'Поездка отменена');
    assert.doesNotMatch(h.$('#driver-cancel-done-text').textContent, /уведомлен/i);
    await h.$('#driver-cancel-back-feed').fire();
    assert.deepEqual(h.navigation, ['/feed']);
    assert.equal(h.state.closeCount, 1);
    assert.equal(h.state.releaseCount, 1);
  });

  await check('sheet blocks custom cancellation comments over the 500-character server limit', async () => {
    let calls = 0;
    const h = sheetHarness({ onConfirm: () => { calls += 1; return Promise.resolve(confirmed()); } });
    const custom = h.$('#driver-cancel-custom');
    assert.equal(custom.getAttribute('maxlength'), '500');
    custom.value = 'x'.repeat(501);
    await h.$('#driver-cancel-confirm').fire();
    assert.equal(calls, 0);
    assert.equal(h.overlay.dataset.stage, 'reason_selected');
    assert.equal(h.$('#driver-cancel-request-error').hidden, false);
    assert.match(h.$('#driver-cancel-request-error').textContent, /500/);
    assert.ok(custom.focusCount > 0);
  });

  await check('sheet keeps reason and comment after confirmed refusal and permits a deliberate retry', async () => {
    let calls = 0;
    const h = sheetHarness({ onConfirm: () => {
      calls += 1;
      return calls === 1 ? Promise.reject(problem('RIDE_CANCEL_NOT_CONFIRMED')) : Promise.resolve(confirmed());
    } });
    h.$('#driver-cancel-custom').value = 'Keep this explanation';
    await h.$('#driver-cancel-confirm').fire();
    assert.notEqual(h.overlay.dataset.stage, 'canceled');
    assert.notEqual(h.overlay.dataset.stage, 'loading');
    assert.equal(h.$('#driver-cancel-request-error').getAttribute('role'), 'alert');
    assert.equal(h.$('#driver-cancel-request-error').hidden, false);
    assert.match(h.$('#driver-cancel-request-error').textContent, /не подтверждена/i);
    assert.equal(h.$('#driver-cancel-custom').value, 'Keep this explanation');
    assert.equal(h.$('.driver-cancel-sheet__option[data-value="other"]').getAttribute('aria-checked'), 'true');
    assert.equal(h.$('#driver-cancel-confirm').disabled, false);
    await h.$('#driver-cancel-confirm').fire();
    assert.equal(calls, 2);
    assert.equal(h.overlay.dataset.stage, 'canceled');
  });

  await check('sheet unknown result uses status checks without another cancellation command', async () => {
    let writes = 0;
    let reads = 0;
    const h = sheetHarness({
      onConfirm: () => { writes += 1; return Promise.reject(problem('RIDE_CANCEL_UNKNOWN')); },
      onCheckStatus: () => { reads += 1; return reads === 1 ? Promise.reject(problem('RIDE_CANCEL_UNKNOWN')) : Promise.resolve(confirmed()); },
    });
    await h.$('#driver-cancel-confirm').fire();
    assert.notEqual(h.overlay.dataset.stage, 'canceled');
    assert.equal(h.$('#driver-cancel-request-error').hidden, false);
    assert.match(h.$('#driver-cancel-confirm').textContent, /Проверить статус/);
    await h.$('#driver-cancel-confirm').fire();
    assert.equal(writes, 1);
    assert.equal(reads, 1);
    assert.notEqual(h.overlay.dataset.stage, 'canceled');
    await h.$('#driver-cancel-confirm').fire();
    assert.equal(writes, 1);
    assert.equal(reads, 2);
    assert.equal(h.overlay.dataset.stage, 'canceled');
  });

  await check('reopened unknown sheet starts with a GET-only status check', async () => {
    let writes = 0;
    let reads = 0;
    const h = sheetHarness({ needsReconciliation: true,
      onConfirm: () => { writes += 1; return Promise.resolve(confirmed()); },
      onCheckStatus: () => { reads += 1; return Promise.resolve(confirmed()); },
    });
    assert.match(h.$('#driver-cancel-confirm').textContent, /Проверить статус/);
    await h.$('#driver-cancel-confirm').fire();
    assert.equal(writes, 0);
    assert.equal(reads, 1);
    assert.equal(h.overlay.dataset.stage, 'canceled');
  });

  for (const value of [undefined, null, {}, { status: 'COMPLETED' }, { status: 'DRIVER_EN_ROUTE' }]) {
    await check(`sheet rejects an unconfirmed callback result: ${JSON.stringify(value)}`, async () => {
      const h = sheetHarness({ onConfirm: () => Promise.resolve(value) });
      await h.$('#driver-cancel-confirm').fire();
      h.clock.tick(60_000);
      assert.notEqual(h.overlay.dataset.stage, 'canceled');
      assert.deepEqual(h.navigation, []);
    });
  }

  for (const rejects of [false, true]) {
    await check(`sheet ignores stale ${rejects ? 'rejection' : 'confirmation'} after route ownership changes`, async () => {
      const ack = deferred();
      const h = sheetHarness({ onConfirm: () => ack.promise });
      const pending = h.$('#driver-cancel-confirm').fire();
      await flush();
      const before = h.overlay.dataset.stage;
      h.state.current = false;
      h.overlay.remove();
      if (rejects) ack.reject(problem('RIDE_CANCEL_UNKNOWN')); else ack.resolve(confirmed());
      await pending;
      assert.equal(h.overlay.dataset.stage, before);
      assert.deepEqual(h.navigation, []);
      assert.equal(h.state.closeCount, 0);
    });
  }

  await check('sheet outcome copy follows returned status, not a NO_SHOW label hint', async () => {
    const h = sheetHarness({ outcomeLabel: 'NO_SHOW', onConfirm: () => Promise.resolve(confirmed()) });
    await h.$('#driver-cancel-confirm').fire();
    assert.equal(h.$('#driver-cancel-done-title').textContent, 'Поездка отменена');
    const actualNoShow = sheetHarness({ onConfirm: () => Promise.resolve(confirmed('NO_SHOW')) });
    await actualNoShow.$('#driver-cancel-confirm').fire();
    assert.equal(actualNoShow.$('#driver-cancel-done-title').textContent, 'Пассажир не вышел');
  });

  await check('ordinary cancel markup does not promise notification delivery', () => {
    const h = sheetHarness({ onConfirm: () => Promise.resolve(confirmed()) });
    assert.doesNotMatch(h.$('.driver-cancel-sheet__lead').textContent, /уведомлен/i);
    assert.doesNotMatch(h.$('#driver-cancel-done-text').textContent, /уведомлен/i);
  });
}

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
const rideState = await import('../public/src/ride_state.js');
const mockApi = await import('../public/src/mock_api.js');
// The real pure serializer keeps successful fixtures aligned with the API
// snapshot contract, without loading a server, database, or transport.
const { serializeRide } = await import('../server/src/serialize.js');
const TRIP_ID = 'trip_order-cancel-test';
const ORDER_ID = 'order-cancel-test';
const ACCEPTED_AT = '2026-10-11T09:00:00.000Z';
const CANCELED_AT = '2026-10-11T09:03:00.000Z';
const ORDERS_KEY = 'bazardrive.ride_orders.v1';

function rideFixture(status = 'DRIVER_EN_ROUTE', cancel = {}) {
  return {
    ...serializeRide({
      trip_id: TRIP_ID, role: 'driver', status,
      passenger_name: 'Fixture Passenger', passenger_initials: 'P',
      driver_name: 'Fixture Driver', driver_car: 'Fixture Car',
      route_pickup_label: 'Fixture A', route_dropoff_label: 'Fixture B',
      order_offer_price: '850 ₽',
      created_at: '2026-10-11T08:59:00.000Z', accepted_at: ACCEPTED_AT,
      updated_at: ['CANCELED', 'NO_SHOW', 'COMPLETED'].includes(status) ? CANCELED_AT : ACCEPTED_AT,
      completed_at: status === 'COMPLETED' ? CANCELED_AT : null,
      canceled_at: ['CANCELED', 'NO_SHOW'].includes(status) ? CANCELED_AT : null,
      cancel_by: status === 'NO_SHOW' ? 'driver' : (status === 'CANCELED' ? (cancel.by ?? 'driver') : null),
      cancel_reason: status === 'NO_SHOW'
        ? 'passenger_no_show'
        : (status === 'CANCELED' ? (cancel.reason ?? 'other') : null),
    }),
    orderId: ORDER_ID,
  };
}

function sourceBetween(source, first, last) {
  const start = source.indexOf(first);
  const end = source.indexOf(last, start + first.length);
  assert.ok(start >= 0 && end > start, `runtime boundaries must exist: ${first} -> ${last}`);
  return source.slice(start, end);
}

function commandHarness({ backend = true, status = 'DRIVER_EN_ROUTE' } = {}) {
  storage.clear();
  storage.set(ORDERS_KEY, JSON.stringify([{ id: ORDER_ID, status: 'ACCEPTED',
    pickup: { label: 'Fixture A' }, dropoff: { label: 'Fixture B' },
    passenger: { isCurrentUser: true }, acceptedAt: ACCEPTED_AT }]));
  rideState.saveActiveRide(rideFixture(status));
  const clock = makeClock();
  const calls = { patch: [], get: [], writes: [], canonical: [], legacySync: [], opens: [], notices: [], renders: [], startPoll: 0, refetch: 0 };
  const patchQueue = [];
  const getQueue = [];
  const owner = { token: 'fixture-token', userId: 'fixture-driver', ownerVersion: 'fixture-install-a', apiBase: backend ? 'https://api.fixture.invalid' : '' };
  const state = { current: true, candidate: false, rejected: false, owner };
  const root = new FakeElement('section'); root._attached = true;
  const sheet = new FakeElement('div'); root.appendChild(sheet);
  const invoke = (queue, kind, args) => {
    calls[kind].push(args);
    assert.ok(queue.length, `unexpected ${kind.toUpperCase()} request`);
    return queue.shift()(...args);
  };
  const context = vm.createContext({
    console, AbortController, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    window: { removeEventListener() {} },
    ORDER_LIFECYCLE_MISMATCH: mockApi.ORDER_LIFECYCLE_MISMATCH,
    ORDER_LIFECYCLE_MISMATCH_TEXT: mockApi.ORDER_LIFECYCLE_MISMATCH_TEXT,
    root, sheet, ride: rideState.findActiveRide(TRIP_ID), backendRead: backend, backendRide: backend,
    driverFixtureMode: false, destroyed: false, hasMounted: true, pendingStatus: null,
    driverCancelOperation: null, driverCancelNeedsReconcile: false, driverCancelReason: '', driverStatusOperation: null,
    driverActor: backend ? clone(owner) : null,
    DRIVER_RIDE_POLL_TIMEOUT_MS: 12_000,
    isCurrent: () => state.current,
    isBackendEnabled: () => Boolean(owner.apiBase), getApiBase: () => owner.apiBase,
    getAuthToken: () => owner.token, getAuthUserId: () => owner.userId,
    getAuthOwnerVersion: () => owner.ownerVersion,
    isAuthCandidate: () => state.candidate, isAuthTabRejected: () => state.rejected,
    RIDE_STATUS: rideState.RIDE_STATUS, isTerminalRideStatus: rideState.isTerminalRideStatus,
    isValidRideStatus: rideState.isValidRideStatus,
    findActiveRide: rideState.findActiveRide,
    saveActiveRide: (ride) => { calls.writes.push(['save', clone(ride)]); return rideState.saveActiveRide(ride); },
    updateActiveRideStatus: (...args) => { calls.writes.push(['status', ...args]); return rideState.updateActiveRideStatus(...args); },
    updateTripStatus: (...args) => { calls.canonical.push(['status', ...args]); return mockApi.updateTripStatus(...args); },
    reconcileCanonicalOrderFromAuthoritativeTerminalRide: (...args) => {
      calls.canonical.push(['reconcile', ...clone(args)]);
      return mockApi.reconcileCanonicalOrderFromAuthoritativeTerminalRide(...args);
    },
    patchRideStatus: (...args) => invoke(patchQueue, 'patch', args),
    getRideFromBackend: (...args) => invoke(getQueue, 'get', args),
    recordLegacySync: (...args) => calls.legacySync.push(args),
    refetchRideAndRender: () => { calls.refetch += 1; },
    openDriverCancelSheet: (...args) => { calls.opens.push(args); return null; },
    showNotice: (...args) => calls.notices.push(args), renderSheet: (...args) => calls.renders.push(args),
    stopRidePoll() {}, startRidePoll() { calls.startPoll += 1; }, clearRideRefetch() {}, clearWaitTimer() {},
    initialReadManager: { cancel() {} }, fixtureRetryTimer: null, noticeTimer: null,
    handleDriverRouteChange() {},
  });
  const code = [
    sourceBetween(screenSource, 'const ACTIVE_RIDE_TO_ORDER_STATUS =', 'function appendDriverChatMessage('),
    sourceFunction(screenSource, 'currentViewIsUsable'),
    sourceFunction(screenSource, 'mergeServerWaiting'),
    sourceFunction(screenSource, 'mergeServerRide'),
    sourceFunction(screenSource, 'clearDriverStatusWrite'),
    sourceFunction(screenSource, 'syncRideStatusToBackend'),
    sourceFunction(screenSource, 'commitDriverCompletion'),
    sourceFunction(screenSource, 'commitDriverNoShow'),
    sourceBetween(screenSource, '  function persistDriverRideStatus(', "  const root = document.createElement('section');"),
    sourceFunction(screenSource, 'renderDriverCancelUnknown'),
    sourceFunction(screenSource, 'teardownDriverRead'),
    `const actualStatusWriter = syncRideStatusToBackend;
    syncRideStatusToBackend = (...args) => { recordLegacySync(...args); return actualStatusWriter(...args); };
    globalThis.commandApi = {
      commit: commitDriverCancel, check: checkDriverCancelStatus,
      open: openDriverCancellation, renderUnknown: renderDriverCancelUnknown,
      startStatus: (nextStatus) => { ride = persistDriverRideStatus(nextStatus); return ride; },
      complete: commitDriverCompletion, noShow: commitDriverNoShow,
      dispose: teardownDriverRead,
      inspect: () => ({ ride, pendingStatus, driverCancelOperation, driverCancelNeedsReconcile, driverStatusOperation }),
    };`,
  ].join('\n');
  vm.runInContext(code, context, { filename: 'actual_driver_cancel_command.js' });
  return {
    api: context.commandApi, context, state, root, sheet, calls, clock, patchQueue, getQueue,
    stored: () => rideState.findActiveRide(TRIP_ID),
    order: () => mockApi.getOrderById(ORDER_ID),
    freeze: (ride) => rideState.saveActiveRide(ride),
  };
}

function assertRefused(outcome, code) {
  assert.equal(outcome.value, null);
  assert.equal(outcome.error?.code, code);
}
const noAuthorityWrites = (h) => {
  assert.equal(h.calls.writes.length, 0, 'no local ride write');
  assert.equal(h.calls.canonical.length, 0, 'no canonical-order write');
  assert.equal(h.calls.legacySync.length, 0, 'no second write through legacy sync');
};

async function commandChecks() {
  await check('definitive PATCH rejection plus GET active preserves the ride and allows a deliberate retry', async () => {
    const h = commandHarness();
    h.patchQueue.push(() => Promise.reject(problem('INVALID_CANCEL_REASON', 400)));
    h.getQueue.push(() => Promise.resolve(rideFixture()));
    assertRefused(await observe(h.api.commit('car_problem')), 'RIDE_CANCEL_NOT_CONFIRMED');
    assert.equal(h.stored().status, 'DRIVER_EN_ROUTE');
    assert.equal(h.order().status, 'ACCEPTED');
    assert.equal(h.api.inspect().driverCancelNeedsReconcile, false);
    assert.equal(h.calls.patch.length, 1);
    assert.equal(h.calls.get.length, 1);
    assert.equal(h.calls.legacySync.length, 0);
    h.patchQueue.push(() => Promise.resolve(rideFixture('CANCELED', { reason: 'car_problem' })));
    const next = await observe(h.api.commit('car_problem'));
    assert.equal(next.error, null);
    assert.equal(next.value.status, 'CANCELED');
    assert.equal(h.calls.patch.length, 2);
    assert.equal(h.calls.get.length, 1);
  });

  await check('ambiguous PATCH failure plus active GET stays reconciliation-only and never retries the write', async () => {
    const h = commandHarness();
    h.patchQueue.push(() => Promise.reject(problem('NETWORK')));
    h.getQueue.push(() => Promise.resolve(rideFixture()));
    assertRefused(await observe(h.api.commit('car_problem')), 'RIDE_CANCEL_UNKNOWN');
    assert.equal(h.api.inspect().driverCancelNeedsReconcile, true);
    assert.equal(h.stored().status, 'DRIVER_EN_ROUTE');
    assert.equal(h.calls.patch.length, 1);
    assert.equal(h.calls.get.length, 1);
    h.getQueue.push(() => Promise.resolve(rideFixture()));
    assertRefused(await observe(h.api.check()), 'RIDE_CANCEL_UNKNOWN');
    assert.equal(h.calls.patch.length, 1, 'status checks never repeat an ambiguous cancellation write');
    assert.equal(h.calls.get.length, 2);
    assert.equal(h.api.inspect().driverCancelNeedsReconcile, true);
    h.getQueue.push(() => Promise.resolve(rideFixture('CANCELED', { reason: 'car_problem' })));
    const confirmedCancel = await h.api.check();
    assert.equal(confirmedCancel.status, 'CANCELED');
    assert.equal(h.api.inspect().driverCancelNeedsReconcile, false);
    assert.equal(h.calls.patch.length, 1);
  });

  await check('lost PATCH acknowledgement plus GET CANCELED commits server clocks with exactly one PATCH', async () => {
    const h = commandHarness();
    h.patchQueue.push(() => Promise.reject(problem('NETWORK')));
    h.getQueue.push(() => Promise.resolve(rideFixture('CANCELED', { reason: 'wrong_pickup' })));
    const result = await observe(h.api.commit('wrong_pickup'));
    assert.equal(result.error, null);
    assert.equal(result.value.status, 'CANCELED');
    assert.equal(h.calls.patch.length, 1);
    assert.equal(h.calls.get.length, 1);
    assert.equal(h.calls.legacySync.length, 0);
    assert.equal(h.stored().timestamps.canceledAt, CANCELED_AT);
    assert.equal(h.stored().cancel.by, 'driver');
    assert.equal(h.stored().cancel.reason, 'wrong_pickup', 'the persisted server reason survives recovery');
    assert.equal(h.order().status, 'CANCELED');
    assert.equal(h.order().statusUpdatedAt, CANCELED_AT);
  });

  await check('unknown outcome and repeated status checks never issue another PATCH', async () => {
    const h = commandHarness();
    h.patchQueue.push(() => Promise.reject(problem('NETWORK')));
    h.getQueue.push(() => Promise.reject(problem('NETWORK')));
    assertRefused(await observe(h.api.commit('car_problem')), 'RIDE_CANCEL_UNKNOWN');
    assert.equal(h.api.inspect().driverCancelNeedsReconcile, true);
    noAuthorityWrites(h);
    h.getQueue.push(() => Promise.reject(problem('NETWORK')));
    assertRefused(await observe(h.api.check()), 'RIDE_CANCEL_UNKNOWN');
    // Even a stale/miswired confirm must reconcile, not repeat a write.
    h.getQueue.push(() => Promise.reject(problem('NETWORK')));
    assertRefused(await observe(h.api.commit('other')), 'RIDE_CANCEL_UNKNOWN');
    assert.equal(h.calls.patch.length, 1);
    assert.equal(h.calls.get.length, 3);
    noAuthorityWrites(h);
    h.getQueue.push(() => Promise.resolve(rideFixture('CANCELED')));
    assert.equal((await h.api.check()).status, 'CANCELED');
    assert.equal(h.calls.patch.length, 1);
  });

  for (const terminal of ['CANCELED', 'NO_SHOW', 'COMPLETED']) {
    await check(`unknown cancellation still permits GET after another tab saves ${terminal}`, async () => {
      const h = commandHarness();
      h.patchQueue.push(() => Promise.reject(problem('NETWORK')));
      h.getQueue.push(() => Promise.reject(problem('NETWORK')));
      assertRefused(await observe(h.api.commit('car_problem')), 'RIDE_CANCEL_UNKNOWN');
      h.freeze(rideFixture(terminal));
      const frozen = JSON.stringify(h.stored());
      h.getQueue.push(() => Promise.resolve(rideFixture('CANCELED')));
      const result = await observe(h.api.check());
      assert.equal(h.calls.get.length, 2, 'local terminal must not block the outstanding reconciliation read');
      assert.equal(h.calls.patch.length, 1, 'reconciliation never repeats the cancellation command');
      assert.equal(h.api.inspect().driverCancelNeedsReconcile, false, 'verified reply exits unknown state');
      if (terminal === 'CANCELED') {
        assert.equal(result.error, null);
        assert.equal(result.value.status, 'CANCELED');
        assert.equal(h.order().status, 'CANCELED');
      } else {
        assertRefused(result, 'RIDE_CANCEL_TERMINAL');
        assert.equal(JSON.stringify(h.stored()), frozen, 'a different terminal snapshot remains frozen');
        noAuthorityWrites(h);
      }
    });
  }

  const invalidSnapshots = [
    ['missing body', null], ['missing trip', { status: 'CANCELED', timestamps: { canceledAt: CANCELED_AT } }],
    ['foreign trip', { ...rideFixture('CANCELED'), tripId: 'trip_order-someone-else' }],
    ['missing status', { tripId: TRIP_ID }], ['unknown status', { tripId: TRIP_ID, status: 'CANCELLED' }],
    ['partial terminal body', { tripId: TRIP_ID, status: 'CANCELED', timestamps: { canceledAt: CANCELED_AT } }],
    ['invalid calendar date', { ...rideFixture('CANCELED'), timestamps: {
      ...rideFixture('CANCELED').timestamps, canceledAt: '2026-02-30T09:03:00.000Z',
    } }],
    ['malformed nested passenger', { ...rideFixture('CANCELED'), passenger: {
      ...rideFixture('CANCELED').passenger, name: ['unexpected array'],
    } }],
    ['missing clock', { ...rideFixture('CANCELED'), timestamps: {} }],
    ['invalid clock', { ...rideFixture('CANCELED'), timestamps: { canceledAt: 'not-a-time' } }],
  ];
  for (const [label, invalid] of invalidSnapshots) {
    await check(`unverified ${label} in PATCH and GET grants no authority`, async () => {
      const h = commandHarness();
      h.patchQueue.push(() => Promise.resolve(invalid));
      h.getQueue.push(() => Promise.resolve(invalid));
      assertRefused(await observe(h.api.commit('car_problem')), 'RIDE_CANCEL_UNKNOWN');
      assert.equal(h.stored().status, 'DRIVER_EN_ROUTE');
      assert.equal(h.order().status, 'ACCEPTED');
      assert.equal(h.calls.patch.length, 1);
      assert.equal(h.calls.get.length, 1);
      noAuthorityWrites(h);
    });
  }

  await check('a non-cancel PATCH body keeps uncertainty after an active GET because commit ordering is unknown', async () => {
    const h = commandHarness();
    h.patchQueue.push(() => Promise.resolve(rideFixture()));
    h.getQueue.push(() => Promise.resolve(rideFixture()));
    assertRefused(await observe(h.api.commit('car_problem')), 'RIDE_CANCEL_UNKNOWN');
    assert.equal(h.calls.get.length, 1);
    assert.equal(h.stored().status, 'DRIVER_EN_ROUTE');
    assert.equal(h.api.inspect().driverCancelNeedsReconcile, true);
  });

  await check('a partial active GET cannot settle uncertainty or replace the stored ride clocks', async () => {
    const h = commandHarness();
    const before = JSON.stringify(h.stored());
    h.patchQueue.push(() => Promise.reject(problem('NETWORK')));
    h.getQueue.push(() => Promise.resolve({ tripId: TRIP_ID, status: 'DRIVER_EN_ROUTE' }));
    assertRefused(await observe(h.api.commit('car_problem')), 'RIDE_CANCEL_UNKNOWN');
    assert.equal(h.api.inspect().driverCancelNeedsReconcile, true);
    assert.equal(JSON.stringify(h.stored()), before);
    assert.equal(h.calls.get.length, 1);
    noAuthorityWrites(h);
  });

  await check('pending operation rejects another confirm or status read without an extra request', async () => {
    const h = commandHarness();
    const ack = deferred();
    h.patchQueue.push(() => ack.promise);
    const first = observe(h.api.commit('car_problem'));
    await flush();
    noAuthorityWrites(h);
    assertRefused(await observe(h.api.commit('other')), 'RIDE_CANCEL_BUSY');
    assertRefused(await observe(h.api.check()), 'RIDE_CANCEL_BUSY');
    assert.equal(h.calls.patch.length, 1);
    assert.equal(h.calls.get.length, 0);
    ack.resolve(rideFixture('CANCELED'));
    assert.equal((await first).value.status, 'CANCELED');
  });

  for (const lateOutcome of ['resolve', 'reject']) {
    for (const phase of ['during cancellation', 'after confirmation']) {
      await check(`cancellation supersedes a stuck active-status PATCH; late ${lateOutcome} ${phase} is inert`, async () => {
        const h = commandHarness();
        const previous = deferred();
        const cancellation = deferred();
        h.patchQueue.push(() => previous.promise, () => cancellation.promise);
        h.api.startStatus('DRIVER_APPROACHING_PICKUP');
        const previousSignal = h.calls.patch[0][2].signal;
        assert.equal(h.api.inspect().pendingStatus, 'DRIVER_APPROACHING_PICKUP');
        const attempt = observe(h.api.commit('car_problem'));
        await flush();
        assert.equal(h.calls.patch.length, 2, 'new cancellation does not wait for the abandoned request');
        assert.equal(h.calls.patch[1][1], 'CANCELED');
        assert.equal(previousSignal.aborted, true);
        assert.equal(h.api.inspect().driverStatusOperation, null);
        assert.equal(h.api.inspect().pendingStatus, 'CANCELED');
        assert.equal(h.stored().status, 'DRIVER_APPROACHING_PICKUP', 'pending cancellation grants no terminal authority');
        if (phase === 'after confirmation') {
          cancellation.resolve(rideFixture('CANCELED'));
          assert.equal((await attempt).value.status, 'CANCELED');
        }
        const before = JSON.stringify(h.stored());
        const pendingBefore = h.api.inspect().pendingStatus;
        const operationBefore = h.api.inspect().driverCancelOperation;
        const writesBefore = h.calls.writes.length;
        const canonicalBefore = h.calls.canonical.length;
        if (lateOutcome === 'resolve') previous.resolve(rideFixture('DRIVER_APPROACHING_PICKUP'));
        else previous.reject(problem('NETWORK'));
        await flush();
        assert.equal(JSON.stringify(h.stored()), before);
        assert.equal(h.api.inspect().pendingStatus, pendingBefore);
        assert.equal(h.api.inspect().driverCancelOperation, operationBefore);
        assert.equal(h.calls.writes.length, writesBefore);
        assert.equal(h.calls.canonical.length, canonicalBefore);
        assert.equal(h.calls.get.length, 0);
        assert.equal(h.calls.refetch, 0, 'abandoned writer does not refetch over the current operation');
        assert.equal(h.calls.notices.length, 0, 'abandoned failure does not overwrite the cancellation result');
        assert.equal(h.calls.legacySync.length, 1, 'only the original active-status action uses the legacy writer');
        if (phase === 'during cancellation') cancellation.resolve(rideFixture('CANCELED'));
        assert.equal((await attempt).value.status, 'CANCELED');
        assert.equal(h.stored().timestamps.canceledAt, CANCELED_AT);
        assert.equal(h.order().status, 'CANCELED');
        assert.equal(h.calls.patch.length, 2);
        assert.equal(h.clock.pending, 0);
      });
    }
  }

  for (const terminal of ['COMPLETED', 'NO_SHOW']) {
    await check(`ordinary cancellation cannot supersede a pending ${terminal} command`, async () => {
      const h = commandHarness({ status: terminal === 'NO_SHOW' ? 'WAITING_PASSENGER' : 'IN_PROGRESS' });
      const pending = deferred();
      h.patchQueue.push(() => pending.promise);
      const original = observe(terminal === 'NO_SHOW' ? h.api.noShow() : h.api.complete());
      assert.equal(h.api.inspect().pendingStatus, terminal);
      assertRefused(await observe(h.api.commit('car_problem')), 'RIDE_CANCEL_BUSY');
      assertRefused(await observe(h.api.check()), 'RIDE_CANCEL_BUSY');
      assert.equal(h.calls.patch.length, 1);
      assert.equal(h.calls.get.length, 0);
      assert.equal(h.api.inspect().pendingStatus, terminal);
      assert.equal(h.api.inspect().driverCancelOperation, null);
      noAuthorityWrites(h);
      pending.resolve(rideFixture(terminal));
      await original;
      await flush();
      assert.equal(h.stored().status, terminal);
      assert.equal(h.api.inspect().pendingStatus, null);
    });
  }

  const changeOwner = {
    token: (h) => { h.state.owner.token = 'replacement-token'; },
    userId: (h) => { h.state.owner.userId = 'replacement-user'; },
    ownerVersion: (h) => { h.state.owner.ownerVersion = 'replacement-install-same-token'; },
    apiBase: (h) => { h.state.owner.apiBase = 'https://replacement.fixture.invalid'; },
    route: (h) => { h.state.current = false; },
    dispose: (h) => { h.api.dispose(); },
  };
  for (const [name, mutate] of Object.entries(changeOwner)) {
    for (const phase of ['PATCH', 'GET']) {
      await check(`${name} change during ${phase} prevents follow-up transport and all authority writes`, async () => {
        const h = commandHarness();
        const pending = deferred();
        h.patchQueue.push(() => phase === 'PATCH' ? pending.promise : Promise.reject(problem('NETWORK')));
        if (phase === 'GET') h.getQueue.push(() => pending.promise);
        const attempt = observe(h.api.commit('car_problem'));
        await flush();
        assert.equal(h.calls.patch.length, 1);
        assert.equal(h.calls.get.length, phase === 'GET' ? 1 : 0);
        mutate(h);
        if (phase === 'PATCH') pending.reject(problem('NETWORK')); else pending.resolve(rideFixture('CANCELED'));
        assertRefused(await attempt, 'RIDE_CANCEL_STALE');
        assert.equal(h.calls.get.length, phase === 'GET' ? 1 : 0);
        noAuthorityWrites(h);
        assert.equal(h.stored().status, 'DRIVER_EN_ROUTE');
        assert.equal(h.clock.pending, 0);
      });
    }
  }

  await check('a positive PATCH acknowledgement cannot write after same-token ownership is replaced', async () => {
    const h = commandHarness();
    const pending = deferred();
    h.patchQueue.push(() => pending.promise);
    const attempt = observe(h.api.commit('car_problem'));
    await flush();
    h.state.owner.ownerVersion = 'new-install-with-same-bearer';
    pending.resolve(rideFixture('CANCELED'));
    assertRefused(await attempt, 'RIDE_CANCEL_STALE');
    assert.equal(h.calls.get.length, 0);
    noAuthorityWrites(h);
  });

  for (const flag of ['candidate', 'rejected']) {
    await check(`${flag} authentication cannot authorize a cancellation`, async () => {
      const h = commandHarness();
      h.state[flag] = true;
      assertRefused(await observe(h.api.commit('car_problem')), 'RIDE_CANCEL_STALE');
      assert.equal(h.calls.patch.length, 0);
      assert.equal(h.calls.get.length, 0);
      noAuthorityWrites(h);
    });
  }

  await check('12-second PATCH timeout uses a fresh GET signal and ignores a late transport result', async () => {
    const h = commandHarness();
    const late = deferred();
    h.patchQueue.push(() => late.promise); // Deliberately ignores AbortSignal.
    h.getQueue.push(() => Promise.resolve(rideFixture('CANCELED')));
    const attempt = observe(h.api.commit('car_problem'));
    await flush();
    const patchSignal = h.calls.patch[0][2].signal;
    h.clock.tick(12_000);
    await flush();
    const result = await attempt;
    assert.equal(result.error, null);
    assert.equal(patchSignal.aborted, true);
    assert.equal(h.calls.get.length, 1);
    assert.notEqual(h.calls.get[0][1].signal, patchSignal);
    assert.equal(h.calls.get[0][1].signal.aborted, false);
    const writes = h.calls.writes.length;
    late.resolve(rideFixture());
    await flush();
    assert.equal(h.calls.writes.length, writes);
    assert.equal(h.stored().status, 'CANCELED');
    assert.equal(h.clock.pending, 0);
  });

  await check('GET timeout retains unknown outcome and late GET cannot mutate the ride', async () => {
    const h = commandHarness();
    const late = deferred();
    h.patchQueue.push(() => Promise.reject(problem('NETWORK')));
    h.getQueue.push(() => late.promise);
    const attempt = observe(h.api.commit('car_problem'));
    await flush();
    h.clock.tick(12_000);
    await flush();
    assertRefused(await attempt, 'RIDE_CANCEL_UNKNOWN');
    assert.equal(h.api.inspect().driverCancelNeedsReconcile, true);
    late.resolve(rideFixture('CANCELED'));
    await flush();
    noAuthorityWrites(h);
    assert.equal(h.stored().status, 'DRIVER_EN_ROUTE');
  });

  for (const terminal of ['CANCELED', 'NO_SHOW', 'COMPLETED']) {
    await check(`existing ${terminal} snapshot is frozen before a cancellation attempt`, async () => {
      const h = commandHarness({ status: terminal });
      const before = JSON.stringify(h.stored());
      assertRefused(await observe(h.api.commit('other')), 'RIDE_CANCEL_TERMINAL');
      assert.equal(JSON.stringify(h.stored()), before);
      assert.equal(h.calls.patch.length, 0);
      assert.equal(h.calls.get.length, 0);
      noAuthorityWrites(h);
    });
  }

  for (const terminal of ['NO_SHOW', 'COMPLETED']) {
    await check(`server GET ${terminal} remains that terminal outcome and never claims ordinary cancellation`, async () => {
      const h = commandHarness();
      h.patchQueue.push(() => Promise.reject(problem('NETWORK')));
      h.getQueue.push(() => Promise.resolve(rideFixture(terminal)));
      assertRefused(await observe(h.api.commit('other')), 'RIDE_CANCEL_TERMINAL');
      assert.equal(h.stored().status, terminal);
      assert.equal(h.api.inspect().driverCancelNeedsReconcile, false);
      assert.equal(h.calls.patch.length, 1);
      assert.equal(h.order().status, terminal === 'NO_SHOW' ? 'CANCELED' : 'COMPLETED');
    });
  }

  await check('a terminal local snapshot arriving during PATCH cannot be thawed or relabeled', async () => {
    const h = commandHarness();
    const pending = deferred();
    h.patchQueue.push(() => pending.promise);
    const attempt = observe(h.api.commit('other'));
    await flush();
    const frozen = { ...rideFixture('COMPLETED'), driver: { name: 'Preserve this snapshot' } };
    h.freeze(frozen);
    const before = JSON.stringify(h.stored());
    pending.resolve(rideFixture('CANCELED'));
    assertRefused(await attempt, 'RIDE_CANCEL_TERMINAL');
    assert.equal(JSON.stringify(h.stored()), before);
    noAuthorityWrites(h);
  });

  await check('same CANCELED saved during PATCH receives the confirmed server reason and timestamps', async () => {
    const h = commandHarness();
    const pending = deferred();
    h.patchQueue.push(() => pending.promise);
    const attempt = observe(h.api.commit('other'));
    await flush();
    h.freeze({
      ...rideFixture('CANCELED'),
      cancel: { by: 'passenger', reason: 'local-unconfirmed-reason' },
      timestamps: { acceptedAt: ACCEPTED_AT, canceledAt: '2026-10-11T09:02:00.000Z' },
    });
    pending.resolve(rideFixture('CANCELED'));
    const result = await attempt;
    assert.equal(result.error, null);
    assert.equal(result.value.status, 'CANCELED');
    assert.equal(result.value.cancel.reason, 'other', 'server-confirmed reason replaces the stale local reason');
    assert.equal(h.stored().cancel.by, 'driver', 'server-confirmed actor replaces the stale local actor');
    assert.equal(h.stored().timestamps.canceledAt, CANCELED_AT);
    assert.equal(h.order().statusUpdatedAt, CANCELED_AT);
    assert.equal(h.calls.patch.length, 1);
    assert.equal(h.calls.get.length, 0);
    assert.equal(h.calls.legacySync.length, 0);
  });

  await check('backend OFF preserves local-only cancellation with no transport', async () => {
    const h = commandHarness({ backend: false });
    const result = await observe(h.api.commit('car_problem'));
    assert.equal(result.error, null);
    assert.equal(result.value.status, 'CANCELED');
    assert.equal(result.value.cancel.by, 'driver');
    assert.equal(result.value.cancel.reason, 'car_problem');
    assert.equal(h.order().status, 'CANCELED');
    assert.equal(h.calls.patch.length, 0);
    assert.equal(h.calls.get.length, 0);
  });

  await check('shared opener wires confirmed command, GET-only check and current owner into the real sheet contract', async () => {
    const h = commandHarness();
    h.patchQueue.push(() => Promise.reject(problem('NETWORK')));
    h.getQueue.push(() => Promise.reject(problem('NETWORK')));
    assertRefused(await observe(h.api.commit('car_problem')), 'RIDE_CANCEL_UNKNOWN');
    h.api.open();
    const [root, options] = h.calls.opens[0];
    assert.equal(root, h.root);
    assert.equal(options.needsReconciliation, true);
    assert.equal(options.onConfirm, h.api.commit);
    assert.equal(options.onCheckStatus, h.api.check);
    assert.equal(options.isCurrent(), true);
    h.state.current = false;
    assert.equal(options.isCurrent(), false);
    options.onClose();
    assert.equal(h.calls.renders.length, 0);
  });

  await check('unknown parent view offers only a status check and blocks duplicate checks', async () => {
    const h = commandHarness();
    const pending = deferred();
    h.getQueue.push(() => pending.promise);
    h.api.renderUnknown();
    for (const id of ['#ar-cancel', '#ar-start-pickup', '#ar-approaching', '#ar-arrived', '#ar-finish']) {
      assert.equal(h.sheet.querySelector(id), null);
    }
    const button = h.sheet.querySelector('#ar-check-cancel');
    assert.ok(button);
    const first = button.fire();
    await flush();
    await button.fire();
    assert.equal(h.calls.get.length, 1);
    assert.equal(h.calls.patch.length, 0);
    assert.equal(button.disabled, true);
    pending.resolve(rideFixture());
    await first;
    assert.equal(h.calls.renders.length, 1);
    assert.equal(h.stored().status, 'DRIVER_EN_ROUTE');
  });

  await check('patchRideStatus forwards AbortSignal and cancellation metadata without accepting actor', async () => {
    const calls = [];
    const context = vm.createContext({
      isBackendEnabled: () => true,
      apiFetch: async (...args) => { calls.push(args); return { ride: rideFixture('CANCELED') }; },
    });
    vm.runInContext(
      `${sourceFunction(apiSource, 'buildRideStatusPatchBody')}\n${sourceFunction(apiSource, 'patchRideStatus')}\nglobalThis.patch = patchRideStatus;`,
      context,
    );
    assert.equal((await context.patch(TRIP_ID, 'CANCELED')).status, 'CANCELED');
    const controller = new AbortController();
    await context.patch(TRIP_ID, 'CANCELED', {
      signal: controller.signal,
      cancel: { reason: 'other', comment: 'Engine stopped', by: 'passenger' },
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0][1].signal, undefined);
    assert.equal(calls[1][1].signal, controller.signal);
    assert.equal(JSON.stringify(calls[1][1].body), JSON.stringify({
      status: 'CANCELED',
      cancel: { reason: 'other', comment: 'Engine stopped' },
    }));
  });
}

// #1051 — 409 ORDER_LIFECYCLE_MISMATCH: the ride and its order are out of step on the
// server. A repeat cannot fix that, so the driver is told so and not offered a retry.
async function orderLifecycleMismatchChecks() {
  const mismatch = () => Promise.reject(problem('ORDER_LIFECYCLE_MISMATCH', 409));

  await check('mismatch refusal plus GET active is a final verdict, not a retry or an unknown outcome', async () => {
    const h = commandHarness();
    h.patchQueue.push(mismatch);
    h.getQueue.push(() => Promise.resolve(rideFixture()));
    const outcome = await observe(h.api.commit('car_problem'));
    assertRefused(outcome, 'ORDER_LIFECYCLE_MISMATCH');
    assert.equal(outcome.error.final, true);
    assert.equal(outcome.error.userMessage, mockApi.ORDER_LIFECYCLE_MISMATCH_TEXT);
    assert.equal(h.api.inspect().driverCancelNeedsReconcile, false);
    assert.equal(h.stored().status, 'DRIVER_EN_ROUTE');
    assert.equal(h.order().status, 'ACCEPTED');
    assert.equal(h.calls.patch.length, 1);
    assert.equal(h.calls.get.length, 1, 'the ride is still read back, as for any definitive refusal');
    assert.equal(h.calls.legacySync.length, 0);
  });

  await check('active-status and completion failures name the mismatch instead of a generic failure', async () => {
    const h = commandHarness();
    h.patchQueue.push(mismatch);
    h.api.startStatus('DRIVER_APPROACHING_PICKUP');
    await flush();
    assert.deepEqual(h.calls.notices.at(-1), [mockApi.ORDER_LIFECYCLE_MISMATCH_TEXT]);
    const done = commandHarness({ status: 'IN_PROGRESS' });
    done.patchQueue.push(mismatch);
    done.api.complete();
    await flush();
    assert.deepEqual(done.calls.notices.at(-1), [mockApi.ORDER_LIFECYCLE_MISMATCH_TEXT]);
  });

  await check('sheet shows a final refusal and keeps the command off', async () => {
    let calls = 0;
    const h = sheetHarness({ onConfirm: () => {
      calls += 1;
      return Promise.reject(Object.assign(problem('ORDER_LIFECYCLE_MISMATCH'),
        { final: true, userMessage: mockApi.ORDER_LIFECYCLE_MISMATCH_TEXT }));
    } });
    await h.$('#driver-cancel-confirm').fire();
    assert.notEqual(h.overlay.dataset.stage, 'canceled');
    assert.equal(h.$('#driver-cancel-request-error').hidden, false);
    assert.equal(h.$('#driver-cancel-request-error').textContent, mockApi.ORDER_LIFECYCLE_MISMATCH_TEXT);
    assert.doesNotMatch(h.$('#driver-cancel-confirm').textContent, /Проверить статус/);
    assert.equal(h.$('#driver-cancel-confirm').disabled, true);
    await h.$('#driver-cancel-confirm').fire();
    assert.equal(calls, 1, 'a final refusal is not resubmitted');
  });
}

await commandChecks();
await sheetChecks();
await orderLifecycleMismatchChecks();

console.log(`\n${passed} passed; ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
