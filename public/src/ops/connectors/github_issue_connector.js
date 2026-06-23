// BD-OPS-03b — ScreenOps GitHub issue connector (dev/docs tool).
//
// Orchestrates: pulls screen facts + contract facts, formats via the GitHub
// issue template, and appends a contract reference. Generates text only — it
// never calls GitHub and holds no credentials.

import { getScreenFacts } from './repo_connector.js';
import { getContractFacts } from './screen_contracts_connector.js';
import { generateGithubIssueBody } from '../templates/github_issue_template.js';
import { variantFocusNote } from '../templates/variant_focus.js';

export function buildGithubIssue(screenId, mel = {}, variantKey) {
  const facts = getScreenFacts(screenId);
  if (!facts) return '';
  const contract = getContractFacts(facts);
  const focus = variantFocusNote(facts, variantKey);
  return generateGithubIssueBody(facts, mel)
    + (focus ? '\n\n' + focus : '')
    + '\n\nContract: ' + contract.contractAnchor;
}
