# BD-MAP-DUAL-EXPERIENCE-01A — Map experiences contract

Status: map architecture contract / draft, with the 01B route-source correction implemented in this revision. Only items labelled **CURRENT** describe shipped runtime; **PLANNED** and **FUTURE NATIVE** items are targets, not shipped behavior.

Gate: `BD-MAP-DUAL-EXPERIENCE-01A-CONTRACT`.

Preflight: `BD-MAP-DUAL-EXPERIENCE-00A-PREFLIGHT-AUDIT` (read-only audit; its findings are the CURRENT evidence below).

Layers: PWA / Mapbox / Geo / Routing / Ride authority / Docs.

Audited baseline: [`main@909f7f3ce8748f5333210370a67c2cef58448c86`](https://github.com/iprus2026-tech/BazarDriveCloud/commit/909f7f3ce8748f5333210370a67c2cef58448c86).

## 1. Scope and authority

This contract splits BazarDrive map work into three map experiences inside one PWA — **Passenger Map**, **Driver Free Drive** and **Driver Active Navigation** — and freezes the rules they share: the status → navigation-leg mapping, the conceptual geo shapes, coordinate provenance, authority ownership, the PWA/native boundary, the demo-data rule and the prerequisite slice order.

It changes no runtime file. It does not register a route, touch the service worker or CSP, call a Mapbox API, or add backend, DB, migration, Blender or Unity artifacts. Shipped behavior stays documented in `docs/screen-contracts.md` and `docs/flow-contracts.md`; Mapbox-track readiness caveats stay in `docs/db-mapbox-readiness.md`. Server authority decisions stay with the docs-site ADRs — [Route & Price, BD-DOCS-035](../docs-site/docs/decisions/route-price-map.md) and [Presence & Heartbeat, BD-DOCS-033](../docs-site/docs/decisions/presence-heartbeat.md). This document interprets them for map UX and never overrides them; this PR synchronizes the authoritative ADRs where required: BD-DOCS-035 for Route & Price / routing-financial authority, BD-DOCS-033 for Presence passenger-projection privacy and status cutoffs, and BD-DOCS-041 for the shipped API/service-worker deployment wording (§14).

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
| Pickup / destination markers | None on the live map; static CSS dots on the placeholder only. | Slice 05 acquires and owns the passenger's canonical trusted pickup / destination state; slice 06, which depends on 05, renders those already-acquired points through the shared real Mapbox marker adapter. Slice 05 never bypasses the marker seam and does not ship live Mapbox markers by itself. |
| Nearby vehicles | None. `?state=nearby` shows static demo clusters and three demo rows presented as orders, not cars (`map.js:65-69`, `122-137`). | On `/map`: slice 06P uses an authenticated, privacy-scoped `NearbyVehicleMarker` projection derived server-side from Presence (§§6–7, §13), never raw `VehiclePosition` records. Its point is privacy-coarsened / quantized and its marker identity is ephemeral / scoped, never a stable `vehicleId` / `driverId` / assignment / shift identifier. Guest may still open the base-map UI, but receives no production nearby vehicle positions; unavailable auth/projection means no live nearby markers, never a demo fallback. |
| Route geometry | None. | Passenger route presentation uses slice 08's authenticated/budget-gated `WaypointRouteRequest` from canonical pickup → canonical destination. The returned `NavigationRouteView` has `mode = "waypoint"`, carries serializable geometry/distance/duration data, requires no Ride/status and has no guidance `leg`. |
| ETA / price | None on `/map`. Route-picker estimates are a label hash: `durationMin = 8 + 2.4·km`, `estimatedPrice = 80 + 35·km` (`public/src/screens/route_picker.js:191-198`). | Slice 08 owns the production Route & Price cutover: real server waypoint distance/ETA plus server-authoritative fare estimate behind `route_service` / `price_estimator`; the current `80 + 35·km` client formula stops being fare authority, and passenger adjustment becomes a bid rather than fare truth (§8). |
| Assigned-driver tracking | None. The passenger active ride renders the MapShell placeholder in `active-ride__map` (`active_ride_passenger.js:2201-2211`); the realtime poll returns status and events only (`server/src/plugins/realtime.js:68`), and the participant ride read carries driver display fields only — no driver or vehicle identity (`server/src/serialize.js:90-132`). | On the passenger active-ride map, not `/map`: slice 06P draws the assigned driver's current vehicle position on `/active-ride?role=passenger&tripId=<id>`, adapting today's `active-ride__map` MapShell surface through the shared map lifecycle (slice 03) and marker adapter (slice 06); needs the Presence track, a fresh production `VehiclePosition` (§6) and the participant-gated Ride → Presence linkage backend prerequisite (§13 slice 06P): from the `tripId` the server resolves the assigned driver, the active vehicle and that vehicle's Presence position, so the client never guesses which vehicle is the assigned one. |
| Camera | Fixed initial center and zoom; no `fitBounds`, no bounds, no recenter (`map.js:195-200`). | `fitBounds` over pickup, destination and route; soft Marfino working area. |

Rules:

- No turn-by-turn on the Passenger Map, ever.
- The soft Marfino working area is not a hard `maxBounds`. The passenger may pan away; the map offers a way back (for example a recenter control) instead of locking the camera.
- Trusted point acquisition precedes live rendering (slice 05). CURRENT: every route-picker point is built by `makePoint()` with `deriveMockCoordsFromLabel()` (`route_picker.js:159-165`), so today's destination is `mock_hash`, and slice 04 adds only the device position, which can at most supply a real pickup. Before a point is drawn live (§7 live map eligibility):
  - a pickup may be `device_fix` (fresh when it is adopted, §6 adopted waypoints), `user_pin`, `geocode_point` or `provider_routable_point`;
  - a destination MUST be `user_pin`, `geocode_point` or `provider_routable_point`;
  - a `mock_hash` destination never renders on the live Mapbox surface, and no `unknown`-provenance point renders live.
- Slice 05 is deliberately **provider-free**. It may adopt an allowed fresh passenger `device_fix`, accept a `user_pin`, and keep manual/local text state while producing canonical trusted point state. Slice 05 MUST NOT call paid geocoding/search/autocomplete/routable-point providers and therefore does not itself mint `geocode_point` or `provider_routable_point` from an external provider. Those provenance values remain valid in the shared vocabulary because slice 08 owns the future protected provider-backed acquisition path.
- Slice 05 acceptance (PLANNED): provider-free trusted acquisition creates canonical pickup / destination points and passenger-local state before any live rendering. Direct slice-05 origins are the allowed fresh `device_fix` and `user_pin` paths; no paid provider call occurs. It does NOT render real Mapbox pickup / destination markers. Without a trusted destination the canonical destination remains absent and the UI shows an honest pending / manual-pin state, never a fake coordinate. Slice 06 consumes these canonical points and owns live marker rendering through the shared adapter.
- Slice 05 before 05G (PLANNED): slice 05 may acquire trusted pickup / destination points, exact labels and passenger free text locally, but until slice 05G ships it MUST NOT persist or publish protected precise order-location data (§5 P1-3) through the existing server order path in a form that public `GET /orders` would echo anonymously: neither trusted precise coordinates, an exact canonical label (for example a street and house number), nor passenger free-text `comment` that can disclose, reconstruct or materially narrow the exact pickup / dropoff. Allowed meanwhile: local-only precise data, or a privacy-safe server projection that omits exact coordinates, exact canonical labels and passenger free-text comment from anonymous discovery.
- Nearby and assigned-driver positions use different server boundaries in slice 06P (§13). `/map` receives only authenticated privacy-scoped `NearbyVehicleMarker`s derived from Presence, never raw `VehiclePosition` records or stable vehicle / driver identity; Guest receives no production nearby positions. The passenger active-ride surface may receive the assigned driver's fresh production `VehiclePosition` only through the participant-gated Ride → Presence linkage (§13 slice 06P), never by matching display fields or picking the nearest vehicle. Both paths obey their own freshness / privacy rules, never fall back to demo vehicles (§10), and the passenger map UI never becomes a driver-position authority.

### 3.2 Driver Free Drive — `/driver-map`

Purpose: the driver's working map before accepting an order.

| Capability | CURRENT | PLANNED |
| --- | --- | --- |
| Map | MapShell placeholder only, watermark «Mapbox SDK пока не подключён» (`driver_map.js:101-163`); no real Mapbox. | Real Mapbox GL (slice 07). |
| Orders | Mock nearby orders: local `CREATED` orders (at most 20), or `GET /orders` when the backend seam is on, with no distance filter (`public/src/mock_api.js:590-604`). CURRENT backend-only rows can be listed, but the driver-map accept handler cannot accept them: `acceptCanonicalRideOrder()` mutates only the local store, and `driver_map.js:743-750` shows the honest «Приём заказов с сервера появится в следующем обновлении» notice. | Slice 07 owns the complete backend opportunity interaction: protected marker/card data only from 05G, plus the driver-side cutover into the authenticated server matching/offer seam. A server-owned order MUST NOT use local `acceptCanonicalRideOrder()` as authority. An opportunity is actionable only when the real server transition is wired; until then it is explicitly read-only/unavailable, never a production-looking dead-end. |
| Readiness | `isDriverLineReady()` gate plus the role guard (`driver_map.js:424-433`, `652-672`) — a UI gate, not an HTTP security boundary (§5 P1-3). | Unchanged. |
| Own position | None; the car is a static CSS dot. | Own vehicle position, from a fresh `device_fix` only (§6 vehicle position; slices 04 and 07). |
| Camera | None. | Follow / recenter; optional heading-up. |
| Bounds | None. | No hard Marfino bounds: no `maxBounds`. |

Rules:

- No turn-by-turn before an accepted order.
- CURRENT local accept keeps the existing local handoff `/driver-map` → `/active-ride?role=driver&tripId=<id>&status=ACCEPTED` for local-only orders. CURRENT backend-only rows do **not** have that accept handoff; they show the existing notice instead.
- PLANNED slice 07 owns the backend opportunity action cutover. A protected backend opportunity uses an authenticated, server-authorized driver action through the matching/offer seam, never `acceptCanonicalRideOrder()` or another local mutation as authority.
- The current backend assignment model remains intact: driver offer → passenger selects driver → authoritative server assignment → ride bootstrap. A driver offer by itself does **not** create an accepted ride and does not enter Driver Active Ride.
- Slice 07 must keep backend opportunities non-actionable/read-only until the corresponding server driver-eligibility + matching/offer transition is actually available. CURRENT `POST /matching/offers` authenticates the caller but still defers granted-driver role gating, so production slice-07 actionability requires that server-side eligibility boundary rather than relying on `isDriverLineReady()` alone.
- After passenger selection creates the authoritative assignment/ride, slice 07 owns the driver-side handoff needed to discover that assigned trip and enter `/active-ride?role=driver&tripId=<id>`. The exact notification/poll/read transport is not frozen in 01A, but it MUST resolve server-authoritative assignment/ride state, survive reload/cross-device, and never fabricate a local/demo ride.
- Slice 09 later enters Driver Active Navigation from that authoritative active ride.
- The live rollout requires the 01B correction of P1-1/P1-2 (§5), and its backend order markers/actions also by P1-3 / 05G and the server eligibility/action cutover above.

### 3.3 Driver Active Navigation — `/driver-navigation` (PLANNED ONLY)

Status: **PLANNED ONLY.** The route MUST remain unregistered in this slice, and stays unregistered until its own slice (09, §13).

CURRENT reality:

- `/driver-navigation` is not registered in `public/src/app.js`; an unknown path renders the `/feed` fallback (`public/src/router.js:225`).
- The driver active ride (`/active-ride?role=driver`, `public/src/screens/active_ride.js`) renders the MapShell placeholder (`:789-793`) and a static navigation card built from `ride.route.currentInstruction` / `currentStreet` (`:969-971`). «Навигатор» and «Карта» only show a notice (`:964`, `:983`, `:997`, `:1223`). This is not navigation.

Purpose: turn-by-turn navigation after an accepted ride.

Legs (PLANNED):

- `pickup` — current vehicle position → pickup.
- `dropoff` — current vehicle position → destination. The first dropoff route usually starts at the pickup because the car is still there, but the pickup is never the fixed origin (§6).

Required future UI (PLANNED): route line, navigation camera, next maneuver, maneuver distance, ETA, remaining distance, traffic, reroute state (the PWA asks the routing authority, §8, for a new route from the current navigation-eligible vehicle fix, §6), recenter / overview, voice control, compact ride card.

No hard Marfino bounds.

Route rules (PLANNED, for slice 09):

- `tripId` is required, but possession of a `tripId` is never authorization. A missing or unknown trip never falls back to a demo ride.
- Before any precise pickup / destination, route geometry, maneuver or trip-derived ETA is returned for driver navigation, the server authenticates the caller, resolves the trip through the authoritative participant-gated Ride seam, resolves the authoritative assigned driver from Ride / Assignment authority, and requires the authenticated user to be that exact assigned driver. A passenger participant, another authenticated driver, an unauthenticated caller, or an ambiguous / unverified Ride ↔ Assignment linkage fails closed. Driver role alone is not sufficient. The future slice-09 client admission check is defense in depth; the server-owned trip-bound Route & Price boundary is the security boundary (§8).
- Slice 09 owns the normal navigation entry path as well as route registration. Accept still lands on `/active-ride?role=driver&tripId=<id>`; slice 09 rewires the existing driver active-ride «Навигатор» / relevant map-navigation action from its current notice-only behavior into `/driver-navigation?tripId=<id>&leg=<derived>`. There is no direct accept → navigation shortcut.
- The client entry hint is derived from the current authoritative `ride.status`: `ACCEPTED` → pickup preview, `DRIVER_EN_ROUTE` → pickup, `DRIVER_APPROACHING_PICKUP` → pickup / arrival mode, `IN_PROGRESS` → dropoff; `WAITING_PASSENGER` has no active guidance and terminal status has no navigation entry. The URL `leg` remains presentation-only. On every initial route and reroute, the slice-08 server independently reloads authoritative Ride state and derives the actual leg + canonical endpoint itself; client `leg`, client destination, cached endpoint and UI state are never routing authority.
- The driver role is never read from the URL.
- Status transitions still go through the Ride authority (`public/src/ride_state.js` locally, the ride-state PATCH on a backend ride). The navigation screen does not own the state machine.
- Each route / reroute begins with a fresh client-local trusted `NavigationOriginFix` (§6), minted only by the direct geolocation acquisition seam on the navigating driver's device. The request adapter consumes that capability and serializes only its plain `GeoPoint` snapshot; the opaque capability never crosses the network. A hydrated `NavigationRouteView.origin` is response data only and MUST NOT be reused as reroute trust proof.
- Leaving navigation returns to the same `/active-ride?role=driver&tripId=<id>`.

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
- The URL `leg` is only a presentation hint. It is never sent as authoritative Route & Price input. For trip-bound guidance, slice 08 resolves the participant-gated Ride, derives the active guidance phase from authoritative `ride.status`, derives the exact canonical endpoint from Ride / Order authority, and returns that server-derived `leg` / endpoint in `NavigationRouteView`. A stale/crafted client leg or destination cannot override them.
- The URL MUST NOT mutate ride status. The planned route accepts no `status=` override, unlike the `/active-ride` simulation override (`active_ride.js:254-297`).
- No new status is introduced: `RIDE_STATUS` and the transitions in `public/src/ride_state.js` are unchanged. Arrival stays the existing `DRIVER_APPROACHING_PICKUP → WAITING_PASSENGER` transition, which stamps `arrivedAt` (`ride_state.js:113`). The waiting timer and the no-show flow stay on `/active-ride`.

## 5. P1 findings and prerequisite fixes

The P1-1/P1-2 descriptions below record the **pre-01B baseline**; the current correction is specified after their acceptance list. P1-3 remains open.

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

Prerequisite: **`BD-MAP-DUAL-EXPERIENCE-01B` — remove demo-route inheritance and preserve canonical order coordinates.** Its implemented runtime scope is:

- A. every real-ride constructor or seed built on `createDemoActiveRide()`, starting with the three seeds above (explicit `?fixture=` builders stay demo by design, §10);
- B. the driver backend-hydration merge, `active_ride.js` `mergeServerRide()`;
- C. the passenger backend-hydration merge, `active_ride_passenger.js` `mergeServerRide()`;
- D. direct entry: a valid backend trip with no local canonical record.

01B acceptance:

- An accepted ride's pickup/destination labels and coordinates equal the order's.
- After a successful authoritative hydration, no route field the server omits is inherited from the demo ride. Unless the server supplies a real value, `route.pickup`, `route.dropoff`, `route.currentInstruction`, `route.currentStreet`, the demo distance/ETA and the demo route labels/tags are absent or null, and the UI hides empty values. Real server-provided labels and ETAs may stay.
- Smoke pins guard the seeds and the direct-entry / no-local-record hydration on both the driver and the passenger screen: after server hydration, neither carries demo Moscow route residue.

### 01B runtime correction

- `createActiveRideSeed()` replaces the demo `route` and `order` blocks before applying real seed data. Accepted canonical orders, plain feed posts, passenger seeds and confirmed handoff fallback entries preserve the supplied pickup/dropoff objects, including coordinates and provenance. Missing points remain missing; zero/unknown duration no longer invents a 28-minute ETA.
- Both active-ride hydration mergers replace the full route/order projection with server data. Omitted/null fields do not inherit demo or previously cached values, including on direct entry without a stored ride. Successful reads also repair these projections on an existing stored ride so a later local status update cannot restore stale route data; stored identity, timestamps and terminal status stay intact.
- Driver route rows/navigation/ETA and passenger route/ETA/completed-distance presentation hide unknown values. Known source labels and estimates remain visible. The driver placeholder map refreshes its labels after hydration; both roles omit missing endpoint labels/markers instead of showing MapShell defaults. Explicit fixture/simulation presentation remains available.
- `scripts/smoke-ride-route-source.mjs` covers all three seed paths, sparse/empty server projections for both roles, source-point equality, storage repair followed by status update, terminal freeze and real-versus-demo presentation. Existing passenger DOM recovery tests also cover hidden empty route/ETA fields.
- This corrects inheritance, not coordinate trust: mock-hash points stay mock-hash. The seven-field client `RouteSnapshot`, Ride State Machine, server routing/fare authority and live Mapbox rollout are unchanged. Slices 02/03/05G/08 and the other release prerequisites remain separate gates.

### P1-3 — the public order feed can expose precise passenger location through multiple carriers

Scope: P1-3 covers **protected precise order-location data**, not only coordinates. Protected carriers include exact pickup / dropoff coordinates; canonical pickup / destination labels (`PickupPoint.label`, `DestinationPoint.label`, §6) when they reveal an exact or practically exact location; point details such as `entrance`; passenger-supplied free text such as `orders.comment`; exact route geometry; exact route distance; exact duration / ETA; and exact route-derived server fare / quote metadata whenever those values alone or combined with coarse geography can disclose, reconstruct or materially narrow the endpoint pair. Removing coordinates alone does not remove location: an exact address can be geocoded again, free text can reveal an entrance/gate/building, and exact route-derived metrics can materially shrink the candidate locations.

CURRENT evidence:

- `GET /api/v1/orders` is a public feed: resolving the viewer is optional, anonymous browsing is allowed, and every request lists the `CREATED` orders (`server/src/services/orders/index.js:35-47`).
- `serializeOrder()` returns the stored `pickup` and `dropoff` JSON unchanged (`pickup: row.pickup ?? null`, `dropoff: row.dropoff ?? null`, `server/src/serialize.js:20-44`). `POST /orders` stores each point as opaque JSONB, including any `coords` or `lat` / `lng` it carries (`server/src/services/orders/index.js:10-33`), and its point schema requires the point `label` (`:21-25`), so the anonymous feed echoes every stored label.
- The same public serializer also returns exact route-derived order fields such as `distanceKm`, `durationMin` and fare/estimate fields (`server/src/serialize.js:32-35`). Once slice 08 makes those values real, exposing them beside coarse endpoint areas can materially narrow the passenger's route and therefore they are protected carriers rather than generic "non-location metadata".
- A label can itself be an exact address: the route picker offers street-and-house-number labels such as «Внуковское ш., 24» and «ул. Малая Бронная, 28» (`public/src/screens/route_picker.js:53`, `:69`), and a manual entry keeps whatever text the passenger typed (`:471`; placeholder «ул. Тверская, 12», `:745`).
- Passenger free text is a separate public carrier today: the order UI explicitly suggests location-bearing comment text such as «подъезд №3» (`public/src/screens/order_map_draft.js`); `POST /orders` accepts and persists `comment` (`server/src/services/orders/index.js:52-72`), and `serializeOrder()` returns `row.comment` on the anonymous feed (`server/src/serialize.js:20-44`).
- By contrast, the ride read is participant-gated: `serializeRide()` returns the ride's pickup / dropoff labels (`route.pickupLabel` / `dropoffLabel`, `server/src/serialize.js:90-132`) only to ride participants (`server/src/services/ride-state/index.js:83`).
- Client role/readiness checks gate UI only, never the HTTP API.

Today the shipped client writes no trusted precise coordinate - its stored coordinates are `mock_hash` or `unknown` (§7) - so the feed does not yet publish real passenger positions as coordinates from product flow. Labels and comments differ: with the backend seam on, the feed already echoes exact address labels and passenger free text verbatim. Closing all of those public carriers is part of slice 05G (§13).

P1-3 blocks:

- server persistence or publication through anonymous discovery of protected precise order-location data - trusted precise pickup / dropoff coordinates, exact canonical labels / point details, passenger free-text comment, exact route geometry, exact distance, exact duration/ETA, or exact route-derived fare/quote when those values can materially narrow the trip;
- backend-driven exact order markers on Driver Free Drive (slice 07), including any exact canonical label or location-bearing free text shown with them.

It does not block local passenger acquisition of trusted points, exact labels or free text, as long as the unsafe public projection does not expose them.

Prerequisite: slice **05G — Order Geo Privacy / protected opportunity projection** (§13). Anonymous/public `/orders` MUST omit passenger free-text `comment` entirely rather than attempting keyword or heuristic redaction. If a later product needs public structured tags, they are separately generated, privacy-reviewed non-location metadata. Exact passenger free text may be returned only through an authenticated, server-authorized projection to an actor allowed to receive it. Exact endpoint shape remains unfrozen.

## 6. Shared geo authority — conceptual contracts

State: conceptual only. No runtime module, wire format or DB schema is defined here; slice 02 turns these shapes into a runtime seam.

Coordinates are WGS84 decimal degrees with named `lng` / `lat` fields. A positional `[lng, lat]` array is a Mapbox-boundary adapter detail, never a contract shape.

Validity (frozen): a `GeoPoint` is valid if and only if `lng` and `lat` are both finite numbers and `-180 <= lng <= 180` and `-90 <= lat <= 90`. The shared geo seam MUST reject an invalid point before it reaches a Mapbox Marker, a GeoJSON source, `fitBounds`, a route request or a presence / public overlay. It never clamps, wraps or silently normalizes a value: `lat = 100` or `lng = 500` is invalid, not corrected. The vendored Mapbox GL `LngLat` throws on a latitude outside [-90, 90] and does not range-check longitude (`public/vendor/mapbox-gl/mapbox-gl.js`), so an unvalidated latitude can abort an overlay render and an out-of-range longitude is not rejected by the SDK at all. CURRENT: no end-to-end guard exists (see the carriers table below); slice 02 MUST create the single bounded validator that every map, route and presence consumer goes through.

```text
GeoPoint {
  lng,                     // finite, -180 <= lng <= 180
  lat,                     // finite, -90 <= lat <= 90
  accuracyMeters?,         // REQUIRED for active-guidance request origin
  capturedAt?,             // REQUIRED when provenance = device_fix
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

NearbyVehicleMarker {
  markerId,
  point: GeoPoint
}

RideTrackingBinding {
  tripId,
  assignedDriverId,
  trackingVehicleId
}

NavigationOriginFix {
  point: GeoPoint          // CLIENT-LOCAL opaque trusted direct-acquisition capability; request-side only
}

WaypointRouteRequest {
  origin: GeoPoint,        // canonical passenger pickup
  destination: GeoPoint,   // canonical passenger destination
  requestId               // REQUIRED waypoint-preview race/correlation id; never auth or waypoint authority
}

NavigationRouteRequest {
  tripId,
  origin: GeoPoint,        // plain serialized snapshot consumed from a fresh NavigationOriginFix by the trusted request adapter
                           // client does NOT author authoritative leg or destination
  requestId               // active-guidance race/correlation id; NOT auth or Ride authority
}

RouteGeometryPoint {
  lng,
  lat
}

ProviderRouteGeometry {
  points: RouteGeometryPoint[]
}

NavigationRouteView {
  mode: "waypoint" | "active_guidance",
  leg?,                    // absent for waypoint; REQUIRED and server-derived for active_guidance
  requestId,               // REQUIRED/echoed for both waypoint and active_guidance correlation; never auth
  guidanceRevision?,       // REQUIRED for active_guidance; opaque server authority snapshot token
  origin: GeoPoint,        // waypoint: validated request origin; active_guidance: point actually used by server
  destination: GeoPoint,   // waypoint: validated request destination; active_guidance: server-derived canonical endpoint
  geometry: ProviderRouteGeometry,
  distanceMeters,
  durationSeconds,
  trafficDurationSeconds?,
  steps?,
  updatedAt
}

RoutePriceQuote {
  quoteId,                 // server-owned opaque quote identity; exact format/storage not frozen
  origin: GeoPoint,
  destination: GeoPoint,
  distanceMeters,
  durationSeconds,
  fareEstimate,
  createdAt,
  expiresAt              // REQUIRED for any quote that may later be referenced by order creation
}
```

Referenced quote freshness (frozen): a `RoutePriceQuote` that may later be referenced by order creation is never timeless. It MUST carry valid server timestamps `createdAt` and `expiresAt`, with `expiresAt > createdAt` and a finite server-defined lifetime. Slice 08 runtime owns the exact TTL; 01A deliberately freezes no numeric duration.

Before consuming a quote reference at order mutation, the server validates at least: quote existence, authenticated-passenger ownership, canonical waypoint/context match, valid `createdAt`, valid `expiresAt`, current time not past `expiresAt`, no explicit invalidation, and continued verifiability under the current Route & Price authority. Missing/invalid `expiresAt` never means unlimited validity. An expired, missing-expiry, invalidated or otherwise stale/unverifiable quote is either replaced by a fresh server recomputation/re-quote or rejected so the client obtains a new quote; the exact HTTP behavior is runtime scope. Waypoint equality alone never revives a quote after tariff, time-dependent pricing or other authoritative pricing context has made it stale. Runtime may combine TTL with pricing/tariff versioning or explicit invalidation, but finite freshness is mandatory.

`NavigationRouteView.mode` is the response discriminator. In `mode = "waypoint"`, the response is pre-order-capable: no Ride, `tripId` or `ride.status` is required, `leg` and `guidanceRevision` MUST be absent, `requestId` is REQUIRED/echoed for preview race control, and `origin` / `destination` are the validated canonical passenger waypoints from the authorized request. The response carries route geometry/metrics only and does not acquire Driver Active Navigation semantics merely because provider steps exist.

In `mode = "active_guidance"`, the request is trip-bound, `leg` is REQUIRED and server-derived from authoritative `ride.status`, and `destination` is the server-derived canonical pickup/dropoff endpoint from Ride / Order authority. A waypoint response can never be promoted to authorized active guidance, and returned `leg` / `destination` remain response data rather than reroute authority.

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
- Routing / reroute: an expired `device_fix` can never be `NavigationRouteView.origin`, and neither can a fix that is fresh but not navigation-eligible (navigation origin below).
- Driver active guidance: without a navigation-eligible fix, the UI shows an honest waiting-for-accurate-location / retrying-GPS / location-unavailable state and never routes from a last-known stale or inaccurate coordinate.

No consumer substitutes `VehiclePosition.updatedAt`, a backend receipt time, the render time or a previous route origin for `capturedAt`.

Adopted waypoints: a fix adopted as a canonical ride waypoint — for example the passenger's current position chosen as the pickup (§3.1) — passes the freshness check when it is adopted. It is then a waypoint owned by the Ride / Order authority (§8), not anyone's current position, so it does not expire the way a live position does; a stale fix can never be adopted.

Vehicle position (frozen): a production `VehiclePosition.point` MUST have `provenance = device_fix` and satisfy the bounded `GeoPoint` rule, carry a valid `capturedAt` and be inside the consumer's freshness budget — never expired. `user_pin`, `geocode_point`, `provider_routable_point`, `unknown`, `mock_hash` and `simulation` are never a current vehicle position. Only an explicit fixture / demo mode (§10) may use `simulation`, and such a `VehiclePosition` is not production Presence. Presence may reduce the precision of, or quantize, a fresh device fix for privacy or proximity (BD-DOCS-033 scopes presence location as coarse); the result keeps `provenance = device_fix` and its original `capturedAt` as long as it is derived from a fresh device measurement. A heartbeat receipt or `updatedAt` never makes an old point fresh, and server rounding or coarsening never turns the position into `geocode_point`, `user_pin` or `provider_routable_point`. Consumers: raw production `VehiclePosition` remains Presence authority data. Slice 06P nearby discovery exposes only privacy-scoped `NearbyVehicleMarker`s derived from it; assigned-driver tracking may consume the exact fresh production `VehiclePosition` only behind its participant-gated ride-bound linkage. Slice 07 uses a fresh `device_fix` for the driver's own vehicle. For active guidance, slice 09 obtains a fresh client-local `NavigationOriginFix`; the trusted request adapter consumes it and sends slice 08 an ordinary serialized `GeoPoint` snapshot inside `NavigationRouteRequest`. Passenger waypoint routing uses `WaypointRouteRequest` and never requires `NavigationOriginFix`.

Route origin (frozen): the opaque `NavigationOriginFix` is request-side / client-local only. It exists between direct driver-device geolocation and the navigation request adapter; it is never persisted, sent as a trusted type, returned by the server, hydrated from JSON or reconstructed from a route response.

For active guidance, the trusted client request adapter accepts a fresh `NavigationOriginFix`, checks the direct-acquisition capability, then serializes only `{ tripId, origin: GeoPoint, requestId }`. The REQUIRED `requestId` is generated by the current navigation session for race/correlation only; it is not authentication, authorization or Ride authority. The client still does not author an authoritative leg or destination. The server receives the plain origin, authenticates the caller, resolves participant-gated Ride / Assignment authority, derives the active leg from `ride.status`, derives the exact canonical endpoint from Ride / Order authority, and validates bounded coordinates, `provenance = device_fix`, valid `capturedAt`, freshness, finite `accuracyMeters`, the shared accuracy maximum, and exact assigned-driver authorization. The opaque acquisition capability is an official-client acquisition invariant, not a server authentication credential, and the server never claims to recreate it from JSON.

`NavigationRouteView.origin` is also a plain serializable `GeoPoint`: the point the server actually used for the returned route. A hydrated response origin is presentation / audit data only. It MUST NOT mint or restore `NavigationOriginFix` and MUST NOT be fed back as trusted reroute input. Every reroute requires a current/new client-local `NavigationOriginFix`.

For passenger route preview, `WaypointRouteRequest` carries canonical pickup → destination as ordinary trusted waypoint `GeoPoint` values. It never requires `NavigationOriginFix`.

Navigation origin (frozen): fresh is not the same as accurate, and `provenance = device_fix` is not proof of direct acquisition. Slice 09 may mint `NavigationOriginFix` only from the direct Geolocation / device-sensor result on the navigating driver's own device.

Trusted acquisition boundary:

- only the direct navigation geolocation seam may mint a `NavigationOriginFix`;
- Presence `VehiclePosition`, network JSON, server cache payloads, local/storage hydration, a previous/returned route origin, geocoded points and user pins cannot mint one;
- copying `lng`, `lat`, `provenance`, `capturedAt` and `accuracyMeters` cannot restore the trusted capability;
- a client-supplied JSON flag such as `source = "direct"`, `direct = true` or `kind = "device"` is not proof;
- the capability ends at the request adapter. The serialized `NavigationRouteRequest.origin` and returned `NavigationRouteView.origin` are ordinary `GeoPoint` values.

```text
navigationEligible(localOrigin) =
  isNavigationOriginFix(localOrigin)
  AND valid bounded localOrigin.point
  AND localOrigin.point.provenance == device_fix
  AND valid localOrigin.point.capturedAt
  AND fresh
  AND finite localOrigin.point.accuracyMeters
  AND localOrigin.point.accuracyMeters >= 0
  AND localOrigin.point.accuracyMeters <= navigationOriginMaxAccuracyMeters
```

`isNavigationOriginFix()` validates the client-local trusted acquisition type/path, not a user-controlled payload field. Slice 08 freezes one finite positive numeric `navigationOriginMaxAccuracyMeters`; slice 09 reuses it. Until the value exists, active guidance fails closed.

The server independently validates the serialized origin's machine-visible coordinate/freshness/accuracy fields and the caller's authorization, but it does not pretend network JSON can prove direct-device acquisition. Presence remains an invalid acquisition source for the official navigation client, and every reroute re-enters through a fresh `NavigationOriginFix`.

Routing modes and Route & Price ownership (frozen): slice 08 owns two distinct server routing request modes behind the Route & Price authority.

**Protected provider-backed geo acquisition.** Slice 08 also owns production geocoding/search/autocomplete and provider-routable-point acquisition when an external paid geo provider is used. This is separate from route computation authority. The production order is: verified authenticated session → finite positive server-side provider budget scoped at least to the authenticated principal → input validation → provider call → trusted `geocode_point` / `provider_routable_point` result → canonical passenger point state. Provider autocomplete/search/geocode/routable-point calls all pass the protected budget. The exact positive limit/window is frozen by slice 08 runtime before provider traffic is enabled; IP/service-wide/provider quotas may supplement but never replace the principal budget. Guest may keep the base map and provider-free manual pin/current-location path, but cannot invoke paid production geocoding and never falls back to a direct-browser provider or demo/mock coordinate presented as geocoded truth.
**A. Passenger waypoint route.** `WaypointRouteRequest` computes canonical passenger pickup → canonical destination. Production provider-backed waypoint routing requires a **verified authenticated session**. Guest / anonymous callers may use the base map UI but MUST NOT invoke production Route & Price provider work and receive no production waypoint route, ETA or server fare estimate; the UI shows an honest sign-in-required / routing-unavailable state with no direct-browser provider fallback and no demo route presented as real.

Before any paid provider call, slice 08 MUST enforce a server-side finite abuse / cost budget scoped at least to the authenticated principal. The production limit/window MUST be explicit, finite and positive before provider-backed traffic is enabled; its numeric value is deliberately not frozen in 01A. IP/service-wide controls may exist as defense in depth, but never replace the principal-scoped server gate. Over-budget requests perform **no provider call** and return honest retry/unavailable behavior. Authentication failure, budget failure and waypoint validation failure all fail before provider invocation.

Conceptual order:

```text
verified authentication
→ finite server abuse / cost budget
→ validate canonical waypoint eligibility
→ paid routing provider
→ server fare estimate
```

Both waypoint points are ordinary bounded `GeoPoint` values owned by the passenger's canonical route state / Ride-Order authority and must pass the generic trusted-waypoint allowlist. An adopted pickup may originate from a fresh `device_fix`; pickup/destination may otherwise use `user_pin`, `geocode_point` or `provider_routable_point`. `mock_hash`, `simulation`, `unknown` or missing provenance are rejected. This mode does NOT require `NavigationOriginFix`.

Waypoint preview race control (frozen): each `WaypointRouteRequest` carries REQUIRED `requestId`, generated by the current mounted route-picker/preview session and echoed by the server. It is correlation metadata only, never authentication or canonical-waypoint authority. Canonical pickup or destination change invalidates the previous preview generation. The client applies a waypoint response only when its `requestId` matches the latest outstanding preview, the mounted route-picker/preview session is still current, the response `origin` exactly equals the current canonical eligible pickup, and `destination` exactly equals the current canonical eligible destination.

Any older/out-of-order or waypoint-mismatched response is ignored and MUST NOT replace geometry, distance, duration/ETA, traffic duration, fare estimate, `RoutePriceQuote` or preview state for a newer point pair. When points change, the prior result is cleared or presented as recalculating/unavailable rather than silently shown under the new waypoints; exact UX is runtime scope. Waypoint mode has no `guidanceRevision` because there is no Ride authority snapshot.

**B. Driver active guidance.** `NavigationRouteRequest` contains `tripId`, the current serialized origin snapshot consumed from a fresh client-local `NavigationOriginFix`, and REQUIRED `requestId` race/correlation metadata. It does **not** accept an authoritative client `leg` or `destination`; `requestId` never becomes authorization or Ride authority.

Before provider work, the server:

1. authenticates the caller;
2. resolves the participant-gated authoritative Ride / Assignment;
3. requires caller == exact authoritative assigned driver;
4. reads authoritative `ride.status`;
5. derives the guidance phase and canonical endpoint from Ride / Order authority:
   - `ACCEPTED` → pickup preview / canonical pickup;
   - `DRIVER_EN_ROUTE` → pickup guidance / canonical pickup;
   - `DRIVER_APPROACHING_PICKUP` → pickup arrival mode / canonical pickup;
   - `IN_PROGRESS` → dropoff guidance / canonical destination;
   - `WAITING_PASSENGER`, all pre-accept statuses, `COMPLETED`, `CANCELED`, `NO_SHOW` → no active guidance;
6. enforces a finite positive server-side active-guidance cost/rate budget, scoped at least to the authenticated principal and the active trip/guidance context;
7. validates the serialized origin's bounded/fresh/accuracy fields;
8. calls the routing provider;
9. **after the provider returns and before releasing guidance**, re-resolves authoritative Ride / Assignment and rechecks that the caller is still the exact assigned driver, the ride still exists, current status still permits active guidance, the derived leg still matches the computation, the canonical endpoint is unchanged, and assignment/linkage is still valid;
10. only if that post-provider recheck succeeds does the server return the result with an opaque `guidanceRevision` representing the authoritative Ride/Assignment snapshot accepted by that recheck, and it echoes the active request `requestId`.

If the ride is missing/unauthorized, assignment or Ride/Order linkage is ambiguous, the status has no active guidance, the required canonical endpoint is unavailable, or the post-provider recheck no longer matches the computation, the result fails closed. A provider response that became stale while in flight is discarded: **no stale geometry, maneuver or ETA is released as current guidance**. Exact HTTP/status shape is not frozen.

Active-guidance race control is separate from authorization. Slice 09 assigns each mounted navigation request/reroute a current client-local `requestId` / generation (exact counter/UUID mechanism not frozen) and invalidates the prior generation when a newer request starts, when authoritative ride status changes the guidance leg, when status removes guidance, or when the navigation screen is left. The server echoes the active `requestId`; it does not trust it for identity or Ride authority.

The client applies an active-guidance response only when it belongs to the current trip/mounted navigation session, its echoed `requestId` matches the latest outstanding generation, current client Ride/status admission still allows guidance, and the response carries a valid server `guidanceRevision`. A late response from an older generation is ignored and cannot replace a newer reroute, restore a pickup route after a dropoff transition, re-add geometry after terminal/no-guidance, or affect a detached navigation screen. Terminal/no-guidance transition invalidates outstanding request generation and clears active route geometry immediately. The client latest-request guard is defense in depth; it never replaces the server post-provider authoritative recheck.

The active-guidance budget applies to the initial route and to **every reroute**. A fresh, otherwise valid `NavigationOriginFix` never grants unlimited paid-provider use. Repeated valid fixes may be throttled/rejected once the server budget is exhausted. The exact positive limit/window is owned by slice 08 runtime and is not invented in 01A. IP/service-wide controls, provider quotas, caching, debounce or request coalescing may supplement the principal + trip-aware budget but never replace it. Over-budget guidance performs no provider call and the UI receives an honest throttled/retrying/unavailable state; a stale route is never silently labelled as a new reroute.

 For `NavigationRouteView { mode: "active_guidance" }`, `.leg` and `.destination` are server-derived response/presentation data. Every reroute repeats this full authoritative derivation; a returned destination or URL `leg` is never reused as authority.

CURRENT: existing server `RouteComputation` is a fixed 3-stop / 2-leg normalizer — driver → pickup → destination — and rejects a raw one-leg active-guidance result with `unexpected_leg_count`. It remains a useful baseline but is not sufficient for the two request modes above.

PLANNED slice 08 acceptance:

- waypoint mode requires a verified authenticated session plus a finite server abuse/cost budget before paid provider work;
- active-guidance mode requires its own finite server cost/rate budget before paid provider work, scoped at least to authenticated principal + active trip/guidance context; every reroute passes the same budget gate;
- Guest / anonymous callers receive no production waypoint route, ETA or server fare estimate and cannot trigger a paid provider call;
- over-budget, unauthenticated, unauthorized, invalid-waypoint or invalid active-guidance requests perform no provider call;
- waypoint mode supports canonical pickup → destination and returns `NavigationRouteView { mode: "waypoint" }` with geometry, distance, duration / ETA and optional traffic duration, no Ride/status requirement and no `leg`;
- active-guidance mode returns `NavigationRouteView { mode: "active_guidance" }` with REQUIRED server-derived `leg` and server-derived canonical endpoint;
- active-guidance request/response correlation carries `requestId` as race-control metadata only, never authentication; active responses also carry REQUIRED opaque `guidanceRevision`;
- after every paid active-guidance provider call, the server re-resolves Ride/Assignment and discards the result if assignment/status/derived leg/canonical endpoint no longer matches;
- the mounted client applies only the latest active request generation; late/out-of-order responses are ignored;
- an authoritative leg/status change invalidates the prior generation; terminal/no-guidance both invalidates outstanding guidance and clears active route geometry, so stale responses cannot resurrect it;
- active-guidance requests contain no authoritative client leg/destination; the server derives both from participant-gated Ride / Order authority on every route/reroute;
- active-guidance mode supports current vehicle → canonical pickup or current vehicle → canonical destination only when current `ride.status` allows it;
- `WAITING_PASSENGER`, pre-accept and terminal states produce no active route/provider call;
- a one-leg active-guidance result is not rejected with `unexpected_leg_count`;
- a dropoff reroute never routes back through historical pickup;
- `mock_hash`, `simulation`, `unknown` and missing-provenance waypoints never become production passenger route endpoints;
- active-guidance serialized origin fails closed on missing/invalid `capturedAt`, stale fix, missing/non-finite/excessive `accuracyMeters`, or failed exact-assigned-driver authorization;
- slice 08 freezes the single finite positive numeric `navigationOriginMaxAccuracyMeters`;
- `NavigationRouteView.origin` is a plain `GeoPoint`; returned leg/origin/destination are response data and can never be reused as reroute authority;
- `NavigationRouteView.geometry` is server-owned `ProviderRouteGeometry`; all decoded vertices are finite/bounded WGS84 and malformed/out-of-bounds geometry is rejected;
- provider route vertices need no fabricated per-vertex provenance and MUST NOT be relabelled `provider_routable_point`; arbitrary client-authored geometry is not trusted;
- a successful active reroute supersedes the previous active route geometry, while a terminal/no-guidance state removes the active route line;
- route geometry remains presentation data and never mutates canonical pickup/destination or mints provenance;
- passenger canonical pickup / destination are never mutated by route computation.
- production `RoutePriceQuote` (or equivalent server-owned quote/recompute proof) is bound to the authenticated passenger and canonical waypoint/context; exact endpoint/table/ID format is runtime scope;
- matching selection/Ride bootstrap is part of the financial-authority cutover: driver `offer.price` stays a bid/intent and is never directly promoted into authoritative payable fare; any negotiated final amount is server-validated/derived under Route & Price policy before it becomes a Ride/receipt financial fact;
- completion fare/receipt authority MUST NOT trust legacy `ridePrice` merely because passenger selection seeded it from a driver-authored bid;
- production order creation does not trust client `distanceKm`, `durationMin`, `estimatedPrice` or `estimatedPriceLabel` as authority: persisted route/fare values come from a validated server quote or fresh server recomputation;
- a quote id never authorizes an arbitrary client amount override; every referenceable quote has a finite server freshness bound, and expired/missing-or-invalid-expiry/wrong-actor/wrong-waypoint/invalidated/unverifiable quote state fails closed or is freshly recomputed/re-quoted server-side;
- passenger manual adjustment is a distinct bid/offer intent, never overloaded as the authoritative server fare estimate;
- completion `fare`, `commission` and `net` are derived from authoritative server ride/order/payment/tariff facts before receipt creation; the driver does not author financial totals;
- `tip` may affect production receipt/net only when it comes from its own server-authorized tip/payment fact, never because the driver submitted a number;
- receipt write-once happens **after** authoritative financial derivation; immutability never substitutes for validation;
- once production Route & Price is active, no financial fallback to the mock/client formula is allowed at order or completion persistence boundaries.

**Route & Price cutover owned by slice 08.** Production `route_service` and `price_estimator` move behind the server Route & Price authority and the production `route_picker` call site stops using its local hash / `80 + 35·km` formula as route/fare truth. The server returns the authoritative route estimate and fare estimate; the passenger renders that estimate, while any manual passenger adjustment is an explicit bid/offer value rather than authoritative fare.

The authority must survive the next write. Slice 08 therefore also owns the production order/financial persistence cutover: a server-owned `RoutePriceQuote` (or equivalent server recomputation) binds the authenticated passenger + canonical waypoint context to authoritative distance/duration/fare. Order creation may reference/recover/recompute that server fact, but client numeric estimate fields cannot replace it. Completion/receipt creation likewise derives fare/commission/net from server-authoritative ride/order/payment/tariff facts; driver-supplied totals are never trusted, and a tip affects money only from a separate server-authorized tip/payment fact. The receipt may remain write-once, but only after authoritative derivation.

Authentication + server cost/rate-budget gating apply before any paid provider call in both waypoint Route & Price and active-guidance routing; every reroute is budget-gated. Slice 08 does not invent quote storage/schema, tariff coefficients, commission percentage, rate-limit numbers, surge/zones/minimums, tip workflow or payment provider; those are runtime/follow-up decisions under this contract and BD-DOCS-035.

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
| `NavigationOriginFix` | None | — | Client-local opaque direct-acquisition capability; request-side only, never serialized/persisted/hydrated |
| `WaypointRouteRequest` / `NavigationRouteRequest` | None | — | Two serialized request shapes owned by slice 08; waypoint mode uses canonical GeoPoints, active-guidance mode receives a plain origin snapshot consumed from a fresh local `NavigationOriginFix` |
| `NavigationRouteView` | None | Server `RouteComputation` only as a reference baseline; current runtime has no caller and cannot cover both planned request modes | One fully serializable response with explicit `mode`: waypoint has no `leg`; active_guidance requires server-derived `leg` and canonical endpoint |

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

Live semantic-point eligibility (frozen): a semantic map position — for example a pickup/destination endpoint, vehicle marker, order/opportunity point or navigation origin — may be drawn on the live Mapbox surface only if ALL of these hold. This rule applies to provenance-bearing semantic `GeoPoint`s, not independently to the vertices inside `ProviderRouteGeometry`:

1. it is a valid bounded `GeoPoint` (§6);
2. its provenance is one of the trusted real-origin values `device_fix`, `user_pin`, `geocode_point` or `provider_routable_point`;
3. for a `device_fix` only: it carries a valid `capturedAt` and is not expired under the consumer's freshness budget (§6 device-fix freshness) — checked at use for a live position, or at adoption for a canonical waypoint (§6 adopted waypoints).

Trusted provenance alone is not enough for a `device_fix`: without a valid `capturedAt`, or outside the consumer's freshness budget, it is not live-eligible. The sensor freshness rule does not apply automatically to `user_pin`, `geocode_point` and `provider_routable_point`, because they are not moving sensor fixes. `mock_hash`, `simulation`, `unknown` and a missing provenance are never eligible for a live position. Eligibility is a positive allowlist, never the rule `provenance != mock_hash`. A legacy coordinate without recorded provenance is `unknown` and is not drawn live; it becomes eligible only through a path that records real provenance — a re-geocode, a new user pin, a fresh device fix where that is semantically valid (for example the passenger's own current pickup), or an explicit migration that records real provenance. Until then the point may remain text / list data, never a live map position. Mock or simulation data appears on a map only inside an explicit demo / fixture mode (§10), never as a live position. Slice 02 provides one shared trusted-live eligibility helper / seam that checks the bounds, the provenance eligibility, the conditional `device_fix` `capturedAt` requirement, device-fix freshness against an explicit caller / consumer budget and the stricter vehicle-position rule (§6), so slices 05, 06, 06P and 07 never invent their own filters and routing (slices 08 and 09) applies the same rule, plus the stricter navigation-origin rule (§6), to route origins.

