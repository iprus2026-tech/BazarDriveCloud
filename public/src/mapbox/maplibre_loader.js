// public/src/mapbox/maplibre_loader.js — BD-MAP-MAPLIBRE-M2 (BD-DOCS-053, slice M2).
//
// Lazy loader for the VENDORED MapLibre GL JS (public/vendor/maplibre-gl/, maplibre-gl@6.16.0,
// BSD-3-Clause). DARK by default: with no style configured (isMapLibreEnabled() false) it returns null
// without touching the DOM or the network.
//
// The v6 dist is an ES module: it is loaded with a dynamic import() of a same-origin file (allowed by
// script-src 'self'), and it starts its tile worker as a same-origin module worker
// (maplibre-gl-worker.mjs next to it; allowed by worker-src 'self'). The CSS is a vendored <link>
// ('self'). The vendored files are NOT precached (like the Mapbox bundle): the service worker caches
// them on first use, and only map users download them.
//
// Contract (mirrors mapbox_loader.js):
//   loadMapLibreSdk()    → Promise<maplibregl namespace | null>   (null = DARK / unavailable)
//   isMapLibreSdkLoaded() → boolean
//   unloadMapLibreSdk()   → void

import { isMapLibreEnabled } from './maplibre_config.js';

const SDK_SRC = '../../vendor/maplibre-gl/maplibre-gl.mjs'; // relative to this module
const CSS_SRC = 'vendor/maplibre-gl/maplibre-gl.css';         // relative to the document

let sdkPromise = null;
let loaded = false;

function injectStylesheetOnce() {
  if (document.querySelector('link[data-bd-maplibre-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CSS_SRC;
  link.setAttribute('data-bd-maplibre-css', '');
  document.head.appendChild(link);
}

// Indirection so the smoke can observe the import without loading a 1 MB bundle in Node.
let importSdk = () => import(SDK_SRC);
export function __setMapLibreImporterForTest(fn) { importSdk = fn; }

export function loadMapLibreSdk() {
  if (!isMapLibreEnabled() || typeof document === 'undefined') return Promise.resolve(null);
  if (sdkPromise) return sdkPromise;
  sdkPromise = (async () => {
    try {
      injectStylesheetOnce();
      const lib = await importSdk();
      if (!lib || typeof lib.Map !== 'function') throw new Error('maplibre-gl loaded without a Map constructor');
      loaded = true;
      return lib;
    } catch (err) {
      console.warn('[maplibre] SDK load failed; staying on the placeholder.', err);
      sdkPromise = null; // allow a later retry
      loaded = false;
      return null;
    }
  })();
  return sdkPromise;
}

export function isMapLibreSdkLoaded() {
  return loaded;
}

export function unloadMapLibreSdk() {
  sdkPromise = null;
  loaded = false;
}
