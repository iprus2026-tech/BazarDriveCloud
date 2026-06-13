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

- Designed / ready gates: 29
- Missing gates: 5
- Partial gates: 2
- Audit / consolidation gates: 3
- Legacy: 1

> **Codex P2 review follow-up (PR #495):** the previous draft counted BD-HISTORY-P-01, BD-COMPOSER-01 state expansion, and BD-GARAGE-01 as Missing / Partial backlog items. These three are already shipped in the production app and are now classified as **audit / consolidation gates** — opening them only after a confirmed gap audit, not as a from-scratch build.

> **Codex P2 follow-up — no-show flow:** BD-RIDE-D-NOSHOW-01 is partial, not done. The driver route renders only the terminal NO_SHOW / canceled stub today (`docs/design-registry.json`); the full no-show flow (reason / confirm / compensation / support / loading / error) remains a future dedicated issue per `docs/screen-contracts.md` and is out of scope for this artifact PR.

## Missing gates

See `docs/missing-screens.md` for the implementation backlog.

Primary missing gates (5):

1. `BD-AUTH-01` — Phone / SMS verification
2. `BD-SETTINGS-01` — Settings
3. `BD-NOTIF-01` — Notifications
4. `BD-ERROR-01` — Global error / offline
5. `BD-MOD-01` — Moderation / Report

## Audit / consolidation gates

These are NOT missing — the underlying surface ships in production. The audit gate is opened only for parity / dedicated-route / consolidation work, after a confirmed gap audit:

1. `BD-HISTORY-P-01` — passenger trip history already renders in `/profile` and via `saveRideHistoryEntry`; audit scope = dedicated `/history` route, loading, detail parity.
2. `BD-COMPOSER-01` state expansion — composer route `/new` already ships per-type / preview / draft-saved / validation / submit-loading states (`public/src/screens/composer.js`); audit scope = parity check, no rebuild.
3. `BD-GARAGE-01` — driver Garage gate already renders in `/profile?role=driver`; audit scope = consolidation of the active garage PR line (BD-PROFILE-D-05F+, BD-PROFILE-GARAGE-*), not a new screen.

## Handoff table

See `docs/screen-transitions.md` for the developer handoff table:

`Screen ID | Route | File | Role | Status | States changed | Primary action | Next screen`

## Recommended implementation order

Genuine missing-screen backlog first; audit gates are opened only on confirmed scope, not by default.

1. `BD-ERROR-01` — global offline/error overlay (P1).
2. `BD-RIDE-D` error/offline states (P1 extension).
3. `BD-AUTH-01` — UI-only phone verification contract (P2).
4. `BD-SETTINGS-01` (P2).
5. `BD-NOTIF-01` (P2).
6. `BD-MOD-01` (P2).

Audit / consolidation gates (open only on confirmed gap, not by default):

- `BD-HISTORY-P-01` — dedicated `/history` route + loading/detail parity, if confirmed.
- `BD-COMPOSER-01` — parity audit of shipped per-type / preview / draft-saved / validation / submit-loading states.
- `BD-GARAGE-01` — consolidation of the existing garage PR line.

## Notes for production implementation

- Treat file names ending in `.jsx` inside the HTML map as Cloud Web / React-Vite sandbox component names unless the production app has explicitly adopted them.
- Do not infer that the map authorizes React/Vite migration.
- Do not use the standalone HTML as the app shell.
- Convert individual gates into small PRs with screen contracts and smoke coverage.
