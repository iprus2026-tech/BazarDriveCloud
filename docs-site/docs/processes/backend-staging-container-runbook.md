---
id: BD-DOCS-043
docType: runbook
title: Backend staging container baseline — Runbook
owner: backend-ops-agent
status: draft
revision: 2026-08-05
effectiveFrom: 2026-07-24
reviewAfter: 2026-09-05
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
    - infra/staging/README.md
  issues:
    - "#823"
  prs: []
tags: [runbook, backend, deployment, staging]
slug: /processes/backend-staging-container-runbook
---

# Backend staging container baseline — Runbook

> **01A baseline + proposed 01B-1A contract only.** This runbook records the
> reproducible container and CI smoke delivered by BD-BACKEND-DEPLOY-01A plus the
> proposed provider/IaC boundary in
> [BD-DOCS-044](../decisions/backend-staging-provider-and-iac.md). Staging is not
> deployed, rollback has not been rehearsed, and PWA/API activation remains off.
> Issue #823 remains open.

## Proposed technical staging boundary

Subject to approval of every blocking input in BD-DOCS-044, the 01B target is:

| Layer | Proposed contract |
|---|---|
| Provider | Google Cloud technical staging, containing synthetic/non-personal data only. |
| Registry | Artifact Registry; publish once and deploy/rollback by immutable digest. |
| Runtime | Cloud Run with IAM-authenticated access; public unauthenticated staging is forbidden. |
| Database | Cloud SQL for PostgreSQL 16. |
| Secrets | Secret Manager runtime injection; no secret value in Git, image, build args, workflow output or evidence. |
| Migrations | A separate Cloud Run Job using the same immutable digest as the candidate API revision. |
| GitHub identity | OIDC Workload Identity Federation; static service-account JSON keys are forbidden. |
| IaC | OpenTofu under `infra/staging/` in a future slice. Remote state requires separate approval and bootstrap. |

Region, billing owner and monthly budget remain unresolved blocking inputs and
must not be guessed. GCP project strategy (dedicated staging project) and an
intended project ID are now human-approved — see BD-DOCS-044's "Human-approved
staging identity values"; that project ID's real-world availability is still
unvalidated and continues to block provisioning. No GCP resource, credential,
remote state, image publication, deployment or traffic switch exists as a
result of 01B-1A.

### IAM identity separation

Deployment, runtime and migration must use three separate principals/service
accounts; combining or reusing an identity across these roles and mutual
impersonation are forbidden. `Owner`, `Editor` and equivalently broad roles are
forbidden. Permissions must be minimal and preferably scoped to exact staging
resources; the exact bindings remain a future IaC blocker.

- The **deployment identity** is used by GitHub Actions only through OIDC/WIF. It
  may publish/deploy approved staging resources. Any
  `serviceAccounts.actAs` permission is limited to the exact runtime and
  migration identities. It has no runtime database or application-secret access.
- The **runtime identity** is used only by the Cloud Run service. It receives only
  necessary runtime secrets, Cloud SQL connection and observability permissions;
  it cannot deploy, publish images, run migrations, change IAM or impersonate.
- The **migration identity** is used only by the separate Cloud Run migration
  Job. It receives only migration-specific database/secret permissions; it cannot
  serve traffic, deploy, change IAM or impersonate.

### Secret-value boundary

Secret values are forbidden in Git/source, OpenTofu configuration, `.tfvars`,
environment files, OpenTofu state/state backups, saved plans, plan/console output,
documentation, workflow/build/deployment/runtime logs, image layers, build args,
CI/CD outputs, artifacts, evidence and support/debug exports.

OpenTofu may manage only Secret Manager metadata, empty secret containers and IAM
bindings. It must not create or transmit secret payloads or versions. Marking a
value `sensitive` does not prevent storage in state. Values require a separately
approved out-of-state channel that does not retain them in shell history, logs,
artifacts or evidence. Its bootstrap/rotation procedure remains a blocker and is
not implemented.

