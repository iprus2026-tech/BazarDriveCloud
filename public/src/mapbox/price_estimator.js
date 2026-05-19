// BD-MAP-FOUND-STUB-01 — price estimator stub.
// No tariff table, no backend. The real estimator will land with
// BD-MAP-FOUND-01 once route data is available.
//
// Contract:
//   estimatePrice(routeEstimate) → number | null   (RUB, or null when unknown)

export function estimatePrice(_routeEstimate) {
  return null;
}

export function formatPrice(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${Math.round(value)} ₽`;
}
