import { go } from '../router.js';

// BD-SETTINGS-01 — Settings screen. Net-new surface ported from the Cloud
// Design render gate (st-*/bd-* prototype) into repo-native settings__*
// classes that reuse the shipped bd-card / bd-scroll / bd-btn / bd-list-icon /
// bd-section-h atoms. Mock/UI only: every control persists nothing, calls no
// backend, registers no real push, and performs no real logout/delete. The
// screen is reachable from both profile gears (passenger #pfp-settings-btn,
// driver #pf2-gear) and reads ?role= to send «Назад» back to the right profile.

// ── Inline icon set (stroke glyphs, ported verbatim from the gate) ──
function svg(body, size = 24, sw = 1.7) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
const I_BACK    = '<path d="m15 18-6-6 6-6"/>';
const I_CHEVRON = '<path d="m9 18 6-6-6-6"/>';
const I_INFO    = '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>';
const I_THEME   = '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>';
const I_BELL    = '<path d="M6 8a6 6 0 0112 0c0 6 3 7 3 7H3s3-1 3-7"/><path d="M10 21a2 2 0 004 0"/>';
const I_USER    = '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>';
const I_CARD    = '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M16 13h2"/><path d="M3 10h18"/>';
const I_LOGOUT  = '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>';
const I_TRASH   = '<path d="M3 6h18"/><path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>';
const I_ALERT   = '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>';
const I_CHECK   = '<path d="M20 6 9 17l-5-5"/>';

const LANGUAGES = ['Русский', 'Қазақша', 'English', 'O‘zbekcha'];

function getParam(name) {
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  if (qi === -1) return null;
  return new URLSearchParams(hash.slice(qi + 1)).get(name);
}

function profileRoute(role) {
  return role === 'driver' ? '/profile?role=driver' : '/profile';
}

function langOptionsHtml() {
  return LANGUAGES.map((label, i) => `
    <button type="button" class="settings__lang-opt${i === 0 ? ' settings__lang-opt--on' : ''}" data-lang="${i}">
      <span class="settings__lang-opt-label">${label}</span>
      <span class="settings__lang-opt-check" aria-hidden="true">${svg(I_CHECK, 16, 2.4)}</span>
    </button>`).join('');
}

