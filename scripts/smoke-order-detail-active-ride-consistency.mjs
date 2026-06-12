// BD-ORDER-DETAIL-01D-3 — selected-driver / active-ride consistency
// audit smoke.
//
// BD-ORDER-DETAIL-01D-2A/B locked the passenger select-driver commit
// and the active-ride open-trip handoff in isolation; BD-ACTIVE-RIDE-
// TERM-01 locked the active-ride terminal contract. This smoke locks
// the CONSISTENCY contract spanning all three surfaces in one place:
// once a passenger selects driver A, every downstream reader (driver
// renderer, passenger renderer, active-ride seed, persisted active
// ride record) sees the SAME selectedDriverId, the SAME route, the
// SAME passenger snapshot, and the SAME driver snapshot — and stale
// peer offers (withdrawn / expired / rejected) can NEVER pose as the
// selected driver through any path.
//
// Audit pins (no runtime code touched):
//
//   1. Only `status='sent'` DriverOffers may be selected.
//   2. After commit, the overlay's `selectedDriverId` matches the
//      chosen offer's `driverId`; the assigned-driver card on D3 /
//      the open-trip seed both pull from THAT offer.
//   3. Competing sent peers flip to `rejected` and can no longer
//      satisfy `commitPassengerSelection`'s sent-only guard.
//   4. Pre-existing terminal offers (withdrawn / expired / rejected)
//      are preserved verbatim through the commit AND refuse to become
//      the selected driver if a stale snapshot tries to nominate them.
//   5. `buildPassengerActiveRideSeed` uses the chosen offer's snapshot
//      (driver name / car / rating / etaMin / price), NOT the demo
//      fallback identity.
//   6. The passenger handoff to `/active-ride` carries the same
//      `selectedDriverId` and persists it via `saveActiveRide`.
//   7. The driver-side view on the same `orderId` resolves to D3 and
//      pulls the SAME passenger snapshot + route from the order.
//   8. Terminal orders (CANCELED / EXPIRED) hide every select-driver
//      CTA on the passenger surface and route to D4 on the driver
//      surface.
//   9. Cancelling the order via the 01D-2C overlay does NOT recreate
//      or revive the active-ride record: `cancelOrderByPassenger`
//      writes ONLY the order overlay; the active-ride store is left
//      untouched (active-ride lifecycle is owned by ride_state.js).
//  10. Source guards: `order_detail.js` does not import
//      receipt / history writers; `driver_offer_store.js` does not
//      import active_ride / receipt / history. The handoff funnels
//      through the canonical `saveActiveRide` helper, not via demo
//      constants like `DEMO_ACTIVE_RIDE_ID`.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// In-memory localStorage shim — same pattern as smoke-order-detail-contract.mjs.
const _bdofs = new Map();
globalThis.localStorage = {
  getItem: (k) => _bdofs.has(k) ? _bdofs.get(k) : null,
  setItem: (k, v) => { _bdofs.set(k, String(v)); },
  removeItem: (k) => { _bdofs.delete(k); },
  clear: () => { _bdofs.clear(); },
};

const ORDER_DETAIL_PATH = '../public/src/screens/order_detail.js';
const orderDetailMod = await import(new URL(ORDER_DETAIL_PATH, import.meta.url).href);
const driverOfferStore = await import(new URL('../public/src/driver_offer_store.js', import.meta.url).href);
const rideState = await import(new URL('../public/src/ride_state.js', import.meta.url).href);

// Source files for the static / source-pin assertions.
const orderDetailSrc      = read('../public/src/screens/order_detail.js');
const driverOfferStoreSrc = read('../public/src/driver_offer_store.js');
const rideStateSrc        = read('../public/src/ride_state.js');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const ACTIVE_RIDE_STORE_KEY = 'bazardrive.active_ride.v1';
const ORDER_OVERLAY_STORE_KEY = 'bazardrive.order_overlay.v1';
const DRIVER_OFFERS_KEY = 'bazardrive.driver_offers.v1';

// BD-ORDER-DETAIL-01D-3 P2 review fix #4 — unified terminal CTA
// forbid-list applied symmetrically to BOTH the passenger P4 and the
// driver D4 markup, AND to both CANCELED (overlay-driven) and EXPIRED
// (fixture-driven) terminal scenarios. The original sweep skipped
// `driver-cancel` on P4 and `reject-offer` on D4 — codifying the full
// set in one constant prevents the asymmetry from reappearing.
const TERMINAL_FORBIDDEN_CTAS = [
  'data-action="select-driver"',
  'data-action="reject-offer"',
  'data-action="open-trip"',
  'data-action="driver-cancel"',
  'data-action="driver-send-offer"',
];

