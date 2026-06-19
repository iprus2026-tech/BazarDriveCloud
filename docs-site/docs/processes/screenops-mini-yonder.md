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

Planned local dev URL: `/ops/screens`.

`/ops/screens` is the future local PWA/dev route for the runtime ScreenOps module. This docs-only slice documents the contract and render direction; it does not implement that runtime route.

It must not appear in the normal product tabbar.

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
- Planned local dev URL is documented as future runtime work.
- Render assets are attached to this manual.
- Issue 623 remains the tracker.
