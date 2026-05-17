// BD-RIDE-P-02 / BD-RIDE-P-03 / BD-RIDE-P-04 / BD-RIDE-P-05 — Passenger
// active ride. Supports DRIVER_EN_ROUTE (Водитель едет к вам),
// WAITING_PASSENGER (Водитель ждёт вас), IN_PROGRESS (В пути) and
// COMPLETED (Поездка завершена + оценка). Mock/UI only. No Mapbox SDK,
// no token, no backend, no geolocation, no real calls, no real
// payments, no push.

import { escapeHtml } from '../util.js';
import { go } from '../router.js';
import {
  findActiveRide,
  createDemoActiveRide,
  updateActiveRideStatus,
  saveActiveRide,
  SIM_AUDIT_RIDE_OVERRIDES,
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

const CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <polyline points="20 6 9 17 4 12"/>
</svg>`;

const PLUS_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <line x1="12" y1="5" x2="12" y2="19"/>
  <line x1="5" y1="12" x2="19" y2="12"/>
</svg>`;

const TRIP_NUMBER_FALLBACK = '№48-321';

// BD-RIDE-P-04B — In-progress sub-phases. Used as a UI overlay on top
// of RIDE_STATUS.IN_PROGRESS so the driver flow's canonical lifecycle
// keeps a single status. ARRIVING_DROPOFF = подъезжаем к точке высадки.
// TODO: ARRIVING_DROPOFF is currently activated only via ?phase= in the
// URL. Once live trip progress / route-progress events / backend signals
// are wired up, the host should derive this phase from real telemetry
// instead of relying on a manual query param.
const PASSENGER_IN_PROGRESS_PHASE = {
  ARRIVING_DROPOFF: 'ARRIVING_DROPOFF',
};

function normalizePhase(phaseQuery) {
  if (!phaseQuery) return null;
  const key = String(phaseQuery).trim().toUpperCase();
  if (key === PASSENGER_IN_PROGRESS_PHASE.ARRIVING_DROPOFF) {
    return PASSENGER_IN_PROGRESS_PHASE.ARRIVING_DROPOFF;
  }
  return null;
}

// View-only: never persists status by default. The driver flow owns the
// canonical ride lifecycle; the passenger view derives a display status
// without touching shared state for DEMO_ACTIVE_RIDE_ID. Falls back to an
// in-memory demo ride so we don't materialize anything into localStorage
// just for rendering. When a simulation/audit URL supplies ?status=,
// the in-memory demo is seeded with SIM_AUDIT_RIDE_OVERRIDES so the
// passenger and driver sides agree on the BD-RIDE-SIM-01 scenario data
// (passenger name, route, price, note) — important for the
// passenger-cancel → driver-canceled flow that needs the same identity
// to be persisted later.
function loadPassengerRideView(tripId, statusQuery) {
  let ride = findActiveRide(tripId);
  if (!ride) {
    const overrides = statusQuery ? SIM_AUDIT_RIDE_OVERRIDES : {};
    ride = createDemoActiveRide({ tripId, ...overrides });
  }
  if (ride.status === RIDE_STATUS.NEW_ORDER) {
    return { ...ride, status: RIDE_STATUS.DRIVER_EN_ROUTE };
  }
  return ride;
}

// DRIVER_APPROACHING_PICKUP is accepted as an alias to DRIVER_EN_ROUTE
// for the passenger UI — BD-RIDE-P-02 currently renders the same layout
// for both phases. WAITING_PASSENGER is the BD-RIDE-P-03 driver-arrived
// view. IN_PROGRESS is the BD-RIDE-P-04 on-ride view. Status overrides
// are kept in-memory and do not roll back past later lifecycle
// timestamps already on the ride.
function applyPassengerStatusFromQuery(ride, statusQuery) {
  if (!statusQuery) return ride;
  const ts = ride.timestamps || {};
  if (statusQuery === RIDE_STATUS.DRIVER_EN_ROUTE
    || statusQuery === RIDE_STATUS.DRIVER_APPROACHING_PICKUP) {
    if (ride.status === RIDE_STATUS.DRIVER_EN_ROUTE) return ride;
    if (ts.arrivedAt || ts.startedAt || ts.completedAt || ts.canceledAt) {
      return ride;
    }
    return { ...ride, status: RIDE_STATUS.DRIVER_EN_ROUTE };
  }
  if (statusQuery === RIDE_STATUS.WAITING_PASSENGER) {
    if (ride.status === RIDE_STATUS.WAITING_PASSENGER) return ride;
    if (ts.startedAt || ts.completedAt || ts.canceledAt) return ride;
    return { ...ride, status: RIDE_STATUS.WAITING_PASSENGER };
  }
  if (statusQuery === RIDE_STATUS.IN_PROGRESS) {
    if (ride.status === RIDE_STATUS.IN_PROGRESS) return ride;
    if (ts.completedAt || ts.canceledAt) return ride;
    return { ...ride, status: RIDE_STATUS.IN_PROGRESS };
  }
  if (statusQuery === RIDE_STATUS.COMPLETED) {
    if (ride.status === RIDE_STATUS.COMPLETED) return ride;
    if (ts.canceledAt) return ride;
    return { ...ride, status: RIDE_STATUS.COMPLETED };
  }
  // BD-RIDE-SIM-01 — route the audit URL ?status=CANCELED / NO_SHOW
  // to the existing PASSENGER_STUB_BY_STATUS placeholder so the
  // canceled/no-show fallback is reachable from the simulation links.
  if (statusQuery === RIDE_STATUS.CANCELED || statusQuery === RIDE_STATUS.NO_SHOW) {
    if (ride.status === statusQuery) return ride;
    return { ...ride, status: statusQuery };
  }
  return ride;
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

function toSeconds(mmss) {
  const m = /^(\d+):(\d+)$/.exec(String(mmss || ''));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function inProgressInfo(ride) {
  const r = (ride && ride.ride) || {};
  const route = (ride && ride.route) || {};
  const arrivalTime = r.arrivalTime || '14:32';
  const rawEta = route.etaToDestination || r.etaToDestination || '17 мин';
  const eta = String(rawEta).replace(/\s*мин(уты?|у)?$/i, ' мин').trim();
  return { arrivalTime, eta };
}

function arrivingDropoffInfo(ride) {
  const r = (ride && ride.ride) || {};
  const route = (ride && ride.route) || {};
  const rawEta = route.etaToDropoff || r.etaToDropoff || '1 мин';
  const eta = String(rawEta).replace(/\s*мин(уты?|у)?$/i, ' мин').trim();
  return { eta };
}

// Pick the amount shown in the payment card on the ARRIVING_DROPOFF
// sheet. Prefers an explicit per-phase override, then the regular
// payment amount, then the live ride price, then the original offer.
// Fallback matches the Cloud Design mock so the screen still has a
// believable number when no ride data is wired up.
function arrivingDropoffAmount(ride) {
  const pay = (ride && ride.payment) || {};
  const r = (ride && ride.ride) || {};
  const order = (ride && ride.order) || {};
  return pay.dropoffAmount
    || pay.amount
    || r.price
    || order.offerPrice
    || '1 540 ₽';
}

function waitingInfo(ride) {
  const w = (ride && ride.waiting) || {};
  const remaining = w.remaining || '2:45';
  const freeLimit = w.freeLimit || '3:00';
  const paidStartsAt = w.paidStartsAt || '14:18';
  const paidRate = w.paidRate || '8 ₽ за каждую минуту';
  const remSec = toSeconds(remaining);
  const totalSec = toSeconds(freeLimit);
  let pct = 100;
  if (remSec != null && totalSec && totalSec > 0) {
    pct = Math.max(0, Math.min(100, Math.round((remSec / totalSec) * 100)));
  }
  return { remaining, freeLimit, paidStartsAt, paidRate, pct };
}

// BD-RIDE-P-02 covers DRIVER_EN_ROUTE; BD-RIDE-P-03 covers WAITING_PASSENGER;
// BD-RIDE-P-04 covers IN_PROGRESS; BD-RIDE-P-05 covers COMPLETED. Other
// passenger-side stages keep a placeholder so we don't show the wrong
// title and actions when the ride has moved on.
const PASSENGER_SUPPORTED_STATUSES = new Set([
  RIDE_STATUS.DRIVER_EN_ROUTE,
  RIDE_STATUS.DRIVER_APPROACHING_PICKUP,
  RIDE_STATUS.WAITING_PASSENGER,
  RIDE_STATUS.IN_PROGRESS,
  RIDE_STATUS.COMPLETED,
]);

const PASSENGER_STUB_BY_STATUS = {
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

function chatLabelFor(ride) {
  const rawUnread = ride.chat && ride.chat.unread;
  const unreadCount = Number.isFinite(Number(rawUnread)) && rawUnread != null
    ? Number(rawUnread)
    : 2;
  const label = unreadCount > 0
    ? `Написать водителю · ${unreadCount} непрочитанных`
    : 'Написать водителю';
  return { unreadCount, label };
}

// BD-RIDE-P-01 — Top driver card overlay shown above the map for the
// in-ride passenger statuses (DRIVER_EN_ROUTE, WAITING_PASSENGER,
// IN_PROGRESS incl. ARRIVING_DROPOFF). Contains driver identity, car,
// rating, status-specific ETA and the two prominent call/message
// actions. The bottom sheet keeps the status-specific slot below.
function topDriverCardEta(ride, phase) {
  if (ride.status === RIDE_STATUS.WAITING_PASSENGER) {
    const w = waitingInfo(ride);
    return { value: w.remaining, label: 'осталось', tone: 'wait' };
  }
  if (ride.status === RIDE_STATUS.IN_PROGRESS) {
    if (phase === PASSENGER_IN_PROGRESS_PHASE.ARRIVING_DROPOFF) {
      const info = arrivingDropoffInfo(ride);
      return { value: info.eta, label: 'до места', tone: 'arriving' };
    }
    const info = inProgressInfo(ride);
    return { value: info.eta, label: 'до места', tone: 'progress' };
  }
  return { value: etaText(ride), label: 'до подачи', tone: 'enroute' };
}

function topDriverCardHtml(ride, options = {}) {
  const driverName = (ride.driver && ride.driver.name) || 'Рустам К.';
  const driverInitials = (ride.driver && ride.driver.initials) || 'РК';
  const driverRating = (ride.driver && ride.driver.rating) || '4,92';
  const { unreadCount, label } = chatLabelFor(ride);
  const eta = topDriverCardEta(ride, options.phase);
  return `
    <div class="active-ride-passenger__top-card" data-tone="${escapeHtml(eta.tone)}">
      <div class="active-ride-passenger__top-card-row">
        <div class="active-ride-passenger__avatar" aria-hidden="true">${escapeHtml(driverInitials)}</div>
        <div class="active-ride-passenger__driver-info">
          <div class="active-ride-passenger__driver-name">
            ${escapeHtml(driverName)}
            <span class="active-ride-passenger__driver-rating">★ ${escapeHtml(driverRating)}</span>
          </div>
          <div class="active-ride-passenger__driver-sub">${escapeHtml(carLine(ride))}</div>
        </div>
        <div class="active-ride-passenger__top-card-eta" aria-label="${escapeHtml(eta.label)}">
          <div class="active-ride-passenger__top-card-eta-value">${escapeHtml(eta.value)}</div>
          <div class="active-ride-passenger__top-card-eta-label">${escapeHtml(eta.label)}</div>
        </div>
      </div>
      <div class="active-ride-passenger__top-card-actions">
        <button type="button" class="bd-btn primary active-ride-passenger__top-call" id="arp-top-call" aria-label="Позвонить водителю">
          <span class="active-ride-passenger__btn-ic" aria-hidden="true">${PHONE_SVG}</span>
          Позвонить
        </button>
        <button type="button" class="bd-btn active-ride-passenger__top-message" id="arp-top-chat" aria-label="${escapeHtml(label)}">
          <span class="active-ride-passenger__btn-ic" aria-hidden="true">${MESSAGE_SVG}</span>
          Написать
          ${unreadCount > 0
            ? `<span class="active-ride-passenger__chat-badge active-ride-passenger__chat-badge--inline" aria-hidden="true">${escapeHtml(String(unreadCount))}</span>`
            : ''}
        </button>
      </div>
    </div>
  `;
}

function routeBlockHtml(ride, options = {}) {
  const pickup = (ride.route && ride.route.pickupLabel) || 'ул. Малая Бронная, 28';
  const dropoff = (ride.route && ride.route.dropoffLabel) || 'Аэропорт Шереметьево, терминал В';
  const editable = options.editable !== false;
  const modifier = editable ? '' : ' active-ride-passenger__route--locked';
  const editBtn = editable
    ? `<button type="button" class="active-ride-passenger__route-edit" id="arp-edit-route" aria-label="Изменить маршрут">
        ${PENCIL_SVG}
      </button>`
    : '';
  return `
    <div class="active-ride-passenger__route${modifier}">
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
      ${editBtn}
    </div>
  `;
}

// options.amountOverride — optional string used in place of the default
// payment amount (e.g. a phase-specific tally on the ARRIVING_DROPOFF
// sheet). Falsy values fall through to `paymentInfo(ride).amount`.
function paymentBlockHtml(ride, options = {}) {
  const pay = paymentInfo(ride);
  if (options.amountOverride) pay.amount = options.amountOverride;
  return `
    <div class="active-ride-passenger__payment" role="group" aria-label="Способ оплаты">
      <div class="active-ride-passenger__payment-icon" aria-hidden="true">${CARD_SVG}</div>
      <div class="active-ride-passenger__payment-body">
        <div class="active-ride-passenger__payment-title">•• ${escapeHtml(pay.last4)} · ${escapeHtml(pay.method)}</div>
        <div class="active-ride-passenger__payment-note">${escapeHtml(pay.note)}</div>
      </div>
      <div class="active-ride-passenger__payment-amount">${escapeHtml(pay.amount)}</div>
      <div class="active-ride-passenger__payment-chevron" aria-hidden="true">${CHEVRON_RIGHT_SVG}</div>
    </div>
  `;
}

function renderEnRouteSheet(sheet, ride) {
  sheet.innerHTML = `
    <div class="active-ride-passenger__handle" aria-hidden="true"></div>

    <div class="active-ride-passenger__header">
      <div class="active-ride-passenger__header-main">
        <div class="active-ride-passenger__title">Водитель едет к вам</div>
        <div class="active-ride-passenger__car">${escapeHtml(carLine(ride))}</div>
      </div>
    </div>

    ${routeBlockHtml(ride)}
    ${paymentBlockHtml(ride)}

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
}

function renderWaitingSheet(sheet, ride) {
  const w = waitingInfo(ride);
  sheet.innerHTML = `
    <div class="active-ride-passenger__handle" aria-hidden="true"></div>

    <div class="active-ride-passenger__header">
      <div class="active-ride-passenger__header-main">
        <div class="active-ride-passenger__title">Водитель ждёт вас</div>
        <div class="active-ride-passenger__sub">Бесплатное ожидание заканчивается через</div>
      </div>
      <div class="active-ride-passenger__waiting-badge" aria-label="Осталось бесплатного ожидания">
        <div class="active-ride-passenger__waiting-badge-value">${escapeHtml(w.remaining)}</div>
        <div class="active-ride-passenger__waiting-badge-label">осталось</div>
      </div>
    </div>

    <div class="active-ride-passenger__waiting-card">
      <div class="active-ride-passenger__waiting-card-head">
        <span class="active-ride-passenger__waiting-card-title">Бесплатное ожидание</span>
        <span class="active-ride-passenger__waiting-card-value">${escapeHtml(w.remaining)} / ${escapeHtml(w.freeLimit)}</span>
      </div>
      <div class="active-ride-passenger__progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${w.pct}">
        <div class="active-ride-passenger__progress-bar-fill" data-step="${Math.round(w.pct / 10)}"></div>
      </div>
      <div class="active-ride-passenger__waiting-card-foot">Дальше — ${escapeHtml(w.paidRate)} · с ${escapeHtml(w.paidStartsAt)}</div>
    </div>

    ${routeBlockHtml(ride)}
    ${paymentBlockHtml(ride)}

    <button type="button" class="bd-btn primary active-ride-passenger__cta-primary" id="arp-boarded">
      <span class="active-ride-passenger__btn-ic" aria-hidden="true">${CHECK_SVG}</span>
      Я в машине — поехали
    </button>

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
}

function renderInProgressSheet(sheet, ride) {
  const info = inProgressInfo(ride);
  sheet.innerHTML = `
    <div class="active-ride-passenger__handle" aria-hidden="true"></div>

    <div class="active-ride-passenger__header">
      <div class="active-ride-passenger__header-main">
        <div class="active-ride-passenger__title">В пути</div>
        <div class="active-ride-passenger__sub">Расчётное время прибытия ${escapeHtml(info.arrivalTime)}</div>
      </div>
    </div>

    ${routeBlockHtml(ride, { editable: false })}
    ${paymentBlockHtml(ride)}

    <div class="active-ride-passenger__in-progress-actions">
      <button type="button" class="bd-btn ghost active-ride-passenger__btn-stop" id="arp-add-stop">
        <span class="active-ride-passenger__btn-ic" aria-hidden="true">${PLUS_SVG}</span>
        Добавить остановку
      </button>
      <button type="button" class="active-ride-passenger__icon-action active-ride-passenger__btn-share-square" id="arp-share-square" aria-label="Поделиться поездкой">
        ${SHARE_SVG}
      </button>
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
}

function renderArrivingDropoffSheet(sheet, ride) {
  const info = arrivingDropoffInfo(ride);
  sheet.innerHTML = `
    <div class="active-ride-passenger__handle" aria-hidden="true"></div>

    <div class="active-ride-passenger__header">
      <div class="active-ride-passenger__header-main">
        <div class="active-ride-passenger__title">Прибываем</div>
        <div class="active-ride-passenger__sub">Подъезжаем к точке высадки</div>
      </div>
    </div>

    ${routeBlockHtml(ride, { editable: false })}
    ${paymentBlockHtml(ride, { amountOverride: arrivingDropoffAmount(ride) })}

    <button type="button" class="bd-btn primary active-ride-passenger__cta-primary" id="arp-finish-rate">
      Завершить и оценить поездку
    </button>

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
}

// BD-RIDE-P-05 — Passenger COMPLETED. Mock/UI only.
const COMPLETE_RATING_TAGS = [
  'Вежливый водитель',
  'Чистый салон',
  'Быстрая подача',
  'Комфортная поездка',
  'Хороший маршрут',
];

function formatCompletedAt(ride) {
  const ts = ride && ride.timestamps && ride.timestamps.completedAt;
  if (ts) {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) {
      const hh = d.getHours() < 10 ? `0${d.getHours()}` : String(d.getHours());
      const mm = d.getMinutes() < 10 ? `0${d.getMinutes()}` : String(d.getMinutes());
      return `${hh}:${mm}`;
    }
  }
  return (ride && ride.ride && ride.ride.arrivalTime) || '14:34';
}

function completedStats(ride) {
  const order = (ride && ride.order) || {};
  const route = (ride && ride.route) || {};
  const r = (ride && ride.ride) || {};
  const time = r.duration || order.destinationEta || '42 мин';
  const distance = r.distance || order.destinationDistance || '38 км';
  const completedAt = formatCompletedAt(ride);
  return { time, distance, completedAt };
}

function completedPaymentInfo(ride) {
  const base = paymentInfo(ride);
  const total = arrivingDropoffAmount(ride);
  return {
    last4: base.last4,
    method: base.method,
    total,
  };
}

// STAR_FULL_SVG / STAR_EMPTY_SVG are inlined per-screen so the rating
// widget can swap between filled and outlined stars without touching
// element styles directly.
const STAR_FULL_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="32" height="32">
  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
</svg>`;

const STAR_EMPTY_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="32" height="32">
  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
</svg>`;

const ALERT_TRI_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="16" height="16">
  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
  <line x1="12" y1="9" x2="12" y2="13"/>
  <line x1="12" y1="17" x2="12.01" y2="17"/>
</svg>`;

const RECEIPT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="14" height="14">
  <path d="M14 2H6a2 2 0 0 0-2 2v16l3-2 3 2 3-2 3 2V8z"/>
  <polyline points="14 2 14 8 20 8"/>
</svg>`;

const SPARKLE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>
</svg>`;

const ARROW_RIGHT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <line x1="5" y1="12" x2="19" y2="12"/>
  <polyline points="12 5 19 12 12 19"/>
</svg>`;

const SPINNER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" width="14" height="14">
  <circle cx="12" cy="12" r="9" stroke-opacity="0.25"/>
  <path d="M21 12a9 9 0 0 1-9 9"/>
</svg>`;

const CLOSE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <line x1="18" y1="6" x2="6" y2="18"/>
  <line x1="6" y1="6" x2="18" y2="18"/>
</svg>`;

const COIN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
  <circle cx="12" cy="12" r="9"/>
  <path d="M14 9.5c-.5-1-1.6-1.5-2.6-1.5-1.4 0-2.4.7-2.4 2 0 1 .6 1.5 2 1.8l1 .2c1.4.3 2 1 2 2 0 1.4-1 2-2.6 2-1.2 0-2.2-.5-2.7-1.5"/>
  <line x1="12" y1="6.5" x2="12" y2="17.5"/>
</svg>`;

const CAR_REPORT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
  <path d="M3 12l2-5h14l2 5"/>
  <path d="M3 12v6h2v2h3v-2h8v2h3v-2h2v-6"/>
  <line x1="3" y1="12" x2="21" y2="12"/>
  <circle cx="7" cy="15" r="1.2"/>
  <circle cx="17" cy="15" r="1.2"/>
</svg>`;

const HEART_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l8.84 8.84 8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/>
</svg>`;

const INFO_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
  <circle cx="12" cy="12" r="10"/>
  <line x1="12" y1="16" x2="12" y2="12"/>
  <line x1="12" y1="8" x2="12.01" y2="8"/>
</svg>`;

const REPORT_REASONS = [
  { id: 'price',    label: 'Неверная стоимость',     icon: COIN_SVG },
  { id: 'route',    label: 'Странный маршрут',       icon: PIN_SVG },
  { id: 'driver',   label: 'Поведение водителя',     icon: PHONE_SVG },
  { id: 'car',      label: 'Состояние автомобиля',   icon: CAR_REPORT_SVG },
  { id: 'lost',     label: 'Забыл вещи в машине',    icon: HEART_SVG },
  { id: 'other',    label: 'Другое',                 icon: INFO_SVG },
];

const PAYMENT_STATES = new Set(['auto', 'pending', 'paid']);
function normalizePayment(value) {
  if (typeof value !== 'string') return 'auto';
  const v = value.trim().toLowerCase();
  return PAYMENT_STATES.has(v) ? v : 'auto';
}

function renderPassengerRideComplete(ride, deps) {
  const { go: navigate, toast, paymentStatus } = deps;
  // The COMPLETED screen tracks two independent UI axes:
  //   data-submitted = "false" | "true"      — rating thank-you flag
  //   data-payment   = "auto"  | "pending"   — charge lifecycle
  //                  | "paid"
  //
  // Matrix the design uses:
  //   submitted=false, payment=auto    — default after ride finish
  //   submitted=false, payment=pending — list/pulse during charge (State 5)
  //   submitted=false, payment=paid    — charge settled, rating still
  //                                      a draft (State 6 — чек готов)
  //   submitted=true,  payment=paid    — thank-you (State 4)
  //
  // Submitting the rating flips both flags; `?payment=` lets QA jump
  // straight to the pending/paid presentations without a real charge.
  const initialPayment = normalizePayment(paymentStatus);
  const stats = completedStats(ride);
  const pay = completedPaymentInfo(ride);
  const route = (ride && ride.route) || {};
  const pickup = route.pickupLabel || 'ул. Малая Бронная, 28';
  const dropoff = route.dropoffLabel || 'Аэропорт Шереметьево, терминал В';
  const driverName = (ride.driver && ride.driver.name) || 'Рустам К.';
  const driverInitials = (ride.driver && ride.driver.initials) || 'РК';
  const driverRating = (ride.driver && ride.driver.rating) || '4,92';
  const carText = carLine(ride);

  const root = document.createElement('section');
  root.className = 'screen screen--active-ride active-ride-passenger active-ride-passenger--complete';

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

  const tagsHtml = COMPLETE_RATING_TAGS
    .map((label) => `
      <button type="button"
        class="passenger-complete__tag"
        data-tag="${escapeHtml(label)}"
        aria-pressed="false">${escapeHtml(label)}</button>
    `)
    .join('');

  const starsHtml = [1, 2, 3, 4, 5]
    .map((value) => `
      <button type="button"
        class="passenger-complete__star"
        data-star="${value}"
        aria-label="Поставить ${value} звезды"
        aria-pressed="false">
        <span class="passenger-complete__star-full" aria-hidden="true">${STAR_FULL_SVG}</span>
        <span class="passenger-complete__star-empty" aria-hidden="true">${STAR_EMPTY_SVG}</span>
      </button>
    `)
    .join('');

  const content = document.createElement('div');
  content.className = 'passenger-complete__scroll';
  content.dataset.submitted = 'false';
  // Payment lifecycle is tracked independently of the rating submitted
  // flag so the pending → paid transition doesn't force a rating
  // change. Default is `auto` (before charge); `?payment=pending`
  // surfaces the in-flight charge state for QA; submit sets `paid`.
  content.dataset.payment = initialPayment;
  // Report entry is another independent UI axis: opens an inline
  // report sheet over the same scroll container without changing
  // route or rating/payment state.
  content.dataset.report = 'closed';
  content.innerHTML = `
    <div class="passenger-complete__hero">
      <div class="passenger-complete__check" aria-hidden="true">
        ${CHECK_SVG}
      </div>
      <div class="passenger-complete__hero-title" data-default-only>Поездка завершена</div>
      <div class="passenger-complete__hero-title" data-submitted-only>Спасибо за отзыв</div>
      <div class="passenger-complete__hero-sub" data-default-only>
        Спасибо за поездку. Оплата будет списана автоматически.
      </div>
      <div class="passenger-complete__hero-sub" data-submitted-only>
        Ваша оценка отправлена водителю. Хорошей дороги!
      </div>
    </div>

    <div class="passenger-complete__card passenger-complete__pay">
      <div class="passenger-complete__pay-head">
        <div class="passenger-complete__pay-label">Итого к оплате</div>
        <span class="passenger-complete__auto-badge" data-pay-show="auto">Авто-оплата</span>
        <span class="passenger-complete__pending-badge" data-pay-show="pending">
          <span class="passenger-complete__pending-ic" aria-hidden="true">${SPINNER_SVG}</span>
          Списание...
        </span>
        <span class="passenger-complete__paid-badge" data-pay-show="paid">
          <span class="passenger-complete__paid-ic" aria-hidden="true">${CHECK_SVG}</span>
          Оплачено
        </span>
      </div>
      <div class="passenger-complete__pay-total">${escapeHtml(pay.total)}</div>
      <div class="passenger-complete__pay-method">
        <div class="passenger-complete__pay-icon" aria-hidden="true">${CARD_SVG}</div>
        <div class="passenger-complete__pay-method-body">
          <div class="passenger-complete__pay-method-title">•• ${escapeHtml(pay.last4)} · ${escapeHtml(pay.method)}</div>
          <div class="passenger-complete__pay-method-note" data-pay-show="auto">Оплата автоматически после поездки</div>
          <div class="passenger-complete__pay-method-note" data-pay-show="pending">Списываем сумму с карты...</div>
          <div class="passenger-complete__pay-method-note" data-pay-show="paid">Списано · сегодня в ${escapeHtml(stats.completedAt)}</div>
        </div>
        <div class="passenger-complete__pay-method-chevron" aria-hidden="true">${CHEVRON_RIGHT_SVG}</div>
      </div>
      <div class="passenger-complete__receipt-note" data-pay-show="auto pending">
        <span class="passenger-complete__receipt-ic" aria-hidden="true">${RECEIPT_SVG}</span>
        Чек будет доступен после оплаты
      </div>
      <div class="passenger-complete__receipt-ready" data-pay-show="paid">
        <span class="passenger-complete__receipt-ic" aria-hidden="true">${RECEIPT_SVG}</span>
        <span class="passenger-complete__receipt-ready-text">Чек готов · можно скачать</span>
        <button type="button" class="passenger-complete__receipt-action" id="arp-receipt-download" aria-label="Скачать чек">Скачать</button>
      </div>
    </div>

    <div class="passenger-complete__stats" role="group" aria-label="Статистика поездки">
      <div class="passenger-complete__stat">
        <div class="passenger-complete__stat-label">Время</div>
        <div class="passenger-complete__stat-value">${escapeHtml(stats.time)}</div>
      </div>
      <div class="passenger-complete__stat">
        <div class="passenger-complete__stat-label">Расстояние</div>
        <div class="passenger-complete__stat-value">${escapeHtml(stats.distance)}</div>
      </div>
      <div class="passenger-complete__stat">
        <div class="passenger-complete__stat-label">Завершено</div>
        <div class="passenger-complete__stat-value">${escapeHtml(stats.completedAt)}</div>
      </div>
    </div>

    <div class="passenger-complete__card passenger-complete__route">
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
    </div>

    <div class="passenger-complete__driver-section">
      <div class="passenger-complete__section-label">ВОДИТЕЛЬ</div>
      <div class="passenger-complete__card passenger-complete__driver">
        <div class="active-ride-passenger__avatar" aria-hidden="true">${escapeHtml(driverInitials)}</div>
        <div class="active-ride-passenger__driver-info">
          <div class="active-ride-passenger__driver-name">
            ${escapeHtml(driverName)}
            <span class="active-ride-passenger__driver-rating">★ ${escapeHtml(driverRating)}</span>
          </div>
          <div class="active-ride-passenger__driver-sub">${escapeHtml(carText)}</div>
        </div>
        <div class="active-ride-passenger__driver-actions">
          <button type="button" class="active-ride-passenger__icon-action" id="arp-chat" aria-label="Написать водителю">
            ${MESSAGE_SVG}
          </button>
          <button type="button" class="active-ride-passenger__icon-action" id="arp-call" aria-label="Позвонить водителю">
            ${PHONE_SVG}
          </button>
        </div>
      </div>
    </div>

    <div class="passenger-complete__rating-section" data-hide-when-report>
      <div class="passenger-complete__section-label" data-default-only>ОЦЕНИТЕ ПОЕЗДКУ</div>
      <div class="passenger-complete__section-label" data-submitted-only>ВАША ОЦЕНКА</div>
      <div class="passenger-complete__card passenger-complete__rating" id="arp-rating-card" data-rating="0" data-default-only>
        <div class="passenger-complete__stars" role="radiogroup" aria-label="Оценка поездки">
          ${starsHtml}
        </div>
        <div class="passenger-complete__tags" role="group" aria-label="Что понравилось">
          ${tagsHtml}
        </div>
        <button type="button" class="passenger-complete__comment" id="arp-comment">
          <span class="passenger-complete__comment-ic" aria-hidden="true">${PENCIL_SVG}</span>
          Добавить комментарий
        </button>
        <div class="passenger-complete__comment-field" id="arp-comment-field" hidden>
          <textarea
            class="passenger-complete__comment-input"
            id="arp-comment-input"
            maxlength="200"
            rows="3"
            aria-label="Комментарий к поездке"
            placeholder="Комментарий (необязательно)"></textarea>
          <div class="passenger-complete__comment-foot">
            <span class="passenger-complete__comment-helper">Виден только поддержке</span>
            <span class="passenger-complete__comment-counter" id="arp-comment-counter" aria-live="polite">0/200</span>
          </div>
        </div>
      </div>
      <div class="passenger-complete__card passenger-complete__rating-submitted" id="arp-rating-submitted" data-submitted-only>
        <div class="passenger-complete__submitted-head">
          <span class="passenger-complete__submitted-ic" aria-hidden="true">${SPARKLE_SVG}</span>
          <span class="passenger-complete__submitted-title">Ваш отзыв отправлен</span>
        </div>
        <div class="passenger-complete__submitted-stars" id="arp-submitted-stars" role="img" aria-label="Вы поставили 5 звёзд">
          ${[1, 2, 3, 4, 5].map(() => `
            <span class="passenger-complete__submitted-star" data-filled="true">
              <span class="passenger-complete__star-full" aria-hidden="true">${STAR_FULL_SVG}</span>
              <span class="passenger-complete__star-empty" aria-hidden="true">${STAR_EMPTY_SVG}</span>
            </span>
          `).join('')}
        </div>
        <div class="passenger-complete__submitted-note">
          Спасибо! Это помогает делать поездки лучше.
        </div>
      </div>
    </div>

    <div class="passenger-complete__report-sheet" id="arp-report-sheet" data-report-only>
      <div class="passenger-complete__report-head">
        <div class="passenger-complete__report-title">Сообщить о проблеме</div>
        <button type="button" class="passenger-complete__report-close" id="arp-report-close" aria-label="Закрыть">
          ${CLOSE_SVG}
        </button>
      </div>
      <div class="passenger-complete__report-desc">
        Выберите, что произошло — поддержка свяжется в течение часа
      </div>
      <ul class="passenger-complete__report-list" role="list">
        ${REPORT_REASONS.map((r) => `
          <li>
            <button type="button" class="passenger-complete__report-reason" data-reason="${escapeHtml(r.id)}">
              <span class="passenger-complete__report-ic" aria-hidden="true">${r.icon}</span>
              <span class="passenger-complete__report-reason-text">${escapeHtml(r.label)}</span>
              <span class="passenger-complete__report-chev" aria-hidden="true">${CHEVRON_RIGHT_SVG}</span>
            </button>
          </li>
        `).join('')}
      </ul>
    </div>

    <button type="button" class="bd-btn primary passenger-complete__cta" id="arp-submit-rating" data-default-only data-hide-when-report disabled>
      <span class="passenger-complete__cta-ic" aria-hidden="true">${STAR_FULL_SVG}</span>
      Поставить оценку
    </button>
    <button type="button" class="bd-btn primary passenger-complete__cta passenger-complete__cta--return" id="arp-return-feed" data-submitted-only data-hide-when-report>
      <span class="passenger-complete__cta-ic" aria-hidden="true">${ARROW_RIGHT_SVG}</span>
      Вернуться в ленту
    </button>
    <button type="button" class="bd-btn primary passenger-complete__cta passenger-complete__cta--return" id="arp-report-return" data-report-only>
      <span class="passenger-complete__cta-ic" aria-hidden="true">${ARROW_RIGHT_SVG}</span>
      Вернуться в ленту
    </button>

    <div class="passenger-complete__bottom-actions">
      <button type="button" class="bd-btn passenger-complete__bottom-btn" id="arp-open-chat">
        <span class="passenger-complete__bottom-btn-ic" aria-hidden="true">${MESSAGE_SVG}</span>
        Открыть чат
      </button>
      <button type="button" class="bd-btn passenger-complete__bottom-btn" id="arp-to-feed">
        <span class="passenger-complete__bottom-btn-ic" aria-hidden="true">${SHARE_SVG}</span>
        В ленту
      </button>
    </div>

    <button type="button" class="passenger-complete__report" id="arp-report" data-hide-when-report>
      <span class="passenger-complete__report-trigger-ic" aria-hidden="true">${ALERT_TRI_SVG}</span>
      Сообщить о проблеме
    </button>
  `;
  root.appendChild(content);

  const notice = document.createElement('div');
  notice.className = 'active-ride__notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.hidden = true;
  root.appendChild(notice);

  let noticeTimer = null;
  function localToast(msg) {
    if (toast) { toast(msg); return; }
    notice.textContent = msg;
    notice.hidden = false;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 3500);
  }

  // ── Top handlers ─────────────────────────────────────────
  top.querySelector('#arp-collapse').addEventListener('click', () => {
    localToast('Сворачивание панели будет добавлено позже');
  });
  top.querySelector('#arp-shield').addEventListener('click', () => {
    localToast('Безопасность будет добавлена позже');
  });

  // ── Rating widget ────────────────────────────────────────
  const ratingCard = content.querySelector('#arp-rating-card');
  const starButtons = Array.from(content.querySelectorAll('.passenger-complete__star'));
  const tagButtons = Array.from(content.querySelectorAll('.passenger-complete__tag'));
  const submitBtn = content.querySelector('#arp-submit-rating');
  let currentRating = 0;
  const selectedTags = new Set();

  function applyRating(value) {
    currentRating = value;
    ratingCard.dataset.rating = String(value);
    starButtons.forEach((btn) => {
      const star = Number(btn.dataset.star);
      const filled = star <= value;
      btn.dataset.filled = filled ? 'true' : 'false';
      btn.setAttribute('aria-pressed', filled ? 'true' : 'false');
    });
    submitBtn.disabled = value === 0;
  }

  starButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const star = Number(btn.dataset.star);
      // Tap the same star again to clear the rating back to 0 — gives
      // a one-tap escape hatch when the passenger taps the wrong star
      // and avoids the surprising "5 → 4 → 3 …" decrement that the
      // earlier `star - 1` form caused.
      applyRating(star === currentRating ? 0 : star);
    });
  });

  tagButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      const pressed = btn.getAttribute('aria-pressed') === 'true';
      if (pressed) {
        selectedTags.delete(tag);
        btn.setAttribute('aria-pressed', 'false');
      } else {
        selectedTags.add(tag);
        btn.setAttribute('aria-pressed', 'true');
      }
    });
  });

  // ── Comment field (expand on demand) ─────────────────────
  // Toggling chips or stars must not collapse this — both handlers
  // above only touch their own elements, so the textarea state is
  // preserved across rating/tag interactions.
  const commentBtn = content.querySelector('#arp-comment');
  const commentField = content.querySelector('#arp-comment-field');
  const commentInput = content.querySelector('#arp-comment-input');
  const commentCounter = content.querySelector('#arp-comment-counter');
  const COMMENT_MAX = 200;

  function openComment() {
    commentBtn.hidden = true;
    commentField.hidden = false;
    commentInput.focus();
  }
  commentBtn.addEventListener('click', openComment);

  commentInput.addEventListener('input', () => {
    // Native maxlength caps input at 200, so length is always safe here.
    commentCounter.textContent = `${commentInput.value.length}/${COMMENT_MAX}`;
  });

  // ── Submitted state (Rating submitted — спасибо) ────────
  // Toggle is driven by `content.dataset.submitted`; CSS hides
  // [data-default-only] / [data-submitted-only] accordingly so we
  // don't need to remove or rebuild any DOM nodes.
  const submittedStars = Array.from(
    content.querySelectorAll('#arp-submitted-stars .passenger-complete__submitted-star')
  );
  const submittedStarsHost = content.querySelector('#arp-submitted-stars');
  function syncSubmittedStars(value) {
    submittedStars.forEach((node, idx) => {
      node.dataset.filled = (idx + 1) <= value ? 'true' : 'false';
    });
    // Keep the a11y label in sync so screen readers announce the
    // rating the passenger actually submitted, not a hard-coded 5.
    if (submittedStarsHost) {
      submittedStarsHost.setAttribute(
        'aria-label',
        `Вы поставили ${value} ${value === 1 ? 'звезду' : value < 5 ? 'звезды' : 'звёзд'}`
      );
    }
  }
  submitBtn.addEventListener('click', () => {
    if (currentRating === 0) return;
    syncSubmittedStars(currentRating);
    content.dataset.submitted = 'true';
    // Submitting the rating implies the auto-charge has completed
    // by the time we render the thank-you screen.
    content.dataset.payment = 'paid';
    submitBtn.disabled = true;
    // Disable underlying editable controls so a hidden tab/keyboard
    // user can't keep editing fields that the UI no longer shows.
    starButtons.forEach((b) => { b.disabled = true; });
    tagButtons.forEach((b) => { b.disabled = true; });
    if (commentInput) commentInput.disabled = true;
    if (commentBtn) commentBtn.disabled = true;
    // Move focus to the new primary CTA for keyboard users.
    const returnBtn = content.querySelector('#arp-return-feed');
    if (returnBtn) returnBtn.focus();
  });

  const returnFeedBtn = content.querySelector('#arp-return-feed');
  if (returnFeedBtn) {
    returnFeedBtn.addEventListener('click', () => {
      navigate('/feed');
    });
  }

  const receiptDownloadBtn = content.querySelector('#arp-receipt-download');
  if (receiptDownloadBtn) {
    receiptDownloadBtn.addEventListener('click', () => {
      // Receipt download isn't wired to a backend yet — safe stub.
      localToast('Скачивание чека будет доступно позже');
    });
  }

  // ── Driver card actions ──────────────────────────────────
  const chatIconBtn = content.querySelector('#arp-chat');
  const callBtn = content.querySelector('#arp-call');
  function openChat() {
    // Existing chat route is registered at /chat; if it isn't available
    // for any reason the toast keeps the UI silent instead of throwing.
    try {
      navigate(`/chat?tripId=${encodeURIComponent(ride.tripId)}`);
    } catch {
      localToast('Чат пока недоступен');
    }
  }
  if (chatIconBtn) chatIconBtn.addEventListener('click', openChat);
  if (callBtn) {
    callBtn.addEventListener('click', () => {
      localToast('Звонок водителю пока заглушка');
    });
  }

  // ── Bottom actions ───────────────────────────────────────
  content.querySelector('#arp-open-chat').addEventListener('click', openChat);
  content.querySelector('#arp-to-feed').addEventListener('click', () => {
    navigate('/feed');
  });
  // ── Report sheet (State 7 — Issue / report entry) ────────
  // Toggle is driven by `content.dataset.report`; CSS hides the
  // rating section / main CTAs / bottom report link when open, and
  // shows the report card + a parallel "Вернуться в ленту" CTA.
  // No rating / payment state is touched, so closing the sheet
  // returns the screen to whatever cell of the matrix it was in.
  const reportSheet = content.querySelector('#arp-report-sheet');
  const reportClose = content.querySelector('#arp-report-close');
  const reportReturn = content.querySelector('#arp-report-return');
  const reportReasons = Array.from(
    content.querySelectorAll('.passenger-complete__report-reason')
  );

  content.querySelector('#arp-report').addEventListener('click', () => {
    content.dataset.report = 'open';
    if (reportSheet && typeof reportSheet.scrollIntoView === 'function') {
      reportSheet.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  if (reportClose) {
    reportClose.addEventListener('click', () => {
      content.dataset.report = 'closed';
    });
  }

  if (reportReturn) {
    reportReturn.addEventListener('click', () => {
      navigate('/feed');
    });
  }

  reportReasons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const labelEl = btn.querySelector('.passenger-complete__report-reason-text');
      const label = labelEl ? labelEl.textContent.trim() : '';
      // Detail flow isn't wired up — show a safe toast so the
      // selection is acknowledged without throwing.
      localToast(label ? `Причина выбрана: ${label}` : 'Раздел обращения будет добавлен позже');
    });
  });

  applyRating(0);
  return root;
}

