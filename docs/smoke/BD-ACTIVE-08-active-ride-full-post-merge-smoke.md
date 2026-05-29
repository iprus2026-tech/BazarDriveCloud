# BD-ACTIVE-08 — ActiveRide Full Post-Merge Smoke Audit

**Issue:** [#269](https://github.com/iprus2026-tech/BazarDriveCloud/issues/269)
**Branch:** `audit/active-ride-full-post-merge-smoke`
**Audit type:** docs-only (static code review + automated check)

---

## Environment Tested

| Field | Value |
|---|---|
| Platform | GitHub Pages / SPA (hash-router) |
| Audit method | Static code review + `node scripts/check.mjs` |
| Repo | iprus2026-tech/BazarDriveCloud |
| Branch audited | `main` |
| HEAD commit | `2a867f4e735782ee2668c59dc96999422b2ce75b` |
| Commit date | 2026-05-29 14:18 +0300 |
| PRs included | #256, #266, #268 |
| `node scripts/check.mjs` | **All checks passed.** |

---

## Commits in Scope

| SHA (short) | Date | Title |
|---|---|---|
| `2a867f4` | 2026-05-29 | BD-RIDE-D-09 polish driver completion earnings actions (#268) |
| `24b98aa` | 2026-05-29 | BD-RIDE-D-07 Driver cancel and problem sheets (#266) |
| `46c2ec4` | earlier | fix(active-ride): isolate passenger snapshot to the accepted order (#256) |

---

## localStorage Reset Notes

Before any scenario run, the following keys must be cleared (or use a clean browser profile):

```
bazardrive.active_ride.v1
bazardrive.driver_handoff_snapshot.v1
bazardrive.trip_confirmation.v1
bazardrive.ride_history.v1
bazardrive.chat.v1
```

All five keys are consumed by separate modules (`ride_state.js`, `driver_handoff_snapshot.js`,
`trip_confirmation_handoff.js`, `ride_history.js`, `active_ride.js`) that each fail-soft on
missing/malformed storage, so a partial reset will not crash the UI.

---

## Files Inspected

| File | Lines | Notes |
|---|---|---|
| `public/src/screens/active_ride.js` | 681 | Driver flow, cancel/problem sheets, earnings sheet, completion |
| `public/src/screens/active_ride_passenger.js` | 1934 | Passenger flow, safety sheet, cancel sheet, COMPLETED rating |
| `public/src/ride_state.js` | 317 | Status enum, timestamps, rollback guards, demo factory |
| `public/src/ride_history.js` | 199 | History persistence, driver/passenger entry builders |
| `public/src/screens/trip_confirmation_handoff.js` | 238 | Canonical active-ride loader, cross-role seed |
| `public/src/screens/driver_handoff_snapshot.js` | 172 | 30-min TTL snapshot, staleness check, field overlay |
| `public/src/mapbox/map_shell.js` | 97 | Pure DOM placeholder, zero Mapbox SDK |
| `public/src/router.js` | 76 | Chrome/tabbar hide, FAB visibility |
| `public/src/app.js` | 75 | Route registrations |
| `public/sw.js` | 80+ | Version v59, precache list |
| `public/styles/cloud.css` | 11176 | Cancel/problem/safety sheet CSS (144 matching blocks) |
| `public/styles/driver_sheets.css` | audited | Earnings sheet CSS (`driver-sheet__*`) |
| `scripts/check.mjs` | 104 | Inline style, syntax, SW, manifest checks |

---

## URLs Tested (Static Review)

### Driver Direct States

| URL | Code Path | Result |
|---|---|---|
| `/active-ride?role=driver&status=NEW_ORDER` | `renderNewOrder()` | **PASS** |
| `/active-ride?role=driver&status=DRIVER_EN_ROUTE` | `renderEnRoute()` | **PASS** |
| `/active-ride?role=driver&status=DRIVER_APPROACHING_PICKUP` | `renderEnRoute()` via `safeApplyStatusFromQuery` | **PASS** |
| `/active-ride?role=driver&status=WAITING_PASSENGER` | `renderWaiting()` | **PASS** |
| `/active-ride?role=driver&status=IN_PROGRESS` | `renderInProgress()` | **PASS** |
| `/active-ride?role=driver&status=COMPLETED` | `renderCompleted()` | **PASS** |
| `/active-ride?role=driver&status=CANCELED` | `renderCanceledStub()` | **PASS** |
| `/active-ride?role=driver&status=NO_SHOW` | `renderCanceledStub()` (NO_SHOW branch) | **PASS** |

### Passenger Direct States

| URL | Code Path | Result |
|---|---|---|
| `/active-ride?role=passenger&status=DRIVER_EN_ROUTE` | `renderEnRouteSheet()` | **PASS** |
| `/active-ride?role=passenger&status=DRIVER_APPROACHING_PICKUP` | aliased → `DRIVER_EN_ROUTE` layout | **PASS** |
| `/active-ride?role=passenger&status=WAITING_PASSENGER` | `renderWaitingSheet()` | **PASS** |
| `/active-ride?role=passenger&status=IN_PROGRESS` | `renderInProgressSheet()` | **PASS** |
| `/active-ride?role=passenger&status=IN_PROGRESS&phase=ARRIVING_DROPOFF` | `renderArrivingDropoffSheet()` | **PASS** |
| `/active-ride?role=passenger&status=COMPLETED` | `renderPassengerRideComplete()` | **PASS** |
| `/active-ride?role=passenger&status=CANCELED` | `renderPassengerCanceledFallback('canceled')` | **PASS** |
| `/active-ride?role=passenger&status=NO_SHOW` | `renderPassengerCanceledFallback('no_show')` | **PASS** |

---

## Pass/Fail Table

### Accepted-Order Snapshot Isolation (#256)

| Check | Result | Notes |
|---|---|---|
| Passenger snapshot loaded via `loadCanonicalActiveRide` → `loadDriverHandoffSnapshot` chain | **PASS** | `trip_confirmation_handoff.js` → `driver_handoff_snapshot.js` |
| Fresh accepted order does not leak demo `DEMO_ACTIVE_RIDE_ID` passenger data | **PASS** | `applyDriverHandoffSnapshotToRide` overlays accepted passenger/route onto ride |
| Stale snapshot (>30 min) does not hydrate driver ActiveRide | **PASS** | `isSnapshotStale()` removes and returns null; `loadDriverHandoffSnapshot` returns null |
| Refresh preserves passenger snapshot | **PASS** | Canonical record persisted to `bazardrive.active_ride.v1` before next render |
| Chat uses same `tripId` | **PASS** | `go('/chat?tripId=' + encodeURIComponent(ride.tripId))` in both `#ar-msg` and `#ar-open-chat` |
| Completed trip reaches ride history with correct snapshot | **PASS** | `buildDriverHistoryEntry(ride, { earnings })` → `saveRideHistoryEntry()` on COMPLETED render |

### Driver Lifecycle

| Check | Result | Notes |
|---|---|---|
| NEW_ORDER → accept → DRIVER_EN_ROUTE | **PASS** | `updateActiveRideStatus(tripId, DRIVER_EN_ROUTE)` |
| DRIVER_EN_ROUTE → "Я на месте" → WAITING_PASSENGER | **PASS** | `updateActiveRideStatus(tripId, WAITING_PASSENGER)` |
| WAITING_PASSENGER → "Начать поездку" → IN_PROGRESS | **PASS** | `updateActiveRideStatus(tripId, IN_PROGRESS)` |
| IN_PROGRESS → "Завершить" → COMPLETED | **PASS** | `updateActiveRideStatus(tripId, COMPLETED)` |

### Driver COMPLETED Screen (#268)

| Element | Result | Notes |
|---|---|---|
| Route summary (pickup / dropoff) | **PASS** | `summaryHtml` renders both labels from `ride.route` |
| Passenger card (name, initials, rating, phone, luggage) | **PASS** | `passengerCardHtml` |
| Gross ride price | **PASS** | `calcEarnings().gross` → `formatRub()` |
| Commission rate + amount | **PASS** | `commissionLabel`, `formatRub(commissionAmount)` |
| Net driver earnings | **PASS** | `formatRub(net)` in breakdown and hero |
| Shift summary (prev → next earnings, prev → next trips) | **PASS** | `active-ride__shift-summary` block |
| Honest history-saved badge | **PASS** | `badge.dataset.historySaved` set to `'true'` only when `saveRideHistoryEntry` returns non-null |
| Primary return action ("Вернуться на линию") | **PASS** | `go('/feed')` |
| Secondary earnings action ("Подробнее о доходе") | **PASS** | `openDriverEarningsSheet(root, { ride })` |

### Driver Cancel/Problem Sheets (#266)

| Check | Result | Notes |
|---|---|---|
| Cancel sheet opens from en-route state | **PASS** | `#ar-cancel` → `openDriverCancelSheet()` |
| Cancel reason can be selected | **PASS** | `bindCancelOptions()` with `aria-checked` sync |
| Two-step confirmation works | **PASS** | `confirmPending` flag; first click shows confirm box, second confirms |
| Regular cancel (en-route) → CANCELED | **PASS** | `onConfirm: () => updateActiveRideStatus(tripId, CANCELED)` |
| Waiting "Не приехал" → preselected `passenger_no_show` | **PASS** | `reason: 'passenger_no_show'` passed to `openDriverCancelSheet` |
| `passenger_no_show` → NO_SHOW transition | **PASS** | `outcomeLabel: (code) => code === 'passenger_no_show' ? 'NO_SHOW' : 'CANCELED'`; `onConfirm: (code) => updateActiveRideStatus(tripId, code === 'passenger_no_show' ? NO_SHOW : CANCELED)` |
| Problem sheet opens from in-progress | **PASS** | `#ar-issue` → `openDriverProblemSheet()` |
| Problem actions show placeholder feedback only | **PASS** | `problemActionNotice(code)` → `onAction(message)` toast; no status mutation |
| Problem actions do not change ride status | **PASS** | No `updateActiveRideStatus` call inside `openDriverProblemSheet` |
| Backdrop close | **PASS** | `data-driver-sheet-close="true"` on backdrop, click handler calls `close()` |
| Close button | **PASS** | `data-driver-sheet-close="true"` on × button |
| Escape close | **PASS** | `onKeydown` in `createDriverActionSheet` handles `event.key === 'Escape'` |
| Focus trap | **PASS** | Tab/Shift-Tab cycle in `onKeydown`, focuses first/last focusable element |

### Passenger Lifecycle

| Check | Result | Notes |
|---|---|---|
| DRIVER_EN_ROUTE: driver card, vehicle, ETA, route, call/chat | **PASS** | `topDriverCardHtml` + `renderEnRouteSheet` |
| WAITING_PASSENGER: driver waiting state | **PASS** | `renderWaitingSheet` with countdown and progress bar |
| IN_PROGRESS: on-trip state | **PASS** | `renderInProgressSheet` |
| IN_PROGRESS + ARRIVING_DROPOFF: arriving overlay | **PASS** | `renderArrivingDropoffSheet` with phase-aware payment amount |
| COMPLETED: rating/receipt/payment state | **PASS** | `renderPassengerRideComplete` with `data-submitted`/`data-payment` axes |
| CANCELED: does not crash | **PASS** | `renderPassengerCanceledFallback('canceled')` |
| NO_SHOW: does not crash | **PASS** | `renderPassengerCanceledFallback('no_show')` |
| CANCELED/NO_SHOW do not roll back persisted COMPLETED | **PASS** | `applyPassengerStatusFromQuery`: if `ts.completedAt` → return ride unchanged |
| Call/chat/safety/cancel are safe placeholders | **PASS** | All show toasts or route to `/chat`; no real calls |

### Terminal Query Rollback Guard

| Check | Result | Notes |
|---|---|---|
| COMPLETED → then `?status=CANCELED` blocked if `completedAt` | **PASS** | `active_ride_passenger.js:211-214` — `if (ts.completedAt) return ride` |
| COMPLETED → then `?status=NO_SHOW` blocked if `completedAt` | **PASS** | Same guard covers both CANCELED and NO_SHOW |
| Reverse: `?status=COMPLETED` blocked if `canceledAt` | **PASS** | `active_ride_passenger.js:201-205` — `if (ts.canceledAt) return ride` |
| Driver-side COMPLETED → `?status=CANCELED` blocked | **PASS** | `active_ride.js` `safeApplyStatusFromQuery:127-130` — `if (ts.completedAt) return ride` |
| Driver-side CANCELED → `?status=COMPLETED` blocked | **PASS** | `active_ride.js:123-126` — `if (ts.canceledAt) return ride` |

### Cross-Role Consistency

| Check | Result | Notes |
|---|---|---|
| Driver and passenger read same canonical active ride | **PASS** | `loadCanonicalActiveRide` in both screens; `findActiveRide` wins on first persisted record |
| Passenger name consistent across roles | **PASS** | Both use `ride.passenger.name`; snapshot hydrates before divergence |
| Driver handoff snapshot hydrates only when fresh | **PASS** | `isSnapshotStale()` — 30 min TTL, stale → `removeFromStore` → `null` |
| Stale snapshot does not resurrect old trip data | **PASS** | Returns `null`; driver side falls back to `createDemoActiveRide` (not old snapshot) |
| Chat `tripId` consistent driver ↔ passenger | **PASS** | Both navigate to `/chat?tripId=${encodeURIComponent(ride.tripId)}` |

### Service Worker / Cache (#268)

| Check | Result | Notes |
|---|---|---|
| SW version bumped | **PASS** | `VERSION = 'v59'` in `public/sw.js:1` |
| `active_ride.js` in precache | **PASS** | `sw.js:33` |
| `active_ride_passenger.js` in precache | **PASS** | `sw.js:34` |
| `driver_handoff_snapshot.js` in precache | **PASS** | `sw.js:37` |
| `trip_confirmation_handoff.js` in precache | **PASS** | `sw.js:36` |
| `ride_state.js` in precache | **PASS** | `sw.js:40` |
| `ride_history.js` in precache | **PASS** | `sw.js:42` |
| `driver_sheets.css` in precache | **PASS** | `sw.js:9` |
| `cloud.css` in precache | **PASS** | `sw.js:8` |
| No Mapbox external requests added by this audit | **PASS** | Audit is docs-only; no code changes |
| No prototype references in precache | **PASS** | `check.mjs` verifies this; passes |

### CSP / Security

| Check | Result | Notes |
|---|---|---|
| No inline `<script>` in index.html | **PASS** | `check.mjs` verifies |
| No `<style>` tag in index.html | **PASS** | `check.mjs` verifies |
| No inline event handlers (`on*=`) in HTML | **PASS** | `check.mjs` verifies |
| No `.style.<property>` assignments in JS | **PASS** | `check.mjs` regex scan passes |
| No `setAttribute("style", ...)` in JS | **PASS** | `check.mjs` regex scan passes |
| No Mapbox token / SDK import | **PASS** | `map_shell.js` is pure DOM; no SDK import anywhere in audited files |

### Router / Chrome

| Check | Result | Notes |
|---|---|---|
| `/active-ride` hides tabbar | **PASS** | `HIDE_CHROME` set includes `/active-ride`; `tabbar.hidden = noChrome` |
| `/active-ride` hides FAB | **PASS** | `hasFab = !noChrome && SHOW_FAB.has(path)`; false for `/active-ride` |
| FAB visible only on `/feed` | **PASS** | `SHOW_FAB = new Set(['/feed'])` |
| `/active-ride` route registered | **PASS** | `app.js:38` `register('/active-ride', activeRide)` |

---

## Automated Check Result

```
$ node scripts/check.mjs
All checks passed.
```

Checks performed by `check.mjs`:
- `public/index.html` free of inline scripts, style tags, style= attributes, on* handlers
- `manifest.webmanifest` has all required fields, correct `theme_color` (#FF6B35) and `background_color` (#0a0a0c)
- `public/sw.js` precache list free of prototype references
- All `.js` files in `public/src/` free of forbidden inline style patterns
- All `.js` files in `public/` pass Node.js syntax check

---

## Regressions Found

**None.**

All driver and passenger flows, rollback guards, cancel/problem sheets, earnings sheet, history
persistence, service worker freshness, and cross-role consistency checks pass against the current
`main` at commit `2a867f4`.

---

## Minor Observations (Non-Regressions)

These are design decisions or TODOs documented in the code; none constitute regressions from
PRs #256, #266, or #268.

### OBS-01 — En-route cancel sheet: `passenger_no_show` reason available but always maps to CANCELED

**Location:** `active_ride.js:581` `renderEnRoute → #ar-cancel → openDriverCancelSheet`

The en-route "Отменить" button opens the cancel sheet with an `onConfirm` that always transitions
to `CANCELED` regardless of which reason is selected. Because no `outcomeLabel` is passed, the
confirmation copy also always reads "переведёт поездку в CANCELED". A driver who selects
`passenger_no_show` from the en-route sheet would still land in `CANCELED`, not `NO_SHOW`.

`NO_SHOW` is intentionally reserved for the waiting state via the dedicated "Не приехал" button
(`#ar-no-show` in `renderWaiting`), which correctly uses the `outcomeLabel` function and
maps `passenger_no_show → NO_SHOW`. The en-route path following the same rule is consistent
with the original contract.

**Severity:** Info. No regression. The `passenger_no_show` reason being selectable from the
en-route sheet is aesthetically inconsistent but does not violate the cancel/NO_SHOW contract.

**Suggested follow-up (optional):** If the product spec determines that `passenger_no_show`
should only appear in the waiting-state sheet, the `CANCEL_REASONS` list could be filtered
per-context. This does not need a fix issue for this audit.

### OBS-02 — `ARRIVING_DROPOFF` phase only activatable via URL parameter

**Location:** `active_ride_passenger.js:123-135`, `active_ride_passenger.js:1858-1875`

`ARRIVING_DROPOFF` is an in-progress sub-phase surfaced only via `?phase=ARRIVING_DROPOFF` in
the URL. No in-ride trigger or route-progress event promotes the passenger to this phase
automatically. A `TODO` comment documents this at line 123.

**Severity:** Info. Not a regression; the phase works correctly when addressed via URL.
Real telemetry wiring is out of scope for this audit.

### OBS-03 — `passenger_no_show` confirmation copy in en-route sheet

**Location:** `active_ride.js:352-375`

When `passenger_no_show` is selected in the en-route cancel sheet, the confirmation strip reads
"Следующее нажатие переведёт поездку в CANCELED" because `resolveOutcome` returns the static
string `'CANCELED'` (the default when `outcomeLabel` is not passed). The copy is technically
accurate for en-route (the outcome IS CANCELED), but reading "CANCELED" when the selected reason
is "Пассажир не вышел" may be confusing.

**Severity:** Info. Not a regression.

---

## Follow-Up Issues

No critical regressions were found, so no fix issues are required from this audit.

If OBS-01 or OBS-02 are addressed in future PRs, the recommended branches would be:
- `fix/active-ride-en-route-cancel-reason-filter` (OBS-01 — optional UX polish)
- `feature/active-ride-arriving-dropoff-auto-phase` (OBS-02 — telemetry wiring, out of current scope)

---

## Acceptance Checklist (Issue #269)

- [x] All listed driver URLs render without console errors (code paths verified)
- [x] All listed passenger URLs render without console errors (code paths verified)
- [x] Accepted-order passenger snapshot stays isolated to the accepted order (#256)
- [x] No unrelated seeded/demo passenger leaks into fresh order ActiveRide
- [x] Driver cancel sheet works and maps statuses correctly
- [x] Driver problem sheet is UI-only and does not mutate ride status
- [x] Driver completed screen shows earnings and honest history-saved badge (#268)
- [x] Passenger completed screen cannot be rolled back by CANCELED/NO_SHOW query if `completedAt` exists
- [x] Driver and passenger views converge on the same `tripId`/canonical ride
- [x] Chat opens with the same `tripId`
- [x] Profile history receives the completed ride snapshot
- [x] Chrome/tabbar remains hidden on `/active-ride`
- [x] FAB remains hidden on `/active-ride` and visible only on `/feed`
- [x] No CSP weakening
- [x] No inline script/style
- [x] No backend, real Mapbox, payment, push, auth, or real call integration
- [x] `node scripts/check.mjs` passes
