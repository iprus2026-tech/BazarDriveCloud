# BD-FLOW-01 — End-to-end passenger → driver ride flow

> **Status:** documentation / flow contract only.
> **Scope:** describe the demo spine that ties existing screens together.
>
> **This document does NOT introduce:** new Mapbox SDK, backend API, auth,
> payments, push, APK/TWA, CSP relaxations, inline scripts / styles, or
> rewrites of `active_ride.js` / `active_ride_passenger.js`.
>
> Treat this file as the single source of truth for the **flow contract**
> between screens, roles, statuses and `localStorage` keys. It is the
> contract that future "real" implementations (route picker, order map,
> driver map, etc.) must honour without breaking the existing screens.

---

## 1. Goal

BD-FLOW-01 collects the existing PWA / Cloud screens into one coherent
"taxi spine" demo route:

```
Guest
  ↓
Welcome / Onboarding
  ↓
Profile
  ↓
Feed
  ↓
Create publication / ride request   (composer / future route-picker)
  ↓
Driver sees order                   (feed CTA — "Принять заказ")
  ↓
Driver responds / accepts
  ↓
Chat / confirmation
  ↓
Active Ride
  ↓
Complete / rating / history
  ↓
Feed or Profile
```

The spine is **mock-only**. Every transition is driven by either
`hashchange` navigation (`router.js`) or a `localStorage`-backed
contract (`ride_state.js`, `mock_api.js`, `state.js`). No screen in the
spine performs real geolocation, network requests, or payments.

---

## 2. Passenger flow (step by step)

| # | Where                                                  | Action                                              | Result                                                                                            |
|---|--------------------------------------------------------|-----------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1 | `/welcome`                                             | Tap "Начать"                                        | `user.welcomeSeen = true`. Router unlocks the rest of the app.                                    |
| 2 | `/onboarding`                                          | Pick role = `passenger`, fill name + phone          | `user.onboarded = true`, `user.role = 'passenger'`.                                               |
| 3 | `/profile`                                             | (optional) verify phone, add saved addresses        | Profile readiness flags (`phoneVerified`, `paymentLast4`, …) update via `user.set()`.             |
| 4 | `/feed`                                                | Browse posts                                        | Feed renders `FEED_POSTS_V2` (mock).                                                              |
| 5 | `/feed` → FAB "+" → `/new`                             | Tap FAB                                             | Goes through `requireOnboarding()` then `/new`.                                                   |
| 6 | `/new` (composer)                                      | Pick type `passenger`, fill from/to/when/budget     | Draft persisted to `bazardrive.draft.v2` (localStorage).                                          |
| 7 | `/new` → publish                                       | Submit publication                                  | `createFeedPost()` prepends a new post to in-memory feed.                                         |
| 8 | **planned** `/route-picker` → `/route-preview`         | Pick pickup & dropoff on map                        | Writes `routeDraft` to localStorage (see §10).                                                    |
| 9 | **planned** `/order-map-draft`                         | Confirm order                                       | Persists `rideOrder` (status `CREATED`) — see §10.                                                |
| 10| `/feed` (filter `Попутчики`)                           | Wait for a driver                                   | Passenger waits for someone to "Принять заказ".                                                   |
| 11| `/chat?tripId=…`                                       | Talk to driver                                      | Messages persisted per `tripId` in `bazardrive.chat.v1`.                                          |
| 12| `/trip-confirmation`                                   | Confirm details (price / pickup / passenger note)   | When both sides confirm, the spine flips to `/active-ride?role=passenger`.                        |
| 13| `/active-ride?role=passenger`                          | Watch ride progress                                 | Backed by `bazardrive.active_ride.v1` (`activeTrip` shape). Status moves `DRIVER_EN_ROUTE → … → COMPLETED`. |
| 14| `/active-ride?role=passenger&status=COMPLETED`         | Rate driver, see receipt                            | Terminal state. CTA returns user to `/feed` or `/profile`.                                        |

---

## 3. Driver flow (step by step)

