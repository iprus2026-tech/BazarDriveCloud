import { user } from './state.js';

const routes = new Map();
let pendingAction = null;

export function register(path, loader) {
  routes.set(path, loader);
}

export function go(path) {
  const target = `#${path}`;
  if (location.hash === target) {
    render();
  } else {
    location.hash = path;
  }
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

  // Welcome gate: until user has seen Welcome, force them through it.
  // After Welcome, Feed/Rules/Profile-lite are open — no full onboarding required.
  if (!u.welcomeSeen && path !== '/welcome') {
    go('/welcome');
    return;
  }

  const loader = routes.get(path) ?? routes.get('/feed');
  const root = document.getElementById('app');
  const tabbar = document.getElementById('tabbar');

  root.replaceChildren();
  const view = await loader();
  root.appendChild(view);

  const hideTabbar = !u.welcomeSeen || path === '/welcome' || path === '/onboarding';
  tabbar.hidden = hideTabbar;
  syncTabActive(path);
}

function syncTabActive(path) {
  const buttons = document.querySelectorAll('#tabbar .tab');
  for (const btn of buttons) {
    const route = btn.dataset.route;
    btn.classList.toggle('tab--active', route === path);
  }
}

export function start() {
  window.addEventListener('hashchange', render);
  render();
}
