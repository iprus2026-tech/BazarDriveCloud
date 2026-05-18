# Offline-First Audit — `driver_sheets.css` × `sw.js`

> **Docs-only audit. Никаких изменений в коде в этом PR.**
> Снято: 2026-05-18, после merge PR #136 (`Implement driver active ride sheets`)
> и PR #137 (`docs: post-merge audit for driver sheets BD-RIDE-D-07/08/09`).

| Поле | Значение |
|------|----------|
| Audit branch | `claude/audit-driver-sheets-css-grpAA` (запрошенное имя — `audit/driver-sheets-sw-css`; задеплоено на designated harness-branch) |
| Last commit | `aba7650 docs: post-merge audit for driver sheets BD-RIDE-D-07/08/09 (#137)` |
| Working tree | clean (до этого audit-файла) |
| `node scripts/check.mjs` | ✅ `All checks passed.` (exit 0) |
| Scope | Cloud / PWA only. Без backend, без Mapbox SDK, без CSP-изменений. |
| Touch | `docs/offline-first-audit.md` (этот файл) |
| Do **not** touch | `active_ride.js`, `active_ride_passenger.js`, `ride_state.js`, Mapbox, backend, CSP, `sw.js` |

---

## §1. Как сейчас подключается `driver_sheets.css`

Подключение происходит **лениво из JS**, а не через `<link>` в `index.html`.

