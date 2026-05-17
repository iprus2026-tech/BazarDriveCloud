import { go } from '../router.js';
import { escapeHtml } from '../util.js';

const MOCK_REQUEST = {
  id:          'post_1001',
  orderId:     'order_1001',
  passengerId: 'user_1001',
  status:      'PUBLISHED',
  pickupLabel: 'ТЦ Мега',
  dropoffLabel:'Аэропорт, терминал B',
  price:       '950 ₽',
  note:        'Маленький чемодан',
};

const MOCK_DRIVERS = [
  {
    id:            'driver_1',
    responseId:    'response_1',
    name:          'Рустам К.',
    initials:      'РК',
    avatarTone:    'mint',
    rating:        '4,92',
    car:           'Toyota Camry · серый',
    plate:         'A 124 BB 77',
    trips:         '1248 поездок',
    price:         '950 ₽',
    priceDelta:    'как у вас',
    priceTone:     'same',
    eta:           '4 мин',
    etaBars:       3,
    etaTone:       'good',
    note:          'Подъеду к подъезду №3, позвоню.',
    isBest:        true,
  },
  {
    id:            'driver_2',
    responseId:    'response_2',
    name:          'Сергей Л.',
    initials:      'СЛ',
    avatarTone:    'amber',
    rating:        '4,78',
    car:           'Hyundai Solaris · белый',
    plate:         'B 902 AO 77',
    trips:         '612 поездок',
    price:         '1 100 ₽',
    priceDelta:    '+150 ₽',
    priceTone:     'up',
    eta:           '7 мин',
    etaBars:       2,
    etaTone:       'mid',
    note:          '',
    isBest:        false,
  },
  {
    id:            'driver_3',
    responseId:    'response_3',
    name:          'Нурлан',
    initials:      'Н',
    avatarTone:    'violet',
    rating:        '4,88',
    car:           'Kia Rio · чёрный',
    plate:         'K 581 XK 77',
    trips:         '304 поездок',
    price:         '900 ₽',
    priceDelta:    '-50 ₽',
    priceTone:     'down',
    eta:           '12 мин',
    etaBars:       1,
    etaTone:       'low',
    note:          '',
    isBest:        false,
  },
];

const BACK_SVG = `
  <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="11 4 6 9 11 14"/>
  </svg>`;

const SHIELD_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="18" height="18">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>`;

const PENCIL_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="14" height="14">
    <path d="M12 20h9"/>
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>
  </svg>`;

const CAR_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="28" height="28">
    <path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1l2-4h10l2 4h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/>
    <circle cx="7.5" cy="17.5" r="2.5"/>
    <circle cx="16.5" cy="17.5" r="2.5"/>
  </svg>`;

const SPARK_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="16" height="16">
    <path d="M12 2v4"/>
    <path d="M12 18v4"/>
    <path d="M4.93 4.93l2.83 2.83"/>
    <path d="M16.24 16.24l2.83 2.83"/>
    <path d="M2 12h4"/>
    <path d="M18 12h4"/>
    <path d="M4.93 19.07l2.83-2.83"/>
    <path d="M16.24 7.76l2.83-2.83"/>
  </svg>`;

const INFO_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="16" height="16">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="8" x2="12" y2="12"/>
    <line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>`;

const STAR_SVG = `
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
       width="14" height="14">
    <path d="M12 17.27l-5.18 3.04 1.4-5.95-4.55-3.94 6-.5L12 4l2.33 5.92 6 .5-4.55 3.94 1.4 5.95z"/>
  </svg>`;

const CHECK_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="16" height="16">
    <polyline points="5 12 10 17 19 7"/>
  </svg>`;

const CHAT_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="18" height="18">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
  </svg>`;

const CLOSE_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="18" height="18">
    <line x1="6" y1="6" x2="18" y2="18"/>
    <line x1="6" y1="18" x2="18" y2="6"/>
  </svg>`;

