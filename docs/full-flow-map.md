# BD-FULL-FLOW-01 · Product Navigation Map

This document registers **BD-FULL-FLOW-01 Product Navigation Map** as a Cloud Design navigation artifact for BazarDrive.

## Artifact

- HTML reference: `public/prototypes/BD-FULL-FLOW-01 Product Navigation Map.html`
- Type: design/reference artifact
- Scope: product navigation map, screen inventory, handoff table, missing screen gates, implementation order
- Runtime status: **not production app shell**

The HTML artifact is intentionally stored under `public/prototypes/` and must not replace the production PWA shell.

## Safety boundary

This artifact does **not** change:

- `public/index.html`
- service worker behavior
- CSP
- React/Vite migration
- Mapbox
- backend/API
- auth implementation
- payment/push integrations

The React/Vite sandbox created during the Cloud Web export experiment lives outside this PR and is not part of this artifact.

## Lanes

The map is organized into four lanes:

| Lane | Purpose |
|---|---|
| Guest / Entry | Welcome, role selection, permissions, phone/OTP step inside onboarding |
| Passenger | Map, route picker, order creation, driver selection, active ride, cancel/safety, completion, profile |
| Driver | Driver readiness, driver map, confirmation handoff, active ride, cancel/problem/no-show, earnings, history, dashboard |
| Shared | Feed, composer, respond, order detail, chat, rules, settings; notifications/error/moderation gaps |

## Inventory summary

- Designed / ready gates: 31 (added: BD-MAP-02 location permission — previously folded into BD-MAP-01; BD-POST-01 post detail — previously treated only as a Feed card target)
- Missing gates: 4
- Partial gates: 2
- Audit / consolidation gates: 4
- Legacy: 1

