# BD-MAP-DUAL-EXPERIENCE-01A — Map experiences contract

Status: contract-only / draft. Only items labelled **CURRENT** describe shipped runtime; **PLANNED** and **FUTURE NATIVE** items are targets, not shipped behavior.

Gate: `BD-MAP-DUAL-EXPERIENCE-01A-CONTRACT`.

Preflight: `BD-MAP-DUAL-EXPERIENCE-00A-PREFLIGHT-AUDIT` (read-only audit; its findings are the CURRENT evidence below).

Layers: PWA / Mapbox / Geo / Routing / Ride authority / Docs.

Audited baseline: [`main@909f7f3ce8748f5333210370a67c2cef58448c86`](https://github.com/iprus2026-tech/BazarDriveCloud/commit/909f7f3ce8748f5333210370a67c2cef58448c86).

## 1. Scope and authority

This contract splits BazarDrive map work into three map experiences inside one PWA — **Passenger Map**, **Driver Free Drive** and **Driver Active Navigation** — and freezes the rules they share: the status → navigation-leg mapping, the conceptual geo shapes, coordinate provenance, authority ownership, the PWA/native boundary, the demo-data rule and the prerequisite slice order.

It changes no runtime file. It does not register a route, touch the service worker or CSP, call a Mapbox API, or add backend, DB, migration, Blender or Unity artifacts. Shipped behavior stays documented in `docs/screen-contracts.md` and `docs/flow-contracts.md`; Mapbox-track readiness caveats stay in `docs/db-mapbox-readiness.md`. Server authority decisions stay with the docs-site ADRs — [Route & Price, BD-DOCS-035](../docs-site/docs/decisions/route-price-map.md) and [Presence & Heartbeat, BD-DOCS-033](../docs-site/docs/decisions/presence-heartbeat.md). This document interprets them for map UX and never overrides them; this slice only corrects BD-DOCS-035's stale service-worker / CSP statement in the ADR itself (§14).

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

The Passenger Map experience spans two surfaces: `/map` for discovery before a driver is assigned and, once the passenger selects a driver, the map area of the passenger active ride, `/active-ride?role=passenger&tripId=<id>`. CURRENT: selecting a driver navigates straight to that active ride (`public/src/screens/responses.js:1378-1383`, `1462`), which hides the shared product chrome (`public/src/router.js:94`) and renders its own MapShell placeholder in `active-ride__map` (`public/src/screens/active_ride_passenger.js:2201-2211`); the normal post-selection flow stays on that screen and does not return to `/map`.

| Capability | CURRENT | PLANNED |
| --- | --- | --- |
| Base map | Real Mapbox GL base map, only in the `DEFAULT` state, built in `public/src/screens/map.js:181-229` whenever a token resolves. Token sources, in precedence order (`public/src/mapbox/mapbox_config.js:27-51`): the developer override `globalThis.__BD_MAPBOX_TOKEN__`, accepted on any origin for local / preview QA; then the committed URL-restricted `<meta name="bd-mapbox-token">` token, honored only on `iprus2026-tech.github.io`. Off the Pages origin without the override, `/map` stays dark on the MapShell placeholder; with the override, the live map can hydrate off-origin. Every non-`DEFAULT` state keeps the placeholder. | Same surface, moved onto the shared lifecycle and error fallback (slice 03). |
| Style and center | Custom Marfino style `mapbox://styles/mrzelus607/cmue32kq700kj01qsh50p5zzq`, center 56.08549 N / 37.54584 E, zoom 12.77 (`mapbox_config.js:21-25`). | Same style. |
| Passenger GPS | None. `getPermissionStatus()` always returns `unknown` and `requestPosition()` resolves `null` (`public/src/mapbox/geolocation_service.js:17-23`); nothing calls `navigator.geolocation`. «Разрешить доступ» only sets the `locationAllowed` pref (`public/src/screens/location_permission.js:164-165`). | Current position (slice 04). |
| Pickup / destination markers | None on the live map; static CSS dots on the placeholder only. | Pickup and destination markers, drawn only from trusted passenger points acquired first (slice 05; see the rules below). |
| Nearby vehicles | None. `?state=nearby` shows static demo clusters and three demo rows presented as orders, not cars (`map.js:65-69`, `122-137`). | On `/map`: nearby real vehicles from server Presence, drawn only from fresh production `VehiclePosition`s (§§6–7) — Passenger Presence / Tracking integration, slice 06P; needs the Presence track prerequisite (§13). |
| Route geometry | None. | Route line: slice 05's overlay draws it only once slice 08 supplies a server route between trusted points. |
| ETA / price | None on `/map`. Route-picker estimates are a label hash: `durationMin = 8 + 2.4·km`, `estimatedPrice = 80 + 35·km` (`public/src/screens/route_picker.js:191-198`). | Preview from the routing and pricing authorities (§8). |
| Assigned-driver tracking | None. The passenger active ride renders the MapShell placeholder in `active-ride__map` (`active_ride_passenger.js:2201-2211`); the realtime poll returns status and events only (`server/src/plugins/realtime.js:68`). | On the passenger active-ride map, not `/map`: slice 06P draws the assigned driver's current vehicle position on `/active-ride?role=passenger&tripId=<id>`, adapting today's `active-ride__map` MapShell surface through the shared map lifecycle (slice 03) and marker adapter (slice 06); needs the Presence track, a fresh production `VehiclePosition` (§6) and the selected-driver / trip identity from the Ride / Order authority (§§8, 13). |
| Camera | Fixed initial center and zoom; no `fitBounds`, no bounds, no recenter (`map.js:195-200`). | `fitBounds` over pickup, destination and route; soft Marfino working area. |

Rules:

- No turn-by-turn on the Passenger Map, ever.
- The soft Marfino working area is not a hard `maxBounds`. The passenger may pan away; the map offers a way back (for example a recenter control) instead of locking the camera.
- Trusted point acquisition precedes live rendering (slice 05). CURRENT: every route-picker point is built by `makePoint()` with `deriveMockCoordsFromLabel()` (`route_picker.js:159-165`), so today's destination is `mock_hash`, and slice 04 adds only the device position, which can at most supply a real pickup. Before a point is drawn live (§7 live map eligibility):
  - a pickup may be `device_fix` (fresh when it is adopted, §6 adopted waypoints), `user_pin`, `geocode_point` or `provider_routable_point`;
  - a destination MUST be `user_pin`, `geocode_point` or `provider_routable_point`;
  - a `mock_hash` destination never renders on the live Mapbox surface, and no `unknown`-provenance point renders live.
- Markers do not require server Directions, and this contract does not claim that slice 08 provides a geocoder: no geocoding contract exists yet. Choosing the acquisition source (for example a pin the user places on the live map, or a geocoding provider) is part of slice 05.
- Slice 05 acceptance (PLANNED): trusted acquisition happens before any pickup / destination rendering; without a trusted destination, the destination marker is absent and the UI shows an honest pending / manual state, never a fake coordinate.
- Slice 05 before 05G (PLANNED): slice 05 may acquire trusted pickup / destination points and show them locally to the passenger, but until slice 05G ships it MUST NOT persist or publish trusted precise points through the existing server order path in a form that the public `GET /orders` would echo anonymously (§5 P1-3). Allowed meanwhile: a local-only precise point, a server write without precise coordinates, or a privacy-safe / coarse projection — never anonymous exact coordinates.
- Vehicle positions — nearby vehicles on `/map` and the assigned driver on the passenger active-ride map — come only from server Presence through slice 06P (§13), as fresh production `VehiclePosition`s (§6 vehicle position). They obey live map eligibility (§7), never fall back to demo vehicles (§10), and the passenger map UI never becomes the authority for a driver position.

### 3.2 Driver Free Drive — `/driver-map`

Purpose: the driver's working map before accepting an order.

| Capability | CURRENT | PLANNED |
| --- | --- | --- |
| Map | MapShell placeholder only, watermark «Mapbox SDK пока не подключён» (`driver_map.js:101-163`); no real Mapbox. | Real Mapbox GL (slice 07). |
| Orders | Mock nearby orders: local `CREATED` orders (at most 20), or `GET /orders` when the backend seam is on, with no distance filter (`public/src/mock_api.js:590-604`). Driver test orders carry no coordinates (`driver_map.js:784-785`). | Real order-opportunity markers whose position comes only from the privacy-safe protected projection that slice 05G introduces — never precise coordinates read from today's anonymous `GET /orders` (§5 P1-3) — and which then pass live map eligibility: a valid bounded `GeoPoint` with trusted real-origin provenance (§7). Legacy orders without recorded provenance stay list-only (slices 02, 05G, 06 and 07). |
| Readiness | `isDriverLineReady()` gate plus the role guard (`driver_map.js:424-433`, `652-672`) — a UI gate, not an HTTP security boundary (§5 P1-3). | Unchanged. |
| Own position | None; the car is a static CSS dot. | Own vehicle position, from a fresh `device_fix` only (§6 vehicle position; slices 04 and 07). |
| Camera | None. | Follow / recenter; optional heading-up. |
| Bounds | None. | No hard Marfino bounds: no `maxBounds`. |

Rules:

- No turn-by-turn before an accepted order. Routing starts only after accept, in Driver Active Navigation.
- The accept handoff stays `/driver-map` → `/active-ride?role=driver&tripId=<id>&status=ACCEPTED` (`driver_map.js:803-808`).
- The live rollout is blocked by P1-1 and P1-2 (§5, fixed by 01B), and its backend order markers also by P1-3 (§5, fixed by 05G).

### 3.3 Driver Active Navigation — `/driver-navigation` (PLANNED ONLY)

Status: **PLANNED ONLY.** The route MUST remain unregistered in this slice, and stays unregistered until its own slice (09, §13).

CURRENT reality:

- `/driver-navigation` is not registered in `public/src/app.js`; an unknown path renders the `/feed` fallback (`public/src/router.js:225`).
- The driver active ride (`/active-ride?role=driver`, `public/src/screens/active_ride.js`) renders the MapShell placeholder (`:789-793`) and a static navigation card built from `ride.route.currentInstruction` / `currentStreet` (`:969-971`). «Навигатор» and «Карта» only show a notice (`:964`, `:983`, `:997`, `:1223`). This is not navigation.

Purpose: turn-by-turn navigation after an accepted ride.

Legs (PLANNED):

- `pickup` — current vehicle position → pickup.
- `dropoff` — current vehicle position → destination. The first dropoff route usually starts at the pickup because the car is still there, but the pickup is never the fixed origin (§6).

Required future UI (PLANNED): route line, navigation camera, next maneuver, maneuver distance, ETA, remaining distance, traffic, reroute state (the PWA asks the routing authority, §8, for a new route from the current vehicle position, §6), recenter / overview, voice control, compact ride card.

No hard Marfino bounds.

Route rules (PLANNED, for slice 09):

- `tripId` is required. A missing or unknown trip never falls back to a demo ride.
- `leg` is a presentation hint only (§4).
- The driver role is never read from the URL.
- Status transitions still go through the Ride authority (`public/src/ride_state.js` locally, the ride-state PATCH on a backend ride). The navigation screen does not own the state machine.
- The route origin is a fresh `device_fix` (§6 device-fix freshness). Without one, the screen shows an honest no-current-position / waiting / retry state and never routes from a last-known stale coordinate.
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

P1-1 and P1-2 were reproduced in the 00A preflight by running the shipped modules from a scratch script outside the repository. P1-3 comes from the 01A review of the current server order seam.

### P1-1 — real rides inherit demo Moscow route fields

`seedActiveRideFromAcceptedOrder()` (`public/src/ride_actions.js:313-377`), the canonical accept seed behind the `/driver-map`, `/feed` and `/post` accept paths, builds the ride with `createDemoActiveRide()` and passes only labels and the destination ETA for `route` (`:326-330`). `createDemoActiveRide()` deep-merges that patch over `buildDemoRide()` (`public/src/ride_state.js:136-147`, `168-190`, `235-247`), so every route/order field the patch omits survives from the demo:

| Inherited demo field | Value |
| --- | --- |
| Coordinates: `route.pickup`, `route.dropoff` | 55.7558 / 37.6173 → 55.9726 / 37.4146 (central Moscow → Sheremetyevo) |
| Maneuver: `route.currentInstruction`, `route.currentStreet` | «Через 350 м направо», «на Тверской бульвар» |
| ETA / distance: `route.distanceToPickup`, `route.etaToPickup`, `order.pickupDistance`, `order.pickupEta` | «1,2 км», «3 мин» |
| Labels / tags: `order.destinationNote`, `order.rate`, `order.commission`, `order.tags` | «до МКАД и далее», «12 ₽ / км», «8%», [«★ 4,86», «1 чемодан», «есть детское»] |

`loadCanonicalActiveRide()` returns the stored record unchanged (`public/src/screens/trip_confirmation_handoff.js:309-312`), so the driver screen shows these values today in its route rows and navigation card (`active_ride.js:958`, `969-971`), and any future map that reads `ride.route.pickup` / `dropoff` would plot Moscow.

The same inheritance exists in `buildRideFromPost()` (`ride_actions.js:66-98`), which `acceptPassengerRequestFromPost()` uses for plain-post accepts from `/feed` and `/post`. The passenger seed `buildPassengerRideSeed()` (`public/src/ride_seed.js`) copies the order coordinates but inherits the same maneuver, distance-to-pickup and label/tag fields.

Backend hydration keeps the same residue. With the backend seam on, opening a valid real `tripId` that has no local canonical record makes each active-ride screen first build a temporary `createDemoActiveRide({ tripId, … })` placeholder — driver `active_ride.js:449-461`, passenger `active_ride_passenger.js:407-421` — and then merge the authoritative server ride onto it (driver `runInitialDriverRead()`, `active_ride.js:1327-1340`; passenger `runInitialRead()`, `active_ride_passenger.js:3446`, merge at `:3558-3580`). The server `serializeRide()` (`server/src/serialize.js:90-132`) returns only `pickupLabel`, `dropoffLabel`, `etaToPickup` and `etaToDestination` in `route` and only `offerPrice` in `order` — no coordinates, maneuver, distance or tags. Both `mergeServerRide()` functions overlay only the non-null server keys onto the local object, `keep(local, server)`-style:

- driver (`active_ride.js:541-560`): `route` goes through `keep()` and the local `order` is carried whole;
- passenger (`active_ride_passenger.js:2651-2788`): route labels and ETAs, the fare and the order ETAs/distance are already server-or-neutral (`:2717-2723`, `:2772-2778`), but every other route and order key is still `keep()`-preserved.

So after an authoritative read of a non-terminal ride both screens still hold the demo `route.pickup`, `route.dropoff`, `route.currentInstruction`, `route.currentStreet`, the demo distance-to-pickup and the demo order labels/tags; the driver screen also keeps the demo order ETAs and any route label or ETA the server returns as null. An authoritative server read can therefore leave the Moscow demo route in place.

### P1-2 — passenger and driver pickup coordinates can differ for the same order

- The passenger seed copies the order points into the ride (`public/src/ride_seed.js:82-83`). Those points carry label-hash mock coordinates (`public/src/passenger_order_utils.js:23-53`, attached at publish in `public/src/screens/order_map_draft.js:838-839`).
- The driver seed drops the order coordinates (`buildRouteSnapshotFromOrder()`, `ride_actions.js:135-158`) and inherits the demo ones (P1-1).
- Preflight example, one order: passenger pickup 55.9322 / 37.692, driver pickup 55.7558 / 37.6173, about 20 km apart. The mock-hash formula only produces latitudes of about 55.58–55.94, so no address can land in Marfino (56.085).

### What P1-1 and P1-2 block

- The Driver Free Drive live rollout (slice 07).
- The Driver Active Navigation runtime (slice 09).

Prerequisite: **`BD-MAP-DUAL-EXPERIENCE-01B` — remove demo-route inheritance and preserve canonical order coordinates.** It is a runtime slice and is not fixed in this docs slice. Scope:

- A. every real-ride constructor or seed built on `createDemoActiveRide()`, starting with the three seeds above (explicit `?fixture=` builders stay demo by design, §10);
- B. the driver backend-hydration merge, `active_ride.js` `mergeServerRide()`;
- C. the passenger backend-hydration merge, `active_ride_passenger.js` `mergeServerRide()`;
- D. direct entry: a valid backend trip with no local canonical record.

PLANNED acceptance:

- An accepted ride's pickup/destination labels and coordinates equal the order's.
- After a successful authoritative hydration, no route field the server omits is inherited from the demo ride. Unless the server supplies a real value, `route.pickup`, `route.dropoff`, `route.currentInstruction`, `route.currentStreet`, the demo distance/ETA and the demo route labels/tags are absent or null, and the UI hides empty values. Real server-provided labels and ETAs may stay.
- Smoke pins guard the seeds and the direct-entry / no-local-record hydration on both the driver and the passenger screen: after server hydration, neither carries demo Moscow route residue.

### P1-3 — the public order feed would expose trusted precise passenger coordinates

CURRENT evidence:

- `GET /api/v1/orders` is a public feed: resolving the viewer is optional, anonymous browsing is allowed, and every request lists the `CREATED` orders (`server/src/services/orders/index.js:35-47`).
- `serializeOrder()` returns the stored `pickup` and `dropoff` JSON unchanged (`pickup: row.pickup ?? null`, `dropoff: row.dropoff ?? null`, `server/src/serialize.js:20-44`). `POST /orders` stores each point as opaque JSONB, including any `coords` or `lat` / `lng` it carries (`server/src/services/orders/index.js:10-33`).
- The client role guard and `isDriverLineReady()` (`driver_map.js:424-433`, `652-672`) only gate the UI. They are not an HTTP security boundary: any caller can read the feed directly.

Today the shipped client writes no trusted precise point — its stored coordinates are `mock_hash` or `unknown` (§7) — so the feed does not yet publish real passenger positions from the product flow. It would the moment trusted precise pickup / dropoff coordinates are written through this seam.

P1-3 blocks:

- server persistence or publication of trusted precise pickup / dropoff through the current order seam;
- backend-driven exact order markers on Driver Free Drive (slice 07).

It does not block:

- the passenger acquiring trusted points locally (slice 05);
- the passenger's own local live overlay (slice 05), as long as precise coordinates are not published through the unsafe server projection.

Prerequisite: slice **05G — Order Geo Privacy / protected opportunity projection** (§13). It is a runtime slice and is not fixed in this docs slice.

## 6. Shared geo authority — conceptual contracts

State: conceptual only. No runtime module, wire format or DB schema is defined here; slice 02 turns these shapes into a runtime seam.

Coordinates are WGS84 decimal degrees with named `lng` / `lat` fields. A positional `[lng, lat]` array is a Mapbox-boundary adapter detail, never a contract shape.

Validity (frozen): a `GeoPoint` is valid if and only if `lng` and `lat` are both finite numbers and `-180 <= lng <= 180` and `-90 <= lat <= 90`. The shared geo seam MUST reject an invalid point before it reaches a Mapbox Marker, a GeoJSON source, `fitBounds`, a route request or a presence / public overlay. It never clamps, wraps or silently normalizes a value: `lat = 100` or `lng = 500` is invalid, not corrected. The vendored Mapbox GL `LngLat` throws on a latitude outside [-90, 90] and does not range-check longitude (`public/vendor/mapbox-gl/mapbox-gl.js`), so an unvalidated latitude can abort an overlay render and an out-of-range longitude is not rejected by the SDK at all. CURRENT: no end-to-end guard exists (see the carriers table below); slice 02 MUST create the single bounded validator that every map, route and presence consumer goes through.

```text
GeoPoint {
  lng,                     // finite, -180 <= lng <= 180
  lat,                     // finite, -90 <= lat <= 90
  accuracyMeters?,
  capturedAt?,             // REQUIRED when provenance = device_fix: the sensor capture instant (capture time below)
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
  point: GeoPoint,         // production: a fresh device_fix only (vehicle position below)
  headingDegrees?,
  speedMps?,
  updatedAt                // record update / receipt time; never a substitute for point.capturedAt
}

NavigationRouteView {
  origin,                  // current VehiclePosition used for this computation, on both legs; its point is a fresh device_fix
  destination,             // leg end: pickup point (pickup leg) or destination point (dropoff leg)
  geometry,                // ordered route line; encoding is frozen in slice 08
  distanceMeters,
  durationSeconds,
  trafficDurationSeconds?,
  steps?,                  // maneuvers; shape is frozen in slices 08 and 09
  updatedAt
}
```

Motion has a single owner: `headingDegrees` and `speedMps` belong to `VehiclePosition` only. `GeoPoint` is a position fix without motion fields, so a position update can never carry two copies that disagree.

Capture time (frozen): `capturedAt` is the instant a position was actually acquired. For a `device_fix` it is the time of the sensor fix itself (the Geolocation API position timestamp) — never the time the fix was uploaded, received by the backend or rendered. IF `provenance = device_fix` THEN `capturedAt` is REQUIRED and MUST be a valid timestamp. This is separate from coordinate validity above: a `device_fix` with valid bounded coordinates but no valid `capturedAt` violates the shape, is never live-eligible (§7) and is never repaired by substituting another time. For every other provenance value `capturedAt` stays optional, because a user pin, a geocode or a provider routable point has no sensor capture time. `VehiclePosition.updatedAt` records when the position record was updated — possibly the upload or receipt time — and is never a substitute for `point.capturedAt`.

Device-fix freshness (frozen): any consumer that uses a `device_fix` as a live position — the device's or a vehicle's current location, such as an own-position marker, a presence position or a route origin — MUST check both:

1. `capturedAt` exists and is a valid timestamp;
2. the fix is inside an explicit, finite freshness budget:

```text
ageMs    = now - capturedAt
eligible = ageMs >= 0 AND ageMs <= freshnessBudgetMs
```

`freshnessBudgetMs` MUST be finite and positive, and the consuming contract or slice defines it explicitly — for example slice 05 when it adopts the passenger's current position as the pickup, slice 07 for the driver's own marker, slices 08 and 09 for route origins, slice 06P for presence positions on the Passenger Map. The Presence track defines its own heartbeat / TTL budget later (BD-DOCS-033; this contract does not change it). A consumer without a defined budget fails closed: its `device_fix` is not live-eligible. A device fix therefore never stays eligible indefinitely. `now` and `capturedAt` must be comparable: a consumer that compares a device-captured time with another clock (for example the server's) bounds the clock skew inside its budget definition, or fails closed. This contract deliberately freezes no numeric budget or default: the Presence decision record (BD-DOCS-033, `status: draft`) still leaves its heartbeat interval and TTL open, and a missing number is not a missing expiry rule.

Consumer rules:

- Map live position: an expired `device_fix` is not drawn live.
- Presence: an expired `device_fix` does not count as a fresh location fix.
- Routing / reroute: an expired `device_fix` can never be `NavigationRouteView.origin`.
- Driver active guidance: without a fresh fix, the UI shows an honest no-current-position / waiting / retry state and never routes from a last-known stale coordinate.

No consumer substitutes `VehiclePosition.updatedAt`, a backend receipt time, the render time or a previous route origin for `capturedAt`.

Adopted waypoints: a fix adopted as a canonical ride waypoint — for example the passenger's current position chosen as the pickup (§3.1) — passes the freshness check when it is adopted. It is then a waypoint owned by the Ride / Order authority (§8), not anyone's current position, so it does not expire the way a live position does; a stale fix can never be adopted.

Vehicle position (frozen): a production `VehiclePosition.point` MUST have `provenance = device_fix` and satisfy the bounded `GeoPoint` rule, carry a valid `capturedAt` and be inside the consumer's freshness budget — never expired. `user_pin`, `geocode_point`, `provider_routable_point`, `unknown`, `mock_hash` and `simulation` are never a current vehicle position. Only an explicit fixture / demo mode (§10) may use `simulation`, and such a `VehiclePosition` is not production Presence. Presence may reduce the precision of, or quantize, a fresh device fix for privacy or proximity (BD-DOCS-033 scopes presence location as coarse); the result keeps `provenance = device_fix` and its original `capturedAt` as long as it is derived from a fresh device measurement. A heartbeat receipt or `updatedAt` never makes an old point fresh, and server rounding or coarsening never turns the position into `geocode_point`, `user_pin` or `provider_routable_point`. Consumers: slice 06P (nearby vehicles and the assigned driver) accepts only a fresh production `VehiclePosition`, slice 07 (the driver's own vehicle) only a fresh `device_fix`, and slices 08 / 09 only a fresh `device_fix` as the route origin (below).

Route origin (frozen): `NavigationRouteView.origin` is the current `VehiclePosition` — the driver's position that this specific route computation used — on both legs:

- pickup leg: current vehicle position → pickup;
- dropoff leg: current vehicle position → destination.

On the first dropoff computation the car is usually still at the pickup, but the pickup never becomes a permanent origin. A reroute MUST use the freshest valid, non-expired current vehicle position as `origin` (device-fix freshness above): an expired fix is never an origin, and without a fresh fix no route is computed and active guidance shows its honest waiting state. Once the driver has left the pickup, the remaining route is never recomputed from the historical pickup to the destination. The pickup stays a canonical ride waypoint owned by the Ride / Order authority (§8), not the fixed origin of an active reroute. A reroute updates only the navigation / routing view: it never mutates the pickup, the destination or the ride status.

Active guidance routing shape (frozen): a `NavigationRouteView` represents exactly one active guidance leg — pickup guidance (current vehicle position → pickup) or dropoff guidance (current vehicle position → destination). A provider result for active guidance may therefore contain exactly one leg between two stops.

CURRENT: the existing server `RouteComputation` cannot represent that shape. `server/src/domain/route-computation.js` is a fixed 3-stop / 2-leg normalizer — driver → pickup → destination (`STOP_ROLES`, `:27-32`) with `LEG_ROLES = ['to_pickup', 'trip']` (`:180-182`) — and it rejects any raw route whose leg count is not exactly 2 with `unexpected_leg_count` (`:316-322`). It stays a useful normalization and reference baseline for route metrics and provider semantics, but it is not a ready normalizer for single-leg active navigation.

PLANNED (slice 08): slice 08 MUST either extend `RouteComputation` or add a separate sibling normalizer that supports an explicit 2-stop / 1-leg active-guidance computation; the existing runtime is not changed in this slice. Slice 08 acceptance:

- current vehicle position → pickup is supported;
- current vehicle position → destination is supported;
- a one-leg result is never rejected with `unexpected_leg_count`;
- a dropoff reroute never routes the driver back through the pickup;
- an origin whose `device_fix` is expired or has no valid `capturedAt` is rejected, never routed from.

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
| `GeoPoint` | Five shapes: `{lat, lng}` (`readCoord`, server `toPoint`), `{lng, lat}` (`ride.route.pickup`, the map center), nested `coords: {lat, lng}` (route-draft point), flat `{id, label, lat, lng}` (order point), `[lng, lat]` (Mapbox) | Finite-number checks only (`readCoord`, `passenger_order_utils.js:15-21`; `public/src/mapbox/driver_markers.js:26-35`) — not enough, since they accept `lat: 100` or `lng: 500`; the server top-level `lat` / `lng` bounds (`server/src/services/orders/index.js:30-31`), which the opaque nested `coords` (`:29`) and persisted local drafts bypass; the server `COORDINATE_PROVENANCE` vocabulary | `accuracyMeters`, `capturedAt`, `provenance` — nothing captures them (no GPS) |
| `PickupPoint` | Route-draft point, `order.pickup`, `ride.route.pickupLabel` + `ride.route.pickup`, driver handoff snapshot (label only), server `orders.pickup` JSONB, `rides.route_pickup_*` columns | `order.pickup` as the carrier; the route-draft `source` field records the UI entry path, not coordinate provenance (§7) | `entrance`, a point-level `note`, provenance |
| `DestinationPoint` | The same carriers under `dropoff` | Same | Naming differs — runtime `dropoff`, server `destination` (`route-computation.js:32`); runtime field names stay as they are until a runtime slice |
| `VehiclePosition` | None: the car is a CSS dot; `ride_events.type` allows three non-position types only (`server/migrations/0003_ride_status_change.sql:24`); Presence #2 is a dark 501 | — | All fields, including the only home of the motion fields (`headingDegrees`, `speedMps`) |
| `NavigationRouteView` | None | Server `RouteComputation` only as a reference baseline for route metrics and provider semantics — it is a fixed 3-stop / 2-leg normalizer and cannot represent one-leg active guidance (see the active guidance routing shape above) | All fields |

## 7. Provenance

Provenance records where a coordinate came from — its origin — never how it travelled. Conceptual values:

| Value | Meaning |
| --- | --- |
| `device_fix` | A position the device actually measured (Geolocation API). It MUST carry its sensor capture time in `capturedAt` (§6 capture time). |
| `user_pin` | A point the user placed by hand. |
| `geocode_point` | A point produced by geocoding an address or a search result. |
| `provider_routable_point` | A routable point supplied by the geo provider (a road-network access point for an address). |
| `mock_hash` | Only coordinates actually synthesized from a label hash by `deriveMockCoordsFromLabel()` (`passenger_order_utils.js:23-33`). |
| `simulation` | A point produced by a simulator, a visualization or fixture playback (§12). |
| `unknown` | A coordinate exists but its origin was never recorded. Conceptual label; it does not have to become a runtime enum value in this slice. |

The first four values are exactly the server `COORDINATE_PROVENANCE` vocabulary (`server/src/domain/route-computation.js:95-100`). `mock_hash`, `simulation` and `unknown` cover coordinates with no real origin, or none recorded.

Transport is not provenance. Sending a point to the backend and reading it back never changes its provenance: a device GPS fix relayed through the server to the passenger stays `device_fix`, and a server-side geocoder result delivered to the client stays `geocode_point`. There is no `backend` provenance value, and no transport field is required now; if transport or authority metadata is ever needed, it is separate, orthogonal metadata, never coordinate provenance.

CURRENT: no runtime point carries a provenance field. Coordinates synthesized by `deriveMockCoordsFromLabel()` are `mock_hash`: every route-picker point built by `makePoint()` (`route_picker.js:159-167`) and the label-hash fallback of `resolvePointCoords()` (`passenger_order_utils.js:35-39`). Other stored coordinates are not known to be `mock_hash`: `resolvePointCoords()` keeps any finite `coords` value it is given, so a persisted route draft (`route_picker.js:217`) or an order point can carry coordinates of unrecorded origin, and with the backend seam on, `POST /orders` accepts and returns `coords` or flat `lat` / `lng` without provenance (`server/src/services/orders/index.js:14-33`). Such coordinates have `unknown` provenance. The route-draft point whose `source` is `current` («Моё место», `route_picker.js:39-44`) is built by `makePoint()`: its coordinates are `mock_hash` because `deriveMockCoordsFromLabel()` synthesized them, and the word `current` never makes a point a `device_fix`. Because nothing stores provenance today, a coordinate read back from storage is `unknown` even if it was originally synthesized; slice 02 records provenance where coordinates are created.

Rules (frozen):

- `mock_hash` applies only to coordinates actually synthesized by `deriveMockCoordsFromLabel()`.
- An existing finite `lat` / `lng` without provenance has `unknown` provenance. A missing provenance never means any recorded value — not `device_fix`, `user_pin`, `geocode_point`, `provider_routable_point`, `mock_hash` or `simulation`.
- Unknown provenance is never guessed from an object's shape or its storage location.
- A round trip through the backend keeps the provenance a point was created with; transport never assigns or replaces provenance.
- `mock_hash` MUST NEVER be presented as a real GPS / `device_fix` position.
- `simulation` MUST NEVER enter production driver presence.
- UI MUST NOT silently promote mock/demo coordinates to live ride coordinates.

Live map eligibility (frozen): a coordinate may be drawn as a live map position — a marker, overlay or route endpoint on the live Mapbox surface — only if ALL of these hold:

1. it is a valid bounded `GeoPoint` (§6);
2. its provenance is one of the trusted real-origin values `device_fix`, `user_pin`, `geocode_point` or `provider_routable_point`;
3. for a `device_fix` only: it carries a valid `capturedAt` and is not expired under the consumer's freshness budget (§6 device-fix freshness) — checked at use for a live position, or at adoption for a canonical waypoint (§6 adopted waypoints).

Trusted provenance alone is not enough for a `device_fix`: without a valid `capturedAt`, or outside the consumer's freshness budget, it is not live-eligible. The sensor freshness rule does not apply automatically to `user_pin`, `geocode_point` and `provider_routable_point`, because they are not moving sensor fixes. `mock_hash`, `simulation`, `unknown` and a missing provenance are never eligible for a live position. Eligibility is a positive allowlist, never the rule `provenance != mock_hash`. A legacy coordinate without recorded provenance is `unknown` and is not drawn live; it becomes eligible only through a path that records real provenance — a re-geocode, a new user pin, a fresh device fix where that is semantically valid (for example the passenger's own current pickup), or an explicit migration that records real provenance. Until then the point may remain text / list data, never a live map position. Mock or simulation data appears on a map only inside an explicit demo / fixture mode (§10), never as a live position. Slice 02 provides one shared trusted-live eligibility helper / seam that checks the bounds, the provenance eligibility, the conditional `device_fix` `capturedAt` requirement, device-fix freshness against an explicit caller / consumer budget and the stricter vehicle-position rule (§6), so slices 05, 06, 06P and 07 never invent their own filters and routing (slices 08 and 09) applies the same rule to route origins.

