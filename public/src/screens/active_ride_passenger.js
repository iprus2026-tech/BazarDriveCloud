// BD-RIDE-P-02 — Passenger active ride · DRIVER_EN_ROUTE state.
// Mock/UI only. No Mapbox SDK, no token, no backend, no geolocation,
// no real calls, no real payments, no push.

import { escapeHtml } from '../util.js';
import { go } from '../router.js';
import {
  findActiveRide,
  createDemoActiveRide,
  RIDE_STATUS,
  DEMO_ACTIVE_RIDE_ID,
} from '../ride_state.js';
import { createMapShell } from '../mapbox/map_shell.js';

const CHEVRON_UP_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <polyline points="6 15 12 9 18 15"/>
</svg>`;

const CHEVRON_RIGHT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="16" height="16">
  <polyline points="9 6 15 12 9 18"/>
</svg>`;

const SHIELD_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
</svg>`;

const MESSAGE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>
</svg>`;

const PHONE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.56 2.81.69A2 2 0 0 1 22 16.92z"/>
</svg>`;

const PENCIL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="16" height="16">
  <path d="M12 20h9"/>
  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>
</svg>`;

const CARD_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
  <rect x="2" y="6" width="20" height="14" rx="2"/>
  <line x1="2" y1="11" x2="22" y2="11"/>
</svg>`;

const PIN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
  <circle cx="12" cy="10" r="3"/>
</svg>`;

const SOS_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
  <line x1="12" y1="9" x2="12" y2="13"/>
  <line x1="12" y1="17" x2="12.01" y2="17"/>
</svg>`;

const SHARE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <circle cx="18" cy="5" r="3"/>
  <circle cx="6" cy="12" r="3"/>
  <circle cx="18" cy="19" r="3"/>
  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
</svg>`;

const TRIP_NUMBER_FALLBACK = '№48-321';

// View-only: never persists status. The driver flow owns the canonical
// ride lifecycle; the passenger view derives a display status without
// touching shared state for DEMO_ACTIVE_RIDE_ID. Falls back to an
// in-memory demo ride so we don't materialize anything into localStorage.
function loadPassengerRideView(tripId) {
  let ride = findActiveRide(tripId);
  if (!ride) {
    ride = createDemoActiveRide({ tripId });
  }
  if (ride.status === RIDE_STATUS.NEW_ORDER) {
    return { ...ride, status: RIDE_STATUS.DRIVER_EN_ROUTE };
  }
  return ride;
}

// DRIVER_APPROACHING_PICKUP is accepted as an alias to DRIVER_EN_ROUTE
// for the passenger UI — BD-RIDE-P-02 currently renders the same layout
// for both phases.
function applyPassengerStatusFromQuery(ride, statusQuery) {
  if (!statusQuery) return ride;
  if (statusQuery !== RIDE_STATUS.DRIVER_EN_ROUTE
    && statusQuery !== RIDE_STATUS.DRIVER_APPROACHING_PICKUP) {
    return ride;
  }
  if (ride.status === RIDE_STATUS.DRIVER_EN_ROUTE) return ride;
  const ts = ride.timestamps || {};
  if (ts.arrivedAt || ts.startedAt || ts.completedAt || ts.canceledAt) {
    return ride;
  }
  return { ...ride, status: RIDE_STATUS.DRIVER_EN_ROUTE };
}

function formatTripNumber(tripId) {
  if (typeof tripId !== 'string' || !tripId) return TRIP_NUMBER_FALLBACK;
  // Demo trip id is human-unfriendly — keep the design's №48-321 in that case.
  if (tripId === DEMO_ACTIVE_RIDE_ID) return TRIP_NUMBER_FALLBACK;
  return `№${tripId}`;
}

function carLine(ride) {
  const v = (ride && ride.vehicle) || {};
  const parts = [];
  const model = v.model || 'Toyota Camry';
  parts.push(model);
  parts.push(v.color || 'серый');
  parts.push(v.plate || 'А 124 ВВ 77');
  return parts.join(' · ');
}

