# BD-ACTIVE-01 — DriverMap → ActiveRide post-merge handoff audit

Post-merge audit of the BD-DRIVER-01 DriverMap → BD-RIDE-D-* ActiveRide
handoff. The goal of this pass is to verify that the pipe between
`/driver-map` and `/active-ride?role=driver&tripId=…&status=DRIVER_EN_ROUTE`
is stable after the BD-DRIVER-01 merge — not to add product behavior.

No defects were found. This is a docs-only audit. No source files were
modified; `node scripts/check.mjs` still passes.

## Scope

Verified that:

- An accepted nearby order disappears from `listNearbyOrders()`.
- A canonical active ride is seeded under `bazardrive.active_ride.v1`
  before the navigation hop.
- The seeded `tripId` is stable, deterministic and reused by
  `/active-ride`.
- Pickup / dropoff labels, price, distance and ETA survive into the
  active-ride record.
- The driver lands in `DRIVER_EN_ROUTE`.
- Stale / unknown order ids on the accept path fail soft, no crash.
- The existing demo / status audit URLs still render.

Out of scope (and intentionally untouched): real Mapbox SDK, backend,
auth, payments, push, driver assignment, passenger renderer changes,
ride state machine redesign, CSP, inline script/style, service-worker
churn.

## Files inspected

| File                                              | What was checked |
|---------------------------------------------------|------------------|
| `public/src/screens/driver_map.js`                | Order list / empty / accepted states; `seedActiveRideFromAcceptedOrder()`; CTA URL construction; stale-id branch. |
| `public/src/screens/active_ride.js`               | Driver renderer entry; `rawTripId` parsing; `loadCanonicalActiveRide({ tripId, role: 'driver' })`; the no-tripId empty fallback (`renderDriverEmpty`); `safeApplyStatusFromQuery`. |
| `public/src/ride_state.js`                        | Storage key (`bazardrive.active_ride.v1`); `createDemoActiveRide` deep-merge; `saveActiveRide` persistence; `findActiveRide` lookup; `RIDE_STATUS.DRIVER_EN_ROUTE`. |
| `public/src/mock_api.js`                          | `createRideOrder()` (status `CREATED`); `listNearbyOrders()` (status filter); `acceptNearbyOrder(id)` (CREATED → ACCEPTED transition + `acceptedAt` stamp; `null` on stale id). |
| `public/src/app.js`                               | Route registration for `/driver-map` and `/active-ride`. |
| `public/sw.js`                                    | Precache contains `./src/screens/driver_map.js`. |
| `docs/screen-contracts.md` (§ BD-DRIVER-01)       | Data contract for the seed write under `bazardrive.active_ride.v1`. |

## Handoff pipe (verified)

The chain from a tap on **Принять** to a rendered `/active-ride` driver
sheet is:

1. `driver_map.js` button handler (`data-action="accept"`).
2. `acceptNearbyOrder(id)` (`public/src/mock_api.js:477`)
   — flips the matching `CREATED` order to `ACCEPTED`, stamps
   `acceptedAt`, persists the list. Returns the updated order, or
   `null` if the id is missing / already non-`CREATED`.
3. `seedActiveRideFromAcceptedOrder(order)` (`public/src/screens/driver_map.js:60`)
   — derives `tripId = trip_${order.id}`, builds a ride via
   `createDemoActiveRide({ tripId, role: 'driver', status: DRIVER_EN_ROUTE, … })`
   with pickup/dropoff labels, price, distance and ETA overrides, and
   persists via `saveActiveRide(ride)` into `bazardrive.active_ride.v1`.
4. UI flips into the `ACCEPTED` sheet with CTA «К поездке».
5. CTA navigates to
   `/active-ride?role=driver&tripId=<encoded trip_id>&status=DRIVER_EN_ROUTE`.
