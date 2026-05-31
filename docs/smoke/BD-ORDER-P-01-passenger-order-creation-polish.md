# BD-ORDER-P-01 Passenger order creation final polish

Final UI/flow polish for the passenger order creation path so it reads as a
complete, role-clear journey:

```text
Passenger → Map / New order → Route selection → Order draft → Publish
         → Success state → Driver responses
```

This is a UI/copy polish task. No backend, no real Mapbox, no APK, no canonical
order-status redesign, no CSP weakening, no inline script/style.

Related work:

- BD-ROLE-01 — role-aware create flow (passenger ⇒ passenger request,
  driver ⇒ driver offer, explicit driver→passenger notice + switch back) (#300, #302)
- BD-MAP-05 — passenger request status chip / redirect to `/responses`

## Summary

Overall: **PASS**

The passenger order flow was already wired end to end; this pass tightens the
copy so the success state matches the contract and removes technical wording
(`request` / `draft` / `created` / `state`) from the visible UI.

Changes:

- `order_map_draft.js` success state hint → `Водители увидят маршрут и смогут
  откликнуться.`
- `order_map_draft.js` success primary CTA → `Смотреть отклики`
  (still `data-action="my-order"` → `/responses?orderId=<id>&state=empty`).
- `order_map_draft.js` topbar pills now use natural Russian:
  `ОПУБЛИКОВАН` / `МАРШРУТ НЕ ВЫБРАН` / `НОВЫЙ ЗАКАЗ`
  (was `CREATED` / `ROUTEDRAFT ОТСУТСТВУЕТ` / `ЧЕРНОВИК МАРШРУТА`).
  The canonical order `status` value (`CREATED`) is unchanged — only the pill
  label is polished.
- `responses.js` empty-state body aligned to `Заказ опубликован. Водители
  увидят маршрут и смогут откликнуться …`.
- `docs/screen-contracts.md` success/missing copy updated to match.

No change to the publish pipeline, passenger snapshot capture, the driver-map
accept flow, or active-ride flow.

## Checks

`node scripts/check.mjs`: **PASS** — `All checks passed.`

## Passenger order flow after polish

1. **Entry** — Passenger taps create (profile/empty-state CTA resolves to
   `#/new?type=passenger_request`) or goes through `#/map` →
   `#/route-picker` → `#/route-preview` → `#/order-map-draft`.
2. **Draft** — `/order-map-draft` reads the persisted `routeDraft`. Valid draft
   renders the editable order card (`НОВЫЙ ЗАКАЗ` pill). Missing/corrupt draft
   renders a safe empty card with a `Выбрать маршрут` CTA — the screen never
   crashes.
3. **Publish** — Validates, then `createRideOrder({ type: 'passenger_request',
   …, passenger })` writes a canonical order with `status: 'CREATED'` and a
   per-order passenger snapshot captured from the current user (no demo
   `Анна М.` identity).
4. **Success state** — `ОПУБЛИКОВАН` pill, title `Заказ опубликован`, status
   `Ищем водителей`, hint `Водители увидят маршрут и смогут откликнуться.`,
   primary CTA `Смотреть отклики`, secondary `В ленту`.
5. **Responses** — CTA opens `#/responses?orderId=<id>&state=empty`. The
   canonical order id is preserved and resolved by `resolveCanonicalOrder()`;
   the published route/price/snapshot render in the request card. Opening
   `/responses` without an `orderId` falls back to a safe empty state rather
   than throwing.

## Role boundary

- Passenger role default ⇒ passenger request; driver role default ⇒ driver
  offer (`defaultTypeForRole`).
- Driver who explicitly opens the passenger chip sees the visible warning
  notice plus a one-tap `Создать как водитель` switch back (composer
  `updateRoleNote` / `#composer-role-switch`). Never a silent cross-role order.

## Manual smoke matrix

| URL | Expected | Result |
| --- | --- | --- |
| `#/new?type=passenger_request` | Passenger request mode active. | PASS |
| `#/new?type=driver_offer` | Driver offer mode active. | PASS |
| `#/map` | Passenger map entry. | PASS |
| `#/route-picker` | Route point selection. | PASS |
| `#/route-preview` | Route preview before draft. | PASS |
| `#/order-map-draft` | Valid draft ⇒ editable order card; empty draft ⇒ safe empty card + `Выбрать маршрут`. | PASS |
| `#/order-map-draft` (publish) | Success state shows `Заказ опубликован` + `Ищем водителей`; CTA `Смотреть отклики` → `/responses?orderId=<id>&state=empty`. | PASS |
| `#/responses?state=empty` | Empty waiting state, no error. | PASS |
| `#/responses?orderId=demo-order&state=empty` | Unknown id ⇒ safe fallback request card, no crash. | PASS |
| `#/driver-map` | Driver accept flow unchanged. | PASS |
| `#/active-ride?role=driver&status=DRIVER_EN_ROUTE` | Driver active ride unchanged. | PASS |
| `#/active-ride?role=passenger&status=DRIVER_EN_ROUTE` | Passenger active ride unchanged. | PASS |

## Acceptance checklist

- [x] `#/new?type=passenger_request` opens passenger request mode
- [x] passenger role defaults to passenger request
- [x] driver role defaults to driver offer
- [x] driver on passenger request sees explicit visible notice + switch back
- [x] `#/order-map-draft` with valid `routeDraft` publishes an order
- [x] publish success state shows `Заказ опубликован` and `Ищем водителей`
- [x] publish CTA opens `#/responses?orderId=<id>&state=empty`
- [x] `/responses` with `orderId` shows the correct passenger request context
- [x] passenger snapshot is preserved
- [x] demo passenger identity does not leak into new orders
- [x] empty `routeDraft` does not break the screen
- [x] `node scripts/check.mjs` passes
