// BD-DRIVER-01 — DriverMap render gate.
// Safe driver-side surface listing nearby published mock orders.
// Reuses the BD-MAP-01 map placeholder / MapShell visual language —
// no real Mapbox SDK, no token, no native geolocation prompt, no
// backend, no driver assignment service. Orders come from
// listNearbyOrders() (BD-MAP-05 OrderMapDraft mock store), accepting
// an order flips its local status via acceptNearbyOrder().
//
// BD-DRIVER-02 — DriverMap readiness gate.
// Variants: ready | not_ready | non_driver. A role=driver who is not
// isDriverLineReady() (state.js, the same rule Profile enforces) sees a
// readiness banner + read-only checklist + LOCKED order cards instead of the
// working accept surface, and is routed to /profile to finish readiness. The
// non_driver path keeps the existing BD-ROLE-01 passenger guard unchanged.

import { escapeHtml } from '../util.js';
import { go } from '../router.js';
import { createMapShell } from '../mapbox/map_shell.js';
import { listNearbyOrders, createRideOrder } from '../mock_api.js';
import { loadResource } from '../data_layer.js';
import { acceptCanonicalRideOrder } from '../ride_actions.js';
import { user, isDriverLineReady } from '../state.js';
import { getSmokeRole } from '../smoke_role.js';

const STATE = {
  LIST:      'list',
  EMPTY:     'empty',
  ACCEPTED:  'accepted',
  NOT_READY: 'not_ready',
};

// Inline glyphs for the BD-DRIVER-02 readiness gate (no icon dependency).
const SVG_WARN = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
const SVG_CHECK_SM = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
const SVG_ARROW_RIGHT = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;
const SVG_LOCK = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;

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

