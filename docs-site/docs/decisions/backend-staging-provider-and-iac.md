---
id: BD-DOCS-044
docType: decision-record
title: Backend staging provider and IaC — Decision Record
owner: backend-ops-agent
status: superseded
revision: 2026-08-06
effectiveFrom: 2026-07-27
reviewAfter: 2026-09-05
visibleFor: [developer, dispatcher, product, qa]
sourceOfTruth: docs-site
related:
  routes:
    - /api/v1/health
    - /api/v1/readyz
  files:
    - docs-site/docs/processes/backend-staging-container-runbook.md
    - infra/staging/README.md
  issues:
    - "#823"
    - "#828"
  prs: []
tags: [decision-record, adr, backend, staging, deployment, iac]
slug: /decisions/backend-staging-provider-and-iac
---

# Backend staging provider and IaC — Decision Record

> **SUPERSEDED by [BD-DOCS-047](./backend-staging-provider-pivot-yandex-cloud.md).**
> A new human architecture requirement mandates that the backend server and
> PostgreSQL physically reside in the Russian Federation. Google Cloud has no
> region located in the Russian Federation, so the Google Cloud provider
> proposal in this record is **historical only** and is not the current
> staging direction. The provider-independent decisions this record captured —
> the dedicated staging environment strategy, the passenger/PWA URL, and the
> approved `ALLOWED_ORIGIN` — remain valid and are restated in BD-DOCS-047.
> Every Google-Cloud-specific choice below (project ID, Artifact Registry,
> Cloud Run, Cloud SQL, Secret Manager, Cloud Run Job, Google Workload Identity
> Federation) is superseded. This record is preserved as architectural history
> and is not deleted or rewritten.

> **Proposed contract only — `status: draft` (historical).** BD-BACKEND-DEPLOY-01B-1A fixes
> the intended staging control-plane choices and safety boundaries. It creates no
> Google Cloud project, billing relationship, registry, database, service,
> identity, secret, remote state, image or deployment. Applying infrastructure
> requires a separately approved slice after every blocking input below is known.

## Context

BD-BACKEND-DEPLOY-01A established a production container baseline, immutable base
image digests, OCI provenance labels, a secret boundary, DB-free liveness and
database/schema readiness. Issue #823 remains open because no real staging
environment exists and no deployment or rollback has been rehearsed.

01B needs a narrow, reproducible technical staging environment without silently
activating the GitHub Pages PWA, admitting public anonymous traffic, or deciding
where production personal data may lawfully reside. Provider choices must be
reviewed before credentials, billable resources or executable infrastructure are
introduced.

## Decision

### Staging platform

| Layer | Proposed choice | Contract |
|---|---|---|
| Cloud provider | **Google Cloud** | A dedicated technical staging boundary; project and region are blocking inputs, not defaults. |
| Container registry | **Artifact Registry** | Images are published once and deployment records the registry-returned immutable digest. Runtime and rollback use `image@sha256:...`, never a mutable tag. |
| Runtime | **Cloud Run** | Staging access is IAM-authenticated. Public unauthenticated invocation is forbidden. A candidate revision receives no traffic until migration and readiness gates pass. |
| Database | **Cloud SQL for PostgreSQL 16** | Major version 16 is explicit. Database network access and service identities follow least privilege. |
| Secrets | **Secret Manager** | `DATABASE_URL`, `SESSION_SECRET` and any future secret values are delivered only at runtime. Values never enter Git, image layers, build arguments, workflow output or deployment evidence. |
| Migrations | **Separate Cloud Run Job** | The job runs the same immutable application image digest as the candidate service and must complete successfully before a traffic switch. Migrations do not run in every API container at boot. |
| GitHub authentication | **OIDC Workload Identity Federation** | GitHub Actions may receive short-lived, narrowly scoped credentials. Static service-account JSON keys are forbidden. |
| Infrastructure as Code | **OpenTofu** | Future reviewed configuration lives under `infra/staging/`. No `.tf` files or apply operation belong to 01B-1A. |
| IaC state | **Remote state, deferred** | Backend location, access policy, locking, retention and bootstrap ownership require a separate explicitly authorized slice. No local or remote state is created here. |

### IAM identity separation

Deployment, runtime and migration use three separate principals/service accounts.
Combining them, or reusing one identity for more than one role, is forbidden.
Mutual impersonation is forbidden. `Owner`, `Editor` and equivalently broad roles
are forbidden; permissions must be minimal and preferably scoped to the exact
staging resource. Exact IAM bindings remain a blocker for the future IaC slice and
must not be guessed here.

1. **Deployment identity.** GitHub Actions uses this identity only through
   OIDC Workload Identity Federation. It may publish and deploy only approved
   staging resources. If deployment requires `serviceAccounts.actAs`, that
   permission is limited to the exact runtime and migration identities. It has no
   runtime database access and no application-secret access.