// ── Test scaffolding: seed an order with a known offer mix ──────────
//
// Five competing offers per the task spec:
//   • driver A — sent (will be selected)
//   • driver B — sent (competing; should flip to rejected after commit)
//   • driver C — withdrawn (terminal; preserved verbatim)
//   • driver D — expired (terminal; preserved verbatim)
//   • driver E — rejected (terminal; preserved verbatim)
//
// Each offer carries unique driverName / car / rating / etaMin / price
// fields so we can distinguish them from the demo seed in the seed
// snapshot assertions.

const ORDER_ID = 'consistency-test-order-1';

function mkOffer(orderId, driverId, status, extra = {}) {
  return {
    id: `offer_${orderId}_${driverId}`,
    orderId,
    driverId,
    driverName: `Водитель ${driverId}`,
    car:        `Car-${driverId} · color`,
    rating:     '5,0',
    etaMin:     5,
    price:      1000,
    message:    'mock',
    status,
    createdAt:  '2026-06-12T08:00:00.000Z',
    updatedAt:  '2026-06-12T08:00:00.000Z',
    expiresAt:  '2026-06-12T08:15:00.000Z',
    ...extra,
  };
}

function seedFreshScenario() {
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  rideState.clearActiveRideStore();
  // Plant the five-offer mix directly into the DriverOffer store so
  // listDriverOffersForOrder returns them in a deterministic order.
  _bdofs.set(DRIVER_OFFERS_KEY, JSON.stringify({
    [ORDER_ID]: {
      'drv-A': mkOffer(ORDER_ID, 'drv-A', 'sent', {
        driverName: 'Анна Альфа',  car: 'Audi A4 · чёрный',
        rating: '4,95', etaMin: 3, price: 1200,
      }),
      'drv-B': mkOffer(ORDER_ID, 'drv-B', 'sent', {
        driverName: 'Борис Бета', car: 'BMW 3 · серый',
        rating: '4,88', etaMin: 6, price: 1300,
      }),
      'drv-C': mkOffer(ORDER_ID, 'drv-C', 'withdrawn', {
        driverName: 'Виктор Витрин (отозван)',
      }),
      'drv-D': mkOffer(ORDER_ID, 'drv-D', 'expired', {
        driverName: 'Денис Дельта (истёк)',
      }),
      'drv-E': mkOffer(ORDER_ID, 'drv-E', 'rejected', {
        driverName: 'Евгений Эпсилон (отклонён)',
      }),
    },
  }));
  return driverOfferStore.listDriverOffersForOrder(ORDER_ID);
}

// ── A. Module surface + helper exports ──────────────────────────────
expect('A — order_detail exports commit/consistency helpers',
  typeof orderDetailMod.resolveState === 'function'
  && typeof orderDetailMod.canOpenTrip === 'function'
  && typeof orderDetailMod.buildPassengerActiveRideSeed === 'function'
  && typeof orderDetailMod.renderOrderDetailMarkup === 'function'
  && typeof orderDetailMod.loadOrder === 'function'
  && typeof orderDetailMod.activeSentOffers === 'function');
expect('A — driver_offer_store exports commitPassengerSelection + listDriverOffersForOrder + getOrderOverlay',
  typeof driverOfferStore.commitPassengerSelection === 'function'
  && typeof driverOfferStore.listDriverOffersForOrder === 'function'
  && typeof driverOfferStore.getOrderOverlay === 'function');
expect('A — ride_state exports saveActiveRide + findActiveRide',
  typeof rideState.saveActiveRide === 'function'
  && typeof rideState.findActiveRide === 'function');

// ── B. Only sent DriverOffers may be selected ───────────────────────
{
  const offers = seedFreshScenario();
  expect('B baseline — five offers seeded',
    offers.length === 5);
  // The activeSentOffers helper (rendered into P2 cards) excludes terminal.
  const renderableEntries = orderDetailMod.activeSentOffers({ offers });
  expect('B — activeSentOffers returns ONLY the two sent offers',
    renderableEntries.length === 2
    && renderableEntries.every((o) => o.status === 'sent')
    && renderableEntries.map((o) => o.driverId).sort().join(',') === 'drv-A,drv-B');
  // commitPassengerSelection on a non-sent target must refuse.
  for (const stale of ['drv-C', 'drv-D', 'drv-E']) {
    const refused = driverOfferStore.commitPassengerSelection({
      orderId: ORDER_ID,
      selectedDriverId: stale,
      allOffers: offers,
    });
    expect(`B — commit refuses non-sent target driverId=${stale}`,
      refused === null);
    expect(`B — overlay not created after refused ${stale} commit`,
      driverOfferStore.getOrderOverlay(ORDER_ID) === null);
  }
}

