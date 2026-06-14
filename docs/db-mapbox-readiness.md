# DB & Mapbox Readiness

Status: planning / reference. This document tracks what must exist **before** two future integrations so each swap is 1:1 and screens are not rewritten:

- **DB track** — replace the mock / `localStorage` backend with a real API + database.
- **Mapbox track** — replace the map stub foundation with the real Mapbox GL SDK.

These are **two independent safety tracks**. Per `CLAUDE.md` they must never be mixed in one PR (no DB work in a Mapbox PR, no UI-only work in a Mapbox/backend PR, no docs mixed with runtime).

This file documents shipped behavior and planned/unshipped work. Planned items are labelled; do not read them as live.

---

## Baseline already shipped (do not re-build)

- **Error adapter.** `public/src/app_error_triggers.js` exposes `reportAppShellError(kind, opts)` and `dismissAppShellError({ onlyIfState })` over the global overlay in `public/src/app_error_overlay.js` (`window.BD.GlobalError.show/hide/current`). Connection watcher: `public/src/app_connection_status.js`. Error kinds: `offline | timeout | server_error | retrying | recovered`.
- **01C error/loading/empty pattern shipped on 3 load screens:** feed (`public/src/screens/feed.js`), inbox (`public/src/screens/inbox.js`), post detail (`public/src/screens/post_detail.js`). Pattern: wrap the data load in `loadX(onRetry, isRetry)` → on retry show `retrying` → on success dismiss with `onlyIfState: 'retrying'` → on failure report `server_error` with a guarded `onRetry` and fall back to `[]` (screen keeps its own empty/missing state).
- **localStorage key registry.** `public/src/storage_boundary.js` is the primary registry of `bazardrive.*.vN` keys, but it is **not exhaustive** — the schema-freeze work must sweep the whole codebase. Known keys defined outside it include `bazardrive.order_overlay.v1` (`ORDER_OVERLAY_STORAGE_KEY` in `public/src/driver_offer_store.js`) and `bazardrive.favorite_route_notice.v1` (`FAVORITE_NOTICE_KEY` in `public/src/favorite_routes.js`). Persisted order-detail and favorite-route state must not be omitted from data migration.
- **Mapbox stub foundation exists and is enforced.** `public/src/mapbox/` provides `map_shell.js` (`createMapShell()`), `driver_markers.js`, `trip_status_layer.js`, `geolocation_service.js`, `mapbox_config.js`, `mapbox_state.js`, `foundation_utils.js`, plus the SDK loader seam `mapbox_loader.js` (`loadMapboxSdk()` / `isMapboxSdkLoaded()` / `unloadMapboxSdk()`), the route/price seam `route_service.js` (`estimateRoute`) and `price_estimator.js`. The single `createMapShell()` contract is consumed by **8 screens**, not only the four map routes: `/map`, `/route-picker`, `/route-preview`, `/driver-map` **plus** `location_permission.js`, `order_map_draft.js`, `active_ride.js`, `active_ride_passenger.js` — all are on the same swap seam. `scripts/smoke-mapbox-foundation-stubs.mjs` pins "no `mapboxgl` / `api.mapbox.com` / `fetch` / external URLs", but its source-scan `MODULES` table currently covers only `driver_markers.js`, `trip_status_layer.js`, and `foundation_utils.js` — `map_shell.js`, `mapbox_loader.js`, `mapbox_config.js`, `geolocation_service.js`, `route_service.js`, and `price_estimator.js` are **not** yet scanned for forbidden tokens (a gap M2 should close) — the pricing module especially, since the real pricing API is meant to stay behind that seam. There is no `navigator.geolocation` call anywhere — geolocation is fully stubbed.
- **Service worker is already tile-safe.** `public/sw.js` fetch handler returns early for cross-origin requests (`url.origin !== self.location.origin`), so external map tiles bypass the cache — matching the `CLAUDE.md` rule "do not cache external Mapbox/tile requests."

---

## DB track — sequence (do first)

