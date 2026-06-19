---
id: BD-DOCS-040
docType: process
title: Mini Yonder ScreenOps
owner: docs-contract-agent
status: draft
revision: 2026-06-19
effectiveFrom: 2026-06-19
reviewAfter: 2026-12-19
visibleFor: [developer, designer, dispatcher]
sourceOfTruth: docs-site
related:
  routes: []
  files: ["docs-site/static/img/screenops/00-screenops-render-set.svg", "docs-site/static/img/screenops/01-mini-yonder-docs-entry.svg"]
  issues: [623]
  prs: []
tags: [process, screenops, mini-yonder, docs]
slug: /docs/screenops
---

# Mini Yonder ScreenOps

ScreenOps is a **Mini Yonder Docs** feature.

Preferred docs URL: `/docs/screenops`.

Local dev URL: `/ops/screens`.

`/ops/screens` is the local PWA/dev route for the runtime ScreenOps module, shipped by BD-OPS-03. This manual documents the contract and render direction; the runtime dashboard is implemented.

It must not appear in the normal product tabbar.

## ScreenOps Control

Use this block as the operational entry point for ScreenOps work inside Mini Yonder Docs.

ScreenOps Control is the working surface for UI drift repair: find a defect, create a MEL card, generate the design prompt, prepare the issue body, generate the code-agent prompt, move into a scoped branch, run smoke/check, and open a PR.

| Control | Target | Current status |
| --- | --- | --- |
| Open ScreenOps | `/ops/screens` | Runtime/dev route — implemented in BD-OPS-03 |
| Run defect search | Defect Search panel | Planned ScreenOps action |
| View MEL cards | MEL cards panel | Planned ScreenOps action |
| Generate design prompt | Prompt generator panel | Planned ScreenOps action |
| Prepare repair PR | GitHub issue body + code-agent prompt | Planned ScreenOps workflow |

**Workflow:** defect → MEL card → design prompt → issue body → code prompt → scoped branch → smoke/check → PR.

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

- Docs entry card
- Screen registry
- MEL card detail
- Design prompt preview
- Search panel

## Acceptance

- ScreenOps is documented as a docs feature.
- Preferred docs URL is documented and backed by the page slug.
- Local dev URL `/ops/screens` is documented and implemented in BD-OPS-03.
- Render assets are attached to this manual.
- Issue 623 remains the tracker.
- ScreenOps Control block is present before the Render set.
- The block marks `/ops/screens` as implemented in BD-OPS-03.
- The block keeps ScreenOps inside Mini Yonder Docs, not product navigation.
