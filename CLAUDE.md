# CLAUDE.md

## Project

Repository: `iprus2026-tech/BazarDriveCloud`

BazarDriveCloud is a vanilla PWA and Cloud Design repository.

It is not:
- an Android app
- a backend repository
- a React or Vite runtime app

The current app is a static PWA with:
- `public/index.html`
- `public/src/*.js` ES modules
- `public/styles/cloud.css`
- localStorage and mock API data
- strict CSP
- service worker
- GitHub Pages

## Main source of truth

Before changing routes, screens, or flow documentation, check:

- `public/src/app.js`
- `public/src/router.js`
- `docs/screen-contracts.md`
- `docs/flow-contracts.md`
- `docs/screen-map.md`
- `docs/design-registry.json`
- `docs/full-flow-map.md`
- `docs/screen-transitions.md`
- `docs/missing-screens.md`

Do not invent routes or files if the runtime already has a registered route or shipped screen.

## Branch discipline

Never work directly on `main`.

Use a fresh branch from updated `main`:

```
git checkout main
git pull --ff-only origin main
git checkout -b <branch-name>
```

Keep PRs small and scoped. Do not mix:
- docs-only changes with runtime changes
- unrelated screens
- service worker changes with design docs
- Mapbox/backend work with UI-only work

## PR review thread discipline

1. Fetch latest PR state.
2. Fetch all review threads.
3. Count active threads (active = is_outdated: false and is_resolved: false).
4. Do not merge while active threads exist.
5. A reply is not the same as resolving a thread.
6. Only resolve a thread after confirming the fix is present.
7. If Codex posts new comments after the latest commit, those new comments become the current source of truth.

## Merge rules

Merge only when all are true:
- unresolved review threads = 0
- active non-outdated review threads = 0
- checks are green
- PR is mergeable / clean
- working tree is clean
- user explicitly says to merge

Use squash merge unless the user says otherwise.
After merge:
```
git checkout main && git pull --ff-only origin main && git status
node scripts/check.mjs
node scripts/dispatcher.mjs
```
Report: merge commit SHA, main SHA after pull, check result, dispatcher result, working tree status.

## Safety boundaries

Do not change these unless the task explicitly asks:
- `public/index.html`
- `public/sw.js`
- service worker precache
- CSP
- backend
- Mapbox SDK
- React/Vite
- Android/APK
- runtime JS when the PR is docs/reference only

For docs/reference PRs, touch only the requested docs or prototype artifact files.

## Current route truth

Use registered runtime routes from `public/src/app.js`. Important routes:
- `/welcome`
- `/onboarding`
- `/feed`
- `/post?id=...`
- `/new`
- `/map`
- `/location-permission`
- `/route-picker`
- `/route-preview`
- `/order-map-draft`
- `/responses`
- `/respond?postId=...`
- `/chat?tripId=...`
- `/chat?responseId=...`
- `/trip-confirmation`
- `/active-ride?role=passenger&tripId=...`
- `/active-ride?role=driver&tripId=...`
- `/driver-map`
- `/profile`
- `/profile?role=driver&pane=payouts`
- `/receipt?tripId=...`
- `/rules`
- `/inbox`

Do not use old sandbox file names (feed.jsx, route-picker.jsx, etc).
Use real runtime paths (public/src/screens/feed.js, etc).

## Known flow details

### Feed
- Feed card tap goes to `/post?id=...`.
- Feed does not directly open `/order/<id>`.

### Post Detail
- `/post?id=...` is its own shipped gate.
- `post_detail.js` owns primary-action decisions: respond, chat, own post, accept/order flows.

### Map
`/map` has two shipped branches:
- choose route / manual route -> `/route-picker`
- my-location -> `/location-permission`

### Location Permission
Runtime behavior:
- allow -> `/map?state=default`
- manual -> `/route-picker`
- back -> `/map`
Do not collapse allow and manual into the same destination.

### Order Map Draft
Submit does not navigate directly. Runtime behavior:
- `handlePublish` creates the order.
- The screen re-renders the success card with `lastOrder`.
- User taps success CTA responses or my-order.
- `handleAction` navigates to `/responses?orderId=...&state=empty`.
Docs and smoke expectations must preserve the success-card state before the CTA tap.

### Responses
Selecting a driver builds active ride:
`/active-ride?role=passenger&tripId=<tripId>&status=DRIVER_EN_ROUTE`

### Respond
`/respond` requires postId: `/respond?postId=...`
Driver offer variant: success -> `/chat?responseId=resp_<post.id>&role=driver`
Marketplace variant: success overlay -> `/feed`
No marketplace chat handoff today.

### Driver Map
Accepted-card button opens:
`/active-ride?role=driver&tripId=...&status=ACCEPTED`
Bare `/active-ride?role=driver` can fall into fallback/demo behavior.

### Order Detail
Primary actions re-render in place.
Driver open-active-ride: `/active-ride?role=driver&tripId=...`
No `status=ACCEPTED` is appended by `order_detail.js`.

### Driver Earnings
Close does not immediately navigate to `/driver-map`.
Runtime pattern: close -> loading -> closed card -> button -> /driver-map