| # | Where                                                       | Action                                              | Result                                                                                                  |
|---|-------------------------------------------------------------|-----------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| 1 | `/welcome` → `/onboarding`                                  | Pick role = `driver`, fill vehicle + docs           | `user.role = 'driver'`, vehicle + `driverDocuments` populated.                                          |
| 2 | `/profile`                                                  | Upload docs, open shift / waybill, pass medical     | `state.js` derives `documentsReady`, `taxiPermit`. `isDriverLineReady()` becomes true.                  |
| 3 | `/feed`                                                     | Driver scans passenger requests                     | Posts where `passenger === true` get a primary CTA "Принять заказ" (only if driver line is ready).      |
| 4 | `/feed` → "Принять заказ"                                   | Tap accept                                          | `feed.js#buildRideFromPost()` builds a ride via `createDemoActiveRide()`, then `saveActiveRide()`.      |
| 5 | `/active-ride?role=driver&tripId=…`                         | Driver lands on driver active ride                  | Initial status `NEW_ORDER`. Driver UI shows accept timer + offer card.                                  |
| 6 | `/active-ride?role=driver` (NEW_ORDER → DRIVER_EN_ROUTE)    | Press primary CTA                                   | `updateActiveRideStatus(tripId, DRIVER_EN_ROUTE)` stamps `acceptedAt`.                                  |
| 7 | `/chat?tripId=…`                                            | Coordinate pickup with passenger                    | Same chat store; both roles read/write the same `tripId` thread.                                        |
| 8 | `/active-ride?role=driver&status=WAITING_PASSENGER`         | Driver arrives                                      | Stamps `arrivedAt`. Free / paid waiting timer block shown.                                              |
| 9 | `/active-ride?role=driver&status=IN_PROGRESS`               | Driver starts the trip                              | Stamps `startedAt`. Map shows current instruction + ETA.                                                |
| 10| `/active-ride?role=driver&status=COMPLETED`                 | Driver completes                                    | Stamps `completedAt`. Earnings summary + rating CTA.                                                    |
| 11| Driver returns to `/feed`                                   | "Закрыть"                                           | `go('/feed')` from active ride. Optional return to `/profile` for shift summary.                        |

> The driver state machine in `ride_state.js#getNextDriverStatus` is the
> canonical transition map. Any "next" button in the driver UI must call
> through `updateActiveRideStatus(...)` so timestamps stay consistent.

---

## 4. Combined route flow (spine)

```
/welcome  ─►  /onboarding  ─►  /profile  ─►  /feed
                                              │
                                              ├─► /new ─► (planned) /route-picker
                                              │           ─► /route-preview
                                              │           ─► /order-map-draft
                                              │
                                              ├─► /respond?postId=…    (passenger CTA on feed)
                                              │       │
                                              │       └─► /chat?tripId=…
                                              │
                                              └─► /active-ride?role=driver&tripId=…  (driver "Принять заказ")
                                                       │
                                                       ├─► /chat?tripId=…
                                                       ├─► /trip-confirmation
                                                       │
                                                       └─► /active-ride lifecycle:
                                                             DRIVER_EN_ROUTE
                                                              ↓
                                                             WAITING_PASSENGER
                                                              ↓
                                                             IN_PROGRESS
                                                              ↓
                                                             COMPLETED
                                                              ↓
                                                             /feed  or  /profile
```

`(planned)` = route not yet registered in `router.js` (`app.js`).
Currently maps to `/feed` via the unknown-route fallback in
`router.js#render`. See §11 for the implemented/stub/planned matrix.

---

## 5. Screen-to-screen transition table

