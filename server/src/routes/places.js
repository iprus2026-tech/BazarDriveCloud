// /server/src/routes/places.js — BD-ORDERS-PUBLIC-PLACES-01 (#1160).
//   GET /api/v1/places : { items: [{ id, name, kind, lng, lat, pickupConfirmed }] } — the public
//                        places catalog (domain/public-places.js) for the client's quick buttons
//                        and map markers. Public data: no session needed, no DB read. The point is
//                        the taxi pickup point. Coordinates © OpenStreetMap contributors, ODbL.
import { PUBLIC_PLACES } from '../domain/public-places.js';

const ITEMS = Object.freeze(PUBLIC_PLACES.map((p) => Object.freeze({
  id: p.id,
  name: p.name,
  kind: p.kind,
  lng: p.pickup.lng,
  lat: p.pickup.lat,
  pickupConfirmed: p.pickupConfirmed,
})));

export default async function placesRoutes(app) {
  app.get('/places', {
    schema: {
      response: {
        200: {
          type: 'object',
          required: ['items', 'attribution'],
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'name', 'kind', 'lng', 'lat', 'pickupConfirmed'],
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  kind: { type: 'string' },
                  lng: { type: 'number' },
                  lat: { type: 'number' },
                  pickupConfirmed: { type: 'boolean' },
                },
              },
            },
            attribution: { type: 'string' },
          },
        },
      },
    },
  }, async () => ({ items: ITEMS, attribution: '© OpenStreetMap contributors, ODbL' }));
}
