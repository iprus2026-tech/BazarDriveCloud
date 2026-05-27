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
import { listNearbyOrders } from '../mock_api.js';
import { acceptCanonicalRideOrder } from '../ride_actions.js';

const STATE = {
  LIST:     'list',
  EMPTY:    'empty',
  ACCEPTED: 'accepted',
};

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

const MAP_VARIANT = {
  NEARBY:   'nearby',
  EMPTY:    'empty',
  ACCEPTED: 'accepted',
};

const MAP_VARIANT_COPY = {
  [MAP_VARIANT.NEARBY]: {
    ariaLabel: 'Карта-заглушка водителя',
    watermark: 'Mapbox SDK пока не подключён',
  },
  [MAP_VARIANT.EMPTY]: {
    ariaLabel: 'Карта-заглушка водителя · заказов рядом нет',
    watermark: 'Демо-фон · Mapbox SDK пока не подключён',
  },
  [MAP_VARIANT.ACCEPTED]: {
    ariaLabel: 'Карта-заглушка водителя · заказ принят',
    watermark: 'Карта водителя · Mapbox SDK пока не подключён',
  },
};

function buildMapPlaceholder(orderCount, { variant = MAP_VARIANT.NEARBY } = {}) {
  const copy = MAP_VARIANT_COPY[variant] || MAP_VARIANT_COPY[MAP_VARIANT.NEARBY];
  const showClusters = variant === MAP_VARIANT.NEARBY && orderCount > 0;

  const wrap = document.createElement('div');
  wrap.className = 'map-home__map map-home__map--nearby driver-map__map';
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', copy.ariaLabel);
  wrap.dataset.state = variant;

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

  if (showClusters) {
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
  watermark.textContent = copy.watermark;
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

    stage.replaceChildren(buildMapPlaceholder(live.length, {
      variant: hasLive ? MAP_VARIANT.NEARBY : MAP_VARIANT.EMPTY,
    }));
    sheetSlot.replaceChildren(hasLive ? buildListCard(live) : buildEmptyCard());
    root.dataset.state = hasLive ? STATE.LIST : STATE.EMPTY;
  }

  function renderAccepted(order, tripId) {
    stage.replaceChildren(buildMapPlaceholder(0, { variant: MAP_VARIANT.ACCEPTED }));
    sheetSlot.replaceChildren(buildAcceptedCard(order, tripId));
    root.dataset.state = STATE.ACCEPTED;
  }

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.action;

    if (action === 'accept') {
      const id = btn.dataset.orderId;
      const result = acceptCanonicalRideOrder(id);
      if (result) {
        renderAccepted(result.order, result.tripId);
      } else {
        // Stale row (e.g. already accepted in another tab) — route
        // to the order draft flow so the driver can publish a fresh
        // local order to accept.
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
