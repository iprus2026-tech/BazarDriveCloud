// BD-OPS-03b — ScreenOps GitHub issue connector (dev/docs tool).
//
// Orchestrates: pulls screen facts + contract facts, formats via the GitHub
// issue template, and appends a contract reference. Generates text only — it
// never calls GitHub and holds no credentials.

import { getScreenFacts } from './repo_connector.js';
import { getContractFacts } from './screen_contracts_connector.js';
import { generateGithubIssueBody } from '../templates/github_issue_template.js';

export function buildGithubIssue(screenId, mel = {}) {
  const facts = getScreenFacts(screenId);
  if (!facts) return '';
  const contract = getContractFacts(screenId);
  return generateGithubIssueBody(facts, mel) + '\n\nContract: ' + contract.contractAnchor;
}
