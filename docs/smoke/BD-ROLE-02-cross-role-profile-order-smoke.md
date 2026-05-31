# BD-ROLE-02 — Cross-role profile/order smoke audit

Docs-only smoke audit for the full cross-role path
`Profile → Map → OrderMapDraft → DriverMap → ActiveRide` and ride history.

Goal: confirm the passenger/driver boundary tightened by the recent work
still holds end to end, before more Mapbox/backend work lands.

- BD-ROLE-01 — Guard driver role from passenger order flow (#293)
- BD-PROFILE-P-02 — Scope ride history to active profile role (#294)
- BD-MAP-06 — Passenger order to DriverMap handoff audit (#291)
- BD-ROLE-01 — Fix passenger DriverMap role leak (#287)

## Scope

Audit only. A minimal/safe fix would have been applied **only** if a role
leak were confirmed. None was found, so this is a docs-only audit.

Out of scope (unchanged, per issue #295): backend/API, real Mapbox SDK,
auth, payments, push, APK/Android, CSP weakening, inline script/style.

## Result

No cross-role leak found. Every "must not happen" item from the issue is
already closed by an existing guard. No runtime source files were modified.

## Files inspected

| File | What was checked |
| --- | --- |
| `public/src/router.js` | `redirectDriverPassengerOrderFlow` guard, runs on every render incl. `hashchange` (browser back / direct URL). |
| `public/src/app.js` | `getMapEntryRoute` / `getCreateEntryRoute` route a driver to `/driver-map` from the Карта tab and the FAB. |
| `public/src/state.js` | `role` only ever set via `user.set`; `?role=` query never mutates persisted role. |
| `public/src/ride_actions.js` | `isDriverMode`, `canAcceptOrder`, `canManageOwnOrder`, `seedActiveRideFromAcceptedOrder`, `buildAcceptedOrderPassenger`. |
| `public/src/ride_history.js` | `scopeEntriesToCurrentRole`, `readRideHistoryStatus`, per-role `${role}:${tripId}` keying. |
| `public/src/mock_api.js` | `createRideOrder`, `sanitizePassengerSnapshot`, `listNearbyOrders`, `acceptNearbyOrder`. |
| `public/src/screens/profile.js` | Role branch in default export, role-scoped `historySectionHtml()`. |
| `public/src/screens/map.js` | Passenger map home; route CTA hands off to `/route-picker`. |
| `public/src/screens/order_map_draft.js` | `publishOrder` / `buildPassengerSnapshotFromUser` passenger identity capture. |
| `public/src/screens/driver_map.js` | `resolveEffectiveRole` (persisted-state only), passenger guard, accept path. |
| `public/src/screens/active_ride.js` | `?role=` read, driver-vs-passenger render split, canonical ride lookup. |
| `public/src/screens/trip_confirmation.js` | `?role=` read for the shared confirmation handoff. |

## Acceptance checklist — verification

### 1. Passenger can create a passenger ride order ✓

Flow: `/map` → `Выбрать маршрут` → `/route-picker` → `/route-preview`
→ `/order-map-draft`. A passenger (or guest/null) role is **not**
redirected by `redirectDriverPassengerOrderFlow`, so the order draft is
reachable. `publishOrder()` calls `createRideOrder({ type:
'passenger_request', … })` and the row lands in
`bazardrive.ride_orders.v1` with `status: 'CREATED'`.

### 2. Driver profile does not create a passenger order by default ✓

Three independent guards keep a driver out of the passenger order flow:

- **Router redirect** — `router.js` redirects any driver
  (`isDriverMode(u)`) whose target path is in
  `PASSENGER_ORDER_ROUTES = {/route-picker, /route-preview,
  /order-map-draft}` to `/driver-map`. `render()` runs on both initial
  load and every `hashchange`, so this also covers a deep link and the
  browser back button.
- **Карта tab** — `getMapEntryRoute()` sends a driver to `/driver-map`,
  never `/map`.
- **FAB / create** — `getCreateEntryRoute()` sends a driver to
  `/driver-map`, never `/new`.

The driver therefore never reaches `order_map_draft.publishOrder()`.

### 3. Driver can view/accept nearby passenger orders ✓

`driver_map.js` `resolveEffectiveRole()` reads `user.get().role` and
**intentionally ignores the `?role=` hash** (comment BD-ROLE-01), so a
`#/driver-map?role=driver` URL cannot bypass the gate. Only
`role === 'driver'` renders the working surface; everything else gets
`renderPassengerGuard()`. Accept delegates to
`acceptCanonicalRideOrder(id)` (shared spine), flipping `CREATED →
ACCEPTED` and seeding the active ride.

### 4. Passenger-created order carries passenger identity into DriverMap and ActiveRide ✓

`order_map_draft.buildPassengerSnapshotFromUser()` pins
`{ name, initials, phoneMasked, comment, authorId: 'local-user',
isCurrentUser: true }` onto the order at publish time.
`mock_api.sanitizePassengerSnapshot()` stores it verbatim.
On accept, `seedActiveRideFromAcceptedOrder()` →
`buildAcceptedOrderPassenger()` **replaces** (not merges) `ride.passenger`
from that snapshot, so the demo seed ("Анна М.", rating/luggage) cannot
leak in. Orders without a snapshot fall back to a neutral "Пассажир".

### 5. Ride history is scoped to the active profile role ✓

History records are keyed `${role}:${tripId}`, so the passenger and driver
views of the same trip are independent records.
`ride_history.scopeEntriesToCurrentRole()` filters reads to
`user.get().role` (passenger | driver). `profile.historySectionHtml()`
consumes `readRideHistoryStatus()`, which already applies that scope, so a
passenger profile never lists driver rides and vice-versa. The day-summary
split (`buildDaySummary`) is defensive — with role scoping upstream it only
ever sees the active role's entries.

### 6. Direct URLs preserve or safely resolve role ✓

- `/driver-map` resolves role from persisted state only — a passenger deep
  link renders the guard, not the driver feed.
- Passenger order routes resolve via the router redirect for drivers.
- `/active-ride?role=…` and `/trip-confirmation?role=…` are **shared
  handoff surfaces by contract**: `?role=` selects the view (both roles
  converge on one trip). This is intentional, not a leak — `?role=` is read
  for rendering only and never written back to persisted state. The only
  `user.set({ role })` call sites are `onboarding.js` and `welcome.js`.

### 7. Browser back does not leak role ✓

`render()` is bound to `hashchange`, so the same guards re-run when the
user navigates back into a passenger order route as a driver
(→ `/driver-map`) or back into `/driver-map` as a passenger
(→ guard view).

### 8 & 9. `/active-ride?role=driver` and `?role=passenger` still work ✓

`active_ride.js` reads
`const role = query.get('role') || (user.get().role === 'driver' ? 'driver'
: 'passenger')`; `role !== 'driver'` delegates to the passenger renderer.
Both deep links render their respective sheets and resolve the canonical
ride before any demo/audit fallback.

## Notes on intentional, non-leak behaviors

- **Shared `/map` surface.** `/map` is reachable by a driver via the
  DriverMap `Открыть карту` button (`data-action="map"`), so it is not a
  passenger-exclusive route. A driver viewing `/map` is by design; the
  `Выбрать маршрут` CTA still bounces a driver back to `/driver-map`
  through the router redirect, so no passenger order can be created there.
- **Self-accept in the single-device demo.** `listNearbyOrders()` does not
  filter out the local user's own `CREATED` orders, and DriverMap's accept
  handler does not apply `canManageOwnOrder`. This is intentional for the
  mock loop ("Создать тестовый заказ" → accept it as the driver) on one
  device; it is order-ownership, not role leakage, and gating it would
  break the demo. Left unchanged.

## Manual smoke script

Start from a clean local profile, or clear the relevant keys:

```js
localStorage.removeItem('bazardrive.user.v1');
localStorage.removeItem('bazardrive.ride_orders.v1');
localStorage.removeItem('bazardrive.active_ride.v1');
localStorage.removeItem('bazardrive.ride_history.v1');
```

### Passenger flow

1. Onboard as passenger (or set `role: 'passenger'`). Open `#/profile` —
   confirm passenger actions (Где вы?, План, Избранное) are visible.
2. Open `#/map` → `Выбрать маршрут` → complete `/route-picker` →
   `/route-preview` → `/order-map-draft` and publish.
3. Confirm the success pill reads `CREATED`.
4. Switch role to driver (re-onboard or set `role: 'driver'`), open
   `#/driver-map`, confirm the order is listed, tap `Принять`.
5. Tap `К поездке` → confirm the URL carries `role=driver` and
   `tripId=trip_<order.id>`, and the passenger row shows the publisher's
   identity (not "Анна М.").
6. Open `#/active-ride?role=passenger` — confirm the passenger sheet renders.

### Driver flow

1. Open `#/profile` as a driver — confirm driver actions (смена / документы)
   are visible; confirm no passenger order CTA creates an order.
2. From the Карта tab and the FAB, confirm you land on `/driver-map`,
   never `/order-map-draft`.
3. Go online, view nearby orders, accept one.
4. Open `#/profile` history — confirm only driver-side rides appear.

### Role-leak probes (must all stay safe)

1. As a passenger, open `#/driver-map?role=driver` directly → expect the
   "Это экран водителя" guard, not the working driver feed.
2. As a driver, open `#/order-map-draft` directly → expect redirect to
   `/driver-map`.
3. As a driver, press browser back into a passenger order route → expect
   redirect to `/driver-map`.
4. Confirm passenger ride history never lists driver rides and driver
   history never lists passenger orders as personal passenger rides.

### Useful URLs

```text
#/profile?role=passenger
#/profile?role=driver
#/map?role=passenger
#/order-map-draft?role=passenger
#/driver-map?role=driver
#/driver-map?role=passenger          (expect driver guard)
#/order-map-draft?role=driver         (expect redirect to /driver-map)
#/active-ride?role=driver
#/active-ride?role=passenger
#/active-ride?role=driver&tripId=trip_<orderId>&status=DRIVER_EN_ROUTE
```

> Note: `?role=` on `/profile`, `/map`, `/order-map-draft` and
> `/driver-map` is **not** a role switch — those screens resolve role from
> persisted state. The query is kept in the URLs above to mirror the
> issue's manual paths; switch the persisted role via onboarding to change
> what these screens render.

## Check status

```text
$ node scripts/check.mjs
All checks passed.
```
