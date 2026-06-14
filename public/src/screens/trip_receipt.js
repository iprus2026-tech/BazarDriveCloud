// BD-RIDE-HISTORY-D-01 — Trip receipt screen (issue #381).
//
// A read-only, closed financial document for a single completed driver ride.
// It is NOT an active-ride cockpit: there is no map, no live actions, no
// status machine — just the persisted receipt rendered as a settled receipt.
//
// The screen READS the canonical receipt object (mock_api.getReceipt) and only
// FORMATS its stored values. It never recomputes fare / commission / tip / net
// — `net` was computed exactly once in the completed driver earnings flow
// (active_ride.js → buildDriverEarningsPayload) and persisted via
// saveDriverReceipt. No backend, no real payments, no tax / accounting math.
//
// States (Cloud Design render gate):
//   C · cash      — paymentMode === 'cash'
//   D · noncash   — paymentMode === 'noncash'
//   E · missing   — no receipt for the tripId → friendly fallback
//   F · loading   — sync skeleton while the receipt resolves
//
// ?state= is a render-gate preview affordance only (loading | missing | cash |
// noncash); it selects which canonical demo receipt to show but never alters
// the stored money. Style rules (enforced by scripts/check.mjs): no inline
// styles, no .style mutations — every visual state is a class in cloud.css.

import { escapeHtml } from '../util.js';
import { go } from '../router.js';
import { getReceipt } from '../mock_api.js';
import { loadResource } from '../data_layer.js';

const DEMO_RECEIPT_TRIP_ID = '48-321';
const RECEIPT_SYNC_MS = 280;

function getHashQuery() {
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  return qi === -1 ? new URLSearchParams() : new URLSearchParams(hash.slice(qi + 1));
}

