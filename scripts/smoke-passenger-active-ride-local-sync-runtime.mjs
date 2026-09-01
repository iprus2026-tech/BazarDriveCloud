// BD-RIDE-P-LOCAL-SYNC-01 (#886/#887) — Passenger Active Ride LOCAL_ONLY
// reconciliation RUNTIME smoke.
//
// #886's own guard (scripts/smoke-passenger-active-ride-loading-states.mjs) is
// static: it inspects source text, it never actually mounts the screen, writes
// to the active-ride store, dispatches a 'storage' event, or clicks a button.
// This smoke is the real thing: it drives the ACTUAL router.js + active_ride.js +
// active_ride_passenger.js + active_ride_passenger_sheets.js modules against a
// minimal-but-real DOM (innerHTML parses into a live queryable tree; click()
// dispatches real listeners; MutationObserver + 'storage'/'hashchange' events
// behave like the browser primitives this code depends on) to prove the #887
// repair end-to-end: mounted-trip-identity stability across a terminal
// transition, and the queued-click cancel abort under a LOCAL_ONLY terminal race.
//
// Dependency-free: no jsdom, no browser, no backend. The DOM/selector engine
// below only supports the exact vocabulary these screen modules use (verified
// by grep before writing this smoke) — not general HTML/CSS.

import assert from 'node:assert/strict';

// ─────────────────────────────────────────────────────────────────────────
// ── Minimal DOM shim ────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────

let mutationObservers = [];
function notifyMutation(container) {
  for (const obs of mutationObservers) {
    if (obs.disconnected) continue;
    if (obs.target === container || (obs.options && obs.options.subtree && obs.target.contains(container))) {
      scheduleObserverFlush(obs);
    }
  }
}
function scheduleObserverFlush(obs) {
  if (obs._scheduled) return;
  obs._scheduled = true;
  queueMicrotask(() => {
    obs._scheduled = false;
    if (obs.disconnected) return;
    obs.callback([]);
  });
}
class BDMutationObserver {
  constructor(cb) {
    this.callback = cb;
    this.target = null;
    this.options = null;
    this.disconnected = false;
    this._scheduled = false;
  }
  observe(target, options) {
    this.target = target;
    this.options = options || {};
    this.disconnected = false;
    mutationObservers.push(this);
  }
  disconnect() {
    this.disconnected = true;
    mutationObservers = mutationObservers.filter((o) => o !== this);
  }
}

function camelToKebab(s) {
  return String(s).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}
function kebabToCamel(s) {
  return String(s).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

class BDText {
  constructor(text) {
    this.nodeType = 3;
    this.nodeValue = text;
    this.parentNode = null;
  }
  get textContent() { return this.nodeValue; }
  set textContent(v) { this.nodeValue = String(v); }
}

class BDElement {
  constructor(tagName) {
    this.nodeType = 1;
    this.tagName = String(tagName || 'div').toUpperCase();
    this._attrs = new Map();
    this._classes = new Set();
    this.childNodes = [];
    this.parentNode = null;
    this._listeners = new Map();
    this.hidden = false;
    this.value = '';
    const self = this;
    this.classList = {
      add(...names) { for (const n of names) self._classes.add(n); },
      remove(...names) { for (const n of names) self._classes.delete(n); },
      toggle(name, force) {
        const has = self._classes.has(name);
        const want = force === undefined ? !has : force;
        if (want) self._classes.add(name); else self._classes.delete(name);
        return want;
      },
      contains(name) { return self._classes.has(name); },
    };
    this.dataset = new Proxy({}, {
      get: (_, prop) => {
        const attr = 'data-' + camelToKebab(prop);
        return self._attrs.has(attr) ? self._attrs.get(attr) : undefined;
      },
      set: (_, prop, val) => {
        const attr = 'data-' + camelToKebab(prop);
        self._attrs.set(attr, String(val));
        return true;
      },
      deleteProperty: (_, prop) => {
        const attr = 'data-' + camelToKebab(prop);
        self._attrs.delete(attr);
        return true;
      },
      ownKeys: () => Array.from(self._attrs.keys())
        .filter((k) => k.startsWith('data-'))
        .map((k) => kebabToCamel(k.slice(5))),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    });
  }
  get className() { return Array.from(this._classes).join(' '); }
  set className(v) { this._classes = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get id() { return this._attrs.get('id') || ''; }
  set id(v) { this._attrs.set('id', String(v)); }
  getAttribute(name) { return this._attrs.has(name) ? this._attrs.get(name) : null; }
  setAttribute(name, value) {
    this._attrs.set(name, String(value));
    if (name === 'class') this.className = value;
    if (name === 'id') this._attrs.set('id', String(value));
  }
  hasAttribute(name) { return this._attrs.has(name); }
  removeAttribute(name) { this._attrs.delete(name); }
  get textContent() {
    let out = '';
    (function walk(n) {
      if (n.nodeType === 3) { out += n.nodeValue; return; }
      for (const c of n.childNodes) walk(c);
    })(this);
    return out;
  }
  set textContent(v) {
    this.childNodes = [];
    if (v !== '' && v != null) {
      const t = new BDText(String(v));
      t.parentNode = this;
      this.childNodes.push(t);
    }
    notifyMutation(this);
  }
  set innerHTML(html) {
    this.childNodes = parseHtmlFragment(String(html == null ? '' : html));
    for (const c of this.childNodes) c.parentNode = this;
    notifyMutation(this);
  }
  appendChild(node) {
    node.parentNode = this;
    this.childNodes.push(node);
    notifyMutation(this);
    return node;
  }
  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i !== -1) this.childNodes.splice(i, 1);
    node.parentNode = null;
    notifyMutation(this);
    return node;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...nodes) {
    this.childNodes = [];
    for (const n of nodes) { n.parentNode = this; this.childNodes.push(n); }
    notifyMutation(this);
  }
  replaceWith(node) {
    if (!this.parentNode) return;
    const p = this.parentNode;
    const i = p.childNodes.indexOf(this);
    if (i !== -1) {
      p.childNodes[i] = node;
      node.parentNode = p;
      this.parentNode = null;
      notifyMutation(p);
    }
  }
  contains(node) {
    let n = node;
    while (n) { if (n === this) return true; n = n.parentNode; }
    return false;
  }
  get isConnected() { return documentBodyRef ? documentBodyRef.contains(this) : false; }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    const set = this._listeners.get(type);
    if (set) set.delete(fn);
  }
  dispatchEvent(evt) {
    evt.target = evt.target || this;
    const set = this._listeners.get(evt.type);
    if (set) for (const fn of Array.from(set)) fn.call(this, evt);
    return true;
  }
  click() {
    this.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  }
  focus() { if (documentRef) documentRef.activeElement = this; }
  blur() { if (documentRef && documentRef.activeElement === this) documentRef.activeElement = null; }
  get offsetParent() { return this.hidden ? null : {}; }
  get ownerDocument() { return documentRef; }
  querySelector(sel) { return querySelectorImpl(this, sel, true); }
  querySelectorAll(sel) { return querySelectorImpl(this, sel, false); }
}
// `disabled` is a real reflected boolean attribute in the DOM (button.disabled = true
// also flips the `disabled` attribute) — overlay.js's trapFocus filters focusables via
// `button:not([disabled])`, so the property must reflect into the attribute set for
// that selector to behave correctly.
Object.defineProperty(BDElement.prototype, 'disabled', {
  get() { return this._attrs.has('disabled'); },
  set(v) { if (v) this._attrs.set('disabled', ''); else this._attrs.delete('disabled'); },
});

// ── mini HTML fragment parser ───────────────────────────────────────────
// Supports exactly what this codebase's template literals produce: nested
// tags, self-closing (`<x/>` or `<x />`) tags (all the inline SVG icons),
// quoted attributes, text nodes and HTML comments. No entity decoding beyond
// the handful escapeHtml()/escAttr() actually emit.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" };
function decodeEntities(s) {
  return s.replace(/&(#39|amp|lt|gt|quot|apos);/g, (_, name) => ENTITIES[name]);
}
function parseHtmlFragment(html) {
  const root = new BDElement('bd-fragment');
  const stack = [root];
  let i = 0;
  const len = html.length;
  while (i < len) {
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      i = end === -1 ? len : end + 3;
      continue;
    }
    if (html[i] === '<') {
      if (html[i + 1] === '/') {
        const end = html.indexOf('>', i);
        if (stack.length > 1) stack.pop();
        i = end === -1 ? len : end + 1;
        continue;
      }
      const end = html.indexOf('>', i);
      if (end === -1) { i = len; continue; }
      const tagSrc = html.slice(i + 1, end);
      const selfClose = /\/\s*$/.test(tagSrc);
      const body = selfClose ? tagSrc.slice(0, tagSrc.length - (tagSrc.match(/\/\s*$/)[0].length)) : tagSrc;
      const tagMatch = body.match(/^\s*([a-zA-Z][a-zA-Z0-9-]*)/);
      const tagName = tagMatch ? tagMatch[1] : 'div';
      const el = new BDElement(tagName);
      const attrRe = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)(?:\s*=\s*"([^"]*)"|\s*=\s*'([^']*)')?/g;
      let rest = body.slice(tagMatch ? tagMatch[0].length : 0);
      let m;
      while ((m = attrRe.exec(rest))) {
        const name = m[1];
        if (!name) continue;
        const value = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : '');
        el.setAttribute(name, decodeEntities(value));
      }
      const parent = stack[stack.length - 1];
      el.parentNode = parent;
      parent.childNodes.push(el);
      const VOID_TAGS = new Set(['br', 'img', 'input', 'hr', 'meta', 'link']);
      if (!selfClose && !VOID_TAGS.has(tagName.toLowerCase())) stack.push(el);
      i = end + 1;
      continue;
    }
    const next = html.indexOf('<', i);
    const textEnd = next === -1 ? len : next;
    const raw = html.slice(i, textEnd);
    if (raw.trim()) {
      const t = new BDText(decodeEntities(raw));
      const parent = stack[stack.length - 1];
      t.parentNode = parent;
      parent.childNodes.push(t);
    }
    i = textEnd;
  }
  return root.childNodes;
}

// ── mini selector engine ────────────────────────────────────────────────
// Supports: comma groups, whitespace descendant combinator, and compound
// simple selectors: optional tag, .class, #id, [attr], [attr="value"],
// :not([attr]), :not([attr="value"]) — exactly the vocabulary grep found in
// active_ride_passenger.js / active_ride_passenger_sheets.js / overlay.js /
// router.js / api_config.js.
function parseCompound(str) {
  const compound = { tag: null, id: null, classes: [], attrs: [], nots: [] };
  let rest = str;
  const tagMatch = rest.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
  if (tagMatch) { compound.tag = tagMatch[0].toLowerCase(); rest = rest.slice(tagMatch[0].length); }
  const tokenRe = /:not\(\[([a-zA-Z-]+)(?:="([^"]*)")?\]\)|#([a-zA-Z0-9_-]+)|\.([a-zA-Z0-9_-]+)|\[([a-zA-Z-]+)(?:="([^"]*)")?\]/g;
  let m;
  while ((m = tokenRe.exec(rest))) {
    if (m[1] !== undefined) compound.nots.push({ name: m[1], value: m[2] !== undefined ? m[2] : null });
    else if (m[3] !== undefined) compound.id = m[3];
    else if (m[4] !== undefined) compound.classes.push(m[4]);
    else if (m[5] !== undefined) compound.attrs.push({ name: m[5], value: m[6] !== undefined ? m[6] : null });
  }
  return compound;
}
function matchCompound(el, compound) {
  if (el.nodeType !== 1) return false;
  if (compound.tag && el.tagName.toLowerCase() !== compound.tag) return false;
  if (compound.id && el.id !== compound.id) return false;
  for (const c of compound.classes) if (!el.classList.contains(c)) return false;
  for (const a of compound.attrs) {
    if (!el.hasAttribute(a.name)) return false;
    if (a.value !== null && el.getAttribute(a.name) !== a.value) return false;
  }
  for (const n of compound.nots) {
    const has = el.hasAttribute(n.name) && (n.value === null || el.getAttribute(n.name) === n.value);
    if (has) return false;
  }
  return true;
}
const compoundCache = new Map();
function parseChain(chainStr) {
  if (compoundCache.has(chainStr)) return compoundCache.get(chainStr);
  const parts = chainStr.trim().split(/\s+/).filter(Boolean).map(parseCompound);
  compoundCache.set(chainStr, parts);
  return parts;
}
function parseSelector(selector) {
  return String(selector).split(',').map((s) => parseChain(s.trim()));
}
function matchesChain(el, compounds) {
  const last = compounds[compounds.length - 1];
  if (!matchCompound(el, last)) return false;
  let node = el;
  for (let i = compounds.length - 2; i >= 0; i--) {
    let found = false;
    let cur = node.parentNode;
    while (cur) {
      if (cur.nodeType === 1 && matchCompound(cur, compounds[i])) { found = true; node = cur; break; }
      cur = cur.parentNode;
    }
    if (!found) return false;
  }
  return true;
}
function elementMatches(el, chains) {
  return chains.some((chain) => matchesChain(el, chain));
}
function walkDescendants(root, visit) {
  for (const child of root.childNodes) {
    if (child.nodeType === 1) {
      visit(child);
      walkDescendants(child, visit);
    }
  }
}
function querySelectorImpl(root, selector, single) {
  const chains = parseSelector(selector);
  const out = [];
  walkDescendants(root, (el) => {
    if (single && out.length) return;
    if (elementMatches(el, chains)) out.push(el);
  });
  if (single) return out[0] || null;
  return out;
}

// ── document / window / location ────────────────────────────────────────
let documentBodyRef = null;
let documentRef = null;

function createDocument() {
  const body = new BDElement('body');
  const doc = {
    _listeners: new Map(),
    body,
    documentElement: body,
    activeElement: null,
    createElement: (tag) => new BDElement(tag),
    getElementById(id) {
      let found = null;
      (function walk(n) {
        if (found) return;
        for (const c of n.childNodes) {
          if (found) return;
          if (c.nodeType === 1) {
            if (c.id === id) { found = c; return; }
            walk(c);
          }
        }
      })(body);
      return found;
    },
    querySelector: (sel) => querySelectorImpl(body, sel, true),
    querySelectorAll: (sel) => querySelectorImpl(body, sel, false),
    contains: (node) => body.contains(node),
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, new Set());
      this._listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      const set = this._listeners.get(type);
      if (set) set.delete(fn);
    },
    dispatchEvent(evt) {
      const set = this._listeners.get(evt.type);
      if (set) for (const fn of Array.from(set)) fn.call(this, evt);
      return true;
    },
  };
  documentBodyRef = body;
  documentRef = doc;
  return doc;
}

