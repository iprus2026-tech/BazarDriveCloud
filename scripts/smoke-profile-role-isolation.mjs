// BD-ROLE-05 — Per-tab profile role isolation smoke.
//
// Background: the profile screen derives effectiveRole as
//   ?role= (render-gate preview) > getSmokeRole() (sessionStorage) > u.role.
// Two browser tabs of the same onboarded user must be able to render
// different role views simultaneously — the per-tab sessionStorage override
// is the seam that makes this possible. This smoke asserts:
//   • a persisted-driver user with sessionStorage smokeRole=passenger renders
//     the passenger view (smoke override wins over persisted role),
//   • a persisted-passenger user with sessionStorage smokeRole=driver renders
//     the driver view (inverse direction),
//   • calling setSmokeRole() never writes to the bazardrive.user.v1 key in
//     localStorage (the persisted role stays exactly what onboarding set it
//     to),
//   • the rendered passenger and driver views each expose their new
//     #pfp-role-switch / #pf2-act-role-switch button so the switcher exists
//     in the produced markup.
//
// Same DOM-stub strategy as smoke-profile-pane-alias.mjs: a permissive stub
// whose querySelector never returns null and which records each section's
// innerHTML, so a single profile() call produces inspectable markup without
// jsdom.

// ── localStorage stub (state.js / mock_api.js persist here) ──────────────────
const local = new Map();
globalThis.localStorage = {
  getItem: (k) => (local.has(k) ? local.get(k) : null),
  setItem: (k, v) => local.set(k, String(v)),
  removeItem: (k) => local.delete(k),
  clear: () => local.clear(),
};

// ── sessionStorage stub (smoke_role.js per-tab override lives here) ──────────
const session = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (session.has(k) ? session.get(k) : null),
  setItem: (k, v) => session.set(k, String(v)),
  removeItem: (k) => session.delete(k),
  clear: () => session.clear(),
};

// ── Minimal DOM stub (records each element's innerHTML and click handlers) ───
// Click handlers are captured by selector so the smoke can invoke them later
// and observe what route the click navigated to (via the hash spy below).
const clickHandlers = new Map(); // selector → fn

// BD-PROFILE-ROLE-ISOLATION-SMOKE-SURFACE-CLICK-S — rendered-HTML tracker.
// Every innerHTML assignment is accumulated here for the duration of a
// single renderHtml() so the click-capture path can be SURFACE-AWARE: an
// `#id` selector receives an addEventListener-stored handler ONLY when
// the rendered surface actually carries `id="…"`. Without this, the
// permissive querySelector stub fabricates an element for ANY selector
// and the click-capture map silently holds ghost handlers for ids that
// were renamed or removed in the runtime markup — exactly the surface
// regression S7/S8 were meant to catch.
let renderedHtml = '';

function selectorIsRendered(selector) {
  if (typeof selector !== 'string') return false;
  if (selector.startsWith('#')) {
    // Plain id selectors are what the smoke invokes directly
    // (#pfp-role-switch, #pf2-act-role-switch, #pf-mypub-create). The
    // surface check is a substring lookup of `id="…"` — the runtime
    // renders these buttons as `<button id="X" …>`, so a literal
    // `id="X"` in the assigned HTML proves the element exists.
    const id = selector.slice(1);
    return renderedHtml.includes(`id="${id}"`);
  }
  // Other selector shapes (class, attribute, composite) are NOT in this
  // smoke's direct capture set, so keep the permissive default: any
  // addEventListener on them still captures so unrelated wiring is not
  // perturbed. This is the smallest safe change.
  return true;
}

function makeEl(selectorHint) {
  return {
    _html: '',
    _selector: selectorHint || null,
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
    addEventListener(type, fn) {
      if (type === 'click'
        && this._selector
        && typeof fn === 'function'
        && selectorIsRendered(this._selector)) {
        clickHandlers.set(this._selector, fn);
      }
    },
    removeEventListener() {},
    querySelector(sel) { return makeEl(sel); },
    querySelectorAll() { return []; },
    closest() { return null; },
    contains() { return false; },
    appendChild(x) { return x; }, removeChild() {}, replaceWith() {}, remove() {},
    setAttribute() {}, getAttribute() { return null; },
    scrollIntoView() {}, focus() {}, blur() {},
    click() {},
  };
}

// ── Window / location spy ────────────────────────────────────────────────────
// router.go() writes to location.hash; capture every write so the smoke can
// observe what route a click handler navigated to. Reads return the most
// recently set value so router internals comparing `location.hash === target`
// stay stable.
const hashWrites = [];
let currentHash = '';
const locationStub = {};
Object.defineProperty(locationStub, 'hash', {
  configurable: true,
  get: () => currentHash,
  set: (v) => {
    const next = typeof v === 'string' && v.startsWith('#') ? v : '#' + String(v);
    currentHash = next;
    hashWrites.push(next);
  },
});

globalThis.window = { location: locationStub, addEventListener() {}, removeEventListener() {} };
// router.js references the bare global `location` (not `window.location`), so
// the spy must be visible under both names for go(path) to capture writes.
globalThis.location = locationStub;
globalThis.document = {
  createElement: () => makeEl(),
  addEventListener() {}, removeEventListener() {},
  querySelector: (sel) => makeEl(sel),
};

