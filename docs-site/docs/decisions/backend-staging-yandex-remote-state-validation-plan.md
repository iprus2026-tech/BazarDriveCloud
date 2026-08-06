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

> **Correction pass — authentication candidate set expanded (same-day,
> 2026-08-06).** Current official Yandex documentation, re-checked against this
> record's original research snapshot, adds two authentication mechanisms the
> first pass did not evaluate: a CLI-issued **ephemeral access key**
> (`yc iam access-key issue-ephemeral`, added in Yandex Cloud CLI 0.181.0,
> 2025-12-11) governed by the `iam.serviceAccounts.ephemeralAccessKeyAdmin`
> role, and a separately documented **STS temporary key** (`aws sts
> assume-role` against Yandex's STS endpoint, `duration-seconds` capped at
> 43200/12h). Section 2 below is corrected accordingly. Neither addition
> changes either `NOT_PROVEN` verdict, and neither is execution-validated by
> this pass — this remains a documentation-only correction, exactly as strict
> about no cloud contact as the record it corrects.
>
> **Correction pass 2 — ephemeral-key shape, TTL, and `credential_process`
> confirmed (same-day, 2026-08-06).** The pass above left the ephemeral
> access key's exact output shape and TTL `REQUIRES_EXECUTION_VALIDATION` for
> lack of a confirmable source. This pass independently fetched the canonical
> `yandex-cloud/docs` source (the site `yandex.cloud` is built from) and
> confirms: a three-part credential shape (`access_key_id`/`secret`/
> `session_token`/`expires_at`), a `15m`–`12h` TTL range, and an official
> `credential_process` integration tutorial — see section 2's "Sourcing note."
> These are now `DOCUMENTED`. What remains `REQUIRES_EXECUTION_VALIDATION` is
> narrower and unchanged in kind: whether a WIF-derived IAM token can call
> `issue-ephemeral` with no static key upstream, and whether the full chain
> authenticates against OpenTofu's S3 backend end to end. Still no
> `KEYLESS_BACKEND_AUTH_PROVEN`, still no cloud contact, still no static-key
> exception.

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
the state backend." Deeper reading during the original research pass narrowed
and partially revised that: Yandex Object Storage's S3 API itself supports
more than static keys, but the specific mechanism the OpenTofu S3 backend can
actually consume is narrower than what Yandex's data plane accepts in general.
**Distinguishing "Yandex IAM control-plane auth," "GitHub → Yandex Workload
Identity Federation," and "Object Storage's S3-compatible data-plane auth" as
three separate surfaces — per this record's mandate — is exactly what resolves
that apparent tension:**

This correction pass adds two rows the original pass did not evaluate — a
CLI-issued **ephemeral access key** and a separately documented **STS
temporary key** — and splits them apart because current official documentation
shows they are two different mechanisms with two different credential shapes,
not one generic "temporary key" concept:

| Method | Documentation status | Execution validation needed | Long-lived secret | Classification |
|---|---|---|---|---|
| Static S3 access key/secret (`YC...`/`YC...`, no expiry) | `DOCUMENTED` — Yandex's own IAM docs: "a static key has no expiration date" | No — behavior is known | **Yes** | `SUPPORTED` (technically works), but any *use* requires an explicit human exception per BD-DOCS-047 — never an autonomous default |
| **Ephemeral access key** (`yc iam access-key issue-ephemeral`, Yandex Cloud CLI ≥0.181.0) | `DOCUMENTED`. Confirmed against the canonical Yandex documentation source (`yandex-cloud/docs`, files `en/_includes/iam/manage-ephemeral-keys.md` and `en/_includes/iam/ephemeral-keys.md`, mirroring the published `yandex.cloud/en/docs/iam/operations/authentication/manage-ephemeral-keys` and `.../concepts/authorization/ephemeral-keys` pages): output is a genuine **three-part** AWS-shaped credential — `access_key_id`, `secret`, `session_token`, `expires_at` — not the two-part static-key shape this record previously assumed. `--duration` accepts `15m` to `12h`; if omitted, "the key lifespan will be limited to that of the current session's IAM token." Requires the `iam.serviceAccounts.ephemeralAccessKeyAdmin` role "or higher for the folder." **Not resolved by documentation:** whether the *caller* invoking `issue-ephemeral` can authenticate with only a WIF-derived IAM token and no static key/service-account key anywhere upstream — the tutorial evidence found creates a service account and issues a key for it, but does not document what identity is running the `yc` CLI itself | Only the caller-authentication step (WIF → `issue-ephemeral`, with zero static key anywhere in the chain) and end-to-end OpenTofu consumption remain unverified — the credential shape, TTL, and role are settled | The *issued* credential is bounded-TTL and (per documentation) **cannot be individually revoked** — it expires automatically; whether the *issuing call* requires no static key anywhere upstream is unconfirmed | Mechanism/shape/TTL/role: `DOCUMENTED`. Full WIF→issuance→OpenTofu chain: `REQUIRES_EXECUTION_VALIDATION` — **not** `KEYLESS_BACKEND_AUTH_PROVEN` |
| **AWS `credential_process` integration for the ephemeral key** | `DOCUMENTED` — an official Yandex tutorial (`yandex-cloud/docs`, `en/_tutorials/security/ephemeral-key-storage.md`, mirroring `yandex.cloud/en/docs/storage/operations/buckets/manage-ephemeral-keys`) issues a key via `yc iam access-key issue-ephemeral --subject-id <sa_id> --session-name ephemeral-sa-1 --jq '{Version: 1, AccessKeyId: .access_key_id, SecretAccessKey: .secret, SessionToken: .session_token, ExpiresAt: .expires_at}'` and wires it into an AWS CLI profile via `credential_process = <file_path>`. This is an **officially documented integration candidate, not a hypothetical custom shim** — Yandex ships the exact `--jq` transform and AWS CLI profile shape | Yes — this shows the credential *reaching* an AWS-SDK-consuming client via a supported mechanism, but the tutorial's `yc` CLI session itself is not shown to be WIF-derived | No new dependency beyond the ephemeral key above | `DOCUMENTED_CANDIDATE` for the credential_process mechanism itself; the full WIF-sourced chain remains `REQUIRES_EXECUTION_VALIDATION` |
| **STS temporary key** (`aws sts assume-role` against Yandex's STS endpoint) | `DOCUMENTED` — official tutorial: `--duration-seconds` "cannot exceed 43200" (12h); response shape is the full AWS triple (`AccessKeyId`/`SecretAccessKey`/`SessionToken`/`Expiration`), matching what OpenTofu's S3 backend expects | Yes — but the same tutorial's own documented workflow assumes the caller **already has a static access key** created in a prior step before calling `assume-role`; no path from an IAM token or WIF-derived credential to this call was found | Rooted in a static key at the point of *calling* `assume-role`, even though the *returned* credential is short-lived | `NOT_PROVEN`, leaning **not a genuine keyless bootstrap** — reduces exposure of the long-lived key (it need not be reused directly for signing), but does not eliminate the static-secret dependency at the root |
| Yandex IAM token (Yandex account / service account) | `DOCUMENTED` for the S3 API directly — passed as `Authorization: Bearer ${IAM_TOKEN}`, a **non-SigV4** auth mode; TTL ≤ 12h, refresh hourly recommended | Yes — see backend-compatibility gap below | No | `NOT_SUPPORTED` **for OpenTofu's stock S3 backend specifically**, `SUPPORTED` for the Object Storage S3 API in general — see next row |
| GitHub → Yandex Workload Identity Federation | `DOCUMENTED` for Yandex's own control-plane API only: the OIDC exchange "exchanges the JWT token for an IAM token of the Yandex Cloud service account," used for "the required Yandex Cloud API requests." No documentation found of this producing an AWS-SigV4-shaped credential (access key/secret/session token) for Object Storage directly. `issue-ephemeral` is itself a Yandex Cloud control-plane API call (like other `yc iam` operations), so it remains plausible that a WIF-derived IAM token holding `iam.serviceAccounts.ephemeralAccessKeyAdmin` could call it directly — but no documentation confirms this, and this record does not assume it | Yes — the central open question, unchanged by this correction: "can a WIF-derived IAM token call `issue-ephemeral` without a pre-existing static key?" | No | `NOT_PROVEN`, `REQUIRES_EXECUTION_VALIDATION` |
| Service-account IAM token (short-lived, minted from an SA key or WIF) | Same control-plane/data-plane distinction as above | Yes | No (but see below re: how it's minted) | `NOT_PROVEN` for the same reason |
| AWS-compatible credential-provider-chain / STS-equivalent (`assume_role_with_web_identity`) | **`DOCUMENTED` on the OpenTofu side**, re-confirmed against current OpenTofu S3 backend documentation: the backend supports `assume_role_with_web_identity { role_arn, web_identity_token / web_identity_token_file }`, calling AWS STS's `AssumeRoleWithWebIdentity` API, and its `endpoints` block can override `sts` to a non-AWS endpoint. **No documentation found that Yandex's STS endpoint implements the `AssumeRoleWithWebIdentity` action** — Yandex's own documented STS operation is plain `assume-role`, which (per the row above) itself requires a pre-existing static key to invoke. Yandex's WIF instead exchanges the OIDC token for a native Yandex IAM token via Yandex's own control-plane API — a structurally different mechanism, not an STS-compatible one. This row is now the *less* promising of the two OpenTofu-side integration paths — see the `credential_process` row above, which does not depend on Yandex implementing any AWS STS action at all | Yes — confirm absence/presence of an `AssumeRoleWithWebIdentity`-equivalent action definitively | No (if it existed) | `NOT_PROVEN`, leaning `NOT_SUPPORTED` — this correction pass found additional negative evidence (the documented `assume-role` workflow's static-key prerequisite) but no positive evidence changing the original verdict |
| Metadata/workload-identity auto-injected credentials | Applies to code running *on* Yandex Compute/Serverless; GitHub Actions runners are external, so this surface does not apply to CI-driven `tofu` runs | Moot for this use case | No | `NOT_SUPPORTED` for the CI use case |

**Sourcing note for this correction.** Direct fetches to `yandex.cloud` pages
continue to return HTTP 403 in this environment (upstream bot-protection, not
a documentation gap). The facts above were independently confirmed by fetching
the canonical `yandex-cloud/docs` GitHub source that the `yandex.cloud` site is
built from (file paths cited inline above) — not merely accepted from an
operator-supplied excerpt. The operator separately supplied matching excerpts
citing the live `yandex.cloud` URLs; those excerpts and this pass's
independent fetch of the underlying source agree. A future slice with
unblocked access to `yandex.cloud` directly should still re-confirm the live
rendered pages match, since documentation can change between this pass and
execution.

**The precise gap, restated with the corrected candidate set:** OpenTofu's S3
backend is built on the AWS SDK and its standard credential chain, confirmed
against current OpenTofu documentation to accept `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` (the full temporary-credential
triple) via environment variables, shared AWS CLI configuration (including
`credential_process`), or `assume_role_with_web_identity`. **That is not the
open question — OpenTofu's side of the compatibility gap is confirmed and
documented, and so is the Yandex-side ephemeral-key shape, TTL, and its
official `credential_process` integration tutorial.** The remaining open
question is narrower than before this correction: whether the identity
*calling* `issue-ephemeral` can itself be a WIF-derived IAM token with no
static key anywhere upstream. The ephemeral-access-key + `credential_process`
path is the more plausible keyless candidate of the two OpenTofu-side
integration mechanisms — unlike `assume_role_with_web_identity`, it does not
require Yandex to implement any AWS STS action at all. The STS `assume-role`
path, by contrast, is documented to require a pre-existing static key as its
own prerequisite and therefore does not close the keyless gap even though its
*output* shape is also OpenTofu-familiar.

**This record does not classify the ephemeral-access-key candidate as
`KEYLESS_BACKEND_AUTH_PROVEN`.** No execution has occurred. The credential
mechanism, shape, TTL, and OpenTofu-side consumption path are `DOCUMENTED`;
the WIF-derived-caller step and the full end-to-end chain remain
`REQUIRES_EXECUTION_VALIDATION`, per the same standard the original pass
applied to every other unverified candidate. The revised 01C execution ladder
(section 2a below) exists specifically to close this experimentally.

**If 01C finds no keyless route, the resulting contract returns
`HUMAN_DECISION_REQUIRED` — it must not default to a static key.** No agent,
in 01C or any future slice, may accept a static/long-lived-key exception
autonomously; that decision is reserved for a human, per BD-DOCS-047. This
correction does not change that gate and does not pre-approve any exception —
including for the STS `assume-role` path's static-key prerequisite, which
remains exactly the kind of long-lived-secret dependency the "no static key by
default" rule exists to catch, not a loophole around it.

**Correction note (round 1).** Section 1's locking evidence was strengthened in
an earlier correction pass; that pass's improvement to the locking section is
unrelated to and unchanged by this authentication correction. Locking and
authentication remain independent technical questions.

**Correction note (round 2).** Current official Yandex documentation, not
found at the time of the original research pass, added the ephemeral-access-key
CLI feature and the STS temporary-key mechanism as two distinct, previously
unevaluated rows. That pass could not confirm the ephemeral key's exact output
shape or TTL and left them `REQUIRES_EXECUTION_VALIDATION`.

**Correction note (round 3 — this pass).** Re-verified against the canonical
`yandex-cloud/docs` source (see "Sourcing note" above): the ephemeral key's
credential shape (three-part, with session token), TTL range (`15m`–`12h`,
defaulting to the current session's IAM token lifetime), governing role, and
an official `credential_process` integration tutorial are now `DOCUMENTED` —
round 2's "not documented in current public sources found" language for these
specific facts was incorrect and is superseded by this round. Round 2's
governing role finding is unchanged. What remains open, unchanged by this
round, is narrower: whether `issue-ephemeral` itself can be called by a
WIF-derived IAM token with no static key anywhere upstream, and whether the
full chain works end to end against OpenTofu. Keyless OpenTofu backend
authentication remains `EXECUTION-DEPENDENT` until 01C actually tests that
chain. No static-key exception is approved here, or by any future agent acting
alone; that remains reserved for an explicit human decision per BD-DOCS-047.

### 2a. Revised 01C execution ladder

This correction replaces the implicit single-shot framing of "01C tests
authentication" with an explicit three-stage ladder, sequenced to fail as
cheaply as possible:

- **01C-A — WIF control-plane authentication.** GitHub OIDC → Yandex WIF →
  short-lived Yandex IAM token. No Object Storage bucket needed — this is a
  pure control-plane test. Evidence: issuer, subject/principal ID, TTL, expiry
  timestamp, HTTP status. `PASS` proves only that the control-plane exchange
  works; it does not by itself advance the data-plane question.
- **01C-B — ephemeral credential issuance.** Using the 01C-A IAM session (or a
  service account it can act as, if the role requires one), call the
  `iam.serviceAccounts.ephemeralAccessKeyAdmin`-gated `issue-ephemeral`
  operation. The output *shape* is already `DOCUMENTED` (section 2:
  `access_key_id`/`secret`/`session_token`/`expires_at`, TTL `15m`–`12h`) — 01C-B
  does not need to rediscover that. What 01C-B must actually confirm is
  narrower: whether the call succeeds using **only** the 01C-A IAM token, with
  no static key or pre-existing service-account key anywhere upstream in the
  chain, and record the observed TTL/`expires_at` and HTTP/CLI exit status.
  **If current documentation does not fully prove the exact
  WIF → `issue-ephemeral` caller-authentication step before 01C-B runs, that is
  expected and is not a reason to mark the candidate `NOT_SUPPORTED`** — this
  record already marks that specific step `REQUIRES_EXECUTION_VALIDATION`, and
  01C-B's job is to execute that validation, not to have already resolved it
  on paper.
- **01C-C — OpenTofu S3 backend authentication.** Using only the ephemeral
  AWS-compatible credential from 01C-B (never a static key) — via the
  `DOCUMENTED` `credential_process` integration pattern (section 2) or direct
  `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN` env vars —
  demonstrate authenticated backend access. Use only the **minimum backend
  operation required** to prove the credential is accepted: prefer `tofu init
  -reconfigure`, or another minimal read that exercises authentication without
  mutating state. **Do not run `tofu plan` merely to test authentication**, and
  do not create any provider-managed resource. State write and locking
  behavior belong primarily to 01B, not 01C-C; 01C-C's scope is authentication
  only.

The IAM Bearer-token test (the original H2) is preserved but **reclassified**:
it remains a useful Yandex-data-plane sanity check (confirms Object Storage
honors Yandex's own Bearer auth mode), but it is **no longer treated as a
prerequisite** for 01C-C if the ephemeral-credential path is what OpenTofu will
actually consume. A Bearer-mode success or failure does not gate 01C-B/01C-C;
it may run in parallel with, or be skipped in favor of, the ephemeral-key
chain.

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
| 8 | Authentication method for the run — **recommended default (this correction): `WIF → IAM token → ephemeral access key (issue-ephemeral) → OpenTofu S3 backend`** (section 2a's 01C-A→B→C ladder), or an explicit static-key exception | `HUMAN_DECISION_REQUIRED` — the recommendation is not a selection; static key stays `NO` by default |
| 9 | IAM role bindings for the validation identity | Policy is settled (least-privilege, no `Owner`/`Editor`-equivalent, scoped to the one disposable bucket); exact Yandex role names are `EXECUTION-DEPENDENT`, to be confirmed at 01B/01C time, not invented here |
| 10 | Cleanup authority (who confirms teardown, mirroring BD-DOCS-046's bootstrap-identity precedent) | `HUMAN_DECISION_REQUIRED` |
| 11 | Ephemeral-key issuance permission grant (`iam.serviceAccounts.ephemeralAccessKeyAdmin`) scoped to the validation identity — new in this correction | `HUMAN_DECISION_REQUIRED` — must be granted narrowly (validation identity only), never folder-wide |

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
- **Credentials are handled per their provider-documented lifecycle, not by one
  blanket claim.** Where the provider supports **explicit revocation/deletion**
  (static access keys; IAM bindings), that revocation is performed and
  confirmed. **Confirmed by this correction pass: an ephemeral access key
  cannot be individually revoked** — Yandex's own documentation states it
  directly ("You cannot revoke an ephemeral key. It automatically expires
  after its lifetime.") — so cleanup for the ephemeral-key credential and any
  STS temporary-key output instead: records the credential's `expires_at`/TTL;
  confirms it was never persisted anywhere outside the run's memory/CLI-local
  profile; removes every local/environment/AWS-profile residue (the
  `credential_process` script, any `~/.aws/credentials` profile entry, any
  exported env var) immediately after use; and allows the credential to expire
  naturally rather than claiming a revoke action that does not exist for it.
  Yandex IAM tokens (no confirmed revoke path either) follow the same
  TTL-record-and-expire pattern. "Every issued token is invalidated at the
  provider" is not asserted for any credential type without a confirmed
  provider-side revoke mechanism.
- Any IAM/WIF binding (including any WIF federated-credential binding and the
  `iam.serviceAccounts.ephemeralAccessKeyAdmin` grant) created for the
  validation identity is removed; any disposable service account or validation
  identity created solely for this test is deleted.
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
  -> 01C-A: WIF control-plane authentication (no bucket)
  -> 01C-B: ephemeral credential issuance (issue-ephemeral, via 01C-A session)
  -> 01C-C: OpenTofu S3 backend authentication (ephemeral credential only)
  -> 01B: Object Storage backend / locking validation (disposable-resource only)
  -> evidence + cleanup (sections 6-7, executed as part of 01B/01C themselves)
  -> a future, separately authorized Yandex remote-state bootstrap ADR
     (not drafted by this record)
```

Both still require 01A complete and the section-3 gate cleared, but **01C now
precedes 01B** rather than running in either order: 01B should preferably run
using the credential model 01C already established, instead of minting a
static key merely to test locking. Within 01C itself, 01C-A → 01C-B → 01C-C
(section 2a) is a strict sequence with its own stop gate at each stage — a
failure at 01C-A means 01C-B/C do not run at all. **This correction's
recommended default execution hypothesis is `WIF → IAM token → ephemeral
access key (issue-ephemeral) → OpenTofu S3 backend`** (the 01C-A→B→C ladder
above); that is a recommendation for a human to approve, not an autonomous
selection, and it does not remove the human's authority to pick a different
candidate row from section 2's table. If 01C cannot prove a keyless
authentication path through *any* candidate, execution stops for
`HUMAN_DECISION_REQUIRED` (section 2) before 01B is allowed to fall back to a
static credential — 01B does not get to independently request its own
static-key exception just because it runs second; the same human gate applies
to whichever slice ends up needing a credential decision. Both still feed a
still-future Yandex remote-state bootstrap ADR, analogous in rigor to the
now-deferred BD-DOCS-046, which this record does not draft.

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
- **Round 2 correction** added a materially more plausible keyless candidate
  (the ephemeral-access-key path) than the original pass had evidence for, and
  gave 01C an explicit three-stage ladder (01C-A/B/C, section 2a) with its own
  stop gates instead of one undifferentiated authentication test.
- **Round 3 correction (this pass)** confirms the ephemeral key's credential
  shape, TTL, and role, and surfaces an officially documented
  `credential_process` integration tutorial — narrowing 01C's remaining open
  question from "does this mechanism even exist in a usable shape" down to
  "can the issuing call itself be made with no static key upstream," which is
  a smaller, more directly testable question for 01C-B/C to close.

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
- The ephemeral-access-key candidate's output shape, TTL, role, and
  `credential_process` integration are now confirmed `DOCUMENTED` (round 3
  correction), but the caller-authentication step (can `issue-ephemeral` be
  called by a WIF-derived IAM token alone?) is still unverified by execution —
  01C-B could still find it requires a static key at some step not visible in
  current documentation, and this record does not treat "documented shape"
  as equivalent to "proven keyless."

**Follow-ups**

- A future execution slice (01B) must run the section 5 test sequence against
  a disposable bucket once the section 3 human decisions are resolved.
- A future execution slice (01C), now sequenced as 01C-A → 01C-B → 01C-C
  (section 2a), must resolve the one narrowed open question in section 2:
  whether a WIF-derived IAM token can call `issue-ephemeral` with no static
  key anywhere upstream, and whether OpenTofu's stock S3 backend — via the
  documented `credential_process` pattern or direct env vars — actually
  authenticates against Yandex Object Storage with the resulting credential.
  The credential's shape, TTL, and role are already `DOCUMENTED`; 01C does not
  need to rediscover them.
- `infra/staging/README.md`'s stale Google Cloud narrative should be
  refreshed to match BD-DOCS-047 in a separate, docs-only follow-up — not part
  of this record's scope.
- A future Yandex remote-state bootstrap ADR, analogous in rigor to the
  deferred BD-DOCS-046, remains a separate slice gated on 01B and 01C both
  closing.
- Issue #823 stays open until real staging deployment and rollback evidence
  meet its existing acceptance criteria.