Generic point eligibility and vehicle-position eligibility are not the same (frozen). Waypoints — a pickup, a destination, an order opportunity — may be `user_pin`, `geocode_point` or `provider_routable_point`. A moving vehicle's current position is a fresh `device_fix` only (§6 vehicle position): passing the generic allowlist above is never enough for it, and a `user_pin`, `geocode_point` or `provider_routable_point` is never a vehicle's current location.

PLANNED: slice 02 freezes the runtime field with this single origin-based vocabulary — the server `COORDINATE_PROVENANCE` values plus `mock_hash`, `simulation` and `unknown` — so the client and the server never map between two competing sets. `mock_hash` and `simulation` have no server equivalent and are never sent as real coordinates.

## 8. Authority

| Authority | Owns | CURRENT holder | PLANNED holder |
| --- | --- | --- | --- |
| Ride / Order | Pickup, destination, selected driver, trip id, ride status | Conditional on the backend seam (see below): the local stores while it is off; the server for the flows already cut over while it is on. | The server ride/order authority end-to-end (BD-DOCS-030, BD-DOCS-034) |
| Location | Driver and passenger current position, vehicle heading/speed, freshness timestamps | Nobody: no geolocation; Presence is dark | Device capture through the `geolocation_service` seam; server Presence #2 for the shared driver position (heartbeat + TTL, coarse location — BD-DOCS-033) |
| Routing | Geometry, distance, ETA, traffic estimate, maneuvers | Client label-hash estimates; the server `RouteComputation` has no caller and `route-price` is a dark 501 | A server-owned route authority (BD-DOCS-035); `NavigationRouteView` is its presentation projection |
| Pricing | The fare | Client formula `80 + 35·km` with a passenger override (mock) | **Server only** (BD-DOCS-035); the passenger adjustment becomes a bid on top of the estimate |

