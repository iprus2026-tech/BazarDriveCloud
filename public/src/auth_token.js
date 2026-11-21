// public/src/auth_token.js — R17 / CUT-2 of #784 (frontend auth-token cutover).
//
// Owns `bazardrive.auth.v1` ({ token, userId, phone, optional ownerVersion }). This is the
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
// The ownerVersion of the last record the server confirmed (new-tab continuity, see
// adoptConfirmedAuth). Only a pointer: no credential, no identity. A separate key on purpose — a
// write to STORAGE_KEY is broadcast to every tab, and confirming must not add a second one.
const CONFIRMED_KEY = 'bazardrive.auth.confirmed.v1';
const OWNER_VERSION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readMarker() {
  try {
    const value = typeof sessionStorage === 'undefined' ? null
      : sessionStorage.getItem(REJECTED_PROJECTION_KEY);
    if (value === null) return null;
    const [state, ownerVersion, extra] = value.split(':');
    if (['candidate', 'bound'].includes(state) && OWNER_VERSION.test(ownerVersion || '')
        && extra === undefined) return { state, ownerVersion };
  } catch {}
  // Legacy rejection, malformed and unreadable markers all fail closed.
  return { state: 'rejected' };
}

let marker = readMarker();

function markerMatches() {
  const persisted = readMarker();
  return marker === null ? persisted === null
    : persisted?.state === marker.state && persisted.ownerVersion === marker.ownerVersion;
}