// ── C. selectedDriverId + assigned driver come from the chosen offer ─
{
  const offers = seedFreshScenario();
  const acceptedOffer = driverOfferStore.commitPassengerSelection({
    orderId: ORDER_ID,
    selectedDriverId: 'drv-A',
    allOffers: offers,
  });
  // Commit returned the accepted offer (driver A), now status='accepted'.
  expect('C — commit returns the chosen offer with status="accepted"',
    !!acceptedOffer
    && acceptedOffer.driverId === 'drv-A'
    && acceptedOffer.status === 'accepted');
  expect('C — chosen offer driverName preserved from snapshot, not demo',
    acceptedOffer?.driverName === 'Анна Альфа');
  // Overlay carries the ACCEPTED status + matching selectedDriverId.
  const overlay = driverOfferStore.getOrderOverlay(ORDER_ID);
  expect('C — overlay.status === ACCEPTED',
    overlay?.status === 'ACCEPTED');
  expect('C — overlay.selectedDriverId === drv-A (matches chosen offer)',
    overlay?.selectedDriverId === 'drv-A');
  // Store-side: driver A is accepted, peer B flipped to rejected.
  expect('C — store: drv-A status === accepted after commit',
    driverOfferStore.getDriverOffer(ORDER_ID, 'drv-A')?.status === 'accepted');
  expect('C — store: drv-B status === rejected (competing sent peer)',
    driverOfferStore.getDriverOffer(ORDER_ID, 'drv-B')?.status === 'rejected');
  // Terminal peers (C/D/E) preserved verbatim.
  expect('C — store: drv-C status === withdrawn (verbatim)',
    driverOfferStore.getDriverOffer(ORDER_ID, 'drv-C')?.status === 'withdrawn');
  expect('C — store: drv-D status === expired (verbatim)',
    driverOfferStore.getDriverOffer(ORDER_ID, 'drv-D')?.status === 'expired');
  expect('C — store: drv-E status === rejected (verbatim)',
    driverOfferStore.getDriverOffer(ORDER_ID, 'drv-E')?.status === 'rejected');
}

// ── D. Competing sent offer B no longer selectable after accept ─────
{
  // State from section C: drv-B is now rejected.
  const offersAfterCommit = driverOfferStore.listDriverOffersForOrder(ORDER_ID);
  const refused = driverOfferStore.commitPassengerSelection({
    orderId: ORDER_ID,
    selectedDriverId: 'drv-B',
    allOffers: offersAfterCommit,
  });
  expect('D — second commit on now-rejected drv-B is refused',
    refused === null);
  // The selectedDriverId stays drv-A; overlay not overwritten.
  const overlay = driverOfferStore.getOrderOverlay(ORDER_ID);
  expect('D — overlay.selectedDriverId stays drv-A after the refused retry',
    overlay?.selectedDriverId === 'drv-A');
  // activeSentOffers excludes both drv-B (now rejected) and the
  // already-terminal drv-C/D/E. Driver A is 'accepted' (not 'sent'),
  // so also excluded.
  const stillSent = orderDetailMod.activeSentOffers({
    offers: offersAfterCommit,
  });
  expect('D — activeSentOffers is empty (drv-A is accepted, every other peer is terminal)',
    stillSent.length === 0);
}

// ── E. Stale snapshot trying to nominate a terminal driver is refused ─
{
  // Reset and try the inverse race: a stale tab still SEES drv-B as
  // 'sent' in its snapshot, but the store has already moved drv-A to
  // 'accepted'. The stale-store guard in commitPassengerSelection must
  // refuse on the snapshot's terminal-actually-rejected peer.
  seedFreshScenario();
  driverOfferStore.commitPassengerSelection({
    orderId: ORDER_ID,
    selectedDriverId: 'drv-A',
    allOffers: driverOfferStore.listDriverOffersForOrder(ORDER_ID),
  });
  // Forge a stale snapshot: drv-B is still 'sent' in the snapshot but
  // 'rejected' in the store.
  const staleSnapshot = [
    {
      ...mkOffer(ORDER_ID, 'drv-B', 'sent'),
      // Snapshot's status='sent' is the lie — store says 'rejected'.
    },
    mkOffer(ORDER_ID, 'drv-A', 'accepted'),
  ];
  const refused = driverOfferStore.commitPassengerSelection({
    orderId: ORDER_ID,
    selectedDriverId: 'drv-B',
    allOffers: staleSnapshot,
  });
  expect('E — stale-snapshot commit on terminal-in-store peer is refused',
    refused === null);
  // Overlay unchanged.
  expect('E — overlay.selectedDriverId still drv-A',
    driverOfferStore.getOrderOverlay(ORDER_ID)?.selectedDriverId === 'drv-A');
  // Store-side terminal peers stay terminal.
  expect('E — drv-B status remains rejected after the stale retry',
    driverOfferStore.getDriverOffer(ORDER_ID, 'drv-B')?.status === 'rejected');
}

