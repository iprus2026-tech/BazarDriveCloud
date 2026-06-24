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

// #684 — when a screen declares role variants (multiple role-keyed render paths, e.g.
// /profile = guest | passenger | driver), brief the auditor to cover EACH and treat
// their differences as a finding dimension. Empty for single-render screens.
function variantsBlock(screen = {}, variantKey = '') {
  const vs = Array.isArray(screen.variants) ? screen.variants.filter((v) => v && v.key) : [];
  if (!vs.length) return [];
  const focus = variantKey ? vs.find((v) => v.key === variantKey) : null;
  if (focus) {
    const others = vs.filter((v) => v.key !== focus.key).map((v) => v.label || v.key);
    return [
      ``,
      `Variant focus (#684) — audit the ${focus.label || focus.key} render path (${focus.anchor || '?'}); it`,
      `renders when ${focus.entry || '(unspecified)'}. This screen has ${vs.length} role-keyed variants`,
      `(others: ${others.join(', ') || '—'}). Audit THIS variant's surfaces in full, AND flag any`,
      `difference / parity gap vs the other variants (topbar / identity / sections / settings / logout) as a finding.`,
    ];
  }
  return [
    ``,
    `Role variants (#684) — this screen has ${vs.length} role-keyed render paths. Audit EACH`,
    `independently, AND treat their DIFFERENCES (topbar / identity / sections / settings /`,
    `logout / affordance parity) as a first-class finding dimension — a variant the contract`,
    `or registry omits is itself a defect:`,
    ...vs.map((v) => `- ${v.label || v.key} (${v.anchor || '?'}) — renders when ${v.entry || '(unspecified)'}.`),
  ];
}

export function generateAuditRecipe(screen = {}, opts = {}) {
  const id = screen.id || '(unknown screen id)';
  const route = screen.route || '(unknown route)';
  const file = screen.file || '(unknown file)';
  const title = screen.title || id;
  const fileBase = String(file).split('/').pop() || file;
  const routeTerm = (typeof route === 'string' && route.startsWith('/')) ? route : '';
  const pinPattern = [fileBase, routeTerm].filter(Boolean).map(escapeRe).join('|') || escapeRe(fileBase);
  const focusVariant = (Array.isArray(screen.variants) && opts.variant)
    ? screen.variants.find((v) => v && v.key === opts.variant) : null;

  return [
    `Audit recipe: ${id} — ${title}` + (focusVariant ? ` · вариант: ${focusVariant.label || focusVariant.key}` : ''),
    ``,
    `Route: ${route}`,
    `File: ${file}`,
    ``,
    `Goal: find real MEL defects on this screen, reproducibly. Log each survivor as a`,
    `ScreenOps MEL card (severity + reachability + a stable selector anchor).`,
    ...variantsBlock(screen, opts.variant),
    ``,
    `Dimensions — audit each independently:`,
    `1. Accessibility / WAI-ARIA — roles, focus management on open/close, aria-live status, tap-target size (>= 44px), labels.`,
    `2. Flow / state correctness — does every PRIMARY CTA reach its contracted destination? any dead-end, wrong route, or stuck state?`,
    `3. Data-model viability (#684 #8) — ${dataModelLine(screen)} Is a fix CONSTRUCTIBLE against how the entity actually lives?`,
    `4. Lifecycle / entry-state (#684 #10) — probe FIRST-ENTRY, LIVE / mid-flow, TERMINAL, and RE-ENTRY; does the screen behave on each?`,
    `5. Shared-state / blast-radius (#684 #9) — does any write touch a shared store or shared id that OTHER screens read (Feed / DriverMap / chat / history / receipts)?`,
    `6. Visual / Cloud-Design parity — spacing, hierarchy, empty / loading / error states.`,
    `7. Edge / ordering states (#684 R1) — for any overlay or async/persisted flow, enumerate the SECOND-ORDER states (most are user-reachable, NOT the low-priority "edge" tier): a second overlay STACKED on top (who owns Escape/Tab?), navigation-AWAY while open (is the listener / trap released?), install-vs-mount ORDER (handler wired before the node is in the DOM?), a PROGRAMMATIC write bypassing a native constraint (el.value vs maxlength), and PERSISTED-vs-DOM ORDER divergence (append-on-retry reordering the store).`,
    `8. Contract ↔ runtime divergence (#684 R2) — open the screen's contract (docs/screen-contracts.md, the "Contract:" anchor at the foot of this brief) and DIFF it against what the runtime ACTUALLY renders: a stale or wrong row (ARIA semantics, CTA destination, acceptance state) is itself a finding. And any a11y / flow change you propose must name the contract LINE it moves in lockstep — runtime + smoke + contract land in ONE PR (BD-FEED-01 #744: a runtime aria-selected → aria-pressed swap left the contract still describing the old semantics until Codex caught it).`,
    ``,
    `Method — for every candidate finding:`,
    `- Step 0, smoke cross-check (#684 #1): grep -rlE "${pinPattern}" scripts/smoke-*.mjs — if a smoke pins the behavior as INTENDED, it is WONTFIX, not a defect.`,
    `- Adversarial verify: independently try to REFUTE the finding; DROP it unless it survives a skeptical second look.`,
    `- Anchor (#684 #2): record a stable selector / symbol (e.g. #some-id, someFunction), never a line number.`,
    ``,
    `Synthesis:`,
    `- dedupe overlapping findings;`,
    `- classify each survivor by SEVERITY (MEL-A..D, code-correctness) AND REACHABILITY (#684 #3: user-path / dev-param / edge — a code-severe edge-only defect is low priority);`,
    `- invariant guard (#684 R3) — when >= 2 survivors share a CLASS (e.g. several aria-modal sheets with no focus-trap, several CTAs dropping a known param), do NOT stop at N point-fix MELs: recommend ONE static smoke pin that makes a BRAND-NEW instance of that class fail check.mjs. Build it to the #737 quality bar (#684 R9): (a) PER-INSTANCE, not per-file — count both sides (e.g. ariaModalCount(file) <= trapCalls + allowlisted) so a file with one fixed + one unfixed instance still fails; (b) scan the FULL source floor — all of public/src, not just screens/ (the app-shell overlay lives outside it); (c) assert the EFFECT, not the shape — require the real wrap (preventDefault() / focus()), not just that the boundary comparisons exist. Reference: scripts/smoke-overlay-coverage.mjs.`,
    `- output a list of MEL candidates, one per real defect, ready to log in ScreenOps.`,
  ].join('\n');
}
