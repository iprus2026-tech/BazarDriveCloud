# BazarDriveCloud screen contracts

This document keeps the dispatcher development line grounded: every screen should have a Cloud Design render/frame, route, file path, state contract, actions, and acceptance checklist before implementation or audit work moves forward.

**BD-DOCS-01 status:** this file now reflects the current `main` code after the routines/storage-boundary audit. It is a docs snapshot of the app shell, route registry, storage ownership, and implemented mock-only taxi flow.

Parent tracking issue: #19

---

## 1. Dispatcher line

```text
Cloud Design render/frame
↓
Screen contract
↓
GitHub issue
↓
Feature branch
↓
Implementation
↓
node scripts/check.mjs
↓
Pull Request
↓
Review against Cloud Design
↓
Merge to main
```

Do not move a new screen from design to code unless the route, file path, state keys, actions, and acceptance checklist are explicit.

---

## 2. Current route registry

Registered in `public/src/app.js`.

| Route | Screen id | File | Current status |
|---|---|---|---|
| `/welcome` | BD-ONBOARDING-01 | `public/src/screens/welcome.js` | implemented |
| `/onboarding` | BD-ONBOARDING-01 | `public/src/screens/onboarding.js` | implemented |
| `/feed` | BD-FEED-01 | `public/src/screens/feed.js` | implemented |
| `/map` | BD-MAP-01 | `public/src/screens/map.js` | implemented, mock MapShell only |
| `/location-permission` | BD-MAP-02 | `public/src/screens/location_permission.js` | implemented, mock permission UX |
| `/driver-map` | BD-DRIVER-01 / BD-DRIVER-02 | `public/src/screens/driver_map.js` | implemented, mock orders only; `isDriverLineReady()` readiness gate (BD-DRIVER-02) |
| `/route-picker` | BD-MAP-03 | `public/src/screens/route_picker.js` | implemented, route draft store |
| `/route-preview` | BD-MAP-04 | `public/src/screens/route_preview.js` | implemented, route preview mock |
| `/order-map-draft` | BD-MAP-05 | `public/src/screens/order_map_draft.js` | implemented, creates local ride order |
| `/rules` | BD-RULES-01 | `public/src/screens/rules.js` | implemented |
| `/profile` | BD-PROFILE-01/02 | `public/src/screens/profile.js` | implemented, passenger + driver |
| `/new` | BD-COMPOSER-01 | `public/src/screens/composer.js` | implemented |
| `/respond` | BD-RESPOND-01 | `public/src/screens/respond.js` | implemented |
| `/chat` | BD-CHAT-01 | `public/src/screens/chat.js` | implemented |
| `/active-ride` | BD-RIDE-D/P | `public/src/screens/active_ride.js` | implemented, role dispatch by `?role=` |
| `/responses` | BD-RESPONSES-01 | `public/src/screens/responses.js` | implemented |
| `/trip-confirmation` | BD-CONFIRM-01 | `public/src/screens/trip_confirmation.js` | implemented |
| `/post` | BD-POST-01 | `public/src/screens/post_detail.js` | implemented |
| `/inbox` | BD-INBOX-01 | `public/src/screens/inbox.js` | implemented |
| `/receipt` | BD-RIDE-HISTORY-D-01 | `public/src/screens/trip_receipt.js` | implemented, driver completed-ride receipt by `?tripId=` |

### Shell invariants

| Invariant | Current contract |
|---|---|
| Hidden chrome | `/welcome`, `/onboarding`, `/active-ride`, `/trip-confirmation` hide tabbar and FAB. |
| FAB | Visible only on `/feed`. |
| Map tab | Tab button targets `/map`; `app.js` routes drivers to `/driver-map`, passengers/guests to `/map`. |
| Driver route guard | Driver mode redirects passenger order routes `/route-picker`, `/route-preview`, `/order-map-draft` to `/driver-map`. |
| Active ride role split | No `/active-ride-passenger` route. Passenger UI is rendered by `active_ride_passenger.js` inside `/active-ride?role=passenger`. |
| Real Mapbox | Not connected. Screens use DOM placeholders from `public/src/mapbox/map_shell.js`. |

