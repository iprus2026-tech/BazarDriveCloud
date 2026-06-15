---
id: BD-DOCS-012
docType: process
title: Document Lifecycle
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
    - docs-site/docs/governance/frontmatter-standard.md
  issues: []
  prs: []
tags: [governance, lifecycle, status]
slug: /governance/document-lifecycle
---

# Document Lifecycle

Every governed document carries a `status` from this closed vocabulary. The
validator rejects any other value.

| `status` | Meaning |
| --- | --- |
| `draft` | Being written; not yet trustworthy. May be incomplete or wrong. |
| `review` | Complete enough to review; awaiting sign-off from its owner / reviewers. |
| `current` | Authoritative. This is the document to trust today. |
| `superseded` | Replaced by a newer document; kept for history. Point to the replacement in `related`. |
| `archived` | Retired. No longer maintained and not expected to be accurate. |

## Transitions

```
draft ──▶ review ──▶ current ──▶ superseded ──▶ archived
  ▲          │           │
  └──────────┘           └──▶ archived   (retired without a direct successor)
```

- A document normally climbs `draft → review → current`.
- From `review` it may drop back to `draft` if rework is needed.
- A `current` document becomes `superseded` when a newer one takes over, or
  `archived` when the subject is retired with no successor.
- `superseded` documents end at `archived` once their history value lapses.

## Dating fields and review cadence

- `effectiveFrom` — the date the document's content became effective.
- `revision` — the date of the latest substantive edit.
- `reviewAfter` *(optional)* — when the owner should re-check that a `current`
  document is still accurate. A passed `reviewAfter` is a signal to re-review,
  not an automatic failure.

All three use `YYYY-MM-DD`. See the
[Frontmatter Standard](frontmatter-standard.md) for full field rules.
