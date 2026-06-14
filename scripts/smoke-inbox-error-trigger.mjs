// BD-ERROR-01C-C / BD-ERROR-02A-b — static regression smoke for the inbox flow trigger.
//
// inbox.js routes an inbox data-load failure through the global app-shell overlay
// via the shared data_layer.loadResource adapter (the per-screen loadInboxItems
// wrapper was consolidated into data_layer.js in 02A). This smoke asserts the
// DELEGATION — both inbox load sites go through loadResource(listInboxItems, …)
// and inbox never reads listInboxItems() outside that wrapper. The guarded-retry
// CONTRACT itself (retrying / onlyIfState dismiss / server_error / [] fallback)
// is pinned once in scripts/smoke-data-layer.mjs.
//
// This script is intentionally STATIC: it reads source and asserts the
// contract holds. No browser, no DOM, no network.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const inbox = read('../public/src/screens/inbox.js');
const app   = read('../public/src/app.js');
const sw    = read('../public/sw.js');

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
expect('inbox.js imports loadResource from ../data_layer.js',
  /import\s*\{\s*loadResource\s*\}\s*from\s*'\.\.\/data_layer\.js'/.test(inbox));
expect('inbox.js no longer defines its own loadInboxItems wrapper (consolidated in 02A)',
  !functionBody(inbox, 'loadInboxItems'));
expect('inbox.js no longer imports the overlay adapter directly (it goes through data_layer)',
  !/from\s*'\.\.\/app_error_triggers\.js'/.test(inbox));

// ── B. both load sites go through loadResource(listInboxItems, …) ──
expect('initial render loads via loadResource(listInboxItems, { onRetry: onInboxRetry, isRetry: false })',
  /let\s+items\s*=\s*await\s+loadResource\(\s*listInboxItems\s*,\s*\{\s*onRetry:\s*onInboxRetry\s*,\s*isRetry:\s*false\s*\}\s*\)/.test(inbox));
expect('refreshInbox(isRetry) loads via loadResource(listInboxItems, { onRetry: onInboxRetry, isRetry })',
  /async\s+function\s+refreshInbox\(\s*isRetry\s*\)[\s\S]{0,140}await\s+loadResource\(\s*listInboxItems\s*,\s*\{\s*onRetry:\s*onInboxRetry\s*,\s*isRetry\s*\}\s*\)/.test(inbox));
expect('both load sites route through loadResource(listInboxItems, …)',
  (inbox.match(/loadResource\(\s*listInboxItems\s*,/g) || []).length === 2,
  'expected initial + refreshInbox');
expect('inbox.js reads the inbox only through the adapter (no direct listInboxItems() call)',
  (inbox.match(/await\s+listInboxItems\(\)/g) || []).length === 0,
  'listInboxItems is passed by reference to loadResource, never called directly in inbox.js');

// ── B2. retry closure re-runs the load, does not pre-dismiss ──
expect('onInboxRetry re-runs the load as a retry (refreshInbox(true))',
  /onInboxRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?refreshInbox\(\s*true\s*\)/.test(inbox));
expect('onInboxRetry does NOT pre-emptively dismiss before the reload result is known',
  !/onInboxRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?dismissAppShellError\(\)/.test(inbox));

// ── D. per-screen empty state preserved (additive, not replaced) ─
expect("inbox.js still renders its own inbox-empty state",
  /class="bd-card inbox-empty"/.test(inbox));

// ── E. additive only — no global error replaces the inbox, no /error route ─
expect('inbox.js does not hide/replace itself on error (no overlay route change)',
  !/go\(\s*['"`]\/error/.test(inbox));
expect('app.js does NOT register an /error route (any quote style)',
  !/register\(\s*['"`]\/error/.test(app));

// ── F. sw precache + version bump ────────────────────────────
expect('sw.js still precaches ./src/screens/inbox.js',
  /['"]\.\/src\/screens\/inbox\.js['"]/.test(sw));
expect('sw.js precaches the shared adapter ./src/data_layer.js',
  /['"]\.\/src\/data_layer\.js['"]/.test(sw));
expect('sw.js VERSION bumped to v134+',
  Number(sw.match(/VERSION\s*=\s*'v(\d+)'/)?.[1] || 0) >= 134);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
