---
id: BD-DOCS-023
docType: process
title: Mini-Yonder Background Services
owner: docs-contract-agent
status: draft
revision: 2026-09-02
effectiveFrom: 2026-06-17
reviewAfter: 2026-12-17
visibleFor:
  - developer
  - designer
  - dispatcher
  - product
  - qa
sourceOfTruth: docs-site
related:
  routes: []
  files:
    - public/src/ride_state.js
    - public/src/state.js
    - public/src/mock_api.js
    - public/src/driver_offer_store.js
    - public/src/ride_history.js
    - public/src/screens/trip_receipt.js
    - docs-site/docs/governance/mini-yonder-model.md
    - docs-site/docs/processes/backend-spine-inspector.md
    - ROADMAP.md
  issues:
    - 584
    - 587
    - 589
    - 947
    - 948
  prs:
    - 934
    - 936
    - 938
    - 940
    - 944
tags:
  - governance
  - mini-yonder
  - background-services
  - architecture
  - target
slug: /governance/mini-yonder-background-services
---

# Mini-Yonder Background Services

> **Target architecture plus current implementation map.** This page captures the
> intended multi-driver dispatch platform and now separates three facts that must
> not be collapsed into one status: **server implementation**, **PWA
> consumption/activation**, and **completion of the full target service**.
> BazarDrive still ships its vanilla PWA local-first by default; a substantial
> Fastify/PostgreSQL backend spine exists under `/server`, but staging and PWA
> activation remain gated. See
> [Backend Spine Inspector](../processes/backend-spine-inspector.md) for the
> route-level server baseline and [Project Tracking](../processes/project-tracking.md)
> for the GitHub Project Design State rules.

## Architecture overview

```text
Passengers
   ↓
Orders
   ↓
Mini-Yonder background services
   ↓
Many drivers / vehicles
   ↓
Rides · statuses · history · receipts
```

This is no longer a "one driver, one order" toy target. It is a small dispatch
platform: many passengers + many drivers + many vehicles + many orders,
coordinated through background services with the backend as the single source of
truth.

## Background services (8)

| # | Service | Responsibility |
|---|---|---|
| 1 | **Order Dispatcher** | Accept, queue and route orders; own the order lifecycle; broadcast to drivers. |
| 2 | **Driver Availability** | Track which drivers are online / free / shift-ready; vehicle status; docs & compliance state. |
| 3 | **Matching & Assignment** | Find nearby drivers, score & rank, match vehicle class, assign the order. |
| 4 | **Route & Price (Map)** | Route calculation, distance / ETA, price estimation, traffic/updates, geocoding. |
| 5 | **Ride State Machine** | Own the canonical ride status: CREATED → ACCEPTED → EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED, with CANCELED / NO_SHOW terminal branches. |
| 6 | **Notification Service** | Push, Telegram bot, SMS / email, in-app and real-time events to passengers and drivers. |
| 7 | **Safety & Compliance** | Fraud detection, complaints, no-show rules, document checks, risk control, blocks. |
| 8 | **History & Receipt** | Ride history, earnings, receipts, ratings, reports. |

## Ride state flow (example)

```text
CREATED → ACCEPTED → EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED
                                              ├── CANCELED
                                              └── NO_SHOW
```

CANCELED and NO_SHOW are terminal: once reached, the state must not be reopened.

> **Simplified diagram.** The canonical client enum is richer than the labels
> above. See `RIDE_STATUS` in `public/src/ride_state.js`: NEW_ORDER /
> CONFIRMATION_PENDING / CONFIRMED / CHAT_STARTED / ACCEPTED /
> DRIVER_EN_ROUTE / DRIVER_APPROACHING_PICKUP / WAITING_PASSENGER /
> IN_PROGRESS / COMPLETED / CANCELED / NO_SHOW. The server Ride State routes
> preserve the active-ride lifecycle and terminal-freeze semantics.

## Data layer

| Tier | Holds |
|---|---|
| **Database** | Users (passenger/driver), profiles, vehicles; orders, responses/offers, assignments, rides, ride events, receipts, notification source events and later payments/ratings. |
| **Cache (Redis)** | Nearby drivers, active orders, ETA cache, geo cache, presence TTL. |
| **Object storage** | Documents, receipts, media / images, logs. |

PostgreSQL is already active for the backend spine. Redis and product object
storage remain future infrastructure; the Yandex remote-state Object Storage
work is an infrastructure-state track and must not be confused with product
media/document storage.

## External services (future / not activated)

Mapbox (maps & routes) · SMS / Push providers · Payment gateway · Telegram bot ·
Analytics. None is activated as a production PWA integration today.

## Monitoring & Operations / Audit

