// BD-OPS / #684 #5 — ScreenOps audit-recipe generator (pure text, no I/O).
//
// The REPAIR prompt (claude_code_prompt_template) fixes a KNOWN MEL. This generates
// the complementary AUDIT prompt: a reproducible, standardized brief for FINDING
// MELs on a screen — the multi-agent audit that surfaced this whole series was
// re-improvised each session; this makes it repeatable per screen. It enumerates the
// audit DIMENSIONS (incl. the data-model #8 and lifecycle #10 lenses the
// BD-RESPONSES-01 audit lacked — the #5 refinement), the smoke cross-check (#1),
// adversarial verify, and synthesis that classifies each survivor by severity +
// reachability (#3) and a stable selector anchor (#2).

// Regex-escape a term for a `grep -E` alternation.
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dataModelLine(screen = {}) {
  const dm = screen.dataModel;
  if (!dm || typeof dm !== 'object') {
    return 'no declared data-model fact — establish where its primary entity lives (static seed vs runtime store) first.';
  }
  return `backed by ${dm.store || '(unnamed store)'}`
    + (dm.runtimeCreated ? ' (CREATED AT RUNTIME — no static seed)' : ' (STATIC)')
    + (dm.keyedBy ? `, keyed by ${dm.keyedBy}` : '') + '.';
}

export function generateAuditRecipe(screen = {}) {
  const id = screen.id || '(unknown screen id)';
  const route = screen.route || '(unknown route)';
  const file = screen.file || '(unknown file)';
  const title = screen.title || id;
  const fileBase = String(file).split('/').pop() || file;
  const routeTerm = (typeof route === 'string' && route.startsWith('/')) ? route : '';
  const pinPattern = [fileBase, routeTerm].filter(Boolean).map(escapeRe).join('|') || escapeRe(fileBase);

  return [
    `Audit recipe: ${id} — ${title}`,
    ``,
    `Route: ${route}`,
    `File: ${file}`,
    ``,
    `Goal: find real MEL defects on this screen, reproducibly. Log each survivor as a`,
    `ScreenOps MEL card (severity + reachability + a stable selector anchor).`,
    ``,
    `Dimensions — audit each independently:`,
    `1. Accessibility / WAI-ARIA — roles, focus management on open/close, aria-live status, tap-target size (>= 44px), labels.`,
    `2. Flow / state correctness — does every PRIMARY CTA reach its contracted destination? any dead-end, wrong route, or stuck state?`,
    `3. Data-model viability (#684 #8) — ${dataModelLine(screen)} Is a fix CONSTRUCTIBLE against how the entity actually lives?`,
    `4. Lifecycle / entry-state (#684 #10) — probe FIRST-ENTRY, LIVE / mid-flow, TERMINAL, and RE-ENTRY; does the screen behave on each?`,
    `5. Shared-state / blast-radius (#684 #9) — does any write touch a shared store or shared id that OTHER screens read (Feed / DriverMap / chat / history / receipts)?`,
    `6. Visual / Cloud-Design parity — spacing, hierarchy, empty / loading / error states.`,
    ``,
    `Method — for every candidate finding:`,
    `- Step 0, smoke cross-check (#684 #1): grep -rlE "${pinPattern}" scripts/smoke-*.mjs — if a smoke pins the behavior as INTENDED, it is WONTFIX, not a defect.`,
    `- Adversarial verify: independently try to REFUTE the finding; DROP it unless it survives a skeptical second look.`,
    `- Anchor (#684 #2): record a stable selector / symbol (e.g. #some-id, someFunction), never a line number.`,
    ``,
    `Synthesis:`,
    `- dedupe overlapping findings;`,
    `- classify each survivor by SEVERITY (MEL-A..D, code-correctness) AND REACHABILITY (#684 #3: user-path / dev-param / edge — a code-severe edge-only defect is low priority);`,
    `- output a list of MEL candidates, one per real defect, ready to log in ScreenOps.`,
  ].join('\n');
}
