---
id: BD-DOCS-021
docType: process
title: Mini-Yonder Self Inventory
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
    - docs-site/governance/mini-yonder-core.json
    - docs-site/scripts/validate-mini-yonder-core.mjs
  issues: ["BD-DOCS-SITE-04B"]
  prs: []
tags:
  - mini-yonder
  - governance
  - self-inventory
slug: /governance/mini-yonder-self-inventory
---

# Mini-Yonder Self Inventory

Mini-Yonder governs documents (frontmatter passports) and tracks legacy docs
(the registry). The **self inventory** closes the loop on a third question:
*which files are Mini-Yonder itself?* It lets the governance layer see its own
core — its validators, registry, governance docs, config, workflow, and policy —
without turning that visibility into a recursive, self-expanding inventory.

## How Mini-Yonder sees its own files

`docs-site/governance/mini-yonder-core.json` is a hand-maintained **core
manifest**. Each entry names one core file and describes it:

```json
{
  "id": "BD-MY-CORE-003",
  "path": "docs-site/scripts/validate-frontmatter.mjs",
  "kind": "validator",
  "area": "mini-yonder",
  "criticality": "high",
  "requires": ["npm run validate:frontmatter", "npm run validate:self", "npm run check"],
  "reason": "Frontmatter passport validator. Validator changes require negative tests."
}
```

`docs-site/scripts/validate-mini-yonder-core.mjs` (`npm run validate:self`, also
run inside `npm run check`) validates the manifest strictly.

### What is `mini-yonder-core`?

The `mini-yonder-core` is the set of files the governance layer depends on to
function. They all carry `area: "mini-yonder"`. Allowed `kind` values:

`core-manifest`, `validator`, `registry`, `governance-doc`, `workflow`,
`policy`, `config`, `docusaurus-shell`, `template`.

Allowed `criticality`: `high`, `medium`, `low`.

`requires` lists the checks to run when that file changes; `reason` explains why
the file is core.

## The self-reference loop — and how it's avoided

A naive "inventory everything" approach creates a **self-reference loop**: the
inventory file is itself a file, so inventorying it produces more inventory,
which is itself a file, and so on. Generated build output makes it worse —
scanning `docs-site/build/` re-discovers copies of every doc on every build.

Mini-Yonder avoids the loop with three rules, enforced by `validate:self`:

1. **The manifest may list itself**, but only once, as `kind: core-manifest`
   (`BD-MY-CORE-001`). That is a fixed, bounded self-reference — not a loop.
2. **Generated output must never be a core file.** Any path under a
   `generatedPaths` prefix (`docs-site/build/`, `docs-site/node_modules/`,
   `docs-site/.docusaurus/`, `docs-site/.cache/`, `coverage/`) is rejected.
3. **The validator only reads and validates.** It never writes, generates, or
   "refreshes" an inventory file. The manifest is authored by hand; nothing in
   this layer auto-generates it.

### Why generated files are visible but not self-expanding

The manifest *declares* the generated and ignored path prefixes
(`generatedPaths`, `ignoredPaths`) so the rest of the tooling knows they exist
and where they come from. That is visibility. But because those paths can never
be **core files**, and because no tool walks them to emit more inventory, the
visibility does not expand. Generated artefacts are named, not crawled.

## Checks when changing Mini-Yonder core

When a PR touches a Mini-Yonder core file (a validator, the registry, the
manifest, a governance doc, the docs-site config/shell, the CI workflow, or
`CLAUDE.md`), run the full sequence:

```
cd docs-site
npm run validate:frontmatter
npm run validate:registry
npm run validate:self
npm run check
npm run build
cd ..
node scripts/check.mjs
node scripts/dispatcher.mjs
```

For **validator changes specifically**, the report must also include
**negative tests** proving the validator rejects malformed input (duplicate id,
duplicate path — including the same file under a different spelling, missing
path, a path that escapes the repo root, a generated **or ignored** path used as
a core file, an empty `coreFiles` inventory, a non-string `reason`, an invalid
`kind`, an invalid `criticality`) and then accepts the restored manifest.
