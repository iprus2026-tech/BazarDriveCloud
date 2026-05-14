import { user, setDocumentStatus, documentsAttentionCount, REQUIRED_DOCS } from '../state.js';
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

const SVG_DOC_LG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

const SVG_UPLOAD_SM = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;

const SVG_PLUS = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;

const SVG_CREDIT_CARD_PO = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`;

const SVG_RUBLE_COIN = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9 7h4.5a2.5 2.5 0 0 1 0 5H9v5M8.5 14h5"/></svg>`;

const SVG_CALENDAR_PO = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(u) {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.displayName || '';
  if (!name.trim()) return '?';
  return name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function displayName(u) {
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.displayName || 'Пользователь';
}

function fmtRub(n) {
  return new Intl.NumberFormat('ru-RU').format(n) + ' ₽';
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
    { id: 'phone',       label: 'Телефон подтверждён', done: !!u.phone },
    { id: 'vehicle',     label: 'Данные автомобиля',   done: !!(u.vehicleMake && u.vehicleModel) },
    { id: 'plate',       label: 'Госномер',            done: !!u.vehiclePlate },
    { id: 'docs',        label: 'Документы и ОСАГО',   done: !!u.documentsReady },
    { id: 'taxi-permit', label: 'Разрешение такси',    done: !!u.taxiPermit, action: 'open-permit' },
  ];
}

function canShowReadyStatus(u) {
  return !!(u.phone && u.vehicleMake && u.vehicleModel && u.vehiclePlate);
}

// Single line-readiness rule shared by Overview and Taxi/IP cards.
// A driver is ready to go online only when basic profile data is complete
// AND the waybill is open AND the medical check has been passed.
function isDriverLineReady(u) {
  return canShowReadyStatus(u)
    && u.documentsReady === true
    && u.waybillOpen === true
    && u.medicalCheckPassed === true;
}

function getDriverStatusState(u) {
  return (isDriverLineReady(u) && u.driverOnline) ? 'ready' : 'action';
}

function getDriverStatusTitle(u) {
  return getDriverStatusState(u) === 'ready' ? 'Готов принимать заказы' : 'Нужно действие';
}

