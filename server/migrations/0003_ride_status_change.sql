-- =============================================================================
-- /server/migrations/0003_ride_status_change.sql
-- BazarDriveCloud — #5 Ride State chokepoint: the 'status_change' ride event (R06 of #784)
--
-- Runs AFTER 0001 (ride_events) + 0002 (auth). The PATCH /api/v1/ride-state/rides/:tripId/status
-- write path appends an append-only 'status_change' ride_events row per accepted transition
-- (payload: {from, to}). 0001's ride_events.type CHECK only allowed the two handoff producers
-- ('trip_confirmation', 'driver_handoff_snapshot'); this widens it to add 'status_change'.
--
-- ALTER ONLY — no new table, so the server-ci BASE TABLE count stays 13 (and the ride_history
-- view / freeze + no-mutation triggers are untouched). The 0001 inline column CHECK is
-- auto-named ride_events_type_check; drop-if-exists + re-add keeps a second apply a clean no-op
-- (server-ci re-applies every migration). Wrapped in BEGIN/COMMIT.
--
-- VERIFIED: applied against PostgreSQL after 0001/0002 — first apply OK, second apply
-- (idempotency) OK; a 'status_change' insert is accepted, an unknown type is still rejected.
-- =============================================================================

BEGIN;

ALTER TABLE ride_events DROP CONSTRAINT IF EXISTS ride_events_type_check;
ALTER TABLE ride_events
  ADD CONSTRAINT ride_events_type_check
  CHECK (type IN ('trip_confirmation', 'driver_handoff_snapshot', 'status_change'));

COMMIT;
