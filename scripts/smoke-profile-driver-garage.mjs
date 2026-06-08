// BD-PROFILE-D-05A — Driver Garage smoke.
//
// The Garage section is a driver-only profile surface. It derives a single
// vehicle card from the legacy fields on the user record (vehicleMake /
// vehicleModel / vehicleColor / vehiclePlate; state.js:50-54) without a data
// migration. This smoke pins the surface contract:
//
//   • Driver profile with a vehicle  → garage card renders with the model,
//     colour and plate from the legacy fields.
//   • Driver profile without a vehicle → empty state "Авто не добавлено".
//   • Render-gate preview `?garage=empty` → forces the empty state even
//     when persisted data is present (without wiping it).
//   • Passenger profile → no garage section at all.
//
// Mirrors the DOM-stub strategy used by smoke-profile-pane-alias.mjs and
// smoke-profile-role-isolation.mjs: a permissive stub whose querySelector
// never returns null, so profile() runs to completion and we can inspect
// the resulting section's innerHTML for surface markers.

// ── localStorage stub ────────────────────────────────────────────────────────
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

// ── Minimal DOM stub (records click handlers by selector for BD-PROFILE-D-05B)
// The 05A surface only needed `innerHTML` to be readable. BD-PROFILE-D-05B
// adds a "no-mutation" guarantee on the action handlers, so the stub now
// captures every `addEventListener('click', fn)` keyed by the selector that
// produced the element. The smoke can then look up a handler by id and
// invoke it directly, then assert localStorage / active-ride snapshots are
// byte-equal. Pattern mirrors smoke-profile-role-isolation.mjs.
const clickHandlers = new Map();

function makeEl(selectorHint) {
  return {
    _html: '',
    _selector: selectorHint || null,
    className: '', textContent: '', value: '', checked: false,
    hidden: false, disabled: false,
    dataset: {},
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    style: {},
    set innerHTML(v) { this._html = String(v); },
    get innerHTML() { return this._html; },
    get firstElementChild() { return makeEl(); },
    addEventListener(type, fn) {
      if (type === 'click' && this._selector && typeof fn === 'function') {
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

let currentHash = '';
const locationStub = {};
Object.defineProperty(locationStub, 'hash', {
  configurable: true,
  get: () => currentHash,
  set: (v) => {
    currentHash = typeof v === 'string' && v.startsWith('#') ? v : '#' + String(v);
  },
});
globalThis.window   = { location: locationStub, addEventListener() {}, removeEventListener() {} };
globalThis.location = locationStub;
globalThis.document = {
  createElement: () => makeEl(),
  addEventListener() {}, removeEventListener() {},
  querySelector: () => makeEl(),
};

// ── Imports (after stubs) ────────────────────────────────────────────────────
const { user } = await import('../public/src/state.js');
const profile  = (await import('../public/src/screens/profile.js')).default;

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
  currentHash = '';
}

// Serialize the localStorage Map's contents into a deterministic string so
// "did anything change after a click?" becomes a byte-equality check. Keys
// are sorted alphabetically so write order does not perturb the snapshot.
function snapshotLocalStorage() {
  const entries = [];
  for (const [k, v] of local.entries()) entries.push([k, String(v)]);
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify(entries);
}

function renderProfile(hash) {
  currentHash = hash || '#/profile';
  const section = profile();
  return section._html || '';
}

// Extract just the `<section ... pf2-garage ...>…</section>` slice so card
// assertions can't false-positive on, say, the driver hero, which also
// renders the persisted "Hyundai Solaris · А 482 МР 77" line for the same
// user. Returns '' when the garage isn't in the markup (passenger view).
function garageSlice(html) {
  const m = html.match(/<section\b[^>]*\bpf2-garage\b[\s\S]*?<\/section>/);
  return m ? m[0] : '';
}

const GARAGE_ID_MARKER       = 'id="pf2-garage"';
const GARAGE_EMPTY_MARKER    = 'pf2-garage--empty';
const EMPTY_STATE_TEXT       = 'Авто не добавлено';
const ADD_BUTTON_ID          = 'id="pf2-garage-add"';
const EDIT_ACTION_DATA       = 'data-garage-action="edit"';
const ARCHIVE_ACTION_DATA    = 'data-garage-action="archive"';
const ACTIVE_BADGE_TEXT      = 'Активное';

// ── Scenario 1 — Driver profile WITH a vehicle → populated garage card ──────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const html = renderProfile('#/profile');
  const slice = garageSlice(html);
  expect('S1: driver profile renders the garage section',
    slice.length > 0);
  expect('S1: garage shows "Hyundai Solaris" derived from legacy fields',
    slice.includes('Hyundai Solaris'));
  expect('S1: garage shows vehicle color from profile',
    slice.includes('белый'));
  expect('S1: garage shows the plate from profile',
    slice.includes('А 482 МР 77'));
  expect('S1: garage shows the active badge',
    slice.includes(ACTIVE_BADGE_TEXT));
  expect('S1: garage is NOT in the empty state',
    !slice.includes(GARAGE_EMPTY_MARKER));
  expect('S1: garage does NOT show the empty placeholder text',
    !slice.includes(EMPTY_STATE_TEXT));
  expect('S1: garage exposes inline mock actions (edit / archive)',
    slice.includes(EDIT_ACTION_DATA) && slice.includes(ARCHIVE_ACTION_DATA));
  // Belt-and-braces: the "+ Добавить" header CTA is always present so the
  // driver can add another vehicle from the populated state.
  expect('S1: garage exposes the "+ Добавить" header CTA',
    slice.includes(ADD_BUTTON_ID));
}

// ── Scenario 2 — Driver profile WITHOUT a vehicle → empty-state card ───────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  // intentionally no vehicleMake / vehicleModel / vehicleColor / vehiclePlate
});
{
  const html = renderProfile('#/profile');
  expect('S2: driver profile with no vehicle still renders the garage section',
    html.includes(GARAGE_ID_MARKER));
  expect('S2: garage falls back to the empty-state modifier class',
    html.includes(GARAGE_EMPTY_MARKER));
  expect('S2: garage shows the "Авто не добавлено" placeholder',
    html.includes(EMPTY_STATE_TEXT));
  expect('S2: empty garage exposes the "Добавить авто" CTA',
    html.includes(ADD_BUTTON_ID) && html.includes('Добавить авто'));
  // Negative: no demo car name leaks into the empty card.
  expect('S2: empty garage does NOT show any car make / model literal',
    !html.includes('Hyundai') && !html.includes('Solaris'));
}

