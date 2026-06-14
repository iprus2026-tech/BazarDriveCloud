# BazarDriveCloud screen contracts

This document keeps the dispatcher development line grounded: every screen should have a Cloud Design render/frame, route, file path, state contract, actions, and acceptance checklist before implementation or audit work moves forward.

**BD-DOCS-01 status:** this file now reflects the current `main` code after the routines/storage-boundary audit. It is a docs snapshot of the app shell, route registry, storage ownership, and implemented mock-only taxi flow.

Parent tracking issue: #19

---

## 1. Dispatcher line

```text
Cloud Design render/frame
↓
Screen contract
↓
GitHub issue
↓
Feature branch
↓
Implementation
↓
node scripts/check.mjs
↓
Pull Request
↓
Review against Cloud Design
↓
Merge to main
```

Do not move a new screen from design to code unless the route, file path, state keys, actions, and acceptance checklist are explicit.

---

## 2. Current route registry

Registered in `public/src/app.js`.

| Route | Screen id | File | Current status |
|---|---|---|---|
| `/welcome` | BD-ONBOARDING-01 | `public/src/screens/welcome.js` | implemented |
| `/onboarding` | BD-ONBOARDING-01 | `public/src/screens/onboarding.js` | implemented |
| `/feed` | BD-FEED-01 | `public/src/screens/feed.js` | implemented |
| `/map` | BD-MAP-01 | `public/src/screens/map.js` | implemented, mock MapShell only |
| `/location-permission` | BD-MAP-02 | `public/src/screens/location_permission.js` | implemented, mock permission UX |
| `/driver-map` | BD-DRIVER-01 / BD-DRIVER-02 | `public/src/screens/driver_map.js` | implemented, mock orders only; `isDriverLineReady()` readiness gate (BD-DRIVER-02) |
| `/route-picker` | BD-MAP-03 | `public/src/screens/route_picker.js` | implemented, route draft store |
| `/route-preview` | BD-MAP-04 | `public/src/screens/route_preview.js` | implemented, route preview mock |
| `/order-map-draft` | BD-MAP-05 | `public/src/screens/order_map_draft.js` | implemented, creates local ride order |
| `/rules` | BD-RULES-01 | `public/src/screens/rules.js` | implemented |
| `/profile` | BD-PROFILE-01/02 | `public/src/screens/profile.js` | implemented, passenger + driver |
| `/new` | BD-COMPOSER-01 | `public/src/screens/composer.js` | implemented |
| `/respond` | BD-RESPOND-01 | `public/src/screens/respond.js` | implemented |
| `/chat` | BD-CHAT-01 | `public/src/screens/chat.js` | implemented |
| `/active-ride` | BD-RIDE-D/P | `public/src/screens/active_ride.js` | implemented, role dispatch by `?role=` |
| `/responses` | BD-RESPONSES-01 | `public/src/screens/responses.js` | implemented |
| `/trip-confirmation` | BD-CONFIRM-01 | `public/src/screens/trip_confirmation.js` | implemented |
| `/post` | BD-POST-01 | `public/src/screens/post_detail.js` | implemented |
| `/inbox` | BD-INBOX-01 | `public/src/screens/inbox.js` | implemented |
| `/receipt` | BD-RIDE-HISTORY-D-01 | `public/src/screens/trip_receipt.js` | implemented, driver completed-ride receipt by `?tripId=` |

### Shell invariants

| Invariant | Current contract |
|---|---|
| Hidden chrome | `/welcome`, `/onboarding`, `/active-ride`, `/trip-confirmation` hide tabbar and FAB. |
| FAB | Visible only on `/feed`. |
| Map tab | Tab button targets `/map`; `app.js` routes drivers to `/driver-map`, passengers/guests to `/map`. |
| Driver route guard | Driver mode redirects passenger order routes `/route-picker`, `/route-preview`, `/order-map-draft` to `/driver-map`. |
| Active ride role split | No `/active-ride-passenger` route. Passenger UI is rendered by `active_ride_passenger.js` inside `/active-ride?role=passenger`. |
| Real Mapbox | Not connected. Screens use DOM placeholders from `public/src/mapbox/map_shell.js`. |

---

## 3. Storage and routines boundary

The routines audit established `public/src/storage_boundary.js` as the authoritative place for user-scoped localStorage clearing. Screen contracts must not invent new keys without either adding a clear helper or explicitly marking the key as device/global.

### User-scoped keys cleared on local logout/reset

| Key | Owner |
|---|---|
| `bazardrive.ride_history.v1` | `public/src/ride_history.js` |
| `bazardrive.favorite_routes.v1` | `public/src/favorite_routes.js` |
| `bazardrive.favorite_route_notice.v1` | `public/src/favorite_routes.js` |
| `bazardrive.active_ride.v1` | `public/src/ride_state.js` |
| `bazardrive.chat.v1` | `public/src/screens/chat.js`, also written by active ride |
| `bazardrive.responses.v1` | `public/src/screens/respond.js`, `public/src/screens/chat.js` |
| `bazardrive.respond.v1` | `public/src/screens/respond.js` |
| `bazardrive.trip_confirmation.v1` | `public/src/screens/trip_confirmation.js`, `public/src/screens/chat.js` |
| `bazardrive.driver_handoff_snapshot.v1` | `public/src/screens/driver_handoff_snapshot.js` |
| `bazardrive.draft.v2` | `public/src/screens/composer.js` |
| `bazardrive.repeat_route.v1` | `public/src/repeat_route.js` |
| `bazardrive.route_draft.v1` | `public/src/screens/route_picker.js` |
| `bazardrive.order_form.v1` | `public/src/screens/order_map_draft.js` |
| `bazardrive.ride_orders.v1` | `public/src/mock_api.js` |
| `bazardrive.myposts.v1` | `public/src/mock_api.js` |
| `profileTripDemo` | passenger profile demo override |

`bazardrive.favorite_route_notice.v1` is transient copy for favorite-route repeat handoff. It is cleared by `clearFavoriteRoutes()` together with `bazardrive.favorite_routes.v1`.

### Not cleared by the user-scoped boundary

| Key | Reason |
|---|---|
| `bazardrive.user.v1` | Owned by `state.js`; handled by `user.reset()` in the calling flow. |
| `bazardrive.posts.v1` | Shared global mock feed cache. |
| `bazardrive.map_prefs.v1` | Device-level map preferences, not identity-scoped. |

---

## 4. Screen contracts

### BD-FEED-01 - Feed V2

| Field | Contract |
|---|---|
| Route | `/feed` |
| File | `public/src/screens/feed.js` |
| Data | `listFeedPosts()` from `mock_api.js`; merges seed feed + local ride-order posts. |
| Main states | All, trips, passenger requests, announcements, marketplace, empty filtered state. |
| Actions | Category chips, topbar plus, global FAB, card CTA to respond/chat/accept. |
| Acceptance | Route opens, tab highlights, FAB visible only here, filters work, no CSP/inline regressions. |

### BD-COMPOSER-01 - Composer V2

| Field | Contract |
|---|---|
| Route | `/new` |
| File | `public/src/screens/composer.js` |
| Storage | `bazardrive.draft.v2` |
| Data | `createFeedPost()` creates local authored feed posts. |
| Main states | Driver offer, passenger request, marketplace item, announcement, service, preview, validation error, draft saved, submit loading. |
| Actions | Save draft, preview/edit, publish, back to feed, switch type, autosave. |
| Acceptance | Five types render correct fields; draft survives reload; publish clears draft and returns to `/feed`. |

### BD-ONBOARDING-01 - Welcome + Onboarding V2

| Field | Contract |
|---|---|
| Routes | `/welcome`, `/onboarding` |
| Files | `welcome.js`, `onboarding.js` |
| Storage | `bazardrive.user.v1` via `state.js` |
| Main states | Welcome, role, phone, OTP mock, profile, car, documents, done passenger, done driver. |
| Actions | Begin, guest entry, role pick, phone mock, profile save, vehicle/docs save, finish. |
| Acceptance | Pending action survives onboarding; driver lands where the pending action expects. |

### BD-ONBOARDING-01 - Welcome render gate

| Field | Contract |
|---|---|
| Route | `/welcome` (router fallback for empty hash) |
| File | `public/src/screens/welcome.js` |
| Storage | `bazardrive.user.v1` — `welcomeSeen`, `role`, optional `notificationsEnabled`. No new persistence key. |
| Render-gate states | `welcome` (01A) → `role` (01B) → `permissions` (01C) → `loading` (01D) → routes by role; `error` (01E) reachable via the retry path from loading or via the `?step=error` preview. |
| State machine | Internal `step` variable rebuilds the section's `innerHTML` on each transition. The five steps share a single `.screen--ob` shell and the `.ob-state[data-ob-step="…"]` markup; hooks are stable across transitions. |
| Persistence rules | Only the explicit `Начать` → `Продолжить` flow stamps `welcomeSeen: true` and the chosen `role`. The `Войти` button stamps `welcomeSeen: true` only (defers role selection to the existing `/onboarding` screen). The `Разрешить позже` button takes the user past permissions without stamping `notificationsEnabled`; `Продолжить` on permissions stamps `notificationsEnabled: true`. No real geolocation / notification API is called. |
| Loading transition | Pure UI-only setTimeout (1200ms). No backend call, no fetch, no Mapbox preload. On timer fire: stamp `welcomeSeen` + `role`, consume any pending router action, then `go('/feed')` for passenger / `go('/driver-map')` for driver. |
| Returning user | When `user.get().onboarded === true`, the screen short-circuits before any render — `Promise.resolve().then(() => go(…))` routes the driver to `/driver-map` and everyone else to `/feed`. The deferred `go()` lets the router's current render pass complete before the next hashchange fires. |
| Render-gate preview | `?step=welcome\|role\|permissions\|loading\|error` forces a specific step without persisting any state. The `onboarded`-skip is also bypassed by the preview so designers can review each state on any account. Mirrors the `?state=…` and `?garage=…` preview conventions used by Profile. |
| DOM hooks | `[data-ob-step]` on the per-state root; `[data-ob-action]` on each button (`start`, `login`, `role-continue`, `perm-continue`, `perm-later`, `retry`); `[data-ob-role]` on each role card. The `Продолжить` button on the role step carries `disabled` + `aria-disabled="true"` until a role is picked. |
| CSS namespace | `.ob-*` (e.g. `.ob-state`, `.ob-brand-mark`, `.ob-role-card`, `.ob-benefit-row`, `.ob-permission-row`, `.ob-loading-mark`, `.ob-retry-state`, `.ob-actions`). Reuses the existing `--accent` / `--bg-*` / `--text-*` design tokens and the `.bd-btn` button shapes. `max-width: 430px`, safe-area-aware bottom action dock. |
| Out of scope | SMS / Telegram auth, real auth, backend verification, Mapbox preload, push notifications API call, payment, APK / Android packaging, moderation, driver document upload, large router rewrite, redesign of `/feed` / `/composer` / `/profile` / `/chat` / `/respond` / `/active-ride` / `/map`. The legacy `BD-ONBOARDING-01 Welcome + Onboarding V2` row above continues to cover the post-`Войти` `/onboarding` screen unchanged. |
| Acceptance | `node scripts/check.mjs` green; `node scripts/dispatcher.mjs` clean. Manual: `/welcome` lands on 01A; `Начать` → 01B; `Продолжить` disabled until role; passenger → `/feed` after `01D`; driver → `/driver-map` after `01D`; `Разрешить позже` still continues; retry from `01E` re-enters `01D`; returning users (`onboarded === true`) skip to `/feed` / `/driver-map`. No inline script/style; CSP unchanged. |

### BD-PROFILE-01 - Passenger profile

| Field | Contract |
|---|---|
| Route | `/profile` with passenger/guest role |
| File | `public/src/screens/profile.js` |
| Storage | `bazardrive.user.v1`, profile demo helpers, user-scoped stores read-only where needed. |
| Main states | Guest prompt, passenger dashboard, phone verification banner, stats, saved actions, safety. |
| Actions | Verify phone mock, edit profile, create ride, view inbox/history/favorites. |
| Entry points | **Notification bell** `#pfp-notif-btn` (topbar) → `go('/inbox')` (BD-NOTIF-01, reuse the `/inbox` hub — no separate `/notifications` route). **History menu row** `#pfp-menu-history` → `scrollIntoView` of the inline trip-history section `#profile-history-section` (BD-HISTORY-P-01 — **not** `/feed`). **Settings gear** `#pfp-settings-btn` is still inert (BD-SETTINGS-01, unshipped / design-gated). Pinned by `scripts/smoke-profile-notif-bell.mjs` and `scripts/smoke-profile-history-menu.mjs`. |
| Acceptance | Guest/passenger surfaces do not expose driver-only controls unless role switches. |

### BD-PROFILE-02 - Driver dashboard profile

| Field | Contract |
|---|---|
| Route | `/profile` with driver role |
| File | `public/src/screens/profile.js` |
| Storage | `bazardrive.user.v1`, driver document flags. |
| Main states | Overview, Taxi IP, Documents, Payouts, Safety. |
| Actions | Online toggle, driver/passenger mode, readiness checklist, document mock updates. |
| Entry points | **Notification quick-action row** `#pf2-act-notif` (the «Уведомления» row, renders a chevron) → `go('/inbox')` (BD-NOTIF-01). This replaced a prior `notificationsEnabled` toggle stub; there is **no driver notification bell** in the shipped profile. Pinned by `scripts/smoke-profile-notif-bell.mjs`. |
| Acceptance | Driver readiness gates Feed/Post Detail accept CTAs and `/driver-map` (BD-DRIVER-02): all accept surfaces now enforce `isDriverLineReady()` via the shared rule in `state.js`. |

### BD-PROFILE-D-05B - Driver Garage actions