### Rules
Rules sections are static read-only articles. No section-detail route today.
Search and document download controls are UI-only/no-op today.

### Notifications
Audit `/inbox` before creating `/notifications`.
Known entry points: passenger: #pfp-notif-btn, driver: #pf2-act-notif
The driver profile does not have a notification bell today.
#pf2-act-notif currently toggles notificationsEnabled.
Future notification work must decide: reuse /inbox or consciously split /notifications after audit.
Do not silently orphan `/inbox`.

### Moderation
Wire inert standalone report CTAs (e.g. Order Detail data-action="report-order").
Preserve in-ride safety report sheet behavior.
Do not reroute BD-RIDE-P-07 safety report to /report.

## Local verification

Use these checks before PR:
```
git status
git diff --stat
git diff --name-only
node scripts/check.mjs
node scripts/dispatcher.mjs
```
If a script is missing, report that clearly instead of inventing a result.

## Working style
- Keep changes small.
- Audit first when unsure.
- Prefer documenting shipped behavior over guessing.
- Do not rewrite working flows without explicit task scope.
- Do not broaden a docs-only task into runtime implementation.
- Do not merge without explicit user approval.

## Agent roles

Each role below has a specific scope. An agent must not expand into another role's territory.

### Authority order

When instructions conflict, earlier items win:

1. User instruction
2. GitHub issue / PR scope
3. CLAUDE.md
4. `docs/screen-contracts.md` and product contracts
5. `scripts/check.mjs` / `dispatcher.mjs`
6. Review comments
7. Individual agent role notes

No agent may override:
- explicit user constraints
- issue scope
- runtime safety rules
- failing checks
- review blockers

### Operational summary

dispatcher-agent routes the work,
implementation-agent performs the scoped change,
review-agent catches defects,
smoke-agent guards regressions,
css-ux-agent preserves Cloud Design parity,
sw-offline-agent protects the PWA/offline layer,
docs-contract-agent keeps the project map and contracts aligned.

### dispatcher-agent

- **Purpose**: reads `node scripts/dispatcher.mjs`, `node scripts/check.mjs`, git status, PR/issue scope, and routes work to the correct role. Reports repo readiness and next safe action.
- **Typical areas**:
  - `scripts/dispatcher.mjs` output
  - `scripts/check.mjs` output
  - repo readiness reports
  - issue/PR scope definition
  - role task routing
  - post-merge verification
  - drift/risk summary

- **Triggers**:
  - User says: `dispatcher`, `диспетчер`, `main green`, `dispatcher clean`, `READY_CLEAN`, `следующий шаг`
  - User asks what to do after merge
  - User asks to interpret `node scripts/dispatcher.mjs`
  - User asks to route a review comment to the correct role
  - User asks whether repo is ready for next task
  - User asks to define a safe PR scope

- **Allowed areas**:
  - Read and summarize dispatcher/check output
  - Read git status / branch / diff summary
  - Define target file/area
  - Define risk level
  - Produce role task list
  - Produce handoff message for another agent
  - Recommend next branch name
  - Recommend issue/PR scope

- **Must not**:
  - Edit runtime code
  - Edit CSS
  - Edit docs
  - Edit smoke scripts
  - Change app behavior
  - Commit changes
  - Resolve review comments without checking scope
  - Merge PRs
  - Create broad implementation plans that mix unrelated areas

- **Review guard**:
  - If review comments mention runtime files, CSS, docs, smoke, or contracts, dispatcher-agent must route them to the proper implementation/review role instead of editing directly.
  - If dispatcher output is not `READY_CLEAN`, dispatcher-agent must report blockers first.
  - If working tree is dirty, dispatcher-agent must stop and summarize changed files before recommending next work.
  - If check output fails, dispatcher-agent must identify failing check and route to the smallest responsible role.
  - If risk is HIGH, dispatcher-agent must recommend a narrow branch and one-slice PR.

- **Handoff format**:
  ```text
  Dispatcher status:
  - check:
  - dispatcher:
  - debug:
  - drift:
  - working tree:

  Target:
  - file/area:
  - risk:
  - suggested branch:

  Role tasks:
  - role:
    task:
    allowed files:
    must not touch:

  Next action:
  -
  ```

- **Output style**:
  - Be short and operational.
  - Prefer exact commands when useful.
  - Do not invent green status. If output was not provided, ask for or request running:
    `node scripts/check.mjs`
    `node scripts/dispatcher.mjs`
    `git status --short`

### review-agent
- **Purpose**: interprets PR review comments; maps each comment to a minimal, in-scope fix decision.
- **Typical areas**: GitHub PR review threads, changed files in the diff.
- **Must not**: widen fix scope beyond the items named in the review; open new issues or touch unrelated code.
- **Handoff**: per review item — decision (fix / no-fix / clarify), proposed change, verification method.

### implementation-agent
- **Purpose**: makes the scoped code or docs change named by the issue or PR body.
- **Typical areas**: files explicitly listed in the task.
- **Must not**: touch unrelated screens, introduce backend assumptions, change CSP, modify SW precache, or alter runtime flows not in scope.
- **Handoff**: files changed, `git diff --stat`, check result, proposed commit message.