function persistMarker(next) {
  marker = next;
  const value = next.state === 'rejected' ? '1' : `${next.state}:${next.ownerVersion}`;
  sessionStorage.setItem(REJECTED_PROJECTION_KEY, value);
  return sessionStorage.getItem(REJECTED_PROJECTION_KEY) === value;
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

function recordOwned(record) {
  if (!Object.hasOwn(record, 'ownerVersion')) return marker === null;
  return typeof record.ownerVersion === 'string' && OWNER_VERSION.test(record.ownerVersion)
    && ['candidate', 'bound'].includes(marker?.state)
    && record.ownerVersion === marker.ownerVersion;
}

function load() {
  if (marker?.state === 'rejected' || blocked || tabDetachMode || !markerMatches()) return {};
  try {
    const record = loadRaw();
    return recordOwned(record) ? record : {};
  } catch { return {}; }
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
  if (isAuthTabRejected()) return false;
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
  if (marker?.state === 'rejected' || (marker && blocked) || !markerMatches()) return true;
  try { return !recordOwned(loadRaw()); } catch { return true; }
}

export function getAuthOwnerVersion() {
  return marker?.ownerVersion && loadForTab().ownerVersion === marker.ownerVersion ? marker.ownerVersion : null;
}

export function isAuthCandidate() {
  return marker?.state === 'candidate';
}

// The controller calls this only after /auth/session confirms the captured
// credential. Keep the version pin even after confirmation and across reload.
export function commitAuthCandidate(ownerVersion) {
  if (!ownerVersion || getAuthOwnerVersion() !== ownerVersion) return false;
  if (marker.state === 'bound') { markRecordConfirmed(ownerVersion); return true; }
  const candidate = marker;
  try {
    if (!persistMarker({ state: 'bound', ownerVersion })) throw new Error('Auth marker write failed');
    markRecordConfirmed(ownerVersion);
    return getAuthOwnerVersion() === ownerVersion;
  } catch {
    // Retain the same safe candidate for a manual server-confirmation retry.
    marker = candidate;
    try { persistMarker(candidate); } catch {}
    return false;
  }
}

// New-tab session continuity. The per-tab marker keeps a fresh tab from silently resuming a
// credential another tab abandoned (a candidate left behind by Guest / an abandoned login cannot be
// removed atomically). But on a phone every app relaunch is a fresh tab, so a session confirmed by
// the server must survive it. Once /auth/session has confirmed a record (commitAuthCandidate),
// CONFIRMED_KEY names its ownerVersion; a never-confirmed candidate is never named, and a new login
// writes a new ownerVersion that an older confirmation cannot match.
function markRecordConfirmed(ownerVersion) {
  try {
    const raw = loadRaw();
    if (raw.ownerVersion !== ownerVersion || !raw.token) return;
    if (localStorage.getItem(CONFIRMED_KEY) !== ownerVersion) localStorage.setItem(CONFIRMED_KEY, ownerVersion);
  } catch {
    // Best effort: without the pointer a later fresh tab simply signs in again.
  }
}

function confirmedVersion() {
  try { return localStorage.getItem(CONFIRMED_KEY); } catch { return null; }
}

// A fresh tab (no marker at all in this tab's sessionStorage) may take a server-confirmed record
// as a CANDIDATE again. Nothing is trusted yet: the bootstrap still asks /auth/session, which must
// return the same user with a verified phone before commitAuthCandidate() binds it, and a revoked
// session (logout and Guest revoke on the server first) answers no user, so the tab detaches as
// before. A tab that already decided — anonymous, rejected, or holding its own marker — never adopts.
export function isAuthRecordConfirmed() {
  try { const raw = loadRaw(); return !!raw.ownerVersion && confirmedVersion() === raw.ownerVersion; } catch { return false; }
}

export function adoptConfirmedAuth() {
  if (marker !== null || readMarker() !== null || blocked || tabDetachMode || pendingWrite) return false;
  try {
    const raw = loadRaw();
    if (confirmedVersion() !== raw.ownerVersion || typeof raw.token !== 'string' || !raw.token
        || typeof raw.userId !== 'string' || !raw.userId
        || typeof raw.ownerVersion !== 'string' || !OWNER_VERSION.test(raw.ownerVersion)) return false;
    if (!persistMarker({ state: 'candidate', ownerVersion: raw.ownerVersion })) {
      marker = null;
      try { sessionStorage.removeItem(REJECTED_PROJECTION_KEY); } catch {}
      return false;
    }
    return recordOwned(loadRaw());
  } catch {
    return false;
  }
}

// Rejection is tab-local: Web Storage has no atomic shared compare-and-delete.
// Block getters before persisting; a failed write remains blocked and retryable.
export function detachRejectedAuth() {
  marker = { state: 'rejected' };
  blocked = true;
  tabUserId = null;
  tabDetachMode = 'rejected';
  try {
    if (!persistMarker(marker)) return false;
    blocked = false;
    return true;
  } catch {
    return false;
  }
}

// Persist the minted session (called by the onboarding otp-verify success path).
// The phone this tab's own session was verified with, or null. Same ownership rules as the
// token (loadForTab): another tab's or a detached record yields null.
export function getAuthPhone() {
  const phone = loadForTab().phone;
  return typeof phone === 'string' && phone ? phone : null;
}

export function setAuth({ token, userId, phone } = {}) {
  const previousMarker = markerMatches() ? marker : { state: 'rejected' };
  blocked = true;
  let succeeded = false;
  try {
    const ownerVersion = globalThis.crypto.randomUUID();
    if (!persistMarker({ state: 'candidate', ownerVersion })) return false;
    const next = {
      token: token || null,
      userId: userId || null,
      phone: phone || null,
      ownerVersion,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    pendingWrite = next;
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!token || !userId || saved?.token !== token || saved?.userId !== userId
        || saved?.phone !== (phone || null) || saved?.ownerVersion !== ownerVersion) return false;
    blocked = false;
    tabUserId = userId;
    tabDetachMode = null;
    pendingWrite = null;
    succeeded = true;
    return true;
  } catch {
    return false;
  } finally {
    if (!succeeded) {
      try {
        if (previousMarker) {
          if (!persistMarker(previousMarker)) throw new Error('Auth marker restore failed');
        } else {
          marker = null;
          sessionStorage.removeItem(REJECTED_PROJECTION_KEY);
          if (sessionStorage.getItem(REJECTED_PROJECTION_KEY) !== null) throw new Error('Auth marker restore failed');
        }
      } catch {
        marker = { state: 'rejected' };
        try { persistMarker(marker); } catch {}
      }
    }
  }
}

// Drop only the credential owned by this tab. If another tab has already
// replaced the origin-wide record, detach locally but preserve that replacement.
// Explicit logout retains this lease across a failed removal. Raw readback is
// needed on retry because failed removal deliberately blocks public getters.
function ownsBlockedLogoutCleanup(expected) {
  return blocked && !pendingWrite && !tabDetachMode
    && ['bound', 'candidate'].includes(marker?.state)
    && typeof expected.token === 'string' && !!expected.token
    && expected.userId === tabUserId && expected.ownerVersion === marker.ownerVersion
    && markerMatches();
}

export function isLogoutAuthCurrent(expected) {
  if (!expected.token) {
    try {
      const raw = loadRaw();
      if (raw.token && recordOwned(raw) && !tabDetachMode && marker?.state !== 'rejected') return false;
      return getAuthToken() === null && getAuthUserId() === null
        && getAuthOwnerVersion() === expected.ownerVersion;
    } catch { return false; }
  }
  const ownedCleanup = ownsBlockedLogoutCleanup(expected);
  try {
    const raw = loadRaw();
    // Absence after a blocked removal keeps cleanup ownership, not bearer authority.
    if (ownedCleanup && Object.keys(raw).length === 0
        && localStorage.getItem(STORAGE_KEY) === null) return true;
    return markerMatches() && recordOwned(raw) && !tabDetachMode
      && raw.token === expected.token && raw.userId === expected.userId
      && (raw.ownerVersion || null) === expected.ownerVersion;
  } catch { return ownedCleanup; }
}

export function clearAuth({ expected } = {}) {
  const retryingOwnedCleanup = expected && ownsBlockedLogoutCleanup(expected);
  if (expected && !isLogoutAuthCurrent(expected)) return false;
  blocked = true;
  if (marker?.state === 'rejected') return AUTH_CLEAR_FOREIGN;
  if (marker && !markerMatches()) return detachRejectedAuth() ? AUTH_CLEAR_FOREIGN : false;
  try {
    const raw = loadRaw();
    if (retryingOwnedCleanup && Object.keys(raw).length === 0
        && localStorage.getItem(STORAGE_KEY) === null) {
      blocked = false;
      pendingWrite = null;
      tabUserId = null;
      tabDetachMode = 'own-cleared';
      return true;
    }
    const rawUserId = typeof raw.userId === 'string' && raw.userId ? raw.userId : null;

    if (Object.hasOwn(raw, 'ownerVersion') && !recordOwned(raw)) {
      return detachRejectedAuth() ? AUTH_CLEAR_FOREIGN : false;
    }
    if (marker && raw.ownerVersion !== marker.ownerVersion
        && !(tabDetachMode === 'own-cleared' && !raw.token && !rawUserId)) {
      return detachRejectedAuth() ? AUTH_CLEAR_FOREIGN : false;
    }
    if (marker?.state === 'candidate' && !expected) {
      // An unconfirmed login can be abandoned without compare-and-delete of
      // shared storage. Legacy local-only cleanup remains a cache-only detach.
      return detachRejectedAuth() ? AUTH_CLEAR_FOREIGN : false;
    }
    // An explicit server-first detach supplies the exact captured lease. Only
    // that path may remove an installed candidate and retain removal repair.

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
