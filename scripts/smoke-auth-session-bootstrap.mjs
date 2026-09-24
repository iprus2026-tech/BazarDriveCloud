// 01B-A behavioral boot coverage. Uses actual controller/API/router and actual
// app.js in fresh processes with a minimal DOM and deferred fetch; no DB/network.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function storage() {
  const values = new Map();
  return { getItem: k => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, String(v)),
    removeItem: k => values.delete(k), clear: () => values.clear() };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 35; i++) await Promise.resolve(); }
const userDTO = (id = 'user-a') => ({ userId: id, sessionId: 'session-' + id,
  activeRole: 'driver', phoneVerified: true });
const response = (payload, status = 200) => ({ ok: status < 400, status,
  text: async () => JSON.stringify(payload) });

function installDOM({ parseIds = false, parseMarkup = false } = {}) {
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {};
      this.hidden = false; this.handlers = {}; this.attrs = {}; this.innerHTML = '';
      const classes = new Set();
      this.classList = {
        toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); },
        add: (...names) => names.forEach(n => classes.add(n)),
        remove: (...names) => names.forEach(n => classes.delete(n)),
        contains: name => classes.has(name),
      };
    }
    set innerHTML(html) {
      this.html = html;
      this.children = [];
      if (parseMarkup) {
        // Only create nodes present in screen markup. This is a DOM/event shim,
        // not a browser: no layout, styles, permissions, or network validation.
        const stack = [this];
        for (const match of html.matchAll(/<(\/)?([\w-]+)\b([^>]*?)>/g)) {
          const [, closing, tag, attributes] = match;
          if (closing) {
            if (stack.length > 1) stack.pop();
            continue;
          }
          const child = new Element(tag);
          for (const attr of attributes.matchAll(/([\w:-]+)(?:="([^"]*)"|='([^']*)')?/g)) {
            child.setAttribute(attr[1], (attr[2] ?? attr[3] ?? '').replaceAll('&amp;', '&'));
          }
          stack.at(-1).appendChild(child);
          if (!/\/$/.test(attributes) && !['input', 'br', 'hr', 'img', 'meta', 'link'].includes(tag)) stack.push(child);
        }
      } else if (parseIds) for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
        const child = new Element(); child.id = match[1]; this.appendChild(child);
      }
    }
    get innerHTML() { return this.html; }
    insertAdjacentHTML(position, html) {
      assert.equal(position, 'beforeend');
      const fragment = new Element(); fragment.innerHTML = html;
      fragment.children.forEach(child => this.appendChild(child));
      this.html += html;
    }
    appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
    replaceChildren(...nodes) {
      this.children.forEach(n => { n.parentNode = null; });
      this.children = []; nodes.forEach(n => this.appendChild(n));
    }
    setAttribute(key, value) {
      this.attrs[key] = String(value);
      if (key === 'id') this.id = value;
      if (key === 'class') this.className = value;
      if (key === 'disabled') this.disabled = true;
      if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    }
    getAttribute(key) { return this.attrs[key] ?? null; }
    removeAttribute(key) { delete this.attrs[key]; }
    addEventListener(type, fn) { (this.handlers[type] ??= []).push(fn); }
    removeEventListener() {}
    click() {
      if (this.disabled) return;
      const event = { target: this, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
      for (let node = this; node; node = parseMarkup ? node.parentNode : null) {
        for (const fn of node.handlers.click ?? []) fn(event);
        if (event.stopped) break;
      }
      const href = this.getAttribute('href');
      if (parseMarkup && !event.defaultPrevented && href?.startsWith('#/')) location.hash = href;
    }
    matches(selector) {
      if (!parseMarkup) return false;
      const attrs = [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
      if (attrs.some(([, key, value]) => !(key in this.attrs) || (value !== undefined && this.attrs[key] !== value))) return false;
      const plain = selector.replace(/\[[^\]]*\]/g, '');
      const id = plain.match(/#([\w-]+)/)?.[1];
      if (id && this.id !== id) return false;
      if ([...plain.matchAll(/\.([\w-]+)/g)].some(([, c]) => !(this.className || '').split(/\s+/).includes(c))) return false;
      const tag = plain.match(/^[\w-]+/)?.[0];
      return !tag || this.tagName === tag.toUpperCase();
    }
    closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) ?? null; }
    focus() {}
    contains(node) { return node === this || this.children.some(c => c.contains?.(node)); }
    find(id) { return this.id === id ? this : this.children.map(c => c.find?.(id)).find(Boolean); }
    querySelector(selector) {
      return parseMarkup ? this.querySelectorAll(selector)[0] ?? null
        : selector.startsWith('#') ? this.find(selector.slice(1)) ?? null : null;
    }
    querySelectorAll(selector) {
      if (!parseMarkup) return [];
      return this.children.flatMap(child => [
        ...(selector.split(',').some(s => child.matches(s.trim())) ? [child] : []),
        ...child.querySelectorAll(selector),
      ]);
    }
    get isConnected() { return globalThis.document?.body?.contains(this) ?? false; }
  }
  const elements = Object.fromEntries(['app', 'tabbar', 'fab', 'shell'].map(id => {
    const el = new Element(); el.id = id; return [id, el];
  }));
  const body = new Element('body');
  body.appendChild(elements.shell);
  for (const id of ['app', 'tabbar', 'fab']) elements.shell.appendChild(elements[id]);
  const created = [];
  const document = {
    body, documentElement: new Element('html'),
    createElement: tag => { const el = new Element(tag); created.push(el); return el; },
    getElementById: id => body.find(id) ?? null,
    querySelector: selector => body.querySelector(selector),
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
  };
  let hash = '#/boot-proof?deep=1';
  const listeners = new Map();
  let startCount = 0;
  const location = {
    origin: 'https://pwa.invalid', href: 'https://pwa.invalid/#/boot-proof?deep=1',
    pathname: '/', search: '',
    get hash() { return hash; },
    set hash(value) {
      const next = value.startsWith('#') ? value : '#' + value;
      if (next === hash) return;
      hash = next;
      for (const fn of listeners.get('hashchange') ?? []) queueMicrotask(fn);
    },
  };
  const window = {
    location,
    addEventListener(type, fn) {
      if (type === 'hashchange' && fn.name === 'render') startCount++;
      const list = listeners.get(type) ?? [];
      list.push(fn); listeners.set(type, list);
    },
    removeEventListener(type, fn) {
      listeners.set(type, (listeners.get(type) ?? []).filter(item => item !== fn));
    },
  };
  Object.assign(globalThis, { document, window, location,
    localStorage: storage(), sessionStorage: storage() });
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  return { elements, Element, created, starts: () => startCount };
}

