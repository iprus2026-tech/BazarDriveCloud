import {
  user,
  setDocumentStatus,
  documentsAttentionCount,
  documentsReviewCount,
  REQUIRED_DOCS,
  canShowReadyStatus,
  isDriverLineReady,
  appendGarageVehicle,
  patchGarageVehicle,
  archiveGarageVehicle,
} from '../state.js';
import { go } from '../router.js';
import { escapeHtml } from '../util.js';
import { listMyPostsSync, listDriverReceipts } from '../mock_api.js';
import { isDriverMode } from '../ride_actions.js';
import { getSmokeRole, setSmokeRole, applySmokeRole } from '../smoke_role.js';
import { readRideHistoryStatus, clearRideHistory } from '../ride_history.js';
import { buildRepeatRouteDraft, writeRepeatRouteDraft } from '../repeat_route.js';
import { performLocalLogout } from '../mock_auth.js';
import {
  buildGarageVehicles,
  resolveActiveGarageVehicleId,
  countArchivedGarageVehicles,
} from '../garage.js';

// ── SVG constants ─────────────────────────────────────────────────────────────

const SVG_GEAR = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

const SVG_STAR = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;

const SVG_PENCIL = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;

const SVG_CHECK = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

const SVG_CHEVRON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`;

const SVG_PERSON_LG = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.582-7 8-7s8 3 8 7"/></svg>`;

const SVG_BELL = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 6 3 7 3 7H3s3-1 3-7"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>`;

const SVG_WARN_TRI = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10.29 3.86-8.23 14.27A1 1 0 0 0 2.93 19.7h16.46a1 1 0 0 0 .87-1.57L12.71 3.86a1.34 1.34 0 0 0-2.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

const SVG_CAR_FRONT = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/><path d="M5 17h14"/><path d="M3 9 5 5h14l2 4"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="17.5" r="2.5"/></svg>`;

const SVG_TAG_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;

const SVG_CLOCK_SM = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

const SVG_CHECK_SM = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

const SVG_DOC_LG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

const SVG_UPLOAD_SM = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;

const SVG_PLUS = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;

const SVG_CREDIT_CARD_PO = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`;

const SVG_RUBLE_COIN = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9 7h4.5a2.5 2.5 0 0 1 0 5H9v5M8.5 14h5"/></svg>`;

const SVG_CALENDAR_PO = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function createIntentRoute(u) {
  return isDriverMode(u) ? '/new?type=driver_offer' : '/new?type=passenger_request';
}