6. `active_ride.js` reads `tripId` from the hash query
   (`public/src/screens/active_ride.js:398`), calls
   `loadCanonicalActiveRide({ tripId, role: 'driver' })`
   (`public/src/screens/active_ride.js:405`), which hits the
   already-persisted seed via `findActiveRide(tripId)` and returns the
   exact ride object that DriverMap wrote — not a generic demo or
   `SIM_AUDIT_RIDE_OVERRIDES` placeholder.

## Audit checklist

| # | Item | Result | Notes |
|---|------|--------|-------|
| 1 | `/driver-map` opens without crash when no orders exist | PASS | `renderList()` queries `listNearbyOrders()`, picks `MAP_VARIANT.EMPTY` and `buildEmptyCard()` when empty. |
| 2 | Empty state has no demo order pins | PASS | `buildMapPlaceholder` only attaches cluster overlay when `variant === NEARBY && orderCount > 0`. No `DEMO_ORDERS` constant in `driver_map.js` / `mock_api.js`. |
| 3 | A `CREATED` order from `/order-map-draft` shows up in DriverMap | PASS | `createRideOrder()` writes `status: 'CREATED'`; `listNearbyOrders()` returns only `CREATED` records (top 20). |
| 4 | Tapping «Принять» flips order status to `ACCEPTED` | PASS | `acceptNearbyOrder(id)` rewrites the matching row, persists the list, returns the updated copy. |
| 5 | Accepted order no longer appears in `listNearbyOrders()` | PASS | The list filter is `status === 'CREATED'`; the now-`ACCEPTED` row is excluded. |
| 6 | Active ride record is saved under `bazardrive.active_ride.v1` | PASS | `saveActiveRide` writes via `saveActiveRideStore`, which uses `STORAGE_KEY = 'bazardrive.active_ride.v1'` (`ride_state.js:4`). |
| 7 | Saved active ride uses `tripId = trip_<order.id>` | PASS | `seedActiveRideFromAcceptedOrder` literally builds `` `trip_${order.id}` `` and reuses it in both the saved record and the CTA URL. |
| 8 | Saved active ride status is `DRIVER_EN_ROUTE` | PASS | Override `status: RIDE_STATUS.DRIVER_EN_ROUTE` is passed to `createDemoActiveRide`. |
| 9 | Saved record carries `pickupLabel` / `dropoffLabel` | PASS | Resolved via `pointLabel(order.pickup, …)` / `pointLabel(order.dropoff, …)` and written to `route.pickupLabel` / `route.dropoffLabel`. Driver renderer reads `ride.route.*`. |
| 10 | Saved record carries a price label from `estimatedPrice` | PASS | `priceLabel = formatted ₽` is written to both `order.offerPrice` and `ride.price`. The renderer reads `ride.ride?.price` / `ride.order?.offerPrice`. |
| 11 | Saved record carries distance + ETA labels when available | PASS | `distanceLabel` → `order.destinationDistance`; `etaLabel` → `order.destinationEta` + `route.etaToDestination`. Zero-value source data falls back to `'—'` (consistent with the rest of the driver sheets). |
| 12 | CTA «К поездке» carries `role=driver`, `tripId` and `status=DRIVER_EN_ROUTE` | PASS | `data-action="active-ride"` handler builds `/active-ride?role=driver&tripId=…&status=DRIVER_EN_ROUTE` (uses `encodeURIComponent` on the trip id). |
| 13 | `/active-ride` reads the seeded ride and does not synthesize unrelated demo data | PASS | `loadCanonicalActiveRide({ tripId, role: 'driver' })` calls `findActiveRide(tripId)` first; on a hit, the seeded record short-circuits both the snapshot path and the `SIM_AUDIT_RIDE_OVERRIDES` materialization branch. |
| 14 | `/active-ride?role=driver` with no `tripId` still hits the intended empty/default behavior | PASS | Without `tripId`, `rawTripId` is `null`, `loadCanonicalActiveRide(DEMO_ACTIVE_RIDE_ID)` returns whatever was persisted there before (or `null`); the no-tripId / no-status / no-snapshot branch renders `renderDriverEmpty()`. |
| 15 | Passenger active ride is not changed | PASS | The DriverMap seed is written for `role: 'driver'` only; the passenger renderer (`active_ride_passenger.js`) is not touched, and its loader still reads the canonical record by `tripId`. |
| 16 | No backend / real Mapbox / auth / payment / push / driver assignment added | PASS | No new imports added by BD-DRIVER-01 beyond `createMapShell`, `listNearbyOrders`, `acceptNearbyOrder`, `RIDE_STATUS`, `createDemoActiveRide`, `saveActiveRide`. No tokens, no `navigator.geolocation`, no `fetch`, no push registration. |

