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

function readCoord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
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
  };
}

export function resolvePointCoords(point, fallbackLabel = '') {
  const direct = readCoord(point?.coords);
  if (direct) return direct;
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
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
  };
}

export function maskPassengerPhone(phone, fallback = '') {
  const digits = String(phone || '').replace(/\D+/g, '');
  if (digits.length < 11) return fallback;
  const last4 = digits.slice(-4);
  return `+7 (${digits.slice(-10, -7)}) ··· ${last4.slice(0, 2)}-${last4.slice(2)}`;
}
