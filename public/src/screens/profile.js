import { user } from '../state.js';
import { go } from '../router.js';
import { escapeHtml } from '../util.js';

// ── SVG constants ─────────────────────────────────────────────────────────────

const SVG_PERSON_LG = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.582-7 8-7s8 3 8 7"/>
</svg>`;

const SVG_CAR_SM = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M5 17h14M7 17v2M17 17v2"/>
  <path d="M5 17v-3l2-5h10l2 5v3"/>
  <circle cx="8" cy="14" r="1.2" fill="currentColor"/>
  <circle cx="16" cy="14" r="1.2" fill="currentColor"/>
</svg>`;

const SVG_CHEVRON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="m9 18 6-6-6-6"/>
</svg>`;

const SVG_POST = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="3" y="3" width="18" height="18" rx="3"/>
  <path d="M7 8h10M7 12h10M7 16h6"/>
</svg>`;

const SVG_TRIP = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M5 12h14M12 5l7 7-7 7"/>
</svg>`;

const SVG_REPLY = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="m9 17-4-4 4-4"/><path d="M20 18v-2a4 4 0 0 0-4-4H5"/>
</svg>`;

const SVG_BELL = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M6 8a6 6 0 0 1 12 0c0 6 3 7 3 7H3s3-1 3-7"/>
  <path d="M10 21a2 2 0 0 0 4 0"/>
</svg>`;

const SVG_RULES = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
  <rect x="9" y="3" width="6" height="4" rx="1"/>
  <path d="M9 12h6M9 16h4"/>
</svg>`;

const SVG_CHECK_SM = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M20 6 9 17l-5-5"/>
</svg>`;

const SVG_CIRCLE_SM = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" aria-hidden="true">
  <circle cx="12" cy="12" r="9"/>
</svg>`;

