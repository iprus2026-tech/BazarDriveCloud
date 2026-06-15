---
id: BD-DOCS-013
docType: process
title: Frontmatter Standard
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
    - docs-site/scripts/validate-frontmatter.mjs
    - docs-site/docs/governance/document-types.md
    - docs-site/docs/governance/document-lifecycle.md
  issues: []
  prs: []
tags: [governance, frontmatter, metadata-passport]
slug: /governance/frontmatter-standard
---

# Frontmatter Standard

Every governed document opens with a YAML frontmatter block — its **metadata
passport**. `docs-site/scripts/validate-frontmatter.mjs` enforces this standard
on `npm run check` and in CI. Templates under `docs/_templates/` are exempt.

## Example

```yaml
---
id: BD-DOCS-001
docType: project-overview
title: BazarDrive Docs
owner: docs-contract-agent
status: current
revision: 2026-06-15
effectiveFrom: 2026-06-15
reviewAfter: 2026-12-16
visibleFor: [developer, designer, dispatcher, product]
sourceOfTruth: docs-site
related:
  routes: ["/feed", "/order/<id>"]
  files: ["public/src/screens/feed.js"]
  issues: ["BD-DOCS-SITE-02"]
  prs: []
tags: [project, overview]
slug: /
---
```

## Fields

| Field | Required | Type | Rule |
| --- | --- | --- | --- |
| `id` | yes | string | Must start with `BD-` (e.g. `BD-DOCS-001`). Unique per document. |
| `docType` | yes | string | One of the [document types](document-types.md). |
| `title` | yes | string | Human-readable title. |
| `owner` | yes | string | The role or agent accountable for the document. |
| `status` | yes | string | One of the [lifecycle](document-lifecycle.md) statuses. |
| `revision` | yes | date | `YYYY-MM-DD`. Date of the latest substantive edit. |
| `effectiveFrom` | yes | date | `YYYY-MM-DD`. When the content became effective. |
| `reviewAfter` | no | date | `YYYY-MM-DD`. When the owner should re-review. |
| `visibleFor` | yes | array | Audiences; each one of `developer, designer, dispatcher, product, qa, driver, passenger, public`. |
| `sourceOfTruth` | no | string | Where the authoritative version lives (e.g. `docs-site`, a repo path). |
| `related` | no | object | `routes`, `files`, `issues`, `prs` arrays linking the document to the codebase. |
| `tags` | yes | array | Free-form keywords for search and grouping. |
| `slug` | no | string | Docusaurus URL path. Use a clean path so the `id` can stay a `BD-` passport id. |

## Controlled vocabularies

- **docType** — `project-overview`, `screen-contract`, `flow-contract`,
  `process`, `audit`, `decision-record`, `release-note`, `runbook`.
- **status** — `draft`, `review`, `current`, `superseded`, `archived`.
- **visibleFor** — `developer`, `designer`, `dispatcher`, `product`, `qa`,
  `driver`, `passenger`, `public`.

## What the validator checks

1. All required fields present and non-empty:
   `id, docType, title, owner, status, revision, effectiveFrom, visibleFor, tags`.
2. `id` starts with `BD-`.
3. `docType`, `status`, and every `visibleFor` entry are in their allowed lists.
4. `visibleFor` and `tags` are arrays.
5. `revision`, `effectiveFrom`, and `reviewAfter` (when present) match
   `YYYY-MM-DD`. Dates may be quoted or unquoted — the validator normalises a
   YAML date back to a string before checking.

Any failure prints `path: message` and exits non-zero.

## `id` vs `slug`

Docusaurus uses frontmatter `id` as the document's routing id. Because the
passport `id` is a `BD-` code, give each document an explicit `slug` for a
clean URL, and reference the `BD-` id from `sidebars.js`.
