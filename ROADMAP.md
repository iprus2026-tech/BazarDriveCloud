# Roadmap

> Roadmap отражает реальное состояние Cloud/PWA-репо. PWA остаётся local-first, а Phase-1 Fastify/PostgreSQL backend spine уже существует в `/server`. Backend и auth ещё не активированы для PWA и остаются pilot-blocked до закрытия authorization, delivery, deploy и operations gates. Mapbox GL foundation и реальный `/map` на GitHub Pages уже активированы; server Route & Price, остальные map-surfaces, payments, uploads, push и APK остаются отдельными фазами. См. также [`docs/screen-contracts.md`](docs/screen-contracts.md), [`docs/flow-contracts.md`](docs/flow-contracts.md), [`docs/active-ride-plan.md`](docs/active-ride-plan.md).

> **Project-map sync 2026-09-02.** Не путать три разных состояния: **server implementation**, **PWA consumption/activation** и **полную целевую Mini-Yonder фазу**. Живой backend-модуль может быть shipped, пока PWA всё ещё работает local-first; отдельный фундамент внутри тёмного сервиса не делает весь сервис shipped.

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
- [x] CSP остаётся fail-closed для scripts (`script-src 'self'`); Mapbox GL требует отдельного ограниченного `style-src 'unsafe-inline'` плюс exact Mapbox connect/img/worker boundaries
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
- [x] **MapShell fallback** (BD-RIDE-F-02) - `public/src/mapbox/map_shell.js`, остаётся dark/failure fallback для map-surfaces
- [x] **MapHome** (BD-MAP-01) - `/map` умеет гидратировать реальный Mapbox GL поверх MapShell; URL-restricted token активирован на GitHub Pages
- [x] **LocationPermission** (BD-MAP-02) - `/location-permission`, permission explanation/fallback
- [x] **RoutePicker** (BD-MAP-03) - `/route-picker`, writes `bazardrive.route_draft.v1`
- [x] **RoutePreview** (BD-MAP-04) - `/route-preview`, validates route draft and shows ETA/price
- [x] **OrderMapDraft** (BD-MAP-05) - `/order-map-draft`, writes local passenger order
- [x] **DriverMap** (BD-DRIVER-01) - `/driver-map`, lists/accepts local passenger orders; полноценный real-map rollout остаётся отдельным surface slice
- [x] **Storage boundary routines** (BD-AUTH-BOUNDARY-01) - `public/src/storage_boundary.js` clears user-scoped stores on local identity reset
- [x] **Service Worker update banner** - `public/src/sw-update.js`, mock `skipWaiting` handshake
- [x] **Role-based dispatch inside `/active-ride`** - `active_ride.js` imports `active_ride_passenger.js`; no separate `/active-ride-passenger` route

### Backend / Mini-Yonder status sync - 2026-09-02

| Layer | What is real now | What remains |
|---|---|---|
| **Shared data / API spine** | PostgreSQL-backed auth/session, orders, matching, Ride State, Ride events, history/receipts and chat persistence exist behind guarded seams. | PWA stays backend-OFF/local-first by default; auth/policy/deploy/activation gates remain. |
| **#3 Matching & Assignment** | Offers/select/assignment/Ride bootstrap are live. Conflict and recovery authority were hardened by #934, #936 and #938. | Passenger select-side ACK/ambiguous-outcome reconciliation remains #947. Dispatcher ranking/broadcast is a different #1 gap. |
| **#5 Ride State Machine** | Participant GET/PATCH and append-only `ride_events` are live. Passenger authoritative-first hydration/terminal reconciliation shipped in #940. | Global PWA backend activation is still gated. |
| **#6 Notification Service** | The durable Ride notification source ledger shipped in #944: `ride_events` and `notification_outbox` are written atomically for accepted Ride transitions. | Notification routes, worker/claim/lease/retry, Inbox feed, Push/Telegram/SMS/email and activation remain dark. Contract-first next step: #948. |
| **#8 History & Receipt** | Server history reads and write-once receipt path exist; client history/receipt anchor also exists. | Full product cutover still follows pilot activation gates. |
| **#2 Availability / #4 Route & Price / #7 Safety** | Target ADRs and client/UI foundations exist; Mapbox GL foundation and real `/map` are shipped on the PWA side. | Backend services remain dark; Redis, server Route & Price, remaining Mapbox surfaces and Safety runtime are future slices. |
| **#9 Monitoring & Audit** | Health/readiness, CI and repository checks exist. | `/metrics`, runtime fleet dashboard, alerts and operational audit surface remain incomplete. |

