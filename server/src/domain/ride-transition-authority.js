// /server/src/domain/ride-transition-authority.js — per-role ride status authority
// (BD-RIDE-AUTHORITY-01B-B; docs/ride-state-receipt-authority-contract.md §1). Pure: no I/O.
//
// The ride status canon (RIDE_STATUS, NEXT_STATUS, the terminal freeze) stays in ride-status.js and
// stays parity-pinned to the client; this module only decides WHO may make WHICH move on the
// server write path. The actor role is the caller's participation in the ride (driver / passenger).
//
// Forward moves follow NEXT_STATUS exactly one step at a time — no skips, no backward moves:
//   driver    : ACCEPTED -> DRIVER_EN_ROUTE -> DRIVER_APPROACHING_PICKUP -> WAITING_PASSENGER
//               -> IN_PROGRESS -> COMPLETED
//   passenger : WAITING_PASSENGER -> IN_PROGRESS (boarding)
// The CANCELED and NO_SHOW branches keep their own rules in services/ride-state; the only new
// branch rule is that a passenger can no longer cancel an IN_PROGRESS ride.
import { RIDE_STATUS, NEXT_STATUS, TERMINAL_RIDE_STATUSES } from './ride-status.js';

export const FORWARD_TARGETS_BY_ROLE = Object.freeze({
  driver: Object.freeze(new Set([
    RIDE_STATUS.DRIVER_EN_ROUTE,
    RIDE_STATUS.DRIVER_APPROACHING_PICKUP,
    RIDE_STATUS.WAITING_PASSENGER,
    RIDE_STATUS.IN_PROGRESS,
    RIDE_STATUS.COMPLETED,
  ])),
  passenger: Object.freeze(new Set([RIDE_STATUS.IN_PROGRESS])),
});

const deny = (status, code, error) => ({ ok: false, status, code, error });

function ownedByAnyRole(target) {
  return Object.values(FORWARD_TARGETS_BY_ROLE).some((targets) => targets.has(target));
}

// Decide a non-branch status change (anything but CANCELED / NO_SHOW), in the contract's order:
// target owned by nobody -> 409; owned by the other role -> 403; same status -> idempotent no-op;
// terminal ride -> 409 RIDE_TERMINAL; not the single NEXT_STATUS step -> 409.
export function authorizeForwardTransition({ role, from, to }) {
  if (!ownedByAnyRole(to)) {
    return deny(409, 'RIDE_TRANSITION_NOT_ALLOWED', `${to} cannot be set through this route`);
  }
  const owned = FORWARD_TARGETS_BY_ROLE[role];
  if (!owned || !owned.has(to)) {
    return deny(403, 'RIDE_ROLE_FORBIDDEN', `the ${role ?? 'caller'} cannot set ${to}`);
  }
  if (to === from) return { ok: true, noop: true };
  if (TERMINAL_RIDE_STATUSES.has(from)) {
    return deny(409, 'RIDE_TERMINAL', `ride is terminal (${from})`);
  }
  if (NEXT_STATUS[from] !== to) {
    return deny(409, 'RIDE_TRANSITION_NOT_ALLOWED', `${from} -> ${to} is not the next step`);
  }
  return { ok: true, noop: false };
}

// The CANCELED-branch rule added by the contract: a passenger may cancel only before the trip
// starts. Called after the existing same-status and terminal checks, before reason validation.
export function authorizeCancel({ role, from }) {
  if (role === 'passenger' && from === RIDE_STATUS.IN_PROGRESS) {
    return deny(409, 'RIDE_TRANSITION_NOT_ALLOWED', 'a passenger cannot cancel a ride in progress');
  }
  return { ok: true };
}
