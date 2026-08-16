---
id: BD-DOCS-043
docType: runbook
title: Backend staging container baseline — Runbook
owner: backend-ops-agent
status: draft
revision: 2026-08-16
effectiveFrom: 2026-07-24
reviewAfter: 2026-09-16
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
    - "#894"
  prs: []
tags: [runbook, backend, deployment, staging]
slug: /processes/backend-staging-container-runbook
---

# Backend staging container baseline — Runbook

> **Post-v0.4.0 contract; staging is not deployed.** The reproducible local
> container and `server-ci` smoke from BD-BACKEND-DEPLOY-01A remain implemented.
> The active staging provider direction is Yandex Cloud in `ru-central1` under
> [BD-DOCS-047](../decisions/backend-staging-provider-pivot-yandex-cloud.md).
> This revision reconciles documentation only: it creates no infrastructure,
> publishes no image, runs no migration and changes no traffic. Issue #823
> remains open.

## Current Yandex staging boundary

| Layer | Current contract | Classification |
|---|---|---|
| Provider and location | Yandex Cloud, `ru-central1`; backend and PostgreSQL physically in the Russian Federation | `DECIDED` |
| Registry | Yandex Container Registry candidate; publish once and deploy/rollback by registry-returned immutable digest | `EXECUTION_PROOF_REQUIRED` |
| Runtime | Yandex Serverless Containers candidate; authenticated access only | `EXECUTION_PROOF_REQUIRED` |
| Database | Managed Service for PostgreSQL 16 candidate; private network only | `HUMAN_DECISION_REQUIRED` |
| Secrets | Lockbox candidate; bootstrap, runtime injection, rotation and revocation procedures unresolved | `HUMAN_DECISION_REQUIRED` |
| Migration identity and primitive | Separate one-shot identity and execution primitive; never runtime startup | `HUMAN_DECISION_REQUIRED` |
| Ordered migration apply and intended re-apply | No staging migration execution exists; both the first ordered apply and intended clean re-apply require retained proof | `EXECUTION_PROOF_REQUIRED` |
| GitHub identity | OIDC → Yandex WIF → short-lived IAM token | `PROVEN_AT_VALIDATION_SCOPE` |
| Backend credentials | IAM token → short-lived three-part AWS-compatible credential → OpenTofu 1.12.0 S3 backend authentication | `PROVEN_AT_VALIDATION_SCOPE` |
| Durable remote-state lifecycle | Yandex Object Storage candidate; exact bucket/name, versioning/retention, recovery procedure and IAM are unresolved | `HUMAN_DECISION_REQUIRED` |
| Durable remote-state bootstrap | No durable bucket, IAM binding or state exists; execution waits for an approved lifecycle contract and terminal locking PASS | `EXECUTION_PROOF_REQUIRED` |
| State locking | Conditional-write behavior, contention, recovery and force-unlock controls are not proven | `EXECUTION_PROOF_REQUIRED` |
| Staging evidence retention | Exact retained-evidence location, duration, access, redaction owner and deletion procedure are unresolved | `HUMAN_DECISION_REQUIRED` |

The completed authentication ladder proved only a disposable access chain. It
did not prove state locking or durable state, establish production IAM bindings,
provision staging, select a migration primitive, or validate Serverless
Containers promotion and rollback behavior. The exact validation boundary and
evidence references are recorded in
[BD-DOCS-048](../decisions/backend-staging-yandex-remote-state-validation-plan.md).

### IAM identity separation

Deployment, runtime and migration require three separate identities. Reuse
across roles, mutual impersonation, `Owner`, `Editor` and equivalently broad
roles are forbidden. Bindings must be least-privilege and scoped to exact
staging resources.

- The **deployment identity** authenticates from GitHub Actions through OIDC/WIF,
  publishes and deploys only approved artifacts/resources, and has no runtime
  database or application-secret access. Any ability to attach another identity
  is restricted to the exact runtime and migration identities.
- The **runtime identity** serves the API and receives only the approved runtime
  secret, PostgreSQL connectivity and observability permissions. It cannot
  publish, deploy, migrate, change IAM or impersonate.
- The **migration identity** performs ordered, one-shot schema changes and
  receives only migration-specific secret and database permissions. It cannot
  serve traffic, publish, deploy, change IAM or impersonate.

The validation identity used by the disposable authentication proof is evidence
for the credential chain, not an approved substitute for any of these durable
staging identities.

Durable backend bootstrap and read-only audit require additional scoped
identities. Neither may reuse the deployment, runtime or migration identity: the
bootstrap identity is limited to the approved backend/IAM bootstrap operation,
and the audit identity is read-only. Their exact principals and bindings remain
`HUMAN_DECISION_REQUIRED`.

### Secret-value boundary

