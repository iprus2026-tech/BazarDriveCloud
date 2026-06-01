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

const MOCK_SUGGESTIONS = [
  makePoint('place-home', 'Дом · ул. Мира, 18', 'Сохранённый адрес', 'search'),
  makePoint('place-work', 'Работа · Бизнес-центр Север', 'Сохранённый адрес', 'search'),
  makePoint('place-airport', 'Аэропорт Внуково', 'Терминал А', 'search'),
  makePoint('place-station', 'Ж/д вокзал Центральный', 'Площадь вокзала', 'search'),
  makePoint('place-market', 'ТЦ Галерея', 'Вход со стороны парковки', 'search'),
  makePoint('place-clinic', 'Городская клиника №4', 'ул. Садовая, 9', 'search'),
  makePoint('place-school', 'Школа №12', 'Северный район', 'search'),
  makePoint('place-park', 'Парк Победы', 'Главный вход', 'search'),
];

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
// machine (active_ride.js / ride_state.js stay untouched). `dismissed` is
// the explicit-action latch and lives in module scope for the session.
let activeRideGuardDismissed = false;
let activeRideGuardTripId = null;

function resolveActiveRideGuardTripId() {
  if (activeRideGuardDismissed) {
    activeRideGuardTripId = null;
    return null;
  }
  let tripId = null;
  try {
    tripId = findLatestHandedOffOrderTripId();
  } catch {
    tripId = null;
  }
  activeRideGuardTripId = typeof tripId === 'string' && tripId ? tripId : null;
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
  routeDraft.prefillSource = null;
  routeDraft.prefillLabel = '';
  notice = '';
  activeRideGuardDismissed = false;
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

function pointHint(kind) {
  const point = routeDraft[kind];
  if (!point?.hint) return '';
  return `<p class="rp-field__hint">${escapeHtml(point.hint)}</p>`;
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

function renderPointField(kind) {
  const isActive = routeDraft.focus === kind;
  const point = routeDraft[kind];
  const placeholder = kind === 'pickup'
    ? 'Где вас забрать?'
    : 'Куда едем?';
  const sourceLabel = point?.source === 'current'
    ? 'Моё место'
    : point?.source === 'manual'
      ? 'Вручную'
      : 'Адрес';

  return `
    <div class="rp-field ${isActive ? 'is-active' : ''} ${point ? 'is-filled' : ''}"
         data-focus="${kind}">
      <span class="rp-field__pin rp-field__pin--${kind}" aria-hidden="true"></span>
      <div class="rp-field__body">
        <div class="rp-field__head">
          <label class="rp-field__label" for="rp-${kind}">${FOCUS_LABELS[kind]}</label>
          ${point ? `<span class="rp-field__source">${escapeHtml(sourceLabel)}</span>` : ''}
        </div>
        <div class="rp-field__input-row">
          <input id="rp-${kind}" class="rp-field__input" data-input="${kind}"
                 value="${escapeHtml(activeInputValue(kind))}"
                 placeholder="${escapeHtml(placeholder)}"
                 aria-label="${escapeHtml(FOCUS_LABELS[kind])}"
                 autocomplete="off" inputmode="search">
          ${renderClearButton(kind)}
        </div>
        ${pointHint(kind)}
        ${kind === 'pickup' ? `
          <button class="rp-field__current" type="button" data-action="current-location"
                  aria-label="Использовать моё место">
            Моё место
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

function renderMapSnippet() {
  const wrap = document.createElement('div');
  wrap.className = `rp-map rp-map--${routeDraft.status}`;
  wrap.setAttribute('aria-label', 'Маршрут-заглушка');

  const shell = createMapShell({
    variant: 'passenger',
    showRoute: routeDraft.status === ROUTE_STATUS.ROUTE_DRAFT_READY,
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

  const card = document.createElement('div');
  card.className = 'rp-map__snippet';
  card.setAttribute('aria-hidden', 'true');
  card.innerHTML = `
    <span>${escapeHtml(routeDraft.pickup?.label ?? 'Выберите подачу')}</span>
    <strong>→</strong>
    <span>${escapeHtml(routeDraft.dropoff?.label ?? 'Выберите назначение')}</span>
  `;
  wrap.appendChild(card);

  const watermark = document.createElement('div');
  watermark.className = 'rp-map__watermark';
  watermark.textContent = 'Mapbox SDK пока не подключён';
  wrap.appendChild(watermark);

  return wrap;
}

function renderSuggestions() {
  if (!routeDraft.query) {
    return `
      <div class="rp-results rp-results--empty" aria-live="polite">
        <div class="rp-results__title">Начните вводить адрес</div>
        <p class="rp-results__hint">Подсказки появятся здесь. Пока это mock-список без Geocoding API.</p>
      </div>
    `;
  }

  if (routeDraft.results.length > 0) {
    const rows = routeDraft.results.map((item) => `
      <button class="rp-suggestion" type="button" data-suggestion="${escapeHtml(item.id)}"
              role="option" aria-label="${escapeHtml(item.label)}">
        <span class="rp-suggestion__icon" aria-hidden="true">⌕</span>
        <span class="rp-suggestion__body">
          <strong>${escapeHtml(item.label)}</strong>
          <small>${escapeHtml(item.hint ?? 'Адрес')}</small>
        </span>
      </button>
    `).join('');
    return `
      <div class="rp-results" role="listbox" aria-label="Подсказки адресов">
        <div class="rp-results__title">Найдено для поля «${escapeHtml(FOCUS_LABELS[routeDraft.focus])}»</div>
        ${rows}
      </div>
    `;
  }

  return `
    <div class="rp-results" role="listbox" aria-label="Ручной ввод адреса">
      <div class="rp-results__title">Адрес не найден</div>
      <button class="rp-suggestion rp-suggestion--manual" type="button" data-action="manual-address"
              role="option" aria-label="Использовать как адрес">
        <span class="rp-suggestion__icon" aria-hidden="true">＋</span>
        <span class="rp-suggestion__body">
          <strong>${escapeHtml(routeDraft.query.trim())}</strong>
          <small>Использовать как адрес</small>
        </span>
      </button>
    </div>
  `;
}

function renderEstimate() {
  if (!routeDraft.route) return '';
  // Order mirrors the Cloud Design render gate (state 6 · Route draft
  // ready): Время → Расстояние → Ориентир. цена. Price is shown as an
  // "от …" estimate to read as an orientation figure, not a final fare.
  const { distanceKm, durationMin, estimatedPrice } = routeDraft.route;
  return `
    <dl class="rp-bottom-card__estimate" aria-label="Оценка маршрута">
      <div class="rp-bottom-card__metric">
        <dt>Время</dt>
        <dd>${escapeHtml(String(durationMin))} мин</dd>
      </div>
      <div class="rp-bottom-card__metric">
        <dt>Расстояние</dt>
        <dd>${escapeHtml(distanceKm.toFixed(1))} км</dd>
      </div>
      <div class="rp-bottom-card__metric">
        <dt>Ориентир. цена</dt>
        <dd>от ${escapeHtml(String(estimatedPrice))} ₽</dd>
      </div>
    </dl>
  `;
}

function renderStatusCard() {
  const ready = routeDraft.status === ROUTE_STATUS.ROUTE_DRAFT_READY;
  // The /active-ride guard is resolved once per render in buildBody and
  // cached in activeRideGuardTripId; an active trip gates Continue so the
  // passenger cannot start a second route without an explicit dismissal.
  const guarded = Boolean(activeRideGuardTripId);
  const ctaEnabled = ready && !guarded;
  const statusCopy = guarded
    ? 'Сначала завершите активную поездку или продолжите планировать новый маршрут.'
    : ready
      ? 'Маршрут готов. Продолжите, чтобы выбрать водителя.'
      : 'Заполните точку подачи и назначения, чтобы продолжить.';
  const hasPrefill = Boolean(routeDraft.prefillSource);
  const clearCaption = hasPrefill
    ? 'Очистит только поля маршрута. Черновик публикации сохранится.'
    : 'Очистит только поля маршрута.';

  // BD-MAP-03 TODO (time picker) — Cloud Design render gate (state 6)
  // shows «Сейчас / Запланировать / + Остановка» above the CTA. A real
  // schedule/stop picker is a separate under-issue (native
  // <input type="datetime-local"> for PWA); intentionally not built here
  // so this audit stays a targeted polish and does not ship a stub picker.

  return `
    <div class="rp-bottom-card">
      <div class="rp-bottom-card__grip" aria-hidden="true"></div>
      <div class="rp-bottom-card__head">
        <span class="rp-bottom-card__status rp-bottom-card__status--${ready ? 'ready' : 'draft'}">
          ${ready ? 'Готово' : 'Черновик'}
        </span>
        <span class="rp-bottom-card__code">${escapeHtml(routeDraft.stage)}</span>
      </div>
      <p class="rp-bottom-card__hint">${escapeHtml(statusCopy)}</p>
      ${ready ? renderEstimate() : ''}
      ${notice ? `<p class="rp-bottom-card__notice" role="status">${escapeHtml(notice)}</p>` : ''}
      <button class="bd-btn primary rp-bottom-card__cta" type="button" data-action="continue"
              ${ctaEnabled ? '' : 'disabled'} aria-disabled="${ctaEnabled ? 'false' : 'true'}">
        Продолжить — выбрать водителя
      </button>
      <div class="rp-bottom-card__row">
        <button class="bd-btn rp-bottom-card__secondary" type="button" data-action="clear-all"
                aria-label="Очистить маршрут. Только поля подачи и назначения.">
          Очистить маршрут
        </button>
        <button class="bd-btn rp-bottom-card__secondary" type="button" data-action="back">
          Назад к карте
        </button>
      </div>
      <p class="rp-bottom-card__caption">${escapeHtml(clearCaption)}</p>
    </div>
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

function buildBody() {
  syncDraft();
  // Resolve the /active-ride guard once per render so the banner and the
  // Continue-gating in renderStatusCard agree on the same trip.
  resolveActiveRideGuardTripId();

  const fragment = document.createDocumentFragment();

  const topbar = document.createElement('div');
  topbar.className = 'bd-topbar rp-topbar';
  topbar.innerHTML = `
    <button class="bd-iconbtn rp-topbar__back" type="button" data-action="back" aria-label="Назад к карте">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6"/>
      </svg>
    </button>
    <div class="bd-topbar__titles">
      <h1 class="bd-topbar__title">Выбор маршрута</h1>
      <p class="bd-topbar__sub">Pickup → dropoff · mock routeDraft</p>
    </div>
  `;
  fragment.appendChild(topbar);

  const scroll = document.createElement('div');
  scroll.className = 'bd-scroll rp-scroll';
  scroll.appendChild(renderMapSnippet());
  scroll.insertAdjacentHTML('beforeend', `
    ${renderActiveRideGuard()}
    ${renderPrefillBanner()}
    <div class="rp-card">
      ${renderPointField('pickup')}
      <div class="rp-card__divider" aria-hidden="true"></div>
      ${renderPointField('dropoff')}
    </div>
    ${renderSuggestions()}
  `);
  fragment.appendChild(scroll);

  const bottom = document.createElement('div');
  bottom.innerHTML = renderStatusCard();
  fragment.append(...bottom.childNodes);

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
    activeRideGuardDismissed = true;
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
    notice = '';
    syncDraft();
    rerender(root, focusKind);
  }
}

export default function routePickerScreen() {
  hydrateFromStorage();
  syncDraft();
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
