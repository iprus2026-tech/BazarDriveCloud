// BD-RIDE-D-SHEETS-01 — Driver active-ride bottom sheets.
//
// Driver counterpart of the passenger sheets (BD-RIDE-SHEETS-01, see
// active_ride_passenger_sheets.js). Houses the two driver-side overlays:
//   • DriverCancelRideSheet  — отмена активного заказа (reason + custom
//     reason textarea + validation + loading + in-sheet canceled card)
//   • DriverProblemSheet     — сигнал о проблеме (type + safety visual
//     state + optional comment + submit loading + sent card)
//
// This module owns ONLY the sheet UI and its in-sheet state machines. It
// never persists ride state, calls a backend, dials a number or dispatches
// a real SOS — every "live" action is a safe demo stub. Persistence
// (CANCELED / NO_SHOW status + canonical ride-order sync) stays in the
// driver screen's onConfirm callback so the data layer keeps a single
// owner. The problem sheet never changes ride status at all.
//
// Style rules (enforced by scripts/check.mjs): no inline styles, no
// .style mutations — every visual state is toggled through class names and
// data-* attributes, with all CSS living in public/styles/cloud.css.

import { escapeHtml } from '../util.js';
import { go } from '../router.js';

// ── Local icon set ───────────────────────────────────────────
// Self-contained SVG glyphs so this module needs no import back into the
// driver screen (mirrors active_ride_passenger_sheets.js).
const SPINNER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" width="16" height="16">
  <circle cx="12" cy="12" r="9" stroke-opacity="0.25"/>
  <path d="M21 12a9 9 0 0 1-9 9"/>
</svg>`;

const CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="22" height="22">
  <polyline points="20 6 9 17 4 12"/>
</svg>`;

const CLOSE_RING_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="22" height="22">
  <line x1="18" y1="6" x2="6" y2="18"/>
  <line x1="6" y1="6" x2="18" y2="18"/>
</svg>`;

const ALERT_TRI_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
  <line x1="12" y1="9" x2="12" y2="13"/>
  <line x1="12" y1="17" x2="12.01" y2="17"/>
</svg>`;

// BD-RIDE-D-07 — Driver cancel reasons. The internal codes are fixed by
// the issue #265 contract; the second/third columns are Russian UI copy.
// Mock only — selecting a reason never extends or mutates ride_state.
export const DRIVER_CANCEL_REASONS = [
  ['passenger_no_show', 'Пассажир не вышел', 'Жду у точки подачи, пассажира нет'],
  ['wrong_pickup', 'Неверная точка подачи', 'Адрес или подъезд указан неправильно'],
  ['car_problem', 'Проблема с автомобилем', 'Не могу безопасно продолжить подачу'],
  ['unsafe_situation', 'Небезопасная ситуация', 'Есть риск для водителя или пассажира'],
  ['cannot_reach_passenger', 'Не могу связаться с пассажиром', 'Нет ответа в чате и по телефону'],
  ['other', 'Другая причина', 'Опишу подробнее ниже'],
];

// Reason label lookup used by the driver screen's canceled stub to show
// the reason without re-deriving the strings.
export const DRIVER_CANCEL_REASON_LABEL_BY_CODE = Object.fromEntries(
  DRIVER_CANCEL_REASONS.map(([code, label]) => [code, label]),
);

// BD-RIDE-D-08 — Driver problem types are pure UI placeholders. None of
// them changes ride status; each only surfaces local/toast feedback. The
// safety-class types flip the sheet into the danger visual state.
const DRIVER_PROBLEM_TYPES = [
  ['passenger_no_show', 'Пассажир не выходит', 'Уведомим пассажира, что вы ждёте', false],
  ['cannot_reach', 'Не могу дозвониться', 'Отметим, что связи с пассажиром нет', false],
  ['wrong_pickup', 'Неверная точка подачи', 'Передадим, что адрес подачи неверный', false],
  ['car_problem', 'Проблема с авто', 'Зафиксируем неполадку с автомобилем', true],
  ['safety', 'Угроза безопасности', 'Сообщим в поддержку о небезопасной ситуации', true],
  ['contact_support', 'Связаться с поддержкой', 'Откроем обращение в поддержку', false],
];

function problemActionNotice(code) {
  switch (code) {
    case 'passenger_no_show': return 'Пассажиру отправлено напоминание, что вы ждёте';
    case 'cannot_reach': return 'Поддержка увидит, что связи с пассажиром нет';
    case 'wrong_pickup': return 'Жалоба на точку подачи отправлена';
    case 'car_problem': return 'Проблема с авто зафиксирована';
    case 'safety': return 'Сигнал о безопасности отправлен в поддержку';
    case 'contact_support': return 'Обращение в поддержку открыто';
    default: return 'Сообщение отправлено в поддержку';
  }
}

