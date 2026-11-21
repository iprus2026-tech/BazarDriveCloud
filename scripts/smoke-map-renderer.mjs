// BD-MAP-MAPLIBRE-M2 (BD-DOCS-053, slice M2) — the provider-neutral map renderer seam.
//
// Pins: dark by default (no style, no token ⇒ no renderer, nothing loaded); MapLibre is chosen only
// when a style is configured and then wins over Mapbox; Mapbox keeps working when only its token is
// honored; the MapLibre loader injects its CSS once, memoizes the bundle, returns null (placeholder)
// on any failure and allows a retry; the vendored bundle, its worker and licence are in place at the
// pinned version and are NOT precached; the new modules ARE precached; the CSP already allows what
// the bundle needs (same-origin module + same-origin module worker). The live render with a real style
// is checked in a browser (PR description), not here.

import assert from 'node:assert/strict';
import fs from 'node:fs';

const failures = [];
let passed = 0;
async function check(label, run) {
  try {
    await run();
    passed += 1;
    console.log(`PASS — ${label}`);
  } catch (error) {
    failures.push(label);
    console.error(`FAIL — ${label}: ${error?.stack || error}`);
  }
}

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// A tiny document: <meta name="bd-map-style">, <link> injection, <head>.
function fakeDocument({ metaStyle = null } = {}) {
  const head = [];
  return {
    head: { appendChild: (el) => head.push(el) },
    headNodes: head,
    createElement: (tag) => ({ tag, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }),
    querySelector(sel) {
      if (sel === 'meta[name="bd-map-style"]') return metaStyle === null ? null : { content: metaStyle };
      if (sel === 'meta[name="bd-mapbox-token"]') return null;
      if (sel === 'link[data-bd-maplibre-css]') return head.find((el) => el.tag === 'link' && 'data-bd-maplibre-css' in el.attrs) || null;
      return null;
    },
  };
}

let seq = 0;
async function fresh({ style, metaStyle = null, mapboxToken } = {}) {
  delete globalThis.__BD_MAP_STYLE__;
  delete globalThis.__BD_MAPBOX_TOKEN__;
  if (style !== undefined) globalThis.__BD_MAP_STYLE__ = style;
  if (mapboxToken !== undefined) globalThis.__BD_MAPBOX_TOKEN__ = mapboxToken;
  globalThis.document = fakeDocument({ metaStyle });
  seq += 1;
  const q = `?t=${seq}`;
  // map_renderer imports the loader/config without the query, so load the same instances it uses.
  const renderer = await import(`../public/src/mapbox/map_renderer.js${q}`);
  const loader = await import('../public/src/mapbox/maplibre_loader.js');
  const config = await import('../public/src/mapbox/maplibre_config.js');
  loader.unloadMapLibreSdk();
  return { renderer, loader, config, doc: globalThis.document };
}

await check('dark by default: no style and no token ⇒ no renderer, null load, nothing injected', async () => {
  const { renderer, config, doc } = await fresh();
  assert.equal(config.getMapLibreStyle(), null);
  assert.equal(renderer.getMapProvider(), null);
  assert.equal(renderer.isMapRendererEnabled(), false);
  assert.equal(await renderer.loadMapRenderer(), null);
  assert.equal(doc.headNodes.length, 0, 'no <link>/<script> when dark');
});

await check('a style URL override turns MapLibre on and it wins over a Mapbox token', async () => {
  const { renderer, config } = await fresh({ style: '  map/style.json ', mapboxToken: 'pk.test' });
  assert.equal(config.getMapLibreStyle(), 'map/style.json');
  assert.equal(renderer.getMapProvider(), renderer.MAP_PROVIDER.MAPLIBRE);
});

await check('a style object override is passed through as is', async () => {
  const style = { version: 8, sources: {}, layers: [] };
  const { config } = await fresh({ style });
  assert.equal(config.getMapLibreStyle(), style);
});

await check('the committed <meta name="bd-map-style"> turns MapLibre on; an empty one stays dark', async () => {
  const on = await fresh({ metaStyle: 'map/style.json' });
  assert.equal(on.renderer.getMapProvider(), 'maplibre');
  const off = await fresh({ metaStyle: '   ' });
  assert.equal(off.renderer.getMapProvider(), null);
});

