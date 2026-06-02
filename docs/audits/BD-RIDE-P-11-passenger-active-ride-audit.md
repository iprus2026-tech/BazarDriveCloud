# BD-RIDE-P-11 — Passenger Active Ride visual / contract audit

**Branch:** `audit/passenger-active-ride-contract`
**Date:** 2026-06-03
**Type:** Read-only contract & Cloud Design conformance audit (no runtime changes)
**Primary node:** `public/src/screens/active_ride_passenger.js`

---

## Scope

Verify that the **passenger** Active Ride screen still matches the documented
contracts (`docs/screen-contracts.md`, `docs/active-ride-plan.md`) and the Cloud
Design system (`public/styles/cloud.css`), and record any drift as deferred
follow-up issues.

This audit is **strictly report-only**. The code on this branch is green, so no
runtime fix is attempted. Per task constraints, this audit does **not**:

- edit `active_ride_passenger.js`, `active_ride.js`, `ride_state.js`,
  `map_shell.js`, `cloud.css`, `sw.js`, or `scripts/check.mjs`;
- touch the driver flow, CSP, Mapbox, backend, or APK packaging;
- patch the minor documentation gaps it finds (they are listed as follow-ups only);
- add a passenger smoke/regression script (recommended as a follow-up only).

The only file produced by this task is this report.

---

## Files inspected

| File | Role in audit |
|---|---|
| `public/src/screens/active_ride_passenger.js` | Passenger Active Ride renderer (primary node) |
| `public/src/screens/active_ride.js` | Role dispatcher → passenger renderer |
| `public/src/ride_state.js` | Ride status enum, store, transitions |
| `public/src/mapbox/map_shell.js` | MapShell DOM placeholder (BD-RIDE-F-02) |
| `public/styles/cloud.css` | Cloud Design tokens + active-ride classes |
| `public/sw.js` | Service worker precache (v80) |
| `scripts/check.mjs` | CI guard (CSP / contract / syntax / smoke) |
| `docs/screen-contracts.md` | Screen contracts (BD-RIDE-P-01..07, BD-RIDE-F-02) |
| `docs/active-ride-plan.md` | Active Ride contract, status list, Mapbox boundary |
| `docs/smoke/BD-ACTIVE-08-active-ride-full-post-merge-smoke.md` | Existing (doc-only) smoke coverage |
| `README.md`, `ROADMAP.md` | Active-ride references / completion state |

---

## Current passenger states

`PASSENGER_SUPPORTED_STATUSES` (`active_ride_passenger.js:322-329`) renders full UI
for six statuses; `CANCELED`/`NO_SHOW` route to a dedicated fallback; unknown
statuses fall back to a graceful stub.

| Status | Handling | Title / subtitle (RU) | Source |
|---|---|---|---|
| `ACCEPTED` | en-route sheet variant | "Водитель назначен" | `active_ride_passenger.js:469-470` |
| `DRIVER_EN_ROUTE` | en-route sheet (default) | "Водитель едет к вам" | `active_ride_passenger.js:467` |
| `DRIVER_APPROACHING_PICKUP` | en-route sheet variant | "Водитель почти на месте" / "Выходите к точке подачи" | `active_ride_passenger.js:471-473` |
| `WAITING_PASSENGER` | waiting sheet | "Водитель ждёт вас" / "Бесплатное ожидание заканчивается через" | `active_ride_passenger.js:510-556` |
| `IN_PROGRESS` | in-progress sheet | "В пути" / "Расчётное время прибытия …" | `active_ride_passenger.js:558-594` |
| `IN_PROGRESS` + `phase=ARRIVING_DROPOFF` | arriving sub-phase sheet | "Прибываем" / "Подъезжаем к точке высадки" | `active_ride_passenger.js:596-626` |
| `COMPLETED` | dedicated scrollable rating screen (no map) | "Поездка завершена" → "Спасибо за отзыв" | `active_ride_passenger.js:1742-1748` |
| `CANCELED` | `renderPassengerCanceledFallback(ride,'canceled')` | "Поездка отменена" | `active_ride_passenger.js:1727-1729`, `1506-1570` |
| `NO_SHOW` | `renderPassengerCanceledFallback(ride,'no_show')` | "Поездка не состоялась" | `active_ride_passenger.js:1730-1732`, `1517-1521` |
| unknown (e.g. `NEW_ORDER`) | `renderPassengerStub` | "Этот этап поездки будет добавлен позже" | `active_ride_passenger.js:1734-1735`, `337-347` |

