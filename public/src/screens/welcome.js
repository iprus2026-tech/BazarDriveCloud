import { user } from '../state.js';
import { go, consumePendingAction } from '../router.js';

// BD-ONBOARDING-01 — Welcome render gate. Five UI-only states layered
// inside a single screen module:
//   01A welcome      — brand hero + value strip + Начать / Войти
//   01B role         — Пассажир / Водитель + Продолжить (gated until pick)
//   01C permissions  — location + notifications rationale + privacy
//   01D loading      — short UI-only transition (no backend call)
//   01E error        — friendly retry state
//
// On success the gate routes by role: passenger → /feed, driver →
// /driver-map. Returning users (`onboarded === true`) skip the gate
// and land on /feed (driver mode → /driver-map) so the manual /welcome
// URL does not interrupt regular sessions.
//
// `?step=…` is a render-gate preview affordance that forces a specific
// step without persisting any state. Mirrors the existing `?state=…`
// and `?garage=…` preview pattern used by Profile.

const STEPS = new Set(['welcome', 'role', 'permissions', 'loading', 'error']);

// ── Inline SVGs ──────────────────────────────────────────────────────────────
const SVG_LOGO = `<svg viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="26" cy="26" r="26" fill="rgba(255,107,53,0.12)"/>
  <path d="M14 38 L26 14 L38 38 Z" fill="none" stroke="#FF6B35" stroke-width="2.5" stroke-linejoin="round"/>
  <circle cx="26" cy="26" r="5" fill="#FF6B35"/>
  <path d="M18 38 L34 38" stroke="#FF6B35" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;

const SVG_CAR = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M5 17h14M7 17v2M17 17v2"/>
  <path d="M5 17v-3l2-5h10l2 5v3"/>
  <circle cx="8" cy="14" r="1.2" fill="currentColor"/>
  <circle cx="16" cy="14" r="1.2" fill="currentColor"/>
</svg>`;

const SVG_LIST = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/>
</svg>`;

const SVG_PIN = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12z"/>
  <circle cx="12" cy="10" r="2.5"/>
</svg>`;

const SVG_PERSON = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.582-7 8-7s8 3 8 7"/>
</svg>`;

const SVG_STEERING = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="9"/>
  <circle cx="12" cy="12" r="3"/>
  <path d="M12 9V3"/><path d="m9.5 13.5-5 4"/><path d="m14.5 13.5 5 4"/>
</svg>`;

const SVG_BELL = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
  <path d="M10 21a2 2 0 0 0 4 0"/>
</svg>`;

const SVG_SHIELD = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
</svg>`;

const SVG_ALERT = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 9v4"/><path d="M12 17h.01"/>
  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
