// BD-DRIVER-01 — DriverMap render gate.
// Safe driver-side surface listing nearby published mock orders.
// Reuses the BD-MAP-01 map placeholder / MapShell visual language —
// no real Mapbox SDK, no token, no native geolocation prompt, no
// backend, no driver assignment service. Orders come from
// listNearbyOrders() (BD-MAP-05 OrderMapDraft mock store), accepting
// an order flips its local status via acceptNearbyOrder().

import { escapeHtml } from '../util.js';
import { go } from '../router.js';
import { createMapShell } from '../mapbox/map_shell.js';
import { listNearbyOrders, acceptNearbyOrder } from '../mock_api.js';
import {
  RIDE_STATUS,
  createDemoActiveRide,
  saveActiveRide,
} from '../ride_state.js';

const STATE = {
  LIST:     'list',
  EMPTY:    'empty',
  ACCEPTED: 'accepted',
};

// Fallback demo orders shown when the local ride-orders store is
// empty (e.g. fresh session, no passenger has published yet). These
// are display-only — they cannot be accepted because they do not
// exist in the persisted store. Accept buttons on demo rows redirect
// to the order draft flow so the driver can produce a real local
// order to accept.
const DEMO_ORDERS = [
  {
    id:             'demo-1',
    pickup:         { label: 'ул. Малая Бронная, 28' },
    dropoff:        { label: 'Шереметьево, терминал B' },
    distanceKm:     38,
    durationMin:    42,
    estimatedPrice: 1540,
    scheduledMode:  'now',
    demo:           true,
  },
  {
    id:             'demo-2',
    pickup:         { label: 'ТЦ Мега' },
    dropoff:        { label: 'Аэропорт Внуково, терминал A' },
    distanceKm:     22,
    durationMin:    28,
    estimatedPrice: 980,
    scheduledMode:  'now',
    demo:           true,
  },
  {
    id:             'demo-3',
    pickup:         { label: 'Казань, ж/д вокзал' },
    dropoff:        { label: 'Москва, Курский вокзал' },
    distanceKm:     820,
    durationMin:    540,
    estimatedPrice: 4500,
    scheduledMode:  'later',
    demo:           true,
  },
];

function pointLabel(point, fallback) {
  if (point && typeof point === 'object' && typeof point.label === 'string' && point.label.trim()) {
    return point.label.trim();
  }
  return fallback;
}

function initialOf(label) {
  const ch = (label || '').trim().charAt(0);
  return ch ? ch.toUpperCase() : '·';
}

function formatPrice(rub) {
  const n = Number(rub) || 0;
  return `${n.toLocaleString('ru-RU')} ₽`;
}

function formatMeta(order) {
  const parts = [];
  if (Number(order.distanceKm) > 0) {
    parts.push(`${order.distanceKm} км`);
  }
  if (Number(order.durationMin) > 0) {
    parts.push(`${order.durationMin} мин`);
  }
  parts.push(order.scheduledMode === 'later' ? 'позже' : 'сейчас');
  return parts.join(' · ');
}

// BD-DRIVER-01 — Hand off the accepted local order into the
// active-ride store so /active-ride?role=driver lands in the right
// trip instead of the generic DEMO_ACTIVE_RIDE_ID fallback. Returns
// the stable tripId used in the CTA URL. Reuses the ride_state.js
// foundation (createDemoActiveRide + saveActiveRide); no changes to
// active_ride.js itself.
function seedActiveRideFromAcceptedOrder(order) {
  const tripId = `trip_${order.id}`;
  const pickupLabel  = pointLabel(order.pickup,  'Точка подачи');
  const dropoffLabel = pointLabel(order.dropoff, 'Точка назначения');
  const distanceKm   = Number(order.distanceKm)  || 0;
  const durationMin  = Number(order.durationMin) || 0;
  const priceRub     = Number(order.estimatedPrice) || 0;
  const priceLabel   = `${priceRub.toLocaleString('ru-RU')} ₽`;
  const distanceLabel = distanceKm > 0 ? `${distanceKm} км` : '—';
  const etaLabel      = durationMin > 0 ? `${durationMin} мин` : '—';
  const acceptedAt    = typeof order.acceptedAt === 'string'
    ? order.acceptedAt
    : new Date().toISOString();

  const ride = createDemoActiveRide({
    tripId,
    role: 'driver',
    status: RIDE_STATUS.DRIVER_EN_ROUTE,
    order: {
      offerPrice: priceLabel,
      destinationDistance: distanceLabel,
      destinationEta: etaLabel,
    },
    route: {
      pickupLabel,
      dropoffLabel,
      etaToDestination: etaLabel,
    },
    ride: {
      price: priceLabel,
    },
    timestamps: {
      acceptedAt,
    },
  });
  saveActiveRide(ride);
  return tripId;
}

