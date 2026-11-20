-- =============================================================================
-- /server/migrations/0016_order_edit_terms.sql
-- The owner edits an open order in place (#1188): PATCH /api/v1/orders/:orderId.
--
-- Three nullable timestamps record what an edit did, so both sides can be told:
--   orders.terms_changed_at  - the last edit of the price, the time or the comment;
--   orders.price_changed_at  - the last edit that changed the price;
--   offers.previous_terms_at - set on a still-open offer when the order changed under it
--                              without a price change (the offer was made for the previous
--                              terms); cleared when the driver sends the offer again.
-- A price change rejects the open offers instead (offers.rejected_by = 'passenger_edit',
-- rejected_reason = 'order_price_changed'); those two columns are free TEXT (0001), so the
-- new literals need no constraint change.
--
-- SCHEMA-ONLY: three nullable columns, no data change. Orders and offers written before this
-- slice keep NULL (never edited). ADD COLUMN IF NOT EXISTS makes a second apply a no-op
-- (server-ci applies every migration twice). ASCII only.
-- =============================================================================

BEGIN;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS terms_changed_at TIMESTAMPTZ NULL;  -- order.termsChangedAt
ALTER TABLE orders ADD COLUMN IF NOT EXISTS price_changed_at TIMESTAMPTZ NULL;  -- order.priceChangedAt
ALTER TABLE offers ADD COLUMN IF NOT EXISTS previous_terms_at TIMESTAMPTZ NULL; -- offer.previousTermsAt

COMMIT;
