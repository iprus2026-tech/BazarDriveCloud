// BD-RIDE-AUTHORITY-01C — Pure canonical passenger Ride construction.
// Foundation layer only. No screen imports, no localStorage, no
// getOrderById/resolveResponseById, no acceptOrder, no saveActiveRide, no
// backend calls, no UI/navigation/toasts.
//
// Extracted from responses.js::buildPassengerActiveRide (BD-RIDE-AUTHORITY-01B),
// which fused resolve + accept-order + construct + persist into one function.
// This module owns ONLY the construct step: given an already-resolved order,
// request and driver, it returns a Ride object. Callers (responses.js's
// buildPassengerActiveRide, trip_confirmation_handoff.js's
// seedRealActiveRideFromHandoff) own resolution, any accept-order decision,
// and persistence themselves.
//
// `order` here is whatever source order the caller decides to construct
// from (already-accepted or not — this module does not care and does not
// read `order.status` for any constructed field, only for the
// `timestamps.acceptedAt` passthrough, which is a display value, not a
// lifecycle write). `request` is the shape requestFromOrder() produces.
// `driver` is the shape mapResponseToDriverCard() produces.

import { createDemoActiveRide, RIDE_STATUS } from './ride_state.js';
import { DEFAULT_FREE_WAIT_LIMIT, DEFAULT_PAID_RATE_LABEL } from './ride_waiting_policy.js';

function driverInitials(driver) {
  return driver.initials || String(driver.name || 'В').trim().charAt(0).toUpperCase() || 'В';
}

function passengerSnapshot(order) {
  const snap = order && typeof order.passenger === 'object' && order.passenger ? order.passenger : null;
  if (snap && typeof snap.name === 'string' && snap.name.trim()) {
    return { ...snap, name: snap.name.trim() };
  }
  return {
    name: 'Вы',
    initials: 'В',
    phoneMasked: '',
    note: typeof order?.comment === 'string' ? order.comment : '',
    isCurrentUser: true,
  };
}

// Pure. Returns a fully-built canonical passenger Ride object, or null when
// `order` is missing an id. Never persists — the caller decides whether and
// when to call saveActiveRide().
export function buildPassengerRideSeed(order, request, driver) {
  if (!order || !order.id) return null;
  const orderId = String(order.id);
  const tripId = `trip_${orderId}`;
  const now = new Date().toISOString();
  const ride = createDemoActiveRide({
    tripId,
    role: 'passenger',
    status: RIDE_STATUS.DRIVER_EN_ROUTE,
    driver: {
      id: driver.id,
      name: driver.name,
      initials: driverInitials(driver),
      rating: driver.rating,
      phoneMasked: '+7 ... 45-67',
    },
    vehicle: {
      model: driver.carModel || driver.car,
      color: driver.carColor || '',
      plate: driver.plate,
    },
    passenger: passengerSnapshot(order),
    order: {
      offerPrice: driver.price || request.price,
      pickupEta: driver.eta,
      destinationEta: order?.durationMin ? `${order.durationMin} мин` : '28 мин',
      destinationDistance: order?.distanceKm ? `${order.distanceKm} км` : '—',
      passengerComment: request.note,
    },
    route: {
      pickupLabel: request.pickupLabel,
      dropoffLabel: request.dropoffLabel,
      etaToPickup: driver.eta,
      etaToDestination: order?.durationMin ? `${order.durationMin} мин` : '28 мин',
      pickup: order?.pickup || null,
      dropoff: order?.dropoff || null,
    },
    ride: {
      price: driver.price || request.price,
    },
    // BD-RIDE-WAITING-01E — explicit override so a real Ride never inherits
    // buildDemoRide()'s demo waiting snapshot. freeLimit/paidRate are kept as
    // the current policy-like literals (every consumer's own fallback chain
    // already assumes these same values); remaining/paidStartsAt cannot be
    // known at seed time — the real WAITING_PASSENGER anchor is
    // ride.timestamps.arrivedAt (stamped at the EN_ROUTE -> WAITING_PASSENGER
    // transition), which the driver-side wait timer already prefers over
    // this field.
    waiting: {
      freeLimit: DEFAULT_FREE_WAIT_LIMIT,
      remaining: null,
      paidStartsAt: null,
      paidRate: DEFAULT_PAID_RATE_LABEL,
    },
    timestamps: {
      acceptedAt: order?.acceptedAt || now,
    },
  });
  // Replace the demo passenger entirely so the active ride preserves the
  // order passenger snapshot without inherited seed fields.
  ride.passenger = passengerSnapshot(order);
  ride.orderId = orderId;
  ride.selectedDriver = {
    id: driver.id,
    responseId: driver.responseId,
    name: driver.name,
    rating: driver.rating,
    car: driver.car,
    plate: driver.plate,
    eta: driver.eta,
    price: driver.price,
    note: driver.note,
  };
  return ride;
}
