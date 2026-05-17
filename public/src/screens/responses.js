import { go } from '../router.js';
import { escapeHtml } from '../util.js';

const MOCK_RESPONSES_STATE = {
  request: {
    id:          'post_1001',
    orderId:     'order_1001',
    passengerId: 'user_1001',
    status:      'PUBLISHED',
    pickupLabel: 'ТЦ Мега',
    dropoffLabel:'Аэропорт, терминал B',
    price:       '950 ₽',
    note:        'Маленький чемодан',
  },
  responses: [],
};

const BACK_SVG = `
  <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="11 4 6 9 11 14"/>
  </svg>`;

const SHIELD_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="18" height="18">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>`;

const PENCIL_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="14" height="14">
    <path d="M12 20h9"/>
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>
  </svg>`;

const CAR_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="28" height="28">
    <path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1l2-4h10l2 4h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/>
    <circle cx="7.5" cy="17.5" r="2.5"/>
    <circle cx="16.5" cy="17.5" r="2.5"/>
  </svg>`;

const SPARK_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="16" height="16">
    <path d="M12 2v4"/>
    <path d="M12 18v4"/>
    <path d="M4.93 4.93l2.83 2.83"/>
    <path d="M16.24 16.24l2.83 2.83"/>
    <path d="M2 12h4"/>
    <path d="M18 12h4"/>
    <path d="M4.93 19.07l2.83-2.83"/>
    <path d="M16.24 7.76l2.83-2.83"/>
  </svg>`;

const INFO_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="16" height="16">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="8" x2="12" y2="12"/>
    <line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>`;

function getRouteParam(name) {
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  if (qi === -1) return null;
  return new URLSearchParams(hash.slice(qi + 1)).get(name);
}

function markFeedTabActive() {
  const tabbar = document.getElementById('tabbar');
  if (!tabbar) return;
  for (const btn of tabbar.querySelectorAll('[data-route]')) {
    btn.classList.toggle('active', btn.dataset.route === '/feed');
  }
}

export default function responses() {
  const postId = getRouteParam('postId') || MOCK_RESPONSES_STATE.request.id;
  const request = MOCK_RESPONSES_STATE.request;

  const root = document.createElement('section');
  root.className = 'screen screen--responses';
  root.dataset.postId = postId;

  root.innerHTML = `
    <div class="responses__topbar">
      <button type="button" class="responses__icon-btn" id="responses-back" aria-label="Назад">
        ${BACK_SVG}
      </button>
      <div class="responses__titles">
        <div class="responses__title">Отклики водителей</div>
        <div class="responses__sub">Ждём предложения</div>
      </div>
      <button type="button" class="responses__icon-btn" id="responses-shield" aria-label="Безопасность">
        ${SHIELD_SVG}
      </button>
    </div>

    <div class="bd-scroll responses__scroll">

      <div class="bd-card responses__request" aria-label="Опубликованная заявка">
        <div class="responses__request-main">
          <div class="responses__route">
            <div class="responses__stop">
              <span class="responses__marker responses__marker--pickup" aria-hidden="true"></span>
              <span class="responses__stop-label">${escapeHtml(request.pickupLabel)}</span>
            </div>
            <span class="responses__route-line" aria-hidden="true"></span>
            <div class="responses__stop">
              <span class="responses__marker responses__marker--dropoff" aria-hidden="true"></span>
              <span class="responses__stop-label">${escapeHtml(request.dropoffLabel)}</span>
            </div>
          </div>
          <div class="responses__price">
            <div class="responses__price-label">Ваша цена</div>
            <div class="responses__price-value">${escapeHtml(request.price)}</div>
          </div>
        </div>
        <div class="responses__request-foot">
          <div class="responses__note">
            ${INFO_SVG}
            <span>${escapeHtml(request.note)}</span>
          </div>
          <button type="button" class="responses__edit" id="responses-edit">
            ${PENCIL_SVG}
            <span>Изменить</span>
          </button>
        </div>
      </div>

      <div class="responses__empty">
        <div class="responses__empty-icon" aria-hidden="true">
          <span class="responses__empty-glow"></span>
          <span class="responses__empty-icon-inner">${CAR_SVG}</span>
        </div>
        <h2 class="responses__empty-title">Ищем водителей...</h2>
        <p class="responses__empty-body">
          Заявка опубликована. Обычно первый отклик приходит за 1–3 минуты.
        </p>
      </div>

      <div class="responses__hints">
        <div class="responses__hint">
          <span class="responses__hint-icon" aria-hidden="true">${SPARK_SVG}</span>
          <span class="responses__hint-text">
            Повысьте цену на 100–200 ₽ — откликов будет в 2 раза больше
          </span>
        </div>
        <div class="responses__hint">
          <span class="responses__hint-icon responses__hint-icon--info" aria-hidden="true">${INFO_SVG}</span>
          <span class="responses__hint-text">
            Можно подождать — вы получите push, как только водитель откликнется
          </span>
        </div>
      </div>

    </div>

    <div class="responses__footer">
      <button type="button" class="bd-btn responses__cta" id="responses-raise">
        ${PENCIL_SVG}
        <span>Поднять цену</span>
      </button>
    </div>

    <div class="responses__toast" id="responses-toast" role="status" aria-live="polite" hidden></div>
  `;

  const toastEl = root.querySelector('#responses-toast');
  let toastTimer = null;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2800);
  }

  root.querySelector('#responses-back').addEventListener('click', () => go('/feed'));

  root.querySelector('#responses-shield').addEventListener('click', () => {
    toast('Безопасность будет добавлена позже');
  });

  root.querySelector('#responses-edit').addEventListener('click', () => {
    toast('Редактирование заявки будет добавлено позже');
  });

  root.querySelector('#responses-raise').addEventListener('click', () => {
    toast('Изменение цены будет добавлено позже');
  });

  queueMicrotask(markFeedTabActive);

  return root;
}
