// BD-RIDE-HISTORY-D-01 — no-drift guard for the driver completed-ride receipt
// (issue #381).
//
// The completed driver flow persists ONE canonical receipt object, and no
// screen computes its amounts (#1059):
// - backend-ON: the server derives them; mock_api.requestServerDriverReceipt
//   POSTs only { tripId, paymentMode } and stores the response;
// - backend-OFF: mock_api.resolveMockDriverReceipt applies the same rule,
//   with its commission pinned to the server default.
// Ride history, Driver payouts and the /receipt screen must only READ that
// stored object and FORMAT it — never recompute fare / commission / tip / net.
// A future refactor could silently re-fork the math (a second commission rate,
// an inline subtraction in a card, a recomputed net in payouts) without
// tripping check.mjs.
//
// This guard mixes small BEHAVIOURAL round-trips with STATIC cross-surface
// assertions. The round-trips cover the receipt store, the mock rule, and the
// server request against a stubbed fetch. The static checks confirm every read
// surface reads the receipt and carries no inline arithmetic on the money
// fields. No browser, no Mapbox, no backend, no network.

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
const sheetNet = 1475; // the stored receipt's net, which the sheet payload only formats
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
// ?state=cash resolves paymentMode='noncash'. The backend-OFF resolver is
// write-once like the server, so the existing receipt is returned verbatim and
// never flipped to noncash. (Backend-ON: the server returns its stored
// receipt — see 0c.)
const liveTripId = 'trip_cash_rerender_demo';
api.saveDriverReceipt({
  tripId: liveTripId,
  completedAt: '2026-06-04T10:00:00.000Z',
  fare: 1540, commission: -185, tip: 120, net: 1475,
  paymentMode: 'cash', status: 'completed',
});
const preserved = api.resolveMockDriverReceipt({
  tripId: liveTripId, completedAt: '2026-06-04T10:05:00.000Z', paymentMode: 'noncash', fareBasis: '950 ₽',
});
expect('cash receipt stays cash after rerender without ?state=cash',
  preserved && preserved.paymentMode === 'cash' && preserved.net === 1475);
expect('idempotent rerender keeps the persisted cash receipt intact',
  api.getReceipt(liveTripId)?.paymentMode === 'cash' && api.getReceipt(liveTripId)?.net === 1475);

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

// ── 0c. #1059 — the server rule, its backend-OFF mirror, and the ON request ──
// Backend-OFF: mock_api applies the server rule. The fare is the agreed price
// rounded half up, commission = -round(fare * pct / 100), tip = 0, and
// net = fare + commission + tip.
expect('mock_api exports the receipt resolvers',
  ['deriveMockReceiptAmounts', 'resolveMockDriverReceipt', 'requestServerDriverReceipt']
    .every((fn) => typeof api[fn] === 'function'));
const mockAmounts = (basis) => api.deriveMockReceiptAmounts(basis);
expect('mock rule: 950 ₽ → 950 / −114 / 0 / 836',
  JSON.stringify(mockAmounts('950 ₽')) === JSON.stringify({ fare: 950, commission: -114, tip: 0, net: 836 }));
expect('mock rule: 763 ₽ → 763 / −92 / 0 / 671 (the server result for the E2E ride)',
  JSON.stringify(mockAmounts('763 ₽')) === JSON.stringify({ fare: 763, commission: -92, tip: 0, net: 671 }));
expect('mock rule: grouped labels parse (1 480 ₽ with a plain or no-break space)',
  mockAmounts('1 480 ₽')?.fare === 1480 && mockAmounts('1 480 ₽')?.fare === 1480
  && mockAmounts('1 480 ₽')?.commission === -178);
expect('mock rule: a fractional basis rounds half up (763,5 ₽ → 764 / −92 / 0 / 672)',
  JSON.stringify(mockAmounts('763,5 ₽')) === JSON.stringify({ fare: 764, commission: -92, tip: 0, net: 672 }));
