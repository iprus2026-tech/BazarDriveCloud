---
id: BD-DOCS-023
docType: process
title: Mini-Yonder Background Services
owner: docs-contract-agent
status: draft
revision: 2026-06-17
effectiveFrom: 2026-06-17
reviewAfter: 2026-07-17
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
  issues: []
  prs: []
tags:
  - governance
  - mini-yonder
  - background-services
  - architecture
  - target
slug: /governance/mini-yonder-background-services
---

# Mini-Yonder Background Services

> **Target / future architecture — not the shipped runtime.** This page captures
> the *intended* multi-driver dispatch platform (a real backend, a Redis cache,
> object storage, a payment gateway and real-time services connecting many
> passengers, drivers and vehicles). BazarDrive **today** is a backless vanilla
> PWA — `mock_api` + `localStorage`, no server (see CLAUDE.md and
> [Mini-Yonder Model](mini-yonder-model.md)). Read this as a planning reference;
> the [Current state today](#current-state-today) and
> [How this maps to the current runtime](#how-this-maps-to-the-current-runtime)
> sections are the honest mapping to what actually ships. `status: draft` —
> nothing here is implemented as a backend yet.

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

This is no longer a "one driver, one order" toy. It is a small dispatch platform:
many passengers + many drivers + many vehicles + many orders, coordinated through
background services with the backend as the single source of truth.

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

> **Simplified diagram.** The canonical, shipped status enum is richer than the
> labels above — see `RIDE_STATUS` in `public/src/ride_state.js`, which defines
> the full set: NEW_ORDER / CONFIRMATION_PENDING / CONFIRMED / CHAT_STARTED /
> ACCEPTED / DRIVER_EN_ROUTE / DRIVER_APPROACHING_PICKUP / WAITING_PASSENGER /
> IN_PROGRESS / COMPLETED / CANCELED / NO_SHOW. Row 5 of the
> [runtime mapping](#how-this-maps-to-the-current-runtime) table lists the
> active-ride lifecycle subset.

## Data layer

| Tier | Holds |
|---|---|
| **Database** | Users (passenger/driver), profiles, vehicles; orders, responses, active rides; ride events (timeline), payments, ratings. |
| **Cache (Redis)** | Nearby drivers, active orders, ETA cache, geo cache. |
| **Object storage** | Documents, receipts, media / images, logs. |

## External services (future / not integrated)

Mapbox (maps & routes) · SMS / Push providers · Payment gateway · Telegram bot ·
Analytics (future). **None of these is wired into the shipped app today.**

## Monitoring & Operations / Audit

A 9th concern wraps the platform: **Monitoring & Audit**.

- Live dashboard (orders / drivers / rides)
- Alerts & errors
- Audit log (who / what / when)
- Performance (ETA / response time)
- Financial (revenue / payouts)
- Availability (uptime / health)

## Key principles

- One source of truth (backend)
- Clear ride state machine
- Map and price as a service
- Real-time updates
- Security & compliance
- Scalable for many drivers

## Current state today

BazarDrive is a shipped **vanilla PWA with no backend**: ES-module screens under
`public/src/`, a strict CSP, a service worker, and a mock data layer
(`public/src/mock_api.js`) persisting to `localStorage`. There is **no** Order
Dispatcher process, **no** Redis, **no** object storage, **no** payment gateway,
**no** real Mapbox, and **no** real-time multi-driver coordination. The "services"
above exist today only as **client-side modules and mock stores**, or not at all.
The next section is the honest line-by-line mapping.

## How this maps to the current runtime

Legend: ✅ shipped (real client-side equivalent) · ◐ placeholder / mock / stub ·
🔮 future (not present).

| Target service | Today in the repo | Status |
|---|---|---|
| 1. Order Dispatcher | Mock order creation only — `order_map_draft.js` creates the order via `mock_api.js`, which owns the `bazardrive.ride_orders.v1` store. No queue, no broadcast, no dispatch process. | ◐ |
| 2. Driver Availability | Driver readiness gate (`isDriverLineReady`, defined in `public/src/state.js` and enforced in `public/src/screens/driver_map.js`) + a local `driverOnline` flag. No presence/heartbeat service. | ◐ |
| 3. Matching & Assignment | Mock driver offers + passenger select (`public/src/screens/responses.js`, the `driver_offers` store, Order Detail 01D writes). No scoring/ranking/auto-assign. | ◐ |
| 4. Route & Price (Map) | Mapbox **stub** — no-op layers in `public/src/mapbox/*` and `createMapShell`; prices are mock literals. Real Mapbox is future (`docs/db-mapbox-readiness.md`, issue #105). | ◐ / 🔮 |
| 5. Ride State Machine | **Shipped** — `public/src/ride_state.js` `RIDE_STATUS` with a terminal-status freeze. Active-ride lifecycle subset: NEW_ORDER → ACCEPTED → DRIVER_EN_ROUTE → DRIVER_APPROACHING_PICKUP → WAITING_PASSENGER → IN_PROGRESS → COMPLETED, with CANCELED / NO_SHOW terminal; the full enum (incl. CONFIRMATION_PENDING / CONFIRMED / CHAT_STARTED pre-handoff states) is in the note above. Closest real match to the diagram. | ✅ |
| 6. Notification Service | `/inbox` push-permission prompt (`public/src/screens/inbox.js`, BD-NOTIF-01). No real push / Telegram / SMS delivery. | ◐ |
| 7. Safety & Compliance | In-ride safety sheets (`active_ride_*_sheets.js`) + Order Detail report sheet (`order_detail.js`, `report-order`). No fraud/moderation/risk backend. | ◐ |
| 8. History & Receipt | **Shipped** — `bazardrive.ride_history.v1` + the canonical receipt (`public/src/screens/trip_receipt.js`, BD-RIDE-HISTORY-D-01) + the profile calendar history. | ✅ |
| 9. Monitoring & Audit | Today this is **build/CI-time**, not runtime: `scripts/check.mjs`, `scripts/dispatcher.mjs`, and the Mini-Yonder docs-site validators. No live ops dashboard. | ◐ |

## From one car to a fleet (growth path)

> **Target / planning only (🔮).** This section is the intended evolution, not a
> shipped roadmap commitment. Today the repo sits at **Phase 0** (see
> [Current state today](#current-state-today)); only services #5 and #8 ship for
> real. Each phase below promotes one or more ◐ / 🔮 services and would be its own
> explicitly-scoped change.

### Why it is "one car" today

A bigger UI does not make a fleet. The single-car ceiling comes from three
missing pieces, not from the screens:

1. **No shared source of truth** — every client reads its own `localStorage`
   (`ride_orders.v1`, `driver_offers.v1`, `active_ride.v1`, `ride_history.v1`).
   Vehicles cannot see each other.
2. **No broadcast** — an order is not dispatched; a driver "sees" it only because
   they read the same store, not because it was routed to them.
3. **No presence** — there is no live online / free / busy signal per vehicle
   (only a local `driverOnline` flag).

Until those exist, N drawn cars are N isolated copies of the prototype, not a
fleet.

### Phases — each removes one single-car limitation

| Phase | Single-car limit removed | Key transition | Services |
|---|---|---|---|
| 1 | Isolated `localStorage` | `mock_api.js` becomes an API client; stores move to a shared DB | Data layer |
| 2 | No presence | Local `driverOnline` → heartbeat; `isDriverLineReady()` becomes a live shift/compliance status | #2 |
| 3 | No broadcast | Dispatcher queues + broadcasts; Matching ranks (distance, ETA, rating, vehicle class) and assigns | #1, #3 |
| 4 | Mock map / price | Mapbox stub (`public/src/mapbox/*`) → real route / ETA / price | #4 |
| 5 | No network events | `/inbox` permission prompt → real-time push / Telegram / SMS to many | #6 |
| 6 | Trust "on trust" | In-ride safety UI → fraud / no-show / compliance backend | #7 |
| 7 | Build-time monitoring only | `check.mjs` / `dispatcher.mjs` → runtime ops dashboard (fleet view) | #9 |

### Anchors that survive the growth

Two contracts are designed to scale from 1 vehicle to many **without changing
meaning** — they are the load-bearing points the rest grows around:

- ✅ **#5 Ride State Machine** — `RIDE_STATUS` with terminal-status freeze: the
  same canon for one car or ten thousand. Phase 1 moves it from client to server
  as the authority, but the enum and transitions do not change.
- ✅ **#8 History & Receipt** — `ride_history.v1` + the canonical receipt: the
  record-a-ride contract does not depend on fleet size.

**In one line:** a fleet grows from a **coordinator server**, not from more cars
in the UI — shared source of truth (Phase 1) + presence (Phase 2) +
dispatcher/matching (Phase 3) turn N isolated prototypes into one managed fleet;
later phases make it fast, trustworthy and observable.

## Out of scope / future work

This page is a **planning reference**, not a record of shipped behavior. None of
the backend, Redis, object storage, payment, push, or multi-driver real-time
pieces are implemented. Promoting any service from ◐ / 🔮 to ✅ is a separate,
explicitly-scoped change with its own issue, contract update and tests — and would
flip this document out of `draft`.

See [Mini-Yonder Model](mini-yonder-model.md) for the docs-as-code governance
layer that this architecture lives under.
