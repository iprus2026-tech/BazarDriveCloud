# BD-FULL-FLOW-01 · Screen Transitions

Developer handoff table extracted from the BD-FULL-FLOW-01 navigation map.

| Screen ID | Route | File | Role | Status | States changed | Primary action | Next screen |
|---|---|---|---|---|---|---|---|
| BD-ONBOARDING-01 (welcome) | `/welcome` (empty hash defaults to `/welcome`) | `public/src/screens/welcome.js` | both | Done | 5 (welcome → role → permissions → loading → error) | Выбрать роль | `/feed` (passenger) or `/driver-map` (driver) |
| BD-ONBOARDING-01 (onboarding step host) | `/onboarding` (`?step=phone` for the OTP step) | `public/src/screens/onboarding.js` | both | Done | onboarding step host (phone / OTP re-entry from profile) | continue current step | next onboarding step / back to caller |
| BD-AUTH-01 | `/onboarding?step=phone` | `public/src/screens/onboarding.js` | both | Done · audit | phone / OTP mock already shipped; persists `phoneVerified`; profile re-entry only — not part of the first-run welcome path | Войти по телефону | back to the profile re-entry caller |
| BD-FEED-01 | `/feed` | `public/src/screens/feed.js` | both | Done | 5 filters | Создать публикацию | `/new`, `/order/<id>` |
| BD-COMPOSER-01 | `/new` | `public/src/screens/composer.js` | both | Done · audit | per-type / preview / draft-saved / validation / submit-loading already shipped | Опубликовать | `/feed` |
| BD-ORDER-DETAIL-01 | `/order/<id>` | `public/src/screens/order_detail.js` | both | Done | 9 role-split states | Откликнуться / Принять | `/respond`, `/trip-confirmation` |
| BD-RESPOND-01 | `/respond?postId=...` (required; missing-state otherwise) | `public/src/screens/respond.js` | driver | Done | 1 driver-offer sheet | Отправить предложение/отклик | `/chat?role=driver` (passenger-side board remains `/responses`) |
| BD-FLOW-INBOX-01 | `/responses` | `public/src/screens/responses.js` | passenger | Done | 4 | Выбрать водителя | `/active-ride?role=passenger` |
| BD-MAP-01 | `/map` | `public/src/screens/map.js` | both | Done | 9 | Выбрать маршрут | `/route-picker` |
| BD-MAP-03 | `/route-picker` | `public/src/screens/route_picker.js` | passenger | Done | 8 + live search | Подтвердить маршрут | `/route-preview` |
| BD-MAP-04 | `/route-preview` | `public/src/screens/route_preview.js` | passenger | Done | 5 | Создать заявку | `/order-map-draft` |
| BD-MAP-05 | `/order-map-draft` | `public/src/screens/order_map_draft.js` | passenger | Done | 6 | Разместить заявку | `/responses?orderId=...&state=empty` (submit handler seeds the new order id) |
| BD-CONFIRM-01 | `/trip-confirmation` | `public/src/screens/trip_confirmation.js` | both | Done | 5 | Подтвердить поездку | `/active-ride?role=*` |
| BD-CHAT-02 | `/chat` | `public/src/screens/chat.js` | both | Done | 8 + 7b | Отправить сообщение | `/active-ride?role=*` |
| BD-RIDE-P-01…04 | `/active-ride?role=passenger` | `public/src/screens/active_ride_passenger.js` | passenger | Done | 4 stages | lifecycle | `...?status=COMPLETED` |
| BD-RIDE-P-05 | `...?status=COMPLETED` | `public/src/screens/active_ride_passenger.js` (production path audit needed for `ride-complete`) | passenger | Done | 7 | Оценить водителя | rating return / report return / bottom action → `/feed`; live secondary action → `/chat` (no `/map` exit) |
| BD-RIDE-P-06 | `...?role=passenger` modal | `public/src/screens/active_ride_passenger.js` | passenger | Done | 7 | Отменить поездку | cancel completion → `/new` or `/feed`; canceled / no-show fallback → `/feed` (top / back / feed buttons) |
| BD-RIDE-P-07 | `...?role=passenger` modal | `public/src/screens/active_ride_passenger.js` | passenger | Done | 4 | SOS / Жалоба | returns to ride |
| BD-DRIVER-02 | `/driver-map` | `public/src/screens/driver_map.js` | driver | Done | 3 | Выйти на линию | `/active-ride?role=driver` |
| BD-RIDE-D | `/active-ride?role=driver` | `public/src/screens/active_ride.js` | driver | Partial | 5 stages | lifecycle | `...?status=COMPLETED` |
| BD-RIDE-D-SHEETS-01 | `...?role=driver` modal | `public/src/screens/active_ride_driver_sheets.js` | driver | Done | 11 | Отменить / Проблема | returns to ride |
| BD-RIDE-D-NOSHOW-01 | `...?status=NO_SHOW` | `public/src/screens/active_ride.js` (terminal stub via `renderCanceledStub`) | driver | Partial / future issue | terminal NO_SHOW stub wired; full no-show flow not wired | Показать terminal NO_SHOW / future no-show flow | primary exit → `/feed`; history exit → `/profile` (no `/driver-map` exit from this state today; full flow remains a future dedicated issue) |
| BD-RIDE-D-09 | `...?status=COMPLETED` | `public/src/screens/active_ride_driver_sheets.js` | driver | Done | 7 | Закрыть поездку | `/driver-map` |
| BD-RIDE-D-11 | `...?status=COMPLETED` | `public/src/screens/active_ride_driver_sheets.js` | driver | Done | 5 | Ваш доход / Закрыть | `/driver-map` |
| BD-RIDE-HISTORY-D-01 | `/profile?role=driver&pane=payouts` (payouts pane deep-link) → receipt at `/receipt?tripId=...` | list source: `public/src/screens/profile.js` (payouts pane); receipt screen: `public/src/screens/trip_receipt.js` | driver | Done | 6 | Открыть чек | `/receipt?tripId=...` (receipt screen) |
| BD-PROFILE-PASSENGER-01 | `/profile` | `public/src/screens/profile.js` | passenger | Done | 6 | Создать поездку | `/map` |
| BD-PROFILE-D-03 | `/profile?role=driver` | `public/src/screens/profile.js` | driver | Done | 10 / 5 tabs | На линию (toggles `driverOnline` via `#pf2-ip-go-online`; active-shift CTA opens `/driver-map`) | `/driver-map` (no direct `/active-ride?role=driver` entry — that route is opened only after an accepted order / confirmation handoff with a trip id) |
| BD-RULES-01 | `/rules` | `public/src/screens/rules.js` | both | Done | sections | Открыть раздел | back |
| BD-PROFILE-01 | `/profile` legacy | `public/src/screens/profile.js` | driver | Legacy | 5 tabs | — | superseded by D-03 |
| BD-HISTORY-P-01 | `/profile` (history section) → `/history` (route gap) | `public/src/screens/profile.js` / `public/src/screens/active_ride_passenger.js` | passenger | Done · audit | dedicated `/history` route, loading, detail parity | Открыть чек | `/profile` (history pane) |
| BD-GARAGE-01 | `/profile?role=driver` (garage gate); no `/garage` route registered | `public/src/screens/profile.js` (shipped UI) + `public/src/garage.js` (shared helper); no `public/src/screens/garage.js` exists today | driver | Done · audit | consolidation of active garage PR line (BD-PROFILE-D-05F+ / BD-PROFILE-GARAGE-*) | Добавить авто | `/profile?role=driver` |
| BD-SETTINGS-01 | `/settings` (not registered) | — | both | Missing | ~6 | Сохранить | register `/settings`; wire passenger `#pfp-settings-btn` + driver gear CTA |
| BD-NOTIF-01 | `/notifications` | — | both | Missing | ~3 | Открыть уведомление | target screen |
| BD-ERROR-01 | global overlay | — | both | Missing | ~4 | Повторить | current screen |
| BD-MOD-01 | `/report` or modal | — | both | Missing | ~3 | Отправить жалобу | back / moderation queue |

