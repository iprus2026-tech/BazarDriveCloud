---
id: BD-DOCS-004
docType: process
title: Cloud Design → PR
owner: docs-contract-agent
status: current
revision: 2026-06-18
effectiveFrom: 2026-06-18
reviewAfter: 2026-12-18
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

1. **Audit (audit-only)** — map the current runtime, smoke, and CSS for the target screen (or, for a multi-screen prototype, the whole flow — every screen plus the transitions between them); produce a precise Cloud Design render-gate prompt. No code changes.
2. **Export** — Cloud Design returns the **resolved DOM + CSS** (not external babel chunks). A **multi-screen interactive prototype** exports as the resolved DOM + CSS **per screen plus its navigation/transition map**. Paste it back.
3. **Redesign-in-place / build** — port onto the repo's own class names and hooks, preserving behaviour and the state machine. For a flow, port each screen and wire its transitions through the existing router (`public/src/router.js` / `app.js`) — do not introduce a parallel navigation model. Re-point or add smoke pins.
4. **Verify** — drive the real screen in headless Chrome; capture each state.
5. **Checks** — `node scripts/check.mjs` + `node scripts/dispatcher.mjs` green.
6. **PR + review** — open a scoped PR; address review threads (e.g. Codex) before merge; squash-merge only on explicit approval.

## Multi-screen interactive prototypes

Cloud Design can now produce **multi-screen interactive prototypes** — a connected
flow of several screens with the transitions between them, not just a single render
frame. This lets a whole flow (e.g. onboarding, or order → responses → active ride)
be prototyped and reviewed before implementation.

Ingesting a flow:

- **Scope it against the flow contracts** — `docs/flow-contracts.md`,
  `docs/full-flow-map.md`, and `docs/screen-transitions.md` are the source of truth
  for which screens and transitions are real; the prototype maps onto them, it does
  not invent routes.
- **One screen per scoped change** — a multi-screen prototype is still landed as
  small, scoped PRs (one screen / transition at a time), never one giant PR.
- **Transitions go through the runtime router** — reuse `go(...)` and registered
  routes; the prototype's own navigation is a reference, not the implementation.
- The access boundary is unchanged: an **exported artifact** is required; a
  `claude.ai/design` share link is not agent-readable (see CLAUDE.md → Design
  ingestion bridge).

## Boundaries

- Don't invent in-screen UI without a render frame.
- Keep PRs small and scoped; never work directly on `main`.
- UI-only / mock unless a backend issue says otherwise.