// ── Imports (after stubs are in place) ───────────────────────────────────────
const { user } = await import('../public/src/state.js');
const smokeRoleMod = await import('../public/src/smoke_role.js');
const { getSmokeRole, setSmokeRole, SMOKE_ROLE_KEY } = smokeRoleMod;
const { resetLocalSession } = await import('../public/src/mock_auth.js');
const profile = (await import('../public/src/screens/profile.js')).default;

const USER_KEY = 'bazardrive.user.v1';

// ── Test helpers ─────────────────────────────────────────────────────────────
const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

function reset() {
  local.clear();
  session.clear();
  user.reset();
  clickHandlers.clear();
  hashWrites.length = 0;
  currentHash = '';
  renderedHtml = '';
}

function persistedRole() {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw).role; } catch { return null; }
}

function renderHtml() {
  currentHash = '#/profile';
  clickHandlers.clear();
  hashWrites.length = 0;
  // Reset the surface tracker so a click handler captured in a previous
  // render() can't keep its ghost binding when this render's markup no
  // longer contains the matching id.
  renderedHtml = '';
  const section = profile();
  return section._html || '';
}

// Capture the route a click handler navigated to. Returns the last hash write
// the handler triggered, or null when no navigation happened.
function clickAndCaptureRoute(selector) {
  const before = hashWrites.length;
  const fn = clickHandlers.get(selector);
  if (typeof fn !== 'function') return null;
  fn();
  return hashWrites.length > before ? hashWrites[hashWrites.length - 1] : null;
}

const DRIVER_MARKER     = 'pf2-act-role-switch';
const DRIVER_LABEL      = 'Продолжить как пассажир';
const PASSENGER_MARKER  = 'pfp-role-switch';
const PASSENGER_LABEL   = 'Продолжить как водитель';

// ── Scenario 1 — persisted driver + no smoke = driver view ───────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Алексей', lastName: 'В.', displayName: 'Алексей В.',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Toyota', vehicleModel: 'Camry', vehiclePlate: 'А123ВЕ77',
});
{
  expect('S1: getSmokeRole() is null when sessionStorage empty',
    getSmokeRole() === null, String(getSmokeRole()));
  const html = renderHtml();
  expect('S1: persisted driver + no smoke renders driver view (has #pf2-act-role-switch)',
    html.includes(DRIVER_MARKER));
  expect('S1: driver view shows the "Продолжить как пассажир" label',
    html.includes(DRIVER_LABEL));
  expect('S1: driver view does NOT include passenger-side switcher id',
    !html.includes(PASSENGER_MARKER));
}

// ── Scenario 2 — persisted driver + smoke=passenger = passenger view ─────────
{
  setSmokeRole('passenger');
  expect('S2: setSmokeRole("passenger") writes only to sessionStorage (key set)',
    session.get(SMOKE_ROLE_KEY) === 'passenger', String(session.get(SMOKE_ROLE_KEY)));
  expect('S2: setSmokeRole did NOT write the user key to localStorage role',
    persistedRole() === 'driver', String(persistedRole()));
  const html = renderHtml();
  expect('S2: smoke override flips persisted-driver tab to passenger view',
    html.includes(PASSENGER_MARKER));
  expect('S2: passenger view shows the "Продолжить как водитель" label',
    html.includes(PASSENGER_LABEL));
  expect('S2: passenger view does NOT include driver-side switcher id',
    !html.includes(DRIVER_MARKER));
  expect('S2: persisted user.role still "driver" after smoke flip',
    persistedRole() === 'driver', String(persistedRole()));
}

// ── Scenario 3 — sticky smoke=driver re-flips back to driver view ────────────
{
  setSmokeRole('driver');
  const html = renderHtml();
  expect('S3: smoke=driver renders the driver view again',
    html.includes(DRIVER_MARKER));
  expect('S3: persisted user.role still "driver" after toggling smoke twice',
    persistedRole() === 'driver', String(persistedRole()));
}

// ── Scenario 4 — persisted passenger + smoke=driver = driver view ────────────
reset();
user.set({
  onboarded: true, role: 'passenger',
  firstName: 'Мария', lastName: 'К.', displayName: 'Мария К.',
  phone: '9007654321', phoneVerified: true,
});
{
  expect('S4: fresh reset clears sessionStorage smoke role',
    getSmokeRole() === null, String(getSmokeRole()));
  setSmokeRole('driver');
  const html = renderHtml();
  expect('S4: persisted-passenger tab with smoke=driver renders driver view',
    html.includes(DRIVER_MARKER));
  expect('S4: persisted user.role still "passenger" (untouched by smoke)',
    persistedRole() === 'passenger', String(persistedRole()));
}

// ── Scenario 5 — smoke=passenger re-renders the same passenger user as passenger view ──
{
  setSmokeRole('passenger');
  const html = renderHtml();
  expect('S5: persisted-passenger + smoke=passenger renders passenger view',
    html.includes(PASSENGER_MARKER));
  expect('S5: persisted user.role still "passenger" after final flip',
    persistedRole() === 'passenger', String(persistedRole()));
}

