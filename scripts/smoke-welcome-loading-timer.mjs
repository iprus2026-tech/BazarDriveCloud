// BD-ONBOARDING-02 — Welcome render smoke + loading timer guard.
//
// The Welcome render gate uses an internal state machine and a UI-only
// setTimeout(..., 1200) transition. This smoke pins the surface markers and
// the stale-timer invariant: once a user leaves /welcome, an old loading timer
// cannot persist welcomeSeen, consume a pending router action, or override the
// newer route.

import fs from 'node:fs';
import path from 'node:path';

// ── localStorage / sessionStorage stubs ──────────────────────────────────────
const local = new Map();
const session = new Map();

globalThis.localStorage = {
  getItem: (k) => (local.has(k) ? local.get(k) : null),
  setItem: (k, v) => local.set(k, String(v)),
  removeItem: (k) => local.delete(k),
  clear: () => local.clear(),
};

globalThis.sessionStorage = {
  getItem: (k) => (session.has(k) ? session.get(k) : null),
  setItem: (k, v) => session.set(k, String(v)),
  removeItem: (k) => session.delete(k),
  clear: () => session.clear(),
};

// ── Hash spy ────────────────────────────────────────────────────────────────
let currentHash = '#/welcome';
const locationStub = {};
Object.defineProperty(locationStub, 'hash', {
  configurable: true,
  get: () => currentHash,
  set: (v) => {
    currentHash = typeof v === 'string' && v.startsWith('#') ? v : '#' + String(v);
  },
});

// ── Timer capture ───────────────────────────────────────────────────────────
let nextTimerId = 1;
const timers = new Map();

globalThis.setTimeout = (fn, delay) => {
  const id = nextTimerId++;
  timers.set(id, { fn, delay, cleared: false });
  return id;
};

globalThis.clearTimeout = (id) => {
  const timer = timers.get(id);
  if (timer) timer.cleared = true;
};

function pendingTimers() {
  return Array.from(timers.values()).filter((t) => !t.cleared);
}

function fireOnlyTimer() {
  const live = pendingTimers();
  expect('one live loading timer is scheduled', live.length === 1, `count=${live.length}`);
  expect('loading timer delay stays 1200ms', live[0]?.delay === 1200, `delay=${live[0]?.delay}`);
  live[0]?.fn();
}

// ── Minimal DOM stub ────────────────────────────────────────────────────────
const clickHandlers = new Map();

function makeEl(selectorHint) {
  const el = {
    _html: '',
    _selector: selectorHint || null,
    className: '',
    textContent: '',
    value: '',
    checked: false,
    hidden: false,
    disabled: false,
    dataset: {},
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    set innerHTML(v) { this._html = String(v); },
    get innerHTML() { return this._html; },
    get firstElementChild() { return makeEl(); },
    addEventListener(type, fn) {
      if (type === 'click' && this._selector && typeof fn === 'function') {
        clickHandlers.set(this._selector, fn);
      }
    },
    removeEventListener() {},
    querySelector(sel) { return makeEl(sel); },
    querySelectorAll(sel) {
      if (sel === '[data-ob-role]') {
        const passenger = makeEl('role:passenger');
        passenger.dataset.obRole = 'passenger';
        const driver = makeEl('role:driver');
        driver.dataset.obRole = 'driver';
        return [passenger, driver];
      }
      return [];
    },
    closest() { return null; },
    contains() { return false; },
    appendChild(x) { return x; },
    removeChild() {},
    replaceWith() {},
    remove() {},
    setAttribute() {},
    getAttribute() { return null; },
    scrollIntoView() {},
    focus() {},
    blur() {},
    click() {},
  };
  return el;
}

globalThis.window = {
  location: locationStub,
  addEventListener() {},
  removeEventListener() {},
};
globalThis.location = locationStub;
globalThis.document = {
  createElement: () => makeEl(),
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => makeEl(),
};

// ── Imports after stubs ─────────────────────────────────────────────────────
const { user } = await import('../public/src/state.js');
const { setPendingAction, consumePendingAction, go } = await import('../public/src/router.js');
const welcome = (await import('../public/src/screens/welcome.js')).default;

// ── Test helpers ────────────────────────────────────────────────────────────
const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ` (${detail})` : ''));
  if (!cond) issues.push(label + (detail ? ` :: ${detail}` : ''));
}

function reset(hash = '#/welcome') {
  local.clear();
  session.clear();
  user.reset();
  clickHandlers.clear();
  timers.clear();
  nextTimerId = 1;
  currentHash = hash;
  setPendingAction(null);
}

function render(hash) {
  reset(hash);
  return welcome().innerHTML;
}

function click(key) {
  const fn = clickHandlers.get(key);
  expect(`click handler exists for ${key}`, typeof fn === 'function');
  if (typeof fn === 'function') fn();
}

function runPassengerFlowToLoading() {
  currentHash = '#/welcome';
  const section = welcome();
  expect('flow starts on welcome state', section.innerHTML.includes('data-ob-step="welcome"'));
  click('#ob-start');
  expect('start advances to role state', section.innerHTML.includes('data-ob-step="role"'));
  click('role:passenger');
  expect('passenger role card becomes selected', section.innerHTML.includes('ob-role-card--selected'));
  click('#ob-role-continue');
  expect('role continue advances to permissions state', section.innerHTML.includes('data-ob-step="permissions"'));
  click('#ob-perm-later');
  expect('permissions action advances to loading state', section.innerHTML.includes('data-ob-step="loading"'));
  return section;
}

