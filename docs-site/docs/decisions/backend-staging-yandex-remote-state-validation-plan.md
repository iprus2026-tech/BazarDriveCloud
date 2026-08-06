---
id: BD-DOCS-048
docType: decision-record
title: Yandex Object Storage remote-state validation — research and execution contract (01A)
owner: backend-ops-agent
status: draft
revision: 2026-08-06
effectiveFrom: 2026-08-06
reviewAfter: 2026-09-06
visibleFor: [developer, dispatcher, product, qa]
sourceOfTruth: docs-site
related:
  routes: []
  files:
    - docs-site/docs/decisions/backend-staging-provider-pivot-yandex-cloud.md
    - docs-site/docs/decisions/backend-staging-provider-and-iac.md
    - docs-site/docs/decisions/backend-staging-remote-state-bootstrap.md
    - infra/staging/README.md
  issues:
    - "#823"
  prs: []
tags: [decision-record, adr, backend, staging, iac, opentofu, remote-state, yandex-cloud, object-storage, validation-contract]
slug: /decisions/backend-staging-yandex-remote-state-validation-plan
---

# Yandex Object Storage remote-state validation — research and execution contract (01A)

> **Research contract only — `status: draft`. Creates no Yandex Cloud resource.**
> This record is **BD-STATE-VAL-01A**: the docs-only research slice that refines
> [BD-DOCS-047](./backend-staging-provider-pivot-yandex-cloud.md)'s "Remote-state
> stop gate" into an execution-ready contract. It creates no Yandex Cloud
> resource, folder, IAM identity, service account, Object Storage bucket, static
> or temporary key, OpenTofu state, or `.tf`/`.tofu` file. It runs no `tofu
> init`/`plan`/`apply` and authenticates to nothing. It does not resolve
> BD-DOCS-047's two `NOT_PROVEN` gates — it defines exactly what execution-backed
> proof would resolve them, and hands that definition to two future, separately
> authorized execution slices (**01B**, **01C**) that this record does not
> authorize to run.

## Context

BD-DOCS-047 pivoted staging to Yandex Cloud `ru-central1` and left two
remote-state questions marked `NOT_PROVEN`: Object Storage state **locking**,
and **keyless authentication** to the S3-compatible data plane. Its own text
frames both as one future "separately authorized slice" — which, read plainly,
invites a single oversized execution PR that mixes research, credential
handling, bucket creation, lock testing, authentication testing, and cleanup.
That shape makes failures hard to isolate and review, and is one paraphrase
away from an agent treating "validate remote state" as license to start
provisioning real staging infrastructure in the same session.

This record splits that single future slice into three: **01A** (this
document — research only, no cloud contact), **01B** (Object Storage
backend/locking validation, disposable-resource only), and **01C** (keyless
authentication validation, disposable-resource only). Locking and
authentication are split because they are different failure domains with
different risk profiles — authentication carries an explicit
"no autonomous long-lived-secret decision" gate (BD-DOCS-047, "Authentication")
that locking does not. Keeping them as separate slices — with 01C's
authentication outcome feeding into 01B rather than each slice inventing its
own ad hoc credential model (see "Recommended slice architecture going
forward" below) — means a stalled human call on credentials is resolved once,
by 01C, instead of being independently re-litigated by both.

`infra/staging/README.md` still describes the pre-pivot Google Cloud target
verbatim and has not been updated for the Yandex pivot. It is noted here as
stale context, not as a current contract; this record does not correct it —
that is a separate, docs-only follow-up for `docs-contract-agent`, out of
scope here.

This record does not touch, resolve, or reopen: PostgreSQL sizing, Serverless
Containers release mechanics, Lockbox runtime injection, monitoring/logging,
or any of BD-DOCS-047's already-settled items (region, `ALLOWED_ORIGIN`,
identity separation, secret-value boundary, synthetic-data-only rule).

## Repository state check

No OpenTofu version is pinned anywhere in this repository today: there is no
`.tf`/`.tofu` file, no `.terraform-version`/`.opentofu-version` file, and no CI
workflow step that installs or invokes `tofu`. `infra/staging/` contains only
`README.md`. This is itself a finding, not an oversight to silently fill in:
**the exact OpenTofu version is an open input**, not something this record or
a future execution slice may pick unilaterally. Everything below is therefore
recorded against the *current, unversioned* OpenTofu S3 backend implementation
as published upstream; a future slice must re-confirm each claim against
whichever exact version is eventually pinned, since backend behavior can change
between releases (see "S3 backend locking implementation" below).