// Default head-right slot for cancel + problem sheets. Earnings sheet (D-11)
// passes a per-variant status pill instead — dismiss is still available via
// backdrop / Escape / primary CTA.
const CLOSE_X_HTML = '<button type="button" class="active-ride-driver-sheet__close" aria-label="Закрыть" data-driver-sheet-close="true">×</button>';

// ── Shared overlay shell ─────────────────────────────────────
function sheetShell(kind, titleId, eyebrow, title, bodyHtml, headRight = CLOSE_X_HTML) {
  return `
    <div class="active-ride-driver-sheet__backdrop" data-driver-sheet-close="true" aria-hidden="true"></div>
    <section class="active-ride-driver-sheet__panel" role="dialog" aria-modal="true" aria-labelledby="${escapeHtml(titleId)}" tabindex="-1">
      <div class="active-ride-driver-sheet__handle" aria-hidden="true"></div>
      <div class="active-ride-driver-sheet__head">
        <div>
          <div class="active-ride-driver-sheet__eyebrow">${escapeHtml(eyebrow)}</div>
          <h2 class="active-ride-driver-sheet__title" id="${escapeHtml(titleId)}">${escapeHtml(title)}</h2>
        </div>
        ${headRight}
      </div>
      ${bodyHtml}
    </section>
  `;
}

function focusableIn(overlay) {
  return Array.from(overlay.querySelectorAll('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'))
    .filter((el) => !el.disabled && !el.hidden && el.offsetParent !== null);
}

// ── BD-RIDE-D-07 DriverCancelRideSheet ───────────────────────
// Stage lives in overlay.dataset.stage:
//   "default"          — reasons unselected
//   "reason_selected"  — a reason is chosen (custom textarea for "other")
//   "validation_error" — confirm pressed with no reason → inline error
//   "loading"          — "Отменяем…" while the cancel is persisted
//   "canceled"         — terminal in-sheet card
// overlay.dataset.custom === "true" reveals the custom-reason textarea.
// onConfirm(reasonCode, customText) is the data-layer hook owned by the
// driver screen; outcomeLabel keeps the no-show vs cancel copy accurate.
function cancelOptionsHtml(selected) {
  return DRIVER_CANCEL_REASONS.map(([value, label, meta]) => `
    <button type="button" class="driver-cancel-sheet__option${selected === value ? ' driver-cancel-sheet__option--selected' : ''}" role="radio" aria-checked="${selected === value ? 'true' : 'false'}" data-value="${escapeHtml(value)}">
      <span class="driver-cancel-sheet__radio" aria-hidden="true"></span>
      <span class="driver-cancel-sheet__option-copy">
        <span class="driver-cancel-sheet__option-label">${escapeHtml(label)}</span>
        <span class="driver-cancel-sheet__option-meta">${escapeHtml(meta)}</span>
      </span>
    </button>
  `).join('');
}

export function renderDriverCancelSheet(selected = '') {
  const body = `
    <div class="active-ride-driver-sheet__form driver-cancel-sheet__form">
      <p class="driver-cancel-sheet__lead">Выберите причину. Пассажир получит уведомление об отмене.</p>
      <div class="driver-cancel-sheet__options" role="radiogroup" aria-label="Причина отмены">${cancelOptionsHtml(selected)}</div>
      <div class="driver-cancel-sheet__custom">
        <label class="driver-cancel-sheet__custom-label" for="driver-cancel-custom">Опишите причину</label>
        <textarea class="driver-cancel-sheet__textarea" id="driver-cancel-custom" rows="2" placeholder="Расскажите, что случилось"></textarea>
      </div>
      <div class="driver-cancel-sheet__error" id="driver-cancel-error" role="alert">
        <span class="driver-cancel-sheet__error-ic" aria-hidden="true">${ALERT_TRI_SVG}</span>
        Выберите причину отмены, чтобы продолжить
      </div>
      <div class="active-ride-driver-sheet__actions driver-cancel-sheet__cta">
        <button type="button" class="active-ride-driver-sheet__btn active-ride-driver-sheet__btn--ghost" data-driver-sheet-close="true">Вернуться к поездке</button>
        <button type="button" class="active-ride-driver-sheet__btn active-ride-driver-sheet__btn--danger" id="driver-cancel-confirm">
          <span class="active-ride-driver-sheet__btn-default">Отменить заказ</span>
          <span class="active-ride-driver-sheet__btn-loading"><span class="active-ride-driver-sheet__spinner" aria-hidden="true">${SPINNER_SVG}</span>Отменяем…</span>
        </button>
      </div>
    </div>
    <div class="driver-cancel-sheet__done" role="status" aria-live="polite">
      <div class="driver-cancel-sheet__done-icon" aria-hidden="true">${CLOSE_RING_SVG}</div>
      <div class="driver-cancel-sheet__done-title" id="driver-cancel-done-title">Поездка отменена</div>
      <div class="driver-cancel-sheet__done-text" id="driver-cancel-done-text">Мы закрыли этот заказ. Пассажиру отправлено уведомление.</div>
      <div class="driver-cancel-sheet__done-reason" id="driver-cancel-done-reason"></div>
      <div class="driver-cancel-sheet__done-actions">
        <button type="button" class="active-ride-driver-sheet__btn active-ride-driver-sheet__btn--accent" id="driver-cancel-back-feed">Вернуться в ленту</button>
        <button type="button" class="active-ride-driver-sheet__btn active-ride-driver-sheet__btn--ghost" id="driver-cancel-close-done">Закрыть</button>
      </div>
    </div>
  `;
  return sheetShell('cancel', 'driver-cancel-title', 'Отмена заказа', 'Почему отменяем заказ?', body);
}

