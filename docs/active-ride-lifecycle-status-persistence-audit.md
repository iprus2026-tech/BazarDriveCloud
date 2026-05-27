# ActiveRide lifecycle status persistence audit (BD-ACTIVE-03)

Issue: [#245](https://github.com/iprus2026-tech/BazarDriveCloud/issues/245).
Branch: `audit/active-ride-lifecycle-persistence`.

Status: docs-only audit. No runtime code touched. Mock/UI mode only —
no backend, no Mapbox SDK, no real auth/push/payments. All line
references below were verified against the audit branch tip.

The goal is to walk the canonical ActiveRide lifecycle
`CREATED → ACCEPTED → DRIVER_EN_ROUTE → WAITING_PASSENGER → IN_PROGRESS → COMPLETED`
end-to-end (plus the `CANCELED` and `NO_SHOW` terminal branches) and
confirm that:

1. Refreshing / deep-linking into `/active-ride` always restores the
   latest persisted status.
2. The driver and passenger surfaces read **one** canonical `tripId` and
   converge on the same record.
3. The passenger render never forks the storage — the driver flow owns
   the canonical lifecycle.
4. The `?status=` query string never poisons `localStorage`.
5. The `?status=` query string cannot roll back terminal states
   (`COMPLETED`, `CANCELED`, `NO_SHOW`).
6. History / rating side effects are safe under refresh.

---

## 1. Surfaces involved

| Surface                          | File                                              | Role |
|----------------------------------|---------------------------------------------------|------|
| Storage contract                 | `public/src/ride_state.js`                        | Owns `bazardrive.active_ride.v1`. Exposes `findActiveRide`, `getActiveRide`, `saveActiveRide`, `updateActiveRideStatus`, `createDemoActiveRide`. Holds `RIDE_STATUS`, `NEXT_DRIVER_STATUS`, `STATUS_TIMESTAMP_FIELD`. |
| Mock order store                 | `public/src/mock_api.js`                          | Owns `bazardrive.ride_orders.v1`. Owns the `CREATED → ACCEPTED` flip via `acceptNearbyOrder`. Pre-ActiveRide lifecycle only. |
| Shared accept helper             | `public/src/ride_actions.js`                      | `acceptCanonicalRideOrder()` chains `acceptNearbyOrder` (mock_api) → `seedActiveRideFromAcceptedOrder` (active_ride) so Feed and Driver-Map agree on the seeded `tripId = trip_${order.id}`. |
| Confirmed-handoff bridge         | `public/src/screens/trip_confirmation_handoff.js` | Reads `bazardrive.trip_confirmation.v1`, seeds `bazardrive.active_ride.v1`. `loadCanonicalActiveRide({ tripId, role })` is the cross-role canonical lookup used by both /active-ride entries. |
| Driver-side handoff snapshot     | `public/src/screens/driver_handoff_snapshot.js`   | Owns `bazardrive.driver_handoff_snapshot.v1`. Lightweight per-trip overlay applied on top of the demo/SIM fallback when no full active-ride record exists yet. TTL = 30 min. |
| Driver active-ride screen        | `public/src/screens/active_ride.js`               | Owns the driver lifecycle. Calls `updateActiveRideStatus` on the user's accept / arrived / start / finish / cancel / no-show taps. |
| Passenger active-ride screen     | `public/src/screens/active_ride_passenger.js`     | View over the same store. Persists only two transitions: `WAITING_PASSENGER → IN_PROGRESS` (boarded) and the explicit passenger cancel. |
| Ride history                     | `public/src/ride_history.js`                      | Owns `bazardrive.ride_history.v1`. Upsert keyed by `${role}:${tripId}`. Side effect of `COMPLETED` render on both surfaces. |

The storage map (from `public/src/storage_boundary.js`) confirms:

```
bazardrive.active_ride.v1             → ride_state.js
bazardrive.ride_orders.v1             → mock_api.js
bazardrive.trip_confirmation.v1       → trip_confirmation.js / trip_confirmation_handoff.js
bazardrive.driver_handoff_snapshot.v1 → driver_handoff_snapshot.js
bazardrive.ride_history.v1            → ride_history.js
```

These keys do **not** overlap; each surface writes to exactly one store.

---

## 2. The canonical lifecycle sequence

`RIDE_STATUS` (`ride_state.js:6-18`) defines the full enum:

```
NEW_ORDER, CONFIRMATION_PENDING, CONFIRMED, CHAT_STARTED,
DRIVER_EN_ROUTE, DRIVER_APPROACHING_PICKUP, WAITING_PASSENGER,
IN_PROGRESS, COMPLETED, CANCELED, NO_SHOW
```

`NEXT_DRIVER_STATUS` (`ride_state.js:67-76`) wires the happy-path
walk used by the driver flow:

```
NEW_ORDER          → DRIVER_EN_ROUTE
DRIVER_EN_ROUTE    → WAITING_PASSENGER
DRIVER_APPROACHING_PICKUP → WAITING_PASSENGER
WAITING_PASSENGER  → IN_PROGRESS
IN_PROGRESS        → COMPLETED
COMPLETED          → COMPLETED   (terminal)
CANCELED           → CANCELED    (terminal)
NO_SHOW            → NO_SHOW     (terminal)
```

`STATUS_TIMESTAMP_FIELD` (`ride_state.js:58-65`) records the canonical
timestamp **on the persisted record** at each transition:

```
DRIVER_EN_ROUTE    → acceptedAt
WAITING_PASSENGER  → arrivedAt
IN_PROGRESS        → startedAt
COMPLETED          → completedAt
CANCELED           → canceledAt
NO_SHOW            → canceledAt   (shared with CANCELED)
```

`acceptedAt` is the only timestamp that is **set-once**
(`ride_state.js:233-234`); the rest are overwritten on each transition
into that status. The set-once behavior matters because both
`/active-ride` URLs gate the `?status=` override on `acceptedAt`
(see §5).

### 2.1. CREATED → ACCEPTED (pre-ActiveRide)

These two states live in `bazardrive.ride_orders.v1`, **not** in
`bazardrive.active_ride.v1`. They describe a published passenger order
that has not yet been picked up.

- `createRideOrder` (`mock_api.js:464`) writes `status: 'CREATED'`.
- `acceptNearbyOrder(id)` (`mock_api.js:484-502`) flips
  `CREATED → ACCEPTED` in place and stamps `acceptedAt: ISO now`.
  The mutation is guarded by `o.status === 'CREATED'` so a duplicate
  accept (refresh, double-tap, second driver) returns `null` and the
  caller fails safely.
- `listNearbyOrders` (`mock_api.js:472-476`) filters to
  `status === 'CREATED'`, so an `ACCEPTED` order drops out of the
  passenger-facing feed projection.
- `rideOrderToFeedPost` (`mock_api.js:574-603`) refuses to project
  anything that isn't `CREATED`, so an accepted order cannot reappear
  in Feed.

The bridge into the ActiveRide lifecycle is
`acceptCanonicalRideOrder(orderId)` (`ride_actions.js:116-122`):

1. Call `acceptNearbyOrder(orderId)` → may return null (already taken).
2. Call `seedActiveRideFromAcceptedOrder(order)`
   (`ride_actions.js:72-110`) which builds the demo ride with
   `tripId = trip_${order.id}`, `status: DRIVER_EN_ROUTE`,
   `timestamps.acceptedAt: order.acceptedAt || now` and `saveActiveRide`s it.

So `ACCEPTED` (on the order) ⟺ `DRIVER_EN_ROUTE` with `acceptedAt`
stamped (on the active ride). The two records share the identity via
the `trip_${order.id}` convention.

### 2.2. DRIVER_EN_ROUTE → WAITING_PASSENGER

Initiator: driver taps "Я на месте" in `active_ride.js:522`.

```js
ride = updateActiveRideStatus(ride.tripId, RIDE_STATUS.WAITING_PASSENGER);
renderSheet();
```

`updateActiveRideStatus` (`ride_state.js:227-243`) calls
`getActiveRide` (which materializes a demo if missing), stamps
`arrivedAt`, sets `status = WAITING_PASSENGER`, and `saveActiveRide`s
the merged record. On a subsequent refresh `findActiveRide` returns
the persisted record with `arrivedAt !== null`, and the safe-status
override (§5) refuses to roll back.

### 2.3. WAITING_PASSENGER → IN_PROGRESS

Two entry points, both persist:

- Driver taps "Начать поездку" (`active_ride.js:543`).
- Passenger taps "Я в машине — поехали" (`active_ride_passenger.js:1830`).

Both call
`updateActiveRideStatus(ride.tripId, RIDE_STATUS.IN_PROGRESS)`, which
stamps `startedAt` and persists. This is the only transition the
passenger surface initiates besides the explicit cancel; the rest of
the passenger surface is view-only.

### 2.4. IN_PROGRESS → COMPLETED

Driver-only initiator: "Завершить" in `active_ride.js:553`. Calls
`updateActiveRideStatus(...,  COMPLETED)` which stamps `completedAt`.

Side effects on the COMPLETED render:

- `active_ride.js:567-579` builds a `buildDriverHistoryEntry` and
  upserts into `bazardrive.ride_history.v1`. Safe under refresh
  because `saveRideHistoryEntry` (`ride_history.js:73-90`) upserts by
  `${role}:${tripId}` and preserves the original `savedAt` on
  re-render.
- `active_ride_passenger.js:1220` calls `persistHistory()` on every
  COMPLETED render (see §8 for the rating-on-refresh concern).

### 2.5. Terminal branches: CANCELED, NO_SHOW

- Driver cancel: opened from `active_ride.js:524` (en-route) and
  funnels through `openDriverCancelSheet`. On confirm calls
  `updateActiveRideStatus(..., CANCELED)`.
- Driver no-show: opened from the WAITING_PASSENGER sheet
  (`active_ride.js:545`) via `openDriverProblemSheet`. On the
  `PASSENGER_NO_SHOW` confirmation calls
  `updateActiveRideStatus(..., NO_SHOW)`.
- Passenger cancel: `active_ride_passenger.js:1885-1903`. Pre-saves
  the current view via `saveActiveRide(ride)` so the in-memory
  SIM_AUDIT identity is materialized into storage before the status
  transition runs, then calls
  `updateActiveRideStatus(tripId, CANCELED, { cancel: { by: 'passenger', reason } })`.

Both terminal statuses stamp `canceledAt` (shared field).

---

## 3. The canonical `tripId` resolver

`loadCanonicalActiveRide({ tripId, role })`
(`trip_confirmation_handoff.js:223-237`) is the single function both
`/active-ride` entries use to find the trip:

1. `findActiveRide(tripId)` — persisted record wins outright.
2. Otherwise try `seedActiveRideFromConfirmedHandoff({ tripId, role })`
   for the requested role.
3. Otherwise try the **other** role's confirmed handoff (the visible
   identity is the same MOCK_* literals on both sides, so the seeder
   yields a trip that describes the same identity).