### Slice 1 — finish 01C error coverage (3 screens remain)
Pure continuation of the shipped pattern. Lowest risk. One screen, one branch, one PR each; add a `scripts/smoke-*-error-trigger.mjs` pin and bump `public/sw.js` VERSION for the changed screen.

| ID (planned) | Screen | Current gap |
|---|---|---|
| `BD-ERROR-01C-E` | `public/src/screens/respond.js` | bare `await listFeedPosts()`, no try/catch |
| `BD-ERROR-01C-F` | `public/src/screens/driver_map.js` | `listNearbyOrders()` load, no catch (empty state already exists) |
| `BD-ERROR-01C-G` | `public/src/screens/profile.js` (receipts) | `listDriverReceipts()` silently swallows to `[]` |

These three are the *next* slices, not the end of 01C. A repo-wide sweep still finds unwrapped `mock_api` reads in other shipped flows — e.g. `/responses` (`getOrderById`), `/trip-receipt` (`getReceipt` in `trip_receipt.js`), and `/active-ride` (`findLatestHandedOffOrderTripId` / `getReceipt`). Do **not** treat 01C as complete once these three land; the backend migration must wrap every screen read through the app-shell retry/error adapter or those flows fail silently when reads become real API calls.

### Slice 2 — unified data adapter (`load → success | error`) — planned
The **error** adapter exists; a **data** adapter does not. Each screen open-codes `loadFeedPosts` / `loadInboxItems` / `loadDetailPosts`. Introduce one module (e.g. `public/src/data_layer.js`) with a uniform `loadResource(fn, { onRetry, isRetry })` wrapping any `mock_api` read in the 01C contract, and migrate the covered screens onto it. This is the seam the real API sits behind. Also **normalize all `mock_api` reads to async** — today several reads are synchronous and a real API forces async, so every call site must be audited for sync assumptions first. The sync surface is broader than the obvious cases: `getOrderById`, `listNearbyOrders`, `listMyPostsSync`, `listRideOrdersAsFeedPosts`, `getReceipt`, `listDriverReceipts`, `findLatestHandedOffOrderTripId` (reads) and `acceptNearbyOrder` (a sync mutation). Note `findLatestHandedOffOrderTripId()` is called synchronously by `route_picker.js` (`resolveActiveRideGuardTripId()`) and in the active-ride guard — those call sites must move with the audit. Screens like profile payouts/receipts and the feed/order projections rely on these being synchronous — treat this as a full audit, not a fixed shortlist.

### Slice 3 — schema freeze (docs contract, then narrow renames) — planned
Produce a canonical entity schema so DB tables map 1:1, then land targeted renames as small PRs (no big-bang rewrite). Inconsistencies to resolve/document:
- `trip` vs `ride` naming; `tripId` vs `trip_id`.
- Status enums defined in multiple places: `RIDE_STATUS` (`public/src/ride_state.js`), `ORDER_STATUS` (`public/src/screens/order_detail.js`), `DRIVER_OFFER_STATUS` (`public/src/driver_offer_store.js`) → one source of truth.
- Price stored as string (`"950 ₽"`) vs number; nested-map vs array storage (offers/chat maps vs `ride_orders` array); cancel metadata tracked in two places (`ride.cancel` and the order overlay).

### Slice 4 — idempotent mutations — planned
No mutation is request-id deduped today. The entry points span more than the ride-creation flow — the full set must get idempotency keys/conflict rules, or the order-detail flow keeps double-submit / stale-tab races:
- create order — `public/src/screens/order_map_draft.js` (`handlePublish`, 700ms tap-guard only)
- respond — `public/src/screens/respond.js` (last-write-wins)
- accept — `public/src/ride_actions.js` / `mock_api.acceptNearbyOrder` (partial: status-guard rejects non-`CREATED`)
- driver-offer / order-detail writes in `public/src/driver_offer_store.js`: `sendDriverOffer`, `withdrawDriverOffer`, `commitPassengerSelection`, `cancelOrderByPassenger`, `cancelOrderByDriver`, `rejectSentOffersForPassengerCanceledOrder`
- composer `/new` publish — `public/src/screens/composer.js` writes via `createRideOrder(...)` (passenger requests) and `createFeedPost(...)` (regular feed posts); a retry/double-submit/stale tab can duplicate posts/orders even after `order_map_draft.js` is hardened
- status transition — `mock_api.updateTripStatus`; receipts — `mock_api.saveDriverReceipt`

