// BD-MAP-01 — MapHome foundation (no real Mapbox SDK).
// Renders 5 render-gate states over the existing MapShell visual
// language. Stub mapbox/* modules supply state; no network calls,
// no native geolocation prompt on mount.

import { escapeHtml } from '../util.js';
import { go } from '../router.js';
import { createMapShell } from '../mapbox/map_shell.js';
import { hasMapboxToken } from '../mapbox/mapbox_config.js';
import {
  MAP_STATE,
  isValidMapState,
  loadMapPrefs,
  saveMapPrefs,
} from '../mapbox/mapbox_state.js';
import { GEO_STATUS, getPermissionStatus } from '../mapbox/geolocation_service.js';

const STATE_QUERY_KEYS = new Map([
  ['default',       MAP_STATE.DEFAULT],
  ['permission',    MAP_STATE.PERMISSION],
  ['denied',        MAP_STATE.DENIED],
  ['nearby',        MAP_STATE.NEARBY],
  ['token-missing', MAP_STATE.TOKEN_MISSING],
  ['token_missing', MAP_STATE.TOKEN_MISSING],
]);

const STATE_COPY = {
  [MAP_STATE.DEFAULT]: {
    badge:   'demo · mock map',
    title:   'Куда поедем?',
    hint:    'Выберите маршрут или включите «Моё место», чтобы увидеть заказы рядом.',
  },
  [MAP_STATE.PERMISSION]: {
    badge:   'нужен доступ к геолокации',
    title:   'Включите «Моё место»',
    hint:    'Чтобы показать заказы и водителей рядом, разрешите BazarDrive определять ваше местоположение.',
  },
  [MAP_STATE.DENIED]: {
    badge:   'доступ к геолокации отклонён',
    title:   'Геолокация выключена',
    hint:    'Разрешите доступ в настройках браузера или выберите точку подачи вручную.',
  },
  [MAP_STATE.NEARBY]: {
    badge:   'demo · заказы рядом',
    title:   'Заказы рядом',
    hint:    'Реальные заказы появятся, когда подключим Mapbox и данные водителей.',
  },
  [MAP_STATE.TOKEN_MISSING]: {
    badge:   'Демо-режим',
    title:   'Карта временно недоступна',
    hint:    'Можно выбрать маршрут вручную — заказ всё равно сохранится.',
  },
};

const PERMISSION_CONSENT = [
  'Заказы и водители рядом — без ручного поиска',
  'Точка подачи определяется автоматически',
  'Маршрут до точки назначения считается от вас',
];

const NEARBY_ORDERS = [
  { name: 'Анна М.',   initials: 'А', rating: '4.9', meta: '1.2 км · сейчас', price: '320 ₽' },
  { name: 'Сергей Л.', initials: 'С', rating: '4.8', meta: '2.4 км · 5 мин',  price: '480 ₽' },
  { name: 'Нурлан',    initials: 'Н', rating: '5.0', meta: '3.1 км · 8 мин',  price: '610 ₽' },
];

function getHashQuery() {
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  return qi === -1 ? new URLSearchParams() : new URLSearchParams(hash.slice(qi + 1));
}

// Render-gate decision tree.
// Priority: explicit ?state= override → token check → geolocation
// permission state → default. Token check wins over permission, per
// the BD-MAP-01 render-gate verification notes.
function resolveState(query, prefs) {
  const override = query.get('state');
  if (override) {
    const mapped = STATE_QUERY_KEYS.get(override);
    if (isValidMapState(mapped)) return mapped;
  }
  if (!hasMapboxToken()) return MAP_STATE.TOKEN_MISSING;
  const perm = getPermissionStatus();
  if (perm === GEO_STATUS.DENIED) return MAP_STATE.DENIED;
  if (!prefs.locationAllowed && (perm === GEO_STATUS.UNKNOWN || perm === GEO_STATUS.PROMPT)) {
    return MAP_STATE.PERMISSION;
  }
  return MAP_STATE.DEFAULT;
}

