// BD-MAP-05 — OrderMapDraft.
// Turns the persisted routeDraft (BD-MAP-03 RoutePicker, gated by
// BD-MAP-04 RoutePreview) into a local mock passenger order. No backend,
// no Mapbox SDK, no payments, no auth — createRideOrder() pushes into
// localStorage and the success state confirms it visually.

import { escapeHtml } from '../util.js';
import { go } from '../router.js';
import { createMapShell } from '../mapbox/map_shell.js';
import { user } from '../state.js';
import { createRideOrder } from '../mock_api.js';

const ROUTE_DRAFT_KEY = 'bazardrive.route_draft.v1';
const FORM_DRAFT_KEY = 'bazardrive.order_form.v1';
const STORAGE_LABEL = 'localStorage';

const STATE = {
  VALID: 'valid',
  MISSING: 'missing',
};

const PHONE_FALLBACK = '+7 (905) ··· 12-34';
const COMMENT_LIMIT = 200;
const PRICE_STEP = 50;
const PRICE_MIN = 0;
const PRICE_MAX = 100000;

const form = {
  mode: 'now',           // 'now' | 'later'
  date: '',              // YYYY-MM-DD when mode==='later'
  time: '',              // HH:MM when mode==='later'
  price: null,           // number | null — null means "use estimate"
  comment: '',
  publishing: false,
  errors: [],            // [{ key, copy, path }]
  // BD-MAP-08 — screen-local diagnostic notice surfaced near publish
  // actions so a tap on "Опубликовать заказ" never feels silent.
  // Shape: { tone: 'info' | 'warn' | 'error', text: string } | null.
  notice: null,
};

function setNotice(tone, text) {
  form.notice = { tone, text };
}

function clearNotice() {
  form.notice = null;
}

// BD-MAP-08 — debug channel, off by default. Flip on with
//   localStorage['bazardrive.debug.publish'] = '1'
// to trace each tap on "Опубликовать заказ" without spamming the
// normal console.
function isPublishDebug() {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('bazardrive.debug.publish') === '1';
  } catch {
    return false;
  }
}

function debugPublish(...args) {
  if (!isPublishDebug()) return;
  try {
    console.debug('[publish]', ...args);
  } catch {
    // fail soft
  }
}

// BD-MAP-08 — surfaces an in-DOM trail of the most recent publish-flow
// events when debug mode is on, so we can diagnose silent-tap reports
// on Android Chrome (where opening DevTools is not always possible).
const debugTrail = [];
function pushDebugTrail(label, detail) {
  if (!isPublishDebug()) return;
  const stamp = new Date();
  const hh = String(stamp.getHours()).padStart(2, '0');
  const mm = String(stamp.getMinutes()).padStart(2, '0');
  const ss = String(stamp.getSeconds()).padStart(2, '0');
  const ms = String(stamp.getMilliseconds()).padStart(3, '0');
  debugTrail.push({ t: `${hh}:${mm}:${ss}.${ms}`, label, detail: detail || '' });
  while (debugTrail.length > 8) debugTrail.shift();
}

// BD-MAP-08 — single entry point for "the publish CTA must never feel
// silent". Sets a notice, optionally toggles publishing state, rerenders
// while preserving scroll, and scrolls the notice into view so the user
// sees feedback without having to chase the form.
function publishFeedback(root, tone, text, draft, opts = {}) {
  setNotice(tone, text);
  if (typeof opts.publishing === 'boolean') form.publishing = opts.publishing;
  const ctx = opts.missing
    ? { state: STATE.MISSING, draft: null }
    : { state: STATE.VALID, draft };
  rerender(root, ctx);
  scrollFeedbackIntoView(root);
  debugPublish('feedback', { tone, text, publishing: form.publishing });
}

function scrollFeedbackIntoView(root) {
  // BD-MAP-08 — rerender replaces the entire scroll container, so the
  // visible feedback (notice, success card, or CTA) can end up below
  // the fold on tall forms. Walk a priority list that covers every
  // publish-flow surface and bring the first match into view.
  const selectors = [
    '[data-notice="1"]',
    '.omd-card--success',
    '.omd-success',
    '.omd-actions',
    '[data-action="publish"]',
    '[data-action="driver-map"]',
  ];
  let target = null;
  for (const sel of selectors) {
    target = root.querySelector(sel);
    if (target) break;
  }
  if (!target) return;
  try {
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } catch {
    try { target.scrollIntoView(); } catch {
      // fail soft
    }
  }
}

