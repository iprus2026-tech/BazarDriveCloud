# /trip-confirmation → /active-ride handoff audit (BD-HANDOFF-03)

Status: snapshot taken on the `claude/funny-einstein-Kve4I` branch after
BD-HANDOFF-02 (double-click guard + stale handoff cleanup on
`/trip-confirmation`). Audit-only — no code changes to runtime modules.
No backend, no Mapbox SDK, no payment / auth / push wiring is in place.

The goal is to make the *contract* between `/trip-confirmation` and
`/active-ride` explicit, so we can decide whether BD-HANDOFF-04 (seed
active ride from confirmed handoff) is actually needed, or whether the
URL-driven status reseed already covers it.

---

## 1. Surfaces involved

| Screen                | File                                        | Role |
|-----------------------|---------------------------------------------|------|
| `/chat`               | `public/src/screens/chat.js`                | Source of the passenger confirmation event. Writes `bazardrive.trip_confirmation.v1`. |
| `/trip-confirmation`  | `public/src/screens/trip_confirmation.js`   | Render gate. Reads the handoff record, renders one of five UI states, dispatches into `/active-ride`. |
| `/active-ride`        | `public/src/screens/active_ride.js`         | Driver active ride. Owns `bazardrive.active_ride.v1` via `ride_state.js`. |
| `/active-ride` (pass) | `public/src/screens/active_ride_passenger.js` | Passenger view, dispatched from `active_ride.js` when `role=passenger`. View-only over the same store. |
| `ride_state.js`       | `public/src/ride_state.js`                  | `bazardrive.active_ride.v1` contract: `load/find/get/saveActiveRide`, `updateActiveRideStatus`, `createDemoActiveRide`, `SIM_AUDIT_RIDE_OVERRIDES`. |
| `ride_history.js`     | `public/src/ride_history.js`                | `bazardrive.ride_history.v1`. Out of scope here — only written at completion, not consulted in the handoff path. |

---

## 2. What `/chat` writes to the handoff store

Key: `bazardrive.trip_confirmation.v1`.

Shape: `{ [tripId]: Handoff }` (map keyed by `tripId`).

`chat.js` writes one entry when the passenger taps the
`Подтвердить поездку` CTA in the ride-context confirm bar
(`#chat-confirm`). The CTA is only rendered when
`resolveRideContext({ responseId })` finds a stored response of
`kind === 'passenger_response'` with a `tripId` in
`bazardrive.responses.v1`.

Written record (`chat.js:108-117`, `chat.js:359-378`):

```js
{
  tripId:     <string>,              // from response.tripId
  responseId: <string> | null,       // URL ?responseId=...
  role:       'passenger',
  state:      'CONFIRMED',
  createdAt:  <ms epoch>,
  expiresAt:  <ms epoch + 30 * 60 * 1000>, // HANDOFF_TTL_MS = 30 min
}
```

Then `chat.js` navigates to
`/trip-confirmation?tripId=<id>&role=passenger&state=CONFIRMED`
(`chat.js:373-378`).

A synchronous JS-side latch + a `disabled` flip on the button suppress
double-clicks, so a second tap cannot re-write the entry or stack two
router navigations (BD-HANDOFF-02).

`chat.js` does **not** write anywhere into `bazardrive.active_ride.v1`.

---

## 3. What `/trip-confirmation` reads

`trip_confirmation.js` consults the handoff store on every render:

```js
const handoff = loadHandoff(rawTripId);             // L481
if (handoff && isHandoffExpired(handoff)) {
  deleteHandoff(rawTripId);                          // L482-484, BD-HANDOFF-02
}
const state = resolveState(query.get('state'), role, handoff);
```

`resolveState` (`trip_confirmation.js:138-153`) uses the record only to
authorize the `state=CONFIRMED` URL alias:

- If `handoff.expiresAt < Date.now()` → render `EXPIRED`, regardless of
  the `?state=` URL param.
- If `?state=CONFIRMED` AND the stored record exists with
  `state === 'CONFIRMED'` AND `handoff.role === role` →
  resolve to `PASSENGER_CONFIRMED` / `DRIVER_CONFIRMED` and render the
  confirmed UI.
- Otherwise, fall back to `DRIVER_WAITING` / `PASSENGER_PENDING`.

