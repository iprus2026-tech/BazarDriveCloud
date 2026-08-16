# Staging infrastructure contract

This directory is reserved for a future, reviewed OpenTofu implementation of
Issue #823. The current package, BD-BACKEND-DEPLOY-02A, is documentation only:
there are no `.tf`/`.tofu` files, credentials, state files, plans, resources,
deployment commands or migration commands here.

The active post-v0.4.0 provider direction is **Yandex Cloud in `ru-central1`**.
The earlier Google Cloud proposal is historical and superseded by
[BD-DOCS-047](../../docs-site/docs/decisions/backend-staging-provider-pivot-yandex-cloud.md).

## Current contract

| Area | Current classification | Contract |
|---|---|---|
| Provider and data location | `DECIDED` | Yandex Cloud, `ru-central1`; backend and PostgreSQL must remain physically in the Russian Federation. |
| GitHub-to-Yandex authentication | `PROVEN_AT_VALIDATION_SCOPE` | GitHub OIDC → Yandex WIF → short-lived IAM token was validated without a static/JSON key. |
| Object Storage backend authentication | `PROVEN_AT_VALIDATION_SCOPE` | The WIF session issued a short-lived three-part AWS-compatible credential and OpenTofu 1.12.0 authenticated to a disposable Object Storage S3 backend. This proves authentication only. |
| Durable remote state and locking | `EXECUTION_PROOF_REQUIRED` | No durable state backend is authorized until lock acquisition, contention, recovery, force-unlock controls and cleanup pass the approved proof contract. |
| Runtime and PostgreSQL topology | `HUMAN_DECISION_REQUIRED` | Exact folder, availability zone where applicable, network, sizing, storage, backup, budget and billing controls remain unresolved. |
| Secrets | `HUMAN_DECISION_REQUIRED` | Lockbox is the provider candidate; exact injection and rotation procedures are not accepted yet. |
| Registry and release mechanics | `EXECUTION_PROOF_REQUIRED` | Publish once and deploy by immutable digest; exact registry, zero-traffic candidate, promotion and rollback mechanics must be proven for Yandex Serverless Containers. |
| Migrations | `HUMAN_DECISION_REQUIRED` | A separate one-shot migration identity and primitive must be selected. Migrations may never run in runtime startup. |
| Staging deployment | `EXECUTION_PROOF_REQUIRED` | No staging environment, application deployment, migration run, readiness proof or rollback rehearsal exists. |

The authentication proof was intentionally disposable and narrow. It does not
prove state locking, authorize a durable bucket, select production IAM bindings,
or prove any staging runtime. OpenTofu 1.12.0 identifies the validation tool
version; it is not yet a repository-wide version pin.

## Non-negotiable invariants

- Deployment, runtime and migration use separate identities with least privilege
  and no mutual impersonation. `Owner`, `Editor` and equivalent broad roles are
  forbidden.
- PostgreSQL is private. Staging invocation is authenticated. Public anonymous
  access and wildcard CORS are forbidden; the only allowed web origin is
  `https://iprus2026-tech.github.io`.
- Only synthetic, non-personal data is allowed in requests, storage, databases,
  caches, logs, telemetry, backups, artifacts, evidence and exports.
- Secret values never enter Git, OpenTofu configuration or state, `.tfvars`,
  plans, images, build arguments, logs, CI outputs, artifacts or evidence.
  OpenTofu may manage secret metadata and IAM bindings, not secret payloads.
- Images are published once and promoted or rolled back by registry-returned
  immutable digest. Mutable tags are not deployment evidence.
- Migrations run separately and in order before traffic promotion. Application
  rollback does not imply database rollback; each migration needs an explicit
  compatibility and recovery decision.
- `GET /api/v1/health` remains DB-free liveness. `GET /api/v1/readyz` remains the
  PostgreSQL/schema readiness gate; failing readiness means no promotion.
- A staging traffic switch does not activate the PWA. PWA/API activation remains
  a separate decision under Issue #828.

## Stop gates and next slice

Do not add infrastructure definitions or run `tofu init`, `plan` or `apply`
against durable state while locking is unresolved. Do not provision PostgreSQL,
publish an image, create a Serverless Container revision, inject secrets, run
migrations or switch traffic until the corresponding decisions and execution
proofs above are closed.

After this contract package is accepted **and** the independent remote-state
locking gate has a terminal passing verdict, the next narrow implementation
slice is limited to durable remote-state and least-privilege IAM bootstrap. It
must not include PostgreSQL, application runtime, migrations, image publication
or traffic changes.

The detailed decision and evidence boundaries are
[BD-DOCS-047](../../docs-site/docs/decisions/backend-staging-provider-pivot-yandex-cloud.md)
and
[BD-DOCS-048](../../docs-site/docs/decisions/backend-staging-yandex-remote-state-validation-plan.md).
The operational acceptance map is
[BD-DOCS-043](../../docs-site/docs/processes/backend-staging-container-runbook.md).
