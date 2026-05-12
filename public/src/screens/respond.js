import { user } from '../state.js';
import { go } from '../router.js';
import { escapeHtml } from '../util.js';

const RESPOND_KEY = 'bazardrive.respond.v1';
const MAX_MSG     = 300;

const MOCK_REQUEST = {
  id:        'trip_anna_vnukovo_park_pobedy',
  passenger: { name: 'Анна М.', initials: 'АМ', role: 'Пассажир', rating: '4.86' },
  from:      'Аэропорт Внуково',
  to:        'м. Парк Победы',
  when:      'Завтра, 07:00',
  price:     1500,
};

const MOCK_VEHICLE = {
  id:       'vehicle_camry_demo',
  name:     'Toyota Camry',
  plate:    'A123BE77',
  color:    'Серебристый',
  seats:    4,
  features: 'кондиционер',
};

const PRICE_CHIPS   = [1300, 1500, 1800];
const DEFAULT_MSG   = 'Здравствуйте! Готов забрать к указанному времени, авто Toyota Camry, есть место для чемодана.';

const TIMING_OPTIONS = [
  { key: 'at_time',   label: 'К указанному времени' },
  { key: 'earlier',   label: 'Могу раньше · 06:30'  },
  { key: 'negotiate', label: 'Договоримся'            },
];