| From route                                | Trigger / UI                                              | To route                                             | Notes                                                                                  |
|-------------------------------------------|-----------------------------------------------------------|------------------------------------------------------|----------------------------------------------------------------------------------------|
| `/welcome`                                | "Начать"                                                  | `/onboarding`                                        | Sets `welcomeSeen=true`. Secondary "Войти без регистрации" sets `role='guest'` and goes to `/feed`. |
| `/onboarding`                             | Finish flow                                               | pending action → else `/profile` (driver) / `/feed` (passenger) | `consumePendingAction()` runs if set (e.g. `/new`); otherwise driver lands on `/profile` to finish docs, passenger on `/feed`. |
| `/feed`                                   | FAB "+"                                                   | `/new`                                               | Guarded by `requireOnboarding()`.                                                      |
| `/feed`                                   | Trip card · passenger post · driver CTA                   | `/respond?postId=…`                                  | Passenger-post default CTA.                                                            |
| `/feed`                                   | Trip card · driver post                                   | `/chat?tripId=…`                                     | "Написать водителю" CTA.                                                               |
| `/feed`                                   | Passenger post + driver-ready user                        | `/active-ride?role=driver&tripId=…`                  | "Принять заказ". Saves new ride to `bazardrive.active_ride.v1`.                        |
| `/new` (composer)                         | Save / publish                                            | `/feed`                                              | `createFeedPost()`.                                                                    |
| `/new` (composer)                         | Back                                                      | `/feed`                                              |                                                                                        |
| `/respond`                                | Send / cancel                                             | `/feed`                                              | Success may also link to `/profile`.                                                   |
| `/chat`                                   | Back                                                      | `/feed`                                              | Per-`tripId` thread persists in localStorage.                                          |
| `/trip-confirmation`                      | Both sides confirm                                        | `/active-ride?role=…`                                | Confirmation screen is the bridge from chat → active ride.                             |
| `/active-ride?role=driver`                | Status CTA                                                | same route (status param updates)                    | `updateActiveRideStatus(...)`. UI re-renders from store.                               |
| `/active-ride?role=driver&status=COMPLETED`| "Закрыть" / "На главный"                                 | `/feed`                                              | Driver returns to the spine. Optional path to `/profile`.                              |
| `/active-ride?role=passenger&status=COMPLETED`| "Готово" / "Новая поездка"                            | `/feed` or `/new`                                    | Passenger returns to feed or composes another request.                                 |
| **planned** `/route-picker`               | Confirm route                                             | `/route-preview`                                     | Will write `routeDraft`.                                                               |
| **planned** `/route-preview`              | "Заказать"                                                | `/order-map-draft`                                   | Will write `rideOrder` (status `CREATED`).                                             |
| **planned** `/order-map-draft`            | "Опубликовать"                                            | `/feed`                                              | Order then appears in the feed for drivers.                                            |
| **planned** `/driver-map`                 | "Принять"                                                 | `/active-ride?role=driver&tripId=…`                  | Map-based equivalent of the feed accept CTA.                                           |

Unknown routes fall back to `/feed` (see `router.js#render`).

---

## 6. State transition table (ride)

Backed by `RIDE_STATUS` in `public/src/ride_state.js`. The driver UI is the
canonical writer; passenger UI mirrors via the same store key.

| From                          | Event / actor                              | To                              | Side effects                                              |
|-------------------------------|--------------------------------------------|---------------------------------|-----------------------------------------------------------|
| —                             | Driver taps "Принять заказ" on feed        | `NEW_ORDER`                     | `saveActiveRide()`; `timestamps.createdAt` set.           |
| `NEW_ORDER`                   | Driver confirms accept                     | `DRIVER_EN_ROUTE`               | `timestamps.acceptedAt` set (only if unset).              |
| `DRIVER_EN_ROUTE`             | Driver presses "Я на месте"                | `WAITING_PASSENGER`             | `timestamps.arrivedAt` set.                               |
| `DRIVER_APPROACHING_PICKUP`   | Driver presses "Я на месте"                | `WAITING_PASSENGER`             | `timestamps.arrivedAt` set.                               |
| `WAITING_PASSENGER`           | Driver presses "Поехали"                   | `IN_PROGRESS`                   | `timestamps.startedAt` set.                               |
| `IN_PROGRESS`                 | Driver presses "Завершить"                 | `COMPLETED`                     | `timestamps.completedAt` set.                             |
| any active                    | Driver / passenger cancels                 | `CANCELED`                      | `timestamps.canceledAt` set.                              |
| `WAITING_PASSENGER`           | Driver marks no-show                       | `NO_SHOW`                       | `timestamps.canceledAt` set.                              |
| `COMPLETED` / `CANCELED` / `NO_SHOW` | —                                   | (terminal)                      | UI offers "Вернуться в ленту".                            |

Reserved-but-unused-by-spine statuses (already present in `ride_state.js`):
`CONFIRMATION_PENDING`, `CONFIRMED`, `CHAT_STARTED`. These cover future
confirmation handshake screens (`/trip-confirmation`) — see §11.

`updateActiveRideStatus()` is a no-op for statuses outside `RIDE_STATUS`,
so unknown values from URL `?status=` do not corrupt the store.

