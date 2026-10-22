-- =============================================================================
-- /server/migrations/0013_offer_vehicle_fields.sql
-- The driver's offer carries the car as separate fields, so the passenger can check the
-- plate (#1113).
--
-- Until now an offer stored the car as one display string (offers.car, e.g. 'Kia Rio, grey'),
-- and the plate never reached the server. From this slice POST /matching/offers takes
-- vehicleModel / vehicleColor / vehiclePlate (the plate normalized by
-- src/domain/vehicle-plate.js); /select copies them into the ride's existing
-- rides.vehicle_model / vehicle_color / vehicle_plate columns (0001), which the ride reads
-- and the ride_history view already serve.
--
-- SCHEMA-ONLY: three nullable columns, no data change. Offers made before this slice keep
-- NULL (their car had no plate on the server to recover). ADD COLUMN IF NOT EXISTS makes a
-- second apply a no-op (server-ci applies every migration twice). ASCII only.
-- =============================================================================

BEGIN;

ALTER TABLE offers ADD COLUMN IF NOT EXISTS vehicle_model TEXT NULL;  -- offer.vehicleModel
ALTER TABLE offers ADD COLUMN IF NOT EXISTS vehicle_color TEXT NULL;  -- offer.vehicleColor
ALTER TABLE offers ADD COLUMN IF NOT EXISTS vehicle_plate TEXT NULL;  -- offer.vehiclePlate (normalized)

COMMIT;
