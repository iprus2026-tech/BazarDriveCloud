// /server/src/domain/ride-order-comment.js — #1052: the passenger's order comment as a ride carries
// it to its participants (`ride.order.comment`). ONE rule for both places that produce it, so the
// two ride reads agree:
//   - the /select seed (services/matching buildRideSeed -> rides.passenger_note), served by
//     serializeRide() (the /select and PATCH responses, standalone rides);
//   - serializeRecoveredRide() (the recovery-gated GET), which reprojects from the order itself.
// The order's own comment wins when it has text; else the passenger snapshot's comment; else null.
// Text means at least one character outside ASCII whitespace (space, \t \n \v \f \r): an empty or
// blank comment is no comment. migrations/0012 applies the same rule, with the same character set,
// to rides seeded before it.

const HAS_TEXT = /[^ \t\n\v\f\r]/;

export function rideNoteText(value) {
  return typeof value === 'string' && HAS_TEXT.test(value) ? value : null;
}

export function rideOrderComment(order) {
  if (!order || typeof order !== 'object') return null;
  const snap = (order.passenger_snapshot && typeof order.passenger_snapshot === 'object') ? order.passenger_snapshot : {};
  return rideNoteText(order.comment) ?? rideNoteText(snap.comment);
}
