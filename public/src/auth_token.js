// public/src/auth_token.js — R17 / CUT-2 of #784 (frontend auth-token cutover).
//
// Owns the bearer-token store behind `bazardrive.auth.v1` ({ token, userId, phone }). This is the
// single source for api_config.getSessionToken(), so apiFetch attaches `Authorization: Bearer …`
// once a real session exists. The token is minted by the onboarding phone→otp flow against the live
// POST /auth/otp/verify (BD-DOCS-032 / R02).
//
// USER-SCOPED: it is THIS device's logged-in identity, so it is cleared on logout —
// storage_boundary.clearUserScopedStorage() calls clearAuth() (and the BD-DATA-STATIC-01 gate
// behaviourally asserts that). Bare `localStorage` access with the literal key keeps the gate able to
// resolve it.
const STORAGE_KEY = 'bazardrive.auth.v1';

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch {
    return {};
  }
}

// The bearer token, or null when no session (the OFF / logged-out default).
export function getAuthToken() {
  const t = load().token;
  return typeof t === 'string' && t ? t : null;
}

// The authenticated user's server id, or null.
export function getAuthUserId() {
  const id = load().userId;
  return typeof id === 'string' && id ? id : null;
}

// Persist the minted session (called by the onboarding otp-verify success path).
export function setAuth({ token, userId, phone } = {}) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      token: token || null,
      userId: userId || null,
      phone: phone || null,
    }));
  } catch {
    // storage full / unavailable — the token is simply not persisted (next call falls back to OFF).
  }
}

// Drop the session (logout boundary).
export function clearAuth() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