| Field | Contract |
|---|---|
| Route | `/profile?role=driver` (Garage section sits inside `renderDriver`'s overview pane between Readiness and Permit). |
| File | `public/src/screens/profile.js` (`garageSectionHtml` + `wireGarageActions`). |
| Source | Legacy driver vehicle fields on the user record: `vehicleMake`, `vehicleModel`, `vehicleColor`, `vehiclePlate` (`public/src/state.js:50-54`). No persisted `garageVehicles[]`, no persisted `activeVehicleId`. |
| Derived view | Driven by `buildGarageVehicles(u, options)` (05C) — see the dedicated row below. Per-vehicle `<article class="pf2-garage__car" data-vehicle="${id}">`. Populated when `make+model` (or either alone) produce a non-empty model line; otherwise empty state ("Авто не добавлено" + `Добавить авто` CTA). |
| Action contract states | Each interactive control carries `data-garage-action="<name>"` + `data-garage-state="<state>"`. States are: **`add-ready`** ("Добавить авто" header CTA + empty-state CTA), **`edit-ready`** ("Редактировать", per vehicle), **`active-current`** ("Активна сейчас" — non-button `<span>` with `aria-disabled="true"`, no click handler, for the vehicle whose derived `status === 'active'`), **`make-active-local`** ("Сделать активной", non-active vehicles only — see 05C row), **`archive-confirm-local`** ("Архивировать" → two-step inline confirm inside `#pf2-garage-confirm-${id}` with `[Отмена]` / `[Подтвердить]`). |
| Confirm row | `#pf2-garage-confirm-${id}` (`data-garage-confirm="archive"`) is rendered `hidden`; archive opens it (`data-garage-confirm-state="open"`), final confirm marks `data-garage-confirm-state="scheduled-local"` and disables the button with label "Запланировано (демо)". Cancel resets to `idle`. |
| Persistence | **None.** `wireGarageActions` is strictly DOM-only — no `user.set`, no `localStorage.setItem`, no `saveActiveRide`, no `driverOnline` mutation, no `activeVehicleId`, no `selectedVehicleId`, no `garageVehicles[]` write, no router navigation. The smoke (`scripts/smoke-profile-driver-garage.mjs`) captures a `localStorage` snapshot before invoking each handler and asserts byte-equality after, with a parallel guard on the active-ride key. |
| Render-gate | `?garage=empty` forces the empty state for design preview without touching persisted vehicle fields (mirrors `?state=empty` for payouts in BD-PROFILE-D-03). |
| Constraints | No backend, no persisted multi-vehicle collection, no persisted `activeVehicleId`, no real CRUD, no driver-response snapshot mutation, no active-ride mutation, no Mapbox, no CSP weakening, no inline script/style. |
| Out of scope | Real add/edit/archive endpoints, persisted `activeVehicleId`, garage-driven driver-response snapshot, garage-driven active ride seed. Future slices (05D+) will own real CRUD and persisted active-vehicle selection; 05B locks the action surface contract and 05C the in-memory collection shape, before any data model lands. |
| Acceptance | `node scripts/check.mjs` green; `scripts/smoke-profile-driver-garage.mjs` covers the state hooks, the contract labels, the confirm flow, and the no-mutation guarantee end-to-end (snapshot diff). |

### BD-PROFILE-D-05C - Driver Garage collection mock

| Field | Contract |
|---|---|
| File | `public/src/screens/profile.js` (`buildGarageVehicles`, `garageVehicleCardHtml`, `garageSectionHtml`, `wireGarageActions`). |
| Builder | `buildGarageVehicles(u, options)` returns `[{ id, model, color, plate, status, source }]`. The legacy vehicle (when `make+model` or either alone produce a usable model line) lands as `{ id: 'legacy-1', source: 'legacy' }`. `?garage=empty` short-circuits to `[]`. `?garage=multi` (only when legacy is present) appends `{ id: 'demo-2', model: 'Kia Rio', color: 'белый', plate: '*** 125', source: 'mock' }` — preview-only, never persisted. The `status: 'active' \| 'available'` field is set by the resolver per BD-PROFILE-D-05D. |
| Active flag (05C baseline) | Derived UI state only — computed on every render. No legacy fields are flipped; the driver-response snapshot is unchanged. |
| Per-vehicle DOM IDs | Suffixed by vehicle id: `pf2-garage-edit-${id}`, `pf2-garage-active-${id}` (active span) / `pf2-garage-make-active-${id}` (non-active button), `pf2-garage-archive-${id}`, `pf2-garage-confirm-${id}`, `pf2-garage-archive-cancel-${id}`, `pf2-garage-archive-confirm-${id}`. The global `#pf2-garage-add` stays unsuffixed (single instance, header + empty-state CTA). The card carries `data-vehicle="${id}"`, `data-vehicle-status="active\|available"`, `data-vehicle-source="legacy\|mock"`. Section root carries `data-garage-collection-size="${n}"`. |
| Wiring | `wireGarageActions(root, vehicles)` iterates the `vehicles` list (not the DOM) so per-vehicle IDs are resolved deterministically under the smoke's DOM stub. Active vehicles skip the make-active wiring (the span has no click semantics). |
| Constraints | No persisted `selectedVehicleId`, no persisted `garageVehicles[]`, no driver-response snapshot mutation, no active-ride mutation. Active-vehicle persistence is owned exclusively by BD-PROFILE-D-05D under the `driverGarage` namespace. The smoke (`scripts/smoke-profile-driver-garage.mjs`) blocks all forbidden patterns in `buildGarageVehicles` / `garageSectionHtml` / `wireGarageActions` bodies and re-asserts the localStorage byte-equality guarantee across all non-make-active handlers in both single and multi states. |
| Acceptance | `node scripts/check.mjs` green; smoke covers builder shape (empty / single / multi), per-vehicle DOM hooks, active vs. non-active card variant (badge, status pill vs. make-active button), and the no-mutation guarantee for every non-make-active handler in the multi state. |

### BD-PROFILE-D-05D - Active vehicle selection persistence

| Field | Contract |
|---|---|
| Route | `/profile?role=driver` (Garage section in `renderDriver`'s overview pane). |
| File | `public/src/screens/profile.js` (`resolveActiveGarageVehicleId`, `buildGarageVehicles`, `wireGarageActions`, `refreshGarageSection`). |
| State | `profile.driverGarage.activeVehicleId` — string \| null. Default `null` from `buildDefaults` (`public/src/state.js`). Patched via `user.set({ driverGarage: { ...current, activeVehicleId: id } })` from the make-active click handler only. |
| Data source | `localStorage` key `bazardrive.user.v1` (existing user-record store). No separate storage key, no per-vehicle metadata persisted, no `selectedVehicleId` parallel field. |
| Resolver | `resolveActiveGarageVehicleId(profile, vehicles)`: returns the saved `activeVehicleId` when present in the rebuilt collection; otherwise falls back to the legacy vehicle (`source === 'legacy'`), then the first vehicle, then `null`. Safe under missing / stale id, empty / single / multi collections, and `?garage=multi` toggling off (the demo `demo-2` id stops resolving and the legacy card re-becomes active without crashing). |
| Render | `buildGarageVehicles` calls the resolver and stamps `status: 'active' \| 'available'` accordingly. The active card shows the "Активное" badge + non-button "Активна сейчас" span; non-active cards show the "Доступно" badge + "Сделать активной" button. |
| Click → persist → re-render | Clicking `#pf2-garage-make-active-${id}` persists `driverGarage.activeVehicleId = id` via `user.set` and calls `refreshGarageSection(root)`, which replaces the section element with a freshly-rendered one and re-wires the per-vehicle handlers. The badge moves to the selected card; the previously-active card becomes a make-active candidate. |
| `?garage=multi` interaction | The render-gate still appends the demo card without persistence. Clicking "Сделать активной" on `demo-2` persists `activeVehicleId: 'demo-2'`; on a subsequent render without `?garage=multi` the id becomes stale and the resolver safely falls back to `legacy-1`. |
| Out of scope | Driver response snapshot (owned by 05E), `/respond`, active ride / lifecycle, ride history, driver receipts, OSAGO / permit / documents, full vehicle CRUD, backend / API, Mapbox, CSP. |
| Constraints | `wireGarageActions` may call `user.set` ONLY for the make-active handler and ONLY to patch `driverGarage`. All other handlers (add / edit / archive / archive-cancel / archive-confirm) remain DOM-only. No direct `localStorage.setItem`, no `saveActiveRide` / `saveRideHistoryEntry` / `acceptCanonicalRideOrder` / `createRideOrder` calls, no router navigation, no `selectedVehicleId` / `saveActiveVehicle` parallel API, no `bazardrive.responses.v1` / `bazardrive.active_ride.v1` / `bazardrive.ride_history.v1` / `bazardrive.driver_receipts.v1` / `bazardrive.respond.v1` write. |
| Smoke coverage | `scripts/smoke-profile-driver-garage.mjs` scenarios S22–S28: make-active persists into `driverGarage.activeVehicleId`; re-render swaps the badge to the selected card and reverts the previous card to make-active; reload (`renderProfile` again) preserves the persisted active id; `?garage=multi` demo vehicle can become active and gracefully falls back to legacy when the preview is toggled off (stale id); empty / passenger renders never write `driverGarage`; non-make-active handlers stay byte-equal against `localStorage`; make-active writes ONLY to `bazardrive.user.v1` (no other storage key drifts). |
| Acceptance | `node scripts/check.mjs` green; smoke covers persistence, badge swap, stale-id fallback, namespace isolation, and the cross-storage no-leak guarantee. |

### BD-PROFILE-D-05E - Driver snapshot reads active garage vehicle

| Field | Contract |
|---|---|
| Files | `public/src/garage.js` (new shared module: `buildGarageVehicles`, `resolveActiveGarageVehicleId`, `resolveActiveGarageVehicle`), `public/src/screens/respond.js` (`getUserVehicle`), `public/src/ride_actions.js` (`buildAcceptedDriverSnapshot`), `public/src/screens/profile.js` (re-imports from `garage.js`). |
| Shared resolver | `resolveActiveGarageVehicle(u)` from `garage.js` calls `buildGarageVehicles(u)` with NO render-gate options and returns the resolved active vehicle (`{ id, model, color, plate, source }`) or `null`. The preview-only `demo-2` (which only exists under `?garage=multi` in /profile) is silently demoted to the legacy fallback in production, so the demo car can never reach a real response or handoff. |
| respond.js `getUserVehicle(u)` | Now reads model/plate/color from `resolveActiveGarageVehicle(u)` and returns the same legacy contract object (`{ id: 'user_vehicle', name, plate, color, seats: 4, features: 'кондиционер' }`). Preserves the existing null-bail when `vehicleMake / vehicleModel / vehiclePlate` are missing so partially-onboarded drivers still fall through to the demo path. The submit-time `driverSnapshot` (built from `vehicle.name/color/plate`) inherits the new source automatically. |
| ride_actions.js `buildAcceptedDriverSnapshot(u)` | Now reads the vehicle sub-object (`{ model, color, plate }`) from the resolver while the driver identity (`name` / `initials` / `rating`) continues to flow from the legacy profile fields. Plate is still passed through `maskDriverPlate` so the masked Russian-plate format is preserved. The existing null-bail (rawName / model / plate / color all empty) is preserved so empty profiles still fall through to `createDemoActiveRide` demo defaults. |
| Read-only contract | The resolver and both consumer functions are STRICTLY read-only: no `user.set`, no `localStorage.setItem`, no `driverGarage` mutation, no `activeVehicleId` write, no lifecycle write (no `saveActiveRide` / `saveRideHistoryEntry` / `acceptNearbyOrder` / `createRideOrder` / `acceptCanonicalRideOrder`), no router navigation. Cross-surface storage-key literals (`bazardrive.responses.v1`, `active_ride.v1`, `ride_history.v1`, `driver_receipts.v1`, `respond.v1`) are forbidden in both consumer bodies by the smoke source guard. |
| Out of scope | No persisted `activeVehicleId` mutation (writing stays owned by 05D's make-active handler); no driver-response submit flow changes beyond the source swap; no accept / status-transition behavior changes in ride_actions.js; no active-ride / lifecycle / history / receipt write; no Mapbox / CSP / inline script-style changes. |
| Smoke coverage | `scripts/smoke-driver-snapshot-active-garage.mjs` — S1 default driver (legacy fallback) returns the resolved vehicle through both call sites; S2 stale `demo-2` falls back to legacy in production; S3/S4 null-bail preserved; S5 vehicle subfield from resolver + driver identity unchanged + plate masked; S6 stale `demo-2` does not leak demo plate into the handoff snapshot; S7 empty profile null-bail preserved; S8 byte-equality across 5x snapshot reads + cross-surface keys never written; S9 source guards prove both consumers call `resolveActiveGarageVehicle`, import from `garage.js`, and avoid the full forbidden list. `scripts/smoke-profile-driver-garage.mjs` S16 source guards updated to extract the moved derive helpers (`resolveActiveGarageVehicleId`, `buildGarageVehicles`, `resolveActiveGarageVehicle`) from `garage.js` instead of `profile.js`. |
| Acceptance | `node scripts/check.mjs` green (both garage smokes registered); `node scripts/dispatcher.mjs` clean. Production behaviour is unchanged (the resolver returns the legacy vehicle in real renders), but the architecture now flows the active vehicle through a single shared resolver so future slices (real CRUD, second real vehicle) propagate to /respond and the handoff snapshot automatically. |

### BD-PROFILE-D-05F - Driver Garage persisted vehicle collection

| Field | Contract |
|---|---|
| Storage source | `profile.driverGarage.vehicles` (`public/src/state.js` v11 default `[]`) — array of `{ id, model, color, plate, source }` records. Normalised on every load and `user.set` via `normalizeDriverGarage(state)`: a missing or malformed `driverGarage` becomes `{ activeVehicleId: null, vehicles: [] }`; non-array `vehicles` becomes `[]`; non-string `activeVehicleId` becomes `null`. |
| Active source | `profile.driverGarage.activeVehicleId` (owned by BD-PROFILE-D-05D). |
| Resolver | `buildGarageVehicles(u, options)` in `public/src/garage.js`. Reads the persisted collection via `readPersistedGarageVehicles(profile)` (which drops malformed entries via `normalisePersistedVehicle` and de-dupes by id) and uses it when non-empty. Otherwise falls back to a single-entry legacy list derived from `vehicleMake / vehicleModel / vehicleColor / vehiclePlate`. `?garage=multi` overlays the preview-only `demo-2` card on top of whichever source produced the list. `resolveActiveGarageVehicleId(profile, vehicles)` then stamps `status: 'active' \| 'available'`. |
| Fallback order | 1) valid persisted `driverGarage.vehicles` (after normalisation), 2) legacy-derived single-vehicle list (`{ id: 'legacy-1', source: 'legacy' }`), 3) empty `[]` → garage renders the empty state. |
| Active-id resolution | If the saved id matches a vehicle in the rebuilt collection → that vehicle is active. Else fall back to the legacy entry (`source === 'legacy'`), then to the first vehicle, then to `null`. The saved id is never cleared by the resolver. |
| Persistence guardrail | **Render is strictly read-only against `driverGarage.vehicles`.** The legacy-fallback path is **in-memory only** — `buildGarageVehicles` and `wireGarageActions` never persist the synthesised legacy entry back into `driverGarage.vehicles`. The make-active handler keeps writing **only** `activeVehicleId` and explicitly spreads the existing `driverGarage` (preserving the vehicles array). No CRUD path lands in 05F. |
| Out of scope | Vehicle Add / Edit / Archive CRUD (lands in 05G+), vehicle documents / ОСАГО / permit, driver-response snapshot schema changes, active ride / ride lifecycle / history / receipt writes, backend / API, Mapbox, CSP / inline script-style. |
| Smoke coverage | `scripts/smoke-profile-driver-garage.mjs` S29–S38: default empty `vehicles`, persisted-collection overrides legacy fields, multi-vehicle persisted collection with `activeVehicleId` routing, stale id falls back to the first persisted vehicle (not to legacy), malformed entries dropped + de-duped, empty array falls back to legacy, render does NOT auto-init `vehicles`, make-active preserves the persisted array byte-for-byte, `?garage=multi` preview overlay does NOT persist, passenger profile unaffected. `scripts/smoke-driver-snapshot-active-garage.mjs` S10–S14: persisted real-2 surfaces in `/respond getUserVehicle` (legacy car suppressed), in `ride_actions buildAcceptedDriverSnapshot` (masked plate derived from the persisted plate), empty collection falls back to legacy for both consumers, persisted `driverGarage` byte-equal after 5× snapshot reads, stale id falls back to first persisted vehicle. |
| Acceptance | `node scripts/check.mjs` green; `node scripts/dispatcher.mjs` clean. End-to-end: `driverGarage.vehicles = [legacy-1, real-2]` + `activeVehicleId = 'real-2'` → /profile renders real-2 active, /respond `driverSnapshot.vehicle` reflects real-2, ride_actions handoff `snapshot.vehicle` reflects real-2, active-ride lifecycle untouched. |

### BD-PROFILE-D-05G - Add vehicle sheet / local draft only

| Field | Contract |
|---|---|
| UI action | "Добавить авто" CTA (`#pf2-garage-add`) — both the populated-state header link (`+ Добавить`) and the empty-state primary CTA — now opens the add-vehicle draft sheet (`#pf2-garage-add-sheet`). The 05B "Доступно в следующем шаге" flash placeholder is retired on the add path. |
| Sheet markup | Rendered as a sibling of the garage cards inside the section, starts `hidden` with `data-garage-add-state="closed"`. Open flips both attributes. The sheet contains three text inputs (`#pf2-garage-add-model` required, `#pf2-garage-add-color` optional, `#pf2-garage-add-plate` optional), a "Сделать активной" checkbox (`#pf2-garage-add-make-active`), an inline error paragraph (`#pf2-garage-add-error` starts `data-garage-add-state="idle"`), a primary save button (`#pf2-garage-add-save`, `data-garage-state="add-save-local"`), a secondary cancel button (`#pf2-garage-add-cancel`, `data-garage-state="add-cancel-local"`), a header × close (`#pf2-garage-add-close`), and a backdrop close target (`#pf2-garage-add-backdrop`). All three close surfaces invoke the same reset+hide handler. |
| Draft-only invariant | Typing into any input does NOT touch storage. Cancel / × / backdrop-click do NOT touch storage. The draft is reset on every open and every close so a previous unsaved draft cannot survive a navigation round-trip. |
| Validation | A trimmed empty `model` blocks the save: the error paragraph flips to `data-garage-add-state="invalid"` and becomes visible, the sheet stays open, no storage write happens. `color` and `plate` are optional. Both gating layers (`profile.js` sheet handler and `state.js appendGarageVehicle`) enforce the trim. |
| Save persistence | The save button calls `appendGarageVehicle({ model, color, plate }, { makeActive })` exported from `public/src/state.js`. The helper trims fields, generates a collision-free id (`vehicle-${N}` skipping any used id), hard-codes `source: 'persisted'` (never copied from user input), appends to `driverGarage.vehicles` via `[...vehicles, newVehicle]`, patches `activeVehicleId` to the new id IFF `makeActive === true`, and runs through `normalize()` + `persist()`. Returns the new id (or `null` on validation refusal). |
| Active selection | `makeActive` defaults to false → existing `activeVehicleId` is preserved verbatim. When the toggle is on, the new vehicle becomes active and the previous selection moves to a make-active candidate via the existing 05D render path on the next refresh. |
| Re-render | After a successful save the sheet closes (resetting the draft) and `refreshGarageSection(root)` rebuilds the section so the new card appears immediately. The new vehicle is placed at the end of the persisted array, so it lands as the last card in the list. |
| Legacy semantics | Per 05F, once `driverGarage.vehicles` is non-empty it becomes the source of truth and the legacy-derived `legacy-1` fallback no longer renders. The legacy `vehicleMake/Model/Plate/Color` fields are preserved on the user record (not wiped, not migrated) — they only re-appear in the garage when the persisted collection drops back to empty. |
| Out of scope | Vehicle Edit (5H/05I), Archive (05I), vehicle documents / ОСАГО / permit (05J+), readiness hooks, backend / API, driver-response schema changes, active ride / ride lifecycle / history / receipt writes, Mapbox, CSP, inline script-style. |
| Safe helper | `appendGarageVehicle(rawVehicle, options)` is the single allowed write path for `driverGarage.vehicles` in 05G. Other future writers (edit, archive) should follow the same pattern (narrow function in `state.js` with hard-coded internal fields and trimmed inputs) rather than letting callers do partial shallow-merge patches against `driverGarage`. |
| Smoke coverage | `scripts/smoke-profile-driver-garage.mjs` S39–S53: sheet markup hooks (S39); open does not write (S40); typing does not write (S41); cancel / × / backdrop reset draft (S42); blank model save is blocked, error flips to `invalid`, sheet stays open (S43); whitespace-only model is blocked (S44); valid save trims fields, sets `source: 'persisted'`, appends one entry, preserves activeVehicleId by default, leaves legacy fields intact (S45); post-save render reflects only the persisted collection per 05F (S46); makeActive toggle promotes the new vehicle (S47); sequential saves keep ids unique (S48); pre-existing `vehicle-1` id collision is skipped (S49); cross-surface keys never written (S50); existing persisted vehicles preserved byte-for-byte (S51); passenger profile does not render the sheet (S52); static source guard on `appendGarageVehicle` body (S53). |
| Acceptance | `node scripts/check.mjs` green; `node scripts/dispatcher.mjs` clean. Manual: open garage → click `+ Добавить` → sheet opens → cancel keeps `vehicles` untouched → reopen → blank model blocked → fill draft → save → new card renders, `driverGarage.vehicles` grew by one with `source: 'persisted'`, legacy fields and other storage keys unchanged. |

### BD-PROFILE-D-05H - Edit vehicle sheet / local draft only

| Field | Contract |
|---|---|
| UI action | Per-vehicle "Редактировать" button (`#pf2-garage-edit-${id}`). For persisted vehicles (`source !== 'legacy'`) the button opens the edit-vehicle draft sheet (`#pf2-garage-edit-sheet`), pre-filled from the card. For the legacy-fallback vehicle (`source === 'legacy'`) the button keeps the 05B "Доступно в следующем шаге" local-feedback flash — editing legacy would otherwise fabricate a persisted entry from legacy fields (explicit 05H out-of-scope). |
| Sheet markup | Rendered as a sibling of the 05G add sheet inside the section, starts `hidden` with `data-garage-edit-state="closed"`. Open flips both attributes and stamps `data-edit-vehicle-id="${vehicle.id}"` on the sheet so the save handler knows which entry to patch. Contains three text inputs (`#pf2-garage-edit-model` required, `#pf2-garage-edit-color` optional, `#pf2-garage-edit-plate` optional), an inline error paragraph (`#pf2-garage-edit-error` starts `data-garage-edit-state="idle"`), a primary save button (`#pf2-garage-edit-save`, `data-garage-state="edit-save-local"`), a secondary cancel (`#pf2-garage-edit-cancel`, `data-garage-state="edit-cancel-local"`), a header × close (`#pf2-garage-edit-close`), and a backdrop close target (`#pf2-garage-edit-backdrop`). No "Сделать активной" toggle — out of scope per 05H. |
| Draft-only invariant | Typing into any field does NOT touch storage. Cancel / × / backdrop-click do NOT touch storage. The draft is reset on every open (re-prefilled from the card) and on every close (cleared), and `data-edit-vehicle-id` is removed on close so a stray save click against a closed sheet cannot match a vehicle. |
| Validation | A trimmed empty `model` blocks the save: the error paragraph flips to `data-garage-edit-state="invalid"` and becomes visible, the sheet stays open, no storage write happens. Both layers (sheet handler in `profile.js` and `patchGarageVehicle` in `state.js`) enforce the trim. |
| Save persistence | The save button calls `patchGarageVehicle(vehicleId, { model, color, plate })` exported from `public/src/state.js`. The helper trims the three fields, refuses a missing/unknown id or a blank model with `null`, replaces the matched entry in `driverGarage.vehicles` at the same index via `[...vehicles]` + `nextVehicles[idx] = patched`, preserves `id` (never copied from `rawPatch`), preserves `source` when the existing value is in the known whitelist (`persisted` / `legacy` / `mock`) and normalises to `'persisted'` otherwise (never copied from `rawPatch.source`), preserves unknown / future fields via `...prev` spread, and **always** preserves `activeVehicleId` verbatim. Returns the patched id (or `null` on validation refusal). |
| Active selection | Editing the active vehicle does NOT change `activeVehicleId` (the id is preserved by the patch). Editing a non-active vehicle does NOT make it active. The sheet has no make-active toggle. |
| Re-render | After a successful save the sheet closes (resetting the draft + clearing `data-edit-vehicle-id`) and `refreshGarageSection(root)` rebuilds the section so the updated card appears immediately at the same position in the list. |
| Legacy semantics | The legacy-fallback `vehicleMake / vehicleModel / vehicleColor / vehiclePlate` user fields are NEVER written by the edit path. Clicking edit on a legacy-fallback card runs the 05B flash and does not open the sheet. The persisted vehicles array, the legacy fields, and `activeVehicleId` are all preserved across any blocked edit (cancel, validation, defensive id-rejection). |
| Out of scope | Vehicle Archive (05I), vehicle documents (05J+), readiness hooks, backend / API, driver-response schema changes, active ride / ride lifecycle / history / receipt writes, Mapbox, CSP, inline script-style. No `activeVehicleId` mutation. No id editing. No `source` copy from user input. |
| Safe helper | `patchGarageVehicle(vehicleId, rawPatch)` is the single allowed write path for `driverGarage.vehicles` in 05H (alongside `appendGarageVehicle` from 05G). Future writers (archive, sort, drag-reorder) should follow the same narrow-helper-in-`state.js` pattern. |
| Smoke coverage | `scripts/smoke-profile-driver-garage.mjs` S54–S67: edit sheet markup hooks; per-vehicle edit opens prefilled sheet without write; typing does not write; cancel / × / backdrop reset draft and hide sheet; blank model + whitespace-only blocked with error surface; valid save patches one entry (id preserved, fields trimmed, source preserved, array order preserved, other vehicles byte-equal, `activeVehicleId` preserved, legacy fields untouched); editing non-active vehicle leaves `activeVehicleId` unchanged; defensive helper calls reject unknown / empty / null id and whitespace model without writing; legacy-fallback edit keeps the flash and does not open the sheet; cross-surface storage keys never written; source guard against `rawPatch.source` and `rawPatch.id` hijack; static source guard on the helper body. |
| Acceptance | `node scripts/check.mjs` green; `node scripts/dispatcher.mjs` clean. Manual: seed two persisted vehicles → click Редактировать → sheet opens prefilled → cancel keeps both unchanged → reopen → blank model blocked → fill new draft → save → only the edited card changed (id + array order + other entries preserved), `activeVehicleId` unchanged, legacy fields untouched. |

