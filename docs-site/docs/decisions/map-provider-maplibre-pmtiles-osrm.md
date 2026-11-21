---
id: BD-DOCS-053
docType: decision-record
title: "Map provider: MapLibre + self-hosted PMTiles + OSRM — Decision Record"
owner: docs-contract-agent
status: draft
revision: 2026-11-21
effectiveFrom: 2026-11-21
reviewAfter: 2027-05-21
visibleFor: [developer, dispatcher, product]
sourceOfTruth: docs-site
related:
  routes:
    - /map
    - /driver-map
    - /route-picker
    - /route-preview
    - /api/v1/route-price
  files:
    - public/src/mapbox/mapbox_config.js
    - public/src/mapbox/mapbox_loader.js
    - public/src/mapbox/map_shell.js
    - public/src/mapbox/route_service.js
    - public/vendor/mapbox-gl/mapbox-gl.js
    - public/index.html
    - public/sw.js
    - server/src/services/route-price/index.js
    - docs/map-dual-experience-contract.md
  issues: [805]
  prs: []
tags: [decision-record, adr, map, maplibre, pmtiles, osrm, routing, target]
slug: /decisions/map-provider-maplibre-pmtiles-osrm
---

# Map provider: MapLibre + self-hosted PMTiles + OSRM — Decision Record

> **Contract-first / docs-only (`status: draft`).** This record changes no runtime file, CSP,
> service worker or server code. It fixes the provider choice the owner made on 2026-11-21 and
> the slice order that implements it. Each slice ships as its own PR under the normal
> branch → PR → checks → review discipline.

## Context

What exists today:

- **Renderer.** Mapbox GL JS is vendored under `public/vendor/mapbox-gl/`.
  - The map layer lives in `public/src/mapbox/`: config, loader, `createMapShell`, route service.
  - Screens reach it only through `createMapShell` and `route_service`.
