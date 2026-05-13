import { user } from '../state.js';
import { go, consumePendingAction } from '../router.js';
import { escapeHtml } from '../util.js';

// ── Inline SVG constants ─────────────────────────────────────────────────────
const SVG_BACK = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>
</svg>`;

const SVG_PERSON = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.582-7 8-7s8 3 8 7"/>
</svg>`;

const SVG_CAR = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M5 17h14M7 17v2M17 17v2"/>
  <path d="M5 17v-3l2-5h10l2 5v3"/>
  <circle cx="8" cy="14" r="1.2" fill="currentColor"/>
  <circle cx="16" cy="14" r="1.2" fill="currentColor"/>
</svg>`;

const SVG_EYE = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/>
  <circle cx="12" cy="12" r="3"/>
</svg>`;

const SVG_CHECK_SM = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M20 6 9 17l-5-5"/>
</svg>`;

const SVG_CHECK_LG = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M20 6 9 17l-5-5"/>
</svg>`;

const SVG_SHIELD = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
</svg>`;

const SVG_CLOCK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>
</svg>`;

const SVG_CAMERA = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M3 9a2 2 0 0 1 2-2h2l2-3h6l2 3h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
  <circle cx="12" cy="13" r="3.5"/>
</svg>`;

const SVG_UPLOAD = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
  <path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>
</svg>`;

const SVG_DOC = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
  <path d="M14 3v6h6"/>
</svg>`;

const SVG_WALLET = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="3" y="6" width="18" height="14" rx="3"/>
  <path d="M16 13h2"/><path d="M3 10h18"/>
</svg>`;

const SVG_FEED = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/>
</svg>`;

const SVG_BELL = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M6 8a6 6 0 0 1 12 0c0 6 3 7 3 7H3s3-1 3-7"/>
  <path d="M10 21a2 2 0 0 0 4 0"/>
</svg>`;

const SVG_CHEVRON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="m9 18 6-6-6-6"/>
</svg>`;

const SVG_CAR_SM = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M5 17h14M7 17v2M17 17v2"/>
  <path d="M5 17v-3l2-5h10l2 5v3"/>
  <circle cx="8" cy="14" r="1.2" fill="currentColor"/>
  <circle cx="16" cy="14" r="1.2" fill="currentColor"/>
</svg>`;

// ── Document checklist ────────────────────────────────────────────────────────
const DOCS = [
  { id: 'dl',      label: 'Водительское удостоверение',        required: true  },
  { id: 'osago',   label: 'ОСАГО для такси',                    required: true  },
  { id: 'permit',  label: 'Разрешение / реестр такси',          required: true  },
  { id: 'waybill', label: 'Путевой лист',                        required: false },
  { id: 'med',     label: 'Медосмотр',                           required: false },
  { id: 'tech',    label: 'Техосмотр / предрейсовый контроль',  required: false },
];

const BODY_TYPES = ['Седан', 'Минивэн', 'Внедорожник', 'Хэтчбек'];

const REQ_DOC_COUNT = DOCS.filter((d) => d.required).length; // 3

// ── Step sequences ────────────────────────────────────────────────────────────
function formatPhoneDisplay(raw) {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 10) return `+7 ${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
  if (d.length === 11) return `+${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
  return raw ? `+7 ${escapeHtml(raw)}` : '+7';
}

function stepsFor(role) {
  return role === 'driver'
    ? ['role', 'phone', 'otp', 'profile', 'car', 'docs', 'done']
    : ['role', 'phone', 'otp', 'profile', 'done'];
}

// ── Dot progress indicator ────────────────────────────────────────────────────
function renderDots(current, total) {
  return Array.from({ length: total }, (_, i) => {
    const cls = i < current ? 'ob-dot ob-dot--done'
              : i === current ? 'ob-dot ob-dot--active'
              : 'ob-dot';
    return `<span class="${cls}" aria-hidden="true"></span>`;
  }).join('');
}

// ── Shared header (back button + dots) ───────────────────────────────────────
function renderHeader(showBack, step, total) {
  return `
    <div class="ob-header">
      ${showBack
        ? `<button type="button" class="bd-iconbtn" id="ob-back" aria-label="Назад">${SVG_BACK}</button>`
        : `<div class="ob-header__spacer" aria-hidden="true"></div>`
      }
      <div class="ob-dots" role="progressbar"
           aria-valuenow="${step + 1}" aria-valuemax="${total}"
           aria-label="Шаг ${step + 1} из ${total}">
        ${renderDots(step, total)}
      </div>
      <div class="ob-header__spacer" aria-hidden="true"></div>
    </div>
  `;
}

