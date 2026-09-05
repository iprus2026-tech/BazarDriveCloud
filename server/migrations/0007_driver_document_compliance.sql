-- =============================================================================
-- /server/migrations/0007_driver_document_compliance.sql
-- BD-DRIVER-DOCUMENT-COMPLIANCE-01B (rebuild) — PostgreSQL foundation/dark-seam schema
--
-- SQL realization of the FROZEN contract:
--   docs/driver-document-compliance-contract.md (Issue #953, PR #954, merged to main)
-- built against the NOW-REAL Driver Shift Authority entity (migration 0006):
--   docs/driver-shift-authority-contract.md (Issue #966, PR #967, merged to main)
--
-- This is a REBUILD of the old, superseded Draft PR #956 attempt — not a mechanical port.
-- #956 predated driver_shift entirely and modeled everything as ONE flat `driver_documents`
-- table keyed by UNIQUE(driver_id, document_type). That model cannot express a
-- vehicle-scoped document (TAXI_OSAGO/TAXI_REGISTRY), cannot express more than one shift
-- instance's WAYBILL/MEDICAL_CHECK evidence, and blocks correct submission history. This
-- migration instead splits IDENTITY from HISTORY, matching the frozen contract's own
-- "Submission lineage and renewal handling" section precisely:
--
--   driver_document_lineages (1)  identity: one row per (document_type, subject tuple),
--                                  immutable at creation, never rewritten
--        │
--        ▼ (N)
--   driver_documents               history: one row per submission ATTEMPT in that
--                                  lineage — versioned, never mutated into history-loss
--
-- Ordering this migration assumes, frozen by docs/driver-shift-authority-contract.md
-- ("Compliance boundary"):
--
--   driver_active_vehicle selection -> shift-open -> REAL OPEN driver_shift.id
--     -> shift-specific compliance evidence (WAYBILL / MEDICAL_CHECK) -> future
--        ONLINE / dispatch eligibility
--
-- shift-open itself does NOT require a pre-existing shift-bound WAYBILL/MEDICAL_CHECK
-- (nothing can be shift-bound before a shift_id exists) — this migration only makes it
-- POSSIBLE for WAYBILL/MEDICAL_CHECK evidence to bind to a REAL, physical shift_id for the
-- first time. Once a shift is OPEN, the authoritative compliance-evaluation context is
-- { driverId, shiftId, activeVehicleId = that OPEN shift's own pinned vehicle_id } — never
-- driver_active_vehicle.assignment_id (or any vehicle_id derived from it) once a shift is
-- OPEN; that selection only ever feeds shift-open, per the frozen contract.
--
-- SUBJECT SCOPE per document_type (frozen by docs/driver-document-compliance-contract.md
-- "Subject-scoped ownership" — driver_document_lineages_subject_shape_check enforces this
-- exactly, so a DRIVER_LICENSE lineage can never carry a vehicle_id, etc.):
--   DRIVER_LICENSE  = DRIVER only
--   TAXI_OSAGO      = VEHICLE only
--   TAXI_REGISTRY   = VEHICLE only
--   WAYBILL         = DRIVER + VEHICLE + SHIFT
--   MEDICAL_CHECK   = DRIVER + SHIFT
--
-- PINNED-IDENTITY COMPOSITE FKs (the whole point of this rebuild): WAYBILL and MEDICAL_CHECK
-- now bind to a REAL driver_shift row, with the database — not just application code —
-- proving the pinned tuple is internally consistent, mirroring EXACTLY how migration 0006
-- itself proved (assignment_id, driver_id, vehicle_id) against vehicle_driver_assignments —
-- the same discipline, one level up:
--
--   WAYBILL:       (shift_id, driver_id, vehicle_id) must reference the SAME driver_shift row
--   MEDICAL_CHECK: (shift_id, driver_id)             must reference the SAME driver_shift row
--
-- driver_shift's own PK is `id` alone — there is no existing composite unique key that a
-- (shift_id, driver_id[, vehicle_id]) FK could target, so this migration ADDS two new,
-- purely-additive composite UNIQUE constraints to driver_shift (via a DO-block guard,
-- exactly mirroring how 0006 itself added `vehicle_driver_assignments_id_driver_vehicle_uq`
-- onto the already-existing, already-merged 0005 table without touching migration 0005):
--   driver_shift_id_driver_uq          UNIQUE (id, driver_id)              — MEDICAL_CHECK's FK target
--   driver_shift_id_driver_vehicle_uq  UNIQUE (id, driver_id, vehicle_id)  — WAYBILL's FK target
-- Both are trivially satisfied by any existing data (id is already globally unique via the
-- PK) — zero-risk, purely additive.
--
-- Two composite FKs are declared on driver_document_lineages, using PostgreSQL's default
-- MATCH SIMPLE semantics (a composite FK is not checked at all if ANY of its columns is
-- NULL) so ONE pair of FKs correctly covers every document_type without a CASE/trigger:
--   driver_document_lineages_shift_driver_fkey          (shift_id, driver_id)             -- fires only when shift_id+driver_id are both set: WAYBILL and MEDICAL_CHECK
--   driver_document_lineages_shift_driver_vehicle_fkey  (shift_id, driver_id, vehicle_id) -- fires only when all three are set: WAYBILL only (MEDICAL_CHECK's vehicle_id is NULL by the subject-shape CHECK, so this FK is silently skipped for it — the narrower 2-column FK above is what actually protects MEDICAL_CHECK)
-- DRIVER_LICENSE/TAXI_OSAGO/TAXI_REGISTRY rows always have shift_id NULL (subject-shape
-- CHECK), so both composite FKs are always skipped for them — never a spurious failure.
--
-- UNIQUENESS — type-specific partial unique indexes, NOT the old #956 UNIQUE(driver_id,
-- document_type) (which cannot express a vehicle-scoped or shift-scoped subject and blocks
-- multiple shift instances). "At most one lineage per subject tuple per type":
--   DRIVER_LICENSE -> unique on (driver_id)                        WHERE document_type = 'DRIVER_LICENSE'
--   TAXI_OSAGO     -> unique on (vehicle_id)                       WHERE document_type = 'TAXI_OSAGO'
--   TAXI_REGISTRY  -> unique on (vehicle_id)                       WHERE document_type = 'TAXI_REGISTRY'
--   WAYBILL        -> unique on (driver_id, vehicle_id, shift_id)  WHERE document_type = 'WAYBILL'
--   MEDICAL_CHECK  -> unique on (driver_id, shift_id)              WHERE document_type = 'MEDICAL_CHECK'
--
-- driver_documents is the versioned submission-attempt history — NEVER mutated into
-- history-loss (no row is ever reused across an upload, per the frozen contract's
-- "Submission lineage and renewal handling"). MISSING is the ABSENCE of any row for a
-- lineage — never a stored value — mirroring driver_shift's own "NONE is absence, not a
-- stored value" convention (docs/driver-shift-authority-contract.md "State machine").
-- Stored statuses, exactly: UPLOADED, VERIFYING, APPROVED, VALID, EXPIRING, REJECTED,
-- EXPIRED, SUPERSEDED, REVOKED.
--
-- HARD INVARIANTS, DB-enforced (structural/subject-identity correctness ONLY — see the
-- explicit non-goal note below):
--   - lineage identity is immutable after INSERT: id/document_type/driver_id/vehicle_id/
--     shift_id/created_at cannot be rewritten (named BEFORE UPDATE guard below)
--   - submission creation identity is immutable after INSERT: id/lineage_id/object_key/
--     issued_at/created_at cannot be rewritten; lifecycle fields remain mutable
--   - at most one OPEN submission per lineage, WHERE status IN ('UPLOADED','VERIFYING',
--     'APPROVED') — a partial unique index, mirroring driver_shift's own
--     one-OPEN-per-driver/vehicle partial-unique-index pattern exactly
--     (driver_documents_one_open_per_lineage_uq)
--   - supersedes_id, when non-null, is UNIQUE (a plain column-level UNIQUE — PostgreSQL
--     treats multiple NULLs as distinct, so this is "at most one successor claims a given
--     predecessor" with zero special-casing needed for the common NULL case)
--   - lineage_id FK -> driver_document_lineages.id, RESTRICT (history must survive)
--   - supersedes_id FK -> driver_documents.id, RESTRICT (no cascade can silently delete
--     history)
--   - closing a shift (driver_shift OPEN -> CLOSED) cannot delete or orphan any
--     document_lineages/documents row: closing a shift is a plain UPDATE of driver_shift's
--     status/closed_at/close_reason columns, never its id/driver_id/vehicle_id (those are
--     immutable, guarded by trg_driver_shift_guard_immutability, migration 0006) — the exact
--     columns this migration's composite FKs reference NEVER change on close, so there is
--     structurally nothing for a close to cascade into. Proven adversarially in
--     server/test/driver-document-compliance.test.mjs (open a shift, attach a WAYBILL,
--     close the shift, assert the WAYBILL lineage/document rows are byte-for-byte
--     untouched).
--
-- EXPLICIT NON-GOAL (per this slice's own scope): "only accept a new shift-scoped
-- submission while driver_shift.status = OPEN" is a DYNAMIC, transaction-time authorization
-- decision — it is NOT expressed here as a static FK/CHECK (a CLOSED shift's id/driver_id/
-- vehicle_id are still perfectly valid, immutable values to reference for HISTORY purposes;
-- whether a NEW submission may still be created against it is a service-layer, 01C-or-later
-- concern). This migration proves referential/subject-identity correctness only.
-- Likewise, supersedes_id is a plain nullable+unique column here with NO CHECK coupling it
-- to `status` (e.g. "supersedes_id is null unless status = VALID") — that coupling is a
-- write-time activation-transaction invariant (docs/driver-document-compliance-contract.md,
-- "Approval vs. activation"), not a schema-level constraint this slice enforces.
--
-- IDEMPOTENCY (server-ci re-applies every migration, twice, per run): CREATE TABLE / INDEX
-- IF NOT EXISTS, DO-block guards for the two additive driver_shift constraints,
-- CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS + CREATE TRIGGER — a second apply is a
-- clean no-op, matching 0001-0006's convention exactly. Wrapped in BEGIN/COMMIT.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Additive composite keys on driver_shift (0006) — purely additive FK targets for the two
-- composite FKs below. Coexist with 0006's own driver_shift_assignment_driver_vehicle_fkey
-- and the two partial unique indexes (all untouched). Zero-risk: `id` is already globally
-- unique via driver_shift_pkey, so `id` + anything is trivially unique too.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'driver_shift_id_driver_uq'
  ) THEN
    ALTER TABLE driver_shift
      ADD CONSTRAINT driver_shift_id_driver_uq UNIQUE (id, driver_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'driver_shift_id_driver_vehicle_uq'
  ) THEN
    ALTER TABLE driver_shift
      ADD CONSTRAINT driver_shift_id_driver_vehicle_uq UNIQUE (id, driver_id, vehicle_id);
  END IF;
END $$;

-- =============================================================================
-- 15. driver_document_lineages
-- target entity per docs/driver-document-compliance-contract.md "Submission lineage and
-- renewal handling" — the IMMUTABLE subject identity a document history belongs to.
-- -----------------------------------------------------------------------------
-- One row = one (document_type, exact subject tuple). Never rewritten after creation
-- (no updated_at: nothing about a lineage row ever mutates — see file header).
-- =============================================================================
CREATE TABLE IF NOT EXISTS driver_document_lineages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- the five canonical types (docs/driver-document-compliance-contract.md "Initial document
  -- types"). TEXT + named-set CHECK (not a native enum), matching driver_shift.close_reason's
  -- own "a later, explicitly-scoped migration can extend the vocabulary" rationale.
  document_type  TEXT NOT NULL
                   CHECK (document_type IN (
                     'DRIVER_LICENSE', 'TAXI_OSAGO', 'TAXI_REGISTRY', 'WAYBILL', 'MEDICAL_CHECK'
                   )),
  -- present when the type's subject scope includes DRIVER (DRIVER_LICENSE, WAYBILL,
  -- MEDICAL_CHECK); RESTRICT — a lineage is audit history and must never be silently
  -- orphaned by a user delete (mirrors vehicle_driver_assignments/driver_shift's own choice).
  driver_id      UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- present when the type's subject scope includes VEHICLE (TAXI_OSAGO, TAXI_REGISTRY,
  -- WAYBILL); same RESTRICT audit-integrity reasoning.
  vehicle_id     UUID NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  -- present when the type's subject scope includes SHIFT (WAYBILL, MEDICAL_CHECK) — a REAL
  -- FK to driver_shift.id, proven consistent with driver_id/vehicle_id by the two composite
  -- FKs below. No standalone single-column FK to driver_shift(id) alone is declared: every
  -- document_type that ever sets shift_id also sets driver_id (subject-shape CHECK below),
  -- so the composite driver_document_lineages_shift_driver_fkey already proves shift_id
  -- existence on every row where it matters — a redundant standalone FK would add nothing
  -- a strictly-stronger composite FK doesn't already guarantee (mirrors driver_shift's own
  -- "no standalone FK to vehicle_driver_assignments(id) alone" reasoning, 0006).
  shift_id       UUID NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Subject scope per document_type, frozen exactly (docs/driver-document-compliance-
  -- contract.md "Subject-scoped ownership"): a DRIVER_LICENSE lineage can never carry a
  -- vehicle_id or shift_id, etc. "Subjects not required by a document type are absent, not
  -- null-filled placeholders" — this CHECK makes that structurally unrepresentable.
  CONSTRAINT driver_document_lineages_subject_shape_check CHECK (
    (document_type = 'DRIVER_LICENSE' AND driver_id IS NOT NULL AND vehicle_id IS NULL     AND shift_id IS NULL)
    OR (document_type = 'TAXI_OSAGO'    AND driver_id IS NULL     AND vehicle_id IS NOT NULL AND shift_id IS NULL)
    OR (document_type = 'TAXI_REGISTRY' AND driver_id IS NULL     AND vehicle_id IS NOT NULL AND shift_id IS NULL)
    OR (document_type = 'WAYBILL'       AND driver_id IS NOT NULL AND vehicle_id IS NOT NULL AND shift_id IS NOT NULL)
    OR (document_type = 'MEDICAL_CHECK' AND driver_id IS NOT NULL AND vehicle_id IS NULL     AND shift_id IS NOT NULL)
  ),

  -- MEDICAL_CHECK's pinned-identity proof: (shift_id, driver_id) must belong to the SAME
  -- driver_shift row. MATCH SIMPLE (default): skipped whenever shift_id OR driver_id is
  -- NULL, so this only ever fires for WAYBILL/MEDICAL_CHECK rows (the only types with both
  -- set) — never a spurious failure for DRIVER_LICENSE/TAXI_OSAGO/TAXI_REGISTRY.
  CONSTRAINT driver_document_lineages_shift_driver_fkey
    FOREIGN KEY (shift_id, driver_id)
    REFERENCES driver_shift (id, driver_id)
    ON DELETE RESTRICT,
  -- WAYBILL's stronger pinned-identity proof: (shift_id, driver_id, vehicle_id) must belong
  -- to the SAME driver_shift row. Skipped whenever any of the three is NULL — fires only for
  -- WAYBILL (the only type with all three set); MEDICAL_CHECK's vehicle_id is always NULL
  -- (subject-shape CHECK), so this composite FK never applies to it — the 2-column FK above
  -- is what protects MEDICAL_CHECK instead.
  CONSTRAINT driver_document_lineages_shift_driver_vehicle_fkey
    FOREIGN KEY (shift_id, driver_id, vehicle_id)
    REFERENCES driver_shift (id, driver_id, vehicle_id)
    ON DELETE RESTRICT
);

-- Immutable lineage identity is a DB invariant, not application discipline. A CHECK cannot
-- compare OLD and NEW, so a named BEFORE UPDATE guard mirrors driver_shift's own immutability
-- pattern from migration 0006. Idempotent re-saves of unchanged values remain valid.
CREATE OR REPLACE FUNCTION driver_document_lineages_guard_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.document_type IS DISTINCT FROM OLD.document_type
     OR NEW.driver_id IS DISTINCT FROM OLD.driver_id
     OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
     OR NEW.shift_id IS DISTINCT FROM OLD.shift_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'driver_document_lineage % identity is immutable', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_driver_document_lineages_guard_immutability ON driver_document_lineages;
CREATE TRIGGER trg_driver_document_lineages_guard_immutability
  BEFORE UPDATE ON driver_document_lineages FOR EACH ROW
  EXECUTE FUNCTION driver_document_lineages_guard_immutability();

-- "At most one lineage per subject tuple per type" — type-specific partial unique indexes,
-- correctly NULL-aware under PostgreSQL semantics. Deliberately NOT the old #956
-- UNIQUE(driver_id, document_type) model (see file header): that shape cannot express a
-- vehicle-scoped subject at all, and cannot allow two DIFFERENT shift instances to each
-- carry their own independent WAYBILL/MEDICAL_CHECK lineage.
CREATE UNIQUE INDEX IF NOT EXISTS driver_document_lineages_driver_license_uq
  ON driver_document_lineages (driver_id) WHERE document_type = 'DRIVER_LICENSE';
CREATE UNIQUE INDEX IF NOT EXISTS driver_document_lineages_taxi_osago_uq
  ON driver_document_lineages (vehicle_id) WHERE document_type = 'TAXI_OSAGO';
CREATE UNIQUE INDEX IF NOT EXISTS driver_document_lineages_taxi_registry_uq
  ON driver_document_lineages (vehicle_id) WHERE document_type = 'TAXI_REGISTRY';
CREATE UNIQUE INDEX IF NOT EXISTS driver_document_lineages_waybill_uq
  ON driver_document_lineages (driver_id, vehicle_id, shift_id) WHERE document_type = 'WAYBILL';
CREATE UNIQUE INDEX IF NOT EXISTS driver_document_lineages_medical_check_uq
  ON driver_document_lineages (driver_id, shift_id) WHERE document_type = 'MEDICAL_CHECK';

-- Lookup indexes (history/read paths) — mirror 0005/0006's own idx_*_driver_status /
-- idx_*_vehicle_status convention. Partial (WHERE ... IS NOT NULL) since each column is
-- only ever populated for a subset of document types.
CREATE INDEX IF NOT EXISTS idx_driver_document_lineages_driver
  ON driver_document_lineages (driver_id) WHERE driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_driver_document_lineages_vehicle
  ON driver_document_lineages (vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_driver_document_lineages_shift
  ON driver_document_lineages (shift_id) WHERE shift_id IS NOT NULL;

-- =============================================================================
-- 16. driver_documents
-- target entity per docs/driver-document-compliance-contract.md "driver_documents" — one row
-- per upload/submission ATTEMPT, versioned, never mutated into history-loss.
-- -----------------------------------------------------------------------------
-- A change to the document itself (a new photo, a corrected date, a renewal) never rewrites
-- an existing row's lineage_id or subject tuple (there is none here — subject identity lives
-- on driver_document_lineages) — it is always a NEW row in the same lineage.
-- =============================================================================
CREATE TABLE IF NOT EXISTS driver_documents (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- which lineage (subject identity) this submission attempt belongs to. RESTRICT: history
  -- must survive — a lineage can never be silently deleted out from under its submissions.
  lineage_id           UUID NOT NULL REFERENCES driver_document_lineages (id) ON DELETE RESTRICT,
  -- canonical stored statuses (docs/driver-document-compliance-contract.md "Verification
  -- state machine"). MISSING is deliberately absent from this set — it is the ABSENCE of any
  -- row for a lineage, never a stored value (mirrors driver_shift's NONE-is-absence
  -- convention). Defaults to UPLOADED: "MISSING -> UPLOADED creates a lineage's first row."
  status               TEXT NOT NULL DEFAULT 'UPLOADED'
                         CHECK (status IN (
                           'UPLOADED', 'VERIFYING', 'APPROVED', 'VALID', 'EXPIRING',
                           'REJECTED', 'EXPIRED', 'SUPERSEDED', 'REVOKED'
                         )),
  -- write-once null -> priorEffective.id, set only at the moment this row is atomically
  -- ACTIVATED as the lineage's new effective version (contract "Approval vs. activation") —
  -- that activation transaction is explicitly OUT of scope for this schema-only slice (see
  -- file header "EXPLICIT NON-GOAL"). UNIQUE (nullable — multiple NULLs are fine under
  -- standard PostgreSQL UNIQUE semantics): "one prior record can have at most one successful
  -- successor." RESTRICT: a document that was superseded remains readable history forever.
  supersedes_id        UUID NULL UNIQUE REFERENCES driver_documents (id) ON DELETE RESTRICT,
  -- opaque external evidence reference (upload/object-storage wiring is a LATER slice, 01C —
  -- this column only reserves the field named by the frozen 01A contract).
  object_key           TEXT NULL,
  issued_at            TIMESTAMPTZ NULL,
  valid_from           TIMESTAMPTZ NULL,
  valid_until          TIMESTAMPTZ NULL,
  verified_at          TIMESTAMPTZ NULL,
  verification_source  TEXT NULL,
  verification_reason  TEXT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "At most one OPEN submission per lineage" — an initial hard invariant (contract
-- "Submission lineage and renewal handling"). open = UPLOADED, VERIFYING, or APPROVED (a
-- future-dated APPROVED renewal waiting to activate counts as open; an already-effective
-- VALID/EXPIRING row does not). Mirrors driver_shift_one_open_per_driver_uq /
-- driver_shift_one_open_per_vehicle_uq's exact partial-unique-index pattern.
CREATE UNIQUE INDEX IF NOT EXISTS driver_documents_one_open_per_lineage_uq
  ON driver_documents (lineage_id) WHERE status IN ('UPLOADED', 'VERIFYING', 'APPROVED');

-- Lookup index (history/read paths) — mirrors 0005/0006's own convention.
CREATE INDEX IF NOT EXISTS idx_driver_documents_lineage_status
  ON driver_documents (lineage_id, status);

-- A submission's creation identity is immutable, while lifecycle fields are deliberately
-- mutable in place. This guard runs BEFORE the updated_at trigger because PostgreSQL orders
-- same-kind triggers alphabetically: "...guard_immutability" sorts before "...updated_at".
CREATE OR REPLACE FUNCTION driver_documents_guard_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.lineage_id IS DISTINCT FROM OLD.lineage_id
     OR NEW.object_key IS DISTINCT FROM OLD.object_key
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'driver_document % creation identity is immutable', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_driver_documents_guard_immutability ON driver_documents;
CREATE TRIGGER trg_driver_documents_guard_immutability
  BEFORE UPDATE ON driver_documents FOR EACH ROW
  EXECUTE FUNCTION driver_documents_guard_immutability();

DROP TRIGGER IF EXISTS trg_driver_documents_updated_at ON driver_documents;
CREATE TRIGGER trg_driver_documents_updated_at
  BEFORE UPDATE ON driver_documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
