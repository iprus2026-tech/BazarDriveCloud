// BD-MAP-RENDER-MAP (#805) — static smoke for the first per-surface REAL Mapbox render (/map).
//
// map.js must stay DARK by default: with no token, resolveState() returns TOKEN_MISSING (never DEFAULT)
// and isMapboxEnabled() is false, so no mapboxgl.Map is ever constructed and the MapShell placeholder is
// unchanged. The live render (DEFAULT + token) is render-then-hydrate, and because router.render() has
// NO teardown, the GL context must be freed via a document.body.contains watcher. The actual visual
// render + CSP completeness are verified on a device with a real token — NOT asserted here.
//
// No DOM, no network. Pure Node / static source assertions.

import fs from 'node:fs';

const issues = [];
const expect = (label, cond, detail = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
};

const src = fs.readFileSync(new URL('../public/src/screens/map.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/styles/cloud.css', import.meta.url), 'utf8');

// ── The foundation seam is imported ──
expect('map.js imports isMapboxEnabled + getDefaultCenter + MAPBOX_STYLE from mapbox_config',
  /import\s*\{[^}]*\bisMapboxEnabled\b[^}]*\bgetDefaultCenter\b[^}]*\bMAPBOX_STYLE\b[^}]*\}\s*from\s*'\.\.\/mapbox\/mapbox_config\.js'/.test(src));
expect('map.js imports loadMapboxSdk from mapbox_loader',
  /import\s*\{\s*loadMapboxSdk\s*\}\s*from\s*'\.\.\/mapbox\/mapbox_loader\.js'/.test(src));

// ── The live render is GATED: DEFAULT state AND isMapboxEnabled() (dark never constructs a Map) ──
expect('the real-map hydrate is gated behind state === DEFAULT && isMapboxEnabled()',
  /state\s*===\s*MAP_STATE\.DEFAULT\s*&&\s*isMapboxEnabled\(\)\s*\)\s*hydrateRealMap\(/.test(src));
expect('hydrateRealMap constructs a real mapboxgl.Map with the configured style/center',
  /new\s+mapboxgl\.Map\(\{/.test(src) && /style:\s*MAPBOX_STYLE/.test(src));

// ── Render-then-hydrate is dark-safe: bail when the SDK is null (DARK) or the screen detached ──
expect('hydrate bails when loadMapboxSdk resolves null (DARK / unavailable) — placeholder stays',
  /loadMapboxSdk\(\)\.then\([^)]*\)\s*=>\s*\{[\s\S]{0,160}if\s*\(!mapboxgl\)\s*return/.test(src));
expect('hydrate re-checks document.body.contains(container) after the async load',
  /if\s*\(!document\.body\.contains\(container\)\)\s*return/.test(src));

// ── Self-clearing GL-context teardown (router.render has no teardown) ──
expect('a teardown frees the GL context (map.remove) once the container leaves the DOM',
  /!document\.body\.contains\(container\)[\s\S]{0,180}map\.remove\(\)/.test(src)
  && /clearInterval\(/.test(src));

// ── BD-MAP-RENDER-FIX: the live map keeps a real box + resizes (no 0-height blank) ──
// mapbox-gl.css `.mapboxgl-map{position:relative}` loads after cloud.css and would tie-break over
// `.map-home__map{position:absolute}`, collapsing the container to 0 height. A higher-specificity rule
// must re-assert absolute/inset:0 for the mounted map, and hydrate must resize after the box settles.
// order-independent: assert both declarations inside the `.map-home__map.mapboxgl-map { … }` block
const mountedMapRule = (css.match(/\.map-home__map\.mapboxgl-map\s*\{([^}]*)\}/) || [, ''])[1];
expect('cloud.css keeps the mounted map container absolute/inset:0 over .mapboxgl-map (no 0-height collapse)',
  /position:\s*absolute/.test(mountedMapRule) && /inset:\s*0/.test(mountedMapRule));
expect('hydrateRealMap resizes once the style loads (guards a late layout settle)',
  /map\.once\(\s*'load'\s*,[\s\S]{0,120}map\.resize\(\)/.test(src));
expect('hydrateRealMap observes container box changes via ResizeObserver → map.resize()',
  /new\s+ResizeObserver\(\s*\(\)\s*=>\s*\{[\s\S]{0,80}map\.resize\(\)/.test(src)
  && /\.observe\(container\)/.test(src));
expect('the ResizeObserver is disconnected in the detach teardown (no leak)',
  /ro\.disconnect\(\)/.test(src));
// async load failure (offline / quota 429 / revoked 401) must fall back to the placeholder, pre-load only
expect('hydrateRealMap falls back to the placeholder on a pre-load async error (offline/quota/401)',
  /map\.on\(\s*'error'\s*,[\s\S]{0,260}restoreMapPlaceholder\(container\)/.test(src)
  && /if\s*\(settled\)\s*return/.test(src));

// ── The DARK / non-token path still renders the MapShell placeholder ──
expect('buildMapPlaceholder still renders the MapShell placeholder (dark path unchanged)',
  /function buildMapPlaceholder\(state\)[\s\S]*?createMapShell\(/.test(src));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
