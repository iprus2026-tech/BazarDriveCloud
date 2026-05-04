import { user } from '../state.js';
import { go } from '../router.js';

export default function welcome() {
  const root = document.createElement('section');
  root.className = 'screen screen--welcome';
  root.innerHTML = `
    <div class="welcome__hero">
      <div class="welcome__logo" aria-hidden="true">
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <rect x="32" y="22" width="36" height="56" rx="7" fill="#131316" stroke="#FF6B35" stroke-width="1.5"/>
          <circle cx="50" cy="50" r="8" fill="#FF6B35"/>
          <rect x="40" y="64" width="20" height="3" rx="1.5" fill="#FF6B35" opacity="0.6"/>
        </svg>
      </div>
      <h1 class="welcome__title">BazarDrive</h1>
      <p class="welcome__lead">Объявления и сообщество водителей. Без шума и накруток.</p>
    </div>
    <div class="welcome__actions">
      <button type="button" class="btn btn--primary" id="welcome-continue">Продолжить</button>
      <p class="welcome__hint">Регистрация не нужна — посмотрите сначала.</p>
    </div>
  `;
  root.querySelector('#welcome-continue').addEventListener('click', () => {
    user.set({ welcomeSeen: true });
    go('/feed');
  });
  return root;
}
