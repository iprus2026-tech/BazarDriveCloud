-- =============================================================================
-- /server/migrations/0011_order_ride_lifecycle_backfill.sql
-- Order lifecycle follows its ride (order-lifecycle contract, 2026-10-21; #1051 D10).
--
-- Since this slice the ride-state PATCH moves the order (and, on a cancel or a no-show, the
-- assignment) in the same transaction as the ride:
--   ride IN_PROGRESS       -> order IN_PROGRESS
--   ride COMPLETED         -> order COMPLETED
--   ride CANCELED / NO_SHOW -> order CANCELED, assignment CANCELED
--                              (canceled_by = the ride's cancel actor; NO_SHOW -> 'driver')
-- and the recovery-linkage invariant (src/domain/select-recovery-linkage.js) checks exactly that
-- mapping. This migration is the DATA-ONLY backfill of rows written before: no schema change.
--
-- Rides are linked to their order by rides.order_id (the /select bootstrap always sets it).
-- Every UPDATE only moves a row that is still behind its ride, so a second apply is a no-op
-- (server-ci applies every migration twice).
--
-- A canceled ride whose actor cannot be derived (cancel_by NULL or 'system') cannot be mapped:
-- assignment_cancel_stamp requires canceled_by IN ('passenger', 'driver'). The migration does
-- not guess: it raises, and nothing is changed.
-- ASCII only.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  unmappable integer;
BEGIN
  SELECT count(*) INTO unmappable
    FROM rides r
    JOIN assignment a ON a.order_id = r.order_id
   WHERE r.status = 'CANCELED'
     AND a.status = 'ACCEPTED'
     AND (r.cancel_by IS NULL OR r.cancel_by NOT IN ('passenger', 'driver'));
  IF unmappable > 0 THEN
    RAISE EXCEPTION '0011: % canceled ride(s) without a passenger/driver cancel_by; the assignment canceled_by cannot be derived (nothing changed)', unmappable;
  END IF;
END
$$;

UPDATE orders o
   SET status = 'IN_PROGRESS', updated_at = now()
  FROM rides r
 WHERE r.order_id = o.id
   AND r.status = 'IN_PROGRESS'
   AND o.status = 'ACCEPTED';

UPDATE orders o
   SET status = 'COMPLETED', updated_at = now()
  FROM rides r
 WHERE r.order_id = o.id
   AND r.status = 'COMPLETED'
   AND o.status IN ('ACCEPTED', 'IN_PROGRESS');

UPDATE orders o
   SET status = 'CANCELED', updated_at = now()
  FROM rides r
 WHERE r.order_id = o.id
   AND r.status IN ('CANCELED', 'NO_SHOW')
   AND o.status IN ('ACCEPTED', 'IN_PROGRESS');

UPDATE assignment a
   SET status = 'CANCELED',
       canceled_by = CASE WHEN r.status = 'NO_SHOW' THEN 'driver' ELSE r.cancel_by END,
       canceled_at = coalesce(r.canceled_at, now()),
       updated_at = now()
  FROM rides r
 WHERE r.order_id = a.order_id
   AND r.status IN ('CANCELED', 'NO_SHOW')
   AND a.status = 'ACCEPTED';

COMMIT;
