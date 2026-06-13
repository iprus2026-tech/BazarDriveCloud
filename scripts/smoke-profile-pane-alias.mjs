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
// No browser, no jsdom — a permissive DOM stub so renderDriver's wiring runs
// to completion. Two stateful hooks:
//   • clickedPanes records which `.pf2-tab[data-pane="X"]` element had
//     click() called during deep-link resolution.
//   • renderedHtml accumulates every innerHTML assignment within a single
//     run() so the stub can be SURFACE-AWARE: a `.pf2-tab[data-pane="X"]`
//     selector resolves to a clickable element ONLY when the rendered HTML
//     actually contains a real tab carrying `data-pane="X"`. Other selectors
//     stay permissive so unrelated wiring is not perturbed.
//
// BD-PROFILE-PANE-ALIAS-SMOKE-TAB-SURFACE-S: without the surface check, the
// stub would happily fabricate a clickable element for ANY alias even after
// the runtime tab list was renamed / removed, letting the smoke prove only
// "selector attempted" instead of "tab exists in the rendered surface".

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
// BD-PROFILE-PANE-ALIAS-SMOKE-TAB-SURFACE-S — rendered-HTML tracker. Every
// innerHTML assignment is accumulated here for the duration of a single
// run(), so the surface check below can ask: did the runtime actually
// render a `data-pane="X"` tab? The string is reset at the start of every
// run() in `run()` below.
let renderedHtml = '';

function paneFromSelector(sel) {
  const m = typeof sel === 'string' && sel.match(/data-pane="([^"]*)"/);
  return m ? m[1] : null;
}

function paneIsRendered(pane) {
  // Direct substring match — the runtime renders tabs as
  // `<button class="pf2-tab" … data-pane="X">…`, so a literal
  // `data-pane="X"` in the assigned HTML proves the tab exists.
  return typeof pane === 'string'
    && renderedHtml.includes(`data-pane="${pane}"`);
}

function resolveBySelector(sel) {
  const pane = paneFromSelector(sel);
  // Permissive default — non-tab selectors always resolve so unrelated
  // profile() wiring (renderDriver, garage, status, etc.) is not perturbed.
  if (pane == null) return makeEl();
  // Surface-aware — a `.pf2-tab[data-pane="X"]` selector resolves to a
  // CLICKABLE pane element ONLY when the rendered HTML actually contains
  // `data-pane="X"`. If the tab is missing, return null and the runtime's
  // `?.click()` becomes a safe no-op (matching real-DOM behavior). This
  // is what makes the smoke catch a tab-list rename / removal.
  if (!paneIsRendered(pane)) return null;
  return makeEl(pane);
}

function makeEl(recordPane) {
  return {
    _html: '',
    className: '', textContent: '', value: '', checked: false,
    hidden: false, disabled: false,
    dataset: {},
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    style: {},
    set innerHTML(v) {
      this._html = String(v);
      renderedHtml += this._html;
    },
    get innerHTML() { return this._html; },
    get firstElementChild() { return makeEl(); },
    addEventListener() {}, removeEventListener() {},
    querySelector(sel) { return resolveBySelector(sel); },
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
  querySelector(sel) { return resolveBySelector(sel); },
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

// Runs profile() for a hash, returning { threw, panes, html } where panes is
// the list of data-pane ids that had a deep-link click() invoked during render
// and html is the full innerHTML accumulated during this single render.
function run(hash) {
  globalThis.window.location.hash = hash;
  clickedPanes = [];
  // BD-PROFILE-PANE-ALIAS-SMOKE-TAB-SURFACE-S — reset the surface tracker
  // so a tab rendered in a previous run() can't keep a later deep-link
  // selector resolving after the runtime has removed it.
  renderedHtml = '';
  let threw = false;
  try { profile(); } catch (e) { threw = true; console.log('  threw: ' + e.message); }
  return { threw, panes: clickedPanes.slice(), html: renderedHtml };
}

// BD-PROFILE-PANE-ALIAS-SMOKE-TAB-SURFACE-S — direct surface-shape pin: the
// rendered driver profile must include exactly the five canonical tab
// `data-pane="…"` markers. If a tab is renamed / removed in the runtime
// without an accompanying smoke fix, this surface pin fails BEFORE the
// alias-level pins below, naming the missing tab directly.
{
  const { threw, html } = run('#/profile?role=driver');
  expect('surface: driver profile render does not throw', !threw);
  for (const pane of ['overview', 'ip', 'docs', 'payouts', 'security']) {
    expect(`surface: rendered profile carries data-pane="${pane}"`,
      html.includes(`data-pane="${pane}"`));
  }
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
