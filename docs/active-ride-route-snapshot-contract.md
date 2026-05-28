# BD-MAPBOX-DATA-02 — ActiveRide accepted route snapshot contract

Audit + hardening pass for
[issue #251](https://github.com/iprus2026-tech/BazarDriveCloud/issues/251).

Defines how route data from a canonical accepted order travels into
driver `/active-ride`, passenger `/active-ride` and the completed ride
history. Mock-only — no Mapbox SDK, no token, no network, no backend.
Sets the field-precedence contract that live Mapbox work will project
into without changing call sites.

## 1. Scope

This pass establishes a single canonical reader for the route snapshot
fields and re-routes the completed-history derivation through it. The
two render screens (`active_ride.js`, `active_ride_passenger.js`) are
left untouched — they already read the snapshot fields off the ride
object with defensive optional-chaining, and rewriting them is out of
scope.

Out of scope and intentionally untouched: live Mapbox SDK, backend,
auth, payments, push, CSP, inline script/style, the
`ride_state.js` lifecycle state machine, the rating refresh logic in
`active_ride_passenger.js`, the passenger terminal query guards
(`?status=CANCELED|NO_SHOW` blocked when `completedAt` is set).

## 2. Contract — fields, types, fallbacks

The snapshot is the strict subset of the active-ride object that
describes "where this trip goes, what it costs, when it was
accepted". All seven fields are strings (or `null` for `tripId` /
`acceptedAt` when the source ride has none). Every value is resolved
through the same `pickString` pipeline so a missing field, a non-string
value, or a numeric zero never throws.

| Field           | Type        | Source on the ride object                                                                       | Fallback             |
|-----------------|-------------|--------------------------------------------------------------------------------------------------|-----------------------|
| `tripId`        | string?     | `ride.tripId`                                                                                    | `null`                |
| `pickupLabel`   | string      | `ride.route.pickupLabel`                                                                         | `'—'`                 |
| `dropoffLabel`  | string      | `ride.route.dropoffLabel`                                                                        | `'—'`                 |
| `priceLabel`    | string      | `ride.ride.price` → `ride.order.offerPrice`                                                      | `'—'`                 |
| `distanceLabel` | string      | `ride.ride.distance` → `ride.order.destinationDistance`                                          | `'—'`                 |
| `etaLabel`      | string      | `ride.route.etaToDestination` → `ride.ride.duration` → `ride.order.destinationEta`               | `'—'`                 |
| `acceptedAt`    | string?     | `ride.timestamps.acceptedAt`                                                                     | `null`                |

The `'—'` placeholder for missing-but-mandatory string fields is
exposed via `ROUTE_SNAPSHOT_DEFAULTS` for callers that want to
distinguish "renderer fallback" from "real value".

`getActiveRideRouteSnapshot(ride)` is the single canonical reader. It
accepts any input — `null`, `undefined`, a partial object, a fully
formed ride — and always returns a snapshot with every field populated.

## 3. Producers and consumers

```
                    ┌────────────────────────────────┐
                    │ mock_api.js                    │
                    │   listNearbyOrders()           │
                    │   acceptNearbyOrder()  ── ACCEPTED row written
                    └───────────────┬────────────────┘
                                    │
                                    ▼
                    ┌────────────────────────────────┐
                    │ ride_actions.js                │
                    │   buildRouteSnapshotFromOrder()│   ◄── BD-MAPBOX-DATA-02 split out
                    │   seedActiveRideFromAcceptedOrder()
                    │   acceptCanonicalRideOrder()   │
                    └───────────────┬────────────────┘
                                    │
                                    │  saveActiveRide → bazardrive.active_ride.v1
                                    ▼
              ┌────────────────────────────────────────────┐
              │ ride_state.js                              │
              │   findActiveRide / saveActiveRide          │
              │   getActiveRideRouteSnapshot()  ◄── canonical reader
              │   ROUTE_SNAPSHOT_DEFAULTS                  │
              └─────────────┬────────────────┬─────────────┘
                            │                │
              ┌─────────────▼──┐         ┌───▼──────────────┐
              │ screens/        │         │ ride_history.js  │
              │ active_ride.js  │         │   pickRoute()    │  ◄── now routes through
              │ active_ride_    │         │   pickFare()     │      getActiveRideRouteSnapshot
              │ passenger.js    │         │   pickDistance() │
              └─────────────────┘         └──────────────────┘
                                                  │
                                                  │  saveRideHistoryEntry →
                                                  ▼  bazardrive.ride_history.v1
                                          ┌──────────────────┐
                                          │ Profile / history│
                                          │ surfaces (TBD)   │
                                          └──────────────────┘
```