Provider route geometry eligibility (frozen) is a separate positive rule from `GeoPoint` provenance. `ProviderRouteGeometry` is server Route & Price response data produced/normalized only from a successful authorized, budget-gated provider route computation and associated with its current `NavigationRouteView`. Every decoded/rendered `RouteGeometryPoint` must have finite bounded WGS84 `lng`/`lat`; malformed/out-of-bounds geometry fails closed.

Polyline/route-shape vertices are not semantic waypoints and carry no independent `GeoPoint.provenance`. They MUST NOT be relabelled `provider_routable_point` merely because they came from a routing provider, and this contract adds no `route_geometry` provenance value. An arbitrary client-created array/encoded polyline does not become trusted geometry by matching the shape. A live route line is render-eligible only when it is the geometry of the current trusted server Route & Price response and passes provider/server geometry validation.

Geometry lifetime is response-scoped: waypoint-preview geometry belongs to that preview response; each active-guidance reroute supersedes the previous active route geometry; when authoritative state has no active guidance, including terminal/no-guidance transitions, the active route line is removed rather than silently reused. Returned geometry is presentation data only: it never mutates canonical pickup/destination, never mints point provenance, never becomes a `NavigationOriginFix`, and never becomes reroute authority.

Generic point eligibility and vehicle-position eligibility are not the same (frozen). Waypoints — a pickup, a destination, an order opportunity — may be `user_pin`, `geocode_point` or `provider_routable_point`. A moving vehicle's current position is a fresh `device_fix` only (§6 vehicle position): passing the generic allowlist above is never enough for it, and a `user_pin`, `geocode_point` or `provider_routable_point` is never a vehicle's current location.

