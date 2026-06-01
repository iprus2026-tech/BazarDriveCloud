// BD-MAP-03 — RoutePicker implementation (mock-only, no real Mapbox SDK).
// Keeps routeDraft persisted under bazardrive.route_draft.v1 so the
// passenger can refresh /route-picker without losing pickup/dropoff.
// Malformed payloads are dropped silently and the screen resets to the
// EMPTY state. No network calls, no native geolocation prompt.

import { escapeHtml } from '../util.js';
import { go } from '../router.js';
import { createMapShell } from '../mapbox/map_shell.js';
import { peekRepeatRouteDraft, clearRepeatRouteDraft } from '../repeat_route.js';
import { peekFavoriteNotice, clearFavoriteNotice } from '../favorite_routes.js';
import { findLatestHandedOffOrderTripId } from '../mock_api.js';

const ROUTE_DRAFT_KEY = 'bazardrive.route_draft.v1';
const ALLOWED_SOURCES = new Set(['current', 'search', 'manual']);
const ALLOWED_FOCUS = new Set(['pickup', 'dropoff']);
const ALLOWED_PREFILL_SOURCES = new Set(['repeat', 'favorite']);

const PREFILL_COPY = {
  repeat: 'Маршрут заполнен из истории',
  favorite: 'Маршрут заполнен из избранного',
};

const ROUTE_STATUS = {
  EMPTY: 'empty',
  PICKUP_SELECTED: 'pickup-selected',
  DROPOFF_SELECTED: 'dropoff-selected',
  SEARCH_RESULTS: 'search-results',
  MANUAL_FALLBACK: 'manual-fallback',
  ROUTE_DRAFT_READY: 'route-draft-ready',
};

const FOCUS_LABELS = {
  pickup: 'Откуда',
  dropoff: 'Куда',
};

const MOCK_CURRENT_LOCATION = makePoint(
  'current-location',
  'Моё место',
  'mock · текущая точка подачи',
  'current'
);

// BD-MAP-03B — mock suggestion pool aligned with the Cloud Design render
// gate (state 4 · Search results — «Внуково»). Typing «Внуково» yields the
// four airport rows shown in the design; the rest keep the recent picks
// reachable from search. No Geocoding API — this is an in-file mock list.
const MOCK_SUGGESTIONS = [
  makePoint('vnukovo-a', 'Аэропорт Внуково, терминал А', 'Москва · 28 км', 'search'),
  makePoint('vnukovo-b', 'Аэропорт Внуково, терминал B', 'Москва · 28 км', 'search'),
  makePoint('vnukovo-road', 'Внуковское ш., 24', 'Москва · 26 км', 'search'),
  makePoint('vnukovo-hotel', 'Гостиница «Внуково Аэро»', 'Внуково · 27 км', 'search'),
  makePoint('sheremetyevo', 'Аэропорт Шереметьево, терминал D', 'Москва · 38 км', 'search'),
  makePoint('mega-himki', 'ТЦ Мега Химки', 'Химки · 22 км', 'search'),
  makePoint('park-pobedy', 'м. Парк Победы', 'Москва', 'search'),
];

// BD-MAP-03B — mock saved / recent rows for the picker body (states 1–3).
// Display-only chrome: a row carries its own `name` (Дом / Работа) while the
// `point` it selects keeps the human-readable address as the label, so the
// chosen pickup/dropoff reads exactly like the Cloud Design field value.
const SAVED_PLACES = [
  {
    id: 'saved-home',
    name: 'Дом',
    icon: 'home',
    point: makePoint('saved-home', 'ул. Малая Бронная, 28', 'Дом', 'search'),
  },
  {
    id: 'saved-work',
    name: 'Работа',
    icon: 'work',
    point: makePoint('saved-work', 'Бизнес-центр «Лесная Плаза»', 'Работа', 'search'),
  },
];

const RECENT_PLACES = [
  {
    id: 'recent-svo',
    date: 'Вчера',
    point: makePoint('recent-svo', 'Аэропорт Шереметьево, терминал D', 'Москва · 38 км', 'search'),
  },
  {
    id: 'recent-mega',
    date: '11 мая',
    point: makePoint('recent-mega', 'ТЦ Мега Химки', 'Химки · 22 км', 'search'),
  },
  {
    id: 'recent-park',
    date: '08 мая',
    point: makePoint('recent-park', 'м. Парк Победы', 'Москва', 'search'),
  },
];

// data-place lookup: saved + recent rows resolve to a RoutePoint that is
// dropped into the currently focused field via the shared setPoint() path.
const STATIC_PLACES = new Map();
for (const entry of [...SAVED_PLACES, ...RECENT_PLACES]) {
  STATIC_PLACES.set(entry.id, entry.point);
}

const routeDraft = {
  pickup: null,
  dropoff: null,
  focus: 'pickup',
  query: '',
  results: [],
  source: null,
  status: ROUTE_STATUS.EMPTY,
  stage: 'pickup',
  route: null,
  // BD-MAP-03B — transient UI flag for the "Ввод адреса вручную" form
  // (render-gate state 5). Never persisted: it only toggles which body the
  // picker renders, the actual address is committed through setPoint().
  manual: false,
  // BD-ROUTE-REPEAT-02 — non-blocking provenance marker for a prefilled
  // route. Surfaces a soft helper banner ("Маршрут заполнен из истории" /
  // "Маршрут заполнен из избранного") and is cleared by every clear path.
  prefillSource: null,
  prefillLabel: '',
};

let notice = '';
let hydrated = false;

