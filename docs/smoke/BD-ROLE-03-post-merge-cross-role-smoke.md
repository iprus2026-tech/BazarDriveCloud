# BD-ROLE-03 Post-merge cross-role smoke audit

Verification-only, docs-only re-run of the cross-role path on the **merged
`main`** branch (after PR #296 landed as commit `6470ee5`):

`Profile → Map → OrderMapDraft → DriverMap → ActiveRide`.

Goal: confirm the passenger/driver boundary established by BD-ROLE-01/02 and
BD-PROFILE-P-02 still holds end to end on real merged `main`, not just on the
PR branch.

- BD-ROLE-02 — Cross-role profile/order smoke audit (#296)
- BD-PROFILE-P-02 — Scope ride history to active profile role (#294)
- BD-ROLE-01 — Guard driver role from passenger order flow (#293)
- BD-MAP-06 — Passenger order to DriverMap handoff audit (#291)

## Summary

Overall: **PASS**

No cross-role leak found on merged `main`. Every "must not happen" item in the
issue is already closed by an existing guard. No runtime source files were
modified (docs-only). `node scripts/check.mjs` reports `All checks passed.`

## Checks

node scripts/check.mjs:
**PASS** — `All checks passed.`

## Manual smoke matrix

> `?role=` on `/profile`, `/map`, `/order-map-draft` and `/driver-map` is **not**
> a role switch — those screens resolve role from persisted state
> (`user.get().role`). The query is kept in the URLs below to mirror the issue's
> manual paths. `/active-ride` reads `?role=` for view selection only (a shared
> handoff surface by contract) and never writes it back to persisted state.

| URL | Expected | Actual | Result |
| --- | --- | --- | --- |
| #/profile?role=passenger | Passenger profile renders; passenger actions visible; can proceed toward map/order draft. | `profile.js` branches on persisted role; passenger surface renders. `?role=` ignored as a switch. | PASS |
| #/profile?role=driver | Driver profile renders from persisted role; no passenger order CTA; does not overwrite passenger identity. | Persisted role drives the branch; `?role=` never calls `user.set`. Only `onboarding.js`/`welcome.js` write role. | PASS |
| #/map?role=passenger | Passenger map home; `Выбрать маршрут` hands off to route flow. | `map.js` renders passenger home; CTA → `/route-picker`. A driver here is bounced back to `/driver-map` by the router redirect. | PASS |
| #/order-map-draft?role=passenger | Order draft reachable; publish creates passenger-owned order. | `redirectDriverPassengerOrderFlow` does not redirect passenger/guest; `publishOrder()` → `createRideOrder({ type: 'passenger_request', passenger: buildPassengerSnapshotFromUser(...) })`. | PASS |
| #/driver-map?role=driver | Driver-side working view (only if persisted role is driver). | `resolveEffectiveRole()` reads persisted state only; `role === 'driver'` renders the working surface. | PASS |
| #/driver-map?role=passenger | Does NOT gain driver powers; passenger guard shown. | `resolveEffectiveRole()` intentionally ignores the `?role=` hash (BD-ROLE-01 comment); non-driver → `renderPassengerGuard()`. | PASS |
| #/order-map-draft?role=driver | Driver redirected away from passenger order flow. | Router redirects a driver whose target is in `PASSENGER_ORDER_ROUTES` → `/driver-map`; runs on initial load and every `hashchange`. | PASS |
| #/active-ride?role=driver | Driver active-ride sheet renders. | `activeRide()` resolves `role` from query/persisted; `role === 'driver'` renders the driver sheet. | PASS |
| #/active-ride?role=passenger | Passenger active-ride sheet renders; not driver-owned. | `role !== 'driver'` → `renderPassenger()` → `active_ride_passenger.js`. | PASS |
| #/active-ride?role=driver&tripId=trip_&lt;orderId&gt;&status=DRIVER_EN_ROUTE | Driver active ride bound to the canonical trip; real passenger context shown. | `tripId`/`status`/`phase` read from query; canonical ride resolved before any demo fallback; passenger row comes from the accepted order's pinned snapshot. | PASS |

## Smoke matrix to verify

**1. Passenger profile → passenger order — PASS.**
Passenger profile opens as passenger (persisted-role branch). The passenger can
proceed `/map → /route-picker → /route-preview → /order-map-draft`; the router
does not redirect a passenger/guest. `publishOrder()` pushes a
`passenger_request` row with `passenger: { authorId: LOCAL_USER_ID,
isCurrentUser: true, … }`, so the created order remains passenger-owned.

**2. Driver profile boundary — PASS.**
A driver never reaches `order_map_draft.publishOrder()`: the router redirect,
`getMapEntryRoute()` (Карта tab → `/driver-map`) and `getCreateEntryRoute()`
(FAB → `/driver-map`) all keep a driver out of the passenger order flow. `?role=`
on `/profile` is read-only and never calls `user.set`, so driver mode cannot
silently overwrite passenger identity.

**3. DriverMap guard — PASS.**
`#/driver-map?role=driver` behaves as the driver-side view only when persisted
role is driver. `#/driver-map?role=passenger` shows the passenger guard — the
URL query cannot mint driver powers. `resolveEffectiveRole()` trusts
`user.get().role` exclusively and deliberately ignores `?role=` (documented
BD-ROLE-01 comment).

**4. ActiveRide identity handoff — PASS.**
On accept, `seedActiveRideFromAcceptedOrder()` → `buildAcceptedOrderPassenger()`
replaces (not merges) `ride.passenger` from the order's pinned snapshot, so the
demo seed cannot leak in and the original passenger identity is preserved. The
driver active ride shows the real publisher context; `?role=passenger` renders
the passenger sheet and does not become driver-owned (read-only view select).

**5. History / direct URL guards — PASS.**
`render()` is bound to `hashchange`, so the router redirect and the DriverMap
guard re-run on direct-URL access and on browser back — a role-forbidden path
cannot be reopened with elevated permissions. Ride history is keyed
`${role}:${tripId}` and `scopeEntriesToCurrentRole()` filters reads to the
active persisted role, so no cross-role state leaks between profiles.

## Files inspected (read-only)

| File | What was checked |
| --- | --- |
| `public/src/router.js` | `PASSENGER_ORDER_ROUTES`, `redirectDriverPassengerOrderFlow`, redirect on initial load + `hashchange`. |
| `public/src/app.js` | `getMapEntryRoute()` / `getCreateEntryRoute()` route a driver to `/driver-map`. |
| `public/src/screens/driver_map.js` | `resolveEffectiveRole()` (persisted-state only, `?role=` ignored), `renderPassengerGuard()`. |
| `public/src/screens/active_ride.js` | `?role=` view select, canonical ride / `tripId` / `status` resolution, driver-vs-passenger split. |
| `public/src/screens/order_map_draft.js` | `buildPassengerSnapshotFromUser()`, `publishOrder()` → `createRideOrder({ type: 'passenger_request' })`. |

## Regressions found

- none

## Follow-ups

- none — no real regressions confirmed, so no follow-up issues are opened.

## Check status

```text
$ node scripts/check.mjs
All checks passed.
```