**Note:** `DRIVER_APPROACHING_PICKUP` is **not** a silent alias of `DRIVER_EN_ROUTE`
— it has its own title and a "head to pickup" subtitle. The shared en-route branch
(`renderSheet`, `active_ride_passenger.js:1918-1919`) just routes all three pre-arrival
statuses through `renderEnRouteSheet`, which switches copy on status.

---

## Cloud Design / contract comparison

Contract source: `docs/screen-contracts.md:330-339` (BD-RIDE-P-01..07).

| Contract field | Contract value | Implementation | Verdict |
|---|---|---|---|
| Route | `/active-ride?role=passenger` | `active_ride.js:554-557` dispatches non-driver role to `renderPassenger()` | ✅ match |
| File | `public/src/screens/active_ride_passenger.js` | same | ✅ match |
| Storage | reads `bazardrive.active_ride.v1`; writes cancel/safety UI actions | reads via `ride_state.js`; cancel persists `CANCELED` + canonical mirror (`active_ride_passenger.js:1943-1962`) | ✅ match |
| Main states | ACCEPTED, DRIVER_EN_ROUTE, DRIVER_APPROACHING_PICKUP, WAITING_PASSENGER, IN_PROGRESS, COMPLETED, CANCELED, NO_SHOW | all 8 present & handled (see state table) | ✅ match |
| Actions | message driver, phone stub, cancel sheet, safety sheet, done/new ride | all present (see matrix) | ✅ match |
| Acceptance | same tripId as driver, same status enum, role-specific UI only | shared `RIDE_STATUS` enum from `ride_state.js`; passenger renderer never duplicates driver UI | ✅ match |

**Status enum parity** — `ride_state.js` `RIDE_STATUS` defines all 8 contract statuses
with exact spelling/casing: `DRIVER_EN_ROUTE`, `DRIVER_APPROACHING_PICKUP`,
`WAITING_PASSENGER`, `IN_PROGRESS`, `COMPLETED`, `CANCELED`, `NO_SHOW` (+ `ACCEPTED`
and pre-ride states). No drift.

**Cloud Design parity (`cloud.css`)** — passenger active-ride classes and tokens are
present and consistent with the Cloud Design dark theme:

- Tokens: `--accent` `#FF6B35`, `--accent-soft`, `--accent-strong`, `--success`,
  `--danger`, `--bg-0..3`, `--radius-md/lg/xl`, `--active-ride-bottom-safe`.
- Map: `.bd-map-shell`, `.bd-map-shell--passenger` (route uses `--accent-strong`).
- Top card: `.active-ride-passenger__top-card` (+ `data-tone` enroute/wait/arriving).
- Sheet: `.active-ride-passenger__sheet`, `__handle`, `__route`, `__payment`.
- Buttons: `.bd-btn.primary` (orange), `.bd-btn.ghost`, danger variants
  `__btn-cancel` / `__btn-sos`.
- Cancel overlay: `.passenger-cancel-overlay`, `.passenger-cancel-sheet`,
  `__reason[aria-checked]`, `.passenger-cancel-confirm`.
- Safety overlay: `.passenger-safety-overlay`, `.passenger-safety-sheet`,
  `__sos-tile` (+ `data-sos-state`), `__row[data-safety-action]`.

No missing classes or token drift detected against the rendered markup.

---

## Buttons / actions matrix