PLANNED: slice 02 freezes the runtime field with this single origin-based vocabulary — the server `COORDINATE_PROVENANCE` values plus `mock_hash`, `simulation` and `unknown` — so the client and the server never map between two competing sets. `mock_hash` and `simulation` have no server equivalent and are never sent as real coordinates.

## 8. Authority

| Authority | Owns | CURRENT holder | PLANNED holder |
| --- | --- | --- | --- |
| Ride / Order | Pickup, destination, selected driver, trip id, ride status | Conditional on the backend seam (see below): the local stores while it is off; the server for the flows already cut over while it is on. | The server ride/order authority end-to-end (BD-DOCS-030, BD-DOCS-034) |
| Location | Driver and passenger current position, vehicle heading/speed, freshness timestamps | Nobody: no geolocation; Presence is dark | Device capture through the `geolocation_service` seam; server Presence #2 for the shared driver position (heartbeat + TTL, coarse location — BD-DOCS-033) |
| Routing | Geometry, distance, ETA, traffic estimate, maneuvers | Client label-hash estimates; server `RouteComputation` has no caller and `route-price` is dark | **Slice 08 Server Route & Price authority**: both paid modes are server-budget-gated; waypoint responses use `mode=waypoint`, active guidance uses `mode=active_guidance` with server-derived leg/endpoint |
| Pricing | The fare | Client formula `80 + 35·km` with passenger override (mock); CURRENT server order create still accepts client estimate fields, and CURRENT receipt write accepts client financial totals verbatim | **Slice 08 Server Route & Price authority** (BD-DOCS-035): server quote/recompute owns order distance/ETA/fare persistence, passenger adjustment is a distinct bid, and completion fare/commission/net derive server-side before immutable receipt creation |

