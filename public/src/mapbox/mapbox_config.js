// public/src/mapbox/mapbox_config.js — BD-MAP-FOUND-01 (#805, real Mapbox foundation).
//
// The single on/off switch + token surface for the (vendored) Mapbox SDK. DARK by default:
// getMapboxToken() returns null, so isMapboxEnabled()/hasMapboxToken() are false and every map
// surface keeps rendering the placeholder MapShell — exactly mirroring api_config.getApiBase()===''
// ⇒ mock. Nothing real loads until a token is configured; this module adds zero behavior when dark.
//
// Turning Mapbox ON later is deliberate (the per-surface render slices + a real token):
//   - a COMMITTED, CSP-safe token source must be set — NOT an inline <script> global
//     (index.html `script-src 'self'` forbids inline injection); use a URL-restricted PUBLIC token;
//   - the CSP already permits api.mapbox.com / events.mapbox.com (+ worker-src blob:) — added inert
//     by BD-MAP-FOUND-01 so activation needs no further CSP change.
//
// NO Web-Storage access here (keeps the BD-DATA-STATIC-01 gate clean) — pure config, read at call time.
//
// Contract (preserved from the BD-MAP-FOUND-STUB-01 stub):
//   getMapboxToken()  → string | null   (null = no token configured = DARK)
//   hasMapboxToken()  → boolean
//   getDefaultCenter() → { lng, lat, zoom }   (Moscow)

const DEFAULT_CENTER = Object.freeze({ lng: 37.6173, lat: 55.7558, zoom: 12 }); // Moscow

// Default map style used once a token activates real rendering (a custom Cloud-Design style is a
// later refinement). Exposed so the per-surface render slices share one source of truth.
export const MAPBOX_STYLE = 'mapbox://styles/mapbox/streets-v12';

// Two COMMITTED, CSP-safe token sources (no inline <script>), in precedence order:
//   1. globalThis.__BD_MAPBOX_TOKEN__  — set by a test / a future build step / a local dev override;
//   2. <meta name="bd-mapbox-token" content="…">  — a committed config tag read from an external
//      module (allowed under script-src 'self'). Absent / empty in production = DARK.
function readMetaToken() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return '';
  const el = document.querySelector('meta[name="bd-mapbox-token"]');
  return el && typeof el.content === 'string' ? el.content : '';
}
// The committed <meta> token is the PROD token, URL-restricted to the GitHub Pages host. Honor it ONLY
// on that origin (Codex #813): a local serve / non-Pages preview would otherwise read a token Mapbox
// rejects off-domain (403) and show a broken map instead of the dark placeholder. The __BD_MAPBOX_TOKEN__
// override is honored on ANY origin, so local/dev work sets that instead.
const PAGES_TOKEN_HOST = 'iprus2026-tech.github.io';
function isCommittedTokenOriginAllowed() {
  return typeof location !== 'undefined' && location.hostname === PAGES_TOKEN_HOST;
}
function readToken() {
  if (typeof globalThis !== 'undefined'
    && typeof globalThis.__BD_MAPBOX_TOKEN__ === 'string'
    && globalThis.__BD_MAPBOX_TOKEN__) {
    return globalThis.__BD_MAPBOX_TOKEN__;                          // local/dev override — any origin
  }
  return isCommittedTokenOriginAllowed() ? readMetaToken() : '';    // committed token only on its Pages origin
}

// The Mapbox access token (trimmed), or null when none is configured (DARK).
export function getMapboxToken() {
  const t = readToken().trim();
  return t === '' ? null : t;
}

// True only when a non-empty token is configured.
export function hasMapboxToken() {
  return getMapboxToken() !== null;
}

// Gate name the map surfaces will use (mirrors api_config.isBackendEnabled()).
export function isMapboxEnabled() {
  return hasMapboxToken();
}

export function getDefaultCenter() {
  return { ...DEFAULT_CENTER };
}