function buildMapPlaceholder(orderCount, { variant = MAP_VARIANT.NEARBY, dimmed = false } = {}) {
  const copy = MAP_VARIANT_COPY[variant] || MAP_VARIANT_COPY[MAP_VARIANT.NEARBY];
  const showClusters = variant === MAP_VARIANT.NEARBY && orderCount > 0;

  const wrap = document.createElement('div');
  wrap.className = 'map-home__map map-home__map--nearby driver-map__map'
    + (dimmed ? ' driver-map__map--dimmed' : '');
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

function buildOrderRow(order, index, { locked = false } = {}) {
  const pickupLabel  = pointLabel(order.pickup,  'Точка подачи');
  const dropoffLabel = pointLabel(order.dropoff, 'Точка назначения');
  const safeId = escapeHtml(order.id);

  const row = document.createElement('li');
  row.className = locked ? 'driver-map__order is-locked' : 'driver-map__order';
  row.dataset.orderId = order.id;

  // BD-DRIVER-02 — locked rows expose NO accept action: the «Принять» button is
  // replaced by a "Доступно после готовности" zone that routes to /profile
  // (data-action="complete-readiness"), so a not-ready driver can never accept
  // from the gate but can still tap through to finish readiness.
  const foot = locked
    ? `<button class="driver-map__order-locked" type="button" data-action="complete-readiness">${SVG_LOCK}<span>Доступно после готовности</span></button>`
    : `<div class="driver-map__order-foot">
      <span class="driver-map__order-meta">${escapeHtml(formatMeta(order))}</span>
      <button class="bd-btn primary sm" type="button"
              data-action="accept" data-order-id="${safeId}">
        Принять
      </button>
    </div>`;

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
    ${foot}
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

// ── BD-DRIVER-02 readiness gate ─────────────────────────────────────────────

// Russian plural for "шаг" (1 шаг / 2 шага / 5 шагов).
function pluralStep(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'шаг';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'шага';
  return 'шагов';
}

// 7-item readiness model mirroring the design, with every `done` derived from
// the same persisted user fields that drive isDriverLineReady() — so the gate
// and the Profile readiness card cannot disagree.
function driverReadinessChecklist(u) {
  return [
    { key: 'phone',              label: 'Телефон подтверждён', done: !!u.phone },
    { key: 'vehicleMake',        label: 'Марка авто',          done: !!u.vehicleMake,  hint: u.vehicleMake || null },
    { key: 'vehicleModel',       label: 'Модель авто',         done: !!u.vehicleModel, hint: u.vehicleModel || null },
    { key: 'vehiclePlate',       label: 'Госномер',            done: !!u.vehiclePlate, hint: u.vehiclePlate || null },
    { key: 'documentsReady',     label: 'Документы готовы',    done: u.documentsReady === true },
    { key: 'waybillOpen',        label: 'Открыт путевой лист', done: u.waybillOpen === true,        hint: u.waybillOpen === true ? null : 'Откройте смену в профиле' },
    { key: 'medicalCheckPassed', label: 'Пройден медосмотр',  done: u.medicalCheckPassed === true, hint: u.medicalCheckPassed === true ? null : 'Предрейсовый, не пройден сегодня' },
  ];
}

function readinessRowHtml(item) {
  const dot = item.done
    ? `<div class="driver-map__check on" aria-hidden="true">${SVG_CHECK_SM}</div>`
    : `<div class="driver-map__check" aria-hidden="true"><span class="driver-map__check-empty"></span></div>`;
  const hint = item.hint
    ? `<div class="driver-map__check-hint${item.done ? ' is-done' : ''}">${escapeHtml(item.hint)}</div>`
    : '';
  const needTag = item.done ? '' : '<span class="driver-map__need-tag">нужно</span>';
  return `
    <div class="driver-map__check-row">
      ${dot}
      <div class="driver-map__check-body">
        <div class="driver-map__check-label${item.done ? ' is-done' : ''}">${escapeHtml(item.label)}</div>
        ${hint}
      </div>
      ${needTag}
    </div>`;
}

function buildReadinessGate(u, orders) {
  const items = driverReadinessChecklist(u);
  const done  = items.filter((i) => i.done).length;
  const total = items.length;
  const remaining = total - done;
  const rows = items.map(readinessRowHtml).join('');

  const card = document.createElement('div');
  card.className = 'map-home__sheet driver-map__sheet driver-map__gate-sheet';
  card.dataset.state = STATE.NOT_READY;
  card.innerHTML = `
    <div class="map-home__sheet-grip" aria-hidden="true"></div>
    <div class="driver-map__gate">
      <div class="driver-map__banner" role="status">
        <div class="driver-map__banner-icon" aria-hidden="true">${SVG_WARN}</div>
        <div class="driver-map__banner-text">
          <div class="driver-map__banner-title">Вы не на линии · профиль не готов</div>
          <div class="driver-map__banner-sub">Завершите готовность, чтобы принимать заказы</div>
        </div>
      </div>

      <div class="bd-card driver-map__checklist">
        <div class="driver-map__checklist-head">
          <span class="driver-map__checklist-title">Готовность к линии</span>
          <span class="driver-map__progress-count">${done} из ${total}</span>
        </div>
        <div class="driver-map__progress" data-done="${done}" data-total="${total}" aria-hidden="true">
          <div class="driver-map__progress-fill"></div>
        </div>
        <div class="driver-map__checklist-rows">${rows}</div>
        <button class="bd-btn primary driver-map__gate-cta" type="button" data-action="complete-readiness">
          ${SVG_ARROW_RIGHT}
          Завершить готовность
        </button>
        <div class="driver-map__gate-foot">Откроется профиль · ${remaining} ${pluralStep(remaining)} осталось</div>
      </div>

      <div class="driver-map__locked-h">
        <span>Заказы рядом</span>
        <span class="driver-map__locked-h-badge">${SVG_LOCK}заблокировано</span>
      </div>
    </div>
  `;

  if (orders.length > 0) {
    const list = document.createElement('ul');
    list.className = 'map-home__order-list driver-map__list driver-map__orders-locked';
    list.setAttribute('aria-label', 'Заказы рядом · заблокировано');
    orders.forEach((o, i) => list.appendChild(buildOrderRow(o, i, { locked: true })));
    card.appendChild(list);
  }

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
    <div class="bd-badge success" role="status" tabindex="-1">Заказ принят</div>
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

// BD-ROLE-01 — /driver-map is a driver-only working surface. Access is
// determined by the persisted user state (user.get().role), with the
// BD-SMOKE-ROLE-01 per-tab sessionStorage override taking precedence so a
// two-tab smoke can pin this tab to driver. The URL hash is still NOT read
// here: the smoke override is bootstrapped in the router and read from
// sessionStorage, never from ?role=, so the original leak (a passenger
// loading #/driver-map?role=driver to bypass the guard) stays closed.
function resolveEffectiveRole() {
  try {
    const smoke = getSmokeRole();
    const u = user.get();
    if (smoke) return smoke;
    return typeof u.role === 'string' ? u.role : null;
  } catch {
    return null;
  }
}

function buildPassengerGuardTopbar() {
  const topbar = document.createElement('div');
  topbar.className = 'bd-topbar driver-map__topbar';
  topbar.innerHTML = `
    <button class="bd-iconbtn driver-map__guard-back" type="button"
            data-action="my-order" aria-label="К моему заказу">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6"/>
      </svg>
    </button>
    <div class="bd-topbar__titles">
      <h1 class="bd-topbar__title">Это экран водителя</h1>
      <p class="bd-topbar__sub">demo · доступ ограничен ролью</p>
    </div>
  `;
  return topbar;
}

function buildPassengerGuardCard() {
  const card = document.createElement('div');
  card.className = 'map-home__sheet driver-map__sheet driver-map__guard';
  card.dataset.state = 'guard';
  card.innerHTML = `
    <div class="map-home__sheet-grip" aria-hidden="true"></div>
    <div class="bd-empty driver-map__guard-empty">
      <div class="bd-empty__title">Это экран водителя</div>
      <p>Пассажир видит статус своего заказа и отклики.</p>
    </div>
    <button class="bd-btn primary map-home__cta" type="button" data-action="my-order">
      К моему заказу
    </button>
    <button class="bd-btn ghost map-home__cta map-home__cta--ghost" type="button"
            data-action="feed">
      В ленту
    </button>
  `;
  return card;
}

function renderPassengerGuard() {
  const root = document.createElement('section');
  root.className = 'screen screen--map screen--driver-map screen--driver-map--guard';
  root.dataset.state = 'guard';
  root.dataset.role = 'passenger';

  root.appendChild(buildPassengerGuardTopbar());

  const stage = document.createElement('div');
  stage.className = 'map-home__stage driver-map__stage driver-map__stage--guard';
  // Reuse the empty-variant placeholder so the screen still looks like
  // part of the map flow but never renders driver-only clusters or
  // "заказов рядом" copy.
  stage.appendChild(buildMapPlaceholder(0, { variant: MAP_VARIANT.EMPTY }));
  root.appendChild(stage);

  const sheetSlot = document.createElement('div');
  sheetSlot.className = 'driver-map__sheet-slot';
  sheetSlot.appendChild(buildPassengerGuardCard());
  root.appendChild(sheetSlot);

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.action;
    if (action === 'my-order') {
      go('/responses');
    } else if (action === 'feed') {
      go('/feed');
    }
  });

  return root;
}

// BD-ERROR-01C-F / BD-ERROR-02A — the nearby-orders load goes through the shared
// data_layer.loadResource adapter (the per-screen wrapper was consolidated in
// 02A). The read is passed by reference and awaited inside loadResource, so the
// same contract holds when listNearbyOrders() becomes a real (async, rejectable)
// backend call — today it resolves from the mock store and does not reject, so
// the failure path is dormant. loadResource reports server_error with a guarded
// retry and falls back to [] — the screen's own empty state (buildEmptyCard) is
// preserved (the overlay is additive); 'retrying' on retry, dismiss only on a
// successful reload (guarded by onlyIfState). Both reads — the working-surface
// renderList and the readiness gate — pass their own retry callback.

export default async function driverMapScreen() {
  // BD-ROLE-01 — only role=driver sees the working DriverMap. Any other
  // role (passenger, guest, null) gets a safe Cloud fallback so the
  // passenger flow can never leak into driver-side actions like
  // "Принять" or the "заказов рядом" working feed.
  const role = resolveEffectiveRole();
  if (role !== 'driver') {
    return renderPassengerGuard();
  }

  const root = document.createElement('section');
  root.className = 'screen screen--map screen--driver-map';
  root.dataset.state = STATE.LIST;
  root.dataset.role = 'driver';

  root.appendChild(buildTopbar());

  const stage = buildStage(0);
  root.appendChild(stage);

  const sheetSlot = document.createElement('div');
  sheetSlot.className = 'driver-map__sheet-slot';
  root.appendChild(sheetSlot);

  // BD-DRIVER-02 — readiness gate. A driver who is not isDriverLineReady()
  // (the same rule Profile enforces) never reaches the working accept surface:
  // the stage dims, the sheet shows the readiness banner + checklist, orders
  // render LOCKED, and "Завершить готовность" routes to /profile. No accept
  // wiring is attached in this branch, so an order can't be taken from here.
  const u = user.get();

  // BD-ERROR-01C-F — the readiness gate's locked-order decoration is also a
  // nearby-orders read, so it carries the same guarded retry as the working
  // list: a failed load reports server_error with onReadinessRetry, and tapping
  // «Повторить» re-renders the gate (without a retry callback the overlay button
  // would just dismiss — app_error_overlay.js). renderReadinessGate is hoisted;
  // the const onReadinessRetry must be initialised before the first gate render.
  const onReadinessRetry = () => { renderReadinessGate(true); };
  async function renderReadinessGate(isRetry) {
    root.dataset.state = STATE.NOT_READY;
    stage.replaceChildren(buildMapPlaceholder(0, { variant: MAP_VARIANT.EMPTY, dimmed: true }));
    sheetSlot.replaceChildren(buildReadinessGate(user.get(), await loadResource(listNearbyOrders, { onRetry: onReadinessRetry, isRetry })));
  }

  if (!isDriverLineReady(u)) {
    await renderReadinessGate(false);

    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn || btn.disabled) return;
      const action = btn.dataset.action;
      if (action === 'complete-readiness') {
        go('/profile');
      } else if (action === 'feed') {
        go('/feed');
      } else if (action === 'map') {
        go('/map');
      }
    });

    return root;
  }

  // Retry re-runs the load and re-renders into the same root (renderList
  // replaces stage + sheetSlot). renderList is hoisted, so referencing it from
  // onDriverMapRetry before its declaration is safe — the arrow only runs when
  // the user taps «Повторить».
  const onDriverMapRetry = () => { renderList(true); };
  async function renderList(isRetry) {
    const live = await loadResource(listNearbyOrders, { onRetry: onDriverMapRetry, isRetry });
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
    // #732 — move focus to the «Заказ принят» status badge so SR / keyboard users are told the
    // order was accepted (a major content swap → focus management) instead of a focus lost where
    // the «Принять» button used to be.
    const acceptedBadge = sheetSlot.querySelector('.bd-badge.success');
    if (acceptedBadge && typeof acceptedBadge.focus === 'function') acceptedBadge.focus();
  }

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.action;

    if (action === 'accept') {
      // BD-DRIVER-02 — re-check readiness at accept time. The list rendered
      // while line-ready, but readiness can be revoked between render and tap
      // (e.g. the waybill is closed in another tab). If so, swap to the gate
      // and bail WITHOUT calling acceptCanonicalRideOrder — the order must not
      // be mutated by a no-longer-ready driver.
      if (!isDriverLineReady(user.get())) {
        await renderReadinessGate(false);
        return;
      }
      const id = btn.dataset.orderId;
      // BD-LIFE-06 — tag the seeded ride with the actual accept surface so
      // ride.acceptedSource is accurate, not the misleading 'driver_map'
      // default that previously labelled every canonical accept.
      const result = acceptCanonicalRideOrder(id, { acceptedSource: 'driver_map' });
      if (result) {
        renderAccepted(result.order, result.tripId);
      } else {
        // Stale row (e.g. already accepted in another tab) — route
        // to the order draft flow so the driver can publish a fresh
        // local order to accept.
        go('/order-map-draft');
      }
    } else if (action === 'complete-readiness') {
      // Reachable once the accept-time re-check above swaps the gate into this
      // (originally ready) surface — keep the gate's CTA / locked rows live.
      go('/profile');
    } else if (action === 'create-order') {
      // BD-MAP-08 — "Создать тестовый заказ" must seed a visible order from
      // the driver surface itself. It cannot route to /order-map-draft: that
      // is a PASSENGER_ORDER_ROUTE and the router (BD-ROLE-01) bounces a
      // driver straight back to /driver-map, so the button never produced a
      // CREATED order and the nearby list stayed empty forever. Instead create
      // the order inline through the same canonical createRideOrder() contract
      // /order-map-draft uses (status CREATED → bazardrive.ride_orders.v1) and
      // re-render so it surfaces immediately. The self-contained passenger
      // snapshot keeps the later accept → active-ride handoff off the demo
      // "Анна М." seed.
      try {
      await createRideOrder({
        type: 'passenger_request',
        source: 'map',
        // #717 — driver-surface TEST order: must NOT count toward the driver's
        // completed-passenger-trip metric (countCompletedPassengerTrips).
        createdByRole: 'driver',
        pickup: { id: null, label: 'Тестовая точка подачи' },
        dropoff: { id: null, label: 'Тестовая точка назначения' },
        distanceKm: 6.4,
        durationMin: 18,
        estimatedPrice: 420,
        comment: 'Тестовый заказ для проверки DriverMap',
        passenger: {
          name: 'Тестовый пассажир',
          initials: 'ТП',
          phoneMasked: '+7 ··· ···-00-00',
          comment: 'Тестовый заказ для проверки DriverMap',
        },
      });
      } catch { /* #784 CUT-3: live POST failed — no unhandled rejection; the re-render shows current state */ }
      renderList();
    } else if (action === 'map') {
      go('/map');
    } else if (action === 'feed') {
      go('/feed');
    } else if (action === 'active-ride') {
      const tripId = btn.dataset.tripId;
      const query = tripId
        ? `tripId=${encodeURIComponent(tripId)}&status=ACCEPTED`
        : 'status=ACCEPTED';
      go(`/active-ride?role=driver&${query}`);
    } else if (action === 'driver-map') {
      renderList();
    }
  });

  await renderList(false);
  return root;
}
