import { user } from '../state.js';
import { go, consumePendingAction } from '../router.js';

export default function onboarding() {
  const root = document.createElement('section');
  root.className = 'screen screen--onboarding';

  root.innerHTML = `
    <div class="bd-topbar">
      <div class="bd-topbar__titles">
        <h1 class="bd-topbar__title">Создать профиль</h1>
        <p class="bd-topbar__sub">Займёт меньше минуты</p>
      </div>
    </div>
    <div class="onboarding__inner">
      <div class="onboarding__progress" role="progressbar" aria-valuenow="50" aria-valuemin="0" aria-valuemax="100">
        <div class="onboarding__progress-bar"></div>
      </div>
      <form class="onboarding__form" id="onboarding-form" novalidate>
        <div class="bd-field">
          <label class="bd-label" for="ob-name">Как вас называть</label>
          <input class="bd-input" id="ob-name" name="displayName"
                 type="text" required minlength="2" maxlength="40"
                 autocomplete="nickname" placeholder="Айдос">
        </div>
        <div class="bd-field">
          <label class="bd-label" for="ob-city">Город</label>
          <input class="bd-input" id="ob-city" name="city"
                 type="text" required minlength="2" maxlength="40"
                 autocomplete="address-level2" placeholder="Алматы">
        </div>
        <div class="onboarding__actions">
          <button type="submit" class="bd-btn primary">Готово</button>
          <button type="button" class="bd-btn ghost" id="onboarding-skip">Пропустить пока</button>
        </div>
      </form>
    </div>
  `;

  const form = root.querySelector('#onboarding-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const displayName = String(data.get('displayName') ?? '').trim();
    const city        = String(data.get('city') ?? '').trim();
    if (displayName.length < 2 || city.length < 2) return;

    user.set({ onboarded: true, displayName, city });
    const pending = consumePendingAction();
    if (pending) pending(); else go('/profile');
  });

  root.querySelector('#onboarding-skip').addEventListener('click', () => {
    consumePendingAction();
    go('/feed');
  });

  return root;
}
