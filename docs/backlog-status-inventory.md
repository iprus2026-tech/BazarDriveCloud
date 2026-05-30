# Backlog status inventory

Date: 2026-05-19
Scope: docs-only inventory of backlog and status after merge of PR #145
(`docs: dispatcher status`). No application code touched.

This document freezes the current backlog line so the dispatcher can do
repo hygiene while Cloud Design is paused until 2026-05-23.

## Status legend

```text
completed   — implemented and merged into main
audited     — post-merge audit doc exists, no regressions
blocked     — cannot start until an external gate is lifted
planned     — next in queue, awaiting render gate
deferred    — covered by another screen or postponed without owner
```

## Screens and tasks

| Code | Title | Route / artifact | Status | Notes |
|---|---|---|---|---|
| BD-MAP-01 (render gate) | MapHome render gate and contract | `/map` render gate | completed | Issue #140 |
| BD-MAP-01 (implementation) | MapHome foundation, no SDK | `public/src/screens/map.js` | completed | PR #142 |
| BD-MAP-01 (post-merge audit) | MapHome post-merge audit | `docs/bd-map-01-audit.md` | audited | PR #143 |
| Dispatcher status | Dispatcher status after BD-MAP-01 | `docs/dispatcher-status.md` | completed | PR #145 |
| BD-MAP-02 | LocationPermission standalone screen | n/a | deferred | Covered by BD-MAP-01 `permission` + `denied` substates |
| BD-MAP-03 | RoutePicker render gate | `/route-picker` | blocked | Blocked by Cloud Design limit reset on 2026-05-23 (issue #144) |
| BD-MAP-04 | RoutePreview render gate | `/route-preview` | done | Merged in #214; closeout for #213 |
| BD-MAP-05 | OrderMapDraft render gate | `/order-map-draft` | planned | After BD-MAP-04 |
| BD-MAP-FOUND-01 | Real Mapbox SDK foundation | CSP + SW + SDK | planned | Only after BD-MAP-03..05 contracts |
| BD-FEED-01 | Feed V2 | `/feed` | completed | Mock-only, awaiting Cloud Design render confirm |
| BD-COMPOSER-01 | Composer V2 | `/new` | completed | Mock-only |
| BD-ONBOARDING-01 | Onboarding V2 | `/onboarding` | completed | Mock-only |
| BD-PROFILE-01 | Passenger profile | `/profile` | completed | Mock-only |
| BD-PROFILE-02 | Driver profile | `/profile` (driver) | completed | Mock-only |
| BD-RESPOND-01 | Respond | `/respond` | completed | Mock-only |
| BD-RESPONSES-01 | Responses inbox | `/responses` | completed | Mock-only |
| BD-CHAT-01 | Chat per trip / per response | `/chat` | completed | Mock-only |
| BD-CONFIRM-01 | Trip confirmation handoff | `/trip-confirmation` | completed | 5 states |
| BD-RIDE-D-01..06 | Active ride · driver | `/active-ride` | completed | Mock-only |
| BD-RIDE-P-01..05 | Active ride · passenger | `/active-ride?role=passenger` | completed | Mock-only |
| BD-RIDE-P-06 | Passenger cancel sheet | bottom sheet | completed | PR #122 polish |
| BD-RIDE-P-07 | Passenger safety sheet | bottom sheet | completed | PR #120 |
| BD-RIDE-D-07 | Driver cancel sheet | bottom sheet | completed | PR #136 |
| BD-RIDE-D-08 | Driver problem sheet | bottom sheet | completed | PR #136 |
| BD-RIDE-D-09 | Driver earnings sheet | bottom sheet | completed | PR #136, audited PR #137 |
| BD-RIDE-F-01 | Ride state contract | `public/src/ride_state.js` | completed | Single storage |
| BD-RIDE-F-02 | MapShell placeholder | `public/src/mapbox/map_shell.js` | completed | No SDK |
| BD-FLOW-01 | Taxi-flow contract | `docs/flow-contracts.md` | completed | PR #126 |
| Driver sheets offline audit | `driver_sheets.css` × `sw.js` | `docs/offline-first-audit.md` | audited | PR #138, SW v24, precache fix PR #139 |
| Project health audit | Repo health snapshot | `docs/project-health-audit.md` | audited | b6b3cf1 |

## Milestone markers

```text
BD-MAP-01 Render Gate                  ✅
BD-MAP-01 Implementation               ✅
BD-MAP-01 Post-merge audit             ✅
Dispatcher status doc                  ✅
BD-MAP-02 deferred / covered by BD-MAP-01  ✅
BD-MAP-03 blocked until Cloud Design reset 2026-05-23  ✅
```

## Open gaps (already tracked in ROADMAP.md)

```text
BD-MAP-FOUND-STUB-01 — driver_markers, trip_status_layer stubs not yet
                        listed under mapbox/ (the other 7 stubs exist)
Driver no-show flow  — "Не приехал" still shows only a toast
Real backend         — Phase 2, out of scope while Cloud Design paused
```

## Next repo hygiene actions

While BD-MAP-03 is blocked until Cloud Design limit reset on 2026-05-23,
the dispatcher can land docs-only and repo-hygiene work only.

```text
1. Normalize labels
   - confirm a single set of issue labels (type, status, area)
   - drop / merge duplicate or stale labels
   - apply labels to open BD-* issues consistently

2. Create / confirm milestones
   - BD-MAP foundation         (covers BD-MAP-01..05 + BD-MAP-FOUND)
   - Repo hygiene 2026-05      (this iteration)
   - Phase 2 backend           (parking for real-API issues)

3. Update #19 tracking checklist
   - tick BD-MAP-01 render gate, implementation, post-merge audit
   - reflect Dispatcher status doc landing (PR #145)
   - mark BD-MAP-02 as deferred / covered by BD-MAP-01
   - mark BD-MAP-03 as blocked until 2026-05-23
   - link this inventory doc as the current backlog snapshot

4. Close duplicate / stale issues
   - sweep open issues for items already covered by merged PRs
   - close anything superseded by BD-MAP-01 substates
   - leave a one-line pointer to the superseding issue or PR on close

5. Keep Mapbox route work blocked until reset
   - no /route-picker implementation
   - no Mapbox SDK / token / external domains
   - no CSP changes
   - no backend map API
   - no active-ride changes
```

## Stop line

The same hard stop from `docs/dispatcher-status.md` still applies until
2026-05-23 or until a verified Cloud Design frame exists for BD-MAP-03:

```text
No /route-picker implementation.
No Mapbox SDK.
No CSP changes.
No backend map API.
No active ride changes.
```
