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
nvm use                 # Node 22 (server's own .nvmrc; the repo root .nvmrc pins 22 too)
cp .env.example .env    # set DATABASE_URL (Postgres 16); ALLOWED_ORIGIN in prod
                        # RECEIPT_COMMISSION_PERCENT: receipt commission, decimal 0..100 (unset = 12)
                        # DRIVER_ENROLLMENT_AUTO_APPROVE: true|false (unset = false) — local stand
                        #   only; approves driver applications at once; forbidden in production
npm ci
npm run migrate         # apply migrations/*.sql in order
npm run seed            # dev seed (stub — per-entity seeders land with their module PRs)
npm run dev             # node --watch; or `npm start` / `docker compose up`
npm test                # node:test — enum-parity + route smokes
```

Driver applications are decided by an operator with `npm run ops:driver`, which uses the
same `DATABASE_URL` (BD-AUTH-POLICY-01B-A, `docs/driver-role-grant-contract.md` §1). It
prints the account id and a masked phone, never a token. Exit codes: 0 ok, 1 refused
(nothing written), 2 usage, 3 runtime error.

```bash
npm run ops:driver -- list                                   # pending applications
npm run ops:driver -- approve +79000001004 --reason "docs checked" [--by alice]
npm run ops:driver -- reject  <phone|userId> [--reason "..."]
npm run ops:driver -- revoke  <phone|userId> [--reason "..."]  # removes the driver grant
```

The decision logic lives in `src/services/driver-enrollment/decisions.js`
(`decideDriverEnrollment`). The command is only its CLI adapter, so a later bot or admin
route can call the same function.

The @BazarDriveBot webhook is registered by the owner with `npm run ops:telegram`
(BD-TG-BOT-01, #1128), and `set` only once a public tunnel is up. A token has exactly one
update receiver, so run `info` first. It reads `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_WEBHOOK_SECRET` from `.env` and prints neither. Exit codes: 0 ok, 2 usage,
3 configuration or Telegram error.

```bash
npm run ops:telegram -- info                          # current webhook, pending updates, last error
npm run ops:telegram -- set https://<public base URL> # <base>/api/v1/webhooks/telegram, message updates only
npm run ops:telegram -- delete                        # remove the webhook (pending updates are kept)
```

## Current route baseline

`LIVE` means registered and implemented, with database I/O where the route contract
requires it; the liveness route intentionally performs no I/O. `DARK` means the seam is
present but intentionally not implemented; `PILOT-BLOCKED` means code exists but an authorization,
delivery, operations or activation gap still prevents pilot use.

| Module / route | State | Boundary that matters before pilot |
|---|---|---|
| `GET /api/v1/health`, `GET /api/v1/readyz` | LIVE | Readiness checks database connectivity and migration state. |
| `/api/v1/auth/*` | LIVE / PILOT-BLOCKED | Session and OTP request/verify exist. `GET /session` returns the account's current `roles`. `PUT /session/active-role` switches the current session to a granted role and seeds the next login. Verify revokes a presented live bearer of the same account in the login transaction, or fails with 503 (`docs/driver-role-grant-contract.md` §2). OTP limits are on (BD-AUTH-HARDEN-01 #824): codes of `OTP_LENGTH` digits (default 6), with `codeLength` in the request response; per hour, a resend pause and a cap per phone, a cap per source address, and a cap on failed checks per phone across codes; a refusal is 429 `OTP_RATE_LIMITED` / `OTP_LOCKED` with `Retry-After`; codes older than a day are swept. `POST /telegram` signs in with Telegram Mini App initData (BD-AUTH-TELEGRAM-01, ADR BD-DOCS-052): HMAC with `TELEGRAM_BOT_TOKEN`, `auth_date` at most `TELEGRAM_INITDATA_MAX_AGE_SECONDS` old (default 600, 10 minutes), a one-time exchange, 30 attempts per hour per address and 10 per Telegram id; only an identity linked by a contact shared in the bot signs in (`PHONE_REQUIRED` otherwise); the session is `auth_method = telegram` with a TTL of `TELEGRAM_SESSION_TTL_SECONDS` (default 604800, 7 days), and replacement is same-account and same-method. Without the token it answers 503 `TELEGRAM_DISABLED`. OTP delivery and final session policy remain. |
| `/api/v1/orders` | LIVE | The created-order feed requires a session (401 without one, BD-ORDERS-PUBLIC-PROJECTION-01 #1125). The owner sees an order in full. Everyone else sees the street without the house, or no address when it cannot be parsed, with no coordinates and no comment. The point schema is strict. A passenger may have at most 5 open orders (409 `ORDER_LIMIT`). A point may name a catalog place (`placeId`, #1160): everyone else then sees the catalog name and pickup point; an unknown `placeId` is 400 `UNKNOWN_PLACE`. Create requires a live authenticated session; `phone_verified` and passenger-role enforcement remain pilot gates. |
| `/api/v1/matching` | LIVE / PILOT-BLOCKED | Owner/self-offer checks exist; offer creation requires a live authenticated session, while `phone_verified`, granted driver role and readiness are not enforced yet. |
| `/api/v1/ride-state` | LIVE | Participant-only; terminal freeze and append-only events are authoritative. |
| `/api/v1/realtime/poll` | LIVE | Participant-only cursor polling; WebSocket/SSE push remains dark. |
| `/api/v1/history` | LIVE | Authenticated reads; completed-ride receipt write is driver-only and write-once, with server-derived amounts (interim fare basis = the price fixed at `/select`, commission from `RECEIPT_COMMISSION_PERCENT`, tip 0; client amounts ignored — `docs/ride-state-receipt-authority-contract.md` §3). |
| `/api/v1/drivers/enrollment` | LIVE / PILOT-BLOCKED | Driver application: a live session with a verified phone applies (`POST`) and reads its status (`GET`). Approval, rejection and revocation are operator decisions (`npm run ops:driver`), which add or remove the `driver` grant in the same transaction. The approved grant is not line readiness (documents, shift and vehicle remain #830). See `docs/driver-role-grant-contract.md` §1. |
| `/api/v1/chat` | LIVE | Authorized by ride participation (BD-CHAT-AUTH-01 #825). Only the `trip-<tripId>` thread of a real ride is served, to its passenger and driver. The sender role comes from the session, not the request. No session gets 401; another person's or an unknown thread gets the same 404 `CHAT_NOT_FOUND`. Writing is closed with 409 `CHAT_CLOSED` once the ride is terminal. Senders are limited to 30 messages a minute per thread (429 `CHAT_RATE_LIMITED` with `Retry-After`). |
| `POST /api/v1/webhooks/telegram` | LIVE / PILOT-BLOCKED | The @BazarDriveBot webhook (BD-TG-BOT-01 #1128). No session: a wrong or missing `X-Telegram-Bot-Api-Secret-Token` is 401 `WEBHOOK_UNAUTHORIZED`; with the right one every update is 200, so Telegram does not redeliver it. Only a private-chat message from a person is answered. `/start` without a confirmed number sends the consent text (ADR BD-DOCS-052 R9, link to `/#/rules` until #1154) with the «Поделиться номером» contact keyboard; with a number it removes the keyboard, then shows the Mini App button. The sender's own contact, after the consent text, goes to the M4 intake `linkTelegramContact`. Replayed `update_id`s and the consent marks are kept in memory, bounded. Until `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` and `TELEGRAM_MINIAPP_URL` are all set it answers 503 `TELEGRAM_BOT_DISABLED`. The webhook is not registered until the public tunnel exists. |
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

## Public places catalog (BD-ORDERS-PUBLIC-PLACES-01, #1160)

`src/domain/public-places.js` is the server catalog of public places, served by `GET /api/v1/places` (no session):
- Sheremetyevo terminals B, C and D;
- the Moscow railway stations.

Each entry has an id, a name, a kind and a `pickup` point. The pickup point is **where a passenger gets into a taxi**, not the centre of the building. The entry also has `pickupConfirmed` and the OSM `building` it is known by. The owner confirms airports and pickup points (2026-10-26: SVO B/C/D, stations). Vnukovo, Domodedovo and Zhukovsky are added by a later PR once confirmed. The catalog changes only by PR.

Coordinates: © OpenStreetMap contributors, ODbL (<https://www.openstreetmap.org/copyright>). Each entry names its OSM object, for example SVO B is `relation/10727419`.

## Public profile — `PUBLIC_EXPOSURE=true` (BD-STAND-PUBLIC-01, #1124)

Use it for a stand reachable from the internet, for example through a tunnel. Every
`NODE_ENV=production` guard above keys off `NODE_ENV` only. This profile adds guards for a
development stand that is exposed. The flag is strictly `true` / `false`; unset means `false`,
and development is unchanged.

- **Startup is refused** on any of these: `OTP_DEV_MODE=true`, `DRIVER_ENROLLMENT_AUTO_APPROVE=true`,
  `SESSION_TTL_SECONDS` equal to `0` or unset, or a non-loopback `HOST`.
- **Safe defaults:** `HOST=127.0.0.1` and `OTP_DEV_MODE=false`. A tunnel daemon and the stand proxy
  reach the server locally.
- **OTP is off.** `POST /auth/otp/request` and `/auth/otp/verify` answer
  `403 { code: 'OTP_DISABLED', error: 'Вход через Telegram' }`. This happens before any body
  parsing or DB access. Sign-in there goes through Telegram (#1127).
- **Client IP.** `X-Forwarded-For` is trusted from loopback peers only (`trustProxy: 'loopback'`):
  - for the chain cloudflared → stand proxy → this server, `req.ip` is the client;
  - a forwarded header from any non-loopback peer is ignored.

**In every profile:**
- the request body is capped at 64 KiB; the largest legitimate bodies are about 17 KB
  (chat message) and 14 KB (order);
- `POST /webhooks/whatsapp` keeps its own 1 MiB limit, because Meta sizes that payload;
- CORS allows `PUT` (`/auth/session/active-role`).

## Pilot safety boundaries

- A client cutover stays guarded until its module-specific exit conditions are met.
- PostgreSQL/server domain rules own order, offer, assignment and ride state after activation.
- Matching selection is transactional; terminal rides are frozen; `ride_events` is append-only.
- Chat sender identity and ride participation are session-derived (BD-CHAT-AUTH-01 #825); only a real ride's thread is served.
- OTP delivery, driver role/readiness, deploy/rollback and observability are pilot gates (OTP rate limits are on since BD-AUTH-HARDEN-01, #824).
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
- **Ordinary cancellation metadata** = the existing `PATCH /api/v1/ride-state/rides/:tripId/status` remains the single chokepoint. For `CANCELED`, the server derives `cancel_by` from the authenticated participant, validates the role-specific reason code, persists optional `other` free text in `cancel_comment`, and stamps `canceled_at` in the same transaction. Driver cancellation requires a reason; retries return the first committed terminal metadata and cannot overwrite it.
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
