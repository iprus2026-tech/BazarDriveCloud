// BD-RIDE-P-02 / BD-RIDE-P-03 / BD-RIDE-P-04 / BD-RIDE-P-05 — Passenger
// active ride. Supports ACCEPTED (Водитель назначен), DRIVER_EN_ROUTE (Водитель едет к вам),
// WAITING_PASSENGER (Водитель ждёт вас), IN_PROGRESS (В пути) and
// COMPLETED (Поездка завершена + оценка). Mock/UI only. No Mapbox SDK,
// no token, no backend, no geolocation, no real calls, no real
// payments, no push.

import { escapeHtml } from '../util.js';
import { go } from '../router.js';
import {
  createDemoActiveRide,
  updateActiveRideStatus,
  saveActiveRide,
  findActiveRide,
  SIM_AUDIT_RIDE_OVERRIDES,
  RIDE_STATUS,
  resolveRideStatusLabel,
  DEMO_ACTIVE_RIDE_ID,
} from '../ride_state.js';
import { loadCanonicalActiveRide } from './trip_confirmation_handoff.js';
import { upgradeStoredActiveRideForOrder } from './responses.js';
import {
  loadDriverHandoffSnapshot,
  applyDriverHandoffSnapshotToRide,
} from './driver_handoff_snapshot.js';
import { updateTripStatus, getRideFromBackend, pollRide, patchRideStatus } from '../mock_api.js';
import { isBackendEnabled } from '../api_config.js';
import { createMapShell } from '../mapbox/map_shell.js';
import { openPassengerSafetySheet, openPassengerCancelSheet } from './active_ride_passenger_sheets.js';
import {
  saveRideHistoryEntry,
  buildPassengerHistoryEntry,
  loadRideHistory,
} from '../ride_history.js';
import { DEFAULT_FREE_WAIT_LIMIT, DEFAULT_PAID_RATE_LABEL } from '../ride_waiting_policy.js';

const CHEVRON_UP_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <polyline points="6 15 12 9 18 15"/>
</svg>`;

const CHEVRON_RIGHT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="16" height="16">
  <polyline points="9 6 15 12 9 18"/>
</svg>`;

const SHIELD_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
</svg>`;

const MESSAGE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>
</svg>`;

const PHONE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.56 2.81.69A2 2 0 0 1 22 16.92z"/>
</svg>`;

const PENCIL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="16" height="16">
  <path d="M12 20h9"/>
  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>
</svg>`;

const CARD_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
  <rect x="2" y="6" width="20" height="14" rx="2"/>
  <line x1="2" y1="11" x2="22" y2="11"/>
</svg>`;

const PIN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
  <circle cx="12" cy="10" r="3"/>
</svg>`;

const SOS_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
  <line x1="12" y1="9" x2="12" y2="13"/>
  <line x1="12" y1="17" x2="12.01" y2="17"/>
</svg>`;

const SHARE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <circle cx="18" cy="5" r="3"/>
  <circle cx="6" cy="12" r="3"/>
  <circle cx="18" cy="19" r="3"/>
  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
</svg>`;

const CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <polyline points="20 6 9 17 4 12"/>
</svg>`;

const PLUS_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <line x1="12" y1="5" x2="12" y2="19"/>
  <line x1="5" y1="12" x2="19" y2="12"/>
</svg>`;

// BD-RIDE-P-06 — Cancel reason icons. Kept inline (no new asset files)
// to match the existing icon strategy on this screen.
const CLOCK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <circle cx="12" cy="12" r="9"/>
  <polyline points="12 7 12 12 15 14"/>
</svg>`;

const CALENDAR_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <rect x="3" y="5" width="18" height="16" rx="2"/>
  <line x1="3" y1="10" x2="21" y2="10"/>
  <line x1="8" y1="3" x2="8" y2="7"/>
  <line x1="16" y1="3" x2="16" y2="7"/>
</svg>`;

const ROUTE_SWAP_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <polyline points="17 1 21 5 17 9"/>
  <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
  <polyline points="7 23 3 19 7 15"/>
  <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
</svg>`;

const X_CIRCLE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="24" height="24">
  <circle cx="12" cy="12" r="10"/>
  <line x1="15" y1="9" x2="9" y2="15"/>
  <line x1="9" y1="9" x2="15" y2="15"/>
</svg>`;

const TRIP_NUMBER_FALLBACK = '№48-321';

// BD-RIDE-P-04B — In-progress sub-phases. Used as a UI overlay on top
// of RIDE_STATUS.IN_PROGRESS so the driver flow's canonical lifecycle
// keeps a single status. ARRIVING_DROPOFF = подъезжаем к точке высадки.
// TODO: ARRIVING_DROPOFF is currently activated only via ?phase= in the
// URL. Once live trip progress / route-progress events / backend signals
// are wired up, the host should derive this phase from real telemetry
// instead of relying on a manual query param.
const PASSENGER_IN_PROGRESS_PHASE = {
  ARRIVING_DROPOFF: 'ARRIVING_DROPOFF',
};

function normalizePhase(phaseQuery) {
  if (!phaseQuery) return null;
  const key = String(phaseQuery).trim().toUpperCase();
  if (key === PASSENGER_IN_PROGRESS_PHASE.ARRIVING_DROPOFF) {
    return PASSENGER_IN_PROGRESS_PHASE.ARRIVING_DROPOFF;
  }
  return null;
}

// BD-CLOUD-DESIGN-LOADING-02D (#872) — request state belongs to the
// participant-gated initial ride read, never to the Ride State Machine.
const PASSENGER_RIDE_READ_STATE = Object.freeze({
  LOADING: 'loading',
  LOADED: 'loaded',
  EMPTY: 'empty',
  ERROR: 'error',
});
const PASSENGER_RIDE_FIXTURES = new Set(Object.values(PASSENGER_RIDE_READ_STATE));
const PASSENGER_RIDE_READ_TIMEOUT_MS = 12_000;
const PASSENGER_RIDE_POLL_MS = 2_500;
const PASSENGER_RIDE_POLL_TIMEOUT_MS = 12_000;
const PASSENGER_RIDE_FIXTURE_RETRY_MS = 400;

function getPassengerRideFixture() {
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  if (qi === -1) return '';
  const value = new URLSearchParams(hash.slice(qi + 1)).get('fixture') || '';
  return PASSENGER_RIDE_FIXTURES.has(value) ? value : '';
}

function hasUsablePassengerRideSource(tripId) {
  const canonicalRide = loadCanonicalActiveRide({ tripId, role: 'passenger' });
  if (canonicalRide) return true;
  return Boolean(loadDriverHandoffSnapshot(tripId));
}

// Fixtures are synthetic before any canonical/local hydration. In particular,
// a colliding tripId must never cause loadCanonicalActiveRide, Responses,
// driver-handoff, history or receipt stores to become preview input.
function createPassengerFixtureRide(tripId) {
  return createDemoActiveRide({
    tripId: tripId || DEMO_ACTIVE_RIDE_ID,
    role: 'passenger',
    status: RIDE_STATUS.ACCEPTED,
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
    ride: { price: '1 240 ₽' },
    timestamps: {
      createdAt: '2026-08-11T00:00:00.000Z',
      acceptedAt: '2026-08-11T00:01:00.000Z',
      approachingAt: null,
      arrivedAt: null,
      startedAt: null,
      completedAt: null,
      canceledAt: null,
    },
  });
}

