import { go } from '../router.js';
import { escapeHtml } from '../util.js';
import { acceptOrder, getOrderById, listNearbyOrders } from '../mock_api.js';
import { createDemoActiveRide, findActiveRide, saveActiveRide, RIDE_STATUS } from '../ride_state.js';

const MOCK_REQUEST = {
  id:          'post_1001',
  orderId:     'order_1001',
  passengerId: 'user_1001',
  status:      'PUBLISHED',
  pickupLabel: 'ТЦ Мега',
  dropoffLabel:'Аэропорт, терминал B',
  price:       '950 ₽',
  numericPrice: 950,
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
    carModel:      'Toyota Camry',
    carColor:      'серый',
    plate:         'A 124 BB 77',
    trips:         '1248 поездок',
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
    carModel:      'Hyundai Solaris',
    carColor:      'белый',
    plate:         'B 902 AO 77',
    trips:         '612 поездок',
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
    carModel:      'Kia Rio',
    carColor:      'чёрный',
    plate:         'K 581 XK 77',
    trips:         '304 поездок',
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

const PHONE_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="18" height="18">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.56 2.81.69A2 2 0 0 1 22 16.92z"/>
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

function pointLabel(point, fallback) {
  if (point && typeof point === 'object' && typeof point.label === 'string' && point.label.trim()) {
    return point.label.trim();
  }
  return fallback;
}

function formatRub(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${Math.round(n).toLocaleString('ru-RU')} ₽`;
}

function moneyLabelFromOrder(order) {
  const savedLabel = typeof order?.estimatedPriceLabel === 'string' ? order.estimatedPriceLabel.trim() : '';
  if (savedLabel) return /₽\s*$/.test(savedLabel) ? savedLabel : `${savedLabel} ₽`;
  return formatRub(order?.estimatedPrice);
}

function resolveCanonicalOrder() {
  const explicitOrderId = getRouteParam('orderId');
  if (explicitOrderId) return getOrderById(explicitOrderId);

  const legacyPostId = getRouteParam('postId');
  if (legacyPostId) return null;

  const openOrders = listNearbyOrders();
  return openOrders.length ? openOrders[0] : null;
}

function formatOrderTime(order) {
  const label = typeof order?.scheduledLabel === 'string' ? order.scheduledLabel.trim() : '';
  if (label) return label;
  if (order?.scheduledMode === 'later' && order?.scheduledAt) {
    const date = new Date(order.scheduledAt);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
  }
  return 'Сейчас';
}

function requestFromOrder(order, explicitOrderId = '') {
  if (!order) {
    const orderId = explicitOrderId || MOCK_REQUEST.orderId;
    return {
      ...MOCK_REQUEST,
      id: orderId,
      orderId,
      pickupLabel: explicitOrderId ? 'Маршрут заказа' : MOCK_REQUEST.pickupLabel,
      dropoffLabel: explicitOrderId ? 'Уточняется после открытия заказа' : MOCK_REQUEST.dropoffLabel,
      note: explicitOrderId ? 'Детали заказа пока недоступны. Можно безопасно проверить отклики или вернуться на карту.' : MOCK_REQUEST.note,
      time: 'Сейчас',
      isFallback: true,
    };
  }
  const price = moneyLabelFromOrder(order) || MOCK_REQUEST.price;
  const numericPrice = Number(order.estimatedPrice) || MOCK_REQUEST.numericPrice;
  const note = String(order.comment || order.passenger?.comment || '').trim();
  return {
    id: String(order.id || MOCK_REQUEST.id),
    orderId: String(order.id || MOCK_REQUEST.orderId),
    passengerId: String(order.passenger?.authorId || MOCK_REQUEST.passengerId),
    status: 'PUBLISHED',
    pickupLabel: pointLabel(order.pickup, 'Точка подачи'),
    dropoffLabel: pointLabel(order.dropoff, 'Точка назначения'),
    price,
    numericPrice,
    note: note || 'Комментарий не указан',
    time: formatOrderTime(order),
    isFallback: false,
  };
}

function driverPrice(base, offset) {
  if (!Number.isFinite(base) || base <= 0) return null;
  return Math.max(0, Math.round(base + offset));
}

function buildDrivers(request) {
  const base = Number(request.numericPrice);
  const offsets = [0, 150, -50];
  return MOCK_DRIVERS.map((driver, index) => {
    const value = driverPrice(base, offsets[index]);
    return {
      ...driver,
      price: value ? formatRub(value) : (index === 0 ? request.price : MOCK_REQUEST.price),
    };
  });
}

function renderEtaBars(active) {
  let html = '';
  for (let i = 1; i <= 3; i++) {
    const filled = i <= active ? ' is-on' : '';
    html += `<span class="responses__eta-bar${filled}"></span>`;
  }
  return html;
}

function renderDriverCard(driver, selectedDriverId, allDeclined) {
  const isDeclined = !!allDeclined;
  const isSelected = !isDeclined && selectedDriverId && driver.id === selectedDriverId;
  const isDimmed   = !isDeclined && selectedDriverId && !isSelected;

  const bestBadge = driver.isBest
    ? `<div class="responses__driver-best">
         ${SPARK_SVG}
         <span>Лучший вариант</span>
       </div>`
    : '';

  const noteBlock = driver.note
    ? `<div class="responses__driver-note">
         <span class="responses__driver-note-icon" aria-hidden="true">${QUOTE_SVG}</span>
         <span class="responses__driver-note-text">${escapeHtml(driver.note)}</span>
       </div>`
    : '';

  let actionsBlock;
  if (isDeclined) {
    actionsBlock = `
      <div class="responses__declined-row">
        <span class="responses__declined-icon" aria-hidden="true">${CLOSE_SVG}</span>
        <span class="responses__declined-text">Вы отклонили этого водителя</span>
        <button type="button" class="responses__declined-restore" data-action="restore">Вернуть</button>
      </div>`;
  } else if (isSelected) {
    actionsBlock = `
      <div class="responses__selected-panel" role="status" aria-live="polite">
        <span class="responses__selected-icon" aria-hidden="true">${CHECK_SVG}</span>
        <span class="responses__selected-text">Водитель выбран · ждём подтверждения</span>
        <button type="button" class="responses__selected-cancel" data-action="cancel">Отменить</button>
      </div>`;
  } else {
    actionsBlock = `
      <div class="responses__driver-actions">
        <button type="button" class="bd-btn primary responses__driver-select" data-action="select">
          ${CHECK_SVG}
          <span>Выбрать водителя</span>
        </button>
        <button type="button" class="responses__driver-side" data-action="chat" aria-label="Чат с водителем">
          ${CHAT_SVG}
        </button>
        <button type="button" class="responses__driver-side" data-action="decline" aria-label="Отклонить">
          ${CLOSE_SVG}
        </button>
      </div>`;
  }

  const dismissBtn = isDeclined
    ? ''
    : `<button type="button" class="responses__driver-dismiss" data-action="decline" aria-label="Скрыть отклик">
         ${CLOSE_SVG}
       </button>`;

  const classes = [
    'responses__driver',
    driver.isBest ? 'responses__driver--best' : '',
    isSelected ? 'responses__driver--selected' : '',
    isDimmed ? 'responses__driver--dimmed' : '',
    isDeclined ? 'responses__driver--declined' : '',
  ].filter(Boolean).join(' ');

  return `
    <article class="${classes}"
             data-driver-id="${escapeHtml(driver.id)}"
             data-response-id="${escapeHtml(driver.responseId)}">
      ${bestBadge}
      <div class="responses__driver-head">
        <div class="responses__avatar responses__avatar--${escapeHtml(driver.avatarTone)}" aria-hidden="true">${escapeHtml(driver.initials)}</div>
        <div class="responses__driver-info">
          <div class="responses__driver-line">
            <span class="responses__driver-name">${escapeHtml(driver.name)}</span>
            <span class="responses__driver-rating">${STAR_SVG}<span>${escapeHtml(driver.rating)}</span></span>
          </div>
          <div class="responses__driver-car">${escapeHtml(driver.car)}</div>
          <div class="responses__driver-meta">
            <span>${escapeHtml(driver.plate)}</span>
            <span class="responses__driver-dot" aria-hidden="true">·</span>
            <span>${escapeHtml(driver.trips)}</span>
          </div>
        </div>
        ${dismissBtn}
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
      ${actionsBlock}
    </article>
  `;
}

function renderOrderMeta(request) {
  return `
    <div class="responses__request-meta" aria-label="Детали заказа">
      <div class="responses__request-meta-item">
        <span class="responses__request-meta-label">Время</span>
        <span class="responses__request-meta-value">${escapeHtml(request.time || 'Сейчас')}</span>
      </div>
      <div class="responses__request-meta-item">
        <span class="responses__request-meta-label">Бюджет</span>
        <span class="responses__request-meta-value">${escapeHtml(request.price)}</span>
      </div>
    </div>`;
}

function renderEmptyState() {
  return `
    <div class="responses__empty">
      <div class="responses__empty-icon" aria-hidden="true">
        <span class="responses__empty-glow"></span>
        <span class="responses__empty-icon-inner">${CAR_SVG}</span>
      </div>
      <h2 class="responses__empty-title">Ищем водителей</h2>
      <p class="responses__empty-body">
        Заказ опубликован. Водители увидят маршрут и смогут откликнуться.
        Обычно первый отклик приходит за 1–3 минуты.
      </p>
    </div>
    <div class="responses__hints">
      <div class="responses__hint">
        <span class="responses__hint-icon" aria-hidden="true">${SPARK_SVG}</span>
        <span class="responses__hint-text">Проверьте отклики через минуту или подождите уведомление</span>
      </div>
      <div class="responses__hint">
        <span class="responses__hint-icon responses__hint-icon--info" aria-hidden="true">${INFO_SVG}</span>
        <span class="responses__hint-text">Маршрут и комментарий уже видны водителям рядом</span>
      </div>
    </div>
  `;
}

function renderAllDeclinedNotice() {
  return `
    <div class="responses__notice responses__notice--danger" role="status">
      <span class="responses__notice-icon" aria-hidden="true">${CLOSE_SVG}</span>
      <div class="responses__notice-body">
        <div class="responses__notice-title">Все отклики отклонены</div>
        <div class="responses__notice-text">Поднимите цену или дождитесь новых откликов — заказ остаётся опубликованным.</div>
      </div>
    </div>
  `;
}

function renderList(drivers, selectedDriverId, allDeclined) {
  return `
    <div class="responses__toolbar">
      <div class="responses__count">
        <span class="responses__count-badge">${escapeHtml(String(drivers.length))}</span>
        <span class="responses__count-label">${escapeHtml(responsesWord(drivers.length))}</span>
      </div>
      <div class="responses__status">
        <span class="responses__status-dot" aria-hidden="true"></span>
        <span>Принимаем отклики</span>
      </div>
      <button type="button" class="responses__sort" id="responses-sort">
        ${SPARK_SVG}
        <span>Лучшие</span>
        ${CHEVRON_SVG}
      </button>
    </div>
    ${allDeclined ? renderAllDeclinedNotice() : ''}
    <div class="responses__drivers">
      ${drivers.map((d) => renderDriverCard(d, selectedDriverId, allDeclined)).join('')}
    </div>
  `;
}


function renderOffer(driver) {
  return `
    <div class="responses__offer-intro">
      <span class="responses__offer-chip">Отклик водителя</span>
      <h2 class="responses__offer-title">Водитель готов поехать</h2>
      <p class="responses__offer-copy">Сравните цену, подачу и автомобиль. После выбора откроется маршрут поездки.</p>
    </div>
    <div class="responses__drivers responses__drivers--single">
      <article class="responses__driver responses__driver--best responses__driver--offer"
               data-driver-id="${escapeHtml(driver.id)}"
               data-response-id="${escapeHtml(driver.responseId)}">
        <div class="responses__driver-head">
          <div class="responses__avatar responses__avatar--${escapeHtml(driver.avatarTone)}" aria-hidden="true">${escapeHtml(driver.initials)}</div>
          <div class="responses__driver-info">
            <div class="responses__driver-line">
              <span class="responses__driver-name">${escapeHtml(driver.name)}</span>
              <span class="responses__driver-rating">${STAR_SVG}<span>${escapeHtml(driver.rating)}</span></span>
            </div>
            <div class="responses__driver-car">${escapeHtml(driver.car)}</div>
            <div class="responses__driver-meta">
              <span>${escapeHtml(driver.plate)}</span>
              <span class="responses__driver-dot" aria-hidden="true">·</span>
              <span>${escapeHtml(driver.trips)}</span>
            </div>
          </div>
        </div>
        <div class="responses__driver-stats">
          <div class="responses__stat">
            <div class="responses__stat-label">Предложение</div>
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
        <div class="responses__driver-note">
          <span class="responses__driver-note-icon" aria-hidden="true">${QUOTE_SVG}</span>
          <span class="responses__driver-note-text">${escapeHtml(driver.note || 'Готов подъехать к точке подачи.')}</span>
        </div>
        <div class="responses__offer-actions">
          <button type="button" class="bd-btn primary responses__offer-select" data-action="select">
            ${CHECK_SVG}
            <span>Выбрать водителя</span>
          </button>
          <button type="button" class="bd-btn responses__offer-secondary" data-action="chat">
            ${CHAT_SVG}
            <span>Написать</span>
          </button>
          <button type="button" class="bd-btn responses__offer-secondary" data-action="call">
            ${PHONE_SVG}
            <span>Позвонить</span>
          </button>
        </div>
      </article>
    </div>
  `;
}

// BD-MAP-05 — passenger-facing status copy keyed off the UI-only response
// state. Watching replies is view-only; choosing a driver performs the
// same local handoff into active ride that the passenger can safely review.
// Each entry feeds both the topbar subtitle and the compact status chip.
const RESPONSE_STATUS = {
  empty: {
    subtitle: 'Ищем водителей',
    chip: 'Ищем водителей',
    tone: 'searching',
  },
  offer: {
    subtitle: 'Отклик водителя',
    chip: 'Отклик водителя',
    tone: 'active',
  },
  list: {
    subtitle: 'Есть отклики',
    chip: 'Есть отклики',
    tone: 'active',
  },
  selected: {
    subtitle: 'Водитель выбран',
    chip: 'Водитель выбран',
    tone: 'selected',
  },
  'all-declined': {
    subtitle: 'Отклики отклонены',
    chip: 'Отклики отклонены',
    tone: 'declined',
  },
};

function responseStatus(state) {
  return RESPONSE_STATUS[state] || RESPONSE_STATUS.empty;
}

function renderStatusChip(status) {
  return `
    <div class="responses__status-chip responses__status-chip--${escapeHtml(status.tone)}" role="status">
      <span class="responses__status-chip-dot" aria-hidden="true"></span>
      <span class="responses__status-chip-text">${escapeHtml(status.chip)}</span>
    </div>
  `;
}

function activeRideUrl(tripId) {
  const params = new URLSearchParams();
  params.set('role', 'passenger');
  params.set('tripId', tripId);
  params.set('status', RIDE_STATUS.DRIVER_EN_ROUTE);
  return `/active-ride?${params.toString()}`;
}

function driverInitials(driver) {
  return driver.initials || String(driver.name || 'В').trim().charAt(0).toUpperCase() || 'В';
}

function passengerSnapshot(order) {
  const snap = order && typeof order.passenger === 'object' && order.passenger ? order.passenger : null;
  if (snap && typeof snap.name === 'string' && snap.name.trim()) {
    return { ...snap, name: snap.name.trim() };
  }
  return {
    name: 'Вы',
    initials: 'В',
    phoneMasked: '',
    note: typeof order?.comment === 'string' ? order.comment : '',
    isCurrentUser: true,
  };
}

function buildPassengerActiveRide(order, request, driver) {
  const sourceOrderId = order && order.id ? String(order.id) : '';
  const requestOrderId = request && request.orderId ? String(request.orderId) : '';
  const orderId = sourceOrderId || requestOrderId;
  const tripId = `trip_${orderId}`;
  const existingRide = findActiveRide(tripId);
  if (existingRide) {
    return { tripId, ride: existingRide, reused: true };
  }

  const accepted = order && order.status === 'CREATED' ? acceptOrder(order.id) : order;
  const sourceOrder = accepted || order;
  const now = new Date().toISOString();
  const ride = createDemoActiveRide({
    tripId,
    role: 'passenger',
    status: RIDE_STATUS.DRIVER_EN_ROUTE,
    driver: {
      id: driver.id,
      name: driver.name,
      initials: driverInitials(driver),
      rating: driver.rating,
      phoneMasked: '+7 ... 45-67',
    },
    vehicle: {
      model: driver.carModel || driver.car,
      color: driver.carColor || '',
      plate: driver.plate,
    },
    passenger: passengerSnapshot(sourceOrder),
    order: {
      offerPrice: driver.price || request.price,
      pickupEta: driver.eta,
      destinationEta: sourceOrder?.durationMin ? `${sourceOrder.durationMin} мин` : '28 мин',
      destinationDistance: sourceOrder?.distanceKm ? `${sourceOrder.distanceKm} км` : '—',
      passengerComment: request.note,
    },
    route: {
      pickupLabel: request.pickupLabel,
      dropoffLabel: request.dropoffLabel,
      etaToPickup: driver.eta,
      etaToDestination: sourceOrder?.durationMin ? `${sourceOrder.durationMin} мин` : '28 мин',
      pickup: sourceOrder?.pickup || null,
      dropoff: sourceOrder?.dropoff || null,
    },
    ride: {
      price: driver.price || request.price,
    },
    timestamps: {
      acceptedAt: sourceOrder?.acceptedAt || now,
    },
  });
  // Replace the demo passenger entirely so the active ride preserves the
  // order passenger snapshot without inherited seed fields.
  ride.passenger = passengerSnapshot(sourceOrder);
  ride.orderId = orderId;
  ride.selectedDriver = {
    id: driver.id,
    responseId: driver.responseId,
    name: driver.name,
    rating: driver.rating,
    car: driver.car,
    plate: driver.plate,
    eta: driver.eta,
    price: driver.price,
    note: driver.note,
  };
  saveActiveRide(ride);
  return { tripId, ride };
}

function responseUrl(request, state, driverId = '') {
  const params = new URLSearchParams();
  params.set('orderId', request.orderId);
  params.set('state', state);
  if (driverId) params.set('driverId', driverId);
  return `/responses?${params.toString()}`;
}

export default function responses() {
  const explicitOrderId = getRouteParam('orderId') || '';
  const canonicalOrder = resolveCanonicalOrder();
  const request = requestFromOrder(canonicalOrder, explicitOrderId);
  const postId = request.orderId;
  const state = getRouteParam('state') || 'empty';
  const drivers = buildDrivers(request);

  const isAllDeclined = state === 'all-declined';
  const isOffer = state === 'offer';
  const isList = state === 'list' || state === 'selected' || isAllDeclined;
  const routeDriverId = state === 'selected' ? getRouteParam('driverId') : null;
  const selectedDriver = routeDriverId ? drivers.find((d) => d.id === routeDriverId) : null;
  const selectedDriverId = selectedDriver ? selectedDriver.id : null;

  const root = document.createElement('section');
  root.className = 'screen screen--responses';
  root.dataset.postId = postId;
  root.dataset.orderId = request.orderId;
  root.dataset.state = state;
  root.dataset.source = canonicalOrder ? 'ride-order' : 'mock';

  const status = responseStatus(state);
  const subTitle = status.subtitle;
  const footer = (isList || isOffer) ? '' : `
    <div class="responses__footer responses__footer--in-scroll">
      <button type="button" class="bd-btn primary responses__cta" id="responses-check">
        <span>Проверить отклики</span>
      </button>
      <button type="button" class="bd-btn responses__cta responses__cta--secondary" id="responses-map">
        ${PENCIL_SVG}
        <span>Изменить заказ</span>
      </button>
    </div>`;

  root.innerHTML = `
    <div class="responses__topbar">
      <button type="button" class="responses__icon-btn" id="responses-back" aria-label="Назад">${BACK_SVG}</button>
      <div class="responses__titles">
        <div class="responses__title">Отклики водителей</div>
        <div class="responses__sub">${escapeHtml(subTitle)}</div>
      </div>
      <button type="button" class="responses__icon-btn" id="responses-shield" aria-label="Безопасность">${SHIELD_SVG}</button>
    </div>

    <div class="bd-scroll responses__scroll">
      <div class="bd-card responses__request" aria-label="Ваш опубликованный заказ">
        ${renderStatusChip(status)}
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
        ${renderOrderMeta(request)}
        <div class="responses__request-foot">
          <div class="responses__note">
            ${INFO_SVG}
            <span>${escapeHtml(request.note)}</span>
          </div>
          <button type="button" class="responses__edit" id="responses-edit">
            ${PENCIL_SVG}
            <span>На карту</span>
          </button>
        </div>
      </div>
      ${isOffer ? renderOffer(drivers[0]) : (isList ? renderList(drivers, selectedDriverId, isAllDeclined) : renderEmptyState())}
      ${footer}
    </div>

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
    go('/order-map-draft');
  });

  const checkBtn = root.querySelector('#responses-check');
  if (checkBtn) {
    checkBtn.addEventListener('click', () => {
      go(responseUrl(request, 'offer'));
    });
  }

  const mapBtn = root.querySelector('#responses-map');
  if (mapBtn) {
    mapBtn.addEventListener('click', () => {
      go('/order-map-draft');
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
      const driverId = card.dataset.driverId;
      const responseId = card.dataset.responseId;
      const action = btn.dataset.action;

      if (action === 'select') {
        const driver = drivers.find((d) => d.id === driverId) || drivers[0];
        const handoff = buildPassengerActiveRide(canonicalOrder, request, driver);
        go(activeRideUrl(handoff.tripId));
        return;
      }
      if (action === 'cancel') {
        go(responseUrl(request, 'list'));
        return;
      }
      if (action === 'restore') {
        go(responseUrl(request, 'list'));
        return;
      }
      if (action === 'chat') {
        go(`/chat?responseId=${encodeURIComponent(responseId)}&orderId=${encodeURIComponent(request.orderId)}`);
        return;
      }
      if (action === 'call') {
        toast('Звонок будет доступен после подтверждения поездки');
        return;
      }
      if (action === 'decline') {
        toast('Отклонение отклика будет добавлено позже');
      }
    });
  }

  if (state === 'selected' && !selectedDriver) {
    queueMicrotask(() => toast('Этап подтверждения водителя будет добавлен позже'));
  }

  queueMicrotask(markFeedTabActive);

  return root;
}
