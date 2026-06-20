-- =============================================================================
-- /server/migrations/0001_phase1_init.sql
-- BazarDriveCloud — Phase-1 PostgreSQL schema (in-repo /server backend, #584)
--
-- SQL realization of:
--   * BD-DOCS-031  docs-site/docs/design/data-layer-contract.md
--                  (localStorage-key -> server-entity map)
--   * BD-DOCS-041  docs-site/docs/decisions/backend-home-and-stack.md
--                  (PostgreSQL 16, thin repository layer, ordered SQL migrations)
--
-- It must be a FAITHFUL mapping of the field shapes the client persists TODAY so
-- the cutover (module-by-module behind public/src/data_layer.js) introduces NO
-- contract change. Persisted literals the client depends on are preserved
-- VERBATIM (response.kind, canonical:'ride_order', the 12 RIDE_STATUS literals,
-- offer.status set, paymentMode, etc.).
--
-- Key rules grounded in source:
--   * rides.status        = TEXT + CHECK over the EXACT 12 RIDE_STATUS literals
--                           (public/src/ride_state.js).
--   * terminal freeze      = DB trigger; no transition OUT of {CANCELED, NO_SHOW,
--                           COMPLETED} (ride_state.js TERMINAL_RIDE_STATUSES).
--   * ride_events          = append-only (BEFORE UPDATE OR DELETE guard).
--   * users                = Phase-1 STUB only (full identity -> BD-DOCS-032 #585).
--   * ride_history         = read-model VIEW over rides + ride_events + receipts.
--   * IDs                  = server-generated time-ordered UUID (v7-style) PKs;
--                           the `pg` repository layer emits the v7 value on every
--                           INSERT, the column DEFAULT is only a never-hit fallback.
--
-- Ordering: extensions -> shared helpers -> base tables in FK-dependency order
-- (users -> vehicles/posts -> orders -> responses/offers/assignment -> rides ->
--  ride_events/messages/receipts) -> indexes -> ride_history VIEW.
--
-- Idempotent-friendly: CREATE EXTENSION IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- and DROP TRIGGER/VIEW IF EXISTS guards. Re-running on a fresh DB is safe.
-- =============================================================================
-- CUTOVER IMPORTER NOTES (module-by-module migration behind public/src/data_layer.js)
--   * Populate `orders.legacy_id` BEFORE inserting any responses/offers/assignment/
--     rides rows: responses.order_id -> orders.legacy_id (and the offer/overlay
--     string keys) resolve against the verbatim client id ('order-<ts>').
--   * Back-fill `canceled_at` / `completed_at` for any legacy terminal
--     active_ride.v1 record that predates client timestamp stamping, or the
--     terminal-stamp CHECKs (rides_terminal_cancel_stamp / rides_completed_stamp)
--     reject the import.
--   * Skip empty-text rows when importing the legacy chat shape
--     ({chatId,messages}); messages.body is NOT NULL.
--
-- FIDELITY CLARIFICATIONS (no DDL change; reader guidance)
--   * responses.driver_snapshot.rating is NUMERIC|null (respond.js), distinct from
--     offers.rating which is a localized TEXT string ('5,0').
--   * posts.price_label also carries TRIP-post prices ('<n> RUB', composer.js) —
--     not marketplace-only.
--   * vehicles.source CHECK pins the three observed writers (persisted/legacy/mock);
--     the runtime normaliser does not itself constrain it — an intentional tightening.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- EXTENSIONS
-- -----------------------------------------------------------------------------
-- pgcrypto only for gen_random_uuid() as the column DEFAULT FALLBACK. The
-- primary id is a time-ordered UUIDv7 emitted by the repository layer on INSERT
-- (BD-DOCS-041: "server-generated UUID v7-style/time-ordered primary keys").
-- PG16 ships no built-in uuidv7(), so the app overrides the v4 default on every
-- write; the default never produces a non-unique value.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- NOTE: postgis is DELIBERATELY NOT created here. BD-DOCS-041 places geo/PostGIS
-- in a LATER phase (Phase-3 nearby-drivers, BD-DOCS-035), not Phase-1.

-- -----------------------------------------------------------------------------
-- SHARED HELPERS
-- -----------------------------------------------------------------------------
-- set_updated_at(): shared BEFORE UPDATE trigger for MUTABLE base tables.
-- Append-only ride_events is excluded by design (it carries no updated_at).
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 1. users  (Phase-1 STUB)
-- localStorage: bazardrive.user.v1 (state.js / mock_api.js)  ·  BD-DOCS-031 kind C
-- -----------------------------------------------------------------------------
-- STUB ONLY. Full identity/auth/compliance/doc-readiness is owned by BD-DOCS-032
-- (#585) and must NOT be modeled here — this table exists solely as a stable FK
-- anchor so vehicles/posts/orders/responses/offers/assignment/rides can reference
-- an owner. LOCAL_USER_ID = 'local-user' (mock_api.js) — the client's
-- authored-content marker — resolves to ONE users row at cutover.
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
  -- server-generated time-ordered UUID (v7-style) PK per BD-DOCS-041.
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- state.js buildDefaults().role: null until onboarding; CHECK over exactly the
  -- three literals the client uses. Nullable mirrors the null default.
  role           TEXT NULL CHECK (role IN ('passenger', 'driver', 'guest')),
  -- respond.js builds driverName from displayName/firstName/lastName/name; these
  -- mirror state.js buildDefaults() profile fields. Profile surface only.
  display_name   TEXT NULL,
  first_name     TEXT NULL,
  last_name      TEXT NULL,
  city           TEXT NULL,
  phone          TEXT NULL,
  -- state.js v9 phoneVerified (default false in buildDefaults()).
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- DELIBERATELY OMITTED (owned by BD-DOCS-032, not this phase): driverDocuments,
-- documentsReady, shiftDocsReady, taxiPermit, REGISTRATION_DOCS/SHIFT_DOCS
-- readiness, onboarded/welcomeSeen, notificationsEnabled, profileStatus,
-- paymentLast4, tripCount, rating, and all other state.js profile/compliance
-- fields — modeling them here would overstep the stub boundary the contract sets.

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 2. vehicles
-- localStorage: state.js driverGarage.vehicles[] + activeVehicleId + legacy
--               vehicle* fields  ·  BD-DOCS-031 **vehicles** entity (S)
-- -----------------------------------------------------------------------------
-- Splits vehicle data OUT of the driver profile into a first-class entity, keyed
-- by driver identity (BD-DOCS-031: "driver garage -> server vehicles").
-- =============================================================================
CREATE TABLE IF NOT EXISTS vehicles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- owning driver (FK to the users stub). driverGarage lives under the user
  -- record today; here it becomes an explicit owner reference.
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- garage.js normalisePersistedVehicle: `model` is REQUIRED (blank-model entries
  -- are dropped). Maps driverGarage.vehicles[].model + the legacy-derived
  -- `${vehicleMake} ${vehicleModel}` modelLine.
  model         TEXT NOT NULL CHECK (length(btrim(model)) > 0),
  -- driverGarage.vehicles[].color / .plate. Legacy: vehicleColor / vehiclePlate.
  color         TEXT NULL,
  plate         TEXT NULL,
  -- provenance marker. state.js KNOWN_SOURCES = {'persisted','legacy','mock'};
  -- appendGarageVehicle always stamps 'persisted'.
  source        TEXT NOT NULL DEFAULT 'persisted'
                  CHECK (source IN ('persisted', 'legacy', 'mock')),
  -- BD-PROFILE-D-05I soft-delete: driverGarage.vehicles[].archived. No hard
  -- delete on the client — archived stays in the record.
  archived      BOOLEAN NOT NULL DEFAULT FALSE,
  -- BD-PROFILE-D-05J transient marker: driverGarage.vehicles[].restoredFromArchive.
  restored_from_archive BOOLEAN NOT NULL DEFAULT FALSE,
  -- driverGarage.activeVehicleId: exactly one active vehicle per owner.
  -- Realized as a flag; the partial-unique index below enforces single-active.
  is_active     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- NOTE: legacy vehicleMake/vehicleModel are NOT separate columns — garage.js
-- itself collapses them to one modelLine; vehicleYear/vehicleBody have no
-- garage-collection equivalent and are intentionally dropped to match the
-- driverGarage.vehicles[] shape the contract migrates.

DROP TRIGGER IF EXISTS trg_vehicles_updated_at ON vehicles;
CREATE TRIGGER trg_vehicles_updated_at
  BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 3. posts
-- localStorage: bazardrive.posts.v1 (legacy board) + bazardrive.myposts.v1
--               (composer.js buildFeedPost)  ·  BD-DOCS-031 **posts** (S)
-- -----------------------------------------------------------------------------
-- Unifies the legacy board and locally-authored feed posts under ONE entity
-- (BD-DOCS-031 maps BOTH keys to **posts**), PRESERVING every per-type payload
-- variant — NOT flattened to a body-only row.
-- NOTE: ride-order feed cards (canonical:'ride_order', mock_api.rideOrderToFeedPost)
-- are a READ-SIDE projection of the orders entity, NOT stored here.
-- =============================================================================
CREATE TABLE IF NOT EXISTS posts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- verbatim persisted post.id ('trip-2','mkt-1','sys-1','ann-1','user-<ts>') — feed/
  -- post/respond look posts up by this string and /respond stores requestId/tripId =
  -- post.id, so it must round-trip across cutover.
  legacy_id     TEXT UNIQUE,
  -- createFeedPost stamps authorId = LOCAL_USER_ID ('local-user'); legacy
  -- posts.v1 has only a free-text `author`. author_id is the FK when an authored
  -- row maps to a real user; SET NULL on delete (seed posts have no user row).
  author_id     UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  -- posts.v1 SEED `author` + composer `author:'Вы'`. Free text; verbatim display.
  author_name   TEXT NULL,
  -- composer.js buildFeedPost `role` ('Водитель' | null). Feed display label.
  author_role   TEXT NULL,
  -- feed post `type`. Composer emits 'trip'|'marketplace'|'announcement'; FEED
  -- seed also uses 'system'; typeless legacy board rows bucket to 'listing'.
  type          TEXT NOT NULL
                  CHECK (type IN ('trip', 'marketplace', 'announcement',
                                  'system', 'listing')),
  -- composer marketplace posts keep the draft kind so «Мои публикации» labels a
  -- service post as «Услуга». Persisted literal; marketplace-only (CHECK below).
  subtype       TEXT NULL CHECK (subtype IS NULL OR subtype IN ('marketplace', 'service')),
  -- posts.v1 / myposts marketplace+announcement `title`. Trip posts have none.
  title         TEXT NULL,
  -- posts.v1 / feed `body` (trip comment / description). Contract `body` field.
  body          TEXT NULL,
  -- myposts price is a PRE-FORMATTED label string ('2 800 ₽','45 000 ₸'), NOT a
  -- number — composer writes `${d.price} ₽`. Kept verbatim so readers/feed render
  -- byte-faithfully. (Legacy posts.v1 has none.)
  price_label   TEXT NULL,
  -- posts.v1 `tags` + myposts `tags:[category,location]`. JSONB array preserves
  -- order + variable length.
  tags          JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- composer trip-post payload (from/to/when/seats/phone) — only on type='trip'.
  trip_from     TEXT NULL,
  trip_to       TEXT NULL,
  trip_when     TEXT NULL,
  trip_seats    INTEGER NULL CHECK (trip_seats IS NULL OR trip_seats >= 0),
  trip_phone    TEXT NULL,
  -- posts.v1 / order-projection `passenger: true` on passenger-REQUEST trip posts —
  -- renderTripCard branches on it for the «Откликнуться» / own-order CTA vs the
  -- driver-trip chat CTA. Display-driving, must round-trip.
  passenger     BOOLEAN NOT NULL DEFAULT FALSE,
  -- mock_api.createFeedPost createdByCurrentUser marker (drives «Мои публикации»).
  created_by_current_user BOOLEAN NOT NULL DEFAULT FALSE,
  -- createFeedPost createdAt (epoch ms) / posts.v1 createdAt -> timestamptz.
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Per-type payload coherence: trip fields only on trip posts.
  CONSTRAINT posts_trip_fields_only CHECK (
    type = 'trip'
    OR (trip_from IS NULL AND trip_to IS NULL AND trip_when IS NULL
        AND trip_seats IS NULL AND trip_phone IS NULL)
  ),
  -- subtype is a marketplace-only concept (composer only stamps it there).
  CONSTRAINT posts_subtype_marketplace_only CHECK (
    subtype IS NULL OR type = 'marketplace'
  )
);
-- OMITTED display-only ephemera (likes/comments/time/pinned/passenger): seed
-- counters / relative display strings / feed flags — not part of the contract's
-- named payload variants. Add later if a real engagement model lands.

-- =============================================================================
-- 4. orders
-- localStorage: bazardrive.ride_orders.v1 (mock_api.js)  ·  BD-DOCS-031 **orders** (S)
-- Mini-Yonder #1 Order Dispatcher / Phase 3 BD-DOCS-034.
-- -----------------------------------------------------------------------------
-- Every column is a real createRideOrder() field. legacy_id keeps the verbatim
-- client order.id because responses.orderId and the active-ride tripId
-- ('trip_<orderId>') linkage are built from that exact string.
-- =============================================================================
CREATE TABLE IF NOT EXISTS orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- verbatim mock_api order.id ('order-<ts>','order_1001') for cutover idempotency
  -- and as the response/tripId join key.
  legacy_id             TEXT UNIQUE,
  -- order.passenger.authorId (frequently null in the client today).
  passenger_id          UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  -- order.type / .source / .scheduledMode — TEXT+CHECK over verbatim literals.
  type                  TEXT NOT NULL DEFAULT 'passenger_request'
                          CHECK (type IN ('ride_order', 'passenger_request')),
  source                TEXT NOT NULL DEFAULT 'map'
                          CHECK (source IN ('feed', 'map')),
  -- order.pickup / .dropoff — nullable objects {lng,lat,label?}; JSONB keeps the
  -- nested shape the client persists as-is (typed lng/lat columns deferred to #4).
  pickup                JSONB NULL,
  dropoff               JSONB NULL,
  -- order.distanceKm / .durationMin / .estimatedPrice (Number()).
  distance_km           NUMERIC(10,3) NOT NULL DEFAULT 0,
  duration_min          INTEGER NOT NULL DEFAULT 0,
  estimated_price       NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- order.estimatedPriceLabel — display string ('1 480 ₽'), kept distinct from
  -- the numeric estimate because both are persisted today.
  estimated_price_label TEXT NOT NULL DEFAULT '',
  scheduled_mode        TEXT NOT NULL DEFAULT 'now'
                          CHECK (scheduled_mode IN ('now', 'later')),
  -- order.scheduledAt is FREE TEXT (composer passes the user's `when` label) OR an
  -- ISO string — kept raw as TEXT so natural-language labels round-trip; the optional
  -- parsed value lives in scheduled_at_ts (NULL when unparseable).
  scheduled_at          TEXT NOT NULL DEFAULT '',            -- order.scheduledAt (raw)
  scheduled_at_ts       TIMESTAMPTZ NULL,                    -- parsed, when possible
  scheduled_label       TEXT NOT NULL DEFAULT '',            -- order.scheduledLabel
  comment               TEXT NOT NULL DEFAULT '',            -- order.comment
  -- order.passenger sanitized snapshot {name,initials,phoneMasked,comment,
  -- authorId,isCurrentUser} — JSONB so the BD-ACTIVE-07 driver handoff reads it
  -- verbatim; flattening would break that handoff.
  passenger_snapshot    JSONB NULL,
  -- ORDER lifecycle status (distinct from rides.status RIDE_STATUS):
  -- CREATED -> ACCEPTED -> IN_PROGRESS -> COMPLETED, with CANCELED. updateTripStatus
  -- (mock_api.js) persists IN_PROGRESS and COMPLETED; HANDED_OFF_ORDER_STATUSES =
  -- {ACCEPTED, IN_PROGRESS}; NO_SHOW active rides sync to CANCELED here, so the
  -- order never holds NO_SHOW. See assignment table for actor/overlay.
  status                TEXT NOT NULL DEFAULT 'CREATED'
                          CHECK (status IN ('CREATED', 'ACCEPTED', 'IN_PROGRESS',
                                            'COMPLETED', 'CANCELED')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),   -- order.createdAt
  accepted_at          TIMESTAMPTZ NULL,                     -- order.acceptedAt
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 5. responses
-- localStorage: bazardrive.respond.v1 (draft, NOT modeled) + bazardrive.responses.v1
--               (keyed map)  ·  BD-DOCS-031 **responses** (S)
-- -----------------------------------------------------------------------------
-- `kind` is the load-bearing literal: /responses filters ride offers by
-- r.kind==='passenger_response'. Preserved VERBATIM with both literals.
-- order_id + canonical realize the additive BD-RESPOND-ORDER-LINK-01 pin
-- (canonical is ONLY ever 'ride_order'). order_id references orders.legacy_id
-- because the client linkage is the string orderId.
-- =============================================================================
CREATE TABLE IF NOT EXISTS responses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- verbatim response.id ('resp_<post.id>') — a PER-BROWSER key, NOT globally
  -- unique: two drivers answering the same post both produce resp_<post.id>, so the
  -- server must accept multiple. The UUID PK is the only global id; the server
  -- queries responses by request_id (+ author_id once auth lands).
  legacy_id     TEXT NOT NULL,
  -- response.kind — PRESERVED VERBATIM (readers filter on it).
  kind          TEXT NOT NULL
                  CHECK (kind IN ('passenger_response', 'marketplace_message')),
  -- responding driver (passenger_response). No explicit client field today —
  -- derived from the local user; SET NULL on delete.
  author_id     UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  -- response.requestId (= post.id) — the answered feed post. TEXT (posts carry a
  -- UUID PK; the client linkage is the legacy post id string).
  request_id    TEXT NOT NULL,
  -- response.orderId — additive canonical link; references orders.legacy_id (the
  -- string the client joins on). Null for non-canonical / marketplace rows.
  -- ON DELETE CASCADE (not SET NULL): a canonical passenger_response REQUIRES its
  -- order (responses_passenger_link below), so SET NULL would violate that CHECK
  -- on order delete; cascading removes the now-orphaned canonical response instead.
  order_id      TEXT NULL REFERENCES orders(legacy_id) ON DELETE CASCADE,
  -- response.canonical literal — ONLY ever 'ride_order'.
  canonical     TEXT NULL CHECK (canonical IS NULL OR canonical = 'ride_order'),
  -- passenger_response payload (respond.js):
  trip_id       TEXT NULL,                 -- response.tripId ('trip_<orderId>')
  driver_price  NUMERIC(12,2) NULL,        -- response.driverPrice (priceNum)
  pickup_timing TEXT NULL,                 -- response.pickupTiming (selectedTiming)
  message       TEXT NOT NULL,             -- response.message (both kinds)
  vehicle_id    TEXT NULL,                 -- response.vehicleId ('user_vehicle' today)
  -- response.driverSnapshot {name,rating,car,carModel,carColor,plate} — JSONB to
  -- round-trip verbatim (the card render depends on it).
  driver_snapshot JSONB NULL,
  -- response.status — only 'SENT' is ever written; CHECK pins it (widen later).
  status        TEXT NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),  -- response.createdAt
  -- passenger_response canonical rows carry an order link; marketplace_message
  -- rows carry NO order/canonical/trip linkage.
  CONSTRAINT responses_passenger_link CHECK (
    kind <> 'passenger_response' OR canonical IS NULL OR order_id IS NOT NULL
  ),
  CONSTRAINT responses_marketplace_no_link CHECK (
    kind <> 'marketplace_message'
    OR (order_id IS NULL AND canonical IS NULL AND trip_id IS NULL)
  )
);

-- =============================================================================
-- 6. offers
-- localStorage: bazardrive.driver_offers.v1 (driver_offer_store.js)
--               ·  BD-DOCS-031 **offers** (S)  ·  Mini-Yonder #1/#3, BD-DOCS-034
-- -----------------------------------------------------------------------------
-- Mirrors the documented store record exactly. status = full Model B set,
-- verbatim literals. UNIQUE(order_id, driver_id) encodes the store's composite
-- (orderId,driverId) idempotency key (buildOfferId). The driver_offers store
-- carries NO vehicleId today, so no vehicle FK column is modeled.
-- =============================================================================
CREATE TABLE IF NOT EXISTS offers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- verbatim buildOfferId() value ('offer_<orderId>_<driverId>').
  legacy_id   TEXT UNIQUE NOT NULL,
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,   -- offer.orderId
  driver_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,    -- offer.driverId
  -- offer.status — full Model B set, verbatim. 01D-1 writes only sent/withdrawn;
  -- accepted/rejected come from commitPassengerSelection, expired from the TTL job.
  status      TEXT NOT NULL
                CHECK (status IN ('sent', 'withdrawn', 'accepted', 'rejected', 'expired')),
  driver_name TEXT NULL,                                       -- offer.driverName
  car         TEXT NULL,                                       -- offer.car
  rating      TEXT NULL,                                       -- offer.rating ('5,0' — localized string)
  eta_min     INTEGER NULL CHECK (eta_min IS NULL OR eta_min > 0),       -- offer.etaMin
  price       NUMERIC(12,2) NULL CHECK (price IS NULL OR price >= 0),    -- offer.price
  message     TEXT NULL,                                       -- offer.message
  -- rejection actor fields (rejectDriverOfferByPassenger /
  -- rejectSentOffersForPassengerCanceledOrder); only on rejected rows.
  rejected_by     TEXT NULL,        -- offer.rejectedBy ('passenger' | 'passenger_cancel')
  rejected_reason TEXT NULL,        -- offer.rejectedReason ('order_canceled_by_passenger')
  rejected_at     TIMESTAMPTZ NULL, -- offer.rejectedAt
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),              -- offer.createdAt
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),              -- offer.updatedAt (monotonic bumpedIso)
  -- offer.expiresAt = createdAt + DEFAULT_OFFER_TTL_MIN (15 min); stamped on
  -- every fresh sent offer (BD-ORDER-DETAIL-01D-1F).
  expires_at  TIMESTAMPTZ NOT NULL,
  -- the (orderId, driverId) composite-key idempotency invariant.
  CONSTRAINT offers_order_driver_uniq UNIQUE (order_id, driver_id)
);
-- NOTE: set_updated_at trigger intentionally NOT attached — offer.updatedAt is a
-- MONOTONIC bumpedIso() value supplied by the domain (the store guarantees the
-- next stamp is strictly greater), so the server must store the supplied value,
-- not an auto-now() that could collide on same-task writes.