let formHydrated = false;
let routeFingerprint = null;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidPoint(point) {
  return isPlainObject(point)
    && typeof point.label === 'string'
    && point.label.trim().length > 0;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function readRouteDraft() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(ROUTE_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) return null;
    const route = isPlainObject(parsed.route) ? parsed.route : {};
    const draft = {
      pickup: isValidPoint(parsed.pickup) ? parsed.pickup : null,
      dropoff: isValidPoint(parsed.dropoff) ? parsed.dropoff : null,
      distanceKm: isFiniteNumber(route.distanceKm) ? route.distanceKm : null,
      durationMin: isFiniteNumber(route.durationMin) ? route.durationMin : null,
      estimatedPrice: isFiniteNumber(route.estimatedPrice) ? route.estimatedPrice : null,
    };
    if (!draft.pickup || !draft.dropoff
        || draft.distanceKm == null
        || draft.durationMin == null
        || draft.estimatedPrice == null) {
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

function hydrateForm() {
  if (formHydrated) return;
  formHydrated = true;
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(FORM_DRAFT_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) return;
    if (parsed.mode === 'now' || parsed.mode === 'later') form.mode = parsed.mode;
    if (typeof parsed.date === 'string') form.date = parsed.date.slice(0, 10);
    if (typeof parsed.time === 'string') form.time = parsed.time.slice(0, 5);
    if (typeof parsed.comment === 'string') {
      form.comment = parsed.comment.slice(0, COMMENT_LIMIT);
    }
    if (isFiniteNumber(parsed.price)) form.price = clampPrice(parsed.price);
    if (typeof parsed.fingerprint === 'string') routeFingerprint = parsed.fingerprint;
  } catch {
    // ignore — fall back to defaults.
  }
}

// Always runs on entry: if the underlying routeDraft changed since the
// user last touched the form, reset price so the new estimate is used by
// default. Other fields (mode/date/time/comment) carry over because they
// are independent of the route.
function syncRouteFingerprint(draft) {
  if (!draft) return;
  const fp = `${draft.pickup.label}→${draft.dropoff.label}`;
  if (routeFingerprint && routeFingerprint !== fp) {
    form.price = null;
  }
  routeFingerprint = fp;
}

function persistForm() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(FORM_DRAFT_KEY, JSON.stringify({
      mode: form.mode,
      date: form.date,
      time: form.time,
      price: form.price,
      comment: form.comment,
      fingerprint: routeFingerprint,
    }));
  } catch {
    // fail soft
  }
}

function clearFormDraft() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(FORM_DRAFT_KEY);
  } catch {
    // fail soft
  }
  form.mode = 'now';
  form.date = '';
  form.time = '';
  form.price = null;
  form.comment = '';
  form.errors = [];
  form.notice = null;
  formHydrated = false;
}

// BD-AUTH-BOUNDARY-01 — wiped on local logout / reset so the next
// identity does not inherit the previous user's pending order draft
// or its route-change fingerprint.
export function clearOrderFormDraftStore() {
  clearFormDraft();
  routeFingerprint = null;
}

function clampPrice(value) {
  const n = Math.round(Number(value) || 0);
  if (n < PRICE_MIN) return PRICE_MIN;
  if (n > PRICE_MAX) return PRICE_MAX;
  return n;
}

function currentPrice(draft) {
  return form.price == null ? clampPrice(draft.estimatedPrice) : clampPrice(form.price);
}

function formatDistance(km) {
  if (!isFiniteNumber(km)) return '';
  return km >= 10 ? String(Math.round(km)) : km.toFixed(1).replace(/\.0$/, '');
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '';
  return `${d}.${m}.${y}`;
}

function maskedPhone(phone) {
  const digits = String(phone || '').replace(/\D+/g, '');
  if (digits.length < 11) return PHONE_FALLBACK;
  const last4 = digits.slice(-4);
  const a = last4.slice(0, 2);
  const b = last4.slice(2);
  return `+7 (${digits.slice(-10, -7)}) ··· ${a}-${b}`;
}

function validate(draft) {
  const errors = [];
  if (form.mode === 'later') {
    if (!form.date || !form.time) {
      errors.push({
        key: 'schedule',
        copy: 'Укажите время поездки',
        path: 'order.schedule',
      });
    }
  }
  if (currentPrice(draft) <= 0) {
    errors.push({
      key: 'price',
      copy: 'Проверьте цену или контакт',
      path: 'order.price',
    });
  }
  return errors;
}

// ── Render: topbar ────────────────────────────────────────────
function renderTopbar(stateLabel, tone = 'draft') {
  const topbar = document.createElement('div');
  topbar.className = 'bd-topbar omd-topbar';
  topbar.dataset.pill = tone;
  topbar.innerHTML = `
    <button class="bd-iconbtn omd-topbar__back" type="button" data-action="back"
            aria-label="Назад к предпросмотру">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6"/>
      </svg>
    </button>
    <div class="bd-topbar__titles">
      <h1 class="bd-topbar__title">Новый заказ</h1>
      <p class="bd-topbar__sub omd-topbar__sub">${escapeHtml(stateLabel)}</p>
    </div>
    <button class="bd-iconbtn omd-topbar__close" type="button" data-action="close"
            aria-label="Закрыть и вернуться в ленту">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  `;
  return topbar;
}