`seedActiveRideFromConfirmedHandoff`
(`trip_confirmation_handoff.js:196-204`) is idempotent:
`findActiveRide(tripId)` short-circuits the call if a record already
exists — re-tapping the `/trip-confirmation` CTA after the driver has
already accepted **cannot** reset timestamps or rewind status.

Both surfaces call `loadCanonicalActiveRide` with their own role:

- Driver: `active_ride.js:405` — `{ tripId, role: 'driver' }`.
- Passenger: `active_ride_passenger.js:152` — `{ tripId, role: 'passenger' }`.

The only writer to `bazardrive.active_ride.v1` accessed by the
passenger surface is `updateActiveRideStatus` (for the two transitions
it owns — see §2.3, §2.5) and an explicit `saveActiveRide` immediately
before the passenger cancel (§2.5). The passenger view itself —
`loadPassengerRideView` (`active_ride_passenger.js:146-171`) — never
writes. The only mutation it applies is the view-only
`NEW_ORDER → DRIVER_EN_ROUTE` swap on the returned object, which is
not persisted.

**Conclusion: passenger render does not fork storage.** It either
reads the persisted canonical record, or falls back to an in-memory
demo + snapshot enrichment that lives only on the rendered object.

---

## 4. Refresh / deep-link behavior

Both `/active-ride` entries route via the URL hash query
(`active_ride.js:81-85`, `active_ride_passenger.js:1663-1670`):

