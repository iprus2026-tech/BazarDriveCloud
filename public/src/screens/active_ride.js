// BD-RIDE-D-02 / D-07 / D-08 / D-09 — Driver active ride flow.
// Mock/UI only. No Mapbox SDK, no token, no backend, no geolocation,
// no real calls, no payments, no push, no packages.

import { escapeHtml } from '../util.js';
import { go } from '../router.js';
import { user } from '../state.js';
import {
  updateActiveRideStatus,
  createDemoActiveRide,
  SIM_AUDIT_RIDE_OVERRIDES,
  RIDE_STATUS,
  DEMO_ACTIVE_RIDE_ID,
} from '../ride_state.js';
import { loadCanonicalActiveRide } from './trip_confirmation_handoff.js';
import {
  loadDriverHandoffSnapshot,
  applyDriverHandoffSnapshotToRide,
} from './driver_handoff_snapshot.js';
import { createMapShell } from '../mapbox/map_shell.js';
import activeRidePassenger from './active_ride_passenger.js';
import {
  saveRideHistoryEntry,
  buildDriverHistoryEntry,
} from '../ride_history.js';

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

// BD-RIDE-D-07 — Driver cancel reasons. The internal codes are fixed by the
// issue #265 contract; the second/third columns are Russian UI copy. Mock
// only — selecting a reason never extends or mutates the ride_state schema.
const CANCEL_REASONS = [
  ['passenger_no_show', 'Пассажир не вышел', 'Пассажир не появился у точки подачи'],
  ['wrong_pickup', 'Неверная точка подачи', 'Адрес подачи указан неправильно'],
  ['car_problem', 'Проблема с автомобилем', 'Нужно остановить заказ до подачи'],
  ['unsafe_situation', 'Небезопасная ситуация', 'Чувствую угрозу безопасности'],
  ['cannot_reach_passenger', 'Не могу связаться с пассажиром', 'Звонил и писал — ответа нет'],
  ['other', 'Другое', 'Причина mock-only, без расширения ride_state.js'],
];