async function appCase(name) {
  const dom = installDOM();
  const { register, go } = await import('../public/src/router.js');
  const { user } = await import('../public/src/state.js');
  // Contradictory legacy flags must not grant authentication or cause a
  // welcome/onboarding redirect loop. OFF/confirmed retain existing UX guards.
  user.set({ welcomeSeen: name !== 'no-token' && name !== 'anonymous',
    onboarded: true, role: 'driver', phoneVerified: true });
  const originalProfile = localStorage.getItem('bazardrive.user.v1');
  if (name !== 'no-token') localStorage.setItem('bazardrive.auth.v1',
    JSON.stringify({ token: 'fixture-token', userId: 'cached-id' }));
  const originalAuth = localStorage.getItem('bazardrive.auth.v1');
  globalThis.__BD_API_BASE__ = name === 'off' ? '' : 'https://api.invalid';
  let products = 0;
  register('/boot-proof', () => { products++; return new dom.Element('article'); });
  const first = deferred();
  const next = deferred();
  const requests = [];
  globalThis.fetch = (url, options) => {
    requests.push({ url, options });
    return (requests.length === 1 ? first : next).promise;
  };
  const errors = [];
  const originalError = console.error, originalWarn = console.warn;
  console.error = (...args) => errors.push(args.join(' '));
  console.warn = (...args) => errors.push(args.join(' '));
  await import('../public/src/app.js');
  await flush();

  if (name === 'off') {
    assert.equal(requests.length, 0); assert.equal(products, 1);
  } else if (name === 'no-token') {
    assert.equal(requests.length, 0); assert.equal(products, 0);
    assert.equal(location.hash, '#/onboarding');
    go('/driver-map'); await flush();
    assert.equal(location.hash, '#/onboarding'); assert.equal(products, 0);
  } else {
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.invalid/api/v1/auth/session');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer fixture-token');
    assert.equal(dom.starts(), 0); assert.equal(products, 0);
    assert.equal(dom.elements.app.children[0].dataset.authBootState, 'SESSION_RECONCILING');
    assert.equal(dom.elements.tabbar.hidden, true); assert.equal(dom.elements.fab.hidden, true);
    assert.equal(dom.elements.app.children[0].children[0].children[0].textContent, 'Проверяем вход…');
    // Both an external hash change and same-hash go() remain blocked before start.
    go('/boot-proof?deep=2'); go('/boot-proof?deep=2'); await flush();
    assert.equal(products, 0); assert.equal(dom.starts(), 0);

    if (name === 'valid') first.resolve(response({ user: userDTO() }));
    else if (name === 'anonymous') first.resolve(response({ user: null }));
    else if (name === 'retry-network') first.reject(new TypeError('fixture network'));
    else if (name === 'retry-malformed') first.resolve(response({ user: { userId: 'incomplete' } }));
    else first.resolve(response({ code: 'SESSION_LOOKUP_FAILED', retryable: true }, 503));
    await flush();

    if (name.startsWith('retry-')) {
      assert.equal(dom.starts(), 0); assert.equal(products, 0);
      assert.equal(dom.elements.app.children[0].dataset.authBootState, 'SESSION_UNKNOWN');
      assert.equal(dom.elements.tabbar.hidden, true); assert.equal(dom.elements.fab.hidden, true);
      const retry = document.getElementById('auth-boot-retry');
      assert.equal(retry.textContent, 'Повторить');
      retry.click(); await flush();
      assert.equal(requests.length, 2);
      assert.equal(dom.elements.app.children[0].dataset.authBootState, 'SESSION_RECONCILING');
      assert.equal(dom.starts(), 0); assert.equal(products, 0);
      next.resolve(response({ user: userDTO('retry-user') })); await flush();
    }
    if (name === 'anonymous') {
      assert.equal(products, 0); assert.equal(location.hash, '#/onboarding');
    } else {
      assert.equal(products, 1); assert.equal(location.hash, '#/boot-proof?deep=2');
    }
  }
  assert.equal(dom.starts(), 1, 'router.start adds exactly one hashchange listener');
  assert.equal(localStorage.getItem('bazardrive.auth.v1'), originalAuth, 'R1 never deletes/replaces credentials');
  assert.equal(localStorage.getItem('bazardrive.user.v1'), originalProfile, 'R1 never migrates/deletes user.v1');
  assert.deepEqual(errors, [], 'app smoke emits no console errors/warnings');
  console.error = originalError; console.warn = originalWarn;
}

