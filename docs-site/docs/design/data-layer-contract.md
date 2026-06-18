---
id: BD-DOCS-031
docType: process
title: "Data Layer Contract — Target Schema (Phase 1 Design)"
owner: docs-contract-agent
status: draft
revision: 2026-06-18
effectiveFrom: 2026-06-17
reviewAfter: 2026-12-18
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
tags: [design, data-layer, architecture, target, phase-1]
slug: /design/data-layer-contract
---

# Data Layer Contract — Target Schema (Phase 1 Design)

> **Target / planning design — not implemented (`status: draft`).** This document
> turns the *direction* decided in
> [ADR BD-DOCS-030 — Shared Source of Truth](../decisions/shared-source-of-truth.md)
> into a concrete **entity model**. BazarDrive **today** is a backless vanilla PWA
> (`mock_api` + `localStorage`); no backend, schema, or API exists yet. Field
> lists below are a **proposal**, not a shipped schema.

## Context

ADR BD-DOCS-030 decided to replace per-client `localStorage` with a backend +
shared database, and named the migration **seam** (every owning module, behind
one persistence facade) and the **completeness rule** (every persisted
server-owned key — those in `public/src/storage_boundary.js` **plus any defined
outside it**). It deliberately deferred the **schema**.

This design fills that gap: it maps each current store to a **target server-owned
entity** and proposes the entities' core fields. It **inherits the ADR-030
completeness rule** — this is a design over the same key set, not a new authority.

## Current stores → target entities

Derived from the live key inventory in `public/src/storage_boundary.js` (which,
per #605, now also documents `order_overlay.v1` — cleared via
`clearDriverOfferStore`). Legend for the target column:
**S** = server-owned, **C** = client-only (stays local). Client/server split
follows [ADR BD-DOCS-030](../decisions/shared-source-of-truth.md) — this design
must not reclassify a key the ADR already placed.

