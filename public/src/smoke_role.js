// BD-SMOKE-ROLE-01 — Tab-scoped role override for two-tab smoke testing.
//
// The persisted user (bazardrive.user.v1) is shared across all browser tabs,
// so its `role` cannot describe "this tab is the passenger, that tab is the
// driver". This override lives in sessionStorage, which is per-tab by nature,
// letting each tab carry its own role *context* without ever writing the
// shared user store. The shared order/ride stores (ride_orders.v1,
// active_ride.v1) stay shared — only the role view is per-tab.
//
// Bootstrapped once per tab from ?smokeRole=driver|passenger and then sticky
// for the tab. It overrides only the role used for routing/view decisions; it
// does NOT manufacture driver readiness (isDriverLineReady still reads the
// shared user), so a self-serve driver smoke still requires a line-ready
// driver in the shared profile.

export const SMOKE_ROLE_KEY = 'bazardrive.smoke_role.v1';
const VALID = new Set(['driver', 'passenger']);

export function getSmokeRole() {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const value = sessionStorage.getItem(SMOKE_ROLE_KEY);
    return VALID.has(value) ? value : null;
  } catch {
    // storage unavailable (private mode, blocked) — fail soft.
    return null;
  }
}

export function setSmokeRole(role) {
  if (!VALID.has(role)) return null;
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(SMOKE_ROLE_KEY, role);
    }
  } catch {
    // fail soft — the override is best-effort.
  }
  return role;
}

// BD-ROLE-05 — clear the per-tab override at the auth/logout boundary so a
// stale override cannot outlive the user that set it. Without this, a same-tab
// flow of "switch to driver → logout → onboard again as passenger" would still
// render the driver view because getSmokeRole() wins over u.role.
export function clearSmokeRole() {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(SMOKE_ROLE_KEY);
    }
  } catch {
    // fail soft — same posture as get/set above.
  }
}

// Capture ?smokeRole= from the current navigation. Only SETS on a valid
// value and never clears, so the override stays sticky for the tab after the
// param drops off the URL on later in-tab navigations.
export function bootstrapSmokeRoleFromQuery(queryString) {
  let value = null;
  try {
    value = new URLSearchParams(queryString || '').get('smokeRole');
  } catch {
    value = null;
  }
  if (VALID.has(value)) return setSmokeRole(value);
  return getSmokeRole();
}

// Effective role for the current tab: smoke override wins, else persisted.
export function resolveRole(u) {
  return getSmokeRole() || (u && typeof u.role === 'string' ? u.role : null);
}

// Effective user for role-gating reads: the shared user with this tab's role
// context layered on top. Never persisted.
export function applySmokeRole(u) {
  const smoke = getSmokeRole();
  return smoke ? { ...u, role: smoke } : u;
}
