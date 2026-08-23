// BD-ERROR-01C-E / BD-ERROR-02A-d — static regression smoke for the respond flow trigger.
//
// respond.js routes a post-lookup data-load failure through the global app-shell
// overlay via the shared data_layer.loadResource adapter (the per-screen
// loadRespondPosts wrapper was consolidated into data_layer.js in 02A). This
// smoke asserts the DELEGATION — the renderRespond load goes through
// loadResource(listFeedPosts, …) and respond never reads listFeedPosts() outside
// that wrapper; the screen's own missing state is preserved. The guarded-retry
// CONTRACT (retrying / onlyIfState dismiss / server_error / [] fallback) is
// pinned once in scripts/smoke-data-layer.mjs.
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

// ── A. delegation to the shared adapter ──────────────────────
expect('respond.js imports loadResource from ../data_layer.js',
  /import\s*\{\s*loadResource\s*\}\s*from\s*'\.\.\/data_layer\.js'/.test(respond));
expect('respond.js no longer defines its own loadRespondPosts wrapper (consolidated in 02A)',
  !functionBody(respond, 'loadRespondPosts'));
expect('respond.js no longer imports the overlay adapter directly (it goes through data_layer)',
  !/from\s*'\.\.\/app_error_triggers\.js'/.test(respond));

// ── B. the load goes through loadResource(listFeedPosts, …) ──
expect('initial render runs via renderRespond(false)',
  /await\s+renderRespond\(\s*false\s*\)/.test(respond));
expect('renderRespond(isRetry) loads via loadResource(listFeedPosts, { onRetry: onRespondRetry, isRetry, isActive: isCurrent })',
  /async\s+function\s+renderRespond\(\s*isRetry\s*\)[\s\S]{0,160}await\s+loadResource\(\s*listFeedPosts\s*,\s*\{\s*onRetry:\s*onRespondRetry\s*,\s*isRetry\s*,\s*isActive:\s*isCurrent\s*\}\s*\)/.test(respond));
// BD-ROUTER-LIFECYCLE-01A P2 (PR #918 review) — isActive must be wired to a
// staleness check, not omitted or hard-coded true, so a resumed stale load
// cannot raise the overlay via loadResource's own reportAppShellError.
// BD-ROUTER-LIFECYCLE-01A P2 follow-up (ABA fix) — a hash-equality check is
// wrong for an A→B→A navigation (the hash matches again once the user
// returns, even though a whole new render/generation has since run), so
// respond.js now derives isCurrent from the router's own renderContext
// (isCurrent bound to its generation) instead of comparing hashes.
expect('respond.js accepts an optional renderContext and defines isCurrent from renderContext.isCurrent, falling back to an always-current stub',
  /export\s+default\s+async\s+function\s+respond\(\s*renderContext\s*\)[\s\S]*?const\s+isCurrent\s*=\s*renderContext\s*&&\s*typeof\s+renderContext\.isCurrent\s*===\s*'function'\s*\?\s*renderContext\.isCurrent\s*:\s*\(\)\s*=>\s*true;/.test(respond));
expect('respond.js no longer derives staleness from window.location.hash (removed in the ABA fix)',
  !/const\s+startHash\s*=\s*window\.location\.hash/.test(respond));
expect('respond.js reads only through the adapter (no direct listFeedPosts() call)',
  (respond.match(/await\s+listFeedPosts\(\)/g) || []).length === 0,
  'listFeedPosts is passed by reference to loadResource, never called directly in respond.js');

// ── B2. retry closure re-runs the load, does not pre-dismiss ──
expect('onRespondRetry re-runs the load as a retry (renderRespond(true))',
  /onRespondRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?renderRespond\(\s*true\s*\)/.test(respond));
expect('onRespondRetry does NOT pre-emptively dismiss before the reload result is known',
  !/onRespondRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?dismissAppShellError\(\)/.test(respond));

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
expect('sw.js precaches the shared adapter ./src/data_layer.js',
  /['"]\.\/src\/data_layer\.js['"]/.test(sw));
expect('sw.js VERSION bumped to v136+',
  Number(sw.match(/VERSION\s*=\s*'v(\d+)'/)?.[1] || 0) >= 136);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
