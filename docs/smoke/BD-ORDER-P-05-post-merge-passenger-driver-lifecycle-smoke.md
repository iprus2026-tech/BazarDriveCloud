# BD-ORDER-P-05 — Post-merge passenger-driver lifecycle smoke

Date: 2026-05-31  
Repo: `iprus2026-tech/BazarDriveCloud`  
Requested branch: `main`  
Local branch available in this container: `work`  
Baseline commit inspected: `ab56eda BD-ORDER-P-04: add ACCEPTED lifecycle state and stabilize passenger→driver handoff (#310)`

## PASS/FAIL summary

**PASS — no lifecycle regression found.**

The post-merge smoke audit confirms the passenger-created order → driver acceptance → shared active ride handoff uses the canonical `trip_<orderId>` id, enters the shared active ride at `ACCEPTED`, advances through the expected driver/passenger lifecycle, and keeps terminal rides out of DriverMap, Feed, and passenger no-`tripId` lookup.

Environment note: `git checkout main` / `git pull origin main` could not be completed because this container has only the local `work` branch and no configured remote. The local HEAD is already the PR #310 merge commit requested for this smoke audit.

## Exact smoke path tested

### Start commands

```text
$ git status --short --branch && git checkout main && git pull origin main
## work
error: pathspec 'main' did not match any file(s) known to git

$ git log --oneline -5
ab56eda BD-ORDER-P-04: add ACCEPTED lifecycle state and stabilize passenger→driver handoff (#310)
e2de883 BD-ORDER-P-04 responses post-merge smoke audit (#309)
1d72738 Responses: safe fallback, realistic offers and safe selected-driver handoff (#308)
acf8c69 BD-ORDER-P-03 accepted-driver active ride cross-role smoke (#307)
bd9ac65 BD-ORDER-P-02: Polish passenger responses flow (#306)

$ node scripts/check.mjs
All checks passed.
```

### Smoke execution

Because this is a static mock/PWA repo with no backend and no real Mapbox dependency, the lifecycle was verified through:

1. Source inspection of route registration, role guards, order creation, response handoff, DriverMap acceptance, active ride status application, passenger active ride rendering, and service-worker precache coverage.
2. A Node ESM storage-level smoke using a mock `localStorage` to create a passenger order, accept it as a driver, assert canonical `trip_<orderId>` active-ride seeding, advance the lifecycle to terminal states, and assert terminal trips are skipped by passenger no-`tripId` lookup and Feed/DriverMap projections.

Storage smoke output:

```text
created order-1780252090345 CREATED
nearbyBefore order-1780252090345:CREATED
feedBefore order-1780252090345:CREATED
accepted trip_order-1780252090345 ACCEPTED ACCEPTED order-1780252090345
nearbyAfter 0
feedAfter 0
fallbackLive trip_order-1780252090345
status DRIVER_EN_ROUTE
status WAITING_PASSENGER
status IN_PROGRESS
status COMPLETED
fallbackCompleted null
terminalCanceled CANCELED null
terminalNoShow NO_SHOW null
```

## Lifecycle matrix

| Step | Trigger | Expected source status | Expected active ride status | Result |
| --- | --- | --- | --- | --- |
| Passenger publishes order | `/order-map-draft` publish | `CREATED` | none yet | PASS |
| Driver accepts order | DriverMap accept action | `CREATED → ACCEPTED` | `ACCEPTED` | PASS |
| Driver starts moving | Driver active ride primary CTA | `ACCEPTED` | `ACCEPTED → DRIVER_EN_ROUTE` | PASS |
| Driver arrives | Driver active ride CTA | accepted order remains non-feed | `DRIVER_EN_ROUTE → WAITING_PASSENGER` | PASS |
| Passenger boards / trip starts | Driver active ride CTA | accepted order remains non-feed | `WAITING_PASSENGER → IN_PROGRESS` | PASS |
| Driver completes trip | Driver active ride CTA | terminal/non-feed | `IN_PROGRESS → COMPLETED` | PASS |
| Terminal cancellation | Driver/passenger cancel/no-show flows | terminal/non-feed | `CANCELED` / `NO_SHOW` | PASS |

## Passenger order creation result

**PASS.**

- `/order-map-draft` is registered through the handoff wrapper, so the published-order success flow gets the passenger responses handoff behavior.
- Publishing creates a canonical ride order with status `CREATED`, persisted in the shared ride-order store.
- The success CTA routes passengers to `/responses?orderId=<orderId>&state=empty`.
- The handoff wrapper localizes the success subtitle from raw `CREATED` to passenger-facing `Опубликован` and binds the response CTA to the latest open order.

## Responses handoff result

**PASS.**

- `/responses?orderId=<orderId>&state=empty` resolves the canonical order when the id exists, and falls back to a safe request surface when the id is missing or unknown.
- Selecting/continuing a driver uses canonical `trip_<orderId>`.
- If an active ride already exists for `trip_<orderId>`, the responses handoff reuses it and does not duplicate an active ride record.
- If the order is still `CREATED`, the passenger selected-driver handoff accepts the order before seeding the active ride.

## Driver acceptance result

**PASS.**

