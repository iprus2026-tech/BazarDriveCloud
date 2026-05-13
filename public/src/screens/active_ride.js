// BD-RIDE-D-01 — Driver active ride foundation screen.
// Mock/foundation only. No Mapbox SDK, no token, no backend, no geolocation,
// no real calls, no payments, no push, no packages.

import { escapeHtml } from '../util.js';
import {
  getActiveRide,
  updateActiveRideStatus,
  saveActiveRide,
  RIDE_STATUS,
  DEMO_ACTIVE_RIDE_ID,
} from '../ride_state.js';
import { createMapShell } from '../mapbox/map_shell.js';

const GEAR_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <circle cx="12" cy="12" r="3"/>
  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
</svg>`;

const SHIELD_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
</svg>`;

const ARROW_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <line x1="5" y1="12" x2="19" y2="12"/>
  <polyline points="12 5 19 12 12 19"/>
</svg>`;

function getHashQuery() {
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  if (qi === -1) return new URLSearchParams();
  return new URLSearchParams(hash.slice(qi + 1));
}

function safeApplyStatusFromQuery(ride, statusQuery) {
  if (!statusQuery) return ride;
  if (statusQuery !== RIDE_STATUS.NEW_ORDER) return ride;
  if (ride.status === RIDE_STATUS.NEW_ORDER) return ride;
  // Only switch back to NEW_ORDER if no acceptance has happened yet — safe.
  const ts = ride.timestamps || {};
  if (ts.acceptedAt || ts.arrivedAt || ts.startedAt || ts.completedAt || ts.canceledAt) {
    return ride;
  }
  const next = { ...ride, status: RIDE_STATUS.NEW_ORDER };
  return saveActiveRide(next);
}

function renderPassengerPlaceholder() {
  const root = document.createElement('section');
  root.className = 'screen screen--active-ride';
  root.innerHTML = `
    <div class="active-ride__passenger-placeholder" role="status" aria-live="polite">
      <div class="active-ride__passenger-placeholder-text">
        Экран пассажира будет добавлен позже
      </div>
    </div>
  `;
  return root;
}

export default function activeRide() {
  const query = getHashQuery();
  const role = query.get('role') || 'driver';

  if (role === 'passenger') {
    return renderPassengerPlaceholder();
  }

  const tripId = query.get('tripId') || DEMO_ACTIVE_RIDE_ID;
  const statusQuery = query.get('status');

  let ride = getActiveRide(tripId);
  ride = safeApplyStatusFromQuery(ride, statusQuery);

  const root = document.createElement('section');
  root.className = 'screen screen--active-ride';

  // ── Map layer ──────────────────────────────────────────────
  const mapWrap = document.createElement('div');
  mapWrap.className = 'active-ride__map';
  const mapEl = createMapShell({
    variant: 'driver',
    status: ride.status,
    route: ride.route,
  });
  mapWrap.appendChild(mapEl);
  root.appendChild(mapWrap);

  // ── Top dashboard overlay ──────────────────────────────────
  const top = document.createElement('div');
  top.className = 'active-ride__top';
  top.innerHTML = `
    <div class="active-ride__status-row">
      <button type="button" class="bd-iconbtn active-ride__icon-btn" id="ar-gear" aria-label="Настройки смены">
        ${GEAR_SVG}
      </button>
      <div class="active-ride__status-pill" role="status" aria-live="polite">
        <span class="active-ride__status-dot" aria-hidden="true"></span>
        <span class="active-ride__status-text">${escapeHtml(ride.driver?.onlineLabel || 'На линии')}</span>
        <span class="active-ride__status-sep" aria-hidden="true">|</span>
        <span class="active-ride__status-time">${escapeHtml(ride.driver?.shiftDuration || '5ч 12м')}</span>
      </div>
      <button type="button" class="bd-iconbtn active-ride__icon-btn" id="ar-shield" aria-label="Безопасность">
        ${SHIELD_SVG}
      </button>
    </div>
    <div class="active-ride__stats" role="group" aria-label="Статистика смены">
      <div class="active-ride__stat">
        <div class="active-ride__stat-value">${escapeHtml(ride.ride?.todayEarnings || '0 ₽')}</div>
        <div class="active-ride__stat-label">сегодня</div>
      </div>
      <div class="active-ride__stat">
        <div class="active-ride__stat-value">${escapeHtml(String(ride.ride?.tripsToday ?? 0))}</div>
        <div class="active-ride__stat-label">поездок</div>
      </div>
      <div class="active-ride__stat">
        <div class="active-ride__stat-value">★ ${escapeHtml(ride.ride?.rating || '—')}</div>
        <div class="active-ride__stat-label">рейтинг</div>
      </div>
    </div>
  `;
  root.appendChild(top);

  // ── Bottom sheet container ────────────────────────────────
  const sheet = document.createElement('div');
  sheet.className = 'active-ride__sheet';
  root.appendChild(sheet);

  // ── Notice toast ──────────────────────────────────────────
  const notice = document.createElement('div');
  notice.className = 'active-ride__notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.hidden = true;
  root.appendChild(notice);

  let noticeTimer = null;
  function showNotice(message) {
    notice.textContent = message;
    notice.hidden = false;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 3500);
  }

  // ── Top dashboard handlers ────────────────────────────────
  top.querySelector('#ar-gear').addEventListener('click', () => {
    showNotice('Настройки смены будут добавлены позже');
  });
  top.querySelector('#ar-shield').addEventListener('click', () => {
    showNotice('Безопасность будет добавлена позже');
  });

  // ── Sheet renderers ───────────────────────────────────────
  function renderSheet() {
    sheet.replaceChildren();
    sheet.dataset.status = ride.status;

    if (ride.status === RIDE_STATUS.NEW_ORDER) {
      renderNewOrder();
    } else if (ride.status === RIDE_STATUS.DRIVER_EN_ROUTE
            || ride.status === RIDE_STATUS.DRIVER_APPROACHING_PICKUP) {
      renderEnRoute();
    } else if (ride.status === RIDE_STATUS.WAITING_PASSENGER) {
      renderWaitingStub();
    } else if (ride.status === RIDE_STATUS.CANCELED
            || ride.status === RIDE_STATUS.NO_SHOW) {
      renderCanceledStub();
    } else {
      renderGenericStub();
    }
  }

  function renderNewOrder() {
    const order = ride.order || {};
    const tagsHtml = (order.tags || [])
      .map((t) => `<span class="active-ride__tag">${escapeHtml(t)}</span>`)
      .join('');

    sheet.innerHTML = `
      <div class="active-ride__sheet-head">
        <div class="active-ride__sheet-title">
          <span class="active-ride__sheet-bullet" aria-hidden="true">●</span>
          НОВЫЙ ЗАКАЗ
        </div>
        <div class="active-ride__timer" aria-label="Время на принятие заказа">
          ${escapeHtml(String(order.acceptTimerSec ?? 14))}
        </div>
      </div>

      <div class="active-ride__price-row">
        <div class="active-ride__price-col">
          <div class="active-ride__price">${escapeHtml(order.offerPrice || '')}</div>
          <div class="active-ride__meta">
            ${escapeHtml(order.rate || '')} · комиссия ${escapeHtml(order.commission || '')}
          </div>
        </div>
        <button type="button" class="active-ride__map-btn" id="ar-map-btn">Карта</button>
      </div>

      <ul class="active-ride__route-list" role="list">
        <li class="active-ride__route-point active-ride__route-point--pickup">
          <div class="active-ride__route-time">${escapeHtml(order.pickupEta || '')}</div>
          <div class="active-ride__route-body">
            <div class="active-ride__route-main">${escapeHtml(ride.route?.pickupLabel || '')}</div>
            <div class="active-ride__route-sub">${escapeHtml(order.pickupDistance || '')} до пассажира</div>
          </div>
        </li>
        <li class="active-ride__route-point active-ride__route-point--dropoff">
          <div class="active-ride__route-time">${escapeHtml(order.destinationEta || '')}</div>
          <div class="active-ride__route-body">
            <div class="active-ride__route-main">${escapeHtml(ride.route?.dropoffLabel || '')}</div>
            <div class="active-ride__route-sub">${escapeHtml(order.destinationDistance || '')} · ${escapeHtml(order.destinationNote || '')}</div>
          </div>
        </li>
      </ul>

      ${tagsHtml ? `<div class="active-ride__tags" role="list">${tagsHtml}</div>` : ''}

      <div class="active-ride__actions">
        <button type="button" class="bd-btn ghost active-ride__btn-skip" id="ar-skip">Пропустить</button>
        <button type="button" class="bd-btn primary active-ride__btn-accept" id="ar-accept">Принять заказ</button>
      </div>
    `;

    sheet.querySelector('#ar-map-btn').addEventListener('click', () => {
      showNotice('Детальная карта будет доступна после Mapbox integration');
    });
    sheet.querySelector('#ar-accept').addEventListener('click', () => {
      ride = updateActiveRideStatus(ride.tripId, RIDE_STATUS.DRIVER_EN_ROUTE);
      renderSheet();
    });
    sheet.querySelector('#ar-skip').addEventListener('click', () => {
      showNotice('Заказ пропущен. Полный idle-flow будет добавлен позже.');
    });
  }

  function renderEnRoute() {
    const passenger = ride.passenger || {};
    sheet.innerHTML = `
      <div class="active-ride__sheet-head">
        <div class="active-ride__sheet-title">Едете к пассажиру</div>
        <div class="active-ride__pickup-eta" aria-label="Время до подачи">
          <div class="active-ride__pickup-eta-value">${escapeHtml(ride.order?.pickupEta || '')}</div>
          <div class="active-ride__pickup-eta-label">до подачи</div>
        </div>
      </div>

      <div class="active-ride__meta active-ride__meta--head">
        ${escapeHtml(ride.order?.pickupDistance || '')} · ${escapeHtml(ride.route?.pickupLabel || '')}
      </div>

      <div class="active-ride__nav-card">
        <div class="active-ride__nav-icon" aria-hidden="true">${ARROW_SVG}</div>
        <div class="active-ride__nav-body">
          <div class="active-ride__nav-main">${escapeHtml(ride.route?.currentInstruction || '')}</div>
          <div class="active-ride__nav-sub">${escapeHtml(ride.route?.currentStreet || '')}</div>
        </div>
        <button type="button" class="active-ride__map-btn" id="ar-map-btn">Навигатор</button>
      </div>

      <div class="active-ride__passenger-row">
        <div class="active-ride__avatar" aria-hidden="true">${escapeHtml(passenger.initials || 'АМ')}</div>
        <div class="active-ride__passenger-info">
          <div class="active-ride__passenger-name">
            ${escapeHtml(passenger.name || '')}
            <span class="active-ride__passenger-rating">★ ${escapeHtml(passenger.rating || '')}</span>
          </div>
          <div class="active-ride__passenger-meta">
            ${escapeHtml(passenger.phoneMasked || '')} · ${escapeHtml(passenger.luggage || '')}
          </div>
        </div>
      </div>

      <div class="active-ride__actions active-ride__actions--stack">
        <button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-arrived">Я на месте</button>
        <div class="active-ride__actions-row">
          <button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-write">Написать «подъезжаю»</button>
          <button type="button" class="bd-btn ghost active-ride__btn-cancel" id="ar-cancel">Отменить</button>
        </div>
      </div>
    `;

    sheet.querySelector('#ar-map-btn').addEventListener('click', () => {
      showNotice('Детальная карта будет доступна после Mapbox integration');
    });
    sheet.querySelector('#ar-arrived').addEventListener('click', () => {
      ride = updateActiveRideStatus(ride.tripId, RIDE_STATUS.WAITING_PASSENGER);
      renderSheet();
      showNotice('Ожидание пассажира будет реализовано следующим PR');
    });
    sheet.querySelector('#ar-write').addEventListener('click', () => {
      showNotice('Сообщение «подъезжаю» будет реализовано позже');
    });
    sheet.querySelector('#ar-cancel').addEventListener('click', () => {
      showNotice('Отмена поездки будет реализована позже');
    });
  }

  function renderWaitingStub() {
    const passenger = ride.passenger || {};
    sheet.innerHTML = `
      <div class="active-ride__sheet-head">
        <div class="active-ride__sheet-title">Ожидание пассажира</div>
      </div>
      <div class="active-ride__meta active-ride__meta--head">
        ${escapeHtml(ride.route?.pickupLabel || '')}
      </div>
      <div class="active-ride__passenger-row">
        <div class="active-ride__avatar" aria-hidden="true">${escapeHtml(passenger.initials || 'АМ')}</div>
        <div class="active-ride__passenger-info">
          <div class="active-ride__passenger-name">${escapeHtml(passenger.name || '')}</div>
          <div class="active-ride__passenger-meta">${escapeHtml(passenger.phoneMasked || '')}</div>
        </div>
      </div>
      <div class="active-ride__stub">
        Ожидание пассажира будет реализовано следующим PR
      </div>
    `;
  }

  function renderCanceledStub() {
    sheet.innerHTML = `
      <div class="active-ride__sheet-head">
        <div class="active-ride__sheet-title">Заказ отменён</div>
      </div>
      <div class="active-ride__stub">
        Полный flow отмены будет добавлен позже
      </div>
    `;
  }

  function renderGenericStub() {
    sheet.innerHTML = `
      <div class="active-ride__sheet-head">
        <div class="active-ride__sheet-title">Поездка</div>
      </div>
      <div class="active-ride__stub">
        Этот этап поездки будет реализован позже
      </div>
    `;
  }

  renderSheet();
  return root;
}