---

## 3. Storage and routines boundary

The routines audit established `public/src/storage_boundary.js` as the authoritative place for user-scoped localStorage clearing. Screen contracts must not invent new keys without either adding a clear helper or explicitly marking the key as device/global.

### User-scoped keys cleared on local logout/reset

| Key | Owner |
|---|---|
| `bazardrive.ride_history.v1` | `public/src/ride_history.js` |
| `bazardrive.favorite_routes.v1` | `public/src/favorite_routes.js` |
| `bazardrive.favorite_route_notice.v1` | `public/src/favorite_routes.js` |
| `bazardrive.active_ride.v1` | `public/src/ride_state.js` |
| `bazardrive.chat.v1` | `public/src/screens/chat.js`, also written by active ride |
| `bazardrive.responses.v1` | `public/src/screens/respond.js`, `public/src/screens/chat.js` |
| `bazardrive.respond.v1` | `public/src/screens/respond.js` |
| `bazardrive.trip_confirmation.v1` | `public/src/screens/trip_confirmation.js`, `public/src/screens/chat.js` |
| `bazardrive.driver_handoff_snapshot.v1` | `public/src/screens/driver_handoff_snapshot.js` |
| `bazardrive.draft.v2` | `public/src/screens/composer.js` |
| `bazardrive.repeat_route.v1` | `public/src/repeat_route.js` |
| `bazardrive.route_draft.v1` | `public/src/screens/route_picker.js` |
| `bazardrive.order_form.v1` | `public/src/screens/order_map_draft.js` |
| `bazardrive.ride_orders.v1` | `public/src/mock_api.js` |
| `bazardrive.myposts.v1` | `public/src/mock_api.js` |
| `profileTripDemo` | passenger profile demo override |

`bazardrive.favorite_route_notice.v1` is transient copy for favorite-route repeat handoff. It is cleared by `clearFavoriteRoutes()` together with `bazardrive.favorite_routes.v1`.

### Not cleared by the user-scoped boundary

| Key | Reason |
|---|---|
| `bazardrive.user.v1` | Owned by `state.js`; handled by `user.reset()` in the calling flow. |
| `bazardrive.posts.v1` | Shared global mock feed cache. |
| `bazardrive.map_prefs.v1` | Device-level map preferences, not identity-scoped. |

---

## 4. Screen contracts

### BD-FEED-01 - Feed V2

| Field | Contract |
|---|---|
| Route | `/feed` |
| File | `public/src/screens/feed.js` |
| Data | `listFeedPosts()` from `mock_api.js`; merges seed feed + local ride-order posts. |
| Main states | All, trips, passenger requests, announcements, marketplace, empty filtered state. |
| Actions | Category chips, topbar plus, global FAB, card CTA to respond/chat/accept. |
| Acceptance | Route opens, tab highlights, FAB visible only here, filters work, no CSP/inline regressions. |

### BD-COMPOSER-01 - Composer V2

| Field | Contract |
|---|---|
| Route | `/new` |
| File | `public/src/screens/composer.js` |
| Storage | `bazardrive.draft.v2` |
| Data | `createFeedPost()` creates local authored feed posts. |
| Main states | Driver offer, passenger request, marketplace item, announcement, service, preview, validation error, draft saved, submit loading. |
| Actions | Save draft, preview/edit, publish, back to feed, switch type, autosave. |
| Acceptance | Five types render correct fields; draft survives reload; publish clears draft and returns to `/feed`. |

### BD-ONBOARDING-01 - Welcome + Onboarding V2

| Field | Contract |
|---|---|
| Routes | `/welcome`, `/onboarding` |
| Files | `welcome.js`, `onboarding.js` |
| Storage | `bazardrive.user.v1` via `state.js` |
| Main states | Welcome, role, phone, OTP mock, profile, car, documents, done passenger, done driver. |
| Actions | Begin, guest entry, role pick, phone mock, profile save, vehicle/docs save, finish. |
| Acceptance | Pending action survives onboarding; driver lands where the pending action expects. |

