// /server/src/serialize.js — DB row -> API JSON projection (camelCase). The single place that
// shapes outbound entities (ADR BD-DOCS-041), so no route hand-rolls a response and nothing
// internal (token hashes, raw pg types, INTERNAL user ids) leaks. serializeOrder mirrors the
// mock_api order shape the PWA projects via rideOrderToFeedPost (id, status, source, comment,
// pickup/dropoff, scheduled*, price*, createdAt).
//
// PRIVACY (Codex R03): GET /orders is a PUBLIC, unauthenticated feed read, so this projection
// exposes NO passenger PII — only the per-viewer ownership flag. The stored passenger snapshot
// (name / masked phone / authorId = the internal users.id) is per-order contact data meant for
// the future AUTH-GATED driver-accept handoff (BD-ACTIVE-07, migrations/0002), NOT for broadcast
// to anonymous callers, so it is withheld here. `passenger.isCurrentUser` is recomputed PER
// VIEWER from the order's owner (passenger_id) vs the authenticated viewer; an anonymous viewer
// always gets false.
//
// R18 NOTE (Codex #789): the client feed mapper (mock_api.rideOrderToFeedPost) still HARDCODES
// createdByCurrentUser:true and ignores this flag — fine today because the R13 feed seam is
// flag-OFF. The R18 read cutover MUST switch that mapper to consume order.passenger.isCurrentUser,
// otherwise multi-user orders would all render as the viewer's own (hiding accept/respond). The
// server side (this flag) is already correct; the fix is client-only and owned by R18.
export function serializeOrder(row, { viewerId = null } = {}) {
  if (!row) return null;
  const ownerId = row.passenger_id ?? null;
  const isCurrentUser = viewerId != null && ownerId != null && String(ownerId) === String(viewerId);

  return {
    id: row.legacy_id ?? row.id,
    type: row.type,
    source: row.source,
    status: row.status,
    pickup: row.pickup ?? null,
    dropoff: row.dropoff ?? null,
    distanceKm: Number(row.distance_km) || 0,
    durationMin: Number(row.duration_min) || 0,
    estimatedPrice: Number(row.estimated_price) || 0,
    estimatedPriceLabel: row.estimated_price_label ?? '',
    scheduledMode: row.scheduled_mode,
    scheduledAt: row.scheduled_at ?? '',
    scheduledLabel: row.scheduled_label ?? '',
    comment: row.comment ?? '',
    // No passenger contact snapshot on this public projection — only the per-viewer flag.
    passenger: { isCurrentUser },
    createdAt: toIso(row.created_at),
    acceptedAt: row.accepted_at ? toIso(row.accepted_at) : null,
  };
}

// Project an offers row for the OWNER-ONLY matching list (#3, R04). Exposing the driver's id +
// offer details (name/car/rating/eta/price/message) is intended here — this read is gated to the
// order's passenger, who is choosing a driver (and needs driverId for the R05 /select). The
// client-facing order id is the legacy string, supplied by the caller (it knows which order it
// queried), since the row only carries the order UUID FK.
export function serializeOffer(row, { orderLegacyId = null } = {}) {
  if (!row) return null;
  return {
    id: row.legacy_id,
    orderId: orderLegacyId,
    driverId: row.driver_id,
    status: row.status,
    driverName: row.driver_name ?? null,
    car: row.car ?? null,
    rating: row.rating ?? null,
    etaMin: row.eta_min ?? null,
    price: row.price == null ? null : Number(row.price),
    message: row.message ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    expiresAt: toIso(row.expires_at),
  };
}

// Project the assignment overlay row (#3 /select, R05). Returned to the order OWNER on accept, so
// exposing selectedDriverId is intended (they just chose that driver). The client-facing order id
// is the legacy string, supplied by the caller.
export function serializeAssignment(row, { orderLegacyId = null } = {}) {
  if (!row) return null;
  return {
    orderId: orderLegacyId,
    status: row.status,
    selectedDriverId: row.selected_driver_id ?? null,
    canceledBy: row.canceled_by ?? null,
    canceledAt: row.canceled_at ? toIso(row.canceled_at) : null,
    updatedAt: toIso(row.updated_at),
  };
}

