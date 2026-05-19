# Dispatcher status after BD-MAP-01

Date: 2026-05-19

This document freezes the current dispatcher line after the MapHome foundation work. It is intentionally docs-only and does not authorize new implementation work.

## Completed line

```text
BD-MAP-01 MapHome foundation render gate      ✅ completed
BD-MAP-01 MapHome foundation implementation  ✅ completed
BD-MAP-01 post-merge audit                   ✅ completed
```

References:

```text
#140 — BD-MAP-01 MapHome foundation render gate and contract
#141 — BD-MAP-01 MapHome foundation implementation, no SDK
#142 — implementation PR, merged
#143 — post-merge audit PR, merged
```

## Current product state

`/map` exists as a standalone MapHome foundation screen.

It provides the safe map placeholder and five render-gate states:

```text
default / no route
location permission needed
location denied fallback
nearby orders placeholder
Mapbox token missing fallback
```

The implementation remains bounded:

```text
no real Mapbox SDK
no Mapbox token
no external Mapbox domains
no backend/API
no CSP weakening
no active ride changes
```

## Current blocker

The next product screen is blocked by Cloud Design usage limits until May 23.

```text
Blocked issue:
#144 — BD-MAP-03 RoutePicker render gate — blocked by Cloud Design limit
```

Rule:

```text
Do not implement /route-picker before a Cloud Design render gate exists.
```

## Next design step after reset

When the Cloud Design limit resets, resume with:

```text
BD-MAP-03 RoutePicker — Render Gate
Route: /route-picker
```

Required design states:

```text
1. Empty pickup/dropoff
2. Pickup selected
3. Dropoff selected
4. Search results
5. Manual address fallback
6. Route draft ready
```

## Allowed work while blocked

Until the RoutePicker render gate exists, allowed work is limited to repo hygiene and docs-only maintenance:

```text
issue triage
labels / milestones
tracking status updates
backlog audit
contract inventory
no new route-picker code
```

## Recommended next queue

```text
1. BD-MAP-03 RoutePicker render gate
2. BD-MAP-04 RoutePreview render gate
3. BD-MAP-05 OrderMapDraft render gate
4. BD-MAP-FOUND-01 real Mapbox integration foundation, later only after contracts
```

## Stop line

Do not cross this line before May 23 or before a verified Cloud Design frame exists:

```text
No /route-picker implementation.
No Mapbox SDK.
No CSP changes.
No backend map API.
No active ride changes.
```