function createWindow(doc) {
  let currentHash = '';
  const listeners = new Map();
  const location = {};
  Object.defineProperty(location, 'hash', {
    configurable: true,
    get: () => currentHash,
    set: (v) => {
      const next = typeof v === 'string' && v.startsWith('#') ? v : '#' + String(v);
      if (next === currentHash) return;
      currentHash = next;
      win.dispatchEvent({ type: 'hashchange' });
    },
  });
  // BD-RIDE-SELECT-ACK-AUTHORITY-01B-A (#939) Codex review-fix #3 —
  // history.replaceState mirrors the one real-DOM behavior
  // syncTerminalStatusIntoUrl() depends on: it silently rewrites the
  // address bar's hash — no 'hashchange'/'popstate' event, matching real
  // browsers — unlike this shim's own `location.hash =` setter above, which
  // deliberately DOES dispatch 'hashchange' (matching real browsers too).
  // replaceStateCalls records every call so tests can assert on the exact
  // url passed, without needing a real history stack.
  const history = {
    replaceStateCalls: [],
    replaceState(state, title, url) {
      history.replaceStateCalls.push(url);
      if (typeof url !== 'string') return;
      const hashIndex = url.indexOf('#');
      currentHash = hashIndex === -1 ? url : url.slice(hashIndex);
    },
  };
  const win = {
    location,
    document: doc,
    history,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      const set = listeners.get(type);
      if (set) set.delete(fn);
    },
    dispatchEvent(evt) {
      const set = listeners.get(type_of(evt));
      if (set) for (const fn of Array.from(set)) fn.call(win, evt);
      return true;
    },
    setTimeout: (...a) => setTimeout(...a),
    clearTimeout: (...a) => clearTimeout(...a),
    setInterval: (...a) => setInterval(...a),
    clearInterval: (...a) => clearInterval(...a),
  };
  function type_of(evt) { return evt.type; }
  return { win, location, history };
}

// ─────────────────────────────────────────────────────────────────────────
// ── Global stubs (must exist before any real module is imported) ───────
// ─────────────────────────────────────────────────────────────────────────
const localMap = new Map();
globalThis.localStorage = {
  getItem: (k) => (localMap.has(k) ? localMap.get(k) : null),
  setItem: (k, v) => localMap.set(k, String(v)),
  removeItem: (k) => localMap.delete(k),
  clear: () => localMap.clear(),
};
const sessionMap = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (sessionMap.has(k) ? sessionMap.get(k) : null),
  setItem: (k, v) => sessionMap.set(k, String(v)),
  removeItem: (k) => sessionMap.delete(k),
  clear: () => sessionMap.clear(),
};

const doc = createDocument();
const { win, location, history } = createWindow(doc);
globalThis.document = doc;
globalThis.window = win;
globalThis.location = location;
globalThis.history = history;
globalThis.MutationObserver = BDMutationObserver;

// Build the #shell > #app / #tabbar / #fab skeleton router.js expects.
const shell = doc.createElement('div'); shell.id = 'shell';
const app = doc.createElement('div'); app.id = 'app';
const tabbar = doc.createElement('div'); tabbar.id = 'tabbar'; tabbar.hidden = true;
const fab = doc.createElement('div'); fab.id = 'fab'; fab.hidden = true;
shell.appendChild(app);
shell.appendChild(tabbar);
shell.appendChild(fab);
doc.body.appendChild(shell);

// ─────────────────────────────────────────────────────────────────────────
// ── Imports (after stubs are in place) ──────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────
const { register, start, go } = await import('../public/src/router.js');
const { user } = await import('../public/src/state.js');
const {
  findActiveRide,
  saveActiveRide,
  RIDE_STATUS,
  DEMO_ACTIVE_RIDE_ID,
} = await import('../public/src/ride_state.js');
const activeRide = (await import('../public/src/screens/active_ride.js')).default;
// BD-RIDE-SELECT-ACK-AUTHORITY-01B-A (#939) review-fix #2 — direct deterministic import, NOT DOM-driven:
// arrivingDropoffAmount's authoritative branch is otherwise unobservable
// through the live DOM (paymentBlockHtml independently hides the
// ARRIVING_DROPOFF payment card whenever an authoritative ride has no real
// payment method, which is always true today), so this is the actual
// mutation-sensitive proof for that branch's decision logic — real
// execution of the real function, not source-text pattern matching.
const { arrivingDropoffAmount } = await import('../public/src/screens/active_ride_passenger.js');

// ─────────────────────────────────────────────────────────────────────────
// ── Test helpers ─────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────
const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}
async function tick(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}
function reset() {
  localMap.clear();
  sessionMap.clear();
  user.reset();
  location.hash = '#/welcome-reset-' + Math.random();
  app.replaceChildren();
  mutationObservers = [];
}

function baseRide(tripId, status, overrides = {}) {
  return {
    tripId,
    status,
    driver: { name: 'Илья С.', initials: 'ИС', rating: '4,95' },
    passenger: { name: 'Анна П.', initials: 'АП' },
    vehicle: { model: 'Toyota Camry', color: 'белый', plate: 'А 123 ВВ 77' },
    route: { pickupLabel: 'A', dropoffLabel: 'B' },
    order: { offerPrice: '1 240 ₽' },
    timestamps: { createdAt: new Date().toISOString() },
    ...overrides,
  };
}

function seedHandedOffOrder(...pairs) {
  // pairs: [[orderId, tripId], ...] newest (index 0) first, matching
  // loadRideOrdersRaw()'s documented newest-first contract.
  localStorage.setItem('bazardrive.ride_orders.v1', JSON.stringify(
    pairs.map(([id]) => ({ id, status: 'ACCEPTED' })),
  ));
}
function currentSheet() { return app.querySelector('.active-ride-passenger__sheet'); }
function currentRoot() { return app.querySelector('.active-ride-passenger, .passenger-cancel-fallback'); }
function tripLabelText() {
  const el = app.querySelector('.active-ride-passenger__trip-label')
    || app.querySelector('.passenger-cancel-fallback__trip');
  return el ? el.textContent : '';
}
function mountPassenger() {
  user.set({ role: 'passenger', welcomeSeen: true, onboarded: true, firstName: 'Анна', lastName: 'П.' });
}
async function navigate(path) {
  location.hash = path;
  await tick();
}

register('/active-ride', activeRide);
register('/feed', () => doc.createElement('div'));
start();
await tick();

// ── Scenario 1 — mount via the bare URL (NO explicit tripId), forward chain ─
// through the whole non-terminal lifecycle, then COMPLETED. Proves
// findLatestHandedOffOrderTripId() resolution at MOUNT time, and that the
// SAME trip stays observed across every forward hop that follows.
reset();
delete globalThis.__BD_API_BASE__;
seedHandedOffOrder(['ordA', 'trip_ordA']);
saveActiveRide(baseRide('trip_ordA', RIDE_STATUS.DRIVER_EN_ROUTE));
mountPassenger();
await navigate('/active-ride?role=passenger&status=DRIVER_EN_ROUTE');
{
  expect('S1: bare URL (no tripId) mounts via findLatestHandedOffOrderTripId onto trip_ordA',
    tripLabelText().includes('trip_ordA'), tripLabelText());
  expect('S1: ownership settles LOCAL_ONLY (backend off)',
    currentRoot()?.dataset.ownershipState === 'local-only', currentRoot()?.dataset.ownershipState);
  expect('S1: sheet renders the mounted status',
    currentSheet()?.dataset.status === RIDE_STATUS.DRIVER_EN_ROUTE, currentSheet()?.dataset.status);
}

const FORWARD_CHAIN = [
  RIDE_STATUS.DRIVER_APPROACHING_PICKUP,
  RIDE_STATUS.WAITING_PASSENGER,
  RIDE_STATUS.IN_PROGRESS,
  RIDE_STATUS.COMPLETED,
];
for (const nextStatus of FORWARD_CHAIN) {
  saveActiveRide(baseRide('trip_ordA', nextStatus));
  win.dispatchEvent({ type: 'storage', key: 'bazardrive.active_ride.v1' });
  await tick();
  if (nextStatus === RIDE_STATUS.COMPLETED) {
    expect(`S1: forward LOCAL_ONLY move to ${nextStatus} renders the COMPLETED screen for the SAME trip`,
      app.querySelector('.active-ride-passenger--complete') !== null
        && tripLabelText().includes('trip_ordA'),
      tripLabelText());
  } else {
    expect(`S1: forward LOCAL_ONLY move to ${nextStatus} remounts the SAME trip`,
      currentSheet()?.dataset.status === nextStatus && tripLabelText().includes('trip_ordA'),
      `sheet=${currentSheet()?.dataset.status} label=${tripLabelText()}`);
    expect(`S1: remount URL carries tripId=trip_ordA (not re-derived)`,
      location.hash.includes('tripId=trip_ordA'), location.hash);
  }
}

// ── Scenario 2 — terminal CANCELED (separate trip) ──────────────────────────
reset();
delete globalThis.__BD_API_BASE__;
seedHandedOffOrder(['ordC', 'trip_ordC']);
saveActiveRide(baseRide('trip_ordC', RIDE_STATUS.WAITING_PASSENGER));
mountPassenger();
await navigate('/active-ride?role=passenger&status=DRIVER_EN_ROUTE&tripId=trip_ordC');
saveActiveRide(baseRide('trip_ordC', RIDE_STATUS.CANCELED, { cancel: { by: 'driver' } }));
win.dispatchEvent({ type: 'storage', key: 'bazardrive.active_ride.v1' });
await tick();
{
  const fallback = app.querySelector('.passenger-cancel-fallback');
  expect('S2: terminal CANCELED renders the canceled fallback for the same trip',
    fallback && fallback.dataset.variant === 'canceled', fallback?.dataset.variant);
}

// ── Scenario 3 — terminal NO_SHOW (separate trip) ───────────────────────────
reset();
delete globalThis.__BD_API_BASE__;
seedHandedOffOrder(['ordD', 'trip_ordD']);
saveActiveRide(baseRide('trip_ordD', RIDE_STATUS.WAITING_PASSENGER));
mountPassenger();
await navigate('/active-ride?role=passenger&status=DRIVER_EN_ROUTE&tripId=trip_ordD');
saveActiveRide(baseRide('trip_ordD', RIDE_STATUS.NO_SHOW));
win.dispatchEvent({ type: 'storage', key: 'bazardrive.active_ride.v1' });
await tick();
{
  const fallback = app.querySelector('.passenger-cancel-fallback');
  expect('S3: terminal NO_SHOW renders the no-show fallback for the same trip',
    fallback && fallback.dataset.variant === 'no_show', fallback?.dataset.variant);
}

