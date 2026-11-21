// public/src/mapbox/map_renderer.js — BD-MAP-MAPLIBRE-M2 (BD-DOCS-053, slice M2).
//
// The provider-neutral seam the map screens use. A screen asks for "the map renderer"; it no longer
// imports a specific SDK. MapLibre and Mapbox GL share the same API for what the screens use
// (new lib.Map({ container, style, center, zoom }), new lib.Marker({ element }), map.once('load'),
// map.resize(), map.remove()), so a screen works with either.
//
// Selection, in order:
//   1. MapLibre — when a style is configured (maplibre_config.js). Off today.
//   2. Mapbox   — when its token is honored (mapbox_config.js). On today on the GitHub Pages origin only.
//   3. none     — the placeholder MapShell stays (every other origin, every test).
// A MapLibre load failure does NOT fall back to Mapbox: the placeholder stays, exactly as a Mapbox
// load failure behaves today. Mapbox is removed after the MapLibre surface ships (BD-DOCS-053 M3c).
//
// Contract:
//   MAP_PROVIDER            → { MAPLIBRE: 'maplibre', MAPBOX: 'mapbox' }
//   getMapProvider()        → 'maplibre' | 'mapbox' | null
//   isMapRendererEnabled()  → boolean
//   loadMapRenderer()       → Promise<{ provider, lib, style } | null>   (null = DARK / unavailable)

import { isMapboxEnabled, MAPBOX_STYLE } from './mapbox_config.js';
import { loadMapboxSdk } from './mapbox_loader.js';
import { getMapLibreStyle, isMapLibreEnabled } from './maplibre_config.js';
import { loadMapLibreSdk } from './maplibre_loader.js';

export const MAP_PROVIDER = Object.freeze({ MAPLIBRE: 'maplibre', MAPBOX: 'mapbox' });

export function getMapProvider() {
  if (isMapLibreEnabled()) return MAP_PROVIDER.MAPLIBRE;
  if (isMapboxEnabled()) return MAP_PROVIDER.MAPBOX;
  return null;
}

export function isMapRendererEnabled() {
  return getMapProvider() !== null;
}

export async function loadMapRenderer() {
  const provider = getMapProvider();
  if (provider === MAP_PROVIDER.MAPLIBRE) {
    const lib = await loadMapLibreSdk();
    return lib ? { provider, lib, style: getMapLibreStyle() } : null;
  }
  if (provider === MAP_PROVIDER.MAPBOX) {
    const lib = await loadMapboxSdk();
    return lib ? { provider, lib, style: MAPBOX_STYLE } : null;
  }
  return null;
}
