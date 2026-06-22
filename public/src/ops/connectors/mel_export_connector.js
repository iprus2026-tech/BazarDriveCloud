// BD-OPS / #684 #6 — MEL export connector. Gathers the screen facts and serialises
// the screen's MEL cards (passed in by the dashboard via listMelForScreen, so this
// stays pure — no localStorage at module load) into a portable review artifact — a
// markdown digest + a round-trippable JSON block. Read-only: it never touches the
// bazardrive.ops.mel.v1 key, so the dev-scratchpad boundary stays intact.

import { getScreenFacts } from './repo_connector.js';
import { generateMelExport } from '../templates/mel_export_template.js';

export function buildMelExport(screenId, mels = []) {
  const facts = getScreenFacts(screenId);
  return generateMelExport(facts, mels);
}