- Файл стилей: `public/styles/driver_sheets.css` (246 строк, добавлен в #136).
- Точка подключения: `public/src/screens/active_ride.js:80-87` — функция
  `ensureDriverSheetsCss()`:

  ```js
  function ensureDriverSheetsCss() {
    if (document.getElementById(DRIVER_SHEETS_CSS_ID)) return;
    const link = document.createElement('link');
    link.id = DRIVER_SHEETS_CSS_ID;
    link.rel = 'stylesheet';
    link.href = './styles/driver_sheets.css';
    document.head.appendChild(link);
  }
  ```

- Идентификатор `<link>` — константа `DRIVER_SHEETS_CSS_ID` (idempotent
  guard: повторный вызов не плодит дубликаты).
- Триггер вызова — только при `role=driver` на маршруте `/active-ride`
  (см. §3 в `docs/driver-sheets-audit.md`). Passenger-flow стиль не
  тянет.
- В `public/index.html:11` подключён только `./styles/cloud.css`. Этого
  достаточно для первого paint и всего passenger-UX; driver-стили
  подгружаются по требованию, чтобы не нагружать первую загрузку
  пассажирам.

Поиск ссылок на `driver_sheets` по репозиторию (`grep -rn driver_sheets`)
подтверждает: единственное runtime-подключение — `active_ride.js:85`.
В `index.html`, `sw.js`, `manifest.webmanifest`, `cloud.css` файла нет.

## §2. Есть ли `driver_sheets.css` в `public/sw.js` PRECACHE

**Нет.** Текущий `PRECACHE` (`public/sw.js:4-30`, `VERSION = 'v23'`)
включает:

```
./
./index.html
./manifest.webmanifest
./styles/cloud.css          ← единственный CSS в precache
./src/app.js
./src/router.js
./src/state.js
./src/util.js
./src/mock_api.js
./src/sw-update.js
./src/screens/welcome.js
./src/screens/feed.js
./src/screens/rules.js
./src/screens/profile.js
./src/screens/onboarding.js
./src/screens/composer.js
./src/screens/respond.js
./src/screens/chat.js
./src/screens/active_ride.js
./src/screens/active_ride_passenger.js
./src/screens/responses.js
./src/screens/trip_confirmation.js
./src/ride_state.js
./src/mapbox/map_shell.js
./icons/icon.svg
./icons/maskable-192.png
./icons/maskable-512.png
./assets/icon-192.png
./assets/icon-512.png
```

`./styles/driver_sheets.css` в списке отсутствует. Других механизмов
precache в `sw.js` нет — только `cache.addAll(PRECACHE)` в `install`-хэндлере.

## §3. Поведение приложения в offline / PWA-сценарии

`sw.js` использует cache-first стратегию с runtime-fallback (`fetch`-handler
в `public/sw.js:53-72`):

1. `caches.match(event.request)` — если есть, отдаём.
2. Иначе `fetch()` к сети; при `status 200 && type === 'basic'` кладём
   клон в `CACHE_NAME` через `cache.put`.
3. При сетевой ошибке — `caches.match('./index.html')` как navigation-fallback.

Из этого вытекают четыре сценария для `driver_sheets.css`:

| # | Сценарий | Что произойдёт | Severity |
|---|----------|----------------|----------|
| A | **Online, первый driver-визит** | `link.href = './styles/driver_sheets.css'` → cache miss → `fetch()` успешен → `cache.put()` записывает CSS в runtime-кэш. UI отрисовывается корректно. | ✅ ok |
| B | **Online → driver-визит был → offline → повторный driver-визит** | `caches.match` находит CSS из runtime-кэша (положенного в A). UI ок. | ✅ ok |
| C | **Только что установили PWA (precache `v23` накатился) → ни разу не открывали `/active-ride?role=driver` → offline → теперь открыли driver-визит** | `caches.match` — miss. `fetch()` падает (offline). В `.catch()` отдаётся `./index.html`. Браузер пытается распарсить HTML как CSS → стили не применяются. Driver sheets рендерятся как неоформленный HTML (структура есть, layout сломан). | ⚠ degraded |
| D | **Обновление SW до новой `VERSION` без `driver_sheets.css` в PRECACHE** | `activate`-handler удаляет старый `CACHE_NAME` (`sw.js:42-49`) — runtime-кэш с CSS уходит вместе с ним. После обновления сценарий C повторяется. | ⚠ degraded после каждого SW-апдейта |

**Дополнительный нюанс по сценарию C:** fallback `caches.match('./index.html')`
вернёт HTML-ответ с `Content-Type: text/html` для запроса CSS. Браузер
такие стили блокирует (MIME-mismatch для `<link rel="stylesheet">` в
strict-режиме). Видимый эффект — sheets без стилей, без явной ошибки в
UI, в DevTools — warning о mismatched MIME-type.

**Passenger-flow** при этом не страдает: passenger использует только
`cloud.css`, который в PRECACHE есть.

## §4. Нужно ли отдельное code-изменение для добавления CSS в PRECACHE

**Да, нужно — отдельным PR.** Этот audit ничего в коде не меняет.

Минимальный diff (для следующего PR — **здесь не применять**):

```diff
@@ public/sw.js
-const VERSION    = 'v23';
+const VERSION    = 'v24';
 const CACHE_NAME = `bazardrive-${VERSION}`;

 const PRECACHE = [
   './',
   './index.html',
   './manifest.webmanifest',
   './styles/cloud.css',
+  './styles/driver_sheets.css',
   './src/app.js',
```

Почему именно так:
- Bump `VERSION` обязателен — без него `install`-handler не сработает
  заново у уже установивших PWA пользователей, и новый PRECACHE не
  применится.
- `activate`-handler корректно почистит старый `bazardrive-v23` cache
  (`sw.js:42-49`).
- Никаких изменений в `active_ride.js` / `ensureDriverSheetsCss()` не
  требуется: lazy `<link>` injection остаётся, но запрос пойдёт прямо
  из precache.

## §5. Severity: **NON-BLOCKER**

- Текущий код **работает онлайн** во всех сценариях (A, B, C при
  доступной сети).
- Деградация (сценарии C / D) — только в редком окне: «свежеустановленный
  PWA без хотя бы одного online-открытия driver-режима» **И** «полный
  offline». В рамках прототипа (mock UI, без backend) этот сценарий
  маловероятен на пользовательской стороне.
- Passenger-flow / fleet-критика не задеты.
- `node scripts/check.mjs` — зелёный (см. §6).

Тем не менее, **рекомендуется закрыть** в ближайшем follow-up PR, потому
что:
1. ROADMAP / README позиционируют проект как «cloud / PWA prototype» —
   PWA-offline-консистентность ожидается читателем.
2. Каждое обновление `VERSION` в `sw.js` сейчас сбрасывает runtime-кэш с
   `driver_sheets.css` и снова создаёт окно деградации до первого
   driver-визита онлайн.
3. Один файл, +1 строка в PRECACHE, +1 bump `VERSION`. Минимальная
   когнитивная нагрузка на ревью.

## §6. Acceptance

| Критерий | Результат |
|----------|-----------|
| `node scripts/check.mjs` passes | ✅ `All checks passed.` |
| Audit clearly says blocker / non-blocker | ✅ см. §5 — **NON-BLOCKER** |
| Если нужен code-change — описан scope следующего PR | ✅ см. §4 и §7 |
| `active_ride.js` не тронут | ✅ только `docs/offline-first-audit.md` |
| `active_ride_passenger.js` не тронут | ✅ |
| `ride_state.js` не тронут | ✅ |
| Mapbox / backend / CSP / `sw.js` не тронуты в audit-PR | ✅ |

## §7. Предложение для следующего PR

**Title:** `sw: precache driver_sheets.css (offline-first parity)`

**Scope (1 файл, ~2 строки изменений):**
- `public/sw.js`:
  - `VERSION`: `'v23'` → `'v24'`.
  - В `PRECACHE` добавить `'./styles/driver_sheets.css'` сразу после
    `'./styles/cloud.css'` для алфавитной близости стилей.

**Что НЕ делать в том PR:**
- Не трогать `ensureDriverSheetsCss()` / `active_ride.js` — lazy `<link>`
  injection остаётся (это контракт passenger-first paint, см. §1).
- Не менять fetch-handler / стратегию кэша — текущая cache-first
  достаточна.
- Не трогать `manifest.webmanifest`, CSP, Mapbox-shell.
- Не вводить hashed asset names / cache-busting механизм — overkill для
  прототипа.

**Acceptance для будущего PR:**
- `node scripts/check.mjs` зелёный.
- DevTools → Application → Cache Storage → `bazardrive-v24` содержит
  `./styles/driver_sheets.css` сразу после установки SW, без открытия
  `/active-ride?role=driver`.
- Hard-refresh + offline + переход на `/active-ride?role=driver&status=DRIVER_EN_ROUTE`
  на свежей установке: driver sheets рендерятся стилизованно.
- Старый кэш `bazardrive-v23` удалён `activate`-handler-ом.

---

## Итог

Подключение `driver_sheets.css` корректно для онлайна и для повторных
визитов; **non-blocker** для merge #136/#137. Единственная деградация —
свежий PWA-install + offline + первый driver-визит — устраняется
точечным PR на `public/sw.js` (см. §7). До тех пор audit фиксирует
поведение, но кода не трогает.
