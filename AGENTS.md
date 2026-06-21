# AGENTS.md — agent control rules

This repository is worked by multiple coding agents and human operators. This file holds the shared **operational** rules — session routing, worktrees, protected commands, checks — for Codex, Claude Code, ChatGPT-assisted CLI sessions, and any future repo agents.

## Authority

`CLAUDE.md` (repo root) is the **top control document and outranks this file**. AGENTS.md is a cross-agent operations layer that **complements CLAUDE.md and never overrides it** — it is not an independent control tower. For authority/precedence, PR review-thread discipline, the merge gate and merge approval, the branch/merge method (squash), and design/docs governance, **CLAUDE.md is authoritative** (see its *Authority order* and *Merge rules*). Where this file and CLAUDE.md overlap, CLAUDE.md wins unless CLAUDE.md explicitly delegates the topic here.

## Prime directive

Do not damage another active session's work. Prefer a smaller safe PR over a broad clever one.

## Session routing

- Use a dedicated worktree for every non-trivial task.
- Never run two agents in the same working directory.
- Never switch a branch that is already checked out by another worktree.
- Before starting work, run:

```bash
git status --short --branch
git worktree list
```

If the target branch is already used by another worktree, create or use a different worktree instead of forcing checkout.

## Branch rules

- Use task-scoped branch names, for example:
  - `audit/<topic>` for audit-only work.
  - `fix/<topic>` for runtime fixes.
  - `docs/<topic>` for documentation-only work.
  - `chore/<topic>` for dependency/config maintenance.
- Do not commit directly to `main`.
- Do not force-push unless the human explicitly authorizes it for a known disposable branch.

## Audit-only mode

When a prompt says `audit-only`:

- Do not edit files.
- Do not run `apply_patch`.
- Do not run `git add`, `git commit`, `git push`, `git stash`, `git reset`, or `git clean`.
- Read files, run safe checks, and produce a plan.
- Stop and wait for explicit `go` before changing anything.

## Write mode

When the human says `go`:

1. Restate the intended scope.
2. Change only the approved files.
3. Prefer explicit file staging, never `git add .`.
4. Show `git diff --stat` and the relevant diff before commit.
5. Run the checks named in the task. If none are named, default to `node scripts/check.mjs`
   and `node scripts/dispatcher.mjs`, plus any area-specific checks below.
6. Stop before commit unless the human explicitly approved it; treat commit and push as
   separate approvals (approval to commit is not approval to push).

## Protected commands

Do not run these without explicit human approval:

```bash
git reset
git clean
git stash pop
git push --force
git commit -a
git add .
rm -rf
npm install
```

Dependency changes should normally come from Dependabot PRs or an explicit dependency task.

## Checks

Common checks (run after a change, and as the post-merge verification):

```bash
node scripts/check.mjs
node scripts/dispatcher.mjs
```

ScreenOps-specific checks:

```bash
node scripts/smoke-ops-screens.mjs
node scripts/check.mjs
```

Server-specific checks:

```bash
cd server && npm test
cd server && npm audit --omit=dev --audit-level=high
```

Docs-site checks:

```bash
cd docs-site && npm run check
```

`npm ci` is the allowed dependency bootstrap — it installs from the committed lockfile without mutating it. Run it in `server/` or `docs-site/` before their checks if `node_modules` is absent. Use `npm ci`, not `npm install` (which is protected — see above).

Run only checks that are relevant and available in the current environment. If a tool is missing, report that honestly and provide the fallback used.

## Service worker rule

If a precached runtime file under `public/` changes, update `public/sw.js` `VERSION` and ensure the relevant smoke/check pins remain current.

Do not bump the service worker for documentation-only changes.

## ScreenOps route policy

`/ops/screens` is a dev/docs route, kept covered by `scripts/smoke-ops-screens.mjs`.
Its constraints (not in the product tabbar, no product chrome) live in CLAUDE.md's
ScreenOps note and the docs-site ScreenOps manual (BD-DOCS-040) — follow those rather
than restating the rules here, to avoid drift.

## PR review threads & merge

CLAUDE.md is authoritative for review/merge; in brief:

- A reply is **not** a resolution — resolve a thread only after the fix is present in the diff.
- Do not merge while **active** threads remain (active = not outdated **and** not resolved).
- If Codex posts new comments after the latest commit, those become the current source of truth.
- Merging requires **explicit human approval** plus a green CI/merge gate; default to a **squash** merge. After merge, run the post-merge verification (the common checks above).

See CLAUDE.md *PR review thread discipline* and *Merge rules* for the full process.

## Dependabot PRs

Handle Dependabot PRs one at a time:

1. Audit the diff and release notes.
2. Rebase with `@dependabot rebase` when the base branch is stale.
3. Wait for fresh CI.
4. Do **not** merge autonomously. Merge only after the human **explicitly approves**, and
   only when checks are green and the change is scoped — CLAUDE.md's merge gate and
   merge-approval rule apply to Dependabot PRs too.
5. If checks fail, do not merge. Investigate or close/recreate as appropriate.
6. After merge, run the post-merge verification (`node scripts/check.mjs` and
   `node scripts/dispatcher.mjs`).

Do not batch server dependency PRs unless the human explicitly asks for a batch.

## Termux / Ubuntu / proot notes

On Android Termux/proot, Codex sandboxing can fail with `bwrap` / namespace errors. If that happens:

- Keep the approval mode strict.
- Prefer read-only audit commands first.
- Escalate only safe read/check commands when needed.
- Avoid destructive git operations in the affected session.

Browser automation may be unavailable. In that case, use manual Chrome QA and record observed PASS/FAIL results.

## PR body template

Use this shape for small PRs:

```markdown
Summary:
- change 1
- change 2

Checks:
- command/result
- manual result, if applicable
```

## Handoff note

At the end of a session, report:

- branch/worktree used;
- files changed;
- checks run and results;
- PR link, if created;
- whether local working tree is clean;
- any active risks or pending follow-ups.
