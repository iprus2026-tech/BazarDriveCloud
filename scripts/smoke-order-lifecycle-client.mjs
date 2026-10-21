// Order lifecycle, client side (#1049 order cancel before selection, #1050 passenger ride cancel
// awaits the server, #1051 ORDER_LIFECYCLE_MISMATCH copy). Runs the shipped sheet, screen command
// and seam source against controlled transport, storage, clock and DOM boundaries. No browser,
// PostgreSQL, network or real-time sleeps. The server side is pinned by server/test.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { FakeElement, escapeHtml } from './lib/fake-dom.mjs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const sheetsSource = read('../public/src/screens/active_ride_passenger_sheets.js');
const passengerSource = read('../public/src/screens/active_ride_passenger.js');
const responsesSource = read('../public/src/screens/responses.js');
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
  new vm.Script(`${result}\n;void ${name};`);
  return result;
}

function sourceConst(source, name) {
  const match = new RegExp(`^const ${name} = [^\\n]*;$`, 'm').exec(source);
  assert.ok(match, `runtime const ${name} must exist on one line`);
  return match[0];
}

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
const { RIDE_STATUS } = await import('../public/src/ride_state.js');
const mockApi = await import('../public/src/mock_api.js');
const roleGate = await import('../public/src/role_gate.js');
const repeatRoute = await import('../public/src/repeat_route.js');
const ORDERS_KEY = 'bazardrive.ride_orders.v1';
const REPEAT_ROUTE_KEY = 'bazardrive.repeat_route.v1';

