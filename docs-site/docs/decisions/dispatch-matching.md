---
id: BD-DOCS-034
docType: decision-record
title: "Phase 3: Dispatch & Matching — Decision Record"
owner: docs-contract-agent
status: draft
revision: 2026-06-18
effectiveFrom: 2026-06-18
reviewAfter: 2026-12-18
visibleFor: [developer, dispatcher, product]
sourceOfTruth: docs-site
related:
  routes: []
  files:
    - public/src/mock_api.js
    - public/src/driver_offer_store.js
    - public/src/screens/driver_map.js
    - public/src/screens/order_detail.js
    - public/src/ride_state.js
  issues: []
  prs: []
tags: [decision-record, adr, dispatch, matching, assignment, target, phase-3]
slug: /decisions/dispatch-matching
---

# Phase 3: Dispatch & Matching — Decision Record

> **Proposed / target decision — not implemented (`status: draft`).** This is
> **Phase 3** of the growth path in
> [Mini-Yonder Background Services](../governance/mini-yonder-background-services.md)
> (service #1 Order Dispatcher and service #3 Matching & Assignment). It builds on
> [Phase 1 shared source of truth (BD-DOCS-030)](shared-source-of-truth.md) and
> the [Data Layer Contract (BD-DOCS-031)](../design/data-layer-contract.md),
> [Phase 2 Presence & Heartbeat (BD-DOCS-033)](presence-heartbeat.md), and
> [Auth & Identity (BD-DOCS-032)](auth-identity.md). BazarDrive **today** is a
> backless PWA; nothing here is built.

## Context

Today an order is never **dispatched**. A passenger order is created client-side
by `createRideOrder()` (`public/src/mock_api.js`) into the local
`bazardrive.ride_orders.v1` store with `status: 'CREATED'`. A driver "sees" it
only because `driver_map.js` calls `listNearbyOrders()`, which reads that **same
local store** and returns every `CREATED` order (capped at 20) — there is **no
queue, no broadcast, no proximity filter**. ("Nearby" is a naming artifact; no
geo is involved.)

There are two parallel, **manual** matching surfaces:

- **Driver-initiated accept** — a ready driver (gated by `isDriverLineReady`,
  `public/src/state.js`) taps "Принять" in `driver_map.js`;
  `acceptCanonicalRideOrder()` flips the order to `ACCEPTED` and seeds the active
  ride.
- **Passenger-initiated select** — drivers post offers via `sendDriverOffer()`
  into `bazardrive.driver_offers.v1` (15-min TTL); the passenger manually picks
  one in Order Detail, and `commitPassengerSelection()` **atomically** marks the
  order `ACCEPTED` (+ `selectedDriverId`), the chosen offer `accepted`, and peer
  offers `rejected`.

Neither surface has **scoring, ranking, or auto-assignment**. And because every
client reads its own `localStorage`, drivers cannot actually see each other or
compete for the same order across devices. With Phase 1 (shared truth) and Phase
2 (a live `online_free` available-driver set with coarse location in Redis) in
place, the missing piece is the **coordinator** that routes an order to the right
drivers and resolves who gets it.

## Decision

Introduce a server-side **Order Dispatcher** (#1) and **Matching & Assignment**
service (#3):

1. **The order is server-owned and dispatched, not shared-read.** On creation
   the order enters a server **queue** with a lifecycle the dispatcher owns
   (`CREATED → MATCHING → OFFERED → ASSIGNED → ACCEPTED`, plus `EXPIRED` /
   `CANCELED`). Drivers no longer poll a shared store; the dispatcher **routes**
   each order to selected drivers.
2. **Matching consumes the Phase 2 available-driver set.** Candidates come from
   the Redis `online_free` set (BD-DOCS-033), filtered by coarse-location
   proximity and **vehicle class**, then **scored & ranked** by distance / ETA,
   rating, and acceptance history. Readiness is **re-checked at match time** (the
   `isDriverLineReady` rule, server-side per BD-DOCS-032), so a driver whose
   compliance lapsed is never offered an order.
3. **Assignment is offer-based with first-accept-wins.** The dispatcher offers
   the order to the top-ranked candidate(s) — sequential fallthrough or a small
   parallel broadcast — each offer carrying a **TTL** (generalizing today's
   15-min `driver_offers` TTL). The **first** valid accept wins; the server
   **atomically** assigns (one transactional state change — the server-side
   equivalent of today's atomic `commitPassengerSelection`) and **revokes** all
   other outstanding offers for that order. No double-assignment.
4. **The two manual surfaces unify under the dispatcher.** Driver-initiated
   accept and passenger-initiated select both become **views over one server
   assignment**: a driver "accept" is an offer-accept; a passenger "select" is a
   passenger-side preference the dispatcher honors. The canonical decision and
   the order's terminal `ACCEPTED` live on the server, not in two local stores
   that can disagree.
5. **`ACCEPTED` is the handoff join point — unchanged.** Once assigned, the order
   becomes an active ride exactly as today: `tripId = trip_${order.id}`, seeded
   into the ride record, status `RIDE_STATUS.ACCEPTED`
   (`public/src/ride_state.js`). Phase 3 changes **who decides** the assignment,
   not the ride state machine (#5) it hands off to.

This ADR decides **that dispatch is a server-owned queue + broadcast, and that
matching ranks-and-assigns from the presence set with atomic first-accept-wins**.
The ranking-formula weights, offer fan-out strategy (sequential vs parallel), and
offer TTL are deferred (see Follow-ups).

## Alternatives considered

| Option | Pros | Cons | Rejected because |
| --- | --- | --- | --- |
| Status quo — shared store + manual pick | No backend | No real broadcast; clients can't see each other; no fairness | Not a fleet; cannot coordinate many drivers |
| Pure auto-assign (server picks, no driver accept) | Fastest assignment | Ignores driver consent; stale presence → assign to an absent driver | Needs an accept step to confirm liveness |
| Broadcast-to-all, free-for-all accept | Simple; fast pickup | Thundering herd; no ranking/fairness; race storms | Doesn't scale; no quality of match |
| **Queue + ranked offer, first-accept-wins (chosen)** | Real dispatch; uses presence + ranking; consent + fairness | Needs dispatcher, matching, and atomic-assignment infra | — |

## Consequences

- **Positive:**
  - Turns N isolated prototypes into a coordinated fleet — the order is
    **routed**, not stumbled upon.
  - Reuses Phase 2 presence (the `online_free` set + coarse location) as the
    candidate source; no new availability signal to maintain.
  - Atomic first-accept-wins removes the cross-device double-assignment race the
    local stores cannot prevent today.
  - Hands off to the **unchanged** ride state machine (#5) at `ACCEPTED`.
- **Negative / trade-offs:**
  - Needs a **real-time channel** to push offers to drivers (shares the Phase 2
    transport decision; **CSP** must allow it and the **service worker** must
    **never cache** dispatch traffic — sw-offline-agent scope).
  - Match quality depends on Phase 2 **coarse-location** accuracy and Phase 4
    maps for true ETA — early ranking will be approximate.
  - Concurrency correctness (atomic assignment, offer revocation, TTL expiry) is
    the hard part and needs a transactional store / lock.
- **Follow-ups:**
  - Ranking model — weights for distance / ETA, rating, acceptance rate; fairness
    vs speed.
  - Offer fan-out — sequential fallthrough vs parallel top-N; offer TTL.
  - Reconcile the passenger-select preference with dispatcher ranking (who wins
    when they disagree).
  - Real ETA / price ranking arrives with **Phase 4** maps (Route & Price,
    service #4).

See [Mini-Yonder Background Services](../governance/mini-yonder-background-services.md)
(services #1 and #3) for the target architecture,
[Phase 2 Presence & Heartbeat (BD-DOCS-033)](presence-heartbeat.md) for the
available-driver set this consumes, and
[Auth & Identity (BD-DOCS-032)](auth-identity.md) for the identity drivers and
assignments are keyed to.
