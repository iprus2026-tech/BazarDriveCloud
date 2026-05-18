// BD-CONFIRM-01 — TripConfirmationHandoff render gate.
// Temporary bridge screen between the chat/respond flow and the active
// ride. Render-only: no Mapbox, no backend, no real timers driving state,
// no payments, no push, no calls. The screen consumes URL query parameters
// (?state=... &tripId=... &role=...) and maps them to one of five UI
// variants. Driver/passenger "confirmed" CTAs hand off to /active-ride
// with status=DRIVER_EN_ROUTE.

import { escapeHtml } from '../util.js';
import { go } from '../router.js';

// ── State enum ────────────────────────────────────────────────
export const CF_STATE = {
  PASSENGER_PENDING:   'PASSENGER_PENDING',
  DRIVER_WAITING:      'DRIVER_WAITING',
  PASSENGER_CONFIRMED: 'PASSENGER_CONFIRMED',
  DRIVER_CONFIRMED:    'DRIVER_CONFIRMED',
  EXPIRED:             'EXPIRED',
};

const VALID_STATES = new Set(Object.values(CF_STATE));
const DEMO_TRIP_ID = '48-321';

// ── Mock data (matches Cloud Design render) ───────────────────
const MOCK_PASSENGER = {
  name: 'Анна М.',
  handle: '@anna_m',
  initials: 'АМ',
  rating: '4,86',
  meta: '87 поездок · оплата картой · 4417',
  comment: 'Маленький чемодан',
};

const MOCK_DRIVER = {
  name: 'Рустам К.',
  initials: 'РК',
  rating: '4,92',
  car: 'Toyota Camry · серый · A 124 ВВ',
  meta: '1 248 поездок · 4 года на платформе',
};

const MOCK_ROUTE = {
  from: 'ул. Малая Бронная, 28',
  to:   'Аэропорт Шереметьево, терминал B',
  etaMin: 42,
  pickupMin: 4,
  distanceKm: 38,
  priceRub: '1 540 ₽',
  sentAt: '14:04',
  expiredAt: '14:21',
  expiredAgo: '7 мин назад',
};

// ── SVGs ──────────────────────────────────────────────────────
const BACK_SVG = `<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="14" height="14">
  <polyline points="11 4 6 9 11 14"/>
</svg>`;

const SHIELD_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
</svg>`;

const CHECK_SVG = `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="28" height="28">
  <polyline points="6 16 13 23 26 9"/>
</svg>`;

const PENDING_SVG = `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="28" height="28">
  <circle cx="16" cy="16" r="11"/>
  <polyline points="16 9 16 16 21 19"/>
</svg>`;

const WAITING_SVG = `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="26" height="26">
  <line x1="6" y1="16" x2="26" y2="6"/>
  <polygon points="26 6 20 26 16 18 6 14 26 6"/>
</svg>`;

const ALERT_SVG = `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="28" height="28">
  <path d="M16 4 L29 27 L3 27 Z"/>
  <line x1="16" y1="13" x2="16" y2="19"/>
  <line x1="16" y1="23" x2="16.01" y2="23"/>
</svg>`;

const CHAT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>
</svg>`;

// ── Query helpers ─────────────────────────────────────────────
function getHashQuery() {
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  if (qi === -1) return new URLSearchParams();
  return new URLSearchParams(hash.slice(qi + 1));
}

function resolveState(raw, role) {
  if (raw && VALID_STATES.has(raw)) return raw;
  return role === 'driver' ? CF_STATE.DRIVER_WAITING : CF_STATE.PASSENGER_PENDING;
}

// ── Card fragments ────────────────────────────────────────────
function passengerCard() {
  return `
    <div class="bd-card cf-party-card">
      <div class="feed-avatar cf-avatar cf-avatar--passenger" aria-hidden="true">
        ${escapeHtml(MOCK_PASSENGER.initials)}
      </div>
      <div class="cf-party-info">
        <div class="cf-party-name-row">
          <span class="cf-party-name">${escapeHtml(MOCK_PASSENGER.name)}</span>
          <span class="cf-party-rating">★ ${escapeHtml(MOCK_PASSENGER.rating)}</span>
        </div>
        <div class="cf-party-handle">${escapeHtml(MOCK_PASSENGER.handle)}</div>
        <div class="cf-party-meta">${escapeHtml(MOCK_PASSENGER.meta)}</div>
      </div>
      <button type="button" class="bd-iconbtn cf-party-chat" aria-label="Открыть чат">
        ${CHAT_SVG}
      </button>
    </div>
  `;
}

