---
id: BD-DOCS-030
docType: decision-record
title: "Phase 1: Shared Source of Truth — Decision Record"
owner: docs-contract-agent
status: draft
revision: 2026-06-17
effectiveFrom: 2026-06-17
reviewAfter: 2026-12-17
visibleFor: [developer, dispatcher, product]
sourceOfTruth: docs-site
related:
  routes: []
  files:
    - public/src/storage_boundary.js
    - public/src/mock_api.js
    - public/src/driver_offer_store.js
    - public/src/ride_state.js
    - public/src/ride_history.js
  issues: []
  prs: []
tags: [decision-record, adr, architecture, data-layer, target]
slug: /decisions/shared-source-of-truth
---

# Phase 1: Shared Source of Truth — Decision Record

> **Proposed / target decision — not implemented (`status: draft`).** This ADR
> records the *intended* foundational move toward the multi-driver platform in
> [Mini-Yonder Background Services](../governance/mini-yonder-background-services.md).
> BazarDrive **today** is a backless vanilla PWA (`mock_api` + `localStorage`).
> Nothing here is built yet; accepting and shipping it is a separate,
> explicitly-scoped change with its own issues, contracts and tests.

## Context

The growth path in BD-DOCS-023 names **Phase 1 — shared source of truth** as the
foundation every later phase (presence, dispatch, matching) depends on. The
single-car ceiling is not a UI limit; it comes from how data lives today:

- All ride state persists to **per-client `localStorage`**. `public/src/storage_boundary.js`
  enumerates the known keys, but they are **owned by several modules**, not one:
  - `bazardrive.ride_orders.v1`, `bazardrive.posts.v1`, `bazardrive.driver_receipts.v1`
    → `public/src/mock_api.js`
  - `bazardrive.driver_offers.v1` → `public/src/driver_offer_store.js`
  - `bazardrive.active_ride.v1` → `public/src/ride_state.js`
  - `bazardrive.ride_history.v1` → `public/src/ride_history.js`
- Because each device owns its own copy, **two clients cannot see the same
  order**. There is no authority, no broadcast, no presence.

Forces at play:

- **Coordination** — many passengers and many vehicles need one agreed view of
  orders, assignments and ride state.
- **Persistence & durability** — data must outlive a single browser/profile.
- **Existing contracts** — the ride state machine (`public/src/ride_state.js`
  `RIDE_STATUS`, terminal-status freeze) and the history/receipt records already
  ship and are correct; the migration must preserve them, not rewrite them.
- **PWA constraints** — strict CSP, a service worker, and an offline-first
  expectation that a network data layer must not silently break.

## Decision

Introduce a **backend with a shared database as the single source of truth**,
and turn the client into a consumer of it:

1. **Every owning module becomes an API client (behind one persistence facade).**
   The seam is **not** `mock_api.js` alone — each store's owner migrates from
   `localStorage` reads/writes to network calls, preserving its function surface:
   `mock_api.js` (orders/posts/receipts), `driver_offer_store.js` (offers),
   `ride_state.js` (active ride), `ride_history.js` (history). Introducing a
   single persistence facade these modules call is the recommended way to avoid
   leaving any store localStorage-backed.
2. **`storage_boundary.js` is the migration inventory, not the write path.** It
   stays the single enumeration of what is persisted — gaining a "client cache vs
   server-owned" column — and is the checklist that every key in it has an owning
   module migrated. Each store maps to a server-owned entity (orders,
   responses/offers, active ride, ride events, history).
3. **The ride state machine stays the canon.** `RIDE_STATUS` and its transitions
   move from client-authority to **server-authority** unchanged — same enum,
   same terminal freeze. History/receipt records keep their shape.
4. **`localStorage` is demoted to a cache**, not the source of truth: optimistic
   UI + offline read-through, reconciled against the server.

This ADR decides **direction and seam only**. Concrete API shape, schema, and
auth are deferred to the data-layer contract design (a separate doc) and to an
auth ADR.

## Alternatives considered

| Option | Pros | Cons | Rejected because |
| --- | --- | --- | --- |
| Stay on `localStorage` + cross-tab sync (`BroadcastChannel`) | No backend; cheap | Same-device only; no durability, no authority | Cannot coordinate vehicles across devices — the core requirement |
| Peer-to-peer mesh (WebRTC) between clients | No central server | No single authority; no durable history; NAT/discovery complexity | No source of truth → matching, dispatch and audit impossible |
| Serverless KV / edge store only (no app server) | Low ops; shared persistence | No place for dispatch/matching logic or real-time fan-out | Solves storage but not coordination; Phase 3 still blocked |
| **Backend + shared DB (chosen)** | Single source of truth; home for dispatch/matching/presence; durable history | Server ops, auth, CSP/SW changes, offline strategy | — |

## Consequences

- **Positive:**
  - Unblocks Phase 2 (presence/heartbeat) and Phase 3 (dispatch + matching) —
    they require a shared truth to exist first.
  - Durable, multi-device data; real history and audit become possible.
  - The two shipped anchors (`RIDE_STATUS`, history/receipt) carry over without
    semantic change.
- **Negative / trade-offs:**
  - Introduces a backend: hosting, auth/identity, and API versioning to own.
  - **CSP** must allow the API origin; the **service worker** caching strategy
    must distinguish app shell (cache-first) from API data (network-first) — a
    safety-boundary change requiring its own scoped work.
  - Offline behaviour shifts from "localStorage is truth" to "cache + reconcile";
    conflict handling must be designed.
- **Follow-ups:**
  - Data-layer contract design doc — current stores → target entities
    (users/vehicles/orders/rides/events). *(BD-DOCS Design option.)*
  - Auth/identity ADR.
  - Service-worker caching-strategy change (sw-offline-agent scope).
  - Promoting any of this to shipped flips BD-DOCS-023 service #1 (Order
    Dispatcher) and the data layer from ◐/🔮 toward ✅.

See [Mini-Yonder Background Services](../governance/mini-yonder-background-services.md)
for the full target architecture and the growth-path phases this decision opens.
