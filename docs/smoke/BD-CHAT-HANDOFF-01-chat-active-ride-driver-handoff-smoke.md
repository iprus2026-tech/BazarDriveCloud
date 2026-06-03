# BD-CHAT-HANDOFF-01 — chat → active ride → driver handoff smoke

Static source-level regression smoke for the passenger handoff chain that runs
from the chat screen through trip confirmation into the active ride, including
the driver handoff snapshot.

## Scope

The passenger flow must walk a strict path and must **not** shortcut
`/chat → /active-ride`. The smoke (`scripts/smoke-chat-handoff.mjs`) reads five
source files and asserts the contract still holds in source — no browser, no
DOM, no network, no behaviour change.

Out of scope: backend, real Mapbox SDK, auth, push, payments, CSP changes,
service-worker changes, state-machine redesign, `active_ride.js` rewrite,
real timers / TTL expiry, real `localStorage` round-trips, browser automation.

## Verified chain

1. `/chat?responseId=<passenger_response>` — the CTA unlocks **only** when a
   stored response of `kind === 'passenger_response'` with a `tripId` backs the
   thread (`resolveRideContext`).
2. The user taps **«Подтвердить поездку»** (`#chat-confirm`).
3. chat.js writes the handoff to `localStorage` key
   `bazardrive.trip_confirmation.v1` with
   `{ tripId, responseId, role: 'passenger', state: 'CONFIRMED', createdAt, expiresAt }`.
4. chat.js navigates to `/trip-confirmation?tripId=…&role=passenger&state=CONFIRMED`
   — it **never** calls `go('/active-ride')` directly.
5. `/trip-confirmation` trusts the `CONFIRMED` state only for a **fresh,
   role-matching** handoff (`resolveState` requires
   `handoff.state === 'CONFIRMED' && handoff.role === role`; expiry rejected).
6. The passenger CTA seeds `bazardrive.active_ride.v1`
   (`seedActiveRideFromConfirmedHandoff({ tripId, role: 'passenger' })`) and opens
   `/active-ride?role=passenger&tripId=…&status=DRIVER_EN_ROUTE`.
7. The driver CTA seeds the canonical active ride for the driver role, saves a
   driver handoff snapshot (`saveDriverHandoffSnapshot(...)`) and opens
   `/active-ride?role=driver&tripId=…&status=DRIVER_EN_ROUTE`.

## Files inspected

| File | What was checked |
| --- | --- |
| `public/src/app.js` | Imports `chat`, `tripConfirmation`, `activeRide`; registers `/chat`, `/trip-confirmation`, `/active-ride`. |
| `public/src/screens/chat.js` | `CHAT_KEY`, `RESPONSES_KEY`, `TRIP_CONFIRM_KEY = 'bazardrive.trip_confirmation.v1'`, `HANDOFF_TTL_MS`; `resolveRideContext` passenger-only gate; `#chat-confirm` handoff write fields; `go('/trip-confirmation?…')`; **no** direct `go('/active-ride')`. |
| `public/src/screens/trip_confirmation.js` | Imports `seedActiveRideFromConfirmedHandoff` + `saveDriverHandoffSnapshot`; `resolveState` fresh/role-matching `CONFIRMED`; `goActiveRidePassenger` / `goActiveRideDriver` seed + navigate; driver snapshot fields. |
| `public/src/screens/trip_confirmation_handoff.js` | `RIDE_STATUS`/`findActiveRide`/`saveActiveRide` import; `loadConfirmedHandoff` (state/expiry/role guards); `buildActiveRideSeed` → `RIDE_STATUS.DRIVER_EN_ROUTE`; `seedActiveRideFromConfirmedHandoff` no-overwrite + `saveActiveRide`; `loadCanonicalActiveRide` read order. |
| `public/src/screens/active_ride.js` | Imports `loadCanonicalActiveRide`, `loadDriverHandoffSnapshot`, `applyDriverHandoffSnapshotToRide`, `activeRidePassenger`; passenger branch is a separate renderer; driver branch reads + applies the snapshot. |

### Driver handoff snapshot fields

`goActiveRideDriver` must persist a snapshot containing at least: `tripId`,
`orderId`, `passengerName`, `pickupLabel`, `dropoffLabel`, `agreedPrice`,
`etaText`, `status: 'DRIVER_EN_ROUTE'`.

### Canonical active-ride read order

`loadCanonicalActiveRide` must read in this order (asserted by index):
existing ride (`findActiveRide`) → current-role seed
(`seedActiveRideFromConfirmedHandoff({ tripId, role })`) → cross-role seed
(`seedActiveRideFromConfirmedHandoff({ tripId, role: otherRole })`).

## What this does NOT check

This is a **static text** contract only. It does **not**:

- render any DOM, run a browser, jsdom, or Playwright;
- execute the modules — no real `localStorage`, no timers, no actual TTL
  expiry, no navigation;
- exercise Mapbox, the network, or any backend;
- prove runtime correctness of the handoff round-trip — only that the source
  wiring and key contract are present.

Behavioural coverage lives in the runtime lifecycle smokes
(`scripts/smoke-lifecycle.mjs`, `scripts/smoke-passenger-active-ride.mjs`) and
manual browser checks.

## Protected files

- `public/src/app.js`
- `public/src/screens/chat.js`
- `public/src/screens/trip_confirmation.js`
- `public/src/screens/trip_confirmation_handoff.js`
- `public/src/screens/active_ride.js`

## Manual test URLs

```
/chat?responseId=<passenger_response_id>
/trip-confirmation?tripId=48-321&role=passenger&state=CONFIRMED
/trip-confirmation?tripId=48-321&role=driver&state=DRIVER_CONFIRMED
/active-ride?role=passenger&tripId=48-321&status=DRIVER_EN_ROUTE
/active-ride?role=driver&tripId=48-321&status=DRIVER_EN_ROUTE
```

## Manual smoke script

```
node scripts/smoke-chat-handoff.mjs
```

Expect every line to read `PASS` and a final `ALL PASSED` (exit 0).

## Result

`node scripts/smoke-chat-handoff.mjs` → all assertions `PASS`, `ALL PASSED`.

## Check status

Wired into `scripts/check.mjs` (BD-CHAT-HANDOFF-01 block, before the dispatcher
self-test) using the established `try`/`catch` error-aggregation pattern.
`node scripts/check.mjs` → `All checks passed.`
