---
id: BD-DOCS-011
docType: process
title: Document Types
owner: docs-contract-agent
status: current
revision: 2026-06-16
effectiveFrom: 2026-06-16
reviewAfter: 2026-12-16
visibleFor: [developer, designer, dispatcher, product, qa]
sourceOfTruth: docs-site
related:
  routes: []
  files:
    - docs-site/scripts/validate-frontmatter.mjs
    - docs-site/docs/governance/mini-yonder-model.md
  issues: []
  prs: []
tags: [governance, document-types, taxonomy]
slug: /governance/document-types
---

# Document Types

Every governed document declares a `docType` from this closed vocabulary. The
validator rejects any other value.

| `docType` | What it is | Typical template |
| --- | --- | --- |
| `project-overview` | What BazarDriveCloud is; entry-point orientation. | — |
| `screen-contract` | Per-screen contract: route, file, storage, states, actions, acceptance. | `screen-contract.template.md` |
| `flow-contract` | Cross-screen flow: the path a user takes across multiple screens. | `flow-contract.template.md` |
| `process` | A repeatable way of working (governance, pipelines, release notes). | — |
| `audit` | A point-in-time review of a screen, flow, or subsystem. | `audit.template.md` |
| `decision-record` | A recorded decision and its rationale (ADR-style). | `decision-record.template.md` |
| `release-note` | A user- or team-facing note about a shipped change. | `release-note.template.md` |
| `runbook` | Step-by-step operational procedure (verify, deploy, recover). | `runbook.template.md` |

## Choosing a type

- Describing how **one screen** behaves → `screen-contract`.
- Describing a **path across screens** → `flow-contract`.
- Describing **how we work** → `process`.
- Capturing a **moment-in-time review** → `audit`.
- Recording **why a choice was made** → `decision-record`.
- Announcing **what shipped** → `release-note`.
- Listing **operational steps to run** → `runbook`.
- Orienting a **newcomer to the whole project** → `project-overview`.

## Relationship to lifecycle

`docType` is orthogonal to `status`. A `screen-contract` can be `draft`,
`current`, or `superseded`; the type never changes as the document moves
through its [lifecycle](/governance/document-lifecycle).