export default function activeRidePassenger(options = {}) {
  const tripId = (options && options.tripId) || DEMO_ACTIVE_RIDE_ID;
  const statusQuery = (options && options.statusQuery) || null;
  const phaseQuery = normalizePhase((options && options.phaseQuery) || null);
  const paymentQuery = (options && options.paymentQuery) || null;
  const showNotice = typeof options.showNotice === 'function'
    ? options.showNotice
    : null;

  let ride = loadPassengerRideView(tripId, statusQuery);
  ride = applyPassengerStatusFromQuery(ride, statusQuery);

  if (!PASSENGER_SUPPORTED_STATUSES.has(ride.status)) {
    return renderPassengerStub(PASSENGER_STUB_BY_STATUS[ride.status]);
  }

  // BD-RIDE-P-05 — COMPLETED uses a scrollable layout without a map
  // and runs its own top bar / handlers, so branch out before the
  // map/sheet pipeline used by the en-route, waiting and in-progress
  // phases.
  if (ride.status === RIDE_STATUS.COMPLETED) {
    return renderPassengerRideComplete(ride, {
      go,
      toast: showNotice,
      paymentStatus: paymentQuery,
    });
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

  // ── Top driver card (BD-RIDE-P-01 shell parity) ──────────
  // Floats above the map, below the trip pill. Contains driver
  // identity, car, status-specific ETA and the prominent
  // call/message actions. Bottom sheet keeps the status-specific
  // slot below.
  const topCard = document.createElement('div');
  topCard.className = 'active-ride-passenger__top-card-wrap';
  topCard.dataset.status = ride.status;
  topCard.innerHTML = topDriverCardHtml(ride, { phase: phaseQuery });
  root.appendChild(topCard);

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

  // ── Shared top handlers ──────────────────────────────────
  top.querySelector('#arp-collapse').addEventListener('click', () => {
    toast('Сворачивание панели будет добавлено позже');
  });
  top.querySelector('#arp-shield').addEventListener('click', () => {
    toast('Безопасность будет добавлена позже');
  });

  // ── Top driver card handlers ─────────────────────────────
  // Call is a safe stub (no real telephony). Message routes into
  // the existing /chat screen so the unread badge and history
  // both stay in one place.
  const topCallBtn = topCard.querySelector('#arp-top-call');
  if (topCallBtn) {
    topCallBtn.addEventListener('click', () => {
      toast('Звонок водителю пока заглушка');
    });
  }
  const topChatBtn = topCard.querySelector('#arp-top-chat');
  if (topChatBtn) {
    topChatBtn.addEventListener('click', () => {
      go(`/chat?tripId=${encodeURIComponent(ride.tripId)}`);
    });
  }

  // ── Per-sheet bindings shared across statuses ────────────
  // Driver chat/call now live on the top card and are bound once
  // above; the bottom sheet only owns its route/sos/share controls.
  function bindCommonSheetHandlers() {
    const editRouteBtn = sheet.querySelector('#arp-edit-route');
    if (editRouteBtn) {
      editRouteBtn.addEventListener('click', () => {
        toast('Редактирование маршрута будет добавлено позже');
      });
    }
    const sosBtn = sheet.querySelector('#arp-sos');
    if (sosBtn) {
      sosBtn.addEventListener('click', () => {
        toast('Экран SOS будет добавлен позже');
      });
    }
    const shareBtn = sheet.querySelector('#arp-share');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        toast('Поделиться поездкой пока заглушка');
      });
    }
  }

  function renderSheet() {
    sheet.dataset.status = ride.status;
    // Drop any stale phase from a previous render — only branches that
    // need it (e.g. ARRIVING_DROPOFF) will re-set sheet.dataset.phase.
    delete sheet.dataset.phase;
    if (ride.status === RIDE_STATUS.WAITING_PASSENGER) {
      renderWaitingSheet(sheet, ride);
      bindCommonSheetHandlers();
      const boardedBtn = sheet.querySelector('#arp-boarded');
      if (boardedBtn) {
        boardedBtn.addEventListener('click', () => {
          // Persist transition to IN_PROGRESS so the driver flow sees it
          // and re-route so the URL reflects the new mock state.
          updateActiveRideStatus(ride.tripId, RIDE_STATUS.IN_PROGRESS);
          go(`/active-ride?role=passenger&status=${RIDE_STATUS.IN_PROGRESS}&tripId=${encodeURIComponent(ride.tripId)}`);
        });
      }
      return;
    }
    if (ride.status === RIDE_STATUS.IN_PROGRESS) {
      if (phaseQuery === PASSENGER_IN_PROGRESS_PHASE.ARRIVING_DROPOFF) {
        sheet.dataset.phase = PASSENGER_IN_PROGRESS_PHASE.ARRIVING_DROPOFF;
        renderArrivingDropoffSheet(sheet, ride);
        bindCommonSheetHandlers();
        const finishRateBtn = sheet.querySelector('#arp-finish-rate');
        if (finishRateBtn) {
          finishRateBtn.addEventListener('click', () => {
            toast('Экран оценки будет добавлен позже');
          });
        }
        return;
      }
      renderInProgressSheet(sheet, ride);
      bindCommonSheetHandlers();
      const addStopBtn = sheet.querySelector('#arp-add-stop');
      if (addStopBtn) {
        addStopBtn.addEventListener('click', () => {
          toast('Добавление остановки будет добавлено позже');
        });
      }
      const shareSquareBtn = sheet.querySelector('#arp-share-square');
      if (shareSquareBtn) {
        shareSquareBtn.addEventListener('click', () => {
          toast('Поделиться поездкой пока заглушка');
        });
      }
      return;
    }
    // DRIVER_EN_ROUTE / DRIVER_APPROACHING_PICKUP
    renderEnRouteSheet(sheet, ride);
    bindCommonSheetHandlers();
    const refineBtn = sheet.querySelector('#arp-refine');
    if (refineBtn) {
      refineBtn.addEventListener('click', () => {
        toast('Уточнение места подачи будет добавлено позже');
      });
    }
    const cancelBtn = sheet.querySelector('#arp-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        // BD-RIDE-SIM-01 — passenger cancels after the driver has
        // already accepted. Persist the current view first so the
        // ride's passenger identity (sim overrides — Алексей, route,
        // note, price) is written to localStorage before the status
        // transition; otherwise updateActiveRideStatus would materialize
        // a bare demo via getActiveRide and the driver-side canceled
        // sheet would not see the audit scenario.
        saveActiveRide(ride);
        updateActiveRideStatus(ride.tripId, RIDE_STATUS.CANCELED, {
          cancel: {
            by: 'passenger',
            reason: 'passenger_cancel_after_accept',
          },
        });
        go(`/active-ride?role=passenger&status=${RIDE_STATUS.CANCELED}&tripId=${encodeURIComponent(ride.tripId)}`);
      });
    }
  }

  renderSheet();
  return root;
}