Ride / Order CURRENT holder, by backend seam state (`isBackendEnabled()`, `public/src/api_config.js:47-50`, off unless an API base is configured):

- Seam OFF (the default): the local stores are the authority — `bazardrive.ride_orders.v1`, and `bazardrive.active_ride.v1` through `ride_state.js`.
- Seam ON, flows already wired to the server: the server response / state is authoritative, and local browser state is a projection, cache or UI state — never a second independent authority. These flows are passenger order publish and the order feed (`createRideOrder()` → `POST /orders`, `listNearbyOrders()` → `GET /orders`; driver test orders stay local, `mock_api.js:556-560`), matching — driver offers, the offers board and passenger select (`submitOfferToBackend()` → `POST /matching/offers`, `listOrderOffers()` → `GET /matching/offers`, `selectOfferOnBackend()` → `POST /matching/select`) — and the active-ride read, status write and realtime poll (`getRideFromBackend()`, `patchRideStatus()`, `pollRide()` in `public/src/mock_api.js`). Both active-ride screens load the server ride and send status transitions through `patchRideStatus()` when the seam is on (`active_ride.js:482`, `638-659`, `1334`; `active_ride_passenger.js:2140`, `2469`, `3518`).
- Seam ON, flows not yet cut over: they stay local. For example, the `/driver-map` accept of a server order is not wired and shows a notice instead (`driver_map.js:746-750`), and `acceptNearbyOrder()` only flips local status. This contract does not claim a full backend cutover; BD-DOCS-042's per-route matrix remains the source of truth for which server routes are live or pilot-blocked.

