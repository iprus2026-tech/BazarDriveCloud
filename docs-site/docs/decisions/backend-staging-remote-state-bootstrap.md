---
id: BD-DOCS-046
docType: decision-record
title: Backend staging OpenTofu remote-state bootstrap contract — Decision Record
owner: backend-ops-agent
status: draft
revision: 2026-08-05
effectiveFrom: 2026-08-04
reviewAfter: 2026-09-04
visibleFor: [developer, dispatcher, product, qa]
sourceOfTruth: docs-site
related:
  routes:
    - /api/v1/health
    - /api/v1/readyz
  files:
    - docs-site/docs/decisions/backend-staging-provider-and-iac.md
    - docs-site/docs/processes/backend-staging-container-runbook.md
  issues:
    - "#823"
  prs: []
tags: [decision-record, adr, backend, staging, iac, opentofu, remote-state, terraform]
slug: /decisions/backend-staging-remote-state-bootstrap
---

# Backend staging OpenTofu remote-state bootstrap contract — Decision Record

> **Proposed contract only — `status: draft`.** This record proposes the
> OpenTofu remote-state bootstrap model for the staging environment defined in
> [BD-DOCS-044](./backend-staging-provider-and-iac.md). It creates no Google
> Cloud project, bucket, IAM binding, service account, database, or any
> other billable or externally reachable resource. Applying infrastructure
> requires a separately approved slice after every blocking input in this
> record and in BD-DOCS-044 is explicitly confirmed by a human.

## Context

BD-DOCS-044 (blocking input 7) requires an approved remote-state bootstrap
contract before OpenTofu can manage any staging resource. OpenTofu — like
Terraform — needs a pre-existing backend to store and lock its state. That
backend cannot itself be managed by the same OpenTofu root module that depends
on it; it must be created once, out-of-band, before any `tofu apply` runs. This
one-time creation step is the **bootstrap sequence**.

Without a decided bootstrap contract, the order of operations for staging
provisioning is undefined. A missing, insecure, or shared state backend would
make it impossible to safely replay, audit, or roll back infrastructure changes,
and could allow concurrent applies to corrupt state.

This record proposes the model. It does not resolve the blocking inputs listed
at the end of the document, which must be confirmed by a human before any
resource is created.

## Decision

### Remote-state backend model

| Concern | Proposed choice | Rationale |
|---|---|---|
| Backend type | **Google Cloud Storage (GCS) bucket** | Native to GCP; supports object versioning and bucket-level IAM; no additional managed service required. |
| Bucket scope | **Dedicated staging-state bucket** | One bucket per environment boundary (staging); never shared with production or other environments. |
| Bucket name scheme | `<project-id>-tofu-state-staging` (exact value depends on the confirmed project ID — see blocking inputs) | Human-readable; ties the bucket unambiguously to the project and environment. |
| State file path | `staging/terraform.tfstate` within the dedicated bucket | Namespaced within the bucket to allow future per-component or per-module sub-paths without bucket churn. |
| Locking mechanism | **GCS object lock / native GCS conditional writes** | GCS backend in OpenTofu uses native GCS locking via conditional writes; no external lock table is required. |
| Versioning | **Enabled** on the state bucket | Every state transition is retained as a non-current object version, enabling point-in-time recovery. |
| Retention / lifecycle | Object versioning retained for a minimum period (duration TBD pending budget/sizing confirmation — see blocking inputs); noncurrent versions expire after that window | Limits unbounded storage growth while retaining enough history for audit and rollback. |
| Encryption | **Google-managed encryption (GMEK) at rest** | Default for GCS; Customer-managed keys (CMEK) are a future option and require a separate key management decision not made here. |
| Public access | **Uniformly private** — public access prevention enabled on the bucket | State files contain infrastructure topology and must never be publicly readable. |
| Bucket location | **Blocked** — must match the confirmed GCP region from BD-DOCS-044 blocking input 1 | Location is not guessed or defaulted. |

### Locking mechanism detail

