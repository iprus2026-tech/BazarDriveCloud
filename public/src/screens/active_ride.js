// BD-RIDE-D-02 / D-07 / D-08 / D-09 — Driver active ride flow.
// Mock/UI only. No Mapbox SDK, no token, no backend, no geolocation,
// no real calls, no payments, no push, no packages.

import { escapeHtml } from '../util.js';
import { go } from '../router.js';
import { user } from '../state.js';
import {
  findActiveRide,
  updateActiveRideStatus,
  saveActiveRide,
  createDemoActiveRide,
  SIM_AUDIT_RIDE_OVERRIDES,
  RIDE_STATUS,
  DEMO_ACTIVE_RIDE_ID,
} from '../ride_state.js';
import { createMapShell } from '../mapbox/map_shell.js';
import activeRidePassenger from './active_ride_passenger.js';

const CHAT_STORAGE_KEY = 'bazardrive.chat.v1';
const DRIVER_SHEETS_CSS_ID = 'driver-sheets-css';

const DRIVER_SIMULATION_STATUSES = new Set([
  RIDE_STATUS.NEW_ORDER,
  RIDE_STATUS.DRIVER_EN_ROUTE,
  RIDE_STATUS.DRIVER_APPROACHING_PICKUP,
  RIDE_STATUS.WAITING_PASSENGER,
  RIDE_STATUS.IN_PROGRESS,
  RIDE_STATUS.COMPLETED,
  RIDE_STATUS.CANCELED,
  RIDE_STATUS.NO_SHOW,
]);

const CANCEL_REASONS = [
  ['unreachable', 'Пассажир не выходит на связь', 'Позвонил и написал, ответа нет'],
  ['late', 'Пассажир далеко / не успеваю', 'Не получается вовремя подать машину'],
  ['blocked_address', 'Адрес недоступен / закрытая территория', 'Нет подъезда к точке подачи'],
  ['car_trouble', 'Проблема с автомобилем', 'Нужно остановить заказ до подачи'],
  ['other', 'Другое', 'Причина mock-only, без расширения ride_state.js'],
];

const PROBLEM_TYPES = [
  ['PASSENGER_NO_SHOW', 'Пассажир не приехал', 'После подтверждения статус станет NO_SHOW'],
  ['PASSENGER_UNREACHABLE', 'Не могу связаться с пассажиром', 'Safe stub без записи в storage'],
  ['ROUTE_ISSUE', 'Проблема с маршрутом / адресом', 'Safe stub без изменения поездки'],
  ['CAR_TROUBLE', 'Проблема с автомобилем', 'Safe stub без изменения поездки'],
  ['SAFETY_INCIDENT', 'Опасная ситуация / конфликт', 'Safety stub без реального звонка'],
  ['OTHER', 'Другое', 'Mock-сообщение в поддержку'],
];

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
  return `${sign}${abs.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₽`;
}

export function parsePercent(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1 ? value / 100 : value;
  if (typeof value !== 'string') return 0;
  const n = Number(value.replace(/\s/g, '').replace(',', '.').replace('%', ''));
  return Number.isFinite(n) ? n / 100 : 0;
}

function getHashQuery() {
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  return qi === -1 ? new URLSearchParams() : new URLSearchParams(hash.slice(qi + 1));
}

function ensureDriverSheetsCss() {
  if (document.getElementById(DRIVER_SHEETS_CSS_ID)) return;
  const link = document.createElement('link');
  link.id = DRIVER_SHEETS_CSS_ID;
  link.rel = 'stylesheet';
  link.href = './styles/driver_sheets.css';
  document.head.appendChild(link);
}

function safeApplyStatusFromQuery(ride, statusQuery) {
  if (!statusQuery || !DRIVER_SIMULATION_STATUSES.has(statusQuery) || ride.status === statusQuery) return ride;
  const ts = ride.timestamps || {};
  if (statusQuery === RIDE_STATUS.NEW_ORDER) {
    if (ts.acceptedAt || ts.arrivedAt || ts.startedAt || ts.completedAt || ts.canceledAt) return ride;
    return saveActiveRide({ ...ride, status: RIDE_STATUS.NEW_ORDER });
  }
  if (statusQuery === RIDE_STATUS.DRIVER_EN_ROUTE || statusQuery === RIDE_STATUS.DRIVER_APPROACHING_PICKUP) {
    if (ts.arrivedAt || ts.startedAt || ts.completedAt || ts.canceledAt) return ride;
    return { ...ride, status: statusQuery };
  }
  if (statusQuery === RIDE_STATUS.WAITING_PASSENGER) {
    if (ts.startedAt || ts.completedAt || ts.canceledAt) return ride;
    return { ...ride, status: statusQuery };
  }
  if (statusQuery === RIDE_STATUS.IN_PROGRESS) {
    if (ts.completedAt || ts.canceledAt) return ride;
    return { ...ride, status: statusQuery };
  }
  if (statusQuery === RIDE_STATUS.COMPLETED) {
    if (ts.canceledAt) return ride;
    return { ...ride, status: statusQuery };
  }
  if (statusQuery === RIDE_STATUS.CANCELED || statusQuery === RIDE_STATUS.NO_SHOW) {
    if (ts.completedAt) return ride;
    return { ...ride, status: statusQuery };
  }
  return ride;
}