CURRENT financial mutation gap: authentication alone does not make stored amounts authoritative. `POST /orders` currently persists request-body `distanceKm`, `durationMin`, `estimatedPrice` and `estimatedPriceLabel` (`server/src/services/orders/index.js:90-101`). `POST /matching/offers` also accepts driver-authored `price`, and passenger selection / `buildRideSeed()` currently copies that accepted bid into both `orderOfferPrice` and `ridePrice` (`server/src/services/matching/index.js:28-60`), so CURRENT matching can promote client-authored offer money into ride financial fields. The completed-ride receipt write currently accepts driver-supplied `fare`, `commission`, `tip` and `net` and stores them verbatim before making the receipt write-once (`server/src/services/history/index.js:68-77`). Slice 08 must migrate all three boundaries—order creation, matching selection/Ride bootstrap, and receipt derivation—as part of the production Route & Price cutover; write-once or passenger selection protects neither correctness nor financial authority.

Rules:

- Frontend Directions output MUST NOT become the authoritative fare calculation.
- A driver-authored `offer.price` is a **driver bid / offer intent**, never by itself an authoritative payable fare, tariff, completion fare or receipt fact. Passenger selection selects the driver and that bid intent; it does not promote the client-authored bid into financial truth.
- Slice 08's financial cutover includes matching selection + Ride bootstrap. Production may preserve the selected bid in a distinct conceptual field such as `selectedDriverBid` (exact schema/name not frozen), but MUST NOT directly copy unvalidated `offer.price` into authoritative payable fare. If negotiated pricing is supported, the server Route & Price authority explicitly resolves the selected bid against authoritative quote/tariff/negotiation policy; exact formula is not frozen.
- Completion fare/receipt derivation MUST NOT treat a legacy `ridePrice` as authoritative merely because it was seeded from a selected driver bid.
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
| 01B | Remove demo-route inheritance (seeds, both backend-hydration merges, direct entry); preserve canonical pickup/dropoff (§5) | 01A | IMPLEMENTED — source-only seeds/hydration; prerequisite for 07 and 09 |
| 02 | Shared `GeoPoint` + origin-based provenance + bounded WGS84 validator + trusted-live eligibility helper, including the conditional `device_fix` `capturedAt` requirement and device-fix freshness against an explicit caller budget (runtime seam; §§6–7) | 01A | PLANNED |
| 03 | Shared `map_surface` lifecycle + Mapbox error fallback, including one screen-owned live-map handle and idempotent disposal/reuse for both router exits and in-place screen remount/replacement | 01A | PLANNED |
| 04 | Real passenger geolocation; every captured `device_fix` records its sensor capture timestamp in `capturedAt` (§6) | 02, 03 | PLANNED |
| 05 | Provider-free passenger trusted point acquisition + canonical pickup/dropoff state: allowed fresh device-position adoption, user pin and manual/local text state only; no paid geocoding/search/autocomplete/provider-routable call; no live Mapbox marker rendering and no protected location/free-text publication before 05G (§3.1) | 02, 03, 04 | PLANNED |
| 05G | Order Geo Privacy / protected opportunity projection: public `/orders` exposes neither precise coordinates / exact canonical labels / point details nor passenger free-text `comment`; exact location data and exact free text only through server-authorized projections (§5 P1-3; details below) | 02; the server order seam (backend track) | PLANNED — prerequisite for publishing trusted precise points / labels / comments and for 07's backend order markers |
| 06 | Real Mapbox marker adapter and live pickup/destination marker rendering from slice 05's already-acquired canonical trusted points | 02, 03, 05 | PLANNED |
| 06P | Passenger Presence / Tracking integration: authenticated privacy-scoped `NearbyVehicleMarker`s on `/map`; assigned-driver tracking on passenger `/active-ride` uses immutable RideTrackingBinding/status gating and consumes slice 03 lifecycle for internal map/root remounts | 02, 03, 06; Presence track; nearby privacy projection; RideTrackingBinding backend prerequisite | PLANNED — assigned-driver tracking does NOT require current `OPEN driver_shift` lookup |
| 07 | Driver Free Drive: protected backend opportunity markers/cards only from 05G, plus the driver-side backend matching/offer action cutover and authoritative assignment→ride handoff. Server-owned orders never use local `acceptCanonicalRideOrder()`; offers do not create rides until passenger selection/assignment/ride bootstrap (§3.2) | 01B, 02, 03, 04, 05G, 06; server driver-eligibility/matching boundary | PLANNED — requires merged 01B, 05G and actionable backend matching eligibility |
| 08 | **Server Route & Price authority**: protected provider-backed geo acquisition; authenticated + finite-budget waypoint routing; active guidance with server-derived leg/endpoint and finite reroute budget; mode-discriminated NavigationRouteView; route_service + price_estimator + route-picker cutover; server quote/recompute binding at order persistence; server-derived completion receipt totals; one shared navigationOriginMaxAccuracyMeters (§§3.3, 6, 8) | 02; **05 before passenger waypoint / route-picker product cutover**; backend pilot gates; BD-DOCS-035 follow-ups; **05G before production order persistence/publication of trusted precise route context** | PLANNED — server/provider/quote and active-guidance work may proceed where inputs permit, but passenger waypoint cutover waits on 05 and precise order persistence additionally waits on 05G |
| 09 | Driver Navigation PWA: register `/driver-navigation`; direct client-local `NavigationOriginFix` acquisition; wire existing driver `/active-ride` navigation action into the new route with status-derived leg; fresh fix per reroute; latest-request/generation guard for out-of-order responses; terminal/no-guidance invalidation/geometry clear; exact-assigned-driver UI admission as defense in depth | 01B, 03, 06, 07, 08 | PLANNED — server authorization and post-provider authority recheck remain slice 08 |
| 10 | Native Navigation SDK | 09; a native-shell governance decision; a native ADR defining offline navigation and reroute reconciliation | FUTURE NATIVE — later |

