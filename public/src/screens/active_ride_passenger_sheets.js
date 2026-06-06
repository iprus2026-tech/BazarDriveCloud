// BD-RIDE-SHEETS-01 — Passenger active-ride bottom sheets.
//
// Houses the two passenger-side overlays ported from the fresh Cloud
// Design export (PDF p.25-28):
//   • BD-RIDE-P-07 PassengerSafetySheet  — Безопасность / report / SOS
//   • BD-RIDE-P-06 PassengerCancelRideSheet — отмена активной поездки
//
// This module owns ONLY the sheet UI and its state transitions. It does
// not persist ride state, call any backend, dial any number or dispatch
// any real SOS — every "live" action is a safe demo stub. Persistence
// (CANCELED status + canonical ride-order sync) stays in the passenger
// screen's onConfirm callback so the data layer keeps a single owner.
//
// Style rules (enforced by scripts/check.mjs): no inline styles, no
// .style mutations — every visual state is toggled through class names
// and data-* attributes, with all CSS living in public/styles/cloud.css.

import { escapeHtml } from '../util.js';
import { go } from '../router.js';

// ── Local icon set ───────────────────────────────────────────
// Self-contained copies of the handful of glyphs these sheets need.
// The screen-level icons in active_ride_passenger.js are module-private
// there; duplicating a few tiny SVG strings keeps this module free of a
// circular import back into the passenger screen.
const CLOSE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <line x1="18" y1="6" x2="6" y2="18"/>
  <line x1="6" y1="6" x2="18" y2="18"/>
</svg>`;

const CHEVRON_LEFT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <polyline points="15 6 9 12 15 18"/>
</svg>`;

const CHEVRON_RIGHT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="16" height="16">
  <polyline points="9 6 15 12 9 18"/>
</svg>`;

const PHONE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.56 2.81.69A2 2 0 0 1 22 16.92z"/>
</svg>`;

const MESSAGE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>
</svg>`;

const FLAG_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
  <line x1="4" y1="22" x2="4" y2="15"/>
</svg>`;

const ALERT_TRI_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
  <line x1="12" y1="9" x2="12" y2="13"/>
  <line x1="12" y1="17" x2="12.01" y2="17"/>
</svg>`;

const SHARE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
  <circle cx="18" cy="5" r="3"/>
  <circle cx="6" cy="12" r="3"/>
  <circle cx="18" cy="19" r="3"/>
  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
</svg>`;

const HEART_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l8.84 8.84 8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/>
</svg>`;

const CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="22" height="22">
  <polyline points="20 6 9 17 4 12"/>
</svg>`;

const PLUS_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <line x1="12" y1="5" x2="12" y2="19"/>
  <line x1="5" y1="12" x2="19" y2="12"/>
</svg>`;

const SPINNER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" width="16" height="16">
  <circle cx="12" cy="12" r="9" stroke-opacity="0.25"/>
  <path d="M21 12a9 9 0 0 1-9 9"/>
</svg>`;

// Demo ride-card fallbacks — mirror the Cloud Design mock so the card
// still reads believably when no live ride data is wired up.
const DEMO_DRIVER_NAME = 'Рустам К.';
const DEMO_DRIVER_INITIALS = 'РК';
const DEMO_DRIVER_RATING = '4,92';
const DEMO_CAR_MODEL = 'Toyota Camry';
const DEMO_CAR_PLATE = 'А 124 ВВ 77';
const DEMO_TRIP_LABEL = '№48-321';
const SAFETY_REPORT_ID = '№RPT-4821';

function escAttr(value) {
  return escapeHtml(String(value == null ? '' : value));
}