// ── BD-RIDE-D-08 DriverProblemSheet ──────────────────────────
// Stage lives in overlay.dataset.stage:
//   "default"        — no type selected
//   "type_selected"  — a type is chosen → comment field revealed
//   "loading"        — "Отправляем…" while the signal is "sent"
//   "sent"           — terminal in-sheet card
// overlay.dataset.safety === "true" when a safety-class type is selected.
function problemTypesHtml() {
  return DRIVER_PROBLEM_TYPES.map(([value, label, meta, safety]) => `
    <button type="button" class="driver-problem-sheet__action" role="radio" aria-checked="false" data-value="${escapeHtml(value)}" data-safety="${safety ? 'true' : 'false'}">
      <span class="driver-problem-sheet__action-copy">
        <span class="driver-problem-sheet__action-label">${escapeHtml(label)}</span>
        <span class="driver-problem-sheet__action-meta">${escapeHtml(meta)}</span>
      </span>
      <span class="driver-problem-sheet__action-radio" aria-hidden="true"></span>
    </button>
  `).join('');
}

export function renderDriverProblemSheet() {
  const body = `
    <div class="active-ride-driver-sheet__form driver-problem-sheet__form">
      <p class="driver-problem-sheet__lead">Отправьте сигнал поддержке. Поездка останется активной — статус не изменится.</p>
      <div class="driver-problem-sheet__safety-note" role="note">
        <span class="driver-problem-sheet__safety-ic" aria-hidden="true">${ALERT_TRI_SVG}</span>
        Если есть угроза безопасности — сначала звоните 112. Это демо-режим, реальный вызов не выполняется.
      </div>
      <div class="driver-problem-sheet__actions" role="radiogroup" aria-label="Тип проблемы">${problemTypesHtml()}</div>
      <div class="driver-problem-sheet__comment">
        <label class="driver-problem-sheet__comment-label" for="driver-problem-comment">Комментарий (необязательно)</label>
        <textarea class="driver-problem-sheet__comment-input" id="driver-problem-comment" rows="2" placeholder="Добавьте детали для поддержки"></textarea>
      </div>
      <div class="active-ride-driver-sheet__actions driver-problem-sheet__cta">
        <button type="button" class="active-ride-driver-sheet__btn active-ride-driver-sheet__btn--ghost" data-driver-sheet-close="true">Закрыть</button>
        <button type="button" class="active-ride-driver-sheet__btn active-ride-driver-sheet__btn--accent" id="driver-problem-submit" disabled>
          <span class="active-ride-driver-sheet__btn-default">Отправить сигнал</span>
          <span class="active-ride-driver-sheet__btn-loading"><span class="active-ride-driver-sheet__spinner" aria-hidden="true">${SPINNER_SVG}</span>Отправляем…</span>
        </button>
      </div>
    </div>
    <div class="driver-problem-sheet__done" role="status" aria-live="polite">
      <div class="driver-problem-sheet__done-icon" aria-hidden="true">${CHECK_SVG}</div>
      <div class="driver-problem-sheet__done-title">Сигнал отправлен</div>
      <div class="driver-problem-sheet__done-text" id="driver-problem-done-text">Поддержка получила ваше сообщение.</div>
      <div class="driver-problem-sheet__done-actions">
        <button type="button" class="active-ride-driver-sheet__btn active-ride-driver-sheet__btn--accent" id="driver-problem-done-close">Готово</button>
      </div>
    </div>
  `;
  return sheetShell('problem', 'driver-problem-title', 'Сообщить о проблеме', 'Что случилось?', body);
}

