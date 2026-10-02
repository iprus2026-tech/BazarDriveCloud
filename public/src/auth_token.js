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
// Fail closed in this tab when storage cannot replace/remove an old credential.
let blocked = false;
// Module-local tab ownership. A different tab may replace the origin-wide
// localStorage record, but this tab must never attach that other actor's bearer.
let tabUserId = null;

function load() {
  if (blocked) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch {
    return {};
  }
}

function loadForTab() {
  const record = load();
  if (tabUserId && record.userId !== tabUserId) return {};
  return record;
}

// The bearer token, or null when no session (the OFF / logged-out default).
// If another tab replaced the shared record, return null rather than sending
// the replacement actor's credential from stale UI.
export function getAuthToken() {
  const t = loadForTab().token;
  return typeof t === 'string' && t ? t : null;
}

// The authenticated user's server id, or null.
export function getAuthUserId() {
  const id = loadForTab().userId;
  return typeof id === 'string' && id ? id : null;
}

export function pinAuthTabUser(userId) {
  if (typeof userId !== 'string' || !userId.trim()) return false;
  tabUserId = userId;
  return true;
}

// Persist the minted session (called by the onboarding otp-verify success path).
export function setAuth({ token, userId, phone } = {}) {
  blocked = true;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      token: token || null,
      userId: userId || null,
      phone: phone || null,
    }));
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!token || !userId || saved?.token !== token || saved?.userId !== userId
        || saved?.phone !== (phone || null)) return false;
    blocked = false;
    tabUserId = userId;
    return true;
  } catch {
    return false;
  }
}

// Drop the session (logout boundary).
export function clearAuth() {
  blocked = true;
  try {
    localStorage.removeItem(STORAGE_KEY);
    blocked = localStorage.getItem(STORAGE_KEY) !== null;
    if (!blocked) tabUserId = null;
    return !blocked;
  } catch {
    return false;
  }
}
