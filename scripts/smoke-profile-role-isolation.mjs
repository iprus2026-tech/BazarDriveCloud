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

// ── Minimal DOM stub (records each element's innerHTML) ──────────────────────
function makeEl() {
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
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    closest() { return null; },
    contains() { return false; },
    appendChild(x) { return x; }, removeChild() {}, replaceWith() {}, remove() {},
    setAttribute() {}, getAttribute() { return null; },
    scrollIntoView() {}, focus() {}, blur() {},
    click() {},
  };
}

globalThis.window = { location: { hash: '' }, addEventListener() {}, removeEventListener() {} };
globalThis.document = {
  createElement: () => makeEl(),
  addEventListener() {}, removeEventListener() {},
  querySelector() { return makeEl(); },
};

// ── Imports (after stubs are in place) ───────────────────────────────────────
const { user } = await import('../public/src/state.js');
const smokeRoleMod = await import('../public/src/smoke_role.js');
const { getSmokeRole, setSmokeRole, SMOKE_ROLE_KEY } = smokeRoleMod;
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
}

function persistedRole() {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw).role; } catch { return null; }
}

function renderHtml() {
  globalThis.window.location.hash = '#/profile';
  const section = profile();
  return section._html || '';
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

// ── Result ───────────────────────────────────────────────────────────────────
if (issues.length) {
  console.error('\nSMOKE FAILED:');
  for (const i of issues) console.error('  - ' + i);
  process.exit(1);
}
console.log('\nAll profile role-isolation smoke checks passed.');