### BD-PROFILE-01 - Passenger profile

| Field | Contract |
|---|---|
| Route | `/profile` with passenger/guest role |
| File | `public/src/screens/profile.js` |
| Storage | `bazardrive.user.v1`, profile demo helpers, user-scoped stores read-only where needed. |
| Main states | Guest prompt, passenger dashboard, phone verification banner, stats, saved actions, safety. |
| Actions | Verify phone mock, edit profile, create ride, view inbox/history/favorites. |
| Acceptance | Guest/passenger surfaces do not expose driver-only controls unless role switches. |

### BD-PROFILE-02 - Driver dashboard profile

| Field | Contract |
|---|---|
| Route | `/profile` with driver role |
| File | `public/src/screens/profile.js` |
| Storage | `bazardrive.user.v1`, driver document flags. |
| Main states | Overview, Taxi IP, Documents, Payouts, Safety. |
| Actions | Online toggle, driver/passenger mode, readiness checklist, document mock updates. |
| Acceptance | Driver readiness gates Feed/Post Detail accept CTAs and `/driver-map` (BD-DRIVER-02): all accept surfaces now enforce `isDriverLineReady()` via the shared rule in `state.js`. |

### BD-PROFILE-D-03 - Driver dashboard profile polish

| Field | Contract |
|---|---|
| Route | `/profile?role=driver` (renders `renderDriver`). `/profile?role=passenger` stays the passenger dashboard — the two role branches are fully separated. |
| File | `public/src/screens/profile.js` |
| Render gate | `public/prototypes/profile/BD-PROFILE-D-03-driver-dashboard-render-gate.{pdf,html}` — visual reference only; never copied into runtime. |
| Tabs | `Обзор` (default) · `Такси·ИП` · `Документы` · `Выплаты` · `Безопасность`. The five tabs switch panes via a CSS active class; the top bar + tab row are not remounted on switch. |
| Pane deep-link | `?pane=` accepts internal ids (`overview` / `ip` / `docs` / `payouts` / `security`) and render-gate aliases (`taxi-ip` → ip, `documents` → docs, `safety` → security). |
| States | A overview ready · B overview offline · C checklist missing docs · D Такси·ИП demo · E documents pending (`На проверке`) · F documents verified (`Проверено`) · G payouts receipt rows · H payouts empty (`?pane=payouts&state=empty`) · I safety center (`?pane=safety`) · J loading/skeleton (`?state=loading`). |
| Documents | Readiness cards only: `Проверено` (uploaded), `На проверке` (review_required), `Нужно обновить` (expired/missing). No real upload. |
| Payouts | Completed-ride rows read `receipt.net` straight from the BD-RIDE-HISTORY-D-01 canonical store (`mock_api.listDriverReceipts`); cash/noncash badges mirror the receipt screen wording. profile.js never recalculates fare / commission / tip / net. |
| Такси·ИП | Static demo only — no tax math. |
| Safety | Calm, visible driver safety center (driver-scoped `pf2-safety-*` classes); tiles are demo placeholders (no real call / SOS). |
| Constraints | No backend, no Mapbox, no real payments, no real document upload, no tax/accounting math, no passenger redesign, no active-ride redesign, no CSP weakening, no inline script/style, no copying generated HTML into runtime. |
| Acceptance | `node scripts/check.mjs` green (no inline-style patterns, JS syntax, smokes). Loading/skeleton and empty-payouts states reachable from the documented URLs; payouts no-drift stays covered by `scripts/smoke-driver-receipt-no-drift.mjs`. |

### BD-RESPOND-01 - Respond

