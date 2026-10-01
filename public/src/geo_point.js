// BD-MAP-DUAL-EXPERIENCE-02 — shared, DOM/network/clock-free geo seam.
// GeoPoint uses named WGS84 decimal degrees, never a positional SDK array.
// capturedAt and caller now use numeric Unix epoch milliseconds, matching the
// Geolocation API sensor timestamp. No string coercion or receipt-time repair.
// See docs/map-dual-experience-contract.md §§6–7. This is coordinate eligibility,
// not proof of acquisition, canonical waypoint authority or navigation admission.

export const COORDINATE_PROVENANCE = Object.freeze({
  DEVICE_FIX: 'device_fix',
  USER_PIN: 'user_pin',
  GEOCODE_POINT: 'geocode_point',
  PROVIDER_ROUTABLE_POINT: 'provider_routable_point',
  MOCK_HASH: 'mock_hash',
  SIMULATION: 'simulation',
  UNKNOWN: 'unknown',
});

const KNOWN_PROVENANCE = new Set(Object.values(COORDINATE_PROVENANCE));
const TRUSTED_PROVENANCE = new Set([
  COORDINATE_PROVENANCE.DEVICE_FIX,
  COORDINATE_PROVENANCE.USER_PIN,
  COORDINATE_PROVENANCE.GEOCODE_POINT,
  COORDINATE_PROVENANCE.PROVIDER_ROUTABLE_POINT,
]);

export function normalizeCoordinateProvenance(value) {
  return KNOWN_PROVENANCE.has(value) ? value : COORDINATE_PROVENANCE.UNKNOWN;
}

// Coordinate validity only. This does not grant live eligibility to a point or
// authority to provider geometry. Never clamp, wrap, swap or coerce values.
export function isBoundedGeoPoint(point) {
  return point !== null && typeof point === 'object' && !Array.isArray(point)
    && Number.isFinite(point.lng) && point.lng >= -180 && point.lng <= 180
    && Number.isFinite(point.lat) && point.lat >= -90 && point.lat <= 90;
}

function isEpochMilliseconds(value) {
  // Non-negative sensor times within the representable JavaScript Date range.
  return Number.isFinite(value) && value >= 0 && value <= 8640000000000000;
}

// Copy a coordinate carrier without changing its origin or inventing metadata.
// Legacy/malformed provenance becomes unknown; an invalid device fix is rejected,
// never downgraded to another origin. Motion belongs to VehiclePosition, not here.
export function readGeoPoint(raw) {
  if (!isBoundedGeoPoint(raw)) return null;
  const provenance = normalizeCoordinateProvenance(raw.provenance);
  if (provenance === COORDINATE_PROVENANCE.DEVICE_FIX
      && !isEpochMilliseconds(raw.capturedAt)) return null;
  if (raw.capturedAt !== undefined && !isEpochMilliseconds(raw.capturedAt)) return null;
  if (raw.accuracyMeters !== undefined
      && (!Number.isFinite(raw.accuracyMeters) || raw.accuracyMeters < 0)) return null;
  return {
    lng: raw.lng,
    lat: raw.lat,
    provenance,
    ...(raw.capturedAt !== undefined ? { capturedAt: raw.capturedAt } : {}),
    ...(raw.accuracyMeters !== undefined ? { accuracyMeters: raw.accuracyMeters } : {}),
  };
}

export function isFreshDeviceFix(point, options = {}) {
  const { now, freshnessBudgetMs } = options || {};
  if (point?.provenance !== COORDINATE_PROVENANCE.DEVICE_FIX
      || !isBoundedGeoPoint(point) || !isEpochMilliseconds(point.capturedAt)
      || !isEpochMilliseconds(now)
      || !Number.isFinite(freshnessBudgetMs) || freshnessBudgetMs <= 0) return false;
  const ageMs = now - point.capturedAt;
  return ageMs >= 0 && ageMs <= freshnessBudgetMs;
}

// Consumers supply a finite positive freshness budget and a comparable clock.
// A device fix used as a waypoint is checked at adoption; its subsequent canonical
// ownership is a Ride/Order concern, not a JSON flag that bypasses this live check.
export function isTrustedLiveGeoPoint(point, options) {
  if (!readGeoPoint(point) || !TRUSTED_PROVENANCE.has(point.provenance)) return false;
  return point.provenance !== COORDINATE_PROVENANCE.DEVICE_FIX
    || isFreshDeviceFix(point, options);
}

// The geo portion of production VehiclePosition eligibility only. Callers still
// enforce identity, privacy, ride binding and status. updatedAt is never consulted.
// Active guidance additionally needs the later direct-acquisition/accuracy gate.
export function isLiveVehiclePoint(point, options) {
  return point?.provenance === COORDINATE_PROVENANCE.DEVICE_FIX
    && isTrustedLiveGeoPoint(point, options);
}
