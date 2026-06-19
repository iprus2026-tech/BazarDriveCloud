// BD-OPS-03b — ScreenOps checks connector (dev/docs tool).
//
// Centralizes the check/smoke command set a developer runs to verify a repair.
// `screenId` is accepted and reserved for future per-screen tailoring (e.g. a
// screen-specific smoke); the MVP returns the standard command set. Pure text.

export function buildCheckCommands(screenId) {
  void screenId;
  return 'node scripts/check.mjs\nnode scripts/dispatcher.mjs';
}