function renderMap(draft) {
  const wrap = document.createElement('div');
  wrap.className = 'omd-map';
  wrap.setAttribute('aria-label', 'Карта маршрута');
  const shell = createMapShell({
    variant: 'passenger',
    showRoute: Boolean(draft),
    showCar: false,
    showPickup: Boolean(draft?.pickup),
    showDropoff: Boolean(draft?.dropoff),
    showLabels: false,
    route: {
      pickupLabel: draft?.pickup?.label ?? 'Точка подачи',
      dropoffLabel: draft?.dropoff?.label ?? 'Точка назначения',
    },
  });
  shell.setAttribute('aria-hidden', 'true');
  wrap.appendChild(shell);

  const pickup = document.createElement('div');
  pickup.className = 'omd-map__from';
  pickup.setAttribute('aria-hidden', 'true');
  pickup.innerHTML = `<span class="omd-map__from-dot"></span>ОТКУДА`;
  wrap.appendChild(pickup);
  return wrap;
}

function renderRouteSummary(draft) {
  const distance = formatDistance(draft.distanceKm);
  return `
    <div class="omd-route">
      <div class="omd-route__pins" aria-hidden="true">
        <span class="omd-route__pin omd-route__pin--pickup"></span>
        <span class="omd-route__pin-line"></span>
        <span class="omd-route__pin omd-route__pin--dropoff"></span>
      </div>
      <div class="omd-route__points">
        <div class="omd-route__point">
          <div class="omd-route__label">ОТКУДА</div>
          <div class="omd-route__value">${escapeHtml(draft.pickup.label)}</div>
        </div>
        <div class="omd-route__point">
          <div class="omd-route__label">КУДА</div>
          <div class="omd-route__value">${escapeHtml(draft.dropoff.label)}</div>
        </div>
      </div>
      <button class="bd-iconbtn omd-route__edit" type="button" data-action="edit-route"
              aria-label="Изменить маршрут">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 20h9"/>
          <path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/>
        </svg>
      </button>
    </div>

    <dl class="omd-metrics" aria-label="Параметры маршрута">
      <div class="omd-metric">
        <dt class="omd-metric__value">${escapeHtml(String(Math.round(draft.durationMin)))}<span class="omd-metric__unit"> мин</span></dt>
        <dd class="omd-metric__label">В ПУТИ</dd>
      </div>
      <div class="omd-metric">
        <dt class="omd-metric__value">${escapeHtml(distance)}<span class="omd-metric__unit"> км</span></dt>
        <dd class="omd-metric__label">РАССТОЯНИЕ</dd>
      </div>
      <div class="omd-metric">
        <dt class="omd-metric__value"><span class="omd-metric__prefix">≈ </span>${escapeHtml(String(Math.round(draft.estimatedPrice)))}<span class="omd-metric__unit"> ₽</span></dt>
        <dd class="omd-metric__label">ОЦЕНКА</dd>
      </div>
    </dl>
  `;
}

function renderScheduleTabs() {
  const isNow = form.mode === 'now';
  return `
    <div class="omd-tabs" role="tablist" aria-label="Время поездки">
      <button class="omd-tab ${isNow ? 'is-active' : ''}" type="button"
              role="tab" aria-selected="${isNow ? 'true' : 'false'}"
              data-mode="now">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9"/>
          <polyline points="12 7 12 12 15 14"/>
        </svg>
        <span>Сейчас</span>
      </button>
      <button class="omd-tab ${!isNow ? 'is-active' : ''}" type="button"
              role="tab" aria-selected="${!isNow ? 'true' : 'false'}"
              data-mode="later">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
          <line x1="8" y1="3" x2="8" y2="7"/>
          <line x1="16" y1="3" x2="16" y2="7"/>
        </svg>
        <span>Позже</span>
      </button>
    </div>
  `;
}

function renderScheduleFields() {
  if (form.mode !== 'later') return '';
  return `
    <div class="omd-schedule-grid">
      <label class="omd-schedule-field">
        <span class="omd-schedule-field__label">ДАТА</span>
        <input class="omd-input" type="date" data-input="date"
               value="${escapeHtml(form.date)}"
               aria-label="Дата поездки">
      </label>
      <label class="omd-schedule-field">
        <span class="omd-schedule-field__label">ВРЕМЯ</span>
        <input class="omd-input" type="time" data-input="time"
               value="${escapeHtml(form.time)}"
               aria-label="Время поездки">
      </label>
    </div>
  `;
}

function renderPriceRow(draft) {
  const price = currentPrice(draft);
  const estimate = clampPrice(draft.estimatedPrice);
  return `
    <div class="omd-price">
      <div class="omd-price__head">
        <span class="omd-price__label">ЦЕНА ПАССАЖИРА</span>
        <span class="omd-price__hint">ОЦЕНКА ОТ ${escapeHtml(String(estimate))} ₽</span>
      </div>
      <div class="omd-price__stepper">
        <button class="omd-price__btn" type="button" data-action="price-down"
                aria-label="Уменьшить цену на 50 ₽">−50</button>
        <div class="omd-price__value-wrap">
          <input class="omd-price__input" type="number" inputmode="numeric"
                 data-input="price" min="${PRICE_MIN}" max="${PRICE_MAX}" step="${PRICE_STEP}"
                 value="${escapeHtml(String(price))}"
                 aria-label="Цена в рублях">
          <span class="omd-price__currency" aria-hidden="true">₽</span>
        </div>
        <button class="omd-price__btn" type="button" data-action="price-up"
                aria-label="Увеличить цену на 50 ₽">+50</button>
      </div>
    </div>
  `;
}

