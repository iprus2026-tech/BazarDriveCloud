# Respond → Chat → TripConfirmation → ActiveRide handoff audit

Status: snapshot taken on the `claude/respond-polish-handoff-kRosX` branch
after BD-RESPOND-03 polish. Render-only audit; no backend / Mapbox /
payment / auth / push wiring is in place.

The goal of this document is to make the *data contract* between screens
explicit, so the next issue (real handoff) can be scoped against a single,
shared map rather than re-discovering it from the source each time.

---

## 1. Surfaces involved

| Screen              | File                                            | Role in the flow |
|---------------------|-------------------------------------------------|------------------|
| `/respond`          | `public/src/screens/respond.js`                 | Driver writes mock response to a passenger ride; passenger writes a message to a marketplace seller. |
| `/chat`             | `public/src/screens/chat.js`                    | Conversation surface. Mock-only messages, but persists per-`chatId` to localStorage. |
| `/trip-confirmation`| `public/src/screens/trip_confirmation.js`       | Render gate between chat and the active ride. Five UI states, mock data only. |
| `/active-ride`      | `public/src/screens/active_ride.js`             | Active ride. Not in scope for this issue. |

Router wiring (`public/src/app.js`): `/respond → respond`,
`/chat → chat`, `/trip-confirmation → tripConfirmation`,
`/active-ride → activeRide`.

---

## 2. What `/respond` writes

`renderPassengerRide` (the driver responding to a passenger trip):

```js
// public/src/screens/respond.js
const responseId = `resp_${post.id}`;
saveResponse({
  id:           responseId,
  kind:         'passenger_response',
  requestId:    post.id,
  driverPrice:  Number(price),
  pickupTiming: 'at_time' | 'earlier' | 'negotiate',
  message:      string,
  vehicleId:    'user_vehicle',
  status:       'SENT',
  createdAt:    ISO string,
});
```

Persisted to `localStorage['bazardrive.respond.v1']` as **one** JSON
object (single slot — a second response overwrites the previous one).

Success CTA: `Открыть чат` →
`/chat?responseId=resp_<postId>`.

`renderMarketplace` (writing to a seller):

```js
saveResponse({
  id:        'resp_demo_001',   // ⚠ hardcoded
  kind:      'marketplace_message',
  requestId: post.id,
  message:   string,
  status:    'SENT',
  createdAt: ISO string,
});
```

Success CTA: `Готово` → `/feed`. No chat handoff for marketplace.

`renderUnsupported` / `renderMissing` write nothing.

Note: `respond.js` never writes to `bazardrive.chat.v1` itself —
the chat store stays empty for the freshly created `responseId` until the
user sends a first message inside `/chat`.

---

## 3. What `/chat` reads

`chat.js` derives `chatId` from URL query:

```js
const tripId     = getRouteParam('tripId');
const responseId = getRouteParam('responseId');
const chatId = tripId
  ? `trip-${tripId}`
  : responseId
    ? `response-${responseId}`
    : 'demo';
```

It then reads `localStorage['bazardrive.chat.v1']`, which is a
`{ [chatId]: Message[] }` map (with a legacy `{ chatId, messages }`
shape migrated on load). If the slot is empty the screen falls back to
`MOCK_MESSAGES`.

It does **not** read `bazardrive.respond.v1`. That means:

- The driver / passenger names, ratings, route and price shown in the
  chat header come from `MOCK_DRIVER` / `MOCK_TRIP` constants, **not**
  from the response the driver just submitted.
- The quick-reply `"Подтверждаю поездку"` only inserts plain text into
  the input. There is **no** state transition into
  `/trip-confirmation`.

Result: today the `/respond` → `/chat` jump opens a chat scoped to the
right `responseId`, but the chat UI itself is decoupled from the response
payload.

---

## 4. What `/trip-confirmation` expects

`tripConfirmation.js` is intentionally render-only. It reads three URL
query params:

| Param     | Values                                                                                  | Default                              |
|-----------|-----------------------------------------------------------------------------------------|--------------------------------------|
| `role`    | `driver` \| `passenger`                                                                 | `passenger`                          |
| `tripId`  | any string                                                                              | `'48-321'` (`DEMO_TRIP_ID`)          |
| `state`   | `PASSENGER_PENDING` \| `DRIVER_WAITING` \| `PASSENGER_CONFIRMED` \| `DRIVER_CONFIRMED` \| `EXPIRED` | `DRIVER_WAITING` if role=driver, else `PASSENGER_PENDING` |

Everything else (passenger name, driver name, route, price, ETA) comes
from `MOCK_PASSENGER` / `MOCK_DRIVER` / `MOCK_ROUTE` literals inside the
file. It does **not** read `bazardrive.respond.v1` or
`bazardrive.chat.v1`.

Outbound transitions:

- `passenger-confirm` →
  `/trip-confirmation?role=passenger&tripId=…&state=PASSENGER_CONFIRMED`
  (in-screen state bump, no storage write).
- `open-ride-passenger` →
  `/active-ride?role=passenger&tripId=…&status=DRIVER_EN_ROUTE`.
- `open-ride-driver` →
  `/active-ride?role=driver&tripId=…&status=DRIVER_EN_ROUTE`.
- `open-chat` / `back-to-chat` → `/chat` (no `tripId` or `responseId` —
  drops back to the demo chat).

---

## 5. localStorage keys used along the flow