function rideCard(ride, tripLabel) {
  const driver = (ride && ride.driver) || {};
  const vehicle = (ride && ride.vehicle) || {};
  const name = driver.name || DEMO_DRIVER_NAME;
  const initials = driver.initials || DEMO_DRIVER_INITIALS;
  const rating = driver.rating || DEMO_DRIVER_RATING;
  const car = `${vehicle.model || DEMO_CAR_MODEL} · ${vehicle.plate || DEMO_CAR_PLATE}`;
  const order = tripLabel || DEMO_TRIP_LABEL;
  return `
    <div class="passenger-safety-sheet__ridecard">
      <div class="passenger-safety-sheet__ridecard-avatar" aria-hidden="true">${escapeHtml(initials)}</div>
      <div class="passenger-safety-sheet__ridecard-info">
        <div class="passenger-safety-sheet__ridecard-name">
          ${escapeHtml(name)}
          <span class="passenger-safety-sheet__ridecard-rating">★ ${escapeHtml(rating)}</span>
        </div>
        <div class="passenger-safety-sheet__ridecard-car">${escapeHtml(car)}</div>
      </div>
      <div class="passenger-safety-sheet__ridecard-order">${escapeHtml(order)}</div>
    </div>
  `;
}

// ── BD-RIDE-P-07 PassengerSafetySheet ────────────────────────
// Views are switched through overlay.dataset.view:
//   "default"   — ride card + action list
//   "report"    — "Пожаловаться" reasons → submitted confirmation
//   "emergency" — SOS demo (112 / contacts / hold) — no real dispatch
// Report sub-state lives in overlay.dataset.report: idle | selected | submitted.
const SAFETY_ACTIONS = [
  { id: 'call',   label: 'Позвонить водителю', icon: PHONE_SVG },
  { id: 'chat',   label: 'Написать в чат',     icon: MESSAGE_SVG },
  { id: 'report', label: 'Пожаловаться',       icon: FLAG_SVG },
  { id: 'sos',    label: 'SOS',                icon: ALERT_TRI_SVG },
  { id: 'share',  label: 'Поделиться поездкой', icon: SHARE_SVG },
];

const SAFETY_REPORT_REASONS = [
  { id: 'route_deviation', label: 'В пути отклонился от маршрута' },
  { id: 'rude',            label: 'Грубое поведение' },
  { id: 'car_mismatch',    label: 'Машина не соответствует' },
  { id: 'unsafe_driving',  label: 'Небезопасное вождение' },
  { id: 'other',           label: 'Другое' },
];

function safetyActionsHtml() {
  return SAFETY_ACTIONS.map((a) => `
    <li>
      <button type="button"
        class="passenger-safety-sheet__row"
        data-safety-action="${escAttr(a.id)}">
        <span class="passenger-safety-sheet__row-ic" aria-hidden="true">${a.icon}</span>
        <span class="passenger-safety-sheet__row-text">${escapeHtml(a.label)}</span>
        <span class="passenger-safety-sheet__row-chev" aria-hidden="true">${CHEVRON_RIGHT_SVG}</span>
      </button>
    </li>
  `).join('');
}

function safetyReasonsHtml() {
  return SAFETY_REPORT_REASONS.map((r) => `
    <button type="button"
      class="passenger-safety-sheet__reason"
      role="radio"
      aria-checked="false"
      data-report-reason="${escAttr(r.id)}">
      <span class="passenger-safety-sheet__reason-text">${escapeHtml(r.label)}</span>
      <span class="passenger-safety-sheet__reason-radio" aria-hidden="true"></span>
    </button>
  `).join('');
}

