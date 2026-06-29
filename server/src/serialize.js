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

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}