// ── Scenario 4/5 — after terminal, Trip A drops out of
// findLatestHandedOffOrderTripId(), a real Trip B becomes the latest
// candidate, and the mounted (now-terminal) passenger screen does NOT drift
// onto Trip B. This is the exact P1-1 failure shape: Trip A newest at mount,
// Trip B older-but-still-live, Trip A goes terminal mid-session. ─────────────
reset();
delete globalThis.__BD_API_BASE__;
seedHandedOffOrder(['ordA', 'trip_ordA'], ['ordB', 'trip_ordB']);
saveActiveRide(baseRide('trip_ordA', RIDE_STATUS.DRIVER_EN_ROUTE));
saveActiveRide(baseRide('trip_ordB', RIDE_STATUS.DRIVER_EN_ROUTE));
mountPassenger();
const { findLatestHandedOffOrderTripId } = await import('../public/src/mock_api.js');
expect('S4 pre: findLatestHandedOffOrderTripId() resolves the newest live trip (A)',
  findLatestHandedOffOrderTripId() === 'trip_ordA', findLatestHandedOffOrderTripId());
await navigate('/active-ride?role=passenger&status=DRIVER_EN_ROUTE');
expect('S4 pre: mounted screen observes Trip A via the bare URL',
  tripLabelText().includes('trip_ordA'), tripLabelText());
saveActiveRide(baseRide('trip_ordA', RIDE_STATUS.CANCELED, { cancel: { by: 'driver' } }));
win.dispatchEvent({ type: 'storage', key: 'bazardrive.active_ride.v1' });
await tick();
{
  expect('S4: findLatestHandedOffOrderTripId() stops returning terminal Trip A, now surfaces Trip B',
    findLatestHandedOffOrderTripId() === 'trip_ordB', findLatestHandedOffOrderTripId());
  const fallback = app.querySelector('.passenger-cancel-fallback');
  expect('S5: the mounted screen still reconciles Trip A (canceled fallback), NOT Trip B',
    fallback && fallback.dataset.variant === 'canceled' && tripLabelText().includes('trip_ordA'),
    `variant=${fallback?.dataset.variant} label=${tripLabelText()}`);
  expect('S5: Trip B never appears in the mounted screen',
    !tripLabelText().includes('trip_ordB'), tripLabelText());
}

// ── Scenario 6 — backward status is ignored ─────────────────────────────────
reset();
delete globalThis.__BD_API_BASE__;
seedHandedOffOrder(['ordE', 'trip_ordE']);
saveActiveRide(baseRide('trip_ordE', RIDE_STATUS.IN_PROGRESS));
mountPassenger();
await navigate('/active-ride?role=passenger&status=IN_PROGRESS&tripId=trip_ordE');
const hashBeforeBackward = location.hash;
saveActiveRide(baseRide('trip_ordE', RIDE_STATUS.DRIVER_EN_ROUTE));
win.dispatchEvent({ type: 'storage', key: 'bazardrive.active_ride.v1' });
await tick();
{
  expect('S6: a backward local status does not remount the screen',
    currentSheet()?.dataset.status === RIDE_STATUS.IN_PROGRESS, currentSheet()?.dataset.status);
  expect('S6: no stray navigation happened',
    location.hash === hashBeforeBackward, location.hash);
}

// ── Scenario 7 — an unrelated trip's write is ignored ───────────────────────
reset();
delete globalThis.__BD_API_BASE__;
seedHandedOffOrder(['ordF', 'trip_ordF']);
saveActiveRide(baseRide('trip_ordF', RIDE_STATUS.DRIVER_EN_ROUTE));
mountPassenger();
await navigate('/active-ride?role=passenger&status=DRIVER_EN_ROUTE&tripId=trip_ordF');
saveActiveRide(baseRide('trip_unrelated', RIDE_STATUS.COMPLETED));
win.dispatchEvent({ type: 'storage', key: 'bazardrive.active_ride.v1' });
await tick();
{
  expect('S7: an unrelated trip\'s forward write does not affect the mounted screen',
    currentSheet()?.dataset.status === RIDE_STATUS.DRIVER_EN_ROUTE, currentSheet()?.dataset.status);
  expect('S7: the mounted screen is still Trip F',
    tripLabelText().includes('trip_ordF'), tripLabelText());
}

// ── Scenario 8 — malformed localStorage does not crash or navigate ─────────
reset();
delete globalThis.__BD_API_BASE__;
seedHandedOffOrder(['ordG', 'trip_ordG']);
saveActiveRide(baseRide('trip_ordG', RIDE_STATUS.DRIVER_EN_ROUTE));
mountPassenger();
await navigate('/active-ride?role=passenger&status=DRIVER_EN_ROUTE&tripId=trip_ordG');
const hashBeforeMalformed = location.hash;
localStorage.setItem('bazardrive.active_ride.v1', '{not valid json');
let malformedThrew = false;
try {
  win.dispatchEvent({ type: 'storage', key: 'bazardrive.active_ride.v1' });
  await tick();
} catch {
  malformedThrew = true;
}
{
  expect('S8: malformed localStorage does not throw',
    !malformedThrew);
  expect('S8: malformed localStorage does not navigate away',
    location.hash === hashBeforeMalformed, location.hash);
  expect('S8: sheet is unchanged',
    currentSheet()?.dataset.status === RIDE_STATUS.DRIVER_EN_ROUTE, currentSheet()?.dataset.status);
}

// ── Scenario 9 — SERVER_BACKED does not react to a local storage write ─────
reset();
globalThis.__BD_API_BASE__ = 'https://fake.test';
globalThis.fetch = async (url) => {
  if (String(url).includes('/ride-state/rides/')) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ride: baseRide('trip_ordH', RIDE_STATUS.DRIVER_EN_ROUTE) }),
    };
  }
  return { ok: true, status: 200, text: async () => JSON.stringify({}) };
};
mountPassenger();
await navigate('/active-ride?role=passenger&status=DRIVER_EN_ROUTE&tripId=trip_ordH');
await tick(12);
{
  expect('S9 pre: ownership settled SERVER_BACKED',
    currentRoot()?.dataset.ownershipState === 'server-backed', currentRoot()?.dataset.ownershipState);
}
saveActiveRide(baseRide('trip_ordH', RIDE_STATUS.COMPLETED));
win.dispatchEvent({ type: 'storage', key: 'bazardrive.active_ride.v1' });
await tick();
{
  expect('S9: a LOCAL_ONLY-shaped storage write is ignored while ownership is SERVER_BACKED',
    currentSheet()?.dataset.status === RIDE_STATUS.DRIVER_EN_ROUTE, currentSheet()?.dataset.status);
}
delete globalThis.__BD_API_BASE__;
delete globalThis.fetch;

// ── Scenario 10 — UNCONFIRMED → LOCAL_ONLY does not lose a transition that
// landed before subscription (no 'storage' event fired at all here — proves
// the explicit re-check on ownership settlement, not the event listener). ──
reset();
globalThis.__BD_API_BASE__ = 'https://fake.test';
let resolveFetch;
globalThis.fetch = (url) => {
  if (String(url).includes('/ride-state/rides/')) {
    return new Promise((resolve) => { resolveFetch = resolve; });
  }
  return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({}) });
};
seedHandedOffOrder(['ordI', 'trip_ordI']);
saveActiveRide(baseRide('trip_ordI', RIDE_STATUS.DRIVER_EN_ROUTE));
mountPassenger();
await navigate('/active-ride?role=passenger&status=DRIVER_EN_ROUTE&tripId=trip_ordI');
expect('S10 pre: ownership still UNCONFIRMED while the backend read is in flight',
  currentRoot()?.dataset.ownershipState === 'unconfirmed', currentRoot()?.dataset.ownershipState);
// Another tab advances the trip while this screen is still UNCONFIRMED — no
// 'storage' event is dispatched here on purpose.
saveActiveRide(baseRide('trip_ordI', RIDE_STATUS.WAITING_PASSENGER));
// The backend now resolves as OFF/absent for this trip (404-shaped): settle LOCAL_ONLY.
resolveFetch({ ok: false, status: 404, text: async () => JSON.stringify({ code: 'RIDE_NOT_FOUND' }) });
await tick(12);
// BD-RIDE-SELECT-ACK-AUTHORITY-01B-A (#939) — reconcileLocalOnlyRide() detects the missed forward
// transition and navigates to a fresh mount. Requirement #1 means even THIS
// remount never trusts the just-written local WAITING_PASSENGER record on
// sight — it starts LOADING again and waits for its OWN authoritative GET,
// exactly like the very first mount did. Resolve that second,
// remount-triggered GET too (a purely local trip's 404 is stable/consistent
// across repeated reads) before asserting the final settled sheet.
resolveFetch({ ok: false, status: 404, text: async () => JSON.stringify({ code: 'RIDE_NOT_FOUND' }) });
await tick(12);
{
  expect('S10: LOCAL_ONLY settlement re-checks the store, navigates to the missed transition, and the remount settles LOCAL_ONLY on its own authoritative read',
    currentSheet()?.dataset.status === RIDE_STATUS.WAITING_PASSENGER
      || app.querySelector('.active-ride-passenger--complete') !== null,
    currentSheet()?.dataset.status);
}
delete globalThis.__BD_API_BASE__;
delete globalThis.fetch;

// ── Scenario 11 — teardown/remount leaves no stale listener/navigation ─────
reset();
delete globalThis.__BD_API_BASE__;
seedHandedOffOrder(['ordJ', 'trip_ordJ']);
saveActiveRide(baseRide('trip_ordJ', RIDE_STATUS.DRIVER_EN_ROUTE));
mountPassenger();
await navigate('/active-ride?role=passenger&status=DRIVER_EN_ROUTE&tripId=trip_ordJ');
await navigate('/feed');
const hashAfterTeardown = location.hash;
saveActiveRide(baseRide('trip_ordJ', RIDE_STATUS.COMPLETED));
let teardownThrew = false;
try {
  win.dispatchEvent({ type: 'storage', key: 'bazardrive.active_ride.v1' });
  await tick();
} catch {
  teardownThrew = true;
}
{
  expect('S11: a storage write after navigating away does not throw',
    !teardownThrew);
  expect('S11: a torn-down screen does not fire a stray navigation',
    location.hash === hashAfterTeardown, location.hash);
}

// ── Scenario 12 — open cancel overlay + terminal LOCAL_ONLY transition +
// already-queued confirm click: must NOT show a false "canceled" success, and
// must use the aborted/deferred-terminal contract (same as SERVER_BACKED). ──
reset();
delete globalThis.__BD_API_BASE__;
seedHandedOffOrder(['ordK', 'trip_ordK']);
saveActiveRide(baseRide('trip_ordK', RIDE_STATUS.DRIVER_EN_ROUTE));
mountPassenger();
await navigate('/active-ride?role=passenger&status=DRIVER_EN_ROUTE&tripId=trip_ordK');
const root12 = currentRoot();
root12.querySelector('#arp-cancel').click();
const overlay12 = root12.querySelector('.passenger-cancel-overlay');
expect('S12 pre: cancel overlay opened', overlay12 !== null);
overlay12.querySelector('.passenger-cancel-sheet__reason').click();
overlay12.querySelector('#arp-cancel-confirm').click();
expect('S12 pre: overlay reached the confirm gate', overlay12.dataset.stage === 'confirm', overlay12.dataset.stage);

// Another same-origin tab completes the ride WHILE the overlay is open.
saveActiveRide(baseRide('trip_ordK', RIDE_STATUS.COMPLETED));
win.dispatchEvent({ type: 'storage', key: 'bazardrive.active_ride.v1' });
await tick();
expect('S12: the forward terminal status defers behind the open overlay (no navigation yet)',
  currentSheet()?.dataset.status === RIDE_STATUS.DRIVER_EN_ROUTE, currentSheet()?.dataset.status);
expect('S12: the deferred-terminal gate disables the confirm buttons',
  root12.querySelector('#arp-cancel-confirm-yes')?.disabled === true);

// The already-queued click: fires the listener regardless of the disabled
// flag, exactly like a click event already in flight when disable() lands.
overlay12.querySelector('#arp-cancel-confirm-yes').click();
{
  expect('S12: the queued click does NOT show a false canceled success',
    overlay12.dataset.stage !== 'canceled', overlay12.dataset.stage);
  expect('S12: the overlay closes (aborted) instead',
    root12.querySelector('.passenger-cancel-overlay') === null);
  expect('S12: the ride was NOT locally mutated to CANCELED by the aborted click',
    findActiveRide('trip_ordK')?.status === RIDE_STATUS.COMPLETED, findActiveRide('trip_ordK')?.status);
}
await tick();
{
  expect('S12: closing the overlay flushes the deferred terminal status and completes the ride',
    location.hash.includes('status=COMPLETED') && location.hash.includes('tripId=trip_ordK'), location.hash);
  expect('S12: the remounted screen renders the COMPLETED view for the SAME trip',
    app.querySelector('.active-ride-passenger--complete') !== null && tripLabelText().includes('trip_ordK'),
    tripLabelText());
}
delete globalThis.__BD_API_BASE__;
delete globalThis.fetch;

