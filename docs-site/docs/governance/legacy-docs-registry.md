---
id: BD-DOCS-020
docType: process
title: Legacy Docs Registry
owner: docs-contract-agent
status: current
revision: 2026-06-15
effectiveFrom: 2026-06-15
reviewAfter: 2026-12-16
visibleFor: [developer, designer, dispatcher, product, qa]
sourceOfTruth: docs-site
related:
  routes: []
  files:
    - docs-site/governance/document-registry.json
    - docs-site/scripts/validate-document-registry.mjs
    - docs-site/docs/governance/mini-yonder-model.md
  issues: ["BD-DOCS-SITE-03"]
  prs: []
tags: [governance, legacy, registry]
slug: /governance/legacy-docs-registry
---

# Legacy Docs Registry

The [Mini-Yonder model](mini-yonder-model.md) governs documents that live inside
`docs-site/docs/` through their frontmatter passport. But the repository still
holds many **legacy documents** at the root (`README.md`, `ROADMAP.md`) and under
`docs/` that have **not** been migrated into `docs-site` yet. The legacy registry
is how Mini-Yonder *sees* those documents and tracks what still needs attention.

## What the registry is

`docs-site/governance/document-registry.json` is a JSON array. Each entry is a
**registered legacy document** — a pointer to a file that lives outside
`docs-site/docs/`, with just enough metadata to track it:

```json
{
  "id": "BD-LEGACY-003",
  "path": "docs/screen-contracts.md",
  "title": "Screen Contracts",
  "docType": "screen-contract",
  "status": "legacy-source",
  "verification": "pending",
  "owner": "docs",
  "sourceOfTruth": "repo",
  "reviewAfter": "2026-07-15",
  "reason": "Legacy source kept until incremental docs-site migration."
}
```

`docs-site/scripts/validate-document-registry.mjs` (run via `npm run
validate:registry`, and inside `npm run check`) validates this file.

### Controlled vocabularies

- **docType** — `project-overview`, `roadmap`, `screen-contract`,
  `flow-contract`, `audit`, `design-registry`, `process`, `runbook`,
  `release-note`.
- **status** — `current`, `legacy-source`, `superseded`, `archived`, `draft`.
- **verification** — `pending`, `verified`, `superseded`, `ignored-with-reason`.

## Registered legacy document vs UNACCOUNTED_DOCUMENT

The validator scans the legacy universe — `README.md`, `ROADMAP.md`, and every
`docs/**/*.md` and `docs/**/*.json` (skipping `node_modules`, `build`, `.git`)
— and diffs it against the registry's `path` values.

- A **registered legacy document** is a scanned file that has a matching entry
  in the registry. It is accounted for.
- An **UNACCOUNTED_DOCUMENT** is a scanned legacy file with **no** registry
  entry. Mini-Yonder doesn't know what it is, who owns it, or whether it's still
  trustworthy.

`docs-site/docs/**` is deliberately **not** scanned here — those pages already
carry a frontmatter passport, so duplicating them into this registry would be
redundant.

## Why this first pass is warn-only

There are many legacy documents, and registering all of them at once would be a
large, noisy change. So in this first pass the validator is **warn-only** for
UNACCOUNTED_DOCUMENT: it prints each one and explains the count, but **exits 0**
— it does not fail the build.

**Registry structural errors are strict** (exit 1): a malformed entry, a missing
required field, a duplicate `id`, a `path` that doesn't exist, an out-of-vocab
value, or an impossible `reviewAfter` date all fail `npm run check` immediately.

A future pass may flip UNACCOUNTED_DOCUMENT to strict once the backlog of legacy
documents has been triaged into the registry.

## Lifecycle of a legacy document

A registered legacy document carries a `status` that says where it stands:

- **legacy-source** — the file is still the working source, kept as-is until it
  is migrated. This is the default for the initial entries.
- **current** — reviewed and confirmed accurate; trusted today even though it
  still lives outside `docs-site`.
- **superseded** — a newer document (often a migrated `docs-site` page) has
  taken over; the legacy file is kept for history.
- **archived** — retired and no longer maintained.
- **draft** — a legacy file still being shaped before it earns a firmer status.

The separate `verification` field tracks the review itself: `pending` (not yet
checked), `verified` (checked against the runtime/repo), `superseded` (replaced),
or `ignored-with-reason` (consciously skipped — the `reason` explains why).

## How migration into docs-site will work

This registry is the on-ramp, not the destination. The intended path for a
legacy document:

1. **Register** it here so it stops being an UNACCOUNTED_DOCUMENT.
2. **Verify** its content against the runtime/repo (`verification: verified`).
3. **Migrate** the content into a governed `docs-site/docs/**` page with a full
   frontmatter passport (see the
   [Frontmatter Standard](frontmatter-standard.md)).
4. **Supersede** the legacy entry (`status: superseded`,
   `verification: superseded`) pointing at the new page, and eventually
   **archive** it.

Migration stays **incremental** — legacy documents are never bulk-moved or
deleted; they are retired one at a time as their content lands in `docs-site`.