// ── A. Passenger cancel sheet (#1050) ─────────────────────────────────────────
function passengerSheetHarness({ onConfirm, canCommit, status = 'DRIVER_EN_ROUTE' } = {}) {
  const clock = makeClock();
  const navigation = [];
  const docListeners = new Map();
  const context = vm.createContext({
    console, escapeHtml,
    go: (path) => navigation.push(path),
    trapFocus: () => () => {},
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    document: {
      createElement: (tag) => new FakeElement(tag),
      addEventListener: (type, callback) => docListeners.set(type, callback),
      removeEventListener: (type) => docListeners.delete(type),
    },
  });
  const source = sheetsSource.replace(/^import[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+(?=(?:function|const)\s)/gm, '');
  vm.runInContext(`${source}\nglobalThis.sheetApi = { openPassengerCancelSheet };`, context,
    { filename: 'actual_active_ride_passenger_sheets.js' });
  const root = new FakeElement('section');
  root._attached = true;
  const overlay = context.sheetApi.openPassengerCancelSheet(root, {
    ride: { status }, tripLabel: '№trip_order-x', onConfirm, canCommit,
  });
  const $ = (selector) => {
    const node = overlay.querySelector(selector);
    assert.ok(node, `actual sheet must expose ${selector}`);
    return node;
  };
  const pick = (reason) => $(`.passenger-cancel-sheet__reason[data-reason-id="${reason}"]`).fire();
  const commit = async () => {
    await $('#arp-cancel-confirm').fire();
    await $('#arp-cancel-confirm-yes').fire();
  };
  return { overlay, $, pick, commit, clock, navigation };
}

async function sheetChecks() {
  await check('server-backed cancel stays in loading until the server answers, then shows the server time', async () => {
    const ack = deferred();
    const calls = [];
    const h = passengerSheetHarness({ onConfirm: (...args) => { calls.push(args); return ack.promise; } });
    await h.pick('changed_mind');
    await h.commit();
    assert.equal(h.overlay.dataset.stage, 'loading');
    h.clock.tick(60_000);
    assert.equal(h.overlay.dataset.stage, 'loading', 'a visual timer cannot prove the cancellation');
    assert.equal(h.$('#arp-cancel-close').disabled, true);
    ack.resolve({ tripLabel: '№trip_order-x', timeLabel: '10:15' });
    await flush();
    assert.equal(h.overlay.dataset.stage, 'canceled');
    assert.match(h.$('#arp-cancel-done-meta').textContent, /отменено в 10:15/);
    assert.equal(calls.length, 1);
  });

  await check('a retryable refusal returns to the form with an alert and allows a deliberate retry', async () => {
    let calls = 0;
    const h = passengerSheetHarness({ onConfirm: () => {
      calls += 1;
      return calls === 1
        ? Promise.reject({ code: 'NETWORK', final: false, userMessage: '' })
        : Promise.resolve({ tripLabel: '№trip_order-x', timeLabel: '10:16' });
    } });
    await h.pick('driver_far');
    await h.commit();
    await flush();
    assert.equal(h.overlay.dataset.stage, 'reason_selected');
    const alert = h.$('#arp-cancel-request-error');
    assert.equal(alert.getAttribute('role'), 'alert');
    assert.equal(alert.hidden, false);
    assert.match(alert.textContent, /не подтверждена/i);
    assert.equal(h.$('#arp-cancel-confirm').disabled, false);
    assert.equal(h.$('.passenger-cancel-sheet__reason[data-reason-id="driver_far"]').getAttribute('aria-checked'), 'true');
    await h.commit();
    assert.equal(alert.hidden, true, 'the old verdict is cleared when a new attempt starts');
    await flush();
    assert.equal(calls, 2);
    assert.equal(h.overlay.dataset.stage, 'canceled');
  });

  await check('a final refusal shows the server verdict and keeps both commit buttons off', async () => {
    let calls = 0;
    const h = passengerSheetHarness({ onConfirm: () => {
      calls += 1;
      return Promise.reject({ code: 'ORDER_LIFECYCLE_MISMATCH', final: true,
        userMessage: mockApi.ORDER_LIFECYCLE_MISMATCH_TEXT });
    } });
    await h.pick('route_error');
    await h.commit();
    await flush();
    assert.equal(h.$('#arp-cancel-request-error').textContent, mockApi.ORDER_LIFECYCLE_MISMATCH_TEXT);
    assert.equal(h.$('#arp-cancel-confirm').disabled, true);
    assert.equal(h.$('#arp-cancel-confirm-yes').disabled, true);
    await h.$('#arp-cancel-confirm').fire();
    assert.notEqual(h.overlay.dataset.stage, 'confirm');
    assert.equal(calls, 1);
    await h.$('#arp-cancel-back').fire();
    assert.equal(h.overlay.isConnected, false, 'the way back to the ride stays open');
  });

  await check('a refusal while the screen blocks mutations does not re-enable commit', async () => {
    const h = passengerSheetHarness({
      onConfirm: () => Promise.reject({ code: 'NETWORK', final: false }),
      canCommit: () => false,
    });
    await h.pick('changed_mind');
    await h.commit();
    await flush();
    assert.equal(h.$('#arp-cancel-confirm').disabled, true);
  });

  await check('the comment field belongs to «Другая причина» only, and only it sends a comment', async () => {
    const calls = [];
    const h = passengerSheetHarness({ onConfirm: (...args) => { calls.push(args); return new Promise(() => {}); } });
    await h.pick('changed_mind');
    assert.equal(h.overlay.dataset.custom, 'false');
    h.$('#arp-cancel-comment').value = 'typed before switching';
    await h.commit();
    assert.deepEqual(calls[0], ['changed_mind', '']);
    assert.equal(h.$('#arp-cancel-comment').getAttribute('maxlength'), '500');
    const other = passengerSheetHarness({ onConfirm: (...args) => { calls.push(args); return new Promise(() => {}); } });
    await other.pick('other');
    assert.equal(other.overlay.dataset.custom, 'true');
    other.$('#arp-cancel-comment').value = '  Late for a meeting  ';
    await other.commit();
    assert.deepEqual(calls[1], ['other', 'Late for a meeting']);
  });

  await check('a screen abort closes the sheet without a canceled card', async () => {
    const h = passengerSheetHarness({ onConfirm: () => Promise.resolve({ aborted: true, reconcile: 'server-refused' }) });
    await h.pick('changed_mind');
    await h.commit();
    await flush();
    assert.equal(h.overlay.isConnected, false);
    assert.notEqual(h.overlay.dataset.stage, 'canceled');
  });

  await check('backend OFF keeps the synchronous local card after the brief delay', async () => {
    const h = passengerSheetHarness({ onConfirm: () => ({ tripLabel: '№local', timeLabel: '09:00' }) });
    await h.pick('cannot_leave');
    await h.commit();
    assert.equal(h.overlay.dataset.stage, 'loading');
    h.clock.tick(600);
    assert.equal(h.overlay.dataset.stage, 'canceled');
    assert.match(h.$('#arp-cancel-done-meta').textContent, /№local · отменено в 09:00/);
  });
}

// ── B. Passenger server cancel command (#1050) ────────────────────────────────
const TRIP_ID = 'trip_order-lifecycle';
const CANCELED_AT = '2026-10-21T19:15:00.000Z';
const canceledRide = (by = 'passenger', reason = 'changed_mind') => ({
  tripId: TRIP_ID, status: 'CANCELED', cancel: { by, reason }, timestamps: { canceledAt: CANCELED_AT },
});

function serverCancelHarness() {
  const clock = makeClock();
  const calls = { patch: [], persist: [], url: [], teardown: 0, swap: [], toasts: [] };
  const patchQueue = [];
  const context = vm.createContext({
    console, AbortController, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    RIDE_STATUS, ORDER_LIFECYCLE_MISMATCH: mockApi.ORDER_LIFECYCLE_MISMATCH,
    ORDER_LIFECYCLE_MISMATCH_TEXT: mockApi.ORDER_LIFECYCLE_MISMATCH_TEXT,
    PASSENGER_RIDE_POLL_TIMEOUT_MS: 12_000,
    ride: { tripId: TRIP_ID, status: 'DRIVER_EN_ROUTE' }, tripLabel: `№${TRIP_ID}`,
    deferredPassengerServerStatus: 'CANCELED',
    root: {}, document: { body: { contains: () => true } },
    patchRideStatus: (...args) => {
      calls.patch.push(args);
      assert.ok(patchQueue.length, 'unexpected PATCH');
      return patchQueue.shift()(...args);
    },
    // The real projection/persist pair is pinned by the passenger terminal smokes;
    // here only its call order and gating matter.
    projectPassengerServerConfirmedTerminalRide: (srv, tripId) => (srv && srv.tripId === tripId
      && ['CANCELED', 'COMPLETED', 'NO_SHOW'].includes(srv.status) ? { ...srv } : null),
    persistPassengerServerConfirmedTerminalProjection: (...args) => calls.persist.push(args),
    syncTerminalStatusIntoUrl: (status) => calls.url.push(status),
    teardownPassengerReads: () => { calls.teardown += 1; },
    swapToTerminalPassengerScreen: (terminal) => calls.swap.push(terminal),
    toast: (message) => calls.toasts.push(message),
  });
  vm.runInContext([
    sourceFunction(passengerSource, 'formatCanceledAt'),
    sourceFunction(passengerSource, 'passengerCancelFailure'),
    sourceFunction(passengerSource, 'commitPassengerServerCancel'),
    'globalThis.api = { commit: commitPassengerServerCancel, inspect: () => ({ ride, deferredPassengerServerStatus }) };',
  ].join('\n'), context, { filename: 'actual_passenger_server_cancel.js' });
  return { api: context.api, calls, clock, patchQueue };
}

async function serverCancelChecks() {
  await check('the PATCH carries the chosen reason and nothing terminal is written before the answer', async () => {
    const h = serverCancelHarness();
    const ack = deferred();
    h.patchQueue.push(() => ack.promise);
    const attempt = observe(h.api.commit('changed_mind', 'not for this reason'));
    await flush();
    assert.equal(h.calls.patch.length, 1);
    const [tripId, status, opts] = h.calls.patch[0];
    assert.equal(tripId, TRIP_ID);
    assert.equal(status, 'CANCELED');
    assert.deepEqual(JSON.parse(JSON.stringify(opts.cancel)), { reason: 'changed_mind' });
    assert.ok(opts.signal, 'the request is abortable');
    assert.equal(h.calls.persist.length, 0);
    assert.equal(h.calls.teardown, 0);
    ack.resolve(canceledRide());
    const { value, error } = await attempt;
    assert.equal(error, null);
    assert.equal(value.tripLabel, `№${TRIP_ID}`);
    assert.match(value.timeLabel, /^\d\d:\d\d$/);
    assert.equal(h.calls.persist.length, 1);
    assert.equal(h.calls.persist[0][1], TRIP_ID);
    assert.deepEqual(h.calls.url, ['CANCELED']);
    assert.equal(h.calls.teardown, 1, 'reads stop so a deferred poll cannot navigate over the card');
    assert.equal(h.api.inspect().deferredPassengerServerStatus, null);
    assert.equal(h.api.inspect().ride.status, 'CANCELED');
    assert.equal(h.calls.swap.length, 0);
    assert.equal(h.clock.pending, 0);
  });

  await check('«Другая причина» sends its comment; the server body never carries an empty one', async () => {
    const h = serverCancelHarness();
    h.patchQueue.push(() => Promise.resolve(canceledRide('passenger', 'other')));
    await h.api.commit('other', 'Late for a meeting');
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls.patch[0][2].cancel)), { reason: 'other', comment: 'Late for a meeting' });
    const blank = serverCancelHarness();
    blank.patchQueue.push(() => Promise.resolve(canceledRide('passenger', 'other')));
    await blank.api.commit('other', '');
    assert.deepEqual(JSON.parse(JSON.stringify(blank.calls.patch[0][2].cancel)), { reason: 'other' });
  });

  await check('a network failure writes nothing and is a retryable verdict', async () => {
    const h = serverCancelHarness();
    h.patchQueue.push(() => Promise.reject(problem('NETWORK')));
    const { error } = await observe(h.api.commit('driver_far', ''));
    assert.equal(error.final, false);
    assert.equal(error.userMessage, '');
    assert.equal(h.calls.persist.length, 0);
    assert.equal(h.calls.teardown, 0);
    assert.equal(h.api.inspect().ride.status, 'DRIVER_EN_ROUTE');
  });

  await check('an unanswered PATCH is aborted at the deadline and stays retryable', async () => {
    const h = serverCancelHarness();
    h.patchQueue.push((_trip, _status, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(problem('ABORTED')), { once: true });
    }));
    const attempt = observe(h.api.commit('changed_mind', ''));
    await flush();
    h.clock.tick(12_000);
    const { error } = await attempt;
    assert.equal(error.final, false);
    assert.equal(h.calls.persist.length, 0);
  });

  await check('ORDER_LIFECYCLE_MISMATCH is final and names the mismatch', async () => {
    const h = serverCancelHarness();
    h.patchQueue.push(() => Promise.reject(problem('ORDER_LIFECYCLE_MISMATCH', 409)));
    const { error } = await observe(h.api.commit('changed_mind', ''));
    assert.equal(error.final, true);
    assert.equal(error.userMessage, mockApi.ORDER_LIFECYCLE_MISMATCH_TEXT);
    assert.equal(h.calls.persist.length, 0);
  });

  await check('another definitive 4xx is shown as a refusal, not a connection problem', async () => {
    const h = serverCancelHarness();
    h.patchQueue.push(() => Promise.reject(problem('FORBIDDEN', 403)));
    const { error } = await observe(h.api.commit('changed_mind', ''));
    assert.equal(error.final, false);
    assert.match(error.userMessage, /отклонил/);
  });

  for (const code of ['RIDE_TERMINAL', 'RIDE_TRANSITION_NOT_ALLOWED']) {
    await check(`${code} closes the sheet for reconciliation without a local write`, async () => {
      const h = serverCancelHarness();
      h.patchQueue.push(() => Promise.reject(problem(code, 409)));
      const { value, error } = await observe(h.api.commit('changed_mind', ''));
      assert.equal(error, null);
      assert.equal(value.aborted, true);
      assert.equal(h.calls.toasts.length, 1);
      assert.equal(h.calls.persist.length, 0);
      assert.equal(h.calls.teardown, 0, 'the poll keeps running to bring the server state');
    });
  }

  for (const [label, body] of [
    ['an empty body', null],
    ['an active snapshot', { tripId: TRIP_ID, status: 'DRIVER_EN_ROUTE' }],
    ['a foreign trip', { ...canceledRide(), tripId: 'trip_order-other' }],
    ['a different terminal', { ...canceledRide(), status: 'COMPLETED' }],
  ]) {
    await check(`an acknowledgement with ${label} is refused, nothing is persisted`, async () => {
      const h = serverCancelHarness();
      h.patchQueue.push(() => Promise.resolve(body));
      const { error } = await observe(h.api.commit('changed_mind', ''));
      assert.ok(error);
      assert.equal(error.final, false);
      assert.equal(h.calls.persist.length, 0);
      assert.equal(h.calls.teardown, 0);
    });
  }

  await check('when the driver canceled first, the passenger sees the driver-canceled screen', async () => {
    const h = serverCancelHarness();
    h.patchQueue.push(() => Promise.resolve(canceledRide('driver', 'car_problem')));
    const { value } = await observe(h.api.commit('changed_mind', ''));
    assert.equal(value.aborted, true);
    assert.equal(h.calls.persist.length, 1, 'the server truth is still persisted');
    await flush();
    assert.equal(h.calls.swap.length, 1);
    assert.equal(h.calls.swap[0].cancel.by, 'driver');
  });

  await check('source: a server-backed confirm goes to the server first; no fire-and-forget cancel PATCH remains', async () => {
    const binder = sourceFunction(passengerSource, 'bindCancelAffordance');
    const serverFirst = binder.indexOf('if (backendWriteCandidate) return commitPassengerServerCancel(reasonId, comment);');
    assert.ok(serverFirst > 0);
    assert.ok(serverFirst < binder.indexOf('saveActiveRide(ride)'));
    assert.ok(binder.indexOf('deferredTerminalPassengerStatusBlocksCancel()') < serverFirst);
    assert.doesNotMatch(passengerSource, /patchRideStatus\([^)]*RIDE_STATUS\.CANCELED[^)]*\)\s*\.catch\(/);
  });
}

