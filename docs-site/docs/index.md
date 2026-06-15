---
id: index
title: BazarDrive Docs
owner: docs-contract-agent
status: draft
revision: "0.1.0"
effectiveFrom: "2026-06-15"
visibleFor: ["internal", "contributors"]
tags: ["index", "overview"]
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

:::note Scope — BD-DOCS-SITE-01
This is the **shell only**. Documentation is migrated incrementally — not all at once.
:::
