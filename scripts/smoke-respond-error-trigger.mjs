// BD-ERROR-01C-E — static regression smoke for the respond flow trigger.
//
// respond.js routes a post-lookup data-load failure through the global
// app-shell overlay via the BD-ERROR-01C-A adapter (reportAppShellError),
// mirroring the feed (01C-B), inbox (01C-C) and post-detail (01C-D) triggers.
// This is a defensive wire: listFeedPosts() does not reject today, so the catch
// is dormant — but the wiring must stay in place so a future data-layer/backend
// failure surfaces the global error instead of silently rendering the "not
// found" state. The screen's own missing/unsupported state must be preserved
// (the global overlay is additive, not a replacement). A refactor could drop the
// try/catch, swallow the error without reporting, replace the missing state, or
// re-route the global error — and `node scripts/check.mjs` would still pass.
//
// This script is intentionally STATIC: it reads source and asserts the
// contract holds. No browser, no DOM, no network.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const respond = read('../public/src/screens/respond.js');
const app     = read('../public/src/app.js');
const sw      = read('../public/sw.js');

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
expect('respond.js imports reportAppShellError + dismissAppShellError from ../app_error_triggers.js',
  /import\s*\{[\s\S]*?reportAppShellError[\s\S]*?dismissAppShellError[\s\S]*?\}\s*from\s*'\.\.\/app_error_triggers\.js'/.test(respond));

// ── B. the data load is wrapped in try/catch that reports ────
const loadBody = functionBody(respond, 'loadRespondPosts');
expect('respond.js has a loadRespondPosts() wrapper', !!loadBody);
expect('loadRespondPosts() awaits listFeedPosts() inside a try',
  !!loadBody && /try\s*\{[\s\S]*?await\s+listFeedPosts\(\)/.test(loadBody));
expect('loadRespondPosts() catch reports server_error to the global overlay',
  !!loadBody && /catch[\s\S]*?reportAppShellError\(\s*'server_error'\s*,/.test(loadBody));
expect('loadRespondPosts() passes an onRetry option to the overlay',
  !!loadBody && /reportAppShellError\(\s*'server_error'\s*,\s*onRetry\s*\?\s*\{\s*onRetry\s*\}/.test(loadBody));
expect('loadRespondPosts() falls back to [] (preserves the missing/empty state)',
  !!loadBody && /catch[\s\S]*?return\s*\[\s*\]/.test(loadBody));

// ── B2. retry shows progress and dismisses only on success ───
expect('loadRespondPosts() shows a non-blocking retrying state while retrying',
  !!loadBody && /if\s*\(isRetry\)\s*reportAppShellError\(\s*'retrying'\s*\)/.test(loadBody));
expect('loadRespondPosts() dismisses the overlay only AFTER a successful reload, guarded by onlyIfState',
  !!loadBody && /await\s+listFeedPosts\(\)[\s\S]*?if\s*\(isRetry\)\s*dismissAppShellError\(\s*\{\s*onlyIfState:\s*'retrying'\s*\}\s*\)/.test(loadBody));
expect('onRespondRetry re-runs the load as a retry (renderRespond(true))',
  /onRespondRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?renderRespond\(\s*true\s*\)/.test(respond));
expect('onRespondRetry does NOT pre-emptively dismiss before the reload result is known',
  !/onRespondRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?dismissAppShellError\(\)/.test(respond));

// ── C. both load sites go through the wrapper ────────────────
expect('initial render runs via renderRespond(false)',
  /await\s+renderRespond\(\s*false\s*\)/.test(respond));
expect('renderRespond(isRetry) loads via loadRespondPosts(onRespondRetry, isRetry)',
  /async\s+function\s+renderRespond\(\s*isRetry\s*\)[\s\S]{0,120}await\s+loadRespondPosts\(\s*onRespondRetry\s*,\s*isRetry\s*\)/.test(respond));
expect('respond.js no longer calls listFeedPosts() directly outside the wrapper',
  (respond.match(/await\s+listFeedPosts\(\)/g) || []).length === 1,
  'direct await count should be 1 (only inside loadRespondPosts)');

// ── D. per-screen missing state preserved (additive, not replaced) ─
expect("respond.js still renders its own missing state",
  /respond__missing/.test(respond));

// ── E. additive only — no global error replaces the screen, no /error route ─
expect('respond.js does not re-route to a global error route on failure',
  !/go\(\s*['"`]\/error/.test(respond));
expect('app.js does NOT register an /error route (any quote style)',
  !/register\(\s*['"`]\/error/.test(app));

// ── F. sw precache + version bump ────────────────────────────
expect('sw.js still precaches ./src/screens/respond.js',
  /['"]\.\/src\/screens\/respond\.js['"]/.test(sw));
expect('sw.js still precaches the adapter ./src/app_error_triggers.js',
  /['"]\.\/src\/app_error_triggers\.js['"]/.test(sw));
expect('sw.js VERSION bumped to v130+',
  Number(sw.match(/VERSION\s*=\s*'v(\d+)'/)?.[1] || 0) >= 130);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