-- =============================================================================
-- 7. assignment
-- localStorage: bazardrive.order_overlay.v1 (driver_offer_store.js)
--               ·  BD-DOCS-031 **assignment** (S)  (#605 reconciled)
-- -----------------------------------------------------------------------------
-- One overlay per order (the client map is keyed by orderId). Makes BOTH
-- acceptance AND cancellation shared/server-owned, not per-browser. selected
-- driver is PRESERVED across a cancel (audit / passenger 'driver canceled' view).
-- =============================================================================
CREATE TABLE IF NOT EXISTS assignment (
  -- overlay map key = orderId (1:1 with order). PK + FK in one.
  order_id           UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  -- overlay.status — the two literals the overlay ever writes (ORDER_STATUS_*).
  status             TEXT NOT NULL CHECK (status IN ('ACCEPTED', 'CANCELED')),
  -- overlay.selectedDriverId (preserved across cancel).
  selected_driver_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  -- overlay.canceledBy actor — verbatim literals (cancelOrderByPassenger/Driver).
  canceled_by        TEXT NULL CHECK (canceled_by IS NULL OR canceled_by IN ('passenger', 'driver')),
  canceled_at        TIMESTAMPTZ NULL,                       -- overlay.canceledAt (monotonic)
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),     -- overlay.updatedAt
  -- store invariant: a CANCELED overlay always carries actor+timestamp; an
  -- ACCEPTED overlay carries a selected driver and no cancel actor/timestamp
  -- (an overlay only reaches ACCEPTED via commitPassengerSelection, which pins
  -- selectedDriverId — order-detail uses it to decide driver ownership/cancel).
  CONSTRAINT assignment_cancel_stamp CHECK (
    status <> 'CANCELED' OR (canceled_by IS NOT NULL AND canceled_at IS NOT NULL)
  ),
  CONSTRAINT assignment_accept_clean CHECK (
    status <> 'ACCEPTED' OR (selected_driver_id IS NOT NULL
                            AND canceled_by IS NULL AND canceled_at IS NULL)
  )
);
-- NOTE: like offers, updated_at is a monotonic bumpedIso() value supplied by the
-- domain — no set_updated_at trigger is attached.

