// BD-TG-MINIAPP-01 M2 (#1126) — the Telegram bridge (public/src/telegram_bridge.js).
// Contract: docs/telegram-mini-app-contract.md, section "M2 — bridge".
//
// Runs the shipped module in Node with injected fake window / document / router seam. It pins:
// - inert outside Telegram: no event, no global, no listener, no class;
// - transport selection and the explicit origin for Telegram Web;
// - incoming source and origin checks;
// - the startup sequence and its version gates;
// - BackButton and closing confirmation from the RENDERED route;
// - back-press resolution: the screen's «Назад», then launch history, then the role root.

import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const bridgeSource = read('../public/src/telegram_bridge.js');
const appSource = read('../public/src/app.js');
const swSource = read('../public/sw.js');
const cssSource = read('../public/styles/cloud.css');
const { initTelegramBridge, versionAtLeast, TELEGRAM_WEB_ORIGIN } = await import(new URL('../public/src/telegram_bridge.js', import.meta.url).href);

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

const LAUNCH = (version = '8.0') => Object.freeze({ version, platform: 'android', startParam: null });

// transport: 'proxy' | 'notify' | 'iframe' | 'none'. Every outgoing call is recorded in `raw`
// and normalised into `sent` as [eventType, eventData].
function fakeWin({ transport = 'none', hash = '#/feed' } = {}) {
  const sent = [];
  const raw = [];
  const listeners = {};
  const win = {
    location: { hash },
    history: { backCalls: 0, back() { this.backCalls += 1; } },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    external: {}, // browsers expose window.external without notify()
  };
  win.parent = win;
  if (transport === 'proxy') {
    win.TelegramWebviewProxy = {
      postEvent(type, json) { raw.push(['proxy', type, json]); sent.push([type, json === undefined ? undefined : JSON.parse(json)]); },
    };
  } else if (transport === 'notify') {
    win.external = { notify(json) { raw.push(['notify', json]); const m = JSON.parse(json); sent.push([m.eventType, m.eventData]); } };
  } else if (transport === 'iframe') {
    win.parent = { postMessage(msg, origin) { raw.push(['iframe', msg, origin]); const m = JSON.parse(msg); sent.push([m.eventType, m.eventData]); } };
  }
  return { win, sent, raw, listeners };
}
function fakeDoc(controls = []) {
  const classes = new Set();
  const props = new Map();
  return {
    classes, props,
    documentElement: { classList: { add: (c) => classes.add(c) }, style: { setProperty: (k, v) => props.set(k, v) } },
    querySelectorAll: (sel) => (sel === '[aria-label="Назад"]' ? controls : []),
  };
}
function control({ visible = true, disabled = false } = {}) {
  return { clicks: 0, disabled, click() { this.clicks += 1; }, getClientRects: () => (visible ? [{}] : []) };
}
function fakeRouter(initial = '/feed') {
  let route = initial;
  const observers = [];
  return {
    observers,
    getRenderedRoute: () => route,
    onRouteRendered: (fn) => { observers.push(fn); return () => {}; },
    mount(next, win, hash) { route = next; if (hash !== undefined) win.location.hash = hash; for (const fn of observers) fn(next); },
  };
}
function start({ transport = 'proxy', version = '8.0', route = '/feed', hash = '#/feed', controls = [], launch } = {}) {
  const w = fakeWin({ transport, hash });
  const doc = fakeDoc(controls);
  const router = fakeRouter(route);
  const navigations = [];
  const active = initTelegramBridge({
    launch: launch === undefined ? LAUNCH(version) : launch,
    getRenderedRoute: router.getRenderedRoute,
    onRouteRendered: router.onRouteRendered,
    go: (path) => navigations.push(path),
    roleRoot: () => '/driver-map',
    win: w.win,
    doc,
  });
  return { ...w, doc, router, navigations, active };
}
const types = (sent) => sent.map(([t]) => t);

