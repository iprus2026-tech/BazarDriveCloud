---
id: BD-DOCS-048
docType: decision-record
title: Yandex Object Storage remote-state validation — research and execution contract (01A)
owner: backend-ops-agent
status: draft
revision: 2026-08-16
effectiveFrom: 2026-08-06
reviewAfter: 2026-09-16
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
    - "#894"
  prs: []
tags: [decision-record, adr, backend, staging, iac, opentofu, remote-state, yandex-cloud, object-storage, validation-contract]
slug: /decisions/backend-staging-yandex-remote-state-validation-plan
---

# Yandex Object Storage remote-state validation — research and execution contract (01A)

> **Post-execution reconciliation; this revision is docs-only.** This record
> began as the no-cloud-contact BD-STATE-VAL-01A research contract. The later,
> separately authorized 01C-A/B/C ladder has now completed with FINAL PASS at
> every stage. Keyless Object Storage backend authentication is therefore
> `PROVEN_AT_VALIDATION_SCOPE`; state locking remains independent and requires a
> terminal execution verdict. BD-BACKEND-DEPLOY-02A creates no resource,
> credential, state or `.tf`/`.tofu` file and runs no command against Yandex
> Cloud or OpenTofu.

## Current verdict (overrides the pre-execution future tense below)

| Question | Current classification | Evidence and boundary |
|---|---|---|
| GitHub OIDC → Yandex WIF → IAM token | `PROVEN_AT_VALIDATION_SCOPE` | [Issue #856](https://github.com/iprus2026-tech/BazarDriveCloud/issues/856), 01C-A FINAL PASS; no static/JSON key. |
| IAM token → ephemeral AWS-compatible credential | `PROVEN_AT_VALIDATION_SCOPE` | [Issue #858](https://github.com/iprus2026-tech/BazarDriveCloud/issues/858), 01C-B FINAL PASS; bounded-TTL three-part credential. |
| Ephemeral credential → OpenTofu S3 backend → Object Storage | `PROVEN_AT_VALIDATION_SCOPE` | [Issue #860](https://github.com/iprus2026-tech/BazarDriveCloud/issues/860), 01C-C FINAL PASS with OpenTofu 1.12.0 and a disposable bucket; cleanup completed. |
| Durable backend naming, retention and recovery | `HUMAN_DECISION_REQUIRED` | The disposable proof did not select an exact durable bucket/name, object versioning/retention policy, recovery procedure, restore-test acceptance or durable IAM. |
| Object Storage locking and lock recovery | `EXECUTION_PROOF_REQUIRED` | Authentication does not prove lock acquisition, contention, stale-lock recovery, controlled force-unlock or durable state safety. |

The 2026-08-06 correction chronology below is retained as the audit trail that
designed the proof. Statements in that chronology such as “future 01C,” “no
execution has occurred,” and `REQUIRES_EXECUTION_VALIDATION` describe the state
at that time; this current-verdict section supersedes them for the completed
01C chain. The proof does not authorize a durable backend, durable IAM bindings,
staging resources or reuse of validation identities.

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
> confirms: a three-part AWS credential (`access_key_id`/`secret`/
> `session_token`) plus expiry metadata (`expires_at`), a `15m`–`12h` TTL
> range, and an official `credential_process` integration tutorial — see
> section 2's "Sourcing note." These are now `DOCUMENTED`.
>
> **Correction pass 3 — WIF→IAM-token→ephemeral-key mechanism classification
> corrected (same-day, 2026-08-06).** Current live Yandex documentation states
> both halves explicitly: Workload Identity Federation exchanges the external
> OIDC JWT for an IAM token of the linked service account, and that IAM token is
> then used for Yandex Cloud API requests; separately, ephemeral access keys are
> issued based on the current session's IAM token. Taken together, the generic
> upstream mechanism `WIF → IAM token → issue-ephemeral` is `DOCUMENTED`, not
> an undocumented possibility. What still requires execution is
> BazarDriveCloud-specific configuration and policy compatibility (issuer,
> audience, subject/federated credential, IAM grants, organization/folder
> access policies), a real zero-static-key issuance from the GitHub runner, and
> end-to-end OpenTofu S3 backend consumption. Still no
> `KEYLESS_BACKEND_AUTH_PROVEN`, still no cloud contact in this docs-only pass,
> still no static-key exception.

## Context

BD-DOCS-047 pivoted staging to Yandex Cloud `ru-central1` and originally left
two remote-state questions marked `NOT_PROVEN`: Object Storage state locking
and keyless S3-compatible data-plane authentication. This record split those
failure domains so that proof could not become license to provision staging.
The authentication domain is now proven at disposable validation scope; the
locking domain remains open.

The contract split the work into three slices: **01A** (this document's
original research, no cloud contact), **01B** (Object Storage backend/locking
validation, disposable-resource only), and **01C** (keyless authentication
validation, disposable-resource only). Locking and
authentication are split because they are different failure domains with
different risk profiles — authentication carries an explicit
"no autonomous long-lived-secret decision" gate (BD-DOCS-047, "Authentication")
that locking does not. Keeping them separate let 01C establish the credential
model once for later locking work instead of permitting an ad hoc static key.

`infra/staging/README.md` and BD-DOCS-043 are reconciled to the active Yandex
contract by BD-BACKEND-DEPLOY-02A. The Google Cloud narrative is historical,
not an active staging instruction.

This record does not touch, resolve, or reopen: PostgreSQL sizing, Serverless
Containers release mechanics, Lockbox runtime injection, monitoring/logging,
or any of BD-DOCS-047's already-settled items (region, `ALLOWED_ORIGIN`,
identity separation, secret-value boundary, synthetic-data-only rule).

## Repository state check

No OpenTofu version is pinned anywhere in this repository today: there is no
`.tf`/`.tofu` file, no `.terraform-version`/`.opentofu-version` file, and no CI
workflow step that installs or invokes `tofu`. `infra/staging/` contains only
`README.md`. This is itself a finding, not an oversight to silently fill in:
**the exact durable OpenTofu version is an open input**, not something this
record or a future implementation slice may pick unilaterally. 01C-C's use of
OpenTofu 1.12.0 is validation evidence, not a repository pin. Everything below
is therefore recorded against the *current, unversioned* OpenTofu S3 backend implementation
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
| **Ephemeral access key** (`yc iam access-key issue-ephemeral`, Yandex Cloud CLI ≥0.181.0) | `DOCUMENTED`. Yandex documents the key as a genuine **three-part** AWS-shaped credential — `access_key_id`, `secret`, `session_token` — with separate `expires_at` expiry metadata. `--duration` accepts `15m` to `12h`; if omitted, the key lifetime is limited by the current IAM-token session. The same documentation states that ephemeral keys are **issued based on the current session's IAM token**. Requires the `iam.serviceAccounts.ephemeralAccessKeyAdmin` role or higher for the folder. | Completed for the authorized disposable BazarDriveCloud chain in 01C-B/01C-C. Durable identity, policy, TTL and secret-exclusion wiring still require review. | The issued credential is bounded-TTL and cannot be individually revoked; it expires automatically. No long-lived secret is required by the mechanism or the completed proof. | `PROVEN_AT_VALIDATION_SCOPE` for WIF-backed issuance and OpenTofu consumption; not a durable staging credential approval |
| **AWS `credential_process` integration for the ephemeral key** | `DOCUMENTED` — an official Yandex tutorial (`yandex-cloud/docs`, `en/_tutorials/security/ephemeral-key-storage.md`, mirroring `yandex.cloud/en/docs/storage/operations/buckets/manage-ephemeral-keys`) issues a key via `yc iam access-key issue-ephemeral --subject-id <sa_id> --session-name ephemeral-sa-1 --jq '{Version: 1, AccessKeyId: .access_key_id, SecretAccessKey: .secret, SessionToken: .session_token, ExpiresAt: .expires_at}'` and wires it into an AWS CLI profile via `credential_process = <file_path>`. This is an **officially documented integration candidate, not a hypothetical custom shim** — Yandex ships the exact `--jq` transform and AWS CLI profile shape | The completed proof establishes end-to-end ephemeral-credential consumption but does not select `credential_process` as the durable integration. | No new dependency beyond the ephemeral key above | `DOCUMENTED_CANDIDATE`; exact durable integration remains `HUMAN_DECISION_REQUIRED` |
| **STS temporary key** (`aws sts assume-role` against Yandex's STS endpoint) | `DOCUMENTED` — official tutorial: `--duration-seconds` "cannot exceed 43200" (12h); response shape is the full AWS triple (`AccessKeyId`/`SecretAccessKey`/`SessionToken`/`Expiration`), matching what OpenTofu's S3 backend expects | Yes — but the same tutorial's own documented workflow assumes the caller **already has a static access key** created in a prior step before calling `assume-role`; no path from an IAM token or WIF-derived credential to this call was found | Rooted in a static key at the point of *calling* `assume-role`, even though the *returned* credential is short-lived | `NOT_PROVEN`, leaning **not a genuine keyless bootstrap** — reduces exposure of the long-lived key (it need not be reused directly for signing), but does not eliminate the static-secret dependency at the root |
| Yandex IAM token (Yandex account / service account) | `DOCUMENTED` for the S3 API directly — passed as `Authorization: Bearer ${IAM_TOKEN}`, a **non-SigV4** auth mode; TTL ≤ 12h, refresh hourly recommended | Yes — see backend-compatibility gap below | No | `NOT_SUPPORTED` **for OpenTofu's stock S3 backend directly**, `SUPPORTED` for the Object Storage S3 API in general and `DOCUMENTED` as the upstream session used to issue ephemeral keys |
| GitHub → Yandex Workload Identity Federation | `DOCUMENTED`: the OIDC exchange produces an IAM token of the linked Yandex Cloud service account, and Yandex states that the external subject then uses that IAM token for the required Yandex Cloud API requests. Combined with the ephemeral-key contract above (ephemeral keys are issued based on the current session's IAM token), the generic `WIF → IAM token → issue-ephemeral` mechanism is documented. WIF does not directly emit an AWS-SigV4 credential; `issue-ephemeral` is the bridge to the AWS-shaped temporary credential. | Completed for the authorized disposable BazarDriveCloud issuer/audience/subject and validation policy in 01C-A; durable bindings remain a separate decision. | No | `PROVEN_AT_VALIDATION_SCOPE` |
| Service-account IAM token (short-lived, minted from an SA key or WIF) | `DOCUMENTED` as an upstream Yandex Cloud API credential and as the session basis for ephemeral-key issuance; it is not itself an AWS-SigV4 credential for OpenTofu's S3 backend | The WIF-derived session and ephemeral-key bridge were exercised in 01C-A/B. | No | Direct OpenTofu S3 use remains `NOT_SUPPORTED`; the ephemeral-key bridge is `PROVEN_AT_VALIDATION_SCOPE` |
| AWS-compatible credential-provider-chain / STS-equivalent (`assume_role_with_web_identity`) | **`DOCUMENTED` on the OpenTofu side**, re-confirmed against current OpenTofu S3 backend documentation: the backend supports `assume_role_with_web_identity { role_arn, web_identity_token / web_identity_token_file }`, calling AWS STS's `AssumeRoleWithWebIdentity` API, and its `endpoints` block can override `sts` to a non-AWS endpoint. **No documentation found that Yandex's STS endpoint implements the `AssumeRoleWithWebIdentity` action** — Yandex's own documented STS operation is plain `assume-role`, which (per the row above) itself requires a pre-existing static key to invoke. Yandex's WIF instead exchanges the OIDC token for a native Yandex IAM token via Yandex's own control-plane API — a structurally different mechanism, not an STS-compatible one. This row is now the *less* promising of the two OpenTofu-side integration paths — see the `credential_process` row above, which does not depend on Yandex implementing any AWS STS action at all | Yes — confirm absence/presence of an `AssumeRoleWithWebIdentity`-equivalent action definitively | No (if it existed) | `NOT_PROVEN`, leaning `NOT_SUPPORTED` — this correction pass found additional negative evidence (the documented `assume-role` workflow's static-key prerequisite) but no positive evidence changing the original verdict |
| Metadata/workload-identity auto-injected credentials | Applies to code running *on* Yandex Compute/Serverless; GitHub Actions runners are external, so this surface does not apply to CI-driven `tofu` runs | Moot for this use case | No | `NOT_SUPPORTED` for the CI use case |

**Sourcing note for this correction.** This correction pass re-checked the
live `yandex.cloud` documentation directly and cross-checked the same facts
against the canonical `yandex-cloud/docs` source. The live Workload Identity
Federation documentation says the OIDC JWT is exchanged for an IAM token of
the linked service account and that this IAM token is used for required Yandex
Cloud API requests. The live ephemeral-key documentation says ephemeral keys
are issued based on the current session's IAM token, documents the three-part
credential format and TTL, and links the supported management flow. The live
Object Storage tutorial independently documents the `credential_process`
bridge. These sources agree. The later 01C-A/B/C ladder supplied the
repository-specific execution evidence that was still missing when this
sourcing note was written.

**The precise gap, restated with the corrected candidate set:** OpenTofu's S3
backend is built on the AWS SDK and its standard credential chain, confirmed
against current OpenTofu documentation to accept `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` (the full temporary-credential
triple) via environment variables, shared AWS CLI configuration (including
`credential_process`), or `assume_role_with_web_identity`. **That is not the
open question — OpenTofu's side of the compatibility gap is confirmed and
documented, and so is the Yandex-side ephemeral-key shape, TTL, IAM-token
issuance model, and official `credential_process` integration tutorial.**
The repository-specific disposable questions were answered by 01C-A/B/C:
BazarDriveCloud's GitHub OIDC/WIF session worked, ephemeral issuance succeeded
without a static key, and OpenTofu 1.12.0 authenticated the backend end to end.
Durable folder/identity bindings, credential lifetime and integration shape are
still bootstrap decisions and may not be inferred from the validation setup.
The STS `assume-role` path remains less attractive because its documented
workflow requires a pre-existing static key to invoke it.

**Current classification: `PROVEN_AT_VALIDATION_SCOPE`.** The generic mechanism
remains `DOCUMENTED`; Issues #856, #858 and #860 add the BazarDriveCloud-specific
zero-static-key issuance and OpenTofu authentication proof. This verdict is not
`STATE_LOCKING_PROVEN` and is not a durable staging-backend approval.

The proof succeeded, so no static-key fallback is needed. No agent in a future
slice may accept a static/long-lived-key exception autonomously; that remains an
explicit human architecture/security decision. The STS `assume-role` path's
static-key prerequisite is not a loophole around this rule.

**Correction note (round 1).** Section 1's locking evidence was strengthened in
an earlier correction pass; that pass's improvement to the locking section is
unrelated to and unchanged by this authentication correction. Locking and
authentication remain independent technical questions.

**Correction note (round 2).** Current official Yandex documentation, not
found at the time of the original research pass, added the ephemeral-access-key
CLI feature and the STS temporary-key mechanism as two distinct, previously
unevaluated rows. That pass could not confirm the ephemeral key's exact output
shape or TTL and left them `REQUIRES_EXECUTION_VALIDATION`.

**Correction note (round 3).** Re-verified against the canonical
`yandex-cloud/docs` source: the ephemeral key's three credential parts (key ID,
secret, session token), separate expiry metadata, TTL range (`15m`–`12h`,
defaulting to the current session's IAM token lifetime), governing role, and
an official `credential_process` integration tutorial are `DOCUMENTED`.

**Correction note (round 4 — this pass).** Re-checked against the live Yandex
Workload Identity Federation and ephemeral-key documentation: WIF exchanges
an external OIDC JWT for a service-account IAM token that is used for Yandex
Cloud API requests, while ephemeral keys are issued based on the current
session's IAM token. Therefore the generic WIF-derived IAM-token caller model
for ephemeral-key issuance is `DOCUMENTED`. What remains
`EXECUTION-DEPENDENT` is BazarDriveCloud's actual federation/subject/audience,
access-policy and role configuration, a real zero-static-key issuance from the
GitHub runner, and OpenTofu end-to-end authentication. No static-key exception
is approved here, or by any future agent acting alone; that remains reserved
for an explicit human decision per BD-DOCS-047.

### 2a. Completed 01C execution ladder

The three-stage ladder ran as separately authorized disposable slices and
completed without turning authentication validation into durable staging work:

- **01C-A — WIF control-plane authentication: FINAL PASS
  ([Issue #856](https://github.com/iprus2026-tech/BazarDriveCloud/issues/856)).**
  GitHub OIDC → Yandex WIF produced a short-lived Yandex IAM token for the
  approved validation identity. No Object Storage bucket or static/JSON key was
  needed. This proves the concrete validation issuer/audience/subject mapping,
  not a durable staging binding.
- **01C-B — ephemeral credential issuance: FINAL PASS
  ([Issue #858](https://github.com/iprus2026-tech/BazarDriveCloud/issues/858)).**
  Using only the 01C-A IAM session, the approved validation identity issued a
  bounded-TTL three-part credential (`access_key_id`, `secret`,
  `session_token`) with expiry metadata. No static key or pre-existing
  service-account key was present. This proves validation policy compatibility,
  not the final durable role scope or TTL.
- **01C-C — OpenTofu S3 backend authentication: FINAL PASS
  ([Issue #860](https://github.com/iprus2026-tech/BazarDriveCloud/issues/860)).**
  OpenTofu 1.12.0 used only the 01C-B ephemeral credential to authenticate its
  S3 backend against disposable Object Storage; cleanup completed. The proof did
  not test state locking, create provider-managed staging resources or establish
  a repository-wide OpenTofu pin.

The IAM Bearer-token test (the original H2) remains historical context:
it remains a useful Yandex-data-plane sanity check (confirms Object Storage
honors Yandex's own Bearer auth mode), but it is **no longer treated as a
prerequisite** for 01C-C if the ephemeral-credential path is what OpenTofu will
actually consume. A Bearer-mode success or failure does not gate 01C-B/01C-C;
it did not gate the completed ephemeral-key chain.

## 3. Historical decision gate for 01C; reusable gate for locking validation

The authorized 01C execution resolved the decisions below for its disposable
run only; its resources were cleaned up. Those selections do not transfer to
durable staging or automatically authorize a locking experiment. For any new
locking validation, unresolved inputs must be recorded by its own approved
package and may not be guessed, copied from staging or inferred from 01C.

The `Status` column below preserves the original pre-execution 01A decision
packet. It is not a claim that 01C is still pending and it does not report the
state of any separately governed locking package.

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

01C completed within a disposable footprint and cleanup completed. For the
remaining locking proof, the maximum contract footprint is:

- One disposable Object Storage bucket for locking validation.
- One validation identity (service account or equivalent), scoped only to that
  bucket's objects — never bucket-level `setIamPolicy`, never project-wide.
- A minimal inert OpenTofu root module whose only purpose is exercising the
  backend (a single trivial resource or none at all) — not a real
  infrastructure definition, and never a copy of any real staging module.
- The short-lived WIF → IAM token → ephemeral credential chain proven by
  01C-A/B/C. A static test key is not an implementation fallback.

**Explicitly forbidden in locking/authentication validation, no exception:**
Managed PostgreSQL, Serverless Containers, Container Registry, Lockbox application secrets, any
application deployment, any production- or staging-named resource, real
personal data, PWA/API activation, any production/staging migration.

**Temporary `.tf`/`.tofu` files: recommend they live outside the repository**
(the operator's local scratch space or the CI job's ephemeral workspace),
never committed under `infra/staging/` or anywhere else in the repo. Nothing
in BD-DOCS-044/046/047 or `infra/staging/README.md` requires committing
validation-only Terraform/OpenTofu configuration, and `infra/staging/README.md`
itself currently states plainly that the directory holds documentation only.
Validation work must not commit `.tf`/`.tofu` files unless a human decision
explicitly overrides this default.

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

This section governs disposable authentication/locking validation evidence
only. It does not decide the durable staging/deployment evidence location,
retention period, read access, redaction owner or deletion procedure; BD-DOCS-043
classifies those values `HUMAN_DECISION_REQUIRED` and blocks a #823 acceptance
claim until they are approved.

## 8. Recommended slice architecture going forward

```
01A: research contract — COMPLETE
  -> 01C-A/B/C: short-lived authentication ladder — FINAL PASS
  -> 01C evidence and cleanup — COMPLETE
  -> Object Storage locking validation — EXECUTION_PROOF_REQUIRED
  -> terminal locking PASS + accepted staging contract
  -> separately authorized durable remote-state / least-privilege IAM bootstrap
```

01C established the credential model that any later locking proof should use;
there is no reason to mint a static key for locking. Authentication success does
not shorten section 5's locking PASS contract. After this documentation package
is accepted and locking reaches a terminal PASS, the next narrow implementation
slice is durable remote-state and least-privilege IAM bootstrap only. It excludes
PostgreSQL, Serverless Containers, Lockbox payloads, image publication,
migrations, probes and traffic.

## Issue #823

Issue #823 remains **open** and is unaffected by this record. Remote-state
validation — research or execution — satisfies none of its acceptance items
(fresh staging deploy reaching `/api/v1/health`/`/api/v1/readyz`, ordered
migrations applying with the intended re-apply remaining clean, no
committed/logged credential material, a rehearsed rollback, green
server-ci/deployment checks). This record checks off nothing on #823.

## Consequences

**Positive**

- BD-DOCS-047's original two `NOT_PROVEN` questions were separated: keyless
  authentication now has a passing disposable proof, while locking retains an
  exact execution-ready PASS contract.
- The locking finding is meaningfully upgraded from "no evidence found" to
  "positive documented evidence found, execution needed to close exact
  status-code parity" — a materially different and less pessimistic starting
  point for 01B.
- The authentication finding is now a precise, bounded integration verdict:
  `PROVEN_AT_VALIDATION_SCOPE` for WIF → IAM token → ephemeral credential →
  OpenTofu S3 backend, without claiming locking or durable staging readiness.
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
- **Round 3 correction** confirms the ephemeral key's credential parts, expiry
  metadata, TTL, role, and officially documented `credential_process`
  integration tutorial.
- **Round 4 correction (this pass)** moves the generic
  `WIF → IAM token → issue-ephemeral` mechanism to `DOCUMENTED`, and narrows
  01C's unresolved scope to BazarDriveCloud-specific federation/policy/runtime
  proof plus end-to-end OpenTofu authentication.

**Negative / trade-offs**

- Alternative candidate rows remain bounded by their cited research. The
  successful 01C chain is bounded by its execution evidence and may not be
  generalized to locking or durable staging configuration.
- The OpenTofu-version gap (none pinned in-repo) means this record's OpenTofu-
  side claims must be re-confirmed against whichever version a future decision
  pins, not assumed to hold indefinitely.
- No `STATE_LOCKING_PROVEN` verdict exists; durable bootstrap remains blocked.
- The disposable validation bindings are not durable staging bindings. Exact
  folder, principal, subject/audience policy, least-privilege roles, TTL and
  credential delivery still require an approved bootstrap contract.

**Follow-ups**

- A future execution slice (01B) must run the section 5 test sequence against
  a disposable bucket once the section 3 human decisions are resolved.
- 01C-A/B/C is complete; retain its sanitized evidence and cleanup verdict as
  the authentication baseline. Do not rerun it merely to compensate for an
  unrelated locking gap.
- `infra/staging/README.md` and BD-DOCS-043 now carry the active Yandex contract.
- A future Yandex remote-state bootstrap ADR/implementation, analogous in rigor
  to deferred BD-DOCS-046, remains a separate slice gated on an accepted
  contract and terminal locking PASS. It must preserve the proven short-lived
  authentication chain and exclude runtime, PostgreSQL and migrations.
- Issue #823 stays open until real staging deployment and rollback evidence
  meet its existing acceptance criteria.