// Format a single whole-ruble value. Operates on its argument only — it never
// combines two receipt fields, so the "net computed once" invariant holds.
function formatReceiptRub(value) {
  const n = Math.round(Number(value) || 0);
  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${abs} ₽`;
}

function formatCompletedAt(value) {
  if (!value) return '';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  try {
    return d.toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function paymentBadgeHtml(paymentMode) {
  return paymentMode === 'cash'
    ? '<span class="trip-receipt__pay-badge trip-receipt__pay-badge--cash">Оплата наличными</span>'
    : '<span class="trip-receipt__pay-badge trip-receipt__pay-badge--noncash">Безналичный расчёт</span>';
}

function receiptHeadHtml(title) {
  return `
    <header class="trip-receipt__head">
      <button type="button" class="trip-receipt__back" data-receipt-action="back" aria-label="Назад">‹</button>
      <p class="trip-receipt__doc-kicker">${escapeHtml(title)}</p>
      <span class="trip-receipt__head-spacer" aria-hidden="true"></span>
    </header>`;
}

// C / D — the settled receipt. Every money line reads a stored field and
// formats it; `commission` is already signed in the receipt so it is printed
// verbatim. There is no arithmetic across fare / commission / tip / net here.
function receiptDocHtml(receipt) {
  const isCash = receipt.paymentMode === 'cash';
  const completed = formatCompletedAt(receipt.completedAt);
  const totalLabel = isCash ? 'Итого наличными' : 'Итого к зачислению';
  const settleNote = isCash
    ? 'Оплата получена наличными от пассажира. Сумма не зачисляется на баланс.'
    : 'Сумма зачислена на ваш баланс BazarDrive.';
  return `
    <article class="trip-receipt__doc trip-receipt__doc--${escapeHtml(receipt.paymentMode)}" data-payment-mode="${escapeHtml(receipt.paymentMode)}">
      <div class="trip-receipt__doc-top">
        <span class="trip-receipt__status-badge">Завершено</span>
        ${paymentBadgeHtml(receipt.paymentMode)}
      </div>
      <div class="trip-receipt__hero">
        <p class="trip-receipt__hero-label">Ваш доход за поездку</p>
        <p class="trip-receipt__hero-value">${escapeHtml(formatReceiptRub(receipt.net))}</p>
        <p class="trip-receipt__hero-trip">Поездка № ${escapeHtml(String(receipt.tripId))}</p>
      </div>
      <div class="trip-receipt__rows" role="list" aria-label="Разбивка по поездке">
        <div class="trip-receipt__row" role="listitem">
          <span class="trip-receipt__row-label">Стоимость поездки</span>
          <span class="trip-receipt__row-value">${escapeHtml(formatReceiptRub(receipt.fare))}</span>
        </div>
        <div class="trip-receipt__row" role="listitem">
          <span class="trip-receipt__row-label">Комиссия сервиса</span>
          <span class="trip-receipt__row-value trip-receipt__row-value--neg">${escapeHtml(formatReceiptRub(receipt.commission))}</span>
        </div>
        <div class="trip-receipt__row" role="listitem">
          <span class="trip-receipt__row-label">Чаевые и бонусы</span>
          <span class="trip-receipt__row-value trip-receipt__row-value--pos">+${escapeHtml(formatReceiptRub(receipt.tip))}</span>
        </div>
        <div class="trip-receipt__divider" aria-hidden="true"></div>
        <div class="trip-receipt__row trip-receipt__row--total" role="listitem">
          <span class="trip-receipt__row-label">${escapeHtml(totalLabel)}</span>
          <span class="trip-receipt__row-value trip-receipt__total">${escapeHtml(formatReceiptRub(receipt.net))}</span>
        </div>
      </div>
      <dl class="trip-receipt__meta">
        ${completed ? `<div class="trip-receipt__meta-row"><dt>Завершено</dt><dd>${escapeHtml(completed)}</dd></div>` : ''}
        <div class="trip-receipt__meta-row"><dt>Номер поездки</dt><dd>№ ${escapeHtml(String(receipt.tripId))}</dd></div>
        <div class="trip-receipt__meta-row"><dt>Статус</dt><dd>Завершено и рассчитано</dd></div>
      </dl>
      <p class="trip-receipt__settle-note">${escapeHtml(settleNote)}</p>
      <div class="trip-receipt__actions">
        <button type="button" class="bd-btn primary trip-receipt__action" data-receipt-action="payouts">К выплатам</button>
        <button type="button" class="bd-btn trip-receipt__action" data-receipt-action="profile">В профиль</button>
      </div>
      <p class="trip-receipt__legal">Прототип: чек только отображает сохранённый расчёт. Реальных платежей и налогов нет.</p>
    </article>`;
}

// E — missing receipt fallback.
function receiptMissingHtml(tripId) {
  const idText = tripId ? `№ ${escapeHtml(String(tripId))}` : '';
  return `
    <article class="trip-receipt__doc trip-receipt__doc--missing" role="status">
      <div class="trip-receipt__missing-icon" aria-hidden="true">🧾</div>
      <p class="trip-receipt__missing-title">Чек не найден</p>
      <p class="trip-receipt__missing-text">Для этой поездки ${idText ? `(${idText}) ` : ''}нет сохранённого чека. Возможно, поездка ещё не завершена или чек не был сформирован.</p>
      <div class="trip-receipt__actions">
        <button type="button" class="bd-btn primary trip-receipt__action" data-receipt-action="payouts">Открыть выплаты</button>
        <button type="button" class="bd-btn trip-receipt__action" data-receipt-action="profile">В профиль</button>
      </div>
    </article>`;
}

// F — loading / syncing skeleton.
function receiptSkeletonHtml() {
  return `
    <div class="trip-receipt__doc trip-receipt__doc--loading" role="status" aria-live="polite" aria-busy="true">
      <div class="trip-receipt__sk trip-receipt__sk--badges"></div>
      <div class="trip-receipt__sk trip-receipt__sk--hero"></div>
      <div class="trip-receipt__sk trip-receipt__sk--row"></div>
      <div class="trip-receipt__sk trip-receipt__sk--row"></div>
      <div class="trip-receipt__sk trip-receipt__sk--row"></div>
      <div class="trip-receipt__sk trip-receipt__sk--total"></div>
      <p class="trip-receipt__sk-text">Синхронизируем чек…</p>
    </div>`;
}

function bindReceiptActions(root) {
  root.addEventListener('click', (e) => {
    const trigger = e.target instanceof Element ? e.target.closest('[data-receipt-action]') : null;
    if (!trigger) return;
    const action = trigger.dataset.receiptAction;
    if (action === 'profile' || action === 'back') go('/profile');
    else if (action === 'payouts') go('/profile?role=driver&pane=payouts');
  });
}

// BD-ERROR-01C-H — resolve the receipt and swap the skeleton for the settled
// document, the missing fallback, or — for the render gate — a forced
// payment-mode preview. The real (non-forced) read routes through the shared
// data_layer.loadResource adapter so a future backend failure surfaces the
// global overlay with a guarded retry instead of silently showing the missing
// state; fallback is `null` (getReceipt returns object|null, not a list) so a
// load failure falls back to the screen's own missing state (additive overlay).
// A genuine not-found (load OK, no receipt) reports no error — only the missing
// document. The resolve runs off a setTimeout (after mount + overlay init), so
// the overlay is always available. Forced cash/noncash/missing previews are
// render-gate designer states and stay unwrapped.
async function renderResolved(content, tripId, forced, onRetry, isRetry) {
  // BD-ERROR-01C-H — this resolve is DEFERRED (setTimeout) and re-invokable on
  // «Повторить». Bail if the receipt screen was navigated away from before it
  // fires: a stale load that reports through loadResource would otherwise pop a
  // server_error overlay over a different screen. content is detached from the
  // document once the router swaps in the next view, so isConnected is the guard.
  if (!content.isConnected) return;
  let receipt;
  if (forced === 'missing') {
    receipt = null;
  } else if (forced === 'cash' || forced === 'noncash') {
    // Render-gate preview: read the canonical demo receipt and only flip the
    // display mode flag. The stored money (fare/commission/tip/net) is
    // untouched, so cash and noncash previews never drift.
    const base = getReceipt(tripId) || getReceipt(DEMO_RECEIPT_TRIP_ID);
    receipt = base ? { ...base, paymentMode: forced } : null;
  } else {
    receipt = await loadResource(() => getReceipt(tripId), { onRetry, isRetry, fallback: null });
    // A late (future-async) load may resolve after navigation — don't paint a
    // detached node.
    if (!content.isConnected) return;
  }
  content.innerHTML = receipt ? receiptDocHtml(receipt) : receiptMissingHtml(tripId);
}

export default function tripReceipt() {
  const query = getHashQuery();
  const tripId = (query.get('tripId') || '').trim();
  const forced = (query.get('state') || '').trim();

  const root = document.createElement('section');
  root.className = 'screen screen--trip-receipt trip-receipt';
  root.innerHTML = receiptHeadHtml('Чек поездки');

  const content = document.createElement('div');
  content.className = 'trip-receipt__content';
  content.innerHTML = receiptSkeletonHtml();
  root.appendChild(content);

  bindReceiptActions(root);

  // ?state=loading holds the syncing skeleton for the render gate.
  if (forced === 'loading') return root;

  // «Повторить» re-runs the resolve as a retry (isRetry → 'retrying' progress,
  // dismiss on success). onReceiptRetry references itself only when tapped, by
  // which time the const is initialised.
  const onReceiptRetry = () => { renderResolved(content, tripId, forced, onReceiptRetry, true); };

  // Resolve on a short timer so the syncing skeleton (state F) paints first,
  // mirroring an async receipt fetch. Mock only — no network. The setTimeout
  // also guarantees the resolve (and any error report) runs after the app-shell
  // overlay is initialised.
  setTimeout(() => renderResolved(content, tripId, forced, onReceiptRetry, false), RECEIPT_SYNC_MS);
  return root;
}