// ── Inert outside Telegram ──────────────────────────────────────────────────────
await check('outside Telegram (no captured launch): no event, no global, no listener, no class — whatever transport exists', () => {
  for (const transport of ['proxy', 'notify', 'iframe', 'none']) {
    const s = start({ transport, launch: null });
    assert.equal(s.active, false, transport);
    assert.equal(s.raw.length, 0, `${transport}: nothing sent`);
    assert.equal(s.win.Telegram, undefined, `${transport}: no window.Telegram`);
    assert.equal(s.win.TelegramGameProxy, undefined);
    assert.equal(Object.keys(s.listeners).length, 0, `${transport}: no listener`);
    assert.equal(s.doc.classes.size, 0, `${transport}: no bd-telegram class`);
    assert.equal(s.doc.props.size, 0);
    assert.equal(s.router.observers.length, 0, `${transport}: no route observer`);
  }
});

await check('a captured launch without any Telegram transport (a plain browser) stays inert too', () => {
  const s = start({ transport: 'none' });
  assert.equal(s.active, false);
  assert.equal(s.raw.length, 0);
  assert.equal(s.win.Telegram, undefined);
  assert.equal(s.doc.classes.size, 0);
  assert.equal(s.router.observers.length, 0);
});

// ── Startup sequence and version gates ──────────────────────────────────────────
await check('8.0 via the native proxy: the exact startup sequence, then the first route sync', () => {
  const s = start({ transport: 'proxy', version: '8.0', route: '/feed' });
  assert.equal(s.active, true);
  assert.deepEqual(s.sent, [
    ['web_app_request_theme', undefined],
    ['web_app_request_viewport', undefined],
    ['web_app_request_safe_area', undefined],
    ['web_app_request_content_safe_area', undefined],
    ['web_app_set_background_color', { color: '#0a0a0c' }],
    ['web_app_set_header_color', { color: '#0a0a0c' }],
    ['web_app_setup_swipe_behavior', { allow_vertical_swipe: false }],
    ['web_app_expand', undefined],
    ['web_app_ready', undefined],
    ['web_app_setup_back_button', { is_visible: false }],
    ['web_app_setup_closing_behavior', { need_confirmation: false }],
  ]);
  assert.ok(s.doc.classes.has('bd-telegram'));
  assert.equal(typeof s.win.Telegram.WebView.receiveEvent, 'function');
  assert.equal(s.router.observers.length, 1);
});

await check('version gates: 6.0 / 6.1 / 6.2 / 6.9 / 7.7 / 7.10 send only what each supports', () => {
  assert.deepEqual(types(start({ version: '6.0' }).sent),
    ['web_app_request_theme', 'web_app_request_viewport', 'web_app_expand', 'web_app_ready']);
  const v61 = types(start({ version: '6.1' }).sent);
  assert.ok(v61.includes('web_app_set_background_color') && v61.includes('web_app_setup_back_button'));
  assert.ok(!v61.includes('web_app_set_header_color'), 'no header colour below 6.9 (no color_key either)');
  assert.ok(!v61.includes('web_app_setup_closing_behavior') && !v61.includes('web_app_setup_swipe_behavior'));
  assert.ok(types(start({ version: '6.2' }).sent).includes('web_app_setup_closing_behavior'));
  assert.ok(types(start({ version: '6.9' }).sent).includes('web_app_set_header_color'));
  const v77 = types(start({ version: '7.7' }).sent);
  assert.ok(v77.includes('web_app_setup_swipe_behavior') && !v77.includes('web_app_request_safe_area'));
  assert.ok(types(start({ version: '7.10' }).sent).includes('web_app_setup_swipe_behavior'), '7.10 >= 7.7');
  assert.equal(versionAtLeast('6.10', '6.9'), true);
  assert.equal(versionAtLeast('6.2', '6.10'), false);
  assert.equal(versionAtLeast('8.0', '8.0'), true);
});

// ── Transports and origin ───────────────────────────────────────────────────────
await check('window.external.notify transport: {eventType, eventData} JSON, native receiveEvent defined', () => {
  const s = start({ transport: 'notify' });
  assert.equal(s.raw[0][0], 'notify');
  assert.deepEqual(s.sent[0], ['web_app_request_theme', undefined]);
  assert.equal(typeof s.win.Telegram.WebView.receiveEvent, 'function');
});

