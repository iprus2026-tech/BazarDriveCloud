// BD-ERROR-01C-C — static regression smoke for the inbox flow trigger.
//
// inbox.js routes an inbox data-load failure through the global app-shell overlay
// via the BD-ERROR-01C-A adapter (reportAppShellError), mirroring the feed
// trigger (BD-ERROR-01C-B). This is a defensive wire: listInboxItems() does not
// reject today, so the catch is dormant — but the wiring must stay in place so a
// future data-layer/backend failure surfaces the global error instead of
// silently rendering an empty inbox. The inbox's own empty state must be
// preserved (the global overlay is additive, not a replacement). A refactor
// could drop the try/catch, swallow the error without reporting, replace the
// inbox empty state, or re-route the global error — and `node scripts/check.mjs`
// would still pass.
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

// ── A. adapter import (report + dismiss) ─────────────────────
expect('inbox.js imports reportAppShellError + dismissAppShellError from ../app_error_triggers.js',
  /import\s*\{[\s\S]*?reportAppShellError[\s\S]*?dismissAppShellError[\s\S]*?\}\s*from\s*'\.\.\/app_error_triggers\.js'/.test(inbox));

// ── B. the data load is wrapped in try/catch that reports ────
const loadBody = functionBody(inbox, 'loadInboxItems');
expect('inbox.js has a loadInboxItems() wrapper', !!loadBody);
expect('loadInboxItems() awaits listInboxItems() inside a try',
  !!loadBody && /try\s*\{[\s\S]*?await\s+listInboxItems\(\)/.test(loadBody));
expect('loadInboxItems() catch reports server_error to the global overlay',
  !!loadBody && /catch[\s\S]*?reportAppShellError\(\s*'server_error'\s*,/.test(loadBody));
expect('loadInboxItems() passes an onRetry option to the overlay',
  !!loadBody && /reportAppShellError\(\s*'server_error'\s*,\s*onRetry\s*\?\s*\{\s*onRetry\s*\}/.test(loadBody));
expect('loadInboxItems() falls back to [] (preserves the inbox empty state)',
  !!loadBody && /catch[\s\S]*?return\s*\[\s*\]/.test(loadBody));

// ── B2. retry shows progress and dismisses only on success ───
expect('loadInboxItems() shows a non-blocking retrying state while retrying',
  !!loadBody && /if\s*\(isRetry\)\s*reportAppShellError\(\s*'retrying'\s*\)/.test(loadBody));
expect('loadInboxItems() dismisses the overlay only AFTER a successful reload, guarded by onlyIfState',
  !!loadBody && /await\s+listInboxItems\(\)[\s\S]*?if\s*\(isRetry\)\s*dismissAppShellError\(\s*\{\s*onlyIfState:\s*'retrying'\s*\}\s*\)/.test(loadBody));
expect('onInboxRetry re-runs the load as a retry (refreshInbox(true))',
  /onInboxRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?refreshInbox\(\s*true\s*\)/.test(inbox));
expect('onInboxRetry does NOT pre-emptively dismiss before the reload result is known',
  !/onInboxRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?dismissAppShellError\(\)/.test(inbox));

// ── C. both load sites go through the wrapper ────────────────
expect('initial render loads via loadInboxItems(onInboxRetry, false)',
  /let\s+items\s*=\s*await\s+loadInboxItems\(\s*onInboxRetry\s*,\s*false\s*\)/.test(inbox));
expect('refreshInbox(isRetry) loads via loadInboxItems(onInboxRetry, isRetry)',
  /async\s+function\s+refreshInbox\(\s*isRetry\s*\)[\s\S]{0,120}await\s+loadInboxItems\(\s*onInboxRetry\s*,\s*isRetry\s*\)/.test(inbox));
expect('inbox.js no longer calls listInboxItems() directly outside the wrapper',
  (inbox.match(/await\s+listInboxItems\(\)/g) || []).length === 1,
  'direct await count should be 1 (only inside loadInboxItems)');

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
expect('sw.js still precaches the adapter ./src/app_error_triggers.js',
  /['"]\.\/src\/app_error_triggers\.js['"]/.test(sw));
expect('sw.js VERSION bumped to v128+',
  Number(sw.match(/VERSION\s*=\s*'v(\d+)'/)?.[1] || 0) >= 128);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