// ── C. cancelOrderOnBackend seam (#1049) ──────────────────────────────────────
function seedOrder(status = 'CREATED') {
  storage.clear();
  storage.set(ORDERS_KEY, JSON.stringify([{ id: 'order-x', status, pickup: { label: 'A' }, dropoff: { label: 'B' } }]));
}
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

async function seamChecks() {
  await check('backend OFF: no request, no local change', async () => {
    seedOrder();
    delete globalThis.__BD_API_BASE__;
    globalThis.fetch = () => { throw new Error('fetch must not run while OFF'); };
    assert.equal(await mockApi.cancelOrderOnBackend('order-x'), null);
    assert.equal(mockApi.getOrderById('order-x').status, 'CREATED');
  });

  await check('ON: POST /orders/:id/cancel, and only a confirmed CANCELED order moves the local copy', async () => {
    seedOrder();
    globalThis.__BD_API_BASE__ = 'https://api.fixture.invalid';
    let captured = null;
    globalThis.fetch = async (url, opts) => {
      captured = { url, method: opts.method, body: opts.body };
      return response(200, { order: { id: 'order-x', status: 'CANCELED' } });
    };
    const order = await mockApi.cancelOrderOnBackend('order-x');
    assert.equal(order.status, 'CANCELED');
    assert.equal(captured.url, 'https://api.fixture.invalid/api/v1/orders/order-x/cancel');
    assert.equal(captured.method, 'POST');
    assert.equal(captured.body, undefined);
    assert.equal(mockApi.getOrderById('order-x').status, 'CANCELED');
  });

  for (const [label, status, body, code] of [
    ['409 ORDER_NOT_CANCELABLE', 409, { error: 'x', code: 'ORDER_NOT_CANCELABLE', retryable: false }, 'ORDER_NOT_CANCELABLE'],
    ['403 PASSENGER_ROLE_REQUIRED', 403, { error: 'x', code: 'PASSENGER_ROLE_REQUIRED', retryable: false }, 'PASSENGER_ROLE_REQUIRED'],
    ['a 200 that is not CANCELED', 200, { order: { id: 'order-x', status: 'CREATED' } }, 'BAD_RESPONSE'],
  ]) {
    await check(`ON: ${label} rejects and leaves the local copy CREATED`, async () => {
      seedOrder();
      globalThis.__BD_API_BASE__ = 'https://api.fixture.invalid';
      globalThis.fetch = async () => response(status, body);
      const { error } = await observe(mockApi.cancelOrderOnBackend('order-x'));
      assert.equal(error?.code, code);
      assert.equal(mockApi.getOrderById('order-x').status, 'CREATED');
    });
  }
  delete globalThis.__BD_API_BASE__;
  delete globalThis.fetch;
}

