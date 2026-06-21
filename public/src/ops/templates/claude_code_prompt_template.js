// BD-OPS-03 — Claude Code prompt generator (pure text, no I/O).
//
// Produces a scoped code-agent prompt for a screen repair. Always embeds the
// screen id, route and source file, plus an explicit must-not-touch block.

function branchFor(screen = {}) {
  const raw = String(screen.id || 'screen')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'screen';
  return `fix/${raw}-repair`;
}

export function generateClaudeCodePrompt(screen = {}, mel = {}) {
  const id = screen.id || '(unknown screen id)';
  const route = screen.route || '(unknown route)';
  const file = screen.file || '(unknown file)';
  const title = screen.title || id;
  const problem = mel.problem || '(describe the defect)';
  const repair = mel.requiredRepair || '(describe the required repair)';
  const fileBase = String(file).split('/').pop() || file;

  return [
    `Task: repair ${id} — ${title}`,
    ``,
    `Route: ${route}`,
    `File: ${file}`,
    `Suggested branch: ${branchFor(screen)}`,
    ``,
    `Step 0 — cross-check the smoke suite (intent guard)`,
    `A "confirmed" defect can be intentionally-pinned behavior. Before changing anything:`,
    `- find the smokes that pin this screen:  grep -rln "${fileBase}" scripts/smoke-*.mjs`,
    `- read them (and the selectors you are about to touch); if one pins the behavior as INTENDED, stop — this may be WONTFIX or need a different fix.`,
    `- never edit a pin to force the fix through; if your change breaks a pin, reconsider the fix, not the test.`,
    ``,
    `What to change`,
    repair,
    ``,
    `Context / problem`,
    problem,
    ``,
    `Allowed files`,
    `- ${file}`,
    `- public/styles/cloud.css (scoped atoms for this screen only)`,
    ``,
    `Must not touch`,
    `- route registration in public/src/app.js (unless the task is the route)`,
    `- public/sw.js precache / CSP / public/index.html`,
    `- localStorage keys, state machines, mock_api semantics`,
    `- backend, Mapbox, auth, payment, push, APK`,
    `- do not add real credentials or private keys`,
    ``,
    `Verify`,
    `- node scripts/check.mjs`,
    `- node scripts/dispatcher.mjs`,
    `- manual: open ${route} and confirm the repair`,
  ].join('\n');
}
