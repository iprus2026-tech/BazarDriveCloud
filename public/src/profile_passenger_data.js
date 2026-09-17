// BD-PROFILE-EXPERIENCE-01B: read-only presentation adapter.
// No storage, seeds, lifecycle writes or new API endpoints. Missing discovery
// is unavailable, never proof that the passenger has no active/planned ride.
import { user } from './state.js';
import { getSmokeRole } from './smoke_role.js';
import { isBackendEnabled } from './api_config.js';
import { readRideHistoryStatus } from './ride_history.js';
import { findLatestHandedOffOrderTripId, getRideFromBackend, listHistoryFromBackend } from './mock_api.js';
import { findActiveRide, isTerminalRideStatus, isValidRideStatus, resolveRideStatusLabel } from './ride_state.js';

// Bound presentation loading even if an existing read adapter never settles.
// A timed-out response can no longer replace the returned error state.
async function boundedRead(read) {
  let timer;
  try {
    return await Promise.race([read(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Profile read timeout')), 12000);
    })]);
  } finally { clearTimeout(timer); }
}

const unavailable = () => ({ state: 'unavailable', trip: null });
const text = (v) => typeof v === 'string' ? v.trim() : '';

export function readPassengerProfile() {
  const account = user.get();
  const backend = isBackendEnabled();
  const localRole = getSmokeRole() || account.role;
  let history = { state: 'unavailable', entries: [] };
  if (localRole === 'passenger') {
    try {
      const result = readRideHistoryStatus();
      const entries = result.entries.filter(e => e?.role === 'passenger');
      history = { state: result.status === 'malformed' ? 'error' : entries.length ? 'ready' : 'empty', entries,
        reason: result.status === 'malformed' ? 'malformed' : null };
    } catch { history = { state: 'error', entries: [] }; }
  }
  const name = [text(account.firstName), text(account.lastName)].filter(Boolean).join(' ') || text(account.displayName) || 'Пассажир';
  return {
    account, backend, localRole,
    identity: { name, phone: text(account.phone) },
    localHistory: history,
    history: backend ? { state: 'loading', entries: [] } : history,
    context: backend ? { state: 'loading', trip: null } : readLocalContext(localRole),
  };
}

function candidateTripId(localRole) {
  if (localRole !== 'passenger') return null;
  return findLatestHandedOffOrderTripId({
    orderFilter: order => order.createdByRole === 'passenger'
      || (!order.createdByRole && order.passenger?.isCurrentUser === true),
  });
}

function tripContext(ride, id) {
  if (!ride || ride.tripId !== id || !isValidRideStatus(ride.status)) return unavailable();
  if (isTerminalRideStatus(ride.status)) return { state: 'stale', trip: null };
  // Use the existing route fields, without getActiveRide's demo seed/defaults.
  return { state: 'ready', trip: {
    id, status: ride.status, label: resolveRideStatusLabel(ride.status),
    from: text(ride.route?.pickupLabel), to: text(ride.route?.dropoffLabel),
  } };
}

function readLocalContext(role) {
  try {
    const id = candidateTripId(role);
    return id ? tripContext(findActiveRide(id), id) : unavailable();
  } catch { return { state: 'error', trip: null }; }
}

// Backend stays authoritative. Preserve feedback only for matching server rows;
// local-only history does not become a confirmed backend completion.
export async function loadPassengerHistory(model) {
  if (!model.backend) return readPassengerProfile().localHistory;
  try {
    const items = await boundedRead(() => listHistoryFromBackend());
    if (!Array.isArray(items)) throw new Error('Invalid history');
    const local = new Map(model.localHistory.entries.map(e => [String(e.tripId), e]));
    const entries = items.filter(e => e?.role === 'passenger').map(entry => {
      const feedback = local.get(String(entry.tripId));
      if (!feedback) return entry;
      return { ...entry,
        rating: entry.rating > 0 ? entry.rating : feedback.rating,
        tags: entry.tags?.length ? entry.tags : feedback.tags,
        comment: text(entry.comment) || feedback.comment,
      };
    });
    return { state: entries.length ? 'ready' : 'empty', entries };
  } catch { return { state: 'error', entries: [] }; }
}

export async function loadPassengerContext(model) {
  if (!model.backend) return readLocalContext(model.localRole);
  try {
    const id = candidateTripId(model.localRole);
    // No participant-scoped active/planned list adapter exists yet.
    if (!id) return unavailable();
    const ride = await boundedRead(() => getRideFromBackend(id));
    if (ride?.role !== 'passenger') return unavailable();
    return tripContext(ride, id);
  } catch { return { state: 'error', trip: null }; }
}

// Re-read immediately before navigation: a cached card is not ride authority.
export function passengerTripRoute(context) {
  return context.state === 'ready' && context.trip?.id
    ? `/active-ride?role=passenger&tripId=${encodeURIComponent(context.trip.id)}` : null;
}
