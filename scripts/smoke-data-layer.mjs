// BD-ERROR-02A — static regression smoke for the unified data-load adapter.
//
// public/src/data_layer.js exposes loadResource(fn, { onRetry, isRetry, fallback })
// — the single guarded-retry wrapper that every screen loads through, replacing
// the per-screen BD-ERROR-01C copies. This smoke pins the contract in ONE place
// (the per-screen smokes now only assert delegation to loadResource):
//   - awaits fn() inside a try;
//   - isRetry → reportAppShellError('retrying');
//   - on success during a retry, dismiss only if still 'retrying' (onlyIfState);
//   - on failure, reportAppShellError('server_error', onRetry ? {onRetry} : {})
//     and return the fallback (default []), so the screen's own empty state is
//     preserved (overlay is additive).
//
// This script is intentionally STATIC: it reads source and asserts the contract.
// No browser, no DOM, no network.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const dataLayer = read('../public/src/data_layer.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── A. adapter import ────────────────────────────────────────
expect('data_layer.js imports reportAppShellError / dismissAppShellError from ./app_error_triggers.js',
  /import\s*\{[\s\S]*?reportAppShellError[\s\S]*?dismissAppShellError[\s\S]*?\}\s*from\s*'\.\/app_error_triggers\.js'/.test(dataLayer));

// ── B. exported signature ────────────────────────────────────
expect('exports async loadResource(fn, { onRetry, isRetry, fallback = [], isActive })',
  /export\s+async\s+function\s+loadResource\(\s*fn\s*,\s*\{\s*onRetry\s*,\s*isRetry\s*,\s*fallback\s*=\s*\[\s*\]\s*,\s*isActive\s*\}\s*=\s*\{\s*\}\s*\)/.test(dataLayer));

// ── C. the contract (loadResource is the only function in this small module,
//        so assertions run against the whole file) ────────────
expect('defines an active() gate from the optional isActive (default always-active)',
  /const\s+active\s*=\s*\(\)\s*=>\s*\(\s*typeof\s+isActive\s*!==\s*'function'\s*\|\|\s*isActive\(\)\s*\)/.test(dataLayer));
expect('mints a per-call token (unique overlay-state owner)',
  /const\s+token\s*=\s*\{\s*\}/.test(dataLayer));
expect('shows the retrying state only while active, tagged with the token',
  /if\s*\(isRetry\s*&&\s*active\(\)\)\s*reportAppShellError\(\s*'retrying'\s*,\s*\{\s*token\s*\}\s*\)/.test(dataLayer));
expect('awaits fn() inside a try',
  /try\s*\{[\s\S]*?await\s+fn\(\)/.test(dataLayer));
expect('dismisses only AFTER a successful load, guarded by onlyIfState + token',
  /await\s+fn\(\)[\s\S]*?if\s*\(isRetry\)\s*dismissAppShellError\(\s*\{\s*onlyIfState:\s*'retrying'\s*,\s*token\s*\}\s*\)/.test(dataLayer));
expect('catch reports server_error ONLY while active, tagged with the token',
  /catch[\s\S]*?if\s*\(active\(\)\)\s*reportAppShellError\(\s*'server_error'\s*,\s*onRetry\s*\?\s*\{\s*onRetry\s*,\s*token\s*\}\s*:\s*\{\s*token\s*\}\s*\)/.test(dataLayer));
expect('catch clears a stale retrying (guarded by onlyIfState + token) when no longer active',
  /catch[\s\S]*?else\s+dismissAppShellError\(\s*\{\s*onlyIfState:\s*'retrying'\s*,\s*token\s*\}\s*\)/.test(dataLayer));
expect('catch returns the fallback (default [])',
  /catch[\s\S]*?return\s+fallback/.test(dataLayer));

// ── D. stays a pure orchestration layer (no data/ride/mock imports) ──
expect('data_layer.js imports nothing beyond the error-trigger adapter',
  (dataLayer.match(/^import\s/gm) || []).length === 1,
  'only the app_error_triggers import — no mock_api / ride / map coupling');

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
