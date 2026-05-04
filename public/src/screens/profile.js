import { user } from '../state.js';
import { go } from '../router.js';
import { escapeHtml } from '../util.js';

export default function profile() {
  const root = document.createElement('section');
  root.className = 'screen';
  const u = user.get();

  if (u.onboarded) {
    const initials = (u.displayName || '?')
      .split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

    root.innerHTML = `
      <div class="bd-topbar">
        <div class="bd-topbar__titles">
          <h1 class="bd-topbar__title">Профиль</h1>
        </div>
      </div>
      <div class="bd-scroll">
        <div class="profile__hero">
          <div class="bd-avatar xl" aria-hidden="true">${escapeHtml(initials)}</div>
          <p class="profile__name">${escapeHtml(u.displayName ?? '—')}</p>
          <p class="profile__city muted">${escapeHtml(u.city ?? '—')}</p>
        </div>
        <div class="profile__block">
          <div class="bd-stats">
            <div class="bd-stat">
              <span class="bd-stat__num">0</span>
              <span class="bd-stat__label">Объявлений</span>
            </div>
            <div class="bd-stat">
              <span class="bd-stat__num">0</span>
              <span class="bd-stat__label">Откликов</span>
            </div>
          </div>
          <button type="button" class="bd-btn" id="profile-new">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <line x1="9" y1="3" x2="9" y2="15"/><line x1="3" y1="9" x2="15" y2="9"/>
            </svg>
            Новое объявление
          </button>
          <div style="height:10px"></div>
          <button type="button" class="bd-btn danger" id="profile-reset">Сбросить профиль</button>
        </div>
      </div>
    `;

    root.querySelector('#profile-new').addEventListener('click', () => go('/new'));
    root.querySelector('#profile-reset').addEventListener('click', () => {
      user.reset();
      go('/welcome');
    });

    return root;
  }

  root.innerHTML = `
    <div class="bd-topbar">
      <div class="bd-topbar__titles">
        <h1 class="bd-topbar__title">Гость</h1>
        <p class="bd-topbar__sub">Профиль доступен после регистрации</p>
      </div>
    </div>
    <div class="bd-scroll">
      <div class="bd-card">
        <p style="color:var(--text-2);line-height:1.55;margin-bottom:16px;">
          Листать ленту и читать правила можно без аккаунта.
          Чтобы публиковать объявления — создайте профиль.
        </p>
        <button type="button" class="bd-btn primary" id="profile-signup">Создать профиль</button>
      </div>
    </div>
  `;

  root.querySelector('#profile-signup').addEventListener('click', () => go('/onboarding'));
  return root;
}
