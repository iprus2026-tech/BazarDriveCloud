# BD-ORDER-P-08 / BD-ORDER-P-09 — Active ride handoff and terminal cleanup smoke notes

Date: 2026-05-31
Repo: `iprus2026-tech/BazarDriveCloud`
Branch: `audit/bd-order-p-08-real-device-lifecycle-smoke`
Current PR scope: runtime fix + audit notes, **not docs-only**
Current local head: `26cbc8f active_ride: sync canonical order status and prefer latest handed-off tripId; add audit and checks`
Current verdict: **FIX READY — code updated; manual deploy smoke still required after merge/deploy**

## 1. What changed since the original blocked audit

The first version of this document recorded a container-only smoke attempt that could not open a real browser. That note is now superseded by the reviewer-provided Real Chrome findings and the runtime fix included in this PR.

This PR now changes application runtime code in addition to keeping this audit note:

- `public/src/screens/active_ride.js` resolves driver `/active-ride?role=driver` without `tripId` through the latest live handed-off order before falling back to the demo ride.
- `public/src/screens/active_ride.js` synchronizes driver active ride lifecycle changes from `bazardrive.active_ride.v1` into canonical `bazardrive.ride_orders.v1`.
- `scripts/check.mjs` contains static regression guards for the driver fallback and canonical order status synchronization.

The old statement "no application implementation code was changed" is no longer true and must not be used for this PR.

## 2. Real Chrome smoke findings reported for BD-ORDER-P-08

A Real Chrome smoke run confirmed the explicit-tripId passenger-driver lifecycle works through completion:

| Area | Result |
| --- | --- |
| `/responses?orderId=<orderId>&state=list` | PASS — shows driver offers. |
| Select driver | PASS — opens `/active-ride?role=passenger&tripId=trip_<orderId>&status=DRIVER_EN_ROUTE`. |
| Driver explicit active ride | PASS — `/active-ride?role=driver&tripId=trip_<orderId>&status=ACCEPTED` opens the same trip. |
| Driver lifecycle | PASS — actions progress through `WAITING_PASSENGER`, `IN_PROGRESS`, `COMPLETED`. |
| Passenger mirror | PASS — passenger sees `WAITING_PASSENGER`, `IN_PROGRESS`, `COMPLETED`. |
| Route/price consistency | PASS — route and price stay consistent across passenger/driver views. |

## 3. Bugs found in Real Chrome smoke

### Bug 1 — Completed passenger order still appeared active in Feed

- Severity: high.
- Reproduction:
  1. Create passenger order.
  2. Select driver from responses.
  3. Open driver active ride with explicit `tripId`.
  4. Progress driver lifecycle to `COMPLETED`.
  5. Open `/feed`.
- Expected: completed order no longer appears as active/current passenger order.
- Actual before fix: `/feed` still showed the completed passenger order card as active with `К моему заказу`.
- Root cause: driver active ride status was persisted in `bazardrive.active_ride.v1`, but canonical `bazardrive.ride_orders.v1` was not advanced to terminal status.
- Fix in this PR: driver active ride status actions now call a wrapper that persists `active_ride.v1` and syncs canonical `ride_orders.v1` through `updateTripStatus()`.

### Bug 2 — Bare driver active ride did not resolve current non-terminal handoff

- Severity: high.
- Reproduction:
  1. Create passenger order.
  2. Select/accept driver so `trip_<orderId>` exists.
  3. While the trip is non-terminal, open `/active-ride?role=driver` without `tripId`.
- Expected: driver screen resolves the latest live handed-off trip.
- Actual before fix: driver screen could show `Нет активного заказа`.
- Root cause: passenger active ride already used `findLatestHandedOffOrderTripId()` when `tripId` was missing, but the driver branch only resolved canonical rides when explicit `tripId`, valid status query, or driver handoff snapshot existed.
- Fix in this PR: driver branch now resolves `findLatestHandedOffOrderTripId()` before the demo fallback when the URL has no explicit `tripId`.

## 4. Runtime fix summary

### Driver default active ride fallback

Behavior after fix:

1. If URL has `tripId`, use it.
2. Else call `findLatestHandedOffOrderTripId()`.
3. Else fall back to `DEMO_ACTIVE_RIDE_ID`.
4. Show the driver empty state only when all are absent/invalid:
   - no explicit `tripId`,
   - no latest handed-off trip,
   - no valid status query,
   - no driver handoff snapshot,
   - no canonical active ride.

`findLatestHandedOffOrderTripId()` already skips terminal active rides, so `/active-ride?role=driver` should be empty after `COMPLETED`, `CANCELED`, or `NO_SHOW` instead of reopening the terminal trip.

### Canonical ride order terminal cleanup

Driver active ride actions now keep `bazardrive.ride_orders.v1` aligned with `bazardrive.active_ride.v1`:

| Active ride status | Canonical ride order status |
| --- | --- |
| `IN_PROGRESS` | `IN_PROGRESS` |
| `COMPLETED` | `COMPLETED` |
| `CANCELED` | `CANCELED` |
| `NO_SHOW` | `CANCELED` |

The sync uses `ride.orderId` when present and defensively derives `orderId` from `trip_order-*` for older handoffs. A defensive bridge moves stale canonical orders through allowed transitions (`CREATED → ACCEPTED → IN_PROGRESS → COMPLETED`) when needed.

## 5. Regression checks run in this branch

| Check | Result | Notes |
| --- | --- | --- |
| `node scripts/check.mjs` | PASS | Repository preflight and active-ride static regression guards passed. |
| Mocked Node lifecycle regression | PASS | Created/accepted a passenger order with mocked `localStorage`, verified latest active handoff resolution, synced `IN_PROGRESS`/`COMPLETED`, verified Feed/DriverMap projections exclude non-`CREATED`/terminal orders, and verified terminal trips are not returned by `findLatestHandedOffOrderTripId()`. |
| Static server smoke | PASS | `python3 -m http.server 4173 -d public` served `public/index.html`; `curl -I http://127.0.0.1:4173/` returned HTTP 200. |
| Real Chrome rerun after fix in this container | NOT RUN | This container still has no installed browser/device runtime. The fix needs a deploy/browser rerun. |

## 6. Required manual deploy smoke after merge/deploy

Run on GitHub Pages or another real browser deployment:

1. Create a passenger order.
2. Open `/responses?orderId=<orderId>&state=list`.
3. Select a driver.
4. While the ride is active, open `/active-ride?role=driver` without `tripId`; it should resolve the current `trip_<orderId>`.
5. Open `/active-ride?role=driver&tripId=trip_<orderId>&status=ACCEPTED`.
6. Progress driver lifecycle:
   - `Я на месте`,
   - `Начать поездку`,
   - `Завершить`.
7. Verify `/active-ride?role=passenger&tripId=trip_<orderId>` shows completed.
8. Verify `/feed` no longer shows the completed order as active/current.
9. Verify `/driver-map` does not show the completed order as nearby.
10. Verify `/active-ride?role=driver` without `tripId` is empty after terminal status.

## 7. Final verdict

**Code: APPROVE after manual deploy smoke.**

**PR metadata/docs: updated.** This document no longer marks the PR as docs-only or blocked-only. It records the Real Chrome findings, the runtime fixes in `active_ride.js`, the regression checks, and the remaining required browser rerun after deployment.
