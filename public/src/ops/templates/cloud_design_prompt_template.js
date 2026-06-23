// BD-OPS-03 — Cloud Design prompt generator (pure text, no I/O).
//
// Produces a scoped Cloud Design prompt for repairing a crooked screen. Always
// embeds the screen id, route and source file so the prompt is never vague.

// The cloud.css :root design-system palette. Injected into the Reuse block so a
// returned design is already mapped to the runtime tokens instead of inventing
// colours / sizes — the BD-CHAT-01 port landed cleanly only because the prototype
// happened to use these exact names (#684 #11). smoke-ops-screens cross-checks each
// advertised token against cloud.css :root so this list can't drift.
//
// This is the COMPLETE design-token set (surfaces, text, lines, accent, semantic
// status, spacing, radius). The semantic status tokens are included because the
// advertised atoms depend on them (`.chat__online-dot` uses --success; the
// `.chat__trip-status` tones reuse the inbox status palette) — advertising those
// atoms while forbidding their tokens would push designs toward raw colours
// (Codex #704). Runtime layout plumbing (--tabbar-h, --scroll-pb, the safe-area
// insets) is deliberately excluded — it is not a design token.
const CLOUD_DESIGN_TOKENS = [
  '--bg-0', '--bg-1', '--bg-2', '--bg-3',
  '--text', '--text-1', '--text-2', '--text-3',
  '--line', '--line-strong',
  '--accent', '--accent-soft', '--accent-strong',
  '--success', '--warning', '--danger', '--info',
  '--pad', '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl',
];

// Build the Reuse block: always advertise the token palette; when the screen
// declares its CSS atoms (registry `cssAtoms` fact) list them as the explicit
// reuse contract so the design restyles them in place instead of forking a
// parallel class system. Degrades to a generic line when the fact is absent.
function reuseLines(screen = {}) {
  const lines = [
    `- design tokens — use ONLY these cloud.css custom properties (do not invent colours / sizes):`,
    `  ${CLOUD_DESIGN_TOKENS.join(', ')}`,
  ];
  const atoms = Array.isArray(screen.cssAtoms)
    ? screen.cssAtoms.filter((a) => typeof a === 'string' && a.trim())
    : [];
  if (atoms.length) {
    lines.push(`- reuse this screen's existing cloud.css atoms (restyle in place, do NOT fork a parallel class system):`);
    atoms.forEach((a) => lines.push(`  · ${a}`));
  } else {
    lines.push(`- the current cloud.css atoms for this screen (reuse; do not fork a parallel class system)`);
  }
  lines.push(`- neighbouring screens for layout parity`);
  return lines;
}

// Map each MEL lifecycle state (#10 vocab) to a Cloud Design brief line. The
// "Required states" block is driven by mel.lifecycleAudited — the entry-states the audit
// COVERED (probed) on this screen — so the design is asked to handle exactly those
// (BD-CHAT-01: first-entry + terminal) rather than a generic checklist (#684 #12). These
// are coverage context, NOT a defect list: the actual defect lives in Problem / Required
// repair, so a probed-but-passing state is never demanded as a repair target (Codex #705).
// Keys MUST match ops_mel_store MEL_LIFECYCLE_STATES; smoke-ops-screens asserts every
// store state has a brief here (anti-drift).
const LIFECYCLE_STATE_BRIEF = {
  'first-entry':   'first-entry — opened for the first time, no data yet: design the GENUINE empty / first-run state (not fabricated content)',
  'live-mid-flow': 'live-mid-flow — the active, in-progress state with real data',
  'terminal':      'terminal — the completed / canceled / ended state: read-only / locked where the flow is over',
  're-entry':      're-entry — returning after leaving: the restored / resumed state',
};

// When the MEL records which lifecycle states it audited, ask the design to cover
// exactly those; otherwise fall back to the generic checklist.
function requiredStatesLines(screen = {}, mel = {}, variantKey = '') {
  const audited = Array.isArray(mel.lifecycleAudited)
    ? mel.lifecycleAudited.filter((s) => typeof s === 'string' && LIFECYCLE_STATE_BRIEF[s])
    : [];
  const lines = [];
  if (audited.length) {
    lines.push(`- lifecycle entry-states this screen must cover (audited; the specific defect is in Problem / Required repair above) — design each correctly:`);
    audited.forEach((s) => lines.push(`  · ${LIFECYCLE_STATE_BRIEF[s]}`));
    lines.push(`- plus default / loading / error where applicable`);
  } else {
    lines.push(`- default / loading / empty / error where applicable`);
  }
  // #684 #1 — when a role variant is focused, ask for THAT render path only; emitting the
  // full role list here would contradict the appended "Role variant focus" scope note.
  const focusV = variantKey
    ? (Array.isArray(screen.variants) ? screen.variants : []).find((v) => v && v.key === variantKey)
    : null;
  lines.push(focusV
    ? `- render-correct output for the ${focusV.label || focusV.key} variant ONLY (${focusV.anchor || '?'}) — do not design the screen's other role variants`
    : `- role-correct variants for ${screen.role || 'the relevant role'}`);
  return lines;
}

export function generateCloudDesignPrompt(screen = {}, mel = {}, variantKey = '') {
  const id = screen.id || '(unknown screen id)';
  const route = screen.route || '(unknown route)';
  const file = screen.file || '(unknown file)';
  const title = screen.title || id;
  const problem = mel.problem || '(describe the visual / behavioural defect)';
  const severity = mel.severity || 'MEL-C';
  const repair = mel.requiredRepair || '(describe the required repair)';

  return [
    `Cloud Design prompt — ${title}`,
    ``,
    `Screen id: ${id}`,
    `Route: ${route}`,
    `Source file: ${file}`,
    `Severity: ${severity}`,
    ``,
    `Problem`,
    problem,
    ``,
    `Required repair`,
    repair,
    ``,
    `Required states to cover`,
    ...requiredStatesLines(screen, mel, variantKey),
    ``,
    `Reuse`,
    ...reuseLines(screen),
    ``,
    `Acceptance`,
    `- matches Cloud Design parity for ${route}`,
    `- no regression to neighbouring screens`,
    ``,
    `Out of scope`,
    `- backend, Mapbox, auth, payment, push or APK work`,
    `- do not paste real credentials or private keys into the design tool`,
  ].join('\n');
}
