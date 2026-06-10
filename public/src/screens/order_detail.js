// BD-ORDER-DETAIL-01C — /order/<id> runtime shell.
//
// Read/render only. All mutating Model-B actions are deferred to
// BD-ORDER-DETAIL-01D and are represented here as deterministic,
// non-mutating toast stubs.

import { escapeHtml } from '../util.js';
import { go } from '../router.js';
import { user } from '../state.js';
import { applySmokeRole } from '../smoke_role.js';

export const SELF_DRIVER_ID = 'demo-driver-self';

export const ORDER_STATUS = Object.freeze({
  CREATED:  'CREATED',
  ACCEPTED: 'ACCEPTED',
  CANCELED: 'CANCELED',
  EXPIRED:  'EXPIRED',
});

export const ROLE_CHIP = Object.freeze({
  passenger: 'Ваш заказ',
  driver:    'Просмотр водителя',
});

export const STATE_CHIP = Object.freeze({
  P1: 'Ждём водителя',
  P2: 'Есть предложения',
  P3: 'Заказ принят',
  D2: 'Оффер отправлен',
  D3: 'Заказ принят',
  D4: 'Недоступен',
  S1: 'Загружаем заказ',
  S2: 'Заказ не найден',
});

export const DRIVER_PRIMARY_CTA = 'Откликнуться на заказ';
export const STUB_TOAST_ACTION = 'Действие будет подключено в 01D';
export const STUB_TOAST_OFFER  = 'Оффер будет подключён в 01D';

const TS = 1_750_000_000_000;

function offer(overrides = {}) {
  return {
    id: 'offer-default',
    orderId: null,
    driverId: 'driver-x',
    driverName: 'Рустам К.',
    car: 'Toyota Camry · серый',
    rating: '4,92',
    etaMin: 5,
    price: 1200,
    message: 'Подъеду через 5 минут',
    status: 'sent',
    createdAt: TS,
    expiresAt: TS + 15 * 60_000,
    ...overrides,
  };
}

export const DEMO_ORDERS = Object.freeze({
  'demo-order-1': {
    id: 'demo-order-1',
    status: ORDER_STATUS.CREATED,
    passengerId: 'demo-passenger-anna',
    passengerName: 'Анна М.',
    selectedDriverId: null,
    pickup: 'ул. Малая Бронная, 28',
    dropoff: 'Аэропорт Шереметьево, терминал B',
    time: 'Сегодня, 14:30',
    estimatedPrice: 1500,
    budget: 1500,
    comment: '1 чемодан',
    offers: [],
    createdAt: TS,
  },
  'demo-order-offers': {
    id: 'demo-order-offers',
    status: ORDER_STATUS.CREATED,
    passengerId: 'demo-passenger-ivan',
    passengerName: 'Иван П.',
    selectedDriverId: null,
    pickup: 'ул. Тверская, 12',
    dropoff: 'м. Парк Победы',
    time: 'Сегодня, 15:00',
    estimatedPrice: 800,
    budget: 800,
    comment: '',
    offers: [
      offer({
        id: 'offer-1',
        orderId: 'demo-order-offers',
        driverId: 'driver-1',
        driverName: 'Рустам К.',
        car: 'Toyota Camry · серый',
        rating: '4,92',
        etaMin: 4,
        price: 750,
        message: 'Подъеду через 4 минуты',
      }),
      offer({
        id: 'offer-2',
        orderId: 'demo-order-offers',
        driverId: 'driver-2',
        driverName: 'Алексей Г.',
        car: 'Hyundai Solaris · белый',
        rating: '4,88',
        etaMin: 7,
        price: 950,
        message: 'Готов выехать сейчас',
      }),
    ],
    createdAt: TS,
  },
  'demo-order-accepted': {
    id: 'demo-order-accepted',
    status: ORDER_STATUS.ACCEPTED,
    passengerId: 'demo-passenger-olga',
    passengerName: 'Ольга С.',
    selectedDriverId: SELF_DRIVER_ID,
    pickup: 'ул. Покровка, 5',
    dropoff: 'Курский вокзал',
    time: 'Сегодня, 16:00',
    estimatedPrice: 1200,
    budget: 1200,
    comment: 'Жду у подъезда',
    tripId: 'trip_demo-order-accepted',
    offers: [
      offer({
        id: 'offer-acc',
        orderId: 'demo-order-accepted',
        driverId: SELF_DRIVER_ID,
        driverName: 'Вы (демо)',
        status: 'accepted',
        price: 1180,
      }),
    ],
    createdAt: TS,
  },
  'demo-order-terminal': {
    id: 'demo-order-terminal',
    status: ORDER_STATUS.CANCELED,
    passengerId: 'demo-passenger-pavel',
    passengerName: 'Павел К.',
    selectedDriverId: null,
    pickup: 'Кутузовский, 24',
    dropoff: 'Останкино',
    time: 'Сегодня, 12:00',
    estimatedPrice: 900,
    budget: 900,
    comment: '',
    offers: [],
    createdAt: TS,
    lockedReason: 'order_canceled',
  },
  'demo-order-expired': {
    id: 'demo-order-expired',
    status: ORDER_STATUS.EXPIRED,
    passengerId: 'demo-passenger-timur',
    passengerName: 'Тимур Р.',
    selectedDriverId: null,
    pickup: 'Петровка, 38',
    dropoff: 'Белорусский вокзал',
    time: 'Вчера, 22:00',
    estimatedPrice: 1000,
    budget: 1000,
    comment: '',
    offers: [],
    createdAt: TS,
    lockedReason: 'order_expired',
  },
  'demo-order-locked': {
    id: 'demo-order-locked',
    status: ORDER_STATUS.ACCEPTED,
    passengerId: 'demo-passenger-elena',
    passengerName: 'Елена Т.',
    selectedDriverId: 'other-driver-99',
    pickup: 'Ленинградский пр., 39',
    dropoff: 'Шоссе Энтузиастов',
    time: 'Сегодня, 17:30',
    estimatedPrice: 1100,
    budget: 1100,
    comment: '',
    offers: [],
    createdAt: TS,
    lockedReason: 'passenger_chose_other',
  },
});