-- =============================================================================
-- 8. rides
-- localStorage: bazardrive.active_ride.v1 (ride_state.js STORAGE_KEY)
--               ·  BD-DOCS-031 **rides** (S), status via RIDE_STATUS
-- -----------------------------------------------------------------------------
-- Realizes the active_ride.v1 full-snapshot object store[tripId] = {...}
-- (buildDemoRide / buildActiveRideSeed / cancelActiveRide). Display numerics the
-- client persists as STRINGS ('4,86','1 480 ₽','12 ₽ / км') stay TEXT to round-
-- trip byte-for-byte — the contract carries no parsed numbers and history re-reads
-- them as strings. Handoff sub-objects are NOT duplicated here — they are the
-- timeline rows in ride_events.
-- =============================================================================
CREATE TABLE IF NOT EXISTS rides (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- `tripId` — the client's per-trip key (store[tripId]); the join key every
  -- surface uses (chat 'trip-<tripId>', responses.tripId, trip_confirmation map
  -- key, handoff snapshot key). UNIQUE business key alongside the UUID PK.
  trip_id            TEXT NOT NULL UNIQUE,
  -- FK to the owning order. Nullable: demo/SIM rides (DEMO_ACTIVE_RIDE_ID) have
  -- no backing order row in Phase-1.
  order_id           UUID NULL REFERENCES orders(id) ON DELETE SET NULL,
  -- `role` — which side first materialized the canonical record (role-agnostic
  -- per loadCanonicalActiveRide); nullable.
  role               TEXT NULL CHECK (role IN ('passenger', 'driver')),
  -- `status` — EXACTLY the 12 RIDE_STATUS literals (ride_state.js).
  -- TEXT + CHECK per BD-DOCS-041 (no PG enum; adding a literal is an ordered
  -- migration, not an ALTER TYPE).
  status             TEXT NOT NULL DEFAULT 'NEW_ORDER'
    CHECK (status IN (
      'NEW_ORDER', 'CONFIRMATION_PENDING', 'CONFIRMED', 'CHAT_STARTED',
      'ACCEPTED', 'DRIVER_EN_ROUTE', 'DRIVER_APPROACHING_PICKUP',
      'WAITING_PASSENGER', 'IN_PROGRESS', 'COMPLETED', 'CANCELED', 'NO_SHOW'
    )),
  -- Participant FKs (Phase-1 users stub). Nullable: demo rides carry only the
  -- display identity strings below, not a real user row.
  passenger_user_id  UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  driver_user_id     UUID NULL REFERENCES users(id) ON DELETE SET NULL,

  -- passenger.* (ride.passenger)
  passenger_name         TEXT NULL,   -- passenger.name
  passenger_initials     TEXT NULL,   -- passenger.initials
  passenger_rating       TEXT NULL,   -- passenger.rating ('4,86' display string, NOT numeric)
  passenger_phone_masked TEXT NULL,   -- passenger.phoneMasked
  passenger_luggage      TEXT NULL,   -- passenger.luggage
  passenger_note         TEXT NULL,   -- passenger.note (buildActiveRideSeed)

  -- driver.* (ride.driver)
  driver_name           TEXT NULL,    -- driver.name
  driver_initials       TEXT NULL,    -- driver.initials
  driver_rating         TEXT NULL,    -- driver.rating
  driver_car            TEXT NULL,    -- driver.car
  driver_online_label   TEXT NULL,    -- driver.onlineLabel
  driver_shift_duration TEXT NULL,    -- driver.shiftDuration
  -- ride.selectedDriver.responseId — the accepted-response pin. resolveDriverSnapshotForRide
  -- REFUSES to infer the accepted driver without this exact pin (avoids swapping in an
  -- unrelated latest response), so it is load-bearing across cutover.
  selected_driver_response_id TEXT NULL,

  -- vehicle.* (ride.vehicle from buildActiveRideSeed)
  vehicle_model  TEXT NULL,           -- vehicle.model
  vehicle_color  TEXT NULL,           -- vehicle.color
  vehicle_plate  TEXT NULL,           -- vehicle.plate

  -- order.* (ride.order display block — all client-persisted as strings)
  order_offer_price          TEXT NULL,    -- order.offerPrice
  order_rate                 TEXT NULL,    -- order.rate
  order_commission           TEXT NULL,    -- order.commission
  order_accept_timer_sec     INTEGER NULL, -- order.acceptTimerSec
  order_pickup_eta           TEXT NULL,    -- order.pickupEta
  order_pickup_distance      TEXT NULL,    -- order.pickupDistance
  order_destination_eta      TEXT NULL,    -- order.destinationEta
  order_destination_distance TEXT NULL,    -- order.destinationDistance
  order_destination_note     TEXT NULL,    -- order.destinationNote
  order_tags                 JSONB NULL,   -- order.tags (string array)

  -- route.* (ride.route)
  route_pickup_label         TEXT NULL,    -- route.pickupLabel
  route_dropoff_label        TEXT NULL,    -- route.dropoffLabel
  route_current_instruction  TEXT NULL,    -- route.currentInstruction
  route_current_street       TEXT NULL,    -- route.currentStreet
  route_distance_to_pickup   TEXT NULL,    -- route.distanceToPickup
  route_eta_to_pickup        TEXT NULL,    -- route.etaToPickup
  route_eta_to_destination   TEXT NULL,    -- route.etaToDestination
  route_pickup_lng           DOUBLE PRECISION NULL,  -- route.pickup.lng
  route_pickup_lat           DOUBLE PRECISION NULL,  -- route.pickup.lat
  route_dropoff_lng          DOUBLE PRECISION NULL,  -- route.dropoff.lng
  route_dropoff_lat          DOUBLE PRECISION NULL,  -- route.dropoff.lat

  -- ride.* (ride.ride stats)
  ride_price          TEXT NULL,       -- ride.price (history pickFare fallback)
  ride_distance       TEXT NULL,       -- ride.distance (history pickDistance)
  ride_duration       TEXT NULL,       -- ride.duration (history pickDuration)
  ride_today_earnings TEXT NULL,       -- ride.todayEarnings
  ride_trips_today    INTEGER NULL,    -- ride.tripsToday
  ride_rating         TEXT NULL,       -- ride.rating: the DRIVER's dashboard/overall rating seeded on the active ride (NOT the rider's submitted score)
  -- passenger completion feedback (buildPassengerHistoryEntry's ratingPayload ->
  -- ride_history.v1); surfaced by Profile history card/detail. feedback_rating is the
  -- rider's SUBMITTED score (ratingPayload.rating), DISTINCT from ride_rating above.
  feedback_rating     SMALLINT NULL CHECK (feedback_rating IS NULL OR feedback_rating BETWEEN 0 AND 5),
  feedback_tags       JSONB NULL,       -- ratingPayload.tags (array)
  feedback_comment    TEXT NULL,        -- ratingPayload.comment (free-text)

  -- waiting.* (ride.waiting)
  waiting_free_limit     TEXT NULL,    -- waiting.freeLimit
  waiting_remaining      TEXT NULL,    -- waiting.remaining
  waiting_paid_starts_at TEXT NULL,    -- waiting.paidStartsAt
  waiting_paid_rate      TEXT NULL,    -- waiting.paidRate

  -- payment.* (ride.payment)
  payment_last4   TEXT NULL,           -- payment.last4
  payment_method  TEXT NULL,           -- payment.method
  payment_note    TEXT NULL,           -- payment.note
  payment_amount  TEXT NULL,           -- payment.amount (history pickFare reads this first)

  -- cancel.* (ride.cancel, cancelActiveRide). cancel.by may be 'system' here
  -- (cancelActiveRide), unlike the order overlay which only writes passenger/driver.
  cancel_by      TEXT NULL CHECK (cancel_by IS NULL OR cancel_by IN ('driver', 'passenger', 'system')),
  cancel_reason  TEXT NULL,            -- cancel.reason
  cancel_comment TEXT NULL,            -- cancel.comment

  -- provenance
  seeded_from TEXT NULL,               -- seededFrom ('trip_confirmation_handoff')
  chat_unread INTEGER NOT NULL DEFAULT 0,  -- chat.unread

  -- timestamps.* (ride.timestamps — status-keyed lifecycle stamps; domain time,
  -- ISO strings the client writes, NOT server insert clocks)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),  -- timestamps.createdAt
  accepted_at    TIMESTAMPTZ NULL,     -- timestamps.acceptedAt (ACCEPTED/DRIVER_EN_ROUTE)
  approaching_at TIMESTAMPTZ NULL,     -- timestamps.approachingAt (DRIVER_APPROACHING_PICKUP)
  arrived_at     TIMESTAMPTZ NULL,     -- timestamps.arrivedAt (WAITING_PASSENGER)
  started_at     TIMESTAMPTZ NULL,     -- timestamps.startedAt (IN_PROGRESS)
  completed_at   TIMESTAMPTZ NULL,     -- timestamps.completedAt (COMPLETED)
  canceled_at    TIMESTAMPTZ NULL,     -- timestamps.canceledAt (CANCELED/NO_SHOW)
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- terminal-cancel / completion stamp invariants (mirror STATUS_TIMESTAMP_FIELD).
  CONSTRAINT rides_terminal_cancel_stamp CHECK (
    status NOT IN ('CANCELED', 'NO_SHOW') OR canceled_at IS NOT NULL
  ),
  CONSTRAINT rides_completed_stamp CHECK (
    status <> 'COMPLETED' OR completed_at IS NOT NULL
  )
);

