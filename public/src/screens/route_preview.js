// BD-MAP-04 — RoutePreview Render Gate.
// Reads routeDraft persisted by /route-picker, validates the shape, and
// renders one of three states: valid · missing · malformed. No backend,
// no Mapbox SDK, no network — the map area uses the shared MapShell
// placeholder with the orange route line.

import { escapeHtml } from '../util.js';
import { go } from '../router.js';
import { createMapShell } from '../mapbox/map_shell.js';

const ROUTE_DRAFT_KEY = 'bazardrive.route_draft.v1';
const STORAGE_LABEL = 'localStorage';

const STATE = {
  VALID: 'valid',
  MISSING: 'missing',
  MALFORMED: 'malformed',
};

const FIELD_LABELS = {
  pickup: { copy: 'Не указано место подачи', path: 'routeDraft.pickup' },
  dropoff: { copy: 'Не указано место назначения', path: 'routeDraft.dropoff' },
  distanceKm: { copy: 'Расстояние не рассчитано', path: 'routeDraft.distanceKm' },
  durationMin: { copy: 'Время поездки не рассчитано', path: 'routeDraft.durationMin' },
  estimatePriceFrom: { copy: 'Стоимость не оценена', path: 'routeDraft.estimatePriceFrom' },
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidPoint(point) {
  return isPlainObject(point)
    && typeof point.label === 'string'
    && point.label.trim().length > 0;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function readRawDraft() {
  try {
    if (typeof localStorage === 'undefined') return { kind: 'absent' };
    const raw = localStorage.getItem(ROUTE_DRAFT_KEY);
    if (raw == null || raw === '') return { kind: 'absent' };
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { kind: 'invalid-json' };
    }
    if (!isPlainObject(parsed)) return { kind: 'invalid-shape' };
    return { kind: 'present', parsed };
  } catch {
    return { kind: 'absent' };
  }
}

function flattenDraft(parsed) {
  const route = isPlainObject(parsed.route) ? parsed.route : {};
  return {
    pickup: isValidPoint(parsed.pickup) ? parsed.pickup : null,
    dropoff: isValidPoint(parsed.dropoff) ? parsed.dropoff : null,
    distanceKm: isFiniteNumber(route.distanceKm) ? route.distanceKm : null,
    durationMin: isFiniteNumber(route.durationMin) ? route.durationMin : null,
    estimatePriceFrom: isFiniteNumber(route.estimatedPrice) ? route.estimatedPrice : null,
  };
}

function collectMissingFields(draft) {
  const missing = [];
  for (const key of Object.keys(FIELD_LABELS)) {
    if (draft[key] == null) missing.push({ key, ...FIELD_LABELS[key] });
  }
  return missing;
}

function readDraft() {
  const raw = readRawDraft();
  if (raw.kind === 'absent') {
    return { state: STATE.MISSING, draft: null, missing: [] };
  }
  if (raw.kind === 'invalid-json' || raw.kind === 'invalid-shape') {
    return {
      state: STATE.MALFORMED,
      draft: null,
      missing: Object.keys(FIELD_LABELS).map((key) => ({ key, ...FIELD_LABELS[key] })),
    };
  }
  const draft = flattenDraft(raw.parsed);
  const missing = collectMissingFields(draft);
  if (missing.length > 0) return { state: STATE.MALFORMED, draft, missing };
  return { state: STATE.VALID, draft, missing: [] };
}

function formatDistance(km) {
  if (!isFiniteNumber(km)) return '';
  return km >= 10 ? String(Math.round(km)) : km.toFixed(1).replace(/\.0$/, '');
}

function renderTopbar() {
  const topbar = document.createElement('div');
  topbar.className = 'bd-topbar rpv-topbar';
  topbar.innerHTML = `
    <button class="bd-iconbtn rpv-topbar__back" type="button" data-action="back-picker"
            aria-label="Назад к выбору маршрута">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6"/>
      </svg>
    </button>
    <div class="bd-topbar__titles">
      <h1 class="bd-topbar__title">Предпросмотр маршрута</h1>
    </div>
  `;
  return topbar;
}

function renderMap(state, draft) {
  const wrap = document.createElement('div');
  wrap.className = `rpv-map rpv-map--${state}`;
  wrap.setAttribute('aria-label', 'Карта маршрута');

  const hasRoute = state === STATE.VALID
    || (state === STATE.MALFORMED && draft?.pickup && draft?.dropoff);

  const shell = createMapShell({
    variant: 'passenger',
    showRoute: hasRoute,
    showCar: false,
    showPickup: Boolean(draft?.pickup),
    showDropoff: Boolean(draft?.dropoff),
    showLabels: false,
    route: {
      pickupLabel: draft?.pickup?.label ?? 'Точка подачи',
      dropoffLabel: draft?.dropoff?.label ?? 'Точка назначения',
    },
  });
  shell.setAttribute('aria-hidden', 'true');
  wrap.appendChild(shell);
  return wrap;
}

function renderValidCard(draft) {
  const card = document.createElement('div');
  card.className = 'rpv-card rpv-card--valid';
  const distance = formatDistance(draft.distanceKm);
  card.innerHTML = `
    <div class="rpv-route">
      <div class="rpv-route__pins" aria-hidden="true">
        <span class="rpv-route__pin rpv-route__pin--pickup"></span>
        <span class="rpv-route__pin-line"></span>
        <span class="rpv-route__pin rpv-route__pin--dropoff"></span>
      </div>
      <div class="rpv-route__points">
        <div class="rpv-route__point">
          <div class="rpv-route__label">ОТКУДА</div>
          <div class="rpv-route__value">${escapeHtml(draft.pickup.label)}</div>
        </div>
        <div class="rpv-route__point">
          <div class="rpv-route__label">КУДА</div>
          <div class="rpv-route__value">${escapeHtml(draft.dropoff.label)}</div>
        </div>
      </div>
      <button class="bd-iconbtn rpv-route__edit" type="button" data-action="edit-route"
              aria-label="Изменить маршрут">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 20h9"/>
          <path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/>
        </svg>
      </button>
    </div>

    <dl class="rpv-metrics" aria-label="Параметры маршрута">
      <div class="rpv-metric">
        <dt class="rpv-metric__value">${escapeHtml(String(Math.round(draft.durationMin)))}<span class="rpv-metric__unit"> мин</span></dt>
        <dd class="rpv-metric__label">В ПУТИ</dd>
      </div>
      <div class="rpv-metric">
        <dt class="rpv-metric__value">${escapeHtml(distance)}<span class="rpv-metric__unit"> км</span></dt>
        <dd class="rpv-metric__label">РАССТОЯНИЕ</dd>
      </div>
      <div class="rpv-metric">
        <dt class="rpv-metric__value"><span class="rpv-metric__prefix">от </span>${escapeHtml(String(Math.round(draft.estimatePriceFrom)))}<span class="rpv-metric__unit"> ₽</span></dt>
        <dd class="rpv-metric__label">ОЦЕНКА</dd>
      </div>
    </dl>

    <button class="bd-btn primary rpv-cta" type="button" data-action="create-order">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      <span>Создать заказ</span>
    </button>
    <button class="bd-btn rpv-secondary" type="button" data-action="edit-route">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/>
      </svg>
      <span>Изменить маршрут</span>
    </button>

    <div class="rpv-status rpv-status--ready" role="status">
      <span class="rpv-status__check" aria-hidden="true">✓</span>
      <span>Готово · перенаправление в композер</span>
    </div>
  `;
  return card;
}

function renderMissingCard() {
  const card = document.createElement('div');
  card.className = 'rpv-card rpv-card--missing';
  card.innerHTML = `
    <div class="rpv-empty">
      <div class="rpv-empty__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 21s-7-7.5-7-12a7 7 0 1114 0c0 4.5-7 12-7 12z"/>
          <circle cx="12" cy="9" r="2.5"/>
        </svg>
      </div>
      <h2 class="rpv-empty__title">Нет данных о маршруте</h2>
      <p class="rpv-empty__hint">
        Похоже, вы открыли предпросмотр напрямую. Выберите точку подачи и
        назначения, чтобы продолжить.
      </p>
    </div>

    <dl class="rpv-diag" aria-label="Диагностика">
      <div class="rpv-diag__row">
        <dt>Источник</dt>
        <dd>${escapeHtml(STORAGE_LABEL)} · пусто</dd>
      </div>
      <div class="rpv-diag__row">
        <dt>Ключ</dt>
        <dd><code>bd:routeDraft</code></dd>
      </div>
      <div class="rpv-diag__row">
        <dt>Шаг назад</dt>
        <dd><code>/route-picker</code></dd>
      </div>
    </dl>

    <button class="bd-btn primary rpv-cta" type="button" data-action="pick-route">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 21s-7-7.5-7-12a7 7 0 1114 0c0 4.5-7 12-7 12z"/>
        <circle cx="12" cy="9" r="2.5"/>
      </svg>
      <span>Выбрать маршрут</span>
    </button>
    <button class="bd-btn rpv-secondary" type="button" data-action="back-map">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6"/>
      </svg>
      <span>Вернуться на карту</span>
    </button>
  `;
  return card;
}

function renderMalformedCard(missing) {
  const card = document.createElement('div');
  card.className = 'rpv-card rpv-card--malformed';

  const issues = missing.map((field) => `
    <li class="rpv-issue">
      <span class="rpv-issue__dot" aria-hidden="true"></span>
      <div class="rpv-issue__body">
        <div class="rpv-issue__copy">${escapeHtml(field.copy)}</div>
        <code class="rpv-issue__path">${escapeHtml(field.path)}</code>
      </div>
    </li>
  `).join('');

  card.innerHTML = `
    <div class="rpv-empty rpv-empty--warn">
      <div class="rpv-empty__icon rpv-empty__icon--warn" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </div>
      <h2 class="rpv-empty__title">Черновик повреждён</h2>
      <p class="rpv-empty__hint">
        Не удалось прочитать routeDraft. Пересоберите маршрут заново —
        это займёт меньше минуты.
      </p>
    </div>

    <ul class="rpv-issues" aria-label="Проблемы с черновиком">
      ${issues}
    </ul>

    <button class="bd-btn primary rpv-cta" type="button" data-action="pick-route">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 21s-7-7.5-7-12a7 7 0 1114 0c0 4.5-7 12-7 12z"/>
        <circle cx="12" cy="9" r="2.5"/>
      </svg>
      <span>Выбрать маршрут</span>
    </button>
    <button class="bd-btn rpv-secondary" type="button" data-action="details">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span>Подробнее</span>
    </button>
  `;
  return card;
}

function renderCard({ state, draft, missing }) {
  if (state === STATE.VALID) return renderValidCard(draft);
  if (state === STATE.MISSING) return renderMissingCard();
  return renderMalformedCard(missing);
}

function buildBody() {
  const result = readDraft();

  const fragment = document.createDocumentFragment();
  fragment.appendChild(renderTopbar());

  const scroll = document.createElement('div');
  scroll.className = 'bd-scroll rpv-scroll';
  scroll.appendChild(renderMap(result.state, result.draft));
  scroll.appendChild(renderCard(result));
  fragment.appendChild(scroll);

  return { fragment, state: result.state };
}

function toggleDetails(root) {
  const issues = root.querySelector('.rpv-issues');
  if (!issues) return;
  issues.classList.toggle('rpv-issues--expanded');
}

function handleAction(root, action) {
  if (action === 'create-order') {
    go('/order-map-draft');
    return;
  }
  if (action === 'edit-route' || action === 'pick-route') {
    go('/route-picker');
    return;
  }
  if (action === 'back-picker') {
    go('/route-picker');
    return;
  }
  if (action === 'back-map') {
    go('/map');
    return;
  }
  if (action === 'details') {
    toggleDetails(root);
    return;
  }
}

export default function routePreviewScreen() {
  const root = document.createElement('section');
  root.className = 'screen screen--route-preview';
  const { fragment, state } = buildBody();
  root.dataset.state = state;
  root.replaceChildren(fragment);

  root.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    handleAction(root, target.dataset.action);
  });

  return root;
}