Ride / Order CURRENT holder, by backend seam state (`isBackendEnabled()`, `public/src/api_config.js:47-50`, off unless an API base is configured):

- Seam OFF (the default): the local stores are the authority — `bazardrive.ride_orders.v1`, and `bazardrive.active_ride.v1` through `ride_state.js`.
- Seam ON, flows already wired to the server: the server response / state is authoritative, and local browser state is a projection, cache or UI state — never a second independent authority. These flows are passenger order publish and the order feed (`createRideOrder()` → `POST /orders`, `listNearbyOrders()` → `GET /orders`; driver test orders stay local, `mock_api.js:556-560`), matching — driver offers, the offers board and passenger select (`submitOfferToBackend()` → `POST /matching/offers`, `listOrderOffers()` → `GET /matching/offers`, `selectOfferOnBackend()` → `POST /matching/select`) — and the active-ride read, status write and realtime poll (`getRideFromBackend()`, `patchRideStatus()`, `pollRide()` in `public/src/mock_api.js`). Both active-ride screens load the server ride and send status transitions through `patchRideStatus()` when the seam is on (`active_ride.js:482`, `638-659`, `1334`; `active_ride_passenger.js:2140`, `2469`, `3518`).
- Seam ON, flows not yet cut over: they stay local. For example, the `/driver-map` accept of a server order is not wired and shows a notice instead (`driver_map.js:746-750`), and `acceptNearbyOrder()` only flips local status. This contract does not claim a full backend cutover; BD-DOCS-042's per-route matrix remains the source of truth for which server routes are live or pilot-blocked.

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

