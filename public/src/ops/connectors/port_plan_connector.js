// BD-OPS / #684 #14 — port-plan connector. Gathers the screen facts and builds the
// multi-finding port plan from the screen's MEL cards (passed in by the dashboard via
// listMelForScreen, so this stays pure — no localStorage at module load).

import { getScreenFacts } from './repo_connector.js';
import { generatePortPlan } from '../templates/port_plan_template.js';

export function buildPortPlan(screenId, mels = []) {
  const facts = getScreenFacts(screenId);
  return generatePortPlan(facts, mels);
}