function pad2(n) { return n < 10 ? `0${n}` : String(n); }

function appendDriverChatMessage(tripId, text) {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    let store = {};
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        store = parsed.chatId && Array.isArray(parsed.messages) ? { [parsed.chatId]: parsed.messages } : parsed;
      }
    }
    const chatId = `trip-${tripId}`;
    const list = Array.isArray(store[chatId]) ? store[chatId].slice() : [];
    const now = new Date();
    list.push({ id: Date.now(), dir: 'out', text, time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}` });
    store[chatId] = list;
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // storage unavailable — fail soft.
  }
}

function renderPassenger() {
  const query = getHashQuery();
  return activeRidePassenger({
    tripId: query.get('tripId') || DEMO_ACTIVE_RIDE_ID,
    statusQuery: query.get('status'),
    phaseQuery: query.get('phase'),
    paymentQuery: query.get('payment'),
  });
}

function renderDriverEmpty() {
  const root = document.createElement('section');
  root.className = 'screen screen--active-ride';
  root.innerHTML = `
    <div class="active-ride__passenger-placeholder" role="status" aria-live="polite">
      <div class="active-ride__passenger-placeholder-text">Нет активного заказа. Откройте ленту и примите заказ.</div>
      <div class="active-ride__actions active-ride__actions--stack">
        <button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-empty-feed">Открыть ленту</button>
      </div>
    </div>
  `;
  root.querySelector('#ar-empty-feed').addEventListener('click', () => go('/feed'));
  return root;
}

function calcEarnings(ride) {
  const gross = parseMoney(ride.ride?.price);
  const commissionRate = parsePercent(ride.order?.commission);
  const commissionAmount = Math.round(gross * commissionRate);
  const net = gross - commissionAmount;
  const previousToday = parseMoney(ride.ride?.todayEarnings);
  const previousTrips = Number(ride.ride?.tripsToday || 0);
  return {
    gross,
    commissionAmount,
    net,
    previousToday,
    nextToday: previousToday + net,
    previousTrips,
    nextTrips: previousTrips + 1,
    commissionLabel: ride.order?.commission ? String(ride.order.commission) : `${Math.round(commissionRate * 100)}%`,
  };
}

function renderOptions(options, selected) {
  return options.map(([value, label, meta]) => `
    <button type="button" class="driver-sheet__option${selected === value ? ' driver-sheet__option--selected' : ''}" role="radio" aria-checked="${selected === value ? 'true' : 'false'}" data-value="${escapeHtml(value)}">
      <span class="driver-sheet__radio-dot" aria-hidden="true"></span>
      <span class="driver-sheet__option-copy"><span class="driver-sheet__option-label">${escapeHtml(label)}</span><span class="driver-sheet__option-meta">${escapeHtml(meta)}</span></span>
    </button>
  `).join('');
}

function createDriverSheet(root, config) {
  const previousFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = `driver-sheet driver-sheet--${config.kind}`;
  overlay.innerHTML = `
    <div class="driver-sheet__backdrop" data-driver-sheet-close="true"></div>
    <section class="driver-sheet__panel" role="dialog" aria-modal="true" aria-labelledby="${escapeHtml(config.titleId)}" tabindex="-1">
      <div class="driver-sheet__handle" aria-hidden="true"></div>
      <div class="driver-sheet__head"><div><div class="driver-sheet__eyebrow">${escapeHtml(config.eyebrow)}</div><h2 class="driver-sheet__title" id="${escapeHtml(config.titleId)}">${escapeHtml(config.title)}</h2></div><button type="button" class="driver-sheet__close" aria-label="Закрыть" data-driver-sheet-close="true">×</button></div>
      <div class="driver-sheet__body">${config.bodyHtml}</div>
    </section>
  `;
  function close() {
    overlay.removeEventListener('keydown', onKeydown);
    overlay.remove();
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
  }
  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(overlay.querySelectorAll('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])')).filter((el) => !el.disabled && !el.hidden);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  overlay.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.dataset.driverSheetClose === 'true') close();
  });
  overlay.addEventListener('keydown', onKeydown);
  root.appendChild(overlay);
  const focusTarget = overlay.querySelector('button, [tabindex]');
  if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
  return { overlay, close };
}

function bindOptionGroup(overlay, selected, onChange) {
  let current = selected || '';
  const buttons = Array.from(overlay.querySelectorAll('.driver-sheet__option'));
  function sync() {
    buttons.forEach((btn) => {
      const checked = btn.dataset.value === current;
      btn.classList.toggle('driver-sheet__option--selected', checked);
      btn.setAttribute('aria-checked', checked ? 'true' : 'false');
    });
    onChange(current);
  }
  buttons.forEach((btn) => btn.addEventListener('click', () => {
    current = btn.dataset.value || '';
    sync();
  }));
  sync();
}

function openDriverCancelSheet(root, { onConfirm }) {
  let selected = '';
  let confirmPending = false;
  const sheet = createDriverSheet(root, {
    kind: 'cancel',
    titleId: 'driver-cancel-title',
    eyebrow: 'BD-RIDE-D-07',
    title: 'Отменить поездку?',
    bodyHtml: `
      <p class="driver-sheet__lead">Выберите причину. Она останется mock-only и не меняет схему ride_state.js.</p>
      <div class="driver-sheet__options" role="radiogroup" aria-label="Причина отмены">${renderOptions(CANCEL_REASONS, selected)}</div>
      <div class="driver-sheet__confirm" id="driver-cancel-confirm" hidden><strong>Подтверждение отмены</strong><span>Следующее нажатие переведёт поездку в CANCELED.</span></div>
      <div class="driver-sheet__actions"><button type="button" class="bd-btn primary driver-sheet__primary" id="driver-cancel-primary" disabled>Подтвердить отмену</button><button type="button" class="bd-btn ghost driver-sheet__secondary" data-driver-sheet-close="true">Назад к поездке</button></div>
    `,
  });
  const primary = sheet.overlay.querySelector('#driver-cancel-primary');
  const confirmBox = sheet.overlay.querySelector('#driver-cancel-confirm');
  bindOptionGroup(sheet.overlay, selected, (next) => {
    selected = next;
    primary.disabled = !selected;
  });
  primary.addEventListener('click', () => {
    if (!selected) return;
    if (!confirmPending) {
      confirmPending = true;
      confirmBox.hidden = false;
      primary.textContent = 'Да, отменить';
      return;
    }
    sheet.close();
    onConfirm(selected);
  });
}

function problemNoticeText(type) {
  if (type === 'SAFETY_INCIDENT') return 'Safety-stub открыт. Реальной экстренной интеграции нет.';
  if (type === 'PASSENGER_UNREACHABLE') return 'Сигнал «не могу связаться» отправлен в mock-поддержку';
  if (type === 'ROUTE_ISSUE') return 'Проблема маршрута сохранена как mock';
  if (type === 'CAR_TROUBLE') return 'Проблема с автомобилем сохранена как mock';
  return 'Проблема отправлена в mock-поддержку';
}

function openDriverProblemSheet(root, { type = '', onNoShow, onResolve }) {
  let selected = type;
  let confirmPending = false;
  const sheet = createDriverSheet(root, {
    kind: 'problem',
    titleId: 'driver-problem-title',
    eyebrow: 'BD-RIDE-D-08',
    title: 'Что случилось?',
    bodyHtml: `
      <p class="driver-sheet__lead">Только «Пассажир не приехал» переводит поездку в NO_SHOW. Остальное безопасные заглушки.</p>
      <div class="driver-sheet__options" role="radiogroup" aria-label="Тип проблемы">${renderOptions(PROBLEM_TYPES, selected)}</div>
      <div class="driver-sheet__confirm" id="driver-problem-confirm" hidden><strong>Отметить no-show?</strong><span>Следующее нажатие переведёт поездку в NO_SHOW.</span></div>
      <div class="driver-sheet__actions"><button type="button" class="bd-btn primary driver-sheet__primary" id="driver-problem-primary" disabled>Сообщить</button><button type="button" class="bd-btn ghost driver-sheet__secondary" data-driver-sheet-close="true">Назад к поездке</button></div>
    `,
  });
  const primary = sheet.overlay.querySelector('#driver-problem-primary');
  const confirmBox = sheet.overlay.querySelector('#driver-problem-confirm');
  function syncPrimary(value) {
    primary.disabled = !value;
    if (value === 'PASSENGER_NO_SHOW') primary.textContent = confirmPending ? 'Отметить no-show' : 'Отметить';
    else if (value === 'SAFETY_INCIDENT') primary.textContent = 'Связаться с поддержкой';
    else primary.textContent = 'Сообщить';
  }
  bindOptionGroup(sheet.overlay, selected, (next) => {
    selected = next;
    confirmPending = false;
    confirmBox.hidden = true;
    syncPrimary(selected);
  });
  primary.addEventListener('click', () => {
    if (!selected) return;
    if (selected === 'PASSENGER_NO_SHOW') {
      if (!confirmPending) {
        confirmPending = true;
        confirmBox.hidden = false;
        syncPrimary(selected);
        return;
      }
      sheet.close();
      onNoShow(selected);
      return;
    }
    sheet.close();
    onResolve(problemNoticeText(selected));
  });
}

function moneyAria(value) {
  return `${Math.round(Number(value) || 0)} рублей`;
}

function openDriverEarningsSheet(root, { ride }) {
  const e = calcEarnings(ride);
  const dropoff = ride.route?.dropoffLabel || 'Точка назначения';
  createDriverSheet(root, {
    kind: 'earnings',
    titleId: 'driver-earnings-title',
    eyebrow: 'BD-RIDE-D-09',
    title: 'Подробнее о доходе',
    bodyHtml: `
      <div class="driver-sheet__earnings-hero" aria-label="Ваш доход: ${escapeHtml(moneyAria(e.net))}"><div class="driver-sheet__earnings-label">Ваш доход</div><div class="driver-sheet__earnings-total">${escapeHtml(formatRub(e.net))}</div><div class="driver-sheet__earnings-route">${escapeHtml(dropoff)}</div></div>
      <div class="driver-sheet__breakdown" role="list" aria-label="Разбивка поездки">
        <div class="driver-sheet__row" role="listitem"><span>Стоимость поездки</span><strong>${escapeHtml(formatRub(e.gross))}</strong></div>
        <div class="driver-sheet__row" role="listitem"><span>Комиссия сервиса</span><strong>${escapeHtml(e.commissionLabel)}</strong></div>
        <div class="driver-sheet__row" role="listitem"><span>К удержанию</span><strong>${escapeHtml(formatRub(e.commissionAmount))}</strong></div>
        <div class="driver-sheet__row driver-sheet__row--net" role="listitem"><span>Итого водителю</span><strong>${escapeHtml(formatRub(e.net))}</strong></div>
      </div>
      <div class="driver-sheet__shift"><div class="driver-sheet__shift-title">Смена сегодня</div><div class="driver-sheet__shift-line"><span>${escapeHtml(formatRub(e.previousToday))}</span><span>→</span><strong>${escapeHtml(formatRub(e.nextToday))}</strong></div><div class="driver-sheet__shift-line"><span>${escapeHtml(String(e.previousTrips))} поездок</span><span>→</span><strong>${escapeHtml(String(e.nextTrips))} поездок</strong></div></div>
      <div class="driver-sheet__actions"><button type="button" class="bd-btn primary driver-sheet__primary" data-driver-sheet-close="true">Закрыть</button></div>
    `,
  });
}

export default function activeRide() {
  const query = getHashQuery();
  const role = query.get('role') || (user.get().role === 'driver' ? 'driver' : 'passenger');
  if (role !== 'driver') return renderPassenger();
  ensureDriverSheetsCss();

  const tripId = query.get('tripId') || DEMO_ACTIVE_RIDE_ID;
  const statusQuery = query.get('status');
  let ride = findActiveRide(tripId);
  if (!ride) {
    if (!statusQuery || !DRIVER_SIMULATION_STATUSES.has(statusQuery)) return renderDriverEmpty();
    ride = createDemoActiveRide({ tripId, ...SIM_AUDIT_RIDE_OVERRIDES });
  }
  ride = safeApplyStatusFromQuery(ride, statusQuery);

  const root = document.createElement('section');
  root.className = 'screen screen--active-ride';
  const mapWrap = document.createElement('div');
  mapWrap.className = 'active-ride__map';
  mapWrap.appendChild(createMapShell({ variant: 'driver', status: ride.status, route: ride.route }));
  root.appendChild(mapWrap);

  const top = document.createElement('div');
  top.className = 'active-ride__top';
  top.innerHTML = `
    <div class="active-ride__status-row"><button type="button" class="bd-iconbtn active-ride__icon-btn" id="ar-gear" aria-label="Настройки смены">⚙</button><div class="active-ride__status-pill" role="status" aria-live="polite"><span class="active-ride__status-dot" aria-hidden="true"></span><span class="active-ride__status-text">${escapeHtml(ride.driver?.onlineLabel || 'На линии')}</span><span class="active-ride__status-sep" aria-hidden="true">|</span><span class="active-ride__status-time">${escapeHtml(ride.driver?.shiftDuration || '5ч 12м')}</span></div><button type="button" class="bd-iconbtn active-ride__icon-btn" id="ar-shield" aria-label="Безопасность">🛡</button></div>
    <div class="active-ride__stats" role="group" aria-label="Статистика смены"><div class="active-ride__stat"><div class="active-ride__stat-value">${escapeHtml(ride.ride?.todayEarnings || '0 ₽')}</div><div class="active-ride__stat-label">сегодня</div></div><div class="active-ride__stat"><div class="active-ride__stat-value">${escapeHtml(String(ride.ride?.tripsToday ?? 0))}</div><div class="active-ride__stat-label">поездок</div></div><div class="active-ride__stat"><div class="active-ride__stat-value">★ ${escapeHtml(ride.ride?.rating || '—')}</div><div class="active-ride__stat-label">рейтинг</div></div></div>
    <div class="active-ride__map-banner" id="ar-map-banner" hidden><span class="active-ride__map-banner-dot" aria-hidden="true"></span><span class="active-ride__map-banner-text"></span></div>
  `;
  root.appendChild(top);

  const sheet = document.createElement('div');
  sheet.className = 'active-ride__sheet';
  root.appendChild(sheet);
  const notice = document.createElement('div');
  notice.className = 'active-ride__notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.hidden = true;
  root.appendChild(notice);

  const mapBanner = top.querySelector('#ar-map-banner');
  const mapBannerText = mapBanner.querySelector('.active-ride__map-banner-text');
  let noticeTimer = null;
  function showNotice(message) {
    notice.textContent = message;
    notice.hidden = false;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 3500);
  }
  function setMapBanner(text) {
    mapBannerText.textContent = text || '';
    mapBanner.hidden = !text;
  }
  top.querySelector('#ar-gear').addEventListener('click', () => showNotice('Настройки смены будут добавлены позже'));
  top.querySelector('#ar-shield').addEventListener('click', () => showNotice('Безопасность будет добавлена позже'));

  function passengerRowHtml(passenger) {
    const note = passenger.note || passenger.comment || '';
    return `<div class="active-ride__passenger"><div class="active-ride__passenger-main"><div class="active-ride__avatar" aria-hidden="true">${escapeHtml(passenger.initials || 'АМ')}</div><div class="active-ride__passenger-info"><div class="active-ride__passenger-name">${escapeHtml(passenger.name || '')}<span class="active-ride__passenger-rating">★ ${escapeHtml(passenger.rating || '')}</span></div><div class="active-ride__passenger-meta">${escapeHtml(passenger.phoneMasked || '')}${passenger.luggage ? ` · ${escapeHtml(passenger.luggage)}` : ''}</div></div></div><div class="active-ride__passenger-actions"><button type="button" class="active-ride__icon-action" id="ar-msg" aria-label="Написать пассажиру">💬</button><button type="button" class="active-ride__icon-action" id="ar-call" aria-label="Позвонить пассажиру">☎</button></div></div>${note ? `<div class="active-ride__passenger-note">${escapeHtml(note)}</div>` : ''}`;
  }

  function bindPassengerActions() {
    const msgBtn = sheet.querySelector('#ar-msg');
    if (msgBtn) msgBtn.addEventListener('click', () => go(`/chat?tripId=${encodeURIComponent(ride.tripId)}`));
    const callBtn = sheet.querySelector('#ar-call');
    if (callBtn) callBtn.addEventListener('click', () => showNotice('Звонок пассажиру пока заглушка'));
  }

  function renderSheet() {
    sheet.replaceChildren();
    sheet.dataset.status = ride.status;
    setMapBanner('');
    if (ride.status === RIDE_STATUS.NEW_ORDER) renderNewOrder();
    else if (ride.status === RIDE_STATUS.DRIVER_EN_ROUTE || ride.status === RIDE_STATUS.DRIVER_APPROACHING_PICKUP) renderEnRoute();
    else if (ride.status === RIDE_STATUS.WAITING_PASSENGER) renderWaiting();
    else if (ride.status === RIDE_STATUS.IN_PROGRESS) renderInProgress();
    else if (ride.status === RIDE_STATUS.COMPLETED) renderCompleted();
    else if (ride.status === RIDE_STATUS.CANCELED || ride.status === RIDE_STATUS.NO_SHOW) renderCanceledStub();
    else renderGenericStub();
  }

  function routeRows() {
    return `<ul class="active-ride__route-list" role="list"><li class="active-ride__route-point active-ride__route-point--pickup"><div class="active-ride__route-time">${escapeHtml(ride.order?.pickupEta || '')}</div><div class="active-ride__route-body"><div class="active-ride__route-main">${escapeHtml(ride.route?.pickupLabel || '')}</div><div class="active-ride__route-sub">${escapeHtml(ride.order?.pickupDistance || '')} до пассажира</div></div></li><li class="active-ride__route-point active-ride__route-point--dropoff"><div class="active-ride__route-time">${escapeHtml(ride.order?.destinationEta || '')}</div><div class="active-ride__route-body"><div class="active-ride__route-main">${escapeHtml(ride.route?.dropoffLabel || '')}</div><div class="active-ride__route-sub">${escapeHtml(ride.order?.destinationDistance || '')} · ${escapeHtml(ride.order?.destinationNote || '')}</div></div></li></ul>`;
  }

  function renderNewOrder() {
    const tagsHtml = (ride.order?.tags || []).map((t) => `<span class="active-ride__tag">${escapeHtml(t)}</span>`).join('');
    sheet.innerHTML = `<div class="active-ride__sheet-head"><div class="active-ride__sheet-title"><span class="active-ride__sheet-bullet" aria-hidden="true">●</span>НОВЫЙ ЗАКАЗ</div><div class="active-ride__timer">${escapeHtml(String(ride.order?.acceptTimerSec ?? 14))}</div></div><div class="active-ride__price-row"><div class="active-ride__price-col"><div class="active-ride__price">${escapeHtml(ride.order?.offerPrice || '')}</div><div class="active-ride__meta">${escapeHtml(ride.order?.rate || '')} · комиссия ${escapeHtml(ride.order?.commission || '')}</div></div><button type="button" class="active-ride__map-btn" id="ar-map-btn">Карта</button></div>${routeRows()}${tagsHtml ? `<div class="active-ride__tags" role="list">${tagsHtml}</div>` : ''}<div class="active-ride__actions"><button type="button" class="bd-btn ghost active-ride__btn-skip" id="ar-skip">Пропустить</button><button type="button" class="bd-btn primary active-ride__btn-accept" id="ar-accept">Принять заказ</button></div>`;
    sheet.querySelector('#ar-map-btn').addEventListener('click', () => showNotice('Детальная карта будет доступна после Mapbox integration'));
    sheet.querySelector('#ar-accept').addEventListener('click', () => { ride = updateActiveRideStatus(ride.tripId, RIDE_STATUS.DRIVER_EN_ROUTE); renderSheet(); });
    sheet.querySelector('#ar-skip').addEventListener('click', () => showNotice('Заказ пропущен. Полный idle-flow будет добавлен позже.'));
  }

  function navCard() {
    return `<div class="active-ride__nav-card"><div class="active-ride__nav-icon" aria-hidden="true">➜</div><div class="active-ride__nav-body"><div class="active-ride__nav-main">${escapeHtml(ride.route?.currentInstruction || '')}</div><div class="active-ride__nav-sub">${escapeHtml(ride.route?.currentStreet || '')}</div></div><button type="button" class="active-ride__map-btn" id="ar-nav-btn">Навигатор</button></div>`;
  }

  function renderEnRoute() {
    sheet.innerHTML = `<div class="active-ride__sheet-head"><div class="active-ride__sheet-head-main"><div class="active-ride__sheet-title">Едете к пассажиру</div><div class="active-ride__sheet-sub">${escapeHtml(ride.order?.pickupDistance || '')} · ${escapeHtml(ride.route?.pickupLabel || '')}</div></div><div class="active-ride__pickup-eta"><div class="active-ride__pickup-eta-value">${escapeHtml(ride.order?.pickupEta || '')}</div><div class="active-ride__pickup-eta-label">до подачи</div></div></div>${navCard()}${passengerRowHtml(ride.passenger || {})}<div class="active-ride__actions active-ride__actions--stack"><button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-arrived">Я на месте</button><div class="active-ride__secondary-actions"><button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-write">Написать «подъезжаю»</button><button type="button" class="bd-btn ghost active-ride__btn-cancel" id="ar-cancel">Отменить</button></div></div>`;
    sheet.querySelector('#ar-nav-btn').addEventListener('click', () => showNotice('Навигатор будет доступен после Mapbox integration'));
    sheet.querySelector('#ar-arrived').addEventListener('click', () => { ride = updateActiveRideStatus(ride.tripId, RIDE_STATUS.WAITING_PASSENGER); renderSheet(); });
    sheet.querySelector('#ar-write').addEventListener('click', () => { appendDriverChatMessage(ride.tripId, 'Подъезжаю к точке подачи'); showNotice('Сообщение «подъезжаю» отправлено'); });
    sheet.querySelector('#ar-cancel').addEventListener('click', () => openDriverCancelSheet(root, { onConfirm: () => { ride = updateActiveRideStatus(ride.tripId, RIDE_STATUS.CANCELED); renderSheet(); } }));
    bindPassengerActions();
  }

  function progressStep(remaining, total) {
    const partsA = String(remaining || '').split(':').map(Number);
    const partsB = String(total || '').split(':').map(Number);
    if (partsA.length !== 2 || partsB.length !== 2 || partsA.some(Number.isNaN) || partsB.some(Number.isNaN)) return 10;
    const a = partsA[0] * 60 + partsA[1];
    const b = partsB[0] * 60 + partsB[1];
    return b > 0 ? Math.max(0, Math.min(10, Math.round((a / b) * 10))) : 10;
  }

  function renderWaiting() {
    const waiting = ride.waiting || {};
    const remaining = waiting.remaining || '2:30';
    const freeLimit = waiting.freeLimit || '3:00';
    setMapBanner('Пассажир уведомлён · ждёт у подъезда');
    sheet.innerHTML = `<div class="active-ride__sheet-head"><div class="active-ride__sheet-head-main"><div class="active-ride__sheet-title">Ожидание пассажира</div><div class="active-ride__sheet-sub">Платное ожидание начнётся в ${escapeHtml(waiting.paidStartsAt || '14:18')}</div></div><div class="active-ride__waiting-badge"><div class="active-ride__waiting-badge-value">${escapeHtml(remaining)}</div><div class="active-ride__waiting-badge-label">осталось</div></div></div><div class="active-ride__waiting-card"><div class="active-ride__waiting-card-head"><span class="active-ride__waiting-card-title">Бесплатное ожидание</span><span class="active-ride__waiting-card-value">${escapeHtml(remaining)} / ${escapeHtml(freeLimit)}</span></div><div class="active-ride__progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressStep(remaining, freeLimit) * 10}"><div class="active-ride__progress-bar-fill" data-step="${progressStep(remaining, freeLimit)}"></div></div><div class="active-ride__waiting-card-foot">Дальше — ${escapeHtml(waiting.paidRate || '8 ₽ за каждую минуту')}</div></div>${passengerRowHtml(ride.passenger || {})}<div class="active-ride__actions active-ride__actions--stack"><button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-start">Начать поездку</button><div class="active-ride__secondary-actions"><button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-call-passenger">Позвонить пассажиру</button><button type="button" class="bd-btn ghost active-ride__btn-cancel" id="ar-no-show">Не приехал</button></div></div>`;
    sheet.querySelector('#ar-start').addEventListener('click', () => { ride = updateActiveRideStatus(ride.tripId, RIDE_STATUS.IN_PROGRESS); renderSheet(); });
    sheet.querySelector('#ar-call-passenger').addEventListener('click', () => showNotice('Звонок пассажиру пока заглушка'));
    sheet.querySelector('#ar-no-show').addEventListener('click', () => openDriverProblemSheet(root, { type: 'PASSENGER_NO_SHOW', onNoShow: () => { ride = updateActiveRideStatus(ride.tripId, RIDE_STATUS.NO_SHOW); renderSheet(); }, onResolve: showNotice }));
    bindPassengerActions();
  }

  function renderInProgress() {
    const finishPrice = ride.ride?.price || '';
    sheet.innerHTML = `<div class="active-ride__sheet-head"><div class="active-ride__sheet-head-main"><div class="active-ride__sheet-title">Везёте пассажира</div><div class="active-ride__sheet-sub">${escapeHtml(ride.route?.dropoffLabel || '')}</div></div><div class="active-ride__pickup-eta active-ride__pickup-eta--progress"><div class="active-ride__pickup-eta-value">${escapeHtml(ride.route?.etaToDestination || '')}</div><div class="active-ride__pickup-eta-label">до места</div></div></div>${navCard()}${passengerRowHtml(ride.passenger || {})}<div class="active-ride__actions active-ride__actions--stack"><button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-finish">Завершить${finishPrice ? ` · ${escapeHtml(finishPrice)}` : ''}</button><div class="active-ride__secondary-actions"><button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-stop">+ Остановка</button><button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-issue">Проблема</button></div></div>`;
    sheet.querySelector('#ar-nav-btn').addEventListener('click', () => showNotice('Навигатор будет доступен после Mapbox integration'));
    sheet.querySelector('#ar-finish').addEventListener('click', () => { ride = updateActiveRideStatus(ride.tripId, RIDE_STATUS.COMPLETED); renderSheet(); });
    sheet.querySelector('#ar-stop').addEventListener('click', () => showNotice('Добавление остановки будет доступно позже'));
    sheet.querySelector('#ar-issue').addEventListener('click', () => openDriverProblemSheet(root, { type: 'OTHER', onNoShow: () => { ride = updateActiveRideStatus(ride.tripId, RIDE_STATUS.NO_SHOW); renderSheet(); }, onResolve: showNotice }));
    bindPassengerActions();
  }

  function renderCompleted() {
    const e = calcEarnings(ride);
    const dropoffLabel = ride.route?.dropoffLabel || '';
    sheet.innerHTML = `<div class="active-ride__completion-card"><div class="active-ride__completion"><div class="active-ride__completion-badge" aria-hidden="true">✓</div><div class="active-ride__sheet-title">Поездка завершена</div>${dropoffLabel ? `<div class="active-ride__completion-route">${escapeHtml(dropoffLabel)}</div>` : ''}</div><div class="active-ride__earnings-total"><div class="active-ride__completion-price">${escapeHtml(formatRub(e.gross))}</div><div class="active-ride__completion-note">стоимость поездки</div></div><div class="active-ride__earnings-breakdown" role="list"><div class="active-ride__earnings-row" role="listitem"><span class="active-ride__earnings-row-label">Комиссия сервиса</span><span class="active-ride__earnings-row-value">${escapeHtml(e.commissionLabel)}</span></div><div class="active-ride__earnings-row" role="listitem"><span class="active-ride__earnings-row-label">К удержанию</span><span class="active-ride__earnings-row-value">${escapeHtml(formatRub(e.commissionAmount))}</span></div><div class="active-ride__earnings-row active-ride__earnings-row--net" role="listitem"><span class="active-ride__earnings-row-label">Ваш доход</span><span class="active-ride__earnings-row-value">${escapeHtml(formatRub(e.net))}</span></div></div><div class="active-ride__shift-summary"><div class="active-ride__shift-summary-title">Смена сегодня</div><div class="active-ride__shift-delta"><span class="active-ride__shift-delta-prev">${escapeHtml(formatRub(e.previousToday))}</span><span class="active-ride__shift-delta-arrow" aria-hidden="true">→</span><span class="active-ride__shift-delta-next">${escapeHtml(formatRub(e.nextToday))}</span></div><div class="active-ride__shift-delta active-ride__shift-delta--trips"><span class="active-ride__shift-delta-prev">${escapeHtml(String(e.previousTrips))} поездок</span><span class="active-ride__shift-delta-arrow" aria-hidden="true">→</span><span class="active-ride__shift-delta-next">${escapeHtml(String(e.nextTrips))} поездок</span></div></div></div><div class="active-ride__completion-actions"><button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-next-order">Следующий заказ</button><div class="active-ride__secondary-actions"><button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-earnings">Подробнее о доходе</button><button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-back-feed">Вернуться в ленту</button><button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-open-chat">Открыть чат</button></div></div>`;
    sheet.querySelector('#ar-next-order').addEventListener('click', () => showNotice('Следующий заказ будет добавлен позже'));
    sheet.querySelector('#ar-earnings').addEventListener('click', () => openDriverEarningsSheet(root, { ride }));
    sheet.querySelector('#ar-back-feed').addEventListener('click', () => go('/feed'));
    sheet.querySelector('#ar-open-chat').addEventListener('click', () => go(`/chat?tripId=${encodeURIComponent(ride.tripId)}`));
  }

  function renderCanceledStub() {
    const title = ride.status === RIDE_STATUS.NO_SHOW ? 'Пассажир не приехал' : 'Заказ отменён';
    const body = ride.status === RIDE_STATUS.NO_SHOW ? 'Поездка отмечена как no-show. Реальный штраф и поддержка вне этого PR.' : 'Заказ отменён водителем. Причина хранится только в UI этого PR.';
    sheet.innerHTML = `<div class="active-ride__sheet-head"><div class="active-ride__sheet-title">${escapeHtml(title)}</div></div><div class="active-ride__stub">${escapeHtml(body)}</div><div class="active-ride__actions active-ride__actions--stack"><button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-back-feed">Вернуться в ленту</button></div>`;
    sheet.querySelector('#ar-back-feed').addEventListener('click', () => go('/feed'));
  }

  function renderGenericStub() {
    sheet.innerHTML = '<div class="active-ride__sheet-head"><div class="active-ride__sheet-title">Поездка</div></div><div class="active-ride__stub">Этот этап поездки будет реализован позже</div>';
  }

  renderSheet();
  return root;
}
