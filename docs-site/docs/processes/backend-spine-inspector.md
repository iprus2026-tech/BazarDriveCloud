---
id: BD-DOCS-042
docType: process
title: Mini Yonder Backend Spine docs build integration
owner: docs-contract-agent
status: current
revision: 2026-07-24
effectiveFrom: 2026-06-19
reviewAfter: 2026-12-19
visibleFor: [developer, dispatcher, product, qa]
sourceOfTruth: docs-site
related:
  routes: []
  files:
    - "docs-site/docs/processes/backend-spine-inspector.md"
    - "docs-site/static/img/mini-yonder-backend-spine.svg"
    - "docs-site/sidebars.js"
    - "docs-site/package.json"
    - "docs/screen-contracts.md"
    - "server/README.md"
  issues:
    - 820
    - 821
  prs: []
tags: [process, mini-yonder, backend, database, docs-site]
slug: /processes/mini-yonder-backend-spine
---

# Mini Yonder Backend Spine docs build integration

This page is the governed current-state baseline for the BazarDrive Phase-1 backend and the Mini Yonder Backend Spine & DB Inspector. It records what is live, dark, or pilot-blocked, while keeping this change docs-only.

![Mini Yonder Backend Spine and DB Inspector](/img/mini-yonder-backend-spine.svg)

_Historical concept mock: labels inside this image predate the implemented server and are not current runtime status. The governed matrix below is the current-state source of truth._

## Status vocabulary

| Status | Meaning |
|---|---|
| **LIVE** | The route is registered and implemented. It uses the database where the route contract requires I/O; operational liveness may intentionally perform no I/O. This does not mean the PWA is fully cut over or the feature is production-ready. |
| **DARK** | The route/module seam exists but intentionally returns `501 NOT_IMPLEMENTED`, or its infrastructure adapter is not active. |
| **PILOT-BLOCKED** | The implementation exists, but a documented identity, authorization, delivery, operational, or activation gap prevents pilot use. |

## Live baseline — 24 July 2026

