// BD-RIDE-D-02 — Driver active ride state transitions
// (DRIVER_EN_ROUTE → WAITING_PASSENGER → IN_PROGRESS → COMPLETED).
// Mock/UI only. No Mapbox SDK, no token, no backend, no geolocation,
// no real calls, no payments, no push, no packages.

import { escapeHtml } from '../util.js';
import { go } from '../router.js';
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

const MESSAGE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>
</svg>`;

const PHONE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.56 2.81.69A2 2 0 0 1 22 16.92z"/>
</svg>`;

const CHAT_STORAGE_KEY = 'bazardrive.chat.v1';

export function parseMoney(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const digits = value.replace(/[^\d-]/g, '');
  if (!digits) return 0;
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

export function formatRub(value) {
  const n = Math.round(Number(value) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n).toString();
  const withSpaces = abs.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${withSpaces} ₽`;
}

export function parsePercent(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1 ? value / 100 : value;
  }
  if (typeof value !== 'string') return 0;
  const cleaned = value.replace(/\s/g, '').replace(',', '.').replace('%', '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return n / 100;
}

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
  const ts = ride.timestamps || {};
  if (ts.acceptedAt || ts.arrivedAt || ts.startedAt || ts.completedAt || ts.canceledAt) {
    return ride;
  }
  const next = { ...ride, status: RIDE_STATUS.NEW_ORDER };
  return saveActiveRide(next);
}

function pad2(n) { return n < 10 ? `0${n}` : String(n); }

function appendDriverChatMessage(tripId, text) {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    let store = {};
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (parsed.chatId && Array.isArray(parsed.messages)) {
          store = { [parsed.chatId]: parsed.messages };
        } else {
          store = parsed;
        }
      }
    }
    const chatId = `trip-${tripId}`;
    const list = Array.isArray(store[chatId]) ? store[chatId].slice() : [];
    const now = new Date();
    list.push({
      id: Date.now(),
      dir: 'out',
      text,
      time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
    });
    store[chatId] = list;
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // storage unavailable — fail soft.
  }
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
    <div class="active-ride__map-banner" id="ar-map-banner" hidden>
      <span class="active-ride__map-banner-dot" aria-hidden="true"></span>
      <span class="active-ride__map-banner-text"></span>
    </div>
  `;
  root.appendChild(top);

  const mapBanner = top.querySelector('#ar-map-banner');
  const mapBannerText = mapBanner.querySelector('.active-ride__map-banner-text');
  function setMapBanner(text) {
    if (!text) {
      mapBanner.hidden = true;
      mapBannerText.textContent = '';
      return;
    }
    mapBannerText.textContent = text;
    mapBanner.hidden = false;
  }

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

  // ── Helpers ───────────────────────────────────────────────
  function passengerRowHtml(passenger) {
    return `
      <div class="active-ride__passenger">
        <div class="active-ride__passenger-main">
          <div class="active-ride__avatar" aria-hidden="true">${escapeHtml(passenger.initials || 'АМ')}</div>
          <div class="active-ride__passenger-info">
            <div class="active-ride__passenger-name">
              ${escapeHtml(passenger.name || '')}
              <span class="active-ride__passenger-rating">★ ${escapeHtml(passenger.rating || '')}</span>
            </div>
            <div class="active-ride__passenger-meta">
              ${escapeHtml(passenger.phoneMasked || '')}${passenger.luggage ? ` · ${escapeHtml(passenger.luggage)}` : ''}
            </div>
          </div>
        </div>
        <div class="active-ride__passenger-actions">
          <button type="button" class="active-ride__icon-action" id="ar-msg" aria-label="Написать пассажиру">${MESSAGE_SVG}</button>
          <button type="button" class="active-ride__icon-action" id="ar-call" aria-label="Позвонить пассажиру">${PHONE_SVG}</button>
        </div>
      </div>
    `;
  }

  function bindPassengerActions() {
    const msgBtn = sheet.querySelector('#ar-msg');
    if (msgBtn) {
      msgBtn.addEventListener('click', () => {
        go(`/chat?tripId=${encodeURIComponent(ride.tripId)}`);
      });
    }
    const callBtn = sheet.querySelector('#ar-call');
    if (callBtn) {
      callBtn.addEventListener('click', () => {
        showNotice('Звонок пассажиру пока заглушка');
      });
    }
  }

  // ── Sheet renderers ───────────────────────────────────────
  function renderSheet() {
    sheet.replaceChildren();
    sheet.dataset.status = ride.status;
    setMapBanner('');

    if (ride.status === RIDE_STATUS.NEW_ORDER) {
      renderNewOrder();
    } else if (ride.status === RIDE_STATUS.DRIVER_EN_ROUTE
            || ride.status === RIDE_STATUS.DRIVER_APPROACHING_PICKUP) {
      renderEnRoute();
    } else if (ride.status === RIDE_STATUS.WAITING_PASSENGER) {
      renderWaiting();
    } else if (ride.status === RIDE_STATUS.IN_PROGRESS) {
      renderInProgress();
    } else if (ride.status === RIDE_STATUS.COMPLETED) {
      renderCompleted();
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
        <div class="active-ride__sheet-head-main">
          <div class="active-ride__sheet-title">Едете к пассажиру</div>
          <div class="active-ride__sheet-sub">
            ${escapeHtml(ride.order?.pickupDistance || '')} · ${escapeHtml(ride.route?.pickupLabel || '')}
          </div>
        </div>
        <div class="active-ride__pickup-eta" aria-label="Время до подачи">
          <div class="active-ride__pickup-eta-value">${escapeHtml(ride.order?.pickupEta || '')}</div>
          <div class="active-ride__pickup-eta-label">до подачи</div>
        </div>
      </div>

      <div class="active-ride__nav-card">
        <div class="active-ride__nav-icon" aria-hidden="true">${ARROW_SVG}</div>
        <div class="active-ride__nav-body">
          <div class="active-ride__nav-main">${escapeHtml(ride.route?.currentInstruction || '')}</div>
          <div class="active-ride__nav-sub">${escapeHtml(ride.route?.currentStreet || '')}</div>
        </div>
        <button type="button" class="active-ride__map-btn" id="ar-nav-btn">Навигатор</button>
      </div>

      ${passengerRowHtml(passenger)}

      <div class="active-ride__actions active-ride__actions--stack">
        <button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-arrived">Я на месте</button>
        <div class="active-ride__secondary-actions">
          <button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-write">Написать «подъезжаю»</button>
          <button type="button" class="bd-btn ghost active-ride__btn-cancel" id="ar-cancel">Отменить</button>
        </div>
      </div>
    `;

    sheet.querySelector('#ar-nav-btn').addEventListener('click', () => {
      showNotice('Навигатор будет доступен после Mapbox integration');
    });
    sheet.querySelector('#ar-arrived').addEventListener('click', () => {
      ride = updateActiveRideStatus(ride.tripId, RIDE_STATUS.WAITING_PASSENGER);
      renderSheet();
    });
    sheet.querySelector('#ar-write').addEventListener('click', () => {
      appendDriverChatMessage(ride.tripId, 'Подъезжаю к точке подачи');
      showNotice('Сообщение «подъезжаю» отправлено');
    });
    sheet.querySelector('#ar-cancel').addEventListener('click', () => {
      showNotice('Отмена поездки будет реализована позже');
    });
    bindPassengerActions();
  }

  function renderWaiting() {
    const passenger = ride.passenger || {};
    const waiting = ride.waiting || {};
    const remaining = waiting.remaining || '2:30';
    const freeLimit = waiting.freeLimit || '3:00';
    const paidStartsAt = waiting.paidStartsAt || '14:18';
    const paidRate = waiting.paidRate || '8 ₽ за каждую минуту';

    function toSeconds(mmss) {
      const m = /^(\d+):(\d+)$/.exec(String(mmss || ''));
      if (!m) return null;
      return Number(m[1]) * 60 + Number(m[2]);
    }
    const remSec = toSeconds(remaining);
    const totalSec = toSeconds(freeLimit);
    let pct = 100;
    if (remSec != null && totalSec && totalSec > 0) {
      pct = Math.max(0, Math.min(100, Math.round((remSec / totalSec) * 100)));
    }

    setMapBanner('Пассажир уведомлён · ждёт у подъезда');

    sheet.innerHTML = `
      <div class="active-ride__sheet-head">
        <div class="active-ride__sheet-head-main">
          <div class="active-ride__sheet-title">Ожидание пассажира</div>
          <div class="active-ride__sheet-sub">
            Платное ожидание начнётся в ${escapeHtml(paidStartsAt)}
          </div>
        </div>
        <div class="active-ride__waiting-badge" aria-label="Осталось бесплатного ожидания">
          <div class="active-ride__waiting-badge-value">${escapeHtml(remaining)}</div>
          <div class="active-ride__waiting-badge-label">осталось</div>
        </div>
      </div>

      <div class="active-ride__waiting-card">
        <div class="active-ride__waiting-card-head">
          <span class="active-ride__waiting-card-title">Бесплатное ожидание</span>
          <span class="active-ride__waiting-card-value">${escapeHtml(remaining)} / ${escapeHtml(freeLimit)}</span>
        </div>
        <div class="active-ride__progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
          <div class="active-ride__progress-bar-fill" data-step="${Math.round(pct / 10)}"></div>
        </div>
        <div class="active-ride__waiting-card-foot">Дальше — ${escapeHtml(paidRate)}</div>
      </div>

      ${passengerRowHtml(passenger)}

      <div class="active-ride__actions active-ride__actions--stack">
        <button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-start">Начать поездку</button>
        <div class="active-ride__secondary-actions">
          <button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-call-passenger">Позвонить пассажиру</button>
          <button type="button" class="bd-btn ghost active-ride__btn-cancel" id="ar-no-show">Не приехал</button>
        </div>
      </div>
    `;

    sheet.querySelector('#ar-start').addEventListener('click', () => {
      ride = updateActiveRideStatus(ride.tripId, RIDE_STATUS.IN_PROGRESS);
      renderSheet();
    });
    sheet.querySelector('#ar-call-passenger').addEventListener('click', () => {
      showNotice('Звонок пассажиру пока заглушка');
    });
    sheet.querySelector('#ar-no-show').addEventListener('click', () => {
      showNotice('Отметка «не приехал» будет реализована позже');
    });
    bindPassengerActions();
  }

  function renderInProgress() {
    const passenger = ride.passenger || {};
    const finishPrice = ride.ride?.price || '';
    sheet.innerHTML = `
      <div class="active-ride__sheet-head">
        <div class="active-ride__sheet-head-main">
          <div class="active-ride__sheet-title">Везёте пассажира</div>
          <div class="active-ride__sheet-sub">${escapeHtml(ride.route?.dropoffLabel || '')}</div>
        </div>
        <div class="active-ride__pickup-eta active-ride__pickup-eta--progress" aria-label="Время до места">
          <div class="active-ride__pickup-eta-value">${escapeHtml(ride.route?.etaToDestination || '')}</div>
          <div class="active-ride__pickup-eta-label">до места</div>
        </div>
      </div>

      <div class="active-ride__nav-card">
        <div class="active-ride__nav-icon" aria-hidden="true">${ARROW_SVG}</div>
        <div class="active-ride__nav-body">
          <div class="active-ride__nav-main">${escapeHtml(ride.route?.currentInstruction || '')}</div>
          <div class="active-ride__nav-sub">${escapeHtml(ride.route?.currentStreet || '')}</div>
        </div>
        <button type="button" class="active-ride__map-btn" id="ar-nav-btn">Навигатор</button>
      </div>

      ${passengerRowHtml(passenger)}

      <div class="active-ride__actions active-ride__actions--stack">
        <button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-finish">
          Завершить${finishPrice ? ` · ${escapeHtml(finishPrice)}` : ''}
        </button>
        <div class="active-ride__secondary-actions">
          <button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-stop">+ Остановка</button>
          <button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-issue">Проблема</button>
        </div>
      </div>
    `;

    sheet.querySelector('#ar-nav-btn').addEventListener('click', () => {
      showNotice('Навигатор будет доступен после Mapbox integration');
    });
    sheet.querySelector('#ar-finish').addEventListener('click', () => {
      ride = updateActiveRideStatus(ride.tripId, RIDE_STATUS.COMPLETED);
      renderSheet();
    });
    sheet.querySelector('#ar-stop').addEventListener('click', () => {
      showNotice('Добавление остановки будет доступно позже');
    });
    sheet.querySelector('#ar-issue').addEventListener('click', () => {
      showNotice('Раздел помощи будет добавлен позже');
    });
    bindPassengerActions();
  }

  function renderCompleted() {
    const gross = parseMoney(ride.ride?.price);
    const commissionRate = parsePercent(ride.order?.commission);
    const commissionAmount = Math.round(gross * commissionRate);
    const net = gross - commissionAmount;
    const previousToday = parseMoney(ride.ride?.todayEarnings);
    const nextToday = previousToday + net;
    const previousTrips = Number(ride.ride?.tripsToday || 0);
    const nextTrips = previousTrips + 1;

    const commissionLabel = ride.order?.commission
      ? String(ride.order.commission)
      : `${Math.round(commissionRate * 100)}%`;
    const dropoffLabel = ride.route?.dropoffLabel || '';

    sheet.innerHTML = `
      <div class="active-ride__completion-card">
        <div class="active-ride__completion">
          <div class="active-ride__completion-badge" aria-hidden="true">✓</div>
          <div class="active-ride__sheet-title">Поездка завершена</div>
          ${dropoffLabel ? `<div class="active-ride__completion-route">${escapeHtml(dropoffLabel)}</div>` : ''}
        </div>

        <div class="active-ride__earnings-total">
          <div class="active-ride__completion-price">${escapeHtml(formatRub(gross))}</div>
          <div class="active-ride__completion-note">стоимость поездки</div>
        </div>

        <div class="active-ride__earnings-breakdown" role="list">
          <div class="active-ride__earnings-row" role="listitem">
            <span class="active-ride__earnings-row-label">Комиссия сервиса</span>
            <span class="active-ride__earnings-row-value">${escapeHtml(commissionLabel)}</span>
          </div>
          <div class="active-ride__earnings-row" role="listitem">
            <span class="active-ride__earnings-row-label">К удержанию</span>
            <span class="active-ride__earnings-row-value">${escapeHtml(formatRub(commissionAmount))}</span>
          </div>
          <div class="active-ride__earnings-row active-ride__earnings-row--net" role="listitem">
            <span class="active-ride__earnings-row-label">Ваш доход</span>
            <span class="active-ride__earnings-row-value">${escapeHtml(formatRub(net))}</span>
          </div>
        </div>

        <div class="active-ride__shift-summary">
          <div class="active-ride__shift-summary-title">Смена сегодня</div>
          <div class="active-ride__shift-delta">
            <span class="active-ride__shift-delta-prev">${escapeHtml(formatRub(previousToday))}</span>
            <span class="active-ride__shift-delta-arrow" aria-hidden="true">→</span>
            <span class="active-ride__shift-delta-next">${escapeHtml(formatRub(nextToday))}</span>
          </div>
          <div class="active-ride__shift-delta active-ride__shift-delta--trips">
            <span class="active-ride__shift-delta-prev">${escapeHtml(String(previousTrips))} поездок</span>
            <span class="active-ride__shift-delta-arrow" aria-hidden="true">→</span>
            <span class="active-ride__shift-delta-next">${escapeHtml(String(nextTrips))} поездок</span>
          </div>
        </div>
      </div>

      <div class="active-ride__completion-actions">
        <button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-next-order">Следующий заказ</button>
        <div class="active-ride__secondary-actions">
          <button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-back-feed">Вернуться в ленту</button>
          <button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-open-chat">Открыть чат</button>
        </div>
      </div>
    `;

    sheet.querySelector('#ar-next-order').addEventListener('click', () => {
      showNotice('Следующий заказ будет добавлен позже');
    });
    sheet.querySelector('#ar-back-feed').addEventListener('click', () => {
      go('/feed');
    });
    sheet.querySelector('#ar-open-chat').addEventListener('click', () => {
      go(`/chat?tripId=${encodeURIComponent(ride.tripId)}`);
    });
  }

  function renderCanceledStub() {
    sheet.innerHTML = `
      <div class="active-ride__sheet-head">
        <div class="active-ride__sheet-title">Заказ отменён</div>
      </div>
      <div class="active-ride__stub">
        Полный flow отмены будет добавлен позже
      </div>
      <div class="active-ride__actions active-ride__actions--stack">
        <button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-back-feed">Вернуться в ленту</button>
      </div>
    `;
    sheet.querySelector('#ar-back-feed').addEventListener('click', () => {
      go('/feed');
    });
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
