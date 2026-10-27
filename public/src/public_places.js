// BD-ORDERS-PUBLIC-PLACES-01 (#1160) — the server catalog of public places (GET /api/v1/places):
// Sheremetyevo terminals and the Moscow railway stations, each with its taxi pickup point. The
// route picker offers them as quick buttons and /map pins them. Backend OFF: no catalog (the demo
// picker keeps its own mock rows). Coordinates © OpenStreetMap contributors, ODbL.
import { isBackendEnabled } from './api_config.js';
import { apiFetch } from './api_client.js';
import { isPlaceId } from './passenger_order_utils.js';
import { isBoundedGeoPoint } from './geo_point.js';

const KIND_HINTS = Object.freeze({ airport: 'Аэропорт', railway_station: 'Вокзал' });

let pending = null;

function readPlace(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!isPlaceId(raw.id) || !name || !isBoundedGeoPoint(raw)) return null;
  return Object.freeze({ id: raw.id, name, kind: typeof raw.kind === 'string' ? raw.kind : '', lng: raw.lng, lat: raw.lat });
}

// The catalog, read once per page load. A failed read is not cached, so the next caller retries;
// a 2xx without an `items` array is a failed read too (an explicit `{ items: [] }` is a valid
// empty catalog).
export function listPublicPlaces() {
  if (!isBackendEnabled()) return Promise.resolve([]);
  if (!pending) {
    pending = apiFetch('/places')
      .then((body) => {
        if (!Array.isArray(body?.items)) throw new Error('Malformed /places response');
        return body.items.map(readPlace).filter(Boolean);
      })
      .catch((err) => { pending = null; throw err; });
  }
  return pending;
}

export function publicPlaceHint(place) {
  return KIND_HINTS[place?.kind] || 'Публичное место';
}

// A route point for a catalog place: its name as the label, its pickup point as trusted
// coordinates, and its catalog id — the server shows such a point to others by the catalog.
export function publicPlacePoint(place) {
  return {
    id: `place-${place.id}`,
    label: place.name,
    hint: publicPlaceHint(place),
    source: 'search',
    placeId: place.id,
    coords: { lng: place.lng, lat: place.lat, provenance: 'geocode_point' },
  };
}

// Tests only: forget the cached catalog.
export function resetPublicPlacesForTests() {
  pending = null;
}