function buildTopbar() {
  const topbar = document.createElement('div');
  topbar.className = 'bd-topbar driver-map__topbar';
  topbar.innerHTML = `
    <div class="bd-topbar__titles">
      <h1 class="bd-topbar__title">Карта водителя</h1>
      <p class="bd-topbar__sub">demo · заказы рядом</p>
    </div>
  `;
  return topbar;
}

function buildMapPlaceholder(orderCount) {
  const wrap = document.createElement('div');
  wrap.className = 'map-home__map map-home__map--nearby driver-map__map';
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', 'Карта-заглушка водителя');
  wrap.dataset.state = 'nearby';

  const shell = createMapShell({
    variant:    'driver',
    showRoute:  false,
    showCar:    true,
    showPickup: true,
    showDropoff: false,
    showLabels: false,
  });
  shell.setAttribute('aria-hidden', 'true');
  wrap.appendChild(shell);

  if (orderCount > 0) {
    const overlay = document.createElement('div');
    overlay.className = 'map-home__nearby';
    overlay.setAttribute('aria-hidden', 'true');

    const pulse = document.createElement('span');
    pulse.className = 'map-home__pulse';
    overlay.appendChild(pulse);

    const visible = Math.min(orderCount, 5);
    for (let i = 0; i < visible; i++) {
      const c = document.createElement('span');
      c.className = `map-home__cluster map-home__cluster--${i + 1}`;
      c.textContent = String(i + 1);
      overlay.appendChild(c);
    }
    wrap.appendChild(overlay);
  }

  const watermark = document.createElement('div');
  watermark.className = 'map-home__watermark';
  watermark.textContent = 'Mapbox SDK пока не подключён';
  wrap.appendChild(watermark);

  return wrap;
}

function buildOrderRow(order, index) {
  const pickupLabel  = pointLabel(order.pickup,  'Точка подачи');
  const dropoffLabel = pointLabel(order.dropoff, 'Точка назначения');
  const safeId = escapeHtml(order.id);

  const row = document.createElement('li');
  row.className = 'driver-map__order';
  row.dataset.orderId = order.id;
  if (order.demo) row.dataset.demo = '1';

  row.innerHTML = `
    <div class="driver-map__order-head">
      <div class="map-home__order-num" aria-hidden="true">${index + 1}</div>
      <div class="map-home__order-avatar" aria-hidden="true">${escapeHtml(initialOf(pickupLabel))}</div>
      <div class="map-home__order-info">
        <div class="map-home__order-name">${escapeHtml(pickupLabel)}</div>
        <div class="map-home__order-meta">→ ${escapeHtml(dropoffLabel)}</div>
      </div>
      <div class="map-home__order-price">${escapeHtml(formatPrice(order.estimatedPrice))}</div>
    </div>
    <div class="driver-map__order-foot">
      <span class="driver-map__order-meta">${escapeHtml(formatMeta(order))}</span>
      <button class="bd-btn primary sm" type="button"
              data-action="accept" data-order-id="${safeId}">
        Принять
      </button>
    </div>
  `;
  return row;
}

function buildListCard(orders) {
  const card = document.createElement('div');
  card.className = 'map-home__sheet map-home__sheet--nearby driver-map__sheet';
  card.dataset.state = STATE.LIST;
  card.innerHTML = `<div class="map-home__sheet-grip" aria-hidden="true"></div>`;

  const count = document.createElement('div');
  count.className = 'map-home__count';
  count.innerHTML = `
    <span class="map-home__count-num">${orders.length}</span>
    <span class="map-home__count-label">${orders.length === 1 ? 'заказ рядом' : 'заказов рядом'}</span>
  `;
  card.appendChild(count);

  const list = document.createElement('ul');
  list.className = 'map-home__order-list driver-map__list';
  list.setAttribute('aria-label', 'Заказы рядом');
  orders.forEach((o, i) => list.appendChild(buildOrderRow(o, i)));
  card.appendChild(list);

  const row = document.createElement('div');
  row.className = 'map-home__sheet-row';
  row.innerHTML = `
    <button class="bd-btn map-home__chip" type="button" data-action="map">
      Открыть карту
    </button>
    <button class="bd-btn map-home__chip" type="button" data-action="feed">
      В ленту
    </button>
  `;
  card.appendChild(row);

  return card;
}

