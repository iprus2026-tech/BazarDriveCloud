// BD-MAP-FOUND-04 — Trip status layer (foundation stub).
// Pure helpers + DOM-light factory for reflecting the active-ride status on the
// MapShell placeholder. No Mapbox SDK, no token, no network, no CDN, no inline
// style. The status vocabulary mirrors RIDE_STATUS in public/src/ride_state.js.
// BD-MAP-FOUND-01 will replace the body with real Mapbox GL layers once the
// SDK + CSP surface is designed; the export contract here stays stable.
//
// Contract:
//   createTripStatusLayer(options)              → { type, status, root }
//   renderTripStatusLayer(mapShell, trip, options) → layer  (safe no-op without a map)
//   clearTripStatusLayer(layer)                 → void
//   getTripStatusVisualState(status)            → { status, tone, modifier, label, terminal }

const LAYER_TYPE = 'trip-status';

const DEFAULT_VISUAL = Object.freeze({
  status: 'UNKNOWN',
  tone: 'neutral',
  modifier: 'unknown',
  label: 'Статус неизвестен',
  terminal: false,
});

// Status vocabulary mirrors RIDE_STATUS (public/src/ride_state.js). Only the
// statuses that have a meaningful map presentation are listed; anything else
// falls back to DEFAULT_VISUAL so the helper never throws.
const STATUS_VISUAL = Object.freeze({
  NEW_ORDER:                 { tone: 'info',    modifier: 'new-order',    label: 'Новый заказ',         terminal: false },
  DRIVER_EN_ROUTE:           { tone: 'active',  modifier: 'en-route',     label: 'Водитель в пути',     terminal: false },
  DRIVER_APPROACHING_PICKUP: { tone: 'active',  modifier: 'approaching',  label: 'Водитель подъезжает', terminal: false },
  WAITING_PASSENGER:         { tone: 'warning', modifier: 'waiting',      label: 'Ожидание пассажира',  terminal: false },
  IN_PROGRESS:               { tone: 'active',  modifier: 'in-progress',  label: 'Поездка идёт',        terminal: false },
  COMPLETED:                 { tone: 'success', modifier: 'completed',    label: 'Поездка завершена',   terminal: true },
  CANCELED:                  { tone: 'danger',  modifier: 'canceled',     label: 'Поездка отменена',    terminal: true },
  NO_SHOW:                   { tone: 'danger',  modifier: 'no-show',      label: 'Пассажир не пришёл',  terminal: true },
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function getTripStatusVisualState(status) {
  if (typeof status === 'string'
      && Object.prototype.hasOwnProperty.call(STATUS_VISUAL, status)) {
    return { status, ...STATUS_VISUAL[status] };
  }
  return { ...DEFAULT_VISUAL };
}

export function createTripStatusLayer(options = {}) {
  const opts = isPlainObject(options) ? options : {};
  const status = typeof opts.status === 'string' ? opts.status : DEFAULT_VISUAL.status;
  return {
    type: LAYER_TYPE,
    status,
    root: null,
  };
}

export function renderTripStatusLayer(mapShell, trip = null, options = {}) {
  const opts = isPlainObject(options) ? options : {};
  const status = isPlainObject(trip) && typeof trip.status === 'string'
    ? trip.status
    : (typeof opts.status === 'string' ? opts.status : DEFAULT_VISUAL.status);
  const layer = createTripStatusLayer({ status });
  const visual = getTripStatusVisualState(status);
  // No real map / no DOM target → safe no-op, return the descriptor only.
  const canRenderDom = mapShell
    && typeof mapShell === 'object'
    && typeof document !== 'undefined'
    && isPlainObject(mapShell.dataset);
  if (!canRenderDom) return layer;
  mapShell.dataset.tripStatus = visual.modifier;
  layer.root = mapShell;
  return layer;
}

export function clearTripStatusLayer(layer) {
  if (!isPlainObject(layer)) return;
  const root = layer.root;
  if (root && isPlainObject(root.dataset)) {
    delete root.dataset.tripStatus;
  }
  layer.root = null;
  layer.status = DEFAULT_VISUAL.status;
}
