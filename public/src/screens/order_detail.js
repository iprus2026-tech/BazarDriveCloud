// BD-ORDER-DETAIL-01C — /order/<id> runtime shell.
//
// Read/render only. All mutating Model-B actions are deferred to
// BD-ORDER-DETAIL-01D and are represented here as deterministic,
// non-mutating toast stubs.

import { escapeHtml } from '../util.js';
import { go } from '../router.js';
import { user } from '../state.js';
import { applySmokeRole } from '../smoke_role.js';
import {
  sendDriverOffer,
  withdrawDriverOffer,
  listDriverOffersForOrder,
  getDriverOffer,
  commitPassengerSelection,
  cancelOrderByPassenger,
  cancelOrderByDriver,
  rejectDriverOfferByPassenger,
  rejectSentOffersForPassengerCanceledOrder,
  getOrderOverlay,
} from '../driver_offer_store.js';
import {
  RIDE_STATUS,
  findActiveRide,
  saveActiveRide,
} from '../ride_state.js';

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
  P3: 'Водитель выбран',
  D2: 'Оффер отправлен',
  D3: 'Заказ принят',
  D4: 'Недоступен',
  S1: 'Загружаем заказ',
  S2: 'Заказ не найден',
});

export const DRIVER_PRIMARY_CTA = 'Откликнуться на заказ';
export const STUB_TOAST_ACTION = 'Действие будет подключено в 01D';
export const STUB_TOAST_OFFER  = 'Оффер будет подключён в 01D';

// BD-ORDER-DETAIL-CHAT-GUARD-01 — state-aware guard notices for the driver
// «Написать» (message-passenger) CTA. Product decision: do NOT create a
// driver→passenger marketplace chat handoff yet; chat stays responseId-only.
// So instead of navigating or inventing a thread, each driver state explains
// when/why messaging opens. Keyed by the resolved driver state (D1/D2/D3).
export const MESSAGE_GUARD_NOTICES = {
  D1: 'Сначала отправьте отклик, чтобы открыть связь с пассажиром.',
  D2: 'Предложение отправлено. Чат откроется после выбора водителя пассажиром.',
  D3: 'Чат поездки будет доступен через активную поездку.',
};

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
  driver_offer_rejected: 'Пассажир отклонил ваш оффер',
});