// ── Scenario 13 — BD-RIDE-SELECT-ACK-AUTHORITY-01B-A (#939): the very FIRST successful backend GET
// resolves a terminal status directly (no 404, no local-status coincidence,
// no persisted local record at all). Requirement #1: nothing local paints
// before that GET settles. Requirement #2/#3: the settled GET alone decides
// terminal vs. normal, and COMPLETED renders from the server Ride. Requirement
// #5: with no server vehicle/payment source, the render neutralizes rather
// than showing the built-in demo's fabricated driver/car/card. ──
reset();
globalThis.__BD_API_BASE__ = 'https://fake.test';
let resolveFetch13;
globalThis.fetch = (url) => {
  if (String(url).includes('/ride-state/rides/')) {
    return new Promise((resolve) => { resolveFetch13 = resolve; });
  }
  return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({}) });
};
mountPassenger();
await navigate('/active-ride?role=passenger&tripId=trip_ordL');
expect('S13 pre: no local/demo ride is shown while the very first backend read is in flight',
  currentSheet()?.dataset.status === 'loading', currentSheet()?.dataset.status);
resolveFetch13({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    ride: {
      tripId: 'trip_ordL',
      status: RIDE_STATUS.COMPLETED,
      driver: { name: 'Мария В.', initials: 'МВ', rating: '5,00' },
      passenger: { name: 'Анна П.', initials: 'АП' },
      route: { pickupLabel: 'ул. Тестовая, 1', dropoffLabel: 'ул. Финишная, 2' },
      order: { offerPrice: '999 ₽' },
      timestamps: { createdAt: new Date().toISOString() },
      // Deliberately no vehicle/payment/chat — a real serializeRide() never
      // emits them either; the render must neutralize, never fabricate.
    },
  }),
});
await tick(12);
{
  expect('S13: a terminal status from the very first successful GET swaps straight to the COMPLETE renderer',
    app.querySelector('.active-ride-passenger--complete') !== null);
  expect('S13: the COMPLETE renderer shows the server-confirmed driver name, never the built-in demo default',
    (app.querySelector('.active-ride-passenger__driver-name')?.textContent || '').includes('Мария В.'),
    app.querySelector('.active-ride-passenger__driver-name')?.textContent);
  expect('S13: with no server vehicle/payment source, the payment line is a truthful neutral line, never a fabricated card',
    app.querySelector('.passenger-complete__pay-method-title')?.textContent === 'Способ оплаты не указан',
    app.querySelector('.passenger-complete__pay-method-title')?.textContent);
}
delete globalThis.__BD_API_BASE__;
delete globalThis.fetch;

// ── Scenario 14 — BD-RIDE-SELECT-ACK-AUTHORITY-01B-A (#939) requirement #7: a generic failure (5xx) on the
// very FIRST-EVER read never falls back to a stale local Ride, even when a
// usable local record already exists for this trip — only a LATER
// recovery/retry read of an ALREADY-confirmed ride gets the graceful
// stale-with-banner treatment (unchanged, not this scenario). ──
reset();
globalThis.__BD_API_BASE__ = 'https://fake.test';
let resolveFetch14;
globalThis.fetch = (url) => {
  if (String(url).includes('/ride-state/rides/')) {
    return new Promise((resolve) => { resolveFetch14 = resolve; });
  }
  return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({}) });
};
seedHandedOffOrder(['ordM', 'trip_ordM']);
saveActiveRide(baseRide('trip_ordM', RIDE_STATUS.DRIVER_EN_ROUTE));
mountPassenger();
await navigate('/active-ride?role=passenger&status=DRIVER_EN_ROUTE&tripId=trip_ordM');
resolveFetch14({ ok: false, status: 500, text: async () => JSON.stringify({ code: 'INTERNAL' }) });
await tick(12);
{
  expect('S14: a first-read 5xx failure shows the ERROR state, never the stale local DRIVER_EN_ROUTE sheet, even though a usable local record exists',
    currentSheet()?.dataset.status === 'error', currentSheet()?.dataset.status);
}
delete globalThis.__BD_API_BASE__;
delete globalThis.fetch;

// ── Unit block — BD-RIDE-SELECT-ACK-AUTHORITY-01B-A (#939) review-fix #2 (P1 finding): direct, real
// execution of arrivingDropoffAmount(ride), the actual mutation-sensitive
// proof. A prior round's runtime scenarios (S15/S16) sent an EMPTY-STRING
// ride.price override in the fake server payload — that masked the real
// defect: a REALISTIC server response omits the `ride` sub-object entirely
// (serializeRide()/serializeRecoveredRide() never emit it), and
// mergeServerRide's keep(local, undefined) then silently preserves whatever
// ride.price the PRE-MERGE local/demo record already had — which, for a
// fresh/unseeded mount, is createDemoActiveRide()'s own '1 540 ₽' default.
// The old priority chain checked r.price BEFORE order.offerPrice, so that
// stale demo value would outrank a genuinely real, present order.offerPrice
// from the server. These cases construct the ride objects directly —
// exactly the shape mergeServerRide would produce — with NO `ride` key at
// all, proving the decision helper itself, independent of any DOM/hide
// mechanism. ──
expect('arrivingDropoffAmount: authoritative + a real order.offerPrice from the server -> the real price (900 ₽), never 1 540 ₽',
  arrivingDropoffAmount({ authoritative: true, order: { offerPrice: '900 ₽' } }) === '900 ₽',
  arrivingDropoffAmount({ authoritative: true, order: { offerPrice: '900 ₽' } }));
expect('arrivingDropoffAmount: authoritative + order.offerPrice null -> the neutral "—", never 1 540 ₽',
  arrivingDropoffAmount({ authoritative: true, order: { offerPrice: null } }) === '—',
  arrivingDropoffAmount({ authoritative: true, order: { offerPrice: null } }));
expect('arrivingDropoffAmount: authoritative + no `ride` key at all (the realistic serializeRide() shape) and no order.offerPrice -> "—", never 1 540 ₽',
  arrivingDropoffAmount({ authoritative: true, order: {} }) === '—',
  arrivingDropoffAmount({ authoritative: true, order: {} }));
expect('arrivingDropoffAmount: authoritative + NO order key at all -> "—", never 1 540 ₽',
  arrivingDropoffAmount({ authoritative: true }) === '—',
  arrivingDropoffAmount({ authoritative: true }));
// THE P1 regression itself: a stale local/demo ride.price (exactly what a
// pre-merge local record, or a naive keep()-based merge, could still carry)
// must NEVER outrank — or leak past — a real, present order.offerPrice on
// an authoritative ride. This is the object shape the P1 finding describes.
expect('arrivingDropoffAmount: authoritative + a stale ride.price/payment.amount alongside a real order.offerPrice -> the real order.offerPrice wins, the stale fields are never even consulted',
  arrivingDropoffAmount({
    authoritative: true,
    ride: { price: '1 540 ₽' },
    payment: { amount: '1 480 ₽', dropoffAmount: '1 480 ₽' },
    order: { offerPrice: '900 ₽' },
  }) === '900 ₽');
expect('arrivingDropoffAmount: authoritative + a stale ride.price alongside a null order.offerPrice -> "—", the stale ride.price never leaks',
  arrivingDropoffAmount({
    authoritative: true,
    ride: { price: '1 540 ₽' },
    order: { offerPrice: null },
  }) === '—');
// Local/backend-off — unchanged real-value priority chain and fallback.
expect('arrivingDropoffAmount: non-authoritative + no real value anywhere -> the exact prior "1 540 ₽" demo fallback preserved',
  arrivingDropoffAmount({ order: {} }) === '1 540 ₽');
expect('arrivingDropoffAmount: non-authoritative + only order.offerPrice real -> that value (priority chain intact)',
  arrivingDropoffAmount({ order: { offerPrice: '750 ₽' } }) === '750 ₽');
expect('arrivingDropoffAmount: non-authoritative + ride.price real (and no payment) -> ride.price wins over order.offerPrice (priority order unchanged)',
  arrivingDropoffAmount({ ride: { price: '600 ₽' }, order: { offerPrice: '750 ₽' } }) === '600 ₽');
expect('arrivingDropoffAmount: non-authoritative + payment.dropoffAmount real -> it wins over everything else (priority order unchanged)',
  arrivingDropoffAmount({
    payment: { dropoffAmount: '500 ₽', amount: '600 ₽' },
    ride: { price: '700 ₽' },
    order: { offerPrice: '800 ₽' },
  }) === '500 ₽');

// ── Scenario 15 — BD-RIDE-SELECT-ACK-AUTHORITY-01B-A (#939) review-fix (MEDIUM/P1 finding): an
// authoritative COMPLETED ride, mounted end-to-end through the real
// GET/merge/render pipeline, with a REALISTIC server payload — no `ride`
// key at all (a real serializeRide() never emits it) — shows the real
// order.offerPrice on "Итого к оплате", never the stale local/demo fare. ──
reset();
globalThis.__BD_API_BASE__ = 'https://fake.test';
let resolveFetch15;
globalThis.fetch = (url) => {
  if (String(url).includes('/ride-state/rides/')) {
    return new Promise((resolve) => { resolveFetch15 = resolve; });
  }
  return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({}) });
};
mountPassenger();
await navigate('/active-ride?role=passenger&tripId=trip_ordN');
resolveFetch15({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    ride: {
      tripId: 'trip_ordN',
      status: RIDE_STATUS.COMPLETED,
      driver: { name: 'Олег Р.', initials: 'ОР', rating: '4,80' },
      passenger: { name: 'Анна П.', initials: 'АП' },
      route: { pickupLabel: 'ул. Тестовая, 3', dropoffLabel: 'ул. Финишная, 4' },
      order: { offerPrice: '900 ₽' },
      timestamps: { createdAt: new Date().toISOString() },
      // No `ride` sub-object and no `payment` at all — the exact
      // serializeRide()/serializeRecoveredRide() shape. The pre-merge local
      // fallback (createDemoActiveRide(), no seed for this tripId) DOES
      // carry its own demo ride.price ('1 540 ₽') — proving this real
      // order.offerPrice correctly wins end-to-end through the actual
      // merge, not just in the isolated unit block above.
    },
  }),
});
await tick(12);
{
  expect('S15: authoritative COMPLETED with a REAL order.offerPrice from a realistic (no `ride` key) server payload shows that real price, never the stale local/demo fare',
    app.querySelector('.passenger-complete__pay-total')?.textContent === '900 ₽',
    app.querySelector('.passenger-complete__pay-total')?.textContent);
}
delete globalThis.__BD_API_BASE__;
delete globalThis.fetch;

// ── Scenario 15b — same realistic shape, order.offerPrice: null. ──
reset();
globalThis.__BD_API_BASE__ = 'https://fake.test';
let resolveFetch15b;
globalThis.fetch = (url) => {
  if (String(url).includes('/ride-state/rides/')) {
    return new Promise((resolve) => { resolveFetch15b = resolve; });
  }
  return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({}) });
};
mountPassenger();
await navigate('/active-ride?role=passenger&tripId=trip_ordN2');
resolveFetch15b({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    ride: {
      tripId: 'trip_ordN2',
      status: RIDE_STATUS.COMPLETED,
      driver: { name: 'Дина К.', initials: 'ДК', rating: '4,90' },
      passenger: { name: 'Анна П.', initials: 'АП' },
      route: { pickupLabel: 'ул. Тестовая, 7', dropoffLabel: 'ул. Финишная, 8' },
      order: { offerPrice: null },
      timestamps: { createdAt: new Date().toISOString() },
      // No `ride` sub-object, no `payment` — realistic shape.
    },
  }),
});
await tick(12);
{
  expect('S15b: authoritative COMPLETED with order.offerPrice: null in a realistic server payload shows the neutral "—", never the stale local/demo fare',
    app.querySelector('.passenger-complete__pay-total')?.textContent === '—',
    app.querySelector('.passenger-complete__pay-total')?.textContent);
}
delete globalThis.__BD_API_BASE__;
delete globalThis.fetch;