async function devDocsRouteCase(name) {
  const dom = installDOM();
  const router = await import('../public/src/router.js');
  const { user } = await import('../public/src/state.js');
  const { createAuthSessionBootstrap, sessionRouteAdmission } =
    await import('../public/src/auth_session_bootstrap.js');
  const pending = deferred();
  let requests = 0;
  const controller = createAuthSessionBootstrap({
    backendEnabled: () => name !== 'off',
    readToken: () => name === 'no-bearer' ? null : 'fixture-token',
    requestSession: () => {
      requests++;
      if (name === 'reconciling') return pending.promise;
      if (name === 'unknown') throw new Error('fixture network');
      return { user: null };
    },
  });
  const reconciliation = controller.reconcile();
  await flush();
  const expected = name === 'off' ? 'LOCAL_DEMO_BOOT'
    : name === 'reconciling' ? 'SESSION_RECONCILING'
    : name === 'unknown' ? 'SESSION_UNKNOWN' : 'ANONYMOUS';
  assert.equal(controller.getSnapshot().state, expected);
  assert.equal(requests, ['off', 'no-bearer'].includes(name) ? 0 : 1);
  const admissions = [];
  router.setAdmissionGuard(path => {
    admissions.push(path);
    return sessionRouteAdmission(controller.getSnapshot(), path);
  });
  user.set({ welcomeSeen: false, onboarded: false, role: null });
  let opsLoads = 0, productLoads = 0, authLoads = 0, welcomeLoads = 0, disposed = 0;
  const opsView = new dom.Element('section');
  router.register('/ops/screens', () => {
    opsLoads++;
    return { view: opsView, dispose: () => disposed++ };
  });
  router.register('/boot-proof', () => { productLoads++; return new dom.Element(); });
  router.register('/onboarding', () => { authLoads++; return new dom.Element(); });
  router.register('/welcome', () => { welcomeLoads++; return new dom.Element(); });
  location.hash = '#/ops/screens';
  router.start(); await flush();
  assert.equal(opsLoads, 1, 'dev/docs loader must remain reachable from a clean profile');
  assert.equal(dom.elements.app.children[0], opsView, 'dev/docs must also pass admission at mount');
  assert.equal(location.hash, '#/ops/screens');
  assert.equal(authLoads, 0, 'dev/docs must not redirect to onboarding');
  assert.equal(welcomeLoads, 0);
  assert.equal(admissions.includes('/ops/screens'), false, 'router owns the dev/docs exemption');
  assert.equal(dom.elements.tabbar.hidden, true); assert.equal(dom.elements.fab.hidden, true);

  // Local completion flags cannot widen the exemption to a product route.
  user.set({ welcomeSeen: true, onboarded: true, role: 'driver', phoneVerified: true });
  router.go('/boot-proof'); await flush();
  assert.equal(productLoads, name === 'off' ? 1 : 0);
  assert.ok(admissions.includes('/boot-proof'), 'product route still evaluates auth admission');
  assert.equal(location.hash, expected === 'ANONYMOUS' ? '#/onboarding' : '#/boot-proof');
  assert.equal(authLoads, expected === 'ANONYMOUS' ? 1 : 0);
  assert.equal(disposed, 1, 'leaving ScreenOps disposes its mounted instance exactly once');

  // Anonymous auth entry still bypasses legacy UX flags; demo keeps its welcome
  // guard, and pending/unknown still block all non-dev/docs loaders.
  user.set({ welcomeSeen: false });
  const blocked = ['SESSION_RECONCILING', 'SESSION_UNKNOWN'].includes(expected);
  const previousAuthLoads = authLoads;
  router.go('/welcome'); await flush();
  assert.equal(welcomeLoads, blocked ? 0 : 1);
  router.go('/onboarding'); await flush();
  assert.equal(authLoads - previousAuthLoads, expected === 'ANONYMOUS' ? 1 : 0);
  if (name === 'off') {
    assert.equal(location.hash, '#/welcome'); assert.equal(welcomeLoads, 2);
    user.set({ welcomeSeen: true });
    router.go('/onboarding'); await flush();
    assert.equal(authLoads, 1, 'demo onboarding remains reachable after welcome');
  }
  assert.equal(productLoads, name === 'off' ? 1 : 0);
  assert.equal(disposed, 1); assert.equal(dom.starts(), 1);
  pending.resolve({ user: null }); await reconciliation;
}

