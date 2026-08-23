import { user } from '../state.js';
import { go } from '../router.js';
import { escapeHtml } from '../util.js';
import { listFeedPosts, submitOfferToBackend, pollOfferOutcome } from '../mock_api.js';
import { isBackendEnabled } from '../api_config.js';
import { loadResource } from '../data_layer.js';
import { resolveActiveGarageVehicle } from '../garage.js';

const RESPOND_KEY    = 'bazardrive.respond.v1';
const RESPONSES_KEY  = 'bazardrive.responses.v1';
const MAX_MSG        = 300;

const PRICE_CHIPS = [1300, 1500, 1800];

const TIMING_OPTIONS = [
  { key: 'at_time',   label: 'К указанному времени' },
  { key: 'earlier',   label: 'Могу раньше · 06:30'  },
  { key: 'negotiate', label: 'Договоримся'            },
];

const DEFAULT_PASSENGER_PRICE = 1500;

function saveResponse(data) {
  try { localStorage.setItem(RESPOND_KEY, JSON.stringify(data)); } catch {}
}

// BD-AUTH-BOUNDARY-01 — respond drafts + the keyed responses map both
// hold user-specific trip-response data (which post the local user is
// responding to, with what message/price). Cleared on logout / local
// reset so a passenger can't see a previous driver's in-flight response
// after switching identity on the same device.
export function clearRespondStore() {
  try { localStorage.removeItem(RESPOND_KEY); } catch {}
  try { localStorage.removeItem(RESPONSES_KEY); } catch {}
}