## Key paths

### Guest

First-run welcome path: `/welcome` (empty hash default) → role select → permissions → directly to `/feed` (passenger) or `/driver-map` (driver). The welcome flow persists `welcomeSeen` and the selected role and **does not** route through `/onboarding?step=phone` — that route is the profile-side phone-verification re-entry path, not part of the first-run welcome transition. There is no separate `/auth` screen — phone verification lives inside the onboarding step host.

### Passenger

`/map` → `/route-picker` → `/route-preview` → `/order-map-draft` → `/responses` → `/trip-confirmation` → `/active-ride?role=passenger` → completion → history/receipt.

### Driver

`/profile?role=driver` → `/driver-map` → order detail / confirmation → `/active-ride?role=driver` → completed earnings → driver history/payouts.

### Shared

Feed, chat, rules, settings and notifications are shared surfaces and must not leak passenger/driver state across roles.

## Consistency notes

- Driver finance/receipt atoms should remain consistent with passenger receipt work.
- Passenger trip history already renders inside `/profile` and the active-ride completion path; the audit-gate scope is a dedicated `/history` route + parity loading/detail states only, not a from-scratch build.
- Map screens remain placeholder/foundation until a real map adapter lands.
- Auth is UI-only in this artifact; no SMS backend is implied.

## Codex P2 review follow-up (PR #495)

