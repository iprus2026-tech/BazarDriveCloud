// /server/src/domain/route-computation.js — pure, network-free, provider-independent
// normalization layer for Mapbox-style Directions responses.
// BD-MAPBOX-ROUTE-COMPUTATION-CONTRACT-01E.
//
// Named RouteComputation, NOT RouteSnapshot: `RouteSnapshot` is already a shipped
// CLIENT-side display contract (public/src/ride_state.js's getActiveRideRouteSnapshot(),
// docs/active-ride-route-snapshot-contract.md, BD-MAPBOX-DATA-02) — 7 display strings
// (tripId/pickupLabel/dropoffLabel/priceLabel/distanceLabel/etaLabel/acceptedAt) rendered
// from mock/localStorage data. This module is a different concept at a different layer: a
// SERVER-side normalization of a raw Directions-style provider response into geometry/
// timing facts. Reusing "RouteSnapshot" for both would collide two unrelated shapes under
// one name — the 01E preflight flagged this explicitly, and the architecture decision
// (01E-R1) is to keep them permanently distinct: RouteComputation here, RouteSnapshot only
// in public/src/ride_state.js.
//
// This module has NO live caller yet. server/src/services/route-price/index.js remains the
// dark 501 NOT_IMPLEMENTED skeleton (darkService, ADR BD-DOCS-041) — wiring this domain
// module into that service is a separate, later slice, not this one. This file is pure
// data-shape normalization only: no I/O, no fetch, no DB, no Mapbox SDK/token access.
//
// Every function fails closed to a structured plain-object result — never throws — for
// ordinary malformed/absent input or provider-result states. The vocabulary this module
// invents is deliberately limited to presence-based structural classification; it does NOT
// invent a geocode snap-distance threshold, a multi-candidate selection policy, a toll-price
// calculation, or any UI copy — those remain open product decisions for a later slice.

// ── buildStops — fixed 3-stop route order ───────────────────────────────────────────────
// The route order (driver -> pickup -> destination) is a property of this function's
// OUTPUT, never derived from caller-supplied ordering, arrays, DOM/marker order, or any
// other presentation-layer signal. Only the three explicit named roles are read from the
// input; any other property on it (an `order` hint, an index, a UI array) is ignored.
export const STOP_ROLES = Object.freeze(['driver', 'pickup', 'destination']);

export function buildStops(input) {
  const src = input || {};
  const { driver = null, pickup = null, destination = null } = src;
  return {
    stops: [
      { role: 'driver', point: driver },
      { role: 'pickup', point: pickup },
      { role: 'destination', point: destination },
    ],
  };
}

// ── assessGeocode — structural classification of already-supplied geocode info ─────────
// Classifies ONLY by presence/shape of caller-supplied fields — feature type, coordinate,
// accuracy, bbox, routable points, and an explicit confirmed/known flag. No snap-distance
// threshold or other geographic policy is invented: `accuracy` is passed through untouched,
// never compared against a threshold this module would otherwise have to invent.
export const GEOCODE_RESOLUTIONS = Object.freeze({
  CONFIRMED: 'confirmed',
  CANDIDATE: 'candidate',
  AREA: 'area',
  UNRESOLVED: 'unresolved',
});

export function assessGeocode(input) {
  const src = input || {};
  const {
    featureType = null,
    coordinate = null,
    accuracy = null,
    bbox = null,
    routablePoints = null,
    confirmed = false,
  } = src;

  const hasCoordinate = coordinate != null;
  const hasBbox = bbox != null;
  const hasRoutablePoints = Array.isArray(routablePoints) && routablePoints.length > 0;

  let resolution;
  if (confirmed === true && hasCoordinate) resolution = GEOCODE_RESOLUTIONS.CONFIRMED;
  else if (hasCoordinate) resolution = GEOCODE_RESOLUTIONS.CANDIDATE;
  else if (hasBbox) resolution = GEOCODE_RESOLUTIONS.AREA;
  else resolution = GEOCODE_RESOLUTIONS.UNRESOLVED;

  return {
    resolution,
    featureType,
    coordinate: hasCoordinate ? coordinate : null,
    accuracy,
    bbox: hasBbox ? bbox : null,
    hasRoutablePoints,
    routablePointCount: hasRoutablePoints ? routablePoints.length : 0,
  };
}

// ── routableCoordinate — explicit-provenance routing coordinate ────────────────────────
// Represents a candidate routing coordinate together with WHERE it came from. When the
// provider supplies more than one routable point, this function does NOT silently pick the
// first one — the candidate set is returned unresolved (`resolved: false`) and a later
// slice must decide the selection policy; nothing here decides it implicitly.
export const COORDINATE_PROVENANCE = Object.freeze({
  PROVIDER_ROUTABLE_POINT: 'provider_routable_point',
  GEOCODE_POINT: 'geocode_point',
  USER_PIN: 'user_pin',
  DEVICE_FIX: 'device_fix',
});