// ── Shared behaviour wiring ──────────────────────────────────
// Wires selection / validation / confirm / loading / submit for whichever
// sheet kind the overlay carries. Kept as a single exported entry point so
// the driver screen can bind a pre-rendered overlay if needed.
export function bindDriverSheetEvents(overlay, options = {}) {
  const kind = overlay.dataset.kind;
  if (kind === 'cancel') bindCancelEvents(overlay, options);
  else if (kind === 'problem') bindProblemEvents(overlay, options);
  else if (kind === 'earnings') bindEarningsEvents(overlay, options);
  bindSheetChrome(overlay, options);
}

function bindSheetChrome(overlay, options) {
  const isLocked = () => overlay.dataset.stage === 'loading'
    || overlay.dataset.stage === 'canceled'
    || overlay.dataset.stage === 'sent';

  function close() {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    if (typeof options.onClose === 'function') options.onClose();
  }
  overlay.__closeSheet = close;

  function onKey(ev) {
    if (ev.key === 'Tab') {
      const items = focusableIn(overlay);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
      return;
    }
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    if (isLocked()) return; // never dismiss mid-flow or a terminal card
    close();
  }
  document.addEventListener('keydown', onKey);

  // Dismiss controls (X, backdrop, "Вернуться к поездке"/"Закрыть") share
  // the data-driver-sheet-close hook; locked stages ignore them.
  overlay.addEventListener('click', (ev) => {
    const target = ev.target instanceof Element ? ev.target.closest('[data-driver-sheet-close="true"]') : null;
    if (!target) return;
    if (isLocked()) return;
    close();
  });
}