This is the only way `?state=CONFIRMED` is honored. A direct URL with
`?state=CONFIRMED` but no backing handoff record drops back to the
pending/waiting variant — the screen cannot be tricked into showing a
confirmed UI by URL alone.

`trip_confirmation.js` does **not** read `bazardrive.responses.v1`,
`bazardrive.respond.v1` or `bazardrive.active_ride.v1`. The
driver/passenger/route cards are still `MOCK_*` literals
(L64-91), unchanged since BD-CONFIRM-01.

---

## 4. What `/trip-confirmation` passes to `/active-ride`

The two CTAs that leave for `/active-ride` are wired in
`trip_confirmation.js:522-534`:

```js
function goActiveRidePassenger() {
  go(`/active-ride?role=passenger&tripId=${encodeURIComponent(tripId)}&status=DRIVER_EN_ROUTE`);
}
function goActiveRideDriver() {
  go(`/active-ride?role=driver&tripId=${encodeURIComponent(tripId)}&status=DRIVER_EN_ROUTE`);
}
```

i.e. the handoff carries only **three URL params**:

| Param    | Value                                          |
|----------|------------------------------------------------|
| `role`   | `'passenger'` or `'driver'`                    |
| `tripId` | the URL `tripId` (or `DEMO_TRIP_ID = '48-321'` fallback) |
| `status` | always `'DRIVER_EN_ROUTE'`                     |

No handoff identifier, no `responseId`, no `state`, no expiry is
forwarded. The `bazardrive.trip_confirmation.v1` entry is **not**
deleted at this point — it just stops being read once we leave the
`/trip-confirmation` route (the next `/trip-confirmation` render on the
same `tripId` would still see it for ≤30 min).

---

## 5. Does `/active-ride` read `bazardrive.trip_confirmation.v1`?

**No.** A repo-wide search confirms it:

```
$ grep -n "trip_confirmation\|TRIP_CONFIRM" \
    public/src/screens/active_ride.js \
    public/src/screens/active_ride_passenger.js \
    public/src/ride_state.js \
    public/src/ride_history.js
(no matches)
```

Neither active-ride entry point imports or references the handoff key.
The TTL'd "this confirmation is fresh" signal that `chat.js` writes and
`trip_confirmation.js` reads is dropped at the route boundary.

---

## 6. Does `/active-ride` seed `bazardrive.active_ride.v1`?

Depends on the role and whether a record already exists for `tripId`.

### 6.1 Driver (`active_ride.js:386-399`)

```js
const tripId = query.get('tripId') || DEMO_ACTIVE_RIDE_ID;
const statusQuery = query.get('status');
let ride = findActiveRide(tripId);
if (!ride) {
  if (!statusQuery || !DRIVER_SIMULATION_STATUSES.has(statusQuery)) {
    return renderDriverEmpty();
  }
  ride = createDemoActiveRide({ tripId, ...SIM_AUDIT_RIDE_OVERRIDES });
}
ride = safeApplyStatusFromQuery(ride, statusQuery);
```

- If a ride record already exists for this `tripId` in
  `bazardrive.active_ride.v1`: reuse it and overlay status from the URL
  (subject to monotonic timestamp guards in `safeApplyStatusFromQuery`).
- If no record exists AND `?status=` is one of the
  `DRIVER_SIMULATION_STATUSES` (which includes `DRIVER_EN_ROUTE` —
  exactly what `/trip-confirmation` hands off): synthesize an
  **in-memory** demo ride from `createDemoActiveRide({ tripId,
  ...SIM_AUDIT_RIDE_OVERRIDES })`.

  Note: this demo ride is **not** written back to localStorage from the
  initial materialization. It only lands in
  `bazardrive.active_ride.v1` when a downstream lifecycle action
  (`#ar-accept`, `updateActiveRideStatus`, etc.) calls `saveActiveRide`.
  Until then, refreshing `/active-ride?role=driver&tripId=…&status=…`
  rebuilds it again from `SIM_AUDIT_RIDE_OVERRIDES`.

- If no record exists AND `?status=` is missing/unknown: render
  `renderDriverEmpty()` ("Нет активного заказа").

### 6.2 Passenger (`active_ride_passenger.js:142-152`)