function initials(u) {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.displayName || '';
  if (!name.trim()) return '?';
  return name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function displayName(u) {
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.displayName || 'Пользователь';
}

function fmtRub(n) {
  return new Intl.NumberFormat('ru-RU').format(n) + ' ₽';
}

// Reads the query string off the current hash route. Mirrors the parser used
// by active_ride.js / map.js so the render-gate preview URLs
// (/profile?role=passenger&state=empty) resolve the same way everywhere.
function getHashQuery() {
  const hash = (typeof window !== 'undefined' && window.location.hash) || '';
  const qi = hash.indexOf('?');
  return qi === -1 ? new URLSearchParams() : new URLSearchParams(hash.slice(qi + 1));
}

function checklistItems(u) {
  return [
    { id: 'phone',       label: 'Телефон подтверждён', done: !!u.phone },
    { id: 'vehicle',     label: 'Данные автомобиля',   done: !!(u.vehicleMake && u.vehicleModel) },
    { id: 'plate',       label: 'Госномер',            done: !!u.vehiclePlate },
    { id: 'docs',        label: 'Документы и ОСАГО',   done: !!u.documentsReady },
    { id: 'taxi-permit', label: 'Разрешение такси',    done: !!u.taxiPermit, action: 'open-permit' },
  ];
}

// canShowReadyStatus + isDriverLineReady are imported from state.js — the
// single line-readiness rule shared by Overview, Taxi/IP cards and the
// DriverMap readiness gate (BD-DRIVER-02), so the surfaces cannot drift.

function getDriverStatusState(u) {
  return (isDriverLineReady(u) && u.driverOnline) ? 'ready' : 'action';
}

function getDriverStatusTitle(u) {
  return getDriverStatusState(u) === 'ready' ? 'Готов принимать заказы' : 'Нужно действие';
}

function getDriverStatusSubtitle(u) {
  if (!canShowReadyStatus(u)) return 'Заполните телефон, автомобиль и госномер';
  if (!u.documentsReady) return 'Загрузите документы перед выходом на линию';
  if (!u.medicalCheckPassed && !u.waybillOpen) return 'Загрузите медосмотр и откройте путевой лист';
  if (!u.medicalCheckPassed) return 'Загрузите медосмотр перед выходом на линию';
  if (!u.waybillOpen) return 'Откройте путевой лист перед выходом на линию';
  return 'Все требования выполнены';
}

// ── BD-PROFILE-TAXI-01 readiness state model ─────────────────────────────────
// Strict 4-state readiness model used by the Taxi / IP pane:
//   blocked → waybill not open OR medical not passed (hard blockers)
//   warning → blockers cleared but taxi permit expires soon
//   ready   → all checks pass, driver not yet on line
//   online  → ready AND driverOnline = true
//
// Mock state quick-reference (for manual testing):
//   blocked → default state (u.waybillOpen=false, u.medicalCheckPassed=false)
//   ready   → user.set({ waybillOpen:true, medicalCheckPassed:true })
//             (also requires documents uploaded — see Documents tab)
//   online  → ready state + flip the toggle in Taxi/ИП card
//   warning → ready state + adjust TAXI_PERMIT_EXPIRY_DAYS below to ≤ 60

const TAXI_PERMIT_EXPIRY_DAYS = 47;        // mock: days until permit expiry
const TAXI_PERMIT_WARNING_THRESHOLD = 60;  // <= N days → warning state

function isPermitExpiringSoon() {
  return TAXI_PERMIT_EXPIRY_DAYS > 0
      && TAXI_PERMIT_EXPIRY_DAYS <= TAXI_PERMIT_WARNING_THRESHOLD;
}

// Structured readiness reasons. Each item has severity = 'blocker' | 'warning'
// | 'ok' and an optional action id used by the click handler.
function getTaxiReadinessReasons(u) {
  return [
    {
      id: 'waybill',
      label: 'Путевой лист',
      text: u.waybillOpen ? 'Открыт' : 'Не открыт',
      severity: u.waybillOpen ? 'ok' : 'blocker',
      action: u.waybillOpen ? null : 'waybill',
    },
    {
      id: 'medical',
      label: 'Медосмотр',
      text: u.medicalCheckPassed ? 'Пройден' : 'Не пройден',
      severity: u.medicalCheckPassed ? 'ok' : 'blocker',
      action: u.medicalCheckPassed ? null : 'medical',
    },
    {
      id: 'selfemployed',
      label: 'Самозанятый',
      text: 'Активен',
      severity: 'ok',
      action: null,
    },
    {
      id: 'permit',
      label: 'Разрешение такси',
      text: isPermitExpiringSoon()
        ? `Истекает через ${TAXI_PERMIT_EXPIRY_DAYS} дней`
        : 'Действует',
      severity: isPermitExpiringSoon() ? 'warning' : 'ok',
      action: isPermitExpiringSoon() ? 'permit' : null,
    },
  ];
}

function getTaxiReadinessState(u) {
  const reasons = getTaxiReadinessReasons(u);
  if (reasons.some((r) => r.severity === 'blocker')) return 'blocked';
  if (u.driverOnline) return 'online';
  if (reasons.some((r) => r.severity === 'warning')) return 'warning';
  return 'ready';
}

function getTaxiStatusTitle(state) {
  if (state === 'blocked') return 'Нужно действие';
  if (state === 'warning') return 'Готов с оговоркой';
  if (state === 'online')  return 'На линии';
  return 'Готов выйти на линию';
}

function getTaxiStatusSub(u, state) {
  if (state === 'blocked') {
    if (!u.medicalCheckPassed && !u.waybillOpen) return 'Загрузите медосмотр и откройте путевой лист';
    if (!u.medicalCheckPassed) return 'Загрузите медосмотр перед выходом на линию';
    if (!u.waybillOpen)        return 'Откройте путевой лист перед выходом на линию';
    return 'Завершите подготовку';
  }
  if (state === 'warning') return `Разрешение такси истекает через ${TAXI_PERMIT_EXPIRY_DAYS} дней`;
  if (state === 'online')  return 'Принимаете заказы';
  return 'Все обязательные проверки пройдены';
}

// Syncs both status cards and toggles to the new online value.
function syncDriverStatusDom(root, u, online) {
  const patched = { ...u, driverOnline: online };

  const ovCard  = root.querySelector('#pf2-status-card');
  const ovTitle = root.querySelector('#pf2-status-title');
  const ovSub   = root.querySelector('#pf2-status-sub');
  const ovTog   = root.querySelector('#pf2-online-toggle');
  if (ovCard && ovTitle && ovSub) {
    ovCard.dataset.state = getDriverStatusState(patched);
    ovTitle.textContent  = getDriverStatusTitle(patched);
    ovSub.textContent    = getDriverStatusSubtitle(patched);
  }
  if (ovTog) ovTog.checked = online;

  // Active-shift CTA disabled state tracks isDriverLineReady — so document
  // status changes (which flip documentsReady) also propagate here.
  const cta = root.querySelector('#pf2-active-shift-cta');
  if (cta) cta.disabled = !isDriverLineReady(patched);

  // IP card has its own 4-state readiness model. Re-render the whole pane so
  // the checklist rows, status card data-state and CTAs stay consistent
  // (toggle visual, "Выйти на линию" disabled, action CTA visibility).
  refreshIpPane(root);
}

// Re-render the Taxi/IP pane in place, preserving the delegated click handler
// bound to the pane element (see renderDriver below).
function refreshIpPane(root) {
  const pane = root.querySelector('#pf2-pane-ip');
  if (pane) pane.innerHTML = ipPaneHtml(user.get());
}

// ── Guest view ────────────────────────────────────────────────────────────────

function renderGuest(root) {
  root.innerHTML = `
    <div class="bd-topbar">
      <div class="bd-topbar__titles">
        <h1 class="bd-topbar__title">Профиль</h1>
      </div>
    </div>
    <div class="bd-scroll">
      <div class="bd-card pf-guest-card">
        <div class="pf-guest-icon" aria-hidden="true">${SVG_PERSON_LG}</div>
        <h2 class="pf-guest-title">Создайте профиль</h2>
        <p class="pf-guest-text">
          Листать ленту и читать правила можно без аккаунта.
          Публикуйте поездки и объявления после регистрации.
        </p>
        <button type="button" class="bd-btn primary" id="pf-onboard">Начать регистрацию</button>
      </div>
    </div>
  `;
  root.querySelector('#pf-onboard').addEventListener('click', () => go('/onboarding'));
}

// ── Passenger view (BD-PROFILE-PASSENGER-01 — V2) ─────────────────────────────

const SVG_PIN = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-7-7-12a7 7 0 0 1 14 0c0 5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>`;

const SVG_HEART = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;

const SVG_CARD = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2.5"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`;

const SVG_SHIELD = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;

const SVG_PHONE = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;

const SVG_PAPERPLANE = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;

const SVG_INFO = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;

const SVG_LOGOUT = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;

const SVG_HEART_FILL = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;

const SVG_TAG_PROMO = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;

const SVG_CHAT_BUBBLE = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`;

const SVG_PHONE_LG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;

// ── Passenger mock data ───────────────────────────────────────────────────────
// Stats shown in the ready-state stats grid. Trip count comes from user state.
const MOCK_PROFILE_STATS = {
  savingsRub: 6240,
  co2Kg: 52,
};

// Statuses that mark a trip as in-flight on the profile screen.
// When MOCK_ACTIVE_TRIP.status matches one of these, the "Активная поездка"
// card is rendered; otherwise the planned-trip card takes its place.
const ACTIVE_TRIP_STATUSES = ['ACCEPTED', 'ARRIVING', 'ONTRIP'];

// Active trip card (BD-PROFILE-PASSENGER-ACTIVE-TRIP). Visual prototype only.
// Default status is null so the planned-trip card shows in the current demo
// state. Flip status to 'ACCEPTED', 'ARRIVING' or 'ONTRIP' to preview the
// active-trip card locally.
const MOCK_ACTIVE_TRIP = {
  status: null,
  etaMin: 4,
  fromAddress: 'ул. Тверская, 12',
  toAddress: 'Аэропорт Внуково',
  driver: {
    initials: 'РК',
    name: 'Рустам К.',
    vehicleMake: 'Hyundai',
    vehicleModel: 'Solaris',
    vehicleColor: 'белый',
    plate: 'A 482 MP 77',
  },
};

// Planned trip card (BD-PROFILE-01). Visual prototype only — no backend.
const MOCK_PLANNED_TRIP = {
  fromAddress: 'Дом',
  toAddress: 'Аэропорт Внуково',
  when: 'Завтра · 07:00',
};

function isTripActive(trip) {
  return !!(trip && ACTIVE_TRIP_STATUSES.includes(trip.status));
}

// BD-PROFILE-01 follow-up: dev/demo state switch for the trip section.
// Set localStorage.profileTripDemo to 'active' | 'planned' | 'empty' to
// preview each of the three states without touching the production mocks.
// Any other value (or missing key) falls through to the default mocks,
// preserving the current planned-trip default.
//
// Quick reference (paste into the browser console):
//   localStorage.setItem('profileTripDemo', 'active');   // Активная поездка
//   localStorage.setItem('profileTripDemo', 'planned');  // Запланированная поездка
//   localStorage.setItem('profileTripDemo', 'empty');    // CTA "Запланировать поездку"
//   localStorage.removeItem('profileTripDemo');          // restore default
function getTripDemoMode() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const v = localStorage.getItem('profileTripDemo');
    return (v === 'active' || v === 'planned' || v === 'empty') ? v : null;
  } catch {
    return null;
  }
}

function resolveTripsForDemo(activeTrip, plannedTrip, forcedMode) {
  const mode = forcedMode || getTripDemoMode();
  if (mode === 'active') {
    const status = isTripActive(activeTrip) ? activeTrip.status : 'ONTRIP';
    return { active: { ...activeTrip, status }, planned: plannedTrip };
  }
  if (mode === 'planned') {
    return { active: { ...activeTrip, status: null }, planned: plannedTrip };
  }
  if (mode === 'empty') {
    return { active: null, planned: null };
  }
  return { active: activeTrip, planned: plannedTrip };
}

// Mock masked phone string used by the phone-verify banner. Mirrors the
// Cloud Design reference ("+7 (905) ••• 12-34") when the user has no real
// phone on file. Accepts the two storage shapes used elsewhere in the app
// (see onboarding.js#formatPhoneDisplay): 10 digits without the leading
// country code (the +7 chip is rendered outside the input) or 11 digits
// with it. Both are normalised to an 11-digit RU form before masking, so
// the middle three digits get hidden while the country code, area code
// and last four digits stay visible.
function maskedPhone(u) {
  let raw = String(u.phone || '').replace(/\D/g, '');
  if (raw.length === 10) raw = '7' + raw;
  if (raw.length !== 11) return '+7 (905) ••• 12-34';
  const cc   = raw.slice(0, 1);
  const area = raw.slice(1, 4);
  const mid  = raw.slice(7, 9);
  const last = raw.slice(9, 11);
  return `+${cc} (${area}) ••• ${mid}-${last}`;
}

function passengerHandle(u) {
  const raw = String(u.firstName || u.displayName || '').trim().toLowerCase().split(/\s+/)[0];
  const first = raw.replace(/[^a-zа-яё0-9]+/gi, '');
  const last = String(u.lastName || '').trim().toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '').slice(0, 1);
  if (!first) return 'guest';
  return last ? `${first}_${last}` : first;
}

function passengerDisplayName(u) {
  const first = (u.firstName || '').trim();
  const last  = (u.lastName  || '').trim();
  if (first && last) return `${first} ${last[0].toUpperCase()}.`;
  if (first) return first;
  if (u.displayName) return u.displayName;
  return 'Пассажир';
}

function isPassengerReady(u) {
  return u.profileStatus === 'ready';
}

// BD-PROFILE-PASSENGER-01 — render-gate preview overlay. Maps the ?state=
// query param to a NON-PERSISTED user overlay so the documented preview URLs
// render the matching gate without mutating localStorage or the stored role.
// Returns the user untouched for an unknown / missing state. The "ready"
// family seeds sensible mock figures only when the real account has none, so
// the preview looks complete without clobbering a genuinely populated profile.
function applyPassengerStatePreview(u, state) {
  if (!state) return u;
  if (state === 'needs_phone') {
    return { ...u, phoneVerified: false };
  }
  if (state === 'empty') {
    return { ...u, profileStatus: 'incomplete', phoneVerified: true, savedAddressCount: 0 };
  }
  if (state === 'ready' || state === 'active_trip' || state === 'notifications_on') {
    const seeded = {
      ...u,
      profileStatus: 'ready',
      phoneVerified: true,
      tripCount: u.tripCount || 38,
      savedAddressCount: u.savedAddressCount || 3,
      paymentLast4: u.paymentLast4 || '4821',
      promoCount: u.promoCount || 2,
      trustedContactsCount: u.trustedContactsCount || 2,
    };
    if (state === 'notifications_on') seeded.notificationsEnabled = true;
    return seeded;
  }
  return u;
}

// BD-PROFILE-PASSENGER-01 — drafts entry. The project persists in-progress
// composer drafts under this key (see screens/composer.js DRAFT_KEY). There
// is no dedicated "drafts list" route, so the menu row links to the composer
// (which restores the draft) when one exists and renders a safe disabled row
// otherwise — it never dead-ends the navigation.
const COMPOSER_DRAFT_KEY = 'bazardrive.draft.v2';

function hasComposerDraft() {
  try {
    if (typeof localStorage === 'undefined') return false;
    const raw = localStorage.getItem(COMPOSER_DRAFT_KEY);
    if (!raw) return false;
    const draft = JSON.parse(raw);
    return !!draft && typeof draft === 'object'
      && Object.values(draft).some((v) => typeof v === 'string' && v.trim() !== '');
  } catch {
    return false;
  }
}

function currentTripHtml(trip) {
  if (!isTripActive(trip)) return '';
  const drv  = trip.driver || {};
  const ini  = escapeHtml(drv.initials || '?');
  const name = escapeHtml(drv.name || 'Водитель');
  const car  = [
    drv.vehicleMake && drv.vehicleModel ? `${drv.vehicleMake} ${drv.vehicleModel}` : null,
    drv.vehicleColor || null,
    drv.plate || null,
  ].filter(Boolean).map(escapeHtml).join(' · ');
  const from = escapeHtml(trip.fromAddress || '');
  const to   = escapeHtml(trip.toAddress || '');
  const eta  = Number.isFinite(trip.etaMin) ? `${trip.etaMin} мин` : '';
  return `
      <!-- 7b. Current trip -->
      <p class="pfp-section-title">Активная поездка</p>
      <div class="bd-card pfp-trip-card">
        <div class="pfp-trip-head">
          <span class="pfp-trip-badge">
            <span class="pfp-trip-badge-dot" aria-hidden="true"></span>
            Активная поездка
          </span>
          ${eta ? `<span class="pfp-trip-eta">ETA ${escapeHtml(eta)}</span>` : ''}
        </div>
        <div class="pfp-trip-route">
          <div class="pfp-trip-rail" aria-hidden="true">
            <span class="pfp-trip-rail-from"></span>
            <span class="pfp-trip-rail-line"></span>
            <span class="pfp-trip-rail-to"></span>
          </div>
          <div class="pfp-trip-points">
            <div class="pfp-trip-point">
              <span class="pfp-trip-point-label">Откуда</span>
              <span class="pfp-trip-point-addr">${from}</span>
            </div>
            <div class="pfp-trip-point">
              <span class="pfp-trip-point-label">Куда</span>
              <span class="pfp-trip-point-addr">${to}</span>
            </div>
          </div>
        </div>
        <div class="pfp-trip-driver">
          <div class="pfp-trip-driver-avatar" aria-hidden="true">${ini}</div>
          <div class="pfp-trip-driver-info">
            <p class="pfp-trip-driver-name">${name}</p>
            ${car ? `<p class="pfp-trip-driver-car">${car}</p>` : ''}
          </div>
          <button type="button" class="pfp-trip-iconbtn" id="pfp-trip-call" aria-label="Позвонить водителю">${SVG_PHONE_LG}</button>
          <button type="button" class="pfp-trip-iconbtn" id="pfp-trip-chat" aria-label="Чат с водителем">${SVG_CHAT_BUBBLE}</button>
        </div>
        <button type="button" class="bd-btn primary pfp-cta pfp-trip-open" id="pfp-trip-open">Открыть поездку</button>
      </div>
  `;
}

// Trip section: active trip wins; if absent, fall back to the planned trip;
// if neither exists, surface a "Запланировать поездку" CTA card.
function tripSectionHtml(activeTrip, plannedTrip) {
  if (isTripActive(activeTrip)) return currentTripHtml(activeTrip);
  if (plannedTrip) return plannedTripHtml(plannedTrip);
  return `
      <!-- 7b. No trip — schedule CTA -->
      <p class="pfp-section-title">Поездки</p>
      <div class="bd-card pfp-plan-empty-card">
        <div class="pfp-plan-empty-icon" aria-hidden="true">${SVG_CALENDAR_PO}</div>
        <p class="pfp-plan-empty-title">Нет запланированных поездок</p>
        <p class="pfp-plan-empty-text">Запланируйте поездку заранее, чтобы выехать вовремя</p>
        <button type="button" class="bd-btn primary pfp-cta" id="pfp-plan-cta">Запланировать поездку</button>
      </div>
  `;
}

function plannedTripHtml(trip) {
  if (!trip) return '';
  const from = escapeHtml(trip.fromAddress || '');
  const to   = escapeHtml(trip.toAddress || '');
  const when = escapeHtml(trip.when || '');
  return `
      <!-- 7b. Planned trip -->
      <p class="pfp-section-title">Запланированная поездка</p>
      <div class="bd-card pfp-plan-card">
        <div class="pfp-plan-head">
          <span class="pfp-plan-badge">
            <span class="pfp-plan-badge-icon" aria-hidden="true">${SVG_CALENDAR_PO}</span>
            Запланировано
          </span>
          ${when ? `<span class="pfp-plan-time">${when}</span>` : ''}
        </div>
        <div class="pfp-trip-route">
          <div class="pfp-trip-rail" aria-hidden="true">
            <span class="pfp-trip-rail-from"></span>
            <span class="pfp-trip-rail-line"></span>
            <span class="pfp-trip-rail-to"></span>
          </div>
          <div class="pfp-trip-points">
            <div class="pfp-trip-point">
              <span class="pfp-trip-point-label">Откуда</span>
              <span class="pfp-trip-point-addr">${from}</span>
            </div>
            <div class="pfp-trip-point">
              <span class="pfp-trip-point-label">Куда</span>
              <span class="pfp-trip-point-addr">${to}</span>
            </div>
          </div>
        </div>
        <div class="pfp-plan-actions">
          <button type="button" class="bd-btn pfp-plan-btn" id="pfp-plan-edit">Изменить</button>
          <button type="button" class="bd-btn danger pfp-plan-btn" id="pfp-plan-cancel">Отменить</button>
        </div>
      </div>
  `;
}

function renderPassenger(root, u, previewState) {
  const ready  = isPassengerReady(u);
  const ini    = escapeHtml(initials(u));
  const name   = escapeHtml(passengerDisplayName(u));
  const handle = escapeHtml('@' + passengerHandle(u));
  const notif  = !!u.notificationsEnabled;

  const trips   = Number(u.tripCount) || 0;
  const addrs   = Number(u.savedAddressCount) || 0;
  const trusted = Number(u.trustedContactsCount) || 0;
  const promos  = Number(u.promoCount) || 0;
  const last4   = u.paymentLast4 ? String(u.paymentLast4) : null;
  const hasDrafts = hasComposerDraft();

  const phoneVerified = !!u.phoneVerified;
  const showPhoneVerify = !phoneVerified;
  const showOnboard = !ready && phoneVerified;
  const showFirstTrip = !ready && addrs === 0 && phoneVerified;
  // The "Готов к поездкам / Телефон подтверждён" card contradicts the
  // verify state, so suppress it whenever phoneVerified is false — the
  // ТРЕБУЕТСЯ ДЕЙСТВИЕ card takes its slot in that case.
  const showStatusCard = ready && phoneVerified;
  // Stats grid stays visible whenever the user is at the "ready" data
  // bar (38 поездок etc.) — the verify state is overlaid on top of an
  // otherwise complete passenger profile (see Cloud Design).
  const showStatsGrid = ready;

  const stateBadge = ready
    ? `<span class="pfp-meta-badge">★ 4.92 · ${trips} поездок</span>`
    : `<span class="pfp-meta-badge">Новый пассажир</span>`;

  const phoneMasked = escapeHtml(maskedPhone(u));

  root.innerHTML = `
    <div class="bd-topbar pfp-topbar">
      <div class="bd-topbar__titles">
        <h1 class="bd-topbar__title">Профиль</h1>
        <p class="bd-topbar__sub">Пассажир</p>
      </div>
      <div class="pfp-topbar-actions">
        <button type="button" class="bd-iconbtn" id="pfp-notif-btn" aria-label="Уведомления">${SVG_BELL}</button>
        <button type="button" class="bd-iconbtn" id="pfp-settings-btn" aria-label="Настройки">${SVG_GEAR}</button>
      </div>
    </div>

    <div class="bd-scroll pfp-scroll">

      ${showPhoneVerify ? `
      <!-- 1b. Phone verify banner -->
      <div class="bd-card pfp-verify-banner" role="status">
        <span class="pfp-verify-banner-icon" aria-hidden="true">${SVG_PHONE_LG}</span>
        <span class="pfp-verify-banner-text">
          <span class="pfp-verify-banner-title">Подтвердите номер телефона</span>
          <span class="pfp-verify-banner-sub">${phoneMasked} · отправим SMS-код</span>
        </span>
        <button type="button" class="bd-btn primary pfp-verify-banner-btn" id="pfp-verify-getcode">Получить код</button>
      </div>` : ''}

      <!-- 2. Identity card -->
      <div class="bd-card pfp-identity-card">
        <div class="pfp-identity-row">
          <div class="pfp-avatar" aria-hidden="true">${ini}</div>
          <div class="pfp-identity-info">
            <p class="pfp-identity-name">
              <span class="pfp-identity-name__text">${name}</span>
              ${phoneVerified ? `<span class="pfp-verify-badge" aria-label="Подтверждённый аккаунт">${SVG_CHECK}</span>` : ''}
            </p>
            <p class="pfp-identity-handle">${handle}</p>
            ${stateBadge}
          </div>
          <button type="button" class="pfp-edit-btn" id="pfp-edit-btn" aria-label="Редактировать профиль">${SVG_PENCIL}</button>
        </div>
      </div>

      ${showPhoneVerify ? `
      <!-- 2b. Action-required card (phone not verified) -->
      <div class="bd-card pfp-verify-action-card">
        <span class="pfp-verify-action-eyebrow">
          <span class="pfp-verify-action-dot" aria-hidden="true"></span>
          ТРЕБУЕТСЯ ДЕЙСТВИЕ
        </span>
        <p class="pfp-verify-action-title">Подтвердите телефон</p>
        <p class="pfp-verify-action-text">Без подтверждения вы не сможете заказать поездку</p>
        <button type="button" class="bd-btn primary pfp-cta pfp-verify-action-btn" id="pfp-verify-confirm">Подтвердить телефон</button>
      </div>` : ''}

      ${showOnboard ? `
      <!-- 3. Onboarding card -->
      <div class="bd-card pfp-onboard-card">
        <span class="pfp-onboard-eyebrow">
          <span class="pfp-onboard-dot" aria-hidden="true"></span>
          ДОБРО ПОЖАЛОВАТЬ
        </span>
        <p class="pfp-onboard-title">Завершите профиль</p>
        <p class="pfp-onboard-text">Добавьте имя, фото и привяжите способ оплаты</p>
        <button type="button" class="bd-btn primary pfp-cta" id="pfp-onboard-cta">Заполнить профиль</button>
      </div>` : ''}

      ${showFirstTrip ? `
      <!-- 4. Empty first trip card -->
      <div class="bd-card pfp-firsttrip-card">
        <div class="pfp-firsttrip-icon" aria-hidden="true">${SVG_PIN}</div>
        <p class="pfp-firsttrip-title">Первая поездка ждёт</p>
        <p class="pfp-firsttrip-text">Добавьте адрес «Дом» и «Работа», чтобы заказывать одним касанием</p>
        <button type="button" class="bd-btn primary pfp-cta" id="pfp-addaddr-cta">Добавить адрес</button>
      </div>` : ''}

      ${showStatusCard ? `
      <!-- 5. Ready status card -->
      <div class="bd-card pfp-status-card">
        <span class="pfp-status-eyebrow">
          <span class="pfp-status-dot" aria-hidden="true"></span>
          АККАУНТ ПАССАЖИРА
        </span>
        <p class="pfp-status-title">Готов к поездкам</p>
        <p class="pfp-status-text">Телефон подтверждён, способ оплаты привязан</p>
      </div>` : ''}

      ${showStatsGrid ? `
      <!-- 6. Stats grid -->
      <div class="pfp-stats-grid" aria-label="Статистика поездок">
        <div class="pfp-stat">
          <span class="pfp-stat__num">${trips}</span>
          <span class="pfp-stat__label">Поездок</span>
        </div>
        <div class="pfp-stat">
          <span class="pfp-stat__num pfp-stat__num--accent">${escapeHtml(fmtRub(MOCK_PROFILE_STATS.savingsRub))}</span>
          <span class="pfp-stat__label">Сэкономлено</span>
        </div>
        <div class="pfp-stat">
          <span class="pfp-stat__num">${MOCK_PROFILE_STATS.co2Kg} кг</span>
          <span class="pfp-stat__label">CO₂</span>
        </div>
      </div>` : ''}

      <!-- 7. Quick actions -->
      <p class="pfp-section-title">Быстрые действия</p>
      <div class="pfp-quick-row" role="list">
        <button type="button" class="pfp-quick pfp-quick--accent" id="pfp-quick-where" role="listitem">
          <span class="pfp-quick-icon" aria-hidden="true">${SVG_PIN}</span>
          <span class="pfp-quick-label">Куда едем?</span>
        </button>
        <button type="button" class="pfp-quick" id="pfp-quick-plan" role="listitem">
          <span class="pfp-quick-icon" aria-hidden="true">${SVG_CLOCK_SM}</span>
          <span class="pfp-quick-label">Запланировать</span>
        </button>
        <button type="button" class="pfp-quick" id="pfp-quick-fav" role="listitem">
          <span class="pfp-quick-icon" aria-hidden="true">${SVG_HEART}</span>
          <span class="pfp-quick-label">Избранные</span>
        </button>
        <button type="button" class="pfp-quick" id="pfp-quick-promo" role="listitem">
          <span class="pfp-quick-icon" aria-hidden="true">${SVG_TAG_PROMO}</span>
          <span class="pfp-quick-label">Промокод</span>
        </button>
      </div>

      ${ready ? (() => {
        // state=active_trip forces the active-trip card for the preview URL;
        // otherwise the localStorage demo switch / default mocks decide.
        const forced = previewState === 'active_trip' ? 'active' : null;
        const t = resolveTripsForDemo(MOCK_ACTIVE_TRIP, MOCK_PLANNED_TRIP, forced);
        return tripSectionHtml(t.active, t.planned);
      })() : ''}

      <!-- 7c. My publications (BD-PROFILE-MY-POSTS-01) -->
      ${myPostsSectionHtml()}

      <!-- 7d. Ride history (BD-RIDE-HISTORY-01) -->
      ${historySectionHtml()}

      <!-- 8. Menu card -->
      <p class="pfp-section-title">Меню</p>
      <div class="bd-card pfp-menu-card">
        <button type="button" class="pfp-menu-row" id="pfp-menu-history">
          <span class="pfp-menu-icon" aria-hidden="true">${SVG_CLOCK_SM}</span>
          <span class="pfp-menu-text">
            <span class="pfp-menu-title">История поездок</span>
            <span class="pfp-menu-sub">${ready ? `${trips} поездок` : 'Поездок пока нет'}</span>
          </span>
          <span class="pfp-menu-chev" aria-hidden="true">${SVG_CHEVRON}</span>
        </button>
        <button type="button" class="pfp-menu-row" id="pfp-menu-addrs">
          <span class="pfp-menu-icon" aria-hidden="true">${SVG_HEART_FILL}</span>
          <span class="pfp-menu-text">
            <span class="pfp-menu-title">Сохранённые адреса</span>
            <span class="pfp-menu-sub">${addrs > 0 ? `${addrs} места` : 'Добавьте дом и работу'}</span>
          </span>
          <span class="pfp-menu-chev" aria-hidden="true">${SVG_CHEVRON}</span>
        </button>
        <button type="button" class="pfp-menu-row" id="pfp-menu-pay">
          <span class="pfp-menu-icon" aria-hidden="true">${SVG_CARD}</span>
          <span class="pfp-menu-text">
            <span class="pfp-menu-title">Способы оплаты</span>
            <span class="pfp-menu-sub">${last4 ? `Карта •• ${escapeHtml(last4)}` : 'Не привязан'}</span>
          </span>
          <span class="pfp-menu-chev" aria-hidden="true">${SVG_CHEVRON}</span>
        </button>
        <button type="button" class="pfp-menu-row" id="pfp-menu-promos">
          <span class="pfp-menu-icon" aria-hidden="true">${SVG_TAG_PROMO}</span>
          <span class="pfp-menu-text">
            <span class="pfp-menu-title">Промокоды и бонусы</span>
            <span class="pfp-menu-sub">${promos > 0 ? `${promos} активных` : 'Нет активных'}</span>
          </span>
          <span class="pfp-menu-chev" aria-hidden="true">${SVG_CHEVRON}</span>
        </button>
        <button type="button" class="pfp-menu-row" id="pfp-menu-drafts"${hasDrafts ? '' : ' disabled'}>
          <span class="pfp-menu-icon" aria-hidden="true">${SVG_PENCIL}</span>
          <span class="pfp-menu-text">
            <span class="pfp-menu-title">Мои черновики</span>
            <span class="pfp-menu-sub">${hasDrafts ? 'Продолжить заполнение' : 'Черновиков пока нет'}</span>
          </span>
          <span class="pfp-menu-chev" aria-hidden="true">${SVG_CHEVRON}</span>
        </button>
        <div class="pfp-menu-row pfp-menu-row--toggle">
          <span class="pfp-menu-icon" aria-hidden="true">${SVG_BELL}</span>
          <span class="pfp-menu-text">
            <span class="pfp-menu-title">Уведомления</span>
            <span class="pfp-menu-sub" id="pfp-notif-state">${notif ? 'Включены' : 'Выключены'}</span>
          </span>
          <label class="pf-toggle" aria-label="Получать уведомления">
            <input type="checkbox" class="pf-toggle__input" id="pfp-notif-cb"${notif ? ' checked' : ''}>
            <span class="pf-toggle__track"></span>
          </label>
        </div>
      </div>

      <!-- 9. Safety section -->
      <p class="pfp-section-title">Безопасность</p>
      <div class="bd-card pfp-safety-card">
        <div class="pfp-safety-head">
          <span class="pfp-safety-icon" aria-hidden="true">${SVG_SHIELD}</span>
          <span class="pfp-safety-text">
            <span class="pfp-safety-title">Центр безопасности</span>
            <span class="pfp-safety-sub">Контакты, маршрут, SOS</span>
          </span>
          <span class="pfp-safety-badge">
            <span class="pfp-safety-badge-dot" aria-hidden="true"></span>
            Активно
          </span>
        </div>
        <div class="pfp-safety-actions">
          <button type="button" class="pfp-safety-tile" id="pfp-safe-contacts">
            <span class="pfp-safety-tile-head">
              <span class="pfp-safety-tile-icon" aria-hidden="true">${SVG_PHONE}</span>
              <span class="pfp-safety-tile-count">${trusted}</span>
            </span>
            <span class="pfp-safety-tile-label">Доверенные контакты</span>
          </button>
          <button type="button" class="pfp-safety-tile" id="pfp-safe-share">
            <span class="pfp-safety-tile-head">
              <span class="pfp-safety-tile-icon" aria-hidden="true">${SVG_PAPERPLANE}</span>
              <span class="pfp-safety-tile-count">Авто</span>
            </span>
            <span class="pfp-safety-tile-label">Поделиться поездкой</span>
          </button>
          <button type="button" class="pfp-safety-tile pfp-safety-tile--danger" id="pfp-safe-sos">
            <span class="pfp-safety-tile-head">
              <span class="pfp-safety-tile-icon" aria-hidden="true">${SVG_WARN_TRI}</span>
              <span class="pfp-safety-tile-count">112</span>
            </span>
            <span class="pfp-safety-tile-label">Кнопка SOS</span>
          </button>
        </div>
      </div>

      <!-- 9a. Switch tab mode (BD-ROLE-05) — per-tab role override via
           sessionStorage. Does NOT mutate persisted user.role and does NOT
           call performLocalLogout / user.reset; flips only this tab's view. -->
      <div class="bd-card pfp-support-card">
        <button type="button" class="pfp-menu-row" id="pfp-role-switch">
          <span class="pfp-menu-icon" aria-hidden="true">${SVG_INFO}</span>
          <span class="pfp-menu-text">
            <span class="pfp-menu-title">Продолжить как водитель</span>
          </span>
          <span class="pfp-menu-chev" aria-hidden="true">${SVG_CHEVRON}</span>
        </button>
      </div>

      <!-- 10. Support / logout -->
      <div class="bd-card pfp-support-card">
        <button type="button" class="pfp-menu-row" id="pfp-support">
          <span class="pfp-menu-icon" aria-hidden="true">${SVG_INFO}</span>
          <span class="pfp-menu-text">
            <span class="pfp-menu-title">Помощь и поддержка</span>
          </span>
          <span class="pfp-menu-chev" aria-hidden="true">${SVG_CHEVRON}</span>
        </button>
        <button type="button" class="pfp-menu-row pfp-menu-row--danger" id="pfp-logout">
          <span class="pfp-menu-icon pfp-menu-icon--danger" aria-hidden="true">${SVG_LOGOUT}</span>
          <span class="pfp-menu-text">
            <span class="pfp-menu-title">Выйти</span>
          </span>
          <span class="pfp-menu-chev" aria-hidden="true">${SVG_CHEVRON}</span>
        </button>
      </div>

      <!-- 11. Footer -->
      <p class="pfp-footer">BazarDrive · v2.4.1</p>
    </div>
  `;

  // ── Event wiring ─────────────────────────────────────────────────────────
  const rerender = () => renderPassenger(root, user.get());

  wireMyPostsSection(root);
  wireHistorySection(root);

  root.querySelector('#pfp-onboard-cta')?.addEventListener('click', () => {
    user.set({
      profileStatus: 'ready',
      paymentLast4: '4821',
      promoCount: 2,
      trustedContactsCount: 2,
      tripCount: 38,
      savedAddressCount: 3,
    });
    rerender();
  });

  root.querySelector('#pfp-addaddr-cta')?.addEventListener('click', () => {
    user.set({ savedAddressCount: 3 });
    rerender();
  });

  // Notifications toggle is functional: it reads the persisted
  // notificationsEnabled flag (rendered above) and writes the new value back
  // to state/localStorage, updating the On/Off label in place.
  root.querySelector('#pfp-notif-cb')?.addEventListener('change', (e) => {
    const on = e.target.checked;
    user.set({ notificationsEnabled: on });
    const stateLabel = root.querySelector('#pfp-notif-state');
    if (stateLabel) stateLabel.textContent = on ? 'Включены' : 'Выключены';
  });

  // Phone verification — both CTAs route into the existing onboarding phone
  // step (the project's phone-verify flow). The query hint targets the phone
  // step so the flow lands on SMS entry rather than dead-ending in the
  // profile. No real SMS provider is wired; onboarding owns the mock OTP.
  const goVerifyPhone = () => go('/onboarding?step=phone');
  root.querySelector('#pfp-verify-getcode')?.addEventListener('click', goVerifyPhone);
  root.querySelector('#pfp-verify-confirm')?.addEventListener('click', goVerifyPhone);

  // BD-ROLE-05 — per-tab role view switch. sessionStorage-only via
  // setSmokeRole; persisted user.role is NOT touched, user.reset is NOT
  // called, and no other profile data (vehicle, documents, history) is
  // mutated. go('/profile') re-runs the factory which picks the new
  // effectiveRole from getSmokeRole() and renders the driver view.
  root.querySelector('#pfp-role-switch')?.addEventListener('click', () => {
    setSmokeRole('driver');
    go('/profile');
  });

  root.querySelector('#pfp-quick-where')?.addEventListener('click', () => go('/feed'));
  root.querySelector('#pfp-menu-history')?.addEventListener('click', () => go('/feed'));
  root.querySelector('#pfp-support')?.addEventListener('click', () => go('/rules'));

  // Drafts row only navigates when a draft exists; the disabled state above
  // keeps the dead-end case safe (no listener fires on a disabled button).
  root.querySelector('#pfp-menu-drafts')?.addEventListener('click', () => {
    if (hasComposerDraft()) go('/new');
  });

  // Active trip — call/chat remain visual prototypes (no real API). The
  // card CTA opens the live ride screen in passenger mode.
  root.querySelector('#pfp-trip-call')?.addEventListener('click', (e) => {
    e.currentTarget.blur();
  });
  root.querySelector('#pfp-trip-chat')?.addEventListener('click', (e) => {
    e.currentTarget.blur();
  });
  root.querySelector('#pfp-trip-open')?.addEventListener('click', () => go('/active-ride?role=passenger'));

  // Planned trip — visual prototype only. No backend; the action buttons
  // just dismiss focus until the planning flow is wired up.
  root.querySelector('#pfp-plan-edit')?.addEventListener('click', (e) => {
    e.currentTarget.blur();
  });
  root.querySelector('#pfp-plan-cancel')?.addEventListener('click', (e) => {
    e.currentTarget.blur();
  });
  root.querySelector('#pfp-plan-cta')?.addEventListener('click', (e) => {
    e.currentTarget.blur();
  });

  // Safety tiles — demo placeholders. SOS does NOT initiate a real call
  // (no tel: link); buttons exist only to anchor the visual prototype.
  root.querySelector('#pfp-safe-contacts')?.addEventListener('click', (e) => {
    e.currentTarget.blur();
  });
  root.querySelector('#pfp-safe-share')?.addEventListener('click', (e) => {
    e.currentTarget.blur();
  });
  root.querySelector('#pfp-safe-sos')?.addEventListener('click', (e) => {
    e.currentTarget.blur();
  });

  const logoutBtn = root.querySelector('#pfp-logout');
  logoutBtn?.addEventListener('click', () => {
    if (logoutBtn.dataset.confirm === 'pending') {
      // BD-AUTH-BOUNDARY-01 — single mock logout boundary owns trip-demo
      // cleanup, ride-history cleanup, user.reset() and navigation.
      performLocalLogout();
    } else {
      logoutBtn.dataset.confirm = 'pending';
      const titleEl = logoutBtn.querySelector('.pfp-menu-title');
      if (titleEl) titleEl.textContent = 'Нажмите ещё раз для подтверждения';
    }
  });
}

// ── Driver dashboard (BD-PROFILE-02) ─────────────────────────────────────────

function tabsHtml(activeId = 'overview') {
  const TABS = [
    { id: 'overview', label: 'Обзор' },
    { id: 'ip',       label: 'Такси·ИП' },
    { id: 'docs',     label: 'Документы' },
    { id: 'payouts',  label: 'Выплаты' },
    { id: 'security', label: 'Безопасность' },
  ];
  return `<div class="pf2-tabs-wrap">
    <div class="pf2-tabs-row" role="tablist">${
      TABS.map((t) =>
        `<button type="button" class="pf2-tab${t.id === activeId ? ' pf2-tab--active' : ''}" data-pane="${t.id}" role="tab" aria-selected="${t.id === activeId}">${t.label}</button>`
      ).join('')
    }</div>
  </div>`;
}

function driverHeroHtml(u) {
  const ini  = escapeHtml(initials(u));
  const name = escapeHtml(displayName(u));
  const car  = (u.vehicleMake && u.vehicleModel)
    ? escapeHtml(`${u.vehicleMake} ${u.vehicleModel}${u.vehiclePlate ? ' · ' + u.vehiclePlate : ''}`)
    : '';
  return `
    <div class="pf2-hero">
      <div class="pf2-avatar" aria-hidden="true">${ini}</div>
      <p class="pf2-hero__name">${name}</p>
      <div class="pf2-hero__meta">
        <span class="pf2-hero__star">${SVG_STAR}</span>
        <span class="pf2-hero__rating">4.8</span>
        <span class="pf2-hero__sep">·</span>
        <span class="pf2-hero__trips">203 поездки</span>
      </div>
      ${car ? `<p class="pf2-hero__car">${car}</p>` : ''}
      <button type="button" class="pf2-edit-btn" id="pf2-edit">${SVG_PENCIL} Изменить</button>
    </div>`;
}

function statusCardHtml(u) {
  const state   = getDriverStatusState(u);
  const checked = u.driverOnline ? ' checked' : '';
  const ready   = isDriverLineReady(u);
  return `
    <div class="pf2-status-card" data-state="${state}" id="pf2-status-card">
      <div class="pf2-status-top">
        <span class="pf2-status-dot" aria-hidden="true"></span>
        <div class="pf2-status-text">
          <p class="pf2-status-title" id="pf2-status-title">${getDriverStatusTitle(u)}</p>
          <p class="pf2-status-sub" id="pf2-status-sub">${getDriverStatusSubtitle(u)}</p>
        </div>
        <label class="pf2-toggle" aria-label="Статус водителя">
          <input type="checkbox" id="pf2-online-toggle"${checked}>
          <span class="pf2-toggle__track"></span>
        </label>
      </div>
      <button type="button" class="pf2-action-cta" id="pf2-goto-actions">Перейти к действиям</button>
      <button type="button" class="bd-btn primary pf2-active-shift-cta" id="pf2-active-shift-cta"${ready ? '' : ' disabled'}>
        На линии — открыть активную смену
      </button>
    </div>`;
}

function driverStatsHtml() {
  return `
    <div class="pf2-stats-grid">
      <div class="pf2-stat-card">
        <span class="pf2-stat-val pf2-stat-val--accent">18 420 ₽</span>
        <span class="pf2-stat-label">За неделю</span>
      </div>
      <div class="pf2-stat-card">
        <span class="pf2-stat-val">42</span>
        <span class="pf2-stat-label">Поездок</span>
      </div>
      <div class="pf2-stat-card">
        <span class="pf2-stat-val">38</span>
        <span class="pf2-stat-label">Часов</span>
      </div>
    </div>`;
}

function readinessHtml(items) {
  const doneCount = items.filter((it) => it.done).length;
  const rows = items.map((it) => {
    const baseCls = `pf2-check-row${it.done ? ' pf2-check-row--done' : ''}`;
    const icon    = `<span class="pf2-check-icon" aria-hidden="true">${it.done ? SVG_CHECK : ''}</span>`;
    const label   = `<span class="pf2-check-label">${escapeHtml(it.label)}</span>`;
    if (it.action && !it.done) {
      const id = it.id === 'taxi-permit' ? ' id="pf2-check-taxi-permit"' : '';
      return `
      <button type="button" class="${baseCls} pf2-check-row--action"${id} data-action="${escapeHtml(it.action)}">
        ${icon}${label}
        <span class="pf2-check-arrow" aria-hidden="true">${SVG_CHEVRON}</span>
      </button>`;
    }
    return `
      <div class="${baseCls}">
        ${icon}${label}
      </div>`;
  }).join('');
  return `
    <div class="pf2-readiness-card">
      <div class="pf2-readiness-header">
        <span class="pf2-readiness-title">Готовность к смене</span>
        <span class="pf2-readiness-count">${doneCount} из ${items.length}</span>
      </div>
      <div class="pf2-progress-bar" data-done="${doneCount}">
        <div class="pf2-progress-fill"></div>
      </div>
      <div class="pf2-checklist">${rows}
      </div>
    </div>`;
}

function taxiPermitPanelHtml(u) {
  const d = u.taxiPermitDraft || {};
  const num    = escapeHtml(d.number || '');
  const region = escapeHtml(d.region || '');
  const issued = escapeHtml(d.issuedAt || '');
  const expiry = escapeHtml(d.expiresAt || '');
  return `
    <div class="pf2-permit-panel" id="pf2-permit-panel" hidden aria-labelledby="pf2-permit-panel-title">
      <div class="pf2-permit-panel__head">
        <p class="pf2-permit-panel__title" id="pf2-permit-panel-title">Разрешение такси</p>
        <button type="button" class="pf2-permit-panel__close" id="pf2-permit-close" aria-label="Закрыть">✕</button>
      </div>
      <p class="pf2-permit-panel__hint">Заполните данные разрешения — это пункт готовности к смене.</p>
      <label class="pf2-permit-field">
        <span class="pf2-permit-field__label">Номер разрешения</span>
        <input type="text" class="pf2-permit-input" id="pf2-permit-number" autocomplete="off" inputmode="text" value="${num}">
      </label>
      <label class="pf2-permit-field">
        <span class="pf2-permit-field__label">Регион выдачи</span>
        <input type="text" class="pf2-permit-input" id="pf2-permit-region" autocomplete="off" value="${region}">
      </label>
      <div class="pf2-permit-row2">
        <label class="pf2-permit-field">
          <span class="pf2-permit-field__label">Дата выдачи</span>
          <input type="date" class="pf2-permit-input" id="pf2-permit-issued" value="${issued}">
        </label>
        <label class="pf2-permit-field">
          <span class="pf2-permit-field__label">Действует до</span>
          <input type="date" class="pf2-permit-input" id="pf2-permit-expiry" value="${expiry}">
        </label>
      </div>
      <div class="pf2-permit-file">
        <div class="pf2-permit-file__icon" aria-hidden="true">${SVG_DOC_LG}</div>
        <div class="pf2-permit-file__text">
          <p class="pf2-permit-file__title">Фото / файл разрешения</p>
          <p class="pf2-permit-file__sub">Загрузка появится в следующей версии</p>
        </div>
      </div>
      <p class="pf2-permit-status" id="pf2-permit-status" hidden></p>
      <div class="pf2-permit-actions">
        <button type="button" class="bd-btn pf2-permit-btn" id="pf2-permit-save-draft">Сохранить черновик</button>
        <button type="button" class="bd-btn primary pf2-permit-btn" id="pf2-permit-mark-done">Отметить как добавлено для demo</button>
      </div>
    </div>`;
}

function quickActionsHtml() {
  return `
    <div class="pf2-actions-section">
      <p class="pf2-actions-title">Быстрые действия</p>
      <div class="pf2-action-list">
        <button type="button" class="pf2-action-row" id="pf2-act-car">
          <span class="pf2-action-row__label">Мой автомобиль</span>${SVG_CHEVRON}
        </button>
        <button type="button" class="pf2-action-row" id="pf2-act-contracts">
          <span class="pf2-action-row__label">Шаблоны договоров</span>${SVG_CHEVRON}
        </button>
        <button type="button" class="pf2-action-row" id="pf2-act-notif">
          <span class="pf2-action-row__label">Уведомления</span>${SVG_CHEVRON}
        </button>
        <button type="button" class="pf2-action-row" id="pf2-act-role-switch">
          <span class="pf2-action-row__label">Продолжить как пассажир</span>${SVG_CHEVRON}
        </button>
        <button type="button" class="pf2-action-row pf2-action-row--danger" id="pf2-act-logout">
          <span class="pf2-action-row__label">Выйти</span>${SVG_CHEVRON}
        </button>
      </div>
    </div>`;
}

// ── Safety center pane (BD-PROFILE-D-03 · state I) ───────────────────────────
// Calm, visible driver safety surface. Static demo only: the tiles never place
// a real call and the readiness rows read fixed copy. Driver-scoped pf2-safety-*
// classes only — the passenger safety card (.pfp-safety-*) is left untouched so
// the two role branches stay fully separated.
function securityPaneHtml() {
  return `
    <div class="bd-card pf2-safety-card">
      <div class="pf2-safety-head">
        <span class="pf2-safety-icon" aria-hidden="true">${SVG_SHIELD}</span>
        <span class="pf2-safety-headtext">
          <span class="pf2-safety-title">Центр безопасности</span>
          <span class="pf2-safety-sub">Поддержка, маршрут смены и экстренная связь</span>
        </span>
        <span class="pf2-safety-badge">
          <span class="pf2-safety-badge-dot" aria-hidden="true"></span>
          Активно
        </span>
      </div>
      <div class="pf2-safety-tiles">
        <button type="button" class="pf2-safety-tile" id="pf2-safety-contacts">
          <span class="pf2-safety-tile-head">
            <span class="pf2-safety-tile-icon" aria-hidden="true">${SVG_PHONE}</span>
            <span class="pf2-safety-tile-count">2</span>
          </span>
          <span class="pf2-safety-tile-label">Доверенные контакты</span>
        </button>
        <button type="button" class="pf2-safety-tile" id="pf2-safety-share">
          <span class="pf2-safety-tile-head">
            <span class="pf2-safety-tile-icon" aria-hidden="true">${SVG_PAPERPLANE}</span>
            <span class="pf2-safety-tile-count">Авто</span>
          </span>
          <span class="pf2-safety-tile-label">Поделиться сменой</span>
        </button>
        <button type="button" class="pf2-safety-tile pf2-safety-tile--danger" id="pf2-safety-sos">
          <span class="pf2-safety-tile-head">
            <span class="pf2-safety-tile-icon" aria-hidden="true">${SVG_WARN_TRI}</span>
            <span class="pf2-safety-tile-count">112</span>
          </span>
          <span class="pf2-safety-tile-label">Кнопка SOS</span>
        </button>
      </div>
    </div>

    <div class="bd-card pf2-safety-note">
      <span class="pf2-safety-note-icon" aria-hidden="true">${SVG_INFO}</span>
      <p class="pf2-safety-note-text">Если есть угроза безопасности — сначала свяжитесь с поддержкой. В экстренной ситуации звоните 112. Кнопки на этом экране — демонстрация интерфейса.</p>
    </div>

    <p class="pf2-safety-sect-title">Проверки безопасности</p>
    <div class="bd-card pf2-safety-checks">
      <div class="pf2-safety-check-row">
        <span class="pf2-safety-check-dot pf2-safety-check-dot--ok" aria-hidden="true"></span>
        <span class="pf2-safety-check-label">Личность подтверждена</span>
        <span class="pf2-safety-check-val pf2-safety-check-val--ok">Готово</span>
      </div>
      <div class="pf2-safety-check-row">
        <span class="pf2-safety-check-dot pf2-safety-check-dot--ok" aria-hidden="true"></span>
        <span class="pf2-safety-check-label">Поездки записываются в историю</span>
        <span class="pf2-safety-check-val pf2-safety-check-val--ok">Включено</span>
      </div>
      <div class="pf2-safety-check-row">
        <span class="pf2-safety-check-dot" aria-hidden="true"></span>
        <span class="pf2-safety-check-label">Автоотправка маршрута контакту</span>
        <span class="pf2-safety-check-val">Настроить</span>
      </div>
    </div>`;
}

// ── Driver skeleton / loading state (BD-PROFILE-D-03 · state J) ───────────────
// Reachable through /profile?role=driver&state=loading. Renders the same top
// bar + tab row so the loading state does not remount chrome, then a set of
// shimmer bones in the scroll area. Static, non-interactive, class-driven
// shimmer only (no inline styles, no timers).
function driverSkeletonBonesHtml() {
  return `
    <div class="pf2-skeleton" aria-hidden="true">
      <div class="pf2-sk-hero">
        <span class="pf2-sk pf2-sk-avatar"></span>
        <span class="pf2-sk pf2-sk-line pf2-sk-line--lg"></span>
        <span class="pf2-sk pf2-sk-line pf2-sk-line--sm"></span>
      </div>
      <span class="pf2-sk pf2-sk-card"></span>
      <div class="pf2-sk-stats">
        <span class="pf2-sk pf2-sk-stat"></span>
        <span class="pf2-sk pf2-sk-stat"></span>
        <span class="pf2-sk pf2-sk-stat"></span>
      </div>
      <span class="pf2-sk pf2-sk-card pf2-sk-card--tall"></span>
    </div>`;
}

function renderDriverSkeleton(root) {
  root.innerHTML = `
    <div class="pf2-topbar">
      <h1 class="pf2-topbar__title">Профиль</h1>
      <button type="button" class="pf2-topbar__gear" aria-label="Настройки" disabled>${SVG_GEAR}</button>
    </div>
    ${tabsHtml('overview')}
    <div class="bd-scroll" aria-busy="true">
      <p class="pf2-sk-status" role="status">Загружаем профиль…</p>
      ${driverSkeletonBonesHtml()}
    </div>`;
}

// BD-ROLE-01 — Explicit driver-facing create/order actions. Drivers default
// to driver intents (nearby orders on DriverMap, a driver offer in Composer)
// and only reach the passenger request flow through the clearly-labelled
// "Перейти в режим пассажира" entry — never silently.
function driverCreateActionsHtml() {
  return `
    <div class="pf2-actions-section">
      <p class="pf2-actions-title">Заказы и публикации</p>
      <div class="pf2-action-list">
        <button type="button" class="pf2-action-row" id="pf2-act-nearby">
          <span class="pf2-action-row__label">Заказы рядом</span>${SVG_CHEVRON}
        </button>
        <button type="button" class="pf2-action-row" id="pf2-act-offer">
          <span class="pf2-action-row__label">Предложить поездку</span>${SVG_CHEVRON}
        </button>
        <button type="button" class="pf2-action-row" id="pf2-act-passenger-mode">
          <span class="pf2-action-row__label">Перейти в режим пассажира</span>${SVG_CHEVRON}
        </button>
      </div>
    </div>`;
}

// ── My publications (BD-PROFILE-MY-POSTS-01) ────────────────────────────────
// Inline Profile section listing the current user's locally created posts.
// Data source: listMyPostsSync() (localStorage + in-memory FEED_POSTS_V2,
// filtered by createdByCurrentUser). No new route — entry point lives in
// Profile only. Empty state CTA navigates to /new (composer).

const POST_TYPE_LABELS = {
  trip:         'Поездка',
  announcement: 'Объявление',
  marketplace:  'Маркет',
  service:      'Услуга',
};

function myPostTypeLabel(p) {
  if (p?.type === 'trip' && p.passenger === true) return 'Попутчик';
  // Composer serializes both marketplace and service drafts as type:'marketplace'
  // but tags service posts with subtype:'service' so we can re-label them here.
  if (p?.type === 'marketplace' && p?.subtype === 'service') return 'Услуга';
  return POST_TYPE_LABELS[p?.type] || 'Публикация';
}

function myPostSummary(p) {
  if (p?.type === 'trip' && (p.from || p.to)) {
    return `${p.from || '—'} → ${p.to || '—'}`;
  }
  if (p?.title) return String(p.title);
  if (p?.body)  return String(p.body);
  return '—';
}

function myPostTime(p) {
  // Prefer createdAt: the persisted `time` field is captured at creation
  // ('Только что') and would stay stale after reload.
  if (p?.createdAt) {
    try {
      return new Date(p.createdAt).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      });
    } catch { return ''; }
  }
  if (p?.time) return String(p.time);
  return '';
}

function myPostCardHtml(p) {
  const typeLabel = escapeHtml(myPostTypeLabel(p));
  const summary   = escapeHtml(myPostSummary(p));
  const time      = escapeHtml(myPostTime(p));
  const price     = p?.price ? escapeHtml(String(p.price)) : '';
  return `
    <article class="bd-card-tight pf-mypost-card">
      <div class="pf-mypost-row">
        <span class="bd-badge accent">${typeLabel}</span>
        ${time ? `<span class="pf-mypost-time">${time}</span>` : ''}
      </div>
      <p class="pf-mypost-summary">${summary}</p>
      ${price ? `<p class="pf-mypost-price">${price}</p>` : ''}
    </article>
  `;
}

function myPostsSectionHtml() {
  const posts = listMyPostsSync();
  const count = posts.length;
  const header = `
    <div class="pf-mypub-header">
      <p class="pfp-section-title pf-mypub-title">Мои публикации</p>
      ${count > 0 ? `<span class="bd-badge pf-mypub-count">${escapeHtml(String(count))}</span>` : ''}
    </div>`;
  if (count === 0) {
    return `
      ${header}
      <div class="bd-card pf-mypub-empty" id="pf-mypub-empty">
        <p class="pf-mypub-empty__title">Пока нет публикаций</p>
        <p class="pf-mypub-empty__text">Создайте поездку, объявление или услугу — они появятся здесь.</p>
        <button type="button" class="bd-btn primary pf-mypub-empty__cta" id="pf-mypub-create">Создать публикацию</button>
      </div>`;
  }
  return `
    ${header}
    <div class="pf-mypub-list" id="pf-mypub-list">
      ${posts.map(myPostCardHtml).join('')}
    </div>`;
}

function wireMyPostsSection(root) {
  // BD-ROLE-05 — route the create CTA through the tab's effective role so a
  // persisted driver who switched this tab to passenger view does not land on
  // /new?type=driver_offer. applySmokeRole returns the shared user with the
  // per-tab override layered on; it never persists.
  root.querySelector('#pf-mypub-create')?.addEventListener('click', () => go(createIntentRoute(applySmokeRole(user.get()))));
}

// ── Ride history (BD-RIDE-HISTORY-01 / BD-RIDE-HISTORY-08) ────────────────────
// Renders the locally-persisted ride history (see ride_history.js) inside the
// Profile screen. Read-only surface — no backend, no auth. Both passenger and
// driver entries are surfaced together, sorted newest-first by savedAt /
// completedAt. Layout (BD-RIDE-HISTORY-08):
//   1. "Последняя поездка" — single summary card for the freshest entry.
//   2. "История поездок" — compact monthly calendar that marks days with
//      rides (dot for one, badge for several) and renders the selected day's
//      rides (max 3, with a "Все поездки за день" expander) plus a daily
//      total split by role (доход for driver, стоимость for passenger).
// Empty state renders an inline empty card. Malformed storage renders the
// recovery card.

// BD-RIDE-HISTORY-04 — the latest-first entries from the most recent
// historySectionHtml() render. Each card carries a data-history-index that
// maps back into this array so the detail-receipt handler can resolve the
// clicked entry without re-reading or re-sorting storage.
let lastHistoryEntries = [];

// BD-RIDE-HISTORY-08 — calendar view state. Persists across re-renders so
// month navigation and day selection survive ride detail open/close. Reset
// to today on first use; ride storage changes do not nuke it on purpose so
// the user keeps their place when a new ride arrives.
let historyCalendarState = null;

function ensureHistoryCalendarState() {
  if (!historyCalendarState) {
    const now = new Date();
    historyCalendarState = {
      year: now.getFullYear(),
      month: now.getMonth(),
      selectedKey: getLocalDateKey(now),
      showAll: false,
    };
  }
  return historyCalendarState;
}

function pluralRu(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

// BD-RIDE-HISTORY-08 — defensive completedAt reader. Falls back to savedAt so
// older records keep showing up; returns null when neither field is parseable
// so a single bad record can't crash the calendar. Callers must null-check.
function getRideCompletedAt(ride) {
  const value = ride?.completedAt || ride?.savedAt;
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t) : null;
}

function getLocalDateKey(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Groups sorted entries into a Map<dateKey, {ride, index}[]>. Each item also
// carries its index in the original sorted array so the click handler can
// resolve back to lastHistoryEntries without a second lookup.
function groupRidesByDate(sortedRides) {
  const map = new Map();
  sortedRides.forEach((ride, index) => {
    const d = getRideCompletedAt(ride);
    if (!d) return;
    const key = getLocalDateKey(d);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ ride, index });
  });
  for (const arr of map.values()) {
    arr.sort((a, b) => {
      const ta = getRideCompletedAt(a.ride)?.getTime() ?? 0;
      const tb = getRideCompletedAt(b.ride)?.getTime() ?? 0;
      return tb - ta;
    });
  }
  return map;
}

// 6 weeks × 7 days = 42 cells, Monday-first. Cells outside the view month
// keep `inMonth: false` so the renderer can dim them.
function getMonthCalendarDays(year, month) {
  const firstOfMonth = new Date(year, month, 1);
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - firstWeekday);
  const days = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    days.push({
      date: d,
      key: getLocalDateKey(d),
      inMonth: d.getMonth() === month,
    });
  }
  return days;
}

function parseFareNumber(fare) {
  if (fare == null) return 0;
  if (typeof fare === 'number') return Number.isFinite(fare) ? fare : 0;
  const s = String(fare).replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function formatMonthLabel(year, month) {
  try {
    const label = new Date(year, month, 1).toLocaleDateString('ru-RU', {
      month: 'long', year: 'numeric',
    });
    return capitalize(label);
  } catch {
    return `${month + 1}/${year}`;
  }
}

function formatSelectedDayLabel(date) {
  try {
    return date.toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch {
    return getLocalDateKey(date);
  }
}

function formatHistoryTime(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '';
  try {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function buildDaySummary(rides) {
  const driverRides    = rides.filter((r) => r.role === 'driver');
  const passengerRides = rides.filter((r) => r.role === 'passenger');
  const parts = [];
  if (driverRides.length) {
    const income = driverRides.reduce(
      (s, r) => s + parseFareNumber(driverEntryNetValue(r)), 0
    );
    const count = driverRides.length;
    const word  = pluralRu(count, 'поездка', 'поездки', 'поездок');
    parts.push(`${count} ${word} · ${fmtRub(income)} доход`);
  }
  if (passengerRides.length) {
    const total = passengerRides.reduce((s, r) => s + parseFareNumber(r?.fare), 0);
    const count = passengerRides.length;
    const word  = pluralRu(count, 'поездка', 'поездки', 'поездок');
    parts.push(`${count} ${word} · ${fmtRub(total)} потрачено`);
  }
  return parts.join(' · ');
}

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function renderRideHistoryCalendar(state, byDate) {
  const { year, month, selectedKey } = state;
  const todayKey = getLocalDateKey(new Date());
  const days = getMonthCalendarDays(year, month);
  const cells = days.map((cell) => {
    const items = byDate.get(cell.key) || [];
    const count = items.length;
    const dayNum = cell.date.getDate();
    const isSelected = cell.key === selectedKey;
    const isToday    = cell.key === todayKey;
    const classes = ['profile-history-calendar__day'];
    if (!cell.inMonth) classes.push('profile-history-calendar__day--other');
    if (isToday) classes.push('profile-history-calendar__day--today');
    if (count > 0) classes.push('profile-history-calendar__day--has-rides');
    if (count > 1) classes.push('profile-history-calendar__day--multi');
    if (isSelected) classes.push('profile-history-calendar__day--selected');
    const ariaLabel = count > 0
      ? `${formatSelectedDayLabel(cell.date)}, ${count} ${pluralRu(count, 'поездка', 'поездки', 'поездок')}`
      : formatSelectedDayLabel(cell.date);
    const marker = count > 1
      ? `<span class="profile-history-calendar__badge">${count}</span>`
      : (count === 1 ? `<span class="profile-history-calendar__dot" aria-hidden="true"></span>` : '');
    return `<button type="button" class="${classes.join(' ')}" data-cal-day="${escapeHtml(cell.key)}" aria-pressed="${isSelected ? 'true' : 'false'}" aria-label="${escapeHtml(ariaLabel)}">
      <span class="profile-history-calendar__day-num">${dayNum}</span>
      ${marker}
    </button>`;
  }).join('');
  const weekdays = WEEKDAY_LABELS
    .map((w) => `<span class="profile-history-calendar__wd">${w}</span>`)
    .join('');
  return `
    <div class="profile-history-calendar" role="group" aria-label="Календарь поездок">
      <div class="profile-history-calendar__nav">
        <button type="button" class="profile-history-calendar__nav-btn" data-cal-action="prev-month" aria-label="Предыдущий месяц">‹</button>
        <span class="profile-history-calendar__title">${escapeHtml(formatMonthLabel(year, month))}</span>
        <button type="button" class="profile-history-calendar__nav-btn" data-cal-action="next-month" aria-label="Следующий месяц">›</button>
      </div>
      <div class="profile-history-calendar__weekdays" aria-hidden="true">${weekdays}</div>
      <div class="profile-history-calendar__grid" role="grid">${cells}</div>
    </div>`;
}

function renderSelectedDayRides(state, byDate, sortedEntries) {
  const { selectedKey, showAll } = state;
  const items = byDate.get(selectedKey) || [];
  const parsed = selectedKey ? new Date(`${selectedKey}T00:00:00`) : null;
  const dateLabel = parsed && Number.isFinite(parsed.getTime())
    ? capitalize(formatSelectedDayLabel(parsed))
    : '';
  if (items.length === 0) {
    return `
      <div class="profile-history-selected">
        <div class="profile-history-selected__head">
          <p class="profile-history-selected__date">${escapeHtml(dateLabel)}</p>
          <p class="profile-history-selected__summary profile-history-selected__summary--muted">Нет поездок за этот день</p>
        </div>
      </div>`;
  }
  const visible = showAll ? items : items.slice(0, 3);
  const rideRows = visible.map(({ ride, index }) =>
    selectedDayRideRowHtml(ride, index)
  ).filter((html) => html).join('');
  const more = items.length > 3 && !showAll
    ? `<button type="button" class="profile-history-selected__more" data-cal-action="show-all">Все поездки за день (${items.length})</button>`
    : '';
  const rides = items.map((it) => it.ride);
  const summary = buildDaySummary(rides);
  return `
    <div class="profile-history-selected">
      <div class="profile-history-selected__head">
        <p class="profile-history-selected__date">${escapeHtml(dateLabel)}</p>
        ${summary ? `<p class="profile-history-selected__summary">${escapeHtml(summary)}</p>` : ''}
      </div>
      <div class="profile-history-selected__list">${rideRows}</div>
      ${more}
    </div>`;
}

function selectedDayRideRowHtml(ride, index) {
  try {
    const pickup  = escapeHtml(ride?.route?.pickupLabel  || '—');
    const dropoff = escapeHtml(ride?.route?.dropoffLabel || '—');
    const when    = formatHistoryTime(getRideCompletedAt(ride));
    const isDriver = ride?.role === 'driver';
    const amountRaw = isDriver
      ? driverEntryNetValue(ride)
      : ride?.fare;
    const amount = formatHistoryFare(amountRaw);
    return `
      <article class="profile-history-day__row profile-history-day__row--clickable" role="button" tabindex="0" data-history-index="${index}" aria-haspopup="dialog">
        <span class="profile-history-day__time">${escapeHtml(when || '')}</span>
        <span class="profile-history-day__route">
          <span class="profile-history-day__route-from">${pickup}</span>
          <span class="profile-history-day__route-arrow" aria-hidden="true">→</span>
          <span class="profile-history-day__route-to">${dropoff}</span>
        </span>
        ${amount ? `<span class="profile-history-day__amount${isDriver ? ' profile-history-day__amount--income' : ''}">${escapeHtml(amount)}</span>` : ''}
      </article>`;
  } catch {
    return '';
  }
}

function historyEntryTimestamp(entry) {
  return entry?.savedAt || entry?.completedAt || '';
}

function parseHistoryTimestamp(value) {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

function sortHistoryEntriesDesc(entries) {
  return entries.slice().sort((a, b) => {
    return parseHistoryTimestamp(historyEntryTimestamp(b))
      - parseHistoryTimestamp(historyEntryTimestamp(a));
  });
}

function formatHistoryDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  try {
    return d.toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function formatHistoryFare(fare) {
  if (fare == null || fare === '') return '';
  if (typeof fare === 'number' && Number.isFinite(fare)) return fmtRub(fare);
  const s = String(fare);
  // Already formatted (e.g. "350 ₽") — pass through; otherwise try to parse.
  if (/[₽a-zа-яё]/i.test(s)) return s;
  const num = Number(s.replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(num) ? fmtRub(num) : s;
}

function historyVehicleText(vehicle) {
  const parts = [
    vehicle?.model,
    vehicle?.color,
    vehicle?.plate,
  ].filter(Boolean).map((v) => String(v).trim()).filter(Boolean);
  return parts.join(' · ');
}

// BD-RIDE-HISTORY-D-01 — completed driver rides carry the canonical receipt
// persisted by the earnings flow. History rows/cards READ this object and only
// format it; they never recompute fare / commission / tip / net.
function driverEntryReceipt(entry) {
  const r = entry && entry.receipt;
  return (r && typeof r === 'object' && !Array.isArray(r)) ? r : null;
}

// Single net source for a driver entry: the persisted receipt wins, then the
// legacy earnings block, then the raw fare. No arithmetic — only selection.
function driverEntryNetValue(entry) {
  const receipt = driverEntryReceipt(entry);
  if (receipt && receipt.net != null) return receipt.net;
  if (entry?.earnings && entry.earnings.net != null) return entry.earnings.net;
  return entry?.fare;
}

// BD-PROFILE-D-04 — canonical driver-facing payment-mode labels live here once
// so payout / history / detail surfaces share the exact same wording and cannot
// drift apart. Mirrors trip_receipt.js#paymentBadgeHtml and
// active_ride_driver_sheets.js. paymentMode is read straight from the stored
// receipt — no derivation.
const PAYMENT_MODE_LABELS = {
  cash: 'Оплата наличными',
  noncash: 'Безналичный расчёт',
};

function receiptPaymentModeLabel(mode) {
  return PAYMENT_MODE_LABELS[mode] || '';
}

// BD-PROFILE-D-03 — cash / noncash badge for payout receipt rows. Reuses the
// shared label constant so the payout list and the receipt cannot drift.
function receiptPaymentBadgeHtml(mode) {
  if (mode === 'cash') {
    return `<span class="pf2-po-trip-badge pf2-po-trip-badge--cash">${PAYMENT_MODE_LABELS.cash}</span>`;
  }
  if (mode === 'noncash') {
    return `<span class="pf2-po-trip-badge pf2-po-trip-badge--noncash">${PAYMENT_MODE_LABELS.noncash}</span>`;
  }
  return '';
}

function historyRoleBadgeHtml(role) {
  if (role === 'driver') {
    return `<span class="bd-badge profile-history__role profile-history__role--driver">Водитель</span>`;
  }
  return `<span class="bd-badge profile-history__role profile-history__role--passenger">Пассажир</span>`;
}

function passengerHistoryEntryHtml(entry, index) {
  const pickup  = escapeHtml(entry?.route?.pickupLabel  || '—');
  const dropoff = escapeHtml(entry?.route?.dropoffLabel || '—');
  const driver  = escapeHtml(entry?.driver?.name || 'Водитель');
  const vehicle = historyVehicleText(entry?.vehicle || {});
  const fare    = formatHistoryFare(entry?.fare);
  const rating  = (typeof entry?.rating === 'number' && entry.rating > 0)
    ? entry.rating : null;
  const when    = formatHistoryDate(historyEntryTimestamp(entry));
  return `
    <article class="bd-card-tight profile-history__card profile-history__card--clickable" role="button" tabindex="0" data-history-index="${index}" aria-haspopup="dialog">
      <div class="profile-history__head">
        ${historyRoleBadgeHtml('passenger')}
        ${when ? `<span class="profile-history__when profile-history__when--head">${escapeHtml(when)}</span>` : ''}
      </div>
      <p class="profile-history__route">
        <span class="profile-history__route-from">${pickup}</span>
        <span class="profile-history__route-arrow" aria-hidden="true">→</span>
        <span class="profile-history__route-to">${dropoff}</span>
      </p>
      <div class="profile-history__meta">
        <span class="profile-history__meta-label">Водитель</span>
        <span class="profile-history__meta-value">${driver}</span>
      </div>
      ${vehicle ? `
      <div class="profile-history__meta">
        <span class="profile-history__meta-label">Автомобиль</span>
        <span class="profile-history__meta-value">${escapeHtml(vehicle)}</span>
      </div>` : ''}
      ${(fare || rating !== null) ? `
      <div class="profile-history__footer">
        ${fare ? `<span class="profile-history__fare">${escapeHtml(fare)}</span>` : ''}
        ${rating !== null ? `<span class="profile-history__rating" aria-label="Оценка ${rating}">${SVG_STAR}${rating.toFixed(1)}</span>` : ''}
      </div>` : ''}
    </article>
  `;
}

function driverHistoryEntryHtml(entry, index) {
  const pickup    = escapeHtml(entry?.route?.pickupLabel  || '—');
  const dropoff   = escapeHtml(entry?.route?.dropoffLabel || '—');
  const passenger = escapeHtml(entry?.passenger?.name || 'Пассажир');
  const receipt   = driverEntryReceipt(entry);
  // BD-RIDE-HISTORY-D-01 — completed row reads the persisted receipt: route,
  // completedAt, payment mode, breakdown preview (fare / commission / tip) and
  // net all format stored values only. Falls back to the legacy fields for
  // older records without a receipt.
  const fare       = receipt ? formatHistoryFare(receipt.fare) : formatHistoryFare(entry?.fare);
  const commission = receipt ? formatHistoryFare(receipt.commission) : '';
  const tip        = receipt ? formatHistoryFare(receipt.tip) : '';
  const net        = formatHistoryFare(driverEntryNetValue(entry));
  const payLabel   = receipt ? receiptPaymentModeLabel(receipt.paymentMode) : '';
  const when       = formatHistoryDate(historyEntryTimestamp(entry));
  return `
    <article class="bd-card-tight profile-history__card profile-history__card--clickable" role="button" tabindex="0" data-history-index="${index}" aria-haspopup="dialog">
      <div class="profile-history__head">
        ${historyRoleBadgeHtml('driver')}
        ${payLabel ? `<span class="bd-badge profile-history__pay">${escapeHtml(payLabel)}</span>` : ''}
        ${when ? `<span class="profile-history__when profile-history__when--head">${escapeHtml(when)}</span>` : ''}
      </div>
      <p class="profile-history__route">
        <span class="profile-history__route-from">${pickup}</span>
        <span class="profile-history__route-arrow" aria-hidden="true">→</span>
        <span class="profile-history__route-to">${dropoff}</span>
      </p>
      <div class="profile-history__meta">
        <span class="profile-history__meta-label">Пассажир</span>
        <span class="profile-history__meta-value">${passenger}</span>
      </div>
      ${fare ? `
      <div class="profile-history__meta">
        <span class="profile-history__meta-label">Стоимость</span>
        <span class="profile-history__meta-value">${escapeHtml(fare)}</span>
      </div>` : ''}
      ${commission ? `
      <div class="profile-history__meta">
        <span class="profile-history__meta-label">Комиссия</span>
        <span class="profile-history__meta-value">${escapeHtml(commission)}</span>
      </div>` : ''}
      ${tip ? `
      <div class="profile-history__meta">
        <span class="profile-history__meta-label">Чаевые</span>
        <span class="profile-history__meta-value">+${escapeHtml(tip)}</span>
      </div>` : ''}
      ${net ? `
      <div class="profile-history__meta profile-history__meta--accent">
        <span class="profile-history__meta-label">Доход</span>
        <span class="profile-history__meta-value">${escapeHtml(net)}</span>
      </div>` : ''}
    </article>
  `;
}

function historyEntryHtml(entry, index) {
  return entry?.role === 'driver'
    ? driverHistoryEntryHtml(entry, index)
    : passengerHistoryEntryHtml(entry, index);
}

// BD-RIDE-HISTORY-03 — defensive per-entry render. A single broken entry
// inside the list must not poison the whole section: invalid roles are
// already filtered out upstream, this wrapper additionally swallows any
// throw from the inner HTML builders so the surviving entries still render.
function safeHistoryEntryHtml(entry, index) {
  try {
    const html = historyEntryHtml(entry, index);
    return typeof html === 'string' && html.trim() ? html : '';
  } catch {
    return '';
  }
}

function historyHeaderHtml(count) {
  return `
    <div class="profile-history__header">
      <p class="pfp-section-title profile-history__title">История поездок</p>
      ${count > 0 ? `<span class="bd-badge profile-history__count">${escapeHtml(String(count))}</span>` : ''}
    </div>`;
}

function historyEmptyBodyHtml() {
  return `
      <div class="bd-card profile-history__empty">
        <p class="profile-history__empty-title">Истории пока нет</p>
        <p class="profile-history__empty-text">Завершённые поездки появятся здесь после первой поездки.</p>
        <div class="profile-history__empty-actions">
          <button type="button" class="bd-btn primary profile-history__empty-btn" id="profile-history-empty-new">Создать поездку</button>
          <button type="button" class="bd-btn profile-history__empty-btn" id="profile-history-empty-feed">В ленту</button>
        </div>
      </div>`;
}

function historyErrorBodyHtml() {
  return `
      <div class="bd-card profile-history__error" role="alert">
        <p class="profile-history__error-title">Историю не удалось прочитать</p>
        <p class="profile-history__error-text">Можно очистить локальную историю и продолжить пользоваться приложением.</p>
        <div class="profile-history__error-actions">
          <button type="button" class="bd-btn danger profile-history__error-btn" id="profile-history-error-clear">Очистить локальную историю</button>
        </div>
      </div>`;
}

function historySectionHtml() {
  let status = 'empty';
  let rawEntries = [];
  try {
    const result = readRideHistoryStatus();
    status = result.status;
    rawEntries = Array.isArray(result.entries) ? result.entries : [];
  } catch {
    status = 'malformed';
    rawEntries = [];
  }

  // Malformed storage: surface the friendly error card; do not attempt to
  // render any rows even if some entries happened to slip through.
  if (status === 'malformed') {
    lastHistoryEntries = [];
    return `<section class="profile-history" id="profile-history-section">
      ${historyHeaderHtml(0)}
      ${historyErrorBodyHtml()}
    </section>`;
  }

  const entries = rawEntries.filter(
    (e) => e && (e.role === 'passenger' || e.role === 'driver')
  );
  const sorted = sortHistoryEntriesDesc(entries);
  lastHistoryEntries = sorted;

  if (sorted.length === 0) {
    return `<section class="profile-history" id="profile-history-section">
      ${historyHeaderHtml(0)}
      ${historyEmptyBodyHtml()}
    </section>`;
  }

  // Latest entry as a single summary card. Index 0 maps into
  // lastHistoryEntries so the existing detail-receipt wiring keeps working.
  // If the newest entry is broken enough that safeHistoryEntryHtml swallows
  // it, hide the "Последняя поездка" block entirely instead of rendering an
  // empty title — the calendar below still surfaces every dated record.
  const latestCard = safeHistoryEntryHtml(sorted[0], 0);
  const latestBlock = latestCard
    ? `<p class="pfp-section-title profile-history__latest-title">Последняя поездка</p>
    <div class="profile-history__latest">${latestCard}</div>`
    : '';

  // Calendar is built from entries that resolve to a local date; records
  // without a parseable completedAt are silently skipped so they cannot
  // crash the profile, but they still live in lastHistoryEntries (so the
  // latest-card slot above can surface them when they happen to be newest
  // by savedAt).
  const state = ensureHistoryCalendarState();
  const byDate = groupRidesByDate(sorted);
  const calendarHtml = renderRideHistoryCalendar(state, byDate);
  const selectedHtml = renderSelectedDayRides(state, byDate, sorted);

  return `<section class="profile-history" id="profile-history-section">
    ${latestBlock}
    ${historyHeaderHtml(sorted.length)}
    ${calendarHtml}
    ${selectedHtml}
  </section>`;
}

// BD-RIDE-HISTORY-03 — Wire empty-state CTAs and the malformed-storage
// recovery action. The "Очистить локальную историю" button uses a two-step
// confirmation (mirrors the logout pattern) so a single misclick cannot wipe
// data; first press flips the label, second press calls clearRideHistory()
// and re-renders the section in place.
function replaceHistorySection(root) {
  const current = root.querySelector('#profile-history-section');
  if (!current) return false;
  const wrap = document.createElement('div');
  wrap.innerHTML = historySectionHtml();
  const next = wrap.firstElementChild;
  if (!next) return false;
  current.replaceWith(next);
  wireHistorySection(root);
  return true;
}

function wireHistorySection(root) {
  // BD-ROLE-05 — same effective-role routing as wireMyPostsSection so the
  // empty-history "Создать поездку" CTA respects the tab's smoke role.
  root.querySelector('#profile-history-empty-new')?.addEventListener('click', () => go(createIntentRoute(applySmokeRole(user.get()))));
  root.querySelector('#profile-history-empty-feed')?.addEventListener('click', () => go('/feed'));

  // BD-RIDE-HISTORY-04/08 — section-level delegation handles three concerns:
  // (1) clicking a history card opens its detail receipt; (2) calendar day
  // and month nav buttons mutate historyCalendarState and re-render in place;
  // (3) "Все поездки за день" expands the selected-day list. Cards are <article
  // role="button"> so the native Enter/Space contract is reproduced too.
  const section = root.querySelector('#profile-history-section');
  if (!section) return;

  const openCardDetail = (card) => {
    const index = Number(card.dataset.historyIndex);
    const entry = Number.isInteger(index) ? lastHistoryEntries[index] : null;
    if (entry) openHistoryDetail(root, entry);
  };

  section.addEventListener('click', (e) => {
    const dayBtn = e.target.closest('[data-cal-day]');
    if (dayBtn) {
      const state = ensureHistoryCalendarState();
      state.selectedKey = dayBtn.dataset.calDay;
      state.showAll = false;
      replaceHistorySection(root);
      return;
    }
    const actionBtn = e.target.closest('[data-cal-action]');
    if (actionBtn) {
      const action = actionBtn.dataset.calAction;
      const state = ensureHistoryCalendarState();
      if (action === 'prev-month' || action === 'next-month') {
        let y = state.year;
        let m = state.month + (action === 'next-month' ? 1 : -1);
        if (m < 0)  { m = 11; y -= 1; }
        if (m > 11) { m = 0;  y += 1; }
        state.year  = y;
        state.month = m;
        state.selectedKey = getLocalDateKey(new Date(y, m, 1));
        state.showAll = false;
        replaceHistorySection(root);
        return;
      }
      if (action === 'show-all') {
        state.showAll = true;
        replaceHistorySection(root);
        return;
      }
    }
    const card = e.target.closest('[data-history-index]');
    if (card) openCardDetail(card);
  });

  section.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const card = e.target.closest('[data-history-index]');
    if (!card) return;
    // Only intercept space when the focus is actually on a history card —
    // calendar day buttons handle their own activation natively.
    if (e.key !== 'Enter') e.preventDefault();
    openCardDetail(card);
  });

  const clearBtn = root.querySelector('#profile-history-error-clear');
  clearBtn?.addEventListener('click', () => {
    if (clearBtn.dataset.confirm === 'pending') {
      clearRideHistory();
      if (replaceHistorySection(root)) return;
      clearBtn.disabled = true;
      clearBtn.textContent = 'История очищена';
    } else {
      clearBtn.dataset.confirm = 'pending';
      clearBtn.textContent = 'Нажмите ещё раз для подтверждения';
    }
  });
}

// ── Ride history detail receipt (BD-RIDE-HISTORY-04) ──────────────────────────
// A read-only, role-aware receipt for a single saved ride, surfaced as a
// bottom-sheet overlay inside the Profile screen (no new route). Mock-only —
// it renders whatever the stored entry carries and silently omits any missing
// or malformed field, so a partial record can never break the profile.

function formatHistoryDistance(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) return `${value} км`;
  return String(value);
}

function formatHistoryDuration(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) return `${value} мин`;
  return String(value);
}

// Builds one label/value row, returning '' when the value is empty so the
// caller can simply join the list without sprinkling conditionals.
function detailRowHtml(label, value, accent = false) {
  const text = (value == null) ? '' : String(value).trim();
  if (!text) return '';
  const cls = accent
    ? 'profile-history-detail__row profile-history-detail__row--accent'
    : 'profile-history-detail__row';
  return `
      <div class="${cls}">
        <span class="profile-history-detail__row-label">${escapeHtml(label)}</span>
        <span class="profile-history-detail__row-value">${escapeHtml(text)}</span>
      </div>`;
}

function passengerDetailRowsHtml(entry) {
  const driver   = entry?.driver?.name || 'Водитель';
  const vehicle  = historyVehicleText(entry?.vehicle || {});
  const fare     = formatHistoryFare(entry?.fare);
  const rating   = (typeof entry?.rating === 'number' && entry.rating > 0)
    ? entry.rating.toFixed(1) : '';
  const comment  = (typeof entry?.comment === 'string') ? entry.comment.trim() : '';
  const distance = formatHistoryDistance(entry?.distance);
  const duration = formatHistoryDuration(entry?.duration);
  const when     = formatHistoryDate(historyEntryTimestamp(entry));
  return [
    detailRowHtml('Водитель', driver),
    detailRowHtml('Автомобиль', vehicle),
    detailRowHtml('Стоимость', fare, true),
    detailRowHtml('Оценка', rating),
    detailRowHtml('Расстояние', distance),
    detailRowHtml('Время в пути', duration),
    detailRowHtml('Завершено', when),
  ].join('') + (comment ? `
      <div class="profile-history-detail__comment">
        <span class="profile-history-detail__row-label">Комментарий</span>
        <p class="profile-history-detail__comment-text">${escapeHtml(comment)}</p>
      </div>` : '');
}

function driverDetailRowsHtml(entry) {
  const passenger  = entry?.passenger?.name || 'Пассажир';
  const receipt    = driverEntryReceipt(entry);
  // BD-RIDE-HISTORY-D-01 — the detail receipt reads the persisted receipt
  // object verbatim (fare / commission / tip / net / paymentMode); it never
  // recalculates. Legacy entries without a receipt keep the prior fields.
  const fare       = receipt ? formatHistoryFare(receipt.fare) : formatHistoryFare(entry?.fare);
  const commission = receipt ? formatHistoryFare(receipt.commission) : '';
  const tip        = receipt ? formatHistoryFare(receipt.tip) : '';
  const net        = formatHistoryFare(driverEntryNetValue(entry));
  const payLabel   = receipt ? receiptPaymentModeLabel(receipt.paymentMode) : '';
  const distance   = formatHistoryDistance(entry?.distance);
  const duration   = formatHistoryDuration(entry?.duration);
  const when       = formatHistoryDate(historyEntryTimestamp(entry));
  return [
    detailRowHtml('Пассажир', passenger),
    detailRowHtml('Способ оплаты', payLabel),
    detailRowHtml('Стоимость поездки', fare),
    detailRowHtml('Комиссия сервиса', commission),
    detailRowHtml('Чаевые', tip ? `+${tip}` : ''),
    detailRowHtml('Доход', net, true),
    detailRowHtml('Расстояние', distance),
    detailRowHtml('Время в пути', duration),
    detailRowHtml('Завершено', when),
  ].join('');
}

function historyDetailHtml(entry) {
  const isDriver = entry?.role === 'driver';
  const pickup   = escapeHtml(entry?.route?.pickupLabel  || '—');
  const dropoff  = escapeHtml(entry?.route?.dropoffLabel || '—');
  const title    = isDriver ? 'Чек водителя' : 'Чек пассажира';
  const rows     = isDriver ? driverDetailRowsHtml(entry) : passengerDetailRowsHtml(entry);
  // BD-RIDE-HISTORY-05 — only offer "Повторить маршрут" when the entry yields
  // a usable pickup+dropoff pair. buildRepeatRouteDraft() is the single source
  // of truth for "usable route", so a malformed/partial route hides the button
  // instead of dropping the user onto an empty composer.
  const canRepeat = !!buildRepeatRouteDraft(entry);
  return `
    <div class="profile-history-detail" id="profile-history-detail" role="dialog" aria-modal="true" aria-labelledby="profile-history-detail-title">
      <div class="profile-history-detail__backdrop" data-detail-action="close"></div>
      <div class="profile-history-detail__sheet" role="document">
        <span class="profile-history-detail__handle" aria-hidden="true"></span>
        <div class="profile-history-detail__header">
          <div class="profile-history-detail__heading">
            ${historyRoleBadgeHtml(isDriver ? 'driver' : 'passenger')}
            <p class="profile-history-detail__title" id="profile-history-detail-title">${title}</p>
          </div>
          <button type="button" class="profile-history-detail__close" data-detail-action="close" aria-label="Закрыть">✕</button>
        </div>
        <p class="profile-history-detail__route">
          <span class="profile-history-detail__route-from">${pickup}</span>
          <span class="profile-history-detail__route-arrow" aria-hidden="true">→</span>
          <span class="profile-history-detail__route-to">${dropoff}</span>
        </p>
        <div class="profile-history-detail__rows">${rows}
        </div>
        <div class="profile-history-detail__actions">
          ${canRepeat ? `<button type="button" class="bd-btn primary profile-history-detail__action" data-detail-action="repeat">Повторить маршрут</button>` : ''}
          <button type="button" class="bd-btn profile-history-detail__action" data-detail-action="feed">В ленту</button>
          <button type="button" class="bd-btn profile-history-detail__action" data-detail-action="close">Назад к истории</button>
        </div>
        <p class="profile-history-detail__note">${canRepeat
          ? 'Прототип: повтор перенесёт только маршрут в создание новой заявки — без водителя, оплаты и оценки.'
          : 'Прототип: маршрут сохранён локально.'}</p>
      </div>
    </div>`;
}

let activeHistoryDetailEsc = null;

function closeHistoryDetail(root) {
  if (activeHistoryDetailEsc) {
    document.removeEventListener('keydown', activeHistoryDetailEsc);
    activeHistoryDetailEsc = null;
  }
  root.querySelector('#profile-history-detail')?.remove();
}

function openHistoryDetail(root, entry) {
  closeHistoryDetail(root);
  let markup = '';
  try {
    markup = historyDetailHtml(entry);
  } catch {
    return;
  }
  const wrap = document.createElement('div');
  wrap.innerHTML = markup;
  const overlay = wrap.firstElementChild;
  if (!overlay) return;
  root.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-detail-action]');
    if (!trigger) return;
    const action = trigger.dataset.detailAction;
    closeHistoryDetail(root);
    if (action === 'repeat') {
      // BD-RIDE-HISTORY-05 — write a sanitized, route-only one-time draft, then
      // open the composer. This is prefill only: no order is created here, and
      // the composer reads (and removes) the draft on /new. writeRepeatRoute-
      // Draft re-validates the entry, so an unusable route is a silent no-op
      // and /new simply opens empty.
      writeRepeatRouteDraft(entry);
      go('/new');
    } else if (action === 'feed') go('/feed');
  });

  activeHistoryDetailEsc = (e) => {
    if (e.key === 'Escape') closeHistoryDetail(root);
  };
  document.addEventListener('keydown', activeHistoryDetailEsc);

  overlay.querySelector('.profile-history-detail__close')?.focus();
}

// ── Documents pane (BD-PROFILE-DOCS-01) ──────────────────────────────────────
// Documents are rendered from user.get().driverDocuments. taxiPermit and
// documentsReady are derived in state.js from the same source, so the
// Overview readiness checklist cannot drift from this tab.

const DOC_META = {
  driverLicense: { title: 'Водительское удостоверение',     sub: '99 12 345678',          iconColor: 'success' },
  taxiOsago:     { title: 'ОСАГО для такси',                sub: 'ХХХ 0123456789',        iconColor: 'info'    },
  taxiRegistry:  { title: 'Разрешение / реестр такси',      sub: '№ 77-456789',           iconColor: 'danger'  },
  waybill:       { title: 'Путевой лист',                   sub: 'Электронный, на смену', iconColor: 'warning' },
  medicalCheck:  { title: 'Медосмотр',                      sub: 'Предрейсовый, 24 ч',    iconColor: 'warning' },
};

// ── Payouts mock data ─────────────────────────────────────────────────────────

const MOCK_PAYOUT_SUMMARY = {
  available:     18420,
  weekEarned:    21580,
  commissionPct: 12,
  commissionAmt: 2590,
  acquiringPct:  1.5,
  acquiringAmt:  324,
  weekPayout:    18666,
};

const MOCK_PAYOUT_METHODS = [
  { id: 'card-4821', bank: 'Сбербанк', last4: '4821', isDefault: true },
];

const MOCK_PAYOUT_HISTORY = [
  { id: 'ph-1', last4: '4821', date: '24.04', time: '22:10', amount: 12000, status: 'credited' },
  { id: 'ph-2', last4: '4821', date: '17.04', time: '21:48', amount: 15200, status: 'credited' },
  { id: 'ph-3', last4: '4821', date: '10.04', time: '20:02', amount:  9800, status: 'pending'  },
  { id: 'ph-4', last4: '4821', date: '03.04', time: '19:30', amount: 14400, status: 'credited' },
];

const MOCK_TAX_ITEMS = [
  {
    id:        'npd-apr',
    type:      'npd',
    title:     'Налог НПД за апрель',
    deadline:  'До 25 мая',
    rateLabel: 'самозанятость 4%',
    amount:    4280,
    action:    'Оплатить через «Мой налог»',
  },
  {
    id:        'usn-q2',
    type:      'usn',
    title:     'Налог УСН · аванс за II квартал',
    deadline:  'До 28 июля',
    rateLabel: '~6% от дохода',
    amount:    null,
    action:    null,
  },
];

function pluralDoc(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'документ';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'документа';
  return 'документов';
}

// BD-PROFILE-D-03 — readiness card labels. The Documents tab is a readiness
// surface, so each card states its readiness in three words shared with the
// Cloud Design render gate:
//   Проверено      — uploaded / verified (state F)
//   На проверке    — under review (state E · documents pending)
//   Нужно обновить — expired or never added (state C · checklist missing docs)
function docStatusBadgeHtml(status) {
  if (status === 'uploaded')        return `<span class="bd-badge success">${SVG_CHECK_SM} Проверено</span>`;
  if (status === 'review_required') return `<span class="bd-badge info">${SVG_CLOCK_SM} На проверке</span>`;
  if (status === 'expired')         return `<span class="bd-badge danger">${SVG_WARN_TRI} Нужно обновить</span>`;
  if (status === 'missing')         return `<span class="bd-badge warning">${SVG_UPLOAD_SM} Нужно обновить</span>`;
  if (status === 'draft')           return `<span class="bd-badge">${SVG_CLOCK_SM} Черновик</span>`;
  return '';
}

function docMetaText(key, status) {
  if (key === 'driverLicense' && status === 'uploaded')        return 'до 2031';
  if (key === 'taxiOsago'     && status === 'review_required') return 'до 14.08.2026';
  if (key === 'taxiOsago'     && status === 'uploaded')        return 'до 14.08.2026';
  if (key === 'taxiRegistry'  && status === 'expired')         return 'истекло 12.04.2026';
  if (key === 'taxiRegistry'  && status === 'uploaded')        return 'разрешение действует';
  return '';
}

function docActionLabel(key, status) {
  if (status === 'uploaded') return null;
  if (key === 'taxiRegistry')                          return 'Обновить';
  if (key === 'waybill' || key === 'medicalCheck')     return 'Загрузить';
  if (key === 'taxiOsago')                             return 'Подробнее';
  return null;
}

function docPanelHtml(key, status) {
  if (key === 'taxiRegistry' && status !== 'uploaded') {
    return `
      <div class="pf2-doc-panel" id="pf2-doc-panel-taxiRegistry" data-doc-panel="taxiRegistry" hidden aria-labelledby="pf2-doc-panel-taxiRegistry-title">
        <div class="pf2-doc-panel__head">
          <p class="pf2-doc-panel__title" id="pf2-doc-panel-taxiRegistry-title">Обновить разрешение такси</p>
          <button type="button" class="pf2-doc-panel__close" data-doc-close="taxiRegistry" aria-label="Закрыть">✕</button>
        </div>
        <label class="pf2-doc-field">
          <span class="pf2-doc-field__label">Номер</span>
          <input type="text" class="pf2-doc-input" data-doc-input="taxiRegistry-number" autocomplete="off" inputmode="text">
        </label>
        <label class="pf2-doc-field">
          <span class="pf2-doc-field__label">Действует до</span>
          <input type="date" class="pf2-doc-input" data-doc-input="taxiRegistry-expiry">
        </label>
        <p class="pf2-doc-hint">Demo-режим: данные не отправляются на сервер.</p>
        <button type="button" class="bd-btn primary pf2-doc-panel-cta" data-doc-mark="taxiRegistry">Отметить обновлённым</button>
      </div>`;
  }
  if ((key === 'waybill' || key === 'medicalCheck') && status !== 'uploaded') {
    const title = key === 'waybill' ? 'Загрузить путевой лист' : 'Загрузить медосмотр';
    return `
      <div class="pf2-doc-panel" id="pf2-doc-panel-${escapeHtml(key)}" data-doc-panel="${escapeHtml(key)}" hidden aria-labelledby="pf2-doc-panel-${escapeHtml(key)}-title">
        <div class="pf2-doc-panel__head">
          <p class="pf2-doc-panel__title" id="pf2-doc-panel-${escapeHtml(key)}-title">${escapeHtml(title)}</p>
          <button type="button" class="pf2-doc-panel__close" data-doc-close="${escapeHtml(key)}" aria-label="Закрыть">✕</button>
        </div>
        <div class="pf2-doc-upload">
          <div class="pf2-doc-upload__icon" aria-hidden="true">${SVG_UPLOAD_SM}</div>
          <div class="pf2-doc-upload__text">
            <p class="pf2-doc-upload__title">Перетащите файл или нажмите кнопку</p>
            <p class="pf2-doc-upload__sub">Загрузка файлов появится в следующей версии</p>
          </div>
        </div>
        <button type="button" class="bd-btn primary pf2-doc-panel-cta" data-doc-mark="${escapeHtml(key)}">Отметить загруженным</button>
      </div>`;
  }
  if (key === 'taxiOsago' && status === 'review_required') {
    return `
      <div class="pf2-doc-panel pf2-doc-panel--review" id="pf2-doc-panel-taxiOsago" data-doc-panel="taxiOsago" hidden aria-labelledby="pf2-doc-panel-taxiOsago-title">
        <div class="pf2-doc-panel__head">
          <p class="pf2-doc-panel__title" id="pf2-doc-panel-taxiOsago-title">ОСАГО для такси — проверка</p>
          <button type="button" class="pf2-doc-panel__close" data-doc-close="taxiOsago" aria-label="Закрыть">✕</button>
        </div>
        <p class="pf2-doc-review">Документ ожидает проверки оператором. Demo-flow не блокирует — после проверки статус обновится автоматически.</p>
      </div>`;
  }
  return '';
}

function docCardHtml(key, doc) {
  const meta   = DOC_META[key];
  const status = doc?.status || 'missing';
  const metaText = docMetaText(key, status);
  const action   = docActionLabel(key, status);
  const metaHtml   = metaText ? `<p class="pf2-doc-meta">${escapeHtml(metaText)}</p>` : '';
  const actionHtml = action
    ? `<button type="button" class="bd-btn primary pf2-doc-action" data-doc-action="${escapeHtml(key)}">${escapeHtml(action)}</button>`
    : '';
  return `
    <div class="pf2-doc-card" data-doc-key="${escapeHtml(key)}">
      <div class="pf2-doc-header">
        <div class="pf2-doc-icon pf2-doc-icon--${meta.iconColor}" aria-hidden="true">${SVG_DOC_LG}</div>
        <div class="pf2-doc-info">
          <p class="pf2-doc-title">${escapeHtml(meta.title)}</p>
          <p class="pf2-doc-sub">${escapeHtml(meta.sub)}</p>
        </div>
        <div class="pf2-doc-status">${docStatusBadgeHtml(status)}</div>
      </div>
      ${metaHtml}${actionHtml}
    </div>
    ${docPanelHtml(key, status)}`;
}

function docsPaneHtml(u) {
  const docs = u.driverDocuments || {};
  // Blocking docs prevent going online; review-only is soft / informational.
  // Splitting the two avoids saying "Без них вы не сможете выйти на линию"
  // when only review_required documents remain — which is actually allowed
  // by computeDocumentsReady.
  const blocking = documentsAttentionCount(docs);
  const review   = documentsReviewCount(docs);
  let alert = '';
  if (blocking > 0) {
    alert = `
    <div class="bd-alert warning pf2-doc-warn" role="alert">
      <span class="pf2-doc-warn-icon" aria-hidden="true">${SVG_WARN_TRI}</span>
      <div class="pf2-doc-warn-body">
        <p class="pf2-doc-warn-title">${blocking} ${pluralDoc(blocking)} требуют внимания</p>
        <p class="pf2-doc-warn-sub">Без них вы не сможете выйти на линию</p>
      </div>
    </div>`;
  } else if (review > 0) {
    alert = `
    <div class="bd-alert info pf2-doc-warn pf2-doc-warn--review" role="status">
      <span class="pf2-doc-warn-icon" aria-hidden="true">${SVG_CLOCK_SM}</span>
      <div class="pf2-doc-warn-body">
        <p class="pf2-doc-warn-title">${review} ${pluralDoc(review)} на проверке</p>
        <p class="pf2-doc-warn-sub">Можно выходить на линию — проверка не блокирует demo</p>
      </div>
    </div>`;
  }
  const cards = REQUIRED_DOCS
    .map((key) => docCardHtml(key, docs[key] || { status: 'missing' }))
    .join('');
  return `
    ${alert}
    ${cards}
    <button type="button" class="pf2-doc-add-btn" id="pf2-doc-add">
      ${SVG_PLUS} Добавить документ
    </button>`;
}

// ── Taxi / IP pane (BD-PROFILE-02 + BD-PROFILE-TAXI-01) ──────────────────────

function taxiReadinessListHtml(reasons) {
  const rows = reasons.map((r) => {
    const cls = `pf2-ip-check-row pf2-ip-check-row--${r.severity}`;
    const label = `<span class="pf2-ip-check-label">${escapeHtml(r.label)}</span>`;
    const text  = `<span class="pf2-ip-check-text">${escapeHtml(r.text)}</span>`;
    const dot   = `<span class="pf2-ip-check-dot" aria-hidden="true"></span>`;
    if (r.action) {
      return `
      <button type="button" class="${cls} pf2-ip-check-row--action" data-readiness-action="${escapeHtml(r.action)}">
        ${dot}${label}${text}
        <span class="pf2-ip-check-chev" aria-hidden="true">${SVG_CHEVRON}</span>
      </button>`;
    }
    return `
      <div class="${cls}">
        ${dot}${label}${text}
      </div>`;
  }).join('');
  return `
    <div class="pf2-ip-checklist">
      <p class="pf2-ip-checklist-title">Готовность к линии</p>
      <div class="pf2-ip-checklist-rows">${rows}
      </div>
    </div>`;
}

function ipPaneHtml(u) {
  const reasons   = getTaxiReadinessReasons(u);
  const state     = getTaxiReadinessState(u);
  const title     = getTaxiStatusTitle(state);
  const sub       = getTaxiStatusSub(u, state);
  const isBlocked = state === 'blocked';
  const isOnline  = state === 'online';

  // Toggle is only visually ON when the driver is actually online (i.e. ready
  // checks pass AND driverOnline=true). In any other state we render unchecked
  // so the UI cannot show a stale green ON.
  const toggleChecked = isOnline ? ' checked' : '';
  // Mark blocked state via aria-disabled — input stays focusable so a click
  // can be intercepted and routed to the readiness checklist.
  const toggleDisabled = isBlocked ? ' aria-disabled="true"' : '';

  // "Выйти на линию" CTA: disabled in blocked, label flips to "Завершить смену"
  // when online so the action stays meaningful in that state.
  const goLabel = isBlocked
    ? 'Недоступно: нужна готовность'
    : (isOnline ? 'Завершить смену' : 'Выйти на линию');
  const goDisabled = isBlocked ? ' disabled' : '';

  return `
    <div class="pf2-status-card pf2-ip-scard" data-state="${state}" id="pf2-ip-status-card">
      <div class="pf2-ip-scard-top">
        <div class="pf2-ip-scard-lbl-row">
          <span class="pf2-ip-scard-dot" aria-hidden="true"></span>
          <span class="pf2-ip-driver-lbl">СТАТУС ВОДИТЕЛЯ</span>
        </div>
        <label class="pf2-toggle pf2-ip-toggle" aria-label="Статус водителя">
          <input type="checkbox" id="pf2-ip-online-toggle"${toggleChecked}${toggleDisabled}>
          <span class="pf2-toggle__track"></span>
        </label>
      </div>
      <div class="pf2-ip-scard-body">
        <p class="pf2-ip-scard-title" id="pf2-ip-scard-title">${escapeHtml(title)}</p>
        <p class="pf2-ip-scard-sub" id="pf2-ip-scard-sub">${escapeHtml(sub)}</p>
      </div>
      ${taxiReadinessListHtml(reasons)}
      ${isBlocked ? `<button type="button" class="pf2-action-cta pf2-ip-action-cta" id="pf2-ip-goto-actions">Перейти к действиям</button>` : ''}
    </div>

    <div class="bd-card pf2-ip-shift-card">
      <p class="pf2-ip-shift-title">Управление сменой</p>
      <button type="button" class="bd-btn primary pf2-ip-go-btn" id="pf2-ip-go-online"${goDisabled}>
        ${SVG_CAR_FRONT} ${escapeHtml(goLabel)}
      </button>
      ${goDisabled ? `<p class="pf2-ip-go-reason" id="pf2-ip-go-reason">${escapeHtml(sub)}</p>` : ''}
      <div class="pf2-ip-shift-row">
        <button type="button" class="bd-btn pf2-ip-shift-sm" id="pf2-ip-open-shift">
          ${SVG_CLOCK_SM} Открыть смену
        </button>
        <button type="button" class="bd-btn pf2-ip-shift-sm" id="pf2-ip-check-ready">
          ${SVG_CHECK_SM} Проверить готовность
        </button>
      </div>
      <div class="bd-alert warning pf2-ip-permit-warn" id="pf2-ip-permit-warn" role="status" hidden>
        <span class="pf2-ip-warn-icon" aria-hidden="true">${SVG_WARN_TRI}</span>
        <div class="pf2-ip-warn-text">
          <p class="pf2-ip-warn-title">Разрешение такси не добавлено</p>
          <p class="pf2-ip-warn-body">Это пункт готовности к смене. MVP не блокирует выход на линию — но в проде разрешение обязательно.</p>
        </div>
      </div>
    </div>

    <p class="pf2-ip-sect-title">Статус самозанятого</p>
    <div class="bd-card pf2-ip-se-card">
      <div class="pf2-ip-card-hd">
        <span class="bd-badge success pf2-ip-badge-dot">Активен</span>
        <span class="pf2-ip-card-date">с 12.03.2023</span>
      </div>
      <p class="pf2-ip-inn">ИНН 770312345678</p>
      <p class="pf2-ip-card-sub">Привязан через ФНС «Мой налог»</p>
      <div class="pf2-ip-income-bar" data-pct="34">
        <div class="pf2-ip-income-fill"></div>
      </div>
      <div class="pf2-ip-income-row">
        <span class="pf2-ip-income-label">Лимит дохода в год</span>
        <span class="pf2-ip-income-val">816 200 ₽ / 2,4 млн</span>
      </div>
    </div>

    <p class="pf2-ip-sect-title">Разрешение / реестр такси</p>
    <div class="bd-card pf2-ip-permit-card">
      <div class="pf2-ip-card-hd">
        <span class="bd-badge warning pf2-ip-badge-dot">Истекает</span>
        <span class="pf2-ip-card-date">через 47 дней</span>
      </div>
      <p class="pf2-ip-inn">№ 77-456789</p>
      <p class="pf2-ip-card-sub">Действует до 12.06.2026 · реестр Москвы</p>
      <button type="button" class="bd-btn pf2-ip-permit-btn">Продлить разрешение</button>
    </div>

    <p class="pf2-ip-sect-title">Парк / агрегатор</p>
    <div class="bd-card pf2-ip-park-card">
      <button type="button" class="pf2-ip-park-row pf2-ip-park-row--sel" id="pf2-ip-park-indep">
        <span class="pf2-ip-park-icon" aria-hidden="true">${SVG_CAR_FRONT}</span>
        <span class="pf2-ip-park-info">
          <span class="pf2-ip-park-name">Самостоятельно</span>
          <span class="pf2-ip-park-sub">Без привязки к парку</span>
        </span>
        <span class="pf2-ip-park-end" aria-hidden="true">${SVG_CHECK_SM}</span>
      </button>
      <div class="pf2-ip-park-sep" aria-hidden="true"></div>
      <button type="button" class="pf2-ip-park-row" id="pf2-ip-park-fleet">
        <span class="pf2-ip-park-icon" aria-hidden="true">${SVG_TAG_ICON}</span>
        <span class="pf2-ip-park-info">
          <span class="pf2-ip-park-name">Подключить парк</span>
          <span class="pf2-ip-park-sub">Доступ к большему числу заказов</span>
        </span>
        <span class="pf2-ip-park-end" aria-hidden="true">${SVG_CHEVRON}</span>
      </button>
    </div>`;
}

// ── Payouts pane (BD-PROFILE-02) ─────────────────────────────────────────────
// Supported states:
//   default          — normal populated view
//   empty-history    — MOCK_PAYOUT_HISTORY is empty → placeholder card
//   no-card          — MOCK_PAYOUT_METHODS is empty → add-card CTA only
//   processing-payout — handled via CSS class on Вывести button
//   report-generating — handled via CSS class on Сформировать отчёт button

// BD-RIDE-HISTORY-D-01 — Driver payouts: completed-ride rows sourced from the
// canonical receipt store. Each row shows net straight from receipt.net (no
// recalculation) and deep-links to the trip receipt at /receipt?tripId=…. The
// balance / weekly cards above stay demo/static.
function driverReceiptPayoutSectionHtml() {
  let receipts = [];
  try { receipts = listDriverReceipts(); } catch { receipts = []; }
  if (!Array.isArray(receipts) || !receipts.length) return '';
  const rows = receipts.map((r) => {
    const tripId  = String(r.tripId);
    const when    = formatHistoryDate(r.completedAt);
    const net     = formatHistoryFare(r.net);
    const badge   = receiptPaymentBadgeHtml(r.paymentMode);
    return `
      <button type="button" class="pf2-po-trip-row" data-receipt-trip="${escapeHtml(tripId)}">
        <span class="pf2-po-trip-icon" aria-hidden="true">${SVG_DOC_LG}</span>
        <span class="pf2-po-trip-info">
          <span class="pf2-po-trip-name">Поездка № ${escapeHtml(tripId)}</span>
          <span class="pf2-po-trip-meta">
            ${when ? `<span class="pf2-po-trip-sub">${escapeHtml(when)}</span>` : ''}
            ${badge}
          </span>
        </span>
        <span class="pf2-po-trip-right">
          <span class="pf2-po-trip-net">${escapeHtml(net)}</span>
          <span class="pf2-po-trip-chevron" aria-hidden="true">${SVG_CHEVRON}</span>
        </span>
      </button>`;
  }).join('');
  return `
    <div class="pf2-po-sect-hdr">
      <span class="pf2-po-sect-title">Завершённые поездки</span>
    </div>
    <div class="pf2-po-trips" id="pf2-po-trips-block">
      ${rows}
    </div>`;
}

// BD-PROFILE-D-03 — Empty payouts state (state H). Reachable through the
// render-gate preview URL /profile?role=driver&pane=payouts&state=empty. Calm,
// honest copy with a single forward action; no balance, no receipts, no
// history. Demo-only — it does not clear any persisted receipt store.
function payoutsEmptyPaneHtml() {
  return `
    <div class="pf2-po-balance-card pf2-po-balance-card--empty">
      <p class="pf2-po-balance-lbl">Доступно к выводу</p>
      <p class="pf2-po-balance-amount">0 ₽</p>
      <p class="pf2-po-balance-empty-note">Заработок появится после первых поездок</p>
    </div>
    <div class="pf2-po-empty">
      <span class="pf2-po-empty-icon" aria-hidden="true">${SVG_RUBLE_COIN}</span>
      <p class="pf2-po-empty-title">Выплат пока нет</p>
      <p class="pf2-po-empty-text">Завершите первую поездку — доход, чеки и выводы на карту появятся в этом разделе.</p>
      <button type="button" class="bd-btn primary pf2-po-empty-cta" id="pf2-po-empty-cta">Найти заказы</button>
    </div>`;
}

function payoutsPaneHtml(previewEmpty = false) {
  if (previewEmpty) return payoutsEmptyPaneHtml();
  const s          = MOCK_PAYOUT_SUMMARY;
  const hasMethods = MOCK_PAYOUT_METHODS.length > 0;
  const hasHistory = MOCK_PAYOUT_HISTORY.length > 0;

  // ── Methods section ──────────────────────────────────────
  const methodRows = MOCK_PAYOUT_METHODS.map((m) => `
      <button type="button" class="pf2-po-method-row">
        <span class="pf2-po-method-icon">${SVG_CREDIT_CARD_PO}</span>
        <span class="pf2-po-method-info">
          <span class="pf2-po-method-name">${escapeHtml(m.bank)}</span>
          <span class="pf2-po-method-sub">•• ${escapeHtml(m.last4)}${m.isDefault ? ' · по умолчанию' : ''}</span>
        </span>
        <span class="pf2-po-method-chevron" aria-hidden="true">${SVG_CHEVRON}</span>
      </button>`).join('');

  // no-card: "Добавить карту" row gets a subtitle hint when list is empty
  const addCardRow = `
      <button type="button" class="pf2-po-method-row" id="pf2-po-add-card-btn">
        <span class="pf2-po-method-icon pf2-po-method-icon--add">${SVG_PLUS}</span>
        <span class="pf2-po-method-info">
          <span class="pf2-po-method-name">Добавить карту</span>
          ${!hasMethods ? '<span class="pf2-po-method-sub">Добавьте карту для вывода средств</span>' : ''}
        </span>
        <span class="pf2-po-method-chevron" aria-hidden="true">${SVG_CHEVRON}</span>
      </button>`;

  // ── History section ──────────────────────────────────────
  const histItems = MOCK_PAYOUT_HISTORY.map((h) => {
    const badgeCls = h.status === 'credited' ? 'bd-badge success' : 'bd-badge';
    const badgeTxt = h.status === 'credited' ? 'Зачислено' : 'В обработке';
    return `
      <div class="pf2-po-hist-item">
        <span class="pf2-po-hist-icon">${SVG_CREDIT_CARD_PO}</span>
        <span class="pf2-po-hist-info">
          <span class="pf2-po-hist-name">Вывод на карту •• ${escapeHtml(h.last4)}</span>
          <span class="pf2-po-hist-date">${escapeHtml(h.date)} · ${escapeHtml(h.time)}</span>
        </span>
        <span class="pf2-po-hist-right">
          <span class="pf2-po-hist-amount">${fmtRub(h.amount)}</span>
          <span class="${badgeCls}">${badgeTxt}</span>
        </span>
      </div>`;
  }).join('');

  // empty-history placeholder
  const histContent = hasHistory
    ? histItems
    : `<div class="pf2-po-hist-empty">
         <p class="pf2-po-hist-empty-title">Выплат пока нет</p>
         <p class="pf2-po-hist-empty-sub">Здесь появятся выводы на карту</p>
       </div>`;

  // ── Tax cards ────────────────────────────────────────────
  const taxCards = MOCK_TAX_ITEMS.map((tax) => {
    const isNpd  = tax.type === 'npd';
    const icon   = isNpd
      ? `<span class="pf2-po-tax-icon">${SVG_RUBLE_COIN}</span>`
      : `<span class="pf2-po-tax-icon pf2-po-tax-icon--usn">${SVG_CALENDAR_PO}</span>`;
    const right  = isNpd
      ? `<span class="pf2-po-tax-amount">${fmtRub(tax.amount)}</span>`
      : `<span class="bd-badge">План</span>`;
    const payBtn = isNpd
      ? `<button type="button" class="bd-btn primary" id="pf2-po-tax-pay-${escapeHtml(tax.id)}">${escapeHtml(tax.action)}</button>`
      : '';
    return `
      <div class="pf2-po-tax-card${isNpd ? ' pf2-po-tax-card--npd' : ''}">
        <div class="pf2-po-tax-hd">
          ${icon}
          <div class="pf2-po-tax-info">
            <p class="pf2-po-tax-title">${escapeHtml(tax.title)}</p>
            <p class="pf2-po-tax-sub">${escapeHtml(tax.deadline)} · ${escapeHtml(tax.rateLabel)}</p>
          </div>
          ${right}
        </div>
        ${payBtn}
      </div>`;
  }).join('');

  return `
    <div class="pf2-po-balance-card">
      <p class="pf2-po-balance-lbl">Доступно к выводу</p>
      <p class="pf2-po-balance-amount">${fmtRub(s.available)}</p>
      <div class="pf2-po-balance-btns">
        <button type="button" class="pf2-po-balance-btn pf2-po-balance-btn--dark" id="pf2-po-withdraw-btn">Вывести</button>
        <button type="button" class="pf2-po-balance-btn pf2-po-balance-btn--sec" id="pf2-po-history-btn">История</button>
      </div>
    </div>
    <div class="pf2-po-weekly">
      <p class="pf2-po-weekly-title">Расчёт за неделю</p>
      <div class="pf2-po-weekly-row">
        <span class="pf2-po-weekly-label">Заработано</span>
        <span class="pf2-po-weekly-val">${fmtRub(s.weekEarned)}</span>
      </div>
      <div class="pf2-po-weekly-row">
        <span class="pf2-po-weekly-label">Комиссия BazarDrive · ${s.commissionPct}%</span>
        <span class="pf2-po-weekly-val pf2-po-weekly-val--neg">− ${fmtRub(s.commissionAmt)}</span>
      </div>
      <div class="pf2-po-weekly-row">
        <span class="pf2-po-weekly-label">Эквайринг · ${s.acquiringPct}%</span>
        <span class="pf2-po-weekly-val pf2-po-weekly-val--neg">− ${fmtRub(s.acquiringAmt)}</span>
      </div>
      <div class="pf2-po-weekly-sep" aria-hidden="true"></div>
      <div class="pf2-po-weekly-total-row">
        <span class="pf2-po-weekly-total-lbl">К выплате</span>
        <span class="pf2-po-weekly-total-val">${fmtRub(s.weekPayout)}</span>
      </div>
    </div>
    ${driverReceiptPayoutSectionHtml()}
    ${taxCards}
    <div class="pf2-po-sect-hdr">
      <span class="pf2-po-sect-title">Способы вывода</span>
      ${hasMethods ? '<button type="button" class="pf2-po-sect-action" id="pf2-po-methods-change">Изменить</button>' : ''}
    </div>
    <div class="pf2-po-methods" id="pf2-po-methods-block">
      ${methodRows}
      ${addCardRow}
    </div>
    <div class="pf2-po-sect-hdr">
      <span class="pf2-po-sect-title">История выплат</span>
      ${hasHistory ? '<button type="button" class="pf2-po-sect-action" id="pf2-po-hist-all-btn">Все</button>' : ''}
    </div>
    <div class="pf2-po-history" id="pf2-po-history-block">
      ${histContent}
    </div>
    <div class="pf2-po-report">
      <div class="pf2-po-report-hd">
        <span class="pf2-po-report-icon">${SVG_DOC_LG}</span>
        <span class="pf2-po-report-info">
          <span class="pf2-po-report-title">Отчёт о доходах</span>
          <span class="pf2-po-report-sub">PDF / Excel · для налоговой и банка</span>
        </span>
      </div>
      <button type="button" class="bd-btn primary" id="pf2-po-report-btn">Сформировать отчёт</button>
    </div>`;
}

// BD-PROFILE-D-05A — Driver Garage section. Derives the garage view from
// the legacy vehicle fields already living on the user record
// (vehicleMake / vehicleModel / vehicleColor / vehiclePlate; state.js:50-54)
// without forcing a data migration. Driver-only — renderPassenger never
// calls this helper. When the profile has no vehicle yet, an empty state
// invites the driver to add one. `?garage=empty` is a render-gate preview
// affordance that forces the empty state without wiping persisted data,
// mirroring the existing `?state=empty` payouts preview.
//
// BD-PROFILE-D-05B — Driver Garage action semantics. Each action carries
// a stable `data-garage-action` (the action's name) and `data-garage-state`
// (the contract state the action is currently in). The contract states
// after 05C are:
//   • add-ready              — "Добавить авто". Future onboarding entry
//                              point; current click is local feedback only.
//   • edit-ready             — "Редактировать". Future per-vehicle edit
//                              entry point; current click is local
//                              feedback only.
//   • active-current        — "Активна сейчас". Status pill (non-button)
//                              for the vehicle whose `status === 'active'`
//                              in the derived collection. Disabled by
//                              construction — never a click target.
//   • make-active-local     — "Сделать активной". 05C — per non-active
//                              vehicle. Click is local feedback only;
//                              the active flag is derived mock state and
//                              is NOT persisted (no activeVehicleId).
//   • archive-confirm-local — "Архивировать". Two-step inline confirm
//                              with [Отмена] / [Подтвердить]; both steps
//                              stay DOM-only — no localStorage write, no
//                              activeVehicleId, no driverOnline change.
//
// BD-PROFILE-D-05C/05D/05E — Garage as a collection (05C) + active
// selection persistence (05D) + shared resolver (05E). The collection
// builder and resolver moved to `public/src/garage.js` so the driver-
// response snapshot (respond.js) and accept-handoff snapshot
// (ride_actions.js) can read the same active vehicle the profile
// renders, without depending on a UI module.
// `buildGarageVehicles` returns the `[{id, model, color, plate, status,
// source}]` list (status stamped via the resolver), and
// `resolveActiveGarageVehicleId` reads `profile.driverGarage.activeVehicleId`
// with a legacy/first/null fallback chain. Persistence remains scoped
// to the `driverGarage` namespace on the user record (05D); the
// resolver is strictly read-only — no driver-response snapshot
// mutation, no active-ride mutation, no ride lifecycle / history /
// receipt write. Both are imported from `../garage.js` at the top
// of this file.

function garageVehicleCardHtml(vehicle) {
  const { id, model, color, plate, status } = vehicle;
  const isActive = status === 'active';
  const metaParts = [color, plate].filter(Boolean);
  const badge = isActive
    ? `<span class="bd-badge accent pf2-garage__badge" data-vehicle-status="active">Активное</span>`
    : `<span class="bd-badge pf2-garage__badge pf2-garage__badge--muted" data-vehicle-status="available">Доступно</span>`;
  const stateControl = isActive
    ? `<span class="pf2-garage__action pf2-garage__action--current" id="pf2-garage-active-${id}" data-garage-action="active" data-garage-state="active-current" data-vehicle-id="${id}" aria-disabled="true">Активна сейчас</span>`
    : `<button type="button" class="pf2-garage__action pf2-garage__action--make-active" id="pf2-garage-make-active-${id}" data-garage-action="make-active" data-garage-state="make-active-local" data-vehicle-id="${id}">Сделать активной</button>`;
  return `
      <article class="pf2-garage__car pf2-garage__car--${status}" data-vehicle="${id}" data-vehicle-status="${status}" data-vehicle-source="${vehicle.source}">
        <div class="pf2-garage__car-icon" aria-hidden="true">${SVG_CAR_FRONT}</div>
        <div class="pf2-garage__car-info">
          <p class="pf2-garage__car-model">${escapeHtml(model)}</p>
          ${metaParts.length ? `<p class="pf2-garage__car-meta">${escapeHtml(metaParts.join(' · '))}</p>` : ''}
        </div>
        ${badge}
        <div class="pf2-garage__actions">
          <button type="button" class="pf2-garage__action" id="pf2-garage-edit-${id}" data-garage-action="edit" data-garage-state="edit-ready" data-vehicle-id="${id}">Редактировать</button>
          ${stateControl}
          <button type="button" class="pf2-garage__action pf2-garage__action--muted" id="pf2-garage-archive-${id}" data-garage-action="archive" data-garage-state="archive-confirm-local" data-vehicle-id="${id}" aria-expanded="false" aria-controls="pf2-garage-confirm-${id}">Архивировать</button>
        </div>
        <div class="pf2-garage__confirm" id="pf2-garage-confirm-${id}" data-garage-confirm="archive" data-garage-confirm-state="idle" data-vehicle-id="${id}" role="group" aria-labelledby="pf2-garage-confirm-title-${id}" hidden>
          <p class="pf2-garage__confirm-title" id="pf2-garage-confirm-title-${id}">Архивировать авто?</p>
          <p class="pf2-garage__confirm-text">Авто останется в гараже, но не будет использоваться для заказов.</p>
          <div class="pf2-garage__confirm-actions">
            <button type="button" class="pf2-garage__confirm-cancel" id="pf2-garage-archive-cancel-${id}" data-garage-action="archive-cancel" data-vehicle-id="${id}">Отмена</button>
            <button type="button" class="pf2-garage__confirm-final" id="pf2-garage-archive-confirm-${id}" data-garage-action="archive-confirm" data-vehicle-id="${id}">Архивировать</button>
          </div>
        </div>
      </article>`;
}

// BD-PROFILE-D-05G — Add-vehicle sheet template. Rendered inside every
// garage section (empty and populated) so the Add CTA on either path
// opens the same draft surface. The sheet starts `hidden` and carries
// `data-garage-add-state="closed"`; opening flips both. The fields are
// pure DOM inputs — typing does NOT touch storage until the explicit
// save click. The submit-time write goes through `appendGarageVehicle`
// from state.js (single safe writer). Cancel resets the draft and hides
// the sheet without touching storage. The validation surface is a
// single error paragraph (`#pf2-garage-add-error`) that shifts its
// `data-garage-add-state` between `idle` / `invalid` so the smoke /
// design tools can pin the flow without scraping copy.
function garageAddSheetHtml() {
  return `
      <div class="pf2-garage-add-sheet" id="pf2-garage-add-sheet" role="dialog" aria-modal="true" aria-labelledby="pf2-garage-add-sheet-title" data-garage-add-state="closed" hidden>
        <div class="pf2-garage-add-sheet__backdrop" id="pf2-garage-add-backdrop" data-garage-add-action="close-backdrop"></div>
        <div class="pf2-garage-add-sheet__panel">
          <header class="pf2-garage-add-sheet__head">
            <h3 class="pf2-garage-add-sheet__title" id="pf2-garage-add-sheet-title">Добавить авто</h3>
            <button type="button" class="pf2-garage-add-sheet__close" id="pf2-garage-add-close" data-garage-add-action="close" aria-label="Закрыть">×</button>
          </header>
          <div class="pf2-garage-add-sheet__body">
            <label class="pf2-garage-add-sheet__field">
              <span class="pf2-garage-add-sheet__label">Модель *</span>
              <input type="text" class="pf2-garage-add-sheet__input" id="pf2-garage-add-model" name="model" placeholder="Toyota Prius" autocomplete="off" required>
            </label>
            <label class="pf2-garage-add-sheet__field">
              <span class="pf2-garage-add-sheet__label">Цвет</span>
              <input type="text" class="pf2-garage-add-sheet__input" id="pf2-garage-add-color" name="color" placeholder="белый" autocomplete="off">
            </label>
            <label class="pf2-garage-add-sheet__field">
              <span class="pf2-garage-add-sheet__label">Номер</span>
              <input type="text" class="pf2-garage-add-sheet__input" id="pf2-garage-add-plate" name="plate" placeholder="А 123 ВС 77" autocomplete="off">
            </label>
            <label class="pf2-garage-add-sheet__active-toggle">
              <input type="checkbox" id="pf2-garage-add-make-active" data-garage-add-action="make-active-toggle">
              <span>Сделать активной</span>
            </label>
            <p class="pf2-garage-add-sheet__error" id="pf2-garage-add-error" data-garage-add-state="idle" hidden>Укажите модель, чтобы сохранить авто.</p>
          </div>
          <div class="pf2-garage-add-sheet__actions">
            <button type="button" class="pf2-garage-add-sheet__cancel" id="pf2-garage-add-cancel" data-garage-add-action="cancel" data-garage-action="add-cancel" data-garage-state="add-cancel-local">Отмена</button>
            <button type="button" class="pf2-garage-add-sheet__save bd-btn primary" id="pf2-garage-add-save" data-garage-add-action="save" data-garage-action="add-save" data-garage-state="add-save-local">Сохранить</button>
          </div>
        </div>
      </div>`;
}

// BD-PROFILE-D-05H — Edit-vehicle sheet template. Mirrors the 05G add
// sheet — same shell, same DOM-only invariants — but uses an `edit-`
// hook namespace so the smoke can pin add and edit independently. The
// sheet's `data-edit-vehicle-id` attribute is populated by the open
// handler with the id of the card being edited; on save the handler
// reads it back and hands it to `patchGarageVehicle`. There is no
// "Сделать активной" toggle: per 05H scope, edit never changes the
// active selection.
function garageEditSheetHtml() {
  return `
      <div class="pf2-garage-add-sheet pf2-garage-edit-sheet" id="pf2-garage-edit-sheet" role="dialog" aria-modal="true" aria-labelledby="pf2-garage-edit-sheet-title" data-garage-edit-state="closed" hidden>
        <div class="pf2-garage-add-sheet__backdrop" id="pf2-garage-edit-backdrop" data-garage-edit-action="close-backdrop"></div>
        <div class="pf2-garage-add-sheet__panel">
          <header class="pf2-garage-add-sheet__head">
            <h3 class="pf2-garage-add-sheet__title" id="pf2-garage-edit-sheet-title">Редактировать авто</h3>
            <button type="button" class="pf2-garage-add-sheet__close" id="pf2-garage-edit-close" data-garage-edit-action="close" aria-label="Закрыть">×</button>
          </header>
          <div class="pf2-garage-add-sheet__body">
            <label class="pf2-garage-add-sheet__field">
              <span class="pf2-garage-add-sheet__label">Модель *</span>
              <input type="text" class="pf2-garage-add-sheet__input" id="pf2-garage-edit-model" name="edit-model" placeholder="Toyota Prius" autocomplete="off" required>
            </label>
            <label class="pf2-garage-add-sheet__field">
              <span class="pf2-garage-add-sheet__label">Цвет</span>
              <input type="text" class="pf2-garage-add-sheet__input" id="pf2-garage-edit-color" name="edit-color" placeholder="белый" autocomplete="off">
            </label>
            <label class="pf2-garage-add-sheet__field">
              <span class="pf2-garage-add-sheet__label">Номер</span>
              <input type="text" class="pf2-garage-add-sheet__input" id="pf2-garage-edit-plate" name="edit-plate" placeholder="А 123 ВС 77" autocomplete="off">
            </label>
            <p class="pf2-garage-add-sheet__error" id="pf2-garage-edit-error" data-garage-edit-state="idle" hidden>Укажите модель, чтобы сохранить авто.</p>
          </div>
          <div class="pf2-garage-add-sheet__actions">
            <button type="button" class="pf2-garage-add-sheet__cancel" id="pf2-garage-edit-cancel" data-garage-edit-action="cancel" data-garage-action="edit-cancel" data-garage-state="edit-cancel-local">Отмена</button>
            <button type="button" class="pf2-garage-add-sheet__save bd-btn primary" id="pf2-garage-edit-save" data-garage-edit-action="save" data-garage-action="edit-save" data-garage-state="edit-save-local">Сохранить</button>
          </div>
        </div>
      </div>`;
}

function garageSectionHtml(u, options = {}) {
  const vehicles = Array.isArray(options.vehicles)
    ? options.vehicles
    : buildGarageVehicles(u, options);

  // BD-PROFILE-D-05I — small archived-count hint. Archived entries stay
  // in storage (soft-delete) but are filtered out of the active list by
  // `buildGarageVehicles`; the hint surfaces the count so the driver
  // knows they still exist.
  // 05I Codex P2 — compute the archived count BEFORE the empty branch
  // so it can also surface when the user just archived their last
  // active vehicle and the active list is now empty.
  const archivedCount = countArchivedGarageVehicles(u);
  const archivedHintHtml = archivedCount > 0
    ? `<p class="pf2-garage__archived-hint" id="pf2-garage-archived-hint" data-garage-archived-count="${archivedCount}">В архиве: ${archivedCount}</p>`
    : '';

  if (vehicles.length === 0) {
    return `
      <section class="bd-card pf2-garage pf2-garage--empty" id="pf2-garage" aria-labelledby="pf2-garage-title" data-garage-collection-size="0" data-garage-archived-count="${archivedCount}">
        <header class="pf2-garage__head">
          <h2 class="pf2-garage__title" id="pf2-garage-title">Гараж</h2>
        </header>
        <div class="pf2-garage__empty-body">
          <span class="pf2-garage__empty-icon" aria-hidden="true">${SVG_CAR_FRONT}</span>
          <p class="pf2-garage__empty-title">Авто не добавлено</p>
          <p class="pf2-garage__empty-text">Добавьте автомобиль, чтобы принимать заказы.</p>
          <button type="button" class="bd-btn primary pf2-garage__cta" id="pf2-garage-add" data-garage-action="add" data-garage-state="add-ready">Добавить авто</button>
        </div>${archivedHintHtml}${garageAddSheetHtml()}${garageEditSheetHtml()}
      </section>`;
  }

  const multiClass = vehicles.length > 1 ? ' pf2-garage--multi' : '';
  const cardsHtml = vehicles.map(garageVehicleCardHtml).join('');
  return `
    <section class="bd-card pf2-garage${multiClass}" id="pf2-garage" aria-labelledby="pf2-garage-title" data-garage-collection-size="${vehicles.length}" data-garage-archived-count="${archivedCount}">
      <header class="pf2-garage__head">
        <h2 class="pf2-garage__title" id="pf2-garage-title">Гараж</h2>
        <button type="button" class="pf2-garage__add-btn" id="pf2-garage-add" data-garage-action="add" data-garage-state="add-ready" aria-label="Добавить авто">+ Добавить</button>
      </header>${cardsHtml}${archivedHintHtml}${garageAddSheetHtml()}${garageEditSheetHtml()}
    </section>`;
}

// BD-PROFILE-D-05B/05C/05D — Driver Garage action wiring.
// All handlers except `make-active` stay STRICTLY DOM-only:
//   • no localStorage writes (no user.set, no saveActiveRide, no setItem)
//   • no router navigation
//   • no driverOnline mutation
// `make-active` (05D) is the single persistence-touching handler in this
// slice: it patches `profile.driverGarage.activeVehicleId` via the user
// state API (scoped to the driverGarage namespace — no responses /
// active-ride / lifecycle / history / receipt write) and re-renders the
// garage section in place so the active badge moves to the selected
// vehicle and the previous active card becomes a non-active make-active
// candidate. "Активна сейчас" stays a non-button status pill (no handler
// attached). The archive flow remains a DOM-only 2-step inline confirm.
// The contract is locked by smoke-profile-driver-garage.mjs: every
// non-make-active handler is asserted byte-equal against the localStorage
// snapshot; the make-active handler is allowed to mutate ONLY the
// `driverGarage` field on the user record. The wiring iterates the
// vehicles list directly (not the DOM) so per-vehicle IDs stay
// deterministic under the smoke's stub.
function wireGarageActions(root, vehicles = []) {
  // Local-feedback flash for the add / edit entry points. The label
  // swap is purely transient and reverts in 1500ms — the underlying
  // button is never marked permanent-disabled because future CRUD
  // slices will repurpose the same hooks.
  const flash = (btn, text) => {
    if (!btn || btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    const original = btn.textContent;
    btn.textContent = text;
    setTimeout(() => {
      btn.textContent = original;
      delete btn.dataset.busy;
    }, 1500);
  };

  // BD-PROFILE-D-05G — Header / empty-state add CTA now opens the
  // add-vehicle draft sheet. The sheet is rendered with `hidden`; the
  // open handler flips it visible and resets the draft fields + error
  // state so a previous unsaved draft (canceled or never submitted)
  // cannot survive a navigation round-trip.
  const addBtn = root.querySelector('#pf2-garage-add');
  const sheet  = root.querySelector('#pf2-garage-add-sheet');

  const resetDraft = () => {
    for (const sel of ['#pf2-garage-add-model', '#pf2-garage-add-color', '#pf2-garage-add-plate']) {
      const el = root.querySelector(sel);
      if (el) el.value = '';
    }
    const makeActiveEl = root.querySelector('#pf2-garage-add-make-active');
    if (makeActiveEl) makeActiveEl.checked = false;
    const errEl = root.querySelector('#pf2-garage-add-error');
    if (errEl) {
      errEl.hidden = true;
      errEl.dataset.garageAddState = 'idle';
    }
  };

  const openSheet = () => {
    if (!sheet) return;
    resetDraft();
    sheet.hidden = false;
    sheet.dataset.garageAddState = 'open';
  };
  const closeSheet = () => {
    if (!sheet) return;
    resetDraft();
    sheet.hidden = true;
    sheet.dataset.garageAddState = 'closed';
  };

  addBtn?.addEventListener('click', openSheet);

  // Cancel surfaces: explicit "Отмена" button, header "×" close button,
  // and backdrop click. All three reset the draft and hide the sheet —
  // none touches storage.
  for (const sel of ['#pf2-garage-add-cancel', '#pf2-garage-add-close', '#pf2-garage-add-backdrop']) {
    const el = root.querySelector(sel);
    el?.addEventListener('click', closeSheet);
  }

  // Save — single allowed write path for the add-vehicle draft. Validates
  // model is non-empty, calls appendGarageVehicle (which trims fields,
  // sets `source: 'persisted'`, generates a collision-free id, and
  // patches activeVehicleId iff makeActive is checked), then closes the
  // sheet and re-renders the garage section in place so the new card
  // appears immediately.
  const saveBtn = root.querySelector('#pf2-garage-add-save');
  saveBtn?.addEventListener('click', () => {
    const modelEl       = root.querySelector('#pf2-garage-add-model');
    const colorEl       = root.querySelector('#pf2-garage-add-color');
    const plateEl       = root.querySelector('#pf2-garage-add-plate');
    const makeActiveEl  = root.querySelector('#pf2-garage-add-make-active');
    const errEl         = root.querySelector('#pf2-garage-add-error');

    const draft = {
      model: modelEl?.value || '',
      color: colorEl?.value || '',
      plate: plateEl?.value || '',
    };
    const trimmedModel = typeof draft.model === 'string' ? draft.model.trim() : '';
    if (!trimmedModel) {
      if (errEl) {
        errEl.hidden = false;
        errEl.dataset.garageAddState = 'invalid';
      }
      return;
    }
    const id = appendGarageVehicle(draft, {
      makeActive: makeActiveEl?.checked === true,
    });
    if (!id) {
      // state.js refused the write (defensive — already gated above).
      if (errEl) {
        errEl.hidden = false;
        errEl.dataset.garageAddState = 'invalid';
      }
      return;
    }
    closeSheet();
    refreshGarageSection(root);
  });

  // BD-PROFILE-D-05H — Edit-vehicle sheet wiring. The sheet shell is
  // always rendered inside the garage section (hidden by default); the
  // per-vehicle edit button (handled below in the per-vehicle loop)
  // calls `openEditSheet(vehicle)` which prefills the draft from the
  // selected card and stamps `data-edit-vehicle-id` so the save handler
  // knows which entry to patch. The handlers themselves stay STRICTLY
  // local: typing / cancel / × / backdrop never touch storage; only the
  // save click — and only after a non-empty trimmed model — invokes
  // `patchGarageVehicle` from state.js, then closes the sheet and
  // re-renders the garage section so the updated card appears
  // immediately. `activeVehicleId` is preserved by `patchGarageVehicle`
  // regardless of which vehicle was edited.
  const editSheet = root.querySelector('#pf2-garage-edit-sheet');
  const resetEditDraft = () => {
    for (const sel of ['#pf2-garage-edit-model', '#pf2-garage-edit-color', '#pf2-garage-edit-plate']) {
      const el = root.querySelector(sel);
      if (el) el.value = '';
    }
    const errEl = root.querySelector('#pf2-garage-edit-error');
    if (errEl) {
      errEl.hidden = true;
      errEl.dataset.garageEditState = 'idle';
    }
  };
  const openEditSheet = (vehicle) => {
    if (!editSheet || !vehicle || typeof vehicle.id !== 'string') return;
    resetEditDraft();
    const modelEl = root.querySelector('#pf2-garage-edit-model');
    if (modelEl) modelEl.value = (typeof vehicle.model === 'string') ? vehicle.model : '';
    const colorEl = root.querySelector('#pf2-garage-edit-color');
    if (colorEl) colorEl.value = (typeof vehicle.color === 'string') ? vehicle.color : '';
    const plateEl = root.querySelector('#pf2-garage-edit-plate');
    if (plateEl) plateEl.value = (typeof vehicle.plate === 'string') ? vehicle.plate : '';
    editSheet.dataset.editVehicleId = vehicle.id;
    editSheet.hidden = false;
    editSheet.dataset.garageEditState = 'open';
  };
  const closeEditSheet = () => {
    if (!editSheet) return;
    resetEditDraft();
    delete editSheet.dataset.editVehicleId;
    editSheet.hidden = true;
    editSheet.dataset.garageEditState = 'closed';
  };
  for (const sel of ['#pf2-garage-edit-cancel', '#pf2-garage-edit-close', '#pf2-garage-edit-backdrop']) {
    const el = root.querySelector(sel);
    el?.addEventListener('click', closeEditSheet);
  }
  const editSaveBtn = root.querySelector('#pf2-garage-edit-save');
  editSaveBtn?.addEventListener('click', () => {
    if (!editSheet) return;
    const vehicleId = editSheet.dataset.editVehicleId;
    const modelEl = root.querySelector('#pf2-garage-edit-model');
    const colorEl = root.querySelector('#pf2-garage-edit-color');
    const plateEl = root.querySelector('#pf2-garage-edit-plate');
    const errEl   = root.querySelector('#pf2-garage-edit-error');
    const draft = {
      model: modelEl?.value || '',
      color: colorEl?.value || '',
      plate: plateEl?.value || '',
    };
    const trimmedModel = typeof draft.model === 'string' ? draft.model.trim() : '';
    if (!trimmedModel) {
      if (errEl) {
        errEl.hidden = false;
        errEl.dataset.garageEditState = 'invalid';
      }
      return;
    }
    const id = patchGarageVehicle(vehicleId, draft);
    if (!id) {
      if (errEl) {
        errEl.hidden = false;
        errEl.dataset.garageEditState = 'invalid';
      }
      return;
    }
    closeEditSheet();
    refreshGarageSection(root);
  });

  for (const vehicle of vehicles) {
    const id = vehicle && vehicle.id;
    if (!id) continue;

    // BD-PROFILE-D-05H — Edit button opens the persisted-vehicle edit
    // sheet pre-filled from this card. Legacy-fallback cards
    // (source === 'legacy') keep the local-feedback flash because
    // editing them would write a fabricated entry into the persisted
    // collection — that's an explicit 05H out-of-scope ("do not
    // auto-migrate legacy vehicle fields into driverGarage.vehicles").
    const editBtn = root.querySelector(`#pf2-garage-edit-${id}`);
    if (vehicle.source === 'legacy') {
      editBtn?.addEventListener('click', () => flash(editBtn, 'Доступно в следующем шаге'));
    } else {
      editBtn?.addEventListener('click', () => openEditSheet(vehicle));
    }

    // make-active-local — non-active card only. The active card renders
    // a span (no listener attached) so this querySelector returns null
    // for the active vehicle and the listener is skipped. 05D: clicking
    // persists the selection through user.set into the driverGarage
    // namespace, then re-renders the section in place so the badge moves
    // and the previously-active card becomes a make-active candidate.
    if (vehicle.status !== 'active') {
      const makeActiveBtn = root.querySelector(`#pf2-garage-make-active-${id}`);
      makeActiveBtn?.addEventListener('click', () => {
        const current = user.get().driverGarage || {};
        user.set({ driverGarage: { ...current, activeVehicleId: id } });
        refreshGarageSection(root);
      });
    }

    const archiveBtn   = root.querySelector(`#pf2-garage-archive-${id}`);
    const confirmRow   = root.querySelector(`#pf2-garage-confirm-${id}`);
    const cancelBtn    = root.querySelector(`#pf2-garage-archive-cancel-${id}`);
    const confirmFinal = root.querySelector(`#pf2-garage-archive-confirm-${id}`);
    archiveBtn?.addEventListener('click', () => {
      if (!confirmRow) return;
      confirmRow.hidden = false;
      confirmRow.dataset.garageConfirmState = 'open';
      archiveBtn.setAttribute('aria-expanded', 'true');
    });
    cancelBtn?.addEventListener('click', () => {
      if (!confirmRow) return;
      confirmRow.hidden = true;
      confirmRow.dataset.garageConfirmState = 'idle';
      archiveBtn?.setAttribute('aria-expanded', 'false');
      if (confirmFinal) {
        confirmFinal.disabled = false;
        // BD-PROFILE-D-05I Codex P3 — restore the 05I primary action
        // label ("Архивировать"), not the pre-05I "Подтвердить", so
        // re-opening the confirm row after a cancel still reads as the
        // current archive copy. No re-render happens on cancel, so the
        // text must be reset to the canonical 05I label here.
        confirmFinal.textContent = 'Архивировать';
      }
    });
    confirmFinal?.addEventListener('click', () => {
      if (!confirmRow) return;
      // BD-PROFILE-D-05I — Real archive. `archiveGarageVehicle` flips
      // `archived: true` on the matched persisted entry (soft-delete),
      // and clears `driverGarage.activeVehicleId` when the archived id
      // was the active one. The render-time builder then drops the
      // entry from the active list, the badge moves off, and the
      // archived-count hint reflects the change. `refreshGarageSection`
      // rebuilds the section in place.
      confirmRow.dataset.garageConfirmState = 'archived-local';
      confirmFinal.disabled = true;
      confirmFinal.textContent = 'Архивировано';
      archiveGarageVehicle(id);
      refreshGarageSection(root);
    });
  }
}

// BD-PROFILE-D-05D — Re-render the garage section in place after a
// make-active selection. Rebuilds the vehicles list from the just-
// persisted user state (so the resolver picks up the new
// activeVehicleId) and swaps the section element; then re-wires the
// per-vehicle handlers so the new card layout is interactive. Other
// surfaces on the page are untouched. The DOM stub in the smoke
// no-ops `replaceWith`, so smoke-side verification re-renders the
// whole profile to confirm the persisted change.
function refreshGarageSection(root) {
  const oldSection = root.querySelector('#pf2-garage');
  if (!oldSection) return;
  const u = user.get();
  const force = getHashQuery().get('garage') || '';
  const vehicles = buildGarageVehicles(u, { force });
  const tmp = document.createElement('div');
  tmp.innerHTML = garageSectionHtml(u, { force, vehicles });
  const newSection = tmp.firstElementChild;
  if (!newSection) return;
  oldSection.replaceWith(newSection);
  wireGarageActions(root, vehicles);
}

function renderDriver(root, u) {
  // Render-time guard: if persisted driverOnline=true but readiness is no
  // longer satisfied (e.g. docs expired between sessions), demote to offline
  // before producing any HTML so toggle / status card cannot flash green.
  if (u.driverOnline && !isDriverLineReady(u)) {
    user.set({ driverOnline: false });
    u = user.get();
  }
  const items = checklistItems(u);

  // BD-PROFILE-D-03 — payouts empty preview (state H). ?state=empty renders the
  // empty payouts pane without touching the persisted receipt store. Other
  // panes are unaffected by the flag.
  const payoutsEmpty = getHashQuery().get('state') === 'empty';

  // BD-PROFILE-D-05A — garage preview. ?garage=empty forces the empty-state
  // card without wiping the persisted vehicle so designers can see the
  // "Авто не добавлено" state on a populated profile.
  // BD-PROFILE-D-05C — ?garage=multi appends a single demo vehicle to the
  // derived collection so designers can preview the multi-card layout
  // without injecting demo data into real driver views.
  const garageForce = getHashQuery().get('garage') || '';
  const garageVehicles = buildGarageVehicles(u, { force: garageForce });

  root.innerHTML = `
    <div class="pf2-topbar">
      <h1 class="pf2-topbar__title">Профиль</h1>
      <button type="button" class="pf2-topbar__gear" id="pf2-gear" aria-label="Настройки">${SVG_GEAR}</button>
    </div>
    ${tabsHtml('overview')}
    <div class="bd-scroll">
      <div class="pf2-pane pf2-pane--active" id="pf2-pane-overview">
        ${driverHeroHtml(u)}
        ${statusCardHtml(u)}
        ${driverCreateActionsHtml()}
        ${driverStatsHtml()}
        ${readinessHtml(items)}
        ${garageSectionHtml(u, { force: garageForce, vehicles: garageVehicles })}
        ${taxiPermitPanelHtml(u)}
        ${myPostsSectionHtml()}
        ${historySectionHtml()}
        ${quickActionsHtml()}
      </div>
      <div class="pf2-pane" id="pf2-pane-ip">${ipPaneHtml(u)}</div>
      <div class="pf2-pane" id="pf2-pane-docs">${docsPaneHtml(u)}</div>
      <div class="pf2-pane" id="pf2-pane-payouts">${payoutsPaneHtml(payoutsEmpty)}</div>
      <div class="pf2-pane" id="pf2-pane-security">${securityPaneHtml()}</div>
    </div>`;

  wireMyPostsSection(root);
  wireHistorySection(root);
  // BD-PROFILE-D-05A/C — garage card click handlers (mock UI feedback only).
  wireGarageActions(root, garageVehicles);

  // Tab switching
  const tabBtns = root.querySelectorAll('.pf2-tab');
  const panes   = root.querySelectorAll('.pf2-pane');
  tabBtns.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabBtns.forEach((t) => { t.classList.remove('pf2-tab--active'); t.setAttribute('aria-selected', 'false'); });
      panes.forEach((p) => p.classList.remove('pf2-pane--active'));
      tab.classList.add('pf2-tab--active');
      tab.setAttribute('aria-selected', 'true');
      const pane = root.querySelector(`#pf2-pane-${tab.dataset.pane}`);
      if (pane) pane.classList.add('pf2-pane--active');
    });
  });

  // BD-RIDE-HISTORY-D-01 / BD-PROFILE-D-03 — deep-link to a pane, e.g.
  // /profile?pane=payouts from the trip receipt's "К выплатам" action. The map
  // accepts both the internal pane ids (ip / docs / security) and the
  // human-readable render-gate aliases (taxi-ip / documents / safety) so the
  // documented manual URLs resolve to the same tab.
  const PANE_ALIASES = {
    overview: 'overview',
    ip: 'ip', 'taxi-ip': 'ip',
    docs: 'docs', documents: 'docs',
    payouts: 'payouts',
    security: 'security', safety: 'security',
  };
  // Own-property guard: a prototype key (e.g. ?pane=constructor) must resolve to
  // no pane, never to an inherited Object.prototype value that would be
  // interpolated into the selector below and could make querySelector throw.
  const paneParam = getHashQuery().get('pane');
  const resolvedPane = (paneParam && Object.hasOwn(PANE_ALIASES, paneParam))
    ? PANE_ALIASES[paneParam]
    : null;
  if (resolvedPane) {
    root.querySelector(`.pf2-tab[data-pane="${resolvedPane}"]`)?.click();
  }

  // Overview online toggle — syncs both status cards.
  // Guard: do not allow ON unless driver is line-ready.
  const toggleInput = root.querySelector('#pf2-online-toggle');
  toggleInput.addEventListener('change', () => {
    const on = toggleInput.checked;
    const current = user.get();
    if (on && !isDriverLineReady(current)) {
      toggleInput.checked = false;
      user.set({ driverOnline: false });
      syncDriverStatusDom(root, current, false);
      return;
    }
    user.set({ driverOnline: on });
    syncDriverStatusDom(root, current, on);
  });

  root.querySelector('#pf2-goto-actions').addEventListener('click', () => {
    root.querySelector('.pf2-readiness-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // BD-ROLE-01 — Driver create/order CTAs. Nearby orders + going online live
  // on DriverMap; "Предложить поездку" opens the composer pre-set to a driver
  // offer; "Перейти в режим пассажира" is the explicit, opt-in passenger
  // request entry (composer surfaces a role-mismatch notice there).
  root.querySelector('#pf2-act-nearby')?.addEventListener('click', () => go('/driver-map'));
  root.querySelector('#pf2-act-offer')?.addEventListener('click', () => go('/new?type=driver_offer'));
  root.querySelector('#pf2-act-passenger-mode')?.addEventListener('click', () => go('/new?type=passenger_request'));

  // ── Taxi permit: open inline panel ──────────────────────────────────────────
  const permitPanel  = root.querySelector('#pf2-permit-panel');
  const permitRow    = root.querySelector('#pf2-check-taxi-permit');
  const permitStatus = root.querySelector('#pf2-permit-status');

  function showPermitStatus(msg) {
    if (!permitStatus) return;
    permitStatus.textContent = msg;
    permitStatus.hidden = false;
  }

  function openPermitPanel() {
    if (!permitPanel) return;
    permitPanel.hidden = false;
    permitPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    root.querySelector('#pf2-permit-number')?.focus();
  }

  permitRow?.addEventListener('click', openPermitPanel);

  root.querySelector('#pf2-permit-close')?.addEventListener('click', () => {
    if (permitPanel) permitPanel.hidden = true;
  });

  function collectPermitDraft() {
    return {
      number:    root.querySelector('#pf2-permit-number')?.value.trim()  || '',
      region:    root.querySelector('#pf2-permit-region')?.value.trim()  || '',
      issuedAt:  root.querySelector('#pf2-permit-issued')?.value         || '',
      expiresAt: root.querySelector('#pf2-permit-expiry')?.value         || '',
    };
  }

  root.querySelector('#pf2-permit-save-draft')?.addEventListener('click', () => {
    user.set({ taxiPermitDraft: collectPermitDraft() });
    showPermitStatus('Черновик сохранён');
  });

  root.querySelector('#pf2-permit-mark-done')?.addEventListener('click', () => {
    user.set({ taxiPermitDraft: collectPermitDraft() });
    // taxiPermit and documentsReady are derived from this status — see state.js.
    setDocumentStatus('taxiRegistry', 'uploaded');
    refreshReadinessDom();
    refreshDocsPane();
    const cur = user.get();
    syncDriverStatusDom(root, cur, cur.driverOnline);
    showPermitStatus('Разрешение отмечено как добавленное (demo)');
    // Hide IP-pane permit warning if it was shown
    const warn = root.querySelector('#pf2-ip-permit-warn');
    if (warn) warn.hidden = true;
  });

  // Re-render the Documents pane while preserving its delegated click handler
  // (which lives on the pane element itself, not on inner cards).
  function refreshDocsPane() {
    const pane = root.querySelector('#pf2-pane-docs');
    if (!pane) return;
    pane.innerHTML = docsPaneHtml(user.get());
  }

  // Delegated click handler for all documents-pane interactions.
  // Buttons inside the pane carry data-doc-action / data-doc-close /
  // data-doc-mark — we route by attribute so refreshing the pane innerHTML
  // does not require re-binding listeners.
  const docsPane = root.querySelector('#pf2-pane-docs');
  docsPane?.addEventListener('click', (e) => {
    const openBtn = e.target.closest('[data-doc-action]');
    if (openBtn && docsPane.contains(openBtn)) {
      const key = openBtn.dataset.docAction;
      const panel = docsPane.querySelector(`[data-doc-panel="${key}"]`);
      if (panel) {
        const willOpen = panel.hidden;
        panel.hidden = !willOpen;
        if (willOpen) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      return;
    }
    const closeBtn = e.target.closest('[data-doc-close]');
    if (closeBtn && docsPane.contains(closeBtn)) {
      const key = closeBtn.dataset.docClose;
      const panel = docsPane.querySelector(`[data-doc-panel="${key}"]`);
      if (panel) panel.hidden = true;
      return;
    }
    const markBtn = e.target.closest('[data-doc-mark]');
    if (markBtn && docsPane.contains(markBtn)) {
      const key = markBtn.dataset.docMark;
      setDocumentStatus(key, 'uploaded');
      refreshDocsPane();
      refreshReadinessDom();
      const cur = user.get();
      syncDriverStatusDom(root, cur, cur.driverOnline);
      const ipWarn = root.querySelector('#pf2-ip-permit-warn');
      if (ipWarn && cur.taxiPermit) ipWarn.hidden = true;
      return;
    }
  });

  // Re-render readiness card + checklist row in place, without losing focus
  // on tab/panels. Keeps the inline permit panel open so the user can see
  // confirmation, but flips the row to "done" state.
  function refreshReadinessDom() {
    const current = user.get();
    const items   = checklistItems(current);
    const card    = root.querySelector('.pf2-readiness-card');
    if (!card) return;
    // Replace just the inner of the readiness card with fresh markup.
    const fresh = document.createElement('div');
    fresh.innerHTML = readinessHtml(items).trim();
    const newCard = fresh.firstElementChild;
    if (newCard) card.replaceWith(newCard);
    // Re-bind the (possibly recreated) taxi-permit row to the same handler.
    const newRow = root.querySelector('#pf2-check-taxi-permit');
    newRow?.addEventListener('click', openPermitPanel);
  }

  // CTA: open active shift / active ride (driver mode).
  // Enabled only when line-ready.
  root.querySelector('#pf2-active-shift-cta')?.addEventListener('click', () => {
    if (!isDriverLineReady(user.get())) return;
    go('/driver-map');
  });

  // Gear icon: switch to security pane.
  root.querySelector('#pf2-gear')?.addEventListener('click', () => {
    root.querySelector('.pf2-tab[data-pane="security"]')?.click();
  });

  root.querySelector('#pf2-edit').addEventListener('click', () => go('/onboarding'));

  // "Скоро здесь" stub for quick-action rows without a dedicated screen yet.
  function stubActionRow(btn, text) {
    if (!btn) return;
    const label = btn.querySelector('.pf2-action-row__label');
    if (!label || btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    const orig = label.textContent;
    label.textContent = text;
    setTimeout(() => {
      label.textContent = orig;
      delete btn.dataset.busy;
    }, 1500);
  }

  // Quick action "Мой автомобиль" → switch to Такси / ИП pane (vehicle / shift area).
  root.querySelector('#pf2-act-car')?.addEventListener('click', () => {
    root.querySelector('.pf2-tab[data-pane="ip"]')?.click();
  });

  // Quick action "Шаблоны договоров" → stub, no dedicated screen yet.
  const contractsBtn = root.querySelector('#pf2-act-contracts');
  contractsBtn?.addEventListener('click', () => stubActionRow(contractsBtn, 'Скоро здесь'));

  // Quick action "Уведомления" → toggle notificationsEnabled and show feedback.
  const notifBtn = root.querySelector('#pf2-act-notif');
  notifBtn?.addEventListener('click', () => {
    const current = user.get();
    const next = !current.notificationsEnabled;
    user.set({ notificationsEnabled: next });
    stubActionRow(notifBtn, next ? 'Уведомления включены' : 'Уведомления выключены');
  });

  // BD-ROLE-05 — per-tab role view switch (driver → passenger). Mirror of
  // #pfp-role-switch in the passenger view: sessionStorage-only via
  // setSmokeRole, never calls performLocalLogout / user.reset / user.set, and
  // does not touch vehicle / documents / payouts / history. go('/profile')
  // re-runs the profile factory which picks the new effectiveRole from
  // getSmokeRole() and renders the passenger view.
  root.querySelector('#pf2-act-role-switch')?.addEventListener('click', () => {
    setSmokeRole('passenger');
    go('/profile');
  });

  const logoutBtn = root.querySelector('#pf2-act-logout');
  logoutBtn.addEventListener('click', () => {
    if (logoutBtn.dataset.confirm === 'pending') {
      // BD-AUTH-BOUNDARY-01 — driver logout goes through the same mock
      // auth boundary as the passenger logout so any future local artefacts
      // wiped on logout (ride history, demo overrides, …) stay in one place.
      performLocalLogout();
    } else {
      logoutBtn.dataset.confirm = 'pending';
      logoutBtn.querySelector('.pf2-action-row__label').textContent = 'Подтвердить выход';
    }
  });

  // IP pane is re-rendered when state changes (see refreshIpPane), so every
  // interactive control inside #pf2-pane-ip is wired through delegation. This
  // keeps clicks working after the pane innerHTML is replaced.
  const ipPane = root.querySelector('#pf2-pane-ip');

  function scrollToChecklist() {
    ipPane?.querySelector('.pf2-ip-checklist')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function maybeShowPermitWarn() {
    if (user.get().taxiPermit) return;
    const warn = ipPane?.querySelector('#pf2-ip-permit-warn');
    if (!warn) return;
    warn.hidden = false;
    warn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Open the Documents tab and target a specific doc panel (waybill / medical
  // / taxiRegistry). Used by readiness checklist row actions.
  function openDocAction(key) {
    root.querySelector('.pf2-tab[data-pane="docs"]')?.click();
    const docsPane = root.querySelector('#pf2-pane-docs');
    const panel = docsPane?.querySelector(`[data-doc-panel="${key}"]`);
    if (panel) {
      panel.hidden = false;
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  ipPane?.addEventListener('change', (e) => {
    const tog = e.target.closest('#pf2-ip-online-toggle');
    if (!tog) return;
    const current = user.get();
    const state = getTaxiReadinessState(current);
    if (state === 'blocked') {
      tog.checked = false;
      if (current.driverOnline) user.set({ driverOnline: false });
      scrollToChecklist();
      return;
    }
    const on = tog.checked;
    if (on && !isDriverLineReady(current)) {
      tog.checked = false;
      user.set({ driverOnline: false });
      syncDriverStatusDom(root, current, false);
      return;
    }
    user.set({ driverOnline: on });
    syncDriverStatusDom(root, current, on);
  });

  ipPane?.addEventListener('click', (e) => {
    // Blocked-state toggle: input is aria-disabled, route click to checklist.
    const togLabel = e.target.closest('.pf2-ip-toggle');
    if (togLabel && getTaxiReadinessState(user.get()) === 'blocked') {
      e.preventDefault();
      scrollToChecklist();
      return;
    }

    if (e.target.closest('#pf2-ip-goto-actions')) {
      scrollToChecklist();
      return;
    }

    const readinessBtn = e.target.closest('[data-readiness-action]');
    if (readinessBtn) {
      const action = readinessBtn.dataset.readinessAction;
      if (action === 'waybill') {
        user.set({ waybillOpen: true });
        setDocumentStatus('waybill', 'uploaded');
        syncDriverStatusDom(root, user.get(), user.get().driverOnline);
        refreshReadinessDom();
        refreshDocsPane();
      } else if (action === 'medical') {
        user.set({ medicalCheckPassed: true });
        setDocumentStatus('medicalCheck', 'uploaded');
        syncDriverStatusDom(root, user.get(), user.get().driverOnline);
        refreshReadinessDom();
        refreshDocsPane();
      } else if (action === 'permit') {
        openDocAction('taxiRegistry');
      }
      return;
    }

    // "Выйти на линию" — blocked button stays disabled, otherwise toggles online.
    const goBtn = e.target.closest('#pf2-ip-go-online');
    if (goBtn) {
      if (goBtn.disabled) return;
      const current = user.get();
      const nextOnline = !current.driverOnline;
      if (nextOnline && !isDriverLineReady(current)) {
        scrollToChecklist();
        return;
      }
      user.set({ driverOnline: nextOnline });
      syncDriverStatusDom(root, current, nextOnline);
      maybeShowPermitWarn();
      return;
    }

    if (e.target.closest('#pf2-ip-open-shift') || e.target.closest('#pf2-ip-check-ready')) {
      maybeShowPermitWarn();
      return;
    }
  });

  // ── Payouts tab interactions ──────────────────────────────────────────────

  // State: processing-payout — class pf2-po-balance-btn--processing added while in flight
  root.querySelector('#pf2-po-withdraw-btn')?.addEventListener('click', () => {
    const btn = root.querySelector('#pf2-po-withdraw-btn');
    if (btn.classList.contains('pf2-po-balance-btn--processing')) return;
    const orig = btn.textContent;
    btn.classList.add('pf2-po-balance-btn--processing');
    btn.disabled = true;
    btn.textContent = 'Оформляем вывод…';
    setTimeout(() => {
      btn.textContent = 'Заявка принята — заглушка';
      setTimeout(() => {
        btn.textContent = orig;
        btn.disabled = false;
        btn.classList.remove('pf2-po-balance-btn--processing');
      }, 1500);
    }, 800);
  });

  root.querySelector('#pf2-po-history-btn')?.addEventListener('click', () => {
    root.querySelector('#pf2-po-history-block')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // BD-RIDE-HISTORY-D-01 — a completed-ride payout row opens its trip receipt.
  root.querySelector('#pf2-po-trips-block')?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-receipt-trip]');
    if (!row) return;
    const tripId = row.dataset.receiptTrip;
    if (tripId) go(`/receipt?tripId=${encodeURIComponent(tripId)}`);
  });

  root.querySelector('#pf2-po-hist-all-btn')?.addEventListener('click', () => {
    root.querySelector('#pf2-po-history-block')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  root.querySelector('#pf2-po-methods-change')?.addEventListener('click', () => {
    const btn = root.querySelector('#pf2-po-methods-change');
    const orig = btn.textContent;
    btn.textContent = 'Скоро здесь';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });

  root.querySelector('#pf2-po-add-card-btn')?.addEventListener('click', () => {
    const nameEl = root.querySelector('#pf2-po-add-card-btn .pf2-po-method-name');
    if (!nameEl) return;
    const orig = nameEl.textContent;
    nameEl.textContent = 'Скоро здесь';
    setTimeout(() => { nameEl.textContent = orig; }, 1500);
  });

  root.querySelector('#pf2-po-tax-pay-npd-apr')?.addEventListener('click', () => {
    const btn = root.querySelector('#pf2-po-tax-pay-npd-apr');
    const orig = btn.textContent;
    btn.textContent = 'Откройте «Мой налог» — заглушка';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });

  // State: report-generating — class pf2-po-report-btn--generating while in flight,
  //        pf2-po-report-btn--done briefly on success
  root.querySelector('#pf2-po-report-btn')?.addEventListener('click', () => {
    const btn = root.querySelector('#pf2-po-report-btn');
    if (btn.classList.contains('pf2-po-report-btn--generating')) return;
    const orig = btn.textContent;
    btn.classList.add('pf2-po-report-btn--generating');
    btn.disabled = true;
    btn.textContent = 'Формируем отчёт…';
    setTimeout(() => {
      btn.classList.remove('pf2-po-report-btn--generating');
      btn.classList.add('pf2-po-report-btn--done');
      btn.disabled = false;
      btn.textContent = 'Отчёт готов — заглушка';
      setTimeout(() => {
        btn.classList.remove('pf2-po-report-btn--done');
        btn.textContent = orig;
      }, 2000);
    }, 1000);
  });

  // BD-PROFILE-D-03 — empty payouts CTA (state H) routes the driver to nearby
  // orders so the empty state has a single forward action.
  root.querySelector('#pf2-po-empty-cta')?.addEventListener('click', () => go('/driver-map'));

  // BD-PROFILE-D-03 — safety center tiles (state I). Demo placeholders: no real
  // call, no SOS dispatch — they only dismiss focus, matching the passenger
  // safety tiles.
  ['#pf2-safety-contacts', '#pf2-safety-share', '#pf2-safety-sos'].forEach((sel) => {
    root.querySelector(sel)?.addEventListener('click', (e) => e.currentTarget.blur());
  });
}

// ── Main factory ──────────────────────────────────────────────────────────────

export default function profile() {
  const root = document.createElement('section');
  root.className = 'screen screen--profile';
  const u = user.get();

  // Render-gate preview params. ?role= picks the view without mutating the
  // stored role; ?state= overlays a passenger sub-state (see
  // applyPassengerStatePreview). Both are non-destructive — real user actions
  // still re-render from the persisted user via the in-screen rerender().
  const q = getHashQuery();
  const roleParam = q.get('role');
  const stateParam = q.get('state');

  // BD-SMOKE-ROLE-01 — the per-tab role override picks which profile *view*
  // renders, so a passenger tab and a driver tab show their own role even
  // though the profile DATA (name, vehicle, docs) is the shared user. The
  // explicit ?role= preview param still wins over the override.
  const effectiveRole = getSmokeRole() || u.role;

  let view;
  if (roleParam === 'driver') view = 'driver';
  else if (roleParam === 'passenger') view = 'passenger';
  else if (!u.onboarded || effectiveRole === 'guest') view = 'guest';
  else if (effectiveRole === 'driver') view = 'driver';
  else view = 'passenger';

  if (view === 'guest') {
    renderGuest(root);
  } else if (view === 'driver') {
    // BD-PROFILE-D-03 — loading / skeleton preview (state J). ?state=loading
    // renders the non-interactive driver skeleton; any other value falls
    // through to the live dashboard (where ?state=empty drives the payouts
    // empty state).
    if (stateParam === 'loading') renderDriverSkeleton(root);
    else renderDriver(root, u);
  } else {
    renderPassenger(root, applyPassengerStatePreview(u, stateParam), stateParam);
  }

  return root;
}
