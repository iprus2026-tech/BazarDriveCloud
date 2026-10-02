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
export const AUTH_CLEAR_FOREIGN = 'foreign';
// Fail closed in this tab when storage cannot replace/remove an old credential.
let blocked = false;
// Module-local tab ownership. A different tab may replace the origin-wide
// localStorage record, but this tab must never attach that other actor's bearer.
let tabUserId = null;
// A detached tab must not auto-adopt a later origin-wide credential.
let tabDetachMode = null;

function loadRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch {
    return {};
  }
}

function load() {
  if (blocked || tabDetachMode) return {};
  return loadRaw();
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
  if (userId === null) {
    // This tab explicitly booted anonymous. A credential that appears later
    // belongs to another tab until this tab performs its own setAuth().
    tabUserId = null;
    tabDetachMode = 'anonymous';
    blocked = false;
    return true;
  }
  if (typeof userId !== 'string' || !userId.trim()) return false;
  tabUserId = userId;
  tabDetachMode = null;
  blocked = false;
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
    tabDetachMode = null;
    return true;
  } catch {
    return false;
  }
}

// Drop only the credential owned by this tab. If another tab has already
// replaced the origin-wide record, detach locally but preserve that replacement.
export function clearAuth() {
  blocked = true;
  try {
    const raw = loadRaw();
    const rawUserId = typeof raw.userId === 'string' && raw.userId ? raw.userId : null;

    if (tabDetachMode === AUTH_CLEAR_FOREIGN) {
      blocked = false;
      return AUTH_CLEAR_FOREIGN;
    }
    if (tabDetachMode === 'anonymous') {
      if (rawUserId) {
        tabDetachMode = AUTH_CLEAR_FOREIGN;
        blocked = false;
        return AUTH_CLEAR_FOREIGN;
      }
      blocked = false;
      return true;
    }
    if (tabDetachMode === 'own-cleared') {
      if (rawUserId) {
        tabDetachMode = AUTH_CLEAR_FOREIGN;
        blocked = false;
        return AUTH_CLEAR_FOREIGN;
      }
      blocked = false;
      return true;
    }
    if (tabUserId && rawUserId && rawUserId !== tabUserId) {
      tabUserId = null;
      tabDetachMode = AUTH_CLEAR_FOREIGN;
      blocked = false;
      return AUTH_CLEAR_FOREIGN;
    }

    localStorage.removeItem(STORAGE_KEY);
    blocked = localStorage.getItem(STORAGE_KEY) !== null;
    if (blocked) return false;
    tabUserId = null;
    tabDetachMode = 'own-cleared';
    return true;
  } catch {
    return false;
  }
}