async function appDevDocsBootCase(name) {
  // Render the real ScreenOps module via app.js. ID-only parsing supplies its
  // DOM controls; this is behavior coverage, not a browser/layout assertion.
  const dom = installDOM({ parseIds: true });
  const router = await import('../public/src/router.js');
  const { user } = await import('../public/src/state.js');
  user.set({ welcomeSeen: true, onboarded: true, role: 'passenger', phoneVerified: true });
  const profileBefore = localStorage.getItem('bazardrive.user.v1');
  if (name !== 'no-bearer') localStorage.setItem('bazardrive.auth.v1',
    JSON.stringify({ token: 'fixture-token' }));
  const authBefore = localStorage.getItem('bazardrive.auth.v1');
  globalThis.__BD_API_BASE__ = name === 'off' ? '' : 'https://api.invalid';
  const hashEntry = name.startsWith('hash-');
  location.hash = hashEntry ? '#/boot-proof' : '#/ops/screens';
  let productLoads = 0, requests = 0;
  router.register('/boot-proof', () => { productLoads++; return new dom.Element(); });
  const first = deferred(), retry = deferred();
  globalThis.fetch = () => (++requests === 1 ? first : retry).promise;
  const errors = [], oldError = console.error, oldWarn = console.warn;
  console.error = (...args) => errors.push(args.join(' '));
  console.warn = (...args) => errors.push(args.join(' '));
  const opsLoads = () => dom.created.filter(el => el.className === 'screen screen--ops-screens').length;
  const mountedOps = () => {
    const view = dom.elements.app.children[0];
    assert.equal(view?.className, 'screen screen--ops-screens', 'actual ScreenOps must mount');
    assert.equal(dom.starts(), 1);
    assert.equal(dom.elements.tabbar.hidden, true); assert.equal(dom.elements.fab.hidden, true);
    return view;
  };
  await import('../public/src/app.js'); await flush();
  if (hashEntry) {
    assert.equal(dom.starts(), 0); assert.equal(productLoads, 0);
    assert.equal(dom.elements.app.children[0].dataset.authBootState, 'SESSION_RECONCILING');
    if (name === 'hash-unknown') {
      first.resolve(response({ code: 'SESSION_LOOKUP_FAILED', retryable: true }, 503)); await flush();
      assert.equal(dom.elements.app.children[0].dataset.authBootState, 'SESSION_UNKNOWN');
    }
    // Browser hash navigation must work without a direct router.start()/go().
    location.hash = '#/ops/screens'; await flush();
  }
  assert.equal(opsLoads(), 1, 'app startup must execute the actual ScreenOps loader once');
  const initialView = mountedOps();
  assert.equal(requests, ['off', 'no-bearer'].includes(name) ? 0 : 1);
  assert.equal(productLoads, 0);

  if (!['off', 'no-bearer', 'leave-pending', 'hash-unknown'].includes(name)) {
    if (name === 'network') first.reject(new TypeError('fixture offline'));
    else if (['503', 'leave-unknown'].includes(name))
      first.resolve(response({ code: 'SESSION_LOOKUP_FAILED', retryable: true }, 503));
    else if (name === 'malformed') first.resolve(response({ user: {} }));
    else first.resolve(response({ user: name === 'user-null' ? null : userDTO() }));
    await flush();
  }
  assert.equal(mountedOps(), initialView, 'session result must not replace or remount ScreenOps');
  assert.equal(location.hash, '#/ops/screens', 'session result must not navigate away');
  assert.equal(opsLoads(), 1);

  let disposed = 0;
  if (name.startsWith('leave-')) {
    // Keep the real ScreenOps loader; add a disposer spy to its next instance
    // to verify app orchestration cooperates with the router lifecycle seam.
    const { default: opsScreens } = await import('../public/src/screens/ops_screens.js');
    router.register('/ops/screens', () => ({ view: opsScreens(), dispose: () => disposed++ }));
    router.go('/ops/screens'); await flush(); mountedOps();
  }
  router.go('/boot-proof'); await flush();
  const blocked = ['503', 'network', 'malformed', 'leave-pending', 'leave-unknown', 'hash-unknown'].includes(name);
  const anonymous = ['no-bearer', 'user-null'].includes(name);
  assert.equal(productLoads, blocked || anonymous ? 0 : 1);
  if (blocked) {
    const phase = name === 'leave-pending' ? 'SESSION_RECONCILING' : 'SESSION_UNKNOWN';
    assert.equal(dom.elements.app.children[0].dataset.authBootState, phase);
    assert.equal(dom.elements.tabbar.hidden, true); assert.equal(dom.elements.fab.hidden, true);
  } else if (anonymous) {
    assert.equal(location.hash, '#/onboarding');
  }
  if (name.startsWith('leave-')) {
    assert.equal(disposed, 1, 'actual navigation disposes the ScreenOps instance once');
    if (name === 'leave-unknown') {
      document.getElementById('auth-boot-retry').click(); await flush();
      assert.equal(requests, 2); assert.equal(productLoads, 0);
      assert.equal(dom.elements.app.children[0].dataset.authBootState, 'SESSION_RECONCILING');
      retry.resolve(response({ user: userDTO() }));
    } else first.resolve(response({ user: userDTO() }));
    await flush();
    assert.equal(productLoads, 1, 'settlement resumes the blocked product route without a second start');
    assert.equal(disposed, 1);
    assert.equal(location.hash, '#/boot-proof');
  }
  assert.equal(dom.starts(), 1);
  assert.equal(localStorage.getItem('bazardrive.auth.v1'), authBefore);
  assert.equal(localStorage.getItem('bazardrive.user.v1'), profileBefore);
  assert.deepEqual(errors, []);
  console.error = oldError; console.warn = oldWarn;
}

