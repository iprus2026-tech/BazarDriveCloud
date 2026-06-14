// BD-ERROR-01C-H — static regression smoke for the trip-receipt flow trigger.
//
// trip_receipt.js resolves its receipt document via mock_api.getReceipt. The
// real (non-forced) read now routes through the shared data_layer.loadResource
// adapter, so a future backend failure surfaces the global app-shell overlay
// with a guarded retry instead of silently showing the missing state. Because
// getReceipt returns object|null (not a list), the adapter fallback is `null`,
// so a load failure falls back to the screen's own missing document (additive
// overlay). A genuine not-found (load OK, no receipt) reports no error. The
// resolve runs off a setTimeout, after mount + overlay init. Forced
// cash/noncash/missing previews are render-gate designer states and stay
// unwrapped. The guarded-retry CONTRACT is pinned once in scripts/smoke-data-layer.mjs.
//
// This script is intentionally STATIC: it reads source and asserts the contract.
// No browser, no DOM, no network.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const receipt = read('../public/src/screens/trip_receipt.js');
const app     = read('../public/src/app.js');
const sw      = read('../public/sw.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── A. delegation to the shared adapter ──────────────────────
expect('trip_receipt.js imports loadResource from ../data_layer.js',
  /import\s*\{\s*loadResource\s*\}\s*from\s*'\.\.\/data_layer\.js'/.test(receipt));
expect('trip_receipt.js does not import the overlay adapter directly (it goes through data_layer)',
  !/from\s*'\.\.\/app_error_triggers\.js'/.test(receipt));

// ── B. the primary receipt read goes through loadResource ────
expect('the real receipt read routes through loadResource(() => getReceipt(tripId), …)',
  /await\s+loadResource\(\s*\(\)\s*=>\s*getReceipt\(\s*tripId\s*\)\s*,\s*\{[\s\S]*?\}\s*\)/.test(receipt));
expect('the adapter fallback is null (getReceipt returns object|null, not a list)',
  /fallback:\s*null/.test(receipt));
expect('the load is gated by isActive: () => content.isConnected (so a stale load cannot report over the next screen)',
  /isActive:\s*\(\)\s*=>\s*content\.isConnected/.test(receipt));

// ── C. the resolve is async + re-invokable for retry ─────────
expect('renderResolved is async and takes (content, tripId, forced, onRetry, isRetry)',
  /async\s+function\s+renderResolved\(\s*content\s*,\s*tripId\s*,\s*forced\s*,\s*onRetry\s*,\s*isRetry\s*\)/.test(receipt));
expect('onReceiptRetry re-runs the resolve as a retry (renderResolved(..., true))',
  /onReceiptRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?renderResolved\([\s\S]*?,\s*onReceiptRetry\s*,\s*true\s*\)/.test(receipt));
expect('the initial resolve runs via setTimeout with isRetry=false',
  /setTimeout\(\s*\(\)\s*=>\s*renderResolved\([\s\S]*?,\s*onReceiptRetry\s*,\s*false\s*\)/.test(receipt));
expect('onReceiptRetry does NOT pre-emptively dismiss before the reload result is known',
  !/onReceiptRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?dismissAppShellError\(/.test(receipt));
// the deferred resolve must bail if the screen was navigated away from, so a
// stale load can't report a server_error overlay over a different screen.
expect('renderResolved guards on content.isConnected before resolving (no stale overlay after navigation)',
  /async\s+function\s+renderResolved\([\s\S]{0,800}?if\s*\(\s*!content\.isConnected\s*\)\s*return/.test(receipt));
expect('renderResolved re-checks content.isConnected after the await before painting',
  (receipt.match(/if\s*\(\s*!content\.isConnected\s*\)\s*return/g) || []).length >= 2,
  'one guard before the load, one after the await');

// ── D. per-screen missing state preserved (additive, not replaced) ─
expect('trip_receipt.js still renders its own missing state (receiptMissingHtml)',
  /receiptMissingHtml\(/.test(receipt));

// ── E. additive only — no global error replaces the screen, no /error route ─
expect('trip_receipt.js does not re-route to a global error route on failure',
  !/go\(\s*['"`]\/error/.test(receipt));
expect('app.js does NOT register an /error route (any quote style)',
  !/register\(\s*['"`]\/error/.test(app));

// ── F. sw precache + version bump ────────────────────────────
expect('sw.js still precaches ./src/screens/trip_receipt.js',
  /['"]\.\/src\/screens\/trip_receipt\.js['"]/.test(sw));
expect('sw.js precaches the shared adapter ./src/data_layer.js',
  /['"]\.\/src\/data_layer\.js['"]/.test(sw));
expect('sw.js VERSION bumped to v138+',
  Number(sw.match(/VERSION\s*=\s*'v(\d+)'/)?.[1] || 0) >= 138);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
