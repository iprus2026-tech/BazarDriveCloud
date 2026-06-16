# BD-SCREEN-AUDIT-02 — Cloud Design screen inventory + missing render gates

> Design audit / screen inventory only. **No implementation code is changed by
> this document** and no backend / API / Auth / Mapbox / APK scope is introduced.
> Where a screen already exists, the entry is **audit + delta**, not a redesign.

## Method & sources

Audited on this branch against the live runtime, not from memory:

- `public/src/app.js` — the registered route table (source of route truth).
- `public/src/screens/**` — the 28 shipped screen modules.
- `public/src/components/` — **empty** (no extracted component layer today; shared
  UI lives in `public/styles/cloud.css` atoms `bd-card` / `bd-btn` / `bd-scroll` /
  `bd-list-icon` / `bd-section-h` and inline per-screen markup).
- `public/styles/cloud.css` — Cloud Design System atoms.
- `public/prototypes/**` — render-gate HTML/PDF artifacts (reference only; never
  copied into runtime / SW precache).
- `docs/design-registry.json` (updated 2026-06-14) — the canonical screen shelf.
- `docs/screen-map.md`, `docs/missing-screens.md`, `docs/screen-contracts.md` —
  reconciled below (this audit references them, it does not duplicate them).

**Headline finding (docs drift):** `BD-SETTINGS-01` is **shipped and wired** in
runtime (`/settings` registered in `app.js:57`; passenger `#pfp-settings-btn` and
driver `#pf2-gear` both `go('/settings')` in `profile.js`; pinned by
`scripts/smoke-settings.mjs`) — but three docs still describe it as missing:
`design-registry.json` omits it entirely, `missing-screens.md` lists it as P2 "to
implement / register", and `screen-contracts.md` line 177 calls the gear "still
inert / unshipped". This contradiction is the highest-value cleanup this audit
surfaces (and de-risks open issue **#539** to a docs-sync, not an implementation).

---

## 1. Existing implemented screens

Status legend: **render-gate** = shipped + backed by a Cloud Design render gate ·
**contract-only** = shipped + `screen-contracts.md` contract, render-pending ·
**future-design** = render gate richer than runtime (parity gap).

| Screen ID | Route | Source file | Role | Status | States covered | Render exists? | Notes |
|---|---|---|---|---|---|---|---|
| BD-FEED-01 | `/feed` | `screens/feed.js` | both | render-gate | list/empty/loading | ✅ 2026-06-03 | Card tap → `/post?id=` (not `/order`) |
| BD-COMPOSER-01 | `/new` | `screens/composer.js` | both | contract-only | per-type/preview/draft/validation/submit | ⏳ render-pending | |
| BD-ONBOARDING-01 | `/welcome` (+`/onboarding`) | `screens/welcome.js` (+`onboarding.js`) | both | contract-only | role/permissions/loading/error + `?step=phone` OTP | ⏳ render-pending | Covers BD-AUTH-01 phone/OTP |
| BD-PROFILE-01 | `/profile` | `screens/profile.js` | passenger | render-gate | overview | ✅ 2026-06-03 | |
| BD-PROFILE-D-03 | `/profile?role=driver` | `screens/profile.js` | driver | render-gate | 10 (`?pane=` overview/taxi-ip/documents/payouts/safety + loading/empty) | ✅ PROFILE-D-03 gate | Payout rows READ canonical receipt store, no recompute |
| BD-RESPOND-01 | `/respond?postId=` | `screens/respond.js` | both | render-gate | offer/marketplace success overlays | ✅ 2026-06-03 | Driver variant 2-CTA overlay |
| BD-CHAT-02 | `/chat` | `screens/chat.js` | both | render-gate | ride-context / response-context / demo | ✅ 2026-06-03 | Bridges active_ride + responses stores |
| BD-RULES-01 | `/rules` | `screens/rules.js` | both | contract-only | static articles | ⏳ render-pending | Search/download are UI-only no-ops |
| BD-POST-01 | `/post?id=` | `screens/post_detail.js` | both | contract-only | per-kind/ownership primary-action | ⏳ render-pending | Owns respond/chat/accept decision |
| BD-INBOX-01 | `/inbox` | `screens/inbox.js` | both | contract-only | list/empty/unread | ⏳ render-pending | BD-NOTIF-01 should reuse this hub |
| BD-ORDER-DETAIL-01 | `/order` (`/order/<id>`) | `screens/order_detail.js` | role-split | contract-only | Model B + 01D driver-offer/passenger-select | ⏳ render-pending | Open issue #454 |
| BD-FLOW-INBOX-01 | `/responses` | `screens/responses.js` | passenger | render-gate | empty / driver-offers | ✅ 2026-06-03 | Select driver → active ride |
| BD-MAP-01 | `/map` | `screens/map.js` | passenger | render-gate | default / branches | ✅ 2026-06-03 | route → `/route-picker`; my-loc → `/location-permission` |
| BD-MAP-02 | `/location-permission` | `screens/location_permission.js` | passenger | contract-only | allow/manual/back | ⏳ render-pending | allow→`/map?state=default`, manual→`/route-picker` |
| BD-MAP-03 | `/route-picker` | `screens/route_picker.js` | passenger | render-gate | pick/manual | ✅ 2026-06-03 | |
| BD-MAP-04 | `/route-preview` | `screens/route_preview.js` | passenger | render-gate | preview | ✅ 2026-06-03 | |
| BD-MAP-05 | `/order-map-draft` | `screens/order_map_draft.js` | passenger | render-gate | draft → success card → CTA | ✅ 2026-06-03 | Submit re-renders success card (no auto-nav) |
| BD-DRIVER-02 | `/driver-map` | `screens/driver_map.js` | driver | render-gate | orders / accepted card | ✅ 2026-06-03 | Accepted → `/active-ride?role=driver&...&status=ACCEPTED` |
| BD-RIDE-D-02 | `/active-ride?role=driver` | `screens/active_ride.js` | driver | render-gate | en-route/approaching/waiting/in-progress | ✅ 2026-06-03 | |
| BD-RIDE-P-01 | `/active-ride?role=passenger` | `screens/active_ride_passenger.js` | passenger | render-gate | matching/en-route/in-progress | ✅ 2026-06-03 | |
| BD-RIDE-D-CANCEL-01 | `…role=driver&status=CANCELED` | `screens/active_ride.js` | driver | render-gate | cancel | ✅ 2026-06-03 | |
| BD-RIDE-P-CANCEL-01 | `…role=passenger&status=CANCELED` | `screens/active_ride_passenger.js` | passenger | render-gate | cancel | ✅ 2026-06-03 | Sheet in `active_ride_passenger_sheets.js` (BD-RIDE-P-06) |
| BD-RIDE-D-SAFETY-01 | active ride (shield ctrl) | `screens/active_ride.js` | driver | render-gate | safety sheet | ✅ 2026-06-03 | manual-interaction (no query route) |
| BD-RIDE-P-SAFETY-01 | active ride (shield ctrl) | `screens/active_ride_passenger.js` | passenger | render-gate | safety/report/SOS | ✅ 2026-06-03 | Sheet in `active_ride_passenger_sheets.js` (BD-RIDE-P-07) |
| BD-RIDE-D-COMPLETE-01 | `…role=driver&status=COMPLETED` | `screens/active_ride.js` | driver | render-gate | completed | ✅ 2026-06-03 | |
| BD-RIDE-D-09 / D-11 | `…role=driver&status=COMPLETED` | `screens/active_ride_driver_sheets.js` | driver | render-gate | 7 `?state=` (summary/cash/noncash/shift/loading/closed/empty) | ✅ 2026-06-03 | 12% commission + mock tip; reads canonical receipt |
| BD-RIDE-P-COMPLETE-01 | `…role=passenger&status=COMPLETED` | `screens/active_ride_passenger.js` | passenger | render-gate | completed | ✅ 2026-06-03 | |
| BD-CONFIRM-01 | `/trip-confirmation` | `screens/trip_confirmation.js` | both | render-gate | confirm/handoff | ✅ 2026-06-03 | |
| BD-RIDE-HISTORY-D-01 | `/receipt?tripId=` | `screens/trip_receipt.js` | driver | render-gate | cash/noncash/missing/loading | ✅ 2026-06-03 | Read-only canonical receipt; net computed once upstream |
| **BD-SETTINGS-01** | **`/settings`** (`?role=driver`) | **`screens/settings.js`** | both | **render-gate (UNREGISTERED in registry)** | ported gate states | ✅ st-* gate (ported) | **Shipped + wired + `smoke-settings.mjs`, but absent from `design-registry.json` and mislabeled "unshipped" in `screen-contracts.md`/`missing-screens.md`.** See §2. |

### Non-routed modules (exist, but not standalone screens)

| Module | ID | Type | In registry? | Note |
|---|---|---|---|---|
| `screens/active_ride_driver_sheets.js` | BD-RIDE-D-09/D-11 | driver completion sheets | ✅ (as D-09/D-11) | Mounted by `active_ride.js` renderCompleted |
| `screens/active_ride_passenger_sheets.js` | BD-RIDE-SHEETS-01 (P-06/P-07) | passenger safety+cancel sheets | ⚠️ render gates attributed to parent `active_ride_passenger.js`, not this file | Sheet UI owner; persistence stays in the screen callback |
| `screens/active_ride_driver_noshow.js` | BD-RIDE-D-NOSHOW-01 | driver no-show sub-flow | ⚠️ registry maps NOSHOW to `active_ride.js`; module exists separately | See §2 (future-design parity) |
| `screens/driver_handoff_snapshot.js` | BD-HANDOFF-05 | storage helper (no DOM) | n/a (data module) | Not a screen — confirmation→active-ride driver snapshot |
| `screens/trip_confirmation_handoff.js` | BD-HANDOFF-04 | storage helper (no DOM) | n/a (data module) | Not a screen — chat→confirmation passenger seed |
| `mapbox/driver_markers.js` | BD-MAP-FOUND-03 | foundation stub | ✅ foundationModules | No-op until real Mapbox |
| `mapbox/trip_status_layer.js` | BD-MAP-FOUND-04 | foundation stub | ✅ foundationModules | No-op until real Mapbox |

Every registered route in `app.js` is accounted for above. No registered route is
undocumented; the only screen *file* missing from the registry is `settings.js`.

---

## 2. Partial / risky screens

| Screen | Problem | Risk | Recommended Cloud Design action |
|---|---|---|---|
| **BD-SETTINGS-01** | Shipped + wired in runtime, but `design-registry.json` omits it and `screen-contracts.md` (L177) + `missing-screens.md` (P2) still call it "inert / unshipped / to implement" | **High** (docs lie about live state; #539 scope looks bigger than it is) | Add a `screens[]` registry entry + write `screen-contracts.md#bd-settings-01`; correct L177 + the missing-screens row. **Issue #539 is now a contract/registry sync, not new implementation.** |
| BD-RIDE-D-NOSHOW-01 | Render gate has 7 states (waiting/expired/action/confirm/result/compensation/done); runtime `active_ride_driver_noshow.js` ships 5 (action→confirm→result→compensation→done); registry still attributes the gate to `active_ride.js` and notes "runtime not wired" | Medium (parity gap + stale attribution; compensation ₽ are mock placeholders) | Re-point registry to `active_ride_driver_noshow.js`; document the waiting/expired delta; confirm comp values with product before any wiring |
| Passenger safety/cancel sheets | `active_ride_passenger_sheets.js` (BD-RIDE-P-06/07) owns the sheet UI, but registry pins P-SAFETY/P-CANCEL render gates to `active_ride_passenger.js` | Low (file attribution only) | Add `additionalFiles` / sheet note to the two registry entries |
| BD-ORDER-DETAIL-01 | Runtime shell + full contract + 01D writes shipped; **no render gate** (render-pending). Role-split (driver-offer vs passenger-select) risks visually mixing role data | Medium | Render gate covering both role variants; open issue #454 |
| BD-POST-01 | Shipped gate owns primary-action per kind/ownership; no render gate; the accept/order branch is logic-dense | Medium | Render gate per kind (request/offer/marketplace) + ownership |
| BD-INBOX-01 vs BD-NOTIF-01 | `/inbox` shipped; notification entry points are split (passenger `#pfp-notif-btn` → `/inbox`; driver `#pf2-act-notif` only toggles a flag, no bell) | Medium (could orphan `/inbox` if `/notifications` is added blindly) | Decide reuse `/inbox` as the notif hub **before** any `/notifications` screen; do not orphan `/inbox` |
| Composer / Rules / Map / Onboarding | Shipped, contract-only, render-pending (no gate) | Low–Medium | Sequence render gates (see §4) |
| Global error / offline | `BD-ERROR-01` is an app-shell overlay (not a route) with a prototype HTML; runtime overlay exists but driver-live error/offline states are thin | Medium | Driver active-ride error/offline stages (`missing-screens.md` P1) |

---

## 3. Missing screens to add

Reconciled with `docs/missing-screens.md` (MS) — ✅ already tracked there ·
🆕 not yet tracked · ✔ shipped (reclassify in docs).

### A. Passenger flow
- passenger order draft — ✔ shipped (`/order-map-draft`, BD-MAP-05)
- passenger route preview — ✔ shipped (`/route-preview`, BD-MAP-04)
- passenger order detail — ✔ shipped runtime (`/order`, BD-ORDER-DETAIL-01); render-pending (MS)
- waiting for driver response — ✔ shipped (`/responses` empty, BD-FLOW-INBOX-01); polish open (#305)
- accepted driver card — ✔ shipped (`/responses` → active ride handoff)
- passenger trip history — ✅ MS BD-HISTORY-P-01 (inline section in profile today; dedicated route gap)
- passenger receipt — ⚠️ only the **driver** receipt ships (BD-RIDE-HISTORY-D-01). 🆕 **passenger receipt is genuinely missing.**
- passenger rating / review — 🆕 missing (no post-trip rating screen)
- passenger safety / cancel — ✔ shipped (sheets, BD-RIDE-P-06/07)

### B. Driver flow
- driver nearby orders map/list — ✔ shipped (`/driver-map`, BD-DRIVER-02)
- driver order detail — ✔ shipped (`/order` role=driver, BD-ORDER-DETAIL-01)
- driver response composer — ✔ shipped (`/respond` driver variant)
- driver accepted handoff — ✔ shipped (snapshot BD-HANDOFF-05 + active ride)
- driver active ride polish — ✔ shipped; no-show parity open (§2)
- driver earnings — ✔ shipped (BD-RIDE-D-09/D-11); completion polish issue #376
- driver shift / Такси·ИП dashboard — ✔ shipped as a static demo pane (BD-PROFILE-D-03 `?pane=taxi-ip`)
- driver documents / readiness — ✔ shipped as a pane (BD-PROFILE-D-03 `?pane=documents`)
- driver garage add/edit/archive/readiness — ✅ MS BD-GARAGE-01 (consolidation gate; foundation in progress)

### C. Shared / system
- AuthPhone / verification — ✔ shipped inside onboarding (`?step=phone` OTP); MS BD-AUTH-01 audit
- notification center — ✅ MS BD-NOTIF-01 (decide `/inbox` reuse first)
- inbox / chat list — ✔ shipped (`/inbox`, BD-INBOX-01)
- empty / offline / error / loading skeletons — ✅ MS BD-ERROR-01 (global overlay) + driver error states
- moderation / report — ✅ MS BD-MOD-01 (wire inert report CTAs; preserve in-ride safety report)
- settings — ✔ **shipped** (BD-SETTINGS-01) — docs out of sync (§2)
- permissions: location — ✔ shipped (`/location-permission`); notifications permission — 🆕 no dedicated screen (toggle only)

### D. Map / route
- MapHome ✔ (`/map`) · LocationPermission ✔ · RoutePicker ✔ · RoutePreview ✔ · OrderMapDraft ✔ · DriverMap ✔ · ActiveRide map states ✔ (via MapShell + trip-status stub)
- Map fallback without Mapbox token — ✔ shipped as the MapShell placeholder/stub (BD-MAP-FOUND-03/04); real Mapbox is future (`db-mapbox-readiness.md`, #105)

**Net genuinely-missing screens (not already shipped or tracked in MS):**
1. Passenger receipt / trip summary (mirror of BD-RIDE-HISTORY-D-01)
2. Passenger rating / review (post-trip)
3. Notifications permission screen (currently a toggle only) — low priority

---

## 4. Priority order (next render gates)

Priority rule order: (1) close already-started flows, (2) close active-ride
gaps, (3) garage/profile readiness, (4) map foundation, (5) backend/auth/payment
stay out of scope (future notes only).

| Priority | Screen ID | Why now | Depends on | Suggested PR slice |
|---|---|---|---|---|
| P0 | BD-SETTINGS-01 (docs sync) | Shipped but undocumented/contradicted — docs lie about live state | none (docs only) | Registry `screens[]` entry + `screen-contracts.md#bd-settings-01` + fix L177/MS row (issue #539) |
| P1 | BD-ORDER-DETAIL-01 render gate | Shipped + contract; render-pending; role-split risk | settings docs sync | Render gate: driver-offer vs passenger-select variants (#454) |
| P1 | BD-POST-01 render gate | Shipped gate owns primary actions; logic-dense; no render | — | Render gate per post kind + ownership |
| P1 | BD-RIDE-D-NOSHOW-01 parity | Module ships 5/7 states; registry stale | product sign-off on comp ₽ | Re-point registry; document waiting/expired delta (no wiring) |
| P2 | BD-INBOX-01 render gate + BD-NOTIF-01 decision | Notif entry points split; risk of orphaning `/inbox` | inbox audit | Render gate for `/inbox`; decide reuse vs split before any new route |
| P2 | BD-COMPOSER-01 render gate | Shipped; render-pending | — | Composer render gate (per-type/preview/draft/validation) |
| P2 | BD-MAP-02 / BD-ONBOARDING-01 / BD-RULES-01 gates | Shipped; render-pending | — | One render gate each |
| P3 | Passenger receipt + rating | Genuinely missing; mirrors driver receipt | receipt store | New passenger receipt screen + rating sheet |
| P3 | BD-GARAGE-01 | Foundation in progress | profile readiness | Garage add/edit/archive/readiness gate |
| Future | Real Mapbox, backend, payments, real auth | Out of scope | — | Notes only (`db-mapbox-readiness.md`, #105) |

---

## 5. Prompts for the three nearest render gates

### Prompt 1 — BD-SETTINGS-01 documentation sync (P0, docs-only)

- **Screen ID:** BD-SETTINGS-01
- **Route:** `/settings` (and `/settings?role=driver`)
- **Source file:** `public/src/screens/settings.js`
- **Role:** both (role read from `?role=` for the «Назад» target)
- **Goal:** Make the docs match shipped runtime — register the screen and write its
  contract; stop describing it as unshipped.
- **Required states:** mirror the shipped `settings__*` sections (profile/account,
  notifications toggles, appearance/language, privacy, about, logout/delete — all
  mock/no-op).
- **Required UI:** reuse `bd-card` / `bd-scroll` / `bd-btn` / `bd-list-icon` /
  `bd-section-h`; accent `#FF6B35`; Russian labels; mobile shell ≤ `430px`.
- **Buttons/actions:** gear entry points (passenger `#pfp-settings-btn`, driver
  `#pf2-gear`); «Назад» → role-correct profile; every control persists nothing.
- **Empty/loading/error states:** none required (static settings list).
- **Reusable components:** Cloud Design atoms above; no new component layer.
- **Out of scope:** real logout/delete, real push registration, backend, CSP change,
  inline script/style, copying prototype HTML into runtime.
- **Definition of Done:** `design-registry.json` has a `screens[]` BD-SETTINGS-01
  entry; `screen-contracts.md#bd-settings-01` exists; L177 + `missing-screens.md`
  row corrected; `node scripts/check.mjs` green (incl. `smoke-settings.mjs`).

### Prompt 2 — BD-ORDER-DETAIL-01 render gate (P1)

- **Screen ID:** BD-ORDER-DETAIL-01
- **Route:** `/order` (`/order/<id>`)
- **Source file:** `public/src/screens/order_detail.js`
- **Role:** role-split (driver-offer vs passenger-select; Model B locked)
- **Goal:** Add a Cloud Design render gate for the shipped Order Detail shell, with a
  clear visual split so role data never mixes.
- **Required states:** passenger-owned order; driver viewing an order (offer);
  passenger reviewing a driver's offer (select); empty/missing order; loading.
- **Required UI:** route + price + ETA summary; role-specific primary action block;
  inert report CTA (`data-action="report-order"`) styled but not rerouted.
- **Buttons/actions:** driver open-active-ride → `/active-ride?role=driver&tripId=…`
  (no `status=ACCEPTED` appended by `order_detail.js`); passenger select → responses /
  active ride; actions re-render in place.
- **Empty/loading/error states:** missing-order fallback; loading skeleton.
- **Reusable components:** Cloud Design atoms; existing order_detail markup.
- **Out of scope:** backend, real pricing, Mapbox, changing route registration or
  the in-ride safety report (BD-RIDE-P-07).
- **Definition of Done:** render gate artifact under `public/prototypes/` (reference
  only); registry `renderGate` set; contract delta noted; `check.mjs` green.

### Prompt 3 — BD-POST-01 render gate (P1)

- **Screen ID:** BD-POST-01
- **Route:** `/post?id=…`
- **Source file:** `public/src/screens/post_detail.js`
- **Role:** both (decision varies by post kind + ownership)
- **Goal:** Render gate for the shipped post-detail gate that owns the primary-action
  decision (respond / chat / own-post / accept-order).
- **Required states:** request (passenger ask), offer (driver/marketplace), own post,
  marketplace item; each with its correct primary CTA.
- **Required UI:** post header/body; author row; primary-action block keyed to
  kind/ownership; secondary nav.
- **Buttons/actions:** respond → `/respond?postId=…`; chat handoff where defined;
  own-post variant; feed card enters here (feed does not open `/order` directly).
- **Empty/loading/error states:** missing post fallback; loading skeleton.
- **Reusable components:** Cloud Design atoms; existing post_detail markup.
- **Out of scope:** backend, Mapbox, changing the primary-action semantics
  `post_detail.js` already owns.
- **Definition of Done:** render gate artifact (reference only); registry `renderGate`
  set; `check.mjs` green.

---

## Expected final summary

```text
Recommended next screen slice:
BD-SETTINGS-01 documentation sync — add the registry screens[] entry +
screen-contracts.md#bd-settings-01, and correct the "unshipped/inert" claims in
screen-contracts.md (L177) and missing-screens.md. Docs-only; closes issue #539.

Reason:
It is the safest next step — zero runtime change, it removes an active
contradiction where three docs describe a fully-shipped, wired, smoke-pinned
screen as missing, and it re-grounds the registry so every subsequent render-gate
audit (Order Detail, Post detail, No-show parity) starts from accurate truth.
```
