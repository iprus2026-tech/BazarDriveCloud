// BD-OPS-03 — Cloud Design prompt generator (pure text, no I/O).
//
// Produces a scoped Cloud Design prompt for repairing a crooked screen. Always
// embeds the screen id, route and source file so the prompt is never vague.

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
    `- existing Cloud Design tokens and the current cloud.css atoms`,
    `- neighbouring screens for layout parity`,
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
