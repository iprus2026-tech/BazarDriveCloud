// BD-MAP-FOUND-STUB-01 — route service stub.
// No Directions API, no network. Returns a null route until the real
// Mapbox integration (BD-MAP-FOUND-01) is wired.
//
// Contract:
//   estimateRoute(pickup, dropoff) → Promise<RouteEstimate | null>
//   RouteEstimate = { distanceKm: number, durationMin: number }

export function estimateRoute(_pickup, _dropoff) {
  return Promise.resolve(null);
}

export function clearRouteDraft() {
  /* no-op — route draft is owned by future MapHome state */
}
