# AGENTS.md — agent control rules

This repository is worked by multiple coding agents and human operators. Treat this file as the shared traffic-control tower for Codex, Claude Code, ChatGPT-assisted CLI sessions, and any future repo agents.

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
5. Run the checks named in the task.
6. Stop before commit unless the human explicitly approved commit and push.

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

Common checks:

```bash
node scripts/check.mjs
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

Run only checks that are relevant and available in the current environment. If a tool is missing, report that honestly and provide the fallback used.

## Service worker rule

If a precached runtime file under `public/` changes, update `public/sw.js` `VERSION` and ensure the relevant smoke/check pins remain current.

Do not bump the service worker for documentation-only changes.

## ScreenOps route policy

`/ops/screens` is a dev/docs route. It must not appear in the product tabbar and must not show product chrome. Keep this covered by `scripts/smoke-ops-screens.mjs`.

## Dependabot PRs

Handle Dependabot PRs one at a time:

1. Audit the diff and release notes.
2. Rebase with `@dependabot rebase` when the base branch is stale.
3. Wait for fresh CI.
4. Merge only when checks are green and the change is scoped.
5. If checks fail, do not merge. Investigate or close/recreate as appropriate.

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
