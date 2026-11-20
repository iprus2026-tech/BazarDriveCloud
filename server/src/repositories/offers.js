// /server/src/repositories/offers.js — the ONLY module that runs SQL against `offers`
// (migration 0001). Single SQL seam (ADR BD-DOCS-041). R04 surface (#3 Matching): idempotent
// offer create/resend keyed on (order_id, driver_id), find one offer, and list an order's offers
// for its owner. The accepted/rejected transitions are R05 (/select); the TTL→expired sweep is a
// future job. NUMERIC `price` is passed as a JS number (or null).

// One offer per (order_id, driver_id): insert a fresh 'sent' offer; on the conflict, a still-open
// offer ('sent', or a 'withdrawn' one being re-sent) takes the details of THIS request (#1176).
// A driver revising their bid must not get a success answer while the passenger keeps seeing —
// and the ride keeps being priced at — the first one. Only the details the request carries are
// replaced (COALESCE), so a retry of the same payload changes nothing and a partial re-send (just
// a new price) keeps the name, car and message already stored. The original expires_at is kept:
// revising is not a way to extend an offer's life. A terminal offer (accepted/rejected/expired)
// is never touched: the conflict is a NO-OP and RETURNING is empty (the caller reads the existing
// row back). The caller holds the order's FOR UPDATE lock and has checked it is still CREATED,
// so a revision can never land after /select. Returns the row, or undefined on a no-op conflict.
//
// #1188 — one terminal offer IS re-sendable: an offer rejected because the passenger changed the
// order's price (rejected_by = 'passenger_edit'). The driver offers again on the new price, so that
// re-send is a NEW bid: it takes this request's price and message as they are (the old ones were
// for another price), a fresh expires_at, and drops the rejection marks. Any re-send also clears
// previous_terms_at — the driver has answered the order as it now stands.
export async function upsertOffer(db, o) {
  const { rows } = await db.query(
    `INSERT INTO offers
       (legacy_id, order_id, driver_id, status, driver_name, car, rating, eta_min, price, message, expires_at,
        vehicle_model, vehicle_color, vehicle_plate)
     VALUES ($1, $2, $3, 'sent', $4, $5, $6, $7, $8, $9, now() + make_interval(mins => $10::int), $11, $12, $13)
     ON CONFLICT (order_id, driver_id) DO UPDATE
       SET status = 'sent', updated_at = now(),
           driver_name   = COALESCE(EXCLUDED.driver_name, offers.driver_name),
           car           = COALESCE(EXCLUDED.car, offers.car),
           rating        = COALESCE(EXCLUDED.rating, offers.rating),
           eta_min       = COALESCE(EXCLUDED.eta_min, offers.eta_min),
           price         = CASE WHEN offers.status = 'rejected' THEN EXCLUDED.price
                                ELSE COALESCE(EXCLUDED.price, offers.price) END,
           message       = CASE WHEN offers.status = 'rejected' THEN EXCLUDED.message
                                ELSE COALESCE(EXCLUDED.message, offers.message) END,
           vehicle_model = COALESCE(EXCLUDED.vehicle_model, offers.vehicle_model),
           vehicle_color = COALESCE(EXCLUDED.vehicle_color, offers.vehicle_color),
           vehicle_plate = COALESCE(EXCLUDED.vehicle_plate, offers.vehicle_plate),
           expires_at    = CASE WHEN offers.status = 'rejected' THEN EXCLUDED.expires_at
                                ELSE offers.expires_at END,
           previous_terms_at = NULL,
           rejected_by = NULL, rejected_reason = NULL, rejected_at = NULL
       WHERE offers.status IN ('sent', 'withdrawn')
          OR (offers.status = 'rejected' AND offers.rejected_by = 'passenger_edit')
     RETURNING *`,
    [o.legacyId, o.orderId, o.driverId, o.driverName, o.car, o.rating, o.etaMin, o.price, o.message, o.ttlMin,
      o.vehicleModel ?? null, o.vehicleColor ?? null, o.vehiclePlate ?? null],
  );
  return rows[0];
}

export async function findOfferByOrderDriver(db, orderId, driverId) {
  const { rows } = await db.query(
    `SELECT * FROM offers WHERE order_id = $1 AND driver_id = $2 LIMIT 1`,
    [orderId, driverId],
  );
  return rows[0] ?? null;
}