### BD-PROFILE-D-05I - Driver Garage archive vehicle semantics

| Field | Contract |
|---|---|
| UI action | Per-vehicle "Архивировать" button (`#pf2-garage-archive-${id}`) opens the existing 05B inline confirm row (`#pf2-garage-confirm-${id}`). The confirm row now carries a separate title ("Архивировать авто?") and helper text ("Авто останется в гараже, но не будет использоваться для заказов."), with primary action "Архивировать" and secondary "Отмена". The 2-step confirm UX from 05B/05C is preserved end-to-end. |
| Helper | `archiveGarageVehicle(vehicleId)` in `public/src/state.js`. Trims the incoming id (mirrors `patchGarageVehicle`'s normalisation), strict-matches against trimmed stored ids, falls back to the synthesised `garage-${N}` route for id-less raw slots, and returns the canonical trimmed id on success (null on validation refusal or unknown id). Soft-delete only: the matched entry gains `archived: true` via `...prev` spread (every other field is preserved); the array order is preserved; no hard delete / splice. |
| Active-vehicle handling | When the archived id equals the persisted `activeVehicleId` (after trimming both sides), the helper clears `driverGarage.activeVehicleId` to null. Active-vehicle archive is **allowed**. The helper does NOT promote another vehicle to active automatically; per the BD-PROFILE-GARAGE-ARCHIVE-I2 contract alignment below, the **resolver also does NOT silently promote** — the user must explicitly click «Сделать активной» on a remaining card. Archiving a non-active vehicle leaves `activeVehicleId` verbatim. |
| Resolver / render filter | `garage.js buildGarageVehicles` filters `archived === true` entries out of the active list **before** the multi-overlay and resolver run. `resolveActiveGarageVehicleId`, `resolveActiveGarageVehicle`, the profile render, the /respond `getUserVehicle`, and the ride_actions accept handoff snapshot therefore never surface an archived vehicle. **Codex P3 follow-up (#493):** the legacy fallback runs only when there is no valid persisted garage collection at all (`rawAll.length === 0`). When the persisted collection contains entries (even if every entry is archived), `buildGarageVehicles` returns `[]`, no `legacy-1` is synthesised, no active badge is rendered, and `resolveActiveGarageVehicle` returns `null`. The archived hint and the 05J restore section continue to render through their own helpers (`countArchivedGarageVehicles` / `listArchivedGarageVehicles`). Documents/readiness foundation is now wired through the read-only BD-PROFILE-GARAGE-READY-K hook; full documents implementation and readiness scoring remain deferred. |
| Archived count | `countArchivedGarageVehicles(u)` in `garage.js` walks the raw persisted vehicles array and counts entries with `archived === true`. The garage section root exposes the count on `data-garage-archived-count="${n}"` and renders a `<p class="pf2-garage__archived-hint">В архиве: N</p>` under the active cards when N > 0. |
| Idempotent | Archiving an already-archived id is a no-op write (the `archived` flag is unchanged) but still runs the active-clear branch — defensive against an earlier writer that flipped `archived` without clearing the active selection. |
| Edit interaction | The edit button is never wired for an archived vehicle (the card is filtered out of the render). `patchGarageVehicle` preserves the `archived` flag via the `...prev` spread, so calling it directly against an archived entry still works without flipping its archival state. |
| Out of scope | Restore-from-archive (deferred to 05J+), hard delete, archived-list collapse / view, vehicle documents, readiness hooks, driver-response schema changes, active ride / ride lifecycle / history / receipt writes, backend / API, Mapbox, CSP, inline script-style. |
| Smoke coverage | `scripts/smoke-profile-driver-garage.mjs` S75–S86 + S13 confirm-copy update: helper writes `archived: true` and preserves all other fields + array order; render filters archived from the active list and surfaces `data-garage-archived-count` + the "В архиве: N" hint; archiving the active vehicle clears `activeVehicleId`; archiving a non-active vehicle preserves it; full confirm-flow click path produces the same result; cancel does not archive; defensive helper rejects unknown / whitespace / null / out-of-range ids; trim-aware strict match and synthesised-id fallback work; idempotent archive still runs active-clear; `patchGarageVehicle` preserves the archived flag; cross-surface storage keys never written; passenger profile excluded; static source guard on the helper body. `scripts/smoke-driver-snapshot-active-garage.mjs` S15–S16: archived persisted entries are invisible to `/respond getUserVehicle` and `buildAcceptedDriverSnapshot`; the resolver falls back to legacy when the only persisted entry is archived. |
| Acceptance | `node scripts/check.mjs` green; `node scripts/dispatcher.mjs` clean. Manual: seed a driver with an active persisted vehicle → click Архивировать → confirm → card disappears from the active list, "В архиве: 1" hint appears, `activeVehicleId` becomes null, the archived entry remains in `driverGarage.vehicles` with `archived: true`. /respond and ride_actions snapshots no longer surface the archived vehicle. |

### BD-PROFILE-GARAGE-ARCHIVE-I2 - Archive contract alignment + no-active garage guard

| Field | Contract |
|---|---|
| Scope | Contract-alignment slice (not a new product feature). Aligns docs, smoke, and the Driver Garage no-active runtime/render behavior with the shipped archive contract: archive is soft-delete only; archive of the active vehicle is **allowed** and clears `activeVehicleId`; no silent promotion picks a replacement; archived vehicles are hidden from the default active garage list and are not selectable as active; legacy fallback archive materialises the fallback so it does not resurrect on next render. Restore (05J) shape is preserved verbatim. |
| Driver Garage source of truth | Persisted under `profile.driverGarage.vehicles[]` (`public/src/state.js` v11 default `[]`). Soft archive only — `archived: true` flag, never spliced. |
| Active archive behavior | Archiving the active vehicle is allowed; `archiveGarageVehicle` clears `driverGarage.activeVehicleId` to `null`. Archiving a non-active vehicle preserves `activeVehicleId` verbatim. The archive write touches **only** `bazardrive.user.v1`. |
| No silent promotion | `resolveActiveGarageVehicleId` no longer auto-promotes the first non-restored persisted vehicle when `activeVehicleId` is null/empty/stale. Resolution order: (1) saved id matches a non-archived vehicle → active; (2) synthesised legacy fallback (`_synthesized === true`, only when persisted is empty and no archived legacy materialisation exists) → active; (3) otherwise → null. The previous first-eligible branch is removed so the contract is consistent end-to-end (archive clears `activeVehicleId`, resolver does NOT pick a replacement). |
| No-active garage render | When `resolveActiveGarageVehicleId` returns null, `buildGarageVehicles` marks every non-archived vehicle with `status: 'available'` (no `'active'` status assigned). The profile render therefore emits no `#pf2-garage-active-${id}` span; every persisted card renders «Сделать активной». The user must explicitly click to choose an active vehicle. Archived vehicles continue to render only inside the dedicated `<section class="pf2-garage__archived-section">` (05J restore surface), never as an active card. |
| Legacy fallback non-resurrection | When the user archives the synthesised legacy fallback (`legacy-1` from `vehicleMake/Model/Color/Plate` user fields), `archiveGarageVehicle` materialises the legacy entry into `driverGarage.vehicles` with `archived: true`. The next render's `buildGarageVehicles` sees `rawAll.length > 0` and suppresses the legacy fallback synthesis, so the card does not resurrect as active. **Codex P2 follow-up (#493):** the same rule applies whenever a real persisted garage record exists, even when every entry is archived — `buildGarageVehicles` returns `[]` and `resolveActiveGarageVehicle` returns null. The legacy user fields are preserved on the user record (never wiped) — they just no longer drive the garage render once the user has touched the persisted collection. |
| Accept/handoff snapshot legacy suppression | **Codex P2 follow-up (#493):** `buildAcceptedDriverSnapshot` (`public/src/ride_actions.js`) and `getUserVehicle` (`public/src/screens/respond.js`) now respect the same legacy-suppression rule. When `resolveActiveGarageVehicle(u)` returns null AND `u.driverGarage.vehicles` is a non-empty array, the snapshot does NOT fall back to `vehicleMake / vehicleModel / vehicleColor / vehiclePlate`. The empty / never-touched garage path (no persisted record at all) keeps the legacy fallback so partially-onboarded drivers still surface their car. This prevents an archived legacy car (whose fields are intentionally preserved on the user record after archive) from being published in the accept handoff snapshot even though `/respond` and the garage resolver report no active vehicle. **Codex P2 round 2 (#493):** in the no-active + garage-present path, the snapshot emits **non-falsy neutral placeholders** — `vehicle.model = 'Авто не выбрано'`, `vehicle.plate = 'номер не выбран'` — so the passenger surfaces' `vehicle.model || 'Toyota Camry'` / `vehicle.plate || …` fallback chains cannot replace empty strings with demo-car copy. Explicit active vehicle wins; legacy-only profile keeps the old fallback. |
| Out of scope | Documents / readiness implementation (deferred — see BD-PROFILE-GARAGE-READY-K for the read-only bridge), document status logic, vehicle readiness scoring, backend / API, real Mapbox, active ride lifecycle changes, response snapshot schema changes, restore (05J shape preserved unchanged), `bazardrive.active_ride.v1` / `responses.v1` / `ride_history.v1` / `driver_receipts.v1` / `respond.v1` writes, CSP, dispatcher. |
| Smoke coverage | `scripts/smoke-profile-driver-garage.mjs` — S32 / S110 / S114 updated to expect no silent promotion (stale id + persisted, null saved + persisted, post-clear marker → resolver returns null and cards render as make-active candidates); new I2 docs/source contract pins (the screen-contracts row carries the required phrases), active-archive render guard (real-1 active + real-2 non-active → archive real-1 → no active badge anywhere, real-2 renders as make-active candidate, archived hidden from active list), resolver no-active guard (`buildGarageVehicles` has no `status === 'active'`, `resolveActiveGarageVehicle` returns null), legacy fallback non-resurrection guard (archive legacy → re-render → no legacy active card), non-scope source guard on `public/src/garage.js` (no Mapbox / active_ride / respond / documents / readiness imports). `scripts/smoke-driver-snapshot-active-garage.mjs` S14 updated — stale id resolves to null in `getUserVehicle`. |
| Acceptance | `node scripts/check.mjs` green; `node scripts/dispatcher.mjs` clean. Manual: seed driver with `{ activeVehicleId: 'real-1', vehicles: [real-1, real-2] }` → archive real-1 → re-render → both cards previously visible now show only real-2 in the active list, no active badge anywhere, real-2 carries «Сделать активной», archived hint "В архиве: 1" appears, `activeVehicleId === null`. /respond `getUserVehicle` returns null until the user clicks «Сделать активной» on real-2. |

### BD-PROFILE-GARAGE-READY-K - Driver Garage readiness/documents hook foundation

| Field | Contract |
|---|---|
| Scope | Read-only **bridge between Driver Garage and the future documents/readiness implementation**. First slice. NOT real document storage, NOT real upload, NOT readiness scoring, NOT a backend. The hook answers a single question — "which vehicle (if any) is the document/readiness anchor right now?" — so the upcoming documents work knows where to attach when it lands. Naming note: this slice is **BD-PROFILE-GARAGE-READY-K**; it does NOT rename or disturb BD-PROFILE-D-05J Restore archived garage vehicle. |
| Helpers | `getGarageReadinessState(u)` and `resolveGarageReadinessVehicle(u)` in `public/src/garage.js`. Both are strictly read-only against `profile.driverGarage` and the legacy `vehicleMake / Model / Color / Plate` fields — no `user.set`, no `localStorage.setItem`, no archive / restore / make-active calls, no cross-surface writes, no document/readiness state mutation. |
| State + reason matrix | `getGarageReadinessState(u)` returns `{ state, vehicle, reason }`. State + reason cover five disjoint cases: (1) **active_vehicle / explicit_active** — saved `activeVehicleId` matches a non-archived persisted vehicle (this includes a materialised / restored legacy-source vehicle the user explicitly picked; persisted records never carry the `_synthesized` marker through `normalisePersistedVehicle`); (2) **active_vehicle / legacy_fallback** — synthesised read-only legacy fallback only (the in-memory entry `buildGarageVehicles` stamps with `_synthesized: true` when there is no persisted record at all and legacy `vehicleMake / Model / Color / Plate` fields exist); (3) **no_active_vehicle / no_active_selection** — at least one non-archived **normalised** persisted entry exists but no active selection; (4) **no_active_vehicle / archived_only** — every **normalised** persisted entry is archived (archived-only is INTENTIONALLY `no_active_vehicle`, NOT `empty_garage`); (5) **empty_garage / empty_collection** — no normalised selectable persisted record AND no synthesised legacy fallback (so malformed persisted records that `normalisePersistedVehicle` drops are treated as empty for READY-K — there is no card to pick or restore). **Codex P2-1 follow-up (#494):** classification follows the same normalised garage truth as `buildGarageVehicles` / `resolveActiveGarageVehicle`, not the raw `driverGarage.vehicles.length`. **Codex P2-3 follow-up (#494):** the `legacy_fallback` reason is reserved for the synthesised entry (`vehicle._synthesized === true`); materialised / restored legacy-source vehicles selected via make-active report `explicit_active`. |
| UI hint | `garageReadinessHintHtml(u)` in `public/src/screens/profile.js` renders a single read-only `<section id="pf2-garage-ready" class="pf2-card pf2-garage-ready" data-garage-ready-state="…" data-garage-ready-reason="…">` inside the Documents pane. Three copy variants: **«Документы активного авто»** (active — shows model / plate + "Готовность документов будет привязана к этой машине."), **«Выберите активное авто»** (no-active — "Документы и готовность не привязываются, пока активная машина не выбрана."), **«Добавьте авто»** (empty — "После добавления машины здесь появится связь с документами."). No inputs, no click handlers, no `data-garage-action` markers — the future documents implementation owns those when it lands. **Codex P2-2 follow-up (#494):** the Documents pane is rendered once per profile mount and tab clicks only toggle pane classes, so the hint would keep the stale `u` snapshot across garage mutations. `refreshGarageSection(root)` now also calls `refreshGarageReadinessHint(root)` after every in-place rebuild (add / make-active / archive / restore / edit), which reads fresh `user.get()`, re-renders the `<section id="pf2-garage-ready">` markup, and swaps it in place. The helper is itself strictly read-only (no `user.set`, no `localStorage.setItem`, no writers, no click handlers, no `data-garage-action` markers); when the Documents pane is not mounted (e.g. passenger profile), it short-circuits on the missing anchor. |
| Archived active flow | After the user archives the active vehicle, `archiveGarageVehicle` clears `activeVehicleId` and the resolver returns `null` per BD-PROFILE-GARAGE-ARCHIVE-I2. `getGarageReadinessState` then returns `no_active_vehicle / no_active_selection` (or `archived_only` when every entry is archived). The hint flips to «Выберите активное авто» / «Добавьте авто» as appropriate, in place via `refreshGarageReadinessHint` (Codex P2-2). Other available vehicles are NEVER silently used as the document anchor; the archived vehicle is NEVER used. |
| Legacy fallback compatibility | When there is no persisted garage collection and legacy `vehicleMake / Model / Color / Plate` fields exist, `resolveActiveGarageVehicle(u)` returns the synthesised legacy entry (`vehicle._synthesized === true`). The hook surfaces that vehicle as the document anchor (`state: 'active_vehicle'`, `reason: 'legacy_fallback'`). Strictly read-only — no `driverGarage.vehicles` write, no migration of legacy fields into the persisted collection. **Codex P2-3 follow-up (#494):** if the user later archives the synthesised legacy card, that materialises a real persisted `legacy-1` record (with `source: 'legacy'` but NO `_synthesized` marker). After a restore + explicit «Сделать активной», the hook correctly reports `explicit_active`, NOT `legacy_fallback` — `legacy_fallback` stays reserved for the synthesised-only path so future docs/readiness code can distinguish "the driver picked a real vehicle that happens to come from legacy fields" from "there is no persisted record yet". |
| Out of scope | Real document storage / upload, real readiness scoring, real backend / API, document status writers (`setDocumentStatus` stays untouched), `archiveGarageVehicle` / `restoreGarageVehicle` / `markGarageVehicleActive` / `appendGarageVehicle` / `patchGarageVehicle` changes, `bazardrive.active_ride.v1` / `responses.v1` / `ride_history.v1` / `driver_receipts.v1` / `respond.v1` writes, active ride lifecycle, respond/order link, driver_offer store, chat, Mapbox, payment, CSP, dispatcher. |
| Smoke coverage | `scripts/smoke-profile-driver-garage.mjs` — scenarios covering: (A) explicit active vehicle hook returns the persisted vehicle and the Documents pane shows the active copy; (B) persisted vehicles + null saved → no-active hook returns null + helper copy; (C) archived active vehicle → activeVehicleId cleared + hook returns no-active (archived NOT used; non-archived sibling NOT silently used); (D) archived-only persisted collection → no-active with `reason: 'archived_only'` (NOT empty); (E) no persisted + no legacy → `empty_garage / empty_collection` + add copy; (F) legacy-only profile compatibility → `active_vehicle / legacy_fallback` without persisting; (G) cross-surface guard; (H) non-scope source guard on the READY-K helper bodies. **Codex P2 follow-ups (#494):** S134 — malformed persisted collection is normalised-empty: raw entries fail `normalisePersistedVehicle`, no legacy fields, hook returns `empty_garage / empty_collection`, Documents pane says «Добавьте авто» (NOT «Выберите активное авто»). S135 — make-active click on a no-active profile in the SAME mounted profile refreshes the Documents READY-K hint in place via `replaceWith(#pf2-garage-ready)` to `active_vehicle / explicit_active` with the picked model/plate. S136 — archive-active click in the SAME mounted profile refreshes the Documents READY-K hint in place to `no_active_vehicle / no_active_selection` (no silent promotion to the available sibling). S137 — full materialised-legacy flow (legacy-only → archive → restore → make-active) reports `explicit_active`, NOT `legacy_fallback`. S138 — source-level pin that `refreshGarageSection` calls `refreshGarageReadinessHint`, and the new helper reads `user.get()` + calls `garageReadinessHintHtml` + `replaceWith(#pf2-garage-ready)` without touching writers / cross-surface keys / click handlers. |
| Acceptance | `node scripts/check.mjs` green; `node scripts/dispatcher.mjs` clean. Manual: open `/profile?role=driver&pane=docs` — see the Documents pane render with one of the three copy variants. From the Garage pane, click «Сделать активной» on a vehicle → switch to Documents in the same session → see «Документы активного авто» + model/plate immediately (no full reload needed). Archive the active vehicle → switch to Documents → see «Выберите активное авто» (no silent promotion). Legacy-only profile → archive the legacy card → restore it → make it active → READY-K reports `explicit_active`, NOT `legacy_fallback`. Seed `driverGarage.vehicles` with malformed entries (no model) and no legacy fields → Documents pane says «Добавьте авто», not «Выберите активное авто». |

### BD-PROFILE-D-05J - Restore archived garage vehicle

| Field | Contract |
|---|---|
| UI action | Per-archived-vehicle "Вернуть" button (`#pf2-garage-restore-${id}`) sits inside a dedicated `<section class="pf2-garage__archived-section">` rendered under the active cards / archived hint whenever `listArchivedGarageVehicles(u)` returns at least one entry. Clicking opens an inline 2-step confirm row (mirror of 05I archive) with title "Вернуть авто?", helper text "Авто снова появится в гараже, но не станет активным автоматически.", primary "Вернуть" and secondary "Отмена". |
| Helper | `restoreGarageVehicle(vehicleId)` in `public/src/state.js`. Mirror of `archiveGarageVehicle`'s lookup safety: trim-aware strict match + synthesised-id fallback; rejects whitespace-only / unknown ids with null. Strips the matched entry's `archived` flag via `{ ...prev }` + `delete next.archived`; every other field (id, model, color, plate, source, unknown future fields) is preserved verbatim. The vehicles array order is preserved (`[...vehicles]` + indexed assignment). `driverGarage.activeVehicleId` is preserved verbatim — restore NEVER auto-promotes a vehicle to active. Returns the canonical (trimmed) id on success; null on validation refusal. |
| Idempotent | Calling `restoreGarageVehicle` on a non-archived id is a no-op write (the helper short-circuits before `normalize/persist`) and returns the canonical id. |
| Render | `listArchivedGarageVehicles(u)` in `garage.js` walks the persisted vehicles through `normalisePersistedVehicle`, returns only entries with `archived === true`, dropping modelless or otherwise unrenderable ones. The archived section renders one card per item with model + color + plate + Вернуть button. `countArchivedGarageVehicles` (05I) continues to count the RAW array, so a malformed archived entry shows in the "В архиве: N" hint but not in the list. |
| Restored vehicle reappearance | After restore, the entry re-enters the active list (no longer filtered) and the resolver picks an `activeVehicleId` per the existing 05D/05F rules: saved id matches → that vehicle is active; saved is null → legacy fallback → first vehicle. Restore itself never writes `activeVehicleId`. |
| Legacy restore | The materialised legacy-1 (from 05I Codex P2 materialisation) restores like any other entry. Once unarchived, `hasArchivedLegacy` in `buildGarageVehicles` is no longer true, so the legacy fallback suppression releases and the entry surfaces back into the active list with `source: 'legacy'` preserved. |
| Out of scope | Hard delete (never), restore-promotes-to-active (explicitly forbidden — 05D's make-active handler stays the only writer for `activeVehicleId` outside `appendGarageVehicle({ makeActive: true })`), documents / readiness implementation (deferred — see BD-PROFILE-GARAGE-READY-K), driver-response schema changes, active ride / ride lifecycle / history / receipt writes, backend / API, Mapbox, CSP, inline script-style. |
| Smoke coverage | `scripts/smoke-profile-driver-garage.mjs` S94–S105: helper clears archived + preserves order + activeVehicleId; preserves unknown future fields via spread; idempotent on non-archived; render exposes archived section + per-item restore confirm row hooks; open + cancel does not write and restores the "Вернуть" label; full restore-flow click path strips archived + restores entry to the active list + drops the archived section/hint; active badge stays on `activeVehicleId` throughout (no auto-promotion); defensive helper rejects unknown / whitespace / null / out-of-range ids; trim-aware strict match + synthesised-id fallback; legacy-1 restore re-surfaces in the active list and clears the `hasArchivedLegacy` suppression; passenger profile guard; cross-surface writes forbidden; static source guard on the helper body. Existing 05I assertions S76 / S79 / S88 tightened to discriminate active-card vs archived-section render (the archived items now legitimately carry `data-vehicle="${id}"` in the archived list). |
| Acceptance | `node scripts/check.mjs` green; `node scripts/dispatcher.mjs` clean. Manual: seed a driver with one active + one archived vehicle → archived section shows under the active card with a Вернуть button → click → confirm → restored card joins the active list (status `available`), the active badge stays on the pre-existing active vehicle, the archived section + hint disappear when the last archived entry is restored. |

### BD-PROFILE-D-03 - Driver dashboard profile polish

| Field | Contract |
|---|---|
| Route | `/profile?role=driver` (renders `renderDriver`). `/profile?role=passenger` stays the passenger dashboard — the two role branches are fully separated. |
| File | `public/src/screens/profile.js` |
| Render gate | `public/prototypes/profile/BD-PROFILE-D-03-driver-dashboard-render-gate.{pdf,html}` — visual reference only; never copied into runtime. |
| Tabs | `Обзор` (default) · `Такси·ИП` · `Документы` · `Выплаты` · `Безопасность`. The five tabs switch panes via a CSS active class; the top bar + tab row are not remounted on switch. |
| Pane deep-link | `?pane=` accepts internal ids (`overview` / `ip` / `docs` / `payouts` / `security`) and render-gate aliases (`taxi-ip` → ip, `documents` → docs, `safety` → security). |
| States | A overview ready · B overview offline · C checklist missing docs · D Такси·ИП demo · E documents pending (`На проверке`) · F documents verified (`Проверено`) · G payouts receipt rows · H payouts empty (`?pane=payouts&state=empty`) · I safety center (`?pane=safety`) · J loading/skeleton (`?state=loading`). |
| Documents | Readiness cards only: `Проверено` (uploaded), `На проверке` (review_required), `Нужно обновить` (expired/missing). No real upload. |
| Payouts | Completed-ride rows read `receipt.net` straight from the BD-RIDE-HISTORY-D-01 canonical store (`mock_api.listDriverReceipts`); cash/noncash badges mirror the receipt screen wording. profile.js never recalculates fare / commission / tip / net. |
| Такси·ИП | Static demo only — no tax math. |
| Safety | Calm, visible driver safety center (driver-scoped `pf2-safety-*` classes); tiles are demo placeholders (no real call / SOS). |
| Constraints | No backend, no Mapbox, no real payments, no real document upload, no tax/accounting math, no passenger redesign, no active-ride redesign, no CSP weakening, no inline script/style, no copying generated HTML into runtime. |
| Acceptance | `node scripts/check.mjs` green (no inline-style patterns, JS syntax, smokes). Loading/skeleton and empty-payouts states reachable from the documented URLs; payouts no-drift stays covered by `scripts/smoke-driver-receipt-no-drift.mjs`. |

### BD-RESPOND-01 - Respond

| Field | Contract |
|---|---|
| Route | `/respond?postId=...` |
| File | `public/src/screens/respond.js` |
| Storage | Writes `bazardrive.respond.v1`; some chat/response flows can also write `bazardrive.responses.v1`. |
| Main states | Offer form, vehicle card if available, validation, submitted state. |
| Actions | Send offer, cancel/back, open profile/feed/chat where supported. |
| Acceptance | Respond data is local mock data. The passenger_response is keyed by `resp_<post.id>` and, for canonical ride-order posts, additively pins `orderId` + `canonical:'ride_order'` (BD-RESPOND-ORDER-LINK-01 / #368). `/responses` reads those back read-side by `orderId` (BD-RESPOND-ORDER-LINK-02 / #369); the respond → chat link stays `responseId`-only. |

### BD-RESPONSES-01 - Responses inbox

| Field | Contract |
|---|---|
| Route | `/responses` |
| File | `public/src/screens/responses.js` |
| Data | Real driver responses from `bazardrive.responses.v1` (read-side, BD-RESPOND-ORDER-LINK-02 / #369): `kind==='passenger_response'` rows for the current canonical `orderId`, mapped into the `responses__driver` card shape. Falls back to in-file `MOCK_DRIVERS` when there is no `orderId` / no real response / legacy `postId` / fallback request. Canonical order lookup via `getOrderById()`; accept flow via `acceptOrder()`. |
| Storage | Reads `bazardrive.responses.v1` read-only (never written from `/responses` — respond.js/chat.js own writes + the user-scoped clear). `bazardrive.ride_orders.v1` is read-only here via `getOrderById()`. |
| Main states | Driver offer board (real responses or `MOCK_DRIVERS`), empty/missing-order fallback, accepted driver handoff. |
| Actions | Pick/accept a driver, open chat/active ride, return to feed/profile. Sort + decline (below). |
| Sort + decline (BD-RESPONSES-01) | The board carries inline **segmented sort chips** (`responses__chip`, `data-sort=`): **Лучшие** (`isBest`/default), **Быстрее** (ETA), **Дешевле** (`priceTone`), **Рейтинг** (comma-decimal-safe). Sorting is a derived **view** (`sortDrivers`) — it never mutates the `drivers` array, so the read-side board source (`const drivers = buildDriversForOrder(request)`) is preserved. **Decline is per-driver**, backed by an in-memory `Set` (`declined`): a declined card stays visible, muted, with an «Отклонено» badge + «Вернуть» (single restore). When every card is declined an all-declined notice offers «Вернуть все» (clears the set). State is **session-only — never persisted to `localStorage`**; a reload returns all cards to normal. `?state=all-declined` is an **initial seed** only. One delegated listener on the stable `#responses-board` drives chips + decline/restore; `refreshBoard()` re-renders the board inner markup in place. `call` stays a stub (out of scope). Pinned by `scripts/smoke-responses-decline-sort.mjs`. |
| Acceptance | Real `/respond` submissions for a canonical `orderId` appear here; the `MOCK_DRIVERS` board is preserved for the fallback paths. Render is read-only of the response store (no store writes); the accept → active-ride handoff and chat confirmation flow are unchanged. |

### BD-CHAT-01 - Chat

| Field | Contract |
|---|---|
| Route | `/chat?tripId=...` or `/chat?responseId=...` |
| File | `public/src/screens/chat.js` |
| Storage | `bazardrive.chat.v1`, response/confirmation helpers. |
| Main states | Thread, empty/new thread, quick replies, confirmation CTA. |
| Actions | Send message, quick reply, open trip confirmation, open active ride where applicable. |
| Acceptance | Same `tripId` links feed/respond/confirmation/active ride. |

### BD-CHAT-02 - Chat bridge (ride + response context)

| Field | Contract |
|---|---|
| Route | `/chat?tripId=<id>&role=<driver\|passenger>` (from `/active-ride`) or `/chat?responseId=<id>` (from `/respond`) or legacy `/chat?tripId=<id>` (feed/post-detail/inbox). |
| File | `public/src/screens/chat.js` |
| Storage | Reads `bazardrive.active_ride.v1` and `bazardrive.responses.v1`; writes `bazardrive.chat.v1` (message threads) and `bazardrive.trip_confirmation.v1` (BD-CHAT-01 handoff, unchanged). |
| Hydration order | (1) `tripId` → `findActiveRide(tripId)` → counterpart = `viewerRole === 'driver' ? ride.passenger : ride.driver`; trip = `ride.route` + `ride.ride.price` / `ride.order.offerPrice` + `ride.status`. (2) Else `responseId` → `loadResponse(responseId)` → counterpart falls back to `MOCK_DRIVER`; trip price from `response.driverPrice`. (3) Else demo `MOCK_DRIVER` / `MOCK_TRIP`. |
| Back-link | `tripId` + explicit `role` → `/active-ride?role=<role>&tripId=<tripId>`. `responseId` with known `response.requestId` → `/respond?postId=<requestId>`. Otherwise `/feed` (legacy / demo). |
| Message schema | Outgoing send writes `{ id, senderRole: viewerRole, dir: 'out', text, time }`. Readers prefer `senderRole`, then `authorRole` (forward-compatible alias, BD-CHAT-04); legacy `dir`-only records keep rendering via the existing fallback in `directionForMessage` (see §4c). |
| Preserved | BD-CHAT-01 confirmation CTA flow (`/chat?responseId=…` → `bazardrive.trip_confirmation.v1` → `/trip-confirmation`) unchanged. `/respond` write side unchanged. `/active-ride` driver/passenger flows unchanged apart from the appended `&role=` on chat deep-links. |
| Acceptance | Round-trip `/active-ride?role=<r>&tripId=<id>` → `/chat?tripId=<id>&role=<r>` → back returns to the originating `/active-ride` view with `role`+`tripId` preserved; counterpart matches the role; trip route/price/status come from `bazardrive.active_ride.v1`. |

#### Render-gate state contract

##### 1. Shared thread shell

One shell is rendered for both passenger and driver. Differences are role-scoped only:

- **Header peer** — passenger view shows the driver; driver view shows the passenger.
- **Quick actions** — call / safety / cancel chip sets differ by role.
- **Lifecycle copy** — banner and sheet copy is role-anchored (e.g. «Водитель едет к вам» vs «Едете к пассажиру»).
- **Back target** — passenger back returns to `/active-ride?role=passenger&tripId=<id>`; driver back returns to `/active-ride?role=driver&tripId=<id>`.

Anatomy of the shell (top → bottom):

1. **Header** — back button, counterpart avatar + name + online/status + rating, call button.
2. **Route summary card** — pickup → dropoff, price, status pill.
3. **Message list** — date separator + bubbles (`chat__msg--in` / `chat__msg--out`).
4. **Quick actions** — chip strip (role-scoped quick replies).
5. **Composer** — one of:
   - **Default composer** — text input + send.
   - **Locked composer** — input disabled, locked notice in place of input.
   - **Degraded composer** — input enabled, send replaced by retry control and/or skeleton.

##### 2. Main states

1 · **Inbox — passenger** · `/chat` with no `tripId`/`responseId`, `role` resolves to passenger — list of the passenger's active and recent threads. Default composer hidden until a thread is opened.
2 · **Inbox — driver** · `/chat` with no `tripId`/`responseId`, `role=driver` — list of the driver's responder threads. Default composer hidden until a thread is opened.
3 · **Thread — passenger active ride** · `/chat?tripId=<id>&role=passenger` — full shell, default composer. Counterpart = `ride.driver`. Status pill from `ride.status`.
4 · **Thread — driver active ride** · `/chat?tripId=<id>&role=driver` — full shell, default composer. Counterpart = `ride.passenger`. Status pill from `ride.status`.
5 · **Thread — completed ride** · `/chat?tripId=<id>&role=<role>` when `ride.status === 'COMPLETED'` — read-only mode: composer hidden or locked, receipt/summary visible.
6 · **Empty inbox** · `/chat` when no threads exist for the resolved role — illustration + copy + CTA back to `/feed`. No composer.
7 · **Offline / failed message** · any thread state where `saveMessages` fails or storage is unavailable — failed bubble marker, composer offers explicit retry.

  - 7b · **Loading skeleton / degraded composer** *(sub-state of 7, not a ninth required state)* — transient skeleton while `loadMessages` resolves and degraded composer while a retry is in flight.

8 · **Canceled / no-show locked chat** · `ride.status === 'CANCELED'` or `'NO_SHOW'` — locked composer with explanatory notice; message list stays readable.

> **Note.** 7b is presented as a sub-state of 7 (failure / degradation lifecycle), not a ninth required state. Implementations treat the loading skeleton and the degraded composer as transient overlays inside state 7.

##### 3. Message types

Renderers distinguish the following types via `msg.type` (with legacy inference falling back to a `text` bubble):

- **text** — plain user-typed bubble.
- **system event** — centered, full-width, non-bubble line; see canonical list below.
- **route/order card** — inline trip summary (pickup → dropoff, ETA).
- **price/offer card** — counter-offer or fare confirmation card.
- **safety notice** — banner-style notice, non-dismissable.
- **call action** — quick-action affordance rendered inside the thread.
- **status update** — terse status line derived from a `ride.status` transition.

##### 4. Canonical system events

System-event bubbles use exactly these strings (Russian, no trailing punctuation):

- `Заказ принят`
- `Водитель едет к пассажиру`
- `Водитель на месте`
- `Поездка началась`
- `Поездка завершена`
- `Поездка отменена`
- `Пассажир не вышел`

##### 4b. Status pill — ride.status → tone (BD-CHAT-03)

| `ride.status`                | Tone CSS variant                  | Label (RU)               |
|------------------------------|-----------------------------------|--------------------------|
| `NEW_ORDER`                  | `--warning`                       | Новый заказ              |
| `CONFIRMATION_PENDING`       | `--warning`                       | Ожидает подтверждения    |
| `CONFIRMED`                  | `--warning`                       | Подтверждён              |
| `CHAT_STARTED`               | `--warning`                       | Чат начат                |
| `ACCEPTED`                   | `--info`                          | Принят                   |
| `DRIVER_EN_ROUTE`            | `--info`                          | Водитель едет            |
| `DRIVER_APPROACHING_PICKUP`  | `--info`                          | Подъезжает               |
| `WAITING_PASSENGER`          | `--warning`                       | Ждёт пассажира           |
| `IN_PROGRESS`                | `--success`                       | В пути                   |
| `COMPLETED`                  | `--success`                       | Завершено                |
| `CANCELED`                   | `--danger`                        | Отменено                 |
| `NO_SHOW`                    | `--danger`                        | Не пришёл                |
| unknown / non-enum string    | `--muted`                         | (raw string passthrough) |

Source: `RIDE_STATUS_TONE` / `RIDE_STATUS_LABEL` in `public/src/ride_state.js`. CSS variants live in `public/styles/cloud.css` (existing `.inbox-item__status--*` palette — no new classes).

##### 4c. Legacy dir-only message fallback (BD-CHAT-04)

`directionForMessage(msg, viewerRole)` in `public/src/screens/chat.js` is the single resolver that decides whether a stored message renders as the viewer's own bubble (`out`) or the counterpart's (`in`). It is evaluated in this precedence order:

1. **Explicit role — `senderRole` then `authorRole` (`'driver'` / `'passenger'`)** — source of truth. `senderRole` wins when both are present; otherwise `authorRole` is accepted as a forward-compatible alias. Both fields are gated on `'driver'` / `'passenger'`; any other value falls through to the next branch. `'out'` iff the resolved explicit role equals `viewerRole`, otherwise `'in'`. New writes (BD-CHAT-02 `doSend`) always stamp `senderRole`; `authorRole` is reserved for future producers that adopt the alias.
2. **Driver auto-notice text (`LEGACY_DRIVER_AUTO_TEXTS`)** — a small allow-list of pre-`senderRole` driver-authored auto-notices. Role-anchored: `'out'` for `viewerRole === 'driver'`, `'in'` for the passenger viewer.
3. **Legacy `dir` field (records written before either role field shipped)** — taken **literally relative to the current viewer**:
   - `dir === 'out'` → `'out'` (viewer's own bubble).
   - `dir === 'in'` → `'in'` (counterpart's bubble).
   - missing / unknown / non-string `dir` → `'in'` — safe "other-side" fallback that never falsely attributes a message to the viewer and never throws on a malformed record.

The legacy `dir` branch does **not** re-anchor by viewer role: passenger and driver renderers map the same legacy record to the same `dir`. This makes the dir-only asymmetry explicit: a record stored from one role's perspective will render symmetrically across both roles. New writes always stamp `senderRole` (BD-CHAT-02), so legacy `dir`-only records are the only ones that ride this branch.

Static guards: `scripts/smoke-chat-bridge.mjs` section **F2** pins the legacy-`dir` precedence, the `'in'` safe fallback, and the no-`viewerRole`-in-`dir`-branch invariant; section **F3** pins the `authorRole` alias contract (alias is read, `senderRole` keeps precedence, role gating on `'driver'`/`'passenger'`, explicit-role branch runs before the driver-auto-notice and legacy `dir` branches).

##### 5. Acceptance checklist

- [ ] `/chat` renders the role-appropriate inbox when no `tripId`/`responseId` is supplied.
- [ ] `/chat?tripId=<id>&role=<role>` opens the role-aware thread (counterpart, back target, lifecycle copy all match `<role>`).
- [ ] Passenger and driver share the same shell; only the role-scoped slots (header peer, quick actions, lifecycle copy, back target) differ.
- [ ] Bubble side ("me" vs "them") is computed from `senderRole` vs `viewerRole`; legacy `dir`-only records fall back via `directionForMessage`.
- [ ] Completed-ride thread renders in read-only mode (composer hidden or locked, receipt/summary visible).
- [ ] Canceled / no-show thread locks the composer; the message list remains readable.
- [ ] Status pill colour follows `RIDE_STATUS_TONE` — CANCELED / NO_SHOW render as `--danger`, never `--success`.
- [ ] Offline / failed-message state supports an explicit retry; the loading skeleton and the degraded composer (7b) are transient overlays inside state 7.
- [ ] Empty inbox state is reachable and offers a CTA back to `/feed`.
- [ ] No WebSocket, no push, no backend, no Mapbox, and no media-upload work is introduced.

### BD-CONFIRM-01 - Trip confirmation handoff

| Field | Contract |
|---|---|
| Route | `/trip-confirmation` |
| File | `public/src/screens/trip_confirmation.js` |
| Helper modules (no route) | `public/src/screens/trip_confirmation_handoff.js` (seed + cross-role canonical active-ride loader), `public/src/screens/driver_handoff_snapshot.js` (driver-side snapshot store + ride overlay). Both are non-route helper modules, not routed screens. |
| Storage | `bazardrive.trip_confirmation.v1`, `bazardrive.driver_handoff_snapshot.v1` |
| Main states | Pending, passenger confirmed, driver confirmed, both confirmed, expired/canceled mock states. |
| Actions | Confirm, decline/back, continue to `/active-ride?role=...`. |
| Acceptance | Handoff does not introduce a separate backend status store. |

### BD-INBOX-01 - Inbox hub

| Field | Contract |
|---|---|
| Route | `/inbox` |
| File | `public/src/screens/inbox.js` |
| Data | Mock inbox items from `mock_api.js`. |
| Main states | Responses, messages, rides, unread indicators, empty tab. |
| Actions | Open primary target, secondary chat/ride actions. |
| Acceptance | Links stay inside the registered route set. |

### BD-POST-01 - Post detail

| Field | Contract |
|---|---|
| Route | `/post` |
| File | `public/src/screens/post_detail.js` |
| Data | Feed/mock post lookup. |
| Main states | Detail, not found fallback. |
| Actions | Back to feed, open related CTA. |
| Acceptance | Missing/unknown ids fail soft. |

### BD-ORDER-DETAIL-01 - Order Detail

**Status:** runtime shell · Model B locked · scoped local 01D writes landed (driver send/withdraw offer, passenger select-driver commit, passenger open-trip active_ride handoff, passenger cancel order, passenger reject offer, passenger cancel sent-offer sync, driver cancel accepted order); backend / Mapbox / payment out of scope.
This entry locks the Cloud Design / Codex audit decisions captured in
#454 / #455 plus the BD-ORDER-DETAIL-01B Model B product call.
BD-ORDER-DETAIL-01C originally shipped the first read/render runtime shell —
`/order/<id>` registered as a route resolving to `public/src/screens/order_detail.js`,
with every Model-B mutating action stubbed as a non-mutating toast at that
point. The scoped local 01D write paths enumerated in the Status line above
have since landed (01D-1 / 01D-2A / 01D-2B / 01D-2C-A/B/C / 01D-2D), so
the Model-B CTAs now mutate their scoped local stores instead of toasting;
backend / Mapbox / payment remain out of scope.

**BD-ORDER-DETAIL-01C shipped the read/render shell.
BD-ORDER-DETAIL-01D-1 opened the driver write pinhole (DriverOffer
send/withdraw against `bazardrive.driver_offers.v1`).
BD-ORDER-DETAIL-01D-2A opens the passenger commit pinhole**: «Выбрать
водителя» now atomically (a) writes the order overlay
`bazardrive.order_overlay.v1` with `Order.status='ACCEPTED'` +
`Order.selectedDriverId = offer.driverId`, (b) flips the chosen
DriverOffer to `status='accepted'`, (c) flips every competing
**`status='sent'`** offer for the same order to `status='rejected'`,
and (d) preserves terminal offers (`withdrawn`, `expired`, `rejected`,
unknown) verbatim. The select-driver handler refuses to commit on
unsafe / blocked / malformed input (foreign `orderId`, blocked
`driverId`, non-`sent` target, missing target).

**BD-ORDER-DETAIL-01D-2C-A opens the passenger cancel pinhole**: P1
«Отменить заказ» now performs a 2-step armed/confirm click and, on the
second click, writes the order overlay record
`{ status: 'CANCELED', canceledBy: 'passenger', canceledAt, updatedAt }`
via the new `cancelOrderByPassenger({ orderId })` helper. The overlay
preserves any previously written `selectedDriverId` (01D-2A) verbatim.
After the commit the merged Order Detail resolves to P4 (terminal
canceled), so the cancel button leaves the DOM and the armed state
cannot persist across re-renders. 01D-2C-A wrote the overlay only —
the **DriverOffer sent → rejected sync** for the same order is now
closed in **01D-2C-C** (see below). The active_ride store is **not**
seeded by either path.

**BD-ORDER-DETAIL-01D-2C-B opens the passenger reject-offer pinhole**:
P2 «Отклонить» on a single DriverOffer card now flips ONLY that one
offer to `status='rejected'` via the new
`rejectDriverOfferByPassenger({ orderId, driverId, offer? })` helper,
stamping `rejectedBy='passenger'` + `rejectedAt` + a monotonic
`updatedAt`. The optional `offer` snapshot lets the click handler
persist a fixture-only sent baseline (a P2 candidate that has not yet
been written to `bazardrive.driver_offers.v1`) before flipping it to
rejected — mirroring the snapshot fallback `commitPassengerSelection`
uses. Other sent offers for the same order stay `sent` and remain
selectable; terminal offers (`withdrawn`, `expired`, `accepted`, and
any pre-existing `rejected` with a different `rejectedBy`) are
preserved verbatim. The order overlay (`selectedDriverId`,
`Order.status`) is **not** touched, and the active_ride store is
**not** seeded. Idempotent: a second reject on an already-passenger-
rejected offer returns the existing record. Because
`activeSentOffers()` already filters terminal statuses, the rejected
offer naturally drops out of P2 and is no longer a selectable /
open-trip candidate; the `commitPassengerSelection` stale-store guard
also refuses to promote a rejected offer to `selectedDriverId`.

The reject-offer click handler validates the helper outcome before
toasting success — it only shows «Оффер отклонён» when
`result.status === 'rejected' && result.rejectedBy === 'passenger'`. A
truthy result with a non-matching shape (the snapshot was stale and the
stored offer is now `accepted` / `withdrawn` / `expired` / foreign-
rejected) is treated as non-success: the handler re-renders so the
stale card drops out of P2 and toasts «Этот оффер недоступен» instead
of the misleading success copy.

**SELF-driver D4 transition.** When the passenger rejects the SELF
driver's own DriverOffer on a still-CREATED order, the driver view
routes to **D4** (NOT D1) with `lockedReason='driver_offer_rejected'`
and the explicit info copy «Пассажир отклонил ваш оффер». The
`driver-send-offer` click handler is hardened with a defensive
short-circuit on `existing.status === 'rejected'` that branches on
`rejectedBy`:
- `rejectedBy === 'passenger'` → «Пассажир отклонил оффер»;
- any other `rejectedBy` (`system` / `driver` / missing / …) →
  generic «Оффер недоступен» so the rejecter is never mislabeled.

`sendDriverOffer` already preserves the rejected status verbatim — the
handler-side branch ensures the driver never sees the misleading
«Оффер отправлен» toast against an unchanged terminal store, and the
generic copy keeps the rejecter accurate for non-passenger terminal
records.

**lockedReason precedence on D4** (applied in `loadOrder()`):
1. fixture-set `lockedReason` always wins (e.g. `demo-order-locked`
   carries `'passenger_chose_other'`);
2. runtime `ACCEPTED` with `selectedDriverId !== SELF` →
   `'passenger_chose_other'` — the canonical D4 reason when the order
   is taken by another driver (SELF-selected ACCEPTED orders route to
   D3 and never read this label);
3. runtime `CANCELED` → `'order_canceled'` so D4 shows «Заказ отменён»;
4. runtime `EXPIRED` → `'order_expired'` so D4 shows «Заказ истёк»;
5. only on non-terminal `CREATED` orders, a passenger-rejected SELF
   offer surfaces `'driver_offer_rejected'`.

**BD-ORDER-DETAIL-01D-2D closes the driver-side cancel gap**: the
assigned driver's «Отменить» on D3 now performs a 2-step armed/confirm
click and, on the second click, writes the order overlay record
`{ status: 'CANCELED', canceledBy: 'driver', canceledAt, updatedAt,
selectedDriverId (preserved) }` via the new
`cancelOrderByDriver({ orderId, driverId, order })` helper. The helper
enforces defense-in-depth eligibility:
- when an overlay exists and pins a foreign `selectedDriverId`, the
  call refuses;
- when no overlay exists yet (fixture-only ACCEPTED path), the caller
  MUST supply an `order` snapshot proving the assignment — the
  snapshot must satisfy `isPlainObject(order)`, `order.id === orderId`,
  `order.status === 'ACCEPTED'`, and `order.selectedDriverId === driverId`.
  Without this proof the helper refuses, so a direct / stale-tab call
  with a safe `orderId` + arbitrary `driverId` cannot pin a CANCELED
  overlay onto a CREATED order such as `demo-order-1`. The Order
  Detail click handler passes `order: ctx.order` through.

Idempotent on any prior cancel actor — a second call (or a tab racing
behind a passenger cancel) returns the existing record verbatim; the
click handler differentiates success vs stale outcome by checking
`result.canceledBy === 'driver'` before toasting «Заказ отменён».

**`cancelOrderByPassenger` is symmetrically idempotent on any existing
CANCELED overlay** regardless of actor: a stale passenger tab landing
behind a driver cancel returns the existing driver-canceled record
verbatim. Without this guard the passenger cancel would silently
overwrite `canceledBy='driver'` / `canceledAt` / `updatedAt`, losing
the actor record the passenger P4 surface uses to render «Водитель
отменил заказ.».

The accepted DriverOffer stays `accepted` — driver cancel does NOT
flip the offer back to `sent` or `rejected`. Peer offers already
flipped by the prior 01D-2A commit (or any other terminal status) are
preserved verbatim. The `active_ride.v1` store is **not** touched by
either the helper or the click handler; a pre-existing active ride
snapshot is preserved byte-for-byte across the cancel.

`loadOrder()` now merges `overlay.canceledBy` onto the base order so
the passenger P4 surface can differentiate the terminal copy:
- `order.canceledBy === 'driver'` → «Водитель отменил заказ.»
- otherwise → «Заказ отменён.»

The driver D4 surface continues to use the canonical `order_canceled`
`lockedReason` (precedence rule #3) and shows «Заказ отменён»
regardless of actor — the role chip is already enough to communicate
who the actor was. P4 terminal exits stay «Создать новый заказ» /
«Вернуться в ленту»; D4 hides every D3 active CTA («Начать подачу»,
«Открыть активную поездку», «Отменить») and every D1/D2 CTA
(«Откликнуться на заказ», «Оффер отправлен»).

**BD-ORDER-DETAIL-01D-2C-C closes the cancel-side DriverOffer sync gap**:
after the passenger commits a whole-order cancel via 01D-2C-A, the
cancel-order click handler also calls the new
`rejectSentOffersForPassengerCanceledOrder({ orderId, allOffers })`
helper. The helper iterates the merged offer snapshot (so fixture-only
sent offers without a store baseline are picked up via the same
snapshot fallback `commitPassengerSelection` uses) and flips every
active `status='sent'` DriverOffer belonging to `orderId` to a terminal
record stamped with:
- `status='rejected'`,
- `rejectedBy='passenger_cancel'`,
- `rejectedReason='order_canceled_by_passenger'`,
- `rejectedAt` + `updatedAt` (monotonic ISO stamps).

Without this sync, stale `sent` offers would keep surfacing on the
driver side as D2 («Оффер отправлен») even after `Order.status` flipped
to `CANCELED`. After the sync the driver lands on D4 with the
`order_canceled` lockedReason (precedence rule #3 above) and the explicit
«Заказ отменён» copy — no «Откликнуться на заказ» / «Оффер отправлен»
/ «Отозвать оффер» / «Изменить оффер» CTAs in the DOM.

Preserved verbatim:
- terminal offers (`accepted` / `withdrawn` / `expired` / pre-existing
  `rejected` with foreign `rejectedBy`),
- offers belonging to other orders,
- snapshot entries with blocked / unsafe `driverId`,
- the cancel overlay (`canceledAt` / `updatedAt` / `canceledBy`) — the
  sync only mutates the DriverOffer store, never the order overlay,
- `selectedDriverId` from a prior 01D-2A commit.

Refused (returns `null`):
- unsafe / blocked `orderId`,
- non-array `allOffers`.

The cancel overlay is the source of truth for terminal order state; the
click handler does NOT rollback the cancel if the sync returns null or
an empty array — a canceled order is canceled regardless of whether any
sent offers existed. The active_ride store is **not** touched by either
the cancel overlay or the sync.

This precedence guarantees:
- cancel-after-reject path shows the canceled-order reason on D4,
  never the per-offer rejected reason;
- passenger-picked-another-driver path shows
  «Пассажир выбрал другого водителя», never the per-offer rejected
  reason;
- the per-offer `driver_offer_rejected` reason only ever surfaces
  while the order is still open (`CREATED`).

**BD-ORDER-DETAIL-01D-2B opens the active-ride seed pinhole**: the P3
«Открыть поездку» CTA now writes the canonical
`bazardrive.active_ride.v1` snapshot (via `ride_state.saveActiveRide`)
and routes the passenger to `/active-ride?role=passenger&tripId=...`.
The seed is computed by the new `buildPassengerActiveRideSeed(order)`
pure helper from the merged Order Detail data: tripId, orderId,
passenger snapshot, driver/vehicle snapshot from the chosen offer,
route + price snapshot, and `seededFrom: 'order_detail_passenger_handoff'`.
The CTA is gated by `canOpenTrip(order)` — accepted order +
non-empty `selectedDriverId` + matching offer with status `'accepted'`
or `'sent'`; the button renders as `disabled` when the gate refuses,
and the click handler short-circuits before writing anything. Idempotent:
a re-tap on an already-seeded `tripId` skips `saveActiveRide` and just
re-navigates. The 01D-2A select-driver commit alone still **never**
seeds active_ride. All Model-B mutations on the Order Detail screen
are now landed (01D-2A passenger select + 01D-2B passenger open-trip
seed + 01D-2C-A passenger cancel + 01D-2C-B passenger reject single
offer + 01D-2C-C passenger cancel offer sync + 01D-2D driver cancel);
the active-ride lifecycle (post-handoff cancel / complete) remains
owned by `active_ride.js` and is out of scope for this screen.
Smoke pins the runtime-shell contract, the DriverOffer store
send/withdraw round-trip, the commitPassengerSelection multi-write
(F3a–F3l), the active-ride seed handoff (F4a–F4l), the passenger
cancel-order overlay (F5a–F5m), the passenger reject-offer overlay
(F6a–F6o, F6p–F6ff), the passenger cancel-order sent → rejected
sync (F7a–F7p), and the assigned-driver cancel (F8a–F8o).

**Chosen semantics: Model B — offer + passenger confirm.** Driver sends a
`DriverOffer(status='sent')`. The driver tap **does not** mutate
`Order.status`. The order only becomes `«Заказ принят»` after the passenger
selects a driver via `«Выбрать водителя»`. A single driver tap must never
assign the ride.

**Forbidden P0 semantics** (smoke must fail if a future contract drifts to
either):
- **Model A** — driver instantly accepts the order (single-tap commits).
- **Model C** — driver can only accept after a passenger invitation.

| Field | Contract |
|---|---|
| Route | `/order/<id>` — canonical deep-link, role-split via the same `?role=` query the active ride uses (`passenger` / `driver`). Registered in `public/src/app.js` via `register('/order', orderDetail)`; the router resolves any `/order/<anything>` path to the exact `/order` loader via a minimal dynamic-route fallback added in BD-ORDER-DETAIL-01C. The Order Detail screen reads its id off `location.hash` directly. |
| File | `public/src/screens/order_detail.js` — shipped in BD-ORDER-DETAIL-01C as the runtime shell (read/render only). Exports `default function orderDetail()` (loader) plus the pure helpers `parseOrderHashPath`, `resolveRoleFromQuery`, `loadOrder`, `resolveState`, `resolveStateChip`, `renderOrderDetailMarkup`, the `ROLE_CHIP` / `STATE_CHIP` / `ORDER_STATUS` constants, the `DRIVER_PRIMARY_CTA` label, and the `DEMO_ORDERS` fixtures used by the manual test URLs. |
| Role variants | **passenger** ("Ваш заказ") and **driver** ("Просмотр водителя"). Same route, role-dispatched. `roleView ∈ {passenger, driver}` is the canonical role discriminator. |
| Driver primary CTA | **«Откликнуться на заказ»** — exact label. Forbidden regressions (smoke pins each): «Принять», «Принять заказ», «Забрать заказ». |
| P0 transition rule | Driver CTA creates `DriverOffer(status='sent')`; it **does not** set `Order.status='ACCEPTED'`. Only the passenger action **«Выбрать водителя»** commits acceptance — atomically: `Order.selectedDriverId = offer.driverId`, `Order.status = 'ACCEPTED'`, selected `offer.status = 'accepted'`, **only active competing offers with `status='sent'`** flip to `status='rejected'` (terminal offers with `status='withdrawn'` or `status='expired'` are preserved verbatim), and `bazardrive.active_ride.v1` is seeded with `tripId = trip_${order.id}`, `status = 'ACCEPTED'`. The Russian «Заказ принят» is UI display/chip only; the stored `Order.status` stays on the canonical enum used by `ride_state.js` / `mock_api.js`. |
| Data (runtime shell, 01C) | **Reads:** deterministic demo fixtures in `order_detail.js` via `loadOrder()` / `DEMO_ORDERS`, with `roleView` derived at render time from `?role=` / session. **Writes:** none. Every mutating Model-B CTA is a non-mutating toast stub in 01C; no DriverOffer persistence, no active_ride seed, no `Order.status` mutation. |
| Data (writes, 01D) | **Deferred to BD-ORDER-DETAIL-01D — not part of 01C.** Reads: `bazardrive.ride_orders.v1` (`mock_api.getOrderById`), planned `bazardrive.driver_offers.v1` (Model B store), `bazardrive.active_ride.v1` (after trip seed), user-scoped favorite/history stores. Writes: the full enumeration lives in the "Order-store writes" table below — driver «Откликнуться» only creates `DriverOffer(status='sent')`; passenger «Выбрать водителя» commits acceptance (Order + selected offer + only active sent competing offers → rejected + active-ride seed); passenger «Отменить заказ» writes `Order.status = 'CANCELED'` + flips only active sent offers; passenger «Отклонить» on a `DriverOffer` flips only that one offer from `sent` → `rejected` and never touches the Order; driver D3 «Отменить» delegates to the canonical active-ride cancellation handoff. Terminal offers (`status='withdrawn'` / `status='expired'`) are preserved verbatim by every write above. No other actor on this screen writes to any store. |

#### Passenger states

| # | State | UI status / chip | Renders | Actions |
|---|---|---|---|---|
| P1 | **Passenger Own Order Created** | «Ждём водителя» · empty offers state | order summary, route, price, comment | Изменить · Отменить заказ · Поделиться · Скопировать |
| P2 | **Passenger Has Driver Offers** | «Есть предложения» | `DriverOffer[]` cards: driver name · car · rating · ETA · offered price · message. **P2 renders active `DriverOffer(status='sent')` candidates only.** Terminal offers (`rejected`, `withdrawn`, `expired`) remain preserved in data for write-side history (BD-ORDER-DETAIL-01D) but do not expose «Выбрать водителя» and do not trigger P2 on their own. | Выбрать водителя · Написать · Отклонить |
| P3 | **Passenger Driver Selected** | «Заказ принят» | assigned driver card · timeline | **«Открыть поездку»** (primary, hands off to `/active-ride?role=passenger`) |
| P4 | **Passenger Terminal State** | «Отменён» **or** «Истёк» | terminal copy | Создать новый заказ · Вернуться в ленту |

#### Driver states

| # | State | UI status / chip | Actions |
|---|---|---|---|
| D1 | **Driver Available Order** | (active order) | **«Откликнуться на заказ»** (primary) · Написать · Скрыть · Пожаловаться |
| D2 | **Driver Offer Sent** | «Оффер отправлен» | Изменить оффер · Отозвать оффер · Написать |
| D3 | **Driver Accepted / Assigned** | «Заказ принят» | Начать подачу · Открыть активную поездку · Написать · Отменить |
| D4 | **Driver Locked / Unavailable** | «Недоступен» (reasons: заказ уже принят / пассажир выбрал другого водителя / заказ отменён / заказ истёк) | Найти другие заказы · Вернуться в ленту |

#### Shared fallback states

These states are role-agnostic — they cover the rendering surface before
the role split applies and when the order cannot be resolved at all.

| # | State | UI status / chip | Renders | Actions |
|---|---|---|---|---|
| S1 | **Loading** | «Загружаем заказ» | spinner / skeleton card | (none — transient) |
| S2 | **Error / Not Found** | «Заказ не найден» | empty illustration / explanation copy | Вернуться в ленту · Найти другие заказы |

`S1` is the first paint while `mock_api.getOrderById()` resolves; `S2` is
the terminal "we can't find this order" surface (malformed deep-link id,
`getOrderById()` returns `null`, or backing store unavailable). Neither
state exposes accept / offer / select-driver affordances.

#### Data contract

`Order`:
- `id`, `status`, `roleView`, `passengerId`, `selectedDriverId`
- `pickup`, `dropoff`, `time`, `price`, `budget`, `comment`
- `createdAt`, `expiresAt`

`DriverOffer`:
- `id`, `orderId`, `driverId`
- `driverName`, `car`, `rating`, `etaMin`, `price`, `message`
- `status` ∈ {`sent`, `accepted`, `rejected`, `withdrawn`, `expired`}
- `createdAt`, `expiresAt`

#### Stored order shape compatibility (current mock data)

The contract above is the **target** shape. Until a backend schema exists,
the canonical store `bazardrive.ride_orders.v1` (owned by `mock_api.js`)
persists today's mock-order shape, which uses different field names. Order
Detail derives / maps the contract fields from the stored shape so a
future migration changes the store, not the contract:

| Contract field | Source in current mock store | Notes |
|---|---|---|
| `passengerId` | `passenger.authorId` (or `passenger.id` if present) | The mock store keeps the requester under a nested `passenger` object. |
| `time` | `scheduledAt` | The stored `scheduledAt` is the trip's scheduled timestamp; `time` is the rendered form. |
| `price` / `budget` | `estimatedPrice` (numeric) | **Both `price` and `budget` derive from the numeric `estimatedPrice` field.** `estimatedPriceLabel` is the pre-formatted display string ("1 500 ₽") used by today's renderers and is **presentation-only** — it must not be parsed back into a number for the «Выше бюджета» comparison (which needs a numeric anchor). The future implementation reads `estimatedPrice`. |
| `createdAt` | `createdAt` | Same name in both shapes. |
| `expiresAt` | _(absent in current mock orders — optional)_ | Today's `bazardrive.ride_orders.v1` rows do **not** carry an `expiresAt`. The Order Detail contract treats it as optional: when reading, missing values fall through to `Infinity` for offer-expiry computations (see P0 product rule #3); the future implementation may start populating it without contract drift. |
| `roleView` | **Derived from `?role=` / session, NOT stored.** | `roleView ∈ {passenger, driver}` is a render-time discriminator off the URL/session — never persisted on the order record, never written by Order Detail. |

`DriverOffer` is a **new** entity owned by the future implementation in
the planned `bazardrive.driver_offers.v1` store. There is no current
mapping for it in `bazardrive.ride_orders.v1` — the contract owns the
shape outright.

#### Order-store writes (Model B)

These writes are the **BD-ORDER-DETAIL-01D** behaviour. BD-ORDER-DETAIL-01C
documents them but does not perform any of them; its runtime shell keeps all
mutating CTAs as non-mutating toast stubs.

| Actor | Action | Order-store write | DriverOffer-store write | active_ride seed |
|---|---|---|---|---|
| Driver | taps «Откликнуться на заказ» | **None.** `Order.status` and `Order.selectedDriverId` are never written by the driver tap. | Creates `DriverOffer(status='sent')` against `orderId` + `driverId`. | None. |
| Passenger | taps «Выбрать водителя» on a `DriverOffer` | Writes `Order.selectedDriverId = offer.driverId` and `Order.status = 'ACCEPTED'` atomically. (`'ACCEPTED'` is the canonical enum value from `ride_state.js`; the UI chip text «Заказ принят» is rendered, not stored.) | Selected offer flips to `status='accepted'`. **Only active competing offers for the same `orderId` with `status='sent'`** flip to `status='rejected'`. Terminal offers (`status='withdrawn'`, `status='expired'`) are **preserved verbatim** — never overwritten. | Seeds `bazardrive.active_ride.v1` for `tripId = trip_${order.id}` with `status = 'ACCEPTED'` and the selected driver / vehicle snapshot. The P3 «Открыть поездку» CTA hands off to `/active-ride?role=passenger&tripId=trip_${order.id}` using that seed. |
| Passenger | taps «Отменить заказ» (P1) | Writes the order overlay record `{ status: 'CANCELED', canceledBy: 'passenger', canceledAt, updatedAt }` via `cancelOrderByPassenger({ orderId })`. `selectedDriverId` from a prior 01D-2A commit stays unchanged. | **01D-2C-C sync:** every active `status='sent'` DriverOffer for this `orderId` flips to a terminal record with `status='rejected'`, `rejectedBy='passenger_cancel'`, `rejectedReason='order_canceled_by_passenger'`, `rejectedAt`, `updatedAt` via `rejectSentOffersForPassengerCanceledOrder({ orderId, allOffers })`. Terminal offers (`accepted` / `withdrawn` / `expired` / pre-existing `rejected`) and cross-order offers are preserved verbatim. Snapshot fallback covers fixture-only sent offers without a store baseline. | None — `bazardrive.active_ride.v1` is untouched. |
| Passenger | taps «Отклонить» on a single `DriverOffer` (P2) | **None.** The order keeps its current status (typically `CREATED`); `selectedDriverId` stays untouched — rejecting one offer does not pick a winner. | Only that single offer flips from `status='sent'` → `status='rejected'`. Other offers, including other sent ones, stay untouched and remain selectable. | None. |
| Driver | taps «Отозвать оффер» (D2) | None. | Own offer flips to `status='withdrawn'`. | None. |
| Driver | taps «Отменить» (D3, assigned driver) | Writes the order overlay record `{ status: 'CANCELED', canceledBy: 'driver', canceledAt, updatedAt }` via `cancelOrderByDriver({ orderId, driverId })`. `selectedDriverId` preserved (the assignment record stays on the overlay). | **None.** The accepted offer stays `accepted` — driver cancel does NOT flip it back to `sent` or `rejected`. Peer offers (rejected/withdrawn/expired from prior transitions) preserved verbatim. | None — `bazardrive.active_ride.v1` is untouched. |
| Driver | taps «Отменить» on D3 (active assignment) | **Delegated to the canonical active-ride cancellation handoff.** This row does not directly mutate `Order.status` — the active-ride flow (`renderCanceledStub` / `persistDriverCancel` in `active_ride.js`) owns the terminal write into `bazardrive.active_ride.v1` and the canonical `ride_orders.v1` mirror, per BD-RIDE-D-SHEETS-02. Whether the underlying `Order.status` flips to `'CANCELED'` is the active-ride / backend policy decision, **not** an Order-Detail-side write. | None directly. The active-ride cancel flow may sync the assigned offer's status; the contract does not prescribe that here. | None — the seed already exists; the active-ride lifecycle owns it. |
| System / TTL | offer's `expiresAt` passes | None. | Offer flips to `status='expired'` and stops counting as a candidate. | None. |

#### P0 product rules

1. **Over-budget offers are allowed.** If `offer.price > order.budget`, the offer card MUST render the badge `«Выше бюджета»`. The passenger still picks the winner; budget is informational.
2. **Order Detail remains accessible after accept.** Once `Order.status = 'ACCEPTED'` (rendered as the UI chip «Заказ принят»), the screen does NOT redirect to active ride. The primary action becomes **«Открыть поездку»**; the canonical active-ride runtime (`/active-ride`) stays the source of truth for the trip lifecycle.
3. **`DriverOffer` carries its own `expiresAt`.** Suggested default: `expiresAt = min(Order.expiresAt ?? Infinity, createdAt + 15 minutes)`. `Order.expiresAt` is optional in today's mock orders; when absent, the offer falls back to `createdAt + 15 minutes`. Expired offers transition to `status='expired'` and stop counting as candidates.

#### Status language (canonical Russian)

`Новый заказ` · `Ждём водителя` · `Есть предложения` · `Оффер отправлен` · `Водитель выбран` · `Заказ принят` · `Водитель едет` · `В пути` · `Завершён` · `Отменён` · `Истёк` · `Недоступен`

#### Out of scope (01C runtime shell)

- **No backend.** No sockets, no realtime push. The future implementation persists offers in `bazardrive.driver_offers.v1` only.
- **No Mapbox.** Map preview stays a `createMapShell()` placeholder. No SDK, no token, no `api.mapbox.com`, no `fetch(`.
- **No payment.** Card / charge UI lives on the COMPLETED handoff, not here.
- **No inline `<script>` / inline `style=""`** (CSP-clean assumption); markup-only.
- **No CSP / package changes.** Service worker was updated only to precache the new `order_detail.js` runtime file and bump the cache version.

#### Acceptance (01C runtime shell)

Runtime route exists: `register('/order', orderDetail)` plus dynamic `/order/<id>` fallback in `router.js`. `public/src/screens/order_detail.js` is shipped and `scripts/smoke-order-detail-contract.mjs` pins (a) Model B chosen + Models A/C forbidden, (b) the route shape and role split (`roleView ∈ {passenger, driver}`, "Ваш заказ" / "Просмотр водителя" chips), (c) exact D1 driver CTA button text `Откликнуться на заказ` + bare forbidden regression labels absent from rendered D1 markup, (d) canonical stored enum `Order.status='ACCEPTED'` with «Заказ принят» as UI chip only, (e) every passenger + driver + fallback state above and their UI status chips, (f) terminal / locked / S2 states expose no accept/offer/select-driver affordance, (g) offer-list rendering + empty-offers state, (h) over-budget badge rule, (i) post-accept «Открыть поездку» rule, (j) driver `EXPIRED` orders resolve to D4 and expose no offer CTA, (k) no `fetch(` / `api.mapbox.com` / token / inline script/style in runtime, and (l) `public/sw.js` precaches `order_detail.js` with a VERSION bump.

### BD-RULES-01 - Rules

| Field | Contract |
|---|---|
| Route | `/rules` |
| File | `public/src/screens/rules.js` |
| Data | Static local content. |
| Main states | Rules sections. |
| Actions | Navigation only. |
| Acceptance | Bottom tab highlights `Правила`. |

### BD-MAP-01 - MapHome

| Field | Contract |
|---|---|
| Route | `/map` |
| File | `public/src/screens/map.js` |
| Storage | `bazardrive.map_prefs.v1` as device preference if used. |
| Map layer | `createMapShell()` only. No Mapbox SDK. |
| Main states | Home map, location prompt, nearby orders preview, fallback copy. |
| Actions | My location mock, choose route, orders nearby, route to driver map for driver role through `app.js`. |
| Acceptance | Works without token, network, or geolocation permission. |

### BD-MAP-02 - LocationPermission

| Field | Contract |
|---|---|
| Route | `/location-permission` |
| File | `public/src/screens/location_permission.js` |
| Data | Local UI state only. |
| Main states | Explain permission, denied/fallback, manual choice. |
| Actions | Allow mock, choose manually, back to map/route picker. |
| Acceptance | Does not trigger a native permission prompt unless future real geo issue says so. |

### BD-MAP-03 - RoutePicker

| Field | Contract |
|---|---|
| Route | `/route-picker` |
| File | `public/src/screens/route_picker.js` |
| Storage | `bazardrive.route_draft.v1` |
| Main states | Pickup focus, dropoff focus, route ready, malformed draft fallback, clear state. |
| Actions | Set pickup, set dropoff, swap, clear point, clear all, continue to `/route-preview`. |
| Acceptance | Clear only touches route draft, not composer draft, feed, profile, orders or active ride. |

### BD-MAP-04 - RoutePreview

| Field | Contract |
|---|---|
| Route | `/route-preview` |
| File | `public/src/screens/route_preview.js` |
| Storage | Reads `bazardrive.route_draft.v1`. |
| Main states | Valid route summary, missing draft, malformed draft, manual fallback. |
| Actions | Create order, edit route, clear route/back. |
| Acceptance | Computes/shows distance, duration, estimated price from local mock data only. |

### BD-MAP-05 - OrderMapDraft

| Field | Contract |
|---|---|
| Route | `/order-map-draft` |
| File | `public/src/screens/order_map_draft.js` |
| Storage | Reads `bazardrive.route_draft.v1`; writes `bazardrive.order_form.v1` and `bazardrive.ride_orders.v1`. |
| Main states | Valid route form, missing route, validation feedback, publishing, success. |
| Actions | Publish order, edit route, set now/later, set price/comment, go to my order/feed. |
| Acceptance | Publish CTA always gives visible feedback and never silently fails. |

### BD-DRIVER-01 / BD-DRIVER-02 - DriverMap

| Field | Contract |
|---|---|
| Route | `/driver-map` |
| File | `public/src/screens/driver_map.js` |
| Data | `listNearbyOrders()` and `acceptCanonicalRideOrder()` mock flow. |
| Guard | Two gates. Role gate (BD-ROLE-01): non-driver roles see a safe passenger fallback. Readiness gate (BD-DRIVER-02): a `role=driver` who is not `isDriverLineReady()` sees the readiness gate, not the working surface. |
| Variants | `ready` (working order list) \| `not_ready` (readiness banner + read-only checklist + LOCKED orders) \| `non_driver` (existing passenger guard). |
| Main states | Order list, empty, accepted handoff, not_ready gate. |
| Actions | ready: accept order, create test order, open feed/map, go to active ride. not_ready: «Завершить готовность» → `/profile` only — no accept action is rendered. |
| Acceptance | Uses MapShell placeholder and local ride order store only. Readiness derives from the single `isDriverLineReady()` rule in `state.js` (shared with Profile), so the gate and the Profile readiness card cannot drift. Covered by `scripts/smoke-driver-map-readiness.mjs`. |

### BD-RIDE-D-01..09 - Active ride driver

| Field | Contract |
|---|---|
| Route | `/active-ride?role=driver` |
| File | `public/src/screens/active_ride.js` |
| Storage | `bazardrive.active_ride.v1`, ride history, chat helpers. |
| Main states | NEW_ORDER, ACCEPTED, DRIVER_EN_ROUTE, DRIVER_APPROACHING_PICKUP, WAITING_PASSENGER, IN_PROGRESS, COMPLETED, CANCELED, NO_SHOW. |
| Actions | Accept, arrived, start, complete, cancel sheet, problem sheet, earnings sheet, chat/nav/phone stubs. |
| Acceptance | Driver state changes go through `ride_state.js`; passenger renderer is not duplicated here. |
| Helper modules (no route) | `public/src/screens/active_ride_driver_sheets.js` (BD-RIDE-D-SHEETS-01 cancel + problem bottom sheets, plus the driver earnings overlay opener `openDriverEarningsSheet`) and `public/src/screens/active_ride_passenger_sheets.js` (passenger sheets, imported only by the passenger screen). The earnings sheet uses `driver-sheet__*` / `styles/driver_sheets.css`. |

### BD-RIDE-D-ERROR-01 - Driver active-ride error states

**Status: Planned / contract-only — none of the four states are wired in runtime.** `retry status sync` is **deferred until a backend ride-events / async mutation contract** exists; the dedicated in-screen error UI is Cloud Design render-needed. Error/offline handling for the live driver ride. Distinct from BD-ERROR-01A (the app-shell overlay) and from BD-RIDE-D-NOSHOW-01 (the terminal no-show flow). No own route — these states would layer onto `/active-ride?role=driver`.

| Field | Contract |
|---|---|
| Route | `/active-ride?role=driver` (in-screen states; no own route) |
| File | `public/src/screens/active_ride.js` (no runtime change shipped under this contract) |
| Storage | `bazardrive.active_ride.v1` (status persisted via `ride_state.js` → `mock_api.updateTripStatus`) |
| Data source | mock / localStorage today; a real ride-events backend is out of scope |
| Main states (4) | 1. **offline while on ride** — already surfaced by the **global app-shell offline overlay** (BD-ERROR-01B connection watcher on `navigator.onLine`); **no in-screen UI is added** for it here. 2. **GPS unavailable** — **out of scope until a Mapbox/geolocation slice** (no real geolocation is wired; not mocked). 3. **retry status sync** — **deferred, not wired in runtime.** A driver status-change mutation that fails to sync *would* route through the global `server_error` overlay with a guarded retry. A first synchronous attempt (BD-RIDE-D-ERROR-01B) was **closed unmerged as premature** — a correct guard requires a real backend / async mutation contract: (i) **async** mutations (a sync `try/catch` cannot catch a future Promise rejection); (ii) **rollback on a partial write** (`updateActiveRideStatus` saves before `syncCanonicalOrderStatus`/`updateTripStatus` could fail, so the screen and the persisted record would diverge); (iii) a **stale-route retry guard** (a captured `onRetry` survives navigation on the singleton overlay and would mutate a detached ride); (iv) **side-effect ordering** (the approaching auto-chat write must follow a successful sync, not precede it). Sync localStorage gives no real reject path today. Tracked as **BD-RIDE-D-ERROR-02**. 4. **support fallback** — a "contact support" escalation from an error state; **described only — Cloud Design render-needed / not implemented**. |
| Actions | None wired in this slice — all four states are deferred / render-pending / backend-needed. |
| Acceptance | (a) No new in-screen error UI is invented without a Cloud Design render frame. (b) `offline while on ride` stays owned by the global offline overlay — not re-implemented in-screen. (c) `GPS unavailable` remains out of scope pending a Mapbox/geolocation slice. (d) `support fallback` is contract-only / render-pending. (e) `retry status sync` is **deferred** to BD-RIDE-D-ERROR-02 (backend / async mutation contract) — **no runtime guard is shipped here**; the synchronous attempt was closed as premature for the reasons in state 3. |
| Out of scope | Real Mapbox live tracking; backend ride-events API; real GPS/geolocation; any new bespoke in-screen error UI without a Cloud Design frame; the synchronous status-sync guard (closed unmerged); BD-RIDE-D-NOSHOW-01 (separate). |

### BD-RIDE-D-ERROR-02 - Backend-backed driver status-sync failure semantics (planned / backend-needed)

**Status: Planned — backend-needed.** The correct home for `retry status sync` once a real ride-events backend / async mutation contract exists. Captures the obligations a synchronous guard cannot meet (the BD-RIDE-D-ERROR-01B attempt was closed unmerged because retrofitting backend-failure handling onto the synchronous, side-effect-laden lifecycle generates these as real requirements).

| Field | Contract |
|---|---|
| Route | `/active-ride?role=driver` (no own route) |
| File | `public/src/screens/active_ride.js` (+ a real status-sync data layer, when it exists) |
| Scope | (1) an **async status-mutation contract** for the driver lifecycle; (2) **rollback / transactional** status updates so a failed canonical sync does not leave the active-ride record advanced while the order stays stale; (3) a **stale-route retry guard** (route/`isActive`) so a retry captured on the singleton overlay cannot mutate a ride the driver has navigated away from; (4) **side-effect ordering** so notices like the approaching auto-chat fire only after a successful sync; (5) **cancel / no-show sheet failure semantics** so the cancel sheet does not advance to its success card on a failed sync. |
| Out of scope (until backend) | Any of the above on the current sync localStorage path — there is no real reject path to handle, so wiring it now is premature (see the closed BD-RIDE-D-ERROR-01B). |

### BD-RIDE-D-SHEETS-01 - Driver cancel + problem sheets

| Field | Contract |
|---|---|
| Route | Reused inside `/active-ride?role=driver`, no route of its own. |
| File | `public/src/screens/active_ride_driver_sheets.js` (driver counterpart of `active_ride_passenger_sheets.js`). |
| Exports | `openDriverCancelSheet`, `openDriverProblemSheet`, `openDriverEarningsSheet`, `renderDriverCancelSheet`, `renderDriverProblemSheet`, `renderDriverEarningsSheet`, `bindDriverSheetEvents`, `DRIVER_CANCEL_REASON_LABEL_BY_CODE`. |
| Cancel states | `default → reason_selected → validation_error → loading → canceled`; `other` reveals a custom-reason textarea. Persistence (CANCELED / NO_SHOW) stays in the screen's `onConfirm`; the in-sheet canceled card offers «Вернуться в ленту» / «Закрыть». |
| Problem states | `default → type_selected → loading → sent`; safety-class types flip a `data-safety` danger visual state; optional comment field; pure UI placeholder — never changes ride status. |
| Actions | Cancel: select reason, custom reason, confirm. Problem: select type, comment, submit. Both: close / Esc / backdrop (disabled mid-loading and on the terminal card). |
| Acceptance | No inline styles (`active-ride-driver-sheet__*` / `driver-cancel-sheet__*` / `driver-problem-sheet__*` in `cloud.css`); the screen imports the openers and does not redefine them inline; the problem sheet never persists ride state. Covered by `scripts/smoke-active-ride-driver-sheets.mjs`. |

### BD-ACTIVE-RIDE-TERM-01 - active_ride cancel actor / terminal visibility

| Field | Contract |
|---|---|
| Scope | The **post-handoff** terminal contract on `bazardrive.active_ride.v1`. Order Detail 01D-2A/B/C/D intentionally never mutates the active-ride store; once an active ride is materialised via the open-trip handoff, the driver / passenger active-ride screens and the `ride_state.js` helpers are the only writers. |
| File | `public/src/ride_state.js` — adds `cancelActiveRide({ tripId, canceledBy, reason, comment })` plus a terminal-regression guard inside `updateActiveRideStatus`. The active-ride screens themselves are unchanged in this slice — they already render the actor-aware terminal copy. |
| `cancelActiveRide` contract | Refuses on `typeof tripId !== 'string'` or empty `tripId`. Refuses on an **unknown** `tripId` (reads through `findActiveRide`, NEVER `getActiveRide` — does NOT auto-create a demo identity for a stale / forged call). Idempotent on any already-terminal status (`CANCELED` / `NO_SHOW` / `COMPLETED`) → returns the existing record verbatim. On success: writes `status='CANCELED'`, `timestamps.canceledAt = new Date().toISOString()`, `cancel.by = canceledBy` (preserved verbatim — `'driver'` / `'passenger'` / `'system'` / any non-empty string passes; missing or non-string degrades to `null` so the render branches fall through to the neutral copy), `cancel.reason` (preserved verbatim when a non-empty string), `cancel.comment` (preserved verbatim when a non-empty string). Every other ride-snapshot field (`passenger`, `driver`, `order`, `route`, `ride`, `waiting`, `timestamps.*` other than `canceledAt`) is preserved verbatim — the cancel must NOT erase the identity data the terminal copy renders against. |
| Terminal-regression guard | `updateActiveRideStatus` now reads through `findActiveRide` first and returns the existing record verbatim when the ride is already in `CANCELED` / `NO_SHOW` / `COMPLETED`. A stale tab — where the click event fires after another tab persisted the terminal transition — therefore cannot rewind a canceled ride to `IN_PROGRESS` / `COMPLETED` / etc. The original auto-create-demo fallback only fires when no terminal record exists. |
| Terminal-write existing-ride requirement | `updateActiveRideStatus` refuses to materialise a demo identity for an **unknown** `tripId` when the requested status is terminal (`CANCELED` / `NO_SHOW` / `COMPLETED`) — returns `null` instead of calling `getActiveRide`. Non-terminal writes keep the legacy auto-create fallback (the driver-accept deep-link path relies on it). |
| `saveActiveRide` terminal-record freeze | `saveActiveRide` reads the existing record for `ride.tripId` first; when `existing.status` is terminal AND `ride.status !== existing.status`, the incoming snapshot is refused and the existing record is returned verbatim. The passenger cancel handler's pre-save (`saveActiveRide(ride)` before `updateActiveRideStatus`) cannot thaw a driver-canceled record back to a non-terminal status, so the driver's `cancel.by` / `cancel.reason` / `canceledAt` are preserved. Idempotent re-save of the same terminal status still passes through (a legitimate caller can patch peer fields on a terminal ride without changing the status). |
| Downstream canonical-sync rule | Callers who fan a status change out to the canonical order store (e.g. `active_ride.js::persistDriverRideStatus` → `syncCanonicalOrderStatus`, `active_ride_passenger.js` cancel handler → `updateTripStatus`) MUST gate the fan-out on `result.status === requestedStatus`. `updateActiveRideStatus` returns the existing terminal record verbatim on refused transitions, so an unconditional `if (canonicalOrderId) updateTripStatus(canonicalOrderId, CANCELED)` would leak the stale requested status onto the canonical order when the active-ride store already holds a different terminal record (driver-completed vs passenger-cancel race, etc.). |
| Simulated-ride pre-save bridge | Screens that build an in-memory ride for a status-simulated tripId (e.g. `/active-ride?role=driver&tripId=new-id&status=IN_PROGRESS` → `createDemoActiveRide` without an immediate `saveActiveRide`) MUST persist the in-memory snapshot before triggering a terminal transition. `active_ride.js::persistDriverRideStatus` does this by calling `saveActiveRide(ride)` once when `findActiveRide(ride.tripId)` returns null — so the terminal-write existing-ride requirement above always sees a canonical record on a legitimate Finish / No-show / Cancel click and never blocks a screen-driven action. |
| Driver D4 / canceled stub | `active_ride.js::renderCanceledStub` already differentiates by `cancel.by`: `NO_SHOW` → «Пассажир не вышел»; `cancel.by === 'passenger'` → «Пассажир отменил заказ»; default driver-cancel → «Заказ отменён». Only safe exits: «Вернуться на линию» + «Открыть историю» — no «Отменить», no «Я на месте», no «Начать поездку», no «Завершить». |
| Passenger P4 / cancel fallback | `active_ride_passenger.js::renderPassengerCanceledFallback` already differentiates: `NO_SHOW` → «Водитель отметил, что не дождался вас.»; `cancel.by === 'passenger'` → «Вы отменили эту поездку.»; `cancel.by === 'driver'` → «Водитель отменил эту поездку.»; absent / unknown → neutral «Мы закрыли эту поездку.». Only safe exits: «Создать новую поездку» (CANCELED only, not NO_SHOW) + «Вернуться на главную». Early-returns BEFORE the active sheet / map pipeline, so no active CTAs leak through. |
| Sheets stay UI-only | `active_ride_driver_sheets.js` + `active_ride_passenger_sheets.js` never call `updateActiveRideStatus` / `saveActiveRide` / `cancelActiveRide` directly. Persistence happens in the screen's `onConfirm` callback that funnels through `persistDriverCancel` → `persistDriverRideStatus` → `updateActiveRideStatus` (driver) or `updateActiveRideStatus(tripId, RIDE_STATUS.CANCELED, { cancel: { by: 'passenger', reason, comment } })` (passenger). |
| Store isolation | `cancelActiveRide` writes ONLY `bazardrive.active_ride.v1`. It does NOT touch `bazardrive.order_overlay.v1` or `bazardrive.driver_offers.v1` — the Order Detail cancel paths and the active-ride cancel are independent (a passenger who cancels the active ride after the open-trip handoff does NOT trigger the 01D-2C-C DriverOffer sync, and vice versa). |
| Out of scope | Backend, Mapbox, payment, notifications, chat, route registration, role resolver, Order Detail 01D semantics, active-ride screen redesign, completed / receipt / history changes. |
| Acceptance | `node scripts/check.mjs` green (includes `scripts/smoke-active-ride-cancel-terminal.mjs` with T1–T15 — 112 assertions covering helper contract, unknown-tripId refusal, terminal-regression guard, terminal-write existing-ride requirement, `saveActiveRide` terminal freeze, downstream canonical-sync gate, simulated-ride pre-save bridge, passenger-canonical actual-transition gate, NO_SHOW idempotency, unknown / system / null actor preservation, snapshot preservation, no Order-overlay write, source-level guards). `node scripts/dispatcher.mjs` clean. |

### BD-RIDE-HISTORY-TERM-01 - terminal ride history / receipt propagation

| Field | Contract |
|---|---|
| Scope | Locks the **downstream** terminal contract on the ride-history + driver-receipt surfaces (`ride_history.js`, `mock_api.js` receipt API, `trip_receipt.js`). BD-ACTIVE-RIDE-TERM-01 already locks the post-handoff active-ride store; this slice guarantees terminal `CANCELED` / `NO_SHOW` rides do NOT leak into completed history or produce a settled receipt, while genuinely `COMPLETED` rides continue to flow through the existing builders / sanitizer untouched. |
| Files (pinned, **no code changes** required) | `public/src/ride_history.js`, `public/src/mock_api.js` (receipt API), `public/src/screens/trip_receipt.js`, `public/src/screens/active_ride.js` (`renderCompleted` / `renderCanceledStub`), `public/src/screens/active_ride_passenger.js` (`renderPassengerRideComplete::persistHistory`, cancel handler `onConfirm`). |
| Completed-only invariant | `saveRideHistoryEntry` and `saveDriverReceipt` are only ever called from a `ride.status === RIDE_STATUS.COMPLETED` code path: driver-side `active_ride.js::renderCompleted` (reached from `renderSheet` when status is COMPLETED) and passenger-side `renderPassengerRideComplete::persistHistory` (reached from `if (ride.status === RIDE_STATUS.COMPLETED) return renderPassengerRideComplete(...)`). Cancel-path renders (`renderCanceledStub` driver, `renderPassengerCanceledFallback` passenger) and the passenger cancel sheet `onConfirm` closure never call either writer. |
| Demo-identity leak prevention | `buildPassengerHistoryEntry` and `buildDriverHistoryEntry` use strict `value \|\| null` fallback on every render-derived field — `driver.name`, `driver.initials`, `driver.rating`, `vehicle.{model,color,plate}`, `passenger.{name,initials,rating}`, route labels, fare / distance / duration. No demo seed string (`'Рустам К.'`, `'Анна М.'`, `'Toyota Camry · серый'`, `SIM_AUDIT_RIDE_OVERRIDES`) can leak into a persisted entry when ride snapshot fields are missing. The render-time fallback in `profile.js` (history pane) is a separate UI concern. |
| Storage isolation | History entries are keyed internally by `` `${role}:${tripId}` `` (`ride_history.js::saveRideHistoryEntry`) so passenger and driver entries for the same `tripId` persist as two independent records. Saving the passenger entry never overwrites the driver entry and vice versa. The ride-history store (`bazardrive.ride_history.v1`) is fully independent from the receipt store (`bazardrive.driver_receipts.v1`); `ride_history.js` does NOT import `mock_api.js` and never writes a receipt. |
| Receipt sanitizer rule | `mock_api.js::sanitizeDriverReceipt` rejects null / non-object / arrays, missing `tripId`, missing or non-finite money fields (`fare` / `commission` / `tip` / `net`), and always stamps `status: 'completed'`. `paymentMode` defaults to `'noncash'` when the input value isn't in `{'cash','noncash'}`. `saveDriverReceipt` upserts by `tripId` (newest write wins) through the sanitizer, so a partial / malformed write can never poison the store. |
| `getReceipt` semantics | Unknown `tripId` → `null` (the trip-receipt screen renders the «Чек не найден» fallback). The canonical demo receipt `tripId: '48-321'` is the intentional render-gate fallback so the manual URL `/receipt?tripId=48-321` always resolves a settled document without first driving a live completion. CANCELED / NO_SHOW rides have no receipt in the store and therefore resolve to the missing fallback. |
| `trip_receipt.js` read-only contract | Imports ONLY `getReceipt` from `mock_api.js`. Does NOT import `ride_state.js`, `active_ride*`, or `ride_history.js`. Never calls `fetch`, references `mapbox`, mutates `localStorage`, or invokes `saveDriverReceipt` / `saveRideHistoryEntry` / `updateActiveRideStatus` / `saveActiveRide`. Renders stored values verbatim — no arithmetic across `receipt.fare` / `commission` / `tip` / `net` (the «net computed once» invariant from BD-RIDE-D-09). Missing-receipt fallback contains the «Чек не найден» copy and explicitly does NOT carry «Завершено и рассчитано», «Ваш доход за поездку», the «Завершено» status badge, or the payment-mode labels «Оплата наличными» / «Безналичный расчёт». Settled-receipt copy carries all of those. |
| Out of scope | Backend, Mapbox, payment, notifications, chat, active-ride lifecycle changes, Order Detail semantics, route registration, receipt recalculation, financial math. No new helpers added in this slice — the contract is enforced by `caller discipline + sanitizer + smoke`. |
| Acceptance | `node scripts/check.mjs` green (includes `scripts/smoke-ride-history-terminal.mjs` with sections A / A1–A5 / B / B1–B3 / C1–C4 / D / E / E1 / E2 / F / G / H — 117 assertions covering module surface, builder fallbacks, receipt sanitizer, cancel-path source guards, COMPLETED-gate site pins, role-scoped storage, trip_receipt isolation + missing-fallback copy invariants, and end-to-end propagation). `node scripts/dispatcher.mjs` clean. |

### BD-ROUTE-TEMPLATE-TERM-01 - repeat / favorite route terminal source audit

| Field | Contract |
|---|---|
| Scope | Locks the **route-template bridge** between ride history and the composer. The «Повторить маршрут» (`repeat_route.js`) and «В избранные» / favorite-repeat (`favorite_routes.js`) actions are route-only templates — they MUST never carry terminal actor / identity / payment / receipt / earnings / chat / vehicle metadata from a completed-or-canceled ride into a fresh composer draft. BD-RIDE-HISTORY-TERM-01 locked the upstream history + receipt surfaces; this slice locks the sibling bridge. |
| Files (pinned, **no code changes** required) | `public/src/repeat_route.js`, `public/src/favorite_routes.js`. Architecture already enforces the contract via the existing whitelist sanitizers (`buildRepeatRouteDraft` returns `{role, pickup, dropoff, suggestedFare?}` only; `sanitizeFavorite` whitelists the favorite-route shape; `peekFavoriteNotice` whitelists the notice payload to `{source, label}`). |
| Repeat-route bridge shape | `buildRepeatRouteDraft(entry)` returns `{ role: 'passenger'\|'driver', pickup, dropoff, suggestedFare? }` — strict whitelist. `cleanNumber` parses `"1 480 ₽"` → `1480`, drops negatives / non-numeric / `NaN` / `Infinity`. Any non-driver role normalises to `'passenger'`. Missing or whitespace-only pickup / dropoff returns `null`. Writers (`writeRepeatRouteDraft`) and readers (`peekRepeatRouteDraft`, `consumeRepeatRouteDraft`) BOTH re-sanitize, so a poisoned `bazardrive.repeat_route.v1` payload cannot leak identity / payment / receipt / status fields. `consumeRepeatRouteDraft` removes the key on malformed payloads too (no wedge on next visit). |
| Favorite-route bridge shape | `saveFavoriteRouteFromHistory(entry)` funnels through `buildRepeatRouteDraft` THEN `sanitizeFavorite`, so the favorite record carries ONLY `{id, source, sourceRideId, role, label, customLabel, pickup, dropoff, savedAt, lastUsedAt, suggestedFare?, distanceKm?, durationMin?}`. `sourceRideId` is preserved for traceability (the ONLY non-route identity field allowed). Duplicate routes (matching `pickup→dropoff` lowercase key) update the existing record in place — `id`, `savedAt`, and `customLabel` are preserved across the update. `loadFavoriteRoutes` re-sanitizes on read so a poisoned `bazardrive.favorite_routes.v1` payload cannot leak terminal fields. |
| Favorite notice payload | `writeFavoriteNotice(favorite)` writes EXACTLY `{source: 'favorite', label}`. `peekFavoriteNotice` re-sanitizes on read — a poisoned `bazardrive.favorite_route_notice.v1` payload carrying smuggled actor / payment / receipt fields surfaces as `{source, label}` only. `consumeFavoriteNotice` (internal) follows the same sanitizer. |
| Terminal entries (CANCELED / NO_SHOW) | A CANCELED or NO_SHOW history entry CAN still be repeated or favorited — the route is the bridge data, not the terminal status. The persisted draft / favorite contains NO `cancel.by`, `cancel.reason`, `canceledBy`, `canceledAt`, `noShowAt`, `status`, `payment`, `receipt`, or `earnings`. The serialised JSON of the draft / favorite contains no smuggled content markers (`"car_problem"`, `"noncash"`, `"Stale ..."`, etc.). |
| Source isolation | `repeat_route.js` and `favorite_routes.js` do NOT import `mock_api.js`, `ride_state.js`, `active_ride*`, or `driver_offer_store.js`. Neither calls `fetch`, references `mapbox`, or writes the receipt / active-ride / order-overlay / DriverOffer stores. Storage key allow-list: `repeat_route.js` writes ONLY `bazardrive.repeat_route.v1`; `favorite_routes.js` writes ONLY `bazardrive.favorite_routes.v1` + `bazardrive.favorite_route_notice.v1` (the `bazardrive.repeat_route.v1` handoff flows through `repeat_route.js::writeRepeatRouteDraft`, NOT a direct write from `favorite_routes.js`). |
| Out of scope | Backend, Mapbox, payment, notifications, chat, active-ride lifecycle, Order Detail 01D semantics, receipt recalculation, route registration, role resolver, CSP, no new helpers added — the contract is enforced by `existing sanitizers + smoke`. |
| Acceptance | `node scripts/check.mjs` green (includes `scripts/smoke-route-template-terminal.mjs` with sections A / A1–A5 / B / B1–B6 / C / C1–C6 / D / D1–D4 / E / E1–E4 / F / F1–F3 — **362 assertions** covering whitelist builder shape, fare parser edges, poisoned-localStorage sanitizer on both peek and consume, favorite duplicate-update + customLabel preservation, removeFavoriteRoute scope, favorite notice `{source, label}` whitelist, CANCELED / NO_SHOW terminal negative pins, end-to-end favorite→repeat handoff persisted-shape pin, and full source-isolation guards for both modules). `node scripts/dispatcher.mjs` clean. |

### BD-ORDER-DETAIL-01D-3 - selected-driver / active-ride consistency audit

| Field | Contract |
|---|---|
| Scope | Consistency audit spanning the passenger select-driver commit (01D-2A), the open-trip active-ride seed (01D-2B), the cancel surfaces (01D-2C-A/01D-2C-B/01D-2C-C/01D-2D), and the active-ride terminal contract (BD-ACTIVE-RIDE-TERM-01). Locks the cross-surface invariant: once the passenger selects driver A, every downstream reader (D3 driver card, open-trip seed, persisted active-ride record, passenger active-ride renderer) sees the SAME `selectedDriverId`, the SAME route, the SAME passenger snapshot, and the SAME driver snapshot — and stale peer offers can never pose as the selected driver through any path. |
| Files (pinned, **no code changes** required) | `public/src/screens/order_detail.js` (`commitPassengerSelection` caller, `canOpenTrip`, `buildPassengerActiveRideSeed`, `resolveState`, `renderOrderDetailMarkup`), `public/src/driver_offer_store.js` (`commitPassengerSelection`, `getOrderOverlay`, `cancelOrderByPassenger`), `public/src/ride_state.js` (`saveActiveRide`, `findActiveRide`). All invariants enforced by existing helpers; no runtime changes. |
| Selectability invariant | `commitPassengerSelection({orderId, selectedDriverId, allOffers})` only accepts targets whose stored baseline status is `'sent'`. The stale-store guard refuses on a non-sent baseline even if the snapshot claims `'sent'`. Pre-existing terminal offers (`withdrawn` / `expired` / `rejected`) are preserved verbatim through the commit AND cannot be nominated as the selected driver from a stale snapshot. After commit, competing sent peers flip to `rejected` and the chosen offer's `status='accepted'` makes it ineligible for a second commit. |
| Seed-snapshot invariant | `buildPassengerActiveRideSeed(order)` pulls `driverName` / `car` / `rating` / `etaMin` / `price` from the chosen offer's snapshot in `order.offers.find(o => o.driverId === order.selectedDriverId)` — NEVER from `DEMO_ACTIVE_RIDE_ID` or the active-ride store's demo seed. `seed.tripId` is ALWAYS derived canonically as `trip_${order.id}` — a stale or demo `order.tripId` planted on the merged snapshot is ignored (the previous `order.tripId \|\| trip_${order.id}` fallback was tightened in 01D-3 because it let a hostile snapshot place the active-ride record under the wrong key). `seed.selectedDriverId = order.selectedDriverId`, `seed.role = 'passenger'`, `seed.seededFrom = 'order_detail_passenger_handoff'`. Passenger snapshot fields (`passenger.name`, `route.pickupLabel`, `route.dropoffLabel`) come from the merged order, not from any fallback. |
| Cross-role consistency | A SELF-selected ACCEPTED order resolves to D3 on the driver side and P3 on the passenger side. The driver D3 markup carries the passenger snapshot name + route from the same merged order the passenger sees on P3. The seed builder, the driver D3 renderer, and the passenger P3 / `/active-ride` renderer all read from the SAME merged-order shape — there's no parallel demo-fallback path. |
| Terminal-order CTA invariant | `CANCELED` and `EXPIRED` orders route to P4 (passenger) and D4 (driver). The rendered markup carries NO `data-action="select-driver"`, NO `data-action="reject-offer"`, NO `data-action="open-trip"`, NO `data-action="driver-cancel"`, NO `data-action="driver-send-offer"`. P4 keeps only `data-action="create-new-order"` + `data-action="back-to-feed"`. D4 keeps only the locked-driver exits. |
| Cancel-vs-active-ride isolation | `cancelOrderByPassenger({orderId})` writes ONLY the order overlay (`bazardrive.order_overlay.v1`). It does NOT touch `bazardrive.active_ride.v1`. A pre-existing active-ride record (e.g. from an earlier 01D-2B open-trip handoff) survives byte-for-byte across the overlay cancel — the active-ride lifecycle is owned by `ride_state.js` and `BD-ACTIVE-RIDE-TERM-01` governs its terminal transitions. Conversely, cancel does NOT create or revive an active-ride record for a tripId that never had a handoff seed. |
| Source guards | `order_detail.js` does NOT import `trip_receipt.js` or `ride_history.js`; never references `getReceipt` / `saveDriverReceipt` / `saveRideHistoryEntry`; never writes the `driver_receipts.v1` or `ride_history.v1` stores. `driver_offer_store.js` does NOT import `active_ride*`, `trip_receipt.js`, `ride_history.js`, or `ride_state.js`; never writes the `active_ride.v1`, `driver_receipts.v1`, or `ride_history.v1` stores. The active-ride handoff funnels through the canonical `ride_state.js::saveActiveRide` helper (imported by `order_detail.js`) — NOT via `DEMO_ACTIVE_RIDE_ID` as a substitute identity (the constant is referenced nowhere in `order_detail.js`). `buildPassengerActiveRideSeed` derives `tripId` from `trip_${order.id}`. The open-trip click handler is the ONLY `saveActiveRide` call site in `order_detail.js` and is gated behind `canOpenTrip` + `findActiveRide` (idempotent re-tap). |
| Out of scope | Mapbox, backend, payment, receipt/history recalculation, route-template bridge, Composer, UI redesign, new status vocabulary. No new helpers added — the contract is enforced by `existing 01D-2A through 01D-2D + BD-ACTIVE-RIDE-TERM-01 helpers + smoke`. |
| Acceptance | `node scripts/check.mjs` green (includes `scripts/smoke-order-detail-active-ride-consistency.mjs` with sections A / B / C / D / E / F / F-poison / G / H / I-CANCELED / I-EXPIRED / J / K1–K5 — **114 assertions** covering module surface, selectability invariant, post-commit overlay + offer-status verification, stale-snapshot retry refusal, seed-snapshot fidelity, **canonical-tripId-derivation pin against a poisoned `order.tripId`**, cross-role D3/P3 consistency, terminal-order CTA absence on BOTH overlay-CANCELED AND fixture-EXPIRED orders using the full forbidden-CTA set, **byte-for-byte preservation of any pre-existing active-ride record across an overlay cancel**, and full source-isolation guards on both `order_detail.js` and `driver_offer_store.js`). `node scripts/dispatcher.mjs` clean. |

### BD-COMPOSER-PREFILL-TERM-01 - composer prefill consumer audit for the route-template line

| Field | Contract |
|---|---|
| Scope | Consumer audit for the route-template bridge locked by BD-ROUTE-TEMPLATE-TERM-01. The composer (`screens/composer.js`) reads the sanitized repeat-route draft via `consumeRepeatRouteDraft()` and the favorite notice via `enhanceComposerNotice` (bolted on from `favorite_routes.js` side); neither path may re-introduce terminal / identity / payment / receipt / earnings / chat / vehicle metadata from a prior ride into the composer draft, the order payload that lands in `bazardrive.ride_orders.v1`, or the favorite-notice UI text. |
| Files (pinned, **no code changes** required) | `public/src/screens/composer.js`, `public/src/repeat_route.js`, `public/src/favorite_routes.js`, `public/src/mock_api.js::createRideOrder`. Architecture already enforces the contract via the existing `applyRepeatRoute` whitelist + `buildRideOrderFromComposerDraft` field allow-list + `createRideOrder` hardcoding `status: 'CREATED'`. |
| `applyRepeatRoute` whitelist | Writes ONLY: `draft.type` (`'trip'` for driver, `'passenger'` for passenger), `draft.from` ← `repeat.pickup`, `draft.to` ← `repeat.dropoff`, and (when `suggestedFare` is present) `draft.price` for driver or `draft.budget` for passenger. The apply path NEVER assigns `driver`, `passenger`, `vehicle`, `phone`, `rating`, `chat`, `messages`, `comment`, `payment`, `receipt`, `earnings`, `status`, `cancel*`, `canceledBy`, `canceledAt`, `noShowAt`, `completedAt`, or `tripId` onto the draft. |
| Draft-collision rule | The composer's screen factory calls `consumeRepeatRouteDraft()` exactly once on mount. When the loaded draft has any non-`type` non-falsy field, the `kept` branch fires — `applyRepeatRoute` is NOT called and `saveDraft` is NOT called, so existing unsaved work survives. When the draft is empty, the `applied` branch fires and the route-template prefill lands. Either way the repeat-route key is consumed (read-and-remove), so a stale draft cannot leak into a later composer session. |
| Publish path whitelist (`buildRideOrderFromComposerDraft`) | Reads ONLY from the collected composer form state (`d`) and the current user (`u` via `state.js::user.get()`). Emits EXACTLY: `type`, `source`, `pickup`, `dropoff`, `distanceKm`, `durationMin`, `estimatedPrice`, `estimatedPriceLabel`, `scheduledMode`, `scheduledAt`, `scheduledLabel`, `comment`, `passenger` (built from `buildPassengerSnapshotFromUser(u, commentText)`). Never emits `driver`, `vehicle`, `rating`, `chat`, `messages`, `payment`, `receipt`, `earnings`, `status`, `cancel*`, `canceledBy`, `canceledAt`, `noShowAt`, `completedAt`, or `tripId`. The publish builder NEVER calls `localStorage`, `findActiveRide`, `getReceipt`, `getActiveRide`, `loadRideHistory`, or `consumeRepeatRouteDraft` (the repeat draft was already consumed at composer mount; the publish path uses the resulting draft state, not the raw template). |
| `createRideOrder` stamp | `mock_api.js::createRideOrder` always stamps `status: 'CREATED'`. The persisted order shape carries `id`, `type`, `source`, `pickup`, `dropoff`, `distanceKm`, `durationMin`, `estimatedPrice`, `estimatedPriceLabel`, `scheduledMode`, `scheduledAt`, `scheduledLabel`, `comment`, `passenger` (sanitised current-user snapshot), `status: 'CREATED'`, `createdAt`. Never carries `cancel*`, `canceledBy`, `canceledAt`, `noShowAt`, `payment`, `receipt`, `earnings`, `chat`, `messages` at create time. **Important nuance**: the legitimate current-user passenger snapshot built by `buildPassengerSnapshotFromUser` is NOT a terminal-template leak — `isCurrentUser: true` is the expected marker. |
| Favorite notice flow (UI-only) | `favorite_routes.js::enhanceComposerNotice` consumes the notice via `consumeFavoriteNotice` (kept internal — not a public export) and ONLY mutates `text.textContent` on the composer-prefill banner. It never calls `saveDraft`, `writeRepeatRouteDraft`, `createRideOrder`, `createFeedPost`, `localStorage.setItem`, or `fetch`. The composer source itself does NOT import `favorite_routes.js` — the notice enhancement is bolted on from the favorite-routes side. |
| Source isolation | `composer.js` does NOT import `ride_state.js`, `active_ride*`, `driver_offer_store.js`, `trip_receipt.js`, `ride_history.js`, or `favorite_routes.js`. Never calls `fetch`, references `mapbox`, or invokes any cancel / receipt / history / DriverOffer writer (`saveDriverReceipt`, `saveRideHistoryEntry`, `updateActiveRideStatus`, `saveActiveRide`, `cancelActiveRide`, `commitPassengerSelection`, `cancelOrderByPassenger`, `cancelOrderByDriver`, `rejectDriverOfferByPassenger`, `rejectSentOffersForPassengerCanceledOrder`, `sendDriverOffer`, `withdrawDriverOffer`, `writeRepeatRouteDraft`, `saveFavoriteRouteFromHistory`). Storage-key allow-list: `composer.js` writes EXACTLY `bazardrive.draft.v2` (every `localStorage.setItem` call uses the `DRAFT_KEY` constant). |
| Out of scope | Backend, Mapbox, payment, notifications, chat, route registration, role resolver, CSP, active-ride lifecycle, Order Detail semantics, receipt recalculation, UI redesign, current-user passenger snapshot semantics. No new helpers added — the contract is enforced by `existing sanitizers + caller discipline + smoke`. |
| Acceptance | `node scripts/check.mjs` green (includes `scripts/smoke-composer-prefill-terminal.mjs` with sections A / A1–A2 / B / C / C1–C3 / D1–D3 / E1–E4 / F / F1–F3 / G — **275 assertions** covering the apply-mapping whitelist, draft-collision branches, one-time consume + no-wedge invariant, publish-payload field allow-list, `createRideOrder` clean-stamp shape, full source-isolation guards, favorite-notice UI-only flow, and the end-to-end poisoned-history → repeat → composer-draft → publish round-trip). `node scripts/dispatcher.mjs` clean. |

### BD-RIDE-HISTORY-D-01 - Driver completed ride receipt

| Field | Contract |
|---|---|
| Route | `/receipt?tripId=<id>` (own route). Render-gate preview: `?state=loading\|missing\|cash\|noncash`. |
| File | `public/src/screens/trip_receipt.js` |
| Storage | `bazardrive.driver_receipts.v1` (canonical receipt store in `mock_api.js`). |
| Receipt object | `{ tripId, completedAt, fare, commission, tip, net, paymentMode, status }`. `commission` is stored signed (negative); `net` is computed **once** in the completed driver earnings flow (`active_ride.js` → `buildDriverEarningsPayload`) and persisted via `saveDriverReceipt`. |
| mock_api helpers | `saveDriverReceipt(receipt)`, `getReceipt(tripId)`, `listDriverReceipts()`, `clearDriverReceiptsStore()`, plus the seeded `DEMO_DRIVER_RECEIPT` (tripId `48-321`). |
| States | C · cash, D · noncash, E · missing-receipt fallback, F · loading/syncing skeleton. |
| Consumers | Ride history rows + detail (Profile), Driver payouts list (`/profile?pane=payouts`) and this screen all **read + format** the same persisted receipt — they never recompute fare/commission/tip/net. |
| Canonical demo | fare 1540, commission −185, tip 120, **net 1475 ₽**, tripId `48-321`, status completed. |
| Acceptance | No inline styles (`trip-receipt__*` in `cloud.css`); reads only the stored receipt; not an active-ride cockpit (no map, no live actions). Covered by `scripts/smoke-driver-receipt-no-drift.mjs`. |

### BD-RIDE-P-01..07 - Active ride passenger

| Field | Contract |
|---|---|
| Route | `/active-ride?role=passenger` |
| File | `public/src/screens/active_ride_passenger.js` |
| Storage | Reads same `bazardrive.active_ride.v1`; writes cancel/safety UI actions where needed. |
| Main states | ACCEPTED, DRIVER_EN_ROUTE, DRIVER_APPROACHING_PICKUP, WAITING_PASSENGER, IN_PROGRESS, COMPLETED, CANCELED, NO_SHOW. |
| Actions | Message driver, phone stub, cancel sheet, safety sheet, done/new ride. |
| Query params | `?status=<main state>` (view-only override, no persist); `?phase=ARRIVING_DROPOFF` (IN_PROGRESS dropoff sub-phase overlay); `?payment=auto\|pending\|paid` (COMPLETED charge presentation, default `auto`). QA/audit simulation only. |
| Acceptance | Same tripId as driver view, same status enum, role-specific UI only. |

*Query-params row synced by BD-RIDE-P-13 (docs sync after BD-RIDE-P-11 audit + BD-RIDE-P-12 smoke guard); params already exist in `active_ride_passenger.js` — no runtime change.*

### BD-RIDE-F-02 - MapShell placeholder

| Field | Contract |
|---|---|
| Route | Reused component, no route. |
| File | `public/src/mapbox/map_shell.js` |
| Purpose | Dark DOM map placeholder for ride/map screens. |
| Constraints | No SDK, no token, no network, no tile cache. |
| Acceptance | Can render route line, pickup/dropoff/car markers as static DOM. |

### BD-MAP-FOUND-03 - Driver Markers Layer (foundation stub)

| Field | Contract |
|---|---|
| Route | Reused module, no route. |
| File | `public/src/mapbox/driver_markers.js` |
| Purpose | Foundation stub for plotting driver/order markers onto the MapShell placeholder. No-op / pure helpers until BD-MAP-FOUND-01 wires the real Mapbox layer. |
| Exports | `createDriverMarkersLayer(options)`, `renderDriverMarkers(mapShell, orders, options)`, `clearDriverMarkers(layer)`, `getDriverMarkerSummary(orders)`. |
| Summary contract | `getDriverMarkerSummary(orders)` returns `{ total, withCoords, withPrice }`. `total` = order count. `withCoords` counts orders whose `pickup.lng` AND `pickup.lat` are finite numbers (`Number.isFinite`); rejects `NaN`, `Infinity`, `-Infinity`, strings, null, undefined, missing `pickup`. `withPrice` counts orders where any of `estimatedPrice`, `estimatedPriceLabel`, `offerPrice`, `price` is a finite number OR a trimmed non-empty string that is not (case-insensitive) `"nan"` / `"infinity"` / `"-infinity"`. `0` is a valid price; whitespace-only strings are not. |
| Constraints | No real Mapbox SDK, no token, no network, no CDN, no inline style. Safe no-op without a real map. |
| Acceptance | Exports stable contract; `renderDriverMarkers` returns an empty layer when no DOM map is present; `getDriverMarkerSummary` is a pure counter. |

### BD-MAP-FOUND-04 - Trip Status Layer (foundation stub)

| Field | Contract |
|---|---|
| Route | Reused module, no route. |
| File | `public/src/mapbox/trip_status_layer.js` |
| Purpose | Foundation stub for reflecting active-ride status on the MapShell placeholder. No-op / pure helpers until BD-MAP-FOUND-01 wires the real Mapbox layer. |
| Exports | `createTripStatusLayer(options)`, `renderTripStatusLayer(mapShell, trip, options)`, `clearTripStatusLayer(layer)`, `getTripStatusVisualState(status)`. |
| Status vocabulary | Mirrors `RIDE_STATUS`: NEW_ORDER, DRIVER_EN_ROUTE, DRIVER_APPROACHING_PICKUP, WAITING_PASSENGER, IN_PROGRESS, COMPLETED, CANCELED, NO_SHOW. |
| Constraints | No real Mapbox SDK, no token, no network, no CDN, no inline style. Safe no-op without a real map. |
| Acceptance | `getTripStatusVisualState` resolves every RIDE_STATUS to a visual descriptor and falls back safely for unknown input; `renderTripStatusLayer` returns the descriptor when no DOM map is present. |

---

## 5. Known gaps that remain true

| Gap | Why it remains open |
|---|---|
| Real Mapbox SDK | Separate Phase 4 issue. Requires CSP and SW update. |
| ~~`driver_markers.js` and `trip_status_layer.js` stubs~~ | Resolved (BD-MAP-FOUND-03 / BD-MAP-FOUND-04): both foundation stubs now exist in `public/src/mapbox/` as no-op / pure-helper modules (no real Mapbox, no token, no network), precached in `sw.js` and guarded by `scripts/smoke-mapbox-foundation-stubs.mjs`. |
| Driver no-show full flow | The no-show action exists as a stub/toast path and needs a dedicated issue before becoming a full state flow. |
| ~~DriverMap readiness gate~~ | Resolved (BD-DRIVER-02): `/driver-map` now enforces `isDriverLineReady()` — the shared `state.js` rule — alongside the role guard. |
| Backend/auth/payments/uploads/push/APK | Out of scope for the current PWA mock spine. |
| Automated tests | `node scripts/check.mjs` is the current guard; node:test coverage remains technical debt. |

---

## 6. Non-negotiable constraints

```text
no backend API
no real Mapbox SDK in docs-only or mock-screen work
no APK / Android / TWA in this repo phase
no inline script/style/on* handlers
no CSP weakening
no replacing public/index.html with prototype HTML
no renaming localStorage keys without migration and storage-boundary update
no new user-scoped storage without a clear helper or explicit exemption
```
