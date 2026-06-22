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

export function generateCloudDesignPrompt(screen = {}, mel = {}) {
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
    `- default / loading / empty / error where applicable`,
    `- role-correct variants for ${screen.role || 'the relevant role'}`,
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