| Module / route | State | Auth and role boundary | Database writes / reads | PWA consumer or activation seam | Verification owner |
|---|---|---|---|---|---|
| `GET /api/v1/health` | LIVE | Operational endpoint; no user session | No product tables; no I/O | Deployment liveness probe only | health route smoke |
| `GET /api/v1/readyz` | LIVE | Operational endpoint; no user session | Reads PostgreSQL connectivity and migration state | Deployment readiness probe only | readiness + migration CI |
| `GET /api/v1/auth/session` | LIVE / PILOT-BLOCKED | Resolves an optional bearer session; expiry/revocation policy remains a pilot gate | Reads `auth_session` only; the session row mirrors identity and verification fields, with no `users` join | `api_client.getSession()`; API base remains guarded/off by default | auth route/repository tests |
| `POST /api/v1/auth/otp/request` | LIVE / PILOT-BLOCKED | Public request; unthrottled and without a production delivery provider | Writes hashed codes to `auth_otp` | guarded auth cutover; dev response may include `devCode` only in dev mode | OTP request tests + auth hardening issue owner |
| `POST /api/v1/auth/otp/verify` | LIVE / PILOT-BLOCKED | Public verification; attempt cap enforced; final session lifecycle remains a pilot gate | Reads the latest live `auth_otp` and commits its attempt increment before the success transaction. On a correct code, one transaction consumes the OTP, upserts/verifies `users` and inserts `auth_session`; the separate attempt count therefore persists on failed verification | guarded auth/token cutover | OTP concurrency + session tests |
| `GET /api/v1/orders` | LIVE | Public created-order read; optional viewer session only affects ownership projection | Reads `orders` | guarded `mock_api.listFeedPosts()` seam; API base off by default | orders route + API client smoke |
| `POST /api/v1/orders` | LIVE / PILOT-BLOCKED | Requires a live authenticated session; `phone_verified` and passenger-role enforcement remain pilot gates | Writes `orders` | guarded order-create seam; local fallback remains active while API base is off | orders route/validation tests |
| `POST /api/v1/matching/offers` | LIVE / PILOT-BLOCKED | Requires a live authenticated session and blocks self-offers; `phone_verified`, granted driver role and readiness are not enforced yet | Locks `orders`; upserts `offers` transactionally | guarded driver-offer seam | matching transaction/concurrency tests |
| `GET /api/v1/matching/offers?orderId=…` | LIVE | Authenticated order owner only | Reads `orders`, `offers` | guarded passenger responses seam | matching ownership tests |
| `POST /api/v1/matching/select` | LIVE / PILOT-BLOCKED | Authenticated order owner only; rejects self-selection | Locks/writes `orders`, `offers`, `assignment`, `rides` in one transaction | guarded select/handoff seam | matching race + ride-bootstrap tests |
| `GET /api/v1/ride-state/rides/:tripId` | LIVE | Authenticated ride participant only | Reads `rides` | guarded active-ride read seam | ride participant tests + enum parity |
| `PATCH /api/v1/ride-state/rides/:tripId/status` | LIVE | Authenticated ride participant only | Locks/updates `rides`; appends `ride_events` in one transaction | guarded active-ride write seam | terminal-freeze/idempotency + enum parity tests |
| `GET /api/v1/realtime/poll?tripId=…&since=…` | LIVE (polling) | Authenticated ride participant only | Reads `rides`, cursor-ordered `ride_events` | guarded self-clearing poll seam; WebSocket/SSE push remains dark | realtime cursor/participant tests + client smoke |
| `GET /api/v1/history` | LIVE | Authenticated viewer; query is scoped to viewer identity | Reads `ride_history` view | guarded history seam; local history fallback remains while API base is off | history viewer-scope tests |
| `POST /api/v1/history/receipts` | LIVE | Authenticated ride driver only; completed ride only; write-once | Reads `rides`; inserts/reads `receipts` | guarded receipt seam | completed/driver/write-once tests |
| `GET /api/v1/chat/messages?chatId=…` | LIVE persistence / PILOT-BLOCKED | No authenticated participant check | Reads `messages` | guarded chat seam must stay off for pilot until authorization lands | chat route tests + chat-auth issue owner |
| `POST /api/v1/chat/messages` | LIVE persistence / PILOT-BLOCKED | No authenticated participant check; `senderRole` is request-supplied | Inserts/deduplicates `messages` | guarded chat seam must stay off for pilot until authorization lands | chat idempotency tests + chat-auth issue owner |
| `ALL /api/v1/availability/*` | DARK | No pilot contract | None; catch-all returns `501 NOT_IMPLEMENTED` | no activation | future availability track (outside #820 pilot) |
| `ALL /api/v1/route-price/*` | DARK | No pilot contract | None; catch-all returns `501 NOT_IMPLEMENTED` | no activation | future route-price track (outside #820 pilot) |
| `ALL /api/v1/notifications/*` | DARK | No pilot contract | None; catch-all returns `501 NOT_IMPLEMENTED` | no activation | future notifications track (outside #820 pilot) |
| `ALL /api/v1/safety/*` | DARK | No pilot contract | None; catch-all returns `501 NOT_IMPLEMENTED` | no activation | future safety track (outside #820 pilot) |
| `GET /metrics` | DARK | Operational policy not frozen | None; returns `501 NOT_IMPLEMENTED` | no activation | observability follow-up |

## Authority and invariants

- PostgreSQL and the server domain layer own order, offer, assignment and ride status after a feature is activated.
- Matching selection is one transaction: lock the open order, accept one offer, reject competing offers, create the assignment, accept the order and bootstrap the ride.
- Terminal ride states `CANCELED`, `NO_SHOW` and `COMPLETED` cannot transition to a different state; saving the same terminal state is idempotent.
- `ride_events` is append-only. Polling advances by cursor and must not mutate history.
- Driver receipts are created only for completed rides and are write-once.
- PWA calls remain guarded. A live server route is not permission to activate a client cutover before its pilot blocker is closed.
- The service worker must continue to bypass `/api`; API responses are never an offline cache source.

## Pilot blockers and delivery slices

| Slice | Depends on | Exit condition |
|---|---|---|
| **BD-BACKEND-BASELINE-01** (#821) | Epic #820 | Live/dark matrix, ownership, envelopes, checks and docs are reconciled. |
| **BD-BACKEND-DEPLOY-01** (#823) | Baseline | Staging API/PostgreSQL 16 deploy and rollback are reproducible. |
| **BD-AUTH-HARDEN-01** (#824) | Baseline + staging | OTP delivery, per-phone/IP throttling and no-code-echo policy are tested. |
| **BD-AUTH-SESSION-01** (#829) | Auth hardening | Session transport, expiry, rotation and revocation are frozen and tested. |
| **BD-AUTH-POLICY-01** (#830) | Session lifecycle | Granted roles and minimum driver readiness are server-enforced. |
| **BD-CHAT-AUTH-01** (#825) | Session + role policy | Sender identity is session-derived and limited to order/ride participants. |
| **BD-API-IDEMPOTENCY-01** (#826) | Frozen endpoint contracts | Mutation retries and concurrency preserve exactly-once/write-once invariants. |
| **BD-E2E-MULTIDEVICE-01** (#831) | Auth, policy, chat and idempotency | Two sessions complete the PostgreSQL 16 vertical slice. |
| **BD-OBS-PILOT-01** (#827) | Staging + vertical slice | Redacted logs, metrics, alerts, backup/restore and rollback are rehearsed. |
| **BD-BACKEND-ACTIVATE-01** (#828) | All prior gates | Staging activates first; production pilot is allow-listed and reversible. |

## Pilot envelopes and error codes

The pilot contract preserves each endpoint's current success body; introducing a global success wrapper requires a versioned contract change. Product-route errors cross the API boundary as a stable JSON object:

```json
{
  "error": "Human-readable summary",
  "code": "STABLE_MACHINE_CODE",
  "retryable": false
}
```

Operational exception: `GET /api/v1/readyz` does not use the product problem object. A failed readiness check returns HTTP 503 as `{ status: 'degraded', db: 'down' | 'schema-incomplete' }`; success is `{ status: 'ready', db: 'up' }`. Neither envelope includes `error`, `code` or `retryable`.

The route-owned machine-code inventory below is descriptive of the existing routes. The server fallback also preserves Fastify `err.code` for non-validation 4xx failures, so those framework codes are an explicit part of the current boundary. Changing or normalizing a code requires an explicit contract update rather than a silent PWA translation:

| Boundary | Current success envelope(s) | Current machine codes |
|---|---|---|
| Operational health/readiness | `{ status, service }`, `{ status, db }` (including readiness HTTP 503) | None; `/readyz` failure intentionally bypasses the product problem object |
| Auth/session | `{ user }`, `{ ok, expiresInSeconds, devCode? }`, `{ token, user }` | `SESSION_LOOKUP_FAILED`, `INVALID_PHONE`, `OTP_INVALID`, `OTP_LOCKED`, plus uniform `VALIDATION` |
| Orders | `{ items }`, `{ order }` | `SESSION_LOOKUP_FAILED`, `UNAUTHENTICATED`, plus uniform `VALIDATION` |
| Matching/offers/select | `{ offer }`, `{ items }`, `{ order, offer, assignment, ride }` | `SESSION_LOOKUP_FAILED`, `UNAUTHENTICATED`, `ORDER_NOT_FOUND`, `CANNOT_OFFER_OWN_ORDER`, `ORDER_NOT_OPEN`, `FORBIDDEN`, `CANNOT_SELECT_SELF`, `OFFER_NOT_FOUND`, plus uniform `VALIDATION` |
| Ride state | `{ ride }` | `SESSION_LOOKUP_FAILED`, `UNAUTHENTICATED`, `RIDE_NOT_FOUND`, `FORBIDDEN`, `INVALID_STATUS`, `RIDE_TERMINAL`, plus uniform `VALIDATION` |
| Realtime poll | `{ tripId, status, events, cursor }` | `SESSION_LOOKUP_FAILED`, `UNAUTHENTICATED`, `RIDE_NOT_FOUND`, `FORBIDDEN`, `VALIDATION` |
| Chat | `{ items }`, `{ message }` | `INTERNAL`, plus uniform `VALIDATION`; authentication/participant errors do not exist yet and are a pilot blocker |
| History/receipts | `{ items }`, `{ receipt }` | `SESSION_LOOKUP_FAILED`, `UNAUTHENTICATED`, `RIDE_NOT_FOUND`, `FORBIDDEN`, `RIDE_NOT_COMPLETED`, plus uniform `VALIDATION` |
| Dark routes | problem object | `NOT_IMPLEMENTED` |
| Uniform server fallback | problem object | `VALIDATION`, `NOT_FOUND`, `INTERNAL`, `BAD_REQUEST`; other non-validation 4xx preserve Fastify `err.code`, including `FST_ERR_CTP_EMPTY_JSON_BODY` and `FST_ERR_CTP_INVALID_JSON_BODY` |
| Client-only transport | n/a | `BACKEND_DISABLED`, `NETWORK`, `ABORTED`, `HTTP_<status>`, `UNKNOWN` |

A route that currently emits a different code is a baseline mismatch to resolve in its implementation slice, not a reason to silently translate errors in the PWA.

## Purpose of Mini Yonder Backend Spine

Mini Yonder Backend Spine answers one question:

```text
Where is a feature broken across the data chain?

screen → frontend state → API contract → service rule → database table → migration → check → issue
```

It should make backend and database gaps visible before a UI screen grows into a polished but unsafe mock.

## Feature screens

| Screen | Purpose | First data source |
|---|---|---|
| Backend Spine | Module map for Auth, Profiles, Orders, Responses, Rides, Chat, Media, Notifications and Reports. | Static catalog |
| Data Trace | One selected screen traced through state, API, database, smoke and issue. | Screen contract + catalog |
| API Contracts | Endpoint cards with auth, role guard, transaction and DB writes. | API catalog |
| DB Schema | Tables, relations, migrations and missing constraints. | DB catalog |
| Contract Diff | Frontend/API/DB mismatch detector. | Contract catalogs |
| Issue Generator | Generates a scoped backend prompt/issue from detected gaps. | Diff findings |

## Build integration

This slice updates governed docs, not runtime:

```text
docs-site/docs/processes/backend-spine-inspector.md
server/README.md
```

The page must remain governed by the Mini Yonder frontmatter passport and visible from `sidebars.js`. Required repository checks are:

```bash
cd docs-site && npm run check
node scripts/check.mjs
node scripts/dispatcher.mjs
```

## Runtime boundaries

This docs baseline must not touch:

- `public/` runtime PWA files;
- `public/sw.js` or service worker cache lists;
- CSP in `public/index.html`;
- Mapbox loaders, adapters or token policy;
- backend server code;
- database migrations.

The Inspector remains a docs/catalog feature. The server baseline above describes existing runtime; it does not activate or modify it.

## Future catalog shape

A future catalog slice may introduce machine-readable files such as:

```text
public/src/yonder/backend_catalog.js
public/src/yonder/api_catalog.js
public/src/yonder/db_catalog.js
public/src/yonder/contract_diff.js
```

The docs-site equivalent can later mirror those catalogs under `docs-site/governance/` if Mini Yonder needs to validate them as governed docs data.

## Backend contract fields for screen contracts

Each critical screen contract should include:

```text
Backend contract:
- API endpoints
- DB tables
- DTO input
- DTO output
- auth guard
- role guard
- status authority
- transaction required
- migration needed
- smoke needed
```

## Detection rules

Mini Yonder Backend Spine should flag:

1. screen status is missing from the backend enum;
2. critical status can be changed from frontend only;
3. endpoint is live but has no required role guard;
4. endpoint writes several tables but has no transaction requirement;
5. route coordinates exist in UI but have no DB fields;
6. passenger and driver snapshots share a mutable object;
7. ride history mirrors between roles;
8. chat is not authorized against its order or ride;
9. migration exists without smoke coverage;
10. smoke exists but does not pin the authority boundary;
11. a PWA cutover is active while its backend module is dark or pilot-blocked.

## Working issue

This baseline is delivered by **BD-BACKEND-BASELINE-01 (#821)** under **Epic #820**.

In scope:

- reconcile the server README, Backend Spine and data-layer documentation;
- record live, dark and pilot-blocked modules;
- pin auth/role authority, DB ownership, PWA seams and test ownership;
- freeze pilot envelope/error-code expectations;
- leave runtime and migrations unchanged.

## Acceptance checklist

- [x] Current-state matrix names each module as live, dark or pilot-blocked.
- [x] Auth/role guard, DB ownership, PWA seam and verification owner are recorded.
- [x] Pilot envelope and error-code policy is explicit.
- [x] Runtime PWA, backend code, migrations, service worker, CSP and Mapbox are out of scope.
- [ ] `cd docs-site && npm run check` passes.
- [ ] `node scripts/check.mjs` passes.
- [ ] `node scripts/dispatcher.mjs` passes.
