// BD-OPS-03 — Screen MEL card renderer (pure text, no I/O).
//
// Renders a MEL card to a plain-text / markdown block for copy-out. Always
// embeds the screen id, route and source file.

export function renderMelCard(mel = {}) {
  const id = mel.id || '(no id)';
  const screenId = mel.screenId || '(unknown screen id)';
  const route = mel.route || '(unknown route)';
  const file = mel.file || '(unknown file)';

  return [
    `MEL card ${id}`,
    ``,
    `Screen id: ${screenId}`,
    `Route: ${route}`,
    `File: ${file}`,
    `Severity: ${mel.severity || 'MEL-C'}`,
    `Reachability: ${mel.reachability || 'user-path'}`,
    `Status: ${mel.status || 'DETECTED'}`,
    ``,
    `Problem`,
    mel.problem || '(none recorded)',
    ``,
    `Operational decision`,
    mel.operationalDecision || '(none recorded)',
    ``,
    `Required repair`,
    mel.requiredRepair || '(none recorded)',
    ``,
    `Created: ${mel.createdAt || '(unknown)'}`,
    `Updated: ${mel.updatedAt || '(unknown)'}`,
  ].join('\n');
}
