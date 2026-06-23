// BD-OPS-03b — ScreenOps Cloud Design connector (dev/docs tool).
//
// Orchestrates: pulls screen facts (repo connector) + contract facts
// (screen-contracts connector), formats via the Cloud Design template, and
// appends a contract reference. Pure text — no network, no credentials.

import { getScreenFacts } from './repo_connector.js';
import { getContractFacts } from './screen_contracts_connector.js';
import { generateCloudDesignPrompt } from '../templates/cloud_design_prompt_template.js';
import { variantFocusNote } from '../templates/variant_focus.js';

export function buildCloudDesignPrompt(screenId, mel = {}, variantKey) {
  const facts = getScreenFacts(screenId);
  if (!facts) return '';
  const contract = getContractFacts(facts);
  const focus = variantFocusNote(facts, variantKey);
  return generateCloudDesignPrompt(facts, mel)
    + (focus ? '\n\n' + focus : '')
    + '\n\nContract: ' + contract.contractAnchor;
}