function runDriverFlowToLoading() {
  currentHash = '#/welcome';
  const section = welcome();
  click('#ob-start');
  click('role:driver');
  click('#ob-role-continue');
  click('#ob-perm-continue');
  expect('driver permissions action advances to loading state', section.innerHTML.includes('data-ob-step="loading"'));
  return section;
}

// ── Render-gate preview states ──────────────────────────────────────────────
{
  const html = render('#/welcome');
  expect('S1: /welcome renders the welcome state', html.includes('data-ob-step="welcome"'));
  expect('S1: welcome state exposes start action', html.includes('data-ob-action="start"'));
}

{
  const html = render('#/welcome?step=role');
  expect('S2: ?step=role renders the role state', html.includes('data-ob-step="role"'));
  expect('S2: role state exposes passenger card', html.includes('data-ob-role="passenger"'));
  expect('S2: role state exposes driver card', html.includes('data-ob-role="driver"'));
  expect('S2: role continue is disabled until pick', html.includes('id="ob-role-continue"') && html.includes('disabled aria-disabled="true"'));
}

{
  const html = render('#/welcome?step=permissions');
  expect('S3: ?step=permissions renders permissions state', html.includes('data-ob-step="permissions"'));
  expect('S3: permissions exposes continue action', html.includes('data-ob-action="perm-continue"'));
  expect('S3: permissions exposes later action', html.includes('data-ob-action="perm-later"'));
}

{
  const html = render('#/welcome?step=loading');
  expect('S4: ?step=loading renders loading state', html.includes('data-ob-step="loading"'));
  expect('S4: loading preview does not schedule timer', pendingTimers().length === 0, `timers=${pendingTimers().length}`);
  expect('S4: loading preview does not persist welcomeSeen', user.get().welcomeSeen === false);
  expect('S4: loading preview does not auto-route', currentHash === '#/welcome?step=loading', `hash=${currentHash}`);
}

{
  const html = render('#/welcome?step=error');
  expect('S5: ?step=error renders error state', html.includes('data-ob-step="error"'));
  expect('S5: error exposes retry action', html.includes('data-ob-action="retry"'));
}

// ── Valid loading flows ─────────────────────────────────────────────────────
reset('#/welcome');
runPassengerFlowToLoading();
fireOnlyTimer();
{
  const u = user.get();
  expect('S6: passenger timer stamps welcomeSeen', u.welcomeSeen === true);
  expect('S6: passenger timer persists passenger role', u.role === 'passenger', `role=${u.role}`);
  expect('S6: passenger timer routes to /feed', currentHash === '#/feed', `hash=${currentHash}`);
}

reset('#/welcome');
runDriverFlowToLoading();
fireOnlyTimer();
{
  const u = user.get();
  expect('S7: driver timer stamps welcomeSeen', u.welcomeSeen === true);
  expect('S7: driver timer persists driver role', u.role === 'driver', `role=${u.role}`);
  expect('S7: driver timer routes to /driver-map', currentHash === '#/driver-map', `hash=${currentHash}`);
  expect('S7: permissions continue keeps notifications enabled', u.notificationsEnabled === true);
}

// ── Pending action remains honoured for the current loading run ──────────────
reset('#/welcome');
let pendingRan = false;
setPendingAction(() => {
  pendingRan = true;
  go('/new');
});
runPassengerFlowToLoading();
fireOnlyTimer();
expect('S8: valid timer consumes and runs pending action', pendingRan === true);
expect('S8: pending action route wins over role default', currentHash === '#/new', `hash=${currentHash}`);

// ── Stale loading timer guard ────────────────────────────────────────────────
reset('#/welcome');
pendingRan = false;
setPendingAction(() => {
  pendingRan = true;
  go('/new');
});
runPassengerFlowToLoading();
currentHash = '#/feed';
fireOnlyTimer();
{
  const u = user.get();
  expect('S9: stale timer does not stamp welcomeSeen', u.welcomeSeen === false);
  expect('S9: stale timer does not persist role', u.role === null, `role=${u.role}`);
  expect('S9: stale timer does not consume pending action', pendingRan === false);
  const pending = consumePendingAction();
  expect('S9: pending action remains queued after stale timer', typeof pending === 'function');
  setPendingAction(null);
  expect('S9: stale timer does not override newer route', currentHash === '#/feed', `hash=${currentHash}`);
}

// ── Static no-network / no-real-permission guard ────────────────────────────
{
  const src = fs.readFileSync(path.join(process.cwd(), 'public', 'src', 'screens', 'welcome.js'), 'utf8');
  expect('S10: welcome.js contains the loading route-active guard', /isWelcomeRouteActive\(\)/.test(src));
  expect('S10: welcome.js does not call fetch', !/\bfetch\s*\(/.test(src));
  expect('S10: welcome.js does not call geolocation API', !/navigator\.geolocation/.test(src));
  expect('S10: welcome.js does not call Notification.requestPermission', !/Notification\.requestPermission/.test(src));
  expect('S10: welcome.js does not reference Mapbox', !/mapbox/i.test(src));
}

if (issues.length) {
  console.error('\nsmoke-welcome-loading-timer failed:');
  for (const issue of issues) console.error(' - ' + issue);
  process.exit(1);
}

console.log('\nsmoke-welcome-loading-timer passed.');
