# Staging infrastructure contract

This directory is reserved for the future reviewed OpenTofu configuration for
BD-BACKEND-DEPLOY-01B. BD-BACKEND-DEPLOY-01B-1A contains documentation only:
there are no `.tf` files, credentials, state files, resources or apply commands
here.

The proposed target is a Google Cloud technical staging environment:

- Artifact Registry for immutable container images;
- Cloud Run with IAM-authenticated access;
- Cloud SQL for PostgreSQL 16;
- Secret Manager for runtime secrets;
- a separate Cloud Run Job for ordered migrations;
- GitHub Actions authentication through OIDC Workload Identity Federation;
- OpenTofu for future infrastructure definitions.

Static service-account JSON keys, public unauthenticated staging, wildcard CORS,
real personal/production data and automatic PWA/API activation are forbidden.
Staging may contain only synthetic, non-personal fixtures.

Deployment, runtime and migration require three separate principals/service
accounts. Reuse across roles and mutual impersonation are forbidden. `Owner`,
`Editor` and equivalently broad roles are forbidden; grant least privilege,
preferably on exact resources. The deployment identity uses GitHub OIDC/WIF,
may receive `serviceAccounts.actAs` only for the exact runtime and migration
identities, and has no runtime DB/application-secret access. The runtime identity
cannot publish, deploy, migrate, change IAM or impersonate. The migration identity
cannot serve traffic, deploy, change IAM or impersonate. Exact bindings remain a
future blocker.

Secret values are forbidden in Git/source, OpenTofu configuration, `.tfvars`,
environment files, OpenTofu state/state backups, saved plans, plan/console output,
documentation, workflow/build/deployment/runtime logs, image layers/build args,
CI/CD outputs, artifacts/evidence and support/debug exports. OpenTofu may manage
only Secret Manager metadata, empty secret containers and IAM bindings, never
secret payloads or versions. `sensitive` does not keep a value out of state.
Values require a separately approved out-of-state channel that leaves nothing in
shell history, logs, artifacts or evidence; its bootstrap/rotation procedure is
not implemented and remains a blocker.

The synthetic-only rule covers HTTP/API requests and bodies, database contents,
caches, logs, traces, metrics/telemetry, object-storage artifacts,
backups/snapshots, database restores, support/debug dumps, CI/deployment
artifacts, operational evidence and exports. Real passenger, driver, order, ride,
document or payment data, production exports/restores, replayed production
requests/logs and production-derived personal fixtures are forbidden.

If real or production-derived data is discovered, stop the affected
check/environment, restrict further access, and remove it through a separately
approved incident procedure. Record the incident without copying sensitive
values into evidence.

No future OpenTofu configuration may guess the GCP region, project ID, billing
owner or monthly budget. Those are blocking human inputs. Remote-state location,
bootstrap authority, access, locking and retention must be approved and created
in a separate slice before the first `tofu init` against a remote backend or any
`tofu apply`.

The governing proposed decision is
[`BD-DOCS-044`](../../docs-site/docs/decisions/backend-staging-provider-and-iac.md);
the operational boundary remains
[`BD-DOCS-043`](../../docs-site/docs/processes/backend-staging-container-runbook.md).
