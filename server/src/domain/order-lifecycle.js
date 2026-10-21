// Order lifecycle follows its ride (order-lifecycle contract, 2026-10-21; #1049, #1050, #1051).
// Pure mapping shared by the ride-state PATCH (which moves the order in the same transaction as
// the ride), the recovery-linkage invariant (which checks the pair) and migration 0011 (which
// backfills rows written before the PATCH kept them in step). After any ride cancel the order is
// terminal CANCELED; re-matching the order with another driver is a separate decision (#1097).

// The order status each recovery-eligible ride status implies.
export const ORDER_STATUS_FOR_RIDE = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  DRIVER_EN_ROUTE: 'ACCEPTED',
  DRIVER_APPROACHING_PICKUP: 'ACCEPTED',
  WAITING_PASSENGER: 'ACCEPTED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELED: 'CANCELED',
  NO_SHOW: 'CANCELED',
});

export function expectedOrderStatus(rideStatus) {
  return ORDER_STATUS_FOR_RIDE[rideStatus] ?? null;
}

// The assignment is CANCELED once the ride is canceled or marked no-show; ACCEPTED otherwise.
export function expectedAssignmentStatus(rideStatus) {
  const order = expectedOrderStatus(rideStatus);
  if (!order) return null;
  return order === 'CANCELED' ? 'CANCELED' : 'ACCEPTED';
}

// Who canceled the assignment of a canceled ride: NO_SHOW is the driver's mark; a CANCELED ride
// carries its own actor when it is a participant. Anything else (NULL, 'system') cannot be
// derived — the assignment row needs 'passenger' | 'driver' (assignment_cancel_stamp), so callers
// must not guess.
export function assignmentCancelActor(ride) {
  if (ride?.status === 'NO_SHOW') return 'driver';
  if (ride?.status === 'CANCELED' && (ride.cancel_by === 'passenger' || ride.cancel_by === 'driver')) {
    return ride.cancel_by;
  }
  return null;
}

// The states an order may move FROM on each ride-driven step: forward only, never out of a
// terminal state.
export const ORDER_FROM_STATUSES = Object.freeze({
  IN_PROGRESS: Object.freeze(['ACCEPTED']),
  COMPLETED: Object.freeze(['ACCEPTED', 'IN_PROGRESS']),
  CANCELED: Object.freeze(['ACCEPTED', 'IN_PROGRESS']),
});

// Thrown inside the ride-state PATCH transaction when the order (or, on a cancel, the assignment)
// is not in a state the ride step may move it from. Throwing rolls the ride transition back with
// it, so a ride never commits ahead of its order; the PATCH answers 409 ORDER_LIFECYCLE_MISMATCH.
// The reason and tripId are for server logs only.
export class OrderLifecycleMismatchError extends Error {
  constructor(tripId, reason) {
    super(`order lifecycle mismatch for ${tripId}: ${reason}`);
    this.name = 'OrderLifecycleMismatchError';
    this.tripId = tripId;
    this.reason = reason;
  }
}