// ── Scenario 16 — BD-RIDE-SELECT-ACK-AUTHORITY-01B-A (#939) review-fix: an authoritative IN_PROGRESS +
// ARRIVING_DROPOFF ride with a realistic server payload (no `ride` key, a
// real order.offerPrice) never shows '1 540 ₽' anywhere in the rendered
// sheet. The local ride is seeded to status=IN_PROGRESS via the URL BEFORE
// the server read settles, so the settled srv.status === ride.status and
// maybeReMount never re-navigates (which would drop the &phase= query param
// this scenario depends on — see maybeReMount's URL, role+status+tripId
// only). Note: paymentInfo() always returns last4/method = null for ANY
// authoritative ride (mergeServerRide always sets payment: null), so
// paymentBlockHtml's pre-existing whole-card hide ALSO independently
// prevents this card from ever rendering here — this scenario proves the
// end-to-end OUTCOME through the real DOM; the decision helper itself is
// proven directly, mutation-sensitively, by the unit block above. ──
reset();
globalThis.__BD_API_BASE__ = 'https://fake.test';
let resolveFetch16;
globalThis.fetch = (url) => {
  if (String(url).includes('/ride-state/rides/')) {
    return new Promise((resolve) => { resolveFetch16 = resolve; });
  }
  return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({}) });
};
mountPassenger();
await navigate('/active-ride?role=passenger&status=IN_PROGRESS&tripId=trip_ordR&phase=arriving_dropoff');
resolveFetch16({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    ride: {
      tripId: 'trip_ordR',
      status: RIDE_STATUS.IN_PROGRESS,
      driver: { name: 'Павел Д.', initials: 'ПД', rating: '4,70' },
      passenger: { name: 'Анна П.', initials: 'АП' },
      route: { pickupLabel: 'ул. Тестовая, 5', dropoffLabel: 'ул. Финишная, 6' },
      order: { offerPrice: '900 ₽' },
      timestamps: { createdAt: new Date().toISOString() },
      // No `ride` sub-object, no `payment` — realistic shape.
    },
  }),
});
await tick(12);
{
  expect('S16: authoritative IN_PROGRESS+ARRIVING_DROPOFF with a realistic server payload never shows the stale 1 540 ₽ anywhere in the rendered sheet',
    !(currentSheet()?.textContent || '').includes('1 540'));
  expect('S16: the payment card is correctly absent for an authoritative ride with no real payment method (independent confirmation alongside the amount gate)',
    app.querySelector('.active-ride-passenger__payment') === null);
}
delete globalThis.__BD_API_BASE__;
delete globalThis.fetch;

// ── Scenario 17 — BD-RIDE-SELECT-ACK-AUTHORITY-01B-A (#939) review-fix: local/backend-off COMPLETED with
// no real price preserves the EXACT prior '1 540 ₽' demo fallback — the
// backend-off prototype is unchanged. ──
reset();
delete globalThis.__BD_API_BASE__;
saveActiveRide(baseRide('trip_ordP', RIDE_STATUS.COMPLETED, { order: {}, ride: {} }));
mountPassenger();
await navigate('/active-ride?role=passenger&status=COMPLETED&tripId=trip_ordP');
{
  expect('S17: local/backend-off COMPLETED with no real price preserves the prior 1 540 ₽ demo fallback',
    app.querySelector('.passenger-complete__pay-total')?.textContent === '1 540 ₽',
    app.querySelector('.passenger-complete__pay-total')?.textContent);
}

// ── Scenario 18 — BD-RIDE-SELECT-ACK-AUTHORITY-01B-A (#939) review-fix: local/backend-off IN_PROGRESS +
// ARRIVING_DROPOFF with no real price preserves the EXACT prior '1 540 ₽'
// demo fallback. Unlike the authoritative case (S16), a non-authoritative
// ride's paymentInfo() returns real demo last4/method, so the payment card
// is NOT hidden here and its amount node is directly checkable. ──
reset();
delete globalThis.__BD_API_BASE__;
saveActiveRide(baseRide('trip_ordQ', RIDE_STATUS.IN_PROGRESS, { order: {}, ride: {} }));
mountPassenger();
await navigate('/active-ride?role=passenger&status=IN_PROGRESS&tripId=trip_ordQ&phase=arriving_dropoff');
{
  expect('S18: local/backend-off ARRIVING_DROPOFF with no real price preserves the prior 1 540 ₽ demo fallback',
    app.querySelector('.active-ride-passenger__payment-amount')?.textContent === '1 540 ₽',
    app.querySelector('.active-ride-passenger__payment-amount')?.textContent);
}

// ── Scenario 19 — #939 Codex review-fix P1: readEpoch is an attempt
// counter, not a confirmation signal. A first-read retryable failure
// schedules a real background recovery (schedulePassengerRideRecovery's
// setTimeout(fn, PASSENGER_RIDE_POLL_MS) -> runInitialRead(true)), which
// bumps readEpoch to 2 despite nothing ever having succeeded. The OLD
// `epoch > 1` gate would have treated that as "already confirmed, safe to
// show optimistically" and rendered the stale local DRIVER_EN_ROUTE ride
// the instant the recovery attempt STARTED — before its own GET even
// settled. hasConfirmedServerRide fixes this: it stays false through the
// whole chain until a read actually succeeds.
//
// The scheduling delay is a REAL setTimeout (PASSENGER_RIDE_POLL_MS =
// 2500ms) — this shim's setTimeout is Node's real timer, unmocked. Rather
// than waiting 2.5 real seconds, globalThis.setTimeout is clamped to a few
// ms for the duration of this one scenario only (restored immediately
// after) — schedulePassengerRideRecovery/runInitialRead still run for
// real, through a real (just much shorter) timer; nothing about the
// mechanism itself is bypassed or mocked.
reset();
globalThis.__BD_API_BASE__ = 'https://fake.test';
let resolveFetch19First;
let resolveFetch19Recovery;
let fetchCallCount19 = 0;
globalThis.fetch = (url) => {
  if (String(url).includes('/ride-state/rides/')) {
    fetchCallCount19 += 1;
    if (fetchCallCount19 === 1) return new Promise((resolve) => { resolveFetch19First = resolve; });
    return new Promise((resolve) => { resolveFetch19Recovery = resolve; });
  }
  return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({}) });
};
seedHandedOffOrder(['ordS', 'trip_ordS']);
saveActiveRide(baseRide('trip_ordS', RIDE_STATUS.DRIVER_EN_ROUTE));
mountPassenger();
await navigate('/active-ride?role=passenger&status=DRIVER_EN_ROUTE&tripId=trip_ordS');
const realSetTimeout19 = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => realSetTimeout19(fn, Math.min(ms, 10), ...args);
resolveFetch19First({ ok: false, status: 500, text: async () => JSON.stringify({ code: 'INTERNAL' }) });
await tick(12);
expect('S19 pre: the very first read failing retryably shows ERROR, not the stale local ride (hasConfirmedServerRide is still false)',
  currentSheet()?.dataset.status === 'error', currentSheet()?.dataset.status);
// Let the (now-clamped) recovery timer actually fire for real, then restore
// the real setTimeout before doing anything else.
await new Promise((resolve) => realSetTimeout19(resolve, 100));
globalThis.setTimeout = realSetTimeout19;
expect('S19 pre: the scheduled recovery attempt actually started (its own GET is in flight)',
  fetchCallCount19 === 2);
expect('S19: while the recovery GET is in flight (not yet settled), the screen shows LOADING — never the stale local DRIVER_EN_ROUTE ride the OLD `epoch > 1` gate would have shown the instant this attempt started',
  currentSheet()?.dataset.status === 'loading', currentSheet()?.dataset.status);
// Now let the recovery GET actually succeed — only NOW is it safe to show
// the confirmed ride, and hasConfirmedServerRide should flip to true.
resolveFetch19Recovery({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    ride: {
      tripId: 'trip_ordS',
      status: RIDE_STATUS.DRIVER_EN_ROUTE,
      driver: { name: 'Игорь Т.', initials: 'ИТ', rating: '4,60' },
      passenger: { name: 'Анна П.', initials: 'АП' },
      route: { pickupLabel: 'ул. Тестовая, 9', dropoffLabel: 'ул. Финишная, 10' },
      order: { offerPrice: '700 ₽' },
      timestamps: { createdAt: new Date().toISOString() },
    },
  }),
});
await tick(12);
expect('S19: after the recovery GET actually succeeds, the confirmed ride renders normally, from server data',
  currentSheet()?.dataset.status === RIDE_STATUS.DRIVER_EN_ROUTE, currentSheet()?.dataset.status);
delete globalThis.__BD_API_BASE__;
delete globalThis.fetch;

// ── Scenario 20 — #939 Codex review-fix P2: swapToTerminalPassengerScreen
// syncs the terminal status into the URL via history.replaceState BEFORE
// the DOM swap, so a reload picks up the terminal renderer even though the
// swap itself never navigates. Uses the very first successful GET path
// (mirrors S13) so the terminal swap fires from the success branch.
//
// Focused pre-commit audit follow-up — the ORIGINAL version of this
// scenario asserted "never fired a hashchange" by checking only that
// `location.hash` changed, which is ALSO true if the sync mechanism had
// (wrongly) used a hashchange-firing `location.hash = …` assignment
// instead of `history.replaceState`. A real 'hashchange' listener is
// registered for the whole scenario instead, so hashchangeCount is an
// actual event count, not an inferred proxy — and a fetchCallCount tracks
// that the swap itself never triggers a second/duplicate GET. ──
reset();
globalThis.__BD_API_BASE__ = 'https://fake.test';
let resolveFetch20;
let fetchCallCount20 = 0;
globalThis.fetch = (url) => {
  if (String(url).includes('/ride-state/rides/')) {
    fetchCallCount20 += 1;
    return new Promise((resolve) => { resolveFetch20 = resolve; });
  }
  return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({}) });
};
mountPassenger();
await navigate('/active-ride?role=passenger&status=DRIVER_EN_ROUTE&tripId=trip_ordT&phase=arriving_dropoff');
let hashchangeCount20 = 0;
const onHashchange20 = () => { hashchangeCount20 += 1; };
window.addEventListener('hashchange', onHashchange20);
const hashBeforeSwap20 = location.hash;
const replaceCallsBefore20 = history.replaceStateCalls.length;
resolveFetch20({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    ride: {
      tripId: 'trip_ordT',
      status: RIDE_STATUS.COMPLETED,
      driver: { name: 'Света М.', initials: 'СМ', rating: '4,85' },
      passenger: { name: 'Анна П.', initials: 'АП' },
      route: { pickupLabel: 'ул. Тестовая, 11', dropoffLabel: 'ул. Финишная, 12' },
      order: { offerPrice: '650 ₽' },
      timestamps: { createdAt: new Date().toISOString() },
    },
  }),
});
await tick(12);
window.removeEventListener('hashchange', onHashchange20);
{
  const syncedUrl = history.replaceStateCalls[history.replaceStateCalls.length - 1];
  // All asserted together, in one place, as the audit required: exactly one
  // replaceState, the correct terminal hash/argument, every other query
  // param preserved, zero real hashchange events, and exactly one GET for
  // the whole scenario (the swap itself never triggers a second one).
  //
  // location.hash DOES change to the new value — history.replaceState is a
  // real address-bar update in real browsers, exactly like this shim's own
  // replaceState mirrors — the guarantee is only that no 'hashchange'/
  // 'popstate' EVENT fires for it (unlike a plain `location.hash =`
  // assignment, which both changes the value AND fires the event). An
  // earlier draft of this assertion wrongly required the hash to stay at
  // its PRE-swap value, conflating "no event" with "no change" — fixed
  // here to require the hash reflect the newly-synced URL exactly.
  expect('S20: exactly one history.replaceState call, with the correct terminal hash (status=COMPLETED, role/tripId/phase preserved) actually reflected in location.hash, zero real hashchange events, and exactly one GET for the whole scenario',
    history.replaceStateCalls.length === replaceCallsBefore20 + 1
      && typeof syncedUrl === 'string'
      && syncedUrl === '#/active-ride?role=passenger&status=COMPLETED&tripId=trip_ordT&phase=arriving_dropoff'
      && hashchangeCount20 === 0
      && location.hash === syncedUrl
      && location.hash !== hashBeforeSwap20
      && fetchCallCount20 === 1,
    JSON.stringify({ syncedUrl, hashchangeCount20, fetchCallCount20, hash: location.hash, hashBeforeSwap20 }));
  expect('S20: the DOM correctly shows the COMPLETE renderer (the swap itself still happened, even though the URL never navigated)',
    app.querySelector('.active-ride-passenger--complete') !== null);
}
delete globalThis.__BD_API_BASE__;
delete globalThis.fetch;

// ── Scenario 21 — #939 Codex review-fix P2 (the actual product concern):
// after the URL sync, a fresh mount for the SAME trip — reading ONLY the
// updated URL, exactly like a page reload — correctly resolves to the
// terminal renderer via applyPassengerStatusFromQuery(), without needing
// any additional storage write. ──
reset();
delete globalThis.__BD_API_BASE__;
saveActiveRide(baseRide('trip_ordT', RIDE_STATUS.DRIVER_EN_ROUTE));
mountPassenger();
await navigate('/active-ride?role=passenger&status=COMPLETED&tripId=trip_ordT');
{
  expect('S21: a fresh mount reading the URL-synced ?status=COMPLETED alone (backend-off, simulating a reload) resolves to the terminal COMPLETE renderer for the SAME trip',
    app.querySelector('.active-ride-passenger--complete') !== null && tripLabelText().includes('trip_ordT'),
    tripLabelText());
}

