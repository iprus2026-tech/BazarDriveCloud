# BD-FULL-FLOW-01 · Missing Screen Gates

This backlog is extracted from the BD-FULL-FLOW-01 Product Navigation Map.

> **Codex P2 review follow-up (PR #495):** BD-HISTORY-P-01, BD-COMPOSER-01 state expansion, and BD-GARAGE-01 are NOT new screens to build. They are reframed as audit / consolidation gates below — sending implementation work to a "build from scratch" interpretation would duplicate shipped surfaces.

## Summary

| Priority | Screen ID | Name | Role | Size | Notes |
|---|---|---|---|---|---|
| P1 | BD-ERROR-01 | Global Error / Offline | Both | ~4 states | App-level offline/server/timeout overlay |
| P1 | BD-RIDE-D error states | Driver active ride error states | Driver | extension | Error/offline stages for driver live flow |
| P2 | BD-AUTH-01 | Phone / SMS Verification | Both | ~4 states | UI-only, no real SMS backend |
| P2 | BD-SETTINGS-01 | Settings | Both | ~6 states | Language, push toggle, account actions |
| P2 | BD-NOTIF-01 | Notifications | Both | ~3 states | List, empty, push-permission prompt |
| P2 | BD-MOD-01 | Moderation / Report | Both | ~3 states | Standalone report surface |

**Missing-screen count: 5 net-new gates + 1 extension** (BD-AUTH-01, BD-SETTINGS-01, BD-NOTIF-01, BD-ERROR-01, BD-MOD-01 + BD-RIDE-D error states).

See the **Audit / consolidation gates** section below for items that were previously marked Missing/P0 but are already shipped — they need audit/parity work, not from-scratch builds.

## Audit / consolidation gates (shipped, not missing)

These three gates were originally listed as Missing or Partial in earlier drafts. The current production app already ships the underlying screens, so the remaining work is audit / parity / consolidation — not a new screen.

### BD-HISTORY-P-01 — Passenger Trip History (audit / dedicated route gap)

**Status: Done · audit.** Passenger trip history already exists:

- Passenger profile renders the history section (`public/src/screens/profile.js`).
- Passenger history cards / detail UI live in `passengerHistoryEntryHtml` and `historyDetailHtml`.
- Completed passenger rides persist via `saveRideHistoryEntry` (`public/src/screens/active_ride_passenger.js`).

**Remaining audit scope** (open the audit gate only if these gaps are confirmed):

- A dedicated `/history` route (today the history is reached via `/profile`).
- A loading skeleton for the history list (parity with driver history).
- A receipt-detail parity pass with `BD-RIDE-HISTORY-D-01`.

**Out of scope:** new passenger history backend, PDF receipts, payment reconciliation.

### BD-COMPOSER-01 states — Composer V2 (shipped, audit parity only)

**Status: Done · audit.** Composer per-type variants, preview, draft-saved badge, validation alert, and submit loading are already shipped:

- Contract: `docs/screen-contracts.md` documents the state set.
- Runtime: `public/src/screens/composer.js` implements the preview area / button, draft-saved badge, validation alert, and submit-loading.
- Route: `/new` (registered in `public/src/app.js`).

**Remaining audit scope** (open the audit gate only if these gaps are confirmed):

- Audit parity across the per-type variants for consistency with the shipped states.
- Confirm draft-saved / validation copy matches the Cloud Design library.

**Out of scope:** rebuilding shipped states, backend publishing API, moderation backend, payments.

### BD-GARAGE-01 — Driver Garage (consolidation gate)

**Status: Done · audit.** The driver Garage gate already renders inside `/profile?role=driver`:

- `garageSectionHtml` covers empty/list states with add affordances (`public/src/screens/profile.js`).
- Add / edit / archive / restore / make-active flows are wired in the same module.
- The garage→documents readiness hint lives in the Documents pane (BD-PROFILE-GARAGE-READY-K).

**Remaining audit scope** (open the audit gate only if these gaps are confirmed):

- Consolidation of the active garage PR line (BD-PROFILE-D-05F+, BD-PROFILE-GARAGE-ARCHIVE-*, BD-PROFILE-GARAGE-READY-K).
- A dedicated `/garage` route (today the garage is reached via `/profile?role=driver`), only if product confirms the dedicated route is desired.

**Out of scope:** VIN validation, real document upload, backend garage persistence, a new from-scratch `/garage` screen without an audit.

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
