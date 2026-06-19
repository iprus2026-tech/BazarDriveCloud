// BD-OPS-03 — GitHub issue body generator (pure text, no I/O).
//
// Produces a scoped issue body for a screen repair. Always embeds the screen
// id, route and source file. Generates text only — it never calls GitHub.

export function generateGithubIssueBody(screen = {}, mel = {}) {
  const id = screen.id || '(unknown screen id)';
  const route = screen.route || '(unknown route)';
  const file = screen.file || '(unknown file)';
  const title = screen.title || id;
  const severity = mel.severity || 'MEL-C';
  const status = mel.status || 'DETECTED';
  const problem = mel.problem || '(describe the defect)';
  const repair = mel.requiredRepair || '(describe the required repair)';
  const decision = mel.operationalDecision || '(operational decision)';

  return [
    `## ${id} — ${title} repair`,
    ``,
    `**Route:** \`${route}\``,
    `**File:** \`${file}\``,
    `**Severity:** ${severity}`,
    `**MEL status:** ${status}`,
    ``,
    `## Problem`,
    problem,
    ``,
    `## Operational decision`,
    decision,
    ``,
    `## Required repair`,
    repair,
    ``,
    `## Scope guard`,
    `- Allowed: \`${file}\` and its scoped CSS atoms in \`public/styles/cloud.css\``,
    `- Must not touch: routing/registration, storage keys, state machines, SW precache/CSP`,
    `- Must not introduce: backend, Mapbox, auth, payment, push, APK`,
    ``,
    `## Checks`,
    `- \`node scripts/check.mjs\``,
    `- \`node scripts/dispatcher.mjs\``,
  ].join('\n');
}