// ── Step renderers ────────────────────────────────────────────────────────────
function renderRole(draft, step, total) {
  const roles = [
    { key: 'passenger', label: 'Пассажир',  sub: 'Ищу поездку или попутчика',            icon: SVG_PERSON, mod: 'info'  },
    { key: 'driver',    label: 'Водитель',   sub: 'Принимаю заказы и вывожу заработок',   icon: SVG_CAR,    mod: 'accent'},
    { key: 'guest',     label: 'Гость',      sub: 'Просматриваю ленту без регистрации',   icon: SVG_EYE,    mod: 'muted' },
  ];

  return `
    ${renderHeader(true, step, total)}
    <div class="ob-scroll">
      <h1 class="ob-title">Кто вы?</h1>
      <p class="ob-subtitle">Выберите роль — это поможет настроить приложение под вас</p>
      <div class="ob-role-list">
        ${roles.map((r) => `
          <button type="button"
                  class="ob-role-card${draft.role === r.key ? ' ob-role-card--selected' : ''}"
                  data-role="${r.key}">
            <div class="ob-role-icon ob-role-icon--${r.mod}">${r.icon}</div>
            <div class="ob-role-text">
              <span class="ob-role-label">${r.label}</span>
              <span class="ob-role-sub">${r.sub}</span>
            </div>
            <div class="ob-role-check${draft.role === r.key ? ' ob-role-check--on' : ''}" aria-hidden="true">
              ${draft.role === r.key ? SVG_CHECK_SM : ''}
            </div>
          </button>
        `).join('')}
      </div>
    </div>
    <div class="ob-footer">
      <button type="button" class="bd-btn primary" id="ob-next"${draft.role ? '' : ' disabled'}>
        Продолжить
      </button>
    </div>
  `;
}

function renderPhone(draft, step, total) {
  return `
    ${renderHeader(true, step, total)}
    <div class="ob-scroll">
      <h1 class="ob-title">Введите номер</h1>
      <p class="ob-subtitle">Отправим СМС-код для подтверждения. Данные в безопасности.</p>
      <div class="ob-phone-row">
        <div class="ob-country-btn" aria-label="Код страны: Россия, +7">
          <span class="ob-flag" aria-hidden="true">🇷🇺</span>
          <span class="ob-country-code">+7</span>
        </div>
        <input class="bd-input ob-phone-input"
               id="ob-phone-input"
               type="tel"
               inputmode="numeric"
               placeholder="(900) 000-00-00"
               autocomplete="tel"
               aria-label="Номер телефона"
               value="${escapeHtml(draft.phone)}">
      </div>
      <p class="ob-hint">
        ${SVG_SHIELD}
        <span>Номер используется только для входа и не передаётся третьим лицам</span>
      </p>
    </div>
    <div class="ob-footer">
      <button type="button" class="bd-btn primary" id="ob-next">Получить код</button>
    </div>
  `;
}

function renderOTP(draft, step, total) {
  return `
    ${renderHeader(true, step, total)}
    <div class="ob-scroll">
      <h1 class="ob-title">Введите код</h1>
      <p class="ob-subtitle">Код отправлен на номер ${formatPhoneDisplay(draft.phone)}</p>
      <div class="ob-otp-wrap">
        <div class="ob-otp-boxes" aria-label="Поля ввода кода">
          ${[0, 1, 2, 3, 4, 5].map((i) =>
            `<div class="ob-otp-box" id="ob-otp-box-${i}" aria-hidden="true"></div>`
          ).join('')}
        </div>
        <input class="ob-otp-hidden"
               id="ob-otp-input"
               type="tel"
               inputmode="numeric"
               maxlength="6"
               autocomplete="one-time-code"
               aria-label="Код подтверждения из 6 цифр">
      </div>
      <p class="ob-otp-resend">
        ${SVG_CLOCK}
        <span>Выслать снова через <strong>59&nbsp;сек</strong></span>
      </p>
    </div>
    <div class="ob-footer">
      <button type="button" class="bd-btn primary" id="ob-next" disabled>Подтвердить</button>
    </div>
  `;
}

