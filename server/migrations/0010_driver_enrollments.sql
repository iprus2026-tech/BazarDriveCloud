-- =============================================================================
-- /server/migrations/0010_driver_enrollments.sql
-- BD-AUTH-POLICY-01B-A - driver enrollment (#830, D1 #1042)
--
-- SQL realization of docs/driver-role-grant-contract.md section 1 (BD-AUTH-POLICY-01A):
-- one row per driver application, PENDING -> APPROVED / REJECTED, APPROVED -> REVOKED.
-- A decision changes the row and users.roles in ONE transaction
-- (server/src/services/driver-enrollment/decisions.js). This migration only creates
-- the table: no backfill, and nobody is granted anything. Accounts granted the
-- driver role by SQL before 01B-A keep it without a row.
--
-- 0008 stays reserved by the frozen vehicle block-state contract (see 0009).
-- Idempotent: server-ci applies every migration twice.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS driver_enrollments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'PENDING',
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Set by every decision; NULL exactly while PENDING.
  decided_at      TIMESTAMPTZ NULL,
  -- Non-PII actor label of the decision, e.g. 'ops-cli:<operator>' or 'auto-approve'.
  decided_by      TEXT NULL,
  decision_reason TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT driver_enrollments_status_check
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED')),
  CONSTRAINT driver_enrollments_decision_check
    CHECK ((status = 'PENDING') = (decided_at IS NULL)
       AND (status = 'PENDING') = (decided_by IS NULL)),
  CONSTRAINT driver_enrollments_decided_by_check
    CHECK (decided_by IS NULL OR length(btrim(decided_by)) BETWEEN 1 AND 200),
  CONSTRAINT driver_enrollments_reason_length_check
    CHECK (decision_reason IS NULL OR length(decision_reason) <= 500)
);

-- At most one OPEN application per account (PENDING or APPROVED). REJECTED and
-- REVOKED rows stay as history.
CREATE UNIQUE INDEX IF NOT EXISTS driver_enrollments_one_open_per_user_uq
  ON driver_enrollments (user_id)
  WHERE status IN ('PENDING', 'APPROVED');

-- The applicant's latest application (GET /api/v1/drivers/enrollment).
CREATE INDEX IF NOT EXISTS idx_driver_enrollments_user_requested
  ON driver_enrollments (user_id, requested_at DESC);

-- The operator's queue (ops:driver list).
CREATE INDEX IF NOT EXISTS idx_driver_enrollments_pending
  ON driver_enrollments (requested_at)
  WHERE status = 'PENDING';

DROP TRIGGER IF EXISTS trg_driver_enrollments_updated_at ON driver_enrollments;
CREATE TRIGGER trg_driver_enrollments_updated_at
  BEFORE UPDATE ON driver_enrollments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