function saveResponse(data) {
  try { localStorage.setItem(RESPOND_KEY, JSON.stringify(data)); } catch {}
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

export default function respond() {
  const u          = user.get();
  const hasVehicle = u.role === 'driver' || u.vehicleMake;

  const root = document.createElement('section');
  root.className = 'screen screen--respond';

  root.innerHTML = `
    <div class="respond__topbar">
      <button type="button" class="respond__back" id="respond-back" aria-label="Назад">
        <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="11 4 6 9 11 14"/>
        </svg>
      </button>
      <span class="respond__title">Ответ на заявку</span>
      <span class="respond__title-spacer" aria-hidden="true"></span>
    </div>

    <div class="bd-scroll respond__body" id="respond-body">

      <div class="bd-card respond__passenger-card">
        <div class="respond__passenger-header">
          <div class="feed-avatar respond__avatar" aria-hidden="true">
            ${escapeHtml(MOCK_REQUEST.passenger.initials)}
          </div>
          <div class="respond__passenger-info">
            <div class="respond__passenger-name">${escapeHtml(MOCK_REQUEST.passenger.name)}</div>
            <div class="respond__passenger-meta">
              ${escapeHtml(MOCK_REQUEST.passenger.role)} · ★ ${escapeHtml(MOCK_REQUEST.passenger.rating)}
            </div>
          </div>
        </div>
        <div class="respond__route">
          <span class="respond__route-from">${escapeHtml(MOCK_REQUEST.from)}</span>
          <span class="respond__route-arrow" aria-hidden="true">→</span>
          <span class="respond__route-to">${escapeHtml(MOCK_REQUEST.to)}</span>
        </div>
        <div class="respond__when">${escapeHtml(MOCK_REQUEST.when)}</div>
      </div>

      <form id="respond-form" novalidate>

        <div class="respond__section">
          <div class="bd-label">Ваша цена</div>
          <div class="respond__price-row">
            <input class="bd-input respond__price-input" id="respond-price"
                   name="price" type="number" min="1"
                   value="${MOCK_REQUEST.price}"
                   aria-label="Ваша цена в рублях">
            <span class="respond__price-currency" aria-hidden="true">₽</span>
          </div>
          <div class="respond__chips" role="group" aria-label="Быстрый выбор цены" id="price-chips">
            ${PRICE_CHIPS.map((p) => `
              <button type="button"
                      class="respond-chip${p === MOCK_REQUEST.price ? ' active' : ''}"
                      data-price="${p}">${p}</button>
            `).join('')}
          </div>
          <div class="respond__price-hint">Пассажир предлагает 1&nbsp;500&nbsp;₽</div>
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
                      placeholder="Напишите пассажиру…">${escapeHtml(DEFAULT_MSG)}</textarea>
            <div class="respond__counter" id="respond-counter" aria-live="polite">
              ${DEFAULT_MSG.length} / ${MAX_MSG}
            </div>
          </div>
        </div>

        ${hasVehicle ? `
          <div class="bd-card respond__vehicle-card">
            <div class="respond__vehicle-row">
              <div class="respond__vehicle-icon">${CAR_SVG}</div>
              <div class="respond__vehicle-info">
                <div class="respond__vehicle-name">
                  ${escapeHtml(MOCK_VEHICLE.name)} · ${escapeHtml(MOCK_VEHICLE.plate)}
                </div>
                <div class="respond__vehicle-meta">
                  ${escapeHtml(MOCK_VEHICLE.color)} · ${MOCK_VEHICLE.seats} места · ${escapeHtml(MOCK_VEHICLE.features)}
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
              class="bd-btn primary respond__btn-submit" id="respond-submit">
        ${SEND_SVG}
        <span class="respond__submit-label">Отправить отклик</span>
      </button>
    </div>

    <div class="respond__success" id="respond-success" hidden>
      <div class="respond__success-inner">
        <div class="respond__success-icon">${CHECK_SVG}</div>
        <h2 class="respond__success-title">Отклик отправлен</h2>
        <p class="respond__success-body">
          Пассажир увидит ваше предложение и сможет подтвердить поездку.
        </p>
        <button type="button" class="bd-btn primary" id="respond-success-back">
          Вернуться в ленту
        </button>
      </div>
    </div>
  `;

  // ── DOM refs ─────────────────────────────────────────────────────
  const form       = root.querySelector('#respond-form');
  const priceInput = root.querySelector('#respond-price');
  const msgArea    = root.querySelector('#respond-message');
  const counter    = root.querySelector('#respond-counter');
  const errorBox   = root.querySelector('#respond-error');
  const errorText  = root.querySelector('#respond-error-text');
  const submitBtn  = root.querySelector('#respond-submit');
  const submitLabel = root.querySelector('.respond__submit-label');
  const bodyEl     = root.querySelector('#respond-body');
  const footerEl   = root.querySelector('#respond-footer');
  const successEl  = root.querySelector('#respond-success');

  let selectedTiming = 'at_time';

  // ── Message counter ───────────────────────────────────────────────
  msgArea.addEventListener('input', () => {
    counter.textContent = `${msgArea.value.length} / ${MAX_MSG}`;
  });

  // ── Price chips ───────────────────────────────────────────────────
  root.querySelector('#price-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-price]');
    if (!chip) return;
    priceInput.value = chip.dataset.price;
    for (const c of root.querySelectorAll('[data-price]')) {
      c.classList.toggle('active', c === chip);
    }
    clearError();
  });

  // ── Timing chips ──────────────────────────────────────────────────
  root.querySelector('#timing-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-timing]');
    if (!chip) return;
    selectedTiming = chip.dataset.timing;
    for (const c of root.querySelectorAll('[data-timing]')) {
      c.classList.toggle('active', c === chip);
    }
  });

  // ── Error helpers ─────────────────────────────────────────────────
  function showError(msg) {
    errorText.textContent = msg;
    errorBox.hidden = false;
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function clearError() {
    errorBox.hidden = true;
    errorText.textContent = '';
  }

  // ── Loading helpers ───────────────────────────────────────────────
  function setLoading(on) {
    submitBtn.disabled = on;
    submitBtn.classList.toggle('loading', on);
    submitLabel.textContent = on ? 'Отправляем…' : 'Отправить отклик';
  }

  // ── Submit ────────────────────────────────────────────────────────
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearError();

    const price   = priceInput.value.trim();
    const message = msgArea.value.trim();

    if (!price || Number(price) <= 0) {
      showError('Укажите цену поездки');
      priceInput.focus();
      return;
    }
    if (!message) {
      showError('Напишите сообщение пассажиру');
      msgArea.focus();
      return;
    }

    setLoading(true);

    const response = {
      id:           'resp_demo_001',
      requestId:    MOCK_REQUEST.id,
      driverPrice:  Number(price),
      pickupTiming: selectedTiming,
      message,
      vehicleId:    MOCK_VEHICLE.id,
      status:       'SENT',
      createdAt:    new Date().toISOString(),
    };

    saveResponse(response);

    setTimeout(() => {
      bodyEl.hidden   = true;
      footerEl.hidden = true;
      successEl.hidden = false;
    }, 600);
  });

  // ── Navigation ────────────────────────────────────────────────────
  root.querySelector('#respond-back').addEventListener('click', () => go('/feed'));
  root.querySelector('#respond-cancel').addEventListener('click', () => go('/feed'));
  root.querySelector('#respond-success-back').addEventListener('click', () => go('/feed'));

  if (!hasVehicle) {
    root.querySelector('#respond-goto-profile').addEventListener('click', () => go('/profile'));
  }

  return root;
}
