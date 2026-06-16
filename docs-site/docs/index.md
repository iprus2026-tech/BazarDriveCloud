---
id: BD-DOCS-001
docType: project-overview
title: BazarDrive Docs
owner: docs-contract-agent
status: current
revision: 2026-06-15
effectiveFrom: 2026-06-15
reviewAfter: 2026-12-16
visibleFor: [developer, designer, dispatcher, product, qa]
sourceOfTruth: docs-site
related:
  routes: []
  files: ["docs-site/scripts/validate-frontmatter.mjs"]
  issues: ["BD-DOCS-SITE-01", "BD-DOCS-SITE-02"]
  prs: []
tags: [index, overview]
slug: /
---

# BazarDrive Docs

Welcome to the **docs-as-code** layer for **BazarDriveCloud** (`iprus2026-tech/BazarDriveCloud`).

This site (`docs-site/`) is a **separate documentation shell** built with Docusaurus. It is intentionally decoupled from the runtime PWA:

- It lives in `docs-site/`, with its own `package.json`, build, and CI workflow.
- It does **not** touch `public/`, the service worker, the CSP, or the existing GitHub Pages PWA workflow.
- It is the open-source, mini-Yonder-style replacement for ad-hoc documentation.

## Sections

- **Project** — what BazarDriveCloud is.
- **Contracts** — a pointer to the screen/flow contracts that govern shipped behaviour.
- **Processes** — how Cloud Design exports become PRs, and how release notes work.
- **Governance** — the Mini-Yonder model that governs this site.

## Mini-Yonder governance layer

Every document on this site is a **governed object** with a machine-readable
**metadata passport** (its frontmatter) and a **lifecycle**. A validator
(`docs-site/scripts/validate-frontmatter.mjs`) enforces the passport on
`npm run check` and in CI, so docs can't silently drift.

Start here:

- [Mini-Yonder Model](governance/mini-yonder-model.md) — what the layer is and why.
- [Document Types](governance/document-types.md) — the `docType` vocabulary.
- [Document Lifecycle](governance/document-lifecycle.md) — the `status` vocabulary.
- [Frontmatter Standard](governance/frontmatter-standard.md) — the passport fields and rules.
- [Legacy Docs Registry](governance/legacy-docs-registry.md) — how Mini-Yonder tracks docs not yet migrated, and flags unaccounted ones.

Reusable scaffolds live in `docs/_templates/` (screen-contract, flow-contract,
audit, decision-record, release-note, runbook); they are exempt from validation.

Mini-Yonder also **sees the legacy documents** outside this site (`README.md`,
`ROADMAP.md`, `docs/**`): `npm run validate:registry` validates the legacy
registry and warns about any unaccounted document.

:::note Scope
This is the docs-site governance layer (BD-DOCS-SITE-02). It governs
`docs-site/` only — never the runtime PWA in `public/`. Documentation is
migrated incrementally, not all at once.
:::
