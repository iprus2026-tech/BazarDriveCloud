// BD-RIDE-P-LOCAL-SYNC-01 (#886) — LOCAL_ONLY Passenger Active Ride reconciliation.
//
// The backend remains the source of truth whenever the mounted passenger screen owns a
// SERVER_BACKED ride. This controller exists only for the mock/prototype LOCAL_ONLY seam:
// another same-origin browsing context can advance bazardrive.active_ride.v1 through the
// driver lifecycle, and the already-mounted passenger screen must observe that forward move
// without turning localStorage into a cross-device transport or adding a second poll loop.

import { go } from './router.js';
import { findLatestHandedOffOrderTripId } from './mock_api.js';
import {
  DEMO_ACTIVE_RIDE_ID,
  findActiveRide,
  RIDE_STATUS,
} from './ride_state.js';

const ACTIVE_RIDE_STORAGE_KEY = 'bazardrive.active_ride.v1';
const PASSENGER_LOCAL_ONLY_OWNERSHIP = 'local-only';
const PASSENGER_ROOT_SELECTOR = '.active-ride-passenger';
const PASSENGER_SHEET_SELECTOR = '.active-ride-passenger__sheet';
const PASSENGER_OVERLAY_SELECTOR = '.passenger-safety-overlay, .passenger-cancel-overlay';

const LOCAL_STATUS_RANK = Object.freeze({
  [RIDE_STATUS.NEW_ORDER]: 0,
  [RIDE_STATUS.ACCEPTED]: 1,
  [RIDE_STATUS.DRIVER_EN_ROUTE]: 2,
  [RIDE_STATUS.DRIVER_APPROACHING_PICKUP]: 3,
  [RIDE_STATUS.WAITING_PASSENGER]: 4,
  [RIDE_STATUS.IN_PROGRESS]: 5,
  [RIDE_STATUS.COMPLETED]: 6,
  [RIDE_STATUS.CANCELED]: 6,
  [RIDE_STATUS.NO_SHOW]: 6,
});

const LOCAL_TERMINAL_STATUSES = new Set([
  RIDE_STATUS.COMPLETED,
  RIDE_STATUS.CANCELED,
  RIDE_STATUS.NO_SHOW,
]);

export function isForwardPassengerLocalStatus(currentStatus, nextStatus) {
  const currentRank = LOCAL_STATUS_RANK[currentStatus];
  const nextRank = LOCAL_STATUS_RANK[nextStatus];
  return Number.isInteger(currentRank)
    && Number.isInteger(nextRank)
    && nextRank > currentRank;
}

function readPassengerActiveRideRoute() {
  const rawHash = String(window.location.hash || '');
  const rawRoute = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
  const queryIndex = rawRoute.indexOf('?');
  const path = queryIndex === -1 ? rawRoute : rawRoute.slice(0, queryIndex);
  if (path !== '/active-ride') return null;

  const params = new URLSearchParams(queryIndex === -1 ? '' : rawRoute.slice(queryIndex + 1));
  const role = params.get('role');
  if (role && role !== 'passenger') return null;
  if (params.get('fixture')) return null;

  let tripId = params.get('tripId');
  if (!tripId) {
    try {
      tripId = findLatestHandedOffOrderTripId() || DEMO_ACTIVE_RIDE_ID;
    } catch {
      tripId = DEMO_ACTIVE_RIDE_ID;
    }
  }
  return { tripId, params };
}

function getEligibleLocalPassengerContext() {
  const root = document.querySelector(PASSENGER_ROOT_SELECTOR);
  if (!root || !root.isConnected) return null;
  if (root.dataset.fixture) return null;
  if (root.dataset.ownershipState !== PASSENGER_LOCAL_ONLY_OWNERSHIP) return null;

  const route = readPassengerActiveRideRoute();
  if (!route) return null;
  const sheet = root.querySelector(PASSENGER_SHEET_SELECTOR);
  if (!sheet) return null;
  return { root, sheet, route };
}

function passengerOverlayIsOpen(root) {
  return Boolean(root && root.querySelector(PASSENGER_OVERLAY_SELECTOR));
}