export function routableCoordinate(input) {
  const src = input || {};
  const { routablePoints = null, geocodePoint = null, userPin = null, deviceFix = null } = src;

  if (Array.isArray(routablePoints) && routablePoints.length > 1) {
    return {
      resolved: false,
      reason: 'multiple_routable_points',
      provenance: null,
      point: null,
      candidates: routablePoints.map((point) => ({
        provenance: COORDINATE_PROVENANCE.PROVIDER_ROUTABLE_POINT,
        point,
      })),
    };
  }
  if (Array.isArray(routablePoints) && routablePoints.length === 1) {
    return {
      resolved: true,
      reason: null,
      provenance: COORDINATE_PROVENANCE.PROVIDER_ROUTABLE_POINT,
      point: routablePoints[0],
      candidates: null,
    };
  }
  if (geocodePoint != null) {
    return {
      resolved: true,
      reason: null,
      provenance: COORDINATE_PROVENANCE.GEOCODE_POINT,
      point: geocodePoint,
      candidates: null,
    };
  }
  if (userPin != null) {
    return {
      resolved: true,
      reason: null,
      provenance: COORDINATE_PROVENANCE.USER_PIN,
      point: userPin,
      candidates: null,
    };
  }
  if (deviceFix != null) {
    return {
      resolved: true,
      reason: null,
      provenance: COORDINATE_PROVENANCE.DEVICE_FIX,
      point: deviceFix,
      candidates: null,
    };
  }
  return { resolved: false, reason: 'no_candidate', provenance: null, point: null, candidates: null };
}

// ── normalizeDirections — raw Directions-style response -> RouteComputation ────────────
// Pure, deterministic normalization. `computedAt` and `profile` are ALWAYS supplied by the
// caller — this function never reads a clock (no Date.now()/new Date()), so the same raw
// input always produces the same output. Provider result codes (Ok/NoRoute/NoSegment/...)
// map onto a small machine-readable status vocabulary; anything structurally unparseable on
// the PROVIDER side maps to `unavailable`, while a missing/invalid CALLER input (the raw
// response itself, or computedAt) maps to `invalid_input`.
//
// Input shape: { raw, computedAt, profile, requestedStops }
//   raw            — the provider's Directions-style response object.
//   computedAt     — caller-supplied instant this normalization represents (required).
//   profile        — caller-supplied routing profile (e.g. 'driving'); passed through as-is.
//   requestedStops — the ordered points this route was requested for (e.g. the `.point`
//                    values from buildStops().stops), zipped index-wise against
//                    raw.waypoints to produce each waypoint's `requested` coordinate.
export const ROUTE_COMPUTATION_STATUS = Object.freeze({
  OK: 'ok',
  INVALID_INPUT: 'invalid_input',
  NO_ROUTE: 'no_route',
  NO_SEGMENT: 'no_segment',
  UNAVAILABLE: 'unavailable',
});

// Fixed leg roles for the 3-stop (driver -> pickup -> destination) contract buildStops()
// establishes: exactly 2 legs are expected in a raw route's `legs` array.
export const LEG_ROLES = Object.freeze(['to_pickup', 'trip']);

const PROVIDER_CODE_STATUS = Object.freeze({
  Ok: ROUTE_COMPUTATION_STATUS.OK,
  NoRoute: ROUTE_COMPUTATION_STATUS.NO_ROUTE,
  NoSegment: ROUTE_COMPUTATION_STATUS.NO_SEGMENT,
});

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// Mapbox-style [lng, lat] -> a provider-independent {lat, lng} point. Returns null for any
// malformed coordinate pair instead of throwing.
function toPoint(coord) {
  if (!Array.isArray(coord) || coord.length !== 2) return null;
  const [lng, lat] = coord;
  if (!isFiniteNumber(lng) || !isFiniteNumber(lat)) return null;
  return { lat, lng };
}

// Toll is advisory PRESENCE only — no price is read or computed. Scans the raw route's
// step/intersection annotations for BOTH of Mapbox's documented toll signals: the 'toll'
// class (intersections[].classes) AND a toll collection point (intersections[].toll_collection,
// { type: 'toll_booth' | 'toll_gantry' }) — a route can carry either signal without the
// other (e.g. a single open-road tolling gantry with no edge classified as a toll road).
// Only these two documented signals count as "toll present"; an unrecognized/malformed
// toll_collection value (wrong shape, or a type outside the documented set) is treated as
// "no toll collection observed" rather than invented into a new toll policy. Any missing/
// malformed nesting elsewhere is likewise treated as "no toll observed", never as an error.
const TOLL_COLLECTION_TYPES = Object.freeze(new Set(['toll_booth', 'toll_gantry']));