> **Codex P2 review follow-up (PR #495):** the previous draft counted BD-HISTORY-P-01, BD-COMPOSER-01 state expansion, BD-GARAGE-01, and BD-AUTH-01 as Missing / Partial backlog items. All four are already shipped in the production app and are now classified as **audit / consolidation gates** — opening them only after a confirmed gap audit, not as a from-scratch build.

> **Codex P2 follow-up — no-show flow:** BD-RIDE-D-NOSHOW-01 is partial, not done. The driver route renders only the terminal NO_SHOW / canceled stub today (`docs/design-registry.json`); the full no-show flow (reason / confirm / compensation / support / loading / error) remains a future dedicated issue per `docs/screen-contracts.md` and is out of scope for this artifact PR. The currently wired exits for the terminal stub are `go('/feed')` (primary) and `go('/profile')` (history) — there is no `/driver-map` exit from this state today.

> **Codex P2 follow-up — onboarding routes / files split:** `/welcome` is owned by `public/src/screens/welcome.js` (welcome / role / permissions / loading / error states) and `/onboarding` is the onboarding step host (`public/src/screens/onboarding.js`) used for steps like `?step=phone`. Empty hash defaults to `#/welcome` in `public/src/router.js`. A literal `#/` is not a registered onboarding route and, once `welcomeSeen` is true, falls through to `/feed`. The first-run welcome flow persists `welcomeSeen` + role and routes directly to `/feed` (passenger) or `/driver-map` (driver) — it does **not** pass through `/onboarding?step=phone`; the OTP step is the profile-side phone-verification re-entry path.

> **Codex P2 follow-up — phone verification:** BD-AUTH-01 is reclassified from Missing → Done · audit. Phone / OTP already ships inside `public/src/screens/onboarding.js` (persists `phoneVerified`) and `public/src/screens/profile.js` verification CTAs route to `/onboarding?step=phone`. This is a profile re-entry path, not part of the first-run welcome transition. Treat any remaining work as audit / reuse of that flow, not a new `/auth` screen.

> **Codex P2 follow-up — driver receipts:** BD-RIDE-HISTORY-D-01 list source is the profile payouts pane deep-link `/profile?role=driver&pane=payouts` (the deep-link the trip receipt's «К выплатам» action uses); `/profile?role=driver` alone opens the overview tab, not the payout rows. **Открыть чек** routes to `/receipt?tripId=...` and the receipt document surface is `public/src/screens/trip_receipt.js`.

> **Codex P2 follow-up — respond required query:** BD-RESPOND-01 runtime reads `getRouteParam('postId')` and renders a missing-state when absent. Handoff route is `/respond?postId=...` (feed and post detail link with that query); a bare `/respond` opens the missing state, not the driver offer sheet.

> **Codex P2 follow-up — order draft success CTA handoff:** BD-MAP-05 submit handler does **not** navigate directly. `handlePublish` creates the order and re-renders the success card with `lastOrder` in place; the navigation to `/responses?orderId=...&state=empty` happens later in `handleAction` when the user taps the success CTA (`responses` / `my-order`). Smoke tests and follow-up implementations must preserve the success state across the handoff — assert «Разместить заявку» → success card with `lastOrder`, then success CTA → `/responses?orderId=...&state=empty`, not a direct submit→`/responses` jump. The responses screen still needs the canonical order id before «Выбрать водителя» can build the passenger active ride.

> **Codex P2 follow-up — driver online CTA:** BD-PROFILE-D-03 «На линию» button (`#pf2-ip-go-online`) only toggles `driverOnline`. The line-ready active-shift CTA routes to `/driver-map`; `/active-ride?role=driver` is opened only after an accepted order / confirmation handoff with a trip id, not directly from the profile.

> **Codex P2 follow-up — passenger completion exits:** BD-RIDE-P-05 wires rating return / report return / bottom action to `/feed`; the live secondary action is `/chat`. There is no `/map` exit from BD-RIDE-P-05 in the shipped UI.

> **Codex P2 follow-up — garage file:** BD-GARAGE-01 shipped UI is rendered from `public/src/screens/profile.js`; the shared helper is `public/src/garage.js`. There is no `public/src/screens/garage.js` and no registered `/garage` route. The audit gate points at the shipped surface, not an invented screen file.

> **Codex P2 follow-up — feed detail route:** BD-FEED-01 card taps route to `/post?id=...` (BD-POST-01, `public/src/screens/post_detail.js`). `/order/<id>` is the separate canonical order surface (BD-ORDER-DETAIL-01) and Feed cards do not link there.

> **Codex P2 follow-up — BD-POST-01 own gate:** `/post?id=...` is a registered screen (`public/src/app.js`) backed by `public/src/screens/post_detail.js` — not just a Feed card target. `post_detail.js` owns the primary-action decision per post `kind` / ownership (respond / chat / own post / accept flows). BD-POST-01 has its own row / card and key paths must show `/feed → /post → downstream` (respond / chat / order). Follow-up tests and implementations must not jump from Feed straight to downstream screens while skipping BD-POST-01.

> **Codex P2 follow-up — order detail transitions:** BD-ORDER-DETAIL-01 primary actions do not navigate directly to `/respond` or `/trip-confirmation`. `driver-send-offer` writes a `DriverOffer` and re-renders in place (toast); passenger select-driver writes overlay / selection and re-renders in place. Only the explicit open-trip / open-active-ride CTA navigates: passenger → `/active-ride?role=passenger&tripId=...`; driver → `/active-ride?role=driver&tripId=...` — the Order Detail driver branch in `order_detail.js` does **not** append `status=ACCEPTED`. The `status=ACCEPTED` URL is emitted by the DriverMap accepted-card «К поездке» CTA only (see DriverMap accept flow follow-up).

> **Codex P2 follow-up — respond chat handoff:** BD-RESPOND-01 submit handler creates `responseId = resp_<post.id>` and opens chat as `/chat?responseId=<responseId>&role=driver`. The `responseId` is required to load the stored response thread; a bare `/chat?role=driver` falls back to the demo thread.

> **Codex P2 follow-up — preserve confirmation:** BD-CHAT-02 message send stays in the chat thread (no navigation); the ride-context confirmation CTA writes the trip-confirmation handoff and navigates to `/trip-confirmation?...`. BD-CONFIRM-01 `passenger-confirm` first re-renders the confirmed state in place; a separate open-ride CTA seeds the active ride and navigates to `/active-ride?role=*&tripId=...`. Confirmation states are not skipped, and Chat does not transition directly to `/active-ride`.

> **Codex P2 follow-up — DriverMap accept flow:** BD-DRIVER-02 does not have a «Выйти на линию» action. The primary action accepts a nearby order and renders an accepted card (`STATE.ACCEPTED`); only the accepted card's «К поездке» CTA navigates to `/active-ride?role=driver&tripId=...&status=ACCEPTED`. Bare `/active-ride?role=driver` lacks the trip id and can fall into fallback / demo behavior.

> **Codex P2 follow-up — responses handoff:** BD-FLOW-INBOX-01 select-driver calls `buildPassengerActiveRide()` and `activeRideUrl()`, navigating to `/active-ride?role=passenger&tripId=<tripId>&status=DRIVER_EN_ROUTE`. Bare `/active-ride?role=passenger` drops the seeded trip id and status.

> **Codex P2 follow-up — BD-FLOW-INBOX-01 deep-link source = success CTA, not submit:** the `/responses?orderId=...&state=empty` deep-link is emitted by the **BD-MAP-05 success CTA**, not by submit. `handlePublish` only creates the order and re-renders the success card with `lastOrder`; the navigation is in `handleAction` when the user taps the success CTA (`responses` / `my-order`) per `public/src/screens/order_map_draft.js:950-963`. All handoff / key-path / smoke wording must say "from BD-MAP-05 success CTA" instead of "from BD-MAP-05 submit" — copying "from submit" can skip the required success-card state with `lastOrder`.

> **Codex P2 follow-up — passenger history audit wording:** BD-HISTORY-P-01 has no passenger receipt screen route. Passenger completion-screen receipt viewing is UI-only. Shipped history detail actions are «Повторить маршрут», «В ленту», and «Назад к истории» — not «Открыть чек». Audit scope is inline history detail parity + an optional future passenger receipt route.

> **Codex P2 follow-up — passenger Key path:** `/responses` does not route through `/trip-confirmation`. `public/src/screens/responses.js` (`buildPassengerActiveRide()` + `activeRideUrl()`) navigates directly to `/active-ride?role=passenger&tripId=<tripId>&status=DRIVER_EN_ROUTE`. The Key paths section now reflects the direct transition.

> **Codex P2 follow-up — BD-PROFILE-PASSENGER-01 CTAs:** the shipped profile does not route passenger profile CTAs to `/map`. `#pfp-quick-where` calls `go('/feed')` and the empty-history create CTA uses `createIntentRoute(...)` opening `/new?type=passenger_request`. Handoff updated accordingly.

> **Codex P2 follow-up — BD-NOTIF-01 audit `/inbox` first + actual driver entry id:** the production app already ships a registered `/inbox` surface (`public/src/app.js`, `public/src/screens/inbox.js`, BD-INBOX-01 in `docs/screen-contracts.md`) with list / empty / unread-event states. The shipped driver profile **does not render a notification bell** — the actual driver notification affordance is the quick-action row `#pf2-act-notif` (`public/src/screens/profile.js:1162`), which today only toggles `notificationsEnabled` (`public/src/screens/profile.js:3809-3814`). BD-NOTIF-01 must (1) audit `/inbox` first, (2) consciously decide between **reuse `/inbox` as the notification hub** (point entry points at `/inbox`, extend if push-permission / notification-specific states missing, no `/notifications` registration) or **split `/notifications` after audit** (document why it is consciously separate from `/inbox`), and (3) wire passenger `#pfp-notif-btn` + **driver `#pf2-act-notif`** to whichever target is chosen — `#pf2-act-notif` must be replaced with an open-surface handler instead of remaining a `notificationsEnabled` toggle. Any reference to a "driver bell" must be explicitly marked as future UI.

> **Codex P2 follow-up — BD-HISTORY-P-01 broken menu:** passenger profile menu row «История поездок» (`#pfp-menu-history`, `public/src/screens/profile.js:932-934`) currently routes to `/feed`, even though the history pane already renders inside `/profile`. Audit scope now covers fixing this entry-point gap.

> **Codex P2 follow-up — welcome login path + onboarding completion targets:** `/onboarding` has two shipped entries with **different completion targets** — (a) first-run Start flow routes `/welcome` → role / permissions → directly to `/feed` or `/driver-map` (does not hop through `/onboarding?step=phone`); (b) welcome-login full flow — `welcome.js:310-315` `Войти` action sets `welcomeSeen = true` and calls `go('/onboarding')`, opening the onboarding step host without `?step=phone`; **bare `/onboarding` `finish()` sends passengers → `/feed` and drivers → `/profile`** (not back to `/welcome`); (c) `/onboarding?step=phone` is the profile-side phone-verification re-entry path and returns to profile / back to the caller. Do not describe BD-AUTH-01 as returning to a generic "welcome or profile caller" — that wording sends completed logins back to `/welcome` instead of the app destination.

> **Codex P2 follow-up — BD-RIDE-P-05 chat context:** `openChat()` in `active_ride_passenger.js` navigates to `/chat?tripId=<ride.tripId>&role=passenger`. The completion-screen chat CTA must preserve both query params; bare `/chat` drops trip id + role and falls back to the inbox / demo context.

> **Codex P2 follow-up — driver Key path:** the accepted-driver entry uses `/active-ride?role=driver&tripId=...&status=ACCEPTED` (built by the DriverMap accepted-order card's «К поездке» CTA). Bare `/active-ride?role=driver` may fall into fallback / demo behavior.

> **Codex P2 follow-up — BD-RESPOND-01 marketplace variant:** `/respond?postId=...` is also the shipped marketplace seller-message surface. Post detail returns `kind: 'respond'` for marketplace posts and `respond.js` renders `renderMarketplace(...)` («Написать продавцу»). BD-RESPOND-01 has two variants with **different next-screen contracts**: (a) driver offer response → success → `/chat?responseId=...&role=driver`; (b) marketplace seller-message → success overlay → `#respond-success-back` → `/feed`. **No chat handoff for marketplace today.** Follow-up work must preserve both variants and must not add a marketplace chat handoff unless a separate marketplace-chat issue is opened.

> **Codex P2 follow-up — BD-MOD-01 entry-point wiring + preserve in-ride safety:** the Order Detail surface already renders a `Пожаловаться` button (`data-action="report-order"` in `order_detail.js:664`) with no click branch. BD-MOD-01 missing scope now includes wiring this and other inert **standalone** report CTAs into the `/report` (or modal) entry; otherwise those affordances stay inert after the moderation gate ships. **The existing in-ride safety report flow (BD-RIDE-P-07) must be preserved and must NOT be rerouted to `/report`:** `openPassengerSafetySheet` switches to the in-sheet report view, submit sets `overlay.dataset.report = 'submitted'`, and «Готово» returns to the safety sheet / ride without leaving `/active-ride`. BD-MOD-01 scope is limited to inert standalone report CTAs.

> **Codex P2 follow-up — rules module:** BD-RULES-01 is owned by `public/src/screens/rules.js` (registered for `/rules` in `public/src/app.js`), not `profile.js`.

> **Codex P3 follow-up — BD-RULES-01 static sections:** `public/src/screens/rules.js` renders section cards as **static articles**. Search and document download controls are deliberate no-ops; only the empty-state `[data-go]` button navigates; there is no section-detail route or «open section → back» flow. Handoff must not describe «Открыть раздел» / `back` as the primary action — those flows do not exist today. Section-detail navigation would be a future dedicated issue.

> **Codex P2 follow-up — runtime file names:** all handoff rows use production-style `public/src/screens/*.js` paths. Cloud / RV sandbox `.jsx` filenames are not runtime modules — if a runtime path is uncertain, the row is marked **production path audit needed** instead of inventing a `.jsx` file.

> **Settings (shipped):** `/settings` is registered and linked from both profile gears — passenger `#pfp-settings-btn` → `go('/settings')`, driver `#pf2-gear` → `go('/settings?role=driver')`. UI-only (logout / delete / payment / push are demo-only). Contract: `screen-contracts.md#bd-settings-01`; render-pending (no render-gate artifact yet).

> **Codex P2 follow-up — passenger cancel exits:** BD-RIDE-P-06 cancel-sheet completion actions route to `/new` or `/feed`, and the direct canceled / no-show fallback sends top / back / feed buttons to `/feed`. `/map` is not the canceled destination in the shipped UI.

> **Codex P2 follow-up — BD-MAP-02 location-permission gate + split transitions:** `/location-permission` is a real registered screen (`public/src/app.js`) owned by `public/src/screens/location_permission.js` (allow / manual / back actions, `location_permission.js:163-170`). The three branches have **different destinations**: **allow → `/map?state=default`** (returns to map with permission granted); **manual → `/route-picker`** (skips the map step); **back → `/map`**. Smoke / handoff must split these explicitly — collapsing allow + manual into a single `/route-picker` destination would assert the wrong target for «Разрешить доступ». Handoff coverage must surface BD-MAP-02 as its own row / card and must not fold `/map` directly to `/route-picker`. Key paths show two branches: `/map → my-location → /location-permission → {allow: /map?state=default; manual: /route-picker; back: /map}` and `/map → choose-route / manual route flow → /route-picker`. Follow-up implementations cannot skip BD-MAP-02.

> **Codex P2 follow-up — driver earnings closed state:** the completed-driver close actions (BD-RIDE-D-09 «Закрыть поездку» and BD-RIDE-D-11 `#driver-earnings-close`) do **not** immediately navigate. Primary close enters the loading / closed state and the closed card shows «Вы снова на линии». Navigation to `/driver-map` happens later from the closed-card «К заказам» button or sheet close callbacks. Smoke tests and follow-up implementations must assert the closed state («Вы снова на линии») before navigation — describing «Закрыть» as a direct close → `/driver-map` transition would skip the required state.

## Missing gates

See `docs/missing-screens.md` for the implementation backlog.

Primary missing gates (3):

1. `BD-NOTIF-01` — Notifications
2. `BD-ERROR-01` — Global error / offline
3. `BD-MOD-01` — Moderation / Report

(`BD-SETTINGS-01` is **shipped** — contract + `design-registry.json` `runtimeOnly` render-pending; no longer a missing gate.)

## Audit / consolidation gates

These are NOT missing — the underlying surface ships in production. The audit gate is opened only for parity / dedicated-route / consolidation work, after a confirmed gap audit:

1. `BD-HISTORY-P-01` — passenger trip history already renders in `/profile` and via `saveRideHistoryEntry`; audit scope = dedicated `/history` route, loading, detail parity.
2. `BD-COMPOSER-01` state expansion — composer route `/new` already ships per-type / preview / draft-saved / validation / submit-loading states (`public/src/screens/composer.js`); audit scope = parity check, no rebuild.
3. `BD-GARAGE-01` — driver Garage gate already renders in `/profile?role=driver`; audit scope = consolidation of the active garage PR line (BD-PROFILE-D-05F+, BD-PROFILE-GARAGE-*), not a new screen.
4. `BD-AUTH-01` — phone / OTP already ships in the onboarding flow (`public/src/screens/onboarding.js`, persists `phoneVerified`); audit scope = parity / reuse of the existing flow, not a new `/auth` screen.

## Handoff table

See `docs/screen-transitions.md` for the developer handoff table:

`Screen ID | Route | File | Role | Status | States changed | Primary action | Next screen`

## Recommended implementation order

Genuine missing-screen backlog first; audit gates are opened only on confirmed scope, not by default.

1. `BD-ERROR-01` — global offline/error overlay (P1).
2. `BD-RIDE-D` error/offline states (P1 extension).
3. `BD-NOTIF-01` (P2).
4. `BD-MOD-01` (P2).

(`BD-SETTINGS-01` removed — shipped; remaining work is an optional render gate, render-pending.)

Audit / consolidation gates (open only on confirmed gap, not by default):

- `BD-HISTORY-P-01` — dedicated `/history` route + loading/detail parity, if confirmed.
- `BD-COMPOSER-01` — parity audit of shipped per-type / preview / draft-saved / validation / submit-loading states.
- `BD-GARAGE-01` — consolidation of the existing garage PR line.
- `BD-AUTH-01` — audit / reuse of the existing onboarding phone / OTP flow; no new `/auth` screen unless product confirms a dedicated surface.

## Notes for production implementation

- Treat file names ending in `.jsx` inside the HTML map as Cloud Web / React-Vite sandbox component names unless the production app has explicitly adopted them. The handoff tables in `docs/screen-transitions.md` and the HTML artifact already use production-style `public/src/screens/*.js` paths.
- If a runtime path is uncertain, the row is marked **production path audit needed** instead of inventing a `.jsx` file.
- Do not infer that the map authorizes React/Vite migration.
- Do not use the standalone HTML as the app shell.
- Convert individual gates into small PRs with screen contracts and smoke coverage.