These are non-goals for the PWA: it does not guarantee them. Listing them here does not mean a native shell already has an agreed contract for them.

FUTURE NATIVE: the Mapbox Navigation SDK may replace only the navigation UI layer — rendering, the navigation camera and voice / lane presentation. Authoritative routing stays server-owned (§8), and `NavigationRouteView` stays a presentation view of it. This contract does not promise offline route computation, offline rerouting or SDK-computed canonical routes. The same Ride / Geo contract (§§4, 6–8) must remain: a native shell consumes the same authorities and never becomes a second source of truth.

**Offline navigation and native reroute reconciliation are OUT OF SCOPE for BD-MAP-DUAL-EXPERIENCE-01A** and must be defined in a future native ADR before any native implementation.

Portrait lock: landscape dashboard mounts are unsupported while the manifest locks portrait. Changing it is a separate, app-wide decision.

## 10. Demo data rule (frozen)

**DEMO DATA MUST NEVER APPEAR ON A LIVE MAP WITHOUT AN EXPLICIT DEMO/FIXTURE MODE.**

An explicit demo / fixture mode is demo-specific and unambiguous: a known `?fixture=<name>` value (for example the `/driver-map` fixtures, `driver_map.js:37-40`) or a dedicated demo state / flag that normal product navigation never sets on its own. Demo data drawn over a real map also carries a visible, unmistakable «Демо» indicator. A demo mode is never inferred from a failure.