**Slice 03 map-surface lifecycle (PLANNED).** A live Mapbox screen surface owns at most one current map handle, conceptually:

```text
MapSurfaceHandle {
  element,
  dispose()
}
```

The exact JS API/name is not frozen. The ownership invariant is: **at most one live Mapbox GL instance per screen surface ownership slot**. The same idempotent disposal mechanism covers both router-owned route exit and screen-internal remount/replacement. Before an internal DOM replacement removes a live map element or its owning root, the screen clears/detaches the current ownership slot, disposes that handle exactly once, and only then removes/replaces the DOM; only after that may another GL instance be constructed. Reusing/updating the existing map instead of remounting is allowed and preferred when safe.

This specifically covers future 06P integration on passenger `/active-ride`: today's screen can replace `mapEl` in `renderMapForReadState()` and can replace the whole `root` on terminal transition without router navigation. A future live GL map MUST therefore be disposed/reused across those internal read-state/status replacements, and MUST be drained before terminal `root.replaceWith(...)`. A later router exit after an earlier internal teardown sees an empty slot and does not double-dispose; an old handle/disposer cannot dispose a newer replacement map. No old/new WebGL contexts/listeners overlap.
**Slice 07 backend opportunity action (PLANNED).** CURRENT `/driver-map` may list backend `CREATED` orders but cannot accept them: its local `acceptCanonicalRideOrder()` path has no server-owned row to mutate and the backend-only branch shows the existing "next update" notice. Slice 07 closes that interaction gap together with the real Driver Free Drive map.

