import { COORDINATE_PROVENANCE, readGeoPoint } from './geo_point.js';

function hashText(text) {
  const input = String(text || '').trim().toLowerCase();
  if (!input) return 0;
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function toFixedCoordinate(value) {
  return Math.round(value * 1000000) / 1000000;
}

export function deriveMockCoordsFromLabel(label) {
  const text = String(label || '').trim();
  if (!text) return null;
  const seed = hashText(text);
  const latOffset = ((seed % 3600) / 10000) - 0.18;
  const lngOffset = (((Math.floor(seed / 3600)) % 6000) / 10000) - 0.3;
  return {
    lat: toFixedCoordinate(55.7558 + latOffset),
    lng: toFixedCoordinate(37.6176 + lngOffset),
    provenance: COORDINATE_PROVENANCE.MOCK_HASH,
  };
}

export function resolvePointCoords(point, fallbackLabel = '') {
  // Keep nested drafts and flat order points on the same bounded seam. An
  // existing invalid coordinate is rejected, not replaced by a label hash.
  if (point && typeof point === 'object') {
    // A null from draft sanitization is still an explicit rejected/absent point.
    // Keep it absent on later hydration instead of synthesizing a replacement.
    if ('coords' in point) return readGeoPoint(point.coords);
    if ('lat' in point || 'lng' in point) return readGeoPoint(point);
  }
  // This is the existing local prototype fallback, not a geocoder/GPS result.
  return deriveMockCoordsFromLabel(point?.label || fallbackLabel);
}

export function enrichOrderPointWithCoords(point, fallbackLabel = '') {
  const label = typeof point?.label === 'string'
    ? point.label.trim()
    : String(fallbackLabel || '').trim();
  if (!label) return null;
  const coords = resolvePointCoords(point, label);
  return {
    id: point?.id ?? null,
    label,
    // Preserve provenance, capture time and accuracy through order/ride storage.
    // Rejected coordinates leave a text-only point, not nulls coerced to (0, 0).
    ...(coords || {}),
  };
}

export function maskPassengerPhone(phone, fallback = '') {
  const digits = String(phone || '').replace(/\D+/g, '');
  if (digits.length < 11) return fallback;
  const last4 = digits.slice(-4);
  return `+7 (${digits.slice(-10, -7)}) ··· ${last4.slice(0, 2)}-${last4.slice(2)}`;
}