Secret values are forbidden in Git/source, OpenTofu configuration, `.tfvars`,
environment files, state/state backups, saved plans, plan/console output,
documentation, workflow/build/deployment/runtime logs, image layers, build args,
CI/CD outputs, artifacts, evidence and support/debug exports.

OpenTofu may manage only Lockbox metadata, empty secret containers and IAM
bindings. It must not create, transmit or store secret payloads or versions.
Marking a value `sensitive` does not keep it out of state. An approved
out-of-state bootstrap and rotation channel that leaves no value in history,
logs, artifacts or evidence is required before runtime or migrations. Its exact
bootstrap, injection, rotation and emergency revocation procedures, responsible
operators and verification evidence remain `HUMAN_DECISION_REQUIRED`.

### Data-location guard

Only synthetic, non-personal data is permitted across requests and bodies,
PostgreSQL, caches, logs, traces, metrics, object storage, backups/snapshots,
restores, support dumps, CI/deployment artifacts, operational evidence and
exports. Production exports/restores, replayed production requests/logs and
production-derived personal fixtures are forbidden.

If real or production-derived data is discovered, stop the affected check or
environment, restrict further access and remove it through a separately approved
incident procedure. Record the incident without copying sensitive values into
evidence.

### Access, CORS and activation

Staging invocation must remain authenticated. Public anonymous access is
forbidden. CORS permits exactly `https://iprus2026-tech.github.io` and never `*`.

A Serverless Containers promotion is not PWA/API activation. No client API base,
CSP, service worker, GitHub Pages or other `public/**` change belongs to Issue
#823's infrastructure slices. Activation remains a separate gate under Issue
#828.

## Implemented container baseline

Build context is `server/`. The Dockerfile pins the verified `node:22-slim`
image index digest, installs the committed lockfile with `npm ci --omit=dev`,
sets `NODE_ENV=production`, and runs as `node`.

Only these provenance build arguments are permitted:

| Build argument | Purpose |
|---|---|
| `OCI_SOURCE` | Repository URL for `org.opencontainers.image.source`. |
| `OCI_REVISION` | Exact source commit for `org.opencontainers.image.revision`. |

Runtime configuration, database URLs, session secrets, tokens, OTPs and
credentials must never be build arguments. Current CI builds a local image tagged
with the commit SHA and does not publish it.

Any future staging slice must publish once, capture the registry-returned digest
(`name@sha256:...`) and use that exact digest for candidate, promotion and
rollback. A mutable tag is not admissible deployment evidence.

## Runtime configuration and probes

Deliver configuration and secrets only at runtime through the approved
out-of-state channel. Do not place a real `.env` file in the build context or
image.

| Class | Values |
|---|---|
| Secrets | `DATABASE_URL`, `SESSION_SECRET` |
| Configuration | `HOST`, `PORT`, `LOG_LEVEL`, `ALLOWED_ORIGIN`, `OTP_TTL_SECONDS`, `OTP_LENGTH`, `OTP_MAX_ATTEMPTS`, `SESSION_TTL_SECONDS` |
| Mandatory staging policy | `NODE_ENV=production`, `OTP_DEV_MODE=false`, `ALLOWED_ORIGIN=https://iprus2026-tech.github.io` |

- `GET /api/v1/health` is DB-free liveness and returns HTTP 200 with
  `{ "status": "ok", "service": "@bazardrive/server" }`.
- `GET /api/v1/readyz` is readiness. It verifies PostgreSQL connectivity and the
  required migration state; failure returns HTTP 503 and blocks promotion.

The image and Compose healthchecks use Node to call `/api/v1/health`; they do not
require `curl` and do not replace readiness with liveness.

## Issue #823 acceptance map

