-- =============================================================================
-- /server/migrations/0009_merchant_identity_contact_authority.sql
-- BD-MERCHANT-IDENTITY-CONTACT-AUTHORITY-01B — PostgreSQL authority foundation (#977)
--
-- SQL realization of the FROZEN contract:
--   docs/merchant-identity-contact-authority-contract.md
--   (Issue #975, PR #976, merged as 4eaba5264ac7d0855c9dd8473bdfa175660f2830)
--
-- IMPORTANT NUMBERING: 0008 is intentionally reserved by the frozen vehicle block-state
-- authority contract. This migration is 0009 and MUST NOT create/rename/repurpose 0008.
--
-- 01B is schema + repositories + readiness/concurrency tests + dark service seam only.
-- No HTTP/PWA/WhatsApp/Peach runtime is activated here.
-- =============================================================================

BEGIN;

-- =============================================================================
-- merchants — one BazarDrive merchant account; not a users.role.
-- =============================================================================
CREATE TABLE IF NOT EXISTS merchants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'SUSPENDED',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT merchants_display_name_check CHECK (length(btrim(display_name)) > 0),
  CONSTRAINT merchants_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED'))
);

CREATE OR REPLACE FUNCTION merchants_guard_lifecycle()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- An ACTIVE merchant is never born without an ADMIN. Bootstrap therefore inserts the
  -- merchant SUSPENDED, establishes the first ADMIN, then activates inside one trusted tx.
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'ACTIVE' THEN
      RAISE EXCEPTION 'merchant bootstrap violation: ACTIVE requires an existing ADMIN membership'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'CLOSED' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'merchant lifecycle violation: CLOSED is terminal'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'merchant lifecycle violation: created_at is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'ACTIVE' AND OLD.status IS DISTINCT FROM 'ACTIVE'
     AND NOT EXISTS (
       SELECT 1 FROM merchant_memberships mm
        WHERE mm.merchant_id = NEW.id
          AND mm.status = 'ACTIVE'
          AND mm.membership_role = 'ADMIN'
     ) THEN
    RAISE EXCEPTION 'merchant bootstrap violation: activation requires an ACTIVE ADMIN membership'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_merchants_guard_lifecycle ON merchants;
CREATE TRIGGER trg_merchants_guard_lifecycle
  BEFORE INSERT OR UPDATE ON merchants FOR EACH ROW EXECUTE FUNCTION merchants_guard_lifecycle();

DROP TRIGGER IF EXISTS trg_merchants_updated_at ON merchants;
CREATE TRIGGER trg_merchants_updated_at
  BEFORE UPDATE ON merchants FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- merchant_memberships — merchant-scoped authorization for existing users(id).
-- ACTIVE -> REVOKED is terminal for one row; a re-grant is a NEW row.
-- =============================================================================
CREATE TABLE IF NOT EXISTS merchant_memberships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     UUID NOT NULL,
  user_id         UUID NOT NULL,
  membership_role TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ACTIVE',
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT merchant_memberships_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_memberships_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_memberships_role_check
    CHECK (membership_role IN ('ADMIN', 'OPERATOR')),
  CONSTRAINT merchant_memberships_status_check
    CHECK (status IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT merchant_memberships_lifecycle_check CHECK (
    (status = 'ACTIVE' AND revoked_at IS NULL)
    OR
    (status = 'REVOKED' AND revoked_at IS NOT NULL AND revoked_at >= granted_at)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS merchant_memberships_one_active_per_user_uq
  ON merchant_memberships (merchant_id, user_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_merchant_memberships_user_status
  ON merchant_memberships (user_id, status);
CREATE INDEX IF NOT EXISTS idx_merchant_memberships_merchant_status
  ON merchant_memberships (merchant_id, status);

CREATE OR REPLACE FUNCTION merchant_memberships_guard_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  merchant_state TEXT;
BEGIN
  -- Hard-delete is not a lifecycle operation, but it must not bypass the frozen last-ADMIN
  -- invariant while a merchant is ACTIVE. Closed/suspended test/maintenance cleanup remains
  -- possible; production business paths use REVOKED history rows, not DELETE.
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'ACTIVE' AND OLD.membership_role = 'ADMIN' THEN
      SELECT status INTO merchant_state
        FROM merchants
       WHERE id = OLD.merchant_id
       FOR UPDATE;
      IF merchant_state = 'ACTIVE'
         AND NOT EXISTS (
           SELECT 1 FROM merchant_memberships mm
            WHERE mm.merchant_id = OLD.merchant_id
              AND mm.id <> OLD.id
              AND mm.status = 'ACTIVE'
              AND mm.membership_role = 'ADMIN'
         ) THEN
        RAISE EXCEPTION 'merchant membership violation: cannot remove the last ACTIVE ADMIN of an ACTIVE merchant'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.membership_role IS DISTINCT FROM OLD.membership_role
     OR NEW.granted_at IS DISTINCT FROM OLD.granted_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'merchant membership violation: pinned identity/role/timestamps are immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'REVOKED'
     AND (NEW.status IS DISTINCT FROM OLD.status
          OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'merchant membership violation: REVOKED is terminal'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'merchant membership violation: revoked_at is immutable once stamped'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Final DB backstop for the frozen last-ADMIN rule. The merchant row is the stable
  -- serialization point, so concurrent ADMIN revocations cannot both observe the other ADMIN.
  IF OLD.status = 'ACTIVE'
     AND OLD.membership_role = 'ADMIN'
     AND NEW.status = 'REVOKED' THEN
    SELECT status INTO merchant_state
      FROM merchants
     WHERE id = OLD.merchant_id
     FOR UPDATE;

    IF merchant_state = 'ACTIVE'
       AND NOT EXISTS (
         SELECT 1 FROM merchant_memberships mm
          WHERE mm.merchant_id = OLD.merchant_id
            AND mm.id <> OLD.id
            AND mm.status = 'ACTIVE'
            AND mm.membership_role = 'ADMIN'
       ) THEN
      RAISE EXCEPTION 'merchant membership violation: cannot revoke the last ACTIVE ADMIN of an ACTIVE merchant'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_merchant_memberships_guard_immutability ON merchant_memberships;
CREATE TRIGGER trg_merchant_memberships_guard_immutability
  BEFORE UPDATE OR DELETE ON merchant_memberships FOR EACH ROW
  EXECUTE FUNCTION merchant_memberships_guard_immutability();

DROP TRIGGER IF EXISTS trg_merchant_memberships_updated_at ON merchant_memberships;
CREATE TRIGGER trg_merchant_memberships_updated_at
  BEFORE UPDATE ON merchant_memberships FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- merchant_locations — persistent pickup/business locations, never recipient addresses.
-- =============================================================================
CREATE TABLE IF NOT EXISTS merchant_locations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id         UUID NOT NULL,
  label               TEXT NOT NULL,
  address_text        TEXT NOT NULL,
  lat                 NUMERIC(9,6) NULL,
  lng                 NUMERIC(9,6) NULL,
  pickup_instructions TEXT NULL,
  is_default_pickup   BOOLEAN NOT NULL DEFAULT FALSE,
  status              TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT merchant_locations_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_locations_label_check CHECK (length(btrim(label)) > 0),
  CONSTRAINT merchant_locations_address_check CHECK (length(btrim(address_text)) > 0),
  CONSTRAINT merchant_locations_pickup_instructions_length_check
    CHECK (pickup_instructions IS NULL OR length(pickup_instructions) <= 512),
  CONSTRAINT merchant_locations_status_check CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT merchant_locations_coordinates_check CHECK (
    (lat IS NULL AND lng IS NULL)
    OR
    (lat IS NOT NULL AND lng IS NOT NULL
      AND lat BETWEEN -90 AND 90
      AND lng BETWEEN -180 AND 180)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS merchant_locations_one_active_default_uq
  ON merchant_locations (merchant_id)
  WHERE status = 'ACTIVE' AND is_default_pickup = TRUE;
CREATE INDEX IF NOT EXISTS idx_merchant_locations_merchant_status
  ON merchant_locations (merchant_id, status);

CREATE OR REPLACE FUNCTION merchant_locations_guard_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'merchant location violation: merchant_id/created_at are immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'ARCHIVED' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'merchant location violation: ARCHIVED reactivation requires a future explicit policy'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_merchant_locations_guard_immutability ON merchant_locations;
CREATE TRIGGER trg_merchant_locations_guard_immutability
  BEFORE UPDATE ON merchant_locations FOR EACH ROW
  EXECUTE FUNCTION merchant_locations_guard_immutability();

DROP TRIGGER IF EXISTS trg_merchant_locations_updated_at ON merchant_locations;
CREATE TRIGGER trg_merchant_locations_updated_at
  BEFORE UPDATE ON merchant_locations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- external_contact_identities — one canonical channel-scoped external identity.
-- Channel proof != BazarDrive-user link != merchant membership.
-- =============================================================================
CREATE TABLE IF NOT EXISTS external_contact_identities (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel               TEXT NOT NULL,
  subject_namespace     TEXT NOT NULL,
  canonical_subject_key TEXT NOT NULL,
  phone_e164            TEXT NULL,
  display_name          TEXT NULL,
  status                TEXT NOT NULL DEFAULT 'ACTIVE',
  channel_proof         TEXT NOT NULL DEFAULT 'OBSERVED',
  linked_user_id        UUID NULL,
  linked_at             TIMESTAMPTZ NULL,
  revoked_at            TIMESTAMPTZ NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT external_contact_identities_linked_user_id_fkey
    FOREIGN KEY (linked_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT external_contact_identities_channel_check
    CHECK (channel IN ('WHATSAPP', 'SMS')),
  CONSTRAINT external_contact_identities_namespace_check
    CHECK (length(btrim(subject_namespace)) > 0),
  CONSTRAINT external_contact_identities_subject_key_check
    CHECK (length(btrim(canonical_subject_key)) > 0),
  CONSTRAINT external_contact_identities_phone_check
    CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT external_contact_identities_status_check
    CHECK (status IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT external_contact_identities_channel_proof_check
    CHECK (channel_proof IN ('OBSERVED', 'VERIFIED')),
  CONSTRAINT external_contact_identities_link_shape_check
    CHECK ((linked_user_id IS NULL) = (linked_at IS NULL)),
  CONSTRAINT external_contact_identities_lifecycle_check CHECK (
    (status = 'ACTIVE' AND revoked_at IS NULL)
    OR
    (status = 'REVOKED' AND revoked_at IS NOT NULL AND revoked_at >= created_at)
  ),
  CONSTRAINT external_contact_identities_canonical_uq
    UNIQUE (channel, subject_namespace, canonical_subject_key)
);

CREATE INDEX IF NOT EXISTS idx_external_contact_identities_linked_user
  ON external_contact_identities (linked_user_id) WHERE linked_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION external_contact_identities_guard_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.channel IS DISTINCT FROM OLD.channel
     OR NEW.subject_namespace IS DISTINCT FROM OLD.subject_namespace
     OR NEW.canonical_subject_key IS DISTINCT FROM OLD.canonical_subject_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'external contact identity violation: canonical identity/created_at are immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'REVOKED'
     AND (NEW.phone_e164 IS DISTINCT FROM OLD.phone_e164
          OR NEW.display_name IS DISTINCT FROM OLD.display_name
          OR NEW.status IS DISTINCT FROM OLD.status
          OR NEW.channel_proof IS DISTINCT FROM OLD.channel_proof
          OR NEW.linked_user_id IS DISTINCT FROM OLD.linked_user_id
          OR NEW.linked_at IS DISTINCT FROM OLD.linked_at
          OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'external contact identity violation: REVOKED is terminal'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.linked_user_id IS NOT NULL
     AND NEW.linked_user_id IS DISTINCT FROM OLD.linked_user_id THEN
    RAISE EXCEPTION 'external contact identity violation: linked user requires explicit recovery to change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'external contact identity violation: revoked_at is immutable once stamped'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.linked_at IS NOT NULL AND NEW.linked_at IS DISTINCT FROM OLD.linked_at THEN
    RAISE EXCEPTION 'external contact identity violation: linked_at is immutable once stamped'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.channel_proof = 'VERIFIED' AND NEW.channel_proof = 'OBSERVED' THEN
    RAISE EXCEPTION 'external contact identity violation: channel proof cannot be silently downgraded'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_external_contact_identities_guard_immutability ON external_contact_identities;
CREATE TRIGGER trg_external_contact_identities_guard_immutability
  BEFORE UPDATE ON external_contact_identities FOR EACH ROW
  EXECUTE FUNCTION external_contact_identities_guard_immutability();

DROP TRIGGER IF EXISTS trg_external_contact_identities_updated_at ON external_contact_identities;
CREATE TRIGGER trg_external_contact_identities_updated_at
  BEFORE UPDATE ON external_contact_identities FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- merchant_contact_bindings — explicit external-contact -> merchant association.
-- Binding is context, not authorization by itself.
-- =============================================================================
CREATE TABLE IF NOT EXISTS merchant_contact_bindings (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id                  UUID NOT NULL,
  external_contact_identity_id UUID NOT NULL,
  relationship                 TEXT NOT NULL DEFAULT 'CONTACT',
  status                       TEXT NOT NULL DEFAULT 'ACTIVE',
  bound_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at                   TIMESTAMPTZ NULL,
  provenance                   TEXT NOT NULL,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT merchant_contact_bindings_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_contact_bindings_external_contact_identity_id_fkey
    FOREIGN KEY (external_contact_identity_id) REFERENCES external_contact_identities(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_contact_bindings_relationship_check
    CHECK (relationship IN ('CONTACT', 'OPERATOR')),
  CONSTRAINT merchant_contact_bindings_status_check
    CHECK (status IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT merchant_contact_bindings_provenance_check
    CHECK (length(btrim(provenance)) BETWEEN 1 AND 128),
  CONSTRAINT merchant_contact_bindings_lifecycle_check CHECK (
    (status = 'ACTIVE' AND revoked_at IS NULL)
    OR
    (status = 'REVOKED' AND revoked_at IS NOT NULL AND revoked_at >= bound_at)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS merchant_contact_bindings_one_active_uq
  ON merchant_contact_bindings (merchant_id, external_contact_identity_id)
  WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_merchant_contact_bindings_identity_status
  ON merchant_contact_bindings (external_contact_identity_id, status);
CREATE INDEX IF NOT EXISTS idx_merchant_contact_bindings_merchant_status
  ON merchant_contact_bindings (merchant_id, status);

CREATE OR REPLACE FUNCTION merchant_contact_bindings_guard_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
     OR NEW.external_contact_identity_id IS DISTINCT FROM OLD.external_contact_identity_id
     OR NEW.relationship IS DISTINCT FROM OLD.relationship
     OR NEW.bound_at IS DISTINCT FROM OLD.bound_at
     OR NEW.provenance IS DISTINCT FROM OLD.provenance
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'merchant contact binding violation: pinned identity/relationship/provenance/timestamps are immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'REVOKED'
     AND (NEW.status IS DISTINCT FROM OLD.status
          OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'merchant contact binding violation: REVOKED is terminal'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'merchant contact binding violation: revoked_at is immutable once stamped'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_merchant_contact_bindings_guard_immutability ON merchant_contact_bindings;
CREATE TRIGGER trg_merchant_contact_bindings_guard_immutability
  BEFORE UPDATE ON merchant_contact_bindings FOR EACH ROW
  EXECUTE FUNCTION merchant_contact_bindings_guard_immutability();

DROP TRIGGER IF EXISTS trg_merchant_contact_bindings_updated_at ON merchant_contact_bindings;
CREATE TRIGGER trg_merchant_contact_bindings_updated_at
  BEFORE UPDATE ON merchant_contact_bindings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