```js
function loadPassengerRideView(tripId, statusQuery) {
  let ride = findActiveRide(tripId);
  if (!ride) {
    const overrides = statusQuery ? SIM_AUDIT_RIDE_OVERRIDES : {};
    ride = createDemoActiveRide({ tripId, ...overrides });
  }
  if (ride.status === RIDE_STATUS.NEW_ORDER) {
    return { ...ride, status: RIDE_STATUS.DRIVER_EN_ROUTE };
  }
  return ride;
}
```

The passenger view is **always** willing to render — `findActiveRide`
miss falls back to an in-memory demo ride. Same as the driver path, this
demo is only persisted by later lifecycle actions
(`updateActiveRideStatus` on accept/cancel/complete).

### 6.3 Summary

`/trip-confirmation` does **not** seed `bazardrive.active_ride.v1`
itself, and neither active-ride entry point seeds it eagerly on first
render. Persistence is lazy and lifecycle-driven inside
`ride_state.js`.

---

## 7. Passenger fallback when no active ride record exists

Path: `/trip-confirmation?role=passenger&tripId=X&state=CONFIRMED` →
tap `Открыть поездку` → `/active-ride?role=passenger&tripId=X&status=DRIVER_EN_ROUTE`.

- `active_ride.js:386-389` routes to `activeRidePassenger({ tripId,
  statusQuery: 'DRIVER_EN_ROUTE', ... })`.
- `loadPassengerRideView` calls `findActiveRide(tripId)` → `null` (the
  handoff never wrote here).
- Falls back to `createDemoActiveRide({ tripId,
  ...SIM_AUDIT_RIDE_OVERRIDES })`. Demo passenger is "Алексей", route is
  "ТЦ Мега → Шереметьево, терминал B", price `950 ₽`, etc.
- `applyPassengerStatusFromQuery` accepts `DRIVER_EN_ROUTE` and the
  passenger sees the BD-RIDE-P-02 en-route shell.

Consequence: the passenger always lands on a renderable screen, but
the passenger identity / route / price on `/active-ride` are the
`SIM_AUDIT` demo, not whatever the user just confirmed on
`/trip-confirmation` (which itself was `MOCK_*` literals from
`trip_confirmation.js`). The two screens already agree on **nothing**
substantive — they just both happen to show plausible mock content.

This is the same fallback path used by direct audit URLs (BD-RIDE-SIM-01),
so the behavior is consistent, not handoff-specific.

---

## 8. Driver fallback when no active ride record exists

Path: `/trip-confirmation?role=driver&tripId=X&state=CONFIRMED` →
tap `Ехать к пассажиру` → `/active-ride?role=driver&tripId=X&status=DRIVER_EN_ROUTE`.

- `findActiveRide(X)` → `null`.
- `DRIVER_SIMULATION_STATUSES` includes `DRIVER_EN_ROUTE`, so the screen
  does **not** render `renderDriverEmpty()`. Instead, it materializes
  the same `SIM_AUDIT_RIDE_OVERRIDES`-based demo ride in memory.
- The driver sees the en-route sheet with the Alexei demo passenger.

If the user instead navigates to `/active-ride?role=driver` without a
matching `tripId`-keyed record AND without a valid `?status=`, they
hit `renderDriverEmpty()` — "Нет активного заказа. Откройте ленту и
примите заказ.". That branch is unreachable from the confirmation
flow today, because `trip_confirmation.js` always appends
`status=DRIVER_EN_ROUTE`.

---

## 9. Direct / forged URL behavior

### 9.1 Direct hit on `/active-ride` without going through confirmation

`/active-ride?role=passenger&tripId=anything&status=DRIVER_EN_ROUTE`
renders the passenger en-route view (see §7). The same URL with
`role=driver` materializes the driver en-route view (see §8).

`/active-ride` does **not** verify that a `bazardrive.trip_confirmation.v1`
record exists for `tripId`. There is no gating handshake. A user who
types or bookmarks the URL — or follows a stale link — bypasses the
chat → confirmation chain entirely and still sees a plausible mock ride.

For the current render-only milestone this is intentional (audit URLs,
deep-link tests, SIM-01 scenarios all depend on it), but it does mean
the freshness signal that `chat.js` wrote and `trip_confirmation.js`
honored is silently dropped at the active-ride boundary.

### 9.2 Forged `/trip-confirmation?state=CONFIRMED`

If a user crafts
`/trip-confirmation?role=passenger&tripId=fake&state=CONFIRMED`
without ever passing through `/chat`:

- `loadHandoff('fake')` → `null`.
- `resolveState('CONFIRMED', 'passenger', null)` falls through to
  `PASSENGER_PENDING` (`trip_confirmation.js:145-150`).
- The passenger sees the "Подтвердите поездку" pending UI, **not** the
  confirmed UI. They can then tap `Подтвердить поездку`, which only
  bumps the URL `?state=PASSENGER_CONFIRMED` in-screen (no store write,
  no `expiresAt`), and from there open `/active-ride`.

So `/trip-confirmation` itself is not URL-forgeable into a confirmed
state, but the *downstream* `/active-ride` is reachable regardless.

### 9.3 Driver forging passenger handoff (role mismatch)

A passenger-written record cannot be replayed as a driver-confirmation:
`resolveState` requires `handoff.role === role`
(`trip_confirmation.js:146-147`). With `?role=driver&state=CONFIRMED`
backed by a `role: 'passenger'` record, the screen falls through to
`DRIVER_WAITING`, not `DRIVER_CONFIRMED`.

---

## 10. Expired handoff behavior

TTL: 30 minutes from `createdAt` (`chat.js:11`).

On the next `/trip-confirmation` render past `expiresAt`:

1. `loadHandoff(tripId)` returns the stale record.
2. `isHandoffExpired(handoff)` → `true`.
3. `deleteHandoff(tripId)` removes the entry from
   `bazardrive.trip_confirmation.v1` — exactly once (BD-HANDOFF-02).
4. `resolveState` returns `CF_STATE.EXPIRED` regardless of the `?state=`
   URL param. The user sees the `renderExpired` variant with the
   "Не удалось открыть подтверждение" hero and the
   `back-to-feed` / `open-chat` CTAs.

Once `deleteHandoff` has run, a refresh on the same URL no longer hits
the expired path — `loadHandoff` returns `null`, and the screen falls
through to `PASSENGER_PENDING` / `DRIVER_WAITING` (the default for the
role). That is consistent with the chat being the sole writer: without
a fresh tap on `#chat-confirm`, there is no record to re-render.

`/active-ride` has no notion of expiry. If a user already navigated
into `/active-ride?status=DRIVER_EN_ROUTE&tripId=…` and the TTL elapses
while they sit on that screen, nothing changes — there is no clock
binding the active ride to the handoff record. This is fine in the
current mock-only flow (active ride owns its own lifecycle), but it
does mean the 30-minute freshness signal is local to `/trip-confirmation`.

---

## 11. Findings

1. The handoff chain `chat.js → trip_confirmation.js` is internally
   coherent: chat writes, trip-confirmation reads & authorizes the
   `CONFIRMED` alias, expiry deletes once. Role mismatches and forged
   URLs are correctly rejected at the confirmation gate.

2. The handoff chain `trip_confirmation.js → active_ride.js` is **not**
   linked by storage. `/active-ride` receives only `role`, `tripId`,
   `status=DRIVER_EN_ROUTE` on the URL and does not consult
   `bazardrive.trip_confirmation.v1`. The freshness/role guarantee
   established at the gate evaporates the moment the user crosses the
   route boundary.

3. Both active-ride entry points already render successfully without a
   persisted record by falling back to an in-memory
   `createDemoActiveRide({ ...SIM_AUDIT_RIDE_OVERRIDES })`. So there is
   no functional crash, broken render, or empty-state regression from
   the missing seed — only a content divergence:
   `/trip-confirmation` shows `MOCK_*` (Анна / Рустам / Малая Бронная →
   Шереметьево), and `/active-ride` shows `SIM_AUDIT_*` (Алексей / ТЦ
   Мега → Шереметьево, terminal B).

4. The `bazardrive.trip_confirmation.v1` entry written by chat is
   **never cleared by a successful transition into `/active-ride`**.
   It only disappears when (a) the TTL expires and
   `/trip-confirmation` is revisited, or (b) the user explicitly logs
   out and `clearTripConfirmationMap` is invoked by
   `storage_boundary.clearUserScopedStorage`. This is not a bug per se,
   but it means a returning user with a stale-but-not-expired entry can
   re-enter `/trip-confirmation?...&state=CONFIRMED` and see the
   confirmed UI a second time. Out of scope for this audit; flagging
   for visibility.

