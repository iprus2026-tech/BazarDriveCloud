// BD-ERROR-01A — Global Error / Offline runtime overlay.
//
// App-shell singleton overlay rendered above any screen. It is NOT a route
// and NOT a screen: it mounts once into #shell (above #app) and is driven
// imperatively from anywhere via window.BD.GlobalError.
//
// Non-mutating contract: this module is transport-presentation only. It does
// NOT import the ride/order/mock/map runtime modules, does NOT mutate order or
// ride status, does NOT write to browser storage, does NOT call any backend or
// map SDK, and does NOT perform a real network retry. options.onRetry is a
// caller-supplied demo callback only. The only state it owns is DOM state
// inside its own singleton element.

const OVERLAY_ID = 'bd-error-overlay';

// State whitelist. An unknown state is a safe no-op (never renders random UI).
const STATES = ['offline', 'server_error', 'timeout', 'retrying', 'recovered'];

// recovered auto-dismiss delay (ms). Cleared on hide() and on any new show().
const RECOVERED_DISMISS_MS = 3000;

let recoveredTimer = null;
let currentOptions = {};

function shellHost() {
  return document.getElementById('shell') || document.body;
}

function clearRecoveredTimer() {
  if (recoveredTimer !== null) {
    clearTimeout(recoveredTimer);
    recoveredTimer = null;
  }
}

function exposeWindowApi() {
  const w = window;
  w.BD = w.BD || {};
  w.BD.GlobalError = {
    show: (state, options) => showGlobalErrorOverlay(state, options),
    hide: () => hideGlobalErrorOverlay(),
  };
}

// Singleton mount. Calling this repeatedly never duplicates the DOM node —
// an existing overlay element is reused. Also exposes the window API and wires
// a single delegated click handler that survives innerHTML swaps.
export function initGlobalErrorOverlay(root) {
  const host = root || shellHost();
  let el = document.getElementById(OVERLAY_ID);
  if (el) {
    exposeWindowApi();
    return el;
  }
  el = document.createElement('div');
  el.id = OVERLAY_ID;
  el.className = 'bd-error-overlay';
  el.hidden = true;
  el.addEventListener('click', onOverlayClick);
  host.appendChild(el);
  exposeWindowApi();
  return el;
}

function getOverlay() {
  return document.getElementById(OVERLAY_ID) || initGlobalErrorOverlay();
}

function onOverlayClick(e) {
  const dismiss = e.target.closest('[data-bd-error-dismiss]');
  if (dismiss) {
    hideGlobalErrorOverlay();
    return;
  }
  const actionEl = e.target.closest('[data-bd-error-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.bdErrorAction;
  if (action === 'retry') {
    // Demo callback only — no real network retry happens here. The caller
    // decides what to do next (e.g. show('retrying')); if it provides no
    // callback we simply dismiss.
    if (typeof currentOptions.onRetry === 'function') {
      currentOptions.onRetry();
    } else {
      hideGlobalErrorOverlay();
    }
    return;
  }
  // secondary actions (support / later) just dismiss the overlay
  hideGlobalErrorOverlay();
}

const RETRY_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';

function bannerMarkup(stateClass, title, hint, leadHtml) {
  return (
    '<div class="bd-error-banner ' + stateClass + '" role="status" aria-live="polite">' +
      leadHtml +
      '<div class="bd-error-banner__text">' +
        '<span class="bd-error-banner__title">' + title + '</span>' +
        '<span class="bd-error-banner__hint">' + hint + '</span>' +
      '</div>' +
    '</div>'
  );
}

function sheetMarkup(stateClass, iconHtml, title, body, code, secondaryLabel) {
  return (
    '<div class="bd-error-scrim" data-bd-error-dismiss></div>' +
    '<div class="bd-error-sheet ' + stateClass + '" role="alertdialog" aria-modal="true" aria-labelledby="bd-error-sheet-title">' +
      '<div class="bd-error-sheet__grip" aria-hidden="true"></div>' +
      '<div class="bd-error-sheet__icon" aria-hidden="true">' + iconHtml + '</div>' +
      '<h2 class="bd-error-sheet__title" id="bd-error-sheet-title">' + title + '</h2>' +
      '<p class="bd-error-sheet__body">' + body + '</p>' +
      '<span class="bd-error-sheet__code">' + code + '</span>' +
      '<div class="bd-error-sheet__actions">' +
        '<button class="bd-error-sheet__btn primary" type="button" data-bd-error-action="retry">' + RETRY_ICON + 'Повторить</button>' +
        '<button class="bd-error-sheet__btn ghost" type="button" data-bd-error-action="secondary">' + secondaryLabel + '</button>' +
      '</div>' +
    '</div>'
  );
}

function markupFor(state) {
  if (state === 'offline') {
    return bannerMarkup(
      'offline',
      'Нет соединения',
      'Проверьте интернет — данные обновятся автоматически',
      '<span class="bd-error-banner__dot" aria-hidden="true"></span>'
    );
  }
  if (state === 'retrying') {
    return bannerMarkup(
      'retrying',
      'Переподключение…',
      'Восстанавливаем соединение',
      '<span class="bd-error-banner__spinner" aria-hidden="true"></span>'
    );
  }
  if (state === 'server_error') {
    return sheetMarkup(
      'server_error',
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      'Что-то пошло не так',
      'Не удалось загрузить данные. Попробуйте снова или напишите в поддержку.',
      'SERVER · 500',
      'Поддержка'
    );
  }
  if (state === 'timeout') {
    return sheetMarkup(
      'timeout',
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
      'Превышено время ожидания',
      'Сервер слишком долго не отвечает. Проверьте соединение и попробуйте снова.',
      'TIMEOUT · 504',
      'Позже'
    );
  }
  // recovered
  return (
    '<div class="bd-error-toast recovered" role="status" aria-live="polite">' +
      '<span class="bd-error-toast__ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/></svg></span>' +
      '<span class="bd-error-toast__text">Соединение восстановлено</span>' +
    '</div>'
  );
}

// Show a whitelisted state. Showing over an already-visible overlay replaces
// the state. Always clears any pending recovered auto-dismiss first.
export function showGlobalErrorOverlay(state, options = {}) {
  clearRecoveredTimer();
  if (!STATES.includes(state)) {
    // Unknown state: safe no-op. Never render arbitrary UI — leave the
    // overlay hidden/empty rather than guessing.
    hideGlobalErrorOverlay();
    return null;
  }
  currentOptions = options || {};
  const el = getOverlay();
  el.className = 'bd-error-overlay is-visible ' + state;
  el.dataset.bdErrorState = state;
  el.innerHTML = markupFor(state);
  el.hidden = false;
  if (state === 'recovered') {
    recoveredTimer = setTimeout(() => {
      hideGlobalErrorOverlay();
    }, RECOVERED_DISMISS_MS);
  }
  return el;
}

// Hide is always safe, even if the overlay was never shown. Clears the
// recovered timer and resets DOM state.
export function hideGlobalErrorOverlay() {
  clearRecoveredTimer();
  currentOptions = {};
  const el = document.getElementById(OVERLAY_ID);
  if (!el) return;
  el.hidden = true;
  el.className = 'bd-error-overlay';
  el.innerHTML = '';
  delete el.dataset.bdErrorState;
}
