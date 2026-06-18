# Roadmap

> Roadmap отражает реальное состояние Cloud/PWA-репо. Backend, real Mapbox SDK, auth, payments, uploads, push и APK - отдельные фазы, в коде ещё нет. См. также [`docs/screen-contracts.md`](docs/screen-contracts.md), [`docs/flow-contracts.md`](docs/flow-contracts.md), [`docs/active-ride-plan.md`](docs/active-ride-plan.md).

---

## Phase 1 - PWA-каркас (✓ готово)

- [x] Static shell в `public/`, без сборщика
- [x] Cloud Design: токены, компоненты, max-width 430 px shell
- [x] Welcome → Feed / Rules / Profile-lite
- [x] Onboarding запускается только из CTA
- [x] Pending intent: после onboarding → ровно на задуманное действие
- [x] Composer с автосохранением черновика в localStorage
- [x] Mock API в localStorage / in-memory stores
- [x] FAB только на ленте, bottom navigation
- [x] Service Worker: precache + offline fallback на `index.html`
- [x] PWA manifest с PNG-иконками 192/512
- [x] Строгий CSP без `unsafe-inline`
- [x] CI: проверки CSP-инвариантов и синтаксиса JS
- [x] GitHub Pages deploy из `public/`

---

## Current state - taxi-flow mock spine (✓ готово, mock-only)

Cloud/PWA-репо уже вышел за рамки исходной доски объявлений и собран как mock-демо taxi-flow между водителем и пассажиром. Сетевой backend по-прежнему отсутствует, всё хранится в `localStorage` или in-memory mock data.

- [x] **Feed V2** (BD-FEED-01) - категории, карточки trip/passenger/announcement/marketplace
- [x] **Composer V2** (BD-COMPOSER-01) - 5 типов публикаций, автосохранение черновика
- [x] **Onboarding V2** (BD-ONBOARDING-01) - выбор роли passenger/driver, vehicle, документы
- [x] **Profile** - passenger (BD-PROFILE-01) и driver (BD-PROFILE-02), документы, верификация телефона (mock)
- [x] **Respond** (BD-RESPOND-01) - водитель отвечает на passenger-заявку
- [x] **Responses** (BD-RESPONSES-01) - пассажир видит inbox откликов водителей
- [x] **Chat** (BD-CHAT-01) - переписка по поездке/отклику
- [x] **Inbox** (BD-INBOX-01) - общий hub для responses/messages/rides
- [x] **Post detail** (BD-POST-01) - детальная карточка публикации
- [x] **Trip confirmation handoff** (BD-CONFIRM-01) - мост между чатом и активной поездкой
- [x] **Active ride driver** (BD-RIDE-D-01..09) - NEW_ORDER → DRIVER_EN_ROUTE → DRIVER_APPROACHING_PICKUP → WAITING_PASSENGER → IN_PROGRESS → COMPLETED плюс cancel/problem/earnings sheets
- [x] **Active ride passenger** (BD-RIDE-P-01..07) - DRIVER_EN_ROUTE → DRIVER_APPROACHING_PICKUP → WAITING_PASSENGER → IN_PROGRESS → COMPLETED плюс cancel/safety sheets
- [x] **Ride state contract** (BD-RIDE-F-01) - `public/src/ride_state.js`, единый storage активной поездки
- [x] **MapShell placeholder** (BD-RIDE-F-02) - `public/src/mapbox/map_shell.js`, без Mapbox SDK
- [x] **MapHome** (BD-MAP-01) - `/map`, mock map surface
- [x] **LocationPermission** (BD-MAP-02) - `/location-permission`, permission explanation/fallback
- [x] **RoutePicker** (BD-MAP-03) - `/route-picker`, writes `bazardrive.route_draft.v1`
- [x] **RoutePreview** (BD-MAP-04) - `/route-preview`, validates route draft and shows ETA/price
- [x] **OrderMapDraft** (BD-MAP-05) - `/order-map-draft`, writes local passenger order
- [x] **DriverMap** (BD-DRIVER-01) - `/driver-map`, lists/accepts local passenger orders
- [x] **Storage boundary routines** (BD-AUTH-BOUNDARY-01) - `public/src/storage_boundary.js` clears user-scoped stores on local identity reset
- [x] **Service Worker update banner** - `public/src/sw-update.js`, mock `skipWaiting` handshake
- [x] **Role-based dispatch inside `/active-ride`** - `active_ride.js` imports `active_ride_passenger.js`; no separate `/active-ride-passenger` route