```
/active-ride?role=driver|passenger&tripId=<id>&status=<override>&phase=<override>&payment=<override>
```

On each render:

1. Resolve `tripId`. If absent, fall back to `DEMO_ACTIVE_RIDE_ID`
   (`active_ride.js:399`, `active_ride_passenger.js:1663`).
2. Call `loadCanonicalActiveRide({ tripId, role })`.
3. If still `null`:
   - Driver (`active_ride.js:414-433`): If neither a valid
     `?status=`, nor a driver handoff snapshot, nor an explicit
     `tripId` is in the URL, return the empty-state placeholder
     (`Нет активного заказа`). Otherwise materialize a non-persisted
     SIM_AUDIT demo and overlay `applyDriverHandoffSnapshotToRide`.
   - Passenger (`active_ride_passenger.js:153-166`): Always
     materialize a non-persisted demo with the same overlay; never
     return an empty state.
4. Apply `?status=` in-memory only (see §5 & §6).

**Refresh after every persisted transition correctly reflects the
latest status.** The chain is:

- Tap "Я на месте" → `updateActiveRideStatus` writes
  `status=WAITING_PASSENGER, arrivedAt` → reload →
  `loadCanonicalActiveRide → findActiveRide` returns the record with
  the new status → driver sheet renders `renderWaiting`
  (`active_ride.js:496`).