// ── Scenario 6 — guest view does NOT expose the switcher ─────────────────────
// renderGuest is selected when !u.onboarded OR effectiveRole === 'guest'. The
// switcher is intentionally only rendered inside renderDriver/renderPassenger,
// so the guest view markup must contain neither marker (no per-tab override is
// meaningful before onboarding picks a real role).
reset();
user.set({ welcomeSeen: true, role: 'guest' });
{
  const html = renderHtml();
  expect('S6: guest view does not expose driver-side switcher',
    !html.includes(DRIVER_MARKER));
  expect('S6: guest view does not expose passenger-side switcher',
    !html.includes(PASSENGER_MARKER));
}

// ── Scenario 7 — persisted driver in passenger-view tab routes CTAs as passenger ──
// Codex P2: after a persisted driver flips to passenger view via setSmokeRole,
// the create CTAs in wireMyPostsSection / wireHistorySection must route the
// click through the tab's effective role rather than the raw persisted
// user.role, otherwise the UI immediately drops the user back into
// /new?type=driver_offer.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Алексей', lastName: 'В.', displayName: 'Алексей В.',
  vehicleMake: 'Toyota', vehicleModel: 'Camry', vehiclePlate: 'А123ВЕ77',
});
setSmokeRole('passenger');
{
  renderHtml();
  // Surface pin before the click capture so a missing CTA fails with a
  // clear "id not rendered" signal instead of an opaque "route null".
  expect('S7 surface: passenger-view render includes id="pf-mypub-create"',
    renderedHtml.includes('id="pf-mypub-create"'));
  const myPostsRoute = clickAndCaptureRoute('#pf-mypub-create');
  expect('S7: #pf-mypub-create captured (passenger view rendered the row)',
    myPostsRoute !== null, String(myPostsRoute));
  expect('S7: #pf-mypub-create routes as passenger (passenger_request)',
    typeof myPostsRoute === 'string' && myPostsRoute.includes('passenger_request'),
    String(myPostsRoute));
  expect('S7: persisted user.role still "driver" after CTA click',
    persistedRole() === 'driver', String(persistedRole()));
}

// ── Scenario 8 — persisted passenger in driver-view tab routes CTAs as driver ──
// Inverse of S7: a persisted passenger who flipped this tab to driver view
// must see driver-publish CTAs route as driver. The wireMyPostsSection wiring
// is shared by both renderDriver and renderPassenger, so this exercises the
// other half of the applySmokeRole contract.
reset();
user.set({
  onboarded: true, role: 'passenger',
  firstName: 'Мария', lastName: 'К.', displayName: 'Мария К.',
});
setSmokeRole('driver');
{
  renderHtml();
  // Surface pin mirrors S7's — driver-view CTA must be in the rendered
  // markup before the click capture is meaningful.
  expect('S8 surface: driver-view render includes id="pf-mypub-create"',
    renderedHtml.includes('id="pf-mypub-create"'));
  const myPostsRoute = clickAndCaptureRoute('#pf-mypub-create');
  expect('S8: #pf-mypub-create captured under driver-view (smoke=driver)',
    myPostsRoute !== null, String(myPostsRoute));
  expect('S8: #pf-mypub-create routes as driver (driver_offer)',
    typeof myPostsRoute === 'string' && myPostsRoute.includes('driver_offer'),
    String(myPostsRoute));
  expect('S8: persisted user.role still "passenger" after CTA click',
    persistedRole() === 'passenger', String(persistedRole()));
}

// ── Scenario 9 — logout / auth boundary clears the per-tab role override ─────
// Codex P2: without this, the same-tab flow "switch to driver → logout →
// onboard as passenger" leaves the sessionStorage override at "driver", and
// /profile renders the driver view because getSmokeRole() wins over u.role.
// resetLocalSession() is the shared boundary called by both performLocalLogout
// and any future profile-wipe / account-switch flow.
reset();
user.set({ onboarded: true, role: 'driver', firstName: 'Кто-то' });
setSmokeRole('driver');
{
  expect('S9 pre: sessionStorage override seeded',
    session.get(SMOKE_ROLE_KEY) === 'driver', String(session.get(SMOKE_ROLE_KEY)));
  resetLocalSession();
  expect('S9: resetLocalSession removed bazardrive.smoke_role.v1',
    !session.has(SMOKE_ROLE_KEY), String(session.get(SMOKE_ROLE_KEY)));
  expect('S9: getSmokeRole() is null after the auth boundary cleared the override',
    getSmokeRole() === null, String(getSmokeRole()));
  expect('S9: user.reset also fired (persisted role gone)',
    persistedRole() === null, String(persistedRole()));
}

// ── Result ───────────────────────────────────────────────────────────────────
if (issues.length) {
  console.error('\nSMOKE FAILED:');
  for (const i of issues) console.error('  - ' + i);
  process.exit(1);
}
console.log('\nAll profile role-isolation smoke checks passed.');
