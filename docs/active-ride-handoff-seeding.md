# /active-ride seeding from /trip-confirmation handoff (BD-HANDOFF-04)

Closes the content gap identified in
`docs/confirmation-active-ride-handoff-audit.md` §11.2 and the
recommendation in §12.1. After this change, a confirmed local
`/trip-confirmation` handoff seeds `bazardrive.active_ride.v1` keyed by
`tripId` so both passenger and driver `/active-ride` entries render the
same passenger, driver, vehicle, route, fare and ETA that
`/trip-confirmation` just showed — without rewriting either active-ride
screen, without changing the ride state machine and without adding a
backend, real Mapbox, payments, auth or push.

## Surfaces

| File                                                | Role |
|-----------------------------------------------------|------|
| `public/src/screens/trip_confirmation_handoff.js`   | New. Owns the MOCK_* identity snapshot, defensive handoff reader and the active-ride seed builder/persister. |
| `public/src/screens/trip_confirmation.js`           | Imports MOCK_* from the handoff module. Calls `seedActiveRideFromConfirmedHandoff(...)` on the `open-ride-passenger` / `open-ride-driver` CTAs, before navigating to `/active-ride`. |
| `public/src/screens/active_ride.js`                 | On `findActiveRide(tripId)` miss, tries the same seeder for `role: 'driver'` before falling back to the existing `SIM_AUDIT_RIDE_OVERRIDES` demo. Lets a direct deep-link with a fresh confirmed handoff still render seeded data. |
| `public/src/screens/active_ride_passenger.js`       | Same, for `role: 'passenger'` inside `loadPassengerRideView`. |
| `public/sw.js`                                      | Precache list extended with `trip_confirmation_handoff.js`; service worker version bumped to `v35`. |

## Handoff contract (unchanged)

Key: `bazardrive.trip_confirmation.v1`.
Shape: `{ [tripId]: { tripId, responseId, role, state, createdAt, expiresAt } }`.

The record carries metadata only. The visual snapshot
(passenger/driver/vehicle/route/fare) lives in the `MOCK_*` literals
that `trip_confirmation_handoff.js` now owns. The seed builder mirrors
those literals into the `bazardrive.active_ride.v1` shape produced by
`createDemoActiveRide` in `ride_state.js`, so existing renderers consume
the seed with no field coercion.

## Seed timing

1. **Primary path — on the CTA in `/trip-confirmation`.** The
   `goActiveRidePassenger` / `goActiveRideDriver` handlers each call
   `seedActiveRideFromConfirmedHandoff({ tripId, role })` before
   `go('/active-ride?…')`. The role is taken from the local closure;
   `resolveState` has already verified that `handoff.role === role` for
   `state=CONFIRMED`, so the role we pass to the seeder cannot leak the
   opposite side's data.

2. **Fallback path — on `/active-ride` first render.** Both the driver
   entry (`active_ride.js`) and the passenger entry
   (`active_ride_passenger.js → loadPassengerRideView`) call the same
   seeder when `findActiveRide(tripId)` returns `null`. This makes the
   handoff resilient to: a refresh between CTA tap and active-ride
   mount; a direct deep-link constructed by hand that nonetheless
   carries a freshly-written handoff entry; and the
   `bazardrive.active_ride.v1` store being cleared while the handoff
   record is still fresh.

In both cases the seeder is idempotent: it writes a fresh snapshot keyed
by `tripId`, so re-entering `/active-ride` after the first render is a
plain `findActiveRide` hit.

## Defensive behavior

`seedActiveRideFromConfirmedHandoff(...)` returns `null` (and writes
nothing) for every degraded input the audit doc enumerates:

| Input                                            | Behavior |
|--------------------------------------------------|----------|
| Missing `bazardrive.trip_confirmation.v1`        | `null` → demo fallback unchanged |
| Malformed JSON in the storage key                | `null` → demo fallback unchanged |
| `localStorage` not available                     | `null` → demo fallback unchanged |
| Empty / non-string `tripId`                      | `null` → demo fallback unchanged |
| Map exists but has no entry for `tripId`         | `null` → demo fallback unchanged |
| Entry exists but is not a plain object           | `null` → demo fallback unchanged |
| Entry exists but `state !== 'CONFIRMED'`         | `null` → demo fallback unchanged |
| Entry exists but `expiresAt < Date.now()`        | `null` → demo fallback unchanged |
| Entry exists but `handoff.role !== role`         | `null` → demo fallback unchanged |
| Partial entry (no `responseId`, no `createdAt`)  | Seed written; the missing fields become `null` in `seed.handoff` |

