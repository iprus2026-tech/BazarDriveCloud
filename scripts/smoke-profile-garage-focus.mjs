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

// ── Add sheet — #732 migrated onto the shared overlay focus-trap ──────────────
// Was F4 bespoke (capture / initial-focus / Escape / restore, NO Tab-trap). trapFocus now owns
// the full modal a11y incl. the Tab-trap; the trigger is focused first so restore lands on it.
expect('F4 (add): open focuses the trigger first (so the trap restores there on close)',
  /if \(addBtn && typeof addBtn\.focus === 'function'\) addBtn\.focus\(\);[\s\S]{0,200}releaseAddTrap = trapFocus/.test(src));
expect('F4 (add): open installs the shared trap (initialFocus #pf2-garage-add-model, Escape→closeSheet)',
  /releaseAddTrap = trapFocus\(sheet,\s*\{\s*initialFocus:\s*'#pf2-garage-add-model',\s*onEscape:\s*closeSheet\s*\}\)/.test(src));
expect('F4 (add): close releases the trap (focus restore + Tab/Escape teardown)',
  /const closeSheet = \(\) => \{[\s\S]{0,220}releaseAddTrap\(\);/.test(src));
expect('F4 (add): the old bespoke focus vars are gone (fully migrated)',
  !/let addReturnFocus|let addSheetEsc/.test(src));

// ── Edit sheet — #732 migrated onto the shared overlay focus-trap ─────────────
expect('F4 (edit): open installs the shared trap (initialFocus #pf2-garage-edit-model, Escape→closeEditSheet)',
  /releaseEditTrap = trapFocus\(editSheet,\s*\{\s*initialFocus:\s*'#pf2-garage-edit-model',\s*onEscape:\s*closeEditSheet\s*\}\)/.test(src));
expect('F4 (edit): close releases the trap (focus restore + Tab/Escape teardown)',
  /const closeEditSheet = \(\) => \{[\s\S]{0,260}releaseEditTrap\(\);/.test(src));
expect('F4 (edit): the old bespoke focus vars are gone (fully migrated)',
  !/let editReturnFocus|let editSheetEsc/.test(src));

// ── History-detail dialog (BD-RIDE-HISTORY) — #732 focus-trap retrofit ───────
// The ride-history detail overlay (role=dialog aria-modal=true) already had Escape +
// initial focus; #732 adds the shared overlay focus-TRAP + focus-restore via trapFocus,
// keeping the dialog's own Escape handler.
expect('history-detail imports the shared trapFocus helper',
  /import \{ trapFocus \} from '\.\.\/overlay\.js'/.test(src));
expect('history-detail installs the trap on open (initialFocus the close button)',
  /activeHistoryDetailTrap = trapFocus\(overlay,\s*\{\s*initialFocus:\s*'\.profile-history-detail__close'\s*\}\)/.test(src));
expect('history-detail releases the trap (focus restore) in closeHistoryDetail',
  /if \(activeHistoryDetailTrap\)\s*\{\s*activeHistoryDetailTrap\(\);\s*activeHistoryDetailTrap = null;\s*\}/.test(src));
expect('history-detail keeps its OWN Escape handler (helper is not given onEscape)',
  /activeHistoryDetailEsc = \(e\) =>[\s\S]{0,80}closeHistoryDetail\(root\)/.test(src));

// Precached profile.js changed → VERSION bumped.
expect('sw.js VERSION bumped to v219+',
  Number((sw.match(/VERSION\s*=\s*'v(\d+)'/) || [])[1] || 0) >= 219);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
