# BD-ORDER-P-02 — Passenger responses polish smoke

## Scope

Local/mock PWA flow only. `#/responses` now behaves as a passenger dispatch board after BD-ORDER-P-01 publishes an order:

1. «Заказ опубликован» / «Ищем водителей» waiting state.
2. One driver offer state.
3. Multiple offers comparison state.
4. Safe choose-driver handoff into passenger active ride.

No backend, sockets, real Mapbox, real calls, payment, APK or auth work is included.

## Manual URLs

```text
#/responses?state=empty
#/responses?state=list
#/responses?postId=trip-2&state=list
#/responses?orderId=unknown&state=empty
#/responses?orderId=unknown&state=list
#/responses?orderId=unknown&state=selected&driverId=driver_1
#/responses?orderId=<realOrderId>&state=empty
#/responses?orderId=<realOrderId>&state=list
#/responses?orderId=<realOrderId>&state=selected&driverId=driver_1
#/order-map-draft
#/driver-map
#/active-ride?role=passenger&status=DRIVER_EN_ROUTE
#/active-ride?role=driver&status=DRIVER_EN_ROUTE
```

## Expected results

### `#/responses?state=empty`

- Shows title/subtitle language around «Ищем водителей».
- Shows copy: «Заказ опубликован. Водители увидят маршрут и смогут откликнуться.»
- Shows a safe order summary card even with no resolvable order.
- `#/responses?postId=trip-2&state=list` keeps the legacy mock route/price/comment context instead of showing «Заказ пока не выбран».
- Primary CTA: «Проверить отклики».
- Secondary CTA: «Изменить заказ» / «На карту» through the existing order draft flow.
- No visible technical labels such as `empty`, `state`, `mock`, `response object`, `CREATED`.

### `#/responses?orderId=<id>&state=empty`

- If `<id>` exists in `bazardrive.ride_orders.v1`, the summary shows pickup → dropoff, budget, time and passenger comment.
- If `<id>` is unknown, the screen still renders a safe fallback card instead of an error stack.
- Unknown/missing order states are display-only: select/continue shows a safe toast and never writes `bazardrive.active_ride.v1`.
- CTA preserves `orderId` when moving to `state=list`; missing IDs stay on a safe `#/responses?state=list` fallback route.

### `#/responses?orderId=<id>&state=list`

- Shows realistic driver cards with:
  - driver name;
  - rating;
  - car/model and plate;
  - arrival ETA;
  - offered price;
  - driver message;
  - status chip «Есть отклики».
- Actions are passenger-facing and mobile-friendly:
  - «Выбрать водителя»;
  - «Написать»;
  - «Позвонить» (safe local toast, no real call).
- Shows three local mock offers.
- The best offer is visually highlighted.
- Actions remain thumb-friendly.

### `#/responses?orderId=<id>&state=selected&driverId=driver_1`

- Highlights the selected driver snapshot.
- With no resolved canonical order, «К поездке» only shows the safe toast «Сначала откройте опубликованный заказ».
- With a resolved canonical order, «К поездке» reuses or creates only `bazardrive.active_ride.v1[trip_<orderId>]`.
- «Отменить» returns to `#/responses?orderId=<id>&state=list`.

### Choose-driver handoff

- Choosing a driver from a missing/unknown order or legacy `postId` link never seeds active ride storage.
- Choosing a driver from a real order seeds `bazardrive.active_ride.v1` locally when `trip_<orderId>` does not exist yet.
- Reopening `#/responses?orderId=<acceptedOrderId>&state=list` after handoff must reuse the existing `bazardrive.active_ride.v1[trip_<orderId>]` record and must not overwrite its driver, route, passenger or progressed status snapshots.
- The active ride record preserves:
  - `orderId` / route / price snapshot;
  - passenger snapshot from the canonical order when available;
  - selected driver snapshot;
  - vehicle snapshot.
- Navigation target is:

```text
#/active-ride?role=passenger&tripId=trip_<orderId>&status=DRIVER_EN_ROUTE
```

## Regression checks

- Driver map remains a driver surface.
- Driver active ride URLs still render through the existing driver flow.
- Passenger active ride still supports the direct smoke URL with no explicit `tripId`.
- No CSP weakening, inline script/style, backend calls, sockets or Mapbox token work.

## Programmatic check

```bash
node scripts/check.mjs
```
