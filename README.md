# BazarDrive

Installable PWA для объявлений, поездок и попутчиков. Без шума и накруток.

**Cloud Design** — тёмная тема, оранжевый акцент `#FF6B35`, мобильный shell max-width 430 px.

Vanilla HTML / CSS / ES-модули. Без сборщика, без фреймворка, без зависимостей в рантайме.

> **Это Cloud/PWA-репозиторий.** Здесь нет backend, API-сервера и Android/APK-сборки.
> Mock-данные хранятся в `localStorage`. Mapbox SDK не подключён —
> вместо него `public/src/mapbox/map_shell.js` (DOM-плейсхолдер).

---

## Стек

| Слой | Технология |
|------|-----------|
| Хостинг | GitHub Pages (`public/` деплоится как есть) |
| Модули | ES-модули, без бандлера, без зависимостей в рантайме |
| Стили | `public/styles/cloud.css` — дизайн-токены + компоненты Cloud Design |
| Роутер | Hash-роутер (`#/feed`, `#/active-ride`, …) |
| Состояние | `localStorage` (user + посты + ride + chat + draft + responses) |
| Офлайн | Service Worker, precache + offline fallback на `index.html` |
| PWA | `manifest.webmanifest`, PNG-иконки 192/512 (any + maskable) |
| CSP | Строгий без `unsafe-inline` |

---

## Структура

```
public/
  index.html                  оболочка приложения (#shell + #app + tabbar + FAB)
  manifest.webmanifest        PWA-манифест
  sw.js                       Service Worker (см. PRECACHE list внутри файла)
  styles/
    cloud.css                 дизайн-токены и компоненты Cloud Design (9k+ строк)
  src/
    app.js                    bootstrap + регистрация SW + FAB-логика
    router.js                 hash-роутер + welcome-gate + управление FAB/tabbar
    state.js                  localStorage-обёртка (user, docs, derived flags)
    mock_api.js               seed-посты + listFeedPosts / createFeedPost / listPosts
    ride_state.js             контракт и storage активной поездки (BD-RIDE-F-01)
    util.js                   escapeHtml
    sw-update.js              баннер «доступна новая версия» + skipWaiting handshake
    screens/
      welcome.js              Welcome (первый запуск)
      onboarding.js           Onboarding (создание профиля)
      feed.js                 Feed V2 (BD-FEED-01)
      composer.js             Composer V2 (BD-COMPOSER-01)
      respond.js              Respond — отклик водителя на заявку (BD-RESPOND-01)
      chat.js                 Chat — переписка по поездке/отклику (BD-CHAT-01)
      responses.js            Responses — inbox откликов пассажира (BD-RESPONSES-01)
      trip_confirmation.js    Trip confirmation handoff (BD-CONFIRM-01)
      active_ride.js          Active ride · driver + role-dispatch (BD-RIDE-D-*)
      active_ride_passenger.js Active ride · passenger renderer (BD-RIDE-P-*)
      profile.js              Profile (passenger + driver views) (BD-PROFILE-01/-02)
      rules.js                Rules (BD-RULES-01)
    mapbox/
      map_shell.js            DOM placeholder, без Mapbox SDK (BD-RIDE-F-02)
  icons/                      SVG-source + PNG 192/512 (any + maskable)
  assets/                     Копии иконок 192/512
  prototypes/                 Визуальные эталоны Cloud Design (не кешируются SW)

scripts/
  check.mjs                   CI-проверки: CSP-инварианты, JSON, синтаксис JS

docs/
  screen-contracts.md         Контракты экранов (Cloud Design → route → state → acceptance)
  flow-contracts.md           End-to-end passenger → driver ride flow (BD-FLOW-01)
  active-ride-plan.md         Подробный план Active Ride (BD-RIDE-D-*, BD-RIDE-P-*)

.github/
  workflows/
    ci.yml                    Статические проверки на push/PR
    pages.yml                 Деплой public/ → GitHub Pages
  ISSUE_TEMPLATE/
    bug_report.yml
    feature_request.yml
    design_task.yml
```

---

## Архитектура taxi-flow (mock spine)

```
Welcome → Onboarding → Profile
                          ↓
                        Feed (Лента)
                          ↓
        ┌─────────────────┼──────────────────────┐
        ↓                 ↓                      ↓
    Composer         Responses inbox        Respond (водитель)
   (новая публикация)  (пассажир видит        ↓
        ↓               отклики)         Chat (переписка)
        ↓                 ↓                    ↓
        └───────→ Trip confirmation handoff ←──┘
                          ↓
                   Active ride (role-dispatch внутри файла)
                   ├─ Driver: NEW_ORDER → DRIVER_EN_ROUTE →
                   │  WAITING_PASSENGER → IN_PROGRESS → COMPLETED
                   └─ Passenger: DRIVER_EN_ROUTE → WAITING_PASSENGER →
                      IN_PROGRESS → COMPLETED (+ cancel/safety sheets)
```

