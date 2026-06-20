# `/server` — BazarDrive backend (Phase 1)

> Per ADR **BD-DOCS-041** (`docs-site/docs/decisions/backend-home-and-stack.md`): a
> self-hosted Node service lives here. **Today this directory contains only the
> Phase-1 database schema** (`#584`) — the Fastify app, repository layer, auth and
> CI are later scoped PRs. `status: draft` work; nothing here is deployed.

# Phase-1 Schema Overview — `/server/migrations/0001_phase1_init.sql`

SQL realization of **BD-DOCS-031** (data-layer contract) on the stack fixed by **BD-DOCS-041** (PostgreSQL 16, thin repository layer, ordered SQL migrations). It is a faithful 1:1 mapping of the field shapes the client persists **today**, so the cutover behind `public/src/data_layer.js` introduces **no contract change**. Persisted literals the client depends on are preserved verbatim.

## Table ↔ localStorage-key ↔ BD-DOCS-031 entity

| Table | localStorage key | BD-DOCS-031 entity | Source file (shape) |
|---|---|---|---|
| `users` (stub) | `bazardrive.user.v1` | users (kind **C** — stub FK anchor only) | `state.js` |
| `vehicles` | *(driver profile: `driverGarage.vehicles[]` + `activeVehicleId` + legacy `vehicle*`)* | vehicles | `state.js` / `garage.js` |
| `posts` | `bazardrive.posts.v1` + `bazardrive.myposts.v1` | posts (marketplace/feed) | `mock_api.js` / `composer.js` |
| `orders` | `bazardrive.ride_orders.v1` | orders | `mock_api.js` |
| `responses` | `bazardrive.responses.v1` (+ `respond.v1` draft, not modeled) | responses | `respond.js` / `responses.js` / `chat.js` |
| `offers` | `bazardrive.driver_offers.v1` | offers | `driver_offer_store.js` |
| `assignment` | `bazardrive.order_overlay.v1` | assignment | `driver_offer_store.js` |
| `rides` | `bazardrive.active_ride.v1` | rides | `ride_state.js` |
| `ride_events` (append-only) | `bazardrive.trip_confirmation.v1` + `bazardrive.driver_handoff_snapshot.v1` | ride_events | `chat.js` / `trip_confirmation_handoff.js` / `driver_handoff_snapshot.js` |
| `messages` | `bazardrive.chat.v1` | messages | `chat.js` |
| `receipts` | `bazardrive.driver_receipts.v1` | receipts | `mock_api.js` |
| `ride_history` (**VIEW**) | `bazardrive.ride_history.v1` | ride history (derivable read model) | `ride_history.js` |

Tables are created in FK-dependency order: `users` → `vehicles`/`posts` → `orders` → `responses`/`offers`/`assignment` → `rides` → `ride_events`/`messages`/`receipts` → `ride_history` VIEW.

## Status / terminal model

- **`rides.status`** = `TEXT + CHECK` over the **exact 12 RIDE_STATUS literals** from `public/src/ride_state.js`: `NEW_ORDER, CONFIRMATION_PENDING, CONFIRMED, CHAT_STARTED, ACCEPTED, DRIVER_EN_ROUTE, DRIVER_APPROACHING_PICKUP, WAITING_PASSENGER, IN_PROGRESS, COMPLETED, CANCELED, NO_SHOW`. TEXT+CHECK (not a PG enum) so adding a literal is an ordered migration, not an `ALTER TYPE`.
- **Terminal freeze** = `trg_rides_freeze_terminal` (BEFORE UPDATE). The frozen set `{CANCELED, NO_SHOW, COMPLETED}` (ride_state.js `TERMINAL_RIDE_STATUSES`) cannot transition OUT to a different status; an idempotent re-save of the **same** terminal status (a field patch) passes, mirroring the client's `status !== existing.status` guard.
- **`ride_events` append-only** = `trg_ride_events_no_mutation` blocks any `UPDATE`/`DELETE`. The client overwrites `map[tripId]` per write; the server keeps every emission and the `ride_history` view picks the latest.
- **Other status enums preserved verbatim**: `orders.status` (`CREATED/ACCEPTED/CANCELED`, distinct from RIDE_STATUS), `assignment.status` (`ACCEPTED/CANCELED` + actor invariant CHECKs), `offers.status` (full Model B set `sent/withdrawn/accepted/rejected/expired`, `UNIQUE(order_id, driver_id)` idempotency), `responses.kind` (`passenger_response`/`marketplace_message` — load-bearing, `/responses` filters on it), `responses.canonical` (only `'ride_order'`), `receipts.payment_mode` (`cash/noncash`) and `status='completed'`.

## Faithfulness notes

- **IDs**: server-generated time-ordered UUID (v7-style) PKs; `gen_random_uuid()` DEFAULT is only a fallback — the `pg` repository layer emits the v7 value on INSERT. Client string ids (`order_1001`, `resp_<post.id>`, `offer_<o>_<d>`, `trip_<orderId>`) are kept as `legacy_id` / `trip_id` business keys so existing string linkages (responses↔orders, chat↔ride) survive cutover.
- **Display strings kept as TEXT** (`'4,86'`, `'1 480 ₽'`, `'12 ₽ / км'`) — the client persists these unparsed and history re-reads them as strings; flattening to numbers would break readers.
- **`receipts.net` is a plain stored INTEGER, not GENERATED** — the no-recompute invariant (BD-RIDE-HISTORY-D-01); `commission` is stored already SIGNED negative (CHECK `<= 0`).
- **JSONB** for nested objects the client stores as-is (`orders.pickup/dropoff/passenger_snapshot`, `*.tags`, `responses.driver_snapshot`, `ride_events.payload`) so handoff reads stay verbatim.
- **Monotonic `updated_at`** on `offers`/`assignment` is domain-supplied (`bumpedIso`) — those tables intentionally have **no** `set_updated_at` trigger; mutable tables that own their timestamp (`users`, `vehicles`, `orders`, `rides`, `receipts`) do.

## Deferred (out of Phase-1 scope)

- **Full identity / auth / compliance model** on `users` — owned by **BD-DOCS-032 (#585)**, which will `ALTER` this stub (avoiding a parallel id space). Driver-doc/readiness/profile fields are deliberately omitted.
- **Geo / PostGIS** — no `CREATE EXTENSION postgis`; typed lng/lat live as `JSONB`/`DOUBLE PRECISION` placeholders until Phase-3 nearby-drivers (**BD-DOCS-035**).
- **Redis / presence / caching** — **BD-DOCS-033** (#2 Presence).
- **Materialized `ride_history`** — Phase-1 ships a plain VIEW; promote to MATERIALIZED (UNIQUE `(ride_id, role)` + REFRESH on completion) under #8 if the read gets hot.
- **`respond.v1` draft, demo/seed fixtures** (`DEMO_DRIVER_RECEIPT` tripId `48-321`, demo rides) — client-only UI state, not inserted as rows.
