// BD-PROFILE-D-05A/B/C/D — Driver Garage smoke.
//
// The Garage section is a driver-only profile surface. It derives its
// view from the legacy fields on the user record (vehicleMake /
// vehicleModel / vehicleColor / vehiclePlate; state.js:50-54) without
// a data migration. This smoke pins the surface contract across four
// slices:
//
//   05A — Render: driver profile with/without a vehicle, render-gate
//         preview (`?garage=empty`), passenger profile hides the section.
//   05B — Action contract: stable `data-garage-action` /
//         `data-garage-state` hooks, archive 2-step confirm, and the
//         load-bearing "no mutation on click" guarantee across every
//         action handler (localStorage snapshot byte-equality).
//   05C — Collection: `buildGarageVehicles(u, options)` returns
//         `[{ id, model, color, plate, status, source }]`; per-vehicle
//         DOM ids (`*-${vehicle.id}`); `?garage=multi` adds a single
//         demo vehicle for preview without touching storage; multi-state
//         no-mutation guarantee across every NON-make-active handler.
//   05D — Active vehicle selection persistence: the "Сделать активной"
//         button now writes `profile.driverGarage.activeVehicleId` via
//         user.set (single allowed writer in wireGarageActions);
//         resolver `resolveActiveGarageVehicleId` falls back to the
//         legacy/first vehicle when the persisted id is missing or
//         stale; click → persist → re-render swaps the active badge;
//         make-active touches ONLY `bazardrive.user.v1` (no responses,
//         active_ride, ride_history, driver_receipts, respond key drift).
//
// Mirrors the DOM-stub strategy used by smoke-profile-pane-alias.mjs and
// smoke-profile-role-isolation.mjs: a permissive stub whose querySelector
// never returns null, so profile() runs to completion and we can inspect
// the resulting section's innerHTML for surface markers. `wireGarageActions`
// iterates the vehicles list (not the DOM) so the stub captures every
// per-vehicle handler deterministically.

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
  // #pf2-garage-active-${id} — capture confirms that. 05C suffixes the
  // id with the vehicle's id (`legacy-1` for the derived legacy vehicle).
  expect('S12: no click handler captured for #pf2-garage-active-legacy-1',
    !clickHandlers.has('#pf2-garage-active-legacy-1'));
}

// ── Scenario 13 — Archive confirm row is rendered hidden, with stable hooks ─
// 05C suffixes per-vehicle confirm-row ids with the vehicle's id; for the
// single derived legacy vehicle that's `legacy-1`.
{
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S13: confirm row #pf2-garage-confirm-legacy-1 rendered in markup',
    slice.includes('id="pf2-garage-confirm-legacy-1"'));
  expect('S13: confirm row carries data-garage-confirm="archive"',
    slice.includes('data-garage-confirm="archive"'));
  expect('S13: confirm row starts in data-garage-confirm-state="idle"',
    slice.includes('data-garage-confirm-state="idle"'));
  expect('S13: confirm row is hidden by default (no flash of confirm UI)',
    /id="pf2-garage-confirm-legacy-1"[^>]*\bhidden\b/.test(slice));
  expect('S13: confirm row exposes "Подтвердить архивирование?" prompt',
    slice.includes('Подтвердить архивирование?'));
  expect('S13: confirm row has cancel button id #pf2-garage-archive-cancel-legacy-1',
    slice.includes('id="pf2-garage-archive-cancel-legacy-1"'));
  expect('S13: confirm row has final button id #pf2-garage-archive-confirm-legacy-1',
    slice.includes('id="pf2-garage-archive-confirm-legacy-1"'));
  expect('S13: cancel button labelled "Отмена"',
    slice.includes('>Отмена<'));
  expect('S13: final confirm button labelled "Подтвердить"',
    slice.includes('>Подтвердить<'));
}

// ── Scenario 14 — Invoking every action handler does NOT mutate storage ────
// This is the load-bearing guarantee: 05C is still the contract+collection
// slice, not the CRUD slice. We snapshot localStorage immediately after
// render, run every click handler that wireGarageActions captures, then
// re-snapshot. Equal strings == zero writes.
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
    '#pf2-garage-edit-legacy-1',
    '#pf2-garage-archive-legacy-1',
    '#pf2-garage-archive-cancel-legacy-1',
    '#pf2-garage-archive-confirm-legacy-1',
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

