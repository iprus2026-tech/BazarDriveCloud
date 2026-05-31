# BD-ORDER-P-02 — Passenger responses polish smoke

## Scope

Local/mock PWA flow only. `/responses` now behaves as a passenger dispatch board after BD-ORDER-P-01 publishes an order:

1. «Заказ опубликован» / «Ищем водителей» waiting state.
2. One driver offer state.
3. Multiple offers comparison state.
4. Safe choose-driver handoff into passenger active ride.

No backend, sockets, real Mapbox, real calls, payment, APK or auth work is included.

## Manual URLs

```text
#/responses?state=empty
#/responses?orderId=demo-order&state=empty
#/responses?state=offer
#/responses?orderId=demo-order&state=offer
#/responses?state=list
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
- Primary CTA: «Проверить отклики».
- Secondary CTA: «Изменить заказ» / «На карту» through the existing order draft flow.
- No visible technical labels such as `empty`, `state`, `mock`, `response object`, `CREATED`.

### `#/responses?orderId=<id>&state=empty`

- If `<id>` exists in `bazardrive.ride_orders.v1`, the summary shows pickup → dropoff, budget, time and passenger comment.
- If `<id>` is unknown, the screen still renders a safe fallback card instead of an error stack.
- CTA preserves `orderId` when moving to `state=offer`.

### `#/responses?state=offer`

- Shows a driver card with:
  - driver name;
  - rating;
  - car/model and plate;
  - arrival ETA;
  - offered price;
  - driver message;
  - status chip «Отклик водителя».
- Actions are passenger-facing and mobile-friendly:
  - «Выбрать водителя»;
  - «Написать»;
  - «Позвонить» (safe local toast, no real call).

### `#/responses?state=list`

- Shows three local mock offers.
- The best offer is visually highlighted.
- Actions remain thumb-friendly.

### Choose-driver handoff

- Choosing a driver seeds `bazardrive.active_ride.v1` locally when `trip_<orderId>` does not exist yet.
- Reopening `#/responses?orderId=<acceptedOrderId>&state=offer` after handoff must reuse the existing `bazardrive.active_ride.v1[trip_<orderId>]` record and must not overwrite its driver, route, passenger or progressed status snapshots.
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
