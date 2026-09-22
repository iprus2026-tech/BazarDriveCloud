// /server/test/route-computation-domain.test.mjs — hermetic (no DATABASE_URL gate),
// table-driven-where-useful unit coverage for domain/route-computation.js.
// BD-MAPBOX-ROUTE-COMPUTATION-CONTRACT-01E. Pure Node; no network, no DB, no fixtures
// directory — every fixture below is a minimized inline synthetic object built only from
// the fields the contract actually reads (never a copied live Mapbox payload).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStops,
  assessGeocode,
  routableCoordinate,
  normalizeDirections,
  ROUTE_COMPUTATION_STATUS,
  LEG_ROLES,
  COORDINATE_PROVENANCE,
  GEOCODE_RESOLUTIONS,
} from '../src/domain/route-computation.js';

const COMPUTED_AT = '2026-09-22T12:00:00.000Z';
const DRIVER = { lat: 55.751, lng: 37.618 };
const PICKUP = { lat: 55.76, lng: 37.62 };
const DESTINATION = { lat: 55.77, lng: 37.63 };

function makeRawOk({ route = {}, waypoints = null } = {}) {
  return {
    code: 'Ok',
    routes: [
      {
        distance: 5200,
        duration: 640,
        duration_typical: 700,
        legs: [
          { distance: 2200, duration: 300, duration_typical: 320 },
          { distance: 3000, duration: 340, duration_typical: 380 },
        ],
        ...route,
      },
    ],
    waypoints:
      waypoints || [
        { location: [37.618, 55.751], distance: 3 },
        { location: [37.62, 55.76], distance: 5 },
        { location: [37.63, 55.77], distance: 2 },
      ],
  };
}

function baseInput(overrides = {}) {
  return {
    raw: makeRawOk(),
    computedAt: COMPUTED_AT,
    profile: 'driving',
    requestedStops: [DRIVER, PICKUP, DESTINATION],
    ...overrides,
  };
}

// ── buildStops ───────────────────────────────────────────────────────────────
test('buildStops always orders driver -> pickup -> destination', () => {
  const result = buildStops({ driver: 'D', pickup: 'P', destination: 'X' });
  assert.deepEqual(result.stops.map((s) => s.role), ['driver', 'pickup', 'destination']);
  assert.deepEqual(result.stops.map((s) => s.point), ['D', 'P', 'X']);
});

test('object key order and an extra UI-array-like hint cannot redefine the semantic order', () => {
  // destination listed first, driver last in the source object, plus a spurious `order`
  // array — buildStops only ever reads the three named roles.
  const result = buildStops({ destination: 'X', pickup: 'P', driver: 'D', order: ['X', 'P', 'D'] });
  assert.deepEqual(result.stops.map((s) => s.role), ['driver', 'pickup', 'destination']);
  assert.deepEqual(result.stops.map((s) => s.point), ['D', 'P', 'X']);
});

test('buildStops does not mutate its input object', () => {
  const input = { driver: 'D', pickup: 'P', destination: 'X' };
  const clone = { ...input };
  buildStops(input);
  assert.deepEqual(input, clone);
});

test('buildStops fails closed (no throw) on a missing input object', () => {
  const result = buildStops();
  assert.deepEqual(result.stops.map((s) => s.role), ['driver', 'pickup', 'destination']);
  assert.deepEqual(result.stops.map((s) => s.point), [null, null, null]);
});

// ── assessGeocode ────────────────────────────────────────────────────────────
test('assessGeocode: confirmed when caller marks known/confirmed AND a coordinate is present', () => {
  assert.equal(assessGeocode({ coordinate: DRIVER, confirmed: true }).resolution, GEOCODE_RESOLUTIONS.CONFIRMED);
});

test('assessGeocode: candidate when a coordinate is present but not confirmed', () => {
  assert.equal(assessGeocode({ coordinate: DRIVER }).resolution, GEOCODE_RESOLUTIONS.CANDIDATE);
});

test('assessGeocode: area when only a bbox is present, no coordinate', () => {
  const result = assessGeocode({ bbox: [37.6, 55.7, 37.7, 55.8] });
  assert.equal(result.resolution, GEOCODE_RESOLUTIONS.AREA);
  assert.equal(result.coordinate, null);
});

test('assessGeocode: unresolved when neither coordinate nor bbox is present', () => {
  assert.equal(assessGeocode({ featureType: 'locality' }).resolution, GEOCODE_RESOLUTIONS.UNRESOLVED);
});

test('assessGeocode does not invent a snap-distance threshold — accuracy is passed through untouched', () => {
  const result = assessGeocode({ coordinate: DRIVER, accuracy: 'rooftop' });
  assert.equal(result.accuracy, 'rooftop');
});

