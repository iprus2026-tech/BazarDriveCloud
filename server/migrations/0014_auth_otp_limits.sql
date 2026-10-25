-- =============================================================================
-- /server/migrations/0014_auth_otp_limits.sql
-- BD-AUTH-HARDEN-01 (#824): indexes for the OTP request limits and for the retention sweep.
--
-- The limits are counted from auth_otp itself (src/repositories/otps.js):
--   * per phone          -> idx_auth_otp_phone_created (0002) already serves it;
--   * per source address -> idx_auth_otp_ip_created (new): requested_ip + created_at;
--   * the retention sweep (codes older than a day, oldest first) -> idx_auth_otp_created (new).
-- The sweep deletes auth_otp rows, and auth_session.otp_id (0002) is ON DELETE SET NULL, so each
-- deleted code makes Postgres look up the sessions minted from it -> idx_auth_session_otp (new),
-- instead of a scan of auth_session per deleted row.
--
-- SCHEMA-ONLY: three indexes, no data change. The server works without them (the same queries,
-- only slower), so applying this migration needs no restart order. CREATE INDEX IF NOT EXISTS
-- makes a second apply a no-op (server-ci applies every migration twice). ASCII only.
-- =============================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_auth_otp_ip_created
  ON auth_otp(requested_ip, created_at DESC) WHERE requested_ip IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_auth_otp_created
  ON auth_otp(created_at);

CREATE INDEX IF NOT EXISTS idx_auth_session_otp
  ON auth_session(otp_id) WHERE otp_id IS NOT NULL;

COMMIT;
