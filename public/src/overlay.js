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

export function trapFocus(overlayEl, opts = {}) {
  if (!overlayEl) return () => {};
  const doc = overlayEl.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) return () => {};
  const previouslyFocused = doc.activeElement;

  // Only VISIBLE focusable controls — hidden sub-views (display:none → no offsetParent) are
  // excluded so the Tab cycle never lands on an off-screen control.
  const focusables = () => Array.from(overlayEl.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter((el) => el.offsetParent !== null || el === doc.activeElement);

  function onKeydown(ev) {
    if (ev.key === 'Escape' && typeof opts.onEscape === 'function') {
      opts.onEscape(ev);
      return;
    }
    if (ev.key !== 'Tab') return;
    const els = focusables();
    if (!els.length) {
      ev.preventDefault();
      if (typeof overlayEl.focus === 'function') overlayEl.focus();
      return;
    }
    const first = els[0];
    const last = els[els.length - 1];
    const active = doc.activeElement;
    const inside = overlayEl.contains(active);
    if (ev.shiftKey) {
      if (!inside || active === first) { ev.preventDefault(); last.focus(); }
    } else if (!inside || active === last) {
      ev.preventDefault();
      first.focus();
    }
  }

  doc.addEventListener('keydown', onKeydown, true);

  // Initial focus: an explicit target, else the first visible focusable, else the overlay.
  const target = (typeof opts.initialFocus === 'string'
    ? overlayEl.querySelector(opts.initialFocus)
    : opts.initialFocus) || focusables()[0] || null;
  if (target && typeof target.focus === 'function') target.focus();

  let released = false;
  return function release() {
    if (released) return;
    released = true;
    doc.removeEventListener('keydown', onKeydown, true);
    // Restore focus only if the trigger is still in the document (it usually is; on a
    // navigate-away teardown it isn't, and the restore is moot because the screen re-rendered).
    if (previouslyFocused
      && typeof previouslyFocused.focus === 'function'
      && (!doc.contains || doc.contains(previouslyFocused))) {
      previouslyFocused.focus();
    }
  };
}