| Current key | Owning module | Target entity | Kind |
|---|---|---|---|
| `bazardrive.user.v1` | `state.js` / `mock_api.js` | *(local session cache; the server **users**/identity entity is owned by the auth ADR, **not** migrated in this data-layer phase)* | C |
| *(no store today; in driver profile)* | — | **vehicles** (plate, class, docs) | S |
| `bazardrive.posts.v1`, `bazardrive.myposts.v1` | `mock_api.js` | **posts** (marketplace) | S |
| `bazardrive.ride_orders.v1` | `mock_api.js` | **orders** | S |
| `bazardrive.respond.v1`, `bazardrive.responses.v1` | `respond.js`, `responses.js`, `chat.js` | **responses** | S |
| `bazardrive.driver_offers.v1` | `driver_offer_store.js` | **offers** | S |
| `bazardrive.order_overlay.v1` *(in `storage_boundary.js` inventory; cleared via `clearDriverOfferStore`, per #605)* | `driver_offer_store.js` | **assignment** (selected driver / `ACCEPTED` **and** cancellation: `CANCELED`, `canceledBy`, `canceledAt`) | S |
| `bazardrive.active_ride.v1` | `ride_state.js` (+ `ride_actions.js`, `driver_offer_store.js`, `trip_confirmation_handoff.js`, `active_ride.js`, `order_detail.js`) | **rides** (status via `RIDE_STATUS`) | S |
| `bazardrive.trip_confirmation.v1`, `bazardrive.driver_handoff_snapshot.v1` | `chat.js`, `trip_confirmation.js` (`TRIP_CONFIRM_KEY`), `trip_confirmation_handoff.js`, `driver_handoff_snapshot.js` | **ride_events** (confirmation / handoff timeline) | S |
| `bazardrive.chat.v1` | `chat.js`, `active_ride.js` | **messages** | S |
| `bazardrive.driver_receipts.v1` | `mock_api.js` | **receipts** | S |
| `bazardrive.ride_history.v1` | `ride_history.js` | **ride history** (derivable from rides + events) | S |
| `bazardrive.favorite_routes.v1` | `favorite_routes.js` | *(saved routes — ADR-030 keeps this **local**; a future cross-device sync would be its own decision)* | C |
| `bazardrive.favorite_route_notice.v1`, `bazardrive.repeat_route.v1` | `favorite_routes.js`, `repeat_route.js` | *(one-time navigation handoff — read-and-clear banner / prefill; must NOT sync)* | C |
| `profileTripDemo` *(non-`bazardrive.` key; audited in `storage_boundary.js`)* | `storage_boundary.js` (`TRIP_DEMO_KEY`) | *(passenger Profile demo override)* | C (dev) |
| `bazardrive.draft.v2`, `bazardrive.order_form.v1`, `bazardrive.route_draft.v1` | `composer.js`, `route_picker.js`, `order_map_draft.js` | *(composer / route drafts)* | C |
| `bazardrive.map_prefs.v1` | `mapbox_state.js` | *(map UI prefs)* | C |
| `bazardrive.smoke_role.v1` | `smoke_role.js` | *(test harness)* | C (dev) |
| `bazardrive.debug.publish` | `order_map_draft.js` | *(opt-in publish debug-trail toggle; never carries user data)* | C (dev) |

## Proposed entities (core fields)

Proposal only; IDs, types, and indexes are deferred (see Open questions).

- **users** — `id`, `role` (passenger/driver), profile, compliance/doc state.
  *Owned by the auth ADR, not this data-layer phase;* `user.v1` stays a local
  session cache.
- **vehicles** — `id`, `ownerUserId`, `plate`, `class` (econom/…), `docsState`.
  *No store exists today;* vehicle data lives inside the driver profile and must
  be split out.
- **posts** — `id`, `authorId`, `type` (marketplace / announcement / …),
  `createdAt`, **plus the per-type payload the current stores carry** — `title`,
  `tags`, `author` (`posts.v1`) and, for composer-created `myposts.v1`,
  `title` / `price` / `tags` / `from` / `to` / `seats` / `phone` by post type.
  *The marketplace / feed surface; under the ADR-030 completeness rule the
  migration must **preserve these payload variants**, not flatten to a body-only
  row. It **predates the ride-dispatch model**, so no Mini-Yonder service
  (#1–#9) owns it — its own future "Marketplace" concern, not ride dispatch.*
- **orders** — `id`, `passengerId`, route (from/to), price estimate, `createdAt`,
  lifecycle pointer.
- **responses** — `id`, `orderId` (or `postId`), `authorId`, `kind`, payload,
  `createdAt`. **`kind` must keep the persisted literals** written today by
  `/respond` — `'passenger_response'` (ride response) and `'marketplace_message'`
  (marketplace) — since `/responses` filters ride offers by `'passenger_response'`;
  renaming them would break existing readers / imported rows.
- **offers** — `id`, `orderId`, `driverId`, `vehicleId`, terms, `state`.
- **assignment** — `orderId`, `selectedDriverId`, `acceptedAt`, **and the
  cancellation fields** the overlay also records: `status` (`ACCEPTED` /
  `CANCELED`), `canceledBy` (`passenger` / `driver`), `canceledAt` — order-detail
  views rely on the actor + terminal status. (The `order_overlay.v1` surface;
  makes both acceptance and cancellation shared, not per-browser.)
- **rides** — `id`, `orderId`, `driverId`, `vehicleId`, **`status` ∈ `RIDE_STATUS`**
  with the terminal-status freeze (canon carries over from
  `public/src/ride_state.js`, unchanged).
- **ride_events** — append-only timeline (`rideId`, `type`, `at`, payload);
  absorbs confirmation + handoff state.
- **messages** — `rideId`/`threadId`, `senderId`, `body`, `at`. *A chat / threads
  concern adjacent to #6 Notification: chat **owns** the threads, notifications
  **deliver** events about them — no dedicated #1–#9 dispatch service owns chat.*
- **receipts** — `rideId`, fare breakdown, payout. **history** is a read model
  over **rides** + **ride_events** (or materialized).

> **Service / phase ownership.** Each ride-dispatch entity maps to a Mini-Yonder
> service ([BD-DOCS-023](../governance/mini-yonder-background-services.md)) and an
> ADR phase: orders / offers / assignment — and **ride** responses
> (`kind: 'passenger_response'`) — → #1 / #3 (Phase 3,
> [BD-DOCS-034](../decisions/dispatch-matching.md)); rides / ride_events → #5
> (+ #9 audit, [BD-DOCS-038](../decisions/monitoring-audit.md)); receipts /
> history → #8 (History); vehicles → #2 (Presence,
> [BD-DOCS-033](../decisions/presence-heartbeat.md)); users → Auth
> ([BD-DOCS-032](../decisions/auth-identity.md)). `posts` and the
> **`marketplace_message`** kind of `responses` sit **outside** the #1–#9
> dispatch services — the marketplace / feed concern (only `passenger_response`
> responses are dispatch offers). `messages` is **ride chat** — the `chat.v1`
> threads keyed to a ride / `tripId`, written by the active-ride screens —
> ride-adjacent and delivered by #6 Notification, **not** marketplace. This list
> is **Phase-1
> scoped** — later services introduce their own entities with their ADRs:
> route/price cache (#4, [BD-DOCS-035](../decisions/route-price-map.md)),
> notification feed (#6, [BD-DOCS-036](../decisions/notification-service.md)),
> moderation cases (#7, [BD-DOCS-037](../decisions/safety-compliance.md)),
> audit log (#9, BD-DOCS-038).

## Invariants carried from the runtime (must not change)

- **`RIDE_STATUS` and its terminal freeze** (`ride_state.js`) — the **rides**
  entity adopts the same enum and transitions; client→server authority only.
- **Receipt / history shape** stays compatible with `trip_receipt.js`
  (BD-RIDE-HISTORY-D-01) and the profile calendar.

## Open questions (deferred)

- **ID strategy** — server-generated vs client-proposed (offline create).
- **Auth / identity** — `users` identity is owned by the **auth ADR**, not here.
- **`storage_boundary.js` reconciliation** — done for `order_overlay.v1`
  (documented + cleared via `clearDriverOfferStore`, #605); any *future*
  out-of-inventory key must likewise be folded into the inventory (ADR-030
  follow-up, runtime prerequisite).
- **Vehicles split** — extracting vehicle data out of the driver profile.
- **Offline conflict handling** — optimistic create/reconcile semantics.

## Out of scope

No backend, schema DDL, API shape, or runtime change is part of this document.
Promoting any entity to a real store flips BD-DOCS-023 service #1 (Order
Dispatcher) and the data layer from ◐/🔮 toward ✅, with its own issue, contract
and tests.

See [ADR BD-DOCS-030](../decisions/shared-source-of-truth.md) for the decision
this design implements, and
[Mini-Yonder Background Services](../governance/mini-yonder-background-services.md)
for the full target architecture.