// ── F. buildPassengerActiveRideSeed uses chosen offer's snapshot ────
//   The seed builder pulls driverName / car / rating / etaMin / price
//   from the SELECTED offer — NOT from the demo seed identity.
{
  seedFreshScenario();
  driverOfferStore.commitPassengerSelection({
    orderId: ORDER_ID,
    selectedDriverId: 'drv-A',
    allOffers: driverOfferStore.listDriverOffersForOrder(ORDER_ID),
  });

  // Construct a merged order the way loadOrder() would — overlay +
  // stored offers + a passenger snapshot for the seed.
  const mergedOrder = {
    id: ORDER_ID,
    status: 'ACCEPTED',
    selectedDriverId: 'drv-A',
    passengerName: 'Уникальный Пассажир',
    pickup:  'Уникальная точка А',
    dropoff: 'Уникальная точка Б',
    time:    'Сегодня, 15:30',
    budget:  1200,
    comment: 'Test consistency',
    offers:  driverOfferStore.listDriverOffersForOrder(ORDER_ID),
  };
  expect('F — canOpenTrip on the merged order returns true',
    orderDetailMod.canOpenTrip(mergedOrder) === true);
  const seed = orderDetailMod.buildPassengerActiveRideSeed(mergedOrder);
  expect('F — seed builder returns a non-null seed', !!seed);
  expect('F — seed.selectedDriverId mirrors the chosen offer',
    seed?.selectedDriverId === 'drv-A');
  expect('F — seed.selectedOfferId mirrors the chosen offer id',
    seed?.selectedOfferId === `offer_${ORDER_ID}_drv-A`);
  // Driver-side fields come from the chosen offer's snapshot, NOT demo.
  expect('F — seed.driver.name comes from chosen offer ("Анна Альфа")',
    seed?.driver?.name === 'Анна Альфа');
  expect('F — seed.driver.rating comes from chosen offer ("4,95")',
    seed?.driver?.rating === '4,95');
  expect('F — seed.vehicle.model comes from chosen offer.car ("Audi A4 · чёрный")',
    seed?.vehicle?.model === 'Audi A4 · чёрный');
  expect('F — seed.driver.name is NOT the demo seed "Рустам К."',
    seed?.driver?.name !== 'Рустам К.');
  expect('F — seed.passenger.name comes from order.passengerName',
    seed?.passenger?.name === 'Уникальный Пассажир');
  expect('F — seed.route.pickupLabel comes from order.pickup',
    seed?.route?.pickupLabel === 'Уникальная точка А');
  expect('F — seed.route.dropoffLabel comes from order.dropoff',
    seed?.route?.dropoffLabel === 'Уникальная точка Б');
  expect('F — seed.seededFrom marks the Order Detail handoff source',
    seed?.seededFrom === 'order_detail_passenger_handoff');
  expect('F — seed.tripId derived from orderId (not DEMO_ACTIVE_RIDE_ID)',
    seed?.tripId === `trip_${ORDER_ID}`
    && seed.tripId !== rideState.DEMO_ACTIVE_RIDE_ID);
}

// ── F/poison — stale/demo order.tripId MUST be ignored by the seed ─
//   BD-ORDER-DETAIL-01D-3 P2 review fix #3 — the original test only
//   exercised the default `trip_${order.id}` derivation by NEVER
//   setting `order.tripId`. A malicious / stale snapshot could plant
//   a different tripId on the merged order, and the seed builder
//   would silently honor it — the resulting active-ride record would
//   point at the wrong key. Plant a deliberately wrong tripId and
//   prove the builder ignores it.
{
  // Reset and re-commit so we know the offer store is in a clean state.
  seedFreshScenario();
  driverOfferStore.commitPassengerSelection({
    orderId: ORDER_ID,
    selectedDriverId: 'drv-A',
    allOffers: driverOfferStore.listDriverOffersForOrder(ORDER_ID),
  });
  const poisonedMerged = {
    id: ORDER_ID,
    // Stale / demo tripId smuggled in by a hostile / drift snapshot.
    // The seed builder MUST NOT honor this — the canonical handoff
    // tripId is always `trip_${order.id}`.
    tripId: 'stale_demo_trip_id',
    status: 'ACCEPTED',
    selectedDriverId: 'drv-A',
    passengerName: 'Уникальный Пассажир',
    pickup: 'Уникальная точка А',
    dropoff: 'Уникальная точка Б',
    budget: 1200,
    comment: '',
    offers: driverOfferStore.listDriverOffersForOrder(ORDER_ID),
  };
  const seed = orderDetailMod.buildPassengerActiveRideSeed(poisonedMerged);
  expect('F/poison — buildPassengerActiveRideSeed returns a non-null seed for the poisoned merged order',
    !!seed);
  expect('F/poison — seed.tripId is the canonical trip_${order.id} (NOT the stale poison)',
    seed?.tripId === `trip_${ORDER_ID}`);
  expect('F/poison — seed.tripId is NOT the stale "stale_demo_trip_id"',
    seed?.tripId !== 'stale_demo_trip_id');
  // Persist the seed and verify the store ends up keyed by the
  // canonical tripId — not the stale poison.
  rideState.clearActiveRideStore();
  rideState.saveActiveRide(seed);
  expect('F/poison — persisted record is reachable via the canonical tripId',
    !!rideState.findActiveRide(`trip_${ORDER_ID}`));
  expect('F/poison — persisted record is NOT reachable via the stale poison tripId',
    rideState.findActiveRide('stale_demo_trip_id') === null);
}