Exact RU labels and element IDs as rendered. "Top card" actions float above the map
and are bound once (`active_ride_passenger.js:1828-1839`); sheet actions are bound per
status in `renderSheet` (`:1865-1967`).

| Status | Top card | Sheet primary | Sheet secondary |
|---|---|---|---|
| ACCEPTED / DRIVER_EN_ROUTE / DRIVER_APPROACHING_PICKUP | "Позвонить" (`#arp-top-call`, stub), "Написать" (`#arp-top-chat` → `/chat`) | "Уточнить место" (`#arp-refine`, stub), "Отменить" (`#arp-cancel` → cancel sheet) | "SOS" (`#arp-sos` → safety sheet), "Поделиться поездкой" (`#arp-share`, stub) |
| WAITING_PASSENGER | call / message (as above) | "Я в машине — поехали" (`#arp-boarded` → persists `IN_PROGRESS`, re-routes) | "SOS", "Поделиться поездкой" |
| IN_PROGRESS | call / message (as above) | "Добавить остановку" (`#arp-add-stop`, stub) + share icon (`#arp-share-square`, stub) | "SOS", "Поделиться поездкой" |
| IN_PROGRESS + ARRIVING_DROPOFF | call / message (as above) | "Завершить и оценить поездку" (`#arp-finish-rate` → `COMPLETED` view) | "SOS", "Поделиться поездкой" |
| COMPLETED | call / message inside driver card | 5-star rating + preset tags + comment; "Сообщить о проблеме"; report sheet | history row "Поездка сохранена в историю" |
| CANCELED / NO_SHOW | top back chevron → `/feed` | "Создать новую поездку" (`#arp-canceled-new` → `/new`) | "Вернуться в ленту" (`#arp-canceled-feed` → `/feed`) |

All non-navigational actions are safe stubs (toast), matching the "Mock/UI only"
file header (`active_ride_passenger.js:1-6`). The "Я в машине — поехали" CTA and the
cancel confirm are the only handlers that persist a ride-state transition, both via
`ride_state.js` helpers — correct per contract.

---

## Cancel sheet status (BD-RIDE-P-06)

Present and conformant. `openPassengerCancelSheet` (`active_ride_passenger.js:1364-1485`).

- Header pill "Отмена поездки"; title "Отменить поездку?"; subtitle
  "Водитель уже может быть в пути. Выберите причину отмены." (`:1382-1389`)
- **6 reasons** (`CANCEL_REASONS`, `:1332-1339`): `driver_slow` "Водитель долго едет",
  `plans_changed` "Изменились планы", `other_transport` "Выбрал другой способ доехать",
  `address_error` "Ошибка в адресе", `no_contact` "Не могу связаться с водителем",
  `other` "Другая причина".
- Confirm button disabled until a reason is selected (`:1402-1404`).
- **Two-stage** overlay: select → confirm (`data-stage`), confirm card titled
  "Точно отменить?" with "Да, отменить поездку" / "Не отменять" (`:1408-1419`).
- On confirm: persists current view (`saveActiveRide`), transitions to `CANCELED`
  with `cancel.by = 'passenger'`, mirrors to canonical `ride_orders` via
  `updateTripStatus`, then navigates to the CANCELED fallback (`:1943-1963`).

Verdict: **matches contract**.

---

## Safety sheet status (BD-RIDE-P-07)

Present and conformant. `openPassengerSafetySheet` (`active_ride_passenger.js:1594-1708`).
Opened from the shield icon (`#arp-shield`, `:1820-1822`) and from each sheet's SOS
button (`:1851-1856`).

- Header pill "Центр безопасности"; title "Безопасность"; subtitle about SOS / share
  to trusted contact (`:1629-1639`).
- **SOS tile** (`#arp-safety-sos`): idle "Быстрая помощь, пока без реального вызова" →
  pressed "Запрос отправлен · с вами свяжутся" + "Идёт обработка…" badge (`:1641-1659`).
  No real dispatch — safe stub.
