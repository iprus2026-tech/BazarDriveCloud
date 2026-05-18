# Roadmap

> Roadmap отражает реальное состояние Cloud/PWA-репо. Backend, real Mapbox
> SDK, auth, payments, uploads, push и APK — отдельные фазы, в коде ещё
> нет. См. также [`docs/screen-contracts.md`](docs/screen-contracts.md),
> [`docs/flow-contracts.md`](docs/flow-contracts.md),
> [`docs/active-ride-plan.md`](docs/active-ride-plan.md).

---

## Phase 1 — PWA-каркас (✓ готово)

- [x] Static shell в `public/`, без сборщика
- [x] Cloud Design: токены, компоненты, max-width 430 px shell
- [x] Welcome → Feed / Rules / Profile-lite (гость, без onboarding)
- [x] Onboarding запускается только из CTA (FAB `+`, переход в `/new`)
- [x] Pending intent: после onboarding → ровно на задуманное действие
- [x] Composer с автосохранением черновика в localStorage
- [x] Mock API (seed-посты + createPost) в localStorage
- [x] FAB только на ленте, динамический header, bottom navigation
- [x] Service Worker: precache + offline fallback на `index.html`
- [x] PWA manifest с PNG-иконками 192/512 (any + maskable)
- [x] Строгий CSP без `unsafe-inline`
- [x] CI: проверки CSP-инвариантов и синтаксиса JS
- [x] GitHub Pages deploy из `public/`

---

## Current state — taxi-flow mock spine (✓ готово, mock-only)

Cloud/PWA-репо уже вышел за рамки исходного «доска объявлений» Phase 1
и собран как mock-демо taxi-flow между водителем и пассажиром.
Сетевой backend по-прежнему отсутствует — всё хранится в `localStorage`.

- [x] **Feed V2** (BD-FEED-01) — категории, карточки trip/passenger/announcement/marketplace
- [x] **Composer V2** (BD-COMPOSER-01) — 5 типов публикаций, автосохранение черновика
- [x] **Onboarding V2** (BD-ONBOARDING-01) — выбор роли passenger/driver, vehicle, документы
- [x] **Profile** — passenger (BD-PROFILE-01) и driver (BD-PROFILE-02), документы, верификация телефона (mock)
- [x] **Respond** (BD-RESPOND-01) — водитель отвечает на passenger-заявку
- [x] **Responses** (BD-RESPONSES-01) — пассажир видит inbox откликов водителей
- [x] **Chat** (BD-CHAT-01) — переписка по поездке (per-trip / per-response, единый chat store)
- [x] **Trip confirmation handoff** (BD-CONFIRM-01) — мост между чатом и активной поездкой, 5 состояний
- [x] **Active ride · driver** (BD-RIDE-D-01..06) — NEW_ORDER → DRIVER_EN_ROUTE → WAITING_PASSENGER → IN_PROGRESS → COMPLETED
- [x] **Active ride · passenger** (BD-RIDE-P-01..05) — DRIVER_EN_ROUTE → WAITING_PASSENGER → IN_PROGRESS → COMPLETED
- [x] **Passenger cancel sheet** (BD-RIDE-P-06) — нижняя шторка отмены с выбором причины
- [x] **Passenger safety sheet** (BD-RIDE-P-07) — нижняя шторка «Безопасность» (stub)
- [x] **Ride state contract** (BD-RIDE-F-01) — `public/src/ride_state.js`, единый storage активной поездки
- [x] **MapShell placeholder** (BD-RIDE-F-02) — `public/src/mapbox/map_shell.js`, без Mapbox SDK
- [x] **Service Worker update banner** — `public/src/sw-update.js`, mock `skipWaiting` handshake
- [x] **Role-based dispatch внутри `/active-ride`** — `active_ride.js` импортирует `active_ride_passenger.js` и сам выбирает рендерер по `?role`. Отдельного маршрута `/active-ride-passenger` нет.

### Gaps в текущем taxi-flow (требуют отдельных issues)