function driverSubtitle(ride) {
  const v = (ride && ride.vehicle) || {};
  const model = v.model || 'Toyota Camry';
  const color = v.color || 'серый';
  const experience = (ride && ride.driver && ride.driver.experience) || '4 года н…';
  return `${model} · ${color} · ${experience}`;
}

function paymentInfo(ride) {
  const pay = (ride && ride.payment) || {};
  return {
    last4: pay.last4 || '4417',
    method: pay.method || 'Тинькофф',
    note: pay.note || 'Оплата автоматически после поездки',
    amount: pay.amount || (ride && ride.order && ride.order.offerPrice) || '1 480 ₽',
  };
}

function etaText(ride) {
  const eta = (ride && ride.order && ride.order.pickupEta) || '4 мин';
  return eta.replace(/\s*мин(уты?|у)?$/i, ' мин');
}

// BD-RIDE-P-02 only covers DRIVER_EN_ROUTE. Other passenger-side stages
// (waiting / in-progress / completed / canceled) get a placeholder so we
// don't show "Водитель едет к вам" with the wrong actions when the ride
// has already moved on.
const PASSENGER_SUPPORTED_STATUSES = new Set([
  RIDE_STATUS.DRIVER_EN_ROUTE,
  RIDE_STATUS.DRIVER_APPROACHING_PICKUP,
]);

const PASSENGER_STUB_BY_STATUS = {
  [RIDE_STATUS.WAITING_PASSENGER]: 'Водитель ждёт вас — экран будет добавлен позже',
  [RIDE_STATUS.IN_PROGRESS]: 'Поездка идёт — экран будет добавлен позже',
  [RIDE_STATUS.COMPLETED]: 'Поездка завершена — экран будет добавлен позже',
  [RIDE_STATUS.CANCELED]: 'Поездка отменена — экран будет добавлен позже',
  [RIDE_STATUS.NO_SHOW]: 'Поездка отменена — экран будет добавлен позже',
};

function renderPassengerStub(message) {
  const root = document.createElement('section');
  root.className = 'screen screen--active-ride';
  const text = message || 'Этот этап поездки будет добавлен позже';
  root.innerHTML = `
    <div class="active-ride__passenger-placeholder" role="status" aria-live="polite">
      <div class="active-ride__passenger-placeholder-text">${escapeHtml(text)}</div>
    </div>
  `;
  return root;
}