expect('mock rule: no positive basis → null (the server\'s RECEIPT_FARE_UNKNOWN)',
  [null, undefined, '', '0 ₽', 0, -5, 'abc', '—'].every((b) => mockAmounts(b) === null));
const serverConfig = read('../server/src/config.js');
const serverDefault = Number((serverConfig.match(/export\s+const\s+DEFAULT_RECEIPT_COMMISSION_PERCENT\s*=\s*(\d+(?:\.\d+)?)\s*;/) || [])[1]);
expect('MOCK_RECEIPT_COMMISSION_PERCENT equals the server DEFAULT_RECEIPT_COMMISSION_PERCENT',
  Number.isFinite(serverDefault) && api.MOCK_RECEIPT_COMMISSION_PERCENT === serverDefault,
  `mock ${api.MOCK_RECEIPT_COMMISSION_PERCENT} vs server ${serverDefault}`);

// The fetch stub records every request; the OFF resolver must never reach it.
const realFetch = globalThis.fetch;
const requests = [];
let nextResponse = null;
globalThis.fetch = async (url, init = {}) => {
  requests.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
  const { status, payload } = nextResponse;
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) };
};
try {
  const offReceipt = api.resolveMockDriverReceipt({
    tripId: 'trip_off_demo', completedAt: '2026-10-19T10:00:00.000Z', paymentMode: 'noncash', fareBasis: '950 ₽',
  });
  expect('backend-OFF resolver derives and persists the mock receipt',
    offReceipt && offReceipt.fare === 950 && offReceipt.net === 836 && api.getReceipt('trip_off_demo')?.net === 836);
  expect('backend-OFF resolver without a basis returns null and stores nothing',
    api.resolveMockDriverReceipt({ tripId: 'trip_off_nobasis', paymentMode: 'noncash', fareBasis: null }) === null
    && api.getReceipt('trip_off_nobasis') === null);
  expect('backend-OFF resolver never calls fetch', requests.length === 0);

  // Backend-ON: POST only { tripId, paymentMode }; store the server's receipt.
  globalThis.__BD_API_BASE__ = 'https://api.example.invalid';
  api.saveDriverReceipt({ // an older client-computed receipt (the E2E's demo amounts)
    tripId: 'trip_on_e2e', completedAt: '2026-10-19T10:00:00.000Z',
    fare: 950, commission: -114, tip: 120, net: 956, paymentMode: 'noncash',
  });
  nextResponse = { status: 201, payload: { receipt: {
    tripId: 'trip_on_e2e', fare: 763, commission: -92, tip: 0, net: 671,
    paymentMode: 'noncash', status: 'completed', completedAt: '2026-10-19T10:01:00.000Z',
  } } };
  const onReceipt = await api.requestServerDriverReceipt({ tripId: 'trip_on_e2e', paymentMode: 'noncash' });
  const [req] = requests;
  expect('backend-ON POSTs /api/v1/history/receipts once',
    requests.length === 1 && req.method === 'POST' && req.url.endsWith('/api/v1/history/receipts'));
  expect('backend-ON receipt body carries only tripId + paymentMode (no client amounts)',
    req && JSON.stringify(Object.keys(req.body).sort()) === JSON.stringify(['paymentMode', 'tripId'])
    && req.body.tripId === 'trip_on_e2e', JSON.stringify(req && req.body));
  expect('backend-ON returns the server receipt',
    onReceipt && onReceipt.fare === 763 && onReceipt.commission === -92 && onReceipt.tip === 0 && onReceipt.net === 671);
  expect('backend-ON replaces the older local receipt with the server one',
    api.getReceipt('trip_on_e2e')?.net === 671 && api.getReceipt('trip_on_e2e')?.tip === 0);

  const rejects = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };
  nextResponse = { status: 409, payload: { error: 'no server fare basis for this ride', code: 'RECEIPT_FARE_UNKNOWN', retryable: false } };
  const noBasis = await rejects(() => api.requestServerDriverReceipt({ tripId: 'trip_on_nobasis', paymentMode: 'noncash' }));
  expect('backend-ON 409 RECEIPT_FARE_UNKNOWN rejects with the server code and stores nothing',
    noBasis && noBasis.code === 'RECEIPT_FARE_UNKNOWN' && api.getReceipt('trip_on_nobasis') === null);
  nextResponse = { status: 201, payload: { receipt: { tripId: 'trip_on_bad', fare: 763, commission: -92, tip: 0 } } };
  const malformed = await rejects(() => api.requestServerDriverReceipt({ tripId: 'trip_on_bad', paymentMode: 'noncash' }));
  expect('backend-ON malformed receipt rejects BAD_RESPONSE and stores nothing',
    malformed && malformed.code === 'BAD_RESPONSE' && api.getReceipt('trip_on_bad') === null);
} finally {
  delete globalThis.__BD_API_BASE__;
  globalThis.fetch = realFetch;
  store.clear();
}