### Data-location guard

GCP staging permits only synthetic, non-personal data across HTTP/API requests
and bodies, database contents, caches, logs, traces, metrics/telemetry,
object-storage artifacts, backups/snapshots, database restores, support/debug
dumps, CI/deployment artifacts, operational evidence and exports.

Real passenger, driver, order, offer, assignment, ride, route/location,
identity/document, compliance/safety, payment, receipt, credential or session
data is forbidden. Production exports/restores, replayed production requests or
logs, and production-derived personal data as fixtures are forbidden. Fixtures
must have no reversible mapping to real people or production records.

Discovery of real or production-derived data requires stopping the affected
check/environment, restricting further access, and removing it through a
separately approved incident procedure. Record the incident without copying
sensitive values into evidence.

Production data residency and the localization/processing of Russian personal
data require a separate legal, security and architecture decision. This technical
staging contract does not select or approve a production region.

### Access, CORS and activation

Staging invocation remains IAM-authenticated. `allUsers`,
`--allow-unauthenticated` and equivalent public access are forbidden. CORS must
use one explicitly approved exact origin and never `*` — see BD-DOCS-044's
"Human-approved staging identity values" for the approved value.

Cloud Run revision traffic is not PWA/API activation. No client API base, CSP,
service worker, GitHub Pages or other `public/**` change belongs to 01B. Activation
remains a separate gate under Issue #828.

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

Deliver configuration and secrets at container runtime through the approved
out-of-state Secret Manager channel and Cloud Run configuration. Do not place a
real `.env` file in the build context or image.

| Class | Values |
|---|---|
| Secrets | `DATABASE_URL`, `SESSION_SECRET` |
| Configuration | `HOST`, `PORT`, `LOG_LEVEL`, `ALLOWED_ORIGIN`, `OTP_TTL_SECONDS`, `OTP_LENGTH`, `OTP_MAX_ATTEMPTS`, `SESSION_TTL_SECONDS` |
| Mandatory staging policy | `NODE_ENV=production`, `OTP_DEV_MODE=false` |

`ALLOWED_ORIGIN` must be the single exact PWA origin and never a wildcard — the
approved exact value is recorded in BD-DOCS-044's "Human-approved staging
identity values." Production startup rejects `OTP_DEV_MODE=true`. Dark Redis/S3 settings stay out of
this deployment slice.

## Probe contract

- `GET /api/v1/health` is liveness. It is DB-free and must return HTTP 200 with
  `{ "status": "ok", "service": "@bazardrive/server" }`.
- `GET /api/v1/readyz` is readiness, not liveness. It checks PostgreSQL
  connectivity and required migration state; failure returns HTTP 503.

The image and Compose healthchecks use Node to call `/api/v1/health`; they do not
require `curl` and do not use `/readyz`.

## Future 01B staging procedure

This is the required order only after the proposed ADR is accepted, all blocking
inputs are supplied, reviewed OpenTofu exists and resource creation/deployment is
separately authorized:

1. Provision PostgreSQL 16 with credentials delivered outside the repository.
2. Publish the reviewed image and record its immutable registry digest.
3. Run the ordered migrations as a one-shot job against PostgreSQL.
4. Start the API by immutable image digest with the runtime policy above.
5. Confirm `/api/v1/health` returns HTTP 200.
6. Confirm `/api/v1/readyz` returns HTTP 200 and reports the database up.
7. Only after both gates pass, explicitly switch Cloud Run revision traffic.

Migration failure or non-200 readiness means **no traffic switch**. Do not treat a
healthy liveness response as permission to receive traffic.

The switch above routes the IAM-authenticated staging service between Cloud Run
revisions. It does not make staging public and does not activate the PWA.

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

No 01A or 01B-1A step changes the PWA, CSP, service worker, API traffic, provider
resources or production/staging infrastructure.