2. **Runtime identity.** Only the Cloud Run runtime service uses this identity.
   It receives only required runtime secrets, Cloud SQL connection and
   observability permissions. It cannot deploy, publish images, run migrations,
   change IAM or impersonate another identity.
3. **Migration identity.** Only the separate Cloud Run migration Job uses this
   identity. It receives only migration-specific database and secret permissions.
   It cannot serve runtime traffic, deploy resources, change IAM or impersonate
   another identity.

### Secret-value boundary

Secret values are forbidden in Git/source, OpenTofu configuration, `.tfvars`,
environment files, OpenTofu state or state backups, saved plan files, plan/console
output, documentation, workflow/build/deployment/runtime logs, image layers,
build arguments, CI/CD outputs, artifacts, evidence and support/debug exports.

OpenTofu may manage only Secret Manager metadata, empty secret containers and IAM
bindings. It must not create or transmit secret payloads or secret versions.
Marking a value `sensitive` is not protection against its storage in OpenTofu
state. Values must be introduced through a separately approved out-of-state
channel that does not retain them in shell history, logs, artifacts or evidence.
The bootstrap and rotation procedure for that channel remains a blocking future
decision and is not implemented by this ADR.

### Access and activation boundary

- The Cloud Run staging service is IAM-authenticated. Granting
  `allUsers` the invoker role, `--allow-unauthenticated`, or an equivalent public
  bypass is forbidden.
- CORS is one exact explicitly approved origin. `*`, origin lists disguised as a
  string, and guessed origins are forbidden.
- Provider traffic means routing between Cloud Run revisions. It does not grant
  the PWA permission to call the API.
- No `public/**`, CSP, service worker, GitHub Pages or client API-base change is
  part of 01B. PWA/API activation remains owned by BD-BACKEND-ACTIVATE-01,
  Issue #828.

### Data-location guard

This staging environment is for synthetic, non-personal test data only. The rule
applies to every input and derived store: HTTP/API requests and request bodies,
database contents, caches, logs, traces, metrics and telemetry payloads,
object-storage artifacts, backups and snapshots, database restores,
support/debug dumps, CI/deployment artifacts, operational evidence and exports.

The following real data is forbidden in GCP staging:

- passenger or driver identity/contact/profile data;
- real orders, offers, assignments, rides, routes or location traces;
- identity, vehicle, compliance or safety documents;
- payment details, receipts tied to real people, credentials, session tokens or
  production exports.

Production exports and database restores, replayed production requests or logs,
and production-derived personal data used as fixtures are forbidden. Anonymizing
a production export is not assumed safe and is not authorized by this ADR.
Fixtures must be generated as synthetic data without a reversible mapping to real
people or production records.

Discovery of real or production-derived data requires stopping the affected
check/environment, restricting further access, and removing the data through a
separately approved incident procedure. The incident must be recorded without
copying sensitive values into evidence.

Production data residency, the localization and processing of Russian personal
data, cross-border transfer, retention and deletion require a separate legal,
security and architecture decision before any production-data system is placed
in Google Cloud. This ADR makes no claim that a Google Cloud region is suitable
for those purposes.

### Human-approved staging identity values (intended — execution validation pending)

A human has explicitly approved the four values below. Approval fixes the
*intended* value only — it does not create, verify, or configure any GCP
resource. Nothing here authorizes provisioning, and none of it changes until a
human makes a new decision.

| # | Decision | Approved value | Execution-validation status |
|---|---|---|---|
| A | GCP project strategy | **Dedicated staging project.** BazarDriveCloud staging uses its own GCP project; production resources must never be placed in this project. | N/A — a strategy choice, not a resource. |
| B | GCP project ID (intended) | `bazardrivecloud-staging` | **Not yet validated.** Global project-ID availability in Google Cloud has not been checked — provisioning is out of scope for this record. A future authorized bootstrap/provisioning slice must verify the ID is actually available/creatable in the intended organization before use. If it is unavailable, that slice must **stop** and request a new human decision; it must not silently substitute a different ID. |
| C | Passenger/PWA URL (reference only) | `https://iprus2026-tech.github.io/BazarDriveCloud` | This is the GitHub Pages URL the passenger/driver PWA is served from. It is **not** itself a CORS value — see D. Recorded for context, not for use as `ALLOWED_ORIGIN`. |
| D | Exact `ALLOWED_ORIGIN` | `https://iprus2026-tech.github.io` | **Approved.** A browser `Origin` is scheme + host + port only and never includes a path, so this value intentionally omits the `/BazarDriveCloud` path from C. Not a wildcard (`*`). Wiring this into a running service's config (`server/.env.example`, Secret Manager, Cloud Run env) is a separate, still-future deployment slice — recording it here is a docs-only contract, not a live configuration change. |

