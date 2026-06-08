// BD-PROFILE-D-05A/B/C — Driver Garage smoke.
//
// The Garage section is a driver-only profile surface. It derives its
// view from the legacy fields on the user record (vehicleMake /
// vehicleModel / vehicleColor / vehiclePlate; state.js:50-54) without
// a data migration. This smoke pins the surface contract across three
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
//         DOM ids (`*-${vehicle.id}`); active flag is derived (NOT
//         persisted activeVehicleId); `?garage=multi` adds a single
//         demo vehicle for preview without touching storage; multi-state
//         no-mutation guarantee across every per-vehicle handler.
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

// ── Scenario 16 — Static source guard on wireGarageActions + builder ────────
// Belt-and-braces against a future refactor that introduces a real CRUD
// write inside the garage helpers without updating the contract / docs.
// The function bodies must not contain any storage-mutation calls and
// must not introduce a persisted activeVehicleId / selectedVehicleId /
// garageVehicles[] key.
{
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const profileSrc  = readFileSync(join(projectRoot, 'public/src/screens/profile.js'), 'utf8');

  // wireGarageActions body (extracted up to the next top-level function).
  const wireStart   = profileSrc.indexOf('function wireGarageActions(');
  const wireEnd     = profileSrc.indexOf('function renderDriver(', wireStart);
  const wireBody    = (wireStart >= 0 && wireEnd > wireStart)
    ? profileSrc.slice(wireStart, wireEnd) : '';
  expect('S16: wireGarageActions function body extracted',
    wireBody.length > 0, String(wireBody.length));

  // buildGarageVehicles body (collection builder, must derive only — no
  // persistence reads/writes outside the legacy user.* fields).
  const buildStart  = profileSrc.indexOf('function buildGarageVehicles(');
  const buildEnd    = profileSrc.indexOf('function garageVehicleCardHtml(', buildStart);
  const buildBody   = (buildStart >= 0 && buildEnd > buildStart)
    ? profileSrc.slice(buildStart, buildEnd) : '';
  expect('S16: buildGarageVehicles function body extracted',
    buildBody.length > 0, String(buildBody.length));

  const FORBIDDEN_RUNTIME = [
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
    { name: 'saveActiveVehicle', regex: /\bsaveActiveVehicle\s*\(/ },
    { name: 'activeVehicleId', regex: /\bactiveVehicleId\b/ },
    { name: 'selectedVehicleId', regex: /\bselectedVehicleId\b/ },
    { name: 'go(', regex: /\bgo\s*\(/ },  // router navigation is also out of scope for 05B/05C
  ];
  for (const { name, regex } of FORBIDDEN_RUNTIME) {
    expect(`S16: wireGarageActions does NOT call/reference ${name}`,
      !regex.test(wireBody));
    expect(`S16: buildGarageVehicles does NOT call/reference ${name}`,
      !regex.test(buildBody));
  }
  // Positive contract: 05B confirm flow toggles the row's
  // data-garage-confirm-state attribute as its single state surface, so
  // it must appear in wire body.
  expect('S16: wireGarageActions toggles data-garage-confirm-state (DOM-only)',
    /garageConfirmState/.test(wireBody));
  // Builder reads only the four legacy user.* vehicle fields, no other
  // persistence key.
  expect('S16: buildGarageVehicles reads u.vehicleMake (derived from legacy fields)',
    /\bu\.vehicleMake\b/.test(buildBody));
  expect('S16: buildGarageVehicles reads u.vehicleModel (derived from legacy fields)',
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
  // Multi-render must not bleed into persisted state.
  expect('S19: ?garage=multi did NOT introduce activeVehicleId in storage',
    !local.has('bazardrive.user.v1') || !/activeVehicleId/.test(local.get('bazardrive.user.v1') || ''));
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

// ── Scenario 21 — Multi-state no-mutation guarantee. Trigger every per-vehicle
// handler across both cards and assert localStorage stays byte-equal. ──────
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
    // Legacy (active) card — no make-active.
    '#pf2-garage-edit-legacy-1',
    '#pf2-garage-archive-legacy-1',
    '#pf2-garage-archive-cancel-legacy-1',
    '#pf2-garage-archive-confirm-legacy-1',
    // Demo (non-active) card — includes make-active.
    '#pf2-garage-edit-demo-2',
    '#pf2-garage-make-active-demo-2',
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
  expect('S21: persisted vehicleMake preserved across multi-card mutations',
    user.get().vehicleMake === 'Hyundai', String(user.get().vehicleMake));
  expect('S21: no activeVehicleId leaked onto persisted user record',
    typeof user.get().activeVehicleId === 'undefined',
    String(user.get().activeVehicleId));
  expect('S21: no selectedVehicleId leaked onto persisted user record',
    typeof user.get().selectedVehicleId === 'undefined',
    String(user.get().selectedVehicleId));
  expect('S21: no garageVehicles array leaked onto persisted user record',
    typeof user.get().garageVehicles === 'undefined',
    String(user.get().garageVehicles));
}

// ── Result ───────────────────────────────────────────────────────────────────
if (issues.length) {
  console.error('\nSMOKE FAILED:');
  for (const i of issues) console.error('  - ' + i);
  process.exit(1);
}
console.log('\nAll profile driver-garage smoke checks passed.');
