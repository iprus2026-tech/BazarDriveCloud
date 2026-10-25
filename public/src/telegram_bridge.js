// BD-TG-MINIAPP-01 M2 (#1126) — bridge to the Telegram client.
// Contract: docs/telegram-mini-app-contract.md, section "M2 — bridge".
//
// The bridge is active only when M1 captured a Telegram launch (telegram_launch.js) AND a
// Telegram transport exists. Otherwise it defines no globals, adds no listeners, sends no
// event, and the app behaves exactly as a normal PWA.
//
// Transports, in this order (the same order as the official SDK, which is not vendored):
// - the native proxy;
// - window.external.notify;
// - the Telegram Web iframe. Outgoing messages go ONLY to https://web.telegram.org. Incoming
//   ones are accepted only from window.parent with that origin; anything else is ignored.
//
// After the router has started it runs the startup sequence once:
//   theme / viewport / safe-area requests, colours, vertical swipes off, expand, ready.
// After every mount it sends, from the RENDERED route (router.js seam):
// - BackButton visibility: hidden on the root routes;
// - closing confirmation: only on /active-ride.
//
// Telegram's back button activates the screen's own «Назад» control. If there is none, it uses
// this launch's history, then the role's root tab.

export const TELEGRAM_WEB_ORIGIN = 'https://web.telegram.org';

const ROOT_ROUTES = new Set(['/welcome', '/feed', '/map', '/driver-map', '/rules', '/profile']);
const CLOSING_ROUTE = '/active-ride';
// --bg-0 in cloud.css: the app is dark only and does not adopt Telegram's theme.
const CHROME_COLOR = '#0a0a0c';
const MAX_PX = 10000;

// Numeric comparison per dot segment: '6.10' > '6.9'.
export function versionAtLeast(version, min) {
  const a = String(version || '0').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const b = String(min).split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return true;
}

// The client-side sender, or null when this page has no Telegram transport.
function pickTransport(win) {
  const proxy = win.TelegramWebviewProxy;
  if (proxy && typeof proxy.postEvent === 'function') {
    return { kind: 'native', send: (type, data) => proxy.postEvent(type, JSON.stringify(data)) };
  }
  if (win.external && typeof win.external === 'object' && 'notify' in win.external) {
    return { kind: 'native', send: (type, data) => win.external.notify(JSON.stringify({ eventType: type, eventData: data })) };
  }
  if (win.parent && win.parent !== win) {
    return {
      kind: 'iframe',
      send: (type, data) => win.parent.postMessage(JSON.stringify({ eventType: type, eventData: data }), TELEGRAM_WEB_ORIGIN),
    };
  }
  return null;
}

const validPx = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= MAX_PX;

function isVisible(node) {
  if (!node || node.disabled) return false;
  return typeof node.getClientRects === 'function' && node.getClientRects().length > 0;
}

// Starts the bridge once, after the router has started. Returns true when it is active.
export function initTelegramBridge({
  launch,
  getRenderedRoute,
  onRouteRendered,
  go,
  roleRoot,
  win = globalThis.window,
  doc = globalThis.document,
} = {}) {
  if (!launch || !win || !doc) return false;
  const transport = pickTransport(win);
  if (!transport) return false;

  const atLeast = (min) => versionAtLeast(launch.version, min);
  const send = (type, data) => {
    try {
      transport.send(type, data);
    } catch {
      // the client went away; nothing to do
    }
  };
  const rootStyle = doc.documentElement && doc.documentElement.style;
  const setPx = (name, value) => {
    if (rootStyle && typeof rootStyle.setProperty === 'function') rootStyle.setProperty(name, `${value}px`);
  };
  const setInsets = (prefix, data) => {
    if (!data || !['top', 'right', 'bottom', 'left'].every((side) => validPx(data[side]))) return;
    for (const side of ['top', 'right', 'bottom', 'left']) setPx(`${prefix}-${side}`, data[side]);
  };

  // Launch depth: how far this launch has navigated, so history.back() never leaves it.
  let lastHash = null;
  let depth = 0;
  let popping = false;
  const trackDepth = () => {
    const hash = win.location ? String(win.location.hash) : '';
    if (lastHash === null) { lastHash = hash; return; }
    if (hash === lastHash) return;
    lastHash = hash;
    if (popping) { popping = false; depth = Math.max(0, depth - 1); } else depth += 1;
  };

  const onBackPressed = () => {
    const controls = doc.querySelectorAll('[aria-label="Назад"]');
    for (let i = controls.length - 1; i >= 0; i -= 1) {
      if (isVisible(controls[i])) { controls[i].click(); return; }
    }
    if (depth > 0 && win.history && typeof win.history.back === 'function') {
      popping = true;
      win.history.back();
      return;
    }
    go(roleRoot());
  };

  const receive = (type, raw) => {
    let data = raw;
    if (typeof raw === 'string') {
      try { data = JSON.parse(raw); } catch { data = null; }
    }
    if (type === 'viewport_changed') {
      if (data && data.is_state_stable === true && validPx(data.height)) setPx('--bd-tg-viewport-stable-height', data.height);
    } else if (type === 'safe_area_changed') {
      setInsets('--bd-tg-safe', data);
    } else if (type === 'content_safe_area_changed') {
      setInsets('--bd-tg-content-safe', data);
    } else if (type === 'back_button_pressed') {
      onBackPressed();
    }
    // theme_changed and every other event: not adopted.
  };

  if (transport.kind === 'native') {
    const receiveEvent = (type, data) => { if (typeof type === 'string') receive(type, data); };
    win.Telegram = win.Telegram || {};
    win.Telegram.WebView = Object.assign(win.Telegram.WebView || {}, { receiveEvent });
    win.TelegramGameProxy = Object.assign(win.TelegramGameProxy || {}, { receiveEvent });
  } else {
    win.addEventListener('message', (event) => {
      if (event.source !== win.parent || event.origin !== TELEGRAM_WEB_ORIGIN) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message || typeof message.eventType !== 'string') return;
      receive(message.eventType, message.eventData);
    });
    send('iframe_ready', { reload_supported: false });
  }

  if (doc.documentElement && doc.documentElement.classList) doc.documentElement.classList.add('bd-telegram');

  // Startup sequence (contract order; each event gated by its minimum version).
  send('web_app_request_theme');
  send('web_app_request_viewport');
  if (atLeast('8.0')) {
    send('web_app_request_safe_area');
    send('web_app_request_content_safe_area');
  }
  if (atLeast('6.1')) send('web_app_set_background_color', { color: CHROME_COLOR });
  // Below 6.9 only a color_key exists; it follows Telegram's (maybe light) theme, so no header event.
  if (atLeast('6.9')) send('web_app_set_header_color', { color: CHROME_COLOR });
  if (atLeast('7.7')) send('web_app_setup_swipe_behavior', { allow_vertical_swipe: false });
  send('web_app_expand');
  send('web_app_ready');

  // After every mount, from the rendered route: the back button and the closing behaviour.
  const syncRoute = (route) => {
    if (typeof route !== 'string') return;
    trackDepth();
    if (atLeast('6.1')) send('web_app_setup_back_button', { is_visible: !ROOT_ROUTES.has(route) });
    if (atLeast('6.2')) send('web_app_setup_closing_behavior', { need_confirmation: route === CLOSING_ROUTE });
  };
  onRouteRendered(syncRoute);
  syncRoute(getRenderedRoute());
  return true;
}