## 4. Audit findings (the five "Check" items from the issue)

### 4.1. Canonical accept seeds with stable route data

A driver tapping **Принять** on `/driver-map` calls
`acceptCanonicalRideOrder` (`ride_actions.js:139`). That helper:

1. flips the order to `ACCEPTED` in `bazardrive.ride_orders.v1`
   (`mock_api.js:acceptNearbyOrder`),
2. derives the snapshot fields once via
   `buildRouteSnapshotFromOrder(order)` (extracted in this pass), and
3. persists a ride record under
   `bazardrive.active_ride.v1[trip_<order.id>]` with those fields
   written into `route.pickupLabel / dropoffLabel`,
   `order.offerPrice / destinationDistance / destinationEta`,
   `ride.price`, `route.etaToDestination`, and
   `timestamps.acceptedAt`.

`buildRouteSnapshotFromOrder` is pure, returns `null` for orders
without an `id`, and is the only producer of the
`trip_<order.id>` shape — keeping the single-writer property of the
canonical seed. The seeder is now a thin wrapper around it.

### 4.2. Same `tripId` renders consistently for driver and passenger

`loadCanonicalActiveRide({ tripId, role })`
(`trip_confirmation_handoff.js:223`) keys purely by `tripId` and does
**not** filter on the stored `role`. Both `/active-ride?role=driver`
and `/active-ride?role=passenger` hit `findActiveRide(tripId)` first
and reuse the same record, so the snapshot is identical on both sides
of any accepted order.

The driver and passenger renderers read the snapshot fields directly
off the ride object (`ride.route?.pickupLabel`, `ride.order?.offerPrice`,
…) with `|| ''` / `|| fallback-string` defenses. No additional edit is
required to keep them in sync.

### 4.3. Completed ride history preserves route labels

`ride_history.js` `pickRoute / pickFare / pickDistance` now route
through `getActiveRideRouteSnapshot(ride)`. The em-dash placeholder
from the snapshot defaults is filtered out via `nullIfPlaceholder`
before being persisted, so a history entry carries either a real
label or `null` — never the renderer's fallback string. `pickDuration`
keeps its original precedence (`ride.duration → order.destinationEta`)
because history wants the elapsed trip duration, not the live
"remaining ETA" the snapshot reports for mid-trip rendering.

This change is observably backwards-compatible for the happy path:
when the ride object carries `route.pickupLabel`, `ride.price`,
`order.destinationDistance`, etc., the snapshot returns those exact
strings unchanged, and the history entry matches what
`saveRideHistoryEntry` would have produced before this pass.

### 4.4. Broken / missing route fields do not crash

Every input path tolerates broken/missing data:

- `getActiveRideRouteSnapshot(null)` → all-fallback snapshot, no
  throws.
- `getActiveRideRouteSnapshot({ route: 'broken' })` → all-fallback,
  `route` is not a plain object so it's ignored.
- `getActiveRideRouteSnapshot({ route: { pickupLabel: 42 } })` →
  `'42'` (numbers coerced) or fallback for non-finite numbers.
- `buildRouteSnapshotFromOrder(undefined)` → `null` (seeder
  short-circuits, no orphan write).
- `buildRouteSnapshotFromOrder({ pickup: null, dropoff: {} })` →
  uses the Russian "Точка подачи / Точка назначения" fallbacks.
- `buildRouteSnapshotFromOrder({ id: 'x', estimatedPrice: 'NaN' })` →
  `'0 ₽'` (`Number(...) || 0`), distance / ETA fall to `'—'`.
- `pickRoute({}) / pickFare({}) / pickDistance({}) / pickDuration({})`
  → all `null`, no crash.
- Map shell already normalizes route defensively
  (`mapbox/map_shell.js:normalizeRoute`).
- The two render screens use optional chaining (`ride.route?.x`) and
  `(ride.route && ride.route.x) || fallback` everywhere — already
  crash-safe; this pass does not touch them.

### 4.5. Passenger rating refresh + terminal query guards remain intact

This pass does not touch `active_ride_passenger.js`. The two
behaviors flagged in the issue stay as they were:

- **Rating refresh.** `persistHistory()` in the COMPLETED renderer
  looks up the previous history entry when re-rendering without an
  explicit submit, so the passenger's submitted rating / tags /
  comment survive a refresh (`active_ride_passenger.js:1213-1242`).
