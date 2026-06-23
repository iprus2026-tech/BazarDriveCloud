// BD-OPS-03 — ScreenOps static screen registry (dev/docs tool).
//
// Plain data only. This module performs NO network calls, NO fetch, NO dynamic
// import and NO filesystem / HTTP probing of any kind. `implementationStatus`
// is declared in the data below; whether a source file truly exists on disk is
// pinned only by the Node smoke / check scripts — never by the browser at
// runtime. The UI renders the declared status string directly.
//
// BD-OPS-07 (#646): the registry now covers every product route registered in
// public/src/app.js. Two routes are deliberately NOT here and are allowlisted in
// scripts/smoke-ops-screens.mjs (KNOWN_UNREGISTERED): `/ops/screens` (this dev
// tool itself) and `/onboarding` (the onboarding step host — same family as
// BD-ONBOARDING-01 `/welcome`). The smoke gate now enforces coverage in BOTH
// directions, so a screen added to app.js without a registry decision fails.

// BD-OPS / #684 #8 — optional data-model fact: where a screen's primary entity
// lives, so the repair prompt (Step 0b) can flag a fix that assumes a static
// anchor which does not exist (the BD-RESPONSES-01 / #688 lesson: ride orders are
// runtime-created, so "point the seed at an orderId" was non-viable). Read-only;
// shared by reference — getScreen() shallow-copies the entry and never mutates this.
const RIDE_ORDERS_DATA_MODEL = {
  store: 'the ride_orders store',
  runtimeCreated: true,
  keyedBy: 'a runtime order id (order-<timestamp>) minted by createRideOrder()',
  note: 'no static orderId exists on a fresh load — a repair that needs one must MATERIALISE the order at runtime, not re-point a static seed.',
};
const ACTIVE_RIDE_DATA_MODEL = {
  store: 'the active_ride store',
  runtimeCreated: true,
  keyedBy: 'a tripId — either trip_<orderId> (canonical, from an accepted ride order) OR feed-<postId> (legacy Feed / Post-Detail fallback via acceptPassengerRequestFromPost)',
  note: 'created at runtime; a terminal ride must not be reused — regenerate a fresh tripId. A repair must handle BOTH tripId namespaces, not only trip_<orderId>.',
};
// BD-ORDER-DETAIL-01 is NOT runtime ride_orders: it resolves loadOrder(id) from the
// frozen DEMO_ORDERS fixture (demo-order-1 / -offers / -accepted) in order_detail.js.
const FIXTURE_ORDER_DATA_MODEL = {
  store: 'the frozen DEMO_ORDERS fixture (in order_detail.js)',
  runtimeCreated: false,
  keyedBy: 'a static fixture id (e.g. demo-order-1, demo-order-offers), resolved by loadOrder(id)',
  note: 'these are static fixtures editable IN PLACE — a repair here edits the fixture; do NOT materialise a runtime ride order for this screen.',
};
// BD-RESPONSES-01 reads TWO sources: the ride_orders order context (getOrderById /
// resolveCanonicalOrder) AND the driver-offer cards (responses store + MOCK_DRIVERS).
const RESPONSES_DATA_MODEL = {
  store: 'two sources — the ride_orders order context AND the driver-offer store',
  runtimeCreated: true,
  keyedBy: 'order context by a runtime order id (getOrderById / resolveCanonicalOrder); the offer cards by orderId in the responses store, falling back to in-file MOCK_DRIVERS + session-only decline state',
  note: 'order-resolution repairs touch the runtime ride order (materialise it — the #688 lesson); but card-mapping / sort / decline / responseId-chat repairs touch the offer store + MOCK_DRIVERS fallback, NOT a ride order.',
};

// #684 #7 — screen-specific must-not-touch guardrails, injected into the repair
// prompt's must-not-touch list, so a per-screen contract is not re-typed by hand.
const ACTIVE_RIDE_GUARDRAILS = [
  'do NOT reroute the in-ride safety report (BD-RIDE-P-07) to /report, nor break the canonical ride-order status sync (syncCanonicalOrderStatus / updateTripStatus).',
];

