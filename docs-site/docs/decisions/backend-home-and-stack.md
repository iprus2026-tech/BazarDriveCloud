---
id: BD-DOCS-041
docType: decision-record
title: "Backend Home & Stack — Decision Record"
owner: docs-contract-agent
status: draft
revision: 2026-06-20
effectiveFrom: 2026-06-20
reviewAfter: 2026-12-20
visibleFor: [developer, dispatcher, product]
sourceOfTruth: docs-site
related:
  routes: []
  files:
    - public/src/data_layer.js
    - public/src/storage_boundary.js
    - public/src/ride_state.js
    - scripts/smoke-static-data-inventory.mjs
  issues: [630, 584, 585]
  prs: []
tags: [decision-record, adr, architecture, backend, target]
slug: /decisions/backend-home-and-stack
---

# Backend Home & Stack — Decision Record

> **Target / planning design — `status: draft`.** The home (`/server`, in-repo,
> self-hosted) is decided; this ADR decides the stack and how the server coexists
> with the static client. Nothing here is implemented — the `/server` scaffold is a
> separate runtime PR gated behind acceptance of this ADR.

## Context

The product owner has fixed one decision: **the backend lives in this repository at `/server`, self-hosted (not a BaaS)**. This ADR does not re-litigate the *home*; it decides the **stack, the `/server` layout, and how the server coexists with the existing static client**. It is the Phase-0/1 *foundation* the eight Mini-Yonder background services (BD-DOCS-023) build on — it must make those phases possible, not implement them.

The forces, grounded in the repo:

- **The client must keep shipping as a static PWA.** `public/` is vanilla ES-module JS with a strict CSP (`public/index.html:8` — `connect-src 'self'`), a service worker, and GitHub Pages deploy (`.github/workflows/pages.yml` uploads `./public`). GitHub Pages cannot run Node, so `/server` **must deploy to a separate host/origin**, and any client→server call adds a cross-origin endpoint the CSP `connect-src` must allow.
- **The data seam already exists and is forward-compatible.** `public/src/data_layer.js` `loadResource(fn, …)` already does `await fn()` and routes rejections to the global app-shell overlay (`server_error`/`retrying`). Its own comment states this holds "whether the source is synchronous (today's mock/localStorage) or a real async, rejectable backend later." Per-module owners (`mock_api.js`, `driver_offer_store.js`, `ride_state.js`, `ride_history.js`, `chat.js`, `respond.js`, `responses.js`, `trip_confirmation_handoff.js`, `driver_handoff_snapshot.js`) each expose function-per-resource APIs over `localStorage`.
- **The contracts must not change meaning.** BD-DOCS-030 (shared source of truth, `localStorage` demoted to cache), BD-DOCS-031 (the `localStorage`-key → server-entity map, with persisted literals like `kind: 'passenger_response'`/`'marketplace_message'` that readers depend on), BD-DOCS-032 (phone+OTP; `user.v1` becomes a session cache; `phoneVerified` becomes a server fact). The `RIDE_STATUS` enum + terminal-freeze in `public/src/ride_state.js` move client→server **as the authority** without changing the enum or transitions.
- **The migration is gated.** `scripts/smoke-static-data-inventory.mjs` (#636, wired into `scripts/check.mjs`) is the green/red signal; `public/src/storage_boundary.js` is the audited key inventory; the BD-DOCS-030 completeness rule requires every server-owned key's owner to migrate.
- **CLAUDE.md discipline.** Backend/CSP/SW are safety boundaries; PRs stay small/scoped; runtime and docs are not mixed; this ADR is docs-only, `status: draft`.

## Decision

Adopt a single self-hosted Node service at `/server`, structured so the full Mini-Yonder diagram has a pre-cut home but Phase 1 only lights up the data layer + auth.

### Chosen stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | **Node.js 22 LTS**, plain **ESM** (`"type":"module"`), **no TypeScript build, no bundler** | Active LTS (clean superset of the repo's CI Node 20); matches the client's ES-module style and the repo's zero-build `node scripts/*.mjs` ethos. JSDoc + optional `// @ts-check` give types without a build step. Server pins its own `/server/.nvmrc` so the repo-wide toolchain is untouched. |
| HTTP framework | **Fastify 5** + `@fastify/cors` + `@fastify/helmet` (Phase 1 only) | Per-route **JSON Schema validation/serialization** makes the BD-DOCS-031 entity contract *executable* and self-documenting (OpenAPI) — contract fidelity is the load-bearing goal; built-in pino logging feeds the #9 monitoring layer; a realtime hub (transport per BD-DOCS-033/036) can later mount in the same process; plugin encapsulation maps 1:1 to "one service = one plugin". Raw `node:http` (re-implement routing/validation/CORS/WS by hand) and Express (needs many plugins for what Fastify ships) are rejected. |
| Database | **PostgreSQL 16** via the **`pg`** driver behind a **thin repository layer**; plain ordered SQL migrations | The single source of truth BD-DOCS-030 demands. The BD-DOCS-031 model is relational (users↔vehicles↔orders↔offers↔assignment↔rides↔ride_events↔receipts), needs a transaction for the `ACCEPTED` assignment step, an append-only `ride_events` timeline (the #9 audit seed), and Phase-3 "nearby drivers" geo — which is a later `CREATE EXTENSION postgis`, **not a new datastore**. No heavyweight ORM, to keep the entity↔store mapping legible against BD-DOCS-031. |
| `RIDE_STATUS` authority | `rides.status` = **TEXT + CHECK** over the exact `public/src/ride_state.js` literals; terminal-freeze enforced **twice**: in a shared `domain/ride-status.js` (verbatim mirror, with `canTransition()` + `TERMINAL_RIDE_STATUSES`) **and** a DB trigger | Moves the freeze client→server **without changing the enum or transitions**. `domain/ride-status.js` mirrors **all 12** literals verbatim (NEW_ORDER, CONFIRMATION_PENDING, CONFIRMED, CHAT_STARTED, ACCEPTED, DRIVER_EN_ROUTE, DRIVER_APPROACHING_PICKUP, WAITING_PASSENGER, IN_PROGRESS, COMPLETED, CANCELED, NO_SHOW) + the full `NEXT_STATUS` map + the 3-member terminal set `{CANCELED, NO_SHOW, COMPLETED}` — the **whole** lifecycle moves, not a subset. TEXT+CHECK (not a Postgres `ENUM` type) stays readable. An **enum-parity test** in `/server/test` pins the full server set against the client's, failing CI on drift. |
| Cache (Redis) | **Deferred in capability, present in structure.** `infra/cache.js` `createCache()` returns a real client when `REDIS_URL` is set, else a no-op/Map fallback; decorated as `fastify.cache` | BD-DOCS-023 scopes Redis to nearby-drivers/active-orders/ETA/geo — i.e. Presence (#2, BD-DOCS-033), Matching (#3), Route&Price (#4). Phase 1 has no such workload; standing Redis up now is ops with no consumer. The structure means Phase 2 just *starts using* the decorated singleton. |
| Object storage | **Deferred in capability, present in structure.** `infra/storage.js` `createStorage()` returns an **S3-compatible** client (a self-hosted engine — MinIO or equivalent — the **concrete choice is owned by BD-DOCS-037** Safety & Compliance, which holds the KYC/PII document-storage decision) when configured, else a local-fs fallback; pre-signed PUT/GET, DB stores only keys | BD-DOCS-023 scopes object storage to documents/media/receipt files/logs — Phase 5/6 (compliance docs from BD-DOCS-032, safety evidence) and the file form of #8 receipts. Phase-1 receipts are a **structured DB row** (BD-RIDE-HISTORY-D-01 is JSON, not a PDF), so no blob store is needed yet. Any client direct-to-bucket I/O is a flagged future CSP `img-src`/`connect-src` change, not silent. |
| API style | **REST + JSON, versioned by URL path `/api/v1/...`**, resource-per-entity named verbatim from BD-DOCS-031; errors as `{ error, code, retryable }` | The client seam is function-per-resource, which maps 1:1 to REST — no GraphQL translation layer needed. URL-path versioning (not header) because SW-cached clients are long-lived: an old client keeps hitting `/v1`. The `{code, retryable}` problem shape maps directly onto the existing `loadResource` `server_error`/retry overlay (BD-ERROR-02A) — `retryable` drives the «Повторить» button. Persisted literals (`passenger_response`/`marketplace_message`, the `RIDE_STATUS` values) are pinned in the schemas. |
| Realtime | **Transport deferred to Phase 2/3.** A neutral realtime **seam** only — `infra/bus.js` (in-proc event hub) + a `plugins/realtime.js` mount point — **structurally present, dark in Phase 1** | The concrete transport (WebSocket vs SSE vs polling) is **owned by BD-DOCS-033 (Presence) / BD-DOCS-034 (Dispatch) / BD-DOCS-036 (Notifications)**; this foundation ADR does **not** pick it — it only guarantees one place to add it. Fastify can host any of them from the same process. Phase 1 keeps the client's current pull-on-navigation model — no realtime is needed to make the shared truth *correct*, only to make it *live* (Phase 2+). |

### `/server` layout

```
/server                       (new top-level dir; /public is untouched)
  package.json                "type":"module", engines node >=22 <23; deps: fastify,
                              @fastify/cors, @fastify/helmet, pg  (Phase 1)
  .nvmrc                      22                (server's own pin; repo .nvmrc=20 stays)
  .env.example                PORT, DATABASE_URL, ALLOWED_ORIGIN (the Pages origin),
                              REDIS_URL?, S3_*?, OTP_*/SESSION_SECRET
  Dockerfile                  node:22-slim, npm ci --omit=dev, non-root
  docker-compose.yml          api + postgres (+ redis/minio added in their phases)
  README.md                   run, env, deploy, CSP/CORS coordination note
  src/
    server.js                 buildApp() — testable, no listen
    index.js                  entrypoint: buildApp().listen() + graceful shutdown
    config.js                 env parse/validate, fail-fast on missing required
    infra/
      db.js                   pg Pool -> fastify.db                 [Phase 1, ACTIVE]
      cache.js                createCache(): redis | no-op -> fastify.cache  [dark]
      storage.js              createStorage(): s3 | fs -> fastify.storage    [dark]
      bus.js                  realtime hub: in-proc now, redis pub/sub later [dark]
      logger.js               pino -> #9 monitoring
    plugins/
      cors.js                 @fastify/cors locked to ALLOWED_ORIGIN
      helmet.js               @fastify/helmet
      error-handler.js        uniform { error, code, retryable } problem shape
      auth.js                 session resolve -> request.user (Phase-1 phone+OTP)
      realtime.js             realtime mount point (transport TBD per BD-DOCS-033/036) [dark]
    domain/
      ride-status.js          RIDE_STATUS literals + NEXT_STATUS + TERMINAL set +
                              canTransition() — VERBATIM mirror of
                              public/src/ride_state.js; shared with the DB CHECK
      entities.js             JSDoc typedefs for the BD-DOCS-031 entities
    services/                 ONE FOLDER PER MINI-YONDER SERVICE (#1-#8)
      auth/                   BD-DOCS-032 phone+OTP, session            [Phase 1]
      orders/                 #1 Order Dispatcher — CRUD now; queue/broadcast Phase 3
      availability/           #2 Presence                               [skeleton]
      matching/               #3 Matching — assignment CRUD now; ranking Phase 3
      route-price/            #4 Route & Price (Mapbox)                 [skeleton]
      ride-state/            #5 Ride State Machine — RIDE_STATUS authority [Phase 1]
      notifications/          #6 Notification fan-out                   [skeleton]
      safety/                 #7 Safety & Compliance                    [skeleton]
      history/                #8 History & Receipt — read model         [Phase 1]
    repositories/             one file per entity; the ONLY module touching SQL
                              (orders/responses/offers/assignment/rides/ride_events/
                               messages/receipts/history/posts/vehicles/users)
    routes/
      health.js               /api/v1/health, /readyz -> #9 monitoring
      metrics.js              /metrics                                  [skeleton]
  migrations/                 NNNN_*.sql ordered DDL; Phase-1 creates users(stub)
                              vehicles posts orders responses offers assignment rides
                              ride_events messages receipts; status CHECK + terminal trigger
  scripts/
    migrate.mjs               apply migrations
    seed.mjs                  dev seed mirroring mock_api fixtures
  test/                       node:test *.test.mjs — repository + transition + route
                              smoke + the ride-status enum-parity test
```

The 8 service folders exist from Phase 0, each a one-line skeleton plugin that registers its prefix and returns `501` until implemented — so the full diagram is "wired but dark" and promoting a service is *implement a folder*, never *re-architect*. The repository layer is the **single seam** for any future DB engine change.

### API + realtime surface (Phase 1)

REST, resource-per-entity, mirroring the owner-module function surface so a module swap is mechanical:

- `GET/POST /api/v1/posts`, `/api/v1/vehicles`
- `GET/POST /api/v1/orders`, `GET /api/v1/orders/:id`
- `GET/POST /api/v1/orders/:id/responses` (preserve `kind` literals)
- `GET/POST /api/v1/offers`
- `POST /api/v1/orders/:id/assignment` (the `ACCEPTED` transaction; cancel actor fields `canceledBy`/`canceledAt`)
- `GET/POST /api/v1/rides`, **`PATCH /api/v1/rides/:id/status`** — the *single chokepoint* that enforces the terminal freeze; returns `409` on a frozen-terminal transition, mapped to the existing `server_error` overlay
- `GET /api/v1/rides/:id/events` (append-only), `GET/POST /api/v1/rides/:id/messages`
- `GET /api/v1/receipts/:rideId`, `GET /api/v1/history` (read model over rides+events)
- `POST /api/v1/auth/otp/request`, `/api/v1/auth/otp/verify`, `GET /api/v1/auth/session` (BD-DOCS-032)
- `GET /api/v1/health`. **No realtime endpoint in Phase 1** — the realtime seam is dark; its transport and path are decided in BD-DOCS-033/036.

### DB / cache / object-storage stance (one line each)

- **DB:** PostgreSQL 16 is the source of truth from Phase 1; PostGIS is a later extension.
- **Cache:** Redis is structured (decorated singleton) but unused until Phase 2; dev/CI need no Redis.
- **Object storage:** S3-compatible (self-hosted engine, decided by BD-DOCS-037) is structured but unused until Phase 5/6; Phase-1 receipts are DB rows.

### Deployment

Two origins, by necessity. The PWA stays on GitHub Pages exactly as today (`pages.yml` uploads `./public` — untouched). `/server` deploys to a separate self-hosted origin (e.g. `https://api.bazardrive.<domain>`): a small VM/container running the Fastify process behind a TLS reverse proxy with a managed-or-self-hosted Postgres; `docker-compose.yml` gives local parity. The app process is **stateless** (session in DB/token, realtime fan-out via Redis pub/sub once >1 instance), so it scales to N replicas later. A server outage degrades to the client's existing offline/cache behavior (`app_connection_status.js` + `loadResource` fallbacks); it never takes down the static site.

### Client integration (no contract change)

Each owner module keeps its exported function signatures; only the body swaps from `localStorage` to `fetch()` of the matching `/api/v1` resource. Because `loadResource` already `await fn()`s and funnels failures to the overlay, read-path callers need **zero** changes. Introduce two small additive, precached, CSP-safe modules:

- `public/src/config.js` — a single `API_ORIGIN` constant (empty = same-origin/mock mode, so the static site still works with no server).
- `public/src/api_client.js` — a thin `fetch` wrapper (base URL, JSON, error normalization to the overlay shape, optional session header) the owners call, so the cross-origin URL + auth header live in one place.

`localStorage` is demoted to an optimistic/offline read-through cache (BD-DOCS-030 §4) until a key drops from the inventory. **CSP:** `connect-src 'self'` in `public/index.html` must gain the exact API origin (and the realtime origin once BD-DOCS-033/036 picks a transport) — one conscious, reviewed safety-boundary PR, never a wildcard. **CORS:** `@fastify/cors` allow-lists exactly the GitHub Pages origin — the mirror of the CSP change. **SW:** under the two-origin model the service worker **already** excludes the API — `public/sw.js` early-returns on cross-origin requests (`url.origin !== self.location.origin`), so `/api` is never intercepted or cached and **no SW change is needed in Phase 1**; only a later *same-origin* reverse-proxy would need a network-first `/api` rule (its own scoped sw-offline-agent change + VERSION bump). Auth responses are never cached regardless (BD-DOCS-032).

### CI / dev

A new **path-filtered** `.github/workflows/server-ci.yml` (`paths: ['server/**', '.github/workflows/server-ci.yml']`, mirroring how `docs-site-ci.yml` is scoped) runs `cd server && npm ci && npm test` on Node 22 with a `postgres:16` service container and migrations applied before `node:test`. The existing `ci.yml` (`node scripts/check.mjs`) is **untouched** — `check.mjs` walks only `public/` and `scripts/`, so a `/server` tree is invisible to it and the static-data gate (`smoke-static-data-inventory.mjs`, #636) stays the migration's authoritative red/green. `docs-site-ci.yml` and `pages.yml` are likewise untouched (different paths). Local dev: `cd server && docker compose up` then `npm run dev` (`node --watch`); the client runs as today and points `config.js` at `http://localhost:PORT`. Two gates, never entangled: `node scripts/check.mjs` + `node scripts/dispatcher.mjs` (client) and `cd server && npm test` (server).

## Alternatives considered

The three reviewed proposals agreed on Fastify + ESM + REST `/api/v1` + deferred Redis/object-storage/realtime + two-origin deploy. They diverged on database and layout; the table compares the three lenses on the contested axes plus the rejected non-server options from BD-DOCS-030.

| Option / lens | Pros | Cons | Verdict |
|---|---|---|---|
| **A — Simplicity:** `better-sqlite3` single-file DB, minimal layout, Postgres deferred | Fastest standup; one file, no DB server; cheapest host | Single-writer native module caps concurrency, blocks serverless, forces an early Postgres move before Phase 2/3 fan-out; layout doesn't pre-cut the 8 services | **Adopted partially** — its repository-layer Postgres-swap seam and its API/migration shape are kept; SQLite itself is rejected to avoid a guaranteed re-migration |
| **B — Scalability:** Postgres + 8-service folder skeleton + decorated `db`/`cache`/`bus`/`storage` singletons, structure-now/use-later | The full diagram has a pre-cut home; state lives in Postgres+Redis so the app is stateless/horizontally scalable; promotion = fill a folder | Slightly more upfront structure than Phase 1 strictly needs | **Adopted as the backbone** — Postgres + the service-folder + decorated-singleton model |
| **C — Migration-safety:** Postgres, verbatim `RIDE_STATUS` port + enum-parity test, key-by-key cutover behind existing signatures | Zero contract change; CI guardrail keeps the enum from drifting; smallest blast radius | Layout less explicitly diagram-shaped on its own | **Adopted for the discipline** — the verbatim `domain/ride-status.js` mirror, the enum-parity test, and the module-by-module/gate-driven cutover |
| Stay on `localStorage` + `BroadcastChannel` (from BD-DOCS-030) | No backend | Same-device only; no authority/durability | Rejected — cannot coordinate across devices |
| Serverless KV / edge store, no app server | Low ops; shared persistence | No home for dispatch/matching/realtime fan-out; Phase 3 still blocked; better-sqlite3-style single-writer issues | Rejected — solves storage, not coordination; conflicts with the fixed self-hosted `/server` decision |

**Synthesis:** take Postgres + the pre-cut 8-service skeleton and decorated singletons (B), enforce migration-safety via the verbatim enum mirror + parity test + gated key-by-key cutover (C), and keep the minimal Phase-1 dependency footprint and the repository-layer abstraction from the simplicity lens (A). The only material disagreement — SQLite vs Postgres — is resolved in favour of Postgres: the simplicity win is real but temporary, and the repository layer (the very seam A relies on for its later swap) makes choosing Postgres now cost the same legibility while avoiding a forced re-migration before Phase 2/3.

## Consequences

**Positive**
- Unblocks Phase 2 (presence) and Phase 3 (dispatch/matching): a shared, durable, attributable source of truth exists.
- The two shipped anchors (`RIDE_STATUS` + terminal freeze, history/receipt) carry over **without semantic change**; authority moves client→server only.
- The full Mini-Yonder diagram is structurally present and dark — later phases fill a folder, not re-architect.
- The static PWA, `scripts/check.mjs`, the docs validators, and the Pages pipeline are all untouched; the migration has a continuous green/red gate.

**Negative / trade-offs**
- Introduces a backend to own: hosting, Postgres ops, auth/session, API versioning.
- CSP `connect-src` and the SW caching strategy are safety-boundary changes requiring their own scoped, reviewed PRs.
- Offline shifts from "localStorage is truth" to "cache + reconcile"; conflict handling and offline-create IDs must be designed (deferred).
- A second Node toolchain (server Node 22 vs repo CI Node 20) and a Fastify dependency tree (mitigated: first-party `@fastify/*` only, lockfile committed, `npm audit` in `server-ci.yml`).

**Neutral**
- `posts` and the `marketplace_message` kind of `responses` sit outside the #1–#9 dispatch services (their own marketplace concern) and get plain resources — not forced into a dispatch service.
- This ADR is docs-only, `status: draft`: a target, not shipped behaviour. The `/server` scaffold and `server-ci.yml` are a *separate* runtime PR gated behind ADR acceptance.

## Migration path (module-by-module, gated by #636)

Pre-requisite safety-boundary PRs (their own scope, before any module swap): land `config.js` (`API_ORIGIN`) + `api_client.js`; the CSP `connect-src` exact-origin change (no SW change needed — the two-origin SW already excludes `/api` via its cross-origin early-return). Then, lowest-risk first, **one module per scoped PR** — stand up the entity + endpoint with verbatim BD-DOCS-031 fields, swap the owner body, `await` callers, then update the `smoke-static-data-inventory.mjs` manifest in the *same* PR so the gate stays honest; `localStorage` stays as cache until the key drops from the inventory:

0. **Scaffold** `/server` + Phase-1 migrations + **auth** (BD-DOCS-032 phone+OTP) — `user.v1` becomes a session cache, `phoneVerified` a server fact, OTP endpoints land before any write endpoint needs an authenticated actor. No client cutover yet.
1. **posts** (`mock_api.js`) — read-side then write-side; lowest coupling, proves the seam end-to-end.
2. **orders** (`mock_api.js` `ride_orders.v1`).
3. **responses** (`respond.js`/`responses.js`/`chat.js`) — preserve `passenger_response`/`marketplace_message` and `orderId`/`canonical:'ride_order'` linkage.
4. **offers + assignment** (`driver_offer_store.js`, incl. `order_overlay.v1` ACCEPTED/CANCELED + actor fields).
5. **rides** (`ride_state.js`) — the load-bearing step: **`RIDE_STATUS` authority moves here.** The client stops being the writer of record and `PATCH`es `/rides/:id/status`; the server runs `canTransition()` (the verbatim `domain/ride-status.js` mirror) + the DB terminal-freeze trigger; the client keeps its identical guard as optimistic/defense-in-depth. Enum, `NEXT_STATUS`, terminal set unchanged — the parity test enforces it. Ships only after offers/assignment so a ride always has a real order behind it.
6. **ride_events** (`trip_confirmation.v1`, `driver_handoff_snapshot.v1`) — append-only timeline.
7. **messages** (`chat.v1`).
8. **receipts + history** (`driver_receipts.v1`, `ride_history.v1`) — last; history is a read model, receipts keep the BD-RIDE-HISTORY-D-01 read-only/no-recompute shape.

Client-only keys (`user.v1` until auth lands, drafts, prefs, favorites, dev keys) **never migrate** (BD-DOCS-031). A red static-data gate is a hard stop.

## Open questions

- **ID strategy / offline create** (BD-DOCS-031): server-generated UUIDv7 now; client-proposed id / idempotency-key reconciliation for offline create deferred.
- **Offline conflict handling**: Phase 1 is last-write-wins with server authority; true reconciliation deferred. Terminal-freeze `409`s surface as the existing overlay, never a crash.
- **Token format / OTP provider / session lifetime** (BD-DOCS-032 follow-up).
- **Vehicles split** out of the driver garage into the server `vehicles` entity (BD-DOCS-031/032 follow-up).
- **`users.role` reconciliation** — the scalar in BD-DOCS-031 vs `roles` + `activeRole` in BD-DOCS-032.
- **Repo-wide Node bump** to 22 (currently `.nvmrc=20`, CI Node 20) — deferred; `/server` pins its own.

## Relation to BD-DOCS-023/030/031/032

- **BD-DOCS-023 (Mini-Yonder Background Services):** this ADR is the Phase-0/1 foundation. The 8-service folder skeleton + decorated `db`/`cache`/`bus`/`storage` singletons give every box in the diagram a pre-cut home; Redis (#2/#3/#4), object storage (#5/#6/#8 files), realtime transport (#2/#5/#6), Mapbox (#4) and the #9 monitoring layer are structured-now/lit-up-in-their-phase. Promoting a service flips its row from ◐/🔮 toward ✅ with its own change.
- **BD-DOCS-030 (Shared Source of Truth):** implements the chosen "backend + shared DB" direction concretely — Postgres as the authority, `localStorage` demoted to cache, the migration behind one persistence facade (`api_client.js`) gated by the static-data inventory and the completeness rule.
- **BD-DOCS-031 (Data Layer Contract):** the entity model becomes the Postgres schema and the Fastify JSON Schemas verbatim — entity names, field lists, and the persisted literals are the wire contract; `posts`/`marketplace_message` stay outside #1–#9.
- **BD-DOCS-032 (Auth & Identity):** phone+OTP lands in the `auth/` service in Phase 1; `user.v1` becomes a session cache, `phoneVerified` a server fact, compliance/vehicles bind to the identity; the SW never caches auth responses.