function createPassengerReadAbortError(message) {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function createPassengerRideReadManager(
  readRide,
  timeoutMs,
  schedule = setTimeout,
  unschedule = clearTimeout,
) {
  let activeRead = null;

  function cancel(message = 'passenger ride read canceled') {
    const operation = activeRead;
    if (!operation) return;
    activeRead = null;
    unschedule(operation.timeoutId);
    operation.controller.abort();
    operation.reject(createPassengerReadAbortError(message));
  }

  function run(tripId) {
    if (activeRead) cancel('passenger ride read superseded');

    let operation;
    const result = new Promise((resolve, reject) => {
      const controller = new AbortController();
      operation = { controller, reject, timeoutId: null };
      activeRead = operation;
      operation.timeoutId = schedule(() => {
        if (activeRead !== operation) return;
        activeRead = null;
        controller.abort();
        const error = new Error('passenger ride read timed out');
        error.name = 'TimeoutError';
        reject(error);
      }, timeoutMs);

      Promise.resolve()
        .then(() => {
          if (activeRead !== operation || controller.signal.aborted) {
            throw createPassengerReadAbortError('passenger ride read canceled before start');
          }
          return readRide(tripId, { signal: controller.signal });
        })
        .then(resolve, reject);
    });

    return result.finally(() => {
      if (activeRead !== operation) return;
      unschedule(operation.timeoutId);
      activeRead = null;
    });
  }

  return {
    cancel,
    run,
    isActive: () => activeRead !== null,
  };
}

function passengerRideLoadingDriverHtml() {
  return `
    <div class="active-ride-passenger__top-card active-ride-passenger__read-skeleton" aria-hidden="true">
      <div class="active-ride-passenger__read-driver-row">
        <span class="active-ride-passenger__read-avatar active-ride-passenger__read-bone"></span>
        <span class="active-ride-passenger__read-driver-lines">
          <span class="active-ride-passenger__read-line active-ride-passenger__read-line--name active-ride-passenger__read-bone"></span>
          <span class="active-ride-passenger__read-line active-ride-passenger__read-line--car active-ride-passenger__read-bone"></span>
        </span>
        <span class="active-ride-passenger__read-eta active-ride-passenger__read-bone"></span>
      </div>
      <div class="active-ride-passenger__read-actions">
        <span class="active-ride-passenger__read-action active-ride-passenger__read-bone"></span>
        <span class="active-ride-passenger__read-action active-ride-passenger__read-bone"></span>
      </div>
    </div>
  `;
}

function passengerRideLoadingSheetHtml() {
  return `
    <div class="active-ride-passenger__read-state">
      <div class="active-ride-passenger__read-sheet-skeleton" aria-hidden="true">
        <span class="active-ride-passenger__read-line active-ride-passenger__read-line--title active-ride-passenger__read-bone"></span>
        <span class="active-ride-passenger__read-line active-ride-passenger__read-line--sub active-ride-passenger__read-bone"></span>
        <span class="active-ride-passenger__read-block active-ride-passenger__read-bone"></span>
        <span class="active-ride-passenger__read-block active-ride-passenger__read-block--short active-ride-passenger__read-bone"></span>
      </div>
    </div>
  `;
}

function passengerRideEmptyHtml() {
  return `
    <div class="active-ride-passenger__read-state active-ride-passenger__read-state--settled"
         role="group" aria-labelledby="arp-read-empty-title">
      <h2 class="active-ride-passenger__read-title" id="arp-read-empty-title">Активной поездки нет</h2>
      <p class="active-ride-passenger__read-copy">Вернитесь в ленту, чтобы выбрать или создать поездку.</p>
      <button type="button" class="bd-btn primary active-ride-passenger__read-cta" id="arp-read-feed">Вернуться в ленту</button>
    </div>
  `;
}

function passengerRideErrorHtml() {
  return `
    <div class="active-ride-passenger__read-state active-ride-passenger__read-state--settled"
         role="group" aria-labelledby="arp-read-error-title">
      <h2 class="active-ride-passenger__read-title" id="arp-read-error-title">Не удалось загрузить поездку</h2>
      <p class="active-ride-passenger__read-copy">Проверьте соединение и повторите загрузку данных поездки.</p>
      <button type="button" class="bd-btn primary active-ride-passenger__read-cta" id="arp-read-retry"
              aria-label="Повторить загрузку поездки">Повторить</button>
    </div>
  `;
}

// View-only: never persists status by default. The driver flow owns the
// canonical ride lifecycle; the passenger view derives a display status
// without touching shared state for DEMO_ACTIVE_RIDE_ID. Falls back to an
// in-memory demo ride so we don't materialize anything into localStorage
// just for rendering. When a simulation/audit URL supplies ?status=,
// the in-memory demo is seeded with SIM_AUDIT_RIDE_OVERRIDES so the
// passenger and driver sides agree on the BD-RIDE-SIM-01 scenario data
// (passenger name, route, price, note) — important for the
// passenger-cancel → driver-canceled flow that needs the same identity
// to be persisted later.
function loadPassengerRideView(tripId, statusQuery) {
  // BD-RIDE-D-10 — Cross-role canonical lookup. Driver and passenger
  // converge on the same persisted record or confirmed-handoff seed
  // for a given tripId. Driver's lifecycle ownership is unchanged —
  // this only ensures the passenger view does not fork the trip
  // identity when only the other role has materialized data.
  let ride = loadCanonicalActiveRide({ tripId, role: 'passenger' });
  // BD-LIFE-05 (Codex P2) — direct entry to /active-ride must also pick up
  // the latest real driverSnapshot so a stale demo seed (DriverMap accept
  // legacy / createDemoActiveRide fallback) cannot render forever as
  // "Рустам К." on reload. The orchestrator is a no-op when no ride exists
  // at this tripId, when no real response is stored for the orderId, when
  // the ride is terminal, or when the persisted ride already matches the
  // pinned response. Mirrors what /responses runs through the same path.
  //
  // BD-RIDE-WAITING-01E Codex P2 hydration repair — upgradeStoredActiveRideForOrder
  // does its own raw findActiveRide() re-read (and, when a snapshot upgrade
  // applies, its own saveActiveRide()), bypassing loadCanonicalActiveRide's
  // legacy-waiting normalizer entirely. Using its return value directly
  // (the old `upgraded !== ride` check) silently reintroduced the pre-v296
  // waiting.remaining/paidStartsAt leak on this hydration path, since a
  // fresh storage read is always a different object reference regardless
  // of whether real upgrade content changed. Re-run loadCanonicalActiveRide
  // after the orchestrator so the final Ride is always normalized —
  // whatever upgradeStoredActiveRideForOrder may have persisted is picked
  // up by this re-read (findActiveRide sees the fresh save), then passed
  // through the normalizer again. `|| upgraded` is a defensive fallback
  // only; loadCanonicalActiveRide should not return null here since a ride
  // already exists at this tripId.
  if (ride && typeof tripId === 'string' && tripId.startsWith('trip_')) {
    const upgraded = upgradeStoredActiveRideForOrder(tripId.slice(5));
    if (upgraded) {
      ride = loadCanonicalActiveRide({ tripId, role: 'passenger' }) || upgraded;
    }
  }
  if (!ride) {
    // BD-RIDE-D-10 — Mirror the driver fallback: when no canonical
    // record exists, use the same SIM_AUDIT demo + driver handoff
    // snapshot enrichment so both roles agree on passenger name,
    // pickup/dropoff, fare and ETA. Not persisted by this function itself,
    // but a subsequent passenger action (cancel, boarding confirmation)
    // can still call saveActiveRide on it — so, symmetrically with the
    // driver-side fallback, mark it local-only simulation provenance
    // whenever it has no real snapshot backing it, and never infer that
    // from tripId shape. Cleared once a successful server read confirms
    // the ride is real (see mergeServerRide below).
    const snapshot = loadDriverHandoffSnapshot(tripId);
    const useSimOverrides = Boolean(statusQuery) || Boolean(snapshot);
    const overrides = useSimOverrides ? SIM_AUDIT_RIDE_OVERRIDES : {};
    ride = createDemoActiveRide({ tripId, ...overrides });
    if (snapshot) {
      ride = applyDriverHandoffSnapshotToRide(ride, snapshot);
    } else {
      ride.localProvenance = 'sim_audit';
    }
  }
  if (ride.status === RIDE_STATUS.NEW_ORDER) {
    return { ...ride, status: RIDE_STATUS.ACCEPTED };
  }
  return ride;
}

// DRIVER_APPROACHING_PICKUP is now a distinct passenger phase — the driver
// is almost at the pickup point. renderEnRouteSheet reuses the same layout
// but swaps the title/sub copy. WAITING_PASSENGER is the BD-RIDE-P-03 driver-arrived
// view. IN_PROGRESS is the BD-RIDE-P-04 on-ride view. Status overrides
// are kept in-memory and do not roll back past later lifecycle
// timestamps already on the ride.
function applyPassengerStatusFromQuery(ride, statusQuery) {
  if (!statusQuery) return ride;
  const ts = ride.timestamps || {};
  if (statusQuery === RIDE_STATUS.ACCEPTED) {
    if (ride.status === RIDE_STATUS.ACCEPTED) return ride;
    if (ts.arrivedAt || ts.startedAt || ts.completedAt || ts.canceledAt) return ride;
    return { ...ride, status: RIDE_STATUS.ACCEPTED };
  }
  if (statusQuery === RIDE_STATUS.DRIVER_EN_ROUTE
    || statusQuery === RIDE_STATUS.DRIVER_APPROACHING_PICKUP) {
    if (ride.status === statusQuery) return ride;
    if (ts.arrivedAt || ts.startedAt || ts.completedAt || ts.canceledAt) {
      return ride;
    }
    // A stale ?status=DRIVER_EN_ROUTE (e.g. an old shared link) must not pull
    // a ride that already advanced to DRIVER_APPROACHING_PICKUP back to the
    // earlier en-route phase. The approaching phase wins once it's persisted.
    if (statusQuery === RIDE_STATUS.DRIVER_EN_ROUTE
      && (ride.status === RIDE_STATUS.DRIVER_APPROACHING_PICKUP || ts.approachingAt)) {
      return ride;
    }
    return { ...ride, status: statusQuery };
  }
  if (statusQuery === RIDE_STATUS.WAITING_PASSENGER) {
    if (ride.status === RIDE_STATUS.WAITING_PASSENGER) return ride;
    if (ts.startedAt || ts.completedAt || ts.canceledAt) return ride;
    return { ...ride, status: RIDE_STATUS.WAITING_PASSENGER };
  }
  if (statusQuery === RIDE_STATUS.IN_PROGRESS) {
    if (ride.status === RIDE_STATUS.IN_PROGRESS) return ride;
    if (ts.completedAt || ts.canceledAt) return ride;
    return { ...ride, status: RIDE_STATUS.IN_PROGRESS };
  }
  if (statusQuery === RIDE_STATUS.COMPLETED) {
    if (ride.status === RIDE_STATUS.COMPLETED) return ride;
    if (ts.canceledAt) return ride;
    return { ...ride, status: RIDE_STATUS.COMPLETED };
  }
  // BD-RIDE-SIM-01 — route the audit URL ?status=CANCELED / NO_SHOW
  // to the existing PASSENGER_STUB_BY_STATUS placeholder so the
  // canceled/no-show fallback is reachable from the simulation links.
  // BD-ACTIVE-05 — do not roll a persisted COMPLETED ride back to the
  // canceled/no-show stub via a query override.
  if (statusQuery === RIDE_STATUS.CANCELED || statusQuery === RIDE_STATUS.NO_SHOW) {
    if (ride.status === statusQuery) return ride;
    if (ts.completedAt) return ride;
    return { ...ride, status: statusQuery };
  }
  return ride;
}

function formatTripNumber(tripId) {
  if (typeof tripId !== 'string' || !tripId) return TRIP_NUMBER_FALLBACK;
  // Demo trip id is human-unfriendly — keep the design's №48-321 in that case.
  if (tripId === DEMO_ACTIVE_RIDE_ID) return TRIP_NUMBER_FALLBACK;
  return `№${tripId}`;
}

function carLine(ride) {
  const v = (ride && ride.vehicle) || {};
  const parts = [];
  const model = v.model || 'Toyota Camry';
  parts.push(model);
  // BD-LIFE-07 — Drop the 'серый' demo fallback. BD-LIFE-06 writes either
  // the real vehicle color or the neutral 'цвет не указан' onto real
  // accepted rides, so the `|| 'серый'` chain only ever fired on
  // legacy/demo paths and was overwriting the real "color not provided"
  // signal with a fabricated grey. Omit the color slot when v.color is
  // missing rather than padding it with demo data.
  if (v.color) parts.push(v.color);
  parts.push(v.plate || 'А 124 ВВ 77');
  return parts.join(' · ');
}

function paymentInfo(ride) {
  const pay = (ride && ride.payment) || {};
  return {
    last4: pay.last4 || '4417',
    method: pay.method || 'Тинькофф',
    note: pay.note || 'Оплата автоматически после поездки',
    amount: pay.amount || (ride && ride.order && ride.order.offerPrice) || '1 480 ₽',
  };
}

function etaText(ride) {
  const eta = (ride && ride.order && ride.order.pickupEta) || '4 мин';
  return eta.replace(/\s*мин(уты?|у)?$/i, ' мин');
}

function toSeconds(mmss) {
  const m = /^(\d+):(\d+)$/.exec(String(mmss || ''));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function inProgressInfo(ride) {
  const r = (ride && ride.ride) || {};
  const route = (ride && ride.route) || {};
  const arrivalTime = r.arrivalTime || '14:32';
  const rawEta = route.etaToDestination || r.etaToDestination || '17 мин';
  const eta = String(rawEta).replace(/\s*мин(уты?|у)?$/i, ' мин').trim();
  return { arrivalTime, eta };
}

function arrivingDropoffInfo(ride) {
  const r = (ride && ride.ride) || {};
  const route = (ride && ride.route) || {};
  const rawEta = route.etaToDropoff || r.etaToDropoff || '1 мин';
  const eta = String(rawEta).replace(/\s*мин(уты?|у)?$/i, ' мин').trim();
  return { eta };
}

// Pick the amount shown in the payment card on the ARRIVING_DROPOFF
// sheet. Prefers an explicit per-phase override, then the regular
// payment amount, then the live ride price, then the original offer.
// Fallback matches the Cloud Design mock so the screen still has a
// believable number when no ride data is wired up.
function arrivingDropoffAmount(ride) {
  const pay = (ride && ride.payment) || {};
  const r = (ride && ride.ride) || {};
  const order = (ride && ride.order) || {};
  return pay.dropoffAmount
    || pay.amount
    || r.price
    || order.offerPrice
    || '1 540 ₽';
}

// BD-RIDE-WAITING-01E — remaining/paidStartsAt are time-dependent values a
// real Ride seed cannot know in advance (see ride_seed.js/ride_actions.js);
// their fallback is an honest '—', not a demo-shaped clock/countdown
// literal. freeLimit/paidRate stay their existing literals — every real
// seed already sets these same values as policy, so the fallback here only
// matters for a genuinely malformed/legacy ride record.
//
// Codex P2-2 repair — when remaining is unknown ('—'), pct must not
// default to 100: that would assert "full free wait time left" for a
// state we actually know nothing about. pct stays null in that case;
// both renderWaitingSheet and its live-refresh counterpart render a
// neutral (non-100%) state instead of a false-full progress bar.
function waitingInfo(ride) {
  const w = (ride && ride.waiting) || {};
  const remaining = w.remaining || '—';
  const freeLimit = w.freeLimit || DEFAULT_FREE_WAIT_LIMIT;
  const paidStartsAt = w.paidStartsAt || '—';
  const paidRate = w.paidRate || DEFAULT_PAID_RATE_LABEL;
  const remSec = toSeconds(remaining);
  const totalSec = toSeconds(freeLimit);
  let pct = null;
  if (remSec != null && totalSec && totalSec > 0) {
    pct = Math.max(0, Math.min(100, Math.round((remSec / totalSec) * 100)));
  }
  return { remaining, freeLimit, paidStartsAt, paidRate, pct };
}

// BD-RIDE-P-02 covers DRIVER_EN_ROUTE; BD-RIDE-P-03 covers WAITING_PASSENGER;
// BD-RIDE-P-04 covers IN_PROGRESS; BD-RIDE-P-05 covers COMPLETED. Other
// passenger-side stages keep a placeholder so we don't show the wrong
// title and actions when the ride has moved on.
const PASSENGER_SUPPORTED_STATUSES = new Set([
  RIDE_STATUS.ACCEPTED,
  RIDE_STATUS.DRIVER_EN_ROUTE,
  RIDE_STATUS.DRIVER_APPROACHING_PICKUP,
  RIDE_STATUS.WAITING_PASSENGER,
  RIDE_STATUS.IN_PROGRESS,
  RIDE_STATUS.COMPLETED,
]);

// Catch-all stub for statuses the passenger UI does not yet render
// (e.g. NEW_ORDER / CONFIRMATION_PENDING). CANCELED and NO_SHOW are
// served by `renderPassengerCanceledFallback`, so they don't appear
// in this table.
const PASSENGER_STUB_BY_STATUS = {};

function renderPassengerStub(message) {
  const root = document.createElement('section');
  root.className = 'screen screen--active-ride';
  const text = message || 'Этот этап поездки будет добавлен позже';
  root.innerHTML = `
    <div class="active-ride__passenger-placeholder" role="status" aria-live="polite">
      <div class="active-ride__passenger-placeholder-text">${escapeHtml(text)}</div>
    </div>
  `;
  return root;
}

function chatLabelFor(ride) {
  const rawUnread = ride.chat && ride.chat.unread;
  const unreadCount = Number.isFinite(Number(rawUnread)) && rawUnread != null
    ? Number(rawUnread)
    : 2;
  const label = unreadCount > 0
    ? `Написать водителю · ${unreadCount} непрочитанных`
    : 'Написать водителю';
  return { unreadCount, label };
}

// BD-RIDE-P-01 — Top driver card overlay shown above the map for the
// in-ride passenger statuses (DRIVER_EN_ROUTE, WAITING_PASSENGER,
// IN_PROGRESS incl. ARRIVING_DROPOFF). Contains driver identity, car,
// rating, status-specific ETA and the two prominent call/message
// actions. The bottom sheet keeps the status-specific slot below.
function topDriverCardEta(ride, phase) {
  if (ride.status === RIDE_STATUS.WAITING_PASSENGER) {
    const w = waitingInfo(ride);
    return { value: w.remaining, label: 'осталось', tone: 'wait' };
  }
  if (ride.status === RIDE_STATUS.IN_PROGRESS) {
    if (phase === PASSENGER_IN_PROGRESS_PHASE.ARRIVING_DROPOFF) {
      const info = arrivingDropoffInfo(ride);
      return { value: info.eta, label: 'до места', tone: 'arriving' };
    }
    const info = inProgressInfo(ride);
    return { value: info.eta, label: 'до места', tone: 'progress' };
  }
  return { value: etaText(ride), label: 'до подачи', tone: 'enroute' };
}

function topDriverCardHtml(ride, options = {}) {
  const driverName = (ride.driver && ride.driver.name) || 'Рустам К.';
  const driverInitials = (ride.driver && ride.driver.initials) || 'РК';
  // BD-LIFE-07 — Drop the '4,92' demo fallback. BD-LIFE-06 writes either
  // the numeric ru-RU rating ("4,95") or the neutral '—' onto real
  // accepted rides, so the `|| '4,92'` chain only ever fired on legacy
  // paths and was substituting the demo rating for real drivers with no
  // recorded value. Render whatever the data layer carries (or empty).
  const driverRating = (ride.driver && ride.driver.rating) || '';
  const { unreadCount, label } = chatLabelFor(ride);
  const eta = topDriverCardEta(ride, options.phase);
  return `
    <div class="active-ride-passenger__top-card" data-tone="${escapeHtml(eta.tone)}">
      <div class="active-ride-passenger__top-card-row">
        <div class="active-ride-passenger__avatar" aria-hidden="true">${escapeHtml(driverInitials)}</div>
        <div class="active-ride-passenger__driver-info">
          <div class="active-ride-passenger__driver-name">
            ${escapeHtml(driverName)}
            <span class="active-ride-passenger__driver-rating">★ ${escapeHtml(driverRating)}</span>
          </div>
          <div class="active-ride-passenger__driver-sub">${escapeHtml(carLine(ride))}</div>
        </div>
        <div class="active-ride-passenger__top-card-eta" aria-label="${escapeHtml(`${eta.value} ${eta.label}`)}">
          <div class="active-ride-passenger__top-card-eta-value" aria-hidden="true">${escapeHtml(eta.value)}</div>
          <div class="active-ride-passenger__top-card-eta-label" aria-hidden="true">${escapeHtml(eta.label)}</div>
        </div>
      </div>
      <div class="active-ride-passenger__top-card-actions">
        <button type="button" class="bd-btn primary active-ride-passenger__top-call" id="arp-top-call" aria-label="Позвонить водителю">
          <span class="active-ride-passenger__btn-ic" aria-hidden="true">${PHONE_SVG}</span>
          Позвонить
        </button>
        <button type="button" class="bd-btn active-ride-passenger__top-message" id="arp-top-chat" aria-label="${escapeHtml(label)}">
          <span class="active-ride-passenger__btn-ic" aria-hidden="true">${MESSAGE_SVG}</span>
          Написать
          ${unreadCount > 0
            ? `<span class="active-ride-passenger__chat-badge active-ride-passenger__chat-badge--inline" aria-hidden="true">${escapeHtml(String(unreadCount))}</span>`
            : ''}
        </button>
      </div>
    </div>
  `;
}

function routeBlockHtml(ride, options = {}) {
  const pickup = (ride.route && ride.route.pickupLabel) || 'ул. Малая Бронная, 28';
  const dropoff = (ride.route && ride.route.dropoffLabel) || 'Аэропорт Шереметьево, терминал В';
  const editable = options.editable !== false;
  const modifier = editable ? '' : ' active-ride-passenger__route--locked';
  const editBtn = editable
    ? `<button type="button" class="active-ride-passenger__route-edit" id="arp-edit-route" aria-label="Изменить маршрут">
        ${PENCIL_SVG}
      </button>`
    : '';
  return `
    <div class="active-ride-passenger__route${modifier}">
      <ul class="active-ride-passenger__route-list" role="list">
        <li class="active-ride-passenger__route-point active-ride-passenger__route-point--pickup">
          <div class="active-ride-passenger__route-label">ОТКУДА</div>
          <div class="active-ride-passenger__route-main">${escapeHtml(pickup)}</div>
        </li>
        <li class="active-ride-passenger__route-point active-ride-passenger__route-point--dropoff">
          <div class="active-ride-passenger__route-label">КУДА</div>
          <div class="active-ride-passenger__route-main">${escapeHtml(dropoff)}</div>
        </li>
      </ul>
      ${editBtn}
    </div>
  `;
}

// options.amountOverride — optional string used in place of the default
// payment amount (e.g. a phase-specific tally on the ARRIVING_DROPOFF
// sheet). Falsy values fall through to `paymentInfo(ride).amount`.
function paymentBlockHtml(ride, options = {}) {
  const pay = paymentInfo(ride);
  if (options.amountOverride) pay.amount = options.amountOverride;
  return `
    <div class="active-ride-passenger__payment" role="group" aria-label="Способ оплаты">
      <div class="active-ride-passenger__payment-icon" aria-hidden="true">${CARD_SVG}</div>
      <div class="active-ride-passenger__payment-body">
        <div class="active-ride-passenger__payment-title">•• ${escapeHtml(pay.last4)} · ${escapeHtml(pay.method)}</div>
        <div class="active-ride-passenger__payment-note">${escapeHtml(pay.note)}</div>
      </div>
      <div class="active-ride-passenger__payment-amount">${escapeHtml(pay.amount)}</div>
      <div class="active-ride-passenger__payment-chevron" aria-hidden="true">${CHEVRON_RIGHT_SVG}</div>
    </div>
  `;
}

function renderEnRouteSheet(sheet, ride) {
  let title = 'Водитель едет к вам';
  let subHtml = '';
  if (ride.status === RIDE_STATUS.ACCEPTED) {
    title = 'Водитель назначен';
  } else if (ride.status === RIDE_STATUS.DRIVER_APPROACHING_PICKUP) {
    title = 'Водитель почти на месте';
    subHtml = `<div class="active-ride-passenger__sub">Выходите к точке подачи</div>`;
  }
  sheet.innerHTML = `
    <div class="active-ride-passenger__handle" aria-hidden="true"></div>

    <div class="active-ride-passenger__header">
      <div class="active-ride-passenger__header-main">
        <div class="active-ride-passenger__title">${escapeHtml(title)}</div>
        <div class="active-ride-passenger__car">${escapeHtml(carLine(ride))}</div>
        ${subHtml}
      </div>
    </div>

    ${routeBlockHtml(ride)}
    ${paymentBlockHtml(ride)}

    <div class="active-ride-passenger__primary-actions">
      <button type="button" class="bd-btn ghost active-ride-passenger__btn-sec" id="arp-refine">
        <span class="active-ride-passenger__btn-ic" aria-hidden="true">${PIN_SVG}</span>
        Уточнить место
      </button>
      <button type="button" class="bd-btn ghost active-ride-passenger__btn-cancel" id="arp-cancel">Отменить</button>
    </div>

    <div class="active-ride-passenger__secondary-actions">
      <button type="button" class="bd-btn ghost active-ride-passenger__btn-sos" id="arp-sos">
        <span class="active-ride-passenger__btn-ic" aria-hidden="true">${SOS_SVG}</span>
        SOS
      </button>
      <button type="button" class="bd-btn ghost active-ride-passenger__btn-share" id="arp-share">
        <span class="active-ride-passenger__btn-ic" aria-hidden="true">${SHARE_SVG}</span>
        Поделиться поездкой
      </button>
    </div>
  `;
}

function renderWaitingSheet(sheet, ride) {
  const w = waitingInfo(ride);
  sheet.innerHTML = `
    <div class="active-ride-passenger__handle" aria-hidden="true"></div>

    <div class="active-ride-passenger__header">
      <div class="active-ride-passenger__header-main">
        <div class="active-ride-passenger__title">Водитель ждёт вас</div>
        <div class="active-ride-passenger__sub">Бесплатное ожидание заканчивается через</div>
      </div>
      <div class="active-ride-passenger__waiting-badge" aria-label="Осталось бесплатного ожидания">
        <div class="active-ride-passenger__waiting-badge-value">${escapeHtml(w.remaining)}</div>
        <div class="active-ride-passenger__waiting-badge-label">осталось</div>
      </div>
    </div>

    <div class="active-ride-passenger__waiting-card">
      <div class="active-ride-passenger__waiting-card-head">
        <span class="active-ride-passenger__waiting-card-title">Бесплатное ожидание</span>
        <span class="active-ride-passenger__waiting-card-value">${escapeHtml(w.remaining)} / ${escapeHtml(w.freeLimit)}</span>
      </div>
      <div class="active-ride-passenger__progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"${w.pct == null ? '' : ` aria-valuenow="${w.pct}"`}>
        <div class="active-ride-passenger__progress-bar-fill" data-step="${w.pct == null ? 0 : Math.round(w.pct / 10)}"></div>
      </div>
      <div class="active-ride-passenger__waiting-card-foot">Дальше — ${escapeHtml(w.paidRate)} · с ${escapeHtml(w.paidStartsAt)}</div>
    </div>

    ${routeBlockHtml(ride)}
    ${paymentBlockHtml(ride)}

    <button type="button" class="bd-btn primary active-ride-passenger__cta-primary" id="arp-boarded">
      <span class="active-ride-passenger__btn-ic" aria-hidden="true">${CHECK_SVG}</span>
      Я в машине — поехали
    </button>

    <!-- BD-RIDE-P-06 polish — cancel affordance is allowed during
         WAITING_PASSENGER so the passenger can still bail out before
         boarding without bouncing back to the en-route sheet. -->
    <div class="active-ride-passenger__primary-actions active-ride-passenger__primary-actions--cancel-only">
      <button type="button" class="bd-btn ghost active-ride-passenger__btn-cancel" id="arp-cancel">Отменить</button>
    </div>

    <div class="active-ride-passenger__secondary-actions">
      <button type="button" class="bd-btn ghost active-ride-passenger__btn-sos" id="arp-sos">
        <span class="active-ride-passenger__btn-ic" aria-hidden="true">${SOS_SVG}</span>
        SOS
      </button>
      <button type="button" class="bd-btn ghost active-ride-passenger__btn-share" id="arp-share">
        <span class="active-ride-passenger__btn-ic" aria-hidden="true">${SHARE_SVG}</span>
        Поделиться поездкой
      </button>
    </div>
  `;
}

function renderInProgressSheet(sheet, ride) {
  const info = inProgressInfo(ride);
  sheet.innerHTML = `
    <div class="active-ride-passenger__handle" aria-hidden="true"></div>

    <div class="active-ride-passenger__header">
      <div class="active-ride-passenger__header-main">
        <div class="active-ride-passenger__title">В пути</div>
        <div class="active-ride-passenger__sub">Расчётное время прибытия ${escapeHtml(info.arrivalTime)}</div>
      </div>
    </div>

    ${routeBlockHtml(ride, { editable: false })}
    ${paymentBlockHtml(ride)}

    <div class="active-ride-passenger__in-progress-actions">
      <button type="button" class="bd-btn ghost active-ride-passenger__btn-stop" id="arp-add-stop">
        <span class="active-ride-passenger__btn-ic" aria-hidden="true">${PLUS_SVG}</span>
        Добавить остановку
      </button>
      <button type="button" class="active-ride-passenger__icon-action active-ride-passenger__btn-share-square" id="arp-share-square" aria-label="Поделиться поездкой">
        ${SHARE_SVG}
      </button>
    </div>

    <div class="active-ride-passenger__secondary-actions">
      <button type="button" class="bd-btn ghost active-ride-passenger__btn-sos" id="arp-sos">
        <span class="active-ride-passenger__btn-ic" aria-hidden="true">${SOS_SVG}</span>
        SOS
      </button>
      <button type="button" class="bd-btn ghost active-ride-passenger__btn-share" id="arp-share">
        <span class="active-ride-passenger__btn-ic" aria-hidden="true">${SHARE_SVG}</span>
        Поделиться поездкой
      </button>
    </div>
  `;
}

function renderArrivingDropoffSheet(sheet, ride) {
  const info = arrivingDropoffInfo(ride);
  sheet.innerHTML = `
    <div class="active-ride-passenger__handle" aria-hidden="true"></div>

    <div class="active-ride-passenger__header">
      <div class="active-ride-passenger__header-main">
        <div class="active-ride-passenger__title">Прибываем</div>
        <div class="active-ride-passenger__sub">Подъезжаем к точке высадки</div>
      </div>
    </div>

    ${routeBlockHtml(ride, { editable: false })}
    ${paymentBlockHtml(ride, { amountOverride: arrivingDropoffAmount(ride) })}

    <button type="button" class="bd-btn primary active-ride-passenger__cta-primary" id="arp-finish-rate">
      Завершить и оценить поездку
    </button>

    <div class="active-ride-passenger__secondary-actions">
      <button type="button" class="bd-btn ghost active-ride-passenger__btn-sos" id="arp-sos">
        <span class="active-ride-passenger__btn-ic" aria-hidden="true">${SOS_SVG}</span>
        SOS
      </button>
      <button type="button" class="bd-btn ghost active-ride-passenger__btn-share" id="arp-share">
        <span class="active-ride-passenger__btn-ic" aria-hidden="true">${SHARE_SVG}</span>
        Поделиться поездкой
      </button>
    </div>
  `;
}

// BD-RIDE-P-05 — Passenger COMPLETED. Mock/UI only.
const COMPLETE_RATING_TAGS = [
  'Вежливый водитель',
  'Чистый салон',
  'Быстрая подача',
  'Комфортная поездка',
  'Хороший маршрут',
];

function formatCompletedAt(ride) {
  const ts = ride && ride.timestamps && ride.timestamps.completedAt;
  if (ts) {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) {
      const hh = d.getHours() < 10 ? `0${d.getHours()}` : String(d.getHours());
      const mm = d.getMinutes() < 10 ? `0${d.getMinutes()}` : String(d.getMinutes());
      return `${hh}:${mm}`;
    }
  }
  return (ride && ride.ride && ride.ride.arrivalTime) || '14:34';
}

function completedStats(ride) {
  const order = (ride && ride.order) || {};
  const route = (ride && ride.route) || {};
  const r = (ride && ride.ride) || {};
  const time = r.duration || order.destinationEta || '42 мин';
  const distance = r.distance || order.destinationDistance || '38 км';
  const completedAt = formatCompletedAt(ride);
  return { time, distance, completedAt };
}

function completedPaymentInfo(ride) {
  const base = paymentInfo(ride);
  const total = arrivingDropoffAmount(ride);
  return {
    last4: base.last4,
    method: base.method,
    total,
  };
}

// STAR_FULL_SVG / STAR_EMPTY_SVG are inlined per-screen so the rating
// widget can swap between filled and outlined stars without touching
// element styles directly.
const STAR_FULL_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="32" height="32">
  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
</svg>`;

const STAR_EMPTY_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="32" height="32">
  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
</svg>`;

const ALERT_TRI_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="16" height="16">
  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
  <line x1="12" y1="9" x2="12" y2="13"/>
  <line x1="12" y1="17" x2="12.01" y2="17"/>
</svg>`;

const RECEIPT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="14" height="14">
  <path d="M14 2H6a2 2 0 0 0-2 2v16l3-2 3 2 3-2 3 2V8z"/>
  <polyline points="14 2 14 8 20 8"/>
</svg>`;

const SPARKLE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>
</svg>`;

const ARROW_RIGHT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <line x1="5" y1="12" x2="19" y2="12"/>
  <polyline points="12 5 19 12 12 19"/>
</svg>`;

const SPINNER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" width="14" height="14">
  <circle cx="12" cy="12" r="9" stroke-opacity="0.25"/>
  <path d="M21 12a9 9 0 0 1-9 9"/>
</svg>`;

const CLOSE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
  <line x1="18" y1="6" x2="6" y2="18"/>
  <line x1="6" y1="6" x2="18" y2="18"/>
</svg>`;

const COIN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
  <circle cx="12" cy="12" r="9"/>
  <path d="M14 9.5c-.5-1-1.6-1.5-2.6-1.5-1.4 0-2.4.7-2.4 2 0 1 .6 1.5 2 1.8l1 .2c1.4.3 2 1 2 2 0 1.4-1 2-2.6 2-1.2 0-2.2-.5-2.7-1.5"/>
  <line x1="12" y1="6.5" x2="12" y2="17.5"/>
</svg>`;

const CAR_REPORT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
  <path d="M3 12l2-5h14l2 5"/>
  <path d="M3 12v6h2v2h3v-2h8v2h3v-2h2v-6"/>
  <line x1="3" y1="12" x2="21" y2="12"/>
  <circle cx="7" cy="15" r="1.2"/>
  <circle cx="17" cy="15" r="1.2"/>
</svg>`;

const HEART_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l8.84 8.84 8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/>
</svg>`;

const INFO_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
  <circle cx="12" cy="12" r="10"/>
  <line x1="12" y1="16" x2="12" y2="12"/>
  <line x1="12" y1="8" x2="12.01" y2="8"/>
</svg>`;

const REPORT_REASONS = [
  { id: 'price',    label: 'Неверная стоимость',     icon: COIN_SVG },
  { id: 'route',    label: 'Странный маршрут',       icon: PIN_SVG },
  { id: 'driver',   label: 'Поведение водителя',     icon: PHONE_SVG },
  { id: 'car',      label: 'Состояние автомобиля',   icon: CAR_REPORT_SVG },
  { id: 'lost',     label: 'Забыл вещи в машине',    icon: HEART_SVG },
  { id: 'other',    label: 'Другое',                 icon: INFO_SVG },
];

const PAYMENT_STATES = new Set(['auto', 'pending', 'paid']);
function normalizePayment(value) {
  if (typeof value !== 'string') return 'auto';
  const v = value.trim().toLowerCase();
  return PAYMENT_STATES.has(v) ? v : 'auto';
}

function renderPassengerRideComplete(ride, deps) {
  const { go: navigate, toast, paymentStatus } = deps;
  // The COMPLETED screen tracks two independent UI axes:
  //   data-submitted = "false" | "true"      — rating thank-you flag
  //   data-payment   = "auto"  | "pending"   — charge lifecycle
  //                  | "paid"
  //
  // Matrix the design uses:
  //   submitted=false, payment=auto    — default after ride finish
  //   submitted=false, payment=pending — list/pulse during charge (State 5)
  //   submitted=false, payment=paid    — charge settled, rating still
  //                                      a draft (State 6 — чек готов)
  //   submitted=true,  payment=paid    — thank-you (State 4)
  //
  // Submitting the rating flips both flags; `?payment=` lets QA jump
  // straight to the pending/paid presentations without a real charge.
  const initialPayment = normalizePayment(paymentStatus);
  const stats = completedStats(ride);
  const pay = completedPaymentInfo(ride);
  const route = (ride && ride.route) || {};
  const pickup = route.pickupLabel || 'ул. Малая Бронная, 28';
  const dropoff = route.dropoffLabel || 'Аэропорт Шереметьево, терминал В';
  const driverName = (ride.driver && ride.driver.name) || 'Рустам К.';
  const driverInitials = (ride.driver && ride.driver.initials) || 'РК';
  // BD-LIFE-07 — Drop the '4,92' demo fallback. BD-LIFE-06 writes either
  // the numeric ru-RU rating ("4,95") or the neutral '—' onto real
  // accepted rides, so the `|| '4,92'` chain only ever fired on legacy
  // paths and was substituting the demo rating for real drivers with no
  // recorded value. Render whatever the data layer carries (or empty).
  const driverRating = (ride.driver && ride.driver.rating) || '';
  const carText = carLine(ride);

  const root = document.createElement('section');
  root.className = 'screen screen--active-ride active-ride-passenger active-ride-passenger--complete';

  const top = document.createElement('div');
  top.className = 'active-ride__top active-ride-passenger__top';
  top.innerHTML = `
    <div class="active-ride-passenger__top-row">
      <button type="button" class="bd-iconbtn active-ride__icon-btn active-ride-passenger__chevron" id="arp-collapse" aria-label="Свернуть">
        ${CHEVRON_UP_SVG}
      </button>
      <div class="active-ride-passenger__trip-pill" role="status" aria-live="polite">
        <span class="active-ride-passenger__trip-label">Поездка ${escapeHtml(formatTripNumber(ride.tripId))}</span>
      </div>
      <button type="button" class="bd-iconbtn active-ride__icon-btn active-ride-passenger__shield" id="arp-shield" aria-label="Безопасность">
        ${SHIELD_SVG}
      </button>
    </div>
  `;
  root.appendChild(top);

  const tagsHtml = COMPLETE_RATING_TAGS
    .map((label) => `
      <button type="button"
        class="passenger-complete__tag"
        data-tag="${escapeHtml(label)}"
        aria-pressed="false">${escapeHtml(label)}</button>
    `)
    .join('');

  const starsHtml = [1, 2, 3, 4, 5]
    .map((value) => `
      <button type="button"
        class="passenger-complete__star"
        data-star="${value}"
        aria-label="Поставить ${value} звезды"
        aria-pressed="false">
        <span class="passenger-complete__star-full" aria-hidden="true">${STAR_FULL_SVG}</span>
        <span class="passenger-complete__star-empty" aria-hidden="true">${STAR_EMPTY_SVG}</span>
      </button>
    `)
    .join('');

  const content = document.createElement('div');
  content.className = 'passenger-complete__scroll';
  content.dataset.submitted = 'false';
  // Payment lifecycle is tracked independently of the rating submitted
  // flag so the pending → paid transition doesn't force a rating
  // change. Default is `auto` (before charge); `?payment=pending`
  // surfaces the in-flight charge state for QA; submit sets `paid`.
  content.dataset.payment = initialPayment;
  // Report entry is another independent UI axis: opens an inline
  // report sheet over the same scroll container without changing
  // route or rating/payment state.
  content.dataset.report = 'closed';
  content.innerHTML = `
    <div class="passenger-complete__hero">
      <div class="passenger-complete__check" aria-hidden="true">
        ${CHECK_SVG}
      </div>
      <div class="passenger-complete__hero-title" data-default-only>Поездка завершена</div>
      <div class="passenger-complete__hero-title" data-submitted-only>Спасибо за отзыв</div>
      <div class="passenger-complete__hero-sub" data-default-only data-pay-show="auto">
        Спасибо за поездку. Оплата спишется автоматически.
      </div>
      <div class="passenger-complete__hero-sub" data-default-only data-pay-show="pending">
        Спасибо за поездку. Списываем оплату с карты…
      </div>
      <div class="passenger-complete__hero-sub" data-default-only data-pay-show="paid">
        Спасибо за поездку. Оплата успешно прошла.
      </div>
      <div class="passenger-complete__hero-sub" data-submitted-only>
        Ваша оценка отправлена водителю. Хорошей дороги!
      </div>
    </div>

    <div class="passenger-complete__card passenger-complete__pay">
      <div class="passenger-complete__pay-head">
        <div class="passenger-complete__pay-label">Итого к оплате</div>
        <span class="passenger-complete__auto-badge" data-pay-show="auto">Авто-оплата</span>
        <span class="passenger-complete__pending-badge" data-pay-show="pending">
          <span class="passenger-complete__pending-ic" aria-hidden="true">${SPINNER_SVG}</span>
          Списание...
        </span>
        <span class="passenger-complete__paid-badge" data-pay-show="paid">
          <span class="passenger-complete__paid-ic" aria-hidden="true">${CHECK_SVG}</span>
          Оплачено
        </span>
      </div>
      <div class="passenger-complete__pay-total">${escapeHtml(pay.total)}</div>
      <div class="passenger-complete__pay-method">
        <div class="passenger-complete__pay-icon" aria-hidden="true">${CARD_SVG}</div>
        <div class="passenger-complete__pay-method-body">
          <div class="passenger-complete__pay-method-title">•• ${escapeHtml(pay.last4)} · ${escapeHtml(pay.method)}</div>
          <div class="passenger-complete__pay-method-note" data-pay-show="auto">Оплата автоматически после поездки</div>
          <div class="passenger-complete__pay-method-note" data-pay-show="pending">Списываем сумму с карты...</div>
          <div class="passenger-complete__pay-method-note" data-pay-show="paid">Списано · сегодня в ${escapeHtml(stats.completedAt)}</div>
        </div>
        <div class="passenger-complete__pay-method-chevron" aria-hidden="true">${CHEVRON_RIGHT_SVG}</div>
      </div>
      <div class="passenger-complete__pay-disclosure">Итог к оплате — без учёта комиссии сервиса</div>
      <div class="passenger-complete__pay-warning" data-pay-show="pending" role="status">
        <span class="passenger-complete__pay-warning-ic" aria-hidden="true">${ALERT_TRI_SVG}</span>
        Ожидается подтверждение оплаты — обычно занимает меньше минуты
      </div>
      <div class="passenger-complete__receipt-note" data-pay-show="auto pending">
        <span class="passenger-complete__receipt-ic" aria-hidden="true">${RECEIPT_SVG}</span>
        <span class="passenger-complete__receipt-note-text">Чек будет доступен после оплаты</span>
        <button type="button" class="passenger-complete__receipt-action" data-action="view-receipt" disabled>Посмотреть чек</button>
      </div>
      <div class="passenger-complete__receipt-ready" data-pay-show="paid">
        <span class="passenger-complete__receipt-ic" aria-hidden="true">${RECEIPT_SVG}</span>
        <span class="passenger-complete__receipt-ready-text">Чек готов</span>
        <button type="button" class="passenger-complete__receipt-action" id="arp-receipt-view" data-action="view-receipt" aria-label="Посмотреть чек">Посмотреть чек</button>
      </div>
    </div>

    <div class="passenger-complete__stats" role="group" aria-label="Статистика поездки">
      <div class="passenger-complete__stat">
        <div class="passenger-complete__stat-label">Время</div>
        <div class="passenger-complete__stat-value">${escapeHtml(stats.time)}</div>
      </div>
      <div class="passenger-complete__stat">
        <div class="passenger-complete__stat-label">Расстояние</div>
        <div class="passenger-complete__stat-value">${escapeHtml(stats.distance)}</div>
      </div>
      <div class="passenger-complete__stat">
        <div class="passenger-complete__stat-label">Завершено</div>
        <div class="passenger-complete__stat-value">${escapeHtml(stats.completedAt)}</div>
      </div>
    </div>

    <div class="passenger-complete__card passenger-complete__route">
      <ul class="active-ride-passenger__route-list" role="list">
        <li class="active-ride-passenger__route-point active-ride-passenger__route-point--pickup">
          <div class="active-ride-passenger__route-label">ОТКУДА</div>
          <div class="active-ride-passenger__route-main">${escapeHtml(pickup)}</div>
        </li>
        <li class="active-ride-passenger__route-point active-ride-passenger__route-point--dropoff">
          <div class="active-ride-passenger__route-label">КУДА</div>
          <div class="active-ride-passenger__route-main">${escapeHtml(dropoff)}</div>
        </li>
      </ul>
    </div>

    <div class="passenger-complete__driver-section">
      <div class="passenger-complete__section-label">ВОДИТЕЛЬ</div>
      <div class="passenger-complete__card passenger-complete__driver">
        <div class="active-ride-passenger__avatar" aria-hidden="true">${escapeHtml(driverInitials)}</div>
        <div class="active-ride-passenger__driver-info">
          <div class="active-ride-passenger__driver-name">
            ${escapeHtml(driverName)}
            <span class="active-ride-passenger__driver-rating">★ ${escapeHtml(driverRating)}</span>
          </div>
          <div class="active-ride-passenger__driver-sub">${escapeHtml(carText)}</div>
        </div>
        <div class="active-ride-passenger__driver-actions">
          <button type="button" class="active-ride-passenger__icon-action" id="arp-chat" aria-label="Написать водителю">
            ${MESSAGE_SVG}
          </button>
          <button type="button" class="active-ride-passenger__icon-action" id="arp-call" aria-label="Позвонить водителю">
            ${PHONE_SVG}
          </button>
        </div>
      </div>
    </div>

    <div class="passenger-complete__rating-section" data-hide-when-report>
      <div class="passenger-complete__section-label" data-default-only>ОЦЕНИТЕ ПОЕЗДКУ</div>
      <div class="passenger-complete__section-label" data-submitted-only>ВАША ОЦЕНКА</div>
      <div class="passenger-complete__card passenger-complete__rating" id="arp-rating-card" data-rating="0" data-default-only>
        <div class="passenger-complete__stars" role="radiogroup" aria-label="Оценка поездки">
          ${starsHtml}
        </div>
        <div class="passenger-complete__tags" role="group" aria-label="Что понравилось">
          ${tagsHtml}
        </div>
        <button type="button" class="passenger-complete__comment" id="arp-comment">
          <span class="passenger-complete__comment-ic" aria-hidden="true">${PENCIL_SVG}</span>
          Добавить комментарий
        </button>
        <div class="passenger-complete__comment-field" id="arp-comment-field" hidden>
          <textarea
            class="passenger-complete__comment-input"
            id="arp-comment-input"
            maxlength="200"
            rows="3"
            aria-label="Комментарий к поездке"
            placeholder="Комментарий (необязательно)"></textarea>
          <div class="passenger-complete__comment-foot">
            <span class="passenger-complete__comment-helper">Виден только поддержке</span>
            <span class="passenger-complete__comment-counter" id="arp-comment-counter" aria-live="polite">0/200</span>
          </div>
        </div>
      </div>
      <div class="passenger-complete__card passenger-complete__rating-submitted" id="arp-rating-submitted" data-submitted-only>
        <div class="passenger-complete__submitted-head">
          <span class="passenger-complete__submitted-ic" aria-hidden="true">${SPARKLE_SVG}</span>
          <span class="passenger-complete__submitted-title">Ваш отзыв отправлен</span>
        </div>
        <div class="passenger-complete__submitted-stars" id="arp-submitted-stars" role="img" aria-label="Вы поставили 5 звёзд">
          ${[1, 2, 3, 4, 5].map(() => `
            <span class="passenger-complete__submitted-star" data-filled="true">
              <span class="passenger-complete__star-full" aria-hidden="true">${STAR_FULL_SVG}</span>
              <span class="passenger-complete__star-empty" aria-hidden="true">${STAR_EMPTY_SVG}</span>
            </span>
          `).join('')}
        </div>
        <div class="passenger-complete__submitted-note">
          Спасибо! Это помогает делать поездки лучше.
        </div>
      </div>
    </div>

    <div class="passenger-complete__report-sheet" id="arp-report-sheet" data-report-only>
      <div class="passenger-complete__report-head">
        <div class="passenger-complete__report-title">Сообщить о проблеме</div>
        <button type="button" class="passenger-complete__report-close" id="arp-report-close" aria-label="Закрыть">
          ${CLOSE_SVG}
        </button>
      </div>
      <div class="passenger-complete__report-desc" data-report-stage-select>
        Выберите, что произошло — поддержка свяжется в течение часа
      </div>
      <ul class="passenger-complete__report-list" role="radiogroup" aria-label="Причина обращения" data-report-stage-select>
        ${REPORT_REASONS.map((r) => `
          <li>
            <button type="button" class="passenger-complete__report-reason" role="radio" aria-checked="false" data-reason="${escapeHtml(r.id)}">
              <span class="passenger-complete__report-ic" aria-hidden="true">${r.icon}</span>
              <span class="passenger-complete__report-reason-text">${escapeHtml(r.label)}</span>
              <span class="passenger-complete__report-radio" aria-hidden="true"></span>
            </button>
          </li>
        `).join('')}
      </ul>
      <div class="passenger-complete__report-done" data-report-stage-submitted role="status" aria-live="polite">
        <div class="passenger-complete__report-done-ic" aria-hidden="true">${CHECK_SVG}</div>
        <div class="passenger-complete__report-done-title">Жалоба отправлена</div>
        <div class="passenger-complete__report-done-meta">Поддержка свяжется в течение часа.</div>
      </div>
    </div>

    <button type="button" class="bd-btn primary passenger-complete__cta" id="arp-submit-rating" data-default-only data-hide-when-report disabled>
      <span class="passenger-complete__cta-ic" aria-hidden="true">${STAR_FULL_SVG}</span>
      Поставить оценку
    </button>
    <button type="button" class="bd-btn primary passenger-complete__cta passenger-complete__cta--return" id="arp-return-feed" data-submitted-only data-hide-when-report>
      <span class="passenger-complete__cta-ic" aria-hidden="true">${ARROW_RIGHT_SVG}</span>
      Вернуться в ленту
    </button>
    <button type="button" class="bd-btn primary passenger-complete__cta" id="arp-report-submit" data-report-only data-report-stage-select disabled>
      Отправить жалобу
    </button>
    <button type="button" class="bd-btn primary passenger-complete__cta passenger-complete__cta--return" id="arp-report-return" data-report-only data-report-stage-submitted>
      <span class="passenger-complete__cta-ic" aria-hidden="true">${ARROW_RIGHT_SVG}</span>
      Вернуться в ленту
    </button>

    <div class="passenger-complete__bottom-actions">
      <button type="button" class="bd-btn passenger-complete__bottom-btn" id="arp-open-chat">
        <span class="passenger-complete__bottom-btn-ic" aria-hidden="true">${MESSAGE_SVG}</span>
        Открыть чат
      </button>
      <button type="button" class="bd-btn passenger-complete__bottom-btn" id="arp-to-feed">
        <span class="passenger-complete__bottom-btn-ic" aria-hidden="true">${SHARE_SVG}</span>
        В ленту
      </button>
    </div>

    <div class="passenger-complete__history-row" data-history-saved="false">
      <div class="passenger-complete__history-note" role="status" aria-live="polite">
        <span class="passenger-complete__history-note-ic" aria-hidden="true">${CHECK_SVG}</span>
        <span class="passenger-complete__history-note-text">Поездка сохранена в историю</span>
      </div>
      <div class="passenger-complete__history-actions">
        <button type="button" class="bd-btn passenger-complete__bottom-btn" id="arp-to-history">
          <span class="passenger-complete__bottom-btn-ic" aria-hidden="true">${RECEIPT_SVG}</span>
          В историю поездок
        </button>
        <button type="button" class="bd-btn passenger-complete__bottom-btn" id="arp-to-home">
          <span class="passenger-complete__bottom-btn-ic" aria-hidden="true">${ARROW_RIGHT_SVG}</span>
          На главную
        </button>
      </div>
    </div>

    <button type="button" class="passenger-complete__report" id="arp-report" data-hide-when-report>
      <span class="passenger-complete__report-trigger-ic" aria-hidden="true">${ALERT_TRI_SVG}</span>
      Сообщить о проблеме
    </button>
  `;
  root.appendChild(content);

  const notice = document.createElement('div');
  notice.className = 'active-ride__notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.hidden = true;
  root.appendChild(notice);

  let noticeTimer = null;
  function localToast(msg) {
    if (toast) { toast(msg); return; }
    notice.textContent = msg;
    notice.hidden = false;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 3500);
  }

  // ── Top handlers ─────────────────────────────────────────
  top.querySelector('#arp-collapse').addEventListener('click', () => {
    localToast('Сворачивание панели будет добавлено позже');
  });
  top.querySelector('#arp-shield').addEventListener('click', () => {
    openPassengerSafetySheet(root, { toast: localToast, ride, tripLabel: formatTripNumber(ride.tripId) });
  });

  // ── Rating widget ────────────────────────────────────────
  const ratingCard = content.querySelector('#arp-rating-card');
  const starButtons = Array.from(content.querySelectorAll('.passenger-complete__star'));
  const tagButtons = Array.from(content.querySelectorAll('.passenger-complete__tag'));
  const submitBtn = content.querySelector('#arp-submit-rating');
  let currentRating = 0;
  const selectedTags = new Set();

  function applyRating(value) {
    currentRating = value;
    ratingCard.dataset.rating = String(value);
    starButtons.forEach((btn) => {
      const star = Number(btn.dataset.star);
      const filled = star <= value;
      btn.dataset.filled = filled ? 'true' : 'false';
      btn.setAttribute('aria-pressed', filled ? 'true' : 'false');
    });
    submitBtn.disabled = value === 0;
  }

  starButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const star = Number(btn.dataset.star);
      // Tap the same star again to clear the rating back to 0 — gives
      // a one-tap escape hatch when the passenger taps the wrong star
      // and avoids the surprising "5 → 4 → 3 …" decrement that the
      // earlier `star - 1` form caused.
      applyRating(star === currentRating ? 0 : star);
    });
  });

  tagButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      const pressed = btn.getAttribute('aria-pressed') === 'true';
      if (pressed) {
        selectedTags.delete(tag);
        btn.setAttribute('aria-pressed', 'false');
      } else {
        selectedTags.add(tag);
        btn.setAttribute('aria-pressed', 'true');
      }
    });
  });

  // ── Comment field (expand on demand) ─────────────────────
  // Toggling chips or stars must not collapse this — both handlers
  // above only touch their own elements, so the textarea state is
  // preserved across rating/tag interactions.
  const commentBtn = content.querySelector('#arp-comment');
  const commentField = content.querySelector('#arp-comment-field');
  const commentInput = content.querySelector('#arp-comment-input');
  const commentCounter = content.querySelector('#arp-comment-counter');
  const COMMENT_MAX = 200;

  function openComment() {
    commentBtn.hidden = true;
    commentField.hidden = false;
    commentInput.focus();
  }
  commentBtn.addEventListener('click', openComment);

  commentInput.addEventListener('input', () => {
    // Native maxlength caps input at 200, so length is always safe here.
    commentCounter.textContent = `${commentInput.value.length}/${COMMENT_MAX}`;
  });

  // ── Submitted state (Rating submitted — спасибо) ────────
  // Toggle is driven by `content.dataset.submitted`; CSS hides
  // [data-default-only] / [data-submitted-only] accordingly so we
  // don't need to remove or rebuild any DOM nodes.
  const submittedStars = Array.from(
    content.querySelectorAll('#arp-submitted-stars .passenger-complete__submitted-star')
  );
  const submittedStarsHost = content.querySelector('#arp-submitted-stars');
  function syncSubmittedStars(value) {
    submittedStars.forEach((node, idx) => {
      node.dataset.filled = (idx + 1) <= value ? 'true' : 'false';
    });
    // Keep the a11y label in sync so screen readers announce the
    // rating the passenger actually submitted, not a hard-coded 5.
    if (submittedStarsHost) {
      submittedStarsHost.setAttribute(
        'aria-label',
        `Вы поставили ${value} ${value === 1 ? 'звезду' : value < 5 ? 'звезды' : 'звёзд'}`
      );
    }
  }
  submitBtn.addEventListener('click', () => {
    if (currentRating === 0) return;
    syncSubmittedStars(currentRating);
    content.dataset.submitted = 'true';
    // Submitting the rating implies the auto-charge has completed
    // by the time we render the thank-you screen.
    content.dataset.payment = 'paid';
    submitBtn.disabled = true;
    // Disable underlying editable controls so a hidden tab/keyboard
    // user can't keep editing fields that the UI no longer shows.
    starButtons.forEach((b) => { b.disabled = true; });
    tagButtons.forEach((b) => { b.disabled = true; });
    if (commentInput) commentInput.disabled = true;
    if (commentBtn) commentBtn.disabled = true;
    // Merge rating, tags and comment into the persisted history entry
    // alongside the baseline that was saved when the screen rendered.
    persistHistory({ withRating: true });
    // Move focus to the new primary CTA for keyboard users.
    const returnBtn = content.querySelector('#arp-return-feed');
    if (returnBtn) returnBtn.focus();
  });

  const returnFeedBtn = content.querySelector('#arp-return-feed');
  if (returnFeedBtn) {
    returnFeedBtn.addEventListener('click', () => {
      navigate('/feed');
    });
  }

  const receiptViewBtn = content.querySelector('#arp-receipt-view');
  if (receiptViewBtn) {
    receiptViewBtn.addEventListener('click', () => {
      // No passenger receipt screen exists yet — the /receipt route is the
      // driver financial document (net/commission), so keep this UI-only.
      localToast('Просмотр чека будет доступен позже');
    });
  }

  // ── Driver card actions ──────────────────────────────────
  const chatIconBtn = content.querySelector('#arp-chat');
  const callBtn = content.querySelector('#arp-call');
  function openChat() {
    // Existing chat route is registered at /chat; if it isn't available
    // for any reason the toast keeps the UI silent instead of throwing.
    try {
      navigate(`/chat?tripId=${encodeURIComponent(ride.tripId)}&role=passenger`);
    } catch {
      localToast('Чат пока недоступен');
    }
  }
  if (chatIconBtn) chatIconBtn.addEventListener('click', openChat);
  if (callBtn) {
    callBtn.addEventListener('click', () => {
      localToast('Звонок водителю пока заглушка');
    });
  }

  // ── Bottom actions ───────────────────────────────────────
  content.querySelector('#arp-open-chat').addEventListener('click', openChat);
  content.querySelector('#arp-to-feed').addEventListener('click', () => {
    navigate('/feed');
  });

  // ── History save + In-история / На главную ───────────────
  // Persist a baseline entry as soon as the COMPLETED screen renders so
  // the trip is recoverable from /profile even if the passenger skips
  // the rating. Submitting the rating below merges in the rating, tags
  // and comment via a second save call.
  const historyRow = content.querySelector('.passenger-complete__history-row');
  function persistHistory({ withRating = false } = {}) {
    // When persisting the baseline (e.g. on initial render or refresh of
    // the COMPLETED screen) the in-memory rating/tags/comment are still
    // at their defaults. Without this lookup the empty defaults would
    // overwrite feedback that the passenger already submitted in a
    // previous session for the same tripId. BD-ACTIVE-04.
    let ratingPayload;
    if (withRating) {
      ratingPayload = {
        rating: currentRating,
        tags: Array.from(selectedTags),
        comment: commentInput ? commentInput.value.trim() : '',
      };
    } else {
      const previous = loadRideHistory().find(
        (e) => e && e.role === 'passenger' && e.tripId === ride.tripId,
      );
      ratingPayload = previous ? {
        rating: typeof previous.rating === 'number' ? previous.rating : 0,
        tags: Array.isArray(previous.tags) ? previous.tags.slice() : [],
        comment: typeof previous.comment === 'string' ? previous.comment : '',
      } : {};
    }
    const entry = buildPassengerHistoryEntry(ride, ratingPayload);
    if (!entry) return false;
    const saved = saveRideHistoryEntry(entry);
    if (saved && historyRow) historyRow.dataset.historySaved = 'true';
    return Boolean(saved);
  }
  persistHistory();

  const toHistoryBtn = content.querySelector('#arp-to-history');
  if (toHistoryBtn) {
    toHistoryBtn.addEventListener('click', () => {
      // Profile hosts the menu where the future "История поездок" entry
      // will live; navigating there is the safe stub until a dedicated
      // history screen exists.
      navigate('/profile');
    });
  }
  const toHomeBtn = content.querySelector('#arp-to-home');
  if (toHomeBtn) {
    toHomeBtn.addEventListener('click', () => {
      navigate('/feed');
    });
  }
  // ── Report sheet (State 7 — Issue / report entry) ────────
  // Toggle is driven by `content.dataset.report`; CSS hides the
  // rating section / main CTAs / bottom report link when open, and
  // shows the report card + a parallel "Вернуться в ленту" CTA.
  // No rating / payment state is touched, so closing the sheet
  // returns the screen to whatever cell of the matrix it was in.
  const reportSheet = content.querySelector('#arp-report-sheet');
  const reportClose = content.querySelector('#arp-report-close');
  const reportReturn = content.querySelector('#arp-report-return');
  const reportReasons = Array.from(
    content.querySelectorAll('.passenger-complete__report-reason')
  );
  const reportSubmit = content.querySelector('#arp-report-submit');
  let reportReason = null;

  // BD-RIDE-P-01 (BD-MOD) — bring the COMPLETED report sheet up to the
  // established in-repo submit→confirmation moderation pattern (mirrors the
  // in-ride safety sheet's idle→selected→submitted and order_detail BD-MOD-01).
  // UI-only, in-screen — no router change, no storage write.
  const resetReport = () => {
    reportReason = null;
    reportReasons.forEach((r) => r.setAttribute('aria-checked', 'false'));
    if (reportSubmit) reportSubmit.disabled = true;
    content.dataset.reportStage = 'select';
  };

  content.querySelector('#arp-report').addEventListener('click', () => {
    resetReport();
    content.dataset.report = 'open';
    if (reportSheet && typeof reportSheet.scrollIntoView === 'function') {
      reportSheet.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  if (reportClose) {
    reportClose.addEventListener('click', () => {
      content.dataset.report = 'closed';
      resetReport();
    });
  }

  if (reportReturn) {
    reportReturn.addEventListener('click', () => {
      navigate('/feed');
    });
  }

  reportReasons.forEach((btn) => {
    btn.addEventListener('click', () => {
      reportReason = btn.getAttribute('data-reason');
      reportReasons.forEach((r) => r.setAttribute('aria-checked', r === btn ? 'true' : 'false'));
      if (reportSubmit) reportSubmit.disabled = false;
    });
  });

  if (reportSubmit) {
    reportSubmit.addEventListener('click', () => {
      if (!reportReason) return;
      content.dataset.reportStage = 'submitted';
      // Move focus to the now-visible return CTA so keyboard / SR users are not
      // left on the just-hidden submit button (mirrors the rating submit path).
      if (reportReturn) reportReturn.focus();
    });
  }

  applyRating(0);
  return root;
}

function formatCanceledAt(ride) {
  const ts = ride && ride.timestamps && ride.timestamps.canceledAt;
  if (ts) {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) {
      const hh = d.getHours() < 10 ? `0${d.getHours()}` : String(d.getHours());
      const mm = d.getMinutes() < 10 ? `0${d.getMinutes()}` : String(d.getMinutes());
      return `${hh}:${mm}`;
    }
  }
  return '14:21';
}

// BD-RIDE-P-06 · State D — Canceled fallback view. Replaces the
// generic PASSENGER_STUB_BY_STATUS placeholder for CANCELED / NO_SHOW
// on the passenger side so the user lands on a navigable confirmation
// screen instead of a "будет добавлено позже" stub. The `variant`
// argument switches between truthful copy for the two states without
// touching the ride status itself.
function renderPassengerCanceledFallback(ride, variant = 'canceled') {
  const root = document.createElement('section');
  root.className = 'screen screen--active-ride passenger-cancel-fallback';
  root.dataset.variant = variant;
  const tripLabel = formatTripNumber(ride && ride.tripId);
  const canceledAt = formatCanceledAt(ride);
  const isNoShow = variant === 'no_show';
  const cancel = (ride && ride.cancel) || {};
  const byDriver = cancel.by === 'driver';
  const byPassenger = cancel.by === 'passenger';

  // BD-RIDE-P-06/07 polish — NO_SHOW badge uses the canonical label
  // (resolveRideStatusLabel), not the raw enum string.
  const title = isNoShow ? 'Поездка закрыта' : 'Поездка отменена';
  const badgeLabel = isNoShow ? 'Поездка закрыта' : 'Поездка отменена';
  const badgeText = isNoShow ? resolveRideStatusLabel(RIDE_STATUS.NO_SHOW) : 'Отменена';
  const description = isNoShow
    ? 'Водитель отметил, что не дождался вас.'
    : (byPassenger
      ? 'Вы отменили эту поездку. Вернитесь на главную или создайте новую заявку.'
      : (byDriver
        ? 'Водитель отменил эту поездку. Вы можете вернуться на главную или создать новую заявку.'
        : 'Мы закрыли эту поездку. Вы можете вернуться на главную или создать новую заявку.'));
  const metaVerb = isNoShow ? 'закрыто в' : 'отменено в';
  const primaryHtml = isNoShow
    ? ''
    : `<button type="button" class="passenger-cancel-fallback__btn-primary" id="arp-canceled-new">
         <span class="active-ride-passenger__btn-ic" aria-hidden="true">${PLUS_SVG}</span>
         Создать новую поездку
       </button>`;

  root.innerHTML = `
    <div class="passenger-cancel-fallback__top">
      <button type="button" class="passenger-cancel-fallback__top-back" id="arp-canceled-top-back" aria-label="Вернуться на главную">
        ${CHEVRON_UP_SVG}
      </button>
      <div class="passenger-cancel-fallback__trip">Поездка ${escapeHtml(tripLabel)}</div>
      <div class="passenger-cancel-fallback__badge" aria-label="${escapeHtml(badgeLabel)}">${escapeHtml(badgeText)}</div>
    </div>

    <div class="passenger-cancel-fallback__card" role="status" aria-live="polite">
      <div class="passenger-cancel-fallback__icon" aria-hidden="true">${X_CIRCLE_SVG}</div>
      <div class="passenger-cancel-fallback__title">${escapeHtml(title)}</div>
      <div class="passenger-cancel-fallback__text">
        ${escapeHtml(description)}
      </div>
      <div class="passenger-cancel-fallback__meta">
        ${escapeHtml(tripLabel)} · ${escapeHtml(metaVerb)} ${escapeHtml(canceledAt)}
      </div>
    </div>

    <div class="passenger-cancel-fallback__actions">
      ${primaryHtml}
      <button type="button" class="passenger-cancel-fallback__btn-secondary" id="arp-canceled-feed">
        Вернуться на главную
      </button>
    </div>
  `;

  const goHome = () => { go('/feed'); };
  root.querySelector('#arp-canceled-top-back').addEventListener('click', goHome);
  root.querySelector('#arp-canceled-feed').addEventListener('click', goHome);
  const newBtn = root.querySelector('#arp-canceled-new');
  if (newBtn) {
    newBtn.addEventListener('click', () => {
      // Composer is the canonical "new trip" entry on the passenger
      // side; no real backend call — same stub story as the rest of the
      // passenger flow.
      go('/new');
    });
  }
  return root;
}

export default function activeRidePassenger(options = {}) {
  const tripId = (options && options.tripId) || DEMO_ACTIVE_RIDE_ID;
  const statusQuery = (options && options.statusQuery) || null;
  const phaseQuery = normalizePhase((options && options.phaseQuery) || null);
  const paymentQuery = (options && options.paymentQuery) || null;
  const showNotice = typeof options.showNotice === 'function'
    ? options.showNotice
    : null;
  const fixture = getPassengerRideFixture();
  const hasPersistedLocalRide = !fixture && hasUsablePassengerRideSource(tripId);
  const isBuiltInDemoRide = !fixture && tripId === DEMO_ACTIVE_RIDE_ID;
  const hasUsableLocalRide = hasPersistedLocalRide || isBuiltInDemoRide;

  // Fixture isolation happens before every persisted ride / response / handoff
  // read. createDemoActiveRide is a pure in-memory constructor.
  let ride = fixture
    ? createPassengerFixtureRide(tripId)
    : loadPassengerRideView(tripId, statusQuery);
  if (!fixture) ride = applyPassengerStatusFromQuery(ride, statusQuery);
  const backendRead = !fixture && isBackendEnabled();
  let readState = fixture || (backendRead && !hasUsableLocalRide
    ? PASSENGER_RIDE_READ_STATE.LOADING
    : PASSENGER_RIDE_READ_STATE.LOADED);

  // BD-RIDE-P-06 · State D — Passenger lands here after confirming a
  // cancel, or when arriving from an audit URL with
  // ?status=CANCELED / ?status=NO_SHOW. NO_SHOW reuses the same layout
  // with truthful "Поездка не состоялась" copy so it doesn't pretend
  // the user manually canceled.
  if (ride.status === RIDE_STATUS.CANCELED) {
    return renderPassengerCanceledFallback(ride, 'canceled');
  }
  if (ride.status === RIDE_STATUS.NO_SHOW) {
    return renderPassengerCanceledFallback(ride, 'no_show');
  }

  if (!PASSENGER_SUPPORTED_STATUSES.has(ride.status)) {
    return renderPassengerStub(PASSENGER_STUB_BY_STATUS[ride.status]);
  }

  // BD-RIDE-P-05 — COMPLETED uses a scrollable layout without a map
  // and runs its own top bar / handlers, so branch out before the
  // map/sheet pipeline used by the en-route, waiting and in-progress
  // phases.
  if (ride.status === RIDE_STATUS.COMPLETED) {
    return renderPassengerRideComplete(ride, {
      go,
      toast: showNotice,
      paymentStatus: paymentQuery,
    });
  }

  const root = document.createElement('section');
  root.className = 'screen screen--active-ride active-ride-passenger';
  root.dataset.readState = readState;
  if (fixture) root.dataset.fixture = fixture;

  // Display label (e.g. №48-321) reused by the cancel / safety sheets.
  const tripLabel = formatTripNumber(ride.tripId);

  // ── Map layer ────────────────────────────────────────────
  const mapWrap = document.createElement('div');
  mapWrap.className = 'active-ride__map';
  let mapEl = null;
  let mapRenderKey = '';
  function renderMapForReadState(nextState) {
    const hasRideData = nextState === PASSENGER_RIDE_READ_STATE.LOADED;
    const route = hasRideData ? ride.route : null;
    const pickupLabel = route && route.pickupLabel ? route.pickupLabel : '';
    const dropoffLabel = route && route.dropoffLabel ? route.dropoffLabel : '';
    const key = hasRideData ? `ride:${ride.status}|${pickupLabel}|${dropoffLabel}` : 'unavailable';
    if (mapEl && mapRenderKey === key) return;
    const nextMap = createMapShell({
      variant: 'passenger',
      status: hasRideData ? ride.status : '',
      route,
      showRoute: hasRideData,
      showCar: hasRideData,
      showPickup: hasRideData,
      showDropoff: hasRideData,
      showLabels: hasRideData,
    });
    if (mapEl) mapEl.replaceWith(nextMap);
    else mapWrap.appendChild(nextMap);
    mapEl = nextMap;
    mapRenderKey = key;
  }
  root.appendChild(mapWrap);

  // ── Top overlay (chevron · trip number · shield) ─────────
  const top = document.createElement('div');
  top.className = 'active-ride__top active-ride-passenger__top';
  top.innerHTML = `
    <div class="active-ride-passenger__top-row">
      <button type="button" class="bd-iconbtn active-ride__icon-btn active-ride-passenger__chevron" id="arp-collapse" aria-label="Свернуть">
        ${CHEVRON_UP_SVG}
      </button>
      <div class="active-ride-passenger__trip-pill" role="status" aria-live="polite">
        <span class="active-ride-passenger__trip-label">Поездка ${escapeHtml(formatTripNumber(ride.tripId))}</span>
      </div>
      <button type="button" class="bd-iconbtn active-ride__icon-btn active-ride-passenger__shield" id="arp-shield" aria-label="Безопасность">
        ${SHIELD_SVG}
      </button>
    </div>
  `;
  root.appendChild(top);

  // ── Top driver card (BD-RIDE-P-01 shell parity) ──────────
  // Floats above the map, below the trip pill. Contains driver
  // identity, car, status-specific ETA and the prominent
  // call/message actions. Bottom sheet keeps the status-specific
  // slot below.
  const topCard = document.createElement('div');
  topCard.className = 'active-ride-passenger__top-card-wrap';
  root.appendChild(topCard);

  // ── Sheet ────────────────────────────────────────────────
  const sheet = document.createElement('div');
  sheet.className = 'active-ride__sheet active-ride-passenger__sheet';
  sheet.dataset.status = ride.status;
  root.appendChild(sheet);

  // ── Toast ────────────────────────────────────────────────
  const notice = document.createElement('div');
  notice.className = 'active-ride__notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.hidden = true;
  root.appendChild(notice);

  let noticeTimer = null;
  function toast(message) {
    if (showNotice) { showNotice(message); return; }
    notice.textContent = message;
    notice.hidden = false;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 3500);
  }

  // ── Shared top handlers ──────────────────────────────────
  top.querySelector('#arp-collapse').addEventListener('click', () => {
    toast('Сворачивание панели будет добавлено позже');
  });
  top.querySelector('#arp-shield').addEventListener('click', () => {
    openPassengerSafetySheet(root, { toast, ride, tripLabel });
  });

  // ── Top driver card handlers ─────────────────────────────
  // Re-bound after a successful initial server hydration because the loaded
  // card replaces the structural skeleton. Fixture actions stay inert.
  function bindTopCardHandlers() {
    const topCallBtn = topCard.querySelector('#arp-top-call');
    const topChatBtn = topCard.querySelector('#arp-top-chat');
    if (fixture) {
      for (const btn of [topCallBtn, topChatBtn]) {
        if (!btn) continue;
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
      }
      return;
    }
    if (topCallBtn) {
      topCallBtn.addEventListener('click', () => {
        toast('Звонок водителю пока заглушка');
      });
    }
    if (topChatBtn) {
      topChatBtn.addEventListener('click', () => {
        go(`/chat?tripId=${encodeURIComponent(ride.tripId)}&role=passenger`);
      });
    }
  }

  function renderTopCard() {
    topCard.hidden = false;
    topCard.dataset.status = ride.status;
    topCard.innerHTML = topDriverCardHtml(ride, { phase: phaseQuery });
    bindTopCardHandlers();
  }

  // ── Per-sheet bindings shared across statuses ────────────
  // Driver chat/call now live on the top card and are bound once
  // above; the bottom sheet only owns its route/sos/share controls.
  function bindCommonSheetHandlers() {
    const editRouteBtn = sheet.querySelector('#arp-edit-route');
    if (editRouteBtn) {
      editRouteBtn.addEventListener('click', () => {
        toast('Редактирование маршрута будет добавлено позже');
      });
    }
    const sosBtn = sheet.querySelector('#arp-sos');
    if (sosBtn && fixture) {
      sosBtn.disabled = true;
      sosBtn.setAttribute('aria-disabled', 'true');
    } else if (sosBtn) {
      sosBtn.addEventListener('click', () => {
        openPassengerSafetySheet(root, { toast, ride, tripLabel });
      });
    }
    const shareBtn = sheet.querySelector('#arp-share');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        toast('Поделиться поездкой пока заглушка');
      });
    }
  }

  // BD-RIDE-P-06 polish — shared binder for the cancel affordance.
  // Used by both the en-route family (ACCEPTED, DRIVER_EN_ROUTE,
  // DRIVER_APPROACHING_PICKUP) and the WAITING_PASSENGER sheet so a
  // refactor cannot accidentally drop the cancel button from one of
  // them. Terminal states (COMPLETED, CANCELED, NO_SHOW) never reach
  // this code path because they branch out earlier.
  function bindCancelAffordance() {
    const cancelBtn = sheet.querySelector('#arp-cancel');
    if (!cancelBtn) return;
    if (fixture) {
      cancelBtn.disabled = true;
      cancelBtn.setAttribute('aria-disabled', 'true');
      return;
    }
    cancelBtn.addEventListener('click', () => {
      if (passengerMutationIsBlocked()) {
        toast('Изменение статуса временно недоступно. Дождитесь обновления поездки.');
        return;
      }
      openPassengerCancelSheet(root, {
        ride,
        tripLabel,
        onConfirm: (reasonId, comment) => {
          // Review9 P1: a terminal server snapshot deferred behind this overlay is
          // authoritative enough to close the stale cancel commit path immediately.
          // Re-check here as well as disabling the buttons so a queued click cannot
          // persist local CANCELED after the server has already terminalized the ride.
          if (deferredTerminalPassengerStatusBlocksCancel()) {
            toast('Поездка уже завершена. Обновляем статус.');
            return {
              aborted: true,
              reconcile: 'deferred-terminal',
            };
          }
          // BD-RIDE-SIM-01 — passenger cancels after the driver has
          // already accepted. Persist the current view first so the
          // ride's passenger identity (sim overrides — Алексей,
          // route, note, price) is written to localStorage before
          // the status transition; otherwise updateActiveRideStatus
          // would materialize a bare demo via getActiveRide and the
          // driver-side canceled sheet would not see the audit
          // scenario.
          saveActiveRide(ride);
          const canceledRide = updateActiveRideStatus(ride.tripId, RIDE_STATUS.CANCELED, {
            cancel: {
              by: 'passenger',
              reason: reasonId || 'passenger_cancel_after_accept',
              comment: comment || '',
            },
          });
          // BD-RIDE-P-10 — mirror the cancellation into canonical
          // bazardrive.ride_orders.v1 so Feed / DriverMap /
          // findLatestHandedOffOrderTripId stop treating the trip as
          // live. Matches the driver branch syncCanonicalOrderStatus
          // pattern in active_ride.js; CANCELED is a legal transition
          // from CREATED, ACCEPTED and IN_PROGRESS so no defensive
          // bridge is needed.
          //
          // BD-ACTIVE-RIDE-TERM-01 P2 follow-up — gate the canonical
          // sync on `canceledRide?.status === CANCELED`. When the
          // active-ride store already carries a terminal record
          // (e.g. a stale tab races behind a driver-completed ride
          // or a passenger-canceled retry), `updateActiveRideStatus`
          // returns the existing terminal record verbatim. Without
          // this gate the passenger would silently move the canonical
          // order to CANCELED while the active-ride record stays
          // COMPLETED / NO_SHOW / driver-canceled, leaving Feed /
          // DriverMap / history views inconsistent.
          const orderForSync = canceledRide || ride;
          const canonicalOrderId = (orderForSync && typeof orderForSync.orderId === 'string' && orderForSync.orderId)
            || (typeof ride.tripId === 'string' && ride.tripId.startsWith('trip_order-')
                ? ride.tripId.slice('trip_'.length)
                : null);
          if (canonicalOrderId
              && canceledRide
              && canceledRide.status === RIDE_STATUS.CANCELED) {
            updateTripStatus(canonicalOrderId, RIDE_STATUS.CANCELED);
          }
          // #784 CUT-5 (B2) — mirror the passenger cancel to the server so the driver (polling) sees
          // it cross-device (the PATCH is participant-gated). Fire-and-forget: the local terminal stub
          // is the user-facing truth; a server-sync failure leaves the local cancel standing (the
          // driver-side poll reconciles). OFF / authoritative local-only ride: no server write candidate.
          if (backendWriteCandidate && canceledRide && canceledRide.status === RIDE_STATUS.CANCELED) {
            patchRideStatus(ride.tripId, RIDE_STATUS.CANCELED).catch(() => {});
          }
          // Hand the canceled-state copy back to the sheet. The
          // ?status=CANCELED fallback screen still renders on direct
          // entry / reload via renderPassengerCanceledFallback.
          return {
            tripLabel,
            timeLabel: formatCanceledAt(canceledRide || ride),
          };
        },
      });
    });
  }

  function renderSheet() {
    sheet.dataset.status = ride.status;
    // Drop any stale phase from a previous render — only branches that
    // need it (e.g. ARRIVING_DROPOFF) will re-set sheet.dataset.phase.
    delete sheet.dataset.phase;
    if (ride.status === RIDE_STATUS.WAITING_PASSENGER) {
      renderWaitingSheet(sheet, ride);
      bindCommonSheetHandlers();
      bindCancelAffordance();
      const boardedBtn = sheet.querySelector('#arp-boarded');
      if (boardedBtn && fixture) {
        boardedBtn.disabled = true;
        boardedBtn.setAttribute('aria-disabled', 'true');
        return;
      }
      if (boardedBtn) {
        boardedBtn.addEventListener('click', async () => {
          if (passengerMutationIsBlocked()) {
            toast('Изменение статуса временно недоступно. Дождитесь обновления поездки.');
            return;
          }
          // #784 CUT-5 — on a confirmed server ride, confirm the boarded transition on the server FIRST,
          // then advance locally + navigate. A failed PATCH (network/auth, or the driver already
          // terminalized) must NOT strand the passenger locally IN_PROGRESS while the server stays
          // WAITING (serverIsForward never rolls a backward move back) — stay put + surface it instead.
          if (backendWriteCandidate) {
            try { await patchRideStatus(ride.tripId, RIDE_STATUS.IN_PROGRESS); }
            catch (err) {
              localToast(err && err.code === 'RIDE_TERMINAL'
                ? 'Поездка уже завершена'
                : 'Не удалось подтвердить посадку. Попробуйте ещё раз.');
              return;
            }
          }
          // Codex follow-up — when no local canonical record exists yet (a
          // real backend-confirmed ride viewed with an empty local store),
          // updateActiveRideStatus's own existing || getActiveRide(tripId)
          // fallback would otherwise materialize and persist a BRAND NEW
          // demo ride (demo passenger/route/waiting) as IN_PROGRESS,
          // discarding the real in-memory ride entirely. Seed the current
          // real/cleaned in-memory ride first — mirrors the existing
          // passenger cancel protection — so updateActiveRideStatus always
          // has a real record to advance instead of falling through to a
          // fresh demo materialization.
          saveActiveRide(ride);
          // Persist transition to IN_PROGRESS so the driver flow sees it and re-route so the URL
          // reflects the new state.
          updateActiveRideStatus(ride.tripId, RIDE_STATUS.IN_PROGRESS);
          go(`/active-ride?role=passenger&status=${RIDE_STATUS.IN_PROGRESS}&tripId=${encodeURIComponent(ride.tripId)}`);
        });
      }
      return;
    }
    if (ride.status === RIDE_STATUS.IN_PROGRESS) {
      if (phaseQuery === PASSENGER_IN_PROGRESS_PHASE.ARRIVING_DROPOFF) {
        sheet.dataset.phase = PASSENGER_IN_PROGRESS_PHASE.ARRIVING_DROPOFF;
        renderArrivingDropoffSheet(sheet, ride);
        bindCommonSheetHandlers();
        const finishRateBtn = sheet.querySelector('#arp-finish-rate');
        if (finishRateBtn) {
          finishRateBtn.addEventListener('click', () => {
            // Hand the passenger off into the COMPLETED rating flow.
            // View-only navigation — the canonical ride status is still
            // owned by the driver lifecycle, so we don't call
            // updateActiveRideStatus here. payment=auto matches the
            // default COMPLETED entry the audit URL would land on.
            go(`/active-ride?role=passenger&status=${RIDE_STATUS.COMPLETED}&payment=auto&tripId=${encodeURIComponent(ride.tripId)}`);
          });
        }
        return;
      }
      renderInProgressSheet(sheet, ride);
      bindCommonSheetHandlers();
      const addStopBtn = sheet.querySelector('#arp-add-stop');
      if (addStopBtn) {
        addStopBtn.addEventListener('click', () => {
          toast('Добавление остановки будет добавлено позже');
        });
      }
      const shareSquareBtn = sheet.querySelector('#arp-share-square');
      if (shareSquareBtn) {
        shareSquareBtn.addEventListener('click', () => {
          toast('Поделиться поездкой пока заглушка');
        });
      }
      return;
    }
    // ACCEPTED / DRIVER_EN_ROUTE / DRIVER_APPROACHING_PICKUP
    renderEnRouteSheet(sheet, ride);
    bindCommonSheetHandlers();
    bindCancelAffordance();
    const refineBtn = sheet.querySelector('#arp-refine');
    if (refineBtn) {
      refineBtn.addEventListener('click', () => {
        toast('Уточнение места подачи будет добавлено позже');
      });
    }
  }

  // 02D review9 terminal/backward-recovery contract:
  // - backend API, persisted stores, lifecycle enum/transitions and Mapbox behavior are unchanged;
  // - a forward terminal server status deferred behind an open overlay stays authoritative
  //   in memory and immediately blocks the stale cancel-confirm commit path until reconciliation;
  // - a recovery GET may refresh authoritative display sub-objects, but when its lifecycle
  //   status ranks behind the locally displayed status it must not lower ride.status.
  //
  // 02D review7 ownership/write contract:
  // - backend API, persisted stores and Ride State Machine statuses are unchanged;
  // - a backend-enabled ride begins UNCONFIRMED. Status mutations stay blocked until the
  //   participant-gated GET settles ownership as SERVER_BACKED or LOCAL_ONLY;
  // - SERVER_BACKED owns the existing PATCH writer and keeps that identity across retryable
  //   read failures; permanent non-404 failures block mutations until a later successful GET;
  // - LOCAL_ONLY is established only by backend OFF / authoritative null / 404 RIDE_NOT_FOUND
  //   and never attempts the server status writer. Ownership is in-memory UI/read state only.
  const PASSENGER_RIDE_OWNERSHIP = Object.freeze({
    UNCONFIRMED: 'unconfirmed',
    SERVER_BACKED: 'server-backed',
    LOCAL_ONLY: 'local-only',
  });
  let passengerRideOwnership = backendRead
    ? PASSENGER_RIDE_OWNERSHIP.UNCONFIRMED
    : PASSENGER_RIDE_OWNERSHIP.LOCAL_ONLY;
  let backendRide = false;
  let backendWriteCandidate = false;
  let backendMutationBlocked = false;

  function passengerMutationIsBlocked() {
    const ownershipPending = passengerRideOwnership === PASSENGER_RIDE_OWNERSHIP.UNCONFIRMED;
    return hasUsableLocalRide && (ownershipPending || backendMutationBlocked);
  }

  function syncPassengerMutationGate() {
    const ownershipPending = passengerRideOwnership === PASSENGER_RIDE_OWNERSHIP.UNCONFIRMED;
    const blocked = passengerMutationIsBlocked();
    root.dataset.ownershipState = passengerRideOwnership;
    if (blocked) root.dataset.mutationState = ownershipPending ? 'ownership-unconfirmed' : 'server-blocked';
    else delete root.dataset.mutationState;

    for (const selector of ['#arp-cancel', '#arp-boarded']) {
      const button = sheet.querySelector(selector);
      if (!button || fixture) continue;
      button.disabled = blocked;
      button.setAttribute('aria-disabled', blocked ? 'true' : 'false');
    }

    // A cancel overlay may already be open when a late permanent read failure settles.
    // Disable its commit gates as well so it cannot race the underlying sheet.
    if (blocked) {
      for (const selector of ['#arp-cancel-confirm', '#arp-cancel-confirm-yes']) {
        const button = root.querySelector(selector);
        if (!button) continue;
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
      }
    }
  }

  function setPassengerRideOwnership(nextOwnership) {
    passengerRideOwnership = nextOwnership;
    backendWriteCandidate = nextOwnership === PASSENGER_RIDE_OWNERSHIP.SERVER_BACKED;
    syncPassengerMutationGate();
  }

  function setPassengerMutationBlocked(blocked) {
    backendMutationBlocked = Boolean(blocked);
    syncPassengerMutationGate();
  }

  function isPassengerRideAuthorizationFailure(err) {
    const status = Number(err && err.status);
    return status === 401 || status === 403;
  }

  // Codex follow-up — mergeServerRide only runs after a successful backend
  // read (see runInitialRead's `const srv = await ...; if (!srv) return;`
  // gate below), which is itself proof this trip is real. Until that point,
  // loadPassengerRideView() may have fallen back to a transient
  // createDemoActiveRide() placeholder (no local canonical record yet)
  // still carrying the raw demo waiting.remaining/paidStartsAt ('2:30'/
  // '14:18'). serializeRide() sends no `waiting` field at all today, so the
  // plain keep(local, server) merge below — which only overlays a NON-NULL
  // server key — leaves those two fields completely untouched even though
  // the server has now established this is a real trip. Explicitly clear
  // them once the server has responded (regardless of whether it sends a
  // waiting object), while keeping the same keep() precedence for
  // freeLimit/paidRate/any field the server might add later — a future
  // non-null server remaining/paidStartsAt still wins. Pure, no
  // saveActiveRide, no persistence — only mergeServerRide's transient
  // in-memory projection changes.
  function mergeServerWaiting(localWaiting, serverWaiting) {
    const out = { ...(localWaiting || {}) };
    for (const k in (serverWaiting || {})) { if (serverWaiting[k] != null) out[k] = serverWaiting[k]; }
    if (!serverWaiting || serverWaiting.remaining == null) out.remaining = null;
    if (!serverWaiting || serverWaiting.paidStartsAt == null) out.paidStartsAt = null;
    return out;
  }

  // #784 CUT-5 — merge the authoritative server snapshot onto the in-memory ride, preserving the local
  // display fields the focused serializeRide doesn't carry; a server null never clobbers a local value.
  //
  // Codex follow-up — mergeServerRide only runs after a successful backend
  // read (see runInitialRead's `const srv = await ...; if (!srv) return;`
  // gate), which is itself proof this trip is real. A transient sim-fallback
  // ride (see the `ride.localProvenance = 'sim_audit'` stamp in
  // loadPassengerRideView) must not keep claiming local-only simulation
  // provenance once the server has confirmed it — delete the marker from
  // the merged projection rather than persist `null` as meaningful
  // provenance. No ownership-logic change, no new saveActiveRide call.
  function mergeServerRide(srv, preserveLocallyAheadStatus = false) {
    const keep = (a, b) => {
      const out = { ...(a || {}) };
      for (const k in (b || {})) { if (b[k] != null) out[k] = b[k]; }
      return out;
    };
    const serverStatus = srv.status || ride.status;
    const localRank = STATUS_RANK[ride.status] ?? 0;
    const serverRank = STATUS_RANK[serverStatus] ?? 0;
    const mergedStatus = preserveLocallyAheadStatus && localRank > serverRank
      ? ride.status
      : serverStatus;
    const merged = {
      ...ride,
      tripId: srv.tripId || ride.tripId,
      status: mergedStatus,
      passenger: keep(ride.passenger, srv.passenger),
      driver: keep(ride.driver, srv.driver),
      vehicle: keep(ride.vehicle, srv.vehicle),
      order: keep(ride.order, srv.order),
      route: keep(ride.route, srv.route),
      payment: keep(ride.payment, srv.payment),
      waiting: mergeServerWaiting(ride.waiting, srv.waiting),
      ride: keep(ride.ride, srv.ride),
      chat: keep(ride.chat, srv.chat),
      timestamps: keep(ride.timestamps, srv.timestamps),
      cancel: (srv.cancel && srv.cancel.by) ? srv.cancel : ride.cancel,
    };
    delete merged.localProvenance;
    return merged;
  }

  // Codex follow-up — mergeServerRide's cleanup only ever lives in the
  // in-memory `ride` closure variable. If a record already exists in
  // storage for this tripId (a pre-existing, unmarked, backend-derived
  // trip_* record still carrying the raw demo waiting), nothing here ever
  // pushed that cleanup back into storage — an offline reload, or one
  // whose GET fails, would keep reading the stale 2:30/14:18. Mirrors
  // active_ride.js's persistServerConfirmedWaitingProjection: repair the
  // EXISTING stored record's waiting projection the moment the server has
  // proven the trip real, narrowly — never a full overwrite. Base the
  // repair on the STORED record (never on `ride` or the raw server
  // projection) so status, timestamps, tripId, orderId, acceptedSource,
  // passenger, driver, vehicle, route, payment, ride, chat, cancel and
  // every other stored field survive untouched — including a terminal
  // stored status, which this never thaws (saveActiveRide's own
  // terminal-freeze guard still applies unchanged). No-op when nothing is
  // stored yet — that case is covered by the first-save path (see the
  // boarding fix below for the one path that lacked one).
  function persistPassengerServerConfirmedWaitingProjection(cleanedWaiting) {
    const storedRide = findActiveRide(ride.tripId);
    if (!storedRide) return;
    const repaired = {
      ...storedRide,
      waiting: { ...(cleanedWaiting || {}) },
    };
    delete repaired.localProvenance;
    saveActiveRide(repaired);
  }

  let passengerPollId = null;
  let passengerCursor = null;
  let passengerPollBusy = false;
  let passengerPollController = null;
  let passengerRecoveryId = null;
  let fixtureRetryId = null;
  let readEpoch = 0;
  let destroyed = false;
  let deferredPassengerServerStatus = null;
  const readManager = createPassengerRideReadManager(
    getRideFromBackend,
    PASSENGER_RIDE_READ_TIMEOUT_MS,
  );

  // B1 — monotonic rank: re-mount ONLY on a FORWARD server move. The passenger status resolution has
  // a monotonic guard that can keep the local status AHEAD of the server (e.g. a just-boarded local
  // IN_PROGRESS vs a not-yet-synced server WAITING); re-mounting on such a BACKWARD diff would never
  // converge -> an infinite go() loop. Terminals rank highest so a server cancel/complete always wins.
  const STATUS_RANK = {
    [RIDE_STATUS.NEW_ORDER]: 0,
    [RIDE_STATUS.ACCEPTED]: 1,
    [RIDE_STATUS.DRIVER_EN_ROUTE]: 2,
    [RIDE_STATUS.DRIVER_APPROACHING_PICKUP]: 3,
    [RIDE_STATUS.WAITING_PASSENGER]: 4,
    [RIDE_STATUS.IN_PROGRESS]: 5,
    [RIDE_STATUS.COMPLETED]: 6,
    [RIDE_STATUS.CANCELED]: 6,
    [RIDE_STATUS.NO_SHOW]: 6,
  };
  const serverIsForward = (srvStatus) => (STATUS_RANK[srvStatus] ?? 0) > (STATUS_RANK[ride.status] ?? 0);
  function isPassengerTerminalStatus(status) {
    return status === RIDE_STATUS.COMPLETED
      || status === RIDE_STATUS.CANCELED
      || status === RIDE_STATUS.NO_SHOW;
  }

  function deferredTerminalPassengerStatusBlocksCancel() {
    return isPassengerTerminalStatus(deferredPassengerServerStatus);
  }

  function syncDeferredTerminalCancelGate() {
    if (!deferredTerminalPassengerStatusBlocksCancel()) return;
    root.dataset.deferredTerminalStatus = deferredPassengerServerStatus;
    for (const selector of ['#arp-cancel-confirm', '#arp-cancel-confirm-yes']) {
      const button = root.querySelector(selector);
      if (!button) continue;
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
    }
  }

  // B3 — never yank away an OPEN safety/cancel overlay. A forward server status
  // stays pending OUTSIDE ride.status until the overlay closes, otherwise merging
  // it would make later polls think the transition was already rendered.
  const aSheetIsOpen = () => !!root.querySelector('.passenger-safety-overlay, .passenger-cancel-overlay');
  const PASSENGER_REMOUNT_RESULT = Object.freeze({
    NONE: 'none',
    DEFERRED: 'deferred',
    NAVIGATED: 'navigated',
  });
  function maybeReMount(srvStatus) {
    if (!srvStatus || !serverIsForward(srvStatus)) return PASSENGER_REMOUNT_RESULT.NONE;
    if (aSheetIsOpen()) {
      const pendingRank = STATUS_RANK[deferredPassengerServerStatus] ?? -1;
      const nextRank = STATUS_RANK[srvStatus] ?? 0;
      if (!deferredPassengerServerStatus || nextRank > pendingRank) {
        deferredPassengerServerStatus = srvStatus;
      }
      // A terminal deferred snapshot is sticky while an overlay is open and
      // immediately closes the stale cancellation commit race.
      syncDeferredTerminalCancelGate();
      return PASSENGER_REMOUNT_RESULT.DEFERRED;
    }
    deferredPassengerServerStatus = null;
    go(`/active-ride?role=passenger&status=${encodeURIComponent(srvStatus)}&tripId=${encodeURIComponent(ride.tripId)}`);
    return PASSENGER_REMOUNT_RESULT.NAVIGATED;
  }

  function flushDeferredPassengerStatus() {
    if (!deferredPassengerServerStatus || destroyed || aSheetIsOpen()) return false;
    const pendingStatus = deferredPassengerServerStatus;
    if (!serverIsForward(pendingStatus)) {
      deferredPassengerServerStatus = null;
      return false;
    }
    return maybeReMount(pendingStatus) === PASSENGER_REMOUNT_RESULT.NAVIGATED;
  }

  // #887 P1 repair — LOCAL_ONLY forward reconciliation. Another same-origin
  // browsing context can advance bazardrive.active_ride.v1 through the driver
  // lifecycle while this screen is mounted; observe that forward move through
  // the SAME maybeReMount / deferredPassengerServerStatus / queued-click-abort
  // pipeline the SERVER_BACKED poll already drives, instead of a second
  // hand-rolled reconciliation controller (the former, deleted
  // passenger_local_ride_sync.js). Critically, this always re-reads by the
  // tripId THIS screen mounted with — the closed-over `ride.tripId` — and never
  // re-derives trip identity from the URL / findLatestHandedOffOrderTripId().
  // findLatestHandedOffOrderTripId() intentionally stops surfacing a trip once
  // it goes terminal, so re-deriving here would drift the observer onto a
  // different trip (or the demo fallback) right when a terminal status lands —
  // exactly when it must keep observing the same trip it started with.
  const ACTIVE_RIDE_LOCAL_STORAGE_KEY = 'bazardrive.active_ride.v1';
  function reconcileLocalOnlyRide() {
    if (destroyed || fixture) return PASSENGER_REMOUNT_RESULT.NONE;
    if (passengerRideOwnership !== PASSENGER_RIDE_OWNERSHIP.LOCAL_ONLY) return PASSENGER_REMOUNT_RESULT.NONE;
    const nextRide = findActiveRide(ride.tripId);
    if (!nextRide || !nextRide.status) return PASSENGER_REMOUNT_RESULT.NONE;
    return maybeReMount(nextRide.status);
  }

  function onActiveRideStorage(event) {
    if (!event || event.key !== ACTIVE_RIDE_LOCAL_STORAGE_KEY) return;
    reconcileLocalOnlyRide();
  }

  function setReadState(nextState) {
    readState = nextState;
    root.dataset.readState = nextState;
    const busy = nextState === PASSENGER_RIDE_READ_STATE.LOADING ? 'true' : 'false';
    topCard.setAttribute('aria-busy', busy);
    sheet.setAttribute('aria-busy', busy);
    if (nextState === PASSENGER_RIDE_READ_STATE.LOADING) {
      notice.dataset.readStatus = 'loading';
      notice.textContent = 'Загружаем поездку…';
      notice.hidden = false;
    } else if (notice.dataset.readStatus === 'loading') {
      delete notice.dataset.readStatus;
      notice.textContent = '';
      notice.hidden = true;
    }
    renderMapForReadState(nextState);

    const shieldBtn = top.querySelector('#arp-shield');
    if (shieldBtn) {
      const disabled = nextState !== PASSENGER_RIDE_READ_STATE.LOADED || Boolean(fixture);
      shieldBtn.disabled = disabled;
      shieldBtn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    }

    if (nextState === PASSENGER_RIDE_READ_STATE.LOADING) {
      topCard.hidden = false;
      topCard.dataset.status = PASSENGER_RIDE_READ_STATE.LOADING;
      topCard.innerHTML = passengerRideLoadingDriverHtml();
      sheet.dataset.status = PASSENGER_RIDE_READ_STATE.LOADING;
      sheet.innerHTML = passengerRideLoadingSheetHtml();
      return;
    }

    if (nextState === PASSENGER_RIDE_READ_STATE.EMPTY) {
      topCard.hidden = true;
      sheet.dataset.status = PASSENGER_RIDE_READ_STATE.EMPTY;
      sheet.innerHTML = passengerRideEmptyHtml();
      const feedBtn = sheet.querySelector('#arp-read-feed');
      if (feedBtn) feedBtn.addEventListener('click', () => go('/feed'));
      return;
    }

    if (nextState === PASSENGER_RIDE_READ_STATE.ERROR) {
      topCard.hidden = true;
      sheet.dataset.status = PASSENGER_RIDE_READ_STATE.ERROR;
      sheet.innerHTML = passengerRideErrorHtml();
      const retryBtn = sheet.querySelector('#arp-read-retry');
      if (retryBtn) retryBtn.addEventListener('click', retryInitialRead);
      return;
    }

    renderTopCard();
    renderSheet();
    syncPassengerMutationGate();
  }

  function updatePassengerText(scope, selector, value) {
    const node = scope.querySelector(selector);
    if (!node) return;
    node.textContent = value == null ? '' : String(value);
  }

  function refreshPassengerRideFieldsInPlace() {
    if (readState !== PASSENGER_RIDE_READ_STATE.LOADED) return;

    const driver = (ride && ride.driver) || {};
    const driverName = driver.name || 'Рустам К.';
    const driverInitials = driver.initials || 'РК';
    const driverRating = driver.rating || '';
    const driverNameNode = topCard.querySelector('.active-ride-passenger__driver-name');
    if (driverNameNode) {
      const textNode = Array.from(driverNameNode.childNodes)
        .find((node) => node.nodeType === 3 && String(node.nodeValue || '').trim());
      if (textNode) textNode.nodeValue = driverName + ' ';
    }
    updatePassengerText(topCard, '.active-ride-passenger__avatar', driverInitials);
    updatePassengerText(topCard, '.active-ride-passenger__driver-rating', '★ ' + driverRating);
    updatePassengerText(topCard, '.active-ride-passenger__driver-sub', carLine(ride));

    const eta = topDriverCardEta(ride, phaseQuery);
    const etaBox = topCard.querySelector('.active-ride-passenger__top-card-eta');
    if (etaBox) etaBox.setAttribute('aria-label', eta.value + ' ' + eta.label);
    const topCardBody = topCard.querySelector('.active-ride-passenger__top-card');
    if (topCardBody) topCardBody.dataset.tone = eta.tone;
    updatePassengerText(topCard, '.active-ride-passenger__top-card-eta-value', eta.value);
    updatePassengerText(topCard, '.active-ride-passenger__top-card-eta-label', eta.label);

    const chat = chatLabelFor(ride);
    const topChatBtn = topCard.querySelector('#arp-top-chat');
    if (topChatBtn) {
      topChatBtn.setAttribute('aria-label', chat.label);
      let badge = topChatBtn.querySelector('.active-ride-passenger__chat-badge--inline');
      if (chat.unreadCount > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'active-ride-passenger__chat-badge active-ride-passenger__chat-badge--inline';
          badge.setAttribute('aria-hidden', 'true');
          topChatBtn.appendChild(badge);
        }
        badge.textContent = String(chat.unreadCount);
      } else if (badge) {
        badge.remove();
      }
    }

    const route = (ride && ride.route) || {};
    const routeFields = sheet.querySelectorAll('.active-ride-passenger__route-main');
    if (routeFields[0]) routeFields[0].textContent = route.pickupLabel || 'ул. Малая Бронная, 28';
    if (routeFields[1]) routeFields[1].textContent = route.dropoffLabel || 'Аэропорт Шереметьево, терминал В';

    const pay = paymentInfo(ride);
    const amount = ride.status === RIDE_STATUS.IN_PROGRESS
      && phaseQuery === PASSENGER_IN_PROGRESS_PHASE.ARRIVING_DROPOFF
      ? arrivingDropoffAmount(ride)
      : pay.amount;
    updatePassengerText(sheet, '.active-ride-passenger__payment-title', '•• ' + pay.last4 + ' · ' + pay.method);
    updatePassengerText(sheet, '.active-ride-passenger__payment-note', pay.note);
    updatePassengerText(sheet, '.active-ride-passenger__payment-amount', amount);

    if (ride.status === RIDE_STATUS.WAITING_PASSENGER) {
      const waiting = waitingInfo(ride);
      updatePassengerText(sheet, '.active-ride-passenger__waiting-badge-value', waiting.remaining);
      updatePassengerText(sheet, '.active-ride-passenger__waiting-card-value', waiting.remaining + ' / ' + waiting.freeLimit);
      updatePassengerText(sheet, '.active-ride-passenger__waiting-card-foot', 'Дальше — ' + waiting.paidRate + ' · с ' + waiting.paidStartsAt);
      const progress = sheet.querySelector('.active-ride-passenger__progress-bar');
      if (progress) {
        if (waiting.pct == null) progress.removeAttribute('aria-valuenow');
        else progress.setAttribute('aria-valuenow', String(waiting.pct));
      }
      const fill = sheet.querySelector('.active-ride-passenger__progress-bar-fill');
      if (fill) fill.dataset.step = String(waiting.pct == null ? 0 : Math.round(waiting.pct / 10));
    } else if (ride.status === RIDE_STATUS.IN_PROGRESS
      && phaseQuery !== PASSENGER_IN_PROGRESS_PHASE.ARRIVING_DROPOFF) {
      const info = inProgressInfo(ride);
      updatePassengerText(sheet, '.active-ride-passenger__sub', 'Расчётное время прибытия ' + info.arrivalTime);
    } else {
      updatePassengerText(sheet, '.active-ride-passenger__car', carLine(ride));
    }
  }

  // Background recovery is a refresh of an already usable ride, not a new
  // screen settlement. When preserveDom is true, keep the existing controls
  // (and their focus/listeners) intact and update only refresh/mutation state.
  function renderLoadedRide(preserveDom = false) {
    if (preserveDom && readState === PASSENGER_RIDE_READ_STATE.LOADED) {
      refreshPassengerRideFieldsInPlace();
      // Review8: recovery settlement must refresh the map from the same authoritative
      // ride/route snapshot without replacing loaded passenger controls.
      renderMapForReadState(PASSENGER_RIDE_READ_STATE.LOADED);
      syncPassengerMutationGate();
      return;
    }
    setReadState(PASSENGER_RIDE_READ_STATE.LOADED);
  }

  function stopPassengerRidePoll() {
    if (passengerPollId) clearInterval(passengerPollId);
    passengerPollId = null;
    passengerPollBusy = false;
    if (passengerPollController) passengerPollController.abort();
    passengerPollController = null;
  }

  function stopPassengerRideRecovery() {
    if (passengerRecoveryId) clearTimeout(passengerRecoveryId);
    passengerRecoveryId = null;
  }

  function isPassengerRideRecoveryRetryable(err) {
    if (!err) return true;
    if (err.retryable === true) return true;
    if (err.name === 'TimeoutError') return true;
    const status = Number(err.status);
    if (Number.isFinite(status)) {
      if (status === 401 || status === 403) return false;
      // Review10 P2: HTTP transport truth wins when a gateway/proxy cannot
      // provide the API retryability envelope. 408/429/5xx remain transient
      // even when ApiError carries the default retryable:false hint.
      if (status === 408 || status === 429 || status >= 500) return true;
      return false;
    }
    if (err.retryable === false) return false;
    return true;
  }

  function schedulePassengerRideRecovery() {
    if (passengerRecoveryId || fixture || destroyed || !hasPersistedLocalRide) return;
    passengerRecoveryId = setTimeout(() => {
      passengerRecoveryId = null;
      if (destroyed) return;
      runInitialRead(true);
    }, PASSENGER_RIDE_POLL_MS);
  }

  function teardownPassengerReads() {
    if (destroyed) return;
    destroyed = true;
    readEpoch += 1;
    readManager.cancel('passenger ride screen teardown');
    stopPassengerRidePoll();
    stopPassengerRideRecovery();
    if (fixtureRetryId) clearTimeout(fixtureRetryId);
    fixtureRetryId = null;
    window.removeEventListener('storage', onActiveRideStorage);
  }

  function startPassengerRidePoll() {
    if (passengerPollId || fixture || !backendRide) return;
    passengerPollId = setInterval(async () => {
      if (!document.body.contains(root)) {
        teardownPassengerReads();
        return;
      }
      if (passengerPollBusy) return;
      passengerPollBusy = true;
      const controller = new AbortController();
      passengerPollController = controller;
      const timeoutId = setTimeout(() => controller.abort(), PASSENGER_RIDE_POLL_TIMEOUT_MS);
      let res;
      try {
        res = await pollRide(ride.tripId, passengerCursor, { signal: controller.signal });
      } catch {
        return;
      } finally {
        clearTimeout(timeoutId);
        if (passengerPollController === controller) passengerPollController = null;
        passengerPollBusy = false;
      }
      if (destroyed || controller.signal.aborted || !res) return;
      if (res.cursor) passengerCursor = res.cursor;
      if (res.status && res.status !== ride.status) {
        const remountResult = maybeReMount(res.status);
        if (remountResult === PASSENGER_REMOUNT_RESULT.NAVIGATED) {
          stopPassengerRidePoll();
        }
      }
    }, PASSENGER_RIDE_POLL_MS);
  }

  async function runInitialRead(recovery = false) {
    const epoch = ++readEpoch;
    if (hasUsableLocalRide) {
      root.dataset.refreshState = 'loading';
      renderLoadedRide(true);
    } else {
      setReadState(PASSENGER_RIDE_READ_STATE.LOADING);
    }
    try {
      const srv = await readManager.run(ride.tripId);
      if (destroyed || epoch !== readEpoch) return;
      if (!srv) {
        backendRide = false;
        setPassengerRideOwnership(PASSENGER_RIDE_OWNERSHIP.LOCAL_ONLY);
        setPassengerMutationBlocked(false);
        stopPassengerRideRecovery();
        delete root.dataset.refreshState;
        // #887 — a store transition can land while this screen was still
        // UNCONFIRMED (no 'storage' subscription yet). Re-read once now that
        // LOCAL_ONLY ownership settles so that missed pre-subscription write
        // cannot strand the passenger on an older lifecycle stage.
        if (reconcileLocalOnlyRide() === PASSENGER_REMOUNT_RESULT.NAVIGATED) return;
        renderLoadedRide(true);
        return;
      }
      backendRide = true;
      setPassengerRideOwnership(PASSENGER_RIDE_OWNERSHIP.SERVER_BACKED);
      setPassengerMutationBlocked(false);
      stopPassengerRideRecovery();
      delete root.dataset.refreshState;
      // Codex follow-up — a non-null srv here is already proof the trip is
      // real, but maybeReMount below can navigate or defer (return) before
      // `ride = mergeServerRide(...)` ever runs. Repair any existing stored
      // record's waiting projection right here, before any such early
      // return, so every successful server read — including one that
      // immediately remounts on a forward status — reaches storage.
      persistPassengerServerConfirmedWaitingProjection(mergeServerWaiting(ride.waiting, srv.waiting));
      if (srv.status && srv.status !== ride.status) {
        const remountResult = maybeReMount(srv.status);
        if (remountResult === PASSENGER_REMOUNT_RESULT.NAVIGATED) return;
        if (remountResult === PASSENGER_REMOUNT_RESULT.DEFERRED) {
          startPassengerRidePoll();
          return;
        }
      }
      ride = mergeServerRide(srv, recovery);
      renderLoadedRide(recovery);
      startPassengerRidePoll();
    } catch (err) {
      if (destroyed || epoch !== readEpoch) return;
      if (err && (err.name === 'AbortError' || err.code === 'ABORTED')) return;
      // A 404 preserves an existing local/canonical ride, but an unknown trip
      // with no usable local source is genuinely empty rather than a demo ride.
      if (err && (err.status === 404 || err.code === 'RIDE_NOT_FOUND')) {
        backendRide = false;
        setPassengerRideOwnership(PASSENGER_RIDE_OWNERSHIP.LOCAL_ONLY);
        setPassengerMutationBlocked(false);
        stopPassengerRideRecovery();
        delete root.dataset.refreshState;
        if (reconcileLocalOnlyRide() === PASSENGER_REMOUNT_RESULT.NAVIGATED) return;
        if (hasUsableLocalRide) renderLoadedRide(recovery);
        else setReadState(PASSENGER_RIDE_READ_STATE.EMPTY);
        return;
      }
      const retryable = isPassengerRideRecoveryRetryable(err);
      const permanentFailure = !retryable;
      const authFailure = isPassengerRideAuthorizationFailure(err);
      backendRide = false;
      if (permanentFailure && hasUsableLocalRide) setPassengerMutationBlocked(true);
      if (hasUsableLocalRide) {
        root.dataset.refreshState = 'error';
        renderLoadedRide(recovery);
        if (!recovery) toast(permanentFailure && hasPersistedLocalRide
          ? (authFailure
            ? 'Не удалось подтвердить авторизацию. Изменение статуса временно недоступно.'
            : 'Не удалось подтвердить данные поездки. Изменение статуса временно недоступно.')
          : 'Не удалось обновить поездку. Показаны сохранённые данные.');
        if (retryable && hasPersistedLocalRide) schedulePassengerRideRecovery();
        else stopPassengerRideRecovery();
        return;
      }
      setReadState(PASSENGER_RIDE_READ_STATE.ERROR);
    }
  }

  function retryInitialRead() {
    if (destroyed) return;
    const stableFocus = top.querySelector('#arp-collapse');
    if (stableFocus && typeof stableFocus.focus === 'function') stableFocus.focus();
    if (fixture) {
      if (fixture !== PASSENGER_RIDE_READ_STATE.ERROR) return;
      if (fixtureRetryId) clearTimeout(fixtureRetryId);
      setReadState(PASSENGER_RIDE_READ_STATE.LOADING);
      fixtureRetryId = setTimeout(() => {
        fixtureRetryId = null;
        if (destroyed) return;
        setReadState(PASSENGER_RIDE_READ_STATE.ERROR);
      }, PASSENGER_RIDE_FIXTURE_RETRY_MS);
      return;
    }
    stopPassengerRideRecovery();
    stopPassengerRidePoll();
    runInitialRead();
  }

  // Route replacement / teardown abort both the bounded initial read and any
  // in-flight realtime poll. The observer handles router replaceChildren();
  // hashchange handles navigation before the detached-root mutation arrives.
  const initialHash = window.location.hash || '';
  const onHashChange = () => {
    if ((window.location.hash || '') !== initialHash) teardownPassengerReads();
  };
  window.addEventListener('hashchange', onHashChange);
  // #887 — LOCAL_ONLY forward reconciliation subscribes for the life of this
  // mounted screen only; teardownPassengerReads() (hashchange above /
  // detached-root below) always removes it, matching the SERVER_BACKED
  // poll/read teardown symmetry. Fixture screens stay fully inert.
  if (!fixture) window.addEventListener('storage', onActiveRideStorage);
  let rootWasConnected = false;
  const teardownObserver = new MutationObserver(() => {
    if (document.body.contains(root)) {
      rootWasConnected = true;
      flushDeferredPassengerStatus();
    } else if (rootWasConnected) {
      teardownPassengerReads();
      teardownObserver.disconnect();
      window.removeEventListener('hashchange', onHashChange);
    }
  });
  teardownObserver.observe(document.body, { childList: true, subtree: true });

  setReadState(readState);
  if (!fixture && backendRead) runInitialRead();

  return root;
}
