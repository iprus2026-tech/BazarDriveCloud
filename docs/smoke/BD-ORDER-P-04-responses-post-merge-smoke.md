# BD-ORDER-P-04 — Passenger responses post-merge smoke

## Summary
Overall: PASS

Docs-only post-merge smoke audit for PR #308. No runtime regression was confirmed, so no runtime code, backend, Mapbox, push, CSP, inline script/style, or service worker changes were made.

Audit basis:

- `node scripts/check.mjs` passed.
- Source-level smoke verified the `/responses` hash-router paths added by PR #308.
- A temporary module-level storage check created a representative local passenger order (`order-1780245407553`) and confirmed the active-ride store can be limited to the canonical key (`trip_order-1780245407553`) without creating `trip_responses_fallback`.

## Checks
node scripts/check.mjs:
PASS

## Manual smoke matrix

| URL | Expected | Actual | Result |
| --- | --- | --- | --- |
| `#/responses?state=empty` | safe waiting fallback | Renders the waiting state with fallback request copy, no crash, and the CTA keeps the user inside safe responses/order-map surfaces. | PASS |
| `#/responses?state=list` | safe list/mock view, no active ride seed | Renders three mock driver offers with fallback pricing (`По договорённости`) and no canonical order, so select/continue is blocked by the safe toast before any active-ride write. | PASS |
| `#/responses?postId=trip-2&state=list` | legacy mock context | Renders the legacy mock request context from `postId=trip-2` instead of the missing-order copy; legacy `postId` does not resolve a canonical order and cannot hand off to ActiveRide. | PASS |
| `#/responses?orderId=unknown&state=empty` | safe fallback | Renders the unknown-order fallback (`Заказ не найден` / return-to-map guidance), does not crash, and remains display-only. | PASS |
| `#/responses?orderId=unknown&state=list` | safe fallback/list, no active ride seed | Renders fallback list/offers for the unknown id, with no canonical order; driver selection is blocked before persistence. | PASS |
| `#/responses?orderId=unknown&state=selected&driverId=driver_1` | blocked handoff, no active ride seed | Preserves selected-driver UI, but `К поездке` is guarded by missing canonical order and shows the safe toast instead of writing an active ride. | PASS |
| `#/responses?orderId=<realOrderId>&state=empty` | real order context | For representative `order-1780245407553`, the canonical order path resolves the stored order and renders real pickup/dropoff/price/time/comment context rather than fallback copy. | PASS |
| `#/responses?orderId=<realOrderId>&state=list` | real order offers | Real order context is retained and driver offers are built from the order price with realistic price deltas and driver snapshots. | PASS |
| `#/responses?orderId=<realOrderId>&state=selected&driverId=driver_1` | selected driver snapshot | Selected `driver_1` remains highlighted, the selected-driver snapshot is used for the handoff payload, and the visible continuation control is `К поездке`. | PASS |
| `#/responses?orderId=<realOrderId>&state=all-declined` | all-declined state still works | The list route still renders the all-declined status chip/notice and declined cards without changing storage. | PASS |
| `#/active-ride?role=passenger&tripId=trip_<realOrderId>&status=DRIVER_EN_ROUTE` | same persisted active ride | Passenger ActiveRide reads the same canonical active-ride record for `trip_<realOrderId>` when present; status query is display-safe and does not create a duplicate ride. | PASS |

## localStorage assertions

Confirm:

- no `trip_responses_fallback` key is written — PASS. The `/responses` selected/continue handler returns before handoff when `canonicalOrder` is missing, and the storage check confirmed no `bazardrive.active_ride.v1[trip_responses_fallback]` key exists after fallback reads.
- real order handoff writes or reuses only `trip_<realOrderId>` — PASS. The handoff builder derives `tripId = trip_<order.id>`, reuses an existing ride via `findActiveRide(tripId)`, and otherwise saves one ride under that key.
- legacy `postId` does not write active ride — PASS. `postId` populates a legacy mock request with `orderId: ''`; because it never resolves `canonicalOrder`, selected/continue is blocked before persistence.
- unknown `orderId` does not write active ride — PASS. `getOrderById('unknown')` returns `null`; selected/continue is blocked by the same canonical-order guard, so no synthetic trip is written.

Temporary storage-check output:

```json
{
  "orderId": "order-1780245407553",
  "tripId": "trip_order-1780245407553",
  "activeRideKeys": [
    "trip_order-1780245407553"
  ]
}
```

## Regressions found

- none

## Follow-ups

- create follow-up issues only for confirmed regressions

## Files inspected

| File | What was checked |
| --- | --- |
| `public/src/screens/responses.js` | Missing/unknown order fallback copy, legacy `postId` request, driver offer rendering, selected-driver `К поездке` action, canonical-order guard, idempotent real-order ActiveRide handoff, and all-declined rendering. |
| `public/src/mock_api.js` | `bazardrive.ride_orders.v1`, `createRideOrder()`, `getOrderById()`, and `acceptOrder()` behavior for real and unknown order ids. |
| `public/src/ride_state.js` | `bazardrive.active_ride.v1`, read-only `findActiveRide()`, keyed `saveActiveRide()`, and idempotent keyed storage semantics. |
| `public/src/screens/active_ride.js` | ActiveRide routing by `role`, canonical read-before-fallback for explicit `tripId`, and safe in-memory status query handling. |
| `public/src/screens/active_ride_passenger.js` | Passenger ActiveRide canonical read path and view-only fallback when no canonical record exists. |
| `public/src/screens/order_map_draft.js` | Passenger order publish path and success CTA carrying the new `orderId` to `/responses?orderId=<id>&state=empty`. |
| `public/sw.js` | Confirmed unchanged; docs-only audit did not require a service worker bump. |

## Notes

- Hash-router URLs only were used in the matrix.
- Bottom navigation and existing `empty` / `list` / `selected` / `all-declined` states remain covered by the inspected render branches.
- No visible technical labels were found in the audited `/responses` user-facing copy; debug/storage keys remain internal only.