For a protected backend opportunity:

1. marker/card/list geography comes only from 05G's **pre-assignment coarse/privacy-safe** opportunity projection; "protected" does not mean exact;

2. an actionable production control is rendered only when the authenticated server-side driver eligibility + matching/offer transition is available; otherwise the opportunity is explicitly read-only/unavailable;
3. driver action uses the real server matching/offer seam, never local `acceptCanonicalRideOrder()` as authority;
4. submitting an offer does **not** create an accepted ride and does **not** unlock exact passenger location;
5. the passenger-owner selection remains authoritative: passenger select → server assignment → ride bootstrap;
6. only after authoritative assignment/ride creation may the exact selected driver cross from the coarse opportunity projection into the participant-gated Ride projection needed to perform the trip;
7. rejected/non-selected drivers never receive exact pickup/dropoff coordinates, exact address/POI/entrance detail or raw passenger free text from that opportunity;
8. after authoritative assignment/ride creation, slice 07 owns the driver-side handoff/read needed to discover that assigned `tripId` and enter `/active-ride?role=driver&tripId=<id>`; exact push/poll/read transport is not frozen, but reload/cross-device must resolve from server state;
9. rejection/expiry/failure keeps the opportunity state honest and never seeds a local/demo active ride as fallback.

Slice 09 remains the later active-ride → navigation transition. Slice 07 does not bypass passenger selection or invent a direct server "accept order" operation that the current matching model does not have.

Slice 05G — Order Geo Privacy / protected opportunity projection (PLANNED) closes P1-3 (§5). It freezes three actor/privacy levels:

1. **Public / anonymous discovery:** `/orders` MUST NOT expose precise pickup/dropoff coordinates, exact canonical labels / point details such as `entrance`, passenger-supplied free-text `comment`, exact route geometry, exact distance, exact duration/ETA, or exact route-derived server fare/quote when those values can disclose or materially narrow the trip. Public discovery may expose only deliberately reviewed non-sensitive metadata plus an explicitly coarse/privacy-safe area and coarse presentation label. If route/price summary is product-required, it is a separately derived privacy-reviewed coarse projection such as conceptual `distanceBucket?`, `etaBucket?`, `fareBucket?`; 01A freezes no bucket sizes/ranges. Exact values hidden only by formatting are not coarse, combinations with coarse geography must be privacy-reviewed, and fields MUST NOT permit reconstruction of the exact metrics. Arbitrary passenger free text is omitted entirely; no keyword/heuristic redaction of raw comment is accepted.
2. **Authenticated pre-assignment driver opportunity:** authentication, eligibility and offer submission are still insufficient for exact trip location. The server may expose only a coarse/privacy-safe opportunity projection, conceptually `DriverOpportunityGeoProjection { pickupArea?, destinationArea?, coarsePickupLabel?, coarseDestinationLabel?, markerPoint?, distanceBucket?, etaBucket?, fareBucket? }`. Exact field names and bucket sizes are not frozen. This projection MUST NOT expose or permit client reconstruction of exact pickup/destination `GeoPoint`, street+house/POI/entrance detail, `entrance`, point notes, raw passenger `comment`, exact passenger free text, precise provider-routable detail, exact route geometry, exact distance, exact duration/ETA or exact route-derived fare/quote through marker, card, list row, offer/matching payload, URL/query or client cache. Any coarse metric bucket is separately derived/privacy-reviewed and is never an exact metric merely reformatted.
3. A public/pre-assignment coarse label or marker is a separate projection value. Removing coordinates never makes a canonical exact label, entrance, note or passenger comment safe by itself.
4. Submitting an offer does not change the driver's privacy class. Rejected/non-selected drivers remain pre-assignment actors and never receive the exact Ride projection.
5. **Authoritative assigned ride participant:** only after passenger selection → authoritative Assignment → Ride bootstrap, and only after the caller is verified as the exact assigned participant for that trip, may the assigned-driver live Ride projection expose the exact canonical pickup/destination, exact labels/details and deliberately allowed passenger note/comment needed to perform the ride.
6. **Assigned-driver exact-location status gate:** that live exact projection is available only while authoritative `ride.status` is one of `ACCEPTED`, `DRIVER_EN_ROUTE`, `DRIVER_APPROACHING_PICKUP`, `WAITING_PASSENGER`, or `IN_PROGRESS`. The server checks status before returning exact data. `COMPLETED`, `CANCELED`, `NO_SHOW`, pre-assignment states, missing/ambiguous state or historical participant membership fail closed: no exact pickup/dropoff GeoPoint, entrance, exact address/POI detail, raw passenger comment/note or precise provider-routable detail is returned through the live Ride projection. An old `tripId`, cached opportunity/matching payload or stale Ride projection is never a fallback.
7. Terminal/historical access, if the product later needs retained route/address information, is a separate deliberately minimized history/retention projection and policy; it does not automatically inherit the live Ride exact fields, and 01A freezes no retention duration. This driver-specific rule does not remove the passenger owner's own authorized trip/history access.
8. The passenger owner retains their own exact canonical points through the passenger-authorized path.
9. Future public/pre-assignment tags, if any, must be separately generated/privacy-reviewed structured metadata, never raw passenger `comment`.
10. Endpoint shape is not frozen in 01A.

