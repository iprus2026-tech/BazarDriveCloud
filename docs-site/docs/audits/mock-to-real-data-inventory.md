---
id: BD-DOCS-039
docType: audit
title: "Mock-to-Real Data Inventory — Backend Migration Audit"
owner: docs-contract-agent
status: current
revision: 2026-06-20
effectiveFrom: 2026-06-20
reviewAfter: 2026-12-18
visibleFor: [developer, dispatcher, product, qa]
sourceOfTruth: docs-site
related:
  routes: []
  files:
    - public/src/mock_api.js
    - public/src/state.js
    - public/src/ride_state.js
    - public/src/driver_offer_store.js
    - public/src/ride_history.js
    - public/src/storage_boundary.js
    - scripts/smoke-static-data-inventory.mjs
    - scripts/check.mjs
  issues: [636, 584]
  prs: []
tags: [audit, migration, mock-to-real, data-layer, target]
slug: /audits/mock-to-real-data-inventory
---

# Mock-to-Real Data Inventory — Backend Migration Audit

> **Read-only inventory — no runtime change.** A project-wide audit of the mock /
> hardcoded / client-only data that must become real backend data before (and
> during) the migration. It maps each finding to a target entity, endpoint, and
> growth-path phase. It is a planning reference, not shipped behaviour. Pairs with
> [Mini-Yonder Background Services](../governance/mini-yonder-background-services.md)
> (BD-DOCS-023), the [Data Layer Contract (BD-DOCS-031)](../design/data-layer-contract.md),
> and the phase ADRs BD-DOCS-033–038.

## Method & scope

Audited (read-only): `public/src/screens/*.js`, `mock_api.js`, `state.js`,
`ride_state.js`, `driver_offer_store.js`, `ride_history.js`,
`storage_boundary.js`, `public/src/mapbox/*.js`. Findings classified by type
(`static` / `mock` / `localStorage` / `derived` / `URL` / `placeholder`) and by
phase (`Phase 1 data` / `Auth` / `Presence` / `Dispatch` / `Mapbox` / `Safety` /
`History`).

