---
id: BD-DOCS-022
docType: process
title: Repository File Inventory
owner: docs
status: current
revision: 2026-06-16
effectiveFrom: 2026-06-16
reviewAfter: 2026-07-16
visibleFor:
  - developer
  - dispatcher
  - qa
sourceOfTruth: repo
related:
  routes: []
  files:
    - docs-site/scripts/scan-repository-inventory.mjs
  issues: []
  prs: []
tags:
  - mini-yonder
  - governance
  - repository-inventory
  - code-awareness
slug: /governance/repository-file-inventory
---

# Repository File Inventory

The **repository file inventory** is Mini-Yonder's first step toward *code
awareness*: a scan of the whole repository tree that classifies every file onto
a "shelf" and reports how the codebase and the documentation relate. It answers
questions the frontmatter and registry validators cannot — *which file belongs
to which shelf, which legacy docs are still unaccounted, and which runtime files
no document links to.*

It is implemented by `docs-site/scripts/scan-repository-inventory.mjs` and run
with:

```
cd docs-site
npm run inventory:repo
cd ..
```

## Why this is warn-only

This is a **report-only** capability. The scanner classifies and prints; it
**never fails the build** (it exits 0 unless the scanner itself hits a
structural/runtime error), it is **not** part of `npm run check`, and it
**writes no file** — there is no generated inventory artifact.

The reason is deliberate. Awareness comes before enforcement. A strict gate that
fails on every unlinked runtime file or unaccounted legacy doc would block the
whole repository on day one. Instead, the inventory surfaces the picture so the
backlog can be triaged incrementally — exactly as the legacy registry's
`UNACCOUNTED_DOCUMENT` pass does.

## File classes (shelves)

Every scanned file is placed in exactly one class:

| Class | What it is |
|---|---|
| `mini-yonder-core` | A file listed in `mini-yonder-core.json` (validators, the manifest, governance docs, the CI workflow, `CLAUDE.md`, config). |
| `docs-site-doc` | A governed Markdown/MDX page under `docs-site/docs/**` (carries a frontmatter passport). |
| `template` | An authoring scaffold under an underscore-prefixed `docs-site/docs/**` path (e.g. `_templates/`). `collectSiteDocs()` and the frontmatter validator skip these, so they are classified separately rather than counted as governed pages. |
| `legacy-doc` | A legacy document — `README.md`, `ROADMAP.md`, or `docs/**/*.{md,json}` — tracked by the legacy registry. |
| `runtime` | Runtime PWA code under `public/` (JS/CSS/HTML/JSON, the service worker). Excludes `public/prototypes/**`. |
| `smoke` | A check/smoke script under `scripts/**/*.mjs`. |
| `workflow` | A GitHub Actions workflow under `.github/workflows/`. |
| `config` | Configuration (root/docs-site `*.json`/`*.yml`, dotfiles, issue templates). |
| `asset` | Images, fonts, media, and design artifacts (e.g. design PDFs/HTML under `docs/`, and Cloud Design reference exports under `public/prototypes/**`). |
| `generated` | Machine-generated artifacts that are not in an ignored directory (e.g. `package-lock.json`). |
| `unknown` | Anything that does not match a known shelf — surfaced honestly rather than forced into a bucket. |

Generated/dependency directories are **never scanned**: `.git/`,
`node_modules/`, `docs-site/node_modules/`, `build/`, `docs-site/build/`,
`docs-site/.docusaurus/`, `docs-site/.cache/`, `coverage/`.

## Unaccounted legacy docs

A **legacy doc** is in the legacy universe (`README.md`, `ROADMAP.md`,
`docs/**/*.{md,json}`) but **not** listed in
`docs-site/governance/document-registry.json`. The scanner reports these as
`UNACCOUNTED_DOCUMENT` — the same signal as `npm run validate:registry`, kept
warn-only. They are migrated into the registry incrementally; they do not fail
the build.

## Unlinked runtime files

An **unlinked runtime file** is a `runtime` file that **no** docs-site document
references in its frontmatter `related.files`. Reported as `UNLINKED_RUNTIME`,
warn-only. A high unlinked count is expected today — most runtime files are not
yet documented in docs-site. The signal exists so that, over time, the
documentation can grow to cover the code, and so a future impact graph can tell
*which docs to revisit when a given runtime file changes.*

## Why code files carry no passport

Mini-Yonder governs **documents** with frontmatter passports; it does **not**
require a passport on code. Source files, scripts, and configs are classified by
the inventory, but they are not expected to carry `docType`/`owner`/`status`
metadata — that would be noise on a `.js` or `.mjs` file. Code awareness is a
*relationship* (which docs link which files), not a passport on the code itself.

## How this prepares the future impact graph

By classifying files and reading every document's `related.files`, the inventory
builds the raw material for an **impact graph**: an edge set from documents to
the code they describe. A later phase can use it to answer "if `public/src/...`
changes, which docs are stale?" and to make `related.files` coverage a tracked
(eventually gated) metric. This PR only builds the awareness layer — the graph
and any enforcement are future work.

## Out of scope

This capability deliberately does **not**:

- extract or inventory **UI copy** from runtime code,
- compute **git blame / provenance** for files,
- enforce **strict runtime-docs** coverage (it is warn-only),
- promote `UNACCOUNTED_DOCUMENT` from warn to error,
- write any **generated inventory file**.

See [Mini-Yonder Model](mini-yonder-model.md) and
[Mini-Yonder Self Inventory](mini-yonder-self-inventory.md) for the surrounding
governance layer.