function renderCommentField() {
  const len = form.comment.length;
  return `
    <div class="omd-comment">
      <div class="omd-comment__head">
        <span class="omd-comment__label">КОММЕНТАРИЙ ДЛЯ ВОДИТЕЛЯ</span>
        <span class="omd-comment__counter" aria-live="polite">${len}/${COMMENT_LIMIT}</span>
      </div>
      <textarea class="omd-input omd-textarea" data-input="comment"
                maxlength="${COMMENT_LIMIT}" rows="3"
                placeholder="Например: чемодан, детское кресло, подъезд №3"
                aria-label="Комментарий для водителя">${escapeHtml(form.comment)}</textarea>
    </div>
  `;
}

function renderPhoneRow() {
  const u = user.get();
  const phone = maskedPhone(u.phone);
  return `
    <div class="omd-phone">
      <div class="omd-phone__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.86 19.86 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.86 19.86 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0122 16.92z"/>
        </svg>
      </div>
      <div class="omd-phone__body">
        <div class="omd-phone__value">${escapeHtml(phone)}</div>
        <div class="omd-phone__hint">Телефон из профиля будет показан водителю</div>
      </div>
      <button class="omd-phone__edit" type="button" data-action="edit-phone">Изменить</button>
    </div>
  `;
}

function renderErrors() {
  if (!form.errors.length) return '';
  const items = form.errors.map((err) => `
    <li class="omd-error">
      <span class="omd-error__dot" aria-hidden="true"></span>
      <div class="omd-error__body">
        <div class="omd-error__copy">${escapeHtml(err.copy)}</div>
        <code class="omd-error__path">${escapeHtml(err.path)}</code>
      </div>
    </li>
  `).join('');
  return `<ul class="omd-errors" role="alert" aria-label="Проверьте поля">${items}</ul>`;
}

function renderNotice() {
  if (!form.notice) return '';
  const tone = form.notice.tone === 'error' || form.notice.tone === 'warn' || form.notice.tone === 'info'
    ? form.notice.tone
    : 'info';
  return `
    <div class="omd-notice omd-notice--${tone}" role="status" aria-live="polite" data-notice="1">
      <span class="omd-notice__dot" aria-hidden="true"></span>
      <span class="omd-notice__text">${escapeHtml(form.notice.text)}</span>
    </div>
  `;
}

// BD-MAP-08 — visible debug trail rendered next to the notice when
// localStorage['bazardrive.debug.publish'] === '1'. Lets us confirm on
// Android Chrome whether the publish tap reached the JS handler at all.
function renderDebugTrail() {
  if (!isPublishDebug() || !debugTrail.length) return '';
  const items = debugTrail.map((entry) => `
    <li class="omd-debug__row">
      <code class="omd-debug__time">${escapeHtml(entry.t)}</code>
      <span class="omd-debug__label">${escapeHtml(entry.label)}</span>
      <span class="omd-debug__detail">${escapeHtml(String(entry.detail))}</span>
    </li>
  `).join('');
  return `
    <ol class="omd-debug" role="note" aria-label="Publish debug trail" data-debug="publish">
      ${items}
    </ol>
  `;
}

function renderLockHint() {
  return `
    <div class="omd-lock" role="note">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="11" width="18" height="11" rx="2"/>
        <path d="M7 11V7a5 5 0 0110 0v4"/>
      </svg>
      <span>Водитель увидит маршрут, цену и комментарий перед принятием заказа.</span>
    </div>
  `;
}

function renderPublishActions() {
  const publishing = form.publishing;
  const cta = publishing
    ? `<span class="omd-spinner" aria-hidden="true"></span><span>Публикуем…</span>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
         <line x1="22" y1="2" x2="11" y2="13"/>
         <polygon points="22 2 15 22 11 13 2 9 22 2"/>
       </svg>
       <span>Опубликовать заказ</span>`;
  return `
    <button class="bd-btn primary omd-publish ${publishing ? 'is-loading' : ''}" type="button"
            data-action="publish" ${publishing ? 'disabled aria-busy="true"' : ''}>
      ${cta}
    </button>
    <button class="bd-btn omd-secondary" type="button" data-action="edit-route"
            ${publishing ? 'disabled' : ''}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/>
      </svg>
      <span>Изменить маршрут</span>
    </button>
    <button class="bd-btn ghost omd-draft" type="button" data-action="save-draft"
            ${publishing ? 'disabled' : ''}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <span>Сохранить черновик</span>
    </button>
  `;
}

// ── Render: valid state ───────────────────────────────────────
function renderValidBody(draft) {
  const card = document.createElement('div');
  card.className = 'omd-form';
  card.dataset.mode = form.mode;
  card.dataset.publishing = form.publishing ? '1' : '0';
  card.innerHTML = `
    ${renderRouteSummary(draft)}
    <div class="omd-section">
      <div class="omd-section__head">ДЕТАЛИ ЗАКАЗА</div>
      ${renderScheduleTabs()}
      ${renderScheduleFields()}
      ${renderPriceRow(draft)}
      ${renderCommentField()}
      ${renderPhoneRow()}
      ${renderErrors()}
      ${renderLockHint()}
      <div class="omd-actions">
        ${renderNotice()}
        ${renderDebugTrail()}
        ${renderPublishActions()}
      </div>
    </div>
  `;
  return card;
}

