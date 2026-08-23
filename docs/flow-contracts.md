# BD-FLOW-01 - End-to-end passenger to driver ride flow

> **Status:** mock-only flow contract.
>
> **BD-DOCS-01 note:** refreshed after the routines/storage-boundary audit so this document matches the current registered routes, localStorage ownership, and taxi-flow code.
>
> This document does not introduce real Mapbox SDK, backend API, auth, payments, push, APK/TWA, CSP relaxations, inline scripts, or rewrites of active ride screens.

---

## 1. Goal

BD-FLOW-01 describes the current Cloud/PWA taxi spine:

```text
Welcome / Onboarding
  ↓
Profile
  ↓
Feed
  ↓
Create publication or route order
  ↓
Driver sees/responds/accepts
  ↓
Chat or confirmation handoff
  ↓
Active Ride
  ↓
Complete / history / feed
```

The spine is mock-only. Transitions are driven by hash navigation and `localStorage` stores owned by `state.js`, `mock_api.js`, `ride_state.js`, and the screen modules. No screen performs real geolocation, network requests, payments, or Mapbox tile/API calls.

---

## 2. Implemented route inventory

Registered in `public/src/app.js`.

| Route | Screen | Role in the flow |
|---|---|---|
| `/welcome` | `welcome.js` | First-run entry. |
| `/onboarding` | `onboarding.js` | Role, phone mock, profile, vehicle, docs. |
| `/profile` | `profile.js` | Passenger profile and driver dashboard/readiness. |
| `/feed` | `feed.js` | Main hub for posts, requests, CTA handoffs. |
| `/new` | `composer.js` | Creates local feed posts and passenger/driver trip posts. |
| `/map` | `map.js` | Passenger/guest map home using MapShell placeholder. |
| `/location-permission` | `location_permission.js` | Permission explanation/mock fallback, no native prompt requirement. |
| `/route-picker` | `route_picker.js` | Writes pickup/dropoff draft to `bazardrive.route_draft.v1`. |
| `/route-preview` | `route_preview.js` | Reads route draft and shows ETA/price summary. |
| `/order-map-draft` | `order_map_draft.js` | Turns a route draft into a local passenger order. |
| `/driver-map` | `driver_map.js` | Driver-side mock order list and accept handoff. |
| `/respond` | `respond.js` | Driver/passenger response surface for feed requests. |
| `/responses` | `responses.js` | Passenger response inbox. |
| `/chat` | `chat.js` | Per-trip or per-response chat thread. |
| `/trip-confirmation` | `trip_confirmation.js` | Mock confirmation bridge before active ride. |
| `/active-ride` | `active_ride.js` | Driver active ride plus passenger role dispatch. |
| `/post` | `post_detail.js` | Feed post detail surface. |
| `/inbox` | `inbox.js` | Inbox hub for responses, messages, rides. |
| `/rules` | `rules.js` | Static rules screen. |

Unknown routes still fall back through the router to `/feed`.

---

## 3. Shell and router contract

