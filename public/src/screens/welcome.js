import { user } from '../state.js';
import { go, consumePendingAction } from '../router.js';

export default function welcome() {
  const root = document.createElement('section');
  root.className = 'screen screen--welcome';

  root.innerHTML = `
    <div class="welcome__glow" aria-hidden="true"></div>
    <div class="welcome__body">
      <div class="welcome__hero">
        <div class="welcome__logo" aria-hidden="true">
          <svg viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="26" cy="26" r="26" fill="rgba(255,107,53,0.12)"/>
            <path d="M14 38 L26 14 L38 38 Z" fill="none" stroke="#FF6B35" stroke-width="2.5" stroke-linejoin="round"/>
            <circle cx="26" cy="26" r="5" fill="#FF6B35"/>
            <path d="M18 38 L34 38" stroke="#FF6B35" stroke-width="2.5" stroke-linecap="round"/>
          </svg>
        </div>
        <h1 class="welcome__title">BazarDrive</h1>
        <p class="welcome__tagline">Taxi marketplace</p>
        <p class="welcome__lead">Объявления, поездки и попутчики&nbsp;— без накруток.</p>
      </div>

      <ul class="welcome__props" aria-label="Возможности приложения">
        <li class="welcome__prop">
          <span class="welcome__prop-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 17h14M7 17v2M17 17v2"/>
              <path d="M5 17v-3l2-5h10l2 5v3"/>
              <circle cx="8" cy="14" r="1.2" fill="currentColor"/>
              <circle cx="16" cy="14" r="1.2" fill="currentColor"/>
            </svg>
          </span>
          <span>Найдите водителя рядом с вами</span>
        </li>
        <li class="welcome__prop">
          <span class="welcome__prop-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12z"/>
              <circle cx="12" cy="10" r="2.5"/>
            </svg>
          </span>
          <span>Поездки, попутчики, объявления</span>
        </li>
        <li class="welcome__prop">
          <span class="welcome__prop-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </span>
          <span>Безопасно и прозрачно</span>
        </li>
      </ul>

      <div class="welcome__actions">
        <button type="button" class="bd-btn primary" id="welcome-start">Начать</button>
        <button type="button" class="bd-btn ghost" id="welcome-guest">Войти без регистрации</button>
      </div>
    </div>
  `;

  root.querySelector('#welcome-start').addEventListener('click', () => {
    user.set({ welcomeSeen: true });
    go('/onboarding');
  });

  root.querySelector('#welcome-guest').addEventListener('click', () => {
    user.set({ welcomeSeen: true, role: 'guest' });
    consumePendingAction();
    go('/feed');
  });

  return root;
}