export function openPassengerSafetySheet(root, options = {}) {
  if (!root) return null;
  const existing = root.querySelector('.passenger-safety-overlay');
  if (existing) return existing;

  const ride = options.ride || null;
  const tripLabel = options.tripLabel || DEMO_TRIP_LABEL;
  const toast = typeof options.toast === 'function' ? options.toast : null;
  const safeToast = (msg) => { if (toast) toast(msg); };

  const overlay = document.createElement('div');
  overlay.className = 'passenger-safety-overlay';
  overlay.dataset.view = 'default';
  overlay.dataset.report = 'idle';
  overlay.dataset.sosState = 'idle';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'arp-safety-title');

  overlay.innerHTML = `
    <div class="passenger-safety-overlay__backdrop" aria-hidden="true"></div>

    <div class="passenger-safety-sheet" role="document">
      <div class="passenger-safety-sheet__handle" aria-hidden="true"></div>
      <div class="passenger-safety-sheet__header">
        <button type="button" class="passenger-safety-sheet__back" id="arp-safety-back" aria-label="Назад">
          ${CHEVRON_LEFT_SVG}
        </button>
        <div class="passenger-safety-sheet__pill">
          <span class="passenger-safety-sheet__pill-dot" aria-hidden="true"></span>
          Центр безопасности
        </div>
        <button type="button" class="passenger-safety-sheet__close" id="arp-safety-close" aria-label="Закрыть">
          ${CLOSE_SVG}
        </button>
      </div>

      <!-- VIEW: default -->
      <div class="passenger-safety-sheet__view passenger-safety-sheet__view--default">
        <div id="arp-safety-title" class="passenger-safety-sheet__title">Безопасность</div>
        <div class="passenger-safety-sheet__sub">
          Поездка под защитой. Свяжитесь с водителем, отправьте жалобу или вызовите помощь.
        </div>
        ${rideCard(ride, tripLabel)}
        <ul class="passenger-safety-sheet__list" role="list">
          ${safetyActionsHtml()}
        </ul>
        <button type="button" class="passenger-safety-sheet__btn-close" id="arp-safety-close-btn">
          Закрыть
        </button>
      </div>

      <!-- VIEW: report -->
      <div class="passenger-safety-sheet__view passenger-safety-sheet__view--report">
        <div class="passenger-safety-sheet__view-title">Пожаловаться</div>
        <div class="passenger-safety-sheet__sub">Выберите, что произошло — мы разберёмся.</div>
        <div class="passenger-safety-sheet__reasons" role="radiogroup" aria-label="Причина жалобы">
          ${safetyReasonsHtml()}
        </div>
        <button type="button" class="passenger-safety-sheet__submit" id="arp-safety-report-submit" disabled>
          Отправить жалобу
        </button>

        <div class="passenger-safety-sheet__submitted" role="status" aria-live="polite">
          <div class="passenger-safety-sheet__submitted-icon" aria-hidden="true">${CHECK_SVG}</div>
          <div class="passenger-safety-sheet__submitted-title">Жалоба отправлена</div>
          <div class="passenger-safety-sheet__submitted-meta">Обращение ${escapeHtml(SAFETY_REPORT_ID)}</div>
          <button type="button" class="passenger-safety-sheet__submitted-done" id="arp-safety-report-done">
            Готово
          </button>
        </div>
      </div>

      <!-- VIEW: emergency -->
      <div class="passenger-safety-sheet__view passenger-safety-sheet__view--emergency">
        <div class="passenger-safety-sheet__view-title">Экстренная помощь</div>
        <div class="passenger-safety-sheet__demo-note" role="note">
          <span class="passenger-safety-sheet__demo-dot" aria-hidden="true"></span>
          Demo-режим: реальный вызов диспетчера не отправляется.
        </div>

        <button type="button"
          class="passenger-safety-sheet__sos-tile"
          id="arp-safety-sos"
          aria-pressed="false"
          aria-label="SOS">
          <span class="passenger-safety-sheet__sos-icon" aria-hidden="true">${ALERT_TRI_SVG}</span>
          <div class="passenger-safety-sheet__sos-body">
            <div class="passenger-safety-sheet__sos-title">SOS</div>
            <div class="passenger-safety-sheet__sos-sub" data-sos-show="idle">
              Удерживайте для вызова помощи (demo)
            </div>
            <div class="passenger-safety-sheet__sos-sub" data-sos-show="pressed">
              Запрос принят · с вами свяжутся (demo)
            </div>
          </div>
          <span class="passenger-safety-sheet__sos-badge" data-sos-show="pressed" aria-hidden="true">
            Идёт обработка…
          </span>
        </button>

        <button type="button" class="passenger-safety-sheet__emergency-btn passenger-safety-sheet__emergency-btn--call" data-emergency="112">
          <span class="passenger-safety-sheet__emergency-ic" aria-hidden="true">${PHONE_SVG}</span>
          Позвонить 112
        </button>
        <button type="button" class="passenger-safety-sheet__emergency-btn" data-emergency="contacts">
          <span class="passenger-safety-sheet__emergency-ic" aria-hidden="true">${HEART_SVG}</span>
          Уведомить контакты
        </button>

        <button type="button" class="passenger-safety-sheet__btn-close" id="arp-safety-emergency-back">
          Назад
        </button>
      </div>
    </div>
  `;

  let reportReason = null;

  function close() {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }

  function showDefault() {
    overlay.dataset.view = 'default';
  }

  function onKey(ev) {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    // Escape steps back out of a sub-view first, then closes.
    if (overlay.dataset.view !== 'default') {
      showDefault();
      return;
    }
    close();
  }
  document.addEventListener('keydown', onKey);

  // Header back arrow only acts inside a sub-view (hidden in default via CSS).
  overlay.querySelector('#arp-safety-back').addEventListener('click', showDefault);
  overlay.querySelector('#arp-safety-emergency-back').addEventListener('click', showDefault);

  // Default action list.
  overlay.querySelectorAll('[data-safety-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-safety-action');
      if (id === 'call') {
        safeToast('Звонок водителю пока заглушка');
      } else if (id === 'chat') {
        const tripId = ride && ride.tripId;
        close();
        go(tripId ? `/chat?tripId=${encodeURIComponent(tripId)}&role=passenger` : '/chat');
      } else if (id === 'report') {
        overlay.dataset.report = 'idle';
        reportReason = null;
        overlay.querySelectorAll('[data-report-reason]').forEach((r) => r.setAttribute('aria-checked', 'false'));
        const submit = overlay.querySelector('#arp-safety-report-submit');
        if (submit) submit.disabled = true;
        overlay.dataset.view = 'report';
      } else if (id === 'sos') {
        overlay.dataset.view = 'emergency';
      } else if (id === 'share') {
        safeToast('Поделиться поездкой пока заглушка');
      }
    });
  });

  // Report reasons → enable submit.
  overlay.querySelectorAll('[data-report-reason]').forEach((btn) => {
    btn.addEventListener('click', () => {
      reportReason = btn.getAttribute('data-report-reason');
      overlay.querySelectorAll('[data-report-reason]').forEach((r) => {
        r.setAttribute('aria-checked', r === btn ? 'true' : 'false');
      });
      overlay.dataset.report = 'selected';
      const submit = overlay.querySelector('#arp-safety-report-submit');
      if (submit) submit.disabled = false;
    });
  });

  overlay.querySelector('#arp-safety-report-submit').addEventListener('click', () => {
    if (!reportReason) return;
    overlay.dataset.report = 'submitted';
    safeToast(`Жалоба отправлена · ${SAFETY_REPORT_ID}`);
  });

  overlay.querySelector('#arp-safety-report-done').addEventListener('click', () => {
    overlay.dataset.report = 'idle';
    reportReason = null;
    showDefault();
  });

  // Emergency demo controls — all stubs, never a real dispatch.
  const sosTile = overlay.querySelector('#arp-safety-sos');
  if (sosTile) {
    sosTile.addEventListener('click', () => {
      if (overlay.dataset.sosState === 'pressed') return;
      overlay.dataset.sosState = 'pressed';
      sosTile.setAttribute('aria-pressed', 'true');
      safeToast('SOS — demo-режим, реальный вызов не отправляется');
    });
  }
  overlay.querySelectorAll('[data-emergency]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.getAttribute('data-emergency');
      safeToast(kind === '112'
        ? 'Звонок 112 — demo-режим, без реального вызова'
        : 'Уведомление контактов — пока заглушка');
    });
  });

  overlay.querySelector('#arp-safety-close').addEventListener('click', close);
  overlay.querySelector('#arp-safety-close-btn').addEventListener('click', close);
  overlay.querySelector('.passenger-safety-overlay__backdrop').addEventListener('click', () => {
    if (overlay.dataset.view !== 'default') { showDefault(); return; }
    close();
  });

  root.appendChild(overlay);
  return overlay;
}

