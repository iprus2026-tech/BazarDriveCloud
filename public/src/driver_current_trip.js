// Read-only driver resume context. Navigation never accepts/reseeds a ride or
// supplies a status override. Local records are discovery hints on a backend;
// only a participant-authorized Ride GET can confirm that driver's context.
import { user } from './state.js';
import { resolveRole } from './smoke_role.js';
import { getApiBase, getSessionToken, isBackendEnabled } from './api_config.js';
import { getRideFromBackend } from './mock_api.js';
import { loadActiveRideStore, DEMO_ACTIVE_RIDE_ID, RIDE_STATUS } from './ride_state.js';

const ACTIVE_LABELS = Object.freeze({
  [RIDE_STATUS.ACCEPTED]: 'Заказ принят',
  [RIDE_STATUS.DRIVER_EN_ROUTE]: 'Едете к пассажиру',
  [RIDE_STATUS.DRIVER_APPROACHING_PICKUP]: 'Подъезжаете к пассажиру',
  [RIDE_STATUS.WAITING_PASSENGER]: 'Ожидание пассажира',
  [RIDE_STATUS.IN_PROGRESS]: 'Поездка в пути',
});
const text = value => typeof value === 'string' ? value.trim() : '';

export function driverTripScope() {
  const account = user.get();
  const backend = isBackendEnabled();
  // A preview/smoke role must never grant a server-side driver's identity.
  const role = backend ? account.role : resolveRole(account);
  if (!account.onboarded || role !== 'driver' || resolveRole(account) !== 'driver'
      || account.role === 'guest' || (backend && !getSessionToken())) return null;
  return JSON.stringify([getApiBase(), getSessionToken(), role, resolveRole(account),
    account.role, account.phone, account.displayName]);
}

function resumable(ride) {
  return !!ride && Object.hasOwn(ACTIVE_LABELS, ride.status);
}

// Both the driver accept path and passenger selection persist this same store.
// The latter has role=passenger in the local mock: role is a view there, not a
// separate account. Explicit simulation/default seeds must never create a CTA.
// Server-hydrated rides lack local accept markers. While the backend is ON,
// any remaining active record is only an ID hint for the authorized GET below.
export function driverTripCandidates() {
  if (!driverTripScope()) return [];
  const backend = isBackendEnabled();
  return Object.entries(loadActiveRideStore())
    .filter(([id, ride]) => ride?.tripId === id && text(id) && id !== DEMO_ACTIVE_RIDE_ID
      && resumable(ride) && ride.localProvenance !== 'sim_audit'
      && (backend || text(ride.orderId) || ['driver_map', 'post_detail', 'feed'].includes(ride.acceptedSource)
        || (ride.role === 'driver' && id.startsWith('feed-'))))
    .map(([, ride]) => ride)
    .sort((a, b) => {
      const stamp = r => Date.parse(r.timestamps?.acceptedAt || r.timestamps?.createdAt || '') || 0;
      return stamp(b) - stamp(a) || a.tripId.localeCompare(b.tripId);
    });
}

function context(ride, id) {
  if (!resumable(ride) || ride.tripId !== id) return { state: 'empty', trip: null };
  return { state: 'ready', trip: {
    id, status: ride.status, label: ACTIVE_LABELS[ride.status],
    from: text(ride.route?.pickupLabel), to: text(ride.route?.dropoffLabel),
    passenger: text(ride.passenger?.name),
  } };
}

export async function loadDriverTrip({ tripId = null, signal } = {}) {
  const scope = driverTripScope();
  if (!scope) return { state: 'empty', trip: null };
  const candidates = driverTripCandidates();
  // Revalidate the displayed identity on click; never switch to a different
  // trip under an old card, even if another order became newer in the meantime.
  const candidate = tripId ? candidates.find(ride => ride.tripId === tripId) : candidates[0];
  if (!candidate) return { state: 'empty', trip: null };
  if (!isBackendEnabled()) return context(candidate, candidate.tripId);
  try {
    const ride = await getRideFromBackend(candidate.tripId, { signal });
    // The API's role is the stored seed view (passenger after selection),
    // not the requester. Access is checked by the participant-gated GET;
    // the driver's current UI/account scope must still own this response.
    if (signal?.aborted || driverTripScope() !== scope) {
      return { state: 'empty', trip: null };
    }
    return context(ride, candidate.tripId);
  } catch (error) {
    if ([401, 403, 404].includes(error?.status)) return { state: 'empty', trip: null };
    return driverTripScope() === scope && !signal?.aborted
      ? { state: 'error', trip: null } : { state: 'empty', trip: null };
  }
}

export function driverTripRoute(value) {
  return value?.state === 'ready' && text(value.trip?.id)
    ? `/active-ride?role=driver&tripId=${encodeURIComponent(value.trip.id)}` : null;
}