function driverCard() {
  return `
    <div class="bd-card cf-party-card">
      <div class="feed-avatar cf-avatar cf-avatar--driver" aria-hidden="true">
        ${escapeHtml(MOCK_DRIVER.initials)}
      </div>
      <div class="cf-party-info">
        <div class="cf-party-name-row">
          <span class="cf-party-name">${escapeHtml(MOCK_DRIVER.name)}</span>
          <span class="cf-party-rating">★ ${escapeHtml(MOCK_DRIVER.rating)}</span>
        </div>
        <div class="cf-party-car">${escapeHtml(MOCK_DRIVER.car)}</div>
        <div class="cf-party-meta">${escapeHtml(MOCK_DRIVER.meta)}</div>
      </div>
      <button type="button" class="bd-iconbtn cf-party-chat" aria-label="Открыть чат">
        ${CHAT_SVG}
      </button>
    </div>
  `;
}

function routeCard() {
  return `
    <div class="bd-card cf-route-card">
      <div class="cf-route-row">
        <div class="cf-route-rail" aria-hidden="true">
          <span class="cf-route-dot cf-route-dot--from"></span>
          <span class="cf-route-line"></span>
          <span class="cf-route-dot cf-route-dot--to"></span>
        </div>
        <div class="cf-route-stack">
          <div class="cf-route-leg">
            <div class="cf-route-label">Откуда</div>
            <div class="cf-route-addr">${escapeHtml(MOCK_ROUTE.from)}</div>
          </div>
          <div class="cf-route-leg">
            <div class="cf-route-label">Куда</div>
            <div class="cf-route-addr">${escapeHtml(MOCK_ROUTE.to)}</div>
          </div>
        </div>
        <div class="cf-route-eta" aria-label="Время в пути">
          <span class="cf-route-eta-value">${MOCK_ROUTE.etaMin} мин</span>
        </div>
      </div>
    </div>
  `;
}

function metaGrid() {
  return `
    <div class="cf-meta-grid" role="group" aria-label="Параметры поездки">
      <div class="cf-meta-cell">
        <div class="cf-meta-label">Цена</div>
        <div class="cf-meta-value cf-meta-value--price">${escapeHtml(MOCK_ROUTE.priceRub)}</div>
      </div>
      <div class="cf-meta-cell">
        <div class="cf-meta-label">Подача</div>
        <div class="cf-meta-value">${MOCK_ROUTE.pickupMin} мин</div>
      </div>
      <div class="cf-meta-cell">
        <div class="cf-meta-label">Маршрут</div>
        <div class="cf-meta-value">${MOCK_ROUTE.distanceKm} км</div>
      </div>
    </div>
  `;
}

// ── State renderers ───────────────────────────────────────────
function renderPassengerPending(tripId) {
  return {
    pillTone: 'warn',
    pillText: `ПОЕЗДКА № ${escapeHtml(tripId)} · ОЖИДАЕТ ПОДТВЕРЖДЕНИЯ`,
    hero: `
      <div class="cf-hero">
        <div class="cf-hero-icon cf-hero-icon--pending" aria-hidden="true">${PENDING_SVG}</div>
        <h1 class="cf-hero-title">Подтвердите поездку</h1>
        <p class="cf-hero-sub">Водитель готов выехать. Подтвердите детали — после этого мы откроем активную поездку.</p>
      </div>
    `,
    body: `
      <div class="cf-section-label">Водитель</div>
      ${driverCard()}
      <div class="cf-section-label">Маршрут</div>
      ${routeCard()}
      ${metaGrid()}
      <blockquote class="cf-comment" aria-label="Комментарий пассажира">${escapeHtml(MOCK_PASSENGER.comment)}</blockquote>
    `,
    footer: `
      <button type="button" class="bd-btn primary cf-btn-primary" data-cf-action="passenger-confirm">
        ${CHECK_SVG_INLINE} Подтвердить поездку
      </button>
      <button type="button" class="bd-btn ghost cf-btn-secondary" data-cf-action="back-to-chat">
        Вернуться в чат
      </button>
    `,
  };
}

function renderDriverWaiting(tripId) {
  return {
    pillTone: 'info',
    pillText: `ПОЕЗДКА № ${escapeHtml(tripId)} · ОТКЛИК ОТПРАВЛЕН`,
    hero: `
      <div class="cf-hero">
        <div class="cf-hero-icon cf-hero-icon--waiting" aria-hidden="true">${WAITING_SVG}</div>
        <h1 class="cf-hero-title">Отклик отправлен</h1>
        <p class="cf-hero-sub">
          <span>Ждём подтверждение пассажира</span>
          <span class="cf-countdown" id="cf-countdown" aria-live="polite">0:60</span>
        </p>
      </div>
    `,
    body: `
      <div class="cf-section-label">Пассажир</div>
      ${passengerCard()}
      <div class="cf-section-label">Маршрут</div>
      ${routeCard()}
      ${metaGrid()}
      <div class="cf-progress" role="progressbar" aria-label="Авто-отмена отклика" aria-valuemin="0" aria-valuemax="60">
        <span class="cf-progress-fill"></span>
      </div>
      <div class="cf-sub-row">
        <span class="cf-sub-left">Отправлено в ${escapeHtml(MOCK_ROUTE.sentAt)}</span>
        <span class="cf-sub-right">Авто-отмена через <span class="cf-countdown cf-countdown--inline" id="cf-countdown-inline">1 мин</span></span>
      </div>
    `,
    footer: `
      <button type="button" class="bd-btn primary cf-btn-primary" data-cf-action="open-chat">
        ${CHAT_SVG} Открыть чат
      </button>
      <button type="button" class="bd-btn ghost cf-btn-secondary" data-cf-action="cancel-response">
        Отменить отклик
      </button>
    `,
  };
}