Подробный flow с per-step таблицами и localStorage-контрактами:
[`docs/flow-contracts.md`](docs/flow-contracts.md). Детали ride state-machine
и mapbox boundary: [`docs/active-ride-plan.md`](docs/active-ride-plan.md).
Per-screen контракты: [`docs/screen-contracts.md`](docs/screen-contracts.md).

---

## Cloud Design: токены

```css
--accent:  #FF6B35   /* оранжевый акцент */
--bg-0:    #0a0a0c   /* фон приложения */
--bg-1:    #131316   /* карточки */
--bg-2:    #1a1a1f   /* инпуты, вторичные кнопки */
--text:    #f3f3f5   /* основной текст */
--text-2:  #a8a8b3   /* вторичный */
--text-3:  #6c6c78   /* третичный / подсказки */
```

---

## Запустить локально

PWA требует `localhost` или HTTPS — Service Worker не регистрируется с `file://`.

```bash
# Python
python3 -m http.server 8000 --directory public

# Node
npx serve public
# или
npx http-server public -p 8000 -c-1
```

Открыть `http://localhost:8000/`.

## Тест на телефоне (та же сеть)

1. Узнайте IP: `ip a` / `ipconfig`
2. Откройте `http://<IP>:8000` в браузере телефона
3. Chrome/Safari покажет баннер «Добавить на экран» — установите как PWA

## Если после обновления PWA глючит на телефоне

PWA может продолжать отдавать старые файлы из Service Worker cache. Симптомы: старый экран, пропавший tabbar, фриз скролла, старые стили после merge.

Что сделать:

1. Закрыть PWA/Chrome полностью из списка последних приложений и открыть заново.
2. В приложении должен появиться баннер «Доступна новая версия BazarDrive» —
   нажать «Обновить» (`public/src/sw-update.js`). Это вызывает `skipWaiting`
   на новом Service Worker и перезагружает страницу.
3. Если баннер не появился — открыть сайт с cache-buster параметром,
   например `http://<IP>:8000/?v=test`.
4. Если не помогло: Chrome → Настройки → Настройки сайтов → Данные сайтов →
   найти адрес BazarDrive → Очистить.
5. Для установленного PWA самый надёжный способ: удалить приложение с
   телефона и установить заново.

После очистки или переустановки активируется свежий Service Worker и
подтягивается новый `cloud.css`.

> Текущая версия precache фиксируется в `public/sw.js` как
> `const VERSION = 'vNN'`. Любой новый файл `public/src/...` должен быть
> добавлен в массив `PRECACHE`, иначе офлайн-загрузка вернёт 404.

---

## Onboarding-гейт

- Гость может листать Feed, Rules и Profile-lite без регистрации.
- Onboarding запускается только при CTA-действиях (нажатие FAB `+`, переход в `/new`).
- После заполнения формы `pendingAction` возвращает пользователя ровно туда, откуда его унесли.

---

## Hash-роуты

| Route | Файл | Chrome (tabbar) |
|-------|------|------------------|
| `/welcome` | `screens/welcome.js` | hidden |
| `/onboarding` | `screens/onboarding.js` | hidden |
| `/feed` | `screens/feed.js` | visible + FAB |
| `/rules` | `screens/rules.js` | visible |
| `/profile` | `screens/profile.js` | visible |
| `/new` | `screens/composer.js` | visible |
| `/respond` | `screens/respond.js` | visible |
| `/responses` | `screens/responses.js` | visible |
| `/chat` | `screens/chat.js` | visible |
| `/trip-confirmation` | `screens/trip_confirmation.js` | hidden |
| `/active-ride` | `screens/active_ride.js` (диспатчит passenger renderer по `?role`) | hidden |

---

## Локальные проверки

```bash
node scripts/check.mjs
```

Проверяет:

- `public/index.html`: нет inline `<script>`, `<style>`, `style=""`, `on*=`
- `public/manifest.webmanifest`: валидный JSON, обязательные поля, корректные `theme_color` и `background_color`
- `public/sw.js`: precache не содержит ссылок на `prototypes/`
- Все `.js` под `public/src/`: нет `style=` в шаблонных строках, нет `.setAttribute('style', …)`, нет `.style.<property>` присвоений
- Синтаксис всех `.js` под `public/`

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) гоняет тот же скрипт на каждый PR.

---

## GitHub Pages

1. `Settings → Pages → Source → GitHub Actions`
2. При пуше в `main` workflow `pages.yml` деплоит папку `public/`
3. URL: `https://<org>.github.io/<repo>/`

## Roadmap

См. [ROADMAP.md](ROADMAP.md).
