# BD-DRIVER-MAP — Passenger order acceptance smoke

Runtime smoke for the end-to-end driver acceptance flow:

> passenger creates an order → driver sees it on `/driver-map` → driver accepts → the order becomes an active trip.

This is a **runtime smoke, not a visual-parity task**. No new render gates, no UI
changes, no Claude/Cloud Design. The accept pipe was confirmed against the real
modules (`ride_state.js`, `mock_api.js`, `ride_actions.js`) with a headless
`localStorage` shim, plus a source review of the DOM screens that delegate to them.

## Scope

Confirms the canonical accept pipe wired through the shared spine:

```text
DriverMap (Принять)
→ acceptCanonicalRideOrder(orderId)        // ride_actions.js
→ acceptNearbyOrder(orderId)               // mock_api.js   CREATED → ACCEPTED
→ seedActiveRideFromAcceptedOrder(accepted)// ride_actions.js
→ saveActiveRide(ride)                      // ride_state.js  active_ride.v1[tripId]
→ /active-ride?role=driver&tripId=<tripId>&status=ACCEPTED
```

Out of scope (and explicitly NOT touched): backend, real Mapbox SDK / token, CSP,
service worker, the ride state machine, DriverMap rewrite, passenger ActiveRide
redesign, payments, push, driver assignment.

## Files inspected

| File | What was checked |
| --- | --- |
| [public/src/screens/order_map_draft.js](../../public/src/screens/order_map_draft.js) | Passenger order creation payload + passenger snapshot capture (`publishOrder` → `createRideOrder`). |
| [public/src/mock_api.js](../../public/src/mock_api.js) | `createRideOrder`, `listNearbyOrders`, `acceptNearbyOrder`, `getOrderById`, `rideOrderToFeedPost`, `findLatestHandedOffOrderTripId`, lifecycle transitions. |
| [public/src/ride_actions.js](../../public/src/ride_actions.js) | `acceptCanonicalRideOrder`, `seedActiveRideFromAcceptedOrder`, `buildRouteSnapshotFromOrder`, passenger snapshot replacement (no demo leak). |
| [public/src/ride_state.js](../../public/src/ride_state.js) | `saveActiveRide`, `findActiveRide`, demo-ride boundaries, status timestamps. |
| [public/src/screens/driver_map.js](../../public/src/screens/driver_map.js) | Nearby list, accept handler, accepted sheet, `К поездке` CTA URL, role guard. |
| [public/src/screens/active_ride.js](../../public/src/screens/active_ride.js) | Driver deep-link read path, persisted-canonical-ride-before-demo fallback. |
| [public/src/screens/feed.js](../../public/src/screens/feed.js) | Canonical ride-order projection accept + refresh-on-stale. |
| [docs/smoke/BD-DRIVER-03-order-accept-smoke.md](BD-DRIVER-03-order-accept-smoke.md) | Prior source-level smoke baseline. |

## localStorage keys

Clear ONLY these two before the manual run (a clean profile works too):

```js
localStorage.removeItem('bazardrive.ride_orders.v1');
localStorage.removeItem('bazardrive.active_ride.v1');
```

- `bazardrive.ride_orders.v1` — canonical ride orders (CREATED → ACCEPTED → …).
- `bazardrive.active_ride.v1` — active-ride records keyed by `tripId`.

## Manual smoke steps

1. Clear the two keys above.
2. Build a route (`/route-picker` → `/route-preview`) and open `/order-map-draft`.
3. Publish the order (`Опубликовать заказ`). Confirm `bazardrive.ride_orders.v1[0]`
   exists with `status: 'CREATED'`, `pickup`, `dropoff`, `estimatedPrice`, and a
   `passenger` snapshot.
4. Switch the user to the **driver** role via the existing profile/state flow
   (do **not** add `?role=driver` to the URL — the guard ignores the URL on purpose).
5. Open `/driver-map`. Confirm the order is listed under «заказов рядом» with a
   `Принять` button.
6. Tap `Принять`. Confirm the order flips `CREATED → ACCEPTED`, gains `acceptedAt`,
   and an active ride is seeded under `trip_<order.id>`.
7. On the accepted sheet confirm «Заказ принят», the route + price match the order,
   and tap `К поездке`.
8. Confirm the URL is `/active-ride?role=driver&tripId=<tripId>&status=ACCEPTED`.
9. Refresh `/active-ride`. Confirm pickup/dropoff/price match the order, the
   passenger is **not** swapped for the demo «Анна М.», and there is no random
   demo-ride fallback.
10. Return to `/driver-map` — the accepted order is gone from the nearby list.
11. Open `/feed` — the accepted canonical ride-order is no longer an open card.
12. Double accept: re-trigger accept on the same `orderId` — no second active ride,
    status does not revert to `CREATED`, the order does not reappear.
13. Role guard: switch to passenger/guest, open `/driver-map` — no working list,
    no `Принять`, the «Это экран водителя» guard renders.

## Expected CREATED snapshot — `bazardrive.ride_orders.v1[0]`

```jsonc
{
  "id": "order-<timestamp>",
  "type": "passenger_request",
  "source": "map",
  "pickup":  { "id": "p1", "label": "ул. Малая Бронная, 28" },
  "dropoff": { "id": "d1", "label": "Шереметьево, терминал В" },
  "distanceKm": 38,
  "durationMin": 42,
  "estimatedPrice": 1480,
  "estimatedPriceLabel": "",
  "scheduledMode": "now",
  "scheduledAt": "<iso>",
  "comment": "Подъезд №3",
  "passenger": {
    "name": "Вы",
    "initials": "В",
    "phoneMasked": "+7 (905) ··· 12-34",
    "comment": "Подъезд №3",
    "authorId": "local-user",
    "isCurrentUser": true
  },
  "status": "CREATED",
  "createdAt": "<iso>"
}
```

