---
id: BD-DOCS-010
docType: process
title: Mini-Yonder Model
owner: docs-contract-agent
status: current
revision: 2026-06-16
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
    - docs-site/docs/governance/frontmatter-standard.md
  issues: []
  prs: []
tags: [governance, mini-yonder, docs-as-code]
slug: /governance/mini-yonder-model
---

# Mini-Yonder Model

The **Mini-Yonder model** is a lightweight, open-source governance layer for
BazarDriveCloud documentation. It borrows the idea of a corporate knowledge
platform — every document is a governed object with an owner, a lifecycle, and
a machine-readable identity — but keeps it small enough to live as plain
Markdown in this repository.

## Why a governance layer

Ad-hoc docs drift. A page written for a single PR loses its owner, its status,
and its link to the code it describes. The Mini-Yonder model fixes that by
giving every document a **metadata passport** (the frontmatter block) and a
**lifecycle** (draft → review → current → superseded → archived).

The result: any reader — human or tool — can answer, for any page, *who owns
this, is it current, who is it for, and what is it the source of truth for*.

## The three pillars

1. **Document types** — a closed vocabulary of `docType` values, so every page
   declares what kind of artifact it is. See
   [Document Types](document-types.md).
2. **Lifecycle** — a closed vocabulary of `status` values and the transitions
   between them. See [Document Lifecycle](document-lifecycle.md).
3. **Frontmatter standard** — the required passport fields and how they are
   validated. See [Frontmatter Standard](frontmatter-standard.md).

## Enforcement

The model is not advisory. `docs-site/scripts/validate-frontmatter.mjs` walks
every governed document and fails the build (`npm run check`, and CI) when a
passport is missing or malformed. Templates under `docs/_templates/` are
exempt — they are scaffolds, not governed documents.

## Seeing the legacy documents

Many documents still live outside `docs-site/` — `README.md`, `ROADMAP.md`, and
everything under `docs/`. Mini-Yonder tracks them through the
[legacy docs registry](legacy-docs-registry.md)
(`docs-site/governance/document-registry.json`). A second validator,
`validate-document-registry.mjs` (`npm run validate:registry`), checks the
registry's structure strictly and **warns** about any legacy file that has no
registry entry (`UNACCOUNTED_DOCUMENT`). This first pass is warn-only, so the
build still passes while the legacy backlog is triaged incrementally.

## Seeing its own files

Mini-Yonder also inventories **itself**. `docs-site/governance/mini-yonder-core.json`
lists the governance layer's own core files (validators, registry, governance
docs, config, the CI workflow, and `CLAUDE.md`), and a third validator,
`validate-mini-yonder-core.mjs` (`npm run validate:self`), checks it strictly.
The manifest may list itself once as `core-manifest`, but generated output is
never a core file and nothing auto-generates the inventory — so the layer sees
its own core without a self-reference loop. See
[Mini-Yonder Self Inventory](mini-yonder-self-inventory.md).

## Scope and boundaries

- This layer governs **`docs-site/` only**. It does not touch the runtime PWA
  in `public/`, the service worker, the CSP, or the existing GitHub Pages PWA
  workflow.
- The **repo remains the source of truth for shipped behaviour.** A
  screen-contract page here points at `docs/screen-contracts.md` and the
  runtime; when they disagree, the runtime wins.
- Legacy `docs/*` files are migrated **incrementally**, not all at once.
