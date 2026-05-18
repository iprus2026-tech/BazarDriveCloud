// BD-MAP-FOUND-STUB-01 — Mapbox SDK loader stub.
// No-op. Does not fetch mapbox-gl, does not touch the DOM, does not
// add a <script> tag. BD-MAP-FOUND-01 will replace this with a real
// loader once CSP and the token surface are designed.
//
// Contract:
//   loadMapboxSdk()   → Promise<null>   (resolves to null = SDK unavailable)
//   isMapboxSdkLoaded() → boolean
//   unloadMapboxSdk() → void

export function loadMapboxSdk() {
  return Promise.resolve(null);
}

export function isMapboxSdkLoaded() {
  return false;
}

export function unloadMapboxSdk() {
  /* no-op */
}
