// BD-RIDE-D-02 / D-07 / D-08 / D-09 — Driver active ride flow.
// Mock/UI only. No Mapbox SDK, no token, no backend, no geolocation,
// no real calls, no payments, no push, no packages.
//
// BD-RIDE-D-09 — Driver Earnings / Completion Polish (issue #376). The
// completed driver flow no longer renders an inline completion card: it
// computes a mock earnings payload (12% commission + tip, net == balance
// delta) and mounts the seven-state DriverEarningsSheet overlay from
// active_ride_driver_sheets.js over the completed map shell. The ?state=
// query selects the entry stage (summary | cash | noncash | shift | loading
// | closed | empty); ride history is still persisted exactly as before.

import { escapeHtml } from '../util.js';
import { go } from '../router.js';
import { user } from '../state.js';
import { resolveRole } from '../smoke_role.js';
import {
  updateActiveRideStatus,
  createDemoActiveRide,
  SIM_AUDIT_RIDE_OVERRIDES,
  RIDE_STATUS,
  DEMO_ACTIVE_RIDE_ID,
  findActiveRide,
  saveActiveRide,
  isTerminalRideStatus,
} from '../ride_state.js';
import { loadCanonicalActiveRide } from './trip_confirmation_handoff.js';
import {
  loadDriverHandoffSnapshot,
  applyDriverHandoffSnapshotToRide,
} from './driver_handoff_snapshot.js';
import { createMapShell } from '../mapbox/map_shell.js';
import {
  findLatestHandedOffOrderTripId,
  updateTripStatus,
  getReceipt,
  saveDriverReceipt,
  getRideFromBackend,
  patchRideStatus,
  pollRide,
} from '../mock_api.js';
import { isBackendEnabled } from '../api_config.js';
import activeRidePassenger from './active_ride_passenger.js';
import {
  saveRideHistoryEntry,
  buildDriverHistoryEntry,
} from '../ride_history.js';
import {
  openDriverCancelSheet,
  openDriverProblemSheet,
  openDriverSafetySheet,
  openDriverEarningsSheet,
  DRIVER_CANCEL_REASON_LABEL_BY_CODE,
} from './active_ride_driver_sheets.js';
import { openDriverNoShowFlow } from './active_ride_driver_noshow.js';
import { DEFAULT_FREE_WAIT_LIMIT, DEFAULT_PAID_RATE_LABEL } from '../ride_waiting_policy.js';

// #765 — Cloud Design line-SVG icons (DS recipe: stroke-width 1.8, round caps/joins, fill:none)
// replacing the emoji / glyph icons that violated the DS "no emoji, ever — only thin-stroke line
// SVG icons" rule: the settings (#ar-gear), safety (#ar-shield), message (#ar-msg) and call
// (#ar-call) icon buttons, the nav-card icon, and the order-card bullet. Glyph-only swap — ids,
// aria-labels, handlers and the BD-RIDE-P-07 safety wiring are untouched.
const AR_ICONS = {
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7 12.8 12.8 0 0 0 .7 2.8 2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4 12.8 12.8 0 0 0 2.8.7 2 2 0 0 1 1.7 2z"/>',
  nav: '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
};
function arIcon(name, size = 20) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${AR_ICONS[name] || ''}</svg>`;
}
function arDot() {
  return '<svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="currentColor"></circle></svg>';
}

const CHAT_STORAGE_KEY = 'bazardrive.chat.v1';
const DRIVER_SHEETS_CSS_ID = 'driver-sheets-css';

const DRIVER_SIMULATION_STATUSES = new Set([
  RIDE_STATUS.NEW_ORDER,
  RIDE_STATUS.ACCEPTED,
  RIDE_STATUS.DRIVER_EN_ROUTE,
  RIDE_STATUS.DRIVER_APPROACHING_PICKUP,
  RIDE_STATUS.WAITING_PASSENGER,
  RIDE_STATUS.IN_PROGRESS,
  RIDE_STATUS.COMPLETED,
  RIDE_STATUS.CANCELED,
  RIDE_STATUS.NO_SHOW,
]);

// BD-CLOUD-DESIGN-LOADING-02E (#876) — request state is a driver ride-read
// concern only. It must never become a Ride State Machine status or reuse the
// existing Driver Earnings `state=loading` vocabulary.
const DRIVER_RIDE_READ_STATE = Object.freeze({
  LOADING: 'loading',
  LOADED: 'loaded',
  EMPTY: 'empty',
  ERROR: 'error',
});
const DRIVER_RIDE_FIXTURES = new Set(Object.values(DRIVER_RIDE_READ_STATE));
const DRIVER_RIDE_READ_TIMEOUT_MS = 12_000;
const DRIVER_RIDE_POLL_MS = 2_500;
const DRIVER_RIDE_POLL_TIMEOUT_MS = 12_000;
const DRIVER_RIDE_FIXTURE_RETRY_MS = 400;

function createDriverFixtureRide(tripId) {
  return createDemoActiveRide({
    tripId: tripId || DEMO_ACTIVE_RIDE_ID,
    role: 'driver',
    status: RIDE_STATUS.DRIVER_EN_ROUTE,
    passenger: {
      name: 'Анна П.',
      initials: 'АП',
      rating: '4,91',
      phoneMasked: '+7 ... 12-34',
      luggage: '1 чемодан',
    },
    driver: {
      name: 'Илья С.',
      initials: 'ИС',
      rating: '4,95',
      onlineLabel: 'На линии',
      shiftDuration: '4ч 20м',
    },
    order: {
      offerPrice: '1 240 ₽',
      rate: '12 ₽ / км',
      commission: '8%',
      pickupEta: '4 мин',
      pickupDistance: '1,3 км',
      destinationEta: '31 мин',
      destinationDistance: '24 км',
      destinationNote: 'до главного входа',
      tags: ['★ 4,95', '1 чемодан'],
    },
    route: {
      pickupLabel: 'Москва, Тверская улица, 12',
      dropoffLabel: 'Москва, Ленинградский вокзал',
      currentInstruction: 'Прямо 300 м',
      currentStreet: 'Тверская улица',
      distanceToPickup: '1,3 км',
      etaToPickup: '4 мин',
      etaToDestination: '31 мин',
      pickup: { lng: 37.6048, lat: 55.7638 },
      dropoff: { lng: 37.6552, lat: 55.7766 },
    },
    ride: { price: '1 240 ₽', todayEarnings: '4 720 ₽', tripsToday: 7, rating: '4,92' },
    timestamps: {
      createdAt: '2026-08-12T00:00:00.000Z',
      acceptedAt: '2026-08-12T00:01:00.000Z',
    },
  });
}

function isExpectedDriverLocalRideMiss(err) {
  return Boolean(err && (err.status === 404 || err.code === 'RIDE_NOT_FOUND'));
}

function createDriverRideReadManager(request) {
  let epoch = 0;
  let controller = null;
  let timeoutId = null;

  function cancel() {
    epoch += 1;
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;
    if (controller) controller.abort();
    controller = null;
  }

  async function run() {
    const currentEpoch = ++epoch;
    if (timeoutId) clearTimeout(timeoutId);
    if (controller) controller.abort();
    const currentController = new AbortController();
    controller = currentController;
    let timedOut = false;
    timeoutId = setTimeout(() => {
      timedOut = true;
      currentController.abort();
    }, DRIVER_RIDE_READ_TIMEOUT_MS);
    try {
      const value = await request(currentController.signal);
      if (currentEpoch !== epoch) return { stale: true };
      return { value };
    } catch (error) {
      if (currentEpoch !== epoch) return { stale: true };
      if (timedOut) {
        const timeoutError = new Error('driver ride read timeout');
        timeoutError.code = 'RIDE_READ_TIMEOUT';
        return { error: timeoutError };
      }
      if (error && error.name === 'AbortError') return { stale: true };
      return { error };
    } finally {
      if (currentEpoch === epoch) {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = null;
        if (controller === currentController) controller = null;
      }
    }
  }

  return { run, cancel };
}

export function parseMoney(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const digits = value.replace(/[^\d-]/g, '');
  if (!digits) return 0;
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

export function formatRub(value) {
  const n = Math.round(Number(value) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n).toString();
  return `${sign}${abs.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₽`;
}

function getHashQuery() {
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  return qi === -1 ? new URLSearchParams() : new URLSearchParams(hash.slice(qi + 1));
}

function syncDriverStatusQuery(nextStatus) {
  try {
    const hash = window.location.hash || '';
    const qi = hash.indexOf('?');
    if (qi === -1) return;
    const params = new URLSearchParams(hash.slice(qi + 1));
    if (!params.has('status') || params.get('status') === nextStatus) return;
    params.set('status', nextStatus);
    window.history.replaceState(null, '', `${hash.slice(0, qi)}?${params.toString()}`);
  } catch {
    // history unavailable — fail soft; the query-override guard still holds.
  }
}

function ensureDriverSheetsCss() {
  if (document.getElementById(DRIVER_SHEETS_CSS_ID)) return;
  const link = document.createElement('link');
  link.id = DRIVER_SHEETS_CSS_ID;
  link.rel = 'stylesheet';
  link.href = './styles/driver_sheets.css';
  document.head.appendChild(link);
}

function safeApplyStatusFromQuery(ride, statusQuery) {
  if (!statusQuery || !DRIVER_SIMULATION_STATUSES.has(statusQuery) || ride.status === statusQuery) return ride;
  const ts = ride.timestamps || {};
  if (statusQuery === RIDE_STATUS.NEW_ORDER) {
    if (ts.acceptedAt || ts.arrivedAt || ts.startedAt || ts.completedAt || ts.canceledAt) return ride;
    return { ...ride, status: RIDE_STATUS.NEW_ORDER };
  }
  if (statusQuery === RIDE_STATUS.ACCEPTED) {
    if (ride.status === RIDE_STATUS.DRIVER_EN_ROUTE
      || ride.status === RIDE_STATUS.DRIVER_APPROACHING_PICKUP
      || ts.arrivedAt
      || ts.startedAt
      || ts.completedAt
      || ts.canceledAt) {
      return ride;
    }
    return { ...ride, status: RIDE_STATUS.ACCEPTED };
  }
  if (statusQuery === RIDE_STATUS.DRIVER_EN_ROUTE || statusQuery === RIDE_STATUS.DRIVER_APPROACHING_PICKUP) {
    if (ts.arrivedAt || ts.startedAt || ts.completedAt || ts.canceledAt) return ride;
    if (statusQuery === RIDE_STATUS.DRIVER_EN_ROUTE
      && (ride.status === RIDE_STATUS.DRIVER_APPROACHING_PICKUP || ts.approachingAt)) {
      return ride;
    }
    return { ...ride, status: statusQuery };
  }
  if (statusQuery === RIDE_STATUS.WAITING_PASSENGER) {
    if (ts.startedAt || ts.completedAt || ts.canceledAt) return ride;
    return { ...ride, status: statusQuery };
  }
  if (statusQuery === RIDE_STATUS.IN_PROGRESS) {
    if (ts.completedAt || ts.canceledAt) return ride;
    return { ...ride, status: statusQuery };
  }
  if (statusQuery === RIDE_STATUS.COMPLETED) {
    if (ts.canceledAt) return ride;
    return { ...ride, status: statusQuery };
  }
  if (statusQuery === RIDE_STATUS.CANCELED || statusQuery === RIDE_STATUS.NO_SHOW) {
    if (ts.completedAt) return ride;
    return { ...ride, status: statusQuery };
  }
  return ride;
}

function pad2(n) { return n < 10 ? `0${n}` : String(n); }

const ACTIVE_RIDE_TO_ORDER_STATUS = {
  [RIDE_STATUS.IN_PROGRESS]: RIDE_STATUS.IN_PROGRESS,
  [RIDE_STATUS.COMPLETED]: RIDE_STATUS.COMPLETED,
  [RIDE_STATUS.CANCELED]: RIDE_STATUS.CANCELED,
  [RIDE_STATUS.NO_SHOW]: RIDE_STATUS.CANCELED,
};

function canonicalOrderIdForRide(ride) {
  if (!ride || typeof ride !== 'object') return null;
  if (typeof ride.orderId === 'string' && ride.orderId.trim()) return ride.orderId.trim();
  if (typeof ride.tripId === 'string' && ride.tripId.startsWith('trip_order-')) {
    return ride.tripId.slice('trip_'.length);
  }
  return null;
}

function syncCanonicalOrderStatus(ride, activeStatus) {
  const orderStatus = ACTIVE_RIDE_TO_ORDER_STATUS[activeStatus];
  if (!orderStatus) return;
  const orderId = canonicalOrderIdForRide(ride);
  if (!orderId) return;
  if (updateTripStatus(orderId, orderStatus)) return;
  if (orderStatus === RIDE_STATUS.IN_PROGRESS) {
    updateTripStatus(orderId, RIDE_STATUS.ACCEPTED);
    updateTripStatus(orderId, RIDE_STATUS.IN_PROGRESS);
    return;
  }
  if (orderStatus === RIDE_STATUS.COMPLETED) {
    updateTripStatus(orderId, RIDE_STATUS.ACCEPTED);
    updateTripStatus(orderId, RIDE_STATUS.IN_PROGRESS);
    updateTripStatus(orderId, RIDE_STATUS.COMPLETED);
  }
}

function appendDriverChatMessage(tripId, text) {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    let store = {};
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        store = parsed.chatId && Array.isArray(parsed.messages) ? { [parsed.chatId]: parsed.messages } : parsed;
      }
    }
    const chatId = `trip-${tripId}`;
    const list = Array.isArray(store[chatId]) ? store[chatId].slice() : [];
    const now = new Date();
    list.push({ id: Date.now(), dir: 'out', senderRole: 'driver', text, time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}` });
    store[chatId] = list;
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // storage unavailable — fail soft.
  }
}

