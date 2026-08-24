// BD-MAP-01 — MapHome render gate; BD-MAP-RENDER-MAP (#805) — first per-surface REAL Mapbox render.
// 5 render-gate states over the MapShell placeholder. DARK by default: with no token, resolveState()
// never reaches DEFAULT (it returns TOKEN_MISSING), so no real map is constructed and the placeholder
// is byte-for-byte unchanged. When a token IS set (isMapboxEnabled()), the DEFAULT state hydrates a
// real mapboxgl.Map over the placeholder (render-then-hydrate), with a self-clearing GL-context teardown.

import { escapeHtml } from '../util.js';
import { go } from '../router.js';
import { createMapShell } from '../mapbox/map_shell.js';
import { hasMapboxToken, isMapboxEnabled, getDefaultCenter, MAPBOX_STYLE } from '../mapbox/mapbox_config.js';
import { loadMapboxSdk } from '../mapbox/mapbox_loader.js';
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

// BD-MAP-RENDER-MAP (#805) — render-then-hydrate. The placeholder `container` is already painted; once
// the vendored SDK loads (only when a token is configured), take over the container with a real map.
// loadMapboxSdk() resolves null when DARK (no token) or on failure → the placeholder simply stays, so
// this is inert without a token.
//
// BD-SCREEN-LIFECYCLE-01A (#919) pilot — hydration is fire-and-forget and asynchronous (an SDK load, a
// requestAnimationFrame deferral), so the mapboxgl.Map instance does not exist yet at the moment
// mapScreen() returns its lifecycle result to the router. `lifecycle` is a small mutable handle shared
// between mapScreen()'s returned dispose() and this function's async continuation, so dispose() can
// close over whatever this function has (or hasn't) created by the time it actually runs:
//   - lifecycle.disposed: set true exactly once by dispose(); checked here in ADDITION to the existing
//     document.body.contains(container) check, immediately before `new mapboxgl.Map(...)`, so a late
//     hydration continuation for an already-disposed screen never creates a new GL resource.
//   - lifecycle.mapInstance: becomes known the moment the map is actually constructed.
//   - lifecycle.teardownId: the existing 2s defensive self-poll, kept unchanged as a backstop for any
//     detachment the router-owned disposer didn't observe. It is idempotent against a disposer that
//     already ran (checks lifecycle.disposed first) and dispose() is idempotent against a poll that
//     already ran (checks lifecycle.mapInstance/teardownId before touching them) — whichever fires
//     first does the real work, the other is a safe no-op.
function hydrateRealMap(container, lifecycle) {
  loadMapboxSdk().then((mapboxgl) => {
    if (!mapboxgl) return;                              // DARK / SDK unavailable → keep the placeholder
    // On a memoized-SDK REVISIT this .then runs as a microtask BEFORE router.js appends the screen
    // (Codex #812), so the container isn't mounted yet — bailing here would leave /map on the
    // placeholder forever. Defer to the next frame (after the append) instead of bailing permanently.
    requestAnimationFrame(() => {
      if (lifecycle.disposed) return;                    // BD-SCREEN-LIFECYCLE-01A — already disposed
      if (!document.body.contains(container)) return;   // navigated away before it mounted
      const c = getDefaultCenter();
      container.replaceChildren();                       // drop the placeholder shell/watermark
      container.removeAttribute('aria-label');           // the live canvas is the map now
      let map;
      try {
        map = new mapboxgl.Map({
          container,
          style: MAPBOX_STYLE,
          center: [c.lng, c.lat],
          zoom: c.zoom,
        });
      } catch {
        // GL unavailable / CSP / style or token rejected — restore the dark-safe placeholder (the
        // container was already cleared) rather than leave a blank panel (Codex #812).
        restoreMapPlaceholder(container);
        return;
      }
      lifecycle.mapInstance = map;
      // Defensive backstop only (BD-SCREEN-LIFECYCLE-01A): the router-owned disposer is now the
      // primary cleanup path and frees the GL context immediately on navigation. This poll only
      // still matters for a detachment the disposer somehow didn't observe.
      lifecycle.teardownId = setInterval(() => {
        if (lifecycle.disposed) { clearInterval(lifecycle.teardownId); lifecycle.teardownId = null; return; }
        if (!document.body.contains(container)) {
          try { map.remove(); } catch { /* already torn down */ }
          lifecycle.mapInstance = null;
          clearInterval(lifecycle.teardownId);
          lifecycle.teardownId = null;
        }
      }, 2000);
    });
  }).catch(() => { /* load failed — the placeholder stays */ });
}

// Rebuild the DEFAULT-state placeholder shell after a failed Map construction (Codex #812):
// replaceChildren() has already cleared the container, so restore the MapShell rather than a blank card.
function restoreMapPlaceholder(container) {
  container.setAttribute('aria-label', 'Карта-заглушка');
  const shell = createMapShell({
    variant: 'driver', showRoute: true, showCar: true, showPickup: true, showDropoff: true, showLabels: false,
  });
  shell.setAttribute('aria-hidden', 'true');
  container.replaceChildren(shell);
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
  // Intentional render-gate asymmetry: map overlay shows 5 numbered clusters,
  // while the bottom sheet lists top-3 nearby rows.
  const nearbyCount = 5;
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
  card.insertAdjacentHTML('beforeend', `
    <div class="map-home__count">
      <span class="map-home__count-num">${nearbyCount}</span>
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
  const mapWrap = buildMapPlaceholder(state);
  stage.appendChild(mapWrap);
  // BD-SCREEN-LIFECYCLE-01A (#919) pilot — shared mutable handle between this closure's returned
  // dispose() and hydrateRealMap()'s async continuation (see the comment on hydrateRealMap).
  const mapLifecycle = { disposed: false, mapInstance: null, teardownId: null };
  // BD-MAP-RENDER-MAP (#805): in the live DEFAULT state WITH a token, hydrate a real Mapbox map over the
  // placeholder. DARK (no token) ⇒ resolveState() returns TOKEN_MISSING (never DEFAULT) AND
  // isMapboxEnabled() is false, so this never runs and the placeholder path is byte-for-byte unchanged.
  if (state === MAP_STATE.DEFAULT && isMapboxEnabled()) hydrateRealMap(mapWrap, mapLifecycle);
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

  return {
    view: root,
    // BD-SCREEN-LIFECYCLE-01A (#919) pilot — router-owned, exactly-once. Idempotent: a second call
    // (e.g. the 2s defensive poll having already fired) is a safe no-op.
    dispose() {
      if (mapLifecycle.disposed) return;
      mapLifecycle.disposed = true;
      if (mapLifecycle.teardownId) { clearInterval(mapLifecycle.teardownId); mapLifecycle.teardownId = null; }
      if (mapLifecycle.mapInstance) {
        try { mapLifecycle.mapInstance.remove(); } catch { /* already torn down */ }
        mapLifecycle.mapInstance = null;
      }
    },
  };
}
