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
> Nothing here is built: the registered `/api/v1/route-price` server seam is
> still a dark `501` stub.

## Context

There is still no real **route** or **fare** — that part of the Mapbox layer
under `public/src/mapbox/` remains a deliberate **stub**. But the SDK-load /
render seam is no longer dark by default: `mapbox_loader.js` resolves to
`null` only when no token is configured (`isMapboxEnabled()` false); with the
committed production token (honored only on the GitHub Pages origin —
`mapbox_config.js`), it lazily loads the real vendored Mapbox GL JS
(`public/vendor/mapbox-gl/`). `public/src/screens/map.js` is the **only**
real `mapboxgl.Map` construction in the app — gated behind `state ===
MAP_STATE.DEFAULT && isMapboxEnabled()` — and owns a router-owned disposer
(`BD-SCREEN-LIFECYCLE-01A`, tested by `scripts/smoke-screen-disposer-exactly-once.mjs`)
that frees the GL context; a defensive interval poll is only a backstop for a
detachment the disposer didn't observe (`BD-MAP-FOUND-01` / `BD-MAP-ACTIVATE`,
issue #805; `scripts/smoke-mapbox-render-map.mjs`). `createMapShell()`
(`map_shell.js`) still returns the pure-DOM placeholder consumed by the other
7 screens unchanged, and remains `/map`'s own fallback when dark (no token, or
off the Pages origin). No real route drawing exists on the live map.
`route_picker.js` remains on the placeholder path and still shows its
"Mapbox SDK пока не подключён" watermark; it does not call `loadMapboxSdk()`.
Only `/map`'s live hydrated path in `map.js` removes its own placeholder once
a real `mapboxgl.Map` replaces it. The route picker still computes its own
local mock `estimateRoute()` (a hash of the
pickup/dropoff labels), and pickup/dropoff `coords` are **not** `null` — they
are derived from the label text by a deterministic mock hash
(`deriveMockCoordsFromLabel()` in `passenger_order_utils.js`), not real
geocoding. The service worker is already **tile-safe and API-safe**: its fetch
handler ignores every non-`GET` request and returns before any cache handling
for every cross-origin request (the origin guard) and for same-origin paths
that start with `/api/` (the pathname guard; `public/sw.js:348-357`). The
Route & Price server path is `/api/v1/route-price` (every service mounts under
`/api/v1/<name>`, `server/src/server.js:58-60`); the service itself is still a
registered **dark `501`** stub (`server/src/services/route-price/index.js`).
Production runs on **two origins** ([BD-DOCS-041](backend-home-and-stack.md)):
the PWA on GitHub Pages and `/server` on a separate API origin, which the PWA
reaches through its configured API base (`public/src/api_config.js`). A
production route/price request is therefore cross-origin and is passed through
by the origin guard untouched; the same-origin `/api/` pathname guard
additionally covers local / test-stand and future same-origin proxy setups.
Neither case needs a new service-worker change. The CSP already allows the
Mapbox GL SDK and its tile/script traffic (`https://*.mapbox.com`, `blob:` for
`worker-src` / `child-src`, `style-src 'unsafe-inline'` — shipped with
`BD-MAP-ACTIVATE` #805), but its `connect-src 'self' https://*.mapbox.com`
does not yet include the future backend API origin: before the Pages PWA
enables the production backend, `connect-src` must gain that exact API origin
(the PWA → BazarDrive API gate, which `public/src/api_config.js` records as
well). Separately, a **direct-browser** call to an external routing/geocoding
provider, if a future design chose one, would need that provider's origin
allowed too (see Consequences below).

Route, distance, and ETA are a **client-side deterministic mock**.
`estimateRoute()` in `route_picker.js` hashes the pickup+dropoff label pair into
`distanceKm` (~3–23 km) and `durationMin` (`8 + km × 2.4`), persisted in
`bazardrive.route_draft.v1`. Pickup/dropoff `coords` are label-hash mock values
(see above), never real geocoded points;
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

1. **The stub seams are the swap boundary — but the route-picker call site must
   be migrated onto them first.** Real routing/pricing lands behind
   `route_service.js`, `price_estimator.js`, and the `createMapShell()` DOM
   boundary. The `createMapShell()` consumers (8 screens) already sit on that
   boundary, but `route_picker.js` today computes route and price with its **own
   local `estimateRoute()` and `80 + 35 × km` formula** and does **not** yet call
   the `route_service` / `price_estimator` seams. So Phase 4's **step one** is to
   migrate that call site onto the seam — otherwise route drafts and order prices
   stay on the hash formula even after the server lands. (This is exactly the
   **M2** warning in `docs/db-mapbox-readiness.md`: updating the seams alone
   changes nothing live until the call site moves.)
2. **Route, distance, and ETA become real and server-computed.** The hash-based
   `estimateRoute()` is replaced by a real Directions/route service (Mapbox or a
   server proxy). `distanceKm` / `durationMin` come from real geometry, and
   pickup/dropoff `coords` are filled by **real geocoding** instead of the
   hardcoded place lists. The user's **saved/recent places stay client-only** —
   BD-DOCS-030/031 classify `favorite_routes.v1`, `repeat_route.v1`, and
   `route_draft.v1` as local-only, and cross-device sync of route preferences is
   a **separate decision, out of scope here**. Phase 4 adds geocoding and
   authoritative route geometry, not preference sync.
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
   The CSP already allows `api.mapbox.com` and tiles for the vendored GL SDK
   (`BD-MAP-ACTIVATE` #805); the **service worker must never cache** map or
   route/price traffic — and today it does not: `public/sw.js` ignores
   non-`GET` requests and returns before cache handling for every cross-origin
   request and for every same-origin `/api/` path (`public/sw.js:348-357`).
   In production the PWA reaches the `/api/v1/route-price` path on the
   configured separate backend origin (BD-DOCS-041), so that request is
   cross-origin and already bypassed by the origin guard; the `/api/`
   pathname guard additionally protects local / proxy configurations. Route &
   Price therefore needs **no** new protected SW change. Two CSP concerns stay
   distinct: (a) **mandatory** — before the Pages PWA enables the production
   backend, `connect-src` must gain the exact configured API origin, even
   though Route & Price stays fully server-mediated and the browser never
   calls Mapbox Directions or another routing provider directly; (b)
   **conditional** — only if a future design introduces a **direct-browser**
   call to an external routing/geocoding provider does that provider origin
   also need its own `connect-src` allowance. The routing/geocoding provider
   choice and its server integration also stay open (see Consequences).

This ADR decides **that Route & Price becomes a real server-mediated service
behind the existing stub seams, with the server as fare authority and geocoded
real coordinates feeding Phase 3 ranking**. The routing provider (Mapbox vs
self-hosted), the exact tariff model (surge/zones), and the concrete CSP change
are deferred (see Follow-ups). In the readiness doc's **M1** terms: SW safety
is already satisfied for both the production cross-origin API and same-origin
`/api/` local / proxy traffic; the mandatory PWA → API-origin `connect-src`
gate is still open, and a direct-browser provider origin is an additional,
conditional CSP concern.

## Alternatives considered

| Option | Pros | Cons | Rejected because |
| --- | --- | --- | --- |
| Status quo — client hash + price formula | No backend; deterministic | Fake distance/ETA; client-set fare; no geocoding | Matching can't rank; fares untrustworthy |
| Mapbox SDK directly in the client, no server | Real map/route quickly | Token exposure; client-authored fare; per-client API cost | Fare must be server-authoritative; cost/security |
| Real route, but keep the client price formula | Real ETA | Fare still client-set and forgeable | Money must be a server decision |
| **Server-mediated Route & Price behind stub seams (chosen)** | Real route/ETA; server fare authority; one swap seam | Needs a routing/geocoding provider and server integration; the exact backend API origin in the PWA's `connect-src` (plus a provider origin only for a direct-browser call) | — |

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
  - **Provider / CSP** work still needed for the *route/price* service
    itself: the GL SDK / tile CSP allowance already shipped (`BD-MAP-ACTIVATE`
    #805), and `public/sw.js` already bypasses the production cross-origin API
    request (origin guard) as well as same-origin `/api/` local / proxy
    requests (pathname guard), so no new protected SW change is needed for it.
    Enabling the production backend from the Pages PWA requires adding the
    exact configured API origin to `connect-src` — a reviewed
    `public/index.html` safety-boundary change, required even for a fully
    server-mediated Route & Price. A design that calls an external provider
    **directly from the browser** would additionally need that provider's
    origin in `connect-src`, and a hypothetical same-origin deployment that
    served the API outside `/api/` would need a fresh SW review
    (sw-offline-agent scope) — the open CSP part of the readiness doc's
    **M1**.
  - Real routing/geocoding has **per-request cost** and latency; estimates may
    need caching (the Redis geo/ETA cache, BD-DOCS-023 data layer).
  - Privacy: real coordinates and geocoding are a new privacy surface (ties to
    the Phase 2 location policy).
- **Follow-ups:**
  - Routing/geocoding provider — Mapbox Directions vs self-hosted; tile strategy.
  - Tariff model — base / per-km / per-time, surge, zones, minimum fare; where
    the passenger bid fits.
  - CSP for Route & Price — the open part of the readiness doc's **M1**: the
    mandatory exact backend API origin in the PWA's `connect-src` before
    production backend enablement, plus a provider origin only if a
    direct-browser provider call is ever chosen (SW safety is already
    satisfied for both the cross-origin production API and same-origin `/api/`
    local / proxy traffic).
  - ETA/geo caching in the Redis tier for fleet-scale matching.

See [Mini-Yonder Background Services](../governance/mini-yonder-background-services.md)
(service #4) for the target architecture,
[Phase 3 Dispatch & Matching (BD-DOCS-034)](dispatch-matching.md) for the
matching that consumes this real ETA/price, and the
[Data Layer Contract (BD-DOCS-031)](../design/data-layer-contract.md) for where
geocoded places, routes, and fares persist.
