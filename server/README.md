# `/server` — BazarDrive backend (Phase 1)

> Per ADR **BD-DOCS-041** (`docs-site/docs/decisions/backend-home-and-stack.md`), the
> self-hosted Node service lives here. It contains the ordered PostgreSQL schema,
> repository layer and Fastify application. Several Phase-1 routes are implemented
> and database-backed, but the system is **pilot-blocked**: it is not a production
> deployment and live server routes do not imply that the PWA may activate them.
> Current authority and activation tracking live in **BD-BACKEND-BASELINE-01 (#821)**
> under **Epic #820**.

## Running the server

```bash
cd server
nvm use                 # Node 22 (server's own .nvmrc; repo .nvmrc=20 is untouched)
cp .env.example .env    # set DATABASE_URL (Postgres 16); ALLOWED_ORIGIN in prod
npm ci
npm run migrate         # apply migrations/*.sql in order
npm run seed            # dev seed (stub — per-entity seeders land with their module PRs)
npm run dev             # node --watch; or `npm start` / `docker compose up`
npm test                # node:test — enum-parity + route smokes
```

## Current route baseline

`LIVE` means registered and implemented, with database I/O where the route contract
requires it; the liveness route intentionally performs no I/O. `DARK` means the seam is
present but intentionally not implemented; `PILOT-BLOCKED` means code exists but an authorization,
delivery, operations or activation gap still prevents pilot use.

| Module / route | State | Boundary that matters before pilot |
|---|---|---|
| `GET /api/v1/health`, `GET /api/v1/readyz` | LIVE | Readiness checks database connectivity and migration state. |
| `/api/v1/auth/*` | LIVE / PILOT-BLOCKED | Session and OTP request/verify exist; OTP throttling/delivery and final session policy remain. |
| `/api/v1/orders` | LIVE | Created-order read is public; create requires a live authenticated session, while `phone_verified` and passenger-role enforcement remain pilot gates. |
| `/api/v1/matching` | LIVE / PILOT-BLOCKED | Owner/self-offer checks exist; offer creation requires a live authenticated session, while `phone_verified`, granted driver role and readiness are not enforced yet. |
| `/api/v1/ride-state` | LIVE | Participant-only; terminal freeze and append-only events are authoritative. |
| `/api/v1/realtime/poll` | LIVE | Participant-only cursor polling; WebSocket/SSE push remains dark. |
| `/api/v1/history` | LIVE | Authenticated reads; completed-ride receipt write is driver-only and write-once. |
| `/api/v1/chat` | LIVE persistence / PILOT-BLOCKED | Participant authorization is absent and sender role is still request-supplied. |
| Availability, route price, notifications, safety | DARK | No pilot contract or activation. |
| Metrics | DARK | Observability policy is not frozen. |

Current contract notes:

- `GET /api/v1/auth/session` resolves identity from `auth_session` only; it does not read or join `users`.
- OTP verification reads the latest live OTP and commits the attempt increment before the success transaction. On a correct code, one transaction consumes the OTP, upserts/verifies the user and inserts the session; the separately committed attempt count persists on failed verification.
- Order and offer creation require a live authenticated session. They expose `phoneVerified` but do not enforce it yet.
- Product-route errors use `{ error, code, retryable }`. `GET /api/v1/readyz` is an operational exception: failure is HTTP 503 `{ status: 'degraded', db }` without a machine code.
- The fallback preserves Fastify `err.code` for non-validation 4xx failures, including `FST_ERR_CTP_EMPTY_JSON_BODY` and `FST_ERR_CTP_INVALID_JSON_BODY`.

The detailed current-state matrix, PWA seams, error-code policy and delivery dependencies
are governed by
`docs-site/docs/processes/backend-spine-inspector.md`.

## Pilot safety boundaries

- A client cutover stays guarded until its module-specific exit conditions are met.
- PostgreSQL/server domain rules own order, offer, assignment and ride state after activation.
- Matching selection is transactional; terminal rides are frozen; `ride_events` is append-only.
- Chat must not be activated until sender identity and order/ride participation are session-derived.
- OTP delivery/rate limiting, driver role/readiness, deploy/rollback and observability are pilot gates.
- API responses remain outside the service-worker cache.

## Origins and CI gates

The PWA stays on GitHub Pages; `/server` deploys to a separate origin (for example,
`https://api.bazardrive.<domain>`). CORS (`@fastify/cors`) and the client CSP
`connect-src` allow-list exactly that origin through a later reviewed activation
change, never a wildcard. The service worker excludes cross-origin `/api`.

Client and server gates remain independent:

- `node scripts/check.mjs` and `node scripts/dispatcher.mjs` for the client/docs boundary;
- `cd server && npm test` for server enum parity and route behavior;
- `server-ci.yml` against `postgres:16`: ordered/idempotent migrations plus object asserts,
  then `npm ci`, production dependency audit, migration and Node 22 tests, plus the
  non-publishing container contract/liveness smoke.

The governed 01A container contract and future 01B staging/rollback procedure are in
[`BD-DOCS-043`](../docs-site/docs/processes/backend-staging-container-runbook.md).
Staging is not deployed and rollback is not rehearsed yet; Issue #823 remains open.

## Layout (ADR BD-DOCS-041 §`/server` layout)

```text
src/
  server.js / index.js / config.js   buildApp() (testable, no listen) + entrypoint + env
  infra/    db(ACTIVE) cache storage bus(dark) logger
  plugins/  error-handler cors helmet auth(session seam) realtime(polling live; push dark)
  domain/   ride-status.js (VERBATIM mirror of ride_state.js) + entities.js (JSDoc)
  services/ auth/session/OTP, orders, matching, ride-state, history and chat implemented
            availability, route-price, notifications and safety dark
  repositories/ the ONLY SQL seam
  routes/   health/readiness live; metrics dark
scripts/    migrate.mjs        test/  node:test (enum-parity gate + route smokes)
```

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
