import { user } from '../state.js';
import { go, consumePendingAction } from '../router.js';

export default function onboarding() {
  const root = document.createElement('section');
  root.className = 'screen screen--onboarding';
  root.innerHTML = `
    <header class="screen__header">
      <h1 class="screen__title">Создать профиль</h1>
      <p class="screen__subtitle">Это займёт меньше минуты</p>
    </header>
    <form class="form" id="onboarding-form" novalidate>
      <label class="field">
        <span class="field__label">Как вас называть</span>
        <input class="field__input" name="displayName" type="text" required minlength="2" maxlength="40" autocomplete="nickname">
      </label>
      <label class="field">
        <span class="field__label">Город</span>
        <input class="field__input" name="city" type="text" required minlength="2" maxlength="40" autocomplete="address-level2">
      </label>
      <button type="submit" class="btn btn--primary">Готово</button>
      <button type="button" class="btn btn--ghost" id="onboarding-skip">Пропустить пока</button>
    </form>
  `;

  const form = root.querySelector('#onboarding-form');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const displayName = String(data.get('displayName') ?? '').trim();
    const city = String(data.get('city') ?? '').trim();
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