// ── Scenario 3 — Render-gate preview `?garage=empty` forces the empty state
// even when the profile has a real vehicle (so designers can preview the
// empty card without wiping their persisted data). ──────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const html = renderProfile('#/profile?role=driver&garage=empty');
  const slice = garageSlice(html);
  expect('S3: garage slice still rendered under ?garage=empty preview',
    slice.length > 0);
  expect('S3: ?garage=empty forces the empty-state class on the card',
    slice.includes(GARAGE_EMPTY_MARKER));
  expect('S3: ?garage=empty shows the "Авто не добавлено" placeholder',
    slice.includes(EMPTY_STATE_TEXT));
  // Scope the negative check to the garage slice: other surfaces in the
  // driver profile (driver hero, readiness checklist) legitimately echo
  // the persisted vehicle line and must NOT trigger a false positive.
  expect('S3: ?garage=empty does NOT render the populated car model in the slice',
    !slice.includes('Hyundai Solaris'));
  expect('S3: ?garage=empty does NOT render the persisted plate in the slice',
    !slice.includes('А 482 МР 77'));
  // The persisted vehicle MUST still be intact — preview never wipes data.
  expect('S3: ?garage=empty did NOT mutate persisted vehicleMake',
    user.get().vehicleMake === 'Hyundai', String(user.get().vehicleMake));
  expect('S3: ?garage=empty did NOT mutate persisted vehiclePlate',
    user.get().vehiclePlate === 'А 482 МР 77', String(user.get().vehiclePlate));
}

// ── Scenario 4 — Passenger profile does NOT render the garage ──────────────
reset();
user.set({
  onboarded: true, role: 'passenger',
  firstName: 'Алия', lastName: 'К.', displayName: 'Алия К.',
  phone: '9007654321', phoneVerified: true,
});
{
  const html = renderProfile('#/profile');
  expect('S4: passenger profile does NOT include the garage section',
    !html.includes(GARAGE_ID_MARKER));
  expect('S4: passenger profile does NOT show the "Авто не добавлено" placeholder',
    !html.includes(EMPTY_STATE_TEXT));
  expect('S4: passenger profile does NOT expose the garage add button',
    !html.includes(ADD_BUTTON_ID));
}

// ── Scenario 5 — Render-gate ?role=passenger on a persisted driver hides
// the garage too (the view, not just the persisted role, decides). ──────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const html = renderProfile('#/profile?role=passenger');
  expect('S5: ?role=passenger preview hides the garage even on a driver record',
    !html.includes(GARAGE_ID_MARKER));
}

