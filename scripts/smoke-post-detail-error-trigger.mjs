// BD-ERROR-01C-D — static regression smoke for the post-detail flow trigger.
//
// post_detail.js routes a post-detail data-load failure through the global
// app-shell overlay via the BD-ERROR-01C-A adapter (reportAppShellError),
// mirroring the feed (01C-B) and inbox (01C-C) triggers. This is a defensive
// wire: listFeedPosts() does not reject today, so the catch is dormant — but the
// wiring must stay in place so a future data-layer/backend failure surfaces the
// global error instead of silently rendering the "not found" state. The screen's
// own missing/empty state must be preserved (the global overlay is additive, not
// a replacement). A refactor could drop the try/catch, swallow the error without
// reporting, replace the missing state, or re-route the global error — and
// `node scripts/check.mjs` would still pass.
//
// This script is intentionally STATIC: it reads source and asserts the
// contract holds. No browser, no DOM, no network.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const detail = read('../public/src/screens/post_detail.js');
const app    = read('../public/src/app.js');
const sw     = read('../public/sw.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// Extract a function body by name via brace matching.
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) return null;
  const open = source.indexOf('{', start);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

// ── A. adapter import (report + dismiss) ─────────────────────
expect('post_detail.js imports reportAppShellError + dismissAppShellError from ../app_error_triggers.js',
  /import\s*\{[\s\S]*?reportAppShellError[\s\S]*?dismissAppShellError[\s\S]*?\}\s*from\s*'\.\.\/app_error_triggers\.js'/.test(detail));

// ── B. the data load is wrapped in try/catch that reports ────
const loadBody = functionBody(detail, 'loadDetailPosts');
expect('post_detail.js has a loadDetailPosts() wrapper', !!loadBody);
expect('loadDetailPosts() awaits listFeedPosts() inside a try',
  !!loadBody && /try\s*\{[\s\S]*?await\s+listFeedPosts\(\)/.test(loadBody));
expect('loadDetailPosts() catch reports server_error to the global overlay',
  !!loadBody && /catch[\s\S]*?reportAppShellError\(\s*'server_error'\s*,/.test(loadBody));
expect('loadDetailPosts() passes an onRetry option to the overlay',
  !!loadBody && /reportAppShellError\(\s*'server_error'\s*,\s*onRetry\s*\?\s*\{\s*onRetry\s*\}/.test(loadBody));
expect('loadDetailPosts() falls back to [] (preserves the missing/empty state)',
  !!loadBody && /catch[\s\S]*?return\s*\[\s*\]/.test(loadBody));

// ── B2. retry shows progress and dismisses only on success ───
expect('loadDetailPosts() shows a non-blocking retrying state while retrying',
  !!loadBody && /if\s*\(isRetry\)\s*reportAppShellError\(\s*'retrying'\s*\)/.test(loadBody));
expect('loadDetailPosts() dismisses the overlay only AFTER a successful reload, guarded by onlyIfState',
  !!loadBody && /await\s+listFeedPosts\(\)[\s\S]*?if\s*\(isRetry\)\s*dismissAppShellError\(\s*\{\s*onlyIfState:\s*'retrying'\s*\}\s*\)/.test(loadBody));
expect('onDetailRetry re-runs the load as a retry (renderDetail(true))',
  /onDetailRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?renderDetail\(\s*true\s*\)/.test(detail));
expect('onDetailRetry does NOT pre-emptively dismiss before the reload result is known',
  !/onDetailRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?dismissAppShellError\(\)/.test(detail));

// ── C. both load sites go through the wrapper ────────────────
expect('initial render runs via renderDetail(false)',
  /await\s+renderDetail\(\s*false\s*\)/.test(detail));
expect('renderDetail(isRetry) loads via loadDetailPosts(onDetailRetry, isRetry)',
  /async\s+function\s+renderDetail\(\s*isRetry\s*\)[\s\S]{0,120}await\s+loadDetailPosts\(\s*onDetailRetry\s*,\s*isRetry\s*\)/.test(detail));
expect('post_detail.js no longer calls listFeedPosts() directly outside the wrapper',
  (detail.match(/await\s+listFeedPosts\(\)/g) || []).length === 1,
  'direct await count should be 1 (only inside loadDetailPosts)');

// ── D. per-screen missing state preserved (additive, not replaced) ─
expect("post_detail.js still renders its own missing/empty state",
  /post-detail__missing/.test(detail));

// ── E. additive only — no global error replaces the screen, no /error route ─
expect('post_detail.js does not re-route to a global error route on failure',
  !/go\(\s*['"`]\/error/.test(detail));
expect('app.js does NOT register an /error route (any quote style)',
  !/register\(\s*['"`]\/error/.test(app));

// ── F. sw precache + version bump ────────────────────────────
expect('sw.js still precaches ./src/screens/post_detail.js',
  /['"]\.\/src\/screens\/post_detail\.js['"]/.test(sw));
expect('sw.js still precaches the adapter ./src/app_error_triggers.js',
  /['"]\.\/src\/app_error_triggers\.js['"]/.test(sw));
expect('sw.js VERSION bumped to v129+',
  Number(sw.match(/VERSION\s*=\s*'v(\d+)'/)?.[1] || 0) >= 129);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
