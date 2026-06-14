// BD-ERROR-01C-B / BD-ERROR-02A — static regression smoke for the feed flow trigger.
//
// feed.js routes a feed data-load failure through the global app-shell overlay
// via the shared data_layer.loadResource adapter (the per-screen loadFeedPosts
// wrapper was consolidated into data_layer.js in 02A). This smoke asserts the
// DELEGATION — both feed load sites go through loadResource(listFeedPosts, …) and
// feed never reads listFeedPosts() outside that wrapper. The guarded-retry
// CONTRACT itself (retrying / onlyIfState dismiss / server_error / [] fallback)
// is pinned once in scripts/smoke-data-layer.mjs.
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

// ── A. delegation to the shared adapter ──────────────────────
expect('feed.js imports loadResource from ../data_layer.js',
  /import\s*\{\s*loadResource\s*\}\s*from\s*'\.\.\/data_layer\.js'/.test(feed));
expect('feed.js no longer defines its own loadFeedPosts wrapper (consolidated in 02A)',
  !functionBody(feed, 'loadFeedPosts'));
expect('feed.js no longer imports the overlay adapter directly (it goes through data_layer)',
  !/from\s*'\.\.\/app_error_triggers\.js'/.test(feed));

// ── B. both load sites go through loadResource(listFeedPosts, …) ──
expect('initial render loads via loadResource(listFeedPosts, { onRetry: onFeedRetry, isRetry: false })',
  /let\s+posts\s*=\s*await\s+loadResource\(\s*listFeedPosts\s*,\s*\{\s*onRetry:\s*onFeedRetry\s*,\s*isRetry:\s*false\s*\}\s*\)/.test(feed));
expect('refreshList(isRetry) loads via loadResource(listFeedPosts, { onRetry: onFeedRetry, isRetry })',
  /async\s+function\s+refreshList\(\s*isRetry\s*\)[\s\S]{0,90}await\s+loadResource\(\s*listFeedPosts\s*,\s*\{\s*onRetry:\s*onFeedRetry\s*,\s*isRetry\s*\}\s*\)/.test(feed));
expect('both load sites route through loadResource(listFeedPosts, …)',
  (feed.match(/loadResource\(\s*listFeedPosts\s*,/g) || []).length === 2,
  'expected initial + refreshList');
expect('feed.js reads the feed only through the adapter (no direct listFeedPosts() call)',
  (feed.match(/await\s+listFeedPosts\(\)/g) || []).length === 0,
  'listFeedPosts is passed by reference to loadResource, never called directly in feed.js');

// ── B2. retry closure re-runs the load, does not pre-dismiss ──
expect('onFeedRetry re-runs the load as a retry (refreshList(true))',
  /onFeedRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?refreshList\(\s*true\s*\)/.test(feed));
expect('onFeedRetry does NOT pre-emptively dismiss before the reload result is known',
  !/onFeedRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?dismissAppShellError\(\)/.test(feed));

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
expect('sw.js precaches the shared adapter ./src/data_layer.js',
  /['"]\.\/src\/data_layer\.js['"]/.test(sw));
expect('sw.js still precaches the overlay adapter ./src/app_error_triggers.js',
  /['"]\.\/src\/app_error_triggers\.js['"]/.test(sw));
expect('sw.js VERSION bumped to v133+',
  Number(sw.match(/VERSION\s*=\s*'v(\d+)'/)?.[1] || 0) >= 133);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
