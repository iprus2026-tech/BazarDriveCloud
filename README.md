# BazarDrive

Installable PWA для объявлений, поездок и попутчиков. Без шума и накруток.

**Cloud Design** - тёмная тема, оранжевый акцент `#FF6B35`, мобильный shell max-width 430 px.

Vanilla HTML / CSS / ES-модули. Без сборщика, без фреймворка, без зависимостей в рантайме.

> **Это Cloud/PWA-репозиторий.** Здесь нет backend, API-сервера и Android/APK-сборки.
> Mock-данные хранятся в `localStorage` / in-memory stores. Mapbox SDK не подключён -
> вместо него используется `public/src/mapbox/map_shell.js` и локальные заглушки.

---

## Стек

| Слой | Технология |
|------|-----------|
| Хостинг | GitHub Pages (`public/` деплоится как есть) |
| Модули | ES-модули, без бандлера, без зависимостей в рантайме |
| Стили | `public/styles/cloud.css` + feature CSS для route flow |
| Роутер | Hash-роутер (`#/feed`, `#/active-ride`, …) |
| Состояние | `localStorage` (user + posts + ride + chat + draft + responses + route/order stores) |
| Офлайн | Service Worker, precache + offline fallback на `index.html` |
| PWA | `manifest.webmanifest`, PNG-иконки 192/512 (any + maskable) |
| CSP | Строгий без `unsafe-inline` |

---

## Структура

```text
public/
  index.html                  оболочка приложения (#shell + #app + tabbar + FAB)
  manifest.webmanifest        PWA-манифест
  sw.js                       Service Worker (см. PRECACHE list внутри файла)
  styles/
    cloud.css                 дизайн-токены и компоненты Cloud Design
    route_picker.css          RoutePicker feature styles
    route_picker_layout_fix.css
    route_preview.css
    order_map_draft.css
    driver_sheets.css
  src/
    app.js                    bootstrap + регистрация routes/SW + FAB/map dispatch
    router.js                 hash-роутер + welcome-gate + FAB/tabbar/driver guard
    state.js                  localStorage-обёртка user/profile flags
    storage_boundary.js       user-scoped localStorage clear routine
    mock_api.js               seed-посты + authored posts + local ride orders + inbox mocks
    ride_state.js             контракт и storage активной поездки (BD-RIDE-F-01)
    ride_actions.js           shared ride/order accept + driver mode helpers
    ride_history.js           local ride history
    repeat_route.js           repeat route draft helper
    favorite_routes.js        favorite routes storage/helpers
    sw-update.js              баннер «доступна новая версия» + skipWaiting handshake
    util.js                   escapeHtml
    screens/
      welcome.js              Welcome
      onboarding.js           Onboarding
      feed.js                 Feed V2 (BD-FEED-01)
      composer.js             Composer V2 (BD-COMPOSER-01)
      map.js                  MapHome mock surface (BD-MAP-01)
      location_permission.js  LocationPermission mock surface (BD-MAP-02)
      route_picker.js         RoutePicker (BD-MAP-03)
      route_preview.js        RoutePreview (BD-MAP-04)
      order_map_draft.js      OrderMapDraft (BD-MAP-05)
      driver_map.js           DriverMap mock order list/accept (BD-DRIVER-01)
      respond.js              Respond (BD-RESPOND-01)
      responses.js            Responses inbox (BD-RESPONSES-01)
      chat.js                 Chat (BD-CHAT-01)
      inbox.js                Inbox hub (BD-INBOX-01)
      post_detail.js          Post detail (BD-POST-01)
      trip_confirmation.js    Trip confirmation handoff (BD-CONFIRM-01)
      trip_confirmation_handoff.js
      driver_handoff_snapshot.js
      active_ride.js          Active ride driver + role-dispatch (BD-RIDE-D-*)
      active_ride_passenger.js Active ride passenger renderer (BD-RIDE-P-*)
      profile.js              Profile passenger + driver views (BD-PROFILE-01/-02)
      rules.js                Rules (BD-RULES-01)
    mapbox/
      map_shell.js            DOM placeholder, без Mapbox SDK (BD-RIDE-F-02)
      mapbox_config.js        local map config stub
      mapbox_loader.js        safe loader stub, no SDK/network by default
      mapbox_state.js         map state helpers
      geolocation_service.js  geolocation mock/fallback helpers
      route_service.js        mock route helpers
      price_estimator.js      local price estimator
  icons/                      SVG-source + PNG 192/512 (any + maskable)
  assets/                     Копии иконок 192/512
  prototypes/                 Визуальные эталоны Cloud Design (не кешируются SW)

scripts/
  check.mjs                   CI-проверки: CSP-инварианты, JSON, синтаксис JS

docs/
  screen-contracts.md         Контракты экранов (Cloud Design → route → state → acceptance)
  flow-contracts.md           End-to-end passenger → driver ride flow (BD-FLOW-01)
  active-ride-plan.md         Current Active Ride contract
  project-health-audit.md     Snapshot-аудит состояния проекта и план оздоровления

.github/
  workflows/
    ci.yml                    Статические проверки на push/PR
    pages.yml                 Деплой public/ → GitHub Pages
  ISSUE_TEMPLATE/
```

---

## Текущее состояние

BazarDriveCloud сейчас является mock-only PWA taxi-flow:

```text
Feed / Composer / Profile
↓
RoutePicker / RoutePreview / OrderMapDraft
↓
DriverMap / Respond / Responses / Chat / Inbox
↓
TripConfirmation
↓
ActiveRide driver/passenger
```

Ключевые ограничения текущей версии:

```text
no backend API
no real Mapbox SDK
no native geolocation dependency
no payments
no APK/TWA
no inline script/style/on* handlers
no CSP weakening
```

---

## Запуск локально

Поддерживаемый локальный запуск — через статический сервер из корня репозитория:

```bash
python -m http.server 8000 -d public
```

Открыть:

```text
http://localhost:8000
```

Не используйте прямое открытие `public/index.html` через `file://`: приложение грузит ES-модули, а Service Worker работает только на HTTP(S) или localhost.

---

## Проверка

```bash
node scripts/check.mjs
```

Проверка держит инварианты:

```text
- нет inline script/style/on* handlers
- CSP не ослаблен
- manifest и JSON валидны
- JS синтаксис проходит node --check
- prototype не используется как основной index.html
```

---

## GitHub Pages

Workflow `.github/workflows/pages.yml` деплоит `public/` как статический сайт.

---

## Документация как источник правды

- `docs/screen-contracts.md` - текущая карта экранов, маршрутов, storage ownership и acceptance boundary.
- `docs/flow-contracts.md` - end-to-end passenger → driver flow, включая current route inventory.
- `docs/active-ride-plan.md` - текущий контракт Active Ride, статусы и Mapbox boundary.
- `ROADMAP.md` - фазовая карта, где real backend и real Mapbox остаются будущими фазами.