// ── Scenario 6 — Render-gate ?role=driver on a persisted passenger shows
// the garage (preview overrides view, persisted role unchanged). ────────────
reset();
user.set({
  onboarded: true, role: 'passenger',
  firstName: 'Алия', lastName: 'К.', displayName: 'Алия К.',
  phone: '9007654321', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
});
{
  const html = renderProfile('#/profile?role=driver');
  expect('S6: ?role=driver preview shows the garage on a persisted passenger',
    html.includes(GARAGE_ID_MARKER));
  expect('S6: ?role=driver preview surfaces the persisted Hyundai Solaris',
    html.includes('Hyundai Solaris'));
}

// ── Scenario 7 — Plate-only profile falls back to empty state (Codex P2) ────
// Onboarding records `vehiclePlate` on its own step, so a partially-filled
// profile can carry a plate (or color) before any make/model is entered.
// The active garage card requires a usable model line — plate-only and
// color-only profiles must slip to the empty state so the "Добавить авто"
// CTA prompts the driver to finish data entry instead of showing a
// stranded "Активное" badge on an empty model line.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  // intentionally only plate — no make, no model, no color
  vehiclePlate: 'А 482 МР 77',
});
{
  const html = renderProfile('#/profile');
  const slice = garageSlice(html);
  expect('S7: plate-only profile still renders the garage section',
    slice.length > 0);
  expect('S7: plate-only garage falls back to the empty-state class',
    slice.includes(GARAGE_EMPTY_MARKER));
  expect('S7: plate-only garage shows the "Авто не добавлено" placeholder',
    slice.includes(EMPTY_STATE_TEXT));
  expect('S7: plate-only garage does NOT show the "Активное" badge',
    !slice.includes(ACTIVE_BADGE_TEXT));
  expect('S7: plate-only garage does NOT render the populated `pf2-garage__car` article',
    !slice.includes('pf2-garage__car'));
  expect('S7: plate-only garage does NOT echo the stranded plate inside the empty card',
    !slice.includes('А 482 МР 77'));
  expect('S7: persisted vehiclePlate is preserved (preview never wipes data)',
    user.get().vehiclePlate === 'А 482 МР 77', String(user.get().vehiclePlate));
}

// ── Scenario 8 — Color-only profile also falls back to empty state ──────────
// Same contract — any single non-model field is not enough to justify
// rendering the populated card.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  // intentionally only color
  vehicleColor: 'белый',
});
{
  const html = renderProfile('#/profile');
  const slice = garageSlice(html);
  expect('S8: color-only profile falls back to the empty-state class',
    slice.includes(GARAGE_EMPTY_MARKER));
  expect('S8: color-only garage does NOT show the "Активное" badge',
    !slice.includes(ACTIVE_BADGE_TEXT));
  expect('S8: color-only garage does NOT render the populated `pf2-garage__car` article',
    !slice.includes('pf2-garage__car'));
}

// ── Scenario 9 — Make-only OR model-only profile renders the active card ────
// A single half of the model line is still informative ("Hyundai" or
// "Solaris" alone) so we keep the populated state. This guards against
// the fix over-tightening into "needs BOTH make and model".
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai',
});
{
  const html = renderProfile('#/profile');
  const slice = garageSlice(html);
  expect('S9: make-only profile renders the populated garage card',
    !slice.includes(GARAGE_EMPTY_MARKER));
  expect('S9: make-only garage shows "Hyundai" as the model line',
    slice.includes('Hyundai'));
  expect('S9: make-only garage shows the "Активное" badge',
    slice.includes(ACTIVE_BADGE_TEXT));
}
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleModel: 'Solaris',
});
{
  const html = renderProfile('#/profile');
  const slice = garageSlice(html);
  expect('S9: model-only profile renders the populated garage card',
    !slice.includes(GARAGE_EMPTY_MARKER));
  expect('S9: model-only garage shows "Solaris" as the model line',
    slice.includes('Solaris'));
}

