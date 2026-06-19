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
  files: ["docs-site/static/img/screenops/01-mini-yonder-docs-entry.svg"]
  issues: [623]
  prs: []
tags: [process, screenops, mini-yonder, docs]
slug: /processes/screenops-mini-yonder
---

# Mini Yonder ScreenOps

ScreenOps is a Mini Yonder Docs feature.

Preferred docs URL: `/docs/screenops`.

Local dev URL: `/ops/screens`.

It must not appear in the normal product tabbar.

## Render

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
- Preferred docs URL is documented.
- Local dev URL is documented.
- Render asset is attached.
- Issue 623 remains the tracker.
