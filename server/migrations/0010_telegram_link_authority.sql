-- BD-TELEGRAM-ASSISTANT-01B: dark Telegram account-link foundation.
-- No HTTP, webhook registration, external_contact_identities or business writes.
-- 0008 stays reserved. 0010 is a local candidate slot; recheck before publication.
BEGIN;

-- The request's account must be the account of the authenticating session.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'auth_session'::regclass AND conname = 'auth_session_id_user_uq') THEN
    ALTER TABLE auth_session ADD CONSTRAINT auth_session_id_user_uq UNIQUE (id, user_id);
  END IF;
END $$;

CREATE SEQUENCE IF NOT EXISTS telegram_link_epoch_seq;

CREATE TABLE IF NOT EXISTS telegram_link_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id TEXT NOT NULL CHECK (bot_id ~ '^[1-9][0-9]{0,15}$'),
  environment TEXT NOT NULL CHECK (environment ~ '^[a-z][a-z0-9_-]{0,31}$'),
  account_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  session_id UUID NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  comparison_code TEXT NOT NULL CHECK (comparison_code ~ '^[0-9]{6}$'),
  state TEXT NOT NULL DEFAULT 'PENDING',
  candidate_id TEXT NULL CHECK (candidate_id ~ '^[1-9][0-9]{0,15}$'),
  failed_confirms INTEGER NOT NULL DEFAULT 0 CHECK (failed_confirms BETWEEN 0 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ NULL,
  CONSTRAINT telegram_requests_session_account_fk
    FOREIGN KEY (session_id, account_id) REFERENCES auth_session(id, user_id) ON DELETE RESTRICT,
  CONSTRAINT telegram_requests_lifecycle_ck CHECK (
    (state = 'PENDING' AND candidate_id IS NULL AND confirmed_at IS NULL) OR
    (state = 'CLAIMED' AND candidate_id IS NOT NULL AND confirmed_at IS NULL) OR
    (state = 'CONFIRMED' AND candidate_id IS NOT NULL AND confirmed_at IS NOT NULL) OR
    (state IN ('EXPIRED', 'CANCELED') AND confirmed_at IS NULL)
  ),
  CONSTRAINT telegram_requests_time_ck CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '5 minutes'
    AND (confirmed_at IS NULL OR (confirmed_at >= created_at AND confirmed_at < expires_at))
  )
);
CREATE INDEX IF NOT EXISTS telegram_requests_account_time_idx
  ON telegram_link_requests(bot_id, environment, account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS telegram_account_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE REFERENCES telegram_link_requests(id) ON DELETE RESTRICT,
  bot_id TEXT NOT NULL CHECK (bot_id ~ '^[1-9][0-9]{0,15}$'),
  environment TEXT NOT NULL CHECK (environment ~ '^[a-z][a-z0-9_-]{0,31}$'),
  account_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  session_id UUID NOT NULL,
  telegram_user_id TEXT NOT NULL CHECK (telegram_user_id ~ '^[1-9][0-9]{0,15}$'),
  private_chat_id TEXT NOT NULL,
  epoch BIGINT NOT NULL DEFAULT nextval('telegram_link_epoch_seq') CHECK (epoch > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  grant_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  CONSTRAINT telegram_links_session_account_fk
    FOREIGN KEY (session_id, account_id) REFERENCES auth_session(id, user_id) ON DELETE RESTRICT,
  CONSTRAINT telegram_links_private_chat_ck CHECK (private_chat_id = telegram_user_id),
  CONSTRAINT telegram_links_lifecycle_ck CHECK (
    (status = 'ACTIVE' AND revoked_at IS NULL) OR
    (status = 'REVOKED' AND revoked_at IS NOT NULL AND revoked_at >= confirmed_at)
  ),
  CONSTRAINT telegram_links_time_ck CHECK (
    grant_expires_at > confirmed_at AND grant_expires_at <= confirmed_at + interval '24 hours'
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS telegram_links_active_account_uq
  ON telegram_account_links(bot_id, environment, account_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS telegram_links_active_actor_uq
  ON telegram_account_links(bot_id, environment, telegram_user_id) WHERE status = 'ACTIVE';

-- Audit is transactional, not an application log. No nonce, bearer or provider payload.
-- actor_hash is used only for a durable per-actor claim throttle.
CREATE TABLE IF NOT EXISTS telegram_link_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  request_id UUID NULL REFERENCES telegram_link_requests(id) ON DELETE RESTRICT,
  link_id UUID NULL REFERENCES telegram_account_links(id) ON DELETE RESTRICT,
  authorizing_session_id UUID NULL REFERENCES auth_session(id) ON DELETE RESTRICT,
  actor_hash TEXT NULL CHECK (actor_hash ~ '^[a-f0-9]{64}$'),
  action TEXT NOT NULL CHECK (action IN (
    'REQUESTED', 'CLAIM_ATTEMPT', 'CLAIMED', 'CONFIRM_REJECTED', 'CONFIRMED', 'REVOKED', 'CANCELED', 'EXPIRED'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS telegram_audit_claim_rate_idx
  ON telegram_link_audit(bot_id, environment, actor_hash, created_at DESC)
  WHERE action = 'CLAIM_ATTEMPT';

CREATE OR REPLACE FUNCTION telegram_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.bot_id, NEW.environment, NEW.account_id, NEW.session_id, NEW.token_hash,
      NEW.comparison_code, NEW.created_at, NEW.expires_at) IS DISTINCT FROM
     (OLD.id, OLD.bot_id, OLD.environment, OLD.account_id, OLD.session_id, OLD.token_hash,
      OLD.comparison_code, OLD.created_at, OLD.expires_at)
     OR (OLD.candidate_id IS NOT NULL AND NEW.candidate_id IS DISTINCT FROM OLD.candidate_id)
     OR NEW.failed_confirms < OLD.failed_confirms THEN
    RAISE EXCEPTION 'telegram request immutable identity violation' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state IN ('CONFIRMED', 'EXPIRED', 'CANCELED') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'telegram request is terminal' USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.state = 'PENDING' AND NEW.state NOT IN ('PENDING', 'CLAIMED', 'EXPIRED', 'CANCELED'))
     OR (OLD.state = 'CLAIMED' AND NEW.state NOT IN ('CLAIMED', 'CONFIRMED', 'EXPIRED', 'CANCELED')) THEN
    RAISE EXCEPTION 'telegram request invalid transition' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS telegram_requests_guard ON telegram_link_requests;
CREATE TRIGGER telegram_requests_guard BEFORE UPDATE ON telegram_link_requests
  FOR EACH ROW EXECUTE FUNCTION telegram_request_guard();

CREATE OR REPLACE FUNCTION telegram_link_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r telegram_link_requests%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO r FROM telegram_link_requests WHERE id = NEW.request_id FOR UPDATE;
    IF r.id IS NULL OR r.state <> 'CONFIRMED'
       OR (NEW.bot_id, NEW.environment, NEW.account_id, NEW.session_id, NEW.telegram_user_id,
           NEW.confirmed_at) IS DISTINCT FROM
          (r.bot_id, r.environment, r.account_id, r.session_id, r.candidate_id, r.confirmed_at) THEN
      RAISE EXCEPTION 'telegram link requires exact confirmed request' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF (NEW.id, NEW.request_id, NEW.bot_id, NEW.environment, NEW.account_id, NEW.session_id,
        NEW.telegram_user_id, NEW.private_chat_id, NEW.confirmed_at, NEW.grant_expires_at) IS DISTINCT FROM
       (OLD.id, OLD.request_id, OLD.bot_id, OLD.environment, OLD.account_id, OLD.session_id,
        OLD.telegram_user_id, OLD.private_chat_id, OLD.confirmed_at, OLD.grant_expires_at)
       OR (OLD.status = 'REVOKED' AND NEW IS DISTINCT FROM OLD)
       OR (OLD.status = 'ACTIVE' AND NEW.status = 'ACTIVE' AND NEW.epoch <> OLD.epoch)
       OR (NEW.status = 'REVOKED' AND OLD.status = 'ACTIVE' AND NEW.epoch <= OLD.epoch) THEN
      RAISE EXCEPTION 'telegram link immutable authority violation' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS telegram_links_guard ON telegram_account_links;
CREATE TRIGGER telegram_links_guard BEFORE INSERT OR UPDATE ON telegram_account_links
  FOR EACH ROW EXECUTE FUNCTION telegram_link_guard();

CREATE OR REPLACE FUNCTION telegram_audit_no_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'telegram link audit is append only' USING ERRCODE = 'check_violation';
END $$;
DROP TRIGGER IF EXISTS telegram_audit_append_only ON telegram_link_audit;
CREATE TRIGGER telegram_audit_append_only BEFORE UPDATE OR DELETE ON telegram_link_audit
  FOR EACH ROW EXECUTE FUNCTION telegram_audit_no_mutation();
COMMIT;
