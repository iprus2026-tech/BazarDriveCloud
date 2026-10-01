// BD-MAP-DUAL-EXPERIENCE-02 — behavioral geo contract and carrier regressions.
// No DOM, GPS, network, real storage or implicit wall clock in eligibility tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  COORDINATE_PROVENANCE, normalizeCoordinateProvenance, isBoundedGeoPoint,
  readGeoPoint, isFreshDeviceFix, isTrustedLiveGeoPoint, isLiveVehiclePoint,
} from '../public/src/geo_point.js';
import {
  deriveMockCoordsFromLabel, resolvePointCoords, enrichOrderPointWithCoords,
} from '../public/src/passenger_order_utils.js';
import { getDriverMarkerSummary } from '../public/src/mapbox/driver_markers.js';
import { COORDINATE_PROVENANCE as SERVER_PROVENANCE } from '../server/src/domain/route-computation.js';
import { serializeOrder } from '../server/src/serialize.js';

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
const { createRideOrder, getOrderById } = await import('../public/src/mock_api.js');
const { seedActiveRideFromAcceptedOrder } = await import('../public/src/ride_actions.js');
const { buildPassengerRideSeed } = await import('../public/src/ride_seed.js');

let passed = 0;
const failures = [];
async function test(name, check) {
  try { await check(); passed++; console.log(`PASS — ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL — ${name}: ${error.stack}`); }
}
const clone = (value) => JSON.parse(JSON.stringify(value));
const now = 1800000000000;
const options = { now, freshnessBudgetMs: 30000 }; // Test-only consumer budget.
const fix = { lng: 37.6, lat: 55.7, provenance: 'device_fix', capturedAt: now - 1000, accuracyMeters: 8 };

await test('one origin vocabulary matches the server real-origin values', () => {
  for (const [key, value] of Object.entries(SERVER_PROVENANCE)) {
    assert.equal(COORDINATE_PROVENANCE[key], value);
  }
  assert.deepEqual(Object.values(COORDINATE_PROVENANCE).sort(), [
    ...Object.values(SERVER_PROVENANCE), 'mock_hash', 'simulation', 'unknown',
  ].sort());
  assert.equal(Object.isFrozen(COORDINATE_PROVENANCE), true);
});

await test('WGS84 inclusive boundaries and zero are valid without mutation', () => {
  for (const lng of [-180, 0, 180]) for (const lat of [-90, 0, 90]) {
    const point = Object.freeze({ lng, lat });
    assert.equal(isBoundedGeoPoint(point), true);
    assert.deepEqual(readGeoPoint(point), { lng, lat, provenance: 'unknown' });
  }
});

await test('out-of-bounds and malformed coordinates fail before any coercion or repair', () => {
  const invalid = [null, undefined, [], [37, 55], {},
    { lng: 180.00001, lat: 0 }, { lng: -180.00001, lat: 0 },
    { lng: 0, lat: 90.00001 }, { lng: 0, lat: -90.00001 }];
  for (const value of [NaN, Infinity, -Infinity, '0', '', null, undefined, false, {}, []]) {
    invalid.push({ lng: value, lat: 0 }, { lng: 0, lat: value });
  }
  for (const point of invalid) {
    assert.equal(isBoundedGeoPoint(point), false);
    assert.equal(readGeoPoint(point), null);
    assert.equal(isTrustedLiveGeoPoint(point, options), false);
    assert.equal(isLiveVehiclePoint(point, options), false);
  }
});

await test('missing, transport and unrecognized provenance never gain trust', () => {
  for (const provenance of [undefined, null, '', 'backend', 'DEVICE_FIX', 'current', 'toString', {}]) {
    assert.equal(normalizeCoordinateProvenance(provenance), 'unknown');
    const point = { ...fix, provenance };
    assert.equal(readGeoPoint(point).provenance, 'unknown');
    assert.equal(isTrustedLiveGeoPoint(point, options), false);
  }
  for (const provenance of Object.values(COORDINATE_PROVENANCE)) {
    assert.equal(normalizeCoordinateProvenance(provenance), provenance);
  }
});

await test('mock, simulation and legacy coordinates are never live even with fresh metadata', () => {
  for (const provenance of ['mock_hash', 'simulation', 'unknown']) {
    const point = { ...fix, provenance };
    assert.equal(readGeoPoint(point).provenance, provenance);
    assert.equal(isTrustedLiveGeoPoint(point, options), false);
    assert.equal(isLiveVehiclePoint(point, options), false);
  }
});

await test('non-sensor trusted waypoints need no sensor timestamp or freshness budget', () => {
  for (const provenance of ['user_pin', 'geocode_point', 'provider_routable_point']) {
    const point = { lng: 37, lat: 55, provenance };
    assert.equal(isTrustedLiveGeoPoint(point), true);
    assert.equal(isTrustedLiveGeoPoint({ ...point, capturedAt: 0 }, options), true);
    assert.equal(isLiveVehiclePoint(point, options), false);
    assert.equal(isFreshDeviceFix(point, options), false);
  }
});