---

## 7. Role-based actions

| Role          | On `/feed` trip card (driver post)   | On `/feed` trip card (passenger post)         | On `/active-ride`                                  | On `/profile`                                          |
|---------------|---------------------------------------|------------------------------------------------|----------------------------------------------------|--------------------------------------------------------|
| guest         | "Написать водителю" → `/chat`         | "Откликнуться" → `/respond`                    | Only via `?role=` URL (demo).                      | Limited view.                                          |
| passenger     | "Написать водителю" → `/chat`         | "Откликнуться" → `/respond`                    | `?role=passenger` — read-only timeline.            | Profile V2 (passenger surface).                        |
| driver (line not ready) | "Написать водителю" → `/chat`| "Откликнуться" → `/respond`                    | `?role=driver` — full state machine.               | Driver readiness checklist (docs / waybill / medical). |
| driver (line ready)     | "Написать водителю" → `/chat`| **"Принять заказ"** → `/active-ride?role=driver` | Same as above, plus accept timer.                  | Driver readiness checklist.                            |

"Driver line ready" = `isDriverLineReady()` in `feed.js`:
`phone && vehicleMake && vehicleModel && vehiclePlate && documentsReady === true && waybillOpen === true && medicalCheckPassed === true`.

---

## 8. Mock / localStorage data contracts

All keys live in the browser. Anything created by the spine has a `v` suffix
and is namespaced under `bazardrive.*` to keep migrations explicit.

### 8.1 Existing keys (do not rename without migration)

| Key                              | Owner                | Shape                                                                 | Notes                                                                 |
|----------------------------------|----------------------|-----------------------------------------------------------------------|-----------------------------------------------------------------------|
| `bazardrive.user.v1`             | `state.js`           | user profile (see `buildDefaults()` in `state.js`)                    | Carries `role`, vehicle, `driverDocuments`, `phoneVerified`, etc.     |
| `bazardrive.active_ride.v1`      | `ride_state.js`      | `{ [tripId]: rideObject }`                                            | Keyed map; demo ride id is `trip_moscow_sheremetyevo_demo`.           |
| `bazardrive.draft.v2`            | `composer.js`        | composer draft fields                                                 | Persisted across reloads of `/new`.                                   |
| `bazardrive.respond.v1`          | `respond.js`         | last respond payload                                                  | Used to restore the respond screen.                                   |
| `bazardrive.chat.v1`             | `chat.js`            | `{ [tripId]: messages[] }`                                            | One thread per `tripId`. Migrates old single-thread shape on read.    |
| `bazardrive.posts.v1`            | `mock_api.js`        | legacy `posts[]` for the announcements board                          | Seeded on first read.                                                 |

### 8.2 Planned spine keys (NOT yet written by any screen)

These are reserved for the future route-picker / order-map flow. Any
implementation must pick **new** keys with explicit versioning so the
existing screens keep working.

#### `routeDraft` — planned key `bazardrive.route_draft.v1`

```js
{
  pickup: null,         // { lng, lat, label } | null
  dropoff: null,        // { lng, lat, label } | null
  distanceKm: null,     // number | null
  durationMin: null,    // number | null
  estimatedPrice: null, // number | null
  comment: '',          // string
  scheduledAt: null     // ISO string | null
}
```

#### `rideOrder` — planned key `bazardrive.ride_order.v1`

```js
{
  id: 'BD-1024',           // string
  passengerId: 'mock-passenger',
  driverId: null,          // null until accepted
  pickup: {},              // { lng, lat, label }
  dropoff: {},             // { lng, lat, label }
  distanceKm: 0,
  durationMin: 0,
  estimatedPrice: 0,
  status: 'CREATED',       // mirrors RIDE_STATUS — starts at CREATED
  createdAt: '',           // ISO string
  source: 'mock'
}
```

`status` for `rideOrder` should reuse `RIDE_STATUS` values from
`ride_state.js`. `CREATED` is the conceptual pre-accept state — the
existing `RIDE_STATUS` enum represents it as `NEW_ORDER`. Treat
`CREATED` ≡ `NEW_ORDER` until/unless a real backend introduces a real
"created but unmatched" stage.

