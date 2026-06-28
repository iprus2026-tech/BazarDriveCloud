// /server/src/infra/ids.js — canonical business-id minting (ADR BD-DOCS-041). The DB owns a
// UUID primary key per row; this mints the STABLE, URL-safe, greppable business id the client
// joins on (the mock_api family is 'order-<…>', and the client derives tripId 'trip_<orderId>'
// and links responses by order id). randomUUID is collision-resistant, so two orders created in
// the same millisecond never clash (unlike the client's Date.now()-based mock id).
import { randomUUID } from 'node:crypto';

export function newOrderId() {
  return `order-${randomUUID()}`;
}