export default function settings() {
  const role = getParam('role') === 'driver' ? 'driver' : 'passenger';
  const stateParam = getParam('state');

  const root = document.createElement('section');
  root.className = 'screen screen--settings';

  root.innerHTML = `
    <div class="settings__topbar">
      <button type="button" class="settings__icon-btn" id="settings-back" aria-label="Назад">${svg(I_BACK, 18, 2)}</button>
      <div class="settings__title">Настройки</div>
      <span class="settings__topbar-spacer" aria-hidden="true"></span>
    </div>

    <div class="bd-scroll settings__scroll">
      <div class="bd-section-h"><h2>Приложение</h2></div>
      <div class="bd-card settings__card">
        <button type="button" class="settings__row" id="settings-lang-row" aria-expanded="false">
          <span class="bd-list-icon">${svg(I_INFO, 24)}</span>
          <span class="settings__row-body"><span class="settings__row-label">Язык</span></span>
          <span class="settings__value"><span id="settings-lang-value">Русский</span><span class="settings__value-chev" aria-hidden="true">${svg(I_CHEVRON, 16)}</span></span>
        </button>
        <div class="settings__lang-list" id="settings-lang-list" hidden>${langOptionsHtml()}</div>
        <div class="settings__row settings__row--stack">
          <div class="settings__row-head">
            <span class="bd-list-icon">${svg(I_THEME, 18)}</span>
            <span class="settings__row-label">Тема</span>
          </div>
          <div class="settings__seg" role="group" aria-label="Тема оформления">
            <button type="button" class="settings__seg-btn" data-theme="light">Светлая</button>
            <button type="button" class="settings__seg-btn settings__seg-btn--on" data-theme="dark">Тёмная</button>
            <button type="button" class="settings__seg-btn" data-theme="system">Системная</button>
          </div>
        </div>
      </div>

      <div class="bd-section-h"><h2>Уведомления</h2></div>
      <div class="bd-card settings__card">
        <button type="button" class="settings__row" id="settings-push-row" aria-pressed="false">
          <span class="bd-list-icon">${svg(I_BELL, 24)}</span>
          <span class="settings__row-body"><span class="settings__row-label">Push-уведомления</span></span>
          <span class="settings__toggle" id="settings-push-toggle" aria-hidden="true"></span>
        </button>
        <button type="button" class="settings__row" id="settings-sound-row" aria-pressed="false" hidden>
          <span class="bd-list-icon">${svg(I_THEME, 24)}</span>
          <span class="settings__row-body"><span class="settings__row-label">Звук</span></span>
          <span class="settings__toggle" id="settings-sound-toggle" aria-hidden="true"></span>
        </button>
      </div>
      <div class="settings__note">
        <span class="settings__note-ic" aria-hidden="true">${svg(I_INFO, 13, 1.9)}</span>
        <span>Доставка уведомлений — демо-режим, реальные push не отправляются.</span>
      </div>

      <div class="bd-section-h"><h2>Аккаунт</h2></div>
      <div class="bd-card settings__card">
        <button type="button" class="settings__row" id="settings-profile">
          <span class="bd-list-icon">${svg(I_USER, 24)}</span>
          <span class="settings__row-body"><span class="settings__row-label">Профиль</span></span>
          <span class="settings__row-chev" aria-hidden="true">${svg(I_CHEVRON, 18)}</span>
        </button>
        <button type="button" class="settings__row" id="settings-payments">
          <span class="bd-list-icon">${svg(I_CARD, 24)}</span>
          <span class="settings__row-body"><span class="settings__row-label">Способы оплаты</span></span>
          <span class="settings__row-chev" aria-hidden="true">${svg(I_CHEVRON, 18)}</span>
        </button>
        <button type="button" class="settings__row settings__row--danger" id="settings-logout">
          <span class="bd-list-icon settings__list-icon--danger">${svg(I_LOGOUT, 24)}</span>
          <span class="settings__row-body"><span class="settings__row-label">Выйти</span></span>
        </button>
        <button type="button" class="settings__row settings__row--danger" id="settings-delete">
          <span class="bd-list-icon settings__list-icon--danger">${svg(I_TRASH, 24)}</span>
          <span class="settings__row-body"><span class="settings__row-label">Удалить аккаунт</span></span>
        </button>
      </div>

      <div class="settings__confirm" id="settings-delete-confirm" hidden>
        <div class="settings__confirm-head">
          <span class="settings__confirm-ic" aria-hidden="true">${svg(I_ALERT, 18, 2)}</span>
          <div class="settings__confirm-copy">
            <div class="settings__confirm-title">Удалить аккаунт?</div>
            <div class="settings__confirm-sub">Действие необратимо. Демо-режим — данные не удаляются.</div>
          </div>
        </div>
        <div class="settings__confirm-actions">
          <button type="button" class="bd-btn settings__confirm-cancel" id="settings-delete-cancel">Отмена</button>
          <button type="button" class="bd-btn danger settings__confirm-go" id="settings-delete-go">Удалить</button>
        </div>
      </div>

      <div class="settings__banner settings__banner--error" id="settings-error" role="alert"${stateParam === 'error' ? '' : ' hidden'}>
        <span class="settings__banner-ic" aria-hidden="true">${svg(I_ALERT, 16, 2)}</span>
        <span class="settings__banner-text">Не удалось сохранить — попробуйте ещё раз</span>
      </div>

      <div class="settings__actions">
        <button type="button" class="bd-btn primary" id="settings-save">Сохранить</button>
      </div>
      <div class="settings__version">BazarDrive · v1.0 · демо</div>
    </div>

    <div class="settings__toast" id="settings-toast" role="status" aria-live="polite" hidden>
      <span class="settings__toast-ic" aria-hidden="true">${svg(I_CHECK, 14, 2.6)}</span>
      <span class="settings__toast-text">Сохранено</span>
    </div>
  `;

  // ── Toast (session-only feedback) ────────────────────────
  const toastEl = root.querySelector('#settings-toast');
  const toastText = root.querySelector('.settings__toast-text');
  let toastTimer = null;
  function toast(message) {
    if (toastText) toastText.textContent = message;
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
  }

  // ── Back → the profile we came from (role-aware) ─────────
  root.querySelector('#settings-back').addEventListener('click', () => go(profileRoute(role)));

  // ── Language picker — expand list, pick one, collapse ────
  const langRow = root.querySelector('#settings-lang-row');
  const langList = root.querySelector('#settings-lang-list');
  const langValue = root.querySelector('#settings-lang-value');
  langRow.addEventListener('click', () => {
    const open = langList.hidden;
    langList.hidden = !open;
    langRow.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  langList.querySelectorAll('.settings__lang-opt').forEach((opt) => {
    opt.addEventListener('click', () => {
      langList.querySelectorAll('.settings__lang-opt').forEach((o) => o.classList.toggle('settings__lang-opt--on', o === opt));
      const label = opt.querySelector('.settings__lang-opt-label');
      if (langValue && label) langValue.textContent = label.textContent;
      langList.hidden = true;
      langRow.setAttribute('aria-expanded', 'false');
    });
  });

  // ── Theme segmented control ──────────────────────────────
  const segBtns = Array.from(root.querySelectorAll('.settings__seg-btn'));
  segBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      segBtns.forEach((b) => b.classList.toggle('settings__seg-btn--on', b === btn));
    });
  });

  // ── Push toggle reveals the Звук row; both are demo toggles ─
  const pushRow = root.querySelector('#settings-push-row');
  const pushToggle = root.querySelector('#settings-push-toggle');
  const soundRow = root.querySelector('#settings-sound-row');
  const soundToggle = root.querySelector('#settings-sound-toggle');
  pushRow.addEventListener('click', () => {
    const on = pushToggle.classList.toggle('settings__toggle--on');
    pushRow.setAttribute('aria-pressed', on ? 'true' : 'false');
    soundRow.hidden = !on;
    if (!on) {
      soundToggle.classList.remove('settings__toggle--on');
      soundRow.setAttribute('aria-pressed', 'false');
    }
  });
  soundRow.addEventListener('click', () => {
    const on = soundToggle.classList.toggle('settings__toggle--on');
    soundRow.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  // ── Account rows (UI-only) ───────────────────────────────
  root.querySelector('#settings-profile').addEventListener('click', () => go(profileRoute(role)));
  root.querySelector('#settings-payments').addEventListener('click', () => toast('Способы оплаты будут доступны позже'));
  root.querySelector('#settings-logout').addEventListener('click', () => toast('Демо-режим: выход не выполняется'));

  // ── Delete account — reveal confirm, demo-only ───────────
  const deleteRow = root.querySelector('#settings-delete');
  const confirmBlock = root.querySelector('#settings-delete-confirm');
  deleteRow.addEventListener('click', () => {
    confirmBlock.hidden = false;
    if (typeof confirmBlock.scrollIntoView === 'function') confirmBlock.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  root.querySelector('#settings-delete-cancel').addEventListener('click', () => { confirmBlock.hidden = true; });
  root.querySelector('#settings-delete-go').addEventListener('click', () => {
    confirmBlock.hidden = true;
    toast('Демо-режим: аккаунт не удаляется');
  });

  // ── Save — demo success feedback (no backend) ────────────
  root.querySelector('#settings-save').addEventListener('click', () => toast('Сохранено'));

  return root;
}
