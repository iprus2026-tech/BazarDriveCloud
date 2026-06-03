# Dispatcher report (пример формата)

Date: (локальный отчёт подставляет дату прогона)

Это **стабильный пример** того, что рутиной генерируется в локальный
`docs/dispatcher-report.md` (git-ignored — в коммиты не попадает). Здесь правки
безопасны; сам live-отчёт регенерируется на каждом `node scripts/dispatcher.mjs`
и редактировать его вручную не нужно.

READY != auto-merge: финальный merge gate всегда за GitHub. Готовность узла
разводится на три состояния (см. Readiness legend ниже): «узел зелёный» больше
не путается с «нужно коммитить».

## Risk legend

```text
HIGH    public/src/** (screens, router, state, mock_api, ride_state, mapbox),
        public/index.html (CSP), public/sw.js (precache)        → Can auto-fix: no
MEDIUM  scripts/**, public/styles/**, .github/**,
        README.md / ROADMAP.md / docs/screen-contracts.md       → Can auto-fix: no
LOW     docs/*.md, генерируемый отчёт                            → Can auto-fix: yes (safe hygiene)
```

`--fix` применяет только обратимую гигиену (CRLF→LF, хвостовые пробелы, финальный
перевод строки) и только к LOW-узлам. HIGH/MEDIUM и любые структурные дефекты
авто-фиксу не подлежат — уходят задачей в роли (`NEEDS_ROLES`).

## Readiness legend

```text
READY_CLEAN  узел зелёный И рабочее дерево чистое → noActionNeeded=true,
             commitNeeded=false. Делать нечего, коммитить нечего.
READY_DIRTY  узел зелёный И есть незакоммиченные tracked-изменения →
             commitNeeded=true. Оформить commit/PR.
NEEDS_ROLES  узел не зелёный (падения проверок / design drift) → задачи по
             ролям; merge gate держать закрытым до зелёного CI.
```

В `--json` это поля `readiness` / `commitNeeded` / `noActionNeeded` / `dirty`.
Легаси-поля сохранены: `ready` (= «узел зелёный») и `mergeGate` (READY / NEEDS-ROLES).
`dirty` считается по tracked-файлам — git-ignored отчёт и курсор рутины не учитываются.

## Карточка узла

```text
Target           public/src/screens/feed.js
Kind             screen — экран (render + поведение)
Reason selected  недавно изменён в git
Risk             HIGH
Can auto-fix     no — delegated to roles
Suggested owner  Claude Code
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
(пропущено — узел не LOW-риск, авто-фикс запрещён)
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

### Claude Code — _логика, JS, баги, поведение, smoke-фиксы_

- [ ] Провести узел «public/src/screens/feed.js» (экран (render + поведение)) до зелёного и зафиксировать.

### Cloud Design — _CSS, render интерфейса, кнопки, визуальные состояния_

- [ ] Поддержать «public/src/screens/feed.js»: CSS, render интерфейса, кнопки, визуальные состояния.
- [ ] Сверить render и кнопки «public/src/screens/feed.js» с Cloud Design (тема, #FF6B35, состояния).

### GitHub — _CI/workflows, PR, issue triage, merge gate_

- [ ] Подтвердить зелёный CI и провести merge gate.

## 5. Что следующий PR должен сделать

```text
- Узел «public/src/screens/feed.js» зелёный, изменений нет — действий не требуется (no action needed), коммитить нечего.
```

## Merge gate

```text
READY_CLEAN — узел зелёный, изменений нет: действий не требуется, коммитить нечего. Это НЕ auto-merge: финальный gate за GitHub.
```
