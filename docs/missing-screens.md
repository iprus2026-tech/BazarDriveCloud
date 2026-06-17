# BD-FULL-FLOW-01 · Missing Screen Gates

This backlog is extracted from the BD-FULL-FLOW-01 Product Navigation Map.

> **Codex P2 review follow-up (PR #495):** BD-HISTORY-P-01, BD-COMPOSER-01 state expansion, BD-GARAGE-01, and now BD-AUTH-01 are NOT new screens to build. They are reframed as audit / consolidation gates below — sending implementation work to a "build from scratch" interpretation would duplicate shipped surfaces. The phone / OTP flow ships inside onboarding today (`public/src/screens/onboarding.js`).

## Summary

| Priority | Screen ID | Name | Role | Size | Notes |
|---|---|---|---|---|---|
| P1 | BD-ERROR-01 | Global Error / Offline | Both | ~4 states | App-level offline/server/timeout overlay |
| P1 | BD-RIDE-D error states | Driver active ride error states | Driver | extension | Error/offline stages for driver live flow |
| ~~P2~~ | BD-SETTINGS-01 | Settings | Both | 6 states | ✅ **DONE (shipped)** — `/settings` registered, `settings.js` implemented, both gears wired, precached, `scripts/smoke-settings.mjs`. Contract: `screen-contracts.md#bd-settings-01` |
| P2 | BD-NOTIF-01 | Notifications | Both | ~3 states | **Audit `/inbox` (BD-INBOX-01, shipped) first** · decide reuse `/inbox` as hub OR consciously split `/notifications` after audit · wire shipped entry points to the chosen target: passenger `#pfp-notif-btn` (no listener today) + **driver `#pf2-act-notif`** quick-action row (currently only toggles `notificationsEnabled` — there is NO driver bell in the shipped profile) · do not orphan `/inbox` |
| P2 | BD-MOD-01 | Moderation / Report | Both | ~3 states | Standalone report surface · wire inert standalone report CTAs (Order Detail `data-action="report-order"`) · do NOT reroute the in-ride safety report (BD-RIDE-P-07) — preserve in-sheet behavior |

**Missing-screen count: 3 net-new gates + 1 extension** (BD-NOTIF-01, BD-ERROR-01, BD-MOD-01 + BD-RIDE-D error states). BD-SETTINGS-01 is no longer counted — it is **shipped** (contract present; `design-registry.json` → `runtimeOnly`, render-pending; see below). BD-AUTH-01 is not counted — reclassified as an audit gate over the existing onboarding phone / OTP flow (see below).

See the **Partial / future issues** section below for partial flows that already render a terminal stub but need future dedicated wiring. See the **Audit / consolidation gates** section for items that were previously marked Missing/P0 but are already shipped — they need audit/parity work, not from-scratch builds. See the **Render-pending** section for shipped screens that lack a Cloud Design render gate.

## Render-pending (shipped runtime, no Cloud Design render gate)

These screens **ship in runtime and have a `docs/screen-contracts.md` contract**, but are not in the Cloud Design render-gate set (`docs/design-registry.json` → `runtimeOnly[]`, classification `contract-only`, `renderStatus: "render-pending"`). They are **not missing screens** — the gap is a render gate, not code. Recorded here so the design catalog and runtime stay reconciled (BD-DESIGN-REGISTRY-01). Next step per screen: render the frame in Cloud Design, then promote the entry from `runtimeOnly[]` into `screens[]` with a real `renderGate`.

| Priority | Screen ID | Route | File | Gap |
|---|---|---|---|---|
| P1 | BD-ORDER-DETAIL-01 | `/order` (`/order/<id>`) | `public/src/screens/order_detail.js` | Runtime shell + full contract + 01D writes landed; no render gate |
| P1 | BD-POST-01 | `/post` | `public/src/screens/post_detail.js` | Shipped detail gate; no render gate |
| P1 | BD-INBOX-01 | `/inbox` | `public/src/screens/inbox.js` | Shipped hub; no render gate |
| P2 | BD-MAP-02 | `/location-permission` | `public/src/screens/location_permission.js` | Shipped mock-permission gate; no render gate |
| P2 | BD-ONBOARDING-01 | `/welcome` + `/onboarding` | `welcome.js` + `onboarding.js` | Shipped family; no render gate |
| P2 | BD-COMPOSER-01 | `/new` | `public/src/screens/composer.js` | Shipped composer; no render gate |
| P2 | BD-RULES-01 | `/rules` | `public/src/screens/rules.js` | Shipped static articles; no render gate |
| P2 | BD-SETTINGS-01 | `/settings` | `public/src/screens/settings.js` | Shipped shared shell + contract; no render-gate artifact |

`BD-RIDE-D-NOSHOW-01` is the inverse case (render gate has 7 states, runtime wires 5/7) — classified `future-design` and tracked under **Partial / future issues** below.

## Partial / future issues

These flows already render a stub or terminal state in the runtime, but the full state set is a future dedicated issue. They are NOT missing screens and NOT audit gates — they need real wiring work, but that work is scheduled separately and is out of scope for this artifact PR.

### BD-RIDE-D-NOSHOW-01 — Driver No-Show Flow (partial / future issue)

**Status: Partial — 5 of the render gate's 7 states are wired.** The Cloud Design
no-show gate has 7 states: `waiting → expired → action → confirm → result →
compensation → done`. The runtime ships the **5 in-sheet sub-flow states**
(`action → confirm → result → compensation → done`) in
`public/src/screens/active_ride_driver_noshow.js`, opened from the
`WAITING_PASSENGER` «Не приехал» (`#ar-no-show`) action via `openDriverNoShowFlow`.

**Split ownership** (recorded in `docs/design-registry.json`):

- `public/src/screens/active_ride.js` owns the **waiting/expired entry states** +
  the `#ar-no-show` wiring (pinned by `scripts/smoke-active-ride-noshow.mjs` and
  `scripts/smoke-active-ride-waiting.mjs`).
- `public/src/screens/active_ride_driver_noshow.js` owns the **5 in-sheet states**.

**Parity gap (the remaining 2/7):**

- `waiting` and `expired` are **gate-only** — the dedicated full-screen waiting /
  expired no-show stages from the render gate are not yet wired as their own
  states (the runtime enters the no-show sub-flow from the existing
  `WAITING_PASSENGER` sheet instead).
- **Compensation values `180 / 120 / 276 ₽` are mock placeholders** and must be
  confirmed with **product / finance sign-off** before any further wiring — do not
  treat them as real figures.

**Future wiring scope** (own dedicated issue, NOT this artifact PR):

- dedicated `waiting` / `expired` no-show stages (the 2 gate-only states)
- real compensation / earnings-adjustment figures (after product/finance sign-off)
- support fallback / dispute path
- loading and error states for the flow (see `BD-RIDE-D-ERROR-02` for the
  async/backed cancel/no-show failure semantics)

**Out of scope for this artifact PR:** runtime wiring of the remaining no-show
states, `active_ride` lifecycle changes, compensation backend, dispatcher.

## Audit / consolidation gates (shipped, not missing)

These three gates were originally listed as Missing or Partial in earlier drafts. The current production app already ships the underlying screens, so the remaining work is audit / parity / consolidation — not a new screen.

### BD-HISTORY-P-01 — Passenger Trip History (audit / dedicated route gap)

**Status: Done · audit.** Passenger trip history already exists:

- Passenger profile renders the history section (`public/src/screens/profile.js`).
- Passenger history cards / detail UI live in `passengerHistoryEntryHtml` and `historyDetailHtml`.
- Completed passenger rides persist via `saveRideHistoryEntry` (`public/src/screens/active_ride_passenger.js`).
- Shipped history detail actions are **Повторить маршрут**, **В ленту**, **Назад к истории**. There is **no** «Открыть чек» action on the passenger history detail and **no passenger receipt screen route** — passenger completion-screen receipt viewing is UI-only.

**Remaining audit scope** (open the audit gate only if these gaps are confirmed):

- ~~**Fix the broken history menu entry**~~ — **DONE (BD-HISTORY-P-01).** The passenger profile menu row «История поездок» (`#pfp-menu-history`) now scrolls the inline trip-history section (`#profile-history-section`, rendered by `historySectionHtml`) into view instead of routing to `/feed` — mirroring the driver payouts «История» row. Guarded by `scripts/smoke-profile-history-menu.mjs`.
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

> **Design-only render gate exists (PR #505).** A static vanilla render-gate artifact ships at `public/prototypes/BD-ERROR-01-global-error-offline-render-gate.html`, covering all five states below as visual reference. The artifact is deliberately **not** added to `docs/design-registry.json` renderGates — that registry enforces section coverage by shipped screens, so an uncovered design-only gate would fail the dispatcher drift selftest; register it there only once a runtime screen exists. The artifact is a design reference only — never copied into `public/index.html` or the SW precache.
>
> **BD-ERROR-01A runtime foundation — shipped (partial).** The first runtime slice ships an app-shell singleton overlay at `public/src/app_error_overlay.js`, wired in `public/src/app.js`, styled by the `.bd-error-*` namespace in `public/styles/cloud.css`, precached by `public/sw.js`, and guarded by `scripts/smoke-global-error-overlay.mjs`. It is driven imperatively via `window.BD.GlobalError.show(state, options?)` / `.hide()` and supports all five states (offline, server_error, timeout, retrying, recovered). It is **not** a route — there is intentionally no `/error` registration. The overlay is non-mutating (no ride/order/storage/backend/Mapbox writes, demo `onRetry` callback only). **BD-ERROR-01 stays open** for the remaining slices: per-flow fetch-failure trigger sites and BD-RIDE-D driver error states are out of scope for 01A.
>
> **BD-ERROR-01B connection trigger wiring — shipped (partial).** `public/src/app_connection_status.js` (wired in `public/src/app.js` after `initGlobalErrorOverlay()`, precached by `public/sw.js`, guarded by `scripts/smoke-app-connection-status.mjs`) wires **only** the browser `online` / `offline` events to the existing app-shell overlay: offline → `show('offline')`, online → `show('retrying')` then a short delay → `show('recovered')` (overlay auto-dismisses). Init is idempotent (no duplicate listeners) and reflects an initial offline state. It does **not** handle fetch failures, backend retries, ride errors, Mapbox errors, GPS errors, or order/ride mutations — those remain open follow-ups.

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
Contract: **BD-RIDE-D-ERROR-01** in [`screen-contracts.md`](screen-contracts.md#bd-ride-d-error-01---driver-active-ride-error-states) — **docs/contract only; no runtime is shipped under it.**

The four states, by disposition:

- **offline while on ride** — already covered by the global app-shell offline overlay (BD-ERROR-01B). No in-screen UI added.
- **GPS unavailable** — out of scope until a Mapbox/geolocation slice (no real geolocation wired).
- **retry status sync** — **deferred / backend-needed → BD-RIDE-D-ERROR-02.** A first synchronous guard (01B) was **closed unmerged as premature**: retrofitting backend-failure handling onto the sync, side-effect-laden lifecycle requires async mutations, rollback on partial writes, a stale-route retry guard, and side-effect reordering — i.e. a real ride-events backend, which is out of scope. Sync localStorage gives no real reject path today.
- **support fallback** — contract-only / **render-pending** (Cloud Design render-needed; not implemented).

A dedicated **in-screen** driver error UI (cards/states beyond reusing the global overlay) is **Cloud Design render-needed / not implemented** — do not invent bespoke in-screen error UI without a render frame.

**BD-RIDE-D-ERROR-02** (planned / backend-needed) is the home for the deferred `retry status sync` once an async/backed status-mutation contract exists: async mutations, rollback / transactional status updates, a stale-route retry guard, side-effect ordering, and cancel/no-show sheet failure semantics (`screen-contracts.md`).

Out of scope:

- real Mapbox live tracking
- backend ride-events API
- real GPS / geolocation
- new in-screen error UI without a Cloud Design frame
- the synchronous status-sync guard (closed unmerged — premature without a backend)

## ~~P2 — BD-SETTINGS-01 Settings~~ — DONE (shipped)

**DONE (BD-SETTINGS-01).** Settings shipped and wired (issue #539 closed). The
`/settings` route is registered in `public/src/app.js`, `public/src/screens/settings.js`
implements the shared role-aware shell, the passenger gear `#pfp-settings-btn` →
`go('/settings')` and the driver gear `#pf2-gear` → `go('/settings?role=driver')`
(driver security pane still reachable via
its `pf2-tab[data-pane="security"]` tab), the file is precached in `public/sw.js`, and
`scripts/smoke-settings.mjs` pins route + entry wiring + UI-only boundaries. The full
contract lives at `screen-contracts.md#bd-settings-01` and the screen is registered in
`design-registry.json` (`runtimeOnly`, contract-only / render-pending — no render-gate
artifact yet).

Shipped states: default · language/theme · push toggle (+ revealed sound row) ·
account actions (logout/delete confirm) · save feedback («Сохранено» toast) ·
error notice (`?state=error`). All controls are **UI-only** (no persistence, no
fetch, no native push, no backend logout/delete/payment).

Remaining (optional, future): a real Cloud Design render-gate artifact for Settings
(today it is contract-only / render-pending).

## P2 — BD-NOTIF-01 Notifications

> **Audit `/inbox` before going net-new.** The production app already ships a registered `/inbox` surface (`public/src/app.js` registers `/inbox`, `public/src/screens/inbox.js` renders list / empty / unread-event states, `docs/screen-contracts.md` lists **BD-INBOX-01** as implemented). Following the previous draft literally would duplicate the existing inbox / notification hub and leave `/inbox` orphaned. BD-NOTIF-01 must not blindly add a separate `/notifications` route without first deciding how it relates to `/inbox`.

> **Entry-point status (both entry points DONE).** The relationship decision is settled in favour of **(a) reuse `/inbox` as the hub**, and BOTH shipped profile entry points are now wired to `go('/inbox')` (`public/src/screens/profile.js`, pinned by `scripts/smoke-profile-notif-bell.mjs`): the passenger bell `#pfp-notif-btn` and the driver quick-action row `#pf2-act-notif` (its prior `notificationsEnabled` toggle stub was replaced by navigation — the row already renders a chevron). The remaining BD-NOTIF-01 scope — any push-permission / notification-specific states inside `inbox.js`, and the push-permission prompt — is unchanged and still open.

Notifications is **not** wired from the existing entry points in the shipped UI. The missing scope includes both the decision-on-relationship-with-`/inbox`, the screen (or reuse), and the profile-entry wiring (mirrors BD-SETTINGS-01).

Required scope:

- **audit the shipped `/inbox` surface first** (`public/src/screens/inbox.js`, BD-INBOX-01 in `docs/screen-contracts.md`) — its list / empty / unread-event states already cover most of what BD-NOTIF-01 would render
- decide the relationship between BD-NOTIF-01 and `/inbox`; the two viable outcomes are explicit and must be picked before any new code lands:
  - **(a) reuse `/inbox` as the notification hub** — point the bell CTAs at `/inbox`, extend `inbox.js` if push-permission / notification-specific states are missing, and treat `/notifications` as redundant (do **not** register it)
  - **(b) split a separate `/notifications` route after the audit** — register `/notifications`, implement the screen, and document why it is consciously separate from `/inbox` (e.g. push permission flow, system-message channel) so `/inbox` is not orphaned
- ~~wire the passenger profile bell CTA (`#pfp-notif-btn`) — currently rendered without a listener — to whichever target (a) or (b) chooses~~ **DONE** — wired to `go('/inbox')` (decision (a)); pinned by `scripts/smoke-profile-notif-bell.mjs`
- ~~wire the **actual driver notification entry point — the quick-action row `#pf2-act-notif`** — to the same target. There is no driver bell in the shipped profile. Today `#pf2-act-notif` only toggles `notificationsEnabled`; BD-NOTIF-01 must replace that toggle with an open-`/inbox` handler, not leave it as a toggle~~ **DONE** — the toggle stub was replaced with `go('/inbox')` (decision (a)); pinned by `scripts/smoke-profile-notif-bell.mjs`. (There is still no driver *bell*; any future driver bell UI must be explicitly marked as future and design-gated.)

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
