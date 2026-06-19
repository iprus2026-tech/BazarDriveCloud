// BD-OPS-03b — ScreenOps repo connector (dev/docs tool).
//
// Surfaces repo/runtime facts (route, source file, role, status) for a screen
// from the static registry. Pure: no network, no fetch, no dynamic import, no
// filesystem probing — it only reads the in-memory registry data.

import { getScreen, getScreens } from '../ops_registry.js';

export function getScreenFacts(screenId) {
  return getScreen(screenId);
}

export function listScreenFacts() {
  return getScreens();
}