function renderProfile(draft, step, total) {
  return `
    ${renderHeader(true, step, total)}
    <div class="ob-scroll">
      <h1 class="ob-title">Ваш профиль</h1>
      <p class="ob-subtitle">Пассажиры и водители увидят ваше имя</p>
      <div class="ob-avatar-wrap" aria-hidden="true">
        <div class="ob-avatar-circle">${SVG_PERSON}</div>
        <div class="ob-avatar-cam">${SVG_CAMERA}</div>
        <p class="ob-avatar-hint">Добавить фото</p>
      </div>
      <div class="bd-field">
        <label class="bd-label" for="ob-firstname">Имя</label>
        <input class="bd-input" id="ob-firstname"
               type="text" autocomplete="given-name"
               placeholder="Алексей"
               value="${escapeHtml(draft.firstName)}">
      </div>
      <div class="bd-field">
        <label class="bd-label" for="ob-lastname">Фамилия</label>
        <input class="bd-input" id="ob-lastname"
               type="text" autocomplete="family-name"
               placeholder="Иванов"
               value="${escapeHtml(draft.lastName)}">
      </div>
    </div>
    <div class="ob-footer">
      <button type="button" class="bd-btn primary" id="ob-next">Продолжить</button>
      <button type="button" class="bd-btn ghost" id="ob-skip">Пропустить</button>
    </div>
  `;
}

function renderCar(draft, step, total) {
  return `
    ${renderHeader(true, step, total)}
    <div class="ob-scroll">
      <h1 class="ob-title">Ваш автомобиль</h1>
      <p class="ob-subtitle">Данные о машине видны пассажирам при бронировании</p>
      <div class="bd-field">
        <label class="bd-label" for="ob-make">Марка</label>
        <input class="bd-input" id="ob-make"
               type="text" placeholder="Toyota, Kia, Hyundai…"
               value="${escapeHtml(draft.vehicleMake)}">
      </div>
      <div class="bd-field">
        <label class="bd-label" for="ob-model">Модель</label>
        <input class="bd-input" id="ob-model"
               type="text" placeholder="Camry, Rio, Accent…"
               value="${escapeHtml(draft.vehicleModel)}">
      </div>
      <div class="ob-row-2">
        <div class="bd-field">
          <label class="bd-label" for="ob-year">Год</label>
          <input class="bd-input" id="ob-year"
                 type="number" inputmode="numeric"
                 placeholder="2020"
                 value="${escapeHtml(draft.vehicleYear)}">
        </div>
        <div class="bd-field">
          <label class="bd-label" for="ob-color">Цвет</label>
          <input class="bd-input" id="ob-color"
                 type="text" placeholder="Серебристый"
                 value="${escapeHtml(draft.vehicleColor)}">
        </div>
      </div>
      <div class="bd-field">
        <label class="bd-label" for="ob-plate">Госномер</label>
        <input class="bd-input ob-plate-input" id="ob-plate"
               type="text" placeholder="А 123 АА 77"
               autocomplete="off"
               value="${escapeHtml(draft.vehiclePlate)}">
      </div>
      <div class="bd-field">
        <p class="bd-label" id="ob-bodytype-label">Тип кузова</p>
        <div class="ob-body-types" role="group" aria-labelledby="ob-bodytype-label">
          ${BODY_TYPES.map((t) =>
            `<button type="button"
                     class="ob-body-chip${draft.vehicleBody === t ? ' ob-body-chip--active' : ''}"
                     data-body="${escapeHtml(t)}">${escapeHtml(t)}</button>`
          ).join('')}
        </div>
      </div>
    </div>
    <div class="ob-footer">
      <button type="button" class="bd-btn primary" id="ob-next">Продолжить</button>
    </div>
  `;
}