- **4 action rows** (`SAFETY_ACTIONS`, `:1580-1585`): `share` "Поделиться поездкой",
  `trusted` "Доверенные контакты", `support` "Позвонить в поддержку", `help` "Справка"
  — each a toast stub.
- "Закрыть" CTA, X button, backdrop tap, Escape all detach the overlay without
  mutating ride status (`:1572-1579`, `1666-1668`).

Verdict: **matches contract**.

---

## Text / localization notes

- All passenger-facing strings are **hardcoded Russian literals** in the templates
  (titles, labels, toasts, reason/action lists). There is **no i18n / localization
  layer**.
- This is consistent with the rest of the PWA mock spine and the contract does **not**
  require i18n at this phase, so it is **informational, not drift**.
- Copy is internally consistent and truthful about stubbed behavior (e.g.
  "Звонок водителю пока заглушка", "Поделиться поездкой пока заглушка") and the
  NO_SHOW screen correctly avoids implying a manual cancel
  ("Водитель не смог дождаться вас…", `:1521`).

---

## MapShell notes

- Embedded only for the map-backed statuses via
  `createMapShell({ variant: 'passenger', status: ride.status, route: ride.route })`
  (`active_ride_passenger.js:1756-1760`); COMPLETED and the CANCELED/NO_SHOW fallback
  render no map (correct — they are scrollable / terminal layouts).
- `map_shell.js` is a **pure DOM placeholder**: no Mapbox SDK, no token, no network,
  no geolocation (file header, BD-RIDE-F-02). It emits static `.bd-map-shell` markup
  with route line, car/pickup/dropoff markers, and ARIA labels.
- Matches `docs/screen-contracts.md:341-349` (BD-RIDE-F-02) and the
  `active-ride-plan.md` Mapbox boundary. No CSP impact. No drift.

---

## Smoke / manual coverage

**Manual URL matrix** (hash-router; serve `public/` over HTTP, e.g.
`python -m http.server 8000 -d public`, then open `#/...`):

| Manual URL | Expected result |
|---|---|
| `/active-ride?role=passenger` | Resolves latest handed-off trip or demo; renders default status sheet |
| `/active-ride?role=passenger&status=DRIVER_EN_ROUTE` | En-route sheet, "Водитель едет к вам" |
| `/active-ride?role=passenger&status=DRIVER_APPROACHING_PICKUP` | "Водитель почти на месте" + "Выходите к точке подачи" |
| `/active-ride?role=passenger&status=WAITING_PASSENGER` | Waiting sheet, free-wait countdown, "Я в машине — поехали" |
| `/active-ride?role=passenger&status=IN_PROGRESS` | In-progress sheet, "В пути" |
| `/active-ride?role=passenger&status=IN_PROGRESS&phase=ARRIVING_DROPOFF` | "Прибываем", "Завершить и оценить поездку" *(phase param not in contract — see Findings)* |
| `/active-ride?role=passenger&status=COMPLETED` | Completed/rating screen *(optional `&payment=auto\|pending\|paid` — not in contract)* |
| `/active-ride?role=passenger&status=CANCELED` | Canceled fallback, "Поездка отменена" |
| `/active-ride?role=passenger&status=NO_SHOW` | No-show fallback, "Поездка не состоялась" |
| `/active-ride?role=driver` | Driver flow (`active_ride.js`); passenger renderer not invoked |

**Note on `ACCEPTED`:** the contract lists it as a main state and the code renders it
("Водитель назначен"), but neither the task manual-URL list nor the BD-ACTIVE-08 smoke
doc includes `?status=ACCEPTED`. A `/active-ride?role=passenger&status=ACCEPTED` row
should be added to the manual matrix.