</svg>`;

// ── Hash-query helper ────────────────────────────────────────────────────────
function getStepOverride() {
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  if (qi === -1) return null;
  const params = new URLSearchParams(hash.slice(qi + 1));
  const step = params.get('step');
  return step && STEPS.has(step) ? step : null;
}

function getCurrentHashRoute() {
  const hash = window.location.hash || '#/welcome';
  const fullPath = hash.startsWith('#') ? hash.slice(1) : hash;
  return (fullPath.split('?')[0] || '/welcome');
}

function isWelcomeRouteActive() {
  return getCurrentHashRoute() === '/welcome';
}

// ── Step renderers ───────────────────────────────────────────────────────────
function welcomeStepHtml() {
  return `
    <div class="ob-state ob-state--welcome" data-ob-step="welcome">
      <div class="ob-brand-mark ob-brand-mark--hero">
        <div class="ob-brand-mark__logo">${SVG_LOGO}</div>
        <h1 class="ob-brand-mark__title">BazarDrive</h1>
        <p class="ob-brand-mark__tagline">Taxi marketplace</p>
      </div>
      <p class="ob-lead">Объявления, поездки и попутчики&nbsp;— без накруток.</p>
      <ul class="ob-value-strip" aria-label="Возможности приложения">
        <li class="ob-benefit-row">
          <span class="ob-benefit-row__icon" aria-hidden="true">${SVG_PIN}</span>
          <span class="ob-benefit-row__text">Поездки</span>
        </li>
        <li class="ob-benefit-row">
          <span class="ob-benefit-row__icon" aria-hidden="true">${SVG_CAR}</span>
          <span class="ob-benefit-row__text">Заказы</span>
        </li>
        <li class="ob-benefit-row">
          <span class="ob-benefit-row__icon" aria-hidden="true">${SVG_LIST}</span>
          <span class="ob-benefit-row__text">Объявления</span>
        </li>
      </ul>
      <div class="ob-actions">
        <button type="button" class="bd-btn primary ob-action ob-action--primary" id="ob-start" data-ob-action="start">Начать</button>
        <button type="button" class="bd-btn ghost ob-action ob-action--ghost" id="ob-login" data-ob-action="login">Войти</button>
      </div>
    </div>`;
}

function roleStepHtml(selectedRole) {
  const sel = (r) => selectedRole === r ? ' ob-role-card--selected' : '';
  const ariaSel = (r) => selectedRole === r ? 'true' : 'false';
  return `
    <div class="ob-state ob-state--role" data-ob-step="role">
      <div class="ob-brand-mark ob-brand-mark--compact">
        <div class="ob-brand-mark__logo">${SVG_LOGO}</div>
        <h2 class="ob-brand-mark__title ob-brand-mark__title--compact">Кто вы?</h2>
        <p class="ob-brand-mark__tagline">Это можно поменять позже в Профиле.</p>
      </div>
      <div class="ob-role-grid" role="radiogroup" aria-label="Выбор роли">
        <button type="button" class="ob-role-card${sel('passenger')}" id="ob-role-passenger" role="radio" aria-checked="${ariaSel('passenger')}" data-ob-role="passenger">
          <span class="ob-role-card__icon" aria-hidden="true">${SVG_PERSON}</span>
          <span class="ob-role-card__title">Пассажир</span>
          <span class="ob-role-card__desc">Ищу поездки и водителей рядом.</span>
        </button>
        <button type="button" class="ob-role-card${sel('driver')}" id="ob-role-driver" role="radio" aria-checked="${ariaSel('driver')}" data-ob-role="driver">
          <span class="ob-role-card__icon" aria-hidden="true">${SVG_STEERING}</span>
          <span class="ob-role-card__title">Водитель</span>
          <span class="ob-role-card__desc">Принимаю заказы и предлагаю поездки.</span>
        </button>
      </div>
      <div class="ob-actions">
        <button type="button" class="bd-btn primary ob-action ob-action--primary" id="ob-role-continue" data-ob-action="role-continue" ${selectedRole ? '' : 'disabled aria-disabled="true"'}>Продолжить</button>
      </div>
    </div>`;
}

function permissionsStepHtml() {
  return `
    <div class="ob-state ob-state--permissions" data-ob-step="permissions">
      <div class="ob-brand-mark ob-brand-mark--compact">
        <div class="ob-brand-mark__logo">${SVG_LOGO}</div>
        <h2 class="ob-brand-mark__title ob-brand-mark__title--compact">Разрешения</h2>
        <p class="ob-brand-mark__tagline">Чтобы подсказывать точнее.</p>
      </div>
      <ul class="ob-permission-list" aria-label="Запрашиваемые разрешения">
        <li class="ob-permission-row">
          <span class="ob-permission-row__icon" aria-hidden="true">${SVG_PIN}</span>
          <div class="ob-permission-row__body">
            <p class="ob-permission-row__title">Геолокация</p>
            <p class="ob-permission-row__desc">Подсказываем близкие поездки и водителей.</p>
          </div>
        </li>
        <li class="ob-permission-row">
          <span class="ob-permission-row__icon" aria-hidden="true">${SVG_BELL}</span>
          <div class="ob-permission-row__body">
            <p class="ob-permission-row__title">Уведомления</p>
            <p class="ob-permission-row__desc">Сообщения, отклики и подтверждения поездок.</p>
          </div>
        </li>
      </ul>
      <p class="ob-privacy-note">
        <span class="ob-privacy-note__icon" aria-hidden="true">${SVG_SHIELD}</span>
        <span>Данные используются только внутри приложения и нигде не публикуются.</span>
      </p>
      <div class="ob-actions">
        <button type="button" class="bd-btn primary ob-action ob-action--primary" id="ob-perm-continue" data-ob-action="perm-continue">Продолжить</button>
        <button type="button" class="bd-btn ghost ob-action ob-action--ghost" id="ob-perm-later" data-ob-action="perm-later">Разрешить позже</button>
      </div>
    </div>`;
}

function loadingStepHtml(role) {
  const message = role === 'driver'
    ? 'Готовим водительский режим…'
    : role === 'passenger'
      ? 'Подбираем поездки рядом…'
      : 'Запускаем приложение…';
  return `
    <div class="ob-state ob-state--loading" data-ob-step="loading" role="status" aria-live="polite">
      <div class="ob-loading-mark">
        <div class="ob-loading-mark__logo">${SVG_LOGO}</div>
        <div class="ob-loading-mark__spinner" aria-hidden="true">
          <span class="ob-loading-mark__spinner-dot"></span>
          <span class="ob-loading-mark__spinner-dot"></span>
          <span class="ob-loading-mark__spinner-dot"></span>
        </div>
      </div>
      <p class="ob-loading-message">${message}</p>
    </div>`;
}

function errorStepHtml() {
  return `
    <div class="ob-state ob-state--error" data-ob-step="error">
      <div class="ob-retry-state">
        <span class="ob-retry-state__icon" aria-hidden="true">${SVG_ALERT}</span>
        <p class="ob-retry-state__title">Не удалось завершить</p>
        <p class="ob-retry-state__desc">Проверьте подключение и попробуйте снова.</p>
      </div>
      <div class="ob-actions">
        <button type="button" class="bd-btn primary ob-action ob-action--primary" id="ob-retry" data-ob-action="retry">Повторить</button>
      </div>
    </div>`;
}

// ── Default export ───────────────────────────────────────────────────────────
export default function welcome() {
  const root = document.createElement('section');
  root.className = 'screen screen--welcome screen--ob';

  // BD-ONBOARDING-01 — Returning users skip the gate. The router's
  // `welcomeSeen` guard already redirects fresh users TO /welcome; this
  // catches the reverse case (a returning user who manually types
  // /welcome) and routes them straight to their feed. Driver mode
  // lands on /driver-map; everything else (passenger / guest) on /feed.
  const u = user.get();
  const stepOverride = getStepOverride();
  if (u.onboarded && !stepOverride) {
    // Deferred go() so the router's current render() pass completes
    // cleanly before the next hashchange fires.
    Promise.resolve().then(() => {
      go(u.role === 'driver' ? '/driver-map' : '/feed');
    });
    return root;
  }

  let step = stepOverride || 'welcome';
  let selectedRole = null;
  let loadingTimer = null;
  let loadingRunId = 0;

  function rerender() {
    root.innerHTML = htmlForStep();
    bindStep();
  }

  function htmlForStep() {
    switch (step) {
      case 'role':        return roleStepHtml(selectedRole);
      case 'permissions': return permissionsStepHtml();
      case 'loading':     return loadingStepHtml(selectedRole);
      case 'error':       return errorStepHtml();
      case 'welcome':
      default:            return welcomeStepHtml();
    }
  }

  function goStep(next) {
    step = next;
    rerender();
  }

  function startLoading() {
    const runId = ++loadingRunId;
    goStep('loading');
    // UI-only transition. No backend call.
    if (loadingTimer) clearTimeout(loadingTimer);
    loadingTimer = setTimeout(() => {
      // BD-ONBOARDING-02 — Stale timer guard. If the user leaves /welcome
      // before the UI-only timer fires, the old callback must not persist
      // state, consume a pending router action, or override the new route.
      if (runId !== loadingRunId || !isWelcomeRouteActive()) return;

      // Persist role + welcomeSeen.
      user.set({ welcomeSeen: true, role: selectedRole || 'passenger' });
      // BD-ONBOARDING-01 Codex P2 #1 — honour any pending router action
      // that was set by `requireOnboarding(after)` (or similar callers
      // upstream). When a pending action exists, run it INSTEAD of the
      // default role routing so the user returns to whatever they were
      // doing before the gate took over (e.g. tapping Create on the
      // feed before being bounced through welcome). When no pending
      // action exists, fall back to the documented role routing
      // (passenger → /feed, driver → /driver-map).
      const pending = consumePendingAction();
      if (typeof pending === 'function') {
        pending();
        return;
      }
      go(selectedRole === 'driver' ? '/driver-map' : '/feed');
    }, 1200);
  }

  function bindStep() {
    if (step === 'welcome') {
      root.querySelector('#ob-start')?.addEventListener('click', () => {
        goStep('role');
      });
      root.querySelector('#ob-login')?.addEventListener('click', () => {
        // 05K — `Войти` keeps welcomeSeen so the user can come back to
        // the gate via /welcome but is routed into the existing
        // /onboarding screen for phone/name entry (the existing auth
        // placeholder lives there).
        user.set({ welcomeSeen: true });
        go('/onboarding');
      });
    } else if (step === 'role') {
      for (const card of root.querySelectorAll('[data-ob-role]')) {
        card.addEventListener('click', () => {
          selectedRole = card.dataset.obRole;
          rerender();
        });
      }
      root.querySelector('#ob-role-continue')?.addEventListener('click', () => {
        if (!selectedRole) return;
        goStep('permissions');
      });
    } else if (step === 'permissions') {
      root.querySelector('#ob-perm-continue')?.addEventListener('click', () => {
        // BD-ONBOARDING-01 — Permissions are UI-only preferences in
        // this slice (no real geolocation API call, no real
        // notification API request). The two actions diverge here at
        // the user-record level: Продолжить stamps the optional
        // preference on; Разрешить позже stamps it OFF (Codex P2 #2 —
        // the default user state has `notificationsEnabled: true`, so
        // a silent advance would leave the user record reading as
        // "enabled" even though the driver explicitly deferred).
        user.set({ notificationsEnabled: true });
        startLoading();
      });
      root.querySelector('#ob-perm-later')?.addEventListener('click', () => {
        // Codex P2 #2 — explicitly stamp `notificationsEnabled: false`
        // so the "deferred" choice is reflected in the persisted user
        // record. The driver can re-enable later from /profile.
        user.set({ notificationsEnabled: false });
        startLoading();
      });
    } else if (step === 'loading') {
      // No bindings — the timer drives the transition.
    } else if (step === 'error') {
      root.querySelector('#ob-retry')?.addEventListener('click', () => {
        startLoading();
      });
    }
  }

  rerender();
  return root;
}
