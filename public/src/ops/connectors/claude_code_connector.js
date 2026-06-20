// BD-OPS-03b — ScreenOps Claude Code connector (dev/docs tool).
//
// Orchestrates: pulls screen facts + contract facts, formats via the Claude
// Code template, and appends a contract reference. Pure text — no network, no
// credentials.

import { getScreenFacts } from './repo_connector.js';
import { getContractFacts } from './screen_contracts_connector.js';
import { generateClaudeCodePrompt } from '../templates/claude_code_prompt_template.js';

export function buildClaudeCodePrompt(screenId, mel = {}) {
  const facts = getScreenFacts(screenId);
  if (!facts) return '';
  const contract = getContractFacts(facts);
  return generateClaudeCodePrompt(facts, mel) + '\n\nContract: ' + contract.contractAnchor;
}
