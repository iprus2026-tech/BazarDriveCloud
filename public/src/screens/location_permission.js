// BD-MAP-02 - LocationPermission screen.
// Explains geolocation value before route picking.
// No native geolocation prompt, no real Mapbox, no backend.

import { escapeHtml } from '../util.js';
import { go } from '../router.js';
import { saveMapPrefs } from '../mapbox/mapbox_state.js';
import { createMapShell } from '../mapbox/map_shell.js';

const BENEFITS = [
  {
    title: 'Заказы и водители рядом',
    text: 'BazarDrive сможет показать ближайшие заявки и подсказать, кто рядом.',
  },
  {
    title: 'Точка подачи без ручного поиска',
    text: 'Не нужно каждый раз вводить адрес, старт маршрута появится быстрее.',
  },
  {
    title: 'Быстрее построить маршрут',
    text: 'Маршрут, время и примерная цена собираются аккуратнее от вашей точки.',
  },
];

function backIcon() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M15 18l-6-6 6-6"/>
    </svg>
  `;
}

function pinIcon() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 21s7-5.1 7-12a7 7 0 0 0-14 0c0 6.9 7 12 7 12z"/>
      <circle cx="12" cy="9" r="2.4"/>
    </svg>
  `;
}

function checkIcon() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  `;
}

function buildHero() {
  const hero = document.createElement('div');
  hero.className = 'loc-perm__hero';

  const mapShell = createMapShell({
    variant: 'passenger',
    showRoute: false,
    showCar: true,
    showPickup: true,
    showDropoff: false,
    showLabels: false,
  });
  mapShell.classList.add('loc-perm__map-shell');
  mapShell.setAttribute('aria-hidden', 'true');

  hero.appendChild(mapShell);

  const badge = document.createElement('div');
  badge.className = 'loc-perm__floating-card';
  badge.innerHTML = `
    <div class="loc-perm__floating-icon">${pinIcon()}</div>
    <div>
      <div class="loc-perm__floating-title">Моё место</div>
      <div class="loc-perm__floating-sub">mock permission gate</div>
    </div>
  `;
  hero.appendChild(badge);

  const watermark = document.createElement('div');
  watermark.className = 'loc-perm__watermark';
  watermark.textContent = 'Mapbox SDK пока не подключён';
  hero.appendChild(watermark);

  return hero;
}

function buildBenefits() {
  return BENEFITS.map((item) => `
    <li class="loc-perm__benefit">
      <span class="loc-perm__benefit-icon">${checkIcon()}</span>
      <span class="loc-perm__benefit-copy">
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.text)}</span>
      </span>
    </li>
  `).join('');
}

export default function locationPermissionScreen() {
  const root = document.createElement('section');
  root.className = 'screen screen--location-permission';

  root.innerHTML = `
    <div class="bd-topbar loc-perm__topbar">
      <button class="loc-perm__back" type="button" data-action="back" aria-label="Назад к карте">
        ${backIcon()}
      </button>
      <div class="bd-topbar__titles">
        <h1 class="bd-topbar__title">Моё место</h1>
        <p class="bd-topbar__sub loc-perm__sub">геолокация в безопасном mock-режиме</p>
      </div>
    </div>
  `;

  root.appendChild(buildHero());

  const card = document.createElement('div');
  card.className = 'loc-perm__sheet';
  card.innerHTML = `
    <div class="loc-perm__sheet-grip" aria-hidden="true"></div>

    <div class="loc-perm__intro">
      <span class="loc-perm__eyebrow">BD-MAP-02</span>
      <h2>Разрешите доступ к геолокации</h2>
      <p>
        BazarDrive покажет заказы, водителей и точку подачи рядом с вами.
        Сейчас это только безопасная настройка в localStorage: браузерный запрос геолокации не вызывается.
      </p>
    </div>

    <ul class="loc-perm__benefits" aria-label="Что даёт доступ к геолокации">
      ${buildBenefits()}
    </ul>

    <div class="loc-perm__notice" role="note">
      <strong>Без настоящего Mapbox.</strong>
      Нативный permission prompt и реальные координаты будут подключены отдельной задачей.
    </div>

    <div class="loc-perm__actions">
      <button class="bd-btn primary loc-perm__primary" type="button" data-action="allow">
        Разрешить доступ
      </button>
      <button class="bd-btn loc-perm__secondary" type="button" data-action="manual">
        Выбрать адрес вручную
      </button>
      <button class="loc-perm__plain" type="button" data-action="back">
        Назад к карте
      </button>
    </div>
  `;

  root.appendChild(card);

  root.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn || btn.disabled) return;

    const action = btn.dataset.action;

    if (action === 'allow') {
      saveMapPrefs({ locationAllowed: true });
      go('/map?state=default');
      return;
    }

    if (action === 'manual') {
      go('/route-picker');
      return;
    }

    if (action === 'back') {
      go('/map');
    }
  });

  return root;
}