export default function activeRidePassenger(options = {}) {
  const tripId = (options && options.tripId) || DEMO_ACTIVE_RIDE_ID;
  const statusQuery = (options && options.statusQuery) || null;
  const showNotice = typeof options.showNotice === 'function'
    ? options.showNotice
    : null;

  let ride = loadPassengerRideView(tripId);
  ride = applyPassengerStatusFromQuery(ride, statusQuery);

  if (!PASSENGER_SUPPORTED_STATUSES.has(ride.status)) {
    return renderPassengerStub(PASSENGER_STUB_BY_STATUS[ride.status]);
  }

  const root = document.createElement('section');
  root.className = 'screen screen--active-ride active-ride-passenger';

  // ── Map layer ────────────────────────────────────────────
  const mapWrap = document.createElement('div');
  mapWrap.className = 'active-ride__map';
  const mapEl = createMapShell({
    variant: 'passenger',
    status: ride.status,
    route: ride.route,
  });
  mapWrap.appendChild(mapEl);
  root.appendChild(mapWrap);

  // ── Top overlay (chevron · trip number · shield) ─────────
  const top = document.createElement('div');
  top.className = 'active-ride__top active-ride-passenger__top';
  top.innerHTML = `
    <div class="active-ride-passenger__top-row">
      <button type="button" class="bd-iconbtn active-ride__icon-btn active-ride-passenger__chevron" id="arp-collapse" aria-label="Свернуть">
        ${CHEVRON_UP_SVG}
      </button>
      <div class="active-ride-passenger__trip-pill" role="status" aria-live="polite">
        <span class="active-ride-passenger__trip-label">Поездка ${escapeHtml(formatTripNumber(ride.tripId))}</span>
      </div>
      <button type="button" class="bd-iconbtn active-ride__icon-btn active-ride-passenger__shield" id="arp-shield" aria-label="Безопасность">
        ${SHIELD_SVG}
      </button>
    </div>
  `;
  root.appendChild(top);

  // ── Sheet ────────────────────────────────────────────────
  const sheet = document.createElement('div');
  sheet.className = 'active-ride__sheet active-ride-passenger__sheet';
  sheet.dataset.status = ride.status;
  root.appendChild(sheet);

  // ── Toast ────────────────────────────────────────────────
  const notice = document.createElement('div');
  notice.className = 'active-ride__notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.hidden = true;
  root.appendChild(notice);

  let noticeTimer = null;
  function toast(message) {
    if (showNotice) { showNotice(message); return; }
    notice.textContent = message;
    notice.hidden = false;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 3500);
  }

  // ── Sheet content ────────────────────────────────────────
  const pay = paymentInfo(ride);
  const pickup = (ride.route && ride.route.pickupLabel) || 'ул. Малая Бронная, 28';
  const dropoff = (ride.route && ride.route.dropoffLabel) || 'Аэропорт Шереметьево, терминал В';
  const driverName = (ride.driver && ride.driver.name) || 'Рустам К.';
  const driverInitials = (ride.driver && ride.driver.initials) || 'РК';
  const driverRating = (ride.driver && ride.driver.rating) || '4,92';
  const rawUnread = ride.chat && ride.chat.unread;
  const unreadCount = Number.isFinite(Number(rawUnread)) && rawUnread != null
    ? Number(rawUnread)
    : 2;
  const chatLabel = unreadCount > 0
    ? `Написать водителю · ${unreadCount} непрочитанных`
    : 'Написать водителю';

  sheet.innerHTML = `
    <div class="active-ride-passenger__handle" aria-hidden="true"></div>

    <div class="active-ride-passenger__header">
      <div class="active-ride-passenger__header-main">
        <div class="active-ride-passenger__title">Водитель едет к вам</div>
        <div class="active-ride-passenger__car">${escapeHtml(carLine(ride))}</div>
      </div>
      <div class="active-ride-passenger__eta" aria-label="Время прибытия">
        <div class="active-ride-passenger__eta-value">${escapeHtml(etaText(ride))}</div>
        <div class="active-ride-passenger__eta-label">до места</div>
      </div>
    </div>

    <div class="active-ride-passenger__driver-row">
      <div class="active-ride-passenger__avatar" aria-hidden="true">${escapeHtml(driverInitials)}</div>
      <div class="active-ride-passenger__driver-info">
        <div class="active-ride-passenger__driver-name">
          ${escapeHtml(driverName)}
          <span class="active-ride-passenger__driver-rating">★ ${escapeHtml(driverRating)}</span>
        </div>
        <div class="active-ride-passenger__driver-sub">${escapeHtml(driverSubtitle(ride))}</div>
      </div>
      <div class="active-ride-passenger__driver-actions">
        <button type="button" class="active-ride-passenger__icon-action" id="arp-chat" aria-label="${escapeHtml(chatLabel)}">
          ${MESSAGE_SVG}
          ${unreadCount > 0
            ? `<span class="active-ride-passenger__chat-badge" aria-hidden="true">${escapeHtml(String(unreadCount))}</span>`
            : ''}
        </button>
        <button type="button" class="active-ride-passenger__icon-action" id="arp-call" aria-label="Позвонить водителю">
          ${PHONE_SVG}
        </button>
      </div>
    </div>

    <div class="active-ride-passenger__route">
      <ul class="active-ride-passenger__route-list" role="list">
        <li class="active-ride-passenger__route-point active-ride-passenger__route-point--pickup">
          <div class="active-ride-passenger__route-label">ОТКУДА</div>
          <div class="active-ride-passenger__route-main">${escapeHtml(pickup)}</div>
        </li>
        <li class="active-ride-passenger__route-point active-ride-passenger__route-point--dropoff">
          <div class="active-ride-passenger__route-label">КУДА</div>
          <div class="active-ride-passenger__route-main">${escapeHtml(dropoff)}</div>
        </li>
      </ul>
      <button type="button" class="active-ride-passenger__route-edit" id="arp-edit-route" aria-label="Изменить маршрут">
        ${PENCIL_SVG}
      </button>
    </div>

    <div class="active-ride-passenger__payment" role="group" aria-label="Способ оплаты">
      <div class="active-ride-passenger__payment-icon" aria-hidden="true">${CARD_SVG}</div>
      <div class="active-ride-passenger__payment-body">
        <div class="active-ride-passenger__payment-title">•• ${escapeHtml(pay.last4)} · ${escapeHtml(pay.method)}</div>
        <div class="active-ride-passenger__payment-note">${escapeHtml(pay.note)}</div>
      </div>
      <div class="active-ride-passenger__payment-amount">${escapeHtml(pay.amount)}</div>
      <div class="active-ride-passenger__payment-chevron" aria-hidden="true">${CHEVRON_RIGHT_SVG}</div>
    </div>

    <div class="active-ride-passenger__primary-actions">
      <button type="button" class="bd-btn ghost active-ride-passenger__btn-sec" id="arp-refine">
        <span class="active-ride-passenger__btn-ic" aria-hidden="true">${PIN_SVG}</span>
        Уточнить место
      </button>
      <button type="button" class="bd-btn ghost active-ride-passenger__btn-cancel" id="arp-cancel">Отменить</button>
    </div>

    <div class="active-ride-passenger__secondary-actions">
      <button type="button" class="bd-btn ghost active-ride-passenger__btn-sos" id="arp-sos">
        <span class="active-ride-passenger__btn-ic" aria-hidden="true">${SOS_SVG}</span>
        SOS
      </button>
      <button type="button" class="bd-btn ghost active-ride-passenger__btn-share" id="arp-share">
        <span class="active-ride-passenger__btn-ic" aria-hidden="true">${SHARE_SVG}</span>
        Поделиться поездкой
      </button>
    </div>
  `;

  // ── Handlers ─────────────────────────────────────────────
  top.querySelector('#arp-collapse').addEventListener('click', () => {
    toast('Сворачивание панели будет добавлено позже');
  });
  top.querySelector('#arp-shield').addEventListener('click', () => {
    toast('Безопасность будет добавлена позже');
  });

  sheet.querySelector('#arp-chat').addEventListener('click', () => {
    go(`/chat?tripId=${encodeURIComponent(ride.tripId)}`);
  });
  sheet.querySelector('#arp-call').addEventListener('click', () => {
    toast('Звонок водителю пока заглушка');
  });
  sheet.querySelector('#arp-edit-route').addEventListener('click', () => {
    toast('Редактирование маршрута будет добавлено позже');
  });
  sheet.querySelector('#arp-refine').addEventListener('click', () => {
    toast('Уточнение места подачи будет добавлено позже');
  });
  sheet.querySelector('#arp-cancel').addEventListener('click', () => {
    toast('Отмена поездки будет реализована позже');
  });
  sheet.querySelector('#arp-sos').addEventListener('click', () => {
    toast('Экран SOS будет добавлен позже');
  });
  sheet.querySelector('#arp-share').addEventListener('click', () => {
    toast('Поделиться поездкой пока заглушка');
  });

  return root;
}