// ── Render: missing state ─────────────────────────────────────
function renderMissingBody() {
  const card = document.createElement('div');
  card.className = 'omd-card omd-card--missing';
  card.innerHTML = `
    <div class="omd-empty">
      <div class="omd-empty__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 21s-7-7.5-7-12a7 7 0 1114 0c0 4.5-7 12-7 12z"/>
          <circle cx="12" cy="9" r="2.5"/>
        </svg>
      </div>
      <h2 class="omd-empty__title">Маршрут не выбран</h2>
      <p class="omd-empty__hint">
        Сначала выберите точки поездки, затем создайте заказ.
      </p>
    </div>

    <dl class="omd-diag" aria-label="Диагностика">
      <div class="omd-diag__row">
        <dt>Источник</dt>
        <dd>${escapeHtml(STORAGE_LABEL)} · пусто</dd>
      </div>
      <div class="omd-diag__row">
        <dt>Ключ</dt>
        <dd><code>${escapeHtml(ROUTE_DRAFT_KEY)}</code></dd>
      </div>
      <div class="omd-diag__row">
        <dt>Шаг назад</dt>
        <dd><code>/route-picker</code></dd>
      </div>
    </dl>

    ${renderNotice()}
    ${renderDebugTrail()}
    <button class="bd-btn primary omd-publish" type="button" data-action="pick-route">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 21s-7-7.5-7-12a7 7 0 1114 0c0 4.5-7 12-7 12z"/>
        <circle cx="12" cy="9" r="2.5"/>
      </svg>
      <span>Выбрать маршрут</span>
    </button>
    <button class="bd-btn omd-secondary" type="button" data-action="close">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="1.5"/>
        <rect x="14" y="3" width="7" height="7" rx="1.5"/>
        <rect x="3" y="14" width="7" height="7" rx="1.5"/>
        <rect x="14" y="14" width="7" height="7" rx="1.5"/>
      </svg>
      <span>В ленту</span>
    </button>
  `;
  return card;
}

// ── Render: success state ─────────────────────────────────────
function renderSuccessBody(order) {
  const card = document.createElement('div');
  card.className = 'omd-card omd-card--success';
  const timeCopy = order.scheduledMode === 'now'
    ? 'Сейчас · подача 4–8 мин'
    : `${formatDate(order.scheduledAt.slice(0, 10))} · ${order.scheduledAt.slice(11, 16)}`;
  const shortId = String(order.id).split('-').slice(-1)[0].slice(-6);

  card.innerHTML = `
    <div class="omd-success">
      <div class="omd-success__check" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"
             stroke-linecap="round" stroke-linejoin="round">
          <polyline points="5 12 10 17 19 8"/>
        </svg>
      </div>
      <div class="omd-success__meta">
        <span class="omd-success__badge">ЗАКАЗ № ${escapeHtml(shortId)} · ОПУБЛИКОВАН</span>
      </div>
      <h2 class="omd-success__title">Заказ опубликован</h2>
      <p class="omd-success__hint">
        Водители рядом смогут увидеть его в списке заказов. Мы пришлём
        push, как только появится отклик.
      </p>
    </div>

    <dl class="omd-summary" aria-label="Сводка заказа">
      <div class="omd-summary__row">
        <dt>Маршрут</dt>
        <dd>${escapeHtml(order.pickup.label)} → ${escapeHtml(order.dropoff.label)}</dd>
      </div>
      <div class="omd-summary__row">
        <dt>Время</dt>
        <dd>${escapeHtml(timeCopy)}</dd>
      </div>
      <div class="omd-summary__row">
        <dt>Цена</dt>
        <dd>${escapeHtml(String(order.estimatedPrice))} ₽</dd>
      </div>
      <div class="omd-summary__row">
        <dt>Статус</dt>
        <dd><span class="omd-summary__pill">Ждём отклики</span></dd>
      </div>
    </dl>

    <button class="bd-btn primary omd-publish" type="button" data-action="driver-map">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polygon points="1 6 8 3 16 6 23 3 23 18 16 21 8 18 1 21 1 6"/>
        <line x1="8" y1="3" x2="8" y2="18"/>
        <line x1="16" y1="6" x2="16" y2="21"/>
      </svg>
      <span>К карте водителя</span>
    </button>
    <button class="bd-btn omd-secondary" type="button" data-action="responses">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/>
      </svg>
      <span>Посмотреть отклики</span>
    </button>
    <button class="bd-btn ghost omd-draft" type="button" data-action="close">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="1.5"/>
        <rect x="14" y="3" width="7" height="7" rx="1.5"/>
        <rect x="3" y="14" width="7" height="7" rx="1.5"/>
        <rect x="14" y="14" width="7" height="7" rx="1.5"/>
      </svg>
      <span>В ленту</span>
    </button>
  `;
  return card;
}

