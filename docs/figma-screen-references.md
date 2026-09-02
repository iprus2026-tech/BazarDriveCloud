# BazarDriveCloud — Figma screen reference registry

> **Layer:** Cloud Design / Figma / Docs / Screen contracts.  
> **Runtime impact:** none.  
> **Snapshot baseline:** `main@a2f578bd50bac538e7f95ee945088341789ba6de` (2026-09-02).  
> **Figma file:** https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd/BazarDriveCloud-Architecture-Screen-References

This document binds the replaceable interface layer to the Mini-Yonder architecture and the runtime source tree.

```text
Figma / Cloud Design
  → interaction and visual intent
Screen contract
  → route + state + data + acceptance
Runtime PWA
  → implementation
Backend / DB
  → product source of truth after activation
```

A Figma frame or node is never a source of order, offer, Ride, profile, notification, payment, rating or history state.

## Figma pages

| Page | Figma node | Purpose |
|---|---|---|
| `01 Architecture` | [`1:12`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=1-12) | Mini-Yonder services, authority corridor, shipped/partial/dark boundaries. |
| `02 Screen References` | [`2:3`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-3) | Screen ID → route → runtime file → role → architecture layer → design-reference state. |

## Screen references

| Screen | Route | Runtime file | Architecture link | Figma node |
|---|---|---|---|---|
| BD-ONBOARDING-01 | `/welcome`, `/onboarding` | `public/src/screens/welcome.js`, `onboarding.js` | Passenger/Driver entry | [`2:8`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-8) |
| BD-FEED-01 | `/feed` | `public/src/screens/feed.js` | Passenger + Driver discovery | [`2:24`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-24) |
| BD-COMPOSER-01 | `/new` | `public/src/screens/composer.js` | PWA / Store | [`2:40`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-40) |
| BD-PROFILE-01/02 | `/profile` | `public/src/screens/profile.js` | Identity / Driver readiness | [`2:56`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-56) |
| BD-MAP-01 | `/map` | `public/src/screens/map.js` | Real Mapbox on Pages / Route & Price future | [`2:72`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-72) |
| BD-MAP-02 | `/location-permission` | `public/src/screens/location_permission.js` | Geolocation gate | [`2:88`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-88) |
| BD-MAP-03 | `/route-picker` | `public/src/screens/route_picker.js` | Route draft / Mapbox | [`2:104`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-104) |
| BD-MAP-04 | `/route-preview` | `public/src/screens/route_preview.js` | Route & Price | [`2:120`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-120) |
| BD-MAP-05 | `/order-map-draft` | `public/src/screens/order_map_draft.js` | Order creation / Store/API seam | [`2:136`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-136) |
| BD-ORDER-DETAIL-01 | `/order/<id>` | `public/src/screens/order_detail.js` | Orders / Matching | [`2:152`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-152) |
| BD-DRIVER-01 | `/driver-map` | `public/src/screens/driver_map.js` | Availability / Dispatcher | [`2:168`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-168) |
| BD-RESPOND-01 | `/respond?postId=…` | `public/src/screens/respond.js` | Offers / Matching | [`2:184`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-184) |
| BD-RESPONSES-01 | `/responses` | `public/src/screens/responses.js` | Matching / Select authority | [`2:200`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-200) |
| BD-CHAT-01 | `/chat?tripId=…`, `/chat?responseId=…` | `public/src/screens/chat.js` | Chat / participant auth | [`2:216`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-216) |
| BD-CONFIRM-01 | `/trip-confirmation` | `public/src/screens/trip_confirmation.js` | Handoff / Ride bootstrap | [`2:232`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-232) |
| BD-RIDE-P-01..07 | `/active-ride?role=passenger` | `public/src/screens/active_ride_passenger.js` | Ride State Machine | [`2:248`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-248) |
| BD-RIDE-D-01..09 | `/active-ride?role=driver` | `public/src/screens/active_ride.js` | Ride State / Availability | [`2:264`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-264) |
| BD-INBOX-01 | `/inbox` | `public/src/screens/inbox.js` | Notification projection / service #6 | [`2:280`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-280) |
| BD-POST-01 | `/post?id=…` | `public/src/screens/post_detail.js` | Feed detail / action routing | [`2:296`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-296) |
| BD-RULES-01 | `/rules` | `public/src/screens/rules.js` | Static policy UI | [`2:312`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-312) |
| BD-SETTINGS-01 | `/settings` | `public/src/screens/settings.js` | Preferences / role-aware shell | [`2:328`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-328) |
| BD-RECEIPT-01 | `/receipt?tripId=…` | `public/src/screens/trip_receipt.js` | History & Receipt #8 | [`2:344`](https://www.figma.com/design/DWA1DhPOT5ib2sFZQAqNUd?node-id=2-344) |

## Cloud Code / implementation handoff contract

Every future screen task should carry:

```text
Screen ID
Figma fileKey + nodeId
route
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

## Drift found during reference pass

The older `docs/screen-map.md` snapshot still describes Mapbox as placeholder-only. Current `main` has vendored Mapbox GL and an enabled URL-restricted Pages token; `/map` is active on the GitHub Pages origin. This Figma registry uses the current runtime fact. The stale screen-map wording should be corrected in a separate docs-sync slice.
