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

### BD-RESPOND-01 - Respond

| Field | Contract |
|---|---|
| Route | `/respond?postId=...` |
| File | `public/src/screens/respond.js` |
| Storage | Writes `bazardrive.respond.v1`; some chat/response flows can also write `bazardrive.responses.v1`. |
| Main states | Offer form, vehicle card if available, validation, submitted state. |
| Actions | Send offer, cancel/back, open profile/feed/chat where supported. |
| Acceptance | Respond data is local mock data. Do not assume `/responses` reads `bazardrive.responses.v1`; current `/responses` uses its own mock driver board and order lookup. |

### BD-RESPONSES-01 - Responses inbox

| Field | Contract |
|---|---|
| Route | `/responses` |
| File | `public/src/screens/responses.js` |
| Data | In-file `MOCK_DRIVERS` plus canonical order lookup through `getOrderById()` and accept flow through `acceptOrder()` from `mock_api.js`. |
| Storage | Does **not** read `bazardrive.responses.v1` today. `bazardrive.responses.v1` remains a separate user-scoped store used by respond/chat helper flows. |
| Main states | Driver offer board, empty/missing-order fallback, accepted driver handoff. |
| Actions | Pick/accept a mock driver, open chat/active ride, return to feed/profile. |
| Acceptance | QA should not expect `/respond` submissions in `bazardrive.responses.v1` to automatically appear here until a future integration issue wires that handoff. |

### BD-CHAT-01 - Chat

| Field | Contract |
|---|---|
| Route | `/chat?tripId=...` or `/chat?responseId=...` |
| File | `public/src/screens/chat.js` |
| Storage | `bazardrive.chat.v1`, response/confirmation helpers. |
| Main states | Thread, empty/new thread, quick replies, confirmation CTA. |
| Actions | Send message, quick reply, open trip confirmation, open active ride where applicable. |
| Acceptance | Same `tripId` links feed/respond/confirmation/active ride. |

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

---

## 5. Known gaps that remain true

| Gap | Why it remains open |
|---|---|
| Real Mapbox SDK | Separate Phase 4 issue. Requires CSP and SW update. |
| `driver_markers.js` and `trip_status_layer.js` stubs | Still not created in `public/src/mapbox/`. |
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
