import { user } from './state.js';
import { isDriverMode } from './ride_actions.js';

const routes = new Map();
let pendingAction = null;

const HIDE_CHROME = new Set(['/welcome', '/onboarding', '/active-ride', '/trip-confirmation']);
const SHOW_FAB    = new Set(['/feed']);
const PASSENGER_ORDER_ROUTES = new Set(['/route-picker', '/route-preview', '/order-map-draft']);

function hasExplicitPassengerMode(fullPath) {
  const queryIndex = fullPath.indexOf('?');
  if (queryIndex === -1) return false;
  const params = new URLSearchParams(fullPath.slice(queryIndex + 1));
  return params.get('role') === 'passenger' || params.get('mode') === 'passenger';
}

function redirectDriverPassengerOrderFlow(fullPath, path, u) {
  return isDriverMode(u)
    && PASSENGER_ORDER_ROUTES.has(path)
    && !hasExplicitPassengerMode(fullPath);
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
  const u = user.get();

  if (!u.welcomeSeen && path !== '/welcome') {
    go('/welcome');
    return;
  }

  if (redirectDriverPassengerOrderFlow(fullPath, path, u)) {
    go('/driver-map');
    return;
  }

  const loader = routes.get(path) ?? routes.get('/feed');

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
