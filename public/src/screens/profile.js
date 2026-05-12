import { user } from '../state.js';
import { go } from '../router.js';
import { escapeHtml } from '../util.js';

// ── SVG constants ─────────────────────────────────────────────────────────────

const SVG_GEAR = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

const SVG_STAR = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;

const SVG_PENCIL = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;

const SVG_CHECK = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

const SVG_CHEVRON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`;

const SVG_PERSON_LG = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.582-7 8-7s8 3 8 7"/></svg>`;

const SVG_POST = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 8h10M7 12h10M7 16h6"/></svg>`;

const SVG_TRIP = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;

const SVG_REPLY = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 17-4-4 4-4"/><path d="M20 18v-2a4 4 0 0 0-4-4H5"/></svg>`;

const SVG_BELL = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 6 3 7 3 7H3s3-1 3-7"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>`;

const SVG_RULES = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>`;

const SVG_WARN_TRI = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10.29 3.86-8.23 14.27A1 1 0 0 0 2.93 19.7h16.46a1 1 0 0 0 .87-1.57L12.71 3.86a1.34 1.34 0 0 0-2.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

const SVG_CAR_FRONT = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/><path d="M5 17h14"/><path d="M3 9 5 5h14l2 4"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="17.5" r="2.5"/></svg>`;

const SVG_TAG_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;

const SVG_CLOCK_SM = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

