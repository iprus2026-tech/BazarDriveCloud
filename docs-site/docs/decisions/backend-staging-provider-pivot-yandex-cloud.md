---
id: BD-DOCS-047
docType: decision-record
title: Backend staging provider pivot — Yandex Cloud / RF hosting — Decision Record
owner: backend-ops-agent
status: draft
revision: 2026-08-06
effectiveFrom: 2026-08-06
reviewAfter: 2026-09-06
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
  prs: []
tags: [decision-record, adr, backend, staging, deployment, iac, yandex-cloud, provider-pivot]
slug: /decisions/backend-staging-provider-pivot-yandex-cloud
---

# Backend staging provider pivot — Yandex Cloud / RF hosting — Decision Record

> **Contract only — `status: draft`.** This record pivots the *provider* proposed
> by [BD-DOCS-044](./backend-staging-provider-and-iac.md) from Google Cloud to
> Yandex Cloud `ru-central1`. It creates no Yandex Cloud resource, folder, IAM
> identity, service account, Object Storage bucket, PostgreSQL cluster, container
> registry, secret, image, deployment, or OpenTofu state. It does not run `tofu
> init`/`plan`/`apply`. Two remote-state questions below are recorded as
> **NOT_PROVEN** and explicitly block OpenTofu bootstrap until a future,
> separately authorized slice validates them.

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
| Cloud boundary | Yandex Cloud cloud/folder (dedicated staging folder) | ADAPT |
| Region | `ru-central1` | DECIDED |
| Exact AZ | `ru-central1-a`, `-b`, or `-d` | BLOCKED — human decision |
| Registry | Yandex Container Registry | ADAPT |
| API runtime | Serverless Containers | ADAPT — release/promotion mechanics RE-AUDIT |
| Database | Managed Service for PostgreSQL, version 16 | ADAPT |
| Secrets | Lockbox | ADAPT — runtime-injection wiring RE-AUDIT |
| GitHub deployment auth | Yandex IAM Workload Identity Federation | ADAPT |
| IaC | OpenTofu | KEEP |
| Remote state | Yandex Object Storage (S3-compatible backend) candidate | RE-AUDIT |
| State locking | not proven | **NOT_PROVEN** |
| Keyless state-backend auth | not proven | **NOT_PROVEN** |
| Migration execution | mechanism undecided | RE-AUDIT |
| Monitoring/logging | Yandex Monitoring / Cloud Logging candidate | RE-AUDIT |

None of the RE-AUDIT or NOT_PROVEN rows above may be silently upgraded to a
settled contract without new evidence — either authoritative documentation
this record's audit did not find, or an execution-time validation performed in
a later, explicitly authorized slice.

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

BD-DOCS-047 explicitly blocks any OpenTofu remote-state bootstrap against
Yandex Object Storage until **both** of the following are proven. This record
performs neither validation.

> **Refined by [BD-DOCS-048](./backend-staging-yandex-remote-state-validation-plan.md).**
> BD-DOCS-048 is the docs-only research slice (01A) that turns the two
> `NOT_PROVEN` items below into an exact, execution-ready test/evidence/cleanup
> contract, and splits the still-future execution work into two disposable-
> resource-only slices (01B locking, 01C authentication). BD-DOCS-048 performs
> no validation itself and does not change either `NOT_PROVEN` verdict below —
> it narrows and sharpens the open questions research can resolve without
> touching a live system.

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

The only official Yandex documentation pattern found for this backend
authenticates with static `ACCESS_KEY`/`SECRET_KEY` environment variables —
the same static-long-lived-key pattern BD-DOCS-044/046 forbid for every other
staging identity. Yandex IAM Workload Identity Federation is documented for
Yandex's own control-plane API; nothing found confirms it also covers the
S3-compatible Object Storage data-plane surface that the state backend uses.

A later slice must prove either:

- a genuinely keyless / short-lived authentication path to the S3-compatible
  Object Storage data plane for OpenTofu state operations, **or**
- return to a human for an explicit, narrowly scoped decision to accept a
  static-key exception limited to the state-backend credential only, with
  rotation and least-privilege discipline comparable to BD-DOCS-046's own
  narrowed-role analysis.

No agent may make that exception autonomously. This record marks the
question **NOT_PROVEN** and leaves the choice for a human.

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
6. Remote-state authentication model (Remote-state stop gate, item B).
7. Remote-state locking validation owner and process (Remote-state stop gate,
   item A).
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
invent a Yandex Object Storage bootstrap procedure. A future Yandex
remote-state ADR is a separate, validation-backed slice, gated on closing both
items in "Remote-state stop gate" above.

## Alternatives considered

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Yandex Cloud, `ru-central1` | Only evaluated provider whose regions are documented as physically located in the Russian Federation; PostgreSQL 16, IAM-authenticated container runtime, digest-addressable registry, and keyless GitHub deployment auth are all evidenced | Remote-state locking and remote-state keyless auth are unproven; Serverless Containers' zero-traffic/gradual-promotion equivalence to Cloud Run is unproven; no confirmed Job-equivalent primitive | **Proposed**, with two NOT_PROVEN gates and three RE-AUDIT items |
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
- The two most security-sensitive open questions (remote-state locking,
  remote-state keyless auth) are named as blocking NOT_PROVEN items instead
  of being silently resolved by copying the GCS contract or the documented
  static-key tutorial pattern.

**Negative / trade-offs**

- No OpenTofu bootstrap can proceed until both remote-state stop-gate items
  are closed by a future, separately authorized validation slice.
- The exact Serverless Containers release/promotion mechanism and the
  migration-execution primitive remain open engineering questions, not just
  human-approval questions — closing them may require hands-on testing
  against Yandex Cloud, not just more documentation reading.
- BD-DOCS-044/046 now carry two audiences (historical GCP record, provider
  it was superseded by) that future readers must not conflate; the
  supersession notices exist specifically to prevent that.

**Follow-ups**

- A future slice must close "Remote-state stop gate" items A and B before
  any `tofu init` against a real Yandex Object Storage backend.
- A future slice must resolve the Serverless Containers release/promotion
  mechanism and the migration-execution primitive, ideally via a throwaway,
  non-production Yandex Cloud sandbox rather than documentation alone.
- A future Yandex remote-state bootstrap ADR, analogous in rigor to
  BD-DOCS-046, is a separate slice gated on the above.
- Issue #823 stays open until real staging deployment and rollback evidence
  meet its existing acceptance criteria, against whichever provider
  ultimately proves out.