- **Terminal query guard.** `applyPassengerStatusFromQuery` refuses
  to roll a persisted `COMPLETED` back to `CANCELED` / `NO_SHOW`
  when `ts.completedAt` is set (`active_ride_passenger.js:211-215`),
  mirroring the driver guard at `active_ride.js:122-124`.

## 5. localStorage keys involved

| Key                                 | Owner                              | This contract |
|-------------------------------------|------------------------------------|---------------|
| `bazardrive.ride_orders.v1`         | `mock_api.js`                      | Source of the accepted order. Snapshot reads `pickup.label`, `dropoff.label`, `distanceKm`, `durationMin`, `estimatedPrice`, `acceptedAt`. |
| `bazardrive.active_ride.v1`         | `ride_state.js`                    | Destination of the seeded snapshot. Both roles read from here keyed by `tripId`. |
| `bazardrive.ride_history.v1`        | `ride_history.js`                  | Serialized snapshot lives on the completed entry under `route`, `fare`, `distance`, `duration`. |
| `bazardrive.driver_handoff_snapshot.v1` | `screens/driver_handoff_snapshot.js` | Independent BD-HANDOFF-05 record. Only consulted when no canonical active ride exists. Not part of this contract. |
| `bazardrive.trip_confirmation.v1`   | `screens/trip_confirmation_handoff.js` | Same — out-of-band handoff, not part of this contract. |

## 6. Manual smoke URLs

All URLs are hash-routed against `public/index.html`. No backend, no
Mapbox SDK required. Substitute the literal `<order-id>` you observe
in `bazardrive.ride_orders.v1` after step 2.

1. Driver map, empty: `/#/driver-map`
2. Publish a passenger order: `/#/order-map-draft` → pick pickup &
   dropoff → **Опубликовать**. Returns to `/#/driver-map` with the
   new row.
3. Accept the order on driver map. CTA reads **К поездке**.
4. Driver active ride: `/#/active-ride?role=driver&tripId=trip_<order-id>&status=DRIVER_EN_ROUTE`
   — pickup / dropoff / price / distance / ETA from the published
   order, no `SIM_AUDIT_RIDE_OVERRIDES`.
5. Passenger active ride, same trip: `/#/active-ride?role=passenger&tripId=trip_<order-id>`
   — same route labels and fare, demo driver identity (no live data
   to project yet).
6. Hard-refresh either URL — same render, no flicker, no rewrite.
7. Drive the lifecycle on the driver side ("Я на месте" →
   "Начать поездку" → "Завершить") — completed sheet renders with
   the snapshot fields and history badge flips to `data-history-saved="true"`.
8. Back-to-back on the passenger side: open `/#/active-ride?role=passenger&status=COMPLETED&tripId=trip_<order-id>`
   — rating widget renders, submitting a rating persists, refreshing
   the same URL preserves the rating (BD-ACTIVE-04 refresh guard).
9. Terminal guard: open `/#/active-ride?role=passenger&status=CANCELED&tripId=trip_<order-id>`
   AFTER step 7. Stays on the COMPLETED screen because `ts.completedAt`
   blocks the override.
10. Broken-route safety: in DevTools, run
    `localStorage.setItem('bazardrive.active_ride.v1', JSON.stringify({ 'trip_broken': { tripId: 'trip_broken', status: 'DRIVER_EN_ROUTE', route: 'oops' } }))`
    and open `/#/active-ride?role=driver&tripId=trip_broken&status=DRIVER_EN_ROUTE`.
    Screen renders with the snapshot fallbacks; no throws in the
    DevTools console.

## 7. Verification

```
$ node scripts/check.mjs
All checks passed.
```

## 8. Follow-ups (informational)

These are out of scope for BD-MAPBOX-DATA-02 but the right place to
land them once the relevant work begins:

- **Live Mapbox project.** When `route.geometry`, real
  pickup/dropoff coordinates, and a route polyline arrive, project
  them onto the snapshot via `buildRouteSnapshotFromOrder` (for the
  accept path) and via a `getActiveRideRouteGeometry` companion (for
  the live-trip path). Render screens still read the seven snapshot
  fields verbatim.
- **Distinct demo trip-pill formatting.** `№trip_order-1700000000000`
  is functional but long. A trip-id formatter on the passenger pill
  (`active_ride_passenger.js:formatTripNumber`) would be the right
  place; not blocking for this contract.
- **Richer passenger / driver identity on accepted seeds.** Today the
  `passenger.*`, `driver.*`, `vehicle.*`, `payment.*` fields are
  inherited from the demo base because the BD-DRIVER-01 mock order
  has no such fields. Wire-through happens in
  `seedActiveRideFromAcceptedOrder` once real identity data exists.