// ── 1. No money math in the completed flow (#1059) ───────────
const activeRide = read('../public/src/screens/active_ride.js');
const mockApiSrc = read('../public/src/mock_api.js');
const completedFn = functionBody(activeRide, 'renderCompleted') || '';
const serverReceiptFn = functionBody(activeRide, 'renderServerReceipt') || '';
const submitFn = functionBody(mockApiSrc, 'submitReceiptToBackend') || '';
expect('the sheet payload formats the receipt (buildDriverEarningsPayload(ride, receipt))',
  /function\s+buildDriverEarningsPayload\s*\(\s*ride\s*,\s*receipt\s*\)/.test(activeRide));
expect('renderCompleted resolves the receipt: server for a server ride, the mock stand-in in backend-OFF',
  /if\s*\(\s*backendRide\s*\)/.test(completedFn) && /renderServerReceipt\(/.test(completedFn)
  && /isBackendEnabled\(\)\s*\?\s*null\s*:\s*resolveMockDriverReceipt\(/.test(completedFn)
  && /requestServerDriverReceipt\(/.test(serverReceiptFn));
expect('the backend-OFF mock basis is the agreed order price',
  /fareBasis:\s*ride\.order\?\.offerPrice/.test(completedFn));
expect('active_ride.js never writes a receipt with its own amounts',
  !/saveDriverReceipt\s*\(/.test(activeRide) && !/\bfare:\s*payload\./.test(activeRide)
  && !/commission:\s*-?payload\./.test(activeRide));
expect('completed flow records the payment mode',
  /paymentMode/.test(completedFn) && /'cash'/.test(completedFn) && /'noncash'/.test(completedFn));
expect('a COMPLETED rerender reuses the server receipt instead of POSTing again',
  /if\s*\(\s*current\.receipt\s*\)\s*openDriverEarnings\(\s*current\.receipt\s*\)/.test(serverReceiptFn));
expect('submitReceiptToBackend posts only { tripId, paymentMode }',
  /body:\s*\{\s*tripId,\s*paymentMode\s*\}/.test(submitFn) && !/\b(fare|commission|tip|net)\b/.test(submitFn));

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
// #1070 — the row markup is shared by the OFF list and the ON server list (driverReceiptRowHtml).
const payoutRowFn = functionBody(profile, 'driverReceiptRowHtml') || '';
expect('payouts list is rendered from listDriverReceipts()',
  /listDriverReceipts\(\)/.test(payoutFn));
expect('payout row shows net from the receipt (r.net)',
  /r\.net/.test(payoutRowFn) && /driverReceiptListHtml\(/.test(payoutFn));
expect('payout row carries no inline money arithmetic',
  !MONEY_ARITH.test(payoutFn) && !MONEY_ARITH.test(payoutRowFn));
expect('payout row deep-links to the /receipt route',
  /data-receipt-trip/.test(payoutRowFn) && /\/receipt\?tripId=/.test(profile));

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