function renderDocs(draft, step, total) {
  return `
    ${renderHeader(true, step, total)}
    <div class="ob-scroll">
      <h1 class="ob-title">Документы</h1>
      <p class="ob-subtitle">
        Загрузите документы, чтобы выйти на линию.
        Обязательные отмечены <span aria-label="обязательный">●</span>
      </p>
      <div class="ob-doc-progress">
        <div class="ob-doc-progress-row">
          <span>Обязательные</span>
          <span id="ob-req-count">0&nbsp;/&nbsp;${REQ_DOC_COUNT}</span>
        </div>
        <div class="ob-progress-track" role="progressbar"
             aria-valuenow="0" aria-valuemax="${REQ_DOC_COUNT}"
             aria-label="Загружено обязательных документов">
          <div class="ob-progress-fill" id="ob-prog-fill" data-pct="0"></div>
        </div>
      </div>
      <fieldset class="ob-docs-fieldset" id="ob-docs-fieldset">
        <legend class="sr-only">Список документов водителя</legend>
        ${DOCS.map((doc) => `
          <label class="ob-doc-card${draft.docs.has(doc.id) ? ' ob-doc-card--done' : ''}" data-id="${doc.id}">
            <div class="ob-doc-icon${draft.docs.has(doc.id) ? ' ob-doc-icon--done' : ''}">
              <span class="ob-doc-icon__upload">${SVG_UPLOAD}</span>
              <span class="ob-doc-icon__check">${SVG_CHECK_SM}</span>
            </div>
            <div class="ob-doc-text">
              <span class="ob-doc-name">${escapeHtml(doc.label)}</span>
              <span class="ob-doc-sub ob-doc-sub--hint">${doc.required ? 'Обязательно' : 'Необязательно'}</span>
            </div>
            ${doc.required ? `<span class="ob-req-dot" aria-hidden="true">●</span>` : ''}
            <input type="checkbox" class="ob-doc-check"
                   data-id="${doc.id}"
                   data-required="${doc.required}"
                   aria-label="${escapeHtml(doc.label)}"${draft.docs.has(doc.id) ? ' checked' : ''}>
          </label>
        `).join('')}
      </fieldset>
    </div>
    <div class="ob-footer">
      <button type="button" class="bd-btn primary" id="ob-next">Продолжить</button>
      <button type="button" class="bd-btn ghost" id="ob-skip">Загружу позже</button>
    </div>
  `;
}

function renderDone(draft) {
  const isDriver = draft.role === 'driver';
  const cards = isDriver
    ? [
        { svg: SVG_DOC,    label: 'Загрузите документы',   sub: 'Нужно для выхода на линию', cls: 'ob-done-card--warn' },
        { svg: SVG_CAR_SM, label: 'Проверьте данные авто',  sub: 'Марка, модель, госномер',   cls: '' },
        { svg: SVG_WALLET, label: 'Настройте выплаты',      sub: 'Привяжите карту или счёт',  cls: '' },
      ]
    : [
        { svg: SVG_FEED, label: 'Смотрите ленту',           sub: 'Поездки и попутчики рядом',  cls: '' },
        { svg: SVG_BELL, label: 'Включите уведомления',     sub: 'Не пропустите нужные рейсы', cls: '' },
      ];

  return `
    <div class="ob-done">
      <div class="ob-done-glow" aria-hidden="true"></div>
      <div class="ob-done-icon" aria-hidden="true">${SVG_CHECK_LG}</div>
      <h1 class="ob-done-title">Добро пожаловать!</h1>
      <p class="ob-done-sub">
        ${isDriver
          ? 'Профиль создан. Загрузите документы и выходите на линию.'
          : 'Профиль создан. Ищите поездки и попутчиков в ленте.'}
      </p>
      <div class="ob-done-cards">
        ${cards.map((c) => `
          <div class="ob-done-card ${c.cls}">
            <div class="ob-done-card-icon">${c.svg}</div>
            <div class="ob-done-card-text">
              <span class="ob-done-card-name">${c.label}</span>
              <span class="ob-done-card-sub">${c.sub}</span>
            </div>
            ${SVG_CHEVRON}
          </div>
        `).join('')}
      </div>
      <div class="ob-done-footer">
        <button type="button" class="bd-btn primary" id="ob-finish">
          Перейти в приложение
        </button>
      </div>
    </div>
  `;
}