// ── D. /responses order cancel controller (#1049) ─────────────────────────────
function responsesHarness(overrides = {}) {
  const calls = { cancel: [], renders: 0, offers: 0, navigation: [] };
  let cancelImpl = () => Promise.resolve({ id: 'order-x', status: 'CANCELED' });
  const orderCancelEl = new FakeElement('div');
  orderCancelEl._attached = true;
  const context = vm.createContext({
    console, escapeHtml, CLOSE_SVG: '',
    PROFILE_CTA_LABEL: roleGate.PROFILE_CTA_LABEL, ROLE_GATE_TEXT: roleGate.ROLE_GATE_TEXT,
    PASSENGER_ROLE_REQUIRED: roleGate.PASSENGER_ROLE_REQUIRED, roleGateCode: roleGate.roleGateCode,
    ORDER_NOT_CANCELABLE: mockApi.ORDER_NOT_CANCELABLE,
    backendAuthoritative: true, fixture: '', isAccepted: false, readState: 'empty', effectiveState: 'empty',
    canonicalOrder: { id: 'order-x', status: 'CREATED', pickup: { label: 'A' }, dropoff: { label: 'B' }, estimatedPrice: 900 },
    request: { orderId: 'order-x' },
    drivers: [{ id: 'd1' }], selectedDriver: null, selectedDriverId: null,
    orderCancelEl, orderCancelStage: 'idle', orderCancelPending: false, offersReadRunId: 3,
    root: {}, readRegion: { focus() {} },
    document: { body: { contains: () => true } },
    cancelOrderOnBackend: (...args) => { calls.cancel.push(args); return cancelImpl(...args); },
    resolveCanonicalOrder: () => ({ id: 'order-x', status: 'CANCELED' }),
    renderReadRegion: () => { calls.renders += 1; },
    loadServerOffers: () => { calls.offers += 1; return Promise.resolve(); },
    go: (path) => calls.navigation.push(path),
    ...overrides,
  });
  vm.runInContext([
    sourceConst(responsesSource, 'ORDER_CANCEL_QUESTION'),
    sourceFunction(responsesSource, 'renderOrderCancelHtml'),
    sourceFunction(responsesSource, 'renderOrderCanceledState'),
    sourceFunction(responsesSource, 'orderCancelable'),
    sourceFunction(responsesSource, 'renderOrderCancel'),
    sourceFunction(responsesSource, 'syncOrderCancel'),
    sourceFunction(responsesSource, 'focusOrderCancel'),
    sourceFunction(responsesSource, 'cancelOrder'),
    `globalThis.api = {
      cancelable: orderCancelable, cancel: cancelOrder, render: renderOrderCancel, sync: syncOrderCancel,
      html: renderOrderCancelHtml, canceledHtml: renderOrderCanceledState,
      inspect: () => ({ readState, effectiveState, offersReadRunId, orderCancelPending, orderCancelStage, drivers }),
    };`,
  ].join('\n'), context, { filename: 'actual_responses_order_cancel.js' });
  return {
    api: context.api, context, calls, el: orderCancelEl,
    failWith: (error) => { cancelImpl = () => Promise.reject(error); },
    hold: () => { const d = deferred(); cancelImpl = () => d.promise; return d; },
  };
}