Until 05G ships, precise trusted points, exact labels/point details and passenger free-text comments stay local to the passenger (slice 05, §3.1) or otherwise out of anonymous discovery, and slice 07 draws no backend order marker (§3.2).

Slice 08 inherits the same P1-3 boundary. Before 05G is deployed, authenticated protected geo acquisition, route preview and server quote computation may exist, but slice 08 MUST NOT persist or publish provider-backed precise points, exact location details or `RoutePriceQuote`-bound precise route context through the production order path where anonymous `GET /orders` could expose them. Client `POST /orders` input is never a bypass. Only after 05G provides the privacy-safe public projection plus authorized protected projections may slice 08 enable production order persistence of that trusted precise route context.

Slice 05 and 05G solve different prerequisites for slice 08. Slice 05 owns the trusted canonical passenger pickup/destination state, so the production passenger `route-picker` → `WaypointRouteRequest` cutover MUST wait for slice 05 rather than routing from today's `mock_hash` points or duplicating acquisition ownership. Server-internal provider/quote work and active-guidance work may be developed independently where their own trusted inputs permit. Slice 05G is the additional privacy gate before trusted precise route context is persisted/published through production orders.

Slice 06P — Passenger Presence / Tracking integration (PLANNED) has two deliberately different server projections:

- A. `/map` nearby discovery: authenticated privacy-scoped `NearbyVehicleMarker` only. The point is privacy-coarsened/quantized and `markerId` is ephemeral/projection-scoped. It MUST NOT expose or equal stable `vehicleId`, `driverId`, `assignmentId` or `shiftId`, and must not become a durable cross-session fleet-tracking identifier. Exact rotation/radius/count policy is deferred.
- B. passenger `/active-ride?role=passenger&tripId=<id>`: participant-gated assigned-driver tracking through the exact Ride → working vehicle → Presence linkage below.

Nearby discovery never sends raw `VehiclePosition` or stable fleet identity to the passenger map. Guest may open the base map but receives no production nearby positions; missing authentication/projection yields no live nearby markers and no demo fallback. Assigned-driver tracking is a distinct protected projection and MUST NOT be collapsed with nearby discovery.

Slice 06P depends on 02, 03, 06 and Presence. Nearby waits on the authenticated privacy-scoped marker projection; assigned-driver tracking waits on the Ride → Presence linkage.

CURRENT identity facts: the backend ride knows its assigned driver internally, but the participant ride projection exposes driver display fields only and no durable ride-bound vehicle identity. The current matching / ride-bootstrap path therefore does not yet freeze the `trackingVehicleId` needed by 06P. This is the backend gap 06P must close; no runtime is added by 01A.

**RideTrackingBinding (PLANNED backend prerequisite of 06P).** Assigned-driver tracking uses one server-authoritative immutable ride binding:

```text
RideTrackingBinding {
  tripId,
  assignedDriverId,
  trackingVehicleId
}
```

The binding is established by the matching / assignment / ride-bootstrap authority when the ride becomes assigned. `trackingVehicleId` is the exact server-authoritative vehicle identity that Presence uses for this driver in this ride assignment context. The client never supplies or guesses it. The binding is immutable for that ride: 06P MUST NOT re-resolve "whatever vehicle the driver is using now" on every poll, and an old trip can never jump to a later vehicle, shift or ride.

This contract intentionally does **not** make current `OPEN driver_shift` a 06P prerequisite. BD-DOCS-033 was synchronized in this PR so the authoritative Presence decision matches 06P's Guest denial, coarse/ephemeral nearby projection, immutable ride-bound assigned tracking and active-status cutoff; Presence itself remains `status: draft` and runtime-dark. It continues to key raw Presence by authenticated driver + active vehicle, and 06P consumes that Presence key through the ride-bound binding. If a future Shift/Presence reconciliation uses a shift-pinned vehicle when the binding is created, that is compatible, but passenger tracking does not query a later/current shift to decide which vehicle an old trip follows.

Assigned-driver tracking authorization and lookup order is frozen:

1. authenticate and participant-gate the caller for `tripId`;
2. read authoritative `ride.status` and require the explicit trackable allowlist: `ACCEPTED`, `DRIVER_EN_ROUTE`, `DRIVER_APPROACHING_PICKUP`, `WAITING_PASSENGER`, or `IN_PROGRESS`;
3. resolve exactly one `RideTrackingBinding` and require its `assignedDriverId` to match the ride's authoritative assigned driver;
4. query Presence only for that binding's exact `trackingVehicleId`;
5. return only a fresh production `VehiclePosition`.

Anything else fails closed. In particular `COMPLETED`, `CANCELED` and `NO_SHOW` return **no live driver position**. The terminal-state check happens before any Presence lookup; immediately on terminal transition the backend projection stops returning a position and the passenger client removes/hides the marker. Reusing the historical `tripId` after completion can never reveal the driver's later Presence, later vehicle or later shift. An absent/ambiguous binding, binding mismatch, stale Presence or missing current position also returns no marker. There is no fallback to display fields, nearest/first Presence row, a different current vehicle or demo identity.

Slice 06P acceptance (PLANNED):

- Nearby vehicles: reachable on `/map` for authenticated callers only as privacy-scoped `NearbyVehicleMarker`s; Guest gets no production nearby positions, raw Presence or stable fleet identity.
- Assigned driver, allowed non-terminal status + valid binding + fresh Presence: marker may render on passenger `/active-ride`.
- Terminal status (`COMPLETED`, `CANCELED`, `NO_SHOW`): backend returns no driver live position and the marker is removed/hidden immediately.
- The same old `tripId` after terminal transition cannot expose future driver Presence, even if the driver later changes vehicle/shift or starts another ride.
- Missing/ambiguous/mismatched `RideTrackingBinding` fails closed; stale Presence hides the marker; no demo fallback.
- The passenger map UI never becomes the authority for driver identity, tracking status or vehicle position.
- Passenger active-ride internal read-state/status map replacement either reuses the existing live map safely or disposes the old map handle **before** replacing its DOM.
- Terminal passenger root replacement drains/disposes the live map handle before removing the active-ride root.
- Router navigation still drains the same ownership slot; internal teardown followed by later route exit does not double-dispose.
- The ownership slot is cleared before disposal, so an old disposer cannot kill a newer replacement map.
- At most one passenger active-ride GL instance is live at a time; no orphan WebGL context/listeners or map-owned polling/listener resources survive a disposed surface.

The Presence track runs separatelyThe Presence track runs separately (server Presence #2, BD-DOCS-033). It creates the server presence truth — which drivers are online and where, driven by heartbeat and TTL — and is a prerequisite, not the client integration. For assigned-driver tracking, 06P addresses Presence through the immutable ride-bound `trackingVehicleId`; it does not reinterpret Presence's active-vehicle key as a requirement to query an `OPEN driver_shift` at tracking time. A Presence runtime without 06P does not mean nearby vehicles or assigned-driver tracking have shipped. BD-DOCS-033 is still a `status: draft` decision record and the Presence service is unimplemented (dark); this contract does not change it.

Mapping to `docs/db-mapbox-readiness.md`: M1's service-worker safety is already satisfied for the registered (still dark `501`) Route & Price path `/api/v1/route-price` — production uses two origins (BD-DOCS-041), so the Pages PWA's backend traffic bypasses `public/sw.js` through its cross-origin origin guard; same-origin BazarDrive API traffic whose pathname starts with `/api/` is independently bypassed by the existing pathname guard. Neither of those API placements requires a new SW caching rule or VERSION bump merely for API traffic. This guarantee is specific to cross-origin traffic and same-origin `/api/`; a future same-origin proxy outside `/api/` remains a separate SW review. M1's CSP gate stays open: the exact backend API origin must be added to `connect-src` before the production backend is enabled, and a direct-browser external provider, if ever chosen, needs its own additional origin. The Route & Price decision record (BD-DOCS-035) states the same model. M2 (the stub seams as the single swap boundary) lands through slices 03, 06 and 08; slice 08 explicitly owns the production `route_service` / `price_estimator` and route-picker call-site cutover for Route & Price; M3 (real geolocation behind `geolocation_service`) is slice 04.

Every slice is its own branch and PR, and the Mapbox track and the DB track never share a PR (`docs/db-mapbox-readiness.md`).

## 14. Acceptance for this slice (01A)

- Only these docs change in PR #1007: this file, `docs/screen-contracts.md`, `docs/flow-contracts.md`, `docs/db-mapbox-readiness.md`, `docs-site/docs/decisions/route-price-map.md`, `docs-site/docs/decisions/backend-home-and-stack.md`, and `docs-site/docs/decisions/presence-heartbeat.md` (BD-DOCS-035 / BD-DOCS-041 service-worker/API wording plus BD-DOCS-033 passenger Presence projection/privacy boundaries synchronized; docs only).
- `public/src/app.js` still registers `/map` and `/driver-map` and does not register `/driver-navigation`.
- Every capability above is labelled CURRENT, PLANNED or FUTURE NATIVE; no PLANNED item is described as shipped.
- P1-1 and P1-2 are recorded with evidence and routed to `BD-MAP-DUAL-EXPERIENCE-01B`; P1-3 is recorded with evidence and routed to slice 05G.
- `NavigationRouteView` is the name for map/navigation route data; `RouteSnapshot` is not reused.
- `git diff --check`, `node scripts/check.mjs` and `node scripts/dispatcher.mjs` pass.

## 15. Non-goals (01A)

No runtime code, route registration, service worker or CSP change, Mapbox API call, backend, DB or migration, design-registry change, document-registry registration, and no Blender or Unity artifacts. Fixing P1-1 and P1-2 is slice 01B; fixing P1-3 is slice 05G.
