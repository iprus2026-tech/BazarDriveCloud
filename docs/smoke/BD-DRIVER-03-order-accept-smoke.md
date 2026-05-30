# BD-DRIVER-03 — Order accept smoke

Docs-only smoke audit for the DriverMap order accept path.

## Scope

Verified the local mock flow:

1. A passenger-created ride order is stored in `bazardrive.ride_orders.v1` with `status: 'CREATED'`.
2. `/driver-map` lists that order via `listNearbyOrders()`.
3. The driver taps `Принять`.
4. DriverMap delegates to the shared canonical accept helper instead of owning a local seeder.
5. The order flips from `CREATED` to `ACCEPTED` and receives `acceptedAt`.
6. The accepted order disappears from CREATED-only surfaces:
   - `listNearbyOrders()`
   - Feed ride-order projection
   - DriverMap nearby list after returning to the list
7. The accepted order seeds `bazardrive.active_ride.v1` under `trip_<order.id>`.
8. The accepted card CTA opens `/active-ride?role=driver&tripId=<tripId>&status=DRIVER_EN_ROUTE`.
9. Driver ActiveRide resolves the persisted canonical ride before demo/audit fallback.
10. Stale or double accept fails safely and does not create a second active ride seed.

Out of scope: backend, real Mapbox SDK, auth, push, payments, driver assignment, CSP changes, service worker changes, state-machine redesign, passenger ActiveRide redesign.

## Files inspected

| File | What was checked |
| --- | --- |
| `public/src/screens/driver_map.js` | Nearby order list, accept click handler, accepted sheet, active-ride CTA. |
| `public/src/ride_actions.js` | Canonical accept wrapper and accepted-order active-ride seeding. |
| `public/src/mock_api.js` | `createRideOrder`, `listNearbyOrders`, `acceptNearbyOrder`, `getOrderById`, `acceptOrder`, `updateTripStatus`, `rideOrderToFeedPost`. |
| `public/src/screens/active_ride.js` | Driver deep-link read path and persisted canonical ride lookup. |
| `public/src/screens/order_map_draft.js` | Passenger order creation payload and passenger snapshot capture. |
| `public/src/screens/feed.js` | Feed accept path for canonical ride-order projections and refresh on stale accept. |
| `public/src/ride_state.js` | Active ride store key, `saveActiveRide`, `findActiveRide`, demo fallback boundaries. |
| `docs/accepted-order-active-ride-handoff-audit.md` | Prior handoff audit used as baseline for the accept payload pipe. |

## Source-level pipe

### 1. Order creation

`order_map_draft.js` publishes a passenger request through `createRideOrder()` with route, distance, duration, price and a passenger snapshot. The created row is `CREATED` and lands in `bazardrive.ride_orders.v1`.

Important payload fields:

```jsonc
{
  "id": "order-<timestamp>",
  "type": "passenger_request",
  "pickup": { "id": "...", "label": "..." },
  "dropoff": { "id": "...", "label": "..." },
  "distanceKm": 0,
  "durationMin": 0,
  "estimatedPrice": 0,
  "passenger": {
    "name": "...",
    "initials": "...",
    "phoneMasked": "...",
    "comment": "...",
    "authorId": "local-user",
    "isCurrentUser": true
  },
  "status": "CREATED"
}
```

### 2. DriverMap listing

`driver_map.js` calls `listNearbyOrders()`. That helper filters strictly to `status === 'CREATED'`, so only open orders are visible to the driver.

### 3. Accept click

The accept button handler in `driver_map.js` calls:

```js
const result = acceptCanonicalRideOrder(id);
```

This is the correct shared path. There is no duplicated local accept/seeding logic inside DriverMap.

### 4. Store transition

`acceptCanonicalRideOrder(orderId)` delegates the store mutation to `acceptNearbyOrder(orderId)`.

`acceptNearbyOrder()` only rewrites a matching row when the current status is exactly `CREATED`:

```js
if (o && o.id === id && o.status === 'CREATED') {
  updated = {
    ...o,
    status: 'ACCEPTED',
    acceptedAt: new Date().toISOString(),
  };
}
```

If the id is stale, unknown, already accepted, completed or canceled, it returns `null` without persisting a new active ride.

### 5. Active ride seed

After the store transition succeeds, `acceptCanonicalRideOrder()` calls `seedActiveRideFromAcceptedOrder(accepted)`.

The seeded active ride carries:

| Active ride field | Source |
| --- | --- |
| `tripId` | `trip_${order.id}` |
| `role` | `driver` |
| `status` | `DRIVER_EN_ROUTE` |
| `orderId` | `order.id` |
| `route.pickupLabel` | `order.pickup.label` with safe fallback |
| `route.dropoffLabel` | `order.dropoff.label` with safe fallback |
| `order.offerPrice` / `ride.price` | `order.estimatedPrice` formatted as ₽ |
| `order.destinationDistance` | `order.distanceKm` |
| `order.destinationEta` / `route.etaToDestination` | `order.durationMin` |
| `timestamps.acceptedAt` | `order.acceptedAt` |
| `passenger` | sanitized passenger snapshot from the order, or neutral passenger fallback |