| Key                              | Owner                                      | Shape (relevant subset)                                          |
|----------------------------------|--------------------------------------------|------------------------------------------------------------------|
| `bazardrive.user.v1`             | `state.js`                                 | `{ vehicleMake, vehicleModel, vehiclePlate, vehicleColor, … }` — used by `/respond` to gate the driver flow. |
| `bazardrive.respond.v1`          | `/respond`                                 | Single response object (see §2). **Only `/respond` writes; nobody reads it back yet.** |
| `bazardrive.chat.v1`             | `/chat`, `/active-ride`                    | `{ [chatId]: Message[] }`, with `chatId ∈ { 'demo', 'trip-<id>', 'response-<id>' }`. |
| `bazardrive.active_ride.v1`      | `ride_state.js` (`/active-ride`)           | Active-ride state machine. Out of scope here. |
| `bazardrive.posts.v1`            | `mock_api.js`                              | Feed posts (source of the `post` object that `/respond` opens). |
| `bazardrive.myposts.v1`          | `mock_api.js`                              | User-created posts. |
| `bazardrive.draft.v2`            | `composer.js`                              | New-post draft. |
| `bazardrive.map_prefs.v1`        | `mapbox_state.js`                          | Map preferences. |

Key observation: **only `bazardrive.respond.v1` and the `chat.v1`
`response-<id>` slot ever encode information that is specific to a
particular response.** Nothing downstream of `/chat` (trip-confirmation,
active-ride) currently consumes either.

---

## 6. The handoff seam (today vs. desired)

Today:

```
[/respond]                 writes bazardrive.respond.v1 (one slot)
   │
   │ go('/chat?responseId=resp_<postId>')
   ▼
[/chat]                    reads bazardrive.chat.v1[`response-<id>`]
                           but ignores bazardrive.respond.v1 entirely
                           — header/trip bar are MOCK_DRIVER / MOCK_TRIP
   │
   │ quick reply "Подтверждаю поездку" → inserts text, no nav
   │ (no path from /chat to /trip-confirmation at all)
   ▼
[/trip-confirmation]       only reachable by direct URL today;
                           reads ?state/?role/?tripId, uses MOCK_*
   │
   │ data-cf-action='open-ride-passenger' | 'open-ride-driver'
   ▼
[/active-ride?…&status=DRIVER_EN_ROUTE]
```

Gaps the next issue has to close, in roughly the order they bite:

1. **No `/chat → /trip-confirmation` transition.** The `Подтверждаю
   поездку` quick reply needs to (a) post the message and (b) navigate to
   `/trip-confirmation?role=passenger&tripId=<id>&state=PASSENGER_PENDING`.
2. **No `responseId → tripId` mapping.** `/respond` produces
   `responseId = resp_<postId>`; `/trip-confirmation` and `/active-ride`
   key off `tripId`. We need either to reuse `postId` as `tripId`
   end-to-end or to add a `tripId` field to the persisted response and
   carry it through the URL.
3. **`/chat` and `/trip-confirmation` ignore the persisted response.**
   The driver name/avatar, route (`from`/`to`/`when`) and price shown in
   both screens are hard-coded mocks. They should be hydrated from
   `bazardrive.respond.v1` + the underlying `post` from
   `bazardrive.posts.v1`.
4. **`bazardrive.respond.v1` is a single slot.** Marketplace writes use
   the hardcoded id `resp_demo_001`. Once we want multiple in-flight
   responses, this needs to become a `{ [responseId]: Response }` map
   (mirroring the `chat.v1` shape).
5. **No confirmation persistence.** `passenger-confirm` updates the URL
   only — refreshing or revisiting loses the transition. The next issue
   should write a `status` field (e.g. `CONFIRMED`) onto the response
   record before navigating to `/active-ride`.

---

## 7. Minimal next issue (BD-HANDOFF-01, proposed scope)

Goal: make `/respond → /chat → /trip-confirmation → /active-ride` a
single, persisted, mock-only flow, without touching backend / Mapbox /
payments.

Concrete deliverables for the next issue:

1. **Shape change to `bazardrive.respond.v1`**: convert the slot to
   `{ [responseId]: Response }`. Add `tripId` (= `post.id` for now) and
   `status` (`'SENT' | 'CONFIRMED' | 'CANCELLED'`) fields. Migrate the
   old single-object shape on read, mirroring what `chat.js` already does
   for its legacy shape.
2. **Hydrate `/chat`**: when `responseId` is present in the URL, look up
   the response (and through it the underlying post) and use it to
   render the trip bar and driver/passenger card instead of `MOCK_TRIP`
   / `MOCK_DRIVER`.
3. **Wire the `Подтверждаю поездку` quick reply** to send the message
   *and* navigate to
   `/trip-confirmation?role=passenger&tripId=<id>&state=PASSENGER_PENDING`.
   Pass the `responseId` along too so `/trip-confirmation` can hydrate.
4. **Hydrate `/trip-confirmation`**: when `tripId` (or `responseId`) is
   present, replace `MOCK_PASSENGER` / `MOCK_DRIVER` / `MOCK_ROUTE` with
   data derived from the response + post. Keep mocks as a fallback for
   direct URL hits.
5. **Persist `passenger-confirm`**: flip the response status to
   `CONFIRMED` in `bazardrive.respond.v1` before re-rendering the
   confirmed state.
6. **Do not touch** `active_ride.js`, `active_ride_passenger.js`,
   `ride_state.js`, `router.js`, the CSP, or anything Mapbox/payment
   related. The active ride already accepts
   `?role=…&tripId=…&status=DRIVER_EN_ROUTE` and that contract stays
   stable.

What is explicitly **out of scope** for the next issue:

- Real network calls / backend sync.
- A second-device handoff (the whole flow remains single-device,
  localStorage-only).
- Payment, auth, push, calls, safety sheet.
- Any change to `/active-ride` internals.
- Map rendering on `/trip-confirmation`.
