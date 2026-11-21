// public/src/mapbox/maplibre_config.js — BD-MAP-MAPLIBRE-M2 (BD-DOCS-053, slice M2).
//
// The on/off switch for the vendored MapLibre GL JS renderer. DARK by default: getMapLibreStyle()
// returns null, so isMapLibreEnabled() is false and map_renderer.js falls through to the existing
// Mapbox seam (or to the placeholder when that is dark too). Nothing loads from this module.
//
// MapLibre turns ON only when a style is configured. Two CSP-safe sources (no inline <script>), in
// precedence order — the same shape as mapbox_config.js:
//   1. globalThis.__BD_MAP_STYLE__ — a style URL string or a style object; set by a test, a local
//      dev override, or a future build step. Honored on any origin.
//   2. <meta name="bd-map-style" content="…"> — a committed style URL, read from this external module
//      (allowed under script-src 'self'). Absent today, so production keeps the Mapbox map.
// The style's tile/glyph/sprite hosts must also be allowed by the CSP; that is its own
// safety-boundary slice (BD-DOCS-053 D3, M3b), not this module.
//
// NO Web-Storage access here (keeps the BD-DATA-STATIC-01 gate clean) — pure config, read at call time.
//
// Contract:
//   getMapLibreStyle()  → string | object | null   (null = no style configured = DARK)
//   isMapLibreEnabled() → boolean

function readMetaStyle() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return '';
  const el = document.querySelector('meta[name="bd-map-style"]');
  return el && typeof el.content === 'string' ? el.content.trim() : '';
}

export function getMapLibreStyle() {
  const override = typeof globalThis !== 'undefined' ? globalThis.__BD_MAP_STYLE__ : undefined;
  if (override && typeof override === 'object') return override;
  if (typeof override === 'string' && override.trim()) return override.trim();
  const meta = readMetaStyle();
  return meta === '' ? null : meta;
}

export function isMapLibreEnabled() {
  return getMapLibreStyle() !== null;
}