// BD-RIDE-D-08 — Driver problem actions are pure UI placeholders. None of
// them changes ride status; each only surfaces local/toast feedback.
const PROBLEM_ACTIONS = [
  ['passenger_no_show', 'Пассажир не выходит', 'Сообщим пассажиру, что вы ждёте'],
  ['cannot_reach', 'Не могу дозвониться', 'Отметим, что связи с пассажиром нет'],
  ['wrong_pickup', 'Неверная точка подачи', 'Передадим, что адрес подачи неверный'],
  ['car_problem', 'Проблема с авто', 'Зафиксируем проблему с автомобилем'],
  ['contact_support', 'Связаться с поддержкой', 'Откроем mock-обращение в поддержку'],
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
    // BD-RIDE-D-10 — In-memory override only. ?status= must not
    // permanently rewrite the stored canonical record; later user
    // actions (accept / cancel / etc.) persist via updateActiveRideStatus.
    return { ...ride, status: RIDE_STATUS.NEW_ORDER };
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

function renderCancelOptions(selected) {
  return CANCEL_REASONS.map(([value, label, meta]) => `
    <button type="button" class="driver-cancel-sheet__option${selected === value ? ' driver-cancel-sheet__option--selected' : ''}" role="radio" aria-checked="${selected === value ? 'true' : 'false'}" data-value="${escapeHtml(value)}">
      <span class="driver-cancel-sheet__radio" aria-hidden="true"></span>
      <span class="driver-cancel-sheet__option-copy"><span class="driver-cancel-sheet__option-label">${escapeHtml(label)}</span><span class="driver-cancel-sheet__option-meta">${escapeHtml(meta)}</span></span>
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

// BD-RIDE-D-07 / D-08 — Driver cancel & problem sheet shell. Mirrors the
// earnings sheet chrome behaviour (backdrop, focus trap, Esc) but uses the
// dedicated `active-ride-driver__*` namespace styled in cloud.css, so the
// older `driver-sheet__*` / driver_sheets.css remains exclusive to the
// untouched earnings sheet.
function createDriverActionSheet(root, config) {
  const previousFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = `active-ride-driver__sheet active-ride-driver__sheet--${config.kind}`;
  overlay.innerHTML = `
    <div class="active-ride-driver__backdrop" data-driver-sheet-close="true"></div>
    <section class="active-ride-driver__panel" role="dialog" aria-modal="true" aria-labelledby="${escapeHtml(config.titleId)}" tabindex="-1">
      <div class="active-ride-driver__handle" aria-hidden="true"></div>
      <div class="active-ride-driver__head"><div><div class="active-ride-driver__eyebrow">${escapeHtml(config.eyebrow)}</div><h2 class="active-ride-driver__title" id="${escapeHtml(config.titleId)}">${escapeHtml(config.title)}</h2></div><button type="button" class="active-ride-driver__close" aria-label="Закрыть" data-driver-sheet-close="true">×</button></div>
      <div class="active-ride-driver__body">${config.bodyHtml}</div>
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

function bindCancelOptions(overlay, selected, onChange) {
  let current = selected || '';
  const buttons = Array.from(overlay.querySelectorAll('.driver-cancel-sheet__option'));
  function sync() {
    buttons.forEach((btn) => {
      const checked = btn.dataset.value === current;
      btn.classList.toggle('driver-cancel-sheet__option--selected', checked);
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

// BD-RIDE-D-07 — Driver cancel sheet. Two-step confirm. `onConfirm` receives
// the selected reason code; the caller decides the resulting status so the
// shared sheet never hard-codes a ride_state transition. `outcomeLabel` is
// display-only copy ("CANCELED" / "NO_SHOW") for the confirmation strip.
// BD-RIDE-D-07 — Driver cancel sheet. Two-step confirm. `onConfirm` receives
// the selected reason code; the caller decides the resulting status so the
// shared sheet never hard-codes a ride_state transition. `outcomeLabel` is
// display-only copy and may be a static string or a function of the selected
// reason — so the confirmation strip stays accurate when the reason changes
// (e.g. the "не приехал" entry: passenger_no_show → NO_SHOW, else CANCELED).
function openDriverCancelSheet(root, { reason = '', outcomeLabel = 'CANCELED', onConfirm }) {
  const resolveOutcome = typeof outcomeLabel === 'function' ? outcomeLabel : () => outcomeLabel;
  let selected = CANCEL_REASONS.some(([value]) => value === reason) ? reason : '';
  let confirmPending = false;
  const sheet = createDriverActionSheet(root, {
    kind: 'cancel',
    titleId: 'driver-cancel-title',
    eyebrow: 'BD-RIDE-D-07',
    title: 'Отменить поездку?',
    bodyHtml: `
      <p class="driver-cancel-sheet__lead">Выберите причину. Она остаётся mock-only и не меняет схему ride_state.js.</p>
      <div class="driver-cancel-sheet__options" role="radiogroup" aria-label="Причина отмены">${renderCancelOptions(selected)}</div>
      <div class="driver-cancel-sheet__confirm" id="driver-cancel-confirm" hidden><strong>Подтверждение</strong><span id="driver-cancel-confirm-text"></span></div>
      <div class="active-ride-driver__actions"><button type="button" class="bd-btn primary active-ride-driver__primary" id="driver-cancel-primary" disabled>Подтвердить отмену</button><button type="button" class="bd-btn ghost active-ride-driver__secondary" data-driver-sheet-close="true">Назад к поездке</button></div>
    `,
  });
  const primary = sheet.overlay.querySelector('#driver-cancel-primary');
  const confirmBox = sheet.overlay.querySelector('#driver-cancel-confirm');
  const confirmText = sheet.overlay.querySelector('#driver-cancel-confirm-text');
  function syncConfirmText() {
    confirmText.textContent = `Следующее нажатие переведёт поездку в ${resolveOutcome(selected)}.`;
  }
  bindCancelOptions(sheet.overlay, selected, (next) => {
    selected = next;
    confirmPending = false;
    confirmBox.hidden = true;
    primary.textContent = 'Подтвердить отмену';
    primary.disabled = !selected;
    syncConfirmText();
  });
  primary.addEventListener('click', () => {
    if (!selected) return;
    if (!confirmPending) {
      confirmPending = true;
      syncConfirmText();
      confirmBox.hidden = false;
      primary.textContent = 'Да, отменить';
      return;
    }
    sheet.close();
    onConfirm(selected);
  });
}

function problemActionNotice(code) {
  switch (code) {
    case 'passenger_no_show': return 'Сигнал «пассажир не выходит» отправлен (mock)';
    case 'cannot_reach': return 'Отметка «не могу дозвониться» сохранена (mock)';
    case 'wrong_pickup': return 'Жалоба на точку подачи отправлена (mock)';
    case 'car_problem': return 'Проблема с авто зафиксирована (mock)';
    case 'contact_support': return 'Mock-обращение в поддержку открыто';
    default: return 'Проблема отправлена в mock-поддержку';
  }
}

// BD-RIDE-D-08 — Driver problem sheet. Every action is a pure UI placeholder:
// it surfaces inline + toast feedback (`onAction`) and never changes ride
// status. The no-show transition lives in the cancel sheet (passenger_no_show
// reason), not here.
function openDriverProblemSheet(root, { onAction } = {}) {
  const actionsHtml = PROBLEM_ACTIONS.map(([value, label, meta]) => `
    <button type="button" class="driver-problem-sheet__action" data-value="${escapeHtml(value)}">
      <span class="driver-problem-sheet__action-label">${escapeHtml(label)}</span>
      <span class="driver-problem-sheet__action-meta">${escapeHtml(meta)}</span>
    </button>
  `).join('');
  const sheet = createDriverActionSheet(root, {
    kind: 'problem',
    titleId: 'driver-problem-title',
    eyebrow: 'BD-RIDE-D-08',
    title: 'Что случилось?',
    bodyHtml: `
      <p class="driver-problem-sheet__lead">Все действия — безопасные заглушки. Они не меняют статус поездки.</p>
      <div class="driver-problem-sheet__actions" role="group" aria-label="Действия при проблеме">${actionsHtml}</div>
      <div class="driver-problem-confirm__box" id="driver-problem-confirm" role="status" aria-live="polite" hidden><span class="driver-problem-confirm__title">Заглушка отправлена</span><span class="driver-problem-confirm__text" id="driver-problem-confirm-text"></span></div>
      <div class="active-ride-driver__actions"><button type="button" class="bd-btn ghost active-ride-driver__secondary" data-driver-sheet-close="true">Закрыть</button></div>
    `,
  });
  const confirmBox = sheet.overlay.querySelector('#driver-problem-confirm');
  const confirmText = sheet.overlay.querySelector('#driver-problem-confirm-text');
  sheet.overlay.querySelectorAll('.driver-problem-sheet__action').forEach((btn) => {
    btn.addEventListener('click', () => {
      const message = problemActionNotice(btn.dataset.value || '');
      confirmText.textContent = message;
      confirmBox.hidden = false;
      if (typeof onAction === 'function') onAction(message);
    });
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

  const rawTripId = query.get('tripId');
  const tripId = rawTripId || DEMO_ACTIVE_RIDE_ID;
  const statusQuery = query.get('status');
  // BD-RIDE-D-10 — Cross-role canonical lookup. Reads any persisted
  // active-ride record first, then tries to seed from a confirmed
  // handoff for either role so driver and passenger converge on one
  // canonical trip identity (passenger, driver, vehicle, route, fare).
  let ride = loadCanonicalActiveRide({ tripId, role: 'driver' });
  // BD-HANDOFF-05 — replace generic/demo strings with the driver-side
  // confirmed handoff snapshot (passenger name, pickup/dropoff labels,
  // agreed price, arrival ETA) when one was pinned right before the
  // /trip-confirmation → /active-ride?role=driver hop. A snapshot is
  // sufficient on its own to materialize the driver sheet: when no
  // ?status= is supplied we fall back to the snapshot's own status
  // (DRIVER_EN_ROUTE by default) instead of the empty placeholder.
  let effectiveStatusQuery = statusQuery;
  if (!ride) {
    const driverSnapshot = loadDriverHandoffSnapshot(tripId);
    const hasValidStatusQuery = statusQuery && DRIVER_SIMULATION_STATUSES.has(statusQuery);
    // BD-RIDE-D-10 — When an explicit tripId is in the URL, mirror the
    // passenger fallback and materialize the same non-persisted demo
    // record so both roles agree on the trip identity. The
    // "no active order" empty placeholder is reserved for the default
    // /active-ride?role=driver URL (no tripId in query).
    const hasExplicitTripId = Boolean(rawTripId);
    if (!hasValidStatusQuery && !driverSnapshot && !hasExplicitTripId) return renderDriverEmpty();
    const useSimOverrides = hasValidStatusQuery || Boolean(driverSnapshot);
    const overrides = useSimOverrides ? SIM_AUDIT_RIDE_OVERRIDES : {};
    ride = createDemoActiveRide({ tripId, ...overrides });
    if (driverSnapshot) {
      ride = applyDriverHandoffSnapshotToRide(ride, driverSnapshot);
      if (!hasValidStatusQuery && DRIVER_SIMULATION_STATUSES.has(driverSnapshot.status)) {
        effectiveStatusQuery = driverSnapshot.status;
      }
    }
  }
  ride = safeApplyStatusFromQuery(ride, effectiveStatusQuery);

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
    // No-show stays reachable via the cancel sheet (passenger_no_show reason),
    // keeping the NO_SHOW transition out of the now placeholder-only problem sheet.
    sheet.querySelector('#ar-no-show').addEventListener('click', () => openDriverCancelSheet(root, {
      reason: 'passenger_no_show',
      outcomeLabel: (code) => (code === 'passenger_no_show' ? 'NO_SHOW' : 'CANCELED'),
      onConfirm: (code) => {
        ride = updateActiveRideStatus(ride.tripId, code === 'passenger_no_show' ? RIDE_STATUS.NO_SHOW : RIDE_STATUS.CANCELED);
        renderSheet();
      },
    }));
    bindPassengerActions();
  }

  function renderInProgress() {
    const finishPrice = ride.ride?.price || '';
    sheet.innerHTML = `<div class="active-ride__sheet-head"><div class="active-ride__sheet-head-main"><div class="active-ride__sheet-title">Везёте пассажира</div><div class="active-ride__sheet-sub">${escapeHtml(ride.route?.dropoffLabel || '')}</div></div><div class="active-ride__pickup-eta active-ride__pickup-eta--progress"><div class="active-ride__pickup-eta-value">${escapeHtml(ride.route?.etaToDestination || '')}</div><div class="active-ride__pickup-eta-label">до места</div></div></div>${navCard()}${passengerRowHtml(ride.passenger || {})}<div class="active-ride__actions active-ride__actions--stack"><button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-finish">Завершить${finishPrice ? ` · ${escapeHtml(finishPrice)}` : ''}</button><div class="active-ride__secondary-actions"><button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-stop">+ Остановка</button><button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-issue">Проблема</button></div></div>`;
    sheet.querySelector('#ar-nav-btn').addEventListener('click', () => showNotice('Навигатор будет доступен после Mapbox integration'));
    sheet.querySelector('#ar-finish').addEventListener('click', () => { ride = updateActiveRideStatus(ride.tripId, RIDE_STATUS.COMPLETED); renderSheet(); });
    sheet.querySelector('#ar-stop').addEventListener('click', () => showNotice('Добавление остановки будет доступно позже'));
    sheet.querySelector('#ar-issue').addEventListener('click', () => openDriverProblemSheet(root, { onAction: showNotice }));
    bindPassengerActions();
  }

  function renderCompleted() {
    const e = calcEarnings(ride);
    const dropoffLabel = ride.route?.dropoffLabel || '';
    const pickupLabel = ride.route?.pickupLabel || '';
    const passenger = ride.passenger || {};
    const passengerCardHtml = `<div class="active-ride__completion-passenger" role="group" aria-label="Пассажир"><div class="active-ride__avatar" aria-hidden="true">${escapeHtml(passenger.initials || 'АМ')}</div><div class="active-ride__passenger-info"><div class="active-ride__passenger-name">${escapeHtml(passenger.name || 'Пассажир')}${passenger.rating ? `<span class="active-ride__passenger-rating">★ ${escapeHtml(passenger.rating)}</span>` : ''}</div><div class="active-ride__passenger-meta">${escapeHtml(passenger.phoneMasked || '')}${passenger.luggage ? ` · ${escapeHtml(passenger.luggage)}` : ''}</div></div></div>`;
    const summaryHtml = `<div class="active-ride__completion-summary" role="list" aria-label="Сводка поездки">${pickupLabel ? `<div class="active-ride__completion-summary-row" role="listitem"><span class="active-ride__completion-summary-label">Откуда</span><span class="active-ride__completion-summary-value">${escapeHtml(pickupLabel)}</span></div>` : ''}${dropoffLabel ? `<div class="active-ride__completion-summary-row" role="listitem"><span class="active-ride__completion-summary-label">Куда</span><span class="active-ride__completion-summary-value">${escapeHtml(dropoffLabel)}</span></div>` : ''}<div class="active-ride__completion-summary-row" role="listitem"><span class="active-ride__completion-summary-label">Время</span><span class="active-ride__completion-summary-value">${escapeHtml(ride.ride?.duration || ride.order?.destinationEta || '—')}</span></div><div class="active-ride__completion-summary-row" role="listitem"><span class="active-ride__completion-summary-label">Расстояние</span><span class="active-ride__completion-summary-value">${escapeHtml(ride.ride?.distance || ride.order?.destinationDistance || '—')}</span></div></div>`;
    sheet.innerHTML = `<div class="active-ride__completion-card"><div class="active-ride__completion"><div class="active-ride__completion-badge" aria-hidden="true">✓</div><div class="active-ride__sheet-title">Поездка завершена</div>${dropoffLabel ? `<div class="active-ride__completion-route">${escapeHtml(dropoffLabel)}</div>` : ''}</div>${passengerCardHtml}${summaryHtml}<div class="active-ride__earnings-total"><div class="active-ride__completion-price">${escapeHtml(formatRub(e.gross))}</div><div class="active-ride__completion-note">стоимость поездки</div></div><div class="active-ride__earnings-breakdown" role="list"><div class="active-ride__earnings-row" role="listitem"><span class="active-ride__earnings-row-label">Комиссия сервиса</span><span class="active-ride__earnings-row-value">${escapeHtml(e.commissionLabel)}</span></div><div class="active-ride__earnings-row" role="listitem"><span class="active-ride__earnings-row-label">К удержанию</span><span class="active-ride__earnings-row-value">${escapeHtml(formatRub(e.commissionAmount))}</span></div><div class="active-ride__earnings-row active-ride__earnings-row--net" role="listitem"><span class="active-ride__earnings-row-label">Ваш доход</span><span class="active-ride__earnings-row-value">${escapeHtml(formatRub(e.net))}</span></div></div><div class="active-ride__shift-summary"><div class="active-ride__shift-summary-title">Смена сегодня</div><div class="active-ride__shift-delta"><span class="active-ride__shift-delta-prev">${escapeHtml(formatRub(e.previousToday))}</span><span class="active-ride__shift-delta-arrow" aria-hidden="true">→</span><span class="active-ride__shift-delta-next">${escapeHtml(formatRub(e.nextToday))}</span></div><div class="active-ride__shift-delta active-ride__shift-delta--trips"><span class="active-ride__shift-delta-prev">${escapeHtml(String(e.previousTrips))} поездок</span><span class="active-ride__shift-delta-arrow" aria-hidden="true">→</span><span class="active-ride__shift-delta-next">${escapeHtml(String(e.nextTrips))} поездок</span></div></div><div class="active-ride__completion-history" role="status" aria-live="polite" data-history-saved="false">Поездка сохранена в историю</div></div><div class="active-ride__completion-actions"><div class="active-ride__secondary-actions"><button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-earnings-main">Доходы</button><button type="button" class="bd-btn primary active-ride__btn-sec" id="ar-back-feed">На линию</button></div><button type="button" class="bd-btn ghost active-ride__btn-primary" id="ar-next-order">Следующий заказ</button><div class="active-ride__secondary-actions"><button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-earnings">Подробнее о доходе</button><button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-open-chat">Открыть чат</button></div></div>`;
    const entry = buildDriverHistoryEntry(ride, {
      earnings: {
        gross: e.gross,
        commissionAmount: e.commissionAmount,
        net: e.net,
        commissionLabel: e.commissionLabel,
      },
    });
    const savedEntry = entry ? saveRideHistoryEntry(entry) : null;
    if (savedEntry) {
      const badge = sheet.querySelector('.active-ride__completion-history');
      if (badge) badge.dataset.historySaved = 'true';
    }
    sheet.querySelector('#ar-next-order').addEventListener('click', () => showNotice('Следующий заказ будет добавлен позже'));
    sheet.querySelector('#ar-earnings').addEventListener('click', () => openDriverEarningsSheet(root, { ride }));
    sheet.querySelector('#ar-earnings-main').addEventListener('click', () => go('/profile'));
    sheet.querySelector('#ar-back-feed').addEventListener('click', () => go('/feed'));
    sheet.querySelector('#ar-open-chat').addEventListener('click', () => go(`/chat?tripId=${encodeURIComponent(ride.tripId)}`));
  }

  function renderCanceledStub() {
    const cancel = ride.cancel || {};
    const byPassenger = cancel.by === 'passenger';
    const passengerName = (ride.passenger && ride.passenger.name) || 'Пассажир';
    let title;
    let body;
    if (ride.status === RIDE_STATUS.NO_SHOW) {
      title = 'Пассажир не приехал';
      body = 'Поездка отмечена как no-show. Реальный штраф и поддержка вне этого PR.';
    } else if (byPassenger) {
      title = 'Пассажир отменил заказ';
      body = `${passengerName} отменил поездку после принятия заказа.`;
    } else {
      title = 'Заказ отменён';
      body = 'Заказ отменён водителем. Причина хранится только в UI этого PR.';
    }
    sheet.innerHTML = `<div class="active-ride__sheet-head"><div class="active-ride__sheet-title">${escapeHtml(title)}</div></div><div class="active-ride__stub">${escapeHtml(body)}</div><div class="active-ride__actions active-ride__actions--stack"><button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-back-feed">Вернуться в ленту</button></div>`;
    sheet.querySelector('#ar-back-feed').addEventListener('click', () => go('/feed'));
  }

  function renderGenericStub() {
    sheet.innerHTML = '<div class="active-ride__sheet-head"><div class="active-ride__sheet-title">Поездка</div></div><div class="active-ride__stub">Этот этап поездки будет реализован позже</div>';
  }

  renderSheet();
  return root;
}
