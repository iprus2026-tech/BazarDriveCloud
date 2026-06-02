# BD-INBOX-01 Inbox screen visual/contract audit

## Scope

- **Type:** report-only audit. No runtime changes were made.
- **Branch:** `audit/inbox-screen-contract`.
- **Date:** 2026-06-03.
- **Why the dispatcher selected this node:** the selection came from a **local run of
  `node scripts/dispatcher.mjs`** (its report output is not a checked-in file — `docs/dispatcher-report.md`
  is git-ignored). The dispatcher picked `public/src/screens/inbox.js` on a round-robin planned
  pass and marked it **HIGH risk** with **6/6 debug checks PASS** and merge gate **READY**. The
  checked-in dispatcher docs in the repo are `docs/dispatcher-status.md` and
  `docs/dispatcher-report.example.md`. Because the code is already green and the risk is HIGH, this
  is *not* a blind runtime fix — it is a drift check of the Inbox screen against the current routes,
  data contract, Cloud Design, and smoke coverage before any code is touched.
- **Constraint:** the only file produced by this task is this audit document. No change to
  `public/src/*`, `app.js`, `router.js`, `state.js`, `mock_api.js`, `cloud.css`, `sw.js`,
  `scripts/check.mjs`, CSP, Mapbox, backend, or APK.

## Files inspected

| File | Purpose | Key findings |
|---|---|---|
| `public/src/screens/inbox.js` | The Inbox screen render + behavior (subject) | Production-quality, class-driven, no TODO/placeholder. Renders list/empty/unread states, 4 tabs, primary/secondary/card/CTA actions. |
| `public/src/app.js` | Route registry | `register('/inbox', inbox)` at line 45; all inbox action targets (`/responses`, `/chat`, `/respond`, `/active-ride`, `/post`, `/feed`) are registered (lines 28–45). |
| `public/src/router.js` | Hash router + chrome control | `HIDE_CHROME` (line 8) does not include `/inbox` → tabbar shown; `SHOW_FAB` = `/feed` only (line 9) → FAB hidden; unknown routes fall back to `/feed` (line 57). |
| `public/src/mock_api.js` | Inbox data source | `listInboxItems()` (line 315) returns top-level shallow copies of `INBOX_ITEMS_V1` via `{ ...item }` (lines 199–290): **6 items**. Status enums `INBOX_STATUS_LABEL`/`INBOX_STATUS_TONE` (lines 294–313). |
| `public/index.html` | App shell + tabbar | Tabbar (lines 23–57) has only `/feed`, `/map`, `/rules`, `/profile` — **no Inbox entry**. |
| `public/styles/cloud.css` | Cloud Design theme + components | Dark shell + accent `#FF6B35` tokens; full inbox block (~10166–10361) — all ~35 inbox classes defined. |
| `public/sw.js` | Service worker / precache | `'./src/screens/inbox.js'` precached (line 44); cache version global, no inbox-specific versioning. |
| `scripts/check.mjs` | CI guard | No inbox checks (CSP, manifest, SW precache, active-ride guards, JS syntax, dispatcher selftest only). |
| `scripts/smoke-*.mjs` | Targeted smoke scripts | None mention inbox (driver-docs, driver-map-guard, driver-map-readiness, lifecycle, passenger-active-ride). |
| `docs/screen-contracts.md` | Screen contracts | BD-INBOX-01 contract present (lines 217–226); matches code; silent on entry point + persistence. **BD-PROFILE-01 (line 157) promises "view inbox/history/favorites"** — see Findings (profile drift). |
| `scripts/dispatcher.mjs` (run locally) | Dispatcher node selector | Source of the selection (HIGH risk, merge gate READY, global smokes PASS). Output report (`docs/dispatcher-report.md`) is git-ignored, not checked in. |
| `docs/dispatcher-status.md`, `docs/dispatcher-report.example.md` | Checked-in dispatcher docs | The only dispatcher docs tracked in the repo. |
| `README.md` / `ROADMAP.md` | Project notes | Inbox listed as shipped (`BD-INBOX-01` hub). |

## Current route / entry points