## 1. OpenTofu S3 backend locking implementation

Read from OpenTofu's own backend source and its accepted RFC (not
Terraform/generic folklore), the S3 backend supports **two independent**
locking mechanisms:

| Mechanism | How it works | Backend config |
|---|---|---|
| **DynamoDB lock table** (legacy/default) | A conditional item write (`ConditionExpression: attribute_not_exists(LockID)`) into a separate DynamoDB-API table | `dynamodb_table` |
| **S3-native lockfile** (added OpenTofu 1.10, RFC `20250211-s3-locking-with-conditional-writes.md`) | A conditional `PutObject` with header `If-None-Match: *` writes a lock object in the *same* state bucket; if the object already exists the provider rejects the write and OpenTofu reports the state as locked. Unlock issues a plain `DeleteObject` on that lock key. | `use_lockfile = true` |

The RFC that introduced the native lockfile mechanism contains its own explicit
compatibility warning, quoted here because it is exactly this record's central
open question: *"When OpenTofu S3 backend is used with an S3 compatible
provider, it needs to be checked that the provider supports conditional writes
in the same way AWS S3 is offering."* OpenTofu does not certify third-party S3
implementations — each one must be individually confirmed.

**Status: `DOCUMENTED` (mechanism), `EXECUTION-DEPENDENT` (which mechanism this
repo will use)** — 01B must confirm the exact OpenTofu version pinned by a
future human/architecture decision actually includes `use_lockfile` (i.e. is
≥1.10) before assuming the native path is available; if an older version is
pinned, only the DynamoDB-table path exists and the corresponding Yandex
equivalent (see "YDB Document API locking" below) becomes the only option,
not a fallback.

### S3 API semantics locking depends on

The native lockfile path depends on the target object store honoring a
conditional `PutObject` with `If-None-Match: *` (reject with a precondition
failure if the key already exists) and a plain `DeleteObject`. Nothing more
exotic — no multipart-specific behavior, no versioning requirement — is
invoked by the lock/unlock path itself.

### Does Yandex document this?

**Yes — this refines BD-DOCS-047's "no locking mechanism found" finding.**
BD-DOCS-047 is correct that Yandex's own *Terraform/OpenTofu state-storage
tutorial* does not mention locking at all. But Yandex Object Storage's
**object/API reference documentation**, independent of that tutorial,
documents conditional writes as a stable, generally-available feature:

> "`If-Match`: the write will only be performed if an object already exists
> for the specified key and its current `ETag` matches... `If-None-Match`: the
> write will only be performed if there is no object with the same name in the
> bucket for the specified key,"

covering object uploads and multipart uploads, with documented response codes
(404/409/412) and no preview/beta disclaimer.

