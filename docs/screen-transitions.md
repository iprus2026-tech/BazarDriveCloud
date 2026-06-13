# BD-FULL-FLOW-01 · Screen Transitions

Developer handoff table extracted from the BD-FULL-FLOW-01 navigation map.

| Screen ID | Route | File | Role | Status | States changed | Primary action | Next screen |
|---|---|---|---|---|---|---|---|
| BD-ONBOARDING-01 | `/` | `onboarding.jsx` | both | Done | 5 | Выбрать роль | `/map` or `/driver-map` |
| BD-AUTH-01 | `/auth` | — | both | Missing | ~4 | Войти по телефону | `/` onboarding |
| BD-FEED-01 | `/feed` | `feed.jsx` | both | Done | 5 filters | Создать публикацию | `/new`, `/order/<id>` |
| BD-COMPOSER-01 | `/new` | `composer.js` | both | Done · audit | per-type / preview / draft-saved / validation / submit-loading already shipped | Опубликовать | `/feed` |
| BD-ORDER-DETAIL-01 | `/order/<id>` | `order-detail.jsx` | both | Done | 9 role-split states | Откликнуться / Принять | `/respond`, `/trip-confirmation` |
| BD-RESPOND-01 | `/respond` | `respond.js` | driver | Done | 1 driver-offer sheet | Отправить предложение/отклик | `/chat?role=driver` (passenger-side board remains `/responses`) |
| BD-FLOW-INBOX-01 | `/responses` | `responses-inbox.jsx` | passenger | Done | 4 | Выбрать водителя | `/active-ride?role=passenger` |
| BD-MAP-01 | `/map` | `map-home.jsx` | both | Done | 9 | Выбрать маршрут | `/route-picker` |
| BD-MAP-03 | `/route-picker` | `route-picker.jsx` | passenger | Done | 8 + live search | Подтвердить маршрут | `/route-preview` |
| BD-MAP-04 | `/route-preview` | `route-preview.jsx` | passenger | Done | 5 | Создать заявку | `/order-map-draft` |
| BD-MAP-05 | `/order-map-draft` | `order-map-draft.jsx` | passenger | Done | 6 | Разместить заявку | `/responses` |
| BD-CONFIRM-01 | `/trip-confirmation` | `trip-confirmation.jsx` | both | Done | 5 | Подтвердить поездку | `/active-ride?role=*` |
| BD-CHAT-02 | `/chat` | `chat-flow.jsx` | both | Done | 8 + 7b | Отправить сообщение | `/active-ride?role=*` |
| BD-RIDE-P-01…04 | `/active-ride?role=passenger` | `active-ride.jsx` | passenger | Done | 4 stages | lifecycle | `...?status=COMPLETED` |
| BD-RIDE-P-05 | `...?status=COMPLETED` | `ride-complete.jsx` | passenger | Done | 7 | Оценить водителя | `/map` or `/feed` |
| BD-RIDE-P-06 | `...?role=passenger` modal | `cancel-ride.jsx` | passenger | Done | 7 | Отменить поездку | `/map` canceled |
| BD-RIDE-P-07 | `...?role=passenger` modal | `safety-sheet.jsx` | passenger | Done | 4 | SOS / Жалоба | returns to ride |
| BD-DRIVER-02 | `/driver-map` | `driver-map.jsx` | driver | Done | 3 | Выйти на линию | `/active-ride?role=driver` |
| BD-RIDE-D | `/active-ride?role=driver` | `driver-ride.jsx` | driver | Partial | 5 stages | lifecycle | `...?status=COMPLETED` |
| BD-RIDE-D-SHEETS-01 | `...?role=driver` modal | `driver-sheets.jsx` | driver | Done | 11 | Отменить / Проблема | returns to ride |
| BD-RIDE-D-NOSHOW-01 | `...?status=NO_SHOW` | `driver-noshow.jsx` | driver | Partial / future issue | terminal NO_SHOW stub wired; full no-show flow not wired | Показать terminal NO_SHOW / future no-show flow | `/driver-map` |
| BD-RIDE-D-09 | `...?status=COMPLETED` | `driver-earnings.jsx` | driver | Done | 7 | Закрыть поездку | `/driver-map` |
| BD-RIDE-D-11 | `...?status=COMPLETED` | `driver-earnings-completed.jsx` | driver | Done | 5 | Ваш доход / Закрыть | `/driver-map` |
| BD-RIDE-HISTORY-D-01 | `/profile→payouts` | `driver-history.jsx` | driver | Done | 6 | Открыть чек | `/profile?role=driver` |
| BD-PROFILE-PASSENGER-01 | `/profile` | `passenger-profile.jsx` | passenger | Done | 6 | Создать поездку | `/map` |
| BD-PROFILE-D-03 | `/profile?role=driver` | `driver-dashboard.jsx` | driver | Done | 10 / 5 tabs | На линию | `/active-ride?role=driver` |
| BD-RULES-01 | `/rules` | `profile.jsx` | both | Done | sections | Открыть раздел | back |
| BD-PROFILE-01 | `/profile` legacy | `profile.jsx` | driver | Legacy | 5 tabs | — | superseded by D-03 |
| BD-HISTORY-P-01 | `/profile` (history section) → `/history` (route gap) | `profile.js` / `active_ride_passenger.js` | passenger | Done · audit | dedicated `/history` route, loading, detail parity | Открыть чек | `/profile` (history pane) |
| BD-GARAGE-01 | `/profile?role=driver` (garage gate) → `/garage` (consolidation gap) | `profile.js` / `garage.js` | driver | Done · audit | consolidation of active garage PR line (BD-PROFILE-D-05F+ / BD-PROFILE-GARAGE-*) | Добавить авто | `/profile?role=driver` |
| BD-SETTINGS-01 | `/settings` | — | both | Missing | ~6 | Сохранить | — |
| BD-NOTIF-01 | `/notifications` | — | both | Missing | ~3 | Открыть уведомление | target screen |
| BD-ERROR-01 | global overlay | — | both | Missing | ~4 | Повторить | current screen |
| BD-MOD-01 | `/report` or modal | — | both | Missing | ~3 | Отправить жалобу | back / moderation queue |

## Key paths

### Guest

`/` → role select → permissions → `/auth` → role route.

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
- **BD-COMPOSER-01 status** is Done · audit because per-type / preview / draft-saved / validation / submit-loading are already shipped in `composer.js`.
- **BD-RESPOND-01 role** is driver (driver offer sheet at `/respond`, persists `kind: 'passenger_response'` with driver snapshot); the passenger-side response board remains `/responses`.
- **BD-HISTORY-P-01** is Done · audit, not Missing — passenger history already renders in `/profile` and completed rides are persisted by `saveRideHistoryEntry`. The remaining scope is the dedicated `/history` route + loading/detail parity.
- **BD-GARAGE-01** is Done · audit, not Missing — the driver Garage gate already renders inside `/profile?role=driver`. The remaining scope is consolidation of the active garage PR line (BD-PROFILE-D-05F+, BD-PROFILE-GARAGE-*).
- **BD-RIDE-D-NOSHOW-01** is Partial, not Done — `docs/design-registry.json` and `docs/screen-contracts.md` record runtime support as a future dedicated issue. Only the terminal NO_SHOW / canceled stub renders today on the driver route; the full no-show flow (reason / confirm / compensation / support / loading / error) is out of scope for this artifact PR.
