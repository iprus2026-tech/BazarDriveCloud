import { user } from '../state.js';
import { go } from '../router.js';

export default function welcome() {
  const root = document.createElement('section');
  root.className = 'screen screen--welcome';
  root.innerHTML = `
    <div class="welcome__glow" aria-hidden="true"></div>
    <div class="welcome__body">
      <div class="welcome__hero">
        <div class="welcome__logo" aria-hidden="true">
          <svg viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="12" y="6" width="28" height="42" rx="6" fill="#1a1a1f" stroke="#FF6B35" stroke-width="1.5"/>
            <circle cx="26" cy="28" r="8" fill="#FF6B35"/>
            <rect x="18" y="40" width="16" height="2.5" rx="1.25" fill="#FF6B35" opacity="0.55"/>
            <circle cx="26" cy="28" r="3" fill="#1a0a04"/>
          </svg>
        </div>
        <h1 class="welcome__title">BazarDrive</h1>
        <p class="welcome__lead">Объявления и сообщество водителей. Без шума и накруток.</p>
      </div>
      <div class="welcome__actions">
        <button type="button" class="bd-btn primary" id="welcome-enter">Войти в ленту</button>
        <p class="welcome__hint">Регистрация не нужна — посмотрите сначала</p>
      </div>
    </div>
  `;

  root.querySelector('#welcome-enter').addEventListener('click', () => {
    user.set({ welcomeSeen: true });
    go('/feed');
  });

  return root;
}