// ── G. Passenger active-ride consumer sees the same selected driver ─
//   The handoff click handler funnels through saveActiveRide(seed)
//   then navigates to /active-ride?role=passenger&tripId=…
//   The passenger renderer reads the persisted record via
//   findActiveRide(tripId). We verify the persisted record carries the
//   selected driver's snapshot verbatim.
{
  // Continue from F's state.
  const merged = {
    id: ORDER_ID,
    status: 'ACCEPTED',
    selectedDriverId: 'drv-A',
    passengerName: 'Уникальный Пассажир',
    pickup:  'Уникальная точка А',
    dropoff: 'Уникальная точка Б',
    budget:  1200,
    comment: 'Test',
    offers:  driverOfferStore.listDriverOffersForOrder(ORDER_ID),
  };
  const seed = orderDetailMod.buildPassengerActiveRideSeed(merged);
  rideState.saveActiveRide(seed);
  const persisted = rideState.findActiveRide(seed.tripId);
  expect('G — persisted active ride is the saved seed',
    !!persisted && persisted.tripId === seed.tripId);
  expect('G — persisted.selectedDriverId === drv-A',
    persisted?.selectedDriverId === 'drv-A');
  expect('G — persisted.driver.name === chosen offer name',
    persisted?.driver?.name === 'Анна Альфа');
  expect('G — persisted.vehicle.model === chosen offer car',
    persisted?.vehicle?.model === 'Audi A4 · чёрный');
  expect('G — persisted.role === passenger',
    persisted?.role === 'passenger');
  expect('G — persisted.orderId === source order id',
    persisted?.orderId === ORDER_ID);
}

// ── H. Driver-side view on the same orderId resolves to D3 ──────────
//   Same overlay state (ACCEPTED + selectedDriverId=drv-A). With role
//   === driver and selectedDriverId === SELF, resolveState routes to
//   D3 and the rendered markup carries the accepted-driver card.
{
  // Synthesize an order whose selectedDriverId IS the SELF driver
  // (cross-role consistency check — different scenario than the
  // earlier setup which used drv-A).
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  rideState.clearActiveRideStore();
  const selfOrderId = 'consistency-test-self-order';
  _bdofs.set(DRIVER_OFFERS_KEY, JSON.stringify({
    [selfOrderId]: {
      [orderDetailMod.SELF_DRIVER_ID]: mkOffer(
        selfOrderId, orderDetailMod.SELF_DRIVER_ID, 'sent',
        { driverName: 'Вы (демо)', car: 'Демо · автомобиль' }),
    },
  }));
  driverOfferStore.commitPassengerSelection({
    orderId: selfOrderId,
    selectedDriverId: orderDetailMod.SELF_DRIVER_ID,
    allOffers: driverOfferStore.listDriverOffersForOrder(selfOrderId),
  });
  // Hand-construct the merged order (the smoke harness doesn't use the
  // real DEMO_ORDERS fixtures here because selfOrderId is synthetic).
  const merged = {
    id: selfOrderId,
    status: 'ACCEPTED',
    selectedDriverId: orderDetailMod.SELF_DRIVER_ID,
    passengerName: 'Иван П.',
    pickup: 'Pickup self',
    dropoff: 'Dropoff self',
    budget: 1500,
    comment: '',
    offers: driverOfferStore.listDriverOffersForOrder(selfOrderId),
  };
  expect('H — driver resolveState on SELF-selected ACCEPTED order → D3',
    orderDetailMod.resolveState(merged, 'driver') === 'D3');
  expect('H — passenger resolveState on the same merged order → P3',
    orderDetailMod.resolveState(merged, 'passenger') === 'P3');
  const driverMarkup = orderDetailMod.renderOrderDetailMarkup(
    { order: merged, role: 'driver', state: 'D3' });
  expect('H — driver D3 markup carries the passenger snapshot name',
    driverMarkup.includes('Иван П.'));
  expect('H — driver D3 markup carries the route pickup label',
    driverMarkup.includes('Pickup self'));
  expect('H — driver D3 markup carries the route dropoff label',
    driverMarkup.includes('Dropoff self'));
  expect('H — driver D3 markup exposes «Начать подачу» CTA',
    driverMarkup.includes('Начать подачу'));
  expect('H — driver D3 markup exposes «Открыть активную поездку» CTA',
    driverMarkup.includes('Открыть активную поездку'));
}