A generic product render state is not demo consent. `?state=` is normal navigation: the location-permission allow branch opens `/map?state=default` (`location_permission.js:165`, likewise `map.js:453`) and the `/map` nearby CTA opens `/map?state=nearby` (`map.js:455`) without the user choosing a demo. `state=default`, `state=nearby` and every other render state never authorize mock coordinates; the same holds for `/active-ride?status=`, which the accept handoffs set on every accept (`status=ACCEPTED` from `/driver-map`, `driver_map.js:806-807`; `status=DRIVER_EN_ROUTE` from `/responses`, `responses.js:1382`). CURRENT `/map?state=nearby` may keep its placeholder demo UI (§3.1), but a future live Mapbox overlay MUST NOT treat that state as permission to show fake coordinates.

Forbidden silent fallbacks:

- Moscow coordinates;
- demo ETA;
- demo route instructions;
- demo vehicle locations;
- `mock_hash` coordinates displayed as GPS;
- coordinates with `unknown` or missing provenance displayed as live positions (§7 live map eligibility);
- a `device_fix` without a valid `capturedAt`, or outside its consumer's freshness budget, displayed as a current position (§6 device-fix freshness).

No silent fallback from a live failure to a fake live state: an SDK, token, GPS or routing failure shows an honest placeholder or error state.