// ── Scenario 22 — #939 Codex review-fix P2: passenger/driver/route
// neutralization end-to-end. A realistic server payload with genuinely null
// driver/passenger/route fields (serializeRide()'s own `?? null` shape) must
// never let the stale local/demo driver name or route addresses survive on
// an authoritative ride — on the live sheet (top card / route block).
//
// Focused pre-commit audit follow-up — the ORIGINAL version of this
// scenario seeded the LOCAL record with baseRide()'s own generic defaults
// ('Илья С.' / 'A' / 'B') but then only asserted the RENDER FUNCTION's own
// internal demo-fallback constant ('Рустам К.') was absent — which is
// trivially guaranteed by the authoritative ternary's own structure and
// proves nothing about whether mergeServerRide() actually discarded the
// SEEDED stale value. A distinctive, easily-greppable stale seed (never
// used anywhere else in this file, and not equal to any built-in demo
// constant) makes this a real, positive proof that the specific pre-merge
// local value does not leak through. ──
reset();
globalThis.__BD_API_BASE__ = 'https://fake.test';
let resolveFetch22;
globalThis.fetch = (url) => {
  if (String(url).includes('/ride-state/rides/')) {
    return new Promise((resolve) => { resolveFetch22 = resolve; });
  }
  return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({}) });
};
seedHandedOffOrder(['ordU', 'trip_ordU']);
saveActiveRide(baseRide('trip_ordU', RIDE_STATUS.DRIVER_EN_ROUTE, {
  driver: { name: 'Форсаж Дрифтович', initials: 'ФД', rating: '3,33' },
  route: { pickupLabel: 'ул. Небывалая, 404', dropoffLabel: 'тупик Задачи, 500' },
}));
mountPassenger();
await navigate('/active-ride?role=passenger&status=DRIVER_EN_ROUTE&tripId=trip_ordU');
resolveFetch22({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    ride: {
      tripId: 'trip_ordU',
      status: RIDE_STATUS.DRIVER_EN_ROUTE,
      // Realistic serializeRide() shape: every field present, driver/route
      // genuinely null (never omitted — the server always includes the
      // sub-object, per server/src/serialize.js).
      driver: { name: null, initials: null, rating: null, car: null },
      passenger: { name: null, initials: null, rating: null, phoneMasked: null },
      route: { pickupLabel: null, dropoffLabel: null, etaToPickup: null, etaToDestination: null },
      order: { offerPrice: '820 ₽' },
      timestamps: { createdAt: new Date().toISOString() },
    },
  }),
});
await tick(12);
{
  const sheetText22 = currentSheet()?.textContent || '';
  const topCardText22 = app.querySelector('.active-ride-passenger__top-card')?.textContent || '';
  expect('S22: authoritative live sheet shows neither the distinctive stale local seed nor the render function\'s own internal demo fallback for the SERVER-POPULATED fields (driver.name, route labels), when the server genuinely returns null for them',
    !topCardText22.includes('Форсаж')
      && !sheetText22.includes('Небывалая')
      && !sheetText22.includes('Задачи')
      && !topCardText22.includes('Рустам')
      && !sheetText22.includes('Малая Бронная')
      && !sheetText22.includes('Шереметьево'));
  expect('S22: the top card shows the neutral "—" for driver NAME instead of silently blanking or crashing',
    (app.querySelector('.active-ride-passenger__driver-name')?.textContent || '').includes('—'));
  expect('S22: the route block shows the neutral "—" for pickup/dropoff instead of silently blanking or crashing',
    Array.from(app.querySelectorAll('.active-ride-passenger__route-main')).every((n) => (n.textContent || '').trim() === '—'));
  // #939 focused pre-commit audit round 5 — a SECOND independent audit
  // found round 4's "driver.initials survives" behavior was itself the bug:
  // when NO canonical local record exists, this same "survival" preserves
  // createDemoActiveRide()'s own FABRICATED default ('РК'), rendered as if
  // server-confirmed. mergeServerRide now derives driver.initials from the
  // CONFIRMED srv.driver.name instead — when the server genuinely nulls
  // the name (this scenario), initials must be neutral too, matching the
  // name's own '—' state, never the stale seeded 'ФД'.
  expect('S22: the avatar shows the neutral "—" (derived from the null confirmed name), never the stale seeded "ФД" nor the built-in demo "РК"',
    (app.querySelector('.active-ride-passenger__avatar')?.textContent || '').includes('—')
      && !(app.querySelector('.active-ride-passenger__avatar')?.textContent || '').includes('ФД')
      && !(app.querySelector('.active-ride-passenger__avatar')?.textContent || '').includes('РК'));
}
delete globalThis.__BD_API_BASE__;
delete globalThis.fetch;

// ── Scenario 22b — #939 focused pre-commit audit round 5: the positive
// counterpart to S22 — the server CONFIRMS a real driver, but a DIFFERENT
// one from the stale local seed (proving both the demo-leak fix AND the
// "stale local initials next to a different confirmed name" desync an
// independent audit reproduced directly at runtime). The avatar must show
// initials freshly DERIVED from the confirmed name ('ТО' for 'Тимофей
// Орлов'), never the stale local 'ФД', matching the confirmed driver-name
// text exactly (initials and name can never disagree again). ──
reset();
globalThis.__BD_API_BASE__ = 'https://fake.test';
let resolveFetch22b;
globalThis.fetch = (url) => {
  if (String(url).includes('/ride-state/rides/')) {
    return new Promise((resolve) => { resolveFetch22b = resolve; });
  }
  return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({}) });
};
seedHandedOffOrder(['ordU2', 'trip_ordU2']);
saveActiveRide(baseRide('trip_ordU2', RIDE_STATUS.DRIVER_EN_ROUTE, {
  driver: { name: 'Форсаж Дрифтович', initials: 'ФД', rating: '3,33' },
}));
mountPassenger();
await navigate('/active-ride?role=passenger&status=DRIVER_EN_ROUTE&tripId=trip_ordU2');
resolveFetch22b({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    ride: {
      tripId: 'trip_ordU2',
      status: RIDE_STATUS.DRIVER_EN_ROUTE,
      driver: { name: 'Тимофей Орлов', initials: null, rating: '4,80', car: 'Kia Rio' },
      passenger: { name: null, initials: null, rating: null, phoneMasked: null },
      route: { pickupLabel: 'ул. Тестовая, 51', dropoffLabel: 'ул. Финишная, 52', etaToPickup: null, etaToDestination: null },
      order: { offerPrice: '640 ₽' },
      timestamps: { createdAt: new Date().toISOString() },
    },
  }),
});
await tick(12);
{
  const driverNameText22b = app.querySelector('.active-ride-passenger__driver-name')?.textContent || '';
  const avatarText22b = app.querySelector('.active-ride-passenger__avatar')?.textContent || '';
  expect('S22b: the top card shows the CONFIRMED driver name ("Тимофей Орлов"), never the stale local "Форсаж Дрифтович"',
    driverNameText22b.includes('Тимофей Орлов') && !driverNameText22b.includes('Форсаж'),
    driverNameText22b);
  expect('S22b: the avatar shows initials DERIVED from the confirmed name ("ТО"), never the stale local "ФД" — proving initials and name can no longer disagree when the confirmed driver differs from the local seed',
    avatarText22b.includes('ТО') && !avatarText22b.includes('ФД'),
    avatarText22b);
}
delete globalThis.__BD_API_BASE__;
delete globalThis.fetch;

// ── Scenario 23 — #939 focused pre-commit audit follow-up: passenger/
// driver/route neutralization on the TERMINAL COMPLETE renderer
// specifically (S22 only covered the live, non-terminal sheet — the audit
// flagged that item 7 explicitly asked for BOTH). A realistic authoritative
// COMPLETED GET with driver/route genuinely null must show neutral values
// on renderPassengerRideComplete's own DOM, and must not leak a distinctive
// stale LOCAL seed (deliberately different from S22's, so no cross-
// scenario coincidence could mask a real leak). passenger.name/initials/
// rating/phoneMasked are also sent (matching the realistic serializeRide()
// shape) but are NOT independently asserted here: this screen has zero DOM
// consumers for ride.passenger.* anywhere (re-confirmed by grep before
// writing this scenario) — there is structurally nothing to check against,
// which is a real, stated limitation of this coverage, not an oversight. ──
reset();
globalThis.__BD_API_BASE__ = 'https://fake.test';
let resolveFetch23;
globalThis.fetch = (url) => {
  if (String(url).includes('/ride-state/rides/')) {
    return new Promise((resolve) => { resolveFetch23 = resolve; });
  }
  return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({}) });
};
seedHandedOffOrder(['ordW', 'trip_ordW']);
saveActiveRide(baseRide('trip_ordW', RIDE_STATUS.DRIVER_EN_ROUTE, {
  driver: { name: 'Ветер Полуночный', initials: 'ВП', rating: '2,71' },
  route: { pickupLabel: 'бул. Затерянный, 88', dropoffLabel: 'пл. Забвения, 13' },
}));
mountPassenger();
await navigate('/active-ride?role=passenger&status=DRIVER_EN_ROUTE&tripId=trip_ordW');
resolveFetch23({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    ride: {
      tripId: 'trip_ordW',
      status: RIDE_STATUS.COMPLETED,
      // Realistic serializeRide() shape: every sub-object present,
      // driver/route/passenger genuinely null field-by-field (never
      // omitted — see server/src/serialize.js).
      driver: { name: null, initials: null, rating: null, car: null },
      passenger: { name: null, initials: null, rating: null, phoneMasked: null },
      route: { pickupLabel: null, dropoffLabel: null, etaToPickup: null, etaToDestination: null },
      order: { offerPrice: '910 ₽' },
      timestamps: { createdAt: new Date().toISOString() },
    },
  }),
});
await tick(12);
{
  const completeText23 = app.querySelector('.active-ride-passenger--complete')?.textContent || '';
  expect('S23: the terminal COMPLETE renderer swaps in correctly for an authoritative COMPLETED GET',
    app.querySelector('.active-ride-passenger--complete') !== null);
  // #939 focused pre-commit audit round 4 — same ALWAYS_NULL_COLUMNS
  // carve-out as S22: driver.initials ('ВП') correctly SURVIVES a server
  // response that genuinely nulls it, so it is deliberately excluded from
  // this "must never leak" list and checked as a positive survival instead
  // (below). Only driver.name and the route labels — both server-
  // populated — must actually show the neutral '—'.
  expect('S23: the terminal COMPLETE renderer shows neither the distinctive stale local seed nor any built-in demo fallback for the SERVER-POPULATED fields (driver.name, route labels), when the server genuinely returns null for them',
    !completeText23.includes('Ветер')
      && !completeText23.includes('Затерянный')
      && !completeText23.includes('Забвения')
      && !completeText23.includes('Рустам')
      && !completeText23.includes('Малая Бронная')
      && !completeText23.includes('Шереметьево'));
  expect('S23: the terminal COMPLETE renderer shows the neutral "—" for driver NAME',
    (app.querySelector('.active-ride-passenger--complete .active-ride-passenger__driver-name')?.textContent || '').includes('—'));
  expect('S23: the terminal COMPLETE renderer shows the neutral "—" for both pickup and dropoff',
    Array.from(app.querySelectorAll('.active-ride-passenger--complete .active-ride-passenger__route-main')).length === 2
      && Array.from(app.querySelectorAll('.active-ride-passenger--complete .active-ride-passenger__route-main')).every((n) => (n.textContent || '').trim() === '—'));
  // #939 focused pre-commit audit round 5 — same fix as S22: driver.initials
  // is now derived from the confirmed (here: null) srv.driver.name, so the
  // terminal renderer's avatar must also show the neutral '—', never the
  // stale local 'ВП' nor the built-in demo 'РК'.
  expect('S23: the terminal COMPLETE renderer\'s avatar shows the neutral "—" (derived from the null confirmed name), never the stale local "ВП" nor the built-in demo "РК"',
    (() => {
      const t = app.querySelector('.active-ride-passenger--complete .active-ride-passenger__avatar')?.textContent || '';
      return t.includes('—') && !t.includes('ВП') && !t.includes('РК');
    })());
}
delete globalThis.__BD_API_BASE__;
delete globalThis.fetch;

