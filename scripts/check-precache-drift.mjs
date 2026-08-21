#!/usr/bin/env node
// BD-OPS R3 — precache-drift guard. The single most-repeated Codex catch across the #784 frontend
// cutover (CUT-1..6 + the driver handoff, and #806): a PRECACHED file changed but public/sw.js VERSION
// was NOT bumped, so a cache-first service worker keeps serving the STALE module on installed clients.
//
// Forcing a bump genuinely needs a git BASELINE: a lock/manifest can force "regen on change" but not
// "bump VERSION" (regen-without-bump is a consistent escape). So this compares the complete working
// tree against the merge-base with the PR base and rejects a missing/malformed VERSION, a rollback, or
// a cached-file change without a forward bump. It SKIPS gracefully outside a PR when no git base is
// resolvable; an explicitly supplied PR_BASE_SHA is fail-closed.
//
// Run by .github/workflows/ci.yml on pull_request; also runnable locally on a feature branch
// (defaults the base to origin/main). NOT a check.mjs smoke — check.mjs stays hermetic (no git/network).
//
// The drift set is the UNION of the base + head PRECACHE lists. Local runs include committed, staged,
// unstaged and relevant untracked paths. PR runs evaluate only BASE..HEAD for deterministic CI. Rename
// detection is disabled in both modes so both sides of a rename enter the changed-path set.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import {
  SW_PATH,
  evaluateSwCacheContract,
  splitNulPaths,
} from './lib/sw-cache-contract.mjs';

const prBaseSha = process.env.PR_BASE_SHA?.trim() || '';

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function skip(msg) {
  console.log(`precache-drift: SKIP — ${msg}`);
  process.exit(0);
}
function fail(msg) {
  console.error(`FAIL precache-drift: ${msg}`);
  process.exit(1);
}
function unavailable(msg) {
  if (prBaseSha) {
    fail(msg);
  }
  skip(msg);
}

const baseRef = prBaseSha || 'origin/main';
let base;
try { base = git(['merge-base', baseRef, 'HEAD']).trim(); } catch { base = ''; }
if (!base) unavailable(`no merge-base with ${baseRef} (not a PR context / shallow clone)`);

let changed, baseSw;
try {
  // PR mode is a committed BASE..HEAD contract. Local mode compares BASE to
  // the complete working tree and supplements tracked changes with untracked paths.
  const diffArgs = prBaseSha
    ? ['diff', '--name-only', '-z', '--no-renames', base, 'HEAD', '--']
    : ['diff', '--name-only', '-z', '--no-renames', base, '--'];
  const tracked = splitNulPaths(git(diffArgs));
  const untracked = prBaseSha ? [] : splitNulPaths(git([
    'ls-files', '--others', '--exclude-standard', '-z',
  ]));
  changed = [...new Set([...tracked, ...untracked])];
  baseSw = git(['show', `${base}:${SW_PATH}`]);
} catch (e) {
  unavailable(`could not read the git base/worktree state (${e.message})`);
}

let headSrc;
try {
  headSrc = prBaseSha
    ? git(['show', `HEAD:${SW_PATH}`])
    : fs.readFileSync(SW_PATH, 'utf8');
} catch {
  fail(`${SW_PATH} not present in the evaluated head`);
}

const result = evaluateSwCacheContract({
  baseSource: baseSw,
  headSource: headSrc,
  changedPaths: changed,
});

if (!result.ok) {
  console.error(`FAIL precache-drift: Service Worker cache contract rejected VERSION ${result.baseVersion || '?'} -> ${result.headVersion || '?'}.`);
  for (const error of result.errors) console.error(`  - ${error}`);
  if (result.cachedPaths.length) {
    console.error('Cached file(s) changed:');
    for (const file of result.cachedPaths) console.error(`  - ${file}`);
  }
  process.exit(1);
}

console.log(`precache-drift: OK — ${result.cachedPaths.length} cached file(s) changed; VERSION ${result.baseVersion} -> ${result.headVersion}.`);
process.exit(0);
