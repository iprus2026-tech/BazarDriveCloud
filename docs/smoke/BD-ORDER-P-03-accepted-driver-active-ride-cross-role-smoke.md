# BD-ORDER-P-03 — Accepted-driver ActiveRide cross-role smoke

## Scope

Docs-only smoke audit for the accepted passenger-order handoff after a driver takes an order from `/driver-map`.

Checked that the flow keeps one canonical active-ride record for both roles:

- accepted passenger order starts as `CREATED` and moves to `ACCEPTED` only through the canonical helper;
- driver active ride opens with the accepted-order `tripId`;
- passenger active ride opens with the same `tripId`;
- `trip_<order.id>` is the shared canonical key in `bazardrive.active_ride.v1`;
- passenger view does not create a second active ride seed for an already persisted trip;
- persisted records win over SIM/demo fallback, so a valid `tripId` does not render demo data;
- pickup, dropoff, fare, distance/ETA and lifecycle status stay aligned between driver and passenger views because both read the same record.

Out of scope: backend, auth, push, payments, real Mapbox, CSP, service worker bumps, state-machine changes, and runtime rewrites.

## Files inspected

| File | What was checked |
| --- | --- |
| `public/src/screens/order_map_draft.js` | `/order-map-draft` publish path and payload passed to `createRideOrder()` with pickup, dropoff, distance, duration, price and passenger snapshot. |
| `public/src/screens/driver_map.js` | `/driver-map` list source, accept handler, accepted-state sheet, and driver active-ride CTA URL. |
| `public/src/ride_actions.js` | Canonical accepted-order pipe: `acceptCanonicalRideOrder()`, `seedActiveRideFromAcceptedOrder()`, `trip_<order.id>` derivation, route/fare/ETA projection, and `saveActiveRide()` write. |
| `public/src/mock_api.js` | `bazardrive.ride_orders.v1` storage, `createRideOrder()` `CREATED` rows, `listNearbyOrders()` open-order filter, `acceptNearbyOrder()` `CREATED → ACCEPTED`, latest passenger handoff trip lookup, and Feed projection filtering. |
| `public/src/ride_state.js` | `bazardrive.active_ride.v1` key, `RIDE_STATUS.DRIVER_EN_ROUTE`, `findActiveRide()` read without write, and `saveActiveRide()` keyed write. |
| `public/src/screens/active_ride.js` | Driver read path: `loadCanonicalActiveRide({ tripId, role: 'driver' })` before driver snapshot / SIM fallback; `status=DRIVER_EN_ROUTE` query is applied in-memory only. |
| `public/src/screens/active_ride_passenger.js` | Passenger read path: `loadCanonicalActiveRide({ tripId, role: 'passenger' })`; fallback is view-only and does not persist; `DRIVER_EN_ROUTE` is accepted by the passenger status query helper. |
| `public/src/screens/trip_confirmation_handoff.js` | Shared canonical loader: persisted active ride wins before role-specific handoff seeding and before cross-role handoff seeding. |
| `public/src/screens/driver_handoff_snapshot.js` | `bazardrive.driver_handoff_snapshot.v1` key and fallback-only snapshot semantics used when no canonical active ride exists. |
| `public/src/screens/feed.js` | Feed accept path uses `acceptCanonicalRideOrder()` for canonical ride-order cards and refreshes stale cards. |
| `public/sw.js` | No runtime files changed, so no service worker bump was required. |
| `docs/smoke/BD-DRIVER-03-order-accept-smoke.md` | Existing DriverMap accept smoke used as the baseline for the single-role accept path. |
| `docs/accepted-order-active-ride-handoff-audit.md` | Existing accepted-order handoff audit used as the baseline for the accepted-order active-ride seed. |

## Source-level pipe

The audited pipe is:

```text
order_map_draft
→ createRideOrder
→ driver_map
→ acceptCanonicalRideOrder
→ acceptNearbyOrder
→ seedActiveRideFromAcceptedOrder
→ saveActiveRide
→ driver active ride
→ passenger active ride
```

Source-level checks:

1. `/order-map-draft` publishes a passenger ride order via `publishOrder(draft)`, which calls `createRideOrder()` with route labels, distance, duration, price, schedule, comment and a passenger snapshot.
2. `createRideOrder()` writes the row to `bazardrive.ride_orders.v1` with `status: 'CREATED'`.
3. `/driver-map` calls `listNearbyOrders()` each time it renders the nearby list.
4. `listNearbyOrders()` returns only rows with `status === 'CREATED'`.
5. The DriverMap accept click handler calls `acceptCanonicalRideOrder(id)` directly. It does not own a local seeder.
6. `acceptCanonicalRideOrder(orderId)` calls `acceptNearbyOrder(orderId)`.
7. `acceptNearbyOrder()` mutates only a matching `CREATED` row, stamps `acceptedAt`, persists `status: 'ACCEPTED'`, and returns `null` for unknown, stale or already accepted ids.
8. On success, `acceptCanonicalRideOrder()` calls `seedActiveRideFromAcceptedOrder(accepted)`.
9. `seedActiveRideFromAcceptedOrder()` derives `tripId = trip_<order.id>`, projects pickup, dropoff, fare, distance and ETA from the accepted order, sets `status: DRIVER_EN_ROUTE`, pins `orderId`, and saves via `saveActiveRide(ride)`.
10. `saveActiveRide()` writes the record into `bazardrive.active_ride.v1` under `store[ride.tripId]`.
11. Driver ActiveRide reads `/active-ride?role=driver&tripId=<tripId>&status=DRIVER_EN_ROUTE`, resolves `tripId`, then calls `loadCanonicalActiveRide({ tripId, role: 'driver' })` before any driver snapshot / SIM fallback.
12. Passenger ActiveRide reads `/active-ride?role=passenger&tripId=<tripId>`, calls `loadCanonicalActiveRide({ tripId, role: 'passenger' })`, and receives the same stored record because the loader checks `findActiveRide(tripId)` before any role-specific seed.
13. The passenger branch only falls back to `createDemoActiveRide()` when no canonical record exists, and that fallback is explicitly view-only.
14. Accepted orders disappear from `/driver-map` and `/feed` because both nearby orders and Feed ride-order projections are `CREATED`-only.
15. Unknown or stale `tripId` falls through the existing fallback paths without writing an orphan accepted-order active ride; `findActiveRide()` is read-only and the accepted-order seeder short-circuits without a valid order id.

## localStorage keys

| Key | Owner / path | Role in this smoke |
| --- | --- | --- |
| `bazardrive.ride_orders.v1` | `public/src/mock_api.js` | Canonical passenger-order store. `createRideOrder()` inserts `CREATED`; `acceptNearbyOrder()` flips the row to `ACCEPTED`; `listNearbyOrders()` and Feed projections show only `CREATED` rows. |
| `bazardrive.active_ride.v1` | `public/src/ride_state.js` | Canonical active-ride map. `saveActiveRide()` writes `store[trip_<order.id>]`; both driver and passenger active-ride routes read this same key through `loadCanonicalActiveRide()`. |
| `bazardrive.trip_confirmation.v1` | `public/src/screens/trip_confirmation_handoff.js` | Confirmed-handoff fallback source. It is not the producer for this accepted-driver path because the persisted active ride exists and wins first. |
| `bazardrive.driver_handoff_snapshot.v1` | `public/src/screens/driver_handoff_snapshot.js` | Driver snapshot fallback source. It is only consulted when no canonical active ride exists for the `tripId`; it is not used when the accepted-order seed is present. |

## Cross-role invariant

Main invariant for BD-ORDER-P-03:

```text
trip_<order.id>
→ bazardrive.active_ride.v1[tripId]
→ driver /active-ride reads same record
→ passenger /active-ride reads same record
```

The invariant holds at source level because:

- `buildRouteSnapshotFromOrder()` derives `tripId` exactly as `` `trip_${order.id}` ``;
- `seedActiveRideFromAcceptedOrder()` passes that `tripId` into the active ride payload;
- `saveActiveRide()` stores by `ride.tripId`;
- `loadCanonicalActiveRide()` checks `findActiveRide(tripId)` before any role-aware fallback;
- neither the driver nor passenger read path filters the persisted active ride by `role`.