// ── Main screen factory ───────────────────────────────────────────────────────
export default function onboarding() {
  const root = document.createElement('section');
  root.className = 'screen screen--onboarding';

  // Accumulated draft — cleared on finish
  const draft = {
    role: user.get().role ?? null,
    phone: '',
    firstName: '',
    lastName: '',
    vehicleMake: '',
    vehicleModel: '',
    vehicleYear: '',
    vehiclePlate: '',
    vehicleColor: '',
    vehicleBody: 'Седан',
    docs: new Set(),
  };

  let step = 0;
  let otpAdvanceTimer = null;
  let otpSubmitting = false;

  function clearOtpAdvanceTimer() {
    if (otpAdvanceTimer !== null) {
      clearTimeout(otpAdvanceTimer);
      otpAdvanceTimer = null;
    }
  }

  function advanceFromOtpOnce() {
    if (otpSubmitting) return;
    if (currentStep() !== 'otp') return;
    otpSubmitting = true;
    clearOtpAdvanceTimer();
    next();
  }

  function steps() { return stepsFor(draft.role); }
  function totalSteps() { return steps().length; }
  function currentStep() { return steps()[step]; }

  function next() {
    clearOtpAdvanceTimer();
    step = Math.min(step + 1, totalSteps() - 1);
    render();
  }

  function back() {
    clearOtpAdvanceTimer();
    if (step === 0) { go('/welcome'); return; }
    step--;
    render();
  }

  function finish() {
    const displayName = [draft.firstName, draft.lastName].filter(Boolean).join(' ')
      || draft.phone
      || 'Пользователь';
    const requiredDocIds = DOCS.filter((d) => d.required).map((d) => d.id);
    const documentsReady = draft.role === 'driver'
      && requiredDocIds.every((id) => draft.docs.has(id));
    user.set({
      onboarded: true,
      role: draft.role,
      phone: draft.phone,
      firstName: draft.firstName,
      lastName: draft.lastName,
      displayName,
      city: '',
      vehicleMake: draft.vehicleMake,
      vehicleModel: draft.vehicleModel,
      vehicleYear: draft.vehicleYear,
      vehiclePlate: draft.vehiclePlate,
      vehicleColor: draft.vehicleColor,
      vehicleBody: draft.vehicleBody,
      documentsReady,
    });
    const pending = consumePendingAction();
    if (pending) {
      pending();
    } else {
      go(draft.role === 'driver' ? '/profile' : '/feed');
    }
  }

  function render() {
    const name = currentStep();
    const total = totalSteps();

    if (name === 'otp') {
      clearOtpAdvanceTimer();
      otpSubmitting = false;
    }

    switch (name) {
      case 'role':    root.innerHTML = renderRole(draft, step, total);    break;
      case 'phone':   root.innerHTML = renderPhone(draft, step, total);   break;
      case 'otp':     root.innerHTML = renderOTP(draft, step, total);     break;
      case 'profile': root.innerHTML = renderProfile(draft, step, total); break;
      case 'car':     root.innerHTML = renderCar(draft, step, total);     break;
      case 'docs':    root.innerHTML = renderDocs(draft, step, total);    break;
      case 'done':    root.innerHTML = renderDone(draft);                  break;
      default:        root.innerHTML = renderRole(draft, step, total);
    }

    root.dataset.step = name;
    attachListeners(name);
  }

  // ── Event wiring per step ─────────────────────────────────────────────────
  function attachListeners(stepName) {
    const backBtn   = root.querySelector('#ob-back');
    const nextBtn   = root.querySelector('#ob-next');
    const skipBtn   = root.querySelector('#ob-skip');
    const finishBtn = root.querySelector('#ob-finish');

    if (backBtn)   backBtn.addEventListener('click', back);
    if (finishBtn) finishBtn.addEventListener('click', finish);

    switch (stepName) {

      case 'role':
        root.querySelectorAll('.ob-role-card').forEach((card) => {
          card.addEventListener('click', () => {
            draft.role = card.dataset.role;
            root.querySelectorAll('.ob-role-card').forEach((c) => {
              c.classList.remove('ob-role-card--selected');
              const check = c.querySelector('.ob-role-check');
              if (check) {
                check.classList.remove('ob-role-check--on');
                check.innerHTML = '';
              }
            });
            card.classList.add('ob-role-card--selected');
            const check = card.querySelector('.ob-role-check');
            if (check) {
              check.classList.add('ob-role-check--on');
              check.innerHTML = SVG_CHECK_SM;
            }
            if (nextBtn) nextBtn.disabled = false;
          });
        });

        if (nextBtn) {
          nextBtn.addEventListener('click', () => {
            if (!draft.role) return;
            if (draft.role === 'guest') {
              // Guest path: record role, clear any pending create-post action, go to feed
              user.set({ welcomeSeen: true, role: 'guest' });
              consumePendingAction();
              go('/feed');
              return;
            }
            next();
          });
        }
        break;

      case 'phone': {
        const phoneInput = root.querySelector('#ob-phone-input');
        if (phoneInput) {
          phoneInput.addEventListener('input', () => {
            draft.phone = phoneInput.value.replace(/\D/g, '');
          });
        }
        if (nextBtn) nextBtn.addEventListener('click', next);
        break;
      }

      case 'otp': {
        const otpInput = root.querySelector('#ob-otp-input');
        if (otpInput) {
          otpInput.addEventListener('input', () => {
            const val = otpInput.value.replace(/\D/g, '').slice(0, 6);
            otpInput.value = val;
            [0, 1, 2, 3, 4, 5].forEach((i) => {
              const box = root.querySelector(`#ob-otp-box-${i}`);
              if (!box) return;
              box.textContent = val[i] ?? '';
              box.classList.toggle('ob-otp-box--filled', Boolean(val[i]));
              box.classList.toggle('ob-otp-box--active', i === val.length && val.length < 6);
            });
            if (nextBtn) nextBtn.disabled = val.length !== 6;
            clearOtpAdvanceTimer();
            if (val.length < 6) otpSubmitting = false;
            if (val.length === 6) {
              // Mock: accept any 6 digits and auto-advance exactly once.
              otpSubmitting = false;
              otpAdvanceTimer = setTimeout(advanceFromOtpOnce, 320);
            }
          });
          // Tap on box row focuses the hidden input
          const boxRow = root.querySelector('.ob-otp-boxes');
          if (boxRow) boxRow.addEventListener('click', () => otpInput.focus());
          otpInput.focus();
        }
        if (nextBtn) nextBtn.addEventListener('click', () => {
          const val = otpInput ? otpInput.value.replace(/\D/g, '').slice(0, 6) : '';
          if (val.length !== 6) return;
          advanceFromOtpOnce();
        });
        break;
      }

      case 'profile': {
        const firstInput = root.querySelector('#ob-firstname');
        const lastInput  = root.querySelector('#ob-lastname');
        if (firstInput) firstInput.addEventListener('input', () => { draft.firstName = firstInput.value.trim(); });
        if (lastInput)  lastInput.addEventListener('input',  () => { draft.lastName  = lastInput.value.trim(); });
        if (nextBtn) nextBtn.addEventListener('click', next);
        if (skipBtn) skipBtn.addEventListener('click', next);
        break;
      }

      case 'car': {
        const carFields = [
          ['#ob-make',  'vehicleMake'],
          ['#ob-model', 'vehicleModel'],
          ['#ob-year',  'vehicleYear'],
          ['#ob-color', 'vehicleColor'],
          ['#ob-plate', 'vehiclePlate'],
        ];
        carFields.forEach(([sel, key]) => {
          const el = root.querySelector(sel);
          if (el) el.addEventListener('input', () => { draft[key] = el.value.trim(); });
        });
        root.querySelectorAll('.ob-body-chip').forEach((chip) => {
          chip.addEventListener('click', () => {
            draft.vehicleBody = chip.dataset.body;
            root.querySelectorAll('.ob-body-chip').forEach((c) => {
              c.classList.toggle('ob-body-chip--active', c === chip);
            });
          });
        });
        if (nextBtn) nextBtn.addEventListener('click', next);
        break;
      }

      case 'docs': {
        const updateDocProgress = () => {
          const allReq   = root.querySelectorAll('.ob-doc-check[data-required="true"]');
          const doneReq  = root.querySelectorAll('.ob-doc-check[data-required="true"]:checked');
          const count    = doneReq.length;
          const total2   = allReq.length;
          const pctInt   = total2 > 0 ? Math.round((count / total2) * 100) : 0;

          const countEl  = root.querySelector('#ob-req-count');
          if (countEl) countEl.textContent = `${count} / ${total2}`;

          const fill    = root.querySelector('#ob-prog-fill');
          const track   = root.querySelector('.ob-progress-track');
          if (fill)  fill.dataset.pct = String(pctInt);
          if (track) {
            track.setAttribute('aria-valuenow', String(count));
          }

          root.querySelectorAll('.ob-doc-check').forEach((cb) => {
            const card = cb.closest('.ob-doc-card');
            const icon = card?.querySelector('.ob-doc-icon');
            if (card) card.classList.toggle('ob-doc-card--done', cb.checked);
            if (icon) icon.classList.toggle('ob-doc-icon--done', cb.checked);
          });
        };

        root.querySelectorAll('.ob-doc-check').forEach((cb) => {
          cb.addEventListener('change', () => {
            const id = cb.dataset.id;
            if (id) {
              if (cb.checked) draft.docs.add(id);
              else draft.docs.delete(id);
            }
            updateDocProgress();
          });
        });
        updateDocProgress();
        if (nextBtn) nextBtn.addEventListener('click', next);
        if (skipBtn) skipBtn.addEventListener('click', next);
        break;
      }

      // 'done' handled by the finishBtn listener above
    }
  }

  render();
  return root;
}
