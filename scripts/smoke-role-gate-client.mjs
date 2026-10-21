// BD-AUTH-POLICY-01B-C (K3-2) — smoke for the client handling of the server's role gates
// (docs/driver-role-grant-contract.md §2, §4).
//
// Behavioural (Node, no network):
//   - role_gate.js: only 403 PASSENGER_ROLE_REQUIRED / DRIVER_ROLE_REQUIRED and 409
//     DRIVER_NOT_ELIGIBLE are role gates; the driver-mode «Попутчик» text never suggests the switch;
//   - responses.runSelectDriverOrchestration (the real select path): a passenger-role refusal and
//     an ineligible driver get their own reasons and texts, never «Этот заказ уже принят другим
//     водителем»; a plain 409 keeps that text; nothing navigates.
// Static: the /responses role-gate state and its profile way out, composer / order_map_draft /
// respond mappings, the precache entry.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const issues = [];
let passed = 0;
async function check(label, fn) {
  try { await fn(); passed++; console.log('PASS — ' + label); }
  catch (err) { issues.push(label); console.log('FAIL — ' + label + ' :: ' + (err?.message ?? err)); }
}
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };

const gate = await import(new URL('../public/src/role_gate.js', import.meta.url).href);
const responses = await import(new URL('../public/src/screens/responses.js', import.meta.url).href);

await check('roleGateCode recognizes exactly the three role-gate refusals', async () => {
  assert.equal(gate.roleGateCode({ status: 403, code: 'PASSENGER_ROLE_REQUIRED' }), 'PASSENGER_ROLE_REQUIRED');
  assert.equal(gate.roleGateCode({ status: 403, code: 'DRIVER_ROLE_REQUIRED' }), 'DRIVER_ROLE_REQUIRED');
  assert.equal(gate.roleGateCode({ status: 409, code: 'DRIVER_NOT_ELIGIBLE' }), 'DRIVER_NOT_ELIGIBLE');
  for (const err of [
    { status: 403, code: 'FORBIDDEN' }, { status: 409, code: 'ORDER_NOT_OPEN' },
    { status: 409, code: 'PASSENGER_ROLE_REQUIRED' }, { status: 403, code: 'DRIVER_NOT_ELIGIBLE' },
    { status: 0, code: 'NETWORK' }, { status: 503, code: 'AUTHORITY_LOOKUP_FAILED' }, null, undefined, {},
  ]) assert.equal(gate.roleGateCode(err), null, JSON.stringify(err));
});

await check('texts: the driver-mode «Попутчик» text never points at the role switch (#1081)', async () => {
  const t = gate.ROLE_GATE_TEXT;
  assert.equal(t.driverRidePublish, 'Публикация поездок от водителя пока недоступна.');
  assert.doesNotMatch(t.driverRidePublish, /режим|профил|переключ/i);
  for (const key of ['select', 'orderCreate', 'offerCreate', 'offersListBody']) assert.match(t[key], /профил/i, key);
  assert.match(t.offersListTitle, /режиме пассажира/);
  assert.match(t.driverNotEligible, /больше не может принять заказ/);
  assert.equal(gate.PROFILE_CTA_LABEL, 'Перейти в профиль');
  assert.equal(Object.isFrozen(t), true);
});

// The real select orchestration with its pre-API checks stubbed to pass (a server-fed order).
async function selectWith(failure) {
  const driver = { id: 'resp-1', responseId: 'resp-1', driverId: '11111111-1111-4111-8111-111111111111', name: 'Водитель' };
  const toasts = [];
  let navigated = 0;
  const outcome = await responses.runSelectDriverOrchestration(
    { drivers: [driver], driverId: driver.id, responseId: driver.responseId, request: { orderId: 'order-x' },
      canonicalOrder: null, backendAuthoritative: true, isDemoOrder: false },
    {
      resolveClickedDriverFn: () => driver,
      isValidLocalResponseForOrderFn: () => true,
      isExistingRideCompatibleWithSelectionFn: () => true,
      selectOfferOnBackend: async () => { throw Object.assign(new Error('fixture'), failure); },
      buildPassengerActiveRide: () => { throw new Error('must not build'); },
      navigate: () => { navigated++; },
      showToast: (text) => toasts.push(text),
    },
  );
  return { outcome, toasts, navigated };
}

await check('select: 403 PASSENGER_ROLE_REQUIRED → its own reason and the profile text, no navigation', async () => {
  const r = await selectWith({ status: 403, code: 'PASSENGER_ROLE_REQUIRED' });
  assert.deepEqual(r.outcome, { ok: false, reason: 'passenger-role-required' });
  assert.deepEqual(r.toasts, [gate.ROLE_GATE_TEXT.select]);
  assert.equal(r.navigated, 0);
});

