# Roadmap

> Roadmap отражает реальное состояние Cloud/PWA-репо. PWA остаётся local-first, а Phase-1 Fastify/PostgreSQL backend spine уже существует в `/server`. Backend и auth ещё не активированы для PWA и остаются pilot-blocked до закрытия authorization, delivery, deploy и operations gates. Real Mapbox SDK, payments, uploads, push и APK остаются отдельными фазами. См. также [`docs/screen-contracts.md`](docs/screen-contracts.md), [`docs/flow-contracts.md`](docs/flow-contracts.md), [`docs/active-ride-plan.md`](docs/active-ride-plan.md).

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

## Current state - local-first PWA + Phase-1 backend spine

Cloud/PWA-репо уже вышел за рамки исходной доски объявлений и собран как local-first taxi-flow между водителем и пассажиром. Phase-1 Fastify/PostgreSQL backend spine уже существует в `/server`, но PWA backend cutover не активирован. По умолчанию PWA продолжает читать и писать через `localStorage` / in-memory stores; наличие LIVE server routes не означает production readiness или разрешение на автоматический cutover.

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
- [ ] **Backend pilot gates** - OTP delivery/rate limiting, session lifecycle and role policy, chat participant authorization, staging deploy/rollback and observability remain before PWA activation.
- [ ] **Driver no-show completion** - основной flow уже реализован; оставшиеся no-show/error/dispute состояния и product gaps отслеживаются в `docs/missing-screens.md`.
- [ ] **Client/PWA automated coverage** - `node scripts/check.mjs` and smoke scripts are the current client guards; broader client node:test/browser coverage remains technical debt. The `/server` layer already has node:test route/contract coverage and separate server CI.

---

## Phase 2 - Backend pilot / PWA cutover

Phase-1 backend code already exists. This phase is about hardening, validating and activating it per resource rather than creating a backend from zero.

- [x] **Phase-1 backend spine** - Fastify/PostgreSQL, ordered migrations, repository layer and guarded PWA seams
- [x] **Thin API client** - `public/src/api_client.js` exists; backend remains OFF by default
- [x] **Orders / matching / ride-state / polling / history foundations** - backend routes exist; module-specific pilot gates still apply
- [ ] **Per-resource PWA cutover** - move reads/writes from local stores only after each module's exit conditions are closed
- [ ] **Phone + OTP auth hardening** - production delivery, throttling, session lifecycle and role/readiness policy
- [ ] **Chat participant authorization** - sender identity and order/ride participation must be session-derived before activation
- [ ] **Staging deploy / rollback / observability** - reproducible deployment, health evidence, redacted logs, metrics and rollback
- [ ] Image uploads for posts/orders
- [ ] Server-side categories, tags, filters, search and moderation
- [ ] Pagination / infinite scroll
- [ ] WebSocket/SSE push if required; cursor polling for ride status/events already exists

---

## Phase 3 - Engagement

- [ ] Web Push notifications
- [ ] Real geolocation sorting / pickup detection
- [ ] Favorites and saved searches
- [ ] Ratings and profile aggregates backed by server data
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

- PWA mock/local stores still need a phased cutover to the guarded backend API; do not flip the backend globally before module-specific pilot gates close.
- `ride_state.js` still carries reserved values (`CONFIRMATION_PENDING`, `CHAT_STARTED`) for bridge screens.
- `bazardrive.chat.v1` is written from multiple modules, so legacy migration must stay centralized enough to avoid drift.
- Hash router works for Pages; a custom domain could later use History API with 404 fallback.
- PWA client coverage still relies mainly on `scripts/check.mjs` and smoke scripts; broader client node:test/browser coverage remains technical debt. The `/server` layer already has node:test and server CI.
- Icons are generated by `scripts/build_icons.py`; icon changes require SW precache review.
- `public/styles/cloud.css` is large and needs sectioning to reduce merge conflicts.
- `public/prototypes/bazardrive_prototype.html` is large; consider Git LFS if it grows.