| Concern | Contract |
|---|---|
| Chrome hidden | `/welcome`, `/onboarding`, `/active-ride`, `/trip-confirmation`. |
| FAB | Visible only on `/feed`. |
| Bottom tabbar | `Лента`, `Карта`, `Правила`, `Профиль`. |
| Map tab dispatch | Clicking `Карта` calls `getMapEntryRoute()`: driver role goes to `/driver-map`, everyone else to `/map`. |
| Create dispatch | FAB calls `requireOnboarding()` and then `/driver-map` for driver mode or `/new` otherwise. |
| Driver guard | Driver mode redirects passenger order routes `/route-picker`, `/route-preview`, `/order-map-draft` to `/driver-map`. |
| Active ride role | One route, `/active-ride`; `?role=driver` uses driver UI, `?role=passenger` delegates to `active_ride_passenger.js`. |
| Latest-render ownership (BD-ROUTER-LIFECYCLE-01A, #917) | `render()` is async (a screen loader may await its own data — e.g. `post_detail.js`). Every call stamps a monotonically increasing generation before awaiting its loader; if a newer render has started by the time the loader settles, the result is discarded — no mount, no tab-active/chrome sync. Guarantees `LATEST_ROUTE_RENDER_WINS`: an overlapping slow navigation can never land its view after a faster, later one already owns `#app`. Guarded by `scripts/smoke-router-latest-render-wins.mjs`. |
| Loader renderContext (BD-ROUTER-LIFECYCLE-01A P2, PR #918 review, ABA fix) | `render()` passes every loader a frozen `renderContext` (`{ isCurrent }`) bound to the generation it was minted for; unrecognized loaders ignore the extra argument. Lets a loader guard its own pre-return side effects (navigation, global-overlay calls) against staleness — router.js's own mount guard cannot see those. A hash-equality staleness check is not equivalent: it reads "current" again on an A→B→A round trip back to the same URL, even though a new generation has since run; `isCurrent()` derived from the generation counter does not. `respond.js` consumes this (optional argument, falls back to always-current for a direct caller that passes none) to guard its `go('/chat?...')` call and the `loadResource` `isActive` option. Guarded by `scripts/smoke-router-latest-render-wins.mjs` and `scripts/smoke-respond-stale-navigation-guard.mjs`. |

---

## 4. Passenger flow

| # | Where | Action | Result |
|---|---|---|---|
| 1 | `/welcome` | Start or guest entry | `bazardrive.user.v1` unlocks app shell. |
| 2 | `/onboarding` | Pick passenger, fill profile/phone mock | `user.role = 'passenger'`, `user.onboarded = true`. |
| 3 | `/feed` | Browse trips/posts | Feed uses seed posts plus local authored posts and local ride-order posts. |
| 4 | `/new` | Create passenger request | Quick text request path (no route map estimate). Draft stored in `bazardrive.draft.v2`; passenger publish writes canonical ride-order via `createRideOrder()`. |
| 5 | `/route-picker` | Choose pickup/dropoff | Writes `bazardrive.route_draft.v1` with deterministic mock point coords (`coords.lat/lng`) for downstream map visibility. |
| 6 | `/route-preview` | Review route | Shows distance, duration and estimated price from local mock data. |
| 7 | `/order-map-draft` | Publish order | Writes `bazardrive.order_form.v1` and `bazardrive.ride_orders.v1`; route estimate is editable as passenger final price before publish. |
| 8 | `/feed` or `/driver-map` | Driver sees order | Local ride order appears as a mock passenger order. |
| 9 | `/responses` or `/chat` | Review response / talk to driver | Response/chat stores keep the handoff. |
| 10 | `/trip-confirmation` | Confirm trip mock | Writes confirmation state and can hand off to active ride. |
| 11 | `/active-ride?role=passenger` | Track ride | Reads the same `bazardrive.active_ride.v1` tripId as the driver. |
| 12 | completed passenger ride | Done/new ride | Returns to `/feed`, `/new`, or profile surfaces depending on CTA. |

---

## 5. Driver flow

| # | Where | Action | Result |
|---|---|---|---|
| 1 | `/onboarding` | Pick driver, fill car/docs | Driver fields are saved to `bazardrive.user.v1`. |
| 2 | `/profile` | Complete driver readiness mock | Driver dashboard derives readiness flags from profile/docs. |
| 3 | `/driver-map` | View nearby orders | Reads local passenger orders via `listNearbyOrders()`. |
| 4 | `/driver-map` | Accept order | Uses canonical ride-order accept flow, then hands off to active ride. |
| 5 | `/feed` | Accept passenger request from feed | Alternative accept path creates/saves active ride. |
| 6 | `/active-ride?role=driver` | Accept/start lifecycle | Driver UI writes status transitions via `ride_state.js`. |
| 7 | `/chat` | Coordinate pickup | Same chat store can be opened from feed, inbox, active ride. |
| 8 | completed driver ride | Close/earnings/history | Ride history and earnings surfaces are mock-only. |

---

## 6. Ride state transition table

Backed by `RIDE_STATUS` in `public/src/ride_state.js`.

| From | Event | To | Side effect |
|---|---|---|---|
| order accepted | Driver accepts local order/feed request | `NEW_ORDER` or `ACCEPTED` depending entry path | Active ride record is created/saved. |
| `NEW_ORDER` | Driver confirms accept | `ACCEPTED` | `acceptedAt` is stamped. |
| `ACCEPTED` | Driver begins pickup | `DRIVER_EN_ROUTE` | Driver en-route UI becomes available. `DRIVER_EN_ROUTE` reuses the `acceptedAt` stamp; no separate timestamp is recorded (see notes below). |
| `DRIVER_EN_ROUTE` | Driver nears pickup | `DRIVER_APPROACHING_PICKUP` | Approach UI updates. |
| `DRIVER_APPROACHING_PICKUP` | Driver presses arrived | `WAITING_PASSENGER` | `arrivedAt` is stamped. |
| `WAITING_PASSENGER` | Driver starts trip | `IN_PROGRESS` | `startedAt` is stamped. |
| `IN_PROGRESS` | Driver completes trip | `COMPLETED` | `completedAt` is stamped and history can be written. |
| any active | Driver/passenger cancels | `CANCELED` | `canceledAt` is stamped. |
| `WAITING_PASSENGER` | Driver marks no-show | `NO_SHOW` | Terminal no-show state. |
| terminal | Completed/canceled/no-show | terminal | UI offers return CTAs. |

### Canonical status enum

```text
NEW_ORDER
CONFIRMATION_PENDING
CONFIRMED
CHAT_STARTED
ACCEPTED
DRIVER_EN_ROUTE
DRIVER_APPROACHING_PICKUP
WAITING_PASSENGER
IN_PROGRESS
COMPLETED
CANCELED
NO_SHOW
```

`ACCEPTED` is a current persisted mock status between `NEW_ORDER` and `DRIVER_EN_ROUTE`. It is not just a conceptual backend alias.

`CONFIRMATION_PENDING`, `CONFIRMED`, and `CHAT_STARTED` are reserved/legacy enum members only. They are not wired into the active-ride driver state machine in `public/src/ride_state.js`: they have no `STATUS_TIMESTAMP_FIELD` entry and no `NEXT_DRIVER_STATUS` transition. They are kept as enum constants and are candidates for cleanup. The active driver transition spine is `NEW_ORDER → ACCEPTED → DRIVER_EN_ROUTE → DRIVER_APPROACHING_PICKUP → WAITING_PASSENGER → IN_PROGRESS → COMPLETED`, plus the terminal states `CANCELED` and `NO_SHOW`.

### Follow-up notes (deferred to future code PRs)

- A `DRIVER_EN_ROUTE → WAITING_PASSENGER` shortcut is **not implemented**: `NEXT_DRIVER_STATUS` only advances `DRIVER_EN_ROUTE` to `DRIVER_APPROACHING_PICKUP`. If the shortcut is wanted, track it in a separate follow-up code task; do not fold it into this docs-only contract cleanup.
- `DRIVER_EN_ROUTE` currently reuses the `acceptedAt` timestamp (mapped to `acceptedAt` in `STATUS_TIMESTAMP_FIELD`, and `acceptedAt` is stamped only once at `ACCEPTED`), so the en-route transition records no distinct timestamp. A dedicated `driverEnRouteAt` timestamp could be added in a future code PR; keep it out of this docs-only PR.

Conceptual backend labels map to this enum during mock-only work:

| Conceptual label | Current persisted value |
|---|---|
| `CREATED` | `NEW_ORDER` |
| `ACCEPTED` | `ACCEPTED` |
| `ARRIVING` | `DRIVER_APPROACHING_PICKUP` |
| `ONTRIP` | `IN_PROGRESS` |
| `DONE` | `COMPLETED` |

Do not add a new status just to mirror future backend wording unless the UI and state machine are updated together.

---

## 7. Storage contract

### Existing user-scoped keys

| Key | Owner | Notes |
|---|---|---|
| `bazardrive.user.v1` | `state.js` | User profile. Not cleared by storage boundary, handled by `user.reset()`. |
| `bazardrive.active_ride.v1` | `ride_state.js` | Keyed active ride store. |
| `bazardrive.ride_history.v1` | `ride_history.js` | Completed ride history. |
| `bazardrive.chat.v1` | `chat.js`, active ride | One thread per trip/response. |
| `bazardrive.responses.v1` | `respond.js`, `chat.js` | Mock response inbox data. Read-only by `responses.js` (read-side board by `orderId`, #369). |
| `bazardrive.respond.v1` | `respond.js` | Last respond draft/payload. |
| `bazardrive.trip_confirmation.v1` | `trip_confirmation.js`, `chat.js` | Confirmation bridge store. |
| `bazardrive.driver_handoff_snapshot.v1` | `driver_handoff_snapshot.js` | Driver handoff pin for active ride. |
| `bazardrive.draft.v2` | `composer.js` | Composer draft. |
| `bazardrive.repeat_route.v1` | `repeat_route.js` | One-time repeat route prefill. |
| `bazardrive.favorite_routes.v1` | `favorite_routes.js` | Favorite/repeat route storage. |
| `bazardrive.route_draft.v1` | `route_picker.js` | Pickup/dropoff route draft. |
| `bazardrive.order_form.v1` | `order_map_draft.js` | Pending order form fields. |
| `bazardrive.ride_orders.v1` | `mock_api.js` | Locally published passenger orders. |
| `bazardrive.myposts.v1` | `mock_api.js` | Locally authored posts. |
| `profileTripDemo` | profile demo | Passenger profile demo override. |

`public/src/storage_boundary.js` owns the clear-on-local-logout/reset routine for user-scoped data. Adding a new user-scoped key requires adding a clear helper or documenting why the key is global/device-scoped.

### Intentionally not user-scoped

| Key | Reason |
|---|---|
| `bazardrive.posts.v1` | Global legacy mock feed cache. |
| `bazardrive.map_prefs.v1` | Device-level map preferences. |

---

## 8. Existing files and flow roles

| File | Role |
|---|---|
| `public/src/app.js` | Registers routes and owns tab/FAB entry dispatch. |
| `public/src/router.js` | Hash router, chrome visibility, driver guard, active tab sync. |
| `public/src/state.js` | User profile store and derived flags. |
| `public/src/storage_boundary.js` | Authoritative user-scoped storage clearing routine. |
| `public/src/mock_api.js` | Feed posts, local authored posts, local ride orders, inbox data. |
| `public/src/ride_state.js` | Ride status enum, active ride persistence, transition helpers. |
| `public/src/ride_actions.js` | Shared ride/order accept and driver-mode helpers. |
| `public/src/mapbox/map_shell.js` | Pure DOM map placeholder. No SDK, token or network. |
| `public/src/screens/feed.js` | Main feed hub and card CTA routing. |
| `public/src/screens/composer.js` | New publication flow. |
| `public/src/screens/map.js` | Passenger/guest map home. |
| `public/src/screens/route_picker.js` | Route draft editor. |
| `public/src/screens/route_preview.js` | Route draft preview. |
| `public/src/screens/order_map_draft.js` | Local passenger order publisher. |
| `public/src/screens/driver_map.js` | Driver order discovery and accept handoff. |
| `public/src/screens/respond.js` | Response form/store. |
| `public/src/screens/responses.js` | Responses inbox. |
| `public/src/screens/chat.js` | Chat and confirmation hooks. |
| `public/src/screens/trip_confirmation.js` | Confirmation handoff screen. |
| `public/src/screens/trip_confirmation_handoff.js` | Non-route helper. Seeds `/active-ride` from a confirmed `/trip-confirmation` handoff; cross-role canonical active-ride loader. No DOM/router. |
| `public/src/screens/driver_handoff_snapshot.js` | Non-route helper. Driver-side confirmed-handoff snapshot store (TTL-bounded) plus overlay onto a ride object. No DOM/router. |
| `public/src/screens/active_ride.js` | Driver active ride and role dispatch. |
| `public/src/screens/active_ride_passenger.js` | Passenger active ride renderer. |
| `public/src/screens/inbox.js` | Cross-flow inbox hub. |
| `public/src/screens/post_detail.js` | Feed detail screen. |

---

## 9. Manual smoke path

Use local serving or GitHub Pages, then walk:

```text
#/welcome
#/onboarding
#/profile
#/feed
#/new
#/map
#/location-permission
#/route-picker
#/route-preview
#/order-map-draft
#/driver-map
#/respond
#/responses
#/chat
#/trip-confirmation
#/inbox
#/active-ride?role=driver&status=ACCEPTED
#/active-ride?role=passenger&status=ACCEPTED
#/active-ride?role=driver&status=DRIVER_EN_ROUTE
#/active-ride?role=passenger&status=DRIVER_EN_ROUTE
#/active-ride?role=driver&status=DRIVER_APPROACHING_PICKUP
#/active-ride?role=passenger&status=DRIVER_APPROACHING_PICKUP
#/active-ride?role=driver&status=WAITING_PASSENGER
#/active-ride?role=passenger&status=WAITING_PASSENGER
#/active-ride?role=driver&status=IN_PROGRESS
#/active-ride?role=passenger&status=IN_PROGRESS
#/active-ride?role=driver&status=COMPLETED
#/active-ride?role=passenger&status=COMPLETED
#/rules
```

Expected invariants:

```text
- no native Mapbox/network requirement
- no backend/API call
- tabbar hidden only on chrome-hidden routes
- FAB visible only on /feed
- driver mode cannot enter passenger route-picker/order-map flow
- user-scoped stores clear through storage_boundary.js on local identity reset
```

---

## 10. Constraints

```text
no real Mapbox SDK
no backend/API
default-src 'self' remains intact
no inline scripts/styles/on* handlers
no APK/TWA work in this repo phase
no prototype replacement as index.html
```