DROP TRIGGER IF EXISTS trg_rides_updated_at ON rides;
CREATE TRIGGER trg_rides_updated_at
  BEFORE UPDATE ON rides FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- TERMINAL-STATUS FREEZE TRIGGER -----------------------------------------------
-- ride_state.js TERMINAL_RIDE_STATUSES = {CANCELED, NO_SHOW, COMPLETED}.
-- saveActiveRide / updateActiveRideStatus / cancelActiveRide all refuse a
-- transition OUT of a terminal status. The DB enforces the same invariant so a
-- stale/forged write or a racing tab cannot thaw a terminal ride. An idempotent
-- re-save of the SAME terminal status passes (a field patch on a terminal record
-- without changing status lands) — matching the client's
-- 'ride.status !== existing.status' guard.
CREATE OR REPLACE FUNCTION rides_freeze_terminal()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('CANCELED', 'NO_SHOW', 'COMPLETED')
     AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'ride % is terminal (%): cannot transition to %',
      OLD.trip_id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rides_freeze_terminal ON rides;
CREATE TRIGGER trg_rides_freeze_terminal
  BEFORE UPDATE ON rides FOR EACH ROW EXECUTE FUNCTION rides_freeze_terminal();

-- =============================================================================
-- 9. ride_events  (APPEND-ONLY)
-- localStorage: bazardrive.trip_confirmation.v1 + bazardrive.driver_handoff_snapshot.v1
--               ·  BD-DOCS-031 **ride_events** (S)
-- -----------------------------------------------------------------------------
-- Append-only absorption of the two tripId-keyed handoff records. The client
-- overwrites map[tripId] per write; the SERVER timeline keeps every emission as
-- an immutable row, and the read model picks the latest per (ride, type).
-- createdAt/expiresAt/savedAt are bigint epoch-ms because the client persists
-- Date.now() integers and does numeric comparisons (isHandoffExpired /
-- isSnapshotStale) — storing ms preserves that arithmetic exactly.
-- =============================================================================
CREATE TABLE IF NOT EXISTS ride_events (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- FK to the owning ride — NULLABLE: /chat writes a trip_confirmation handoff
  -- BEFORE the active-ride row necessarily exists (seedActiveRideFromConfirmedHandoff
  -- creates the ride only when /trip-confirmation or /active-ride opens). trip_id is
  -- the stable business key; ride_id is backfilled when the ride is seeded.
  ride_id   UUID NULL REFERENCES rides(id) ON DELETE CASCADE,
  -- denormalized business key so an event can be written/looked up by the same
  -- tripId the client uses, even before the ride row is resolved at cutover.
  trip_id   TEXT NOT NULL,
  -- event-type discriminator. Phase-1 producers:
  --   'trip_confirmation'        — chat -> /trip-confirmation handoff (role='passenger')
  --   'driver_handoff_snapshot'  — /trip-confirmation -> /active-ride?role=driver
  type      TEXT NOT NULL
              CHECK (type IN ('trip_confirmation', 'driver_handoff_snapshot')),
  -- `role` carried verbatim (loadConfirmedHandoff gates on an exact role match).
  role      TEXT NULL CHECK (role IS NULL OR role IN ('passenger', 'driver')),

  -- trip_confirmation.v1 fields (handoff object)
  response_id          TEXT NULL,                                      -- handoff.responseId
  -- handoff.state — loadConfirmedHandoff refuses anything but 'CONFIRMED'.
  state                TEXT NULL CHECK (state IS NULL OR state IN ('CONFIRMED')),
  source_created_at_ms BIGINT NULL,                                    -- handoff.createdAt (epoch ms)
  expires_at_ms        BIGINT NULL,                                    -- handoff.expiresAt (createdAt + 30 min)

  -- driver_handoff_snapshot.v1 fields (saveDriverHandoffSnapshot)
  order_ref       TEXT NULL,    -- snapshot.orderId (falls back to tripId)
  passenger_name  TEXT NULL,    -- snapshot.passengerName
  pickup_label    TEXT NULL,    -- snapshot.pickupLabel
  dropoff_label   TEXT NULL,    -- snapshot.dropoffLabel
  agreed_price    TEXT NULL,    -- snapshot.agreedPrice
  eta_text        TEXT NULL,    -- snapshot.etaText
  -- snapshot.status — a FREE display string (DRIVER_HANDOFF_SNAPSHOT_FALLBACK
  -- 'DRIVER_EN_ROUTE'); NOT bound to the 12-enum (the client never validates it).
  snapshot_status TEXT NULL,
  saved_at_ms     BIGINT NULL,  -- snapshot.savedAt (epoch ms; TTL 30 min)

  -- full original record retained losslessly so the append-only timeline can
  -- replay either producer shape without column drift as fields evolve.
  payload   JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- server insert time (the append-only `at` of BD-DOCS-031 ride_events).
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- APPEND-ONLY enforcement (BD-DOCS-041: ride_events is an append-only timeline).
-- The ONLY permitted mutation is the one-time ride_id BACKFILL (NULL -> a ride id)
-- for a handoff written before its ride existed; every other column must be
-- unchanged (whole-row compare with ride_id normalized). DELETE and any content
-- change remain forbidden. The read model (ride_history view) picks latest per (ride,type).
CREATE OR REPLACE FUNCTION ride_events_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_norm ride_events%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.ride_id IS NULL AND NEW.ride_id IS NOT NULL THEN
    old_norm := OLD;
    old_norm.ride_id := NEW.ride_id;          -- normalize the single allowed change
    IF NEW IS NOT DISTINCT FROM old_norm THEN
      RETURN NEW;                             -- pure ride_id backfill; nothing else changed
    END IF;
  END IF;
  RAISE EXCEPTION 'ride_events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'raise_exception';
END;
$$;

DROP TRIGGER IF EXISTS trg_ride_events_no_mutation ON ride_events;
CREATE TRIGGER trg_ride_events_no_mutation
  BEFORE UPDATE OR DELETE ON ride_events FOR EACH ROW
  EXECUTE FUNCTION ride_events_block_mutation();

-- =============================================================================
-- 10. messages
-- localStorage: bazardrive.chat.v1 (chat.js CHAT_KEY)  ·  BD-DOCS-031 **messages** (S)
-- -----------------------------------------------------------------------------
-- Per-chat thread store { [chatId]: [{id, senderRole, dir, text, time}, ...] }.
-- chat_id is the literal map key ('trip-<tripId>'/'response-<responseId>'/'demo').
-- sender_role is the canonical BD-CHAT-02 authorship field; legacy `dir` is kept
-- as the documented fallback (directionForMessage). The client per-message int id
-- is demoted from PK (not globally unique) to a dedup key.
-- =============================================================================
CREATE TABLE IF NOT EXISTS messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- thread key the client computes (chat.js): 'trip-<tripId>' / 'response-<responseId>' / 'demo'.
  chat_id     TEXT NOT NULL,
  -- resolved FKs derived from the chat_id prefix; nullable for bare feed-post and
  -- demo threads.
  ride_id     UUID NULL REFERENCES rides(id) ON DELETE SET NULL,
  response_id TEXT NULL,    -- the legacy <responseId> string from a 'response-' chat_id
  -- the legacy response_id ('resp_<post.id>') is AMBIGUOUS across drivers (responses.
  -- legacy_id is non-unique); response_uuid is the unique per-response thread scope the
  -- server groups a conversation by. Nullable for trip-/demo-threads with no response.
  response_uuid UUID NULL REFERENCES responses(id) ON DELETE CASCADE,
  -- canonical authorship (BD-CHAT-02; doSend stamps senderRole = viewerRole).
  sender_role TEXT NULL CHECK (sender_role IS NULL OR sender_role IN ('driver', 'passenger')),
  -- client per-message int (Date.now()) — dedup/idempotency key for re-import.
  client_msg_id BIGINT NULL,
  -- msg.text — body. NOT NULL (the client never persists an empty message).
  body        TEXT NOT NULL,
  -- msg.time — display stamp ('14:21', HH:MM); verbatim, cosmetic.
  display_time TEXT NULL,
  -- legacy direction ('in'|'out'); retained for faithful import of pre-senderRole
  -- records (MOCK_MESSAGES + legacy stores). Readers prefer sender_role.
  legacy_dir  TEXT NULL CHECK (legacy_dir IS NULL OR legacy_dir IN ('in', 'out')),
  -- server-authoritative ordering/creation time (the BD-DOCS-031 `at`).
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 11. receipts
-- localStorage: bazardrive.driver_receipts.v1 (mock_api.js DRIVER_RECEIPTS_KEY)
--               ·  BD-DOCS-031 **receipts** (S)  ·  BD-RIDE-HISTORY-D-01 / #381
-- -----------------------------------------------------------------------------
-- Canonical post-completion financial document, 1:1 with a ride. net is computed
-- ONCE by the driver-earnings flow and PERSISTED; every reader only FORMATS these
-- numbers and NEVER recomputes (no-recompute invariant) — so net is a plain
-- stored INTEGER, NOT a GENERATED column. commission is stored ALREADY SIGNED
-- (negative). Whole-ruble integers (sanitizeDriverReceipt -> Math.round).
-- =============================================================================
CREATE TABLE IF NOT EXISTS receipts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 1:1 with a ride. The client store keys receipts by tripId; on the server the
  -- ride is the owning entity, so the natural key becomes ride_id FK. RESTRICT so
  -- a financial document can never be silently orphaned by a ride delete.
  ride_id       UUID NOT NULL REFERENCES rides(id) ON DELETE RESTRICT,
  -- completedAt — DOMAIN time supplied by the completion flow (NOT a server insert
  -- clock) so the history calendar matches what the client wrote.
  completed_at  TIMESTAMPTZ NOT NULL,
  fare          INTEGER NOT NULL,                              -- receipt.fare
  -- commission stored ALREADY SIGNED (negative); CHECK enforces the sign invariant.
  commission    INTEGER NOT NULL CHECK (commission <= 0),      -- receipt.commission
  tip           INTEGER NOT NULL CHECK (tip >= 0),             -- receipt.tip
  net           INTEGER NOT NULL,                              -- receipt.net (once-computed, stored)
  -- receipt.paymentMode (VALID_PAYMENT_MODES; default 'noncash' in sanitize).
  payment_mode  TEXT NOT NULL DEFAULT 'noncash'
                  CHECK (payment_mode IN ('cash', 'noncash')),
  -- receipt.status — the client always writes the literal 'completed'.
  status        TEXT NOT NULL DEFAULT 'completed' CHECK (status = 'completed'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- upsert-by-tripId in the client => exactly one receipt per ride.
  CONSTRAINT receipts_ride_uniq UNIQUE (ride_id)
);

DROP TRIGGER IF EXISTS trg_receipts_updated_at ON receipts;
CREATE TRIGGER trg_receipts_updated_at
  BEFORE UPDATE ON receipts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- INDEXES
-- (PRIMARY KEY / UNIQUE constraints already create their own indexes; the below
--  are the additional access-path indexes per group.)
-- =============================================================================

-- users: FK anchor stub. role directory deferred to BD-DOCS-032.
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role) WHERE role IS NOT NULL;