- [ ] **Driver cancel sheet** (BD-RIDE-D-07) — сейчас кнопка `Отменить` показывает только toast
- [ ] **Driver problem sheet** (BD-RIDE-D-08) — отсутствует
- [ ] **Driver earnings sheet** (BD-RIDE-D-09) — отсутствует
- [ ] **Driver no-show flow** — кнопка «Не приехал» показывает только toast
- [ ] **Mapbox foundation stubs** — `mapbox_config`, `mapbox_loader`, `mapbox_state`, `geolocation_service`, `route_service`, `price_estimator`, `driver_markers`, `trip_status_layer` ещё не созданы

---

## Phase 2 — Реальный backend

- [ ] Замена `mock_api.js` на API-клиент (fetch + JWT / magic-link)
- [ ] Аутентификация: Telegram Login или magic-link по email
- [ ] Загрузка изображений к объявлениям
- [ ] Категории и теги в ленте — фильтрация и поиск
- [ ] Серверная модерация по правилам сообщества
- [ ] Пагинация / infinite scroll
- [ ] Реальная стыковка `ride_state.js` с серверным state-machine
- [ ] Real-time канал для chat / responses / ride status (WebSocket / SSE)

---

## Phase 3 — Engagement

- [ ] Web Push уведомления (новые объявления по подпискам, новые отклики, статусы поездки)
- [ ] Геолокация — сортировка по расстоянию, реальный pickup detection
- [ ] Избранное и сохранённые запросы
- [ ] Профиль с историей объявлений / поездок и рейтингом
- [ ] Доверенные контакты + Поделиться поездкой (сейчас mock)

---

## Phase 4 — Maps / Mapbox foundation

> Сейчас Mapbox в проекте нет. Все ride-экраны рисуют DOM placeholder
> `public/src/mapbox/map_shell.js` поверх Cloud Design сетки.
> Подключение настоящего SDK — отдельная фаза с обновлением CSP и SW.

- [ ] **BD-MAP-FOUND-STUB-01** — JS-стабы по структуре из `docs/active-ride-plan.md` §11 (config, loader, state, geolocation, route, price, markers, status layer). Без SDK, без сетевых запросов.
- [ ] **BD-MAP-FOUND-01** — реальный Mapbox GL JS, токен, CSP-обновление, SW-обновление
- [ ] **BD-MAP-01..05** — MapHome / LocationPermission / RoutePicker / RoutePreview / OrderMapDraft
- [ ] **BD-DRIVER-01** — DriverMap (полноценная карта в driver-режиме)

---

## Phase 5 — За пределами PWA

- [ ] Telegram Mini App обёртка поверх того же кода
- [ ] Background Sync для офлайн-публикаций
- [ ] Web Share API для шеринга объявлений / поездок
- [ ] Нативные подписи (App Store / Play) при необходимости
- [ ] APK / TWA-обёртка

---

## Дизайн (Cloud Design)

- [ ] Иллюстрации пустых состояний (empty state)
- [ ] Анимации переходов между экранами
- [ ] Гайдлайн по плотности и компонентам (storybook-lite)
- [ ] Переключатель тема тёмная / светлая
- [ ] Брендовый маскот / brand voice
- [ ] Секционирование `public/styles/cloud.css` (9k+ строк → банеры по фичам)

---

## Технический долг

- `mock_api.js` → в Phase 2 уезжает в IndexedDB или на сервер
- `ride_state.js` — RIDE_STATUS enum включает зарезервированные значения (`CONFIRMATION_PENDING`, `CHAT_STARTED`, `DRIVER_APPROACHING_PICKUP`), которые UI пока не использует — либо закрыть, либо подключить
- `bazardrive.chat.v1` пишется из двух модулей (`chat.js` и `active_ride.js`), legacy-migration дублируется
- Hash-роутер прост, работает в Pages; при собственном домене — History API + 404-fallback
- Нет тестов; минимально — node:test для роутера и `ride_state.js`
- Иконки генерируются `scripts/build_icons.py`; при рефакторинге иконок — обновить и SW precache
- `public/styles/cloud.css` ~9k строк; без банеров секций PR над разными шторками будут давать merge-конфликты
- `public/prototypes/bazardrive_prototype.html` — 1.3 MB в обычном git; рассмотреть Git LFS, если будет расти
