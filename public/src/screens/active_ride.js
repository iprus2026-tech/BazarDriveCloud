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
} from '../mock_api.js';
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

// BD-RIDE-D-SHEETS-01 — Driver cancel reasons / problem types and the
// cancel + problem sheet UI now live in active_ride_driver_sheets.js (the
// driver counterpart of active_ride_passenger_sheets.js). This screen only
// imports the openers + the reason-label lookup used by the canceled stub.

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

// Keep the address-bar ?status= in sync after a driver lifecycle hop so a
// reload reflects the real persisted phase. Uses replaceState (no hashchange,
// so the router does not re-render mid-flow) and only rewrites the param when
// one is already present, leaving status-less entry URLs untouched. The
// safeApplyStatusFromQuery guard is the durable backstop; this just keeps the
// visible URL honest.
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
    // BD-RIDE-D-10 — In-memory override only. ?status= must not
    // permanently rewrite the stored canonical record; later user
    // actions (accept / cancel / etc.) persist via updateActiveRideStatus.
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
    // A stale ?status=DRIVER_EN_ROUTE (the address bar still carries the
    // entry status after the driver tapped "Подъезжаю") must not pull a ride
    // that already advanced to DRIVER_APPROACHING_PICKUP back to the en-route
    // phase on reload — that would re-enable the approaching auto-message.
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

  // BD-ORDER-P-09 — active_ride.v1 is the status source while the driver
  // lifecycle is running, but Feed/DriverMap read ride_orders.v1. Keep the
  // canonical order moving forward as active ride actions persist, including
  // a defensive CREATED→ACCEPTED bridge for older handoffs that failed to
  // mark the order accepted before the driver completed the trip.
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
    // senderRole pins the author so a passenger-facing chat renders this
    // driver auto-notice as incoming. `dir: 'out'` stays for back-compat
    // (it is outgoing from the driver's own perspective); the chat renderer
    // prefers senderRole when deciding which side of the thread to show.
    list.push({ id: Date.now(), dir: 'out', senderRole: 'driver', text, time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}` });
    store[chatId] = list;
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // storage unavailable — fail soft.
  }
}

function renderPassenger() {
  const query = getHashQuery();
  // BD-MAP-06 — Passenger order → DriverMap handoff. With no explicit
  // tripId in the URL, resolve the passenger's most recent driver-taken
  // order so the screen shows their real handed-off trip (shared
  // active_ride.v1 record, orderId-linked) instead of the demo ride.
  // Falls back to the demo trip when no live order has been accepted.
  const tripId = query.get('tripId')
    || findLatestHandedOffOrderTripId()
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

// BD-RIDE-D-09 — builds the mock earnings payload for DriverEarningsSheet.
// Fixed 12% commission + a mock tip so the net equals the noncash balance
// delta (1 475 ₽). Every value is pre-formatted here so the sheet module
// stays data-free (it never imports ride_state). No real payments, no real
// balances, no tax/accounting math — UI hints only.
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
  // BD-RIDE-D-11 — passenger + trip context for the completed earnings sheet
  // (issue #403). Pre-formatted here so the sheet module stays data-free.
  const tripNumber = ride.order?.number;
  return {
    // BD-RIDE-D-09 follow-up (Codex #3) — expose the raw numerics so
    // renderCompleted persists the exact earnings the sheet shows. The sheet
    // itself only reads the *Label fields below; these are for history parity.
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
    // BD-RIDE-D-11 — passenger context row + trip-number eyebrow.
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

  const rawTripId = query.get('tripId');
  // BD-ORDER-P-08 — DriverMap accept → ActiveRide handoff. Driver
  // mirrors the passenger resolver: when the URL omits tripId, look up
  // the latest live handed-off order before falling back to the demo id.
  // findLatestHandedOffOrderTripId() skips terminal canonical rides, so
  // completed/canceled/no-show trips do not reopen from the bare driver URL.
  const latestHandedOffTripId = rawTripId ? null : findLatestHandedOffOrderTripId();
  const tripId = rawTripId || latestHandedOffTripId || DEMO_ACTIVE_RIDE_ID;
  const statusQuery = query.get('status');
  // BD-RIDE-D-09 — entry stage for the driver completion sheet
  // (?state=summary|cash|noncash|shift|loading|closed|empty). Ignored by
  // every other status; the sheet itself falls back to "summary".
  //
  // BD-RIDE-D-09 polish — `?payment=cash|noncash` is the documented
  // manual-test URL for the cash / noncash earnings variants. When `?state`
  // is absent we map the payment query onto the equivalent entry stage so
  // operators don't need to know about the internal state name. Unknown
  // payment values fall through to the sheet's own "summary" default.
  const paymentQuery = (query.get('payment') || '').toLowerCase();
  const earningsState = query.get('state')
    || (paymentQuery === 'cash' || paymentQuery === 'noncash' ? paymentQuery : null);
  // BD-RIDE-D-WAITING-01 — ?wait=expired forces the paid-wait variant of the
  // WAITING_PASSENGER sheet (mock/demo entry; no live timer drives it). Mutable
  // so «Ещё подождать» can return to the free-wait view in the same session.
  let waitExpired = (query.get('wait') || '').toLowerCase() === 'expired';
  // BD-RIDE-D-10 — Cross-role canonical lookup. Reads any persisted
  // active-ride record first, then tries to seed from a confirmed
  // handoff for either role so driver and passenger converge on one
  // canonical trip identity (passenger, driver, vehicle, route, fare).
  let ride = loadCanonicalActiveRide({ tripId, role: 'driver' });
  // BD-HANDOFF-05 — replace generic/demo strings with the driver-side
  // confirmed handoff snapshot (passenger name, pickup/dropoff labels,
  // agreed price, arrival ETA) when one was pinned right before the
  // /trip-confirmation → /active-ride?role=driver hop. A snapshot is
  // sufficient on its own to materialize the driver sheet: when no
  // ?status= is supplied we fall back to the snapshot's own status
  // (DRIVER_EN_ROUTE by default) instead of the empty placeholder.
  let effectiveStatusQuery = statusQuery;
  if (!ride) {
    const driverSnapshot = loadDriverHandoffSnapshot(tripId);
    const hasValidStatusQuery = statusQuery && DRIVER_SIMULATION_STATUSES.has(statusQuery);
    // BD-RIDE-D-10 / BD-ORDER-P-08 — Only show the driver empty
    // placeholder when nothing can identify a real/simulated ride: no
    // explicit tripId, no latest live DriverMap handoff, no valid status
    // simulation, no driver handoff snapshot, and no canonical ride.
    const hasExplicitTripId = Boolean(rawTripId);
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
    }
  }
  ride = safeApplyStatusFromQuery(ride, effectiveStatusQuery);

  function persistDriverRideStatus(nextStatus, patch = {}) {
    // BD-ACTIVE-RIDE-TERM-01 P2 follow-up — when the driver is on a
    // status-simulated demo (loadCanonicalActiveRide returned null
    // and we built `ride` via createDemoActiveRide / handoff
    // snapshot above), the ride hasn't been persisted to
    // `bazardrive.active_ride.v1` yet. The terminal-write existing-
    // ride guard inside `updateActiveRideStatus` refuses unknown
    // tripIds for CANCELED / NO_SHOW / COMPLETED — so a legitimate
    // Finish / No-show / Cancel click on a status-simulated ride
    // would otherwise silently fall back to the in-memory snapshot
    // and the screen would never advance. Pre-save the in-memory
    // ride once so the terminal write has an existing record to
    // mutate. Idempotent: when the ride is already in the store,
    // the saveActiveRide terminal-record freeze either passes through
    // (non-terminal snapshot, non-terminal stored) or refuses
    // verbatim (terminal already landed); either way the
    // updateActiveRideStatus call right after sees the canonical
    // store state.
    if (!findActiveRide(ride.tripId)) saveActiveRide(ride);
    const nextRide = updateActiveRideStatus(ride.tripId, nextStatus, patch);
    // BD-ACTIVE-RIDE-TERM-01 — only sync the canonical order when the
    // status actually changed to `nextStatus`. `updateActiveRideStatus`
    // returns the existing terminal record verbatim on refused
    // transitions (CANCELED / NO_SHOW / COMPLETED → non-terminal), so
    // without this guard `syncCanonicalOrderStatus` would write the
    // stale requested status (e.g. IN_PROGRESS / COMPLETED) onto the
    // canonical order even though the active ride record didn't move.
    if (nextRide && nextRide.status === nextStatus) {
      syncCanonicalOrderStatus(nextRide, nextStatus);
    }
    return nextRide || ride;
  }
  // BD-RIDE-D-10 — Driver-initiated cancel and no-show persist the same
  // `cancel: { by, reason }` metadata shape passenger cancel already uses
  // (see active_ride_passenger). It is informational only — terminal status
  // is still the single source of truth for ride_state and the canonical
  // order — but it lets the canceled stub explain *why* the trip closed.
  function persistDriverCancel(nextStatus, reasonCode) {
    return persistDriverRideStatus(nextStatus, {
      cancel: { by: 'driver', reason: reasonCode || 'other' },
    });
  }

  const root = document.createElement('section');
  root.className = 'screen screen--active-ride';
  const mapWrap = document.createElement('div');
  mapWrap.className = 'active-ride__map';
  // BD-RIDE-D-09 follow-up (Codex #2) — keep a handle on the map shell so
  // renderSheet() can re-sync its data-status as ride.status changes. Without
  // this the COMPLETED polish (hidden car marker, green finish pin) only
  // applied after a reload, since the shell is created once up front.
  const mapShell = createMapShell({ variant: 'driver', status: ride.status, route: ride.route });
  mapWrap.appendChild(mapShell);
  root.appendChild(mapWrap);

  // BD-LIFE-07 — Drop the '5ч 12м' demo fallback from the driver status
  // pill. BD-LIFE-06 stops writing shiftDuration onto real accepted rides
  // (the snapshot from buildAcceptedDriverSnapshot omits it entirely
  // because profiles don't track shift duration), so a `|| '5ч 12м'`
  // chain here would leak the demo seed onto every real DriverMap accept.
  // Render the separator + time only when shiftDuration is actually
  // present; legacy demo paths still carry the field on ride.driver from
  // buildDemoRide() so they keep showing "На линии | 5ч 12м" unchanged.
  const shiftDuration = ride.driver?.shiftDuration || '';
  const shiftPillSuffix = shiftDuration
    ? `<span class="active-ride__status-sep" aria-hidden="true">|</span><span class="active-ride__status-time">${escapeHtml(shiftDuration)}</span>`
    : '';
  const top = document.createElement('div');
  top.className = 'active-ride__top';
  top.innerHTML = `
    <div class="active-ride__status-row"><button type="button" class="bd-iconbtn active-ride__icon-btn" id="ar-gear" aria-label="Настройки смены">⚙</button><div class="active-ride__status-pill" role="status" aria-live="polite"><span class="active-ride__status-dot" aria-hidden="true"></span><span class="active-ride__status-text">${escapeHtml(ride.driver?.onlineLabel || 'На линии')}</span>${shiftPillSuffix}</div><button type="button" class="bd-iconbtn active-ride__icon-btn" id="ar-shield" aria-label="Безопасность">🛡</button></div>
    <div class="active-ride__stats" role="group" aria-label="Статистика смены"><div class="active-ride__stat"><div class="active-ride__stat-value">${escapeHtml(ride.ride?.todayEarnings || '0 ₽')}</div><div class="active-ride__stat-label">сегодня</div></div><div class="active-ride__stat"><div class="active-ride__stat-value">${escapeHtml(String(ride.ride?.tripsToday ?? 0))}</div><div class="active-ride__stat-label">поездок</div></div><div class="active-ride__stat"><div class="active-ride__stat-value">★ ${escapeHtml(ride.ride?.rating || '—')}</div><div class="active-ride__stat-label">рейтинг</div></div></div>
    <div class="active-ride__map-banner" id="ar-map-banner" hidden><span class="active-ride__map-banner-dot" aria-hidden="true"></span><span class="active-ride__map-banner-text"></span></div>
  `;
  root.appendChild(top);

  const sheet = document.createElement('div');
  sheet.className = 'active-ride__sheet';
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
  top.querySelector('#ar-gear').addEventListener('click', () => showNotice('Настройки смены будут добавлены позже'));
  // BD-RIDE-D-SAFETY-01 — the top-bar shield opens the driver safety sheet
  // (share / emergency-112 demo / support). Demo-only: toast feedback via
  // onAction → showNotice, no ride-status change, no problem-report (that is
  // #ar-issue), no passenger-sheet reuse.
  top.querySelector('#ar-shield').addEventListener('click', () => openDriverSafetySheet(root, { onAction: showNotice }));

  function passengerRowHtml(passenger) {
    const note = passenger.note || passenger.comment || '';
    return `<div class="active-ride__passenger"><div class="active-ride__passenger-main"><div class="active-ride__avatar" aria-hidden="true">${escapeHtml(passenger.initials || 'АМ')}</div><div class="active-ride__passenger-info"><div class="active-ride__passenger-name">${escapeHtml(passenger.name || '')}<span class="active-ride__passenger-rating">★ ${escapeHtml(passenger.rating || '')}</span></div><div class="active-ride__passenger-meta">${escapeHtml(passenger.phoneMasked || '')}${passenger.luggage ? ` · ${escapeHtml(passenger.luggage)}` : ''}</div></div></div><div class="active-ride__passenger-actions"><button type="button" class="active-ride__icon-action" id="ar-msg" aria-label="Написать пассажиру">💬</button><button type="button" class="active-ride__icon-action" id="ar-call" aria-label="Позвонить пассажиру">☎</button></div></div>${note ? `<div class="active-ride__passenger-note">${escapeHtml(note)}</div>` : ''}`;
  }

  function bindPassengerActions() {
    const msgBtn = sheet.querySelector('#ar-msg');
    if (msgBtn) msgBtn.addEventListener('click', () => go(`/chat?tripId=${encodeURIComponent(ride.tripId)}&role=driver`));
    const callBtn = sheet.querySelector('#ar-call');
    if (callBtn) callBtn.addEventListener('click', () => showNotice('Звонок пассажиру пока заглушка'));
  }

  function renderSheet() {
    sheet.replaceChildren();
    sheet.dataset.status = ride.status;
    mapShell.dataset.status = ride.status;
    setMapBanner('');
    if (ride.status === RIDE_STATUS.NEW_ORDER) renderNewOrder();
    else if (ride.status === RIDE_STATUS.ACCEPTED) renderAccepted();
    else if (ride.status === RIDE_STATUS.DRIVER_EN_ROUTE) renderEnRoute();
    else if (ride.status === RIDE_STATUS.DRIVER_APPROACHING_PICKUP) renderApproaching();
    else if (ride.status === RIDE_STATUS.WAITING_PASSENGER) renderWaiting();
    else if (ride.status === RIDE_STATUS.IN_PROGRESS) renderInProgress();
    else if (ride.status === RIDE_STATUS.COMPLETED) renderCompleted();
    else if (ride.status === RIDE_STATUS.CANCELED || ride.status === RIDE_STATUS.NO_SHOW) renderCanceledStub();
    else renderGenericStub();
  }

  function routeRows() {
    return `<ul class="active-ride__route-list" role="list"><li class="active-ride__route-point active-ride__route-point--pickup"><div class="active-ride__route-time">${escapeHtml(ride.order?.pickupEta || '')}</div><div class="active-ride__route-body"><div class="active-ride__route-main">${escapeHtml(ride.route?.pickupLabel || '')}</div><div class="active-ride__route-sub">${escapeHtml(ride.order?.pickupDistance || '')} до пассажира</div></div></li><li class="active-ride__route-point active-ride__route-point--dropoff"><div class="active-ride__route-time">${escapeHtml(ride.order?.destinationEta || '')}</div><div class="active-ride__route-body"><div class="active-ride__route-main">${escapeHtml(ride.route?.dropoffLabel || '')}</div><div class="active-ride__route-sub">${escapeHtml(ride.order?.destinationDistance || '')} · ${escapeHtml(ride.order?.destinationNote || '')}</div></div></li></ul>`;
  }

  function renderNewOrder() {
    const tagsHtml = (ride.order?.tags || []).map((t) => `<span class="active-ride__tag">${escapeHtml(t)}</span>`).join('');
    sheet.innerHTML = `<div class="active-ride__sheet-head"><div class="active-ride__sheet-title"><span class="active-ride__sheet-bullet" aria-hidden="true">●</span>НОВЫЙ ЗАКАЗ</div><div class="active-ride__timer">${escapeHtml(String(ride.order?.acceptTimerSec ?? 14))}</div></div><div class="active-ride__price-row"><div class="active-ride__price-col"><div class="active-ride__price">${escapeHtml(ride.order?.offerPrice || '')}</div><div class="active-ride__meta">${escapeHtml(ride.order?.rate || '')} · комиссия ${escapeHtml(ride.order?.commission || '')}</div></div><button type="button" class="active-ride__map-btn" id="ar-map-btn">Карта</button></div>${routeRows()}${tagsHtml ? `<div class="active-ride__tags" role="list">${tagsHtml}</div>` : ''}<div class="active-ride__actions"><button type="button" class="bd-btn ghost active-ride__btn-skip" id="ar-skip">Пропустить</button><button type="button" class="bd-btn primary active-ride__btn-accept" id="ar-accept">Принять заказ</button></div>`;
    sheet.querySelector('#ar-map-btn').addEventListener('click', () => showNotice('Детальная карта будет доступна после Mapbox integration'));
    sheet.querySelector('#ar-accept').addEventListener('click', () => { ride = persistDriverRideStatus(RIDE_STATUS.DRIVER_EN_ROUTE); renderSheet(); });
    sheet.querySelector('#ar-skip').addEventListener('click', () => showNotice('Заказ пропущен. Полный idle-flow будет добавлен позже.'));
  }

  function navCard() {
    return `<div class="active-ride__nav-card"><div class="active-ride__nav-icon" aria-hidden="true">➜</div><div class="active-ride__nav-body"><div class="active-ride__nav-main">${escapeHtml(ride.route?.currentInstruction || '')}</div><div class="active-ride__nav-sub">${escapeHtml(ride.route?.currentStreet || '')}</div></div><button type="button" class="active-ride__map-btn" id="ar-nav-btn">Навигатор</button></div>`;
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
    // BD-RIDE-D — entering DRIVER_APPROACHING_PICKUP auto-notifies the
    // passenger via the chat store, so the standalone "написать подъезжаю"
    // button is no longer needed.
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

  function renderWaiting() {
    if (waitExpired) { renderWaitingExpired(); return; }
    const waiting = ride.waiting || {};
    const remaining = waiting.remaining || '2:30';
    const freeLimit = waiting.freeLimit || '3:00';
    setMapBanner('Пассажир уведомлён · ждёт у подъезда');
    sheet.innerHTML = `<div class="active-ride__sheet-head"><div class="active-ride__sheet-head-main"><div class="active-ride__sheet-title">Ожидание пассажира</div><div class="active-ride__sheet-sub">Платное ожидание начнётся в ${escapeHtml(waiting.paidStartsAt || '14:18')}</div></div><div class="ns-timer tone-success"><svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="none" stroke="var(--bg-3)" stroke-width="5"/><circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-dasharray="163.36" stroke-dashoffset="${(163.36 * (1 - progressStep(remaining, freeLimit) / 10)).toFixed(2)}" transform="rotate(-90 32 32)"/></svg><div class="ns-timer-center"><div class="ns-timer-val">${escapeHtml(remaining)}</div></div><div class="ns-timer-lbl">бесплатно</div></div></div><div class="active-ride__waiting-card"><div class="active-ride__waiting-card-head"><span class="active-ride__waiting-card-title">Бесплатное ожидание</span><span class="active-ride__waiting-card-value">${escapeHtml(remaining)} / ${escapeHtml(freeLimit)}</span></div><div class="active-ride__progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressStep(remaining, freeLimit) * 10}"><div class="active-ride__progress-bar-fill" data-step="${progressStep(remaining, freeLimit)}"></div></div><div class="active-ride__waiting-card-foot">Дальше — ${escapeHtml(waiting.paidRate || '8 ₽ за каждую минуту')}</div></div>${passengerRowHtml(ride.passenger || {})}<div class="active-ride__actions active-ride__actions--stack"><button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-start">Начать поездку</button><div class="active-ride__secondary-actions"><button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-call-passenger">Позвонить пассажиру</button><button type="button" class="bd-btn ghost active-ride__btn-cancel" id="ar-no-show">Не приехал</button></div></div>`;
    sheet.querySelector('#ar-start').addEventListener('click', () => { ride = persistDriverRideStatus(RIDE_STATUS.IN_PROGRESS); renderSheet(); });
    sheet.querySelector('#ar-call-passenger').addEventListener('click', () => showNotice('Звонок пассажиру пока заглушка'));
    // BD-RIDE-D-NOSHOW-01 — «Не приехал» opens the dedicated no-show sub-flow
    // (action → confirm → result → compensation → done), replacing the prior
    // cancel-sheet preset. The flow renders in place over this sheet and fires
    // the SAME NO_SHOW persist at its confirm step; «Вернуться к ожиданию» /
    // close re-render the waiting state. Mock-only: the compensation figures
    // are demo values, no backend.
    sheet.querySelector('#ar-no-show').addEventListener('click', () => openDriverNoShowFlow(sheet, {
      ride,
      onConfirmNoShow: () => { ride = persistDriverCancel(RIDE_STATUS.NO_SHOW, 'passenger_no_show'); },
      onBack: () => renderSheet(),
      go,
      showNotice,
    }));
    bindPassengerActions();
  }

  // BD-RIDE-D-WAITING-01 — paid-wait variant (free wait elapsed). Reached via
  // ?wait=expired or «Ещё подождать» toggling back. Mock/demo figures; the
  // «Пассажир не вышел» danger action opens the same no-show flow.
  function renderWaitingExpired() {
    const waiting = ride.waiting || {};
    const accrued = waiting.paidAccrued || '180 ₽';
    const paidElapsed = waiting.paidElapsed || '2:14';
    const paidRate = waiting.paidRate || '8 ₽/мин';
    setMapBanner('Платное ожидание · пассажир не выходит');
    sheet.innerHTML = `<div class="ns-alert warning"><span class="ns-alert-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span><div class="ns-alert-body"><div class="ns-alert-title">Бесплатное ожидание закончилось</div><div class="ns-alert-sub">Идёт платное ожидание · начислено ${escapeHtml(accrued)}</div></div></div><div class="active-ride__sheet-head"><div class="active-ride__sheet-head-main"><div class="active-ride__sheet-title">Пассажир не выходит</div><div class="active-ride__sheet-sub">Платное ожидание · ${escapeHtml(paidRate)}</div></div><div class="ns-timer tone-warning"><svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="none" stroke="var(--bg-3)" stroke-width="5"/><circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-dasharray="163.36" stroke-dashoffset="62.08" transform="rotate(-90 32 32)"/></svg><div class="ns-timer-center"><div class="ns-timer-val">${escapeHtml(paidElapsed)}</div></div><div class="ns-timer-lbl">платно</div></div></div>${passengerRowHtml(ride.passenger || {})}<div class="ns-hint"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg><span>Позвоните пассажиру перед тем, как отметить, что он не вышел.</span></div><div class="active-ride__actions active-ride__actions--stack"><button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-call-passenger">Позвонить пассажиру</button><div class="active-ride__secondary-actions"><button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-wait-more">Ещё подождать</button><button type="button" class="bd-btn ghost active-ride__btn-cancel" id="ar-no-show">Пассажир не вышел</button></div></div>`;
    sheet.querySelector('#ar-call-passenger').addEventListener('click', () => showNotice('Звонок пассажиру пока заглушка'));
    sheet.querySelector('#ar-wait-more').addEventListener('click', () => { waitExpired = false; renderWaiting(); });
    sheet.querySelector('#ar-no-show').addEventListener('click', () => openDriverNoShowFlow(sheet, {
      ride,
      onConfirmNoShow: () => { ride = persistDriverCancel(RIDE_STATUS.NO_SHOW, 'passenger_no_show'); },
      onBack: () => renderSheet(),
      go,
      showNotice,
    }));
    bindPassengerActions();
  }

  function renderInProgress() {
    const finishPrice = ride.ride?.price || '';
    sheet.innerHTML = `<div class="active-ride__sheet-head"><div class="active-ride__sheet-head-main"><div class="active-ride__sheet-title">Везёте пассажира</div><div class="active-ride__sheet-sub">${escapeHtml(ride.route?.dropoffLabel || '')}</div></div><div class="active-ride__pickup-eta active-ride__pickup-eta--progress"><div class="active-ride__pickup-eta-value">${escapeHtml(ride.route?.etaToDestination || '')}</div><div class="active-ride__pickup-eta-label">до места</div></div></div>${navCard()}${passengerRowHtml(ride.passenger || {})}<div class="active-ride__actions active-ride__actions--stack"><button type="button" class="bd-btn primary active-ride__btn-primary" id="ar-finish">Завершить${finishPrice ? ` · ${escapeHtml(finishPrice)}` : ''}</button><div class="active-ride__secondary-actions"><button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-stop">+ Остановка</button><button type="button" class="bd-btn ghost active-ride__btn-sec" id="ar-issue">Проблема</button></div></div>`;
    sheet.querySelector('#ar-nav-btn').addEventListener('click', () => showNotice('Навигатор будет доступен после Mapbox integration'));
    sheet.querySelector('#ar-finish').addEventListener('click', () => { ride = persistDriverRideStatus(RIDE_STATUS.COMPLETED); renderSheet(); });
    sheet.querySelector('#ar-stop').addEventListener('click', () => showNotice('Добавление остановки будет доступно позже'));
    sheet.querySelector('#ar-issue').addEventListener('click', () => openDriverProblemSheet(root, { onAction: showNotice }));
    bindPassengerActions();
  }

  function renderCompleted() {
    // BD-RIDE-D-09 — the completed driver flow is now the seven-state
    // DriverEarningsSheet (active_ride_driver_sheets.js) mounted over the
    // completed map shell, replacing the old inline completion card. Ride
    // history is still persisted here exactly as before; only the visible
    // card was swapped for the terminal sheet.
    //
    // BD-RIDE-D-09 follow-up (Codex #3) — history is now derived from the same
    // payload the sheet renders, so the profile receipt and the sheet never
    // disagree (net 1 475 ₽, 12% commission + tip). order.commission on the
    // shared demo ride is never mutated.
    const payload = buildDriverEarningsPayload(ride);
    // BD-RIDE-HISTORY-D-01 (issue #381) — net is computed ONCE here (in
    // buildDriverEarningsPayload). Persist the canonical receipt object so
    // ride history, Driver payouts and the /receipt screen can READ the same
    // stored fare / commission / tip / net and never recompute them. The
    // ?state=cash entry stage marks a cash-collected fare; everything else
    // records a non-cash (balance) settlement. commission is stored signed.
    //
    // PR #382 (Codex #1) — re-rendering COMPLETED must be idempotent. Reopening
    // /active-ride?role=driver&status=COMPLETED without ?state=cash would
    // otherwise re-run saveDriverReceipt() and silently flip an already-saved
    // cash receipt back to noncash. So the receipt is written only on the FIRST
    // completion; once one exists for this tripId its whole money payload
    // (fare/commission/tip/net/paymentMode) is preserved verbatim.
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
      // History reads the persisted receipt — no recalculation. The legacy
      // earnings block is kept (sourced from the same single payload) so older
      // calendar/aggregate readers still resolve a net while they migrate.
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
    // The bottom sheet stays empty so the completed map + chrome read as a
    // calm background; the earnings overlay (mounted on root) is the UI.
    sheet.innerHTML = '';
    // BD-RIDE-D-09 follow-up (Codex #1) — dismissing the sheet (X / backdrop /
    // Escape) must leave an exit; without onClose the driver was stranded on a
    // blank completed map. /driver-map is the online driver's home route.
    openDriverEarningsSheet(root, {
      state: earningsState,
      payload,
      onClose:   () => go('/driver-map'),
      onOrders:  () => go('/driver-map'),
      onFeed:    () => go('/feed'),
      // BD-RIDE-D-09 polish — explicit "В историю поездок" exit, mirroring
      // the passenger COMPLETED handoff (BD-RIDE-P-08). The history section
      // lives inside the profile (passenger main view + driver overview pane,
      // both anchored as #profile-history-section), so deep-link via
      // ?section=history so the profile screen scrolls the history into view
      // instead of dropping the driver at the top of the overview.
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

  renderSheet();
  return root;
}
