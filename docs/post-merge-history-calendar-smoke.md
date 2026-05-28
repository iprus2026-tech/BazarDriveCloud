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