## Stale / invalid accept path

- `acceptNearbyOrder(id)` returns `null` for unknown ids or for ids
  whose record is no longer `CREATED` (e.g. another tab already
  accepted in this same `localStorage`, or the row was cleared via
  `clearRideOrdersStore`).
- The handler in `driver_map.js` checks the return value: on `null` it
  navigates to `/order-map-draft` (`public/src/screens/driver_map.js:339-347`),
  giving the driver a way to publish a fresh local order and try
  again. No active-ride seed is written when accept fails; no `null`
  is fed into `seedActiveRideFromAcceptedOrder` (the call is guarded).
- Result: no crash, no orphaned `bazardrive.active_ride.v1[tripId]`
  entry, no inconsistent state.

## Existing demo / status audit URLs

| URL | Behavior after merge |
|-----|----------------------|
| `#/active-ride?role=driver&tripId=trip_order-demo&status=DRIVER_EN_ROUTE` | If a seeded record exists for that `tripId`, it renders. Otherwise the explicit-`tripId` + valid-`status` branch in `active_ride.js` materializes a non-persisted demo ride with `SIM_AUDIT_RIDE_OVERRIDES` — unchanged from BD-RIDE-D-10. |
| `#/active-ride?role=driver&status=DRIVER_EN_ROUTE` | Falls back to `DEMO_ACTIVE_RIDE_ID`. With no persisted record, the `hasValidStatusQuery` branch materializes the audit demo ride. |
| `#/active-ride?role=driver` | No tripId, no status, no snapshot → `renderDriverEmpty()` ("Нет активного заказа. Откройте ленту и примите заказ."). |
| `#/active-ride?role=passenger` | Passenger renderer untouched. |
| `#/feed`, `#/map`, `#/order-map-draft`, `#/driver-map` | Unaffected. |

## Manual smoke matrix

