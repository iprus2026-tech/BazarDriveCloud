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

// BD-MAP-FOUND-05H — text-extract the canonical map status vocabulary
// (Object.keys of trip_status_layer.STATUS_VISUAL) and the full RIDE_STATUS
// vocabulary from ride_state.js, so the smoke derives both from source instead
// of carrying hand-copied mirrors. Single source of truth = STATUS_VISUAL
// (the curated map-relevant subset of RIDE_STATUS).
function statusVisualKeys(src) {
  const body = (String(src).match(/STATUS_VISUAL\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/) || ['', ''])[1];
  const keys = new Set();
  const re = /(?:^|[\s,{])([A-Z][A-Z0-9_]*)\s*:/g;
  let k;
  while ((k = re.exec(body)) !== null) keys.add(k[1]);
  return keys;
}
function rideStatusKeys(src) {
  const body = (String(src).match(/RIDE_STATUS\s*=\s*\{([\s\S]*?)\}/) || ['', ''])[1];
  const keys = new Set();
  const re = /(?:^|[\s,{])([A-Z][A-Z0-9_]*)\s*:/g;
  let k;
  while ((k = re.exec(body)) !== null) keys.add(k[1]);
  return keys;
}

const DRIVER_MARKERS = 'public/src/mapbox/driver_markers.js';
const TRIP_STATUS = 'public/src/mapbox/trip_status_layer.js';
const RIDE_STATE = 'public/src/ride_state.js';
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
  {
    rel: 'public/src/mapbox/foundation_utils.js',
    exports: ['isPlainObject', 'safeArray'],
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

// BD-MAP-FOUND-05H — derive the map vocabulary and the full RIDE_STATUS list
// from source once, then reuse them everywhere (eliminates 3 hand-copied
// mirrors: smoke RIDE_STATUSES, smoke EXPECTED_MAP_STATUS_VOCABULARY, and the
// implicit copy inside the design-registry cross-check below).
const MAP_STATUS_VOCABULARY = existsRel(TRIP_STATUS)
  ? Array.from(statusVisualKeys(readRel(TRIP_STATUS)))
  : [];
const ALL_RIDE_STATUSES = existsRel(RIDE_STATE)
  ? Array.from(rideStatusKeys(readRel(RIDE_STATE)))
  : [];
expect('MAP_STATUS_VOCABULARY derived non-empty from STATUS_VISUAL',
  MAP_STATUS_VOCABULARY.length > 0,
  String(MAP_STATUS_VOCABULARY.length));
expect('MAP_STATUS_VOCABULARY includes ACCEPTED',
  MAP_STATUS_VOCABULARY.includes('ACCEPTED'));
expect('MAP_STATUS_VOCABULARY is a subset of ride_state.RIDE_STATUS keys',
  MAP_STATUS_VOCABULARY.every((k) => ALL_RIDE_STATUSES.includes(k)),
  MAP_STATUS_VOCABULARY.filter((k) => !ALL_RIDE_STATUSES.includes(k)).join(','));

// Trip status layer must cover every active RIDE_STATUS value from ride_state.js.
const RIDE_STATUSES = MAP_STATUS_VOCABULARY;
if (existsRel(TRIP_STATUS)) {
  const tripSrc = readRel(TRIP_STATUS);
  for (const status of RIDE_STATUSES) {
    expect(`trip_status_layer.js handles ${status}`, tripSrc.includes(status), status);
  }
  expect('trip_status_layer.js normalizes status input', tripSrc.includes('toUpperCase()'));
  expect('trip_status_layer.js maps ACCEPTED to accepted modifier', tripSrc.includes("modifier: 'accepted'"));
  expect('trip_status_layer.js preserves UNKNOWN fallback', tripSrc.includes('DEFAULT_VISUAL'));

  // BD-MAP-FOUND-05G — trip_status_layer must import shared isPlainObject from
  // ./foundation_utils.js instead of defining it privately (issue #389 item 4).
  expect('trip_status_layer.js imports isPlainObject from foundation_utils',
    /import\s*\{[^}]*\bisPlainObject\b[^}]*\}\s*from\s*['"]\.\/foundation_utils\.js['"]/.test(tripSrc));
  expect('trip_status_layer.js no longer defines local isPlainObject',
    !/function\s+isPlainObject\s*\(/.test(tripSrc));
}

// BD-MAP-FOUND-05B — placeholder markers 4+ (data-index >= 3) must land on a
// stable off-center anchor, never the center (50%/50%) fallback. driver_markers
// wraps the marker index modulo the anchor count, and the CSS defines an
// off-center rule for every anchor 0..ANCHOR_COUNT-1; together that proves no
// marker (incl. 12+) can stack on the center, since e.g. 12 % 12 = 0.
const ANCHOR_COUNT = 12;

// Driver marker summary must count the canonical current order price fields.
if (existsRel(DRIVER_MARKERS)) {
  const markerSrc = readRel(DRIVER_MARKERS);
  for (const field of ['estimatedPrice', 'estimatedPriceLabel', 'offerPrice', 'price']) {
    expect(`driver_markers.js counts ${field} as a price field`, markerSrc.includes(field));
  }
  // BD-MAP-FOUND-05D — hasPrice must reject NaN / Infinity / blank and their
  // string twins ("NaN" / "Infinity" / "-Infinity", case-insensitive) so
  // withPrice in getDriverMarkerSummary is not inflated. Guard the positive
  // contract (hasPriceValue + Number.isFinite + trim + lowercased literal
  // rejections) and lock the door against a regression to the old loose
  // `order[field] != null` shape.
  expect('driver_markers.js defines hasPriceValue helper',
    /function\s+hasPriceValue\s*\(/.test(markerSrc));
  expect('driver_markers.js hasPrice delegates to hasPriceValue',
    /PRICE_FIELDS\.some\s*\(\s*\([^)]*\)\s*=>\s*hasPriceValue\s*\(/.test(markerSrc));
  expect('driver_markers.js price check rejects NaN via Number.isFinite',
    markerSrc.includes('Number.isFinite('));
  expect('driver_markers.js price check trims string labels',
    /\.trim\s*\(\s*\)/.test(markerSrc));
  expect('driver_markers.js price check lowercases string labels',
    markerSrc.includes('.toLowerCase('));
  expect('driver_markers.js price check rejects "NaN" string',
    /!==\s*'nan'/.test(markerSrc));
  expect('driver_markers.js price check rejects "Infinity" string',
    /!==\s*'infinity'/.test(markerSrc));
  expect('driver_markers.js price check rejects "-Infinity" string',
    /!==\s*'-infinity'/.test(markerSrc));
  expect('driver_markers.js no longer uses loose != null price check',
    !/order\[field\]\s*!=\s*null/.test(markerSrc));

  // BD-MAP-FOUND-05E — hasCoords must reject NaN / Infinity coordinates so
  // withCoords in getDriverMarkerSummary is not inflated. The bare Number.isFinite
  // substring is already asserted by the 05D price guard, so 05E proves the
  // delegation from hasCoords to hasCoordinateValue and the removal of the old
  // typeof-only lng/lat checks (which let NaN through, since typeof NaN === 'number').
  expect('driver_markers.js defines hasCoordinateValue helper',
    /function\s+hasCoordinateValue\s*\(/.test(markerSrc));
  expect('driver_markers.js hasCoords delegates lng to hasCoordinateValue',
    /hasCoordinateValue\s*\(\s*order\.pickup\.lng\s*\)/.test(markerSrc));
  expect('driver_markers.js hasCoords delegates lat to hasCoordinateValue',
    /hasCoordinateValue\s*\(\s*order\.pickup\.lat\s*\)/.test(markerSrc));
  expect('driver_markers.js no longer uses typeof-only lng coordinate check',
    !/typeof\s+order\.pickup\.lng\s*===?\s*'number'/.test(markerSrc));
  expect('driver_markers.js no longer uses typeof-only lat coordinate check',
    !/typeof\s+order\.pickup\.lat\s*===?\s*'number'/.test(markerSrc));

  // BD-MAP-FOUND-05G — driver_markers must import shared isPlainObject + safeArray
  // from ./foundation_utils.js instead of defining them privately. Lock the door
  // against re-duplication of the foundation primitives (issue #389 item 4).
  expect('driver_markers.js imports isPlainObject from foundation_utils',
    /import\s*\{[^}]*\bisPlainObject\b[^}]*\}\s*from\s*['"]\.\/foundation_utils\.js['"]/.test(markerSrc));
  expect('driver_markers.js imports safeArray from foundation_utils',
    /import\s*\{[^}]*\bsafeArray\b[^}]*\}\s*from\s*['"]\.\/foundation_utils\.js['"]/.test(markerSrc));
  expect('driver_markers.js no longer defines local isPlainObject',
    !/function\s+isPlainObject\s*\(/.test(markerSrc));
  expect('driver_markers.js no longer defines local safeArray',
    !/function\s+safeArray\s*\(/.test(markerSrc));

  // BD-MAP-FOUND-05B — the marker index must be wrapped modulo the anchor count
  // so the 4th+ marker (and any 12+ overflow) maps onto a defined off-center
  // anchor rather than falling through to the center fallback.
  expect('driver_markers.js wraps marker index modulo anchor count',
    /index\s*%\s*\d+/.test(markerSrc) || /index\s*%\s*MARKER_ANCHOR_COUNT/.test(markerSrc));
  const jsAnchorCount = markerSrc.match(/MARKER_ANCHOR_COUNT\s*=\s*(\d+)/);
  expect('driver_markers.js anchor count matches CSS anchors',
    !!jsAnchorCount && Number(jsAnchorCount[1]) === ANCHOR_COUNT,
    jsAnchorCount ? jsAnchorCount[1] : 'none');

  // BD-MAP-FOUND-05C — renderDriverMarkers must batch DOM appends through a
  // DocumentFragment so N markers cost one live appendChild on the map shell,
  // not N. A bare `createDocumentFragment` substring check could be satisfied
  // by an unrelated helper added later, so scope the assertions to the body of
  // renderDriverMarkers (and the body of its list.forEach callback) via a
  // naive brace counter. Naive is enough because renderDriverMarkers has no
  // strings/regex/template literals containing `{` or `}`.
  const sliceBracedBody = (src, openIdx) => {
    let depth = 1;
    let i = openIdx + 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      i += 1;
    }
    return depth === 0 ? src.slice(openIdx + 1, i - 1) : '';
  };
  const extractBody = (src, headerRe) => {
    const m = src.match(headerRe);
    if (!m || m[0].slice(-1) !== '{') return '';
    return sliceBracedBody(src, m.index + m[0].length - 1);
  };

  const renderBody = extractBody(markerSrc,
    /export\s+function\s+renderDriverMarkers\s*\([^)]*\)\s*\{/);
  expect('renderDriverMarkers body is extractable from driver_markers.js',
    renderBody.length > 0);

  expect('renderDriverMarkers creates a DocumentFragment',
    /document\.createDocumentFragment\s*\(/.test(renderBody));

  const forEachBody = extractBody(renderBody,
    /list\.forEach\s*\(\s*\([^)]*\)\s*=>\s*\{/);
  expect('renderDriverMarkers list.forEach callback body is extractable',
    forEachBody.length > 0);

  expect('renderDriverMarkers appends each marker to the fragment inside the forEach loop',
    /\bfragment\.appendChild\s*\(/.test(forEachBody));
  expect('renderDriverMarkers does not append markers to mapShell inside the forEach loop',
    !/mapShell\.appendChild\s*\(/.test(forEachBody));

  const forEachStart = renderBody.indexOf('list.forEach');
  const flushMatch = renderBody.match(/mapShell\.appendChild\s*\(\s*fragment\b/);
  expect('renderDriverMarkers flushes the fragment to mapShell after the forEach loop',
    !!flushMatch && forEachStart >= 0 && flushMatch.index > forEachStart);
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

  // BD-MAP-FOUND-05B — every anchor 0..ANCHOR_COUNT-1 must have an off-center
  // position (percentage left/top, neither exactly 50%) so wrapped markers never
  // land on the center fallback.
  const cssRule = (i) => (markerCss.match(
    new RegExp('\\[data-index="' + i + '"\\]\\s*\\{([^}]*)\\}')) || ['', ''])[1];
  const offCenter = (r) => /left:\s*\d+%/.test(r) && /top:\s*\d+%/.test(r)
    && !/left:\s*50%/.test(r) && !/top:\s*50%/.test(r);
  for (let i = 0; i < ANCHOR_COUNT; i += 1) {
    expect(`order marker CSS anchor ${i} is off-center`, offCenter(cssRule(i)), cssRule(i).trim());
  }
  // 1–3 existing markers must not regress — anchors 0/1/2 keep their positions.
  expect('order marker CSS keeps anchor 0 at 28%/36%',
    /left:\s*28%/.test(cssRule(0)) && /top:\s*36%/.test(cssRule(0)));
  expect('order marker CSS keeps anchor 1 at 58%/42%',
    /left:\s*58%/.test(cssRule(1)) && /top:\s*42%/.test(cssRule(1)));
  expect('order marker CSS keeps anchor 2 at 44%/64%',
    /left:\s*44%/.test(cssRule(2)) && /top:\s*64%/.test(cssRule(2)));
}

// Runtime HTML should load the marker CSS explicitly so the class is not invisible.
const indexHtml = readRel('public/index.html');
expect('index.html loads map_shell_foundation.css', indexHtml.includes('./styles/map_shell_foundation.css'));

// Service worker: both files and marker CSS precached, VERSION bumped, sw.js not self-cached.
const sw = readRel('public/sw.js');
expect('sw.js precaches map_shell_foundation.css', sw.includes('./styles/map_shell_foundation.css'));
expect('sw.js precaches driver_markers.js', sw.includes('./src/mapbox/driver_markers.js'));
expect('sw.js precaches trip_status_layer.js', sw.includes('./src/mapbox/trip_status_layer.js'));
expect('sw.js precaches foundation_utils.js', sw.includes('./src/mapbox/foundation_utils.js'));
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

  // BD-MAP-FOUND-05A — cross-validate every foundationModules entry against the real
  // module contract, not just its id. file → expected exports comes from the MODULES
  // table above, whose exports are already proven ⊆ source by the `export function`
  // regex loop, so registry === MODULES ⇒ registry exports ⊆ source.
  const EXPECTED_EXPORTS = new Map(MODULES.map((m) => [m.rel, m.exports]));
  // Reject duplicate registry exports and catch missing ones: a duplicate that masks a
  // dropped required export must NOT pass (review BD-MAP-FOUND-05A #1).
  const sameExports = (registryExports, expected) => {
    if (!Array.isArray(registryExports) || !Array.isArray(expected)) return false;
    if (new Set(registryExports).size !== registryExports.length) return false; // no duplicates
    if (registryExports.length !== expected.length) return false;
    const want = new Set(expected);
    return registryExports.every((x) => want.has(x));
  };
  // Statuses must be REAL STATUS_VISUAL keys, not any token present in the source
  // (DEFAULT_VISUAL / normalizeStatus / 'UNKNOWN' are not statuses) — review #2.
  // BD-MAP-FOUND-05H — statusVisualKeys promoted to module scope; both checks
  // below reuse the same derived MAP_STATUS_VOCABULARY as the trip-status guard
  // above (single source = STATUS_VISUAL keys, no hand-copied mirror).
  const EXPECTED_MAP_STATUS_VOCABULARY = MAP_STATUS_VOCABULARY;
  const foundationEntries = Array.isArray(registry.foundationModules) ? registry.foundationModules : [];
  for (const entry of foundationEntries) {
    const eid = (entry && entry.id) || '(no id)';
    const file = entry && entry.file ? String(entry.file) : '';
    expect(`design-registry.json ${eid} declares file`, !!file);
    expect(`design-registry.json ${eid} file exists`, !!file && existsRel(file), file);

    const expected = EXPECTED_EXPORTS.get(file);
    expect(`design-registry.json ${eid} exports is non-empty array`,
      Array.isArray(entry && entry.exports) && entry.exports.length > 0);
    expect(`design-registry.json ${eid} exports match known module contract (no dups, none missing)`,
      !!expected && sameExports(entry && entry.exports, expected),
      JSON.stringify(entry && entry.exports) + ' vs ' + JSON.stringify(expected || null));

    // statusVocabulary is optional (BD-MAP-FOUND-03 has none); when present every value
    // must be a real STATUS_VISUAL key in the entry's own source, and the list must
    // cover the full expected active map vocabulary.
    if (entry && Array.isArray(entry.statusVocabulary)) {
      const entrySrc = file && existsRel(file) ? readRel(file) : '';
      const visualKeys = statusVisualKeys(entrySrc);
      for (const status of entry.statusVocabulary) {
        expect(`design-registry.json ${eid} statusVocabulary ${status} is a STATUS_VISUAL key`,
          visualKeys.has(status), status);
      }
      for (const expectedStatus of EXPECTED_MAP_STATUS_VOCABULARY) {
        expect(`design-registry.json ${eid} statusVocabulary lists ${expectedStatus}`,
          entry.statusVocabulary.includes(expectedStatus), expectedStatus);
      }
    }
  }
}

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