// BD-MAP-03 (/active-ride guard) — when the passenger already has a live
// handed-off trip, the picker must not silently start a brand-new route on
// top of it. We surface a non-blocking guard banner (resume vs. plan a new
// route) and keep the Continue CTA gated until the passenger explicitly
// dismisses the guard. Read-only: this only *reads* the active-ride record
// via the existing mock_api helper, it never mutates the active-ride state
// machine (active_ride.js / ride_state.js stay untouched). The guard is
// resolved once per RoutePicker mount (not on every render), so typing in
// the fields never re-parses localStorage. Dismissal is scoped to the
// current tripId: dismissing trip A hides the guard only for trip A, so a
// later/different live trip (or a fresh navigation to #/route-picker) still
// re-shows it.
let activeRideGuardDismissedTripId = null;
let activeRideGuardTripId = null;

function resolveActiveRideGuardTripId() {
  let candidateTripId = null;
  try {
    candidateTripId = findLatestHandedOffOrderTripId();
  } catch {
    candidateTripId = null;
  }
  candidateTripId = typeof candidateTripId === 'string' && candidateTripId
    ? candidateTripId
    : null;
  activeRideGuardTripId = candidateTripId && candidateTripId !== activeRideGuardDismissedTripId
    ? candidateTripId
    : null;
  return activeRideGuardTripId;
}

function makePoint(id, label, hint, source) {
  return {
    id,
    label,
    hint,
    source,
    coords: null,
  };
}

function clonePoint(point) {
  if (!point) return null;
  return { ...point };
}

function cloneRoute(route) {
  if (!route) return null;
  return { ...route };
}