// ── Scenario 23b — #939 focused pre-commit audit round 5: the positive
// counterpart to S23 — the terminal COMPLETE renderer must show initials
// DERIVED from a genuinely CONFIRMED driver name, never the stale local
// seed, mirroring S22b for the terminal path. ──
reset();
globalThis.__BD_API_BASE__ = 'https://fake.test';
let resolveFetch23b;
globalThis.fetch = (url) => {
  if (String(url).includes('/ride-state/rides/')) {
    return new Promise((resolve) => { resolveFetch23b = resolve; });
  }
  return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({}) });
};
seedHandedOffOrder(['ordW2', 'trip_ordW2']);
saveActiveRide(baseRide('trip_ordW2', RIDE_STATUS.DRIVER_EN_ROUTE, {
  driver: { name: 'Ветер Полуночный', initials: 'ВП', rating: '2,71' },
}));
mountPassenger();
await navigate('/active-ride?role=passenger&status=DRIVER_EN_ROUTE&tripId=trip_ordW2');
resolveFetch23b({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    ride: {
      tripId: 'trip_ordW2',
      status: RIDE_STATUS.COMPLETED,
      driver: { name: 'Марат Гусев', initials: null, rating: '4,20', car: 'Hyundai Solaris' },
      passenger: { name: null, initials: null, rating: null, phoneMasked: null },
      route: { pickupLabel: 'ул. Тестовая, 61', dropoffLabel: 'ул. Финишная, 62', etaToPickup: null, etaToDestination: null },
      order: { offerPrice: '710 ₽' },
      timestamps: { createdAt: new Date().toISOString(), completedAt: new Date().toISOString() },
    },
  }),
});
await tick(12);
{
  const driverNameText23b = app.querySelector('.active-ride-passenger--complete .active-ride-passenger__driver-name')?.textContent || '';
  const avatarText23b = app.querySelector('.active-ride-passenger--complete .active-ride-passenger__avatar')?.textContent || '';
  expect('S23b: the terminal COMPLETE renderer shows the CONFIRMED driver name ("Марат Гусев"), never the stale local "Ветер Полуночный"',
    driverNameText23b.includes('Марат Гусев') && !driverNameText23b.includes('Ветер'),
    driverNameText23b);
  expect('S23b: the terminal COMPLETE renderer\'s avatar shows initials DERIVED from the confirmed name ("МГ"), never the stale local "ВП"',
    avatarText23b.includes('МГ') && !avatarText23b.includes('ВП'),
    avatarText23b);
}
delete globalThis.__BD_API_BASE__;
delete globalThis.fetch;

// ── Scenario 24 — #939 focused pre-commit audit round 7: FOUR successive
// independent audits (4/5/6/7) each found that trying to trust a LOCAL
// route.etaToDestination value — however "real" it was made to look — can
// always be defeated (round 6's own orderId/tripId/localProvenance gate
// was defeated by an unrelated repair helper stripping localProvenance
// from storage, AND by the shipped composer.js publish path making a
// GENUINE accepted ride's route/order ETA carry the identical fabricated
// literal). This scenario constructs the MOST realistic-looking local
// record a gate could ever demand — real orderId, tripId matching
// `trip_${orderId}`, route.etaToDestination/order.destinationEta
// consistent with each other, no sim_audit stamp — and proves it no
// longer matters at all: an authoritative GET with a genuinely null
// route.etaToDestination shows the neutral "—" regardless. Mounts plain
// IN_PROGRESS (not the ARRIVING_DROPOFF sub-phase, which uses the
// separate, already-covered arrivingDropoffInfo() — see S29). ──
reset();
globalThis.__BD_API_BASE__ = 'https://fake.test';
let resolveFetch24;
globalThis.fetch = (url) => {
  if (String(url).includes('/ride-state/rides/')) {
    return new Promise((resolve) => { resolveFetch24 = resolve; });
  }
  return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({}) });
};
seedHandedOffOrder(['ordX', 'trip_ordX']);
saveActiveRide(baseRide('trip_ordX', RIDE_STATUS.IN_PROGRESS, {
  orderId: 'ordX',
  route: { pickupLabel: 'A', dropoffLabel: 'B', etaToDestination: '99 мин' },
  order: { offerPrice: '1 240 ₽', destinationEta: '99 мин' },
}));
mountPassenger();
await navigate('/active-ride?role=passenger&status=IN_PROGRESS&tripId=trip_ordX');
resolveFetch24({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    ride: {
      tripId: 'trip_ordX',
      status: RIDE_STATUS.IN_PROGRESS,
      driver: { name: 'Юрий Р.', initials: null, rating: '4,50' },
      passenger: { name: 'Анна П.', initials: 'АП' },
      route: { pickupLabel: 'ул. Тестовая, 13', dropoffLabel: 'ул. Финишная, 14', etaToPickup: null, etaToDestination: null },
      order: { offerPrice: '540 ₽' },
      timestamps: { createdAt: new Date().toISOString() },
      // No `ride` sub-object — a real serializeRide() never emits it.
    },
  }),
});
await tick(12);
{
  const etaValueText24 = app.querySelector('.active-ride-passenger__top-card-eta-value')?.textContent || '';
  expect('S24: an authoritative IN_PROGRESS ride with the MOST realistic-looking local route.etaToDestination/order.destinationEta ("99 мин", real orderId/tripId, consistent) and the server genuinely null STILL shows the neutral "—" — local is never consulted at all, no matter how real it looks',
    etaValueText24 === '—',
    etaValueText24);
}
delete globalThis.__BD_API_BASE__;
delete globalThis.fetch;

// ── Scenario 24b — #939 focused pre-commit audit round 7: the positive
// counterpart to S24 — a realistic authoritative GET where the SERVER
// itself sends a real, non-null route.etaToDestination. This column is
// provably never populated by any write path today (ALWAYS_NULL_COLUMNS
// in select-recovery-linkage.js), so this response shape is synthetic —
// it proves the CODE is ready for a future real server value, not that
// today's backend ever sends one. The local record deliberately carries a
// DIFFERENT stale value ("15 мин") to prove the server value wins over it
// unconditionally. ──
reset();
globalThis.__BD_API_BASE__ = 'https://fake.test';
let resolveFetch24b;
globalThis.fetch = (url) => {
  if (String(url).includes('/ride-state/rides/')) {
    return new Promise((resolve) => { resolveFetch24b = resolve; });
  }
  return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({}) });
};
seedHandedOffOrder(['ordY', 'trip_ordY']);
saveActiveRide(baseRide('trip_ordY', RIDE_STATUS.IN_PROGRESS, {
  route: { pickupLabel: 'A', dropoffLabel: 'B', etaToDestination: '15 мин' },
}));
mountPassenger();
await navigate('/active-ride?role=passenger&status=IN_PROGRESS&tripId=trip_ordY');
resolveFetch24b({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    ride: {
      tripId: 'trip_ordY',
      status: RIDE_STATUS.IN_PROGRESS,
      driver: { name: 'Олег Н.', initials: 'ОН', rating: '4,10' },
      passenger: { name: 'Анна П.', initials: 'АП' },
      route: { pickupLabel: 'ул. Тестовая, 21', dropoffLabel: 'ул. Финишная, 22', etaToPickup: null, etaToDestination: '6 мин' },
      order: { offerPrice: '640 ₽' },
      timestamps: { createdAt: new Date().toISOString() },
    },
  }),
});
await tick(12);
{
  const etaValueText24b = app.querySelector('.active-ride-passenger__top-card-eta-value')?.textContent || '';
  expect('S24b: a synthetic-but-real server-supplied route.etaToDestination ("6 мин") is shown, never the stale local "15 мин" nor the "17 мин" demo fallback — server-or-neutral means a real server value always wins',
    etaValueText24b === '6 мин',
    etaValueText24b);
}
delete globalThis.__BD_API_BASE__;
delete globalThis.fetch;

// ── Scenario 24c — #939 focused pre-commit audit round 5/6, kept as a
// permanent regression pin under round 7's new policy: the EXACT
// SIM_AUDIT_RIDE_OVERRIDES reproduction a second independent audit ran
// directly at runtime. No saveActiveRide/seedHandedOffOrder call at all
// (genuinely no canonical record AND no driver-handoff snapshot for this
// tripId) — mounting with a `?status=` query makes
// loadPassengerRideView's useSimOverrides true, so `ride =
// createDemoActiveRide({tripId, ...SIM_AUDIT_RIDE_OVERRIDES})`.
// SIM_AUDIT_RIDE_OVERRIDES (ride_state.js) sets route.etaToDestination AND
// order.destinationEta to the SAME literal ('28 мин') — historically the
// hardest case to catch, since every structural signal a gate could ever
// check agreed. Under round 7's server-or-neutral policy this needs no
// gate at all: local is never read, so this now passes trivially — kept
// as a named pin specifically so this literal never silently reappears if
// a future change reintroduces ANY local read for this field. ──
reset();
globalThis.__BD_API_BASE__ = 'https://fake.test';
let resolveFetch24c;
globalThis.fetch = (url) => {
  if (String(url).includes('/ride-state/rides/')) {
    return new Promise((resolve) => { resolveFetch24c = resolve; });
  }
  return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({}) });
};
mountPassenger();
await navigate('/active-ride?role=passenger&status=IN_PROGRESS&tripId=trip_ordGG');
resolveFetch24c({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    ride: {
      tripId: 'trip_ordGG',
      status: RIDE_STATUS.IN_PROGRESS,
      driver: { name: null, initials: null, rating: null, car: null },
      passenger: { name: null, initials: null, rating: null, phoneMasked: null },
      route: { pickupLabel: null, dropoffLabel: null, etaToPickup: null, etaToDestination: null },
      order: { offerPrice: null },
      timestamps: { createdAt: new Date().toISOString() },
    },
  }),
});
await tick(12);
{
  const etaValueText24c = app.querySelector('.active-ride-passenger__top-card-eta-value')?.textContent || '';
  const avatarText24c = app.querySelector('.active-ride-passenger__avatar')?.textContent || '';
  expect('S24c: no canonical record + a statusQuery-triggered SIM_AUDIT fallback (whose route.etaToDestination/order.destinationEta happen to genuinely agree, "28 мин") shows the neutral "—" ETA on an authoritative GET — the historical hardest-to-catch case, now trivially correct since local is never consulted',
    etaValueText24c === '—',
    etaValueText24c);
  expect('S24c: the same SIM_AUDIT fallback\'s avatar shows the neutral "—", never the built-in demo "РК"',
    avatarText24c === '—' || avatarText24c.includes('—'),
    avatarText24c);
}
delete globalThis.__BD_API_BASE__;
delete globalThis.fetch;

// ── Scenario 25 — #939 focused pre-commit audit round 4: a truthy `srv`
// with no `status` field at all (a malformed 2xx — e.g. `{ride: {}}`,
// which getRideFromBackend's own validation in mock_api.js already accepts
// as a well-formed truthy `r.ride` object, since it only checks `typeof
// r.ride === 'object'`, never that it carries a `status` key) must never be
// treated as a confirmation. On the very FIRST-EVER read, with a usable
// local record already present, the OLD code would have silently resolved
// mergeServerRide's `srv.status || ride.status` to the unconfirmed local
// status while still marking hasConfirmedServerRide = true right after —
// this proves the fix at the live-DOM level: the screen must show ERROR,
// exactly like S14's 5xx case, never the promoted stale local sheet. ──
reset();
globalThis.__BD_API_BASE__ = 'https://fake.test';
let resolveFetch25;
globalThis.fetch = (url) => {
  if (String(url).includes('/ride-state/rides/')) {
    return new Promise((resolve) => { resolveFetch25 = resolve; });
  }
  return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({}) });
};
seedHandedOffOrder(['ordZ', 'trip_ordZ']);
saveActiveRide(baseRide('trip_ordZ', RIDE_STATUS.DRIVER_EN_ROUTE));
mountPassenger();
await navigate('/active-ride?role=passenger&status=DRIVER_EN_ROUTE&tripId=trip_ordZ');
resolveFetch25({ ok: true, status: 200, text: async () => JSON.stringify({ ride: {} }) });
await tick(12);
{
  expect('S25: a truthy but status-less ("malformed 2xx") first-ever read shows the ERROR state, never a confirmed-and-promoted stale local DRIVER_EN_ROUTE sheet',
    currentSheet()?.dataset.status === 'error', currentSheet()?.dataset.status);
}
delete globalThis.__BD_API_BASE__;
delete globalThis.fetch;

