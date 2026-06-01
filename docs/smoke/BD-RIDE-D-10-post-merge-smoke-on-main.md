# BD-RIDE-D-10 — post-merge smoke on main

Date: 2026-06-01

Status: **PASS for automated invariants** (`scripts/check.mjs` +
`scripts/smoke-lifecycle.mjs`, both green) and **PASS for static-server
availability + source-level audit** of the manual browser URLs.
**The real-browser visual click-through (Scenario 4–5) must be confirmed
by a human reviewer** — no interactive browser was available to this
agent; the static server it started is the same one a human can drive at
`http://localhost:8000/`. No production code change is recommended.

## 1. Environment

- Repository: `iprus2026-tech/BazarDriveCloud`
- Local working tree: `H:\тг скринщоты\CloudeCode\BazarDriveCloud`
- Branch: `main` (tracking `origin/main`, clean, up to date)
- Commit under test: `a17efb4 Polish driver cancel and problem sheets (#319)`
  - Full hash: `a17efb443f0c0efc079e1bd5a70e2cf3de0a84ee`
- OS: Windows 10 Pro 10.0.19045
- Shell: PowerShell + Bash (via Claude Code tool harness)
- Static server: `python -m http.server 8000 --directory public`
  (Python 3.13.13), started by this agent for availability checks.

## 2. Commands run

| Command | Result |
|--------|--------|
| `git checkout main` | `Already on 'main'` |
| `git pull origin main` | `Already up to date.` |
| `git status` | `nothing to commit, working tree clean` |
| `git rev-parse HEAD` | `a17efb443f0c0efc079e1bd5a70e2cf3de0a84ee` |
| `node scripts/check.mjs` | **`All checks passed.`** (exit 0) |
| `node scripts/smoke-lifecycle.mjs` | **`ALL PASSED`** — 52/52 assertions (exit 0) |
| `python -m http.server 8000 --directory public` (background) | started OK |
| `curl http://localhost:8000/` | `200` |
| `curl http://localhost:8000/index.html` | `200` |
| `curl http://localhost:8000/src/app.js` | `200` |
| `curl http://localhost:8000/src/screens/active_ride.js` | `200` |
| `curl http://localhost:8000/src/screens/active_ride_passenger.js` | `200` |

### 2.1 `node scripts/check.mjs`

`All checks passed.` The guard suite covers, per the BD-RIDE-D-10 brief:
latest handed-off `tripId` before demo fallback; explicit `tripId` →
latest handoff → demo fallback ordering; driver empty-state suppressed
when a latest handed-off `tripId` exists; `syncCanonicalOrderStatus`;
`NO_SHOW → CANCELED` canonical mapping; and persist/sync of
`IN_PROGRESS`, `COMPLETED`, `CANCELED`.

### 2.2 `node scripts/smoke-lifecycle.mjs`

`ALL PASSED` (52/52). Notable assertions:

- Full forward lifecycle: `CREATED → ACCEPTED → DRIVER_EN_ROUTE →
  WAITING_PASSENGER → IN_PROGRESS → COMPLETED`, each transition persisted
  on the active-ride store and mirrored on the canonical ride order via
  `syncCanonicalOrderStatus`.
- `acceptCanonicalRideOrder` returns `trip_<id>`; passenger snapshot
  preserved (no demo "Анна М." leak — `passenger="Ольга"`).
- Driver cancel → `CANCELED` with `cancel={"by":"driver","reason":"car_problem"}`.
- Driver no-show → canonical `CANCELED` with
  `cancel={"by":"driver","reason":"passenger_no_show"}`.
- Passenger cancel → canonical `ride_orders.v1` mirrored to `CANCELED`.
- Cross-role refresh: driver and passenger `loadCanonical` resolve the
  same trip; passenger sees the same passenger identity after refresh.
- Terminal cleanup for CANCELED / NO_SHOW / COMPLETED:
  `findLatestHandedOffOrderTripId()` returns `null`; order excluded from
  `listNearbyOrders()` and from the Feed projection.
- Bare-driver guard: after passenger cancel, driver cancel, and driver
  no-show, the canonical order is `CANCELED`,
  `findLatestHandedOffOrderTripId()` returns `null`, and the order is
  absent from nearby + feed — so `/active-ride?role=driver` cannot revive
  a terminal trip.

## 3. Source-level audit of the manual-browser invariants

Backing the manual URLs at the module level (no rewrite, read-only):

