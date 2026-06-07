# BD-RIDE-ORDER-02 — passenger/driver lifecycle smoke

Date: 2026-06-08
Repo: `iprus2026-tech/BazarDriveCloud`
Branch: `smoke/ride-order-02-passenger-driver-lifecycle`
Baseline commit: `4aa9ac7 BD-ROLE-05 profile role isolation for passenger/driver tabs (#417)`

## PASS/FAIL summary

**PASS — all 39 cross-role lifecycle assertions hold under runtime smoke.**

The first executable runtime guard for the full mock lifecycle confirms that after BD-RIDE-ORDER-01 (#416) and BD-ROLE-05 (#417), the passenger→driver→active-ride chain preserves every role boundary: passenger creates an order, the snapshot stays passenger-owned through `acceptOrder`, the driver's `driverSnapshot` lives only on the response (never on the order), `/active-ride` resolves `effectiveRole` with the URL > smoke > persisted priority, and `bazardrive.ride_history.v1` splits one trip into two role-tagged entries that the smoke-aware filter delivers correctly per tab. The same local user account (`LOCAL_USER_ID`) driving both sides never collapses identity — the bug class this smoke locks down.

## Exact smoke path tested

`scripts/smoke-ride-order-02-passenger-driver-lifecycle.mjs` is a dependency-free Node ESM smoke that imports the real `mock_api.js`, `state.js`, `smoke_role.js`, and `ride_history.js` behind Map-backed `localStorage` + `sessionStorage` stubs and a minimal `window`/`location` stub. No jsdom, no UI, no Mapbox, no backend, no service worker. `loadResponsesForOrder` is module-private in `screens/responses.js`, so the smoke inlines its 10-line read logic and asserts the persisted `driverSnapshot` shape directly (the contract the screen's `pickStr` type-guard depends on).

### The 10-step chain

```text
S1  Passenger context creates an order via createRideOrder({passenger: {…}})
S2  Driver context (same local user, role flipped) sees the order in listNearbyOrders()
S3  Driver writes a response to bazardrive.responses.v1 with driverSnapshot
S4  acceptOrder(id) flips CREATED → ACCEPTED, does not mutate order.passenger
    nor leak a driver field onto the order, and responses survive accept
S5  effectiveRole resolution mirrored from active_ride.js:322
    URL ?role= → getSmokeRole() → persisted user.role → fallback passenger
S6  Two role-tagged history entries persist under one tripId; smoke filter
    picks the right subset per tab; persisted user.role is never written
S7  Final guardrail: same local user account drives both jackets, identity
    does not collapse (order.passenger.name !== response.driverSnapshot.name)
```

## Findings — Scenario 1: Passenger creates order

| Assertion | Result |
|---|---|
| `createRideOrder` returns a string `id` | PASS |
| `order.status === 'CREATED'` | PASS |
| `order.passenger.name` reflects passenger user | PASS |
| `order.passenger.isCurrentUser === true` | PASS |
| `order.passenger.authorId === LOCAL_USER_ID` | PASS |
| Order appears in `listNearbyOrders()` | PASS |

## Findings — Scenario 2: Driver sees the available order

| Assertion | Result |
|---|---|
| Driver lists the passenger's order via `listNearbyOrders()` | PASS |
| `order.status` still `CREATED` for driver view | PASS |
| Passenger snapshot unchanged after the local role flip | PASS |
| Order has no `driver` / `driverSnapshot` field at this stage | PASS |

## Findings — Scenario 3: Driver response drops snapshot on response (not order)

| Assertion | Result |
|---|---|
| `inlineLoadResponsesForOrder(order.id).length === 1` | PASS |
| `response.kind === 'passenger_response'` | PASS |
| `response.orderId` matches the source order | PASS |
| `driverSnapshot.name` reflects the driver user | PASS |
| `driverSnapshot.name !== order.passenger.name` (anti-conflation) | PASS |
| Every `driverSnapshot.{name,car,carModel,carColor,plate}` is a string | PASS |

## Findings — Scenario 4: acceptOrder + cross-role invariants

`acceptOrder` is the highest-risk seam — Codex flagged this class of bug repeatedly during BD-RIDE-ORDER-01. The smoke locks down four invariants:

| Assertion | Result |
|---|---|
| `accepted.status === 'ACCEPTED'` | PASS |
| `accepted.acceptedAt` is a non-empty string | PASS |
| `order.passenger.name` UNCHANGED after accept | PASS |
| No `driver` / `driverSnapshot` field leaked onto the order | PASS |
| Responses survive `acceptOrder` (no wipe) | PASS |
| `ACCEPTED` order drops from `listNearbyOrders` (CREATED filter) | PASS |

## Findings — Scenario 5: effectiveRole priority matrix

Mirrors the actual resolution line in `public/src/screens/active_ride.js:322`. Persisted `user.role = 'driver'` for every case below.

| Inputs | Resolved role | Result |
|---|---|---|
| `?role=passenger`, no smoke | `passenger` (URL wins) | PASS |
| `?role=driver`, no smoke | `driver` (URL wins) | PASS |
| No URL, no smoke | `driver` (persisted) | PASS |
| No URL, `setSmokeRole('passenger')` | `passenger` (smoke beats persisted) | PASS |
| No URL, `clearSmokeRole()` | `driver` (fallback to persisted) | PASS |
| Persisted `user.role` after all flips | unchanged `driver` | PASS |
| `sessionStorage.bazardrive.smoke_role.v1` cleared by `clearSmokeRole` | removed | PASS |

## Findings — Scenario 6: History role isolation

One trip, two role-tagged entries; BD-RIDE-ORDER-01 contract that `currentHistoryRole()` prefers `getSmokeRole()` over `user.get()?.role` (ride_history.js:20-26).

| Assertion | Result |
|---|---|
| Two entries persisted under one `tripId` | PASS |
| Both entries share the same `tripId` | PASS |
| Roles split (`passenger` + `driver` both present) | PASS |
| Passenger entry has no driver-only `receipt` field | PASS |
| Driver entry has no passenger-only `rating` / `tags` / `comment` | PASS |
| `setSmokeRole('passenger')` → `readRideHistoryStatus()` returns only passenger entry | PASS |
| `setSmokeRole('driver')` → returns only driver entry | PASS |

## Findings — Scenario 7: Single user, two jackets

The whole reason this smoke exists. One local user account (`LOCAL_USER_ID`) drives both the passenger create flow (S1 shape) and the driver response (S3 shape) on a fresh state. Even with one account underneath, the records must stay identifiably distinct:

| Assertion | Result |
|---|---|
| `order.passenger.name !== response.driverSnapshot.name` | PASS |
| `order.passenger.authorId` still pinned to `LOCAL_USER_ID` | PASS |
| `response.kind === 'passenger_response'` (no role conflation) | PASS |

## Files inspected

- `public/src/mock_api.js` — `createRideOrder`, `listNearbyOrders`, `getOrderById`, `acceptOrder`, `clearRideOrdersStore`, `LOCAL_USER_ID`, `sanitizePassengerSnapshot`.
- `public/src/state.js` — `user.get`, `user.set`, `user.reset`, `bazardrive.user.v1`.
- `public/src/smoke_role.js` — `SMOKE_ROLE_KEY`, `getSmokeRole`, `setSmokeRole`, `clearSmokeRole`.
- `public/src/ride_history.js` — `buildPassengerHistoryEntry`, `buildDriverHistoryEntry`, `saveRideHistoryEntry`, `loadRideHistory`, `readRideHistoryStatus`, `clearRideHistory`, `currentHistoryRole`.
- `public/src/screens/responses.js` — `RESPONSES_KEY`, `loadResponsesForOrder` (module-private, logic mirrored inline).
- `public/src/screens/respond.js` — response shape reference (BD-RIDE-ORDER-01 `driverSnapshot` contract).
- `public/src/screens/active_ride.js` — line 322 role-resolution mirror.

## Out of scope (intentionally)

- **`trip_confirmation` / `saveDriverHandoffSnapshot` / `seedActiveRideFromConfirmedHandoff`.** The post-acceptOrder canonical handoff seeding lives in `trip_confirmation_handoff.js` and pulls from `MOCK_*` literals; exercising it would require driving `trip_confirmation.js` through a DOM. This smoke instead asserts the contracts the handoff depends on (passenger unchanged, no driver leak onto the order, responses survive accept).
- UI rendering, Mapbox, real backend, service worker, CSP, storage-version migrations.
- `.visual-review/` artefacts — left untracked.

## `node scripts/check.mjs` result

```
All checks passed.
```

## `node scripts/dispatcher.mjs` result

```
=== BazarDrive Dispatcher ===
Дебаг:   20/20 PASS  (зелёный)
Drift:   CLEAN
Статус:  READY_CLEAN (after commit) / READY_DIRTY (before commit)
```

(Filled at execution time; was 19/19 before this smoke landed.)

## `git diff --stat`

```
 docs/smoke/BD-RIDE-ORDER-02-passenger-driver-lifecycle-smoke.md
 scripts/check.mjs
 scripts/smoke-ride-order-02-passenger-driver-lifecycle.mjs
```

## What this smoke protects

1. **Order creation contract.** Passenger creates an order with a sanitized passenger snapshot pinned at creation (`LOCAL_USER_ID`, name, initials, phoneMasked, comment, isCurrentUser=true). Status `CREATED`. Listable.
2. **Cross-role visibility without mutation.** A tab flipping from passenger to driver role does not mutate orders the passenger created. The driver sees the same order with the same snapshot.
3. **Driver identity belongs to the response.** `driverSnapshot` (name, rating, car, carModel, carColor, plate) is written only into the `bazardrive.responses.v1` record, never onto the order.
4. **`acceptOrder` is non-destructive.** Transitions status `CREATED → ACCEPTED`, sets `acceptedAt`. Leaves `order.passenger` byte-for-byte unchanged. Does not write `driver` / `driverSnapshot` onto the order. Does not delete responses.
5. **`/active-ride` role resolution.** URL `?role=` > `getSmokeRole()` > persisted `user.role` > fallback `passenger`. Smoke override never mutates persisted role.
6. **Role-split history.** One ride → two history entries keyed by `${role}:${tripId}`. Passenger-only fields (`rating`, `tags`, `comment`) and driver-only fields (`receipt`, `earnings`) stay on their own record. `currentHistoryRole()` filter follows the BD-RIDE-ORDER-01 contract (smoke > persisted).
7. **Single-user-two-jackets guardrail.** Even when one local account drives both sides of the chain, `order.passenger.name`, `response.driverSnapshot.name`, and `response.kind` keep the records identifiably distinct. Passenger and driver cannot collapse into one person in different jackets.
