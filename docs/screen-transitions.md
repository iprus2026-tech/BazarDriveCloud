# BD-FULL-FLOW-01 · Screen Transitions

Developer handoff table extracted from the BD-FULL-FLOW-01 navigation map.

| Screen ID | Route | File | Role | Status | States changed | Primary action | Next screen |
|---|---|---|---|---|---|---|---|
| BD-ONBOARDING-01 | `/welcome`, `/onboarding` (empty hash defaults to `/welcome`) | `public/src/screens/onboarding.js` | both | Done | 5 | Выбрать роль | `/map` or `/driver-map` |
| BD-AUTH-01 | `/onboarding?step=phone` | `public/src/screens/onboarding.js` | both | Done · audit | phone / OTP mock already shipped; persists `phoneVerified` | Войти по телефону | `/onboarding` next step |
| BD-FEED-01 | `/feed` | `public/src/screens/feed.js` | both | Done | 5 filters | Создать публикацию | `/new`, `/order/<id>` |
| BD-COMPOSER-01 | `/new` | `public/src/screens/composer.js` | both | Done · audit | per-type / preview / draft-saved / validation / submit-loading already shipped | Опубликовать | `/feed` |
| BD-ORDER-DETAIL-01 | `/order/<id>` | `public/src/screens/order_detail.js` | both | Done | 9 role-split states | Откликнуться / Принять | `/respond`, `/trip-confirmation` |
| BD-RESPOND-01 | `/respond` | `public/src/screens/respond.js` | driver | Done | 1 driver-offer sheet | Отправить предложение/отклик | `/chat?role=driver` (passenger-side board remains `/responses`) |
| BD-FLOW-INBOX-01 | `/responses` | `public/src/screens/responses.js` | passenger | Done | 4 | Выбрать водителя | `/active-ride?role=passenger` |
| BD-MAP-01 | `/map` | `public/src/screens/map.js` | both | Done | 9 | Выбрать маршрут | `/route-picker` |
| BD-MAP-03 | `/route-picker` | `public/src/screens/route_picker.js` | passenger | Done | 8 + live search | Подтвердить маршрут | `/route-preview` |
| BD-MAP-04 | `/route-preview` | `public/src/screens/route_preview.js` | passenger | Done | 5 | Создать заявку | `/order-map-draft` |
| BD-MAP-05 | `/order-map-draft` | `public/src/screens/order_map_draft.js` | passenger | Done | 6 | Разместить заявку | `/responses` |
| BD-CONFIRM-01 | `/trip-confirmation` | `public/src/screens/trip_confirmation.js` | both | Done | 5 | Подтвердить поездку | `/active-ride?role=*` |
| BD-CHAT-02 | `/chat` | `public/src/screens/chat.js` | both | Done | 8 + 7b | Отправить сообщение | `/active-ride?role=*` |
| BD-RIDE-P-01…04 | `/active-ride?role=passenger` | `public/src/screens/active_ride_passenger.js` | passenger | Done | 4 stages | lifecycle | `...?status=COMPLETED` |
| BD-RIDE-P-05 | `...?status=COMPLETED` | `public/src/screens/active_ride_passenger.js` (production path audit needed for `ride-complete`) | passenger | Done | 7 | Оценить водителя | `/map` or `/feed` |
| BD-RIDE-P-06 | `...?role=passenger` modal | `public/src/screens/active_ride_passenger.js` | passenger | Done | 7 | Отменить поездку | cancel completion → `/new` or `/feed`; canceled / no-show fallback → `/feed` (top / back / feed buttons) |
| BD-RIDE-P-07 | `...?role=passenger` modal | `public/src/screens/active_ride_passenger.js` | passenger | Done | 4 | SOS / Жалоба | returns to ride |
| BD-DRIVER-02 | `/driver-map` | `public/src/screens/driver_map.js` | driver | Done | 3 | Выйти на линию | `/active-ride?role=driver` |
| BD-RIDE-D | `/active-ride?role=driver` | `public/src/screens/active_ride.js` | driver | Partial | 5 stages | lifecycle | `...?status=COMPLETED` |
| BD-RIDE-D-SHEETS-01 | `...?role=driver` modal | `public/src/screens/active_ride_driver_sheets.js` | driver | Done | 11 | Отменить / Проблема | returns to ride |
| BD-RIDE-D-NOSHOW-01 | `...?status=NO_SHOW` | `public/src/screens/active_ride.js` (terminal stub via `renderCanceledStub`) | driver | Partial / future issue | terminal NO_SHOW stub wired; full no-show flow not wired | Показать terminal NO_SHOW / future no-show flow | primary exit → `/feed`; history exit → `/profile` (no `/driver-map` exit from this state today; full flow remains a future dedicated issue) |
| BD-RIDE-D-09 | `...?status=COMPLETED` | `public/src/screens/active_ride_driver_sheets.js` | driver | Done | 7 | Закрыть поездку | `/driver-map` |
| BD-RIDE-D-11 | `...?status=COMPLETED` | `public/src/screens/active_ride_driver_sheets.js` | driver | Done | 5 | Ваш доход / Закрыть | `/driver-map` |
| BD-RIDE-HISTORY-D-01 | `/profile?role=driver` (payouts list source) → receipt at `/receipt?tripId=...` | list source: `public/src/screens/profile.js`; receipt screen: `public/src/screens/trip_receipt.js` | driver | Done | 6 | Открыть чек | `/receipt?tripId=...` (receipt screen) |
| BD-PROFILE-PASSENGER-01 | `/profile` | `public/src/screens/profile.js` | passenger | Done | 6 | Создать поездку | `/map` |
| BD-PROFILE-D-03 | `/profile?role=driver` | `public/src/screens/profile.js` | driver | Done | 10 / 5 tabs | На линию | `/active-ride?role=driver` |
| BD-RULES-01 | `/rules` | `public/src/screens/rules.js` | both | Done | sections | Открыть раздел | back |
| BD-PROFILE-01 | `/profile` legacy | `public/src/screens/profile.js` | driver | Legacy | 5 tabs | — | superseded by D-03 |
| BD-HISTORY-P-01 | `/profile` (history section) → `/history` (route gap) | `public/src/screens/profile.js` / `public/src/screens/active_ride_passenger.js` | passenger | Done · audit | dedicated `/history` route, loading, detail parity | Открыть чек | `/profile` (history pane) |
| BD-GARAGE-01 | `/profile?role=driver` (garage gate) → `/garage` (consolidation gap) | `public/src/screens/profile.js` / `public/src/screens/garage.js` | driver | Done · audit | consolidation of active garage PR line (BD-PROFILE-D-05F+ / BD-PROFILE-GARAGE-*) | Добавить авто | `/profile?role=driver` |
| BD-SETTINGS-01 | `/settings` (not registered) | — | both | Missing | ~6 | Сохранить | register `/settings`; wire passenger `#pfp-settings-btn` + driver gear CTA |
| BD-NOTIF-01 | `/notifications` | — | both | Missing | ~3 | Открыть уведомление | target screen |
| BD-ERROR-01 | global overlay | — | both | Missing | ~4 | Повторить | current screen |
| BD-MOD-01 | `/report` or modal | — | both | Missing | ~3 | Отправить жалобу | back / moderation queue |