- **BD-COMPOSER-01 route** is `/new` (`public/src/app.js`), not `/feed→create`; the old route would fall back to `/feed` and never open the composer.
- **BD-COMPOSER-01 status** is Done · audit because per-type / preview / draft-saved / validation / submit-loading are already shipped in `public/src/screens/composer.js`.
- **BD-RESPOND-01 role** is driver (driver offer sheet at `/respond`, persists `kind: 'passenger_response'` with driver snapshot); the passenger-side response board remains `/responses`.
- **BD-HISTORY-P-01** is Done · audit, not Missing — passenger history already renders in `/profile` and completed rides are persisted by `saveRideHistoryEntry`. The remaining scope is the dedicated `/history` route + loading/detail parity.
- **BD-GARAGE-01** is Done · audit, not Missing — the driver Garage gate already renders inside `/profile?role=driver`. The remaining scope is consolidation of the active garage PR line (BD-PROFILE-D-05F+, BD-PROFILE-GARAGE-*).
- **BD-RIDE-D-NOSHOW-01** is Partial, not Done — `docs/design-registry.json` and `docs/screen-contracts.md` record runtime support as a future dedicated issue. Only the terminal NO_SHOW / canceled stub renders today on the driver route (via `renderCanceledStub` in `public/src/screens/active_ride.js`); the full no-show flow (reason / confirm / compensation / support / loading / error) is out of scope for this artifact PR.
- **BD-ONBOARDING-01 routes / files split** — `/welcome` (empty hash default) is owned by `public/src/screens/welcome.js` (welcome / role / permissions / loading / error states). `/onboarding` is owned by `public/src/screens/onboarding.js` and hosts onboarding steps (e.g. `?step=phone`). The first-run welcome flow persists `welcomeSeen` + role and routes directly to `/feed` (passenger) or `/driver-map` (driver) — it does **not** pass through `/onboarding?step=phone`. The OTP step is the profile-side phone-verification re-entry path. A literal `#/` is not a registered route.
- **BD-AUTH-01** is reclassified from Missing → Done · audit. Phone / OTP is already shipped inside the onboarding step host (`public/src/screens/onboarding.js`) which renders phone/code input and persists `phoneVerified`; verification CTAs in `public/src/screens/profile.js` route to `/onboarding?step=phone`. The remaining scope is audit / reuse of the existing flow, not a new `/auth` screen. BD-AUTH-01 is no longer counted in the net-new missing-screen backlog.
- **BD-RIDE-HISTORY-D-01 list source + receipt target** — payouts list source is the profile payouts pane at `/profile?role=driver&pane=payouts` (the deep-link the trip receipt's «К выплатам» action uses); `/profile?role=driver` alone opens the overview tab, not the payout rows. The receipt action **Открыть чек** routes to `/receipt?tripId=...` and the receipt document surface is `public/src/screens/trip_receipt.js`.
- **BD-RULES-01 file** is `public/src/screens/rules.js` (registered for `/rules` in `public/src/app.js`), not `profile.js`. Rules & Documents is owned by the dedicated rules module.
- **Runtime file names** — handoff rows use production-style `public/src/screens/*.js` paths (`welcome.js`, `feed.js`, `composer.js`, `respond.js`, `responses.js`, `map.js`, `route_picker.js`, `route_preview.js`, `order_map_draft.js`, `trip_confirmation.js`, `chat.js`, `active_ride_passenger.js`, `active_ride.js`, `active_ride_driver_sheets.js`, `driver_map.js`, `profile.js`, `trip_receipt.js`, `rules.js`). Cloud / RV sandbox `.jsx` filenames are not the runtime modules. Any uncertain file is marked **production path audit needed** rather than inventing a `.jsx` runtime file.
- **BD-RIDE-D-NOSHOW-01 wired exits** — for the currently wired driver terminal `NO_SHOW`/canceled stub, primary exit is `go('/feed')` and history exit is `go('/profile')`. There is no `/driver-map` exit from that state today. The full no-show flow remains Partial / future issue.
- **BD-RIDE-P-06 wired exits** — cancel sheet completion actions route to `/new` or `/feed`, and the direct canceled / no-show fallback also sends top / back / feed buttons to `/feed`. `/map` is not the canceled destination in the shipped UI.
- **BD-RIDE-P-05 wired exits** — completion UI wires the rating return, report return and bottom action to `/feed`; the live secondary action is `/chat`. There is no `/map` exit from BD-RIDE-P-05 in the shipped UI.
- **BD-RESPOND-01 required query** — runtime reads `getRouteParam('postId')` and renders a missing-state when it is absent. Handoff route is `/respond?postId=...` (feed and post detail link with that query); a bare `/respond` opens the missing state, not the driver offer sheet.
- **BD-MAP-05 submit destination** — order-map-draft submit handler navigates to `/responses?orderId=...&state=empty` after creating the order. The responses screen needs that canonical order id before «Выбрать водителя» can build the passenger active ride; a bare `/responses` lands on the generic / mock responses state instead of the created request.
- **BD-PROFILE-D-03 «На линию» destination** — the profile button (`#pf2-ip-go-online`) only toggles `driverOnline`. The line-ready active-shift CTA routes to `/driver-map`; `/active-ride?role=driver` is opened only after an accepted order / confirmation handoff with a trip id, not directly from the profile. Routing the profile CTA at `/active-ride` would open an unseeded ride.
- **BD-GARAGE-01 file** — the shipped Garage UI is rendered from `public/src/screens/profile.js`; the shared helper is `public/src/garage.js`. There is no `public/src/screens/garage.js` and no registered `/garage` route. The audit gate must point at the shipped surface, not an invented screen file.
- **BD-SETTINGS-01 scope** — settings is NOT already linked from profile headers. The missing scope includes: register `/settings` route, implement the settings screen, wire the passenger profile settings CTA (`#pfp-settings-btn`), and wire the driver profile settings / gear CTA. Logout / delete / account actions remain UI-only unless a future backend issue says otherwise.
