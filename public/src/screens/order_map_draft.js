// BD-MAP-04 placeholder — /order-map-draft is the CTA target from
// /route-preview. The real order composer ships in a later issue; this
// screen prevents the silent fallback to /feed and lets the user return
// to the preview or jump back to the picker.

import { go } from '../router.js';

export default function orderMapDraftScreen() {
  const root = document.createElement('section');
  root.className = 'screen screen--order-map-draft';

  const topbar = document.createElement('div');
  topbar.className = 'bd-topbar omd-topbar';
  topbar.innerHTML = `
    <button class="bd-iconbtn omd-topbar__back" type="button" data-action="back"
            aria-label="Назад к предпросмотру">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6"/>
      </svg>
    </button>
    <div class="bd-topbar__titles">
      <h1 class="bd-topbar__title">Оформление заказа</h1>
    </div>
  `;
  root.appendChild(topbar);

  const scroll = document.createElement('div');
  scroll.className = 'bd-scroll omd-scroll';
  scroll.innerHTML = `
    <div class="omd-card">
      <div class="omd-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9"/>
          <polyline points="12 7 12 12 15 14"/>
        </svg>
      </div>
      <h2 class="omd-title">Скоро: оформление заказа</h2>
      <p class="omd-hint">
        Экран оформления заказа появится в следующей итерации. Сейчас
        маршрут уже сохранён в черновике — вернитесь к предпросмотру
        или скорректируйте точки.
      </p>
      <button class="bd-btn primary omd-cta" type="button" data-action="back">
        Вернуться к предпросмотру
      </button>
      <button class="bd-btn omd-secondary" type="button" data-action="edit">
        Изменить маршрут
      </button>
    </div>
  `;
  root.appendChild(scroll);

  root.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'back') go('/route-preview');
    else if (target.dataset.action === 'edit') go('/route-picker');
  });

  return root;
}