await check(`Telegram Web iframe: every outgoing message targets exactly ${'https://web.telegram.org'}, iframe_ready first`, () => {
  const s = start({ transport: 'iframe' });
  assert.equal(TELEGRAM_WEB_ORIGIN, 'https://web.telegram.org');
  assert.ok(s.raw.length > 5);
  for (const [kind, , origin] of s.raw) {
    assert.equal(kind, 'iframe');
    assert.equal(origin, 'https://web.telegram.org');
  }
  assert.deepEqual(s.sent[0], ['iframe_ready', { reload_supported: false }]);
  assert.equal(s.listeners.message.length, 1);
  assert.equal(s.win.Telegram, undefined, 'the iframe transport needs no native global');
});

await check('incoming iframe messages: only window.parent + https://web.telegram.org + JSON {eventType}', () => {
  const s = start({ transport: 'iframe' });
  const deliver = (data, { origin = 'https://web.telegram.org', source = s.win.parent } = {}) => {
    for (const fn of s.listeners.message) fn({ data, origin, source });
  };
  const viewport = JSON.stringify({ eventType: 'viewport_changed', eventData: { height: 640, is_expanded: true, is_state_stable: true } });
  deliver(viewport, { origin: 'https://evil.example' });
  deliver(viewport, { origin: 'http://web.telegram.org' });
  deliver(viewport, { source: {} });
  deliver('not json');
  deliver(JSON.stringify({ eventData: {} }));
  assert.equal(s.doc.props.size, 0, 'nothing accepted from a wrong origin / source / shape');
  deliver(viewport);
  assert.equal(s.doc.props.get('--bd-tg-viewport-stable-height'), '640px');
});

await check('incoming payloads are validated: unstable / invalid viewport and partial insets are ignored', () => {
  const s = start({ transport: 'proxy' });
  const rx = s.win.Telegram.WebView.receiveEvent;
  rx('viewport_changed', { height: 500, is_state_stable: false });
  rx('viewport_changed', { height: -1, is_state_stable: true });
  rx('viewport_changed', { height: Number.NaN, is_state_stable: true });
  rx('viewport_changed', { height: 1e9, is_state_stable: true });
  rx('safe_area_changed', { top: 10, bottom: 20 });
  rx(42, { height: 600, is_state_stable: true });
  assert.equal(s.doc.props.size, 0);
  rx('viewport_changed', JSON.stringify({ height: 700, is_state_stable: true }));
  rx('safe_area_changed', { top: 47, right: 0, bottom: 34, left: 0 });
  rx('content_safe_area_changed', { top: 0, right: 0, bottom: 0, left: 0 });
  rx('theme_changed', { theme_params: { bg_color: '#ffffff' } });
  assert.equal(s.doc.props.get('--bd-tg-viewport-stable-height'), '700px');
  assert.equal(s.doc.props.get('--bd-tg-safe-top'), '47px');
  assert.equal(s.doc.props.get('--bd-tg-safe-bottom'), '34px');
  assert.equal(s.doc.props.get('--bd-tg-content-safe-top'), '0px');
  assert.ok(![...s.doc.props.keys()].some((k) => k.includes('theme')), 'the theme is not adopted');
});

// ── Rendered route: BackButton and closing behaviour ────────────────────────────
await check('BackButton follows the RENDERED route: hidden on roots and on the /feed fallback, shown elsewhere', () => {
  const s = start({ transport: 'proxy', route: '/feed' });
  const backAfter = (route, hash) => {
    s.sent.length = 0;
    s.router.mount(route, s.win, hash);
    return s.sent.find(([t]) => t === 'web_app_setup_back_button')[1].is_visible;
  };
  for (const root of ['/welcome', '/feed', '/map', '/driver-map', '/rules', '/profile']) assert.equal(backAfter(root, `#${root}`), false, root);
  assert.equal(backAfter('/post', '#/post?id=7'), true);
  assert.equal(backAfter('/order', '#/order/ord_1'), true, '/order/<id> renders /order');
  assert.equal(backAfter('/feed', '#/bogus'), false, 'an unknown hash renders /feed → hidden');
  assert.equal(backAfter('/chat', '#/chat?tripId=t1'), true);
});