const CHEVRON_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="14" height="14">
    <polyline points="6 9 12 15 18 9"/>
  </svg>`;

const QUOTE_SVG = `
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
       width="14" height="14">
    <path d="M9 7H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2v1a3 3 0 0 1-3 3v2a5 5 0 0 0 5-5V9a2 2 0 0 0 0-2zm12 0h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2v1a3 3 0 0 1-3 3v2a5 5 0 0 0 5-5V9a2 2 0 0 0 0-2z"/>
  </svg>`;

function getRouteParam(name) {
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  if (qi === -1) return null;
  return new URLSearchParams(hash.slice(qi + 1)).get(name);
}

function markFeedTabActive() {
  const tabbar = document.getElementById('tabbar');
  if (!tabbar) return;
  for (const btn of tabbar.querySelectorAll('[data-route]')) {
    btn.classList.toggle('active', btn.dataset.route === '/feed');
  }
}

function responsesWord(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'отклик';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'отклика';
  return 'откликов';
}

function renderEtaBars(active) {
  let html = '';
  for (let i = 1; i <= 3; i++) {
    const filled = i <= active ? ' is-on' : '';
    html += `<span class="responses__eta-bar${filled}"></span>`;
  }
  return html;
}

function renderDriverCard(driver) {
  const bestBadge = driver.isBest
    ? `<div class="responses__driver-best">
         ${SPARK_SVG}
         <span>ЛУЧШИЙ ВАРИАНТ</span>
       </div>`
    : '';

  const noteBlock = driver.note
    ? `<div class="responses__driver-note">
         <span class="responses__driver-note-icon" aria-hidden="true">${QUOTE_SVG}</span>
         <span class="responses__driver-note-text">${escapeHtml(driver.note)}</span>
       </div>`
    : '';

  return `
    <article class="responses__driver${driver.isBest ? ' responses__driver--best' : ''}"
             data-driver-id="${escapeHtml(driver.id)}"
             data-response-id="${escapeHtml(driver.responseId)}">
      ${bestBadge}

      <div class="responses__driver-head">
        <div class="responses__avatar responses__avatar--${escapeHtml(driver.avatarTone)}"
             aria-hidden="true">${escapeHtml(driver.initials)}</div>
        <div class="responses__driver-info">
          <div class="responses__driver-line">
            <span class="responses__driver-name">${escapeHtml(driver.name)}</span>
            <span class="responses__driver-rating">
              ${STAR_SVG}
              <span>${escapeHtml(driver.rating)}</span>
            </span>
          </div>
          <div class="responses__driver-car">${escapeHtml(driver.car)}</div>
          <div class="responses__driver-meta">
            <span>${escapeHtml(driver.plate)}</span>
            <span class="responses__driver-dot" aria-hidden="true">·</span>
            <span>${escapeHtml(driver.trips)}</span>
          </div>
        </div>
        <button type="button" class="responses__driver-dismiss"
                data-action="decline" aria-label="Скрыть отклик">
          ${CLOSE_SVG}
        </button>
      </div>

      <div class="responses__driver-stats">
        <div class="responses__stat">
          <div class="responses__stat-label">Цена</div>
          <div class="responses__stat-row">
            <span class="responses__stat-value">${escapeHtml(driver.price)}</span>
            <span class="responses__delta responses__delta--${escapeHtml(driver.priceTone)}">${escapeHtml(driver.priceDelta)}</span>
          </div>
        </div>
        <div class="responses__stat">
          <div class="responses__stat-label">Подача</div>
          <div class="responses__stat-row">
            <span class="responses__stat-value">${escapeHtml(driver.eta)}</span>
            <span class="responses__eta responses__eta--${escapeHtml(driver.etaTone)}" aria-hidden="true">
              ${renderEtaBars(driver.etaBars)}
            </span>
          </div>
        </div>
      </div>

      ${noteBlock}

      <div class="responses__driver-actions">
        <button type="button" class="bd-btn primary responses__driver-select"
                data-action="select">
          ${CHECK_SVG}
          <span>Выбрать</span>
        </button>
        <button type="button" class="responses__driver-side"
                data-action="chat" aria-label="Чат с водителем">
          ${CHAT_SVG}
        </button>
        <button type="button" class="responses__driver-side"
                data-action="decline" aria-label="Отклонить">
          ${CLOSE_SVG}
        </button>
      </div>
    </article>
  `;
}

function renderEmptyState() {
  return `
    <div class="responses__empty">
      <div class="responses__empty-icon" aria-hidden="true">
        <span class="responses__empty-glow"></span>
        <span class="responses__empty-icon-inner">${CAR_SVG}</span>
      </div>
      <h2 class="responses__empty-title">Ищем водителей...</h2>
      <p class="responses__empty-body">
        Заявка опубликована. Обычно первый отклик приходит за 1–3 минуты.
      </p>
    </div>

    <div class="responses__hints">
      <div class="responses__hint">
        <span class="responses__hint-icon" aria-hidden="true">${SPARK_SVG}</span>
        <span class="responses__hint-text">
          Повысьте цену на 100–200 ₽ — откликов будет в 2 раза больше
        </span>
      </div>
      <div class="responses__hint">
        <span class="responses__hint-icon responses__hint-icon--info" aria-hidden="true">${INFO_SVG}</span>
        <span class="responses__hint-text">
          Можно подождать — вы получите push, как только водитель откликнется
        </span>
      </div>
    </div>
  `;
}

function renderList(drivers) {
  return `
    <div class="responses__toolbar">
      <div class="responses__count">
        <span class="responses__count-badge">${escapeHtml(String(drivers.length))}</span>
        <span class="responses__count-label">${escapeHtml(responsesWord(drivers.length))}</span>
      </div>
      <div class="responses__status">
        <span class="responses__status-dot" aria-hidden="true"></span>
        <span>ПРИНИМАЕМ ОТКЛИКИ</span>
      </div>
      <button type="button" class="responses__sort" id="responses-sort">
        ${SPARK_SVG}
        <span>Лучшие</span>
        ${CHEVRON_SVG}
      </button>
    </div>

    <div class="responses__drivers">
      ${drivers.map(renderDriverCard).join('')}
    </div>
  `;
}

export default function responses() {
  const postId  = getRouteParam('postId') || MOCK_REQUEST.id;
  const state   = getRouteParam('state') || 'empty';
  const request = MOCK_REQUEST;

  const isList     = state === 'list' || state === 'selected';
  const drivers    = MOCK_DRIVERS;

  const root = document.createElement('section');
  root.className = 'screen screen--responses';
  root.dataset.postId = postId;
  root.dataset.state  = state;

  const subTitle = isList
    ? `${drivers.length} ${responsesWord(drivers.length)}`
    : 'Ждём предложения';

  root.innerHTML = `
    <div class="responses__topbar">
      <button type="button" class="responses__icon-btn" id="responses-back" aria-label="Назад">
        ${BACK_SVG}
      </button>
      <div class="responses__titles">
        <div class="responses__title">Отклики водителей</div>
        <div class="responses__sub">${escapeHtml(subTitle)}</div>
      </div>
      <button type="button" class="responses__icon-btn" id="responses-shield" aria-label="Безопасность">
        ${SHIELD_SVG}
      </button>
    </div>

    <div class="bd-scroll responses__scroll">

      <div class="bd-card responses__request" aria-label="Опубликованная заявка">
        <div class="responses__request-main">
          <div class="responses__route">
            <div class="responses__stop">
              <span class="responses__marker responses__marker--pickup" aria-hidden="true"></span>
              <span class="responses__stop-label">${escapeHtml(request.pickupLabel)}</span>
            </div>
            <span class="responses__route-line" aria-hidden="true"></span>
            <div class="responses__stop">
              <span class="responses__marker responses__marker--dropoff" aria-hidden="true"></span>
              <span class="responses__stop-label">${escapeHtml(request.dropoffLabel)}</span>
            </div>
          </div>
          <div class="responses__price">
            <div class="responses__price-label">Ваша цена</div>
            <div class="responses__price-value">${escapeHtml(request.price)}</div>
          </div>
        </div>
        <div class="responses__request-foot">
          <div class="responses__note">
            ${INFO_SVG}
            <span>${escapeHtml(request.note)}</span>
          </div>
          <button type="button" class="responses__edit" id="responses-edit">
            ${PENCIL_SVG}
            <span>Изменить</span>
          </button>
        </div>
      </div>

      ${isList ? renderList(drivers) : renderEmptyState()}

    </div>

    ${isList ? '' : `
      <div class="responses__footer">
        <button type="button" class="bd-btn responses__cta" id="responses-raise">
          ${PENCIL_SVG}
          <span>Поднять цену</span>
        </button>
      </div>
    `}

    <div class="responses__toast" id="responses-toast" role="status" aria-live="polite" hidden></div>
  `;

  const toastEl = root.querySelector('#responses-toast');
  let toastTimer = null;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2800);
  }

  root.querySelector('#responses-back').addEventListener('click', () => go('/feed'));

  root.querySelector('#responses-shield').addEventListener('click', () => {
    toast('Безопасность будет добавлена позже');
  });

  root.querySelector('#responses-edit').addEventListener('click', () => {
    toast('Редактирование заявки будет добавлено позже');
  });

  const raiseBtn = root.querySelector('#responses-raise');
  if (raiseBtn) {
    raiseBtn.addEventListener('click', () => {
      toast('Изменение цены будет добавлено позже');
    });
  }

  const sortBtn = root.querySelector('#responses-sort');
  if (sortBtn) {
    sortBtn.addEventListener('click', () => {
      toast('Сортировка откликов будет добавлена позже');
    });
  }

  const driversWrap = root.querySelector('.responses__drivers');
  if (driversWrap) {
    driversWrap.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-action]');
      if (!btn) return;
      const card = btn.closest('.responses__driver');
      if (!card) return;
      const driverId   = card.dataset.driverId;
      const responseId = card.dataset.responseId;
      const action     = btn.dataset.action;

      if (action === 'select') {
        go(`/responses?postId=${encodeURIComponent(postId)}&state=selected&driverId=${encodeURIComponent(driverId)}`);
        return;
      }
      if (action === 'chat') {
        go(`/chat?responseId=${encodeURIComponent(responseId)}`);
        return;
      }
      if (action === 'decline') {
        toast('Отклонение отклика будет добавлено позже');
      }
    });
  }

  if (state === 'selected') {
    const driverId = getRouteParam('driverId');
    const driver = drivers.find((d) => d.id === driverId);
    if (driver) {
      queueMicrotask(() => toast(`Выбран ${driver.name}. Подтверждение появится позже.`));
    } else {
      queueMicrotask(() => toast('Этап подтверждения водителя будет добавлен позже'));
    }
  }

  queueMicrotask(markFeedTabActive);

  return root;
}
