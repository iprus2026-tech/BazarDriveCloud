---
id: BD-DOCS-035
docType: decision-record
title: "Phase 4: Route & Price (Map) — Decision Record"
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
    - public/src/mapbox/map_shell.js
    - public/src/mapbox/route_service.js
    - public/src/mapbox/price_estimator.js
    - public/src/screens/route_picker.js
    - public/src/screens/route_preview.js
  issues: []
  prs: []
tags: [decision-record, adr, map, mapbox, route, price, eta, geocoding, target, phase-4]
slug: /decisions/route-price-map
---

# Phase 4: Route & Price (Map) — Decision Record

> **Proposed / target decision — not implemented (`status: draft`).** This is
> **Phase 4** of the growth path in
> [Mini-Yonder Background Services](../governance/mini-yonder-background-services.md)
> (service #4 Route & Price). It builds on
> [Phase 1 shared source of truth (BD-DOCS-030)](shared-source-of-truth.md) and
> the [Data Layer Contract (BD-DOCS-031)](../design/data-layer-contract.md),
> [Phase 2 Presence & Heartbeat (BD-DOCS-033)](presence-heartbeat.md), and
> [Phase 3 Dispatch & Matching (BD-DOCS-034)](dispatch-matching.md) — which
> explicitly deferred real ETA/price ranking to "Phase 4 maps". The Mapbox
> integration tracks are planned in `docs/db-mapbox-readiness.md` (issue #105).
> BazarDrive **today** is a backless PWA; nothing here is built.

## Context

Today there is no real map, route, or fare. The Mapbox layer under
`public/src/mapbox/` is a deliberate **stub**: `createMapShell()`
(`map_shell.js`) returns a pure-DOM placeholder consumed by 8 screens,
`mapbox_loader.js` resolves to `null` (no SDK, no token, no network), and the
route picker shows the banner "Mapbox SDK пока не подключён"
(`route_picker.js`). The service worker is already **tile-safe** — an origin
guard keeps external tiles uncached.

Route, distance, and ETA are a **client-side deterministic mock**.
`estimateRoute()` in `route_picker.js` hashes the pickup+dropoff label pair into
`distanceKm` (~3–23 km) and `durationMin` (`8 + km × 2.4`), persisted in
`bazardrive.route_draft.v1`. Pickup/dropoff `coords` are always `null`;
addresses come from **hardcoded place lists** (saved / recent / search
suggestions), with manual entry captured verbatim — there is **no geocoding**.

Price is a **hardcoded client formula**: `estimatedPrice = 80 + distanceKm × 35`
₽ (`route_picker.js`), shown in route preview and the order draft, where the
passenger can hand-adjust it (a stepper clamped 0–100 000 ₽). Two stub seams
already exist for the swap: `route_service.js` (`estimate → null`) and
`price_estimator.js` (`estimatePrice → null`). ETA in offers and the active ride
is either this mock duration or hardcoded demo strings (`'3 мин'`, `'28 мин'`)
in `ride_state.js`.

Phase 3 (BD-DOCS-034) explicitly deferred **real ETA/price ranking** to "Phase 4
maps". Until route, distance, and fare are real and authoritative, matching can
only rank by coarse proximity, and the fare a passenger sees is a number the
client invented.

## Decision

Introduce a server-mediated **Route & Price service** (#4) behind the existing
stub seams:

1. **The stub seams are the swap boundary — callers do not change.** Real
   routing/pricing lands behind `route_service.js`, `price_estimator.js`, and
   the `createMapShell()` DOM boundary; the 8 consumer screens keep calling the
   same contract. (This commits to the single-seam **M2** plan in
   `docs/db-mapbox-readiness.md`.)
2. **Route, distance, and ETA become real and server-computed.** The hash-based
   `estimateRoute()` is replaced by a real Directions/route service (Mapbox or a
   server proxy). `distanceKm` / `durationMin` come from real geometry;
   pickup/dropoff `coords` are filled by **geocoding**, replacing the hardcoded
   place lists. Saved/recent places persist via the Phase 1 data layer
   (BD-DOCS-031), not in-file.
3. **Price becomes a server-owned fare, not a client formula.** Today's
   `80 + 35 × km` literal moves server-side as an authoritative tariff (base +
   per-km + per-time; surge/zones deferred). The client renders an **estimate**;
   the **server is the fare authority** at order and completion time — a client
   must never be trusted to set the fare. The passenger's manual adjustment
   becomes an explicit **bid on top of** the estimate, not the fare itself.
4. **This feeds Phase 3 the real ETA/price it deferred.** Geocoded coordinates
   and real ETA turn the Phase 2 coarse-location available-driver set into
   distance/ETA-ranked matching (the BD-DOCS-034 follow-up). Route & Price is the
   input that makes ranking meaningful.
5. **Mapbox is its own track, never mixed with the DB swap.** Per
   `docs/db-mapbox-readiness.md`, the Mapbox track (real SDK / Directions /
   geocoding) and the DB track (Phase 1) ship independently, never in one PR.
   Calling `api.mapbox.com` and tiles requires a **CSP** allowance and the
   **service worker must never cache** tiles or route/price responses (the origin
   guard already keeps tiles uncached; this formalizes it as a hard rule).

This ADR decides **that Route & Price becomes a real server-mediated service
behind the existing stub seams, with the server as fare authority and geocoded
real coordinates feeding Phase 3 ranking**. The routing provider (Mapbox vs
self-hosted), the exact tariff model (surge/zones), and the tile/CSP specifics
are deferred (see Follow-ups; tile/CSP is the readiness doc's **M1**).

## Alternatives considered

| Option | Pros | Cons | Rejected because |
| --- | --- | --- | --- |
| Status quo — client hash + price formula | No backend; deterministic | Fake distance/ETA; client-set fare; no geocoding | Matching can't rank; fares untrustworthy |
| Mapbox SDK directly in the client, no server | Real map/route quickly | Token exposure; client-authored fare; per-client API cost | Fare must be server-authoritative; cost/security |
| Real route, but keep the client price formula | Real ETA | Fare still client-set and forgeable | Money must be a server decision |
| **Server-mediated Route & Price behind stub seams (chosen)** | Real route/ETA; server fare authority; one swap seam | Needs routing/geocoding provider + CSP/SW work | — |

## Consequences

- **Positive:**
  - Gives Phase 3 matching the real distance/ETA ranking it deferred.
  - Fare becomes authoritative and auditable (server-owned), not
    client-forgeable.
  - The stable `createMapShell()` / `route_service` / `price_estimator` seams
    mean the swap touches the providers, not the 8 screens.
  - Geocoded coordinates unlock real "nearby" instead of today's naming-artifact
    "nearby".
- **Negative / trade-offs:**
  - **CSP + service worker** changes to allow `api.mapbox.com` / tiles while
    **never caching** map or fare traffic — a safety-boundary touch
    (`public/index.html` CSP + `public/sw.js`), sw-offline-agent scope, gated
    behind the readiness doc's **M1**.
  - Real routing/geocoding has **per-request cost** and latency; estimates may
    need caching (the Redis geo/ETA cache, BD-DOCS-023 data layer).
  - Privacy: real coordinates and geocoding are a new privacy surface (ties to
    the Phase 2 location policy).
- **Follow-ups:**
  - Routing/geocoding provider — Mapbox Directions vs self-hosted; tile strategy.
  - Tariff model — base / per-km / per-time, surge, zones, minimum fare; where
    the passenger bid fits.
  - Tile / CSP / SW specifics — the readiness doc's **M1** decision.
  - ETA/geo caching in the Redis tier for fleet-scale matching.

See [Mini-Yonder Background Services](../governance/mini-yonder-background-services.md)
(service #4) for the target architecture,
[Phase 3 Dispatch & Matching (BD-DOCS-034)](dispatch-matching.md) for the
matching that consumes this real ETA/price, and the
[Data Layer Contract (BD-DOCS-031)](../design/data-layer-contract.md) for where
geocoded places, routes, and fares persist.