// Project a ride snapshot for the #5 Ride-State chokepoint (R06). A FOCUSED snapshot — status,
// identity, route labels, the status-keyed timestamps, and the cancel block — enough to read/verify
// the ride state; the full active-ride hydration (every display string) is frozen at the R15 client
// read cutover. The read is participant-gated, so the masked-phone/name fields are owner/driver-only.
export function serializeRide(row) {
  if (!row) return null;
  return {
    tripId: row.trip_id,
    status: row.status,
    role: row.role ?? null,
    passenger: {
      name: row.passenger_name ?? null,
      initials: row.passenger_initials ?? null,
      rating: row.passenger_rating ?? null,
      phoneMasked: row.passenger_phone_masked ?? null,
    },
    driver: {
      name: row.driver_name ?? null,
      initials: row.driver_initials ?? null,
      rating: row.driver_rating ?? null,
      car: row.driver_car ?? null,
    },
    route: {
      pickupLabel: row.route_pickup_label ?? null,
      dropoffLabel: row.route_dropoff_label ?? null,
      etaToPickup: row.route_eta_to_pickup ?? null,
      etaToDestination: row.route_eta_to_destination ?? null,
    },
    order: {
      offerPrice: row.order_offer_price ?? null, // the agreed fare (accepted offer's bid, R10)
    },
    cancel: {
      by: row.cancel_by ?? null,
      reason: row.cancel_reason ?? null,
    },
    timestamps: {
      createdAt: toIso(row.created_at),
      acceptedAt: row.accepted_at ? toIso(row.accepted_at) : null,
      approachingAt: row.approaching_at ? toIso(row.approaching_at) : null,
      arrivedAt: row.arrived_at ? toIso(row.arrived_at) : null,
      startedAt: row.started_at ? toIso(row.started_at) : null,
      completedAt: row.completed_at ? toIso(row.completed_at) : null,
      canceledAt: row.canceled_at ? toIso(row.canceled_at) : null,
      updatedAt: toIso(row.updated_at),
    },
  };
}

// Project a ride_history VIEW row (#8, R08) for the viewer's own history. Role-agnostic
// counterparty (a passenger row sees the driver; a driver row sees the passenger). Internal user
// ids (viewer_user_id / counterparty_id) are NOT exposed. The receipt sub-object is present only on
// driver rows that have a receipt (the view LEFT JOINs it; receipt_fare is null otherwise).
export function serializeHistoryEntry(row) {
  if (!row) return null;
  return {
    tripId: row.trip_id,
    role: row.role,
    completedAt: toIso(row.completed_at),
    counterparty: { name: row.counterparty_name ?? null, rating: row.counterparty_rating ?? null },
    vehicle: { model: row.vehicle_model ?? null, color: row.vehicle_color ?? null, plate: row.vehicle_plate ?? null },
    route: { pickupLabel: row.pickup_label ?? null, dropoffLabel: row.dropoff_label ?? null },
    fare: row.fare ?? null,
    distance: row.distance ?? null,
    duration: row.duration ?? null,
    rating: row.rating ?? null,
    tags: row.tags ?? null,
    comment: row.comment ?? null,
    receipt: row.receipt_fare != null
      ? {
        fare: row.receipt_fare,
        net: row.receipt_net,
        commission: row.receipt_commission,
        tip: row.receipt_tip,
        paymentMode: row.receipt_payment_mode,
      }
      : null,
  };
}

// Project a receipts row (#8, R08). The integers are stored already-computed (no recompute), so
// they are echoed verbatim; commission is already signed (negative).
export function serializeReceipt(row, { tripId = null } = {}) {
  if (!row) return null;
  return {
    tripId,
    fare: row.fare,
    commission: row.commission,
    tip: row.tip,
    net: row.net,
    paymentMode: row.payment_mode,
    status: row.status,
    completedAt: toIso(row.completed_at),
  };
}

// Project a ride_events row for the realtime poll (#9 read seam, R09). `at` is the cursor the
// client echoes back; payload carries the event specifics (e.g. {from,to} for a status_change).
export function serializeRideEvent(row) {
  if (!row) return null;
  return {
    type: row.type,
    role: row.role ?? null,
    at: toIso(row.at),
    payload: row.payload ?? null,
  };
}

// Project a messages row for the #784 R07 chat thread. client_msg_id is BIGINT (node-pg returns it
// as a string) — surfaced as a Number (the route bounds it to MAX_SAFE_INTEGER, so this is lossless).
export function serializeMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    chatId: row.chat_id,
    senderRole: row.sender_role ?? null,
    clientMsgId: row.client_msg_id == null ? null : Number(row.client_msg_id),
    body: row.body,
    displayTime: row.display_time ?? null,
    createdAt: toIso(row.created_at),
  };
}

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}