5. Direct/forged `/active-ride` URLs are accepted unconditionally
   (within `DRIVER_SIMULATION_STATUSES`). This is intentional for
   BD-RIDE-SIM-01 audit links and deep-link tests, and removing it
   would break those flows. So any future "active ride must be seeded
   from a confirmed handoff" requirement must be additive, not
   restrictive.

---

## 12. Recommendation for the next issue

**Docs-only is enough for BD-HANDOFF-03.** No code change is required
in this audit PR.

`/active-ride` is functional under the current handoff: both roles
render, no empty state, no crash. The remaining gap is a *content*
divergence — `/trip-confirmation` shows MOCK_* identities and
`/active-ride` shows SIM_AUDIT_* identities — and a *freshness*
divergence — the 30-minute TTL stops mattering once the user crosses
into `/active-ride`.

Whether that justifies a follow-up depends on the next milestone:

- **If the next milestone is "real handoff data" (hydrate
  `/active-ride` from the same passenger/driver/route the user just
  confirmed)**, file **BD-HANDOFF-04 — Seed `/active-ride` from
  confirmed handoff**. Minimal scope:
  1. On the `open-ride-passenger` / `open-ride-driver` action in
     `trip_confirmation.js`, write a seed record into
     `bazardrive.active_ride.v1` (via `saveActiveRide` from
     `ride_state.js`) keyed by `tripId`, derived from the same MOCK_*
     literals the screen already renders (or, better, from
     `bazardrive.responses.v1` + the post, once that hydration ships
     for `/trip-confirmation`).
  2. Optionally delete the consumed
     `bazardrive.trip_confirmation.v1[tripId]` entry on the same tap,
     so the handoff is single-use.
  3. Leave `active_ride.js` and `active_ride_passenger.js` untouched —
     `findActiveRide(tripId)` will then return the seeded record
     instead of falling through to `createDemoActiveRide(...
     SIM_AUDIT_RIDE_OVERRIDES)`.
  4. Keep the SIM_AUDIT fallback for the no-record + valid-status case
     — that path is owned by BD-RIDE-SIM-01 and must stay reachable.

- **If the next milestone is something else (real chat hydration, real
  responses-store consumption, etc.)**, BD-HANDOFF-04 is not blocking.
  The current SIM_AUDIT fallback is good enough for visual continuity
  in the mock-only flow.

In either case, no `ride_state.js` behavior change is required: the
existing `saveActiveRide(ride)` + `findActiveRide(tripId)` API is
sufficient to seed and read back the record.

---

## 13. Manual test matrix (for follow-up verification)

| # | Scenario | Expected today | Notes |
|---|----------|----------------|-------|
| 1 | Fresh `/chat?responseId=…` (passenger ride) → tap `Подтвердить поездку` → tap `Открыть поездку` on confirmation. | Lands on `/active-ride` passenger en-route view with **SIM_AUDIT** content (Alexei). | Confirms §7. |
| 2 | Same as #1 but `role=driver`. | Driver en-route view, SIM_AUDIT content. | Confirms §8. |
| 3 | Direct URL `/active-ride?role=passenger&tripId=foo&status=DRIVER_EN_ROUTE` (no chat write). | Passenger en-route view with SIM_AUDIT content; `bazardrive.trip_confirmation.v1` untouched. | Confirms §9.1. |
| 4 | Forged `/trip-confirmation?role=passenger&tripId=foo&state=CONFIRMED` (no chat write). | Falls through to `PASSENGER_PENDING`. | Confirms §9.2. |
| 5 | Confirm with `role=passenger`, then open `/trip-confirmation?role=driver&tripId=…&state=CONFIRMED`. | Falls through to `DRIVER_WAITING`. | Confirms §9.3. |
| 6 | Confirm at `t=0`, wait 30 min, revisit `/trip-confirmation?...&state=CONFIRMED`. | `EXPIRED` variant; entry removed from `bazardrive.trip_confirmation.v1`. | Confirms §10. |
| 7 | Same as #1, but inspect `localStorage` after landing on `/active-ride`. | `bazardrive.active_ride.v1` is still empty (nothing was seeded); `bazardrive.trip_confirmation.v1` still contains the (un-expired) entry. | Confirms §6.3 + §11.4. |

These cases are observable with the existing screens and DevTools —
no fixture, no script. They are the candidate acceptance tests for
BD-HANDOFF-04 if/when it is opened.