function hasTollSignal(route) {
  const legs = route && Array.isArray(route.legs) ? route.legs : [];
  for (const leg of legs) {
    const steps = leg && Array.isArray(leg.steps) ? leg.steps : [];
    for (const step of steps) {
      const intersections = step && Array.isArray(step.intersections) ? step.intersections : [];
      for (const intersection of intersections) {
        if (!intersection || typeof intersection !== 'object') continue;
        const classes = Array.isArray(intersection.classes) ? intersection.classes : [];
        if (classes.includes('toll')) return true;
        const tollCollection = intersection.toll_collection;
        if (
          tollCollection &&
          typeof tollCollection === 'object' &&
          TOLL_COLLECTION_TYPES.has(tollCollection.type)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function darkComputation(status, { computedAt = null, profile = null, reason = null } = {}) {
  return {
    status,
    computedAt,
    profile,
    total: null,
    legs: null,
    waypoints: null,
    advisories: null,
    reason,
  };
}

export function normalizeDirections(input) {
  const src = input || {};
  const { raw, computedAt = null, profile = null, requestedStops = null } = src;

  // computedAt is a required CALLER input — this function never invents it.
  if (computedAt == null) {
    return darkComputation(ROUTE_COMPUTATION_STATUS.INVALID_INPUT, {
      profile,
      reason: 'missing_computed_at',
    });
  }
  if (raw == null || typeof raw !== 'object') {
    return darkComputation(ROUTE_COMPUTATION_STATUS.INVALID_INPUT, {
      computedAt,
      profile,
      reason: 'missing_raw_response',
    });
  }

  const code = raw.code;
  if (code != null) {
    const mappedStatus = PROVIDER_CODE_STATUS[code];
    if (!mappedStatus) {
      return darkComputation(ROUTE_COMPUTATION_STATUS.UNAVAILABLE, {
        computedAt,
        profile,
        reason: 'unrecognized_provider_code',
      });
    }
    if (mappedStatus === ROUTE_COMPUTATION_STATUS.NO_ROUTE) {
      return darkComputation(ROUTE_COMPUTATION_STATUS.NO_ROUTE, {
        computedAt,
        profile,
        reason: 'provider_no_route',
      });
    }
    if (mappedStatus === ROUTE_COMPUTATION_STATUS.NO_SEGMENT) {
      return darkComputation(ROUTE_COMPUTATION_STATUS.NO_SEGMENT, {
        computedAt,
        profile,
        reason: 'provider_no_segment',
      });
    }
    // mappedStatus === OK — fall through to routes parsing below.
  }
  // code absent entirely is treated as implicit success, matching providers that only send
  // `code` on failure.

  const routes = Array.isArray(raw.routes) ? raw.routes : null;
  const route = routes && routes.length > 0 ? routes[0] : null;
  if (!route || typeof route !== 'object') {
    return darkComputation(ROUTE_COMPUTATION_STATUS.UNAVAILABLE, {
      computedAt,
      profile,
      reason: 'missing_route',
    });
  }
  if (!isFiniteNumber(route.distance) || !isFiniteNumber(route.duration)) {
    return darkComputation(ROUTE_COMPUTATION_STATUS.UNAVAILABLE, {
      computedAt,
      profile,
      reason: 'missing_total_metrics',
    });
  }

  const legsRaw = Array.isArray(route.legs) ? route.legs : null;
  if (!legsRaw || legsRaw.length !== LEG_ROLES.length) {
    return darkComputation(ROUTE_COMPUTATION_STATUS.UNAVAILABLE, {
      computedAt,
      profile,
      reason: 'unexpected_leg_count',
    });
  }
  for (const leg of legsRaw) {
    if (!leg || typeof leg !== 'object' || !isFiniteNumber(leg.distance) || !isFiniteNumber(leg.duration)) {
      return darkComputation(ROUTE_COMPUTATION_STATUS.UNAVAILABLE, {
        computedAt,
        profile,
        reason: 'malformed_leg',
      });
    }
  }

  const waypointsRaw = Array.isArray(raw.waypoints) ? raw.waypoints : null;
  const stops = Array.isArray(requestedStops) ? requestedStops : null;
  if (!waypointsRaw || !stops || waypointsRaw.length !== stops.length) {
    return darkComputation(ROUTE_COMPUTATION_STATUS.UNAVAILABLE, {
      computedAt,
      profile,
      reason: 'unexpected_waypoint_count',
    });
  }
  const waypoints = [];
  for (let i = 0; i < waypointsRaw.length; i += 1) {
    const wp = waypointsRaw[i];
    const snapped = wp && typeof wp === 'object' ? toPoint(wp.location) : null;
    if (!snapped) {
      return darkComputation(ROUTE_COMPUTATION_STATUS.UNAVAILABLE, {
        computedAt,
        profile,
        reason: 'malformed_waypoint_location',
      });
    }
    waypoints.push({
      requested: stops[i],
      snapped,
      snapDistanceM: isFiniteNumber(wp.distance) ? wp.distance : null,
    });
  }

  const legs = legsRaw.map((leg, index) => ({
    role: LEG_ROLES[index],
    distanceM: leg.distance,
    durationS: leg.duration,
    durationTypicalS: isFiniteNumber(leg.duration_typical) ? leg.duration_typical : null,
  }));

  return {
    status: ROUTE_COMPUTATION_STATUS.OK,
    computedAt,
    profile,
    total: {
      distanceM: route.distance,
      durationS: route.duration,
      durationTypicalS: isFiniteNumber(route.duration_typical) ? route.duration_typical : null,
    },
    legs,
    waypoints,
    advisories: {
      hasToll: hasTollSignal(route),
    },
    reason: null,
  };
}