async function responsesChecks() {
  await check('cancel is offered only for the owner\'s CREATED order without a driver, backend ON', async () => {
    assert.equal(responsesHarness().api.cancelable(), true);
    for (const [label, override] of [
      ['backend OFF', { backendAuthoritative: false }],
      ['fixture preview', { fixture: 'loaded' }],
      ['no local order copy', { canonicalOrder: null }],
      ['order ACCEPTED', { canonicalOrder: { id: 'order-x', status: 'ACCEPTED' } }],
      ['order CANCELED', { canonicalOrder: { id: 'order-x', status: 'CANCELED' } }],
      ['driver handed off', { isAccepted: true }],
      ['driver-mode role gate', { readState: 'role-gate' }],
      ['already canceled', { readState: 'canceled' }],
    ]) {
      assert.equal(responsesHarness(override).api.cancelable(), false, label);
    }
  });

  await check('the first tap only asks; the inline confirm names what happens to the offers', async () => {
    const h = responsesHarness();
    const idle = h.api.html('idle');
    assert.match(idle, /data-order-action="ask-cancel"[^>]*>Отменить заказ</);
    assert.doesNotMatch(idle, /confirm-cancel/);
    const ask = h.api.html('confirm');
    assert.match(ask, /отклики будут отклонены/);
    assert.match(ask, /data-order-action="keep"/);
    assert.match(ask, /data-order-action="confirm-cancel"[^>]*>Да, отменить заказ</);
    const pending = h.api.html('pending');
    assert.equal((pending.match(/ disabled aria-disabled="true"/g) || []).length, 2);
    assert.match(pending, /Отменяем…/);
    const wiring = responsesSource.slice(responsesSource.indexOf("orderCancelEl.addEventListener('click'"));
    assert.match(wiring, /action === 'ask-cancel'\)\s*\{\s*renderOrderCancel\('confirm'\)/);
    assert.equal((wiring.slice(0, wiring.indexOf('readRegion?.addEventListener')).match(/cancelOrder\(\)/g) || []).length, 1);
    assert.match(wiring, /action === 'confirm-cancel'\)\s*\{\s*void cancelOrder\(\)/);
  });

  await check('success settles «Заказ отменён» and fences a late offers read', async () => {
    const h = responsesHarness();
    await h.api.cancel();
    assert.deepEqual(h.calls.cancel, [['order-x']]);
    const state = h.api.inspect();
    assert.equal(state.readState, 'canceled');
    assert.equal(state.effectiveState, 'canceled');
    assert.equal(state.offersReadRunId, 4);
    assert.equal(state.drivers.length, 0);
    assert.equal(state.orderCancelPending, false);
    assert.equal(h.calls.renders, 1);
    const canceled = h.api.canceledHtml(true);
    assert.match(canceled, /Заказ отменён/);
    assert.match(canceled, /data-order-action="recreate"/);
    assert.doesNotMatch(h.api.canceledHtml(false), /recreate/);
  });

  await check('a second confirm while the request is in flight is ignored', async () => {
    const h = responsesHarness();
    const held = h.hold();
    const first = h.api.cancel();
    const second = h.api.cancel();
    assert.equal(h.calls.cancel.length, 1);
    assert.match(h.el.innerHTML, /Отменяем…/);
    held.resolve({ id: 'order-x', status: 'CANCELED' });
    await Promise.all([first, second]);
    assert.equal(h.calls.cancel.length, 1);
  });

  await check('403 PASSENGER_ROLE_REQUIRED shows the role-gate copy with the profile way out, no retry', async () => {
    const h = responsesHarness();
    h.failWith(problem('PASSENGER_ROLE_REQUIRED', 403));
    await h.api.cancel();
    assert.equal(h.el.dataset.stage, 'error');
    assert.match(h.el.innerHTML, new RegExp(roleGate.ROLE_GATE_TEXT.orderCancel));
    assert.match(h.el.innerHTML, /data-order-action="open-profile"/);
    assert.doesNotMatch(h.el.innerHTML, /confirm-cancel/);
    assert.equal(h.api.inspect().readState, 'empty');
  });

  await check('409 ORDER_NOT_CANCELABLE explains the driver and re-reads the board, no retry', async () => {
    const h = responsesHarness();
    h.failWith(problem('ORDER_NOT_CANCELABLE', 409));
    await h.api.cancel();
    assert.match(h.el.innerHTML, /уже есть водитель/);
    assert.doesNotMatch(h.el.innerHTML, /confirm-cancel/);
    assert.equal(h.calls.offers, 1);
    assert.equal(h.api.inspect().readState, 'empty');
  });

  await check('a connection failure keeps the order and offers a retry', async () => {
    const h = responsesHarness();
    h.failWith(problem('NETWORK'));
    await h.api.cancel();
    assert.match(h.el.innerHTML, /role="alert"/);
    assert.match(h.el.innerHTML, /data-order-action="confirm-cancel"[^>]*>Повторить</);
    assert.equal(h.api.inspect().readState, 'empty');
    assert.equal(h.api.inspect().orderCancelPending, false);
  });

  await check('source: a canceled order skips the offers read on entry and after the cancel', async () => {
    assert.match(responsesSource, /const orderCanceledOnEntry = backendAuthoritative && !!canonicalOrder && canonicalOrder\.status === 'CANCELED';/);
    assert.match(responsesSource, /if \(!isAccepted && orderCanceledOnEntry\) \{\s*readState = 'canceled';/);
    assert.match(sourceFunction(responsesSource, 'loadServerOffers'), /readState === 'canceled'/);
  });
}

// ── E. «Водитель отменил поездку» → «Создать заказ заново» ─────────────────────
function fallbackHarness(ride, variant = 'canceled') {
  storage.clear();
  const navigation = [];
  const context = vm.createContext({
    console, escapeHtml, RIDE_STATUS,
    TRIP_NUMBER_FALLBACK: '№48-321', DEMO_ACTIVE_RIDE_ID: 'trip_moscow_sheremetyevo_demo',
    CHEVRON_UP_SVG: '', X_CIRCLE_SVG: '', PLUS_SVG: '',
    resolveRideStatusLabel: () => 'Пассажир не вышел',
    buildRepeatRouteDraft: repeatRoute.buildRepeatRouteDraft,
    writeRepeatRouteDraft: repeatRoute.writeRepeatRouteDraft,
    go: (path) => navigation.push(path),
    document: { createElement: (tag) => new FakeElement(tag) },
  });
  vm.runInContext([
    sourceFunction(passengerSource, 'formatTripNumber'),
    sourceFunction(passengerSource, 'formatCanceledAt'),
    sourceFunction(passengerSource, 'renderPassengerCanceledFallback'),
    'globalThis.render = renderPassengerCanceledFallback;',
  ].join('\n'), context, { filename: 'actual_passenger_canceled_fallback.js' });
  const root = context.render(ride, variant);
  return { root, navigation, $: (selector) => root.querySelector(selector) };
}

const driverCanceled = (route = { pickupLabel: 'Ленина, 1', dropoffLabel: 'Аэропорт' }) => ({
  tripId: TRIP_ID, status: 'CANCELED', cancel: { by: 'driver', reason: 'car_problem' },
  route, order: { offerPrice: '850 ₽' }, timestamps: { canceledAt: CANCELED_AT },
});

async function fallbackChecks() {
  await check('driver cancel: «Водитель отменил поездку» and «Создать заказ заново» with the same route and price', async () => {
    const h = fallbackHarness(driverCanceled());
    assert.equal(h.$('.passenger-cancel-fallback__title').textContent, 'Водитель отменил поездку');
    assert.match(h.$('.passenger-cancel-fallback__text').textContent, /Водитель отменил эту поездку/);
    assert.match(h.$('#arp-canceled-new').textContent, /Создать заказ заново/);
    await h.$('#arp-canceled-new').fire();
    assert.deepEqual(h.navigation, ['/new']);
    assert.deepEqual(JSON.parse(storage.get(REPEAT_ROUTE_KEY)),
      { role: 'passenger', pickup: 'Ленина, 1', dropoff: 'Аэропорт', suggestedFare: 850 });
  });

  await check('driver cancel without addresses: a plain new order, no stale prefill', async () => {
    const h = fallbackHarness(driverCanceled({ pickupLabel: null, dropoffLabel: null }));
    assert.match(h.$('#arp-canceled-new').textContent, /Создать новую поездку/);
    await h.$('#arp-canceled-new').fire();
    assert.deepEqual(h.navigation, ['/new']);
    assert.equal(storage.has(REPEAT_ROUTE_KEY), false);
  });

  await check('passenger cancel keeps its own copy and writes no prefill', async () => {
    const h = fallbackHarness({ ...driverCanceled(), cancel: { by: 'passenger', reason: 'changed_mind' } });
    assert.equal(h.$('.passenger-cancel-fallback__title').textContent, 'Поездка отменена');
    assert.match(h.$('#arp-canceled-new').textContent, /Создать новую поездку/);
    await h.$('#arp-canceled-new').fire();
    assert.equal(storage.has(REPEAT_ROUTE_KEY), false);
  });

  await check('no-show keeps no primary action', async () => {
    const h = fallbackHarness({ ...driverCanceled(), status: 'NO_SHOW' }, 'no_show');
    assert.equal(h.$('#arp-canceled-new'), null);
  });
}

await sheetChecks();
await serverCancelChecks();
await seamChecks();
await responsesChecks();
await fallbackChecks();

console.log(`\n${passed} passed; ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