| # | Steps | Expected | Source-level justification |
|---|-------|----------|----------------------------|
| 1 | Open `#/driver-map` with empty `bazardrive.ride_orders.v1`. | Map placeholder without cluster pins; empty card with "Создать тестовый заказ" CTA. | `renderList()` picks `MAP_VARIANT.EMPTY` + `buildEmptyCard()` when `listNearbyOrders()` is empty. |
| 2 | From the empty state, click "Создать тестовый заказ". | Navigates to `#/order-map-draft`. | `data-action="create-order"` → `go('/order-map-draft')`. |
| 3 | Publish a local order via `/order-map-draft`, then open `#/driver-map`. | The new order appears with pickup / dropoff labels, price and meta line; "Принять" button visible. | `createRideOrder({…, status: 'CREATED'})` → `listNearbyOrders()` returns it; `buildOrderRow` renders pickup/dropoff/price/meta. |
| 4 | Click "Принять" on a live order. | Sheet flips to ACCEPTED card. `bazardrive.ride_orders.v1[order]` is now `ACCEPTED`. `bazardrive.active_ride.v1[trip_<order.id>]` exists. The order disappears from `listNearbyOrders()`. | `acceptNearbyOrder` rewrites the row; `seedActiveRideFromAcceptedOrder` writes the seed; `renderAccepted` swaps the sheet. |
| 5 | Inspect `bazardrive.active_ride.v1[trip_<order.id>]` in DevTools. | Status `DRIVER_EN_ROUTE`; `route.pickupLabel` / `route.dropoffLabel` match the order; `order.offerPrice`, `ride.price`, `order.destinationDistance`, `order.destinationEta`, `route.etaToDestination` populated. | See `seedActiveRideFromAcceptedOrder` override block (`driver_map.js:74-94`). |
| 6 | Click «К поездке». | URL becomes `#/active-ride?role=driver&tripId=trip_<order.id>&status=DRIVER_EN_ROUTE`. | `data-action="active-ride"` handler. |
| 7 | On the resulting ActiveRide screen, confirm the pickup / dropoff / price match the accepted order — *not* the BD-RIDE-F-01 demo or `SIM_AUDIT_RIDE_OVERRIDES`. | Seeded data rendered. | `loadCanonicalActiveRide → findActiveRide(tripId)` returns the persisted seed. |
| 8 | Re-open `#/driver-map` (back-button or tabbar). | Accepted order gone from the live list; map / sheet rebuild via `renderList()`. | `listNearbyOrders()` excludes `ACCEPTED`. |
| 9 | Open `#/active-ride?role=driver` (no tripId, no status). | Empty placeholder ("Нет активного заказа…") with CTA "Открыть ленту". | `renderDriverEmpty()` branch when no persisted record / no snapshot / no explicit tripId. |
| 10 | Open `#/active-ride?role=driver&tripId=trip_order-demo&status=DRIVER_EN_ROUTE`. | Driver sheet renders the demo audit ride. | `hasValidStatusQuery && hasExplicitTripId` branch materializes a non-persisted demo with `SIM_AUDIT_RIDE_OVERRIDES`. |
| 11 | Open `#/active-ride?role=passenger`. | Passenger renderer unchanged. | `role !== 'driver'` early-returns to `renderPassenger()`. |

## Findings

No defects. The handoff is verified.

### Minor observations (no action recommended)

These are informational only — none of them justifies a code change in
a docs-only audit:

1. **Price formatting helper duplication.**
   `seedActiveRideFromAcceptedOrder` inlines the
   `Number(...).toLocaleString('ru-RU') + ' ₽'` formatter rather than
   reusing the existing `formatPrice` helper in the same file. Both
   produce identical output; consolidating them is a cosmetic cleanup
   and not a regression.
2. **`renderDriverEmpty` only fires when `tripId` is absent.**
   If a driver opens `#/active-ride?role=driver&tripId=trip_does_not_exist`
   (no status, no snapshot), the code materializes a non-persisted
   demo ride instead of the empty state. This is the
   BD-RIDE-D-10 "explicit tripId" contract documented in
   `active_ride.js:417-423` and is intentional for audit URLs. It is
   *not* reached from the DriverMap CTA (the CTA always carries
   `status=DRIVER_EN_ROUTE`, and a fresh seed is written before
   navigation), so the user-visible path is unaffected.
3. **Stale-accept routes to `/order-map-draft`.**
   When `acceptNearbyOrder` returns `null`, the screen pushes the
   driver to `/order-map-draft` rather than re-rendering the live
   list. That is the BD-DRIVER-01 design choice (see
   `driver_map.js:342-347` comment) and matches the empty-state CTA.
   No regression.

## Caveats

- This audit covered the *handoff* only. Deeper coverage of the
  driver sheet state machine (`DRIVER_EN_ROUTE → WAITING_PASSENGER →
  IN_PROGRESS → COMPLETED`, plus cancel / NO_SHOW paths) is owned by
  earlier BD-RIDE-D-* audits and was not re-verified here.
- `bazardrive.active_ride.v1` is shared across `tripId`s. A driver
  who accepts multiple orders in sequence will accumulate seeds in
  the same store; `loadCanonicalActiveRide` keys by `tripId`, so each
  CTA resolves to its own record. Pre-existing demo records under
  other keys are unaffected.
- Service worker version was not bumped because no new runtime files
  were added by this audit. `public/sw.js` precache already contains
  `./src/screens/driver_map.js` (line 22).

## Verification

```
$ node scripts/check.mjs
All checks passed.
```

No source files were modified; the audit's only artifact is this
document.