### Gaps that remain real

- [ ] **Mapbox rollout beyond `/map` + real Route & Price** - vendored Mapbox GL, token/CSP/SW foundation and real `/map` are shipped, but DriverMap/ActiveRide and other map surfaces still need dedicated rollout; geocoding, authoritative route distance/ETA and server pricing remain future work.
- [ ] **Backend pilot gates** - OTP delivery/rate limiting, session lifecycle and role policy, chat participant authorization, staging deploy/rollback and observability remain before PWA activation.
- [ ] **Passenger select ACK outcome reconciliation** - coherent success/409/5xx/transport ambiguity must converge through authoritative ACK/read-side recovery without a second local success source (#947).
- [ ] **Notification worker contract/runtime** - the source outbox exists, but claim/lease/retry/consumer semantics must be frozen before a dark worker is added (#948).
- [ ] **Driver no-show completion** - основной flow уже реализован; оставшиеся no-show/error/dispute состояния и product gaps отслеживаются в `docs/missing-screens.md`.
- [ ] **Client/PWA automated coverage** - `node scripts/check.mjs` and smoke scripts are the current client guards; broader client node:test/browser coverage remains technical debt. The `/server` layer already has node:test route/contract coverage and separate server CI.

---

## Phase 2 - Backend pilot / PWA cutover

Phase-1 backend code already exists. This phase is about hardening, validating and activating it per resource rather than creating a backend from zero.

- [x] **Phase-1 backend spine** - Fastify/PostgreSQL, ordered migrations, repository layer and guarded PWA seams
- [x] **Thin API client** - `public/src/api_client.js` exists; backend remains OFF by default
- [x] **Orders / matching / ride-state / polling / history foundations** - backend routes exist; module-specific pilot gates still apply
- [x] **Matching conflict/recovery authority** - #934, #936 and #938 enforce conflict-Ride linkage, PostgreSQL timestamp precision and recovery linkage
- [x] **Passenger authoritative Ride hydration** - #940 reads server state before backend-mode render and reconciles terminal state server-first
- [x] **Notification source outbox foundation** - #944 adds the durable same-transaction Ride notification source; this does not activate Notification Service
- [ ] **Passenger select ACK outcome reconciliation** - #947
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

> Notification note: the durable source outbox is already a shipped backend foundation (#944), but user-facing notification delivery remains future work. Do not count the source ledger as Web Push or as a shipped Notification Service.

---

## Phase 4 - Maps / Mapbox rollout

> Mapbox foundation is no longer a future stub. `mapbox-gl@3.25.0` is vendored, CSP/worker/connect boundaries are in place, a URL-restricted public token is committed for the GitHub Pages origin, and `/map` performs a real render-then-hydrate Mapbox render with a MapShell failure fallback. This does **not** mean the Mini-Yonder Route & Price service is shipped: `/route-price/*` is still dark, and most map surfaces, geocoding, authoritative route/ETA and pricing remain incomplete.

- [x] **BD-MAP-FOUND-01 foundation** - vendored Mapbox GL JS, config/token surface, CSP, SW integration and dark-safe loader/fallback
- [x] **BD-MAP-RENDER-MAP / BD-MAP-ACTIVATE** - `/map` real Mapbox render is active on GitHub Pages
- [x] **BD-MAP-01..05 screen flow** - MapHome, LocationPermission, RoutePicker, RoutePreview, OrderMapDraft exist; only `/map` has the first real Mapbox surface today
- [x] **BD-DRIVER-01 screen** - DriverMap exists, but remains a separate real-map rollout target
- [x] **MapShell fallback** - `public/src/mapbox/map_shell.js` remains the no-token/failure/unmigrated-surface fallback
- [x] **Marker & status layer foundations** - `driver_markers.js` (BD-MAP-FOUND-03), `trip_status_layer.js` (BD-MAP-FOUND-04) exist as foundation modules
- [ ] **Per-surface Mapbox rollout** - DriverMap, ActiveRide and remaining map-backed surfaces
- [ ] **Real geocoding / route line / pickup-dropoff coordinates / live positions**
- [ ] **Server Route & Price** - authoritative route distance, ETA, fare and traffic policy behind `/route-price/*`

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