CURRENT demo sources that must stay behind an explicit mode, or be removed, before any live overlay ships:

- the demo route inherited by accepted rides and kept through backend hydration (P1-1);
- `buildDemoRide()` / `DEMO_ACTIVE_RIDE_ID` (`trip_moscow_sheremetyevo_demo`, `ride_state.js:69`) and the simulation fallback of `/active-ride` without a real trip (`active_ride.js:449-480`);
- the `/driver-map` fixtures (`?fixture=`, `driver_map.js:37-40`) and the `/map` `NEARBY` demo rows and clusters;
- the MapShell default route (`public/src/mapbox/map_shell.js:4-7`) and the route-picker suggestion lists (`route_picker.js:50-95`) — central Moscow, Sheremetyevo, Vnukovo;
- label-hash coordinates (`passenger_order_utils.js:23-33`).

CURRENT honest fallback: `/map` keeps or restores the MapShell placeholder on a dark token, an SDK load failure or a `Map` constructor failure. A Mapbox `error` before the first `load` (offline, rejected token, quota) is not handled yet and leaves an empty map canvas (`map.js:210` handles `load` only); slice 03 owns that fallback.

## 11. Mapbox split

| Experience | Engine | Camera | Bounds | Content | Status |
| --- | --- | --- | --- | --- | --- |
| Passenger Map | Mapbox GL JS, custom Marfino style | Free camera; `fitBounds` | Soft working area | Pickup / destination and nearby cars on `/map`; assigned-driver tracking on the passenger active-ride map | CURRENT: base map only on `/map`; the rest is PLANNED |
| Driver Free Drive | Mapbox GL JS | Follow / recenter; optional heading-up | No `maxBounds` | Own vehicle and order opportunities | PLANNED |
| Driver Active Navigation — PWA | Mapbox GL JS | Route-following | No hard bounds | Route visualization, maneuver presentation | PLANNED |
| Driver Active Navigation — native | Mapbox Navigation SDK | Navigation camera | No hard bounds | Voice / lane presentation; offline and rerouting authority deferred to a future native ADR | FUTURE NATIVE |

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
| 01B | Remove demo-route inheritance (seeds, both backend-hydration merges, direct entry); preserve canonical pickup/dropoff (§5) | 01A | PLANNED — prerequisite for 07 and 09 |
| 02 | Shared `GeoPoint` + origin-based provenance + bounded WGS84 validator + trusted-live eligibility helper, including the conditional `device_fix` `capturedAt` requirement and device-fix freshness against an explicit caller budget (runtime seam; §§6–7) | 01A | PLANNED |
| 03 | Shared `map_surface` lifecycle + Mapbox error fallback | 01A | PLANNED |
| 04 | Real passenger geolocation; every captured `device_fix` records its sensor capture timestamp in `capturedAt` (§6) | 02, 03 | PLANNED |
| 05 | Passenger trusted point acquisition + pickup/dropoff overlays; acquisition precedes rendering; publishes no trusted precise point through the server order path before 05G (§3.1) | 02, 03, 04 | PLANNED |
| 05G | Order Geo Privacy / protected opportunity projection: the public `/orders` projection never exposes precise trusted pickup / dropoff; exact coordinates only through a server-authorized projection (§5 P1-3; details below) | 02; the server order seam (backend track) | PLANNED — prerequisite for publishing trusted precise points and for 07's backend order markers |
| 06 | Real Mapbox marker adapter | 02, 03 | PLANNED |
| 06P | Passenger Presence / Tracking integration: consumes server Presence on two passenger surfaces — nearby real vehicles on `/map` and the assigned driver's current vehicle position on the passenger active-ride map (§3.1; details below) | 02, 03, 06; the Presence track (BD-DOCS-033); for assigned-driver tracking also the Ride / Order selected-driver / trip identity (§8) | PLANNED — waits on the Presence track |
| 07 | Driver Free Drive; backend order markers only from 05G's protected projection (§3.2) | 01B, 02, 03, 04, 05G, 06 | PLANNED — blocked by 01B and 05G |
| 08 | Server Directions / routing authority, including a 2-stop / 1-leg active-guidance computation that rejects expired origin fixes (§6) | 02; backend pilot gates; BD-DOCS-035 follow-ups | PLANNED |
| 09 | Driver Navigation PWA; registers `/driver-navigation`; routes only from a fresh origin fix, with an honest waiting state without one (§§3.3, 6) | 01B, 03, 06, 07, 08 | PLANNED — blocked by 01B |
| 10 | Native Navigation SDK | 09; a native-shell governance decision; a native ADR defining offline navigation and reroute reconciliation | FUTURE NATIVE — later |