const LOCK_REASON_LABEL = Object.freeze({
  passenger_chose_other: 'Пассажир выбрал другого водителя',
  order_already_taken:   'Заказ уже принят',
  order_canceled:        'Заказ отменён',
  order_expired:         'Заказ истёк',
});

export function parseOrderHashPath(rawHash) {
  const hash = (rawHash || '').replace(/^#/, '');
  const queryAt = hash.indexOf('?');
  const path = queryAt === -1 ? hash : hash.slice(0, queryAt);
  const query = queryAt === -1 ? '' : hash.slice(queryAt + 1);
  const m = path.match(/^\/order\/([^/?#]+)/);
  return {
    id: m ? decodeURIComponent(m[1]) : null,
    query: new URLSearchParams(query),
  };
}

export function resolveRoleFromQuery(query, currentUser) {
  const explicit = (query && typeof query.get === 'function' ? query.get('role') : null) || '';
  if (explicit === 'driver' || explicit === 'passenger') return explicit;
  const u = currentUser && typeof currentUser === 'object' ? currentUser : {};
  return u.role === 'driver' ? 'driver' : 'passenger';
}

export function loadOrder(id) {
  if (!id || typeof id !== 'string') return null;
  const fixture = DEMO_ORDERS[id];
  return fixture ? { ...fixture, offers: (fixture.offers || []).map((o) => ({ ...o })) } : null;
}

export function resolveState(order, role) {
  if (!order) return 'S2';
  if (order.__loading) return 'S1';
  const status = order.status;

  if (role === 'driver') {
    if (status === ORDER_STATUS.CANCELED || status === ORDER_STATUS.EXPIRED) return 'D4';
    if (status === ORDER_STATUS.ACCEPTED) {
      return order.selectedDriverId === SELF_DRIVER_ID ? 'D3' : 'D4';
    }
    const ownOffer = (order.offers || []).find(
      (o) => o && o.driverId === SELF_DRIVER_ID && o.status === 'sent');
    return ownOffer ? 'D2' : 'D1';
  }

  if (status === ORDER_STATUS.CANCELED || status === ORDER_STATUS.EXPIRED) return 'P4';
  if (status === ORDER_STATUS.ACCEPTED) return 'P3';
  return (order.offers || []).length > 0 ? 'P2' : 'P1';
}

export function resolveStateChip(state, order) {
  if (state === 'P4') {
    return order && order.status === ORDER_STATUS.EXPIRED ? 'Истёк' : 'Отменён';
  }
  return STATE_CHIP[state] || '';
}

function formatRub(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
}

function badge(text, modifier = '') {
  const cls = `od-chip${modifier ? ' od-chip--' + modifier : ''}`;
  return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

function routeSummary(order = {}) {
  return `
    <div class="od-route" role="group" aria-label="Маршрут">
      <div class="od-route__row od-route__row--pickup"><span class="od-route__label">Откуда</span><span class="od-route__value">${escapeHtml(order.pickup || '')}</span></div>
      <div class="od-route__row od-route__row--dropoff"><span class="od-route__label">Куда</span><span class="od-route__value">${escapeHtml(order.dropoff || '')}</span></div>
      ${order.time ? `<div class="od-route__row"><span class="od-route__label">Когда</span><span class="od-route__value">${escapeHtml(order.time)}</span></div>` : ''}
    </div>`;
}

function priceLine(order = {}) {
  return `
    <div class="od-price">
      <span class="od-price__label">Бюджет</span>
      <span class="od-price__value">${escapeHtml(formatRub(order.budget))}</span>
    </div>`;
}

function commentLine(order = {}) {
  return order.comment
    ? `<div class="od-comment"><span class="od-comment__label">Комментарий</span><span class="od-comment__value">${escapeHtml(order.comment)}</span></div>`
    : '';
}

function actionsRow(buttons) {
  const html = buttons.map((button) => {
    const variant = button.variant ? ` ${button.variant}` : '';
    const action = button.dataAction ? ` data-action="${escapeHtml(button.dataAction)}"` : '';
    const offerId = button.offerId ? ` data-offer-id="${escapeHtml(button.offerId)}"` : '';
    const disabled = button.disabled ? ' disabled' : '';
    return `<button type="button" class="bd-btn od-action${variant}"${action}${offerId}${disabled}>${escapeHtml(button.label)}</button>`;
  }).join('');
  return `<div class="od-actions">${html}</div>`;
}

function emptyOffersPanel() {
  return `
    <div class="od-empty-offers" role="status" aria-live="polite">
      <div class="od-empty-offers__title">Пока нет предложений</div>
      <div class="od-empty-offers__sub">Водители увидят ваш заказ и пришлют офферы.</div>
    </div>`;
}

function offerCard(off, order) {
  const overBudget = typeof off.price === 'number'
    && typeof order.budget === 'number'
    && off.price > order.budget;
  return `
    <article class="od-offer" data-offer-id="${escapeHtml(off.id)}" role="listitem">
      <header class="od-offer__head"><div class="od-offer__name">${escapeHtml(off.driverName || '')}</div><div class="od-offer__rating">★ ${escapeHtml(off.rating || '')}</div></header>
      <div class="od-offer__car">${escapeHtml(off.car || '')}</div>
      <div class="od-offer__meta"><span>${escapeHtml(off.etaMin != null ? off.etaMin + ' мин' : '')}</span><span class="od-offer__price">${escapeHtml(formatRub(off.price))}</span>${overBudget ? '<span class="od-chip od-chip--warn">Выше бюджета</span>' : ''}</div>
      ${off.message ? `<div class="od-offer__msg">${escapeHtml(off.message)}</div>` : ''}
      ${actionsRow([
        { label: 'Выбрать водителя', dataAction: 'select-driver', offerId: off.id, variant: 'primary' },
        { label: 'Написать', dataAction: 'message-driver', offerId: off.id },
        { label: 'Отклонить', dataAction: 'reject-offer', offerId: off.id, variant: 'ghost' },
      ])}
    </article>`;
}

function bodyP1(order) {
  return `
    ${routeSummary(order)}
    ${priceLine(order)}
    ${commentLine(order)}
    ${emptyOffersPanel()}
    ${actionsRow([
      { label: 'Изменить', dataAction: 'edit-order' },
      { label: 'Отменить заказ', dataAction: 'cancel-order', variant: 'ghost' },
      { label: 'Поделиться', dataAction: 'share-order' },
      { label: 'Скопировать', dataAction: 'copy-order' },
    ])}`;
}

function bodyP2(order) {
  const offers = (order.offers || []).map((o) => offerCard(o, order)).join('');
  return `
    ${routeSummary(order)}
    ${priceLine(order)}
    ${commentLine(order)}
    <div class="od-offers" role="list" aria-label="Предложения водителей">${offers}</div>`;
}

function bodyP3(order) {
  const assigned = (order.offers || []).find((o) => o.status === 'accepted')
    || (order.offers || [])[0]
    || { driverName: 'Назначенный водитель', car: '', rating: '', price: order.budget };
  return `
    ${routeSummary(order)}
    <div class="od-driver-card"><div class="od-driver-card__name">${escapeHtml(assigned.driverName || '')}</div><div class="od-driver-card__car">${escapeHtml(assigned.car || '')}</div><div class="od-driver-card__meta">★ ${escapeHtml(assigned.rating || '')} · ${escapeHtml(formatRub(assigned.price))}</div></div>
    <ol class="od-timeline" role="list" aria-label="Этапы поездки"><li class="od-timeline__step od-timeline__step--done">Заказ создан</li><li class="od-timeline__step od-timeline__step--done">Водитель выбран</li><li class="od-timeline__step od-timeline__step--current">Открыть поездку</li></ol>
    ${actionsRow([{ label: 'Открыть поездку', dataAction: 'open-trip', variant: 'primary' }])}`;
}

function bodyP4(order) {
  const terminalText = order.status === ORDER_STATUS.EXPIRED
    ? 'Заказ истёк. Создайте новый.'
    : 'Заказ отменён.';
  return `
    ${routeSummary(order)}
    <div class="od-terminal" role="status" aria-live="polite"><div class="od-terminal__title">Поездка закрыта</div><div class="od-terminal__text">${escapeHtml(terminalText)}</div></div>
    ${actionsRow([
      { label: 'Создать новый заказ', dataAction: 'create-new-order', variant: 'primary' },
      { label: 'Вернуться в ленту', dataAction: 'back-to-feed', variant: 'ghost' },
    ])}`;
}

function bodyD1(order) {
  return `
    ${routeSummary(order)}
    ${priceLine(order)}
    ${commentLine(order)}
    <div class="od-passenger-line">Пассажир: ${escapeHtml(order.passengerName || '')}</div>
    ${actionsRow([
      { label: DRIVER_PRIMARY_CTA, dataAction: 'driver-send-offer', variant: 'primary' },
      { label: 'Написать', dataAction: 'message-passenger' },
      { label: 'Скрыть', dataAction: 'hide-order', variant: 'ghost' },
      { label: 'Пожаловаться', dataAction: 'report-order', variant: 'ghost' },
    ])}`;
}

function bodyD2(order) {
  const ownOffer = (order.offers || []).find((o) => o.driverId === SELF_DRIVER_ID)
    || { price: 1000, etaMin: 5, message: '' };
  return `
    ${routeSummary(order)}
    <div class="od-offer-summary"><div class="od-offer-summary__row"><span>Ваша цена</span><strong>${escapeHtml(formatRub(ownOffer.price))}</strong></div><div class="od-offer-summary__row"><span>ETA</span><strong>${escapeHtml(String(ownOffer.etaMin || ''))} мин</strong></div>${ownOffer.message ? `<div class="od-offer-summary__msg">${escapeHtml(ownOffer.message)}</div>` : ''}</div>
    <div class="od-waiting" role="status" aria-live="polite">Ждём, когда пассажир выберет водителя.</div>
    ${actionsRow([
      { label: 'Изменить оффер', dataAction: 'edit-offer' },
      { label: 'Отозвать оффер', dataAction: 'withdraw-offer', variant: 'ghost' },
      { label: 'Написать', dataAction: 'message-passenger' },
    ])}`;
}

function bodyD3(order) {
  return `
    ${routeSummary(order)}
    <div class="od-passenger-line">Пассажир: ${escapeHtml(order.passengerName || '')}</div>
    ${actionsRow([
      { label: 'Начать подачу', dataAction: 'driver-start-pickup', variant: 'primary' },
      { label: 'Открыть активную поездку', dataAction: 'open-active-ride' },
      { label: 'Написать', dataAction: 'message-passenger' },
      { label: 'Отменить', dataAction: 'driver-cancel', variant: 'ghost' },
    ])}`;
}

function bodyD4(order) {
  const reasonText = LOCK_REASON_LABEL[order.lockedReason]
    || (order.status === ORDER_STATUS.EXPIRED ? LOCK_REASON_LABEL.order_expired : 'Заказ недоступен для отклика.');
  return `
    ${routeSummary(order)}
    <div class="od-locked" role="status" aria-live="polite"><div class="od-locked__title">Заказ недоступен</div><div class="od-locked__reason">${escapeHtml(reasonText)}</div></div>
    ${actionsRow([
      { label: 'Найти другие заказы', dataAction: 'find-other-orders', variant: 'primary' },
      { label: 'Вернуться в ленту', dataAction: 'back-to-feed', variant: 'ghost' },
    ])}`;
}

function bodyS1() {
  return `
    <div class="od-loading" role="status" aria-live="polite"><div class="od-loading__spinner" aria-hidden="true"></div><div class="od-loading__text">Загружаем заказ…</div></div>`;
}

function bodyS2() {
  return `
    <div class="od-error" role="status" aria-live="polite"><div class="od-error__title">Заказ не найден</div><div class="od-error__text">Проверьте ссылку или вернитесь к ленте, чтобы найти другие заказы.</div></div>
    ${actionsRow([
      { label: 'Вернуться в ленту', dataAction: 'back-to-feed', variant: 'primary' },
      { label: 'Найти другие заказы', dataAction: 'find-other-orders' },
    ])}`;
}

const BODY_BY_STATE = Object.freeze({
  P1: bodyP1,
  P2: bodyP2,
  P3: bodyP3,
  P4: bodyP4,
  D1: bodyD1,
  D2: bodyD2,
  D3: bodyD3,
  D4: bodyD4,
  S1: bodyS1,
  S2: bodyS2,
});

export function renderOrderDetailMarkup({ order, role, state }) {
  const roleChip = ROLE_CHIP[role] || ROLE_CHIP.passenger;
  const stateChip = resolveStateChip(state, order);
  const stateBody = (BODY_BY_STATE[state] || bodyS2)(order || {});
  const orderId = order && order.id ? order.id : '';
  return `
    <section class="screen screen--order-detail od" data-state="${escapeHtml(state)}" data-role="${escapeHtml(role)}" data-order-id="${escapeHtml(orderId)}">
      <header class="od-top">
        <button type="button" class="od-back" data-action="back-to-feed" aria-label="Назад в ленту">‹</button>
        <div class="od-top__chips">${badge(roleChip, 'role-' + role)}${stateChip ? badge(stateChip, 'state-' + String(state).toLowerCase()) : ''}</div>
      </header>
      <div class="od-body">${stateBody}</div>
      <div class="od-notice" role="status" aria-live="polite" hidden></div>
    </section>`;
}

function showNotice(root, msg) {
  const el = root.querySelector('.od-notice');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  if (el.__timer) clearTimeout(el.__timer);
  el.__timer = setTimeout(() => {
    el.hidden = true;
    el.textContent = '';
  }, 3000);
}

const STUB_ROUTES_BACK_TO_FEED = new Set([
  'back-to-feed',
  'find-other-orders',
  'create-new-order',
]);

function bindEvents(rootEl, { order, role }) {
  rootEl.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (STUB_ROUTES_BACK_TO_FEED.has(action)) {
      if (action === 'find-other-orders' && role === 'driver') {
        go('/driver-map');
        return;
      }
      if (action === 'create-new-order') {
        go('/new');
        return;
      }
      go('/feed');
      return;
    }

    if (action === 'open-trip' || action === 'open-active-ride') {
      const tripId = order && order.tripId;
      if (tripId) {
        go(`/active-ride?role=${role}&tripId=${encodeURIComponent(tripId)}`);
        return;
      }
      showNotice(rootEl, STUB_TOAST_ACTION);
      return;
    }

    if (action === 'driver-send-offer') {
      showNotice(rootEl, STUB_TOAST_OFFER);
      return;
    }

    showNotice(rootEl, STUB_TOAST_ACTION);
  });
}

export default function orderDetail() {
  const { id, query } = parseOrderHashPath(window.location.hash || '');
  const role = resolveRoleFromQuery(query, applySmokeRole(user.get()));
  const stateOverride = (query.get('state') || '').toLowerCase();
  const order = stateOverride === 'loading'
    ? { __loading: true, id: id || '' }
    : loadOrder(id);
  const state = resolveState(order, role);
  const host = document.createElement('div');
  host.innerHTML = renderOrderDetailMarkup({ order, role, state });
  const section = host.firstElementChild;
  bindEvents(section, { order, role, state });
  return section;
}
