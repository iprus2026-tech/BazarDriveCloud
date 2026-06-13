# BD-FULL-FLOW-01 · Missing Screen Gates

This backlog is extracted from the BD-FULL-FLOW-01 Product Navigation Map.

> **Codex P2 review follow-up (PR #495):** BD-HISTORY-P-01, BD-COMPOSER-01 state expansion, BD-GARAGE-01, and now BD-AUTH-01 are NOT new screens to build. They are reframed as audit / consolidation gates below — sending implementation work to a "build from scratch" interpretation would duplicate shipped surfaces. The phone / OTP flow ships inside onboarding today (`public/src/screens/onboarding.js`).

## Summary

| Priority | Screen ID | Name | Role | Size | Notes |
|---|---|---|---|---|---|
| P1 | BD-ERROR-01 | Global Error / Offline | Both | ~4 states | App-level offline/server/timeout overlay |
| P1 | BD-RIDE-D error states | Driver active ride error states | Driver | extension | Error/offline stages for driver live flow |
| P2 | BD-SETTINGS-01 | Settings | Both | ~6 states | Register `/settings`, implement screen, wire passenger `#pfp-settings-btn` + driver gear CTA |
| P2 | BD-NOTIF-01 | Notifications | Both | ~3 states | **Audit `/inbox` (BD-INBOX-01, shipped) first** · decide reuse `/inbox` as hub OR consciously split `/notifications` after audit · wire shipped entry points to the chosen target: passenger `#pfp-notif-btn` (no listener today) + **driver `#pf2-act-notif`** quick-action row (currently only toggles `notificationsEnabled` — there is NO driver bell in the shipped profile) · do not orphan `/inbox` |
| P2 | BD-MOD-01 | Moderation / Report | Both | ~3 states | Standalone report surface · wire inert standalone report CTAs (Order Detail `data-action="report-order"`) · do NOT reroute the in-ride safety report (BD-RIDE-P-07) — preserve in-sheet behavior |

**Missing-screen count: 4 net-new gates + 1 extension** (BD-SETTINGS-01, BD-NOTIF-01, BD-ERROR-01, BD-MOD-01 + BD-RIDE-D error states). BD-AUTH-01 is no longer counted — it is reclassified as an audit gate over the existing onboarding phone / OTP flow (see below).

See the **Partial / future issues** section below for partial flows that already render a terminal stub but need future dedicated wiring. See the **Audit / consolidation gates** section for items that were previously marked Missing/P0 but are already shipped — they need audit/parity work, not from-scratch builds.

## Partial / future issues

These flows already render a stub or terminal state in the runtime, but the full state set is a future dedicated issue. They are NOT missing screens and NOT audit gates — they need real wiring work, but that work is scheduled separately and is out of scope for this artifact PR.

### BD-RIDE-D-NOSHOW-01 — Driver No-Show Flow (partial / future issue)

**Status: Partial.** Only the terminal `NO_SHOW` / canceled stub renders on the driver route today (per `docs/design-registry.json`). The full no-show flow is recorded as a future dedicated issue in `docs/screen-contracts.md`.

**Future wiring scope** (own dedicated issue, NOT this artifact PR):

- no-show reason picker
- driver confirm step
- compensation / earnings adjustment surface
- support fallback / dispute path
- loading and error states for the flow

**Out of scope for this artifact PR:** runtime wiring of the full no-show flow, `active_ride` lifecycle changes, compensation backend, dispatcher.

## Audit / consolidation gates (shipped, not missing)

These three gates were originally listed as Missing or Partial in earlier drafts. The current production app already ships the underlying screens, so the remaining work is audit / parity / consolidation — not a new screen.

### BD-HISTORY-P-01 — Passenger Trip History (audit / dedicated route gap)

**Status: Done · audit.** Passenger trip history already exists:

- Passenger profile renders the history section (`public/src/screens/profile.js`).
- Passenger history cards / detail UI live in `passengerHistoryEntryHtml` and `historyDetailHtml`.
- Completed passenger rides persist via `saveRideHistoryEntry` (`public/src/screens/active_ride_passenger.js`).
- Shipped history detail actions are **Повторить маршрут**, **В ленту**, **Назад к истории**. There is **no** «Открыть чек» action on the passenger history detail and **no passenger receipt screen route** — passenger completion-screen receipt viewing is UI-only.

**Remaining audit scope** (open the audit gate only if these gaps are confirmed):

- **Fix the broken history menu entry** — the passenger profile menu row «История поездок» (`#pfp-menu-history` in `public/src/screens/profile.js:932-934`) currently routes to `/feed` instead of opening the history pane that already renders in `/profile`. This is a shipped entry-point gap, not a new screen.
- A dedicated `/history` route (today the history is reached via `/profile`).
- A loading skeleton for the history list (parity with driver history).
- Inline history detail parity (copy / states alignment with `historyDetailHtml`).
- **Optional** future dedicated passenger receipt route, only if product confirms a passenger receipt surface — there is no shipped receipt opening to wire today.

**Out of scope:** new passenger history backend, PDF receipts, payment reconciliation, wiring a non-existent passenger receipt path.

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

### BD-AUTH-01 — Phone / OTP verification (existing onboarding flow audit)

**Status: Done · audit.** Phone / OTP is not a net-new missing screen; it already ships inside the onboarding flow. `/onboarding` has two shipped entries today with **different completion targets** — do not collapse them into a generic "back to welcome or profile caller" hop:

- **First-run welcome path:** `/welcome` → role / permissions → directly to `/feed` (passenger) or `/driver-map` (driver). This path does **not** route through `/onboarding?step=phone`.
- **Welcome-login full flow (bare `/onboarding`):** `welcome.js` `Войти` action (≈ lines 310-315) sets `welcomeSeen = true` and calls `go('/onboarding')`, opening the onboarding step host without `?step=phone`. On `finish()`, this **full flow** routes the **passenger → `/feed`** and the **driver → `/profile`**. It does **not** return to `/welcome` — describing it as "back to welcome or profile caller" would send a completed login back to the welcome screen.
- **Profile-side phone re-entry (`/onboarding?step=phone`):** `profile.js` verification CTAs open the verify-only step. This re-entry path returns to profile / back to the caller after the step completes. It is the only branch where "back to caller" applies.
- Phone / OTP mock lives in `public/src/screens/onboarding.js` and persists `phoneVerified`.
- BD-ONBOARDING-01 states in `docs/screen-contracts.md` already cover the phone + OTP step.
- The production app has no registered `/auth` route in `public/src/app.js`.

**Remaining audit scope** (open the audit gate only if these gaps are confirmed):

- Audit / reuse of the existing phone/OTP flow (copy parity, error states, resend cadence, lockout) — NOT a new `/auth` screen.
- If product confirms a dedicated `/auth` surface is needed later, open a separate issue; otherwise keep the flow inside onboarding.

**Out of scope:** real SMS backend, account recovery, a new `/auth` screen that forks the existing phone-verify path.

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

## P2 — BD-SETTINGS-01 Settings

Settings is **not** already linked from the profile headers in the shipped UI. The missing scope includes both the screen and its profile-entry wiring.

Required scope:

- register the `/settings` route in `public/src/app.js`
- implement the settings screen
- wire the passenger profile settings CTA (`#pfp-settings-btn`) — currently rendered without a listener
- wire the driver profile settings / gear CTA — currently switches to the security pane instead of navigating to settings

Required states:

- default settings
- language/theme controls
- push notifications toggle
- account/logout actions (UI-only unless a future backend issue says otherwise)
- save feedback
- error

Out of scope:

- real account deletion backend
- native OS notification registration
- backend wiring for logout / delete / account actions (UI-only unless a future backend issue says otherwise)

## P2 — BD-NOTIF-01 Notifications

> **Audit `/inbox` before going net-new.** The production app already ships a registered `/inbox` surface (`public/src/app.js` registers `/inbox`, `public/src/screens/inbox.js` renders list / empty / unread-event states, `docs/screen-contracts.md` lists **BD-INBOX-01** as implemented). Following the previous draft literally would duplicate the existing inbox / notification hub and leave `/inbox` orphaned. BD-NOTIF-01 must not blindly add a separate `/notifications` route without first deciding how it relates to `/inbox`.

Notifications is **not** wired from the existing entry points in the shipped UI. The missing scope includes both the decision-on-relationship-with-`/inbox`, the screen (or reuse), and the profile-entry wiring (mirrors BD-SETTINGS-01).

Required scope:

- **audit the shipped `/inbox` surface first** (`public/src/screens/inbox.js`, BD-INBOX-01 in `docs/screen-contracts.md`) — its list / empty / unread-event states already cover most of what BD-NOTIF-01 would render
- decide the relationship between BD-NOTIF-01 and `/inbox`; the two viable outcomes are explicit and must be picked before any new code lands:
  - **(a) reuse `/inbox` as the notification hub** — point the bell CTAs at `/inbox`, extend `inbox.js` if push-permission / notification-specific states are missing, and treat `/notifications` as redundant (do **not** register it)
  - **(b) split a separate `/notifications` route after the audit** — register `/notifications`, implement the screen, and document why it is consciously separate from `/inbox` (e.g. push permission flow, system-message channel) so `/inbox` is not orphaned
- wire the passenger profile bell CTA (`#pfp-notif-btn`) — currently rendered without a listener (`public/src/screens/profile.js:620-621`) — to whichever target (a) or (b) chooses
- wire the **actual driver notification entry point — the quick-action row `#pf2-act-notif`** (`public/src/screens/profile.js:1162`) — to the same target. **There is no driver bell in the shipped profile.** Today `#pf2-act-notif` only toggles `notificationsEnabled` (`public/src/screens/profile.js:3809-3814`); BD-NOTIF-01 must replace that toggle with an open-`/inbox` or open-`/notifications` handler, not leave it as a toggle. Any reference to a "driver bell" must be explicitly marked as future UI

Required states (regardless of (a) vs (b)):

- notification list
- empty state
- push-permission prompt

Out of scope:

- real push delivery
- websocket/realtime updates
- native OS push registration
- leaving the registered `/inbox` screen orphaned by silently registering `/notifications` alongside it without an audit decision

## P2 — BD-MOD-01 Moderation / Report

This gate is the standalone moderation / report surface. Its scope is the new `/report` (or modal) entry **plus** wiring for shipped inert standalone report CTAs (notably the Order Detail `Пожаловаться` button — `data-action="report-order"` in `public/src/screens/order_detail.js:664` has no click branch). It does **not** absorb the existing in-ride safety report flow.

Required scope:

- register the `/report` route (or report modal) in `public/src/app.js`
- implement the moderation / report screen
- wire the Order Detail report CTA (`data-action="report-order"`) — currently rendered without a listener
- wire any other shipped **standalone** report CTAs that are inert today (similar to the Order Detail report-order button) into the same gate

**Preserve the existing in-ride safety report flow (BD-RIDE-P-07) — do NOT reroute it to `/report`:**

- `openPassengerSafetySheet` switches to the in-sheet report view
- submit sets `overlay.dataset.report = 'submitted'`
- «Готово» returns to the safety sheet / ride **without leaving `/active-ride`**

Rewiring that link into `/report` would break the shipped in-ride safety flow. This backlog item is limited to inert standalone report CTAs; the in-ride safety report behavior stays as shipped.

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
- rerouting the in-ride safety report flow (BD-RIDE-P-07) — that flow is preserved as shipped, in-sheet, on `/active-ride`
