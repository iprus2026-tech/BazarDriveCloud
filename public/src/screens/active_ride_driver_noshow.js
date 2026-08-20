// BD-RIDE-D-NOSHOW-01 — Driver no-show sub-flow.
//
// Ported from the Cloud Design no-show render gate (ns-* namespace). A
// sequence of in-layout sheet swaps rendered into the driver active-ride
// `.active-ride__sheet` element — NOT a modal overlay — matching the screen's
// existing renderWaiting / renderCanceledStub pattern. Opened from the
// WAITING_PASSENGER «Не приехал» (#ar-no-show) action in active_ride.js,
// replacing the prior cancel-sheet preset path.
//
// Seven states: action → confirm → submitting → result → compensation → done,
// with failure as an alternate branch off submitting (retry loops back to
// submitting; back exits the sub-flow without any local persistence).
// Mock/UI only: the compensation figures are fixed demo values. The ONLY
// persistence is the existing NO_SHOW transition, fired via the screen's
// onConfirmNoShow callback at the confirm step — BD-RIDE-D-NOSHOW-ACK-01
// (V2-04C2): that callback may be backend-ACK-first (returns a Promise), so
// the confirm step AWAITS it and only advances to `result` on success; on
// rejection it shows `failure` instead, with no local NO_SHOW write. The
// waiting/expired states from the gate are intentionally out of scope (they
// would redesign the live waiting UI).

import { escapeHtml } from '../util.js';

function svg(body, size = 24, sw = 2) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
const I_ALERT = '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>';
const I_CHECK = '<path d="M20 6 9 17l-5-5"/>';
const I_CARD  = '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M16 13h2"/><path d="M3 10h18"/>';
const I_CAR   = '<path d="M5 17h14M7 17v2M17 17v2"/><path d="M5 17v-3l2-5h10l2 5v3"/><circle cx="8" cy="14" r="1.2" fill="currentColor"/><circle cx="16" cy="14" r="1.2" fill="currentColor"/>';
const I_INFO  = '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>';
const I_CLOSE = '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>';

// Fixed demo parts of the no-show compensation (UI-only — no real billing):
// the pickup compensation and the service commission. The «платное ожидание»
// line is the LIVE accrued amount passed in via opts.paidWaitAmount so it
// matches the paid-wait sheet (Codex P2 — both screens use this one calc).
const PICKUP_COMP = 120;
const COMMISSION = 24;

