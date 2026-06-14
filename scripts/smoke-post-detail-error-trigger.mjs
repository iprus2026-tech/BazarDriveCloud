// BD-ERROR-01C-D / BD-ERROR-02A-c — static regression smoke for the post-detail flow trigger.
//
// post_detail.js routes a post-detail data-load failure through the global
// app-shell overlay via the shared data_layer.loadResource adapter (the per-screen
// loadDetailPosts wrapper was consolidated into data_layer.js in 02A). This smoke
// asserts the DELEGATION — the renderDetail load goes through
// loadResource(listFeedPosts, …) and post_detail never reads listFeedPosts()
// outside that wrapper; the screen's own missing state is preserved. The
// guarded-retry CONTRACT (retrying / onlyIfState dismiss / server_error / []
// fallback) is pinned once in scripts/smoke-data-layer.mjs.
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

// ── A. delegation to the shared adapter ──────────────────────
expect('post_detail.js imports loadResource from ../data_layer.js',
  /import\s*\{\s*loadResource\s*\}\s*from\s*'\.\.\/data_layer\.js'/.test(detail));
expect('post_detail.js no longer defines its own loadDetailPosts wrapper (consolidated in 02A)',
  !functionBody(detail, 'loadDetailPosts'));
expect('post_detail.js no longer imports the overlay adapter directly (it goes through data_layer)',
  !/from\s*'\.\.\/app_error_triggers\.js'/.test(detail));

// ── B. the load goes through loadResource(listFeedPosts, …) ──
expect('initial render runs via renderDetail(false)',
  /await\s+renderDetail\(\s*false\s*\)/.test(detail));
expect('renderDetail(isRetry) loads via loadResource(listFeedPosts, { onRetry: onDetailRetry, isRetry })',
  /async\s+function\s+renderDetail\(\s*isRetry\s*\)[\s\S]{0,160}await\s+loadResource\(\s*listFeedPosts\s*,\s*\{\s*onRetry:\s*onDetailRetry\s*,\s*isRetry\s*\}\s*\)/.test(detail));
expect('post_detail.js reads only through the adapter (no direct listFeedPosts() call)',
  (detail.match(/await\s+listFeedPosts\(\)/g) || []).length === 0,
  'listFeedPosts is passed by reference to loadResource, never called directly in post_detail.js');

// ── B2. retry closure re-runs the load, does not pre-dismiss ──
expect('onDetailRetry re-runs the load as a retry (renderDetail(true))',
  /onDetailRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?renderDetail\(\s*true\s*\)/.test(detail));
expect('onDetailRetry does NOT pre-emptively dismiss before the reload result is known',
  !/onDetailRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?dismissAppShellError\(\)/.test(detail));

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
expect('sw.js precaches the shared adapter ./src/data_layer.js',
  /['"]\.\/src\/data_layer\.js['"]/.test(sw));
expect('sw.js VERSION bumped to v135+',
  Number(sw.match(/VERSION\s*=\s*'v(\d+)'/)?.[1] || 0) >= 135);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