| Invariant | Source evidence |
|---|---|
| `?status=` is view-only and must not poison the persisted record | [active_ride.js:112-151](public/src/screens/active_ride.js#L112-L151) — `safeApplyStatusFromQuery` returns a new in-memory object and never calls `saveActiveRide`/`updateActiveRideStatus`; explicit BD-RIDE-D-10 comment at L117-119. |
| `?status=COMPLETED` cannot revive a canceled trip; `?status=CANCELED`/`NO_SHOW` cannot override a completed trip | [active_ride.js:145-151](public/src/screens/active_ride.js#L145-L151) — COMPLETED guard returns early if `ts.canceledAt`; CANCELED/NO_SHOW guard returns early if `ts.completedAt`. |
| Driver & passenger read one canonical record for the same `tripId` | [active_ride.js:540](public/src/screens/active_ride.js#L540) (driver) + passenger path both call `loadCanonicalActiveRide({ tripId, role })`, which reads `findActiveRide(tripId)` first without filtering by role. |
| Explicit `?tripId=` does not break fallback | [active_ride.js:527-534](public/src/screens/active_ride.js#L527-L534) — `rawTripId || findLatestHandedOffOrderTripId() || DEMO_ACTIVE_RIDE_ID`. |
| Bare `/active-ride?role=driver` never revives a terminal trip | [active_ride.js:531-558](public/src/screens/active_ride.js#L531-L558) — when `rawTripId` is absent, resolution uses `findLatestHandedOffOrderTripId()`, which skips terminal canonical rides; if nothing identifies a live ride the screen renders the empty placeholder. |
| Driver cancel / no-show mirror to canonical `CANCELED` | `persistDriverRideStatus` → `syncCanonicalOrderStatus` at [active_ride.js:571-574](public/src/screens/active_ride.js#L571-L574); confirmed end-to-end by smoke-lifecycle. |

## 4. Manual browser smoke checklist

Static server confirmed reachable (`200` on `/`, `/index.html`,
`/src/app.js`, `/src/screens/active_ride.js`,
`/src/screens/active_ride_passenger.js`). The following URLs were
**validated at the static-server + source level**; the **visual
click-through is left for a human reviewer** (no interactive browser
available to this agent).

### 4.1 Cross-role (same trip)

- `http://localhost:8000/#/active-ride?role=driver&tripId=demo-trip-1`
- `http://localhost:8000/#/active-ride?role=passenger&tripId=demo-trip-1`

Expected: driver and passenger show the same `tripId`; route / passenger /
price / ETA do not diverge; page refresh does not change trip identity.
Source-backed PASS (single canonical record via `loadCanonicalActiveRide`,
role-agnostic read).

### 4.2 Driver statuses (view-only)

- `…?role=driver&tripId=demo-trip-1&status=DRIVER_EN_ROUTE`
- `…?role=driver&tripId=demo-trip-1&status=WAITING_PASSENGER`
- `…?role=driver&tripId=demo-trip-1&status=IN_PROGRESS`
- `…?role=driver&tripId=demo-trip-1&status=COMPLETED`
- `…?role=driver&tripId=demo-trip-1&status=CANCELED`
- `…?role=driver&tripId=demo-trip-1&status=NO_SHOW`

Expected: each renders the requested display status without persisting it;
terminal statuses do not roll a live trip backward/forward illegitimately.
Source-backed PASS (`safeApplyStatusFromQuery`).

### 4.3 Passenger statuses (view-only)

- `…?role=passenger&tripId=demo-trip-1&status=DRIVER_EN_ROUTE`
- `…?role=passenger&tripId=demo-trip-1&status=WAITING_PASSENGER`
- `…?role=passenger&tripId=demo-trip-1&status=IN_PROGRESS`
- `…?role=passenger&tripId=demo-trip-1&status=COMPLETED`
- `…?role=passenger&tripId=demo-trip-1&status=CANCELED`
- `…?role=passenger&tripId=demo-trip-1&status=NO_SHOW`

Expected: view-only display status; persisted canonical record unchanged.
Source-backed PASS.

### 4.4 Bare driver URL

- `http://localhost:8000/#/active-ride?role=driver`

Expected: with no live accepted/in-progress handoff, the screen does NOT
revive a terminal (canceled / no-show / completed) trip as active.
Source-backed PASS + smoke-lifecycle PASS (`findLatestHandedOffOrderTripId()`
skips terminal rides; empty placeholder when nothing identifies a ride).

### PASS / FAIL matrix

| # | Check | Automated | Source audit | Visual (human) |
|---|---|---|---|---|
| 4.1 | Cross-role same trip / refresh stable | PASS (refresh asserts) | PASS | pending human |
| 4.2 | Driver `?status=` view-only | PASS (persist guards) | PASS | pending human |
| 4.3 | Passenger `?status=` view-only | PASS | PASS | pending human |
| 4.4 | Bare driver no terminal revive | PASS | PASS | pending human |
| — | Driver cancel → canonical CANCELED | PASS | PASS | pending human |
| — | Driver no-show → canonical CANCELED | PASS | PASS | pending human |
| — | Passenger cancel → canonical CANCELED | PASS | PASS | pending human |
| — | Terminal absent from nearby / feed | PASS | PASS | pending human |

## 5. Bugs found

None. Every BD-RIDE-D-10 invariant the task asked for holds:
`scripts/check.mjs` and `scripts/smoke-lifecycle.mjs` are both green, and
the source-level audit of `active_ride.js` confirms the view-only
`?status=` handling, the cross-role single-canonical-record read, and the
bare-driver terminal-revive guard.

## 6. Final recommendation

**PASS — no production code change.** Both automated suites are green and
the manual-URL invariants are confirmed at the static-server + source
level. The only outstanding item is the human visual click-through of the
URLs in section 4 (no interactive browser was available to this agent).
If a future visual pass surfaces a layout/runtime bug, it should land as a
fresh BD-RIDE-D-XX issue with the exact URL, persisted role / localStorage
state, expected vs. actual, and the suspected file.