## Driver read path

Driver deep-link:

```text
/active-ride?role=driver&tripId=<tripId>&status=DRIVER_EN_ROUTE
```

Driver source path:

1. `activeRide()` parses `role`, `tripId` and `status` from the hash query.
2. For `role=driver`, it calls `loadCanonicalActiveRide({ tripId, role: 'driver' })`.
3. `loadCanonicalActiveRide()` calls `findActiveRide(tripId)` first.
4. For an accepted DriverMap order, the record already exists in `bazardrive.active_ride.v1[tripId]`, so the existing ride is returned as-is.
5. The driver fallback branch (`loadDriverHandoffSnapshot()`, `SIM_AUDIT_RIDE_OVERRIDES`, `createDemoActiveRide()`, or empty state) is skipped when the persisted record exists.
6. `safeApplyStatusFromQuery()` may derive an in-memory display status from `status=DRIVER_EN_ROUTE`, but it does not persist that query override and does not rewrite the canonical active ride.

## Passenger read path

Passenger deep-link:

```text
/active-ride?role=passenger&tripId=<tripId>
```

Passenger source path:

1. The top-level ActiveRide router delegates non-driver roles to the passenger renderer with the same explicit `tripId`.
2. `loadPassengerRideView(tripId, statusQuery)` calls `loadCanonicalActiveRide({ tripId, role: 'passenger' })` first.
3. `loadCanonicalActiveRide()` does not filter a persisted record by `role`; it returns `findActiveRide(tripId)` before any role-specific handoff seed.
4. Because the accepted-driver path already wrote `bazardrive.active_ride.v1[tripId]`, the passenger branch reads the same record as the driver branch.
5. The passenger branch does not call `seedActiveRideFromAcceptedOrder()` and does not write a second accepted-order seed.
6. The SIM/demo branch is reached only when no canonical record exists. That fallback is in-memory/view-only and does not poison `bazardrive.active_ride.v1`.
7. Passenger-supported status query handling includes `DRIVER_EN_ROUTE` and `DRIVER_APPROACHING_PICKUP`; the `DRIVER_EN_ROUTE` query does not break the persisted lifecycle and does not roll terminal rides backward.

## Manual smoke script

1. Clear only relevant keys:

   ```js
   localStorage.removeItem('bazardrive.ride_orders.v1');
   localStorage.removeItem('bazardrive.active_ride.v1');
   ```

2. Open `/order-map-draft`.
3. Publish passenger order.
4. Open `/driver-map`.
5. Confirm order is visible.
6. Click `Принять`.
7. Capture `tripId` from the accepted sheet / active-ride CTA. It must be `trip_<order.id>`.
8. Open:

   ```text
   /active-ride?role=driver&tripId=<tripId>&status=DRIVER_EN_ROUTE
   ```

9. Confirm route, price, status, distance and ETA match the accepted order.
10. Open:

    ```text
    /active-ride?role=passenger&tripId=<tripId>
    ```

11. Confirm the same route, price, status, distance and ETA are shown.
12. Refresh passenger URL.
13. Confirm the same persisted data remains and no demo passenger/route replaces it.
14. Return to `/driver-map` and `/feed`.
15. Confirm the accepted order is not listed as an open order.

## Useful URLs

- `/order-map-draft`
- `/driver-map`
- `/feed`
- `/active-ride?role=driver&tripId=<tripId>&status=DRIVER_EN_ROUTE`
- `/active-ride?role=passenger&tripId=<tripId>`

## Result

No runtime defect found.

The source-level cross-role invariant is satisfied: the driver accept path creates one canonical active ride at `bazardrive.active_ride.v1[trip_<order.id>]`; both driver and passenger ActiveRide readers prefer that persisted record before any fallback; passenger rendering is read-first and does not create a second accepted-order seed.

No runtime files were changed, so no service worker bump was needed.

## Check status

`node scripts/check.mjs` passed.