| Acceptance gate | Classification | Current evidence | Remaining blocker |
|---|---|---|---|
| Reproducible container and CI smoke | `PROVEN_AT_VALIDATION_SCOPE` | Implemented on the v0.4.0 baseline | None for the local baseline; publication is not yet proven. |
| Keyless GitHub/Yandex/Object Storage authentication | `PROVEN_AT_VALIDATION_SCOPE` | Disposable 01C-A/B/C ladder passed | Durable least-privilege staging identities and backend bootstrap are not defined. |
| Durable remote-state lifecycle | `HUMAN_DECISION_REQUIRED` | Disposable authentication used an inert temporary bucket only | Exact durable bucket/name, versioning/retention, recovery procedure, restore-test acceptance and least-privilege IAM remain open. |
| Remote-state locking and bootstrap | `EXECUTION_PROOF_REQUIRED` | Candidate research exists | Locking, contention, stale-lock recovery and controlled force-unlock require terminal proof before durable bootstrap. |
| Yandex account topology and cost boundary | `HUMAN_DECISION_REQUIRED` | Provider/region decided | Exact cloud/folder, billing owner, budget, alerts and applicable availability zone require human decisions. |
| Private PostgreSQL 16 | `HUMAN_DECISION_REQUIRED` | Application migrations and readiness contract exist | Network, cluster sizing/storage, backup/PITR, maintenance and recovery decisions remain open; no cluster exists. |
| Secret delivery | `HUMAN_DECISION_REQUIRED` | Secret-exclusion rules are settled | Lockbox bootstrap/injection/rotation/revocation procedures, responsible operators and exact IAM remain open. |
| Immutable release/promotion | `EXECUTION_PROOF_REQUIRED` | Image provenance and digest policy are settled | Registry and Serverless Containers candidate/promotion/rollback mechanics require execution proof. |
| Migration identity and primitive | `HUMAN_DECISION_REQUIRED` | Migration files and readiness checks exist | Separate Yandex execution primitive, identity, compatibility and recovery decision remain open. |
| Ordered migration apply and intended re-apply | `EXECUTION_PROOF_REQUIRED` | `server-ci` exercises repository migrations against PostgreSQL 16 | No staging migration has run; retained proof must show the ordered first apply and intended re-apply both complete cleanly. |
| Credential/OTP/session/unrestricted-token exclusion | `EXECUTION_PROOF_REQUIRED` | Repository and image secret-exclusion rules exist | The fresh staging run must prove no such value entered Git, logs, summaries, artifacts or retained evidence. |
| Staging evidence retention | `HUMAN_DECISION_REQUIRED` | Sanitization boundaries are defined | Exact evidence location, retention period, read access, redaction owner and deletion/disposal procedure remain open. |
| Live staging checks and rollback | `EXECUTION_PROOF_REQUIRED` | Probe semantics and previous-digest rollback order are documented | No authenticated staging URL, database-backed readiness proof, promotion or rollback rehearsal exists. |
| PWA activation | `DECIDED` | Explicitly separate | Remains outside this runbook and Issue #823. |

## Deployment order once every stop gate is closed

This order is a contract, not authorization to execute:

1. Bootstrap approved durable remote state and least-privilege IAM after the
   independent locking gate passes.
2. Provision private PostgreSQL 16 and approved Lockbox metadata/injection paths.
3. Publish the reviewed image once and record its immutable digest.
4. Apply ordered migrations with the separate migration identity.
5. Run the same approved migration primitive again against the resulting schema
   and require the intended re-apply to complete cleanly. Any error or unexpected
   schema/data mutation blocks promotion.
6. Only after both migration gates pass, create the candidate from that digest
   with the runtime identity using a separately accepted Yandex mechanism that
   keeps the unverified revision from serving traffic. If no such mechanism has
   accepted evidence, stop here; do not assume a Cloud Run-style zero-traffic
   primitive.
7. Verify authenticated `/api/v1/health`, then `/api/v1/readyz` with required
   schema state.
8. Promote only after both probes and migration evidence pass.
9. Rehearse application rollback to the previous immutable digest and repeat
   both probes.

Migration failure, a non-clean intended re-apply, non-200 readiness or absent
evidence means **no promotion**. Application rollback does not roll the database
back; every migration requires an explicit forward/backward compatibility and
recovery decision first.

### Staging/deployment checks and retained evidence

The following proof set is `EXECUTION_PROOF_REQUIRED` from one fresh staging
execution; a local or disposable authentication proof cannot substitute for it:

- exact source commit and registry-returned immutable image digest;
- exact `server-ci` and deployment workflow run IDs/URLs and conclusions;
- ordered migration list, first-apply result and intended clean re-apply result;
- authenticated `/api/v1/health` and `/api/v1/readyz` UTC timestamps, HTTP
  statuses and sanitized readiness result;
- previous digest, candidate/promotion result, rollback result, and both
  post-rollback probe results;
- a secret-safety verdict confirming that no credential, OTP, session token or
  unrestricted token entered Git, logs, summaries, artifacts or evidence.

Evidence must be sanitized and readable by the read-only audit identity. The
exact durable evidence location, retention period, access policy, redaction
owner and deletion/disposal procedure are `HUMAN_DECISION_REQUIRED`; until they
are approved, the staging execution cannot claim Issue #823 acceptance.

## Current stop gate and next implementation slice

No infrastructure or deployment slice may treat the disposable authentication
proof as a durable backend. Until state locking has a terminal passing verdict,
do not create a durable state bucket and do not add or initialize staging
OpenTofu.

After this documentation package is accepted and that independent locking gate
passes, the next narrow implementation slice is **durable remote-state and
least-privilege IAM bootstrap only**. It excludes PostgreSQL, Lockbox payloads,
registry publication, Serverless Containers, migrations, probes, promotion and
rollback.

Current `server-ci` remains the only execution evidence: it builds without
publishing, checks OCI provenance and non-root execution, rejects secret-like
build artifacts, proves DB-free `/health`, and proves `/readyz` stays a failing
readiness gate when PostgreSQL is unavailable. No current step changes the PWA,
CSP, service worker, API traffic or any cloud resource.