// ── I. Terminal order hides the full forbidden-CTA set ──────────────
//   Both CANCELED (overlay-driven) AND EXPIRED (fixture-driven)
//   terminal scenarios must hide every CTA in TERMINAL_FORBIDDEN_CTAS
//   on BOTH P4 (passenger) and D4 (driver). Codifying the full set in
//   the loop catches a future change that re-introduces, say,
//   `driver-cancel` on P4 or `reject-offer` on D4.

// ── I/CANCELED — overlay-driven terminal ────────────────────────────
{
  // Take demo-order-1 (P1 canonical) and run cancelOrderByPassenger to
  // overlay it to CANCELED, then re-load and render P4 / D4.
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  driverOfferStore.cancelOrderByPassenger({ orderId: 'demo-order-1' });
  const canceled = orderDetailMod.loadOrder('demo-order-1');
  expect('I/CANCELED baseline — demo-order-1 status flipped to CANCELED via overlay',
    canceled.status === 'CANCELED');
  expect('I/CANCELED baseline — passenger resolves to P4',
    orderDetailMod.resolveState(canceled, 'passenger') === 'P4');
  expect('I/CANCELED baseline — driver resolves to D4',
    orderDetailMod.resolveState(canceled, 'driver') === 'D4');
  const passengerP4 = orderDetailMod.renderOrderDetailMarkup({
    order: canceled, role: 'passenger', state: 'P4',
  });
  for (const forbidden of TERMINAL_FORBIDDEN_CTAS) {
    expect(`I/CANCELED — P4 terminal markup does NOT carry ${forbidden}`,
      !passengerP4.includes(forbidden));
  }
  expect('I/CANCELED — P4 terminal markup keeps only safe exits',
    passengerP4.includes('Создать новый заказ')
    && passengerP4.includes('Вернуться в ленту'));
  const d4 = orderDetailMod.renderOrderDetailMarkup({
    order: canceled, role: 'driver', state: 'D4',
  });
  for (const forbidden of TERMINAL_FORBIDDEN_CTAS) {
    expect(`I/CANCELED — D4 terminal markup does NOT carry ${forbidden}`,
      !d4.includes(forbidden));
  }
}

// ── I/EXPIRED — fixture-driven terminal (BD-ORDER-DETAIL-01D-3 P2 review fix #2) ─
//   demo-order-expired carries status='EXPIRED' + lockedReason='order_expired'
//   directly in the fixture (no overlay needed). The terminal-CTA
//   invariant must hold the same way as for CANCELED orders — every
//   forbidden CTA absent on BOTH P4 and D4, on a brand-new fixture-only
//   read with no prior commit / cancel state.
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  const expired = orderDetailMod.loadOrder('demo-order-expired');
  expect('I/EXPIRED baseline — demo-order-expired status === EXPIRED',
    expired?.status === 'EXPIRED');
  expect('I/EXPIRED baseline — passenger resolves to P4',
    orderDetailMod.resolveState(expired, 'passenger') === 'P4');
  expect('I/EXPIRED baseline — driver resolves to D4',
    orderDetailMod.resolveState(expired, 'driver') === 'D4');
  // P4 markup — full forbidden-CTA sweep.
  const expiredP4 = orderDetailMod.renderOrderDetailMarkup({
    order: expired, role: 'passenger', state: 'P4',
  });
  for (const forbidden of TERMINAL_FORBIDDEN_CTAS) {
    expect(`I/EXPIRED — P4 terminal markup does NOT carry ${forbidden}`,
      !expiredP4.includes(forbidden));
  }
  expect('I/EXPIRED — P4 markup keeps only safe terminal exits',
    expiredP4.includes('Создать новый заказ')
    && expiredP4.includes('Вернуться в ленту'));
  expect('I/EXPIRED — P4 markup carries the «Истёк» status chip',
    expiredP4.includes('Истёк'));
  // D4 markup — same forbidden-CTA sweep + the canonical expired copy.
  const expiredD4 = orderDetailMod.renderOrderDetailMarkup({
    order: expired, role: 'driver', state: 'D4',
  });
  for (const forbidden of TERMINAL_FORBIDDEN_CTAS) {
    expect(`I/EXPIRED — D4 terminal markup does NOT carry ${forbidden}`,
      !expiredD4.includes(forbidden));
  }
  expect('I/EXPIRED — D4 markup shows the «Заказ истёк» reason',
    expiredD4.includes('Заказ истёк'));
}