// BD-ORDER-DETAIL-01C Codex P2 — guard decodeURIComponent against
// malformed percent-encoded ids (e.g. `/order/%E0%A4%A`). The raw
// decode throws URIError, which would propagate out of the loader and
// blank the screen instead of letting the resolver fall through to S2.
function safeDecodeOrderId(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parseOrderHashPath(rawHash) {
  const hash = (rawHash || '').replace(/^#/, '');
  const queryAt = hash.indexOf('?');
  const path = queryAt === -1 ? hash : hash.slice(0, queryAt);
  const query = queryAt === -1 ? '' : hash.slice(queryAt + 1);
  const m = path.match(/^\/order\/([^/?#]+)/);
  return {
    id: m ? safeDecodeOrderId(m[1]) : null,
    query: new URLSearchParams(query),
  };
}

// BD-ORDER-DETAIL-01C Codex P2 — Model B's P2 ("Passenger Has Driver
// Offers") must trigger on *active sent* offers only. Terminal offers
// (`rejected`, `withdrawn`, `expired`) stay in the order's `offers`
// array for history / write-side preservation in 01D, but they do NOT
// count as selectable candidates and must not trip P2.
export function activeSentOffers(order) {
  return (order?.offers || []).filter((o) => o?.status === 'sent');
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
  if (!fixture) return null;
  // Clone fixture + merge in live DriverOffers from the local store
  // (BD-ORDER-DETAIL-01D-1). The store is keyed by (orderId, driverId);
  // when a stored offer collides with a fixture offer for the same
  // driverId, the stored version wins because it carries the latest
  // user action (sent / withdrawn / accepted / rejected).
  const fixtureOffers = (fixture.offers || []).map((o) => ({ ...o }));
  const stored = listDriverOffersForOrder(id);
  let mergedOffers;
  if (stored.length) {
    const seen = new Set();
    const merged = [];
    for (const o of stored) {
      seen.add(o.driverId);
      merged.push({ ...o });
    }
    for (const o of fixtureOffers) {
      if (!seen.has(o.driverId)) merged.push(o);
    }
    mergedOffers = merged;
  } else {
    mergedOffers = fixtureOffers;
  }
  // BD-ORDER-DETAIL-01D-2A — apply the order overlay so passenger
  // commits (`Order.status='ACCEPTED'` + `selectedDriverId`) surface
  // on subsequent reads. Only `status` and `selectedDriverId` flow
  // from the overlay; every other field stays canonical.
  const overlay = getOrderOverlay(id);
  const base = { ...fixture, offers: mergedOffers };
  if (overlay) {
    if (typeof overlay.status === 'string' && overlay.status) {
      base.status = overlay.status;
    }
    if (typeof overlay.selectedDriverId === 'string' && overlay.selectedDriverId) {
      base.selectedDriverId = overlay.selectedDriverId;
    }
    // BD-ORDER-DETAIL-01D-2D — surface the cancel actor so bodyP4 can
    // differentiate «Заказ отменён.» (passenger / system) from
    // «Водитель отменил заказ.» (assigned driver). The driver D4
    // surface keeps the generic `order_canceled` lockedReason copy
    // regardless of actor.
    if (typeof overlay.canceledBy === 'string' && overlay.canceledBy) {
      base.canceledBy = overlay.canceledBy;
    }
  }
  // BD-ORDER-DETAIL-01D-2C-B — lockedReason precedence on D4:
  //   1. fixture-set lockedReason (e.g. demo-order-locked carries
  //      'passenger_chose_other') always wins.
  //   2. runtime ACCEPTED with selectedDriverId !== SELF surfaces
  //      'passenger_chose_other' — the order is taken by someone else,
  //      which is the canonical D4 reason for that flow (so D4 shows
  //      «Пассажир выбрал другого водителя» instead of the generic
  //      «Заказ недоступен для отклика.» fallback). SELF-selected
  //      ACCEPTED orders route to D3 and never read this label.
  //   3. runtime CANCELED → 'order_canceled' so D4 shows «Заказ отменён».
  //   4. runtime EXPIRED → 'order_expired' so D4 shows «Заказ истёк».
  //   5. only for non-terminal CREATED orders: a passenger-rejected
  //      SELF offer surfaces the 'driver_offer_rejected' reason. Gating
  //      on CREATED prevents the cancel-after-reject path or the
  //      passenger-picked-another-driver path from mislabeling D4 as
  //      «Пассажир отклонил ваш оффер» when the actual reason is the
  //      terminal-order status above.
  if (!base.lockedReason) {
    if (base.status === ORDER_STATUS.ACCEPTED
        && base.selectedDriverId !== SELF_DRIVER_ID) {
      base.lockedReason = 'passenger_chose_other';
    } else if (base.status === ORDER_STATUS.CANCELED) {
      base.lockedReason = 'order_canceled';
    } else if (base.status === ORDER_STATUS.EXPIRED) {
      base.lockedReason = 'order_expired';
    } else if (base.status === ORDER_STATUS.CREATED) {
      const selfRejected = mergedOffers.find(
        (o) => o && o.driverId === SELF_DRIVER_ID
          && o.status === 'rejected'
          && o.rejectedBy === 'passenger');
      if (selfRejected) base.lockedReason = 'driver_offer_rejected';
    }
  }
  return base;
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
    // BD-ORDER-DETAIL-01D-2C-B — passenger rejected the SELF offer.
    // Falling through to D1 would surface an actionable «Откликнуться»
    // CTA whose underlying sendDriverOffer refuses to overwrite a
    // terminal rejected status (so the driver would see a misleading
    // success toast without any state change). Lock the driver into D4
    // with the explicit driver_offer_rejected info reason instead.
    const ownRejectedByPassenger = (order.offers || []).find(
      (o) => o && o.driverId === SELF_DRIVER_ID
        && o.status === 'rejected'
        && o.rejectedBy === 'passenger');
    if (ownRejectedByPassenger) return 'D4';
    const ownOffer = (order.offers || []).find(
      (o) => o && o.driverId === SELF_DRIVER_ID && o.status === 'sent');
    return ownOffer ? 'D2' : 'D1';
  }

  if (status === ORDER_STATUS.CANCELED || status === ORDER_STATUS.EXPIRED) return 'P4';
  if (status === ORDER_STATUS.ACCEPTED) return 'P3';
  return activeSentOffers(order).length > 0 ? 'P2' : 'P1';
}

export function resolveStateChip(state, order) {
  if (state === 'P4') {
    return order && order.status === ORDER_STATUS.EXPIRED ? 'Истёк' : 'Отменён';
  }
  return STATE_CHIP[state] || '';
}

// ── BD-ORDER-DETAIL-01D-2B passenger handoff helpers ─────────────────
//
// `canOpenTrip(order)` is the gate for the «Открыть поездку» CTA in
// P3. It only allows the click through when the order is genuinely
// in the post-commit accepted state and the chosen DriverOffer is
// still selectable / non-stale. `buildPassengerActiveRideSeed(order)`
// constructs the active_ride seed from the merged Order Detail data
// without writing it; the click handler is the only place that calls
// saveActiveRide.

const STALE_OFFER_STATUSES = new Set(['withdrawn', 'expired', 'rejected']);

// Returns true when the merged order is eligible for the passenger
// active-ride handoff. Conditions:
//   • order.status === 'ACCEPTED' (set by 01D-2A commit or fixture)
//   • order.selectedDriverId is a non-empty string
//   • a matching DriverOffer exists in order.offers
//   • that offer's status is 'accepted' (post-commit canonical) or
//     'sent' (fixture path where the offer hasn't been written yet)
//   • the offer is NOT in any terminal/stale status
export function canOpenTrip(order) {
  if (!order || typeof order !== 'object') return false;
  if (order.status !== ORDER_STATUS.ACCEPTED) return false;
  const driverId = order.selectedDriverId;
  if (typeof driverId !== 'string' || driverId.length === 0) return false;
  const offer = (order.offers || []).find(
    (o) => o && typeof o === 'object' && o.driverId === driverId);
  if (!offer) return false;
  if (STALE_OFFER_STATUSES.has(offer.status)) return false;
  return offer.status === 'accepted' || offer.status === 'sent';
}

function initialsFrom(name) {
  if (typeof name !== 'string' || !name.trim()) return '';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('');
}

function formatRubLocal(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
}

// Builds the active_ride seed snapshot from the merged Order Detail
// data. Pure — does not write anything, does not import side-effects.
// The click handler calls saveActiveRide(seed) after a successful
// build. Returns null when canOpenTrip() would refuse (so callers can
// short-circuit on a single check).
export function buildPassengerActiveRideSeed(order) {
  if (!canOpenTrip(order)) return null;
  const driverId = order.selectedDriverId;
  const offer = (order.offers || []).find((o) => o && o.driverId === driverId);
  if (!offer) return null;
  // BD-ORDER-DETAIL-01D-3 — the accepted active-ride seed ALWAYS
  // derives `tripId` canonically from `order.id`. A stale or demo
  // `order.tripId` planted on the merged snapshot (e.g. via a fixture
  // legacy field or a hostile snapshot) is ignored — the canonical
  // handoff key is the only key the active-ride store ever sees.
  const tripId = `trip_${order.id}`;
  const now = new Date().toISOString();
  const priceLabel = formatRubLocal(typeof offer.price === 'number'
    ? offer.price
    : (typeof order.budget === 'number' ? order.budget : null));
  return {
    tripId,
    orderId: order.id,
    role: 'passenger',
    status: RIDE_STATUS.DRIVER_EN_ROUTE,
    selectedDriverId: driverId,
    selectedOfferId: offer.id || null,
    passenger: {
      name: order.passengerName || '',
      initials: initialsFrom(order.passengerName || ''),
      rating: '',
      phoneMasked: '',
      luggage: order.comment || '',
      note: order.comment || '',
    },
    driver: {
      name: offer.driverName || '',
      initials: initialsFrom(offer.driverName || ''),
      rating: offer.rating || '',
      car: offer.car || '',
      onlineLabel: 'На линии',
      shiftDuration: '',
    },
    vehicle: {
      model: offer.car || '',
      color: '',
      plate: '',
    },
    order: {
      offerPrice: priceLabel,
      rate: '',
      commission: '',
      acceptTimerSec: 0,
      pickupEta: offer.etaMin != null ? `${offer.etaMin} мин` : '',
      pickupDistance: '',
      destinationEta: '',
      destinationDistance: '',
      destinationNote: '',
      tags: [],
    },
    route: {
      pickupLabel: order.pickup || '',
      dropoffLabel: order.dropoff || '',
      currentInstruction: '',
      currentStreet: '',
      distanceToPickup: '',
      etaToPickup: offer.etaMin != null ? `${offer.etaMin} мин` : '',
      etaToDestination: '',
    },
    ride: {
      price: priceLabel,
      todayEarnings: '',
      tripsToday: 0,
      rating: '',
    },
    payment: {
      last4: '',
      method: '',
      note: '',
      amount: priceLabel,
    },
    chat: { unread: 0 },
    timestamps: {
      createdAt: now,
      acceptedAt: now,
      arrivedAt: null,
      startedAt: null,
      completedAt: null,
      canceledAt: null,
    },
    seededFrom: 'order_detail_passenger_handoff',
  };
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
  const inBudget = typeof off.price === 'number'
    && typeof order.budget === 'number'
    && off.price <= order.budget;

  // Defensive UI fallbacks: never produce broken "★ " or "Подача  мин".
  const driverName = off.driverName || 'Водитель';
  const initials   = initialsFrom(driverName);
  const rating     = off.rating;
  const car        = off.car || '';
  const hasEta     = off.etaMin != null && off.etaMin !== '';
  const priceText  = formatRub(off.price) || '—';
  const hasExpires = !!off.expiresAt;

  const ratingHtml  = rating
    ? `<div class="od-offer__rating">★ ${escapeHtml(String(rating))}</div>`
    : '';
  const budgetChip  = overBudget
    ? badge('Выше бюджета', 'warn')
    : inBudget ? badge('В бюджете', 'ok') : '';
  const etaHtml     = hasEta
    ? `<div class="od-offer__eta"><span class="od-offer__eta-pill">Подача ${escapeHtml(String(off.etaMin))} мин</span></div>`
    : '';
  const msgHtml     = off.message
    ? `<div class="od-offer__msg">${escapeHtml(off.message)}</div>`
    : '';
  const expiresHtml = hasExpires
    ? `<div class="od-offer__expires">Оффер действует ограниченно</div>`
    : '';

  return `
    <article class="od-offer" data-offer-id="${escapeHtml(off.id)}" role="listitem">
      <div class="od-offer__hero">
        <div class="od-offer__avatar" aria-hidden="true">${escapeHtml(initials)}</div>
        <div class="od-offer__hero-info">
          <div class="od-offer__name">${escapeHtml(driverName)}</div>
          ${ratingHtml}
        </div>
        <div class="od-offer__price-block">
          <div class="od-offer__price">${escapeHtml(priceText)}</div>
          ${budgetChip}
        </div>
      </div>
      ${car ? `<div class="od-offer__car">${escapeHtml(car)}</div>` : ''}
      ${etaHtml}
      ${msgHtml}
      ${expiresHtml}
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
  // Render only active sent candidates. Terminal offers (rejected /
  // withdrawn / expired) stay in `order.offers` but don't surface as
  // selectable cards — see activeSentOffers().
  const offers = activeSentOffers(order).map((o) => offerCard(o, order)).join('');
  return `
    ${routeSummary(order)}
    ${priceLine(order)}
    ${commentLine(order)}
    <div class="od-offers" role="list" aria-label="Предложения водителей">${offers}</div>`;
}

function bodyP3(order) {
  // Only an offer that has actually been `accepted` may pose as the
  // assigned driver. Codex P2 #458: do not fall back to the first
  // offer — a historical rejected / expired / withdrawn offer must
  // never be displayed as the assigned driver. The neutral fallback
  // (no offer at all) is the safe default.
  const assigned = (order.offers || []).find((o) => o.status === 'accepted')
    || { driverName: 'Назначенный водитель', car: '', rating: '', price: order.budget };
  return `
    ${routeSummary(order)}
    <div class="od-driver-card"><div class="od-driver-card__name">${escapeHtml(assigned.driverName || '')}</div><div class="od-driver-card__car">${escapeHtml(assigned.car || '')}</div><div class="od-driver-card__meta">★ ${escapeHtml(assigned.rating || '')} · ${escapeHtml(formatRub(assigned.price))}</div></div>
    <ol class="od-timeline" role="list" aria-label="Этапы поездки"><li class="od-timeline__step od-timeline__step--done">Заказ создан</li><li class="od-timeline__step od-timeline__step--done">Водитель выбран</li><li class="od-timeline__step od-timeline__step--current">Открыть поездку</li></ol>
    ${actionsRow([{ label: 'Открыть поездку', dataAction: 'open-trip', variant: 'primary', disabled: !canOpenTrip(order) }])}`;
}

function bodyP4(order) {
  let terminalText;
  if (order.status === ORDER_STATUS.EXPIRED) {
    terminalText = 'Заказ истёк. Создайте новый.';
  } else if (order.canceledBy === 'driver') {
    terminalText = 'Водитель отменил заказ.';
  } else {
    terminalText = 'Заказ отменён.';
  }
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
    || { price: 1000, etaMin: 5, message: '', driverName: 'Вы (демо)' };
  // Defensive UI fallbacks for the own-offer summary panel.
  const priceText = formatRub(ownOffer.price) || '—';
  const etaText   = ownOffer.etaMin != null && ownOffer.etaMin !== ''
    ? `${ownOffer.etaMin} мин`
    : '—';
  const driverLabel = ownOffer.driverName || 'Вы (демо)';
  return `
    ${routeSummary(order)}
    <div class="od-offer-summary"><div class="od-offer-summary__row"><span>Водитель</span><strong>${escapeHtml(driverLabel)}</strong></div><div class="od-offer-summary__row"><span>Ваша цена</span><strong>${escapeHtml(priceText)}</strong></div><div class="od-offer-summary__row"><span>ETA</span><strong>${escapeHtml(etaText)}</strong></div>${ownOffer.message ? `<div class="od-offer-summary__msg">${escapeHtml(ownOffer.message)}</div>` : ''}</div>
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

// BD-ORDER-DETAIL-01D-1 — rebuild the screen's inner markup after a
// mutating offer write so the new D2/D1 state surfaces without a full
// router re-navigation. We reuse the click delegate already bound to
// `rootEl` by only rewriting innerHTML (the listener stays attached).
function rerenderInPlace(rootEl, ctx) {
  const order = ctx.id ? loadOrder(ctx.id) : null;
  const state = resolveState(order, ctx.role);
  const fresh = renderOrderDetailMarkup({ order, role: ctx.role, state });
  // The renderer returns a full <section> wrapper; we already have one,
  // so swap the inner header + body by parsing the fresh markup and
  // copying its children + dataset.
  const host = document.createElement('div');
  host.innerHTML = fresh;
  const next = host.firstElementChild;
  if (!next) return;
  rootEl.dataset.state = next.dataset.state || '';
  rootEl.dataset.role  = next.dataset.role  || '';
  rootEl.dataset.orderId = next.dataset.orderId || '';
  // BD-MOD-01 — a report sheet open during an in-place re-render would be wiped
  // by replaceChildren below. That cannot happen via the UI today (the modal
  // covers the screen and hides the tabbar, blocking the actions that
  // re-render), but guard it so the chrome can never be stranded hidden: when a
  // stray overlay is present, restore the tabbar (/order always shows chrome).
  if (rootEl.querySelector('.od-report-overlay')) {
    const tb = document.getElementById('tabbar');
    if (tb) tb.hidden = false;
  }
  rootEl.replaceChildren(...Array.from(next.childNodes));
  // The order/state captured in the click closure must follow the new
  // state so subsequent clicks see the up-to-date values.
  ctx.order = order;
  ctx.state = state;
}

// BD-MOD-01 — moderation report sheet for the standalone «Пожаловаться»
// (report-order) CTA. A small modal layer over Order Detail: report reasons →
// submitted (a UI stub — no backend, no localStorage; the "после подключения
// backend" copy makes the mock explicit). This is a STANDALONE moderation
// surface — it does NOT touch or reroute the in-ride BD-RIDE-P-07 safety
// report, and Order Detail's primary actions still re-render in place.
const REPORT_REASONS = [
  'Мошеннический или подозрительный заказ',
  'Оскорбления или угрозы',
  'Спам или реклама',
  'Другое',
];
function reportSheetHtml() {
  const reasons = REPORT_REASONS.map((r, i) => `
        <button type="button" class="od-report-reason" data-report-reason="${i}">
          <span class="od-report-reason__text">${escapeHtml(r)}</span>
          <span class="od-report-reason__radio" aria-hidden="true"></span>
        </button>`).join('');
  return `
  <div class="od-report-overlay" data-view="report" role="dialog" aria-modal="true" aria-labelledby="od-report-title">
    <div class="od-report-overlay__backdrop" data-report="dismiss" aria-hidden="true"></div>
    <div class="od-report-sheet" role="document">
      <div class="od-report-sheet__handle" aria-hidden="true"></div>

      <!-- REPORT — reason -->
      <div class="od-report-view od-report-view--report">
        <div class="od-report-header">
          <div class="od-report-title" id="od-report-title">Пожаловаться на заказ</div>
          <button type="button" class="od-report-close" data-report="dismiss" aria-label="Закрыть">×</button>
        </div>
        <div class="od-report-sub">Расскажите, что не так — модерация проверит заказ.</div>
        <div class="od-report-reasons">${reasons}</div>
        <div class="od-report-actions">
          <button type="button" class="bd-btn primary od-report-act" data-report="submit">Отправить жалобу</button>
        </div>
      </div>

      <!-- SUBMITTED — UI stub (no backend) -->
      <div class="od-report-view od-report-view--submitted">
        <div class="od-report-done-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><polyline points="20 6 9 17 4 12"/></svg></div>
        <div class="od-report-title od-report-title--center">Спасибо, жалоба отправлена</div>
        <div class="od-report-sub od-report-sub--center">Мы рассмотрим её в модерации после подключения backend.</div>
        <div class="od-report-actions">
          <button type="button" class="bd-btn od-report-act" data-report="dismiss">Закрыть</button>
        </div>
      </div>

    </div>
  </div>`;
}

function bindEvents(rootEl, initialCtx) {
  // Keep a mutable context so re-renders update what the closure sees.
  const ctx = { ...initialCtx };

  // BD-MOD-01 — report sheet open/close + 2-view machine (report → submitted),
  // in-memory only. The overlay is appended to rootEl; its controls use a
  // distinct `data-report` attribute, so the screen's [data-action] listener
  // never fires on them. #tabbar is a sibling of #app and /order is not in
  // HIDE_CHROME, so hide the tabbar while the modal is open (restore on close)
  // to actually block background navigation.
  let reportOverlayEl = null;
  let reportTabbar = null;
  let reportTabbarPrevHidden = false;
  function closeReportSheet() {
    if (reportOverlayEl) { reportOverlayEl.remove(); reportOverlayEl = null; }
    if (reportTabbar) { reportTabbar.hidden = reportTabbarPrevHidden; reportTabbar = null; }
  }
  function setReportView(view) {
    if (reportOverlayEl) reportOverlayEl.dataset.view = view;
  }
  function openReportSheet() {
    // DOM-based guard: the source of truth is the mounted overlay, so a stray
    // wipe (e.g. an in-place re-render) can never strand a stale ref that blocks
    // re-opening the sheet.
    if (rootEl.querySelector('.od-report-overlay')) return;
    reportTabbar = document.getElementById('tabbar');
    if (reportTabbar) { reportTabbarPrevHidden = reportTabbar.hidden; reportTabbar.hidden = true; }
    rootEl.insertAdjacentHTML('beforeend', reportSheetHtml());
    reportOverlayEl = rootEl.querySelector('.od-report-overlay');
    reportOverlayEl.addEventListener('click', (event) => {
      const reasonBtn = event.target.closest('[data-report-reason]');
      if (reasonBtn) {
        reportOverlayEl.querySelectorAll('[data-report-reason]')
          .forEach((b) => b.classList.toggle('is-selected', b === reasonBtn));
        return;
      }
      const ctl = event.target.closest('[data-report]');
      if (!ctl) return;
      const a = ctl.dataset.report;
      if (a === 'dismiss') { closeReportSheet(); return; }
      // Report submit is a UI stub — no backend, no localStorage.
      if (a === 'submit')  { setReportView('submitted'); return; }
    });
  }

  rootEl.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const { role } = ctx;

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

    // BD-ORDER-DETAIL-01D-2B — passenger «Открыть поездку» handoff.
    // This is the ONLY place an active_ride seed is written for the
    // Order Detail passenger flow. The 01D-2A select-driver path never
    // touches bazardrive.active_ride.v1; only this explicit CTA tap
    // does. Idempotent: a re-tap on an already-seeded tripId does
    // saveActiveRide-skip and just re-navigates.
    if (action === 'open-trip') {
      if (btn.disabled) return;
      if (role !== 'passenger') { showNotice(rootEl, STUB_TOAST_ACTION); return; }
      const order = ctx.order;
      if (!canOpenTrip(order)) {
        showNotice(rootEl, 'Поездка ещё не доступна');
        return;
      }
      const seed = buildPassengerActiveRideSeed(order);
      if (!seed) {
        showNotice(rootEl, 'Не удалось создать поездку');
        return;
      }
      // Idempotent — preserve any in-flight active ride for this
      // tripId instead of overwriting it.
      if (!findActiveRide(seed.tripId)) saveActiveRide(seed);
      go(`/active-ride?role=passenger&tripId=${encodeURIComponent(seed.tripId)}`);
      return;
    }

    // Driver D3 «Открыть активную поездку» — existing behaviour.
    // The driver active ride is owned by the driver flow and is not
    // seeded from Order Detail; this handler just navigates when the
    // fixture/canonical store already carries a tripId.
    if (action === 'open-active-ride') {
      if (btn.disabled) return;
      const tripId = ctx.order && ctx.order.tripId;
      if (tripId) {
        go(`/active-ride?role=${role}&tripId=${encodeURIComponent(tripId)}`);
        return;
      }
      showNotice(rootEl, STUB_TOAST_ACTION);
      return;
    }

    // BD-ORDER-DETAIL-01D-1 — driver «Откликнуться на заказ»: write a
    // DriverOffer(status='sent') for (orderId, SELF_DRIVER_ID) into the
    // local store, then re-render to D2. No Order.status write, no
    // selectedDriverId write, no active_ride seed. Idempotent: a
    // repeated tap while the offer is already 'sent' is a no-op.
    if (action === 'driver-send-offer') {
      const id = ctx.id;
      if (!id) { showNotice(rootEl, STUB_TOAST_OFFER); return; }
      const existing = getDriverOffer(id, SELF_DRIVER_ID);
      if (existing && existing.status === 'sent') {
        showNotice(rootEl, 'Оффер уже отправлен');
        return;
      }
      // BD-ORDER-DETAIL-01D-2C-B — sendDriverOffer preserves terminal
      // statuses (accepted / rejected / expired) verbatim instead of
      // overwriting them. Short-circuit before the «Оффер отправлен»
      // toast so the driver never sees a misleading success state on
      // a terminal record. Differentiate by `rejectedBy`:
      //   • rejectedBy='passenger' → «Пассажир отклонил оффер» — the
      //     passenger actively rejected this offer. resolveState
      //     normally routes this case to D4 via driver_offer_rejected
      //     so the «Откликнуться» CTA isn't in the DOM; this branch
      //     is defense-in-depth against stale render / direct dispatch.
      //   • any other rejectedBy (`system` / `driver` / missing / …)
      //     → the generic «Оффер недоступен». Resolving stays on D1
      //     for those non-passenger terminal records, so the driver
      //     can land here through the live CTA — mislabeling the
      //     rejecter would attribute the action to the wrong actor.
      //     Resend transition for those is owned by a later sub-slice.
      if (existing && existing.status === 'rejected') {
        if (existing.rejectedBy === 'passenger') {
          showNotice(rootEl, 'Пассажир отклонил оффер');
        } else {
          showNotice(rootEl, 'Оффер недоступен');
        }
        return;
      }
      // Hydrate the fresh offer with order-derived defaults so the
      // resulting D2 summary and any cross-role P2 card carry sensible
      // price / ETA / route context. The store still backfills demo
      // defaults if these are missing.
      const budget = ctx.order && typeof ctx.order.budget === 'number'
        ? ctx.order.budget
        : null;
      const result = sendDriverOffer({
        orderId: id,
        driverId: SELF_DRIVER_ID,
        details: budget != null ? { price: budget } : null,
      });
      if (!result) { showNotice(rootEl, STUB_TOAST_OFFER); return; }
      rerenderInPlace(rootEl, ctx);
      showNotice(rootEl, 'Оффер отправлен');
      return;
    }

    // BD-ORDER-DETAIL-01D-1 — D2 «Отозвать оффер». Flips the existing
    // 'sent' offer to 'withdrawn' (idempotent — withdrawn stays
    // withdrawn) and re-renders. The driver lands back on D1 because
    // the withdrawn offer no longer counts as a sent candidate.
    if (action === 'withdraw-offer') {
      const id = ctx.id;
      if (!id) { showNotice(rootEl, STUB_TOAST_ACTION); return; }
      withdrawDriverOffer({ orderId: id, driverId: SELF_DRIVER_ID });
      rerenderInPlace(rootEl, ctx);
      showNotice(rootEl, 'Оффер отозван');
      return;
    }

    // BD-ORDER-DETAIL-01D-2A — passenger «Выбрать водителя». Local
    // atomic commit:
    //   • write the order overlay (status='ACCEPTED' + selectedDriverId)
    //   • flip the chosen offer to status='accepted'
    //   • flip competing sent offers for the same order to
    //     status='rejected'
    //   • leave terminal offers (withdrawn / expired / rejected) alone
    //
    // The handler refuses to commit on:
    //   • missing / unknown offer id (foreign offer, malformed id)
    //   • non-passenger role (defence-in-depth — the button only
    //     renders on P2)
    //   • offer that isn't currently status='sent'
    //   • offer that doesn't belong to this order
    //
    // No active_ride seed is written in this slice — that's
    // BD-ORDER-DETAIL-01D-2B's job.
    // BD-ORDER-DETAIL-01D-2C-A — passenger «Отменить заказ».
    // Two-step confirmation: first click arms the button and shows a
    // re-confirm notice (auto-disarms after 5s via setTimeout); second
    // click commits the cancel via cancelOrderByPassenger, which only
    // writes the order overlay record. DriverOffer statuses are NOT
    // touched in this slice (that sync belongs to a later 01D-2C
    // sub-slice). No active_ride seed is created. selectedDriverId
    // from a prior 01D-2A commit is preserved verbatim in the overlay.
    // After commit the screen re-renders and resolveState routes to
    // P4 (terminal canceled), so the cancel button is no longer in
    // the DOM and the armed state cannot leak across re-renders.
    if (action === 'cancel-order') {
      if (btn.disabled) return;
      if (role !== 'passenger') { showNotice(rootEl, STUB_TOAST_ACTION); return; }
      const id = ctx.id;
      if (!id) { showNotice(rootEl, STUB_TOAST_ACTION); return; }
      // Already canceled — no-op with a sensible toast.
      if (ctx.order && ctx.order.status === ORDER_STATUS.CANCELED) {
        showNotice(rootEl, 'Заказ уже отменён');
        return;
      }
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.textContent = 'Подтвердите отмену';
        showNotice(rootEl, 'Нажмите ещё раз, чтобы отменить заказ');
        if (btn.__disarmTimer) clearTimeout(btn.__disarmTimer);
        btn.__disarmTimer = setTimeout(() => {
          try {
            btn.dataset.armed = '';
            btn.textContent = 'Отменить заказ';
          } catch {}
        }, 5000);
        return;
      }
      const result = cancelOrderByPassenger({ orderId: id });
      if (!result) {
        showNotice(rootEl, 'Не удалось отменить заказ');
        return;
      }
      // BD-ORDER-DETAIL-01D-2C-C — sync active sent DriverOffers to
      // terminal `rejected` so the driver side never sees stale D2
      // («Оффер отправлен») after the order is canceled. The cancel
      // overlay alone leaves `sent` records untouched in the store;
      // this call flips every active sent offer for `orderId` to
      // `status='rejected'` with `rejectedBy='passenger_cancel'` /
      // `rejectedReason='order_canceled_by_passenger'`. Snapshot
      // fallback (`allOffers`) covers fixture-only sent offers that
      // have no store baseline yet, matching the pattern
      // commitPassengerSelection uses.
      //
      // The overlay cancel is the source of truth for terminal order
      // state — we do NOT rollback the cancel if this sync returns
      // null (refused input) or an empty array (nothing eligible). The
      // canceled order is canceled regardless of whether any sent
      // offers existed.
      rejectSentOffersForPassengerCanceledOrder({
        orderId: id,
        allOffers: (ctx.order && ctx.order.offers) || [],
      });
      rerenderInPlace(rootEl, ctx);
      showNotice(rootEl, 'Заказ отменён');
      return;
    }

    // BD-ORDER-DETAIL-01D-2D — assigned-driver «Отменить» on D3.
    // Two-step armed/confirm pattern mirroring the passenger
    // cancel-order handler. Eligibility:
    //   • role === 'driver'
    //   • ctx.order.status === ACCEPTED
    //   • ctx.order.selectedDriverId === SELF_DRIVER_ID
    // On success the overlay carries status='CANCELED' +
    // canceledBy='driver'; the assignment record (selectedDriverId)
    // is preserved by the helper. The accepted DriverOffer stays
    // accepted — driver cancel does NOT flip offer status back to
    // sent / rejected. The active_ride store is NOT touched here.
    // Stale-tab race (passenger already canceled) lands in the
    // non-success branch: re-render so the screen catches up to the
    // terminal state, toast «Заказ уже отменён».
    if (action === 'driver-cancel') {
      if (btn.disabled) return;
      if (role !== 'driver') { showNotice(rootEl, STUB_TOAST_ACTION); return; }
      const id = ctx.id;
      if (!id) { showNotice(rootEl, STUB_TOAST_ACTION); return; }
      if (!ctx.order
          || ctx.order.status !== ORDER_STATUS.ACCEPTED
          || ctx.order.selectedDriverId !== SELF_DRIVER_ID) {
        showNotice(rootEl, 'Заказ нельзя отменить');
        return;
      }
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.textContent = 'Подтвердите отмену';
        showNotice(rootEl, 'Нажмите ещё раз, чтобы отменить заказ');
        if (btn.__disarmTimer) clearTimeout(btn.__disarmTimer);
        btn.__disarmTimer = setTimeout(() => {
          try {
            btn.dataset.armed = '';
            btn.textContent = 'Отменить';
          } catch {}
        }, 5000);
        return;
      }
      // Pass the merged order snapshot through so the helper can
      // verify the accepted-assignment proof on the no-overlay path
      // (fixture-only ACCEPTED). Without this, a direct / stale call
      // could pin a CANCELED overlay onto any safe `orderId`.
      const result = cancelOrderByDriver({
        orderId: id,
        driverId: SELF_DRIVER_ID,
        order: ctx.order,
      });
      if (!result) {
        showNotice(rootEl, 'Не удалось отменить заказ');
        return;
      }
      // Stale-result branch: another tab landed a passenger cancel
      // before this driver tap. The helper is idempotent on any prior
      // cancel actor; we re-render so the screen catches up but never
      // toast a misleading «Заказ отменён» as if the driver had
      // performed the cancel.
      if (result.canceledBy !== 'driver') {
        rerenderInPlace(rootEl, ctx);
        showNotice(rootEl, 'Заказ уже отменён');
        return;
      }
      rerenderInPlace(rootEl, ctx);
      showNotice(rootEl, 'Заказ отменён');
      return;
    }

    if (action === 'select-driver') {
      const id = ctx.id;
      if (!id || !ctx.order) { showNotice(rootEl, STUB_TOAST_ACTION); return; }
      if (role !== 'passenger') { showNotice(rootEl, STUB_TOAST_ACTION); return; }
      const offerId = btn.dataset.offerId;
      if (!offerId) { showNotice(rootEl, STUB_TOAST_ACTION); return; }
      const offer = (ctx.order.offers || []).find((o) => o && o.id === offerId);
      if (!offer || offer.orderId !== id || offer.status !== 'sent') {
        showNotice(rootEl, 'Этого водителя нельзя выбрать');
        return;
      }
      const result = commitPassengerSelection({
        orderId: id,
        selectedDriverId: offer.driverId,
        allOffers: ctx.order.offers,
      });
      if (!result) {
        showNotice(rootEl, 'Не удалось выбрать водителя');
        return;
      }
      rerenderInPlace(rootEl, ctx);
      showNotice(rootEl, 'Водитель выбран');
      return;
    }

    // BD-ORDER-DETAIL-01D-2C-B — passenger «Отклонить» on a single offer.
    // Flips ONLY the targeted DriverOffer to status='rejected' via the
    // local store helper. Other sent offers stay sent and remain
    // selectable. The order overlay (selectedDriverId / Order.status)
    // is NOT touched and the active_ride store is NOT seeded. Idempotent:
    // a second tap on an already-passenger-rejected offer is a no-op
    // (the helper returns the existing record). Refused on: non-passenger
    // role, missing/foreign offer id, offer that doesn't belong to this
    // order, or offer that isn't currently 'sent'. After commit the
    // screen re-renders; the rejected offer drops out of P2 because
    // activeSentOffers() excludes it.
    if (action === 'reject-offer') {
      if (role !== 'passenger') { showNotice(rootEl, STUB_TOAST_ACTION); return; }
      const id = ctx.id;
      if (!id || !ctx.order) { showNotice(rootEl, STUB_TOAST_ACTION); return; }
      const offerId = btn.dataset.offerId;
      if (!offerId) { showNotice(rootEl, STUB_TOAST_ACTION); return; }
      const offer = (ctx.order.offers || []).find((o) => o && o.id === offerId);
      if (!offer || offer.orderId !== id || offer.status !== 'sent') {
        showNotice(rootEl, 'Этот оффер нельзя отклонить');
        return;
      }
      // Pass the offer snapshot through so the helper can persist a
      // fixture-only baseline (a P2 candidate that hasn't been written
      // to `bazardrive.driver_offers.v1` yet) before flipping it to
      // rejected. Mirrors the snapshot fallback `commitPassengerSelection`
      // already uses for the same scenario.
      const result = rejectDriverOfferByPassenger({
        orderId: id,
        driverId: offer.driverId,
        offer,
      });
      if (!result) {
        showNotice(rootEl, 'Не удалось отклонить оффер');
        return;
      }
      // BD-ORDER-DETAIL-01D-2C-B — only treat as success when the
      // helper actually performed (or idempotently re-confirmed) a
      // passenger reject. A truthy result with a non-matching
      // status / rejectedBy means the snapshot was stale: another
      // tab — or a peer transition — moved the stored offer into a
      // terminal status (`accepted`, `withdrawn`, `expired`, or a
      // pre-existing `rejected` with a foreign `rejectedBy`). The
      // helper preserves those verbatim, so we re-render to drop the
      // stale card out of P2 and show a non-success toast instead of
      // the misleading «Оффер отклонён».
      if (result.status !== 'rejected' || result.rejectedBy !== 'passenger') {
        rerenderInPlace(rootEl, ctx);
        showNotice(rootEl, 'Этот оффер недоступен');
        return;
      }
      rerenderInPlace(rootEl, ctx);
      showNotice(rootEl, 'Оффер отклонён');
      return;
    }

    // BD-ORDER-DETAIL-CHAT-GUARD-01 — the driver «Написать» CTA does not open a
    // chat (no driver→passenger marketplace handoff exists yet). Surface a
    // state-aware notice explaining when messaging becomes available; never
    // navigate to /chat and never create an order chat thread.
    if (action === 'message-passenger') {
      showNotice(rootEl, MESSAGE_GUARD_NOTICES[ctx.state] || STUB_TOAST_ACTION);
      return;
    }

    // BD-MOD-01 — standalone moderation report. Opens the report sheet over
    // Order Detail (no route change, no /report reroute, BD-RIDE-P-07 untouched).
    if (action === 'report-order') {
      openReportSheet();
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
  bindEvents(section, { order, role, state, id });
  return section;
}
