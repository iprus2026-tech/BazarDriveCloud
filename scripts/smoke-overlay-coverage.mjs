// BD-OPS / #732 — overlay focus-trap COVERAGE guard.
//
// Every `role="dialog"|"alertdialog" aria-modal="true"` overlay in the RUNTIME must TRAP
// FOCUS, so a new modal can't silently ship without one (the dominant a11y defect class the
// #732 audit found). Scans ALL of public/src (not just screens/ — the app-shell error overlay
// lives outside it). Per FILE it requires:
//
//   ariaModalCount(file)  <=  trapFocusCalls(file) + bespokeTrapCount(file) + knownGapCount(file)
//
// — i.e. every aria-modal INSTANCE is accounted for, not just "the file mentions trapFocus once"
// (Codex #737). The shared, self-cleaning trap is public/src/overlay.js (`trapFocus`). A small
// BESPOKE_TRAP list covers a file with a VETTED hand-rolled trap (its proof regex requires the
// real preventDefault()/focus() wrap, not just the boundary comparisons). A KNOWN_GAP list
// names aria-modal modals that do NOT yet trap focus — pre-existing gaps the audit surfaced,
// exempted with a TODO so the guard stays green WHILE a brand-new untrapped modal still fails.
//
// Static source analysis only — no DOM, no network.

import fs from 'node:fs';

const SRC = new URL('../public/src/', import.meta.url);
const ARIA_MODAL = /aria-modal="true"|aria-modal',\s*'true'/g;
const TRAP_CALL = /trapFocus\(/g;

// rel-path → { count, proof }. The file's aria-modal modals are trapped by a hand-rolled
// trap; `proof` must match the ACTUAL wrap (preventDefault + focus), not just the comparisons.
const BESPOKE_TRAP = {
  // Empty — active_ride_driver_sheets.js migrated its bindDriverSheetEvents onKey trap onto the
  // shared overlay.js trapFocus (#732), so every aria-modal modal now uses the shared helper.
};

// rel-path → count of aria-modal modals in that file that do NOT yet trap focus. KNOWN, tracked
// gaps (TODO #732 retrofit onto overlay.js). Exempted so a NEW untrapped modal still fails.
const KNOWN_GAP = {
  // Empty — every aria-modal modal now traps focus (shared trapFocus or a vetted BESPOKE_TRAP).
  // profile.js garage add/edit migrated onto overlay.js (#732); app_error_overlay.js too (#738).
};

// overlay.js is the helper itself — its docstring mentions aria-modal; it is never a consumer.
const EXCLUDE = new Set(['overlay.js']);

const issues = [];
const expect = (label, cond, detail = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
};
const count = (src, re) => (src.match(re) || []).length;

// Recursively collect .js files under public/src, as paths relative to public/src.
function listJs(dirUrl, prefix = '') {
  const out = [];
  for (const ent of fs.readdirSync(dirUrl, { withFileTypes: true })) {
    if (ent.isDirectory()) out.push(...listJs(new URL(ent.name + '/', dirUrl), prefix + ent.name + '/'));
    else if (ent.name.endsWith('.js')) out.push({ rel: prefix + ent.name, url: new URL(ent.name, dirUrl) });
  }
  return out;
}

let ariaModalFiles = 0;
const seenGapFiles = [];
for (const { rel, url } of listJs(SRC)) {
  if (EXCLUDE.has(rel)) continue;
  const src = fs.readFileSync(url, 'utf8');
  const modals = count(src, ARIA_MODAL);
  if (!modals) continue;
  ariaModalFiles++;
  const traps = count(src, TRAP_CALL);
  const bespoke = BESPOKE_TRAP[rel] ? BESPOKE_TRAP[rel].count : 0;
  const gap = KNOWN_GAP[rel] || 0;
  const covered = traps + bespoke + gap;
  expect(`${rel}: every aria-modal overlay traps focus (${covered} covered ≥ ${modals} modal${modals > 1 ? 's' : ''})`,
    modals <= covered,
    'shared trapFocus, a vetted bespoke trap, or a tracked KNOWN_GAP for EACH instance');
  if (BESPOKE_TRAP[rel]) {
    expect(`${rel}: the bespoke trap actually wraps focus (preventDefault + focus, not just the comparisons)`,
      BESPOKE_TRAP[rel].proof.test(src));
  }
  if (gap) seenGapFiles.push(`${rel} (×${gap})`);
}

if (seenGapFiles.length) {
  console.log('NOTE — KNOWN_GAP aria-modal modals exempted, TODO #732 retrofit onto overlay.js: ' + seenGapFiles.join(', '));
}

expect('the guard scanned the runtime and found aria-modal modals', ariaModalFiles >= 6, `${ariaModalFiles} files`);

// Hygiene — every BESPOKE_TRAP / KNOWN_GAP entry must be a real file that still has ≥ the listed
// aria-modal modals (so an exemption can't outlive the modal it covers).
for (const [rel, spec] of [...Object.entries(BESPOKE_TRAP), ...Object.entries(KNOWN_GAP)]) {
  const need = typeof spec === 'number' ? spec : spec.count;
  let modals = 0;
  try { modals = count(fs.readFileSync(new URL(rel, SRC), 'utf8'), ARIA_MODAL); } catch { /* missing */ }
  expect(`exemption ${rel} is a real aria-modal file covering ≥ ${need} modal(s) (no stale exemption)`,
    modals >= need);
}

// Non-vacuity — an aria-modal source with no trap and no exemption is NOT compliant.
expect('self-test: an aria-modal overlay with no trap fails the count rule',
  !(count('<div role="dialog" aria-modal="true"></div>', ARIA_MODAL) <= count('<div role="dialog" aria-modal="true"></div>', TRAP_CALL)));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
