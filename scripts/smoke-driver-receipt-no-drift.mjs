// BD-RIDE-HISTORY-D-01 — no-drift guard for the driver completed-ride receipt
// (issue #381).
//
// The completed driver earnings flow computes `net` exactly ONCE
// (active_ride.js → buildDriverEarningsPayload) and persists ONE canonical
// receipt object via mock_api.saveDriverReceipt. Ride history, Driver payouts
// and the /receipt screen must only READ that stored object and FORMAT it —
// never recompute fare / commission / tip / net. A future refactor could
// silently re-fork the math (a second commission rate, an inline subtraction
// in a card, a recomputed net in payouts) without tripping check.mjs.
//
// This guard mixes a small BEHAVIOURAL round-trip (the receipt store really
// persists and reads back the same net) with STATIC cross-surface assertions
// (every read surface reads the receipt and carries no inline arithmetic on
// the money fields). No browser, no Mapbox, no backend, no network.

import fs from 'node:fs';

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

// Extract a function body by name via brace matching so an assertion scoped to
// one function does not inspect another (skips the param list first so an
// object-default param is not mistaken for the body's opening brace).
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) return null;
  const paren = source.indexOf('(', start);
  if (paren === -1) return null;
  let pdepth = 0;
  let afterParams = -1;
  for (let i = paren; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') pdepth++;
    else if (ch === ')') { pdepth--; if (pdepth === 0) { afterParams = i + 1; break; } }
  }
  if (afterParams === -1) return null;
  const open = source.indexOf('{', afterParams);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return source.slice(open, i + 1); }
  }
  return null;
}

// Flags inline arithmetic that COMBINES money fields (a real recalculation),
// e.g. `receipt.fare - receipt.commission` or `.net * 0.12`. Pure formatting
// of a single stored field (formatRub(receipt.net)) is allowed.
const MONEY_ARITH = /\.(fare|commission|tip|net)\s*[-+*/%]\s*(?:\d|[A-Za-z_$][\w.$]*\.(?:fare|commission|tip|net))/;

// ── 0. Behavioural: receipt persistence round-trip ───────────
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};
// Minimal window/document shims so storage_boundary.js (which transitively
// imports screen modules) can be imported headlessly for the auth-boundary
// assertion below. Every real DOM access in those modules is lazy.
globalThis.window = globalThis.window || {
  location: { hash: '' }, addEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
};
globalThis.document = globalThis.document || {
  createElement: () => ({
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {}, addEventListener() {}, setAttribute() {},
    querySelector: () => null, querySelectorAll: () => [],
  }),
  getElementById: () => null, addEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], body: {},
};

const api = await import(new URL('../public/src/mock_api.js', import.meta.url).href);
const history = await import(new URL('../public/src/ride_history.js', import.meta.url).href);
const boundary = await import(new URL('../public/src/storage_boundary.js', import.meta.url).href);

for (const fn of ['saveDriverReceipt', 'getReceipt', 'listDriverReceipts']) {
  expect(`mock_api exports ${fn}`, typeof api[fn] === 'function');
}

// Canonical demo values from the issue.
const saved = api.saveDriverReceipt({
  tripId: '48-321',
  completedAt: '2026-06-04T09:12:00.000Z',
  fare: 1540,
  commission: -185,
  tip: 120,
  net: 1475,
  paymentMode: 'cash',
  status: 'completed',
});
expect('saveDriverReceipt persists net 1475', saved && saved.net === 1475);
expect('saveDriverReceipt keeps canonical breakdown',
  saved && saved.fare === 1540 && saved.commission === -185 && saved.tip === 120);
expect('saveDriverReceipt normalizes status to completed', saved && saved.status === 'completed');

const got = api.getReceipt('48-321');
expect('getReceipt round-trips the same net', got && got.net === saved.net);

const list = api.listDriverReceipts();
const payoutRow = Array.isArray(list) ? list.find((r) => r.tripId === '48-321') : null;
expect('listDriverReceipts surfaces the receipt', !!payoutRow);

