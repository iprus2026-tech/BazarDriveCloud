-- =============================================================================
-- /server/migrations/0015_auth_telegram.sql
-- BD-AUTH-TELEGRAM-01 M4 (#1127) - sign-in with Telegram Mini App initData.
--
-- SQL realization of ADR BD-DOCS-052 (docs-site/docs/decisions/telegram-initdata-sign-in.md):
--   * R1  telegram_identities: one Telegram account <-> one BazarDrive account. A row exists only
--         once the user shared their phone in the bot (R3/R4); consent is recorded with it (R9).
--   * R6/R8 auth_telegram_attempts: one row per sign-in attempt. The SHA-256 of initData `hash`
--         (only after the signature is valid) is the one-time replay store (partial UNIQUE); the
--         rows are also what the per-IP and per-Telegram-id limits count. Swept like auth_otp.
--   * R7  auth_session.auth_method: 'otp' | 'telegram'. Existing sessions are 'otp'.
-- No raw initData, no bot token and no phone is stored here (R2/R10): the phone stays in users.
--
-- Idempotent: server-ci applies every migration twice. ASCII only.
-- =============================================================================

BEGIN;

-- R7 - the method that minted a session. Same-account replacement is same-method only.
ALTER TABLE auth_session ADD COLUMN IF NOT EXISTS auth_method TEXT NOT NULL DEFAULT 'otp';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'auth_session_auth_method_check'
       AND conrelid = 'public.auth_session'::regclass
  ) THEN
    ALTER TABLE auth_session
      ADD CONSTRAINT auth_session_auth_method_check CHECK (auth_method IN ('otp', 'telegram'));
  END IF;
END;
$$;

-- R1 - the Telegram identity of an account. Telegram ids exceed 32 bits.
CREATE TABLE IF NOT EXISTS telegram_identities (
  telegram_user_id BIGINT PRIMARY KEY,
  user_id          UUID NOT NULL,
  linked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- R9 - when the contact arrived after the consent text, and which text it was.
  consented_at     TIMESTAMPTZ NOT NULL,
  consent_version  TEXT NOT NULL,
  -- Set only by the owner, by hand (R5). A revoked identity cannot sign in.
  revoked_at       TIMESTAMPTZ NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT telegram_identities_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT telegram_identities_user_id_uq UNIQUE (user_id),
  CONSTRAINT telegram_identities_telegram_user_id_check CHECK (telegram_user_id > 0),
  CONSTRAINT telegram_identities_consent_version_check
    CHECK (length(btrim(consent_version)) BETWEEN 1 AND 64)
);

-- A link never changes without the owner: the two ids and the creation stamp are immutable.
CREATE OR REPLACE FUNCTION telegram_identities_guard_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.telegram_user_id IS DISTINCT FROM OLD.telegram_user_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'telegram identity violation: telegram_user_id/user_id/created_at are immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_telegram_identities_guard_immutability ON telegram_identities;
CREATE TRIGGER trg_telegram_identities_guard_immutability
  BEFORE UPDATE ON telegram_identities FOR EACH ROW
  EXECUTE FUNCTION telegram_identities_guard_immutability();

DROP TRIGGER IF EXISTS trg_telegram_identities_updated_at ON telegram_identities;
CREATE TRIGGER trg_telegram_identities_updated_at
  BEFORE UPDATE ON telegram_identities FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- R6/R8 - sign-in attempts: the replay store and the limit counts.
CREATE TABLE IF NOT EXISTS auth_telegram_attempts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip               TEXT NULL,
  -- Set only once the signature is valid (an invalid one is counted per IP only).
  telegram_user_id BIGINT NULL,
  -- SHA-256 hex of initData `hash`, set only on the attempt that consumed it.
  init_data_hash   TEXT NULL,
  outcome          TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT auth_telegram_attempts_outcome_check CHECK (outcome IN (
    'ok', 'invalid', 'expired', 'replayed', 'no_user', 'phone_required', 'revoked', 'rate_limited'
  )),
  CONSTRAINT auth_telegram_attempts_hash_check
    CHECK (init_data_hash IS NULL OR init_data_hash ~ '^[0-9a-f]{64}$')
);

-- The one-time exchange (R6): one consuming attempt per initData.
CREATE UNIQUE INDEX IF NOT EXISTS auth_telegram_attempts_init_data_hash_uq
  ON auth_telegram_attempts (init_data_hash) WHERE init_data_hash IS NOT NULL;
-- The limit windows (R8) and the retention sweep (R6).
CREATE INDEX IF NOT EXISTS idx_auth_telegram_attempts_ip_created
  ON auth_telegram_attempts (ip, created_at DESC) WHERE ip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auth_telegram_attempts_user_created
  ON auth_telegram_attempts (telegram_user_id, created_at DESC) WHERE telegram_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auth_telegram_attempts_created
  ON auth_telegram_attempts (created_at);

COMMIT;
