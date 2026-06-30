#!/usr/bin/env node
// BD-OPS R3 — precache-drift guard. The single most-repeated Codex catch across the #784 frontend
// cutover (CUT-1..6 + the driver handoff, and #806): a PRECACHED file changed but public/sw.js VERSION
// was NOT bumped, so a cache-first service worker keeps serving the STALE module on installed clients.
//
// Forcing a bump genuinely needs a git BASELINE: a lock/manifest can force "regen on change" but not
// "bump VERSION" (regen-without-bump is a consistent escape). So this compares the working tree (HEAD)
// against the merge-base with the PR base and fails iff a file in the sw.js PRECACHE set changed while
// the VERSION line stayed the same. It SKIPS gracefully when no git base is resolvable (e.g. a plain
// push, a shallow clone, or a fresh repo), so it only ever gates a real PR diff.
//
// Run by .github/workflows/ci.yml on pull_request; also runnable locally on a feature branch
// (defaults the base to origin/main). NOT a check.mjs smoke — check.mjs stays hermetic (no git/network).
//
// The drift set is the UNION of the base + head PRECACHE lists, so a file edited AND removed from
// PRECACHE in the same PR (still live in the unchanged-VERSION cache on installed clients) is still
// caught (Codex #808). Residual edge: a pure rename with no content change to a precached URL.

import { execSync } from 'node:child_process';
import fs from 'node:fs';

const SW = 'public/sw.js';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}
function skip(msg) {
  console.log(`precache-drift: SKIP — ${msg}`);
  process.exit(0);
}

function parseVersion(src) {
  const m = src.match(/const\s+VERSION\s*=\s*'([^']+)'/);
  return m ? m[1] : null;
}
// PRECACHE array entries are './…' paths relative to public/. Map each to its repo path so we can
// intersect with `git diff --name-only`. A bare './' (cache the app root) maps to public/index.html.
function parsePrecacheRepoPaths(src) {
  const block = src.match(/const\s+PRECACHE\s*=\s*\[([\s\S]*?)\]/);
  if (!block) return [];
  const out = [];
  for (const m of block[1].matchAll(/'(\.\/[^']*)'/g)) {
    const rel = m[1].replace(/^\.\//, '');
    out.push('public/' + (rel === '' ? 'index.html' : rel));
  }
  return out;
}

const baseRef = process.env.PR_BASE_SHA || 'origin/main';
let base;
try { base = sh(`git merge-base ${baseRef} HEAD`); } catch { base = ''; }
if (!base) skip(`no merge-base with ${baseRef} (not a PR context / shallow clone)`);

let changed, baseSw;
try {
  changed = new Set(sh(`git diff --name-only ${base} HEAD`).split('\n').filter(Boolean));
  baseSw = sh(`git show ${base}:${SW}`);
} catch (e) {
  skip(`could not read the git base state (${e.message})`);
}

let headSrc;
try { headSrc = fs.readFileSync(SW, 'utf8'); } catch { skip(`${SW} not present in the working tree`); }

const headVersion = parseVersion(headSrc);
const baseVersion = parseVersion(baseSw);
// Drift set = base PRECACHE ∪ head PRECACHE. Including the BASE list catches a file that is edited AND
// dropped from the head PRECACHE in the SAME PR without a bump (Codex #808): installed clients still
// hold it in the unchanged-VERSION `bazardrive-vNNN` cache and `sw.js` serves caches.match before the
// network, while activation only purges a DIFFERENT CACHE_NAME — so it still needs a bump.
const precache = new Set([...parsePrecacheRepoPaths(headSrc), ...parsePrecacheRepoPaths(baseSw)]);
const precacheChanged = [...changed].filter((f) => precache.has(f) && f !== SW);

if (precacheChanged.length && headVersion && headVersion === baseVersion) {
  console.error(`FAIL precache-drift: ${precacheChanged.length} PRECACHED file(s) changed but ${SW} VERSION did not bump (still '${headVersion}').`);
  console.error('A cache-first service worker would keep serving the stale module(s) on installed clients:');
  for (const f of precacheChanged) console.error(`  - ${f}`);
  console.error(`Fix: bump VERSION in ${SW} (and add a one-line header note recording what precached files changed).`);
  process.exit(1);
}

console.log(`precache-drift: OK — ${precacheChanged.length} precached file(s) changed; VERSION ${baseVersion} -> ${headVersion}.`);
process.exit(0);
