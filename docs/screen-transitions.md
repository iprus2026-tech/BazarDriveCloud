# BD-FULL-FLOW-01 · Screen Transitions

Developer handoff table extracted from the BD-FULL-FLOW-01 navigation map.

| Screen ID | Route | File | Role | Status | States changed | Primary action | Next screen |
|---|---|---|---|---|---|---|---|
| BD-ONBOARDING-01 | `/` | `onboarding.jsx` | both | Done | 5 | Выбрать роль | `/map` or `/driver-map` |
| BD-AUTH-01 | `/auth` | — | both | Missing | ~4 | Войти по телефону | `/` onboarding |
| BD-FEED-01 | `/feed` | `feed.jsx` | both | Done | 5 filters | Создать публикацию | `/feed→create`, `/order/<id>` |
| BD-COMPOSER-01 | `/feed→create` | `composer.jsx` | both | Partial | create only | Опубликовать | `/feed` |
| BD-ORDER-DETAIL-01 | `/order/<id>` | `order-detail.jsx` | both | Done | 9 role-split states | Откликнуться / Принять | `/respond`, `/trip-confirmation` |
| BD-RESPOND-01 | `/respond` | `feed.jsx` sheet | passenger | Done | 1 sheet | Отправить отклик | `/responses` |
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
| BD-RIDE-D-NOSHOW-01 | `...?status=NO_SHOW` | `driver-noshow.jsx` | driver | Done | 7 | Пассажир не вышел | `/driver-map` |
| BD-RIDE-D-09 | `...?status=COMPLETED` | `driver-earnings.jsx` | driver | Done | 7 | Закрыть поездку | `/driver-map` |
| BD-RIDE-D-11 | `...?status=COMPLETED` | `driver-earnings-completed.jsx` | driver | Done | 5 | Ваш доход / Закрыть | `/driver-map` |
| BD-RIDE-HISTORY-D-01 | `/profile→payouts` | `driver-history.jsx` | driver | Done | 6 | Открыть чек | `/profile?role=driver` |
| BD-PROFILE-PASSENGER-01 | `/profile` | `passenger-profile.jsx` | passenger | Done | 6 | Создать поездку | `/map` |
| BD-PROFILE-D-03 | `/profile?role=driver` | `driver-dashboard.jsx` | driver | Done | 10 / 5 tabs | На линию | `/active-ride?role=driver` |
| BD-RULES-01 | `/rules` | `profile.jsx` | both | Done | sections | Открыть раздел | back |
| BD-PROFILE-01 | `/profile` legacy | `profile.jsx` | driver | Legacy | 5 tabs | — | superseded by D-03 |
| BD-HISTORY-P-01 | `/history` | — | passenger | Missing | ~5 | Открыть чек | — |
| BD-GARAGE-01 | `/garage` | — | driver | Missing / audit needed | ~7 | Добавить авто | `/profile?role=driver` |
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
- Passenger trip history should reuse receipt atoms rather than invent new fare labels.
- Map screens remain placeholder/foundation until a real map adapter lands.
- Auth is UI-only in this artifact; no SMS backend is implied.