function buildEmptyCard() {
  const card = document.createElement('div');
  card.className = 'map-home__sheet driver-map__sheet';
  card.dataset.state = STATE.EMPTY;
  card.innerHTML = `
    <div class="map-home__sheet-grip" aria-hidden="true"></div>
    <div class="bd-empty">
      <div class="bd-empty__title">Заказов рядом пока нет</div>
      <p>Опубликованные пассажирами заказы будут появляться здесь, как только водители выйдут в смену.</p>
    </div>
    <button class="bd-btn primary map-home__cta" type="button" data-action="create-order">
      Создать тестовый заказ
    </button>
    <button class="bd-btn ghost map-home__cta map-home__cta--ghost" type="button" data-action="feed">
      Вернуться в ленту
    </button>
  `;
  return card;
}

function buildAcceptedCard(order, tripId) {
  const card = document.createElement('div');
  card.className = 'map-home__sheet driver-map__sheet';
  card.dataset.state = STATE.ACCEPTED;
  const pickupLabel  = pointLabel(order.pickup,  'Точка подачи');
  const dropoffLabel = pointLabel(order.dropoff, 'Точка назначения');
  const safeTripId   = escapeHtml(tripId);
  card.innerHTML = `
    <div class="map-home__sheet-grip" aria-hidden="true"></div>
    <div class="bd-badge success" role="status">Заказ принят</div>
    <div class="driver-map__accepted">
      <div class="driver-map__accepted-route">
        <div class="map-home__order-name">${escapeHtml(pickupLabel)}</div>
        <div class="map-home__order-meta">→ ${escapeHtml(dropoffLabel)}</div>
      </div>
      <div class="map-home__order-price">${escapeHtml(formatPrice(order.estimatedPrice))}</div>
    </div>
    <button class="bd-btn primary map-home__cta" type="button"
            data-action="active-ride" data-trip-id="${safeTripId}">
      К поездке
    </button>
    <button class="bd-btn ghost map-home__cta map-home__cta--ghost" type="button" data-action="driver-map">
      Назад к заказам
    </button>
  `;
  return card;
}

function buildStage(orderCount) {
  const stage = document.createElement('div');
  stage.className = 'map-home__stage driver-map__stage';
  stage.appendChild(buildMapPlaceholder(orderCount));
  return stage;
}

export default function driverMapScreen() {
  const root = document.createElement('section');
  root.className = 'screen screen--map screen--driver-map';
  root.dataset.state = STATE.LIST;

  root.appendChild(buildTopbar());

  const stage = buildStage(0);
  root.appendChild(stage);

  const sheetSlot = document.createElement('div');
  sheetSlot.className = 'driver-map__sheet-slot';
  root.appendChild(sheetSlot);

  function renderList() {
    const live = listNearbyOrders();
    const hasLive = live.length > 0;
    const orders = hasLive ? live : DEMO_ORDERS;

    stage.replaceChildren(buildMapPlaceholder(orders.length));
    sheetSlot.replaceChildren(hasLive ? buildListCard(live) : buildEmptyCard());
    root.dataset.state = hasLive ? STATE.LIST : STATE.EMPTY;
  }

  function renderAccepted(order, tripId) {
    stage.replaceChildren(buildMapPlaceholder(0));
    sheetSlot.replaceChildren(buildAcceptedCard(order, tripId));
    root.dataset.state = STATE.ACCEPTED;
  }

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.action;

    if (action === 'accept') {
      const id = btn.dataset.orderId;
      const accepted = acceptNearbyOrder(id);
      if (accepted) {
        const tripId = seedActiveRideFromAcceptedOrder(accepted);
        renderAccepted(accepted, tripId);
      } else {
        // Demo / stale row — route to the order draft flow so the
        // driver can publish a real local order to accept.
        go('/order-map-draft');
      }
    } else if (action === 'create-order') {
      go('/order-map-draft');
    } else if (action === 'map') {
      go('/map');
    } else if (action === 'feed') {
      go('/feed');
    } else if (action === 'active-ride') {
      const tripId = btn.dataset.tripId;
      const query = tripId
        ? `tripId=${encodeURIComponent(tripId)}&status=DRIVER_EN_ROUTE`
        : 'status=DRIVER_EN_ROUTE';
      go(`/active-ride?role=driver&${query}`);
    } else if (action === 'driver-map') {
      renderList();
    }
  });

  renderList();
  return root;
}
