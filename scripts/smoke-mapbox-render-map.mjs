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
      pinPublicPlaces: () => {},
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

  // #1136 — the map follows its CONTAINER (Telegram changes the shell height through a CSS variable,
  // with no window resize): a ResizeObserver on the container calls map.resize() once per frame, never
  // after disposal, and is disconnected when the container leaves the DOM.
  async function resizeProbe() {
    const lifecycle = { disposed: false, mapInstance: null, teardownId: null, resizeObserver: null };
    const container = { replaceChildren() {}, removeAttribute() {} };
    const raf = [], observers = [];
    let attached = true, resizes = 0, removed = 0, poll = null;
    class FakeMap { once() {} remove() { removed += 1; } resize() { resizes += 1; } }
    class FakeResizeObserver {
      constructor(callback) { this.callback = callback; this.targets = []; this.disconnected = false; observers.push(this); }
      observe(node) { this.targets.push(node); }
      disconnect() { this.disconnected = true; }
      fire() { if (!this.disconnected) this.callback([{ target: this.targets[0] }]); }
    }
    const hydrate = runInNewContext(`${liveBadgeSource}\n${hydrateSource}\nhydrateRealMap;`, {
      loadMapboxSdk: () => Promise.resolve({ Map: FakeMap }),
      requestAnimationFrame: (callback) => { raf.push(callback); return raf.length; },
      ResizeObserver: FakeResizeObserver,
      document: { body: { contains: (node) => attached && node === container } },
      getDefaultCenter: () => ({ lng: 0, lat: 0, zoom: 1 }),
      MAPBOX_STYLE: 'test-style',
      pinPublicPlaces: () => {},
      restoreMapPlaceholder: () => {},
      setInterval: (callback) => { poll = callback; return 7; },
      clearInterval() {},
    });
    hydrate(container, lifecycle, null);
    await Promise.resolve();
    await Promise.resolve();
    for (const callback of raf.splice(0)) callback();
    return {
      lifecycle, observers, container,
      get resizes() { return resizes; }, get removed() { return removed; },
      flushFrames() { for (const callback of raf.splice(0)) callback(); },
      pendingFrames: () => raf.length,
      detach() { attached = false; }, runPoll() { poll(); },
    };
  }
  const r = await resizeProbe();
  const [observer] = r.observers;
  expect('#1136: one ResizeObserver observes the map container after hydration',
    r.observers.length === 1 && observer.targets.length === 1 && observer.targets[0] === r.container
    && r.lifecycle.resizeObserver === observer);
  observer.fire();
  observer.fire();
  expect('#1136: container changes within one frame schedule a single resize', r.pendingFrames() === 1 && r.resizes === 0);
  r.flushFrames();
  expect('#1136: the frame calls map.resize() exactly once', r.resizes === 1);
  observer.fire();
  r.flushFrames();
  expect('#1136: a later container change resizes again', r.resizes === 2);
  r.lifecycle.disposed = true;
  observer.fire();
  r.flushFrames();
  expect('#1136: after disposal a pending observer callback never resizes', r.resizes === 2);

  const t = await resizeProbe();
  t.detach();
  t.runPoll();
  expect('#1136: the teardown poll disconnects the observer and removes the map once the container leaves the DOM',
    t.observers[0].disconnected === true && t.lifecycle.resizeObserver === null && t.removed === 1);

  const noRO = await hydrateProbe();
  expect('#1136: without ResizeObserver hydration still constructs the map (window resize alone)',
    noRO.constructed === 1 && noRO.lifecycle.resizeObserver === undefined);
}

expect('#1136: dispose() disconnects the container ResizeObserver before removing the map',
  /if \(mapLifecycle\.resizeObserver\) \{ mapLifecycle\.resizeObserver\.disconnect\(\); mapLifecycle\.resizeObserver = null; \}\s*\n\s*if \(mapLifecycle\.mapInstance\) \{/.test(src)
  && /const mapLifecycle = \{ disposed: false, mapInstance: null, teardownId: null, resizeObserver: null \};/.test(src));

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

// ── #1160 — the public places catalog is pinned on the live map ──
const pinSource = src.match(/^function pinPublicPlaces\(mapboxgl, map, lifecycle\) \{[\s\S]*?^\}/m)?.[0];
expect('hydrateRealMap pins the public places right after the map is constructed',
  /lifecycle\.mapInstance = map;\s*\n\s*pinPublicPlaces\(mapboxgl, map, lifecycle\);/.test(src));
expect('map.js reads the catalog through public_places.js',
  /import \{ listPublicPlaces \} from '\.\.\/public_places\.js';/.test(src));
if (pinSource) {
  const CATALOG = [
    { id: 'svo-b', name: 'Аэропорт Шереметьево, терминал B', lng: 37.416908, lat: 55.980107 },
    { id: 'station-kazansky', name: 'Казанский вокзал', lng: 37.656435, lat: 55.77353 },
  ];
  const runPins = async ({ places, disposed = false, swap = false }) => {
    const markers = [];
    class Marker {
      constructor({ element }) { this.element = element; markers.push(this); }
      setLngLat(lngLat) { this.lngLat = lngLat; return this; }
      addTo(target) { this.map = target; return this; }
    }
    const el = () => ({ dataset: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
    const pin = runInNewContext(`${pinSource}\npinPublicPlaces;`, {
      listPublicPlaces: places, document: { createElement: el },
    });
    const map = { id: 'map' };
    const lifecycle = { disposed, mapInstance: map };
    pin({ Marker }, map, lifecycle);
    if (swap) lifecycle.mapInstance = { id: 'other' };
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    return { markers, map };
  };
  const live = await runPins({ places: () => Promise.resolve(CATALOG) });
  expect('every catalog place gets one marker at its pickup point, on this map',
    live.markers.length === 2
    && live.markers[0].lngLat[0] === 37.416908 && live.markers[0].lngLat[1] === 55.980107
    && live.markers.every((m) => m.map === live.map));
  expect('a marker is labelled by the place name and carries its id',
    live.markers[1].element.attrs['aria-label'] === 'Казанский вокзал'
    && live.markers[1].element.title === 'Казанский вокзал'
    && live.markers[1].element.dataset.placeId === 'station-kazansky'
    && live.markers[1].element.className === 'map-place-marker');
  expect('a disposed screen or a replaced map gets no markers',
    (await runPins({ places: () => Promise.resolve(CATALOG), disposed: true })).markers.length === 0
    && (await runPins({ places: () => Promise.resolve(CATALOG), swap: true })).markers.length === 0);
  expect('a failed catalog read leaves the map without pins (no throw)',
    (await runPins({ places: () => Promise.reject(new Error('down')) })).markers.length === 0);
} else {
  expect('pinPublicPlaces is defined in map.js', false);
}

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