// ── Scenario 10 — BD-PROFILE-D-05B action contract hooks present ─────────────
// Each action carries a stable (action, state) pair so future CRUD slices
// and the smoke can grow without renaming selectors.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const slice = garageSlice(renderProfile('#/profile'));
  // The four action-state pairs from the BD-PROFILE-D-05B contract:
  const STATES = [
    { action: 'add',     state: 'add-ready' },
    { action: 'edit',    state: 'edit-ready' },
    { action: 'active',  state: 'active-current' },
    { action: 'archive', state: 'archive-confirm-local' },
  ];
  for (const { action, state } of STATES) {
    expect(`S10: garage exposes data-garage-action="${action}"`,
      slice.includes(`data-garage-action="${action}"`));
    expect(`S10: garage exposes data-garage-state="${state}"`,
      slice.includes(`data-garage-state="${state}"`));
  }
}

// ── Scenario 11 — BD-PROFILE-D-05B stable user-facing labels ────────────────
{
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S11: "Добавить авто" label present (add-ready)',
    slice.includes('Добавить авто'));
  expect('S11: "Редактировать" label present (edit-ready)',
    slice.includes('Редактировать'));
  expect('S11: "Активна сейчас" label present (active-current)',
    slice.includes('Активна сейчас'));
  expect('S11: "Архивировать" label present (archive-confirm-local)',
    slice.includes('Архивировать'));
  // The contract retired the throwaway "Скоро здесь" / "Уже активное"
  // labels from 05A — they would surface stale copy on real renders.
  expect('S11: stale "Скоро здесь" label is gone from the markup',
    !slice.includes('Скоро здесь'));
  expect('S11: stale "Уже активное" label is gone from the markup',
    !slice.includes('Уже активное'));
  expect('S11: stale "Сделать активным" button label is gone (now status pill)',
    !slice.includes('Сделать активным'));
}

// ── Scenario 12 — "active-current" is a non-button status pill ──────────────
// 05B turned the activate control from a button into a disabled status
// pill. The smoke pins this: the markup uses an <span> (not <button>) with
// aria-disabled="true", and no click handler is captured for the active
// element id.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const slice = garageSlice(renderProfile('#/profile'));
  // The active control is a <span>, not a <button>, so it has no
  // click semantics by default.
  expect('S12: active-current is rendered as a <span>, not a <button>',
    /<span\b[^>]*data-garage-action="active"/.test(slice));
  expect('S12: active-current carries aria-disabled="true"',
    /data-garage-action="active"[^>]*aria-disabled="true"|aria-disabled="true"[^>]*data-garage-action="active"/.test(slice));
  // wireGarageActions deliberately does NOT attach a click handler to
  // #pf2-garage-active — capture confirms that.
  expect('S12: no click handler captured for #pf2-garage-active',
    !clickHandlers.has('#pf2-garage-active'));
}

// ── Scenario 13 — Archive confirm row is rendered hidden, with stable hooks ─
{
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S13: confirm row #pf2-garage-confirm rendered in markup',
    slice.includes('id="pf2-garage-confirm"'));
  expect('S13: confirm row carries data-garage-confirm="archive"',
    slice.includes('data-garage-confirm="archive"'));
  expect('S13: confirm row starts in data-garage-confirm-state="idle"',
    slice.includes('data-garage-confirm-state="idle"'));
  expect('S13: confirm row is hidden by default (no flash of confirm UI)',
    /id="pf2-garage-confirm"[^>]*\bhidden\b/.test(slice));
  expect('S13: confirm row exposes "Подтвердить архивирование?" prompt',
    slice.includes('Подтвердить архивирование?'));
  expect('S13: confirm row has cancel button id #pf2-garage-archive-cancel',
    slice.includes('id="pf2-garage-archive-cancel"'));
  expect('S13: confirm row has final button id #pf2-garage-archive-confirm',
    slice.includes('id="pf2-garage-archive-confirm"'));
  expect('S13: cancel button labelled "Отмена"',
    slice.includes('>Отмена<'));
  expect('S13: final confirm button labelled "Подтвердить"',
    slice.includes('>Подтвердить<'));
}