// ── BD-RIDE-P-06 PassengerCancelRideSheet ────────────────────
// Single bottom sheet whose stage lives in overlay.dataset.stage:
//   "default"          — reasons unselected
//   "reason_selected"  — a reason is chosen → comment field revealed
//   "validation_error" — confirm pressed with no reason → inline error
//   "loading"          — "Отменяем…" while the cancel is persisted
//   "canceled"         — terminal confirmation card (in-sheet)
// onConfirm(reasonId, comment) is the data-layer hook owned by the
// passenger screen: it persists CANCELED + syncs the canonical order and
// returns { tripLabel, timeLabel } for the canceled card.
const CANCEL_REASONS = [
  { id: 'changed_mind',  label: 'Передумал' },
  { id: 'driver_far',    label: 'Водитель далеко' },
  { id: 'address_error', label: 'Ошибка в адресе' },
  { id: 'other_way',     label: 'Нашёл другой способ' },
  { id: 'other',         label: 'Другая причина' },
];

function cancelReasonsHtml() {
  return CANCEL_REASONS.map((r) => `
    <button type="button"
      class="passenger-cancel-sheet__reason"
      role="radio"
      aria-checked="false"
      data-reason-id="${escAttr(r.id)}">
      <span class="passenger-cancel-sheet__reason-text">${escapeHtml(r.label)}</span>
      <span class="passenger-cancel-sheet__reason-radio" aria-hidden="true"></span>
    </button>
  `).join('');
}

