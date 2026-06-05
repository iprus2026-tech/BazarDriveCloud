// BD-MAP-FOUND-03 / BD-MAP-FOUND-04 — static regression smoke for the Mapbox
// foundation stubs (driver_markers + trip_status_layer).
//
// Guards that the two foundation modules:
//   • exist on disk;
//   • export the agreed stub contract;
//   • contain no real Mapbox SDK / network / CDN / dynamic-import / inline-CSP
//     escape hatch;
//   • cover every active RIDE_STATUS value (trip status layer);
//   • keep canonical price-field and marker-CSS contracts aligned;
// and that public/sw.js precaches both files + marker CSS with a bumped VERSION
// (and never precaches sw.js itself), and docs/design-registry.json stays valid
// JSON and registers both modules. Static only — no browser, no DOM, no network.

import fs from 'node:fs';

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

function rel(p) {
  return new URL('../' + p, import.meta.url);
}
function readRel(p) {
  return fs.readFileSync(rel(p), 'utf8');
}
function existsRel(p) {
  try { fs.accessSync(rel(p)); return true; } catch { return false; }
}

const DRIVER_MARKERS = 'public/src/mapbox/driver_markers.js';
const TRIP_STATUS = 'public/src/mapbox/trip_status_layer.js';
const MARKER_CSS = 'public/styles/map_shell_foundation.css';

const MODULES = [
  {
    rel: DRIVER_MARKERS,
    exports: [
      'createDriverMarkersLayer',
      'renderDriverMarkers',
      'clearDriverMarkers',
      'getDriverMarkerSummary',
    ],
  },
  {
    rel: TRIP_STATUS,
    exports: [
      'createTripStatusLayer',
      'renderTripStatusLayer',
      'clearTripStatusLayer',
      'getTripStatusVisualState',
    ],
  },
];

// Tokens that would betray a real Mapbox SDK, a network call, a CDN load, a
// dynamic import, or a CSP escape hatch. None may appear in the stub sources.
const FORBIDDEN = [
  'mapboxgl',
  'api.mapbox.com',
  'events.mapbox.com',
  'fetch(',
  'XMLHttpRequest',
  'import(',
  'https://',
  'unsafe-inline',
];

for (const mod of MODULES) {
  expect(`${mod.rel} exists`, existsRel(mod.rel));
  if (!existsRel(mod.rel)) continue;
  const src = readRel(mod.rel);
  for (const name of mod.exports) {
    expect(`${mod.rel} exports ${name}`,
      new RegExp('export\\s+function\\s+' + name + '\\b').test(src));
  }
  for (const bad of FORBIDDEN) {
    expect(`${mod.rel} free of forbidden token`, !src.includes(bad), bad);
  }
}

// Trip status layer must cover every active RIDE_STATUS value from ride_state.js.
const RIDE_STATUSES = [
  'NEW_ORDER',
  'ACCEPTED',
  'DRIVER_EN_ROUTE',
  'DRIVER_APPROACHING_PICKUP',
  'WAITING_PASSENGER',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELED',
  'NO_SHOW',
];
if (existsRel(TRIP_STATUS)) {
  const tripSrc = readRel(TRIP_STATUS);
  for (const status of RIDE_STATUSES) {
    expect(`trip_status_layer.js handles ${status}`, tripSrc.includes(status), status);
  }
  expect('trip_status_layer.js normalizes status input', tripSrc.includes('toUpperCase()'));
  expect('trip_status_layer.js maps ACCEPTED to accepted modifier', tripSrc.includes("modifier: 'accepted'"));
  expect('trip_status_layer.js preserves UNKNOWN fallback', tripSrc.includes('DEFAULT_VISUAL'));
}

// Driver marker summary must count the canonical current order price fields.
if (existsRel(DRIVER_MARKERS)) {
  const markerSrc = readRel(DRIVER_MARKERS);
  for (const field of ['estimatedPrice', 'estimatedPriceLabel', 'offerPrice', 'price']) {
    expect(`driver_markers.js counts ${field} as a price field`, markerSrc.includes(field));
  }
  expect('driver_markers.js ignores empty price values', markerSrc.includes("!== ''"));
}

// Marker CSS must make rendered placeholder order markers visible without inline style.
expect(`${MARKER_CSS} exists`, existsRel(MARKER_CSS));
if (existsRel(MARKER_CSS)) {
  const markerCss = readRel(MARKER_CSS);
  expect('order marker CSS present', markerCss.includes('.bd-map-shell__marker--order'));
  expect('order marker CSS gives width', /width:\s*28px/.test(markerCss));
  expect('order marker CSS gives height', /height:\s*28px/.test(markerCss));
  expect('order marker CSS gives fallback left/top', markerCss.includes('left: 50%') && markerCss.includes('top: 50%'));
  expect('order marker CSS gives indexed positions', markerCss.includes('[data-index="0"]'));
  expect('order marker CSS stays inline-style free', !markerCss.includes('style='));
}

// Runtime HTML should load the marker CSS explicitly so the class is not invisible.
const indexHtml = readRel('public/index.html');
expect('index.html loads map_shell_foundation.css', indexHtml.includes('./styles/map_shell_foundation.css'));

// Service worker: both files and marker CSS precached, VERSION bumped, sw.js not self-cached.
const sw = readRel('public/sw.js');
expect('sw.js precaches map_shell_foundation.css', sw.includes('./styles/map_shell_foundation.css'));
expect('sw.js precaches driver_markers.js', sw.includes('./src/mapbox/driver_markers.js'));
expect('sw.js precaches trip_status_layer.js', sw.includes('./src/mapbox/trip_status_layer.js'));
const versionMatch = sw.match(/const\s+VERSION\s*=\s*'v(\d+)'/);
expect('sw.js VERSION present', !!versionMatch, versionMatch ? versionMatch[0] : 'none');
expect('sw.js VERSION bumped to v87 or later',
  !!versionMatch && Number(versionMatch[1]) >= 87,
  versionMatch ? 'v' + versionMatch[1] : 'n/a');
expect('sw.js does not precache sw.js itself', !/['"`]\.\/sw\.js['"`]/.test(sw));

// Design registry stays valid JSON and registers both foundation modules.
const registryRaw = readRel('docs/design-registry.json');
let registry = null;
try { registry = JSON.parse(registryRaw); } catch { registry = null; }
expect('design-registry.json is valid JSON', registry !== null);
if (registry) {
  const ids = Array.isArray(registry.foundationModules)
    ? registry.foundationModules.map((m) => m && m.id)
    : [];
  expect('design-registry.json registers BD-MAP-FOUND-03', ids.includes('BD-MAP-FOUND-03'));
  expect('design-registry.json registers BD-MAP-FOUND-04', ids.includes('BD-MAP-FOUND-04'));

  // BD-MAP-FOUND-04 statusVocabulary must stay in sync with the trip status
  // layer (STATUS_VISUAL) — ACCEPTED is implemented and must be documented.
  const tripModule = Array.isArray(registry.foundationModules)
    ? registry.foundationModules.find((m) => m && m.id === 'BD-MAP-FOUND-04')
    : null;
  const statusVocabulary = tripModule && Array.isArray(tripModule.statusVocabulary)
    ? tripModule.statusVocabulary
    : [];
  expect('design-registry.json BD-MAP-FOUND-04 statusVocabulary includes ACCEPTED',
    statusVocabulary.includes('ACCEPTED'), JSON.stringify(statusVocabulary));
}

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
