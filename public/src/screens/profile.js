import { user } from '../state.js';
import { go } from '../router.js';
import { escapeHtml } from '../util.js';

export default function profile() {
  const root = document.createElement('section');
  root.className = 'screen screen--profile';
  const u = user.get();

  if (u.onboarded) {
    root.innerHTML = `
      <header class="screen__header">
        <h1 class="screen__title">${escapeHtml(u.displayName ?? 'Профиль')}</h1>
        <p class="screen__subtitle">${escapeHtml(u.city ?? '—')}</p>
      </header>
      <div class="profile__stats">
        <div class="stat"><span class="stat__num">0</span><span class="stat__label">Объявлений</span></div>
        <div class="stat"><span class="stat__num">0</span><span class="stat__label">Откликов</span></div>
      </div>
    `;
    return root;
  }

  root.innerHTML = `
    <header class="screen__header">
      <h1 class="screen__title">Гость</h1>
      <p class="screen__subtitle">Профиль доступен после регистрации</p>
    </header>
    <div class="profile__lite">
      <p class="profile__lite-text">
        Можно листать ленту и читать правила без аккаунта.
        Чтобы публиковать объявления и откликаться, нужно создать профиль.
      </p>
      <button type="button" class="btn btn--primary" id="profile-signup">Создать профиль</button>
    </div>
  `;
  root.querySelector('#profile-signup').addEventListener('click', () => go('/onboarding'));
  return root;
}
