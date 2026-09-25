// BD-MAP-RENDER-MAP (#805) — static + behavioural smoke for the first per-surface REAL Mapbox render (/map).
//
// map.js must stay DARK by default: with no token, resolveState() returns TOKEN_MISSING (never DEFAULT)
// and isMapboxEnabled() is false, so no mapboxgl.Map is ever constructed and the MapShell placeholder is
// unchanged. The live render (DEFAULT + token) is render-then-hydrate. router.js now owns a disposer
// (BD-SCREEN-LIFECYCLE-01A, #919) that is the primary teardown and frees the GL context; the
// document.body.contains watcher below is only a defensive backstop for a detachment the disposer
// somehow didn't observe. The actual visual render + CSP completeness are verified on a device with a
// real token — NOT asserted here.
//
// No DOM, no network. Pure Node / source assertions and isolated state resolution.

import fs from 'node:fs';
import { runInNewContext } from 'node:vm';
import { MAP_STATE, isValidMapState } from '../public/src/mapbox/mapbox_state.js';
import { GEO_STATUS } from '../public/src/mapbox/geolocation_service.js';

const issues = [];
const expect = (label, cond, detail = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
};

const src = fs.readFileSync(new URL('../public/src/screens/map.js', import.meta.url), 'utf8');

// Exercise the shipped resolver without importing the screen's DOM/router dependencies.
const queryKeysSource = src.match(/^const STATE_QUERY_KEYS = new Map\([\s\S]*?^\]\);/m)?.[0];
const resolveSource = src.match(/^function resolveState\(query, prefs\) \{[\s\S]*?^\}/m)?.[0];
expect('the shipped state query map and resolver are available for behavioural checks',
  Boolean(queryKeysSource && resolveSource));
if (queryKeysSource && resolveSource) {
  for (const tokenAvailable of [false, true]) {
    const resolve = runInNewContext(`${queryKeysSource}\n${resolveSource}\nresolveState;`, {
      MAP_STATE, isValidMapState, GEO_STATUS,
      hasMapboxToken: () => tokenAvailable,
      getPermissionStatus: () => GEO_STATUS.UNKNOWN,
    });
    const cases = [
      ['default', tokenAvailable ? MAP_STATE.DEFAULT : MAP_STATE.TOKEN_MISSING],
      [null, tokenAvailable ? MAP_STATE.DEFAULT : MAP_STATE.TOKEN_MISSING],
      ['nearby', MAP_STATE.NEARBY],
      ['permission', MAP_STATE.PERMISSION],
      ['denied', MAP_STATE.DENIED],
      ['token-missing', MAP_STATE.TOKEN_MISSING],
      ['token_missing', MAP_STATE.TOKEN_MISSING],
    ];
    for (const [requested, expected] of cases) {
      const query = new URLSearchParams(requested === null ? '' : `state=${requested}`);
      expect(`${tokenAvailable ? 'TOKEN' : 'NO TOKEN'} + ${requested === null ? 'no override' : `requested ${requested}`} => ${expected}`,
        resolve(query, { locationAllowed: true }) === expected);
    }
  }
}

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
  /!document\.body\.contains\(container\)[\s\S]{0,80}map\.remove\(\)/.test(src)
  && /clearInterval\(/.test(src));

// ── The DARK / non-token path still renders the MapShell placeholder ──
expect('buildMapPlaceholder still renders the MapShell placeholder (dark path unchanged)',
  /function buildMapPlaceholder\(state\)[\s\S]*?createMapShell\(/.test(src));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
