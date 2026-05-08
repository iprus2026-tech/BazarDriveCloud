# BazarDriveCloud screen contracts

This document keeps the dispatcher development line grounded: every screen must have a Cloud Design render/frame, route, file path, state contract, actions, and acceptance checklist before implementation or audit work moves forward.

Parent tracking issue: #19
First audit issue: #20

## Dispatcher line

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

## BD-FEED-01 — Feed V2

### Identity

```text
Screen: Feed V2
Route: /feed
File: public/src/screens/feed.js
Data source: listFeedPosts() from public/src/mock_api.js
State: local active category inside feed.js
Parent issue: #19
Working issue: #20
Recommended branch: audit/feed-dispatch-line
```

### Cloud Design render/frame gate

Status: needs explicit render/frame confirmation.

Feed V2 already exists in code and is treated as the first control screen for the dispatcher line. Before deeper visual polish, attach or confirm the current Cloud Design render/frame used as the visual reference.

### Related shell files

```text
public/index.html
public/src/app.js
public/src/router.js
public/styles/cloud.css
```

### Data contract

Feed V2 consumes `listFeedPosts()` from `public/src/mock_api.js`.

Expected post types:

```text
system
trip
announcement
marketplace
```

Expected trip variants:

```text
driver trip: type = trip, passenger != true
passenger request: type = trip, passenger = true
```

### UI states

```text
all posts
trip posts
passenger trip requests
announcement posts
marketplace posts
empty filtered state
```

### User actions

```text
select category chip
open create publication from the topbar plus button
open create publication from the global FAB on /feed only
use card CTAs: Откликнуться / Написать водителю
view like/comment/share placeholder actions
```

### Acceptance checklist

- [ ] `/feed` opens through the hash router.
- [ ] Bottom navigation highlights `Лента` on `/feed`.
- [ ] Category chips switch without a page reload.
- [ ] `Всё` shows all Feed V2 post types.
- [ ] `Поездки` shows driver trip cards.
- [ ] `Попутчики` shows passenger trip request cards.
- [ ] `Объявления` shows announcement cards.
- [ ] `Маркет` shows marketplace cards.
- [ ] Empty filtered state renders correctly.
- [ ] Topbar plus button opens `/new`.
- [ ] Global FAB is visible only on `/feed`.
- [ ] No inline `<script>` or `<style>` is introduced.
- [ ] CSP is not weakened.
- [ ] `node scripts/check.mjs` passes before PR merge.

### Out of scope for BD-FEED-01

```text
Mapbox integration
backend API
Android / APK
Service Worker changes
prototype replacement as public/index.html
major refactor outside Feed V2 audit
```

## Planned minimum screens

These screens are tracked by #19 and should receive their own render/frame and contract before implementation:

```text
BD-COMPOSER-01 — Composer V2
BD-PROFILE-01 — Profile V2
BD-MAP-01 — MapHome foundation
BD-MAP-02 — LocationPermission
BD-MAP-03 — RoutePicker
BD-MAP-04 — RoutePreview
BD-MAP-05 — OrderMapDraft
BD-DRIVER-01 — DriverMap
BD-RIDE-01 — ActiveRide
```
