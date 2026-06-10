import { user } from './state.js';
import { isDriverMode } from './ride_actions.js';
import { applySmokeRole, bootstrapSmokeRoleFromQuery } from './smoke_role.js';

const routes = new Map();
let pendingAction = null;

const HIDE_CHROME = new Set(['/welcome', '/onboarding', '/active-ride', '/trip-confirmation']);
const SHOW_FAB    = new Set(['/feed']);
const PASSENGER_ORDER_ROUTES = new Set(['/route-picker', '/route-preview', '/order-map-draft']);

function redirectDriverPassengerOrderFlow(path, u) {
  return isDriverMode(u) && PASSENGER_ORDER_ROUTES.has(path);
}

export function register(path, loader) {
  routes.set(path, loader);
}

export function go(path) {
  const target = `#${path}`;
  if (location.hash === target) render();
  else location.hash = path;
}

export function setPendingAction(fn) {
  pendingAction = typeof fn === 'function' ? fn : null;
}

export function consumePendingAction() {
  const fn = pendingAction;
  pendingAction = null;
  return fn;
}

async function render() {
  const fullPath = (location.hash || '#/welcome').slice(1);
  const path = fullPath.split('?')[0];
  // BD-SMOKE-ROLE-01 — capture ?smokeRole= from the hash query (hash-routed,
  // so location.search is empty) into the per-tab sessionStorage override,
  // then read the user with that override layered on. The override only
  // affects role context; the persisted bazardrive.user.v1 is never written.
  const qi = fullPath.indexOf('?');
  bootstrapSmokeRoleFromQuery(qi === -1 ? '' : fullPath.slice(qi + 1));
  const u = applySmokeRole(user.get());

  if (!u.welcomeSeen && path !== '/welcome') {
    go('/welcome');
    return;
  }

  if (redirectDriverPassengerOrderFlow(path, u)) {
    go('/driver-map');
    return;
  }

  // BD-ORDER-DETAIL-01C — minimal dynamic-route support for /order/<id>.
  // The exact-match registry stays the source of truth; only paths that
  // start with the dynamic prefix below and have no exact registration
  // fall through to the registered prefix loader (`/order`). All other
  // unknown paths still fall back to /feed unchanged, so the router's
  // existing fallback semantics are preserved end-to-end. The Order
  // Detail screen reads its id off `location.hash` itself.
  let lookupPath = path;
  if (!routes.has(lookupPath) && lookupPath.startsWith('/order/')) {
    lookupPath = '/order';
  }
  const loader = routes.get(lookupPath) ?? routes.get('/feed');

  const root    = document.getElementById('app');
  const tabbar  = document.getElementById('tabbar');
  const fab     = document.getElementById('fab');
  const shell   = document.getElementById('shell');

  const noChrome = !u.welcomeSeen || HIDE_CHROME.has(path);
  const hasFab   = !noChrome && SHOW_FAB.has(path);

  tabbar.hidden = noChrome;
  fab.hidden    = !hasFab;

  shell.classList.toggle('no-chrome',  noChrome);
  shell.classList.toggle('has-tabbar', !noChrome);
  shell.classList.toggle('has-fab',    hasFab);

  root.replaceChildren();
  const view = await loader();
  root.appendChild(view);

  syncTabActive(path);
}

function syncTabActive(path) {
  // /driver-map is the driver entry behind the Карта tab (which carries
  // data-route="/map"), so treat both paths as the same tab for activation.
  const tabPath = path === '/driver-map' ? '/map' : path;
  for (const btn of document.querySelectorAll('#tabbar [data-route]')) {
    btn.classList.toggle('active', btn.dataset.route === tabPath);
  }
}

export function start() {
  window.addEventListener('hashchange', render);
  render();
}