// Keyed-by-id store so downstream screens (chat, trip-confirmation) can
// look up a response by its stable id without depending on the "last
// response wins" semantics of RESPOND_KEY.
function saveResponseToMap(data) {
  if (!data || !data.id) return;
  try {
    const raw = localStorage.getItem(RESPONSES_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const next = map && typeof map === 'object' && !Array.isArray(map) ? map : {};
    next[data.id] = data;
    localStorage.setItem(RESPONSES_KEY, JSON.stringify(next));
  } catch {}
}

function getDefaultMessage(vehicle) {
  if (!vehicle) {
    return 'Здравствуйте! Готов забрать к указанному времени, есть место для чемодана.';
  }
  return `Здравствуйте! Готов забрать к указанному времени, авто ${vehicle.name}, есть место для чемодана.`;
}

// BD-PROFILE-D-05E — Read the active garage vehicle via the shared
// resolver so the response snapshot reflects whatever the driver
// selected on /profile (driverGarage.activeVehicleId). Strictly
// read-only: no localStorage writes, no driverGarage mutation, no
// lifecycle change. The legacy `vehicleMake/Model/Plate` guard is
// preserved so partially-onboarded drivers still bail to the demo
// fallback path — the only change is the source of the populated
// fields.
export function getUserVehicle(u) {
  if (!u || !u.vehicleMake || !u.vehicleModel || !u.vehiclePlate) return null;
  const active = resolveActiveGarageVehicle(u);
  if (!active) return null;
  return {
    id:       'user_vehicle',
    name:     active.model,
    plate:    active.plate,
    color:    active.color || 'Цвет не указан',
    seats:    4,
    features: 'кондиционер',
  };
}

function initial(name) {
  return name ? String(name).trim().charAt(0).toUpperCase() : '?';
}

function getRouteParam(name) {
  const hash = window.location.hash || '';
  const queryIndex = hash.indexOf('?');
  if (queryIndex === -1) return null;
  const params = new URLSearchParams(hash.slice(queryIndex + 1));
  return params.get(name);
}

const CAR_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="22" height="22">
    <path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1l2-4h10l2 4h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/>
    <circle cx="7.5" cy="17.5" r="2.5"/>
    <circle cx="16.5" cy="17.5" r="2.5"/>
  </svg>`;

const SEND_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="16" height="16">
    <line x1="22" y1="2" x2="11" y2="13"/>
    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>`;

const CHECK_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="32" height="32">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
    <polyline points="22 4 12 14.01 9 11.01"/>
  </svg>`;

const INFO_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="18" height="18" class="respond__info-icon">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="8" x2="12" y2="12"/>
    <line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>`;

const ERR_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" aria-hidden="true" width="16" height="16">
    <circle cx="12" cy="12" r="10"/>
    <line x1="15" y1="9" x2="9" y2="15"/>
    <line x1="9" y1="9" x2="15" y2="15"/>
  </svg>`;

const BACK_SVG = `
  <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="11 4 6 9 11 14"/>
  </svg>`;

// ── Topbar (shared) ─────────────────────────────────────────────
function renderTopbar(title) {
  return `
    <div class="respond__topbar">
      <button type="button" class="respond__back" id="respond-back" aria-label="Назад">
        ${BACK_SVG}
      </button>
      <span class="respond__title">${escapeHtml(title)}</span>
      <span class="respond__title-spacer" aria-hidden="true"></span>
    </div>
  `;
}

function backHref(post) {
  return post && post.id ? `/post?id=${encodeURIComponent(post.id)}` : '/feed';
}

// ── Variant: missing/unknown post ───────────────────────────────
function renderMissing(root) {
  root.innerHTML = `
    ${renderTopbar('Публикация')}
    <div class="bd-scroll respond__body">
      <div class="bd-empty respond__missing">
        <div class="bd-empty__title">Публикация не найдена</div>
        <p>Возможно, объявление было удалено или ссылка устарела.</p>
        <button type="button" class="bd-btn primary sm" id="respond-to-feed">
          Вернуться в ленту
        </button>
      </div>
    </div>
  `;
  root.querySelector('#respond-back').addEventListener('click', () => go('/feed'));
  root.querySelector('#respond-to-feed').addEventListener('click', () => go('/feed'));
}

// ── Variant: announcement / system (readonly fallback) ──────────
function renderUnsupported(root, post) {
  const target = backHref(post);
  root.innerHTML = `
    ${renderTopbar('Отклик недоступен')}
    <div class="bd-scroll respond__body">
      <div class="bd-empty respond__missing">
        <div class="bd-empty__title">Для этой публикации отклик недоступен</div>
        <p>Это системное сообщение или объявление — на него нельзя ответить.</p>
        <div class="respond__unsupported-actions">
          <button type="button" class="bd-btn primary sm" id="respond-back-to-post">
            Вернуться к публикации
          </button>
          <button type="button" class="bd-btn ghost sm" id="respond-to-feed">
            Вернуться в ленту
          </button>
        </div>
      </div>
    </div>
  `;
  root.querySelector('#respond-back').addEventListener('click', () => go(target));
  root.querySelector('#respond-back-to-post').addEventListener('click', () => go(target));
  root.querySelector('#respond-to-feed').addEventListener('click', () => go('/feed'));
}

// ── Variant: marketplace (seller message) ───────────────────────
function renderMarketplace(root, post) {
  const target = backHref(post);
  const sellerName = post.author || 'Продавец';
  const sellerInitials = initial(sellerName);
  const title = post.title || '';
  const body = post.body || '';
  const price = post.price || '';
  const tags = Array.isArray(post.tags)
    ? post.tags.filter((t) => typeof t === 'string' && t.trim())
    : [];

  const defaultMessage = 'Здравствуйте! Товар ещё актуален?';

  root.innerHTML = `
    ${renderTopbar('Написать продавцу')}

    <div class="bd-scroll respond__body" id="respond-body">

      <div class="bd-card respond__passenger-card respond__seller-card">
        <div class="respond__passenger-header">
          <div class="feed-avatar respond__avatar" aria-hidden="true">
            ${escapeHtml(sellerInitials)}
          </div>
          <div class="respond__passenger-info">
            <div class="respond__passenger-name">${escapeHtml(sellerName)}</div>
            <div class="respond__passenger-meta">Продавец</div>
          </div>
        </div>
        ${title ? `<div class="respond__listing-title">${escapeHtml(title)}</div>` : ''}
        ${price ? `<div class="respond__listing-price">${escapeHtml(price)}</div>` : ''}
        ${body ? `<p class="respond__listing-body">${escapeHtml(body)}</p>` : ''}
        ${tags.length ? `
          <div class="respond__listing-tags">
            ${tags.map((t) => `<span class="bd-badge">${escapeHtml(t)}</span>`).join('')}
          </div>` : ''}
      </div>

      <form id="respond-form" novalidate>

        <div class="respond__section">
          <div class="bd-label">Сообщение продавцу</div>
          <div class="respond__textarea-wrap">
            <textarea class="bd-textarea respond__textarea" id="respond-message"
                      name="message" rows="4" maxlength="${MAX_MSG}"
                      aria-label="Сообщение продавцу"
                      placeholder="Напишите продавцу…">${escapeHtml(defaultMessage)}</textarea>
            <div class="respond__counter" id="respond-counter" aria-live="polite">
              ${defaultMessage.length} / ${MAX_MSG}
            </div>
          </div>
        </div>

        <div class="bd-alert info respond__info-card">
          ${INFO_SVG}
          <p class="respond__info-text">
            Контакты продавца раскрываются после ответа. Будьте вежливы и уточняйте детали по объявлению.
          </p>
        </div>

        <div class="respond__error" id="respond-error" hidden role="alert">
          ${ERR_SVG}
          <span id="respond-error-text"></span>
        </div>

      </form>
    </div>

    <div class="respond__footer" id="respond-footer">
      <button type="button" class="bd-btn ghost respond__btn-cancel" id="respond-cancel">
        Отмена
      </button>
      <button type="submit" form="respond-form"
              class="bd-btn primary respond__btn-submit" id="respond-submit">
        ${SEND_SVG}
        <span class="respond__submit-label">Отправить сообщение</span>
      </button>
    </div>

    <div class="respond__success" id="respond-success" hidden>
      <div class="respond__success-inner">
        <div class="respond__success-icon">${CHECK_SVG}</div>
        <h2 class="respond__success-title">Сообщение отправлено</h2>
        <p class="respond__success-body">
          Продавец увидит ваше сообщение. Ответ придёт в раздел «Сообщения».
        </p>
        <button type="button" class="bd-btn primary respond__success-btn" id="respond-success-back">
          Готово
        </button>
      </div>
    </div>
  `;

  const form        = root.querySelector('#respond-form');
  const msgArea     = root.querySelector('#respond-message');
  const counter     = root.querySelector('#respond-counter');
  const errorBox    = root.querySelector('#respond-error');
  const errorText   = root.querySelector('#respond-error-text');
  const submitBtn   = root.querySelector('#respond-submit');
  const submitLabel = root.querySelector('.respond__submit-label');
  const bodyEl     = root.querySelector('#respond-body');
  const footerEl   = root.querySelector('#respond-footer');
  const successEl  = root.querySelector('#respond-success');
  const backBtn    = root.querySelector('#respond-back');

  msgArea.addEventListener('input', () => {
    counter.textContent = `${msgArea.value.length} / ${MAX_MSG}`;
  });

  function showError(msg) {
    errorText.textContent = msg;
    errorBox.hidden = false;
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function clearError() {
    errorBox.hidden = true;
    errorText.textContent = '';
  }
  function setLoading(on) {
    submitBtn.disabled = on;
    submitBtn.classList.toggle('loading', on);
    submitLabel.textContent = on ? 'Отправляем…' : 'Отправить сообщение';
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearError();

    const message = msgArea.value.trim();
    if (!message) {
      showError('Напишите сообщение продавцу');
      msgArea.focus();
      return;
    }

    setLoading(true);

    const response = {
      id:        `resp_${post.id}`,
      kind:      'marketplace_message',
      requestId: post.id,
      message,
      status:    'SENT',
      createdAt: new Date().toISOString(),
    };
    saveResponse(response);
    saveResponseToMap(response);

    setTimeout(() => {
      bodyEl.hidden   = true;
      footerEl.hidden = true;
      successEl.hidden = false;
      backBtn.hidden  = true;
    }, 600);
  });

  backBtn.addEventListener('click', () => go(target));
  root.querySelector('#respond-cancel').addEventListener('click', () => go(target));
  root.querySelector('#respond-success-back').addEventListener('click', () => go('/feed'));
}

// ── Variant: passenger request (ride response) ──────────────────
function renderPassengerRide(root, post) {
  const target = backHref(post);
  const u = user.get();
  const vehicle = getUserVehicle(u);
  const hasVehicle = Boolean(vehicle);
  const defaultMessage = getDefaultMessage(vehicle);

  const passengerName = post.author || 'Пассажир';
  const passengerInitials = initial(passengerName);
  const ratingMatch = typeof post.role === 'string'
    ? post.role.match(/★\s*([\d.,]+)/)
    : null;
  const passengerRating = ratingMatch ? ratingMatch[1] : null;

  const fromLabel = post.from || '—';
  const toLabel   = post.to   || '—';
  const whenLabel = post.when || 'Время не указано';

  const numericPrice = typeof post.price === 'string'
    ? Number(post.price.replace(/[^\d]/g, ''))
    : (typeof post.price === 'number' ? post.price : NaN);
  const initialPrice = Number.isFinite(numericPrice) && numericPrice > 0
    ? numericPrice
    : DEFAULT_PASSENGER_PRICE;

  const priceHint = (typeof post.price === 'string' && post.price.trim())
    ? `Пассажир предлагает ${escapeHtml(post.price)}`
    : '';

  root.innerHTML = `
    ${renderTopbar('Ответ на заявку')}

    <div class="bd-scroll respond__body" id="respond-body">

      <div class="bd-card respond__passenger-card">
        <div class="respond__passenger-header">
          <div class="feed-avatar respond__avatar" aria-hidden="true">
            ${escapeHtml(passengerInitials)}
          </div>
          <div class="respond__passenger-info">
            <div class="respond__passenger-name">${escapeHtml(passengerName)}</div>
            <div class="respond__passenger-meta">
              Пассажир${passengerRating ? ` · ★ ${escapeHtml(passengerRating)}` : ''}
            </div>
          </div>
        </div>
        <div class="respond__route">
          <span class="respond__route-from">${escapeHtml(fromLabel)}</span>
          <span class="respond__route-arrow" aria-hidden="true">→</span>
          <span class="respond__route-to">${escapeHtml(toLabel)}</span>
        </div>
        <div class="respond__when">${escapeHtml(whenLabel)}</div>
      </div>

      <form id="respond-form" novalidate>

        <div class="respond__section">
          <div class="bd-label">Ваша цена</div>
          <div class="respond__price-row">
            <input class="bd-input respond__price-input" id="respond-price"
                   name="price" type="number" min="1"
                   value="${initialPrice}"
                   aria-label="Ваша цена в рублях">
            <span class="respond__price-currency" aria-hidden="true">₽</span>
          </div>
          <div class="respond__chips" role="group" aria-label="Быстрый выбор цены" id="price-chips">
            ${PRICE_CHIPS.map((p) => `
              <button type="button"
                      class="respond-chip${p === initialPrice ? ' active' : ''}"
                      data-price="${p}">${p}</button>
            `).join('')}
          </div>
          ${priceHint ? `<div class="respond__price-hint">${priceHint}</div>` : ''}
        </div>

        <div class="respond__section">
          <div class="bd-label">Когда подать машину</div>
          <div class="respond__chips" role="group" aria-label="Время подачи" id="timing-chips">
            ${TIMING_OPTIONS.map((t, i) => `
              <button type="button"
                      class="respond-chip${i === 0 ? ' active' : ''}"
                      data-timing="${escapeHtml(t.key)}">${escapeHtml(t.label)}</button>
            `).join('')}
          </div>
        </div>

        <div class="respond__section">
          <div class="bd-label">Сообщение пассажиру</div>
          <div class="respond__textarea-wrap">
            <textarea class="bd-textarea respond__textarea" id="respond-message"
                      name="message" rows="4" maxlength="${MAX_MSG}"
                      aria-label="Сообщение пассажиру"
                      placeholder="Напишите пассажиру…">${escapeHtml(defaultMessage)}</textarea>
            <div class="respond__counter" id="respond-counter" aria-live="polite">
              ${defaultMessage.length} / ${MAX_MSG}
            </div>
          </div>
        </div>

        ${hasVehicle ? `
          <div class="bd-card respond__vehicle-card">
            <div class="respond__vehicle-row">
              <div class="respond__vehicle-icon">${CAR_SVG}</div>
              <div class="respond__vehicle-info">
                <div class="respond__vehicle-name">
                  ${escapeHtml(vehicle.name)} · ${escapeHtml(vehicle.plate)}
                </div>
                <div class="respond__vehicle-meta">
                  ${escapeHtml(vehicle.color)} · ${vehicle.seats} места · ${escapeHtml(vehicle.features)}
                </div>
              </div>
              <span class="bd-badge accent respond__vehicle-badge">Ваше авто</span>
            </div>
          </div>
        ` : `
          <div class="bd-alert respond__no-vehicle-alert">
            ${CAR_SVG}
            <div class="respond__no-vehicle-body">
              <div class="respond__no-vehicle-label">Автомобиль не добавлен</div>
              <p class="respond__no-vehicle-hint">Добавьте авто в профиле водителя, чтобы отправить отклик.</p>
              <button type="button" class="bd-btn sm respond__no-vehicle-cta" id="respond-goto-profile">
                Перейти в профиль
              </button>
            </div>
          </div>
        `}

        <div class="bd-alert info respond__info-card">
          ${INFO_SVG}
          <p class="respond__info-text">
            Контакты раскрываются после подтверждения пассажиром. Комиссия BazarDrive: 12% от стоимости.
          </p>
        </div>

        <div class="respond__error" id="respond-error" hidden role="alert">
          ${ERR_SVG}
          <span id="respond-error-text"></span>
        </div>

      </form>
    </div>

    <div class="respond__footer" id="respond-footer">
      <button type="button" class="bd-btn ghost respond__btn-cancel" id="respond-cancel">
        Отмена
      </button>
      <button type="submit" form="respond-form"
              class="bd-btn primary respond__btn-submit" id="respond-submit"
              ${hasVehicle ? '' : 'disabled aria-disabled="true"'}>
        ${SEND_SVG}
        <span class="respond__submit-label">${hasVehicle ? 'Отправить отклик' : 'Добавьте авто'}</span>
      </button>
    </div>

    <div class="respond__success" id="respond-success" hidden>
      <div class="respond__success-inner">
        <div class="respond__success-icon">${CHECK_SVG}</div>
        <h2 class="respond__success-title">Отклик отправлен</h2>
        <p class="respond__success-body">
          Пассажир увидит ваше предложение. Если он подтвердит, поездка появится в активных.
        </p>
        <div class="respond__success-actions">
          <button type="button" class="bd-btn primary respond__success-btn" id="respond-success-chat">
            Открыть чат
          </button>
          <button type="button" class="bd-btn ghost respond__success-btn" id="respond-success-back">
            В ленту
          </button>
        </div>
      </div>
    </div>
  `;

  const form        = root.querySelector('#respond-form');
  const priceInput  = root.querySelector('#respond-price');
  const msgArea     = root.querySelector('#respond-message');
  const counter     = root.querySelector('#respond-counter');
  const errorBox    = root.querySelector('#respond-error');
  const errorText   = root.querySelector('#respond-error-text');
  const submitBtn   = root.querySelector('#respond-submit');
  const submitLabel = root.querySelector('.respond__submit-label');
  const bodyEl     = root.querySelector('#respond-body');
  const footerEl   = root.querySelector('#respond-footer');
  const successEl  = root.querySelector('#respond-success');
  const backBtn    = root.querySelector('#respond-back');

  let selectedTiming = 'at_time';

  msgArea.addEventListener('input', () => {
    counter.textContent = `${msgArea.value.length} / ${MAX_MSG}`;
  });

  root.querySelector('#price-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-price]');
    if (!chip) return;
    priceInput.value = chip.dataset.price;
    for (const c of root.querySelectorAll('[data-price]')) {
      c.classList.toggle('active', c === chip);
    }
    clearError();
  });

  root.querySelector('#timing-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-timing]');
    if (!chip) return;
    selectedTiming = chip.dataset.timing;
    for (const c of root.querySelectorAll('[data-timing]')) {
      c.classList.toggle('active', c === chip);
    }
  });

  function showError(msg) {
    errorText.textContent = msg;
    errorBox.hidden = false;
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function clearError() {
    errorBox.hidden = true;
    errorText.textContent = '';
  }
  function setLoading(on) {
    submitBtn.disabled = on;
    submitBtn.classList.toggle('loading', on);
    submitLabel.textContent = on ? 'Отправляем…' : 'Отправить отклик';
  }

  // #784 driver handoff — after a LIVE offer (backend on + canonical ride order), the driver WAITS on
  // the success overlay for the passenger's selection. Self-clearing poll (mirrors chat.js: clears once
  // the screen is detached). WON → the driver active-ride (CUT-5 hydrates it from the server, now
  // reachable); REJECTED → an honest "не выбрали"; PENDING/ERROR → keep waiting. Only reached when
  // isBackendEnabled() + canonicalLink.orderId; OFF / non-canonical offers never start it.
  let offerPollId = null;
  function startOfferHandoffPoll(orderId) {
    const titleEl    = root.querySelector('.respond__success-title');
    const bodyTextEl = root.querySelector('.respond__success-body');
    if (titleEl)    titleEl.textContent = 'Предложение отправлено';
    if (bodyTextEl) bodyTextEl.textContent = 'Ждём выбор пассажира…';
    if (offerPollId) return;
    offerPollId = setInterval(async () => {
      if (!document.body.contains(root)) { clearInterval(offerPollId); offerPollId = null; return; }
      const outcome = await pollOfferOutcome(orderId);
      // Re-check after the await: the driver may have tapped «В ленту» while the request was in flight;
      // a late 'won' must NOT navigate from a detached screen and override the user's own navigation.
      if (!document.body.contains(root)) { clearInterval(offerPollId); offerPollId = null; return; }
      if (!outcome) return;
      if (outcome.state === 'won') {
        clearInterval(offerPollId); offerPollId = null;
        // Carry the server bootstrap status (ACCEPTED at select time) so the interim demo ride matches
        // the accepted ride instead of flashing the NEW_ORDER «Принять заказ» state before hydrate.
        const wonStatus = (outcome.ride && outcome.ride.status) || '';
        go(`/active-ride?role=driver&tripId=${encodeURIComponent(outcome.tripId)}${wonStatus ? `&status=${encodeURIComponent(wonStatus)}` : ''}`);
      } else if (outcome.state === 'rejected') {
        clearInterval(offerPollId); offerPollId = null;
        if (titleEl)    titleEl.textContent = 'Вас не выбрали';
        if (bodyTextEl) bodyTextEl.textContent = 'Пассажир выбрал другого водителя для этой поездки.';
      }
      // pending / error / off → keep waiting
    }, 2500);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    if (!hasVehicle) {
      showError('Добавьте автомобиль в профиле водителя, чтобы отправить отклик');
      return;
    }

    const priceRaw = priceInput.value.trim();
    const priceNum = Number(priceRaw);
    const message  = msgArea.value.trim();

    if (!priceRaw) {
      showError('Укажите цену поездки');
      priceInput.focus();
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      showError('Цена должна быть больше нуля');
      priceInput.focus();
      return;
    }
    if (!message) {
      showError('Напишите сообщение пассажиру');
      msgArea.focus();
      return;
    }

    setLoading(true);

    const responseId = `resp_${post.id}`;
    // BD-RESPOND-ORDER-LINK-01 — when the answered post is a canonical ride
    // order (a Feed projection of bazardrive.ride_orders.v1, tagged
    // canonical:'ride_order' with an orderId), additively pin the canonical
    // orderId + marker on the stored response so a future /responses read-side
    // can resolve real responses back to the same ride order. Legacy/seed feed
    // posts carry no orderId, so canonicalLink stays empty ({}) and their
    // stored response is byte-for-byte unchanged. Reference only — respond
    // never mutates the canonical store (no createRideOrder/acceptOrder/…).
    const canonicalLink = (post.canonical === 'ride_order' && post.orderId)
      ? { orderId: String(post.orderId), canonical: 'ride_order' }
      : {};
    // BD-RIDE-AUTHORITY-01B — a canonical ride-order response uses the SAME
    // tripId the rest of the real ride flow derives (trip_<orderId>), so
    // trip_confirmation_handoff.js's real-data seeder finds the order/
    // response pair under the key it was asked to seed instead of refusing
    // on a mismatch. Legacy/non-canonical posts (no canonicalLink.orderId)
    // keep the existing post.id shape — unchanged, safe fallback.
    const tripId = canonicalLink.orderId ? `trip_${canonicalLink.orderId}` : String(post.id);
    // We persist both ids on the response because downstream screens key
    // off different things:
    //   requestId — the originating passenger publication / заявка
    //                (used to trace back to the post in the feed).
    //   tripId    — the handoff key for /trip-confirmation and
    //                /active-ride. Canonical ride-order responses use
    //                trip_<orderId> (BD-RIDE-AUTHORITY-01A contract);
    //                legacy/seed posts keep the post.id shape.
    // BD-RIDE-ORDER-01 — capture a flat driver/vehicle snapshot at response
    // time so /responses can render a populated card without a backend.
    // All fields are plain strings so the response round-trips through
    // JSON.stringify in bazardrive.responses.v1 without a storage-version
    // bump.
    //
    // Name cascade follows onboarding/profile field layout (displayName,
    // firstName, lastName) — `u.name` is kept as a last-ditch alias for any
    // legacy seeds. Falls back to the neutral 'Водитель' placeholder so a
    // partially-onboarded driver still produces a renderable card.
    const pickStr = (v) => (typeof v === 'string' ? v.trim() : '');
    const composedName = [pickStr(u?.firstName), pickStr(u?.lastName)]
      .filter(Boolean).join(' ');
    const driverName = pickStr(u?.displayName)
      || composedName
      || pickStr(u?.name)
      || 'Водитель';
    // Match MOCK_DRIVERS convention ('Model · цвет') so renderDriverCard /
    // renderOffer show the same line shape for real and mock responses.
    const carName  = pickStr(vehicle?.name);
    const carColor = pickStr(vehicle?.color);
    const carLine  = (carName && carColor) ? `${carName} · ${carColor}` : (carName || '');
    // Russian plate format is "Л NNN ЛЛ RR" (e.g. "А 123 АА 77"). Mask the
    // middle digit segment (the personal identifier) and keep the letter
    // prefix, the letters and the trailing region visible so a passenger can
    // still recognise their car. Plates without spaces or unexpected shapes
    // fall back to a generic middle-mask that keeps first + last 2 chars.
    function maskPlate(raw) {
      const s = pickStr(raw);
      if (!s) return '';
      const parts = s.split(/\s+/);
      if (parts.length >= 3) {
        parts[1] = '•'.repeat(Math.max(parts[1].length, 3));
        return parts.join(' ');
      }
      if (s.length > 3) return s.slice(0, 1) + '•'.repeat(Math.max(s.length - 3, 1)) + s.slice(-2);
      return s;
    }
    const driverSnapshot = {
      name:     driverName,
      rating:   (typeof u?.rating === 'number') ? u.rating : null,
      car:      carLine,
      carModel: carName,
      carColor,
      plate:    maskPlate(vehicle?.plate),
    };
    const response = {
      id:           responseId,
      kind:         'passenger_response',
      tripId,
      requestId:    post.id,
      ...canonicalLink,
      driverPrice:  priceNum,
      pickupTiming: selectedTiming,
      message,
      vehicleId:    vehicle.id,
      driverSnapshot,
      status:       'SENT',
      createdAt:    new Date().toISOString(),
    };

    // #784 CUT-4 (offer→select): on a live backend, send the offer to the order
    // owner via POST /matching/offers BEFORE the local write, so a rejected POST
    // surfaces an error and never shows a false "sent" success. Only canonical
    // ride orders carry an orderId; legacy/seed posts have none, so they keep the
    // local-only path unchanged. The local response write below is preserved
    // either way (off-path + the /chat?responseId handoff rely on it).
    if (isBackendEnabled() && canonicalLink.orderId) {
      try {
        await submitOfferToBackend({
          orderId:    canonicalLink.orderId,
          driverName: driverSnapshot.name,
          car:        driverSnapshot.car,
          price:      priceNum,
          message,
        });
      } catch {
        setLoading(false);
        showError('Не удалось отправить предложение. Попробуйте ещё раз.');
        return;
      }
    }

    saveResponse(response);
    saveResponseToMap(response);

    // BD-CHAT-02 — /respond is a driver-side surface, so the success CTA
    // opens chat with role=driver. Without this, /chat defaults viewerRole
    // to 'passenger' and renders the driver's own outgoing bubble on the
    // wrong side of the thread.
    // #784 CUT-4: for a LIVE offer (backend on + a canonical ride order) that responseId thread is
    // orphaned — the passenger blocks pre-select chat and post-select chat opens by tripId — so hide
    // the «Открыть чат» CTA (live-offer chat opens post-select via the ride). OFF / non-canonical
    // posts keep the existing two-CTA overlay.
    const chatBtn = root.querySelector('#respond-success-chat');
    if (isBackendEnabled() && canonicalLink.orderId) {
      if (chatBtn) chatBtn.hidden = true;
    } else if (chatBtn) {
      const chatHref = `/chat?responseId=${encodeURIComponent(responseId)}&role=driver`;
      chatBtn.addEventListener('click', () => go(chatHref));
    }

    setTimeout(() => {
      bodyEl.hidden   = true;
      footerEl.hidden = true;
      successEl.hidden = false;
      backBtn.hidden  = true;
      // #784 driver handoff — a LIVE offer on a canonical ride order now waits here for the passenger's
      // selection (poll → driver active-ride on WON, or "не выбрали" on REJECTED). OFF / non-canonical
      // offers keep the static success overlay unchanged.
      if (isBackendEnabled() && canonicalLink.orderId) startOfferHandoffPoll(canonicalLink.orderId);
    }, 600);
  });

  backBtn.addEventListener('click', () => go(target));
  root.querySelector('#respond-cancel').addEventListener('click', () => go(target));
  root.querySelector('#respond-success-back').addEventListener('click', () => go('/feed'));

  if (!hasVehicle) {
    root.querySelector('#respond-goto-profile').addEventListener('click', () => go('/profile'));
  }
}

// BD-ERROR-01C-E / BD-ERROR-02A — route the post-lookup load through the global
// overlay via the shared data_layer.loadResource adapter (the per-screen wrapper
// was consolidated in 02A). respond is a single-shot render screen, so the
// load+resolve+render runs inside a re-invokable renderRespond(isRetry) closure
// that the retry callback re-runs (every render variant replaces root.innerHTML).
// loadResource reports server_error with a guarded retry and falls back to [] —
// the screen's own missing state is preserved (the overlay is additive); a
// genuine not-found (load OK, postId absent) reports no error. Defensive/dormant
// — mock listFeedPosts() does not reject today.

export default async function respond(renderContext) {
  const root = document.createElement('section');
  root.className = 'screen screen--respond';

  const postId = getRouteParam('postId');
  // BD-ROUTER-LIFECYCLE-01A P2 (PR #918 review) — router.js's generation
  // guard only gates whether THIS loader's eventual returned view gets
  // mounted; it has no visibility into side effects a loader fires before
  // returning. A stale, still-in-flight renderRespond (initial load or a
  // retry) that resumes after the user has navigated elsewhere must not:
  //   (a) fire go('/chat?...') — the router would happily treat that as a
  //       brand new, fully legitimate navigation and yank the user away
  //       from wherever they actually are;
  //   (b) raise the global server_error/retrying overlay via loadResource's
  //       own reportAppShellError — that fires INSIDE loadResource, before
  //       it returns, so a post-await check alone is too late to stop it.
  // BD-ROUTER-LIFECYCLE-01A P2 follow-up (ABA fix) — the original guard
  // compared window.location.hash against the hash captured at render
  // start, which breaks on an A→B→A navigation: the hash matches again
  // once the user returns to /respond, even though a fresh render (a new
  // router generation, a brand new renderRespond closure) is now running
  // too — a stale continuation from the FIRST /respond visit would wrongly
  // read itself as still current. router.js now hands every loader a
  // frozen renderContext bound to the generation it was minted for;
  // respond() uses THAT as isCurrent instead of comparing hashes, falling
  // back to an always-current stub only for a direct/test caller that
  // doesn't pass one.
  // isCurrent() covers both (a) and (b): passed as loadResource's isActive
  // (gates the overlay at the point it would be raised) and re-checked once
  // the load settles (gates the go() call and everything after it). Same
  // idiom already used by driver_map.js's epoch check and trip_receipt.js's
  // content.isConnected check.
  const isCurrent = renderContext && typeof renderContext.isCurrent === 'function'
    ? renderContext.isCurrent
    : () => true;

  if (!postId) {
    renderMissing(root);
    return root;
  }

  // Retry re-runs the load and re-renders into the same root. renderRespond is
  // hoisted, so referencing it from onRespondRetry before its declaration is
  // safe — the arrow only runs when the user taps «Повторить».
  const onRespondRetry = () => { renderRespond(true); };
  async function renderRespond(isRetry) {
    const posts = await loadResource(listFeedPosts, { onRetry: onRespondRetry, isRetry, isActive: isCurrent });
    if (!isCurrent()) return; // stale — a newer navigation has since taken over
    const post = posts.find((p) => String(p.id) === String(postId));

    if (!post) {
      renderMissing(root);
      return;
    }

    // Driver trip → not a respond surface; redirect to chat.
    if (post.type === 'trip' && post.passenger !== true) {
      go(`/chat?tripId=${encodeURIComponent(post.id)}`);
      return;
    }

    if (post.type === 'announcement' || post.type === 'system') {
      renderUnsupported(root, post);
      return;
    }

    if (post.type === 'marketplace') {
      renderMarketplace(root, post);
      return;
    }

    if (post.type === 'trip' && post.passenger === true) {
      renderPassengerRide(root, post);
      return;
    }

    renderUnsupported(root, post);
  }

  await renderRespond(false);
  return root;
}
