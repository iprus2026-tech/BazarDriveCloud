---
id: BD-DOCS-043
docType: runbook
title: Backend staging container baseline — Runbook
owner: backend-ops-agent
status: draft
revision: 2026-07-24
effectiveFrom: 2026-07-24
reviewAfter: 2026-08-24
visibleFor: [developer, dispatcher, qa]
sourceOfTruth: docs-site
related:
  routes:
    - /api/v1/health
    - /api/v1/readyz
  files:
    - server/Dockerfile
    - server/docker-compose.yml
    - server/.env.example
    - .github/workflows/server-ci.yml
  issues:
    - "#823"
  prs: []
tags: [runbook, backend, deployment, staging]
slug: /processes/backend-staging-container-runbook
---

# Backend staging container baseline — Runbook

> **01A contract only.** This runbook records the reproducible container, CI smoke,
> configuration boundary and future staging procedure for BD-BACKEND-DEPLOY-01A.
> Staging is not deployed, rollback has not been rehearsed, and PWA/API activation
> remains off. Provider, registry, real deployment, traffic switching and rollback
> rehearsal belong to 01B; Issue #823 remains open after 01A.

## Container build contract

Build context is `server/`. The Dockerfile pins the verified `node:22-slim` image
index digest, installs the committed lockfile with `npm ci --omit=dev`, sets
`NODE_ENV=production`, and runs as `node`.

Only these provenance build arguments are permitted:

| Build argument | Purpose |
|---|---|
| `OCI_SOURCE` | Repository URL for `org.opencontainers.image.source`. |
| `OCI_REVISION` | Exact source commit for `org.opencontainers.image.revision`. |

The image also carries fixed OCI title and description labels. Runtime
configuration, database URLs, session secrets, tokens, OTPs and credentials must
never be supplied as build arguments. CI builds a local image tagged with the
commit SHA and does not publish it.

Before any future 01B deployment, publish once and record the registry-returned
immutable image digest (`name@sha256:...`). Deploy and rollback must use that
digest, never a mutable tag.

## Runtime configuration and secrets

Deliver configuration and secrets at container runtime through the selected 01B
provider's secret/config mechanism. Do not place a real `.env` file in the build
context or image.

| Class | Values |
|---|---|
| Secrets | `DATABASE_URL`, `SESSION_SECRET` |
| Configuration | `HOST`, `PORT`, `LOG_LEVEL`, `ALLOWED_ORIGIN`, `OTP_TTL_SECONDS`, `OTP_LENGTH`, `OTP_MAX_ATTEMPTS`, `SESSION_TTL_SECONDS` |
| Mandatory staging policy | `NODE_ENV=production`, `OTP_DEV_MODE=false` |

`ALLOWED_ORIGIN` must be the single exact PWA origin and never a wildcard.
Production startup rejects `OTP_DEV_MODE=true`. Dark Redis/S3 settings stay out of
this deployment slice.

## Probe contract

- `GET /api/v1/health` is liveness. It is DB-free and must return HTTP 200 with
  `{ "status": "ok", "service": "@bazardrive/server" }`.
- `GET /api/v1/readyz` is readiness, not liveness. It checks PostgreSQL
  connectivity and required migration state; failure returns HTTP 503.

The image and Compose healthchecks use Node to call `/api/v1/health`; they do not
require `curl` and do not use `/readyz`.

## Future 01B staging procedure

This is the required order once provider and registry decisions exist:

1. Provision PostgreSQL 16 with credentials delivered outside the repository.
2. Publish the reviewed image and record its immutable registry digest.
3. Run the ordered migrations as a one-shot job against PostgreSQL.
4. Start the API by immutable image digest with the runtime policy above.
5. Confirm `/api/v1/health` returns HTTP 200.
6. Confirm `/api/v1/readyz` returns HTTP 200 and reports the database up.
7. Only after both gates pass, allow staging traffic.

Migration failure or non-200 readiness means **no traffic switch**. Do not treat a
healthy liveness response as permission to receive traffic.

## Rollback / recovery

01B must record the previously deployed immutable image digest before rollout. If
the new application fails after deployment, switch the application back to that
previous digest, retain the database, and re-run `/health` followed by `/readyz`
before restoring traffic. Database rollback is not implied: every migration needs
an explicit compatibility/recovery decision before 01B executes it.

Rollback is documented here but **not yet rehearsed**. Staging is **not yet
deployed**. Those acceptance proofs remain open under Issue #823 / 01B.

## Current verification boundary

`server-ci` builds the image without publishing it, checks OCI provenance and
non-root execution, rejects secret-like build artifacts, starts the API against an
intentionally unavailable test database, proves DB-free `/health`, and proves
`/readyz` remains a failing readiness gate rather than liveness.

No 01A step changes the PWA, CSP, service worker, API traffic, provider resources
or production/staging infrastructure.