- **Route:** `#/inbox`. Tab state carried in the hash query: `#/inbox?tab=all|responses|messages|rides`.
  An invalid `?tab=` value falls back to `all` ([inbox.js:50-53](../../public/src/screens/inbox.js#L50-L53));
  tab switches are written back with `history.replaceState` ([inbox.js:250-253](../../public/src/screens/inbox.js#L250-L253)).
- **Registration:** imported at [app.js:24](../../public/src/app.js#L24), registered
  `register('/inbox', inbox)` at [app.js:45](../../public/src/app.js#L45). Screen export is the
  default `async function inbox()` at [inbox.js:194](../../public/src/screens/inbox.js#L194).
- **Chrome / tabbar / FAB:**
  - Tabbar is **shown** on `/inbox` — `/inbox` is *not* in `HIDE_CHROME`
    ([router.js:8](../../public/src/router.js#L8)).
  - FAB is **hidden** on `/inbox` — `SHOW_FAB` is `/feed` only
    ([router.js:9](../../public/src/router.js#L9)).
- **Links into Inbox — DRIFT:** a repo-wide search for `/inbox` returns only its own import,
  its registration, the SW precache entry ([sw.js:44](../../public/sw.js#L44)), and its own hash
  rewrite ([inbox.js:250](../../public/src/screens/inbox.js#L250)). **No screen navigates to
  `/inbox`**, and Inbox is **not** one of the four tabbar buttons
  ([index.html:23-57](../../public/index.html#L23-L57)). The screen is reachable only by typing
  the hash directly. This is sharper than a missing tabbar link: the passenger-profile contract
  (`screen-contracts.md` BD-PROFILE-01, line 157) explicitly promises "view inbox", yet
  `profile.js` never routes to `/inbox` — a documented entry-point contract drift. See
  [Findings](#findings) → drift (items 1–2).

## Current states

| State | Trigger / source | Visible UI | Expected behavior | Reference |
|---|---|---|---|---|
| Default list | `listInboxItems()` returns items; active tab has matches | Topbar "Входящие" + unread badge, 4 tab chips, list of cards | Render cards for the active tab | [inbox.js:235-240](../../public/src/screens/inbox.js#L235-L240), [127-177](../../public/src/screens/inbox.js#L127-L177) |
| Empty (per tab) | Active tab has no items | `inbox-empty` card: ✉ glyph, title, tab-specific hint, CTA "Перейти в ленту" | CTA routes to `/feed` | [inbox.js:179-192](../../public/src/screens/inbox.js#L179-L192), hints [28-33](../../public/src/screens/inbox.js#L28-L33) |
| Unread item | `item.unread === true` | Accent border (`inbox-item--unread`), unread dot, counted in topbar badge | Visual emphasis only | [inbox.js:145](../../public/src/screens/inbox.js#L145), [156-158](../../public/src/screens/inbox.js#L156-L158), [212-217](../../public/src/screens/inbox.js#L212-L217) |
| Read item | `item.unread === false` | No dot, no accent border | Plain card | [inbox.js:145](../../public/src/screens/inbox.js#L145) |
| Passenger thread | seed `role: 'passenger'` | Driver actor + driver-facing actions (view response / to-ride / chat) | Open passenger-side target | seed [mock_api.js:200-214](../../public/src/mock_api.js#L200-L214), [246-258](../../public/src/mock_api.js#L246-L258) |
| Driver / respond thread | seed `role: 'driver'` | Passenger actor + "Ответить пассажиру" / "Продолжить поездку" | Open driver-side target | seed [mock_api.js:216-229](../../public/src/mock_api.js#L216-L229), [260-273](../../public/src/mock_api.js#L260-L273) |
| Active-ride thread | `kind: 'ride'`, status `DRIVER_EN_ROUTE`/`IN_PROGRESS` | Ride card → `/active-ride?...` + chat | Open the live ride surface | [mock_api.js:246-273](../../public/src/mock_api.js#L246-L273) |
| Completed ride | `status: 'COMPLETED'` | Muted status pill, "Открыть чат" / "Посмотреть пост" | Open chat / post | [mock_api.js:276-289](../../public/src/mock_api.js#L276-L289) |
| Loading / error | n/a | none | n/a — `listInboxItems()` resolves synchronously from an in-memory seed, so there is no async/error path | [mock_api.js:315-318](../../public/src/mock_api.js#L315-L318) (informational) |
| Unknown status fallback | `INBOX_STATUS_LABEL[status]` missing | Status badge omitted; tone defaults to `muted` | Fail soft | [inbox.js:75-78](../../public/src/screens/inbox.js#L75-L78) |
| Empty action fallback | item without primary & secondary | Actions block omitted; card uses `href` fallback (or empty) | Card still focusable; no-op if no href | [inbox.js:101-102](../../public/src/screens/inbox.js#L101-L102), [136](../../public/src/screens/inbox.js#L136) |

## Data contract

- **Source:** `listInboxItems()` ([mock_api.js:315-318](../../public/src/mock_api.js#L315-L318))
  returns **top-level shallow copies** of the in-memory seed `INBOX_ITEMS_V1`
  ([mock_api.js:199-290](../../public/src/mock_api.js#L199-L290)) via `{ ...item }`. This protects
  the seed against reassignment of top-level fields, but **nested objects (`route`, `primary`,
  `secondary`) are still shared by reference with `INBOX_ITEMS_V1`** — it is *not* a deep defensive
  clone. `inbox.js` only reads those nested objects (it never mutates them), so current screen usage
  is safe; the caveat matters only if a future caller mutates a nested field in place.
- **localStorage / mock API:** Inbox itself is **stateless** — it reads no localStorage and writes
  none. Related stores used by the *targets* of inbox links (chat, responses, active ride) live in
  separate modules and are out of inbox scope.
- **Item shape** (documented inline at [mock_api.js:184-198](../../public/src/mock_api.js#L184-L198)):
  `id, kind ('response'|'message'|'ride'), tab, role ('passenger'|'driver'), actor, actorRole,
  route {from,to}, status, summary, time, unread (boolean), primary {label,href},
  secondary {label,href}, href (fallback)`.
- **Seed contents:** **6 items** — 2 `response`, 1 `message`, 3 `ride`; **4 are unread**
  (`inbox-response-1`, `inbox-response-2`, `inbox-message-1`, `inbox-ride-2`).
- **IDs:** thread ids are prefixed strings (`inbox-response-1`, `inbox-message-1`, `inbox-ride-3`).
  Order/ride linkage is carried in the action hrefs (`?postId=`, `?tripId=`, `?responseId=`,
  `?id=`), not as structured fields on the inbox item.
- **Statuses:** `INBOX_STATUS_LABEL` and `INBOX_STATUS_TONE`
  ([mock_api.js:294-313](../../public/src/mock_api.js#L294-L313)) — 7 statuses
  (`NEW_RESPONSE`, `WAITING_REPLY`, `ACCEPTED`, `DRIVER_EN_ROUTE`, `IN_PROGRESS`, `COMPLETED`,
  `CANCELED`) → tones `accent | warning | success | info | muted | danger`. Copy intentionally
  mirrors the active-ride flow.
- **Unread / read model:** a per-item boolean only. There is **no persistence and no mark-read
  action** — count is recomputed from the seed on each render
  ([inbox.js:63-64](../../public/src/screens/inbox.js#L63-L64)). Reloading resets all read state.
- **Role-specific behavior:** roles are baked into the seed; the screen does not re-filter by the
  live signed-in user's role. Passenger vs driver differ only in seeded actor/actorRole and the
  action hrefs.
- **Mock vs contract:** stable contract = the `listInboxItems()` signature, the item shape, and
  the two status enums. Clearly demo data = `INBOX_ITEMS_V1` (hardcoded names «Рустам К.»,
  «Анна М.», «Сергей Л.»). No TODO/FIXME in either file.
- **Route acceptance criterion — MET:** every primary/secondary/card href targets a registered
  route — `/responses`, `/chat`, `/respond`, `/active-ride`, `/post`, `/feed` (all in
  [app.js:28-45](../../public/src/app.js#L28-L45)); the router also falls back to `/feed` for
  unknown paths ([router.js:57](../../public/src/router.js#L57)).

## Buttons/actions matrix

| UI label | Selector / function | Target route / action | State where visible | Contract status |
|---|---|---|---|---|
| Tab chips (Все / Отклики / Сообщения / Поездки) | `[data-inbox-tab]` → `setActiveTab` | Filter list; rewrite `#/inbox?tab=` | Always | OK — [inbox.js:219-227](../../public/src/screens/inbox.js#L219-L227), [242-261](../../public/src/screens/inbox.js#L242-L261) |
| Primary action (per item) | `[data-inbox-action="primary"]` → `openHref`→`go` | `item.primary.href` (e.g. `/responses`, `/respond`, `/active-ride`, `/chat`) | List | OK — targets registered ([inbox.js:106-112](../../public/src/screens/inbox.js#L106-L112), [268-283](../../public/src/screens/inbox.js#L268-L283)) |
| Secondary action (per item) | `[data-inbox-action="secondary"]` → `openHref`→`go` | `item.secondary.href` (often `/chat`, also `/post`, `/active-ride`) | List | OK — targets registered ([inbox.js:114-122](../../public/src/screens/inbox.js#L114-L122)) |
| Whole card | `[data-inbox-id]` (click + Enter/Space) → `openHref` | `fallbackHref` = primary ∥ secondary ∥ `href` | List | OK; guarded so button clicks don't double-fire ([inbox.js:145-150](../../public/src/screens/inbox.js#L145-L150), [280-291](../../public/src/screens/inbox.js#L280-L291)) |
| Empty CTA "Перейти в ленту" | `[data-inbox-empty-cta]` → `go('/feed')` | `/feed` (hardcoded) | Empty state | OK — [inbox.js:186-189](../../public/src/screens/inbox.js#L186-L189), [275-279](../../public/src/screens/inbox.js#L275-L279) |
| Back / explicit nav | — | none on this screen (browser back only) | — | Informational — no in-screen back affordance |
| Mark read/unread | — | none | — | Not implemented (stateless model) |
| Disabled actions | — | none | — | Actions are omitted when absent rather than disabled ([inbox.js:101-102](../../public/src/screens/inbox.js#L101-L102)) |

## Cloud Design comparison

- **Theme:** dark mobile shell present (`--bg-0 #0a0a0c`, `--bg-1 #131316`, …) with accent
  **`#FF6B35`** (`--accent`) and `--accent-soft` for badges/glyph backgrounds
  ([cloud.css:1-14](../../public/styles/cloud.css#L1-L14)). The manifest `theme_color` `#FF6B35`
  is enforced by `scripts/check.mjs`.
- **Cards / list rows:** `.inbox-list`, `.inbox-item` (+ `.inbox-item--unread` accent gradient),
  head/avatar/name/meta sub-elements — all defined in the inbox block (~`cloud.css:10166-10361`).
- **Badges:** `.inbox-item__unread-dot` (accent) and `.inbox-item__status` with all six tone
  variants (`--accent/--warning/--success/--info/--danger/--muted`); topbar uses `bd-badge accent`.
- **Spacing / radius / shadows:** driven by shared tokens (`var(--pad)`, gaps, focus ring
  `2px solid var(--accent)`); no hardcoded colors outside the design tokens.
- **Empty state:** `.inbox-empty` card with `.inbox-empty__glyph` (✉ in accent-soft circle),
  title, body, CTA — fully styled.
- **Buttons:** reuse the shared `bd-btn primary sm` / `bd-btn ghost sm` component classes via
  `.inbox-item__btn`.
- **Placeholder check:** no inline styles, no `TODO`/`FIXME`, semantic markup (`<section>`,
  `<article>`) with ARIA roles (`tablist`/`tab`, `feed`, `button`, `status`).

**Conclusion:** the Cloud Design render/frame for Inbox **exists and is complete**. There is no
temporary stub to replace and **no new runtime UI to invent** — therefore **BD-INBOX-02 (Cloud
Design render gate) is NOT required**. For completeness, a future render-gate (if one is ever
added) would need to assert these states: Inbox default, Empty inbox, Unread messages, Read
messages, Passenger chat thread, Driver/respond thread, Active-ride thread, and Error/loading
(N/A here — synchronous seed, no async path).

## Navigation/chrome notes

- **Tabbar:** visible on `/inbox`, but Inbox is **not** a tab — the bar shows Лента/Карта/Правила/
  Профиль, so no tab is highlighted while on Inbox ([index.html:23-57](../../public/index.html#L23-L57),
  [router.js:8](../../public/src/router.js#L8)).
- **FAB:** hidden on `/inbox` (`SHOW_FAB` = `/feed` only, [router.js:9](../../public/src/router.js#L9)).
- **Header:** the screen renders its own `bd-topbar` ("Входящие" + unread badge)
  ([inbox.js:206-218](../../public/src/screens/inbox.js#L206-L218)).
- **Back:** no in-screen back button; users rely on browser back. All outbound navigation uses
  `go(href)` (hash change).
- **Entry-point gap:** because Inbox is neither in the tabbar nor linked from any other screen, in
  the current build it is reachable only via the literal hash `#/inbox`. See Findings → drift.

## Smoke/manual coverage

- **Existing executable coverage:** none. `scripts/check.mjs` has no inbox route/contract/action
  assertions, and none of the `smoke-*.mjs` scripts reference inbox. By contrast, active-ride has a
  dedicated `smoke-passenger-active-ride.mjs` and inline guards in `check.mjs`.
- **Manual test URLs/routes:**
  - `#/inbox` — default (tab "all"), unread badge = 4.
  - `#/inbox?tab=responses` — 2 items.
  - `#/inbox?tab=messages` — 1 item.
  - `#/inbox?tab=rides` — 3 items.
  - `#/inbox?tab=bogus` — falls back to "all".
  - Primary/secondary actions should land on `/responses`, `/respond`, `/chat`, `/active-ride`,
    `/post`; empty CTA lands on `/feed`.
- **Missing executable guard:** route registration, tab filtering, action-href-in-registered-route-set,
  empty CTA target, and unread-count integrity. See Findings → smoke gap (BD-INBOX-03).

## Findings

1. **`/inbox` has no in-app entry point — `drift`.** Registered and fully rendered, but not in the
   tabbar and not linked from any screen (`feed`, `profile`, `chat`, `respond`, `responses`,
   `active-ride`). Reachable only by typing the hash. Resolving this is a runtime/product change →
   deferred (BD-INBOX-04).
2. **Passenger profile contract promises inbox access that the code does not deliver — `drift`.**
   `docs/screen-contracts.md` BD-PROFILE-01 (passenger profile, line 157) lists the action
   **"Verify phone mock, edit profile, create ride, view inbox/history/favorites"**, yet
   `public/src/screens/profile.js` has **no `/inbox` navigation** — its closest menu item
   (`#pfp-menu-history`) routes to `/feed` ([profile.js:898](../../public/src/screens/profile.js#L898)),
   and a search of the file finds no `go('/inbox')`. This is a **documented entry-point contract
   drift** (contract says profile opens the inbox; the screen never does), not merely a missing
   tabbar link. → folded into BD-INBOX-04.
3. **No smoke/regression coverage — `smoke gap`.** Neither `check.mjs` nor any `smoke-*.mjs`
   exercises Inbox. → BD-INBOX-03.
4. **Contract omits entry point + persistence facts — `docs gap`.** `screen-contracts.md` (217–226)
   documents states/actions/acceptance but not the stateless unread model (no persistence, no
   mark-read) or the entry-point status. → BD-INBOX-05 (optional).
5. **Unread/read is non-persistent — `informational`.** `unread` is a per-load boolean; reloading
   resets it. Matches the mock spine; no backend store implied. Not a defect.
6. **No loading/error state — `informational`.** `listInboxItems()` resolves synchronously from an
   in-memory seed, so there is no async failure surface by design.
7. **Route acceptance criterion met — `informational`.** All action hrefs target registered routes;
   router falls back to `/feed` for unknown paths. No broken-link drift.
8. **Cloud Design parity complete — `informational`.** All ~35 inbox classes defined; accent
   `#FF6B35`; no placeholder/stub. No render-gate or visual-polish issue needed.
9. **`listInboxItems()` is a top-level shallow copy, not a deep clone — `informational`.** Nested
   `route`/`primary`/`secondary` objects remain shared with the seed; safe today because `inbox.js`
   never mutates them. Not a defect under current usage.

## Recommended follow-up issues

- **BD-INBOX-03 Inbox smoke/regression guard** *(smoke gap)* — add `scripts/smoke-inbox.mjs`
  (and/or a `check.mjs` block) asserting: `/inbox` registration, tab filtering per
  `responses/messages/rides/all`, every action href resolves to a registered route, empty CTA →
  `/feed`, and that the topbar unread count equals the number of items flagged `unread`.
- **BD-INBOX-04 Inbox entry-point / navigation** *(drift)* — product/runtime decision on how users
  reach Inbox (e.g. a notifications/messages affordance or tabbar slot). **Must explicitly resolve
  the passenger-profile contract mismatch:** `screen-contracts.md` BD-PROFILE-01 (line 157) lists
  "view inbox" as a passenger-profile action, but `profile.js` provides no `/inbox` navigation —
  either wire a profile → `/inbox` entry point or correct the BD-PROFILE-01 contract. Out of scope
  for this report-only task.
- **BD-INBOX-05 Inbox docs contract sync** *(docs gap, optional)* — extend `screen-contracts.md`
  BD-INBOX-01 to record the stateless unread model (no persistence / no mark-read), the absence of
  an async error/loading state, and the current entry-point status.

**Not required:** BD-INBOX-02 (Cloud Design render gate) — the render frame exists and is complete;
no visual-parity/polish issue — parity is already met.

## Final verdict

**FOLLOW-UP REQUIRED — no runtime changes in this task.**

The Inbox screen is itself contract-correct, route-safe, and at full Cloud Design parity with green
checks. Gaps remain that are *not* runtime fixes for this audit: it has **no smoke coverage**
(BD-INBOX-03) and **no in-app entry point** — including a documented passenger-profile contract
drift where BD-PROFILE-01 promises "view inbox" but `profile.js` provides no `/inbox` navigation
(BD-INBOX-04) — plus an optional docs sync (BD-INBOX-05). No code, CSS, service worker, or smoke
script was modified.
