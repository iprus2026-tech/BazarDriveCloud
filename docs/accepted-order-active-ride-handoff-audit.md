# BD-ACTIVE-02 — Accepted order → ActiveRide data handoff audit

Docs-only audit for [issue #243](https://github.com/iprus2026-tech/BazarDriveCloud/issues/243).

BD-ACTIVE-01 verified that the *pipe* between `/driver-map` and
`/active-ride?role=driver&tripId=…&status=DRIVER_EN_ROUTE` is stable
(an accepted order disappears from the nearby list, an active-ride seed
is persisted, the CTA navigates to the right URL). The remaining
question for BD-ACTIVE-02 is the *payload that flows through that pipe*:
when a driver accepts a `CREATED` order, does the canonical active ride
record under `bazardrive.active_ride.v1` actually carry the accepted
order's pickup / dropoff / price / distance / ETA, or does the renderer
silently fall back to `SIM_AUDIT_RIDE_OVERRIDES` / demo content?

No defects were found. This is a docs-only audit. No runtime source
files were modified. `node scripts/check.mjs` still passes.

## 1. Scope

Verified for the DriverMap → ActiveRide accept path:

- An accepted nearby order produces a canonical active-ride record
  keyed by `trip_<order.id>` under `bazardrive.active_ride.v1`.
- The seeded record carries the accepted order's pickup/dropoff labels,
  price, distance and ETA — no field is silently swapped for a
  `SIM_AUDIT_RIDE_OVERRIDES` value or for a `buildDemoRide()` default
  that contradicts the accepted order.
- Driver `/active-ride` reads the seed and renders it verbatim,
  without going through the `SIM_AUDIT_RIDE_OVERRIDES` / demo
  materialization branch.
- Passenger `/active-ride` opened against the same `tripId` reads the
  same canonical record safely (no crash, no orphan write).
- Refresh / deep-link with the same `tripId` returns the same
  persisted record.
- Stale or unknown accept ids never produce an orphan
  `bazardrive.active_ride.v1[tripId]` entry.
- Existing audit / demo URLs (`trip_order-demo`, no-`tripId`, etc.)
  still render as before.

Out of scope — and intentionally untouched — by this audit: real
Mapbox SDK, backend, auth, payments, push, driver assignment,
ActiveRide redesign, `ride_state.js` state machine, passenger renderer
behavior beyond reading the seed, CSP, inline script/style. Per the
issue, the service worker is not bumped because no runtime files were
added or removed.

## 2. Files inspected

| File | What was checked |
|------|------------------|
| `public/src/screens/driver_map.js`              | Accept button handler; navigation to `/active-ride`; no local seed builder (delegated to `ride_actions.js`). |
| `public/src/ride_actions.js`                    | `acceptCanonicalRideOrder()`, `seedActiveRideFromAcceptedOrder()` — the canonical seeder that writes into `bazardrive.active_ride.v1`. |
| `public/src/mock_api.js`                        | `createRideOrder()` (status `CREATED`), `listNearbyOrders()` (status filter), `acceptNearbyOrder()` (CREATED → ACCEPTED transition + `acceptedAt`; `null` on stale id), `clearRideOrdersStore()`. |
| `public/src/ride_state.js`                      | `STORAGE_KEY = 'bazardrive.active_ride.v1'`; `createDemoActiveRide` deep-merge semantics; `findActiveRide` / `saveActiveRide`; `RIDE_STATUS.DRIVER_EN_ROUTE`; `DEMO_ACTIVE_RIDE_ID`; `SIM_AUDIT_RIDE_OVERRIDES` shape. |
| `public/src/screens/active_ride.js`             | Driver renderer entry; `rawTripId` parsing; `loadCanonicalActiveRide({ tripId, role: 'driver' })`; the `SIM_AUDIT_RIDE_OVERRIDES` / driver-snapshot fallback branch; `renderDriverEmpty`. |
| `public/src/screens/active_ride_passenger.js`   | `loadPassengerRideView()`; `loadCanonicalActiveRide({ tripId, role: 'passenger' })`; the same SIM_AUDIT / snapshot fallback for the passenger side; passenger status mapping. |
| `public/src/screens/trip_confirmation_handoff.js` | `loadCanonicalActiveRide()` — single canonical reader shared by driver & passenger; `findActiveRide(tripId)` short-circuit; cross-role handoff seeder (irrelevant for the BD-DRIVER-01 path because the persisted record always wins). |
| `public/src/screens/order_map_draft.js`         | `publishOrder()` builds the `CREATED` order via `createRideOrder()` with pickup/dropoff/distance/duration/price. |
| `public/sw.js`                                  | Precache already covers `driver_map.js`, `order_map_draft.js`, `active_ride.js`, `active_ride_passenger.js`, `ride_actions.js`, `trip_confirmation_handoff.js`. No new runtime files; no SW change required. |
| `docs/screen-contracts.md` (§ BD-DRIVER-01)     | Data contract for the seed write under `bazardrive.active_ride.v1`. |
| `docs/driver-map-active-ride-handoff-audit.md`  | Prior BD-ACTIVE-01 audit covering the pipe (not the payload). |

## 3. Exact handoff pipe

Source-level, end to end:

1. Passenger publishes an order via `/order-map-draft`. `publishOrder`
   (`public/src/screens/order_map_draft.js:805`) calls
   `createRideOrder({ pickup, dropoff, distanceKm, durationMin,
   estimatedPrice, scheduledMode, scheduledAt, comment })`.
2. `createRideOrder()` (`public/src/mock_api.js:445`) stamps
   `id = order-<timestamp>`, `status: 'CREATED'`, `createdAt`, and
   prepends to `bazardrive.ride_orders.v1`.
3. `/driver-map` opens, `renderList()` (`driver_map.js:265`) calls
   `listNearbyOrders()` (`mock_api.js:472`) which returns the top 20
   rows with `status === 'CREATED'`. Each is rendered via
   `buildOrderRow` (`driver_map.js:131`).
4. Driver clicks **Принять**. The handler
   (`driver_map.js:287`) calls
   `acceptCanonicalRideOrder(id)` (`ride_actions.js:116`).
5. `acceptCanonicalRideOrder` calls
   `acceptNearbyOrder(id)` (`mock_api.js:484`) which atomically rewrites
   the matching row to `status: 'ACCEPTED'`, stamps `acceptedAt`, and
   persists the list back to `bazardrive.ride_orders.v1`. Returns the
   updated order, or `null` if the id is unknown / already
   non-`CREATED`.
6. On success, `acceptCanonicalRideOrder` calls
   `seedActiveRideFromAcceptedOrder(accepted)` (`ride_actions.js:72`).
   This computes `tripId = trip_<order.id>`, derives labels and
   numeric → label conversions from the accepted order, builds the
   ride via `createDemoActiveRide({ tripId, role: 'driver',
   status: DRIVER_EN_ROUTE, … overrides })`, and persists with
   `saveActiveRide(ride)` (`ride_state.js:210`). Returns
   `{ tripId, ride }`.
7. `acceptCanonicalRideOrder` returns `{ tripId, order, ride }` to
   `driver_map.js`, which flips the screen to the `ACCEPTED` sheet
   (`renderAccepted`, `driver_map.js:276`).
8. The ACCEPTED card's «К поездке» CTA carries
   `data-trip-id="<tripId>"`. The click handler
   (`driver_map.js:304`) navigates to
   `/active-ride?role=driver&tripId=<encoded>&status=DRIVER_EN_ROUTE`.
9. `activeRide()` (`active_ride.js:392`) reads `tripId` from the hash
   query, calls
   `loadCanonicalActiveRide({ tripId, role: 'driver' })`
   (`trip_confirmation_handoff.js:223`). That helper calls
   `findActiveRide(tripId)` first — which hits the seed written in
   step 6 and returns it as-is, **without** going through the
   `SIM_AUDIT_RIDE_OVERRIDES` / driver-snapshot fallback branch in
   `active_ride.js:414-432`.
10. The driver sheet renders pickup, dropoff, price, distance and ETA
    from the seeded record.

## 4. localStorage keys involved

| Key | Owner | What this audit cares about |
|-----|-------|------------------------------|
| `bazardrive.ride_orders.v1` | `mock_api.js` (`loadRideOrdersRaw`, `persistRideOrders`) | Source of the accepted order. `CREATED → ACCEPTED` happens here. |
| `bazardrive.active_ride.v1` | `ride_state.js` (`STORAGE_KEY` at line 4; reads via `loadActiveRideStore`, writes via `saveActiveRideStore`) | Destination of the seeded record. Map keyed by `tripId`. |
| `bazardrive.trip_confirmation.v1` | `trip_confirmation_handoff.js` (`TRIP_CONFIRM_KEY`) | Not used on this path. Read defensively by `loadCanonicalActiveRide` only when no record exists for the `tripId`; with a persisted seed in place, the handoff branch is short-circuited. |
| `bazardrive.driver_handoff_snapshot.v1` | `driver_handoff_snapshot.js` | Same: only consulted in the fallback branch when the canonical record is missing. With a fresh BD-DRIVER-01 seed in place, this snapshot is not read. |
| `bazardrive.chat.v1` | `active_ride.js` | Out of scope for this audit — only written when the driver taps "Подъезжаю" in `active_ride.js:523`. |

## 5. Accepted order payload (CREATED → ACCEPTED)

After step 5 of the pipe, the row in `bazardrive.ride_orders.v1` looks
like (literal field set from `mock_api.js:445-470` and the
`ACCEPTED` rewrite at `mock_api.js:484-502`):

```jsonc
{
  "id":                 "order-<timestamp>",
  "type":               "passenger_request",
  "source":             "map",
  "pickup":             { "id": <draft.pickup.id|null>, "label": "<from label>" },
  "dropoff":            { "id": <draft.dropoff.id|null>, "label": "<to label>" },
  "distanceKm":         <number>,
  "durationMin":        <number>,
  "estimatedPrice":     <number>,
  "estimatedPriceLabel":"<user budget string, may be empty>",
  "scheduledMode":      "now" | "later",
  "scheduledAt":        "<ISO>",
  "scheduledLabel":     "<optional>",
  "comment":            "<optional>",
  "status":             "ACCEPTED",
  "createdAt":          "<ISO>",
  "acceptedAt":         "<ISO>"
}
```

Every field used by the seed builder is present:
`pickup.label`, `dropoff.label`, `distanceKm`, `durationMin`,
`estimatedPrice`, `acceptedAt`.

## 6. Active ride seed payload

`seedActiveRideFromAcceptedOrder` (`ride_actions.js:72-110`) is the only
producer for this path. It deep-merges into the
`buildDemoRide()` base (`ride_state.js:95-158`) via
`createDemoActiveRide`. The accepted-order-derived fields it writes are:

| Field path | Value | Source on the accepted order |
|------------|-------|-------------------------------|
| `tripId`                          | `` `trip_${order.id}` ``                                     | `order.id` |
| `role`                            | `'driver'`                                                   | constant in the seed call |
| `status`                          | `RIDE_STATUS.DRIVER_EN_ROUTE` (`'DRIVER_EN_ROUTE'`)          | constant |
| `order.offerPrice`                | `` `${priceRub.toLocaleString('ru-RU')} ₽` ``                | `Number(order.estimatedPrice)` |
| `order.destinationDistance`       | `'<distanceKm> км'` or `'—'` when 0                          | `Number(order.distanceKm)` |
| `order.destinationEta`            | `'<durationMin> мин'` or `'—'` when 0                        | `Number(order.durationMin)` |
| `route.pickupLabel`               | `pointLabel(order.pickup, 'Точка подачи')`                   | `order.pickup.label` (fallback string when missing) |
| `route.dropoffLabel`              | `pointLabel(order.dropoff, 'Точка назначения')`              | `order.dropoff.label` |
| `route.etaToDestination`          | `etaLabel` (same string as `order.destinationEta`)           | `order.durationMin` |
| `ride.price`                      | `priceLabel` (same string as `order.offerPrice`)             | `order.estimatedPrice` |
| `timestamps.acceptedAt`           | `order.acceptedAt` or `new Date().toISOString()`             | `order.acceptedAt` |
| `timestamps.createdAt`            | injected by `createDemoActiveRide`                            | `Date.now()` (seed-side) |

Fields **not** written from the accepted order (deep-merged from the
demo base, intentionally):
`passenger.*` (the order has no passenger identity in the BD-DRIVER-01
mock), `driver.*` (taken from the driver demo profile), `vehicle.*`,
`payment.*`, `chat.*`, `waiting.*`, the
`tags / commission / rate / pickupEta / pickupDistance` decorative
order fields, and the `ride.todayEarnings / tripsToday / rating` driver
shift stats. These are display defaults from `buildDemoRide()` and
have no `SIM_AUDIT_RIDE_OVERRIDES` provenance — the SIM overrides are
only applied in the in-memory demo branch in
`active_ride.js:425` / `active_ride_passenger.js:161`, which is
**not** reached when a seed is present.

## 7. Driver ActiveRide read path

`active_ride.js:398-433`:

```js
const rawTripId       = query.get('tripId');                  // 398
const tripId          = rawTripId || DEMO_ACTIVE_RIDE_ID;     // 399
let ride = loadCanonicalActiveRide({ tripId, role: 'driver' });   // 405

let effectiveStatusQuery = statusQuery;
if (!ride) {
  // SIM_AUDIT / driver-snapshot fallback path — only reached when
  // NO canonical record exists for the tripId.
  …
  const useSimOverrides = hasValidStatusQuery || Boolean(driverSnapshot);
  const overrides = useSimOverrides ? SIM_AUDIT_RIDE_OVERRIDES : {};
  ride = createDemoActiveRide({ tripId, ...overrides });
  …
}
ride = safeApplyStatusFromQuery(ride, effectiveStatusQuery);
```

For a freshly accepted order:

- `findActiveRide(tripId)` inside `loadCanonicalActiveRide`
  (`trip_confirmation_handoff.js:225`) returns the persisted seed
  immediately. The `if (!ride)` branch is skipped entirely, so
  `SIM_AUDIT_RIDE_OVERRIDES` is **not** layered on top.
- `safeApplyStatusFromQuery(ride, 'DRIVER_EN_ROUTE')` is a no-op
  because `ride.status` already equals `DRIVER_EN_ROUTE` from the seed
  (`active_ride.js:97`: `if (ride.status === statusQuery) return ride`).
- All sheet renderers (`renderSheet`, the driver-en-route sheet, the
  earnings calculator) consume `ride.order.offerPrice`,
  `ride.route.pickupLabel`, `ride.route.dropoffLabel`,
  `ride.order.destinationDistance / destinationEta`,
  `ride.ride.price`, etc. — i.e. the exact fields written in §6.

## 8. Passenger ActiveRide read path

`active_ride_passenger.js:146-171` (`loadPassengerRideView`):

```js
let ride = loadCanonicalActiveRide({ tripId, role: 'passenger' });
if (!ride) {
  const snapshot     = loadDriverHandoffSnapshot(tripId);
  const useSim       = Boolean(statusQuery) || Boolean(snapshot);
  const overrides    = useSim ? SIM_AUDIT_RIDE_OVERRIDES : {};
  ride               = createDemoActiveRide({ tripId, ...overrides });
  if (snapshot) ride = applyDriverHandoffSnapshotToRide(ride, snapshot);
}
if (ride.status === RIDE_STATUS.NEW_ORDER) {
  return { ...ride, status: RIDE_STATUS.DRIVER_EN_ROUTE };
}
return ride;
```

Behavior when the driver has just seeded `trip_<order.id>`:

- `loadCanonicalActiveRide({ tripId, role: 'passenger' })` calls
  `findActiveRide(tripId)` first — same store, same key — and returns
  the driver-side seed. The seed has `role: 'driver'`, but the loader
  keys purely by `tripId` and does **not** filter by role, so the
  passenger view reads the same record. (This is by design — see
  `trip_confirmation_handoff.js:206-237`, BD-RIDE-D-10 "Cross-role
  canonical loader".)
- The seed's `status === DRIVER_EN_ROUTE`, so the
  `NEW_ORDER → DRIVER_EN_ROUTE` re-mapping at line 167 does not fire.
- `applyPassengerStatusFromQuery` is then applied; with no `?status=`
  in the URL it's a no-op.
- `PASSENGER_SUPPORTED_STATUSES` contains `DRIVER_EN_ROUTE`, so the
  passenger does not fall through to `renderPassengerStub` and does
  not crash. The passenger sheet renders pickup / dropoff / fare from
  `ride.route` / `ride.order.offerPrice` / `ride.ride.price` — i.e.
  the accepted-order data.
- Decorative fields the seed inherits from the driver demo
  (`driver.name='Рустам К.'`, `vehicle.model='Toyota Camry'`,
  `payment.last4='4417'`, etc.) are read by the passenger top card.
  This is the **same** identity surface the passenger sees on the
  current demo route and on the `SIM_AUDIT_RIDE_OVERRIDES` audit URL,
  so there is no regression — the BD-DRIVER-01 mock simply has no
  richer passenger / driver identity to project from the published
  order.

The passenger does **not** create or modify any record on this path.
The only places `active_ride_passenger.js` writes to
`bazardrive.active_ride.v1` are explicit lifecycle handlers
(`updateActiveRideStatus(ride.tripId, RIDE_STATUS.IN_PROGRESS / .COMPLETED / .CANCELED)`
at lines 1830, 1849, 1896), all gated behind a user action.

## 9. Stale / invalid accept behavior

- `acceptNearbyOrder(id)` returns `null` when:
  - `id` is not a non-empty string,
  - no row in `bazardrive.ride_orders.v1` matches `id`,
  - the matching row's `status !== 'CREATED'` (e.g. already accepted
    in another tab, or canceled).
- `acceptCanonicalRideOrder` short-circuits on a `null` result
  (`ride_actions.js:117-119`) and returns `null`. **No call to
  `seedActiveRideFromAcceptedOrder` is made**, so no orphan record is
  written to `bazardrive.active_ride.v1`.
- `seedActiveRideFromAcceptedOrder` additionally guards against bad
  input (`ride_actions.js:73`): if `order` is not an object or has no
  `id`, it returns `null` without touching storage.
- In `driver_map.js:289-297`, a `null` from
  `acceptCanonicalRideOrder` redirects the driver to
  `/order-map-draft`. No exception is thrown. No state in
  `bazardrive.active_ride.v1` is touched.

## 10. Refresh / deep-link behavior

- Hard refresh on `#/active-ride?role=driver&tripId=trip_order-…&status=DRIVER_EN_ROUTE`
  rehydrates from `localStorage`: the seed survives, `findActiveRide`
  returns it, the screen renders identical content.
- `safeApplyStatusFromQuery` is idempotent for the existing
  `DRIVER_EN_ROUTE` status, so the displayed status does not flicker.
- Lifecycle-locked statuses are respected: once
  `updateActiveRideStatus` advances the ride to e.g.
  `WAITING_PASSENGER` (`timestamps.arrivedAt` is set), reopening the
  same URL with `status=DRIVER_EN_ROUTE` does **not** rewind — the
  `if (ts.arrivedAt || …) return ride` guard at
  `active_ride.js:107` blocks it.
- Passenger deep-link to the same `tripId` after a refresh: same
  result — `findActiveRide` returns the seed, the passenger renders
  consistent data.

## 11. Demo / SIM_AUDIT fallback boundary

`SIM_AUDIT_RIDE_OVERRIDES` is declared once
(`ride_state.js:26-56`) and imported in three places:

| Importer | Branch | Reachable from accept path? |
|----------|--------|-----------------------------|
| `active_ride.js` line 425 | Only when `loadCanonicalActiveRide` returned `null`. | No — the accept path writes the seed *before* navigation, and `findActiveRide` returns it. |
| `active_ride_passenger.js` line 161 | Same — only when `loadCanonicalActiveRide` returned `null`. | No — same reason. |
| (no other importer) | — | — |

Therefore: on the BD-DRIVER-01 happy path,
`SIM_AUDIT_RIDE_OVERRIDES` cannot leak into the rendered driver or
passenger view of an accepted order. The accepted order's labels,
price, distance and ETA always win.

`buildDemoRide()` defaults *are* deep-merged in (passenger identity,
driver identity, vehicle, payment, etc.). That is by design: the
order has no such fields to carry, and using the demo defaults is
explicitly contracted in `screen-contracts.md` for BD-DRIVER-01.

## 12. Manual smoke matrix

Each row was reasoned through against the code; no manual UI run was
required because the surface is deterministic and the test boundary is
storage.

| # | Steps | Expected | Source-level justification |
|---|-------|----------|----------------------------|
| 1 | Open `#/driver-map` with empty `bazardrive.ride_orders.v1`. | Map placeholder without cluster pins; empty card with "Создать тестовый заказ" CTA. | `renderList()` picks `MAP_VARIANT.EMPTY` + `buildEmptyCard()` when `listNearbyOrders()` is empty (`driver_map.js:265-274`). |
| 2 | Publish an order via `/order-map-draft` → return to `#/driver-map`. | The new order shows up with pickup, dropoff, price and meta line, with a «Принять» button. | `createRideOrder({…, status:'CREATED'})` (`mock_api.js:445`) → `listNearbyOrders()` (`mock_api.js:472`); `buildOrderRow` (`driver_map.js:131`) renders the fields. |
| 3 | Click «Принять» on the live order. | Sheet flips to ACCEPTED. `bazardrive.ride_orders.v1` row is now `ACCEPTED`. The order disappears from `listNearbyOrders()`. | `acceptCanonicalRideOrder` (`ride_actions.js:116`) → `acceptNearbyOrder` rewrites row → `seedActiveRideFromAcceptedOrder` writes seed → `renderAccepted` swaps sheet. |
| 4 | Inspect `bazardrive.active_ride.v1` under the key `trip_<order.id>`. | Object with `status: 'DRIVER_EN_ROUTE'`, `route.pickupLabel` and `route.dropoffLabel` matching the published order's labels, `order.offerPrice` / `ride.price` matching the order's `estimatedPrice` formatted as `'<n> ₽'`, `order.destinationDistance` / `order.destinationEta` / `route.etaToDestination` matching `distanceKm` / `durationMin`, `timestamps.acceptedAt` set. | `seedActiveRideFromAcceptedOrder` override block (`ride_actions.js:80-110`) writes exactly these fields; `saveActiveRide` persists. |
| 5 | Open `#/active-ride?role=driver&tripId=trip_<order.id>&status=DRIVER_EN_ROUTE` (CTA path). | Driver sheet renders the accepted order's pickup / dropoff / price / distance / ETA. No `SIM_AUDIT_RIDE_OVERRIDES` content. | `loadCanonicalActiveRide → findActiveRide(tripId)` returns the persisted seed; the SIM_AUDIT branch (`active_ride.js:414-432`) is skipped because `ride` is truthy. |
| 6 | Hard-refresh that ActiveRide URL. | Same render. Status unchanged. No new write. | `localStorage` persistence; `safeApplyStatusFromQuery` no-op when `ride.status === statusQuery`. |
| 7 | Open `#/active-ride?role=passenger&tripId=trip_<order.id>` against the same `tripId`. | Renders. No crash. Pickup / dropoff / fare match the accepted order; passenger/driver identity fields use the demo defaults (no SIM_AUDIT content). | `loadPassengerRideView` → `loadCanonicalActiveRide` returns the same seed; `PASSENGER_SUPPORTED_STATUSES` covers `DRIVER_EN_ROUTE`. |
| 8 | Try to accept a stale / unknown order id (manually call `acceptCanonicalRideOrder('order-bogus')` or accept twice from two tabs). | Returns `null`. No new entry in `bazardrive.active_ride.v1`. Driver is redirected to `/order-map-draft`. | `acceptNearbyOrder` returns `null` for stale id; `acceptCanonicalRideOrder` short-circuits; `driver_map.js:289-297` routes to `/order-map-draft`. |
| 9 | Open the existing demo/audit URLs: `#/active-ride?role=driver&tripId=trip_order-demo&status=DRIVER_EN_ROUTE`, `#/active-ride?role=driver&status=DRIVER_EN_ROUTE`, `#/active-ride?role=driver` (no params), `#/active-ride?role=passenger`. | `trip_order-demo`: SIM_AUDIT demo materialized (no persisted record). No tripId + status: same demo materialization with `DEMO_ACTIVE_RIDE_ID`. Bare `?role=driver`: `renderDriverEmpty()`. `?role=passenger`: passenger renderer materializes a demo ride against `DEMO_ACTIVE_RIDE_ID`. | All four branches in `active_ride.js:413-433` / `active_ride_passenger.js:146-171` are unchanged by this audit. |

## 13. Findings

**No defects.** The handoff payload is correct, the canonical record
under `bazardrive.active_ride.v1[trip_<order.id>]` carries the accepted
order's pickup / dropoff / price / distance / ETA verbatim, both
renderers consume it without falling through to
`SIM_AUDIT_RIDE_OVERRIDES`, stale accept ids cannot create orphan
seeds, and existing demo URLs are unaffected.

### Minor observations (informational, no action recommended)

These do not warrant code changes in a docs-only audit:

1. **The seed inherits decorative demo identity.** `passenger.*`,
   `driver.*`, `vehicle.*`, `payment.*` on the seed come from
   `buildDemoRide()` because the BD-DRIVER-01 mock order has no such
   fields to project. This matches the existing contract; the
   passenger ActiveRide top card therefore shows "Рустам К." +
   "Toyota Camry · A 124 ВВ" + "Тинькофф · ...4417" for any accepted
   order. Whenever a real passenger / driver identity is wired in,
   the seeder is the right place to project it. Not a regression.
2. **Zero-valued numeric fields fall back to `'—'`.** When the
   published order has `distanceKm === 0` or `durationMin === 0`, the
   seeder writes the em-dash literal into `order.destinationDistance`
   / `order.destinationEta` / `route.etaToDestination`. That's
   consistent with the rest of the driver sheet's "missing value"
   convention.
3. **Seed `role` is always `'driver'`.** The passenger reader
   succeeds anyway because `loadCanonicalActiveRide` keys by `tripId`
   and does not filter on the stored `role`. This is the explicit
   BD-RIDE-D-10 contract documented in
   `trip_confirmation_handoff.js:206-220`. No follow-up needed.
4. **`trip_<order.id>` is human-friendly but still long.** The
   passenger trip pill renders `№<tripId>` for non-demo trip ids
   (`active_ride_passenger.js:215-220`), so a CTA-driven accept shows
   `№trip_order-1700000000000` in the pill. Not a defect — purely a
   future polish item.

## 14. Recommendation

Land this audit document as the only artifact. No runtime change is
warranted; no `ride_state.js` state-machine edit; no passenger
renderer edit; no `sw.js` precache bump (the precache already covers
all five runtime files this audit touched).

For any follow-up that does require a runtime change (e.g. richer
passenger identity in the seed, distinct demo trip-pill formatting),
the right entry point is `seedActiveRideFromAcceptedOrder` in
`public/src/ride_actions.js` — extending its override block keeps the
single-writer property of the canonical seed.

## Verification

```
$ node scripts/check.mjs
All checks passed.
```

No runtime source files were modified. The audit's only artifact is
this document.
