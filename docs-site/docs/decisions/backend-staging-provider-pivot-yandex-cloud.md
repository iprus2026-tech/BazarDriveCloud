---
id: BD-DOCS-047
docType: decision-record
title: Backend staging provider pivot — Yandex Cloud / RF hosting — Decision Record
owner: backend-ops-agent
status: draft
revision: 2026-08-16
effectiveFrom: 2026-08-06
reviewAfter: 2026-09-16
visibleFor: [developer, dispatcher, product, qa]
sourceOfTruth: docs-site
related:
  routes:
    - /api/v1/health
    - /api/v1/readyz
  files:
    - docs-site/docs/decisions/backend-staging-provider-and-iac.md
    - docs-site/docs/decisions/backend-staging-remote-state-bootstrap.md
    - docs-site/docs/decisions/backend-staging-yandex-remote-state-validation-plan.md
    - docs-site/docs/processes/backend-staging-container-runbook.md
    - infra/staging/README.md
  issues:
    - "#823"
    - "#894"
  prs: []
tags: [decision-record, adr, backend, staging, deployment, iac, yandex-cloud, provider-pivot]
slug: /decisions/backend-staging-provider-pivot-yandex-cloud
---

# Backend staging provider pivot — Yandex Cloud / RF hosting — Decision Record

> **Post-v0.4.0 reconciliation; contract only — `status: draft`.** This record
> pivots the provider proposed by
> [BD-DOCS-044](./backend-staging-provider-and-iac.md) from Google Cloud to
> Yandex Cloud `ru-central1`. Since the original audit, the disposable 01C-A,
> 01C-B and 01C-C ladder passed: keyless Object Storage backend authentication
> is now `PROVEN_AT_VALIDATION_SCOPE`. State locking remains unproven and blocks
> durable OpenTofu bootstrap. This revision creates no cloud resource, identity,
> bucket, PostgreSQL cluster, registry, secret, image, deployment or state and
> runs no `tofu init`/`plan`/`apply`.

### Evidence incorporated after the original decision

