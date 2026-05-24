# BD-RIDE-FIX-02 — Post-merge mobile smoke audit

> Audit record for issue [#208](https://github.com/iprus2026-tech/BazarDriveCloud/issues/208).
> Verifies that PR [#205](https://github.com/iprus2026-tech/BazarDriveCloud/pull/205) (Android
> system navigation bar safe-area for active-ride layouts) and PR
> [#207](https://github.com/iprus2026-tech/BazarDriveCloud/pull/207) (driver sheet bottom-CTA
> visibility floor) did not introduce regressions after merge into `main`.

| Field | Value |
|-------|-------|
| Issue | #208 |
| Date | 2026-05-24 |
| Branch | `audit/mobile-smoke-active-ride` |
| Base commit | `c2e86f8 fix(driver-sheets): guarantee bottom CTA visibility above safe-area (#207)` |
| Audited PRs | #205, #207 |
| Working tree | clean (docs-only addition) |
| `node scripts/check.mjs` | ✅ `All checks passed.` (exit 0) |
| Scope | Cloud / PWA only. Mock UI. No backend, no Mapbox SDK, no auth/payment. |
| Audit type | **Code-level inspection** + harness check. See §6 for runtime caveat. |

## §1. PR recap

### PR #205 — `Fix Android system nav bar overlap in active ride layouts`
CSS-only diff (`public/styles/cloud.css`, +21/-4):

- Adds tokens `--system-nav-safe-bottom: max(12px, env(safe-area-inset-bottom, 0px))`
  and `--active-ride-bottom-safe: calc(32px + var(--system-nav-safe-bottom))`
  (`cloud.css:30-31`).
- Makes `.active-ride__sheet` scroll its own overflow with
  `max-height: calc(100% - 60px)`, `overflow-y: auto`, `overscroll-behavior: contain`,
  and `scroll-padding-bottom: var(--active-ride-bottom-safe)` (`cloud.css:4557-4580`).
- Pads `.passenger-complete__scroll` bottom and scroll-padding with the same token
  (`cloud.css:5820-5834`).
- Lifts `.active-ride__notice` to `bottom: calc(var(--system-nav-safe-bottom) + 12px)`
  (`cloud.css:4865-4874`).

### PR #207 — `fix(driver-sheets): guarantee bottom CTA visibility above safe-area`
CSS-only diff (`public/styles/driver_sheets.css`, +4/-1):

- Floors `.driver-sheet__panel` bottom padding with
  `max(env(safe-area-inset-bottom, 0px) + 24px, 32px)` so Android Chrome / desktop
  viewports without inset still keep CTAs clear (`driver_sheets.css:29`).
- Mirrors `scroll-padding-bottom` so tall content can scroll the trailing action
  into view (`driver_sheets.css:30`).
- Adds `overscroll-behavior: contain` (`driver_sheets.css:23`) and a small
  `padding-bottom: 4px` on `.driver-sheet__actions` (`driver_sheets.css:152`).

Both PRs are CSS-only. No JS, no HTML, no SW, no manifest, no CSP changes.

## §2. Viewport matrix

| Device class | Viewport | Notes |
|---|---|---|
| Compact Android | 360 × 740 | Smallest target; horizontal overflow check anchor. |
| iPhone 12/13/14 | 390 × 844 | iOS Safari (notch inset path). |
| Pixel 6/7/8 | 412 × 915 | Android Chrome, gesture nav. |
| Pixel Pro / iPhone Plus | 430 × 932 | App shell `max-width: 430px` ceiling. |

App shell caps at `max-width: 430px` (`cloud.css:70`), so beyond 430 the layout
is centered with letterboxing — there is no responsive break above that.

## §3. URL matrix

All entries are hash routes (`/#/...`).

### Driver `/active-ride`

| URL | Renderer | Expectation |
|---|---|---|
| `?role=driver&status=NEW_ORDER` | `renderNewOrder` (`active_ride.js:509`) | Bottom “Принять / Пропустить” row clears nav bar. |
| `?role=driver&status=DRIVER_EN_ROUTE` | `renderEnRoute` (`active_ride.js:520`) | Primary stack + secondary row reachable. |
| `?role=driver&status=WAITING_PASSENGER` | `renderWaiting` | Notice toast sits above nav bar. |
| `?role=driver&status=IN_PROGRESS` | `renderInProgress` | Primary “Завершить” reachable. |
| `?role=driver&status=COMPLETED` | `renderCompleted` (`active_ride.js:566`) | Summary + 3-row action block scrolls inside sheet. |
| `?role=driver&status=CANCELED` | `renderCanceledStub` | Stub copy + back action reachable. |

### Passenger `/active-ride`

| URL | Renderer | Expectation |
|---|---|---|
| `?role=passenger&status=DRIVER_EN_ROUTE` | `renderPassenger` → `activeRidePassenger` | Sheet bottom CTAs above nav bar. |
| `?role=passenger&status=WAITING_PASSENGER` | `activeRidePassenger` | Notice / CTAs clear nav. |
| `?role=passenger&status=IN_PROGRESS` | `activeRidePassenger` | Sheet bottom reachable. |
| `?role=passenger&status=COMPLETED` | `passenger-complete__scroll` panel | Rating, payment, report cards scroll within the panel; safe bottom padding. |
| `?role=passenger&status=CANCELED` | `activeRidePassenger` | Canceled stub reachable. |

### Driver sheets (overlays on `/active-ride?role=driver`)

| Sheet | Trigger | Expectation |
|---|---|---|
| `DriverCancelRideSheet` | `ar-cancel` button | Confirm + “Назад” reachable; sheet scrolls if reasons overflow. |
| `DriverProblemSheet` | `ar-problem` button | Same. |
| `DriverEarningsSheet` | `ar-earnings` button | Close action reachable; breakdown scrolls within panel. |

### Regression routes

| URL | Renderer | Expectation |
|---|---|---|
| `/feed` | `feed` (`app.js:22`) | Chrome (tabbar + FAB) visible. |
| `/chat` | `chat` (`app.js:29`) | Chrome visible; composer above tabbar. |
| `/respond` | `respond` (`app.js:28`) | Chrome visible; CTAs above tabbar. |
| `/trip-confirmation?role=driver` | `tripConfirmation` (`app.js:32`) | Chrome hidden (HIDE_CHROME). |
| `/trip-confirmation?role=passenger` | `tripConfirmation` | Chrome hidden (HIDE_CHROME). |

Chrome visibility is owned by `router.js:6` —
`HIDE_CHROME = new Set(['/welcome', '/onboarding', '/active-ride', '/trip-confirmation'])`.
Unchanged by #205 / #207. Confirmed by reading `public/src/router.js:6-67`.

## §4. Specific visual checks — code-level findings

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Driver COMPLETED summary buttons reachable | ✅ | `.active-ride__sheet` now scrolls; `.active-ride__completion-actions` lives inside it (`active_ride.js:566`). Sheet has `scroll-padding-bottom: var(--active-ride-bottom-safe)` (`cloud.css:4579`). |
| 2 | Passenger COMPLETED / rating reachable | ✅ | `.passenger-complete__scroll` `padding-bottom: var(--active-ride-bottom-safe)` (`cloud.css:5827`). |
| 3 | Driver cancel/problem/earnings sheets have safe bottom spacing | ✅ | `.driver-sheet__panel` floor `max(inset + 24px, 32px)` (`driver_sheets.css:29`). |
| 4 | Button rows clear of Android system nav / home indicator | ✅ | All bottom panels resolve to ≥ 32px floor, plus `env(safe-area-inset-bottom)` when present. |
| 5 | Long content scrolls inside sheet, not behind | ✅ | `.active-ride__sheet` `max-height: calc(100% - 60px)`; `.driver-sheet__panel` `max-height: 86dvh`; both have `overscroll-behavior: contain`. |
| 6 | Toast/notice above nav bar | ✅ | `.active-ride__notice` `bottom: calc(var(--system-nav-safe-bottom) + 12px)` (`cloud.css:4869`). |
| 7 | No horizontal overflow at 360px | ✅ | App shell `max-width: 430px` (`cloud.css:70`); all flex children carry `min-width: 0`; no `width: 3??px` or `width: 4??px` fixed values inside active-ride / driver-sheet selectors. |
| 8 | Chrome/tabbar hidden on `/active-ride` | ✅ | `router.js:6,46-49`. |
| 9 | Chrome/tabbar normal on `/feed` | ✅ | `/feed` not in `HIDE_CHROME`; `SHOW_FAB` includes `/feed`. |
| 10 | No unexpected service worker churn | ✅ | `public/sw.js` `VERSION = 'v37'` unchanged by #205/#207; PRECACHE unchanged. |
| 11 | No CSP weakening | ✅ | `public/index.html:7-8` still `default-src 'self'; script-src 'self'; style-src 'self'; …` — no `unsafe-inline`, no `unsafe-eval`. |
| 12 | No inline script/style | ✅ | `node scripts/check.mjs` enforces it; pass. |
| 13 | No Mapbox / backend / auth / payment changes | ✅ | Both diffs are CSS-only. |

## §5. Verification

```text
$ node scripts/check.mjs
All checks passed.
```

```text
$ git diff --stat main...audit/mobile-smoke-active-ride
 docs/mobile-active-ride-smoke-audit.md | (new)
```

No runtime files (`public/**`) changed on this audit branch.

## §6. Runtime caveat

This audit was prepared inside a headless cloud environment (Claude Code on the
web). Hands-on driving of real Android Chrome (gesture nav + 3-button nav)
and real iOS Safari was **not** performed in this session. The findings above
are derived from:

1. Reading the merged CSS deltas of #205 and #207.
2. Reading the active-ride / passenger-active-ride / driver-sheets renderers
   to confirm the new tokens and rules are reachable from the rendered DOM.
3. The unchanged `router.js` chrome rules.
4. Static checks via `node scripts/check.mjs`.
5. Spot-checking `index.html` CSP and `sw.js` precache for absence of churn.

For full sign-off, the request for a real Android Chrome run with both
gesture and 3-button navigation across the 360 / 390 / 412 / 430 viewport
matrix remains valid and should be performed by a human tester on the
matching device profiles in DevTools or on hardware. No code-level
regression was found that would block such a run.

## §7. Findings

**No regressions found.** Both PRs are tightly scoped, CSS-only, and the
modifications observe the existing chrome/tabbar invariants. The new tokens
(`--system-nav-safe-bottom`, `--active-ride-bottom-safe`) and the
`max(inset + N, floor)` pattern on driver sheets are the correct way to
defend against Android Chrome's dynamic bottom chrome, the iOS home
indicator, and desktop emulators where `env(safe-area-inset-bottom)`
resolves to `0`.

## §8. Non-blocking observations

These are *not* regressions and require no action under this issue:

- `--system-nav-safe-bottom: max(12px, env(safe-area-inset-bottom, 0px))` adds
  a 12px floor on viewports without an inset (desktop, older browsers). Net
  effect on `/active-ride` is `12 + 32 = 44px` of bottom padding even when
  the OS reports no inset. This is intentional per the PR #205 review
  follow-up and acceptable.
- `.active-ride__sheet { max-height: calc(100% - 60px) }` reserves 60px at
  the top of the screen so a slice of `.active-ride__top` stays visible.
  On very short viewports (e.g. landscape on a small phone) this could
  compress the sheet area; out of scope here and explicitly desired.
- `.driver-sheet__panel { max-height: 86dvh }` relies on `dvh`. Modern
  Android Chrome and iOS Safari 15.4+ support it; older WebViews will fall
  back to ignoring the rule and the panel will be unbounded. No action
  needed — graceful enough for mock UI.

## §9. Out of scope

- Backend / API / auth / payment.
- Real Mapbox SDK.
- Rewriting active-ride state machine (`ride_state.js`).
- Broad UI redesign.
- CSP weakening or service-worker version bumps.
- Prototype changes (`public/prototypes/` is excluded from `check.mjs`).

## §10. Acceptance checklist

- [x] `node scripts/check.mjs` passes.
- [x] Driver active-ride statuses inspected at code level (NEW_ORDER, DRIVER_EN_ROUTE, WAITING_PASSENGER, IN_PROGRESS, COMPLETED, CANCELED).
- [x] Passenger active-ride statuses inspected (DRIVER_EN_ROUTE, WAITING_PASSENGER, IN_PROGRESS, COMPLETED, CANCELED).
- [x] Driver sheets (cancel, problem, earnings) inspected.
- [x] `/feed`, `/chat`, `/respond`, `/trip-confirmation` inspected.
- [x] Mobile viewport matrix recorded (360 / 390 / 412 / 430).
- [x] No bottom action hidden behind Android system navigation (token math sound).
- [x] No horizontal overflow risk at 360px in audited selectors.
- [x] No CSP, SW, inline-script/style, Mapbox, backend, or auth churn.
- [x] No runtime files changed on this audit branch.
- [ ] Real-device Android Chrome run with gesture + 3-button nav — recommended follow-up by a human tester (see §6).