function buildMapPlaceholder(state) {
  const wrap = document.createElement('div');
  wrap.className = `map-home__map map-home__map--${state}`;
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', 'Карта-заглушка');
  wrap.dataset.state = state;

  const showRoute   = state === MAP_STATE.DEFAULT;
  const showCar     = state !== MAP_STATE.TOKEN_MISSING;
  const showPickup  = state === MAP_STATE.DEFAULT || state === MAP_STATE.NEARBY;
  const showDropoff = state === MAP_STATE.DEFAULT;

  const shell = createMapShell({
    variant: 'driver',
    showRoute,
    showCar,
    showPickup,
    showDropoff,
    showLabels: false,
  });
  shell.setAttribute('aria-hidden', 'true');
  wrap.appendChild(shell);

  if (state === MAP_STATE.NEARBY) {
    const overlay = document.createElement('div');
    overlay.className = 'map-home__nearby';
    overlay.setAttribute('aria-hidden', 'true');

    const pulse = document.createElement('span');
    pulse.className = 'map-home__pulse';
    overlay.appendChild(pulse);

    for (let i = 0; i < 5; i++) {
      const c = document.createElement('span');
      c.className = `map-home__cluster map-home__cluster--${i + 1}`;
      c.textContent = String(i + 1);
      overlay.appendChild(c);
    }
    wrap.appendChild(overlay);
  }

  if (state === MAP_STATE.TOKEN_MISSING) {
    const lock = document.createElement('div');
    lock.className = 'map-home__lock';
    lock.setAttribute('aria-hidden', 'true');
    lock.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
           stroke-linecap="round" stroke-linejoin="round" width="36" height="36">
        <rect x="4" y="10" width="16" height="11" rx="2"/>
        <path d="M8 10V7a4 4 0 0 1 8 0v3"/>
      </svg>
    `;
    wrap.appendChild(lock);
  }

  const watermark = document.createElement('div');
  watermark.className = 'map-home__watermark';
  watermark.textContent = 'Mapbox SDK пока не подключён';
  wrap.appendChild(watermark);

  return wrap;
}

function buildBanner(state) {
  if (state === MAP_STATE.DEFAULT || state === MAP_STATE.NEARBY) return null;
  const banner = document.createElement('div');
  banner.className = `map-home__banner map-home__banner--${state}`;
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');

  const copy = STATE_COPY[state];
  banner.innerHTML = `
    <div class="map-home__banner-title">${escapeHtml(copy.title)}</div>
    <p class="map-home__banner-hint">${escapeHtml(copy.hint)}</p>
  `;
  return banner;
}

// ── Per-state action cards ──────────────────────────────────

function makeCardRoot(state) {
  const card = document.createElement('div');
  card.className = `map-home__sheet map-home__sheet--${state}`;
  card.innerHTML = `<div class="map-home__sheet-grip" aria-hidden="true"></div>`;
  return card;
}

function buildDefaultCard() {
  const card = makeCardRoot(MAP_STATE.DEFAULT);
  card.insertAdjacentHTML('beforeend', `
    <button class="bd-btn primary map-home__cta" type="button" data-action="route">
      Выбрать маршрут
    </button>
    <div class="map-home__sheet-row">
      <button class="bd-btn map-home__chip" type="button"
              data-action="my-location" aria-label="Моё место">
        Моё место
      </button>
      <button class="bd-btn map-home__chip" type="button" data-action="nearby">
        Заказы рядом
      </button>
    </div>
  `);
  return card;
}

function buildPermissionCard() {
  const card = makeCardRoot(MAP_STATE.PERMISSION);
  const items = PERMISSION_CONSENT.map((t) => `
    <li class="map-home__consent-item">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
           width="16" height="16" class="map-home__consent-check">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      <span>${escapeHtml(t)}</span>
    </li>
  `).join('');
  card.insertAdjacentHTML('beforeend', `
    <div class="map-home__consent-head">Что даёт доступ к геолокации</div>
    <ul class="map-home__consent-list">${items}</ul>
    <button class="bd-btn primary map-home__cta" type="button"
            data-action="my-location" aria-label="Моё место">
      Разрешить доступ
    </button>
    <button class="bd-btn ghost map-home__cta map-home__cta--ghost" type="button"
            data-action="manual">
      Ввести адрес вручную
    </button>
  `);
  return card;
}

function buildDeniedCard() {
  const card = makeCardRoot(MAP_STATE.DENIED);
  card.insertAdjacentHTML('beforeend', `
    <div class="map-home__warn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
           width="20" height="20">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <div class="map-home__warn-body">
        <div class="map-home__warn-title">Геолокация отключена</div>
        <p class="map-home__warn-hint">Включите доступ к местоположению в настройках браузера или продолжите ввод вручную.</p>
      </div>
    </div>
    <button class="map-home__manual" type="button" data-action="manual">
      <span class="map-home__manual-dot" aria-hidden="true"></span>
      <span class="map-home__manual-text">Введите адрес подачи вручную</span>
    </button>
    <div class="map-home__sheet-row">
      <button class="bd-btn map-home__chip" type="button" data-action="settings">
        Открыть настройки
      </button>
      <button class="bd-btn map-home__chip" type="button" data-action="manual">
        Ввести вручную
      </button>
    </div>
  `);
  return card;
}

function buildNearbyOrdersCard() {
  const card = makeCardRoot(MAP_STATE.NEARBY);
  const rows = NEARBY_ORDERS.map((o, i) => `
    <li class="map-home__order">
      <div class="map-home__order-num" aria-hidden="true">${i + 1}</div>
      <div class="map-home__order-avatar" aria-hidden="true">${escapeHtml(o.initials)}</div>
      <div class="map-home__order-info">
        <div class="map-home__order-name">${escapeHtml(o.name)}</div>
        <div class="map-home__order-meta">★ ${escapeHtml(o.rating)} · ${escapeHtml(o.meta)}</div>
      </div>
      <div class="map-home__order-price">${escapeHtml(o.price)}</div>
    </li>
  `).join('');
  // The verified render gate keeps a 5-vs-3 asymmetry on purpose:
  // 5 numbered clusters on the map, only the top 3 fit in the bottom
  // card. The counter therefore must read «5», not the visible row count.
  card.insertAdjacentHTML('beforeend', `
    <div class="map-home__count">
      <span class="map-home__count-num">5</span>
      <span class="map-home__count-label">заказов рядом</span>
    </div>
    <ul class="map-home__order-list" aria-label="Заказы рядом">${rows}</ul>
    <div class="map-home__sheet-row">
      <button class="bd-btn map-home__chip" type="button" data-action="route">
        Выбрать маршрут
      </button>
      <button class="bd-btn map-home__chip" type="button"
              data-action="my-location" aria-label="Моё место">
        Моё место
      </button>
    </div>
  `);
  return card;
}

function buildTokenMissingCard() {
  const card = makeCardRoot(MAP_STATE.TOKEN_MISSING);
  card.insertAdjacentHTML('beforeend', `
    <button class="bd-btn primary map-home__cta" type="button" data-action="route">
      Выбрать маршрут
    </button>
    <button class="bd-btn ghost map-home__cta map-home__cta--ghost" type="button"
            data-action="manual">
      Ввести адрес вручную
    </button>
  `);
  return card;
}

function buildActionCard(state) {
  switch (state) {
    case MAP_STATE.PERMISSION:    return buildPermissionCard();
    case MAP_STATE.DENIED:        return buildDeniedCard();
    case MAP_STATE.NEARBY:        return buildNearbyOrdersCard();
    case MAP_STATE.TOKEN_MISSING: return buildTokenMissingCard();
    default:                      return buildDefaultCard();
  }
}

export default function mapScreen() {
  const query  = getHashQuery();
  const prefs  = loadMapPrefs();
  const state  = resolveState(query, prefs);
  const copy   = STATE_COPY[state];

  const root = document.createElement('section');
  root.className = `screen screen--map screen--map-${state}`;
  root.dataset.state = state;

  const topbar = document.createElement('div');
  topbar.className = 'bd-topbar map-home__topbar';
  topbar.innerHTML = `
    <div class="bd-topbar__titles">
      <h1 class="bd-topbar__title">Карта</h1>
      <p class="bd-topbar__sub map-home__sub">${escapeHtml(copy.badge)}</p>
    </div>
  `;
  root.appendChild(topbar);

  const stage = document.createElement('div');
  stage.className = 'map-home__stage';
  stage.appendChild(buildMapPlaceholder(state));
  const banner = buildBanner(state);
  if (banner) stage.appendChild(banner);
  root.appendChild(stage);

  root.appendChild(buildActionCard(state));

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.action;
    if (action === 'my-location') {
      if (state === MAP_STATE.PERMISSION) {
        go('/location-permission');
        return;
      }
      // No native geolocation prompt — stub flips local pref and
      // re-renders into the default state on next visit. Real
      // permission explanation is handled by BD-MAP-02 before any real prompt.
      saveMapPrefs({ locationAllowed: true });
      go('/map?state=default');
    } else if (action === 'nearby') {
      go('/map?state=nearby');
    } else if (action === 'route' || action === 'manual') {
      go('/route-picker');
    } else if (action === 'feed') {
      go('/feed');
    }
    // `settings` is a deliberate no-op stub — there is no real
    // browser-settings deep link in this PWA shell.
  });

  return root;
}
