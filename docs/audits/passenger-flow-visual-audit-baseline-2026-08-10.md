# Passenger flow visual audit baseline (2026-08-10)

Source scope: `route_picker.js`, `order_map_draft.js`, `composer.js`, `feed.js`, `map.js`, `public/src/mapbox/*`.

## P0

- Attach deterministic mock coordinates to route points and carry them into published ride-order payloads (`pickup.lat/lng`, `dropoff.lat/lng`) so driver-map marker visibility is structurally possible.
- Keep `/map` nearby render contract explicit: 5 numbered clusters on map overlay vs top-3 rows in the bottom nearby list (intentional asymmetry).

## P1

- Explicitly separate the two passenger publication intents in UI:
  - Composer `Попутчик` = quick text request without route map semantics.
  - Route Picker flow = route-driven order creation.
- Add explicit copy in `/order-map-draft` that the route estimate becomes the passenger’s final visible price for drivers.

## P2

- Deduplicate phone masking logic into one shared helper and reuse it in `order_map_draft.js` and `composer.js`.
- Replace static feed subtitle text with derived location/date text.

## Verification checklist for this baseline

- `node scripts/check.mjs`
- `node scripts/dispatcher.mjs`
- manual route smoke: `/route-picker` → `/route-preview` → `/order-map-draft`
- manual map/feed smoke: `/map`, `/feed`, `/driver-map`
