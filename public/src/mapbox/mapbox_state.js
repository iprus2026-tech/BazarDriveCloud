// BD-MAP-FOUND-STUB-01 — Mapbox/MapHome local state stub.
// Persists `bazardrive.map_prefs.v1` and exposes the canonical
// MapHome render-gate states. No network, no Mapbox SDK.

const PREFS_KEY = 'bazardrive.map_prefs.v1';

export const MAP_STATE = Object.freeze({
  DEFAULT:        'default',
  PERMISSION:     'permission',
  DENIED:         'denied',
  NEARBY:         'nearby',
  TOKEN_MISSING:  'token_missing',
});

const DEFAULT_PREFS = Object.freeze({
  locationAllowed: false,
  lastCenter: null,
  zoom: 12,
});

export function loadMapPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PREFS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveMapPrefs(patch) {
  const next = { ...loadMapPrefs(), ...(patch && typeof patch === 'object' ? patch : {}) };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* soft fail */ }
  return next;
}

export function isValidMapState(value) {
  return typeof value === 'string' && Object.values(MAP_STATE).includes(value);
}
