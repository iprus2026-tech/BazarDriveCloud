-- =============================================================================
-- /server/migrations/0006_driver_shift_authority.sql
-- BD-DRIVER-SHIFT-AUTHORITY-01B — PostgreSQL working-identity schema (#966/#967)
--
-- SQL realization of the FROZEN contract:
--   docs/driver-shift-authority-contract.md (Issue #966, PR #967,
--   merged to main as caeeb3799f4f4d21ca9aaddd3c14e7556603e83b)
--
-- Runs AFTER 0005 (vehicle_driver_assignments, driver_active_vehicle). Adds the sixth
-- concept in the authoritative split — ownership != entitlement != selection !=
-- WORKING (this file) != presence != ride occupancy:
--
--   driver_shift   the current working identity: an OPEN row pins
--                  driver_id + vehicle_id + assignment_id for the life of one
--                  work session (status OPEN | CLOSED, no third value)
--
-- 01B is schema + repository + dark-seam only: no HTTP route is registered by this
-- migration or by the repositories/service module that follow it. Presence, Dispatcher,
-- Compliance, and vehicles.is_active are untouched — nothing here reads or writes
-- vehicles.is_active, and no driver_shift column duplicates BUSY/ONLINE/OFFLINE/PAUSED
-- state that another layer already owns (contract "State machine").
--
-- COMPOSITE FK, additive (contract "Referential integrity" / "P2-#1"): the pinned tuple
-- (driver_id, vehicle_id, assignment_id) denormalizes a fact vehicle_driver_assignments
-- already owns, so it must be DB-representable, not application-asserted alone. This
-- requires a NEW 3-column unique key on vehicle_driver_assignments
-- (id, driver_id, vehicle_id) — added here via a DO-block guard so it coexists with the
-- EXISTING vehicle_driver_assignments_id_driver_uq (id, driver_id) from 0005 (that key
-- keeps serving driver_active_vehicle's own composite FK, untouched). The new key is
-- intentionally redundant with the table's own PK for uniqueness alone (id is already
-- globally unique) — its only purpose is to exist as a composite-FK target, so adding it
-- is zero-risk against any existing data.
--
-- EXCLUSIVITY (contract "Exclusivity"): two named PARTIAL UNIQUE INDEXES, WHERE
-- status = 'OPEN', are the final DB-integrity backstop for "at most one OPEN shift per
-- driver_id" and "at most one OPEN shift per vehicle_id" — a static row-count invariant
-- over a static predicate, not a now()-dependent one, so a plain partial unique index
-- (not an EXCLUDE constraint) is sufficient, unlike 0005's time-range non-overlap rule.
--
-- IMMUTABILITY GUARD (contract "Lifecycle state invariants" / STEP: "prefer a named
-- update guard/trigger for invariants a CHECK alone cannot enforce"): a CHECK constraint
-- only sees the NEW row in isolation, so "CLOSED cannot reopen" and "the pinned tuple +
-- opened_at cannot mutate" need a BEFORE UPDATE trigger comparing NEW against OLD —
-- driver_shift_guard_immutability(), mirroring rides_freeze_terminal's exact pattern
-- (migration 0001).
--
-- IDEMPOTENCY (server-ci re-applies every migration, twice, per run): CREATE TABLE /
-- INDEX IF NOT EXISTS, DO-block guards for the constraint add (0002's own convention),
-- DROP TRIGGER IF EXISTS + CREATE TRIGGER — a second apply is a clean no-op, matching
-- 0001-0005's convention exactly. Wrapped in BEGIN/COMMIT.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Additive composite key on vehicle_driver_assignments (coexists with the existing
-- 2-column vehicle_driver_assignments_id_driver_uq from 0005 — that key is untouched
-- and keeps serving driver_active_vehicle's own composite FK unchanged).
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'vehicle_driver_assignments_id_driver_vehicle_uq'
  ) THEN
    ALTER TABLE vehicle_driver_assignments
      ADD CONSTRAINT vehicle_driver_assignments_id_driver_vehicle_uq
      UNIQUE (id, driver_id, vehicle_id);
  END IF;
END $$;

-- =============================================================================
-- 14. driver_shift
-- target entity per docs/driver-shift-authority-contract.md
-- "Data contract — driver_shift (new — target entity, not created by 01A)"
-- -----------------------------------------------------------------------------
-- One row = one instance of a driver actually working a specific vehicle under a
-- specific entitlement, from open to close. driver_id/vehicle_id/assignment_id/
-- opened_at are pinned at creation and never rewritten (enforced below by
-- driver_shift_guard_immutability(), not by application discipline alone).
-- =============================================================================
CREATE TABLE IF NOT EXISTS driver_shift (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- the working driver. RESTRICT: a historical shift row must never be silently
  -- orphaned by a user delete (mirrors vehicle_driver_assignments' own RESTRICT choice,
  -- 0005, for the identical audit-integrity reason).
  driver_id      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- the pinned vehicle, derived from the locked assignment at open time — never
  -- client-supplied (repositories/services enforce this; the schema enforces the
  -- resulting tuple is internally consistent via the composite FK below).
  vehicle_id     UUID NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  -- the entitlement this shift was opened under. No standalone FK to
  -- vehicle_driver_assignments(id) alone is declared — the composite FK below is
  -- strictly stronger (it also proves driver_id/vehicle_id belong to that exact row).
  assignment_id  UUID NOT NULL,
  -- OPEN | CLOSED only — no BUSY/ONLINE/OFFLINE/PAUSED (contract "State machine": each
  -- is fully derivable elsewhere; storing any of them here would create a second,
  -- driftable copy of state another layer already owns).
  status         TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  -- server/database clock only, stamped once at INSERT, never rewritten (guarded below).
  opened_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL while OPEN; the exact server transition time on OPEN -> CLOSED.
  closed_at      TIMESTAMPTZ NULL,
  -- NULL while OPEN; mandatory iff CLOSED. Canonical set only — DRIVER_REQUESTED /
  -- ASSIGNMENT_UNUSABLE (contract "close_reason vocabulary" — OPS_FORCED /
  -- COMPLIANCE_UNUSABLE deliberately NOT added; no authoritative trigger exists yet).
  -- TEXT + named CHECK (not a native enum) so a later, explicitly-scoped migration can
  -- extend the vocabulary without a type change.
  close_reason   TEXT NULL CHECK (close_reason IS NULL OR close_reason IN ('DRIVER_REQUESTED', 'ASSIGNMENT_UNUSABLE')),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- OPEN <=> (closed_at IS NULL AND close_reason IS NULL); CLOSED <=> (both set AND
  -- closed_at >= opened_at). Zero-duration shifts deliberately allowed (contract: "does
  -- not require a strictly-positive duration ... inventing a minimum-duration rule here
  -- would be scope creep into a future Availability/UX policy").
  CONSTRAINT driver_shift_lifecycle_check CHECK (
    (status = 'OPEN' AND closed_at IS NULL AND close_reason IS NULL)
    OR
    (status = 'CLOSED' AND closed_at IS NOT NULL AND close_reason IS NOT NULL AND closed_at >= opened_at)
  ),

  -- the pinned tuple MUST be DB-representable, not application-asserted alone (contract
  -- "Referential integrity"): this makes "a pinned vehicle_id that does not match this
  -- exact assignment's true vehicle" or "an assignment belonging to a different driver"
  -- unrepresentable at the DB layer, on top of the opening transaction's own
  -- derive-and-assert step.
  CONSTRAINT driver_shift_assignment_driver_vehicle_fkey
    FOREIGN KEY (assignment_id, driver_id, vehicle_id)
    REFERENCES vehicle_driver_assignments (id, driver_id, vehicle_id)
    ON DELETE RESTRICT
);

-- Exclusivity backstop (contract "Exclusivity") — static row-count invariant over a
-- static predicate (status = 'OPEN'), not now()-dependent, so a plain partial unique
-- index suffices (no EXCLUDE constraint needed, unlike 0005's time-range rule).
CREATE UNIQUE INDEX IF NOT EXISTS driver_shift_one_open_per_driver_uq
  ON driver_shift (driver_id) WHERE status = 'OPEN';
CREATE UNIQUE INDEX IF NOT EXISTS driver_shift_one_open_per_vehicle_uq
  ON driver_shift (vehicle_id) WHERE status = 'OPEN';

-- Lookup indexes (history/read paths) — not required for correctness, mirrors 0005's own
-- idx_vehicle_driver_assignments_driver_status / _vehicle_status convention.
CREATE INDEX IF NOT EXISTS idx_driver_shift_driver_status ON driver_shift (driver_id, status);
CREATE INDEX IF NOT EXISTS idx_driver_shift_vehicle_status ON driver_shift (vehicle_id, status);

-- Immutability guard (contract: "CLOSED cannot reopen"; "pinned driver_id/vehicle_id/
-- assignment_id/opened_at must never be rewritten"). A CHECK constraint only ever sees
-- the NEW row in isolation, so this needs a BEFORE UPDATE trigger comparing NEW against
-- OLD — mirrors rides_freeze_terminal's exact pattern (migration 0001) verbatim in
-- spirit: an idempotent re-save of unchanged values still passes (IS DISTINCT FROM only
-- fires on a genuine change); any attempted mutation of the pinned identity, or any
-- transition OUT of CLOSED, is rejected.
CREATE OR REPLACE FUNCTION driver_shift_guard_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id
     OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
     OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id
     OR NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN
    RAISE EXCEPTION 'driver_shift % pinned identity (driver_id/vehicle_id/assignment_id/opened_at) is immutable',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'CLOSED' AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'driver_shift % is terminal (CLOSED): cannot transition to %',
      OLD.id, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger names matter: PostgreSQL fires multiple BEFORE UPDATE triggers on one table in
-- ALPHABETICAL order by trigger name. "trg_driver_shift_guard_immutability" (g) sorts
-- before "trg_driver_shift_updated_at" (u), so the immutability guard runs FIRST and can
-- reject a bad UPDATE before set_updated_at() ever stamps it.
DROP TRIGGER IF EXISTS trg_driver_shift_guard_immutability ON driver_shift;
CREATE TRIGGER trg_driver_shift_guard_immutability
  BEFORE UPDATE ON driver_shift FOR EACH ROW EXECUTE FUNCTION driver_shift_guard_immutability();

DROP TRIGGER IF EXISTS trg_driver_shift_updated_at ON driver_shift;
CREATE TRIGGER trg_driver_shift_updated_at
  BEFORE UPDATE ON driver_shift FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