// ── Scenario 16 — Static source guards on garage helpers ────────────────────
// Belt-and-braces against future refactors that introduce CRUD or
// cross-surface writes inside the garage helpers without updating the
// contract / docs.
//
// 05D split: `wireGarageActions` is allowed to call `user.set` and
// reference `activeVehicleId` — but ONLY to patch the `driverGarage`
// namespace. The derive helpers (resolver / builder / card / section)
// must stay pure. None of them — wire or derive — may touch
// responses / active-ride / ride-history / receipts / respond stores.
{
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const profileSrc  = readFileSync(join(projectRoot, 'public/src/screens/profile.js'), 'utf8');
  // 05E — resolver + builder live in public/src/garage.js so respond.js
  // and ride_actions.js can share them without depending on a UI module.
  const garageSrc   = readFileSync(join(projectRoot, 'public/src/garage.js'), 'utf8');

  // Precise function-body extraction: from `marker` (the declaration
  // line) through the function's OWN closing brace (a bare `\n}\n`).
  // This avoids sweeping the next function's header comment into the
  // body, which would leak forbidden tokens that legitimately live in
  // the *next* function's doc block.
  const sliceFn = (src, marker) => {
    const start = src.indexOf(marker);
    if (start < 0) return '';
    const closeIdx = src.indexOf('\n}\n', start);
    if (closeIdx < 0) return '';
    return src.slice(start, closeIdx + 3);
  };

  const resolveBody = sliceFn(garageSrc, 'export function resolveActiveGarageVehicleId(');
  expect('S16: resolveActiveGarageVehicleId function body extracted (from garage.js)',
    resolveBody.length > 0, String(resolveBody.length));

  const buildBody = sliceFn(garageSrc, 'export function buildGarageVehicles(');
  expect('S16: buildGarageVehicles function body extracted (from garage.js)',
    buildBody.length > 0, String(buildBody.length));

  const convBody = sliceFn(garageSrc, 'export function resolveActiveGarageVehicle(');
  expect('S16: resolveActiveGarageVehicle function body extracted (from garage.js)',
    convBody.length > 0, String(convBody.length));

  const wireBody = sliceFn(profileSrc, 'function wireGarageActions(');
  expect('S16: wireGarageActions function body extracted (from profile.js)',
    wireBody.length > 0, String(wireBody.length));

  const refreshBody = sliceFn(profileSrc, 'function refreshGarageSection(');
  expect('S16: refreshGarageSection function body extracted (from profile.js)',
    refreshBody.length > 0, String(refreshBody.length));

  // Universally forbidden cross-surface writes (every garage helper,
  // including wireGarageActions, must avoid these).
  const FORBIDDEN_ALL = [
    { name: 'user.reset', regex: /\buser\.reset\s*\(/ },
    { name: 'localStorage.setItem', regex: /\blocalStorage\.setItem\s*\(/ },
    { name: 'sessionStorage.setItem', regex: /\bsessionStorage\.setItem\s*\(/ },
    { name: 'saveActiveRide', regex: /\bsaveActiveRide\s*\(/ },
    { name: 'updateActiveRideStatus', regex: /\bupdateActiveRideStatus\s*\(/ },
    { name: 'updateTripStatus', regex: /\bupdateTripStatus\s*\(/ },
    { name: 'saveRideHistoryEntry', regex: /\bsaveRideHistoryEntry\s*\(/ },
    { name: 'createRideOrder', regex: /\bcreateRideOrder\s*\(/ },
    { name: 'acceptCanonicalRideOrder', regex: /\bacceptCanonicalRideOrder\s*\(/ },
    { name: 'saveActiveVehicle', regex: /\bsaveActiveVehicle\s*\(/ },
    { name: 'selectedVehicleId', regex: /\bselectedVehicleId\b/ },
    { name: 'go(', regex: /\bgo\s*\(/ },  // no router navigation from garage helpers
    // Cross-surface storage keys — must never appear as string literals
    // anywhere in the garage helpers.
    { name: '"bazardrive.responses.v1"', regex: /bazardrive\.responses\.v1/ },
    { name: '"bazardrive.active_ride.v1"', regex: /bazardrive\.active_ride\.v1/ },
    { name: '"bazardrive.ride_history.v1"', regex: /bazardrive\.ride_history\.v1/ },
    { name: '"bazardrive.driver_receipts.v1"', regex: /bazardrive\.driver_receipts\.v1/ },
    { name: '"bazardrive.respond.v1"', regex: /bazardrive\.respond\.v1/ },
  ];

  // Forbidden in derive helpers (resolver + builder) and refreshGarageSection
  // — these must not call user.set or reference activeVehicleId as a
  // mutation target. The resolver READS profile.driverGarage.activeVehicleId
  // (legitimate), so it is exempt from the activeVehicleId guard.
  const FORBIDDEN_DERIVE_ONLY = [
    { name: 'user.set', regex: /\buser\.set\s*\(/ },
  ];

  const checkBody = (label, body, extra = []) => {
    for (const { name, regex } of FORBIDDEN_ALL) {
      expect(`S16: ${label} does NOT call/reference ${name}`,
        !regex.test(body));
    }
    for (const { name, regex } of extra) {
      expect(`S16: ${label} does NOT call/reference ${name}`,
        !regex.test(body));
    }
  };

  checkBody('resolveActiveGarageVehicleId', resolveBody, FORBIDDEN_DERIVE_ONLY);
  // Resolver is allowed to reference activeVehicleId (it reads it).
  // Builder must NOT use the literal token (it only consumes the resolver
  // result via the `activeId` local).
  checkBody('buildGarageVehicles', buildBody, [
    ...FORBIDDEN_DERIVE_ONLY,
    { name: 'activeVehicleId', regex: /\bactiveVehicleId\b/ },
  ]);
  // 05E — resolveActiveGarageVehicle is the convenience consumed by
  // respond.js and ride_actions.js. Strictly read-only; no writes, no
  // activeVehicleId mutation (it only forwards what the resolver returns).
  checkBody('resolveActiveGarageVehicle', convBody, [
    ...FORBIDDEN_DERIVE_ONLY,
    { name: 'activeVehicleId', regex: /\bactiveVehicleId\b/ },
  ]);
  // wireGarageActions is the single allowed writer — user.set + activeVehicleId
  // are intentionally NOT in its forbidden list.
  checkBody('wireGarageActions', wireBody);
  // refreshGarageSection is a render/re-wire helper — no user.set, no
  // activeVehicleId mutation, no cross-surface writes.
  checkBody('refreshGarageSection', refreshBody, [
    ...FORBIDDEN_DERIVE_ONLY,
    { name: 'activeVehicleId', regex: /\bactiveVehicleId\b/ },
  ]);

  // Positive contracts.
  expect('S16: wireGarageActions toggles data-garage-confirm-state (DOM-only archive)',
    /garageConfirmState/.test(wireBody));
  expect('S16: wireGarageActions patches the driverGarage namespace (single allowed writer)',
    /\bdriverGarage\b/.test(wireBody) && /user\.set\s*\(/.test(wireBody));
  expect('S16: resolveActiveGarageVehicleId reads profile.driverGarage.activeVehicleId',
    /\bdriverGarage\b/.test(resolveBody) && /\bactiveVehicleId\b/.test(resolveBody));
  expect('S16: buildGarageVehicles still reads u.vehicleMake (legacy bridge intact)',
    /\bu\.vehicleMake\b/.test(buildBody));
  expect('S16: buildGarageVehicles still reads u.vehicleModel (legacy bridge intact)',
    /\bu\.vehicleModel\b/.test(buildBody));
}

// ── Scenario 17 — Single-vehicle (default) collection shape via DOM hooks ──
// 05C exposes `data-garage-collection-size` on the section root so the
// smoke can pin the rendered size without crossing the module boundary
// into `buildGarageVehicles`. Default legacy profile == size 1.
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
  expect('S17: section advertises data-garage-collection-size="1" for the default legacy profile',
    slice.includes('data-garage-collection-size="1"'));
  // Each card carries a data-vehicle id; the derived legacy vehicle is
  // pinned to `legacy-1` so per-vehicle handlers stay deterministic.
  expect('S17: legacy vehicle card carries data-vehicle="legacy-1"',
    slice.includes('data-vehicle="legacy-1"'));
  expect('S17: legacy vehicle card carries data-vehicle-status="active"',
    slice.includes('data-vehicle-status="active"'));
  expect('S17: legacy vehicle card carries data-vehicle-source="legacy"',
    slice.includes('data-vehicle-source="legacy"'));
  // Exactly one card means no multi-card modifier.
  expect('S17: single-card render does NOT set pf2-garage--multi',
    !/pf2-garage--multi\b/.test(slice));
  // No demo data leaks into a default render.
  expect('S17: default render does NOT include the demo "Kia Rio"',
    !slice.includes('Kia Rio'));
}

// ── Scenario 18 — Empty render advertises size 0 ────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
});
{
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S18: empty section advertises data-garage-collection-size="0"',
    slice.includes('data-garage-collection-size="0"'));
  expect('S18: empty section carries the empty modifier',
    slice.includes('pf2-garage--empty'));
}

// ── Scenario 19 — `?garage=multi` adds the preview demo vehicle ─────────────
// The render-gate appends ONE demo vehicle (Kia Rio) with status
// 'available' and source 'mock'. The legacy vehicle stays active by
// construction — the multi card never overrides the derived active flag.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const slice = garageSlice(renderProfile('#/profile?role=driver&garage=multi'));
  expect('S19: multi preview advertises data-garage-collection-size="2"',
    slice.includes('data-garage-collection-size="2"'));
  expect('S19: multi preview sets the pf2-garage--multi modifier',
    /pf2-garage--multi\b/.test(slice));
  expect('S19: legacy card present with data-vehicle="legacy-1"',
    slice.includes('data-vehicle="legacy-1"'));
  expect('S19: demo card present with data-vehicle="demo-2"',
    slice.includes('data-vehicle="demo-2"'));
  expect('S19: demo card carries data-vehicle-status="available"',
    /data-vehicle="demo-2"[^>]*data-vehicle-status="available"|data-vehicle-status="available"[^>]*data-vehicle="demo-2"/.test(slice) ||
    slice.includes('data-vehicle-status="available"'));
  expect('S19: demo card carries data-vehicle-source="mock" (preview, not persisted)',
    slice.includes('data-vehicle-source="mock"'));
  // Active card vs. non-active card variants.
  expect('S19: legacy card retains "Активное" badge',
    slice.includes('Активное'));
  expect('S19: demo card shows the "Доступно" badge',
    slice.includes('Доступно'));
  // make-active-local is a per-vehicle control on non-active cards only.
  expect('S19: non-active card exposes data-garage-state="make-active-local"',
    slice.includes('data-garage-state="make-active-local"'));
  expect('S19: non-active card shows "Сделать активной" label',
    slice.includes('Сделать активной'));
  // Demo vehicle properties are rendered.
  expect('S19: demo card shows "Kia Rio" model',
    slice.includes('Kia Rio'));
  // Per-vehicle archive confirm rows are independent (one per card).
  expect('S19: legacy card has its own confirm row #pf2-garage-confirm-legacy-1',
    slice.includes('id="pf2-garage-confirm-legacy-1"'));
  expect('S19: demo card has its own confirm row #pf2-garage-confirm-demo-2',
    slice.includes('id="pf2-garage-confirm-demo-2"'));
  // Multi-render must not bleed into persisted state. 05D introduced a
  // `driverGarage.activeVehicleId` field that defaults to null on every
  // user record, so the right invariant is: the multi PREVIEW does not
  // persist a selection — the resolved id stays the default null.
  expect('S19: ?garage=multi did NOT persist an active vehicle selection',
    user.get().driverGarage?.activeVehicleId === null,
    String(user.get().driverGarage?.activeVehicleId));
}

// ── Scenario 20 — Active card has no make-active button; non-active has no
// active-current span (mirror invariants). ──────────────────────────────────
{
  const slice = garageSlice(renderProfile('#/profile?role=driver&garage=multi'));
  // The active vehicle (legacy-1) renders the status pill, NOT a
  // make-active button — confirm via id presence/absence.
  expect('S20: active card (legacy-1) renders #pf2-garage-active-legacy-1',
    slice.includes('id="pf2-garage-active-legacy-1"'));
  expect('S20: active card (legacy-1) does NOT render a make-active button',
    !slice.includes('id="pf2-garage-make-active-legacy-1"'));
  // The non-active vehicle (demo-2) renders the make-active button, NOT
  // a status pill.
  expect('S20: non-active card (demo-2) renders #pf2-garage-make-active-demo-2',
    slice.includes('id="pf2-garage-make-active-demo-2"'));
  expect('S20: non-active card (demo-2) does NOT render an active-current span',
    !slice.includes('id="pf2-garage-active-demo-2"'));
}

// ── Scenario 21 — Multi-state no-mutation guarantee on NON-make-active
// handlers. Trigger every non-make-active per-vehicle handler across both
// cards and assert localStorage stays byte-equal. (make-active gets its own
// dedicated scenario S22 because it IS the single allowed writer in 05D.) ─
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  renderProfile('#/profile?role=driver&garage=multi');
  const before = snapshotLocalStorage();
  const triggers = [
    '#pf2-garage-add',
    // Legacy (active) card — no make-active button on the active card.
    '#pf2-garage-edit-legacy-1',
    '#pf2-garage-archive-legacy-1',
    '#pf2-garage-archive-cancel-legacy-1',
    '#pf2-garage-archive-confirm-legacy-1',
    // Demo (non-active) card — every handler EXCEPT make-active.
    '#pf2-garage-edit-demo-2',
    '#pf2-garage-archive-demo-2',
    '#pf2-garage-archive-cancel-demo-2',
    '#pf2-garage-archive-confirm-demo-2',
  ];
  for (const sel of triggers) {
    const fn = clickHandlers.get(sel);
    expect(`S21 pre: captured click handler for ${sel}`,
      typeof fn === 'function');
    try { fn && fn(); } catch (e) {
      expect(`S21: handler for ${sel} did not throw`, false, e.message || String(e));
    }
    const after = snapshotLocalStorage();
    expect(`S21: localStorage byte-equal after invoking ${sel}`,
      before === after, `before=${before.length}b after=${after.length}b`);
  }
  // Active card never wires a make-active handler.
  expect('S21: active card does NOT capture a make-active handler',
    !clickHandlers.has('#pf2-garage-make-active-legacy-1'));
  // Active vehicle id stays a span, not a click target.
  expect('S21: active card does NOT capture an active-current click handler',
    !clickHandlers.has('#pf2-garage-active-legacy-1'));
  // Persisted vehicle fields untouched.
  expect('S21: persisted vehicleMake preserved across non-make-active multi-card clicks',
    user.get().vehicleMake === 'Hyundai', String(user.get().vehicleMake));
  // 05D: the namespace defaults to { activeVehicleId: null } — the
  // non-make-active handlers never patch it, so it must still be null
  // (NOT the freshly-clicked demo-2 id).
  expect('S21: driverGarage.activeVehicleId stays null after non-make-active clicks',
    user.get().driverGarage?.activeVehicleId === null,
    String(user.get().driverGarage?.activeVehicleId));
  expect('S21: no flat activeVehicleId leaked onto top-level user record',
    typeof user.get().activeVehicleId === 'undefined',
    String(user.get().activeVehicleId));
  expect('S21: no selectedVehicleId leaked onto persisted user record',
    typeof user.get().selectedVehicleId === 'undefined',
    String(user.get().selectedVehicleId));
  expect('S21: no garageVehicles array leaked onto persisted user record',
    typeof user.get().garageVehicles === 'undefined',
    String(user.get().garageVehicles));
}

// ── Helper: byte-equal snapshot per storage key (for 05D per-key diff) ──────
function snapshotByKey() {
  const out = {};
  for (const [k, v] of local.entries()) out[k] = String(v);
  return out;
}

// ── Scenario 22 — make-active persists into the driverGarage namespace ─────
// 05D's load-bearing scenario: clicking "Сделать активной" on a non-active
// vehicle calls user.set with a driverGarage patch, and ONLY that field
// drifts in storage. No responses/active_ride/history/receipt key gets
// written even as a side effect.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  renderProfile('#/profile?role=driver&garage=multi');
  // Before click: default resolver → legacy-1 active, demo-2 available.
  expect('S22 pre: driverGarage default activeVehicleId is null',
    user.get().driverGarage?.activeVehicleId === null,
    String(user.get().driverGarage?.activeVehicleId));

  const beforeByKey = snapshotByKey();
  const fn = clickHandlers.get('#pf2-garage-make-active-demo-2');
  expect('S22: make-active handler captured for #pf2-garage-make-active-demo-2',
    typeof fn === 'function');
  try { fn && fn(); } catch (e) {
    expect('S22: make-active handler did not throw', false, e.message || String(e));
  }

  // After click: driverGarage.activeVehicleId === 'demo-2' (persisted).
  expect('S22: driverGarage.activeVehicleId === "demo-2" after click (persisted)',
    user.get().driverGarage?.activeVehicleId === 'demo-2',
    String(user.get().driverGarage?.activeVehicleId));
  // No flat activeVehicleId on the user record (we use the namespace only).
  expect('S22: no flat user.activeVehicleId field was introduced',
    typeof user.get().activeVehicleId === 'undefined',
    String(user.get().activeVehicleId));
  // Legacy vehicle fields untouched (the make-active patch is scoped).
  expect('S22: vehicleMake preserved across make-active click',
    user.get().vehicleMake === 'Hyundai', String(user.get().vehicleMake));
  expect('S22: vehiclePlate preserved across make-active click',
    user.get().vehiclePlate === 'А 482 МР 77', String(user.get().vehiclePlate));

  // Per-key diff: ONLY bazardrive.user.v1 changed, no other key was created
  // or mutated. Forbidden cross-surface keys must not exist at all.
  const afterByKey = snapshotByKey();
  const allKeys = new Set([...Object.keys(beforeByKey), ...Object.keys(afterByKey)]);
  for (const k of allKeys) {
    if (k === 'bazardrive.user.v1') continue;
    expect(`S22: storage key ${k} unchanged after make-active`,
      beforeByKey[k] === afterByKey[k]);
  }
  const FORBIDDEN_KEYS = [
    'bazardrive.responses.v1',
    'bazardrive.active_ride.v1',
    'bazardrive.ride_history.v1',
    'bazardrive.driver_receipts.v1',
    'bazardrive.respond.v1',
  ];
  for (const k of FORBIDDEN_KEYS) {
    expect(`S22: cross-surface storage key ${k} was NOT written by make-active`,
      !(k in afterByKey));
  }
}

// ── Scenario 23 — Re-render after persist swaps the active badge ───────────
// After the make-active click persists activeVehicleId='demo-2', a fresh
// render must place the active badge / span on demo-2 and demote legacy-1
// to a make-active candidate. We re-render through renderProfile because
// the smoke's DOM stub no-ops `replaceWith` — the persistence path is what
// the smoke actually verifies, not the in-place DOM mutation.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  // Set the persisted active id directly via user.set — bypasses the
  // click handler to test the render→resolver path in isolation.
  const cur = user.get().driverGarage || {};
  user.set({ driverGarage: { ...cur, activeVehicleId: 'demo-2' } });
  const slice = garageSlice(renderProfile('#/profile?role=driver&garage=multi'));

  // demo-2 is now the active card.
  expect('S23: demo-2 renders the active span #pf2-garage-active-demo-2',
    slice.includes('id="pf2-garage-active-demo-2"'));
  expect('S23: demo-2 card carries data-vehicle-status="active"',
    /data-vehicle="demo-2"[^>]*data-vehicle-status="active"|data-vehicle-status="active"[^>]*data-vehicle="demo-2"/.test(slice));
  expect('S23: demo-2 does NOT show a make-active button (it is the active one)',
    !slice.includes('id="pf2-garage-make-active-demo-2"'));

  // legacy-1 is demoted to a make-active candidate.
  expect('S23: legacy-1 now renders #pf2-garage-make-active-legacy-1 (demoted)',
    slice.includes('id="pf2-garage-make-active-legacy-1"'));
  expect('S23: legacy-1 does NOT render an active-current span anymore',
    !slice.includes('id="pf2-garage-active-legacy-1"'));
  expect('S23: legacy-1 card carries data-vehicle-status="available"',
    /data-vehicle="legacy-1"[^>]*data-vehicle-status="available"|data-vehicle-status="available"[^>]*data-vehicle="legacy-1"/.test(slice));
}

// ── Scenario 24 — Click-then-reload preserves the active selection ─────────
// End-to-end on the persistence layer: drive the make-active click handler
// (not a direct user.set), then re-render fresh. The persisted id must
// survive the round trip.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  renderProfile('#/profile?role=driver&garage=multi');
  const fn = clickHandlers.get('#pf2-garage-make-active-demo-2');
  fn && fn();
  // Simulate reload: render again from scratch.
  const slice = garageSlice(renderProfile('#/profile?role=driver&garage=multi'));
  expect('S24: post-click reload still has demo-2 as the active card',
    slice.includes('id="pf2-garage-active-demo-2"'));
  expect('S24: post-click reload demotes legacy-1 to make-active',
    slice.includes('id="pf2-garage-make-active-legacy-1"'));
  expect('S24: persisted driverGarage.activeVehicleId survived the reload',
    user.get().driverGarage?.activeVehicleId === 'demo-2',
    String(user.get().driverGarage?.activeVehicleId));
}

// ── Scenario 25 — Stale activeVehicleId falls back to legacy ───────────────
// If the persisted activeVehicleId points to a vehicle that is no longer
// in the rebuilt collection (e.g. ?garage=multi turned off, so demo-2 is
// gone), the resolver must fall back to the legacy vehicle without
// crashing and without mutating the persisted id (the saved selection
// stays around for when the user comes back to the multi preview).
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const cur = user.get().driverGarage || {};
  user.set({ driverGarage: { ...cur, activeVehicleId: 'demo-2' } });
  // Render WITHOUT ?garage=multi — demo-2 is not in the collection now.
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S25: single-card render after stale id still rendered (no crash)',
    slice.length > 0);
  expect('S25: legacy-1 falls back to active under a stale persisted id',
    slice.includes('id="pf2-garage-active-legacy-1"'));
  expect('S25: legacy-1 card carries data-vehicle-status="active"',
    slice.includes('data-vehicle-status="active"'));
  expect('S25: stale persisted activeVehicleId is PRESERVED (resolver is read-only)',
    user.get().driverGarage?.activeVehicleId === 'demo-2',
    String(user.get().driverGarage?.activeVehicleId));
  // Restoring the multi preview brings demo-2 back as the active vehicle.
  const sliceMulti = garageSlice(renderProfile('#/profile?role=driver&garage=multi'));
  expect('S25: bringing ?garage=multi back restores demo-2 as the active card',
    sliceMulti.includes('id="pf2-garage-active-demo-2"'));
}

// ── Scenario 26 — Empty garage never writes driverGarage ───────────────────
// No make-active button is rendered in the empty state, so the add-CTA
// click does NOT touch driverGarage at all. (Also re-confirms the empty
// state's snapshot byte-equality from S15, but specifically pins the
// driverGarage namespace stays default.)
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
});
{
  renderProfile('#/profile');
  expect('S26: empty render does NOT expose a make-active button anywhere',
    !clickHandlers.has('#pf2-garage-make-active-legacy-1') &&
    !clickHandlers.has('#pf2-garage-make-active-demo-2'));
  const addHandler = clickHandlers.get('#pf2-garage-add');
  addHandler && addHandler();
  expect('S26: driverGarage.activeVehicleId stays null after empty-add click',
    user.get().driverGarage?.activeVehicleId === null,
    String(user.get().driverGarage?.activeVehicleId));
}