| Validation step | Recorded outcome | Current meaning |
|---|---|---|
| [Issue #856](https://github.com/iprus2026-tech/BazarDriveCloud/issues/856) — 01C-A | FINAL PASS | GitHub OIDC → Yandex WIF → short-lived IAM token worked without a static/JSON key. |
| [Issue #858](https://github.com/iprus2026-tech/BazarDriveCloud/issues/858) — 01C-B | FINAL PASS | The IAM session issued a bounded-TTL three-part AWS-compatible credential without a static access key. |
| [Issue #860](https://github.com/iprus2026-tech/BazarDriveCloud/issues/860) — 01C-C | FINAL PASS | OpenTofu 1.12.0 authenticated its S3 backend to disposable Yandex Object Storage; cleanup completed. |

These outcomes prove the authentication chain only. They do not prove state
locking, approve a durable bucket or IAM layout, pin OpenTofu for the repository,
or prove any staging runtime, database, migration, promotion or rollback.

## Context

BD-DOCS-044 and BD-DOCS-046 proposed a Google Cloud technical staging
environment. A new human architecture requirement supersedes that provider
choice: BazarDriveCloud's backend server and PostgreSQL must physically reside
in the Russian Federation, and Google Cloud has no region located in the
Russian Federation. This record is the outcome of a provider-fit audit that
evaluated Yandex Cloud `ru-central1` against the existing GCP-shaped contract,
component by component, using current official Yandex Cloud and OpenTofu
documentation.

Issue #823 remains open; nothing in this record changes that. This record does
not resolve #823's acceptance criteria (real deployment, migrations, secret
safety, rehearsed rollback, green deployment checks) — it only re-points the
*provider* the future implementation slices will target.

## Hard requirement

> BazarDriveCloud backend server and PostgreSQL must physically reside in the
> Russian Federation. Foreign regions are not acceptable for these two
> components.

Yandex Cloud's `ru-central1` availability zones (`ru-central1-a`,
`ru-central1-b`, `ru-central1-d`; `ru-central1-c` is being decommissioned) are
located in Yandex data centers in the Moscow, Ryazan, and Vladimir regions of
Russia, per Yandex Cloud's own "Availability zones" documentation. That
satisfies the *physical hosting* half of this requirement for compute and
PostgreSQL.

**This is an architecture decision, not a legal one.** Choosing `ru-central1`
does not by itself establish compliance with 152-FZ, and it does not resolve
personal-data processing, localization, retention, or cross-border-transfer
questions. Provider certifications a vendor advertises are not the same thing
as physical data location, and physical data location is not the same thing as
application-level personal-data compliance. All of that remains a separate,
unresolved legal/compliance decision, out of scope for this record, and must
not be inferred from the provider choice recorded here.

## Provider decision

Proposed technical staging target, replacing BD-DOCS-044's Google Cloud table:

| Layer | Yandex Cloud target | Status |
|---|---|---|
| Cloud boundary | Yandex Cloud cloud/folder (dedicated staging folder) | `HUMAN_DECISION_REQUIRED` |
| Region | `ru-central1` | `DECIDED` |
| Exact AZ where a zonal resource requires one | `ru-central1-a`, `-b`, or `-d` | `HUMAN_DECISION_REQUIRED` |
| Registry | Yandex Container Registry candidate | `EXECUTION_PROOF_REQUIRED` |
| API runtime | Serverless Containers candidate | `EXECUTION_PROOF_REQUIRED` — release/promotion/rollback |
| Database | Managed Service for PostgreSQL 16 candidate | `HUMAN_DECISION_REQUIRED` — topology, sizing, storage, network, backup |
| Secrets | Lockbox candidate | `HUMAN_DECISION_REQUIRED` — injection/bootstrap/rotation; then execution proof |
| GitHub deployment auth | Yandex IAM Workload Identity Federation | `PROVEN_AT_VALIDATION_SCOPE` |
| IaC | OpenTofu | `DECIDED` — durable repository version pin still required |
| Remote state | Yandex Object Storage S3-compatible backend candidate | `EXECUTION_PROOF_REQUIRED` — locking and durable bootstrap |
| State locking | Conditional-write candidate, not yet execution-proven | `EXECUTION_PROOF_REQUIRED` |
| Keyless state-backend auth | WIF → IAM token → ephemeral AWS-compatible credential → S3 backend | `PROVEN_AT_VALIDATION_SCOPE` |
| Migration execution | Separate identity; concrete primitive undecided | `HUMAN_DECISION_REQUIRED` |
| Monitoring/logging | Yandex Monitoring / Cloud Logging candidate | `HUMAN_DECISION_REQUIRED` |

No `HUMAN_DECISION_REQUIRED` or `EXECUTION_PROOF_REQUIRED` row may be silently
upgraded. The completed authentication proof may not be generalized beyond its
disposable validation scope.

## Contracts that must survive the provider pivot

The following principles are restated here explicitly, not inherited by
implication from the Google Cloud ADR, so a reader of this record alone has
the full current contract:

1. The `/server` backend is the source of truth for backend behavior; the PWA
   is not a backend and no server code or DB lives in `public/`.
2. Deployment, runtime, and migration use three separate identities/service
   accounts. Combining them, or mutual impersonation, is forbidden.
3. `Owner`, `Editor`, and equivalently broad roles are forbidden for any
   staging identity; grants must be minimal and preferably scoped to the exact
   resource.
4. GitHub deployment authentication remains short-lived/keyless where proven
   (Yandex IAM Workload Identity Federation for the identity that publishes
   images and deploys the compute service — see "Explicitly superseded GCP
   assumptions" for what this does and does not cover).
5. Secret values must never enter: Git/source, OpenTofu configuration,
   `.tfvars`, OpenTofu state or state backups, saved plan files, plan/console
   output, documentation, workflow/build/deployment/runtime logs, image
   layers, build arguments, CI/CD outputs, artifacts, or deployment evidence.
   IaC may manage only secret *metadata* (empty secret containers, IAM
   bindings on them), never secret payloads or versions.
6. PostgreSQL major version remains **16**.
7. The database must never be publicly exposed; access is private-network
   only.
8. Runtime API access remains authenticated; public unauthenticated staging
   invocation is forbidden.
9. CORS remains exactly the previously human-approved, non-wildcard origin:
   `https://iprus2026-tech.github.io` (approved in BD-DOCS-044; restated here
   as still valid and provider-independent — not reopened by this pivot).
10. This slice does not activate the PWA/API connection. `public/**`, CSP,
    service worker, and GitHub Pages are untouched; PWA/API activation remains
    owned by Issue #828.
11. Staging holds synthetic, non-personal data only.
12. Production exports, real passenger/driver identity or contact data, real
    orders/offers/rides/routes/location traces, real identity/vehicle/
    compliance/safety documents, real payment/receipt/credential/session
    material, and production-derived fixtures with a reversible mapping to
    real people are all forbidden in staging, across every input and derived
    store (requests, DB contents, caches, logs, traces, backups, exports,
    evidence).
13. Deployment and rollback use an immutable image digest, never a mutable
    tag.
14. Database migration and application rollout remain separate gates; a
    migration must complete successfully against the same immutable image
    digest as the candidate before any traffic switch.
15. Application rollback must never be described as automatically rolling
    back a database migration — every migration needs its own explicit
    compatibility/recovery decision, exactly as BD-DOCS-044 already required.

The "dedicated staging environment" decision, the passenger/PWA URL
(`https://iprus2026-tech.github.io/BazarDriveCloud`), and the exact
`ALLOWED_ORIGIN` above were already human-approved before this pivot and
remain approved; this pivot does not reopen them.

## Explicitly superseded GCP assumptions

The following provider-specific choices from BD-DOCS-044/046 are superseded by
this record. Nothing below is silently translated into a Yandex equivalent —
each superseded item's Yandex candidate, where one exists, is recorded above
in "Provider decision" as its own ADAPT/RE-AUDIT/NOT_PROVEN entry, evidenced
independently rather than assumed by naming similarity:

- Google Cloud as the provider
- GCP project as the staging resource boundary
- Artifact Registry
- Cloud Run (including its candidate-revision/zero-traffic/gradual-promotion
  model — see "Serverless Containers release stop gate" below)
- Cloud SQL for PostgreSQL
- Secret Manager
- Cloud Run Job (as the migration-execution primitive)
- Google Workload Identity Federation (the *Google*-side OIDC federation
  specifically — Yandex IAM Workload Identity Federation is a different
  federation, evidenced on its own merits, not assumed equivalent by name)
- GCS as the OpenTofu remote-state backend
- GCS `.tflock` / conditional-write locking as *the* locking contract (see
  "Remote-state stop gate" — this does not mean locking is assumed solved a
  different way; it means the GCS-specific mechanism no longer applies and a
  Yandex-specific one is unproven)
- GCP-specific IAM role names, `gcloud` commands, and bucket/IAM bootstrap
  steps from BD-DOCS-046

Google Cloud commands and role names are not translated into Yandex Cloud
commands or role names in this record. A future, separately authorized
bootstrap slice must derive and validate those directly against Yandex Cloud's
own tooling and documentation.

## Remote-state stop gate

BD-DOCS-047 blocks durable OpenTofu remote-state bootstrap against Yandex Object
Storage until locking has a terminal passing execution verdict and the durable
bucket/IAM contract is approved. Authentication no longer blocks at the
validation level, but its proof boundary must be preserved exactly.

> **Refined and reconciled by
> [BD-DOCS-048](./backend-staging-yandex-remote-state-validation-plan.md).** Its
> original 01A research split locking (01B) from authentication (01C). The later
> 01C-A/B/C executions passed and are now incorporated there. The locking
> contract remains pending and independent.

### A. Locking

The official Yandex Cloud tutorial for storing Terraform/OpenTofu state in
Object Storage, as currently published, contains no mention of a locking
mechanism. BD-DOCS-046's entire locking contract (`.tflock`, GCS conditional
writes, `storage.objects.delete` analysis, force-unlock procedure) is
GCS-specific and does not carry over by assumption. Before any bootstrap:

A later, separately authorized slice must prove — using a disposable Yandex
Object Storage bucket — that the chosen OpenTofu S3 backend supports the
required conditional-write locking behavior. Validation must eventually
include:

- `tofu init` against the bucket;
- the first state write succeeding;
- lock acquisition succeeding;
- a concurrent operation being rejected while the lock is held;
- normal unlock after a successful apply;
- a repeated state overwrite (second write) succeeding;
- interrupted/stale lock handling being understood in a safe, non-production
  context;
- `force-unlock` behavior being exercised and understood, with the same
  human-approval-and-logging requirement BD-DOCS-046 already places on GCS
  force-unlock.

Until that validation exists, treat concurrent-apply state corruption as an
open risk, not a solved problem — this record marks it **NOT_PROVEN**.

### B. Authentication

**Current verdict: `PROVEN_AT_VALIDATION_SCOPE`.** Issues #856, #858 and #860
demonstrated the complete short-lived chain:

1. GitHub OIDC exchanged through Yandex WIF for a short-lived IAM token.
2. That IAM session issued a bounded-TTL three-part AWS-compatible credential.
3. OpenTofu 1.12.0 used only that ephemeral credential to authenticate an S3
   backend against a disposable Object Storage bucket.

No static access key or service-account JSON key was used, and cleanup was part
of the validation. This closes the original authentication research question;
it does **not** authorize reuse of the validation principal, a durable bucket,
production IAM bindings or secret persistence. A future durable bootstrap must
implement the same short-lived chain with exact least-privilege bindings and
must fail closed rather than fall back to a long-lived key.

Static or long-lived credentials remain forbidden. Any exception would still
require an explicit human architecture/security decision and is not implied by
the successful proof.

## Serverless Containers release stop gate

Do not claim equivalence with Cloud Run's candidate revision with zero
traffic, percentage traffic split, or delayed promotion after readiness
probes. Yandex Serverless Containers documentation describes revisions with
`Active`/`Obsolete` status, which reads as a coarser, more all-or-nothing
cutover model than Cloud Run's; no authoritative source found confirms a
zero-traffic candidate deploy or a gradual/percentage promotion primitive.

The **intended** release lifecycle is unchanged from BD-DOCS-044/043:

```
build immutable digest
  → migration
  → candidate deployment
  → GET /api/v1/health
  → GET /api/v1/readyz
  → explicit promotion
  → rollback rehearsal
```

What is **not** settled is which Yandex Serverless Containers mechanism
implements "candidate deployment" and "explicit promotion" safely (i.e.
without accidentally exposing an unverified candidate to traffic). This gap is
recorded as **RE-AUDIT**, to be closed by testing against Yandex's actual API
behavior or by authoritative documentation this audit did not surface — not by
assumption.

## Migration stop gate

Do not invent a Yandex equivalent of Cloud Run Jobs. No Yandex primitive
confirmed as directly analogous to a one-shot batch job running the same
immutable image digest as the candidate service was found in this audit.
Migration execution remains a separate operation, executed by a separate
migration identity, exactly as BD-DOCS-044's IAM identity-separation rule
requires — but its concrete Yandex execution primitive (a repurposed
Serverless Containers invocation, a CI-runner-executed step reaching the
private network, or another mechanism) is **undecided** and marked RE-AUDIT.

## Human decisions still blocking infrastructure

Already settled and not reopened by this pivot: dedicated staging
environment, the passenger/PWA URL, and the exact `ALLOWED_ORIGIN` (see
"Contracts that must survive the provider pivot" above).

Newly open or reopened by the provider pivot — none of the following may be
guessed, copied from another environment, or silently chosen by a workflow:

1. Exact AZ inside `ru-central1` (`-a`, `-b`, or `-d`).
2. Yandex Cloud cloud/folder IDs and naming.
3. Billing owner and cost-accountability contact.
4. Monthly staging budget and alert thresholds.
5. Exact IAM bindings for the bootstrap, deployment, runtime, migration, and
   read-only audit identities.
6. Durable remote-state identity, exact least-privilege bindings and credential
   lifetime while preserving the proven short-lived authentication chain.
7. Remote-state locking validation owner and process (Remote-state stop gate,
   item A); locking still requires execution proof.
8. PostgreSQL sizing (host class / resource preset).
9. PostgreSQL storage type and size.
10. PostgreSQL backup/PITR policy (beyond Managed PostgreSQL's documented
    defaults, which must still be explicitly confirmed as sufficient for this
    project).
11. Network/security-group policy between the compute layer and PostgreSQL.
12. Migration execution mechanism (Migration stop gate).
13. Lockbox runtime-injection mechanism into the chosen compute service.
14. Release/candidate-promotion mechanism (Serverless Containers release stop
    gate).

## Issue #823

Issue #823 remains **open**. This record changes no acceptance checkbox on
that issue. #823 requires real deployment evidence — a fresh staging deploy
reaching `/api/v1/health` and `/api/v1/readyz`, ordered migrations applying
cleanly, no committed/logged credential material, a rehearsed rollback, and
green server-ci/deployment checks. BD-DOCS-047 is a provider-pivot contract
only and satisfies none of those items by itself.

## BD-DOCS-044 / BD-DOCS-046 status

BD-DOCS-044 and BD-DOCS-046 are marked `status: superseded` by this record and
carry a prominent notice pointing here. They are preserved in full as
architectural history — the audit trail of why Google Cloud was originally
proposed and what its GCS-specific remote-state contract looked like remains
useful context. They are not deleted and their historical content is not
rewritten to pretend Yandex Cloud was always the plan.

BD-DOCS-046 in particular is **deferred, not replaced**: this record does not
invent a Yandex Object Storage bootstrap procedure. A future Yandex remote-state
ADR is a separate, validation-backed slice, gated on a terminal locking verdict
and preservation of the proven short-lived authentication boundary.

## Alternatives considered

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Yandex Cloud, `ru-central1` | Only evaluated provider whose regions are documented as physically located in the Russian Federation; PostgreSQL 16, IAM-authenticated container runtime, digest-addressable registry, and the complete short-lived Object Storage backend authentication chain are evidenced | Remote-state locking remains unproven; Serverless Containers' zero-traffic/gradual-promotion equivalence to Cloud Run is unproven; no confirmed Job-equivalent primitive | **Proposed**; authentication is proven only at validation scope, while locking and runtime execution gates remain open |
| Google Cloud (BD-DOCS-044's original proposal) | Previously audited, GCS locking/IAM/WIF contract already fully specified | No region physically located in the Russian Federation — fails the hard requirement outright | **Rejected** — does not meet the hard requirement |
| Remain undecided / re-run the audit later | Avoids committing to a provider before every Yandex question is resolved | Leaves Issue #823 with no forward path at all; the hard requirement already rules out the previously proposed provider, so continuing to plan against it would be misleading | **Rejected** — a provider direction is needed even with open sub-questions, provided they are marked NOT_PROVEN/RE-AUDIT rather than assumed solved |

## Consequences

**Positive**

- The staging provider direction is now consistent with the RF physical-
  hosting requirement, evidenced against current official documentation
  rather than assumed by analogy to the GCP contract.
- Every carried-forward principle (identity separation, secret-value
  boundary, synthetic-data-only, immutable-digest deploy/rollback,
  migration/rollout gate separation) is restated explicitly in one place,
  so this record does not depend on a reader also holding BD-DOCS-044/046
  in mind.
- The keyless authentication question now has direct, disposable execution
  evidence and an explicit `PROVEN_AT_VALIDATION_SCOPE` boundary; remote-state
  locking remains a separate blocking execution proof.

**Negative / trade-offs**

- No durable OpenTofu bootstrap can proceed until the remote-state locking gate
  has a terminal passing verdict and the durable bucket/IAM contract is approved.
- The exact Serverless Containers release/promotion mechanism and the
  migration-execution primitive remain open engineering questions, not just
  human-approval questions — closing them may require hands-on testing
  against Yandex Cloud, not just more documentation reading.
- BD-DOCS-044/046 now carry two audiences (historical GCP record, provider
  it was superseded by) that future readers must not conflate; the
  supersession notices exist specifically to prevent that.

**Follow-ups**

- The independent locking slice must close remote-state stop-gate item A before
  any durable `tofu init`; item B is complete only at disposable validation
  scope and must be implemented without broadening its credential boundary.
- A future slice must resolve the Serverless Containers release/promotion
  mechanism and the migration-execution primitive, ideally via a throwaway,
  non-production Yandex Cloud sandbox rather than documentation alone.
- After this contract is accepted and locking has a terminal passing verdict,
  the next narrow implementation slice is a Yandex durable remote-state and
  least-privilege IAM bootstrap ADR/implementation only. It excludes PostgreSQL,
  runtime, secrets payloads, image publication, migrations and traffic.
- Issue #823 stays open until real staging deployment and rollback evidence
  meet its existing acceptance criteria, against whichever provider
  ultimately proves out.