function renderPassengerConfirmed(tripId) {
  return {
    pillTone: 'ok',
    pillText: `ПОЕЗДКА № ${escapeHtml(tripId)} · ПОДТВЕРЖДЕНА`,
    hero: `
      <div class="cf-hero">
        <div class="cf-hero-icon cf-hero-icon--confirmed" aria-hidden="true">
          <span class="cf-confirmed-ring" aria-hidden="true"></span>
          ${CHECK_SVG}
        </div>
        <h1 class="cf-hero-title">Поездка подтверждена</h1>
        <p class="cf-hero-sub">Водитель скоро начнёт движение к вам</p>
      </div>
    `,
    body: `
      <div class="cf-section-label">Водитель</div>
      ${driverCard()}
      <div class="cf-section-label">Маршрут</div>
      ${routeCard()}
      ${metaGrid()}
    `,
    footer: `
      <button type="button" class="bd-btn primary cf-btn-primary" data-cf-action="open-ride-passenger">
        Открыть поездку
      </button>
    `,
  };
}

function renderDriverConfirmed(tripId) {
  return {
    pillTone: 'ok',
    pillText: `ПОЕЗДКА № ${escapeHtml(tripId)} · ПОДТВЕРЖДЕНА`,
    hero: `
      <div class="cf-hero">
        <div class="cf-hero-icon cf-hero-icon--confirmed" aria-hidden="true">
          <span class="cf-confirmed-ring" aria-hidden="true"></span>
          ${CHECK_SVG}
        </div>
        <h1 class="cf-hero-title">Поездка подтверждена</h1>
        <p class="cf-hero-sub">Можно ехать к пассажиру</p>
      </div>
    `,
    body: `
      <div class="cf-section-label">Пассажир</div>
      ${passengerCard()}
      <div class="cf-section-label">Маршрут</div>
      ${routeCard()}
      ${metaGrid()}
    `,
    footer: `
      <button type="button" class="bd-btn primary cf-btn-primary" data-cf-action="open-ride-driver">
        Ехать к пассажиру
      </button>
      <button type="button" class="bd-btn ghost cf-btn-secondary" data-cf-action="open-chat">
        Открыть чат
      </button>
    `,
  };
}

function renderExpired(tripId) {
  return {
    pillTone: 'err',
    pillText: `ПОЕЗДКА № ${escapeHtml(tripId)} · ИСТЕКЛО`,
    hero: `
      <div class="cf-hero">
        <div class="cf-hero-icon cf-hero-icon--error" aria-hidden="true">${ALERT_SVG}</div>
        <h1 class="cf-hero-title">Не удалось открыть подтверждение</h1>
        <p class="cf-hero-sub">Похоже, ссылка устарела или другая сторона отменила поездку. Создайте новую заявку или вернитесь к диалогу.</p>
      </div>
    `,
    body: `
      <div class="bd-card cf-summary-card">
        <div class="cf-summary-row">
          <span class="cf-summary-label">Заявка</span>
          <span class="cf-summary-value">№${escapeHtml(tripId)}</span>
        </div>
        <div class="cf-summary-row">
          <span class="cf-summary-label">Маршрут</span>
          <span class="cf-summary-value cf-summary-value--route">${escapeHtml(MOCK_ROUTE.from)} → ${escapeHtml(MOCK_ROUTE.to)}</span>
        </div>
        <div class="cf-summary-row">
          <span class="cf-summary-label">Истекло</span>
          <span class="cf-summary-value">${escapeHtml(MOCK_ROUTE.expiredAt)} · ${escapeHtml(MOCK_ROUTE.expiredAgo)}</span>
        </div>
      </div>
    `,
    footer: `
      <button type="button" class="bd-btn primary cf-btn-primary" data-cf-action="back-to-feed">
        Вернуться в ленту
      </button>
      <button type="button" class="bd-btn ghost cf-btn-secondary" data-cf-action="open-chat">
        ${CHAT_SVG} Открыть чат
      </button>
    `,
  };
}

