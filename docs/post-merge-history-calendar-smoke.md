# BD-PROCESS-01 — Post-merge history calendar smoke

Parent issue: #261  
Related PR: #260  
Related completed issue: #259  
Tracking issue: #19

## Purpose

This docs-only audit checklist verifies `main` after PR #260 introduced the compact calendar-based ride history surface in Profile.

This file is intentionally a smoke checklist, not a claim that manual mobile testing has already passed. Record real device/browser results before closing #261.

## Scope

Verify that Profile history remains compact and usable after the calendar change, and that nearby ride-completion flows still seed/read ride history correctly.

## Smoke URLs

```text
/profile?role=driver
/profile?role=passenger
/active-ride?role=driver&status=COMPLETED
/active-ride?role=passenger&status=COMPLETED
/feed
```

## Required checks

### Profile driver

- [ ] `/profile?role=driver` opens without crash.
- [ ] Latest ride summary remains visible when history exists.
- [ ] Ride history renders as a compact calendar, not a long inline list.
- [ ] Days with rides show a visible marker or count.
- [ ] Selecting a day shows selected-day ride rows.
- [ ] Driver wording uses income/earnings language where applicable.
- [ ] Bottom safe-area/tabbar does not hide selected-day content on mobile Chrome.

### Profile passenger

- [ ] `/profile?role=passenger` opens without crash.
- [ ] Latest ride summary remains visible when history exists.
- [ ] Ride history renders as a compact calendar, not a long inline list.
- [ ] Selecting a day shows selected-day ride rows.
- [ ] Passenger wording uses trip cost language where applicable.
- [ ] Empty month/calendar state is clean.
- [ ] Bottom safe-area/tabbar does not hide selected-day content on mobile Chrome.

### ActiveRide completion nearby regression check

- [ ] `/active-ride?role=driver&status=COMPLETED` opens without crash.
- [ ] `/active-ride?role=passenger&status=COMPLETED` opens without crash.
- [ ] Completed ActiveRide still writes/reads ride history through the existing local history path.
- [ ] No visible regression in completed summary/rating/earnings surfaces.

### Defensive data checks

- [ ] Broken history record without `completedAt` does not crash Profile.
- [ ] Broken history record with malformed date does not crash Profile.
- [ ] Records across month boundaries are grouped by local completion date.
- [ ] Multiple rides on the same day can expand beyond the compact first rows.

### Feed sanity check

- [ ] `/feed` opens without crash.
- [ ] Bottom navigation and global shell still work after returning from Profile.

## Out of scope

- Backend history sync
- Mapbox route previews
- Full finance/tax reports
- New history filters
- ActiveRide state-machine changes
- Service Worker changes beyond the already-merged v56 bump

## Expected result format

When running the audit, append a result section below:

```text
## Result

Date:
Device/browser:
Build/source: main / GitHub Pages / local

Passed:
- ...

Regressions found:
- ...

Follow-up issues opened:
- ...

Decision:
- close #261 as completed / keep open pending fixes
```

## Static + CI result

Date: 2026-05-28  
Device/browser: not executed in real mobile browser from this environment  
Build/source: `main` after #262 merge, commit `f11c2d2a1d45a075869355e5b29988dba2a291fa`

### Passed by static audit

- `docs/post-merge-history-calendar-smoke.md` is present on `main` and clearly marks that real mobile smoke still needs to be recorded before closing #261.
- Profile history rendering is compact-calendar based: `historySectionHtml()` renders latest summary + calendar + selected-day list instead of mapping the full history inline.
- Calendar rows are date-keyed through `getRideCompletedAt()` / `getLocalDateKey()` / `groupRidesByDate()`.
- Bad or missing `completedAt` / `savedAt` values are skipped for calendar grouping instead of crashing Profile.
- Malformed history storage is handled through the friendly recovery card instead of poisoning the whole Profile render.
- Driver completed ActiveRide still builds and saves a driver history entry with earnings payload.
- Passenger completed ActiveRide still saves a baseline history entry on render and merges rating/tags/comment on submit without overwriting a previous rating during refresh.
- `/feed` was not changed by #260 or #262.

### CI evidence

- PR #262 CI completed successfully before merge.
- No runtime code changed in #262.
- Direct local clone/check was not possible from this environment because the container could not resolve `github.com`.

### Not verified here

The following checks still require real manual browser/device smoke, preferably Android Chrome + GitHub Pages:

- `/profile?role=driver` visual open/no-crash.
- `/profile?role=passenger` visual open/no-crash.
- Calendar day selection with real seeded history data.
- Bottom safe-area/tabbar behavior on mobile Chrome.
- Completed ActiveRide screens visible behavior on device.
- Return navigation between Profile and Feed.

### Regressions found

- None found by static audit.
- No real-device smoke was executed here, so visual/mobile regressions remain possible.

### Follow-up issues opened

- None.

### Decision

- Keep #261 open until real mobile/GitHub Pages smoke results are appended.
- Do not close #261 based only on this static audit.

## Result — headless smoke (2026-06-17)

Date: 2026-06-17
Device/browser: **headless Chrome (desktop)** — `--headless=new --window-size=430,920 --force-device-scale-factor=1`, against a local static server serving `public/`. **Not a real Android device** (desktop headless; mobile safe-area still device-pending — see below).
Build/source: local `main` @ `bc1f1b6` (current HEAD, many merges after the 2026-05-28 static pass).