await test('device fixes require actual numeric sensor timestamps', () => {
  for (const capturedAt of [undefined, null, NaN, Infinity, -1, 8640000000000001,
    '', String(now), new Date(now).toISOString(), {}, new Date(now)]) {
    const point = { ...fix, capturedAt, updatedAt: now, receivedAt: now };
    assert.equal(isBoundedGeoPoint(point), true);
    assert.equal(readGeoPoint(point), null);
    assert.equal(isFreshDeviceFix(point, options), false);
    assert.equal(isTrustedLiveGeoPoint(point, options), false);
  }
  assert.equal(isFreshDeviceFix({ ...fix, capturedAt: 0 }, { now: 0, freshnessBudgetMs: 1 }), true);
});

await test('freshness is inclusive at the budget and rejects stale or future fixes', () => {
  for (const [age, eligible] of [[0, true], [1, true], [30000, true], [30001, false], [-1, false]]) {
    const point = { ...fix, capturedAt: now - age };
    assert.equal(isFreshDeviceFix(point, options), eligible);
    assert.equal(isTrustedLiveGeoPoint(point, options), eligible);
    assert.equal(isLiveVehiclePoint(point, options), eligible);
  }
});

await test('freshness has no implicit clock or default/infinite budget', () => {
  for (const freshnessBudgetMs of [undefined, null, 0, -1, NaN, Infinity, '30000']) {
    assert.equal(isTrustedLiveGeoPoint(fix, { now, freshnessBudgetMs }), false);
  }
  for (const clock of [undefined, null, NaN, Infinity, -1, '1800000000000']) {
    assert.equal(isTrustedLiveGeoPoint(fix, { ...options, now: clock }), false);
  }
  for (const omitted of [undefined, null, {}]) assert.equal(isTrustedLiveGeoPoint(fix, omitted), false);
});

await test('updatedAt, transport, adoption and direct flags cannot refresh a stale fix', () => {
  const point = { ...fix, capturedAt: now - 30001, updatedAt: now,
    receivedAt: now, source: 'direct', direct: true, adopted: true };
  assert.equal(isTrustedLiveGeoPoint(point, options), false);
  assert.equal(isLiveVehiclePoint(point, options), false);
  const vehicle = { vehicleId: 'v1', updatedAt: now, point };
  assert.equal(isLiveVehiclePoint(vehicle.point, options), false);
});

await test('accuracy is optional for the shared seam, but malformed metadata is rejected', () => {
  const { accuracyMeters, ...withoutAccuracy } = fix;
  assert.equal(isTrustedLiveGeoPoint(withoutAccuracy, options), true);
  assert.equal(isLiveVehiclePoint(withoutAccuracy, options), true);
  for (const accuracy of [0, 8, 100000]) {
    assert.equal(isTrustedLiveGeoPoint({ ...fix, accuracyMeters: accuracy }, options), true);
  }
  for (const accuracy of [NaN, Infinity, -1, null, '8']) {
    assert.equal(readGeoPoint({ ...fix, accuracyMeters: accuracy }), null);
    assert.equal(isTrustedLiveGeoPoint({ ...fix, accuracyMeters: accuracy }, options), false);
  }
  // The shared seam intentionally does not claim active-navigation accuracy or
  // direct-acquisition capability; those gates belong to later slices 08/09.
});

await test('GeoPoint copies preserve metadata, omit motion/transport and do not mutate input', () => {
  const input = Object.freeze({ ...fix, headingDegrees: 90, speedMps: 10, updatedAt: now });
  assert.deepEqual(readGeoPoint(input), fix);
  assert.notEqual(readGeoPoint(input), input);
  assert.equal(input.headingDegrees, 90);
  assert.deepEqual(readGeoPoint(clone(input)), fix);
});

await test('new label hashes carry mock provenance at creation and survive hydration', () => {
  assert.equal(deriveMockCoordsFromLabel(' '), null);
  const hash = deriveMockCoordsFromLabel('Моё место');
  assert.equal(hash.provenance, 'mock_hash');
  assert.equal(isBoundedGeoPoint(hash), true);
  assert.equal(isTrustedLiveGeoPoint(hash, options), false);
  assert.deepEqual(resolvePointCoords(clone({ coords: hash, source: 'current' })), hash);
  assert.deepEqual(resolvePointCoords({ label: 'Моё место', source: 'current' }), hash);
});

await test('legacy nested and flat coordinates remain unknown regardless of UI source', () => {
  const coords = { lng: 37, lat: 55 };
  for (const source of ['current', 'manual', 'search', 'backend']) {
    const nested = resolvePointCoords({ label: 'Адрес', coords, source });
    const flat = resolvePointCoords({ label: 'Адрес', ...coords, source });
    assert.deepEqual(nested, { ...coords, provenance: 'unknown' });
    assert.deepEqual(flat, nested);
    assert.equal(isTrustedLiveGeoPoint(nested, options), false);
  }
});

