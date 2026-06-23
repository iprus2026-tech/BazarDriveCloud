// BD-OPS / #732 — overlay focus-trap COVERAGE guard.
//
// Every screen that ships a `role="dialog" aria-modal="true"` overlay must TRAP FOCUS, so a
// future modal sheet can't silently ship without one (the dominant a11y defect class the
// #732 audit found). The shared, self-cleaning trap is public/src/overlay.js (`trapFocus`),
// applied to the five recommendation-#1 sheets. A small ALLOWLIST covers a screen that
// predates the helper and carries a VETTED bespoke Tab-trap — each allowlisted file must keep
// that trap (asserted, so the exemption can't mask a regression) and must still be an
// aria-modal screen (no stale allowlist). A NEW aria-modal screen with neither fails check.mjs.
//
// Static source analysis only — no DOM, no network.

import fs from 'node:fs';

const screensUrl = new URL('../public/src/screens/', import.meta.url);
// Matches both the HTML attribute (`aria-modal="true"`) and the setAttribute form
// (`setAttribute('aria-modal', 'true')`, used by the passenger sheets).
const ARIA_MODAL = /aria-modal="true"|aria-modal',\s*'true'/;
const sharesTrap = (src) =>
  /import \{ trapFocus \} from '\.\.\/overlay\.js'/.test(src) && /trapFocus\(/.test(src);

// file → regex proving the file's OWN Tab focus-trap, so the allowlist is justified, not blanket.
const BESPOKE_TRAP_ALLOWLIST = {
  // active_ride_driver_sheets: bindDriverSheetEvents.onKey traps Tab / Shift+Tab within the
  // panel + owns Escape-to-close. TODO(#732): migrate to overlay.js for the self-cleaning teardown.
  'active_ride_driver_sheets.js':
    /ev\.key === 'Tab'[\s\S]{0,260}document\.activeElement === first[\s\S]{0,160}document\.activeElement === last/,
};

const issues = [];
const expect = (label, cond, detail = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
};

const read = (f) => fs.readFileSync(new URL(f, screensUrl), 'utf8');
const files = fs.readdirSync(screensUrl).filter((f) => f.endsWith('.js'));

let ariaModalCount = 0;
const compliant = [];
for (const f of files) {
  const src = read(f);
  if (!ARIA_MODAL.test(src)) continue;
  ariaModalCount++;
  if (BESPOKE_TRAP_ALLOWLIST[f]) {
    expect(`${f}: allowlisted bespoke Tab focus-trap is still present (allowlist stays honest)`,
      BESPOKE_TRAP_ALLOWLIST[f].test(src));
  } else {
    const ok = sharesTrap(src);
    expect(`${f}: aria-modal overlay wires the shared focus-trap (public/src/overlay.js)`,
      ok, 'a new aria-modal sheet must use trapFocus, or be allowlisted with a vetted trap');
    if (ok) compliant.push(f);
  }
}

expect('the guard found the aria-modal screens to check', ariaModalCount >= 5, `${ariaModalCount} found`);
expect('the four recommendation-#1 shared-trap sheets are all covered',
  ['active_ride_passenger_sheets.js', 'order_detail.js', 'profile.js', 'responses.js']
    .every((f) => compliant.includes(f)));

// Allowlist hygiene — every allowlisted file must exist AND still be an aria-modal screen.
for (const f of Object.keys(BESPOKE_TRAP_ALLOWLIST)) {
  let src = '';
  try { src = read(f); } catch { /* missing → fail below */ }
  expect(`allowlist entry ${f} is a real aria-modal screen (no stale allowlist)`,
    !!src && ARIA_MODAL.test(src));
}

// Non-vacuity — the rule rejects an aria-modal source that wires no trap and isn't allowlisted.
expect('self-test: an aria-modal overlay with no trap is NOT compliant',
  !sharesTrap('<div role="dialog" aria-modal="true"></div>'));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