// ── Build and event wiring ────────────────────────────────────
function buildSection({ state, draft, order }) {
  const fragment = document.createDocumentFragment();
  // BD-MAP-09 — pill copy mirrors Cloud Design BD-MAP-05 render gate:
  //   state=success → CREATED (green)
  //   state=missing → ROUTEDRAFT ОТСУТСТВУЕТ
  //   otherwise     → ЧЕРНОВИК МАРШРУТА (validation reuses the same pill)
  const label = order
    ? 'CREATED'
    : (state === STATE.MISSING ? 'ROUTEDRAFT ОТСУТСТВУЕТ' : 'ЧЕРНОВИК МАРШРУТА');
  const tone = order ? 'success' : (state === STATE.MISSING ? 'missing' : 'draft');
  fragment.appendChild(renderTopbar(label, tone));

  const scroll = document.createElement('div');
  scroll.className = 'bd-scroll omd-scroll';
  scroll.dataset.state = order ? 'success' : state;
  scroll.appendChild(renderMap(draft));

  if (order) {
    scroll.appendChild(renderSuccessBody(order));
  } else if (state === STATE.MISSING) {
    scroll.appendChild(renderMissingBody());
  } else {
    scroll.appendChild(renderValidBody(draft));
  }
  fragment.appendChild(scroll);
  return fragment;
}

let lastOrder = null;

function publishOrder(draft) {
  const order = createRideOrder({
    type: 'passenger_request',
    pickup: { id: draft.pickup.id ?? null, label: draft.pickup.label },
    dropoff: { id: draft.dropoff.id ?? null, label: draft.dropoff.label },
    distanceKm: draft.distanceKm,
    durationMin: draft.durationMin,
    estimatedPrice: currentPrice(draft),
    scheduledMode: form.mode,
    scheduledAt: form.mode === 'later'
      ? `${form.date}T${form.time}:00`
      : new Date().toISOString(),
    comment: form.comment.trim(),
  });
  return order;
}

function handlePublish(root, draft) {
  debugPublish('handlePublish:start', { hasDraft: Boolean(draft), publishing: form.publishing });
  pushDebugTrail('handlePublish', `draft=${draft ? '1' : '0'} publishing=${form.publishing ? '1' : '0'}`);
  // BD-MAP-08 — duplicate tap while a publish is already in flight.
  // The form is pointer-events:none in this state, but accessibility
  // tooling or rapid taps can still trigger another click. Surface a
  // visible reason instead of silently no-opping.
  if (form.publishing) {
    publishFeedback(root, 'info', 'Заказ уже публикуется…', draft);
    return;
  }
  if (!draft) {
    // Defence in depth — caller already routes missing-draft taps, but
    // never trust that. A publish path without a draft must shout.
    publishFeedback(root, 'warn', 'Маршрут потерян. Выберите маршрут заново.', null, { missing: true });
    return;
  }
  const errors = validate(draft);
  form.errors = errors;
  if (errors.length) {
    const hasPriceError = errors.some((e) => e.key === 'price');
    publishFeedback(root, 'warn', hasPriceError
      ? 'Проверьте цену заказа.'
      : 'Проверьте поля заказа.', draft);
    return;
  }
  publishFeedback(root, 'info', 'Публикуем заказ…', draft, { publishing: true });

  setTimeout(() => {
    let order = null;
    try {
      order = publishOrder(draft);
    } catch (err) {
      debugPublish('publishOrder:threw', err);
      publishFeedback(root, 'error', 'Не удалось создать локальный заказ. Попробуйте ещё раз.', draft, { publishing: false });
      return;
    }
    if (!order || typeof order !== 'object' || !order.id) {
      debugPublish('publishOrder:invalid', order);
      publishFeedback(root, 'error', 'Не удалось создать локальный заказ. Попробуйте ещё раз.', draft, { publishing: false });
      return;
    }
    lastOrder = order;
    form.publishing = false;
    clearNotice();
    clearFormDraft();
    debugPublish('publishOrder:ok', order.id);
    pushDebugTrail('publishOrder:ok', order.id);
    rerender(root, { state: STATE.VALID, draft, order });
    scrollFeedbackIntoView(root);
  }, 700);
}

function rerender(root, ctx) {
  // BD-MAP-08 — preserve scroll position so a tap on "Опубликовать
  // заказ" does not visually reset the form to its map header and make
  // the new notice / spinner appear "below the fold" on mobile.
  const prevScroll = root.querySelector('.bd-scroll');
  const prevTop = prevScroll ? prevScroll.scrollTop : 0;
  root.dataset.state = ctx.order ? 'success' : ctx.state;
  root.dataset.publishing = form.publishing ? '1' : '0';
  root.replaceChildren(buildSection(ctx));
  const nextScroll = root.querySelector('.bd-scroll');
  if (nextScroll && prevTop > 0 && !ctx.order) {
    nextScroll.scrollTop = prevTop;
  }
}

const DRAFT_REQUIRED_ACTIONS = new Set([
  'publish', 'price-down', 'price-up', 'save-draft',
]);

