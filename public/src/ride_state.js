// BD-RIDE-F-01 — Active ride contracts and storage.
// Foundation layer only. No UI, no route, no Mapbox, no backend.

const STORAGE_KEY = 'bazardrive.active_ride.v1';

export const RIDE_STATUS = {
  NEW_ORDER: 'NEW_ORDER',
  CONFIRMATION_PENDING: 'CONFIRMATION_PENDING',
  CONFIRMED: 'CONFIRMED',
  CHAT_STARTED: 'CHAT_STARTED',
  DRIVER_EN_ROUTE: 'DRIVER_EN_ROUTE',
  DRIVER_APPROACHING_PICKUP: 'DRIVER_APPROACHING_PICKUP',
  WAITING_PASSENGER: 'WAITING_PASSENGER',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELED: 'CANCELED',
  NO_SHOW: 'NO_SHOW',
};

export const DEMO_ACTIVE_RIDE_ID = 'trip_moscow_sheremetyevo_demo';

const STATUS_TIMESTAMP_FIELD = {
  [RIDE_STATUS.DRIVER_EN_ROUTE]: 'acceptedAt',
  [RIDE_STATUS.WAITING_PASSENGER]: 'arrivedAt',
  [RIDE_STATUS.IN_PROGRESS]: 'startedAt',
  [RIDE_STATUS.COMPLETED]: 'completedAt',
  [RIDE_STATUS.CANCELED]: 'canceledAt',
  [RIDE_STATUS.NO_SHOW]: 'canceledAt',
};

const NEXT_DRIVER_STATUS = {
  [RIDE_STATUS.NEW_ORDER]: RIDE_STATUS.DRIVER_EN_ROUTE,
  [RIDE_STATUS.DRIVER_EN_ROUTE]: RIDE_STATUS.WAITING_PASSENGER,
  [RIDE_STATUS.DRIVER_APPROACHING_PICKUP]: RIDE_STATUS.WAITING_PASSENGER,
  [RIDE_STATUS.WAITING_PASSENGER]: RIDE_STATUS.IN_PROGRESS,
  [RIDE_STATUS.IN_PROGRESS]: RIDE_STATUS.COMPLETED,
  [RIDE_STATUS.COMPLETED]: RIDE_STATUS.COMPLETED,
  [RIDE_STATUS.CANCELED]: RIDE_STATUS.CANCELED,
  [RIDE_STATUS.NO_SHOW]: RIDE_STATUS.NO_SHOW,
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return base;
  const out = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function buildDemoRide() {
  return {
    tripId: DEMO_ACTIVE_RIDE_ID,
    role: 'driver',
    status: RIDE_STATUS.NEW_ORDER,
    passenger: {
      name: 'Анна М.',
      initials: 'АМ',
      rating: '4,86',
      phoneMasked: '+7 ... 23-45',
      luggage: '1 чемодан',
    },
    driver: {
      name: 'Рустам К.',
      initials: 'РК',
      rating: '4,92',
      onlineLabel: 'На линии',
      shiftDuration: '5ч 12м',
    },
    order: {
      offerPrice: '1 480 ₽',
      rate: '12 ₽ / км',
      commission: '8%',
      acceptTimerSec: 14,
      pickupEta: '3 мин',
      pickupDistance: '1,2 км',
      destinationEta: '42 мин',
      destinationDistance: '38 км',
      destinationNote: 'до МКАД и далее',
      tags: ['★ 4,86', '1 чемодан', 'есть детское'],
    },
    route: {
      pickupLabel: 'ул. Малая Бронная, 28',
      dropoffLabel: 'Шереметьево, терминал В',
      currentInstruction: 'Через 350 м направо',
      currentStreet: 'на Тверской бульвар',
      distanceToPickup: '1,2 км',
      etaToPickup: '3 мин',
      etaToDestination: '17 мин',
      pickup: { lng: 37.6173, lat: 55.7558 },
      dropoff: { lng: 37.4146, lat: 55.9726 },
    },
    ride: {
      price: '1 540 ₽',
      todayEarnings: '4 720 ₽',
      tripsToday: 7,
      rating: '4,92',
    },
    waiting: {
      freeLimit: '3:00',
      remaining: '2:30',
      paidStartsAt: '14:18',
      paidRate: '8 ₽ за каждую минуту',
    },
    timestamps: {
      createdAt: new Date().toISOString(),
      acceptedAt: null,
      arrivedAt: null,
      startedAt: null,
      completedAt: null,
      canceledAt: null,
    },
  };
}

export function loadActiveRideStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveActiveRideStore(store) {
  try {
    const safe = isPlainObject(store) ? store : {};
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  } catch {
    // storage unavailable (private mode, quota) — fail soft.
  }
}

export function createDemoActiveRide(overrides = {}) {
  const base = buildDemoRide();
  const merged = deepMerge(base, overrides);
  if (!merged.status) merged.status = RIDE_STATUS.NEW_ORDER;
  if (!merged.timestamps || !merged.timestamps.createdAt) {
    merged.timestamps = {
      ...base.timestamps,
      ...(merged.timestamps || {}),
      createdAt: new Date().toISOString(),
    };
  }
  return merged;
}

export function findActiveRide(tripId = DEMO_ACTIVE_RIDE_ID) {
  const store = loadActiveRideStore();
  const existing = store[tripId];
  return existing && isPlainObject(existing) ? existing : null;
}

export function getActiveRide(tripId = DEMO_ACTIVE_RIDE_ID) {
  const store = loadActiveRideStore();
  const existing = store[tripId];
  if (existing && isPlainObject(existing)) return existing;
  const demo = createDemoActiveRide({ tripId });
  store[tripId] = demo;
  saveActiveRideStore(store);
  return demo;
}

export function saveActiveRide(ride) {
  if (!isPlainObject(ride) || !ride.tripId) return ride;
  const store = loadActiveRideStore();
  store[ride.tripId] = ride;
  saveActiveRideStore(store);
  return ride;
}

export function isValidRideStatus(status) {
  return typeof status === 'string'
    && Object.prototype.hasOwnProperty.call(RIDE_STATUS, status);
}

export function getNextDriverStatus(status) {
  return NEXT_DRIVER_STATUS[status] || status;
}

export function updateActiveRideStatus(tripId, status, patch = {}) {
  if (!isValidRideStatus(status)) return findActiveRide(tripId);
  const ride = getActiveRide(tripId);
  const timestampField = STATUS_TIMESTAMP_FIELD[status];
  const timestamps = { ...(ride.timestamps || {}) };
  if (timestampField) {
    if (timestampField === 'acceptedAt') {
      if (!timestamps.acceptedAt) timestamps.acceptedAt = new Date().toISOString();
    } else {
      timestamps[timestampField] = new Date().toISOString();
    }
  }
  const next = deepMerge(ride, patch);
  next.status = status;
  next.timestamps = timestamps;
  return saveActiveRide(next);
}

export function resetActiveRide(tripId = DEMO_ACTIVE_RIDE_ID) {
  const store = loadActiveRideStore();
  if (Object.prototype.hasOwnProperty.call(store, tripId)) {
    delete store[tripId];
    saveActiveRideStore(store);
  }
  return store;
}

export function clearActiveRideStore() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // fail soft.
  }
}
