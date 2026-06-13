# BD-FULL-FLOW-01 · Missing Screen Gates

This backlog is extracted from the BD-FULL-FLOW-01 Product Navigation Map.

## Summary

| Priority | Screen ID | Name | Role | Size | Notes |
|---|---|---|---|---|---|
| P0 | BD-HISTORY-P-01 | Passenger Trip History | Passenger | ~5 states | Closes passenger/driver receipt asymmetry |
| P0 | BD-GARAGE-01 | Driver Garage | Driver | ~7 states | Marked as missing in Cloud Web map; verify against current garage PR series before implementing |
| P1 | BD-ERROR-01 | Global Error / Offline | Both | ~4 states | App-level offline/server/timeout overlay |
| P1 | BD-COMPOSER-01 states | Composer V2 state expansion | Both | extension | Per-type variants, preview, draft-saved |
| P1 | BD-RIDE-D error states | Driver active ride error states | Driver | extension | Error/offline stages for driver live flow |
| P2 | BD-AUTH-01 | Phone / SMS Verification | Both | ~4 states | UI-only, no real SMS backend |
| P2 | BD-SETTINGS-01 | Settings | Both | ~6 states | Language, push toggle, account actions |
| P2 | BD-NOTIF-01 | Notifications | Both | ~3 states | List, empty, push-permission prompt |
| P2 | BD-MOD-01 | Moderation / Report | Both | ~3 states | Standalone report surface |

## P0 — BD-HISTORY-P-01 Passenger Trip History

Passenger currently has ride completion and receipt-like surfaces, but the Cloud Web map marks no passenger history gate equivalent to driver history/payouts.

Required states:

- list
- detail
- receipt
- empty
- loading

Reuse:

- route summary atoms
- receipt atoms
- money rows / payment badges
- completed-ride snapshots

Out of scope:

- real backend history API
- payment reconciliation
- PDF receipts

## P0 — BD-GARAGE-01 Driver Garage

The Cloud Web map marks Garage as missing, but the production repository has an active Driver Garage PR line. Treat this as a **consolidation/audit gate** before implementing a new screen.

Required states if still missing after audit:

- list
- add
- edit
- archived
- readiness
- empty
- loading

Reuse:

- driver dashboard atoms
- document/readiness cards
- garage checklist components

Out of scope:

- VIN validation
- real document upload
- backend garage persistence

## P1 — BD-ERROR-01 Global Error / Offline

Required states:

- offline banner
- server error
- timeout
- retry / recovered

Scope:

- app-level overlay
- reusable across passenger, driver and shared screens
- must not replace per-screen empty/loading/error states

## P1 — BD-COMPOSER-01 state expansion

Current state is marked partial in the navigation map.

Required additions:

- per-type variants
- preview
- draft saved
- validation error
- submit loading

Out of scope:

- backend publishing API
- moderation backend
- payments

## P1 — BD-RIDE-D error states

Driver active ride is marked partial because error/offline states are missing.

Required additions:

- offline while on ride
- GPS unavailable
- retry status sync
- support fallback

Out of scope:

- real Mapbox live tracking
- backend ride-events API

## P2 — BD-AUTH-01 Phone / SMS Verification

UI-only gate for onboarding completeness.

Required states:

- phone input
- code input
- verifying
- error/retry

Out of scope:

- real SMS delivery
- backend auth
- account recovery

## P2 — BD-SETTINGS-01 Settings

Required states:

- default settings
- language/theme controls
- push notifications toggle
- account/logout actions
- save feedback
- error

Out of scope:

- real account deletion backend
- native OS notification registration

## P2 — BD-NOTIF-01 Notifications

Required states:

- notification list
- empty state
- push-permission prompt

Out of scope:

- real push delivery
- websocket/realtime updates

## P2 — BD-MOD-01 Moderation / Report

Required states:

- report form
- submitted
- moderation queue placeholder

Reuse:

- reason list from cancel/safety sheets
- support/report atoms

Out of scope:

- admin dashboard
- real moderation backend