const SVG_CHECK_SM = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(u) {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.displayName || '';
  if (!name.trim()) return '?';
  return name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function displayName(u) {
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.displayName || 'Пользователь';
}

function formatPhone(raw) {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 11) return `+${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
  if (d.length === 10) return `+7 ${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
  return raw;
}

function roleBadge(role) {
  const map = { driver: ['Водитель', 'accent'], passenger: ['Пассажир', 'info'], guest: ['Гость', ''] };
  const [label, mod] = map[role] ?? ['Пользователь', ''];
  return `<span class="bd-badge${mod ? ` ${mod}` : ''}">${label}</span>`;
}

function checklistItems(u) {
  return [
    { label: 'Телефон подтверждён', done: !!u.phone },
    { label: 'Данные автомобиля',   done: !!(u.vehicleMake && u.vehicleModel) },
    { label: 'Госномер',            done: !!u.vehiclePlate },
    { label: 'Документы и ОСАГО',   done: false },
    { label: 'Разрешение такси',    done: false },
  ];
}

function canShowReadyStatus(u) {
  return !!(u.phone && u.vehicleMake && u.vehicleModel && u.vehiclePlate);
}

// Single line-readiness rule shared by Overview and Taxi/IP cards.
// A driver is ready to go online only when basic profile data is complete
// AND the waybill is open AND the medical check has been passed.
function isDriverLineReady(u) {
  return canShowReadyStatus(u) && u.waybillOpen === true && u.medicalCheckPassed === true;
}

function getDriverStatusState(u) {
  return (isDriverLineReady(u) && u.driverOnline) ? 'ready' : 'action';
}

function getDriverStatusTitle(u) {
  return getDriverStatusState(u) === 'ready' ? 'Готов принимать заказы' : 'Нужно действие';
}

function getDriverStatusSubtitle(u) {
  if (!canShowReadyStatus(u)) return 'Заполните телефон, автомобиль и госномер';
  if (!u.medicalCheckPassed && !u.waybillOpen) return 'Загрузите медосмотр и откройте путевой лист';
  if (!u.medicalCheckPassed) return 'Загрузите медосмотр перед выходом на линию';
  if (!u.waybillOpen) return 'Откройте путевой лист перед выходом на линию';
  return 'Все требования выполнены';
}

// Syncs both status cards and toggles to the new online value.
function syncDriverStatusDom(root, u, online) {
  const patched = { ...u, driverOnline: online };

  const ovCard  = root.querySelector('#pf2-status-card');
  const ovTitle = root.querySelector('#pf2-status-title');
  const ovSub   = root.querySelector('#pf2-status-sub');
  const ovTog   = root.querySelector('#pf2-online-toggle');
  if (ovCard && ovTitle && ovSub) {
    ovCard.dataset.state = getDriverStatusState(patched);
    ovTitle.textContent  = getDriverStatusTitle(patched);
    ovSub.textContent    = getDriverStatusSubtitle(patched);
  }
  if (ovTog) ovTog.checked = online;

  const ipCard  = root.querySelector('#pf2-ip-status-card');
  const ipTitle = root.querySelector('#pf2-ip-scard-title');
  const ipSub   = root.querySelector('#pf2-ip-scard-sub');
  const ipTog   = root.querySelector('#pf2-ip-online-toggle');
  if (ipCard && ipTitle && ipSub) {
    ipCard.dataset.state = getDriverStatusState(patched);
    ipTitle.textContent  = getDriverStatusTitle(patched);
    ipSub.textContent    = getDriverStatusSubtitle(patched);
  }
  if (ipTog) ipTog.checked = online;
}

// ── Guest view ────────────────────────────────────────────────────────────────

function renderGuest(root) {
  root.innerHTML = `
    <div class="bd-topbar">
      <div class="bd-topbar__titles">
        <h1 class="bd-topbar__title">Профиль</h1>
      </div>
    </div>
    <div class="bd-scroll">
      <div class="bd-card pf-guest-card">
        <div class="pf-guest-icon" aria-hidden="true">${SVG_PERSON_LG}</div>
        <h2 class="pf-guest-title">Создайте профиль</h2>
        <p class="pf-guest-text">
          Листать ленту и читать правила можно без аккаунта.
          Публикуйте поездки и объявления после регистрации.
        </p>
        <button type="button" class="bd-btn primary" id="pf-onboard">Начать регистрацию</button>
      </div>
    </div>
  `;
  root.querySelector('#pf-onboard').addEventListener('click', () => go('/onboarding'));
}

// ── Passenger view ────────────────────────────────────────────────────────────

function renderPassenger(root, u) {
  const ini   = escapeHtml(initials(u));
  const name  = escapeHtml(displayName(u));
  const phone = u.phone ? formatPhone(u.phone) : null;
  const notif = !!u.notificationsEnabled;

  root.innerHTML = `
    <div class="bd-topbar">
      <div class="bd-topbar__titles">
        <h1 class="bd-topbar__title">Профиль</h1>
      </div>
    </div>
    <div class="bd-scroll">
      <div class="pf-hero">
        <div class="bd-avatar xl" aria-hidden="true">${ini}</div>
        <div class="pf-hero-info">
          <p class="pf-name">${name}</p>
          ${phone ? `<p class="pf-phone">${escapeHtml(phone)}</p>` : ''}
          ${roleBadge(u.role)}
        </div>
      </div>
      <div class="pf-stats-grid" aria-label="Статистика профиля">
        <div class="pf-stat"><span class="pf-stat__num">0</span><span class="pf-stat__label">Публикации</span></div>
        <div class="pf-stat"><span class="pf-stat__num">0</span><span class="pf-stat__label">Поездки</span></div>
        <div class="pf-stat"><span class="pf-stat__num">0</span><span class="pf-stat__label">Отклики</span></div>
        <div class="pf-stat"><span class="pf-stat__num">—</span><span class="pf-stat__label">Рейтинг</span></div>
      </div>
      <div class="bd-card pf-actions-card">
        <button type="button" class="pf-action" id="pf-publications">
          <div class="pf-action-icon">${SVG_POST}</div>
          <span class="pf-action-label">Мои публикации</span>
          <span class="pf-action-chevron" aria-hidden="true">${SVG_CHEVRON}</span>
        </button>
        <button type="button" class="pf-action" id="pf-trips">
          <div class="pf-action-icon">${SVG_TRIP}</div>
          <span class="pf-action-label">Мои поездки</span>
          <span class="pf-action-chevron" aria-hidden="true">${SVG_CHEVRON}</span>
        </button>
        <button type="button" class="pf-action" id="pf-replies">
          <div class="pf-action-icon">${SVG_REPLY}</div>
          <span class="pf-action-label">Мои отклики</span>
          <span class="pf-action-chevron" aria-hidden="true">${SVG_CHEVRON}</span>
        </button>
        <button type="button" class="pf-action" id="pf-rules">
          <div class="pf-action-icon">${SVG_RULES}</div>
          <span class="pf-action-label">Правила</span>
          <span class="pf-action-chevron" aria-hidden="true">${SVG_CHEVRON}</span>
        </button>
        <div class="pf-action pf-action--toggle">
          <div class="pf-action-icon">${SVG_BELL}</div>
          <span class="pf-action-label">Уведомления</span>
          <label class="pf-toggle" aria-label="Получать уведомления">
            <input type="checkbox" class="pf-toggle__input" id="pf-notif-cb"${notif ? ' checked' : ''}>
            <span class="pf-toggle__track"></span>
          </label>
        </div>
      </div>
      <div class="pf-danger-zone">
        <button type="button" class="bd-btn danger" id="pf-reset">Сбросить профиль и выйти</button>
      </div>
    </div>
  `;

  root.querySelector('#pf-publications')?.addEventListener('click', () => go('/feed'));
  root.querySelector('#pf-trips')?.addEventListener('click', () => go('/feed'));
  root.querySelector('#pf-rules')?.addEventListener('click', () => go('/rules'));
  root.querySelector('#pf-notif-cb').addEventListener('change', (e) => {
    user.set({ notificationsEnabled: e.target.checked });
  });

  const resetBtn = root.querySelector('#pf-reset');
  resetBtn.addEventListener('click', () => {
    if (resetBtn.dataset.confirm === 'pending') {
      user.reset();
      go('/welcome');
    } else {
      resetBtn.dataset.confirm = 'pending';
      resetBtn.textContent = 'Нажмите ещё раз для подтверждения';
    }
  });
}

// ── Driver dashboard (BD-PROFILE-02) ─────────────────────────────────────────

function tabsHtml(activeId = 'overview') {
  const TABS = [
    { id: 'overview', label: 'Обзор' },
    { id: 'ip',       label: 'Такси / ИП' },
    { id: 'docs',     label: 'Документы' },
    { id: 'payouts',  label: 'Выплаты' },
    { id: 'security', label: 'Безопасность' },
  ];
  return `<div class="pf2-tabs-row" role="tablist">${
    TABS.map((t) =>
      `<button type="button" class="pf2-tab${t.id === activeId ? ' pf2-tab--active' : ''}" data-pane="${t.id}" role="tab" aria-selected="${t.id === activeId}">${t.label}</button>`
    ).join('')
  }</div>`;
}

function driverHeroHtml(u) {
  const ini  = escapeHtml(initials(u));
  const name = escapeHtml(displayName(u));
  const car  = (u.vehicleMake && u.vehicleModel)
    ? escapeHtml(`${u.vehicleMake} ${u.vehicleModel}${u.vehiclePlate ? ' · ' + u.vehiclePlate : ''}`)
    : '';
  return `
    <div class="pf2-hero">
      <div class="pf2-avatar" aria-hidden="true">${ini}</div>
      <p class="pf2-hero__name">${name}</p>
      <div class="pf2-hero__meta">
        <span class="pf2-hero__star">${SVG_STAR}</span>
        <span class="pf2-hero__rating">4.8</span>
        <span class="pf2-hero__sep">·</span>
        <span class="pf2-hero__trips">203 поездки</span>
      </div>
      ${car ? `<p class="pf2-hero__car">${car}</p>` : ''}
      <button type="button" class="pf2-edit-btn" id="pf2-edit">${SVG_PENCIL} Изменить</button>
    </div>`;
}

function statusCardHtml(u) {
  const state   = getDriverStatusState(u);
  const checked = u.driverOnline ? ' checked' : '';
  return `
    <div class="pf2-status-card" data-state="${state}" id="pf2-status-card">
      <div class="pf2-status-top">
        <span class="pf2-status-dot" aria-hidden="true"></span>
        <div class="pf2-status-text">
          <p class="pf2-status-title" id="pf2-status-title">${getDriverStatusTitle(u)}</p>
          <p class="pf2-status-sub" id="pf2-status-sub">${getDriverStatusSubtitle(u)}</p>
        </div>
        <label class="pf2-toggle" aria-label="Статус водителя">
          <input type="checkbox" id="pf2-online-toggle"${checked}>
          <span class="pf2-toggle__track"></span>
        </label>
      </div>
      <button type="button" class="pf2-action-cta" id="pf2-goto-actions">Перейти к действиям</button>
    </div>`;
}

function driverStatsHtml() {
  return `
    <div class="pf2-stats-grid">
      <div class="pf2-stat-card">
        <span class="pf2-stat-val pf2-stat-val--accent">18 420 ₽</span>
        <span class="pf2-stat-label">За неделю</span>
      </div>
      <div class="pf2-stat-card">
        <span class="pf2-stat-val">42</span>
        <span class="pf2-stat-label">Поездок</span>
      </div>
      <div class="pf2-stat-card">
        <span class="pf2-stat-val">38</span>
        <span class="pf2-stat-label">Часов</span>
      </div>
    </div>`;
}

function readinessHtml(items) {
  const doneCount = items.filter((it) => it.done).length;
  const rows = items.map((it) => `
      <div class="pf2-check-row${it.done ? ' pf2-check-row--done' : ''}">
        <span class="pf2-check-icon" aria-hidden="true">${it.done ? SVG_CHECK : ''}</span>
        <span class="pf2-check-label">${escapeHtml(it.label)}</span>
      </div>`).join('');
  return `
    <div class="pf2-readiness-card">
      <div class="pf2-readiness-header">
        <span class="pf2-readiness-title">Готовность к смене</span>
        <span class="pf2-readiness-count">${doneCount} из ${items.length}</span>
      </div>
      <div class="pf2-progress-bar" data-done="${doneCount}">
        <div class="pf2-progress-fill"></div>
      </div>
      <div class="pf2-checklist">${rows}
      </div>
    </div>`;
}

function quickActionsHtml() {
  return `
    <div class="pf2-actions-section">
      <p class="pf2-actions-title">Быстрые действия</p>
      <div class="pf2-action-list">
        <button type="button" class="pf2-action-row" id="pf2-act-car">
          <span class="pf2-action-row__label">Мой автомобиль</span>${SVG_CHEVRON}
        </button>
        <button type="button" class="pf2-action-row" id="pf2-act-contracts">
          <span class="pf2-action-row__label">Шаблоны договоров</span>${SVG_CHEVRON}
        </button>
        <button type="button" class="pf2-action-row" id="pf2-act-notif">
          <span class="pf2-action-row__label">Уведомления</span>${SVG_CHEVRON}
        </button>
        <button type="button" class="pf2-action-row pf2-action-row--danger" id="pf2-act-logout">
          <span class="pf2-action-row__label">Выйти</span>${SVG_CHEVRON}
        </button>
      </div>
    </div>`;
}

function placeholderPane(label) {
  return `<div class="pf2-placeholder"><p class="pf2-placeholder__text">${label} — скоро здесь появится информация</p></div>`;
}

// ── Taxi / IP pane (BD-PROFILE-02) ───────────────────────────────────────────

function ipPaneHtml(u) {
  const online   = !!u.driverOnline;
  const showWarn = !u.waybillOpen || !u.medicalCheckPassed;
  const ipState  = getDriverStatusState(u);
  const ipTitle  = getDriverStatusTitle(u);
  const ipSub    = getDriverStatusSubtitle(u);

  return `
    <div class="pf2-status-card pf2-ip-scard" data-state="${ipState}" id="pf2-ip-status-card">
      <div class="pf2-ip-scard-top">
        <div class="pf2-ip-scard-lbl-row">
          <span class="pf2-ip-scard-dot" aria-hidden="true"></span>
          <span class="pf2-ip-driver-lbl">СТАТУС ВОДИТЕЛЯ</span>
        </div>
        <label class="pf2-toggle" aria-label="Статус водителя">
          <input type="checkbox" id="pf2-ip-online-toggle"${online ? ' checked' : ''}>
          <span class="pf2-toggle__track"></span>
        </label>
      </div>
      <div class="pf2-ip-scard-body">
        <p class="pf2-ip-scard-title" id="pf2-ip-scard-title">${ipTitle}</p>
        <p class="pf2-ip-scard-sub" id="pf2-ip-scard-sub">${ipSub}</p>
      </div>
      <button type="button" class="pf2-action-cta" id="pf2-ip-goto-actions">Перейти к действиям</button>
    </div>

    <div class="bd-card pf2-ip-shift-card">
      <p class="pf2-ip-shift-title">Управление сменой</p>
      <button type="button" class="bd-btn primary pf2-ip-go-btn" id="pf2-ip-go-online">
        ${SVG_CAR_FRONT} Выйти на линию
      </button>
      <div class="pf2-ip-shift-row">
        <button type="button" class="bd-btn pf2-ip-shift-sm" id="pf2-ip-open-shift">
          ${SVG_CLOCK_SM} Открыть смену
        </button>
        <button type="button" class="bd-btn pf2-ip-shift-sm" id="pf2-ip-check-ready">
          ${SVG_CHECK_SM} Проверить готовность
        </button>
      </div>
    </div>

    ${showWarn ? `
    <div class="bd-alert danger pf2-ip-warn-alert" role="alert">
      <span class="pf2-ip-warn-icon" aria-hidden="true">${SVG_WARN_TRI}</span>
      <div class="pf2-ip-warn-text">
        <p class="pf2-ip-warn-title">Не открыт путевой лист</p>
        <p class="pf2-ip-warn-body">Без путевого листа выход на линию запрещён. Также не пройден медосмотр.</p>
      </div>
    </div>` : ''}

    <p class="pf2-ip-sect-title">Статус самозанятого</p>
    <div class="bd-card pf2-ip-se-card">
      <div class="pf2-ip-card-hd">
        <span class="bd-badge success pf2-ip-badge-dot">Активен</span>
        <span class="pf2-ip-card-date">с 12.03.2023</span>
      </div>
      <p class="pf2-ip-inn">ИНН 770312345678</p>
      <p class="pf2-ip-card-sub">Привязан через ФНС «Мой налог»</p>
      <div class="pf2-ip-income-bar" data-pct="34">
        <div class="pf2-ip-income-fill"></div>
      </div>
      <div class="pf2-ip-income-row">
        <span class="pf2-ip-income-label">Лимит дохода в год</span>
        <span class="pf2-ip-income-val">816 200 ₽ / 2,4 млн</span>
      </div>
    </div>

    <p class="pf2-ip-sect-title">Разрешение / реестр такси</p>
    <div class="bd-card pf2-ip-permit-card">
      <div class="pf2-ip-card-hd">
        <span class="bd-badge warning pf2-ip-badge-dot">Истекает</span>
        <span class="pf2-ip-card-date">через 47 дней</span>
      </div>
      <p class="pf2-ip-inn">№ 77-456789</p>
      <p class="pf2-ip-card-sub">Действует до 12.06.2026 · реестр Москвы</p>
      <button type="button" class="bd-btn pf2-ip-permit-btn">Продлить разрешение</button>
    </div>

    <p class="pf2-ip-sect-title">Парк / агрегатор</p>
    <div class="bd-card pf2-ip-park-card">
      <button type="button" class="pf2-ip-park-row pf2-ip-park-row--sel" id="pf2-ip-park-indep">
        <span class="pf2-ip-park-icon" aria-hidden="true">${SVG_CAR_FRONT}</span>
        <span class="pf2-ip-park-info">
          <span class="pf2-ip-park-name">Самостоятельно</span>
          <span class="pf2-ip-park-sub">Без привязки к парку</span>
        </span>
        <span class="pf2-ip-park-end" aria-hidden="true">${SVG_CHECK_SM}</span>
      </button>
      <div class="pf2-ip-park-sep" aria-hidden="true"></div>
      <button type="button" class="pf2-ip-park-row" id="pf2-ip-park-fleet">
        <span class="pf2-ip-park-icon" aria-hidden="true">${SVG_TAG_ICON}</span>
        <span class="pf2-ip-park-info">
          <span class="pf2-ip-park-name">Подключить парк</span>
          <span class="pf2-ip-park-sub">Доступ к большему числу заказов</span>
        </span>
        <span class="pf2-ip-park-end" aria-hidden="true">${SVG_CHEVRON}</span>
      </button>
    </div>`;
}

function renderDriver(root, u) {
  const items = checklistItems(u);

  root.innerHTML = `
    <div class="pf2-topbar">
      <h1 class="pf2-topbar__title">Профиль</h1>
      <button type="button" class="pf2-topbar__gear" id="pf2-gear" aria-label="Настройки">${SVG_GEAR}</button>
    </div>
    ${tabsHtml('ip')}
    <div class="bd-scroll">
      <div class="pf2-pane" id="pf2-pane-overview">
        ${driverHeroHtml(u)}
        ${statusCardHtml(u)}
        ${driverStatsHtml()}
        ${readinessHtml(items)}
        ${quickActionsHtml()}
      </div>
      <div class="pf2-pane pf2-pane--active" id="pf2-pane-ip">${ipPaneHtml(u)}</div>
      <div class="pf2-pane" id="pf2-pane-docs">${placeholderPane('Документы')}</div>
      <div class="pf2-pane" id="pf2-pane-payouts">${placeholderPane('Выплаты')}</div>
      <div class="pf2-pane" id="pf2-pane-security">${placeholderPane('Безопасность')}</div>
    </div>`;

  // Tab switching
  const tabBtns = root.querySelectorAll('.pf2-tab');
  const panes   = root.querySelectorAll('.pf2-pane');
  tabBtns.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabBtns.forEach((t) => { t.classList.remove('pf2-tab--active'); t.setAttribute('aria-selected', 'false'); });
      panes.forEach((p) => p.classList.remove('pf2-pane--active'));
      tab.classList.add('pf2-tab--active');
      tab.setAttribute('aria-selected', 'true');
      const pane = root.querySelector(`#pf2-pane-${tab.dataset.pane}`);
      if (pane) pane.classList.add('pf2-pane--active');
    });
  });

  // Overview online toggle — syncs both status cards
  const toggleInput = root.querySelector('#pf2-online-toggle');
  toggleInput.addEventListener('change', () => {
    const on = toggleInput.checked;
    user.set({ driverOnline: on });
    syncDriverStatusDom(root, u, on);
  });

  root.querySelector('#pf2-goto-actions').addEventListener('click', () => {
    root.querySelector('.pf2-readiness-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  root.querySelector('#pf2-edit').addEventListener('click', () => go('/onboarding'));

  const logoutBtn = root.querySelector('#pf2-act-logout');
  logoutBtn.addEventListener('click', () => {
    if (logoutBtn.dataset.confirm === 'pending') {
      user.reset();
      go('/welcome');
    } else {
      logoutBtn.dataset.confirm = 'pending';
      logoutBtn.querySelector('.pf2-action-row__label').textContent = 'Подтвердить выход';
    }
  });

  // IP pane online toggle — syncs both status cards
  const ipToggle = root.querySelector('#pf2-ip-online-toggle');
  if (ipToggle) {
    ipToggle.addEventListener('change', () => {
      const on = ipToggle.checked;
      user.set({ driverOnline: on });
      syncDriverStatusDom(root, u, on);
    });
  }

  root.querySelector('#pf2-ip-goto-actions')?.addEventListener('click', () => {
    root.querySelector('.pf2-ip-warn-alert')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

// ── Main factory ──────────────────────────────────────────────────────────────

export default function profile() {
  const root = document.createElement('section');
  root.className = 'screen screen--profile';
  const u = user.get();

  if (!u.onboarded || u.role === 'guest') {
    renderGuest(root);
  } else if (u.role === 'driver') {
    renderDriver(root, u);
  } else {
    renderPassenger(root, u);
  }

  return root;
}