- **Token.** A URL-restricted Mapbox public token is committed in `public/index.html`
  (`bd-mapbox-token`, BD-MAP-ACTIVATE #805). It is honoured only on the GitHub Pages origin.
  Everywhere else the dark placeholder renders («Mapbox SDK пока не подключён»).
- **Style.** The live style is a custom «Marfino» style in the owner's Mapbox account
  (`mapbox://styles/…`).
- **CSP.** It allows `https://*.mapbox.com` in `img-src` and `connect-src`, plus `worker-src blob:`.
- **Routing.** There is no routing engine. Route distance, time and price are a local estimate
  (`route_service.js`, `price_estimator.js`). The server's `route-price` module is a dark
  `501 NOT_IMPLEMENTED` stub.
- **Contract.** The map experiences contract (`docs/map-dual-experience-contract.md`,
  BD-MAP-DUAL-EXPERIENCE-01A) defines three experiences:
  - Passenger Map;
  - Driver Free Drive;
  - Driver Active Navigation (PLANNED).

  It also fixes the shared geo authority, provenance and the P1-3 / slice 05G privacy prerequisite.

Why change the provider:

- **No vendor lock-in.** Mapbox GL JS v2+ is not open source: its use is tied to a Mapbox
  account, a token and Mapbox billing. MapLibre GL JS is the open-source (BSD-3) continuation of
  the same rendering model: the same style specification, layers, sources and expressions.
- **Data residency.** The backend and PostgreSQL are decided for Yandex Cloud `ru-central1`
  (BD-DOCS-047). Self-hosted tiles and routing keep map traffic and the routing engine on the
  same infrastructure, with no third-party map service seeing riders' viewports or routes.
- **Cost and control.** A tile archive and a routing engine are fixed, predictable infrastructure.
  They do not bill per map load or per request.

## Decisions

### D1 — Renderer: MapLibre GL JS, vendored

- MapLibre GL JS is vendored under `public/vendor/maplibre-gl/` with its licence, at a pinned version.
  It is served same-origin, like the current Mapbox bundle, so `script-src 'self'` holds.
- `public/src/mapbox/` becomes a provider-neutral map layer. The public seams keep their shape:
  `createMapShell`, the route service, the default center. Screens do not change their calls.
- The dark placeholder remains the behaviour whenever no tile source is configured, mirroring
  today's «no token ⇒ placeholder».

### D2 — Tiles: one PMTiles archive in Yandex Object Storage

- **Format.** Vector tiles in the OpenMapTiles-compatible schema, built from an OpenStreetMap
  extract into a single PMTiles archive. Area: Moscow and Moscow Oblast first.
- **Hosting.** One public-read object in a Yandex Object Storage bucket in `ru-central1`. It is
  served over HTTPS with HTTP range requests and read in the browser through the `pmtiles`
  protocol for MapLibre (BSD-3). There is no tile server process.
- **Fonts and sprites.** Glyphs (fonts) and sprites are self-hosted next to the archive. No
  third-party font or sprite host is used.
- **Style.** The style JSON is committed in the repository. The «Marfino» look is recreated in the
  open style specification, for example with Maputnik. `mapbox://` style URLs are not readable by
  MapLibre.
- **Bucket CORS.** CORS allows only the PWA origins: the GitHub Pages host, and later the
  production host.
- **Attribution.** «© OpenStreetMap contributors» stays visible on every map (ODbL).

### D3 — CSP: one exact tile host, in its own PR

- `connect-src` and `img-src` replace `https://*.mapbox.com` with the exact bucket host. No
  wildcard is used.
- `worker-src blob:` stays: MapLibre runs its tile worker from a blob.
- This is a safety-boundary change (CLAUDE.md). It lands as its own PR with explicit owner
  confirmation, never mixed with renderer or style work.

### D4 — Service worker: no external map assets

- The service worker never precaches or caches tiles, glyphs or sprites. They are external and
  range-requested.
- The same-origin MapLibre bundle and the committed style JSON are precached like any runtime
  file, with a VERSION bump.

### D5 — Routing: OSRM, server-side only

- **Engine.** OSRM, BSD-2, with the car profile, built from the same OpenStreetMap extract as the
  tiles.
- **Server-only access.** The browser never calls OSRM. The server's `route-price` module becomes
  the live route endpoint. It proxies OSRM `route` for distance, duration and geometry, and keeps
  price authority on the server (contract §8).
- **Benefits of the proxy.**
  - CSP keeps `connect-src 'self'` for routing.
  - The engine address stays private.
  - The response shape is a BazarDrive contract, not OSRM's.
- **Deployment.**
  - Local dev stand: an `osrm-backend` container.
  - Staging: a Compute VM in `ru-central1` on the same private network as the backend.
  - Sizing follows the extract: Moscow + Moscow Oblast fits a modest VM; a federal-district
    extract needs more memory.
- **Data refresh.** The OSRM data and the tile archive are rebuilt from a fresh extract on a fixed
  cadence (initially monthly) by a documented job, not by hand.

### D6 — Contract continuity

The map experiences contract stays the source of truth for:

- the experiences;
- the shared geo authority;
- provenance;
- the status → navigation-leg mapping;
- the P1-3 / slice 05G privacy prerequisite.

Where it says «Mapbox» for the rendering layer, read «the map renderer (MapLibre, BD-DOCS-053)».
Its FUTURE NATIVE note about a Mapbox Navigation SDK is superseded: any future native navigation
layer is a separate decision, and authoritative routing stays server-owned. The contract text is
aligned in a follow-up docs PR.

## Slices

Each slice is one PR:

| Slice | Scope | Boundary |
|---|---|---|
| M1 | This record (docs only). | — |
| M2 | Vendor MapLibre; provider-neutral map layer; placeholder stays without a tile source. | Runtime JS + vendor; SW precache + VERSION. |
| M3a | Tile archive, glyphs, sprites in Object Storage; committed style JSON. | Infra + static asset; no CSP yet. |
| M3b | CSP: exact tile host replaces `*.mapbox.com`. | **Safety boundary — owner confirmation.** |
| M3c | First live surface: Passenger Map `DEFAULT` state on MapLibre. | Runtime, one screen. |
| M4 | `route-price` live: OSRM proxy (distance, duration, geometry); client route service switches to it. | Server + client seam. |
| M5+ | Driver Free Drive, to-pickup, ride and waiting modes; custom layers (pickup points, zones, demand), one per PR. | Per contract. |

After M3c ships, the committed Mapbox token is removed from `index.html` and revoked in the
owner's Mapbox account.

## Non-goals (here)

- **Live traffic.** OSRM routes on the road graph without live traffic, so ETAs are free-flow
  estimates. Traffic-aware ETA is a separate decision.
- **Geocoding and address search.** A self-hosted geocoder (for example Nominatim or Photon) is a
  separate decision.
- **Turn-by-turn voice guidance and offline maps.**
- **Changing the geo authority, provenance or privacy rules of the map contract.**

## Risks

- **ETA without traffic** can be optimistic at peak hours.
- **OSRM memory** grows with the extract area. Start regional and grow deliberately.
- **Style rework.** The Marfino style must be rebuilt in the open specification.
- **ODbL obligations.** Attribution is required, and any modified database derived from OSM and
  offered publicly is shared alike.
- **Single bucket availability** has no CDN at first. A CDN in front of Object Storage is an option
  if load needs it.

## Open human decisions

- The exact bucket name, its folder and billing owner, and the budget alerts. These are shared with
  the open items of BD-DOCS-047.
- The initial map extent: Moscow + Moscow Oblast, or a wider region.
- The refresh cadence for tiles and routing data.
- The size of the OSRM VM.

## Acceptance criteria (this record)

- The provider decision (MapLibre, self-hosted PMTiles in Yandex Object Storage, OSRM behind the
  server) is stated with its boundaries: CSP, service worker, data residency, attribution.
- Slices are ordered, each one PR, with the CSP change isolated as a safety-boundary slice.
- The map experiences contract remains authoritative for experiences, geo authority, provenance
  and privacy.
