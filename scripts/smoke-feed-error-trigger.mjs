// BD-ERROR-01C-B — static regression smoke for the first real flow trigger.
//
// feed.js routes a feed data-load failure through the global app-shell overlay
// via the BD-ERROR-01C-A adapter (reportAppShellError). This is a defensive
// wire: listFeedPosts() does not reject today, so the catch is dormant — but
// the wiring must stay in place so a future data-layer/backend failure surfaces
// the global error instead of silently rendering an empty feed. The feed's own
// empty state must be preserved (the global overlay is additive, not a
// replacement). A refactor could drop the try/catch, swallow the error without
// reporting, replace the feed empty state, or re-route the global error — and
// `node scripts/check.mjs` would still pass.
//
// This script is intentionally STATIC: it reads source and asserts the
// contract holds. No browser, no DOM, no network.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const feed = read('../public/src/screens/feed.js');
const app  = read('../public/src/app.js');
const sw   = read('../public/sw.js');

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
expect('feed.js imports reportAppShellError + dismissAppShellError from ../app_error_triggers.js',
  /import\s*\{[\s\S]*?reportAppShellError[\s\S]*?dismissAppShellError[\s\S]*?\}\s*from\s*'\.\.\/app_error_triggers\.js'/.test(feed));

// ── B. the data load is wrapped in try/catch that reports ────
const loadBody = functionBody(feed, 'loadFeedPosts');
expect('feed.js has a loadFeedPosts() wrapper', !!loadBody);
expect('loadFeedPosts() awaits listFeedPosts() inside a try',
  !!loadBody && /try\s*\{[\s\S]*?await\s+listFeedPosts\(\)/.test(loadBody));
expect('loadFeedPosts() catch reports server_error to the global overlay',
  !!loadBody && /catch[\s\S]*?reportAppShellError\(\s*'server_error'\s*,/.test(loadBody));
expect('loadFeedPosts() passes an onRetry option to the overlay',
  !!loadBody && /reportAppShellError\(\s*'server_error'\s*,\s*onRetry\s*\?\s*\{\s*onRetry\s*\}/.test(loadBody));
expect('loadFeedPosts() falls back to [] (preserves the feed empty state)',
  !!loadBody && /catch[\s\S]*?return\s*\[\s*\]/.test(loadBody));

// ── B2. retry shows progress and dismisses only on success ───
expect('loadFeedPosts() shows a non-blocking retrying state while retrying',
  !!loadBody && /if\s*\(isRetry\)\s*reportAppShellError\(\s*'retrying'\s*\)/.test(loadBody));
expect('loadFeedPosts() dismisses the overlay only AFTER a successful reload',
  !!loadBody && /await\s+listFeedPosts\(\)[\s\S]*?if\s*\(isRetry\)\s*dismissAppShellError\(\)/.test(loadBody));
expect('onFeedRetry re-runs the load as a retry (refreshList(true))',
  /onFeedRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?refreshList\(\s*true\s*\)/.test(feed));
expect('onFeedRetry does NOT pre-emptively dismiss before the reload result is known',
  !/onFeedRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?dismissAppShellError\(\)/.test(feed));

// ── C. both load sites go through the wrapper ────────────────
expect('initial render loads via loadFeedPosts(onFeedRetry, false)',
  /let\s+posts\s*=\s*await\s+loadFeedPosts\(\s*onFeedRetry\s*,\s*false\s*\)/.test(feed));
expect('refreshList(isRetry) loads via loadFeedPosts(onFeedRetry, isRetry)',
  /async\s+function\s+refreshList\(\s*isRetry\s*\)[\s\S]{0,90}await\s+loadFeedPosts\(\s*onFeedRetry\s*,\s*isRetry\s*\)/.test(feed));
expect('feed.js no longer calls listFeedPosts() directly outside the wrapper',
  (feed.match(/await\s+listFeedPosts\(\)/g) || []).length === 1,
  'direct await count should be 1 (only inside loadFeedPosts)');

// ── D. per-screen empty state preserved (additive, not replaced) ─
expect("feed.js still renders its own bd-empty state",
  /class="bd-empty"/.test(feed));

// ── E. additive only — no global error replaces the feed, no /error route ─
expect('feed.js does not hide/replace itself on error (no overlay route change)',
  !/go\(\s*['"`]\/error/.test(feed));
expect('app.js does NOT register an /error route (any quote style)',
  !/register\(\s*['"`]\/error/.test(app));

// ── F. sw precache + version bump ────────────────────────────
expect('sw.js still precaches ./src/screens/feed.js',
  /['"]\.\/src\/screens\/feed\.js['"]/.test(sw));
expect('sw.js still precaches the adapter ./src/app_error_triggers.js',
  /['"]\.\/src\/app_error_triggers\.js['"]/.test(sw));
expect('sw.js VERSION bumped to v124+',
  Number(sw.match(/VERSION\s*=\s*'v(\d+)'/)?.[1] || 0) >= 124);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
