# BD-MAPBOX-DATA-03 — ActiveRide route snapshot post-merge smoke audit

Post-merge smoke audit for
[issue #253](https://github.com/iprus2026-tech/BazarDriveCloud/issues/253),
following the merge of PR #252
(`BD-MAPBOX-DATA-02 ActiveRide accepted route snapshot contract`,
commit `8e3a947`) into `main`.

The merged contract is documented in
`docs/active-ride-route-snapshot-contract.md`. This audit re-walks the
canonical accept → ActiveRide → completed-history chain on top of
`main` to confirm that nothing regressed and the seven contract fields
still flow through the canonical reader from a single accepted order
into both roles' ActiveRide and into ride history.

Verdict: **no defects.** No code changes required. Docs-only follow-up.

## 1. Scope

Read-only audit of the runtime files that the contract pins down. No
edits to `ride_state.js`, `ride_actions.js`, `ride_history.js`,
`active_ride.js`, `active_ride_passenger.js`, or `mock_api.js`. No
Mapbox SDK, no backend, no `public/sw.js` bump (no runtime files
changed). No CSP changes, no inline script/style, no broad UI work,
no lifecycle state-machine redesign, no payment/auth/push.

## 2. Method

For each primary check the relevant source file is re-read and the
contract is cross-checked against the surface call sites:

- `public/src/ride_state.js` — `getActiveRideRouteSnapshot`,
  `ROUTE_SNAPSHOT_DEFAULTS`, `findActiveRide`, `saveActiveRide`,
  `updateActiveRideStatus`.
- `public/src/ride_actions.js` — `buildRouteSnapshotFromOrder`,
  `seedActiveRideFromAcceptedOrder`, `acceptCanonicalRideOrder`.
- `public/src/ride_history.js` — `pickRoute`, `pickFare`,
  `pickDistance`, `pickDuration`, `nullIfPlaceholder`,
  `buildDriverHistoryEntry`, `buildPassengerHistoryEntry`.
- `public/src/screens/active_ride.js` — driver renderer, completion
  history save, `safeApplyStatusFromQuery`.
- `public/src/screens/active_ride_passenger.js` —
  `applyPassengerStatusFromQuery`, `persistHistory`.
- `public/src/mock_api.js` — `acceptNearbyOrder`,
  `bazardrive.ride_orders.v1` shape.
- `public/src/screens/driver_map.js` — `acceptCanonicalRideOrder`
  hook.
- `public/src/screens/trip_confirmation_handoff.js` —
  `loadCanonicalActiveRide` role-agnostic lookup by tripId.

The smoke URLs from the contract were walked manually against the
hash router (no live map, no backend) and each render was inspected
for the snapshot fields, the terminal-status guards, and the rating
refresh guard.

## 3. Primary checks

### 3.1. Canonical accept seeds with stable route data ✅

`driver_map.js:289` calls
`acceptCanonicalRideOrder(id)` → `acceptNearbyOrder(id)`
(`mock_api.js:484-502`) → `seedActiveRideFromAcceptedOrder(accepted)`
(`ride_actions.js:102-128`). Inside the seeder, every field is
derived once by `buildRouteSnapshotFromOrder` (`ride_actions.js:77-100`)
and the resulting record is keyed by `trip_<order.id>` and persisted
to `bazardrive.active_ride.v1` via `saveActiveRide`.

The seeder is the single writer for the `trip_<order.id>` shape.
`buildRouteSnapshotFromOrder` short-circuits to `null` for any order
without an `id`, so no orphan rows can land in the active-ride store.

### 3.2. Same `tripId` renders consistently for driver and passenger ✅

`loadCanonicalActiveRide({ tripId, role })`
(`trip_confirmation_handoff.js:223-237`) keys purely by `tripId` and
does not filter on the stored role. Both `/active-ride?role=driver`
and `/active-ride?role=passenger` reach `findActiveRide(tripId)` and
reuse the same record, so the seven snapshot fields render
identically on both sides of an accepted order.

`active_ride.js` reads the snapshot fields with defensive optional
chaining (`ride.route?.pickupLabel`, `ride.order?.offerPrice`, …) and
`active_ride_passenger.js` does the same, so neither renderer can
crash on a partially populated snapshot.

### 3.3. Completed driver history keeps route labels ✅

`active_ride.js:567-579` calls `buildDriverHistoryEntry(ride, …)`
on COMPLETED. `buildDriverHistoryEntry`
(`ride_history.js:181-199`) builds `route`, `fare`, `distance`,
`duration` through `pickRoute`, `pickFare`, `pickDistance`,
`pickDuration` — three of which route through
`getActiveRideRouteSnapshot`. `nullIfPlaceholder` (`ride_history.js:107-111`)
strips the `'—'` defaults so a stored entry never lists the
renderer fallback as a real label.

Because the seeder writes `route.pickupLabel`,
`route.dropoffLabel`, `ride.price`, `order.destinationDistance`,
`order.destinationEta` and `timestamps.acceptedAt` directly from the
accepted order, the saved driver history entry preserves the same
human-readable strings that the live screen showed mid-trip.

### 3.4. Completed passenger history keeps route labels + rating refresh ✅

`buildPassengerHistoryEntry` (`ride_history.js:153-179`) uses the same
four `pick*` helpers, so passenger history preserves the same route
labels as the driver side.

The rating-on-refresh guard is unchanged. `persistHistory` in
`active_ride_passenger.js:1213-1241` looks up the previous history
entry for the same `passenger:tripId` key when no explicit rating was
submitted in the current render, and merges the previous
`rating / tags / comment` into the new entry. Submitting a rating in
the current session calls `persistHistory({ withRating: true })` so
the user's input wins on the same page-load. Refreshing the
COMPLETED URL hits the `withRating: false` path, finds the previously
saved entry, and re-saves it with the same feedback — confirmed by
walking the smoke URL chain in step 4.8.

### 3.5. Broken/missing route fields fail safely ✅

The contract's defensive paths are still in place:

- `getActiveRideRouteSnapshot(null)` → all-fallback snapshot (every
  string field defaults to `'—'`, `tripId` / `acceptedAt` to `null`).
- `getActiveRideRouteSnapshot({ route: 'broken' })` → `route` is not
  a plain object, ignored — all-fallback snapshot.
- `getActiveRideRouteSnapshot({ route: { pickupLabel: 42 } })` →
  `pickString` accepts finite numbers and returns `'42'`.
- `buildRouteSnapshotFromOrder(undefined)` → `null`; the seeder
  short-circuits and writes nothing.
- `buildRouteSnapshotFromOrder({ id: 'x', estimatedPrice: 'NaN' })` →
  `priceLabel = '0 ₽'`, distance / ETA → `'—'`.
- `pickRoute({}) / pickFare({}) / pickDistance({}) / pickDuration({})`
  → all `null`, no crash.
- Smoke URL 4.10 in the merged contract still works — injecting
  `{ tripId: 'trip_broken', status: 'DRIVER_EN_ROUTE', route: 'oops' }`
  into `bazardrive.active_ride.v1` and opening
  `/#/active-ride?role=driver&tripId=trip_broken&status=DRIVER_EN_ROUTE`
  renders the snapshot fallbacks with no DevTools throws.

### 3.6. `?status=` does not poison or roll back persisted state ✅

The driver and passenger query guards from BD-ACTIVE-03 / BD-ACTIVE-05
are intact:

- `safeApplyStatusFromQuery` (`active_ride.js:96-127`) refuses to roll
  back when a later timestamp is already set:
  - `?status=NEW_ORDER` is rejected if any later timestamp exists.
  - `?status=DRIVER_EN_ROUTE / DRIVER_APPROACHING_PICKUP` is rejected
    once `arrivedAt / startedAt / completedAt / canceledAt` is set.
  - `?status=WAITING_PASSENGER` is rejected once `startedAt /
    completedAt / canceledAt` is set.
  - `?status=IN_PROGRESS` is rejected once `completedAt / canceledAt`
    is set.
  - `?status=COMPLETED` is rejected if `canceledAt` is set.
  - `?status=CANCELED / NO_SHOW` is rejected if `completedAt` is set.
- `applyPassengerStatusFromQuery`
  (`active_ride_passenger.js:180-217`) mirrors the same monotonic
  ordering and blocks `?status=CANCELED / NO_SHOW` once `completedAt`
  is set (BD-ACTIVE-05).
- All overrides are in-memory only — the path that persists is
  `updateActiveRideStatus` driven by explicit user actions in the
  driver sheets. Opening
  `/#/active-ride?role=driver&tripId=trip_<order-id>&status=COMPLETED`
  on a freshly seeded `DRIVER_EN_ROUTE` ride renders the COMPLETED
  view in memory; the stored row in `bazardrive.active_ride.v1`
  still reports `DRIVER_EN_ROUTE` until the lifecycle is driven
  through the actual sheet buttons.

### 3.7. No out-of-scope changes ✅

`git diff` against `main` is empty for runtime files. This audit only
adds the docs file below.

- No live Mapbox SDK / token / network — unchanged.
- No backend or API — unchanged.
- No CSP weakening (`public/index.html` still has no inline script,
  no `<style>`, no `style=""`, no `on*=""` — verified by
  `scripts/check.mjs`).
- No ActiveRide redesign.
- No lifecycle state-machine redesign.
- No payment / auth / push wiring.
- No broad UI polish.
- `public/sw.js` not bumped (no runtime files changed).

### 3.8. `node scripts/check.mjs` ✅

```
$ node scripts/check.mjs
All checks passed.
```

## 4. Manual smoke walk

Each URL was hash-routed against `public/index.html` with no backend
and no Mapbox SDK. `<order-id>` was substituted with the id observed
in `bazardrive.ride_orders.v1` after publishing a draft order.

1. `/#/driver-map` — empty state, **Создать заказ** CTA visible.
2. `/#/order-map-draft` — picked pickup + dropoff → **Опубликовать** →
   returned to `/#/driver-map` with the new row.
3. `/#/driver-map` — accepted the new row; the accepted card showed
   the published labels and a **К поездке** CTA.
4. `/#/active-ride?role=driver&tripId=trip_<order-id>&status=DRIVER_EN_ROUTE` —
   pickup / dropoff / price / distance / ETA exactly matched the
   published order. No `SIM_AUDIT_RIDE_OVERRIDES` engaged because the
   stored ride existed.
5. `/#/active-ride?role=passenger&tripId=trip_<order-id>` — identical
   route labels and fare to the driver side. Demo driver identity
   inherited from the demo base (the BD-DRIVER-01 mock order carries
   no driver/vehicle fields).
6. Hard-refreshed both URLs — same render, no flicker, no rewrite of
   the stored record.
7. Drove the driver lifecycle — **Я на месте → Начать поездку →
   Завершить** — completion sheet rendered the snapshot summary rows
   and the history badge flipped to `data-history-saved="true"`.
8. `/#/active-ride?role=passenger&tripId=trip_<order-id>&status=COMPLETED` —
   rating widget rendered, submitting a rating persisted, refreshing
   the same URL preserved the rating (BD-ACTIVE-04 refresh guard).
9. `/#/active-ride?role=passenger&tripId=trip_<order-id>&status=CANCELED`
   after step 7 — stayed on the COMPLETED screen because
   `ts.completedAt` blocked the override (BD-ACTIVE-05).
10. `/#/active-ride?role=driver&tripId=trip_<order-id>&status=COMPLETED` —
    rendered the COMPLETED sheet with the snapshot summary rows; the
    driver history entry persisted via `buildDriverHistoryEntry`.
11. Broken-route safety — injected
    `{ 'trip_broken': { tripId: 'trip_broken', status: 'DRIVER_EN_ROUTE', route: 'oops' } }`
    into `bazardrive.active_ride.v1` and opened
    `/#/active-ride?role=driver&tripId=trip_broken&status=DRIVER_EN_ROUTE` —
    rendered with snapshot fallbacks, no DevTools throws.

## 5. Findings

None. The post-merge contract behaves as documented on `main`:

- Same `tripId` resolves to the same snapshot for both roles.
- Completed driver and passenger history rows carry the same route
  labels that the live screen rendered.
- Passenger rating survives a COMPLETED refresh.
- Broken or missing route fields render the em-dash fallbacks with no
  throws.
- `?status=` overrides remain in-memory and respect the terminal
  guards from BD-ACTIVE-03 / BD-ACTIVE-05.

## 6. Follow-ups (informational, out of scope)

Same as the merged contract — none of these are blocking:

- Live Mapbox projection (`route.geometry`, polyline) onto
  `buildRouteSnapshotFromOrder` and a future
  `getActiveRideRouteGeometry` companion.
- Trip-id pill formatter for the passenger header (`№trip_…` is
  functional but long).
- Wire richer passenger / driver identity into
  `seedActiveRideFromAcceptedOrder` once the BD-DRIVER-01 mock order
  carries those fields.

## 7. Verification

```
$ node scripts/check.mjs
All checks passed.
```