**Totals:** ~150 findings · 25 storage keys (19 cleared · 5 kept · 1 dev — see [Enforcement](#enforcement--removal-tracking)) · 6 URL-param state surfaces ·
5 client-only readiness flags · 4 demo seed arrays.

## Enforcement & removal tracking

**Two axes.** Every key has a *boundary* class (does logout wipe it?) and a
*migration* owner (does the backend own it?). They are independent — do **not**
conflate them.

**Boundary axis — locked by an automated gate.**
`scripts/smoke-static-data-inventory.mjs`, run by `node scripts/check.mjs`
(BD-DATA-STATIC-01, #636 — shipped alongside this ledger in PR #637). It discovers
every `bazardrive.*` / `profileTripDemo` key in `public/src/**` and classifies each:

- **Cleared — 19 user-scoped stores** wiped by `clearUserScopedStorage()` in
  `public/src/storage_boundary.js`; the gate asserts each is documented there
  **and** wired to a remover.
- **Kept — 5 user/device keys** documented but not cleared: `user.v1`,
  `posts.v1`, `map_prefs.v1`, `debug.publish`, `smoke_role.v1`.
- **Dev — 1 tooling key** outside the boundary: `ops.mel.v1`.

The gate fails on any **orphan** key not in the manifest — the gap that once let
`bazardrive.order_overlay.v1` live outside `storage_boundary.js` — plus a stale
entry, a duplicate classification, an undocumented cleared key, or a cleared key
with no remover. Canonical count: **25 keys (19 cleared · 5 kept · 1 dev).**

**Migration axis — owned by [BD-DOCS-031](../design/data-layer-contract.md) (S/C).**
This is what drives removal, and it does **not** line up with the boundary class:

- **Server-owned (S) → migrate to backend:** `posts.v1` + `myposts.v1`,
  `ride_orders.v1`, `respond.v1` + `responses.v1`, `driver_offers.v1`,
  `order_overlay.v1`, `active_ride.v1`, `trip_confirmation.v1` +
  `driver_handoff_snapshot.v1`, `chat.v1`, `driver_receipts.v1`,
  `ride_history.v1`. (`posts.v1` is *kept* on the boundary yet server-owned.)
- **Client-only (C) → stays local even with a backend:** `user.v1` (session
  cache; identity is the auth ADR), `favorite_routes.v1`,
  `favorite_route_notice.v1`, `repeat_route.v1`, `draft.v2`, `order_form.v1`,
  `route_draft.v1`, `profileTripDemo`, `map_prefs.v1`, `smoke_role.v1`,
  `debug.publish`, `ops.mel.v1`. (Several of these are *cleared* on the boundary
  yet never migrate.)

**Removal tracking.** Each **server-owned** key moves `mock → migrating → removed`
as its owning module swaps `localStorage` for the API behind
`public/src/data_layer.js`. "All static data removed" is reached when every **S**
key is served by the backend — not every cleared key; the **C** keys stay. This
ledger plus the gate are the scoreboard.

## A. localStorage-backed shared data — the migration backbone

Every store is client-only today; none syncs to a backend.

| Key | Holds | Module | Target entity | Phase |
| --- | --- | --- | --- | --- |
| `bazardrive.user.v1` | profile / identity / readiness | state.js:1 | User/Auth | **Auth** |
| `bazardrive.active_ride.v1` | active ride + status | ride_state.js:4 | ActiveRide | **Dispatch** |
| `bazardrive.ride_history.v1` | completed trips | ride_history.js:13 | TripHistory | **History** |
| `bazardrive.ride_orders.v1` | passenger orders | mock_api.js:428 | Order | **Dispatch** |
| `bazardrive.driver_receipts.v1` | driver receipts / earnings | mock_api.js:790 | Receipt | **History** |
| `bazardrive.driver_offers.v1` | driver offers | driver_offer_store.js:45 | DriverOffer | **Dispatch** |
| `bazardrive.order_overlay.v1` | order status mutations (select/cancel) | driver_offer_store.js:418 | OrderState | **Dispatch** |
| `bazardrive.myposts.v1` | user posts | mock_api.js:104 | FeedPost | Phase 1 data |
| `bazardrive.posts.v1` | global posts cache (not user-scoped) | mock_api.js:321 | FeedPost | Phase 1 data |
| `bazardrive.chat.v1` | chat threads | screens/chat.js | Chat | Phase 1 data |
| `bazardrive.responses.v1` / `bazardrive.respond.v1` | responses (pax/driver) | responses.js / respond.js | Response | **Dispatch** |
| `bazardrive.trip_confirmation.v1` | chat→ride handoff | trip_confirmation.js:31 | TripConfirmation | **Dispatch** |
| `bazardrive.driver_handoff_snapshot.v1` | driver handoff snapshot | driver_handoff_snapshot.js | ActiveRide seed | **Dispatch** |
| `bazardrive.route_draft.v1` | route draft | route_picker.js:14 | RouteDraft | **Mapbox** |
| `bazardrive.order_form.v1` | order-map draft | order_map_draft.js:14 | OrderDraft | **Mapbox / Dispatch** |
| `bazardrive.favorite_routes.v1` · `bazardrive.repeat_route.v1` | saved / repeat routes (client-only per BD-DOCS-031) | favorite/repeat_route.js | RoutePrefs | Phase 1 data |
| `bazardrive.draft.v2` | composer draft | composer.js:8 | ComposerDraft | Phase 1 data |
| `bazardrive.map_prefs.v1` | device map prefs (not user-scoped) | mapbox_state.js:5 | DevicePref | **Mapbox** |
| `bazardrive.smoke_role.v1` (sessionStorage) | per-tab role (test override) | smoke_role.js | replace with real auth | **Auth** |
| `profileTripDemo` | profile demo override | storage_boundary.js | — (demo only) | — |
| `bazardrive.favorite_route_notice.v1` | one-time favorite-route banner | favorite_routes.js | client-only (BD-DOCS-031) | Phase 1 data |
| `bazardrive.debug.publish` | dev publish debug-trail toggle | order_map_draft.js | — (dev / client-only) | — |
| `bazardrive.ops.mel.v1` | ScreenOps MEL cards (dev tooling) | ops/ops_mel_store.js | — (dev / client-only) | — |

## B. Findings by phase

### Phase 1 — Data layer (shared DB)

| Module | Field | Source | Type | Target entity | Endpoint | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| mock_api.js | `FEED_POSTS_V2` (6 seed posts, ★4.92, '2 800 ₽', tariff announcement) | :14-98 | mock | FeedPost | `GET /feed/posts` | seed posts shadow real feed |
| mock_api.js | `INBOX_ITEMS_V1` (6 inbox items + ★4,92) | :199-290 | mock | InboxItem | `GET /inbox/items` | demo shadows real messages |
| mock_api.js | `DEMO_DRIVER_RECEIPT` (fare 1540, commission −185, tip 120, net 1475, trip 48-321) | :797-806 | static | Receipt | `GET /receipts/{id}` | fake receipt always available — masks empty history |
| ride_state.js | `buildDemoRide` (Анна М. ★4,86; Рустам К. ★4,92; offer 1 480 ₽; todayEarnings 4 720 ₽; tripsToday 7) | :151-190 | mock | Passenger/Driver/Ride | `/drivers\|passengers\|rides/{id}` | demo identities/counters everywhere |
| ride_state.js | `SIM_AUDIT_RIDE_OVERRIDES` (Алексей ★4,9, 950₽, commission 8%) | :73-103 | override | Order/Passenger | `/orders/{id}` | audit override masks real data |
| responses.js | `MOCK_DRIVERS` (3 drivers ★4,92/4,78/4,88; '1248/612/304 поездок'; priceDelta; «Лучший вариант») | :24-85 | mock | Response/Driver | `GET /orders/{id}/responses` | demo board instead of real responses |
| order_detail.js | `DEMO_ORDERS` (6 fixtures) + frozen `TS=1_750_000_000_000` | :69, :89-216 | mock | Order | `GET /orders/{id}` | lifecycle frozen in 2024 |
| profile.js | `MOCK_PROFILE_STATS` (savings 6240, CO2 52); rating '4,92' | :302-303, :609 | static | PassengerStats/Rating | `/passenger/stats`,`/passenger/rating` | static metrics/rating |
| profile.js | `MOCK_ACTIVE_TRIP` / `MOCK_PLANNED_TRIP` (driver РК, Camry, plate A482MP77, Tula 07:00) | :309-335 | mock | ActiveRide/PlannedTrip | `/passenger/active-ride` | fake active/planned trip |
| active_ride_passenger.js / chat.js | `MOCK_DRIVER`/`MOCK_TRIP`/`MOCK_MESSAGES`; placeholders (plate 'А 124 ВВ 77', card '4417/Тинькофф', №48-321) | :18-37+ | mock | Driver/Ride/Chat/Payment | `/active-ride/{tripId}/*`,`/chat/{id}/messages` | demo identities/card/number |
| trip_confirmation_handoff.js | `MOCK_PASSENGER/DRIVER/VEHICLE/ROUTE` + seed (todayEarnings 4 720, rate 12₽/км, commission 8%) | :21-54,105-183 | mock | Passenger/Driver/Vehicle/Order | `/order/{id}`,`/driver/{id}` | mocks leak into active-ride seed |
| **static ratings (consolidated)** | '4,92'(РК), '4,86'(Анна), '4,78'(Сергей Л.), '4,88'(Нурлан) | ride_state:153/160, mock_api:206/87, responses:31/51/71, order_detail:124 | static | Rating | `/drivers\|passengers/{id}/rating` | 4+ sources drift apart |
| config enums | `DRIVER_CANCEL_REASONS`, `DRIVER_PROBLEM_TYPES`, `QUICK_REPLIES`, `COMPLETE_RATING_TAGS` | active_ride_*_sheets.js, chat.js, active_ride_passenger.js | hardcoded | Config | `/config/*` | cannot change without a release |

### Auth (identity)

| Module | Field | Source | Type | Target | Endpoint | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| state.js | `bazardrive.user.v1` — identity/profile local | :1 | localStorage | User | `/users/{id}/profile` | core identity on the client |
| smoke_role.js | per-tab role `?smokeRole=` / `bazardrive.smoke_role.v1` | :59-68 | URL/session | Session role | real auth context | role not tied to auth; no multi-user test |
| composer.js / post_detail.js | publish-time passenger snapshot; `u.onboarded` gating | composer:262-280, post_detail:287 | derived | UserProfile | `GET /user/profile` | contact/identity gated locally |

### Presence (driverOnline / readiness)

| Module | Field | Source | Type | Target | Endpoint | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| state.js | `driverOnline` (default false) | :57 | client-only | Presence | `/drivers/{id}/presence` | online status doesn't sync across tabs/devices |
| state.js | `isDriverLineReady()` (profile+docs+waybill+medical) | :177-183 | derived | Readiness | `/drivers/{id}/can-accept-orders` | client gate ≠ server rules (see BD-DOCS-033) |
| active_ride.js | paid-wait accrual (`paidElapsed '2:14'`) | :739 | derived/mock | PaidWait | `/active-ride/{tripId}/paid-wait` | counter resets on reload/offline |

### Dispatch (orders / offers / matching / active ride)

| Module | Field | Source | Type | Target | Endpoint | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| ride_state.js | active-ride status + `DEMO_ACTIVE_RIDE_ID` always resolves | :4, :67 | localStorage/static | ActiveRide | `/active-rides/{tripId}` | demo ride masks the real one |
| **URL-param status** | `?status=`,`?role=`,`?phase=`,`?payment=`,`?state=`,`?wait=` override state | active_ride.js:326-338, order_detail:260, profile:3849 | URL | server state | `/active-rides/{tripId}` | query-param overrides backend status (forgeable) |
| driver_offer_store.js | offer TTL (15m), `NEW_OFFER_DEFAULTS` ('Вы (демо)' ★5,0 1000₽) | :157, :200-207 | static/mock | DriverOffer | `/orders/{id}/offers` | demo defaults in real offers; TTL not from backend |
| order_detail.js | commission '12%' | :491 | hardcoded | OfferConfig | `/ride-offer/commission` | fixed commission vs real rate |
| respond.js | `PRICE_CHIPS [1300,1500,1800]`, default 1500 | :12, :20 | static | Pricing | `/ride-offer/suggested-price` | fixed prices hide real logic |
| state.js | `waybillOpen` / `shiftOpen` | :62 | client-only | Shift | `/shifts/{id}` | shift state is backend-owned |
| map.js (MapHome) | `NEARBY_ORDERS` (3 demo: Анна М. 320₽) | :61-65 | mock | Nearby | `POST /orders/nearby` | fake "nearby" vs spatial query |

### Mapbox (route / price / map / geo)

| Module | Field | Source | Type | Target | Endpoint | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| mapbox_loader.js / mapbox_config.js | SDK `→null`, token `→null`, center Moscow | loader:11, config:11-14 | placeholder | Mapbox SDK/token | `/config/mapbox-token` | no real map; all geo no-op |
| route_service.js / price_estimator.js | estimate `→null`, price `→null` | route:10, price:8 | placeholder | Directions/Tariff | `/routing/estimate`,`/pricing/estimate` | no real route/price |
| route_picker.js | distance = hash `80 + (seed%220/10)`; price = `80 + km*35` | :182-197, :195 | derived | Directions/Tariff | `/routing/estimate` | distance/price invented, drift on label typo |
| route_picker.js | `SAVED_PLACES`(Дом/Работа), `RECENT_PLACES`(airports), `MOCK_SUGGESTIONS`(7), `coords:null` everywhere | :49-94,164,216 | static/null | SavedPlaces/Geocoding | `/user/saved-places`,`/geocoding/search` | search is a fixed list; no coords |
| geolocation_service.js | permission `UNKNOWN`, position `→null` | :18, :22 | placeholder | Geolocation | `/geolocation/*` | real location unavailable |
| order_map_draft.js | `PRICE_STEP 50`, `PRICE_MIN/MAX 0..100000` | :24-26 | static | Tariff | `/pricing/limits` | no surge/zone |
| driver_markers.js / trip_status_layer.js | hardcoded `STATUS_VISUAL`; coords/price detection silent-fails | markers:26-56, layer:29-39 | static/null | RideStatus schema | `/rides/statuses` | hardcoded statuses; markers silently skip when coords missing |

### Safety (no-show / report / compliance)

| Module | Field | Source | Type | Target | Endpoint | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| active_ride_driver_noshow.js | `PICKUP_COMP 120`, `COMMISSION 24` (demo comp) | :33-34 | hardcoded | CompensationConfig | `/driver/compensation/no-show` | compensation invented; no accounting |
| active_ride.js | waiting `freeLimit '3:00'`, `paidRate '8 ₽/мин'` | :609, :744 | mock | WaitingPolicy | `/ride-config/waiting` | waiting rules hardcoded |
| active_ride_passenger_sheets.js | `SAFETY_REPORT_ID '№RPT-4821'` (toast stub) | :99 | mock | IncidentReport | `POST /incident-report` | report is not persisted |
| responses.js | `SAFETY_REPORT_REASONS` (4, stub) | :919-924 | hardcoded | SafetyReport | `POST /safety/report` | report never reaches backend |
| state.js | `medicalCheckPassed` | :63 | client-only | Health | `/drivers/{id}/health-check` | medical status from the client |

### History (receipt / earnings / ratings)

| Module | Field | Source | Type | Target | Endpoint | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| ride_history.js | `bazardrive.ride_history.v1` (completed trips) | :13 | localStorage | TripHistory | `/users/{id}/trips` | history doesn't sync across devices |
| trip_receipt.js | receipt fare/commission/tip/net; fallback trip `48-321`; fake 280ms "loading" | :29, :145-157 | mock | Receipt | `GET /receipt/{id}` | static financials; fake receipt always present |
| active_ride.js | earnings payload (fare 1540, net 1475, balance 19195, todayEarnings 4 720, tripsToday 7) | :281-321 | mock | DriverEarnings | `/driver/receipts/{tripId}`,`/driver/balance` | real billing bypassed |

## C. URL-param-driven business state

`/active-ride?role=&tripId=&status=&phase=&payment=&state=&wait=` ·
`/order?role=&state=` · `/chat?tripId=&responseId=&orderId=&role=` ·
`/profile?role=&section=&state=` · `/respond?postId=` · `/map?state=` ·
`/route-picker?q=&manual=1`

**Risk:** a client query-param overrides server-owned business state (most
critically the active-ride `status`). Post-migration, status must be read from
the server; query-params stay navigation / deep-link only.

## D. "Must-check" screen coverage

Profile (pax+driver) · Feed · Composer · Respond · Responses · Chat · Inbox ·
Order Detail · Trip Confirmation · Active Ride driver/passenger · DriverMap ·
Map/Route · Trip Receipt · Ride History — all covered. **Note:** there is no
standalone Ride History screen; history renders inside `profile.js`
(`historySectionHtml()`, :749 / :944).

## E. Top migration risks (if not migrated)

1. **Fake receipt/history always available** (`48-321`, `DEMO_DRIVER_RECEIPT`) —
   masks missing real earnings; payment reconciliation impossible.
2. **`DEMO_ACTIVE_RIDE_ID` always resolves** + **`?status=` overrides state** —
   a demo ride / forged status instead of the real one.
3. **Price/distance invented** (`80 + km*35`, hash) — no real tariff/ETA, so
   matching and billing are untrustworthy.
4. **One demo driver "Рустам К. ★4,92"** across 6+ surfaces — every ride shares
   the same fake identity.
5. **19 cleared user-scoped stores with no backend sync** — orders/offers/history/chats
   are client-only; device switch = data loss. (Surface locked by the #636 gate;
   see [Enforcement](#enforcement--removal-tracking).)
6. **Readiness/presence on the client** — `driverOnline` / `isDriverLineReady`
   are not server-verified (a non-ready driver can reach the line).

## Boundaries

Inventory only — no runtime, UI, Mapbox, or backend change was made producing
this audit. Each "endpoint" column is a **suggested** target shape, not a
committed API. Promoting any line to real backend data is a separate,
explicitly-scoped change under its phase ADR.
