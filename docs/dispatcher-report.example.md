# Dispatcher report (пример формата)

Date: (локальный отчёт подставляет дату прогона)

Это **стабильный пример** того, что рутиной генерируется в локальный
`docs/dispatcher-report.md` (git-ignored — в коммиты не попадает). Здесь правки
безопасны; сам live-отчёт регенерируется на каждом `node scripts/dispatcher.mjs`
и редактировать его вручную не нужно.

READY != auto-merge: финальный merge gate всегда за GitHub. Готовность проекта
разводится на три состояния (см. Readiness legend ниже): зелёные gate больше
не путаются с «нужно коммитить». На чистом зелёном дереве диспетчер возвращает
`NO_ACTIVE_SLICE`, а не назначает случайный UI-файл по round-robin.

## Risk legend

```text
NONE    NO_ACTIVE_SLICE                                         → Can auto-fix: n/a
HIGH    public runtime, server/**, migrations, infra/**          → Can auto-fix: no
MEDIUM  scripts/**, tests/**, docs-site/**, public/styles/**,
        .github/**, ключевые проектные контракты                 → Can auto-fix: no
LOW     обычные docs/*.md                                        → Can auto-fix: yes (safe hygiene)
```

`--fix` применяет только обратимую гигиену (CRLF→LF, хвостовые пробелы, финальный
перевод строки) и только к LOW-узлам. HIGH/MEDIUM и любые структурные дефекты
авто-фиксу не подлежат — уходят задачей в роли (`NEEDS_ROLES`).

## Readiness legend

```text
READY_CLEAN  проектные gate зелёные И рабочее дерево чистое →
             NO_ACTIVE_SLICE, noActionNeeded=true, commitNeeded=false.
READY_DIRTY  узел зелёный И есть незакоммиченные tracked-изменения →
             commitNeeded=true. Оформить commit/PR.
NEEDS_ROLES  узел не зелёный (падения проверок / design drift) → задачи по
             ролям; merge gate держать закрытым до зелёного CI.
```

В `--json` это поля `readiness` / `commitNeeded` / `noActionNeeded` / `dirty`.
Легаси-поля сохранены: `ready` (= «узел зелёный») и `mergeGate` (READY / NEEDS-ROLES).
`dirty` считается по tracked-файлам — git-ignored отчёт не учитывается.

## Карточка узла

```text
Target           NO_ACTIVE_SLICE
Kind             idle — активный срез отсутствует
Layer            Repository
Reason selected  clean tree + green gates — no active slice
Risk             NONE
Can auto-fix     n/a — no active slice
Suggested owner  —
Iterations       1
Merge gate       READY_CLEAN
Commit needed    no — working tree clean, nothing to commit
```

> Та же карточка в других состояниях меняет две строки:
> ```text
> Merge gate       READY_DIRTY
> Commit needed    yes — node green with uncommitted tracked changes
> ```
> ```text
> Merge gate       NEEDS_ROLES
> Commit needed    no — node not green (resolve role tasks first)
> ```

## Architecture inventory

Каждый tracked-узел получает архитектурный слой; отсутствующая зона остаётся
видна с нулём. Числа ниже — пример snapshot и меняются вместе с репозиторием.

```text
Total            374
UI / PWA             72
Driver App           6
Passenger App        3
Store                4
Backend API          44
DB                   3
Cache                1
Mapbox               10
Telegram Bot         0
Monitoring           1
PWA / Offline        3
Smoke                120
Contract / Docs      101
Infrastructure / CI  5
Developer Tooling    1
```

## 1. Что проверено (checks run)

```text
PASS  scripts/check.mjs
PASS  scripts/smoke-driver-docs-readiness.mjs
PASS  scripts/smoke-driver-map-guard.mjs
PASS  scripts/smoke-driver-map-readiness.mjs
PASS  scripts/smoke-lifecycle.mjs
```

## 2. Что упало (failures)

```text
(ничего — все проверки зелёные)
```

## 3. Почему упало

```text
(нет падений)
```

## Применённые safe-фиксы

```text
(не требуется — активного среза нет)
```

## Design registry / Design drift

```text
Registry      docs/design-registry.json
Render gates  1   Screens 18   Sections 9/9 covered   Manual notes 2
Status        CLEAN
```

Manual-interaction notes (не расхождение — справочно):

- BD-RIDE-D-SAFETY-01 — Safety: No query route renders the safety sheet; open it via the shield control inside active ride.
- BD-RIDE-P-SAFETY-01 — Safety: No query route renders the safety sheet; open it via the shield control inside active ride.

## 4. Кто чинит (распределение по ролям)

_Нет назначений — проектные gate зелёные, рабочее дерево чистое._

> В состояниях READY_DIRTY и NEEDS_ROLES эта секция возвращает обычный список
> ролевых задач (owner / assist / Cloud Design / merge gate). На READY_CLEAN
> `tasks[]` в `--json` пуст и эта секция не назначает ни одной роли: статус
> merge-gate остаётся за блоком «Merge gate» ниже.

## 5. Что следующий PR должен сделать

```text
- Активного среза нет: проектные gate зелёные, tracked-изменений нет. Указать --target или начать отдельную ветку задачи.
```

## Merge gate

```text
READY_CLEAN — проектные gate зелёные, tracked-изменений нет: активного среза нет. Это НЕ auto-merge: финальный gate за GitHub.
```