- Same chain holds for IN_PROGRESS, COMPLETED, CANCELED, NO_SHOW.

The `DEMO_ACTIVE_RIDE_ID` empty-state guard in `active_ride.js:423`
prevents `getActiveRide` from materializing a fresh demo for the bare
`/active-ride?role=driver` URL when no record exists.

---

## 5. `?status=` cannot poison `localStorage`

Driver side: `safeApplyStatusFromQuery`
(`active_ride.js:96-127`).

```js
return { ...ride, status: statusQuery };
```

The function returns a new object literal; it **never** calls
`saveActiveRide` or `updateActiveRideStatus`. The comment at
`active_ride.js:101-103` calls this out explicitly:

> BD-RIDE-D-10 — In-memory override only. `?status=` must not
> permanently rewrite the stored canonical record; later user actions
> (accept / cancel / etc.) persist via `updateActiveRideStatus`.

Passenger side: `applyPassengerStatusFromQuery`
(`active_ride_passenger.js:179-213`). Same pattern — returns a
spread `{ ...ride, status: ... }` and never calls a writer.

The only writer the passenger surface invokes during the en-route
phase that observes a `?status=` value is the explicit cancel handler
(`active_ride_passenger.js:1885-1903`), which is gated on a user click
(not on the query). So an audit URL like
`/active-ride?role=passenger&status=DRIVER_EN_ROUTE&tripId=feed-42`
on a fresh browser produces:

- `loadCanonicalActiveRide` returns `null` (no persisted record, no
  handoff).
- `createDemoActiveRide({ tripId: 'feed-42', ...SIM_AUDIT })` builds
  an in-memory ride.
- `applyDriverHandoffSnapshotToRide` overlays nothing (no snapshot).
- `applyPassengerStatusFromQuery` flips the in-memory status.
- Render runs.

`bazardrive.active_ride.v1` is untouched.

---

## 6. `?status=` cannot roll back terminal states

Driver side, `safeApplyStatusFromQuery` enforces the rollback gates
(`active_ride.js:96-127`):

| `?status=`                                       | Refused when                                                              |
|--------------------------------------------------|---------------------------------------------------------------------------|
| `NEW_ORDER`                                      | Any of `acceptedAt`, `arrivedAt`, `startedAt`, `completedAt`, `canceledAt` |
| `DRIVER_EN_ROUTE` / `DRIVER_APPROACHING_PICKUP`  | Any of `arrivedAt`, `startedAt`, `completedAt`, `canceledAt`             |
| `WAITING_PASSENGER`                              | Any of `startedAt`, `completedAt`, `canceledAt`                          |
| `IN_PROGRESS`                                    | Any of `completedAt`, `canceledAt`                                       |
| `COMPLETED`                                      | `canceledAt`                                                              |
| `CANCELED` / `NO_SHOW`                           | `completedAt`                                                             |