### Gaps that remain real

- [ ] **Real Mapbox SDK** - not connected. All map screens use DOM placeholders (the `driver_markers.js` / `trip_status_layer.js` foundation stubs exist; real Mapbox GL is the gap).
- [ ] **Driver no-show full flow** - no-show still needs a dedicated issue before becoming a complete lifecycle surface.
- [ ] **Automated tests** - `node scripts/check.mjs` is the current guard; node:test coverage remains technical debt.

---

## Phase 2 - Real backend

- [ ] Replace mock/local stores with an API client
- [ ] Authentication: Telegram Login or magic-link
- [ ] Image uploads for posts/orders
- [ ] Server-side categories, tags, filters and search
- [ ] Server-side moderation
- [ ] Pagination / infinite scroll
- [ ] Real server ride state machine linked to `ride_state.js`
- [ ] Real-time channel for chat / responses / ride status

---

## Phase 3 - Engagement

- [ ] Web Push notifications
- [ ] Real geolocation sorting / pickup detection
- [ ] Favorites and saved searches
- [ ] Profile history and ratings backed by server data
- [ ] Trusted contacts and shared ride links

---

## Phase 4 - Maps / Mapbox foundation

> Current code has map screens, but **not real Mapbox**. The current foundation is MapShell-only and must stay that way until a dedicated Mapbox integration PR updates CSP, SW, token handling and failure states together.

- [x] **BD-MAP-01..05 mock screens** - MapHome, LocationPermission, RoutePicker, RoutePreview, OrderMapDraft
- [x] **BD-DRIVER-01 mock screen** - DriverMap
- [x] **MapShell placeholder** - `public/src/mapbox/map_shell.js`
- [x] **Basic mapbox folder stubs** - config, loader, state, geolocation, route service, price estimator
- [x] **Marker & status layer stubs** - `driver_markers.js` (BD-MAP-FOUND-03), `trip_status_layer.js` (BD-MAP-FOUND-04) — DOM foundation stubs, no real Mapbox yet
- [ ] **BD-MAP-FOUND-01** - real Mapbox GL JS, token, CSP update, SW update, network failure fallback
- [ ] Real route line, pickup/dropoff coordinates, driver/passenger live-position mock

---

## Phase 5 - Beyond PWA

- [ ] Telegram Mini App wrapper over the same Cloud/PWA code
- [ ] Background Sync for offline-created posts/orders
- [ ] Web Share API for posts/rides
- [ ] Native store packaging only if product direction requires it
- [ ] APK / TWA wrapper

---

## Design / Cloud Design

- [ ] Empty-state illustrations
- [ ] Transition animation guidelines
- [ ] Component density guide / storybook-lite
- [ ] Dark/light theme switch
- [ ] Brand mascot / voice
- [ ] Section banners for `public/styles/cloud.css`

---

## Technical debt

- `mock_api.js` should move to IndexedDB or server-backed data in Phase 2.
- `ride_state.js` still carries reserved values (`CONFIRMATION_PENDING`, `CHAT_STARTED`) for bridge screens.
- `bazardrive.chat.v1` is written from multiple modules, so legacy migration must stay centralized enough to avoid drift.
- Hash router works for Pages; a custom domain could later use History API with 404 fallback.
- There are no automated unit tests yet.
- Icons are generated by `scripts/build_icons.py`; icon changes require SW precache review.
- `public/styles/cloud.css` is large and needs sectioning to reduce merge conflicts.
- `public/prototypes/bazardrive_prototype.html` is large; consider Git LFS if it grows.
