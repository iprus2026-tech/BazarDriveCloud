import { user } from '../state.js';
import { go } from '../router.js';
import { escapeHtml } from '../util.js';
import { listFeedPosts } from '../mock_api.js';

const RESPOND_KEY = 'bazardrive.respond.v1';
const MAX_MSG     = 300;

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

function getDefaultMessage(vehicle) {
  if (!vehicle) {
    return 'Здравствуйте! Готов забрать к указанному времени, есть место для чемодана.';
  }
  return `Здравствуйте! Готов забрать к указанному времени, авто ${vehicle.name}, есть место для чемодана.`;
}

function getUserVehicle(u) {
  if (!u.vehicleMake || !u.vehicleModel || !u.vehiclePlate) return null;
  return {
    id:       'user_vehicle',
    name:     `${u.vehicleMake} ${u.vehicleModel}`,
    plate:    u.vehiclePlate,
    color:    u.vehicleColor || 'Цвет не указан',
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
      id:        'resp_demo_001',
      kind:      'marketplace_message',
      requestId: post.id,
      message,
      status:    'SENT',
      createdAt: new Date().toISOString(),
    };
    saveResponse(response);

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

  form.addEventListener('submit', (e) => {
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
    const response = {
      id:           responseId,
      kind:         'passenger_response',
      requestId:    post.id,
      driverPrice:  priceNum,
      pickupTiming: selectedTiming,
      message,
      vehicleId:    vehicle.id,
      status:       'SENT',
      createdAt:    new Date().toISOString(),
    };

    saveResponse(response);

    const chatHref = `/chat?responseId=${encodeURIComponent(responseId)}`;
    root.querySelector('#respond-success-chat')
      .addEventListener('click', () => go(chatHref));

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

  if (!hasVehicle) {
    root.querySelector('#respond-goto-profile').addEventListener('click', () => go('/profile'));
  }
}

export default async function respond() {
  const root = document.createElement('section');
  root.className = 'screen screen--respond';

  const postId = getRouteParam('postId');

  if (!postId) {
    renderMissing(root);
    return root;
  }

  const posts = await listFeedPosts();
  const post = posts.find((p) => String(p.id) === String(postId));

  if (!post) {
    renderMissing(root);
    return root;
  }

  // Driver trip → not a respond surface; redirect to chat.
  if (post.type === 'trip' && post.passenger !== true) {
    go(`/chat?tripId=${encodeURIComponent(post.id)}`);
    return root;
  }

  if (post.type === 'announcement' || post.type === 'system') {
    renderUnsupported(root, post);
    return root;
  }

  if (post.type === 'marketplace') {
    renderMarketplace(root, post);
    return root;
  }

  if (post.type === 'trip' && post.passenger === true) {
    renderPassengerRide(root, post);
    return root;
  }

  renderUnsupported(root, post);
  return root;
}