function bindCancelEvents(overlay, options) {
  const resolveOutcome = typeof options.outcomeLabel === 'function'
    ? options.outcomeLabel
    : () => (options.outcomeLabel || 'CANCELED');
  let selected = DRIVER_CANCEL_REASONS.some(([v]) => v === options.reason) ? options.reason : '';

  const optionBtns = Array.from(overlay.querySelectorAll('.driver-cancel-sheet__option'));
  const confirm = overlay.querySelector('#driver-cancel-confirm');
  const customInput = overlay.querySelector('#driver-cancel-custom');

  function syncSelection() {
    optionBtns.forEach((btn) => {
      const on = btn.dataset.value === selected;
      btn.classList.toggle('driver-cancel-sheet__option--selected', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    overlay.dataset.custom = selected === 'other' ? 'true' : 'false';
    if (selected && overlay.dataset.stage === 'default') overlay.dataset.stage = 'reason_selected';
    if (selected && overlay.dataset.stage === 'validation_error') overlay.dataset.stage = 'reason_selected';
  }

  optionBtns.forEach((btn) => btn.addEventListener('click', () => {
    selected = btn.dataset.value || '';
    syncSelection();
    if (selected === 'other' && customInput) customInput.focus();
  }));

  confirm.addEventListener('click', () => {
    if (overlay.dataset.stage === 'loading' || overlay.dataset.stage === 'canceled') return;
    if (!selected) { overlay.dataset.stage = 'validation_error'; return; }
    overlay.dataset.stage = 'loading';
    const customText = customInput ? customInput.value.trim() : '';
    // Persist immediately so the cancel is durable even if the brief
    // loading delay is interrupted; the screen owns the data layer.
    if (typeof options.onConfirm === 'function') options.onConfirm(selected, customText);
    const outcome = resolveOutcome(selected);
    const noShow = outcome === 'NO_SHOW';
    const reasonLabel = DRIVER_CANCEL_REASON_LABEL_BY_CODE[selected] || '';
    setTimeout(() => {
      const title = overlay.querySelector('#driver-cancel-done-title');
      const text = overlay.querySelector('#driver-cancel-done-text');
      const reasonRow = overlay.querySelector('#driver-cancel-done-reason');
      if (title) title.textContent = noShow ? 'Пассажир не вышел' : 'Поездка отменена';
      if (text) {
        text.textContent = noShow
          ? 'Заказ закрыт со статусом «пассажир не вышел». Пассажиру отправлено уведомление.'
          : 'Мы закрыли этот заказ. Пассажиру отправлено уведомление.';
      }
      if (reasonRow) reasonRow.textContent = reasonLabel ? `Причина: ${reasonLabel}` : '';
      overlay.dataset.stage = 'canceled';
    }, 600);
  });

  overlay.querySelector('#driver-cancel-back-feed').addEventListener('click', () => {
    overlay.__closeSheet && overlay.__closeSheet();
    go('/feed');
  });
  overlay.querySelector('#driver-cancel-close-done').addEventListener('click', () => {
    overlay.__closeSheet && overlay.__closeSheet();
  });

  syncSelection();
}

function bindProblemEvents(overlay, options) {
  let selectedType = '';
  const typeBtns = Array.from(overlay.querySelectorAll('.driver-problem-sheet__action'));
  const submit = overlay.querySelector('#driver-problem-submit');

  typeBtns.forEach((btn) => btn.addEventListener('click', () => {
    // Once the signal is in flight (loading) or delivered (sent) the type is
    // frozen — re-selecting must not roll dataset.stage back and unlock the card.
    if (overlay.dataset.stage === 'loading' || overlay.dataset.stage === 'sent') return;
    selectedType = btn.dataset.value || '';
    typeBtns.forEach((b) => b.setAttribute('aria-checked', b === btn ? 'true' : 'false'));
    overlay.dataset.stage = selectedType ? 'type_selected' : 'default';
    overlay.dataset.safety = btn.dataset.safety === 'true' ? 'true' : 'false';
    if (submit) submit.disabled = !selectedType;
  }));

  submit.addEventListener('click', () => {
    if (!selectedType || overlay.dataset.stage === 'loading' || overlay.dataset.stage === 'sent') return;
    overlay.dataset.stage = 'loading';
    // Belt-and-suspenders: disable inputs so nothing can mutate the in-flight sheet.
    typeBtns.forEach((btn) => { btn.disabled = true; });
    submit.disabled = true;
    const message = problemActionNotice(selectedType);
    setTimeout(() => {
      const doneText = overlay.querySelector('#driver-problem-done-text');
      if (doneText) doneText.textContent = message;
      overlay.dataset.stage = 'sent';
      if (typeof options.onAction === 'function') options.onAction(message);
    }, 600);
  });

  // The terminal "Готово" is an explicit exit: the shared close handler is
  // locked during the sent stage so the backdrop/Esc can't dismiss the card.
  overlay.querySelector('#driver-problem-done-close').addEventListener('click', () => {
    overlay.__closeSheet && overlay.__closeSheet();
  });
}

function openDriverSheet(root, kind, markup, options) {
  if (!root) return null;
  // Single-instance guard — only one driver sheet open at a time.
  const existing = root.querySelector('.active-ride-driver-sheet');
  if (existing) return existing;

  const overlay = document.createElement('div');
  overlay.className = `active-ride-driver-sheet active-ride-driver-sheet--${kind}`;
  overlay.dataset.kind = kind;
  overlay.dataset.stage = 'default';
  if (kind === 'problem') overlay.dataset.safety = 'false';
  overlay.innerHTML = markup;

  bindDriverSheetEvents(overlay, options);
  root.appendChild(overlay);

  const panel = overlay.querySelector('.active-ride-driver-sheet__panel');
  if (panel && typeof panel.focus === 'function') panel.focus();
  return overlay;
}

// BD-RIDE-D-07 — open the driver cancel sheet. onConfirm(code, customText)
// is the persistence hook; outcomeLabel ('CANCELED' | 'NO_SHOW' or a
// function of the code) keeps the terminal-card copy accurate.
export function openDriverCancelSheet(root, options = {}) {
  return openDriverSheet(root, 'cancel', renderDriverCancelSheet(options.reason || ''), options);
}

// BD-RIDE-D-08 — open the driver problem sheet. Pure UI placeholder:
// surfaces inline + toast feedback (onAction) and never changes ride status.
export function openDriverProblemSheet(root, options = {}) {
  return openDriverSheet(root, 'problem', renderDriverProblemSheet(), options);
}

// ── BD-RIDE-D-09 DriverEarningsSheet ─────────────────────────
// Terminal completion sheet for the driver completed flow, ported from the
// Cloud Design render gate (de-* namespace). It is a regular driver overlay
// (active-ride-driver-sheet shell + light dim over the completed map) with
// seven states carried on overlay.dataset.stage:
//   "summary"  — earnings hero + fare → commission → tip → net breakdown
//   "cash"     — cash badge + "Оплату получил" confirm gating the primary
//   "noncash"  — blue balance preview card (mock balance + delta)
//   "shift"    — 3-up stat grid + calm "Такси · ИП" UI hint
//   "loading"  — optimistic close spinner, mock 1.4s → "closed"
//   "closed"   — calm "Вы снова на линии" (driver stays online/searching)
//   "empty"    — fallback when the earnings payload is absent/malformed
// All money is pre-formatted by the driver screen and passed in via options;
// this module never imports ride_state or touches real payments/tax.
const EARNINGS_STATES = new Set(['summary', 'cash', 'noncash', 'shift', 'loading', 'closed', 'empty']);

function normalizeEarningsPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.netLabel !== 'string' || !payload.netLabel) return null;
  if (typeof payload.fareLabel !== 'string' || !payload.fareLabel) return null;
  return payload;
}

// The entry stage comes from ?state=; an invalid value falls back to
// "summary", and a missing/malformed payload forces "empty".
function resolveEarningsState(state, payload) {
  if (!normalizeEarningsPayload(payload)) return 'empty';
  return EARNINGS_STATES.has(state) ? state : 'summary';
}

function earningsHeroHtml(p) {
  return `
    <div class="de-earn__hero">
      <div class="de-earn__hero-label">Заработок за поездку</div>
      <div class="de-earn__hero-value" aria-label="Заработок: ${escapeHtml(p.netAria || p.netLabel)}">${escapeHtml(p.netLabel)}</div>
      <div class="de-earn__hero-route">${escapeHtml(p.dropoffLabel || 'Поездка завершена')}</div>
    </div>`;
}

function earningsRowsHtml(p) {
  return `
    <div class="de-earn__rows" role="list" aria-label="Разбивка поездки">
      <div class="de-earn__row" role="listitem"><span>Стоимость поездки</span><strong>${escapeHtml(p.fareLabel)}</strong></div>
      <div class="de-earn__row" role="listitem"><span>Комиссия сервиса · ${escapeHtml(p.commissionPctLabel || '')}</span><strong>${escapeHtml(p.commissionAmountLabel)}</strong></div>
      <div class="de-earn__row" role="listitem"><span>Чаевые / бонус</span><strong>${escapeHtml(p.tipLabel)}</strong></div>
      <div class="de-earn__note" role="listitem">Доход = стоимость поездки − комиссия + чаевые</div>
      <div class="de-earn__divider" aria-hidden="true"></div>
      <div class="de-earn__row de-earn__row--total" role="listitem"><span>Итого водителю</span><strong class="de-earn__total">${escapeHtml(p.netLabel)}</strong></div>
    </div>`;
}

function earningsBadgeHtml(kind) {
  return kind === 'cash'
    ? '<span class="de-pay-badge cash">Оплата наличными</span>'
    : '<span class="de-pay-badge noncash">Безналичный расчёт</span>';
}

// BD-RIDE-D-11 — header status pill (replaces the close X for the earnings
// sheet across all variants; dismiss stays available via primary CTA,
// backdrop click, and Escape).
function earningsPillHtml(variant) {
  if (variant === 'cash') return '<span class="de-pill de-pill--cash">Оплата наличными</span>';
  if (variant === 'noncash') return '<span class="de-pill de-pill--noncash">Безналичный расчёт</span>';
  return '<span class="de-pill de-pill--ok">Завершено</span>';
}

// BD-RIDE-D-11 — compact passenger context row matching reference state 1.
// Lightweight by design: no message/call icons or phone/luggage line (the
// fuller .active-ride__passenger row used in en-route / waiting stays in
// active_ride.js). Renders only for summary / cash / noncash; the shift /
// loading / closed / empty stages skip it.
function earningsPassengerHtml(p) {
  return `
    <div class="de-passenger">
      <div class="de-passenger__avatar" aria-hidden="true">${escapeHtml(p.passengerInitials || 'АМ')}</div>
      <div class="de-passenger__info">
        <div class="de-passenger__name">${escapeHtml(p.passengerName || '')}</div>
        <div class="de-passenger__route">
          <div class="de-passenger__pickup">${escapeHtml(p.pickupLabel || '')}</div>
          <div class="de-passenger__dropoff">${escapeHtml(p.dropoffLabel || '')}</div>
        </div>
      </div>
      <div class="de-passenger__metrics" aria-hidden="true">
        <div>${escapeHtml(p.distanceLabel || '')}</div>
        <div>${escapeHtml(p.durationLabel || '')}</div>
      </div>
    </div>`;
}

// BD-RIDE-D-11 — secondary nav row under the primary CTA. Routes are wired
// by the driver screen (onOrders / onFeed). Renders only for summary /
// cash / noncash variants.
function earningsSecondaryHtml() {
  return `
    <div class="de-earn__secondary">
      <button type="button" class="active-ride-driver-sheet__btn active-ride-driver-sheet__btn--ghost" id="driver-earnings-orders">Открыть заказы</button>
      <button type="button" class="active-ride-driver-sheet__btn active-ride-driver-sheet__btn--ghost" id="driver-earnings-feed">В ленту</button>
    </div>`;
}

function earningsConfirmHtml() {
  return `
    <button type="button" class="de-confirm" id="driver-earnings-confirm" aria-pressed="false">
      <span class="de-check" aria-hidden="true">${CHECK_SVG}</span>
      <span class="de-confirm__label">Оплату получил наличными</span>
    </button>`;
}

function earningsBalanceHtml(p) {
  return `
    <div class="de-balance">
      <div class="de-balance__top">
        <div>
          <div class="de-balance__label">Баланс</div>
          <div class="de-balance__value">${escapeHtml(p.balanceLabel || '')}</div>
        </div>
        <div class="de-balance__delta">${escapeHtml(p.balanceDeltaLabel || '')}</div>
      </div>
      <div class="de-balance__hint">Деньги за поездку зачислятся на ваш баланс.</div>
    </div>`;
}

function earningsStatgridHtml(p) {
  const stats = Array.isArray(p.stats) ? p.stats : [];
  const cells = stats.map((s) => `
    <div class="de-stat" role="listitem">
      <div class="de-stat__val">${escapeHtml(s.val)}</div>
      <div class="de-stat__lbl">${escapeHtml(s.lbl)}</div>
    </div>`).join('');
  return `
    <div class="de-statgrid" role="list" aria-label="Смена сегодня">${cells}</div>
    <div class="de-earn__taxnote">Такси · ИП · автоналог считается отдельно</div>`;
}

// Builds the visible earnings content for the chosen variant. summary/cash/
// noncash share the breakdown rows; shift swaps them for the stat grid.
// BD-RIDE-D-11 — summary/cash/noncash also get the passenger context row
// above the hero and the secondary nav row under the primary CTA.
function earningsContentHtml(variant, p) {
  let inner;
  if (variant === 'shift') {
    inner = earningsStatgridHtml(p);
  } else if (variant === 'cash') {
    inner = earningsBadgeHtml('cash') + earningsRowsHtml(p) + earningsConfirmHtml();
  } else if (variant === 'noncash') {
    inner = earningsBadgeHtml('noncash') + earningsRowsHtml(p) + earningsBalanceHtml(p);
  } else {
    inner = earningsRowsHtml(p);
  }
  const disabled = variant === 'cash' ? ' disabled' : '';
  const showPassenger = variant === 'summary' || variant === 'cash' || variant === 'noncash';
  return `
    <div class="de-earn">
      ${showPassenger ? earningsPassengerHtml(p) : ''}
      ${earningsHeroHtml(p)}
      ${inner}
      <div class="active-ride-driver-sheet__actions de-earn__cta">
        <button type="button" class="active-ride-driver-sheet__btn active-ride-driver-sheet__btn--accent de-earn__primary" id="driver-earnings-close"${disabled}>Закрыть поездку</button>
      </div>
      ${showPassenger ? earningsSecondaryHtml() : ''}
    </div>`;
}

export function renderDriverEarningsSheet(state, payload) {
  const p = normalizeEarningsPayload(payload);
  const resolved = resolveEarningsState(state, payload);
  // For loading/closed entry there is no chosen earn variant; render the
  // summary layout underneath (it stays hidden behind the stage overlay).
  const variant = (resolved === 'cash' || resolved === 'noncash' || resolved === 'shift') ? resolved : 'summary';
  const earnBlock = p ? earningsContentHtml(variant, p) : '';
  const body = `
    ${earnBlock}
    <div class="de-loading" role="status" aria-live="polite">
      <span class="de-loading__spinner active-ride-driver-sheet__spinner" aria-hidden="true">${SPINNER_SVG}</span>
      <div class="de-loading__text">Закрываем поездку…</div>
    </div>
    <div class="de-closed" role="status" aria-live="polite">
      <div class="de-closed__icon" aria-hidden="true">${CHECK_SVG}</div>
      <div class="de-closed__title">Вы снова на линии</div>
      <div class="de-closed__text">Поездка закрыта. Ищем для вас новые заказы поблизости.</div>
      <div class="active-ride-driver-sheet__actions">
        <button type="button" class="active-ride-driver-sheet__btn active-ride-driver-sheet__btn--accent" id="driver-earnings-online">К заказам</button>
      </div>
    </div>
    <div class="de-empty" role="status" aria-live="polite">
      <div class="de-empty__icon" aria-hidden="true">${ALERT_TRI_SVG}</div>
      <div class="de-empty__title">Нет данных о доходе</div>
      <div class="de-empty__text">Не удалось загрузить детали по этой поездке. Откройте ленту, чтобы продолжить работу.</div>
      <div class="active-ride-driver-sheet__actions">
        <button type="button" class="active-ride-driver-sheet__btn active-ride-driver-sheet__btn--accent" id="driver-earnings-empty-feed">Открыть ленту</button>
      </div>
    </div>
  `;
  const eyebrow = (p && p.tripNumberLabel) || 'Поездка';
  return sheetShell('earnings', 'driver-earnings-title', eyebrow, 'Поездка завершена', body, earningsPillHtml(variant));
}

function bindEarningsEvents(overlay, options) {
  const state = EARNINGS_STATES.has(options.state) ? options.state : 'summary';
  overlay.dataset.stage = state;

  const primary = overlay.querySelector('#driver-earnings-close');
  const confirm = overlay.querySelector('#driver-earnings-confirm');
  const online = overlay.querySelector('#driver-earnings-online');
  const emptyFeed = overlay.querySelector('#driver-earnings-empty-feed');

  let cashConfirmed = false;

  // Optimistic close: spinner for a beat, then the calm "снова на линии"
  // card. Mock only — no status mutation, no backend.
  function scheduleClose() {
    setTimeout(() => { overlay.dataset.stage = 'closed'; }, 1400);
  }
  function enterLoading() {
    if (overlay.dataset.stage === 'loading' || overlay.dataset.stage === 'closed') return;
    overlay.dataset.stage = 'loading';
    scheduleClose();
  }

  // Cash: the primary stays disabled until the driver confirms they took
  // the fare; toggling the confirm row flips both the visual + the button.
  if (confirm) {
    confirm.addEventListener('click', () => {
      cashConfirmed = !cashConfirmed;
      confirm.classList.toggle('on', cashConfirmed);
      confirm.setAttribute('aria-pressed', cashConfirmed ? 'true' : 'false');
      if (primary) primary.disabled = !cashConfirmed;
    });
  }

  if (primary) {
    primary.addEventListener('click', () => {
      if (primary.disabled) return;
      enterLoading();
    });
  }

  if (online) {
    online.addEventListener('click', () => {
      if (overlay.__closeSheet) overlay.__closeSheet();
      go('/driver-map');
    });
  }

  if (emptyFeed) {
    emptyFeed.addEventListener('click', () => {
      if (overlay.__closeSheet) overlay.__closeSheet();
      go('/feed');
    });
  }

  // BD-RIDE-D-11 — secondary nav row under the primary CTA. The driver
  // screen wires the route targets; fall back to /driver-map and /feed when
  // no callback is provided so the buttons are never dead ends.
  const ordersBtn = overlay.querySelector('#driver-earnings-orders');
  if (ordersBtn) {
    ordersBtn.addEventListener('click', () => {
      if (overlay.__closeSheet) overlay.__closeSheet();
      if (typeof options.onOrders === 'function') options.onOrders();
      else go('/driver-map');
    });
  }
  const feedBtn = overlay.querySelector('#driver-earnings-feed');
  if (feedBtn) {
    feedBtn.addEventListener('click', () => {
      if (overlay.__closeSheet) overlay.__closeSheet();
      if (typeof options.onFeed === 'function') options.onFeed();
      else go('/feed');
    });
  }

  // Direct ?state=loading entry runs the optimistic close timer immediately.
  if (state === 'loading') scheduleClose();
}

// BD-RIDE-D-09 — open the driver earnings / completion sheet. options.state
// is the entry stage (?state=); options.payload carries the pre-formatted
// earnings strings built by the driver screen. Both are normalized here so
// renderer and event wiring agree on the resolved state.
export function openDriverEarningsSheet(root, options = {}) {
  const state = resolveEarningsState(options.state, options.payload);
  const markup = renderDriverEarningsSheet(state, options.payload);
  return openDriverSheet(root, 'earnings', markup, { ...options, state });
}

// BD-RIDE-D-09 — prototype-parity global handle. The live app consumes the
// ES exports above; window.BD mirrors the standalone prototype's component
// name so design references resolve. Guarded so headless/smoke contexts
// (no window) stay unaffected.
if (typeof window !== 'undefined') {
  window.BD = window.BD || {};
  window.BD.DriverEarningsSheet = {
    open: openDriverEarningsSheet,
    render: renderDriverEarningsSheet,
  };
}