// Local, deterministic estimate so /route-picker can show distance/duration/
// price without a Mapbox Directions request. Same pickup/dropoff pair always
// yields the same numbers across reloads, so the persisted route survives
// refresh without drifting.
function hashLabel(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function estimateRoute(pickup, dropoff) {
  if (!pickup || !dropoff) return null;
  const seed = hashLabel(`${pickup.label}→${dropoff.label}`);
  const distanceKm = Math.round((3 + (seed % 220) / 10) * 10) / 10;
  const durationMin = Math.max(5, Math.round(8 + distanceKm * 2.4));
  const estimatedPrice = Math.round(80 + distanceKm * 35);
  return { distanceKm, durationMin, estimatedPrice };
}

function computeStage() {
  if (routeDraft.pickup && routeDraft.dropoff) return 'ready';
  if (routeDraft.pickup) return 'dropoff';
  return 'pickup';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizePoint(raw) {
  if (!isPlainObject(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id : '';
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  if (!id || !label) return null;
  const hint = typeof raw.hint === 'string' ? raw.hint : '';
  const source = ALLOWED_SOURCES.has(raw.source) ? raw.source : 'manual';
  return { id, label, hint, source, coords: null };
}

function readPersistedDraft() {
  let raw;
  try {
    if (typeof localStorage === 'undefined') return null;
    raw = localStorage.getItem(ROUTE_DRAFT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearPersistedDraft();
    return null;
  }
  if (!isPlainObject(parsed)) {
    clearPersistedDraft();
    return null;
  }
  return parsed;
}

function sanitizePrefillSource(raw) {
  return ALLOWED_PREFILL_SOURCES.has(raw) ? raw : null;
}

function sanitizePrefillLabel(raw) {
  return typeof raw === 'string' ? raw.trim().slice(0, 120) : '';
}

// BD-ROUTE-REPEAT-02 — when no persisted route_draft exists, peek at the
// repeat-route / favorite-notice handoff keys to soft-prefill pickup &
// dropoff. Peek is non-destructive on purpose: composer (/new) still owns
// consumption of repeat_route.v1, so a stray prefill cannot leak into the
// composer if the user later navigates there. Malformed payloads return
// null from the peek helpers and are silently ignored here.
function buildPrefillFromHandoff() {
  const repeat = peekRepeatRouteDraft();
  if (!repeat) return null;
  const favoriteNotice = peekFavoriteNotice();
  const isFavorite = favoriteNotice && favoriteNotice.source === 'favorite';
  return {
    pickup: makePoint(
      `prefill-pickup-${Date.now()}`,
      repeat.pickup,
      isFavorite ? 'Из избранного' : 'Из истории поездки',
      'manual',
    ),
    dropoff: makePoint(
      `prefill-dropoff-${Date.now()}`,
      repeat.dropoff,
      isFavorite ? 'Из избранного' : 'Из истории поездки',
      'manual',
    ),
    prefillSource: isFavorite ? 'favorite' : 'repeat',
    prefillLabel: isFavorite ? favoriteNotice.label : '',
  };
}

function hydrateFromStorage() {
  if (hydrated) return;
  hydrated = true;
  const parsed = readPersistedDraft();
  if (parsed) {
    const pickup = sanitizePoint(parsed.pickup);
    const dropoff = sanitizePoint(parsed.dropoff);
    if (!pickup && !dropoff) {
      if (parsed.pickup != null || parsed.dropoff != null) clearPersistedDraft();
    } else {
      routeDraft.pickup = pickup;
      routeDraft.dropoff = dropoff;
      routeDraft.focus = ALLOWED_FOCUS.has(parsed.focus)
        ? parsed.focus
        : (pickup ? 'dropoff' : 'pickup');
      routeDraft.source = pickup?.source ?? dropoff?.source ?? null;
      routeDraft.prefillSource = sanitizePrefillSource(parsed.prefillSource);
      routeDraft.prefillLabel = routeDraft.prefillSource
        ? sanitizePrefillLabel(parsed.prefillLabel)
        : '';
      syncDraft();
      persistDraft();
      return;
    }
  }

  // No usable persisted route — look for a pending repeat / favorite handoff.
  const prefill = buildPrefillFromHandoff();
  if (!prefill) return;
  routeDraft.pickup = prefill.pickup;
  routeDraft.dropoff = prefill.dropoff;
  routeDraft.focus = 'pickup';
  routeDraft.source = 'manual';
  routeDraft.prefillSource = prefill.prefillSource;
  routeDraft.prefillLabel = prefill.prefillLabel;
  syncDraft();
  persistDraft();
  // BD-ROUTE-REPEAT-02 (PR-258 review) — the repeat-route / favorite
  // notice handoff is one-time by contract. Now that the pickup &
  // dropoff have been lifted into route_draft.v1, drop both keys so the
  // composer (/new) cannot later reapply the same route on top of a
  // freshly cleared or already-handled state.
  clearRepeatRouteDraft();
  clearFavoriteNotice();
}

function persistDraft() {
  try {
    if (typeof localStorage === 'undefined') return;
    if (!routeDraft.pickup && !routeDraft.dropoff) {
      localStorage.removeItem(ROUTE_DRAFT_KEY);
      return;
    }
    const payload = {
      pickup: routeDraft.pickup,
      dropoff: routeDraft.dropoff,
      focus: routeDraft.focus,
      stage: routeDraft.stage,
      route: routeDraft.route,
      prefillSource: routeDraft.prefillSource,
      prefillLabel: routeDraft.prefillLabel,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(ROUTE_DRAFT_KEY, JSON.stringify(payload));
  } catch {
    // storage unavailable — fail soft.
  }
}

function clearPersistedDraft() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(ROUTE_DRAFT_KEY);
  } catch {
    // storage unavailable — fail soft.
  }
}

export function clearRouteDraftStore() {
  routeDraft.pickup = null;
  routeDraft.dropoff = null;
  routeDraft.focus = 'pickup';
  routeDraft.source = null;
  routeDraft.query = '';
  routeDraft.results = [];
  routeDraft.status = ROUTE_STATUS.EMPTY;
  routeDraft.stage = 'pickup';
  routeDraft.route = null;
  routeDraft.manual = false;
  routeDraft.prefillSource = null;
  routeDraft.prefillLabel = '';
  notice = '';
  activeRideGuardDismissedTripId = null;
  activeRideGuardTripId = null;
  clearPersistedDraft();
}

export function getRouteDraft() {
  hydrateFromStorage();
  syncDraft();
  return {
    ...routeDraft,
    pickup: clonePoint(routeDraft.pickup),
    dropoff: clonePoint(routeDraft.dropoff),
    results: routeDraft.results.map(clonePoint),
    route: cloneRoute(routeDraft.route),
  };
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function getMockResults(query) {
  const q = normalize(query);
  if (!q) return [];
  return MOCK_SUGGESTIONS.filter((item) => {
    const haystack = normalize(`${item.label} ${item.hint ?? ''}`);
    return haystack.includes(q);
  }).slice(0, 5);
}

function inferStatus() {
  if (routeDraft.query) {
    return routeDraft.results.length > 0
      ? ROUTE_STATUS.SEARCH_RESULTS
      : ROUTE_STATUS.MANUAL_FALLBACK;
  }
  if (routeDraft.pickup && routeDraft.dropoff) return ROUTE_STATUS.ROUTE_DRAFT_READY;
  if (routeDraft.pickup) return ROUTE_STATUS.PICKUP_SELECTED;
  if (routeDraft.dropoff) return ROUTE_STATUS.DROPOFF_SELECTED;
  return ROUTE_STATUS.EMPTY;
}

function syncDraft() {
  routeDraft.results = getMockResults(routeDraft.query);
  routeDraft.status = inferStatus();
  routeDraft.route = estimateRoute(routeDraft.pickup, routeDraft.dropoff);
  routeDraft.stage = computeStage();
}

function clearQuery() {
  routeDraft.query = '';
  routeDraft.results = [];
}

function setPoint(kind, point) {
  routeDraft[kind] = clonePoint(point);
  routeDraft.source = point?.source ?? null;
  if (kind === 'pickup' && !routeDraft.dropoff) routeDraft.focus = 'dropoff';
  if (kind === 'dropoff' && !routeDraft.pickup) routeDraft.focus = 'pickup';
  // BD-ROUTE-REPEAT-02 — any manual edit invalidates the "filled from
  // history/favorite" provenance so the helper banner does not linger
  // over a route the user has since reshaped.
  routeDraft.prefillSource = null;
  routeDraft.prefillLabel = '';
  routeDraft.manual = false;
  clearQuery();
  notice = '';
  syncDraft();
  persistDraft();
}

function clearPoint(kind) {
  routeDraft[kind] = null;
  routeDraft.focus = kind;
  routeDraft.source = null;
  routeDraft.prefillSource = null;
  routeDraft.prefillLabel = '';
  clearQuery();
  notice = '';
  syncDraft();
  persistDraft();
}

function clearAll() {
  routeDraft.pickup = null;
  routeDraft.dropoff = null;
  routeDraft.focus = 'pickup';
  routeDraft.source = null;
  routeDraft.prefillSource = null;
  routeDraft.prefillLabel = '';
  routeDraft.manual = false;
  clearQuery();
  notice = '';
  syncDraft();
  persistDraft();
}

function makeManualPoint() {
  const label = routeDraft.query.trim();
  return makePoint(`manual-${Date.now()}`, label, 'Введено вручную', 'manual');
}

function activeInputValue(kind) {
  if (routeDraft.focus === kind && routeDraft.query) return routeDraft.query;
  return routeDraft[kind]?.label ?? '';
}

function renderClearButton(kind) {
  if (!routeDraft[kind]) return '';
  return `
    <button class="rp-field__clear" type="button" data-clear="${kind}"
            aria-label="Очистить точку">
      ×
    </button>
  `;
}

// BD-MAP-03B — route input field. The pickup/dropoff dots and the
// connecting line live in the card rail (renderRouteCard), so the field
// itself only carries the label + input + clear button. Visual parity with
// render-gate states 1–3 (ОТКУДА / КУДА, «Где вас забрать?» / «Куда едем?»).
function renderPointField(kind) {
  const isActive = routeDraft.focus === kind;
  const point = routeDraft[kind];
  const placeholder = kind === 'pickup'
    ? 'Где вас забрать?'
    : 'Куда едем?';

  return `
    <div class="rp-field ${isActive ? 'is-active' : ''} ${point ? 'is-filled' : ''}"
         data-focus="${kind}">
      <label class="rp-field__label" for="rp-${kind}">${FOCUS_LABELS[kind]}</label>
      <div class="rp-field__input-row">
        <input id="rp-${kind}" class="rp-field__input" data-input="${kind}"
               value="${escapeHtml(activeInputValue(kind))}"
               placeholder="${escapeHtml(placeholder)}"
               aria-label="${escapeHtml(FOCUS_LABELS[kind])}"
               autocomplete="off" inputmode="search">
        ${renderClearButton(kind)}
      </div>
    </div>
  `;
}

// BD-MAP-03B — route input card: vertical route rail (pickup dot → line →
// dropoff dot) on the left, the two fields stacked on the right, and a
// "Моё место" route action on the far right (mirrors the render-gate icon
// button). The action keeps the existing current-location contract.
function renderRouteCard() {
  return `
    <div class="rp-card ${routeDraft.pickup ? 'has-pickup' : ''} ${routeDraft.dropoff ? 'has-dropoff' : ''}">
      <div class="rp-card__rail" aria-hidden="true">
        <span class="rp-card__dot rp-card__dot--pickup"></span>
        <span class="rp-card__line"></span>
        <span class="rp-card__dot rp-card__dot--dropoff"></span>
      </div>
      <div class="rp-card__fields">
        ${renderPointField('pickup')}
        <div class="rp-card__divider" aria-hidden="true"></div>
        ${renderPointField('dropoff')}
      </div>
      <button class="rp-card__action" type="button" data-action="current-location"
              aria-label="Использовать моё место">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="6" cy="6" r="2.4"/>
          <circle cx="18" cy="18" r="2.4"/>
          <path d="M8.4 6H15a3 3 0 0 1 3 3v6.6"/>
        </svg>
      </button>
    </div>
  `;
}

// BD-MAP-03B — search status row under the card. Copy follows the render
// gate: «Введите место подачи» (empty), «Введите место назначения» (pickup
// set), «Поиск: «<query>»» while typing. The «Готово» action collapses the
// search back to the saved/recent list.
function searchRowText() {
  if (routeDraft.query.trim()) return `Поиск: «${routeDraft.query.trim()}»`;
  if (routeDraft.focus === 'pickup') return 'Введите место подачи';
  return 'Введите место назначения';
}

function renderSearchRow() {
  return `
    <div class="rp-searchrow">
      <span class="rp-searchrow__icon" aria-hidden="true">i</span>
      <span class="rp-searchrow__text">${escapeHtml(searchRowText())}</span>
      <button class="rp-searchrow__done" type="button" data-action="done">Готово</button>
    </div>
  `;
}

function renderMap(ready) {
  const wrap = document.createElement('div');
  wrap.className = `rp-map ${ready ? 'rp-map--ready' : 'rp-map--compact'}`;
  wrap.setAttribute('aria-hidden', 'true');

  const shell = createMapShell({
    variant: 'passenger',
    showRoute: ready,
    showCar: false,
    showPickup: Boolean(routeDraft.pickup),
    showDropoff: Boolean(routeDraft.dropoff),
    showLabels: false,
    route: {
      pickupLabel: routeDraft.pickup?.label ?? 'Точка подачи',
      dropoffLabel: routeDraft.dropoff?.label ?? 'Точка назначения',
    },
  });
  shell.setAttribute('aria-hidden', 'true');
  wrap.appendChild(shell);

  if (!ready) {
    const crosshair = document.createElement('div');
    crosshair.className = 'rp-map__crosshair';
    crosshair.setAttribute('aria-hidden', 'true');
    wrap.appendChild(crosshair);
  }

  const watermark = document.createElement('div');
  watermark.className = 'rp-map__watermark';
  watermark.textContent = 'Mapbox SDK пока не подключён';
  wrap.appendChild(watermark);

  return wrap;
}

// BD-MAP-03B — saved + recent body (render-gate states 1–3). Mock-only:
// each row resolves through data-place → STATIC_PLACES → setPoint() for the
// currently focused field, so route_draft.v1 stays the single source of
// truth. «Добавить адрес» / «Ввести адрес вручную» open the manual form.
function savedIcon(kind) {
  if (kind === 'home') return '♥';
  if (kind === 'work') return '🏢';
  return '＋';
}

function renderSavedRecent() {
  const saved = SAVED_PLACES.map((entry) => `
    <button class="rp-place" type="button" data-place="${escapeHtml(entry.id)}"
            aria-label="${escapeHtml(entry.name)} — ${escapeHtml(entry.point.label)}">
      <span class="rp-place__icon rp-place__icon--saved" aria-hidden="true">${savedIcon(entry.icon)}</span>
      <span class="rp-place__body">
        <strong>${escapeHtml(entry.name)}</strong>
        <small>${escapeHtml(entry.point.label)}</small>
      </span>
      <span class="rp-place__chevron" aria-hidden="true">›</span>
    </button>
  `).join('');

  const recent = RECENT_PLACES.map((entry) => `
    <button class="rp-place" type="button" data-place="${escapeHtml(entry.id)}"
            aria-label="${escapeHtml(entry.point.label)}">
      <span class="rp-place__icon" aria-hidden="true">🕓</span>
      <span class="rp-place__body">
        <strong>${escapeHtml(entry.point.label)}</strong>
        <small>${escapeHtml(entry.point.hint ?? '')}</small>
      </span>
      <span class="rp-place__date" aria-hidden="true">${escapeHtml(entry.date)}</span>
    </button>
  `).join('');

  return `
    <section class="rp-places" aria-label="Сохранённые адреса">
      <h2 class="rp-places__title">Сохранённые</h2>
      ${saved}
      <button class="rp-place rp-place--add" type="button" data-action="manual-open"
              aria-label="Добавить адрес вручную">
        <span class="rp-place__icon rp-place__icon--add" aria-hidden="true">＋</span>
        <span class="rp-place__body"><strong>Добавить адрес</strong></span>
      </button>
    </section>
    <section class="rp-places" aria-label="Недавние адреса">
      <h2 class="rp-places__title">Недавние</h2>
      ${recent}
    </section>
    <button class="rp-manual-link" type="button" data-action="manual-open">
      <span aria-hidden="true">✎</span> Ввести адрес вручную
    </button>
  `;
}

// BD-MAP-03B — search-results sheet (render-gate state 4 · «Внуково»).
// Header «Найдено по «<query>»» + «Nмест» count, then the suggestion rows
// (data-suggestion contract preserved), then a manual-entry escape hatch.
function renderSearchResults() {
  const query = routeDraft.query.trim();
  if (routeDraft.results.length === 0) {
    return `
      <section class="rp-sheet rp-sheet--empty" aria-label="Результаты поиска">
        <div class="rp-sheet__head">
          <span class="rp-sheet__title">
            <span class="rp-sheet__spark" aria-hidden="true">✦</span>
            Ничего не найдено по «${escapeHtml(query)}»
          </span>
        </div>
        <button class="rp-sheet__manual" type="button" data-action="manual-open">
          <span aria-hidden="true">✎</span> Не вижу нужного — ввести вручную
        </button>
      </section>
    `;
  }

  const rows = routeDraft.results.map((item) => `
    <button class="rp-suggestion" type="button" data-suggestion="${escapeHtml(item.id)}"
            role="option" aria-label="${escapeHtml(item.label)}">
      <span class="rp-suggestion__icon" aria-hidden="true">⌕</span>
      <span class="rp-suggestion__body">
        <strong>${escapeHtml(item.label)}</strong>
        <small>${escapeHtml(item.hint ?? 'Адрес')}</small>
      </span>
      <span class="rp-suggestion__go" aria-hidden="true">↗</span>
    </button>
  `).join('');

  return `
    <section class="rp-sheet rp-sheet--results" role="listbox" aria-label="Результаты поиска">
      <div class="rp-sheet__head">
        <span class="rp-sheet__title">
          <span class="rp-sheet__spark" aria-hidden="true">✦</span>
          Найдено по «${escapeHtml(query)}»
        </span>
        <span class="rp-sheet__count">${routeDraft.results.length}мест</span>
      </div>
      ${rows}
      <button class="rp-sheet__manual" type="button" data-action="manual-open">
        <span aria-hidden="true">✎</span> Не вижу нужного — ввести вручную
      </button>
    </section>
  `;
}

// BD-MAP-03B — manual address fallback (render-gate state 5). Mock-only
// form: city / street+house / entrance comment. The inputs carry
// data-manual="…" (NOT data-input) so typing never triggers a re-render;
// «Сохранить адрес» reads the live DOM values and commits via setPoint().
// No geocoding, no backend.
function renderManualForm() {
  const prefill = routeDraft.query.trim();
  return `
    <section class="rp-manual" aria-label="Ввод адреса вручную">
      <div class="rp-manual__head">
        <span class="rp-manual__icon" aria-hidden="true">✎</span>
        <div class="rp-manual__heading">
          <p class="rp-manual__title">Ввод адреса вручную</p>
          <p class="rp-manual__hint">Когда автодополнения нет или нужно уточнить точку</p>
        </div>
      </div>
      <label class="rp-manual__label" for="rp-manual-city">Город</label>
      <input id="rp-manual-city" class="rp-manual__input" data-manual="city"
             value="Москва" autocomplete="off" aria-label="Город">
      <label class="rp-manual__label" for="rp-manual-street">Улица, дом</label>
      <input id="rp-manual-street" class="rp-manual__input" data-manual="street"
             value="${escapeHtml(prefill)}" placeholder="ул. Тверская, 12"
             autocomplete="off" aria-label="Улица и дом">
      <label class="rp-manual__label" for="rp-manual-extra">Подъезд / комментарий (необязательно)</label>
      <input id="rp-manual-extra" class="rp-manual__input" data-manual="extra"
             placeholder="Подъезд 3, домофон 28#" autocomplete="off"
             aria-label="Подъезд или комментарий">
      <button class="bd-btn primary rp-manual__save" type="button" data-action="manual-save">
        <span aria-hidden="true">✓</span> Сохранить адрес
      </button>
      <button class="rp-manual__cancel" type="button" data-action="manual-cancel">
        Отмена
      </button>
    </section>
  `;
}

function formatPrice(value) {
  // Thin-space thousands separator to mirror the render-gate «1 200 ₽».
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// BD-MAP-03B — estimate card for the route-draft-ready state (render-gate
// state 6). Order: ВРЕМЯ → РАССТОЯНИЕ → ОРИЕНТИР. ЦЕНА. Price is an «от …»
// orientation figure, not a final fare (the real fare lives in /route-preview).
function renderEstimate() {
  if (!routeDraft.route) return '';
  const { distanceKm, durationMin, estimatedPrice } = routeDraft.route;
  return `
    <dl class="rp-estimate" aria-label="Оценка маршрута">
      <div class="rp-estimate__metric">
        <dt>Время</dt>
        <dd>${escapeHtml(String(durationMin))} мин</dd>
      </div>
      <div class="rp-estimate__metric">
        <dt>Расстояние</dt>
        <dd>${escapeHtml(distanceKm.toFixed(1))} км</dd>
      </div>
      <div class="rp-estimate__metric">
        <dt>Ориентир. цена</dt>
        <dd>от ${escapeHtml(formatPrice(estimatedPrice))} ₽</dd>
      </div>
    </dl>
  `;
}

// BD-MAP-03B — route-draft-ready panel (render-gate state 6): estimate card,
// time chips, primary «Продолжить — выбрать водителя» CTA and the secondary
// «Изменить маршрут». The Continue CTA stays gated by the /active-ride guard
// exactly as in PR #323 — an active live trip disables it until dismissed.
//
// BD-MAP-03 TODO (time picker) — the «Сейчас / Запланировать / + Остановка»
// chips are visual-only here. A real schedule/stop picker (native
// <input type="datetime-local"> for PWA) is a separate under-issue; these
// chips surface an informational notice instead of shipping a stub picker.
function renderReadyPanel() {
  const guarded = Boolean(activeRideGuardTripId);
  const ctaEnabled = !guarded;
  const hasPrefill = Boolean(routeDraft.prefillSource);
  const editCaption = hasPrefill
    ? 'Изменение полей не затронет черновик публикации.'
    : '';

  return `
    <section class="rp-ready" aria-label="Готовый маршрут">
      ${renderEstimate()}
      <div class="rp-ready__chips" role="group" aria-label="Время поездки">
        <button class="rp-chip is-active" type="button" data-action="schedule-now"
                aria-pressed="true">
          <span aria-hidden="true">🕓</span> Сейчас
        </button>
        <button class="rp-chip" type="button" data-action="schedule-later">
          <span aria-hidden="true">🗓</span> Запланировать
        </button>
        <button class="rp-chip" type="button" data-action="add-stop">+ Остановка</button>
      </div>
      ${guarded
        ? `<p class="rp-ready__guard" role="status">Сначала завершите активную поездку или продолжите планировать новый маршрут.</p>`
        : ''}
      ${notice ? `<p class="rp-ready__notice" role="status">${escapeHtml(notice)}</p>` : ''}
      <button class="bd-btn primary rp-ready__cta" type="button" data-action="continue"
              ${ctaEnabled ? '' : 'disabled'} aria-disabled="${ctaEnabled ? 'false' : 'true'}">
        <span aria-hidden="true">→</span> Продолжить — выбрать водителя
      </button>
      <button class="bd-btn rp-ready__secondary" type="button" data-action="edit-route">
        Изменить маршрут
      </button>
      ${editCaption ? `<p class="rp-ready__caption">${escapeHtml(editCaption)}</p>` : ''}
    </section>
  `;
}

// BD-MAP-03 (/active-ride guard) — non-blocking banner shown above the
// route fields when the passenger already has a live handed-off trip.
// Offers an explicit choice: resume the active ride, or dismiss the guard
// to keep planning a new route. Rendered only while not dismissed.
function renderActiveRideGuard() {
  const tripId = activeRideGuardTripId;
  if (!tripId) return '';
  return `
    <div class="rp-active-guard" role="status" data-active-guard="${escapeHtml(tripId)}">
      <span class="rp-active-guard__icon" aria-hidden="true">!</span>
      <div class="rp-active-guard__body">
        <p class="rp-active-guard__title">У вас уже есть активная поездка</p>
        <p class="rp-active-guard__hint">
          Можно вернуться к ней или продолжить планировать новый маршрут —
          новый заказ не создастся, пока вы не выберете действие.
        </p>
        <div class="rp-active-guard__row">
          <button class="bd-btn primary rp-active-guard__resume" type="button"
                  data-action="open-active-ride"
                  aria-label="Открыть активную поездку">
            К активной поездке
          </button>
          <button class="bd-btn ghost rp-active-guard__dismiss" type="button"
                  data-action="dismiss-active-guard"
                  aria-label="Продолжить планировать новый маршрут">
            Новый маршрут
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderPrefillBanner() {
  const source = routeDraft.prefillSource;
  if (!source) return '';
  const headline = PREFILL_COPY[source] || PREFILL_COPY.repeat;
  const label = routeDraft.prefillLabel
    ? `«${escapeHtml(routeDraft.prefillLabel)}»`
    : '';
  return `
    <div class="rp-prefill-banner rp-prefill-banner--${escapeHtml(source)}"
         role="status" data-prefill-source="${escapeHtml(source)}">
      <span class="rp-prefill-banner__icon" aria-hidden="true">↺</span>
      <div class="rp-prefill-banner__body">
        <p class="rp-prefill-banner__title">${escapeHtml(headline)}${label ? ` ${label}` : ''}</p>
        <p class="rp-prefill-banner__hint">
          Проверьте точки подачи и назначения — поля можно отредактировать
          или очистить, не затрагивая черновик публикации.
        </p>
      </div>
      <button class="bd-btn ghost rp-prefill-banner__clear" type="button"
              data-action="clear-all"
              aria-label="Очистить маршрут. Только поля подачи и назначения.">
        Очистить
      </button>
    </div>
  `;
}

// BD-MAP-03B — topbar: «НОВАЯ ПОЕЗДКА» eyebrow over the «Маршрут» title,
// a back arrow on the left and a close × on the right (both → /map). The
// technical subtitle «Pickup → dropoff · mock routeDraft» is removed for
// render-gate parity. Back/close keep the existing router contract.
function renderTopbar() {
  const topbar = document.createElement('div');
  topbar.className = 'bd-topbar rp-topbar';
  topbar.innerHTML = `
    <button class="bd-iconbtn rp-topbar__back" type="button" data-action="back" aria-label="Назад к карте">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6"/>
      </svg>
    </button>
    <div class="bd-topbar__titles rp-topbar__titles">
      <p class="rp-topbar__eyebrow">Новая поездка</p>
      <h1 class="bd-topbar__title">Маршрут</h1>
    </div>
    <button class="bd-iconbtn rp-topbar__close" type="button" data-action="back" aria-label="Закрыть">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18"/>
      </svg>
    </button>
  `;
  return topbar;
}

// Non-ready body: search results (typing), the manual form, or the
// saved/recent list. Manual takes precedence so the fallback form is
// reachable from both the search sheet and the saved list.
function renderPickerBody() {
  if (routeDraft.manual) return renderManualForm();
  if (routeDraft.query.trim()) return renderSearchResults();
  return renderSavedRecent();
}

function buildBody() {
  syncDraft();
  // The /active-ride guard is resolved once per mount (see
  // routePickerScreen) and re-evaluated only on dismissal — never here, so
  // re-rendering on every keystroke does not re-parse localStorage. The
  // banner and the Continue-gating both read the cached activeRideGuardTripId.

  const fragment = document.createDocumentFragment();
  fragment.appendChild(renderTopbar());

  const scroll = document.createElement('div');
  scroll.className = 'bd-scroll rp-scroll';

  const ready = routeDraft.status === ROUTE_STATUS.ROUTE_DRAFT_READY
    && !routeDraft.manual;

  scroll.insertAdjacentHTML('beforeend', `
    ${renderActiveRideGuard()}
    ${renderPrefillBanner()}
    ${renderRouteCard()}
    ${ready ? renderReadyPanel() : renderSearchRow()}
  `);

  if (ready) {
    scroll.appendChild(renderMap(true));
  } else {
    scroll.appendChild(renderMap(false));
    scroll.insertAdjacentHTML('beforeend', renderPickerBody());
  }

  fragment.appendChild(scroll);
  return fragment;
}

function focusInput(root, kind) {
  const input = root.querySelector(`[data-input="${kind}"]`);
  if (!input) return;
  input.focus();
  const end = input.value.length;
  input.setSelectionRange(end, end);
}

function rerender(root, focusKind = null) {
  root.dataset.status = routeDraft.status;
  root.replaceChildren(buildBody());
  if (focusKind) focusInput(root, focusKind);
}

function findSuggestion(id) {
  return routeDraft.results.find((item) => item.id === id) ?? null;
}

function handleInput(root, target) {
  const kind = target.dataset.input;
  if (kind !== 'pickup' && kind !== 'dropoff') return;
  routeDraft.focus = kind;
  routeDraft.query = target.value;
  routeDraft.manual = false;
  notice = '';
  // BD-MAP-03 (hardening) — typing into a field is the start of a manual
  // edit, so drop the repeat/favorite provenance immediately rather than
  // waiting for the edit to be committed. Persist once on the transition so
  // a refresh cannot resurrect a stale banner over a route the user is
  // already reshaping. Subsequent keystrokes leave prefillSource null and
  // therefore keep the existing "no write per keystroke" behaviour.
  let prefillDropped = false;
  if (routeDraft.prefillSource) {
    routeDraft.prefillSource = null;
    routeDraft.prefillLabel = '';
    prefillDropped = true;
  }
  syncDraft();
  if (prefillDropped) persistDraft();
  rerender(root, kind);
}

function handleClick(root, target) {
  const clearKind = target.closest('[data-clear]')?.dataset.clear;
  if (clearKind === 'pickup' || clearKind === 'dropoff') {
    clearPoint(clearKind);
    rerender(root, clearKind);
    return;
  }

  const suggestionId = target.closest('[data-suggestion]')?.dataset.suggestion;
  if (suggestionId) {
    const point = findSuggestion(suggestionId);
    if (point) setPoint(routeDraft.focus, point);
    rerender(root);
    return;
  }

  // BD-MAP-03B — saved / recent rows (mock). Resolve through STATIC_PLACES
  // and drop a clone into the focused field via the shared setPoint() path,
  // so route_draft.v1 stays the single source of truth.
  const placeId = target.closest('[data-place]')?.dataset.place;
  if (placeId) {
    const point = STATIC_PLACES.get(placeId);
    if (point) setPoint(routeDraft.focus, point);
    rerender(root);
    return;
  }

  const action = target.closest('[data-action]')?.dataset.action;
  if (action === 'back') {
    go('/map');
    return;
  }
  if (action === 'open-active-ride') {
    // Resume the passenger's live handed-off trip. Read-only handoff —
    // active_ride.js resolves the status from the shared record.
    const tripId = activeRideGuardTripId;
    if (tripId) go(`/active-ride?role=passenger&tripId=${encodeURIComponent(tripId)}`);
    return;
  }
  if (action === 'dismiss-active-guard') {
    // Explicit action: the passenger chose to plan a new route anyway.
    // Scope the dismissal to this specific trip and hide the guard without
    // re-reading localStorage — a later/different live trip re-shows it.
    activeRideGuardDismissedTripId = activeRideGuardTripId;
    activeRideGuardTripId = null;
    rerender(root);
    return;
  }
  if (action === 'current-location') {
    setPoint('pickup', MOCK_CURRENT_LOCATION);
    rerender(root, 'dropoff');
    return;
  }
  if (action === 'manual-address') {
    if (routeDraft.query.trim()) setPoint(routeDraft.focus, makeManualPoint());
    rerender(root);
    return;
  }
  if (action === 'done') {
    // «Готово» collapses the search query back to the saved/recent list
    // without committing anything — the field value stays as-is.
    if (routeDraft.query) {
      clearQuery();
      notice = '';
      syncDraft();
    }
    rerender(root);
    return;
  }
  if (action === 'manual-open') {
    routeDraft.manual = true;
    rerender(root);
    return;
  }
  if (action === 'manual-cancel') {
    routeDraft.manual = false;
    rerender(root);
    return;
  }
  if (action === 'manual-save') {
    // Read the live DOM values (the manual inputs carry data-manual, not
    // data-input, so they never trigger a re-render while typing). Commit
    // through setPoint() which also drops the manual flag. Mock-only: no
    // geocoding, label is the entered street (or city) verbatim.
    const cityEl = root.querySelector('[data-manual="city"]');
    const streetEl = root.querySelector('[data-manual="street"]');
    const extraEl = root.querySelector('[data-manual="extra"]');
    const city = (cityEl?.value ?? '').trim();
    const street = (streetEl?.value ?? '').trim();
    const extra = (extraEl?.value ?? '').trim();
    if (street || city) {
      const hintParts = [];
      if (street && city) hintParts.push(city);
      if (extra) hintParts.push(extra);
      const point = makePoint(
        `manual-${Date.now()}`,
        street || city,
        hintParts.join(' · ') || 'Введено вручную',
        'manual',
      );
      setPoint(routeDraft.focus, point);
    } else {
      routeDraft.manual = false;
    }
    rerender(root);
    return;
  }
  if (action === 'edit-route') {
    // Secondary CTA in the ready state — reveal the route fields for editing
    // by focusing pickup. Points stay set, so route_draft.v1 is untouched.
    routeDraft.manual = false;
    routeDraft.focus = 'pickup';
    notice = '';
    syncDraft();
    rerender(root, 'pickup');
    return;
  }
  if (action === 'schedule-later' || action === 'add-stop') {
    // BD-MAP-03 TODO (time picker) — visual-only chips. Surface an
    // informational notice instead of shipping a stub scheduler/stop picker.
    notice = 'Планировщик времени и остановки появятся отдельным шагом.';
    rerender(root);
    return;
  }
  if (action === 'schedule-now') {
    if (notice) {
      notice = '';
      rerender(root);
    }
    return;
  }
  if (action === 'clear-all') {
    clearAll();
    rerender(root, 'pickup');
    return;
  }
  if (action === 'continue') {
    if (routeDraft.status !== ROUTE_STATUS.ROUTE_DRAFT_READY) return;
    // /active-ride guard: never start a new route over a live trip until
    // the passenger has explicitly dismissed the guard banner.
    if (activeRideGuardTripId) return;
    persistDraft();
    go('/route-preview');
    return;
  }

  const focusKind = target.closest('[data-focus]')?.dataset.focus;
  if (focusKind === 'pickup' || focusKind === 'dropoff') {
    routeDraft.focus = focusKind;
    routeDraft.query = '';
    routeDraft.manual = false;
    notice = '';
    syncDraft();
    rerender(root, focusKind);
  }
}

// BD-MAP-03B — deep-link helpers for the render-gate smoke states:
//   #/route-picker?q=Внуково → seed the search query (search-results state)
//   #/route-picker?manual=1  → open the manual-address fallback form
// Purely additive: the router still calls the loader with no arguments, so
// the screen reads its own hash. Unknown / absent params leave state as-is.
function applyHashParams() {
  let params;
  try {
    const hash = typeof location !== 'undefined' ? (location.hash || '') : '';
    const qi = hash.indexOf('?');
    params = new URLSearchParams(qi === -1 ? '' : hash.slice(qi + 1));
  } catch {
    return;
  }
  const q = params.get('q');
  if (typeof q === 'string' && q.trim()) {
    routeDraft.query = q.trim();
    routeDraft.manual = false;
  }
  if (params.get('manual') === '1') {
    routeDraft.manual = true;
  }
}

export default function routePickerScreen() {
  hydrateFromStorage();
  applyHashParams();
  syncDraft();
  // Resolve the /active-ride guard once for this mount. A fresh navigation
  // to #/route-picker clears any prior trip-scoped dismissal so the guard
  // is re-shown for whatever live trip exists now.
  activeRideGuardDismissedTripId = null;
  resolveActiveRideGuardTripId();
  const root = document.createElement('section');
  root.className = 'screen screen--route-picker';
  root.dataset.status = routeDraft.status;
  root.replaceChildren(buildBody());

  root.addEventListener('input', (event) => {
    handleInput(root, event.target);
  });

  root.addEventListener('click', (event) => {
    handleClick(root, event.target);
  });

  return root;
}