// #684 #11 — optional cssAtoms fact: the screen's existing cloud.css class atoms,
// injected into the Cloud Design prompt's Reuse block so a returned design restyles
// them in place instead of forking a parallel class system (the BD-CHAT-01 `.ch-*`
// → `.chat__*` port mapped cleanly only by luck). Optional; the generator degrades
// gracefully when absent.
const CHAT_CSS_ATOMS = [
  '.chat__header / .chat__avatar / .chat__driver-name / .chat__online-dot — thread header',
  '.chat__trip-bar / .chat__trip-route / .chat__trip-status / .chat__trip-price — trip bar',
  '.chat__messages / .chat__msg / .chat__msg--in / --out / .chat__bubble / .chat__author / .chat__ts / .chat__date-sep — message log',
  '.chat__empty / .chat__empty-ic / -title / -text / .chat__sys-pill — empty / first-message state',
  '.chat__composer / .chat__composer--locked / .chat__input / .chat__send / .chat__composer-plus — composer',
  '.chat__quick-replies / .chat__qr-chip — quick replies',
  '.chat__confirm-bar / .chat__confirm-btn — passenger confirm CTA',
  '.chat__readonly-note — terminal read-only note',
];

// #684 — optional role-VARIANTS fact: a screen with MULTIPLE role-keyed render paths
// (e.g. /profile = guest | passenger | driver) declares them here so ScreenOps can
// ADDRESS a specific variant instead of one undifferentiated registry row, and the
// audit recipe can brief "audit EACH variant + their differences" (the BD-PROFILE-01
// guest variant was invisible to both the contract AND this registry). Each entry:
// { key, label, entry (when it renders), anchor (the render symbol) }. Optional —
// single-render screens omit it. Read-only; shared by reference (getScreen shallow-copies).
const PROFILE_ROLE_VARIANTS = [
  { key: 'guest',     label: 'Гость',    entry: 'welcomeSeen && !onboarded',           anchor: 'renderGuest' },
  { key: 'passenger', label: 'Пассажир', entry: "role === 'passenger'",                anchor: 'renderPassenger' },
  { key: 'driver',    label: 'Водитель', entry: "role === 'driver' (or ?role=driver)", anchor: 'renderDriver' },
];

// #684 #4 — Order Detail is role-dispatched: resolveState() branches on role into the
// passenger P1–P4 vs driver D1–D4 body families (own-order / offer-selection vs
// send-offer / assigned). Labels are the on-screen ROLE_CHIP strings (also in the contract).
const ORDER_DETAIL_ROLE_VARIANTS = [
  { key: 'passenger', label: 'Ваш заказ',         entry: "role === 'passenger' (default; no ?role=driver)",   anchor: 'resolveState passenger states P1–P4 → bodyP* (BODY_BY_STATE)' },
  { key: 'driver',    label: 'Просмотр водителя', entry: "role === 'driver' (?role=driver or session driver)", anchor: "resolveState role==='driver' branch → D1–D4 bodyD*" },
];

// #684 #4 — Trip Confirmation dispatches by handoff STATE into role-keyed renderers:
// passenger (driverCard + confirm) vs driver (passengerCard + 60s countdown) vs the
// role-agnostic expired path. The expired variant is a state, not a role.
const CONFIRM_ROLE_VARIANTS = [
  { key: 'passenger', label: 'Пассажир', entry: "role !== 'driver' (default)",                      anchor: 'renderPassengerPending / renderPassengerConfirmed (STATE_RENDERERS)' },
  { key: 'driver',    label: 'Водитель', entry: "role === 'driver'",                                 anchor: 'renderDriverWaiting (+60s countdown) / renderDriverConfirmed' },
  { key: 'expired',   label: 'Истекло',  entry: 'role-agnostic: handoff expired or ?state=EXPIRED',  anchor: 'renderExpired (no party card)' },
];