// ── Scenario 27 — Passenger profile never writes driverGarage either ───────
// The garage section is driver-only, so a passenger render must not even
// expose the make-active selector — but as a belt-and-braces, also
// confirm the namespace stays default.
reset();
user.set({
  onboarded: true, role: 'passenger',
  firstName: 'Алия', lastName: 'К.', displayName: 'Алия К.',
  phone: '9007654321', phoneVerified: true,
});
{
  renderProfile('#/profile');
  expect('S27: passenger render does NOT capture any make-active handler',
    !clickHandlers.has('#pf2-garage-make-active-legacy-1') &&
    !clickHandlers.has('#pf2-garage-make-active-demo-2'));
  expect('S27: passenger profile driverGarage.activeVehicleId stays default null',
    user.get().driverGarage?.activeVehicleId === null,
    String(user.get().driverGarage?.activeVehicleId));
}

// ── Scenario 28 — Default resolver: no persisted active → legacy is active ─
// Belt-and-braces sanity check on the resolver fallback path: a profile
// with no prior selection (the v10 default `driverGarage.activeVehicleId
// = null`) still gets a legacy active card without ever writing.
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
  expect('S28: legacy-1 is the active card under default null persisted id',
    slice.includes('id="pf2-garage-active-legacy-1"'));
  expect('S28: default null activeVehicleId is left untouched by render',
    user.get().driverGarage?.activeVehicleId === null,
    String(user.get().driverGarage?.activeVehicleId));
}

// ── Result ───────────────────────────────────────────────────────────────────
if (issues.length) {
  console.error('\nSMOKE FAILED:');
  for (const i of issues) console.error('  - ' + i);
  process.exit(1);
}
console.log('\nAll profile driver-garage smoke checks passed.');