Slice 05G — Order Geo Privacy / protected opportunity projection (PLANNED) closes P1-3 (§5). Invariants:

1. The public `/orders` projection MUST NOT expose precise trusted pickup / dropoff coordinates.
2. Public discovery may expose labels, non-coordinate metadata and, optionally, an explicitly coarse / privacy-safe area representation — never a precise routable `GeoPoint`.
3. Precise trusted pickup / dropoff coordinates are protected order data.
4. Exact coordinates are served only through a server-authorized projection to an allowed actor. For a driver opportunity that means an authenticated driver identity plus server-authorized eligibility (role / readiness) once that server gate exists; until it exists, precise coordinate disclosure fails closed. The client `isDriverLineReady()` check is never the security boundary for the HTTP API.
5. Ride participants read an accepted trip's precise coordinates only through a participant-authorized server boundary, never through the anonymous feed.
6. The endpoint shape is not frozen in 01A: 05G may choose a protected opportunity endpoint / projection, or a coarse public projection plus a protected exact read, as long as invariants 1–5 hold.

Until 05G ships, precise trusted points stay local to the passenger (slice 05, §3.1) and slice 07 draws no backend order marker (§3.2).

Slice 06P — Passenger Presence / Tracking integration (PLANNED) is the client consumer of server presence on two passenger surfaces:

- A. `/map` — nearby vehicles before assignment: discovery / nearby presentation;
- B. the passenger active ride, `/active-ride?role=passenger&tripId=<id>` — assigned-driver tracking: the current assigned-driver marker, updated or removed as presence changes. Today's `active-ride__map` MapShell placeholder (`active_ride_passenger.js:2201-2211`) is the integration surface, adapted through the shared map lifecycle (03) and marker adapter (06). No return to `/map` is required, no new route is added and `HIDE_CHROME` (`router.js:94`) stays unchanged.

On both surfaces 06P consumes only fresh production `VehiclePosition`s (§6 vehicle position), obeys trusted-live eligibility and device-fix freshness (§§6–7) and has no demo fallback (§10).

It depends on 02 (the `GeoPoint` / provenance / freshness seam), 03 (the shared Mapbox lifecycle), 06 (the real Mapbox marker adapter) and the Presence track (BD-DOCS-033). Assigned-driver tracking also needs the Ride / Order authority (§8): the marker is bound to the real selected driver and trip identity — for example the `selectedDriverId` recorded at passenger select and the ride's `tripId` — never to a UI or demo row. Slice 04 is not a dependency, because the passenger's own GPS and the drivers' presence are different sources; neither is slice 05, because pickup / dropoff overlays and vehicle tracking evolve independently. Positions render at the accuracy the Presence track provides: BD-DOCS-033 scopes presence location as coarse and defers the accuracy policy.

Slice 06P acceptance (PLANNED):

- Nearby vehicles: reachable on `/map`; only real Presence positions, and only fresh production `VehiclePosition`s; an expired or stale position is removed or never drawn; no demo vehicle fallback.
- Assigned driver: reachable in the normal post-selection flow without leaving `/active-ride`; the marker binds to the selected driver and trip identity the Ride / Order authority assigned, and its position is a fresh production `VehiclePosition` from Presence; a stale or expired position is removed or hidden, never kept as if the driver were still there; without a fresh position the marker is hidden and the UI honestly shows that the location is unavailable, never a fake or demo coordinate.
- The passenger map UI never becomes the authority for a driver position.

The Presence track runs separately (server Presence #2, BD-DOCS-033). It creates the server presence truth — which drivers are online and where, driven by heartbeat and TTL — and is a prerequisite, not the client integration: slice 06P is the client consumer of that truth on the Passenger Map. A Presence runtime without 06P does not mean nearby vehicles or assigned-driver tracking have shipped. BD-DOCS-033 is still a `status: draft` decision record and the Presence service is unimplemented (dark); this contract does not change it.

Mapping to `docs/db-mapbox-readiness.md`: M1's service-worker safety is already satisfied for the registered (still dark `501`) Route & Price path `/api/v1/route-price` — production uses two origins (BD-DOCS-041), the Pages PWA reaches that path on the separate backend origin, and `public/sw.js` bypasses that cross-origin traffic through its origin guard; same-origin `/api/` dev / proxy traffic is bypassed through its pathname guard. M1's CSP gate stays open: the exact backend API origin must be added to `connect-src` before the production backend is enabled, and a direct-browser external provider, if ever chosen, needs its own additional origin. The Route & Price decision record (BD-DOCS-035) states the same model. M2 (the stub seams as the single swap boundary) lands through slices 03, 06 and 08; M3 (real geolocation behind `geolocation_service`) is slice 04.

Every slice is its own branch and PR, and the Mapbox track and the DB track never share a PR (`docs/db-mapbox-readiness.md`).

## 14. Acceptance for this slice (01A)

- Only these docs change: this file, `docs/screen-contracts.md`, `docs/flow-contracts.md`, `docs/db-mapbox-readiness.md` and `docs-site/docs/decisions/route-price-map.md` (BD-DOCS-035: its service-worker / CSP state is reconciled with M1; docs only).
- `public/src/app.js` still registers `/map` and `/driver-map` and does not register `/driver-navigation`.
- Every capability above is labelled CURRENT, PLANNED or FUTURE NATIVE; no PLANNED item is described as shipped.
- P1-1 and P1-2 are recorded with evidence and routed to `BD-MAP-DUAL-EXPERIENCE-01B`; P1-3 is recorded with evidence and routed to slice 05G.
- `NavigationRouteView` is the name for map/navigation route data; `RouteSnapshot` is not reused.
- `git diff --check`, `node scripts/check.mjs` and `node scripts/dispatcher.mjs` pass.

## 15. Non-goals (01A)

No runtime code, route registration, service worker or CSP change, Mapbox API call, backend, DB or migration, design-registry change, document-registry registration, and no Blender or Unity artifacts. Fixing P1-1 and P1-2 is slice 01B; fixing P1-3 is slice 05G.
