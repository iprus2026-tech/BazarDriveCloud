# BD-MAP-DUAL-EXPERIENCE-01A — Map experiences contract

Status: contract-only / draft. Only items labelled **CURRENT** describe shipped runtime; **PLANNED** and **FUTURE NATIVE** items are targets, not shipped behavior.

Gate: `BD-MAP-DUAL-EXPERIENCE-01A-CONTRACT`.

Preflight: `BD-MAP-DUAL-EXPERIENCE-00A-PREFLIGHT-AUDIT` (read-only audit; its findings are the CURRENT evidence below).

Layers: PWA / Mapbox / Geo / Routing / Ride authority / Docs.

Audited baseline: [`main@909f7f3ce8748f5333210370a67c2cef58448c86`](https://github.com/iprus2026-tech/BazarDriveCloud/commit/909f7f3ce8748f5333210370a67c2cef58448c86).

## 1. Scope and authority

This contract splits BazarDrive map work into three map experiences inside one PWA — **Passenger Map**, **Driver Free Drive** and **Driver Active Navigation** — and freezes the rules they share: the status → navigation-leg mapping, the conceptual geo shapes, coordinate provenance, authority ownership, the PWA/native boundary, the demo-data rule and the prerequisite slice order.

It changes no runtime file. It does not register a route, touch the service worker or CSP, call a Mapbox API, or add backend, DB, migration, Blender or Unity artifacts. Shipped behavior stays documented in `docs/screen-contracts.md` and `docs/flow-contracts.md`; Mapbox-track readiness caveats stay in `docs/db-mapbox-readiness.md`. Server authority decisions stay with the docs-site ADRs — [Route & Price, BD-DOCS-035](../docs-site/docs/decisions/route-price-map.md) and [Presence & Heartbeat, BD-DOCS-033](../docs-site/docs/decisions/presence-heartbeat.md). This document interprets them for map UX and never overrides them.

This new legacy document stays outside the docs-site document registry in this slice: registration is a separate scope, and the repository currently treats `UNACCOUNTED_DOCUMENT` as warn-only.

## 2. Status vocabulary

| Label | Meaning |
| --- | --- |
| **CURRENT** | Shipped runtime at the audited baseline, with file evidence. |
| **PLANNED** | A target for a named follow-up slice (§13). Not shipped, and never documented as live. |
| **FUTURE NATIVE** | Possible only in a future native driver shell. Not scheduled: this repository is not an Android app today (`CLAUDE.md`), so a native shell first needs its own governance decision. |

A PLANNED item becomes CURRENT only in the slice that ships it, and that slice updates the shipped-behavior docs (`docs/screen-contracts.md`, `docs/flow-contracts.md`) at the same time.

## 3. The three map experiences

| Experience | Route | Registration | Turn-by-turn |
| --- | --- | --- | --- |
| Passenger Map | `/map` | CURRENT — registered | Never |
| Driver Free Drive | `/driver-map` | CURRENT — registered | Never before an accepted order |
| Driver Active Navigation | `/driver-navigation?tripId=<id>&leg=pickup\|dropoff` | **PLANNED ONLY — not registered** | PLANNED, after an accepted ride |

CURRENT role dispatch: the «Карта» tab sends passengers and guests to `/map` and drivers to `/driver-map` (`public/src/app.js:77-84`, `98-106`). `/map` itself has no role guard; `/driver-map` guards its role in-screen (`public/src/screens/driver_map.js:424-433`, `525-528`).

### 3.1 Passenger Map — `/map`

Purpose: choosing a trip, pickup/dropoff, nearby cars, ETA/price preview, tracking the assigned driver.

| Capability | CURRENT | PLANNED |
| --- | --- | --- |
| Base map | Real Mapbox GL base map, only in the `DEFAULT` state and only on the GitHub Pages origin: the committed URL-restricted token is honored on `iprus2026-tech.github.io` only (`public/src/mapbox/mapbox_config.js:40-51`); the map is built in `public/src/screens/map.js:181-229`. Every other state and origin keeps the MapShell placeholder. | Same surface, moved onto the shared lifecycle and error fallback (slice 03). |
| Style and center | Custom Marfino style `mapbox://styles/mrzelus607/cmue32kq700kj01qsh50p5zzq`, center 56.08549 N / 37.54584 E, zoom 12.77 (`mapbox_config.js:21-25`). | Same style. |
| Passenger GPS | None. `getPermissionStatus()` always returns `unknown` and `requestPosition()` resolves `null` (`public/src/mapbox/geolocation_service.js:17-23`); nothing calls `navigator.geolocation`. «Разрешить доступ» only sets the `locationAllowed` pref (`public/src/screens/location_permission.js:164-165`). | Current position (slice 04). |
| Pickup / destination markers | None on the live map; static CSS dots on the placeholder only. | Pickup and destination markers (slice 05). |
| Nearby vehicles | None. `?state=nearby` shows static demo clusters and three demo rows presented as orders, not cars (`map.js:65-69`, `122-137`). | Nearby vehicles (needs the Presence track, §13). |
| Route geometry | None. | Route line (slices 05 and 08). |
| ETA / price | None on `/map`. Route-picker estimates are a label hash: `durationMin = 8 + 2.4·km`, `estimatedPrice = 80 + 35·km` (`public/src/screens/route_picker.js:191-198`). | Preview from the routing and pricing authorities (§8). |
| Assigned-driver tracking | None. The passenger active ride renders the MapShell placeholder; the realtime poll returns status and events only (`server/src/plugins/realtime.js:68`). | Assigned-driver tracking (needs the Presence track). |
| Camera | Fixed initial center and zoom; no `fitBounds`, no bounds, no recenter (`map.js:195-200`). | `fitBounds` over pickup, destination and route; soft Marfino working area. |

Rules:

- No turn-by-turn on the Passenger Map, ever.
- The soft Marfino working area is not a hard `maxBounds`. The passenger may pan away; the map offers a way back (for example a recenter control) instead of locking the camera.

### 3.2 Driver Free Drive — `/driver-map`

Purpose: the driver's working map before accepting an order.

| Capability | CURRENT | PLANNED |
| --- | --- | --- |
| Map | MapShell placeholder only, watermark «Mapbox SDK пока не подключён» (`driver_map.js:101-163`); no real Mapbox. | Real Mapbox GL (slice 07). |
| Orders | Mock nearby orders: local `CREATED` orders (at most 20), or `GET /orders` when the backend seam is on, with no distance filter (`public/src/mock_api.js:590-604`). Driver test orders carry no coordinates (`driver_map.js:784-785`). | Real order-opportunity markers, only for orders with non-mock coordinates (slices 06 and 07). |
| Readiness | `isDriverLineReady()` gate plus the role guard (`driver_map.js:424-433`, `652-672`). | Unchanged. |
| Own position | None; the car is a static CSS dot. | Own vehicle position (slices 04 and 07). |
| Camera | None. | Follow / recenter; optional heading-up. |
| Bounds | None. | No hard Marfino bounds: no `maxBounds`. |

Rules:

- No turn-by-turn before an accepted order. Routing starts only after accept, in Driver Active Navigation.
- The accept handoff stays `/driver-map` → `/active-ride?role=driver&tripId=<id>&status=ACCEPTED` (`driver_map.js:803-808`).
- The live rollout is blocked by P1-1 and P1-2 (§5).

### 3.3 Driver Active Navigation — `/driver-navigation` (PLANNED ONLY)

Status: **PLANNED ONLY.** The route MUST remain unregistered in this slice, and stays unregistered until its own slice (09, §13).

CURRENT reality:

- `/driver-navigation` is not registered in `public/src/app.js`; an unknown path renders the `/feed` fallback (`public/src/router.js:225`).
- The driver active ride (`/active-ride?role=driver`, `public/src/screens/active_ride.js`) renders the MapShell placeholder (`:789-793`) and a static navigation card built from `ride.route.currentInstruction` / `currentStreet` (`:969-971`). «Навигатор» and «Карта» only show a notice (`:964`, `:983`, `:997`, `:1223`). This is not navigation.

Purpose: turn-by-turn navigation after an accepted ride.

Legs (PLANNED):

- `pickup` — driver → pickup.
- `dropoff` — pickup → destination.

Required future UI (PLANNED): route line, navigation camera, next maneuver, maneuver distance, ETA, remaining distance, traffic, reroute state, recenter / overview, voice control, compact ride card.

No hard Marfino bounds.

Route rules (PLANNED, for slice 09):

- `tripId` is required. A missing or unknown trip never falls back to a demo ride.
- `leg` is a presentation hint only (§4).
- The driver role is never read from the URL.
- Status transitions still go through the Ride authority (`public/src/ride_state.js` locally, the ride-state PATCH on a backend ride). The navigation screen does not own the state machine.
- Leaving navigation returns to `/active-ride?role=driver&tripId=<id>`.

## 4. Status → navigation leg (frozen planned mapping)

| `RIDE_STATUS` | Navigation |
| --- | --- |
| `NEW_ORDER`, `CONFIRMATION_PENDING`, `CONFIRMED`, `CHAT_STARTED` | Navigation unavailable |
| `ACCEPTED` | Pickup preview |
| `DRIVER_EN_ROUTE` | Pickup navigation |
| `DRIVER_APPROACHING_PICKUP` | Pickup arrival mode |
| `WAITING_PASSENGER` | No active guidance |
| `IN_PROGRESS` | Dropoff navigation |
| `COMPLETED`, `CANCELED`, `NO_SHOW` | Navigation closed |

Rules:

- `ride.status` is the source of truth.
- The URL `leg` is only a presentation hint. When it disagrees with `ride.status`, the status wins.
- The URL MUST NOT mutate ride status. The planned route accepts no `status=` override, unlike the `/active-ride` simulation override (`active_ride.js:254-297`).
- No new status is introduced: `RIDE_STATUS` and the transitions in `public/src/ride_state.js` are unchanged. Arrival stays the existing `DRIVER_APPROACHING_PICKUP → WAITING_PASSENGER` transition, which stamps `arrivedAt` (`ride_state.js:113`). The waiting timer and the no-show flow stay on `/active-ride`.

## 5. Known P1 blockers

Both were reproduced in the 00A preflight by running the shipped modules from a scratch script outside the repository.

### P1-1 — an accepted driver ride inherits demo Moscow route fields

`seedActiveRideFromAcceptedOrder()` (`public/src/ride_actions.js:313-377`), the canonical accept seed behind the `/driver-map`, `/feed` and `/post` accept paths, builds the ride with `createDemoActiveRide()` and passes only labels and the destination ETA for `route` (`:326-330`). `createDemoActiveRide()` deep-merges that patch over `buildDemoRide()` (`public/src/ride_state.js:136-147`, `168-190`, `235-247`), so every route/order field the patch omits survives from the demo:

| Inherited demo field | Value |
| --- | --- |
| Coordinates: `route.pickup`, `route.dropoff` | 55.7558 / 37.6173 → 55.9726 / 37.4146 (central Moscow → Sheremetyevo) |
| Maneuver: `route.currentInstruction`, `route.currentStreet` | «Через 350 м направо», «на Тверской бульвар» |
| ETA / distance: `route.distanceToPickup`, `route.etaToPickup`, `order.pickupDistance`, `order.pickupEta` | «1,2 км», «3 мин» |
| Labels / tags: `order.destinationNote`, `order.rate`, `order.commission`, `order.tags` | «до МКАД и далее», «12 ₽ / км», «8%», [«★ 4,86», «1 чемодан», «есть детское»] |

`loadCanonicalActiveRide()` returns the stored record unchanged (`public/src/screens/trip_confirmation_handoff.js:309-312`), so the driver screen shows these values today in its route rows and navigation card (`active_ride.js:958`, `969-971`), and any future map that reads `ride.route.pickup` / `dropoff` would plot Moscow.

The same inheritance exists in `buildRideFromPost()` (`ride_actions.js:66-98`), which `acceptPassengerRequestFromPost()` uses for plain-post accepts from `/feed` and `/post`. The passenger seed `buildPassengerRideSeed()` (`public/src/ride_seed.js`) copies the order coordinates but inherits the same maneuver, distance-to-pickup and label/tag fields.

### P1-2 — passenger and driver pickup coordinates can differ for the same order

- The passenger seed copies the order points into the ride (`public/src/ride_seed.js:82-83`). Those points carry label-hash mock coordinates (`public/src/passenger_order_utils.js:23-53`, attached at publish in `public/src/screens/order_map_draft.js:838-839`).
- The driver seed drops the order coordinates (`buildRouteSnapshotFromOrder()`, `ride_actions.js:135-158`) and inherits the demo ones (P1-1).
- Preflight example, one order: passenger pickup 55.9322 / 37.692, driver pickup 55.7558 / 37.6173, about 20 km apart. The mock-hash formula only produces latitudes of about 55.58–55.94, so no address can land in Marfino (56.085).

### What the P1s block

- The Driver Free Drive live rollout (slice 07).
- The Driver Active Navigation runtime (slice 09).

Prerequisite: **`BD-MAP-DUAL-EXPERIENCE-01B` — remove demo-route inheritance and preserve canonical order coordinates.** It is a runtime slice and is not fixed in this docs slice. It covers every real-ride construction site that builds on `createDemoActiveRide()` (the three seeds above). PLANNED acceptance: an accepted ride's pickup/destination labels and coordinates equal the order's; the demo maneuver, ETA/distance and label/tag fields are absent and the UI hides empty values; a smoke pin guards both.

## 6. Shared geo authority — conceptual contracts

State: conceptual only. No runtime module, wire format or DB schema is defined here; slice 02 turns these shapes into a runtime seam.

Coordinates are WGS84 decimal degrees with named `lng` / `lat` fields. A positional `[lng, lat]` array is a Mapbox-boundary adapter detail, never a contract shape.

```text
GeoPoint {
  lng,
  lat,
  accuracyMeters?,
  headingDegrees?,
  speedMps?,
  capturedAt?,
  provenance?              // §7
}

PickupPoint {
  point: GeoPoint,
  label,
  entrance?,
  note?
}

DestinationPoint {
  point: GeoPoint,
  label
}

VehiclePosition {
  vehicleId,
  point: GeoPoint,
  headingDegrees?,
  speedMps?,
  updatedAt
}

NavigationRouteView {
  origin,                  // leg start: driver position (pickup leg) or pickup point (dropoff leg)
  destination,             // leg end: pickup point (pickup leg) or destination point (dropoff leg)
  geometry,                // ordered route line; encoding is frozen in slice 08
  distanceMeters,
  durationSeconds,
  trafficDurationSeconds?,
  steps?,                  // maneuvers; shape is frozen in slices 08 and 09
  updatedAt
}
```

`NavigationRouteView` is presentation / navigation data only. The authoritative route and price contract stays server-owned (§8).

### Naming: `NavigationRouteView`, not `RouteSnapshot`

The preflight found the `RouteSnapshot` name family already taken, by two different shapes:

| Name | Layer | Shape |
| --- | --- | --- |
| `getActiveRideRouteSnapshot()` / `ROUTE_SNAPSHOT_DEFAULTS` (BD-MAPBOX-DATA-02) | Client display | Seven display strings — trip id, pickup/dropoff labels, price, distance, ETA, `acceptedAt` (`public/src/ride_state.js:537-592`, `docs/active-ride-route-snapshot-contract.md`). |
| `RouteComputation` (BD-MAPBOX-ROUTE-COMPUTATION-CONTRACT-01E) | Server domain | Provider-normalized totals, two legs (`to_pickup`, `trip`), waypoints and a toll advisory — no geometry, no steps, no caller yet (`server/src/domain/route-computation.js`). Its header reserves `RouteSnapshot` for the client display contract. |

This contract therefore uses a third, distinct name, `NavigationRouteView`, and never reuses `RouteSnapshot` for map or navigation data. None of the three shapes is a fare.

### Existing carriers and conceptual-only fields (CURRENT)

| Concept | Existing carriers | Reusable today | Conceptual only |
| --- | --- | --- | --- |
| `GeoPoint` | Five shapes: `{lat, lng}` (`readCoord`, server `toPoint`), `{lng, lat}` (`ride.route.pickup`, the map center), nested `coords: {lat, lng}` (route-draft point), flat `{id, label, lat, lng}` (order point), `[lng, lat]` (Mapbox) | Finite-number validation (`passenger_order_utils.js:15-21`, `public/src/mapbox/driver_markers.js:26-35`); the server `COORDINATE_PROVENANCE` vocabulary | `accuracyMeters`, `headingDegrees`, `speedMps`, `capturedAt`, `provenance` — nothing captures them (no GPS) |
| `PickupPoint` | Route-draft point, `order.pickup`, `ride.route.pickupLabel` + `ride.route.pickup`, driver handoff snapshot (label only), server `orders.pickup` JSONB, `rides.route_pickup_*` columns | `order.pickup` as the carrier; the route-draft `source` field as a provenance seed | `entrance`, a point-level `note`, provenance |
| `DestinationPoint` | The same carriers under `dropoff` | Same | Naming differs — runtime `dropoff`, server `destination` (`route-computation.js:32`); runtime field names stay as they are until a runtime slice |
| `VehiclePosition` | None: the car is a CSS dot; `ride_events.type` allows three non-position types only (`server/migrations/0003_ride_status_change.sql:24`); Presence #2 is a dark 501 | — | All fields |
| `NavigationRouteView` | None | Server `RouteComputation` as a normalization base | All fields |

## 7. Provenance

Conceptual values:

| Value | Meaning |
| --- | --- |
| `gps` | A device position fix (Geolocation API) with its capture time. |
| `manual` | A point the user entered by hand (a typed address or a placed pin). |
| `search` | A point chosen from search or suggestion results. |
| `backend` | A point returned by a server authority (order, ride, presence or routing). |
| `mock_hash` | Deterministic coordinates derived from a label hash (`deriveMockCoordsFromLabel()`, `passenger_order_utils.js:23-33`). |
| `simulation` | A point produced by a simulator, a visualization or fixture playback (§12). |

CURRENT: no runtime point carries a provenance field, and every route-draft and order coordinate is `mock_hash`. That includes a route-draft point whose `source` is `current` («Моё место»): it is a mock point, not a GPS fix (`route_picker.js:39-44`, `159-167`). The server stores whatever the client sends; its point schema accepts `lat` / `lng` without provenance (`server/src/services/orders/index.js:14-33`).

Rules (frozen):

- `mock_hash` MUST NEVER be presented as real GPS.
- `simulation` MUST NEVER enter production driver presence.
- UI MUST NOT silently promote mock/demo coordinates to live ride coordinates.
- A point without provenance is treated as unknown, never as `gps`.

PLANNED: slice 02 freezes the runtime field and aligns it with the server `COORDINATE_PROVENANCE` vocabulary (`device_fix`, `user_pin`, `geocode_point`, `provider_routable_point`). `mock_hash` and `simulation` have no server equivalent and are never sent as real coordinates.

## 8. Authority

| Authority | Owns | CURRENT holder | PLANNED holder |
| --- | --- | --- | --- |
| Ride / Order | Pickup, destination, selected driver, trip id, ride status | Local stores (`bazardrive.ride_orders.v1`, and `bazardrive.active_ride.v1` through `ride_state.js`). The server order / matching / ride-state routes exist (BD-DOCS-042), but the PWA has not cut over and its backend seam is dark by default. | The server ride/order authority (BD-DOCS-030, BD-DOCS-034) |
| Location | Driver and passenger current position, vehicle heading/speed, freshness timestamps | Nobody: no geolocation; Presence is dark | Device capture through the `geolocation_service` seam; server Presence #2 for the shared driver position (heartbeat + TTL, coarse location — BD-DOCS-033) |
| Routing | Geometry, distance, ETA, traffic estimate, maneuvers | Client label-hash estimates; the server `RouteComputation` has no caller and `route-price` is a dark 501 | A server-owned route authority (BD-DOCS-035); `NavigationRouteView` is its presentation projection |
| Pricing | The fare | Client formula `80 + 35·km` with a passenger override (mock) | **Server only** (BD-DOCS-035); the passenger adjustment becomes a bid on top of the estimate |

Rules:

- Frontend Directions output MUST NOT become the authoritative fare calculation.
- Location and routing output may inform the UI (for example an arrival-zone hint) but never writes ride status. Status changes go through the Ride authority.

## 9. PWA boundary

CURRENT: `public/manifest.webmanifest` sets `display: standalone` and `orientation: portrait`. No screen uses geolocation, the Screen Wake Lock API or speech. The service worker serves same-origin files cache-first and never caches cross-origin Mapbox traffic; the vendored SDK is runtime-cached, not precached (`public/sw.js`, `public/vendor/README.md`).

| Experience | PWA suitability |
| --- | --- |
| Passenger Map | Fully suitable for the PWA. |
| Driver Free Drive | Suitable for the PWA (foreground). |
| Driver Active Navigation — PWA Phase 1 | Allowed for prototype / foreground navigation. |

Explicit non-goals for final PWA navigation:

- reliable background GPS;
- offline navigation;
- guaranteed voice guidance;
- CarPlay;
- Android Auto;
- native lane guidance.

FUTURE NATIVE: the Mapbox Navigation SDK may replace only the active-navigation rendering. The same Ride / Geo contract (§§4, 6–8) must remain: a native shell consumes the same authorities and never becomes a second source of truth.

Portrait lock: landscape dashboard mounts are unsupported while the manifest locks portrait. Changing it is a separate, app-wide decision.

## 10. Demo data rule (frozen)

**DEMO DATA MUST NEVER APPEAR ON A LIVE MAP WITHOUT AN EXPLICIT DEMO/FIXTURE MODE.**

An explicit mode is a visible switch that a user or tester chose — a `?fixture=` or `?state=` URL, or a «Демо» badge — never a mode inferred from a failure.

Forbidden silent fallbacks:

- Moscow coordinates;
- demo ETA;
- demo route instructions;
- demo vehicle locations;
- `mock_hash` coordinates displayed as GPS.

No silent fallback from a live failure to a fake live state: an SDK, token, GPS or routing failure shows an honest placeholder or error state.

CURRENT demo sources that must stay behind an explicit mode, or be removed, before any live overlay ships:

- the demo route inherited by accepted rides (P1-1);
- `buildDemoRide()` / `DEMO_ACTIVE_RIDE_ID` (`trip_moscow_sheremetyevo_demo`, `ride_state.js:69`) and the simulation fallback of `/active-ride` without a real trip (`active_ride.js:449-480`);
- the `/driver-map` fixtures (`?fixture=`, `driver_map.js:37-40`) and the `/map` `NEARBY` demo rows and clusters;
- the MapShell default route (`public/src/mapbox/map_shell.js:4-7`) and the route-picker suggestion lists (`route_picker.js:50-95`) — central Moscow, Sheremetyevo, Vnukovo;
- label-hash coordinates (`passenger_order_utils.js:23-33`).

CURRENT honest fallback: `/map` keeps or restores the MapShell placeholder on a dark token, an SDK load failure or a `Map` constructor failure. A Mapbox `error` before the first `load` (offline, rejected token, quota) is not handled yet and leaves an empty map canvas (`map.js:210` handles `load` only); slice 03 owns that fallback.

## 11. Mapbox split

| Experience | Engine | Camera | Bounds | Content | Status |
| --- | --- | --- | --- | --- | --- |
| Passenger Map | Mapbox GL JS, custom Marfino style | Free camera; `fitBounds` | Soft working area | Pickup / destination, nearby cars, assigned-driver tracking | CURRENT: base map only; the rest is PLANNED |
| Driver Free Drive | Mapbox GL JS | Follow / recenter; optional heading-up | No `maxBounds` | Own vehicle and order opportunities | PLANNED |
| Driver Active Navigation — PWA | Mapbox GL JS | Route-following | No hard bounds | Route visualization, maneuver presentation | PLANNED |
| Driver Active Navigation — native | Mapbox Navigation SDK | Navigation camera | No hard bounds | Voice, rerouting, offline | FUTURE NATIVE |

Shared rules (PLANNED):

- The SDK stays vendored and loads only through `public/src/mapbox/mapbox_loader.js`.
- Each screen owns at most one GL map and frees it through the router-owned disposer — the `{ view, dispose }` pattern `/map` uses today.
- The marker and trip-status layers keep their foundation export contracts (`driver_markers.js`, `trip_status_layer.js`) and gain a real Mapbox adapter behind them (slice 06).

## 12. Blender / Unity boundary

| Tool | Role |
| --- | --- |
| Blender | 3D assets only. |
| Unity | Simulation / visualization only. |
| Mapbox | Geography / navigation. |
| BazarDrive Ride / Geo authorities | Source of truth. |

Rules:

- Blender and Unity never own pickup, driver position, route state or ride status; they only read from the authorities.
- Simulation positions carry `provenance = simulation`.
- Simulation data is never written into production presence.

CURRENT: the repository contains no Blender or Unity code, asset or integration.

## 13. Follow-up order

| Slice | Scope | Depends on | Status |
| --- | --- | --- | --- |
| 01A | This docs contract | — | This slice (docs only) |
| 01B | Remove demo-route inheritance; preserve canonical pickup/dropoff | 01A | PLANNED — prerequisite for 07 and 09 |
| 02 | Shared `GeoPoint` + provenance contract / runtime seam | 01A | PLANNED |
| 03 | Shared `map_surface` lifecycle + Mapbox error fallback | 01A | PLANNED |
| 04 | Real passenger geolocation | 02, 03 | PLANNED |
| 05 | Passenger pickup/dropoff overlays | 02, 03, 04 | PLANNED |
| 06 | Real Mapbox marker adapter | 02, 03 | PLANNED |
| 07 | Driver Free Drive | 01B, 02, 03, 04, 06 | PLANNED — blocked by 01B |
| 08 | Server Directions / routing authority | 02; backend pilot gates; BD-DOCS-035 follow-ups | PLANNED |
| 09 | Driver Navigation PWA; registers `/driver-navigation` | 01B, 03, 06, 07, 08 | PLANNED — blocked by 01B |
| 10 | Native Navigation SDK | 09; a native-shell governance decision | FUTURE NATIVE — later |

The Presence track runs separately (server Presence #2, BD-DOCS-033) and is a prerequisite for real nearby vehicles and assigned-driver tracking.

Mapping to `docs/db-mapbox-readiness.md`: M1 (the CSP/SW decision) stays open for a future route/price endpoint; M2 (the stub seams as the single swap boundary) lands through slices 03, 06 and 08; M3 (real geolocation behind `geolocation_service`) is slice 04.

Every slice is its own branch and PR, and the Mapbox track and the DB track never share a PR (`docs/db-mapbox-readiness.md`).

## 14. Acceptance for this slice (01A)

- Only these docs change: this file, `docs/screen-contracts.md`, `docs/flow-contracts.md` and `docs/db-mapbox-readiness.md`.
- `public/src/app.js` still registers `/map` and `/driver-map` and does not register `/driver-navigation`.
- Every capability above is labelled CURRENT, PLANNED or FUTURE NATIVE; no PLANNED item is described as shipped.
- P1-1 and P1-2 are recorded with evidence and routed to `BD-MAP-DUAL-EXPERIENCE-01B`.
- `NavigationRouteView` is the name for map/navigation route data; `RouteSnapshot` is not reused.
- `git diff --check`, `node scripts/check.mjs` and `node scripts/dispatcher.mjs` pass.

## 15. Non-goals (01A)

No runtime code, route registration, service worker or CSP change, Mapbox API call, backend, DB or migration, design-registry change, document-registry registration, and no Blender or Unity artifacts. Fixing P1-1 and P1-2 is slice 01B.
