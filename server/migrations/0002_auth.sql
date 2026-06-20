-- =============================================================================
-- /server/migrations/0002_auth.sql
-- BazarDriveCloud — Phase-1 AUTH & IDENTITY schema (#585)
--
-- SQL realization of:
--   * BD-DOCS-032  docs-site/docs/decisions/auth-identity.md
--                  (server-side identity & phone+OTP authentication)
--
-- Runs AFTER 0001_phase1_init.sql (server-ci applies migrations/*.sql sorted),
-- so the `users` STUB already exists. This migration REFINES that stub (ALTER,
-- never CREATE/DROP — the PK users(id) must survive; rides/vehicles/orders/posts/
-- responses already FK to it) and ADDS the two auth tables (auth_otp, auth_session).
--
-- DECISIONS realized (BD-DOCS-032 "Decision"; do not re-litigate):
--   (1) One account = a ROLES SET + an ACTIVE role. The runtime scalar `role`
--       ('passenger'|'driver'|'guest', state.js buildDefaults().role) maps to
--       active_role; `roles` is the granted set. The 0001 scalar users.role is
--       RECONCILED into roles[] + active_role (kept in sync, not lost) here.
--   (2) Phone + OTP is the auth method (onboarding 'phone'->'otp' steps:
--       "Отправим СМС-код", "Введите код", autocomplete="one-time-code"). Phone is
--       the identity key. phone_verified becomes a SERVER fact: it is set by a
--       server-issued verified session, not a client flag.
--   (3) user.v1 is a local CACHE of the authenticated session (auth_session),
--       not the authority — the server owns identity/role/compliance.
--   (4) Role gates stay a client UX hint; the server re-validates active_role +
--       roles membership before any role-scoped action.
--
-- DEFERRED (BD-DOCS-032 "Open questions" — DELIBERATELY NOT over-specified):
--   * token format        -> auth_session stores a token HASH (opaque), no format CHECK.
--   * OTP provider         -> auth_otp stores a code HASH only; no provider column.
--   * session lifetime /   -> expires_at is NULLABLE and carries NO hard-coded TTL
--     refresh / revocation     constraint; revocation is a generic revoked_at stamp.
--                              No TTL/refresh policy is baked into the schema.
--
-- IDEMPOTENCY (server-ci re-applies every migration): ADD COLUMN IF NOT EXISTS,
-- CREATE TABLE/INDEX IF NOT EXISTS, DO-block guards for constraint adds, and
-- WHERE-guarded reconcile UPDATEs (this migration never DROPs — see line 11).
-- A second apply is a clean no-op. Wrapped in BEGIN/COMMIT.
--
-- VERIFIED: applied against PostgreSQL after 0001 — first apply OK, second apply
-- (idempotency) OK; base-table count 11 -> 13; partial-unique phone + both
-- guarded CHECKs enforced. CO-CHANGE (in THIS PR): adding auth_otp + auth_session
-- takes the BASE TABLE count 11 -> 13, so .github/workflows/server-ci.yml's
-- `grep -qx 11` assertion is bumped to 13 (+ explicit auth_otp/auth_session
-- existence asserts) in the same PR — server-ci gates this change.
-- ASSUMES: the 0001 users stub holds no duplicate non-null phones (true today — no
-- data; the cutover importer dedups phone before populating), else uq_users_phone
-- below fails on first apply.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. users  — REFINE the 0001 stub into the BD-DOCS-032 identity record
-- localStorage: bazardrive.user.v1 (state.js) — now a CLIENT CACHE of this row.
-- -----------------------------------------------------------------------------
-- ALTER ONLY. users(id) PK and every existing column (role, phone,
-- phone_verified, profile fields) are preserved; the FKs from rides/vehicles/
-- orders/posts/responses to users(id) are untouched.
-- =============================================================================

-- (1) roles set + active role -------------------------------------------------
-- `roles` = the granted set (BD-DOCS-032 decision 1: "the set of granted roles,
-- e.g. [passenger, driver]"). TEXT[] over the same three literals the scalar
-- role uses. Empty default until onboarding grants one (mirrors the scalar
-- starting NULL in buildDefaults()).
ALTER TABLE users ADD COLUMN IF NOT EXISTS roles TEXT[] NOT NULL DEFAULT '{}';

-- `active_role` = the currently selected role (BD-DOCS-032: "the scalar `role`
-- in user.v1 maps to activeRole"). Nullable, mirroring the scalar role's NULL
-- default. The legacy scalar `users.role` (0001) stays as the back-compat
-- source; active_role is the reconciled forward field.
ALTER TABLE users ADD COLUMN IF NOT EXISTS active_role TEXT NULL;

-- Reconcile the existing scalar role into the new fields WITHOUT losing it
-- (BD-DOCS-032 follow-up: "Reconcile the users.role field into roles +
-- activeRole"). Idempotent: only fills when not already reconciled.
--   * active_role <- role  (the scalar IS the active role)
--   * roles       <- {role} when a non-guest role is set and roles is still empty
-- 'guest' is an active_role but NOT a granted membership (it is the unauthenticated
-- browse state from welcome.js/onboarding.js: user.set({role:'guest'})), so it is
-- not added to the granted `roles` set.
UPDATE users
   SET active_role = role
 WHERE active_role IS NULL AND role IS NOT NULL;
UPDATE users
   SET roles = ARRAY[role]
 WHERE role IS NOT NULL
   AND role IN ('passenger', 'driver')
   AND roles = '{}';

-- Guard active_role to the same three literals as the scalar role
-- (state.js: 'passenger'|'driver'|'guest'). Idempotent constraint add.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_active_role_chk'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_active_role_chk
      CHECK (active_role IS NULL OR active_role IN ('passenger', 'driver', 'guest'));
  END IF;
END $$;

-- Guard every element of the granted `roles` set to the grantable literals
-- (passenger/driver only — 'guest' is not a granted membership, see above).
-- Idempotent constraint add.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_roles_subset_chk'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_roles_subset_chk
      CHECK (roles <@ ARRAY['passenger', 'driver']::text[]);
  END IF;
END $$;

-- (2) phone as the identity key ----------------------------------------------
-- BD-DOCS-032 decision 2: "Phone is the identity key." Enforce one account per
-- phone via a partial UNIQUE index (NULL phones — pre-onboarding/guest stubs and
-- the LOCAL_USER_ID cutover anchor — are exempt). Index, not a column
-- constraint, so re-apply is a clean no-op and multiple NULL phones coexist.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone
  ON users(phone) WHERE phone IS NOT NULL;

-- NOTE on phone_verified (0001 column, kept): BD-DOCS-032 decision 2 makes it a
-- SERVER fact, not a client flag — the server sets users.phone_verified = TRUE
-- only when an OTP is consumed and a verified auth_session is issued (see the
-- auth_otp -> auth_session flow below). The client `phoneVerified` in user.v1
-- becomes a read-through cache of this column. No DDL change to the column
-- itself; the authority change is enforced at the API layer (only the verify
-- endpoint writes it).

-- =============================================================================
-- 2. auth_otp  — phone-verification one-time codes (CODE HASH only)
-- BD-DOCS-032 decision 2: "Phone + OTP ... Verification moves from a client flag
-- to a server-issued, verified session." Realizes the onboarding 'phone'->'otp'
-- step (state.js / onboarding.js: "Получить код" then "Введите код").
-- -----------------------------------------------------------------------------
-- Generic by design (BD-DOCS-032 Open questions): we store a code HASH + expiry
-- + a consumed marker + a coarse attempt counter. NO plaintext code, NO OTP
-- provider column, NO hard-coded TTL constraint (expires_at is supplied per row).
-- =============================================================================
CREATE TABLE IF NOT EXISTS auth_otp (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The phone the code was sent to — the identity key (BD-DOCS-032 decision 2).
  -- Kept as TEXT (not an FK to users) on purpose: an OTP can be requested for a
  -- phone BEFORE any users row exists (first-time onboarding), and users.phone
  -- is itself nullable. The verify endpoint resolves/creates the users row.
  phone         TEXT NOT NULL,
  -- HASH of the one-time code — NEVER the plaintext code (no-plaintext-secrets
  -- rule). Hash algorithm/format is the app's concern; the column is opaque TEXT.
  code_hash     TEXT NOT NULL,
  -- Per-row expiry supplied by the issuer. NOT NULL because an OTP must expire,
  -- but NO baked TTL value (lifetime policy deferred — BD-DOCS-032 Open questions).
  expires_at    TIMESTAMPTZ NOT NULL,
  -- One-time use: stamped when the code is accepted and a session is issued.
  -- A non-null consumed_at means the code can never verify again.
  consumed_at   TIMESTAMPTZ NULL,
  -- Coarse brute-force guard (count of failed checks). No policy threshold baked
  -- into the schema — the API decides the lock-out (lifetime/limits deferred).
  attempts      INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- request provenance for abuse triage (optional; no auth meaning).
  requested_ip  TEXT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Look up the freshest live code for a phone (verify endpoint hot path).
CREATE INDEX IF NOT EXISTS idx_auth_otp_phone_created
  ON auth_otp(phone, created_at DESC);
-- Reap/scan expired-but-unconsumed codes (a future cleanup job).
CREATE INDEX IF NOT EXISTS idx_auth_otp_expiry
  ON auth_otp(expires_at) WHERE consumed_at IS NULL;

-- =============================================================================
-- 3. auth_session  — the server-issued verified session (user.v1's authority)
-- BD-DOCS-032 decision 3: "user.v1 becomes a local cache of the authenticated
-- session." THIS row is what user.v1 caches: identity + active_role + the
-- verified-phone fact for the duration of the session.
-- -----------------------------------------------------------------------------
-- Generic re token format & lifetime (BD-DOCS-032 Open questions): stores a
-- token HASH (no plaintext, no format CHECK), a NULLABLE expires_at (no baked
-- TTL — refresh/lifetime policy deferred), and a generic revoked_at stamp
-- (revocation policy deferred). Optional device/last-seen for the session list.
-- =============================================================================
CREATE TABLE IF NOT EXISTS auth_session (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The authenticated identity. FK to the refined users row; CASCADE so deleting
  -- an account drops its sessions (sessions are pure derived auth state).
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- HASH of the session/bearer token — NEVER the plaintext token (no-plaintext-
  -- secrets rule). Token FORMAT is deferred (BD-DOCS-032), so this is opaque TEXT
  -- with no format CHECK. UNIQUE so a presented token resolves to one session.
  token_hash    TEXT NOT NULL UNIQUE,
  -- The active role this session is operating as (BD-DOCS-032 decision 1: the
  -- runtime scalar role maps to activeRole). A session pins ONE active role;
  -- switching role (no dedicated UI today — onboarding/welcome write the scalar)
  -- issues/updates a session with the new active_role. Must be a granted role.
  active_role   TEXT NULL CHECK (active_role IS NULL OR active_role IN ('passenger', 'driver')),
  -- Snapshot of the verified-phone fact at issue time (BD-DOCS-032 decision 2):
  -- a session is "verified" because it was minted by consuming an OTP. The
  -- authoritative flag lives on users.phone_verified; this mirrors it onto the
  -- session for fast read-through into the user.v1 cache.
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  -- The OTP this session was minted from (audit link verify -> session).
  -- SET NULL if the OTP row is later reaped; the session stays valid.
  otp_id        UUID NULL REFERENCES auth_otp(id) ON DELETE SET NULL,
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULLABLE expiry: lifetime/refresh policy deferred (BD-DOCS-032). NULL = no
  -- expiry modeled yet; a value = the issuer-supplied expiry. No baked TTL.
  expires_at    TIMESTAMPTZ NULL,
  -- Generic revocation (logout / forced revoke). revoked_at non-null => dead.
  -- mock_auth.js performLocalLogout()/resetLocalSession() is the client mirror;
  -- the server-side equivalent stamps revoked_at. Revocation POLICY is deferred;
  -- this is just the mechanism.
  revoked_at    TIMESTAMPTZ NULL,
  -- Optional device/last-seen for a future "active sessions" surface. No auth
  -- meaning; purely informational.
  device_label  TEXT NULL,
  user_agent    TEXT NULL,
  last_seen_at  TIMESTAMPTZ NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A session's active_role, when set, must be one the account actually holds — but
-- roles[] lives on users, not here, so cross-row membership is RE-VALIDATED at the
-- API layer (BD-DOCS-032 decision 4: "the server re-validates role"). The CHECK
-- above only pins the literal set; the grant check is an app-layer join.

-- Token resolution (the auth hot path) uses the token_hash UNIQUE constraint, not
-- these indexes. idx_auth_session_user/_live serve listing a user's sessions
-- (newest-first, live-only) for the profile "active sessions" / revoke surface.
CREATE INDEX IF NOT EXISTS idx_auth_session_user
  ON auth_session(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_session_live
  ON auth_session(user_id, issued_at DESC) WHERE revoked_at IS NULL;
-- Scan expiring/expired live sessions (future cleanup/refresh job).
CREATE INDEX IF NOT EXISTS idx_auth_session_expiry
  ON auth_session(expires_at) WHERE revoked_at IS NULL AND expires_at IS NOT NULL;

COMMIT;

-- =============================================================================
-- DEFERRED (BD-DOCS-032 Open questions — NOT modeled here, intentionally):
--   * Token format / signing            -> auth_session.token_hash is opaque.
--   * OTP delivery provider             -> auth_otp has no provider column.
--   * Session lifetime / refresh /      -> expires_at NULLABLE, no baked TTL;
--     revocation POLICY                    revoked_at is mechanism only.
--   * Compliance record + vehicles      -> BD-DOCS-031/032 follow-ups; the
--     binding to identity                  driver garage already maps to the
--                                          0001 `vehicles` entity (owner_user_id).
--   * Multi-role SWITCH UI               -> no runtime affordance today; the
--                                          schema supports roles[] + per-session
--                                          active_role for when it lands.
--   (server-ci.yml BASE TABLE count is bumped 11 -> 13 in THIS PR, not deferred.)
-- =============================================================================
