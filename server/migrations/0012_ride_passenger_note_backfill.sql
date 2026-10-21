-- =============================================================================
-- /server/migrations/0012_ride_passenger_note_backfill.sql
-- The ride carries the order comment to the driver (#1052).
--
-- Since this slice the /select seed writes rides.passenger_note with one rule
-- (src/domain/ride-order-comment.js), and the ride reads serve it as ride.order.comment:
--   the order's own comment when it has text; else the passenger snapshot's comment
--   (a JSON string with text); else NULL. Text = at least one character outside ASCII
--   whitespace (space, tab, newline, vertical tab, form feed, carriage return).
-- The seed before preferred the snapshot comment whenever it was a string, so an empty
-- snapshot comment ('') hid the order's own comment. This migration is the DATA-ONLY
-- backfill of rides seeded before: no schema change.
--
-- Only rides linked to an order (rides.order_id) are touched, and only when the stored
-- note differs from the rule, so a second apply is a no-op (server-ci applies every
-- migration twice). The status never changes, so the terminal-freeze trigger is not
-- involved; trg_rides_updated_at stamps updated_at on the changed rows only.
-- ASCII only.
-- =============================================================================

BEGIN;

UPDATE rides r
   SET passenger_note = v.note
  FROM (
    SELECT o.id,
           CASE
             WHEN o.comment ~ '[^ \t\n\v\f\r]' THEN o.comment
             WHEN jsonb_typeof(o.passenger_snapshot -> 'comment') = 'string'
                  AND (o.passenger_snapshot ->> 'comment') ~ '[^ \t\n\v\f\r]'
               THEN o.passenger_snapshot ->> 'comment'
             ELSE NULL
           END AS note
      FROM orders o
  ) v
 WHERE v.id = r.order_id
   AND r.passenger_note IS DISTINCT FROM v.note;

COMMIT;
