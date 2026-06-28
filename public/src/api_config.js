// public/src/api_config.js — BD-API-CLIENT-01 / R12 of #784 (cross-device cutover).
//
// The single on/off switch + addressing for the future in-repo backend (/server, ADR
// BD-DOCS-041). DARK by default: getApiBase() returns '' (OFF), so isBackendEnabled() is
// false and the app keeps running entirely on mock + localStorage. Nothing imports this
// module yet — it adds zero behavior until the cutover PRs wire it behind the async seam.
//
// Turning the backend ON later is a deliberate, separate sequence (epic #784):
//   - a COMMITTED config value / build-time env must set the API base — NOT an inline
//     <script> global (index.html CSP `script-src 'self'` forbids inline injection);
//   - the CSP `connect-src` relax PR (R14) must allow that exact https origin;
//   - the server must set a matching exact-origin CORS ALLOWED_ORIGIN.
//
// NO Web-Storage access here (keeps the BD-DATA-STATIC-01 gate clean); the real
// session-token source lands with the auth-token cutover (R17) — getSessionToken() is
// null until then.

// Optional runtime override a build step / devtools may set. Absent in production today
// (CSP forbids inline injection), so the base stays '' (OFF). Read at CALL time so a test
// or a future build can flip it without re-importing.
function readOverride() {
  return (typeof globalThis !== 'undefined' && typeof globalThis.__BD_API_BASE__ === 'string')
    ? globalThis.__BD_API_BASE__
    : '';
}

// The API origin (scheme + host[:port]), trailing slash trimmed. '' means the backend is OFF.
export function getApiBase() {
  return readOverride().replace(/\/+$/, '');
}

// True only when a non-empty API base is configured.
export function isBackendEnabled() {
  return getApiBase() !== '';
}

// Mirrors the server mount prefix (server/src/server.js registers each service at
// `/api/v1/<name>`).
export const API_VERSION_PREFIX = '/api/v1';

// DARK token source — no localStorage / sessionStorage read (no Web-Storage key exists
// yet; it arrives with R17). Returns null so apiFetch attaches no Authorization header
// today.
export function getSessionToken() {
  return null;
}