## Key paths

### Guest

`/welcome` (empty hash default) → role select → permissions → `/onboarding?step=phone` (existing OTP mock; `phoneVerified` persists) → role route. There is no separate `/auth` screen — phone verification lives inside onboarding.

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
- **BD-ONBOARDING-01 route** is `/welcome` and `/onboarding` (`public/src/app.js`); empty hash defaults to `#/welcome` in `public/src/router.js`. A literal `#/` is not a registered route and, once `welcomeSeen` is true, falls through to `/feed`. Do not use `/` as the onboarding handoff route.
- **BD-AUTH-01** is reclassified from Missing → Done · audit. Phone / OTP is already shipped inside the onboarding flow (`public/src/screens/onboarding.js`) which renders phone/code input and persists `phoneVerified`; verification CTAs in `public/src/screens/profile.js` route to `/onboarding?step=phone`. The remaining scope is audit / reuse of the existing flow, not a new `/auth` screen. BD-AUTH-01 is no longer counted in the net-new missing-screen backlog.
- **BD-RIDE-HISTORY-D-01 receipt target** — the payouts list source remains the profile pane (`public/src/screens/profile.js`), but **Открыть чек** must route to `/receipt?tripId=...` and the receipt document surface is `public/src/screens/trip_receipt.js`. The profile payouts pane only deep-links receipt rows; it is not the receipt screen itself.
- **BD-RULES-01 file** is `public/src/screens/rules.js` (registered for `/rules` in `public/src/app.js`), not `profile.js`. Rules & Documents is owned by the dedicated rules module.
- **Runtime file names** — handoff rows use production-style `public/src/screens/*.js` paths (`feed.js`, `composer.js`, `respond.js`, `responses.js`, `map.js`, `route_picker.js`, `route_preview.js`, `order_map_draft.js`, `trip_confirmation.js`, `chat.js`, `active_ride_passenger.js`, `active_ride.js`, `active_ride_driver_sheets.js`, `driver_map.js`, `profile.js`, `trip_receipt.js`, `rules.js`). Cloud / RV sandbox `.jsx` filenames are not the runtime modules. Any uncertain file is marked **production path audit needed** rather than inventing a `.jsx` runtime file.
- **BD-RIDE-D-NOSHOW-01 wired exits** — for the currently wired driver terminal `NO_SHOW`/canceled stub, primary exit is `go('/feed')` and history exit is `go('/profile')`. There is no `/driver-map` exit from that state today. The full no-show flow remains Partial / future issue.
- **BD-RIDE-P-06 wired exits** — cancel sheet completion actions route to `/new` or `/feed`, and the direct canceled / no-show fallback also sends top / back / feed buttons to `/feed`. `/map` is not the canceled destination in the shipped UI.
- **BD-SETTINGS-01 scope** — settings is NOT already linked from profile headers. The missing scope includes: register `/settings` route, implement the settings screen, wire the passenger profile settings CTA (`#pfp-settings-btn`), and wire the driver profile settings / gear CTA. Logout / delete / account actions remain UI-only unless a future backend issue says otherwise.
