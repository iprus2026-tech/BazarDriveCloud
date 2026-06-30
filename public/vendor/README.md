# Vendored third-party libraries

Self-hosted copies of third-party runtime libraries, kept here so the PWA's strict CSP can stay
`script-src 'self'` (no external CDN script source) and the lib is offline-cacheable.

## mapbox-gl

- **Package:** `mapbox-gl@3.25.0` (Mapbox GL JS)
- **Source:** https://unpkg.com/mapbox-gl@3.25.0/dist/ (`mapbox-gl.js` UMD bundle + `mapbox-gl.css`)
- **License:** BSD-3-Clause (Mapbox GL JS); use is subject to the Mapbox Terms of Service.
- **Why vendored:** BD-MAP-FOUND-01 (#805). Loaded lazily by `public/src/mapbox/mapbox_loader.js`
  ONLY when a Mapbox token is configured (dark by default — no token ⇒ the placeholder MapShell
  stays). NOT in the service-worker PRECACHE (≈1.8 MB; lazy-loaded; offline-map is a later concern).
- **Update:** re-download the same two files from unpkg at the pinned version, then bump `public/sw.js`
  VERSION only if a *precached* file changed (the vendored lib itself is not precached).
