// BD-OPS-03b — ScreenOps checks connector (dev/docs tool).
//
// Centralizes the check/smoke command set a developer runs to verify a repair,
// plus a per-screen intent guard: a `grep` that lists the smokes pinning this
// screen, so a "confirmed" MEL that is actually intentionally-pinned behavior is
// caught BEFORE a fix is written (the ScreenOps smoke cross-check). Pure text.

import { getScreenFacts } from './repo_connector.js';

// Regex-escape a term for a `grep -E` alternation.
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildCheckCommands(screenId) {
  const facts = getScreenFacts(screenId) || {};
  const fileBase = facts.file ? String(facts.file).split('/').pop() : '';
  // Search by BOTH source filename AND route — some smokes pin a screen by its
  // route (e.g. "/route-picker"), not its source file, so a filename-only grep
  // would silently miss those pins and read as "no pins".
  const pattern = [fileBase, facts.route].filter(Boolean).map(escapeRe).join('|');
  const crossCheck = pattern
    ? '# cross-check: smokes pinning this screen by file OR route — confirm none encodes the behavior you are fixing\n'
      + `grep -rlE "${pattern}" scripts/smoke-*.mjs || echo '(no file/route pin — check by selector)'\n`
    : '';
  return crossCheck + 'node scripts/check.mjs\nnode scripts/dispatcher.mjs';
}
