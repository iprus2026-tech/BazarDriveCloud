// BD-MAP-FOUND-05G — Shared primitives for the Mapbox foundation stubs.
// Both helpers are pure, side-effect-free, and DOM-free. Extracted from
// driver_markers.js and trip_status_layer.js so the foundation modules
// share a single source of truth (issue #389 checklist item 4).
// No Mapbox SDK, no token, no network, no CDN, no inline style.

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function safeArray(value) {
  return Array.isArray(value) ? value : [];
}