await check('select: 409 DRIVER_NOT_ELIGIBLE is not «another driver won»', async () => {
  const r = await selectWith({ status: 409, code: 'DRIVER_NOT_ELIGIBLE' });
  assert.deepEqual(r.outcome, { ok: false, reason: 'driver-not-eligible' });
  assert.deepEqual(r.toasts, [gate.ROLE_GATE_TEXT.driverNotEligible]);
  assert.equal(r.navigated, 0);
});

await check('select: other refusals keep their existing texts', async () => {
  const taken = await selectWith({ status: 409, code: 'ORDER_NOT_OPEN' });
  assert.deepEqual([taken.outcome.reason, taken.toasts], ['backend-select-failed', ['Этот заказ уже принят другим водителем']]);
  const failed = await selectWith({ status: 503, code: 'AUTHORITY_LOOKUP_FAILED' });
  assert.deepEqual([failed.outcome.reason, failed.toasts], ['backend-select-failed', ['Не удалось выбрать водителя. Попробуйте ещё раз.']]);
});

// ── Static wiring ─────────────────────────────────────────────────────────────
const responsesSrc = read('../public/src/screens/responses.js');
const composer = read('../public/src/screens/composer.js');
const draft = read('../public/src/screens/order_map_draft.js');
const respond = read('../public/src/screens/respond.js');
const sw = read('../public/sw.js');

await check('/responses: the offers read refusal opens the role-gate state with the profile way out', async () => {
  assert.match(responsesSrc, /if \(roleGateCode\(err\) === PASSENGER_ROLE_REQUIRED\) \{\s*enterRoleGate\(\);\s*return;/);
  assert.match(responsesSrc, /readState = 'role-gate';\s*renderReadRegion\(\);/);
  const state = responsesSrc.slice(responsesSrc.indexOf('function renderRoleGateState()'),
    responsesSrc.indexOf('function renderAcceptedDriver('));
  assert.match(state, /ROLE_GATE_TEXT\.offersListTitle/);
  assert.match(state, /data-action="open-profile"/);
  assert.doesNotMatch(state, /retry-offers|responses-check/, 'no retry that cannot succeed');
  assert.match(responsesSrc, /closest\('\[data-action="open-profile"\]'\)\) \{\s*go\('\/profile'\);/);
  assert.match(responsesSrc, /if \(outcome\.reason === 'passenger-role-required'\) enterRoleGate\(\);\s*else if \(outcome\.reason === 'driver-not-eligible'\) void loadServerOffers\(\);/);
});

await check('composer: a driver-mode «Попутчик» gets the unavailable text without the switch; a passenger view gets the profile', async () => {
  assert.match(composer, /if \(roleGateCode\(err\) === PASSENGER_ROLE_REQUIRED\) \{\s*if \(isDriverMode\(user\.get\(\)\)\) showError\(ROLE_GATE_TEXT\.driverRidePublish\);\s*else showError\(ROLE_GATE_TEXT\.orderCreate, \{ profile: true \}\);/);
  assert.match(composer, /roleNoteText\.textContent = isBackendEnabled\(\)\s*\? ROLE_GATE_TEXT\.driverRidePublish\s*: 'Вы в режиме водителя\. Эта публикация будет создана как пассажирский запрос\.'/);
  assert.match(composer, /id="composer-error-profile" hidden>\$\{PROFILE_CTA_LABEL\}</);
  assert.match(composer, /errorProfile\?\.addEventListener\('click', \(\) => go\('\/profile'\)\)/);
});

await check('order_map_draft: a refused publish shows the order text with a profile action', async () => {
  assert.match(draft, /roleGateCode\(err\) === PASSENGER_ROLE_REQUIRED\) \{\s*publishFeedback\(root, 'error', ROLE_GATE_TEXT\.orderCreate, draft, \{ publishing: false, action: 'open-profile' \}\);/);
  assert.match(draft, /form\.notice\.action === 'open-profile'[\s\S]{0,200}data-action="open-profile">\$\{PROFILE_CTA_LABEL\}/);
  assert.match(draft, /if \(action === 'open-profile'\) \{\s*go\('\/profile'\);\s*return;/);
});

await check('respond: DRIVER_ROLE_REQUIRED on the driver offer shows the driver-mode text and the profile', async () => {
  assert.match(respond, /if \(roleGateCode\(err\) === DRIVER_ROLE_REQUIRED\) \{\s*showError\(ROLE_GATE_TEXT\.offerCreate\);\s*if \(errorProfile\) errorProfile\.hidden = false;/);
  assert.match(respond, /id="respond-error-profile" hidden>\$\{PROFILE_CTA_LABEL\}</);
  assert.match(respond, /errorProfile\?\.addEventListener\('click', \(\) => go\('\/profile'\)\)/);
});

await check('sw.js precaches role_gate.js', async () => {
  assert.match(sw, /'\.\/src\/role_gate\.js',/);
});

console.log(`role-gate-client: ${passed} checks PASS${issues.length ? `, ${issues.length} FAIL` : ''}`);
if (issues.length) process.exitCode = 1;
