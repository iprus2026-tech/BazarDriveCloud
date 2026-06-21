// BD-RESPONSES-01 — Inbox "driver responded" → /responses offers board → build
// the active ride. The notification previously pointed at a legacy `postId`, so
// resolveCanonicalOrder() returned null and the board's «Выбрать водителя» CTA
// dead-ended (toast only, no /active-ride handoff). It now points at a canonical
// demo order that is materialised when the Inbox mounts, so the full
// select → /active-ride?role=passenger&status=DRIVER_EN_ROUTE handoff works.
// Static source pins + a behavioural store check.

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

// ── A. static: the seed points at a canonical orderId + the ensure helper exists ──
expect('the Inbox "driver responded" notification points at a canonical orderId (not the legacy postId)',
  /href:\s*'\/responses\?orderId=order-demo-response-1&state=list'/.test(mockApi)
  && !/responses\?postId=trip-2/.test(mockApi));
expect('mock_api exports DEMO_RESPONSE_ORDER_ID + ensureDemoResponseOrder',
  /export const DEMO_RESPONSE_ORDER_ID\s*=\s*'order-demo-response-1'/.test(mockApi)
  && /export function ensureDemoResponseOrder\s*\(/.test(mockApi));
expect('inbox.js imports + calls ensureDemoResponseOrder on mount',
  /ensureDemoResponseOrder/.test(inbox)
  && /export default async function inbox\(\)[\s\S]{0,400}ensureDemoResponseOrder\(\)/.test(inbox));

// ── B. behavioural: ensure materialises a resolvable order + is idempotent ──
const localMap = new Map();
globalThis.localStorage = {
  getItem: (k) => (localMap.has(k) ? localMap.get(k) : null),
  setItem: (k, v) => localMap.set(k, String(v)),
  removeItem: (k) => localMap.delete(k),
  clear: () => localMap.clear(),
};
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };

const { ensureDemoResponseOrder, getOrderById, DEMO_RESPONSE_ORDER_ID } =
  await import('../public/src/mock_api.js');

expect('before ensure: the demo order does not resolve (runtime store empty)',
  getOrderById(DEMO_RESPONSE_ORDER_ID) === null);
const created = ensureDemoResponseOrder();
expect('ensureDemoResponseOrder returns the canonical demo order',
  !!created && created.id === DEMO_RESPONSE_ORDER_ID && created.status === 'CREATED');
const resolved = getOrderById(DEMO_RESPONSE_ORDER_ID);
expect('after ensure: getOrderById resolves it — so the select handler can build the active ride',
  !!resolved && resolved.id === DEMO_RESPONSE_ORDER_ID
  && resolved.pickup.label === 'Внуково' && resolved.dropoff.label === 'Парк Победы');
ensureDemoResponseOrder(); // second call
const all = JSON.parse(localStorage.getItem('bazardrive.ride_orders.v1') || '[]');
expect('ensureDemoResponseOrder is idempotent (no duplicate on a second call)',
  all.filter((o) => o.id === DEMO_RESPONSE_ORDER_ID).length === 1);

expect('sw.js VERSION bumped to v177+',
  Number((sw.match(/VERSION\s*=\s*'v(\d+)'/) || [])[1] || 0) >= 177);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