// ── Scenario 26 — #939 focused pre-commit audit round 4/7: etaText's
// order.pickupEta has no serializeRide() contract field behind it at all
// (order only ever carries offerPrice). round 7 — a fourth independent
// audit found order.pickupEta/destinationEta/destinationDistance were the
// one place the old keep()-based merge still silently preserved local/
// demo literals indefinitely, so this scenario now deliberately seeds a
// REAL-looking local pickupEta ("99 мин") to prove it is genuinely never
// consulted any more, not merely that there was nothing to leak before. ──
reset();
globalThis.__BD_API_BASE__ = 'https://fake.test';
let resolveFetch26;
globalThis.fetch = (url) => {
  if (String(url).includes('/ride-state/rides/')) {
    return new Promise((resolve) => { resolveFetch26 = resolve; });
  }
  return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({}) });
};
seedHandedOffOrder(['ordAA', 'trip_ordAA']);
saveActiveRide(baseRide('trip_ordAA', RIDE_STATUS.DRIVER_EN_ROUTE, {
  order: { offerPrice: '500 ₽', pickupEta: '99 мин' },
}));
mountPassenger();
await navigate('/active-ride?role=passenger&status=DRIVER_EN_ROUTE&tripId=trip_ordAA');
resolveFetch26({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    ride: {
      tripId: 'trip_ordAA',
      status: RIDE_STATUS.DRIVER_EN_ROUTE,
      driver: { name: 'Павел Т.', initials: 'ПТ', rating: '4,60' },
      passenger: { name: 'Анна П.', initials: 'АП' },
      route: { pickupLabel: 'ул. Тестовая, 31', dropoffLabel: 'ул. Финишная, 32' },
      order: { offerPrice: '500 ₽' },
      timestamps: { createdAt: new Date().toISOString() },
    },
  }),
});
await tick(12);
{
  const etaValueText26 = app.querySelector('.active-ride-passenger__top-card-eta-value')?.textContent || '';
  expect('S26: an authoritative DRIVER_EN_ROUTE ride with a REAL-looking local order.pickupEta ("99 мин") but the server genuinely null shows the neutral "—" ETA — local is never consulted, never the "4 мин" demo fallback either',
    etaValueText26 === '—',
    etaValueText26);
}
delete globalThis.__BD_API_BASE__;
delete globalThis.fetch;

// ── Scenario 26b — #939 focused pre-commit audit round 7: the positive
// counterpart to S26 — a synthetic-but-real server-supplied
// order.pickupEta. serializeRide()'s real `order` shape has never carried
// this field either, so this response is synthetic (proving code
// readiness, not today's backend behavior) — a real server value must
// still win over a different stale local one. ──
reset();
globalThis.__BD_API_BASE__ = 'https://fake.test';
let resolveFetch26b;
globalThis.fetch = (url) => {
  if (String(url).includes('/ride-state/rides/')) {
    return new Promise((resolve) => { resolveFetch26b = resolve; });
  }
  return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({}) });
};
seedHandedOffOrder(['ordA2', 'trip_ordA2']);
saveActiveRide(baseRide('trip_ordA2', RIDE_STATUS.DRIVER_EN_ROUTE, {
  order: { offerPrice: '500 ₽', pickupEta: '99 мин' },
}));
mountPassenger();
await navigate('/active-ride?role=passenger&status=DRIVER_EN_ROUTE&tripId=trip_ordA2');
resolveFetch26b({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    ride: {
      tripId: 'trip_ordA2',
      status: RIDE_STATUS.DRIVER_EN_ROUTE,
      driver: { name: 'Павел Т.', initials: 'ПТ', rating: '4,60' },
      passenger: { name: 'Анна П.', initials: 'АП' },
      route: { pickupLabel: 'ул. Тестовая, 31', dropoffLabel: 'ул. Финишная, 32' },
      order: { offerPrice: '500 ₽', pickupEta: '7 мин' },
      timestamps: { createdAt: new Date().toISOString() },
    },
  }),
});
await tick(12);
{
  const etaValueText26b = app.querySelector('.active-ride-passenger__top-card-eta-value')?.textContent || '';
  expect('S26b: a synthetic-but-real server-supplied order.pickupEta ("7 мин") is shown, never the stale local "99 мин" nor the "4 мин" demo fallback',
    etaValueText26b === '7 мин',
    etaValueText26b);
}
delete globalThis.__BD_API_BASE__;
delete globalThis.fetch;

// ── Scenario 27 — #939 focused pre-commit audit round 4/7: completedStats'
// order.destinationEta/destinationDistance have no serializeRide() contract
// field either (same reasoning as S26). round 7 — deliberately seeds
// REAL-looking local values ("99 мин"/"77 км") to prove they are genuinely
// never consulted any more. A real timestamps.completedAt is included so
// formatCompletedAt's OWN separate arrivalTime-based fallback (a distinct,
// out-of-scope ungated literal noted for follow-up) never fires and cannot
// mask this assertion. ──
reset();
globalThis.__BD_API_BASE__ = 'https://fake.test';
let resolveFetch27;
globalThis.fetch = (url) => {
  if (String(url).includes('/ride-state/rides/')) {
    return new Promise((resolve) => { resolveFetch27 = resolve; });
  }
  return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({}) });
};
seedHandedOffOrder(['ordBB', 'trip_ordBB']);
saveActiveRide(baseRide('trip_ordBB', RIDE_STATUS.DRIVER_EN_ROUTE, {
  order: { offerPrice: '700 ₽', destinationEta: '99 мин', destinationDistance: '77 км' },
}));
mountPassenger();
await navigate('/active-ride?role=passenger&status=DRIVER_EN_ROUTE&tripId=trip_ordBB');
resolveFetch27({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    ride: {
      tripId: 'trip_ordBB',
      status: RIDE_STATUS.COMPLETED,
      driver: { name: 'Семён Д.', initials: 'СД', rating: '4,70' },
      passenger: { name: 'Анна П.', initials: 'АП' },
      route: { pickupLabel: 'ул. Тестовая, 41', dropoffLabel: 'ул. Финишная, 42' },
      order: { offerPrice: '700 ₽' },
      timestamps: { createdAt: new Date().toISOString(), completedAt: new Date().toISOString() },
    },
  }),
});
await tick(12);
{
  // .passenger-complete__stat-value renders THREE stats in template order:
  // time, distance, completedAt (the last from formatCompletedAt, a
  // separate function with its own out-of-scope fallback — see the
  // scenario comment above). Only the first two (time/distance) are
  // completedStats' own fields under test here.
  const statValues27 = Array.from(app.querySelectorAll('.active-ride-passenger--complete .passenger-complete__stat-value'))
    .map((n) => (n.textContent || '').trim());
  expect('S27: an authoritative COMPLETED ride with REAL-looking local order.destinationEta/destinationDistance ("99 мин"/"77 км") but the server genuinely null shows the neutral "—" for both completedStats fields — local is never consulted, never "42 мин"/"38 км" either',
    statValues27.length === 3 && statValues27[0] === '—' && statValues27[1] === '—',
    statValues27);
}
delete globalThis.__BD_API_BASE__;
delete globalThis.fetch;

// ── Scenario 27b — #939 focused pre-commit audit round 7: the positive
// counterpart to S27 — synthetic-but-real server-supplied
// destinationEta/destinationDistance, proving code readiness for a future
// real backend value; must win over different stale local ones. ──
reset();
globalThis.__BD_API_BASE__ = 'https://fake.test';
let resolveFetch27b;
globalThis.fetch = (url) => {
  if (String(url).includes('/ride-state/rides/')) {
    return new Promise((resolve) => { resolveFetch27b = resolve; });
  }
  return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({}) });
};
seedHandedOffOrder(['ordB2', 'trip_ordB2']);
saveActiveRide(baseRide('trip_ordB2', RIDE_STATUS.DRIVER_EN_ROUTE, {
  order: { offerPrice: '700 ₽', destinationEta: '99 мин', destinationDistance: '77 км' },
}));
mountPassenger();
await navigate('/active-ride?role=passenger&status=DRIVER_EN_ROUTE&tripId=trip_ordB2');
resolveFetch27b({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    ride: {
      tripId: 'trip_ordB2',
      status: RIDE_STATUS.COMPLETED,
      driver: { name: 'Семён Д.', initials: 'СД', rating: '4,70' },
      passenger: { name: 'Анна П.', initials: 'АП' },
      route: { pickupLabel: 'ул. Тестовая, 41', dropoffLabel: 'ул. Финишная, 42' },
      order: { offerPrice: '700 ₽', destinationEta: '19 мин', destinationDistance: '15 км' },
      timestamps: { createdAt: new Date().toISOString(), completedAt: new Date().toISOString() },
    },
  }),
});
await tick(12);
{
  const statValues27b = Array.from(app.querySelectorAll('.active-ride-passenger--complete .passenger-complete__stat-value'))
    .map((n) => (n.textContent || '').trim());
  expect('S27b: synthetic-but-real server-supplied destinationEta/destinationDistance ("19 мин"/"15 км") are shown, never the stale local "99 мин"/"77 км" nor the "42 мин"/"38 км" demo fallback',
    statValues27b.length === 3 && statValues27b[0] === '19 мин' && statValues27b[1] === '15 км',
    statValues27b);
}
delete globalThis.__BD_API_BASE__;
delete globalThis.fetch;

// ── Scenario 28 — #939 focused pre-commit audit round 5: arrivingDropoffInfo
// non-authoritative/backend-off branch, pinning the byte-for-byte baseline
// revert. A REAL route.etaToDestination is deliberately seeded locally (the
// value that round 4's now-reverted swap WOULD have shown) to prove it is
// NOT consulted at all in this branch — the ARRIVING_DROPOFF top-card ETA
// must show the exact prior '1 мин' literal regardless. ──
reset();
delete globalThis.__BD_API_BASE__;
saveActiveRide(baseRide('trip_ordDD', RIDE_STATUS.IN_PROGRESS, {
  route: { pickupLabel: 'A', dropoffLabel: 'B', etaToDestination: '55 мин' },
}));
mountPassenger();
await navigate('/active-ride?role=passenger&status=IN_PROGRESS&tripId=trip_ordDD&phase=arriving_dropoff');
{
  const etaValueText28 = app.querySelector('.active-ride-passenger__top-card-eta-value')?.textContent || '';
  expect('S28: local/backend-off ARRIVING_DROPOFF shows the exact prior "1 мин" fallback, never the real local route.etaToDestination ("55 мин") — the non-authoritative branch reads route.etaToDropoff (a field that does not exist), byte-for-byte reverted to baseline',
    etaValueText28 === '1 мин',
    etaValueText28);
}

// ── Scenario 29 — #939 focused pre-commit audit round 7: arrivingDropoffInfo
// authoritative branch — the SAME "local ignored, however real it looks"
// proof as S24, but for the ARRIVING_DROPOFF phase specifically (its own
// consumer function, sharing the same merged route.etaToDestination). ──
reset();
globalThis.__BD_API_BASE__ = 'https://fake.test';
let resolveFetch29;
globalThis.fetch = (url) => {
  if (String(url).includes('/ride-state/rides/')) {
    return new Promise((resolve) => { resolveFetch29 = resolve; });
  }
  return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({}) });
};
seedHandedOffOrder(['ordEE', 'trip_ordEE']);
saveActiveRide(baseRide('trip_ordEE', RIDE_STATUS.IN_PROGRESS, {
  orderId: 'ordEE',
  route: { pickupLabel: 'A', dropoffLabel: 'B', etaToDestination: '2 мин' },
  order: { offerPrice: '1 240 ₽', destinationEta: '2 мин' },
}));
mountPassenger();
await navigate('/active-ride?role=passenger&status=IN_PROGRESS&tripId=trip_ordEE&phase=arriving_dropoff');
resolveFetch29({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    ride: {
      tripId: 'trip_ordEE',
      status: RIDE_STATUS.IN_PROGRESS,
      driver: { name: 'Глеб С.', initials: null, rating: '4,60' },
      passenger: { name: 'Анна П.', initials: 'АП' },
      route: { pickupLabel: 'ул. Тестовая, 71', dropoffLabel: 'ул. Финишная, 72', etaToPickup: null, etaToDestination: null },
      order: { offerPrice: '480 ₽' },
      timestamps: { createdAt: new Date().toISOString() },
    },
  }),
});
await tick(12);
{
  const etaValueText29 = app.querySelector('.active-ride-passenger__top-card-eta-value')?.textContent || '';
  expect('S29: authoritative IN_PROGRESS+ARRIVING_DROPOFF with the MOST realistic-looking local route.etaToDestination/order.destinationEta ("2 мин") and the server genuinely null STILL shows the neutral "—" — local is never consulted, never the "1 мин" backend-off fallback either',
    etaValueText29 === '—',
    etaValueText29);
}
delete globalThis.__BD_API_BASE__;
delete globalThis.fetch;

// S22/S22b/S23b/S24/S24b/S24c/S25/S26/S26b/S27/S27b/S29 are backend-enabled
// with a non-terminal ride (S23b/S27/S27b are terminal and settle
// synchronously, no poll/recovery timer), so most of these successful
// merges (or S25's scheduled recovery) start a real poll setInterval /
// recovery timer. Every prior scenario transition tears the previous mount
// down via the NEXT scenario's own reset() (location.hash's setter
// dispatches 'hashchange' -> teardownPassengerReads() ->
// stopPassengerRidePoll()'s clearInterval). S29 is now the last scenario
// in the file, so a final reset() is called here to clean up its own poll.
reset();

if (issues.length) {
  console.error(`\n${issues.length} runtime regression(s) failed.`);
  process.exit(1);
}
console.log('\nPassenger Active Ride LOCAL_ONLY runtime smoke passed.');