test('assessGeocode reports routable-point presence without selecting one', () => {
  const result = assessGeocode({ coordinate: DRIVER, routablePoints: ['A', 'B'] });
  assert.equal(result.hasRoutablePoints, true);
  assert.equal(result.routablePointCount, 2);
});

// Regression guard (BD-MAPBOX-ROUTE-COMPUTATION-CONTRACT-01E-R2): `confirmed` must be
// combined with a present coordinate, never treated as sufficient on its own.
test('assessGeocode: confirmed:true alone, with NO coordinate, must NOT classify as confirmed', () => {
  const result = assessGeocode({ confirmed: true });
  assert.deepEqual(result, {
    resolution: GEOCODE_RESOLUTIONS.UNRESOLVED,
    featureType: null,
    coordinate: null,
    accuracy: null,
    bbox: null,
    hasRoutablePoints: false,
    routablePointCount: 0,
  });
});

test('assessGeocode: confirmed:true with a bbox but NO coordinate classifies as area, not confirmed', () => {
  const result = assessGeocode({ confirmed: true, bbox: [37.6, 55.7, 37.7, 55.8] });
  assert.equal(result.resolution, GEOCODE_RESOLUTIONS.AREA);
});

// ── routableCoordinate ───────────────────────────────────────────────────────
test('routableCoordinate preserves explicit provenance for each supported source', () => {
  assert.equal(routableCoordinate({ routablePoints: ['R'] }).provenance, COORDINATE_PROVENANCE.PROVIDER_ROUTABLE_POINT);
  assert.equal(routableCoordinate({ geocodePoint: 'G' }).provenance, COORDINATE_PROVENANCE.GEOCODE_POINT);
  assert.equal(routableCoordinate({ userPin: 'U' }).provenance, COORDINATE_PROVENANCE.USER_PIN);
  assert.equal(routableCoordinate({ deviceFix: 'F' }).provenance, COORDINATE_PROVENANCE.DEVICE_FIX);
});

test('routableCoordinate returns unresolved with no provenance when nothing is supplied', () => {
  const result = routableCoordinate({});
  assert.equal(result.resolved, false);
  assert.equal(result.provenance, null);
  assert.equal(result.reason, 'no_candidate');
});

test('multiple provider routable points are NOT silently collapsed to a single selection', () => {
  const result = routableCoordinate({ routablePoints: ['A', 'B', 'C'] });
  assert.equal(result.resolved, false);
  assert.equal(result.reason, 'multiple_routable_points');
  assert.equal(result.point, null);
  assert.equal(result.candidates.length, 3);
  assert.deepEqual(
    result.candidates.map((c) => c.provenance),
    [
      COORDINATE_PROVENANCE.PROVIDER_ROUTABLE_POINT,
      COORDINATE_PROVENANCE.PROVIDER_ROUTABLE_POINT,
      COORDINATE_PROVENANCE.PROVIDER_ROUTABLE_POINT,
    ],
  );
});

// ── normalizeDirections — happy path shape ──────────────────────────────────
test('three requested stops normalize to exactly two legs', () => {
  const result = normalizeDirections(baseInput());
  assert.equal(result.status, ROUTE_COMPUTATION_STATUS.OK);
  assert.equal(result.legs.length, 2);
});

test('leg roles are to_pickup then trip, matching the frozen LEG_ROLES vocabulary', () => {
  const result = normalizeDirections(baseInput());
  assert.deepEqual(result.legs.map((l) => l.role), ['to_pickup', 'trip']);
  assert.deepEqual(LEG_ROLES, ['to_pickup', 'trip']);
});

test('total distance/duration are normalized from the first route', () => {
  const result = normalizeDirections(baseInput());
  assert.deepEqual(result.total, { distanceM: 5200, durationS: 640, durationTypicalS: 700 });
});

test('duration_typical present on each leg is normalized to durationTypicalS', () => {
  const result = normalizeDirections(baseInput());
  assert.equal(result.legs[0].durationTypicalS, 320);
  assert.equal(result.legs[1].durationTypicalS, 380);
});

test('duration_typical missing on the route and on a leg normalizes to null, not 0 or undefined', () => {
  const raw = makeRawOk();
  delete raw.routes[0].duration_typical;
  delete raw.routes[0].legs[0].duration_typical;
  const result = normalizeDirections(baseInput({ raw }));
  assert.equal(result.status, ROUTE_COMPUTATION_STATUS.OK);
  assert.equal(result.total.durationTypicalS, null);
  assert.equal(result.legs[0].durationTypicalS, null);
  assert.equal(result.legs[1].durationTypicalS, 380);
});