`buildActiveRideSeed(...)` itself rejects unknown roles and missing
`tripId`. Storage writes are owned by `saveActiveRide` in `ride_state.js`
which is already fail-soft for quota / private-mode failures.

## What did NOT change

* `ride_state.js` — no schema, no API, no state-machine change.
* `active_ride.js` rendering path — the only edit is the new seeder
  call between `findActiveRide` miss and the SIM_AUDIT demo fallback.
  All status overlays, sheets, and lifecycle handlers are unchanged.
* `active_ride_passenger.js` rendering path — same, only
  `loadPassengerRideView` consults the seeder before the demo fallback.
* `chat.js` — the handoff writer is unchanged; only the active-ride
  reader path is new.
* `trip_confirmation.js` rendering — the screen still displays the same
  MOCK_* snapshot; the only behavioral change is the new seeder call on
  the two `open-ride-*` CTAs.
* No backend, no real Mapbox, no payment / auth / push code added. CSP
  is untouched. No inline `<script>` or `<style>` is introduced.

## Manual test matrix

| # | URL chain                                                                                                                              | Expected |
|---|----------------------------------------------------------------------------------------------------------------------------------------|----------|
| 1 | `/respond?postId=…` → `/chat?responseId=…` → tap **Подтвердить поездку** → `/trip-confirmation?…&state=CONFIRMED&role=passenger` → tap **Открыть поездку** | Passenger `/active-ride` shows the same passenger (Анна М.), driver (Рустам К.), vehicle (Toyota Camry · серый · A 124 ВВ), route (Малая Бронная → Шереметьево, терминал B), fare (1 540 ₽) and ETA (42 мин) that `/trip-confirmation` rendered. |
| 2 | Same as #1 but `role=driver` and tap **Ехать к пассажиру**. | Driver `/active-ride` shows the same data — same passenger card, route and fare. |
| 3 | `/active-ride?role=passenger&tripId=missing-demo&status=DRIVER_EN_ROUTE` (no chat write). | Passenger en-route view renders with the existing `SIM_AUDIT_RIDE_OVERRIDES` demo (Алексей / ТЦ Мега → Шереметьево, terminal B). No crash. |
| 4 | `/active-ride?role=driver&tripId=missing-demo&status=DRIVER_EN_ROUTE` (no chat write). | Driver en-route view renders with the same SIM_AUDIT demo. No crash. |
| 5 | `/trip-confirmation?tripId=missing-demo&role=passenger&state=CONFIRMED` (no chat write). | Falls through to `PASSENGER_PENDING` (existing behavior — gated by `resolveState`). |
| 6 | Set `localStorage['bazardrive.trip_confirmation.v1'] = '{bad json'` then open `/active-ride?role=passenger&tripId=trip-2&status=DRIVER_EN_ROUTE`. | Safe fallback: handoff reader returns `null`, seeder is a no-op, demo renders. No crash. |
| 7 | Confirm at `t=0`, wait past `expiresAt`, then open `/active-ride` for that `tripId` directly. | Seeder rejects the expired record; demo fallback renders. No stale seed is written. |
| 8 | Confirm with `role=passenger`, then open `/active-ride?role=driver&tripId=…&status=DRIVER_EN_ROUTE` directly. | Seeder rejects on role mismatch; demo fallback renders. No passenger-only state leaks into the driver view. |

## Acceptance

* `node scripts/check.mjs` passes (no inline `<script>`/`<style>`, no
  forbidden `style.<prop>` mutation, no `prototypes/` precache entry,
  syntax check clean on every `public/src/**/*.js`).
* Passenger and driver active-ride entries render matching handoff
  snapshots; URL/demo deep-links keep their existing fallback.
