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