const SCREENS = [
  {
    id: 'BD-ONBOARDING-01',
    title: 'Welcome',
    route: '/welcome',
    file: 'public/src/screens/welcome.js',
    role: 'shared',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
  },
  {
    id: 'BD-FEED-01',
    title: 'Feed',
    route: '/feed',
    file: 'public/src/screens/feed.js',
    role: 'passenger / driver',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
  },
  {
    id: 'BD-POST-01',
    title: 'Post Detail',
    route: '/post',
    file: 'public/src/screens/post_detail.js',
    role: 'shared',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
  },
  {
    id: 'BD-COMPOSER-01',
    title: 'Composer',
    route: '/new',
    file: 'public/src/screens/composer.js',
    role: 'passenger / driver',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
  },
  {
    id: 'BD-MAP-01',
    title: 'Map',
    route: '/map',
    file: 'public/src/screens/map.js',
    role: 'passenger',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
  },
  {
    id: 'BD-MAP-02',
    title: 'Location Permission',
    route: '/location-permission',
    file: 'public/src/screens/location_permission.js',
    role: 'passenger',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
  },
  {
    id: 'BD-MAP-03',
    title: 'Route Picker',
    route: '/route-picker',
    file: 'public/src/screens/route_picker.js',
    role: 'passenger',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
  },
  {
    id: 'BD-MAP-04',
    title: 'Route Preview',
    route: '/route-preview',
    file: 'public/src/screens/route_preview.js',
    role: 'passenger',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
  },
  {
    id: 'BD-MAP-05',
    title: 'Order Map Draft',
    route: '/order-map-draft',
    file: 'public/src/screens/order_map_draft.js',
    role: 'passenger',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
    dataModel: RIDE_ORDERS_DATA_MODEL,
  },
  {
    id: 'BD-ORDER-DETAIL-01',
    title: 'Order Detail',
    route: '/order',
    file: 'public/src/screens/order_detail.js',
    role: 'passenger / driver',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
    dataModel: FIXTURE_ORDER_DATA_MODEL,
    variants: ORDER_DETAIL_ROLE_VARIANTS,
  },
  {
    id: 'BD-RESPONSES-01',
    title: 'Responses',
    route: '/responses',
    file: 'public/src/screens/responses.js',
    role: 'passenger',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
    dataModel: RESPONSES_DATA_MODEL,
    guardrails: ['do NOT weaken the !canonicalOrder defensive guard in the select handler, nor change the select -> /active-ride handoff (buildPassengerActiveRide / activeRideUrl).'],
  },
  {
    id: 'BD-RESPOND-01',
    title: 'Respond',
    route: '/respond',
    file: 'public/src/screens/respond.js',
    role: 'driver',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
  },
  {
    id: 'BD-CONFIRM-01',
    title: 'Trip Confirmation',
    route: '/trip-confirmation',
    file: 'public/src/screens/trip_confirmation.js',
    role: 'passenger / driver',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
    variants: CONFIRM_ROLE_VARIANTS,
  },
  {
    id: 'BD-RIDE-D-02',
    title: 'Active Ride — Driver',
    route: '/active-ride?role=driver',
    file: 'public/src/screens/active_ride.js',
    role: 'driver',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
    dataModel: ACTIVE_RIDE_DATA_MODEL,
    guardrails: ACTIVE_RIDE_GUARDRAILS,
  },
  {
    id: 'BD-RIDE-P-01',
    title: 'Active Ride — Passenger',
    route: '/active-ride?role=passenger',
    file: 'public/src/screens/active_ride_passenger.js',
    role: 'passenger',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
    dataModel: ACTIVE_RIDE_DATA_MODEL,
    guardrails: ACTIVE_RIDE_GUARDRAILS,
  },
  {
    id: 'BD-DRIVER-01',
    title: 'Driver Map',
    route: '/driver-map',
    file: 'public/src/screens/driver_map.js',
    role: 'driver',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
    dataModel: RIDE_ORDERS_DATA_MODEL,
  },
  {
    id: 'BD-CHAT-01',
    title: 'Chat',
    route: '/chat',
    file: 'public/src/screens/chat.js',
    role: 'passenger / driver',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
    cssAtoms: CHAT_CSS_ATOMS,
  },
  {
    id: 'BD-INBOX-01',
    title: 'Inbox',
    route: '/inbox',
    file: 'public/src/screens/inbox.js',
    role: 'shared',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
  },
  {
    id: 'BD-RIDE-HISTORY-D-01',
    title: 'Receipt',
    route: '/receipt',
    file: 'public/src/screens/trip_receipt.js',
    role: 'driver',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
  },
  {
    id: 'BD-PROFILE-01',
    title: 'Profile',
    route: '/profile',
    file: 'public/src/screens/profile.js',
    role: 'guest / passenger / driver',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
    variants: PROFILE_ROLE_VARIANTS,
    guardrails: ['garage vehicle state: do not mutate it outside the documented make-active flow; the ?garage=multi demo-2 make-active is INTENTIONALLY pinned (smoke S24) — not a defect to fix.'],
  },
  {
    id: 'BD-SETTINGS-01',
    title: 'Settings',
    route: '/settings',
    file: 'public/src/screens/settings.js',
    role: 'shared',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
  },
  {
    id: 'BD-RULES-01',
    title: 'Rules',
    route: '/rules',
    file: 'public/src/screens/rules.js',
    role: 'shared',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
  },
];

export const IMPLEMENTATION_STATUSES = ['implemented', 'waiting', 'missing'];

export function getScreens() {
  return SCREENS.map((s) => ({ ...s }));
}

export function getScreen(id) {
  const found = SCREENS.find((s) => s.id === id);
  return found ? { ...found } : null;
}