OpenTofu's GCS backend acquires a lock by writing a `.tflock` object and using
GCS [conditional writes](https://cloud.google.com/storage/docs/request-preconditions)
(`If-None-Match: *`) to prevent two concurrent applies from writing the same
lock object. The lock is released after `apply` or `destroy` completes or is
interrupted. If a process is interrupted without releasing the lock, an operator
with the appropriate IAM permission can force-unlock via `tofu force-unlock
<lock-id>`. Force-unlock must require an explicit human approval and must be
logged.

**`storage.objects.delete` is required for locking, not optional.** Per the
OpenTofu GCS backend's own implementation, `Unlock()` — including
`force-unlock` — issues a `Delete()` call on the `.tflock` object using a
generation-match precondition; this fails without delete permission on that
object. Sources: [OpenTofu GCS backend source
(`client.go`)](https://github.com/opentofu/opentofu/blob/main/internal/backend/remote-state/gcs/client.go).

### Access boundaries — who may run apply

| Identity | Allowed operations | Notes |
|---|---|---|
| **Bootstrap identity** (human operator, one-time) | Create the GCS state bucket and set its IAM policy; grant the deployment identity read/write on the bucket | Used only during the bootstrap sequence; must not be a shared or service account; must require MFA; must not persist as a standing service account. |
| **Deployment identity** (GitHub Actions OIDC Workload Identity — see "Deployment identity scope" note below) | `storage.objects.get`, `storage.objects.create`, `storage.objects.delete`, `storage.objects.list` on the state bucket (exact role per "Role selection" below) | Required for OpenTofu `plan`/`apply`. `storage.objects.delete` is **not optional**: the GCS backend deletes the `.tflock` object on every unlock, and per the [Google Cloud Storage `objects.insert` API](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/insert), overwriting an object that already exists — exactly what every state write after the first one does — also requires delete permission on the object being replaced. Scoped to the staging project only; no broader GCP permissions. Bucket-level `storage.buckets.setIamPolicy` is forbidden under either role choice below. Object-level `storage.objects.setIamPolicy`/`getIamPolicy` comes bundled with the official `roles/storage.objectAdmin` baseline and cannot be withheld while granting that role — it is excluded only if the narrowed candidate role is validated and adopted instead (see "Role selection"). |
| **Read-only audit identity** | `storage.objects.get`, `storage.objects.list` on the state bucket | For post-apply audit inspection; cannot modify state or lock. |
| **No other identity** | — | No wildcard or project-wide bindings; no allUsers; no production identity binding. |

Identity names, email addresses, and exact IAM role/binding strings are
**blocking inputs** (see below) and must not be guessed or substituted with
placeholders that could be mistaken for real values.

**Deployment identity scope — unresolved.** Whether this "Deployment
identity" is the same GitHub Actions OIDC principal as BD-DOCS-044's
"Deployment identity" (used to publish images and deploy Cloud Run
resources) with an added permission grant, or a separate principal
dedicated only to OpenTofu state operations, is **not decided by this
record or by BD-DOCS-044** and is a human blocking decision (see
"Unresolved / blocking inputs" below). Either choice can satisfy the
least-privilege scoping above, provided the identity never gains runtime
database access or application-secret access (BD-DOCS-044's identity
separation rule).

### Role selection — official baseline vs. least-privilege narrowing

**A. Official OpenTofu baseline.** The [official OpenTofu GCS backend
documentation](https://opentofu.org/docs/language/settings/backends/gcs/)
states that credentials "must have the Storage Object Admin role on the
bucket" (`roles/storage.objectAdmin`). This is the documented, supported
baseline and the safe default if no narrower role has been validated.
**Choosing this baseline means accepting the full bundle of permissions
`roles/storage.objectAdmin` carries — including object-level
`storage.objects.getIamPolicy`/`storage.objects.setIamPolicy` — as a
package.** A predefined role cannot be granted while withholding one of its
included permissions; there is no configuration in which the deployment
identity holds `roles/storage.objectAdmin` but lacks object-level
`setIamPolicy`. Bucket-level `storage.buckets.setIamPolicy` is not part of
`roles/storage.objectAdmin` and remains forbidden regardless of which option
is chosen.

**B. Least-privilege narrowing — PROPOSED, requires execution validation.**
A narrower role — `roles/storage.objectUser`, or an equivalent custom role
limited to `storage.objects.get`, `storage.objects.create`,
`storage.objects.delete`, `storage.objects.list` — is a **candidate** for
tighter scoping, and is the *only* path by which the deployment identity can
avoid holding object-level `setIamPolicy`/`getIamPolicy`. **This narrower
set is not officially guaranteed sufficient by OpenTofu's documentation** —
OpenTofu's own docs recommend the broader `roles/storage.objectAdmin` and do
not publish a minimal permission list. The set above is derived from reading
the backend's source implementation and Google's documented
object-overwrite/delete semantics, not from an OpenTofu-published
minimal-permissions guarantee, and must not be presented as an
OpenTofu-endorsed minimum.

Neither option requires `storage.buckets.get`: OpenTofu's GCS backend
`configure()` step calls `storage.NewClient(ctx, opts...)` and does not call
any bucket-level API (no `bucket.Attrs(ctx)` or equivalent), and
`storage.buckets.get` is not included in either `roles/storage.objectAdmin`
or `roles/storage.objectUser` in any case. It is not part of the required
permission set for the deployment identity under either option. Source:
[OpenTofu GCS backend `configure()`
(`backend.go`)](https://github.com/opentofu/opentofu/blob/main/internal/backend/remote-state/gcs/backend.go).

Until validated (see "Validation gate for a narrowed role" below), option A
is the accepted default; option B remains a proposal under review.

### Validation gate for a narrowed role

Before any narrowed role (option B above) is accepted as the production or
staging IAM contract, a later, separately authorized infrastructure slice
must execute against a real (non-production, throwaway-acceptable) GCS
bucket and prove all of the following succeed under the narrowed permission
set alone:

1. `tofu init` succeeds against the bucket.
2. The first state object is created successfully.
3. Lock acquisition succeeds.
4. Normal unlock (after a successful apply) succeeds.
5. A second state write/overwrite (state object already exists) succeeds.
6. A repeated plan/apply/unlock cycle succeeds at least twice in a row.
7. `force-unlock` behavior is exercised and understood in a safe,
   non-production context (e.g. deliberately simulating an interrupted
   lock).

This record does not perform or authorize that validation — it only
establishes what must be proven before a narrowed role can replace the
official `objectAdmin` baseline. No `tofu init`/`plan`/`apply` and no GCP
resource creation belong to this record.

### Bootstrap sequence

The bootstrap sequence is a one-time, human-executed procedure that creates the
state backend before OpenTofu can manage anything else. It must be completed
before any `tofu init` or `tofu apply` targeting staging resources.

**Preconditions**

- Every blocking input in this record and in BD-DOCS-044 has been explicitly
  confirmed in writing by a human.
- The GCP project exists and billing is active.
- The bootstrap identity is authenticated with MFA and has the minimum IAM
  permissions to create a GCS bucket and set its IAM policy.
- No existing state bucket exists for this project/environment combination.

**Steps (in order)**

1. Confirm the confirmed GCP project ID and region from the approved blocking
   inputs.
2. Using `gcloud storage buckets create` (or equivalent gcloud CLI command):
   - create the bucket `<project-id>-tofu-state-staging`;
   - set location to the confirmed region;
   - enable versioning (`--versioning`);
   - enable uniform bucket-level access (`--uniform-bucket-level-access`);
   - enable public access prevention (`--public-access-prevention=enforced`).
3. Apply the minimum IAM bindings on the bucket, per "Role selection" above:
   - grant the deployment identity `roles/storage.objectAdmin` (official
     baseline) — or, only after the "Validation gate for a narrowed role" has
     been passed, `roles/storage.objectUser` or an equivalent custom role
     covering `storage.objects.get`, `storage.objects.create`,
     `storage.objects.delete`, `storage.objects.list` — on the bucket. Do not
     omit `storage.objects.delete`: it is required for lock release and for
     overwriting state after the first write, not a permission to withhold;
   - grant the read-only audit identity `roles/storage.objectViewer` on the
     bucket;
   - do not grant any binding to `allUsers` or `allAuthenticatedUsers`; do not
     grant bucket-level `storage.buckets.setIamPolicy` to the deployment
     identity under either role choice. If the narrowed candidate role
     (option B) is used, it must also exclude object-level
     `storage.objects.setIamPolicy`/`getIamPolicy`. If the official baseline
     (`roles/storage.objectAdmin`) is used instead, object-level
     `setIamPolicy`/`getIamPolicy` comes bundled with that role and cannot be
     selectively withheld — do not claim otherwise when recording the grant.
4. Record the bucket name, versioning status, IAM bindings, and the executing
   identity in the deployment evidence log without including any secret values.
5. Run `tofu init` against the new backend to verify the backend is reachable
   and the lock mechanism works (`-backend-config` pointing at the confirmed
   bucket).
6. Confirm the state file is created and the lock is released cleanly before
   proceeding to any resource provisioning.

**Post-bootstrap verification**

- `gcloud storage buckets describe gs://<project-id>-tofu-state-staging`
  returns versioning: enabled, uniform access: true, public access prevention:
  enforced.
- `tofu init` exits 0 and reports the GCS backend is initialized.
- The lock object `.tflock` does not persist after `tofu init` completes.

### Rollback of the state backend itself

The state bucket is not managed by OpenTofu (it is the backend for OpenTofu).
It can only be rolled back manually:

- If a state object is corrupted, restore the previous version from GCS object
  versioning: `gcloud storage objects copy gs://<bucket>/staging/terraform.tfstate#<version>
  gs://<bucket>/staging/terraform.tfstate`.
- If the bucket must be destroyed, all managed resources must be destroyed or
  manually removed from state first; then the bucket may be deleted by the
  bootstrap identity.
- Deletion of the state bucket without prior resource cleanup is forbidden
  without an explicit incident procedure.

## Unresolved / blocking inputs

The following values are **not decided** in this record and must be confirmed by
a human before any bootstrap step is executed:

1. **GCP project ID** — which project hosts the staging state bucket (from
   BD-DOCS-044 blocking input 2).
2. **GCP region** — where the state bucket is located (from BD-DOCS-044
   blocking input 1); must be confirmed alongside data-location rationale.
3. **Billing owner and monthly budget** — cost of versioned GCS storage and
   operations must be within the approved staging budget (BD-DOCS-044
   blocking inputs 3 and 4).
4. **Versioning retention window** — the minimum and maximum retention period
   for noncurrent state versions; depends on the billing/budget decision.
5. **Bootstrap identity** — which human operator or break-glass account performs
   the one-time bucket creation; exact IAM role(s) required (BD-DOCS-044
   blocking input 6).
6. **Deployment identity** — the Workload Identity pool/provider and service
   account that GitHub Actions will impersonate for `tofu apply` (BD-DOCS-044
   blocking input 6). **Also unresolved:** whether this is the same principal
   as BD-DOCS-044's "Deployment identity" (used for Cloud Run/Artifact
   Registry deployment) with an added permission grant, or a separate
   principal dedicated only to OpenTofu state operations — see "Deployment
   identity scope" above. Neither this record nor BD-DOCS-044 states an
   answer; it must be confirmed by a human before the bootstrap sequence is
   executed.
7. **Read-only audit identity** — which identity or group receives read-only
   access to the state bucket for post-apply inspection (BD-DOCS-044
   blocking input 6).
8. **Encryption choice** — whether GMEK (proposed default) is approved or
   whether CMEK is required; CMEK requires a separate key management decision.

None of these values may be guessed, copied from production, or silently chosen
by any agent or workflow.

Separately — and orthogonal to the 8 items above — this record's own **IAM
role choice** for the deployment identity (official `roles/storage.objectAdmin`
baseline vs. a narrowed custom role) is not yet settled either; see "Role
selection" and "Validation gate for a narrowed role" above. That choice does
not require new external inputs (region, project, billing, etc.), but it does
require the execution-time validation described there before a narrowed role
can be adopted.

## Out of scope

The following are **explicitly out of scope** for this record:

- GCP region selection and data-location rationale (BD-DOCS-044 blocking input 1).
- GCP project ID and project ownership (BD-DOCS-044 blocking input 2).
- Billing owner and cost-accountability contact (BD-DOCS-044 blocking input 3).
- Monthly staging budget and alert thresholds (BD-DOCS-044 blocking input 4).
- Exact non-wildcard `ALLOWED_ORIGIN` for CORS (BD-DOCS-044 blocking input 5).
- IAM bindings for runtime (Cloud Run), migration job, and read-only audit
  identities beyond what is described at the bootstrap boundary above
  (BD-DOCS-044 blocking input 6, full detail).
- Cloud SQL sizing, storage, backup/PITR and network-access policy
  (BD-DOCS-044 blocking input 8).
- OpenTofu module structure, variable files, workspace strategy, or
  per-resource configuration.
- PWA activation, Mapbox, payments, Redis presence, or microservice extraction.
- Production data, personal data, or any data residency/localization decision.

## Alternatives considered

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **GCS bucket (dedicated, versioned)** | Native to GCP; no extra service; GCS object versioning enables state history recovery; bucket-level IAM is explicit | Bucket is not managed by OpenTofu itself; bootstrap must be manual | **Proposed** |
| Terraform Cloud / HCP Terraform remote backend | Centralized state and lock UI; plan history in one place | Adds an external SaaS dependency outside GCP; credential model differs; cost and access control require separate approval | Rejected for this slice |
| GCS bucket (shared with production) | One bucket; simpler setup | Staging and production state in the same bucket creates blast radius risk; staging IAM could affect production state | Rejected — strict environment isolation required |
| Local state (no remote backend) | Zero setup | Cannot be shared between CI and operators; no lock; state lost if runner is ephemeral; incompatible with the CI/CD gate model in BD-DOCS-044 | Rejected |
| PostgreSQL-backed state (pg backend) | Familiar to the team; reuses Cloud SQL | Cloud SQL does not exist until after bootstrap; circular dependency; operational overhead | Rejected — bootstrap circular dependency |

## Consequences

**Positive**

- The bootstrap contract is reviewable and human-confirmed before any billable
  resource is created.
- GCS versioning provides a recovery path for corrupted or accidentally
  overwritten state without a separate backup system.
- Strict IAM boundaries at the bucket level limit blast radius; no
  project-wide bindings are introduced.
- The bootstrap sequence is explicit and reproducible; a human can rehearse
  it against a throwaway project before applying to staging.
- Rollback of state itself (separate from rollback of managed resources) is
  documented.

**Negative / trade-offs**

- The state bucket must be created before any `tofu init` can run; if it is
  accidentally deleted, all OpenTofu-managed resource records are lost even
  though the resources still exist in GCP.
- The deployment identity necessarily holds `storage.objects.delete` on the
  state bucket's objects — required for lock release and for overwriting
  state after the first write (see "Locking mechanism detail" and "Role
  selection" above), not avoidable by a stricter role. If the official
  `roles/storage.objectAdmin` baseline is used, the deployment identity also
  necessarily holds object-level `storage.objects.setIamPolicy`/
  `getIamPolicy` as part of that bundled role — avoidable only by adopting
  the narrowed candidate role (option B in "Role selection") after it passes
  the validation gate. The mitigation available under either option is
  scoping all grants to only this bucket (never project-wide), never granting
  bucket-level `storage.buckets.setIamPolicy` or `storage.buckets.delete` to
  the deployment identity, and relying on the already-enabled GCS object
  versioning to recover from an accidental or malicious delete/overwrite
  rather than trying to withhold object-level delete outright.
- GCS versioning retention adds storage cost; retention window must be
  explicitly budgeted.
- GMEK (proposed default encryption) does not provide customer control over
  key rotation or revocation; CMEK is a future option requiring a separate
  key management decision.

**Follow-ups**

- BD-DOCS-044 blocking inputs 1–6 and 8 must be confirmed before the bootstrap
  sequence can be executed.
- Once inputs are confirmed, this record should move from `status: draft` to
  `status: accepted` and a separate implementation slice should be opened for
  the bootstrap execution.
- A subsequent slice should cover the full OpenTofu module structure, variable
  management, and per-resource configuration for staging.
- Issue #823 stays open until real staging deployment and rollback evidence
  meet its acceptance criteria.