// ── J. Cancel does NOT recreate / revive the active-ride record ─────
//   `cancelOrderByPassenger` writes ONLY the order overlay. The
//   active-ride store is left UNTOUCHED — `findActiveRide` returns
//   null for orders that never had a handoff seed.
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  rideState.clearActiveRideStore();
  // No prior handoff seed. Cancel the order.
  driverOfferStore.cancelOrderByPassenger({ orderId: 'demo-order-1' });
  // The cancel overlay landed but no active-ride record was created.
  expect('J — cancel writes the order-overlay store',
    _bdofs.has(ORDER_OVERLAY_STORE_KEY));
  expect('J — cancel does NOT write the active-ride store',
    !_bdofs.has(ACTIVE_RIDE_STORE_KEY));
  expect('J — no active ride record for the canceled order tripId',
    rideState.findActiveRide(`trip_demo-order-1`) === null);

  // Now exercise the inverse — a PRIOR handoff seed exists, then the
  // passenger cancels. The active-ride record stays put BYTE-FOR-BYTE;
  // the cancel overlay does not retroactively delete or rewrite any
  // field of the persisted active ride.
  //
  // BD-ORDER-DETAIL-01D-3 P2 review fix #1 — the original assertion
  // only checked `status` + `driver.name`. A future bug that
  // overwrote `selectedDriverId`, the passenger / route snapshots,
  // timestamps, or any other field would slip through. Compare the
  // full serialized record before and after the overlay cancel to
  // catch any field-level mutation.
  rideState.clearActiveRideStore();
  rideState.saveActiveRide({
    tripId: 'trip_pre-existing-active',
    orderId: 'pre-existing-active',
    role: 'passenger',
    status: 'DRIVER_EN_ROUTE',
    selectedDriverId: 'drv-pre-existing-A',
    passenger: {
      name: 'Уникальный Пассажир',
      initials: 'УП',
      rating: '4,55',
      phoneMasked: '+7 ... 00-11',
      luggage: 'уникальный багаж',
      note: 'уникальная заметка',
    },
    driver: {
      name: 'Уникальный Водитель',
      initials: 'УВ',
      rating: '4,99',
      car: 'Уникальный · модель',
      onlineLabel: 'На линии',
      shiftDuration: '',
    },
    vehicle: { model: 'Уникальный · модель', color: 'белый', plate: 'А777АА777' },
    route: {
      pickupLabel:  'Уникальная точка А',
      dropoffLabel: 'Уникальная точка Б',
      currentInstruction: 'Через 250 м направо',
      currentStreet: 'на тестовой улице',
      etaToPickup: '4 мин',
      etaToDestination: '28 мин',
    },
    order: { offerPrice: '999 ₽', pickupEta: '4 мин' },
    ride: { price: '999 ₽' },
    payment: { amount: '999 ₽' },
    timestamps: {
      createdAt:  '2026-06-12T07:00:00.000Z',
      acceptedAt: '2026-06-12T07:01:00.000Z',
    },
    seededFrom: 'order_detail_passenger_handoff',
  });
  const beforeSerialized = JSON.stringify(
    rideState.findActiveRide('trip_pre-existing-active'));
  driverOfferStore.cancelOrderByPassenger({ orderId: 'pre-existing-active' });
  const afterSerialized = JSON.stringify(
    rideState.findActiveRide('trip_pre-existing-active'));
  expect('J — active ride record is preserved byte-for-byte across overlay cancel',
    afterSerialized === beforeSerialized,
    afterSerialized === beforeSerialized
      ? ''
      : `before=${beforeSerialized.length}B after=${afterSerialized.length}B`);
  // Spot pins on individual high-risk fields for diagnostic clarity if
  // the serialized comparison ever fails — these are redundant with the
  // byte-for-byte equality above but make the failure log point at the
  // specific field that drifted.
  const after = JSON.parse(afterSerialized || 'null');
  expect('J — selectedDriverId preserved (no overlay rewrite)',
    after?.selectedDriverId === 'drv-pre-existing-A');
  expect('J — passenger snapshot preserved',
    after?.passenger?.name === 'Уникальный Пассажир'
    && after?.passenger?.phoneMasked === '+7 ... 00-11'
    && after?.passenger?.note === 'уникальная заметка');
  expect('J — driver snapshot preserved',
    after?.driver?.name === 'Уникальный Водитель'
    && after?.driver?.rating === '4,99');
  expect('J — route snapshot preserved',
    after?.route?.pickupLabel === 'Уникальная точка А'
    && after?.route?.dropoffLabel === 'Уникальная точка Б');
  expect('J — timestamps preserved verbatim (no canceledAt injected onto active-ride)',
    after?.timestamps?.createdAt === '2026-06-12T07:00:00.000Z'
    && after?.timestamps?.acceptedAt === '2026-06-12T07:01:00.000Z'
    && after?.timestamps?.canceledAt === undefined);
  expect('J — orderId on the active-ride record preserved',
    after?.orderId === 'pre-existing-active');
  expect('J — seededFrom marker preserved',
    after?.seededFrom === 'order_detail_passenger_handoff');
}