await check('closing confirmation is re-sent after every mount: true only on /active-ride', () => {
  const s = start({ transport: 'proxy', route: '/feed' });
  const closingAfter = (route, hash) => {
    s.sent.length = 0;
    s.router.mount(route, s.win, hash);
    return s.sent.find(([t]) => t === 'web_app_setup_closing_behavior')[1].need_confirmation;
  };
  assert.equal(closingAfter('/active-ride', '#/active-ride?role=passenger&tripId=t1'), true);
  assert.equal(closingAfter('/active-ride', '#/active-ride?role=passenger&tripId=t1'), true, 'a same-route re-render re-sends it');
  assert.equal(closingAfter('/feed', '#/feed'), false, 'leaving /active-ride turns it off');
  assert.equal(closingAfter('/order', '#/order/ord_1'), false);
});

// ── Back press ──────────────────────────────────────────────────────────────────
await check("back press activates the topmost VISIBLE, enabled «Назад» control (the screen's own semantics)", () => {
  const screenBack = control();
  const sheetBack = control();
  const hiddenBack = control({ visible: false });
  const disabledBack = control({ disabled: true });
  const s = start({ transport: 'proxy', route: '/post', controls: [screenBack, sheetBack, hiddenBack, disabledBack] });
  s.win.Telegram.WebView.receiveEvent('back_button_pressed');
  assert.equal(sheetBack.clicks, 1, 'the last visible one (the sheet over the screen)');
  assert.equal(screenBack.clicks + hiddenBack.clicks + disabledBack.clicks, 0);
  assert.equal(s.win.history.backCalls, 0);
  assert.deepEqual(s.navigations, []);
});

await check('back press without a «Назад» control: launch history if navigated, else the role root — never out of the launch', () => {
  const s = start({ transport: 'proxy', route: '/feed', hash: '#/feed' });
  const rx = s.win.Telegram.WebView.receiveEvent;
  rx('back_button_pressed');
  assert.deepEqual(s.navigations, ['/driver-map'], 'depth 0 → role root, no history.back()');
  assert.equal(s.win.history.backCalls, 0);
  s.router.mount('/inbox', s.win, '#/inbox');
  rx('back_button_pressed');
  assert.equal(s.win.history.backCalls, 1, 'navigated once → history.back()');
  s.router.mount('/feed', s.win, '#/feed'); // the pop lands
  rx('back_button_pressed');
  assert.equal(s.win.history.backCalls, 1, 'back at depth 0 again → no second history.back()');
  assert.deepEqual(s.navigations, ['/driver-map', '/driver-map']);
});

// ── Static pins ─────────────────────────────────────────────────────────────────
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

await check("the bridge never posts to '*' and never reads Telegram's theme into the app", () => {
  const code = stripComments(bridgeSource);
  assert.doesNotMatch(code, /postMessage\([^)]*['"]\*['"]/);
  assert.match(code, /postMessage\(JSON\.stringify\(\{ eventType: type, eventData: data \}\), TELEGRAM_WEB_ORIGIN\)/);
  assert.match(code, /event\.source !== win\.parent \|\| event\.origin !== TELEGRAM_WEB_ORIGIN/);
  assert.doesNotMatch(code, /\bconsole\./);
  assert.doesNotMatch(code, /\b(localStorage|sessionStorage|fetch|XMLHttpRequest)\b/);
});

await check('app.js starts the bridge once, right after start(), with the captured launch; the capture stays the first import', () => {
  const code = stripComments(appSource);
  assert.equal(code.trimStart().indexOf("import './telegram_launch.js';"), 0);
  const body = code.slice(code.indexOf('function startRouterOnce()'));
  const fn = body.slice(0, body.indexOf('\n}\n'));
  assert.match(fn, /start\(\);\s*\n\s*initTelegramBridge\(\{\s*\n\s*launch: getTelegramLaunch\(\),/);
  assert.equal((code.match(/initTelegramBridge\(/g) || []).length, 1, 'one call site');
});

await check('sw.js precaches the bridge; cloud.css changes the shell only under .bd-telegram', () => {
  assert.match(swSource, /'\.\/src\/telegram_bridge\.js',/);
  const rules = cssSource.match(/[^}]*--bd-tg-[^}]*\}/g) || [];
  assert.ok(rules.length >= 1, 'a rule uses the Telegram variables');
  for (const rule of rules) assert.match(rule.trim().split('{')[0].split('\n').pop(), /^\.bd-telegram\b/, 'scoped to .bd-telegram');
});

console.log(`\n${passed} passed; ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
