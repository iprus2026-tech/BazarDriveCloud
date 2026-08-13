// BD-RESPONSES-01 — Inbox "driver responded" → /responses offers board → build
// the active ride. The notification previously pointed at a legacy `postId`, so
// resolveCanonicalOrder() returned null and the board's «Выбрать водителя» CTA
// dead-ended. ensureDemoResponseOrder() now materialises a canonical demo order on
// normal Inbox mount and re-points the notification's href at it. The order id regenerates
// per lifecycle (a fresh tripId each time) so a finished demo ride never leaks stale
// per-trip state (chat / ride_history / driver_receipts), and the order is kept out
// of the shared Feed/DriverMap surfaces. Static pins + a behavioural lifecycle walk.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const mockApi = read('../public/src/mock_api.js');
const inbox = read('../public/src/screens/inbox.js');
const sw = read('../public/sw.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── A. static: placeholder seed re-pointed at runtime; per-lifecycle id ──
expect('the Inbox notification no longer uses the legacy postId (re-pointed at runtime)',
  !mockApi.includes('responses?postId=trip-2')
  && mockApi.includes('function pointInboxResponseAtOrder(orderId)')
  && mockApi.includes('`/responses?orderId=${orderId}&state=list`'));
expect('mock_api exports DEMO_RESPONSE_KIND + ensureDemoResponseOrder',
  /export const DEMO_RESPONSE_KIND\s*=\s*'inbox-response'/.test(mockApi)
  && /export function ensureDemoResponseOrder\s*\(/.test(mockApi));
expect('inbox.js calls ensureDemoResponseOrder on normal mount but not recognized fixture previews',
  /export default function inbox\(\)[\s\S]{0,500}if\s*\(!fixtureMode\)\s*ensureDemoResponseOrder\(\)/.test(inbox));
expect('the demo order id regenerates per lifecycle (fresh id, located by marker)',
  mockApi.includes("'order-demo-response-' + Date.now()")
  && /demoKind === DEMO_RESPONSE_KIND/.test(mockApi));

// ── B. behavioural lifecycle ──
const localMap = new Map();
globalThis.localStorage = {
  getItem: (k) => (localMap.has(k) ? localMap.get(k) : null),
  setItem: (k, v) => localMap.set(k, String(v)),
  removeItem: (k) => localMap.delete(k),
  clear: () => localMap.clear(),
};
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };

const { ensureDemoResponseOrder, getOrderById, DEMO_RESPONSE_KIND, listInboxItems,
  listNearbyOrders, listRideOrdersAsFeedPosts, acceptOrder } =
  await import('../public/src/mock_api.js');
const { loadActiveRideStore, saveActiveRideStore } =
  await import('../public/src/ride_state.js');

const RIDE_ORDERS_KEY = 'bazardrive.ride_orders.v1';
const demoOrders = () => JSON.parse(localStorage.getItem(RIDE_ORDERS_KEY) || '[]')
  .filter((o) => o && o.demo === true && o.demoKind === DEMO_RESPONSE_KIND);
const inboxHref = async () => {
  const item = (await listInboxItems()).find((i) => i.id === 'inbox-response-1');
  return item && item.primary ? item.primary.href : '';
};

expect('before ensure: no demo order in the store', demoOrders().length === 0);

const created = ensureDemoResponseOrder();
expect('ensureDemoResponseOrder returns a fresh CREATED demo order (marked, dynamic id)',
  !!created && created.status === 'CREATED' && created.demo === true
  && created.demoKind === DEMO_RESPONSE_KIND && /^order-demo-response-/.test(created.id));
const resolved = getOrderById(created.id);
expect('getOrderById resolves the demo order — so select can build the active ride',
  !!resolved && resolved.pickup.label === 'Внуково' && resolved.dropoff.label === 'Парк Победы');
expect('the Inbox notification href is re-pointed at the current demo order id',
  (await inboxHref()) === `/responses?orderId=${created.id}&state=list`);

expect('the demo order is excluded from DriverMap (listNearbyOrders skips demo)',
  (await listNearbyOrders()).every((o) => o.id !== created.id));
expect('the demo order is excluded from Feed (listRideOrdersAsFeedPosts skips demo)',
  listRideOrdersAsFeedPosts().every((p) => p.orderId !== created.id));

const again = ensureDemoResponseOrder();
expect('idempotent while fresh — same order id reused, no duplicate',
  again.id === created.id && demoOrders().length === 1);

// Codex #688 round 2 — a LIVE accepted handoff is preserved, not regenerated.
acceptOrder(created.id); // passenger selected a driver: CREATED → ACCEPTED
const liveStore = loadActiveRideStore();
liveStore[`trip_${created.id}`] = { tripId: `trip_${created.id}`, status: 'DRIVER_EN_ROUTE' };
saveActiveRideStore(liveStore);
const live = ensureDemoResponseOrder();
expect('a live ACCEPTED handoff is preserved (same id, still ACCEPTED) on re-ensure',
  live.id === created.id && (getOrderById(created.id) || {}).status === 'ACCEPTED');

// Codex #688 round 3 — a terminal lifecycle regenerates with a FRESH id, so the
// next trip never inherits stale per-trip (chat / history / receipt) state.
const termStore = loadActiveRideStore();
termStore[`trip_${created.id}`] = { tripId: `trip_${created.id}`, status: 'COMPLETED' };
saveActiveRideStore(termStore);
const regen = ensureDemoResponseOrder();
expect('after a terminal ride, re-ensure regenerates a FRESH-id CREATED order',
  regen.id !== created.id && regen.status === 'CREATED' && /^order-demo-response-/.test(regen.id));
expect('the old terminal handoff ride is cleared (no dead-trip reuse)',
  (loadActiveRideStore()[`trip_${created.id}`] || null) === null);
expect('exactly one demo order exists after regeneration (no stacking)',
  demoOrders().length === 1);
expect('the Inbox href now points at the regenerated order id',
  (await inboxHref()) === `/responses?orderId=${regen.id}&state=list`);

expect('sw.js VERSION bumped to v177+',
  Number((sw.match(/VERSION\s*=\s*'v(\d+)'/) || [])[1] || 0) >= 177);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
