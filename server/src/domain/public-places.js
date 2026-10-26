// /server/src/domain/public-places.js — BD-ORDERS-PUBLIC-PLACES-01 (#1160): the server catalog of
// public places. An order point that carries a known `placeId` is shown to everyone by the catalog
// name and the catalog pickup point, never by the client's text (serialize.js). Changed by PR only.
//
// A catalog point is WHERE A PASSENGER GETS INTO A TAXI (`pickup`), not the centre of a building.
// `building` is the OSM building the place is known by. When a pickup point is not confirmed yet,
// `pickup` holds the building coordinates as a temporary value with `pickupConfirmed: false`.
// The owner (who drives a taxi there) confirmed on 2026-10-26: Sheremetyevo terminals B, C and D are
// operating and the pickup is at the terminal building; railway stations are picked up at the
// building. Vnukovo, Domodedovo and Zhukovsky are not confirmed yet and are NOT listed here — they
// come in a later PR once confirmed.
//
// Coordinates: © OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright).
// Each entry names its OSM object (`building.osm`), read through Nominatim on 2026-10-26.

const place = (id, name, kind, osm, lat, lng, pickupConfirmed) => Object.freeze({
  id,
  name,
  kind,
  pickup: Object.freeze({ lng, lat }),
  pickupConfirmed,
  building: Object.freeze({ lng, lat, osm }),
});

export const PUBLIC_PLACES = Object.freeze([
  // Sheremetyevo (SVO) — terminals B, C, D (owner-confirmed; pickup at the building).
  place('svo-b', 'Аэропорт Шереметьево, терминал B', 'airport', 'relation/10727419', 55.980107, 37.416908, true),
  place('svo-c', 'Аэропорт Шереметьево, терминал C', 'airport', 'relation/19996466', 55.979233, 37.410725, true),
  place('svo-d', 'Аэропорт Шереметьево, терминал D', 'airport', 'relation/10741927', 55.963929, 37.405511, true),
  // Moscow railway stations (pickup at the building).
  place('station-leningradsky', 'Ленинградский вокзал', 'railway_station', 'relation/1736667', 55.776480, 37.655111, true),
  place('station-yaroslavsky', 'Ярославский вокзал', 'railway_station', 'relation/1397947', 55.776777, 37.657362, true),
  place('station-kazansky', 'Казанский вокзал', 'railway_station', 'relation/1309225', 55.773530, 37.656435, true),
  place('station-kievsky', 'Киевский вокзал', 'railway_station', 'relation/2261797', 55.743119, 37.565416, true),
  place('station-belorussky', 'Белорусский вокзал', 'railway_station', 'relation/1440812', 55.776371, 37.581701, true),
  place('station-kursky', 'Курский вокзал', 'railway_station', 'relation/1395483', 55.757443, 37.660903, true),
  place('station-paveletsky', 'Павелецкий вокзал', 'railway_station', 'relation/7253185', 55.729754, 37.639359, true),
  place('station-savyolovsky', 'Савёловский вокзал', 'railway_station', 'relation/1519141', 55.794412, 37.588120, true),
  place('station-rizhsky', 'Рижский вокзал', 'railway_station', 'relation/15686538', 55.792836, 37.632597, true),
  place('station-vostochny', 'Восточный вокзал', 'railway_station', 'relation/18154818', 55.802968, 37.747296, true),
]);

const BY_ID = new Map(PUBLIC_PLACES.map((p) => [p.id, p]));

// The catalog entry for an id, or null. A non-string or unknown id is never a place.
export function findPublicPlace(id) {
  return typeof id === 'string' ? BY_ID.get(id) ?? null : null;
}

// The id shape a point may carry (the POINT schema uses the same pattern).
export const PLACE_ID_PATTERN = '^[a-z0-9][a-z0-9-]{1,63}$';