So once `completedAt` is stamped, `?status=CANCELED` is silently
ignored; once `canceledAt` is stamped, `?status=COMPLETED` is silently
ignored. Both directions are protected.

Passenger side, `applyPassengerStatusFromQuery`
(`active_ride_passenger.js:179-213`) applies the analogous guards:

| `?status=`                                       | Refused when                              |
|--------------------------------------------------|-------------------------------------------|
| `DRIVER_EN_ROUTE` / `DRIVER_APPROACHING_PICKUP`  | `arrivedAt`, `startedAt`, `completedAt`, `canceledAt` |
| `WAITING_PASSENGER`                              | `startedAt`, `completedAt`, `canceledAt` |
| `IN_PROGRESS`                                    | `completedAt`, `canceledAt`              |
| `COMPLETED`                                      | `canceledAt`                              |
| `CANCELED` / `NO_SHOW`                           | (no completed-guard — see "Concern")     |

**Concern (not a defect; documented).** The passenger
`?status=CANCELED|NO_SHOW` branch
(`active_ride_passenger.js:208-211`) does not gate on
`ts.completedAt`. In isolation it just flips an in-memory copy
(harmless), but it is asymmetric with the driver-side gate. Because
the passenger surface does not persist on render, there is no risk of
the canonical record being rewound — the canonical record is the
source of truth on the next render. The asymmetry is therefore
benign, but worth noting if a future change ever has the passenger
surface persist on this branch.

---

## 7. Driver vs passenger share one canonical `tripId`

Cross-role smoke (referenced from
`docs/end-to-end-handoff-smoke-audit.md`):

- Driver clicks accept in Feed → `acceptCanonicalRideOrder` →
  `seedActiveRideFromAcceptedOrder` writes
  `tripId = trip_${orderId}`.
- Passenger opens `/active-ride?role=passenger&tripId=trip_${orderId}`
  → `loadCanonicalActiveRide({ tripId, role: 'passenger' })` →
  `findActiveRide` returns the same record the driver wrote.

Other entry points converge on the same identity:

- `/chat` → `/trip-confirmation?tripId=X&role=passenger` → seeded into
  `bazardrive.active_ride.v1` via
  `seedActiveRideFromConfirmedHandoff`.
- `/trip-confirmation` → `/active-ride?role=driver` (no persistent
  active ride yet, only a `driver_handoff_snapshot` for the same
  `tripId`).