const SVG_WARN = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="m10.29 3.86-8.47 14.14A2 2 0 0 0 3.53 21h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
</svg>`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(u) {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.displayName || '';
  if (!name.trim()) return '?';
  return name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
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

// ── Guest / unonboarded view ──────────────────────────────────────────────────

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

// ── Hero ──────────────────────────────────────────────────────────────────────

function heroHtml(u) {
  const ini = escapeHtml(initials(u));
  const displayName = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.displayName || 'Пользователь';
  const phone = u.phone ? formatPhone(u.phone) : null;
  return `
    <div class="pf-hero">
      <div class="bd-avatar xl" aria-hidden="true">${ini}</div>
      <div class="pf-hero-info">
        <p class="pf-name">${escapeHtml(displayName)}</p>
        ${phone ? `<p class="pf-phone">${escapeHtml(phone)}</p>` : ''}
        ${roleBadge(u.role)}
      </div>
    </div>
  `;
}

// ── Stats grid ────────────────────────────────────────────────────────────────

function statsHtml() {
  return `
    <div class="pf-stats-grid" aria-label="Статистика профиля">
      <div class="pf-stat"><span class="pf-stat__num">0</span><span class="pf-stat__label">Публикации</span></div>
      <div class="pf-stat"><span class="pf-stat__num">0</span><span class="pf-stat__label">Поездки</span></div>
      <div class="pf-stat"><span class="pf-stat__num">0</span><span class="pf-stat__label">Отклики</span></div>
      <div class="pf-stat"><span class="pf-stat__num">—</span><span class="pf-stat__label">Рейтинг</span></div>
    </div>
  `;
}

// ── Role/mode tabs (driver only) ──────────────────────────────────────────────

function modeTabsHtml(activeMode) {
  const pax = activeMode === 'passenger' ? ' pf-mode-tab--active' : '';
  const drv = activeMode === 'driver'    ? ' pf-mode-tab--active' : '';
  return `
    <div class="pf-mode-tabs" role="group" aria-label="Режим профиля">
      <button type="button" class="pf-mode-tab${pax}" data-mode="passenger">Пассажир</button>
      <button type="button" class="pf-mode-tab${drv}" data-mode="driver">Водитель</button>
    </div>
  `;
}

// ── Driver status card ────────────────────────────────────────────────────────

function carSummaryHtml(u) {
  if (u.vehicleMake && u.vehicleModel) {
    const yearPart  = u.vehicleYear  ? ` · ${escapeHtml(u.vehicleYear)}`  : '';
    const colorPart = u.vehicleColor ? ` · ${escapeHtml(u.vehicleColor)}` : '';
    return `
      <div class="pf-car-row">
        <div class="bd-list-icon">${SVG_CAR_SM}</div>
        <div class="pf-car-info">
          <span class="pf-car-name">${escapeHtml(u.vehicleMake)} ${escapeHtml(u.vehicleModel)}${yearPart}${colorPart}</span>
          ${u.vehiclePlate ? `<span class="pf-car-plate">${escapeHtml(u.vehiclePlate)}</span>` : ''}
        </div>
      </div>
    `;
  }
  return `
    <div class="pf-car-row">
      <div class="bd-list-icon pf-icon--warn">${SVG_WARN}</div>
      <div class="pf-car-info">
        <span class="pf-car-name">Нет данных об автомобиле</span>
        <span class="pf-car-sub">Добавьте авто в настройках профиля</span>
      </div>
    </div>
  `;
}

function checklistHtml(u) {
  const items = [
    { label: 'Телефон подтверждён', done: !!u.phone },
    { label: 'Данные автомобиля',  done: !!(u.vehicleMake && u.vehicleModel) },
    { label: 'Госномер',           done: !!u.vehiclePlate },
    { label: 'Документы и ОСАГО',  done: false },
    { label: 'Разрешение такси',   done: false },
  ];
  return `
    <div class="pf-checklist" aria-label="Готовность к выходу на линию">
      ${items.map((item) => `
        <div class="pf-checklist-item${item.done ? ' pf-checklist-item--done' : ''}">
          <div class="pf-check-icon" aria-hidden="true">${item.done ? SVG_CHECK_SM : SVG_CIRCLE_SM}</div>
          <span class="pf-check-label">${escapeHtml(item.label)}</span>
          ${!item.done ? `<span class="pf-check-action">Загрузить</span>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function driverCardHtml(u) {
  const online = !!u.driverOnline;
  return `
    <div class="bd-card pf-driver-card">
      <div class="pf-online-row">
        <div class="pf-online-info">
          <span class="pf-online-label">На линии</span>
          <span class="pf-online-sub${online ? '' : ' pf-online-sub--off'}" id="pf-online-sub">
            ${online ? 'Принимаю заказы' : 'Оффлайн'}
          </span>
        </div>
        <label class="pf-toggle" aria-label="Статус на линии">
          <input type="checkbox" class="pf-toggle__input" id="pf-online-cb"${online ? ' checked' : ''}>
          <span class="pf-toggle__track"></span>
        </label>
      </div>
      <div class="divider"></div>
      ${carSummaryHtml(u)}
      <div class="divider"></div>
      ${checklistHtml(u)}
    </div>
  `;
}

// ── Actions list ──────────────────────────────────────────────────────────────

function actionsHtml(u) {
  const notif = !!u.notificationsEnabled;

  const baseActions = [
    { id: 'pf-publications', icon: SVG_POST,  label: 'Мои публикации', route: '/feed'  },
    { id: 'pf-trips',        icon: SVG_TRIP,  label: 'Мои поездки',    route: '/feed'  },
    { id: 'pf-replies',      icon: SVG_REPLY, label: 'Мои отклики',    route: null     },
  ];
  const driverAction = { id: 'pf-car-docs', icon: SVG_CAR_SM, label: 'Авто и документы', route: null };
  const rulesAction  = { id: 'pf-rules',    icon: SVG_RULES,  label: 'Правила',           route: '/rules' };

  const actions = u.role === 'driver'
    ? [...baseActions, driverAction, rulesAction]
    : [...baseActions, rulesAction];

  return `
    <div class="bd-card pf-actions-card">
      ${actions.map((a) => `
        <button type="button" class="pf-action" id="${a.id}">
          <div class="pf-action-icon">${a.icon}</div>
          <span class="pf-action-label">${a.label}</span>
          <span class="pf-action-chevron" aria-hidden="true">${SVG_CHEVRON}</span>
        </button>
      `).join('')}
      <div class="pf-action pf-action--toggle">
        <div class="pf-action-icon">${SVG_BELL}</div>
        <span class="pf-action-label">Уведомления</span>
        <label class="pf-toggle" aria-label="Получать уведомления">
          <input type="checkbox" class="pf-toggle__input" id="pf-notif-cb"${notif ? ' checked' : ''}>
          <span class="pf-toggle__track"></span>
        </label>
      </div>
    </div>
  `;
}

// ── Danger zone ───────────────────────────────────────────────────────────────

function dangerZoneHtml() {
  return `
    <div class="pf-danger-zone">
      <button type="button" class="bd-btn danger" id="pf-reset">
        Сбросить профиль и выйти
      </button>
    </div>
  `;
}

// ── Main factory ──────────────────────────────────────────────────────────────

export default function profile() {
  const root = document.createElement('section');
  root.className = 'screen screen--profile';

  const u = user.get();

  if (!u.onboarded || u.role === 'guest') {
    renderGuest(root);
    return root;
  }

  let activeMode = u.role;

  function render() {
    const u2      = user.get();
    const isDriver = u2.role === 'driver';

    root.innerHTML = `
      <div class="bd-topbar">
        <div class="bd-topbar__titles">
          <h1 class="bd-topbar__title">Профиль</h1>
        </div>
      </div>
      <div class="bd-scroll">
        ${heroHtml(u2)}
        ${statsHtml()}
        ${isDriver ? modeTabsHtml(activeMode) : ''}
        ${isDriver && activeMode === 'driver' ? driverCardHtml(u2) : ''}
        ${actionsHtml(u2)}
        ${dangerZoneHtml()}
      </div>
    `;

    wire();
  }

  function wire() {
    root.querySelectorAll('.pf-mode-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        activeMode = tab.dataset.mode;
        render();
      });
    });

    const onlineCb = root.querySelector('#pf-online-cb');
    if (onlineCb) {
      onlineCb.addEventListener('change', () => {
        user.set({ driverOnline: onlineCb.checked });
        const sub = root.querySelector('#pf-online-sub');
        if (sub) {
          sub.textContent = onlineCb.checked ? 'Принимаю заказы' : 'Оффлайн';
          sub.classList.toggle('pf-online-sub--off', !onlineCb.checked);
        }
      });
    }

    const notifCb = root.querySelector('#pf-notif-cb');
    if (notifCb) {
      notifCb.addEventListener('change', () => {
        user.set({ notificationsEnabled: notifCb.checked });
      });
    }

    const routeMap = {
      'pf-publications': '/feed',
      'pf-trips':        '/feed',
      'pf-rules':        '/rules',
    };
    Object.entries(routeMap).forEach(([id, route]) => {
      root.querySelector(`#${id}`)?.addEventListener('click', () => go(route));
    });
    // pf-replies and pf-car-docs are stubs — no navigation wired

    const resetBtn = root.querySelector('#pf-reset');
    if (resetBtn) {
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
  }

  render();
  return root;
}
