---
id: BD-DOCS-003
docType: screen-contract
title: Screen Contracts — Overview
owner: docs-contract-agent
status: current
revision: 2026-06-16
effectiveFrom: 2026-06-15
reviewAfter: 2026-12-16
visibleFor: [developer, designer, qa]
sourceOfTruth: docs/screen-contracts.md
related:
  routes: []
  files: ["docs/screen-contracts.md", "docs/flow-contracts.md", "docs/screen-map.md"]
  issues: []
  prs: []
tags: [contracts, screens]
slug: /contracts/screen-contracts-overview
---

# Screen Contracts — Overview

Shipped screen behaviour is pinned by **contracts in the repo**, not by this page. This page is a pointer and reading guide.

- `docs/screen-contracts.md` — per-screen contracts (route, file, storage, states, actions, acceptance).
- `docs/flow-contracts.md` — cross-screen flows.
- `docs/screen-map.md` · `docs/full-flow-map.md` · `docs/screen-transitions.md` — the navigation map.
- `docs/design-registry.json` — the Cloud Design render-gate registry.

## How contracts are enforced

- Static smoke scripts (`scripts/smoke-*.mjs`) pin invariants; `node scripts/check.mjs` runs them.
- A contract documents **shipped** behaviour — when runtime and contract disagree, that is a defect to reconcile, not a doc to invent.

:::note Migration
The full contract text is **not** copied here yet (BD-DOCS-SITE-01 is the shell). Link out to the repo files above.
:::