// Whether the driver has a LIVE offer on the order — the exact predicate acceptOffer updates on
// (sent, not expired; now() is the transaction start, so both reads agree inside one tx).
// BD-AUTH-POLICY-01B-C: /select checks this before the driver's grant, so the grant answer is
// only ever given for a driver who actually offered.
export async function findLiveOfferByOrderDriver(db, orderId, driverId) {
  const { rows } = await db.query(
    `SELECT id FROM offers
      WHERE order_id = $1 AND driver_id = $2 AND status = 'sent' AND expires_at > now()
      LIMIT 1`,
    [orderId, driverId],
  );
  return rows[0] ?? null;
}

// All offers for an order (the owner's read), newest first. Served by idx_offers_order_status.
export async function listOffersByOrder(db, orderId) {
  const { rows } = await db.query(
    `SELECT * FROM offers WHERE order_id = $1 ORDER BY created_at DESC`,
    [orderId],
  );
  return rows;
}

// Accept the selected driver's LIVE ('sent', not-expired) offer on an order (the transactional
// accept, R05). Guarded by status='sent' AND expires_at > now() — so a withdrawn/terminal OR an
// expired-but-not-yet-swept offer (the TTL sweep is future work) can't be accepted; returns null
// when there is no live offer from that driver, and the caller rejects with 404 (Codex #791).
export async function acceptOffer(db, orderId, driverId) {
  const { rows } = await db.query(
    `UPDATE offers SET status = 'accepted', updated_at = now()
      WHERE order_id = $1 AND driver_id = $2 AND status = 'sent' AND expires_at > now()
      RETURNING *`,
    [orderId, driverId],
  );
  return rows[0] ?? null;
}

// Reject every OTHER live ('sent') offer on the order once one is accepted (R05). Returns the
// rejected ids. Run inside the same tx as acceptOffer, under the order's FOR UPDATE lock. Sets only
// status + updated_at — matching the client commitPassengerSelection, which leaves the rejected_by/
// rejected_at actor fields for the EXPLICIT passenger-reject / cancel flows, not select-peer rejects.
export async function rejectPeerOffers(db, orderId, acceptedDriverId) {
  const { rows } = await db.query(
    `UPDATE offers SET status = 'rejected', updated_at = now()
      WHERE order_id = $1 AND driver_id <> $2 AND status = 'sent'
      RETURNING id`,
    [orderId, acceptedDriverId],
  );
  return rows;
}

// #1049 — an order canceled by its passenger before selection rejects every still-open offer with
// the schema's documented passenger-cancel marks (offers.rejected_by / rejected_reason).
export async function rejectOpenOffersOnOrderCancel(db, orderId) {
  const { rows } = await db.query(
    `UPDATE offers
        SET status = 'rejected', rejected_by = 'passenger_cancel',
            rejected_reason = 'order_canceled_by_passenger', rejected_at = now(), updated_at = now()
      WHERE order_id = $1 AND status = 'sent'
      RETURNING id`,
    [orderId],
  );
  return rows;
}

// #1188 — the owner changed the order's PRICE: every still-open offer was a bid against the old
// price, so it is rejected with its own marks (an earlier previous-terms mark goes with it: the
// offer is no longer open). Unlike any other rejection this one is re-sendable (upsertOffer): the
// driver offers again on the new price.
export async function rejectOpenOffersOnOrderPriceChange(db, orderId) {
  const { rows } = await db.query(
    `UPDATE offers
        SET status = 'rejected', rejected_by = 'passenger_edit',
            rejected_reason = 'order_price_changed', rejected_at = now(), updated_at = now(),
            previous_terms_at = NULL
      WHERE order_id = $1 AND status = 'sent'
      RETURNING id`,
    [orderId],
  );
  return rows;
}

// #1188 — the owner changed the time or the comment (not the price): the open offers stay
// selectable, marked as made for the previous terms. updated_at is NOT bumped — it stays the time
// the driver last sent the offer. Cleared when the driver sends it again (upsertOffer).
export async function markOpenOffersPreviousTerms(db, orderId) {
  const { rows } = await db.query(
    `UPDATE offers SET previous_terms_at = now()
      WHERE order_id = $1 AND status = 'sent'
      RETURNING id`,
    [orderId],
  );
  return rows;
}