// ── K. Source guards ────────────────────────────────────────────────
const orderDetailNoComments      = stripComments(orderDetailSrc);
const driverOfferStoreNoComments = stripComments(driverOfferStoreSrc);
const rideStateNoComments        = stripComments(rideStateSrc);

// K1. order_detail.js does NOT import receipt / history writers.
expect('K1 — order_detail.js does NOT import trip_receipt',
  !/from\s*['"][^'"]*trip_receipt['"]/.test(orderDetailNoComments));
expect('K1 — order_detail.js does NOT import ride_history',
  !/from\s*['"][^'"]*ride_history['"]/.test(orderDetailNoComments));
expect('K1 — order_detail.js does NOT import mock_api receipts/history surface',
  !/getReceipt|saveDriverReceipt|saveRideHistoryEntry/.test(orderDetailNoComments));
// K2. order_detail.js does NOT write the receipt / history stores.
expect('K2 — order_detail.js does NOT write bazardrive.driver_receipts.v1',
  !/bazardrive\.driver_receipts\.v1/.test(orderDetailNoComments));
expect('K2 — order_detail.js does NOT write bazardrive.ride_history.v1',
  !/bazardrive\.ride_history\.v1/.test(orderDetailNoComments));

// K3. driver_offer_store.js does NOT import active_ride / receipt / history.
expect('K3 — driver_offer_store.js does NOT import active_ride',
  !/from\s*['"][^'"]*active_ride[^'"]*['"]/.test(driverOfferStoreNoComments));
expect('K3 — driver_offer_store.js does NOT import trip_receipt',
  !/from\s*['"][^'"]*trip_receipt['"]/.test(driverOfferStoreNoComments));
expect('K3 — driver_offer_store.js does NOT import ride_history',
  !/from\s*['"][^'"]*ride_history['"]/.test(driverOfferStoreNoComments));
expect('K3 — driver_offer_store.js does NOT import ride_state',
  !/from\s*['"][^'"]*ride_state['"]/.test(driverOfferStoreNoComments));
expect('K3 — driver_offer_store.js does NOT write the active_ride / receipt / history stores',
  !/bazardrive\.active_ride\.v1/.test(driverOfferStoreNoComments)
  && !/bazardrive\.driver_receipts\.v1/.test(driverOfferStoreNoComments)
  && !/bazardrive\.ride_history\.v1/.test(driverOfferStoreNoComments));

// K4. Handoff funnels through the canonical saveActiveRide helper.
// order_detail.js imports saveActiveRide from ride_state.js, NOT
// references DEMO_ACTIVE_RIDE_ID as a substitute identity.
expect('K4 — order_detail.js imports saveActiveRide from ride_state',
  /import\s*\{[\s\S]*?saveActiveRide[\s\S]*?\}\s*from\s*['"]\.\.\/ride_state\.js['"]/.test(orderDetailSrc));
expect('K4 — order_detail.js imports findActiveRide from ride_state',
  /import\s*\{[\s\S]*?findActiveRide[\s\S]*?\}\s*from\s*['"]\.\.\/ride_state\.js['"]/.test(orderDetailSrc));
// DEMO_ACTIVE_RIDE_ID lives in ride_state.js — order_detail.js must
// NOT use it as a tripId fallback; the open-trip handler derives the
// tripId from the order id (`trip_${order.id}`).
expect('K4 — order_detail.js does NOT reference DEMO_ACTIVE_RIDE_ID',
  !/DEMO_ACTIVE_RIDE_ID/.test(orderDetailNoComments));
// The seed builder uses `trip_${order.id}` derivation — pin it.
expect('K4 — buildPassengerActiveRideSeed derives tripId from order.id',
  /trip_\$\{order\.id\}/.test(orderDetailSrc));

// K5. The open-trip click handler is the ONLY place saveActiveRide is
// called from order_detail.js, gated on canOpenTrip — both invariants
// are already pinned by smoke-order-detail-contract.mjs (F4j). Mirror
// the key pin here so a future refactor surfaces in this consistency
// audit too.
expect('K5 — order_detail.js calls saveActiveRide exactly once (open-trip handler)',
  (orderDetailNoComments.match(/saveActiveRide\s*\(/g) || []).length === 1);
expect('K5 — order_detail.js gates saveActiveRide behind canOpenTrip + findActiveRide',
  /canOpenTrip\([\s\S]{0,400}buildPassengerActiveRideSeed\([\s\S]{0,400}findActiveRide\([\s\S]{0,200}saveActiveRide\(/.test(orderDetailSrc));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));

if (issues.length) process.exit(1);