const CHECK_SVG_INLINE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="16" height="16">
  <polyline points="5 12 10 17 19 7"/>
</svg>`;

const STATE_RENDERERS = {
  [CF_STATE.PASSENGER_PENDING]:   renderPassengerPending,
  [CF_STATE.DRIVER_WAITING]:      renderDriverWaiting,
  [CF_STATE.PASSENGER_CONFIRMED]: renderPassengerConfirmed,
  [CF_STATE.DRIVER_CONFIRMED]:    renderDriverConfirmed,
  [CF_STATE.EXPIRED]:             renderExpired,
};

// ── Countdown helper ──────────────────────────────────────────
// Mock-only: pure textContent updates, no style mutations, no real
// auto-cancel side effects. Cleared on next render via abort signal.
function startCountdown(rootEl, controller) {
  const big = rootEl.querySelector('#cf-countdown');
  const inline = rootEl.querySelector('#cf-countdown-inline');
  if (!big && !inline) return;
  let remaining = 60;
  function fmt(s) {
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return `${m}:${ss < 10 ? '0' : ''}${ss}`;
  }
  function fmtInline(s) {
    if (s >= 60) return '1 мин';
    return `${s} с`;
  }
  function tick() {
    if (controller.aborted) return;
    if (big)    big.textContent = fmt(remaining);
    if (inline) inline.textContent = fmtInline(remaining);
    if (remaining <= 5) {
      if (big)    big.classList.add('cf-countdown--urgent');
      if (inline) inline.classList.add('cf-countdown--urgent');
    }
    remaining -= 1;
    if (remaining < 0) return;
    const id = setTimeout(tick, 1000);
    controller.timers.push(id);
  }
  tick();
}

// ── Default export ────────────────────────────────────────────
export default function tripConfirmation() {
  const query = getHashQuery();
  const role = query.get('role') === 'driver' ? 'driver' : 'passenger';
  const tripId = query.get('tripId') || DEMO_TRIP_ID;
  const state = resolveState(query.get('state'), role);

  const root = document.createElement('section');
  root.className = `screen screen--trip-confirmation cf-state-${state.toLowerCase()}`;
  root.setAttribute('data-cf-state', state);

  const view = STATE_RENDERERS[state](tripId);

  root.innerHTML = `
    <div class="cf-topbar">
      <button type="button" class="cf-back" id="cf-back" aria-label="Назад">
        ${BACK_SVG}
      </button>
      <div class="cf-title-stack">
        <span class="cf-title">Подтверждение</span>
        <span class="cf-subtitle">№${escapeHtml(tripId)}</span>
      </div>
      <button type="button" class="cf-shield" id="cf-shield" aria-label="Безопасность">
        ${SHIELD_SVG}
      </button>
    </div>

    <div class="bd-scroll cf-scroll">
      <div class="cf-pill cf-pill--${view.pillTone}" role="status">
        <span class="cf-pill-dot" aria-hidden="true"></span>
        <span class="cf-pill-text">${view.pillText}</span>
      </div>
      ${view.hero}
      <div class="cf-body">${view.body}</div>
    </div>

    <div class="cf-footer">${view.footer}</div>
  `;

  // ── Wire actions ────────────────────────────────────────────
  const controller = { aborted: false, timers: [] };

  function goActiveRidePassenger() {
    go(`/active-ride?role=passenger&tripId=${encodeURIComponent(tripId)}&status=DRIVER_EN_ROUTE`);
  }
  function goActiveRideDriver() {
    go(`/active-ride?role=driver&tripId=${encodeURIComponent(tripId)}&status=DRIVER_EN_ROUTE`);
  }

  const ACTIONS = {
    'passenger-confirm': () => {
      go(`/trip-confirmation?role=passenger&tripId=${encodeURIComponent(tripId)}&state=${CF_STATE.PASSENGER_CONFIRMED}`);
    },
    'open-ride-passenger': goActiveRidePassenger,
    'open-ride-driver':    goActiveRideDriver,
    'back-to-chat':        () => go('/chat'),
    'open-chat':           () => go('/chat'),
    'cancel-response':     () => go('/feed'),
    'back-to-feed':        () => go('/feed'),
  };

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cf-action]');
    if (!btn) return;
    const handler = ACTIONS[btn.dataset.cfAction];
    if (handler) handler();
  });

  root.querySelector('#cf-back').addEventListener('click', () => {
    if (state === CF_STATE.DRIVER_WAITING || state === CF_STATE.DRIVER_CONFIRMED) {
      go('/feed');
    } else {
      go('/chat');
    }
  });

  root.querySelector('#cf-shield').addEventListener('click', () => {
    // Safety sheet is owned by BD-RIDE-P-07; no-op stub here.
  });

  if (state === CF_STATE.DRIVER_WAITING) {
    startCountdown(root, controller);
  }

  return root;
}
