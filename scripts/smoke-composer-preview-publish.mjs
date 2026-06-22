// BD-COMPOSER-01 — static regression smoke for the publish-from-preview path.
//
// The footer «Опубликовать» button (#composer-submit) is linked to the edit form
// via form="composer-form" and lives in the always-visible .composer__footer, so
// it stays live while the screen is in PREVIEW (enterPreview() only flips the
// edit/preview panes' [hidden], it never disables the submit button). On submit
// the handler runs validate() and, on failure, calls showError() — which un-hides
// #composer-error. But #composer-error is nested INSIDE the edit pane
// (#composer-edit), and `.screen--composer [hidden] { display:none!important }`
// collapses that whole subtree while in preview. So without a guard, a
// publish-from-preview with invalid data is a SILENT dead-end: no navigation, no
// loading state, and the error lands in a hidden subtree.
//
// The fix returns to the edit view on the validation-error branch (exitPreview()
// before showError()), so the role="alert" error is visible/announced. This pin
// locks BOTH the structural hazard (so it can't silently re-appear) and the fix.
//
// Static only: reads source, asserts invariants. No DOM, no network, no runtime.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const composer = read('../public/src/screens/composer.js');
const css = read('../public/styles/cloud.css');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── Hazard preconditions (WHY the guard is required) ──
// 1. The publish CTA is form-linked and lives in the always-visible footer, so it
//    fires the submit handler even while the edit pane is hidden in preview.
expect('publish CTA is form-linked and lives in the always-visible .composer__footer',
  /class="composer__footer"[\s\S]{0,400}id="composer-submit"/.test(composer)
  && /<button[^>]*\bform="composer-form"[^>]*\bid="composer-submit"/.test(composer));

// 2. Entering preview hides the edit pane (which holds the error surface).
expect('enterPreview() hides the edit pane',
  /function enterPreview\(\)[\s\S]{0,160}editArea\.hidden\s*=\s*true/.test(composer));

// 3. The validation-error surface (#composer-error) is nested in the edit pane,
//    ahead of the preview area — so it is collapsed when the edit pane is hidden.
expect('#composer-error is nested in the edit pane (before the preview area)',
  /id="composer-edit"[\s\S]*id="composer-error"[\s\S]*id="composer-preview"/.test(composer));

// 4. The hidden subtree is collapsed by CSS — the error stays invisible when its
//    container is [hidden], even after showError() removes the error's own [hidden].
expect('cloud.css collapses the .screen--composer [hidden] subtree (display:none!important)',
  /\.screen--composer \[hidden\]\s*\{\s*display:\s*none\s*!important/.test(css));

// 5. exitPreview() exists and reveals the edit pane (the recovery the fix relies on).
expect('exitPreview() reveals the edit pane',
  /function exitPreview\(\)[\s\S]{0,160}editArea\.hidden\s*=\s*false/.test(composer));

// ── The fix invariant ──
// On the submit handler's validation-error branch, exitPreview() must run BEFORE
// showError() so the error is rendered into the now-visible edit pane, never a
// hidden subtree. Anchored on the validate()→err→if(err) chain so it pins the
// real branch, not an unrelated `err`.
expect('submit handler exits preview before showing a validation error (no silent dead-end)',
  /const\s+err\s*=\s*validate\([\s\S]{0,120}?if\s*\(\s*err\s*\)\s*\{[\s\S]{0,800}?exitPreview\(\)[\s\S]{0,200}?showError\s*\(/.test(composer));

if (issues.length) {
  console.log(`\n${issues.length} FAILED:`);
  for (const i of issues) console.log(' - ' + i);
  process.exit(1);
}
console.log('\nALL PASSED');