export function openPassengerCancelSheet(root, options = {}) {
  if (!root) return null;
  const existing = root.querySelector('.passenger-cancel-overlay');
  if (existing) return existing;

  const onConfirm = typeof options.onConfirm === 'function' ? options.onConfirm : null;
  const tripLabel = options.tripLabel || DEMO_TRIP_LABEL;

  const overlay = document.createElement('div');
  overlay.className = 'passenger-cancel-overlay';
  overlay.dataset.stage = 'default';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'arp-cancel-title');

  overlay.innerHTML = `
    <div class="passenger-cancel-overlay__backdrop" aria-hidden="true"></div>

    <div class="passenger-cancel-sheet">
      <div class="passenger-cancel-sheet__handle" aria-hidden="true"></div>
      <div class="passenger-cancel-sheet__header">
        <div class="passenger-cancel-sheet__pill">
          <span class="passenger-cancel-sheet__pill-dot" aria-hidden="true"></span>
          Отмена поездки
        </div>
        <button type="button" class="passenger-cancel-sheet__close" id="arp-cancel-close" aria-label="Закрыть">
          ${CLOSE_SVG}
        </button>
      </div>

      <!-- FORM (default / reason_selected / validation_error / loading) -->
      <div class="passenger-cancel-sheet__form">
        <div id="arp-cancel-title" class="passenger-cancel-sheet__title">Отменить поездку?</div>

        <div class="passenger-cancel-sheet__warning" role="note">
          <span class="passenger-cancel-sheet__warning-ic" aria-hidden="true">${ALERT_TRI_SVG}</span>
          Водитель уже в пути. Отмена может повлиять на рейтинг.
        </div>

        <div class="passenger-cancel-sheet__list-label">Причина отмены</div>
        <div class="passenger-cancel-sheet__reasons" role="radiogroup" aria-label="Причина отмены">
          ${cancelReasonsHtml()}
        </div>

        <div class="passenger-cancel-sheet__error" id="arp-cancel-error" role="alert">
          Выберите причину отмены, чтобы продолжить
        </div>

        <div class="passenger-cancel-sheet__comment">
          <label class="passenger-cancel-sheet__comment-label" for="arp-cancel-comment">Комментарий (необязательно)</label>
          <textarea class="passenger-cancel-sheet__comment-input"
            id="arp-cancel-comment"
            rows="2"
            placeholder="Добавьте детали для водителя"></textarea>
        </div>

        <div class="passenger-cancel-sheet__policy" role="note">
          <span class="passenger-cancel-sheet__policy-dot" aria-hidden="true"></span>
          Если водитель ещё далеко, отмена бесплатна и не влияет на рейтинг.
        </div>

        <div class="passenger-cancel-sheet__actions">
          <button type="button" class="passenger-cancel-sheet__btn-back" id="arp-cancel-back">
            Назад к поездке
          </button>
          <button type="button" class="passenger-cancel-sheet__btn-confirm" id="arp-cancel-confirm">
            <span class="passenger-cancel-sheet__btn-confirm-default">Отменить поездку</span>
            <span class="passenger-cancel-sheet__btn-confirm-loading">
              <span class="passenger-cancel-sheet__spinner" aria-hidden="true">${SPINNER_SVG}</span>
              Отменяем…
            </span>
          </button>
        </div>
      </div>

      <!-- DONE (canceled) -->
      <div class="passenger-cancel-sheet__done" role="status" aria-live="polite">
        <div class="passenger-cancel-sheet__done-icon" aria-hidden="true">${CHECK_SVG}</div>
        <div class="passenger-cancel-sheet__done-title">Поездка отменена</div>
        <div class="passenger-cancel-sheet__done-meta" id="arp-cancel-done-meta">${escapeHtml(tripLabel)} · отменено в 14:21</div>
        <div class="passenger-cancel-sheet__done-actions">
          <button type="button" class="passenger-cancel-sheet__done-primary" id="arp-cancel-new">
            <span class="passenger-cancel-sheet__done-ic" aria-hidden="true">${PLUS_SVG}</span>
            Создать новую поездку
          </button>
          <button type="button" class="passenger-cancel-sheet__done-secondary" id="arp-cancel-feed">
            Вернуться в ленту
          </button>
        </div>
      </div>
    </div>
  `;

  let selectedReason = null;
  let cancelTimer = null;
  const reasonBtns = Array.from(overlay.querySelectorAll('.passenger-cancel-sheet__reason'));
  const confirmBtn = overlay.querySelector('#arp-cancel-confirm');
  const commentInput = overlay.querySelector('#arp-cancel-comment');
  const doneMeta = overlay.querySelector('#arp-cancel-done-meta');

  function close() {
    if (cancelTimer) { clearTimeout(cancelTimer); cancelTimer = null; }
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }

  function onKey(ev) {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    // Don't allow Escape to dismiss the terminal canceled card or interrupt
    // the in-flight loading transition — only the form stages are dismissible.
    if (overlay.dataset.stage === 'canceled' || overlay.dataset.stage === 'loading') return;
    close();
  }
  document.addEventListener('keydown', onKey);

  reasonBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedReason = btn.dataset.reasonId || null;
      reasonBtns.forEach((b) => b.setAttribute('aria-checked', b === btn ? 'true' : 'false'));
      overlay.dataset.stage = selectedReason ? 'reason_selected' : 'default';
    });
  });

  overlay.querySelector('#arp-cancel-back').addEventListener('click', close);
  overlay.querySelector('#arp-cancel-close').addEventListener('click', close);

  confirmBtn.addEventListener('click', () => {
    if (overlay.dataset.stage === 'loading') return;
    if (!selectedReason) {
      overlay.dataset.stage = 'validation_error';
      return;
    }
    overlay.dataset.stage = 'loading';
    confirmBtn.disabled = true;
    const comment = commentInput ? commentInput.value.trim() : '';
    // Persist immediately so the cancel is durable even if the brief
    // loading delay is interrupted; the screen returns the display meta.
    const meta = (onConfirm && onConfirm(selectedReason, comment)) || {};
    cancelTimer = setTimeout(() => {
      cancelTimer = null;
      if (doneMeta) {
        const label = meta.tripLabel || tripLabel;
        const time = meta.timeLabel || '14:21';
        doneMeta.textContent = `${label} · отменено в ${time}`;
      }
      overlay.dataset.stage = 'canceled';
    }, 600);
  });

  overlay.querySelector('#arp-cancel-new').addEventListener('click', () => {
    close();
    go('/new');
  });
  overlay.querySelector('#arp-cancel-feed').addEventListener('click', () => {
    close();
    go('/feed');
  });

  overlay.querySelector('.passenger-cancel-overlay__backdrop').addEventListener('click', () => {
    if (overlay.dataset.stage === 'canceled' || overlay.dataset.stage === 'loading') return;
    close();
  });

  root.appendChild(overlay);
  return overlay;
}