`seedActiveRideFromAcceptedOrder()` then writes the ride through `saveActiveRide()`, which stores it under `bazardrive.active_ride.v1[tripId]`.

### 6. Accepted sheet and navigation

DriverMap renders the accepted sheet with the stable `tripId`. The `К поездке` CTA navigates to:

```text
/active-ride?role=driver&tripId=<tripId>&status=DRIVER_EN_ROUTE
```

### 7. Driver ActiveRide read path

`active_ride.js` reads `tripId` from the hash query and calls:

```js
loadCanonicalActiveRide({ tripId, role: 'driver' })
```

That helper checks the persisted active ride first. For an accepted DriverMap order, the persisted seed exists, so the renderer does not need to materialize the SIM/audit demo fallback.

### 8. CREATED-only surfaces after accept

After accept, the same order should no longer appear in:

- `listNearbyOrders()` because it filters to `status === 'CREATED'`.
- Feed's canonical ride-order projection because `rideOrderToFeedPost()` returns `null` for non-`CREATED` orders.
- DriverMap list after returning from the accepted sheet, because `renderList()` re-reads `listNearbyOrders()`.

## Stale / double-accept behavior

The second accept attempt on the same order is safe:

1. First accept changes `CREATED → ACCEPTED` and seeds `trip_<order.id>`.
2. Second accept sees the stored status is no longer `CREATED`.
3. `acceptNearbyOrder()` returns `null`.
4. `acceptCanonicalRideOrder()` returns `null`.
5. DriverMap routes to `/order-map-draft` from a stale row rather than creating an orphan ride.

No code path in this smoke review creates a second active ride from a stale/non-`CREATED` order.

## Relationship to BD-RIDE-ORDER-UNIFY-01

PR #277 added the canonical ride-order spine helpers:

- `getOrderById(id)`
- `acceptOrder(id)`
- `updateTripStatus(id, status)`

The later fix made `CREATED` creation-only and terminal statuses non-reopenable. Current `updateTripStatus()` rejects `status === 'CREATED'` and uses guarded transitions:

```text
CREATED     → ACCEPTED, CANCELED
ACCEPTED    → IN_PROGRESS, COMPLETED, CANCELED
IN_PROGRESS → COMPLETED, CANCELED
COMPLETED   → terminal
CANCELED    → terminal
```

That closes the previous risk where a completed/canceled order could be republished into Feed/DriverMap by writing `CREATED` again.

## Manual smoke script

Use a clean local browser profile or clear only the relevant localStorage keys:

```js
localStorage.removeItem('bazardrive.ride_orders.v1');
localStorage.removeItem('bazardrive.active_ride.v1');
```

Then:

1. Open `/order-map-draft` with a valid route draft, or create a route through the existing map draft flow.
2. Publish the order.
3. Open `/driver-map`.
4. Confirm the order is visible.
5. Click `Принять`.
6. Confirm accepted sheet appears.
7. Click `К поездке`.
8. Confirm URL contains `role=driver`, `tripId=trip_<order.id>`, `status=DRIVER_EN_ROUTE`.
9. Refresh the active ride URL.
10. Confirm pickup, dropoff, fare and passenger data still match the accepted order.
11. Go back to `/driver-map`.
12. Confirm the accepted order no longer appears in nearby orders.
13. Open `/feed`.
14. Confirm the accepted canonical ride-order projection no longer appears as an open passenger card.

Useful URLs:

```text
/order-map-draft
/driver-map
/feed
/active-ride?role=driver&status=DRIVER_EN_ROUTE
/active-ride?role=driver&tripId=<acceptedTripId>&status=DRIVER_EN_ROUTE
```

## Result

No runtime defect found in the source-level smoke audit.

The accept path is already wired through the canonical spine:

```text
DriverMap
→ acceptCanonicalRideOrder(orderId)
→ acceptNearbyOrder(orderId)
→ seedActiveRideFromAcceptedOrder(accepted)
→ saveActiveRide(ride)
→ /active-ride?role=driver&tripId=<tripId>&status=DRIVER_EN_ROUTE
```

The accepted order is removed from open-order surfaces because both DriverMap and Feed project only `CREATED` orders.

## Check status

`node scripts/check.mjs` was not executed in the ChatGPT sandbox because the sandbox could not resolve `github.com` for a fresh clone:

```text
fatal: unable to access 'https://github.com/iprus2026-tech/BazarDriveCloud.git/': Could not resolve host: github.com
```

No runtime source files were modified. GitHub CI should be the source of truth for the final check on the PR.
