---
id: BD-DOCS-006
docType: process
title: Project Tracking — Mini-Yonder Growth Path
owner: docs-contract-agent
status: current
revision: 2026-06-21
effectiveFrom: 2026-06-18
reviewAfter: 2026-12-18
visibleFor: [developer, dispatcher, product]
sourceOfTruth: docs-site
related:
  routes: []
  files: ["docs-site/docs/governance/mini-yonder-background-services.md"]
  issues: []
  prs: []
tags: [process, project, tracking, mini-yonder]
slug: /processes/project-tracking
---

# Project Tracking — Mini-Yonder Growth Path

How the GitHub Project links the **design backbone** (the ADRs) to the
**development process** (branch → PR → merge).

## The board

**GitHub Project #1 — "BazarDrive — Mini-Yonder Growth Path"**
(`https://github.com/users/iprus2026-tech/projects/1`, linked to the repo) is the
planning view of the
[Mini-Yonder growth path](../governance/mini-yonder-background-services.md)
(BD-DOCS-023). One item per service / phase; a single-select **Design State**
field is the spine:

| Design State | Meaning |
| --- | --- |
| **Shipped** | Real, running behaviour exists — *where* depends on the phase. **Client-anchor phases** (#5 Ride State Machine, #8 History & Receipt): a client-side equivalent exists in `public/`. **Backend service phases**: the server implementation is merged to `main` and **live** in `/server` — serving real behaviour, `server-ci` green — not a dark `501 NOT_IMPLEMENTED` skeleton, a structured-but-dark seam, a bootable scaffold, or a merged ADR alone. |
| **Designed (ADR)** | A target decision record exists (`status: draft`), but nothing is built — phases BD-DOCS-030–038. |
| **Todo** | An open runtime gap with no ADR and no implementation (e.g. real Mapbox SDK, no-show full lifecycle, node:test coverage). |

The board also carries GitHub's built-in **Status** field (`Todo` / `In Progress`
/ `Done`) for work-in-flight; it is independent of `Design State` — an item can be
`In Progress` (a PR is open) while still `Designed (ADR)` until the phase actually
ships. (`Design State` is the design-maturity spine; **Status** is just
work-tracking.)

## How items map to the process

1. **Todo → Designed (ADR).** A gap starts as **Todo**. When its decision record
   is written and merged (the ADR pipeline — small docs-only PR, `status: draft`),
   its item moves to **Designed (ADR)** and links the BD-DOCS-0xx record.
2. **Designed (ADR) → Shipped.** When the phase actually ships, the item moves to
   **Shipped** — and only then. *Where* it ships depends on the phase: client-anchor
   phases ship in `public/`; backend service phases ship when the server
   implementation is merged to `main` and **live** in `/server` — serving real
   behaviour, `server-ci` green. A draft ADR, or merged-but-dark server code (a dark
   `501 NOT_IMPLEMENTED` skeleton, a structured-but-dark seam, or a bootable
   scaffold), is a target — not shipped behaviour. None of these is `Shipped` on its
   own.
3. **Every change still follows the normal discipline.** Branch off updated
   `main`, one scoped PR, green checks (`scripts/check.mjs` / `dispatcher.mjs`,
   plus the docs-site validators for docs), review threads resolved, squash-merge
   only on explicit approval (see CLAUDE.md). The board reflects that work; it
   does not replace it.

## Boundaries

- The board is a **planning/reference view**, not a source of truth. The sources
  of truth stay the runtime (`public/src/`), the contracts (`docs/`), and the
  docs-site ADRs/governance.
- **Designed (ADR) ≠ shipped.** Phases BD-DOCS-033–038 are `status: draft`;
  keep the board honest about what actually runs.
- Board **views** (e.g. Board grouped by Design State) and any **automations**
  (auto-add, auto-status on merge) are configured in the GitHub web UI — they are
  not part of this repo and not managed by CLI.
- Keep item ↔ ADR links current: each Designed item references its BD-DOCS-0xx
  record; each Todo item names the gap and the phase it would satisfy.
