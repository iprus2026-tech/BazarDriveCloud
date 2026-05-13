// BD-RIDE-F-02 — MapShell placeholder for future active-ride screens.
// Pure DOM factory. No Mapbox SDK, no token, no network, no geolocation.

const DEFAULT_ROUTE = {
  pickupLabel: 'ул. Малая Бронная, 28',
  dropoffLabel: 'Шереметьево, терминал В',
};

const VALID_VARIANTS = new Set(['driver', 'passenger']);

function normalizeVariant(variant) {
  return VALID_VARIANTS.has(variant) ? variant : 'driver';
}

function normalizeRoute(route) {
  const base = { ...DEFAULT_ROUTE };
  if (route && typeof route === 'object') {
    if (typeof route.pickupLabel === 'string' && route.pickupLabel.trim()) {
      base.pickupLabel = route.pickupLabel;
    }
    if (typeof route.dropoffLabel === 'string' && route.dropoffLabel.trim()) {
      base.dropoffLabel = route.dropoffLabel;
    }
  }
  return base;
}

function createDiv(className, ariaHidden) {
  const el = document.createElement('div');
  el.className = className;
  if (ariaHidden) el.setAttribute('aria-hidden', 'true');
  return el;
}

function createMarker(modifier, ariaLabel) {
  const el = document.createElement('div');
  el.className = `bd-map-shell__marker bd-map-shell__marker--${modifier}`;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', ariaLabel);
  return el;
}

function createLabel(modifier, text) {
  const el = document.createElement('div');
  el.className = `bd-map-shell__label bd-map-shell__label--${modifier}`;
  el.textContent = text;
  return el;
}

export function createMapShell(options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const variant = normalizeVariant(opts.variant);
  const route = normalizeRoute(opts.route);
  const status = typeof opts.status === 'string' ? opts.status : '';

  const showRoute = opts.showRoute !== false;
  const showCar = opts.showCar !== false;
  const showPickup = opts.showPickup !== false;
  const showDropoff = opts.showDropoff !== false;
  const showLabels = opts.showLabels !== false;

  const root = document.createElement('section');
  root.className = `bd-map-shell bd-map-shell--${variant}`;
  root.setAttribute('aria-label', 'Карта маршрута');
  root.dataset.variant = variant;
  if (status) root.dataset.status = status;

  root.appendChild(createDiv('bd-map-shell__grid', true));
  root.appendChild(createDiv('bd-map-shell__road bd-map-shell__road--main', true));
  root.appendChild(createDiv('bd-map-shell__road bd-map-shell__road--secondary', true));

  if (showRoute) {
    root.appendChild(createDiv('bd-map-shell__route', true));
  }

  if (showCar) {
    root.appendChild(createMarker('car', 'Водитель'));
  }
  if (showPickup) {
    root.appendChild(createMarker('pickup', 'Точка подачи'));
  }
  if (showDropoff) {
    root.appendChild(createMarker('dropoff', 'Точка назначения'));
  }

  if (showLabels) {
    if (showPickup) {
      root.appendChild(createLabel('pickup', route.pickupLabel));
    }
    if (showDropoff) {
      root.appendChild(createLabel('dropoff', route.dropoffLabel));
    }
  }

  return root;
}