// ── Scenario 14 — Invoking every action handler does NOT mutate storage ────
// This is the load-bearing guarantee: 05B is the contract slice, not the
// CRUD slice. We snapshot localStorage immediately after render, run every
// click handler that wireGarageActions captures, then re-snapshot. Equal
// strings == zero writes.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  renderProfile('#/profile');
  const before = snapshotLocalStorage();
  const triggers = [
    '#pf2-garage-add',
    '#pf2-garage-edit',
    '#pf2-garage-archive',
    '#pf2-garage-archive-cancel',
    '#pf2-garage-archive-confirm',
  ];
  for (const sel of triggers) {
    const fn = clickHandlers.get(sel);
    expect(`S14 pre: captured click handler for ${sel}`,
      typeof fn === 'function');
    try { fn(); } catch (e) {
      expect(`S14: handler for ${sel} did not throw`, false, e.message || String(e));
    }
    const after = snapshotLocalStorage();
    expect(`S14: localStorage snapshot byte-equal after invoking ${sel}`,
      before === after, `before=${before.length}b after=${after.length}b`);
  }
  // Also drop a parallel guard on the active-ride key specifically: a
  // future regression that wrote into bazardrive.active_ride.v1 would
  // be caught even if other unrelated keys happened to drift.
  expect('S14: bazardrive.active_ride.v1 was never written',
    !local.has('bazardrive.active_ride.v1'),
    String(local.get('bazardrive.active_ride.v1')));
  expect('S14: bazardrive.user.v1.vehicleMake preserved byte-for-byte',
    user.get().vehicleMake === 'Hyundai', String(user.get().vehicleMake));
  expect('S14: bazardrive.user.v1.vehiclePlate preserved byte-for-byte',
    user.get().vehiclePlate === 'А 482 МР 77', String(user.get().vehiclePlate));
}

// ── Scenario 15 — Empty-state add button is captured AND inert too ─────────
// The same no-mutation guarantee must hold on the empty-state CTA — that's
// where the future onboarding-add flow will hook in, but until it does the
// handler stays DOM-only.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  // intentionally no vehicle — empty-state path
});
{
  renderProfile('#/profile');
  const beforeEmpty = snapshotLocalStorage();
  const addHandler = clickHandlers.get('#pf2-garage-add');
  expect('S15: empty-state add button has a captured handler',
    typeof addHandler === 'function');
  try { addHandler && addHandler(); } catch (e) {
    expect('S15: empty add handler did not throw', false, e.message || String(e));
  }
  const afterEmpty = snapshotLocalStorage();
  expect('S15: localStorage byte-equal after empty-state add click',
    beforeEmpty === afterEmpty);
}

// ── Scenario 16 — Static source guard on wireGarageActions ──────────────────
// Belt-and-braces against a future refactor that introduces a real CRUD
// write inside wireGarageActions without updating the contract / docs.
// The function body must not contain any of the storage-mutation calls.
{
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const profileSrc  = readFileSync(join(projectRoot, 'public/src/screens/profile.js'), 'utf8');
  const wireStart   = profileSrc.indexOf('function wireGarageActions(');
  const wireEnd     = profileSrc.indexOf('function renderDriver(', wireStart);
  const wireBody    = (wireStart >= 0 && wireEnd > wireStart)
    ? profileSrc.slice(wireStart, wireEnd) : '';
  expect('S16: wireGarageActions function body extracted',
    wireBody.length > 0, String(wireBody.length));
  const FORBIDDEN = [
    { name: 'user.set', regex: /\buser\.set\s*\(/ },
    { name: 'user.reset', regex: /\buser\.reset\s*\(/ },
    { name: 'localStorage.setItem', regex: /\blocalStorage\.setItem\s*\(/ },
    { name: 'sessionStorage.setItem', regex: /\bsessionStorage\.setItem\s*\(/ },
    { name: 'saveActiveRide', regex: /\bsaveActiveRide\s*\(/ },
    { name: 'updateActiveRideStatus', regex: /\bupdateActiveRideStatus\s*\(/ },
    { name: 'updateTripStatus', regex: /\bupdateTripStatus\s*\(/ },
    { name: 'saveRideHistoryEntry', regex: /\bsaveRideHistoryEntry\s*\(/ },
    { name: 'createRideOrder', regex: /\bcreateRideOrder\s*\(/ },
    { name: 'acceptCanonicalRideOrder', regex: /\bacceptCanonicalRideOrder\s*\(/ },
    { name: 'go(', regex: /\bgo\s*\(/ },  // router navigation is also out of scope for 05B
  ];
  for (const { name, regex } of FORBIDDEN) {
    expect(`S16: wireGarageActions does NOT call ${name}`,
      !regex.test(wireBody));
  }
  // Positive contract: 05B confirm flow toggles the row's
  // data-garage-confirm-state attribute as its single state surface, so
  // it must appear in the function body.
  expect('S16: wireGarageActions toggles data-garage-confirm-state (DOM-only)',
    /garageConfirmState/.test(wireBody));
}

// ── Result ───────────────────────────────────────────────────────────────────
if (issues.length) {
  console.error('\nSMOKE FAILED:');
  for (const i of issues) console.error('  - ' + i);
  process.exit(1);
}
console.log('\nAll profile driver-garage smoke checks passed.');
