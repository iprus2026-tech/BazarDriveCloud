// BD-OPS-03b — ScreenOps screen-contracts connector (dev/docs tool).
//
// Derives contract metadata for a screen from the static registry facts. Pure:
// no file I/O, no network — it never reads docs/screen-contracts.md at runtime,
// it only computes the anchor a developer can follow.

import { getScreenFacts } from './repo_connector.js';

export function getContractFacts(screenId) {
  const s = getScreenFacts(screenId);
  if (!s) return null;
  return {
    id: s.id,
    contractStatus: s.contractStatus,
    designStatus: s.designStatus,
    melStatus: s.melStatus,
    contractAnchor: 'docs/screen-contracts.md#' + String(s.id).toLowerCase(),
  };
}