Method: a throwaway harness seeded `localStorage` then **mounted the real screen modules** (`profile.js`, `active_ride.js`, `feed.js`) into a `#shell>#app` mirror of `index.html` and read rendered DOM markers. The app router is **hash-based** (`public/src/router.js` reads `location.hash`), so the routes below are exercised at the screen/module level (and via the `#/active-ride?...` hash that `getHashQuery()` parses) — **not** by navigating bare path URLs. The history fixture used: **5 rides dated today** (to exercise the >3-per-day `«Все поездки за день»` show-all expander), **1 ride ~40 days ago** (previous-month boundary), **1 with no `completedAt`** and **1 with a malformed `completedAt`** (defensive). Harness + temp server removed after the run (`git status` clean; no runtime/precache change).

> **Scope of this evidence:** the harness mounts the **screen modules** directly (the surface #260 changed). The real app shell — hash router, bottom tabbar, welcome-redirect, global chrome — is **not** driven here; that is listed under "Not verified" and is the real-browser gate.

### Passed — screen modules render on current main

- The **profile, active_ride and feed screen modules** all mount and render **without crash** (driver + passenger profile, completed driver + passenger active-ride, feed; each reported `SMOKE_OK` with `#app` populated).
- Profile history is the **compact calendar** (`profile-history-calendar` present), not a long inline list.
- **Real "Последняя поездка" latest card renders** (`profile-history__latest-title` present) — the dedicated latest-ride card, distinct from the selected-day aggregate.
- **Driver income/earnings wording** present (`Заработок` / `Доход`; dashboard «18 420 ₽ За неделю»). **Passenger cost wording** present (`Стоимость` / «… ₽ потрачено»). Role isolation holds (driver-earnings tokens absent from the passenger view).
- **Multiple rides on one day → show-all expansion (live click):** 5 rides on the selected (today) day rendered the `«Все поездки за день»` expander (`data-cal-action="show-all"`); clicking it grew the visible `data-history-index` rows (4 → 6).
- **Day selection (live click):** clicking an empty in-month day cell (`data-cal-day`) switched the selected day and rendered the **«Нет поездок за этот день»** empty-day message; the default (today) day shows ride rows.
- **Month-boundary (live nav + select):** clicking `«‹»` (`data-cal-action="prev-month"`) then the previous-month day cell that carries the ~40-day-old ride **rendered that ride's row** (`rowsPrevMonth` grew) — records are grouped and reachable by local date across a month boundary.
- **Empty history state:** with an **empty** `bazardrive.ride_history.v1`, Profile rendered the clean empty-history card (`profile-history__empty` / «Создать поездку») with **no crash**.
- **Defensive data:** with the no-`completedAt` and malformed-`completedAt` records in history, Profile still rendered `SMOKE_OK` — `getRideCompletedAt()` null-skips bad records.
- **ActiveRide write path proven (not just read):** starting from an **empty** `bazardrive.ride_history.v1`, mounting the completed driver and passenger ActiveRide each **persisted exactly one new history entry** (`historyWrittenFromEmpty = 1`) — `saveRideHistoryEntry` is actually called, not just read back from a pre-seeded store.

### Re-verified on current main (code + CI)

- `historySectionHtml()` → `groupRidesByDate()` / `getRideCompletedAt()` / `getLocalDateKey()` still drive the date-keyed compact calendar + selected-day list + malformed-storage recovery card.
- Completed ActiveRide still seeds/reads history via `buildDriverHistoryEntry` / `buildPassengerHistoryEntry` + `saveRideHistoryEntry` (`bazardrive.ride_history.v1`).
- Existing pins green: `smoke-passenger-active-ride`, `smoke-ride-history-terminal`, `smoke-profile-history-menu`, `smoke-driver-receipt-no-drift` — all via `node scripts/check.mjs` (All checks passed; `node scripts/dispatcher.mjs` 56/56, Drift CLEAN).

### Not verified here (real-browser / device gate)

- **Real app-shell route smoke** — these checks used direct module mounts, so the **hash router** (`location.hash`), the **bottom tabbar / global chrome**, and the **welcome-redirect** were not exercised. Opening the bare path URLs (`/profile?role=driver`) does not drive the app (it is hash-routed via `#/...`). A real-browser pass loading `#/profile?…`, `#/active-ride?…`, `#/feed` is still owed.
- **Bottom safe-area / tabbar not hiding selected-day content on Android Chrome** — headless desktop cannot reproduce mobile safe-area insets. Low-risk CSS (`viewport-fit=cover` + safe-area padding already shipped), but device-only.

### Regressions found

- **None.** All exercised checks pass live on current `main`; no crash mounting any of the screen modules; defensive records handled. (Real app-shell route smoke + Android safe-area remain owed — see above.)

### Follow-up issues opened

- None.

### Decision

- **Keep #261 open** until the real-browser gate above is run. The calendar history's own logic is verified non-regressed on current `main` — module render, latest card, day selection, show-all, month-boundary, empty state, defensive records, and the ActiveRide write path were all exercised live (plus code + CI). What remains for closure: a **real-browser pass** that drives the actual hash routes through the app shell (router + tabbar + welcome-redirect) and confirms the **Android-Chrome bottom safe-area**. Close #261 only after that pass appends a result, or a maintainer explicitly waives the residual as a low-risk CSS/shell concern.

## Agent handoff prompt

```text
Repo: iprus2026-tech/BazarDriveCloud
Issue: #261 — BD-PROCESS-01 Post-merge smoke audit after #260
Branch: audit/post-merge-history-calendar-smoke

Run a docs-only post-merge smoke audit for the Profile history calendar introduced by #260.
Use docs/post-merge-history-calendar-smoke.md as the checklist.

Do not add new features.
Do not change backend, Mapbox, ActiveRide state machine, CSP, or service worker unless a concrete regression requires a separate fix issue.

If all checks pass:
- update this document with a Result section
- open a small docs-only PR
- close #261 after merge

If a regression is found:
- document the failure
- open/link a separate fix issue and branch
- keep #261 open until the fix is verified
```