A 9th concern wraps the platform: **Monitoring & Audit**.

- Live dashboard (orders / drivers / rides)
- Alerts & errors
- Audit log (who / what / when)
- Performance (ETA / response time)
- Financial (revenue / payouts)
- Availability (uptime / health)

Health/readiness and CI exist now; the runtime fleet dashboard and `/metrics`
contract remain incomplete.

## Key principles

- Backend is the product source of truth after a resource is activated.
- Local stores are cache/prototype fallback, never a second backend authority.
- Clear Ride state machine and terminal freeze.
- Map and price are services, not UI literals.
- Real-time and notification delivery build from durable server events.
- Security, compliance and audit are server-owned facts.
- Scale comes from shared coordination, not from drawing more cars in the UI.

## Current state today

BazarDrive currently has **two planes at once**:

1. a shipped local-first vanilla PWA under `public/`, with mock/local fallback
   still the default runtime;
2. a live Fastify/PostgreSQL backend spine under `/server`, with guarded PWA API
   seams and several real database-backed services.

The backend plane has advanced materially since the original June architecture
map. Orders, Matching, Ride State, realtime Ride polling and History/Receipts
have real server behavior. Matching conflict/recovery authority was hardened by
PRs #934, #936 and #938. Passenger authoritative-first Ride hydration shipped in
#940. PR #944 added the first durable Notification source ledger inside the Ride
transition transaction. None of those facts automatically enables production
PWA traffic.

## Implementation / activation matrix

Legend:

- ✅ **shipped core**: real behavior exists in the relevant plane;
- ◐ **partial / guarded**: foundation exists but the full target or PWA cutover is incomplete;
- 🔮 **future / dark**: target ADR or placeholder exists, but the backend service remains dark.

| Target service | Server / shared backend | PWA / client | Current interpretation |
|---|---|---|---|
| **1. Order Dispatcher** | Orders API is live, but there is no fleet queue/broadcast/ranking dispatcher. | Passenger order creation remains local-first by default. | ◐ foundation; full #1 not shipped |
| **2. Driver Availability** | `/availability/*` remains DARK `501`; no Redis heartbeat/presence. | `isDriverLineReady()` + local `driverOnline` only. | 🔮 / Designed (ADR) |
| **3. Matching & Assignment** | Offer create/list, transactional select, exactly-one assignment and Ride bootstrap are LIVE. Direct conflict and recovery linkage invariants shipped in #934/#936/#938. | Selected-response identity gate shipped in #928; full select ACK/uncertain outcome consumption remains #947. | ✅ server core; ◐ client cutover |
| **4. Route & Price (Map)** | `/route-price/*` remains DARK `501`. | Mapbox modules are stubs/MapShell; prices/ETA are mock. | 🔮 / Designed (ADR) |
| **5. Ride State Machine** | Participant Ride GET/PATCH and append-only `ride_events` are LIVE; terminal freeze is server-owned. | Client state machine exists; authoritative Passenger hydration/terminal reconciliation shipped in #940; backend activation remains guarded. | ✅ server + client anchor; ◐ activation |
| **6. Notification Service** | Notification route/service remains DARK, but #944 ships a durable `notification_outbox` source row atomically with accepted Ride transitions. No worker/feed/channels. | `/inbox` remains mock-backed; permission prompt is not real push. | ◐ source foundation; service stays Designed (ADR) |
| **7. Safety & Compliance** | `/safety/*` remains DARK `501`. | In-ride safety/report UI exists without fraud/risk/compliance authority. | 🔮 / Designed (ADR) |
| **8. History & Receipt** | Viewer-scoped history and driver write-once receipt routes are LIVE. | Client history/receipt anchor exists; global backend cutover remains guarded. | ✅ server + client anchor; ◐ activation |
| **9. Monitoring & Audit** | `/health` and `/readyz` are live; CI/server tests exist; `/metrics` remains dark. | ScreenOps/check/dispatcher are build/dev tooling, not fleet ops. | ◐ / Designed (ADR) |

## GitHub Project #1 synchronization

Project #1 uses the `Design State` vocabulary defined by BD-DOCS-006. The board
is a reference view; runtime and governed docs remain the source of truth.

Recommended state interpretation after the 2026-09-02 audit:

| Project item / concern | Design State interpretation | Why |
|---|---|---|
| **Phase 1 Shared Source of Truth / Data Layer** | **Designed / In Progress**, not complete | Server spine is real, but the PWA still defaults to local stores and the Phase-1 exit requires product-data cutover. |
| **#1 Order Dispatcher** | **Designed (ADR)** | Orders exist, but queue/broadcast/ranking/fleet routing do not. |
| **#2 Driver Availability** | **Designed (ADR)** | Backend service is still dark. |
| **#3 Matching & Assignment** | **Shipped** for the server service | Real offers/select/assignment behavior is live and hardened; #947 is a PWA consumption gap, not absence of the server service. |
| **#4 Route & Price** | **Designed (ADR)** | Backend service and real Mapbox remain dark/future. |
| **#5 Ride State Machine** | **Shipped** | Real client anchor and live server Ride State exist. Activation remains a separate work status. |
| **#6 Notification Service** | **Designed (ADR)** | #944 is a shipped source foundation only; service route, worker, feed and channels remain dark. |
| **#7 Safety & Compliance** | **Designed (ADR)** | Backend service remains dark. |
| **#8 History & Receipt** | **Shipped** | Real client anchor and live server history/receipt behavior exist. |
| **#9 Monitoring & Audit** | **Designed (ADR)** | Health/readiness/CI are not the target live fleet-control surface. |

The board's separate `Status` field can show active work independently of these
Design State values. For example #6 can be `In Progress` while its Design State
remains `Designed (ADR)` during outbox/worker work.

## From one car to a fleet (growth path)

The activated PWA remains local-first, but the backend spine now removes part of
the old "one car" ceiling. The remaining fleet ceiling is concentrated in three
areas:

1. **PWA cutover is incomplete.** Shared server data exists, but the shipped PWA
   still defaults to browser-local product state.
2. **No fleet presence/broadcast.** There is still no live online/free/busy
   heartbeat plus dispatcher broadcast to nearby drivers.
3. **No route-aware ranking.** Matching can accept/select deterministically, but
   it does not yet rank the fleet by distance, ETA, rating and vehicle class.

### Phases - each removes one fleet limitation

| Phase | Limit removed | Current progress | Key transition | Services |
|---|---|---|---|---|
| **1** | Isolated client storage | ◐ backend spine live; PWA cutover incomplete | local product stores → guarded shared API/DB authority | Data layer |
| **2** | No presence | 🔮 | local `driverOnline` → heartbeat/TTL/live readiness | #2 |
| **3** | No broadcast/ranking | ◐ Matching core live; Dispatcher incomplete | queue + broadcast + ranked fleet assignment | #1, #3 |
| **4** | Mock map / price | 🔮 | Mapbox stub → real route / ETA / price | #4 |
| **5** | No durable notification delivery | ◐ durable source outbox shipped; worker/feed/channels dark | source ledger → worker → in-app/out-of-app fan-out | #6 |
| **6** | Trust "on trust" | 🔮 | safety UI → fraud / no-show / compliance backend | #7 |
| **7** | Build-time monitoring only | ◐ health/readiness exist; fleet ops dark | runtime metrics/audit/dashboard/alerts | #9 |

### Anchors that survive the growth

Two contracts remain load-bearing as the platform grows:

- ✅ **#5 Ride State Machine**: the same lifecycle/terminal semantics are used by
  client and server; server ownership now exists and Passenger authoritative
  hydration is advancing PWA consumption.
- ✅ **#8 History & Receipt**: the client anchor and server routes both exist;
  cutover changes authority/location, not the meaning of the completed record.

A third important spine is now visible:

- ◐ **Durable domain-event source**: #944 makes an accepted Ride transition and
  its first notification source event atomic. The next step is not Push. It is
  the contract-first dark worker slice #948, followed later by Inbox/channel
  consumers.

## Next small slices from the synchronized map

1. **#947 Passenger select ACK reconciliation**: finish the backend-mode select
   corridor without local success reconstruction or blind mutation replay.
2. **#948 Notification worker contract**: freeze stored worker state,
   claim/lease/retry/crash semantics and late-commit-safe discovery before any
   runtime worker.
3. Continue the **#820 staging pilot gates**: deploy, auth/session/policy, chat
   authorization, idempotency, observability and two-session staging proof.
4. Keep **Availability/Dispatcher/Redis** as the later fleet-coordination track;
   do not mix it into Passenger select cleanup or Notification worker contracts.
5. Keep **Mapbox**, **Safety**, **Payments** and external notification channels as
   independent explicitly authorized tracks.

## Out of scope / future work

This page is both a target map and an honest implementation matrix; it is not an
activation order. Redis, product object storage, payments, real Mapbox, Push,
Telegram/SMS delivery and full Safety remain separate work. A partial foundation
must never be used to claim an entire service is shipped.

See [Mini-Yonder Model](mini-yonder-model.md) for the docs-as-code governance
layer, [Project Tracking](../processes/project-tracking.md) for board semantics,
and [Backend Spine Inspector](../processes/backend-spine-inspector.md) for the
route-level server baseline.
