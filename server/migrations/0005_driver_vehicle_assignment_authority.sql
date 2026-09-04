-- =============================================================================
-- /server/migrations/0005_driver_vehicle_assignment_authority.sql
-- BD-DRIVER-VEHICLE-ASSIGNMENT-AUTHORITY-01B — PostgreSQL authority schema (#959/#960)
--
-- SQL realization of the FROZEN contract:
--   docs/driver-vehicle-assignment-authority-contract.md (Issue #959, PR #960,
--   merged to main as 0bcc417e227e36d2fd06e9a5abdc61906bc86ff7)
--
-- Runs AFTER 0001 (vehicles, users) + 0004 (notification_outbox). Adds TWO new tables that
-- keep four concepts distinct — ownership (vehicles.owner_user_id, unchanged) != entitlement
-- (this file's vehicle_driver_assignments) != selection (this file's driver_active_vehicle)
-- != working (a LATER slice's driver_shift, not created here):
--
--   vehicle_driver_assignments   server-owned entitlement: this driver MAY work on this
--                                 vehicle (assignment_type OWNER | RENTAL | FLEET;
--                                 status ACTIVE | ENDED | REVOKED)
--   driver_active_vehicle        server-owned CURRENT selection: which of the driver's
--                                 assignments they picked right now (a pre-shift PREFERENCE,
--                                 not a reservation/lease/occupancy lock — see the contract's
--                                 "driver_active_vehicle" and Invariant 4)
--
-- 01B is contract-schema only: no HTTP route is registered by this migration or by the
-- repositories/dark-seam module that follow it (server/src/repositories/
-- vehicle_driver_assignments.js, driver_active_vehicle.js,
-- server/src/services/driver-vehicle-assignment-authority/index.js — importable, not
-- wired into services/index.js SERVICES, so no /api/v1/* path is added). vehicles.is_active
-- is untouched and stays legacy/derived only (contract "vehicles.is_active — legacy /
-- derived only") — nothing here reads or writes it.
--
-- ENTITLEMENT-WINDOW NON-OVERLAP (contract "Non-overlapping entitlement windows"):
-- vehicle_driver_assignments_no_overlap below is a time-range EXCLUDE constraint over the
-- half-open window [starts_at, ends_at) per (vehicle_id, driver_id), restricted to
-- non-terminal (status = 'ACTIVE') rows. This is deliberately NOT a now()-dependent partial
-- index: the WHERE clause is a static per-row fact (the stored `status` column), so a row's
-- membership in the constraint changes only on an explicit lifecycle UPDATE, never merely
-- because the wall clock advanced — two disjoint-today future grants cannot silently start
-- overlapping "later" without an actual write being rejected at that time. btree_gist
-- supplies GiST support for `=` on the UUID columns (plain uuid has no native GiST opclass);
-- range overlap (&&) is native GiST. The `entitlement_window` STORED generated column keeps
-- the indexed range in sync with starts_at/ends_at automatically, including a later
-- authorized shortening of ends_at while ACTIVE (contract: ends_at "may later be shortened
-- ... still to a value > starts_at").
--
-- ACTOR XOR (contract "Actor model"): exactly one of assigned_by_user_id /
-- assigned_by_service_id is non-null — the client sets neither; the server resolves the
-- actor. A service principal is never written as a `users` row (users today is a driver/
-- passenger/guest stub, BD-DOCS-032).
--
-- LIFECYCLE CONSISTENCY (contract "status"): ACTIVE <=> terminated_at IS NULL. Only ACTIVE
-- rows are ever UPDATEd by endAssignment/revokeAssignment (repositories/
-- vehicle_driver_assignments.js) — ENDED/REVOKED are terminal for the row; there is no
-- ENDED -> ACTIVE or REVOKED -> ACTIVE (renewal creates a NEW row), matching "Assignment
-- lifecycle".
--
-- SELECTION INTEGRITY (contract "driver_active_vehicle"): driver_active_vehicle stores NO
-- vehicle_id — the selected vehicle is DERIVED via assignment_id. The composite FK
-- (assignment_id, driver_id) -> vehicle_driver_assignments (id, driver_id) makes an
-- internally inconsistent selection (an assignment that does not belong to the selecting
-- driver) unrepresentable at the DB layer, which is why vehicle_driver_assignments carries
-- the matching composite UNIQUE (id, driver_id) as an FK target.
--
-- OUT OF SCOPE for 01B (see docs/driver-vehicle-assignment-authority-contract.md "01A
-- non-goals" + this slice's own instructions): no driver_shift table, no vehicleBlockState
-- physical storage (the contract leaves that "a future runtime / DB decision" — 01A,
-- "Assignment usability"), no change to vehicles.is_active, no backend route/runtime.
--
-- IDEMPOTENCY (server-ci re-applies every migration, twice, per run): CREATE EXTENSION /
-- TABLE / INDEX IF NOT EXISTS, DROP TRIGGER IF EXISTS + CREATE TRIGGER — a second apply is a
-- clean no-op, matching 0001-0004's convention exactly. Wrapped in BEGIN/COMMIT.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- EXTENSIONS
-- -----------------------------------------------------------------------------
-- btree_gist: GiST support for `=` on scalar types (uuid here), required to combine
-- vehicle_id/driver_id equality with a range-overlap (&&) check in ONE exclusion
-- constraint below. pgcrypto (gen_random_uuid) already exists from 0001.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- =============================================================================
-- 12. vehicle_driver_assignments
-- target entity per docs/driver-vehicle-assignment-authority-contract.md
-- "vehicle_driver_assignments (new — target entity, not created by 01A)"
-- -----------------------------------------------------------------------------
-- Append-mostly: identity + grant terms (vehicle_id, driver_id, assigned_by_*,
-- assignment_type, starts_at, created_at) are immutable at creation, never rewritten. Only
-- the lifecycle fields (status, ends_at, terminated_at, updated_at) are written after
-- creation, by endAssignment/revokeAssignment (server/src/repositories/
-- vehicle_driver_assignments.js) — never by the client.
-- =============================================================================
CREATE TABLE IF NOT EXISTS vehicle_driver_assignments (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- the vehicle the grant is for. RESTRICT (not CASCADE): an entitlement/audit row must
  -- never be silently orphaned by a vehicle delete (mirrors receipts.ride_id RESTRICT,
  -- 0001) — today nothing deletes a vehicle row anyway (BD-PROFILE-D-05I is a soft-delete
  -- via `archived`).
  vehicle_id             UUID NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  -- the driver being entitled. RESTRICT for the same audit-integrity reason.
  driver_id              UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- exactly one of these two is set (vehicle_driver_assignments_actor_xor below). Set when a
  -- HUMAN actor (owner / rental operator / fleet manager / Ops) created the grant.
  assigned_by_user_id    UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- set when a SERVER-OWNED procedure (e.g. ownership onboarding) created the grant — a
  -- service-principal identifier, never a `users` row (users has no service-principal shape).
  assigned_by_service_id TEXT NULL,
  -- OWNER = the owner driving their own vehicle; RENTAL = the owner lets a specific driver
  -- use it; FLEET = a fleet/company vehicle assigned by an operator.
  assignment_type        TEXT NOT NULL
                            CHECK (assignment_type IN ('OWNER', 'RENTAL', 'FLEET')),
  -- ACTIVE means "not yet ENDED/REVOKED" — NOT "usable now" (a still-ACTIVE row past its
  -- ends_at, or before its starts_at, is not entitled; see assignmentEntitledAt in
  -- src/domain/vehicle-assignment.js). ENDED = window closed normally; REVOKED = terminated
  -- out-of-band (dispute/fraud/safety), immediate.
  status                 TEXT NOT NULL DEFAULT 'ACTIVE'
                            CHECK (status IN ('ACTIVE', 'ENDED', 'REVOKED')),
  -- entitlement window open (server time). May be in the future — a scheduled grant is
  -- entitled only once starts_at is reached. Immutable after creation.
  starts_at              TIMESTAMPTZ NOT NULL,
  -- planned upper bound of the entitlement window (NULL = open-ended). May be set at
  -- creation and, while ACTIVE, shortened by an authorized server action — never repurposed
  -- as the termination timestamp (see terminated_at). Enforced > starts_at below.
  ends_at                TIMESTAMPTZ NULL,
  -- half-open entitlement window [starts_at, ends_at); NULL ends_at = unbounded upper. Feeds
  -- the non-overlap EXCLUDE constraint below; recomputes automatically if an authorized
  -- action shortens ends_at while the row stays ACTIVE.
  entitlement_window     tstzrange GENERATED ALWAYS AS (
                            tstzrange(starts_at, ends_at, '[)')
                          ) STORED,
  -- NULL while ACTIVE; stamped with the exact server transition time on
  -- ACTIVE -> ENDED/REVOKED. This, not ends_at, is when the grant actually stopped — an
  -- early termination before a future starts_at never inverts the window (status alone
  -- already makes assignmentEntitledAt false; ends_at keeps its planned value).
  terminated_at          TIMESTAMPTZ NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT vehicle_driver_assignments_actor_xor CHECK (
    (assigned_by_user_id IS NOT NULL) <> (assigned_by_service_id IS NOT NULL)
  ),
  CONSTRAINT vehicle_driver_assignments_window_check CHECK (
    ends_at IS NULL OR ends_at > starts_at
  ),
  CONSTRAINT vehicle_driver_assignments_active_iff_not_terminated CHECK (
    (status = 'ACTIVE') = (terminated_at IS NULL)
  ),
  -- FK target for driver_active_vehicle's composite FK (below) — makes "a selection whose
  -- assignment belongs to a different driver" unrepresentable.
  CONSTRAINT vehicle_driver_assignments_id_driver_uq UNIQUE (id, driver_id),
  -- non-overlapping entitlement windows per (vehicle_id, driver_id), non-terminal rows only
  -- (contract "Non-overlapping entitlement windows" — see the file header note above for why
  -- this is a time-range EXCLUDE and not a now()-dependent partial index). Multiple DIFFERENT
  -- drivers may hold overlapping ACTIVE grants on the SAME vehicle (owner + a RENTAL tenant) —
  -- this constraint only forbids overlap for the SAME (vehicle_id, driver_id) pair.
  CONSTRAINT vehicle_driver_assignments_no_overlap EXCLUDE USING gist (
    vehicle_id WITH =,
    driver_id WITH =,
    entitlement_window WITH &&
  ) WHERE (status = 'ACTIVE')
);

CREATE INDEX IF NOT EXISTS idx_vehicle_driver_assignments_driver_status
  ON vehicle_driver_assignments (driver_id, status);
CREATE INDEX IF NOT EXISTS idx_vehicle_driver_assignments_vehicle_status
  ON vehicle_driver_assignments (vehicle_id, status);

DROP TRIGGER IF EXISTS trg_vehicle_driver_assignments_updated_at ON vehicle_driver_assignments;
CREATE TRIGGER trg_vehicle_driver_assignments_updated_at
  BEFORE UPDATE ON vehicle_driver_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 13. driver_active_vehicle
-- target entity per docs/driver-vehicle-assignment-authority-contract.md
-- "driver_active_vehicle (new — target entity, not created by 01A)"
-- -----------------------------------------------------------------------------
-- A driver's CURRENT choice of which entitled vehicle to work with — a pre-shift preference,
-- explicitly NOT a reservation/lease/occupancy lock (contract Invariant 4): no TTL, no
-- heartbeat. At most one row per driver_id (absence = the NONE state). Real exclusivity is
-- established only by a later slice's OPEN driver_shift (contract Invariant 5) — not here.
-- =============================================================================
CREATE TABLE IF NOT EXISTS driver_active_vehicle (
  -- PK = FK: at most one selection per driver; row absence = NONE. CASCADE mirrors
  -- vehicles.owner_user_id's existing CASCADE-on-user-delete precedent (0001) — a
  -- preference row carries no independent audit value once its driver is gone.
  driver_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- the selected grant. The vehicle is DERIVED through this FK (no vehicle_id column here —
  -- an independently stored copy could contradict the assignment it names).
  assignment_id UUID NOT NULL,
  selected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- composite FK to the EXACT assignment tuple: the referenced assignment's own driver_id
  -- must equal this row's driver_id, so a selection can never point at someone else's
  -- assignment (contract "driver_active_vehicle"). No ON DELETE clause: vehicle_driver_
  -- assignments rows are never deleted (append-mostly, no delete path in this contract).
  CONSTRAINT driver_active_vehicle_assignment_driver_fkey
    FOREIGN KEY (assignment_id, driver_id)
    REFERENCES vehicle_driver_assignments (id, driver_id)
);

DROP TRIGGER IF EXISTS trg_driver_active_vehicle_updated_at ON driver_active_vehicle;
CREATE TRIGGER trg_driver_active_vehicle_updated_at
  BEFORE UPDATE ON driver_active_vehicle FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
