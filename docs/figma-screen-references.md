# BazarDriveCloud — Figma screen reference overlay

> **Layer:** Cloud Design / Figma / Docs / Screen contracts.  
> **Runtime impact:** none.  
> **Snapshot baseline:** `main@d1aea15ff046cfef474648c99c2668966c2d38f8` (2026-09-02).  
> **Figma file:** https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd/BazarDriveCloud-Architecture-Screen-References

This document is an **overlay**, not a third screen source of truth.

```text
ScreenOps registry
  → canonical screenId + product route + runtime file
Screen contract
  → state + data + actions + acceptance
Figma / Cloud Design
  → visual + interaction reference for that canonical screen
Runtime PWA
  → implementation
Backend / DB
  → product source of truth after activation
```

Canonical IDs come from `public/src/ops/ops_registry.js`. Figma may attach design-family aliases in `designIds[]`, but automation must never join on a compound/range alias. Query-string examples belong in `urlVariants[]`; the canonical `route` stays equal to the ScreenOps route.

A Figma frame or node is never a source of order, offer, Ride, profile, notification, payment, rating or history state.

## Figma pages

| Page | Figma node | Purpose |
|---|---|---|
| `01 Architecture` | [`1:12`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=1-12) | Mini-Yonder services, authority corridor, shipped/partial/dark boundaries. |
| `02 Screen References` | [`2:3`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-3) | Canonical ScreenOps ID → route → runtime file → architecture layer → Figma reference state. |

## Canonical screen references

| Canonical ScreenOps ID | Route | Runtime file | Figma state | Figma node |
|---|---|---|---|---|
| BD-ONBOARDING-01 | `/welcome` (`/onboarding` host variant) | `public/src/screens/welcome.js`, `onboarding.js` | current | [`2:8`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-8) |
| BD-FEED-01 | `/feed` | `public/src/screens/feed.js` | current | [`2:24`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-24) |
| BD-POST-01 | `/post` | `public/src/screens/post_detail.js` | current | [`2:296`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-296) |
| BD-COMPOSER-01 | `/new` | `public/src/screens/composer.js` | current | [`2:40`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-40) |
| BD-MAP-01 | `/map` | `public/src/screens/map.js` | current | [`2:72`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-72) |
| BD-MAP-02 | `/location-permission` | `public/src/screens/location_permission.js` | current | [`2:88`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-88) |
| BD-MAP-03 | `/route-picker` | `public/src/screens/route_picker.js` | current | [`2:104`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-104) |
| BD-MAP-04 | `/route-preview` | `public/src/screens/route_preview.js` | current | [`2:120`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-120) |
| BD-MAP-05 | `/order-map-draft` | `public/src/screens/order_map_draft.js` | current | [`2:136`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-136) |
| BD-ORDER-DETAIL-01 | `/order` | `public/src/screens/order_detail.js` | current | [`2:152`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-152) |
| BD-RESPONSES-01 | `/responses` | `public/src/screens/responses.js` | current | [`2:200`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-200) |
| BD-RESPOND-01 | `/respond` | `public/src/screens/respond.js` | current | [`2:184`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-184) |
| BD-CONFIRM-01 | `/trip-confirmation` | `public/src/screens/trip_confirmation.js` | current | [`2:232`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-232) |
| BD-RIDE-D-02 | `/active-ride` | `public/src/screens/active_ride.js` | current | [`2:264`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-264) |
| BD-RIDE-P-01 | `/active-ride` | `public/src/screens/active_ride_passenger.js` | current | [`2:248`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-248) |
| BD-DRIVER-01 | `/driver-map` | `public/src/screens/driver_map.js` | current | [`2:168`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-168) |
| BD-CHAT-01 | `/chat` | `public/src/screens/chat.js` | current | [`2:216`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-216) |
| BD-INBOX-01 | `/inbox` | `public/src/screens/inbox.js` | current | [`2:280`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-280) |
| BD-DAILY-COMM-01 | `/daily-communication` | `public/src/screens/daily_communication.js` | **render-pending** | none yet |
| BD-RIDE-HISTORY-D-01 | `/receipt` | `public/src/screens/trip_receipt.js` | current | [`2:344`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-344) |
| BD-PROFILE-01 | `/profile` | `public/src/screens/profile.js` | current | [`2:56`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-56) |
| BD-SETTINGS-01 | `/settings` | `public/src/screens/settings.js` | current | [`2:328`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-328) |
| BD-RULES-01 | `/rules` | `public/src/screens/rules.js` | current | [`2:312`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-312) |

### Explicit exclusion

`/ops/screens` is a dev/docs route and the ScreenOps registry UI itself. It is intentionally excluded from product Figma coverage and is recorded in `docs/figma-screen-references.json.exclusions` rather than silently omitted.

## Variant rules

- `screenId` is always one exact canonical ScreenOps ID.
- `route` is always the ScreenOps product route and never contains `?` or a path placeholder.
- `urlVariants[]` carries query/path examples such as `/chat?tripId=…`, `/order/<id>` and role-specific active-ride URLs.
- `designIds[]` may preserve design-family aliases such as `BD-RIDE-D-01..09`, but these aliases are never canonical automation keys.
- A product screen without a Figma frame remains in the overlay with `nodeId: null` and `renderStatus: render-pending`.

## Cloud Code / implementation handoff contract

Every future screen task should carry:

```text
canonical ScreenOps screenId
Figma fileKey + nodeId (or render-pending)
route + urlVariants
runtime file(s)
role variant
architecture layer
stored data / source of truth
state transitions affected
backend/API contract (if any)
smoke/check owner
```

If a task is only visual/layout, Figma is the design gate and backend/runtime authority must not change.

If a task changes data, status, order, driver, response, Ride, profile, rating, notification or history, document first: what is stored, where, who writes, who reads, which state changes, and which Figma frames merely project that authoritative state.

## Drift guard

`scripts/smoke-figma-screen-registry.mjs` treats ScreenOps as canonical and fails when:

- a ScreenOps product screen has no Figma overlay decision;
- a Figma `screenId` is not a canonical ScreenOps ID;
- a canonical route or primary runtime file drifts;
- a compound/range alias leaks into `screenId`;
- `renderStatus: current` has no node, or `render-pending` pretends to have one;
- the `/ops/screens` dev/docs exclusion disappears.

The CI workflow runs this smoke after `scripts/check.mjs`.

## Remaining docs drift

`docs/screen-contracts.md` still contains older Mapbox wording from before BD-MAP-ACTIVATE. The authoritative runtime fact is: vendored Mapbox GL + a URL-restricted Pages token activate real `/map`; MapShell remains the dark/failure fallback; server Route & Price is still DARK. This file must be synchronized without changing runtime behavior.
