// /server/src/infra/ids.js — canonical business-id minting (ADR BD-DOCS-041). The DB owns a
// UUID primary key per row; this mints the STABLE, URL-safe, greppable business id the client
// joins on (the mock_api family is 'order-<…>', and the client derives tripId 'trip_<orderId>'
// and links responses by order id). randomUUID is collision-resistant, so two orders created in
// the same millisecond never clash (unlike the client's Date.now()-based mock id).
import { randomUUID } from 'node:crypto';

export function newOrderId() {
  return `order-${randomUUID()}`;
}

// The offer business id mirrors the client's buildOfferId (driver_offer_store.js): one offer per
// (order, driver), so the id is the composite key 'offer_<orderId>_<driverId>'. orderId is the
// order's legacy id ('order-…'); driverId is the driver's user UUID. The DB also enforces the
// invariant with UNIQUE(order_id, driver_id) — this keeps the same key explicit/greppable.
export function newOfferId(orderLegacyId, driverId) {
  return `offer_${orderLegacyId}_${driverId}`;
}
