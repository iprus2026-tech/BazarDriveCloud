---
id: BD-DOCS-005
docType: process
title: Release Notes Process
owner: docs-contract-agent
status: current
revision: 2026-06-16
effectiveFrom: 2026-06-15
reviewAfter: 2026-12-16
visibleFor: [developer, product, dispatcher]
sourceOfTruth: CLAUDE.md
related:
  routes: []
  files: ["CLAUDE.md"]
  issues: []
  prs: []
tags: [process, release]
slug: /processes/release-notes
---

# Release Notes Process

Per `CLAUDE.md`, releases are **not** automatic. Tags, GitHub Releases, changelog files, and version bumps are created only when a task explicitly asks.

## Per-PR (normal feature / docs)

State in the PR body whether the change is release-facing or internal-only, and include the **Release impact** block:

- User-visible change
- Runtime change
- Docs/reference change
- Migration needed
- Cache / service worker impact
- Follow-up issues

Docs-only PRs use the short form (no user-visible runtime change, docs/reference update, no cache/SW impact).

## On an explicit release request

Collect merged PRs since the previous release, group by passenger / driver / shared / infrastructure / docs, list breaking changes and migrations first, include check results, and create tags / Releases only after explicit approval.
