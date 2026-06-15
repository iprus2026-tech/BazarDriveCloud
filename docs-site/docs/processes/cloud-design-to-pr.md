---
id: BD-DOCS-004
docType: process
title: Cloud Design → PR
owner: docs-contract-agent
status: current
revision: 2026-06-16
effectiveFrom: 2026-06-15
reviewAfter: 2026-12-16
visibleFor: [developer, designer, dispatcher]
sourceOfTruth: docs-site
related:
  routes: []
  files: ["scripts/check.mjs", "scripts/dispatcher.mjs"]
  issues: []
  prs: []
tags: [process, cloud-design]
slug: /processes/cloud-design-to-pr
---

# Cloud Design → PR

The pipeline for turning a Cloud Design render gate into shipped runtime:

1. **Audit (audit-only)** — map the current runtime, smoke, and CSS for the target screen; produce a precise Cloud Design render-gate prompt. No code changes.
2. **Export** — Cloud Design returns the **resolved DOM + CSS** (not external babel chunks). Paste it back.
3. **Redesign-in-place / build** — port onto the repo's own class names and hooks, preserving behaviour and the state machine. Re-point or add smoke pins.
4. **Verify** — drive the real screen in headless Chrome; capture each state.
5. **Checks** — `node scripts/check.mjs` + `node scripts/dispatcher.mjs` green.
6. **PR + review** — open a scoped PR; address review threads (e.g. Codex) before merge; squash-merge only on explicit approval.

## Boundaries

- Don't invent in-screen UI without a render frame.
- Keep PRs small and scoped; never work directly on `main`.
- UI-only / mock unless a backend issue says otherwise.
