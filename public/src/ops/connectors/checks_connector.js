// BD-OPS-03b — ScreenOps checks connector (dev/docs tool).
//
// Centralizes the check/smoke command set a developer runs to verify a repair,
// plus a per-screen intent guard: a `grep` that lists the smokes pinning this
// screen, so a "confirmed" MEL that is actually intentionally-pinned behavior is
// caught BEFORE a fix is written (the ScreenOps smoke cross-check). Pure text.

import { getScreenFacts } from './repo_connector.js';

export function buildCheckCommands(screenId) {
  const facts = getScreenFacts(screenId);
  const fileBase = facts && facts.file ? String(facts.file).split('/').pop() : '';
  const crossCheck = fileBase
    ? `grep -rln "${fileBase}" scripts/smoke-*.mjs   # cross-check: confirm no pin encodes the behavior you are fixing\n`
    : '';
  return crossCheck + 'node scripts/check.mjs\nnode scripts/dispatcher.mjs';
}
