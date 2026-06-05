// BD-MAP-FOUND-03 — Driver markers layer (foundation stub).
// Pure helpers + DOM-light factory for plotting driver/order markers onto the
// MapShell placeholder. No Mapbox SDK, no token, no network, no CDN, no inline
// style. BD-MAP-FOUND-01 will replace the body with real Mapbox GL markers once
// the SDK + CSP surface is designed; the export contract here stays stable.
//
// Contract:
//   createDriverMarkersLayer(options)        → { type, variant, markers, root }
//   renderDriverMarkers(mapShell, orders, options) → layer  (safe no-op without a map)
//   clearDriverMarkers(layer)                → void
//   getDriverMarkerSummary(orders)           → { total, withCoords, withPrice }

const LAYER_TYPE = 'driver-markers';
const PRICE_FIELDS = ['estimatedPrice', 'estimatedPriceLabel', 'offerPrice', 'price'];
// BD-MAP-FOUND-05B — placeholder anchors are a fixed off-center set in
// map_shell_foundation.css ([data-index="0".."11"]). Wrap the marker index
// modulo the anchor count so the 4th+ marker (and any 12+ overflow) reuses a
// real off-center anchor instead of stacking on the center (50%/50%) fallback.
const MARKER_ANCHOR_COUNT = 12;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasCoords(order) {
  return isPlainObject(order)
    && isPlainObject(order.pickup)
    && typeof order.pickup.lng === 'number'
    && typeof order.pickup.lat === 'number';
}

// BD-MAP-FOUND-05D — price detection must reject NaN / Infinity / blank /
// the literal "NaN" string so withPrice in getDriverMarkerSummary cannot be
// inflated by malformed numeric fields.
function hasPriceValue(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') {
    const label = value.trim();
    return label !== '' && label.toLowerCase() !== 'nan';
  }
  return false;
}

function hasPrice(order) {
  return isPlainObject(order)
    && PRICE_FIELDS.some((field) => hasPriceValue(order[field]));
}

export function createDriverMarkersLayer(options = {}) {
  const opts = isPlainObject(options) ? options : {};
  return {
    type: LAYER_TYPE,
    variant: typeof opts.variant === 'string' ? opts.variant : 'driver',
    markers: [],
    root: null,
  };
}

function createMarkerEl(order, index) {
  const el = document.createElement('div');
  el.className = 'bd-map-shell__marker bd-map-shell__marker--order';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Заказ на карте');
  el.dataset.index = String(index % MARKER_ANCHOR_COUNT);
  const id = isPlainObject(order) && typeof order.id === 'string' ? order.id : '';
  if (id) el.dataset.orderId = id;
  return el;
}

export function renderDriverMarkers(mapShell, orders = [], options = {}) {
  const layer = createDriverMarkersLayer(options);
  const list = safeArray(orders);
  // No real map / no DOM target → safe no-op, return the empty layer descriptor.
  const canRenderDom = mapShell
    && typeof mapShell === 'object'
    && typeof mapShell.appendChild === 'function'
    && typeof document !== 'undefined';
  if (!canRenderDom) return layer;
  layer.root = mapShell;
  // BD-MAP-FOUND-05C — batch DOM insertion so N markers cost one append on the
  // live map shell instead of N (no per-marker layout invalidation).
  const fragment = document.createDocumentFragment();
  list.forEach((order, index) => {
    const el = createMarkerEl(order, index);
    fragment.appendChild(el);
    layer.markers.push(el);
  });
  mapShell.appendChild(fragment);
  return layer;
}

export function clearDriverMarkers(layer) {
  if (!isPlainObject(layer) || !Array.isArray(layer.markers)) return;
  for (const el of layer.markers) {
    if (el && typeof el.remove === 'function') el.remove();
  }
  layer.markers = [];
  layer.root = null;
}

export function getDriverMarkerSummary(orders = []) {
  const list = safeArray(orders);
  let withCoords = 0;
  let withPrice = 0;
  for (const order of list) {
    if (hasCoords(order)) withCoords += 1;
    if (hasPrice(order)) withPrice += 1;
  }
  return { total: list.length, withCoords, withPrice };
}