Until an authorized provisioning slice proves the project actually exists, the
only accurate way to state row B is **"approved intended staging Project ID:
`bazardrivecloud-staging`."** Do not write "the GCP project exists" before that
proof. Likewise, do not treat rows C/D as proof that the staging backend is
reachable from the PWA — activation remains gated by Issue #828 (see "Access
and activation boundary" above).

### Blocking inputs

Implementation must stop until a human explicitly confirms every value below.
Items 2 and 5 have now been confirmed by a human — see "Human-approved staging
identity values" above; item 2's real-world project-ID availability is a
separate, still-open execution check, not a re-opening of the decision itself.
Items 1, 3, 4, 6, 7 and 8 remain fully open:

1. the Google Cloud region, including latency and data-location rationale;
2. the GCP project ownership boundary is confirmed as a dedicated staging
   project (row A above), with an approved intended project ID of
   `bazardrivecloud-staging` (row B above). Still blocking: whether that
   project ID is actually available/creatable in Google Cloud — a future
   authorized bootstrap slice must verify this and stop for a new human
   decision if the ID is taken;
3. the billing owner and cost-accountability contact;
4. the monthly staging budget and alert thresholds;
5. the exact non-wildcard `ALLOWED_ORIGIN` is approved: `https://iprus2026-tech.github.io`
   (row D above);
6. IAM owners and exact least-privilege bindings for the separate bootstrap,
   deployment, runtime, migration and read-only audit identities;
7. the OpenTofu remote-state project/location, access policy and bootstrap
   procedure in its own approved slice;
8. Cloud SQL sizing, storage, backup/PITR and network-access policy.

None of the still-open values (1, 3, 4, 6, 7, 8) may be guessed, copied from
production, or silently chosen by a workflow.

## Release gates inherited by future slices

1. Build and publish only a reviewed merged commit.
2. Record the immutable image digest returned by Artifact Registry.
3. Execute the separate migration job with that same digest.
4. Deploy a Cloud Run candidate revision with no traffic.
5. Require `GET /api/v1/health` HTTP 200 with the exact liveness body.
6. Require `GET /api/v1/readyz` HTTP 200 with
   `{ "status": "ready", "db": "up" }`.
7. Switch Cloud Run revision traffic only after those gates and a separately
   authorized deployment approval.
8. Record the previous revision and image digest before rollout; rollback routes
   traffic to that revision and re-runs both probes without automatically rolling
   back the database.
9. Store redacted deployment and rollback evidence without secret values or
   personal data.

## Alternatives considered

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Google Cloud: Artifact Registry + Cloud Run + Cloud SQL + Secret Manager + Cloud Run Job | One IAM boundary; immutable revisions/digests; explicit no-traffic candidate; managed PostgreSQL 16; separate jobs | Requires project, billing, IAM, region and state decisions before use | **Proposed** |
| Render + external registry + Render Postgres | Smaller initial operations surface | Registry credentials and release/evidence controls are less unified; provider contract would differ | Rejected for 01B |
| Fly.io registry/runtime + Managed Postgres | Container-focused workflow and private networking | Different release/data-plane operational model and evidence contract | Rejected for 01B |
| VM + Docker Compose | Close to local parity | Makes TLS, patching, database operations, IAM and rollback the project’s responsibility | Rejected for technical staging |

## Consequences

**Positive**

- Provider, identity, data and activation boundaries are reviewable before any
  billable or externally reachable resource exists.
- Build credentials can remain short-lived; static cloud JSON keys are excluded.
- Migration, candidate verification and traffic switching remain separate,
  auditable gates.
- Technical staging cannot be mistaken for authorization to process real user
  data or activate the PWA.

**Negative / trade-offs**

- 01B cannot proceed until project, region, billing, budget and IAM owners are
  supplied.
- OpenTofu state needs its own bootstrap slice; it cannot be fully self-created
  without first deciding where state and bootstrap authority live.
- IAM-authenticated staging needs an authenticated QA/evidence path rather than
  anonymous browser access.
- Application rollback cannot undo an incompatible database migration; future
  migrations must carry an explicit compatibility/recovery decision.

**Follow-ups**

- 01B-1B: approve the GCP blocking inputs and the OpenTofu remote-state bootstrap
  contract.
- Later 01B slices: reviewed OpenTofu configuration, image publication,
  PostgreSQL 16 provisioning, migration job, no-traffic candidate deployment,
  traffic promotion and two-digest rollback rehearsal.
- Issue #823 stays open until real staging deployment and rollback evidence meet
  its acceptance criteria.
- Issue #828 separately owns any PWA/API activation.