await check('only a Mapbox token ⇒ the Mapbox renderer, as today', async () => {
  const { renderer } = await fresh({ mapboxToken: 'pk.test' });
  assert.equal(renderer.getMapProvider(), renderer.MAP_PROVIDER.MAPBOX);
  assert.equal(renderer.isMapRendererEnabled(), true);
});

await check('MapLibre load: CSS once, bundle memoized, renderer carries the configured style', async () => {
  const { renderer, loader, doc } = await fresh({ style: 'map/style.json' });
  let imports = 0;
  const lib = { Map: function Map() {}, Marker: function Marker() {} };
  loader.__setMapLibreImporterForTest(async () => { imports += 1; return lib; });
  const r1 = await renderer.loadMapRenderer();
  const r2 = await renderer.loadMapRenderer();
  assert.deepEqual({ provider: r1.provider, style: r1.style }, { provider: 'maplibre', style: 'map/style.json' });
  assert.equal(r1.lib, lib);
  assert.equal(r2.lib, lib);
  assert.equal(imports, 1, 'one import for two loads');
  const links = doc.headNodes.filter((el) => el.tag === 'link');
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'vendor/maplibre-gl/maplibre-gl.css');
  assert.equal(loader.isMapLibreSdkLoaded(), true);
});

await check('a failed or malformed MapLibre load keeps the placeholder (null) and allows a retry', async () => {
  const { renderer, loader } = await fresh({ style: 'map/style.json' });
  const warn = console.warn;
  console.warn = () => {};
  try {
    loader.__setMapLibreImporterForTest(async () => { throw new Error('offline'); });
    assert.equal(await renderer.loadMapRenderer(), null);
    assert.equal(loader.isMapLibreSdkLoaded(), false);
    loader.__setMapLibreImporterForTest(async () => ({}));
    assert.equal(await renderer.loadMapRenderer(), null, 'a module without Map is not a renderer');
    const lib = { Map: function Map() {} };
    loader.__setMapLibreImporterForTest(async () => lib);
    assert.equal((await renderer.loadMapRenderer()).lib, lib, 'retry after failure succeeds');
  } finally {
    console.warn = warn;
  }
});

await check('the vendored maplibre-gl 6.16.0 bundle, its module worker and BSD licence are in place', async () => {
  const loaderSrc = read('public/src/mapbox/maplibre_loader.js');
  assert.match(loaderSrc, /const SDK_SRC = '\.\.\/\.\.\/vendor\/maplibre-gl\/maplibre-gl\.mjs';/);
  const bundle = read('public/vendor/maplibre-gl/maplibre-gl.mjs');
  assert.match(bundle.slice(0, 300), /MapLibre GL JS[\s\S]*v6\.16\.0/);
  assert.ok(fs.existsSync(new URL('../public/vendor/maplibre-gl/maplibre-gl-worker.mjs', import.meta.url)));
  assert.ok(fs.existsSync(new URL('../public/vendor/maplibre-gl/maplibre-gl.css', import.meta.url)));
  assert.match(read('public/vendor/maplibre-gl/LICENSE.txt'), /BSD/);
});

await check('service worker: the new seam modules are precached, the vendored bundle is not', async () => {
  const sw = read('public/sw.js');
  const precache = sw.slice(sw.indexOf('const PRECACHE'), sw.indexOf('];', sw.indexOf('const PRECACHE')));
  for (const f of ['map_renderer.js', 'maplibre_config.js', 'maplibre_loader.js']) {
    assert.ok(precache.includes(`'./src/mapbox/${f}'`), `${f} precached`);
  }
  assert.ok(!/vendor\/maplibre-gl/.test(precache), 'vendored maplibre-gl stays out of PRECACHE');
});

await check('the CSP already allows the bundle (script-src \'self\') and its same-origin module worker (worker-src \'self\')', async () => {
  const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(read('public/index.html'))?.[1] || '';
  assert.match(csp, /script-src 'self';/);
  assert.match(csp, /worker-src 'self'/);
});

await check('the /map container fills its stage for both renderers (their CSS sets position: relative)', async () => {
  const css = read('public/styles/cloud.css');
  assert.match(css, /\.map-home__map\.mapboxgl-map,\s*\n\.map-home__map\.maplibregl-map \{\s*\n\s*position: absolute;\s*\n\s*inset: 0;\s*\n\s*width: 100%;\s*\n\s*height: 100%;/);
});

if (failures.length) {
  console.error(`FAIL ${failures.length} expectation(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`${passed} passed; 0 failed`);
