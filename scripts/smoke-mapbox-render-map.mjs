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
// No DOM, no network. Pure Node / source assertions and isolated state/hydration checks.

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

// Live copy requires the Mapbox load event, not merely a token or a constructed instance.
const copySource = src.match(/^const STATE_COPY = \{[\s\S]*?^\};/m)?.[0];
const liveBadgeSource = src.match(/^const LIVE_MAP_BADGE = [^\n]+;/m)?.[0];
const hydrateSource = src.match(/^function hydrateRealMap\([^\n]*\) \{[\s\S]*?^\}/m)?.[0];
const defaultBadge = copySource
  ? runInNewContext(`${copySource}\nSTATE_COPY[MAP_STATE.DEFAULT].badge;`, { MAP_STATE }) : null;
const liveBadge = liveBadgeSource ? runInNewContext(`${liveBadgeSource}\nLIVE_MAP_BADGE;`) : null;
expect('DEFAULT pre-hydration badge is neutral: Карта района', defaultBadge === 'Карта района');
expect('live badge is exactly Марфино · Mapbox', liveBadge === 'Марфино · Mapbox');
expect('mapScreen passes its rendered badge into hydration',
  /hydrateRealMap\(mapWrap,\s*mapLifecycle,\s*topbar\.querySelector\('\.map-home__sub'\)\)/.test(src));
expect('the shipped hydration function is available for behavioural checks', Boolean(hydrateSource));
if (copySource && liveBadgeSource && hydrateSource) {
  async function hydrateProbe({ sdkNull = false, sdkReject = false, constructorThrows = false } = {}) {
    const badge = { textContent: defaultBadge };
    const lifecycle = { disposed: false, mapInstance: null, teardownId: null };
    const container = { replaceChildren() {}, removeAttribute() {} };
    const raf = [], listeners = [];
    let attached = true, constructed = 0, restored = 0;
    class FakeMap {
      constructor() {
        constructed += 1;
        if (constructorThrows) throw new Error('constructor failure');
      }
      once(event, callback) { listeners.push({ event, callback }); }
      remove() {}
    }
    const hydrate = runInNewContext(`${liveBadgeSource}\n${hydrateSource}\nhydrateRealMap;`, {
      loadMapboxSdk: () => sdkReject ? Promise.reject(new Error('SDK failure'))
        : Promise.resolve(sdkNull ? null : { Map: FakeMap }),
      requestAnimationFrame: (callback) => raf.push(callback),
      document: { body: { contains: (node) => attached && node === container } },
      getDefaultCenter: () => ({ lng: 0, lat: 0, zoom: 1 }),
      MAPBOX_STYLE: 'test-style',
      restoreMapPlaceholder: () => { restored += 1; },
      setInterval: () => 1,
      clearInterval() {},
    });
    hydrate(container, lifecycle, badge);
    await Promise.resolve();
    await Promise.resolve();
    for (const callback of raf.splice(0)) callback();
    return {
      badge, lifecycle, constructed, restored,
      loadListeners: listeners.filter(({ event }) => event === 'load').length,
      detach() { attached = false; },
      fireLoad() {
        for (const { event, callback } of listeners.splice(0)) if (event === 'load') callback();
      },
    };
  }
  const loaded = await hydrateProbe();
  expect('successful Map construction registers one load callback',
    loaded.constructed === 1 && loaded.loadListeners === 1);
  expect('successful construction alone keeps the neutral badge', loaded.badge.textContent === defaultBadge);
  loaded.fireLoad();
  expect('Mapbox load changes the badge to the exact live copy', loaded.badge.textContent === liveBadge);
  for (const [label, options] of [
    ['SDK-null', { sdkNull: true }],
    ['SDK-rejection', { sdkReject: true }],
    ['constructor-failure', { constructorThrows: true }],
  ]) {
    const failed = await hydrateProbe(options);
    failed.fireLoad();
    expect(`${label} keeps the neutral badge and never registers live-copy load handling`,
      failed.badge.textContent === defaultBadge && failed.loadListeners === 0);
    expect(`${label} reaches the intended failure branch`, options.constructorThrows
      ? failed.constructed === 1 && failed.restored === 1 : failed.constructed === 0);
  }
  const disposed = await hydrateProbe();
  disposed.lifecycle.disposed = true;
  disposed.fireLoad();
  expect('load after disposal cannot apply live copy to a still-attached container',
    disposed.badge.textContent === defaultBadge);
  const detached = await hydrateProbe();
  detached.detach();
  detached.fireLoad();
  expect('load after container detachment cannot apply live copy', detached.badge.textContent === defaultBadge);
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