-- vehicles: per-driver garage reads; single-active invariant; active list.
CREATE INDEX IF NOT EXISTS idx_vehicles_owner ON vehicles(owner_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicles_one_active
  ON vehicles(owner_user_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_vehicles_owner_active_list
  ON vehicles(owner_user_id) WHERE archived = FALSE;

-- posts: newest-first feed; per-author «Мои публикации»; type grouping.
CREATE INDEX IF NOT EXISTS idx_posts_feed ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_my
  ON posts(author_id, created_at DESC) WHERE created_by_current_user;
CREATE INDEX IF NOT EXISTS idx_posts_type ON posts(type);
-- tag-search GIN deferred (search is UI-only/no-op today).

-- orders: hot listNearbyOrders path (status='CREATED'); passenger views; recency.
CREATE INDEX IF NOT EXISTS idx_orders_created_status
  ON orders(created_at DESC) WHERE status = 'CREATED';
CREATE INDEX IF NOT EXISTS idx_orders_passenger ON orders(passenger_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- responses: loadResponsesForOrder + resolveLatestDriverSnapshotForOrder; by post.
CREATE INDEX IF NOT EXISTS idx_responses_order_kind
  ON responses(order_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_responses_request ON responses(request_id);
CREATE INDEX IF NOT EXISTS idx_responses_author ON responses(author_id);

-- offers: candidates per order; TTL/expiry job.
CREATE INDEX IF NOT EXISTS idx_offers_order_status ON offers(order_id, status);
CREATE INDEX IF NOT EXISTS idx_offers_expiry
  ON offers(expires_at) WHERE status = 'sent';

-- assignment: driver's assigned-orders view (cancelOrderByDriver gate).
CREATE INDEX IF NOT EXISTS idx_assignment_selected_driver
  ON assignment(selected_driver_id);

-- rides: FK; active-ride dashboards (mirror TERMINAL_ACTIVE_RIDE_STATUSES);
-- per-user active lookup once the users stub is replaced.
CREATE INDEX IF NOT EXISTS idx_rides_order ON rides(order_id);
CREATE INDEX IF NOT EXISTS idx_rides_active
  ON rides(updated_at) WHERE status NOT IN ('COMPLETED', 'CANCELED', 'NO_SHOW');
CREATE INDEX IF NOT EXISTS idx_rides_driver_status ON rides(driver_user_id, status);
CREATE INDEX IF NOT EXISTS idx_rides_passenger_status ON rides(passenger_user_id, status);

-- ride_events: latest event of each type per ride (read model); pre-cutover
-- business-key path; confirmation trace. No UNIQUE (append-only).
CREATE INDEX IF NOT EXISTS idx_ride_events_ride_type
  ON ride_events(ride_id, type, at DESC);
CREATE INDEX IF NOT EXISTS idx_ride_events_trip_type
  ON ride_events(trip_id, type, at DESC);
CREATE INDEX IF NOT EXISTS idx_ride_events_response ON ride_events(response_id);

-- messages: load one thread in order (dominant query); ride/response joins;
-- idempotent local-thread re-import.
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_ride ON messages(ride_id);
CREATE INDEX IF NOT EXISTS idx_messages_response ON messages(response_id);
-- client_msg_id is a per-client Date.now() millisecond stamp, NOT a global id — scope
-- dedupe by a NON-NULL participant discriminator so (a) a driver and passenger sending
-- in the SAME ms stay distinct and (b) legacy NULL-sender imports still dedupe on replay
-- (NULLs are distinct in a UNIQUE index, so COALESCE to legacy_dir then a sentinel). The
-- server UUID PK remains the message identity.
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_client_id
  ON messages(chat_id, COALESCE(sender_role, legacy_dir, '~'), client_msg_id)
  WHERE client_msg_id IS NOT NULL;

-- receipts: point lookup (/receipt?tripId=) via the unique ride_id; payouts
-- calendar (listDriverReceipts sorts by completedAt desc).
CREATE INDEX IF NOT EXISTS idx_receipts_completed_at ON receipts(completed_at DESC);

-- =============================================================================
-- 12. ride_history  (VIEW — read model)
-- localStorage: bazardrive.ride_history.v1 (ride_history.js HISTORY_KEY)
--               ·  BD-DOCS-031 ride history — "derivable from rides + events"
-- -----------------------------------------------------------------------------
-- READ MODEL, not a base table. The client store is role-scoped (one row per
-- `${role}:${tripId}`, saveRideHistoryEntry), so the VIEW emits up to TWO rows
-- per completed ride — one per role — reproducing the localStorage shape. It
-- FORMATS nothing and RECOMPUTES nothing (BD-RIDE-HISTORY-D-01): the driver row's
-- money comes straight off receipts. COMPLETED-only, matching shipped behavior
-- (the client only saves history on completion via the earnings flow).
--
-- View columns reference the REAL rides column names
-- (route_pickup_label / ride_price / ride_distance / ride_duration / etc.) and
-- the receipts / ride_events tables; nothing is invented.
-- =============================================================================
DROP VIEW IF EXISTS ride_history;
CREATE VIEW ride_history AS
-- PASSENGER projection (buildPassengerHistoryEntry) ----------------------------
SELECT
  r.id                                            AS ride_id,
  r.trip_id                                       AS trip_id,
  'passenger'::text                               AS role,
  r.order_id                                      AS order_id,
  r.completed_at                                  AS completed_at,        -- timestamps.completedAt (when the ride completed)
  r.passenger_user_id                             AS viewer_user_id,
  r.driver_user_id                                AS counterparty_id,     -- passenger sees the driver
  r.driver_name                                   AS counterparty_name,   -- entry.driver.name
  r.driver_rating                                 AS counterparty_rating, -- entry.driver.rating
  r.vehicle_model                                 AS vehicle_model,       -- entry.vehicle.*
  r.vehicle_color                                 AS vehicle_color,
  r.vehicle_plate                                 AS vehicle_plate,
  r.route_pickup_label                            AS pickup_label,
  r.route_dropoff_label                           AS dropoff_label,
  COALESCE(r.payment_amount, r.ride_price)        AS fare,                -- pickFare: payment.amount, else ride.price
  r.ride_distance                                 AS distance,
  r.ride_duration                                 AS duration,
  r.feedback_rating                               AS rating,              -- rider's SUBMITTED score (ratingPayload.rating)
  r.feedback_tags                                 AS tags,                -- rider's rating tags
  r.feedback_comment                              AS comment,             -- rider's free-text comment
  NULL::integer                                   AS receipt_net,         -- passenger row carries no receipt
  NULL::integer                                   AS receipt_commission,
  NULL::integer                                   AS receipt_tip,
  NULL::text                                      AS receipt_payment_mode
FROM rides r
WHERE r.status = 'COMPLETED'

UNION ALL

-- DRIVER projection (buildDriverHistoryEntry) ---------------------------------
SELECT
  r.id                                            AS ride_id,
  r.trip_id                                       AS trip_id,
  'driver'::text                                  AS role,
  r.order_id                                      AS order_id,
  -- driver completedAt prefers the canonical receipt time, then ride completed_at.
  COALESCE(rc.completed_at, r.completed_at)       AS completed_at,
  r.driver_user_id                                AS viewer_user_id,
  r.passenger_user_id                             AS counterparty_id,     -- driver sees the passenger
  r.passenger_name                                AS counterparty_name,   -- entry.passenger.name
  r.passenger_rating                              AS counterparty_rating, -- entry.passenger.rating
  r.vehicle_model                                 AS vehicle_model,       -- the driver's own vehicle
  r.vehicle_color                                 AS vehicle_color,
  r.vehicle_plate                                 AS vehicle_plate,
  r.route_pickup_label                            AS pickup_label,
  r.route_dropoff_label                           AS dropoff_label,
  -- driver fare prefers the canonical receipt fare (BD-RIDE-HISTORY-D-01
  -- 'receipt' object); read-only, no recompute. Falls back to the ride display.
  COALESCE(rc.fare::text, r.payment_amount, r.ride_price) AS fare,
  r.ride_distance                                 AS distance,
  r.ride_duration                                 AS duration,
  NULL::smallint                                  AS rating,              -- driver entry carries no rider score
  NULL::jsonb                                     AS tags,
  NULL::text                                      AS comment,
  rc.net                                          AS receipt_net,         -- receipts.* (already computed; no recompute)
  rc.commission                                   AS receipt_commission,  -- Profile renders receipt.commission
  rc.tip                                          AS receipt_tip,         -- Profile renders receipt.tip
  rc.payment_mode                                 AS receipt_payment_mode
FROM rides r
LEFT JOIN receipts rc ON rc.ride_id = r.id
WHERE r.status = 'COMPLETED';

COMMIT;

-- =============================================================================
-- DEFERRED (not in Phase-1, per BD-DOCS-041 / BD-DOCS-031):
--   * Full identity/auth model on users  -> BD-DOCS-032 (#585) ALTERs this stub.
--   * PostGIS / typed geo columns         -> Phase-3 nearby-drivers (BD-DOCS-035).
--   * Redis / presence / caching          -> BD-DOCS-033 (#2 Presence).
--   * MATERIALIZED ride_history           -> revisit under #8 if the read becomes hot
--                                            (UNIQUE(ride_id, role) + REFRESH on completion).
--   * Native uuidv7() SQL function        -> repository layer is the canonical v7
--                                            emitter; the gen_random_uuid() DEFAULT
--                                            is a never-hit fallback.
-- =============================================================================