#### `activeTrip` — currently expressed as the `rideObject` under `bazardrive.active_ride.v1`

```js
{
  orderId: 'BD-1024',
  passengerId: 'mock-passenger',
  driverId: 'mock-driver',
  role: 'passenger | driver',
  status: 'DRIVER_EN_ROUTE',
  updatedAt: ''
}
```

The current `ride_state.js` store already covers this: each entry is keyed
by `tripId` (analogous to `orderId`) and carries `role`, `status`, and a
`timestamps` block. Future work that introduces a separate `activeTrip`
key should derive from the same `tripId` so chat / active-ride / order
all line up.

---

## 9. Ride status enum (canonical)

Defined in `public/src/ride_state.js` as `RIDE_STATUS`. The spine MUST
NOT add new statuses without a reason — the values below cover every
demo transition currently rendered by `/active-ride`:

```
NEW_ORDER
CONFIRMATION_PENDING
CONFIRMED
CHAT_STARTED
DRIVER_EN_ROUTE
DRIVER_APPROACHING_PICKUP
WAITING_PASSENGER
IN_PROGRESS
COMPLETED
CANCELED
NO_SHOW
```

Mapping to the BD-FLOW-01 requested set:

| BD-FLOW-01 status   | `RIDE_STATUS` value                  |
|---------------------|--------------------------------------|
| `CREATED`           | `NEW_ORDER`                          |
| `ACCEPTED`          | `DRIVER_EN_ROUTE` (after `acceptedAt`) |
| `DRIVER_EN_ROUTE`   | `DRIVER_EN_ROUTE`                    |
| `WAITING_PASSENGER` | `WAITING_PASSENGER`                  |
| `IN_PROGRESS`       | `IN_PROGRESS`                        |
| `COMPLETED`         | `COMPLETED`                          |
| `CANCELED`          | `CANCELED`                           |
| `NO_SHOW`           | `NO_SHOW`                            |

(`ACCEPTED` is not a separate persisted status today — acceptance is
expressed by `status = DRIVER_EN_ROUTE` together with a non-null
`timestamps.acceptedAt`. This avoids adding a status that the existing
driver UI does not render.)

---

## 10. Existing files — role in the flow

| File                                             | Role in BD-FLOW-01                                                                                                                                                                                                                                                                                                                          |
|--------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `public/src/screens/feed.js`                     | The spine's hub. Filters & renders `FEED_POSTS_V2`. Decides per-card CTA based on `user.role` + `isDriverLineReady()`. Materialises a new ride via `createDemoActiveRide()` + `saveActiveRide()` when a ready driver taps "Принять заказ".                                                                                                  |
| `public/src/screens/composer.js`                 | `/new`. Lets passenger / driver compose a publication. Writes draft to `bazardrive.draft.v2`. On publish, calls `createFeedPost()`.                                                                                                                                                                                                          |
| `public/src/screens/respond.js`                  | `/respond?postId=…`. Passenger-side reply / driver-side offer flow against a mock request. Persists last payload to `bazardrive.respond.v1`.                                                                                                                                                                                                 |
| `public/src/screens/chat.js`                     | `/chat?tripId=…`. Per-`tripId` thread, stored in `bazardrive.chat.v1`. Mock quick replies. Back returns to `/feed`.                                                                                                                                                                                                                          |
| `public/src/screens/active_ride.js`              | `/active-ride?role=driver`. Owns the driver state machine. Reads/writes via `ride_state.js` (`findActiveRide`, `updateActiveRideStatus`, `saveActiveRide`, `createDemoActiveRide`). Mounts `createMapShell()` from `map_shell.js`. Delegates passenger role to `active_ride_passenger.js`.                                                  |
| `public/src/screens/active_ride_passenger.js`    | `/active-ride?role=passenger`. Read-only passenger timeline view of the same store. Same `tripId` ↔ same ride object.                                                                                                                                                                                                                       |
| `public/src/ride_state.js`                       | Single source of truth for ride status enum (`RIDE_STATUS`), demo ride factory (`createDemoActiveRide`), persistence helpers (`loadActiveRideStore`, `saveActiveRide`, `updateActiveRideStatus`), and the driver transition map (`getNextDriverStatus`). Key: `bazardrive.active_ride.v1`.                                                  |
| `public/src/mock_api.js`                         | Mock data sources. `listFeedPosts()` returns `FEED_POSTS_V2` (in-memory). `createFeedPost()` prepends user-authored posts. Legacy announcements board persists at `bazardrive.posts.v1`. **Do not change existing keys or shapes** — spine relies on them.                                                                                  |
| `public/src/state.js`                            | User profile store (`bazardrive.user.v1`). Drives onboarding gating, driver readiness (`documentsReady`, `taxiPermit`), passenger profile V2, phone verification. Migrations are one-shot on `load()`. **Do not rewrite** — spine only reads via `user.get()` / `user.set(patch)`.                                                          |
| `public/src/router.js`                           | Hash router. Hides chrome (`tabbar` / `fab`) on `/welcome`, `/onboarding`, `/active-ride`, `/trip-confirmation`. Unknown routes fall through to `/feed`. The fallback is what currently keeps the planned `/route-picker`, `/route-preview`, `/order-map-draft`, `/driver-map`, `/map` URLs from breaking the app — they show `/feed`.    |
| `public/src/mapbox/map_shell.js`                 | Pure-DOM map placeholder used by `/active-ride`. No SDK, no token, no network. Future map screens reuse `createMapShell()` so the placeholder stays the only "map" surface in the spine.                                                                                                                                                     |
| `public/src/screens/trip_confirmation.js`        | `/trip-confirmation`. Bridge between `/chat` and `/active-ride` for the confirmation handshake (uses the reserved `CONFIRMATION_PENDING` / `CONFIRMED` statuses).                                                                                                                                                                            |
| `public/src/screens/responses.js`                | `/responses`. Driver-side inbox of responses (not on the strict spine, reachable from profile).                                                                                                                                                                                                                                              |