async function guestPublicCase(name) {
  const dom = installDOM({ parseMarkup: true });
  const router = await import('../public/src/router.js');
  const { user } = await import('../public/src/state.js');
  const { setSmokeRole } = await import('../public/src/smoke_role.js');
  const negativeRole = name.startsWith('role-');
  const role = negativeRole ? (name === 'role-null' ? null : name.slice(5)) : 'guest';
  user.set({ welcomeSeen: true, onboarded: true, phoneVerified: true, role });
  const originalProfile = localStorage.getItem('bazardrive.user.v1');
  const off = name === 'off';
  const pending = name === 'reconciling', unknown = name === 'unknown';
  const guestReadOnly = !off && !pending && !unknown && name !== 'authenticated' && !negativeRole;
  globalThis.__BD_API_BASE__ = off ? '' : 'https://api.invalid';
  const hasBearer = ['user-null', 'authenticated', 'reconciling', 'unknown'].includes(name);
  if (hasBearer) localStorage.setItem('bazardrive.auth.v1', JSON.stringify({ token: 'fixture-token' }));
  const authBefore = localStorage.getItem('bazardrive.auth.v1');
  const session = deferred(), requests = [];
  const order = { id: 'guest-order', status: 'CREATED', pickup: { label: 'A' },
    dropoff: { label: 'B' }, estimatedPrice: 250, comment: 'Guest read fixture' };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/auth/session')) return session.promise;
    assert.equal(url, 'https://api.invalid/api/v1/orders', 'no private read endpoint');
    assert.equal(options.method, 'GET', 'Guest never performs a server mutation');
    return response({ items: [order] });
  };
  const errors = [], oldError = console.error, oldWarn = console.warn;
  console.error = (...args) => errors.push(args.join(' '));
  console.warn = (...args) => errors.push(args.join(' '));
  // Real app starts on real ScreenOps even before session settlement. Every
  // subsequent public navigation uses the app's installed admission callback.
  location.hash = '#/ops/screens';
  await import('../public/src/app.js'); await flush();
  assert.equal(dom.elements.app.children[0].className, 'screen screen--ops-screens');
  if (hasBearer && !pending) {
    session.resolve(unknown ? response({ code: 'SESSION_LOOKUP_FAILED' }, 503)
      : response({ user: name === 'authenticated' ? userDTO() : null }));
    await flush();
  }
  const loads = new Map();
  // Module naming exceptions, not a second public-route allowlist. Every route
  // comes from router's immutable inventory; loaders call the actual screens.
  for (const path of router.GUEST_PUBLIC_ROUTES) {
    const moduleName = path === '/post' ? 'post_detail' : path.slice(1).replaceAll('-', '_');
    const screen = (await import('../public/src/screens/' + moduleName + '.js')).default;
    loads.set(path, 0);
    router.register(path, context => { loads.set(path, loads.get(path) + 1); return screen(context); });
  }
  let protectedLoads = 0;
  const protectedDestinations = ['/new', '/respond', '/chat', '/route-picker', '/route-preview',
    '/order-map-draft', '/driver-map', '/order/guest-order', '/receipt', '/settings', '/inbox'];
  for (const path of protectedDestinations) router.register(path, () => {
    protectedLoads++; return new dom.Element('article');
  });
  const postId = off ? 'trip-1' : order.id;
  const navigate = async path => {
    router.go(path); await flush(); await new Promise(resolve => setImmediate(resolve));
    return dom.elements.app.children[0];
  };
  const screenNode = selector => {
    const node = dom.elements.app.querySelector(selector);
    assert.ok(node, 'actual rendered control exists: ' + selector); return node;
  };
  if (guestReadOnly) setSmokeRole('driver'); // retained preview must not grant authority
  for (const path of router.GUEST_PUBLIC_ROUTES) {
    const url = path === '/post' ? path + '?id=' + postId : path;
    const before = loads.get(path);
    const view = await navigate(url);
    const allowed = guestReadOnly || off || name === 'authenticated';
    assert.equal(loads.get(path) - before, allowed ? 1 : 0, name + ' admission: ' + path);
    if (allowed) {
      assert.ok(view, 'mounted screen: ' + url + ' / ' + errors.join('; ')); assert.equal(location.hash, '#' + url);
    } else if (negativeRole) assert.equal(location.hash, '#/onboarding');
    else assert.equal(view.dataset.authBootState, pending ? 'SESSION_RECONCILING' : 'SESSION_UNKNOWN');
  }

  if (guestReadOnly) {
    // Real onboarding Guest choice must terminate at Feed, including retained
    // local completion flags. No token cleanup/OTP lifecycle is introduced.
    user.set({ role: null });
    await navigate('/onboarding');
    screenNode('[data-role="guest"]').click();
    screenNode('#ob-next').click(); await flush();
    assert.equal(user.get().role, 'guest'); assert.equal(location.hash, '#/feed');
    assert.ok(screenNode('.feed-list').innerHTML.includes('guest-order'));
    assert.equal(dom.elements.tabbar.hidden, false);

    for (const query of ['', '?role=driver', '?role=passenger', '?smokeRole=passenger']) {
      await navigate('/profile' + query);
      assert.equal(dom.elements.app.querySelectorAll('.pf-guest-card').length, 1);
      assert.equal(dom.elements.app.querySelector('#pfp-settings-btn'), null);
      assert.equal(dom.elements.app.querySelector('#pf2-act-role-switch'), null);
      screenNode('#pf-onboard').click(); await flush();
      assert.equal(location.hash, '#/onboarding');
    }
    await navigate('/feed');
    const feed = dom.elements.app.children[0];
    const list = screenNode('.feed-list');
    assert.equal(list.querySelector('[data-action="accept-order"]'), null);
    // Even an injected accept event cannot reach a mutation through old driver data.
    const storesBefore = localStorage.getItem('bazardrive.ride_orders.v1');
    const forged = new dom.Element('button');
    forged.setAttribute('data-action', 'accept-order'); forged.setAttribute('data-post-id', postId);
    list.appendChild(forged); forged.click(); await flush();
    assert.equal(localStorage.getItem('bazardrive.ride_orders.v1'), storesBefore);
    assert.equal(location.hash, '#/feed');
    screenNode('[data-cat="marketplace"]').click();
    assert.ok(list.innerHTML.includes('Ничего не найдено'), 'real filter changes the list');
    screenNode('[data-cat="all"]').click();
    const link = screenNode('.feed-card__open');
    assert.equal(link.getAttribute('href'), '#/post?id=' + postId);
    link.click(); await flush();
    assert.equal(location.hash, '#/post?id=' + postId);
    const detail = dom.elements.app.children[0];
    assert.ok(detail.innerHTML.includes('post-detail__card'), 'actual post content remains readable');
    assert.equal(/href="tel:/.test(detail.innerHTML), false);
    assert.equal(detail.querySelector('#pd-respond'), null);
    screenNode('#pd-back').click(); await flush();
    screenNode('.feed-btn-new').click(); await flush();
    assert.equal(location.hash, '#/onboarding');
    await navigate('/feed');
    screenNode('[data-action="respond"]').click(); await flush();
    assert.equal(location.hash, '#/onboarding');
    // Exercise the real delegated chat handler as well; this backend fixture
    // is a passenger request, so its ordinary rendered CTA is respond.
    await navigate('/feed');
    const chat = new dom.Element('button');
    chat.setAttribute('data-action', 'chat'); chat.setAttribute('data-post-id', postId);
    screenNode('.feed-list').appendChild(chat); chat.click(); await flush();
    assert.equal(location.hash, '#/onboarding');
    // Each protected deep link remains blocked from BOTH public entry surfaces.
    for (const source of ['/feed', '/post?id=' + postId]) {
      for (const destination of protectedDestinations) {
        await navigate(source); await navigate(destination);
        assert.equal(location.hash, '#/onboarding', source + ' -> ' + destination);
      }
    }
    assert.equal(protectedLoads, 0);
    // Real app tabbar ignores the retained driver preview for Guest Map entry.
    await navigate('/feed');
    const tab = new dom.Element('button'); tab.setAttribute('data-route', '/map');
    dom.elements.tabbar.appendChild(tab); tab.click(); await flush();
    assert.equal(location.hash, '#/map');
    await navigate('/map?state=permission');
    screenNode('[data-action="my-location"]').click(); await flush();
    assert.equal(location.hash, '#/location-permission');
    screenNode('[data-action="allow"]').click(); await flush();
    assert.equal(location.hash, '#/map?state=default');
    await navigate('/location-permission');
    screenNode('[data-action="manual"]').click(); await flush();
    assert.equal(location.hash, '#/onboarding');
    await navigate('/map');
    screenNode('[data-action="route"]').click(); await flush();
    assert.equal(location.hash, '#/onboarding');
    await navigate('/rules');
    const search = screenNode('#rules-search'); search.value = 'unmatched-guest-fixture';
    for (const listener of search.handlers.input) listener({ target: search });
    assert.ok(screenNode('#rules-list').innerHTML.includes('Ничего не найдено'));
    screenNode('[data-rules-reset]').click();
    assert.equal(search.value, ''); assert.equal(location.hash, '#/rules');
    assert.equal(protectedLoads, 0);
    assert.ok(feed !== dom.elements.app.children[0]);
  } else if (off || name === 'authenticated') {
    const detail = await navigate('/post?id=' + postId);
    assert.ok(/href="tel:/.test(detail.innerHTML), 'existing onboarded demo/confirmed contact remains');
    assert.ok(detail.querySelector('#pd-respond'));
    await navigate('/new'); assert.equal(protectedLoads, 1);
  }
  await navigate('/ops/screens');
  assert.equal(dom.elements.app.children[0].className, 'screen screen--ops-screens');
  assert.equal(dom.starts(), 1);
  assert.equal(localStorage.getItem('bazardrive.auth.v1'), authBefore, 'credential lifecycle stays out of scope');
  assert.equal(localStorage.getItem('bazardrive.user.v1'), originalProfile, 'no authority/cache rewrite');
  assert.equal(requests.filter(r => r.url.endsWith('/auth/session')).length, hasBearer ? 1 : 0);
  if (pending) { session.resolve(response({ user: null })); await flush(); }
  assert.deepEqual(errors, []);
  console.error = oldError; console.warn = oldWarn;
}

if (process.argv[2] === '--guest-public-case') {
  await guestPublicCase(process.argv[3]);
  console.log('PASS actual app/router/screens Guest boundary — ' + process.argv[3]);
} else if (process.argv[2] === '--app-dev-docs-case') {
  await appDevDocsBootCase(process.argv[3]);
  console.log('PASS actual app ScreenOps boot — ' + process.argv[3]);
} else if (process.argv[2] === '--dev-docs-case') {
  await devDocsRouteCase(process.argv[3]);
  console.log('PASS dev/docs router — ' + process.argv[3]);
} else if (process.argv[2] === '--app-case') {
  await appCase(process.argv[3]);
  console.log('PASS app — ' + process.argv[3]);
} else {
  const { createAuthSessionBootstrap: create, sessionRouteAdmission: admit } =
    await import('../public/src/auth_session_bootstrap.js');
  let count = 0;
  async function check(name, fn) { await fn(); count++; console.log('PASS — ' + name); }
  const fixture = overrides => create({ backendEnabled: () => true,
    readToken: () => 'fixture-token', requestSession: async () => ({ user: userDTO() }), ...overrides });

  await check('A: backend OFF skips token lookup and all session requests', async () => {
    const c = fixture({ backendEnabled: () => false,
      readToken() { throw Error('OFF read token'); },
      requestSession() { throw Error('OFF request'); } });
    assert.equal((await c.reconcile()).state, 'LOCAL_DEMO_BOOT');
    assert.equal(admit(c.getSnapshot(), '/driver-map'), true);
  });
  await check('B: no bearer is ANONYMOUS, never a local authenticated product', async () => {
    const c = fixture({ readToken: () => null, requestSession() { throw Error('no-token request'); } });
    const s = await c.reconcile();
    assert.equal(s.state, 'ANONYMOUS'); assert.equal(s.user, null);
    assert.equal(admit(s, '/driver-map'), '/onboarding');
    assert.equal(admit(s, '/welcome'), true);
  });
  await check('C: confirmed DTO is immutable identity only', async () => {
    const dto = { ...userDTO(), roles: ['driver'], readiness: true };
    const c = fixture({ requestSession: async () => ({ user: dto }) });
    const s = await c.reconcile();
    assert.equal(s.state, 'AUTHENTICATED'); assert.deepEqual(s.user, userDTO());
    assert.equal(s.grants, 'UNKNOWN'); assert.equal(s.readiness, 'UNKNOWN');
    assert.ok(Object.isFrozen(s) && Object.isFrozen(s.user));
    dto.userId = 'changed'; assert.equal(s.user.userId, 'user-a');
  });
  await check('C: nullable activeRole and false phoneVerified do not invalidate identity', async () => {
    const c = fixture({ requestSession: async () => ({
      user: { ...userDTO(), activeRole: null, phoneVerified: false },
    }) });
    assert.equal((await c.reconcile()).state, 'AUTHENTICATED');
  });
  await check('D: explicit null is anonymous; no mock fallback', async () => {
    const c = fixture({ requestSession: async () => ({ user: null }) });
    assert.equal((await c.reconcile()).state, 'ANONYMOUS');
  });

  globalThis.localStorage = storage();
  localStorage.setItem('bazardrive.auth.v1', JSON.stringify({ token: 'fixture-token' }));
  globalThis.__BD_API_BASE__ = 'https://api.invalid';
  for (const kind of ['503', 'network', '401']) {
    await check('E/F: actual API mapping keeps ' + kind + ' UNKNOWN with bearer retained', async () => {
      globalThis.fetch = async () => {
        if (kind === 'network') throw new TypeError('fixture offline');
        return response({ code: kind === '503' ? 'SESSION_LOOKUP_FAILED' : 'UNAUTHORIZED',
          retryable: kind === '503' }, Number(kind));
      };
      const c = create();
      const s = await c.reconcile();
      assert.equal(s.state, 'SESSION_UNKNOWN'); assert.equal(s.user, null);
      assert.equal(s.error.retryable, true);
      assert.ok(localStorage.getItem('bazardrive.auth.v1').includes('fixture-token'));
      assert.equal(admit(s, '/driver-map'), false);
    });
  }
  await check('G: malformed payloads never become anonymous/authenticated', async () => {
    for (const payload of [null, {}, [], { user: [] }, { user: false },
      { user: { ...userDTO(), userId: '' } }, { user: { ...userDTO(), sessionId: 1 } },
      { user: { ...userDTO(), activeRole: undefined } },
      { user: { ...userDTO(), activeRole: 'admin' } },
      { user: { ...userDTO(), phoneVerified: 'true' } }]) {
      const c = fixture({ requestSession: async () => payload });
      const s = await c.reconcile();
      assert.equal(s.state, 'SESSION_UNKNOWN'); assert.equal(s.error.code, 'SESSION_PROTOCOL');
    }
  });
  for (const oldKind of ['success', 'null', 'error']) {
    await check('H: superseded ' + oldKind + ' cannot replace the latest snapshot', async () => {
      const first = deferred(), second = deferred();
      const signals = [];
      const c = fixture({ requestSession: ({ signal }) => {
        signals.push(signal); return (signals.length === 1 ? first : second).promise;
      } });
      const p1 = c.reconcile(); await flush();
      const p2 = c.reconcile(); await flush();
      assert.equal(signals[0].aborted, true); assert.equal(signals[1].aborted, false);
      second.resolve({ user: userDTO('latest') });
      await p2; const latest = c.getSnapshot();
      if (oldKind === 'error') first.reject(new Error('old failure'));
      else first.resolve({ user: oldKind === 'null' ? null : userDTO('old') });
      await p1; await flush();
      assert.equal(c.getSnapshot(), latest); assert.equal(latest.user.userId, 'latest');
    });
  }
  for (const newest of ['anonymous', 'unknown']) {
    await check('H: late success cannot undo latest ' + newest, async () => {
      const first = deferred(); let calls = 0;
      const c = fixture({ requestSession: () => {
        if (++calls === 1) return first.promise;
        if (newest === 'unknown') throw new Error('current failure');
        return { user: null };
      } });
      const old = c.reconcile(); await flush(); await c.reconcile();
      const latest = c.getSnapshot(); first.resolve({ user: userDTO('old') });
      await old; await flush();
      assert.equal(c.getSnapshot(), latest);
      assert.equal(latest.state, newest === 'anonymous' ? 'ANONYMOUS' : 'SESSION_UNKNOWN');
    });
  }
  await check('timeout settles even an abort-ignoring request and ignores late success', async () => {
    const late = deferred(); let signal;
    const c = fixture({ timeoutMs: 5, requestSession: options => {
      signal = options.signal; return late.promise;
    } });
    const s = await c.reconcile();
    assert.equal(s.state, 'SESSION_UNKNOWN'); assert.equal(s.error.code, 'SESSION_TIMEOUT');
    assert.equal(signal.aborted, true);
    late.resolve({ user: userDTO('too-late') }); await flush();
    assert.equal(c.getSnapshot(), s);
  });
  await check('real router rechecks admission before a late loader mounts', async () => {
    const dom = installDOM();
    const router = await import('../public/src/router.js');
    const { user } = await import('../public/src/state.js');
    user.set({ welcomeSeen: true, role: 'passenger' });
    let allowed = true, disposed = 0;
    const late = deferred();
    router.setAdmissionGuard(() => allowed);
    router.register('/boot-proof', () => late.promise);
    router.start(); allowed = false;
    late.resolve({ view: new dom.Element(), dispose: () => disposed++ }); await flush();
    assert.equal(dom.elements.app.children.length, 0); assert.equal(disposed, 1);
    router.setAdmissionGuard(null);
  });

  for (const scenario of ['off', 'no-token', 'valid', 'anonymous', 'retry-503', 'retry-network', 'retry-malformed']) {
    await check('actual app/router integration: ' + scenario, async () => {
      execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--app-case', scenario],
        { stdio: 'pipe', timeout: 15000 });
    });
  }
  for (const scenario of ['no-bearer', 'user-null', 'reconciling', 'unknown', 'off']) {
    await check('real router dev/docs exemption and product admission: ' + scenario, async () => {
      execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--dev-docs-case', scenario],
        { stdio: 'pipe', timeout: 15000 });
    });
  }
  for (const scenario of ['valid', 'user-null', '503', 'network', 'malformed', 'no-bearer',
    'off', 'leave-pending', 'leave-unknown', 'hash-pending', 'hash-unknown']) {
    await check('actual app ScreenOps boot: ' + scenario, async () => {
      execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--app-dev-docs-case', scenario],
        { stdio: 'pipe', timeout: 15000 });
    });
  }
  for (const scenario of ['no-bearer', 'user-null', 'role-null', 'role-passenger', 'role-driver',
    'reconciling', 'unknown', 'authenticated', 'off']) {
    await check('actual app/router/screens Guest boundary: ' + scenario, async () => {
      execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--guest-public-case', scenario],
        { stdio: 'pipe', timeout: 15000 });
    });
  }
  console.log('auth-session-bootstrap: ' + count + ' behavioral checks PASS');
}