**Automated coverage:** `node scripts/check.mjs` enforces CSP/inline-style invariants,
manifest fields, SW precache hygiene, JS syntax for all `public/**/*.js`, the **driver**
`active_ride.js` contract (`check.mjs:91-114`), and three **driver-map** smoke scripts.
**There is no executable guard for the passenger contract.** Passenger coverage today
is documentation-only: `docs/smoke/BD-ACTIVE-08-…md` is a static code review, not an
executed test. See Findings #1.

---

## Driver flow regression risk

**Risk: none.** This audit changes no source. Structurally, the passenger and driver
flows are cleanly isolated:

- `active_ride.js:554-557` dispatches by `role`; only non-driver roles reach
  `renderPassenger()` → `activeRidePassenger({...})` (`active_ride.js:252-268`).
- There is no separate `/active-ride-passenger` route (shell invariant,
  `screen-contracts.md`), and the passenger renderer is never duplicated in the driver
  file.
- `active_ride_passenger.js` contains no driver-specific logic: cancel reasons are
  passenger-worded (no "Пассажир не вышел"), there is no earnings/problem sheet, and
  state writes go through shared `ride_state.js` helpers only.
- The driver-specific `styles/driver_sheets.css` is loaded by `active_ride.js`
  (`DRIVER_SHEETS_CSS_ID`) and not referenced by the passenger flow.

---

## Findings

| # | Finding | Type |
|---|---|---|
| 1 | **No executable passenger regression guard.** `check.mjs` pins the driver contract and driver-map smoke but nothing pins the passenger supported-status set, cancel/safety sheet presence, CANCELED/NO_SHOW routing, or role isolation. Passenger coverage is documentation-only (BD-ACTIVE-08 static review). | Drift (coverage) |
| 2 | **`ACCEPTED` has no manual-URL / smoke row** despite being a contract main state that the screen renders ("Водитель назначен"). | Drift (doc/coverage) |
| 3 | **`phase=ARRIVING_DROPOFF` and `payment=…` query params are undocumented** in `screen-contracts.md` BD-RIDE-P row, although both are consumed by the screen and exercised in BD-ACTIVE-08. | Drift (doc) |
| 4 | **No i18n layer** — passenger strings are hardcoded Russian. Contract does not require i18n at this phase. | Informational |
| 5 | **`DRIVER_APPROACHING_PICKUP` top-card ETA label** stays "до подачи" (shared en-route branch, `:378`) while the sheet copy escalates to "почти на месте". Semantically correct (still ETA to pickup). | Informational |

No runtime defect was found. All findings are documentation/coverage gaps or
informational notes; the rendered screen conforms to the contract and Cloud Design.

---

## Recommended follow-up issues

Deferred — **not** actioned in this audit (per report-only scope).

- **BD-RIDE-P-12 — Passenger Active Ride smoke guard.** Add
  `scripts/smoke-passenger-active-ride.mjs` (assert supported-status set, cancel +
  safety sheet presence, `CANCELED`/`NO_SHOW` → fallback routing, role isolation) and
  wire it into `scripts/check.mjs` alongside the existing driver smokes. Closes Finding #1.
- **BD-RIDE-P-13 — Contract param & ACCEPTED doc sync.** In `docs/screen-contracts.md`
  (BD-RIDE-P row) document the optional `phase=ARRIVING_DROPOFF` and
  `payment=auto|pending|paid` query params, and add a
  `/active-ride?role=passenger&status=ACCEPTED` row to the manual-URL matrix.
  Closes Findings #2 and #3.

---

## Final verdict

**PASS — no runtime changes needed.**

The passenger Active Ride screen conforms to the documented contracts
(`screen-contracts.md` BD-RIDE-P-01..07, BD-RIDE-F-02; `active-ride-plan.md`) and the
Cloud Design system. All eight contract statuses, the cancel sheet, the safety sheet,
the MapShell placeholder, role isolation, and query-param handling are present and
correct. No runtime drift found.

**FOLLOW-UP (optional, deferred):** BD-RIDE-P-12 (passenger smoke guard),
BD-RIDE-P-13 (contract param / ACCEPTED doc sync).
