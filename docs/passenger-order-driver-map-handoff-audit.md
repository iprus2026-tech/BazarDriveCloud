# BD-MAP-06 — Passenger order → DriverMap handoff smoke audit

Smoke audit of the handoff between a passenger-created **map order** and
the **driver map** flow, per issue #290. The goal is not to add a real
Mapbox SDK or a backend — it is to verify that one order record can move
through passenger creation → driver discovery → driver acceptance →
shared `/active-ride` state, and to apply the minimal fix needed to close
the loop on the passenger side.

## Result

The data spine was found **healthy**: the passenger order is created with
a stable id, surfaces in `/driver-map`, is accepted by the driver, seeds
a shared `bazardrive.active_ride.v1` record (`trip_<orderId>`,
`DRIVER_EN_ROUTE`, `orderId`-linked), and terminal statuses cannot be
reopened.

One gap was found and fixed: the passenger's `/active-ride?role=passenger`
(with no explicit `tripId` in the URL) **always** fell back to the demo
ride, so after a driver accepted the passenger's real order, the
passenger still saw the demo Шереметьево trip instead of their own
handed-off ride — even though the shared canonical record already
existed. The fix resolves the passenger's latest driver-taken order so
the screen lands on the real trip, with the demo kept as a fallback.

## Flow verified

```text
Passenger
  /route-picker → /route-preview → /order-map-draft
      ↓ createRideOrder()  → bazardrive.ride_orders.v1, status CREATED, stable id
  /responses?orderId=…           ("Ищем водителей" — waiting for driver)

Shared record
  order.id                       stable (order-<ts>)
  pickup → dropoff               preserved verbatim
  status: CREATED → ACCEPTED     (ride_orders.v1)
  active_ride.v1[trip_<id>]      status DRIVER_EN_ROUTE, orderId = order.id

Driver  (role=driver)
  /driver-map                    listNearbyOrders() → CREATED orders
      ↓ acceptCanonicalRideOrder(id)
        acceptNearbyOrder()      CREATED → ACCEPTED (+ acceptedAt)
        seedActiveRideFromAcceptedOrder()  → trip_<id>, DRIVER_EN_ROUTE
  /active-ride?role=driver&tripId=trip_<id>&status=DRIVER_EN_ROUTE

Passenger after acceptance
  /active-ride?role=passenger    → resolves latest handed-off order →
                                   trip_<id> (real ride), "Водитель едет к вам"
```

## Change made

Minimal, additive, defensive — no screen rewrites:

| File | Change |
|------|--------|
| `public/src/mock_api.js` | New `findLatestHandedOffOrderTripId()` spine helper: returns `trip_<orderId>` for the most recent order in `ACCEPTED` / `IN_PROGRESS` **whose canonical `active_ride.v1` record is still live**, else `null`. The order status alone is insufficient — a ride order can sit at `ACCEPTED` while its active-ride record has moved to a terminal status; the helper cross-checks `findActiveRide(tripId)` and skips missing or terminal (`COMPLETED` / `CANCELED` / `NO_SHOW`) records so the passenger entry can never reopen a stale, finished trip. |
| `public/src/screens/active_ride.js` | `renderPassenger()` now uses `query.get('tripId') || findLatestHandedOffOrderTripId() || DEMO_ACTIVE_RIDE_ID`, so a tripless passenger entry lands on the real handed-off trip when one exists, demo otherwise. |

Behavior preserved:

- Explicit `?tripId=` in the URL still wins (sim / audit links unchanged).
- `?status=`, `?phase=`, `?payment=` overrides pass through untouched.
- With no accepted order, the demo ride still renders (no regression for
  the existing inbox / simulation URLs).
- Driver `/active-ride?role=driver` path is unchanged.

## Smoke-test report

Executed the real modules under a `localStorage` polyfill (no DOM), driving
the full chain through `mock_api.js`, `ride_actions.js`, `ride_state.js`.

Spine (17 assertions, all pass):

- order created with stable id, status `CREATED`;
- order appears in `listNearbyOrders()`;
- `acceptCanonicalRideOrder()` flips `CREATED → ACCEPTED`, seeds
  `DRIVER_EN_ROUTE`, returns `trip_<id>`, links `ride.orderId`;
- passenger snapshot preserved (no demo "Анна М." leak), pickup/dropoff
  preserved;
- accepted order drops out of `listNearbyOrders()`;
- double-accept returns `null` (stale-safe);
- persisted record converges for both roles via `findActiveRide`;
- `COMPLETED → ACCEPTED` reopen rejected; order stays `COMPLETED`.

Passenger resolution (9 assertions, all pass):

- `null` before any handoff and while the order is still `CREATED`;
- after accept, resolver returns `trip_<orderId>` matching the seeded
  active-ride tripId;
- that record carries the real route (not demo) and `DRIVER_EN_ROUTE`;
- newest handed-off order wins when several exist;
- a `COMPLETED` order is no longer treated as the live default.

`node scripts/check.mjs` → **All checks passed.**

## Acceptance checklist

- [x] `/order-map-draft` creates a ride/order record with stable id.
- [x] Created order is visible in `/driver-map`.
- [x] Driver can accept the order.
- [x] `CREATED → ACCEPTED` / `DRIVER_EN_ROUTE` transition is valid.
- [x] Passenger active ride shows correct driver found / driver en route
      state (now the real handed-off trip, demo as fallback).
- [x] Driver active ride still works.
- [x] Terminal statuses cannot be reopened.
- [x] No backend added.
- [x] No real Mapbox SDK added.
- [x] No CSP weakening.
- [x] No inline script/style.
- [x] `node scripts/check.mjs` passes.

## Out of scope (untouched)

Backend API, real Mapbox integration, auth, push, payments, APK/Android,
and any rewrite of `active_ride.js` / `active_ride_passenger.js`. Both
modified files are already in the service-worker precache, so `sw.js` was
not changed.

## Manual smoke-test URLs

```text
/route-picker
/route-preview
/order-map-draft
/driver-map
/active-ride?role=passenger
/active-ride?role=passenger&status=DRIVER_EN_ROUTE
/active-ride?role=driver
/active-ride?role=driver&status=DRIVER_EN_ROUTE
```
