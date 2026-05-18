// BD-MAP-01 — MapHome foundation (no real Mapbox SDK).
// Renders 5 render-gate states over the existing MapShell visual
// language. Stub mapbox/* modules supply state; no network calls,
// no native geolocation prompt on mount.

import { escapeHtml } from '../util.js';
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
    badge:   'Mapbox token отсутствует',
    title:   'Карта временно недоступна',
    hint:    'Mapbox SDK ещё не подключён. Маршрут можно выбрать вручную, без живой карты.',
  },
};

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

  const showRoute   = state === MAP_STATE.DEFAULT || state === MAP_STATE.NEARBY;
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
    const dots = document.createElement('div');
    dots.className = 'map-home__nearby';
    dots.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 4; i++) {
      const d = document.createElement('span');
      d.className = `map-home__nearby-dot map-home__nearby-dot--${i + 1}`;
      dots.appendChild(d);
    }
    wrap.appendChild(dots);
  }

  const watermark = document.createElement('div');
  watermark.className = 'map-home__watermark';
  watermark.textContent = 'Mapbox SDK пока не подключён';
  wrap.appendChild(watermark);

  return wrap;
}

function buildBanner(state) {
  if (state === MAP_STATE.DEFAULT) return null;
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

function buildActionCard(state) {
  const card = document.createElement('div');
  card.className = 'map-home__sheet';

  const tokenMissing  = state === MAP_STATE.TOKEN_MISSING;
  const denied        = state === MAP_STATE.DENIED;
  const myLocBtnAttrs = tokenMissing || denied ? 'disabled' : '';

  card.innerHTML = `
    <div class="map-home__sheet-grip" aria-hidden="true"></div>
    <button class="bd-btn primary map-home__cta" type="button" data-action="route">
      Выбрать маршрут
    </button>
    <div class="map-home__sheet-row">
      <button class="bd-btn map-home__chip" type="button"
              data-action="my-location" aria-label="Моё место" ${myLocBtnAttrs}>
        Моё место
      </button>
      <button class="bd-btn map-home__chip" type="button" data-action="nearby">
        Заказы рядом
      </button>
    </div>
  `;
  return card;
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
      // No native geolocation prompt — stub flips local pref and
      // re-renders into the default state on next visit. Real
      // permission flow lands with BD-MAP-FOUND-01.
      saveMapPrefs({ locationAllowed: true });
      window.location.hash = '/map';
    } else if (action === 'nearby') {
      window.location.hash = '/map?state=nearby';
    } else if (action === 'route') {
      // /route-picker is planned (BD-MAP-03) and not registered yet;
      // the hash router falls back to /feed gracefully.
      window.location.hash = '/map?state=default';
    }
  });

  return root;
}
