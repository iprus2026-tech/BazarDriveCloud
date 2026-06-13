# BD-FULL-FLOW-01 · Product Navigation Map

This document registers **BD-FULL-FLOW-01 Product Navigation Map** as a Cloud Design navigation artifact for BazarDrive.

## Artifact

- HTML reference: `public/prototypes/BD-FULL-FLOW-01 Product Navigation Map.html`
- Type: design/reference artifact
- Scope: product navigation map, screen inventory, handoff table, missing screen gates, implementation order
- Runtime status: **not production app shell**

The HTML artifact is intentionally stored under `public/prototypes/` and must not replace the production PWA shell.

## Safety boundary

This artifact does **not** change:

- `public/index.html`
- service worker behavior
- CSP
- React/Vite migration
- Mapbox
- backend/API
- auth implementation
- payment/push integrations

The React/Vite sandbox created during the Cloud Web export experiment lives outside this PR and is not part of this artifact.

## Lanes

The map is organized into four lanes:

| Lane | Purpose |
|---|---|
| Guest / Entry | Welcome, role selection, permissions, phone/SMS verification gap |
| Passenger | Map, route picker, order creation, driver selection, active ride, cancel/safety, completion, profile |
| Driver | Driver readiness, driver map, confirmation handoff, active ride, cancel/problem/no-show, earnings, history, dashboard |
| Shared | Feed, composer, respond, order detail, chat, rules, settings/notifications/error/moderation gaps |

## Inventory summary

- Designed / ready gates: 27
- Missing gates: 7
- Partial gates: 2
- Legacy: 1

## Missing gates

See `docs/missing-screens.md` for the implementation backlog.

Primary missing gates:

1. `BD-AUTH-01` — Phone / SMS verification
2. `BD-HISTORY-P-01` — Passenger trip history
3. `BD-GARAGE-01` — Driver Garage consolidation gate
4. `BD-SETTINGS-01` — Settings
5. `BD-NOTIF-01` — Notifications
6. `BD-ERROR-01` — Global error / offline
7. `BD-MOD-01` — Moderation / Report

## Handoff table

See `docs/screen-transitions.md` for the developer handoff table:

`Screen ID | Route | File | Role | Status | States changed | Primary action | Next screen`

## Recommended implementation order

1. `BD-HISTORY-P-01` — passenger trip history / receipt symmetry.
2. `BD-GARAGE-01` — garage consolidation/audit gate, if not already covered by the current garage PR series.
3. `BD-ERROR-01` — global offline/error overlay.
4. `BD-COMPOSER-01` state expansion — per-type variants, preview, draft-saved.
5. `BD-RIDE-D` error/offline states.
6. `BD-AUTH-01` — UI-only phone verification contract.
7. `BD-SETTINGS-01`.
8. `BD-NOTIF-01`.
9. `BD-MOD-01`.

## Notes for production implementation

- Treat file names ending in `.jsx` inside the HTML map as Cloud Web / React-Vite sandbox component names unless the production app has explicitly adopted them.
- Do not infer that the map authorizes React/Vite migration.
- Do not use the standalone HTML as the app shell.
- Convert individual gates into small PRs with screen contracts and smoke coverage.