Add a client-generated idempotency key per mutation, threaded through the mock now so the API contract is ready, and document the conflict rule (server-timestamp-wins).

---

## Mapbox track — sequence (after DB, or in parallel; never the same PR)

### Slice M1 — CSP/SW decision (safety task) — planned
Current CSP (`public/index.html`) is `'self'`-only and would block `api.mapbox.com`, tile hosts, and `blob:`/worker sources. Decide and document the exact directive additions across `script-src` / `connect-src` / `img-src` / `style-src` / `worker-src` (+ `blob:`). The SW needs **no rewrite** — its origin guard already prevents tile caching; only confirm no tile-caching rule is introduced.

### Slice M2 — keep the stub contract as the single swap seam — planned
Already largely true. The real-SDK swap must stay isolated to the **existing seams**, not pushed into screens:
- `map_shell.js` — body of `createMapShell()` (the only render seam; 8 consumers depend on it staying stable).
- `mapbox_loader.js` — `loadMapboxSdk()` / `isMapboxSdkLoaded()` / `unloadMapboxSdk()` is the established SDK-load seam; the real loader replaces this stub. Do **not** load Mapbox from `createMapShell()` or screens. **Caveat:** `loadMapboxSdk()` has no import/call site in `public/src` today — implementing the real loader alone leaves the SDK never initialized. This slice must name an explicit caller: an app-level/bootstrap orchestration step (e.g. on first map-route entry) that invokes the loader, or a guarded `createMapShell()`-side init — decide and document which.
- `mapbox_config.js` — real token via `getMapboxToken()` / `hasMapboxToken()`.
- `route_service.js` (`estimateRoute`) and `price_estimator.js` — the route/price seam. The real Directions/pricing API goes **here**, not into the hash estimator inside `route_picker.js` (routing it through the screen would bypass the seam and force route-picker logic changes). **Caveat:** `route_picker.js` today defines and calls its *own local* `estimateRoute()` and does not import either seam module, so updating the seam alone changes nothing live. This slice needs an explicit non-render migration of the `route_picker.js` call site onto `route_service.js` / `price_estimator.js` first; otherwise route drafts and order prices keep using the mock hash path while the seam diverges.
- `geolocation_service.js` — real permission/position (see M3).
Extend `scripts/smoke-mapbox-foundation-stubs.mjs` to also scan these modules for forbidden tokens (today only 3 are scanned — see baseline). Screen render logic must stay untouched.

### Slice M3 — real geolocation behind the existing interface — planned
Replace the `geolocation_service.getPermissionStatus()` / `requestPosition()` stubs with real `navigator.*` calls. **Caveat:** swapping the stub is not sufficient — no runtime code imports or calls `requestPosition()` today; the `/location-permission` allow branch only saves `locationAllowed` and navigates to `/map?state=default`. This slice must also **wire the «Разрешить доступ» CTA to `requestPosition()`** so tapping allow actually triggers the native prompt and captures coordinates. **Also: `/map` reads `getPermissionStatus()` synchronously** (`const perm = getPermissionStatus()` then immediate state comparisons). The real check (`navigator.permissions.query` / `navigator.geolocation`) is promise/callback-based, so the `/map` permission read must be made async or cached as part of this slice — otherwise the denied/permission branches evaluate a `Promise` instead of a status. The fork is already wired (`allow → /map?state=default`, `manual → /route-picker`, `back → /map`) and the real permission flow must lie on the same branch — do not collapse allow and manual.

---

## Why the split is enforced
DB work changes data semantics, storage shape, and mutation contracts. Mapbox work changes CSP, the SDK seam, and geolocation. They have different reviewers (data/runtime vs `sw-offline-agent` / safety), different risk surfaces, and different smoke guards. Mixing them in one PR makes review and rollback unsafe — hence the hard separation above.