// BD-RIDE-D-NOSHOW-01 — render the no-show sub-flow into the driver sheet.
// opts: { ride, orderLabel, paidWaitAmount, onConfirmNoShow, onBack, isFlowOwner, go, showNotice }
// onConfirmNoShow may return a Promise: resolve -> advance to `result`; reject -> show
// `failure` (retry re-invokes it; no local persistence happens in this module either way).
// isFlowOwner (BD-RIDE-D-NOSHOW-ACK-01 P1) — read-only ownership snapshot owned by the
// caller (active_ride.js's noShowFlowOpen). Checked AFTER the awaited confirmNoShow()
// settles, so a stale attempt superseded by a retry or by reconciliation discovering an
// authoritative terminal ride never renders over whoever currently owns the sheet. A
// missing/non-function opts.isFlowOwner falls back to always-owner (true), matching
// today's behavior.
export function openDriverNoShowFlow(sheet, opts = {}) {
  if (!sheet) return;
  const ride = opts.ride || {};
  const passengerName = (ride.passenger && ride.passenger.name) || 'Пассажир';
  const orderLabel = opts.orderLabel || 'Заказ';
  const go = typeof opts.go === 'function' ? opts.go : () => {};
  const back = typeof opts.onBack === 'function' ? opts.onBack : () => {};
  const showNotice = typeof opts.showNotice === 'function' ? opts.showNotice : () => {};
  const confirmNoShow = typeof opts.onConfirmNoShow === 'function' ? opts.onConfirmNoShow : () => {};
  const isFlowOwner = typeof opts.isFlowOwner === 'function' ? opts.isFlowOwner : () => true;

  // Compensation receipt — the «платное ожидание» line is the LIVE accrued
  // amount (Codex P2). opts.paidWaitAmount may be a number or a resolver fn; we
  // freeze it at the no-show CONFIRM step (Codex P2 — not at flow entry) so any
  // dwell time on the action/confirm screens is counted. net = paid wait +
  // pickup(120) − commission(24).
  function resolvePaidWait() {
    const p = opts.paidWaitAmount;
    const v = typeof p === 'function' ? Number(p()) : Number(p);
    return Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
  }
  function buildComp(paidWaitNum) {
    return {
      paidWait: `${paidWaitNum} ₽`,
      pickupComp: `${PICKUP_COMP} ₽`,
      commission: `− ${COMMISSION} ₽`,
      net: `${Math.max(0, paidWaitNum + PICKUP_COMP - COMMISSION)} ₽`,
    };
  }
  let comp = buildComp(0);
  // BD-RIDE-D-NOSHOW-ACK-01 (V2-04C2) — double-submit guard for submitNoShow().
  let submitting = false;

  const $ = (id) => sheet.querySelector(id);

  function renderAction() {
    sheet.innerHTML = `
      <div class="ns-flow ns-flow--pad">
        <div class="ns-head">
          <div class="ns-head-icon warning">${svg(I_ALERT, 22)}</div>
          <div class="ns-head-copy">
            <div class="ns-eyebrow warning"><span class="ns-eyebrow-dot" aria-hidden="true"></span>${escapeHtml(orderLabel)}</div>
            <div class="ns-title">Пассажир не вышел?</div>
          </div>
          <button type="button" class="ns-close" id="ns-close" aria-label="Закрыть">${svg(I_CLOSE, 16)}</button>
        </div>
        <div class="ns-sub">Отметьте «не вышел», только если пассажир не появился и не отвечает. Что произойдёт:</div>
        <div class="ns-bullets">
          <div class="ns-bullet"><div class="ns-bullet-ic">${svg(I_CHECK, 13, 2.6)}</div><span>Поездка закроется со статусом <b>«Пассажир не вышел»</b></span></div>
          <div class="ns-bullet"><div class="ns-bullet-ic">${svg(I_CARD, 13, 2.2)}</div><span>Вам начислят компенсацию за ожидание <b>${escapeHtml(comp.pickupComp)}</b></span></div>
          <div class="ns-bullet"><div class="ns-bullet-ic">${svg(I_CAR, 13, 2)}</div><span>Вы сразу вернётесь к приёму новых заказов</span></div>
        </div>
        <div class="ns-hint">${svg(I_INFO, 14, 1.9)}<span>Частые ложные отметки влияют на рейтинг. Убедитесь, что связались с пассажиром.</span></div>
        <div class="ns-actions-stack">
          <button type="button" class="bd-btn danger" id="ns-mark">Отметить «не вышел»</button>
          <button type="button" class="bd-btn" id="ns-back-wait">Вернуться к ожиданию</button>
        </div>
      </div>`;
    $('#ns-close').addEventListener('click', back);
    $('#ns-back-wait').addEventListener('click', back);
    $('#ns-mark').addEventListener('click', renderConfirm);
  }

  function renderConfirm() {
    sheet.innerHTML = `
      <div class="ns-flow ns-flow--pad ns-flow--center">
        <div class="ns-confirm-icon">${svg(I_ALERT, 28)}</div>
        <div class="ns-title ns-title--center">Подтвердить, что пассажир не вышел?</div>
        <div class="ns-sub ns-sub--center">Поездка с ${escapeHtml(passengerName)} будет закрыта. Это действие нельзя отменить.</div>
        <div class="ns-actions-stack">
          <button type="button" class="bd-btn danger" id="ns-confirm">Да, пассажир не вышел</button>
          <button type="button" class="bd-btn" id="ns-cancel">Отмена</button>
        </div>
      </div>`;
    $('#ns-cancel').addEventListener('click', renderAction);
    $('#ns-confirm').addEventListener('click', submitNoShow);
  }

  // BD-RIDE-D-NOSHOW-ACK-01 (V2-04C2) — the single call site for onConfirmNoShow, shared by
  // the initial confirm click and the failure-view retry button. `submitting` plus the
  // immediate renderSubmitting() swap (which removes #ns-confirm/#ns-retry from the DOM)
  // together guard against a double-submit: at most one onConfirmNoShow() call per
  // confirmation, even on a rapid double-click before the re-render lands.
  //
  // BD-RIDE-D-NOSHOW-ACK-01 P1 — isFlowOwner() is re-checked AFTER the await settles, not
  // before: ownership can only change WHILE this call is in flight (a retry superseding this
  // attempt, or reconciliation discovering the ride already went terminal), so the check has
  // to happen on the far side of the await to catch exactly that window. A stale resolve must
  // not renderResult() and a stale reject must not renderFailure() — either would overwrite
  // whatever the current owner has already rendered. No extra PATCH either way: confirmNoShow()
  // has already run and settled by the time ownership is checked.
  async function submitNoShow() {
    if (submitting) return;
    submitting = true;
    // Freeze the live paid-wait accrual at the moment of confirmation (Codex
    // P2 — counts any dwell time on the action/confirm/failure-retry screens).
    comp = buildComp(resolvePaidWait());
    renderSubmitting();
    try {
      // The ONLY persistence in this flow — fires the existing NO_SHOW transition.
      // Awaited: onConfirmNoShow may be backend-ACK-first, so `result` (success copy,
      // compensation, "back on line") must not render until it actually resolves.
      await confirmNoShow();
      submitting = false;
      if (!isFlowOwner()) return;
      renderResult();
    } catch (err) {
      submitting = false;
      if (!isFlowOwner()) return;
      renderFailure(err);
    }
  }

  function renderSubmitting() {
    sheet.innerHTML = `
      <div class="ns-flow ns-flow--pad ns-flow--center">
        <div class="ns-confirm-icon">${svg(I_ALERT, 28)}</div>
        <div class="ns-title ns-title--center">Отмечаем «не вышел»…</div>
        <div class="ns-sub ns-sub--center">Подтверждаем на сервере. Не закрывайте экран.</div>
        <div class="ns-searching" aria-hidden="true"><span class="ns-search-dot"></span><span class="ns-search-dot"></span><span class="ns-search-dot"></span></div>
      </div>`;
  }

  // No local NO_SHOW write happens on this path — the ride stays WAITING_PASSENGER until a
  // retry succeeds. `back` (→ onBack) exits the sub-flow without persisting anything either.
  function renderFailure(err) {
    const message = (err && err.code === 'RIDE_TERMINAL')
      ? 'Поездка уже завершена на сервере.'
      : 'Не удалось подтвердить на сервере. Попробуйте ещё раз.';
    sheet.innerHTML = `
      <div class="ns-flow ns-flow--pad ns-flow--center">
        <div class="ns-confirm-icon">${svg(I_ALERT, 28)}</div>
        <div class="ns-title ns-title--center">Не получилось отметить «не вышел»</div>
        <div class="ns-sub ns-sub--center">${escapeHtml(message)}</div>
        <div class="ns-actions-stack">
          <button type="button" class="bd-btn danger" id="ns-retry">Повторить</button>
          <button type="button" class="bd-btn" id="ns-fail-back">Назад к ожиданию</button>
        </div>
      </div>`;
    $('#ns-retry').addEventListener('click', submitNoShow);
    $('#ns-fail-back').addEventListener('click', back);
  }

  function renderResult() {
    sheet.innerHTML = `
      <div class="ns-flow ns-flow--pad ns-flow--center">
        <div class="ns-result-badge">${svg(I_ALERT, 28, 2.6)}</div>
        <div class="ns-eyebrow danger ns-eyebrow--center"><span class="ns-eyebrow-dot" aria-hidden="true"></span>Статус · NO_SHOW</div>
        <div class="ns-title ns-title--center">Отмечено: пассажир не вышел</div>
        <div class="ns-sub ns-sub--center">${escapeHtml(orderLabel)} закрыт. Сейчас покажем итог по ожиданию.</div>
        <div class="ns-actions-stack">
          <button type="button" class="bd-btn primary" id="ns-show-total">Показать итог</button>
        </div>
      </div>`;
    $('#ns-show-total').addEventListener('click', renderCompensation);
  }

  function renderCompensation() {
    sheet.innerHTML = `
      <div class="ns-flow ns-flow--pad">
        <div class="ns-head">
          <div class="ns-head-icon success">${svg(I_CARD, 22)}</div>
          <div class="ns-head-copy">
            <div class="ns-eyebrow success"><span class="ns-eyebrow-dot" aria-hidden="true"></span>Итог заказа</div>
            <div class="ns-title">Компенсация за ожидание</div>
          </div>
        </div>
        <div class="ns-receipt">
          <div class="ns-receipt-row"><span class="ns-receipt-key">Платное ожидание</span><span class="ns-receipt-val">${escapeHtml(comp.paidWait)}</span></div>
          <div class="ns-receipt-row"><span class="ns-receipt-key">Компенсация за подачу</span><span class="ns-receipt-val">${escapeHtml(comp.pickupComp)}</span></div>
          <div class="ns-receipt-row"><span class="ns-receipt-key">Комиссия сервиса</span><span class="ns-receipt-val ns-receipt-val--muted">${escapeHtml(comp.commission)}</span></div>
          <div class="ns-receipt-div" aria-hidden="true"></div>
          <div class="ns-receipt-row"><span class="ns-receipt-key ns-receipt-key--total">К начислению</span><span class="ns-receipt-total">${escapeHtml(comp.net)}</span></div>
        </div>
        <div class="ns-hint">${svg(I_INFO, 14, 1.9)}<span>Сумма зачислится в баланс смены. Поездка не учитывается как завершённая.</span></div>
        <div class="ns-actions-stack">
          <button type="button" class="bd-btn primary ns-btn-ic" id="ns-to-done">${svg(I_CAR, 16, 1.9)}<span>Вернуться к заказам</span></button>
        </div>
      </div>`;
    $('#ns-to-done').addEventListener('click', renderDone);
  }

  function renderDone() {
    sheet.innerHTML = `
      <div class="ns-flow ns-flow--pad ns-flow--center">
        <div class="ns-result-badge success">${svg(I_CAR, 26, 2)}</div>
        <div class="ns-title ns-title--center">Вы снова на линии</div>
        <div class="ns-sub ns-sub--center">${escapeHtml(comp.net)} добавлены к смене. Ищем для вас следующий заказ рядом.</div>
        <div class="ns-searching" aria-hidden="true"><span class="ns-search-dot"></span><span class="ns-search-dot"></span><span class="ns-search-dot"></span><span class="ns-searching-text">Поиск заказов…</span></div>
        <div class="ns-actions-stack">
          <button type="button" class="bd-btn primary" id="ns-to-orders">К списку заказов</button>
          <button type="button" class="bd-btn" id="ns-break">Сделать перерыв</button>
        </div>
      </div>`;
    $('#ns-to-orders').addEventListener('click', () => go('/driver-map'));
    $('#ns-break').addEventListener('click', () => { showNotice('Перерыв будет доступен позже'); go('/driver-map'); });
  }

  renderAction();
}