- `/driver-map` is driver-only and reads only `CREATED` nearby orders.
- Accepting an order calls the canonical accept helper, mutates the order from `CREATED` to `ACCEPTED`, seeds active ride `trip_<orderId>`, and sets the active ride status to `ACCEPTED`.
- After acceptance, the order leaves `listNearbyOrders()` and Feed projection.
- DriverMap CTA opens `/active-ride?role=driver&tripId=trip_<orderId>&status=ACCEPTED`.

## Driver active ride result

**PASS.**

- Driver active ride supports `ACCEPTED`, `DRIVER_EN_ROUTE`, `WAITING_PASSENGER`, `IN_PROGRESS`, `COMPLETED`, `CANCELED`, and `NO_SHOW` audit/status URLs.
- Query status overrides are in-memory safe previews and do not roll back later timestamped lifecycle states.
- Driver CTAs advance the persisted active ride through:
  - `ACCEPTED → DRIVER_EN_ROUTE`
  - `DRIVER_EN_ROUTE → WAITING_PASSENGER`
  - `WAITING_PASSENGER → IN_PROGRESS`
  - `IN_PROGRESS → COMPLETED`
- Terminal views render terminal-specific UI and do not return the ride to DriverMap as a nearby order.

## Passenger active ride result

**PASS.**

- `/active-ride?role=passenger` with no `tripId` resolves the latest live handed-off trip via `findLatestHandedOffOrderTripId()`.
- `/active-ride?role=passenger&tripId=trip_<orderId>` reads the same canonical active-ride record as the driver view.
- Passenger copy handles `ACCEPTED` as an assigned-driver state and then follows:
  - `ACCEPTED`
  - `DRIVER_EN_ROUTE`
  - `WAITING_PASSENGER`
  - `IN_PROGRESS`
  - `COMPLETED`
- Passenger status URL overrides do not reopen completed/canceled timestamped rides into earlier states.

## Terminal guard result

**PASS.**

Verified by source inspection and storage smoke:

- `COMPLETED` active rides are skipped by passenger no-`tripId` lookup.
- `CANCELED` active rides are skipped by passenger no-`tripId` lookup.
- `NO_SHOW` active rides are skipped by passenger no-`tripId` lookup.
- A stale `ACCEPTED` ride order with a terminal `active_ride` record is skipped by passenger lookup.
- Terminal active rides are not projected back into Feed because Feed projection only includes ride orders whose status is `CREATED`.
- Terminal active rides are not projected back into DriverMap because DriverMap nearby orders only include ride orders whose status is `CREATED`.

## Role guard result

**PASS.**

- `/driver-map` remains driver-only and ignores URL role overrides; non-driver users receive a safe guarded surface with no accept actions.
- Passenger users cannot see driver accept actions on DriverMap.
- Drivers cannot enter passenger order creation protected routes: `/route-picker`, `/route-preview`, `/order-map-draft`; the router redirects those paths to `/driver-map` for persisted driver users.
- Main app map/create entry points route drivers toward driver surfaces instead of passenger order creation.

## Files inspected

- `public/src/app.js`
- `public/src/router.js`
- `public/src/mock_api.js`
- `public/src/ride_state.js`
- `public/src/ride_actions.js`
- `public/src/screens/order_map_draft.js`
- `public/src/screens/order_map_draft_handoff.js`
- `public/src/screens/responses.js`
- `public/src/screens/driver_map.js`
- `public/src/screens/active_ride.js`
- `public/src/screens/active_ride_passenger.js`
- `public/src/screens/trip_confirmation.js`
- `public/src/screens/trip_confirmation_handoff.js`
- `public/sw.js`

## Manual URLs checked

The following hash URLs were checked against route registration, route guards, query/status handling, and canonical storage behavior:

- `#/order-map-draft`
- `#/responses?orderId=<orderId>&state=empty`
- `#/driver-map`
- `#/active-ride?role=driver&tripId=trip_<orderId>&status=ACCEPTED`
- `#/active-ride?role=driver&tripId=trip_<orderId>&status=DRIVER_EN_ROUTE`
- `#/active-ride?role=driver&tripId=trip_<orderId>&status=WAITING_PASSENGER`
- `#/active-ride?role=driver&tripId=trip_<orderId>&status=IN_PROGRESS`
- `#/active-ride?role=driver&tripId=trip_<orderId>&status=COMPLETED`
- `#/active-ride?role=passenger`
- `#/active-ride?role=passenger&tripId=trip_<orderId>`
- `#/active-ride?role=passenger&tripId=trip_<orderId>&status=ACCEPTED`
- `#/active-ride?role=passenger&tripId=trip_<orderId>&status=DRIVER_EN_ROUTE`
- `#/active-ride?role=passenger&tripId=trip_<orderId>&status=WAITING_PASSENGER`
- `#/active-ride?role=passenger&tripId=trip_<orderId>&status=IN_PROGRESS`
- `#/active-ride?role=passenger&tripId=trip_<orderId>&status=COMPLETED`
- `#/active-ride?role=passenger&tripId=trip_<orderId>&status=CANCELED`
- `#/active-ride?role=passenger&tripId=trip_<orderId>&status=NO_SHOW`

## `node scripts/check.mjs` result

```text
All checks passed.
```

## `git diff --stat`

Before this docs-only report, `git diff --stat` was empty. After adding this report:

```text
...-post-merge-passenger-driver-lifecycle-smoke.md | 203 +++++++++++++++++++++
1 file changed, 203 insertions(+)
```
