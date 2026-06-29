// /server/src/domain/ride-status.js — VERBATIM mirror of public/src/ride_state.js:
// the RIDE_STATUS literals + the driver-advance map (client: NEXT_DRIVER_STATUS) +
// TERMINAL_RIDE_STATUSES + the terminal-freeze rule, moved client->server as the
// AUTHORITY per ADR BD-DOCS-041. The DB enforces the same set/rule in SQL (rides.status
// CHECK + the trg_rides_freeze_terminal trigger, migration 0001); this is the JS half.
//
// test/ride-status-parity.test.mjs pins this against the client module and FAILS CI on
// ANY drift — never edit one side without the other. The WHOLE lifecycle moves, not a
// subset.

export const RIDE_STATUS = Object.freeze({
  NEW_ORDER: 'NEW_ORDER',
  CONFIRMATION_PENDING: 'CONFIRMATION_PENDING',
  CONFIRMED: 'CONFIRMED',
  CHAT_STARTED: 'CHAT_STARTED',
  ACCEPTED: 'ACCEPTED',
  DRIVER_EN_ROUTE: 'DRIVER_EN_ROUTE',
  DRIVER_APPROACHING_PICKUP: 'DRIVER_APPROACHING_PICKUP',
  WAITING_PASSENGER: 'WAITING_PASSENGER',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELED: 'CANCELED',
  NO_SHOW: 'NO_SHOW',
});

// Driver-advance chain (client: NEXT_DRIVER_STATUS). The terminal self-mappings
// (COMPLETED/CANCELED/NO_SHOW -> themselves) are intentional and mirror the client.
export const NEXT_STATUS = Object.freeze({
  [RIDE_STATUS.NEW_ORDER]: RIDE_STATUS.ACCEPTED,
  [RIDE_STATUS.ACCEPTED]: RIDE_STATUS.DRIVER_EN_ROUTE,
  [RIDE_STATUS.DRIVER_EN_ROUTE]: RIDE_STATUS.DRIVER_APPROACHING_PICKUP,
  [RIDE_STATUS.DRIVER_APPROACHING_PICKUP]: RIDE_STATUS.WAITING_PASSENGER,
  [RIDE_STATUS.WAITING_PASSENGER]: RIDE_STATUS.IN_PROGRESS,
  [RIDE_STATUS.IN_PROGRESS]: RIDE_STATUS.COMPLETED,
  [RIDE_STATUS.COMPLETED]: RIDE_STATUS.COMPLETED,
  [RIDE_STATUS.CANCELED]: RIDE_STATUS.CANCELED,
  [RIDE_STATUS.NO_SHOW]: RIDE_STATUS.NO_SHOW,
});

export const TERMINAL_RIDE_STATUSES = Object.freeze(
  new Set([RIDE_STATUS.CANCELED, RIDE_STATUS.NO_SHOW, RIDE_STATUS.COMPLETED]),
);

// VERBATIM mirror of ride_state.js STATUS_TIMESTAMP_FIELD — the status -> client timestamp key the
// #5 chokepoint stamps on a transition (the DB columns are the snake_case of these). Statuses with
// no entry (NEW_ORDER/CONFIRMATION_PENDING/CONFIRMED/CHAT_STARTED) stamp nothing. ACCEPTED and
// DRIVER_EN_ROUTE both map to acceptedAt (first-stamp-wins on the client). Pinned by the parity test.
export const STATUS_TIMESTAMP_FIELD = Object.freeze({
  [RIDE_STATUS.ACCEPTED]: 'acceptedAt',
  [RIDE_STATUS.DRIVER_EN_ROUTE]: 'acceptedAt',
  [RIDE_STATUS.DRIVER_APPROACHING_PICKUP]: 'approachingAt',
  [RIDE_STATUS.WAITING_PASSENGER]: 'arrivedAt',
  [RIDE_STATUS.IN_PROGRESS]: 'startedAt',
  [RIDE_STATUS.COMPLETED]: 'completedAt',
  [RIDE_STATUS.CANCELED]: 'canceledAt',
  [RIDE_STATUS.NO_SHOW]: 'canceledAt',
});

// Client parity: isValidRideStatus(status) — a string that is an own key of RIDE_STATUS.
export function isValidRideStatus(status) {
  return typeof status === 'string'
    && Object.prototype.hasOwnProperty.call(RIDE_STATUS, status);
}

// Client parity: getNextDriverStatus(status) => NEXT_DRIVER_STATUS[status] || status.
export function getNextStatus(status) {
  return NEXT_STATUS[status] || status;
}

// Terminal-freeze rule, mirrored from ride_state.js (saveActiveRide /
// updateActiveRideStatus) and the trg_rides_freeze_terminal trigger: a record already in
// a terminal status may only be re-written to the SAME status (an idempotent field patch);
// any transition OUT to a DIFFERENT status is refused.
export function canTransition(from, to) {
  if (TERMINAL_RIDE_STATUSES.has(from) && to !== from) return false;
  return true;
}