// ── normalizeDirections — caller-input vs provider-response failures ───────
test('a missing raw response is a CALLER input problem: invalid_input', () => {
  const result = normalizeDirections(baseInput({ raw: null }));
  assert.equal(result.status, ROUTE_COMPUTATION_STATUS.INVALID_INPUT);
  assert.equal(result.reason, 'missing_raw_response');
  assert.equal(result.total, null);
});

test('a missing computedAt is a CALLER input problem: invalid_input', () => {
  const result = normalizeDirections(baseInput({ computedAt: null }));
  assert.equal(result.status, ROUTE_COMPUTATION_STATUS.INVALID_INPUT);
  assert.equal(result.reason, 'missing_computed_at');
});

test('a structurally broken PROVIDER result (empty routes array) is unavailable, not invalid_input', () => {
  const raw = makeRawOk();
  raw.routes = [];
  const result = normalizeDirections(baseInput({ raw }));
  assert.equal(result.status, ROUTE_COMPUTATION_STATUS.UNAVAILABLE);
  assert.equal(result.reason, 'missing_route');
});

test('an unrecognized provider code is unavailable', () => {
  const raw = makeRawOk();
  raw.code = 'SomeFutureProviderCode';
  const result = normalizeDirections(baseInput({ raw }));
  assert.equal(result.status, ROUTE_COMPUTATION_STATUS.UNAVAILABLE);
  assert.equal(result.reason, 'unrecognized_provider_code');
});

test('a malformed leg (non-finite duration) is unavailable', () => {
  const raw = makeRawOk({
    route: {
      legs: [
        { distance: 2200, duration: Number.NaN },
        { distance: 3000, duration: 340 },
      ],
    },
  });
  const result = normalizeDirections(baseInput({ raw }));
  assert.equal(result.status, ROUTE_COMPUTATION_STATUS.UNAVAILABLE);
  assert.equal(result.reason, 'malformed_leg');
});

test('a waypoint count mismatched against requestedStops is unavailable', () => {
  const raw = makeRawOk({ waypoints: [{ location: [37.618, 55.751] }] });
  const result = normalizeDirections(baseInput({ raw }));
  assert.equal(result.status, ROUTE_COMPUTATION_STATUS.UNAVAILABLE);
  assert.equal(result.reason, 'unexpected_waypoint_count');
});

// ── normalizeDirections — provider result codes ─────────────────────────────
test('provider code NoRoute normalizes to status no_route, with no fabricated geometry', () => {
  const raw = makeRawOk();
  raw.code = 'NoRoute';
  const result = normalizeDirections(baseInput({ raw }));
  assert.equal(result.status, ROUTE_COMPUTATION_STATUS.NO_ROUTE);
  assert.equal(result.total, null);
  assert.equal(result.legs, null);
  assert.equal(result.waypoints, null);
  assert.equal(result.advisories, null);
  // computedAt/profile are still the caller-supplied facts, never derived from raw.
  assert.equal(result.computedAt, COMPUTED_AT);
  assert.equal(result.profile, 'driving');
});

test('provider code NoSegment normalizes to status no_segment', () => {
  const raw = makeRawOk();
  raw.code = 'NoSegment';
  const result = normalizeDirections(baseInput({ raw }));
  assert.equal(result.status, ROUTE_COMPUTATION_STATUS.NO_SEGMENT);
});

// ── normalizeDirections — toll advisory ─────────────────────────────────────
test('advisories.hasToll is true only when a toll class is present, with no price computed', () => {
  const raw = makeRawOk({
    route: {
      legs: [
        {
          distance: 2200,
          duration: 300,
          duration_typical: 320,
          steps: [{ intersections: [{ classes: ['toll'] }] }],
        },
        { distance: 3000, duration: 340, duration_typical: 380 },
      ],
    },
  });
  const result = normalizeDirections(baseInput({ raw }));
  assert.equal(result.advisories.hasToll, true);
  assert.equal('tollPrice' in result.advisories, false);
  assert.equal('price' in result.advisories, false);
});

test('advisories.hasToll is false when no toll class is present anywhere', () => {
  const result = normalizeDirections(baseInput());
  assert.equal(result.advisories.hasToll, false);
});