| Field | Contract |
|---|---|
| Route | `/respond?postId=...` |
| File | `public/src/screens/respond.js` |
| Storage | Writes `bazardrive.respond.v1`; some chat/response flows can also write `bazardrive.responses.v1`. |
| Main states | Offer form, vehicle card if available, validation, submitted state. |
| Actions | Send offer, cancel/back, open profile/feed/chat where supported. |
| Acceptance | Respond data is local mock data. The passenger_response is keyed by `resp_<post.id>` and, for canonical ride-order posts, additively pins `orderId` + `canonical:'ride_order'` (BD-RESPOND-ORDER-LINK-01 / #368). `/responses` reads those back read-side by `orderId` (BD-RESPOND-ORDER-LINK-02 / #369); the respond → chat link stays `responseId`-only. |

### BD-RESPONSES-01 - Responses inbox

| Field | Contract |
|---|---|
| Route | `/responses` |
| File | `public/src/screens/responses.js` |
| Data | Real driver responses from `bazardrive.responses.v1` (read-side, BD-RESPOND-ORDER-LINK-02 / #369): `kind==='passenger_response'` rows for the current canonical `orderId`, mapped into the `responses__driver` card shape. Falls back to in-file `MOCK_DRIVERS` when there is no `orderId` / no real response / legacy `postId` / fallback request. Canonical order lookup via `getOrderById()`; accept flow via `acceptOrder()`. |
| Storage | Reads `bazardrive.responses.v1` read-only (never written from `/responses` — respond.js/chat.js own writes + the user-scoped clear). `bazardrive.ride_orders.v1` is read-only here via `getOrderById()`. |
| Main states | Driver offer board (real responses or `MOCK_DRIVERS`), empty/missing-order fallback, accepted driver handoff. |
| Actions | Pick/accept a driver, open chat/active ride, return to feed/profile. |
| Acceptance | Real `/respond` submissions for a canonical `orderId` appear here; the `MOCK_DRIVERS` board is preserved for the fallback paths. Render is read-only (no store writes); the accept → active-ride handoff and chat confirmation flow are unchanged. |

### BD-CHAT-01 - Chat

| Field | Contract |
|---|---|
| Route | `/chat?tripId=...` or `/chat?responseId=...` |
| File | `public/src/screens/chat.js` |
| Storage | `bazardrive.chat.v1`, response/confirmation helpers. |
| Main states | Thread, empty/new thread, quick replies, confirmation CTA. |
| Actions | Send message, quick reply, open trip confirmation, open active ride where applicable. |
| Acceptance | Same `tripId` links feed/respond/confirmation/active ride. |

### BD-CHAT-02 - Chat bridge (ride + response context)

| Field | Contract |
|---|---|
| Route | `/chat?tripId=<id>&role=<driver\|passenger>` (from `/active-ride`) or `/chat?responseId=<id>` (from `/respond`) or legacy `/chat?tripId=<id>` (feed/post-detail/inbox). |
| File | `public/src/screens/chat.js` |
| Storage | Reads `bazardrive.active_ride.v1` and `bazardrive.responses.v1`; writes `bazardrive.chat.v1` (message threads) and `bazardrive.trip_confirmation.v1` (BD-CHAT-01 handoff, unchanged). |
| Hydration order | (1) `tripId` → `findActiveRide(tripId)` → counterpart = `viewerRole === 'driver' ? ride.passenger : ride.driver`; trip = `ride.route` + `ride.ride.price` / `ride.order.offerPrice` + `ride.status`. (2) Else `responseId` → `loadResponse(responseId)` → counterpart falls back to `MOCK_DRIVER`; trip price from `response.driverPrice`. (3) Else demo `MOCK_DRIVER` / `MOCK_TRIP`. |
| Back-link | `tripId` + explicit `role` → `/active-ride?role=<role>&tripId=<tripId>`. `responseId` with known `response.requestId` → `/respond?postId=<requestId>`. Otherwise `/feed` (legacy / demo). |
| Message schema | Outgoing send writes `{ id, senderRole: viewerRole, dir: 'out', text, time }`. Readers prefer `senderRole`; legacy `dir`-only records keep rendering via the existing fallback in `directionForMessage`. |
| Preserved | BD-CHAT-01 confirmation CTA flow (`/chat?responseId=…` → `bazardrive.trip_confirmation.v1` → `/trip-confirmation`) unchanged. `/respond` write side unchanged. `/active-ride` driver/passenger flows unchanged apart from the appended `&role=` on chat deep-links. |
| Acceptance | Round-trip `/active-ride?role=<r>&tripId=<id>` → `/chat?tripId=<id>&role=<r>` → back returns to the originating `/active-ride` view with `role`+`tripId` preserved; counterpart matches the role; trip route/price/status come from `bazardrive.active_ride.v1`. |

### BD-CONFIRM-01 - Trip confirmation handoff

| Field | Contract |
|---|---|
| Route | `/trip-confirmation` |
| File | `public/src/screens/trip_confirmation.js` |
| Helper modules (no route) | `public/src/screens/trip_confirmation_handoff.js` (seed + cross-role canonical active-ride loader), `public/src/screens/driver_handoff_snapshot.js` (driver-side snapshot store + ride overlay). Both are non-route helper modules, not routed screens. |
| Storage | `bazardrive.trip_confirmation.v1`, `bazardrive.driver_handoff_snapshot.v1` |
| Main states | Pending, passenger confirmed, driver confirmed, both confirmed, expired/canceled mock states. |
| Actions | Confirm, decline/back, continue to `/active-ride?role=...`. |
| Acceptance | Handoff does not introduce a separate backend status store. |

### BD-INBOX-01 - Inbox hub

| Field | Contract |
|---|---|
| Route | `/inbox` |
| File | `public/src/screens/inbox.js` |
| Data | Mock inbox items from `mock_api.js`. |
| Main states | Responses, messages, rides, unread indicators, empty tab. |
| Actions | Open primary target, secondary chat/ride actions. |
| Acceptance | Links stay inside the registered route set. |

### BD-POST-01 - Post detail

| Field | Contract |
|---|---|
| Route | `/post` |
| File | `public/src/screens/post_detail.js` |
| Data | Feed/mock post lookup. |
| Main states | Detail, not found fallback. |
| Actions | Back to feed, open related CTA. |
| Acceptance | Missing/unknown ids fail soft. |

### BD-RULES-01 - Rules

| Field | Contract |
|---|---|
| Route | `/rules` |
| File | `public/src/screens/rules.js` |
| Data | Static local content. |
| Main states | Rules sections. |
| Actions | Navigation only. |
| Acceptance | Bottom tab highlights `Правила`. |

### BD-MAP-01 - MapHome

| Field | Contract |
|---|---|
| Route | `/map` |
| File | `public/src/screens/map.js` |
| Storage | `bazardrive.map_prefs.v1` as device preference if used. |
| Map layer | `createMapShell()` only. No Mapbox SDK. |
| Main states | Home map, location prompt, nearby orders preview, fallback copy. |
| Actions | My location mock, choose route, orders nearby, route to driver map for driver role through `app.js`. |
| Acceptance | Works without token, network, or geolocation permission. |

### BD-MAP-02 - LocationPermission

| Field | Contract |
|---|---|
| Route | `/location-permission` |
| File | `public/src/screens/location_permission.js` |
| Data | Local UI state only. |
| Main states | Explain permission, denied/fallback, manual choice. |
| Actions | Allow mock, choose manually, back to map/route picker. |
| Acceptance | Does not trigger a native permission prompt unless future real geo issue says so. |

### BD-MAP-03 - RoutePicker

| Field | Contract |
|---|---|
| Route | `/route-picker` |
| File | `public/src/screens/route_picker.js` |
| Storage | `bazardrive.route_draft.v1` |
| Main states | Pickup focus, dropoff focus, route ready, malformed draft fallback, clear state. |
| Actions | Set pickup, set dropoff, swap, clear point, clear all, continue to `/route-preview`. |
| Acceptance | Clear only touches route draft, not composer draft, feed, profile, orders or active ride. |

### BD-MAP-04 - RoutePreview

| Field | Contract |
|---|---|
| Route | `/route-preview` |
| File | `public/src/screens/route_preview.js` |
| Storage | Reads `bazardrive.route_draft.v1`. |
| Main states | Valid route summary, missing draft, malformed draft, manual fallback. |
| Actions | Create order, edit route, clear route/back. |
| Acceptance | Computes/shows distance, duration, estimated price from local mock data only. |

### BD-MAP-05 - OrderMapDraft

| Field | Contract |
|---|---|
| Route | `/order-map-draft` |
| File | `public/src/screens/order_map_draft.js` |
| Storage | Reads `bazardrive.route_draft.v1`; writes `bazardrive.order_form.v1` and `bazardrive.ride_orders.v1`. |
| Main states | Valid route form, missing route, validation feedback, publishing, success. |
| Actions | Publish order, edit route, set now/later, set price/comment, go to my order/feed. |
| Acceptance | Publish CTA always gives visible feedback and never silently fails. |

### BD-DRIVER-01 / BD-DRIVER-02 - DriverMap

| Field | Contract |
|---|---|
| Route | `/driver-map` |
| File | `public/src/screens/driver_map.js` |
| Data | `listNearbyOrders()` and `acceptCanonicalRideOrder()` mock flow. |
| Guard | Two gates. Role gate (BD-ROLE-01): non-driver roles see a safe passenger fallback. Readiness gate (BD-DRIVER-02): a `role=driver` who is not `isDriverLineReady()` sees the readiness gate, not the working surface. |
| Variants | `ready` (working order list) \| `not_ready` (readiness banner + read-only checklist + LOCKED orders) \| `non_driver` (existing passenger guard). |
| Main states | Order list, empty, accepted handoff, not_ready gate. |
| Actions | ready: accept order, create test order, open feed/map, go to active ride. not_ready: «Завершить готовность» → `/profile` only — no accept action is rendered. |
| Acceptance | Uses MapShell placeholder and local ride order store only. Readiness derives from the single `isDriverLineReady()` rule in `state.js` (shared with Profile), so the gate and the Profile readiness card cannot drift. Covered by `scripts/smoke-driver-map-readiness.mjs`. |

### BD-RIDE-D-01..09 - Active ride driver

| Field | Contract |
|---|---|
| Route | `/active-ride?role=driver` |
| File | `public/src/screens/active_ride.js` |
| Storage | `bazardrive.active_ride.v1`, ride history, chat helpers. |
| Main states | NEW_ORDER, ACCEPTED, DRIVER_EN_ROUTE, DRIVER_APPROACHING_PICKUP, WAITING_PASSENGER, IN_PROGRESS, COMPLETED, CANCELED, NO_SHOW. |
| Actions | Accept, arrived, start, complete, cancel sheet, problem sheet, earnings sheet, chat/nav/phone stubs. |
| Acceptance | Driver state changes go through `ride_state.js`; passenger renderer is not duplicated here. |
| Helper modules (no route) | `public/src/screens/active_ride_driver_sheets.js` (BD-RIDE-D-SHEETS-01 cancel + problem bottom sheets, plus the driver earnings overlay opener `openDriverEarningsSheet`) and `public/src/screens/active_ride_passenger_sheets.js` (passenger sheets, imported only by the passenger screen). The earnings sheet uses `driver-sheet__*` / `styles/driver_sheets.css`. |

### BD-RIDE-D-SHEETS-01 - Driver cancel + problem sheets

| Field | Contract |
|---|---|
| Route | Reused inside `/active-ride?role=driver`, no route of its own. |
| File | `public/src/screens/active_ride_driver_sheets.js` (driver counterpart of `active_ride_passenger_sheets.js`). |
| Exports | `openDriverCancelSheet`, `openDriverProblemSheet`, `openDriverEarningsSheet`, `renderDriverCancelSheet`, `renderDriverProblemSheet`, `renderDriverEarningsSheet`, `bindDriverSheetEvents`, `DRIVER_CANCEL_REASON_LABEL_BY_CODE`. |
| Cancel states | `default → reason_selected → validation_error → loading → canceled`; `other` reveals a custom-reason textarea. Persistence (CANCELED / NO_SHOW) stays in the screen's `onConfirm`; the in-sheet canceled card offers «Вернуться в ленту» / «Закрыть». |
| Problem states | `default → type_selected → loading → sent`; safety-class types flip a `data-safety` danger visual state; optional comment field; pure UI placeholder — never changes ride status. |
| Actions | Cancel: select reason, custom reason, confirm. Problem: select type, comment, submit. Both: close / Esc / backdrop (disabled mid-loading and on the terminal card). |
| Acceptance | No inline styles (`active-ride-driver-sheet__*` / `driver-cancel-sheet__*` / `driver-problem-sheet__*` in `cloud.css`); the screen imports the openers and does not redefine them inline; the problem sheet never persists ride state. Covered by `scripts/smoke-active-ride-driver-sheets.mjs`. |

### BD-RIDE-HISTORY-D-01 - Driver completed ride receipt

| Field | Contract |
|---|---|
| Route | `/receipt?tripId=<id>` (own route). Render-gate preview: `?state=loading\|missing\|cash\|noncash`. |
| File | `public/src/screens/trip_receipt.js` |
| Storage | `bazardrive.driver_receipts.v1` (canonical receipt store in `mock_api.js`). |
| Receipt object | `{ tripId, completedAt, fare, commission, tip, net, paymentMode, status }`. `commission` is stored signed (negative); `net` is computed **once** in the completed driver earnings flow (`active_ride.js` → `buildDriverEarningsPayload`) and persisted via `saveDriverReceipt`. |
| mock_api helpers | `saveDriverReceipt(receipt)`, `getReceipt(tripId)`, `listDriverReceipts()`, `clearDriverReceiptsStore()`, plus the seeded `DEMO_DRIVER_RECEIPT` (tripId `48-321`). |
| States | C · cash, D · noncash, E · missing-receipt fallback, F · loading/syncing skeleton. |
| Consumers | Ride history rows + detail (Profile), Driver payouts list (`/profile?pane=payouts`) and this screen all **read + format** the same persisted receipt — they never recompute fare/commission/tip/net. |
| Canonical demo | fare 1540, commission −185, tip 120, **net 1475 ₽**, tripId `48-321`, status completed. |
| Acceptance | No inline styles (`trip-receipt__*` in `cloud.css`); reads only the stored receipt; not an active-ride cockpit (no map, no live actions). Covered by `scripts/smoke-driver-receipt-no-drift.mjs`. |

### BD-RIDE-P-01..07 - Active ride passenger

| Field | Contract |
|---|---|
| Route | `/active-ride?role=passenger` |
| File | `public/src/screens/active_ride_passenger.js` |
| Storage | Reads same `bazardrive.active_ride.v1`; writes cancel/safety UI actions where needed. |
| Main states | ACCEPTED, DRIVER_EN_ROUTE, DRIVER_APPROACHING_PICKUP, WAITING_PASSENGER, IN_PROGRESS, COMPLETED, CANCELED, NO_SHOW. |
| Actions | Message driver, phone stub, cancel sheet, safety sheet, done/new ride. |
| Query params | `?status=<main state>` (view-only override, no persist); `?phase=ARRIVING_DROPOFF` (IN_PROGRESS dropoff sub-phase overlay); `?payment=auto\|pending\|paid` (COMPLETED charge presentation, default `auto`). QA/audit simulation only. |
| Acceptance | Same tripId as driver view, same status enum, role-specific UI only. |

*Query-params row synced by BD-RIDE-P-13 (docs sync after BD-RIDE-P-11 audit + BD-RIDE-P-12 smoke guard); params already exist in `active_ride_passenger.js` — no runtime change.*

### BD-RIDE-F-02 - MapShell placeholder

| Field | Contract |
|---|---|
| Route | Reused component, no route. |
| File | `public/src/mapbox/map_shell.js` |
| Purpose | Dark DOM map placeholder for ride/map screens. |
| Constraints | No SDK, no token, no network, no tile cache. |
| Acceptance | Can render route line, pickup/dropoff/car markers as static DOM. |

### BD-MAP-FOUND-03 - Driver Markers Layer (foundation stub)

| Field | Contract |
|---|---|
| Route | Reused module, no route. |
| File | `public/src/mapbox/driver_markers.js` |
| Purpose | Foundation stub for plotting driver/order markers onto the MapShell placeholder. No-op / pure helpers until BD-MAP-FOUND-01 wires the real Mapbox layer. |
| Exports | `createDriverMarkersLayer(options)`, `renderDriverMarkers(mapShell, orders, options)`, `clearDriverMarkers(layer)`, `getDriverMarkerSummary(orders)`. |
| Summary contract | `getDriverMarkerSummary(orders)` returns `{ total, withCoords, withPrice }`. `total` = order count. `withCoords` counts orders whose `pickup.lng` AND `pickup.lat` are finite numbers (`Number.isFinite`); rejects `NaN`, `Infinity`, `-Infinity`, strings, null, undefined, missing `pickup`. `withPrice` counts orders where any of `estimatedPrice`, `estimatedPriceLabel`, `offerPrice`, `price` is a finite number OR a trimmed non-empty string that is not (case-insensitive) `"nan"` / `"infinity"` / `"-infinity"`. `0` is a valid price; whitespace-only strings are not. |
| Constraints | No real Mapbox SDK, no token, no network, no CDN, no inline style. Safe no-op without a real map. |
| Acceptance | Exports stable contract; `renderDriverMarkers` returns an empty layer when no DOM map is present; `getDriverMarkerSummary` is a pure counter. |

### BD-MAP-FOUND-04 - Trip Status Layer (foundation stub)

| Field | Contract |
|---|---|
| Route | Reused module, no route. |
| File | `public/src/mapbox/trip_status_layer.js` |
| Purpose | Foundation stub for reflecting active-ride status on the MapShell placeholder. No-op / pure helpers until BD-MAP-FOUND-01 wires the real Mapbox layer. |
| Exports | `createTripStatusLayer(options)`, `renderTripStatusLayer(mapShell, trip, options)`, `clearTripStatusLayer(layer)`, `getTripStatusVisualState(status)`. |
| Status vocabulary | Mirrors `RIDE_STATUS`: NEW_ORDER, DRIVER_EN_ROUTE, DRIVER_APPROACHING_PICKUP, WAITING_PASSENGER, IN_PROGRESS, COMPLETED, CANCELED, NO_SHOW. |
| Constraints | No real Mapbox SDK, no token, no network, no CDN, no inline style. Safe no-op without a real map. |
| Acceptance | `getTripStatusVisualState` resolves every RIDE_STATUS to a visual descriptor and falls back safely for unknown input; `renderTripStatusLayer` returns the descriptor when no DOM map is present. |

---

## 5. Known gaps that remain true

| Gap | Why it remains open |
|---|---|
| Real Mapbox SDK | Separate Phase 4 issue. Requires CSP and SW update. |
| ~~`driver_markers.js` and `trip_status_layer.js` stubs~~ | Resolved (BD-MAP-FOUND-03 / BD-MAP-FOUND-04): both foundation stubs now exist in `public/src/mapbox/` as no-op / pure-helper modules (no real Mapbox, no token, no network), precached in `sw.js` and guarded by `scripts/smoke-mapbox-foundation-stubs.mjs`. |
| Driver no-show full flow | The no-show action exists as a stub/toast path and needs a dedicated issue before becoming a full state flow. |
| ~~DriverMap readiness gate~~ | Resolved (BD-DRIVER-02): `/driver-map` now enforces `isDriverLineReady()` — the shared `state.js` rule — alongside the role guard. |
| Backend/auth/payments/uploads/push/APK | Out of scope for the current PWA mock spine. |
| Automated tests | `node scripts/check.mjs` is the current guard; node:test coverage remains technical debt. |

---

## 6. Non-negotiable constraints

```text
no backend API
no real Mapbox SDK in docs-only or mock-screen work
no APK / Android / TWA in this repo phase
no inline script/style/on* handlers
no CSP weakening
no replacing public/index.html with prototype HTML
no renaming localStorage keys without migration and storage-boundary update
no new user-scoped storage without a clear helper or explicit exemption
```
