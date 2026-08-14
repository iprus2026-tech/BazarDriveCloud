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
  const win = {
    location,
    document: doc,
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
  return { win, location };
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
const { win, location } = createWindow(doc);
globalThis.document = doc;
globalThis.window = win;
globalThis.location = location;
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
{
  expect('S10: LOCAL_ONLY settlement re-checks the store and picks up the missed transition',
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

if (issues.length) {
  console.error(`\n${issues.length} runtime regression(s) failed.`);
  process.exit(1);
}
console.log('\nPassenger Active Ride LOCAL_ONLY runtime smoke passed.');
