// BD-MAP-FOUND-STUB-01 — Mapbox configuration stub.
// No real token. No network. This file only documents the API
// boundary that BD-MAP-FOUND-01 will fill in once the real Mapbox
// SDK and CSP rules land.
//
// Contract:
//   getMapboxToken()  → string | null   (null = no token wired)
//   hasMapboxToken()  → boolean
//   getDefaultCenter() → { lng, lat, zoom }   (Moscow, used for placeholder)

const DEFAULT_CENTER = Object.freeze({ lng: 37.6173, lat: 55.7558, zoom: 12 });

export function getMapboxToken() {
  return null;
}

export function hasMapboxToken() {
  return false;
}

export function getDefaultCenter() {
  return { ...DEFAULT_CENTER };
}