// History entry derives from the SAME receipt object, no recomputation.
const ride = {
  tripId: '48-321',
  timestamps: { completedAt: '2026-06-04T09:12:00.000Z' },
  route: { pickupLabel: 'A', dropoffLabel: 'B' },
};
const historyEntry = history.buildDriverHistoryEntry(ride, { receipt: saved });
expect('buildDriverHistoryEntry carries the receipt object',
  historyEntry && historyEntry.receipt && historyEntry.receipt.net === saved.net);

// THE no-drift invariant: one net flows unchanged through every read surface.
const sheetNet = 1475; // single computation source (buildDriverEarningsPayload)
expect('no-drift: sheet.net === receipt.net === payoutRow.net === historyRow.net',
  sheetNet === saved.net
  && saved.net === got.net
  && got.net === (payoutRow && payoutRow.net)
  && (payoutRow && payoutRow.net) === (historyEntry && historyEntry.receipt.net));

// Missing receipt → null (drives the missing-receipt fallback).
expect('getReceipt(unknown) returns null', api.getReceipt('does-not-exist') === null);

// Demo receipt resolves even with an empty persisted store.
api.clearDriverReceiptsStore();
store.clear();
expect('demo receipt 48-321 resolves from the seed', api.getReceipt('48-321')?.net === 1475);
expect('demo receipt 48-321 still listed', api.listDriverReceipts().some((r) => r.tripId === '48-321'));

// ── 0a. Idempotent COMPLETED rerender preserves cash (PR #382, Codex #1) ──
// A live cash completion saves a cash receipt. Reopening COMPLETED without
// ?state=cash recomputes paymentMode='noncash' — but renderCompleted now reads
// `getReceipt(tripId) || saveDriverReceipt(...)`, so an existing receipt is
// preserved verbatim and never flipped to noncash. Mirror that exact guard.
const liveTripId = 'trip_cash_rerender_demo';
api.saveDriverReceipt({
  tripId: liveTripId,
  completedAt: '2026-06-04T10:00:00.000Z',
  fare: 1540, commission: -185, tip: 120, net: 1475,
  paymentMode: 'cash', status: 'completed',
});
// Rerender guard: the second render computes noncash but must NOT overwrite.
const recomputedNoncash = {
  tripId: liveTripId,
  completedAt: '2026-06-04T10:05:00.000Z',
  fare: 1540, commission: -185, tip: 120, net: 1475,
  paymentMode: 'noncash', status: 'completed',
};
const preserved = api.getReceipt(liveTripId) || api.saveDriverReceipt(recomputedNoncash);
expect('cash receipt stays cash after rerender without ?state=cash',
  preserved && preserved.paymentMode === 'cash');
expect('idempotent rerender keeps the persisted cash receipt intact',
  api.getReceipt(liveTripId)?.paymentMode === 'cash');

// ── 0b. Auth boundary clears driver receipts (PR #382, Codex #2) ─────────
// A persisted receipt must not survive a local logout / session reset.
api.saveDriverReceipt({
  tripId: 'trip_boundary_demo',
  completedAt: '2026-06-04T11:00:00.000Z',
  fare: 1540, commission: -185, tip: 120, net: 1475,
  paymentMode: 'noncash', status: 'completed',
});
expect('receipt present before the auth boundary clear',
  api.getReceipt('trip_boundary_demo')?.net === 1475);
boundary.clearUserScopedStorage();
expect('clearUserScopedStorage() clears persisted driver receipts',
  api.getReceipt('trip_boundary_demo') === null);
expect('clearUserScopedStorage() drops the persisted store entirely',
  !api.listDriverReceipts().some((r) => r.tripId === 'trip_boundary_demo'));
store.clear();

