// BD-PROFILE-D-03 (P2) — pane deep-link alias safety smoke.
//
// Background: renderDriver resolves the ?pane= query param through a plain
// PANE_ALIASES object. Without an own-property guard a prototype key such as
// ?pane=constructor would resolve to Object.prototype.constructor, get
// interpolated into a `.pf2-tab[data-pane="…"]` selector, and could make
// querySelector throw — aborting the whole profile render. This smoke drives
// the REAL profile() default export behind a minimal DOM stub and asserts:
//   • every documented alias still activates the right pane,
//   • a prototype-polluting / unknown pane neither throws nor activates a pane
//     (it falls back to the default overview tab),
//   • a missing pane param is a safe no-op.
//
// No browser, no jsdom — a permissive DOM stub whose querySelector never
// returns null, so renderDriver's wiring runs to completion. The only stateful
// hook records which `.pf2-tab[data-pane="X"]` element had click() called.

// ── localStorage stub (state.js / mock_api.js persist here) ──────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

// ── Minimal DOM stub ─────────────────────────────────────────────────────────
let clickedPanes = [];

function paneFromSelector(sel) {
  const m = typeof sel === 'string' && sel.match(/data-pane="([^"]*)"/);
  return m ? m[1] : null;
}

function makeEl(recordPane) {
  return {
    _html: '',
    className: '', textContent: '', value: '', checked: false,
    hidden: false, disabled: false,
    dataset: {},
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    style: {},
    set innerHTML(v) { this._html = String(v); },
    get innerHTML() { return this._html; },
    get firstElementChild() { return makeEl(); },
    addEventListener() {}, removeEventListener() {},
    querySelector(sel) { return makeEl(paneFromSelector(sel)); },
    querySelectorAll() { return []; },
    closest() { return null; },
    contains() { return false; },
    appendChild(x) { return x; }, removeChild() {}, replaceWith() {}, remove() {},
    setAttribute() {}, getAttribute() { return null; },
    scrollIntoView() {}, focus() {}, blur() {},
    click() { if (recordPane != null) clickedPanes.push(recordPane); },
  };
}

globalThis.window = { location: { hash: '' }, addEventListener() {}, removeEventListener() {} };
globalThis.document = {
  createElement: () => makeEl(),
  addEventListener() {}, removeEventListener() {},
  querySelector(sel) { return makeEl(paneFromSelector(sel)); },
};

// ── Seed a driver so every pane has content to render ────────────────────────
const { user } = await import('../public/src/state.js');
user.reset();
user.set({
  onboarded: true, role: 'driver', firstName: 'Алексей', lastName: 'В.',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Toyota', vehicleModel: 'Camry', vehiclePlate: 'А123ВЕ77',
  driverDocuments: {
    driverLicense: { status: 'uploaded' },
    taxiOsago: { status: 'review_required' },
    taxiRegistry: { status: 'expired' },
    waybill: { status: 'missing' },
    medicalCheck: { status: 'missing' },
  },
  documentsReady: false,
});

const profile = (await import('../public/src/screens/profile.js')).default;

// ── Assertions ───────────────────────────────────────────────────────────────
const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// Runs profile() for a hash, returning { threw, panes } where panes is the list
// of data-pane ids that had a deep-link click() invoked during render.
function run(hash) {
  globalThis.window.location.hash = hash;
  clickedPanes = [];
  let threw = false;
  try { profile(); } catch (e) { threw = true; console.log('  threw: ' + e.message); }
  return { threw, panes: clickedPanes.slice() };
}

// Valid aliases → expected internal pane id activated via deep-link click().
const VALID = [
  ['overview', 'overview'],
  ['taxi-ip', 'ip'],
  ['documents', 'docs'],
  ['payouts', 'payouts'],
  ['safety', 'security'],
  // internal ids still accepted
  ['ip', 'ip'],
  ['docs', 'docs'],
  ['security', 'security'],
];
for (const [param, expectedPane] of VALID) {
  const { threw, panes } = run(`#/profile?role=driver&pane=${param}`);
  expect(`pane=${param} does not throw`, !threw);
  expect(`pane=${param} activates «${expectedPane}»`, panes.includes(expectedPane), panes.join(',') || 'none');
}

// Prototype-polluting / unknown panes → no throw, no pane activated (falls back
// to the default overview, which tabsHtml already marks active at render time).
for (const bad of ['constructor', '__proto__', 'hasOwnProperty', 'toString', 'bogus', '']) {
  const { threw, panes } = run(`#/profile?role=driver&pane=${bad}`);
  expect(`pane=${bad || '(empty)'} does not throw`, !threw);
  expect(`pane=${bad || '(empty)'} activates no deep-link pane (fallback to overview)`,
    panes.length === 0, panes.join(','));
}

// Missing pane param is a safe no-op deep-link.
{
  const { threw, panes } = run('#/profile?role=driver');
  expect('no pane param does not throw', !threw);
  expect('no pane param activates no deep-link pane', panes.length === 0, panes.join(','));
}

if (issues.length) {
  console.error('\nSMOKE FAILED:');
  for (const i of issues) console.error('  - ' + i);
  process.exit(1);
}
console.log('\nAll profile pane-alias smoke checks passed.');