### smoke-agent
- **Purpose**: writes and maintains regression guard pins in `scripts/smoke-*.mjs`.
- **Typical areas**: `scripts/smoke-*.mjs`, `scripts/check.mjs`.
- **Must not**: add broad brittle snapshot tests; import DOM or network APIs; write pins that fail on unrelated changes.
- **Handoff**: invariant guarded, smoke file name, new pin label, `node scripts/check.mjs` result.

### css-ux-agent
- **Purpose**: maintains Cloud Design parity and visual polish.

**Trigger — call css-ux-agent when the task is about:**
- visual gap vs Cloud Design (spacing, color, elevation, radius)
- mobile shell / safe-area / bottom nav / sheet layout
- cards, buttons, badges, tabs, chips, empty/loading/error states
- text density, visual hierarchy, readable UI
- manual route verification after CSS/markup polish

**Do not call css-ux-agent when the task is about:**
- storage, router, state machine, mock_api semantics
- service worker / precache, backend / API, auth, business rules

**Allowed areas:**
- `public/styles/cloud.css`
- class names, wrapper markup, aria/readable labels, visual-only empty/loading/error markup inside `public/src/screens/*.js` — affected screen only
- `docs/screen-contracts.md` only to clarify visual acceptance notes

**Must not touch:**
- route registration, localStorage keys, state transitions, API/mock_api behavior, event semantics, order/ride/payment/status logic, SW precache, CSP

**Required handoff format:**
```
Visual intent:    what should look different and why
Scope:            route(s), screen file(s), CSS area
Cloud Design ref: frame/render name or visual contract note
Manual test:      e.g. /responses, /active-ride?role=passenger
Before/after:     spacing, hierarchy, button/sheet/card changes
Safety statement: no business logic, storage, router, SW/precache changed
Checks:           node scripts/check.mjs result
```

**Review guard — stop and return to dispatcher if visual polish requires:**
- changing state shape or adding new events
- changing route behavior or touching more than the named screen(s)
- modifying service worker / cache, CSP

### sw-offline-agent
- **Purpose**: keeps the PWA cache, Service Worker, and offline/installability contract sound.
- **Typical areas**: `public/sw.js`, `public/manifest.webmanifest`, PRECACHE list.
- **Must not**: cache external Mapbox, API, or tile requests; change app logic.
- **Handoff**: VERSION bump, PRECACHE diff, offline behavior notes, installability notes.

### docs-contract-agent
- **Purpose**: owns documentation and screen/product contracts.
- **Typical areas**: `CLAUDE.md`, `docs/*`, `README.md`, `ROADMAP.md`.
- **Must not**: change runtime code in docs-only tasks; invent routes or behavior not yet shipped.
- **Handoff**: changed sections, contract notes, downstream implementation notes.

## Maintenance policy

`CLAUDE.md` is a living project document.

It may be updated as the project evolves, but only when the update changes durable repo-level guidance.

Update this file when:
- the app architecture changes
- new mandatory checks are added
- route ownership changes
- backend or Mapbox integration becomes real
- mock/localStorage flows are replaced by API-backed flows
- review, merge, or branch discipline changes
- safety boundaries change
- a new long-lived project convention is established

Do not update this file for:
- one-off bug fixes
- temporary Codex review comments
- single-screen implementation details
- short-lived workarounds
- task-specific prompts that belong in an issue or PR body

All changes to `CLAUDE.md` must go through a normal branch and PR.

When editing `CLAUDE.md`:
- keep it concise
- remove outdated guidance instead of stacking contradictions
- prefer stable rules over task history
- verify that new guidance matches the current runtime and docs
- run the standard checks if available

## Release linkage policy

`CLAUDE.md` must help agents connect implementation work to future repository releases.

Do not create GitHub Releases, tags, changelog files, or version bumps unless the task explicitly asks for release work.

For normal feature, audit, or docs PRs:
- mention whether the PR is release-facing or internal-only
- include related issue / PR numbers in the PR body
- keep release notes short and factual
- clearly state whether runtime behavior changed
- clearly state whether the PR is docs/reference only
- clearly state whether user-visible screens changed
- clearly state whether service worker / cache / CSP changed

For release-facing PRs, include a PR body section:

### Release impact
- User-visible change:
- Runtime change:
- Docs/reference change:
- Migration needed:
- Cache / service worker impact:
- Follow-up issues:

For docs-only PRs, use:

### Release impact
- User-visible runtime change: none
- Docs/reference update: yes
- Cache / service worker impact: none
- Migration needed: none

When a release is explicitly requested:
- collect merged PRs since the previous release or tag
- group notes by passenger, driver, shared, infrastructure, docs
- mention breaking changes or migrations first
- include check results
- create tags or GitHub Releases only after explicit user approval

Do not treat every PR as a release.
Do not silently tag commits.
Do not silently publish GitHub Releases.
Do not invent version numbers without user approval.

Keep this section aligned with the repo's real release process as it evolves.