function blockStaleTerminalCancel(root) {
  for (const selector of ['#arp-cancel-confirm', '#arp-cancel-confirm-yes']) {
    const button = root.querySelector(selector);
    if (!button) continue;
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
  }
}

export function initPassengerLocalRideSync() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const app = document.getElementById('app');
  if (!app || typeof MutationObserver !== 'function') return () => {};

  let subscribedRoot = null;
  let pendingStatus = null;

  function detachStorageListener() {
    if (subscribedRoot) window.removeEventListener('storage', onStorage);
    subscribedRoot = null;
    pendingStatus = null;
  }

  function currentContextForSubscribedRoot() {
    const context = getEligibleLocalPassengerContext();
    if (!context || context.root !== subscribedRoot) return null;
    return context;
  }

  function rememberPendingStatus(nextStatus) {
    const pendingRank = LOCAL_STATUS_RANK[pendingStatus] ?? -1;
    const nextRank = LOCAL_STATUS_RANK[nextStatus] ?? -1;
    if (!pendingStatus || nextRank > pendingRank) pendingStatus = nextStatus;
    if (LOCAL_TERMINAL_STATUSES.has(pendingStatus) && subscribedRoot) {
      blockStaleTerminalCancel(subscribedRoot);
    }
  }

  function navigateToForwardStatus(context, nextStatus) {
    const liveContext = currentContextForSubscribedRoot();
    if (!liveContext || liveContext.route.tripId !== context.route.tripId) return false;
    pendingStatus = null;
    go(`/active-ride?role=passenger&status=${encodeURIComponent(nextStatus)}&tripId=${encodeURIComponent(context.route.tripId)}`);
    return true;
  }

  function reconcileFromCanonicalStore() {
    const context = currentContextForSubscribedRoot();
    if (!context) return false;

    // Never trust the raw storage-event payload. ride_state.js owns malformed-store handling and the
    // terminal freeze, so a storage notification is only a signal to re-read this trip.
    const nextRide = findActiveRide(context.route.tripId);
    if (!nextRide || !nextRide.status) return false;

    const currentStatus = context.sheet.dataset.status || '';
    const nextStatus = nextRide.status;
    if (!isForwardPassengerLocalStatus(currentStatus, nextStatus)) return false;

    if (passengerOverlayIsOpen(context.root)) {
      rememberPendingStatus(nextStatus);
      return true;
    }
    return navigateToForwardStatus(context, nextStatus);
  }

  function flushPendingStatus() {
    if (!pendingStatus || !subscribedRoot || passengerOverlayIsOpen(subscribedRoot)) return false;
    // Clear the queue before re-reading so a malformed/manual rollback cannot leave the
    // observer stuck retrying an already-consumed pending literal on every DOM mutation.
    // The canonical store, not the queued value, still decides what may render next.
    pendingStatus = null;
    return reconcileFromCanonicalStore();
  }

  function onStorage(event) {
    if (!event || event.key !== ACTIVE_RIDE_STORAGE_KEY) return;
    reconcileFromCanonicalStore();
  }

  function syncStorageSubscription() {
    const context = getEligibleLocalPassengerContext();
    const nextRoot = context && context.root;

    if (!nextRoot) {
      detachStorageListener();
      return;
    }

    if (subscribedRoot !== nextRoot) {
      detachStorageListener();
      subscribedRoot = nextRoot;
      window.addEventListener('storage', onStorage);
      // A store transition can land while a backend-enabled screen is still UNCONFIRMED.
      // Re-read once when LOCAL_ONLY ownership settles so that missed pre-subscription event
      // cannot strand the passenger on an older lifecycle stage until another write happens.
      reconcileFromCanonicalStore();
      return;
    }
    flushPendingStatus();
  }

  const observer = new MutationObserver(() => {
    syncStorageSubscription();
  });
  observer.observe(app, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-ownership-state', 'data-fixture'],
  });

  syncStorageSubscription();

  return () => {
    observer.disconnect();
    detachStorageListener();
  };
}
