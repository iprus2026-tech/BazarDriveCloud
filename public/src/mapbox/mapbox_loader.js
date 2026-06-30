// public/src/mapbox/mapbox_loader.js — BD-MAP-FOUND-01 (#805, real Mapbox foundation).
//
// Lazy loader for the VENDORED Mapbox GL JS (public/vendor/mapbox-gl/, mapbox-gl@3.25.0). DARK by
// default: when no token is configured (isMapboxEnabled() false) loadMapboxSdk() returns null WITHOUT
// touching the DOM, injecting a <script>, or hitting the network — so the placeholder MapShell stays
// and the app is byte-for-byte unchanged. The vendored dist is UMD (sets window.mapboxgl), so it is
// loaded via a dynamically-injected <script src> ('self' — allowed by script-src 'self'); the CSS is a
// vendored <link> ('self'). This live path is dark-inert today and is exercised/verified at activation
// (a per-surface render slice with a real token).
//
// Contract (preserved from the BD-MAP-FOUND-STUB-01 stub):
//   loadMapboxSdk()   → Promise<mapboxgl | null>   (null = SDK unavailable / DARK)
//   isMapboxSdkLoaded() → boolean
//   unloadMapboxSdk() → void

import { isMapboxEnabled, getMapboxToken } from './mapbox_config.js';

const SDK_SRC = 'vendor/mapbox-gl/mapbox-gl.js';
const CSS_SRC = 'vendor/mapbox-gl/mapbox-gl.css';

let sdkPromise = null; // memoized in-flight / resolved load
let loaded = false;

function injectStylesheetOnce() {
  if (typeof document === 'undefined') return;
  if (document.querySelector(`link[data-bd-mapbox-css]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CSS_SRC;
  link.setAttribute('data-bd-mapbox-css', '');
  document.head.appendChild(link);
}

function injectSdkScript() {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-bd-mapbox-sdk]`);
    if (existing && window.mapboxgl) { resolve(window.mapboxgl); return; }
    const script = document.createElement('script');
    script.src = SDK_SRC;
    script.async = true;
    script.setAttribute('data-bd-mapbox-sdk', '');
    script.onload = () => {
      if (window.mapboxgl) resolve(window.mapboxgl);
      else reject(new Error('mapbox-gl loaded but window.mapboxgl is absent'));
    };
    script.onerror = () => reject(new Error('failed to load the vendored mapbox-gl script'));
    document.head.appendChild(script);
  });
}

// Returns the Mapbox GL namespace with accessToken set, or null when DARK / on any failure.
export function loadMapboxSdk() {
  // DARK: no token ⇒ no DOM, no <script>, no network. Mirrors api_config OFF.
  if (!isMapboxEnabled() || typeof document === 'undefined') return Promise.resolve(null);
  if (sdkPromise) return sdkPromise;
  sdkPromise = (async () => {
    try {
      injectStylesheetOnce();
      const mapboxgl = await injectSdkScript();
      mapboxgl.accessToken = getMapboxToken();
      loaded = true;
      return mapboxgl;
    } catch (err) {
      console.warn('[mapbox] SDK load failed; staying on the placeholder.', err);
      sdkPromise = null; // allow a later retry
      loaded = false;
      return null;
    }
  })();
  return sdkPromise;
}

export function isMapboxSdkLoaded() {
  return loaded;
}

export function unloadMapboxSdk() {
  sdkPromise = null;
  loaded = false;
}
