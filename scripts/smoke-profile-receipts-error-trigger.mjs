// BD-ERROR-01C-G — static regression smoke for the profile driver-receipts trigger.
//
// profile.js routes a driver-receipts load failure (the payouts pane's completed-
// ride rows) through the global app-shell overlay via the BD-ERROR-01C-A adapter
// (reportAppShellError), mirroring feed (01C-B), inbox (01C-C), post-detail (01C-D),
// respond (01C-E) and driver-map (01C-F). It is dormant/defensive: mock
// listDriverReceipts() does not reject today.
//
// SYNC VARIANT (deliberate divergence from 01C-B…F): the payouts pane is a
// synchronous HTML string and listDriverReceipts() is synchronous, so this slice
// does NOT show a 'retrying' progress state or an awaited guarded dismiss. Instead
// «Повторить» dismisses our own server_error (guarded by onlyIfState so a mid-flight
// offline banner is not clobbered) and re-renders the pane in place — a repeat
// failure re-reports server_error in the same tick, a success leaves it cleared.
// Full async-normalization (retrying/awaited dismiss) is deferred to BD-ERROR-02A.
// The screen's own empty/balance cards are preserved (empty receipts -> '').
//
// This script is intentionally STATIC: it reads source and asserts the contract.
// No browser, no DOM, no network.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const profile = read('../public/src/screens/profile.js');
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
expect('profile.js imports reportAppShellError + dismissAppShellError from ../app_error_triggers.js',
  /import\s*\{[\s\S]*?reportAppShellError[\s\S]*?dismissAppShellError[\s\S]*?\}\s*from\s*'\.\.\/app_error_triggers\.js'/.test(profile));

// ── B. the receipts load reports server_error on catch + [] fallback ──
const sectionBody = functionBody(profile, 'driverReceiptPayoutSectionHtml');
expect('driverReceiptPayoutSectionHtml(onRetry) takes a retry callback',
  /function\s+driverReceiptPayoutSectionHtml\(\s*onRetry\s*\)/.test(profile));
expect('driverReceiptPayoutSectionHtml calls listDriverReceipts() inside a try',
  !!sectionBody && /try\s*\{[\s\S]*?listDriverReceipts\(\)/.test(sectionBody));
expect('catch reports server_error to the global overlay',
  !!sectionBody && /catch[\s\S]*?reportAppShellError\(\s*'server_error'\s*,/.test(sectionBody));
expect('catch passes an onRetry option to the overlay',
  !!sectionBody && /reportAppShellError\(\s*'server_error'\s*,\s*onRetry\s*\?\s*\{\s*onRetry\s*\}/.test(sectionBody));
expect('catch falls back to [] (preserves the pane empty/balance cards)',
  !!sectionBody && /catch[\s\S]*?receipts\s*=\s*\[\s*\]/.test(sectionBody));

// ── C. retry dismisses our own server_error (guarded) then re-renders ──
expect('onReceiptsRetry dismisses guarded by onlyIfState:server_error then re-renders the pane',
  /onReceiptsRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?dismissAppShellError\(\s*\{\s*onlyIfState:\s*'server_error'\s*\}\s*\)[\s\S]*?refreshPayoutsPane\(\)/.test(profile));
expect('refreshPayoutsPane() re-renders the payouts pane via payoutsPaneHtml(payoutsEmpty, onReceiptsRetry)',
  /function\s+refreshPayoutsPane\(\)\s*\{[\s\S]*?pf2-pane-payouts[\s\S]*?payoutsPaneHtml\(\s*payoutsEmpty\s*,\s*onReceiptsRetry\s*\)/.test(profile));

// ── D. the retry callback is threaded through to the receipts read ──
expect('payoutsPaneHtml(previewEmpty, onRetry) threads the callback',
  /function\s+payoutsPaneHtml\(\s*previewEmpty\s*=\s*false\s*,\s*onRetry\s*\)/.test(profile));
expect('payoutsPaneHtml passes onRetry to driverReceiptPayoutSectionHtml(onRetry)',
  /driverReceiptPayoutSectionHtml\(\s*onRetry\s*\)/.test(profile));
expect('the payouts pane is rendered with onReceiptsRetry at both sites (initial + refresh)',
  (profile.match(/payoutsPaneHtml\(\s*payoutsEmpty\s*,\s*onReceiptsRetry\s*\)/g) || []).length === 2,
  'expected initial render + refreshPayoutsPane');
expect('profile.js calls listDriverReceipts() only inside the wrapper (one assignment)',
  (profile.match(/receipts\s*=\s*listDriverReceipts\(\)/g) || []).length === 1,
  'assignment call count should be 1 (only inside driverReceiptPayoutSectionHtml)');

// ── E. additive only — no global error replaces the screen, no /error route ─
expect('profile.js does not re-route to a global error route on failure',
  !/go\(\s*['"`]\/error/.test(profile));
expect('app.js does NOT register an /error route (any quote style)',
  !/register\(\s*['"`]\/error/.test(app));

// ── F. sw precache + version bump ────────────────────────────
expect('sw.js still precaches ./src/screens/profile.js',
  /['"]\.\/src\/screens\/profile\.js['"]/.test(sw));
expect('sw.js still precaches the adapter ./src/app_error_triggers.js',
  /['"]\.\/src\/app_error_triggers\.js['"]/.test(sw));
expect('sw.js VERSION bumped to v132+',
  Number(sw.match(/VERSION\s*=\s*'v(\d+)'/)?.[1] || 0) >= 132);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