// Regression guard (BD-MAPBOX-ROUTE-COMPUTATION-CONTRACT-01E-R2): Mapbox also signals toll
// presence via intersections[].toll_collection ({type: 'toll_booth' | 'toll_gantry'}),
// independently of the 'toll' class — a route can carry one signal without the other.
test('advisories.hasToll is true when toll_collection signals a toll booth, with no toll class present', () => {
  const raw = makeRawOk({
    route: {
      legs: [
        {
          distance: 2200,
          duration: 300,
          duration_typical: 320,
          steps: [{ intersections: [{ toll_collection: { type: 'toll_booth' } }] }],
        },
        { distance: 3000, duration: 340, duration_typical: 380 },
      ],
    },
  });
  const result = normalizeDirections(baseInput({ raw }));
  assert.equal(result.advisories.hasToll, true);
  assert.equal('tollPrice' in result.advisories, false);
  assert.equal('price' in result.advisories, false);
});

test('advisories.hasToll is true when toll_collection signals a toll gantry, with no toll class present', () => {
  const raw = makeRawOk({
    route: {
      legs: [
        {
          distance: 2200,
          duration: 300,
          duration_typical: 320,
          steps: [{ intersections: [{ toll_collection: { type: 'toll_gantry' } }] }],
        },
        { distance: 3000, duration: 340, duration_typical: 380 },
      ],
    },
  });
  const result = normalizeDirections(baseInput({ raw }));
  assert.equal(result.advisories.hasToll, true);
});

test('advisories.hasToll is false when an intersection is present but carries neither classes nor a recognized toll_collection', () => {
  const raw = makeRawOk({
    route: {
      legs: [
        {
          distance: 2200,
          duration: 300,
          duration_typical: 320,
          steps: [{ intersections: [{ classes: ['motorway'], toll_collection: null }] }],
        },
        { distance: 3000, duration: 340, duration_typical: 380 },
      ],
    },
  });
  const result = normalizeDirections(baseInput({ raw }));
  assert.equal(result.advisories.hasToll, false);
});

test('an unrecognized toll_collection type does not invent a hidden toll policy', () => {
  const raw = makeRawOk({
    route: {
      legs: [
        {
          distance: 2200,
          duration: 300,
          duration_typical: 320,
          steps: [{ intersections: [{ toll_collection: { type: 'some_future_type' } }] }],
        },
        { distance: 3000, duration: 340, duration_typical: 380 },
      ],
    },
  });
  const result = normalizeDirections(baseInput({ raw }));
  assert.equal(result.advisories.hasToll, false);
});

test('a malformed (non-object) toll_collection value fails closed to no toll signal', () => {
  const raw = makeRawOk({
    route: {
      legs: [
        {
          distance: 2200,
          duration: 300,
          duration_typical: 320,
          steps: [{ intersections: [{ toll_collection: 'toll_booth' }] }],
        },
        { distance: 3000, duration: 340, duration_typical: 380 },
      ],
    },
  });
  const result = normalizeDirections(baseInput({ raw }));
  assert.equal(result.advisories.hasToll, false);
});

// ── normalizeDirections — waypoints ─────────────────────────────────────────
test('each waypoint carries both the requested and the snapped coordinate', () => {
  const result = normalizeDirections(baseInput());
  assert.deepEqual(result.waypoints[0].requested, DRIVER);
  assert.deepEqual(result.waypoints[0].snapped, { lat: 55.751, lng: 37.618 });
  assert.deepEqual(result.waypoints[2].requested, DESTINATION);
});

test('waypoint snapDistanceM is null when the provider omits it, and numeric when supplied', () => {
  const raw = makeRawOk({
    waypoints: [
      { location: [37.618, 55.751] },
      { location: [37.62, 55.76], distance: 5 },
      { location: [37.63, 55.77], distance: 2 },
    ],
  });
  const result = normalizeDirections(baseInput({ raw }));
  assert.equal(result.waypoints[0].snapDistanceM, null);
  assert.equal(result.waypoints[1].snapDistanceM, 5);
});

// ── normalizeDirections — purity / no mutation ──────────────────────────────
test('normalizeDirections never reads a clock: computedAt is echoed back exactly as supplied', () => {
  const result = normalizeDirections(baseInput({ computedAt: '2020-01-01T00:00:00.000Z' }));
  assert.equal(result.computedAt, '2020-01-01T00:00:00.000Z');
});

test('normalizeDirections does not mutate the raw response or requestedStops it is given', () => {
  const raw = makeRawOk();
  const rawClone = JSON.parse(JSON.stringify(raw));
  const stops = [DRIVER, PICKUP, DESTINATION];
  const stopsClone = JSON.parse(JSON.stringify(stops));
  normalizeDirections({ raw, computedAt: COMPUTED_AT, profile: 'driving', requestedStops: stops });
  assert.deepEqual(raw, rawClone);
  assert.deepEqual(stops, stopsClone);
});
