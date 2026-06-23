// BD-OPS / #732 — shared overlay accessibility helper for modal sheets.
//
// Several `role="dialog" aria-modal="true"` overlays shipped WITHOUT the focus management
// that the aria-modal contract promises: focus leaked to the dimmed background, Tab walked
// out of the sheet, and focus was never restored to the trigger on close. This helper is the
// single reference implementation (the #732 top recommendation): it captures the
// previously-focused element, moves focus into the overlay, traps Tab / Shift+Tab within the
// overlay's *visible* focusable controls, and restores focus on release.
//
// Escape is OPTIONAL (`opts.onEscape`): several sheets own step-back-then-close Escape
// semantics (e.g. the passenger safety / cancel sheets), so the helper only owns Escape when
// the caller asks it to. Pure DOM — no app state, no storage, no network.
//
//   const release = trapFocus(overlayEl, { initialFocus, onEscape });
//   // …later, in the sheet's close():
//   release();   // removes the trap + restores focus to the trigger (idempotent)

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

// LIFO stack of currently-active traps. Only the TOP (most recently installed) trap handles
// Tab/Escape, so a modal stacked over another (e.g. the global error sheet shown over a screen
// sheet) owns the keyboard and the covered sheet defers — even though the covered sheet's
// document-capture listener was registered first and fires earlier (#739).
const activeTraps = [];

export function trapFocus(overlayEl, opts = {}) {
  if (!overlayEl) return () => {};
  const doc = overlayEl.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) return () => {};
  const previouslyFocused = doc.activeElement;
  const token = {};

  // Only VISIBLE focusable controls — hidden sub-views (display:none → no offsetParent) are
  // excluded so the Tab cycle never lands on an off-screen control.
  const focusables = () => Array.from(overlayEl.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter((el) => el.offsetParent !== null || el === doc.activeElement);

  function onKeydown(ev) {
    // If the overlay was torn down without close() (a route change replaceChildren()s #app),
    // self-release and let the key pass through — never intercept Tab on the next screen (#734).
    if (overlayEl.isConnected === false) { release(); return; }
    // Only the topmost trap acts; a covered sheet defers to the modal stacked over it (#739).
    if (activeTraps[activeTraps.length - 1] !== token) return;
    // When this trap HANDLES a key, consume it so a modal stacked over another (e.g. the global
    // error sheet over a screen sheet) doesn't let the SAME key also reach the one underneath (#738).
    const stop = () => { if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation(); };
    if (ev.key === 'Escape' && typeof opts.onEscape === 'function') {
      stop();
      opts.onEscape(ev);
      return;
    }
    if (ev.key !== 'Tab') return;
    const els = focusables();
    if (!els.length) {
      ev.preventDefault();
      stop();
      if (typeof overlayEl.focus === 'function') overlayEl.focus();
      return;
    }
    const first = els[0];
    const last = els[els.length - 1];
    // idx === -1 when focus is OUTSIDE the overlay OR on an in-overlay element that is not a
    // tabbable cycle member (e.g. a tabindex="-1" dialog panel used as the initial focus, #745) —
    // both must wrap back into the cycle rather than let Tab escape to the background.
    const idx = els.indexOf(doc.activeElement);
    if (ev.shiftKey) {
      if (idx <= 0) { ev.preventDefault(); stop(); last.focus(); }
    } else if (idx === -1 || idx === els.length - 1) {
      ev.preventDefault();
      stop();
      first.focus();
    }
  }

  let released = false;
  let observer = null;
  function release() {
    if (released) return;
    released = true;
    const i = activeTraps.indexOf(token);
    if (i >= 0) activeTraps.splice(i, 1);
    if (observer) { observer.disconnect(); observer = null; }
    doc.removeEventListener('keydown', onKeydown, true);
    // Restore focus only if the trigger is still in the document (it usually is; on a
    // navigate-away teardown it isn't, and the restore is moot because the screen re-rendered).
    if (previouslyFocused
      && typeof previouslyFocused.focus === 'function'
      && (!doc.contains || doc.contains(previouslyFocused))) {
      previouslyFocused.focus();
    }
  }

  activeTraps.push(token);
  doc.addEventListener('keydown', onKeydown, true);

  // Initial focus: an explicit target, else the first visible focusable, else the overlay.
  const target = (typeof opts.initialFocus === 'string'
    ? overlayEl.querySelector(opts.initialFocus)
    : opts.initialFocus) || focusables()[0] || null;
  if (target && typeof target.focus === 'function') target.focus();

  // #734 — auto-release if the overlay is torn down WITHOUT close() (e.g. a route change that
  // replaceChildren()s #app while the sheet is open), so the document-level keydown trap never
  // leaks onto the next screen. The onKeydown isConnected guard is the keydown-time fallback.
  const observeRoot = doc.body || doc.documentElement || null;
  if (typeof MutationObserver !== 'undefined' && observeRoot) {
    observer = new MutationObserver(() => { if (!overlayEl.isConnected) release(); });
    observer.observe(observeRoot, { childList: true, subtree: true });
  }

  return release;
}