---

## 11. Routes — implemented / stub / planned

Registered in `public/src/app.js`:

| Route                       | Status                          | Notes                                                                                                                       |
|-----------------------------|---------------------------------|-----------------------------------------------------------------------------------------------------------------------------|
| `/welcome`                  | **implemented**                 | `welcome.js`.                                                                                                               |
| `/onboarding`               | **implemented**                 | `onboarding.js`. Role pick + vehicle + docs.                                                                                |
| `/profile`                  | **implemented**                 | `profile.js`. Passenger V2 + driver readiness.                                                                              |
| `/feed`                     | **implemented**                 | `feed.js`. Spine hub.                                                                                                       |
| `/rules`                    | **implemented**                 | `rules.js`.                                                                                                                 |
| `/new`                      | **implemented**                 | `composer.js`. Composer is the current "create publication / ride request" step.                                            |
| `/respond`                  | **implemented**                 | `respond.js`.                                                                                                               |
| `/chat`                     | **implemented**                 | `chat.js`. Per-`tripId` threads.                                                                                            |
| `/active-ride`              | **implemented**                 | `active_ride.js` (driver) + `active_ride_passenger.js` (passenger). Picks via `?role=`.                                     |
| `/trip-confirmation`        | **implemented**                 | `trip_confirmation.js`.                                                                                                     |
| `/responses`                | **implemented**                 | `responses.js`. Off-spine but reachable.                                                                                    |
| `/map`                      | **planned (stub via fallback)** | No registered loader. Router falls back to `/feed`. Reserved for a top-level map surface that reuses `createMapShell()`.    |
| `/route-picker`             | **planned (stub via fallback)** | Will write `routeDraft` to `bazardrive.route_draft.v1`. Until implemented, returns `/feed`.                                 |
| `/route-preview`            | **planned (stub via fallback)** | Will read `routeDraft`, show ETA + estimated price. Returns `/feed` today.                                                  |
| `/order-map-draft`          | **planned (stub via fallback)** | Will persist `rideOrder` (status `NEW_ORDER` ≡ `CREATED`). Returns `/feed` today.                                           |
| `/driver-map`               | **planned (stub via fallback)** | Map-based equivalent of "Принять заказ". Returns `/feed` today.                                                             |

The **safe fallback** is intentional: it lets the manual-test URLs in §13
load without breaking the app, while making it obvious in the address
bar that the screen is not yet built.

Any future implementation of these planned routes must:

1. Register the loader in `app.js`.
2. Add the route to `HIDE_CHROME` only if it is meant to take over the
   viewport (`/route-picker`, `/order-map-draft`, `/driver-map` likely).
3. Reuse `createMapShell()` from `public/src/mapbox/map_shell.js` for the
   map surface. **No real Mapbox SDK.**
4. Use the `bazardrive.route_draft.v1` and `bazardrive.ride_order.v1`
   keys defined in §8.2. Do not collide with `bazardrive.active_ride.v1`.

---

## 12. Constraints (must NOT)

- **No real Mapbox SDK.** Use `createMapShell()` only.
- **No backend / API.** All data is mock or `localStorage`.
- **No auth / payments / push.** Phone "verification" is a mock toggle.
- **No APK / Android / TWA.**
- **No CSP relaxation** — `public/index.html` keeps `default-src 'self'`.
- **No inline scripts / inline styles** anywhere in `public/` (enforced
  by `scripts/check.mjs`).
- **Do not rewrite `active_ride.js` or `active_ride_passenger.js`** from
  scratch. They own the driver / passenger ride UI today.
- **Do not replace `index.html` with the prototype.** The prototype lives
  under `public/prototypes/` and is excluded from precache (enforced by
  `scripts/check.mjs`).
- **Do not rename existing `localStorage` keys** without a migration in
  `state.js` (see `migrateLegacy`). Always bump the `v` suffix.

---

## 13. Manual test path

Open `public/index.html` in a browser (or serve `public/`). Then walk
through:

```
#/welcome
#/onboarding
#/profile
#/feed
#/new
#/route-picker          ← planned, falls back to /feed today
#/route-preview         ← planned, falls back to /feed today
#/order-map-draft       ← planned, falls back to /feed today
#/driver-map            ← planned, falls back to /feed today
#/respond
#/chat
#/active-ride?role=driver&status=DRIVER_EN_ROUTE
#/active-ride?role=passenger&status=DRIVER_EN_ROUTE
#/active-ride?role=driver&status=WAITING_PASSENGER
#/active-ride?role=passenger&status=WAITING_PASSENGER
#/active-ride?role=driver&status=IN_PROGRESS
#/active-ride?role=passenger&status=IN_PROGRESS
#/active-ride?role=driver&status=COMPLETED
#/active-ride?role=passenger&status=COMPLETED
```

Expected:

- Welcome → onboarding gate works on a fresh `localStorage`.
- `/feed` shows mock posts; FAB navigates to `/new`.
- `/new` composer persists across reloads.
- `/respond` and `/chat` survive `tripId` round-trips.
- `/active-ride?role=driver` advances through the state machine without
  touching `/active-ride?role=passenger`.
- Planned routes do not throw — router falls back to `/feed`.
- `node scripts/check.mjs` exits with `All checks passed.`

---

## 14. Spine summary

The BD-FLOW-01 spine = these moving parts:

- **Routing:** `router.js` (hash-based, unknown → `/feed`).
- **User profile:** `state.js` (`bazardrive.user.v1`).
- **Mock content:** `mock_api.js` (`FEED_POSTS_V2`, `bazardrive.posts.v1`).
- **Ride state machine + store:** `ride_state.js`
  (`bazardrive.active_ride.v1`, `RIDE_STATUS`, driver transitions).
- **Chat thread store:** `chat.js` (`bazardrive.chat.v1`, per-`tripId`).
- **Composer draft store:** `composer.js` (`bazardrive.draft.v2`).
- **Map surface:** `map_shell.js` (DOM-only placeholder).
- **Screens already wired in `app.js`:** `/welcome`, `/onboarding`,
  `/profile`, `/feed`, `/rules`, `/new`, `/respond`, `/chat`,
  `/active-ride`, `/responses`, `/trip-confirmation`.
- **Reserved (planned) routes:** `/map`, `/route-picker`,
  `/route-preview`, `/order-map-draft`, `/driver-map` — safe under the
  router fallback today, planned for the route-picker / order-map work.

Future work plugs into this spine by:

1. Adding a loader in `app.js`.
2. Writing to the **new** namespaced `localStorage` keys defined in §8.2.
3. Reusing `RIDE_STATUS` instead of inventing parallel enums.
4. Reusing `createMapShell()` instead of any real map SDK.
