// BD-ERROR-01C-G — static regression smoke for the profile driver-receipts trigger.
//
// profile.js routes a driver-receipts load failure (the payouts pane's completed-
// ride rows) through the global app-shell overlay via the BD-ERROR-01C-A adapter
// (reportAppShellError), mirroring feed (01C-B) … driver-map (01C-F). Dormant/
// defensive: mock listDriverReceipts() does not reject today.
//
// LAZY variant (profile is a large synchronous tabbed HTML screen):
//  - the receipts read runs ONLY when the payouts pane is shown (not eagerly at
//    mount), so an off-screen failure can't pop a global error sheet while the
//    user is on another tab;
//  - the fill is deferred via queueMicrotask so it runs AFTER
//    window.BD.GlobalError is initialised (app.js runs start() before
//    initGlobalErrorOverlay(), and ?pane=payouts triggers a programmatic click
//    during the synchronous mount);
//  - the receipts rows are injected into the persistent #pf2-po-trips-mount (not
//    a full pane swap), and the receipt-row click is delegated on that mount so it
//    survives re-injection / retry.
// «Повторить» dismisses our own server_error (guarded by onlyIfState) and re-fills.
// Full async-normalization (retrying/awaited dismiss) is deferred to BD-ERROR-02A.
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

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) return null;
  const open = source.indexOf('{', start);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return source.slice(open, i + 1); }
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
expect('catch reports server_error to the global overlay with an onRetry option',
  !!sectionBody && /catch[\s\S]*?reportAppShellError\(\s*'server_error'\s*,\s*onRetry\s*\?\s*\{\s*onRetry\s*\}/.test(sectionBody));
expect('catch falls back to [] (preserves the pane balance/weekly cards)',
  !!sectionBody && /catch[\s\S]*?receipts\s*=\s*\[\s*\]/.test(sectionBody));

// ── C. LAZY: receipts read only when the payouts pane is shown ──
expect('payouts pane renders a stable #pf2-po-trips-mount (no eager receipts read)',
  /id="pf2-po-trips-mount"/.test(profile));
expect('driverReceiptPayoutSectionHtml is called exactly once — inside fillReceipts, not eagerly in payoutsPaneHtml',
  (profile.match(/driverReceiptPayoutSectionHtml\(/g) || []).length === 2,
  'one definition + one call site (fillReceipts)');
const fillBody = functionBody(profile, 'fillReceipts');
expect('fillReceipts injects driverReceiptPayoutSectionHtml(onReceiptsRetry) into #pf2-po-trips-mount',
  !!fillBody && /pf2-po-trips-mount/.test(fillBody) && /innerHTML\s*=\s*driverReceiptPayoutSectionHtml\(\s*onReceiptsRetry\s*\)/.test(fillBody));
expect('the payouts tab activation defers the fill past overlay init (queueMicrotask(fillReceipts))',
  /tab\.dataset\.pane\s*===\s*'payouts'\s*\)\s*queueMicrotask\(\s*fillReceipts\s*\)/.test(profile));

// ── C2. retry dismisses our own server_error (guarded) then re-fills ──
expect('onReceiptsRetry dismisses guarded by onlyIfState:server_error then re-fills',
  /onReceiptsRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?dismissAppShellError\(\s*\{\s*onlyIfState:\s*'server_error'\s*\}\s*\)[\s\S]*?fillReceipts\(\)/.test(profile));

// ── C3. receipt-row handler delegated on the persistent mount (survives re-fill) ──
expect('receipt-row click is delegated on #pf2-po-trips-mount (survives lazy fill / retry)',
  /querySelector\('#pf2-po-trips-mount'\)\?\.addEventListener\(\s*'click'/.test(profile));
expect('receipt-row handler is NOT bound to the re-injected #pf2-po-trips-block',
  !/querySelector\('#pf2-po-trips-block'\)\?\.addEventListener/.test(profile));
expect('profile.js calls listDriverReceipts() only inside the wrapper (one assignment)',
  (profile.match(/receipts\s*=\s*listDriverReceipts\(\)/g) || []).length === 1,
  'assignment call count should be 1 (only inside driverReceiptPayoutSectionHtml)');

// ── D. additive only — no global error replaces the screen, no /error route ─
expect('profile.js does not re-route to a global error route on failure',
  !/go\(\s*['"`]\/error/.test(profile));
expect('app.js does NOT register an /error route (any quote style)',
  !/register\(\s*['"`]\/error/.test(app));

// ── E. sw precache + version bump ────────────────────────────
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
