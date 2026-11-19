// public/src/theme.js — BD-THEME-01. The device-level colour theme.
//
// The preference is 'dark' (default, the shipped Cloud Design look), 'light' or 'system'
// (follows the OS). It is stored in localStorage under bazardrive.theme.v1 — a device
// preference, identity agnostic, so it survives logout (documented in storage_boundary.js).
//
// applyTheme() writes the RESOLVED theme to <html data-theme="dark|light">; cloud.css keys
// the light palette off :root[data-theme="light"]. Dark stays the unconditional base, so a
// missing/blocked storage or an unknown value simply renders the shipped dark theme.
const THEME_KEY = 'bazardrive.theme.v1';
const PREFS = ['dark', 'light', 'system'];
const DEFAULT_PREF = 'dark';

let mediaQuery = null;
let mediaBound = false;

export function getThemePref() {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return PREFS.includes(raw) ? raw : DEFAULT_PREF;
  } catch (_) {
    return DEFAULT_PREF;
  }
}

function systemPrefersLight() {
  try {
    if (!mediaQuery && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    }
    return !!mediaQuery && mediaQuery.matches === true;
  } catch (_) {
    return false;
  }
}

// The theme that is actually painted: 'dark' or 'light'.
export function resolveTheme(pref = getThemePref()) {
  if (pref === 'light') return 'light';
  if (pref === 'system') return systemPrefersLight() ? 'light' : 'dark';
  return 'dark';
}

export function applyTheme() {
  if (typeof document === 'undefined') return DEFAULT_PREF;
  const resolved = resolveTheme();
  document.documentElement.dataset.theme = resolved;
  // Follow the OS while the preference is 'system' (bound once; a no-op otherwise).
  if (!mediaBound && mediaQuery && typeof mediaQuery.addEventListener === 'function') {
    mediaBound = true;
    mediaQuery.addEventListener('change', () => { if (getThemePref() === 'system') applyTheme(); });
  }
  return resolved;
}

// Persists the preference and repaints. Returns the stored preference; an unknown value is
// ignored. A storage failure still repaints for this session only when the write succeeded,
// so the control never shows a theme that will not survive a reload.
export function setThemePref(pref) {
  if (!PREFS.includes(pref)) return getThemePref();
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch (_) {
    return getThemePref();
  }
  applyTheme();
  return pref;
}
