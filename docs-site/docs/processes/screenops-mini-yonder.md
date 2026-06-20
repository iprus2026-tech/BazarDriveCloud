---
id: BD-DOCS-040
docType: process
title: Mini Yonder ScreenOps
owner: docs-contract-agent
status: draft
revision: 2026-06-21
effectiveFrom: 2026-06-19
reviewAfter: 2026-12-19
visibleFor: [developer, designer, dispatcher]
sourceOfTruth: docs-site
related:
  routes: []
  files: ["docs-site/static/img/screenops/00-screenops-render-set.svg", "docs-site/static/img/screenops/01-mini-yonder-docs-entry.svg"]
  issues: [623, 646, 647, 648]
  prs: [649, 650, 652]
tags: [process, screenops, mini-yonder, docs]
slug: /docs/screenops
---

# Mini Yonder ScreenOps

ScreenOps is a **Mini Yonder Docs** feature.

Preferred docs URL: `/docs/screenops`.

Local dev URL: `/ops/screens`.

`/ops/screens` is the local PWA/dev route for the runtime ScreenOps module, shipped by BD-OPS-03. This manual documents the contract and render direction; the runtime dashboard is implemented — including the screen registry (full route coverage + a bidirectional drift gate), the MEL card lifecycle, the registry open-MEL badges and filters, and the prompt generators (Tier-1: BD-OPS-07/08/09).

It must not appear in the normal product tabbar.

## ScreenOps Control

Use this block as the operational entry point for ScreenOps work inside Mini Yonder Docs.

ScreenOps Control is the working surface for UI drift repair: find a defect, create a MEL card, generate the design prompt, prepare the issue body, generate the code-agent prompt, move into a scoped branch, run smoke/check, and open a PR.

| Control | Target | Current status |
| --- | --- | --- |
| Open ScreenOps | `/ops/screens` | Runtime/dev route — implemented in BD-OPS-03 |
| Find a crooked screen | Registry search + role/severity/status filters + per-row open-MEL badge | Implemented — BD-OPS-09 (#648) |
| Create / manage MEL cards | New-MEL editor + per-card status-advance + delete | Implemented — BD-OPS-08 (#647) |
| Generate design prompt | Cloud Design prompt | Implemented — BD-OPS-03b connectors |
| Prepare repair PR | GitHub issue body + Claude Code prompt + Copy check commands | Implemented — BD-OPS-03b connectors |

**Workflow:** defect → MEL card → design prompt → issue body → code prompt → scoped branch → smoke/check → PR.

The registry covers every product route registered in `public/src/app.js`; a bidirectional drift gate in `scripts/smoke-ops-screens.mjs` fails the build if a screen is added without a registry decision (BD-OPS-07, #646).

This manual is the source of truth for the ScreenOps contract, stack, flow, and render direction; `/ops/screens` implements it (BD-OPS-03).

## Render set

![ScreenOps render set](/img/screenops/00-screenops-render-set.svg)

## Docs entry render

![Mini Yonder Docs entry](/img/screenops/01-mini-yonder-docs-entry.svg)

## Stack

```text
Mini Yonder Docs
ScreenOps module
screen registry
MEL cards
prompt generators
checks
PR workflow
```

## Flow

```text
find screen problem
create MEL card
generate design prompt
generate issue body
generate code prompt
work in scoped branch
run checks
open PR
```

## Required panels

The shipped dashboard (`/ops/screens`) provides:

- **Screen registry** — every product route, with a text search, role / severity / status filters, and a per-row open-MEL badge (top open *defect* severity · count). `WAITING`/`OK` are MEL lifecycle states, not defects, so they drive neither the badge nor the severity filter.
- **Screen detail** — the selected screen's id / route / file / role / contract / design / MEL status, plus actions: Open screen, Mark as Crooked, Cloud Design prompt, GitHub issue, Claude Code prompt, Copy check commands.
- **MEL cards** — a New-MEL editor (severity, status, problem, operational decision, required repair), a per-card status-advance control (`DETECTED → … → DONE`), and a per-card delete (with confirm). MEL cards persist in `localStorage` under `bazardrive.ops.mel.v1`, deliberately outside the user-scoped storage boundary (a normal logout must not wipe them).
- **Generated-prompt output** — the generated Cloud Design / GitHub issue / Claude Code text with a copy control.

## Acceptance

- ScreenOps is documented as a docs feature.
- Preferred docs URL is documented and backed by the page slug.
- Local dev URL `/ops/screens` is documented and implemented in BD-OPS-03.
- The registry coverage + drift gate, the MEL card lifecycle, the open-MEL badges and filters, and the prompt generators are documented as **shipped** (Tier-1: BD-OPS-07/08/09), not planned.
- Render assets are attached to this manual.
- Issue 623 remains the original tracker; #646 / #647 / #648 track the Tier-1 phases.
- ScreenOps Control block is present before the Render set.
- The block marks `/ops/screens` as implemented in BD-OPS-03.
- The block keeps ScreenOps inside Mini Yonder Docs, not product navigation.
