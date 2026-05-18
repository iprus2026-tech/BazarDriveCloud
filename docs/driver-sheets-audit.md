# Driver Sheets — Post-Merge Health Audit

> **Snapshot taken on 2026-05-18.** Audits the state after #136
> (`Implement driver active ride sheets`) merged on top of #135
> (`docs: Add BD-RIDE-D-07/08/09 screen contracts for driver sheets`).
> This document is an audit record, not the current source of truth.

| Поле | Значение |
|------|----------|
| Branch | `claude/audit-driver-sheets-8fGxM` |
| Last commit | `ee7cba8 Implement driver active ride sheets (#136)` |
| Working tree | clean |
| `node scripts/check.mjs` | ✅ `All checks passed.` (exit 0) |
| Scope | Cloud / PWA only. Mock UI, без backend, без Mapbox SDK, без оплаты. |

## §1. Перечень проверенных URL

Все URL — hash-route внутри SPA (`/#/active-ride?...`). Параметры
читаются через `getHashQuery()` в `public/src/screens/active_ride.js:74-78`.

| URL | Что рендерит | Статус |
|-----|--------------|--------|
| `/active-ride?role=driver&status=DRIVER_EN_ROUTE` | `renderEnRoute()` (`active_ride.js:480`) | ✅ |
| `/active-ride?role=driver&status=WAITING_PASSENGER` | `renderWaiting()` (`active_ride.js:498`) | ✅ |
| `/active-ride?role=driver&status=IN_PROGRESS` | `renderInProgress()` (`active_ride.js:510`) | ✅ |
| `/active-ride?role=driver&status=COMPLETED` | `renderCompleted()` (`active_ride.js:520`) | ✅ |
| `/active-ride?role=driver&status=CANCELED` | `renderCanceledStub()` (`active_ride.js:530`) | ✅ |
| `/active-ride?role=driver&status=NO_SHOW` | `renderCanceledStub()` (`active_ride.js:530`) | ✅ |
| `/active-ride?role=passenger&status=DRIVER_EN_ROUTE` | `renderPassenger()` → `activeRidePassenger()` (`active_ride.js:385`) | ✅ |
| `/feed` | `feed` screen, registered in `app.js:18` | ✅ |

`safeApplyStatusFromQuery()` (`active_ride.js:89-117`) корректно фильтрует
переходы: монотонность по `timestamps.*At` соблюдена, неизвестные статусы
игнорируются.

## §2. Acceptance criteria

| Критерий | Файл / линия | Результат |
|----------|--------------|-----------|
| Cancel sheet (BD-RIDE-D-07) открывается только en-route | `active_ride.js:485` — `#ar-cancel` навешан в `renderEnRoute()`; других вызовов `openDriverCancelSheet` нет | ✅ |
| No-show доступен только в waiting | `active_ride.js:506` — `#ar-no-show` в `renderWaiting()` вызывает `openDriverProblemSheet` с `onNoShow`; в других render-функциях `onNoShow` не передаётся | ✅ |
| Problem в in-progress НЕ переводит в NO_SHOW | `active_ride.js:516` — `#ar-issue` вызывает `openDriverProblemSheet` с `allowedTypes` без `PASSENGER_NO_SHOW` и без `onNoShow`. Дополнительный guard `noShowAvailable` (`active_ride.js:306`) требует обоих условий | ✅ |
| Earnings sheet (BD-RIDE-D-09) открывается только в completed | `active_ride.js:525` — `#ar-earnings` в `renderCompleted()`; других вызовов `openDriverEarningsSheet` нет | ✅ |
| Passenger flow не изменён | `git log -- public/src/screens/active_ride_passenger.js` — последний коммит `69cee0e` (#122), до сheets-PR (#136). `git diff 69cee0e..HEAD -- public/src/screens/active_ride_passenger.js` пуст | ✅ |
| `ride_state.js` не тронут | `git log -- public/src/ride_state.js` — последний коммит `378204e` (#102). `git diff 378204e..HEAD -- public/src/ride_state.js` пуст | ✅ |
| `node scripts/check.mjs` проходит | `All checks passed.` (exit 0) | ✅ |

## §3. Изменения, внесённые PR #136

`git show --stat ee7cba8`:

```
public/src/screens/active_ride.js | 894 ++++++++++++++++-----------------
public/styles/driver_sheets.css   | 246 +++++++++++
2 files changed, 595 insertions(+), 545 deletions(-)
```

- Driver active ride переписан с inline-SVG-констант на единый
  shells-only поток с тремя bottom-sheet-ами: cancel (D-07), problem (D-08),
  earnings (D-09).
- `createDriverSheet()` (`active_ride.js:195`) — общий sheet-конструктор с
  focus-trap, Escape-close, backdrop-close, `aria-modal`.
- `bindOptionGroup()` (`active_ride.js:242`) — `role="radiogroup"` selection
  с двухшаговым `confirm` для CANCELED и NO_SHOW (`confirmPending` flag).
- `driver_sheets.css` — изолированный stylesheet, грузится лениво через
  `ensureDriverSheetsCss()` (`active_ride.js:80-87`) только при `role=driver`.

## §4. Замечания (не блокирующие)

1. `public/styles/driver_sheets.css` не добавлен в `PRECACHE` в `sw.js`.
   Sheet-стили грузятся динамически при первом открытии `/active-ride`
   driver-side; в offline-сценарии после первого визита они окажутся в
   runtime-кэше fetch-handler, но в первый визит offline не сработает.
2. `driver_sheets.css` не подключён в `index.html`. Это намеренно — link
   создаётся из JS, чтобы не нагружать первый paint у пассажира. Просто
   фиксирую как факт.
3. `screen-contracts.md` ещё не отражает driver D-07/D-08/D-09 как
   реализованные — но контракты лежат отдельно в #135. Это вне scope
   текущего PR.

## §5. Итог

Driver sheets BD-RIDE-D-07 / D-08 / D-09 интегрированы корректно. Все
семь acceptance-критериев выполнены, `check.mjs` зелёный, passenger flow
и ride_state.js не тронуты. Recommend: ✅ accept.
