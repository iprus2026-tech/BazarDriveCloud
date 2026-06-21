// BD-PROFILE-01 (F4) — dialog focus management for the driver Garage add / edit
// sheets (both declare role="dialog" aria-modal="true"). On open they now move
// focus into the panel (first field) and register an Escape-to-close handler; on
// close they restore focus to the trigger and remove the handler. Mirrors
// openPermitPanel / the history-detail dialog. View-only — no storage write
// (the no-mutation contract is separately pinned by smoke-profile-driver-garage).
// Static source pins; no DOM, no events.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const src = read('../public/src/screens/profile.js');
const sw = read('../public/sw.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── Add sheet ────────────────────────────────────────────────────────────────
expect('F4 (add): open focuses the first field (#pf2-garage-add-model)',
  src.includes("root.querySelector('#pf2-garage-add-model')?.focus()"));
expect('F4 (add): open captures the trigger for return focus',
  src.includes('addReturnFocus = addBtn'));
expect('F4 (add): close restores focus to the trigger',
  src.includes('addReturnFocus?.focus()'));
expect('F4 (add): Escape closes the sheet',
  src.includes("if (e.key === 'Escape') closeSheet()"));
expect('F4 (add): Escape handler is registered on open and removed on close',
  src.includes("document.addEventListener('keydown', addSheetEsc)") &&
  src.includes("document.removeEventListener('keydown', addSheetEsc)"));

// ── Edit sheet ───────────────────────────────────────────────────────────────
expect('F4 (edit): open captures the invoking button (document.activeElement)',
  src.includes('editReturnFocus = document.activeElement'));
expect('F4 (edit): open focuses the first field',
  src.includes('modelEl?.focus()'));
expect('F4 (edit): close restores focus to the trigger',
  src.includes('editReturnFocus?.focus()'));
expect('F4 (edit): Escape closes the sheet',
  src.includes("if (e.key === 'Escape') closeEditSheet()"));
expect('F4 (edit): Escape handler is registered on open and removed on close',
  src.includes("document.addEventListener('keydown', editSheetEsc)") &&
  src.includes("document.removeEventListener('keydown', editSheetEsc)"));

// Precached profile.js changed → VERSION bumped.
expect('sw.js VERSION bumped to v173+',
  Number((sw.match(/VERSION\s*=\s*'v(\d+)'/) || [])[1] || 0) >= 173);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
