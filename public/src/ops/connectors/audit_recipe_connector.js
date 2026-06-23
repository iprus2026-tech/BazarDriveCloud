// BD-OPS-03b — ScreenOps audit-recipe connector (dev/docs tool).
//
// Pulls screen facts + the contract anchor and formats the standardized AUDIT
// prompt (the find-MELs brief, complementary to the repair prompt). Pure text — no
// network, no credentials.

import { getScreenFacts } from './repo_connector.js';
import { getContractFacts } from './screen_contracts_connector.js';
import { generateAuditRecipe } from '../templates/audit_recipe_template.js';

export function buildAuditRecipe(screenId, variantKey) {
  const facts = getScreenFacts(screenId);
  if (!facts) return '';
  const contract = getContractFacts(facts);
  // #684 — variantKey ('' / undefined = «Все») scopes the variant-aware recipe to one
  // declared role variant; ignored for single-render screens.
  return generateAuditRecipe(facts, { variant: variantKey }) + '\n\nContract: ' + contract.contractAnchor;
}
