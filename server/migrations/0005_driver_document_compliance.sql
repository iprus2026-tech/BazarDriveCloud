-- =============================================================================
-- /server/migrations/0005_driver_document_compliance.sql
-- BD-DRIVER-DOCUMENT-COMPLIANCE-01B — PostgreSQL foundation (#955)
--
-- This migration introduces the server-owned metadata/state record for driver
-- compliance documents. It deliberately does NOT add document upload, object
-- storage access, a verifier worker, audit events, or Availability enforcement.
-- Those capabilities belong to later slices 01C+.
--
-- `MISSING` is not persisted. An absent `(driver_id, document_type)` row is
-- synthesized as MISSING by the read projection. This keeps absence distinct
-- from evidence that was uploaded, checked, rejected, or expired.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS driver_documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type       TEXT NOT NULL,
  status              TEXT NOT NULL,
  valid_from          TIMESTAMPTZ(6) NULL,
  valid_until         TIMESTAMPTZ(6) NULL,
  issued_at           TIMESTAMPTZ(6) NULL,
  verified_at         TIMESTAMPTZ(6) NULL,
  verification_source TEXT NULL,
  verification_reason TEXT NULL,
  object_key          TEXT NULL,
  created_at          TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  updated_at          TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT driver_documents_driver_type_uq
    UNIQUE (driver_id, document_type),

  CONSTRAINT driver_documents_document_type_check CHECK (
    document_type IN (
      'DRIVER_LICENSE', 'TAXI_OSAGO', 'TAXI_REGISTRY',
      'WAYBILL', 'MEDICAL_CHECK'
    )
  ),

  CONSTRAINT driver_documents_status_check CHECK (
    status IN (
      'UPLOADED', 'VERIFYING', 'VALID',
      'EXPIRING', 'REJECTED', 'EXPIRED'
    )
  ),

  CONSTRAINT driver_documents_validity_range_check CHECK (
    valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from
  ),

  -- A short-lived shift credential can never become ready without an explicit
  -- end of validity. The domain projection repeats this rule fail-closed so a
  -- malformed legacy/import row cannot grant readiness even if constraints are
  -- temporarily bypassed by privileged maintenance.
  CONSTRAINT driver_documents_shift_validity_check CHECK (
    document_type NOT IN ('WAYBILL', 'MEDICAL_CHECK')
    OR status NOT IN ('VALID', 'EXPIRING')
    OR valid_until IS NOT NULL
  ),

  CONSTRAINT driver_documents_expiring_validity_check CHECK (
    status <> 'EXPIRING' OR valid_until IS NOT NULL
  ),

  -- Server-authoritative outcomes must carry when and by which verifier/source
  -- the decision was produced. Pending upload/verification rows may omit it.
  CONSTRAINT driver_documents_authoritative_metadata_check CHECK (
    status NOT IN ('VALID', 'EXPIRING', 'REJECTED', 'EXPIRED')
    OR (
      verified_at IS NOT NULL
      AND verification_source IS NOT NULL
      AND length(btrim(verification_source)) BETWEEN 1 AND 100
    )
  ),

  CONSTRAINT driver_documents_rejected_reason_check CHECK (
    status <> 'REJECTED'
    OR (
      verification_reason IS NOT NULL
      AND length(btrim(verification_reason)) BETWEEN 1 AND 1000
    )
  ),

  CONSTRAINT driver_documents_source_shape_check CHECK (
    verification_source IS NULL
    OR length(btrim(verification_source)) BETWEEN 1 AND 100
  ),

  CONSTRAINT driver_documents_reason_shape_check CHECK (
    verification_reason IS NULL
    OR length(btrim(verification_reason)) BETWEEN 1 AND 1000
  ),

  CONSTRAINT driver_documents_object_key_shape_check CHECK (
    object_key IS NULL OR length(btrim(object_key)) BETWEEN 1 AND 1024
  )
);

-- Object references are sensitive capability-adjacent metadata. 01B stores only
-- the opaque key and prevents accidental reuse; the authorized upload/read path
-- is deferred to 01C.
CREATE UNIQUE INDEX IF NOT EXISTS driver_documents_object_key_uq
  ON driver_documents (object_key)
  WHERE object_key IS NOT NULL;

-- Supports the future expiry sweep without scanning every driver record.
CREATE INDEX IF NOT EXISTS idx_driver_documents_expiry
  ON driver_documents (valid_until, driver_id)
  WHERE status IN ('VALID', 'EXPIRING') AND valid_until IS NOT NULL;

DROP TRIGGER IF EXISTS trg_driver_documents_updated_at ON driver_documents;
CREATE TRIGGER trg_driver_documents_updated_at
  BEFORE UPDATE ON driver_documents FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMIT;
