import { user } from './state.js';

const routes = new Map();
let pendingAction = null;

const HIDE_CHROME = new Set(['/welcome', '/onboarding']);
const SHOW_FAB    = new Set([]);

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
  const path = (location.hash || '#/welcome').slice(1);
  const u = user.get();

  if (!u.welcomeSeen && path !== '/welcome') {
    go('/welcome');
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
  for (const btn of document.querySelectorAll('#tabbar [data-route]')) {
    btn.classList.toggle('active', btn.dataset.route === path);
  }
}

export function start() {
  window.addEventListener('hashchange', render);
  render();
}