## Expected ACCEPTED snapshot — same row after `Принять`

```jsonc
{
  // …unchanged fields…
  "status": "ACCEPTED",
  "acceptedAt": "<iso>"     // newly added; status is the only mutated field + acceptedAt
}
```

## Expected active-ride snapshot — `bazardrive.active_ride.v1["trip_<order.id>"]`

```jsonc
{
  "tripId": "trip_order-<timestamp>",
  "role": "driver",
  "status": "ACCEPTED",
  "passenger": {
    "name": "Вы",            // from the order snapshot — NOT demo "Анна М."
    "initials": "В",
    "phoneMasked": "+7 (905) ··· 12-34",
    "note": "Подъезд №3",
    "rating": "",            // demo rating/luggage do NOT leak in
    "luggage": "",
    "authorId": "local-user",
    "isCurrentUser": true
  },
  "order": {
    "offerPrice": "1 480 ₽", // derived from estimatedPrice 1480 (NBSP separator)
    "destinationDistance": "38 км",
    "destinationEta": "42 мин"
  },
  "route": {
    "pickupLabel": "ул. Малая Бронная, 28",
    "dropoffLabel": "Шереметьево, терминал В",
    "etaToDestination": "42 мин"
  },
  "ride": { "price": "1 480 ₽" },
  "timestamps": { "acceptedAt": "<iso>" },
  "orderId": "order-<timestamp>"
}
```

> Note: the `1 480 ₽` separator is a non-breaking space (U+00A0) from
> `Number.toLocaleString('ru-RU')`, not an ASCII space. The price is derived from
> the order's `estimatedPrice` (1480) — it is not a hard-coded demo value.

## URLs

```text
/order-map-draft
/driver-map
/feed
/active-ride?role=driver&tripId=trip_order-<timestamp>&status=ACCEPTED
```

## Double-accept behavior

1. First accept: `CREATED → ACCEPTED`, seeds `trip_<order.id>`.
2. Second accept on the same id: `acceptNearbyOrder()` only rewrites a row whose
   status is exactly `CREATED`, so it returns `null`; `acceptCanonicalRideOrder()`
   short-circuits and seeds nothing.
3. Result: no second active-ride record, status stays `ACCEPTED`, and the order
   stays out of `listNearbyOrders()` and the Feed projection.

DriverMap routes a stale/null accept to `/order-map-draft` instead of creating an
orphan ride ([driver_map.js:387-397](../../public/src/screens/driver_map.js#L387-L397)).

## Role guard

`/driver-map` resolves the role exclusively from persisted state via
`resolveEffectiveRole()` (reads `user.get().role`) and renders
`renderPassengerGuard()` for any non-driver role
([driver_map.js:346-349](../../public/src/screens/driver_map.js#L346-L349)). The
URL hash is intentionally not consulted, so `#/driver-map?role=driver` cannot
bypass the guard. The guard surface exposes no `data-action="accept"`. This is
regression-locked by `scripts/smoke-driver-map-guard.mjs`, which
`node scripts/check.mjs` runs.

## Runtime confirmation

The pipe was driven end-to-end against the real modules with a `localStorage`
shim (the same headless pattern as `scripts/smoke-lifecycle.mjs`). All assertions
passed:

- CREATED snapshot: status / pickup / dropoff / estimatedPrice / passenger present.
- Visible in `listNearbyOrders()` and as a Feed projection pre-accept.
- `acceptCanonicalRideOrder(id)` → `tripId === trip_<order.id>`, order `ACCEPTED`,
  `acceptedAt` set.
- Active ride seeded: `role: driver`, `status: ACCEPTED`, pickup/dropoff/price
  match the order, passenger from the order snapshot (no demo «Анна М.», no
  rating/luggage leak), `orderId` linked.
- CTA URL: `role=driver`, `tripId=trip_order-…`, `status=ACCEPTED`.
- Refresh: `findActiveRide(tripId)` (what `loadCanonicalActiveRide` reads first)
  resolves the same record; pickup/dropoff/price/passenger persist;
  `findLatestHandedOffOrderTripId()` resolves the bare driver URL to this trip.
- After accept: excluded from `listNearbyOrders()`, `rideOrderToFeedPost()` → null,
  excluded from `listRideOrdersAsFeedPosts()`.
- Double accept: second call returns `null`, no second active ride, status stays
  `ACCEPTED`, order does not reappear in DriverMap/Feed.

`scripts/smoke-lifecycle.mjs` (covering the same accept pipe plus the full
driver/passenger lifecycle) was run and reported `ALL PASSED` (54/54).

## Result

**PASS.** No runtime defect found in the passenger-order acceptance flow. No source
change required — the accept pipe is already wired through the canonical spine and
the role guard holds. This is a docs-only smoke.

## Known limitations

- Headless runtime confirmation drives the data pipe (the importable logic modules);
  the DOM screens (`driver_map.js`, `active_ride.js`, `order_map_draft.js`,
  `feed.js`) were confirmed by source review, since they import the router /
  MapShell DOM layer that does not load under Node. The manual steps above cover
  the in-browser surface.
- Mapbox is the static MapShell placeholder; no real map, token, or geolocation.
- Active-ride demo fields outside the accepted route/price/passenger contract
  (driver identity, commission, shift stats) remain demo seed values — out of
  scope for this acceptance smoke.
