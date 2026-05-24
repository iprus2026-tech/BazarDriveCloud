// BD-MAP-03 — RoutePicker implementation (mock-only, no real Mapbox SDK).
// Keeps routeDraft in module memory for the passenger session. No
// localStorage writes, no network calls, no native geolocation prompt.

import { escapeHtml } from '../util.js';
import { go } from '../router.js';
import { createMapShell } from '../mapbox/map_shell.js';

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
};

let notice = '';

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

export function getRouteDraft() {
  syncDraft();
  return {
    ...routeDraft,
    pickup: clonePoint(routeDraft.pickup),
    dropoff: clonePoint(routeDraft.dropoff),
    results: routeDraft.results.map(clonePoint),
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
  clearQuery();
  notice = '';
  syncDraft();
}

function clearPoint(kind) {
  routeDraft[kind] = null;
  routeDraft.focus = kind;
  routeDraft.source = null;
  clearQuery();
  notice = '';
  syncDraft();
}

function clearAll() {
  routeDraft.pickup = null;
  routeDraft.dropoff = null;
  routeDraft.focus = 'pickup';
  routeDraft.source = null;
  clearQuery();
  notice = '';
  syncDraft();
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
    ? 'Адрес подачи или район'
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

function renderStatusCard() {
  const ready = routeDraft.status === ROUTE_STATUS.ROUTE_DRAFT_READY;
  const statusCopy = ready
    ? 'Маршрут готов. Предпросмотр подключит BD-MAP-04.'
    : 'Заполните точку подачи и назначения, чтобы продолжить.';

  return `
    <div class="rp-bottom-card">
      <div class="rp-bottom-card__grip" aria-hidden="true"></div>
      <div class="rp-bottom-card__head">
        <span class="rp-bottom-card__status rp-bottom-card__status--${ready ? 'ready' : 'draft'}">
          ${ready ? 'Готово' : 'Черновик'}
        </span>
        <span class="rp-bottom-card__code">${escapeHtml(routeDraft.status)}</span>
      </div>
      <p class="rp-bottom-card__hint">${escapeHtml(statusCopy)}</p>
      ${notice ? `<p class="rp-bottom-card__notice" role="status">${escapeHtml(notice)}</p>` : ''}
      <button class="bd-btn primary rp-bottom-card__cta" type="button" data-action="continue"
              ${ready ? '' : 'disabled'} aria-disabled="${ready ? 'false' : 'true'}">
        Продолжить
      </button>
      <div class="rp-bottom-card__row">
        <button class="bd-btn rp-bottom-card__secondary" type="button" data-action="clear-all">
          Очистить
        </button>
        <button class="bd-btn rp-bottom-card__secondary" type="button" data-action="back">
          Назад к карте
        </button>
      </div>
    </div>
  `;
}

function buildBody() {
  syncDraft();

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
    <div class="rp-card">
      ${renderPointField('pickup')}
      <div class="rp-card__divider" aria-hidden="true"></div>
      ${renderPointField('dropoff')}
    </div>
    ${renderSuggestions()}
    <div class="rp-debug" aria-live="polite">
      <span>focus: ${escapeHtml(routeDraft.focus)}</span>
      <span>source: ${escapeHtml(routeDraft.source ?? 'none')}</span>
    </div>
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
  syncDraft();
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
    notice = 'routeDraft готов. Следующий экран: BD-MAP-04 RoutePreview.';
    rerender(root);
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