function getDriverStatusSubtitle(u) {
  if (!canShowReadyStatus(u)) return 'Заполните телефон, автомобиль и госномер';
  if (!u.documentsReady) return 'Загрузите документы перед выходом на линию';
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

  // Active-shift CTA disabled state tracks isDriverLineReady — so document
  // status changes (which flip documentsReady) also propagate here.
  const cta = root.querySelector('#pf2-active-shift-cta');
  if (cta) cta.disabled = !isDriverLineReady(patched);
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
  const ready   = isDriverLineReady(u);
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
      <button type="button" class="bd-btn primary pf2-active-shift-cta" id="pf2-active-shift-cta"${ready ? '' : ' disabled'}>
        На линии — открыть активную смену
      </button>
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
  const rows = items.map((it) => {
    const baseCls = `pf2-check-row${it.done ? ' pf2-check-row--done' : ''}`;
    const icon    = `<span class="pf2-check-icon" aria-hidden="true">${it.done ? SVG_CHECK : ''}</span>`;
    const label   = `<span class="pf2-check-label">${escapeHtml(it.label)}</span>`;
    if (it.action && !it.done) {
      const id = it.id === 'taxi-permit' ? ' id="pf2-check-taxi-permit"' : '';
      return `
      <button type="button" class="${baseCls} pf2-check-row--action"${id} data-action="${escapeHtml(it.action)}">
        ${icon}${label}
        <span class="pf2-check-arrow" aria-hidden="true">${SVG_CHEVRON}</span>
      </button>`;
    }
    return `
      <div class="${baseCls}">
        ${icon}${label}
      </div>`;
  }).join('');
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

function taxiPermitPanelHtml(u) {
  const d = u.taxiPermitDraft || {};
  const num    = escapeHtml(d.number || '');
  const region = escapeHtml(d.region || '');
  const issued = escapeHtml(d.issuedAt || '');
  const expiry = escapeHtml(d.expiresAt || '');
  return `
    <div class="pf2-permit-panel" id="pf2-permit-panel" hidden aria-labelledby="pf2-permit-panel-title">
      <div class="pf2-permit-panel__head">
        <p class="pf2-permit-panel__title" id="pf2-permit-panel-title">Разрешение такси</p>
        <button type="button" class="pf2-permit-panel__close" id="pf2-permit-close" aria-label="Закрыть">✕</button>
      </div>
      <p class="pf2-permit-panel__hint">Заполните данные разрешения — это пункт готовности к смене.</p>
      <label class="pf2-permit-field">
        <span class="pf2-permit-field__label">Номер разрешения</span>
        <input type="text" class="pf2-permit-input" id="pf2-permit-number" autocomplete="off" inputmode="text" value="${num}">
      </label>
      <label class="pf2-permit-field">
        <span class="pf2-permit-field__label">Регион выдачи</span>
        <input type="text" class="pf2-permit-input" id="pf2-permit-region" autocomplete="off" value="${region}">
      </label>
      <div class="pf2-permit-row2">
        <label class="pf2-permit-field">
          <span class="pf2-permit-field__label">Дата выдачи</span>
          <input type="date" class="pf2-permit-input" id="pf2-permit-issued" value="${issued}">
        </label>
        <label class="pf2-permit-field">
          <span class="pf2-permit-field__label">Действует до</span>
          <input type="date" class="pf2-permit-input" id="pf2-permit-expiry" value="${expiry}">
        </label>
      </div>
      <div class="pf2-permit-file">
        <div class="pf2-permit-file__icon" aria-hidden="true">${SVG_DOC_LG}</div>
        <div class="pf2-permit-file__text">
          <p class="pf2-permit-file__title">Фото / файл разрешения</p>
          <p class="pf2-permit-file__sub">Загрузка появится в следующей версии</p>
        </div>
      </div>
      <p class="pf2-permit-status" id="pf2-permit-status" hidden></p>
      <div class="pf2-permit-actions">
        <button type="button" class="bd-btn pf2-permit-btn" id="pf2-permit-save-draft">Сохранить черновик</button>
        <button type="button" class="bd-btn primary pf2-permit-btn" id="pf2-permit-mark-done">Отметить как добавлено для demo</button>
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

// ── Documents pane (BD-PROFILE-DOCS-01) ──────────────────────────────────────
// Documents are rendered from user.get().driverDocuments. taxiPermit and
// documentsReady are derived in state.js from the same source, so the
// Overview readiness checklist cannot drift from this tab.

const DOC_META = {
  driverLicense: { title: 'Водительское удостоверение',     sub: '99 12 345678',          iconColor: 'success' },
  taxiOsago:     { title: 'ОСАГО для такси',                sub: 'ХХХ 0123456789',        iconColor: 'info'    },
  taxiRegistry:  { title: 'Разрешение / реестр такси',      sub: '№ 77-456789',           iconColor: 'danger'  },
  waybill:       { title: 'Путевой лист',                   sub: 'Электронный, на смену', iconColor: 'warning' },
  medicalCheck:  { title: 'Медосмотр',                      sub: 'Предрейсовый, 24 ч',    iconColor: 'warning' },
};

// ── Payouts mock data ─────────────────────────────────────────────────────────

const MOCK_PAYOUT_SUMMARY = {
  available:     18420,
  weekEarned:    21580,
  commissionPct: 12,
  commissionAmt: 2590,
  acquiringPct:  1.5,
  acquiringAmt:  324,
  weekPayout:    18666,
};

const MOCK_PAYOUT_METHODS = [
  { id: 'card-4821', bank: 'Сбербанк', last4: '4821', isDefault: true },
];

const MOCK_PAYOUT_HISTORY = [
  { id: 'ph-1', last4: '4821', date: '24.04', time: '22:10', amount: 12000, status: 'credited' },
  { id: 'ph-2', last4: '4821', date: '17.04', time: '21:48', amount: 15200, status: 'credited' },
  { id: 'ph-3', last4: '4821', date: '10.04', time: '20:02', amount:  9800, status: 'pending'  },
  { id: 'ph-4', last4: '4821', date: '03.04', time: '19:30', amount: 14400, status: 'credited' },
];

const MOCK_TAX_ITEMS = [
  {
    id:        'npd-apr',
    type:      'npd',
    title:     'Налог НПД за апрель',
    deadline:  'До 25 мая',
    rateLabel: 'самозанятость 4%',
    amount:    4280,
    action:    'Оплатить через «Мой налог»',
  },
  {
    id:        'usn-q2',
    type:      'usn',
    title:     'Налог УСН · аванс за II квартал',
    deadline:  'До 28 июля',
    rateLabel: '~6% от дохода',
    amount:    null,
    action:    null,
  },
];

function pluralDoc(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'документ';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'документа';
  return 'документов';
}

function docStatusBadgeHtml(status) {
  if (status === 'uploaded')        return `<span class="bd-badge success">${SVG_CHECK_SM} Загружен</span>`;
  if (status === 'review_required') return `<span class="bd-badge info">${SVG_CLOCK_SM} Требует проверки</span>`;
  if (status === 'expired')         return `<span class="bd-badge danger">${SVG_WARN_TRI} Истёк</span>`;
  if (status === 'missing')         return `<span class="bd-badge warning">${SVG_UPLOAD_SM} Не загружен</span>`;
  if (status === 'draft')           return `<span class="bd-badge">${SVG_CLOCK_SM} Черновик</span>`;
  return '';
}

function docMetaText(key, status) {
  if (key === 'driverLicense' && status === 'uploaded')        return 'до 2031';
  if (key === 'taxiOsago'     && status === 'review_required') return 'до 14.08.2026';
  if (key === 'taxiOsago'     && status === 'uploaded')        return 'до 14.08.2026';
  if (key === 'taxiRegistry'  && status === 'expired')         return 'истекло 12.04.2026';
  if (key === 'taxiRegistry'  && status === 'uploaded')        return 'разрешение действует';
  return '';
}

function docActionLabel(key, status) {
  if (status === 'uploaded') return null;
  if (key === 'taxiRegistry')                          return 'Обновить';
  if (key === 'waybill' || key === 'medicalCheck')     return 'Загрузить';
  if (key === 'taxiOsago')                             return 'Подробнее';
  return null;
}

function docPanelHtml(key, status) {
  if (key === 'taxiRegistry' && status !== 'uploaded') {
    return `
      <div class="pf2-doc-panel" id="pf2-doc-panel-taxiRegistry" data-doc-panel="taxiRegistry" hidden aria-labelledby="pf2-doc-panel-taxiRegistry-title">
        <div class="pf2-doc-panel__head">
          <p class="pf2-doc-panel__title" id="pf2-doc-panel-taxiRegistry-title">Обновить разрешение такси</p>
          <button type="button" class="pf2-doc-panel__close" data-doc-close="taxiRegistry" aria-label="Закрыть">✕</button>
        </div>
        <label class="pf2-doc-field">
          <span class="pf2-doc-field__label">Номер</span>
          <input type="text" class="pf2-doc-input" data-doc-input="taxiRegistry-number" autocomplete="off" inputmode="text">
        </label>
        <label class="pf2-doc-field">
          <span class="pf2-doc-field__label">Действует до</span>
          <input type="date" class="pf2-doc-input" data-doc-input="taxiRegistry-expiry">
        </label>
        <p class="pf2-doc-hint">Demo-режим: данные не отправляются на сервер.</p>
        <button type="button" class="bd-btn primary pf2-doc-panel-cta" data-doc-mark="taxiRegistry">Отметить обновлённым</button>
      </div>`;
  }
  if ((key === 'waybill' || key === 'medicalCheck') && status !== 'uploaded') {
    const title = key === 'waybill' ? 'Загрузить путевой лист' : 'Загрузить медосмотр';
    return `
      <div class="pf2-doc-panel" id="pf2-doc-panel-${escapeHtml(key)}" data-doc-panel="${escapeHtml(key)}" hidden aria-labelledby="pf2-doc-panel-${escapeHtml(key)}-title">
        <div class="pf2-doc-panel__head">
          <p class="pf2-doc-panel__title" id="pf2-doc-panel-${escapeHtml(key)}-title">${escapeHtml(title)}</p>
          <button type="button" class="pf2-doc-panel__close" data-doc-close="${escapeHtml(key)}" aria-label="Закрыть">✕</button>
        </div>
        <div class="pf2-doc-upload">
          <div class="pf2-doc-upload__icon" aria-hidden="true">${SVG_UPLOAD_SM}</div>
          <div class="pf2-doc-upload__text">
            <p class="pf2-doc-upload__title">Перетащите файл или нажмите кнопку</p>
            <p class="pf2-doc-upload__sub">Загрузка файлов появится в следующей версии</p>
          </div>
        </div>
        <button type="button" class="bd-btn primary pf2-doc-panel-cta" data-doc-mark="${escapeHtml(key)}">Отметить загруженным</button>
      </div>`;
  }
  if (key === 'taxiOsago' && status === 'review_required') {
    return `
      <div class="pf2-doc-panel pf2-doc-panel--review" id="pf2-doc-panel-taxiOsago" data-doc-panel="taxiOsago" hidden aria-labelledby="pf2-doc-panel-taxiOsago-title">
        <div class="pf2-doc-panel__head">
          <p class="pf2-doc-panel__title" id="pf2-doc-panel-taxiOsago-title">ОСАГО для такси — проверка</p>
          <button type="button" class="pf2-doc-panel__close" data-doc-close="taxiOsago" aria-label="Закрыть">✕</button>
        </div>
        <p class="pf2-doc-review">Документ ожидает проверки оператором. Demo-flow не блокирует — после проверки статус обновится автоматически.</p>
      </div>`;
  }
  return '';
}

function docCardHtml(key, doc) {
  const meta   = DOC_META[key];
  const status = doc?.status || 'missing';
  const metaText = docMetaText(key, status);
  const action   = docActionLabel(key, status);
  const metaHtml   = metaText ? `<p class="pf2-doc-meta">${escapeHtml(metaText)}</p>` : '';
  const actionHtml = action
    ? `<button type="button" class="bd-btn primary pf2-doc-action" data-doc-action="${escapeHtml(key)}">${escapeHtml(action)}</button>`
    : '';
  return `
    <div class="pf2-doc-card" data-doc-key="${escapeHtml(key)}">
      <div class="pf2-doc-header">
        <div class="pf2-doc-icon pf2-doc-icon--${meta.iconColor}" aria-hidden="true">${SVG_DOC_LG}</div>
        <div class="pf2-doc-info">
          <p class="pf2-doc-title">${escapeHtml(meta.title)}</p>
          <p class="pf2-doc-sub">${escapeHtml(meta.sub)}</p>
        </div>
        <div class="pf2-doc-status">${docStatusBadgeHtml(status)}</div>
      </div>
      ${metaHtml}${actionHtml}
    </div>
    ${docPanelHtml(key, status)}`;
}

function docsPaneHtml(u) {
  const docs = u.driverDocuments || {};
  const attention = documentsAttentionCount(docs);
  const alert = attention > 0 ? `
    <div class="bd-alert warning pf2-doc-warn" role="alert">
      <span class="pf2-doc-warn-icon" aria-hidden="true">${SVG_WARN_TRI}</span>
      <div class="pf2-doc-warn-body">
        <p class="pf2-doc-warn-title">${attention} ${pluralDoc(attention)} требуют внимания</p>
        <p class="pf2-doc-warn-sub">Без них вы не сможете выйти на линию</p>
      </div>
    </div>` : '';
  const cards = REQUIRED_DOCS
    .map((key) => docCardHtml(key, docs[key] || { status: 'missing' }))
    .join('');
  return `
    ${alert}
    ${cards}
    <button type="button" class="pf2-doc-add-btn" id="pf2-doc-add">
      ${SVG_PLUS} Добавить документ
    </button>`;
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
      <div class="bd-alert warning pf2-ip-permit-warn" id="pf2-ip-permit-warn" role="status" hidden>
        <span class="pf2-ip-warn-icon" aria-hidden="true">${SVG_WARN_TRI}</span>
        <div class="pf2-ip-warn-text">
          <p class="pf2-ip-warn-title">Разрешение такси не добавлено</p>
          <p class="pf2-ip-warn-body">Это пункт готовности к смене. MVP не блокирует выход на линию — но в проде разрешение обязательно.</p>
        </div>
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

// ── Payouts pane (BD-PROFILE-02) ─────────────────────────────────────────────
// Supported states:
//   default          — normal populated view
//   empty-history    — MOCK_PAYOUT_HISTORY is empty → placeholder card
//   no-card          — MOCK_PAYOUT_METHODS is empty → add-card CTA only
//   processing-payout — handled via CSS class on Вывести button
//   report-generating — handled via CSS class on Сформировать отчёт button

function payoutsPaneHtml() {
  const s          = MOCK_PAYOUT_SUMMARY;
  const hasMethods = MOCK_PAYOUT_METHODS.length > 0;
  const hasHistory = MOCK_PAYOUT_HISTORY.length > 0;

  // ── Methods section ──────────────────────────────────────
  const methodRows = MOCK_PAYOUT_METHODS.map((m) => `
      <button type="button" class="pf2-po-method-row">
        <span class="pf2-po-method-icon">${SVG_CREDIT_CARD_PO}</span>
        <span class="pf2-po-method-info">
          <span class="pf2-po-method-name">${escapeHtml(m.bank)}</span>
          <span class="pf2-po-method-sub">•• ${escapeHtml(m.last4)}${m.isDefault ? ' · по умолчанию' : ''}</span>
        </span>
        <span class="pf2-po-method-chevron" aria-hidden="true">${SVG_CHEVRON}</span>
      </button>`).join('');

  // no-card: "Добавить карту" row gets a subtitle hint when list is empty
  const addCardRow = `
      <button type="button" class="pf2-po-method-row" id="pf2-po-add-card-btn">
        <span class="pf2-po-method-icon pf2-po-method-icon--add">${SVG_PLUS}</span>
        <span class="pf2-po-method-info">
          <span class="pf2-po-method-name">Добавить карту</span>
          ${!hasMethods ? '<span class="pf2-po-method-sub">Добавьте карту для вывода средств</span>' : ''}
        </span>
        <span class="pf2-po-method-chevron" aria-hidden="true">${SVG_CHEVRON}</span>
      </button>`;

  // ── History section ──────────────────────────────────────
  const histItems = MOCK_PAYOUT_HISTORY.map((h) => {
    const badgeCls = h.status === 'credited' ? 'bd-badge success' : 'bd-badge';
    const badgeTxt = h.status === 'credited' ? 'Зачислено' : 'В обработке';
    return `
      <div class="pf2-po-hist-item">
        <span class="pf2-po-hist-icon">${SVG_CREDIT_CARD_PO}</span>
        <span class="pf2-po-hist-info">
          <span class="pf2-po-hist-name">Вывод на карту •• ${escapeHtml(h.last4)}</span>
          <span class="pf2-po-hist-date">${escapeHtml(h.date)} · ${escapeHtml(h.time)}</span>
        </span>
        <span class="pf2-po-hist-right">
          <span class="pf2-po-hist-amount">${fmtRub(h.amount)}</span>
          <span class="${badgeCls}">${badgeTxt}</span>
        </span>
      </div>`;
  }).join('');

  // empty-history placeholder
  const histContent = hasHistory
    ? histItems
    : `<div class="pf2-po-hist-empty">
         <p class="pf2-po-hist-empty-title">Выплат пока нет</p>
         <p class="pf2-po-hist-empty-sub">Здесь появятся выводы на карту</p>
       </div>`;

  // ── Tax cards ────────────────────────────────────────────
  const taxCards = MOCK_TAX_ITEMS.map((tax) => {
    const isNpd  = tax.type === 'npd';
    const icon   = isNpd
      ? `<span class="pf2-po-tax-icon">${SVG_RUBLE_COIN}</span>`
      : `<span class="pf2-po-tax-icon pf2-po-tax-icon--usn">${SVG_CALENDAR_PO}</span>`;
    const right  = isNpd
      ? `<span class="pf2-po-tax-amount">${fmtRub(tax.amount)}</span>`
      : `<span class="bd-badge">План</span>`;
    const payBtn = isNpd
      ? `<button type="button" class="bd-btn primary" id="pf2-po-tax-pay-${escapeHtml(tax.id)}">${escapeHtml(tax.action)}</button>`
      : '';
    return `
      <div class="pf2-po-tax-card${isNpd ? ' pf2-po-tax-card--npd' : ''}">
        <div class="pf2-po-tax-hd">
          ${icon}
          <div class="pf2-po-tax-info">
            <p class="pf2-po-tax-title">${escapeHtml(tax.title)}</p>
            <p class="pf2-po-tax-sub">${escapeHtml(tax.deadline)} · ${escapeHtml(tax.rateLabel)}</p>
          </div>
          ${right}
        </div>
        ${payBtn}
      </div>`;
  }).join('');

  return `
    <div class="pf2-po-balance-card">
      <p class="pf2-po-balance-lbl">Доступно к выводу</p>
      <p class="pf2-po-balance-amount">${fmtRub(s.available)}</p>
      <div class="pf2-po-balance-btns">
        <button type="button" class="pf2-po-balance-btn pf2-po-balance-btn--dark" id="pf2-po-withdraw-btn">Вывести</button>
        <button type="button" class="pf2-po-balance-btn pf2-po-balance-btn--sec" id="pf2-po-history-btn">История</button>
      </div>
    </div>
    <div class="pf2-po-weekly">
      <p class="pf2-po-weekly-title">Расчёт за неделю</p>
      <div class="pf2-po-weekly-row">
        <span class="pf2-po-weekly-label">Заработано</span>
        <span class="pf2-po-weekly-val">${fmtRub(s.weekEarned)}</span>
      </div>
      <div class="pf2-po-weekly-row">
        <span class="pf2-po-weekly-label">Комиссия BazarDrive · ${s.commissionPct}%</span>
        <span class="pf2-po-weekly-val pf2-po-weekly-val--neg">− ${fmtRub(s.commissionAmt)}</span>
      </div>
      <div class="pf2-po-weekly-row">
        <span class="pf2-po-weekly-label">Эквайринг · ${s.acquiringPct}%</span>
        <span class="pf2-po-weekly-val pf2-po-weekly-val--neg">− ${fmtRub(s.acquiringAmt)}</span>
      </div>
      <div class="pf2-po-weekly-sep" aria-hidden="true"></div>
      <div class="pf2-po-weekly-total-row">
        <span class="pf2-po-weekly-total-lbl">К выплате</span>
        <span class="pf2-po-weekly-total-val">${fmtRub(s.weekPayout)}</span>
      </div>
    </div>
    ${taxCards}
    <div class="pf2-po-sect-hdr">
      <span class="pf2-po-sect-title">Способы вывода</span>
      ${hasMethods ? '<button type="button" class="pf2-po-sect-action" id="pf2-po-methods-change">Изменить</button>' : ''}
    </div>
    <div class="pf2-po-methods" id="pf2-po-methods-block">
      ${methodRows}
      ${addCardRow}
    </div>
    <div class="pf2-po-sect-hdr">
      <span class="pf2-po-sect-title">История выплат</span>
      ${hasHistory ? '<button type="button" class="pf2-po-sect-action" id="pf2-po-hist-all-btn">Все</button>' : ''}
    </div>
    <div class="pf2-po-history" id="pf2-po-history-block">
      ${histContent}
    </div>
    <div class="pf2-po-report">
      <div class="pf2-po-report-hd">
        <span class="pf2-po-report-icon">${SVG_DOC_LG}</span>
        <span class="pf2-po-report-info">
          <span class="pf2-po-report-title">Отчёт о доходах</span>
          <span class="pf2-po-report-sub">PDF / Excel · для налоговой и банка</span>
        </span>
      </div>
      <button type="button" class="bd-btn primary" id="pf2-po-report-btn">Сформировать отчёт</button>
    </div>`;
}

function renderDriver(root, u) {
  const items = checklistItems(u);

  root.innerHTML = `
    <div class="pf2-topbar">
      <h1 class="pf2-topbar__title">Профиль</h1>
      <button type="button" class="pf2-topbar__gear" id="pf2-gear" aria-label="Настройки">${SVG_GEAR}</button>
    </div>
    ${tabsHtml('overview')}
    <div class="bd-scroll">
      <div class="pf2-pane pf2-pane--active" id="pf2-pane-overview">
        ${driverHeroHtml(u)}
        ${statusCardHtml(u)}
        ${driverStatsHtml()}
        ${readinessHtml(items)}
        ${taxiPermitPanelHtml(u)}
        ${quickActionsHtml()}
      </div>
      <div class="pf2-pane" id="pf2-pane-ip">${ipPaneHtml(u)}</div>
      <div class="pf2-pane" id="pf2-pane-docs">${docsPaneHtml(u)}</div>
      <div class="pf2-pane" id="pf2-pane-payouts">${payoutsPaneHtml()}</div>
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

  // Overview online toggle — syncs both status cards.
  // Guard: do not allow ON unless driver is line-ready.
  const toggleInput = root.querySelector('#pf2-online-toggle');
  toggleInput.addEventListener('change', () => {
    const on = toggleInput.checked;
    const current = user.get();
    if (on && !isDriverLineReady(current)) {
      toggleInput.checked = false;
      user.set({ driverOnline: false });
      syncDriverStatusDom(root, current, false);
      return;
    }
    user.set({ driverOnline: on });
    syncDriverStatusDom(root, current, on);
  });

  root.querySelector('#pf2-goto-actions').addEventListener('click', () => {
    root.querySelector('.pf2-readiness-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // ── Taxi permit: open inline panel ──────────────────────────────────────────
  const permitPanel  = root.querySelector('#pf2-permit-panel');
  const permitRow    = root.querySelector('#pf2-check-taxi-permit');
  const permitStatus = root.querySelector('#pf2-permit-status');

  function showPermitStatus(msg) {
    if (!permitStatus) return;
    permitStatus.textContent = msg;
    permitStatus.hidden = false;
  }

  function openPermitPanel() {
    if (!permitPanel) return;
    permitPanel.hidden = false;
    permitPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    root.querySelector('#pf2-permit-number')?.focus();
  }

  permitRow?.addEventListener('click', openPermitPanel);

  root.querySelector('#pf2-permit-close')?.addEventListener('click', () => {
    if (permitPanel) permitPanel.hidden = true;
  });

  function collectPermitDraft() {
    return {
      number:    root.querySelector('#pf2-permit-number')?.value.trim()  || '',
      region:    root.querySelector('#pf2-permit-region')?.value.trim()  || '',
      issuedAt:  root.querySelector('#pf2-permit-issued')?.value         || '',
      expiresAt: root.querySelector('#pf2-permit-expiry')?.value         || '',
    };
  }

  root.querySelector('#pf2-permit-save-draft')?.addEventListener('click', () => {
    user.set({ taxiPermitDraft: collectPermitDraft() });
    showPermitStatus('Черновик сохранён');
  });

  root.querySelector('#pf2-permit-mark-done')?.addEventListener('click', () => {
    user.set({ taxiPermitDraft: collectPermitDraft() });
    // taxiPermit and documentsReady are derived from this status — see state.js.
    setDocumentStatus('taxiRegistry', 'uploaded');
    refreshReadinessDom();
    refreshDocsPane();
    const cur = user.get();
    syncDriverStatusDom(root, cur, cur.driverOnline);
    showPermitStatus('Разрешение отмечено как добавленное (demo)');
    // Hide IP-pane permit warning if it was shown
    const warn = root.querySelector('#pf2-ip-permit-warn');
    if (warn) warn.hidden = true;
  });

  // Re-render the Documents pane while preserving its delegated click handler
  // (which lives on the pane element itself, not on inner cards).
  function refreshDocsPane() {
    const pane = root.querySelector('#pf2-pane-docs');
    if (!pane) return;
    pane.innerHTML = docsPaneHtml(user.get());
  }

  // Delegated click handler for all documents-pane interactions.
  // Buttons inside the pane carry data-doc-action / data-doc-close /
  // data-doc-mark — we route by attribute so refreshing the pane innerHTML
  // does not require re-binding listeners.
  const docsPane = root.querySelector('#pf2-pane-docs');
  docsPane?.addEventListener('click', (e) => {
    const openBtn = e.target.closest('[data-doc-action]');
    if (openBtn && docsPane.contains(openBtn)) {
      const key = openBtn.dataset.docAction;
      const panel = docsPane.querySelector(`[data-doc-panel="${key}"]`);
      if (panel) {
        const willOpen = panel.hidden;
        panel.hidden = !willOpen;
        if (willOpen) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      return;
    }
    const closeBtn = e.target.closest('[data-doc-close]');
    if (closeBtn && docsPane.contains(closeBtn)) {
      const key = closeBtn.dataset.docClose;
      const panel = docsPane.querySelector(`[data-doc-panel="${key}"]`);
      if (panel) panel.hidden = true;
      return;
    }
    const markBtn = e.target.closest('[data-doc-mark]');
    if (markBtn && docsPane.contains(markBtn)) {
      const key = markBtn.dataset.docMark;
      setDocumentStatus(key, 'uploaded');
      refreshDocsPane();
      refreshReadinessDom();
      const cur = user.get();
      syncDriverStatusDom(root, cur, cur.driverOnline);
      const ipWarn = root.querySelector('#pf2-ip-permit-warn');
      if (ipWarn && cur.taxiPermit) ipWarn.hidden = true;
      return;
    }
  });

  // Re-render readiness card + checklist row in place, without losing focus
  // on tab/panels. Keeps the inline permit panel open so the user can see
  // confirmation, but flips the row to "done" state.
  function refreshReadinessDom() {
    const current = user.get();
    const items   = checklistItems(current);
    const card    = root.querySelector('.pf2-readiness-card');
    if (!card) return;
    // Replace just the inner of the readiness card with fresh markup.
    const fresh = document.createElement('div');
    fresh.innerHTML = readinessHtml(items).trim();
    const newCard = fresh.firstElementChild;
    if (newCard) card.replaceWith(newCard);
    // Re-bind the (possibly recreated) taxi-permit row to the same handler.
    const newRow = root.querySelector('#pf2-check-taxi-permit');
    newRow?.addEventListener('click', openPermitPanel);
  }

  // CTA: open active shift / active ride (driver mode).
  // Enabled only when line-ready.
  root.querySelector('#pf2-active-shift-cta')?.addEventListener('click', () => {
    if (!isDriverLineReady(user.get())) return;
    go('/active-ride?role=driver');
  });

  // Gear icon: switch to security pane.
  root.querySelector('#pf2-gear')?.addEventListener('click', () => {
    root.querySelector('.pf2-tab[data-pane="security"]')?.click();
  });

  root.querySelector('#pf2-edit').addEventListener('click', () => go('/onboarding'));

  // "Скоро здесь" stub for quick-action rows without a dedicated screen yet.
  function stubActionRow(btn, text) {
    if (!btn) return;
    const label = btn.querySelector('.pf2-action-row__label');
    if (!label || btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    const orig = label.textContent;
    label.textContent = text;
    setTimeout(() => {
      label.textContent = orig;
      delete btn.dataset.busy;
    }, 1500);
  }

  // Quick action "Мой автомобиль" → switch to Такси / ИП pane (vehicle / shift area).
  root.querySelector('#pf2-act-car')?.addEventListener('click', () => {
    root.querySelector('.pf2-tab[data-pane="ip"]')?.click();
  });

  // Quick action "Шаблоны договоров" → stub, no dedicated screen yet.
  const contractsBtn = root.querySelector('#pf2-act-contracts');
  contractsBtn?.addEventListener('click', () => stubActionRow(contractsBtn, 'Скоро здесь'));

  // Quick action "Уведомления" → toggle notificationsEnabled and show feedback.
  const notifBtn = root.querySelector('#pf2-act-notif');
  notifBtn?.addEventListener('click', () => {
    const current = user.get();
    const next = !current.notificationsEnabled;
    user.set({ notificationsEnabled: next });
    stubActionRow(notifBtn, next ? 'Уведомления включены' : 'Уведомления выключены');
  });

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

  // IP pane online toggle — syncs both status cards.
  // Guard: do not allow ON unless driver is line-ready.
  const ipToggle = root.querySelector('#pf2-ip-online-toggle');
  if (ipToggle) {
    ipToggle.addEventListener('change', () => {
      const on = ipToggle.checked;
      const current = user.get();
      if (on && !isDriverLineReady(current)) {
        ipToggle.checked = false;
        user.set({ driverOnline: false });
        syncDriverStatusDom(root, current, false);
        return;
      }
      user.set({ driverOnline: on });
      syncDriverStatusDom(root, current, on);
    });
  }

  root.querySelector('#pf2-ip-goto-actions')?.addEventListener('click', () => {
    root.querySelector('.pf2-ip-warn-alert')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Warning-only notice for "open shift" attempts without taxi permit.
  // Does not block the action — MVP requirement.
  function maybeShowPermitWarn() {
    if (user.get().taxiPermit) return;
    const warn = root.querySelector('#pf2-ip-permit-warn');
    if (!warn) return;
    warn.hidden = false;
    warn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  root.querySelector('#pf2-ip-go-online')?.addEventListener('click', maybeShowPermitWarn);
  root.querySelector('#pf2-ip-open-shift')?.addEventListener('click', maybeShowPermitWarn);
  root.querySelector('#pf2-ip-check-ready')?.addEventListener('click', maybeShowPermitWarn);

  // ── Payouts tab interactions ──────────────────────────────────────────────

  // State: processing-payout — class pf2-po-balance-btn--processing added while in flight
  root.querySelector('#pf2-po-withdraw-btn')?.addEventListener('click', () => {
    const btn = root.querySelector('#pf2-po-withdraw-btn');
    if (btn.classList.contains('pf2-po-balance-btn--processing')) return;
    const orig = btn.textContent;
    btn.classList.add('pf2-po-balance-btn--processing');
    btn.disabled = true;
    btn.textContent = 'Оформляем вывод…';
    setTimeout(() => {
      btn.textContent = 'Заявка принята — заглушка';
      setTimeout(() => {
        btn.textContent = orig;
        btn.disabled = false;
        btn.classList.remove('pf2-po-balance-btn--processing');
      }, 1500);
    }, 800);
  });

  root.querySelector('#pf2-po-history-btn')?.addEventListener('click', () => {
    root.querySelector('#pf2-po-history-block')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  root.querySelector('#pf2-po-hist-all-btn')?.addEventListener('click', () => {
    root.querySelector('#pf2-po-history-block')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  root.querySelector('#pf2-po-methods-change')?.addEventListener('click', () => {
    const btn = root.querySelector('#pf2-po-methods-change');
    const orig = btn.textContent;
    btn.textContent = 'Скоро здесь';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });

  root.querySelector('#pf2-po-add-card-btn')?.addEventListener('click', () => {
    const nameEl = root.querySelector('#pf2-po-add-card-btn .pf2-po-method-name');
    if (!nameEl) return;
    const orig = nameEl.textContent;
    nameEl.textContent = 'Скоро здесь';
    setTimeout(() => { nameEl.textContent = orig; }, 1500);
  });

  root.querySelector('#pf2-po-tax-pay-npd-apr')?.addEventListener('click', () => {
    const btn = root.querySelector('#pf2-po-tax-pay-npd-apr');
    const orig = btn.textContent;
    btn.textContent = 'Откройте «Мой налог» — заглушка';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });

  // State: report-generating — class pf2-po-report-btn--generating while in flight,
  //        pf2-po-report-btn--done briefly on success
  root.querySelector('#pf2-po-report-btn')?.addEventListener('click', () => {
    const btn = root.querySelector('#pf2-po-report-btn');
    if (btn.classList.contains('pf2-po-report-btn--generating')) return;
    const orig = btn.textContent;
    btn.classList.add('pf2-po-report-btn--generating');
    btn.disabled = true;
    btn.textContent = 'Формируем отчёт…';
    setTimeout(() => {
      btn.classList.remove('pf2-po-report-btn--generating');
      btn.classList.add('pf2-po-report-btn--done');
      btn.disabled = false;
      btn.textContent = 'Отчёт готов — заглушка';
      setTimeout(() => {
        btn.classList.remove('pf2-po-report-btn--done');
        btn.textContent = orig;
      }, 2000);
    }, 1000);
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
