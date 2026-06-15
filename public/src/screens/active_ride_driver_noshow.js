// BD-RIDE-D-NOSHOW-01 — Driver no-show sub-flow.
//
// Ported from the Cloud Design no-show render gate (ns-* namespace). A
// sequence of in-layout sheet swaps rendered into the driver active-ride
// `.active-ride__sheet` element — NOT a modal overlay — matching the screen's
// existing renderWaiting / renderCanceledStub pattern. Opened from the
// WAITING_PASSENGER «Не приехал» (#ar-no-show) action in active_ride.js,
// replacing the prior cancel-sheet preset path.
//
// Five states: action → confirm → result → compensation → done.
// Mock/UI only: the compensation figures are fixed demo values; the ONLY
// persistence is the existing NO_SHOW transition, fired via the screen's
// onConfirmNoShow callback at the confirm step (no new lifecycle semantics,
// no backend, no real money). The waiting/expired states from the gate are
// intentionally out of scope (they would redesign the live waiting UI).

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

// Fixed demo figures (UI-only — no real billing). Mirrors the render gate.
const DEMO = { paidWait: '180 ₽', pickupComp: '120 ₽', commission: '− 24 ₽', net: '276 ₽' };

// BD-RIDE-D-NOSHOW-01 — render the no-show sub-flow into the driver sheet.
// opts: { ride, orderLabel, onConfirmNoShow, onBack, go, showNotice }
export function openDriverNoShowFlow(sheet, opts = {}) {
  if (!sheet) return;
  const ride = opts.ride || {};
  const passengerName = (ride.passenger && ride.passenger.name) || 'Пассажир';
  const orderLabel = opts.orderLabel || 'Заказ';
  const go = typeof opts.go === 'function' ? opts.go : () => {};
  const back = typeof opts.onBack === 'function' ? opts.onBack : () => {};
  const showNotice = typeof opts.showNotice === 'function' ? opts.showNotice : () => {};
  const confirmNoShow = typeof opts.onConfirmNoShow === 'function' ? opts.onConfirmNoShow : () => {};

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
          <div class="ns-bullet"><div class="ns-bullet-ic">${svg(I_CARD, 13, 2.2)}</div><span>Вам начислят компенсацию за ожидание <b>${escapeHtml(DEMO.pickupComp)}</b></span></div>
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
    $('#ns-confirm').addEventListener('click', () => {
      // The ONLY persistence in this flow — fires the existing NO_SHOW transition.
      confirmNoShow();
      renderResult();
    });
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
          <div class="ns-receipt-row"><span class="ns-receipt-key">Платное ожидание</span><span class="ns-receipt-val">${escapeHtml(DEMO.paidWait)}</span></div>
          <div class="ns-receipt-row"><span class="ns-receipt-key">Компенсация за подачу</span><span class="ns-receipt-val">${escapeHtml(DEMO.pickupComp)}</span></div>
          <div class="ns-receipt-row"><span class="ns-receipt-key">Комиссия сервиса</span><span class="ns-receipt-val ns-receipt-val--muted">${escapeHtml(DEMO.commission)}</span></div>
          <div class="ns-receipt-div" aria-hidden="true"></div>
          <div class="ns-receipt-row"><span class="ns-receipt-key ns-receipt-key--total">К начислению</span><span class="ns-receipt-total">${escapeHtml(DEMO.net)}</span></div>
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
        <div class="ns-sub ns-sub--center">${escapeHtml(DEMO.net)} добавлены к смене. Ищем для вас следующий заказ рядом.</div>
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