function renderPassenger() {
  const query = getHashQuery();
  const passengerFixture = query.get('fixture') || '';
  const passengerFixtureMode = new Set(['loading', 'loaded', 'empty', 'error']).has(passengerFixture);
  const tripId = query.get('tripId')
    || (passengerFixtureMode ? null : findLatestHandedOffOrderTripId())
    || DEMO_ACTIVE_RIDE_ID;
  return activeRidePassenger({
    tripId,
    statusQuery: query.get('status'),
    phaseQuery: query.get('phase'),
    paymentQuery: query.get('payment'),
  });
}

function renderDriverEmpty() {
  const root = document.createElement('section');
  root.className = 'screen screen--active-ride';
  root.innerHTML = `
    <div class="active-ride__passenger-placeholder" role="status" aria-live="polite">
      <div class="active-ride__passenger-placeholder-text">Нет активного заказа. Откройте ленту и примите заказ.</div>
      <div class="active-ride__actions active-ride__actions--stack">
        <button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-empty-feed">Открыть ленту</button>
      </div>
    </div>
  `;
  root.querySelector('#ar-empty-feed').addEventListener('click', () => go('/feed'));
  return root;
}

function buildDriverEarningsPayload(ride) {
  const fare = parseMoney(ride.ride?.price) || 1540;
  const commissionRate = 0.12;
  const commissionAmount = Math.round(fare * commissionRate);
  const tip = 120;
  const net = fare - commissionAmount + tip;
  const balance = 19195;
  const stats = [
    { val: ride.ride?.todayEarnings ? String(ride.ride.todayEarnings) : '4 720 ₽', lbl: 'Сегодня' },
    { val: String(Number(ride.ride?.tripsToday || 7)), lbl: 'Поездок' },
    { val: ride.ride?.rating ? String(ride.ride.rating) : '4,92', lbl: 'Рейтинг' },
  ];
  const tripNumber = ride.order?.number;
  return {
    fare,
    commissionRate,
    commissionAmount,
    tip,
    net,
    netLabel: formatRub(net),
    netAria: `${net} рублей`,
    fareLabel: formatRub(fare),
    commissionPctLabel: '12%',
    commissionAmountLabel: `−${formatRub(commissionAmount)}`,
    tipLabel: `+${formatRub(tip)}`,
    balanceLabel: formatRub(balance),
    balanceDeltaLabel: `+${formatRub(net)}`,
    dropoffLabel: ride.route?.dropoffLabel || 'Точка назначения',
    stats,
    passengerName: ride.passenger?.name || '',
    passengerInitials: ride.passenger?.initials || 'АМ',
    pickupLabel: ride.route?.pickupLabel || '',
    distanceLabel: ride.order?.destinationDistance || '',
    durationLabel: ride.order?.destinationEta || '',
    tripNumberLabel: tripNumber ? `Поездка №${tripNumber}` : 'Поездка',
  };
}