function handleAction(root, action, draft, state) {
  if (action === 'back') {
    go('/route-preview');
    return;
  }
  if (action === 'close') {
    lastOrder = null;
    go('/feed');
    return;
  }
  if (action === 'edit-route' || action === 'pick-route') {
    go('/route-picker');
    return;
  }
  if (action === 'edit-phone') {
    go('/profile');
    return;
  }
  if (action === 'responses') {
    go('/responses');
    return;
  }
  if (action === 'driver-map') {
    lastOrder = null;
    go('/driver-map');
    return;
  }
  // BD-MAP-07 — actions below require a route draft. If the draft is
  // unavailable at the moment of click, surface a visible missing state
  // instead of silently no-opping.
  if (!DRAFT_REQUIRED_ACTIONS.has(action)) return;
  if (state !== STATE.VALID || !draft) {
    // BD-MAP-08 — also raise a notice so the missing state explicitly
    // explains why the tap on "Опубликовать заказ" did not publish.
    if (action === 'publish') {
      publishFeedback(root, 'warn', 'Маршрут потерян. Выберите маршрут заново.', null, { missing: true });
      return;
    }
    rerender(root, { state: STATE.MISSING, draft: null });
    return;
  }
  if (action === 'save-draft') {
    persistForm();
    return;
  }
  if (action === 'price-down') {
    form.price = clampPrice(currentPrice(draft) - PRICE_STEP);
    persistForm();
    rerender(root, { state, draft });
    return;
  }
  if (action === 'price-up') {
    form.price = clampPrice(currentPrice(draft) + PRICE_STEP);
    persistForm();
    rerender(root, { state, draft });
    return;
  }
  if (action === 'publish') {
    handlePublish(root, draft);
    return;
  }
}

function handleInput(root, target, draft) {
  const field = target.dataset.input;
  if (!field) return;
  if (field === 'price') {
    form.price = clampPrice(target.value);
    persistForm();
    return; // do not rerender on every keystroke
  }
  if (field === 'comment') {
    form.comment = String(target.value || '').slice(0, COMMENT_LIMIT);
    persistForm();
    const counter = root.querySelector('.omd-comment__counter');
    if (counter) counter.textContent = `${form.comment.length}/${COMMENT_LIMIT}`;
    return;
  }
  if (field === 'date') {
    form.date = String(target.value || '');
    persistForm();
    return;
  }
  if (field === 'time') {
    form.time = String(target.value || '');
    persistForm();
    return;
  }
}

function handleModeClick(root, target, draft) {
  const mode = target.closest('[data-mode]')?.dataset.mode;
  if (mode !== 'now' && mode !== 'later') return false;
  if (form.mode === mode) return true;
  form.mode = mode;
  form.errors = [];
  persistForm();
  if (!draft) {
    rerender(root, { state: STATE.MISSING, draft: null });
    return true;
  }
  rerender(root, { state: STATE.VALID, draft });
  return true;
}