The cross-role fallback in `loadCanonicalActiveRide` (try the other
role's handoff) is the safety net for the "passenger opens first"
scenario: the handoff record was written with `role: 'passenger'` on
the chat→confirmation hop, but its identity fields are derived from
the shared `MOCK_*` literals, so it correctly describes the trip for
the driver too.

Both surfaces stringify `tripId` identically when building the URL
(`encodeURIComponent` on every navigation —
`active_ride_passenger.js:1831, 1849, 1902`,
`active_ride.js:485, 584`), so there is no encoding skew between the
two roles.

---

## 8. History / rating side effects under refresh

### 8.1. Driver-side COMPLETED render

`active_ride.js:567-579` builds a driver history entry from `ride`
and stamps it into `bazardrive.ride_history.v1` via
`saveRideHistoryEntry`. The entry shape
(`ride_history.js:156-174`) is fully derived from the persisted
ride (route, fare, distance, duration, earnings). On refresh the
upsert overwrites with the **same** values, and `savedAt` is
preserved (`ride_history.js:82-84`). No churn.

### 8.2. Passenger-side COMPLETED render — concern

`active_ride_passenger.js:1209-1220` defines `persistHistory()` and
calls it unconditionally on every COMPLETED mount:

```js
function persistHistory({ withRating = false } = {}) {
  const entry = buildPassengerHistoryEntry(ride, withRating ? {
    rating: currentRating,
    tags: Array.from(selectedTags),
    comment: commentInput ? commentInput.value.trim() : '',
  } : {});
  ...
  return Boolean(saved);
}
persistHistory();
```

`buildPassengerHistoryEntry(ride, {})` (`ride_history.js:128-154`)
emits `rating: 0, tags: [], comment: ''`. `saveRideHistoryEntry`
upserts via `{ ...previous, ...stamped }` (`ride_history.js:86`), so
**the `stamped` keys win**.

Consequence: when the passenger first lands on COMPLETED, rates the
trip (`active_ride_passenger.js:1141-1161` flips
`dataset.submitted = 'true'` and calls
`persistHistory({ withRating: true })` which writes the rating into
history), then refreshes the page, the second mount re-runs
`persistHistory()` **without** `withRating`, which overwrites
`rating` back to `0`, `tags` back to `[]`, and `comment` back to
`""` in the persisted history entry. The UI rating widget also
re-renders in the un-submitted state because rating submission is
not persisted into `bazardrive.active_ride.v1`.

This is the only behavior in the audit scope that does not survive
refresh.

Severity: contained — only history mutates; the canonical ride record
and its lifecycle status are untouched. The driver side is not
affected because the driver history entry has no rating field and is
derived entirely from the persisted ride data.

Per the task's "Не менять runtime code" constraint, the fix is **not
applied in this PR**. A follow-up fix would either:

1. Persist the rating into the active-ride record (e.g.
   `ride.passengerRating = { stars, tags, comment }`) so refresh can
   re-derive the submitted state and the `withRating: true` branch
   becomes idempotent; or
2. Have the baseline `persistHistory()` call read the existing
   history entry first and merge `rating | tags | comment` from the
   stored record back into the new entry when absent.

### 8.3. CANCELED / NO_SHOW

Neither surface writes to `bazardrive.ride_history.v1` on the
CANCELED / NO_SHOW branches. The canceled fallback
(`renderPassengerCanceledFallback`,
`active_ride_passenger.js:1461-1522`) and the driver canceled stub
(`renderCanceledStub`, `active_ride.js:587-605`) only navigate and
render copy. Safe under any number of refreshes.

---

## 9. Defects found

One defect, documented in §8.2:

- **Passenger rating regresses to zero on refresh of `/active-ride?role=passenger&status=COMPLETED`.**
  `active_ride_passenger.js:1220` calls `persistHistory()` on every
  COMPLETED mount with `withRating: false`. `saveRideHistoryEntry`
  upsert merges `{ ...previous, ...stamped }`
  (`ride_history.js:86`), and the baseline `stamped` carries
  `rating: 0, tags: [], comment: ''` from
  `buildPassengerHistoryEntry(ride, {})`. The passenger's submitted
  rating, tags and comment are therefore overwritten in
  `bazardrive.ride_history.v1` whenever the COMPLETED screen
  re-renders.

  Per the audit's "Не менять runtime code, если нет явного дефекта"
  rule and the docs-only scope of this PR, the fix is **not** applied
  here. Filing a follow-up is recommended (suggested approaches in
  §8.2).

No other defects found. The lifecycle status persistence and refresh
behavior are correct end-to-end across the
`CREATED → ACCEPTED → DRIVER_EN_ROUTE → WAITING_PASSENGER → IN_PROGRESS → COMPLETED`
sequence and the `CANCELED` / `NO_SHOW` terminal branches.

---

## 10. Manual smoke URLs

All URLs are relative to `public/index.html` and use the hash router.
They exercise the lifecycle entirely against the mock store — no
real backend, no Mapbox, no auth. Substitute any stable `<id>` for
the demo `tripId`.

### 10.1. Driver lifecycle walk

1. Empty state: `/#/active-ride?role=driver`
2. New order (in-memory): `/#/active-ride?role=driver&status=NEW_ORDER&tripId=trip_smoke_01`
3. After accept (persisted by user click): tap "Принять заказ" — URL stays the same; refresh now reads `status=DRIVER_EN_ROUTE` from the store.
4. WAITING_PASSENGER deep-link: `/#/active-ride?role=driver&status=WAITING_PASSENGER&tripId=trip_smoke_01`
5. IN_PROGRESS deep-link: `/#/active-ride?role=driver&status=IN_PROGRESS&tripId=trip_smoke_01`
6. COMPLETED deep-link: `/#/active-ride?role=driver&status=COMPLETED&tripId=trip_smoke_01`
7. CANCELED deep-link: `/#/active-ride?role=driver&status=CANCELED&tripId=trip_smoke_02`
8. NO_SHOW deep-link: `/#/active-ride?role=driver&status=NO_SHOW&tripId=trip_smoke_02`

### 10.2. Passenger lifecycle walk

1. En-route: `/#/active-ride?role=passenger&status=DRIVER_EN_ROUTE&tripId=trip_smoke_01`
2. Waiting: `/#/active-ride?role=passenger&status=WAITING_PASSENGER&tripId=trip_smoke_01`
3. In progress: `/#/active-ride?role=passenger&status=IN_PROGRESS&tripId=trip_smoke_01`
4. Arriving dropoff (sub-phase): `/#/active-ride?role=passenger&status=IN_PROGRESS&phase=ARRIVING_DROPOFF&tripId=trip_smoke_01`
5. Completed (auto-pay): `/#/active-ride?role=passenger&status=COMPLETED&payment=auto&tripId=trip_smoke_01`
6. Completed (pending): `/#/active-ride?role=passenger&status=COMPLETED&payment=pending&tripId=trip_smoke_01`
7. Completed (paid): `/#/active-ride?role=passenger&status=COMPLETED&payment=paid&tripId=trip_smoke_01`
8. Canceled fallback: `/#/active-ride?role=passenger&status=CANCELED&tripId=trip_smoke_02`
9. No-show fallback: `/#/active-ride?role=passenger&status=NO_SHOW&tripId=trip_smoke_02`

### 10.3. Persistence / refresh smoke

1. Open `/#/active-ride?role=driver&status=NEW_ORDER&tripId=trip_persist_01`, tap "Принять заказ" → driver shows en-route → refresh: status remains `DRIVER_EN_ROUTE`.
2. Tap "Я на месте" → refresh: remains `WAITING_PASSENGER`, `arrivedAt` set.
3. Tap "Начать поездку" → refresh: remains `IN_PROGRESS`, `startedAt` set.
4. Tap "Завершить" → refresh: remains `COMPLETED`, `completedAt` set. Append `&status=CANCELED` to the URL → screen still renders COMPLETED (terminal gate).
5. From a fresh `trip_persist_02`: drive en-route → tap "Отменить" → confirm reason → status persists as `CANCELED`. Append `&status=IN_PROGRESS` → screen still renders the canceled stub.

### 10.4. Cross-role canonical id smoke

1. Open Feed and accept a passenger card with a stable id (e.g. `42`). The seed produces `tripId = trip_42`.
2. Driver should auto-route to `/#/active-ride?role=driver&tripId=trip_42`.
3. Open a second tab at `/#/active-ride?role=passenger&tripId=trip_42` — same trip identity (passenger name, route, fare) appears.
4. Refresh both tabs → status stays consistent on both sides.

### 10.5. `?status=` does not poison storage

1. With a clean `bazardrive.active_ride.v1`, open `/#/active-ride?role=passenger&status=COMPLETED&tripId=trip_poison_01`. Render shows COMPLETED.
2. In DevTools: `localStorage.getItem('bazardrive.active_ride.v1')` → expected: still does not contain `trip_poison_01` (the demo+SIM enrichment is in-memory only).
3. Same check from the driver side: `/#/active-ride?role=driver&status=COMPLETED&tripId=trip_poison_02` followed by a `localStorage.getItem` → no `trip_poison_02` entry.

### 10.6. History rating regression check (see §8.2)

1. Open `/#/active-ride?role=passenger&status=COMPLETED&tripId=trip_rating_01`.
2. Tap 5 stars, optionally add a comment, tap "Поставить оценку".
3. Inspect `bazardrive.ride_history.v1` → entry for `passenger:trip_rating_01` has `rating: 5`, tags, comment set.
4. Refresh the page.
5. Re-inspect `bazardrive.ride_history.v1` → entry's `rating` is now `0`, `tags: []`, `comment: ""`. ⚠ This reproduces the §9 defect.