await test('invalid existing carriers cannot be repaired by a label hash or coerced to zero', () => {
  for (const coords of [{ lat: 100, lng: 37 }, { lat: 55, lng: 500 },
    { lat: '55', lng: '37' }, { lat: null, lng: null }, { lng: 37 }, [],
    { ...fix, capturedAt: undefined }]) {
    const point = { id: 'p', label: 'Адрес', coords };
    assert.equal(resolvePointCoords(point), null);
    assert.deepEqual(enrichOrderPointWithCoords(point), { id: 'p', label: 'Адрес' });
    if (!Array.isArray(coords)) assert.equal(resolvePointCoords({ label: 'Адрес', ...coords }), null);
  }
});

await test('flat and nested carriers retain the exact origin, capture time and accuracy', () => {
  for (const provenance of Object.values(COORDINATE_PROVENANCE)) {
    const coords = { ...fix, provenance };
    const expected = { id: 'p', label: 'Адрес', ...coords };
    const point = { id: 'p', label: ' Адрес ', coords };
    assert.deepEqual(enrichOrderPointWithCoords(point), expected);
    assert.deepEqual(enrichOrderPointWithCoords(clone(expected)), expected);
    assert.deepEqual(resolvePointCoords(clone(point)), coords);
  }
});

await test('the actual route-picker builders and hydration preserve origin, not UI entry path', () => {
  const source = fs.readFileSync(new URL('../public/src/screens/route_picker.js', import.meta.url), 'utf8');
  const makeBody = source.match(/function makePoint\(id, label, hint, source\) \{([\s\S]*?)\n\}/)?.[1];
  const sanitizeBody = source.match(/function sanitizePoint\(raw\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(makeBody && sanitizeBody);
  const make = new Function('deriveMockCoordsFromLabel', `return function(id, label, hint, source) {${makeBody}}`)(deriveMockCoordsFromLabel);
  const sanitize = new Function('resolvePointCoords', 'isPlainObject', 'ALLOWED_SOURCES',
    `return function(raw) {${sanitizeBody}}`)(resolvePointCoords,
    (value) => value !== null && typeof value === 'object' && !Array.isArray(value), new Set(['current', 'manual']));
  const fresh = make('p', 'Моё место', '', 'current');
  assert.equal(fresh.coords.provenance, 'mock_hash');
  assert.deepEqual(sanitize(clone(fresh)), fresh);
  const legacy = { ...fresh, coords: { lat: 55, lng: 37 } };
  assert.equal(sanitize(clone(legacy)).coords.provenance, 'unknown');
  const device = { ...fresh, coords: fix };
  assert.deepEqual(sanitize(clone(device)).coords, fix);
  const invalid = sanitize({ ...fresh, coords: { lng: 500, lat: 55 } });
  assert.equal(invalid.coords, null);
  assert.equal(sanitize(clone(invalid)).coords, null);
  assert.deepEqual(enrichOrderPointWithCoords(invalid), { id: 'p', label: 'Моё место' });
});

await test('real local order storage and both ride seeders keep coordinate metadata', async () => {
  const pickup = enrichOrderPointWithCoords({ id: 'p', label: 'Подача', coords: fix });
  const dropoff = enrichOrderPointWithCoords({ id: 'd', label: 'Адрес', coords: {
    lng: 38, lat: 56, provenance: 'user_pin',
  } });
  const order = await createRideOrder({ local: true, pickup, dropoff });
  const loaded = await getOrderById(order.id);
  assert.deepEqual(loaded.pickup, pickup);
  assert.deepEqual(loaded.dropoff, dropoff);
  const driver = seedActiveRideFromAcceptedOrder(loaded).ride;
  const passenger = buildPassengerRideSeed(loaded, {}, {});
  for (const ride of [driver, passenger]) {
    assert.deepEqual(ride.route.pickup, pickup);
    assert.deepEqual(ride.route.dropoff, dropoff);
  }
});

await test('server serialization and JSON transport do not relabel an existing point', () => {
  // No server write/DB/provider work: exercise the existing opaque JSON projection.
  for (const provenance of Object.values(COORDINATE_PROVENANCE)) {
    const point = { id: 'p', label: 'Адрес', ...fix, provenance };
    const response = clone(serializeOrder({ id: 'order', pickup: point, dropoff: point }));
    assert.deepEqual(enrichOrderPointWithCoords(response.pickup), point);
    assert.deepEqual(enrichOrderPointWithCoords(response.dropoff), point);
  }
});

await test('marker coordinate summary counts bounded values, not malformed coordinates', () => {
  const pickups = [{ lat: 0, lng: 0 }, { lat: -90, lng: 180 },
    { lat: 100, lng: 37 }, { lat: 55, lng: 500 }, { lat: '55', lng: 37 },
    { lat: NaN, lng: 37 }, { lat: 55, lng: Infinity }, { lat: null, lng: 37 }, null];
  assert.deepEqual(getDriverMarkerSummary(pickups.map((pickup) => ({ pickup }))), {
    total: 9, withCoords: 2, withPrice: 0,
  });
});

await test('shared geo module is available offline with its existing importing carriers', () => {
  const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes("'./src/geo_point.js'"));
  assert.ok(sw.includes("'./src/passenger_order_utils.js'"));
  assert.ok(sw.includes("'./src/mapbox/driver_markers.js'"));
});

console.log(`\nGeo point smoke: ${passed} passed, ${failures.length} failed.`);
if (failures.length) process.exitCode = 1;