export default function orderMapDraftScreen() {
  const draft = readRouteDraft();
  hydrateForm();
  syncRouteFingerprint(draft);
  // Reset transient state on fresh entry.
  form.publishing = false;
  form.errors = [];
  form.notice = null;
  lastOrder = null;

  // BD-MAP-07 — screen-local last-known-valid route draft. Survives
  // transient localStorage gaps (eviction, cross-tab clears) so that
  // "Опубликовать заказ" never silently no-ops while the user is still
  // looking at a populated form.
  let renderedDraft = draft;

  const state = draft ? STATE.VALID : STATE.MISSING;

  const root = document.createElement('section');
  root.className = 'screen screen--order-map-draft';
  root.dataset.state = state;
  root.replaceChildren(buildSection({ state, draft }));

  // BD-MAP-08 — dedup guard so a single tap that fires both `pointerup`
  // and `click` does not create two orders. Stamped on the first publish
  // activation that reaches handleAction; ignored on follow-ups within
  // 700ms regardless of source (pointerup vs click).
  let lastPublishActivationAt = 0;

  function describeTarget(node) {
    if (!node || typeof node !== 'object') return '';
    const tag = (node.tagName || '').toLowerCase();
    const cls = typeof node.className === 'string' ? node.className : '';
    return `${tag}${cls ? '.' + cls.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
  }

  function handlePublishActivation(event, source) {
    let actionTarget = null;
    try {
      const target = event.target;
      actionTarget = target && typeof target.closest === 'function'
        ? target.closest('[data-action]')
        : null;
      const action = actionTarget ? actionTarget.dataset.action : null;
      const liveDraft = readRouteDraft();
      const effectiveDraft = liveDraft || renderedDraft;
      if (effectiveDraft) renderedDraft = effectiveDraft;
      const effectiveState = effectiveDraft ? STATE.VALID : STATE.MISSING;

      debugPublish(source, {
        type: event.type,
        target: describeTarget(target),
        actionTarget: describeTarget(actionTarget),
        action,
        hasLiveDraft: Boolean(liveDraft),
        hasRenderedDraft: Boolean(renderedDraft),
        effectiveState,
      });
      pushDebugTrail(`${source}:${event.type}`, action || describeTarget(target));

      // Non-publish actions go through the normal click flow only — we
      // do not want pointerup to drive back-button / mode tabs / inputs.
      if (action !== 'publish') return { handled: false, source };

      const now = Date.now();
      if (now - lastPublishActivationAt < 700) {
        debugPublish('publish:dedup', { source, sinceMs: now - lastPublishActivationAt });
        pushDebugTrail('publish:dedup', source);
        return { handled: true, source, dedup: true };
      }
      lastPublishActivationAt = now;

      pushDebugTrail('handleAction', `publish/${effectiveState}`);
      debugPublish('handleAction:call', { source, effectiveState });
      try {
        handleAction(root, 'publish', effectiveDraft, effectiveState);
      } catch (err) {
        debugPublish('handleAction:threw', err);
        pushDebugTrail('handleAction:threw', String(err && err.message || err));
        publishFeedback(
          root,
          'error',
          'Не удалось обработать публикацию. Попробуйте ещё раз.',
          effectiveDraft,
          { publishing: false },
        );
      }
      return { handled: true, source };
    } catch (err) {
      debugPublish(`${source}:threw`, err);
      pushDebugTrail(`${source}:threw`, String(err && err.message || err));
      return { handled: false, source, error: err };
    }
  }

  root.addEventListener('click', (event) => {
    try {
      const liveDraft = readRouteDraft();
      const effectiveDraft = liveDraft || renderedDraft;
      if (effectiveDraft) renderedDraft = effectiveDraft;
      const effectiveState = effectiveDraft ? STATE.VALID : STATE.MISSING;
      if (handleModeClick(root, event.target, effectiveDraft)) return;
      const actionTarget = event.target && typeof event.target.closest === 'function'
        ? event.target.closest('[data-action]')
        : null;
      if (!actionTarget) return;
      const action = actionTarget.dataset.action;
      if (action === 'publish') {
        handlePublishActivation(event, 'click');
        return;
      }
      debugPublish('click', { action, state: effectiveState, hasDraft: Boolean(effectiveDraft) });
      handleAction(root, action, effectiveDraft, effectiveState);
    } catch (err) {
      debugPublish('click:threw', err);
      pushDebugTrail('click:threw', String(err && err.message || err));
    }
  });

  // BD-MAP-08 — pointerup fallback specifically for the publish CTA on
  // Android Chrome, where `click` is occasionally swallowed (touch slop
  // after a small scroll, viewport zoom changes, etc.). All other
  // actions stay on the existing click flow. Dedup is enforced by the
  // 700ms guard inside handlePublishActivation.
  //
  // BD-MAP-PUBLISH-02 review feedback: raw `pointerup` on a button can
  // also fire when a touch that started on the CTA turns into a
  // scroll/drag gesture. Track pointerdown/move/cancel so we only treat
  // `pointerup` as a publish tap when the gesture stayed within tap
  // tolerance.
  const TAP_MOVE_THRESHOLD = 12;
  let publishPointer = null;

  function isPublishPointerTarget(event) {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return null;
    return target.closest('[data-action="publish"]');
  }

  root.addEventListener('pointerdown', (event) => {
    if (!isPublishPointerTarget(event)) {
      publishPointer = null;
      return;
    }
    publishPointer = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cancelled: false,
    };
    pushDebugTrail('pointerdown', 'publish');
  });

  root.addEventListener('pointermove', (event) => {
    if (!publishPointer || event.pointerId !== publishPointer.pointerId) return;
    if (publishPointer.cancelled) return;
    const dx = Math.abs(event.clientX - publishPointer.startX);
    const dy = Math.abs(event.clientY - publishPointer.startY);
    if (dx > TAP_MOVE_THRESHOLD || dy > TAP_MOVE_THRESHOLD) {
      publishPointer.cancelled = true;
      pushDebugTrail('pointermove:cancel', `${Math.round(dx)},${Math.round(dy)}`);
    }
  });

  root.addEventListener('pointercancel', (event) => {
    if (!publishPointer || event.pointerId !== publishPointer.pointerId) return;
    publishPointer.cancelled = true;
    pushDebugTrail('pointercancel', 'publish');
  });

  root.addEventListener('pointerup', (event) => {
    const actionTarget = isPublishPointerTarget(event);
    const pointer = publishPointer;
    if (pointer && pointer.pointerId === event.pointerId) {
      publishPointer = null;
    }
    if (!actionTarget) return;
    if (!pointer || pointer.pointerId !== event.pointerId || pointer.cancelled) {
      debugPublish('pointerup:ignored', {
        reason: !pointer ? 'no-down' : pointer.cancelled ? 'moved' : 'pointer-mismatch',
      });
      pushDebugTrail('pointerup:ignored', !pointer ? 'no-down' : pointer.cancelled ? 'moved' : 'mismatch');
      return;
    }
    handlePublishActivation(event, 'pointerup');
  });

  root.addEventListener('input', (event) => {
    handleInput(root, event.target, renderedDraft);
  });

  root.addEventListener('change', (event) => {
    // For date / time pickers that fire change instead of input.
    handleInput(root, event.target, renderedDraft);
  });

  return root;
}