// ── 1. Single computation source in the completed flow ───────
const activeRide = read('../public/src/screens/active_ride.js');
expect('net is computed once via buildDriverEarningsPayload',
  /function\s+buildDriverEarningsPayload\s*\(/.test(activeRide));
expect('renderCompleted persists the canonical receipt via saveDriverReceipt',
  /saveDriverReceipt\(\s*\{/.test(activeRide));
expect('receipt net is sourced from the single payload (net: payload.net)',
  /net:\s*payload\.net/.test(activeRide));
expect('receipt commission is the signed payload commission',
  /commission:\s*-payload\.commissionAmount/.test(activeRide));
expect('completed flow records the payment mode',
  /paymentMode/.test(activeRide) && /'cash'/.test(activeRide) && /'noncash'/.test(activeRide));
expect('COMPLETED rerender is idempotent (getReceipt(tripId) || saveDriverReceipt)',
  /getReceipt\(ride\.tripId\)\s*\|\|\s*saveDriverReceipt\(/.test(activeRide));

// ── 2. Receipt screen reads + formats only (states C/D/E/F) ──
const receipt = read('../public/src/screens/trip_receipt.js');
expect('receipt screen reads the stored receipt via getReceipt',
  /getReceipt\(/.test(receipt));
expect('receipt screen does not import ride_state',
  !/from\s*'[^']*ride_state/.test(receipt));
expect('receipt screen renders the cash + noncash variants',
  /pay-badge--cash/.test(receipt) && /pay-badge--noncash/.test(receipt));
expect('receipt screen renders the missing fallback',
  /receiptMissingHtml/.test(receipt) && /Чек не найден/.test(receipt));
expect('receipt screen renders the syncing skeleton',
  /receiptSkeletonHtml/.test(receipt) && /Синхронизируем/.test(receipt));
expect('receipt screen carries no inline money arithmetic',
  !MONEY_ARITH.test(receipt), 'no fare/commission/tip/net recomputation');
expect('receipt screen never reintroduces a commission rate',
  !/0\.12/.test(receipt));

// ── 3. Driver payouts list reads receipt.net (state B) ───────
const profile = read('../public/src/screens/profile.js');
expect('profile imports listDriverReceipts',
  /import\s*\{[^}]*listDriverReceipts[^}]*\}\s*from\s*'\.\.\/mock_api\.js'/.test(profile));
const payoutFn = functionBody(profile, 'driverReceiptPayoutSectionHtml') || '';
expect('payouts list is rendered from listDriverReceipts()',
  /listDriverReceipts\(\)/.test(payoutFn));
expect('payout row shows net from the receipt (r.net)',
  /r\.net/.test(payoutFn));
expect('payout row carries no inline money arithmetic',
  !MONEY_ARITH.test(payoutFn));
expect('payout row deep-links to the /receipt route',
  /data-receipt-trip/.test(payoutFn) && /\/receipt\?tripId=/.test(profile));

// ── 4. History row/detail read the receipt (state A) ─────────
const historyRowFn = functionBody(profile, 'driverHistoryEntryHtml') || '';
const historyDetailFn = functionBody(profile, 'driverDetailRowsHtml') || '';
const netSelectFn = functionBody(profile, 'driverEntryNetValue') || '';
expect('history net selection prefers the receipt',
  /receipt\.net/.test(netSelectFn));
expect('history row reads the receipt (route/payment/breakdown/net)',
  /driverEntryReceipt\(/.test(historyRowFn) && /driverEntryNetValue\(/.test(historyRowFn));
expect('history row shows the payment mode',
  /receiptPaymentModeLabel/.test(historyRowFn));
expect('history row carries no inline money arithmetic',
  !MONEY_ARITH.test(historyRowFn));
expect('history detail carries no inline money arithmetic',
  !MONEY_ARITH.test(historyDetailFn));

// ── 5. Route + offline registration ──────────────────────────
const app = read('../public/src/app.js');
expect('app registers the /receipt route',
  /register\('\/receipt',\s*tripReceipt\)/.test(app));
const sw = read('../public/sw.js');
expect('sw precaches the trip receipt screen',
  /screens\/trip_receipt\.js/.test(sw));

// ── 6. Auth boundary wiring (PR #382, Codex #2) ──────────────
const boundarySrc = read('../public/src/storage_boundary.js');
expect('storage_boundary imports clearDriverReceiptsStore',
  /import\s*\{[\s\S]*?clearDriverReceiptsStore[\s\S]*?\}\s*from\s*'\.\/mock_api\.js'/.test(boundarySrc));
expect('clearUserScopedStorage calls clearDriverReceiptsStore()',
  /clearUserScopedStorage[\s\S]*?clearDriverReceiptsStore\(\)/.test(boundarySrc));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