**Status: `PLAUSIBLE` (upgraded from BD-DOCS-047's `NOT_PROVEN` "no evidence
found" to "positive documented evidence found"), `REQUIRES_EXECUTION_VALIDATION`
for exact status-code parity.** Documentation confirming the header exists is
not the same as confirming OpenTofu's S3 backend — which inspects specific
error responses/status codes to decide "lock held" vs. "other failure" — parses
Yandex's precondition-failure response the same way it parses AWS's. That
exact-parity question is what 01B's locking test sequence (section 5 below)
exists to close.

**Preferred first validation candidate.** Of the two mechanisms in the table
above, the native Object Storage lockfile (`use_lockfile`) is the one 01B
should validate first: it has the smaller resource footprint (no second
managed service), and — unlike the YDB candidate below — Yandex documents the
exact conditional-write semantics it depends on directly on the object/API
reference. It remains `REQUIRES_EXECUTION_VALIDATION` until the exact
OpenTofu/Yandex behavior (status-code parity, section 5's test sequence) is
actually tested — documentation alone does not close this out.

### YDB Document API locking — documented fallback candidate

BD-DOCS-047 only evaluated the native-lockfile candidate. This pass replaces
the earlier reliance on third-party tutorials for the second candidate with
**Yandex's own official tutorial**, "Locking Terraform states using Managed
Service for YDB" (`cloud.yandex.com/en/docs/tutorials/infrastructure-management/terraform-state-lock`),
which pairs Object Storage (state) with Managed Service for YDB's
DynamoDB-compatible Document API (locking, via OpenTofu's `dynamodb_table`
backend argument) and documents the exact backend block
(`endpoints = { s3 = ..., dynamodb = ... }`, `dynamodb_table = ...`), the
required service-account roles (`storage.editor`, `ydb.admin`), and static
access keys as its authentication step.

That same official tutorial draws exactly the OpenTofu/Terraform distinction
this correction was asked to preserve: *"Starting with Terraform 1.11, state
locking via the Document API is deprecated and will be removed in a future
minor version,"* while *"for OpenTofu users, both locking mechanisms are
supported with no plans for removal."* Since BD-DOCS-047 already settled
OpenTofu (not Terraform) as this repository's IaC tool, this is direct
official evidence that both locking mechanisms remain live options here, not
just a general Terraform-ecosystem pattern.

This does not change either `NOT_PROVEN` verdict, and it does not become the
default validation path while the native lockfile candidate above remains
viable: using it would enlarge the disposable footprint by adding a
serverless YDB database/Document API table on top of the Object Storage
bucket, which is a bigger footprint than section 4's baseline and therefore
requires its own explicit authorization before 01B may use it — it stays a
documented fallback design, not an untested afterthought, and not a
co-default.

## 2. Authentication classification

BD-DOCS-047 frames the authentication question as "no keyless route found for
the state backend." Deeper reading during this research pass narrows and
partially revises that: Yandex Object Storage's S3 API itself supports more
than static keys, but the specific mechanism the OpenTofu S3 backend can
actually consume is narrower than what Yandex's data plane accepts in general.
**Distinguishing "Yandex IAM control-plane auth," "GitHub → Yandex Workload
Identity Federation," and "Object Storage's S3-compatible data-plane auth" as
three separate surfaces — per this record's mandate — is exactly what resolves
that apparent tension:**

| Method | Documentation status | Execution validation needed | Long-lived secret | Classification |
|---|---|---|---|---|
| Static S3 access key/secret (`YC...`/`YC...`, no expiry) | `DOCUMENTED` — Yandex's own IAM docs: "a static key has no expiration date" | No — behavior is known | **Yes** | `SUPPORTED` (technically works), but any *use* requires an explicit human exception per BD-DOCS-047 — never an autonomous default |
| Temporary/"ephemeral" access keys | `DOCUMENTED` to exist, but **derived from a static key** ("from a static key, you can create a temporary access key") — not from GitHub OIDC/WIF directly | Yes — exact API/CLI, TTL, and whether disabling static keys also disables these were not found in this pass | No (bounded TTL), but rooted in a static key at creation time | `NOT_PROVEN` — reduces blast radius of a leaked credential, does **not** eliminate the static-secret dependency at the root; not a genuine keyless bootstrap |
| Yandex IAM token (Yandex account / service account) | `DOCUMENTED` for the S3 API directly — passed as `Authorization: Bearer ${IAM_TOKEN}`, a **non-SigV4** auth mode; TTL ≤ 12h, refresh hourly recommended | Yes — see backend-compatibility gap below | No | `NOT_SUPPORTED` **for OpenTofu's stock S3 backend specifically**, `SUPPORTED` for the Object Storage S3 API in general — see next row |
| GitHub → Yandex Workload Identity Federation | `DOCUMENTED` for Yandex's own control-plane API only: the OIDC exchange "exchanges the JWT token for an IAM token of the Yandex Cloud service account," used for "the required Yandex Cloud API requests." No documentation found of this producing an AWS-SigV4-shaped credential (access key/secret/session token) for Object Storage. | Yes — this is the central open question | No | `NOT_PROVEN`, `REQUIRES_EXECUTION_VALIDATION` |
| Service-account IAM token (short-lived, minted from an SA key or WIF) | Same control-plane/data-plane distinction as above | Yes | No (but see below re: how it's minted) | `NOT_PROVEN` for the same reason |
| AWS-compatible credential-provider-chain / STS-equivalent (`assume_role_with_web_identity`) | **`DOCUMENTED` on the OpenTofu side**: the S3 backend supports `assume_role_with_web_identity { role_arn, web_identity_token_file }`, calling AWS STS's `AssumeRoleWithWebIdentity` API. **No documentation found that Yandex Cloud exposes an STS-compatible `AssumeRoleWithWebIdentity` endpoint.** Yandex's own WIF instead exchanges the OIDC token for a native Yandex IAM token via Yandex's own control-plane API — a structurally different mechanism, not an STS-compatible one. | Yes — confirm absence/presence of an STS-compatible endpoint definitively | No (if it existed) | `NOT_PROVEN`, leaning `NOT_SUPPORTED` pending confirmation |
| Metadata/workload-identity auto-injected credentials | Applies to code running *on* Yandex Compute/Serverless; GitHub Actions runners are external, so this surface does not apply to CI-driven `tofu` runs | Moot for this use case | No | `NOT_SUPPORTED` for the CI use case |

**The precise gap, stated once and not to be re-litigated as a vague
"unproven": OpenTofu's S3 backend is built on the AWS SDK, which authenticates
every request by SigV4-signing it with an access-key/secret-key/session-token
credential triple. Object Storage's S3 API separately accepts a raw
`Authorization: Bearer` IAM token as a non-SigV4 alternative — but that mode is
a property of the Yandex S3 endpoint, not something OpenTofu's stock S3
backend implementation is documented to send.** So a WIF-obtained Yandex IAM
token is usable against Object Storage by a client that implements Yandex's
Bearer-token scheme, but not — on current evidence — by OpenTofu's S3 backend
as shipped, which expects AWS-shaped credentials or a genuine
`AssumeRoleWithWebIdentity`-compatible endpoint, neither of which is confirmed
to exist on the Yandex side. This is 01C's exact reason for existing: confirm
or refute this gap experimentally (e.g. whether a custom `endpoints`/signing
override, a wrapper credential process, or an as-yet-undocumented Yandex STS
surface closes it) before concluding no keyless path exists.

**If 01C finds no keyless route, the resulting contract returns
`HUMAN_DECISION_REQUIRED` — it must not default to a static key.** No agent,
in 01C or any future slice, may accept a static/long-lived-key exception
autonomously; that decision is reserved for a human, per BD-DOCS-047.

**Correction note.** Section 1's locking evidence was strengthened in this
correction pass; this section's authentication classification is unchanged by
that improvement. Locking and authentication are independent technical
questions — stronger evidence that Yandex documents matching conditional-write
semantics says nothing about whether OpenTofu's S3 backend can authenticate
without a long-lived static key. Keyless OpenTofu backend authentication
remains `EXECUTION-DEPENDENT` / `NOT_PROVEN` unless and until authoritative
evidence proves a compatible credential path (section 8 below). No static-key
exception is approved here, or by any future agent acting alone; that remains
reserved for an explicit human decision per BD-DOCS-047.

## 3. Human decisions blocking 01B/01C

None of the following may be guessed, copied from the staging-environment
decisions, or silently chosen by a workflow. Items 1–2 are new — narrower and
smaller-stakes than BD-DOCS-047's staging-environment decisions of the same
shape — because a disposable validation footprint should not inherit the
staging folder/budget by default.

| # | Decision | Status |
|---|---|---|
| 1 | Dedicated **validation** Yandex folder, distinct from the staging folder BD-DOCS-047 item 2 still blocks | `HUMAN_DECISION_REQUIRED` |
| 2 | Validation-specific budget ceiling (smaller than BD-DOCS-047 item 4's staging budget) | `HUMAN_DECISION_REQUIRED` |
| 3 | Billing owner / cost-accountability contact | `HUMAN_DECISION_REQUIRED` (BD-DOCS-047 item 3, unresolved) |
| 4 | Confirm the disposable bucket is created within the Russian Yandex Cloud management boundary / `ru-central1` (inherits BD-DOCS-047's already-**DECIDED** region choice; not reopened here) | Execution check, not a new human decision — Yandex's own geo-scope documentation classifies Object Storage buckets as a **global** resource, not tied to an availability zone ("VMs and disks are zonal resources. Examples of global resources: cloud networks and buckets"). No `-a`/`-b`/`-d`/`-e` zone selection applies to a bucket. AZ remains relevant only to future *zonal* resources, if any are introduced in a separately authorized slice — this record does not reopen BD-DOCS-047's still-open staging AZ decision (its blocking input 1) |
| 5 | Naming prefix for disposable resources | Can be derived — recommend `bd-state-val-<yyyymmdd>-<random>`; 01B/01C must confirm no collision before creating anything |
| 6 | Disposable-resource creation approval (master gate — permission to create *any* real Yandex resource at all) | `HUMAN_DECISION_REQUIRED` |
| 7 | Human operator executing 01B/01C | `HUMAN_DECISION_REQUIRED` |
| 8 | Authentication method for the run (which row of section 2's matrix, or an explicit static-key exception) | `HUMAN_DECISION_REQUIRED` — never defaulted |
| 9 | IAM role bindings for the validation identity | Policy is settled (least-privilege, no `Owner`/`Editor`-equivalent, scoped to the one disposable bucket); exact Yandex role names are `EXECUTION-DEPENDENT`, to be confirmed at 01B/01C time, not invented here |
| 10 | Cleanup authority (who confirms teardown, mirroring BD-DOCS-046's bootstrap-identity precedent) | `HUMAN_DECISION_REQUIRED` |

## 4. Disposable-experiment design

Maximum footprint for 01B + 01C combined:

- One disposable Object Storage bucket for 01B (locking). 01C may reuse it or
  use a second disposable bucket if isolating authentication testing from
  locking testing proves cleaner — 01B/01C should decide based on whichever
  keeps failure attribution clearest.
- One validation identity (service account or equivalent), scoped only to that
  bucket's objects — never bucket-level `setIamPolicy`, never project-wide.
- A minimal inert OpenTofu root module whose only purpose is exercising the
  backend (a single trivial resource or none at all) — not a real
  infrastructure definition, and never a copy of any real staging module.
- A static test key **only if** decision #8 above explicitly approves one as a
  narrow, single-use, immediately-rotated exception for the run.

**Explicitly forbidden in 01B/01C, no exception:** Managed PostgreSQL,
Serverless Containers, Container Registry, Lockbox application secrets, any
application deployment, any production- or staging-named resource, real
personal data, PWA/API activation, any production/staging migration.

**Temporary `.tf`/`.tofu` files: recommend they live outside the repository**
(the operator's local scratch space or the CI job's ephemeral workspace),
never committed under `infra/staging/` or anywhere else in the repo. Nothing
in BD-DOCS-044/046/047 or `infra/staging/README.md` requires committing
validation-only Terraform/OpenTofu configuration, and `infra/staging/README.md`
itself currently states plainly that the directory holds documentation only.
01B/01C must not commit `.tf`/`.tofu` files unless a human decision explicitly
overrides this default.

## 5. `STATE_LOCKING_PROVEN` — exact PASS/FAIL contract

`tofu init` succeeding is **not** sufficient by itself — it only proves
connectivity to the bucket, not that locking works. `STATE_LOCKING_PROVEN` is
asserted only when **every** row below independently passes, run against
whichever locking mechanism (native lockfile or YDB-backed `dynamodb_table`,
section 1) 01B is authorized to test:

| Test | PASS | FAIL / escalate | Otherwise |
|---|---|---|---|
| Backend init | `tofu init` exits 0 against the disposable bucket | Non-zero exit, or silent fallback to local state | `NOT_PROVEN` |
| First state write | State object created and readable back | Write fails or object absent | `NOT_PROVEN` |
| Lock acquisition | A second operation observably blocks/is rejected while the first holds an open lock | Second operation proceeds concurrently | `NOT_PROVEN` |
| Concurrent-operation rejection | The blocked operation returns a clear lock-conflict error, not silent corruption | State object shows interleaved/corrupted writes | escalate immediately — treat as disproven, do not retry silently |
| Normal unlock | Lock releases automatically after a clean apply/destroy completes | Lock persists after clean completion | `NOT_PROVEN` |
| Repeated overwrite | A second, independent state write after the first succeeds cleanly | Overwrite fails or silently loses the previous version | `NOT_PROVEN` |
| Interrupted/stale lock | Killing the process mid-operation leaves the lock in a recoverable, documented state | Behavior unknown/unrecorded | `NOT_PROVEN` |
| Force-unlock | Succeeds under explicit, logged human approval; does not corrupt state | Silent/unlogged force-unlock, or corruption | `NOT_PROVEN` — force-unlock must never run without a logged human approval, mirroring BD-DOCS-046's precedent |

## 6. Cleanup contract

Mandatory, part of 01B/01C itself — not a follow-up task:

- Every created object, bucket, and lock is deleted before the slice reports
  complete.
- Any issued key/token is invalidated at the provider (not just discarded
  locally) immediately after use.
- Any IAM binding created for the validation identity is removed; the
  identity itself is deleted if it existed solely for this test.
- Any stale/held lock is explicitly resolved (normal unlock or logged
  force-unlock) — never left dangling.
- Any temporary local file (`.tf`, state, credentials) is removed from disk/CI
  workspace.
- Orphaned resources are actively checked for and reported, not assumed
  absent.
- A failed or incomplete cleanup returns `CLEANUP_BLOCKED` and is surfaced to
  a human — it is never silently written off.

## 7. Evidence contract

**Allowed** (sanitized only): tool versions (OpenTofu, provider), commit SHA,
timestamps, bucket identifier, endpoint URL, state object path, IAM role names
(not principal secrets), authentication method used, credential lifetime/TTL,
exit codes, sanitized error text, lock ID, object ETag/version, cleanup status
per resource.

**Forbidden, no exceptions:** access key secrets, tokens, private keys, session
cookies, database credentials, application secrets, or anything else that
would let a reader replay access.

## 8. Recommended slice architecture going forward

```
01A (this record, docs-only)
  -> HUMAN_DECISION_REQUIRED gate (section 3)
  -> 01C: keyless authentication validation (disposable-resource only)
  -> 01B: Object Storage backend / locking validation (disposable-resource only)
  -> evidence + cleanup (sections 6-7, executed as part of 01B/01C themselves)
  -> a future, separately authorized Yandex remote-state bootstrap ADR
     (not drafted by this record)
```

Both still require 01A complete and the section-3 gate cleared, but **01C now
precedes 01B** rather than running in either order: 01B should preferably run
using the credential model 01C already established, instead of minting a
static key merely to test locking. If 01C cannot prove a keyless
authentication path, execution stops for `HUMAN_DECISION_REQUIRED` (section 2)
before 01B is allowed to fall back to a static credential — 01B does not get
to independently request its own static-key exception just because it runs
second; the same human gate applies to whichever slice ends up needing a
credential decision. Both still feed a still-future Yandex remote-state
bootstrap ADR, analogous in rigor to the now-deferred BD-DOCS-046, which this
record does not draft.

## Issue #823

Issue #823 remains **open** and is unaffected by this record. Remote-state
validation — research or execution — satisfies none of its acceptance items
(fresh staging deploy reaching `/api/v1/health`/`/api/v1/readyz`, ordered
migrations, no committed/logged credential material, a rehearsed rollback,
green server-ci/deployment checks). This record checks off nothing on #823.

## Consequences

**Positive**

- BD-DOCS-047's two `NOT_PROVEN` gates now have an exact, execution-ready test
  definition instead of a general "prove it later" instruction.
- The locking finding is meaningfully upgraded from "no evidence found" to
  "positive documented evidence found, execution needed to close exact
  status-code parity" — a materially different and less pessimistic starting
  point for 01B.
- The authentication finding is sharpened from a blanket "not proven" into a
  precise architectural gap (AWS-SigV4-based backend vs. Yandex Bearer-token/
  control-plane-only WIF) that 01C can test directly instead of exploring
  blindly.
- A second, previously unevaluated locking candidate (YDB DynamoDB-compatible
  mode) is now on record rather than discovered mid-execution.
- Splitting 01A/01B/01C keeps each slice's blast radius and review surface
  small, and resolves the authentication credential decision exactly once
  (in 01C) instead of letting 01B re-litigate it or improvise its own static
  key merely to test locking.

**Negative / trade-offs**

- Every claim in this record beyond direct primary-source quotes is bounded by
  what public documentation states; several rows are explicitly
  `REQUIRES_EXECUTION_VALIDATION` and could still fail differently than
  research predicts once 01B/01C actually run.
- The OpenTofu-version gap (none pinned in-repo) means this record's OpenTofu-
  side claims must be re-confirmed against whichever version a future decision
  pins, not assumed to hold indefinitely.
- No `STATE_LOCKING_PROVEN` or authentication verdict exists yet — bootstrap
  remains blocked exactly as BD-DOCS-047 already states.

**Follow-ups**

- A future execution slice (01B) must run the section 5 test sequence against
  a disposable bucket once the section 3 human decisions are resolved.
- A future execution slice (01C) must resolve the authentication gap in
  section 2, particularly whether any Yandex-side mechanism can supply
  OpenTofu's S3 backend with AWS-shaped or `assume_role_with_web_identity`-
  compatible credentials without a long-lived static key.
- `infra/staging/README.md`'s stale Google Cloud narrative should be
  refreshed to match BD-DOCS-047 in a separate, docs-only follow-up — not part
  of this record's scope.
- A future Yandex remote-state bootstrap ADR, analogous in rigor to the
  deferred BD-DOCS-046, remains a separate slice gated on 01B and 01C both
  closing.
- Issue #823 stays open until real staging deployment and rollback evidence
  meet its existing acceptance criteria.
