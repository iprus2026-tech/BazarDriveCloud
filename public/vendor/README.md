# Vendored third-party libraries

Self-hosted copies of third-party runtime libraries, kept here so the PWA's strict CSP can stay
`script-src 'self'` (no external CDN script source) and the lib is offline-cacheable.

## mapbox-gl

- **Package:** `mapbox-gl@3.25.0` (Mapbox GL JS)
- **Source:** https://unpkg.com/mapbox-gl@3.25.0/dist/ (`mapbox-gl.js` UMD bundle + `mapbox-gl.css`)
- **License:** PROPRIETARY — Mapbox TOS (`SEE LICENSE IN LICENSE.txt`); use only with Mapbox
  products and a Mapbox account/token. NOT open-source: BSD-3-Clause applied to mapbox-gl **v1.x only**;
  v2.0+ (incl. 3.25.0) is the Mapbox Terms of Service. Full text vendored at `./mapbox-gl/LICENSE.txt`.
- **Why vendored:** BD-MAP-FOUND-01 (#805). Loaded lazily by `public/src/mapbox/mapbox_loader.js`
  ONLY when a Mapbox token is configured (dark by default — no token ⇒ the placeholder MapShell
  stays). NOT in the service-worker PRECACHE (≈1.8 MB; lazy-loaded; offline-map is a later concern).
- **Update:** re-download from unpkg at the pinned version (`mapbox-gl.js` + `mapbox-gl.css` +
  `LICENSE.txt`), then **bump `public/sw.js` VERSION**. Although the lib is not in PRECACHE, `sw.js`
  runtime-caches every same-origin GET under `CACHE_NAME`, so a vendor update without a bump would serve
  the stale SDK to installed clients — `scripts/check-precache-drift.mjs` enforces a VERSION bump for any
  `public/vendor/` change (Codex #809).