export default function activeRide() {
  const query = getHashQuery();
  const role = query.get('role') || (resolveRole(user.get()) === 'driver' ? 'driver' : 'passenger');
  if (role !== 'driver') return renderPassenger();
  ensureDriverSheetsCss();

  const fixtureValue = (query.get('fixture') || '').toLowerCase();
  const driverFixture = DRIVER_RIDE_FIXTURES.has(fixtureValue) ? fixtureValue : '';
  const driverFixtureMode = Boolean(driverFixture);
  const rawTripIdParam = query.get('tripId');
  // Seed a recognized fixture with the demo id before handoff resolution so
  // fixture mode never touches persisted active rides or handoff state.
  const rawTripId = rawTripIdParam || (driverFixtureMode ? DEMO_ACTIVE_RIDE_ID : null);
  const latestHandedOffTripId = rawTripId ? null : findLatestHandedOffOrderTripId();
  const tripId = rawTripId || latestHandedOffTripId || DEMO_ACTIVE_RIDE_ID;
  const statusQuery = query.get('status');
  const paymentQuery = (query.get('payment') || '').toLowerCase();
  const earningsState = query.get('state')
    || (paymentQuery === 'cash' || paymentQuery === 'noncash' ? paymentQuery : null);
  let waitExpired = (query.get('wait') || '').toLowerCase() === 'expired';
  let waitTimer = null;
  let waitFreeSec = 0;
  let waitDeadline = 0;
  let waitPaidStart = 0;

  let ride = driverFixtureMode
    ? createDriverFixtureRide(tripId)
    : loadCanonicalActiveRide({ tripId, role: 'driver' });
  let effectiveStatusQuery = statusQuery;
  if (!driverFixtureMode && !ride) {
    const driverSnapshot = loadDriverHandoffSnapshot(tripId);
    const hasValidStatusQuery = statusQuery && DRIVER_SIMULATION_STATUSES.has(statusQuery);
    const hasExplicitTripId = Boolean(rawTripIdParam);
    const hasLatestHandedOffTripId = Boolean(latestHandedOffTripId);
    if (!hasValidStatusQuery && !driverSnapshot && !hasExplicitTripId && !hasLatestHandedOffTripId) return renderDriverEmpty();
    const useSimOverrides = hasValidStatusQuery || Boolean(driverSnapshot);
    const overrides = useSimOverrides ? SIM_AUDIT_RIDE_OVERRIDES : {};
    ride = createDemoActiveRide({ tripId, ...overrides });
    if (driverSnapshot) {
      ride = applyDriverHandoffSnapshotToRide(ride, driverSnapshot);
      if (!hasValidStatusQuery && DRIVER_SIMULATION_STATUSES.has(driverSnapshot.status)) {
        effectiveStatusQuery = driverSnapshot.status;
      }
    } else {
      // BD-RIDE-WAITING-01E — no real driverSnapshot backs this fallback:
      // it was constructed purely from a status-query / explicit-tripId /
      // latest-handoff-tripId simulation path, not from any real handoff
      // data. Mark it local-only so ride_state.js's shared normalizer never
      // treats its intentional demo waiting fixture as stale real-ride
      // residue once persistDriverRideStatus's lazy save persists it. The
      // marker comes from HOW this object was built, never from tripId
      // shape (a feed-audit URL must not be inferred as simulation from
      // its tripId string). Cleared by mergeServerRide once a real server
      // response proves the ride real — see below.
      ride.localProvenance = 'sim_audit';
    }
  }

  const backendRead = !driverFixtureMode && isBackendEnabled();
  if (!backendRead && !driverFixtureMode) {
    ride = safeApplyStatusFromQuery(ride, effectiveStatusQuery);
  }

  let driverReadState = driverFixture || (backendRead ? DRIVER_RIDE_READ_STATE.LOADING : DRIVER_RIDE_READ_STATE.LOADED);
  let backendRide = false;
  let rideCursor = null;
  let ridePollId = null;
  let ridePollInFlight = false;
  let ridePollController = null;
  let ridePollTimeoutId = null;
  let rideRefetchController = null;
  let rideRefetchTimeoutId = null;
  let pendingStatus = null;
  // BD-RIDE-D-NOSHOW-ACK-01 (V2-04C2) — true while the no-show sub-flow owns `sheet`
  // (its own submitting/result/failure views), so a background reconciliation doesn't
  // re-render the parent sheet out from under it. See refetchRideAndRender().
  let noShowFlowOpen = false;
  let fixtureRetryTimer = null;
  let destroyed = false;
  let hasMounted = false;

  function currentViewIsUsable() {
    if (destroyed) return false;
    if (root.isConnected) {
      hasMounted = true;
      return true;
    }
    return !hasMounted;
  }

  // Codex follow-up — mergeServerRide only runs after a successful backend
  // read, which is itself proof this trip is real. A transient sim-fallback
  // ride (see the `ride.localProvenance = 'sim_audit'` stamp above) can
  // still carry the raw demo waiting.remaining/paidStartsAt ('2:30'/
  // '14:18'). serializeRide() sends no `waiting` field at all today, so a
  // plain field-by-field keep(local, server) merge would leave those two
  // fields completely untouched even after the server has proven the ride
  // real. Mirrors active_ride_passenger.js's mergeServerWaiting exactly —
  // explicitly clear remaining/paidStartsAt once the server has responded
  // (regardless of whether it sends a waiting object), while keeping the
  // same keep()-style precedence for freeLimit/paidRate/any field the
  // server might add later. Pure, no persistence.
  function mergeServerWaiting(localWaiting, serverWaiting) {
    const out = { ...(localWaiting || {}) };
    for (const k in (serverWaiting || {})) { if (serverWaiting[k] != null) out[k] = serverWaiting[k]; }
    if (!serverWaiting || serverWaiting.remaining == null) out.remaining = null;
    if (!serverWaiting || serverWaiting.paidStartsAt == null) out.paidStartsAt = null;
    return out;
  }

  // Codex follow-up — mergeServerRide only runs after an authoritative
  // server Ride response, which is itself proof this trip is real. A
  // transient sim-fallback ride (see the `ride.localProvenance = 'sim_audit'`
  // stamp above) must not keep claiming local-only simulation provenance
  // once the server has confirmed it — delete the marker from the merged
  // projection rather than persist `null` as if it were meaningful
  // provenance. No status-reconciliation change.
  function mergeServerRide(srv) {
    const keep = (a, b) => {
      const out = { ...(a || {}) };
      for (const k in (b || {})) { if (b[k] != null) out[k] = b[k]; }
      return out;
    };
    const merged = {
      ...ride,
      tripId: srv.tripId || ride.tripId,
      status: (pendingStatus != null && srv.status !== pendingStatus) ? ride.status : (srv.status || ride.status),
      passenger: keep(ride.passenger, srv.passenger),
      driver: keep(ride.driver, srv.driver),
      route: keep(ride.route, srv.route),
      waiting: mergeServerWaiting(ride.waiting, srv.waiting),
      timestamps: keep(ride.timestamps, srv.timestamps),
      cancel: (srv.cancel && srv.cancel.by) ? srv.cancel : ride.cancel,
    };
    delete merged.localProvenance;
    return merged;
  }

  // Codex follow-up — mergeServerRide's cleanup (mergeServerWaiting +
  // deleted localProvenance) only ever lives in the in-memory `ride`
  // closure variable. If a record already exists in storage for this
  // tripId (a pre-existing, unmarked, backend-derived trip_* record still
  // carrying the raw demo waiting), persistDriverRideStatus's lazy save
  // (`if (!findActiveRide(...)) saveActiveRide(ride)`) never fires — that
  // guard only covers the true first-save case — and the very next status
  // transition's updateActiveRideStatus does its own independent
  // findActiveRide(tripId) read straight from storage, silently
  // re-persisting the stale 2:30/14:18 pair. A successful server read is
  // authoritative proof the trip is real, so once mergeServerRide has run,
  // repair the EXISTING stored record's waiting projection immediately —
  // narrowly, not a full overwrite. Base the repair on the STORED record
  // (never on the in-memory `ride`/server projection) so status,
  // timestamps, tripId, orderId, acceptedSource, passenger, driver, route,
  // cancel and every other stored field survive untouched — including a
  // terminal stored status, which this never thaws (saveActiveRide's own
  // terminal-freeze guard still applies unchanged). No-op when nothing is
  // stored yet — that case is already covered by the first-save path.
  function persistServerConfirmedWaitingProjection() {
    const storedRide = findActiveRide(ride.tripId);
    if (!storedRide) return;
    const repaired = {
      ...storedRide,
      waiting: { ...(ride.waiting || {}) },
    };
    delete repaired.localProvenance;
    saveActiveRide(repaired);
  }

  function clearRideRefetch() {
    if (rideRefetchTimeoutId) clearTimeout(rideRefetchTimeoutId);
    rideRefetchTimeoutId = null;
    if (rideRefetchController) rideRefetchController.abort();
    rideRefetchController = null;
  }

  async function refetchRideAndRender() {
    if (driverReadState !== DRIVER_RIDE_READ_STATE.LOADED || driverFixtureMode || destroyed) return;
    if (ridePollController) ridePollController.abort();
    clearRideRefetch();
    const controller = new AbortController();
    rideRefetchController = controller;
    rideRefetchTimeoutId = setTimeout(() => controller.abort(), DRIVER_RIDE_POLL_TIMEOUT_MS);
    try {
      const srv = await getRideFromBackend(ride.tripId, { signal: controller.signal });
      if (srv && currentViewIsUsable() && rideRefetchController === controller) {
        ride = mergeServerRide(srv);
        persistServerConfirmedWaitingProjection();
        // BD-RIDE-D-NOSHOW-ACK-01 P1 — a TERMINAL status takes ownership of the sheet back
        // from the no-show sub-flow: the earlier PATCH may have actually succeeded despite a
        // client-side failure (or the ride was terminalized elsewhere), so leaving the
        // sub-flow's failure/retry view showing would let the driver retry an already-terminal
        // ride. Non-terminal reconciliation still defers to an open sub-flow — keep `ride`
        // reconciled but don't re-render the parent sheet, which would wipe the sub-flow's
        // submitting/failure view; onBack re-renders with the freshest `ride` on normal exit.
        if (isTerminalRideStatus(ride.status)) {
          noShowFlowOpen = false;
          renderSheet(true);
        } else if (!noShowFlowOpen) {
          renderSheet(true);
        }
      }
    } catch {
      // Writer reconciliation remains non-destructive on transient read failure.
    } finally {
      if (rideRefetchController === controller) {
        if (rideRefetchTimeoutId) clearTimeout(rideRefetchTimeoutId);
        rideRefetchTimeoutId = null;
        rideRefetchController = null;
      }
    }
  }

  function syncRideStatusToBackend(nextStatus) {
    pendingStatus = nextStatus;
    patchRideStatus(ride.tripId, nextStatus)
      .then(() => { pendingStatus = null; refetchRideAndRender(); })
      .catch((err) => {
        pendingStatus = null;
        showNotice(err && err.code === 'RIDE_TERMINAL'
          ? 'Поездка уже завершена'
          : 'Не удалось обновить статус на сервере');
        refetchRideAndRender();
      });
  }

  function commitDriverCompletion() {
    if (!backendRide) { ride = persistDriverRideStatus(RIDE_STATUS.COMPLETED); renderSheet(); return; }
    pendingStatus = RIDE_STATUS.COMPLETED;
    patchRideStatus(ride.tripId, RIDE_STATUS.COMPLETED)
      .then(() => { pendingStatus = null; ride = persistDriverRideStatus(RIDE_STATUS.COMPLETED); renderSheet(); })
      .catch((err) => {
        pendingStatus = null;
        showNotice(err && err.code === 'RIDE_TERMINAL'
          ? 'Поездка уже завершена'
          : 'Не удалось завершить поездку на сервере');
        refetchRideAndRender();
      });
  }

  // BD-RIDE-D-NOSHOW-ACK-01 (V2-04C2) — ACK-first NO_SHOW. Returns a Promise the caller
  // (active_ride_driver_noshow.js, via onConfirmNoShow) awaits to gate its own UI.
  //   backendRide=true:  exactly ONE patchRideStatus(tripId, NO_SHOW) PATCH. A RESOLVED
  //     Promise only proves the HTTP round-trip completed — NOT that the server actually
  //     derived NO_SHOW — so a malformed/empty 2xx body, or one reporting a different status,
  //     is rejected (NO_SHOW_ACK_INVALID) before any local write. Only once serverRide.status
  //     === NO_SHOW is confirmed does the local record get rebuilt from that AUTHORITATIVE
  //     server ride — mergeServerRide() then saveActiveRide() — never a fresh local
  //     updateActiveRideStatus/persistDriverCancel call: that would both stamp a client-side
  //     canceledAt (the server owns timestamps.canceledAt) and, via persistDriverRideStatus's
  //     own backendRide branch, fire a SECOND PATCH. On any failure (network/HTTP/invalid ACK),
  //     nothing is persisted locally (ride stays WAITING_PASSENGER) and the Promise rejects so
  //     the caller shows a failure/retry view instead of success; reconciliation
  //     (refetchRideAndRender) still runs in the background regardless.
  //   backendRide=false: unchanged local-only path (today's default/production behavior).
  function commitDriverNoShow() {
    if (!backendRide) {
      ride = persistDriverCancel(RIDE_STATUS.NO_SHOW, 'passenger_no_show');
      return Promise.resolve();
    }
    pendingStatus = RIDE_STATUS.NO_SHOW;
    return patchRideStatus(ride.tripId, RIDE_STATUS.NO_SHOW)
      .then((serverRide) => {
        // A resolved Promise only means the HTTP round-trip completed — it does NOT prove the
        // server actually derived NO_SHOW. Reject a malformed/empty body or a mismatched status
        // before any local write, so the caller treats it as a failure, never a success.
        if (!serverRide || serverRide.status !== RIDE_STATUS.NO_SHOW) {
          throw new Error('NO_SHOW_ACK_INVALID');
        }
        pendingStatus = null;
        ride = mergeServerRide(serverRide);
        ride = saveActiveRide(ride);
        syncCanonicalOrderStatus(ride, RIDE_STATUS.NO_SHOW);
      })
      .catch((err) => {
        pendingStatus = null;
        showNotice(err && err.code === 'RIDE_TERMINAL'
          ? 'Поездка уже завершена'
          : 'Не удалось подтвердить «не вышел» на сервере');
        refetchRideAndRender();
        throw err;
      });
  }

  function stopRidePoll() {
    if (ridePollId) clearInterval(ridePollId);
    ridePollId = null;
    if (ridePollTimeoutId) clearTimeout(ridePollTimeoutId);
    ridePollTimeoutId = null;
    if (ridePollController) ridePollController.abort();
    ridePollController = null;
    ridePollInFlight = false;
  }

  async function pollRideOnce() {
    if (ridePollInFlight || destroyed || pendingStatus || driverReadState !== DRIVER_RIDE_READ_STATE.LOADED) return;
    if (!root.isConnected) {
      if (hasMounted) teardownDriverRead();
      return;
    }
    ridePollInFlight = true;
    const controller = new AbortController();
    ridePollController = controller;
    ridePollTimeoutId = setTimeout(() => controller.abort(), DRIVER_RIDE_POLL_TIMEOUT_MS);
    try {
      const res = await pollRide(ride.tripId, rideCursor, { signal: controller.signal });
      if (!res || !currentViewIsUsable() || ridePollController !== controller) return;
      if (res.cursor) rideCursor = res.cursor;
      if (res.status && res.status !== ride.status && !pendingStatus) {
        const srv = await getRideFromBackend(ride.tripId, { signal: controller.signal });
        if (srv && currentViewIsUsable() && ridePollController === controller) {
          ride = mergeServerRide(srv);
          persistServerConfirmedWaitingProjection();
          // BD-RIDE-D-NOSHOW-ACK-01 P1 — same terminal-ownership rule as
          // refetchRideAndRender(): the regular poll keeps running independently of the
          // no-show sub-flow (it is only skipped while pendingStatus is set, i.e. mid-PATCH —
          // not once a failed ACK clears it), so without this it could clobber an open
          // submitting/failure view with a non-terminal update. Terminal always takes the
          // sheet back; non-terminal defers to an open sub-flow.
          if (isTerminalRideStatus(ride.status)) {
            noShowFlowOpen = false;
            renderSheet(true);
          } else if (!noShowFlowOpen) {
            renderSheet(true);
          }
        }
      }
      if (isTerminalRideStatus(ride.status)) stopRidePoll();
    } catch {
      // Background refresh failure is deliberately non-destructive.
    } finally {
      if (ridePollController === controller) {
        if (ridePollTimeoutId) clearTimeout(ridePollTimeoutId);
        ridePollTimeoutId = null;
        ridePollController = null;
        ridePollInFlight = false;
      }
    }
  }

  function startRidePoll() {
    if (ridePollId || driverFixtureMode || driverReadState !== DRIVER_RIDE_READ_STATE.LOADED) return;
    ridePollId = setInterval(() => { void pollRideOnce(); }, DRIVER_RIDE_POLL_MS);
  }

  function persistDriverRideStatus(nextStatus, patch = {}) {
    if (!findActiveRide(ride.tripId)) saveActiveRide(ride);
    const nextRide = updateActiveRideStatus(ride.tripId, nextStatus, patch);
    if (nextRide && nextRide.status === nextStatus) {
      syncCanonicalOrderStatus(nextRide, nextStatus);
    }
    if (backendRide && nextStatus !== RIDE_STATUS.COMPLETED) syncRideStatusToBackend(nextStatus);
    return nextRide || ride;
  }

  function persistDriverCancel(nextStatus, reasonCode) {
    return persistDriverRideStatus(nextStatus, {
      cancel: { by: 'driver', reason: reasonCode || 'other' },
    });
  }

  const root = document.createElement('section');
  root.className = 'screen screen--active-ride';
  root.dataset.driverReadState = driverReadState;
  if (driverFixtureMode) root.dataset.fixture = driverFixture;

  const mapWrap = document.createElement('div');
  mapWrap.className = 'active-ride__map';
  const mapShell = createMapShell({ variant: 'driver', status: ride.status, route: ride.route });
  mapWrap.appendChild(mapShell);
  root.appendChild(mapWrap);

  const shiftDuration = ride.driver?.shiftDuration || '';
  const shiftPillSuffix = shiftDuration
    ? `<span class="active-ride__status-sep" aria-hidden="true">|</span><span class="active-ride__status-time">${escapeHtml(shiftDuration)}</span>`
    : '';
  const top = document.createElement('div');
  top.className = 'active-ride__top';
  top.innerHTML = `
    <div class="active-ride__status-row"><button type="button" class="bd-iconbtn active-ride__icon-btn" id="ar-gear" aria-label="Настройки смены">${arIcon('gear', 18)}</button><div class="active-ride__status-pill" role="status" aria-live="polite"><span class="active-ride__status-dot" aria-hidden="true"></span><span class="active-ride__status-text">${escapeHtml(ride.driver?.onlineLabel || 'На линии')}</span>${shiftPillSuffix}</div><button type="button" class="bd-iconbtn active-ride__icon-btn" id="ar-shield" aria-label="Безопасность">${arIcon('shield', 18)}</button></div>
    <div class="active-ride__stats" role="group" aria-label="Статистика смены"><div class="active-ride__stat"><div class="active-ride__stat-value">${escapeHtml(ride.ride?.todayEarnings || '0 ₽')}</div><div class="active-ride__stat-label">сегодня</div></div><div class="active-ride__stat"><div class="active-ride__stat-value">${escapeHtml(String(ride.ride?.tripsToday ?? 0))}</div><div class="active-ride__stat-label">поездок</div></div><div class="active-ride__stat"><div class="active-ride__stat-value">★ ${escapeHtml(ride.ride?.rating || '—')}</div><div class="active-ride__stat-label">рейтинг</div></div></div>
    <div class="active-ride__map-banner" id="ar-map-banner" hidden><span class="active-ride__map-banner-dot" aria-hidden="true"></span><span class="active-ride__map-banner-text"></span></div>
  `;
  root.appendChild(top);

  const sheet = document.createElement('div');
  sheet.className = 'active-ride__sheet';
  sheet.dataset.readState = driverReadState;
  sheet.setAttribute('aria-busy', driverReadState === DRIVER_RIDE_READ_STATE.LOADING ? 'true' : 'false');
  root.appendChild(sheet);
  const notice = document.createElement('div');
  notice.className = 'active-ride__notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.hidden = true;
  root.appendChild(notice);

  const mapBanner = top.querySelector('#ar-map-banner');
  const mapBannerText = mapBanner.querySelector('.active-ride__map-banner-text');
  let noticeTimer = null;
  function showNotice(message) {
    notice.textContent = message;
    notice.hidden = false;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 3500);
  }
  function setMapBanner(text) {
    mapBannerText.textContent = text || '';
    mapBanner.hidden = !text;
  }

  function setDriverMapReadVisibility(visible) {
    for (const selector of [
      '.bd-map-shell__route',
      '.bd-map-shell__marker--pickup',
      '.bd-map-shell__marker--dropoff',
      '.bd-map-shell__marker--car',
      '.bd-map-shell__label',
    ]) {
      for (const el of mapShell.querySelectorAll(selector)) el.hidden = !visible;
    }
  }

  top.querySelector('#ar-gear').addEventListener('click', () => showNotice('Настройки смены будут добавлены позже'));
  top.querySelector('#ar-shield').addEventListener('click', () => openDriverSafetySheet(root, { onAction: showNotice }));

  function passengerRowHtml(passenger) {
    const note = passenger.note || passenger.comment || '';
    return `<div class="active-ride__passenger"><div class="active-ride__passenger-main"><div class="active-ride__avatar" aria-hidden="true">${escapeHtml(passenger.initials || 'АМ')}</div><div class="active-ride__passenger-info"><div class="active-ride__passenger-name">${escapeHtml(passenger.name || '')}<span class="active-ride__passenger-rating">★ ${escapeHtml(passenger.rating || '')}</span></div><div class="active-ride__passenger-meta">${escapeHtml(passenger.phoneMasked || '')}${passenger.luggage ? ` · ${escapeHtml(passenger.luggage)}` : ''}</div></div></div><div class="active-ride__passenger-actions"><button type="button" class="active-ride__icon-action" id="ar-msg" aria-label="Написать пассажиру">${arIcon('chat', 18)}</button><button type="button" class="active-ride__icon-action" id="ar-call" aria-label="Позвонить пассажиру">${arIcon('phone', 18)}</button></div></div>${note ? `<div class="active-ride__passenger-note">${escapeHtml(note)}</div>` : ''}`;
  }

  function bindPassengerActions() {
    const msgBtn = sheet.querySelector('#ar-msg');
    if (msgBtn) msgBtn.addEventListener('click', () => go(`/chat?tripId=${encodeURIComponent(ride.tripId)}&role=driver`));
    const callBtn = sheet.querySelector('#ar-call');
    if (callBtn) callBtn.addEventListener('click', () => showNotice('Звонок пассажиру пока заглушка'));
  }

  function lockFixtureActions() {
    if (!driverFixtureMode) return;
    for (const button of sheet.querySelectorAll('button')) {
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
    }
  }

  function renderSheet(preserveFocus = false) {
    const focusedId = preserveFocus && sheet.contains(document.activeElement)
      ? document.activeElement.id
      : '';
    clearWaitTimer();
    sheet.replaceChildren();
    sheet.dataset.status = ride.status;
    sheet.dataset.readState = DRIVER_RIDE_READ_STATE.LOADED;
    sheet.setAttribute('aria-busy', 'false');
    mapShell.dataset.status = ride.status;
    setMapBanner('');
    setDriverMapReadVisibility(true);
    if (ride.status === RIDE_STATUS.NEW_ORDER) renderNewOrder();
    else if (ride.status === RIDE_STATUS.ACCEPTED) renderAccepted();
    else if (ride.status === RIDE_STATUS.DRIVER_EN_ROUTE) renderEnRoute();
    else if (ride.status === RIDE_STATUS.DRIVER_APPROACHING_PICKUP) renderApproaching();
    else if (ride.status === RIDE_STATUS.WAITING_PASSENGER) renderWaiting();
    else if (ride.status === RIDE_STATUS.IN_PROGRESS) renderInProgress();
    else if (ride.status === RIDE_STATUS.COMPLETED) renderCompleted();
    else if (ride.status === RIDE_STATUS.CANCELED || ride.status === RIDE_STATUS.NO_SHOW) renderCanceledStub();
    else renderGenericStub();
    lockFixtureActions();
    if (focusedId) {
      const nextFocused = document.getElementById(focusedId);
      if (nextFocused && sheet.contains(nextFocused)) nextFocused.focus({ preventScroll: true });
    }
  }

  function renderDriverReadLoading() {
    clearWaitTimer();
    setMapBanner('');
    setDriverMapReadVisibility(false);
    sheet.innerHTML = `
      <div class="active-ride-passenger__read-state active-ride__driver-read-state" data-driver-read-view="loading">
        <div class="active-ride-passenger__read-sheet-skeleton" aria-hidden="true">
          <span class="active-ride-passenger__read-line active-ride-passenger__read-line--title active-ride-passenger__read-bone"></span>
          <span class="active-ride-passenger__read-line active-ride-passenger__read-line--sub active-ride-passenger__read-bone"></span>
          <span class="active-ride-passenger__read-block active-ride-passenger__read-bone"></span>
          <span class="active-ride-passenger__read-block active-ride-passenger__read-block--short active-ride-passenger__read-bone"></span>
          <span class="active-ride-passenger__read-action active-ride-passenger__read-bone"></span>
          <div class="active-ride-passenger__read-actions">
            <span class="active-ride-passenger__read-action active-ride-passenger__read-bone"></span>
            <span class="active-ride-passenger__read-action active-ride-passenger__read-bone"></span>
          </div>
        </div>
        <div class="active-ride-passenger__read-status" role="status" aria-live="polite">Загружаем данные поездки…</div>
      </div>`;
  }

  function renderDriverReadEmpty() {
    clearWaitTimer();
    setMapBanner('');
    setDriverMapReadVisibility(false);
    sheet.innerHTML = `
      <div class="active-ride-passenger__read-state active-ride__driver-read-state" data-driver-read-view="empty" aria-labelledby="ar-driver-read-empty-title">
        <div class="active-ride-passenger__read-title" id="ar-driver-read-empty-title">Активной поездки нет</div>
        <div class="active-ride-passenger__read-copy">Вернитесь к заказам, чтобы выбрать следующую поездку.</div>
        <button type="button" class="bd-btn ghost" id="ar-driver-read-empty-action">К заказам</button>
      </div>`;
    sheet.querySelector('#ar-driver-read-empty-action').addEventListener('click', () => {
      go(driverFixtureMode ? '/driver-map?fixture=empty' : '/driver-map');
    });
  }

  function renderDriverReadError() {
    clearWaitTimer();
    setMapBanner('');
    setDriverMapReadVisibility(false);
    sheet.innerHTML = `
      <div class="active-ride-passenger__read-state active-ride__driver-read-state" data-driver-read-view="error" aria-labelledby="ar-driver-read-error-title">
        <div class="active-ride-passenger__read-title" id="ar-driver-read-error-title">Не удалось загрузить поездку</div>
        <div class="active-ride-passenger__read-copy">Проверьте соединение и повторите загрузку данных поездки.</div>
        <button type="button" class="bd-btn ghost" id="ar-driver-read-retry" aria-label="Повторить загрузку поездки">Повторить загрузку поездки</button>
      </div>`;
    sheet.querySelector('#ar-driver-read-retry').addEventListener('click', () => retryInitialDriverRead());
  }

  function setDriverReadState(nextState, { preserveFocus = false } = {}) {
    driverReadState = nextState;
    root.dataset.driverReadState = nextState;
    sheet.dataset.readState = nextState;
    sheet.setAttribute('aria-busy', nextState === DRIVER_RIDE_READ_STATE.LOADING ? 'true' : 'false');
    if (nextState === DRIVER_RIDE_READ_STATE.LOADING) renderDriverReadLoading();
    else if (nextState === DRIVER_RIDE_READ_STATE.EMPTY) renderDriverReadEmpty();
    else if (nextState === DRIVER_RIDE_READ_STATE.ERROR) renderDriverReadError();
    else renderSheet(preserveFocus);
  }

  function routeRows() {
    return `<ul class="active-ride__route-list" role="list"><li class="active-ride__route-point active-ride__route-point--pickup"><div class="active-ride__route-time">${escapeHtml(ride.order?.pickupEta || '')}</div><div class="active-ride__route-body"><div class="active-ride__route-main">${escapeHtml(ride.route?.pickupLabel || '')}</div><div class="active-ride__route-sub">${escapeHtml(ride.order?.pickupDistance || '')} до пассажира</div></div></li><li class="active-ride__route-point active-ride__route-point--dropoff"><div class="active-ride__route-time">${escapeHtml(ride.order?.destinationEta || '')}</div><div class="active-ride__route-body"><div class="active-ride__route-main">${escapeHtml(ride.route?.dropoffLabel || '')}</div><div class="active-ride__route-sub">${escapeHtml(ride.order?.destinationDistance || '')} · ${escapeHtml(ride.order?.destinationNote || '')}</div></div></li></ul>`;
  }

  function renderNewOrder() {
    const tagsHtml = (ride.order?.tags || []).map((t) => `<span class="active-ride__tag">${escapeHtml(t)}</span>`).join('');
    sheet.innerHTML = `<div class="active-ride__sheet-head"><div class="active-ride__sheet-title"><span class="active-ride__sheet-bullet" aria-hidden="true">${arDot()}</span>НОВЫЙ ЗАКАЗ</div><div class="active-ride__timer">${escapeHtml(String(ride.order?.acceptTimerSec ?? 14))}</div></div><div class="active-ride__price-row"><div class="active-ride__price-col"><div class="active-ride__price">${escapeHtml(ride.order?.offerPrice || '')}</div><div class="active-ride__meta">${escapeHtml(ride.order?.rate || '')} · комиссия ${escapeHtml(ride.order?.commission || '')}</div></div><button type="button" class="active-ride__map-btn" id="ar-map-btn">Карта</button></div>${routeRows()}${tagsHtml ? `<div class="active-ride__tags" role="list">${tagsHtml}</div>` : ''}<div class="active-ride__actions"><button type="button" class="bd-btn ghost active-ride__btn-skip" id="ar-skip">Пропустить</button><button type="button" class="bd-btn primary active-ride__btn-accept" id="ar-accept">Принять заказ</button></div>`;
    sheet.querySelector('#ar-map-btn').addEventListener('click', () => showNotice('Детальная карта будет доступна после Mapbox integration'));
    sheet.querySelector('#ar-accept').addEventListener('click', () => { ride = persistDriverRideStatus(RIDE_STATUS.DRIVER_EN_ROUTE); renderSheet(); });
    sheet.querySelector('#ar-skip').addEventListener('click', () => showNotice('Заказ пропущен. Полный idle-flow будет добавлен позже.'));
  }

  function navCard() {
    return `<div class="active-ride__nav-card"><div class="active-ride__nav-icon" aria-hidden="true">${arIcon('nav', 20)}</div><div class="active-ride__nav-body"><div class="active-ride__nav-main">${escapeHtml(ride.route?.currentInstruction || '')}</div><div class="active-ride__nav-sub">${escapeHtml(ride.route?.currentStreet || '')}</div></div><button type="button" class="active-ride__map-btn" id="ar-nav-btn">Навигатор</button></div>`;
  }

  function renderAccepted() {
    sheet.innerHTML = `<div class="active-ride__sheet-head"><div class="active-ride__sheet-head-main"><div class="active-ride__sheet-title">Заказ принят</div><div class="active-ride__sheet-sub">${escapeHtml(ride.route?.pickupLabel || 'Точка подачи')}</div></div><div class="active-ride__pickup-eta"><div class="active-ride__pickup-eta-value">${escapeHtml(ride.order?.pickupEta || '')}</div><div class="active-ride__pickup-eta-label">до подачи</div></div></div>${routeRows()}${passengerRowHtml(ride.passenger || {})}<div class="active-ride__actions active-ride__actions--stack"><button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-start-pickup">Поехать к пассажиру</button><div class="active-ride__secondary-actions"><button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-open-chat-accepted">Чат с пассажиром</button><button type="button" class="bd-btn ghost active-ride__btn-cancel" id="ar-cancel-accepted">Отменить</button></div></div>`;
    sheet.querySelector('#ar-start-pickup').addEventListener('click', () => { ride = persistDriverRideStatus(RIDE_STATUS.DRIVER_EN_ROUTE); renderSheet(); });
    sheet.querySelector('#ar-open-chat-accepted').addEventListener('click', () => go(`/chat?tripId=${encodeURIComponent(ride.tripId)}&role=driver`));
    sheet.querySelector('#ar-cancel-accepted').addEventListener('click', () => openDriverCancelSheet(root, { onConfirm: (code) => { ride = persistDriverCancel(RIDE_STATUS.CANCELED, code); }, onClose: () => renderSheet() }));
    bindPassengerActions();
  }

  function renderEnRoute() {
    sheet.innerHTML = `<div class="active-ride__sheet-head"><div class="active-ride__sheet-head-main"><div class="active-ride__sheet-title">Едете к пассажиру</div><div class="active-ride__sheet-sub">${escapeHtml(ride.order?.pickupDistance || '')} · ${escapeHtml(ride.route?.pickupLabel || '')}</div></div><div class="active-ride__pickup-eta"><div class="active-ride__pickup-eta-value">${escapeHtml(ride.order?.pickupEta || '')}</div><div class="active-ride__pickup-eta-label">до подачи</div></div></div>${navCard()}${passengerRowHtml(ride.passenger || {})}<div class="active-ride__actions active-ride__actions--stack"><button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-approaching">Подъезжаю</button><div class="active-ride__secondary-actions"><button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-open-chat-enroute">Чат с пассажиром</button><button type="button" class="bd-btn ghost active-ride__btn-cancel" id="ar-cancel">Отменить</button></div></div>`;
    sheet.querySelector('#ar-nav-btn').addEventListener('click', () => showNotice('Навигатор будет доступен после Mapbox integration'));
    sheet.querySelector('#ar-approaching').addEventListener('click', () => {
      appendDriverChatMessage(ride.tripId, 'Подъезжаю к точке подачи');
      ride = persistDriverRideStatus(RIDE_STATUS.DRIVER_APPROACHING_PICKUP);
      syncDriverStatusQuery(ride.status);
      renderSheet();
    });
    sheet.querySelector('#ar-open-chat-enroute').addEventListener('click', () => go(`/chat?tripId=${encodeURIComponent(ride.tripId)}&role=driver`));
    sheet.querySelector('#ar-cancel').addEventListener('click', () => openDriverCancelSheet(root, { onConfirm: (code) => { ride = persistDriverCancel(RIDE_STATUS.CANCELED, code); }, onClose: () => renderSheet() }));
    bindPassengerActions();
  }

  function renderApproaching() {
    sheet.innerHTML = `<div class="active-ride__sheet-head"><div class="active-ride__sheet-head-main"><div class="active-ride__sheet-title">Почти у пассажира</div><div class="active-ride__sheet-sub">${escapeHtml(ride.order?.pickupDistance || '')} · ${escapeHtml(ride.route?.pickupLabel || '')}</div></div><div class="active-ride__pickup-eta"><div class="active-ride__pickup-eta-value">${escapeHtml(ride.order?.pickupEta || '')}</div><div class="active-ride__pickup-eta-label">до подачи</div></div></div>${navCard()}${passengerRowHtml(ride.passenger || {})}<div class="active-ride__actions active-ride__actions--stack"><button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-arrived">Я на месте</button><div class="active-ride__secondary-actions"><button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-open-chat-approaching">Чат с пассажиром</button><button type="button" class="bd-btn ghost active-ride__btn-cancel" id="ar-cancel">Отменить</button></div></div>`;
    sheet.querySelector('#ar-nav-btn').addEventListener('click', () => showNotice('Навигатор будет доступен после Mapbox integration'));
    sheet.querySelector('#ar-arrived').addEventListener('click', () => { ride = persistDriverRideStatus(RIDE_STATUS.WAITING_PASSENGER); renderSheet(); });
    sheet.querySelector('#ar-open-chat-approaching').addEventListener('click', () => go(`/chat?tripId=${encodeURIComponent(ride.tripId)}&role=driver`));
    sheet.querySelector('#ar-cancel').addEventListener('click', () => openDriverCancelSheet(root, { onConfirm: (code) => { ride = persistDriverCancel(RIDE_STATUS.CANCELED, code); }, onClose: () => renderSheet() }));
    bindPassengerActions();
  }

  function progressStep(remaining, total) {
    const partsA = String(remaining || '').split(':').map(Number);
    const partsB = String(total || '').split(':').map(Number);
    if (partsA.length !== 2 || partsB.length !== 2 || partsA.some(Number.isNaN) || partsB.some(Number.isNaN)) return 10;
    const a = partsA[0] * 60 + partsA[1];
    const b = partsB[0] * 60 + partsB[1];
    return b > 0 ? Math.max(0, Math.min(10, Math.round((a / b) * 10))) : 10;
  }

  function parseWaitClock(s) {
    const parts = String(s || '').split(':').map(Number);
    return parts.length === 2 && parts.every(Number.isFinite) ? parts[0] * 60 + parts[1] : 0;
  }
  function formatWaitClock(sec) {
    const t = Math.max(0, sec | 0);
    const m = Math.floor(t / 60);
    const s = t % 60;
    return `${m}:${s < 10 ? '0' + s : s}`;
  }
  function clearWaitTimer() {
    if (waitTimer) { clearInterval(waitTimer); waitTimer = null; }
  }
  function waitDeadlineMs() {
    if (waitDeadline) return waitDeadline;
    const waiting = ride.waiting || {};
    const freeLimitSec = parseWaitClock(waiting.freeLimit || DEFAULT_FREE_WAIT_LIMIT) || 180;
    const arrivedMs = Date.parse((ride.timestamps && ride.timestamps.arrivedAt) || '');
    waitDeadline = Number.isFinite(arrivedMs)
      ? arrivedMs + freeLimitSec * 1000
      : Date.now() + parseWaitClock(waiting.remaining || '2:30') * 1000;
    return waitDeadline;
  }

  // BD-RIDE-WAITING-01E final repair — waiting.paidStartsAt is never a live
  // value on a REAL ride (write-once at seed time, never recomputed), so the
  // old `waiting.paidStartsAt || '14:18'` fallback showed the demo clock
  // time for every real ride, not just legacy ones. timestamps.arrivedAt is
  // the authoritative anchor (stamped at the EN_ROUTE -> WAITING_PASSENGER
  // transition, mirrored server-side) and is already what waitDeadlineMs()
  // prefers for the countdown itself.
  //
  // Codex follow-up — a driver simulation/audit URL opened directly at
  // ?status=WAITING_PASSENGER (safeApplyStatusFromQuery) only overrides
  // status; it never stamps arrivedAt. For that case waiting.paidStartsAt
  // genuinely IS an intentional, designed fixture value (createDemoActiveRide's
  // base, or an explicit sim override) — discarding it in favor of '—'
  // regressed the BD-RIDE-SIM-01 audit/demo scenario. So: an arrivedAt-derived
  // clock always wins when arrivedAt is present; otherwise a REAL ride shows
  // an honest '—' (a real ride's stale/absent waiting.paidStartsAt must never
  // resurface); a non-real ride (demo/sim, no markers) may show its own
  // waiting.paidStartsAt when one is actually set, or '—' otherwise. No new
  // timer, no new persisted field, no arrivedAt stamped from the query
  // simulation — a snapshot computed at each render/refresh pass. Formatted
  // with the existing ru-RU HH:MM convention already used by profile.js.
  //
  // Codex follow-up #2 — this is a RENDER-time check on whatever `ride`
  // object is currently in memory, which can be a transient
  // createDemoActiveRide({ tripId, ...overrides }) fallback (line ~460)
  // constructed under an ARBITRARY caller-supplied tripId (e.g. a
  // ?tripId=feed-audit simulation URL) that was never persisted and never
  // ran through ride_state.js's normalizer. Unlike ride_state.js's shared
  // store-level normalizer — which only ever inspects something already
  // sitting in bazardrive.active_ride.v1, where a feed- key is proof of a
  // real (if unmarked) historical accept — a feed- tripId here proves
  // nothing about provenance, since a demo/sim ride can carry any tripId
  // shape. Only orderId/acceptedSource are safe render-time real signals:
  // a genuinely real, persisted ride reaching this screen already has
  // waiting.paidStartsAt normalized to null by ride_state.js before it's
  // even loaded, so this check never needs the feed- signal to protect it.
  function isRealWaitingCandidate() {
    if (typeof ride.orderId === 'string' && ride.orderId.trim()) return true;
    if (typeof ride.acceptedSource === 'string' && ride.acceptedSource.trim()) return true;
    return false;
  }
  function paidStartLabel() {
    const waiting = ride.waiting || {};
    const freeLimitSec = parseWaitClock(waiting.freeLimit || DEFAULT_FREE_WAIT_LIMIT) || 180;
    const arrivedMs = Date.parse((ride.timestamps && ride.timestamps.arrivedAt) || '');
    if (Number.isFinite(arrivedMs)) {
      return new Date(arrivedMs + freeLimitSec * 1000)
        .toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
    if (isRealWaitingCandidate()) return '—';
    return typeof waiting.paidStartsAt === 'string' && waiting.paidStartsAt.trim() ? waiting.paidStartsAt : '—';
  }
  function startWaitTimer() {
    clearWaitTimer();
    if (waitExpired) return;
    const waiting = ride.waiting || {};
    const freeLimitSec = parseWaitClock(waiting.freeLimit || DEFAULT_FREE_WAIT_LIMIT) || 180;
    const deadline = waitDeadlineMs();
    waitTimer = setInterval(() => {
      if (!root.isConnected || ride.status !== RIDE_STATUS.WAITING_PASSENGER
          || waitExpired || !sheet.querySelector('.ns-timer-arc')) { clearWaitTimer(); return; }
      waitFreeSec = Math.ceil((deadline - Date.now()) / 1000);
      if (waitFreeSec <= 0) {
        waitFreeSec = 0;
        clearWaitTimer();
        waitExpired = true;
        renderWaitingExpired();
        return;
      }
      const pct = Math.max(0, Math.min(1, waitFreeSec / freeLimitSec));
      const step = Math.round(pct * 10);
      const clock = formatWaitClock(waitFreeSec);
      const val = sheet.querySelector('.ns-timer-val');
      const arc = sheet.querySelector('.ns-timer-arc');
      const fill = sheet.querySelector('.active-ride__progress-bar-fill');
      const bar = sheet.querySelector('.active-ride__progress-bar');
      const cardVal = sheet.querySelector('.active-ride__waiting-card-value');
      if (val) val.textContent = clock;
      if (arc) arc.setAttribute('stroke-dashoffset', (163.36 * (1 - pct)).toFixed(2));
      if (fill) fill.dataset.step = String(step);
      if (bar) bar.setAttribute('aria-valuenow', String(step * 10));
      if (cardVal) cardVal.textContent = `${clock} / ${waiting.freeLimit || DEFAULT_FREE_WAIT_LIMIT}`;
    }, 1000);
  }

  function parsePaidRatePerMin(s) {
    const m = String(s || '').match(/\d+/);
    return m ? Number(m[0]) : 0;
  }
  function paidWaitAnchorMs() {
    return waitPaidStart || waitDeadlineMs();
  }
  function liveAccruedPaid() {
    const sec = Math.max(0, Math.floor((Date.now() - paidWaitAnchorMs()) / 1000));
    return Math.round(sec / 60 * (parsePaidRatePerMin((ride.waiting || {}).paidRate) || 8));
  }
  function startPaidTimer() {
    clearWaitTimer();
    const ratePerMin = parsePaidRatePerMin((ride.waiting || {}).paidRate) || 8;
    waitTimer = setInterval(() => {
      if (!root.isConnected || ride.status !== RIDE_STATUS.WAITING_PASSENGER
          || !waitExpired || !sheet.querySelector('.ns-timer-val')) { clearWaitTimer(); return; }
      const paidSec = Math.max(0, Math.floor((Date.now() - waitPaidStart) / 1000));
      const val = sheet.querySelector('.ns-timer-val');
      const accruedEl = sheet.querySelector('#ar-paid-accrued');
      if (val) val.textContent = formatWaitClock(paidSec);
      if (accruedEl) accruedEl.textContent = `${Math.round(paidSec / 60 * ratePerMin)} ₽`;
    }, 1000);
  }

  function renderWaiting() {
    if (waitExpired) { renderWaitingExpired(); return; }
    const waiting = ride.waiting || {};
    const freeLimit = waiting.freeLimit || DEFAULT_FREE_WAIT_LIMIT;
    const freeLimitSec = parseWaitClock(freeLimit) || 180;
    const remSec = Math.max(0, Math.ceil((waitDeadlineMs() - Date.now()) / 1000));
    if (remSec <= 0) { waitExpired = true; renderWaitingExpired(); return; }
    const remaining = formatWaitClock(remSec);
    const waitPct = Math.max(0, Math.min(1, remSec / freeLimitSec));
    const waitStep = Math.round(waitPct * 10);
    setMapBanner('Пассажир уведомлён · ждёт у подъезда');
    sheet.innerHTML = `<div class="active-ride__sheet-head"><div class="active-ride__sheet-head-main"><div class="active-ride__sheet-title">Ожидание пассажира</div><div class="active-ride__sheet-sub">Платное ожидание начнётся в ${escapeHtml(paidStartLabel())}</div></div><div class="ns-timer tone-success"><svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="none" stroke="var(--bg-3)" stroke-width="5"/><circle class="ns-timer-arc" cx="32" cy="32" r="26" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-dasharray="163.36" stroke-dashoffset="${(163.36 * (1 - waitPct)).toFixed(2)}" transform="rotate(-90 32 32)"/></svg><div class="ns-timer-center"><div class="ns-timer-val">${escapeHtml(remaining)}</div></div><div class="ns-timer-lbl">бесплатно</div></div></div><div class="active-ride__waiting-card"><div class="active-ride__waiting-card-head"><span class="active-ride__waiting-card-title">Бесплатное ожидание</span><span class="active-ride__waiting-card-value">${escapeHtml(remaining)} / ${escapeHtml(freeLimit)}</span></div><div class="active-ride__progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${waitStep * 10}"><div class="active-ride__progress-bar-fill" data-step="${waitStep}"></div></div><div class="active-ride__waiting-card-foot">Дальше — ${escapeHtml(waiting.paidRate || DEFAULT_PAID_RATE_LABEL)}</div></div>${passengerRowHtml(ride.passenger || {})}<div class="active-ride__actions active-ride__actions--stack"><button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-start">Начать поездку</button><div class="active-ride__secondary-actions"><button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-call-passenger">Позвонить пассажиру</button><button type="button" class="bd-btn ghost active-ride__btn-cancel" id="ar-no-show">Не приехал</button></div></div>`;
    sheet.querySelector('#ar-start').addEventListener('click', () => { ride = persistDriverRideStatus(RIDE_STATUS.IN_PROGRESS); renderSheet(); });
    sheet.querySelector('#ar-call-passenger').addEventListener('click', () => showNotice('Звонок пассажиру пока заглушка'));
    sheet.querySelector('#ar-no-show').addEventListener('click', () => {
      noShowFlowOpen = true;
      openDriverNoShowFlow(sheet, {
        ride,
        paidWaitAmount: liveAccruedPaid,
        onConfirmNoShow: () => commitDriverNoShow(),
        onBack: () => { noShowFlowOpen = false; renderSheet(); },
        // BD-RIDE-D-NOSHOW-ACK-01 P1 — active_ride.js stays the sole owner of
        // noShowFlowOpen; this is a read-only snapshot the sub-flow checks after its
        // own awaited confirmNoShow() settles, so a stale attempt (superseded by a
        // retry, or by reconciliation discovering the ride already went terminal)
        // never renders over whatever currently owns the sheet.
        isFlowOwner: () => noShowFlowOpen,
        go,
        showNotice,
      });
    });
    bindPassengerActions();
    startWaitTimer();
  }

  function renderWaitingExpired() {
    const waiting = ride.waiting || {};
    const ratePerMin = parsePaidRatePerMin(waiting.paidRate) || 8;
    if (!waitPaidStart) {
      const deadline = waitDeadlineMs();
      waitPaidStart = deadline <= Date.now()
        ? deadline
        : Date.now() - parseWaitClock(waiting.paidElapsed || '2:14') * 1000;
    }
    const paidSec = Math.max(0, Math.floor((Date.now() - waitPaidStart) / 1000));
    const paidElapsed = formatWaitClock(paidSec);
    const accrued = `${Math.round(paidSec / 60 * ratePerMin)} ₽`;
    const paidRate = waiting.paidRate || '8 ₽/мин';
    setMapBanner('Платное ожидание · пассажир не выходит');
    sheet.innerHTML = `<div class="ns-alert warning"><span class="ns-alert-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span><div class="ns-alert-body"><div class="ns-alert-title">Бесплатное ожидание закончилось</div><div class="ns-alert-sub">Идёт платное ожидание · начислено <span id="ar-paid-accrued">${escapeHtml(accrued)}</span></div></div></div><div class="active-ride__sheet-head"><div class="active-ride__sheet-head-main"><div class="active-ride__sheet-title">Пассажир не выходит</div><div class="active-ride__sheet-sub">Платное ожидание · ${escapeHtml(paidRate)}</div></div><div class="ns-timer tone-warning"><svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="none" stroke="var(--bg-3)" stroke-width="5"/><circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-dasharray="163.36" stroke-dashoffset="62.08" transform="rotate(-90 32 32)"/></svg><div class="ns-timer-center"><div class="ns-timer-val">${escapeHtml(paidElapsed)}</div></div><div class="ns-timer-lbl">платно</div></div></div>${passengerRowHtml(ride.passenger || {})}<div class="ns-hint"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg><span>Позвоните пассажиру перед тем, как отметить, что он не вышел.</span></div><div class="active-ride__actions active-ride__actions--stack"><button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-start">Пассажир сел — начать поездку</button><div class="active-ride__secondary-actions"><button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-call-passenger">Позвонить пассажиру</button><button type="button" class="bd-btn ghost active-ride__btn-cancel" id="ar-no-show">Пассажир не вышел</button></div></div>`;
    sheet.querySelector('#ar-start').addEventListener('click', () => { ride = persistDriverRideStatus(RIDE_STATUS.IN_PROGRESS); renderSheet(); });
    sheet.querySelector('#ar-call-passenger').addEventListener('click', () => showNotice('Звонок пассажиру пока заглушка'));
    sheet.querySelector('#ar-no-show').addEventListener('click', () => {
      noShowFlowOpen = true;
      openDriverNoShowFlow(sheet, {
        ride,
        paidWaitAmount: liveAccruedPaid,
        onConfirmNoShow: () => commitDriverNoShow(),
        onBack: () => { noShowFlowOpen = false; renderSheet(); },
        // BD-RIDE-D-NOSHOW-ACK-01 P1 — active_ride.js stays the sole owner of
        // noShowFlowOpen; this is a read-only snapshot the sub-flow checks after its
        // own awaited confirmNoShow() settles, so a stale attempt (superseded by a
        // retry, or by reconciliation discovering the ride already went terminal)
        // never renders over whatever currently owns the sheet.
        isFlowOwner: () => noShowFlowOpen,
        go,
        showNotice,
      });
    });
    bindPassengerActions();
    startPaidTimer();
  }

  function renderInProgress() {
    const finishPrice = ride.ride?.price || '';
    sheet.innerHTML = `<div class="active-ride__sheet-head"><div class="active-ride__sheet-head-main"><div class="active-ride__sheet-title">Везёте пассажира</div><div class="active-ride__sheet-sub">${escapeHtml(ride.route?.dropoffLabel || '')}</div></div><div class="active-ride__pickup-eta active-ride__pickup-eta--progress"><div class="active-ride__pickup-eta-value">${escapeHtml(ride.route?.etaToDestination || '')}</div><div class="active-ride__pickup-eta-label">до места</div></div></div>${navCard()}${passengerRowHtml(ride.passenger || {})}<div class="active-ride__actions active-ride__actions--stack"><button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-finish">Завершить${finishPrice ? ` · ${escapeHtml(finishPrice)}` : ''}</button><div class="active-ride__secondary-actions"><button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-stop">+ Остановка</button><button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-issue">Проблема</button></div></div>`;
    sheet.querySelector('#ar-nav-btn').addEventListener('click', () => showNotice('Навигатор будет доступен после Mapbox integration'));
    sheet.querySelector('#ar-finish').addEventListener('click', () => commitDriverCompletion());
    sheet.querySelector('#ar-stop').addEventListener('click', () => showNotice('Добавление остановки будет доступно позже'));
    sheet.querySelector('#ar-issue').addEventListener('click', () => openDriverProblemSheet(root, { onAction: showNotice }));
    bindPassengerActions();
  }

  function renderCompleted() {
    const payload = buildDriverEarningsPayload(ride);
    const paymentMode = earningsState === 'cash' ? 'cash' : 'noncash';
    const receipt = getReceipt(ride.tripId) || saveDriverReceipt({
      tripId:      ride.tripId,
      completedAt: ride.timestamps?.completedAt || new Date().toISOString(),
      fare:        payload.fare,
      commission:  -payload.commissionAmount,
      tip:         payload.tip,
      net:         payload.net,
      paymentMode,
      status:      'completed',
    });
    const entry = buildDriverHistoryEntry(ride, {
      receipt,
      earnings: {
        gross: payload.fare,
        commissionAmount: payload.commissionAmount,
        net: payload.net,
        commissionLabel: payload.commissionPctLabel,
        tip: payload.tip,
      },
    });
    if (entry) saveRideHistoryEntry(entry);
    sheet.innerHTML = '';
    openDriverEarningsSheet(root, {
      state: earningsState,
      payload,
      onClose:   () => go('/driver-map'),
      onOrders:  () => go('/driver-map'),
      onFeed:    () => go('/feed'),
      onHistory: () => go('/profile?section=history'),
    });
  }

  function renderCanceledStub() {
    const cancel = ride.cancel || {};
    const byPassenger = cancel.by === 'passenger';
    const passengerName = (ride.passenger && ride.passenger.name) || 'Пассажир';
    const reasonLabel = cancel.reason ? DRIVER_CANCEL_REASON_LABEL_BY_CODE[cancel.reason] : '';
    const pickup = ride.route?.pickupLabel || '';
    const dropoff = ride.route?.dropoffLabel || '';
    let title;
    let body;
    if (ride.status === RIDE_STATUS.NO_SHOW) {
      title = 'Пассажир не вышел';
      body = 'Пассажир не появился у точки подачи. Поездка закрыта со статусом «не вышел».';
    } else if (byPassenger) {
      title = 'Пассажир отменил заказ';
      body = `${passengerName} отменил поездку после того, как вы её приняли.`;
    } else if (backendRide && !cancel.by) {
      title = 'Заказ отменён';
      body = 'Поездка отменена. Пассажиру отправлено уведомление.';
    } else {
      title = 'Заказ отменён';
      body = 'Вы отменили заказ. Пассажиру отправлено уведомление.';
    }
    const reasonRow = reasonLabel
      ? `<div class="active-ride__cancel-row"><span class="active-ride__cancel-label">Причина</span><span class="active-ride__cancel-value">${escapeHtml(reasonLabel)}</span></div>`
      : '';
    const routeRowsHtml = (pickup || dropoff)
      ? `<div class="active-ride__cancel-route" role="list" aria-label="Маршрут">${pickup ? `<div class="active-ride__cancel-row" role="listitem"><span class="active-ride__cancel-label">Откуда</span><span class="active-ride__cancel-value">${escapeHtml(pickup)}</span></div>` : ''}${dropoff ? `<div class="active-ride__cancel-row" role="listitem"><span class="active-ride__cancel-label">Куда</span><span class="active-ride__cancel-value">${escapeHtml(dropoff)}</span></div>` : ''}${reasonRow}</div>`
      : (reasonRow ? `<div class="active-ride__cancel-route" role="list">${reasonRow}</div>` : '');
    sheet.innerHTML = `<div class="active-ride__sheet-head"><div class="active-ride__sheet-title">${escapeHtml(title)}</div></div><div class="active-ride__stub">${escapeHtml(body)}</div>${routeRowsHtml}<div class="active-ride__actions active-ride__actions--stack"><button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-back-feed">Вернуться на линию</button><button type="button" class="bd-btn ghost active-ride__btn-primary" id="ar-open-history">Открыть историю</button></div>`;
    sheet.querySelector('#ar-back-feed').addEventListener('click', () => go('/feed'));
    sheet.querySelector('#ar-open-history').addEventListener('click', () => go('/profile'));
  }

  function renderGenericStub() {
    sheet.innerHTML = '<div class="active-ride__sheet-head"><div class="active-ride__sheet-title">Поездка</div></div><div class="active-ride__stub">Этот этап поездки будет реализован позже</div>';
  }

  const initialReadManager = createDriverRideReadManager(
    (signal) => getRideFromBackend(ride.tripId, { signal }),
  );

  function teardownDriverRead() {
    if (destroyed) return;
    destroyed = true;
    initialReadManager.cancel();
    stopRidePoll();
    clearRideRefetch();
    clearWaitTimer();
    if (fixtureRetryTimer) clearTimeout(fixtureRetryTimer);
    fixtureRetryTimer = null;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = null;
    window.removeEventListener('hashchange', handleDriverRouteChange);
  }

  function handleDriverRouteChange() {
    const hash = window.location.hash || '';
    if (!hash.startsWith('#/active-ride')) teardownDriverRead();
  }
  window.addEventListener('hashchange', handleDriverRouteChange);
  queueMicrotask(() => { if (root.isConnected) hasMounted = true; });

  async function runInitialDriverRead() {
    if (!backendRead || driverFixtureMode || destroyed) return;
    stopRidePoll();
    setDriverReadState(DRIVER_RIDE_READ_STATE.LOADING);
    const result = await initialReadManager.run();
    if (!result || result.stale || !currentViewIsUsable()) return;
    if (result.value) {
      backendRide = true;
      ride = mergeServerRide(result.value);
      persistServerConfirmedWaitingProjection();
      setDriverReadState(DRIVER_RIDE_READ_STATE.LOADED);
      if (!isTerminalRideStatus(ride.status)) startRidePoll();
      return;
    }
    const err = result.error;
    if (isExpectedDriverLocalRideMiss(err)) {
      backendRide = false;
      ride = safeApplyStatusFromQuery(ride, effectiveStatusQuery);
      setDriverReadState(DRIVER_RIDE_READ_STATE.LOADED);
      return;
    }
    backendRide = false;
    setDriverReadState(DRIVER_RIDE_READ_STATE.ERROR);
  }

  function retryInitialDriverRead() {
    const stableFocus = top.querySelector('#ar-gear');
    if (stableFocus && sheet.contains(document.activeElement)) stableFocus.focus({ preventScroll: true });
    if (driverFixtureMode) {
      if (driverFixture !== DRIVER_RIDE_READ_STATE.ERROR) return;
      setDriverReadState(DRIVER_RIDE_READ_STATE.LOADING);
      if (fixtureRetryTimer) clearTimeout(fixtureRetryTimer);
      fixtureRetryTimer = setTimeout(() => {
        fixtureRetryTimer = null;
        if (currentViewIsUsable()) setDriverReadState(DRIVER_RIDE_READ_STATE.ERROR);
      }, DRIVER_RIDE_FIXTURE_RETRY_MS);
      return;
    }
    void runInitialDriverRead();
  }

  if (driverFixtureMode) {
    setDriverReadState(driverFixture);
  } else if (backendRead) {
    setDriverReadState(DRIVER_RIDE_READ_STATE.LOADING);
    void runInitialDriverRead();
  } else {
    setDriverReadState(DRIVER_RIDE_READ_STATE.LOADED);
  }

  return root;
}
