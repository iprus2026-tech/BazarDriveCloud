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
export const AUTH_STORAGE_KEY = 'bazardrive.auth.v1';
const STORAGE_KEY = 'bazardrive.auth.v1';
export const AUTH_CLEAR_FOREIGN = 'foreign';
const REJECTED_PROJECTION_KEY = 'bazardrive.auth.rejected_projection.v1';
let rejectedDetached = false;
try {
  if (typeof sessionStorage !== 'undefined') {
    rejectedDetached = sessionStorage.getItem(REJECTED_PROJECTION_KEY) !== null;
  }
} catch {
  // An unreadable tab marker cannot authorize adopting shared credentials.
  rejectedDetached = true;
}
// Fail closed in this tab when storage cannot replace/remove an old credential.
let blocked = false;
// Module-local tab ownership. A different tab may replace the origin-wide
// localStorage record, but this tab must never attach that other actor's bearer.
let tabUserId = null;
// A detached tab must not auto-adopt a later origin-wide credential.
let tabDetachMode = null;
// A completed write belongs to this tab even if its readback fails before the
// new actor can be pinned. Keep that cleanup ownership until verified removal.
let pendingWrite = null;

function loadRaw() {
  const raw = localStorage.getItem(STORAGE_KEY);
  // A readable but malformed record may be cleared. A failed storage read
  // must propagate so cleanup cannot mistake an unread bearer for absence.
  try { return raw ? (JSON.parse(raw) || {}) : {}; } catch { return {}; }
}

function load() {
  if (rejectedDetached || blocked || tabDetachMode) return {};
  try { return loadRaw(); } catch { return {}; }
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
  if (rejectedDetached) return false;
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

export function isAuthTabRejected() {
  return rejectedDetached;
}

// Rejection is tab-local: Web Storage has no atomic shared compare-and-delete.
// Block getters before persisting; a failed write remains blocked and retryable.
export function detachRejectedAuth() {
  rejectedDetached = true;
  blocked = true;
  tabUserId = null;
  tabDetachMode = 'rejected';
  try {
    sessionStorage.setItem(REJECTED_PROJECTION_KEY, '1');
    if (sessionStorage.getItem(REJECTED_PROJECTION_KEY) !== '1') return false;
    blocked = false;
    return true;
  } catch {
    return false;
  }
}

// Persist the minted session (called by the onboarding otp-verify success path).
export function setAuth({ token, userId, phone } = {}) {
  blocked = true;
  try {
    const next = {
      token: token || null,
      userId: userId || null,
      phone: phone || null,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    pendingWrite = next;
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!token || !userId || saved?.token !== token || saved?.userId !== userId
        || saved?.phone !== (phone || null)) return false;
    if (rejectedDetached) {
      sessionStorage.removeItem(REJECTED_PROJECTION_KEY);
      if (sessionStorage.getItem(REJECTED_PROJECTION_KEY) !== null) return false;
    }
    rejectedDetached = false;
    blocked = false;
    tabUserId = userId;
    tabDetachMode = null;
    pendingWrite = null;
    return true;
  } catch {
    if (rejectedDetached) {
      try { sessionStorage.setItem(REJECTED_PROJECTION_KEY, '1'); } catch {}
    }
    return false;
  }
}

// Drop only the credential owned by this tab. If another tab has already
// replaced the origin-wide record, detach locally but preserve that replacement.
export function clearAuth() {
  blocked = true;
  if (rejectedDetached) return AUTH_CLEAR_FOREIGN;
  try {
    const raw = loadRaw();
    const rawUserId = typeof raw.userId === 'string' && raw.userId ? raw.userId : null;

    if (pendingWrite && (raw.token || rawUserId)
        && (raw.token !== pendingWrite.token || rawUserId !== pendingWrite.userId)) {
      // Another tab replaced the failed write. Never remove its credential.
      pendingWrite = null;
      tabUserId = null;
      tabDetachMode = AUTH_CLEAR_FOREIGN;
      blocked = false;
      return AUTH_CLEAR_FOREIGN;
    }
    if (!pendingWrite && tabDetachMode === AUTH_CLEAR_FOREIGN) {
      blocked = false;
      return AUTH_CLEAR_FOREIGN;
    }
    if (!pendingWrite && tabDetachMode === 'anonymous') {
      if (rawUserId) {
        tabDetachMode = AUTH_CLEAR_FOREIGN;
        blocked = false;
        return AUTH_CLEAR_FOREIGN;
      }
      blocked = false;
      return true;
    }
    if (!pendingWrite && tabDetachMode === 'own-cleared') {
      if (rawUserId) {
        tabDetachMode = AUTH_CLEAR_FOREIGN;
        blocked = false;
        return AUTH_CLEAR_FOREIGN;
      }
      blocked = false;
      return true;
    }
    if (!pendingWrite && tabUserId && rawUserId && rawUserId !== tabUserId) {
      tabUserId = null;
      tabDetachMode = AUTH_CLEAR_FOREIGN;
      blocked = false;
      return AUTH_CLEAR_FOREIGN;
    }

    localStorage.removeItem(STORAGE_KEY);
    blocked = localStorage.getItem(STORAGE_KEY) !== null;
    if (blocked) return false;
    pendingWrite = null;
    tabUserId = null;
    tabDetachMode = 'own-cleared';
    return true;
  } catch {
    return false;
  }
}
